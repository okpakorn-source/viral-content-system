// ★ 10 ส.ค. 69 — เทสยาม "ด่านล็อกข้อเท็จจริง 2 รอบ" (CLIP_FACT_LOCK)
//   เจ้าของสั่งแก้: ลุงสามล้อ 5,000 vs 1,000 บาท · ช่างตัดผม ฟรีเลย vs ฟรีครั้งหน้า
//   คุม: (1) สวิตช์ปิด = พรอมต์/ผลลัพธ์เดิมเป๊ะ (2) ตัวเลขที่ยืนยันแล้วต้องแก้ทุกช่อง
//        (3) ใจความห้ามแก้เนื้อเอง ต้องติดธง (4) โมเดลตอบพังต้องไม่ทำเคสล้ม
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

const SW = ['CLIP_FACT_LOCK'];
const saved = {};
for (const k of SW) { saved[k] = process.env[k]; delete process.env[k]; }
process.on('exit', () => { for (const k of SW) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const ins = await import('../src/lib/services/clipInsightService.js');
const raw = await import('../src/lib/services/clipRawStoryService.js');

// เคสจริงที่เจ้าของชี้: กรอบเทาเขียน 5,000 บาท / คลิปจริงคือ 1,000 บาท
const INSIGHT = {
  headline: 'ผู้ใจบุญซื้อสามล้อคันใหม่ราคา 5,000 บาท มอบให้คุณลุง',
  rawData: 'มีผู้ใจบุญติดต่อมาขอซื้อสามล้อคันใหม่สภาพพร้อมใช้งานราคา 5,000 บาท มอบให้คุณลุงได้ใช้ประกอบอาชีพต่อไป',
  keyPoints: [{ point: 'ผู้ใจบุญออกเงิน 5,000 บาท ซื้อสามล้อให้' }],
  subStories: [{ no: 1, topic: 'ผู้ใจบุญยื่นมือช่วย', rawData: 'สามล้อคันใหม่ราคา 5,000 บาท ถูกส่งถึงมือคุณลุงในวันเดียวกัน' }],
};

test('สวิตช์ปิด: ไม่สร้างใบตรวจ ไม่แตะ insight เลย (พฤติกรรมเดิมเป๊ะ)', () => {
  delete process.env.CLIP_FACT_LOCK;
  assert.deepEqual(ins.buildFactsToVerify(INSIGHT), []);
  const r = ins.applyFactChecks(INSIGHT, [{ id: 'n1', kind: 'n', value: '5,000 บาท', text: 'ราคา 5,000 บาท' }], [{ id: 'n1', ok: false, heard: '1,000 บาท' }]);
  assert.equal(r.insight, INSIGHT, 'ต้องคืนก้อนเดิมทั้งอ้างอิง');
  assert.equal(r.conflicts.length, 0);
});

test('สวิตช์ปิด: พรอมต์รอบสองต้องไม่มีบล็อกตรวจ แม้ส่ง factsToVerify มา', () => {
  delete process.env.CLIP_FACT_LOCK;
  const p = raw._buildRawStoryPromptForTest(null, null, { factsToVerify: [{ id: 'n1', text: 'ราคา 5,000 บาท' }] });
  assert.ok(!p.includes('ข้อเท็จจริงที่รอบแรกบันทึกไว้'), 'ปิดสวิตช์ต้องไม่มีบล็อก 🔍');
  assert.ok(!p.includes('factChecks'), 'ปิดสวิตช์ต้องไม่ขอคีย์ผลตรวจ');
});

test('เปิดสวิตช์: ใบตรวจเก็บตัวเลข+ใจความแกน และมีบริบทว่าเลขของอะไร', () => {
  process.env.CLIP_FACT_LOCK = '1';
  const facts = ins.buildFactsToVerify(INSIGHT);
  const nums = facts.filter(f => f.kind === 'n');
  assert.ok(nums.length >= 1, 'ต้องดึงตัวเลขได้');
  assert.match(nums[0].value, /5,?000/);
  assert.ok(nums[0].text.length > String(nums[0].value).length, 'ต้องมีบริบทนำหน้าตัวเลข ไม่ใช่เลขลอย');
  assert.ok(facts.some(f => f.kind === 'k'), 'ต้องมีใจความแกนด้วย');
});

test('🔒 ปิดคำตอบ: คำถามตัวเลขที่ส่งไปห้ามมีค่าที่รอบแรกบันทึกไว้ (กันเออออตาม)', () => {
  process.env.CLIP_FACT_LOCK = '1';
  const facts = ins.buildFactsToVerify(INSIGHT);
  const n1 = facts.find(f => f.kind === 'n');
  assert.ok(n1.ask, 'ข้อตัวเลขต้องมีคำถามแบบปิดคำตอบ');
  assert.ok(!/5,?000/.test(n1.ask), 'คำถามห้ามมีตัวเลขของรอบแรก — ได้: ' + n1.ask);
  const p = raw._buildRawStoryPromptForTest(null, null, { factsToVerify: facts });
  const block = p.split('🔍')[1].split('★★')[0];
  assert.ok(!/5,?000/.test(block), 'บล็อกตรวจที่ส่งให้โมเดลห้ามมีตัวเลขรอบแรกหลุดไป');
  assert.ok(block.includes('จงใจไม่บอก'), 'ต้องบอกโมเดลว่าให้ตอบจากคลิปเอง');
});

test('🔒 ปิดคำตอบ (ทั้งฉบับ): พรอมต์รอบสองห้ามมีตัวเลขของเคสนี้หลุดทางใดเลย', () => {
  process.env.CLIP_FACT_LOCK = '1';
  // ทางรั่วที่เจอจากรันจริง 10 ส.ค.: บล็อกข้อเท็จจริงแกน (พาดหัว/ประเด็นสำคัญ) + ชื่อประเด็นในโครงรอบแรก
  const hints = [{ topic: 'ผู้ใจบุญซื้อสามล้อ 5,000 บาทให้คุณลุง', timeRange: '00:10–01:00' }];
  const identity = ins.buildIdentityFromInsight(INSIGHT, '');
  const p = raw._buildRawStoryPromptForTest(hints, identity, { factsToVerify: ins.buildFactsToVerify(INSIGHT) });
  assert.ok(!/5,?000/.test(p), 'ตัวเลขของเคสห้ามหลุดเข้าพรอมต์รอบสองไม่ว่าทางใด');
  assert.ok(p.includes('... บาท'), 'ต้องถูกปิดเป็นจุดไข่ปลาพร้อมหน่วย ไม่ใช่ตัดทิ้งจนไม่รู้ว่าถามอะไร');
});

test('🔒 ปิดคำตอบ: ตอบ ok=true แต่เลขต่างจากรอบแรก = ต้องจับได้ (ไม่เชื่อคำติ๊ก เทียบค่าเสมอ)', () => {
  process.env.CLIP_FACT_LOCK = '1';
  const facts = ins.buildFactsToVerify(INSIGHT);
  const n1 = facts.find(f => f.kind === 'n');
  const r = ins.applyFactChecks(INSIGHT, facts, [{ id: n1.id, ok: true, heard: '1,000 บาท' }]);
  assert.equal(r.conflicts.length, 1, 'ok=true ก็ต้องเทียบค่า ไม่ใช่เชื่อคำติ๊ก');
  assert.equal(r.conflicts[0].fixed, false, 'ไม่ตรงกัน = ไม่แก้เอง');
  assert.match(r.insight.rawData, /5,000/, 'เนื้อเดิมต้องไม่ถูกแตะ');
});

test('เปิดสวิตช์: พรอมต์รอบสองมีบล็อกตรวจ + ขอคีย์ factChecks + ห้ามลอกสำนวน', () => {
  process.env.CLIP_FACT_LOCK = '1';
  const p = raw._buildRawStoryPromptForTest(null, null, { factsToVerify: [{ id: 'n1', text: 'ราคา 5,000 บาท' }] });
  assert.ok(p.includes('แบบตรวจข้อเท็จจริง'), 'ต้องมีบล็อกตรวจ');
  assert.ok(p.includes('"factChecks"'), 'ต้องขอคีย์ผลตรวจในคำตอบ');
  assert.ok(p.includes('ห้ามลอกถ้อยคำในบล็อกนี้ไปเป็นเนื้อเรื่อง'), 'ต้องกันสำนวนรอบแรกไหลปน');
});

test('🎯 เคสลุงสามล้อ: ตัวเลขไม่ตรงกัน = ห้ามแก้เนื้อเอง ต้องขึ้นธงพร้อมค่าทั้งสองรอบ', () => {
  // 🔴 บทเรียนรันจริง: คลิปเดิมถอด 3 รอบได้ 5,000 / 5,000 / 1,000 / 1,500 — หูโมเดลเองไม่นิ่ง
  //    เอาค่ารอบสองเขียนทับรอบแรก = ทอยเหรียญ ไม่ใช่ความแม่น → ต้องส่งให้คนเปิดคลิปเช็ค
  process.env.CLIP_FACT_LOCK = '1';
  const facts = ins.buildFactsToVerify(INSIGHT);
  const n1 = facts.find(f => f.kind === 'n');
  const r = ins.applyFactChecks(INSIGHT, facts, [{ id: n1.id, ok: false, heard: '1,000 บาท' }]);
  const all = [r.insight.headline, r.insight.rawData, r.insight.keyPoints[0].point, r.insight.subStories[0].rawData].join(' | ');
  assert.ok(!/1,?000/.test(all), 'ห้ามเขียนค่ารอบสองทับเนื้อ — ได้: ' + all);
  assert.equal((all.match(/5,000/g) || []).length, 4, 'เนื้อเดิมต้องอยู่ครบทุกช่อง ไม่ถูกแตะ');
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].fixed, false);
  assert.match(r.conflicts[0].verified, /1,000/, 'ธงต้องบอกค่าที่รอบสองได้ยิน');
  assert.match(r.conflicts[0].round1, /5,000/, 'ธงต้องบอกค่าที่รอบแรกได้ด้วย ให้คนเทียบเองได้');
  assert.equal(r.insight.factConflicts.length, 1);
});

