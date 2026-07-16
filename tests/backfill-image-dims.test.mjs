// Focused tests — scripts/backfill-image-dims.mjs
//   probe ถูก (ภาพสังเคราะห์ sharp รู้ขนาด) · record มี dims แล้วไม่ถูกทับ · dry-run ไม่เขียน ·
//   field อื่น byte-unchanged · จำแนก url · limit ต่อรอบ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const {
  hasRealDims,
  classifyImageUrl,
  probeBufferDims,
  buildBackfillPatch,
  backfillRecords,
  MEASURED_FROM_MARK,
} = await import('../scripts/backfill-image-dims.mjs');

// ภาพสังเคราะห์จริง (sharp encode — header อ่านได้จริง)
async function synthPng(w, h) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 12, g: 34, b: 56 } } }).png().toBuffer();
}

test('probeBufferDims: อ่านขนาดภาพสังเคราะห์ได้ถูกต้อง (640x400 → short 400)', async () => {
  const buf = await synthPng(640, 400);
  const dims = await probeBufferDims(buf);
  assert.deepEqual(dims, { realWidth: 640, realHeight: 400, realShortSide: 400 });
});

test('probeBufferDims: portrait (300x900 → short 300)', async () => {
  const buf = await synthPng(300, 900);
  assert.deepEqual(await probeBufferDims(buf), { realWidth: 300, realHeight: 900, realShortSide: 300 });
});

test('probeBufferDims: buffer ขยะ/ว่าง → null (ไม่เดา)', async () => {
  assert.equal(await probeBufferDims(Buffer.from('not-an-image')), null);
  assert.equal(await probeBufferDims(Buffer.alloc(0)), null);
  assert.equal(await probeBufferDims(null), null);
});

test('classifyImageUrl: local | supabase | hotlink | none', () => {
  assert.equal(classifyImageUrl('/case-frames/x.jpg'), 'local');
  assert.equal(classifyImageUrl('https://abc.supabase.co/storage/v1/object/public/acs-frames/x.jpg'), 'supabase');
  assert.equal(classifyImageUrl('https://www.gstatic.com/x.jpg'), 'hotlink');
  assert.equal(classifyImageUrl('http://news.example.com/a.png'), 'hotlink');
  assert.equal(classifyImageUrl(''), 'none');
  assert.equal(classifyImageUrl(null), 'none');
  assert.equal(classifyImageUrl(123), 'none');
});

test('hasRealDims: true เฉพาะเมื่อ realWidth/realHeight เป็นบวกทั้งคู่', () => {
  assert.equal(hasRealDims({ realWidth: 640, realHeight: 400 }), true);
  assert.equal(hasRealDims({ realWidth: 0, realHeight: 400 }), false);
  assert.equal(hasRealDims({ realWidth: 640 }), false);
  assert.equal(hasRealDims({}), false);
  assert.equal(hasRealDims(null), false);
});

test('buildBackfillPatch: record มี dims แล้ว → null (ห้ามทับ)', () => {
  const rec = { id: 'A-1', realWidth: 1200, realHeight: 800, imageUrl: '/x.jpg' };
  assert.equal(buildBackfillPatch(rec, { realWidth: 640, realHeight: 400, realShortSide: 400 }), null);
});

test('buildBackfillPatch: record ไม่มี dims + dims ถูก → patch 4 ฟิลด์ พร้อม measuredFrom mark', () => {
  const rec = { id: 'A-2', imageUrl: '/x.jpg' };
  const patch = buildBackfillPatch(rec, { realWidth: 640, realHeight: 400, realShortSide: 400 });
  assert.deepEqual(patch, { realWidth: 640, realHeight: 400, realShortSide: 400, measuredFrom: MEASURED_FROM_MARK });
  assert.equal(MEASURED_FROM_MARK, 'backfill_probe');
});

test('buildBackfillPatch: dims ไม่ถูกต้อง/หาย → null', () => {
  const rec = { id: 'A-3', imageUrl: '/x.jpg' };
  assert.equal(buildBackfillPatch(rec, null), null);
  assert.equal(buildBackfillPatch(rec, { realWidth: 0, realHeight: 400 }), null);
  assert.equal(buildBackfillPatch(rec, { realWidth: 640.5, realHeight: 400 }), null);
});

