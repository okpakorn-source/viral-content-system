// ★ R234(ง) 3 ก.ย. 69 — เทสบล็อก "⚠️ อาจตกข้อเท็จจริง" บนหน้าเว็บผลลัพธ์ (ResultVersions.js)
// รัน: node --test tests/web-missing-facts-warning.test.mjs (ไม่ตั้ง env · ไม่แตะเครือข่าย/DB)
// วิธีโหลด: สกัด formatMissingFactsWarning จาก source แล้ว new Function (แบบเดียวกับ
//   tests/diversity-warning-only.test.mjs — ไฟล์ view เป็น JSX จึง import ตรงใน node ไม่ได้)
// ⚠️ ใครเพิ่ม dependency นอกฟังก์ชันให้ formatMissingFactsWarning = เทสนี้พังโดยตั้งใจ (ฟังก์ชันต้องยืนเดี่ยวได้)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const VIEW_PATH = new URL('../src/components/content/ResultVersions.js', import.meta.url);

function makeFormatter(source = readFileSync(VIEW_PATH, 'utf8')) {
  const start = source.indexOf('export function formatMissingFactsWarning(');
  const end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, 'ต้องพบบล็อก formatMissingFactsWarning ตัวจริงใน ResultVersions.js');
  const declaration = source.slice(start, end + 2).replace('export function', 'function');
  return new Function(`${declaration}; return formatMissingFactsWarning;`)();
}

const sample = (over = {}) => ({
  missing: [
    { type: 'number', text: '209,678 บาท' },
    { type: 'date', text: '10 ส.ค. 2569' },
  ],
  checked: 14,
  coverage: 0.857,
  ...over,
});

test('ไม่มีของหาย/รูปไม่ถูกต้อง → คืน null (หน้าเว็บไม่แสดงอะไรเลย)', () => {
  const format = makeFormatter();
  assert.equal(format(undefined), null);
  assert.equal(format(null), null);
  assert.equal(format({}), null);
  assert.equal(format({ missing: [], checked: 9, coverage: 1 }), null);
  assert.equal(format({ missing: 'ไม่ใช่ array', checked: 3 }), null);
  assert.equal(format({ checked: 0, missing: [], coverage: 1, skipped: 'no_source' }), null);
});

test('มีของหาย → headline นับจุดถูก · แปลชนิดเป็นไทย · coverage เป็น %', () => {
  const format = makeFormatter();
  const result = format(sample());
  assert.equal(result.headline, 'อาจตกข้อเท็จจริง 2 จุด');
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items[0], { type: 'number', label: 'ตัวเลข', text: '209,678 บาท' });
  assert.deepEqual(result.items[1], { type: 'date', label: 'วันที่', text: '10 ส.ค. 2569' });
  assert.equal(result.moreCount, 0);
  assert.equal(result.moreText, '');
  assert.equal(result.coveragePercent, 86); // 0.857 → ปัดเป็น 86
  assert.equal(result.coverageText, 'ต้นฉบับครอบคลุม 86%');
});

test('ครบทั้ง 5 ชนิดของด่าน L4.7 ต้องมีป้ายไทย · ชนิดแปลกใช้ป้ายกลาง "ข้อมูล"', () => {
  const format = makeFormatter();
  const result = format(sample({
    missing: [
      { type: 'number', text: '16 บาท' },
      { type: 'date', text: 'ปี 2569' },
      { type: 'quote', text: 'ห่วงลูกทุกคน' },
      { type: 'name', text: 'ศรราม' },
      { type: 'detail', text: 'ห่วงเรื่องการขับรถ' },
    ],
  }));
  assert.deepEqual(result.items.map((item) => item.label), ['ตัวเลข', 'วันที่', 'คำพูด', 'ชื่อ', 'ประเด็น']);
  const weird = format(sample({ missing: [{ type: 'alien', text: 'x' }, { text: 'ไม่มีชนิด' }] }));
  assert.deepEqual(weird.items.map((item) => item.label), ['ข้อมูล', 'ข้อมูล']);
  assert.equal(weird.items[1].type, 'other');
});

test('เกิน 5 รายการ → โชว์ 5 ตามลำดับเดิม + "(+N)" · truncated จากด่านถูกนับรวม', () => {
  const format = makeFormatter();
  const eight = Array.from({ length: 8 }, (_, i) => ({ type: 'number', text: `เลขที่ ${i + 1}` }));
  const result = format(sample({ missing: eight }));
  assert.equal(result.items.length, 5);
  assert.deepEqual(result.items.map((item) => item.text), ['เลขที่ 1', 'เลขที่ 2', 'เลขที่ 3', 'เลขที่ 4', 'เลขที่ 5']);
  assert.equal(result.headline, 'อาจตกข้อเท็จจริง 8 จุด');
  assert.equal(result.moreCount, 3);
  assert.equal(result.moreText, '(+3)');

  // ด่าน findMissingFacts ส่ง missing สูงสุด 20 + truncated = ส่วนที่ตัดทิ้ง → ต้องนับรวมเป็นยอดจริง
  const twenty = Array.from({ length: 20 }, (_, i) => ({ type: 'name', text: `ชื่อ ${i + 1}` }));
  const truncatedResult = format(sample({ missing: twenty, truncated: 4 }));
  assert.equal(truncatedResult.headline, 'อาจตกข้อเท็จจริง 24 จุด');
  assert.equal(truncatedResult.items.length, 5);
  assert.equal(truncatedResult.moreCount, 19);
  assert.equal(truncatedResult.moreText, '(+19)');

  // truncated ขยะ (ลบ/ไม่ใช่จำนวนเต็ม) ต้องไม่ทำยอดเพี้ยน
  const junk = format(sample({ missing: eight, truncated: -3 }));
  assert.equal(junk.headline, 'อาจตกข้อเท็จจริง 8 จุด');
});

