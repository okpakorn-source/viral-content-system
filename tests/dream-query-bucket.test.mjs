// ============================================================
// 🧪 dream-query-bucket.test.mjs — buildQueries รับ dreamQueries ใหม่ (เฟส A ข้อ 1, dormant)
// ------------------------------------------------------------
// บริบท: compassBrain ผลิต visualDreamShots (megaBrains.js:39-51) แต่ไม่เคยถูกป้อนเข้า buildQueries เลย
// เทสนี้พิสูจน์:
//   (a) dormant: ไม่ส่ง dreamQueries (2-arg เดิม / undefined / []) → ผลลัพธ์เหมือนกันทุกกรณี
//   (b) kill-switch MEGA_DREAM_QUERIES='0' → ปิดบัคเก็ตแม้ส่ง dreamQueries มาจริง (เท่า dormant เป๊ะ)
//   (c) เปิดใช้จริง: dream terms โผล่ในผลลัพธ์ (ผ่าน bindName ผูกชื่อเหมือน storyQueries) + เคารพ DREAM_SLOTS cap
//   (d) งบรวมไม่บวมเกินเดิม: ในเคสที่ pool = emoShowQ ล้วน (ไม่มี th/en/objq/story) ผลรวม length เท่าเดิมเป๊ะ
//       เพราะ dream ที่เพิ่มเข้า guaranteed ถูกหักออกจาก emoShowQ (คิวอ่อนสุด) พอดี
// ใช้ maxQueries=0 เป็น "กล้องส่อง guaranteed ล้วน" (dedupeTake คืนพอดี guaranteed.length แรกของ concat array
// ซึ่งเรียง guaranteed มาก่อนเสมอ — เห็นเนื้อ guaranteed แยกจาก names/pool ได้ชัด)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQueries } from '../src/lib/imageSearch.js';

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// fixture ทั่วไป (มี th/en/objq/story ครบ) — ใช้เทส dormant/kill-switch
function fullKeywords() {
  return {
    subjects: [{ name: 'สมชาย ใจดี', role: 'hero', must_have: true, kind: 'person', owner: '' }],
    queries_th: ['สมชาย ใจดี สัมภาษณ์', 'สมชาย ใจดี เปิดใจ', 'สมชาย ใจดี ยิ้ม', 'สมชาย ใจดี เซลฟี่'],
    queries_en: ['Somchai Jaidee interview'],
    object_queries: [],
    scene_place: [],
    moment_action: ['สมชาย ร้องไห้ตื้นตัน'],
    emotion: ['เศร้า', 'ตื้นตัน', 'ดีใจ'],
    source_show: ['รายการเที่ยงวันทันเหตุการณ์'],
    hashtags: [],
    relationship_archive: ['สมชาย เพื่อนสนิท'],
    lifestyle_travel: [],
    family_album: [],
    landmark_context: [],
  };
}

// fixture ที่ pool = emoShowQ ล้วน (ไม่มี th/en/objq/story เลย) — ใช้พิสูจน์ property "งบรวมไม่บวม"
function emoOnlyKeywords() {
  return {
    subjects: [{ name: 'สมหญิง ใจงาม', role: 'hero', must_have: true, kind: 'person', owner: '' }],
    queries_th: [],
    queries_en: [],
    object_queries: [],
    scene_place: [],
    moment_action: [],
    emotion: ['เศร้า', 'ตื้นตัน', 'ดีใจ', 'อึ้ง', 'กลั้นน้ำตา'],
    source_show: ['รายการโหนกระแส'],
    hashtags: [],
    relationship_archive: [],
    lifestyle_travel: [],
    family_album: [],
    landmark_context: [],
  };
}

test('dormant: ไม่ส่ง dreamQueries (2-arg เดิม) === ส่ง undefined === ส่ง [] เป๊ะ', () => {
  const kw = fullKeywords();
  const a = buildQueries(kw, 10);
  const b = buildQueries(kw, 10, undefined);
  const c = buildQueries(kw, 10, []);
  assert.deepEqual(a, b, '2-arg เดิม ต้องเท่ากับส่ง undefined');
  assert.deepEqual(a, c, '2-arg เดิม ต้องเท่ากับส่ง []');
});

