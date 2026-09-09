/**
 * ข้อสอบมาตรการ B — ข้ามผู้ตรวจ AI เมื่องานสะอาดสองชั้น (เจ้าของเคาะ 9 ก.ย. 69)
 * ────────────────────────────────────────────────────────────────────────────
 * 🔴 จุดตายที่ต้องกัน:
 *   1. ข้ามทั้งที่งานไม่สะอาด = ของเสียหลุดถึงมือคน → ทุกเงื่อนไขต้องครบก่อนข้าม
 *   2. โมดูลถูกต้องแต่ท่อไม่ได้เรียกใช้ = จ่ายค่าผู้ตรวจฟรีต่อไป → เช็คการเดินสายในไฟล์ท่อจริง
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldSkipReviewer } from '../src/lib/services/clipBrain/reviewerGate.js';

test('ข้ามได้เฉพาะ: v2 ผ่านจริง (boolean) + ชั้นโค้ดจุดสูง = 0 + ไม่ได้บังคับตรวจ', () => {
  assert.equal(shouldSkipReviewer({ v2Ok: true, codeHighCount: 0, forceReview: false }), true);
});

test('v2 ไม่ผ่าน/ค่าเพี้ยน → ห้ามข้ามทุกกรณี', () => {
  for (const v2Ok of [false, undefined, null, 'true', 1, {}]) {
    assert.equal(shouldSkipReviewer({ v2Ok, codeHighCount: 0, forceReview: false }), false,
      `v2Ok=${JSON.stringify(v2Ok)} ต้องไม่ข้าม`);
  }
});

test('ชั้นโค้ดมีจุดสูง หรือนับไม่ได้ → ห้ามข้าม (นับไม่ได้ = ไม่รู้ว่าสะอาด)', () => {
  for (const codeHighCount of [1, 3, -1, 0.5, NaN, undefined, null, '0']) {
    assert.equal(shouldSkipReviewer({ v2Ok: true, codeHighCount, forceReview: false }), false,
      `codeHighCount=${String(codeHighCount)} ต้องไม่ข้าม`);
  }
});

test('CLIP_REVIEWER_ALWAYS (forceReview) ชนะทุกอย่าง — งานสะอาดก็ต้องตรวจ', () => {
  assert.equal(shouldSkipReviewer({ v2Ok: true, codeHighCount: 0, forceReview: true }), false);
});

test('เรียกมือเปล่า/ไม่ครบ → ปลอดภัยไว้ก่อน (ตรวจ)', () => {
  assert.equal(shouldSkipReviewer(), false);
  assert.equal(shouldSkipReviewer({}), false);
  assert.equal(shouldSkipReviewer({ v2Ok: true }), false);
});

test('เดินสายจริงใน clipBrainPipeline.js — ผู้ตรวจอยู่หลังด่าน ไม่ใช่โมดูลลอย', () => {
  const src = readFileSync(new URL('../src/lib/services/clipBrain/clipBrainPipeline.js', import.meta.url), 'utf8');
  assert.match(src, /from '\.\/reviewerGate\.js'/, 'ต้อง import reviewerGate');
  assert.match(src, /shouldSkipReviewer\(\{/, 'ต้องเรียกด่านตัดสินจริง');
  assert.match(src, /v2Ok:\s*brain\.topicsV2\?\.ok === true/, 'เงื่อนไข v2 ต้องมาจากใบเสร็จ topicsV2 ตรงๆ');
  assert.match(src, /codeHighCount:[^\n]*severity === 'สูง'/, 'ต้องนับเฉพาะจุดความรุนแรง "สูง" ของชั้นโค้ด');
  assert.match(src, /CLIP_REVIEWER_ALWAYS/, 'ต้องมีสวิตช์บังคับตรวจกลับพฤติกรรมเดิม');

  const skipIdx = src.indexOf('if (reviewerSkipped)');
  const reviewerIdx = src.indexOf("label: 'ผู้ตรวจ'");
  assert.ok(skipIdx !== -1, 'ต้องมีกิ่งตัดสินข้าม');
  assert.ok(reviewerIdx > skipIdx, 'การเรียกผู้ตรวจต้องอยู่ "หลัง/ใต้" ด่านตัดสิน (อยู่ในกิ่ง else)');

  // ข้ามโดยตั้งใจ ≠ ผู้ตรวจล้ม — กิ่งข้ามห้ามลง degradations
  const elseIdx = src.indexOf('} else {', skipIdx);
  assert.ok(elseIdx > skipIdx, 'ต้องมีกิ่ง else ที่เรียกผู้ตรวจตามเดิม');
  const skipBranch = src.slice(skipIdx, elseIdx);
  assert.ok(!skipBranch.includes('degradations.push'), 'กิ่งข้ามห้ามนับเป็น degradation');

  // ใบเสร็จต้องบอกคนดูย้อนหลังว่า "ข้ามเพราะสะอาด" ไม่ใช่หายเงียบ
  assert.match(src, /reviewerSkipped: 'v2-hard0-code-clean'/, 'ต้องบันทึกเหตุผลข้ามลง brain.check');
});
