// เทสปักหมุด "เนื้อดิบ v2" (rawStoryV2) — ออฟไลน์ล้วน ไม่ยิง Gemini ไม่แตะเน็ต
//   คุม 3 เรื่อง: (1) normalize ไม่ทิ้งของเงียบ (2) สวิตช์ปิด default + ปิดได้รายคำขอ (3) กฎในพรอมต์ไม่ถูกลบ
//   ★ เกิดจากผู้ตรวจไขว้รอบ 2 (3 ส.ค. 69) ชี้ว่า v2 ไม่มีเทสคุมสวิตช์เลย ทั้งที่เปิดใช้จริงแล้ว
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeRawStory, RAWSTORY_PROMPT_REV } from '../src/lib/services/clipRawStoryService.js';

const SERVICE_SRC = await readFile(new URL('../src/lib/services/clipRawStoryService.js', import.meta.url), 'utf8');
const ROUTE_SRC = await readFile(new URL('../src/app/api/clip-transcript/insight/route.js', import.meta.url), 'utf8');

// ───────────── 1) normalize: ต้องไม่ทิ้งของเงียบ ─────────────

test('normalize: ประเด็นที่รูปแบบไม่ครบถูกกรอง แต่ต้องรายงานจำนวนที่หายไป', () => {
  const out = normalizeRawStory({
    rawStory: 'เนื้อเรื่อง',
    topics: [
      { title: 'ก', rawStory: 'เนื้อ ก' },
      'สตริงลอย',                       // รูปแบบผิด
      { title: '', rawStory: 'ไม่มีหัวข้อ' }, // หัวข้อว่าง
      { title: 'ข', text: 'เนื้อ ข' },   // คีย์สำรอง text ต้องรับได้
    ],
  });
  assert.equal(out.topics.length, 2, 'ต้องเหลือเฉพาะประเด็นที่ครบ');
  assert.deepEqual(out.topics.map(t => t.no), [1, 2], 'เลขประเด็นต้องเรียงต่อเนื่องหลังกรอง');
  assert.equal(out.topicsDropped, 2, 'ต้องบอกว่าหายไปกี่ประเด็น (ไม่หายเงียบ)');
});

test('normalize: เกิน 10 ประเด็น เหลือ 10 และรายงานส่วนเกิน', () => {
  const topics = Array.from({ length: 13 }, (_, i) => ({ title: `หัวข้อ ${i + 1}`, rawStory: `เนื้อ ${i + 1}` }));
  const out = normalizeRawStory({ rawStory: 'x', topics });
  assert.equal(out.topics.length, 10);
  assert.equal(out.topics.at(-1).no, 10);
  assert.equal(out.topicsDropped, 3);
});

test('normalize: เนื้อเกินเพดานต้องติดธง truncated (ห้ามให้คนไปเดาจากตัวอักษรสุดท้าย)', () => {
  const long = 'ก'.repeat(12500);
  const out = normalizeRawStory({ rawStory: long, topics: [] });
  assert.equal(out.truncated, true, 'ก้อนรวมเกิน 12000 = ต้องติดธง');
  assert.ok(out.rawStory.length <= 12000);

  const okOut = normalizeRawStory({ rawStory: 'สั้นๆ', topics: [] });
  assert.equal(okOut.truncated, false, 'ไม่เกินเพดาน = ธงต้องเป็นเท็จ');

  const topicOut = normalizeRawStory({ rawStory: 'สั้น', topics: [{ title: 'ก', rawStory: 'ข'.repeat(4500) }] });
  assert.equal(topicOut.truncated, true, 'ประเด็นย่อยถูกตัดก็ต้องติดธงที่ก้อนรวม');
  assert.equal(topicOut.topics[0].truncated, true);
});

test('normalize: โมเดลห่อคำตอบเป็นอาเรย์ ต้องแกะได้ (บั๊กจริง 1 ส.ค. คลิปใหญ่)', () => {
  const out = normalizeRawStory([{ rawStory: 'เนื้อในอาเรย์', topics: [] }]);
  assert.equal(out.rawStory, 'เนื้อในอาเรย์');
  assert.equal(out.promptRev, RAWSTORY_PROMPT_REV);
});

test('normalize: อินพุตพัง (null / string / ไม่มีฟิลด์) ต้องไม่โยน error', () => {
  for (const bad of [null, undefined, 'ข้อความล้วน', 42, {}]) {
    const out = normalizeRawStory(bad);
    assert.equal(typeof out.rawStory, 'string');
    assert.ok(Array.isArray(out.topics));
  }
});

// ───────────── 2) สวิตช์: ปิดเป็นค่าเริ่มต้น + ผู้เรียกภายในปิดได้ ─────────────

