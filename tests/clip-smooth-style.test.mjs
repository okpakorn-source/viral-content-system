// ★ 11 ส.ค. 69 — เทสยาม "ปุ่มเลือกแบบการเล่า" (เจ้าของสั่งวางสองระบบคู่กันให้พนักงานเลือกตอนวางลิงก์)
//   สิ่งที่ต้องคุมให้แน่น เพราะเป็นค่าที่มาจากคนกด ไม่ใช่ไฟล์ตั้งค่า:
//     1) ไม่เลือก = พรอมต์เดิมเป๊ะทุกตัวอักษร (ระบบเดิมที่ยิงเข้ามาต้องไม่กระทบ)
//     2) เลือกแบบไหนได้กฎของแบบนั้นจริง และไม่ปนกับอีกแบบ
//     3) ค่าเพี้ยน/ค่าที่ถอดทิ้งแล้ว (เช่น b) ต้องไม่ล้ม แค่ตกกลับไปใช้พรอมต์มาตรฐาน
//     4) ทั้งเส้นดูคลิปและเส้นบทถอดเสียงต้องได้ชุดกฎเดียวกัน (ผู้ตรวจ Sol เคยจับได้ว่ากฎไปไม่ครบทุกเส้น)
//     5) การแก้ถ้อยคำที่ขัดกันต้องเกิดขึ้นจริงในพรอมต์ที่ประกอบเสร็จแล้ว ไม่ใช่แค่มีโค้ดเขียนไว้
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const mod = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
// callAI ตัวปลอม: เก็บพรอมต์ที่ได้รับไว้ให้เทสตรวจ แล้วคืน JSON ว่างที่ผ่าน normalize ได้
const STUB = mod(`export async function callAI(args){ globalThis.__lastPrompt = args?.prompt || ''; return { headline:'x', rawData:'y' }; }
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

const SW = ['CLIP_GRAY_ALIVE', 'CLIP_SMART_ORDER', 'CLIP_STYLE_DIRECT', 'CLIP_PROMPT_0804', 'CLIP_SOURCE_META', 'CLIP_FLOW', 'CLIP_SMOOTH', 'CLIP_NAME_SOURCE'];
const saved = {};
for (const k of SW) { saved[k] = process.env[k]; delete process.env[k]; }
process.on('exit', () => { for (const k of SW) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const ins = await import('../src/lib/services/clipInsightService.js');
const clear = () => { for (const k of SW) delete process.env[k]; };
/** ตั้งสวิตช์ให้เหมือนโปรดักชันจริง (ชุดที่เปิดอยู่บน Vercel ตอนนี้) */
const prodSwitches = () => {
  clear();
  // ★ 11 ส.ค.: รวม CLIP_SOURCE_META ด้วย — โปรดักชันเปิดอยู่จริง (ยืนยันจากเคสจริงที่มีข้อมูลโพสต์ต้นทางครบทุกใบ)
  for (const k of ['CLIP_PROMPT_0804', 'CLIP_STYLE_DIRECT', 'CLIP_SMART_ORDER', 'CLIP_GRAY_ALIVE', 'CLIP_FLOW', 'CLIP_SOURCE_META']) process.env[k] = '1';
};

const MARK_A = 'เล่าให้ลื่นด้วยการไม่ย้ำว่าใครเล่า';
const MARK_C = 'เล่าเหตุการณ์ตรง ลดการย้ำผู้เล่า แต่รักษาสถานะหลักฐาน';
const CONFLICT_FLOW = 'ส่วนคำเล่าใช้ได้ตามปกติในประโยคถัดๆ ไปเมื่อต้องระบุว่าใครพูด';
const CONFLICT_DIRECT = '- ระบุการเล่าและคำพูดด้วยคำตรงสั้นที่สุด: เล่าว่า บอกว่า ถามว่า ตอบว่า ยอมรับว่า —';

test('ไม่เลือกแบบ = พรอมต์เดิมเป๊ะทุกตัวอักษร (เทียบสตริงตรงๆ)', () => {
  prodSwitches();
  const base = ins._buildVideoInsightPromptForTest({});
  const withEmpty = ins._buildVideoInsightPromptForTest({ smooth: '' });
  assert.equal(withEmpty, base, 'ส่ง smooth ว่างต้องได้พรอมต์เดียวกับไม่ส่งเลย');
  assert.ok(!base.includes(MARK_A) && !base.includes(MARK_C), 'ไม่เลือกแบบต้องไม่มีก้อนกฎความลื่นเลย');
  assert.ok(base.includes(CONFLICT_FLOW), 'ไม่เลือกแบบ ประโยคเดิมต้องอยู่ครบ ห้ามถูกแก้');
  assert.ok(base.includes(CONFLICT_DIRECT), 'ไม่เลือกแบบ ประโยคเดิมของบล็อกภาษาเล่าตรงต้องอยู่ครบ');
  clear();
});

test('เลือกแบบ A = ได้กฎ A อย่างเดียว ไม่ปนกับ C', () => {
  prodSwitches();
  const p = ins._buildVideoInsightPromptForTest({ smooth: 'a' });
  assert.ok(p.includes(MARK_A), 'ต้องมีก้อนกฎแบบ A');
  assert.ok(!p.includes(MARK_C), 'ห้ามมีก้อนกฎแบบ C ปนมาด้วย');
  clear();
});

test('เลือกแบบ C = ได้กฎ C อย่างเดียว ไม่ปนกับ A', () => {
  prodSwitches();
  const p = ins._buildVideoInsightPromptForTest({ smooth: 'c' });
  assert.ok(p.includes(MARK_C), 'ต้องมีก้อนกฎแบบ C');
  assert.ok(!p.includes(MARK_A), 'ห้ามมีก้อนกฎแบบ A ปนมาด้วย');
  clear();
});

test('🔴 เลือกแบบแล้ว ประโยคที่ขัดกันต้องถูกแก้จริงในพรอมต์ที่ประกอบเสร็จ (ทั้งสองจุด)', () => {
  for (const style of ['a', 'c']) {
    prodSwitches();
    const p = ins._buildVideoInsightPromptForTest({ smooth: style });
    assert.ok(!p.includes(CONFLICT_FLOW), `แบบ ${style}: ประโยค "คำเล่าใช้ได้ตามปกติ" ต้องหายไป ไม่งั้นโมเดลจะเลือกข้อที่อนุญาต`);
    assert.ok(!p.includes(CONFLICT_DIRECT), `แบบ ${style}: ประโยคอนุญาตคำเล่าของบล็อกภาษาเล่าตรงต้องถูกแก้`);
    assert.ok(p.includes('กติกาความลื่น'), `แบบ ${style}: ประโยคที่แก้แล้วต้องชี้ไปที่กติกาความลื่น`);
    clear();
  }
});

test('ปิดบล็อกต้นทาง (FLOW/DIRECT ปิด) แล้วเลือกแบบ = ต้องไม่ล้ม และไม่มีอะไรให้แก้', () => {
  clear();
  process.env.CLIP_PROMPT_0804 = '1';
  const p = ins._buildVideoInsightPromptForTest({ smooth: 'c' });
  assert.ok(p.includes(MARK_C), 'ก้อนกฎยังต้องถูกฉีดแม้บล็อกอื่นปิดอยู่');
  clear();
});

test('ค่าเพี้ยน/ค่าที่ถอดทิ้งแล้ว ต้องไม่ล้ม และตกกลับไปใช้พรอมต์มาตรฐาน', () => {
  prodSwitches();
  const base = ins._buildVideoInsightPromptForTest({});
  for (const bad of ['b', 'x', 'A1', 'null', 'undefined', '{}', 0, 1, null, undefined, {}, []]) {
    const p = ins._buildVideoInsightPromptForTest({ smooth: bad });
    assert.equal(p, base, `ค่า ${JSON.stringify(bad)} ต้องได้พรอมต์มาตรฐานเป๊ะ ไม่ใช่ครึ่งๆ กลางๆ`);
  }
  clear();
});

test('ค่ามีช่องว่าง/ตัวใหญ่/เครื่องหมายคำพูดติดมา ต้องยังใช้ได้ (ค่ามาจากคนกด/คนกรอก)', () => {
  prodSwitches();
  for (const ok of [' a ', 'A', '"a"', "'C'", 'C ']) {
    const p = ins._buildVideoInsightPromptForTest({ smooth: ok });
    assert.ok(p.includes(MARK_A) || p.includes(MARK_C), `ค่า ${JSON.stringify(ok)} ควรอ่านออกเป็นแบบใดแบบหนึ่ง`);
  }
  clear();
});

test('🔴 ค่าจากปุ่มต้องชนะค่าตั้งต้นของระบบเสมอ', () => {
  prodSwitches();
  process.env.CLIP_SMOOTH = 'a';
  const p = ins._buildVideoInsightPromptForTest({ smooth: 'c' });
  assert.ok(p.includes(MARK_C) && !p.includes(MARK_A), 'พนักงานกด C ต้องได้ C แม้ค่าตั้งต้นระบบเป็น A');
  const q = ins._buildVideoInsightPromptForTest({});
  assert.ok(q.includes(MARK_A), 'ไม่ได้กดปุ่มมา = ใช้ค่าตั้งต้นของระบบ');
  clear();
});

test('🔴 เส้นบทถอดเสียงต้องได้ชุดกฎเดียวกับเส้นดูคลิป (กฎต้องไปครบทุกเส้น)', async () => {
  prodSwitches();
  globalThis.__lastPrompt = '';
  await ins.extractClipInsight({ url: 'x', platform: 'transcript', rawText: 'ก'.repeat(200), smooth: 'c' });
  const p = String(globalThis.__lastPrompt || '');
  assert.ok(p.includes(MARK_C), 'เส้นบทถอดเสียงต้องมีก้อนกฎแบบ C ด้วย');
  assert.ok(!p.includes(CONFLICT_FLOW), 'เส้นบทถอดเสียงต้องถูกแก้ประโยคที่ขัดกันเหมือนกัน');
  clear();
});

test('ป้ายรุ่นพรอมต์ต้องบอกแบบที่ใช้ + มีเลขรุ่นกำกับ', () => {
  prodSwitches();
  assert.ok(!/smooth/i.test(ins.currentInsightPromptRev()), 'ไม่เลือกแบบ = ป้ายต้องไม่มีคำว่า smooth');
  assert.match(ins.currentInsightPromptRev('a'), /-smoothA\d+$/, 'แบบ A ต้องลงท้าย -smoothA + เลขรุ่น');
  assert.match(ins.currentInsightPromptRev('c'), /-smoothC\d+$/, 'แบบ C ต้องลงท้าย -smoothC + เลขรุ่น');
  assert.ok(!/smooth/i.test(ins.currentInsightPromptRev('b')), 'ค่าที่ถอดทิ้งแล้วต้องไม่ติดป้าย');
  clear();
});

test('ตัวตรวจค่าใบงานคิว: รับเฉพาะค่าที่รู้จัก และไม่แตะค่าตั้งต้นของระบบ', () => {
  prodSwitches();
  process.env.CLIP_SMOOTH = 'a';
  assert.equal(ins.parseSmoothStyle('c'), 'c');
  assert.equal(ins.parseSmoothStyle('b'), '', 'ค่าที่ถอดทิ้งแล้วต้องเป็นค่าว่าง');
  assert.equal(ins.parseSmoothStyle(''), '', '🔴 ใบงานคิวห้ามหยิบค่าตั้งต้นของเครื่องที่รับคิวมาติดใบงาน');
  assert.equal(ins.resolveSmoothStyle(''), 'a', 'ส่วนตอนถอดจริง ค่าตั้งต้นของระบบยังใช้ได้ตามเดิม');
  clear();
});

// ── ชุดที่เพิ่มตามผู้ตรวจ Sol 11 ส.ค. (ช่องโหว่ที่เทสเดิม 139 ข้อยังไม่แตะ) ──

test('🔴 ปุ่ม "มาตรฐานเดิม" ต้องบังคับมาตรฐานได้จริง แม้ระบบตั้งค่าเริ่มต้นเป็น A ไว้', () => {
  prodSwitches();
  process.env.CLIP_SMOOTH = 'a';
  const std = ins._buildVideoInsightPromptForTest({ smooth: 'std' });
  assert.ok(!std.includes(MARK_A) && !std.includes(MARK_C), 'กดมาตรฐานเดิมต้องไม่มีก้อนกฎความลื่นเลย');
  assert.ok(std.includes(CONFLICT_FLOW), 'กดมาตรฐานเดิมต้องได้พรอมต์เดิมที่ยังไม่ถูกแก้ถ้อยคำ');
  assert.equal(ins.resolveSmoothStyle('std'), '', 'std ต้องแปลว่ามาตรฐาน ไม่ใช่ตกไปใช้ค่าตั้งต้นระบบ');
  assert.ok(!/smooth/i.test(ins.currentInsightPromptRev('std')), 'ป้ายรุ่นของมาตรฐานต้องไม่มีคำว่า smooth');
  clear();
});

test('std ต้องถูกเก็บลงใบงานคิวได้ (เครื่องทีมจะได้ไม่หยิบค่าตั้งต้นของตัวเองมาใช้)', () => {
  assert.equal(ins.parseSmoothStyle('std'), 'std', 'ใบงานต้องจำได้ว่าพนักงาน "จงใจ" เลือกมาตรฐาน');
});

test('เลขรุ่นกฎต้องขยับเมื่อถ้อยคำกฎเปลี่ยน (ป้ายรุ่นห้ามค้างรุ่นเก่า)', () => {
  prodSwitches();
  const rev = ins.currentInsightPromptRev('c');
  const m = rev.match(/-smoothC(\d+)$/);
  assert.ok(m, 'ป้ายต้องมีเลขรุ่นต่อท้าย');
  assert.ok(Number(m[1]) >= 2, 'รอบแก้ตามผู้ตรวจ 11 ส.ค. ต้องเป็นรุ่น 2 ขึ้นไป');
  clear();
});

test('🔴 กฎ C ต้องมีข้อชี้ขาดที่ผู้ตรวจสั่งเพิ่ม (ที่มาของตัวเลข + ลำดับเมื่อกฎชนกัน)', () => {
  prodSwitches();
  const p = ins._buildVideoInsightPromptForTest({ smooth: 'c' });
  assert.ok(p.includes('ตัวเลขและจำนวนเงินให้ตัดสินตามที่มา'), 'ต้องบอกวิธีตัดสินตัวเลขว่ามาจากจอหรือจากปากคน');
  assert.ok(p.includes('ให้การรักษาสถานะหลักฐานชนะเสมอ'), 'ต้องประกาศลำดับความสำคัญเมื่อกฎเปิดเรื่องชนกับการรักษาแหล่ง');
  clear();
});

test('🔴 กฎ A ต้องมีเกราะกันอาการแบบเดียวกับที่ทำให้วิธี B ถูกถอด (ข้อกล่าวหา/คดี)', () => {
  prodSwitches();
  const p = ins._buildVideoInsightPromptForTest({ smooth: 'a' });
  assert.ok(p.includes('ข้อกล่าวหา คำวินิจฉัย เรื่องที่มีคู่กรณี'), 'A ต้องบังคับคงคนพูดกำกับในเรื่องที่มีคู่กรณี');
  clear();
});

test('🔴 เส้นไฟล์วิดีโอ (TikTok/FB/IG) ต้องรับแบบการเล่าเหมือนเส้นลิงก์ตรง', async () => {
  prodSwitches();
  globalThis.__lastVideoPrompt = '';
  const p = ins._buildVideoInsightPromptForTest({ sourceMeta: null, smooth: 'c' });
  assert.ok(p.includes(MARK_C), 'พรอมต์ของเส้นไฟล์วิดีโอสร้างจากตัวเดียวกัน ต้องได้กฎ C');
  // ยิงผ่านฟังก์ชันจริงของเส้นไฟล์ เพื่อกันเคส "พารามิเตอร์หล่นระหว่างทาง"
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/lib/services/clipInsightService.js', import.meta.url), 'utf8');
  assert.match(src, /extractInsightFromVideoBuffer\([^)]*opts = \{\}\)[\s\S]{0,400}buildVideoInsightPrompt\(opts\)/,
    'เส้นไฟล์วิดีโอต้องส่ง opts ทั้งก้อน (ที่มี smooth) เข้าตัวประกอบพรอมต์');
  clear();
});

test('🔴 หน้าเว็บกับเซิร์ฟเวอร์ต้องรับค่าชุดเดียวกัน (กันสองฝั่งคลาดกันแบบเงียบ)', async () => {
  const { readFile } = await import('node:fs/promises');
  const page = await readFile(new URL('../src/app/clip-transcript/page.js', import.meta.url), 'utf8');
  const block = page.slice(page.indexOf('const STYLE_CHOICES'), page.indexOf('export default'));
  const uiValues = [...block.matchAll(/value:\s*'([^']*)'/g)].map(m => m[1]);
  assert.ok(uiValues.length >= 3, 'หน้าเว็บต้องมีตัวเลือกอย่างน้อย 3 ปุ่ม');
  const { SMOOTH_ACCEPTED } = await import('../src/lib/services/clipSmoothStyle.js');
  for (const v of uiValues) {
    assert.ok(SMOOTH_ACCEPTED.includes(v), `ปุ่ม "${v}" ในหน้าเว็บ เซิร์ฟเวอร์ไม่รู้จัก → จะถูกลดเป็นมาตรฐานแบบเงียบ`);
  }
});

test('คิวกันซ้ำต้องเทียบชนิดงานและแบบการเล่าด้วย ไม่ใช่แค่ลิงก์', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/app/api/clip-transcript/submit/route.js', import.meta.url), 'utf8');
  assert.match(src, /j\.url === url && isActive\(j\)/, 'ยังต้องเทียบลิงก์+สถานะเหมือนเดิม');
  assert.match(src, /\(j\.kind \|\| 'insight'\) === normKind/, 'ต้องเทียบชนิดงาน (กัน hunt/transcript บังงาน insight)');
  assert.match(src, /String\(j\.smooth \|\| ''\) === smoothStyle/, 'ต้องเทียบแบบการเล่า (กันคืนใบงานผิดแบบ)');
});

test('เส้นคิวต้องส่งแบบการเล่าต่อครบทุกทอด (ใบงาน → เครื่องทีม → endpoint ถอด)', async () => {
  const { readFile } = await import('node:fs/promises');
  const worker = await readFile(new URL('../src/app/api/clip-transcript/worker/route.js', import.meta.url), 'utf8');
  assert.match(worker, /smooth:\s*next\.smooth \|\| ''/, 'ตัวจ่ายงานต้องส่ง smooth ไปกับใบงาน');
  const script = await readFile(new URL('../scripts/clip-worker.mjs', import.meta.url), 'utf8');
  assert.match(script, /job\.smooth \? \{ smooth: job\.smooth \} : \{\}/, 'เครื่องทีมต้องส่ง smooth ต่อให้ endpoint ถอด (ใบงานเก่าไม่มีค่า = ไม่ส่ง)');
});

test('คลังกันซ้ำต้องเทียบเลขรุ่นกฎด้วยเมื่อเลือกแบบไว้ (กันคืนผลรุ่นเก่า)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/app/api/clip-transcript/insight/route.js', import.meta.url), 'utf8');
  assert.match(src, /String\(c\.smoothStyle \|\| ''\) === smoothStyle/, 'ต้องเทียบแบบการเล่า');
  assert.match(src, /\(!smoothStyle \|\| c\.promptRev === wantRev\)/, 'เคสที่เลือกแบบไว้ต้องเทียบเลขรุ่นกฎด้วย');
});

// ── ★ 11 ส.ค. 69 · ชุด "ชื่อต้องมีที่มา" (เจ้าของสั่งหลังเห็นคลิปเดียวได้ชื่อคู่กรณี 3 แบบ) ──
//   คุมสองอย่าง: (1) ปิดสวิตช์ = พรอมต์เดิมเป๊ะ (2) เปิดแล้วต้องไม่เหลือประโยคที่อนุญาตให้เดาสะกด

const NAME_OLD_PERMISSION = '- ✅ มีหลักฐานข้อใดข้อหนึ่งชัดเจน';
const NAME_OLD_EVIDENCE = 'ได้เฉพาะเมื่อมีหลักฐานในคลิปเท่านั้น: มีคนเอ่ยชื่อในเสียง';
const NAME_OLD_COMPLETE = 'ทุกตัวเลข/ชื่อ/จำนวนเงินที่ปรากฏในคลิป (พูดหรือขึ้นจอ) ต้องอยู่ใน rawData';

test('ปิดสวิตช์ชื่อ = พรอมต์เดิมเป๊ะ และประโยคเดิมต้องอยู่ครบทุกจุด', () => {
  prodSwitches();
  const p = ins._buildVideoInsightPromptForTest({});
  for (const w of [NAME_OLD_PERMISSION, NAME_OLD_EVIDENCE, NAME_OLD_COMPLETE]) {
    assert.ok(p.includes(w), `ปิดสวิตช์แล้วประโยคเดิมต้องยังอยู่: ${w.slice(0, 30)}`);
  }
  assert.ok(!p.includes('namesFound'), 'ปิดสวิตช์ต้องไม่มีช่องบัญชีชื่อ');
  assert.ok(!/-names\d/.test(ins.currentInsightPromptRev()), 'ป้ายรุ่นต้องไม่มีคำว่า names');
  clear();
});

test('🔴 เปิดสวิตช์ชื่อ: ต้องไม่เหลือประโยคที่อนุญาตให้เดาสะกดเลยสักจุด (ทั้ง 4 จุดที่ชนกัน)', () => {
  prodSwitches();
  process.env.CLIP_NAME_SOURCE = '1';
  const p = ins._buildVideoInsightPromptForTest({});
  for (const w of [NAME_OLD_PERMISSION, NAME_OLD_EVIDENCE, NAME_OLD_COMPLETE]) {
    assert.ok(!p.includes(w), `ประโยคเดิมที่อนุญาตให้เดาต้องถูกแก้: ${w.slice(0, 30)}`);
  }
  assert.ok(p.includes('ยืนยันว่ามีคนชื่อนี้อยู่จริง แต่ยืนยันการสะกดไม่ได้'), 'ต้องมีข้อที่แยกว่าเสียงยืนยันการสะกดไม่ได้');
  assert.ok(p.includes('ห้ามเดาการสะกดลงในเนื้อเด็ดขาด'), 'ต้องมีคำสั่งห้ามเดาสะกด');
  assert.ok(p.includes('บุคคลสาธารณะ'), 'ต้องมีข้อยกเว้นบุคคลสาธารณะ ไม่งั้นชื่อดาราจะกลายเป็นคำกลางหมด');
  assert.ok(p.includes('namesFound'), 'สคีมาต้องมีช่องบัญชีชื่อ');
  assert.match(ins.currentInsightPromptRev(), /-names1/, 'ป้ายรุ่นต้องบอกว่าใช้กฎชื่อรุ่นนี้');
  clear();
});

test('🔴 เจ้าของสั่ง: ห้ามยึดแคปชั่นเป็นตัวตั้ง (บางคลิปแคปชั่นคนละเรื่องกับคลิป)', () => {
  prodSwitches();
  process.env.CLIP_NAME_SOURCE = '1';
  const p = ins._buildVideoInsightPromptForTest({ sourceMeta: { uploader: 'เพจทดสอบ', caption: 'ข้อความทดสอบ' } });
  assert.ok(!p.includes('ใช้ยืนยันชื่อคน/บริบทได้'), 'ประโยคเดิมที่ให้แคปชั่นยืนยันชื่อได้ ต้องถูกแก้');
  assert.ok(p.includes('ตัวช่วยเทียบ') && p.includes('ห้ามใช้เป็นตัวตั้ง'), 'ต้องระบุว่าแคปชั่นเป็นแค่ตัวช่วยเทียบ');
  assert.ok(p.includes('พูดคนละเรื่องกับสิ่งที่เห็นในคลิป'), 'ต้องมีข้อให้ทิ้งแคปชั่นที่พูดคนละเรื่อง');
  clear();
});

test('บัญชีชื่อต้องรอดจากขั้นกรองข้อมูล (ไม่ถูกทิ้งเงียบ)', () => {
  const out = ins._normalizeInsightForTest({
    headline: 'x', rawData: 'y',
    namesFound: [
      { name: 'สมชาย', source: 'จอ', role: 'เจ้าของร้าน', evidence: 'ป้ายชื่อ' },
      { name: 'คู่กรณี', source: 'เสียง', role: 'คู่กรณี' },
      { name: 'ไม่มีที่มา', source: 'มั่ว' },
      { name: '' },
    ],
  }, 'test');
  assert.equal(out.namesFound.length, 3, 'ชื่อว่างต้องถูกตัด ที่เหลือต้องอยู่ครบ');
  assert.equal(out.namesFound[0].source, 'จอ');
  assert.equal(out.namesFound[2].source, 'ไม่ระบุ', 'ค่าที่มาที่ไม่รู้จักต้องกลายเป็น "ไม่ระบุ" ไม่ใช่เชื่อตามที่โมเดลตอบ');
});

test('เคสเก่าที่ไม่มีบัญชีชื่อ ต้องไม่พังและได้อาเรย์ว่าง', () => {
  const out = ins._normalizeInsightForTest({ headline: 'x', rawData: 'y' }, 'test');
  assert.deepEqual(out.namesFound, []);
});

test('🔴 กฎกันฉากหาย ต้องอยู่ในทั้งแบบ A และแบบ C', () => {
  prodSwitches();
  for (const style of ['a', 'c']) {
    const p = ins._buildVideoInsightPromptForTest({ smooth: style });
    assert.ok(p.includes('ความลื่นห้ามชนะความครบของฉาก'), `แบบ ${style} ต้องมีข้อกันฉากหาย`);
  }
  assert.match(ins.currentInsightPromptRev('a'), /-smoothA4$/, 'แก้ถ้อยคำกฎแล้วต้องขยับเลขรุ่นเป็น 4');
  clear();
});

test('🔴 เจ้าของสั่ง: ชื่อช่อง/รายการ/เพจ ห้ามเข้าเนื้อ ต้องอยู่แค่ในบัญชีชื่อ (โทนข่าวพัง อ่านไม่ลื่น)', () => {
  prodSwitches();
  process.env.CLIP_NAME_SOURCE = '1';
  const p = ins._buildVideoInsightPromptForTest({});
  assert.ok(p.includes('ชื่อช่อง ชื่อรายการ ชื่อเพจ ชื่อผู้โพสต์ ห้ามเข้าไปอยู่ในเนื้อเด็ดขาด'), 'ต้องมีข้อห้ามชื่อช่อง/รายการเข้าเนื้อ');
  assert.ok(p.includes('เป็น "ช่องแยก" สำหรับให้คนตรวจงานดูที่มาของชื่อเท่านั้น'), 'สคีมาต้องบอกว่าบัญชีชื่อเป็นช่องแยก ไม่ใช่รายการที่ต้องยัดในเนื้อ');
  assert.ok(p.includes('ไม่ได้แปลว่าต้องเอาทุกชื่อในบัญชีไปใส่ในเนื้อ'), 'ต้องกันการตีความว่ามีบัญชีแล้วต้องใส่ให้ครบ');
  clear();
});

// ── ★ 11 ส.ค. 69 · ยามจากรอบล่าบั๊กก่อน push (ผู้ตรวจ Sol เจอ 8 ข้อ) ──

test('🔴 ส่งค่าแบบผิดมา ต้องได้มาตรฐานจริง ไม่ใช่แอบไปหยิบค่าตั้งต้นระบบ (Sol ข้อ 8)', () => {
  prodSwitches();
  process.env.CLIP_SMOOTH = 'a';
  assert.equal(ins.resolveSmoothStyle('b'), '', 'ส่งค่าผิด = ใช้มาตรฐาน ตรงกับที่ log บอก');
  assert.equal(ins.resolveSmoothStyle('พิมพ์ผิด'), '', 'ค่าพิมพ์ผิดก็ต้องได้มาตรฐาน');
  assert.equal(ins.resolveSmoothStyle(''), 'a', 'ไม่ได้ส่งอะไรมาเลย = ใช้ค่าตั้งต้นระบบตามเดิม');
  assert.equal(ins.resolveSmoothStyle(undefined), 'a', 'ไม่ส่งฟิลด์มาเลย = ใช้ค่าตั้งต้นระบบตามเดิม');
  clear();
});

test('คลังกันซ้ำ: ใบที่ปักหมุดต้องมาก่อน และคืนได้แม้ติดธงผลไม่สมบูรณ์ (Sol ข้อ 2)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/app/api/clip-transcript/insight/route.js', import.meta.url), 'utf8');
  assert.match(src, /const sameClip = all\.filter\(c => c\.url === url\)/, 'ต้องแยกรายการของคลิปนี้ก่อนกรองคุณภาพ');
  assert.match(src, /const pinned = sameClip[\s\S]{0,200}c\.chosen/, 'ใบปักหมุดต้องค้นจากรายการก่อนกรอง lowQuality');
  assert.match(src, /const hit = pinned \|\| usable/, 'ใบปักหมุดต้องมาก่อนใบล่าสุดเสมอ');
});

test('เก็บกวาดคลัง: ห้ามลบใบที่เพิ่งถอดเสร็จ และนับเพดานจากใบที่ลบได้เท่านั้น (Sol ข้อ 5)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/app/api/clip-transcript/insight/route.js', import.meta.url), 'utf8');
  assert.match(src, /!c\.chosen && c\.id !== caseId/, 'ใบที่เพิ่งสร้างในรอบนี้ต้องไม่อยู่ในรายการที่ลบได้');
  assert.match(src, /removable\.slice\(0, Math\.max\(0, removable\.length - 400\)\)/, 'เพดานต้องนับจากใบที่ลบได้ ไม่ใช่ยอดรวมทั้งคลัง');
});

test('ปักหมุด: ปักใบใหม่ก่อนปลดใบเก่า และห้ามกลืน error ตอนปลด (Sol ข้อ 1)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/app/api/clip-transcript/cases/route.js', import.meta.url), 'utf8');
  const pinAt = src.indexOf('chosenAt: chosen ?');
  const unpinAt = src.indexOf('chosen: false');
  assert.ok(pinAt > 0 && unpinAt > pinAt, 'ต้องปักใบใหม่ก่อน แล้วค่อยปลดใบเก่า (ปลดก่อนแล้วปักล้ม = ไม่เหลือใบเลือก)');
  assert.doesNotMatch(src, /chosen: false \}\)\)\.catch\(\(\) => \{\}\)/, 'ห้ามกลืน error ตอนปลดหมุดแบบเงียบ');
  assert.match(src, /warning:/, 'ปลดไม่สำเร็จต้องบอกผู้ใช้ ไม่ใช่ตอบว่าสำเร็จเฉยๆ');
});

test('เส้นล่าประเด็นต้องส่ง cacheAnyStyle ทั้งฝั่งหน้าเว็บและ server (Sol ข้อ 3)', async () => {
  const { readFile } = await import('node:fs/promises');
  const page = await readFile(new URL('../src/app/clip-transcript/page.js', import.meta.url), 'utf8');
  const hunt = await readFile(new URL('../src/app/api/clip-transcript/hunt/route.js', import.meta.url), 'utf8');
  assert.match(page, /cacheAnyStyle: true/, 'หน้าเว็บต้องส่งธงนี้ตอนยิงถอดก่อนล่าประเด็น');
  assert.match(hunt, /cacheAnyStyle: true/, 'ฝั่ง server ก็ต้องส่งเหมือนกัน');
});

test('เครื่องทีมรุ่นเก่าทำแบบหล่น ต้องถูกจับได้ ไม่ใช่ขึ้นว่าสำเร็จเฉยๆ (Sol ข้อ 4)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/app/api/clip-transcript/worker/route.js', import.meta.url), 'utf8');
  assert.match(src, /styleMismatch/, 'ต้องติดธงไว้บนใบงานเมื่อแบบที่ได้ไม่ตรงกับที่เลือก');
  assert.match(src, /want !== got/, 'ต้องเทียบแบบที่เลือกกับแบบที่ได้จริง');
});
