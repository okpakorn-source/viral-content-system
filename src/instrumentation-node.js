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
// ★ ตรวจซ้ำ (Opus เก็บเล็ก 29 ก.ค. 69): register() รันทุก process start รวม Vercel lambda (cloud) — คิวงาน
//   dispatch='local'/'team' เป็นของเครื่องทีมเท่านั้น (สร้างเมื่อ !IS_CLOUD ใน quick-test/route.js) cloud ไม่ควร
//   แตะเลยแม้แต่อ่าน (เปลือง Supabase read ทุก cold start + เสี่ยงชนถ้า clock/heartbeat ผิดจังหวะ) — เช็ค
//   process.platform (เหมือน IS_CLOUD ของ quick-test/route.js เป๊ะ) ไม่ใช้ env.VERCEL (บทเรียนเก่า: เครื่องทีมมี
//   VERCEL=1 หลอกอยู่ — ดู memory vercel-env-on-team-machine) รับ platform ผ่าน param ให้เทสฉีดแทนได้
export async function recoverOrphanJobsOnBoot({ platform = process.platform } = {}) {
  if (platform !== 'win32') {
    console.log(`🩹 [instrumentation] กู้งานกำพร้าตอนบูต: ข้าม (ไม่ใช่เครื่องทีม — platform=${platform}, คิวนี้เป็นของเครื่องทีมเท่านั้น)`);
    return;
  }
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

// ============================================================
// 🩹 startOrphanRescan (29 ก.ค. 69 คืน — Opus fix #4, บั๊กจุดที่ 2): สแกนกู้งานกำพร้าซ้ำเป็นรอบ ไม่ใช่แค่ตอนบูต
// ------------------------------------------------------------
// บริบท: recoverOrphanJobsOnBoot() ด้านบน "สแกนได้แค่ครั้งเดียวต่อการบูตจริง" (idempotent ตั้งใจ) — คืนนี้ :3900
//   บูตเร็วมากหลังตาย (~5วิ) → ตอนสแกนบูต งานที่เพิ่งกำพร้าค้างมาแค่ ~10วิ ยังไม่เข้าเกณฑ์ ORPHAN_STALE_MS (90วิ)
//   เลย → ไม่ถูกกู้ → เพราะ recoverOrphanJobsOnBoot() ไม่ยอมสแกนซ้ำอีกเลยในโปรเซสเดียวกัน (กันงาน local ที่ยังรัน
//   สดอยู่จริงถูกเข้าใจผิด — เหตุผลเดิมยังถูกต้อง ไม่แตะ) งานนั้นเลยค้าง running ต่อไปจนกว่าจะมีการบูตรอบหน้า
//   (ซึ่งอาจไม่มาอีกนานถ้าเซิร์ฟเวอร์เสถียรแล้ว — ทั้งที่จริงมันกำพร้าไปนานแล้ว)
// แก้: ตั้ง setInterval เรียก recoverOrphanJobs() ซ้ำเป็นระยะ (default ~120วิ ปรับได้ผ่าน env
//   MEGA_ORPHAN_RESCAN_MS) — ให้ "รอบถัดไป" เก็บงานที่รอบบูตแรกพลาดไป (ยืนยันด้วยเทส _deps.now injection ใน
//   tests/orphan-job-recovery.test.mjs — บูตแรกเจอค้าง 10วิ ไม่กู้ / รอบถัดไปเจอค้างรวม 130วิ กู้ได้)
//   • guard กันซ้อน (inFlight flag) — ถ้ารอบก่อนยังไม่จบ (recoverOrphanJobs ช้าผิดปกติ) ข้ามรอบนี้ ไม่ยิงซ้อนกัน
//   • idempotent เหมือน installCrashGuard/recoverOrphanJobsOnBoot — เรียกซ้ำ (dev hot-reload) ไม่ตั้ง interval ซ้ำ
//   • kill-switch env MEGA_ORPHAN_RESCAN='0' → ไม่ตั้ง interval เลย (default ON เหมือนฟีเจอร์พี่น้อง MEGA_ORPHAN_RECOVERY)
//   • timer.unref() กันบล็อกโปรเซสปิดตัว (สคริปต์/เทสสั้นๆ ไม่ต้องรอ interval ค้าง)
// ★ testability: คืน { timer, tick } — เทสเรียก tick() ตรงๆ แทนรอ setInterval จริง (เหมือนแพทเทิร์น _deps ทั้งไฟล์)
//   รับ _deps.setInterval (แทน setInterval จริง) + _deps.recoverOrphanJobs (แทน dynamic import จริง) ฉีดได้
// ★ ตรวจซ้ำ (Opus เก็บเล็ก 29 ก.ค. 69): เหตุผลเดียวกับ recoverOrphanJobsOnBoot ด้านบนเป๊ะ — cloud (Vercel lambda)
//   ไม่ควรตั้ง interval แตะคิวเครื่องทีมเลย เช็ค process.platform (ไม่ใช่ env.VERCEL) รับผ่าน param ให้เทสฉีดแทนได้
export function startOrphanRescan({ env = process.env, intervalMs, _deps = {}, platform = process.platform } = {}) {
  if (platform !== 'win32') {
    console.log(`🩹 [instrumentation] สแกนกู้งานกำพร้าซ้ำ: ข้าม (ไม่ใช่เครื่องทีม — platform=${platform}, คิวนี้เป็นของเครื่องทีมเท่านั้น)`);
    return null;
  }
  if (env.MEGA_ORPHAN_RESCAN === '0') return null;
  if (globalThis.__ORPHAN_RESCAN_STARTED) return globalThis.__ORPHAN_RESCAN_HANDLE || null;
  globalThis.__ORPHAN_RESCAN_STARTED = true;
  const ms = Number.isFinite(intervalMs) ? intervalMs : Math.max(5000, parseInt(env.MEGA_ORPHAN_RESCAN_MS || '120000', 10));
  const _setInterval = _deps.setInterval || setInterval;
  let inFlight = false;
  const tick = async () => {
    if (inFlight) return; // guard กันซ้อน — รอบก่อนยังไม่จบ (recoverOrphanJobs ช้าผิดปกติ) ข้ามรอบนี้เลย
    inFlight = true;
    try {
      const _recover = _deps.recoverOrphanJobs || (await import('./lib/quickTestJobs.js')).recoverOrphanJobs;
      const r = await _recover();
      if (r?.scanned) console.log(`🩹 [instrumentation] สแกนกู้งานกำพร้าซ้ำ (interval): เจอ ${r.scanned} ใบ — กู้ ${r.recovered} · fail ${r.failed}`);
    } catch (e) {
      console.error('🩹 [instrumentation] สแกนกู้งานกำพร้าซ้ำ (interval): ล้มเหลว (ไม่กระทบเซิร์ฟเวอร์)', e?.message);
    } finally {
      inFlight = false;
    }
  };
  const timer = _setInterval(tick, ms);
  if (timer && typeof timer.unref === 'function') timer.unref();
  const handle = { timer, tick };
  globalThis.__ORPHAN_RESCAN_HANDLE = handle;
  console.log(`🩹 [instrumentation] ตั้งสแกนกู้งานกำพร้าซ้ำทุก ${Math.round(ms / 1000)}วิ แล้ว`);
  return handle;
}
