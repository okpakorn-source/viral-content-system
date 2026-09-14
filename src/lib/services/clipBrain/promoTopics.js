/**
 * 🎬 clipBrain/promoTopics.js — หัวข้อ "โปรโมตของรายการ" ไม่ใช่เนื้อข่าว (P13 · 14 ก.ย. 69 เจ้าของสั่ง)
 * ------------------------------------------------------------------
 * แยก 2 ระดับ (พิสูจน์กับหัวข้อจริง 2,021 แถวในคลัง — ตัวกรองแบบคำเดียวจับเนื้อข่าวผิด เช่น
 * "ประสบการณ์เล่นโฆษณา" "ช่องทางบริจาค…และปิดรายการ" "นนท์มอบของขวัญ…และปิดรายการ"):
 *   'external' = โปรโมตเนื้อหาอื่น/นอกคลิป: ตัวอย่างช่วงต่อไป/ตอนหน้า · โฆษณาล้วน · คำชวนติดตามล้วน
 *                → ตัดออกจากหลักฐานที่ส่งให้แต่งเรื่อง + พรอมต์ "ห้ามเขียนถึง" + ไม่นับว่าหาย
 *   'internal' = โครงรายการล้วนๆ ของคลิปนี้: เปิดรายการ/ปิดรายการ/ไฮไลท์เปิด/ไตเติล/เพลงประจำรายการ ที่ไม่มีเนื้อหาอื่นปน
 *                → แค่ไม่นับว่าหาย (หลักฐานคงเดิม) เพราะ AI-summary แถวนี้ไม่มีเนื้อ
 *   null       = เนื้อหา (รวมแถวผสม เช่น "…และปิดรายการ" ที่มีเนื้อหาจริงอยู่ด้วย) → พฤติกรรมเดิมทุกประการ
 *
 * env: CLIP_PROMO_TOPIC_FILTER='0' ปิดทั้งหมด · CLIP_PROMO_TOPIC_EXTRA='คำ1|คำ2' คำตรงตัวที่ถือเป็นโปรโมตนอกคลิป (external)
 */

// โปรโมตเนื้อหาอื่น — ตัดสินได้จากวลี ไม่ต้องดูส่วนที่เหลือ (ส่วนที่เหลือคือเนื้อของตอนหน้า ไม่ใช่ของคลิปนี้)
const TEASER_PATTERNS = Object.freeze([
  /ตัวอย่าง(?:\s*(?:ช่วง|รายการ|ไฮไล[ทต]์?|ตอน|เนื้อหา|อีพี)){1,3}\s*(?:ต่อไป|ถัดไป|หน้า)/u,
  /ช่วง(?:ต่อไป|ถัดไป)ของรายการ|ตอนต่อไป|ตอนหน้า|สัปดาห์หน้า|คราวหน้า|อีพีหน้า|ep\.?\s*หน้า/u,
  /(?:พบกัน|เจอกัน)(?:ใหม่)?(?:ใน)?(?:ตอน|สัปดาห์|ครั้ง|คราว)หน้า/u,
]);
// โฆษณา / คำชวนติดตาม — ถือเป็นโปรโมตเมื่อ "ล้วนๆ" (ส่วนที่เหลือหลังตัดวลีเหล่านี้สั้น)
const AD_PATTERNS = Object.freeze([
  /ช่วง\s*(?:เบรก|คั่น)?\s*(?:โฆษณา|โปรโม[ตท]|สปอนเซอร์)/u, /^(?:เบรก)?โฆษณา/u, /ผู้สนับสนุนรายการ|สปอนเซอร์/u,
  /ติดตามชม|ฝากช่องทาง(?:ติดตาม)?|กดติดตาม|กดไลก์|กดแชร์|กดกระดิ่ง|ห้ามพลาด|อย่าลืม(?:กด)?ติดตาม/u,
]);
// โครงรายการ — ไม่มีเนื้อในตัวเอง
const STRUCTURE_PATTERNS = Object.freeze([
  /(?:เปิด|ปิด)รายการ/u, /ไฮไล[ทต]์?(?:\s*(?:และ)?\s*(?:เปิดรายการ|ประจำ(?:ตอน|สัปดาห์|อีพี|วัน)?|รายการ|ของรายการ))?/u,
  /ตัวอย่าง(?:\s*(?:ช่วง|รายการ|ไฮไล[ทต]์?|เนื้อหา))+/u, /ไตเติล|เพลงประจำรายการ|แนะนำช่วง(?:ต่างๆ|ต่าง ๆ|ในรายการ)|พบกันใหม่|ส่งท้าย(?:รายการ)?/u,
  /(?:แนะนำ|ต้อนรับ)\s*แขกรับเชิญ|ต้อนรับ|แนะนำ(?:เนื้อหา|ตัว)?/u, /บทสรุป|สรุป(?:ข้อคิด|บทเรียน)?/u, /เกริ่น(?:นำ)?/u,
]);
// คำเชื่อม/คำโครงที่ไม่นับเป็นเนื้อ เวลาวัดว่า "ที่เหลือ" มีเนื้อหาไหม
const FILLER_RE = /และ|พร้อม(?:กับ)?|ก่อน|หลังจาก|ประจำ|สัปดาห์|ตอน|ช่วง|รายการ|ของ|กล่าว|พูดคุย|คุยกัน|ต่างๆ|ต่าง ๆ|เนื้อหา|กับ|ใน|ที่|นี้|วันนี้|อีพี|ทาง/gu;

