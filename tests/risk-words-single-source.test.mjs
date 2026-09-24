// 🔏 ข้อสอบตารางคำเสี่ยงแหล่งเดียว + ลำดับ ตัวกรอง→L2→L3 + แทนคำตรงตำแหน่งที่กฎจับ — src/lib/ai/riskWords.js (OV-01 / PL-15 / PL-04)
// ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S2 · เจ้าของอนุมัติ)
//
// สิ่งที่ล็อกไว้:
//   A. สวิตช์ RISK_WORDS_LEGACY: ค่าที่รับ · =1 → L2 ลูป FORBIDDEN_WORDS เดิม + L3 String.replace เดิม + ตัวกรองใช้ WORD_RULES ของ S1 + พรอมต์เดิมทุกไบต์
//   B. ตารางกลาง: id ไม่ซ้ำ · โครงถูก · "ปิด" (คำแทน/สำนวนทางเลือกทุกตัวไม่ถูกกฎใดจับซ้ำ) · ชุด sanitize = WORD_RULES ของ S1 ทุกข้อทุกลำดับ (ตัวกรองไบต์เดิม)
//   C. OV-01: ยิงตาย → ใช้อาวุธปืนจนเสียชีวิต → L2 ไม่จับ "อาวุธ" → L3 ไม่แทนซ้ำ (ค่าเริ่มต้น) · โหมดถอยยังได้ "สิ่งของอันตรายปืน" (บั๊กเดิมทำซ้ำได้)
//   D. PL-04: L3A / L3B-fallback / rollback scrub แทนตรงตำแหน่งที่ L2 จับ — ทำร้ายตัวเอง/ยิงประตู/เส้นเลือด/ระดับ/ตามลำดับ คงเดิม · โหมดถอยทำซ้ำบั๊ก
//   E. L2 ใช้กติกาเดียวกับตัวกรอง: ไม่จับกลางคำ (ประเทศพม่า/ทศพล) · ชื่อเรื่องในเครื่องหมายคำพูด · ไม่จับ "ไม่อยากตาย" · กฎยาวชนะ (ยิงตาย = 1 issue) · location ตำแหน่งจริง
//   F. พรอมต์: client จริง 3 ตัว (SDK ปลอม ไม่มี network) — ค่าเริ่มต้น = บรรทัดจากตารางกลาง (มีข้อยกเว้น "อาวุธปืน") · =1 = บรรทัดเดิมทุกไบต์ ·
//      promptStore(Text) โหลดจริง · summarizeService(Text) ต่อสายถูกจุดและคงบล็อกเดิมไว้ให้โหมดถอย
//
// วิธีรัน:  node --test tests/risk-words-single-source.test.mjs
// โหมดกลายพันธุ์ (พิสูจน์ว่าข้อสอบกัดจริง — เทสต้องแดง · แก้เฉพาะสำเนาในหน่วยความจำ):
//   RISK_WORDS_TEST_MUTATION=no-closure          ถอดข้อยกเว้น "อาวุธปืน" ออกจากกฎ อาวุธ (ตารางไม่ปิด → OV-01 กลับมา)
//   RISK_WORDS_TEST_MUTATION=first-occurrence    L3 กลับไป String.replace ตำแหน่งแรก (PL-04 กลับมา)
//   RISK_WORDS_TEST_MUTATION=no-legacy-switch-l2 L2 ไม่สนสวิตช์ถอย (โหมดถอยไม่ได้ของเดิม)
//   RISK_WORDS_TEST_MUTATION=audit-no-boundary   เครื่องสแกนเลิกเช็คขอบคำ (L2 จับ ศพ ใน ประเทศพม่า)
//   RISK_WORDS_TEST_MUTATION=scrub-split-join    rollback scrub กลับไป split/join ทุกตำแหน่ง ("ตามลำจากไป" กลับมา)
//                                                (★ S4: เส้น ruleId ของ scrub ย้ายไป src/lib/correction/rollbackScrub.js — กลายพันธุ์ที่โมดูลนั้น)
//   RISK_WORDS_TEST_MUTATION=prompt-old-corpse   ตารางกลางเปลี่ยน ศพ → ร่างผู้เสียหาย (พรอมต์/ตัวกรองไม่ตรงกับ S1)
// ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S4 · เจ้าของอนุมัติ): ท่อเรียก scrubRollbackContent/isCorrRollbackLegacy (./rollbackScrub.js) — โหลดเข้ากราฟเดียวกัน (ใช้ตารางกลาง/เครื่องสแกน
//   ชุดเดียวกับ L2/L3 ที่กลายพันธุ์) แล้วฉีดเข้าท่อ · ข้อ D3 โหมดถอย RISK_WORDS_LEGACY=1 ยังต้องได้ "ตามลำจากไป" (สัญญา S2: scrub = split/join เดิม เมื่อ issue ไม่มี ruleId)
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { importPatchedModule, importPatchedGraph } from './helpers/temp-module.mjs';
// ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S3 · เจ้าของอนุมัติ): L4.5 ของท่อเรียก scrubHallucinatedPlaces/isL45Legacy — ฉีดของจริง (ข้อสอบนี้ส่ง newsBody = เนื้อเดียวกัน → ชื่อทุกตัวมีจริง = ไม่แตะ)
import { scrubHallucinatedPlaces, isL45Legacy } from '../src/lib/correction/placeScrub.js';

const MUTATION = process.env.RISK_WORDS_TEST_MUTATION || '';
const KNOWN_MUTATIONS = ['no-closure', 'first-occurrence', 'no-legacy-switch-l2', 'audit-no-boundary', 'scrub-split-join', 'prompt-old-corpse'];
if (MUTATION && !KNOWN_MUTATIONS.includes(MUTATION)) throw new Error('ไม่รู้จัก mutation: ' + MUTATION);
if (MUTATION) console.log(`🧬 MUTATION ACTIVE: ${MUTATION} — ข้อสอบชุดนี้ต้องแดงจึงจะถือว่ากัดจริง`);

const srcUrl = (rel) => new URL(rel, import.meta.url);
const readSrc = (rel) => readFileSync(srcUrl(rel), 'utf8').replace(/\r\n/g, '\n');
const mustReplace = (src, from, to, label) => {
  const out = src.replace(from, to);
  if (out === src) throw new Error('replace ไม่เกิดผล: ' + label);
  return out;
};
const withEnv = async (name, value, fn) => {
  const prior = process.env[name];
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
  try { return await fn(); } finally { if (prior === undefined) delete process.env[name]; else process.env[name] = prior; }
};
const legacy = (fn) => withEnv('RISK_WORDS_LEGACY', '1', fn);
const fresh = (fn) => withEnv('RISK_WORDS_LEGACY', undefined, fn);
const quiet = async (fn) => {
  const prior = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = prior.log; console.warn = prior.warn; console.error = prior.error; }
};

// ── โหลดกราฟซอร์สจริง: riskWords → safetyFilter → outputAuditService / safeCorrectionService (stub เฉพาะ AI/modelConfig/flagFixer) ──
let riskSource = readSrc('../src/lib/ai/riskWords.js');
let filterSource = readSrc('../src/lib/ai/safetyFilter.js');
let auditSource = readSrc('../src/lib/correction/outputAuditService.js');
let correctSource = readSrc('../src/lib/correction/safeCorrectionService.js');
let pipelineSource = readSrc('../src/lib/correction/correctionPipeline.js');
let rollbackScrubSource = readSrc('../src/lib/correction/rollbackScrub.js'); // ★ S4

