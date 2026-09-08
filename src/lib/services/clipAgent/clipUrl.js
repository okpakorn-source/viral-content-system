/**
 * ล้างลิงก์คลิปให้เป็นรูปเดียวกับที่คลังเก็บ (Fable 8 ก.ย. 69)
 *   คลัง clip-insights / clip-transcripts เก็บ record.url = cleanClipUrl(raw) (ดู src/app/api/clip-transcript/insight/route.js:150
 *   และ src/app/api/clip-transcript/route.js:23) → เอเจนต์ส่ง youtu.be/shorts/ลิงก์ติด fbclid มาค้น ต้องล้างก่อนเทียบ
 *   สำเนาตรรกะเดียวกับต้นทาง (ต้นทางอยู่ในไฟล์ route ที่ import แล้วลากของหนักมาด้วย จึงไม่ import ตรง) — ถ้าแก้ต้นทาง ให้แก้ที่นี่ด้วย
 */
export function cleanClipUrl(raw) {
  const u = String(raw || '').trim();
  const yt = u.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (yt) return `https://www.youtube.com/watch?v=${yt[1]}`;
  try {
    const url = new URL(u);
    ['fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'si', 'feature', 'app_id', '_aem', 'mibextid'].forEach(p => url.searchParams.delete(p));
    return url.toString();
  } catch { return u.split('#')[0]; }
}