test('coverage: หาย/ผิดชนิด = ไม่โชว์ % · นอกช่วง 0-1 ถูกหนีบ · ขอบ 0 กับ 1 ตรงเป๊ะ', () => {
  const format = makeFormatter();
  const noCoverage = format({ missing: [{ type: 'number', text: '1 คน' }], checked: 1 });
  assert.equal(noCoverage.coveragePercent, null);
  assert.equal(noCoverage.coverageText, '');
  const badCoverage = format(sample({ coverage: 'พัง' }));
  assert.equal(badCoverage.coveragePercent, null);
  assert.equal(format(sample({ coverage: 5 })).coveragePercent, 100);
  assert.equal(format(sample({ coverage: -1 })).coveragePercent, 0);
  assert.equal(format(sample({ coverage: 0 })).coveragePercent, 0);
  assert.equal(format(sample({ coverage: 0 })).coverageText, 'ต้นฉบับครอบคลุม 0%');
  assert.equal(format(sample({ coverage: 1 })).coveragePercent, 100);
});

test('ข้อความรายการยาวถูกตัดที่ 80 ตัวอักษรพร้อม … · ช่องว่างหัวท้ายถูกริบ', () => {
  const format = makeFormatter();
  const longText = 'ก'.repeat(120);
  const result = format(sample({ missing: [{ type: 'quote', text: `  ${longText}  ` }] }));
  assert.equal(result.items[0].text, `${'ก'.repeat(80)}…`);
  const short = format(sample({ missing: [{ type: 'quote', text: '  สั้นๆ  ' }] }));
  assert.equal(short.items[0].text, 'สั้นๆ');
});

test('view ต่อสายจริง: อ่าน v._missingFacts · มีบล็อก MissingFactsWarning สีเหลืองอ่อน · สวิตช์ NEXT_PUBLIC_SHOW_MISSING_FACTS=0 ซ่อน', () => {
  const source = readFileSync(VIEW_PATH, 'utf8');
  assert.match(source, /<MissingFactsWarning missingFacts=\{v\._missingFacts\} \/>/u, 'ทุกฉบับต้องส่ง v._missingFacts เข้าบล็อกเตือน');
  assert.match(source, /function MissingFactsWarning\(/u);
  // สวิตช์: ค่าเริ่มต้นเปิด · รับเฉพาะ '0' ตรงตัว = ซ่อน (แบบแผนเดียวกับ MISSING_FACTS_GATE ฝั่ง pipeline)
  assert.match(source, /process\.env\.NEXT_PUBLIC_SHOW_MISSING_FACTS === '0'\) return null/u);
  // โทนเหลืองอ่อนจาก token ของโปรเจกต์ — ไม่ hardcode สีใหม่
  const block = source.slice(source.indexOf('function MissingFactsWarning('), source.indexOf('export default function ResultVersions'));
  assert.ok(block.includes("background: 'var(--warning-bg)'"), 'พื้นบล็อกต้องใช้ token var(--warning-bg)');
  assert.ok(block.includes('var(--warning)'), 'สีเน้นต้องใช้ token var(--warning)');
  assert.ok(block.includes('warn.moreCount > 0'), 'ต้องมีเงื่อนไขแสดง (+N) เฉพาะเมื่อมีรายการเกิน');
});

test('mutation oracle: ทุบ formatter ใน memory แล้วเทสหลักต้องแดง (กันเทสหลอก)', () => {
  const source = readFileSync(VIEW_PATH, 'utf8');

  // ทุบ 1: โชว์ทุกรายการไม่จำกัด → เคส "เกิน 5" ต้องจับได้
  const noLimit = source.replace('missingFacts.missing.slice(0, limit)', 'missingFacts.missing.slice(0)');
  assert.notEqual(noLimit, source, 'ต้อง replace ติด');
  assert.throws(() => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ type: 'number', text: `เลขที่ ${i + 1}` }));
    const result = makeFormatter(noLimit)(sample({ missing: eight }));
    assert.equal(result.items.length, 5);
  });

  // ทุบ 2: เลิกคืน null ตอนไม่มีของหาย → เคสว่างต้องจับได้
  const alwaysShow = source.replace('missingFacts.missing.length === 0) return null;', 'missingFacts.missing.length === -1) return null;');
  assert.notEqual(alwaysShow, source, 'ต้อง replace ติด');
  assert.throws(() => {
    assert.equal(makeFormatter(alwaysShow)({ missing: [], checked: 9, coverage: 1 }), null);
  });
});