test('🎯 เคสช่างตัดผม (ใจความ): ห้ามเขียนทับเนื้อเอง ต้องติดธงพร้อมคำที่คลิปยืนยัน', () => {
  process.env.CLIP_FACT_LOCK = '1';
  const base = { headline: 'เจ้าของร้านให้ตัดฟรีทันที', rawData: 'เจ้าของร้านตอบกลับมาว่าให้ตัดให้ฟรี', keyPoints: [] };
  const facts = ins.buildFactsToVerify(base);
  const k1 = facts.find(f => f.kind === 'k');
  const r = ins.applyFactChecks(base, facts, [{ id: k1.id, ok: false, heard: 'เจ้าของร้านบอกให้ตัดฟรีในครั้งหน้า และจะมอบเงินช่วยเหลือ' }]);
  assert.equal(r.insight.rawData, base.rawData, 'เนื้อกรอบเทาห้ามถูกเขียนทับอัตโนมัติ');
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].fixed, false, 'ใจความต้องไม่ถูกทำเครื่องหมายว่าแก้แล้ว');
  assert.match(r.insight.factConflicts[0].verified, /ครั้งหน้า/);
});

test('ok=true ทุกข้อ = ไม่มีธง ไม่มีการแก้ (ปกติต้องเงียบ)', () => {
  process.env.CLIP_FACT_LOCK = '1';
  const facts = ins.buildFactsToVerify(INSIGHT);
  const r = ins.applyFactChecks(INSIGHT, facts, facts.map(f => ({ id: f.id, ok: true, heard: '' })));
  assert.equal(r.conflicts.length, 0);
  assert.ok(!r.insight.factConflicts, 'ไม่ขัดกัน = ห้ามมีคีย์ธงติดเรคคอร์ด');
});

