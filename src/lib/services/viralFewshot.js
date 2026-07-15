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
  '5. จบด้วยประโยคสัจธรรมสั้นๆ ที่คนอยากก๊อปไปโพสต์ต่อ ("ไม่มีวันไหนยากไปกว่าวันที่...", "คนกตัญญูไม่มีวันล้มจม") — ห้ามจบด้วยคำถาม\n' +
  '=== จบ VIRAL STYLE PACK ===\n\n';

// map หมวดจาก breakdown → หมวดหอสมุด
const CATEGORY_HINTS = [
  { lib: 'ดราม่าครอบครัว', keys: ['ครอบครัว', 'แม่', 'พ่อ', 'ลูก', 'พี่น้อง', 'ดราม่า'] },
  { lib: 'ข่าวเศร้า', keys: ['เศร้า', 'สูญเสีย', 'เสียชีวิต', 'อาลัย', 'จากไป'] },
  { lib: 'ข่าวการเมือง', keys: ['การเมือง', 'เลือกตั้ง', 'รัฐบาล', 'นายก', 'พรรค'] },
  { lib: 'ช่วยเหลือกัน', keys: ['ช่วยเหลือ', 'บริจาค', 'น้ำใจ', 'เสียสละ', 'มูลนิธิ', 'จิตอาสา'] },
  { lib: 'สู้ชีวิต', keys: ['สู้ชีวิต', 'ลำบาก', 'ยากจน', 'ฝ่าฟัน', 'โรค', 'ป่วย'] },
  { lib: 'ข่าวบันเทิง', keys: ['ดารา', 'บันเทิง', 'คนดัง', 'ศิลปิน', 'นักแสดง'] },
  { lib: 'พลิกชีวิต', keys: ['พลิกชีวิต', 'สำเร็จ', 'จากศูนย์', 'เปลี่ยนชีวิต', 'รวย'] },
  { lib: 'ข่าวเตือนใจ', keys: ['เตือนใจ', 'เตือนภัย', 'บทเรียน', 'อุทาหรณ์'] },
];

let _cache = new Map(); // category → { block, at }
const CACHE_MS = 10 * 60 * 1000;

function pickLibraryCategory({ category = '', emotionalTags = [], archetype = '' }) {
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

  const cached = _cache.get(libCat);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.block;

  let examplesBlock = '';
  try {
    const sb = getSupabase();
    if (sb) {
      const { data } = await sb
        .from('viral_examples')
        .select('title, content, writing_notes, category, engagement_likes')
        .eq('category', libCat)
        .order('engagement_likes', { ascending: false })
        .limit(6);

      const picks = (data || []).filter(r => (r.content || '').length > 200).slice(0, 2);
      if (picks.length > 0) {
        examplesBlock =
          `=== 📚 โพสต์ไวรัลจริงหมวด "${libCat}" จากเพจ (เลียนแบบ "จังหวะ-โครง-น้ำเสียง" เท่านั้น — ห้ามลอกเนื้อหา/ชื่อ/เหตุการณ์) ===\n` +
          picks.map((r, i) =>
            `--- ตัวอย่าง ${i + 1} ---\n${String(r.content).slice(0, 700)}\n` +
            (r.writing_notes ? `(จุดที่ทำให้ไวรัล: ${String(r.writing_notes).replace(/🔥 ทำไมถึง viral:\s*/, '').slice(0, 180)})\n` : '')
          ).join('\n') +
          `=== จบตัวอย่างไวรัลจริง ===\n\n`;
        console.log(`[ViralFewshot] ✅ ${picks.length} ตัวอย่างหมวด "${libCat}" (จาก ${category || '?'} / ${emotionalTags.slice(0, 2).join(',')})`);
      } else {
        console.log(`[ViralFewshot] ⚠️ หมวด "${libCat}" ไม่มีตัวอย่างพอ — ใช้ Style Pack อย่างเดียว`);
      }
    }
  } catch (e) {
    console.log('[ViralFewshot] ⚠️ fetch failed (non-fatal):', e.message?.slice(0, 50));
  }

  const block = VIRAL_STYLE_PACK + examplesBlock;
  _cache.set(libCat, block);
  if (_cache.size > 30) _cache = new Map([..._cache].slice(-15));
  return block;
}
