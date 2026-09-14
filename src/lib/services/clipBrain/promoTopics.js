/**
 * 🎬 clipBrain/promoTopics.js — หัวข้อ "โปรโมตของรายการ" ไม่ใช่เนื้อข่าว (P13 · 14 ก.ย. 69 เจ้าของสั่ง)
 * ------------------------------------------------------------------
 * ตัวอย่างช่วงต่อไป / ไฮไลท์เปิด-ปิดรายการ / โฆษณา / คำชวนติดตาม ที่แผนที่ประเด็น (ตาเห็น) จับมาเป็น timeline
 * ถูกใช้ 3 ที่: ① ตัดออกจากหลักฐานที่ส่งให้แต่งเรื่อง (topicEvidence) ② ไม่นับเป็น "ของหาย-ประเด็น" (clipVerify)
 * ③ บอกผู้แต่งในพรอมต์ว่าช่วงไหนถูกตัด (composeTopics)
 *
 * บทเรียนงานจริง 14 ก.ย.: ช่วงตัวอย่างรายการ 25 วินาทีท้ายคลิป TODAYSHOW ถูก Gemini แต่งเป็นเรื่องยาว 8 ประโยค
 * (น้ำท่วมภาคเหนือ ฮิโนกิแลนด์ เจ้าของมาออกรายการ) ซึ่งเป็นโปรโมต ไม่ใช่ข่าว
 *
 * env: CLIP_PROMO_TOPIC_FILTER='0' ปิดตัวกรอง · CLIP_PROMO_TOPIC_EXTRA='คำ1|คำ2' เพิ่มคำที่ถือเป็นโปรโมต (ตรงตัว ไม่ใช่ regex)
 */

const PROMO_PATTERNS = Object.freeze([
  /ตัวอย่าง\s*(?:ช่วง|รายการ|ไฮไล[ทต]์?|ตอนต่อไป|ตอนหน้า)/u,
  /ไฮไล[ทต]์?\s*(?:เปิด|ปิด|ประจำ|ช่วง|ของรายการ|รายการ|สัปดาห์|วันนี้|ต่อไป)/u,
  /(?:เปิด|ปิด)รายการ/u,
  /แนะนำช่วง(?:ต่างๆ|ต่าง ๆ|ในรายการ|ถัดไป|ต่อไป)/u,
  /ช่วงต่อไปของรายการ|ช่วงถัดไปของรายการ|ตอนต่อไป|ตอนหน้า|สัปดาห์หน้า|คราวหน้า/u,
  /โปรโม[ตท]|โฆษณา|สปอนเซอร์|ผู้สนับสนุนรายการ/u,
  /ติดตามชม|ห้ามพลาด|พบกันใหม่|อย่าลืมกดติดตาม|กดไลก์|กดแชร์|กดกระดิ่ง/u,
]);

const normalize = (v) => String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim();

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

/** จริงเมื่อหัวข้อนี้เป็นโปรโมตของรายการ — เทียบเฉพาะข้อความหัวข้อ ไม่ดูเวลา */
export function isPromoTopic(topicOrRow) {
  if (String(process.env.CLIP_PROMO_TOPIC_FILTER ?? '').trim() === '0') return false;
  const s = normalize(typeof topicOrRow === 'object' ? promoTopicText(topicOrRow) : topicOrRow);
  if (!s) return false;
  if (PROMO_PATTERNS.some((re) => re.test(s))) return true;
  const extra = String(process.env.CLIP_PROMO_TOPIC_EXTRA || '').split('|').map(normalize).filter(Boolean);
  return extra.some((word) => s.includes(word));
}

export const PROMO_TOPIC_PATTERNS = PROMO_PATTERNS;
