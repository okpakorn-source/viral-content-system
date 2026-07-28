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

// ============================================================
// 🩹 recoverOrphanJobsOnBoot (29 ก.ค. 69 แบตช์เสถียรภาพ) — เรียก recoverOrphanJobs (quickTestJobs.js) ตอนบูต
// ------------------------------------------------------------
// idempotent เหมือน installCrashGuard ด้านบนเป๊ะ — เหตุผลสำคัญ (ต่างจาก crash-guard ตรงนี้): งาน dispatch='local'
// ที่กำลังรันจริงในโปรเซสเดียวกันนี้อาจมี claimedAt ค้างเกิน 90 วิ ได้ตามปกติ (callOnce ภายในกินเวลาได้ถึง 25+ นาที
// ต่อความพยายาม 1 ครั้ง โดยไม่รีเฟรช claimedAt ระหว่างทางเลย) — ถ้า register() ถูกเรียกซ้ำระหว่าง dev hot-reload
// (ตามคอมเมนต์ installCrashGuard เดิม) แล้วสแกนซ้ำโดยไม่มี guard จะเข้าใจผิดว่างานที่ยังรันสดอยู่จริงเป็นงานกำพร้า
// → guard นี้การันตีสแกนแค่ "ครั้งเดียวต่อการบูตจริง" (โปรเซสใหม่ทั้งก้อน = globalThis รีเซ็ต = สแกนใหม่ถูกต้อง)
// ล้ม (อ่าน/เขียนคลังไม่สำเร็จ) ต้องไม่ทำให้เซิร์ฟเวอร์บูตไม่ขึ้น — ครอบ try/catch เอง (recoverOrphanJobs เองก็มี
// try/catch ภายในอีกชั้นสำหรับ error ต่อรายการ — ชั้นนี้กันเฉพาะ import ล้ม/ throw ที่ไม่คาดคิด)
export async function recoverOrphanJobsOnBoot() {
  if (globalThis.__ORPHAN_RECOVERY_RAN) return;
  globalThis.__ORPHAN_RECOVERY_RAN = true;
  try {
    const { recoverOrphanJobs } = await import('./lib/quickTestJobs.js');
    const r = await recoverOrphanJobs();
    if (r?.on === false) {
      console.log('🩹 [instrumentation] กู้งานกำพร้าตอนบูต: ปิดสวิตช์ (MEGA_ORPHAN_RECOVERY=0) — ข้าม');
    } else if (!r?.scanned) {
      console.log('🩹 [instrumentation] กู้งานกำพร้าตอนบูต: ไม่เจองานกำพร้า');
    }
  } catch (e) {
    console.error('🩹 [instrumentation] กู้งานกำพร้าตอนบูต: ล้มเหลว (ไม่กระทบการบูตเซิร์ฟเวอร์)', e?.message);
  }
}
