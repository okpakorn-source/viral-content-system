// ★ 10 ส.ค. 69 ระยะ 1 — เทสยาม "เนื้อดิบมีชีวิต" (CLIP_GRAY_ALIVE)
//   เจ้าของ: "พาดหัวเขียนดีมีอารมณ์ แต่เนื้อดิบไร้ความรู้สึก เป็นแนวบอกว่า"
//   คุม: (1) ปิดสวิตช์ = เดิมเป๊ะ (2) กฎครบ 4 ข้อของระยะ 1 (3) ห้ามเผลอปลดกฎห้ามแต่งเติม
//        (4) ตัวอย่างในกฎห้ามมีตัวเลข/ชื่อคนจริงให้ลอก (บทเรียน 9 ส.ค.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFile } from 'node:fs/promises';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const mod = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const STUB = mod(`export async function callAI(){throw new Error('FORBIDDEN');}
export async function callGeminiVideo(){return {};}
export async function callGeminiVideoFile(){return {};}
export const MODEL_FAST='t'; export const MODEL_NEWS_ANALYSIS='t';`);
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/ai/openai' || specifier === '@/lib/ai/modelConfig' || specifier === '@/lib/ai/geminiClient') return { url: ${JSON.stringify(STUB)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const suffix = specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js');
    return nextResolve(new URL(suffix, ${JSON.stringify(SRC_ROOT)}).href, context);
  }
  return nextResolve(specifier, context);
}`;
register(mod(hook));

