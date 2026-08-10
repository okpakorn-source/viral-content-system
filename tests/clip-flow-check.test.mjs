// ★ 10 ส.ค. 69 เฟส A — เทสยาม "ตัววัดความลื่นของเนื้อดิบ" (clipFlowCheck.js)
//   โมดูลนี้ pure ล้วน ไม่เรียก AI ไม่แตะเนื้อ — เฟสนี้แค่ "วัดและติดธง" ตามลำดับที่ผู้ตรวจ Sol วางให้
//   คุม: (1) วัดถูกตามอาการจริงที่คาลิเบรตจากคลัง (2) คลิปสั้นห้ามถูกบังคับจนห้วน
//        (3) ตรวจครอบประเด็นย่อย (4) อินพุตพังต้องไม่ล้ม
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  measureFlow, thresholdsFor, inspectField, flowVerdict, extractAnchors, splitParagraphs,
} from '../src/lib/services/clipFlowCheck.js';

const para = (n) => 'ก'.repeat(n);

test('measureFlow: นับย่อหน้า/ความยาว/ย่อหน้ายาวสุด ถูกต้อง', () => {
  const t = `${para(100)}\n\n${para(300)}\n\n${para(50)}`;
  const m = measureFlow(t);
  assert.equal(m.paragraphs, 3);
  assert.equal(m.maxParagraph, 300);
  assert.equal(m.chars, t.length);
});

test('measureFlow: ข้อความว่าง/undefined ต้องไม่ล้ม', () => {
  for (const bad of [undefined, null, '', 123, {}]) {
    const m = measureFlow(bad);
    assert.equal(typeof m.chars, 'number');
  }
  assert.deepEqual(splitParagraphs(undefined), []);
});

test('🔑 อาการหลักที่คาลิเบรตจากคลังจริง: ย่อหน้ากำแพงต้องถูกจับ', () => {
  // คลังจริงเคยเจอย่อหน้าเดียวยาว 2,238 ตัวอักษร
  const issues = inspectField('rawData', para(1200), 240);
  assert.ok(issues.some((i) => i.type === 'wall'), 'ย่อหน้า 1,200 ตัวอักษรต้องติดธง wall');
});

test('🔴 คลิปสั้นห้ามถูกบังคับให้แตกย่อหน้าจนห้วน (เจ้าของทักเรื่องเนื้อห้วนมาแล้ว)', () => {
  const shortBody = para(430); // ขนาดเท่าเคสจริงของคลิปสั้นในคลัง
  const issues = inspectField('rawData', shortBody, 45);
  assert.equal(issues.filter((i) => i.type === 'no_break').length, 0, 'คลิปสั้นเนื้อไม่ยาว ต้องไม่โดนบังคับแบ่งย่อหน้า');
});

test('คลิปยาวเนื้อเยอะแต่ย่อหน้าเดียว ต้องติดธง no_break', () => {
  const issues = inspectField('rawData', para(1500), 300);
  assert.ok(issues.some((i) => i.type === 'no_break'));
});

test('เกณฑ์ต่างกันตามความยาวคลิป (ยาว/กลาง/สั้น)', () => {
  // ★ Sol: เดิมใช้ >= ทำให้ผ่านได้แม้ทุกช่วงเท่ากัน — ต้อง assert ค่าจริงและครบทั้งสามช่วง
  assert.equal(thresholdsFor(300).minParagraphs, 2, 'คลิปยาวต้องบังคับอย่างน้อย 2 ย่อหน้า');
  assert.equal(thresholdsFor(120).minParagraphs, 1, 'คลิปกลาง');
  assert.equal(thresholdsFor(30).minParagraphs, 1, 'คลิปสั้น');
  assert.ok(thresholdsFor(30).maxParagraph > thresholdsFor(300).maxParagraph, 'คลิปสั้นต้องผ่อนปรนกว่าจริง ไม่ใช่เท่ากัน');
  assert.ok(thresholdsFor(30).minCharsToSplit > thresholdsFor(300).minCharsToSplit, 'คลิปสั้นต้องเริ่มบังคับแบ่งช้ากว่า');
  assert.equal(thresholdsFor(undefined).minParagraphs, 1, 'ไม่รู้ความยาว = ใช้เกณฑ์ผ่อนปรนสุด');
});

test('จับการเปิดเรื่องด้วยกรอบสนทนา (เคสที่เจ้าของยกมาเอง)', () => {
  const t = 'โตโน่ ภาคิน ร่วมสนทนากับ ฌอน บูรณะหิรัญ เล่าถึงประวัติชีวิตวัยเด็ก';
  assert.ok(inspectField('rawData', t, 240).some((i) => i.type === 'frame_open'));
  const ok = 'ตอนโตโน่อายุ 9 ขวบ คุณพ่อเสียชีวิตกะทันหันจากเส้นเลือดใหญ่แตก';
  assert.ok(!inspectField('rawData', ok, 240).some((i) => i.type === 'frame_open'));
});

test('flowVerdict ต้องตรวจประเด็นย่อยด้วย ไม่ใช่แค่เนื้อหลัก', () => {
  const insight = {
    rawData: `${para(300)}\n\n${para(300)}`,
    subStories: [{ no: 1, topic: 'x', rawData: para(1500) }],
  };
  const v = flowVerdict(insight, 300);
  assert.ok(v.issues.some((i) => i.field.startsWith('subStories')), 'ต้องเห็นปัญหาในประเด็นย่อย');
});

