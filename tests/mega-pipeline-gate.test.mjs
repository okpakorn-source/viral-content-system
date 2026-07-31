// ============================================================
// 🛑 เทสประตูปิดท่อปก MEGA (31 ก.ค. 69 — เจ้าของสั่งปิดท่อ + ถอดออกจาก UI)
// ------------------------------------------------------------
// พิสูจน์ 3 เรื่องที่สำคัญที่สุด:
//   1) ค่าเริ่มต้น = ปิด (ไม่ต้องตั้ง env ที่ไหนเลย — Vercel/เครื่องทีมไม่มี env ก็ปิด)
//   2) เปิดคืนได้ด้วย MEGA_PIPELINE=1 เป๊ะๆ เท่านั้น (ค่าอื่นถือว่าปิด กันตั้งพลาดแล้วเปิดเอง)
//   3) 🔴 ไม่กระทบระบบอื่น: งานโต๊ะข่าว desk_* ต้องไม่ถูกประตูนี้จับเด็ดขาด
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  megaPipelineOn, megaPipelineOff, isCoverJobKind, megaOffPayload, MEGA_COVER_JOB_KINDS,
} from '../src/lib/megaPipelineGate.js';

test('ค่าเริ่มต้น = ท่อปกปิด (ไม่มี env ก็ปิด)', () => {
  assert.equal(megaPipelineOn({}), false);
  assert.equal(megaPipelineOff({}), true);
  assert.equal(megaPipelineOn({ MEGA_PIPELINE: '' }), false);
  // ★ ผู้ตรวจจับได้: ส่ง undefined = ใช้ default parameter (process.env จริง) ไม่ใช่ "env ว่าง"
  //   → เทสจะแดงทุกครั้งที่ใครเปิดท่อคืนอย่างถูกต้อง · ใช้ null แทน (ผ่าน default ไม่ทำงาน = ทดสอบ optional chain จริง)
  assert.equal(megaPipelineOn(null), false, 'env เป็น null ต้องไม่ throw และถือว่าปิด');
});

test('เปิดคืนได้ด้วย MEGA_PIPELINE=1 เท่านั้น', () => {
  assert.equal(megaPipelineOn({ MEGA_PIPELINE: '1' }), true);
  assert.equal(megaPipelineOff({ MEGA_PIPELINE: '1' }), false);
  for (const v of ['0', 'true', 'yes', 'on', '1 ', '01', 'TRUE']) {
    assert.equal(megaPipelineOn({ MEGA_PIPELINE: v }), false, `ค่า "${v}" ต้องยังถือว่าปิด`);
  }
});

test('จับเฉพาะงานปก — งานโต๊ะข่าว/ค่าแปลกต้องผ่าน (ห้ามกระทบระบบอื่น)', () => {
  assert.deepEqual(MEGA_COVER_JOB_KINDS, ['compose', 'ref']);
  assert.equal(isCoverJobKind('compose'), true);
  assert.equal(isCoverJobKind('ref'), true);
  for (const k of ['desk_harvest', 'desk_search', 'desk_chief']) {
    assert.equal(isCoverJobKind(k), false, `${k} = งานโต๊ะข่าว ห้ามโดนประตูปกจับ`);
  }
  for (const k of ['', null, undefined, 'composer', 'reference', 'REF']) {
    assert.equal(isCoverJobKind(k), false, `ค่า "${k}" ไม่ใช่ kind งานปกที่รู้จัก`);
  }
  assert.equal(isCoverJobKind(' ref '), true, 'ช่องว่างหัวท้ายต้องถูกตัดก่อนเทียบ');
});

test('payload ปฏิเสธมีรูปแบบตามกติกาโปรเจกต์ (success/error/errorType)', () => {
  const p = megaOffPayload();
  assert.equal(p.success, false);
  assert.equal(p.errorType, 'MEGA_PIPELINE_DISABLED');
  assert.match(p.error, /MEGA_PIPELINE=1/, 'ข้อความต้องบอกวิธีเปิดคืน');
  assert.ok(typeof p.error === 'string' && p.error.length > 10);
});
