// ★ 10 ส.ค. 69 — เทสยาม "ประโยคเปิดเป็นใจความข่าว" (CLIP_SMART_ORDER)
//   เจ้าของสั่งจากเคสเอิร์นไดเม่: เนื้อออกมาเป็นแนวเล่าตั้งแต่วัยเด็ก ไม่เอาเนื้อสำคัญขึ้นก่อน
//   คุมสิ่งที่เสี่ยงที่สุด: (1) ปิดสวิตช์ = เดิมเป๊ะ (2) กฎใหม่ต้องไม่ "ชนเงียบ" กับกฎเดิมที่ห้ามอารัมภบท/ห้ามยุบ
//   (3) ลำดับการวางบล็อกต้องอยู่ท้ายกฎที่มันยกเว้น (4) ตัวขัดเกลาห้ามรื้อประโยคเปิดทิ้ง
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

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

const SW = ['CLIP_SMART_ORDER', 'CLIP_STYLE_DIRECT', 'CLIP_V2_STYLE', 'CLIP_V2_QUOTES', 'CLIP_PROMPT_0804'];
const saved = {};
for (const k of SW) { saved[k] = process.env[k]; delete process.env[k]; }
process.on('exit', () => { for (const k of SW) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const ins = await import('../src/lib/services/clipInsightService.js');
const raw = await import('../src/lib/services/clipRawStoryService.js');
const { readFile } = await import('node:fs/promises');
const RAW_SRC = await readFile(new URL('../src/lib/services/clipRawStoryService.js', import.meta.url), 'utf8');
const INS_SRC = await readFile(new URL('../src/lib/services/clipInsightService.js', import.meta.url), 'utf8');

const clear = () => { for (const k of SW) delete process.env[k]; };

test('ปิดสวิตช์: ป้ายรุ่นสองฝั่งไม่มี order1 (ของเดิมเป๊ะ)', () => {
  clear();
  assert.equal(ins.currentInsightPromptRev(), 'raw-depth2legs-0801');
  assert.equal(raw.normalizeRawStory({ rawStory: 'x' }).promptRev, 'rawstory-v2-0803');
  process.env.CLIP_STYLE_DIRECT = '1';
  assert.equal(ins.currentInsightPromptRev(), 'raw-depth2legs-0801-direct3', 'ปิด lead = direct3 เท่าเดิม');
  clear();
});

test('ปิดสวิตช์: พรอมต์ทั้งสองฝั่งต้องไม่มีบล็อกใจความข่าวโผล่', () => {
  clear();
  const p2 = raw._buildRawStoryPromptForTest(null, null, {});
  assert.ok(!p2.includes('จัดเรียงเนื้อดิบเองอย่างบรรณาธิการ'), 'กรอบเขียวต้องไม่มี');
  process.env.CLIP_STYLE_DIRECT = '1';
  const g = ins._buildInsightAddonsForTest({});
  assert.ok(!g.includes('จัดเรียงเนื้อดิบเองอย่างบรรณาธิการ'), 'กรอบเทาต้องไม่มี');
  clear();
});

test('เปิดสวิตช์: ป้ายรุ่นต่อท้าย lead1 ทั้งสองฝั่ง (ตรวจย้อนแยกออก)', () => {
  clear();
  process.env.CLIP_SMART_ORDER = '1';
  assert.equal(ins.currentInsightPromptRev(), 'raw-depth2legs-0801-order1');
  assert.equal(raw.normalizeRawStory({ rawStory: 'x' }).promptRev, 'rawstory-v2-0803-order1');
  process.env.CLIP_STYLE_DIRECT = '1';
  process.env.CLIP_V2_STYLE = 'ac';
  assert.equal(ins.currentInsightPromptRev(), 'raw-depth2legs-0801-direct3-order1', 'ต้องต่อท้าย ไม่ทับของเดิม');
  assert.equal(raw.normalizeRawStory({ rawStory: 'x' }).promptRev, 'rawstory-v2-0803-styleAC2-order1');
  clear();
});

test('🔴 กฎห้ามชนเงียบ: บล็อกใจความข่าวต้องประกาศชัดว่า "แทนที่" กฎเดิมที่ขัดกัน', () => {
  clear();
  process.env.CLIP_SMART_ORDER = '1';
  const p2 = raw._buildRawStoryPromptForTest(null, null, {});
  // กฎเดิมสองข้อที่ขัดกันต้องยังอยู่ในพรอมต์ (ไม่ได้ถูกลบ) แต่ต้องมีข้อความยกเว้นกำกับ
  assert.ok(p2.includes('ประโยคแรกต้องเริ่มที่เหตุการณ์ซึ่งเกิดขึ้นจริง'), 'กฎเดิมยังต้องอยู่ (ไม่ลบของเก่า)');
  assert.ok(p2.includes('ห้ามยุบหลายจังหวะให้เหลือข้อสรุปรวม'), 'กฎเดิมยังต้องอยู่');
  // ★ ผู้ตรวจ 10 ส.ค. ข้อ 5: กรอบเขียวมีคำสั่งเรียงเวลา 5 จุด ต้องประกาศแทนที่ให้ครบ ไม่ใช่แค่ 2
  assert.ok(p2.includes('ข้อนี้แทนที่ทุกข้อที่สั่งให้ยึดลำดับเวลาของคลิป'), 'ต้องประกาศแทนที่แบบครอบทุกข้อ');
  for (const named of ['เรียงฉากทั้งหมดตามลำดับจริง', 'เดินเรื่องตามเวลาในคลิป', 'ประโยคสุดท้ายต้องเป็นข้อเท็จจริงสุดท้ายตามลำดับคลิป']) {
    assert.ok(p2.includes(named), `ต้องเอ่ยชื่อกฎที่ถูกแทนที่ให้ตรงตัว: ${named}`);
  }
  assert.ok(p2.includes('กติกาข้ออื่นทั้งหมดยังใช้เหมือนเดิม'), 'ต้องล็อกว่าแทนที่เฉพาะเรื่องลำดับ ไม่ใช่ปลดกฎทั้งชุด');
  clear();
});

test('🔴 ความเสี่ยงหลักของโหมดจัดเรียงเอง: เนื้อหายระหว่างจัดใหม่ — ต้องมีกฎกันครบทั้งสองฝั่ง', () => {
  clear();
  process.env.CLIP_SMART_ORDER = '1';
  process.env.CLIP_STYLE_DIRECT = '1';
  for (const [name, text] of [['กรอบเขียว', raw._buildRawStoryPromptForTest(null, null, {})], ['กรอบเทา', ins._buildInsightAddonsForTest({})]]) {
    assert.ok(text.includes('ความครบต้องเท่าเดิมหรือดีกว่าเดิม'), `${name}: ขาดกฎกันเนื้อหาย`);
    assert.ok(text.includes('ห้ามตัดสิ่งใดออกเพราะจัดเรียงใหม่'), `${name}: ต้องห้ามตัดเพราะจัดเรียง`);
    assert.ok(text.includes('การจัดเรียงคือการย้ายของที่มีอยู่'), `${name}: ต้องนิยามว่าจัดเรียง ≠ เพิ่ม/ลดของ`);
    assert.ok(text.includes('ภายในแต่ละกลุ่มเรียงตามเวลาจริง'), `${name}: ขาดกฎกันเหตุ-ผลกลับหัว`);
    assert.ok(text.includes('ต้องเขียนให้รู้ว่าเป็นช่วงไหนของเรื่อง'), `${name}: ขาดกฎกำกับเวลาเมื่อยกของช่วงหลังขึ้นก่อน`);
    assert.ok(text.includes('ห้ามย้ายไปวางในฉากที่เขาไม่ได้พูด'), `${name}: ขาดกฎล็อกคำพูดกับเจ้าของ`);
    assert.ok(text.includes('ตัวอย่างเชิงโครงสร้าง · ผิด'), `${name}: ขาดคู่ตัวอย่างผิด/ถูก (สูตรที่พิสูจน์แล้วว่าจำเป็น)`);
    // 🐛 บั๊กจากรันจริง 10 ส.ค. (คลิปเอิร์น): ประเด็นย่อยกรอบเขียวหายเกลี้ยง 3→0 และเนื้อกรอบเทาหด 2,459→1,486
    assert.ok(text.includes('ไม่ได้แทนที่'), `${name}: ต้องบอกว่าการจัดกลุ่มไม่ได้แทนที่รายการประเด็นย่อย`);
    assert.ok(text.includes('ความยาวรวมต้องไม่สั้นลงกว่าการเล่าตามลำดับเวลา'), `${name}: ขาดกฎกันเนื้อหดตอนจัดเรียงใหม่`);
  }
  clear();
});

test('🔴 ลำดับสำคัญ: บล็อกใจความข่าวต้องอยู่ "หลัง" กฎห้ามอารัมภบทของกรอบเทา', () => {
  clear();
  process.env.CLIP_SMART_ORDER = '1';
  process.env.CLIP_STYLE_DIRECT = '1';
  const g = ins._buildInsightAddonsForTest({});
  const posBan = g.indexOf('ห้ามประโยคประกาศหัวข้อ');
  const posLead = g.indexOf('จัดเรียงเนื้อดิบเองอย่างบรรณาธิการ');
  assert.ok(posBan >= 0 && posLead >= 0, 'ต้องมีทั้งสองข้อ');
  assert.ok(posLead > posBan, 'ข้อยกเว้นต้องอยู่ท้ายกว่า ไม่งั้นถูกกฎห้ามทับ');
  clear();
});

test('เนื้อกฎ: ให้อิสระเรื่องลำดับ แต่ยังห้ามเติมของใหม่/บทสรุป และห้ามเปิดด้วยคำทักทาย', () => {
  clear();
  process.env.CLIP_SMART_ORDER = '1';
  process.env.CLIP_STYLE_DIRECT = '1';
  for (const [name, text] of [['กรอบเขียว', raw._buildRawStoryPromptForTest(null, null, {})], ['กรอบเทา', ins._buildInsightAddonsForTest({})]]) {
    assert.ok(text.includes('ไม่ต้องยึดลำดับเวลาของคลิปถ้าลำดับนั้นทำให้เรื่องอ่อน'), `${name}: ต้องให้อิสระเรื่องลำดับจริง`);
    assert.ok(text.includes('ไม่มีรูปแบบตายตัว'), `${name}: ห้ามล็อกรูปประโยคเปิด (เจ้าของสั่ง)`);
    assert.ok(text.includes('ห้ามเติมบทสรุปของผู้เล่า'), `${name}: ขาดกฎห้ามเติมบทสรุป`);
    assert.ok(text.includes('ห้ามเปิดด้วยคำทักทาย'), `${name}: ขาดกฎห้ามเปิดด้วยคำทักทาย`);
  }
  clear();
});

test('ตัวอย่างในกฎห้ามมีตัวเลขจริง (บทเรียน 9 ส.ค. โมเดลลอกตัวอย่างทั้งท่อน)', () => {
  clear();
  process.env.CLIP_SMART_ORDER = '1';
  process.env.CLIP_STYLE_DIRECT = '1';
  const lead2 = RAW_SRC.split('SMART_ORDER_RULES_V2 = `')[1].split('`;')[0];
  const lead1 = INS_SRC.split('SMART_ORDER_RULES = `')[1].split('`;')[0];
  for (const [name, block] of [['กรอบเขียว', lead2], ['กรอบเทา', lead1]]) {
    assert.ok(!/\d[\d,\.]*\s*(บาท|คน|ล้าน|ปี)/.test(block), `${name}: ตัวอย่างในกฎมีตัวเลขจริง เสี่ยงโมเดลลอกไปใช้`);
    // ตัวอย่างต้องเป็นโครงสร้างล้วน ห้ามมีชื่อคน/ข้อเท็จจริงของเคสจริงให้ลอก (บทเรียน 9 ส.ค.)
    assert.ok(!/เอิร์น|ไดเม่|กรรชัย|ป้าแห้ง|บี้|วู้ดดี้/.test(block), `${name}: ตัวอย่างมีชื่อคนจริง เสี่ยงชื่อรั่วข้ามเคส`);
  }
  clear();
});

test('ตัวขัดเกลา (การ์ดม่วง): เปิด lead แล้วต้องมีเกราะห้ามรื้อประโยคเปิด · ปิดแล้วต้องไม่มี', () => {
  clear();
  const off = raw._polishPromptHeadForTest();
  assert.ok(!off.includes('ห้ามตัดทิ้งและห้ามย้ายลงไปกลางเรื่อง'), 'ปิดสวิตช์ = พรอมต์ขัดเกลาเดิมเป๊ะ');
  process.env.CLIP_SMART_ORDER = '1';
  const on = raw._polishPromptHeadForTest();
  assert.ok(on.includes('ห้ามตัดทิ้งและห้ามย้ายลงไปกลางเรื่อง'), 'เปิดแล้วต้องมีเกราะ');
  assert.ok(on.includes('ตอบ JSON เท่านั้น'), 'ต้องยังสั่งรูปแบบคำตอบเหมือนเดิม (เกราะแทรกก่อนบรรทัดนี้)');
  assert.ok(on.length > off.length, 'ต้องเป็นการเพิ่ม ไม่ใช่แทนที่ของเดิม');
  clear();
});

test('🔴 วิธีที่ได้ผลจริง: ต้อง "แก้ถ้อยคำตรงจุด" ไม่ใช่แค่เพิ่มข้อยกเว้นท้ายพรอมต์', () => {
  // บทเรียนรันจริง 10 ส.ค.: กรอบเทามีคำสั่งเรียงเวลา 3 จุด เพิ่มข้อยกเว้นท้ายพรอมต์แล้วโมเดลยังยึดของเดิม
  clear();
  const P = 'ก) - 🔴 เล่าเป็น "ฉาก" ตามลำดับจริง ห้ามรวบ: xxx';
  assert.equal(ins._applySmartOrderForTest(P), P, 'ปิดสวิตช์ = ห้ามแตะพรอมต์แม้แต่ตัวอักษรเดียว');
  process.env.CLIP_SMART_ORDER = '1';
  const out = ins._applySmartOrderForTest(P);
  assert.ok(!out.includes('ตามลำดับจริง ห้ามรวบ'), 'ต้องแทนที่คำสั่งเรียงเวลาไม่ให้เหลือขัดกัน');
  assert.ok(out.includes('ห้ามรวบ'), 'กฎห้ามรวบฉากต้องยังอยู่ (ไม่ใช่ปลดทิ้ง)');
  assert.ok(out.includes('น้ำหนัก'), 'ต้องแทนด้วยเกณฑ์น้ำหนักข่าว');
  // ★ ยิงจริงกับพรอมต์ที่ประกอบแล้ว อยู่ใน tests/clip-prompt-wiring.test.mjs (บทเรียน: สตริงจำลองจับบั๊กสายไฟไม่ได้)
  clear();
});

test('สวิตช์ค่าแปลก (0/true/ว่าง) ต้องเท่ากับปิด — ไม่เปิดโดยบังเอิญ', () => {
  clear();
  for (const v of ['0', 'true', 'yes', '', ' 1']) {
    process.env.CLIP_SMART_ORDER = v;
    assert.equal(ins.currentInsightPromptRev(), 'raw-depth2legs-0801', `ค่า "${v}" ต้องถือว่าปิด`);
    assert.equal(raw.normalizeRawStory({ rawStory: 'x' }).promptRev, 'rawstory-v2-0803', `ค่า "${v}" ต้องถือว่าปิด`);
  }
  clear();
});