test('โมเดลตอบพัง/ครึ่งๆ ต้องไม่ทำเคสล้ม', () => {
  process.env.CLIP_FACT_LOCK = '1';
  const facts = ins.buildFactsToVerify(INSIGHT);
  for (const bad of [null, undefined, 'x', [{ }], [{ id: 'ไม่มีจริง', ok: false, heard: '9 บาท' }]]) {
    const r = ins.applyFactChecks(INSIGHT, facts, bad);
    assert.ok(r && r.insight, 'ต้องคืน insight เสมอ');
  }
  // heard ว่าง = คลิปไม่มีเรื่องนี้ → ติดธง ไม่แก้ตัวเลข
  const n1 = facts.find(f => f.kind === 'n');
  const r2 = ins.applyFactChecks(INSIGHT, facts, [{ id: n1.id, ok: false, heard: '' }]);
  assert.match(r2.insight.rawData, /5,000/, 'ไม่มีค่าที่ยืนยัน = ห้ามเดาแก้');
  assert.equal(r2.conflicts[0].note, 'รอบสองดูคลิปแล้วไม่พบเรื่องนี้');
});

test('🐛 บั๊กจากรันจริง: รหัสที่โมเดลคืนติดวงเล็บ "[n1]" ต้องยังจับคู่ติด', () => {
  process.env.CLIP_FACT_LOCK = '1';
  const facts = ins.buildFactsToVerify(INSIGHT);
  const n1 = facts.find(f => f.kind === 'n');
  const r = ins.applyFactChecks(INSIGHT, facts, [{ id: `[${n1.id}]`, ok: false, heard: '1,000 บาท' }]);
  assert.equal(r.conflicts.length, 1, 'วงเล็บต้องไม่ทำให้ผลตรวจหายเงียบ');
  assert.match(r.insight.factConflicts[0].verified, /1,000/);
});

