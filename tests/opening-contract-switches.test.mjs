// 🎬 ข้อสอบสวิตช์ทดลองสัญญาเปิดเรื่องต่อมุม (2 ก.ย. 69 — จากเทสสนามจริงเคส #05234 V2 "สลับบริบท")
//   ค่าเริ่มต้น (ไม่ตั้ง env) ต้อง = พฤติกรรมเดิม 100% · OPENING_FAMILY_CONTRACT=0 เลิกบังคับตระกูล · OPENING_IDENTITY_RULE=1 เติมกติกาใคร/อะไร/เมื่อไหร่
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

// ── ① ค่าเริ่มต้น = ของเดิม: บังคับตระกูล + เทคนิคการ์ดในตระกูล + แกนจอง · ไม่มีกติกาใคร/อะไร ──
{
  const { buildAngleOpeningContract: f, OPENING_IDENTITY_RULE_TEXT: RULE } = make({});
  const out = f(1, HOOK, RESERVED, ' (เคส)');
  t('1 default: บังคับตระกูล "ความต่าง" สำหรับมุมที่ 2 เหมือนเดิม', out.startsWith('เปิดด้วยตัวเลขหรือความต่าง') && out.includes(' (เคส) — นี่คือตระกูลเปิดหลัก ห้ามเปลี่ยนไปใช้ตระกูลของมุมอื่น'));
  t('2 default: เทคนิคการ์ดถูกจำกัดในตระกูล (ข้อความเดิม)', out.includes('เทคนิคจากการ์ดใช้ปรับจังหวะภายในตระกูลนี้เท่านั้น: ' + HOOK));
  t('3 default: ยังกันแกนซ้ำกับมุมก่อน', out.includes('แกนที่มุมก่อนหน้าจองใช้เปิดแล้ว') && out.includes(RESERVED[0]));
  t('4 default: ไม่มีกติกาใคร/อะไร/เมื่อไหร่ (ไม่สั่งทับการ์ดเอง)', !out.includes(RULE) && out.split('\n').length === 3);
}

// ── ② OPENING_FAMILY_CONTRACT=0: เลิกบังคับตระกูล · การ์ดเป็นแนวทาง · แกนจองยังอยู่ ──
{
  const { buildAngleOpeningContract: f } = make({ OPENING_FAMILY_CONTRACT: '0' });
  const out = f(1, HOOK, RESERVED);
  t('5 family=0: ไม่มีบรรทัดบังคับตระกูล', !out.includes('ตระกูลเปิดหลัก') && !out.includes('เปิดด้วยตัวเลขหรือความต่าง'));
  t('6 family=0: เทคนิคการ์ดกลายเป็นแนวทาง', out.includes('เทคนิคเปิดเรื่องจากการ์ด (แนวทาง ไม่ใช่คำสั่งทับ): ' + HOOK));
  t('7 family=0: แกนจองยังกันซ้ำ', out.includes(RESERVED[0]));
  t('8 family=0 + ไม่มีการ์ด/ไม่มีแกนจอง → สัญญาว่าง (ให้ผู้เรียกไม่ใส่บรรทัดเปล่า)', f(0, '', []) === '');
}

// ── ③ OPENING_IDENTITY_RULE=1: เติมกติกา 2 ประโยคแรก + ผู้ล่วงลับ · ตระกูลยังบังคับอยู่ ──
{
  const { buildAngleOpeningContract: f, OPENING_IDENTITY_RULE_TEXT: RULE } = make({ OPENING_IDENTITY_RULE: '1' });
  const out = f(1, HOOK, RESERVED);
  t('9 identity=1: มีกติกาใคร/อะไร/เมื่อไหร่ ต่อท้ายสัญญา', out.endsWith(RULE) && RULE.includes('เสียชีวิตแล้ว') && RULE.includes('สองประโยคแรก'));
  t('10 identity=1: ตระกูลยังบังคับเหมือนเดิม', out.includes('ตระกูลเปิดหลัก'));
}

// ── ④ เปิดทั้งคู่: การ์ดนำ + กติกาใคร/อะไร · ไม่มีตระกูล ──
{
  const { buildAngleOpeningContract: f, OPENING_IDENTITY_RULE_TEXT: RULE } = make({ OPENING_FAMILY_CONTRACT: '0', OPENING_IDENTITY_RULE: '1' });
  const out = f(0, HOOK, []);
  t('11 ทั้งคู่: [แนวทางการ์ด, กติกา] เท่านั้น', out === `เทคนิคเปิดเรื่องจากการ์ด (แนวทาง ไม่ใช่คำสั่งทับ): ${HOOK}\n${RULE}`);
}

// ── ⑤ ค่า env แปลกๆ ต้องไม่เปิดสวิตช์โดยไม่ตั้งใจ ──
{
  const { buildAngleOpeningContract: f, OPENING_IDENTITY_RULE_TEXT: RULE } = make({ OPENING_FAMILY_CONTRACT: 'off', OPENING_IDENTITY_RULE: 'true' });
  const out = f(2, '', []);
  t('12 "off"/"true" ไม่นับ (รับเฉพาะ 0 / 1 ตามสมุดสวิตช์)', out.includes('ตระกูลเปิดหลัก') && !out.includes(RULE));
}

// ── ⑥ จุดเรียก: สัญญาว่างต้องไม่ใส่บรรทัด "สไตล์เปิดเรื่องบังคับ: " เปล่า ──
{
  t('13 ผู้เรียกกันบรรทัดเปล่าเมื่อสัญญาว่าง', src.includes("const writeAngle = _openingStyle ? `${focusAngle}\\nสไตล์เปิดเรื่องบังคับของเวอร์ชันนี้: ${_openingStyle}` : focusAngle;"));
}

console.log(`\n${pass}/${pass + fail} ผ่าน${fail ? ' — ❌ ตก ' + fail + ' เคส ห้ามไปต่อ' : ' — ✅ ด่านข้อสอบผ่าน'}`);
process.exit(fail ? 1 : 0);
