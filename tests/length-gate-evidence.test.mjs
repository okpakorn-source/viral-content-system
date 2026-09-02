// ★ 1 ก.ย. 69 — กักทั้งก้อนต้องเหลือหลักฐาน (บั๊กระดับกลาง: ไม่รู้ว่าขาดกี่คำ เนื้อหายไปไหน)
import assert from 'node:assert/strict';
import test from 'node:test';
import { enforceTextNewsPublicationFloor } from '../src/lib/utils/publishablePostText.js';

const short = (n, tag) => ({ content: Array.from({ length: n }, (_, i) => `คำ${tag}${i}`).join(' '), style: tag });

test('ทุกฉบับสั้น → error ต้องบอกจำนวนคำแต่ละฉบับ แต่ห้ามแนบเนื้อร่าง (สัญญา R231)', () => {
  const v1 = short(30, 'ก'), v2 = short(40, 'ข');
  let err;
  try { enforceTextNewsPublicationFloor([v1, v2], { minimumWords: 146 }); }
  catch (e) { err = e; }
  assert.ok(err, 'ต้องโยน error');
  assert.equal(err.errorType, 'TEXT_NEWS_LENGTH_REVIEW_REQUIRED');
  const g = err.lengthGate;
  assert.ok(g && Array.isArray(g.checks) && g.checks.length === 2);
  assert.ok(g.checks.every(c => Number.isInteger(c.wordCount) && c.wordCount > 0));
  assert.match(err.message, /V1=\d+ คำ, V2=\d+ คำ/, `ข้อความต้องบอกจำนวนคำทุกฉบับ: ${err.message}`);
  assert.equal(JSON.stringify(g).includes('content'), false, 'ห้ามเผยร่างที่ถูกกักใน error');
});

test('มีฉบับผ่าน → ไม่โยน และคืนฉบับที่กักแยกไว้ตามเดิม', () => {
  const ok = short(160, 'ค'), bad = short(20, 'ง');
  const r = enforceTextNewsPublicationFloor([ok, bad], { minimumWords: 146 });
  assert.equal(r.passingVersions.length, 1);
  assert.equal(r.quarantinedVersions.length, 1);
  assert.equal(r.passingVersions[0], ok);
});