const normalize = (v) => String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim();
const thaiChars = (s) => (String(s).match(/[ก-๙]/gu) || []).length;
const filterOff = () => String(process.env.CLIP_PROMO_TOPIC_FILTER ?? '').trim() === '0';

/** ข้อความหัวข้อจากแถว timeline ทุกรูปทรงที่ระบบใช้ ({topic} / {title} / {text} / string) */
export function promoTopicText(row) {
  if (row == null) return '';
  if (typeof row === 'string') return row;
  if (typeof row !== 'object') return String(row);
  for (const key of ['topic', 'title', 'text', 'point', 'detail']) {
    if (typeof row[key] === 'string' && row[key].trim()) return row[key];
  }
  return '';
}

/** เนื้อที่เหลือหลังตัดวลีโปรโมต/โครงรายการ/คำเชื่อม/อักษรละติน-ตัวเลข (ชื่อรายการภาษาอังกฤษ ชื่อสินค้า) */
function residueOf(s) {
  let r = s;
  for (const re of [...TEASER_PATTERNS, ...AD_PATTERNS, ...STRUCTURE_PATTERNS]) r = r.replace(new RegExp(re.source, 'gu'), ' ');
  r = r.replace(/[a-z0-9]+/giu, ' ').replace(FILLER_RE, ' ').replace(/[^ก-๙]+/gu, ' ');
  return r.replace(/\s+/g, ' ').trim();
}

/**
 * @returns {'external'|'internal'|null}
 *   external = โปรโมตเนื้อหาอื่น (ตัดออก+ห้ามเขียน) · internal = โครงรายการล้วน (แค่ไม่นับว่าหาย) · null = เนื้อหา
 */
export function promoTopicClass(topicOrRow) {
  if (filterOff()) return null;
  const s = normalize(typeof topicOrRow === 'object' ? promoTopicText(topicOrRow) : topicOrRow);
  if (!s) return null;
  // ตัวอย่างช่วงต่อไป: เป็นโปรโมตเมื่อวลีนำหน้า (ส่วนที่เหลือคือเนื้อของตอนหน้า) หรือทั้งแถวมีแต่โครง — ถ้าเนื้อหาของคลิปนี้นำแล้วลงท้ายด้วยตัวอย่าง ถือเป็นเนื้อหา
  const teaserAt = TEASER_PATTERNS.map((re) => s.search(re)).filter((i) => i >= 0);
  if (teaserAt.length) return Math.min(...teaserAt) <= 2 || thaiChars(residueOf(s)) < 6 ? 'external' : null;
  const extra = String(process.env.CLIP_PROMO_TOPIC_EXTRA || '').split('|').map(normalize).filter(Boolean);
  if (extra.some((word) => s.includes(word))) return 'external';
  const isAd = AD_PATTERNS.some((re) => re.test(s));
  const isStructure = STRUCTURE_PATTERNS.some((re) => re.test(s));
  if (!isAd && !isStructure) return null;
  // มีวลีโปรโมต/โครง แต่ยังมีเนื้อหาอื่นปนอยู่ = เนื้อหา (เช่น "นนท์มอบของขวัญ…และปิดรายการ")
  if (thaiChars(residueOf(s)) >= 6) return null;
  return isAd ? 'external' : 'internal';
}

/** จริงเมื่อเป็นโปรโมตเนื้อหาอื่น/โฆษณาล้วน — ใช้ตัดออกจากหลักฐานและบอกผู้แต่ง "ห้ามเขียนถึง" */
export function isPromoTopic(topicOrRow) { return promoTopicClass(topicOrRow) === 'external'; }
/** จริงเมื่อไม่ใช่เนื้อหา (โปรโมตหรือโครงรายการล้วน) — ใช้กับด่าน "ของหาย-ประเด็น" */
export function isNonContentTopic(topicOrRow) { return promoTopicClass(topicOrRow) !== null; }

export const PROMO_TOPIC_PATTERNS = Object.freeze({ teaser: TEASER_PATTERNS, ad: AD_PATTERNS, structure: STRUCTURE_PATTERNS });
