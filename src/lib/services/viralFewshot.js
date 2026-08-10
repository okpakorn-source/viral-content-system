/**
 * =====================================================
 * Viral Few-shot — เรียนสำนวนจากหอสมุดไวรัลจริง 200+ โพสต์ (8 ส.ค. 69: 202 ใบ/14 หมวด — ทุกใบถูกเรียกได้จริง)
 * =====================================================
 * (11 มิ.ย. — ผู้ใช้เลือก: Few-shot ตามหมวด + สำนวนเพจไวรัลเต็มตัว)
 * ดึงโพสต์ไวรัลจริง "หมวดเดียวกับข่าว" 2 ตัวอย่างใส่พรอมต์ writer
 * + VIRAL STYLE PACK (สูตรที่สกัดจากโพสต์ท็อป: hook/ตัวเลข/วลีลายเซ็น/จังหวะ/จบคม)
 * fail-safe: Supabase ล่ม → ได้ Style Pack อย่างเดียว (ไม่พัง pipeline)
 */

import { getSupabase } from '../supabase.js';
import fs from 'node:fs';
import path from 'node:path';

// สูตรสกัดจากโพสต์ top engagement ของหอสมุด — always-on
const VIRAL_STYLE_PACK =
  '=== 🔥 VIRAL STYLE PACK — สูตรเพจไวรัล (บังคับใช้) ===\n' +
  '1. เปิดด้วย HOOK ไวรัล (เลือก 1): คำถามกระแทก ("จะมีสักกี่คนที่..."), ความย้อนแย้ง ("ไม่ใช่แค่สวย แต่ยังขยัน..."), คำพูดตัวละคร ("ตั้งแต่จำความได้ ผมก็ถามหาแต่แม่"), หรือภาพเหตุการณ์พีค — ห้ามเปิดเนิบ\n' +
  '2. ตัวเลขเจาะใจ: ถ้าในข้อมูลมีตัวเลข (อายุ/จำนวนปี/เงิน/ระยะทาง) ต้องชูให้เด่นแบบ "ปั่นจักรยาน 14 กิโลฯ เพื่อเงิน 20 บาท" — ใช้เฉพาะตัวเลขที่มีจริง ห้ามแต่ง\n' +
  '3. วลีลายเซ็นชวนแชร์ 1-2 จุดต่อโพสต์ (เลือกที่เข้ากับเรื่อง): "ไม่แปลกใจเลยที่...", "ขอนับถือใจ...", "ดีใจแทน...", "ใครจะคิดว่า..."\n' +
  '4. จังหวะโพสต์เฟซบุ๊ก: บรรทัดสั้นสลับยาว ขึ้นบรรทัดใหม่บ่อยกว่าบทความ — ประโยคทุบให้อยู่บรรทัดของมันเอง\n' +
  // ★ 1 ส.ค. 69 (คดีย่อหน้า 3): ข้อ 5 เดิม "จบด้วยสัจธรรม" ชนกฎเขียน "ย่อหน้าสุดท้ายห้ามสรุปข้อคิด" ที่ย่อหน้าเดียวกัน — default ปิด, เปิดคืน VIRAL_TRUISM_ENDING=1
  (process.env.VIRAL_TRUISM_ENDING === '1'
    ? '5. จบด้วยประโยคสัจธรรมสั้นๆ ที่คนอยากก๊อปไปโพสต์ต่อ ("ไม่มีวันไหนยากไปกว่าวันที่...", "คนกตัญญูไม่มีวันล้มจม") — ห้ามจบด้วยคำถาม\n'
    : '5. จบด้วยประโยคบรรยายข้อเท็จจริงเรียบๆ ที่มีน้ำหนัก — ห้ามสรุปเป็นคำสอน/สัจธรรม/คำอวยพร และห้ามจบด้วยคำถาม\n') +
  '=== จบ VIRAL STYLE PACK ===\n\n';

