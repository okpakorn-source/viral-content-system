// ============================================================
// 🧪 img-airlock-malformed.test.mjs — โจทย์ 5(b): ภาพปลอม/พัง ต้องถูกปฏิเสธอย่าง "สงบ" ไม่ crash โปรเซสไหนเลย
// ------------------------------------------------------------
// ครอบคลุม 3 รูปแบบที่โจทย์ระบุ: (1) JPEG ถูกตัดท้าย (truncated), (2) header ประกาศมิติเว่อร์ (decompression
// bomb จำลองผ่านเพดาน MEGA_IMG_MAX_PIXELS), (3) magic bytes ผิด — ทดสอบทั้งที่ระดับ imageAirlockCore ตรงๆ
// และผ่าน pipeline เต็ม (runAirlockBatch ด้วย worker จริง scripts/img-airlock-worker.mjs)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { imageGuardCheck, reencodeCleanImage, safeSharpOpts } from '../src/lib/imageAirlockCore.js';
import { runAirlockBatch } from '../src/lib/imgAirlock.js';

async function makeJpeg(w = 80, h = 60) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 160, b: 90 } } }).jpeg().toBuffer();
}

test('(1) truncated JPEG: reencodeCleanImage โยน error ที่ JS จับได้ (ไม่ crash โปรเซส) ทั้ง guard on/off', async () => {
  const good = await makeJpeg();
  const truncated = good.subarray(0, Math.floor(good.length * 0.3)); // ตัดทิ้ง ~70% ท้ายไฟล์
  await assert.rejects(() => reencodeCleanImage(truncated, { failOn: 'none' }));
  await assert.rejects(() => reencodeCleanImage(truncated, safeSharpOpts(true)));
});

test('(1) truncated JPEG ผ่าน runAirlockBatch จริง (worker จริง ไม่ใช่ fake) → ok:false ไม่ใช่ process ตาย', async () => {
  const good = await makeJpeg();
  const truncated = good.subarray(0, 100); // ตัดสั้นมาก (แค่ header บางส่วน)
  const results = await runAirlockBatch([{ id: 'trunc-1', buf: truncated }], { timeoutMs: 10000 });
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false, 'ต้องถูกปฏิเสธแบบสงบ (ไม่ crash child)');
  assert.notEqual(results[0].poisoned, true, 'malformed ที่ JS จับได้ ไม่ใช่ native crash — ต้องไม่ติดป้าย poisoned');
});

test('(2) decompression bomb จำลอง: sharp limitInputPixels ปฏิเสธภาพที่พิกเซลรวมเกินเพดานจริง', async () => {
  // ทดสอบกลไก limitInputPixels ตรงๆ (ไม่ผ่าน env — IMG_GUARD_MAX_PIXELS floor-clamp ที่ ≥1,000,000 โดยตั้งใจ
  // กันตั้งค่าคุมภาพข่าวจริงพลาด เพดานเตี้ยกว่านั้นเลยทดสอบผ่าน env ไม่ได้ในไฟล์นี้ — ทดสอบตรงว่ากลไกทำงานจริง)
  const bigImg = await makeJpeg(1200, 1000); // 1,200,000 พิกเซล
  const tinyLimit = { failOn: 'none', limitInputPixels: 1000 }; // เพดานเตี้ยจงใจ (1,000 << 1,200,000)
  await assert.rejects(() => reencodeCleanImage(bigImg, tinyLimit), 'ต้องถูกปฏิเสธเพราะเกินเพดานพิกเซล (จำลอง decompression bomb)');
  // ยืนยันด้วยว่าเพดานปกติ (ไม่ตั้ง) ผ่านได้ตามปกติ — กันเทสนี้ false-positive จากเหตุอื่น
  const normal = await reencodeCleanImage(bigImg, { failOn: 'none' });
  assert.equal(normal.width, 1200);
});

test('(2) IMG_GUARD_MAX_PIXELS floor-clamp: ตั้ง env ต่ำกว่า 1,000,000 ต้องถูกดันขึ้นเป็น 1,000,000 เสมอ (กันตั้งพลาดจนกันภาพข่าวจริงออก)', async () => {
  const prev = process.env.MEGA_IMG_MAX_PIXELS;
  process.env.MEGA_IMG_MAX_PIXELS = '100';
  try {
    const core = await import(`../src/lib/imageAirlockCore.js?floor-test=${Date.now()}`);
    assert.equal(core.IMG_GUARD_MAX_PIXELS, 1_000_000, 'ต้อง floor-clamp ที่ 1,000,000 ไม่ใช่ 100 ตามที่ตั้ง env ผิดพลาด');
  } finally {
    if (prev === undefined) delete process.env.MEGA_IMG_MAX_PIXELS; else process.env.MEGA_IMG_MAX_PIXELS = prev;
  }
});

test('(3) wrong magic bytes: imageGuardCheck ปฏิเสธก่อนถึง sharp() เลย (เร็ว ไม่มี IO decode)', () => {
  const fakes = [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), // SVG ปลอมเป็นภาพ
    Buffer.concat([Buffer.from('II*\0'), Buffer.alloc(20)]), // TIFF little-endian magic
    Buffer.from('%PDF-1.4 fake pdf pretending to be image'),
  ];
  for (const buf of fakes) {
    const g = imageGuardCheck(buf);
    assert.equal(g.ok, false);
    assert.equal(g.reason, 'unknown_magic');
  }
});

test('(3) wrong magic bytes ผ่าน worker จริง → ok:false ด้วย error ขึ้นต้น guard: (ไม่ crash)', async () => {
  const fakeAvif = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypavif'), Buffer.alloc(20)]);
  const results = await runAirlockBatch([{ id: 'wrong-magic-1', buf: fakeAvif }], { timeoutMs: 10000 });
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.ok(String(results[0].error || '').startsWith('guard:'), `error ต้องมาจากด่าน guard: ${results[0].error}`);
});
