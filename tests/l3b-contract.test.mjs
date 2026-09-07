// 🔏 ข้อสอบสัญญา L3B (14 ส.ค. 69 — Sol backlog ข้อ 3 ขั้น 2): AI เกลาต้องทำงานจริง · ล้มต้อง fail-closed ท่อนยาว
// โหลดซอร์สจริง + แทน import AI ด้วย mock (globalThis.__L3B_MOCK__ / __L3B_THROW__)
// รัน: node tests/l3b-contract.test.mjs
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

let src = readFileSync(new URL('../src/lib/correction/safeCorrectionService.js', import.meta.url), 'utf8');
const stubs = [
  ["import { callAI } from '@/lib/ai/openai';",
    'const callAI = async () => { if (globalThis.__L3B_THROW__) throw new Error("mock-ai-down"); return globalThis.__L3B_MOCK__; };'],
  ["import { MODEL_FAST } from '@/lib/ai/modelConfig';", "const MODEL_FAST = 'mock';"],
  // flagFixer ลาก @/lib ต่อเป็นลูกโซ่ — stub ขั้นต่ำพอให้ guardCoreNews ผ่าน (ไม่ใช่จุดที่เทสนี้วัด)
  ["import { keyNumbersOf, hasKeyNumber } from './flagFixerService';",
    'const keyNumbersOf = () => []; const hasKeyNumber = () => true;'],
];
for (const [from, to] of stubs) {
  if (!src.includes(from)) { console.log('❌ stub ไม่เจอ:', from.slice(0, 40)); process.exit(1); }
  src = src.replace(from, to);
}
const tmpUrl = new URL('../src/lib/correction/_l3b-under-test.tmp.mjs', import.meta.url);
writeFileSync(tmpUrl, src);
const { safeCorrect } = await import(tmpUrl.href);
rmSync(tmpUrl);

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('✅ ' + name); } else { fail++; console.log('❌ ' + name); } };

const CONTENT = 'ชายคนหนึ่งพบเลือดบนพื้นถนนหน้าบ้านของเขา เขารีบแจ้งเจ้าหน้าที่ให้มาตรวจสอบพื้นที่โดยรอบทันที และคอยดูแลคนในบ้านให้อยู่ในความสงบเรียบร้อยตลอดทั้งคืน';
const ISSUE = { type: 'forbidden_word', text: 'เลือด', suggestion: 'ร่องรอยเหตุการณ์', severity: 'medium', location: 0 };
const LONG_ISSUE = { type: 'forbidden_word', text: 'เลือดสาดกระจายทั่วบริเวณ', suggestion: 'เหตุรุนแรง', severity: 'high', location: 0 };
const CONTENT_LONG = 'ผู้เห็นเหตุการณ์เล่าว่าภาพตรงหน้ามีเลือดสาดกระจายทั่วบริเวณ ก่อนหน่วยกู้ภัยจะมาถึงและนำตัวผู้บาดเจ็บส่งโรงพยาบาลได้ทันเวลาในที่สุด';

// ── ① สำเร็จ: callAI คืน JSON object {content} → ต้องรับและใช้จริง (สัญญาใหม่) ──
{
  globalThis.__L3B_THROW__ = false;
  const rewritten = CONTENT.replace('เลือด', 'ร่องรอยบางอย่าง');
  globalThis.__L3B_MOCK__ = { content: rewritten };
  const r = await safeCorrect(CONTENT, [ISSUE]);
  t('1 AI คืน {content} → ถูกใช้จริง (ai_context_rewrite)', r.correctedContent.includes('ร่องรอยบางอย่าง')
    && r.corrections.some((c) => c.type === 'ai_context_rewrite'));
}

// ── ② AI ตอบรูปแบบเพี้ยน (object ไม่มี content) → คำสั้น ≤12 แทนตรงได้ (พฤติกรรมเดิมคงอยู่) ──
{
  globalThis.__L3B_MOCK__ = { wrong: 'shape' };
  const r = await safeCorrect(CONTENT, [ISSUE]);
  t('2 AI เพี้ยน + คำสั้น → direct replace ยังทำงาน', r.correctedContent.includes('ร่องรอยเหตุการณ์'));
}

// ── ③ AI เพี้ยน + ท่อนยาว >12 → fail-closed: คงเนื้อเดิม + ธง needs_review (Sol บังคับ) ──
{
  globalThis.__L3B_MOCK__ = { wrong: 'shape' };
  const r = await safeCorrect(CONTENT_LONG, [LONG_ISSUE]);
  t('3 ท่อนยาวไม่ถูกแทนดิบ (เนื้อคงเดิม)', r.correctedContent.includes('เลือดสาดกระจายทั่วบริเวณ'));
  t('4 มีธง needs_review ให้คนตรวจ', r.corrections.some((c) => c.type === 'needs_review'));
}

// ── ③.5 AI คืน {content: {…}} (nested object — ไม่ใช่สตริง) → ต้อง fail-closed เหมือนเพี้ยน (ผู้ตรวจ F#5) ──
{
  globalThis.__L3B_THROW__ = false;
  globalThis.__L3B_MOCK__ = { content: { nested: 'object' } };
  const r = await safeCorrect(CONTENT_LONG, [LONG_ISSUE]);
  t('5.5 nested object → ไม่พัง + ท่อนยาวคงเดิม + ธง', r.correctedContent.includes('เลือดสาดกระจายทั่วบริเวณ')
    && r.corrections.some((c) => c.type === 'needs_review'));
}

// ── ③.6 เพดานลิสต์ (ผู้ตรวจ F#3): ทุกคำใน needsAIRewrite ต้อง ≤ L3B_DIRECT_REPLACE_MAX — กันคนเพิ่มคำยาวแล้วเงียบ ──
{
  const srcNow = readFileSync(new URL('../src/lib/correction/safeCorrectionService.js', import.meta.url), 'utf8');
  const cap = Number((srcNow.match(/L3B_DIRECT_REPLACE_MAX = (\d+)/) || [])[1]);
  const arr = (srcNow.match(/const needsAIRewrite = \[([\s\S]*?)\];/) || [])[1] || '';
  const words = [...arr.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  t(`5.6 ลิสต์ AI-rewrite ${words.length} คำ ทุกคำ ≤ เพดาน ${cap}`, cap >= 1 && words.length > 10 && words.every((w) => w.length <= cap));
}

// ── ④ AI โยน error → เส้นเดียวกัน: สั้นแทนได้ ยาว fail-closed ──
{
  globalThis.__L3B_THROW__ = true;
  const r = await safeCorrect(CONTENT_LONG, [LONG_ISSUE]);
  t('5 AI ล่ม + ท่อนยาว → คงเนื้อเดิม + ธง', r.correctedContent.includes('เลือดสาดกระจายทั่วบริเวณ')
    && r.corrections.some((c) => c.type === 'needs_review'));
  globalThis.__L3B_THROW__ = false;
}

console.log(`\n${pass}/${pass + fail} ผ่าน${fail ? ' — ❌ ตก ' + fail + ' เคส ห้ามไปต่อ' : ' — ✅ ด่านข้อสอบผ่าน'}`);
process.exit(fail ? 1 : 0);