// map หมวดจาก breakdown → หมวดหอสมุด
// ★ 7 ส.ค. 69: เติม 6 หมวดล่างที่มีในคลังจริง (17 ใบ) แต่โค้ดเดิมไม่รู้จัก = ไร้ทางเข้าถาวร
const CATEGORY_HINTS = [
  { lib: 'ดราม่าครอบครัว', keys: ['ครอบครัว', 'แม่', 'พ่อ', 'ลูก', 'พี่น้อง', 'ดราม่า'] },
  { lib: 'ข่าวเศร้า', keys: ['เศร้า', 'สูญเสีย', 'เสียชีวิต', 'อาลัย', 'จากไป'] },
  { lib: 'ข่าวการเมือง', keys: ['การเมือง', 'เลือกตั้ง', 'รัฐบาล', 'นายก', 'พรรค'] },
  { lib: 'ช่วยเหลือกัน', keys: ['ช่วยเหลือ', 'บริจาค', 'น้ำใจ', 'เสียสละ', 'มูลนิธิ', 'จิตอาสา'] },
  { lib: 'สู้ชีวิต', keys: ['สู้ชีวิต', 'ลำบาก', 'ยากจน', 'ฝ่าฟัน', 'โรค', 'ป่วย'] },
  { lib: 'ข่าวบันเทิง', keys: ['ดารา', 'บันเทิง', 'คนดัง', 'ศิลปิน', 'นักแสดง'] },
  { lib: 'พลิกชีวิต', keys: ['พลิกชีวิต', 'สำเร็จ', 'จากศูนย์', 'เปลี่ยนชีวิต', 'รวย'] },
  { lib: 'ข่าวเตือนใจ', keys: ['เตือนใจ', 'เตือนภัย', 'บทเรียน', 'อุทาหรณ์'] },
  // ★ Sol จับได้: ห้ามใช้คีย์ 'หมา' — เป็นท่อนย่อยของ กฎหมาย/หมายเลข/หมายจับ (ข่าวกฎหมายจะได้ตัวอย่างสัตว์)
  { lib: 'ความรักสัตว์', keys: ['สัตว์', 'สุนัข', 'แมว', 'ช้าง', 'สัตว์เลี้ยง', 'ลูกหมา', 'น้องหมา'] },
  { lib: 'ข่าวชาวบ้าน', keys: ['ชาวบ้าน', 'ชุมชน', 'หมู่บ้าน', 'ตลาด', 'ท้องถิ่น', 'วิถีชีวิต'] },
  { lib: 'ข่าวกีฬา', keys: ['กีฬา', 'นักกีฬา', 'ฟุตบอล', 'วอลเลย์บอล', 'แข่งขัน', 'เหรียญ', 'ทีมชาติ'] },
  { lib: 'คนดังตกต่ำ', keys: ['ตกต่ำ', 'ตกอับ', 'ล้มละลาย', 'หมดตัว', 'ชีวิตดิ่ง'] },
  { lib: 'nostalgia', keys: ['ย้อนวัย', 'วันวาน', 'ความทรงจำ', 'คิดถึงอดีต', 'สมัยก่อน', 'ตำนาน'] },
  { lib: 'moral conflict', keys: ['ศีลธรรม', 'ถูกผิด', 'จริยธรรม', 'ประเด็นถกเถียง', 'ดราม่าสังคม'] },
];

// ★ 7 ส.ค. 69: แคชเก็บ "รายการ top-N" ต่อหมวด (ของเดิมเก็บผิดรูป — cached.at ไม่มีจริง แคชเลยไม่เคยติด)
//   การสุ่มเกิดใหม่ทุกครั้งจากรายการแคช = DB โหลดเท่าเดิม แต่ตัวอย่างหมุนทุกข่าว
let _cache = new Map(); // libCat → { rows, at }
const CACHE_MS = 10 * 60 * 1000;

// ★ สวิตช์ถอย: VIRAL_ROTATE=0 = พฤติกรรมเดิมเป๊ะ (หยิบ 2 ใบไลก์สูงสุดตายตัว)
const _rotateOn = () => process.env.VIRAL_ROTATE !== '0';

/**
 * 📒 สมุดประวัติการหยิบ (8 ส.ค. 69 เจ้าของสั่ง "เก็บประวัติแม่นยำ ตัวไหนถูกเรียก")
 * จดลง Supabase store_items/viral_pick_history: ใบไหน (id+ชื่อ) · หมวด · ขนาดโผ · หัวข่าว · เวลา
 * อ่านผ่าน GET /api/viral-library?action=pick-history หรือ ?action=pick-stats
 * fail-safe แท้: จดไม่สำเร็จ = log แล้วเดินต่อ ห้ามล้มท่อข่าวเด็ดขาด
 */