test('dormant: dreamQueries ไม่ใช่ array (string/number/object) → ถูกละเว้น เหมือนไม่ส่งมา', () => {
  const kw = fullKeywords();
  const base = buildQueries(kw, 10);
  assert.deepEqual(buildQueries(kw, 10, 'ไม่ใช่ array'), base);
  assert.deepEqual(buildQueries(kw, 10, 42), base);
  assert.deepEqual(buildQueries(kw, 10, {}), base);
});

test('kill-switch MEGA_DREAM_QUERIES=0: ส่ง dreamQueries จริงมาก็ไม่มีผล (เท่า dormant เป๊ะ)', () => {
  const kw = fullKeywords();
  const base = buildQueries(kw, 10);
  const withSwitch = withEnv({ MEGA_DREAM_QUERIES: '0' }, () =>
    buildQueries(kw, 10, ['ยืนหน้าบ้านเก่า', 'กอดแม่ด้วยความตื้นตัน'])
  );
  assert.deepEqual(withSwitch, base, "MEGA_DREAM_QUERIES='0' ต้องปิดบัคเก็ตทั้งหมด");
});

// ★ ปิดเงื่อนไข Opus #1 (29 ก.ค. 69 — งบค้นห้ามบวม): 3 เทสด้านล่างเดิมใช้ fullKeywords() + maxQueries=0 เพื่อ
//   "ส่องเฉพาะ guaranteed" — แต่ fullKeywords() มี momentScenes+story ที่ไม่ว่างอยู่แล้ว (guaranteedBase.length=2)
//   หลังแก้บั๊กงบบวม เพดานตอน maxQueries=0 กลายเป็น guaranteedBase.length (ไม่ใช่ guaranteed.length ที่รวม dream)
//   → momentScenes/story (ลำดับความสำคัญสูงกว่า มาก่อน dream ใน guaranteed) เบียด dream ออกจนไม่เหลือที่เลยที่ cap=2
//   (นี่คือพฤติกรรมที่ถูกต้องแล้ว — ตรงเป้า "ห้ามบวม" เป๊ะ ไม่ใช่ regression) → เปลี่ยนไปใช้ emoOnlyKeywords()
//   (guaranteedBase.length=0 พอดี) + maxQueries เท่าจำนวนที่ต้องเห็นจริง ให้เทสยังคงแยก "dream ทำงานถูกไหม" ออกจาก
//   "งบรวมไม่บวมไหม" (มีเทสแยกสำหรับข้อหลังท้ายไฟล์นี้อยู่แล้ว) ได้ชัดเจนเหมือนเดิม
test('เปิดใช้จริง: dream terms ผูกชื่อ (bindName) แล้วโผล่ในผลลัพธ์ (fixture guaranteedBase ว่าง + maxQueries พอดีจำนวน dream)', () => {
  const kw = emoOnlyKeywords();
  const dreamQueries = ['ยืนหน้าบ้านเก่า', 'กอดแม่ด้วยความตื้นตัน'];
  const guaranteedOnly = buildQueries(kw, dreamQueries.length, dreamQueries);
  assert.ok(guaranteedOnly.includes('ยืนหน้าบ้านเก่า สมหญิง ใจงาม'), 'ต้องผูกชื่อเข้ากับช็อตที่ยังไม่มีชื่อคน');
  assert.ok(guaranteedOnly.includes('กอดแม่ด้วยความตื้นตัน สมหญิง ใจงาม'));
});

test('เปิดใช้จริง: ช็อตที่มีชื่อคนอยู่แล้ว ไม่ถูกผูกซ้ำ (bindName เช็ค hasPerson ก่อนเสมอ)', () => {
  const kw = emoOnlyKeywords();
  const guaranteedOnly = buildQueries(kw, 1, ['สมหญิง ใจงาม ยืนหน้าบ้านเก่า']);
  assert.ok(guaranteedOnly.includes('สมหญิง ใจงาม ยืนหน้าบ้านเก่า'));
  assert.ok(!guaranteedOnly.includes('สมหญิง ใจงาม ยืนหน้าบ้านเก่า สมหญิง ใจงาม'));
});

test('DREAM_SLOTS cap (default 3): ส่งเกิน 3 ช็อต → เหลือแค่ 3 ใน guaranteed (fixture guaranteedBase ว่าง + maxQueries=DREAM_SLOTS พอดี)', () => {
  const kw = emoOnlyKeywords();
  const dreamQueries = ['ช็อต1', 'ช็อต2', 'ช็อต3', 'ช็อต4', 'ช็อต5'];
  const guaranteedOnly = buildQueries(kw, 3, dreamQueries);
  const dreamHits = guaranteedOnly.filter((q) => /^ช็อต\d/.test(q));
  assert.equal(dreamHits.length, 3, 'ค่า default DREAM_SLOTS=3 ต้องคุมจำนวนช็อตที่การันตียิง');
});

