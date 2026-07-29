// ============================================================
// 🧪 img-airlock-crash-sim.test.mjs — เทสจำลอง "child ตายกลางรายการ" (ภาพพิษ = native crash)
// ------------------------------------------------------------
// ใช้ tests/fixtures/img-airlock-crash-worker.mjs (worker ปลอมที่ process.exit(1) ทันทีเมื่อได้รับ id
// === 'POISON') ผ่าน runAirlockBatch(items, { _workerPath }) — พิสูจน์ข้อกำหนดของโจทย์ 5(c):
//   parent ต้องรอด (ไม่โยน exception ออกมาทั้ง batch) + blacklist "ใบที่ตายจริง" เท่านั้น (ไม่ใช่ใบอื่น)
//   + respawn ลูกใหม่ทำใบที่เหลือ "หลัง" ใบพิษต่อจนจบ (ไม่ตัดขบวนทิ้งทั้งยวง)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAirlockBatch } from '../src/lib/imgAirlock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CRASH_WORKER = path.join(__dirname, 'fixtures', 'img-airlock-crash-worker.mjs');
const BOOTCRASH_WORKER = path.join(__dirname, 'fixtures', 'img-airlock-bootcrash-worker.mjs');

function fakeBuf(tag) { return Buffer.from('fake-raw-bytes-' + tag); }

test('crash-sim: child ตายกลาง batch → parent รอด + blacklist เฉพาะใบพิษ + ทำใบหลังจากนั้นต่อจนจบ', async () => {
  const items = [
    { id: 'img-1', buf: fakeBuf('img-1') },
    { id: 'img-2', buf: fakeBuf('img-2') },
    { id: 'POISON', buf: fakeBuf('poison') },
    { id: 'img-3', buf: fakeBuf('img-3') },
    { id: 'img-4', buf: fakeBuf('img-4') },
  ];
  const results = await runAirlockBatch(items, { _workerPath: CRASH_WORKER, timeoutMs: 5000 });

  assert.equal(results.length, 5, 'ต้องได้ผลลัพธ์ครบทุกใบ (ไม่หายไปทั้ง batch)');
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));

  assert.equal(byId['img-1'].ok, true, 'ใบก่อนภาพพิษ ต้องผ่านปกติ');
  assert.equal(byId['img-2'].ok, true, 'ใบก่อนภาพพิษ ต้องผ่านปกติ');

  assert.equal(byId['POISON'].ok, false, 'ใบพิษเองต้องเป็น ok:false');
  assert.equal(byId['POISON'].poisoned, true, 'ใบพิษต้องมี poisoned:true (คือใบที่ทำให้ child ตาย)');

  assert.equal(byId['img-3'].ok, true, 'ใบหลังภาพพิษ ต้องถูกประมวลต่อจนจบ (respawn ลูกใหม่สำเร็จ)');
  assert.equal(byId['img-4'].ok, true, 'ใบสุดท้าย ต้องถูกประมวลต่อจนจบ');
});

test('crash-sim: ภาพพิษที่ต้นแถว (ไม่มีใบก่อนหน้า) ก็ยังกู้ต่อได้หลังจากนั้น', async () => {
  const items = [
    { id: 'POISON', buf: fakeBuf('poison') },
    { id: 'img-a', buf: fakeBuf('a') },
    { id: 'img-b', buf: fakeBuf('b') },
  ];
  const results = await runAirlockBatch(items, { _workerPath: CRASH_WORKER, timeoutMs: 5000 });
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));
  assert.equal(byId['POISON'].poisoned, true);
  assert.equal(byId['img-a'].ok, true);
  assert.equal(byId['img-b'].ok, true);
});

// ★ Opus audit 30 ก.ค. — 2 เคสขอบที่ขอเพิ่มก่อน deploy:
test('crash-sim ขอบ: child ตายตั้งแต่บูต (ก่อนรับใบแรก) → parent รอด ไม่แขวน ทุกใบได้ผลลัพธ์ ไม่มีใบไหน ok:true', async () => {
  const items = [
    { id: 'img-x', buf: fakeBuf('x') },
    { id: 'img-y', buf: fakeBuf('y') },
  ];
  const results = await runAirlockBatch(items, { _workerPath: BOOTCRASH_WORKER, timeoutMs: 5000 });
  assert.equal(results.length, 2, 'ต้องได้ผลลัพธ์ครบทุกใบแม้ลูกไม่เคยตอบอะไรเลย');
  for (const r of results) assert.equal(r.ok, false, r.id + ': ห้าม ok:true เพราะไม่มีใบไหนถูกประมวลจริง');
});

test('crash-sim ขอบ: child ตอบใบสุดท้ายครบแล้วค่อยตาย → ทุกใบ ok:true และห้ามมีใบไหนถูกใส่ร้ายเป็นพิษย้อนหลัง', async () => {
  const items = [
    { id: 'img-m', buf: fakeBuf('m') },
    { id: 'DIE-AFTER-REPLY', buf: fakeBuf('dar') },
  ];
  const results = await runAirlockBatch(items, { _workerPath: CRASH_WORKER, timeoutMs: 5000 });
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));
  assert.equal(byId['img-m'].ok, true);
  assert.equal(byId['DIE-AFTER-REPLY'].ok, true, 'ตอบสำเร็จก่อนตาย = ต้องนับเป็นสำเร็จ ไม่ใช่พิษ');
  assert.notEqual(byId['DIE-AFTER-REPLY'].poisoned, true, 'ห้าม off-by-one โทษใบสุดท้ายว่าเป็นพิษ');
});

test('crash-sim: หลายใบพิษต่างกันในแถวเดียว (respawn ซ้ำได้หลายรอบ ไม่ชนเพดาน MAX_SPAWNS)', async () => {
  const items = [
    { id: 'img-1', buf: fakeBuf('1') },
    { id: 'POISON-1', buf: fakeBuf('p1') },
    { id: 'img-2', buf: fakeBuf('2') },
    { id: 'POISON-2', buf: fakeBuf('p2') },
    { id: 'img-3', buf: fakeBuf('3') },
  ];
  const results = await runAirlockBatch(items, { _workerPath: CRASH_WORKER, timeoutMs: 5000 });
  assert.equal(results.length, 5);
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));
  assert.equal(byId['img-1'].ok, true);
  assert.equal(byId['POISON-1'].poisoned, true);
  assert.equal(byId['img-2'].ok, true, 'respawn รอบแรกต้องกู้กลับมาทำงานต่อได้');
  assert.equal(byId['POISON-2'].poisoned, true);
  assert.equal(byId['img-3'].ok, true, 'respawn รอบสองต้องกู้กลับมาทำงานต่อได้เช่นกัน');
});
