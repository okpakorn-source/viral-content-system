// ============================================================
// 🧪 clip-substory-depth.test.mjs — สมอความลึกของ "ประเด็นย่อย" (15 ส.ค. 69)
// ------------------------------------------------------------
// ที่มา: ย้อนยุคนิ่ง 14 ส.ค. (499df17) พาสมอความลึกกลับไปผูกกับเนื้อรวม ("ครบเท่า rawData รวม")
//        → เนื้อรวมสั้นเมื่อไหร่ ประเด็นย่อยหดตาม (บั๊กเดิมที่เคยแก้ไปแล้ว 31 ก.ค.)
// ของใหม่: CLIP_SUBSTORY_DEEP (ค่าเริ่มต้น = เปิด) คืนสมอ "ครบในตัวเอง"
//
// 🔴 เทสปักหมุด 3 ชั้น:
//   (ก) ปิดสวิตช์ (=0) → พรอมต์ต้องเป็นข้อความเดิมของยุคนิ่งเป๊ะ (ล็อกไว้เป็น baseline ในไฟล์นี้)
//   (ข) เปิดสวิตช์ → ต้องมีสมอใหม่ และต้องไม่เหลือสมอเก่า
//   (ค) พาริตี้: พรอมต์เปิด เมื่อแทนที่ 2 จุดกลับเป็นข้อความเดิม ต้องเท่าพรอมต์ปิดทุกไบต์
//       = พิสูจน์ว่าไม่มีอะไรอื่นในระบบเปลี่ยนไปเลย (เจ้าของสั่ง "ห้ามเปลี่ยนวิธีการ/ผลลัพธ์ของระบบตอนนี้")
//
// ยิงตามสายจริงที่ผู้ใช้ใช้ (extractClipInsight → callAI) ไม่ได้อ่านค่าคงที่ตรงๆ —
// ตามบทเรียน 11 ส.ค. "เทสที่ยิงตรงเข้าไส้ในผ่านได้ทั้งที่ของพัง"
// callAI ถูกสวมด้วยตัวปลอมผ่าน loader hook → ไม่มีการยิง network/จ่ายเงินจริง
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const SERVICE = new URL('../src/lib/services/clipInsightService.js', import.meta.url).href;

const MOCK_AI_SRC = `
export async function callAI(args) {
  globalThis.__lastPrompt = args && args.prompt;
  return { headline: 'หัวข้อทดสอบ', rawData: 'เนื้อทดสอบ', subStories: [] };
}
`;

const hook = `
const MOCK = ${JSON.stringify(MOCK_AI_SRC)};
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/ai/openai') return { url: 'mockai:openai', shortCircuit: true, format: 'module' };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url === 'mockai:openai') return { format: 'module', shortCircuit: true, source: MOCK };
  return nextLoad(url, context);
}
`;
register('data:text/javascript,' + encodeURIComponent(hook));

// ── ข้อความเดิมของยุคนิ่ง 16 ก.ค. (baseline ปักหมุด — ห้ามแก้ นอกจากเจ้าของสั่งเปลี่ยนของเดิมจริงๆ) ──
const OLD_DEPTH =
  '  → แต่ละ subStory.rawData ต้องลึกและครบ "เท่า rawData รวม" แต่โฟกัสประเด็นเดียว — พร้อมเขียนเป็นข่าวเดี่ยวได้ทันที (ห้ามสั้น/ห้ามสรุปลอยๆ)';
const OLD_SCHEMA_RAW =
  'ข้อมูลดิบเจาะลึกเฉพาะประเด็นนี้ — ข้อเท็จจริงล้วน ลึกและครบเท่า rawData รวม แต่โฟกัสประเด็นเดียว พร้อมเขียนเป็นข่าวเดี่ยวได้ทันที';

// ── ข้อความใหม่ (สมอสัมบูรณ์ ยุค 31 ก.ค. เกลาให้เข้ายุคปัจจุบัน) ──
const NEW_DEPTH = [
  '  → แต่ละ subStory.rawData ต้อง "ลึกและครบในตัวเอง" — คนที่ยังไม่ได้ดูคลิปอ่านแล้วเข้าใจประเด็นนั้นได้ทั้งเรื่อง',
  '    (ใคร–ทำอะไร–ที่ไหน–เมื่อไหร่–ผลลงเอยยังไง + ตัวเลข/จำนวนเงิน/คำพูดตรงของประเด็นนั้นครบทุกตัวที่มีในคลิป)',
  '    พร้อมหยิบเขียนเป็นข่าวเดี่ยวได้ทันที — ห้ามสั้น/ห้ามสรุปลอยๆ/ห้ามย่อจนรายละเอียดของประเด็นหาย',
  '    ★ บันไดความยาวตามความยาวคลิปด้านบนเป็นเกณฑ์ของ rawData รวมเท่านั้น — subStories แต่ละก้อนยาวได้เท่าที่เนื้อหาจริงของประเด็นนั้นมี ไม่ต้องหารความยาวกัน',
].join('\n');
const NEW_SCHEMA_RAW =
  'ข้อมูลดิบเจาะลึกเฉพาะประเด็นนี้ — ข้อเท็จจริงล้วน ลึกและครบในตัวเอง อ่านแล้วเข้าใจประเด็นนี้ได้ทั้งเรื่องโดยไม่ต้องดูคลิป (เก็บตัวเลข/จำนวนเงิน/คำพูดของประเด็นนี้ครบ) พร้อมเขียนเป็นข่าวเดี่ยวได้ทันที ห้ามย่อจนรายละเอียดหาย';

