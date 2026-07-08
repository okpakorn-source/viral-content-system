/**
 * ★ Topic Hunt Service (8 ก.ค. 69 · rev.2 "DNA discovery") — สมอง "ค้นข่าวแนวเดียวกัน คนละคน"
 * ─────────────────────────────────────────────────────────────────────────────
 * เดิม (rev.1): หา "ตามต่อเรื่องเดิม" (คนเดิมล้วน) — ผิดจุดประสงค์
 * ใหม่ (rev.2 · ผู้ใช้สั่ง): วิเคราะห์ "DNA แนวข่าว" (ใคร+ทำอะไร+แกน+อารมณ์) แล้วหา
 *   "ข่าวแนวเดียวกันแต่คนละคน/คนละเคส" 3 ระดับ (ใกล้→กลาง→กว้าง) · กันคนต้นทางออก
 *   เก็บ "ข่าวคนเดิม" ไว้กลุ่มเล็กแยก (cap) เผื่ออยากได้มุมเพิ่ม
 *   ตัวอย่าง: "อั้ม พัชราภา บริจาค 2 แสนให้หมาจร"
 *     DNA = ดารา + บริจาค + หมาจร/สัตว์ + น้ำดี
 *     → ระดับ1 ดาราคนอื่นบริจาคหมาจร · ระดับ2 ดาราบริจาครูปแบบอื่น · ระดับ3 ดาราน้ำดีทำดี
 * 🔴 แยกเดี่ยว 100% — ไม่ import จาก harvester/โต๊ะข่าว · Serper helper ฉบับย่ออยู่ในไฟล์นี้
 */
import { callAI } from '@/lib/ai/openai';
import { MODEL_NEWS_ANALYSIS } from '@/lib/ai/modelConfig';

// ★ 8 ก.ค. rev.3 (ผู้ใช้สั่ง "เพิ่มจำนวนผล ให้ 3 ระดับมีตัวเลือกเยอะขึ้น"):
//   Serper คิดเครดิตต่อ "คิวรี" ไม่ใช่ต่อจำนวนผล → ดึง num มากขึ้น = ได้ตัวเลือกเยอะขึ้นแทบฟรี
const MAX_QUERIES = 20;     // เพดาน Serper ต่อการค้น 1 รอบ (12→20)
const SEARCH_NUM = 20;      // ผลต่อคิวรี (10→20) — เพิ่มปริมาณโดยไม่เพิ่มเครดิต
const JUDGE_CAP = 72;       // ส่งให้กรรมการคัดสูงสุดกี่เรื่อง/รอบ (44→72)
const KEEP_SCORE = 6;       // เก็บเฉพาะเรื่องที่คะแนน ≥ นี้
const SAME_PERSON_CAP = 6;  // "ข่าวคนเดิม" เก็บได้สูงสุดกี่เรื่อง (กลุ่มเล็กแยก, 4→6)

