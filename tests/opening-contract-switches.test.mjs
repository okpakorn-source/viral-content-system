// 🎬 ข้อสอบสัญญาเปิดเรื่องต่อมุม (2 ก.ย. 69 — จากเทสสนามจริงเคส #05234 V2 "สลับบริบท" + ศึกโมเดล 7 แขน)
//   ★ 2 ก.ย. เย็น เจ้าของเคาะ "เคาะเปลี่ยน": ค่าเริ่มต้น = เลิกบังคับตระกูล + เติมกติกาใคร/อะไร/เมื่อไหร่
//   สวิตช์ปิดคืน: OPENING_FAMILY_CONTRACT=1 (บังคับตระกูลแบบเดิม) · OPENING_IDENTITY_RULE=0 (ถอดกติกา)
// autoFlowServiceText ลาก import '@/…' เป็นลูกโซ่ → ดึงเฉพาะฟังก์ชัน (pure: ใช้แค่ process.env) มาประเมินแยก
// รัน: node tests/opening-contract-switches.test.mjs
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/lib/services/autoFlowServiceText.js', import.meta.url), 'utf8');
const start = src.indexOf('export const OPENING_IDENTITY_RULE_TEXT');
const fnStart = src.indexOf('export function buildAngleOpeningContract', start);
const end = src.indexOf('\n}', fnStart) + 2;
if (start < 0 || fnStart < 0 || end < 2) { console.log('❌ หาฟังก์ชันในซอร์สไม่เจอ'); process.exit(1); }
const slice = src.slice(start, end).replace(/export (const|function) /g, '$1 ');
const make = (env) => new Function('process', slice + '\nreturn { buildAngleOpeningContract, OPENING_IDENTITY_RULE_TEXT };')({ env });

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('✅ ' + name); } else { fail++; console.log('❌ ' + name); } };
const HOOK = 'เปิดด้วยคำพูดสั้นที่คนพูดจริง';
const RESERVED = ['พ่อที่เลี้ยงลูกเหมือนเพื่อน: เวลาธรรมดาที่ลูกยังจำ'];
const LEGACY = { OPENING_FAMILY_CONTRACT: '1', OPENING_IDENTITY_RULE: '0' };

// ── ① ค่าเริ่มต้น (ไม่ตั้ง env) = แบบใหม่ที่เจ้าของเคาะ: ไม่บังคับตระกูล · การ์ดเป็นแนวทาง · แกนจอง · กติกาใคร/อะไร ──
{
  const { buildAngleOpeningContract: f, OPENING_IDENTITY_RULE_TEXT: RULE } = make({});
  const out = f(1, HOOK, RESERVED, ' (เคส)');
  t('1 default: ไม่มีบรรทัดบังคับตระกูล', !out.includes('ตระกูลเปิดหลัก') && !out.includes('เปิดด้วยตัวเลขหรือความต่าง'));
  t('2 default: เทคนิคการ์ดเป็นแนวทาง ไม่ใช่คำสั่งทับ', out.includes('เทคนิคเปิดเรื่องจากการ์ด (แนวทาง ไม่ใช่คำสั่งทับ): ' + HOOK));
  t('3 default: ยังกันแกนซ้ำกับมุมก่อน', out.includes('แกนที่มุมก่อนหน้าจองใช้เปิดแล้ว') && out.includes(RESERVED[0]));
  t('4 default: กติกาใคร/อะไร/เมื่อไหร่ + ผู้ล่วงลับ อยู่ท้ายสัญญา', out.endsWith(RULE) && RULE.includes('เสียชีวิตแล้ว') && RULE.includes('สองประโยคแรก') && out.split('\n').length === 3);
  t('5 default: มุมแรก ไม่มีการ์ด/แกนจอง → เหลือแค่กติกา', f(0, '', []) === RULE);
}

