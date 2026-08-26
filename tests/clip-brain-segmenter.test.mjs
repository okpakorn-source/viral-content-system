/**
 * 🧪 clip-brain-segmenter.test.mjs — ข้อสอบ clipSegmenter.js (CB-08 + CB-13 · 26 ส.ค. 69)
 * ------------------------------------------------------------------
 * ครอบ 2 บั๊กที่ช่างซ่อมรายงานว่าแก้แล้ว:
 *   CB-08 (สูง)  path traversal ผ่าน s.no → ชื่อไฟล์ต้องมาจาก index ในลูปเท่านั้น (segFileName)
 *   CB-13 (กลาง) option ไม่ถูก clamp → cutTimeoutMs/height/maxBytes/audioK/minBytes ต้อง clamp ทุกตัว (clampSegOpts)
 *
 * 🔄 26 ส.ค. 69 (รอบ 2): ช่างซ่อมปิด CB-13 เพิ่มอีก 2 จุดที่โซลชี้ว่า "บางส่วน":
 *   (1) minBytes ตอนนี้มี ceiling = o.maxBytes แล้ว (เดิมไม่มี ceiling เลย ผ่านตรงๆ) — เทสเดิมที่เคย
 *       บันทึกพฤติกรรมบั๊กนี้ไว้เป็น "ข้อสังเกต" (บรรทัด ~204 ของรอบก่อน) ถูกแทนที่เป็นเทสยืนยัน fix จริงแล้ว
 *       ดูกลุ่ม 2 หัวข้อ "minBytes ceiling"
 *   (2) cutSegments() เดิม slice(0,32) เงียบแล้วเทียบ length กับ list ที่ถูกตัดไปแล้ว (out.length < segList.length
 *       เทียบผิดตัว) → ตอนนี้เปลี่ยนเป็น reject ทันที {ok:false, errorType:'SEG_TOO_MANY'} ก่อนเริ่มผ่า เมื่อ
 *       segments.length > MAX_SEGMENTS ไม่มี slice หลงเหลือแล้ว — ⚠️**ไม่มีเทส behavioral จุดนี้ในไฟล์นี้**
 *       เหตุผลละเอียดอยู่ในกลุ่ม 3 (คำอธิบายก่อนกลุ่มเทส cutSegments) และในรายงานมือข้อสอบท้ายงาน
 *
 * 🚫 ขอบเขตตามกติกาที่ได้รับ: ห้ามยิง ffmpeg จริง — "ffmpeg เทสเฉพาะ helper บริสุทธิ์"
 *   segFileName() และ clampSegOpts() เป็น pure function เทสได้เต็มที่ตรงๆ
 *   cutSegments() เทสได้เฉพาะ 2 จุดที่ return ก่อนถึง hasFfmpeg() (SEG_NO_INPUT/SEG_NO_PLAN)
 *   เพราะทุกเส้นทางถัดจากนั้น (MAX_SEGMENTS check, normalizeSegNo ใน warnings, isInsideDir ในลูปจริง)
 *   ต้องผ่าน hasFfmpeg() ก่อน ซึ่งยิง execFile('ffmpeg') จริงเสมอบนเครื่องที่มี ffmpeg ติดตั้ง (เครื่องนี้มี) —
 *   จึงงดเทสจุดนั้นตามกติกา ไม่ได้แปลว่าไม่มีค่า MAX_SEGMENTS/normalizeSegNo อยู่จริง (ดูรายงานมือข้อสอบประกอบ)
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { join, relative, isAbsolute, sep } from 'node:path';
import { tmpdir } from 'node:os';

const { segFileName, clampSegOpts, cutSegments, SEG_DEFAULTS } = await import(
  new URL('../src/lib/services/clipBrain/clipSegmenter.js', import.meta.url).href
);

// ---------- oracle อิสระ: ตรวจว่า path p หลุดออกจาก dir หรือไม่ ----------
// เขียนเองจาก node:path ล้วน (ไม่ได้อ่าน/อ้างอิงฟังก์ชัน isInsideDir ภายในซอร์ส — คนละตัวกัน คนละที่มา)
// ใช้เป็นกรรมการอิสระตรวจผลลัพธ์จริงของ segFileName เท่านั้น
function escapesDir(dir, p) {
  const rel = relative(dir, p);
  if (rel === '') return false; // p === dir พอดี ไม่ถือว่าหลุด
  if (isAbsolute(rel)) return true; // คนละ drive/root (Windows) → relative คืน absolute path
  if (rel === '..' || rel.startsWith('..' + sep) || rel.startsWith('../')) return true;
  return false;
}

// ============================================================
// กลุ่ม 1: segFileName(index) — แก้ CB-08 (path traversal ผ่าน s.no)
// ============================================================

test('segFileName: index ปกติ 1-32 (ช่วงที่ MAX_SEGMENTS อนุญาต) ได้ seg{n}.mp4 ตรงตัวทุกค่า', () => {
  for (let i = 1; i <= 32; i++) {
    assert.equal(segFileName(i), `seg${i}.mp4`);
  }
});

test('segFileName: ทศนิยมถูกปัดลง (floor) ไม่ปัดขึ้น', () => {
  assert.equal(segFileName(3.9), 'seg3.mp4');
  assert.equal(segFileName(1.999), 'seg1.mp4');
  assert.equal(segFileName(2.0001), 'seg2.mp4');
});

test('segFileName: string ตัวเลขที่แปลงได้ยังใช้งานปกติ (เผื่อเรียกด้วย index ที่มาเป็น string)', () => {
  assert.equal(segFileName('7'), 'seg7.mp4');
  assert.equal(segFileName('  5  '), 'seg5.mp4');
});

test('🔒 CB-08 — path traversal string ทุกรูปแบบ (แบบที่เคยหลุดผ่าน s.no ได้จริง) ต้อง fallback เป็น seg1.mp4 เสมอ', () => {
  const attacks = [
    '/../../outside',
    '../../../etc/passwd',
    '..\\..\\windows\\system32',
    '/etc/passwd',
    'C:\\Windows\\System32\\config\\SAM',
    '....//....//etc/passwd',
    'seg1/../../../outside',
    '../',
    '..',
    '/',
    '\\',
    'a/../b',
  ];
  for (const evil of attacks) {
    const name = segFileName(evil);
    assert.equal(name, 'seg1.mp4', `index=${JSON.stringify(evil)} ต้อง fallback เป็น seg1.mp4 แต่ได้ "${name}"`);
  }
});

test('🔒 CB-08 — ไม่ว่า index จะเป็นค่าประหลาดแบบไหน (ที่เป็นไปได้จริงจาก JSON) ผลลัพธ์ต้องไม่มี "/" "\\" หรือ ".." หลุดออกมาเลย', () => {
  const weird = [
    null, undefined, NaN, Infinity, -Infinity, 0, -1, -999,
    {}, [], true, false, '', 'abc', '/../../outside', '../../../etc/passwd',
  ];
  for (const idx of weird) {
    const name = segFileName(idx);
    assert.ok(!name.includes('/'), `"${name}" (index=${JSON.stringify(idx)}) ต้องไม่มี "/"`);
    assert.ok(!name.includes('\\'), `"${name}" (index=${JSON.stringify(idx)}) ต้องไม่มี "\\"`);
    assert.ok(!name.includes('..'), `"${name}" (index=${JSON.stringify(idx)}) ต้องไม่มี ".."`);
  }
});

test('segFileName: index ที่ไม่ใช่จำนวนเต็มบวก (0/ติดลบ/NaN/Infinity/null/undefined/object/array) fallback เป็น seg1.mp4', () => {
  const fallbackCases = [0, -1, -999, NaN, Infinity, -Infinity, null, undefined, {}, [], '', 'abc', true, false];
  for (const idx of fallbackCases) {
    assert.equal(segFileName(idx), 'seg1.mp4', `index=${JSON.stringify(idx)}`);
  }
});

test('🔒 CB-08 (property test) — join(dir, segFileName(index)) ต้องไม่หลุดออกจาก dir เสมอ ไม่ว่า index จะเป็นอะไร (ตรวจด้วย path.relative จริง)', () => {
  const dir = join(tmpdir(), 'clipseg-oracle-test-dir');
  const attacks = [
    '/../../outside', '../../../etc/passwd', '..\\..\\windows\\system32',
    '/etc/passwd', '....//....//etc/passwd', 'a/../../b',
    null, undefined, NaN, Infinity, -1, 0, {}, [], '', 'abc',
  ];
  for (const idx of attacks) {
    const name = segFileName(idx);
    const outP = join(dir, name);
    assert.ok(!escapesDir(dir, outP), `index=${JSON.stringify(idx)} → segFileName="${name}" → outP="${outP}" หลุดออกจาก dir="${dir}"`);
  }
});

test('segFileName ไม่ throw ไม่ว่า index จะเป็นค่าอะไรก็ตามที่เป็นไปได้จาก JSON (fail-open ที่ตัวมันเอง)', () => {
  const anyJsonValue = [1, '1', null, undefined, NaN, Infinity, {}, [], '', 'x', true, false, -5, 0];
  for (const idx of anyJsonValue) {
    assert.doesNotThrow(() => segFileName(idx), `index=${JSON.stringify(idx)} ไม่ควร throw`);
  }
});

test('ข้อสังเกต (ไม่ใช่ path traversal): index ใหญ่ระดับ 1e21+ ได้ scientific notation ในชื่อไฟล์ แต่ยังไม่มี "/" หรือ ".." หลุด', () => {
  // ไม่เกิดจริงในทางปฏิบัติ เพราะ cutSegments วน idx แค่ 1..32 เท่านั้น — บันทึกไว้เป็นข้อสังเกต ไม่ใช่บั๊กที่ระบุ
  const huge = segFileName(1e21);
  assert.ok(!huge.includes('/') && !huge.includes('..'), `"${huge}" ต้องไม่มี path separator แม้จะไม่ตรง pattern segN.mp4 ปกติ`);
  assert.ok(huge.startsWith('seg') && huge.endsWith('.mp4'), `"${huge}" ยังต้องขึ้นต้น seg และจบ .mp4`);
});

// ============================================================
// กลุ่ม 2: clampSegOpts(opt) — แก้ CB-13 (option ไม่ถูก clamp)
// ============================================================

test('clampSegOpts: opt ผิดรูปทุกแบบ (null/undefined/string/array/number/boolean) ไม่ throw และได้ SEG_DEFAULTS ครบทุกฟิลด์', () => {
  const malformed = [null, undefined, 'not an object', [1, 2, 3], 42, true, false];
  for (const opt of malformed) {
    let out;
    assert.doesNotThrow(() => { out = clampSegOpts(opt); }, `opt=${JSON.stringify(opt)} ไม่ควร throw`);
    assert.deepEqual(out, SEG_DEFAULTS, `opt=${JSON.stringify(opt)} ต้องได้ default ครบ`);
  }
});

test('🔒 CB-13 — cutTimeoutMs=0 (เคยปิด timeout ของ execFile ไปเลย) ต้องถูกดันขึ้นเป็นขั้นต่ำ 10000ms ไม่ใช่ 0', () => {
  assert.equal(clampSegOpts({ cutTimeoutMs: 0 }).cutTimeoutMs, 10000);
});

test('🔒 CB-13 — cutTimeoutMs ติดลบ ต้องถูกดันขึ้นเป็นขั้นต่ำ 10000ms เช่นกัน', () => {
  assert.equal(clampSegOpts({ cutTimeoutMs: -5000 }).cutTimeoutMs, 10000);
  assert.equal(clampSegOpts({ cutTimeoutMs: -1 }).cutTimeoutMs, 10000);
});

test('🔒 CB-13 — cutTimeoutMs เกินเพดาน 30 นาที ต้องถูกกดลงเหลือ 1800000ms', () => {
  assert.equal(clampSegOpts({ cutTimeoutMs: 99999999 }).cutTimeoutMs, 30 * 60 * 1000);
  assert.equal(
    clampSegOpts({ cutTimeoutMs: Infinity }).cutTimeoutMs,
    SEG_DEFAULTS.cutTimeoutMs,
    'Infinity ไม่ finite ต้อง fallback เป็น default ไม่ใช่ถูกกดเป็น ceiling',
  );
});

test('clampSegOpts — cutTimeoutMs ผิดรูป (string ไม่ใช่ตัวเลข/undefined) fallback เป็น default 600000ms', () => {
  assert.equal(clampSegOpts({ cutTimeoutMs: 'abc' }).cutTimeoutMs, 600000);
  assert.equal(clampSegOpts({ cutTimeoutMs: undefined }).cutTimeoutMs, 600000);
});

test('clampSegOpts — height=0/ติดลบ ถูกดันขึ้นเป็นขั้นต่ำ 144', () => {
  assert.equal(clampSegOpts({ height: 0 }).height, 144);
  assert.equal(clampSegOpts({ height: -100 }).height, 144);
});

test('clampSegOpts — height เกิน 1080 ถูกกดลงเหลือ 1080', () => {
  assert.equal(clampSegOpts({ height: 5000 }).height, 1080);
});

test('clampSegOpts — height ผิดรูป (string/object/array หลายค่า) fallback เป็น default 480', () => {
  assert.equal(clampSegOpts({ height: 'abc' }).height, 480);
  assert.equal(clampSegOpts({ height: {} }).height, 480);
  assert.equal(clampSegOpts({ height: [1, 2, 3] }).height, 480);
});

test('clampSegOpts — maxBytes เป็น 0/ติดลบ/ผิดรูป fallback เป็น default (~19MB)', () => {
  assert.equal(clampSegOpts({ maxBytes: 0 }).maxBytes, SEG_DEFAULTS.maxBytes);
  assert.equal(clampSegOpts({ maxBytes: -500 }).maxBytes, SEG_DEFAULTS.maxBytes);
  assert.equal(clampSegOpts({ maxBytes: 'abc' }).maxBytes, SEG_DEFAULTS.maxBytes);
});

test('clampSegOpts — maxBytes เล็กเกินไปถูกดันขึ้นเป็นขั้นต่ำ 1MB, ใหญ่เกินไปถูกกดลงเหลือ 100MB', () => {
  assert.equal(clampSegOpts({ maxBytes: 500 }).maxBytes, 1024 * 1024);
  assert.equal(clampSegOpts({ maxBytes: 999999999999 }).maxBytes, 100 * 1024 * 1024);
});

test('clampSegOpts — audioK เป็น 0/ติดลบ/ผิดรูป fallback เป็น default 64', () => {
  assert.equal(clampSegOpts({ audioK: 0 }).audioK, 64);
  assert.equal(clampSegOpts({ audioK: -10 }).audioK, 64);
  assert.equal(clampSegOpts({ audioK: 'abc' }).audioK, 64);
});

test('clampSegOpts — audioK เล็กเกินไปถูกดันขึ้นเป็น 32, ใหญ่เกินไปถูกกดลงเหลือ 320', () => {
  assert.equal(clampSegOpts({ audioK: 5 }).audioK, 32);
  assert.equal(clampSegOpts({ audioK: 9999 }).audioK, 320);
});

test('clampSegOpts — minBytes ติดลบ/ผิดรูป fallback เป็น default 10000 แต่ 0 ใช้ได้ตรงๆ', () => {
  assert.equal(clampSegOpts({ minBytes: -1 }).minBytes, 10000);
  assert.equal(clampSegOpts({ minBytes: 'abc' }).minBytes, 10000);
  assert.equal(clampSegOpts({ minBytes: 0 }).minBytes, 0);
});

test('🔒 CB-13 (รอบ 2) — minBytes เวอร์เกิน (999999999999999) ต้องถูกกดเพดานเหลือเท่า maxBytes ไม่ใช่ผ่านตรงๆ อีกต่อไป', () => {
  // ก่อนแก้: ตัวเลขนี้ผ่านตรงๆ ไม่ถูกกดเพดาน (ดู git blame รอบก่อนของไฟล์นี้ — เคยเขียวตอนบั๊กยังอยู่)
  // ผลที่ตามมาจริงถ้าไม่ clamp: buf.length < o.minBytes เป็นจริงเสมอในลูปตัดของ cutSegments()
  // → ทุกท่อนถูกมองว่า "ไฟล์เล็กผิดปกติ" แล้วข้ามหมด → SEG_ALL_FAILED ทั้งที่ ffmpeg ตัดสำเร็จจริง
  const out = clampSegOpts({ minBytes: 999999999999999 });
  assert.equal(out.minBytes, SEG_DEFAULTS.maxBytes, 'ไม่ระบุ maxBytes เอง → เพดานคือ default maxBytes (~19MB) ไม่ใช่ 999999999999999 อีกต่อไป');
  assert.ok(out.minBytes <= out.maxBytes, 'minBytes ต้องไม่เกิน maxBytes ที่ clamp แล้วเสมอ');
});

test('🔒 CB-13 (รอบ 2) — minBytes เวอร์เกิน "maxBytes ที่กำหนดเอง" (ไม่ใช่ default) ต้อง clamp ตาม maxBytes ตัวนั้น', () => {
  // สำคัญ: ต้องอ้างอิง o.maxBytes ที่ clamp แล้ว (ผ่าน SEG_DEFAULTS+clamp มาก่อน) ไม่ใช่ผูกกับ default เฉยๆ
  // เคสนี้แยกจากเคส default เพื่อกันเทสที่ hardcode เทียบกับ SEG_DEFAULTS.maxBytes เพียวๆ แล้วบังเอิญผ่าน
  const custom = clampSegOpts({ minBytes: 999999999999999, maxBytes: 5 * 1024 * 1024 });
  assert.equal(custom.maxBytes, 5 * 1024 * 1024);
  assert.equal(custom.minBytes, 5 * 1024 * 1024, 'minBytes ต้อง clamp ตาม maxBytes ที่กำหนดเอง (5MB) ไม่ใช่ default (~19MB)');

  const custom2 = clampSegOpts({ minBytes: 999999999999999, maxBytes: 80 * 1024 * 1024 });
  assert.equal(custom2.minBytes, 80 * 1024 * 1024, 'maxBytes อื่นก็ต้องใช้เป็นเพดานของ minBytes เหมือนกัน ไม่ใช่ hardcode 19MB ไว้');
});

test('🔒 CB-13 (รอบ 2) — minBytes เท่ากับ maxBytes พอดี (boundary) ต้องผ่านได้ ไม่ error และไม่ถูกกดต่ำกว่า maxBytes', () => {
  const out = clampSegOpts({ minBytes: 10 * 1024 * 1024, maxBytes: 10 * 1024 * 1024 });
  assert.equal(out.minBytes, 10 * 1024 * 1024);
  assert.equal(out.maxBytes, 10 * 1024 * 1024);
});

test('clampSegOpts — minBytes ปกติที่ต่ำกว่า maxBytes อยู่แล้ว (ไม่ชนเพดานใหม่) ยังคงพฤติกรรมเดิมทุกอย่าง ไม่ถูกกระทบจากการแก้ CB-13', () => {
  assert.equal(clampSegOpts({ minBytes: 500000 }).minBytes, 500000);
  assert.equal(clampSegOpts({ minBytes: 1 }).minBytes, 1);
  assert.equal(clampSegOpts({}).minBytes, SEG_DEFAULTS.minBytes, 'ไม่ระบุเลย ยังได้ default 10000 เหมือนเดิม');
  assert.equal(clampSegOpts({ minBytes: 0 }).minBytes, 0, '0 ยังผ่านตรงๆ เหมือนเดิม ไม่ fallback ไม่ชนเพดาน');
});

test('🔒 CB-13 (รอบ 2, property test) — ไม่ว่า minBytes/maxBytes จะเป็นค่าอะไร ผลลัพธ์ต้องมี minBytes <= maxBytes เสมอ (invariant ที่ต้องเป็นจริงหลังแก้)', () => {
  const combos = [
    { minBytes: 999999999999999 },
    { minBytes: 999999999999999, maxBytes: 2 * 1024 * 1024 },
    { minBytes: 999999999999999, maxBytes: 100 * 1024 * 1024 },
    { minBytes: 9e15, maxBytes: 1024 * 1024 },
    { minBytes: 0 },
    { minBytes: -1 },
    { minBytes: 'abc' },
    { minBytes: SEG_DEFAULTS.maxBytes + 1, maxBytes: SEG_DEFAULTS.maxBytes },
    { minBytes: 999999999999999, maxBytes: 999999999999999 }, // maxBytes เองก็โดน clamp เหลือ 100MB ก่อน
    {},
  ];
  for (const opt of combos) {
    const out = clampSegOpts(opt);
    assert.ok(out.minBytes <= out.maxBytes, `opt=${JSON.stringify(opt)} → minBytes=${out.minBytes} ต้อง <= maxBytes=${out.maxBytes} เสมอ`);
  }
});

// ============================================================
// กลุ่ม 3: cutSegments() — เฉพาะ guard clause ที่ return ก่อนถึง hasFfmpeg() (ไม่แตะ ffmpeg จริง)
// (คำอธิบายเรื่อง MAX_SEGMENTS/SEG_TOO_MANY ที่ไม่มีเทส behavioral ในกลุ่มนี้ — ดูท้ายไฟล์)
// ============================================================

test('cutSegments: videoBuffer ผิดรูปทุกแบบ ได้ SEG_NO_INPUT เสมอ ไม่ throw แม้ opt จะเพี้ยนพร้อมกัน (fail-open)', async () => {
  const badBuffers = [null, undefined, Buffer.alloc(0), new Uint8Array([1, 2, 3]), [1, 2, 3], 'not a buffer', 42, {}];
  const weirdOpts = [null, undefined, 'garbage', [1, 2, 3], 42, true];
  for (let i = 0; i < badBuffers.length; i++) {
    const opt = weirdOpts[i % weirdOpts.length];
    const r = await cutSegments(badBuffers[i], [{ no: 1, startSec: 0, endSec: 5 }], opt);
    assert.equal(r.ok, false);
    assert.equal(r.errorType, 'SEG_NO_INPUT', `videoBuffer=${JSON.stringify(badBuffers[i])} opt=${JSON.stringify(opt)}`);
    assert.deepEqual(r.warnings, []);
  }
});

test('cutSegments: segments ผิดรูปทุกแบบ (เมื่อ videoBuffer ถูกต้อง) ได้ SEG_NO_PLAN เสมอ ไม่ throw', async () => {
  const buf = Buffer.from('x'.repeat(50));
  const badSegments = [null, undefined, [], 'not-array', 42, {}];
  for (const segs of badSegments) {
    const r = await cutSegments(buf, segs, {});
    assert.equal(r.ok, false);
    assert.equal(r.errorType, 'SEG_NO_PLAN', `segments=${JSON.stringify(segs)}`);
  }
});

test('cutSegments: ทุก combination ของ videoBuffer/segments/opt ที่ผิดรูปพร้อมกัน ต้อง resolve เป็น {ok:false} เสมอ ไม่มี throw หลุดจาก promise', async () => {
  const combos = [
    [null, null, null],
    [undefined, undefined, undefined],
    ['x', 'y', 'z'],
    [42, 42, 42],
    [[], [], []],
    [Buffer.alloc(0), {}, []],
    [true, false, 'x'],
  ];
  for (const [vb, segs, opt] of combos) {
    let r;
    await assert.doesNotReject(async () => { r = await cutSegments(vb, segs, opt); });
    assert.equal(r.ok, false);
    assert.equal(typeof r.errorType, 'string');
    assert.ok(r.errorType.startsWith('SEG_'), `errorType ต้องขึ้นต้น SEG_ ได้ "${r.errorType}"`);
  }
});

// ============================================================
// ⚠️ สิ่งที่ชุดนี้ "ไม่ได้" ตรวจ — MAX_SEGMENTS / errorType SEG_TOO_MANY (CB-13 รอบ 2 จุดที่ 2)
// ============================================================
// ซอร์ส cutSegments() (บรรทัด ~142-148 ของ clipSegmenter.js ปัจจุบัน) มีเงื่อนไข:
//   if (segments.length > MAX_SEGMENTS) return { ok:false, errorType:'SEG_TOO_MANY', ... };
// ก่อนจะกำหนด segList = segments (ไม่มี .slice() หลงเหลือแล้ว) — นี่คือ fix ของบั๊กเดิมที่ตัดเงียบ
// แล้วเทียบความครบกับ list ที่ถูกตัดไปแล้ว (out.length < segList.length เทียบผิดตัว)
//
// ชุดนี้ "ไม่มีเทส behavioral" ยืนยันเงื่อนไขนี้โดยตรง (เรียก cutSegments() จริงด้วย >32 segments แล้วเช็คว่า
// ได้ SEG_TOO_MANY) เพราะเงื่อนไขนี้อยู่**หลัง** `if (!(await hasFfmpeg()))` (บรรทัด ~135-137) เสมอ —
// ต้องผ่าน hasFfmpeg()===true ก่อนโค้ดจะไหลมาถึงเงื่อนไข MAX_SEGMENTS ได้ ซึ่งมีแค่ 2 ทางให้ hasFfmpeg()
// คืน true: (ก) ยิง execFile('ffmpeg',['-version']) จริง — ขัดกติกา "ห้ามยิง ffmpeg จริง" ที่ได้รับตรงๆ
// (ข) mock/stub มันจากภายนอก
//
// พยายามแล้วจริงจัง 2 ทาง ก่อนสรุปว่าทำไม่ได้ในขอบเขตนี้ (ทดลองบนเครื่องนี้ วันที่ 26 ส.ค. 69):
//   1) node:test's `t.mock.module()` (mock ทั้ง node:child_process ก่อน import clipSegmenter.js) —
//      ใช้งานได้จริง แต่ต้องมี flag `--experimental-test-module-mocks` ตอนรัน node ไม่งั้น throw
//      "t.mock.module is not a function" ทันที ถ้ารันด้วยคำสั่งมาตรฐาน `node --test` (ตามกติกาที่ได้รับ)
//      จะไม่มี flag นี้ → เทสจะพังทั้งไฟล์ (ถ้าไม่ feature-detect) หรือถูก skip เสมอในทางปฏิบัติจริง
//      (ถ้า feature-detect แล้ว skip) ซึ่งเท่ากับไม่มีเทสจุดนี้อยู่ดีเมื่อรันแบบมาตรฐาน
//   2) compile "fake ffmpeg.exe" ด้วย csc.exe (.NET Framework compiler ที่มีอยู่บนเครื่องนี้จริง ที่
//      C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe) วาง path นั้นไว้หน้า PATH แทน ffmpeg จริง
//      (ffmpeg.cmd ใช้ไม่ได้ — Node's execFile บน Windows โดย shell:false ไม่ resolve .cmd/.bat อัตโนมัติ
//      ต้องเป็น native .exe เท่านั้น) วิธีนี้เรียก cutSegments() จริงได้และได้ SEG_TOO_MANY ถูกต้องจริง
//      แต่พิสูจน์แล้วว่า **flaky จริง** — Windows Defender scan ไฟล์ .exe ที่เพิ่ง compile ใหม่ก่อนยอมให้
//      execute ทำให้การเรียกครั้งแรกหน่วงไม่แน่นอน (วัดจริงได้ตั้งแต่ <100ms ถึง 10,102ms และบางรอบ
//      timeout ที่ 10s พอดีจน execFileAsync ล้มเหลวด้วย "spawn UNKNOWN"/ENOENT แบบสุ่ม ทั้งที่โค้ด
//      เทสเหมือนเดิมทุกตัวอักษร) — ไม่ deterministic พอจะใส่ในเทสสวีท จึงไม่ใช้แนวทางนี้
//
// ทางเลือกที่เหลือ (source-string matching เพื่อยืนยันว่าโค้ดมี pattern reject/ไม่มี .slice()) ไม่ใช้
// เพราะขัดกฎทีมตรงๆ: "ตรวจพฤติกรรมห้ามค้นคำ — การเรียกต่อทอดมองไม่เห็นจากการ grep" (memory:
// test-must-bite-mutation.md) — ค้นคำแค่ยืนยันว่าโค้ด "หน้าตา" เป็นแบบนั้น ไม่ได้พิสูจน์ว่ารันแล้วให้ผล
// ตามที่หน้าตาบอกจริง (เคยมีเคสจริงที่ไฟล์ไม่มีคำต้องห้ามแต่ฟีเจอร์พังเพราะเรียกต่อทอด)
//
// ข้อเสนอแนะ (บันทึกไว้ ไม่ได้แก้เอง — เป็นงานของช่างซ่อม/สถาปนิก ไม่ใช่มือข้อสอบ): ถ้าย้ายเงื่อนไข
// `segments.length > MAX_SEGMENTS` มาไว้**ก่อน** `if (!(await hasFfmpeg()))` (คือ validate แผนก่อน
// เช็คความพร้อมของเครื่องมือ — ปกติ cheap-check ควรมาก่อน I/O-bound check อยู่แล้วตามหลัก fail-fast)
// จุดนี้จะเทสได้แบบ behavioral เต็มรูปแบบโดยไม่ต้องพึ่ง ffmpeg เลย เพราะ reject จะเกิดก่อนถึง
// hasFfmpeg() เสมอ ไม่กระทบพฤติกรรมที่สังเกตได้จากภายนอกเลย (reject ก็คือ reject ไม่ว่าจะสลับลำดับกับ
// hasFfmpeg() หรือไม่ — ผู้เรียกไม่เคยเห็นความแตกต่าง)
// ============================================================