test('🐛 บั๊กจากรันจริง: ok=false แต่ตัวเลขในคำอธิบายตรงเดิม = ไม่ใช่ข้อขัดแย้ง (ห้ามธงหลอก)', () => {
  process.env.CLIP_FACT_LOCK = '1';
  const facts = ins.buildFactsToVerify(INSIGHT);
  const n1 = facts.find(f => f.kind === 'n');
  // ข้อความจริงที่โมเดลตอบกลับมาในเคสลุงสามล้อ
  const heard = 'คุณเล็กจากพัทยาเป็นผู้ซื้อสามล้อคันใหม่สภาพใช้งานได้ในราคา 5,000 บาทให้คุณลุง';
  const r = ins.applyFactChecks(INSIGHT, facts, [{ id: `[${n1.id}]`, ok: false, heard }]);
  assert.equal(r.conflicts.length, 0, 'เลขตรงกัน = ห้ามนับเป็นขัดแย้ง');
  assert.ok(!r.insight.factConflicts, 'ห้ามติดธงหลอก');
  assert.match(r.insight.rawData, /5,000/, 'ห้ามแก้ตัวเลขที่ยังถูกอยู่');
});

test('ได้ยินหลายตัวเลขและไม่มีตัวไหนตรงเลย = ห้ามเดาแก้ ต้องติดธงให้คนตัดสิน', () => {
  process.env.CLIP_FACT_LOCK = '1';
  const facts = ins.buildFactsToVerify(INSIGHT);
  const n1 = facts.find(f => f.kind === 'n');
  const r = ins.applyFactChecks(INSIGHT, facts, [{ id: n1.id, ok: false, heard: 'จ่ายมัดจำ 500 บาท ที่เหลือ 2,500 บาทผ่อนทีหลัง' }]);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].fixed, false, 'หลายเลข = ห้ามเลือกแทนเอง');
  assert.match(r.insight.rawData, /5,000/, 'เนื้อเดิมต้องไม่ถูกแตะ');
});

test('ตัวจัดรูปผล v2: เก็บ factChecks เมื่อมี · ไม่มี = ไม่ใส่คีย์ (เรคคอร์ดเดิมเป๊ะ)', () => {
  const withChecks = raw.normalizeRawStory({ rawStory: 'x', factChecks: [{ id: 'n1', ok: false, heard: '1,000 บาท' }, { id: '', ok: true }] });
  assert.equal(withChecks.factChecks.length, 1, 'ข้อที่ไม่มี id ต้องถูกทิ้ง');
  assert.equal(withChecks.factChecks[0].ok, false);
  assert.ok(!('factChecks' in raw.normalizeRawStory({ rawStory: 'x' })), 'ไม่มีผลตรวจ = ห้ามมีคีย์');
});
