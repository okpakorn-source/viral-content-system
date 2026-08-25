/**
 * 🧪 clip-uncapped.test.mjs — ปลดเพดานตัดผลลัพธ์ (25 ส.ค. 69)
 * ------------------------------------------------------------------
 * ที่มา: เจ้าของสั่ง "ปลดข้อจำกัดข้อความทั้งระบบ ไม่จำกัดตัวอักษรหรือคำ เพื่อให้ได้ประเด็นครบจริง ไม่ย่อ"
 *   วัดคลังจริง 400 ใบ: เพดานเดิมแทบไม่ถูกชน (2%) เพราะโมเดลเขียนสั้นอยู่แล้ว
 *   แต่เทสจริงชุดสั่งความละเอียดได้คำพูด 39 ประโยค ขณะเพดานเดิม 12 = จะถูกตัดทิ้ง 27 ประโยคเงียบๆ
 *
 * ล็อก 3 ชั้น:
 *   (ก) ค่าเริ่มต้น (ปลดเพดาน) → เนื้อยาว/รายการเยอะต้องผ่านครบ ไม่ถูกตัด
 *   (ข) ปิดสวิตช์ CLIP_UNCAPPED=0 → กลับไปตัดที่ตัวเลขเดิมเป๊ะทุกจุด (ทางถอย 100%)
 *   (ค) เมื่อมีการตัดจริง ต้องมีเสียงเตือนออก log — เดิมตัดเงียบ ไม่มีใครรู้ว่าเนื้อหาย
 *
 * ยิงตามสายจริง (extractClipInsight → callAI ตัวปลอม) ตามบทเรียน "เทสที่ยิงตรงเข้าไส้ในผ่านได้ทั้งที่ของพัง"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const SERVICE = new URL('../src/lib/services/clipInsightService.js', import.meta.url).href;

// ตัวปลอม callAI: คืนผลที่ "ยาวและเยอะเกินเพดานเดิมทุกช่อง"
const BIG = {
  rawData: 'ก'.repeat(30000),
  overview: 'ข'.repeat(5000),
  headline: 'ค'.repeat(400),
  directLead: 'ง'.repeat(1200),
  category: 'จ'.repeat(60),
  speakers: Array.from({ length: 20 }, (_, i) => `ผู้พูดคนที่ ${i + 1} ` + 'ฉ'.repeat(120)),
  quotes: Array.from({ length: 40 }, (_, i) => `คำพูดที่ ${i + 1} ` + 'ช'.repeat(900)),
  keyPoints: Array.from({ length: 30 }, (_, i) => ({ point: `ข้อ ${i + 1} ` + 'ซ'.repeat(300), detail: 'ฌ'.repeat(2000) })),
  timeline: Array.from({ length: 40 }, (_, i) => ({ time: `${i}:00-${i + 1}:00`, topic: `ช่วงที่ ${i + 1} ` + 'ญ'.repeat(300) })),
  subStories: Array.from({ length: 6 }, (_, i) => ({
    topic: `ประเด็นที่ ${i + 1} ` + 'ฎ'.repeat(300),
    timeRange: '00:00-99:00 (ช่วงยาวมากเพื่อทดสอบเพดาน)',
    rawData: 'ฏ'.repeat(20000),
    quotes: Array.from({ length: 25 }, (_, q) => `คำพูดย่อย ${q + 1} ` + 'ฐ'.repeat(900)),
    keyPoints: Array.from({ length: 25 }, (_, k) => ({ point: `ข้อย่อย ${k + 1} ` + 'ฑ'.repeat(800) })),
  })),
};

const MOCK_AI_SRC = `
export async function callAI(args) {
  globalThis.__lastPrompt = args && args.prompt;
  globalThis.__lastMaxTokens = args && args.maxTokens;
  return ${JSON.stringify(BIG)};
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

const TRANSCRIPT = 'ผู้ดำเนินรายการถามถึงเรื่องงานและครอบครัว '.repeat(400); // ~16,800 ตัว — ยาวกว่าเพดานเดิม 12,000

async function extract(uncapped, tag) {
  if (uncapped === null) delete process.env.CLIP_UNCAPPED;
  else process.env.CLIP_UNCAPPED = uncapped;
  globalThis.__lastPrompt = '';
  globalThis.__lastMaxTokens = 0;
  const mod = await import(`${SERVICE}?uncap=${tag}`);
  const out = await mod.extractClipInsight({ platform: 'tiktok', rawText: TRANSCRIPT });
  return { out, prompt: globalThis.__lastPrompt, maxTokens: globalThis.__lastMaxTokens };
}

// ── (ก) ค่าเริ่มต้น = ปลดเพดาน ──
test('ค่าเริ่มต้น: เนื้อยาวและรายการเยอะต้องผ่านครบ ไม่ถูกตัด', async () => {
  const { out } = await extract(null, 'default');
  assert.equal(out.rawData.length, 30000, 'เนื้อดิบรวมต้องไม่ถูกตัด');
  assert.equal(out.overview.length, 5000, 'ภาพรวมต้องไม่ถูกตัด');
  assert.equal(out.quotes.length, 40, 'คำพูดต้องอยู่ครบ 40 ประโยค (เพดานเดิมตัดเหลือ 12)');
  assert.equal(out.timeline.length, 40, 'แผนที่ประเด็นต้องอยู่ครบ 40 บรรทัด (เพดานเดิมตัดเหลือ 15)');
  assert.equal(out.keyPoints.length, 30, 'ข้อสรุปต้องอยู่ครบ 30 ข้อ (เพดานเดิมตัดเหลือ 12)');
  assert.equal(out.speakers.length, 20, 'รายชื่อผู้พูดต้องอยู่ครบ (เพดานเดิมตัดเหลือ 8)');
  assert.equal(out.subStories.length, 6, 'ประเด็นย่อยต้องครบ');
  assert.equal(out.subStories[0].rawData.length, 20000, 'เนื้อประเด็นย่อยต้องไม่ถูกตัด (เพดานเดิม 6,000)');
  assert.equal(out.subStories[0].quotes.length, 25, 'คำพูดในประเด็นย่อยต้องครบ (เพดานเดิม 10)');
});

test('ค่าเริ่มต้น: บทถอดเสียงขาเข้าต้องไม่ถูกตัดก่อนส่งให้ AI', async () => {
  const { prompt } = await extract(null, 'default-in');
  const sent = TRANSCRIPT.trim(); // ตัวบริการ trim ก่อนใส่พรอมต์ (พฤติกรรมเดิม ไม่เกี่ยวกับเพดาน)
  assert.ok(prompt.includes(sent), `บทถอด ${sent.length} ตัวต้องเข้าพรอมต์ครบ (เพดานเดิมตัดที่ 12,000)`);
});

test('ค่าเริ่มต้น: เพดานคำตอบของโมเดลถูกยกให้สูงขึ้น', async () => {
  const { maxTokens } = await extract(null, 'default-tok');
  assert.equal(maxTokens, 32000, 'สายบทถอดเสียงต้องได้เพดานใหม่ (เดิม 8,000)');
});

// ── (ข) ปิดสวิตช์ = กลับพฤติกรรมเดิมเป๊ะ ──
test('ปิดสวิตช์ CLIP_UNCAPPED=0: กลับไปตัดที่ตัวเลขเดิมทุกจุด', async () => {
  const { out, prompt, maxTokens } = await extract('0', 'off');
  assert.equal(out.rawData.length, 8000, 'เนื้อดิบต้องกลับไปตัดที่ 8,000');
  assert.equal(out.overview.length, 1500);
  assert.equal(out.headline.length, 200);
  assert.equal(out.directLead.length, 500);
  assert.equal(out.quotes.length, 12);
  assert.equal(out.quotes[0].length, 400);
  assert.equal(out.timeline.length, 15);
  assert.equal(out.keyPoints.length, 12);
  assert.equal(out.speakers.length, 8);
  assert.equal(out.subStories[0].rawData.length, 6000);
  assert.equal(out.subStories[0].quotes.length, 10);
  assert.equal(maxTokens, 8000, 'เพดานคำตอบต้องกลับเป็นเดิม');
  assert.ok(!prompt.includes(TRANSCRIPT), 'บทถอดต้องถูกตัดที่ 12,000 เหมือนเดิม');
});

// ── (ค) ตัดเมื่อไหร่ต้องส่งเสียง ──
test('เมื่อมีการตัดจริง ต้องมีเสียงเตือนออก log (เดิมตัดเงียบ)', async () => {
  const orig = console.warn;
  const seen = [];
  console.warn = (...a) => { seen.push(a.join(' ')); };
  try {
    await extract('0', 'warn');
  } finally { console.warn = orig; }
  const cuts = seen.filter((s) => s.includes('✂️'));
  assert.ok(cuts.length >= 5, `ต้องเตือนทุกจุดที่ตัด (เห็น ${cuts.length} ครั้ง)`);
  assert.ok(cuts.some((s) => s.includes('เนื้อดิบรวม')), 'ต้องบอกได้ว่าตัดช่องไหน');
  assert.ok(cuts.some((s) => /เนื้อหาย \d+/.test(s)), 'ต้องบอกจำนวนตัวอักษรที่หายไป');
});

test('ค่าเริ่มต้น (ปลดเพดาน): ต้องไม่มีเสียงเตือนตัดเลย', async () => {
  const orig = console.warn;
  const seen = [];
  console.warn = (...a) => { seen.push(a.join(' ')); };
  try {
    await extract(null, 'nowarn');
  } finally { console.warn = orig; }
  assert.equal(seen.filter((s) => s.includes('✂️')).length, 0, 'ปลดเพดานแล้วต้องไม่ตัดอะไรเลย');
});
