// ============================================================
// 🧪 บั๊ก "ตาคัดทิ้งเงียบทุกใบ" หลัง MEGA_CLUTTER_GUARD default ON (21 ก.ค. 69)
// ------------------------------------------------------------
// ลำดับเหตุ: ชั้นแรก (geminiClassifyFrames) validate ด้วย busyOn ตาม env → item มี busy/peopleCount
//   แต่ buildTriage (ชั้นสอง) ไม่ส่ง busyOn → sanitizeStrictClassifierItem ใช้ชุดคีย์ไม่มี busy
//   → guardExactObject เจอ key เกิน → null เงียบทุกใบ = tagged 0, failed 0 (production ตายทั้งระบบ 20-21 ก.ค.)
// พิสูจน์:
//   (a) item มี busy + strictOpts busyOn:true → ได้ triage (โค้ดใหม่)
//   (b) item มี busy + ไม่ส่ง busyOn (บั๊กเดิม) → null (reproduce บั๊ก — กันเผลอลบ busyOn ออกจาก caller)
//   (c) item ไม่มี busy + busyOn:false → ได้ triage (พฤติกรรมก่อน clutter เดิมเป๊ะ)
//   (d) live proof 21 ก.ค.: เคสจริง AC-0165 หลังแก้ → tagged 3/3 (เดิม 0)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTriage } from '../src/lib/libraryTriage.js';

const evidence = Object.freeze({
  requestedModel: 'gemini-2.5-flash', actualModel: null, actualModelVersion: null,
  modelMatchMode: 'exact', provider: 'gemini', schemaVersion: 'gemini-classify-frames.v1',
  attemptCount: 1, repairCount: 0,
});

const baseItem = () => ({
  index: 0, category: 'face-emotional', quality: 8, relevant: true, newsScene: true,
  person: 'ป๊อก ปิยธิดา', persons: ['ป๊อก ปิยธิดา'], emotion: 'warm', clean: true,
  faceCount: 1, faceBox: { x: 0.3, y: 0.1, w: 0.3, h: 0.35 }, peopleBox: null, note: 'ทดสอบ',
});
const busyItem = () => ({ ...baseItem(), busy: 0, peopleCount: 1 }); // ชุดคีย์ตอน CLUTTER ON (มี busy+peopleCount)

const src = { im: { id: 'IMG-1', source: 'google' }, realWidth: 1200, realHeight: 1500, measuredFrom: 'full' };
const opts = (extra = {}) => ({ strict: true, evidence, caseId: 'CASE-BUSY-PARITY', batchIndex: 0, resultIndex: 0, fileTagOn: true, ...extra });

test('(a) item มี busy + busyOn:true → ได้ triage (โค้ดใหม่ — สองชั้นชุดคีย์ตรงกัน)', () => {
  const t = buildTriage(busyItem(), src, opts({ busyOn: true }));
  assert.ok(t, 'ต้องได้ triage ไม่ใช่ null');
  assert.equal(t.busy, 0, 'ป้าย busy ต้องติดมาด้วย');
});

test('(b) item มี busy + ไม่ส่ง busyOn (บั๊กเดิม) → null — reproduce บั๊ก tagged 0', () => {
  const t = buildTriage(busyItem(), src, opts());
  assert.equal(t, null, 'ชุดคีย์ไม่ตรง (key เกิน) ต้อง null — คือเหตุ production ตาย 20-21 ก.ค.');
});

test('(c) item ไม่มี busy + busyOn:false → ได้ triage (พฤติกรรมก่อน clutter เดิมเป๊ะ)', () => {
  const t = buildTriage(baseItem(), src, opts({ busyOn: false }));
  assert.ok(t, 'เส้นเดิม (ไม่มี busy) ต้องไม่กระทบ');
});

test('(d) item ไม่มี busy + busyOn:true → null (fail-closed — คีย์ขาดต้องปฏิเสธ ไม่เดา)', () => {
  const t = buildTriage(baseItem(), src, opts({ busyOn: true }));
  assert.equal(t, null, 'ตาไม่ตอบ busy ทั้งที่โหมด ON = คำตอบไม่ครบสัญญา ต้องปฏิเสธ (audit ข้อเสนอ)');
});
