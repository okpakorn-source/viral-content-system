// ============================================================
// 🧯 instrumentation.js — ตาข่ายกันเซิร์ฟเวอร์ตายระดับโปรเซส (วิกฤต :3900, 28 ก.ค. 69)
// ------------------------------------------------------------
// พิสูจน์: register() ติด process.on('unhandledRejection')/('uncaughtException') จริง — เมื่อ event เหล่านี้
// เกิดขึ้น (จำลองยิงใส่ตัวเอง) ต้อง log ดังๆ (console.error) แต่ "ห้าม" process.exit เด็ดขาด (เซิร์ฟเวอร์งานหนัก
// ห้ามตายเพราะ promise หลุดตัวเดียว) · guard ต้อง idempotent (เรียก register() ซ้ำไม่เพิ่ม listener ซ้อน) ·
// guard ต้องข้าม edge runtime (ไม่มี process.on ใน edge)
// ★ register() เป็น async function (ห่อ dynamic import('./instrumentation-node.js') กัน Turbopack เตือน
//   Node-API-in-edge-runtime) — ทุกจุดที่เรียกในเทสนี้ต้อง await เสมอ ไม่งั้น installCrashGuard() ยังไม่ทันรัน
// ไม่แตะ process จริงถาวร — ทุกอย่างถูก restore กลับหลังเทสจบ
// ============================================================
import assert from 'node:assert/strict';

const { register } = await import('../src/instrumentation.js');

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 6).join('\n  ')}`); } };

// ★ register() แนบ listener เข้า `process` จริง (ไม่มีทาง unregister ในตัว — ตั้งใจ เพราะเป็นตาข่ายถาวรระดับ
//   เซิร์ฟเวอร์) — เทสนี้ต้อง snapshot + คืนค่า listener ทั้งสอง event เป๊ะหลังแต่ละเทส กันหลุดค้างไปกวนเทสไฟล์อื่น
function withCleanRuntimeGuardState(fn) {
  const savedFlag = globalThis.__CRASH_GUARD_INSTALLED;
  const savedRuntime = process.env.NEXT_RUNTIME;
  const savedRejectionListeners = process.listeners('unhandledRejection');
  const savedExceptionListeners = process.listeners('uncaughtException');
  delete globalThis.__CRASH_GUARD_INSTALLED;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.__CRASH_GUARD_INSTALLED = savedFlag;
      if (savedRuntime === undefined) delete process.env.NEXT_RUNTIME; else process.env.NEXT_RUNTIME = savedRuntime;
      process.removeAllListeners('unhandledRejection');
      for (const l of savedRejectionListeners) process.on('unhandledRejection', l);
      process.removeAllListeners('uncaughtException');
      for (const l of savedExceptionListeners) process.on('uncaughtException', l);
    });
}

await test('register(): NEXT_RUNTIME=nodejs → ติด listener unhandledRejection + uncaughtException จริง (มากกว่าตอนก่อนเรียก)', async () => {
  await withCleanRuntimeGuardState(async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const beforeRejection = process.listenerCount('unhandledRejection');
    const beforeException = process.listenerCount('uncaughtException');
    await register();
    assert.equal(process.listenerCount('unhandledRejection'), beforeRejection + 1, 'ต้องเพิ่ม listener unhandledRejection ขึ้น 1 ตัว');
    assert.equal(process.listenerCount('uncaughtException'), beforeException + 1, 'ต้องเพิ่ม listener uncaughtException ขึ้น 1 ตัว');
  });
});

await test('register(): เรียกซ้ำหลายครั้งในโปรเซสเดียวกัน (จำลอง dev hot-reload) → idempotent ไม่เพิ่ม listener ซ้อนซ้ำ', async () => {
  await withCleanRuntimeGuardState(async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const before = process.listenerCount('unhandledRejection');
    await register();
    await register();
    await register();
    assert.equal(process.listenerCount('unhandledRejection'), before + 1, 'เรียก register() 3 ครั้ง ต้องได้ listener เพิ่มแค่ 1 ตัวเท่านั้น (idempotent)');
  });
});

await test('register(): NEXT_RUNTIME=edge → ไม่ทำอะไรเลย (ไม่เพิ่ม listener) — process.on ไม่มีจริงใน edge runtime', async () => {
  await withCleanRuntimeGuardState(async () => {
    process.env.NEXT_RUNTIME = 'edge';
    const before = process.listenerCount('unhandledRejection');
    await register();
    assert.equal(process.listenerCount('unhandledRejection'), before, 'edge runtime ต้องไม่เพิ่ม listener');
  });
});

await test('unhandledRejection ที่ยิงเข้ามาจริง → log ผ่าน console.error (มีคำว่า "กันเซิร์ฟเวอร์ตาย") แต่ process.exit ไม่ถูกเรียกเลย', async () => {
  await withCleanRuntimeGuardState(async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    await register();
    const originalConsoleError = console.error;
    const originalExit = process.exit;
    let exitCalled = false;
    let loggedSomethingWithGuardMarker = false;
    console.error = (...args) => {
      if (args.some((a) => typeof a === 'string' && a.includes('กันเซิร์ฟเวอร์ตาย'))) loggedSomethingWithGuardMarker = true;
    };
    process.exit = () => { exitCalled = true; };
    try {
      // จำลอง unhandledRejection จริง — emit ตรงๆ ใส่ตัวเอง (มาตรฐานสำหรับเทส process event handler โดยไม่ต้อง
      // สร้าง promise ที่ reject จริงแล้วรอ event loop จับ — เรียก listener ที่ลงทะเบียนไว้ตรงๆ)
      process.emit('unhandledRejection', new Error('จำลอง orphan promise สำหรับเทส'), Promise.resolve());
    } finally {
      console.error = originalConsoleError;
      process.exit = originalExit;
    }
    assert.equal(loggedSomethingWithGuardMarker, true, 'ต้อง log ผ่าน console.error พร้อมคำเตือนกันเซิร์ฟเวอร์ตาย');
    assert.equal(exitCalled, false, 'process.exit ต้องไม่ถูกเรียกเด็ดขาด — เซิร์ฟเวอร์ต้องยังทำงานต่อ');
  });
});

await test('uncaughtException ที่ยิงเข้ามาจริง → log ผ่าน console.error (มีคำว่า "กันเซิร์ฟเวอร์ตาย") แต่ process.exit ไม่ถูกเรียกเลย', async () => {
  await withCleanRuntimeGuardState(async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    await register();
    const originalConsoleError = console.error;
    const originalExit = process.exit;
    let exitCalled = false;
    let loggedSomethingWithGuardMarker = false;
    console.error = (...args) => {
      if (args.some((a) => typeof a === 'string' && a.includes('กันเซิร์ฟเวอร์ตาย'))) loggedSomethingWithGuardMarker = true;
    };
    process.exit = () => { exitCalled = true; };
    try {
      process.emit('uncaughtException', new Error('จำลอง uncaught exception สำหรับเทส'), 'testOrigin');
    } finally {
      console.error = originalConsoleError;
      process.exit = originalExit;
    }
    assert.equal(loggedSomethingWithGuardMarker, true, 'ต้อง log ผ่าน console.error พร้อมคำเตือนกันเซิร์ฟเวอร์ตาย');
    assert.equal(exitCalled, false, 'process.exit ต้องไม่ถูกเรียกเด็ดขาด — เซิร์ฟเวอร์ต้องยังทำงานต่อ');
  });
});

console.log(`\n# instrumentation-crash-guard: ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