auditSource = mustReplace(auditSource, "import { callAI } from '@/lib/ai/openai';", "const callAI = async () => { throw new Error('AI-mock (audit ไม่ควรเรียก)'); };", 'audit stub openai');
correctSource = mustReplace(correctSource, "import { callAI } from '@/lib/ai/openai';",
  'const callAI = async (args) => globalThis.__S2_AI__(args);', 'correct stub openai');
correctSource = mustReplace(correctSource, "import { MODEL_FAST } from '@/lib/ai/modelConfig';", "const MODEL_FAST = 'mock';", 'correct stub modelConfig');
correctSource = mustReplace(correctSource, "import { keyNumbersOf, hasKeyNumber } from './flagFixerService';",
  'const keyNumbersOf = () => []; const hasKeyNumber = () => true;', 'correct stub flagFixer');

if (MUTATION === 'no-closure') {
  riskSource = mustReplace(riskSource, "nextBlock: ['ปืน'], severity: 'medium', group: 'weapon'", "nextBlock: [], severity: 'medium', group: 'weapon'", 'no-closure');
} else if (MUTATION === 'first-occurrence') {
  correctSource = mustReplace(correctSource, 'const replaced = replaceRiskWordIssue(content, issue);\n    return replaced === null ? content : replaced;',
    'return content.replace(issue.text, issue.suggestion);', 'first-occurrence');
} else if (MUTATION === 'no-legacy-switch-l2') {
  auditSource = mustReplace(auditSource, 'if (isRiskWordsLegacy()) {', 'if (false) {', 'no-legacy-switch-l2');
} else if (MUTATION === 'audit-no-boundary') {
  filterSource = mustReplace(filterSource, 'if (!boundaries.has(s) || !boundaries.has(e)) continue;', '/* mutated */', 'audit-no-boundary');
} else if (MUTATION === 'scrub-split-join') {
  // ★ S4: เส้น ruleId ของ scrub อยู่ที่โมดูล rollbackScrub.js (ท่อค่าเริ่มต้นเรียกโมดูลนี้ · บล็อกเดิมในท่อเหลือเฉพาะโหมดถอย CORR_ROLLBACK_LEGACY=1)
  rollbackScrubSource = mustReplace(rollbackScrubSource, 'const r = replaceRiskWordIssue(out, iss, { all: true });\n      if (r !== null) out = r;',
    'out = out.split(iss.text).join(iss.suggestion);', 'scrub-split-join');
} else if (MUTATION === 'prompt-old-corpse') {
  riskSource = mustReplace(riskSource, "{ id: 'ศพ', find: 'ศพ', to: 'ร่างผู้เสียชีวิต',", "{ id: 'ศพ', find: 'ศพ', to: 'ร่างผู้เสียหาย',", 'prompt-old-corpse');
}

const graph = await importPatchedGraph({
  riskWords: { source: riskSource, originalUrl: srcUrl('../src/lib/ai/riskWords.js') },
  safetyFilter: { source: filterSource, originalUrl: srcUrl('../src/lib/ai/safetyFilter.js'), links: { './riskWords.js': 'riskWords' } },
  audit: { source: auditSource, originalUrl: srcUrl('../src/lib/correction/outputAuditService.js'), links: { '../ai/safetyFilter.js': 'safetyFilter', '../ai/riskWords.js': 'riskWords' } },
  correct: { source: correctSource, originalUrl: srcUrl('../src/lib/correction/safeCorrectionService.js'), links: { '../ai/safetyFilter.js': 'safetyFilter', '../ai/riskWords.js': 'riskWords' } },
  rollbackScrub: { source: rollbackScrubSource, originalUrl: srcUrl('../src/lib/correction/rollbackScrub.js'), links: { '../ai/safetyFilter.js': 'safetyFilter', '../ai/riskWords.js': 'riskWords' } }, // ★ S4
});
const rw = graph.riskWords;
const { sanitizeOutput, findRiskWords, replaceRiskWordIssue, scanRiskRules } = graph.safetyFilter;
const { auditOutput } = graph.audit;
const { safeCorrect, guardCoreNews } = graph.correct;
const forbidden = async (content) => (await quiet(() => auditOutput({ content }))).issues.filter((i) => i.type === 'forbidden_word');
const aiFail = () => { globalThis.__S2_AI__ = async () => { throw new Error('mock-ai-down'); }; };
const aiEcho = () => { globalThis.__S2_AI__ = async (args) => ({ content: (args.prompt.match(/=== เนื้อหา ===\n([\s\S]*?)\n=== จบ ===/u) || [])[1] || '' }); };
aiFail();

// ── ท่อ correction จริง (ตัดฟังก์ชันจากซอร์ส — แบบเดียวกับ tests/correction-fact-stability) · ด่าน AI อื่นเป็น stub ผ่าน ──
const factSource = readSrc('../src/lib/correction/factPreservationCheck.js');
const checkFactPreservation = new Function(`${factSource.replace('export function checkFactPreservation', 'function checkFactPreservation')}\nreturn checkFactPreservation;`)();
const pipelineStart = pipelineSource.indexOf('export async function runCorrectionPipeline');
assert.ok(pipelineStart >= 0, 'ต้องหา runCorrectionPipeline ในซอร์สจริงได้');
const runCorrectionPipeline = new Function(
  'auditOutput', 'safeCorrect', 'guardCoreNews', 'checkFactPreservation', 'editorialPolish', 'semanticSanityCheck', 'fabricationGate', 'bbStep',
  'isRiskWordsLegacy', 'replaceRiskWordIssue', 'isL45Legacy', 'scrubHallucinatedPlaces', 'isCorrRollbackLegacy', 'scrubRollbackContent',
  `${pipelineSource.slice(pipelineStart).replace('export async function runCorrectionPipeline', 'async function runCorrectionPipeline')}\nreturn runCorrectionPipeline;`,
)(
  auditOutput, safeCorrect, guardCoreNews, checkFactPreservation,
  (content) => ({ polishedContent: content, changes: [] }),
  async (content) => ({ sanitizedContent: content, issuesFound: [], fixed: false }),
  async (content) => ({ content, debug: { sus: 0, confirmed: 0, fixed: false } }),
  () => {},
  rw.isRiskWordsLegacy, replaceRiskWordIssue, isL45Legacy, scrubHallucinatedPlaces,
  graph.rollbackScrub.isCorrRollbackLegacy, graph.rollbackScrub.scrubRollbackContent, // ★ S4: โมดูลในกราฟเดียวกัน
);
const runPipeline = (content, newsBody) => quiet(() => withEnv('SKIP_CORRECTION', undefined, async () => (await runCorrectionPipeline([{ content, style: 's2' }], { newsBody: newsBody || content }, {}))[0]));

