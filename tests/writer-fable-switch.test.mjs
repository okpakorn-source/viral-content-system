// 🔏 ข้อสอบสลับนักเขียน fable-5 (15 ส.ค. 69 — ทำในคอมก่อน ห้าม push จนเจ้าของเทสผ่าน)
// โหลด aiRouter จริง + ดัก callClaude/callAI — พิสูจน์ ladder ทุกเส้น + สายอื่นไม่กระทบ
// รัน: node tests/writer-fable-switch.test.mjs
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('✅ ' + name); } else { fail++; console.log('❌ ' + name); } };

let src = readFileSync(new URL('../src/lib/ai/aiRouter.js', import.meta.url), 'utf8');
const stubs = [
  ["import { callClaude, isClaudeAvailable } from './claudeClient.js';",
    `const isClaudeAvailable = () => true;
const callClaude = async (args) => {
  globalThis.__CALLS__.push({ fn: 'claude', model: args.model || '(default)' });
  const plan = globalThis.__PLAN__.shift() || 'ok';
  if (plan === 'throw') throw new Error('mock-claude-down');
  if (plan === 'refusal') throw new Error('Claude ปฏิเสธการเขียน (refusal)');
  return { content: 'จากโมเดล ' + (args.model || '(default)') };
};`],
];
for (const [from, to] of stubs) {
  if (!src.includes(from)) { console.log('❌ stub ไม่เจอ:', from.slice(0, 50)); process.exit(1); }
  src = src.replace(from, to);
}
src = src.replace(/import \{ callGemini[^\n]*\n/, 'const callGemini = async () => ({ content: "gemini" }); const isGeminiAvailable = () => false;\n');
src = src.replace(/import \{ callAI[^\n]*\n/, 'const callAI = async (a) => { globalThis.__CALLS__.push({ fn: "gpt", model: a.model }); if (globalThis.__GPT_PLAN__ && globalThis.__GPT_PLAN__.shift() === "throw") throw new Error("mock-gpt-down"); return { content: "gpt" }; };\n');
src = src.replace(/import \{ MODEL_PRIMARY[^\n]*\n/, "const MODEL_PRIMARY = 'gpt-5.6-sol';\n");
const tmpUrl = new URL('../src/lib/ai/_router-under-test.tmp.mjs', import.meta.url);
writeFileSync(tmpUrl, src);
const router = await import(tmpUrl.href);
rmSync(tmpUrl);
const callSmartAI = router.callSmartAI || router.default?.callSmartAI;
if (!callSmartAI) { console.log('❌ ไม่พบ callSmartAI ใน exports:', Object.keys(router).join(',')); process.exit(1); }

const reset = (plan = [], gptPlan = []) => { globalThis.__CALLS__ = []; globalThis.__PLAN__ = [...plan]; globalThis.__GPT_PLAN__ = [...gptPlan]; delete process.env.CLAUDE_WRITE_MODEL; delete process.env.CLAUDE_WRITE_FALLBACK_MODEL; };

// ① สายเขียนปกติ → fable-5 ตัวเดียว
reset();
await callSmartAI('write', { prompt: 'x' });
t('1 write ปกติ → เรียก claude-fable-5 ครั้งเดียว',
  globalThis.__CALLS__.length === 1 && globalThis.__CALLS__[0].model === 'claude-fable-5');

// ② fable ล้ม → ถอย opus-4-8 (ไม่หลุดไป gpt)
reset(['throw']);
const r2 = await callSmartAI('write', { prompt: 'x' });
t('2 fable ล้ม → ถอย opus-4-8 สำเร็จ',
  globalThis.__CALLS__.length === 2 && globalThis.__CALLS__[1].model === 'claude-opus-4-8' && String(r2.result?.content||'').includes('claude-opus-4-8'));

// ③ refusal ก็ถอยเหมือนกัน
reset(['refusal']);
await callSmartAI('write', { prompt: 'x' });
t('3 โดนปัดตอบ (refusal) → ถอย opus-4-8', globalThis.__CALLS__[1]?.model === 'claude-opus-4-8');

// ④ ล้มทั้งคู่ → หลุดไปโซ่ gpt เดิม (fallback เดิมไม่ถูกลบ)
reset(['throw', 'throw']);
const r4 = await callSmartAI('write', { prompt: 'x' });
t('4 ล้มทั้งคู่ → โซ่ gpt เดิมรับ', globalThis.__CALLS__.some((c) => c.fn === 'gpt') && r4.result?.content === 'gpt');

// ⑤ fallback=off → ไม่ถอย หลุดไป gpt เลย
reset(['throw']);
process.env.CLAUDE_WRITE_FALLBACK_MODEL = 'off';
const r5 = await callSmartAI('write', { prompt: 'x' });
t('5 fallback=off → ไม่เรียกตัวสำรอง', globalThis.__CALLS__.filter((c) => c.fn === 'claude').length === 1 && r5.result?.content === 'gpt');

// ⑥ โหมดถอยกลับระบบเดิม: CLAUDE_WRITE_MODEL=claude-opus-4-8 → เรียกครั้งเดียว ไม่มี retry ซ้ำตัวเอง
reset(['throw']);
process.env.CLAUDE_WRITE_MODEL = 'claude-opus-4-8';
const r6 = await callSmartAI('write', { prompt: 'x' });
t('6 ถอยกลับระบบเดิม (primary=fallback) → เรียก opus ครั้งเดียวแล้วหลุด gpt',
  globalThis.__CALLS__.filter((c) => c.fn === 'claude').length === 1 && globalThis.__CALLS__[0].model === 'claude-opus-4-8' && r6.result?.content === 'gpt');

// ⑦ สาย breakdown ไม่กระทบ — บังคับ gpt หลักล้ม → ต้องเรียก token 'claude' เดิมแบบไม่ส่ง model
reset([], ['throw']);
await callSmartAI('breakdown', { prompt: 'x' });
const c7 = globalThis.__CALLS__.find((c) => c.fn === 'claude');
t('7 breakdown ตกมา claude เดิม แบบไม่ส่ง model (DEFAULT_WRITE_MODEL)', c7 && c7.model === '(default)');

// ⑦.5 งบเวลาหมด (signal.aborted) → ห้ามถอยซ้ำ
reset(['throw']);
{ const ac = new AbortController(); ac.abort(); let threw = false;
  try { await callSmartAI('write', { prompt: 'x', signal: ac.signal }); } catch { threw = true; }
  t('7.5 aborted → ไม่เรียกตัวสำรอง (เคารพงบเวลา)', globalThis.__CALLS__.filter((c) => c.fn === 'claude').length === 1); }
// ⑦.6 ค่า env สกปรก (เครื่องหมายคำพูด/ช่องว่าง/ตัวพิมพ์) — กับดัก vercel env
reset(['throw']);
process.env.CLAUDE_WRITE_FALLBACK_MODEL = ' OFF ';
await callSmartAI('write', { prompt: 'x' });
t('7.6 fallback=" OFF " (สกปรก) → ยังนับเป็น off ไม่ยิงตัวสำรอง', globalThis.__CALLS__.filter((c) => c.fn === 'claude').length === 1);
reset(['throw']);
process.env.CLAUDE_WRITE_MODEL = '"claude-opus-4-8"';
await callSmartAI('write', { prompt: 'x' });
t('7.7 primary ติดเครื่องหมายคำพูด → strip แล้ว primary=fallback เรียกครั้งเดียว', globalThis.__CALLS__.filter((c) => c.fn === 'claude').length === 1 && globalThis.__CALLS__[0].model === 'claude-opus-4-8');

// ⑧ ราคา fable อยู่ในตาราง /cost
{
  const mc = readFileSync(new URL('../src/lib/ai/modelConfig.js', import.meta.url), 'utf8');
  t("8 MODEL_COSTS มีแถว claude-fable-5 (10/50)", /'claude-fable-5':\s*\{\s*input:\s*10\.0,\s*output:\s*50\.0\s*\}/.test(mc));
}

console.log(`\n${pass}/${pass + fail} ผ่าน${fail ? ' — ❌ ตก ' + fail + ' เคส ห้ามไปต่อ' : ' — ✅ ด่านข้อสอบผ่าน'}`);
process.exit(fail ? 1 : 0);