// หมายเหตุ: IMAGES_DREAM_SLOTS (เหมือน EVIDENCE_SLOTS/PLACE_SLOTS/MOMENT_SLOTS/STORY_SLOTS พี่น้องในไฟล์เดียวกัน)
// เป็นค่าคงที่ระดับโมดูล อ่าน env ครั้งเดียวตอน import — ตั้ง env "หลัง" import แล้วในเทสเดียวกันจะไม่มีผล
// (ต้องตั้งก่อนโปรเซสเริ่มจริง) จึงไม่เทส "เปลี่ยนค่าไดนามิกกลางเทส" ตรงนี้ ให้เทสแค่ค่า default 3 ทำงานถูก (ข้างบน)

// ★ ถ้อยคำแก้ 29 ก.ค. 69 (Opus review รอบ 2): ชื่อ/ข้อความเทสเดิม "งบรวมไม่บวม" ฟังดูเป็นการันตีสากล — ที่จริงคือ
//   ผลลัพธ์ของ "เคสที่ emoShowQ มีของให้หักชดเชยพอ" เท่านั้น (fixture นี้ตั้งใจให้ emoShowQ ยาวพอ ≥ จำนวน dream)
//   ดูเทสสุดท้ายท้ายไฟล์นี้ (fixture บาง/ไม่มี emoShowQ ให้หัก) สำหรับเคสที่ยอดจริง "ขยับขึ้นได้จริง" (ไม่เท่าเดิม)
test('เพดานงบไม่บวม: เคส pool=emoShowQ ล้วนและมีของพอให้หักชดเชย — ผลรวม length เท่ากันไม่ว่าจะมี dream หรือไม่ (หักจาก emoShowQ พอดี)', () => {
  const kw = emoOnlyKeywords();
  const maxQ = 100; // ใหญ่พอให้ไม่ตัดท้าย (ไม่ใช่ตัวจำกัดในเคสนี้)
  const without = buildQueries(kw, maxQ);
  const dreamQueries = ['ช็อตพิเศษ1', 'ช็อตพิเศษ2'];
  const withDream = buildQueries(kw, maxQ, dreamQueries);
  assert.equal(withDream.length, without.length, 'เคสนี้ (emoShowQ มีของพอหักชดเชยเต็ม) ผลรวมไม่ขยับ — ไม่ใช่การันตีสากลทุก fixture (ดูเทสฟิกซ์เจอร์บางท้ายไฟล์)');
  assert.ok(withDream.includes('ช็อตพิเศษ1 สมหญิง ใจงาม'));
  assert.ok(withDream.includes('ช็อตพิเศษ2 สมหญิง ใจงาม'));
});

test('เพดานงบไม่บวม: ท้าย emoShowQ (คิวอ่อนสุด) ถูกหักออกพอดีจำนวน dream ที่เพิ่มเข้าไป (เคสมีของพอให้หัก)', () => {
  const kw = emoOnlyKeywords();
  const maxQ = 100;
  const without = buildQueries(kw, maxQ);
  const dreamQueries = ['ช็อตพิเศษ1', 'ช็อตพิเศษ2'];
  const withDream = buildQueries(kw, maxQ, dreamQueries);
  // emoShowQ ต่อท้ายสุดของ pool ก่อนเข้ารอบ round-robin — 2 รายการท้ายสุดของ "without" ควรหายไปจาก "withDream"
  const droppedTail = without.slice(-dreamQueries.length);
  for (const t of droppedTail) {
    assert.ok(!withDream.includes(t), `รายการท้ายสุด "${t}" ต้องถูกหักออกเมื่อเปิด dream bucket`);
  }
});

