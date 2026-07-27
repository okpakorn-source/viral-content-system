// ============================================================
// 🧯 instrumentation-node.js — โค้ด Node.js-only จริงของตาข่ายกันเซิร์ฟเวอร์ตาย
// ------------------------------------------------------------
// แยกออกจาก src/instrumentation.js เป็นไฟล์ต่างหาก (ตามสูตรที่ Next.js docs แนะนำสำหรับไฟล์ที่ register()
// ทำงานได้ทั้งสอง runtime) — ให้ bundler ไม่ต้องรวมโค้ด process.on (Node-only API) เข้า edge bundle เลย แม้แต่
// ตอน static analysis (เดิมมี process.on ตรงๆ ใน instrumentation.js เอง → Turbopack เตือน "Node.js API is used
// ... not supported in the Edge Runtime" ทุก route แม้จะมี runtime-guard คุมไว้แล้วก็ตาม — เพราะ guard ทำงาน
// แค่ "ตอนรัน" ไม่ได้ตัดโค้ดออกจาก bundle "ตอน build") — instrumentation.js เรียกไฟล์นี้ผ่าน dynamic import()
// เฉพาะเมื่อยืนยันแล้วว่า NEXT_RUNTIME==='nodejs' เท่านั้น
// ============================================================

export function installCrashGuard() {
  if (typeof process === 'undefined' || typeof process.on !== 'function') return;
  // idempotent กัน listener ซ้อนซ้ำ (dev hot-reload อาจเรียก register() มากกว่า 1 ครั้งในโปรเซสเดียวกัน)
  if (globalThis.__CRASH_GUARD_INSTALLED) return;
  globalThis.__CRASH_GUARD_INSTALLED = true;

  process.on('unhandledRejection', (reason, promise) => {
    const detail = reason instanceof Error
      ? { message: reason.message, errorType: reason.errorType, stack: reason.stack }
      : { value: reason };
    console.error('🧯 กันเซิร์ฟเวอร์ตาย: unhandledRejection (promise reject ไม่มี .catch เกาะ) — เซิร์ฟเวอร์ยังทำงานต่อ ไม่ exit', detail);
  });

  process.on('uncaughtException', (err, origin) => {
    console.error(`🧯 กันเซิร์ฟเวอร์ตาย: uncaughtException (origin=${origin}) — เซิร์ฟเวอร์ยังทำงานต่อ ไม่ exit`, {
      message: err?.message,
      stack: err?.stack,
    });
  });

  console.log('🧯 [instrumentation] ติดตาข่ายกันเซิร์ฟเวอร์ตายจาก unhandledRejection/uncaughtException แล้ว (register() ผ่าน)');
}
