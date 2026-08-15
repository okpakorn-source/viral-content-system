// 🔏 ข้อสอบขั้น 4 sonnet-5 (15 ส.ค. 69 — เจ้าของอนุมัติ): ตัวจ่ายงาน + promptBlocks + ความเท่าเดิมของเส้น luna
// รัน: node tests/card-picker-sonnet5.test.mjs
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('✅ ' + name); } else { fail++; console.log('❌ ' + name); } };

// ── ① claudeClient: effort ต่อการเรียกชนะ env กลาง + promptBlocks → content array + cache_control ──
{
  let src = readFileSync(new URL('../src/lib/ai/claudeClient.js', import.meta.url), 'utf8');
  const stubs = [
    ["import Anthropic from '@anthropic-ai/sdk';", 'const Anthropic = class { constructor() {} };'],
    ["import { logApiUsage } from './usageLogger';", 'const logApiUsage = () => {};'],
    ["import { sanitizeOutput } from './safetyFilter';", 'const sanitizeOutput = (x) => x;'],
  ];
  for (const [from, to] of stubs) {
    if (!src.includes(from)) { console.log('❌ stub ไม่เจอ:', from.slice(0, 40)); process.exit(1); }
    src = src.replace(from, to);
  }
  // ดัก client: จับ requestBody แล้วคืนคำตอบ JSON สำเร็จ
  src = src.replace(/function getClaudeClient\(\) \{[\s\S]*?\n\}/,
    `function getClaudeClient() {
  return { messages: { create: async (body) => { globalThis.__CAP__ = body; return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'text', text: '{"ok":1}' }] }; } } };
}`);
  const tmpUrl = new URL('../src/lib/ai/_cc-under-test.tmp.mjs', import.meta.url);
  writeFileSync(tmpUrl, src);
  const { callClaude } = await import(tmpUrl.href);
  rmSync(tmpUrl);

  // เคส 1: ไม่ส่ง effort/promptBlocks = พฤติกรรมเดิม (content เป็นสตริง + effort จาก env กลาง)
  await callClaude({ prompt: 'ทดสอบ', model: 'claude-sonnet-5', maxTokens: 500 });
  let b = globalThis.__CAP__;
  t('1 ไม่ส่ง promptBlocks → content เป็นสตริงเดิม', typeof b.messages[0].content === 'string' && b.messages[0].content.includes('ทดสอบ'));
  t('2 ไม่ส่ง effort → ใช้ค่ากลาง medium', b.output_config?.effort === 'medium');

  // เคส 2: effort ต่อการเรียกชนะ env กลาง
  await callClaude({ prompt: 'x', model: 'claude-sonnet-5', maxTokens: 500, effort: 'low' });
  t('3 effort ต่อการเรียกชนะ env กลาง', globalThis.__CAP__.output_config?.effort === 'low');

  // เคส 3: promptBlocks → content array + cache_control ก้อนแรก + คำสั่ง JSON ต่อท้ายก้อนสุดท้ายเท่านั้น
  await callClaude({ promptBlocks: [{ text: 'ก้อนคงที่', cache: true }, { text: 'ก้อนแปรผัน' }], prompt: 'สำรอง', model: 'claude-sonnet-5', maxTokens: 500 });
  b = globalThis.__CAP__;
  const c = b.messages[0].content;
  t('4 promptBlocks → content array 2 ก้อน', Array.isArray(c) && c.length === 2);
  t('5 ก้อนแรกติด cache_control', c?.[0]?.cache_control?.type === 'ephemeral');
  t('6 ก้อนสองไม่ติด cache + มีคำสั่ง JSON ต่อท้าย', !c?.[1]?.cache_control && c?.[1]?.text?.includes('ตอบเป็น JSON เท่านั้น'));
  t('7 ก้อนแรกไม่มีคำสั่ง JSON แทรก (กันแคชแตก)', !c?.[0]?.text?.includes('ตอบเป็น JSON เท่านั้น'));
}

// ── ② ความเท่าเดิมของเส้น luna + ตัวจ่ายงานครบแฝด 2 ไฟล์ ──
for (const f of ['summarizeServiceText.js', 'summarizeService.js']) {
  const s = readFileSync(new URL('../src/lib/services/' + f, import.meta.url), 'utf8');
  t(`8 ${f}: จุด A มีทางแยก claude- + เส้น luna เดิม (temperature 0.1 + maxTokens 8000)`,
    s.includes("/^claude-/.test(_pickerModelA)") && /temperature: 0\.1,\s*\n\s*maxTokens: 8000/.test(s));
  t(`9 ${f}: จุด B มีทางแยก claude- + เส้น luna เดิม (maxTokens 2000)`,
    s.includes('_pickerModelB') && s.includes('maxTokens: 2000'));
  t(`10 ${f}: race เปล่าถูกถอดหมด (ไม่มี CardPicker timeout 35s แบบไม่ตัดสาย)`,
    !s.includes("rej(new Error('CardPicker timeout 35s'))"));
  t(`11 ${f}: จุด B ส่ง signal เข้าทั้งสองเส้น (ตัดสาย HTTP จริง)`,
    (s.match(/signal: _pickCtl\.signal/g) || []).length === 2);
  t(`12 ${f}: effort A=low B=medium ตามแผน + สวิตช์ env ครบ`,
    s.includes("CARD_PICKER_EFFORT_A || 'low'") && s.includes("CARD_PICKER_EFFORT_B || 'medium'") && s.includes('CARD_PICKER_B_TIMEOUT_MS'));
}

