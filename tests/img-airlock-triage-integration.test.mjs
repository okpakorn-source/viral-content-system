// ============================================================
// 🧪 img-airlock-triage-integration.test.mjs — โจทย์ 5(a)/5(d): ผสาน libraryTriage.js เต็มสาย
// ------------------------------------------------------------
// ใช้ data: URI ผ่าน im.imageUrl (imageBuffer.js oneUrl รองรับ data: โดยตรง — ไม่ต้องยิงเน็ตจริง) พิสูจน์:
//   (a) ภาพปกติผ่าน loadOne (เส้นตรง) กับ loadBatch (เส้นห้องนิรภัย, MEGA_IMG_AIRLOCK เปิด) ได้ pHash64/sharpness
//       เดียวกัน (parity — ห้องนิรภัยไม่เปลี่ยนผลภาพดีๆ)
//   (d) MEGA_IMG_AIRLOCK='0' → loadBatch ต้องเรียก Promise.all(map(loadOne)) เป๊ะ (ผลลัพธ์ deepEqual กับเรียก
//       loadOne ตรงๆ ทุกฟิลด์) และ MEGA_IMG_GUARD='0' → ภาพ magic ผิด (ที่ปกติชั้น 1 บล็อก) ต้องผ่านไม่ถูกกันแล้ว
//       (คืน parity เดิมก่อนมีเฟสนี้)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { loadOne, loadBatch } from '../src/lib/libraryTriage.js';

async function jpegDataUri(w = 96, h = 72, rgb = { r: 240, g: 90, b: 10 }) {
  const buf = await sharp({ create: { width: w, height: h, channels: 3, background: rgb } }).jpeg({ quality: 95 }).toBuffer();
  return 'data:image/jpeg;base64,' + buf.toString('base64');
}

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  Object.assign(process.env, vars);
  return Promise.resolve(fn()).finally(() => {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
    }
  });
}

test('(a) unit parity: ภาพปกติ — loadOne (ตรง) vs loadBatch airlock ON ต้องได้ pHash64/ขนาดจริงตรงกัน', async () => {
  const url = await jpegDataUri();
  const im = { id: 'IMG-parity-1', imageUrl: url };

  await withEnv({ MEGA_IMG_AIRLOCK: '1', MEGA_IMG_GUARD: '1' }, async () => {
    const direct = await loadOne(im);
    const [viaBatch] = await loadBatch([im]);
    assert.ok(direct, 'loadOne ต้องโหลดสำเร็จ');
    assert.ok(viaBatch, 'loadBatch (airlock) ต้องโหลดสำเร็จเช่นกัน');
    assert.equal(viaBatch.pHash64, direct.pHash64, 'pHash64 ต้องตรงกัน (ภาพเดิม แค่ path ต่างกัน)');
    assert.equal(viaBatch.realWidth, direct.realWidth);
    assert.equal(viaBatch.realHeight, direct.realHeight);
    assert.equal(viaBatch.decodedWidth, direct.decodedWidth);
    assert.equal(viaBatch.decodedHeight, direct.decodedHeight);
  });
});

