/**
 * ★ Topic Hunt Service (8 ก.ค. 69) — สมอง "ถอด+ค้นข่าวคล้าย" (คลังค้นประเด็นยูสเซอร์)
 * ─────────────────────────────────────────────────────────────────────────────
 * รับ "เนื้อดิบ" จากเครื่องถอดประเด็น (clipInsightService) → 3 สมองในไฟล์นี้:
 *  1) analyzeStyleAndKeys(insight) — วิเคราะห์สไตล์ข่าว → คีย์ค้น 2 กลุ่ม
 *     • follow = ตามต่อเรื่องนี้ (ชื่อคน+เหตุการณ์เดียวกัน หามุมเพิ่ม)
 *     • theme  = ธีมเดียวกันเรื่องใหม่ (แนวเดียวกัน คนละเหตุการณ์ เอาไปทำข่าวเพิ่ม)
 *  2) searchSimilar(keys) — Serper: news + search + videos + site:tiktok/youtube (เพดาน 12 คิวรี/รอบ)
 *  3) judgeResults(...) — กรรมการให้คะแนนความน่าสนใจ 0-10 ตามรสนิยมเพจ เก็บ ≥6 ไม่จำกัดจำนวน
 * 🔴 แยกเดี่ยว 100% — ห้าม import จาก harvester/โต๊ะข่าว (ระบบล็อก) · Serper helper ฉบับย่ออยู่ในไฟล์นี้
 */
import { callAI } from '@/lib/ai/openai';
import { MODEL_NEWS_ANALYSIS } from '@/lib/ai/modelConfig';

const MAX_QUERIES = 12;     // เพดาน Serper ต่อการค้น 1 รอบ (คุมงบ)
const JUDGE_CAP = 40;       // ส่งให้กรรมการคัดสูงสุดกี่เรื่อง/รอบ
const KEEP_SCORE = 6;       // เก็บเฉพาะเรื่องที่คะแนน ≥ นี้ — ไม่จำกัดเพดานจำนวน

// ── Serper helper ฉบับย่อ (แบบเดียวกับท่อโต๊ะข่าว แต่แยกไฟล์ ไม่แตะของล็อก) ──
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

// ── 1) วิเคราะห์สไตล์ข่าว → คีย์ค้น 2 กลุ่ม ──
export async function analyzeStyleAndKeys(insight) {
  const prompt = `คุณเป็นบรรณาธิการเพจข่าวไวรัลไทย อ่าน "เนื้อดิบจากคลิป" ด้านล่าง แล้ววิเคราะห์สไตล์ข่าว + สร้างคีย์เวิร์ดไปค้นหาข่าว/คลิปแนวเดียวกัน

หัวข้อ: ${insight.headline || '-'}
หมวด: ${insight.category || '-'}
=== เนื้อดิบ ===
${String(insight.rawData || '').slice(0, 4000)}
=== จบ ===

หน้าที่:
1. สรุปสไตล์ข่าวนี้: ธีมหลัก (สั้น เจาะจง) + อารมณ์เด่น + ทำไมคนแชร์/ไวรัล
2. สร้างคีย์ค้น 2 กลุ่ม:
   • followKeys (2-4 คีย์) = ตามต่อ "เรื่องนี้เหตุการณ์นี้" — ชื่อคน/ฉายา + เหตุการณ์ (เช่น "โอบะ สัปเหร่อไร้ขา")
   • themeKeys (4-6 คีย์) = หา "เรื่องใหม่ธีมเดียวกัน" — ⛔ ห้ามคำลอยๆ อย่าง "สู้ชีวิต" เดี่ยวๆ ต้องเจาะ อาชีพ/สถานการณ์/บุคคล+อารมณ์ (เช่น "ผู้พิการทำงานเลี้ยงชีพไม่ขอทาน", "ลุงป้าอาชีพสุจริตยอดแชร์")
   • คีย์ภาษาไทย สั้น 2-6 คำ ใช้ค้น Google ได้จริง

ตอบ JSON เท่านั้น:
{"theme":"ธีมหลัก (สั้น เจาะจง)","emotion":"อารมณ์เด่น","whyViral":"ทำไมคนแชร์ 1 ประโยค","entities":["ชื่อคน/สถานที่สำคัญ"],"followKeys":["..."],"themeKeys":["..."]}`;
  const r = await callAI({ prompt, model: MODEL_NEWS_ANALYSIS, temperature: 0.3, maxTokens: 1500 });
  const p = typeof r === 'object' ? r : JSON.parse(String(r).match(/\{[\s\S]*\}/)?.[0] || '{}');
  const arr = (a, n) => Array.isArray(a) ? a.slice(0, n).map(x => String(x).slice(0, 60)).filter(Boolean) : [];
  const profile = {
    theme: String(p.theme || '').slice(0, 100),
    emotion: String(p.emotion || '').slice(0, 60),
    whyViral: String(p.whyViral || '').slice(0, 200),
    entities: arr(p.entities, 6),
    followKeys: arr(p.followKeys, 4),
    themeKeys: arr(p.themeKeys, 6),
  };
  if (!profile.followKeys.length && !profile.themeKeys.length) throw new Error('สมองสไตล์สร้างคีย์ค้นไม่สำเร็จ — ลองใหม่อีกครั้ง');
  return profile;
}