const TRANSCRIPT = 'ผู้ดำเนินรายการถามถึงเรื่องงานและครอบครัว '.repeat(12);

async function promptWithSwitch(value, tag) {
  if (value === null) delete process.env.CLIP_SUBSTORY_DEEP;
  else process.env.CLIP_SUBSTORY_DEEP = value;
  globalThis.__lastPrompt = '';
  const mod = await import(`${SERVICE}?pin=${tag}`);
  await mod.extractClipInsight({ platform: 'tiktok', rawText: TRANSCRIPT });
  const p = globalThis.__lastPrompt;
  assert.ok(typeof p === 'string' && p.length > 500, `ไม่ได้พรอมต์จากสายจริง (tag=${tag})`);
  return p;
}

test('ปิดสวิตช์ (CLIP_SUBSTORY_DEEP=0) → พรอมต์เป็นของยุคนิ่งเดิมเป๊ะ', async () => {
  const p = await promptWithSwitch('0', 'off');
  assert.ok(p.includes(OLD_DEPTH), 'ปิดสวิตช์แล้วต้องมีสมอเดิม "เท่า rawData รวม" ในกติกา');
  assert.ok(p.includes(OLD_SCHEMA_RAW), 'ปิดสวิตช์แล้วต้องมีคำอธิบายช่อง subStories แบบเดิมในสคีมา');
  assert.ok(!p.includes('ลึกและครบในตัวเอง'), 'ปิดสวิตช์แล้วต้องไม่มีข้อความใหม่หลุดเข้าไป');
});

test('เปิดสวิตช์ (ค่าเริ่มต้น) → ได้สมอ "ครบในตัวเอง" และไม่เหลือสมอเก่า', async () => {
  const p = await promptWithSwitch(null, 'default');
  assert.ok(p.includes(NEW_DEPTH), 'ต้องมีบล็อกสมอใหม่ครบทั้ง 4 บรรทัด');
  assert.ok(p.includes(NEW_SCHEMA_RAW), 'สคีมาต้องอธิบายช่อง subStories แบบครบในตัวเอง');
  assert.ok(!p.includes(OLD_DEPTH), 'ต้องไม่เหลือสมอเก่าที่ผูกกับเนื้อรวม');
  assert.ok(!p.includes(OLD_SCHEMA_RAW), 'สคีมาต้องไม่เหลือข้อความเก่า');
});

test('เปิดสวิตช์แล้วส่วนอื่นของพรอมต์ต้องไม่ขยับแม้แต่ไบต์เดียว', async () => {
  const off = await promptWithSwitch('0', 'off2');
  const on = await promptWithSwitch('1', 'on2');
  const rolledBack = on.replace(NEW_DEPTH, OLD_DEPTH).replace(NEW_SCHEMA_RAW, OLD_SCHEMA_RAW);
  assert.equal(rolledBack, off, 'มีจุดอื่นนอกเหนือ 2 จุดของประเด็นย่อยเปลี่ยนไปด้วย — ผิดคำสั่งเจ้าของ');
});

test('กติกาเดิมของประเด็นย่อยที่ต้องอยู่ครบ (ไล่นับประเด็นก่อน / เรื่องเดียว = ว่าง)', async () => {
  const p = await promptWithSwitch(null, 'guard');
  assert.ok(p.includes('ไล่นับในใจว่าคลิปนี้คุยกี่เรื่อง'), 'ขั้นตอนบังคับ "ไล่นับประเด็นก่อน" ต้องยังอยู่');
  assert.ok(p.includes('subStories = [] (เว้นว่าง)'), 'กฎ "คลิปเรื่องเดียว = เว้นว่าง" ต้องยังอยู่ (กันแยกมั่ว)');
  assert.ok(p.includes('"เพิ่ม" จาก rawData รวม ไม่ใช่แทน'), 'ประเด็นย่อยต้องยังเป็นของ "เพิ่ม" ไม่ใช่มาแทนเนื้อรวม');
});
