// 🔑 ข้อสอบ "ชื่อพ้องของกุญแจ provider" — เจ้าของสั่ง 16 ส.ค. 69 "Apify แก้ให้ตรง ใช้งานได้"
// รัน: node tests/env-alias-apify.test.mjs
//
// ที่มาของปัญหา: บน Vercel ตั้งชื่อ `APIFY_API_KEY` แต่โค้ดทั้ง 13 จุดอ่าน `APIFY_API_TOKEN`
//   ⇒ กุญแจ "ตั้งไว้แต่ไม่เคยถูกใช้" · ท่อ TikTok/Facebook ตกไปใช้ตัวสำรองมาตลอดโดยไม่มีใครรู้
// สิ่งที่ข้อสอบนี้ล็อกไว้:
//   ① ตั้งชื่อไหนก็ติด (TOKEN หรือ KEY)   ② ชื่อหลักชนะเสมอถ้าตั้งทั้งคู่
//   ③ อัญประกาศ/ช่องว่างที่ `vercel env add` ติดมา ต้องถูกถอด
//   ④ กุญแจตัวอื่นต้องไม่ถูกกระทบ (ไม่มีชื่อพ้อง = อ่านเหมือนเดิม)

import { readEnvKey, validateEnv } from '../src/lib/providers/baseProvider.js';

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('✅ ' + name); } else { fail++; console.log('❌ ' + name); } };

// ล้าง env ที่เกี่ยวข้องก่อนทุกเคส (กันค่าจริงจาก .env.local มารบกวนผล)
const KEYS = ['APIFY_API_TOKEN', 'APIFY_API_KEY', 'FIRECRAWL_API_KEY'];
const reset = () => KEYS.forEach((k) => { delete process.env[k]; });
const withEnv = (obj, fn) => { reset(); Object.entries(obj).forEach(([k, v]) => { process.env[k] = v; }); const r = fn(); reset(); return r; };

// ── ① ตั้งชื่อไหนก็ติด ──
t('1 ตั้งชื่อหลัก APIFY_API_TOKEN → อ่านได้',
  withEnv({ APIFY_API_TOKEN: 'tok_aaa' }, () => readEnvKey('APIFY_API_TOKEN')) === 'tok_aaa');

t('2 ตั้งชื่อพ้อง APIFY_API_KEY อย่างเดียว → อ่านได้ (นี่คือเคสจริงบน Vercel)',
  withEnv({ APIFY_API_KEY: 'key_bbb' }, () => readEnvKey('APIFY_API_TOKEN')) === 'key_bbb');

// ── ② ชื่อหลักชนะเสมอ (ของเดิมต้องไม่ถูกแย่ง) ──
t('3 ตั้งทั้งคู่ → ชื่อหลักชนะ (ไม่ทำลายเครื่องที่ตั้ง TOKEN ไว้อยู่แล้ว)',
  withEnv({ APIFY_API_TOKEN: 'tok_aaa', APIFY_API_KEY: 'key_bbb' }, () => readEnvKey('APIFY_API_TOKEN')) === 'tok_aaa');

t('4 ชื่อหลักตั้งเป็นค่าว่าง + ชื่อพ้องมีค่า → ตกไปใช้ชื่อพ้อง',
  withEnv({ APIFY_API_TOKEN: '', APIFY_API_KEY: 'key_bbb' }, () => readEnvKey('APIFY_API_TOKEN')) === 'key_bbb');

// ── ③ ล้างรูปแบบที่ vercel env add ติดมา ──
t('5 ค่าติดอัญประกาศคู่ "xxx" → ถอดออก',
  withEnv({ APIFY_API_TOKEN: '"tok_aaa"' }, () => readEnvKey('APIFY_API_TOKEN')) === 'tok_aaa');
t("6 ค่าติดอัญประกาศเดี่ยว 'xxx' → ถอดออก",
  withEnv({ APIFY_API_TOKEN: "'tok_aaa'" }, () => readEnvKey('APIFY_API_TOKEN')) === 'tok_aaa');
t('7 ค่ามีช่องว่างหน้าหลัง → ตัดทิ้ง',
  withEnv({ APIFY_API_TOKEN: '  tok_aaa  ' }, () => readEnvKey('APIFY_API_TOKEN')) === 'tok_aaa');
t('8 ชื่อพ้องติดอัญประกาศ → ถอดออกเหมือนกัน',
  withEnv({ APIFY_API_KEY: '"key_bbb"' }, () => readEnvKey('APIFY_API_TOKEN')) === 'key_bbb');

// ── ④ ไม่มีกุญแจเลย ──
t('9 ไม่ตั้งอะไรเลย → คืนค่าว่าง (ระบบจะตกไปใช้ตัวสำรองตามเดิม)',
  withEnv({}, () => readEnvKey('APIFY_API_TOKEN')) === '');
t('10 ส่งชื่อว่าง/null → ไม่พัง คืนค่าว่าง',
  readEnvKey('') === '' && readEnvKey(null) === '' && readEnvKey(undefined) === '');

// ── ⑤ กุญแจตัวอื่นต้องไม่ถูกกระทบ ──
t('11 กุญแจที่ไม่มีชื่อพ้อง อ่านได้เหมือนเดิม',
  withEnv({ FIRECRAWL_API_KEY: 'fc_123' }, () => readEnvKey('FIRECRAWL_API_KEY')) === 'fc_123');
t('12 กุญแจที่ไม่มีชื่อพ้อง ไม่ไปหยิบค่าจากตัวอื่นมั่ว',
  withEnv({ APIFY_API_KEY: 'key_bbb' }, () => readEnvKey('FIRECRAWL_API_KEY')) === '');

// ── ⑥ validateEnv (ตัวที่ provider จริงเรียกใช้) ต้องเห็นชื่อพ้องด้วย ──
{
  const v = withEnv({ APIFY_API_KEY: 'key_bbb' }, () => validateEnv('APIFY_API_TOKEN', 'apify'));
  t('13 validateEnv เห็นชื่อพ้อง → available=true + คืนค่าที่ใช้ยิง API ได้จริง',
    v.available === true && v.value === 'key_bbb');
}
{
  const v = withEnv({}, () => validateEnv('APIFY_API_TOKEN', 'apify'));
  t('14 ไม่มีกุญแจเลย → available=false + value=null (สัญญาเดิมไม่เพี้ยน)',
    v.available === false && v.value === null && v.masked === 'MISSING');
}
{
  const v = validateEnv(null, 'builtin');
  t('15 provider ที่ไม่ต้องใช้กุญแจ → available=true เหมือนเดิม',
    v.available === true && v.value === null);
}

console.log(`\n${pass}/${pass + fail} ผ่าน — ${fail === 0 ? '✅ ด่านข้อสอบผ่าน' : '❌ ยังไม่ผ่าน'}`);
process.exit(fail === 0 ? 0 : 1);