// ═══ A) สวิตช์ถอย ═══
test('A1 ค่าสวิตช์ RISK_WORDS_LEGACY: 1/true/on/yes/legacy (ทนช่องว่าง/อัญประกาศ/ตัวพิมพ์) = ถอย · ไม่ตั้ง/0/off/false/ค่าอื่น = ตารางกลาง', async () => {
  for (const v of ['1', 'true', 'on', 'yes', 'legacy', ' 1 ', '"1"', 'TRUE', 'Legacy']) {
    await withEnv('RISK_WORDS_LEGACY', v, () => assert.equal(rw.isRiskWordsLegacy(), true, `ต้องถอย: ${JSON.stringify(v)}`));
  }
  for (const v of [undefined, '', '0', 'off', 'false', 'no', 'new', '2']) {
    await withEnv('RISK_WORDS_LEGACY', v, () => assert.equal(rw.isRiskWordsLegacy(), false, `ต้องใหม่: ${JSON.stringify(v)}`));
  }
});

// ═══ B) ตารางกลาง ═══
test('B1 โครงตาราง: id ไม่ซ้ำ · find xor pattern(g) · to เป็นสตริง · severity high|medium · กฎ aiRewrite ยาวไม่เกินเพดานแทนตรงของ L3B (12)', () => {
  const ids = new Set();
  for (const rule of rw.RISK_RULES) {
    assert.ok(rule.id && !ids.has(rule.id), `id ซ้ำ/ว่าง: ${rule.id}`);
    ids.add(rule.id);
    assert.ok(!!rule.find !== !!rule.pattern, `${rule.id}: ต้องมี find หรือ pattern อย่างเดียว`);
    if (rule.pattern) assert.ok(rule.pattern.global && rule.test instanceof RegExp && !rule.test.global, `${rule.id}: pattern ต้องมี g และ test ไม่มี g`);
    assert.equal(typeof rule.to, 'string', `${rule.id}: to ต้องเป็นสตริง`);
    assert.ok(['high', 'medium'].includes(rule.severity), `${rule.id}: severity`);
    if (rule.aiRewrite && rule.find) assert.ok(rule.find.length <= 12, `${rule.id}: กฎ AI-rewrite ต้อง ≤ 12 ตัวอักษร (L3B_DIRECT_REPLACE_MAX)`);
  }
  assert.ok(rw.RISK_RULES.length >= 70);
  assert.equal(rw.getRiskRule('อาวุธ').nextBlock?.includes('ปืน'), true, 'กฎ อาวุธ ต้องยกเว้น "อาวุธปืน" (คำแทนมาตรฐานของ ยิง)');
  assert.equal(rw.getRiskRule('ไม่มีกฎนี้'), null);
});

test('B2 ตาราง "ปิด": คำแทนทุกกฎ + สำนวนทางเลือกในพรอมต์ เอาไปสแกนด้วยกฎทั้งชุด audit แล้วต้องไม่ถูกจับซ้ำ (หัวใจ OV-01)', () => {
  const candidates = [...new Set([...rw.RISK_RULES.map((r) => r.to).filter(Boolean), ...rw.promptAlternatives()])];
  assert.ok(candidates.length >= 40);
  for (const phrase of candidates) {
    const hits = findRiskWords(`ข่าว ${phrase} ต่อ`).concat(findRiskWords(phrase));
    assert.deepEqual(hits.map((h) => `${h.rule.id}:${h.text}`), [], `คำแทน "${phrase}" ถูกกฎจับซ้ำ`);
  }
});

test('B3 ชุด sanitize ของตารางกลาง = WORD_RULES ของ S1 ในตัวกรอง ทุกข้อ ทุกลำดับ — ต่างได้จุดเดียวที่จดไว้ (โหด nextBlock + ร้อน จาก L2)', () => {
  const literal = (filterSource.match(/\nconst WORD_RULES = (\[[\s\S]*?\n\]);\n/u) || [])[1];
  assert.ok(literal, 'ต้องหา WORD_RULES ในตัวกรองได้');
  const s1 = new Function(`return ${literal};`)().slice().sort((a, b) => b.find.length - a.find.length);
  const DOCUMENTED_DELTA = { 'โหด': { nextBlock: ['สัส', 'ร้อน'] } }; // ★ ความต่างที่ตั้งใจ (คอมเมนต์ในตารางกลาง/ตัวกรอง)
  const keys = ['find', 'to', 'needsBoundary', 'prevBlock', 'nextBlock', 'onNegation', 'onAttempt', 'afterNumberTo'];
  const pick = (r) => Object.fromEntries(keys.filter((k) => k in r).map((k) => [k, r[k]]));
  const expected = s1.map((r) => ({ ...pick(r), ...(DOCUMENTED_DELTA[r.find] || {}) }));
  assert.deepEqual(rw.riskRulesForStage('sanitize').map(pick), expected);
  assert.equal(rw.riskRulesForStage('sanitize').length, s1.length);
});

test('B4 ตัวกรอง: ค่าเริ่มต้น (ตารางกลาง) กับ RISK_WORDS_LEGACY=1 (WORD_RULES S1) ให้ผลเท่ากันทุกไบต์บนคลังตัวอย่าง', async () => {
  const corpus = [
    'ตำรวจพบศพชายวัย 35 ถูกฆ่าในบ้านพัก ญาติเชื่อเป็นคดีฆาตกรรม', 'พบผู้เสียชีวิต 3 ศพ ในรถยนต์ คนร้ายขู่ฆ่าแล้วยิงตายคาที่อย่างสยองขวัญ',
    'ชายวัย 40 ผูกคอแต่เพื่อนบ้านช่วยไว้ทัน', 'หญิงสาวพยายามฆ่าตัวตายแต่ญาติช่วยทัน เธอบอกว่าไม่อยากตาย', 'สวดพระอภิธรรมพระศพ ถวายพระเพลิงพระบรมศพ',
    'แรงงานจากประเทศพม่า สภาพอากาศพรุ่งนี้ ประกาศพื้นที่เฝ้าระวัง', 'ฉีดยาฆ่าเชื้อ ยาฆ่าแมลง นั่งฆ่าเวลา นักฆ่ารับจ้าง', 'สั่งพิมพ์ 10 เล่ม พิมพ์ 1 ถ้าเห็นด้วย เมนต์ 99 รับสิทธิ์',
    'รายการ "คดีฆาตกรรมที่โลกลืม" โหดสัสมาก โหดร้าย โหดเหี้ยม', 'เขากระโดดตึกแต่รอด กระโดดตึกตาย ขู่จบชีวิตตัวเอง', { a: 'ข่มขืนแล้วทุบตี', b: ['เลือดสาด', 'แชร์ด่วน คุณจะไม่เชื่อ'] },
  ];
  for (const s of corpus) {
    const a = await fresh(() => sanitizeOutput(s));
    const b = await legacy(() => sanitizeOutput(s));
    assert.deepEqual(a, b, `ตัวกรองสองโหมดต้องเท่ากัน: ${JSON.stringify(s)}`);
  }
});

