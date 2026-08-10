// ★ 10 ส.ค. 69 — เทสยาม "สายไฟพรอมต์" (ผู้ตรวจอิสระจับได้ว่ากฎไปไม่ถึงเส้นทางหลัก)
//   บั๊กจริงที่เคยเกิด: buildVideoInsightPrompt แทรกก้อนเสริม "หลัง" การแก้ถ้อยคำ
//   → กฎในก้อนเสริมไม่เคยถูกแตะ เส้นวิดีโอ (เส้นหลักโปรดักชัน) ได้พรอมต์ที่ยังมีคำสั่งขัดกัน
//   เทสชุดนี้จึงยิงกับ "พรอมต์ที่ประกอบเสร็จแล้ว" เท่านั้น ห้ามใช้สตริงจำลอง
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

const SW = ['CLIP_GRAY_ALIVE', 'CLIP_SMART_ORDER', 'CLIP_STYLE_DIRECT', 'CLIP_PROMPT_0804', 'CLIP_SOURCE_META', 'CLIP_V2_QUOTES', 'CLIP_V2_STYLE'];
const saved = {};
for (const k of SW) { saved[k] = process.env[k]; delete process.env[k]; }
process.on('exit', () => { for (const k of SW) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const ins = await import('../src/lib/services/clipInsightService.js');
const clear = () => { for (const k of SW) delete process.env[k]; };

// คำสั่งเดิมที่ "บังคับให้ยกคำพูดใส่ในเนื้อ" — ต้องไม่เหลือเมื่อเปิดโหมดเนื้อลื่น
const QUOTE_ORDERS = [
  'ใส่เครื่องหมายคำพูดแทรกในเนื้อ',
  'ยกคำพูดจริงตรงจังหวะที่พูด',
  'ยกเป็นคำพูดจริงในเครื่องหมายคำพูดถักในเนื้อ',
];
// คำสั่งเดิมที่ "บังคับเรียงตามเวลา" — ต้องไม่เหลือเมื่อเปิดโหมดจัดเรียงเอง
const TIME_ORDERS = ['ตามลำดับจริง ห้ามรวบ'];

test('ปิดสวิตช์: พรอมต์เส้นวิดีโอต้องยังมีคำสั่งเดิมครบทุกข้อ (ไม่ถูกแตะ)', () => {
  clear();
  process.env.CLIP_STYLE_DIRECT = '1';
  process.env.CLIP_PROMPT_0804 = '1';
  const p = ins._buildVideoInsightPromptForTest({});
  for (const w of [...QUOTE_ORDERS, ...TIME_ORDERS]) {
    assert.ok(p.includes(w), `ปิดสวิตช์แล้วคำสั่งเดิม "${w}" ต้องยังอยู่`);
  }
  clear();
});

test('🔴 เปิด GRAY_ALIVE: เส้นวิดีโอ (เส้นหลัก) ต้องไม่เหลือคำสั่งบังคับใส่คำพูดเลย', () => {
  clear();
  process.env.CLIP_STYLE_DIRECT = '1';
  process.env.CLIP_PROMPT_0804 = '1';
  process.env.CLIP_GRAY_ALIVE = '1';
  const p = ins._buildVideoInsightPromptForTest({});
  for (const w of QUOTE_ORDERS) {
    assert.ok(!p.includes(w), `ยังเหลือคำสั่งขัดกัน "${w}" ในเส้นวิดีโอ`);
  }
  assert.ok(p.includes('ห้ามใส่เครื่องหมายคำพูดในช่องเหล่านี้เลยแม้แต่จุดเดียว'), 'กฎใหม่ต้องอยู่ในพรอมต์');
  clear();
});

test('🔴 เปิด SMART_ORDER: เส้นวิดีโอต้องไม่เหลือคำสั่งบังคับเรียงเวลา', () => {
  clear();
  process.env.CLIP_STYLE_DIRECT = '1';
  process.env.CLIP_PROMPT_0804 = '1';
  process.env.CLIP_SMART_ORDER = '1';
  const p = ins._buildVideoInsightPromptForTest({});
  for (const w of TIME_ORDERS) {
    assert.ok(!p.includes(w), `ยังเหลือคำสั่งขัดกัน "${w}"`);
  }
  assert.ok(p.includes('จัดเรียงเนื้อดิบเองอย่างบรรณาธิการ'), 'กฎใหม่ต้องอยู่ในพรอมต์');
  clear();
});

test('เปิดพร้อมกันสองสวิตช์: ต้องสะอาดทั้งสองหมวด และกฎครบทั้งสองบล็อก', () => {
  clear();
  for (const k of ['CLIP_STYLE_DIRECT', 'CLIP_PROMPT_0804', 'CLIP_SMART_ORDER', 'CLIP_GRAY_ALIVE']) process.env[k] = '1';
  const p = ins._buildVideoInsightPromptForTest({});
  for (const w of [...QUOTE_ORDERS, ...TIME_ORDERS]) assert.ok(!p.includes(w), `ยังเหลือ "${w}"`);
  assert.ok(p.includes('ห้ามใช้คำว่า ตน'), 'กฎห้าม ตน ต้องอยู่');
  assert.ok(p.includes('ข้อนี้ไม่ใช้กับ headline'), 'ต้องมีขอบเขตว่าไม่ใช้กับ headline');
  clear();
});

test('ตัวแก้ถ้อยคำต้องยิงโดนเป้าทุกคู่ (no-op = บั๊กเงียบ)', () => {
  clear();
  for (const k of ['CLIP_STYLE_DIRECT', 'CLIP_PROMPT_0804', 'CLIP_SMART_ORDER', 'CLIP_GRAY_ALIVE']) process.env[k] = '1';
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try { ins._buildVideoInsightPromptForTest({}); } finally { console.warn = orig; }
  const missed = warns.filter(w => w.includes('หาจุดแก้ไม่เจอ'));
  assert.equal(missed.length, 0, 'มีคู่ที่ยิงไม่โดนเป้า:\n' + missed.join('\n'));
  clear();
});

test('ตัวอย่างในกฎใหม่ทั้งสองบล็อก ห้ามมีชื่อคน/ข้อเท็จจริงของเคสจริง', () => {
  clear();
  for (const k of ['CLIP_STYLE_DIRECT', 'CLIP_SMART_ORDER', 'CLIP_GRAY_ALIVE']) process.env[k] = '1';
  const g = ins._buildInsightAddonsForTest({});
  const NAMES = /เอิร์น|ไดเม่|กรรชัย|ป้าแห้ง|พิธา|ยุ้ย|บี้|วู้ดดี้/;
  const newBlocks = g.split('★★').filter(b => /จัดเรียงเนื้อดิบเองอย่างบรรณาธิการ|เนื้อดิบต้องอ่านแล้วเห็นคนจริง/.test(b));
  assert.equal(newBlocks.length, 2, 'ต้องเจอบล็อกใหม่ทั้งสอง');
  for (const b of newBlocks) {
    assert.ok(!NAMES.test(b), 'บล็อกใหม่มีชื่อคนจริง เสี่ยงโมเดลลอกไปใช้: ' + (b.match(NAMES) || [])[0]);
    assert.ok(!/\bป\.\d\b|\d[\d,\.]*\s*(บาท|ล้าน|คน|กิโลเมตร)/.test(b), 'บล็อกใหม่มีข้อเท็จจริงตัวเลขของเคสจริง');
  }
  clear();
});
