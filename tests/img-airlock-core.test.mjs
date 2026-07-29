// ============================================================
// 🧪 img-airlock-core.test.mjs — เทสหน่วย src/lib/imageAirlockCore.js (เฟส "กันภาพพิษฆ่าเซิร์ฟ" 30 ก.ค. 69)
// ------------------------------------------------------------
// ครอบคลุมโจทย์ 5(a)/5(b) บางส่วน: magic-byte allowlist, เพดานขนาด/พิกเซล, safeSharpOpts, และ
// computeSharpness/computeDHash64/reencodeCleanImage บนภาพจริง (synthetic ผ่าน sharp create — ไม่พึ่งเน็ต)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  detectImageMagic, imageGuardCheck, safeSharpOpts,
  computeSharpness, computeDHash64, reencodeCleanImage,
  IMG_GUARD_MAX_BYTES, IMG_GUARD_MAX_PIXELS,
} from '../src/lib/imageAirlockCore.js';

async function makeJpeg(w = 64, h = 64, rgb = { r: 200, g: 50, b: 50 }) {
  return sharp({ create: { width: w, height: h, channels: 3, background: rgb } }).jpeg().toBuffer();
}
async function makePngWithAlpha(w = 32, h = 32) {
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 10, g: 200, b: 30, alpha: 0.5 } } }).png().toBuffer();
}

test('detectImageMagic: รู้จัก JPEG/PNG/WebP/GIF — ปฏิเสธอย่างอื่นเสมอ (allowlist ไม่ใช่ blocklist)', async () => {
  const jpeg = await makeJpeg();
  const png = await makePngWithAlpha();
  assert.equal(detectImageMagic(jpeg), 'jpeg');
  assert.equal(detectImageMagic(png), 'png');
  assert.equal(detectImageMagic(Buffer.from('GIF89a' + 'x'.repeat(20))), 'gif');
  assert.equal(detectImageMagic(Buffer.concat([Buffer.from('RIFF1234WEBP'), Buffer.alloc(10)])), 'webp');
  // ปลอมแปลง magic bytes แบบต่างๆ ที่ต้องถูกปฏิเสธ
  assert.equal(detectImageMagic(Buffer.from('plain text file, not an image at all')), null);
  assert.equal(detectImageMagic(Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66])), null, 'AVIF ftyp box ต้องถูกปฏิเสธ (ไม่อยู่ใน allowlist)');
  assert.equal(detectImageMagic(Buffer.from('BM' + '\0'.repeat(20))), null, 'BMP ต้องถูกปฏิเสธ');
  assert.equal(detectImageMagic(Buffer.alloc(5)), null, 'buffer สั้นเกินกว่าจะมี signature ต้อง null');
  assert.equal(detectImageMagic(null), null);
  assert.equal(detectImageMagic(Buffer.alloc(0)), null);
});

test('imageGuardCheck: ผ่านเฉพาะภาพจริงที่ magic ถูก + ขนาดไม่เกินเพดาน', async () => {
  const jpeg = await makeJpeg();
  const g = imageGuardCheck(jpeg);
  assert.equal(g.ok, true);
  assert.equal(g.magic, 'jpeg');

  assert.deepEqual(imageGuardCheck(Buffer.alloc(0)), { ok: false, reason: 'empty_buffer' });
  assert.deepEqual(imageGuardCheck(null), { ok: false, reason: 'empty_buffer' });

  const wrongMagic = imageGuardCheck(Buffer.from('not an image, just text pretending'));
  assert.equal(wrongMagic.ok, false);
  assert.equal(wrongMagic.reason, 'unknown_magic');

  const huge = Buffer.alloc(IMG_GUARD_MAX_BYTES + 1, 0);
  huge[0] = 0xFF; huge[1] = 0xD8; huge[2] = 0xFF; // ปลอม JPEG magic แต่ตัวไฟล์ใหญ่เกินเพดาน
  const tooBig = imageGuardCheck(huge);
  assert.equal(tooBig.ok, false);
  assert.ok(tooBig.reason.startsWith('too_large:'));
});

test('safeSharpOpts: guardOn=true ให้ failOn:truncated + limitInputPixels, guardOn=false = เดิมเป๊ะ {failOn:none}', () => {
  assert.deepEqual(safeSharpOpts(false), { failOn: 'none' });
  const on = safeSharpOpts(true);
  assert.equal(on.failOn, 'truncated');
  assert.equal(on.limitInputPixels, IMG_GUARD_MAX_PIXELS);
});

test('computeSharpness/computeDHash64: ภาพปกติต้องได้ค่าตัวเลข/hex ไม่ว่า guard on หรือ off (ไม่ทำให้ภาพดีๆ พัง)', async () => {
  const jpeg = await makeJpeg(64, 64, { r: 120, g: 80, b: 200 });
  const s1 = await computeSharpness(jpeg, { failOn: 'none' });
  const s2 = await computeSharpness(jpeg, safeSharpOpts(true));
  assert.equal(typeof s1, 'number');
  assert.equal(typeof s2, 'number');

  const h1 = await computeDHash64(jpeg, { failOn: 'none' });
  const h2 = await computeDHash64(jpeg, safeSharpOpts(true));
  assert.equal(typeof h1, 'string');
  assert.equal(h1.length, 16);
  assert.equal(h1, h2, 'ภาพปกติ (ไม่ truncated) ต้องได้ dHash เดียวกันไม่ว่า guard on/off — guard ไม่เปลี่ยนผลภาพดีๆ');
});

test('computeSharpness/computeDHash64: malformed buffer คืน null (fail-open, ไม่ throw — ไม่บล็อกตาคัด)', async () => {
  const junk = Buffer.from('this is definitely not image data');
  assert.equal(await computeSharpness(junk, { failOn: 'none' }), null);
  assert.equal(await computeDHash64(junk, { failOn: 'none' }), null);
});

test('reencodeCleanImage: ภาพมี alpha → PNG (กันโปร่งใสหาย), ภาพไม่มี alpha → JPEG q92', async () => {
  const withAlpha = await makePngWithAlpha(40, 30);
  const outA = await reencodeCleanImage(withAlpha, { failOn: 'none' });
  assert.equal(outA.hasAlpha, true);
  assert.equal(outA.width, 40);
  assert.equal(outA.height, 30);
  assert.equal(detectImageMagic(outA.buf), 'png');

  const noAlpha = await makeJpeg(50, 25);
  const outB = await reencodeCleanImage(noAlpha, { failOn: 'none' });
  assert.equal(outB.hasAlpha, false);
  assert.equal(outB.width, 50);
  assert.equal(outB.height, 25);
  assert.equal(detectImageMagic(outB.buf), 'jpeg');
});

test('reencodeCleanImage: dHash ของภาพเดิมกับภาพที่ re-encode แล้ว (lossless PNG) ต้องตรงกันเป๊ะ', async () => {
  const original = await makePngWithAlpha(48, 48);
  const clean = await reencodeCleanImage(original, { failOn: 'none' });
  const h1 = await computeDHash64(original, { failOn: 'none' });
  const h2 = await computeDHash64(clean.buf, { failOn: 'none' });
  assert.equal(h1, h2, 're-encode เป็น PNG (lossless) ต้องไม่เปลี่ยน dHash — เป็นการแปลง format ล้วน ไม่ใช่การแต่งภาพ');
});