// ═══ C) OV-01: ตัวกรอง → L2 → L3 ไม่แทนซ้ำ ═══
const OV01 = 'ชายวัย 40 ปี ถูกยิงตายหน้าบ้าน ขณะกำลังเปิดประตูรั้ว เพื่อนบ้านได้ยินเสียงดังสองครั้งก่อนวิ่งออกมาดู';
test('C1 ค่าเริ่มต้น: ยิงตาย → ใช้อาวุธปืนจนเสียชีวิต → L2 ไม่จับ "อาวุธ" → safeCorrect คืนเนื้อเดิมไม่แตะ', async () => {
  await fresh(async () => {
    const post = sanitizeOutput(OV01);
    assert.match(post, /ถูกใช้อาวุธปืนจนเสียชีวิตหน้าบ้าน/u);
    assert.deepEqual(await forbidden(post), [], 'L2 ต้องไม่จับคำแทนที่ตัวกรองสร้างเอง');
    const r = await quiet(async () => safeCorrect(post, (await auditOutput({ content: post })).issues));
    assert.equal(r.correctedContent, post);
    assert.doesNotMatch(r.correctedContent, /สิ่งของอันตราย/u);
  });
});

test('C2 โหมดถอย RISK_WORDS_LEGACY=1: บั๊กเดิมทำซ้ำได้ — L2 จับ "อาวุธ" แล้ว L3A แทนเป็น "ใช้สิ่งของอันตรายปืนจนเสียชีวิต"', async () => {
  await legacy(async () => {
    const post = sanitizeOutput(OV01);
    const issues = await forbidden(post);
    assert.deepEqual(issues.map((i) => [i.text, i.suggestion]), [['อาวุธ', 'สิ่งของอันตราย']]);
    const r = await quiet(() => safeCorrect(post, issues));
    assert.match(r.correctedContent, /ถูกใช้สิ่งของอันตรายปืนจนเสียชีวิต/u);
    assert.equal(issues[0].ruleId, undefined, 'issue โหมดถอยไม่มี ruleId (รูปเดิม)');
  });
});

test('C3 เส้นทางพรอมต์นักเขียน ("ยิง" → "ใช้อาวุธปืน" โดยไม่ผ่านตัวกรอง): ค่าเริ่มต้นไม่แตะ · โหมดถอยพัง · ยิงเดี่ยวยังถูกแทนด้วยคำแทนมาตรฐาน', async () => {
  const text = 'คนร้ายใช้อาวุธปืนก่อเหตุหน้าร้านสะดวกซื้อ ก่อนหลบหนีไปพร้อมรถจักรยานยนต์คันหนึ่งอย่างรวดเร็ว';
  await fresh(async () => {
    assert.deepEqual(await forbidden(text), []);
    const mixed = 'คนร้ายใช้อาวุธปืนยิงชายวัย 40 ปีจนได้รับบาดเจ็บ ก่อนหลบหนีไปพร้อมรถจักรยานยนต์คันหนึ่งอย่างรวดเร็ว';
    const issues = await forbidden(mixed);
    assert.deepEqual(issues.map((i) => i.text), ['ยิง']);
    const r = await quiet(() => safeCorrect(mixed, issues));
    assert.doesNotMatch(r.correctedContent, /สิ่งของอันตราย/u);
    assert.match(r.correctedContent, /ปืนใช้อาวุธปืนชาย/u);
  });
  await legacy(async () => {
    const r = await quiet(async () => safeCorrect(text, await forbidden(text)));
    assert.match(r.correctedContent, /ใช้สิ่งของอันตรายปืน/u);
  });
});

// ═══ D) PL-04: แทนคำตรงตำแหน่งที่กฎจับ ═══
const PL04 = {
  A: 'เธอเคยคิดทำร้ายตัวเองมาก่อน แต่วันนี้กลับมีคนพยายามทำร้ายแม่ของเธอถึงหน้าบ้านจนเพื่อนบ้านต้องเข้ามาห้าม',
  B: 'เด็กชายยิงประตูชัยให้ทีมโรงเรียนในนาทีสุดท้าย ก่อนคืนนั้นคนร้ายยิงใส่บ้านของเขาจนกระจกแตกทั้งบาน',
  C: 'แพทย์ระบุว่าโรคเส้นเลือดในสมองของเขาเป็นมานาน ต่อมาญาติพบว่ามีเลือดออกที่พื้นห้องนอนเป็นจำนวนมาก',
  D: 'ระดับน้ำในคลองสูงขึ้นทุกชั่วโมง ชาวบ้านบอกว่าความหวังดับลงเมื่อเห็นบ้านจมไปทั้งหลังในคืนนั้น',
};
test('D1 ค่าเริ่มต้น L3A (แทนตรง): ทำร้ายตัวเอง/ยิงประตู คงเดิม — แทนเฉพาะตำแหน่งที่ L2 จับ · โหมดถอยโดนตำแหน่งแรก', async () => {
  await fresh(async () => {
    const a = await quiet(async () => safeCorrect(PL04.A, await forbidden(PL04.A)));
    assert.equal(a.correctedContent, PL04.A.replace('พยายามทำร้ายแม่', 'พยายามใช้ความรุนแรงแม่'));
    assert.match(a.correctedContent, /ทำร้ายตัวเอง/u);
    const b = await quiet(async () => safeCorrect(PL04.B, await forbidden(PL04.B)));
    assert.equal(b.correctedContent, PL04.B.replace('คนร้ายยิงใส่บ้าน', 'คนร้ายใช้อาวุธปืนใส่บ้าน'));
    assert.match(b.correctedContent, /ยิงประตูชัย/u);
    assert.deepEqual(await forbidden('เด็กชายยิงประตูชัยให้ทีมโรงเรียนในนาทีสุดท้าย ก่อนทั้งทีมจะวิ่งเข้ากอดกันกลางสนามด้วยความดีใจ'), [], 'ข่าวกีฬาต้องไม่มี issue เลย');
  });
  await legacy(async () => {
    const a = await quiet(async () => safeCorrect(PL04.A, await forbidden(PL04.A)));
    assert.match(a.correctedContent, /คิดใช้ความรุนแรงตัวเอง/u);
    assert.match(a.correctedContent, /พยายามทำร้ายแม่/u, 'โหมดถอย: คำเสี่ยงตัวจริงยังอยู่');
    const b = await quiet(async () => safeCorrect(PL04.B, await forbidden(PL04.B)));
    assert.match(b.correctedContent, /ใช้อาวุธปืนประตูชัย/u);
  });
});

test('D2 ค่าเริ่มต้น L3B ล้ม → แทนสั้นตรงตำแหน่งที่กฎจับ: เส้นเลือด/ระดับ คงเดิม · โหมดถอยได้ "เส้นร่องรอยเหตุการณ์" / "ระจากไปน้ำ"', async () => {
  aiFail();
  await fresh(async () => {
    const c = await quiet(async () => safeCorrect(PL04.C, await forbidden(PL04.C)));
    assert.equal(c.correctedContent, PL04.C.replace('มีเลือดออก', 'มีร่องรอยเหตุการณ์ออก'));
    assert.match(c.correctedContent, /เส้นเลือดในสมอง/u);
    const d = await quiet(async () => safeCorrect(PL04.D, await forbidden(PL04.D)));
    assert.equal(d.correctedContent, PL04.D.replace('ความหวังดับลง', 'ความหวังจากไปลง'));
    assert.match(d.correctedContent, /ระดับน้ำ/u);
  });
  await legacy(async () => {
    const c = await quiet(async () => safeCorrect(PL04.C, await forbidden(PL04.C)));
    assert.match(c.correctedContent, /เส้นร่องรอยเหตุการณ์ในสมอง/u);
    assert.match(c.correctedContent, /มีเลือดออก/u);
    const d = await quiet(async () => safeCorrect(PL04.D, await forbidden(PL04.D)));
    assert.match(d.correctedContent, /ระจากไปน้ำ/u);
  });
});