test('เนื้อที่จัดรูปดีแล้วต้องผ่าน (กันเกณฑ์เข้มจนไม่มีอะไรผ่านเลย)', () => {
  // ★ ข้อความจำลองต้องมีช่องว่างเหมือนภาษาไทยจริง (บทเรียน: ฟิกซ์เจอร์ไร้ช่องว่างทำให้เกณฑ์ยิงมั่ว)
  const realistic = (n) => Array.from({ length: Math.ceil(n / 30) }, () => 'ก'.repeat(25)).join(' ');
  const good = [realistic(400), realistic(380), realistic(350)].join('\n\n');
  const v = flowVerdict({ rawData: good, subStories: [] }, 300);
  assert.equal(v.pass, true, 'เนื้อ 3 ย่อหน้าขนาดพอดีต้องผ่าน — ได้: ' + JSON.stringify(v.issues));
});

test('extractAnchors: เก็บตัวเลข+หน่วยไว้เทียบว่าของหายไหม (ของเฟสถัดไป)', () => {
  const a = extractAnchors('มีหนี้ 18 ล้านบาท และเก็บเงินได้ 180,000 บาท ใช้เวลา 2 ปี');
  // ★ Sol: startsWith('18') ผ่านได้จาก 180000 แม้ 18ล้าน หาย — ต้องเทียบค่าเต็ม
  assert.ok(a.includes('18ล้าน'), 'ต้องเก็บ 18ล้าน แบบเต็มค่า');
  assert.ok(a.includes('180000บาท'), 'ต้องปอกคอมมาแล้วเก็บเป็น 180000บาท');
  assert.ok(a.includes('2ปี'), 'ต้องเก็บหน่วยปีด้วย');
});

// ── เฟส B: กฎพรอมต์ (ต้องอยู่หลังประตู และไม่ชนกฎเดิม) ─────────────────────
import { register } from 'node:module';
const SRC_ROOT = new URL('../src/', import.meta.url).href;
const mod = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const STUB = mod(`export async function callAI(){throw new Error('FORBIDDEN');}
export async function callGeminiVideo(){return {};}
export async function callGeminiVideoFile(){return {};}
export const MODEL_FAST='t'; export const MODEL_NEWS_ANALYSIS='t';`);
register(mod(`
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/ai/openai' || specifier === '@/lib/ai/modelConfig' || specifier === '@/lib/ai/geminiClient') return { url: ${JSON.stringify(STUB)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const suffix = specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js');
    return nextResolve(new URL(suffix, ${JSON.stringify(SRC_ROOT)}).href, context);
  }
  return nextResolve(specifier, context);
}`));
const ins = await import('../src/lib/services/clipInsightService.js');
const FSW = ['CLIP_FLOW', 'CLIP_GRAY_ALIVE', 'CLIP_SMART_ORDER', 'CLIP_STYLE_DIRECT', 'CLIP_PROMPT_0804'];
const fclear = () => { for (const k of FSW) delete process.env[k]; };

test('เฟส B: ปิดสวิตช์ = ไม่มีบล็อกจัดรูป และป้ายรุ่นไม่มี flow1', () => {
  fclear();
  assert.equal(ins.currentInsightPromptRev(), 'raw-depth2legs-0801');
  assert.ok(!ins._buildInsightAddonsForTest({}).includes('จัดรูปเนื้อให้ตาคนอ่านมีที่พัก'));
});

test('เฟส B: เปิดสวิตช์ = กฎเข้าพรอมต์จริง + ป้ายรุ่นต่อท้าย flow1', () => {
  fclear();
  process.env.CLIP_FLOW = '1';
  assert.equal(ins.currentInsightPromptRev(), 'raw-depth2legs-0801-flow1');
  const p = ins._buildVideoInsightPromptForTest({});
  assert.ok(p.includes('จัดรูปเนื้อให้ตาคนอ่านมีที่พัก'), 'กฎต้องอยู่ในพรอมต์ที่ประกอบเสร็จแล้ว');
  assert.ok(p.includes('subStories ทุกก้อน'), 'ต้องครอบประเด็นย่อยด้วย');
  assert.ok(p.includes('ไม่ต้องฝืนแบ่งย่อหน้า'), 'ต้องมีตัวกันคลิปสั้นห้วน');
  assert.ok(p.includes('ห้ามตัดข้อเท็จจริงเพื่อให้ย่อหน้าสั้นลง'), 'ต้องกันเนื้อหายตอนจัดรูป');
  fclear();
});

test('เฟส B: ตัวอย่างในกฎห้ามมีชื่อคน/ตัวเลขจริง (บทเรียน 9 ส.ค.)', () => {
  fclear();
  process.env.CLIP_FLOW = '1';
  const g = ins._buildInsightAddonsForTest({});
  const block = g.split('★★').find((b) => b.includes('จัดรูปเนื้อให้ตาคนอ่านมีที่พัก'));
  assert.ok(block, 'ต้องเจอบล็อก');
  assert.ok(!/เอิร์น|ไดเม่|กรรชัย|ป้าแห้ง|โตโน่|พฤหัส/.test(block), 'ห้ามมีชื่อคนจริง');
  assert.ok(!/\d[\d,.]*\s*(บาท|ล้าน|คน|ปี)/.test(block), 'ห้ามมีตัวเลขข้อเท็จจริงจริง');
  fclear();
});

test('เฟส B: สวิตช์ค่าแปลกต้องเท่ากับปิด', () => {
  fclear();
  for (const v of ['0', 'true', '', ' 1']) {
    process.env.CLIP_FLOW = v;
    assert.equal(ins.currentInsightPromptRev(), 'raw-depth2legs-0801', `ค่า "${v}" ต้องถือว่าปิด`);
  }
  fclear();
});
