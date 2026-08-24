/**
 * 🏷️ ป้ายสาระการ์ด (Card Essences) — 1 ส.ค. 69 (ชั้น 0 ของระบบสารบัญ 201 ใบ)
 * บรรทัดสรุป "แกนเรื่อง + กติกาเด่น" ต่อการ์ด สร้างครั้งเดียวด้วย scripts/build-card-essences.mjs
 * ใบที่ยังไม่มีป้าย (การ์ดเพิ่มใหม่) → สารบัญใช้ชื่อการ์ดล้วน (ทดลองแล้วยังใช้การได้ แค่คมน้อยกว่า)
 */
import fs from 'fs';
import path from 'path';

let _cache = null;
let _cacheAt = 0;

export function loadCardEssences() {
  // แคช 5 นาที — ไฟล์เปลี่ยนเมื่อรันสคริปต์รีเฟรชเท่านั้น
  if (_cache && Date.now() - _cacheAt < 5 * 60 * 1000) return _cache;
  try {
    const p = path.join(process.cwd(), 'data', 'card-essences.json');
    _cache = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    _cache = {};
  }
  // ★ Opus P1: ถ้าไฟล์หาย (เช่น ไม่ถูก trace ขึ้น Vercel) ต้องมีเสียงเตือน — ไม่งั้นสารบัญจืดลงแบบไม่มีใครรู้
  if (Object.keys(_cache).length === 0) {
    console.warn('[🏷️ CardEssences] ไม่พบป้ายสาระ (data/card-essences.json ว่าง/หาย) — สารบัญจะใช้ชื่อการ์ดล้วน');
  }
  _cacheAt = Date.now();
  return _cache;
}