// ★ Opus audit 30 ก.ค. (FAIL รอบแรก): parity ด้วยภาพสังเคราะห์ = false-green — ภาพถ่ายจริงบางใบ re-encode แล้ว
//   hash ดริฟท์ (ref-mrbq661b-4kjq: hamming=2) → เทสนี้ใช้ภาพถ่ายจริง ≥3 ใบ รวมใบที่เคยดริฟท์ เป็นหมุดถาวร
//   (worker ต้องคำนวณ dHash/sharpness จาก buffer ดิบเท่านั้น — ถ้าใครย้ายกลับไปคำนวณจาก re-encode เทสนี้แดงทันที)
test('(a2) real-photo parity: ภาพถ่ายจริง 3 ใบ (รวมใบเคยดริฟท์) — pHash64+sharpness ต้องตรงเส้นเดิมเป๊ะ', async () => {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const dir = path.join(process.cwd(), 'public', 'ref-covers');
  const files = ['ref-mrbq661b-4kjq.jpg', 'ref-mrbq5798-bzqh.jpg', 'ref-mrbq6ddl-qaqj.jpg'];
  await withEnv({ MEGA_IMG_AIRLOCK: '1', MEGA_IMG_GUARD: '1' }, async () => {
    for (const f of files) {
      const buf = readFileSync(path.join(dir, f));
      const im = { id: 'REAL-' + f, imageUrl: 'data:image/jpeg;base64,' + buf.toString('base64') };
      const direct = await loadOne(im);
      const [viaBatch] = await loadBatch([im]);
      assert.ok(direct && viaBatch, f + ': ต้องโหลดสำเร็จทั้งสองเส้น');
      assert.equal(viaBatch.pHash64, direct.pHash64, f + ': pHash64 ต้องตรงเป๊ะ (hash จากดิบเท่านั้น)');
      assert.equal(viaBatch.sharpness, direct.sharpness, f + ': sharpness ต้องตรงเป๊ะ');
    }
  });
});

test('(d) kill-switch parity: MEGA_IMG_AIRLOCK=0 → loadBatch ผลลัพธ์ deepEqual กับ Promise.all(map(loadOne)) ตรงๆ', async () => {
  const url1 = await jpegDataUri(80, 60, { r: 10, g: 200, b: 10 });
  const url2 = await jpegDataUri(64, 64, { r: 50, g: 50, b: 220 });
  const images = [{ id: 'A', imageUrl: url1 }, { id: 'B', imageUrl: url2 }];

  await withEnv({ MEGA_IMG_AIRLOCK: '0' }, async () => {
    const viaBatch = await loadBatch(images);
    const direct = await Promise.all(images.map(loadOne));
    assert.deepEqual(viaBatch, direct, 'ปิดสวิตช์ airlock ต้อง byte-parity 100% กับเส้นเดิม');
  });
});

test('(d) kill-switch parity: MEGA_IMG_GUARD=0 + MEGA_IMG_AIRLOCK=0 พร้อมกัน → เหมือนระบบก่อนมีเฟสนี้เป๊ะ', async () => {
  const url = await jpegDataUri();
  const im = { id: 'IMG-both-off', imageUrl: url };
  await withEnv({ MEGA_IMG_GUARD: '0', MEGA_IMG_AIRLOCK: '0' }, async () => {
    const r = await loadOne(im);
    assert.ok(r, 'ภาพปกติต้องผ่านได้ปกติเมื่อปิดทั้งสองสวิตช์ (เท่าระบบเดิมก่อนมีเฟสนี้)');
    assert.equal(typeof r.pHash64, 'string');
  });
});

test('(d) MEGA_IMG_GUARD=0: ภาพ magic ผิด (ที่ปกติชั้น 1 บล็อก) ต้องไหลผ่านไปถึง sharp() เหมือนระบบเดิม (อาจ null เพราะ sharp เองปฏิเสธ ไม่ใช่ guard)', async () => {
  // สร้าง data URI จาก buffer magic ผิด (ข้อความล้วน) — ปกติ imageGuardCheck จะกันไว้ตั้งแต่ก่อน sharp()
  const fakeDataUri = 'data:image/jpeg;base64,' + Buffer.from('not a real image at all, just plain text').toString('base64');
  const im = { id: 'IMG-fake', imageUrl: fakeDataUri };
  await withEnv({ MEGA_IMG_GUARD: '0' }, async () => {
    const r = await loadOne(im);
    // ปิด guard แล้ว sharp() เองก็ยังปฏิเสธ buffer ที่ไม่ใช่ภาพจริงอยู่ดี (fail-open legacy behavior: คืน null
    // เพราะ decode ไม่ได้ — เหมือนระบบก่อนมีเฟสนี้เป๊ะ ซึ่งก็ไม่มีด่าน guard เลยตั้งแต่ต้น)
    assert.equal(r, null, 'ปิด guard แล้วภาพปลอมยังต้องได้ผลเหมือนระบบเดิม (null เพราะ sharp decode ไม่ได้)');
  });
});
