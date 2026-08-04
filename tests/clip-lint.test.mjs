// เทสด่านตรวจเชิงกลไกของเนื้อดิบคลิป (clipQualityLint) — ออฟไลน์ล้วน ไม่มี AI ไม่มีเน็ต
//   คุม 3 เรื่อง: (1) ชี้ภาษาที่ไม่ควรมี โดยไม่แตะคำพูดจริง (2) คลิปมีคนพูดต้องมีคำพูดในเนื้อ
//                (3) ประเด็นย่อยครอบคลุมคลิปพอไหม — และ "คลิปเรื่องเดียว" ต้องไม่ถูกตีเป็นปัญหา
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintLanguage, lintQuotePresence, lintTopicCoverage } from '../src/lib/services/clipQualityLint.js';

const types = (findings) => findings.map((f) => f.type);

// ───────────── 1) lintLanguage ─────────────

test('lintLanguage: จับครบทั้ง 5 หมวด', () => {
  assert.deepEqual(types(lintLanguage('สุดท้ายฝากกดติดตามช่องด้วยครับ')), ['cta']);
  assert.deepEqual(types(lintLanguage('อินฟลูเอนเซอร์ชื่อดังโพสต์ภาพ')), ['identity_label']);
  assert.deepEqual(types(lintLanguage('ชาวเน็ตแห่เข้าไปคอมเมนต์จำนวนมาก')), ['viral_trend']);
  assert.deepEqual(types(lintLanguage('คลิปวิดีโอดังกล่าวเผยให้เห็นชายคนหนึ่งยืนอยู่')), ['meta_narration']);
  assert.deepEqual(types(lintLanguage('ในคลิปนี้ชายคนหนึ่งยืนอยู่หน้าร้าน')), ['meta_narration']);
});

test('lintLanguage: รายงานข้อความจริงที่เจอ (ไม่ใช่ชื่อกฎ)', () => {
  const found = lintLanguage('อินฟลูเอนเซอร์ชื่อดังเดินเข้าร้าน');
  assert.equal(found[0].match, 'อินฟลูเอนเซอร์ชื่อดัง', 'ต้องได้วลีเต็ม ไม่ใช่แค่ "ชื่อดัง"');
  assert.equal(lintLanguage('ดาราชื่อดังเดินเข้าร้าน')[0].match, 'ชื่อดัง');
});

test('lintLanguage: 🔴 คำในเครื่องหมายคำพูดคือคำพูดจริงของคนในคลิป ห้ามนับ', () => {
  assert.deepEqual(lintLanguage('เจ้าตัวบอกว่า "ฝากกดไลก์กดแชร์ด้วยนะครับ" แล้วเดินออกไป'), []);
  assert.deepEqual(lintLanguage('เจ้าตัวบอกว่า “ฝากกดติดตามช่องด้วย” แล้วเดินออกไป'), []);
  assert.deepEqual(lintLanguage('พิธีกรพูดว่า “ในคลิปนี้เราจะไปดูกัน” ก่อนเริ่มรายการ'), []);
});

test('lintLanguage: คำนอกเครื่องหมายคำพูดยังต้องโดนจับ แม้ในย่อหน้าเดียวกับคำพูด', () => {
  const found = lintLanguage('เจ้าตัวบอกว่า "ฝากกดไลก์ด้วยนะ" จากนั้นชาวเน็ตแห่เข้าไปคอมเมนต์');
  assert.deepEqual(types(found), ['viral_trend']);
  assert.equal(found[0].match, 'ชาวเน็ตแห่');
});

test('lintLanguage: ข้อคิดปิดท้าย นับเฉพาะเมื่ออยู่ 25% ท้าย (กลางเรื่อง = มักเป็นคำที่คนในคลิปพูดเอง)', () => {
  const filler = 'ก'.repeat(500);
  assert.deepEqual(lintLanguage(`เรื่องนี้เป็นแรงบันดาลใจให้หลายคน ${filler}`), [], 'อยู่ต้นเรื่อง = ไม่นับ');
  const tail = lintLanguage(`${filler} เรื่องนี้กลายเป็นแรงบันดาลใจให้หลายคน`);
  assert.deepEqual(types(tail), ['moral_ending']);
  assert.equal(tail[0].match, 'กลายเป็นแรงบันดาลใจ');
});