async function _recordPickHistory(libCat, picks, meta = {}) {
  try {
    const sb = getSupabase();
    if (!sb || !picks.length || meta.noHistory) return;
    const nowIso = new Date().toISOString();
    const id = 'vpick_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    // ★ ผู้ตรวจจับได้ (บทเรียนซ้ำรอย "ตำราว่างเงียบๆ" 2 ส.ค.): supabase-js ไม่ throw เมื่อ insert ล้ม —
    //   มันคืน { error } เงียบๆ ต้องเช็คเองไม่งั้นสมุดว่างโดยไม่มีใครรู้ (catch ข้างล่างเป็นตาข่ายชั้นสองเท่านั้น)
    const { error: insErr } = await sb.from('store_items').insert({
      id, store_name: 'viral_pick_history',
      data: {
        ts: nowIso, lib: libCat, poolSize: Number(meta.poolSize) || 0,
        newsTitle: String(meta.newsTitle || '').slice(0, 140),
        mode: String(meta.pickMode || ''), reason: String(meta.pickReason || '').slice(0, 240),
        picks: picks.map((p) => ({ id: p.id ?? null, title: String(p.title || '').slice(0, 120) })),
      },
      created_at: nowIso, updated_at: nowIso,
    });
    if (insErr) console.log('[ViralFewshot] 📒 จดประวัติไม่สำเร็จ (ไม่กระทบข่าว):', String(insErr.message || insErr.code || '').slice(0, 60));
  } catch (e) {
    console.log('[ViralFewshot] 📒 จดประวัติไม่สำเร็จ (ไม่กระทบข่าว):', e.message?.slice(0, 40));
  }
}

/**
 * สุ่มถ่วงน้ำหนักตามยอดไลก์ ไม่คืนซ้ำ — "คุณภาพนำ ทุกใบมีสิทธิ์"
 * แยก rand ออกเป็นพารามิเตอร์เพื่อให้ข้อสอบคุมผลได้ (ฟังก์ชันล้วน เทสได้ 100%)
 */
export function weightedSample(rows, n = 2, rand = Math.random) {
  const pool = [...(rows || [])];
  const out = [];
  while (out.length < n && pool.length > 0) {
    const total = pool.reduce((s, r) => s + Math.max(1, Number(r.engagement_likes) || 1), 0);
    let roll = rand() * total;
    let idx = pool.length - 1; // กันเศษทศนิยมหลุดปลายลูป
    for (let i = 0; i < pool.length; i++) {
      roll -= Math.max(1, Number(pool[i].engagement_likes) || 1);
      if (roll <= 0) { idx = i; break; }
    }
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

export function pickLibraryCategory({ category = '', emotionalTags = [], archetype = '' }) {
  const hay = [category, archetype, ...emotionalTags].join(' ').toLowerCase();
  let best = null, bestScore = 0;
  for (const c of CATEGORY_HINTS) {
    // ★ Sol จับได้: นับคะแนนตาม "ความยาวคีย์ที่แมตช์" — คีย์ยาว = เฉพาะเจาะจงกว่า ต้องชนะคีย์สั้นที่ซ้อนกัน
    //   (เดิมนับ 1 เท่ากันหมด → "ดราม่าสังคม" เสมอ "ดราม่า" แล้วหมวดที่มาก่อนในตารางชนะเสมอ)
    const score = c.keys.reduce((s, k) => s + (hay.includes(k.toLowerCase()) ? k.length : 0), 0)
      + (hay.includes(c.lib.toLowerCase()) ? c.lib.length * 2 : 0);
    if (score > bestScore) { bestScore = score; best = c.lib; }
  }
  return best || 'ดราม่าครอบครัว'; // หมวดใหญ่สุดของหอสมุดเป็น default
}

// ═══ 🎯 8 ส.ค. 69 เจ้าของสั่ง "ห้ามสุ่ม — ต้องแมชโครงเรื่อง/อารมณ์/แนวทางจริง มีเหตุผลรองรับ" ═══
// สวิตช์: VIRAL_MATCH_MODE = '' (แบบเดิม) | 'ai' (วิธี 1 บรรณารักษ์ luna อ่านเนื้อดิบ+สารบัญ เลือกพร้อมเหตุผล)
//                            | 'score' (วิธี 2 โค้ดให้คะแนนแมชจากบัตรลักษณะ — นิ่ง อธิบายได้ ไม่ใช้ AI)
// ล้มทุกทาง → ถอยพฤติกรรมเดิมอัตโนมัติ (fail-safe) · บัตรลักษณะ: data/viral-essences.json (สกัดครั้งเดียวด้วย luna)
// ★ ผู้ตรวจจับได้: ค่าขยะ (พิมพ์ผิด 'AI'/'on') ต้องเท่ากับปิด ไม่ใช่หลุดไปสุ่มข้ามหมวดเงียบๆ
const _matchMode = () => {
  const v = String(process.env.VIRAL_MATCH_MODE || '').trim().toLowerCase();
  return (v === 'ai' || v === 'score') ? v : '';
};

let _essCache = null;
function _loadEssences() {
  if (_essCache) return _essCache;
  try {
    _essCache = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'viral-essences.json'), 'utf8'));
  } catch { _essCache = {}; }
  return _essCache;
}