// ── ③ รอบแก้ตามผู้ตรวจ (Sol 4 ข้อ + Fable 2 ข้อแฝง) ──
{
  let src = readFileSync(new URL('../src/lib/ai/claudeClient.js', import.meta.url), 'utf8');
  const stubs2 = [
    ["import Anthropic from '@anthropic-ai/sdk';", 'const Anthropic = class {};'],
    ["import { logApiUsage } from './usageLogger';", 'const logApiUsage = (x) => { globalThis.__USAGE__ = x; };'],
    ["import { sanitizeOutput } from './safetyFilter';", 'const sanitizeOutput = (x) => x;'],
  ];
  for (const [from, to] of stubs2) src = src.replace(from, to);
  src = src.replace(/function getClaudeClient\(\) \{[\s\S]*?\n\}/,
    `function getClaudeClient() {
  return { messages: { create: async (body) => { globalThis.__CAP__ = body; return { stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 5, cache_creation_input_tokens: 900, cache_read_input_tokens: 50 }, content: [{ type: 'text', text: '{"ok":1}' }] }; } } };
}`);
  const tmpUrl2 = new URL('../src/lib/ai/_cc2-under-test.tmp.mjs', import.meta.url);
  writeFileSync(tmpUrl2, src);
  const { callClaude } = await import(tmpUrl2.href);
  rmSync(tmpUrl2);

  // Fable แฝง 1 + Sol #3: blocks ล้วนไม่มี prompt ต้องไม่พัง
  let threw = false;
  try { await callClaude({ promptBlocks: [{ text: 'ก้อนเดียว', cache: true }], model: 'claude-sonnet-5', maxTokens: 500 }); } catch { threw = true; }
  t('13 promptBlocks ล้วน (ไม่มี prompt) → ไม่พัง', !threw);
  // Sol รอบ 2 ข้อ 4: mixed blocks — ก้อนเนื้อว่างต้องถูกกรองทิ้ง ไม่หลุดเป็น text block ว่าง
  await callClaude({ promptBlocks: [{}, { text: 'ก้อนดี' }], model: 'claude-sonnet-5', maxTokens: 500 });
  { const cc = globalThis.__CAP__.messages[0].content; t('14.5 mixed blocks → เหลือก้อนดีก้อนเดียว + JSON ต่อท้าย', Array.isArray(cc) && cc.length === 1 && cc[0].text.includes('ก้อนดี') && cc[0].text.includes('ตอบเป็น JSON เท่านั้น')); }
  // Sol #3: blocks ว่าง → ถอยไปใช้ prompt
  await callClaude({ promptBlocks: [], prompt: 'สำรองจริง', model: 'claude-sonnet-5', maxTokens: 500 });
  t('14 blocks ว่าง → ใช้ prompt สำรอง', String(globalThis.__CAP__.messages[0].content).includes('สำรองจริง'));
  // Sol #2: usage รวมโทเคนแคช
  t('15 logApiUsage แปลงแคชเป็นเทียบเท่าอัตราปกติ (100+900*1.25+50*0.1=1230)', globalThis.__USAGE__?.inputTokens === 1230);
}
// Sol #1: รอยต่อก้อน — ก้อนสองต้องขึ้นต้นด้วยบรรทัดว่าง (delimiter เทียบเท่าเดิม)
for (const f of ['summarizeServiceText.js', 'summarizeService.js']) {
  const s = readFileSync(new URL('../src/lib/services/' + f, import.meta.url), 'utf8');
  t(`16 ${f}: ก้อนสองคั่นด้วยบรรทัดว่าง`, s.includes("{ text: '\\n\\n' + _catVariable }"));
  t(`17 ${f}: log จุด B ใช้ชื่อโมเดลจริง (ไม่ hardcode luna)`, s.includes('CardPicker] ${_pickerModelB} เลือก'));
}

console.log(`\n${pass}/${pass + fail} ผ่าน${fail ? ' — ❌ ตก ' + fail + ' เคส ห้ามไปต่อ' : ' — ✅ ด่านข้อสอบผ่าน'}`);
process.exit(fail ? 1 : 0);