test('lintLanguage: ข้อคิดปิดท้ายที่อยู่ในเครื่องหมายคำพูดท้ายเรื่อง ก็ยังห้ามนับ', () => {
  const filler = 'ก'.repeat(500);
  assert.deepEqual(lintLanguage(`${filler} เจ้าตัวทิ้งท้ายว่า “เรื่องนี้เป็นบทเรียนสำคัญของผม”`), []);
});

test('lintLanguage: ข้อความซ้ำรายงานครั้งเดียวต่อหมวด และอินพุตว่าง/พังต้องไม่พัง', () => {
  const repeated = lintLanguage('ชาวเน็ตแห่แชร์ ต่อมาชาวเน็ตแห่กดไลก์ ชาวเน็ตแห่ตามหา');
  assert.equal(repeated.filter((f) => f.type === 'viral_trend').length, 1);
  for (const bad of ['', '   ', null, undefined, 0, {}, []]) {
    assert.deepEqual(lintLanguage(bad), [], `อินพุต ${JSON.stringify(bad)} ต้องคืนอาเรย์ว่าง ไม่ throw`);
  }
});

test('lintLanguage: เรียกซ้ำต้องได้ผลเดิม (regex global ห้ามค้าง lastIndex)', () => {
  const text = 'ชาวเน็ตแห่เข้าไปคอมเมนต์';
  assert.deepEqual(lintLanguage(text), lintLanguage(text));
});

// ───────────── 2) lintQuotePresence ─────────────

test('lintQuotePresence: มีผู้พูด/คำพูดจากรอบแรก แต่เนื้อไม่มีคำพูด = ไม่ผ่าน', () => {
  const r = lintQuotePresence({ speakers: ['หญิงสาว'], quotes: ['ขอบคุณมาก'] }, 'หญิงสาวเดินเข้าไปขอบคุณเจ้าของร้าน');
  assert.deepEqual(r, { expected: true, present: false, ok: false });
});

test('lintQuotePresence: 🔴 ต้องนับอัญประกาศปิด ” ด้วย (บทเรียนเก่า: เช็คแค่ " กับ “ แล้วพลาด)', () => {
  const only = lintQuotePresence({ speakers: ['ก'] }, 'เจ้าตัวพูดว่า ขอบคุณครับ” ก่อนเดินออกไป');
  assert.equal(only.present, true);
  assert.equal(only.ok, true);
  assert.equal(lintQuotePresence({ speakers: ['ก'] }, 'เจ้าตัวพูดว่า “ขอบคุณครับ”').ok, true);
  assert.equal(lintQuotePresence({ speakers: ['ก'] }, 'เจ้าตัวพูดว่า "ขอบคุณครับ"').ok, true);
});

test('lintQuotePresence: note บอกว่าคลิปเงียบ = ไม่คาดหวังคำพูด (ผ่านเสมอ)', () => {
  const r = lintQuotePresence({ speakers: ['ชายคนหนึ่ง'], note: 'คลิปเงียบ ไม่มีเสียงพูดทั้งคลิป' }, 'ชายคนหนึ่งยกกล่องขึ้นรถ');
  assert.deepEqual(r, { expected: false, present: false, ok: true });
});

test('lintQuotePresence: ไม่มีข้อมูลรอบแรก/อินพุตพัง = ไม่คาดหวัง และต้องไม่ throw', () => {
  for (const bad of [null, undefined, {}, { speakers: [], quotes: [] }, { speakers: ['  '] }, 'ข้อความ', 7]) {
    const r = lintQuotePresence(bad, null);
    assert.equal(r.expected, false);
    assert.equal(r.ok, true);
  }
});

// ───────────── 3) lintTopicCoverage ─────────────