/**
 * วิธี 2 (โค้ดล้วน ห้ามสุ่ม): ให้คะแนนความแมชข่าว↔ตัวอย่างจากบัตรลักษณะ — ผลนิ่ง 100% พร้อมเหตุผลแจกแจง
 * อารมณ์ตรง ×3 · ธีมตรง ×2 · หมวดตรง +2 · โทนตรง +1 — เสมอกันตัดสินด้วย id (ไม่มีสุ่มเด็ดขาด)
 */
export function scoreMatchExamples(brief = {}, rows = [], essences = {}) {
  const hay = [brief.title, brief.category, (brief.emotionalTags || []).join(' '), brief.archetype, brief.coreStory, brief.excerpt]
    .join(' ').toLowerCase();
  const scored = rows.map((r) => {
    const e = essences[r.id] || {};
    const hitsEmo = (e.emotion || []).filter((w) => w && hay.includes(String(w).toLowerCase()));
    const hitsTheme = (e.themes || []).filter((w) => w && String(w).length >= 2 && hay.includes(String(w).toLowerCase()));
    const toneHit = !!(e.tone && hay.includes(String(e.tone).toLowerCase()));
    const catHit = !!(brief.libCat && r.category === brief.libCat);
    const score = hitsEmo.length * 3 + hitsTheme.length * 2 + (toneHit ? 1 : 0) + (catHit ? 2 : 0);
    return { r, score, hitsEmo, hitsTheme, toneHit, catHit };
  }).sort((a, b) => b.score - a.score || String(a.r.id).localeCompare(String(b.r.id)));
  return scored.slice(0, 2).filter((x) => x.score > 0).map((x) => ({
    row: x.r, score: x.score,
    reason: `คะแนน ${x.score}: ` + [
      x.hitsEmo.length ? `อารมณ์ตรง(${x.hitsEmo.join(',')})` : '',
      x.hitsTheme.length ? `ธีมตรง(${x.hitsTheme.join(',')})` : '',
      x.toneHit ? 'โทนตรง' : '', x.catHit ? 'หมวดตรง' : '',
    ].filter(Boolean).join(' · '),
  }));
}

/**
 * วิธี 1 (บรรณารักษ์ AI): luna อ่าน "เนื้อดิบจริง + แก่นเรื่อง + อารมณ์" เทียบสารบัญทั้งคลัง 202 ใบ
 * เลือก 2 ใบที่เหมาะเป็นครูสอนวิธีเล่า พร้อมเหตุผล — ข้ามพรมแดนหมวดได้ (แก้เคสจับหมวดเพี้ยนไปในตัว)
 */