test('backfillRecords dry-run: ไม่เรียก applyPatch เลย + นับ wouldWrite', async () => {
  const buf = await synthPng(800, 600);
  let applyCalls = 0;
  const records = [
    { id: 'A-1', imageUrl: '/local1.jpg' },                 // จะ probe ได้
    { id: 'A-2', imageUrl: 'https://x.supabase.co/y.jpg' }, // จะ probe ได้
    { id: 'A-3', imageUrl: 'https://news.ext/z.jpg' },      // hotlink → ข้าม
    { id: 'A-4', imageUrl: '/local4.jpg', realWidth: 100, realHeight: 100 }, // มี dims แล้ว → ข้าม
  ];
  const { summary } = await backfillRecords({
    records,
    loadBuffer: async () => buf,
    applyPatch: async () => { applyCalls++; },
    dryRun: true,
    limit: 200,
  });
  assert.equal(applyCalls, 0, 'dry-run ห้ามเขียน');
  assert.equal(summary.wouldWrite, 2);
  assert.equal(summary.wrote, 0);
  assert.equal(summary.skippedHotlink, 1);
  assert.equal(summary.alreadyHadDims, 1);
  assert.equal(summary.probeAttempts, 2);
});

test('backfillRecords write: field อื่น byte-unchanged + เพิ่มแค่ 4 ฟิลด์', async () => {
  const buf = await synthPng(1024, 768);
  const original = {
    id: 'A-1', caseId: 'C1', ord: 3, imageUrl: '/case-frames/a.jpg', thumbnailUrl: 't',
    platform: 'youtube', source: 'yt', sourceLink: 'https://s', rehostQuality: 'full',
    triage: { relevant: true, category: 'face-neutral' }, addedAt: '2026-07-16T00:00:00.000Z',
  };
  const store = { ...JSON.parse(JSON.stringify(original)) };
  await backfillRecords({
    records: [store],
    loadBuffer: async () => buf,
    applyPatch: async (rec, patch) => { Object.assign(store, patch); },
    dryRun: false,
    limit: 200,
  });
  // 4 ฟิลด์ใหม่ถูกต้อง
  assert.equal(store.realWidth, 1024);
  assert.equal(store.realHeight, 768);
  assert.equal(store.realShortSide, 768);
  assert.equal(store.measuredFrom, 'backfill_probe');
  // ทุกฟิลด์เดิม byte-unchanged
  for (const k of Object.keys(original)) {
    assert.deepEqual(store[k], original[k], `field เดิมเปลี่ยน: ${k}`);
  }
  // ไม่มีฟิลด์อื่นโผล่นอกจาก 4 ที่อนุญาต
  const added = Object.keys(store).filter((k) => !(k in original));
  assert.deepEqual(added.sort(), ['measuredFrom', 'realHeight', 'realShortSide', 'realWidth']);
});

test('backfillRecords: hotlink ไม่เรียก loadBuffer (กัน network)', async () => {
  let loads = 0;
  const { summary } = await backfillRecords({
    records: [
      { id: 'H-1', imageUrl: 'https://www.gstatic.com/a.jpg' },
      { id: 'H-2', imageUrl: 'https://fbcdn.net/b.jpg' },
    ],
    loadBuffer: async () => { loads++; return null; },
    applyPatch: async () => {},
    dryRun: true,
  });
  assert.equal(loads, 0, 'hotlink ต้องไม่โหลด buffer');
  assert.equal(summary.skippedHotlink, 2);
  assert.equal(summary.byClass.hotlink, 2);
});

test('backfillRecords: limit จำกัดจำนวน probe ต่อรอบ + ตั้งธง hitLimit', async () => {
  const buf = await synthPng(500, 500);
  const records = [];
  for (let i = 0; i < 10; i++) records.push({ id: `L-${i}`, imageUrl: `/f${i}.jpg` });
  let loads = 0;
  const { summary } = await backfillRecords({
    records,
    loadBuffer: async () => { loads++; return buf; },
    applyPatch: async () => {},
    dryRun: true,
    limit: 3,
  });
  assert.equal(summary.probeAttempts, 3);
  assert.equal(loads, 3, 'โหลด buffer แค่ตาม limit');
  assert.equal(summary.wouldWrite, 3);
  assert.equal(summary.hitLimit, true);
});

test('backfillRecords: probe ล้ม (buffer ขยะ) → นับ probeFailed ไม่เขียน', async () => {
  let applyCalls = 0;
  const { summary } = await backfillRecords({
    records: [{ id: 'B-1', imageUrl: '/bad.jpg' }],
    loadBuffer: async () => Buffer.from('garbage'),
    applyPatch: async () => { applyCalls++; },
    dryRun: false,
  });
  assert.equal(summary.probeFailed, 1);
  assert.equal(summary.wrote, 0);
  assert.equal(applyCalls, 0);
});