// ── 2) ค้นทุกแหล่งตามคีย์ (เพดาน MAX_QUERIES) ──
export async function searchSimilar(profile) {
  const plan = [];
  for (const k of profile.followKeys) {
    plan.push({ ep: 'news', q: k, opt: { timeRange: 'qdr:m' }, bucket: 'follow' });
    plan.push({ ep: 'search', q: k, opt: { timeRange: 'qdr:m' }, bucket: 'follow' });
  }
  for (const k of profile.themeKeys) plan.push({ ep: 'search', q: k, opt: { timeRange: 'qdr:y' }, bucket: 'theme' });
  // เจาะคลิปโซเชียล — ใช้ 2 คีย์ธีมแรก (ไม่ต้องต่อ API ใหม่)
  for (const k of profile.themeKeys.slice(0, 2)) {
    plan.push({ ep: 'search', q: `${k} site:tiktok.com`, opt: {}, bucket: 'theme' });
    plan.push({ ep: 'videos', q: k, opt: {}, bucket: 'theme' });
  }
  const queries = plan.slice(0, MAX_QUERIES);
  const settled = await Promise.allSettled(queries.map(x => serper(x.ep, x.q, x.opt)));
  const out = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') for (const r of s.value) out.push({ ...r, bucket: queries[i].bucket, viaKey: queries[i].q });
    else console.warn(`[TopicHunt] คิวรีล้ม (${queries[i].q.slice(0, 30)}):`, s.reason?.message?.slice(0, 50));
  });
  // dedupe ตาม URL
  const seen = new Set(); const uniq = [];
  for (const r of out) { const k = _normUrl(r.url); if (!k || seen.has(k)) continue; seen.add(k); uniq.push(r); }
  return { results: uniq, queriesUsed: queries.length };
}

