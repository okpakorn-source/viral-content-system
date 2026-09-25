// 🔏 ข้อสอบเกราะเวลาชั้น correction + system prompt งานตรวจ (PL-11 / MC-14) — src/lib/correction/correctionAiGuard.js
//   + จุดเรียก AI ใน semanticSanityCheck.js (L4.6) · safeCorrectionService.js (L3A/L3B) · fabricationGate.js (L1.8) · flagFixerService.js (L1.5) · correctionPipeline.js (ส่ง signal)
// ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S7 · เจ้าของอนุมัติ)
//
// บั๊กที่ปิด (ผู้ตรวจ 2 คนยืนยัน):
//   PL-11 — ทุกจุดที่เรียก AI ในชั้น correction ไม่ส่ง signal/timeout (เหลือแค่เส้นตายรวม 700s + ค่าเริ่มต้น SDK 600s·retry 2) และ runCorrectionPipeline
//           ไม่ถูกครอบเวลา → Claude ช้าแต่ไม่พัง = งานทั้งเวอร์ชันค้าง กินงบที่ด่าน Sol ต้องจอง 180s → ข่าวล้ม 504 ที่ raw_fact_audit_initial · L3A ยัง await ทีละประโยค
//   MC-14 — L4.6 เรียก claude-opus-5 โดยไม่ส่ง systemPrompt → ได้ system สายเขียน ~3,900 ตัวอักษร (HUMAN WRITING DNA "ถ้าสะดุด เขียนใหม่" + รายการคำห้าม)
//           กับงานตรวจที่ต้องคัดลอกข้อความพังตรงตัว · ทางถอย luna โดน system ยาวของ openai.js เหมือนกัน · flagFixer หนี้เดียวกัน
//
// สิ่งที่ล็อกไว้:
//   A. สวิตช์: CORRECTION_AI_TIMEOUT_MS ไม่ตั้ง/ว่าง/ค่าเพี้ยน = 60000 · ตัวเลข = เพดาน · 0/off/legacy/false/no = โหมดถอย (null) ·
//      CORRECTION_CHECK_SYSTEM ไม่ตั้ง/ค่าอื่น = ส่ง system สั้น · 0/off/false/no/legacy = ไม่ส่ง
//   B. L4.6: ค่าเริ่มต้นส่ง systemPrompt สั้นงานตรวจ (ไม่มีกฎสายเขียน/รายการคำห้าม) + signal ทั้ง claude และ luna · claude ช้าเกินเพดาน → luna (โซ่เดิม) ·
//      ทั้งคู่ช้า → ข้ามด่าน คืน content เดิม ไม่ล้ม ภายในเวลา ≈ 2×เพดาน · parent signal ยกเลิก → ข้ามด่าน · โหมดถอยทั้งคู่ = args เดิมทุกไบต์ + รอ AI ช้าจนจบ
//   C. L3B/L3A: ค่าเริ่มต้นส่ง signal (S7 ไม่แตะ systemPrompt · ★ S8: + systemPrompt สั้นงานเกลาจาก taskSystemPrompts — "args เดิมทุกไบต์" ต้องตั้ง SYSTEM_PROMPT_SLIM=0 ด้วย) · หมดเวลา = เส้น fail-open เดิม (L3B แทนคำสั้น+ธง needs_review · L3A คงประโยค) ·
//      เบรกเกอร์ L3A: หมดเวลาครั้งแรก = ประโยคที่เหลือของเวอร์ชันไม่เรียกซ้ำ (3 ย่อหน้า → เรียก 1 ไม่ใช่ 3) · โหมดถอย = args เดิม + รอครบทุกประโยค · L3A_AI_FIX=legacy ไม่ถูกแตะ
//   D. L1.8 (FAB_GATE=1): 3 การเรียกส่ง signal · system เดิมของด่าน (GATE_*_SYS) ไม่เปลี่ยน · ขั้น 1 ช้า → fail-open ปล่อยเนื้อเดิม debug.error TIMEOUT · โหมดถอย = args เดิม
//   E. L1.5 flagFixer: ตรวจมุมเปิด = CHECK system · แก้จุดที่ธงชี้ = FIX system + signal · claude ช้า → terra (โซ่เดิม) · ทั้งคู่ช้า → คงเวอร์ชันเดิม · โหมดถอย = args เดิม
//   F. ท่อจริง runCorrectionPipeline (ตัดฟังก์ชันจากซอร์สแบบ correction-fact-stability + ด่านจริงที่ patch AI): options.signal ส่งถึง L1.8/L3/L4.6 ตัวเดียวกัน ·
//      เส้นตายรวมจริง (createPipelineDeadline) เหลือ 30s < เพดาน 60s → L4.6 ข้ามโดยไม่เรียก AI ไม่จ่ายเงิน ไม่ล้ม (โหมดถอย: เรียก AI ทั้งที่งบไม่พอ = บั๊กเดิม) ·
//      งบพอ + claude ค้าง → ท่อคืนผลก่อนเส้นตาย content เดิม เส้นตายไม่ถูกดึงจนหมด
//   G. ซอร์ส: ทุก callAI({/callClaude({ ใน 4 ไฟล์ด่านอยู่ใต้ correctionAiCall (ยกเว้น fixSentenceWithAILegacy ที่ต้องเดิมทุกไบต์)
//
// วิธีรัน:  node --test tests/correction-ai-timeout-pl11.test.mjs
// โหมดกลายพันธุ์ (พิสูจน์ว่าข้อสอบกัดจริง — เทสต้องแดง · แก้เฉพาะสำเนาในหน่วยความจำ ไม่แตะไฟล์ใน repo):
//   S7_TEST_MUTATION=no-timeout        correctionAiCall ไม่ครอบเวลา (เรียก factory ตรง) — PL-11 กลับมา
//   S7_TEST_MUTATION=no-system         correctionAiExtras ไม่ส่ง systemPrompt — MC-14 กลับมา
//   S7_TEST_MUTATION=no-legacy-switch  CORRECTION_AI_TIMEOUT_MS=0 ไม่ได้โหมดถอย (ยังส่ง signal)
//   S7_TEST_MUTATION=l3a-no-breaker    L3A ไม่หยุดเรียกหลังหมดเวลาครั้งแรก (รอ N×เพดาน)
//   S7_TEST_MUTATION=l46-rethrow       L4.6 หมดเวลาแล้วโยนออก (ไม่ fail-open) — ท่อได้ _correctionError
//   S7_TEST_MUTATION=fab-no-timeout    ขั้น 1 ของ L1.8 ไม่ครอบเวลา
//   S7_TEST_MUTATION=no-plumbing       runCorrectionPipeline ไม่ส่ง options.signal ต่อให้ด่าน
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { importPatchedGraph } from './helpers/temp-module.mjs';
import { createPipelineDeadline, runWithPipelineDeadline } from '../src/lib/utils/pipelineDeadline.js';
import { checkFactPreservation } from '../src/lib/correction/factPreservationCheck.js';
import { editorialPolish } from '../src/lib/correction/editorialPolishService.js';
import { scrubHallucinatedPlaces, isL45Legacy } from '../src/lib/correction/placeScrub.js';
import { scrubRollbackContent, isCorrRollbackLegacy } from '../src/lib/correction/rollbackScrub.js';
import { replaceRiskWordIssue } from '../src/lib/ai/safetyFilter.js';
import { isRiskWordsLegacy } from '../src/lib/ai/riskWords.js';
import { CORRECTION_RISK_REWRITE_SYSTEM_PROMPT, CORRECTION_PHRASE_FIX_SYSTEM_PROMPT } from '../src/lib/ai/taskSystemPrompts.js'; // ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S8 · เจ้าของอนุมัติ): L3B/L3A ได้ system สั้น (สวิตช์ SYSTEM_PROMPT_SLIM — โหมดถอยครบต้องตั้ง =0 ด้วย)

