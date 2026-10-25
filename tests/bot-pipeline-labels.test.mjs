// 🤖 ข้อสอบข้อ 9 (25 ต.ค. 69 · ผลทดสอบท่อทีละขั้น): ป้ายขั้นตอนที่บอทดิสคอร์ดโชว์ระหว่างรอ ต้องตรงท่อ TEXT จริง
//   ของเดิม: "ดึงเนื้อหาจากเว็บ" (ระบบรับแต่ข้อความ) · รุ่นตกยุค Gemini 2.0 Flash / GPT-5.5 / Claude Sonnet 4 · ไม่มีขั้นเลือกการ์ด/ตรวจแก้
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../discord-bot/index.js', import.meta.url), 'utf8');
const block = src.match(/const PIPELINE_STEPS = \[([\s\S]*?)\n\s*\];/u)?.[1] || '';

test('A1 ป้ายครบตามท่อ TEXT ตามลำดับ · ไม่มีขั้นดึงเว็บ · ไม่มีชื่อรุ่นตกยุค', () => {
  assert.ok(block.length > 0, 'ต้องพบ PIPELINE_STEPS');
  const labels = [...block.matchAll(/label: '([^']+)'/gu)].map((m) => m[1]);
  assert.deepEqual(labels, ['รับข้อความข่าว', 'สกัดเนื้อข่าว (AI)', 'แตกประเด็น 4 มุม (AI)', 'วางโครงอารมณ์ (AI)',
    'เลือกการ์ดสไตล์เขียน (AI)', 'เขียนข่าว 2 เวอร์ชันพร้อมกัน (AI)', 'ตรวจแก้', 'สรุปผลและบันทึก']);
  for (const stale of ['ดึงเนื้อหาจากเว็บ', 'Firecrawl', 'Gemini 2.0 Flash', 'GPT-5.5', 'Claude Sonnet 4', 'Classic + Enhanced']) {
    assert.ok(!block.includes(stale), `ห้ามมี "${stale}"`);
  }
});

test('A2 เวลาเรียงต่อกัน: done ของขั้นก่อน = at ของขั้นถัดไป · ขั้นสุดท้าย done 999', () => {
  const steps = [...block.matchAll(/\{ at: (\d+),\s+done: (\d+),/gu)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(steps[0][0], 0);
  for (let i = 1; i < steps.length; i++) assert.equal(steps[i][0], steps[i - 1][1], `ขั้น ${i + 1}`);
  assert.equal(steps.at(-1)[1], 999);
});

test('A3 ป้ายเขียนข่าวไม่โฆษณาตัวอย่างโพสต์ไวรัล (ปิดคลังครูแล้ว · ผู้ตรวจรอบ 2)', () => {
  const details = [...block.matchAll(/detail: '([^']+)'/gu)].map((m) => m[1]);
  for (const d of details) assert.doesNotMatch(d, /ไวรัล|ครู/u, d);
});

// ★ 25 ต.ค. 69 ด่านเดาเพศ: บอทต้องโชว์ป้ายเตือนใต้ข่าว · รอบ 3 เจ้าของเลือก "เตือนอย่างเดียว ไม่แก้เนื้อ" → ไม่มีบรรทัด "แทนคำ" แล้ว
test('B1 buildWarningLines โชว์ _genderWarning · ไม่มีบรรทัดแทนคำ · ไม่มีป้าย = ไม่มีบรรทัด', () => {
  const fnSrc = src.match(/function buildWarningLines\(version\) \{[\s\S]*?\n\}/u)?.[0];
  assert.ok(fnSrc, 'ต้องพบ buildWarningLines');
  const build = new Function('BOT_RESULT_WARNINGS', 'WARNING_LINE_MAX', 'readViralScore', `${fnSrc}; return buildWarningLines;`)(true, 220, () => null);
  assert.deepEqual(build({ content: 'x' }), []);
  const warn = build({ _genderWarning: 'ใช้คำว่า "เธอ" แต่ต้นฉบับไม่ได้ใช้คำนี้' });
  assert.equal(warn.length, 1);
  assert.match(warn[0], /^⚠️ ใช้คำว่า "เธอ"/u);
  assert.deepEqual(build({ _genderNeutralized: 2 }), [], 'ด่านไม่แก้เนื้อแล้ว — ห้ามมีบรรทัดอ้างว่าแทนคำ');
  assert.doesNotMatch(fnSrc, /แทน "เธอ"/u);
  assert.deepEqual(new Function('BOT_RESULT_WARNINGS', 'WARNING_LINE_MAX', 'readViralScore', `${fnSrc}; return buildWarningLines;`)(false, 220, () => null)({ _genderWarning: 'x' }), [], 'สวิตช์บรรทัดเตือนปิด = ไม่โชว์');
});
