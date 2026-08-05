// ★ 5 ส.ค. 69 — เทสยามชุด "ถักคำพูดสำคัญทุกประเด็น" (CLIP_V2_QUOTES)
//   คุม 3 เรื่อง: (1) สวิตช์ปิด = ป้ายรุ่น/พรอมต์ตามสวิตช์เดิมเป๊ะ (2) เปิดแล้วกติกาครบ (3) ห้ามมีโควตาตัวเลข (บทเรียนนั่งเทียน 8 ก.ค.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SRC = await readFile(new URL('../src/lib/services/clipRawStoryService.js', import.meta.url), 'utf8');

// เก็บ/คืนค่า env ให้สะอาดทุกเทส — สวิตช์อ่านตอนเรียก จึงสลับกลางโปรเซสได้
const SWITCHES = ['CLIP_V2_QUOTES', 'CLIP_PROMPT_0804', 'CLIP_SOURCE_META', 'CLIP_QC_GATES'];
const saved = {};
for (const k of SWITCHES) { saved[k] = process.env[k]; delete process.env[k]; }
const restore = () => { for (const k of SWITCHES) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
process.on('exit', restore);

const svc = await import('../src/lib/services/clipRawStoryService.js');

test('สวิตช์ปิดทั้งหมด: promptRev ต้องเป็น rawstory-v2-0803 เดิมเป๊ะ (ไม่มีร่องรอย v4)', () => {
  for (const k of SWITCHES) delete process.env[k];
  assert.equal(svc.normalizeRawStory({ rawStory: 'x' }).promptRev, 'rawstory-v2-0803');
});

test('เปิดเฉพาะ CLIP_PROMPT_0804: ยังเป็น rawstory-v3-0804 (v4 ไม่รั่ว)', () => {
  for (const k of SWITCHES) delete process.env[k];
  process.env.CLIP_PROMPT_0804 = '1';
  assert.equal(svc.normalizeRawStory({ rawStory: 'x' }).promptRev, 'rawstory-v3-0804');
  delete process.env.CLIP_PROMPT_0804;
});

test('เปิด CLIP_V2_QUOTES: ป้ายรุ่นเป็น v5-woven และชนะทุกสวิตช์', () => {
  for (const k of SWITCHES) delete process.env[k];
  process.env.CLIP_V2_QUOTES = '1';
  assert.equal(svc.normalizeRawStory({ rawStory: 'x' }).promptRev, 'rawstory-v7-woven-0805');
  process.env.CLIP_PROMPT_0804 = '1'; // เปิดคู่ก็ยังต้องเป็น v4 (รุ่นล่าสุดชนะ)
  assert.equal(svc.normalizeRawStory({ rawStory: 'x' }).promptRev, 'rawstory-v7-woven-0805');
  delete process.env.CLIP_V2_QUOTES; delete process.env.CLIP_PROMPT_0804;
});

test('บล็อกกติกา v4 ต้องอยู่หลังประตู CLIP_V2_QUOTES เท่านั้น (เทียบ === \'1\')', () => {
  assert.match(SRC, /swOn\('CLIP_V2_QUOTES'\)\s*\?\s*RULES_V2_QUOTES\s*:\s*''/,
    'RULES_V2_QUOTES ต้องถูกฉีดผ่านประตู swOn เท่านั้น');
  assert.match(SRC, /const swOn = \(name\) => process\.env\[name\] === '1'/,
    'ตัวอ่านสวิตช์ต้องเทียบ \'1\' เป๊ะ');
});

test('กติกา v4 ครบทุกข้อสำคัญ (ห้ามหายตอนแก้พรอมต์รอบหน้า)', () => {
  for (const mark of [
    'วางแผนก่อนเขียน',                        // ขั้น timeline + quote map ก่อนเขียน (ข้อสรุปร่วม Fable+Sol)
    'ถักคำพูดจริงเข้าในเนื้อ',                 // กติกาหลัก v7
    'ทุกก้อนใน topics แยกกัน',                // ประเมินรายก้อน — ครอบเนื้อย่อยด้วย
    'เล่า แล้วยกคำพูดจริง แล้วเล่าต่อ',        // จังหวะสลับ เล่า-คำพูด-เล่า
    'อย่างน้อยหนึ่งช่วง',                      // แรงบังคับรายก้อน — ถอดออกแล้วโมเดลถอยเล่าอ้อม (บทเรียน v5)
    'ห้ามเล่าซ้ำความหมายเดียวกับคำพูด',        // ราก "คำพูดเด็ดปักเป็นจุด" (ข้อค้นพบ Sol)
    'ห้ามสร้างคำพูดขึ้นเอง',                   // กันนั่งเทียน
    'ห้ามรวบคำพูดไว้เป็นไฮไลต์ท้ายก้อน',       // กันคำพูดกองท้าย
    'ห้ามใช้ครอบชื่อคน',                       // กันเครื่องหมายคำพูดครอบชื่อ ("กุ้ง กรวิกา") แทนคำพูดจริง
    'ห้ามลดประเด็น เหตุการณ์ ข้อเท็จจริง หรือคำพูดที่เลือกแล้ว', // บันไดงบ output — ย่อคำเกริ่น/เล่าซ้ำก่อน
    'โครงสร้างตัวอย่างเท่านั้น',                // ตัวอย่าง ผิด/ถูก เชิงโครงสร้าง (สูตร r2)
    'ไม่มีเสียงพูด',                           // ทางหนีคลิปเงียบ
  ]) assert.ok(SRC.includes(mark), `กติกา "${mark}" หายจากบล็อก v7`);
});

test('ห้ามมีโควตาตัวเลขในบล็อก v4 (บทเรียน 8 ก.ค. — โควตาบังคับ = นั่งเทียน)', () => {
  const block = SRC.split('RULES_V2_QUOTES = `')[1]?.split('`')[0] || '';
  assert.ok(block.length > 200, 'ต้องหาบล็อก RULES_V2_QUOTES เจอ');
  assert.doesNotMatch(block, /\d+\s*[-–~]\s*\d+/, 'ห้ามมีช่วงตัวเลขบังคับ (เช่น 5-10)');
  assert.doesNotMatch(block, /อย่างน้อย\s*\d/, 'ห้ามใช้ตัวเลขอารบิกกับ "อย่างน้อย" (ใช้เงื่อนไข "มีพูดจริงจึงต้องมี" แทน)');
});

restore();