async function aiMatchExamples(brief, rows, essences) {
  if (!rows?.length) return null; // ★ ผู้ตรวจจับได้: คลังว่าง = ห้ามเสียเงินยิง AI กับสารบัญเปล่า
  const catalog = rows.map((r) => {
    const e = essences[r.id] || {};
    return `${r.id} | ${r.category} | ${String(r.title).slice(0, 55)} | อารมณ์:${(e.emotion || []).join(',')} | โทน:${e.tone || '?'} | ธีม:${(e.themes || []).slice(0, 4).join(',')}`;
  }).join('\n');
  const { callAI } = await import('../ai/openai.js');
  const res = await callAI({
    // ★ ผู้ตรวจจับได้ (บทเรียนเดียวกับสมองเลือกการ์ด 201 ใบ): luna เป็น reasoning model —
    //   สารบัญใหญ่ + เพดานต่ำ = ตอบว่างเปล่า ต้องให้เพดาน 8000 (2500 ยังเคยว่าง)
    model: 'gpt-5.6-luna', temperature: 0.1, maxTokens: 8000,
    prompt: 'คุณคือบรรณารักษ์คลังโพสต์ไวรัล เลือกตัวอย่าง 2 ใบที่ "เหมาะเป็นครูสอนวิธีเล่า" ให้ข่าวนี้ที่สุด\n' +
      'เกณฑ์เรียงสำคัญ: อารมณ์ตรง > โครงเรื่อง/สถานการณ์คล้าย > ธีมตรง — ห้ามเลือกแบบไม่มีเหตุผล\n' +
      `=== ข่าวที่จะเขียน ===\nหัว: ${brief.title}\nอารมณ์: ${(brief.emotionalTags || []).join(', ')} | แนว: ${brief.archetype || '-'}\n` +
      `แก่นเรื่อง: ${String(brief.coreStory || '').slice(0, 250)}\nเนื้อดิบ: ${String(brief.excerpt || '').slice(0, 900)}\n` +
      `=== สารบัญคลัง (id | หมวด | ชื่อ | อารมณ์ | โทน | ธีม) ===\n${catalog}\n=== จบ ===\n` +
      'ตอบ JSON เท่านั้น: {"picks":["id1","id2"],"reason":"เหตุผลสั้น 1-2 ประโยคว่าทำไมสองใบนี้เหมาะกับข่าวนี้"}',
  });
  const ids = [...new Set(Array.isArray(res?.picks) ? res.picks.map(String) : [])]; // dedupe — luna คืน id ซ้ำได้
  const chosen = ids.map((id) => rows.find((r) => String(r.id) === id)).filter(Boolean).slice(0, 2);
  if (!chosen.length) return null;
  return { picks: chosen, reason: String(res?.reason || '').slice(0, 220) };
}

/**
 * @returns {Promise<string>} บล็อกพร้อมแปะเข้าพรอมต์ writer (Style Pack + ตัวอย่างจริง 2 โพสต์)
 */
