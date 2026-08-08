/**
 * =====================================================
 * Viral Few-shot — เรียนสำนวนจากหอสมุดไวรัลจริง 170+ โพสต์
 * =====================================================
 * (11 มิ.ย. — ผู้ใช้เลือก: Few-shot ตามหมวด + สำนวนเพจไวรัลเต็มตัว)
 * ดึงโพสต์ไวรัลจริง "หมวดเดียวกับข่าว" 2 ตัวอย่างใส่พรอมต์ writer
 * + VIRAL STYLE PACK (สูตรที่สกัดจากโพสต์ท็อป: hook/ตัวเลข/วลีลายเซ็น/จังหวะ/จบคม)
 * fail-safe: Supabase ล่ม → ได้ Style Pack อย่างเดียว (ไม่พัง pipeline)
 */

import { getSupabase } from '../supabase.js';

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
  { lib: 'ความรักสัตว์', keys: ['สัตว์', 'สุนัข', 'หมา', 'แมว', 'ช้าง', 'สัตว์เลี้ยง', 'ลูกสัตว์'] },
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
    const score = c.keys.reduce((s, k) => s + (hay.includes(k.toLowerCase()) ? 1 : 0), 0)
      + (hay.includes(c.lib.toLowerCase()) ? 2 : 0);
    if (score > bestScore) { bestScore = score; best = c.lib; }
  }
  return best || 'ดราม่าครอบครัว'; // หมวดใหญ่สุดของหอสมุดเป็น default
}

/**
 * @returns {Promise<string>} บล็อกพร้อมแปะเข้าพรอมต์ writer (Style Pack + ตัวอย่างจริง 2 โพสต์)
 */
export async function getViralFewshotBlock({ category = '', emotionalTags = [], archetype = '' } = {}) {
  const libCat = pickLibraryCategory({ category, emotionalTags, archetype });

  let examplesBlock = '';
  try {
    // ── ขั้น 1: เอารายการ top-N ของหมวด (แคช 10 นาที — ของเดิมแคชพังเงียบ ซ่อมแล้ว) ──
    let rows = null;
    const cached = _cache.get(libCat);
    if (cached && cached.rows && Date.now() - cached.at < CACHE_MS) {
      rows = cached.rows;
    } else {
      const sb = getSupabase();
      if (sb) {
        const { data } = await sb
          .from('viral_examples')
          .select('title, content, writing_notes, category, engagement_likes')
          .eq('category', libCat)
          .order('engagement_likes', { ascending: false })
          .limit(_rotateOn() ? 12 : 6); // ★ 7 ส.ค. 69: เปิดโผกว้างขึ้นเป็น 12 (โหมดเดิม 6)
        rows = (data || []).filter(r => (r.content || '').length > 200);
        _cache.set(libCat, { rows, at: Date.now() });
        if (_cache.size > 30) _cache = new Map([..._cache].slice(-15));
      }
    }

    // ── ขั้น 2: เลือก 2 ใบ — หมุนเวียนถ่วงน้ำหนักไลก์ (VIRAL_ROTATE=0 = top-2 ตายตัวแบบเดิม) ──
    const picks = _rotateOn() ? weightedSample(rows || [], 2) : (rows || []).slice(0, 2);
    if (picks.length > 0) {
      examplesBlock =
        `=== 📚 โพสต์ไวรัลจริงหมวด "${libCat}" จากเพจ (เลียนแบบ "จังหวะ-โครง-น้ำเสียง" เท่านั้น — ห้ามลอกเนื้อหา/ชื่อ/เหตุการณ์) ===\n` +
        picks.map((r, i) =>
          `--- ตัวอย่าง ${i + 1} ---\n${String(r.content).slice(0, 700)}\n` +
          (r.writing_notes ? `(จุดที่ทำให้ไวรัล: ${String(r.writing_notes).replace(/🔥 ทำไมถึง viral:\s*/, '').slice(0, 180)})\n` : '')
        ).join('\n') +
        `=== จบตัวอย่างไวรัลจริง ===\n\n`;
      console.log(`[ViralFewshot] ✅ ${picks.length} ตัวอย่างหมวด "${libCat}"${_rotateOn() ? ` (หมุนเวียนจากโผ ${(rows || []).length} ใบ)` : ''} (จาก ${category || '?'} / ${emotionalTags.slice(0, 2).join(',')})`);
    } else {
      console.log(`[ViralFewshot] ⚠️ หมวด "${libCat}" ไม่มีตัวอย่างพอ — ใช้ Style Pack อย่างเดียว`);
    }
  } catch (e) {
    console.log('[ViralFewshot] ⚠️ fetch failed (non-fatal):', e.message?.slice(0, 50));
  }

  return VIRAL_STYLE_PACK + examplesBlock;
}
