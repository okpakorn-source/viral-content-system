// 🛡️ ข้อสอบ Fact-bearing Guard ด่าน L4.6 (2 ก.ย. 69 — จากเทสสนามจริงเคส #05234 ศรราม/ป๋าเดียร์)
//   เคสจริง: ตัวสำรอง (luna) ชี้ประโยค "พ่อยังเป็นห่วงเรื่องการขับรถอยู่เสมอ ทุกครั้งที่โทรมา" ว่าไม่สมบูรณ์
//   → ด่านลบทั้งประโยค → ข้อเท็จจริง "ห่วงเรื่องขับรถ" หายจาก V2 เงียบๆ · Claude ล้มโดยไม่มีร่องรอยในล็อก
// โหลดซอร์สจริง + แทน import AI ด้วย mock (แบบเดียวกับ semantic-seam-guard)
// รัน: node tests/semantic-fact-guard.test.mjs
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

let src = readFileSync(new URL('../src/lib/correction/semanticSanityCheck.js', import.meta.url), 'utf8');
const stubs = [
  ["import { callAI } from '@/lib/ai/openai';", 'const callAI = async () => { globalThis.__FG_FALLBACK_CALLS__ = (globalThis.__FG_FALLBACK_CALLS__ || 0) + 1; return globalThis.__FG_MOCK__; };'],
  ["import { MODEL_FAST } from '@/lib/ai/modelConfig';", "const MODEL_FAST = 'mock-luna';"],
  [/import \{ callClaude, isClaudeAvailable \} from '@\/lib\/ai\/claudeClient';[^\n]*/,
    'const callClaude = async () => { if (globalThis.__FG_THROW__) throw new Error("mock-claude-529-overloaded"); return globalThis.__FG_MOCK__; }; const isClaudeAvailable = () => true;'],
];
for (const [from, to] of stubs) {
  const hit = typeof from === 'string' ? src.includes(from) : from.test(src);
  if (!hit) { console.log('❌ stub ไม่เจอ import:', String(from).slice(0, 50)); process.exit(1); }
  src = src.replace(from, to);
}
const tmpUrl = new URL('../src/lib/correction/_factguard-under-test.tmp.mjs', import.meta.url);
writeFileSync(tmpUrl, src);
const { semanticSanityCheck, sharesSourceFact, longestCommonRun } = await import(tmpUrl.href);
rmSync(tmpUrl);

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('✅ ' + name); } else { fail++; console.log('❌ ' + name); } };
const mock = (issues, { throwClaude = false } = {}) => {
  globalThis.__FG_THROW__ = throwClaude;
  globalThis.__FG_FALLBACK_CALLS__ = 0;
  globalThis.__FG_MOCK__ = { hasIssues: issues.length > 0, issues };
};

// เนื้อดิบจริงจากเคส (ย่อ) + ร่างที่ AI เขียน (โครงเดียวกับ V2 ของเคสจริง)
const SOURCE = 'แม้จะทำงานในวงการบันเทิงและมีเวลาอยู่กับลูกไม่มาก แต่ทั้งคู่ยังโทรหากันเป็นประจำ โดยป๋าเดียร์มักเป็นห่วงเรื่องการขับรถ และโทรถามตอนกลางคืนว่าศรรามถ่ายละครเสร็จหรือยัง ศรรามเคยรู้สึกว่าตัวเองได้พบแม่บ่อยกว่าพ่อ';
const OPEN = 'ป๋าเดียร์ทำงานในวงการบันเทิง มีเวลาอยู่กับลูกไม่มาก แต่สายโทรศัพท์กลางดึกยังดังขึ้นเสมอ ปลายสายเป็นเสียงพ่อถามคำเดิมว่าถ่ายละครเสร็จหรือยัง';
const FACT_SENT = 'พ่อยังเป็นห่วงเรื่องการขับรถอยู่เสมอ ทุกครั้งที่โทรมา';
const NONSENSE = 'ความอบอุ่นขึ้นไปอีกระเสียชีวิตอย่างมีความสุขกับความตาย';
const TAIL = 'ศรรามเคยรู้สึกว่าตัวเองได้พบแม่บ่อยกว่าพ่อ แต่สิ่งที่ติดอยู่ในใจไม่ใช่ของที่พ่อซื้อให้';
const DOC = `${OPEN}\n\n${FACT_SENT} ${NONSENSE}\n\n${TAIL}`;

// ── ① เคสจริง replay: AI ชี้ประโยคที่แบกข้อเท็จจริง → ห้ามลบ · คืนเนื้อไบต์เดิม · ธง FACT_BEARING_GUARD ──
{
  mock([{ brokenText: FACT_SENT, reason: 'ประโยคไม่สมบูรณ์', severity: 'medium' }]);
  const r = await semanticSanityCheck(DOC, { sourceBody: SOURCE });
  t('1 ประโยค "ห่วงเรื่องการขับรถ" ตรงต้นฉบับ → ไม่ถูกลบ (เนื้อไบต์เดิม)', r.sanitizedContent === DOC && r.fixed === false);
  t('2 ธง FACT_BEARING_GUARD + รายการที่กันไว้ ให้กล่องดำ', r.error === 'FACT_BEARING_GUARD' && Array.isArray(r.guardedFactBearing) && r.guardedFactBearing[0] === FACT_SENT);
}