// ============================================================
// ★ ปิดเงื่อนไข Opus #1 (29 ก.ค. 69 — งบค้นห้ามบวม): เคสที่แท้จริงเผยบั๊ก — pool สมจริง (มี evidence/moment/place/
// story/emotion ครบ ไม่ใช่ emoShowQ ล้วนแบบเทสข้างบน) → guaranteed มีเนื้อจริงอยู่แล้วก่อน dream (guaranteedBase>0)
// เดิม (ก่อนแก้): เพดานรวมท้ายฟังก์ชัน "maxQueries + guaranteed.length" ใช้ guaranteed.length ที่รวม dream ไปแล้ว
// → เพดานโตตรงตามจำนวน dream พอดี ทั้งที่ trim emoShowQ ชดเชยแล้ว (trim แก้แค่สัดส่วนใน pool ไม่ได้แก้เพดาน) —
// พิสูจน์จริงก่อนแก้ (สคริปต์สำรวจ ไม่ใช่เดา): maxQueries=11 ได้ 19→22 (+3), maxQueries=20 ได้ 28→28 (พูลอิ่มพอดี
// ไม่มีผลต่างในเคสนั้น) — แก้แล้ว (guaranteedBase.length แยกออกจาก guaranteed.length ในสูตรเพดาน) ยืนยันด้วยเทสนี้:
// ทุกระดับงบ (0/11/20 ตามที่ Opus โพรบ) ต้องได้ผลรวมเท่ากันเป๊ะ ไม่ว่าจะเปิด dream หรือไม่
// ★ ถ้อยคำแก้ 29 ก.ค. 69 (Opus review รอบ 2 — งบค้นห้ามบวม): "เท่ากันเป๊ะ" ด้านล่างเป็นจริงเฉพาะ fixture นี้
// (queries_th 15 รายการ ทำให้พูลอิ่มเกินเพดานอยู่แล้วทุกระดับ maxQ ที่ทดสอบ — dream แค่แทนที่รายการท้ายๆ ที่โดนตัด
// อยู่แล้ว ไม่ได้ทำให้ผลรวมโต) ไม่ใช่กฎสากลว่า "เปิด dream แล้วยอดจริงไม่มีวันขยับ" — เพดาน (ตัวเลข n) เท่านั้นที่
// การันตีไม่บวม ยอดจริงยังขยับได้ ≤ เพดานเดิม เมื่อพูลเดิมเหลือที่ว่าง/บาง (พิสูจน์คู่กับเทสฟิกซ์เจอร์บางท้ายไฟล์นี้)
// ============================================================
function richKeywords() {
  return {
    subjects: [{ name: 'สมชาย', role: 'hero', must_have: true, kind: 'person', owner: '' }],
    queries_th: Array.from({ length: 15 }, (_, i) => `สมชาย เหตุการณ์ ${i}`),
    queries_en: [],
    object_queries: ['จดหมายลาตาย สมชาย'],
    scene_place: ['มหาวิทยาลัยธรรมศาสตร์ สมชาย', 'บ้านสมชาย'],
    moment_action: ['เช็คเงินบริจาค สมชาย', 'สมชาย ร้องไห้ในงาน'],
    emotion: ['สมชาย เศร้า', 'สมชาย ยิ้ม'],
    source_show: ['สมชาย ออกรายการ'],
    hashtags: [],
    relationship_archive: ['สมชาย ครอบครัว'],
    lifestyle_travel: ['สมชาย ท่องเที่ยว'],
    family_album: ['สมชาย อัลบั้ม'],
    landmark_context: ['สมชาย แลนด์มาร์ก'],
  };
}

for (const maxQ of [0, 11, 20]) {
  test(`เพดานงบไม่บวม (pool สมจริง อิ่มเกินเพดานอยู่แล้ว, maxQueries=${maxQ}): ผลรวม length เท่ากันเป๊ะไม่ว่าจะเปิด dream หรือไม่ (จุดที่เคยพังจริงก่อนแก้ — เคสนี้พูลอิ่มพอดีจึงบังเอิญเท่ากันเป๊ะ ไม่ใช่การันตีสากล)`, () => {
    const kw = richKeywords();
    const dreamQueries = ['สมชายยืนหน้าบ้านเก่า', 'สมชายกอดลูก', 'สมชายในงานศพ'];
    const without = buildQueries(kw, maxQ);
    const withDream = buildQueries(kw, maxQ, dreamQueries);
    assert.equal(withDream.length, without.length, `maxQueries=${maxQ}: fixture นี้พูลอิ่มเกินเพดานอยู่แล้ว ผลรวมจึงเท่าเดิมเป๊ะ (ได้ before=${without.length} after=${withDream.length}) — ดูเทสฟิกซ์เจอร์บางท้ายไฟล์สำหรับเคสที่ยอดจริงขยับได้`);
  });
}