const MUTATION = process.env.S7_TEST_MUTATION || '';
const KNOWN_MUTATIONS = ['no-timeout', 'no-system', 'no-legacy-switch', 'l3a-no-breaker', 'l46-rethrow', 'fab-no-timeout', 'no-plumbing'];
if (MUTATION && !KNOWN_MUTATIONS.includes(MUTATION)) throw new Error('ไม่รู้จัก mutation: ' + MUTATION);
if (MUTATION) console.log(`🧬 MUTATION ACTIVE: ${MUTATION} — ข้อสอบชุดนี้ต้องแดงจึงจะถือว่ากัดจริง`);

const srcUrl = (rel) => new URL(rel, import.meta.url);
const readSrc = (rel) => readFileSync(srcUrl(rel), 'utf8').replace(/\r\n/g, '\n');
const mustReplace = (src, from, to, label) => {
  const out = src.replace(from, to);
  if (out === src) throw new Error('replace ไม่เกิดผล: ' + label);
  return out;
};
const withEnv = async (pairs, fn) => {
  const prior = {};
  for (const [name, value] of Object.entries(pairs)) {
    prior[name] = process.env[name];
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  try { return await fn(); } finally {
    for (const [name, value] of Object.entries(prior)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
};
const quiet = async (fn) => {
  const prior = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = prior.log; console.warn = prior.warn; console.error = prior.error; }
};
const timed = async (fn) => { const t0 = Date.now(); const value = await fn(); return { value, ms: Date.now() - t0 }; };

// ── โหลดซอร์สจริง + patch เฉพาะ AI/modelConfig/flagFixer (แบบเดียวกับข้อสอบ S2–S5) · guard ในกราฟเดียวกัน (mutation ถึงทุกด่าน) ──
let guardSource = readSrc('../src/lib/correction/correctionAiGuard.js');
let l46Source = readSrc('../src/lib/correction/semanticSanityCheck.js');
let correctSource = readSrc('../src/lib/correction/safeCorrectionService.js');
let fabSource = readSrc('../src/lib/correction/fabricationGate.js');
let flagSource = readSrc('../src/lib/correction/flagFixerService.js');
let pipelineSource = readSrc('../src/lib/correction/correctionPipeline.js');

const AI_STUB = (fnName, kind) => `const ${fnName} = async (args) => globalThis.__S7_AI__('${kind}', args);`;
l46Source = mustReplace(l46Source, "import { callAI } from '@/lib/ai/openai';", AI_STUB('callAI', 'callAI'), 'l46 stub openai');
l46Source = mustReplace(l46Source, "import { MODEL_FAST } from '@/lib/ai/modelConfig';", "const MODEL_FAST = 'gpt-5.6-luna';", 'l46 stub modelConfig');
l46Source = mustReplace(l46Source, "import { callClaude, isClaudeAvailable } from '@/lib/ai/claudeClient'; // ★ 1 ส.ค. 69: ชั้นตัดสิน/ตัดประโยคจริง → opus-5 ก่อน",
  `${AI_STUB('callClaude', 'callClaude')} const isClaudeAvailable = () => globalThis.__S7_CLAUDE_KEY__ !== false;`, 'l46 stub claude');
correctSource = mustReplace(correctSource, "import { callAI } from '@/lib/ai/openai';", AI_STUB('callAI', 'callAI'), 'correct stub openai');
correctSource = mustReplace(correctSource, "import { MODEL_FAST } from '@/lib/ai/modelConfig';", "const MODEL_FAST = 'gpt-5.6-luna';", 'correct stub modelConfig');
correctSource = mustReplace(correctSource, "import { keyNumbersOf, hasKeyNumber } from './flagFixerService';",
  'const keyNumbersOf = () => []; const hasKeyNumber = () => true;', 'correct stub flagFixer');
fabSource = mustReplace(fabSource, "import { callAI } from '@/lib/ai/openai';", AI_STUB('callAI', 'callAI'), 'fab stub openai');
fabSource = mustReplace(fabSource, "import { callClaude, isClaudeAvailable } from '@/lib/ai/claudeClient';",
  `${AI_STUB('callClaude', 'callClaude')} const isClaudeAvailable = () => globalThis.__S7_CLAUDE_KEY__ !== false;`, 'fab stub claude');
fabSource = mustReplace(fabSource, "import { MODEL_FAST_CHEAP } from '@/lib/ai/modelConfig';", "const MODEL_FAST_CHEAP = 'gpt-5.6-luna';", 'fab stub modelConfig');
flagSource = mustReplace(flagSource, "import { callAI } from '@/lib/ai/openai';", AI_STUB('callAI', 'callAI'), 'flag stub openai');
flagSource = mustReplace(flagSource, "import { callClaude, isClaudeAvailable } from '@/lib/ai/claudeClient'; // ★ 1 ส.ค. 69: ชั้นเขียนแทนประโยคใช้ตัวเขียนหลัก opus-5 ก่อน",
  `${AI_STUB('callClaude', 'callClaude')} const isClaudeAvailable = () => globalThis.__S7_CLAUDE_KEY__ !== false;`, 'flag stub claude');

if (MUTATION === 'no-timeout') {
  guardSource = mustReplace(guardSource, 'return withTimeoutSignal(factory, ms, step, signal);', 'return factory(signal);', 'no-timeout');
} else if (MUTATION === 'no-system') {
  guardSource = mustReplace(guardSource, 'if (systemPrompt && isCorrectionCheckSystemEnabled()) out.systemPrompt = systemPrompt;', '/* mutated */', 'no-system');
} else if (MUTATION === 'no-legacy-switch') {
  guardSource = mustReplace(guardSource, 'if (TIMEOUT_LEGACY_VALUES.has(v)) return null;', '/* mutated */', 'no-legacy-switch');
} else if (MUTATION === 'l3a-no-breaker') {
  correctSource = mustReplace(correctSource, 'if (run.timedOut) {', 'if (false) {', 'l3a-no-breaker');
} else if (MUTATION === 'l46-rethrow') {
  l46Source = mustReplace(l46Source, 'return { sanitizedContent: content, issuesFound: [], fixed: false, error: err.message };', 'throw err;', 'l46-rethrow');
} else if (MUTATION === 'fab-no-timeout') {
  fabSource = mustReplace(fabSource, "correctionAiCall('correction:L1.8:flag', ", "((step, f) => f(undefined))('correction:L1.8:flag', ", 'fab-no-timeout');
} else if (MUTATION === 'no-plumbing') {
  pipelineSource = pipelineSource.split('{ signal: _corrSignal }').join('{}');
  if (!pipelineSource.includes("const _corrSignal = options?.signal;")) throw new Error('no-plumbing: หา _corrSignal ไม่เจอ');
}

const GUARD_LINK = { './correctionAiGuard.js': 'guard' };
const graph = await importPatchedGraph({
  guard: { source: guardSource, originalUrl: srcUrl('../src/lib/correction/correctionAiGuard.js') },
  l46: { source: l46Source, originalUrl: srcUrl('../src/lib/correction/semanticSanityCheck.js'), links: GUARD_LINK },
  correct: { source: correctSource, originalUrl: srcUrl('../src/lib/correction/safeCorrectionService.js'), links: GUARD_LINK },
  fab: { source: fabSource, originalUrl: srcUrl('../src/lib/correction/fabricationGate.js'), links: GUARD_LINK },
  flag: { source: flagSource, originalUrl: srcUrl('../src/lib/correction/flagFixerService.js'), links: GUARD_LINK },
});
const guard = graph.guard;
const { semanticSanityCheck } = graph.l46;
const { safeCorrect, guardCoreNews } = graph.correct;
const { fabricationGate } = graph.fab;
const { fixFlaggedVersions } = graph.flag;

// ── ท่อ correction จริง (ตัดฟังก์ชันจากซอร์สแบบ tests/correction-fact-stability) · L2 = stub เส้น clean · ด่าน AI = ของจริงที่ patch ──
function buildPipeline(overrides = {}) {
  const start = pipelineSource.indexOf('export async function runCorrectionPipeline');
  assert.ok(start >= 0, 'ต้องหา runCorrectionPipeline ในซอร์สจริงได้');
  const deps = {
    auditOutput: async () => ({ auditScore: 90, issues: [] }),
    safeCorrect, guardCoreNews, checkFactPreservation, editorialPolish, semanticSanityCheck, fabricationGate,
    bbStep: (arr, layer, before, after, extra = {}) => arr.push({ layer, changed: before !== after, ...extra }),
    isRiskWordsLegacy, replaceRiskWordIssue, isL45Legacy, scrubHallucinatedPlaces, isCorrRollbackLegacy, scrubRollbackContent,
    ...overrides,
  };
  const names = ['auditOutput', 'safeCorrect', 'guardCoreNews', 'checkFactPreservation', 'editorialPolish', 'semanticSanityCheck', 'fabricationGate', 'bbStep',
    'isRiskWordsLegacy', 'replaceRiskWordIssue', 'isL45Legacy', 'scrubHallucinatedPlaces', 'isCorrRollbackLegacy', 'scrubRollbackContent'];
  return new Function(...names,
    `${pipelineSource.slice(start).replace('export async function runCorrectionPipeline', 'async function runCorrectionPipeline')}\nreturn runCorrectionPipeline;`,
  )(...names.map((n) => deps[n]));
}

// ── AI ปลอม: จดทุกคำขอ · ตอบตาม behavior (ทันที/ช้า) · เคารพ signal เหมือน SDK (abort → reject) ──
const calls = [];
const kindOf = (args) => (args.model === 'claude-opus-5' ? 'claude' : args.model === 'gpt-5.6-terra' ? 'terra' : 'luna');
let behavior = () => { throw new Error('behavior ยังไม่ตั้ง'); };
globalThis.__S7_CLAUDE_KEY__ = true;
globalThis.__S7_AI__ = (fn, args) => { calls.push({ fn, kind: kindOf(args), args }); return behavior(args); };
const abortError = (sig) => (sig.reason instanceof Error ? sig.reason : Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' }));
const respond = (args, answer, delay = 0) => new Promise((resolve, reject) => {
  const sig = args.signal;
  let timer = null;
  if (sig && typeof sig.addEventListener === 'function') {
    if (sig.aborted) { reject(abortError(sig)); return; }
    sig.addEventListener('abort', () => { if (timer) clearTimeout(timer); reject(abortError(sig)); }, { once: true });
  }
  const fire = () => { try { resolve(typeof answer === 'function' ? answer(args) : answer); } catch (e) { reject(e); } };
  if (delay <= 0) fire();
  else { timer = setTimeout(fire, delay); timer.unref?.(); }
});
/** ตั้ง behavior ต่อชนิดคำขอ: { claude: [answer, delayMs] | Error, luna: …, terra: … } — ไม่ตั้งชนิดไหน = โยน error */
const setAI = (plan) => {
  behavior = (args) => {
    const p = plan[kindOf(args)];
    if (p === undefined) throw new Error(`mock: ไม่มีแผนสำหรับ ${kindOf(args)}`);
    if (p instanceof Error) throw p;
    return respond(args, p[0], p[1] || 0);
  };
};
const reset = () => { calls.length = 0; globalThis.__S7_CLAUDE_KEY__ = true; };
const keysOf = (args) => Object.keys(args);
const SLOW = 1500;   // AI ช้า (ms) — ต้องยาวกว่าเพดานทดสอบมาก
const CAP = '100';   // เพดานทดสอบ CORRECTION_AI_TIMEOUT_MS (ms)
const FAST_ENOUGH = 1000; // เพดานเวลาที่ยอมรับว่า "ไม่ได้รอ AI ช้า" (มี margin ให้เครื่องช้า)

// ── ข่าวตัวอย่าง 4 กลุ่ม (ย่อหน้าที่ 2 มีวลีพังกลางย่อหน้า — ไม่แตะประโยคเปิดที่ Seam Guard คุ้มครอง) ──
const BROKEN = 'ระเสียชีวิตไปอีก';
const NEWS = {
  crime: 'ตำรวจ สน.บางนา จับกุมชายวัย 34 ปี ผู้ต้องสงสัยชิงทรัพย์ร้านทอง 3 ร้านภายใน 2 สัปดาห์ ได้ที่บ้านพักย่านบางนา\n\n'
    + `เจ้าหน้าที่ยึดของกลางได้ 12 รายการ มูลค่ารวม 350,000 บาท ทองคำที่ยึดได้ยังอยู่ครบ${BROKEN} ผู้ต้องหาให้การรับสารภาพแล้ว`,
  accident: 'รถกระบะเสียหลักพุ่งชนต้นไม้ริมถนนสาย 304 ช่วง อ.กบินทร์บุรี เมื่อเวลา 02.30 น. คนขับวัย 27 ปี ได้รับบาดเจ็บ ถูกนำส่งโรงพยาบาลกบินทร์บุรี\n\n'
    + `ชาวบ้านบอกว่าถนนช่วงนี้มืดและไม่มีไฟส่องสว่าง อบอุ่นขึ้น${BROKEN} เคยร้องเรียนไปแล้วหลายครั้งแต่ยังไม่มีการแก้ไข`,
  royal: 'ประชาชนกว่า 2,000 คนเฝ้ารับเสด็จ เมื่อเสด็จพระราชดำเนินไปทรงเปิดอาคารเรียนหลังใหม่ของโรงเรียนบ้านหนองแวง จ.ขอนแก่น\n\n'
    + `นักเรียน 320 คนได้เข้าใช้อาคารตั้งแต่ภาคเรียนนี้ ครูใหญ่เล่าว่าเด็กๆ ตื่นเต้นกันทั้งโรงเรียน${BROKEN} หลายคนซ้อมร้องเพลงสรรเสริญพระบารมีมาหลายวัน`,
  place: 'น้ำท่วมขยายวงกว้างใน อ.เมือง จ.สุโขทัย หลังฝนตกหนักต่อเนื่อง 3 วัน ระดับน้ำในถนนจรดวิถีถ่องสูงกว่า 40 เซนติเมตร\n\n'
    + `ชาวบ้าน 150 ครัวเรือนอพยพไปยังวัดคูหาสุวรรณ ทุกคนช่วยกันขนของขึ้นที่สูง${BROKEN} โรงเรียนในพื้นที่ประกาศปิด 4 แห่ง`,
};
const L46_ISSUE = { hasIssues: true, issues: [{ brokenText: BROKEN, reason: 'คำติดกันไร้ความหมาย', severity: 'high' }] };
const L46_CLEAN = { hasIssues: false, issues: [] };
const runL46 = (content, opts) => quiet(() => semanticSanityCheck(content, opts));

// ═══ A) สวิตช์ ═══
test('A1 CORRECTION_AI_TIMEOUT_MS: ไม่ตั้ง/ว่าง/ค่าเพี้ยน = 60000 · ตัวเลข (ทนอัญประกาศ/ช่องว่าง) = เพดาน · 0/off/legacy/false/no = โหมดถอย', async () => {
  for (const v of [undefined, '', '  ', 'abc', '-5', 'NaN']) {
    await withEnv({ CORRECTION_AI_TIMEOUT_MS: v }, () => assert.equal(guard.correctionAiTimeoutMs(), 60000, `ต้อง 60000: ${JSON.stringify(v)}`));
  }
  await withEnv({ CORRECTION_AI_TIMEOUT_MS: '45000' }, () => assert.equal(guard.correctionAiTimeoutMs(), 45000));
  await withEnv({ CORRECTION_AI_TIMEOUT_MS: ' "30000" ' }, () => assert.equal(guard.correctionAiTimeoutMs(), 30000));
  for (const v of ['0', 'off', 'legacy', 'false', 'no', 'OFF', '"0"', ' Legacy ']) {
    await withEnv({ CORRECTION_AI_TIMEOUT_MS: v }, () => {
      assert.equal(guard.correctionAiTimeoutMs(), null, `ต้องถอย: ${JSON.stringify(v)}`);
      assert.equal(guard.isCorrectionAiTimeoutLegacy(), true);
    });
  }
  assert.equal(guard.CORRECTION_AI_TIMEOUT_DEFAULT_MS, 60000);
});

test('A2 CORRECTION_CHECK_SYSTEM: ไม่ตั้ง/1/on/ค่าอื่น = ส่ง system สั้น · 0/off/false/no/legacy = ไม่ส่ง · system สั้นจริง ไม่มีกฎสายเขียน/รายการคำห้าม', async () => {
  for (const v of [undefined, '', '1', 'on', 'true', 'x']) {
    await withEnv({ CORRECTION_CHECK_SYSTEM: v }, () => assert.equal(guard.isCorrectionCheckSystemEnabled(), true, `ต้องส่ง: ${JSON.stringify(v)}`));
  }
  for (const v of ['0', 'off', 'false', 'no', 'legacy', '"0"', 'OFF']) {
    await withEnv({ CORRECTION_CHECK_SYSTEM: v }, () => assert.equal(guard.isCorrectionCheckSystemEnabled(), false, `ต้องไม่ส่ง: ${JSON.stringify(v)}`));
  }
  for (const sys of [guard.CORRECTION_CHECK_SYSTEM_PROMPT, guard.CORRECTION_FIX_SYSTEM_PROMPT]) {
    assert.ok(sys.length > 300 && sys.length < 1800, `system สั้น (ได้ ${sys.length} ตัวอักษร · ของเดิมสายเขียน ~3,900)`);
    assert.match(sys, /JSON เท่านั้น/u);
    assert.match(sys, /\[กฎที่ 2: ห้ามแต่งเรื่อง\]/u);
    assert.match(sys, /\[กฎที่ 4: JSON เท่านั้น\]/u);
    for (const banned of ['HUMAN WRITING DNA', 'ห้ามใช้คำเสี่ยง', 'FACEBOOK SAFETY', 'กฎที่ 5', 'อย่างน้อย 180 คำ', 'ถ้าสะดุด เขียนใหม่']) {
      assert.ok(!sys.includes(banned), `system งานตรวจต้องไม่มี "${banned}"`);
    }
  }
  assert.match(guard.CORRECTION_CHECK_SYSTEM_PROMPT, /ห้ามเขียนใหม่/u);
  assert.match(guard.CORRECTION_CHECK_SYSTEM_PROMPT, /คัดลอกตรงตัว/u);
  assert.match(guard.CORRECTION_FIX_SYSTEM_PROMPT, /แก้เฉพาะจุดที่สั่ง/u);
});

// ═══ B) L4.6 semanticSanityCheck ═══
test('B1 ค่าเริ่มต้น: claude ตอบทันที → ลบวลีพังได้เหมือนเดิม · args มี systemPrompt สั้นงานตรวจ + key signal · ไม่แตะ model/maxTokens/prompt · luna ไม่ถูกเรียก', async () => {
  for (const [group, content] of Object.entries(NEWS)) {
    reset(); setAI({ claude: [L46_ISSUE] });
    const r = await runL46(content);
    assert.equal(r.fixed, true, `${group}: ต้องลบวลีพัง`);
    assert.ok(!r.sanitizedContent.includes(BROKEN), `${group}: วลีพังต้องหาย`);
    assert.equal(r.sanitizedContent, content.replace(BROKEN, ''), `${group}: เนื้อส่วนอื่นคงเดิม`);
    assert.equal(calls.length, 1, 'เรียก claude ครั้งเดียว');
    const { args } = calls[0];
    assert.equal(args.model, 'claude-opus-5');
    assert.equal(args.maxTokens, 800);
    assert.ok(args.prompt.includes(content), 'พรอมต์เดิมมีเนื้อหา');
    assert.ok('signal' in args, 'ต้องส่ง key signal (ค่าเริ่มต้น)');
    assert.equal(args.systemPrompt, guard.CORRECTION_CHECK_SYSTEM_PROMPT, 'ต้องส่ง system สั้นงานตรวจ (MC-14)');
    assert.deepEqual(keysOf(args), ['model', 'maxTokens', 'prompt', 'signal', 'systemPrompt']);
  }
});

test('B2 ค่าเริ่มต้น + signal ผู้เรียก: AbortSignal ถึง callClaude จริง · ผู้เรียกยกเลิกกลางคัน → claude+luna ถูกยกเลิก → ข้ามด่าน คืน content เดิม ไม่ล้ม', async () => {
  reset();
  const ctrl = new AbortController();
  setAI({ claude: [L46_ISSUE, SLOW], luna: [L46_ISSUE, SLOW] });
  const p = runL46(NEWS.crime, { signal: ctrl.signal });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.signal instanceof AbortSignal, 'signal ที่ส่งให้ client ต้องเป็น AbortSignal (รวม parent + เพดาน)');
  assert.notEqual(calls[0].args.signal, ctrl.signal, 'ต้องเป็น signal ที่ compose แล้ว ไม่ใช่ตัวผู้เรียกตรงๆ');
  ctrl.abort(new Error('ผู้เรียกยกเลิก'));
  const { value: r, ms } = await timed(() => p);
  assert.equal(r.sanitizedContent, NEWS.crime, 'fail-open: content เดิม');
  assert.equal(r.fixed, false);
  assert.ok(r.error, 'ต้องมีป้าย error ให้กล่องดำ');
  assert.ok(ms < FAST_ENOUGH, `ต้องไม่รอ AI ช้า (ใช้ ${ms}ms)`);
  assert.ok(calls.every((c) => c.args.signal?.aborted), 'ทุกคำขอต้องถูกยกเลิกจริง');
});

test('B3 ค่าเริ่มต้น: claude ช้าเกินเพดาน → ลอง luna (โซ่เดิม) ได้ผล · luna ก็ได้ system สั้น + signal · เวลารวม ≈ เพดาน ไม่ใช่เวลา AI ช้า', async () => {
  reset(); setAI({ claude: [L46_ISSUE, SLOW], luna: [L46_ISSUE] });
  const { value: r, ms } = await withEnv({ CORRECTION_AI_TIMEOUT_MS: CAP }, () => timed(() => runL46(NEWS.accident)));
  assert.equal(r.fixed, true, 'luna ต้องได้ทำงานต่อ');
  assert.ok(!r.sanitizedContent.includes(BROKEN));
  assert.deepEqual(calls.map((c) => c.kind), ['claude', 'luna']);
  assert.ok(ms < FAST_ENOUGH, `ต้องไม่รอ claude ช้า (ใช้ ${ms}ms)`);
  const luna = calls[1].args;
  assert.equal(luna.model, 'gpt-5.6-luna');
  assert.equal(luna.temperature, 0.1);
  assert.equal(luna.maxTokens, 500);
  assert.ok('signal' in luna);
  assert.equal(luna.systemPrompt, guard.CORRECTION_CHECK_SYSTEM_PROMPT);
  assert.deepEqual(keysOf(luna), ['model', 'temperature', 'maxTokens', 'prompt', 'signal', 'systemPrompt']);
});

test('B4 ค่าเริ่มต้น: claude และ luna ช้าทั้งคู่ → ข้ามด่าน (fail-open) content เดิม · error บอก TIMEOUT + ชื่อขั้น · เวลารวม ≈ 2×เพดาน', async () => {
  for (const [group, content] of Object.entries(NEWS)) {
    reset(); setAI({ claude: [L46_ISSUE, SLOW], luna: [L46_ISSUE, SLOW] });
    const { value: r, ms } = await withEnv({ CORRECTION_AI_TIMEOUT_MS: CAP }, () => timed(() => runL46(content)));
    assert.equal(r.sanitizedContent, content, `${group}: content เดิมทุกไบต์`);
    assert.equal(r.fixed, false);
    assert.deepEqual(r.issuesFound, []);
    assert.match(String(r.error), /TIMEOUT: correction:L4\.6:luna/u, `${group}: error ต้องบอกว่าหมดเวลาที่ขั้นไหน (ได้ "${r.error}")`);
    assert.deepEqual(calls.map((c) => c.kind), ['claude', 'luna']);
    assert.ok(ms < FAST_ENOUGH, `${group}: ต้องคืนภายใน ≈2×เพดาน (ใช้ ${ms}ms)`);
  }
});

test('B5 โหมดถอยทั้งคู่ (CORRECTION_AI_TIMEOUT_MS=0 + CORRECTION_CHECK_SYSTEM=0) = การเรียกเดิมทุกไบต์: args เท่าเดิมเป๊ะ · รอ AI ช้าจนจบ · claude ล้ม → luna args เดิม', async () => {
  const legacy = { CORRECTION_AI_TIMEOUT_MS: '0', CORRECTION_CHECK_SYSTEM: '0' };
  reset(); setAI({ claude: [L46_ISSUE, 300] });
  const { value: r, ms } = await withEnv(legacy, () => timed(() => runL46(NEWS.royal)));
  assert.equal(r.fixed, true, 'ของเดิม: รอจนได้คำตอบแล้วลบ');
  assert.ok(ms >= 250, `ของเดิมต้องรอ AI ช้าจนจบ (ใช้ ${ms}ms)`);
  assert.deepEqual(calls[0].args, { model: 'claude-opus-5', maxTokens: 800, prompt: calls[0].args.prompt }, 'args claude เดิมทุกไบต์ (ไม่มี signal/systemPrompt)');
  assert.deepEqual(keysOf(calls[0].args), ['model', 'maxTokens', 'prompt']);
  reset(); setAI({ claude: new Error('mock-claude-down'), luna: [L46_ISSUE] });
  const r2 = await withEnv(legacy, () => runL46(NEWS.royal));
  assert.equal(r2.fixed, true);
  assert.deepEqual(calls.map((c) => c.kind), ['claude', 'luna']);
  assert.deepEqual(keysOf(calls[1].args), ['model', 'temperature', 'maxTokens', 'prompt'], 'args luna เดิมทุกไบต์');
  assert.deepEqual(calls[1].args, { model: 'gpt-5.6-luna', temperature: 0.1, maxTokens: 500, prompt: calls[1].args.prompt });
});

test('B6 สวิตช์แยกอิสระ: ถอยเฉพาะเวลา → มี systemPrompt ไม่มี signal · ถอยเฉพาะ system → มี signal ไม่มี systemPrompt', async () => {
  reset(); setAI({ claude: [L46_CLEAN] });
  await withEnv({ CORRECTION_AI_TIMEOUT_MS: 'legacy' }, () => runL46(NEWS.place));
  assert.deepEqual(keysOf(calls[0].args), ['model', 'maxTokens', 'prompt', 'systemPrompt']);
  reset(); setAI({ claude: [L46_CLEAN] });
  await withEnv({ CORRECTION_CHECK_SYSTEM: 'off' }, () => runL46(NEWS.place));
  assert.deepEqual(keysOf(calls[0].args), ['model', 'maxTokens', 'prompt', 'signal']);
});

test('B7 ไม่มีคีย์ Claude → luna ตรงตามโซ่เดิม (ไม่เรียก claude) พร้อม system สั้น + signal · ค่าเพี้ยน AI ยังคืน content เดิม', async () => {
  reset(); globalThis.__S7_CLAUDE_KEY__ = false; setAI({ luna: [L46_ISSUE] });
  const r = await runL46(NEWS.crime);
  assert.equal(r.fixed, true);
  assert.deepEqual(calls.map((c) => c.kind), ['luna']);
  assert.equal(calls[0].args.systemPrompt, guard.CORRECTION_CHECK_SYSTEM_PROMPT);
  reset(); setAI({ claude: [{ nonsense: true }] });
  const r2 = await runL46(NEWS.crime);
  assert.equal(r2.sanitizedContent, NEWS.crime);
});

// ═══ C) L3B / L3A safeCorrect ═══
const L3B_CONTENT = 'ชายคนหนึ่งพบเลือดบนพื้นถนนหน้าบ้านของเขา เขารีบแจ้งเจ้าหน้าที่ให้มาตรวจสอบพื้นที่โดยรอบทันที และคอยดูแลคนในบ้านให้อยู่ในความสงบเรียบร้อยตลอดทั้งคืน';
const L3B_ISSUE = { type: 'forbidden_word', text: 'เลือด', suggestion: 'ร่องรอยเหตุการณ์', severity: 'medium', location: 0 };
const L3B_LONG_CONTENT = 'ผู้เห็นเหตุการณ์เล่าว่าภาพตรงหน้ามีเลือดสาดกระจายทั่วบริเวณ ก่อนหน่วยกู้ภัยจะมาถึงและนำตัวผู้บาดเจ็บส่งโรงพยาบาลได้ทันเวลาในที่สุด';
const L3B_LONG_ISSUE = { type: 'forbidden_word', text: 'เลือดสาดกระจายทั่วบริเวณ', suggestion: 'เหตุรุนแรง', severity: 'high', location: 0 };
const runL3 = (content, issues, opts) => quiet(() => safeCorrect(content, issues, opts));

test('C1 L3B ค่าเริ่มต้น: args มี key signal + systemPrompt สั้นงานเกลาคำเสี่ยง (★ S8 · ไม่แตะ model/maxTokens 8000) · ตอบทันที = ai_context_rewrite เดิม · ช้าเกินเพดาน = แทนคำสั้น + ธง needs_review ท่อนยาว (เส้น fail-open เดิม)', async () => {
  reset(); setAI({ luna: [{ content: L3B_CONTENT.replace('เลือด', 'ร่องรอยบางอย่าง') }] });
  const ok = await runL3(L3B_CONTENT, [L3B_ISSUE]);
  assert.ok(ok.corrections.some((c) => c.type === 'ai_context_rewrite'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.maxTokens, 8000);
  assert.ok('signal' in calls[0].args);
  assert.equal(calls[0].args.systemPrompt, CORRECTION_RISK_REWRITE_SYSTEM_PROMPT, '★ S8: L3B ได้ system สั้นงานเกลาคำเสี่ยง (SYSTEM_PROMPT_SLIM ค่าเริ่มต้น)');
  assert.deepEqual(keysOf(calls[0].args), ['model', 'temperature', 'maxTokens', 'prompt', 'signal', 'systemPrompt']);

  // ช้าเกินเพดาน — ท่อนยาว (>12 ตัว) = fail-closed คงเนื้อ + ธง needs_review (เส้นเดียวกับ tests/l3b-contract ข้อ 5 "AI ล่ม")
  reset(); setAI({ luna: [{ content: 'ช้า' }, SLOW] });
  const { value: slowLong, ms } = await withEnv({ CORRECTION_AI_TIMEOUT_MS: CAP }, () => timed(() => runL3(L3B_LONG_CONTENT, [L3B_LONG_ISSUE])));
  assert.ok(ms < FAST_ENOUGH, `ต้องไม่รอ AI ช้า (ใช้ ${ms}ms)`);
  assert.ok(slowLong.correctedContent.includes('เลือดสาดกระจายทั่วบริเวณ'), 'ท่อนยาวไม่ถูกแทนดิบ (fail-closed เดิม)');
  assert.ok(slowLong.corrections.some((c) => c.type === 'needs_review'), 'มีธงให้คนตรวจ');
  assert.equal(calls.length, 1);
  // ช้าเกินเพดาน — คำสั้น (≤12 ตัว) = แทนตรงตามเส้น fallback เดิม
  reset(); setAI({ luna: [{ content: 'ช้า' }, SLOW] });
  const { value: slowShort, ms: ms2 } = await withEnv({ CORRECTION_AI_TIMEOUT_MS: CAP }, () => timed(() => runL3(L3B_CONTENT, [L3B_ISSUE])));
  assert.ok(ms2 < FAST_ENOUGH, `ต้องไม่รอ AI ช้า (ใช้ ${ms2}ms)`);
  assert.ok(slowShort.correctedContent.includes('ร่องรอยเหตุการณ์'), 'คำสั้นแทนตรงตามเส้นเดิม');
  assert.ok(slowShort.corrections.some((c) => c.type === 'regex_replace' && c.reason === 'Fallback direct replace'));
});

test('C2 L3B โหมดถอย: args เดิมทุกไบต์ [model, temperature, maxTokens, prompt] + รอ AI ช้าจนจบ', async () => {
  reset(); setAI({ luna: [{ content: L3B_CONTENT.replace('เลือด', 'ร่องรอยบางอย่าง') }, 300] });
  // ★ S8: L3B ได้ systemPrompt จาก SYSTEM_PROMPT_SLIM (ค่าเริ่มต้น) — "args เดิมทุกไบต์" ต้องถอยสวิตช์นั้นด้วย
  const { value: r, ms } = await withEnv({ CORRECTION_AI_TIMEOUT_MS: '0', SYSTEM_PROMPT_SLIM: '0' }, () => timed(() => runL3(L3B_CONTENT, [L3B_ISSUE])));
  assert.ok(r.corrections.some((c) => c.type === 'ai_context_rewrite'));
  assert.ok(ms >= 250, `ของเดิมรอจนจบ (ใช้ ${ms}ms)`);
  assert.deepEqual(keysOf(calls[0].args), ['model', 'temperature', 'maxTokens', 'prompt']);
  assert.deepEqual(calls[0].args, { model: 'gpt-5.6-luna', temperature: 0.1, maxTokens: 8000, prompt: calls[0].args.prompt });
});

const wording = (text) => ({ type: 'ai_wording', text, location: 0, severity: 'medium', suggestion: 'ลบหรือเปลี่ยนเป็นภาษาคนพูดจริง' });
const L3A_CONTENT = 'ตำรวจ สน.บางนา จับกุมชายวัย 34 ปี ผู้ต้องสงสัยชิงทรัพย์ร้านทอง 3 ร้าน ทั้งนี้ ผู้ต้องหาให้การรับสารภาพแล้ว\n\n'
  + 'เจ้าหน้าที่ยึดของกลางได้ 12 รายการ มูลค่ารวม 350,000 บาท ของกลางดังกล่าวจะนำส่งพนักงานสอบสวนต่อไป\n\n'
  + 'อย่างไรก็ตาม ญาติของผู้เสียหายบางรายยังกังวลว่าจะได้ทองคืนครบหรือไม่';
const L3A_ISSUES = [wording('ทั้งนี้'), wording('ดังกล่าว'), wording('อย่างไรก็ตาม')];
const sentenceFromPrompt = (args) => (args.prompt.match(/ประโยคเดิม: ([^\n]*)/u) || [])[1] || '';
const l3aEditor = (args) => ({ sentence: sentenceFromPrompt(args).replace(/ทั้งนี้ |ดังกล่าว|อย่างไรก็ตาม /gu, '').replace(/  +/g, ' ').trim() });

test('C3 L3A ค่าเริ่มต้น: 3 ย่อหน้า AI ตอบทันที = เรียก 3 ครั้ง ทุกครั้งมี key signal + systemPrompt สั้นงานเกลาวลี (★ S8) วลีหายหมด · AI ช้า = หมดเวลาครั้งแรกแล้ว "เบรกเกอร์" หยุดเรียก (1 ครั้ง ไม่ใช่ 3) คงเนื้อเดิม ไม่ล้ม', async () => {
  reset(); setAI({ luna: [l3aEditor] });
  const ok = await runL3(L3A_CONTENT, L3A_ISSUES);
  assert.equal(calls.length, 3, 'ย่อหน้าละ 1 คำขอ');
  assert.ok(calls.every((c) => 'signal' in c.args && c.args.systemPrompt === CORRECTION_PHRASE_FIX_SYSTEM_PROMPT && c.args.maxTokens === 2000), '★ S8: L3A ได้ system สั้นงานเกลาวลีทุกคำขอ');
  assert.deepEqual(keysOf(calls[0].args), ['model', 'temperature', 'maxTokens', 'prompt', 'signal', 'systemPrompt']);
  assert.equal(ok.corrections.filter((c) => c.type === 'ai_sentence_fix').length, 3);
  for (const w of ['ทั้งนี้', 'ดังกล่าว', 'อย่างไรก็ตาม']) assert.ok(!ok.correctedContent.includes(w), `วลี "${w}" ต้องหาย`);

  reset(); setAI({ luna: [l3aEditor, SLOW] });
  const { value: slow, ms } = await withEnv({ CORRECTION_AI_TIMEOUT_MS: CAP }, () => timed(() => runL3(L3A_CONTENT, L3A_ISSUES)));
  assert.equal(calls.length, 1, `เบรกเกอร์: หมดเวลาครั้งแรกแล้วประโยคที่เหลือต้องไม่เรียกซ้ำ (เรียก ${calls.length})`);
  assert.equal(slow.correctedContent, L3A_CONTENT, 'คงเนื้อเดิมทุกไบต์');
  assert.ok(!slow.corrections.some((c) => c.type === 'ai_sentence_fix'));
  assert.ok(ms < FAST_ENOUGH, `ต้องไม่รอ N×เพดาน (ใช้ ${ms}ms)`);
});

test('C4 L3A โหมดถอยเวลา (L3A_AI_FIX ค่าเริ่มต้น S5): args เดิม [model, temperature, maxTokens, prompt] · AI ช้า = รอครบทุกประโยค 3 ครั้ง (ไม่มีเบรกเกอร์เพราะไม่มีเพดาน)', async () => {
  reset(); setAI({ luna: [l3aEditor, 150] });
  // ★ S8: L3A ได้ systemPrompt จาก SYSTEM_PROMPT_SLIM (ค่าเริ่มต้น) — "args เดิม" ต้องถอยสวิตช์นั้นด้วย
  const { value: r, ms } = await withEnv({ CORRECTION_AI_TIMEOUT_MS: 'off', SYSTEM_PROMPT_SLIM: '0' }, () => timed(() => runL3(L3A_CONTENT, L3A_ISSUES)));
  assert.equal(calls.length, 3);
  assert.ok(ms >= 400, `ของเดิมรอทุกประโยคต่อกัน (ใช้ ${ms}ms)`);
  assert.deepEqual(keysOf(calls[0].args), ['model', 'temperature', 'maxTokens', 'prompt']);
  assert.equal(r.corrections.filter((c) => c.type === 'ai_sentence_fix').length, 3);
});

test('C5 L3A_AI_FIX=legacy (โค้ดเดิมของ S5) ไม่ถูกแตะ: ไม่มี signal แม้ค่าเริ่มต้นของ S7 · maxTokens 200 · เรียก 1 ครั้ง/วลี', async () => {
  reset(); setAI({ luna: [{ sentence: 'x' }] });
  await withEnv({ L3A_AI_FIX: 'legacy' }, () => runL3(L3A_CONTENT, L3A_ISSUES));
  assert.equal(calls.length, 3);
  for (const c of calls) {
    assert.deepEqual(keysOf(c.args), ['model', 'temperature', 'maxTokens', 'prompt']);
    assert.equal(c.args.maxTokens, 200);
  }
});

// ═══ D) L1.8 fabricationGate (เปิดด้วย FAB_GATE=1 เฉพาะในข้อสอบ) ═══
const FAB_SUSPECT = 'ผู้ก่อเหตุเป็นนักบินอวกาศลับจากดาวอังคาร';
const FAB_SOURCE = `ต้นฉบับระบุเพียงว่าเจ้าหน้าที่กำลังตรวจสอบเหตุการณ์และประชาชนปลอดภัย ${'ข้อมูลยืนยันจากต้นฉบับ '.repeat(6)}`;
const FAB_CONTENT = `บทความรายงานเหตุการณ์ตามข้อมูลเบื้องต้น ${FAB_SUSPECT} ${'เนื้อหาส่วนที่ยืนยันได้ยังคงเดิมและไม่ควรถูกตัด '.repeat(6)}`;
const FAB_FIXED = FAB_CONTENT.replace(FAB_SUSPECT, '').trim();
const fabPlan = (delay1 = 0) => {
  let lunaCalls = 0;
  return {
    luna: [() => (++lunaCalls === 1 ? { fabrications: [FAB_SUSPECT] } : { confirmed: [FAB_SUSPECT] }), delay1],
    claude: [{ content: FAB_FIXED }],
  };
};
const runFab = (env, opts) => withEnv({ FAB_GATE: '1', ...env }, () => quiet(() => fabricationGate(FAB_CONTENT, FAB_SOURCE, null, opts)));

test('D1 L1.8 ค่าเริ่มต้น: happy path ผ่าของเกินได้เหมือนเดิม · 3 คำขอมี key signal · system เดิมของด่านคงอยู่ (GATE_CHECK_SYS/GATE_FIX_SYS) ไม่ถูกแทนด้วย system กลาง', async () => {
  reset(); setAI(fabPlan());
  const r = await runFab({});
  assert.equal(r.content, FAB_FIXED);
  assert.equal(r.debug.fixed, true);
  assert.deepEqual(calls.map((c) => c.kind), ['luna', 'luna', 'claude']);
  for (const c of calls) assert.ok('signal' in c.args, 'ทุกคำขอต้องมี key signal');
  assert.equal(calls[0].args.systemPrompt, 'คุณคือผู้ตรวจข้อเท็จจริงของกองบรรณาธิการ เทียบบทความกับต้นฉบับอย่างเข้มงวด ตอบเป็น JSON เท่านั้น');
  assert.equal(calls[2].args.systemPrompt, 'คุณคือบรรณาธิการแก้บทความแบบศัลยกรรม แก้เฉพาะจุดที่สั่ง ห้ามแตะส่วนอื่น ตอบเป็น JSON เท่านั้น');
  assert.deepEqual(keysOf(calls[0].args), ['model', 'temperature', 'maxTokens', 'systemPrompt', 'prompt', 'signal']);
  assert.deepEqual(keysOf(calls[2].args), ['model', 'maxTokens', 'systemPrompt', 'prompt', 'signal']);
});

test('D2 L1.8 ค่าเริ่มต้น: ขั้น 1 ช้าเกินเพดาน → fail-open ปล่อยเนื้อเดิม debug.error TIMEOUT · ไม่เดินขั้นถัดไป (ไม่จ่ายเพิ่ม) · คืนภายใน ≈ เพดาน', async () => {
  reset(); setAI(fabPlan(SLOW));
  const { value: r, ms } = await timed(() => runFab({ CORRECTION_AI_TIMEOUT_MS: CAP }));
  assert.equal(r.content, FAB_CONTENT, 'เนื้อเดิมทุกไบต์');
  assert.equal(r.debug.fixed, false);
  assert.match(String(r.debug.error), /TIMEOUT: correction:L1\.8:flag/u);
  assert.equal(calls.length, 1, 'หมดเวลาขั้น 1 แล้วต้องไม่เรียกขั้น 2/3');
  assert.ok(ms < FAST_ENOUGH, `ต้องไม่รอ AI ช้า (ใช้ ${ms}ms)`);
});

test('D3 L1.8 โหมดถอย: args เดิมทุกไบต์ (ไม่มี signal) และรอ AI ช้าจนจบ', async () => {
  reset(); setAI(fabPlan(300));
  const { value: r, ms } = await timed(() => runFab({ CORRECTION_AI_TIMEOUT_MS: '0' }));
  assert.equal(r.content, FAB_FIXED);
  assert.ok(ms >= 250, `ของเดิมรอจนจบ (ใช้ ${ms}ms)`);
  assert.deepEqual(keysOf(calls[0].args), ['model', 'temperature', 'maxTokens', 'systemPrompt', 'prompt']);
  assert.deepEqual(keysOf(calls[1].args), ['model', 'temperature', 'maxTokens', 'systemPrompt', 'prompt']);
  assert.deepEqual(keysOf(calls[2].args), ['model', 'maxTokens', 'systemPrompt', 'prompt']);
});

// ═══ E) L1.5 flagFixer (ปลดออกจากท่อ 12 มิ.ย. — ล็อกสัญญาไว้เผื่อต่อกลับ) ═══
const CLOSING = ' และนี่คือประโยคปิดท้ายที่เหมือนกันทุกตัวอักษรของทั้งสองเวอร์ชันเลย';
const FLAG_V1 = { content: 'เวอร์ชันแรกเล่าเรื่องจากมุมของแม่ที่รอลูกกลับบ้านทั้งคืน โดยไม่รู้ว่าลูกอยู่ที่ไหน' + CLOSING };
const FLAG_V2 = { content: 'เวอร์ชันสองเล่าเรื่องจากมุมของเพื่อนบ้านที่เห็นเหตุการณ์ตั้งแต่ต้นจนจบ' + CLOSING };
const FLAG_FIXED = FLAG_V2.content.replace(CLOSING, ' และในที่สุดทุกคนก็ได้กลับบ้านพร้อมหน้ากันอีกครั้ง');
const runFlag = (opts) => quiet(() => fixFlaggedVersions([{ ...FLAG_V1 }, { ...FLAG_V2 }], { newsBody: '' }, opts));

test('E1 L1.5 ค่าเริ่มต้น: ตรวจมุมเปิด = system สั้นงานตรวจ + signal · แก้จุดที่ธงชี้ (claude-opus-5) = system สั้นงานแก้เฉพาะจุด + signal · ผลแก้ใช้จริง', async () => {
  reset(); setAI({ luna: [{ rewrite: [] }], claude: [{ fixedContent: FLAG_FIXED }] });
  const r = await runFlag();
  assert.equal(r.fixed, 1);
  assert.equal(r.versions[1].content, FLAG_FIXED);
  assert.deepEqual(calls.map((c) => c.kind), ['luna', 'claude']);
  assert.equal(calls[0].args.systemPrompt, guard.CORRECTION_CHECK_SYSTEM_PROMPT);
  assert.ok('signal' in calls[0].args);
  assert.deepEqual(keysOf(calls[0].args), ['model', 'temperature', 'maxTokens', 'prompt', 'signal', 'systemPrompt']);
  assert.equal(calls[1].args.systemPrompt, guard.CORRECTION_FIX_SYSTEM_PROMPT);
  assert.equal(calls[1].args.model, 'claude-opus-5');
  assert.equal(calls[1].args.maxTokens, 3000);
  assert.deepEqual(keysOf(calls[1].args), ['model', 'maxTokens', 'prompt', 'signal', 'systemPrompt']);
});

test('E2 L1.5 ค่าเริ่มต้น: claude ช้า → terra (โซ่เดิม) ได้ผล · ทั้งคู่ช้า → คงเวอร์ชันเดิม ไม่ล้ม ภายในเวลา ≈ เพดาน', async () => {
  reset(); setAI({ luna: [{ rewrite: [] }], claude: [{ fixedContent: FLAG_FIXED }, SLOW], terra: [{ fixedContent: FLAG_FIXED }] });
  const { value: r, ms } = await withEnv({ CORRECTION_AI_TIMEOUT_MS: CAP }, () => timed(() => runFlag()));
  assert.equal(r.fixed, 1);
  assert.deepEqual(calls.map((c) => c.kind), ['luna', 'claude', 'terra']);
  assert.equal(calls[2].args.systemPrompt, guard.CORRECTION_FIX_SYSTEM_PROMPT);
  assert.ok(ms < FAST_ENOUGH, `ใช้ ${ms}ms`);
  reset(); setAI({ luna: [{ rewrite: [] }, SLOW], claude: [{ fixedContent: FLAG_FIXED }, SLOW], terra: [{ fixedContent: FLAG_FIXED }, SLOW] });
  const { value: r2, ms: ms2 } = await withEnv({ CORRECTION_AI_TIMEOUT_MS: CAP }, () => timed(() => runFlag()));
  assert.equal(r2.fixed, 0);
  assert.equal(r2.versions[1].content, FLAG_V2.content, 'คงเวอร์ชันเดิม');
  assert.ok(ms2 < FAST_ENOUGH, `ใช้ ${ms2}ms`);
});

test('E3 L1.5 โหมดถอยทั้งคู่: args เดิมทุกไบต์ (same-angle/claude/terra)', async () => {
  const legacy = { CORRECTION_AI_TIMEOUT_MS: 'legacy', CORRECTION_CHECK_SYSTEM: 'legacy' };
  reset(); setAI({ luna: [{ rewrite: [] }], claude: new Error('mock-claude-down'), terra: [{ fixedContent: FLAG_FIXED }] });
  const r = await withEnv(legacy, () => runFlag());
  assert.equal(r.fixed, 1);
  assert.deepEqual(calls.map((c) => c.kind), ['luna', 'claude', 'terra']);
  assert.deepEqual(keysOf(calls[0].args), ['model', 'temperature', 'maxTokens', 'prompt']);
  assert.deepEqual(calls[1].args, { model: 'claude-opus-5', maxTokens: 3000, prompt: calls[1].args.prompt });
  assert.deepEqual(calls[2].args, { model: 'gpt-5.6-terra', temperature: 0.4, maxTokens: 3000, prompt: calls[2].args.prompt });
});

// ═══ F) ท่อจริง runCorrectionPipeline + เส้นตายรวมจริง ═══
const runPipeline = (pipeline, content, options) =>
  withEnv({ SKIP_CORRECTION: undefined }, () => quiet(async () => (await pipeline([{ content, style: 's7' }], { newsBody: content }, {}, null, content, options))[0]));

test('F1 ท่อส่ง options.signal ต่อให้ L1.8 / L3 / L4.6 ตัวเดียวกัน (===) · ไม่ส่ง options = signal undefined (พฤติกรรมเดิม)', async () => {
  const seen = { fab: [], l3: [], l46: [] };
  const spyPipeline = buildPipeline({
    auditOutput: async () => ({ auditScore: 70, issues: [{ type: 'engagement_bait', severity: 'medium', text: 'พิมพ์ 1' }] }), // เส้น non-clean → L3 + L4.6
    fabricationGate: async (content, body, facts, opts) => { seen.fab.push(opts?.signal); return { content, debug: { sus: 0, confirmed: 0, fixed: false } }; },
    safeCorrect: async (content, issues, opts) => { seen.l3.push(opts?.signal); return { correctedContent: content, rollbackContent: content, corrections: [] }; },
    semanticSanityCheck: async (content, opts) => { seen.l46.push(opts?.signal); return { sanitizedContent: content, issuesFound: [], fixed: false }; },
  });
  const ctrl = new AbortController();
  await runPipeline(spyPipeline, NEWS.crime, { signal: ctrl.signal });
  assert.deepEqual([seen.fab, seen.l3, seen.l46].map((s) => s.length), [1, 1, 1]);
  assert.equal(seen.fab[0], ctrl.signal);
  assert.equal(seen.l3[0], ctrl.signal);
  assert.equal(seen.l46[0], ctrl.signal);
  await runPipeline(spyPipeline, NEWS.crime);
  assert.equal(seen.l46[1], undefined, 'ไม่ส่ง options = undefined เหมือนเดิม');
});

test('F2 เส้นตายรวมจริงเหลือ 30s < เพดาน 60s: ค่าเริ่มต้นข้าม L4.6 ทันทีโดยไม่เรียก AI (ไม่จ่ายเงิน) ท่อไม่ล้ม content เดิม · โหมดถอย: เรียก AI ทั้งที่งบไม่พอ (บั๊กเดิม)', async () => {
  const pipeline = buildPipeline();
  reset(); setAI({ claude: [L46_ISSUE], luna: [L46_ISSUE] });
  const deadline = createPipelineDeadline({ deadlineAt: Date.now() + 30_000 });
  const v = await runWithPipelineDeadline(deadline, () => runPipeline(pipeline, NEWS.accident));
  assert.equal(calls.length, 0, 'งบเหลือไม่พอเพดาน → ต้องไม่เรียก AI เลย');
  assert.equal(v.content, NEWS.accident);
  assert.equal(v._correctionError, undefined, 'ท่อต้องไม่ล้ม');
  assert.equal(v._correctionDebug.semanticCheck.checked, true);
  assert.match(String(v._correctionDebug.semanticCheck.error), /ไม่พอสำหรับขั้น correction:L4\.6/u);
  assert.equal(v._correctionDebug.path, 'clean');

  reset(); setAI({ claude: [L46_ISSUE], luna: [L46_ISSUE] });
  const deadline2 = createPipelineDeadline({ deadlineAt: Date.now() + 30_000 });
  const v2 = await withEnv({ CORRECTION_AI_TIMEOUT_MS: '0' }, () => runWithPipelineDeadline(deadline2, () => runPipeline(pipeline, NEWS.accident)));
  assert.equal(calls.length, 1, 'ของเดิม: เรียก claude ทั้งที่งบเหลือ 30s (แค่ 15s ขั้นต่ำของ client)');
  assert.equal(v2._correctionDebug.semanticCheck.fixed, true);
});

test('F3 เส้นตายรวมจริงงบพอ + claude ค้าง: ท่อคืนผลภายใน ≈ 2×เพดาน content เดิม เส้นตายไม่ถูกดึงจนหมด · request ถูกยกเลิกจริง (signal aborted)', async () => {
  const pipeline = buildPipeline();
  reset(); setAI({ claude: [L46_ISSUE, SLOW], luna: [L46_ISSUE, SLOW] });
  const deadline = createPipelineDeadline({ deadlineAt: Date.now() + 600_000 });
  const { value: v, ms } = await withEnv({ CORRECTION_AI_TIMEOUT_MS: CAP }, () => timed(() => runWithPipelineDeadline(deadline, () => runPipeline(pipeline, NEWS.royal))));
  assert.equal(v.content, NEWS.royal);
  assert.equal(v._correctionError, undefined, 'ท่อต้องไม่ล้ม (fail-open)');
  assert.match(String(v._correctionDebug.semanticCheck.error), /TIMEOUT: correction:L4\.6:luna/u);
  assert.deepEqual(calls.map((c) => c.kind), ['claude', 'luna']);
  assert.ok(calls.every((c) => c.args.signal instanceof AbortSignal && c.args.signal.aborted), 'ใต้เส้นตายรวม signal ต้องถึง client และถูกยกเลิกจริง');
  assert.ok(ms < FAST_ENOUGH, `ใช้ ${ms}ms`);
  assert.ok(deadline.remainingMs() > 590_000, 'เส้นตายรวมยังเหลือเกือบเต็ม (ชั้นนี้ไม่กินงบของด่าน Sol)');
});

// ═══ G) ซอร์ส: ทุกจุดเรียก AI ในไฟล์ด่านอยู่ใต้ correctionAiCall ═══
test('G1 ซอร์สจริง: callAI({ / callClaude({ ทุกจุดใน L4.6/L3/L1.8/L1.5 อยู่ใต้ correctionAiCall(…, (signal) => …) ยกเว้น fixSentenceWithAILegacy · runCorrectionPipeline ส่ง signal ครบ 4 จุด', () => {
  const files = ['semanticSanityCheck.js', 'safeCorrectionService.js', 'fabricationGate.js', 'flagFixerService.js'];
  for (const f of files) {
    const src = readSrc(`../src/lib/correction/${f}`);
    const legacyAt = src.indexOf('async function fixSentenceWithAILegacy');
    let total = 0;
    for (const m of src.matchAll(/\b(callAI|callClaude)\(\{/gu)) {
      if (legacyAt >= 0 && m.index > legacyAt) continue; // โค้ดเดิมทุกไบต์ของ S5 (ห้ามแตะ)
      const lineStart = src.lastIndexOf('\n', m.index) + 1;
      if (/^\s*(\/\/|\*|\/\*)/u.test(src.slice(lineStart, m.index))) continue; // คอมเมนต์ "ของเดิม: …" ไม่ใช่โค้ด
      total += 1;
      const before = src.slice(Math.max(0, m.index - 220), m.index);
      assert.match(before, /correctionAiCall\('correction:[^']+',\s*\(signal\) =>\s*$/u, `${f}: ${m[1]}({ ที่ตำแหน่ง ${m.index} ไม่ได้อยู่ใต้ correctionAiCall`);
    }
    assert.ok(total >= 2, `${f}: ต้องพบจุดเรียก AI ที่ครอบแล้วอย่างน้อย 2 (พบ ${total})`);
  }
  const pipe = readSrc('../src/lib/correction/correctionPipeline.js');
  assert.equal((pipe.match(/\{ signal: _corrSignal \}/gu) || []).length, 4, 'L1.8 + L3 + L4.6 ×2 ต้องส่ง signal');
  assert.match(pipe, /rawSourceText = null, options = \{\}\) \{/u);
});