// ── ② สวิตช์ปิดคืนทั้งคู่ (=1 / =0) = พฤติกรรมเดิมก่อน 2 ก.ย. ไบต์ต่อไบต์ ──
{
  const { buildAngleOpeningContract: f, OPENING_IDENTITY_RULE_TEXT: RULE } = make(LEGACY);
  const out = f(1, HOOK, RESERVED, ' (เคส)');
  t('6 legacy: บังคับตระกูล "ความต่าง" สำหรับมุมที่ 2 เหมือนเดิม', out.startsWith('เปิดด้วยตัวเลขหรือความต่าง') && out.includes(' (เคส) — นี่คือตระกูลเปิดหลัก ห้ามเปลี่ยนไปใช้ตระกูลของมุมอื่น'));
  t('7 legacy: เทคนิคการ์ดถูกจำกัดในตระกูล (ข้อความเดิม)', out.includes('เทคนิคจากการ์ดใช้ปรับจังหวะภายในตระกูลนี้เท่านั้น: ' + HOOK));
  t('8 legacy: ไม่มีกติกาใคร/อะไร · 3 บรรทัดเท่าเดิม', !out.includes(RULE) && out.split('\n').length === 3);
  t('9 legacy: ไม่มีการ์ด/แกนจอง → เหลือบรรทัดตระกูลบรรทัดเดียว', f(0, '', []).split('\n').length === 1 && f(0, '', []).startsWith('เปิดด้วยภาพหรือการกระทำจริง'));
}

// ── ③ สลับทีละตัว ──
{
  const { buildAngleOpeningContract: f, OPENING_IDENTITY_RULE_TEXT: RULE } = make({ OPENING_FAMILY_CONTRACT: '1' });
  const out = f(1, HOOK, RESERVED);
  t('10 family=1 อย่างเดียว: บังคับตระกูล + ยังมีกติกา', out.includes('ตระกูลเปิดหลัก') && out.endsWith(RULE));
  const { buildAngleOpeningContract: g } = make({ OPENING_IDENTITY_RULE: '0' });
  const out2 = g(1, HOOK, RESERVED);
  t('11 identity=0 อย่างเดียว: ไม่บังคับตระกูล + ไม่มีกติกา', !out2.includes('ตระกูลเปิดหลัก') && !out2.includes(RULE) && out2.includes(RESERVED[0]));
  t('12 identity=0 + ไม่มีการ์ด/แกนจอง → สัญญาว่าง (ผู้เรียกไม่ใส่บรรทัดเปล่า)', g(0, '', []) === '');
}

// ── ④ ค่า env แปลกๆ = ค่าเริ่มต้นแบบใหม่ (รับเฉพาะ 1 / 0 ตรงตัวเป็นคำสั่งปิดคืน) ──
{
  const { buildAngleOpeningContract: f, OPENING_IDENTITY_RULE_TEXT: RULE } = make({ OPENING_FAMILY_CONTRACT: 'on', OPENING_IDENTITY_RULE: 'false' });
  const out = f(2, '', []);
  t('13 "on"/"false" ไม่นับเป็นคำสั่งปิดคืน → ยังเป็นแบบใหม่', !out.includes('ตระกูลเปิดหลัก') && out === RULE);
}

// ── ⑤ จุดเรียก: สัญญาว่างต้องไม่ใส่บรรทัด "สไตล์เปิดเรื่องบังคับ: " เปล่า ──
{
  t('14 ผู้เรียกกันบรรทัดเปล่าเมื่อสัญญาว่าง', src.includes("const writeAngle = _openingStyle ? `${focusAngle}\\nสไตล์เปิดเรื่องบังคับของเวอร์ชันนี้: ${_openingStyle}` : focusAngle;"));
}

console.log(`\n${pass}/${pass + fail} ผ่าน${fail ? ' — ❌ ตก ' + fail + ' เคส ห้ามไปต่อ' : ' — ✅ ด่านข้อสอบผ่าน'}`);
process.exit(fail ? 1 : 0);