// ============================================================
// ★ ปิดเงื่อนไข Opus #1 (29 ก.ค. 69 — ถ้อยคำแก้รอบ 2): เคส "ตรงข้าม" กับด้านบน — พูลบางมาก (ไม่มี emoShowQ ให้หัก
// ชดเชยเลย, guaranteedBase=0) → ยอดจริง "ขยับขึ้นได้จริง" เมื่อเปิด dream (ไม่ใช่เท่าเดิมเป๊ะ) เพราะการ trim emoShowQ
// (บรรทัด `if (dream.length) emoShowQ = emoShowQ.slice(...)` ใน imageSearch.js) เป็น best-effort — ไม่มีของให้หักก็
// ไม่มีอะไรถูกหักออก dream จึงบวกเข้าไปตรงๆ สูงสุด DREAM_SLOTS (default 3) รายการ — นี่คือพฤติกรรมที่ "ถูกต้องแล้ว"
// (ตั้งใจให้ dream โผล่จริงเมื่อพูลว่าง ไม่ใช่ regression) สิ่งที่ยังคงจริงเสมอคือ "เพดาน" (maxQueries+guaranteedBase.length)
// ไม่ขยับ — ยอดจริงในเคสนี้ (5) ยัง ≤ เพดาน (maxQ=20+guaranteedBase=0=20) ห่างไกลจากชน — พิสูจน์ตัวเลขจริงด้วยโพรบ
// (scratch/probe-dream-budget.mjs ระหว่างพัฒนา, ลบทิ้งแล้วหลังยืนยัน): thin fixture maxQ=20 without=2 withDream=5
// ============================================================
test('เพดานงบไม่บวม แต่ยอดจริงขยับขึ้นได้ (ไม่ใช่เท่าเดิมเป๊ะ): pool บางมาก ไม่มี emoShowQ ให้หักชดเชย → dream บวกเข้าตรงๆ สูงสุด DREAM_SLOTS รายการ, ยังคง ≤ เพดานเดิมเสมอ', () => {
  const kw = {
    subjects: [{ name: 'สมหญิง', role: 'hero', must_have: true, kind: 'person', owner: '' }],
    queries_th: ['สมหญิง ข่าว'], queries_en: [], object_queries: [], scene_place: [],
    moment_action: [], emotion: [], source_show: [], hashtags: [], // ★ ไม่มี emotion/source_show เลย = emoShowQ ว่าง = ไม่มีอะไรให้หักชดเชย
    relationship_archive: [], lifestyle_travel: [], family_album: [], landmark_context: [],
  };
  const maxQ = 20; // เพดานกว้าง — พิสูจน์ว่าการขยับไม่ได้มาจาก "โดนพูลอิ่มบังเอิญตัดพอดี" แบบเทสด้านบน
  const dreamQueries = ['สมหญิงยืนหน้าบ้านเก่า', 'สมหญิงกอดแม่', 'สมหญิงในงานบวช'];
  const without = buildQueries(kw, maxQ);
  const withDream = buildQueries(kw, maxQ, dreamQueries);
  assert.equal(without.length, 2, `sanity: พูลบางจริง ก่อนมี dream ต้องได้แค่ 2 รายการ (ชื่อ + queries_th 1 รายการ) — ได้ ${without.length}`);
  assert.equal(withDream.length, 5, `pool บางไม่มีอะไรให้หัก → ยอดจริงต้องขยับขึ้นเต็ม DREAM_SLOTS=3 (2→5) ไม่ใช่เท่าเดิม — ได้ ${withDream.length}`);
  assert.ok(withDream.length <= maxQ + 0, 'ยอดจริงต้องยัง ≤ เพดานเดิม (maxQueries + guaranteedBase.length โดย guaranteedBase=0 ในเคสนี้) แม้จะขยับขึ้นก็ตาม');
  for (const q of ['สมหญิงยืนหน้าบ้านเก่า', 'สมหญิงกอดแม่', 'สมหญิงในงานบวช']) {
    assert.ok(withDream.includes(q), `dream item "${q}" ต้องโผล่จริง (ไม่มีชื่ออื่นให้ผูกเพิ่มเพราะ query มีชื่ออยู่แล้ว)`);
  }
});