test('D3 ท่อจริง rollback scrub: L3B ทำเลขหาย → ย้อนต้นฉบับ → scrub แทน "ดับ" ทุกตำแหน่งที่กฎจับ — "ตามลำดับ" คงเดิม · โหมดถอยได้ "ตามลำจากไป"', async () => {
  // ไม่ใส่คำสถานที่ (ซอย/ถนน) หน้า "ตามลำดับ" — ด่าน L4.5 (ล้างสถานที่หลอน) ของท่อจะกินท่อนที่ scrub โหมดถอยทำเพี้ยนไปทั้งท่อน (บั๊กแยก นอกขอบเขต S2)
  const src = 'บ้านเลขที่ 45 อยู่ท้ายหมู่บ้าน ทีมกู้ภัยเข้าช่วยเหลือตามลำดับ ก่อนพบว่าชายวัย 40 ปีดับในที่เกิดเหตุ อีกคนดับที่โรงพยาบาลในคืนเดียวกัน';
  globalThis.__S2_AI__ = async () => ({ content: src.replace('บ้านเลขที่ 45 ', 'บ้านหลังหนึ่ง ').replace(/ดับ(?=ใน|ที่)/gu, 'จากไป') });
  try {
    await fresh(async () => {
      const r = await runPipeline(src);
      assert.equal(r._correctionDebug.path, 'rollback', 'เลข 45 หาย → ต้องย้อนต้นฉบับ');
      assert.equal(r._correctionDebug.rollbackScrub?.error, undefined);
      assert.equal(r._correctionDebug.rollbackScrub?.forbiddenScrubbed, 2, 'reAudit เจอ ดับ 2 ตำแหน่ง (เหมือนเดิม) — ตัวแรกแทนทั้งหมด ตัวสองไม่เหลืออะไรให้แทน');
      assert.match(r.content, /ตามลำดับ/u, 'ค่าเริ่มต้น: ลำดับ ต้องไม่โดน');
      assert.match(r.content, /ปีจากไปในที่เกิดเหตุ อีกคนจากไปที่โรงพยาบาล/u, 'scrub ต้องแทนทุกตำแหน่งที่กฎจับจริง');
      assert.match(r.content, /45/u);
    });
    await legacy(async () => {
      const r = await runPipeline(src);
      assert.equal(r._correctionDebug.path, 'rollback');
      assert.match(r.content, /ตามลำจากไป/u, 'โหมดถอย: split/join เดิมโดน ลำดับ');
    });
  } finally { aiFail(); }
});

test('D4 replaceRiskWordIssue: ไม่มี ruleId/กฎไม่รู้จัก/กฎไม่จับ → null (caller คงเนื้อเดิม ไม่ถอยไป replace ตำแหน่งแรก) · all=true แทนทุกตำแหน่ง', () => {
  assert.equal(replaceRiskWordIssue('ทำร้ายแม่', { text: 'ทำร้าย', suggestion: 'x' }), null);
  assert.equal(replaceRiskWordIssue('ทำร้ายแม่', { ruleId: 'ไม่มี' }), null);
  assert.equal(replaceRiskWordIssue('เขาคิดทำร้ายตัวเอง', { ruleId: 'ทำร้าย' }), null, 'กฎยกเว้น ทำร้ายตัวเอง → ไม่แทนอะไรเลย');
  assert.equal(replaceRiskWordIssue('ยิงใส่บ้าน แล้วยิงซ้ำ ยิงประตู', { ruleId: 'ยิง' }), 'ใช้อาวุธปืนใส่บ้าน แล้วยิงซ้ำ ยิงประตู');
  assert.equal(replaceRiskWordIssue('ยิงใส่บ้าน แล้วยิงซ้ำ ยิงประตู', { ruleId: 'ยิง' }, { all: true }), 'ใช้อาวุธปืนใส่บ้าน แล้วใช้อาวุธปืนซ้ำ ยิงประตู');
  assert.equal(replaceRiskWordIssue('', { ruleId: 'ยิง' }), null);
});

// ═══ E) L2 ใช้กติกาเดียวกับตัวกรอง ═══
test('E1 ค่าเริ่มต้น L2 ไม่จับกลางคำ/ชื่อคน/ชื่อเรื่องในเครื่องหมายคำพูด/ไม่อยากตาย · โหมดถอยจับ (แล้ว L3A พังเป็น "ประเทร่างผู้เสียหายม่า")', async () => {
  const geo = 'แรงงานจากชายแดนประเทศพม่าเดินทางเข้ามาทำงานในจังหวัดตาก โดยนายทศพลเป็นผู้ประสานงานให้ทั้งหมดตลอดสัปดาห์นี้';
  await fresh(async () => {
    assert.deepEqual(await forbidden(geo), []);
    assert.deepEqual(await forbidden('รายการ "คดีฆาตกรรมที่โลกลืม" ออกอากาศคืนนี้ทางช่องหลัก พร้อมแขกรับเชิญพิเศษหลายคนที่มาร่วมพูดคุยกัน'), []);
    assert.deepEqual((await forbidden('เธอบอกกับทุกคนว่าเธอไม่อยากตาย เพราะยังอยากอยู่ดูลูกโตไปอีกหลายปีข้างหน้า')).map((i) => i.text), []);
    assert.deepEqual((await forbidden('เขาบอกกับทุกคนว่าเขาอยากตาย เพราะทนความเจ็บปวดไม่ไหวอีกแล้ว')).map((i) => i.text), ['อยากตาย']);
  });
  await legacy(async () => {
    const issues = await forbidden(geo);
    assert.deepEqual(issues.map((i) => i.text), ['ศพ', 'ศพ']);
    const r = await quiet(() => safeCorrect(geo, issues));
    assert.match(r.correctedContent, /ประเทร่างผู้เสียหายม่า/u);
    assert.deepEqual((await forbidden('เธอบอกกับทุกคนว่าเธอไม่อยากตาย เพราะยังอยากอยู่ดูลูกโตไปอีกหลายปีข้างหน้า')).map((i) => i.text), ['ตาย']);
  });
});

