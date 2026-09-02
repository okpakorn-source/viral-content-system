// ★ 1 ก.ย. 69 — ด่านตรวจคำล้ม ห้ามรายงานว่า "สะอาด 100 คะแนน" (บั๊กระดับกลาง)
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/lib/correction/outputAuditService.js', import.meta.url), 'utf8')
  .replace(/^import .*$/mg, '')
  .replace(/^export /mg, '');
const { auditOutput } = new Function('callAI', `${src}\nreturn { auditOutput };`)(async () => ({}));

test('เกิด error ภายในด่านตรวจ → คะแนน 0 + ธง auditFailed + มี issue ให้ท่อเดินเส้นยาว', async () => {
  // content เป็นตัวเลข → .match ไม่มี → โยน error ใน try
  const r = await auditOutput({ content: 12345 });
  assert.equal(r.auditFailed, true);
  assert.equal(r.auditScore, 0);
  assert.ok(r.issues.length >= 1);
  assert.ok(/ล้ม|FAILED|error/i.test(r.summary), r.summary);
});

test('เนื้อสะอาดจริง → ยังได้ 100 และไม่มีธง', async () => {
  const r = await auditOutput({ content: 'วันนี้อากาศดี ชาวบ้านช่วยกันปลูกต้นไม้ริมทาง' });
  assert.equal(r.auditFailed, undefined);
  assert.equal(r.auditScore, 100);
});

test('คำต้องห้ามที่จับได้ ต้องแนบ pattern มากับ issue (ให้ด่านแก้ใช้กันชนเดิม)', async () => {
  const r = await auditOutput({ content: 'เขามีเลือดออกที่แขน' });
  const blood = r.issues.find(i => i.type === 'forbidden_word' && i.text === 'เลือด');
  assert.ok(blood, 'ต้องจับคำว่าเลือด');
  assert.ok(typeof blood.patternSource === 'string' && blood.patternSource.includes('เลือด'));
});
