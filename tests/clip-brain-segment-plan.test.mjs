/**
 * 🧪 clip-brain-segment-plan.test.mjs — ข้อสอบ segmentPlan.js (B2 · 26 ส.ค. 69)
 * ------------------------------------------------------------------
 * segmentPlan.js เป็นตรรกะบริสุทธิ์ล้วน (ไม่แตะดิสก์/เน็ต/ffmpeg) — เรียกฟังก์ชันจริงตรงๆ
 * ทุก assertion ตัวเลขยืนยันจากการรันจริงก่อนเขียน (ไม่ใช่คำนวณเดา) — ดูคอมเมนต์ "ทำไม" กำกับแต่ละเคส
 *
 * ครอบ 4 จุดที่ช่างซ่อมแก้ 25-26 ส.ค.:
 *   #1 validatePlan ขั้น 4 — merge ท่อนสั้น 2 ทาง (shortSide = ปัจจุบันสั้น หรือ ก่อนหน้าสั้น)
 *   #2 fallbackPlan — ธง oversized เมื่อคลิปยาวเกินเพดานเงินจริง (maxSegments×maxSegmentSec)
 *   #3 sanitizeOptions — clamp ทุก option ก่อนใช้ (กัน 0/ลบ/NaN/เกินจริงหลุดเข้า loop)
 *   #4 validatePlan ขั้น 3 — เช็คเพดานจำนวนท่อนก่อนสร้าง array (กัน DoS จาก duration ผิดปกติ)
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const { toSec, parseRange, fallbackPlan, validatePlan, buildPlanPrompt } = await import(
  new URL('../src/lib/services/clipBrain/segmentPlan.js', import.meta.url).href
);

// ============================================================
// toSec — แปลงรูปแบบเวลาเป็นวินาที (หน่วยพื้นฐานที่ทุกฟังก์ชันอื่นพึ่งพา)
// ============================================================

test('toSec: number ปกติคืนตรงตัว (ปัดเศษ)', () => {
  assert.equal(toSec(83), 83);
  assert.equal(toSec(83.6), 84);
});

test('toSec: number ติดลบคืน null (เวลาติดลบไม่มีจริง)', () => {
  assert.equal(toSec(-5), null);
});

test('toSec: string ตัวเลขล้วน "83" คืน 83', () => {
  assert.equal(toSec('83'), 83);
});

test('toSec: "1:23" (นาที:วินาที) คืน 83 วินาที', () => {
  assert.equal(toSec('1:23'), 83);
});

test('toSec: "01:02:03" (ชม:นาที:วินาที) คืน 3723 วินาที', () => {
  assert.equal(toSec('01:02:03'), 3723);
});

test('toSec: ค่าว่าง/null/undefined คืน null', () => {
  assert.equal(toSec(''), null);
  assert.equal(toSec(null), null);
  assert.equal(toSec(undefined), null);
});

test('toSec: ข้อความอ่านไม่ออกคืน null (ไม่ throw)', () => {
  assert.equal(toSec('ไม่ใช่เวลา'), null);
});

// ============================================================
// parseRange — แยกช่วงเวลาจากบรรทัด timeline
// ============================================================

test('parseRange: "0:00–1:30" (en-dash) แยกเป็น startSec/endSec', () => {
  assert.deepEqual(parseRange('0:00–1:30'), { startSec: 0, endSec: 90 });
});

test('parseRange: "00:00-02:27" (hyphen ปกติ) แยกได้', () => {
  assert.deepEqual(parseRange('00:00-02:27'), { startSec: 0, endSec: 147 });
});

test('parseRange: ค่าเดียวไม่มีตัวคั่น คืน endSec:null', () => {
  assert.deepEqual(parseRange('1:30'), { startSec: 90, endSec: null });
});

test('parseRange: object {time:"..."} อ่านผ่าน field time ได้', () => {
  assert.deepEqual(parseRange({ time: '1:00-2:00' }), { startSec: 60, endSec: 120 });
});

test('parseRange: อ่านไม่ออกเลยคืน null', () => {
  assert.equal(parseRange('ขยะล้วนไม่มีเวลา'), null);
});

// ============================================================
// จุดซ่อม #3: sanitizeOptions ผ่าน fallbackPlan — clamp maxSegments
// ============================================================

test('🔒 fallbackPlan: maxSegments=0 ต้อง clamp เป็นอย่างน้อย 1 ท่อน (แผนสำรองต้องเดินต่อได้ ไม่คืน [] ว่างเปล่า)', () => {
  const segs = fallbackPlan(1000, { maxSegments: 0 });
  assert.ok(Array.isArray(segs));
  assert.equal(segs.length, 1, `ต้อง clamp เหลืออย่างน้อย 1 ท่อน แต่ได้ ${segs.length} ท่อน`);
  assert.equal(segs[0].startSec, 0);
  assert.equal(segs[0].endSec, 1000);
});

test('🔒 fallbackPlan: maxSegments ติดลบ (-5) ต้อง clamp เป็น 1 เช่นกัน', () => {
  const segs = fallbackPlan(1000, { maxSegments: -5 });
  assert.equal(segs.length, 1);
});

test('🔒 fallbackPlan: maxSegments เกินเพดาน (999) ต้อง clamp เหลือ 16 ไม่ปล่อยเกินจริง', () => {
  // คลิปยาวพอ (999*600วิ) เพื่อบังคับให้ n ชนเพดานจริงถ้าไม่ clamp (ceil(599400/600)=999)
  const segs = fallbackPlan(999 * 600, { maxSegments: 999 });
  assert.equal(segs.length, 16, `ต้อง clamp maxSegments เหลือ 16 (เพดานบน) แต่ได้ ${segs.length} ท่อน`);
});

test('🔒 fallbackPlan: maxSegments เป็น NaN/ไม่ใช่ตัวเลข ต้องถอยไปใช้ค่า default (8)', () => {
  const segs1 = fallbackPlan(999 * 600, { maxSegments: NaN });
  assert.equal(segs1.length, 8);
  const segs2 = fallbackPlan(999 * 600, { maxSegments: 'ไม่ใช่ตัวเลข' });
  assert.equal(segs2.length, 8);
});

// ============================================================
// จุดซ่อม #3: sanitizeOptions ผ่าน fallbackPlan — clamp maxSegmentSec
// ============================================================

test('🔒 fallbackPlan: maxSegmentSec เป็น 0 หรือติดลบ ต้อง clamp เป็นอย่างน้อย 1 วินาที (ไม่พังจากหารด้วยค่าที่ไม่สมเหตุสมผล)', () => {
  const segs0 = fallbackPlan(100, { maxSegmentSec: 0 });
  assert.ok(Array.isArray(segs0) && segs0.length > 0, 'ต้องยังคืนแผนได้ ไม่ throw');
  assert.equal(segs0.length, 8, `clamp เป็น 1วิ/ท่อน แต่ maxSegments เพดาน 8 → ต้องได้ 8 ท่อน แต่ได้ ${segs0.length}`);
  const segsNeg = fallbackPlan(100, { maxSegmentSec: -10 });
  assert.equal(segsNeg.length, 8);
});

test('🔒 fallbackPlan: maxSegmentSec เกินเพดาน (24 ชม.) ต้องถูก clamp เหลือ 86400 ไม่ปล่อยเกินจริง', () => {
  // duration 500,000 วิ: clamp ถูก (86400/ท่อน) → n=ceil(500000/86400)=6 ท่อน
  // ไม่ clamp (99999999/ท่อน) → n=ceil(500000/99999999)=1 ท่อน (ผิดเจตนา เพดานควรอยู่ 24ชม./ท่อน)
  const segs = fallbackPlan(500000, { maxSegmentSec: 99999999 });
  assert.equal(segs.length, 6, `ต้อง clamp maxSegmentSec เหลือ 86400 (24ชม.) แต่ได้ ${segs.length} ท่อน (เหมือนไม่ได้ clamp เลย)`);
});

// ============================================================
// จุดซ่อม #3: sanitizeOptions ผ่าน validatePlan — clampRatio(maxSkipRatio) ห้ามปัดเป็นจำนวนเต็ม
// ============================================================

test('🔒 validatePlan: maxSkipRatio default (0.12) ต้องไม่ถูกปัดเป็น 0 — skip 10% ต้องผ่านเพดาน 12%', () => {
  // คลิป 1000วิ ท่อนเดียวครอบ 900วิ = ข้าม 100วิ = 10% < 12% ต้องผ่าน
  // (ถ้า maxSkipRatio ถูกปัดด้วย clampInt แทน clampRatio จะกลายเป็น Math.round(0.12)=0 แล้ว reject ทุก skip>0%)
  const res = validatePlan([{ startSec: 0, endSec: 900, topics: [] }], 1000);
  assert.equal(res.ok, true, `skip 10% ต้องผ่านเพดาน default 12% แต่ ok=${res.ok} reason=${res.reason}`);
});

test('🔒 validatePlan: maxSkipRatio ที่ตั้งเอง (0.3) ยังคงค่าทศนิยมแม่นยำ ไม่ถูกปัดเป็น 0', () => {
  // skip 20% ด้วยเพดานตั้งเอง 30% — ถ้า clamp ปัดเป็นจำนวนเต็ม (Math.round(0.3)=0) จะ reject ผิด
  const res = validatePlan([{ startSec: 0, endSec: 800, topics: [] }], 1000, { maxSkipRatio: 0.3 });
  assert.equal(res.ok, true, `skip 20% ต้องผ่านเพดาน 30% แต่ ok=${res.ok} reason=${res.reason}`);
});

// หมายเหตุ: "maxSkipRatio เกิน 1 → clamp เหลือ 1" ไม่มีเทสแยกเพราะพิสูจน์ไม่ได้จริงในทางปฏิบัติ —
// skipped/dur มีเพดานธรรมชาติที่ 1 อยู่แล้ว (skipped<=dur เสมอ) ทำให้ "clamp เหลือ 1" กับ "ปล่อยเกิน 1 ตรงๆ"
// ให้ผล ok เหมือนกันทุกกรณี (mutation testing ยืนยันแล้ว: ลบ clamp บรรทัดนี้ออกก็ไม่ทำให้เทสไหนแดง) — ดู uncoveredConcerns

test('🔒 validatePlan: maxSkipRatio ติดลบต้องถูก clamp เป็น 0 (ไม่ใช่ปล่อยติดลบตรงๆ)', () => {
  // skip=0 พอดี (endSec เท่ากับ durationSec เป๊ะ, dur<=maxSegmentSec กันโดน split ปนสัญญาณ)
  // ถ้า maxSkipRatio ไม่ clamp (ยังเป็น -1): skipped/dur(0) > -1 เป็นจริงเสมอ → reject ทุกกรณีแม้ skip=0
  // ถ้า clamp ถูก (0): 0 > 0 เป็นเท็จ → ผ่าน
  const res = validatePlan([{ startSec: 0, endSec: 500, topics: [] }], 500, { maxSkipRatio: -1 });
  assert.equal(res.ok, true, `maxSkipRatio ติดลบต้อง clamp เป็น 0 (skip=0 ต้องผ่านได้) แต่ ok=${res.ok} reason=${res.reason}`);
});

// ============================================================
// จุดซ่อม #3: sanitizeOptions ผ่าน validatePlan — clamp edgeToleranceSec
// ============================================================

test('🔒 validatePlan: edgeToleranceSec เกินเพดาน (99999) ต้องถูก clamp ไม่เกิน 300 วินาที (กันมองช่องว่างไกลเป็นท่อนติดกัน)', () => {
  // ท่อนแรกสั้น (0-50) ห่างจากท่อนสอง (550-900) ถึง 500 วินาที — ตัวเลขเลือกให้อยู่ "ระหว่าง" เพดาน clamp (300) กับค่าที่ส่งมา (99999)
  // ถ้า clamp ถูก (<=300): 500>300 → ไม่ติดกัน → ไม่ merge → เหลือข้ามเนื้อ 500/900=56% เกินเพดาน 12% → ok:false
  // ถ้าไม่ clamp (คงเป็น 99999): 500<=99999 → มองว่าติดกัน → merge ข้ามช่องว่างทั้งก้อน → ครอบคลุมพอดี 900/900 → ok:true (ผิดเจตนา)
  const res = validatePlan(
    [{ startSec: 0, endSec: 50, topics: [] }, { startSec: 550, endSec: 900, topics: [] }],
    900,
    { edgeToleranceSec: 99999 },
  );
  assert.equal(res.ok, false, `edgeToleranceSec ต้องถูก clamp ไม่เกิน 300 — ถ้าไม่ clamp จะมองช่องว่าง 500วิ เป็นท่อนติดกันแล้ว merge ข้ามทั้งที่เนื้อหาย (ได้ ok=${res.ok})`);
});

// ============================================================
// จุดซ่อม #3: sanitizeOptions ผ่าน buildPlanPrompt — ต้องใช้ path เดียวกับอีก 2 ฟังก์ชัน
// ============================================================

test('🔒 buildPlanPrompt: ค่า option ที่ผิดรูปต้องถูก clamp ก่อนไปโผล่ในข้อความพรอมต์ (พิสูจน์ sanitizeOptions ถูกเรียกที่นี่ด้วย)', () => {
  const prompt = buildPlanPrompt({ durationSec: 1000, opt: { maxSegments: 0, maxSkipRatio: 50 } });
  assert.match(prompt, /ไม่เกิน 1 ท่อน/, 'maxSegments ต้องถูก clamp เป็น 1 ก่อนแสดงในพรอมต์ ไม่ใช่ "ไม่เกิน 0 ท่อน"');
  assert.match(prompt, /ไม่เกิน 100%/, 'maxSkipRatio ต้องถูก clamp ไม่เกิน 1 (100%) ก่อนแสดงในพรอมต์');
});

// ============================================================
// จุดซ่อม #2: fallbackPlan — ธง oversized เมื่อคลิปยาวเกินเพดานเงินจริง
// ============================================================

test('🔒 fallbackPlan(7200): คลิป 2 ชม. เกินเพดานเงิน (8×600=4800วิ) ต้องได้ 8 ท่อนละ 900วิ พร้อม oversized:true', () => {
  const segs = fallbackPlan(7200);
  assert.equal(segs.length, 8);
  for (const s of segs) assert.equal(s.endSec - s.startSec, 900, `แต่ละท่อนต้องยาว 900วิ ได้ ${s.endSec - s.startSec}`);
  assert.equal(segs.oversized, true, 'คลิปเกินเพดานเงินจริงต้องขึ้นธง oversized ให้ผู้เรียกรู้ ไม่ใช่เงียบๆ เกินงบ');
  // ครอบคลุมทั้งคลิปพอดี ไม่มีช่องว่าง/ทับกัน
  assert.equal(segs[0].startSec, 0);
  assert.equal(segs[segs.length - 1].endSec, 7200);
  for (let i = 1; i < segs.length; i++) {
    assert.equal(segs[i].startSec, segs[i - 1].endSec, `ท่อน ${i} ต้องต่อจากท่อนก่อนหน้าพอดี ไม่มีช่องว่าง`);
  }
});

test('🔒 fallbackPlan(1800): คลิป 30 นาที ไม่เกินเพดานเงิน ต้องได้ 3 ท่อนละ 600วิ พร้อม oversized:false', () => {
  const segs = fallbackPlan(1800);
  assert.equal(segs.length, 3);
  for (const s of segs) assert.equal(s.endSec - s.startSec, 600);
  assert.equal(segs.oversized, false);
});

test('🔒 fallbackPlan: ธง oversized เป็น property เสริมบน array จริง ไม่ทับ contract เดิม (ยัง Array.isArray/.map ได้ปกติ)', () => {
  const segs = fallbackPlan(7200);
  assert.ok(Array.isArray(segs), 'ยังต้องเป็น Array จริง');
  assert.equal(typeof segs.oversized, 'boolean');
  const nos = segs.map((s) => s.no); // .map ต้องไม่เอา .oversized ปนเข้ามาเป็น element
  assert.deepEqual(nos, [1, 2, 3, 4, 5, 6, 7, 8]);
});

// ============================================================
// จุดซ่อม #1 (CB-12 กลาง): validatePlan ขั้น 4 — merge ท่อนสั้น 2 ทาง
// ============================================================

test('🔒 validatePlan([0-30, 30-330], 330): ท่อนสั้นหัวแถว (30วิ < min 150) ต้องถูกรวมไปข้างหน้า ไม่หลุดรอด (probe หลักที่เคยพัง)', () => {
  const res = validatePlan(
    [{ startSec: 0, endSec: 30, topics: [] }, { startSec: 30, endSec: 330, topics: [] }],
    330,
  );
  assert.equal(res.ok, true, `ต้อง ok:true หลัง merge แต่ได้ reason=${res.reason}`);
  assert.equal(res.segments.length, 1, 'ต้องรวมเหลือ 1 ท่อน (ท่อนสั้นหัวแถวรวมเข้าท่อนถัดไป)');
  assert.equal(res.segments[0].startSec, 0);
  assert.equal(res.segments[0].endSec, 330);
  // invariant หลัก: ห้ามมีท่อนไหนสั้นกว่า minSegmentSec (150) หลุดออกไปในผลลัพธ์สุดท้าย
  for (const s of res.segments) {
    assert.ok(s.endSec - s.startSec >= 150, `ท่อน ${JSON.stringify(s)} สั้นกว่า minSegmentSec หลุดรอด — invariant รั่ว`);
  }
});

test('🔒 validatePlan: ท่อนสั้นกลางแถว (ไม่ใช่หัว/ท้ายแถว) ก็ต้องถูกรวมได้เช่นกัน', () => {
  // 3 ท่อน: [0-200(ปกติ)] [200-230(สั้น 30วิ)] [230-460(ปกติ 230วิ)]
  const res = validatePlan(
    [
      { startSec: 0, endSec: 200, topics: ['A'] },
      { startSec: 200, endSec: 230, topics: ['B'] },
      { startSec: 230, endSec: 460, topics: ['C'] },
    ],
    460,
  );
  assert.equal(res.ok, true);
  assert.equal(res.segments.length, 2, 'ท่อนสั้นกลางแถวต้องรวมกับท่อนก่อนหน้า เหลือ 2 ท่อน');
  assert.equal(res.segments[0].endSec, 230);
  assert.deepEqual(res.segments[0].topics.sort(), ['A', 'B']);
  for (const s of res.segments) assert.ok(s.endSec - s.startSec >= 150, `ท่อนสั้นกลางแถวหลุดรอด: ${JSON.stringify(s)}`);
});

test('🔒 validatePlan: ท่อนสั้นท้ายแถวยังถูกรวมย้อนกลับได้ตามเดิม (กัน regression ของเดิมพัง)', () => {
  // [0-300(ปกติ)] [300-320(สั้น 20วิ ท้ายแถว)]
  const res = validatePlan(
    [{ startSec: 0, endSec: 300, topics: [] }, { startSec: 300, endSec: 320, topics: [] }],
    320,
  );
  assert.equal(res.ok, true);
  assert.equal(res.segments.length, 1);
  assert.equal(res.segments[0].endSec, 320);
});

test('🔒 validatePlan: merge ไม่ยอมข้ามช่องว่างที่ไม่ติดกันจริง (เกิน edgeToleranceSec) → ท่อนสั้นที่เหลือค้างต้อง ok:false ไม่ใช่หลุดผ่าน (CB-12 รอบ 2)', () => {
  // ท่อนแรกสั้น (0-30) ห่างจากท่อนสอง 10วิ (เกิน edgeToleranceSec default 3วิ) — ห้ามมองว่าติดกัน จึงไม่ merge ข้าม
  // เดิมเทสนี้ล็อกว่า "merge ไม่ข้ามช่องว่าง" แล้วปล่อยท่อนแรก 30วิ (< minSegmentSec 150) หลุดออกไปพร้อม ok:true
  // (เพราะ skip รวมทั้งแผนต่ำแค่ 1% ผ่านเพดาน 12% — ขั้น 6 เช็คแค่ skip รวม ไม่เช็คทีละท่อน) — นี่คือบั๊ก CB-12 ที่โซล-สุดจับได้จริง
  // ที่ถูกต้อง: "ไม่ merge ข้ามช่องว่าง" ต้องแปลว่าท่อนสั้นนั้นไร้ทางออก (ไม่มีเพื่อนบ้านให้รวมได้จริง) → ต้อง ok:false
  // ให้ผู้เรียกถอยไปใช้ fallbackPlan แทนรับแผนที่ละเมิด invariant minSegmentSec
  const res = validatePlan(
    [{ startSec: 0, endSec: 30, topics: [] }, { startSec: 40, endSec: 1000, topics: [] }],
    1000,
  );
  assert.equal(res.ok, false, `ท่อนแรก 30วิ (<150) ค้างเพราะ merge ข้ามช่องว่างไม่ได้ ต้อง ok:false ให้ถอย fallback แต่ ok=${res.ok}`);
  assert.match(res.reason, /สั้นกว่าเพดาน/, `reason ต้องระบุว่าท่อนสั้นกว่าเพดานรวมไม่ได้ แต่ได้ "${res.reason}"`);
});

test('🔒 validatePlan: ท่อนที่รวมกันจะเกิน maxSegmentSec ต้องไม่ merge เกินเพดานเงินต่อท่อน', () => {
  // ท่อนแรกสั้น (0-30) ท่อนสอง (30-650, 620วิ เกิน maxSegmentSec 600 จึงโดนซอยขั้น 3 ก่อนเป็น 2 ท่อนย่อย 340+310)
  // จากนั้นขั้น 4 merge ท่อนแรก(30วิ)เข้ากับ chunk แรกหลังซอย (310วิ) ได้ (30+310=340<=600) แต่ chunk ที่สอง (310วิ) ไม่ merge ต่อ
  const res = validatePlan(
    [{ startSec: 0, endSec: 30, topics: [] }, { startSec: 30, endSec: 650, topics: [] }],
    650,
  );
  assert.equal(res.ok, true);
  assert.equal(res.segments.length, 2);
  assert.equal(res.segments[0].startSec, 0);
  assert.equal(res.segments[0].endSec, 340);
  assert.equal(res.segments[1].endSec, 650);
  for (const s of res.segments) {
    const len = s.endSec - s.startSec;
    assert.ok(len <= 600, `ท่อน ${JSON.stringify(s)} เกิน maxSegmentSec (600) — merge ต้องไม่ทำให้เกินเพดานเงิน`);
  }
});

// ============================================================
// จุดซ่อม #1 (CB-12 รอบ 3 — ขั้น 4.5 invariant สุดท้าย): มือข้อสอบเพิ่มเพื่อพิสูจน์ "ปิดสนิท"
// ไม่ใช่แค่ปิดช่องโหว่ที่มี gap อย่างเดียว — reason ของขั้น 4.5 อ้างสองสาเหตุ
// ("มีช่องว่างขวางหรือรวมแล้วเกินเพดานเงินต่อท่อน") ต้องพิสูจน์สาเหตุที่สอง (max) แยกจาก gap ด้วย
// และต้องพิสูจน์ข้อยกเว้น segs.length===1 ไม่ถูกจับผิดเป็นบั๊ก (กัน over-reject ในอนาคต)
// ============================================================

test('🔒 validatePlan: ท่อนสั้นกลางแถว "ติดกันจริง" ทั้ง 2 ข้าง (ไม่มี gap เลย) แต่ merge ไม่ได้เพราะเกิน maxSegmentSec ทั้งคู่ → ok:false (พิสูจน์สาเหตุ "max" ไม่ใช่แค่ "gap")', () => {
  // A(0-590,590วิ) B(590-620,30วิ<min150) C(620-1210,590วิ) — ทุกท่อนติดกันสนิท (edge=0<=tolerance3)
  // A+B=620>max(600) ไม่ merge ได้ · B+C=620>max(600) ไม่ merge ได้ → B ค้างเดี่ยวๆ ทั้งที่ไม่มี gap เลยสักจุด
  // เทสเดิม (CB-12 รอบ 2) พิสูจน์เฉพาะกรณี "มี gap" — เคสนี้พิสูจน์อีกสาเหตุที่ reason อ้างถึง (เกินเพดานเงิน) แยกกัน
  const res = validatePlan(
    [
      { startSec: 0, endSec: 590, topics: [] },
      { startSec: 590, endSec: 620, topics: [] },
      { startSec: 620, endSec: 1210, topics: [] },
    ],
    1210,
  );
  assert.equal(res.ok, false, `ท่อนกลาง 30วิ ติดกันสนิททั้ง 2 ข้างแต่เกิน max ทั้งคู่ ต้อง ok:false แต่ ok=${res.ok}`);
  assert.match(res.reason, /สั้นกว่าเพดาน/, `reason ต้องระบุท่อนสั้นกว่าเพดาน แต่ได้ "${res.reason}"`);
});

test('🔒 validatePlan: 2 ท่อนสั้นติดกันรวมกันเองในขั้น 4 (ไม่มี gap) แต่รวมแล้วยังสั้นกว่า min เพราะฝั่งขวามี gap ขวางไม่ให้รวมต่อ → ok:false', () => {
  // [0-20(สั้น)] ติดกับ [20-40(สั้น)] → ขั้น 4 รวมกันเองสำเร็จเป็น [0-40] (40วิ ยังสั้นกว่า min 150)
  // แล้วห่างจาก [50-500] ถึง 10วิ (เกิน edgeToleranceSec default 3วิ) → รวมต่อไม่ได้ → [0-40] ค้างเดี่ยวๆ
  // เคสนี้ต่างจาก probe หลัก (single 30วิ) ตรงที่ท่อนสั้นค้างเกิดจาก "รวมกันเองแล้วยังไม่พอ" ไม่ใช่ "ท่อนเดี่ยวสั้นตั้งแต่ต้น"
  const res = validatePlan(
    [
      { startSec: 0, endSec: 20, topics: [] },
      { startSec: 20, endSec: 40, topics: [] },
      { startSec: 50, endSec: 500, topics: [] },
    ],
    500,
  );
  assert.equal(res.ok, false, `[0-40] รวมกันเองแล้วยังสั้นกว่า min (150) ต้อง ok:false แต่ ok=${res.ok}`);
  assert.ok(res.warnings.some((w) => w.includes('รวมท่อนสั้น')), 'ต้องมี warning บันทึกว่าเคย merge 20+20 สำเร็จมาก่อนโดนเช็คขั้น 4.5 จับ');
  assert.match(res.reason, /สั้นกว่าเพดาน.*40/, `reason ต้องระบุความยาวรวมหลัง merge (40วิ) ไม่ใช่ความยาวท่อนเดี่ยวก่อน merge แต่ได้ "${res.reason}"`);
});

test('🔒 validatePlan: คลิปทั้งคลิปสั้นกว่า minSegmentSec เอง (เหลือท่อนเดียวหลัง merge) ต้อง ok:true — ไม่ใช่บั๊ก ไม่ใช่ merge ล้มเหลว', () => {
  // ท่อนเดียว 50วิ < minSegmentSec(150) แต่ไม่มีเพื่อนบ้านให้รวม (คลิปทั้งคลิปสั้นกว่า min เอง)
  // ถ้าขั้น 4.5 เช็ค tooShort โดยไม่มีเงื่อนไข segs.length>1 กันไว้ จะ reject เคสนี้ผิด (over-reject) ทั้งที่ fallbackPlan
  // ก็ให้ผลแบบเดียวกัน (ท่อนเดียวเท่าความยาวคลิป) ไม่มีประโยชน์ที่จะบังคับถอยไป fallback
  const res = validatePlan([{ startSec: 0, endSec: 50, topics: [] }], 50);
  assert.equal(res.ok, true, `คลิปสั้นกว่า min เองทั้งคลิป (ไม่มีเพื่อนบ้านให้รวม) ต้อง ok:true แต่ ok=${res.ok} reason=${res.reason}`);
  assert.equal(res.segments.length, 1);
  assert.equal(res.segments[0].startSec, 0);
  assert.equal(res.segments[0].endSec, 50);
});

// ============================================================
// จุดซ่อม #4: validatePlan ขั้น 3 (split ท่อนยาว) — เช็คเพดานก่อนสร้าง array (กัน DoS)
// ============================================================

test('🔒 validatePlan: ท่อนยาวผิดปกติเทียบ maxSegmentSec เล็ก ต้อง reject ทันที ไม่สร้าง array มหาศาลก่อน (กัน DoS)', { timeout: 2000 }, () => {
  // ท่อนเดียวยาว 100 ล้านวินาที + maxSegmentSec เล็กสุดที่ตั้งได้ (1) → parts = 100 ล้าน (เกินเพดานทุกกรณีแน่นอน)
  // ต้อง reject ก่อนวน for-loop สร้าง array 100 ล้าน element — วัดเวลาว่าเร็ว (guard ทำงานก่อนสร้าง array จริง)
  const t0 = Date.now();
  const res = validatePlan([{ startSec: 0, endSec: 100_000_000, topics: [] }], 100_000_000, { maxSegmentSec: 1 });
  const elapsed = Date.now() - t0;
  assert.equal(res.ok, false);
  assert.match(res.reason, /ซอยได้เกินเพดาน/, `reason ต้องระบุเหตุผลซอยเกินเพดาน แต่ได้ "${res.reason}"`);
  assert.ok(elapsed < 500, `ต้องตอบเร็ว (guard เช็คก่อนสร้าง array) แต่ใช้เวลา ${elapsed}ms — ถ้าช้า/ค้าง แปลว่าย้อนไปสร้าง array ก่อนเช็คเพดานอีกแล้ว`);
});

test('🔒 validatePlan: ท่อนยาวเกิน maxSegmentSec แต่จำนวน parts ไม่เกินเพดาน ยังซอยได้ปกติ (guard ไม่ over-reject)', () => {
  // ท่อนเดียวยาว 1500วิ, maxSegmentSec default 600 → parts=ceil(1500/600)=3 (ไม่เกินเพดาน maxSegments+1=9)
  const res = validatePlan([{ startSec: 0, endSec: 1500, topics: [] }], 1500);
  assert.equal(res.ok, true, `ท่อนยาวปกติ (ซอยได้ 3 ท่อน) ต้องผ่าน แต่ ok=${res.ok} reason=${res.reason}`);
  assert.equal(res.segments.length, 3);
  assert.deepEqual(res.segments.map((s) => s.endSec - s.startSec), [500, 500, 500]);
});

// ============================================================
// Sanity อื่นๆ ของ validatePlan (ไม่ใช่จุดที่ซ่อมรอบนี้ แต่ยังเป็นสัญญาที่ต้องคงอยู่)
// ============================================================

test('validatePlan: rawSegments ว่างเปล่า ต้อง ok:false พร้อมเหตุผล', () => {
  const res = validatePlan([], 100);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'สมองไม่ได้ส่งท่อนมา');
});

test('validatePlan: durationSec <= 0 ต้อง ok:false พร้อมเหตุผล', () => {
  const res = validatePlan([{ startSec: 0, endSec: 10, topics: [] }], 0);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'ไม่รู้ความยาวคลิป');
});

test('validatePlan: ท่อนทับกัน ต้องถูกแก้ (merge/ตัดขอบ) พร้อมขึ้น warning ไม่ throw', () => {
  const res = validatePlan(
    [{ startSec: 0, endSec: 100, topics: [] }, { startSec: 50, endSec: 200, topics: [] }],
    200,
  );
  assert.equal(res.ok, true);
  assert.ok(res.warnings.some((w) => w.includes('ทับกัน')), 'ต้องมี warning บอกว่าแก้ท่อนทับกัน');
});

test('validatePlan: จำนวนท่อนเกินเพดาน (ขั้น 5) ต้อง ok:false ระบุจำนวนจริง/เพดานในเหตุผล', () => {
  // 10 ท่อนแยกกันชัดเจน (minSegmentSec:1 กันโดน merge จนเหลือน้อยกว่า 10)
  const rawSegs = Array.from({ length: 10 }, (_, i) => ({ startSec: i * 200, endSec: i * 200 + 200, topics: [] }));
  const res = validatePlan(rawSegs, 2000, { maxSegments: 8, minSegmentSec: 1 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'ท่อนเกินเพดาน (10/8)');
});

test('validatePlan: ข้ามเนื้อเกิน maxSkipRatio ต้อง ok:false ระบุเปอร์เซ็นต์ในเหตุผล', () => {
  const res = validatePlan([{ startSec: 0, endSec: 100, topics: [] }], 1000); // skip 90%
  assert.equal(res.ok, false);
  assert.match(res.reason, /แผนข้ามเนื้อ 90%/);
});

// ============================================================
// fail-open: ต้องคืน {ok:false} เสมอ ไม่ throw exception หลุด แม้ input ประหลาด
// ============================================================

test('🔒 fail-open: validatePlan กับ input ประหลาด (null/undefined/ไม่ใช่ array/object พัง) ต้องไม่ throw', () => {
  for (const bad of [null, undefined, 'ไม่ใช่ array', 123, {}]) {
    assert.doesNotThrow(() => validatePlan(bad, 100), `validatePlan(${JSON.stringify(bad)}, 100) ต้องไม่ throw`);
    const res = validatePlan(bad, 100);
    assert.equal(res.ok, false);
  }
  // segment ที่ field เป็นค่าพัง (ไม่ใช่ number/string ที่ toSec รับได้) ต้องถูกข้าม ไม่ throw
  assert.doesNotThrow(() => validatePlan([{ startSec: {}, endSec: [] }, null, 'ขยะ', 42], 100));
});

test('🔒 fail-open: fallbackPlan กับ durationSec ประหลาด (NaN/string/ติดลบ/undefined) ต้องไม่ throw และคืน array เสมอ', () => {
  for (const bad of [NaN, 'ไม่ใช่ตัวเลข', -100, undefined, null]) {
    assert.doesNotThrow(() => fallbackPlan(bad), `fallbackPlan(${JSON.stringify(bad)}) ต้องไม่ throw`);
    const segs = fallbackPlan(bad);
    assert.ok(Array.isArray(segs) && segs.length > 0, `fallbackPlan(${JSON.stringify(bad)}) ต้องยังคืนอย่างน้อย 1 ท่อน (fail-open)`);
  }
});

test('🔒 fail-open: opt เป็นค่าประหลาด (null/string/array/number) ไม่ทำให้ sanitizeOptions พัง', () => {
  for (const bad of [null, 'ไม่ใช่ object', [], 42, undefined]) {
    assert.doesNotThrow(() => fallbackPlan(1000, bad));
    assert.doesNotThrow(() => validatePlan([{ startSec: 0, endSec: 500, topics: [] }], 1000, bad));
    assert.doesNotThrow(() => buildPlanPrompt({ durationSec: 1000, opt: bad }));
  }
});