// ── ② ประโยคไร้ความหมายจริง (ไม่มีในต้นฉบับ) → ยังลบได้เหมือนเดิม (regression) ──
{
  mock([{ brokenText: NONSENSE, reason: 'ไร้ความหมาย', severity: 'high' }]);
  const r = await semanticSanityCheck(DOC, { sourceBody: SOURCE });
  t('3 ประโยคไร้ความหมาย → ถูกลบตามเดิม', r.fixed === true && !r.sanitizedContent.includes(NONSENSE) && r.sanitizedContent.includes(FACT_SENT));
  t('4 ไม่มีธง fact guard เมื่อไม่ได้กันอะไร', r.error == null && r.guardedFactBearing == null);
}

// ── ③ ผสม: ประโยคข้อเท็จจริง + ประโยคไร้ความหมาย ในรอบเดียว → ลบเฉพาะไร้ความหมาย ──
{
  mock([
    { brokenText: FACT_SENT, reason: 'ไม่สมบูรณ์', severity: 'medium' },
    { brokenText: NONSENSE, reason: 'ไร้ความหมาย', severity: 'high' },
  ]);
  const r = await semanticSanityCheck(DOC, { sourceBody: SOURCE });
  t('5 ผสม → ลบเฉพาะไร้ความหมาย คงประโยคข้อเท็จจริง', r.fixed === true && r.sanitizedContent.includes(FACT_SENT) && !r.sanitizedContent.includes(NONSENSE));
  t('6 กล่องดำเห็นทั้งที่ลบ (1) และที่กันไว้ (1)', r.issuesFound.length === 1 && r.guardedFactBearing?.length === 1);
}

// ── ④ ไม่ส่ง sourceBody → พฤติกรรมเดิม 100% (ลบตามที่ AI ชี้) — สัญญาความเข้ากันได้ ──
{
  mock([{ brokenText: FACT_SENT, reason: 'ไม่สมบูรณ์', severity: 'medium' }]);
  const r = await semanticSanityCheck(DOC);
  t('7 ไม่มี sourceBody → ลบได้เหมือนเดิม (ไม่เปลี่ยนพฤติกรรมผู้เรียกเก่า)', r.fixed === true && !r.sanitizedContent.includes(FACT_SENT));
}

// ── ⑤ Claude ล้ม → ต้องมีบรรทัดเตือนบอกสาเหตุ + ธง usedFallback (เดิมเงียบสนิท) ──
{
  const warns = [];
  const realWarn = console.warn;
  console.warn = (...a) => { warns.push(a.join(' ')); };
  try {
    mock([], { throwClaude: true });
    const r = await semanticSanityCheck(DOC, { sourceBody: SOURCE });
    t('8 Claude ล้ม → ถอย luna จริง (เรียก callAI 1 ครั้ง) + ธง usedFallback=true', globalThis.__FG_FALLBACK_CALLS__ === 1 && r.usedFallback === true);
    t('9 มีบรรทัดเตือนบอกสาเหตุที่ Claude ล้ม (ไม่เงียบ)', warns.some((w) => w.includes('Claude ล้ม') && w.includes('mock-claude-529-overloaded') && w.includes('mock-luna')));
    mock([]);
    const r2 = await semanticSanityCheck(DOC, { sourceBody: SOURCE });
    t('10 Claude ปกติ → usedFallback=false', r2.usedFallback === false && globalThis.__FG_FALLBACK_CALLS__ === 0);
  } finally { console.warn = realWarn; }
}

// ── ⑥ ตัววัดการทับซ้อน: ต้องแยก "ข้อความจากต้นฉบับ" ออกจาก "คำทั่วไปที่บังเอิญซ้ำ" ──
{
  t('11 longestCommonRun นับอักษรต่อเนื่องถูก', longestCommonRun('xxห่วงเรื่องการขับรถyy', 'ป๋ามักเป็นห่วงเรื่องการขับรถ') === 'ห่วงเรื่องการขับรถ'.length);
  t('12 ประโยคที่ซ้ำแค่คำสั้นๆ ทั่วไป (<12 ตัว) → ไม่นับว่าแบกข้อเท็จจริง', sharesSourceFact('เขาเดินไปที่โรงเรียนแล้วก็กลับบ้าน', SOURCE) === false);
  t('13 เว้นวรรค/เครื่องหมายคำพูดต่างกัน → ยังจับได้', sharesSourceFact('"ห่วง เรื่อง การขับรถ" คือสิ่งที่พ่อทำ', SOURCE) === true);
}

console.log(`\n${pass}/${pass + fail} ผ่าน${fail ? ' — ❌ ตก ' + fail + ' เคส ห้ามไปต่อ' : ' — ✅ ด่านข้อสอบผ่าน'}`);
process.exit(fail ? 1 : 0);