// ── 3) กรรมการคัดความน่าสนใจ — เก็บ ≥ KEEP_SCORE ไม่จำกัดจำนวน ──
export async function judgeResults(candidates, profile, sourceHeadline) {
  if (!candidates.length) return [];
  // follow มาก่อน (ตามต่อเรื่องเดิมสำคัญสุด) แล้วค่อย theme — ตัดที่ JUDGE_CAP
  const ordered = [...candidates.filter(c => c.bucket === 'follow'), ...candidates.filter(c => c.bucket !== 'follow')].slice(0, JUDGE_CAP);
  const listText = ordered.map((c, i) => `${i}| [${c.bucket === 'follow' ? 'ตามต่อ?' : 'ธีม?'}] ${c.title} — ${c.snippet.slice(0, 120)} (${c.source})`).join('\n');
  const prompt = `คุณเป็นบรรณาธิการเพจข่าวไวรัลไทยน้ำดี (ถนัด: คนตัวเล็ก น้ำใจ สู้ชีวิต กตัญญู เรื่องกินใจแชร์ได้)
คลิปต้นทางที่ทีมสนใจ: "${sourceHeadline}"
ธีม: ${profile.theme} · อารมณ์: ${profile.emotion} · ทำไมไวรัล: ${profile.whyViral}

ด้านล่างคือผลค้นหา ให้คะแนนทีละเรื่อง (0-10): "เกี่ยวกับธีมนี้จริง + น่าเอามาทำโพสต์" = สูง · ไม่เกี่ยว/โฆษณา/เว็บสแปม/ประกาศขายของ = ต่ำ
พร้อมติดป้าย: "follow" = ข่าว/คลิปของเหตุการณ์เดียวกับคลิปต้นทาง · "theme" = คนละเหตุการณ์แต่ธีมเดียวกัน

=== ผลค้นหา (เลขหน้า | เรื่อง) ===
${listText}
=== จบ ===

ตอบ JSON เท่านั้น: {"picks":[{"i":เลขข้อ,"score":0-10,"tag":"follow|theme","reason":"สั้นๆ ทำไมน่าสนใจ/คะแนนนี้"}]}
ให้ครบทุกข้อที่ score ≥ ${KEEP_SCORE} — เรื่องต่ำกว่านั้นไม่ต้องใส่`;
  const r = await callAI({ prompt, model: MODEL_NEWS_ANALYSIS, temperature: 0.2, maxTokens: 4000 });
  const p = typeof r === 'object' ? r : JSON.parse(String(r).match(/\{[\s\S]*\}/)?.[0] || '{}');
  const picks = Array.isArray(p.picks) ? p.picks : [];
  const kept = [];
  for (const pk of picks) {
    const c = ordered[Number(pk.i)];
    const score = Math.min(10, Math.max(0, Number(pk.score) || 0));
    if (!c || score < KEEP_SCORE) continue;
    kept.push({
      title: c.title.slice(0, 160), url: c.url, source: c.source, date: c.date,
      snippet: c.snippet.slice(0, 200),
      type: _clipHost(c.url) ? 'คลิป' : 'ข่าวเว็บ',
      tag: pk.tag === 'follow' ? 'follow' : 'theme',
      score, reason: String(pk.reason || '').slice(0, 120),
    });
  }
  kept.sort((a, b) => b.score - a.score);
  return kept;
}

/**
 * ★ ตัวเดินเรื่องครบวงจร — insight (ถอดมาแล้ว) → สไตล์/คีย์ → ค้น → คัด
 * @returns ก้อนข้อมูลเคส (route เป็นคนใส่ id + เก็บคลัง)
 */
export async function runTopicHunt({ url, insight, user = '' }) {
  console.log(`[TopicHunt] 🧭 เริ่ม: ${String(insight.headline || url).slice(0, 60)}`);
  const profile = await analyzeStyleAndKeys(insight);
  console.log(`[TopicHunt] คีย์: follow=${profile.followKeys.length} theme=${profile.themeKeys.length} — เริ่มค้น`);
  const { results, queriesUsed } = await searchSimilar(profile);
  // กันผลซ้ำกับลิงก์ต้นทาง
  const srcKey = _normUrl(url);
  const candidates = results.filter(r => _normUrl(r.url) !== srcKey);
  console.log(`[TopicHunt] ค้นได้ ${candidates.length} เรื่อง (จาก ${queriesUsed} คิวรี) — ส่งกรรมการคัด`);
  const kept = await judgeResults(candidates, profile, insight.headline || '');
  console.log(`[TopicHunt] ✅ ผ่านคัด ${kept.length} เรื่อง (≥${KEEP_SCORE}/10)`);
  return {
    sourceUrl: url,
    title: String(insight.headline || url).slice(0, 140),
    insight,
    styleProfile: profile,
    searchKeys: [...profile.followKeys, ...profile.themeKeys],
    results: kept,
    stats: { queriesUsed, found: candidates.length, kept: kept.length },
    user: String(user || '').slice(0, 40),
  };
}