test('lintTopicCoverage: 🔴 คลิปเรื่องเดียว/ไม่มีช่วงเวลา = ถูกต้อง ห้ามตีเป็นปัญหา', () => {
  assert.deepEqual(lintTopicCoverage([], 600), { ok: true, gaps: [], coveredRatio: 1 });
  assert.deepEqual(lintTopicCoverage(null, 600), { ok: true, gaps: [], coveredRatio: 1 });
  assert.deepEqual(lintTopicCoverage([{ title: 'ก' }, { title: 'ข' }], 600), { ok: true, gaps: [], coveredRatio: 1 });
  assert.deepEqual(lintTopicCoverage([{ timeRange: 'ช่วงต้น' }], 600), { ok: true, gaps: [], coveredRatio: 1 });
});

test('lintTopicCoverage: ครอบเต็มคลิป = ผ่าน (รองรับขีดยาว – ที่พรอมต์ใช้จริง)', () => {
  const r = lintTopicCoverage([{ timeRange: '00:00–05:00' }, { timeRange: '05:00–10:00' }], 600);
  assert.deepEqual(r, { ok: true, gaps: [], coveredRatio: 1 });
});

test('lintTopicCoverage: ช่วงเวลาแบบชั่วโมง H:MM:SS ต้องอ่านออก และช่องโหว่กลางต้องถูกชี้', () => {
  const r = lintTopicCoverage([{ timeRange: '0:00:00-0:10:00' }, { timeRange: '1:00:00 - 1:10:00' }], 4200);
  assert.equal(r.ok, false);
  assert.deepEqual(r.gaps, [{ fromSec: 600, toSec: 3600 }]);
  assert.equal(r.coveredRatio, 0.286);
});

test('lintTopicCoverage: ช่องโหว่ไม่เกิน 3 นาที = ยอมรับได้ (ไม่ใช่ทุกวินาทีต้องมีประเด็น)', () => {
  const r = lintTopicCoverage([{ timeRange: '00:00-02:00' }, { timeRange: '04:00-10:00' }], 600);
  assert.equal(r.ok, true);
  assert.deepEqual(r.gaps, []);
  assert.equal(r.coveredRatio, 0.8);
});

test('lintTopicCoverage: ประเด็นหยุดกลางคลิป = ชี้ช่องโหว่ท้ายเรื่อง', () => {
  const r = lintTopicCoverage([{ timeRange: '00:00-02:00' }], 600);
  assert.equal(r.ok, false);
  assert.deepEqual(r.gaps, [{ fromSec: 120, toSec: 600 }]);
});

test('lintTopicCoverage: ไม่รู้ความยาวคลิป → วัดเทียบปลายประเด็นสุดท้าย (ห้ามเดาว่ามีช่องโหว่)', () => {
  assert.deepEqual(lintTopicCoverage([{ timeRange: '00:00-02:00' }], 0), { ok: true, gaps: [], coveredRatio: 1 });
  assert.deepEqual(lintTopicCoverage([{ timeRange: '00:00-02:00' }], undefined), { ok: true, gaps: [], coveredRatio: 1 });
});

test('lintTopicCoverage: ช่วงเวลาซ้อนกัน/สลับลำดับ/ผิดรูป ต้องไม่ทำให้ผลเพี้ยน', () => {
  const r = lintTopicCoverage([
    { timeRange: '05:00-10:00' },
    { timeRange: '00:00-06:00' },
    { timeRange: '10:00-05:00' },   // ปลายก่อนต้น = ผิดรูป ต้องถูกทิ้ง
    { timeRange: 'ไม่ระบุ' },
    null,
  ], 600);
  assert.deepEqual(r, { ok: true, gaps: [], coveredRatio: 1 });
});

test('lintTopicCoverage: ใช้คีย์ time แทน timeRange ได้ (ของเดิมบางเคสเก็บชื่อนี้)', () => {
  const r = lintTopicCoverage([{ time: '00:00-01:00' }], 60);
  assert.equal(r.ok, true);
});