const SW = ['CLIP_GRAY_ALIVE', 'CLIP_SMART_ORDER', 'CLIP_STYLE_DIRECT', 'CLIP_PROMPT_0804', 'CLIP_FLOW'];
const saved = {};
for (const k of SW) { saved[k] = process.env[k]; delete process.env[k]; }
process.on('exit', () => { for (const k of SW) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const ins = await import('../src/lib/services/clipInsightService.js');
const INS_SRC = await readFile(new URL('../src/lib/services/clipInsightService.js', import.meta.url), 'utf8');
const clear = () => { for (const k of SW) delete process.env[k]; };

test('ปิดสวิตช์: ไม่มีบล็อกใหม่ และป้ายรุ่นไม่มี alive1', () => {
  clear();
  assert.equal(ins.currentInsightPromptRev(), 'raw-depth2legs-0801');
  assert.ok(!ins._buildInsightAddonsForTest({}).includes('เนื้อดิบต้องอ่านแล้วเห็นคนจริง'), 'ปิดแล้วต้องไม่มีบล็อก');
});

test('เปิดสวิตช์: ป้ายรุ่นต่อท้าย alive1 และต่อจากของเดิมไม่ทับกัน', () => {
  clear();
  process.env.CLIP_GRAY_ALIVE = '1';
  assert.equal(ins.currentInsightPromptRev(), 'raw-depth2legs-0801-alive1');
  process.env.CLIP_STYLE_DIRECT = '1';
  process.env.CLIP_SMART_ORDER = '1';
  assert.equal(ins.currentInsightPromptRev(), 'raw-depth2legs-0801-direct3-order1-alive1');
  clear();
});

test('🎯 กฎครบทั้ง 4 ข้อของระยะ 1 (แต่ละข้อมาจากอาการที่วัดได้ในเคสจริง)', () => {
  clear();
  process.env.CLIP_GRAY_ALIVE = '1';
  const g = ins._buildInsightAddonsForTest({});
  // ข้อ 1: คำว่า "ตน" — เจอ 6 ครั้งในเคสเอิร์นไดเม่
  assert.ok(g.includes('ห้ามใช้คำว่า ตน'), 'ขาดกฎห้ามใช้ ตน');
  assert.ok(g.includes('ใช้ชื่อสั้นของคนคนนั้น'), 'ต้องบอกทางแทน ไม่ใช่ห้ามอย่างเดียว');
  // ข้อ 2: คำพูดจริงถูกเก็บแยก ไม่อยู่ในเนื้อ
  // ★ เจ้าของสั่งกลับทาง 10 ส.ค.: เอาคำพูดออกจากเนื้อ ให้อ่านลื่น (คำพูดเก็บในช่อง quotes เหมือนเดิม)
  assert.ok(g.includes('ห้ามใส่เครื่องหมายคำพูดในช่องเหล่านี้เลยแม้แต่จุดเดียว'), 'ขาดกฎห้ามคำพูดในเนื้อ');
  assert.ok(g.includes('เก็บไว้ในช่อง quotes ตามเดิม'), 'ต้องบอกว่าคำพูดไปอยู่ไหน ไม่ใช่ให้ทิ้ง');
  assert.ok(g.includes('รักษาความหมายและเจ้าของคำพูดให้ถูกคน'), 'เล่าอ้อมต้องไม่ทำให้คำพูดติดผิดคน');
  // ข้อ 3: จุดพีคถูกยัดท้ายประโยคยาว
  assert.ok(g.includes('ต้องมีประโยคเป็นของตัวเอง'), 'ขาดกฎคลี่จุดพีค');
  // ข้อ 4: ย่อหน้าเดียวยาว 1,914 ตัวอักษร
  assert.ok(g.includes('ขึ้นย่อหน้าใหม่'), 'ขาดกฎแบ่งย่อหน้า');
  clear();
});

test('🔴 ห้ามเผลอปลดกฎห้ามแต่งเติม — ต้องย้ำห้ามคำอารมณ์ลอยๆ และห้ามเนื้อลด', () => {
  clear();
  process.env.CLIP_GRAY_ALIVE = '1';
  const g = ins._buildInsightAddonsForTest({});
  assert.ok(g.includes('ไม่ปลดกฎห้ามแต่งเติมข้อใดเลย'), 'หัวบล็อกต้องประกาศว่าไม่ปลดกฎเดิม');
  for (const w of ['น่าชื่นชม', 'น่าสงสาร', 'ซาบซึ้ง']) {
    assert.ok(g.includes(w), `ต้องห้ามคำอารมณ์ลอยๆ "${w}" ให้ชัด`);
  }
  assert.ok(g.includes('ห้ามเติมข้อคิดปิดท้าย'), 'ขาดกฎห้ามข้อคิดปิดท้าย');
  assert.ok(g.includes('ความครบต้องไม่ลดลงจากเดิม'), 'ขาดกฎกันเนื้อหายตอนเขียนให้ลื่น');
  clear();
});

test('ตัวอย่างในกฎห้ามมีตัวเลข/ชื่อคนจริงให้ลอก (บทเรียน 9 ส.ค.)', () => {
  const block = INS_SRC.split('GRAY_ALIVE_RULES = `')[1].split('`;')[0];
  assert.ok(!/\d[\d,\.]*\s*(บาท|ล้าน|คน|กิโลเมตร)/.test(block), 'ตัวอย่างมีตัวเลขจริง เสี่ยงโมเดลลอก');
  assert.ok(!/กรรชัย|ป้าแห้ง|พิธา|ยุ้ย/.test(block), 'ตัวอย่างมีชื่อคนของเคสอื่น เสี่ยงชื่อรั่วข้ามเคส');
});

test('🔴 ต้องปิดคำสั่งเดิมที่บังคับใส่คำพูดในเนื้อ ไม่ให้ชนกัน', () => {
  // ยิงกับพรอมต์จริงที่ประกอบแล้ว (สตริงจำลองจับบั๊กสายไฟไม่ได้ — ดู tests/clip-prompt-wiring.test.mjs)
  clear();
  process.env.CLIP_STYLE_DIRECT = '1';
  process.env.CLIP_PROMPT_0804 = '1';
  const off = ins._buildVideoInsightPromptForTest({});
  assert.ok(off.includes('ใส่เครื่องหมายคำพูดแทรกในเนื้อ'), 'ปิดสวิตช์ = คำสั่งเดิมต้องยังอยู่');
  process.env.CLIP_GRAY_ALIVE = '1';
  const on = ins._buildVideoInsightPromptForTest({});
  assert.ok(!on.includes('ใส่เครื่องหมายคำพูดแทรกในเนื้อ'), 'เปิดแล้วต้องไม่เหลือคำสั่งขัดกัน');
  assert.ok(on.includes('ไม่ใส่เครื่องหมายคำพูดในเนื้อ'), 'ต้องแทนด้วยเล่าใจความ');
  clear();
});

test('สวิตช์ค่าแปลกต้องเท่ากับปิด', () => {
  clear();
  for (const v of ['0', 'true', '', ' 1']) {
    process.env.CLIP_GRAY_ALIVE = v;
    assert.equal(ins.currentInsightPromptRev(), 'raw-depth2legs-0801', `ค่า "${v}" ต้องถือว่าปิด`);
  }
  clear();
});
