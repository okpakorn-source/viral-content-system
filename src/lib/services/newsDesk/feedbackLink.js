/**
 * 🔥🧊 Feedback Link — ลิงก์รายงานผลโพสต์คลิกเดียวจาก Discord (2 ก.ค. 69)
 * ที่มา: ลูปเรียนรู้ปัง/แป้กตายสนิท (feedback 730 รายการ → viral=0, flop=0) เพราะปุ่มอยู่บนเว็บที่ไม่มีใครกด
 *   → ย้ายจุดกดไปที่ Discord: ข้อความ "เช็กผลโพสต์" มีลิงก์ 🔥ปัง/🧊แป้ก ต่อข่าว คลิกแล้วบันทึกทันที
 * ความปลอดภัย: ลิงก์ลงนาม HMAC (กันยิง feedback มั่วจากคนนอก) — ไม่ต้องล็อกอิน คลิกเดียวจบ
 * 🔴 ใช้เฉพาะโต๊ะข่าวกลาง
 */
import crypto from 'crypto';

function secret() {
  // ใช้ env เฉพาะถ้ามี → fallback คีย์ที่มีอยู่แล้วทุก deploy (Railway/Vercel แชร์ค่าเดียวกัน)
  return process.env.DESK_FEEDBACK_SECRET || process.env.SERPER_API_KEY || process.env.OPENAI_API_KEY || 'desk-fb-2026';
}

/** ลายเซ็นของ (newsId, action) — 16 ตัวอักษรพอ (กันเดา ไม่ใช่กันรัฐบาล) */
export function signFeedback(id, action) {
  return crypto.createHmac('sha256', secret()).update(`${id}|${action}`).digest('hex').slice(0, 16);
}

export function verifyFeedback(id, action, key) {
  if (!id || !action || !key) return false;
  const expect = signFeedback(id, action);
  try { return crypto.timingSafeEqual(Buffer.from(String(key)), Buffer.from(expect)); }
  catch { return false; }
}

/** สร้างคู่ลิงก์ 🔥/🧊 สำหรับข่าวหนึ่งใบ */
export function feedbackLinks(origin, id) {
  const mk = (a) => `${origin}/api/news-desk/feedback?id=${encodeURIComponent(id)}&a=${a}&k=${signFeedback(id, a)}`;
  return { viral: mk('viral'), flop: mk('flop') };
}