test('สวิตช์ v2: ต้องเปิดด้วยค่า "1" เท่านั้น และปิดได้รายคำขอด้วย skipRawStoryV2', () => {
  assert.match(ROUTE_SRC, /process\.env\.CLIP_RAWSTORY_V2 === '1' && !skipRawStoryV2/,
    'ประตูต้องเช็คทั้ง env และ skipRawStoryV2 (กันระบบอื่นที่ยิงเข้ามาโดนรอบสองด้วย)');
  // ★ 11 ส.ค.: เดิมล็อกว่า skipRawStoryV2 ต้องเป็นตัวสุดท้ายในวงเล็บ ทำให้เพิ่มพารามิเตอร์ใหม่ไม่ได้เลย
  //   เจตนาจริงคือ "route ต้องอ่านค่านี้จาก body" — ตรวจที่เจตนาแทนตำแหน่งตัวอักษร
  assert.match(ROUTE_SRC, /skipRawStoryV2 = false[,\s}][^\n]*= await request\.json\(\)/,
    'route ต้องรับพารามิเตอร์ skipRawStoryV2 จาก body');
});

test('สวิตช์ v2: งบเวลาขั้นต่ำต้องไม่ต่ำกว่า 300 วินาที (กันจ่ายเงินฟรีแล้วถูกตัดกลางทาง)', () => {
  const m = ROUTE_SRC.match(/V2_MIN_BUDGET_MS = (\d[\d_]*)/);
  assert.ok(m, 'ต้องมีค่าคงที่ V2_MIN_BUDGET_MS');
  assert.ok(Number(m[1].replace(/_/g, '')) >= 300000, 'งบขั้นต่ำต้อง >= 300000 ms');
});

test('รอบ v2 ต้องอยู่หลังการเซฟ insight เดิมลงคลังเสมอ (ของเดิมต้องปลอดภัยก่อน)', () => {
  const saveIdx = ROUTE_SRC.indexOf('await store.add(baseRecord)');
  const v2Idx = ROUTE_SRC.indexOf('rawStoryV2Enabled');
  assert.ok(saveIdx > 0 && v2Idx > saveIdx, 'store.add(baseRecord) ต้องมาก่อนบล็อก v2');
});

// ───────────── 3) กฎในพรอมต์: ห้ามหายไปเงียบๆ ─────────────

test('พรอมต์ v2: กฎที่แลกมาด้วยการเทสจริงต้องยังอยู่ครบ', () => {
  const musts = [
    ['ห้ามลิสต์คำพูดแยก', /ห้ามสร้างส่วนรวมคำพูดท้ายเรื่อง/],
    ['บังคับยกคำพูดจริง (แก้เคสทางอ้อมล้วน 0/3)', /ต้องมีคำพูดจริงในเครื่องหมายคำพูด/],
    ['ห้าม CTA/โปรโมตท้ายคลิป (เคส PATEDTALK)', /ข้อความโปรโมต ช่องทางติดตาม/],
    ['ประโยคแรกเข้าเหตุการณ์', /ประโยคแรกต้องเริ่มที่เหตุการณ์/],
    ['ประโยคสุดท้ายเป็นข้อเท็จจริง', /ประโยคสุดท้ายต้องเป็นข้อเท็จจริง/],
    ['ห้ามมโนชื่อจากการจำหน้า', /การจำใบหน้าไม่ใช่หลักฐาน/],
    ['คลิปเงียบไม่ต้องยืดเนื้อ', /คลิปเงียบหรือไม่มีคำพูด/],
    ['เพลงไม่ใช่เนื้อข่าว', /เนื้อเพลงประกอบไม่ใช่คำพูด/],
  ];
  for (const [ชื่อ, re] of musts) assert.match(SERVICE_SRC, re, `กฎหาย: ${ชื่อ}`);
});

test('พรอมต์ v2: ห้ามฟื้นโควตาความยาวตายตัว (บทเรียน 8 ก.ค. — โควตาทำให้โมเดลเติมน้ำ)', () => {
  assert.match(SERVICE_SRC, /ความยาวให้แปรตามเนื้อจริง/);
  assert.doesNotMatch(SERVICE_SRC, /อย่างน้อย\s*\d{3,}\s*ตัวอักษร/, 'ห้ามกำหนดโควตาตัวอักษรขั้นต่ำในพรอมต์');
});

test('เพดานโทเคนต้องเป็น 32000 (40000 = Gemini คืนค่าว่างทั้งก้อน — บทเรียนจริง)', () => {
  const hits = SERVICE_SRC.match(/maxTokens: (\d+)/g) || [];
  assert.equal(hits.length, 2, 'ต้องมี 2 จุด (สาย URL + สายไฟล์)');
  for (const h of hits) assert.equal(h, 'maxTokens: 32000');
});

test('ป้ายรุ่นพรอมต์ต้องติดมากับผลทุกครั้ง (ตรวจย้อนได้ว่าเคสไหนใช้กติกาชุดไหน)', () => {
  assert.equal(normalizeRawStory({ rawStory: 'x' }).promptRev, RAWSTORY_PROMPT_REV);
  assert.match(RAWSTORY_PROMPT_REV, /^rawstory-v2-/);
});

// ───────────── 4) ของเดิมต้องไม่ถูกแตะ ─────────────

test('สายใหม่ต้องไม่ import อะไรจากสมองถอดคลิปเดิม (แยกสาย 100%)', () => {
  assert.doesNotMatch(SERVICE_SRC, /from '@\/lib\/services\/clipInsightService'/);
  assert.doesNotMatch(SERVICE_SRC, /clipInsightService/);
});