export async function getViralFewshotBlock({ category = '', emotionalTags = [], archetype = '', newsTitle = '', newsBrief = null, noHistory = false } = {}) {
  const libCat = pickLibraryCategory({ category, emotionalTags, archetype });

  let examplesBlock = '';
  try {
    // ── ขั้น 1: เอารายการโพสต์ (แคช 10 นาที) — โหมดจับคู่ต้องเห็น "ทั้งคลัง" (ข้ามหมวดได้) · โหมดเดิมเห็นแค่หมวด ──
    const mode = _matchMode();
    const cacheKey = mode ? '__all__' : libCat;
    let rows = null;
    const cached = _cache.get(cacheKey);
    if (cached && cached.rows && Date.now() - cached.at < CACHE_MS) {
      rows = cached.rows;
    } else {
      const sb = getSupabase();
      if (sb) {
        let q = sb.from('viral_examples')
          .select('id, title, content, writing_notes, category, engagement_likes')
          .order('engagement_likes', { ascending: false });
        q = mode ? q.limit(300) : q.eq('category', libCat).limit(_rotateOn() ? 100 : 6); // ★ 8 ส.ค. 69: โหมดจับคู่=ทั้งคลัง · โหมดเดิม=ทั้งหมวด (ใหญ่สุดจริง 64 ใบ)
        const { data } = await q;
        rows = (data || []).filter(r => (r.content || '').length > 200);
        _cache.set(cacheKey, { rows, at: Date.now() });
        if (_cache.size > 30) _cache = new Map([..._cache].slice(-15));
      }
    }

    // ── ขั้น 2: เลือก 2 ใบ ──
    //   โหมดจับคู่ (เจ้าของสั่ง 8 ส.ค. "ห้ามสุ่ม"): ai → บรรณารักษ์เลือกพร้อมเหตุผล · score → คะแนนแมชนิ่งๆ
    //   ล้มทุกชั้น → ถอยหมุนเวียนแบบเดิม (fail-safe — ดีกว่าไม่มีตัวอย่างเลย และถูกจดใน history ว่า fallback)
    let picks = [];
    let pickMode = _rotateOn() ? 'rotate' : 'top2';
    let pickReason = '';
    if (mode === 'ai' || mode === 'score') {
      const brief = { title: newsTitle, category, emotionalTags, archetype, libCat,
        coreStory: newsBrief?.coreStory || '', excerpt: newsBrief?.excerpt || '' };
      const ess = _loadEssences();
      if (mode === 'ai') {
        try {
          const m = await aiMatchExamples(brief, rows || [], ess);
          if (m) { picks = m.picks; pickReason = m.reason; pickMode = 'ai'; }
        } catch (e) { console.log('[ViralFewshot] 🎯 ai-match ล้ม (จะถอยชั้นถัดไป):', e.message?.slice(0, 40)); }
      }
      if (!picks.length) {
        const m2 = scoreMatchExamples(brief, rows || [], ess);
        if (m2.length) {
          picks = m2.map((x) => x.row);
          pickReason = m2.map((x, i) => `ใบ${i + 1} ${x.reason}`).join(' | ');
          pickMode = mode === 'ai' ? 'score-fallback' : 'score';
        }
      }
    }
    if (!picks.length) {
      // ★ ผู้ตรวจจับได้: fallback ในโหมดจับคู่ต้องสุ่มเฉพาะ "หมวดเดียวกับข่าว" (โผ __all__ ข้ามหมวด —
      //   สุ่มทั้งคลังอาจได้ตัวอย่างบันเทิงให้ข่าวเศร้า) · หมวดว่างจริงค่อยยอมทั้งคลัง
      const pool = mode ? (rows || []).filter((r) => r.category === libCat) : (rows || []);
      const usable = pool.length ? pool : (rows || []);
      picks = _rotateOn() ? weightedSample(usable, 2) : usable.slice(0, 2);
      if (mode) pickMode = 'rotate-fallback';
    }
    if (picks.length > 0) {
      // ★ ผู้ตรวจจับได้: โหมดจับคู่เลือกข้ามหมวดได้ — หัวบล็อกห้ามประกาศหมวดผิดๆ ให้นักเขียน
      const blockTitle = (pickMode === 'ai' || pickMode === 'score' || pickMode === 'score-fallback')
        ? 'โพสต์ไวรัลจริงที่จับคู่กับข่าวนี้ (โครงเรื่อง/อารมณ์ใกล้เคียง)'
        : `โพสต์ไวรัลจริงหมวด "${libCat}" จากเพจ`;
      examplesBlock =
        `=== 📚 ${blockTitle} (เลียนแบบ "จังหวะ-โครง-น้ำเสียง" เท่านั้น — ห้ามลอกเนื้อหา/ชื่อ/เหตุการณ์) ===\n` +
        picks.map((r, i) =>
          `--- ตัวอย่าง ${i + 1} ---\n${String(r.content).slice(0, 700)}\n` +
          (r.writing_notes ? `(จุดที่ทำให้ไวรัล: ${String(r.writing_notes).replace(/🔥 ทำไมถึง viral:\s*/, '').slice(0, 180)})\n` : '')
        ).join('\n') +
        `=== จบตัวอย่างไวรัลจริง ===\n\n`;
      console.log(`[ViralFewshot] ✅ ${picks.length} ตัวอย่าง [${pickMode}] จากโผ ${(rows || []).length} ใบ${pickReason ? ` | เหตุผล: ${pickReason.slice(0, 90)}` : ''} (ข่าว: ${String(newsTitle || category || '?').slice(0, 40)})`);
      // 📒 8 ส.ค. 69 เจ้าของสั่ง: จดสมุดประวัติถาวร — ข่าวไหนได้ตัวอย่างใบไหน + วิธีเลือก + เหตุผล
      await _recordPickHistory(libCat, picks, { poolSize: (rows || []).length, newsTitle, noHistory, pickMode, pickReason });
    } else {
      console.log(`[ViralFewshot] ⚠️ หมวด "${libCat}" ไม่มีตัวอย่างพอ — ใช้ Style Pack อย่างเดียว`);
    }
  } catch (e) {
    console.log('[ViralFewshot] ⚠️ fetch failed (non-fatal):', e.message?.slice(0, 50));
  }

  return VIRAL_STYLE_PACK + examplesBlock;
}
