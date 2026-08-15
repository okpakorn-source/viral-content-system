// ============================================================
// 🧪 clip-archive-keep-all.test.mjs — "งานพนักงานต้องไม่หาย" (15 ส.ค. 69)
// ------------------------------------------------------------
// เจ้าของสั่ง: "ต้องการเก็บทุกบทความที่พนักงานถอดเข้าคลัง"
// กติกาที่ต้องล็อกไว้ ห้ามหลุดอีก:
//   1. ใบที่พนักงานปักหมุด "ใช้ใบนี้" (chosen) ห้ามถูกลบตอนคลังเต็ม — เคยมีตั้งแต่ 11 ส.ค.
//      แล้วหลุดไปตอนย้อนยุคนิ่ง 14 ส.ค. (ตัวตัดคลังเรียงตามเวลาแล้วลบเก่าสุดล้วน)
//   2. คลังไม่เกินเพดาน = ห้ามลบอะไรเลย
//   3. ลบเก่าก่อนใหม่เสมอ
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickCasesToPurge, CLIP_CASE_KEEP, archiveRowId, CLIP_ARCHIVE_STORE } from '../src/lib/services/clipArchive.js';

const mk = (n, opts = {}) => Array.from({ length: n }, (_, i) => ({
  id: `case-${String(i).padStart(4, '0')}`,
  createdAt: new Date(Date.UTC(2026, 7, 1, 0, i)).toISOString(), // เก่า → ใหม่ ตามลำดับ index
  ...(opts.pinEvery && i % opts.pinEvery === 0 ? { chosen: true } : {}),
}));

test('คลังยังไม่เกินเพดาน → ห้ามลบอะไรเลย', () => {
  assert.deepEqual(pickCasesToPurge(mk(400), 400), []);
  assert.deepEqual(pickCasesToPurge(mk(12), 400), []);
  assert.deepEqual(pickCasesToPurge([], 400), []);
});

test('เกินเพดาน → ลบเฉพาะส่วนเกิน และลบใบเก่าสุดก่อน', () => {
  const out = pickCasesToPurge(mk(405), 400);
  assert.equal(out.length, 5, 'ต้องลบเท่าจำนวนที่เกินเท่านั้น');
  assert.deepEqual(out.map(c => c.id), ['case-0000', 'case-0001', 'case-0002', 'case-0003', 'case-0004']);
});

test('🔴 ใบที่ปักหมุด "ใช้ใบนี้" ห้ามถูกลบ แม้จะเก่าสุด', () => {
  const all = mk(410);
  all[0].chosen = true; // ใบเก่าสุด = ใบที่พนักงานปักหมุดไว้
  all[1].chosen = true;
  const out = pickCasesToPurge(all, 400);
  assert.ok(!out.some(c => c.chosen), 'มีใบปักหมุดหลุดเข้ารายการลบ — งานพนักงานจะหาย');
  assert.ok(!out.some(c => c.id === 'case-0000'), 'ใบปักหมุดเก่าสุดต้องรอด');
  assert.equal(out.length, 10, 'ยังต้องลบครบจำนวนที่เกิน โดยข้ามใบปักหมุดไปหยิบใบถัดไปแทน');
});

test('ใบเก่าเป็นใบปักหมุดหมด → ลบได้เท่าที่ลบได้ ไม่ฝืนลบใบปักหมุด', () => {
  const all = mk(404, { pinEvery: 1 }); // ปักหมุดทุกใบ
  assert.deepEqual(pickCasesToPurge(all, 400), [], 'ปักหมุดทั้งคลัง = ไม่มีอะไรลบได้');
});

test('เพดานเริ่มต้นยังเป็น 400 (ถ้าเปลี่ยนต้องตั้งใจ ไม่ใช่หลุด)', () => {
  assert.equal(CLIP_CASE_KEEP, 400);
});

test('🔴 id สำเนาถาวรต้องไม่ซ้ำ id ใบจริง (ไม่งั้นชน primary key = เขียนไม่ติดเลย)', () => {
  const caseId = 'c9e61407-0b4b-478c-9bfe-41a9d76663a5';
  const rowId = archiveRowId(caseId);
  assert.notEqual(rowId, caseId, 'ใช้ id เดียวกับใบจริง = duplicate key 23505 ทุกครั้ง (เจอจริง 15 ส.ค. 69)');
  assert.ok(rowId.includes(caseId), 'ต้องยังอ้างกลับไปหาใบจริงได้');
  assert.equal(rowId, 'arc-' + caseId);
  assert.equal(CLIP_ARCHIVE_STORE, 'clip-insights-archive', 'ชื่อ store เปลี่ยน = สำเนาเก่าหาไม่เจอ ต้องตั้งใจเปลี่ยนเท่านั้น');
});

test('ข้อมูลเพี้ยน (null/ไม่มีวันที่) ต้องไม่ทำตัวตัดคลังพัง', () => {
  const all = [...mk(402), null, { id: 'x' }];
  const out = pickCasesToPurge(all, 400);
  assert.ok(Array.isArray(out), 'ต้องคืนอาเรย์เสมอ');
  assert.ok(out.every(c => c && c.id), 'ต้องไม่มี null หลุดเข้ารายการลบ');
});