test('E2 กฎยาวชนะกฎสั้น + issue มี ruleId/aiRewrite/start/end + location นับจากตำแหน่งจริง (เดิม indexOf ตำแหน่งแรก)', async () => {
  await fresh(async () => {
    const raw = await forbidden('เพื่อนบ้านตะโกนบอกทุกคนว่าเขาถูกยิงตายแล้วจริงๆ ก่อนที่ทุกคนจะวิ่งหนีออกจากซอยไปด้วยความตกใจ');
    assert.deepEqual(raw.map((i) => [i.text, i.suggestion, i.severity, i.ruleId, i.aiRewrite]), [['ยิงตาย', 'ใช้อาวุธปืนจนเสียชีวิต', 'high', 'ยิงตาย', false]]);
    assert.equal(typeof raw[0].start, 'number');
    assert.equal(raw[0].end - raw[0].start, 'ยิงตาย'.length);
    const two = await forbidden('ย่อหน้าแรกเล่าว่าเขาเคยคิดทำร้ายตัวเองมาก่อนในช่วงที่เครียดหนัก\n\nย่อหน้าสองบอกว่ามีคนพยายามทำร้ายแม่ของเขา');
    assert.deepEqual(two.map((i) => [i.text, i.location]), [['ทำร้าย', 1]], 'location ต้องเป็นย่อหน้าที่ 2 (index 1)');
    const death = await forbidden('ชายคนนั้นตายในที่เกิดเหตุ ส่วนภรรยาบาดเจ็บสาหัสถูกนำส่งโรงพยาบาลใกล้เคียงทันที');
    assert.deepEqual(death.map((i) => [i.text, i.aiRewrite]), [['ตาย', true], ['บาดเจ็บสาหัส', false]], 'issue เรียงตามตำแหน่งในเนื้อ (ตาย มาก่อน)');
  });
  await legacy(async () => {
    const raw = await forbidden('เพื่อนบ้านตะโกนบอกทุกคนว่าเขาถูกยิงตายแล้วจริงๆ ก่อนที่ทุกคนจะวิ่งหนีออกจากซอยไปด้วยความตกใจ');
    assert.deepEqual(raw.map((i) => i.text).sort(), ['ยิง'], 'โหมดถอย: กฎ ตาย เดิมมี (?!แล้ว) จึงเหลือ ยิง');
    const two = await forbidden('ย่อหน้าแรกเล่าว่าเขาเคยคิดทำร้ายตัวเองมาก่อนในช่วงที่เครียดหนัก\n\nย่อหน้าสองบอกว่ามีคนพยายามทำร้ายแม่ของเขา');
    assert.deepEqual(two.map((i) => [i.text, i.location]), [['ทำร้าย', 0]], 'โหมดถอย: location ผิดย่อหน้า (indexOf ตำแหน่งแรก)');
  });
});

test('E3 เส้นทาง L3: aiRewrite จากตาราง → ส่ง AI เกลา (ai_context_rewrite) · แทนตรง → regex_replace · issue ทำมือไม่มีธง → รายการ needsAIRewrite เดิม', async () => {
  aiEcho();
  try {
    await fresh(async () => {
      const text = 'ชายคนนั้นตายในที่เกิดเหตุหลังถูกคนร้ายยิงจากด้านหลังขณะเดินกลับบ้านในคืนที่ฝนตกหนักมาก';
      const r = await quiet(async () => safeCorrect(text, await forbidden(text)));
      assert.deepEqual(r.corrections.map((c) => c.type).sort(), ['ai_context_rewrite', 'regex_replace']);
      const hand = await quiet(() => safeCorrect('พบเลือดบนพื้นถนนหน้าบ้านของเขาในตอนเช้าตรู่ของวันจันทร์ที่ผ่านมา', [{ type: 'forbidden_word', text: 'เลือด', suggestion: 'ร่องรอยเหตุการณ์', severity: 'medium' }]));
      assert.ok(hand.corrections.some((c) => c.type === 'ai_context_rewrite'), 'ไม่มีธง aiRewrite → ใช้รายการเดิม (เลือด = AI)');
    });
  } finally { aiFail(); }
});

// ═══ F) พรอมต์: client จริง 3 ตัว (SDK ปลอม) + promptStore + summarizeService ═══
const LEGACY_SYSTEM_LINES = 'ห้ามใช้คำเสี่ยง: ฆ่า, ศพ, สยอง, โหด, เลือด, ข่มขืน, ผูกคอ, ดับสลด, บาดเจ็บสาหัส, สะเก็ดระเบิด, ระเบิด, สนามรบ, คลิปหลุด, อาวุธ, กระสุน, เลือดสาด, ฆ่าตัวตาย\n'
  + 'ใช้แทน: จากไป, ร่างผู้เสียหาย, น่าตกใจ, รุนแรง, ร่องรอยเหตุการณ์, ล่วงละเมิดทางเพศ, จากไปอย่างน่าเศร้า, ได้รับบาดเจ็บหนัก, เหตุการณ์ไม่คาดฝัน, พื้นที่ปฏิบัติหน้าที่';
const LEGACY_OPENAI_HEAD = '[ความรุนแรง] ห้ามใช้: ฆ่า, ยิงหัว, ปาดคอ, หั่นศพ, เลือดสาด, ศพ, สยอง, โหด, คว้านท้อง, ไลฟ์ตาย, ดับสลด\n→ ใช้แทน: ทำร้ายจนเสียชีวิต, เหตุรุนแรง, ร่างผู้เสียชีวิต, เหตุสะเทือนใจ, เหตุไม่คาดคิด';
const LEGACY_OPENAI_TAIL = '[Engagement Bait] ห้ามใช้: พิมพ์ 1, เมนต์ 99, แชร์วนไป, ใครเห็นด้วยกดไลก์\n→ ใช้แทน: คุณคิดเห็นยังไง, ถ้าเป็นคุณจะ..., มองเรื่องนี้ยังไง';

