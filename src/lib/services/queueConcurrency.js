// ============================================================
// 🧵 src/lib/services/queueConcurrency.js — เพดานงานข่าวที่เขียนพร้อมกันต่อเครื่อง (env QUEUE_NEWS_CONCURRENCY)
// ------------------------------------------------------------
// ★ 2 ต.ค. 69 (ท่อข่าวขนาน · SPEC-v3 ส่วน 11 · W6) — ไฟล์ใหม่ · เจ้าของสั่ง 2 ต.ค. 69 13:30
//   "เวลาต่อข่าวเท่าเดิมได้ แค่อยากให้ไม่ต้องต่อคิวกัน เพราะพนักงานเป็นสิบ"
//   เดิม: ตัวหยิบงานคิวจำกัด 1 งาน/เครื่อง → ข่าวที่ส่งซ้อนกันรอข่าวก่อนหน้าเขียนเสร็จ (~4 นาที/ข่าว)
//   ใหม่: ตั้ง QUEUE_NEWS_CONCURRENCY บน Vercel = จำนวนข่าวที่เขียนพร้อมกันได้ (แต่ละข่าว = 1 invocation ของ worker เหมือนเดิม)
// ผู้ใช้ 2 ที่ — ตัวช่วยตัวเดียวกัน (ห้ามเขียนสูตรอ่าน env ซ้ำในไฟล์อื่น):
//   · src/lib/services/queueService.js getNextPendingJobs → maxConcurrency ของเครื่องที่หยิบงานข่าวได้
//   · src/app/api/queue/status/route.js self-heal → ปลุก worker เมื่อ processing < ค่านี้
// ค่า: ไม่ตั้ง/ว่าง/อ่านไม่ได้/< 1 = 1 (ทีละงาน = พฤติกรรมเดิม) · ทศนิยม = ปัดลง · เพดาน 10 · ตัด space/เครื่องหมายคำพูดหัวท้ายแบบ modes.js
// ไฟล์ pure ไม่มี import และไม่โยน (โหลดได้ทุกที่ — รวมสำเนา data: URL ของเทส tests/queue-parallel.test.mjs)
// ============================================================

/** ค่าเริ่มต้น = ทีละงาน (พฤติกรรมก่อนมี env นี้) */
export const QUEUE_NEWS_CONCURRENCY_DEFAULT = 1;
/** เพดานบน — ตั้งเกิน = บีบลงมาที่ค่านี้ (กันค่าพิมพ์ผิดเปิดงานพร้อมกันจนชน rate limit ของผู้ให้บริการ AI) */
export const QUEUE_NEWS_CONCURRENCY_MAX = 10;

/** = cleanEnv ของ src/lib/research-agent/modes.js (ตัด space + เครื่องหมายคำพูดหัวท้ายที่ติดมาจากการวางค่าใน Vercel) */
const cleanEnv = (raw) => String(raw ?? '').trim().replace(/^["']|["']$/g, '').trim();

/**
 * จำนวนงานข่าวที่เครื่องหนึ่งทำพร้อมกันได้ = QUEUE_NEWS_CONCURRENCY (อ่านจาก env ที่ส่งมาทุกครั้ง · ไม่ cache)
 * @param {object} [env] ค่าเริ่มต้น process.env
 * @returns {number} จำนวนเต็ม 1–10 · ไม่ตั้ง/ว่าง/อ่านไม่ได้/< 1 = 1 · > 10 = 10 · ไม่โยนเสมอ (ผิดพลาด = 1)
 */
export function getNewsConcurrency(env = process.env) {
  try {
    const raw = cleanEnv(env?.QUEUE_NEWS_CONCURRENCY);
    if (raw === '') return QUEUE_NEWS_CONCURRENCY_DEFAULT;
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 1) return QUEUE_NEWS_CONCURRENCY_DEFAULT;
    return Math.min(QUEUE_NEWS_CONCURRENCY_MAX, n);
  } catch {
    return QUEUE_NEWS_CONCURRENCY_DEFAULT;
  }
}