// ── Serper helper ฉบับย่อ ──
async function serper(endpoint, q, { num = 10, timeRange = '' } = {}) {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error('ไม่มี SERPER_API_KEY — ตั้งค่า env ก่อนใช้ค้นข่าวคล้าย');
  const body = { q, gl: 'th', hl: 'th', num };
  if (timeRange) body.tbs = timeRange;
  const res = await fetch(`https://google.serper.dev/${endpoint}`, {
    method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}`);
  const data = await res.json();
  const rows = endpoint === 'news' ? (data.news || []) : endpoint === 'videos' ? (data.videos || []) : (data.organic || []);
  return rows.map(n => {
    let src = n.source || n.channel || '';
    try { if (!src) src = new URL(n.link).hostname.replace(/^www\./, ''); } catch {}
    return { title: String(n.title || ''), snippet: String(n.snippet || ''), url: String(n.link || ''), source: String(src).slice(0, 60), date: String(n.date || '') };
  }).filter(r => r.url && r.title);
}

const _clipHost = (u) => /tiktok\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|instagram\.com/i.test(u);
const _normUrl = (u) => String(u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();

// ── 1) วิเคราะห์ DNA แนวข่าว → คีย์ค้น 3 ระดับ (คนละคน) + รายชื่อคนต้นทาง (กันไม่ให้เอาคนเดิม) ──
export async function analyzeStyleAndKeys(insight) {
  const prompt = `คุณเป็นบรรณาธิการเพจข่าวไวรัลไทย วิเคราะห์ "DNA แนวข่าว" จากเนื้อดิบด้านล่าง
🎯 เป้าหมาย: เอา DNA ไปหา "ข่าวแนวเดียวกันแต่คนละคน/คนละเคส" (⛔ ไม่ใช่หาข่าวคนเดิม)

หัวข้อ: ${insight.headline || '-'}
หมวด: ${insight.category || '-'}
=== เนื้อดิบ ===
${String(insight.rawData || '').slice(0, 4000)}
=== จบ ===

หน้าที่:
1. สกัด DNA แนวข่าว 4 มิติ (สั้น กระชับ):
   • who = ประเภทตัวละคร (เช่น ดารา/คนดัง, คนธรรมดา, เด็ก, ผู้สูงอายุ, ผู้พิการ)
   • what = การกระทำ/แก่นเหตุการณ์ (เช่น บริจาค, ช่วยเหลือ, สู้ชีวิต, กตัญญู)
   • core = แกน/กลุ่มเป้าหมาย/สิ่งของ (เช่น หมาจร/สัตว์, เงิน, ครอบครัว, การเรียน)
   • emotion = อารมณ์แนวข่าว (เช่น น้ำดี, กินใจ, สู้ชีวิต, อบอุ่น)
2. sourceEntities = ชื่อคน/ฉายา/เพจ/ตัวละครหลัก "ในข่าวต้นทางนี้" (เพื่อกันไม่ให้ระบบเอาข่าวคนเดิมมา)
3. สร้างคีย์ค้น 3 ระดับ — ทุกคีย์ต้อง "คนละคน" ⛔ ห้ามใส่ชื่อคนต้นทาง (ห้ามมีคำใน sourceEntities):
   • keysL1 (ใกล้สุด 4-5 คีย์): who+what+core เดียวกัน คนละคน — เช่น "ดาราบริจาคหมาจร", "คนดังช่วยหมาจรัด", "นักแสดงอุปการะสุนัขจร"
   • keysL2 (กลาง 5-6 คีย์): who+what เดียวกัน core อื่น — เช่น "ดาราบริจาคเงินการกุศล", "ดาราทำบุญโรงพยาบาล", "คนดังช่วยผู้ประสบภัย"
   • keysL3 (กว้าง 5-6 คีย์): who+emotion เดียวกัน — เช่น "ดาราน้ำดีทำความดี", "คนดังช่วยสังคม", "ดาราจิตอาสา"
   • ⭐ แต่ละคีย์ในระดับเดียวกัน "มุมต่างกัน" (คนละคำ/คนละสำนวน/คนละแง่) เพื่อให้เจอเรื่องหลากหลาย ไม่ซ้ำ
   • คีย์ภาษาไทย สั้น 2-6 คำ ค้น Google ได้จริง

ตอบ JSON เท่านั้น:
{"dna":{"who":"","what":"","core":"","emotion":""},"theme":"สรุปแนวข่าว 1 วลีสั้น","whyViral":"ทำไมคนแชร์ 1 ประโยค",
"sourceEntities":["ชื่อคน/ฉายา/เพจในข่าวต้นทาง"],"keysL1":["..."],"keysL2":["..."],"keysL3":["..."]}`;
  const r = await callAI({ prompt, model: MODEL_NEWS_ANALYSIS, temperature: 0.35, maxTokens: 2200 });
  const p = typeof r === 'object' ? r : JSON.parse(String(r).match(/\{[\s\S]*\}/)?.[0] || '{}');
  return normalizeProfile(p);
}

// ประกอบ profile มาตรฐาน (ใช้ร่วมกับ newsHuntService ที่วิเคราะห์ข่าวเว็บ)
export function normalizeProfile(p) {
  const arr = (a, n) => Array.isArray(a) ? a.slice(0, n).map(x => String(x).slice(0, 60)).filter(Boolean) : [];
  const d = p.dna || {};
  const profile = {
    dna: {
      who: String(d.who || '').slice(0, 40),
      what: String(d.what || '').slice(0, 40),
      core: String(d.core || '').slice(0, 40),
      emotion: String(d.emotion || p.emotion || '').slice(0, 40),
    },
    theme: String(p.theme || '').slice(0, 100),
    whyViral: String(p.whyViral || '').slice(0, 200),
    sourceEntities: arr(p.sourceEntities || p.entities, 8),
    keysL1: arr(p.keysL1, 5),   // ★ rev.3: เพิ่มคีย์/ระดับ ให้เจอตัวเลือกเยอะขึ้น (3→5/6/6)
    keysL2: arr(p.keysL2, 6),
    keysL3: arr(p.keysL3, 6),
  };
  if (!profile.keysL1.length && !profile.keysL2.length && !profile.keysL3.length) {
    throw new Error('สมองวิเคราะห์ DNA สร้างคีย์ค้นไม่สำเร็จ — ลองใหม่อีกครั้ง');
  }
  return profile;
}

// ── 2) ค้นทุกแหล่งตามคีย์ 3 ระดับ (เพดาน MAX_QUERIES) — ทุกผลติดระดับความใกล้ DNA ──
export async function searchSimilar(profile) {
  const plan = [];
  // ระดับ 1 (ใกล้สุด) — ยิงหนักสุด: เว็บทุกคีย์ + ข่าวสด 2 คีย์แรก + คลิป TikTok คีย์แรก
  (profile.keysL1 || []).forEach((k, i) => {
    plan.push({ ep: 'search', q: k, opt: { timeRange: 'qdr:y' }, level: 1 });
    if (i < 2) plan.push({ ep: 'news', q: k, opt: { timeRange: 'qdr:m' }, level: 1 });
    if (i === 0) plan.push({ ep: 'search', q: `${k} site:tiktok.com`, opt: {}, level: 1 });
  });
  // ระดับ 2 (กลาง)
  (profile.keysL2 || []).forEach((k) => plan.push({ ep: 'search', q: k, opt: { timeRange: 'qdr:y' }, level: 2 }));
  // ระดับ 3 (กว้าง)
  (profile.keysL3 || []).forEach((k) => plan.push({ ep: 'search', q: k, opt: { timeRange: 'qdr:y' }, level: 3 }));
  const queries = plan.slice(0, MAX_QUERIES);
  // ★ rev.3: ดึง SEARCH_NUM ผล/คิวรี (Serper คิดต่อคิวรี ไม่ใช่ต่อผล → ได้ตัวเลือกเยอะขึ้นแทบฟรี)
  const settled = await Promise.allSettled(queries.map(x => serper(x.ep, x.q, { ...x.opt, num: SEARCH_NUM })));
  const out = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') for (const r of s.value) out.push({ ...r, level: queries[i].level, viaKey: queries[i].q });
    else console.warn(`[TopicHunt] คิวรีล้ม (${queries[i].q.slice(0, 30)}):`, s.reason?.message?.slice(0, 50));
  });
  // dedupe ตาม URL — เก็บ level ต่ำสุด (ใกล้สุด) ถ้าซ้ำหลายระดับ
  const map = new Map();
  for (const r of out) {
    const k = _normUrl(r.url); if (!k) continue;
    const ex = map.get(k);
    if (!ex || r.level < ex.level) map.set(k, r);
  }
  return { results: [...map.values()], queriesUsed: queries.length };
}

// ── 3) กรรมการ — ตัดสิน "คนเดิม vs คนละคน" + ระดับความใกล้ DNA + คะแนน ──
//   เน้น "คนละคน" เป็นผลหลัก · "คนเดิม" เก็บกลุ่มเล็ก (cap) แยก
export async function judgeResults(candidates, profile, sourceHeadline) {
  if (!candidates.length) return [];
  const ordered = [...candidates].sort((a, b) => a.level - b.level).slice(0, JUDGE_CAP);
  const listText = ordered.map((c, i) => `${i}| ${c.title} — ${c.snippet.slice(0, 120)} (${c.source})`).join('\n');
  const d = profile.dna || {};
  const prompt = `คุณเป็นบรรณาธิการเพจข่าวไวรัลไทยน้ำดี — กำลังหา "ข่าวแนวเดียวกันแต่คนละคน/คนละเคส" เพื่อเอาไปทำข่าวใหม่
ข่าวต้นทาง: "${sourceHeadline}"
DNA แนวข่าว → ใคร: ${d.who || '-'} · ทำอะไร: ${d.what || '-'} · แกน: ${d.core || '-'} · อารมณ์: ${d.emotion || '-'}
⛔ คน/เพจต้นทาง (ถือเป็น "คนเดิม"): ${(profile.sourceEntities || []).join(', ') || '-'}

ให้คะแนนผลค้นหาทีละเรื่อง (0-10): ตรง DNA แนวข่าว + น่าเอาไปทำโพสต์ = สูง · ไม่เกี่ยว/โฆษณา/สแปม/ขายของ = ต่ำ
พร้อมระบุ:
- same = true ถ้าเรื่องนี้ "เกี่ยวกับคน/กลุ่ม/เคสเดียวกับข่าวต้นทาง" (คนเดิม — ชื่อตรงกับคนต้นทาง) · false ถ้าเป็นคนอื่น/เคสอื่น
- level = ความใกล้ DNA เมื่อเป็นคนละคน: 1=ใกล้มาก (ทำ what+core เดียวกัน) · 2=กลาง (what เดียวกัน core อื่น) · 3=กว้าง (แค่ who+อารมณ์เดียวกัน)

=== ผลค้นหา (เลขหน้า | เรื่อง) ===
${listText}
=== จบ ===

ตอบ JSON เท่านั้น: {"picks":[{"i":เลขข้อ,"score":0-10,"same":true|false,"level":1,"reason":"สั้นๆ"}]}
ใส่ให้ครบทุกข้อที่ score ≥ ${KEEP_SCORE} (มีเยอะใส่เยอะ — ทีมอยากได้ตัวเลือกมากๆ ทั้ง 3 ระดับ)`;
  const r = await callAI({ prompt, model: MODEL_NEWS_ANALYSIS, temperature: 0.2, maxTokens: 6000 });
  const p = typeof r === 'object' ? r : JSON.parse(String(r).match(/\{[\s\S]*\}/)?.[0] || '{}');
  const picks = Array.isArray(p.picks) ? p.picks : [];
  const diff = [], same = [];
  for (const pk of picks) {
    const c = ordered[Number(pk.i)];
    const score = Math.min(10, Math.max(0, Number(pk.score) || 0));
    if (!c || score < KEEP_SCORE) continue;
    const isSame = pk.same === true || pk.same === 'true';
    const lvl = [1, 2, 3].includes(Number(pk.level)) ? Number(pk.level) : (c.level || 2);
    const row = {
      title: c.title.slice(0, 160), url: c.url, source: c.source, date: c.date,
      snippet: c.snippet.slice(0, 200),
      type: _clipHost(c.url) ? 'คลิป' : 'ข่าวเว็บ',
      tag: isSame ? 'same' : 'dna',       // same = คนเดิม · dna = แนวเดียวกันคนละคน
      level: isSame ? 0 : lvl,
      score, reason: String(pk.reason || '').slice(0, 120),
    };
    (isSame ? same : diff).push(row);
  }
  // ผลหลัก = คนละคน เรียงตามระดับ (ใกล้→กว้าง) แล้วคะแนน · คนเดิม = กลุ่มเล็กท้าย (cap)
  diff.sort((a, b) => a.level - b.level || b.score - a.score);
  same.sort((a, b) => b.score - a.score);
  return [...diff, ...same.slice(0, SAME_PERSON_CAP)];
}

/**
 * ★ ตัวเดินเรื่องครบวงจร — insight (ถอดมาแล้ว) → DNA/คีย์ → ค้น → คัด
 */
export async function runTopicHunt({ url, insight, user = '' }) {
  console.log(`[TopicHunt] 🧬 เริ่ม: ${String(insight.headline || url).slice(0, 60)}`);
  const profile = await analyzeStyleAndKeys(insight);
  console.log(`[TopicHunt] DNA: ${profile.dna.who}/${profile.dna.what}/${profile.dna.core} · คีย์ L1=${profile.keysL1.length} L2=${profile.keysL2.length} L3=${profile.keysL3.length}`);
  const { results, queriesUsed } = await searchSimilar(profile);
  const srcKey = _normUrl(url);
  const candidates = results.filter(r => _normUrl(r.url) !== srcKey);
  console.log(`[TopicHunt] ค้นได้ ${candidates.length} เรื่อง (จาก ${queriesUsed} คิวรี) — ส่งกรรมการคัด`);
  const kept = await judgeResults(candidates, profile, insight.headline || '');
  const nDiff = kept.filter(k => k.tag === 'dna').length;
  console.log(`[TopicHunt] ✅ ผ่านคัด ${kept.length} (คนละคน ${nDiff} · คนเดิม ${kept.length - nDiff})`);
  return {
    sourceUrl: url,
    sourceType: 'clip',
    title: String(insight.headline || url).slice(0, 140),
    insight,
    styleProfile: profile,
    searchKeys: [...profile.keysL1, ...profile.keysL2, ...profile.keysL3],
    results: kept,
    stats: { queriesUsed, found: candidates.length, kept: kept.length, diff: nDiff },
    user: String(user || '').slice(0, 40),
  };
}