test('F1 renderers: ค่าเริ่มต้นจับคู่คำ→คำแทนจากตารางเดียว (ศพ→ร่างผู้เสียชีวิต ทุกจุด) + ข้อยกเว้น อาวุธปืน/ศัพท์แพทย์ · ไม่มีคำแทนเก่าที่ขัดกัน', () => {
  const sys = rw.renderSystemSafetyLines();
  assert.match(sys, /ศพ→ร่างผู้เสียชีวิต/u);
  assert.match(sys, /อาวุธ→สิ่งของอันตราย/u);
  assert.match(sys, /"อาวุธปืน" \(คำแทนมาตรฐานของ "ยิง"\) ใช้ได้/u);
  assert.match(sys, /เส้นเลือด/u);
  assert.doesNotMatch(sys, /ร่างผู้เสียหาย|ร่างของผู้จากไป/u);
  for (const rule of rw.RISK_RULES.filter((r) => r.core)) assert.ok(sys.includes(`${rule.find}→${rule.to}`), `system ต้องมีคู่ ${rule.find}`);
  const openai = rw.renderOpenAISafetyBlock();
  for (const label of ['[ความรุนแรง]', '[Self-harm]', '[Sexual/18+]', '[การพนัน]', '[ยาเสพติด]', '[Hate Speech]', '[Fake News]', '[Clickbait]', '[Engagement Bait]']) assert.ok(openai.includes(label), label);
  assert.match(openai, /ศพ→ร่างผู้เสียชีวิต/u);
  assert.match(openai, /ยิงหัว, ปาดคอ, หั่นศพ/u, 'คำเฉพาะพรอมต์ยังอยู่ครบ');
  const writer = rw.renderWriterSafetyLines('text');
  assert.match(writer, /"ศพ" → "ร่างผู้เสียชีวิต"/u);
  assert.match(writer, /"ฆ่า" → "ทำให้เสียชีวิต" หรือ "ก่อเหตุ"/u);
  assert.match(writer, /"ยิง" → "ใช้อาวุธปืน" \(คำว่า "อาวุธปืน"/u);
  assert.match(writer, /"ผูกคอ" → "ทำร้ายตัวเอง"/u);
  assert.match(writer, /16 ก\.ค\. 69: เลิกแบน "เสียชีวิต"/u, 'บรรทัดนโยบาย ตาย/ดับ ของสาย TEXT คงอยู่');
  assert.match(writer, /"จัดฉาก" → "สร้างสถานการณ์"\n\n$/u);
  assert.match(rw.renderWriterSafetyLines('url'), /"ตาย\/ดับ\/สิ้นใจ\/เสียชีวิต" → ห้ามใช้ตรงๆ ทุกคำ/u, 'สาย URL คงนโยบายเดิมของตัวเอง');
  assert.match(rw.renderWriterSafetyShortLine('text'), /^ห้ามใช้คำเสี่ยง: ฆ่า→ทำให้เสียชีวิต, ศพ→ร่างผู้เสียชีวิต, .*\n$/u);
  assert.match(rw.renderWriterSafetyShortLine('url'), /ปิดตำนาน/u);
  assert.deepEqual(rw.renderPresetRewriteLines().slice(0, 4), ['- ฆ่าตัวตาย → จากไปอย่างน่าเศร้า', '- เลือดสาด → เหตุรุนแรง', '- แทง → ใช้ของมีคม', '- คลิปหลุด → คลิปที่แพร่ออกมา']);
  assert.match(rw.renderPresetBanLine(), /^ห้ามใช้คำเสี่ยง: ด่วน, ดูก่อนโดนลบ, .*อาวุธปืน/u);
});

test('F2 renderers โหมดถอย: ทุกตัวคืนข้อความเดิมที่ไฟล์ส่งมา (อ้างอิงเดิม) · ค่าเริ่มต้นคืนของใหม่', async () => {
  const legacyLines = ['- a', '- b'];
  await legacy(() => {
    assert.equal(rw.riskPromptSystemLines('OLD-SYS'), 'OLD-SYS');
    assert.equal(rw.riskPromptOpenAIBlock('OLD-OPENAI'), 'OLD-OPENAI');
    assert.equal(rw.riskPromptWriterLines('text', 'OLD-WRITER'), 'OLD-WRITER');
    assert.equal(rw.riskPromptWriterShortLine('url', 'OLD-SHORT'), 'OLD-SHORT');
    assert.equal(rw.riskPromptPresetRewriteLines(legacyLines), legacyLines);
    assert.equal(rw.riskPromptPresetBanLine('OLD-BAN'), 'OLD-BAN');
  });
  await fresh(() => {
    assert.equal(rw.riskPromptSystemLines('OLD-SYS'), rw.renderSystemSafetyLines());
    assert.equal(rw.riskPromptWriterLines('url', 'OLD-WRITER'), rw.renderWriterSafetyLines('url'));
    assert.notEqual(rw.riskPromptPresetBanLine('OLD-BAN'), 'OLD-BAN');
  });
});

function replaceBlock(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error('หา block ไม่เจอ: ' + label);
  return source.slice(0, start) + replacement + source.slice(end + 2);
}
const stubCommon = (src) => src
  .replace("import { logApiUsage } from './usageLogger';", 'const logApiUsage = () => {};')
  .replace(/import \{ ironRule5LengthLine, legacyLengthRule \}[^\n]*\n/u, "const ironRule5LengthLine = () => ''; const legacyLengthRule = () => '';\n")
  .replace(/import \{ preparePipelineSignal, rethrowPipelineDeadline \}[^\n]*\n/u, 'const preparePipelineSignal = (signal) => signal; const rethrowPipelineDeadline = () => {};\n')
  .replace("import { sanitizeOutput } from './safetyFilter';", "import { sanitizeOutput } from './safetyFilter.js';"); // ตัวกรอง/ตารางจริง ไม่ stub

async function loadClients() {
  let openaiSrc = stubCommon(readSrc('../src/lib/ai/openai.js'))
    .replace("import OpenAI from 'openai';", 'class OpenAI {}')
    .replace("import { MODEL_PRIMARY } from './modelConfig.js';", "const MODEL_PRIMARY = 'gpt-5.6-sol';");
  openaiSrc = replaceBlock(openaiSrc, 'export function getOpenAIClient() {', '\n}\n\n/**\n * เรียก AI',
    "export function getOpenAIClient() { return { chat: { completions: { create: async (body) => { globalThis.__S2_SYS__ = body.messages[0].content; return { choices: [{ message: { content: '{\"ok\":1}' } }], usage: {} }; } } } }; }", 'openai client');
  let claudeSrc = stubCommon(readSrc('../src/lib/ai/claudeClient.js')).replace("import Anthropic from '@anthropic-ai/sdk';", 'class Anthropic {}');
  claudeSrc = replaceBlock(claudeSrc, 'function getClaudeClient() {', '\n}\n\n/**\n * เรียก Claude',
    "function getClaudeClient() { return { messages: { create: async (body) => { globalThis.__S2_SYS__ = body.system; return { stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: '{\"ok\":1}' }] }; } } }; }", 'claude client');
  let geminiSrc = stubCommon(readSrc('../src/lib/ai/geminiClient.js')).replace("import { GoogleGenerativeAI } from '@google/generative-ai';", 'class GoogleGenerativeAI {}');
  geminiSrc = replaceBlock(geminiSrc, 'function getGeminiClient() {', '\n}\n\n// Google SDK รับ request options',
    "function getGeminiClient() { return { getGenerativeModel: (cfg) => { globalThis.__S2_SYS__ = cfg.systemInstruction; return { generateContent: async () => ({ response: { text: () => '{\"ok\":1}', usageMetadata: {} } }) }; } }; }", 'gemini client');
  for (const [name, src] of [['openai', openaiSrc], ['claude', claudeSrc], ['gemini', geminiSrc]]) {
    if (!src.includes("from './riskWords.js'")) throw new Error(`${name}: ต้อง import จากตารางกลาง ./riskWords.js`);
  }
  const [openai, claude, gemini] = await Promise.all([
    importPatchedModule(openaiSrc, srcUrl('../src/lib/ai/openai.js'), 'openai-s2'),
    importPatchedModule(claudeSrc, srcUrl('../src/lib/ai/claudeClient.js'), 'claude-s2'),
    importPatchedModule(geminiSrc, srcUrl('../src/lib/ai/geminiClient.js'), 'gemini-s2'),
  ]);
  const capture = async (fn) => { globalThis.__S2_SYS__ = null; await fn(); return String(globalThis.__S2_SYS__); };
  return {
    openai: () => capture(() => openai.callAI({ prompt: 'x', model: 'gpt-5.6-sol', allowModelFallback: false })),
    claude: () => capture(() => claude.callClaude({ prompt: 'x', model: 'claude-opus-4-8' })),
    gemini: () => capture(() => gemini.callGemini({ prompt: 'x' })),
  };
}

test('F3 client จริง 3 ตัว: ค่าเริ่มต้น system prompt มีบรรทัดจากตารางกลาง (ไม่มี "ร่างผู้เสียหาย" · มีข้อยกเว้น อาวุธปืน) · RISK_WORDS_LEGACY=1 = บรรทัดเดิมทุกไบต์', async () => {
  const clients = await quiet(loadClients);
  const rwReal = await import('../src/lib/ai/riskWords.js');
  await fresh(async () => {
    for (const name of ['claude', 'gemini']) {
      const sys = await quiet(clients[name]);
      assert.ok(sys.includes('=== FACEBOOK SAFETY RULES ==='), `${name}: หัวบล็อกเดิมต้องอยู่`);
      assert.ok(sys.includes(rwReal.renderSystemSafetyLines()), `${name}: ต้องมีบรรทัดจากตารางกลาง`);
      assert.doesNotMatch(sys, /ร่างผู้เสียหาย/u, `${name}: คำแทนเก่าที่ขัดกับตัวกรองต้องหาย`);
      assert.ok(!sys.includes(LEGACY_SYSTEM_LINES), `${name}: ค่าเริ่มต้นต้องไม่ใช่รายการเดิม`);
      assert.match(sys, /เคส #01641/u, `${name}: บรรทัดนโยบาย "เสียชีวิต" เดิมยังอยู่`);
    }
    const oa = await quiet(clients.openai);
    assert.ok(oa.includes('=== FACEBOOK SAFETY RULES (บังคับทุกคำตอบ) ===') && oa.includes(rwReal.renderOpenAISafetyBlock()));
    assert.ok(!oa.includes(LEGACY_OPENAI_HEAD));
    assert.match(oa, /หลักการ: เปลี่ยนจาก "ความแรง"/u, 'openai: บรรทัดหลักการเดิมยังอยู่');
  });
  await legacy(async () => {
    for (const name of ['claude', 'gemini']) {
      const sys = await quiet(clients[name]);
      assert.ok(sys.includes(`=== FACEBOOK SAFETY RULES ===\n${LEGACY_SYSTEM_LINES}\n⚠️`), `${name}: โหมดถอยต้องเป็นบรรทัดเดิมทุกไบต์`);
      assert.ok(!sys.includes('ใช้คำแทนตามคู่นี้'));
    }
    const oa = await quiet(clients.openai);
    assert.ok(oa.includes(`ต้องตรวจสอบและ rewrite คำเสี่ยงทั้งหมด:\n\n${LEGACY_OPENAI_HEAD}`) && oa.includes(`${LEGACY_OPENAI_TAIL}\n\nหลักการ:`), 'openai: โหมดถอยบล็อกเดิมทุกไบต์');
    assert.ok(!oa.includes('ใช้แทนเพิ่มเติม'));
  });
});

test('F4 promptStore(Text) โหลดจริง: preset viral_fb ค่าเริ่มต้นได้บรรทัดจากตารางกลาง · RISK_WORDS_LEGACY=1 (ตอนโหลด) ได้บรรทัดเดิมทุกไบต์', async () => {
  const LEGACY_LINES = ['- ฆ่าตัวตาย → จากไปอย่างเงียบๆ', '- เลือดสาด → เหตุรุนแรง', '- แทง → ถูกทำร้าย', '- คลิปหลุด → คลิปปริศนา'];
  const LEGACY_BAN = 'ห้ามใช้คำเสี่ยง: ด่วน, ดูก่อนโดนลบ, หลุดเต็ม, ศพ, สยอง, โหด, xxx, AV, แชร์ด่วน, พิมพ์ 1, เมนต์ 99, บาดเจ็บสาหัส, สะเก็ดระเบิด, ระเบิด, สนามรบ, คลิปหลุด, อาวุธ, กระสุน, เลือดสาด, ฆ่าตัวตาย';
  for (const rel of ['../src/lib/ai/promptStoreText.js', '../src/lib/ai/promptStore.js']) {
    const src = readSrc(rel);
    assert.ok(src.includes('...riskPromptPresetRewriteLines([') && src.includes('riskPromptPresetBanLine('), `${rel}: ต้องต่อสายตารางกลาง`);
    const promptOf = async () => (await importPatchedModule(src, srcUrl(rel), 'preset-s2')).getAnalysisPreset('viral_fb').prompt;
    const now = await fresh(promptOf);
    assert.ok(now.includes('- ฆ่าตัวตาย → จากไปอย่างน่าเศร้า') && now.includes('- แทง → ใช้ของมีคม') && now.includes(LEGACY_BAN + ' (ข้อยกเว้น:'), `${rel}: ค่าเริ่มต้น`);
    assert.ok(now.includes('(10 ก.ค. 69: เดิมแบนคำนี้'), `${rel}: บรรทัดนโยบายเดิมยังอยู่`);
    for (const line of LEGACY_LINES.filter((l) => !l.includes('เลือดสาด'))) assert.ok(!now.includes(line), `${rel}: ${line} ต้องไม่อยู่ในค่าเริ่มต้น (คำแทนเปลี่ยน)`);
    assert.ok(now.includes('- เลือดสาด → เหตุรุนแรง'), `${rel}: เลือดสาด คำแทนเดิมตรงตารางอยู่แล้ว`);
    const old = await legacy(promptOf);
    assert.ok(old.includes(`ถ้ามี ให้ rewrite ด้วยภาษานุ่มลง:\n${LEGACY_LINES.join('\n')}\n- ⚠️`) && old.includes(`\n\n${LEGACY_BAN}\n\n`), `${rel}: โหมดถอยไบต์เดิม`);
  }
});

test('F5 summarizeServiceText/summarizeService: บล็อก FACEBOOK SAFETY ต่อสาย riskPromptWriterLines/ShortLine ด้วย variant ถูกสาย และคงบล็อกเดิมไว้ให้โหมดถอย', () => {
  for (const [rel, variant] of [['../src/lib/services/summarizeServiceText.js', 'text'], ['../src/lib/services/summarizeService.js', 'url']]) {
    const src = readSrc(rel);
    assert.ok(src.includes(`riskPromptWriterLines('${variant}',\n        '"ฆ่า" → "ก่อเหตุ" หรือ "ก่อเหตุร้ายแรง"\\n' +`), `${rel}: บล็อกใหญ่ต้องเรียก variant ${variant} พร้อมบล็อกเดิม`);
    assert.ok(src.includes(`'"จัดฉาก" → "สร้างสถานการณ์"\\n\\n') +\n      'หลักการ:`), `${rel}: บล็อกเดิมต้องจบครบทุกบรรทัดก่อน หลักการ`);
    assert.ok(src.includes(`riskPromptWriterShortLine('${variant}', 'ห้ามใช้คำเสี่ยง: ฆ่า→ก่อเหตุ, ศพ→ร่างของผู้จากไป,`), `${rel}: บรรทัดสั้นโหมดผสมต้องเรียก variant ${variant}`);
    assert.ok(src.includes("'=== กฎเหล็ก FACEBOOK SAFETY — บังคับทุกเวอร์ชัน ===\\n' +") && src.includes("'=== จบกฎ FACEBOOK SAFETY ===\\n\\n' +"), `${rel}: หัว/ท้ายบล็อกเดิมอยู่`);
    assert.match(src, /import \{ riskPromptWriterLines, riskPromptWriterShortLine \} from '@\/lib\/ai\/riskWords';/u);
  }
});
