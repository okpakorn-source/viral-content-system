/**
 * 🧪 clip-brain-safe-text.test.mjs — ข้อสอบ clipSafeText.js (มือข้อสอบ 26 ส.ค. 69)
 * ------------------------------------------------------------------
 * ครอบคลุม 3 probe ที่เคยพังบนโค้ดเก่า (CB-14) หลังช่างซ่อมแก้:
 *   1. prototype pollution ผ่าน key __proto__/constructor/prototype ตอน deep-copy
 *   2. recursion ไม่มี depth guard → MAX_SANITIZE_DEPTH=32 (เกิน=คืนดิบ ห้าม throw)
 *   3. ไม่มี cycle guard → WeakSet + backtrack (seen.delete หลัง process แต่ละกิ่ง
 *      เพื่อไม่ให้ diamond reference ที่ไม่ใช่ cycle จริงโดนเข้าใจผิด)
 * เป็น pure function ล้วน ไม่มี network/AI/ffmpeg ให้ mock — เรียกฟังก์ชันจริงตรงๆ
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sanitizeClipString,
  sanitizeClipText,
  detectFilterCorruption,
  MUST_NOT_TOUCH,
  CLIP_SAFE_REV,
} from '../src/lib/services/clipBrain/clipSafeText.js';

// ---------- helper: env save/restore กันรั่วข้ามเทส ----------
function withClipSafeTextEnv(value, fn) {
  const saved = process.env.CLIP_SAFE_TEXT;
  if (value === undefined) delete process.env.CLIP_SAFE_TEXT;
  else process.env.CLIP_SAFE_TEXT = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.CLIP_SAFE_TEXT;
    else process.env.CLIP_SAFE_TEXT = saved;
  }
}

// ---------- helper: สร้าง/อ่าน object หรือ array ที่ซ้อนลึก n ชั้น ----------
function nestObject(n, leaf) {
  let cur = leaf;
  for (let i = 0; i < n; i++) cur = { child: cur };
  return cur;
}
function getAtDepth(obj, n) {
  let cur = obj;
  for (let i = 0; i < n; i++) cur = cur.child;
  return cur;
}
function nestArray(n, leaf) {
  let cur = leaf;
  for (let i = 0; i < n; i++) cur = [cur];
  return cur;
}
function getAtDepthArr(obj, n) {
  let cur = obj;
  for (let i = 0; i < n; i++) cur = cur[0];
  return cur;
}

// ==================== กลุ่ม A: sanitizeClipString พื้นฐาน (ไม่ได้แก้ — sanity) ====================

test('sanitizeClipString แทนวลีเสี่ยงตรงตามรายการ (ข่มขืน)', () => {
  assert.strictEqual(sanitizeClipString('ข่าวข่มขืนสะเทือนขวัญ'), 'ข่าวล่วงละเมิดทางเพศสะเทือนขวัญ');
});

test('sanitizeClipString แทนคำเดี่ยวรุนแรงที่คัดแล้วรายตัว (โหดเหี้ยม, สยองขวัญ)', () => {
  assert.strictEqual(sanitizeClipString('เหตุการณ์โหดเหี้ยม'), 'เหตุการณ์รุนแรงอย่างยิ่ง');
  assert.strictEqual(sanitizeClipString('บรรยากาศสยองขวัญ'), 'บรรยากาศสะเทือนขวัญ');
});

test('sanitizeClipString ไม่แตะคำในชุด MUST_NOT_TOUCH ทุกตัว (กันคำไทยเพี้ยนกลางคำ)', () => {
  for (const phrase of MUST_NOT_TOUCH) {
    assert.strictEqual(sanitizeClipString(phrase), phrase, `คำนี้ไม่ควรถูกแตะ: "${phrase}"`);
  }
});

test('sanitizeClipString รับ input ที่ไม่ใช่ string คืนค่าเดิมไม่ error', () => {
  assert.strictEqual(sanitizeClipString(123), 123);
  assert.strictEqual(sanitizeClipString(null), null);
  assert.strictEqual(sanitizeClipString(undefined), undefined);
  assert.strictEqual(sanitizeClipString(''), '');
  const obj = { a: 1 };
  assert.strictEqual(sanitizeClipString(obj), obj);
});

test('CLIP_SAFE_TEXT=0 ปิดการกรองของ sanitizeClipString ทั้งหมด', () => {
  withClipSafeTextEnv('0', () => {
    assert.strictEqual(sanitizeClipString('ข่าวข่มขืนสะเทือนขวัญ'), 'ข่าวข่มขืนสะเทือนขวัญ');
  });
});

// ==================== กลุ่ม B: sanitizeClipText deep traverse ปกติ (regression) ====================

test('sanitizeClipText แทนคำเสี่ยงใน object ซ้อนชั้นเดียว', () => {
  const result = sanitizeClipText({ title: 'คลิปหมกศพในป่า' });
  assert.strictEqual(result.title, 'คลิปซ่อนร่างผู้เสียชีวิตในป่า');
});

test('sanitizeClipText แทนคำเสี่ยงในทุก element ของ array', () => {
  const result = sanitizeClipText(['สยองขวัญ', 'ปกติ', 'โหดเหี้ยม']);
  assert.deepStrictEqual(result, ['สะเทือนขวัญ', 'ปกติ', 'รุนแรงอย่างยิ่ง']);
});

test('sanitizeClipText แทนคำเสี่ยงในโครงสร้างผสม object+array หลายจุดพร้อมกัน โดยไม่แก้ input เดิม', () => {
  const input = {
    title: 'คลิปเหตุการณ์หมกศพในป่า',
    tags: ['สยองขวัญ', 'ปกติ', 'โหดเหี้ยม'],
    meta: { desc: 'คนดูอึ้งทั้งประเทศ' },
  };
  const result = sanitizeClipText(input);
  assert.strictEqual(result.title, 'คลิปเหตุการณ์ซ่อนร่างผู้เสียชีวิตในป่า');
  assert.deepStrictEqual(result.tags, ['สะเทือนขวัญ', 'ปกติ', 'รุนแรงอย่างยิ่ง']);
  assert.strictEqual(result.meta.desc, 'คนดูเป็นที่วิพากษ์วิจารณ์'); // /อึ้งทั้งประเทศ/g แทนทั้งวลี ไม่เหลือ "ทั้งประเทศ" ต่อท้าย
  assert.strictEqual(input.title, 'คลิปเหตุการณ์หมกศพในป่า', 'input เดิมต้องไม่ถูกแก้ (สร้าง object ใหม่เสมอ)');
});

test('sanitizeClipText คง primitive อื่น (number/boolean/null/undefined) ที่เป็น field ของ object ไว้เหมือนเดิม', () => {
  const input = { count: 5, active: true, note: null, tag: undefined };
  const result = sanitizeClipText(input);
  assert.strictEqual(result.count, 5);
  assert.strictEqual(result.active, true);
  assert.strictEqual(result.note, null);
  assert.strictEqual(result.tag, undefined);
});

test('sanitizeClipText รับ string ตรงๆ ทำงานเหมือน sanitizeClipString (public signature เดิมไม่เปลี่ยน)', () => {
  assert.strictEqual(sanitizeClipText('เหตุการณ์ข่มขืนที่น่าสลด'), 'เหตุการณ์ล่วงละเมิดทางเพศที่น่าสลด');
});

test('sanitizeClipText กับ primitive ล้วน (number/boolean/null/undefined) คืนค่าเดิมไม่ error', () => {
  assert.strictEqual(sanitizeClipText(42), 42);
  assert.strictEqual(sanitizeClipText(true), true);
  assert.strictEqual(sanitizeClipText(null), null);
  assert.strictEqual(sanitizeClipText(undefined), undefined);
});

test('CLIP_SAFE_TEXT=0 ทำให้ sanitizeClipText คืน reference เดิมเป๊ะ (short-circuit ก่อนเข้า deep traverse)', () => {
  withClipSafeTextEnv('0', () => {
    const input = { a: 'ข่มขืน', b: ['ฆ่าตัวตาย'] };
    const result = sanitizeClipText(input);
    assert.strictEqual(result, input);
  });
});

test('public API surface: ไม่มีการ export ฟังก์ชัน/ค่าคงที่ภายในที่เพิ่มใหม่ (sanitizeClipTextDeep, UNSAFE_TRAVERSE_KEYS, MAX_SANITIZE_DEPTH)', async () => {
  const mod = await import('../src/lib/services/clipBrain/clipSafeText.js');
  assert.strictEqual(mod.sanitizeClipTextDeep, undefined);
  assert.strictEqual(mod.UNSAFE_TRAVERSE_KEYS, undefined);
  assert.strictEqual(mod.MAX_SANITIZE_DEPTH, undefined);
});

// ==================== กลุ่ม C: prototype pollution guard (CB-14) ====================

test('sanitizeClipText ข้าม key __proto__ ตอน traverse ไม่ pollute Object.prototype (สร้างด้วย defineProperty)', () => {
  const evil = { polluted: true };
  const malicious = {};
  Object.defineProperty(malicious, '__proto__', {
    value: evil, writable: true, enumerable: true, configurable: true,
  });
  malicious.safe = 'ข่มขืน';

  // ยืนยันก่อนว่า input สร้างถูกต้อง (เป็น own enumerable data property จริง ไม่ใช่แค่ตั้ง prototype เฉยๆ)
  assert.ok(Object.prototype.hasOwnProperty.call(malicious, '__proto__'));
  assert.strictEqual(Object.prototype.polluted, undefined, 'sanity ก่อนเทส');

  const result = sanitizeClipText(malicious);

  // จุดกัดจริง: out['__proto__']=... (bracket) เป็น accessor setter ที่สลับ [[Prototype]] ของ "ตัว out เอง"
  // เท่านั้น (ไม่ใช่ pollute Object.prototype ของทั้งระบบแบบ merge หลายชั้น) — ต้องเช็คที่ prototype ของ
  // result ตรงๆ ไม่ใช่ Object.prototype ของ process (ซึ่งจะเป็น undefined อยู่แล้วไม่ว่า guard จะทำงานหรือไม่)
  assert.strictEqual(Object.getPrototypeOf(result), Object.prototype, 'result ต้องมี prototype ปกติ ไม่ถูกสลับเป็น evil object');
  assert.strictEqual(result.polluted, undefined, 'ต้องไม่ inherit "polluted" ผ่าน prototype ที่ถูกสลับ');
  assert.strictEqual(Object.prototype.polluted, undefined, 'ห้าม pollute Object.prototype ของทั้งระบบ (กันไว้สองชั้น)');
  assert.strictEqual(({}).polluted, undefined, 'object ใหม่ที่สร้างหลังจากนี้ต้องไม่ติดพิษ');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result, '__proto__'), false, 'ผลลัพธ์ต้องไม่มี key __proto__ เป็น own property');
  assert.strictEqual(result.safe, 'ล่วงละเมิดทางเพศ', 'key ปลอดภัยอื่นต้องยัง sanitize ตามปกติ');
});

test('sanitizeClipText กัน prototype pollution จาก payload ที่ผ่าน JSON.parse (จำลองผลตอบ AI จริง)', () => {
  const raw = '{"__proto__":{"pollutedViaJson":true},"caption":"เหตุการณ์โหดเหี้ยม"}';
  const malicious = JSON.parse(raw);
  assert.ok(
    Object.prototype.hasOwnProperty.call(malicious, '__proto__'),
    'JSON.parse ต้องสร้าง __proto__ เป็น own property (สมมติฐานของเทสนี้)',
  );

  const result = sanitizeClipText(malicious);

  assert.strictEqual(Object.getPrototypeOf(result), Object.prototype, 'result ต้องมี prototype ปกติ ไม่ถูกสลับเป็น evil object');
  assert.strictEqual(result.pollutedViaJson, undefined, 'ต้องไม่ inherit ค่าพิษผ่าน prototype ที่ถูกสลับ');
  assert.strictEqual(Object.prototype.pollutedViaJson, undefined);
  assert.strictEqual(result.caption, 'เหตุการณ์รุนแรงอย่างยิ่ง'); // /โหดเหี้ยม/g แทนเฉพาะคำนั้น "เหตุการณ์" นำหน้ายังอยู่
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result, '__proto__'), false);
});

test('sanitizeClipText ข้าม key constructor และ prototype ตอน traverse (ไม่ copy เข้าผลลัพธ์)', () => {
  const obj = {
    constructor: { fake: true },
    prototype: { fake: true },
    safe: 'ฆ่าตัวตาย',
  };
  const result = sanitizeClipText(obj);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'constructor'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'prototype'), false);
  assert.strictEqual(result.safe, 'จบชีวิตตนเอง');
  assert.strictEqual(Object.getPrototypeOf(result), Object.prototype, 'ผลลัพธ์ต้องยังเป็น object ปกติ ไม่ถูกยึด prototype');
});

test('sanitizeClipText กัน prototype pollution ใน object ที่ซ้อนอยู่ลึก (ไม่ใช่แค่ชั้นบนสุด)', () => {
  const evil = { deepPolluted: true };
  const inner = {};
  Object.defineProperty(inner, '__proto__', {
    value: evil, writable: true, enumerable: true, configurable: true,
  });
  inner.safe = 'ข่มขืน';
  const outer = { level1: { level2: inner } };

  const result = sanitizeClipText(outer);

  assert.strictEqual(Object.getPrototypeOf(result.level1.level2), Object.prototype, 'level2 ต้องมี prototype ปกติ ไม่ถูกสลับเป็น evil object');
  assert.strictEqual(result.level1.level2.deepPolluted, undefined, 'ต้องไม่ inherit ค่าพิษผ่าน prototype ที่ถูกสลับ');
  assert.strictEqual(Object.prototype.deepPolluted, undefined);
  assert.strictEqual(result.level1.level2.safe, 'ล่วงละเมิดทางเพศ');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result.level1.level2, '__proto__'), false);
});

// ==================== กลุ่ม D: depth guard (MAX_SANITIZE_DEPTH=32) ====================

test('sanitizeClipText ที่ความลึกภายในเพดาน (10 ชั้น) sanitize คำเสี่ยงที่ leaf ได้ปกติ', () => {
  const nested = nestObject(10, 'ข่มขืน');
  const result = sanitizeClipText(nested);
  assert.strictEqual(getAtDepth(result, 10), 'ล่วงละเมิดทางเพศ');
});

test('sanitizeClipText ที่ความลึกพอดีเพดาน (32 ชั้นเป๊ะ) ยัง sanitize ได้ (ขอบเขตเพดานยังทำงาน)', () => {
  const nested = nestObject(32, 'ข่มขืน');
  const result = sanitizeClipText(nested);
  assert.strictEqual(getAtDepth(result, 32), 'ล่วงละเมิดทางเพศ');
});

test('sanitizeClipText เกินเพดาน 1 ชั้น (33) คืนค่าดิบไม่แตะ และไม่ throw', () => {
  const nested = nestObject(33, 'ข่มขืน');
  let result;
  assert.doesNotThrow(() => { result = sanitizeClipText(nested); });
  assert.strictEqual(getAtDepth(result, 33), 'ข่มขืน', 'เกินเพดานแล้วต้องคืนดิบ ไม่ถูกแทนคำ');
});

test('sanitizeClipText โครงสร้างซ้อนลึกมาก (5000 ชั้น) ไม่ throw stack overflow', () => {
  const nested = nestObject(5000, 'ข่มขืน');
  assert.doesNotThrow(() => sanitizeClipText(nested));
});

test('sanitizeClipText นับความลึกของ array ซ้อนเหมือน object (เพดานใช้ร่วมกัน ไม่แยกนับ)', () => {
  const over = nestArray(33, 'ข่มขืน');
  const resultOver = sanitizeClipText(over);
  assert.strictEqual(getAtDepthArr(resultOver, 33), 'ข่มขืน', 'array เกินเพดานก็ต้องคืนดิบเหมือน object');

  const within = nestArray(32, 'ข่มขืน');
  const resultWithin = sanitizeClipText(within);
  assert.strictEqual(getAtDepthArr(resultWithin, 32), 'ล่วงละเมิดทางเพศ');
});

// ==================== กลุ่ม E: cycle guard (WeakSet + backtrack) ====================

test('sanitizeClipText object อ้างตัวเอง (self-reference) ไม่ throw/ไม่ infinite loop', () => {
  const cyclic = { name: 'ข่มขืน' };
  cyclic.self = cyclic;

  let result;
  assert.doesNotThrow(() => { result = sanitizeClipText(cyclic); });
  assert.strictEqual(result.name, 'ล่วงละเมิดทางเพศ', 'key ปกติ (ไม่ใช่ cycle) ต้องยัง sanitize');
  assert.strictEqual(result.self, cyclic, 'เจอ cycle ต้องคืน reference เดิม ไม่ throw ไม่ clone ซ้ำ');
  assert.notStrictEqual(result, cyclic, 'top-level ต้อง clone เป็น object ใหม่ ไม่ mutate ของเดิม');
});

test('sanitizeClipText array อ้างตัวเอง (self-reference) ไม่ throw/ไม่ infinite loop', () => {
  const cyclic = ['ข่มขืน'];
  cyclic.push(cyclic);

  let result;
  assert.doesNotThrow(() => { result = sanitizeClipText(cyclic); });
  assert.strictEqual(result[0], 'ล่วงละเมิดทางเพศ');
  assert.strictEqual(result[1], cyclic);
});

test('sanitizeClipText diamond reference (object เดียวกันถูกอ้างจาก 2 จุดแต่ไม่ใช่ cycle) sanitize ถูกทั้งสองจุด (พิสูจน์ backtrack)', () => {
  const shared = { text: 'ข่มขืน' };
  const container = { a: shared, b: shared };

  const result = sanitizeClipText(container);

  // ถ้า seen.delete (backtrack) ไม่ทำงาน b จะได้ raw shared object กลับมา (text ยังเป็น 'ข่มขืน' ไม่ถูกแทน)
  // เพราะระบบเข้าใจผิดว่า shared คือ cycle ต่อจาก path a
  assert.strictEqual(result.a.text, 'ล่วงละเมิดทางเพศ');
  assert.strictEqual(result.b.text, 'ล่วงละเมิดทางเพศ');
  assert.notStrictEqual(result.a, shared, 'a ต้อง clone ใหม่ ไม่ใช่ reference เดิม');
  assert.notStrictEqual(result.b, shared, 'b ต้อง clone ใหม่เช่นกัน (ไม่ใช่ถูกมองว่าเป็น cycle ของ a)');
  assert.notStrictEqual(result.a, result.b, 'a กับ b ต้องเป็นคนละ object กัน (แยก clone คนละครั้ง)');
});

test('sanitizeClipText array แบบ diamond reference (array เดียวกันอ้างจาก 2 จุด) sanitize ถูกทั้งคู่ (พิสูจน์ backtrack ฝั่ง array)', () => {
  const shared = ['ข่มขืน'];
  const container = { a: shared, b: shared };
  const result = sanitizeClipText(container);
  assert.strictEqual(result.a[0], 'ล่วงละเมิดทางเพศ');
  assert.strictEqual(result.b[0], 'ล่วงละเมิดทางเพศ');
  assert.notStrictEqual(result.a, shared);
  assert.notStrictEqual(result.b, shared);
});

test('sanitizeClipText diamond reference ผสม cycle จริงแยกจุด ยังทำงานถูกทั้งสองแบบพร้อมกัน', () => {
  const shared = { text: 'โหดเหี้ยม' };
  const trueCyclic = { label: 'สยองขวัญ' };
  trueCyclic.loop = trueCyclic;

  const root = { branchA: shared, branchB: shared, branchC: trueCyclic };
  const result = sanitizeClipText(root);

  assert.strictEqual(result.branchA.text, 'รุนแรงอย่างยิ่ง');
  assert.strictEqual(result.branchB.text, 'รุนแรงอย่างยิ่ง');
  assert.notStrictEqual(result.branchA, result.branchB);
  assert.strictEqual(result.branchC.label, 'สะเทือนขวัญ');
  assert.strictEqual(result.branchC.loop, trueCyclic, 'cycle จริงยังต้องคืน raw reference');
});

// ==================== กลุ่ม F: detectFilterCorruption (ไม่ได้แก้ — regression sanity) ====================

test('detectFilterCorruption ตรวจพบร่องรอยตัวกรองกลางทำเพี้ยน (บรรยากาศ→ร่างผู้เสียชีวิต)', () => {
  const r = detectFilterCorruption('คลิปบรรยาการ่างผู้เสียชีวิติธีมอบรางวัล');
  assert.strictEqual(r.corrupted, true);
  assert.ok(r.sample);
});

test('detectFilterCorruption ไม่ติดธงข้อความปกติที่ไม่มีร่องรอยเพี้ยน', () => {
  const r = detectFilterCorruption('คลิปบรรยากาศพิธีมอบรางวัลตามปกติ');
  assert.strictEqual(r.corrupted, false);
  assert.strictEqual(r.sample, null);
});

test('detectFilterCorruption รับ object แปลงเป็น JSON string ก่อนตรวจ ไม่ error', () => {
  const r = detectFilterCorruption({ note: 'ทำให้เสียชีวิตเชื้อ' });
  assert.strictEqual(r.corrupted, true);
});

// ==================== กลุ่ม G: export sanity ====================

test('export CLIP_SAFE_REV เป็น string ไม่ว่าง', () => {
  assert.strictEqual(typeof CLIP_SAFE_REV, 'string');
  assert.ok(CLIP_SAFE_REV.length > 0);
});
