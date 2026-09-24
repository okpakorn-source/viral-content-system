// 🔏 ข้อสอบ L4+ ล้างเนื้อ rollback — ขอบคำ + ข้ามกฎ suggestion ว่าง + คง engagement-bait removal (PL-05) — src/lib/correction/rollbackScrub.js + correctionPipeline.js
// ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S4 · เจ้าของอนุมัติ)
//
// สิ่งที่ล็อกไว้:
//   A. สวิตช์ CORR_ROLLBACK_LEGACY: ค่าที่รับ · =1 → บล็อกเดิมในท่อทุกไบต์ (ทำซ้ำบั๊ก: "เร่งด่วน"→"เร่ง" · bait กลับเข้าโพสต์ · split/join เมื่อ issue ไม่มี ruleId) · ไม่ตั้ง → ฉบับใหม่
//   B. โมดูล scrubRollbackContent (คำต้องห้าม): ข้ามกฎ suggestion ว่าง (ด่วน/AV/xxx เหมือน L3A) · ruleId → replaceRiskWordIssue(all) (S2) ·
//      ไม่มี ruleId → ขอบคำ Intl.Segmenter (ระดับ/ตามลำดับ/สองตายาย/เส้นเลือด คง) · RISK_WORDS_LEGACY=1 → split/join ตามสัญญา S2 · ไม่มี Intl.Segmenter = ไม่แทน
//   C. โมดูล (bait): ลบสั้น (<30) ทุกตำแหน่งบนขอบคำ + เก็บกวาดช่องว่างแบบ L3 · ในเครื่องหมายคำพูด = ไม่แตะ · ยาว ≥30 = ไม่แตะ ·
//      verify ไม่ผ่าน ("พิมพ์ 1" เลขหาย · "คุณคิดยังไง?" regex ชื่อ) = คงไว้พร้อมเหตุผล fact-gate · ไม่ส่ง verify = ลบหมด
//   D. ท่อจริง (L2/L3/guardCoreNews/checkFactPreservation/placeScrub จริง · AI เป็น stub): เคสรายงาน R7+bait / R1b / R6b ใน 3 โหมด
//      (ค่าเริ่มต้น · CORR_ROLLBACK_LEGACY=1 · +RISK_WORDS_LEGACY=1 = production ก่อนแคมเปญ) · issue ไม่มี ruleId ("ระจากไป") · debug/กล่องดำ · fail-open
//
// วิธีรัน:  node --test tests/rollback-scrub-pl05.test.mjs
// โหมดกลายพันธุ์ (พิสูจน์ว่าข้อสอบกัดจริง — เทสต้องแดง · แก้เฉพาะสำเนาในหน่วยความจำ ไม่แตะไฟล์ใน repo):
//   ROLLBACK_SCRUB_TEST_MUTATION=allow-empty-suggestion  โมดูลรับกฎ suggestion ว่างเหมือนบล็อกเดิม ("เร่งด่วน"→"เร่ง" กลับมา)
//   ROLLBACK_SCRUB_TEST_MUTATION=split-join-fallback     issue ไม่มี ruleId กลับไป split/join ("ระจากไป" กลับมา)
//   ROLLBACK_SCRUB_TEST_MUTATION=bait-restore            โมดูลเลิกลบ bait (bait กลับเข้าโพสต์)
//   ROLLBACK_SCRUB_TEST_MUTATION=no-verify               โมดูลไม่สน verify (ลบ "พิมพ์ 1" → เลขหาย → ด่านท้ายทิ้งทั้ง scrub)
//   ROLLBACK_SCRUB_TEST_MUTATION=no-legacy-switch        ท่อไม่สนสวิตช์ถอย (CORR_ROLLBACK_LEGACY=1 ไม่ได้ของเดิม)
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { importPatchedModule } from './helpers/temp-module.mjs';
import { replaceRiskWordIssue } from '../src/lib/ai/safetyFilter.js';
import { isRiskWordsLegacy } from '../src/lib/ai/riskWords.js';
import { scrubHallucinatedPlaces, isL45Legacy } from '../src/lib/correction/placeScrub.js';

const MUTATION = process.env.ROLLBACK_SCRUB_TEST_MUTATION || '';
const KNOWN_MUTATIONS = ['allow-empty-suggestion', 'split-join-fallback', 'bait-restore', 'no-verify', 'no-legacy-switch'];
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
// 3 โหมด: default = ค่าเริ่มต้นทั้งหมด · s4-legacy = CORR_ROLLBACK_LEGACY=1 (บล็อกเดิมหลัง S2) · all-legacy = +RISK_WORDS_LEGACY=1 (production ก่อนแคมเปญ)
const inMode = (mode, fn) => withEnv('CORR_ROLLBACK_LEGACY', mode === 'default' ? undefined : '1',
  () => withEnv('RISK_WORDS_LEGACY', mode === 'all-legacy' ? '1' : undefined, fn));
const quiet = async (fn) => {
  const prior = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = prior.log; console.warn = prior.warn; console.error = prior.error; }
};

// ── โหลดซอร์สจริง (โมดูล scrub · L2 audit · L3 correct — stub เฉพาะ AI/modelConfig/flagFixer · ท่อตัดฟังก์ชันจากซอร์ส) ──
let scrubSource = readSrc('../src/lib/correction/rollbackScrub.js');
let pipelineSource = readSrc('../src/lib/correction/correctionPipeline.js');
let auditSource = readSrc('../src/lib/correction/outputAuditService.js');
let correctSource = readSrc('../src/lib/correction/safeCorrectionService.js');
auditSource = mustReplace(auditSource, "import { callAI } from '@/lib/ai/openai';", "const callAI = async () => { throw new Error('AI-mock (audit ไม่ควรเรียก)'); };", 'audit stub openai');
correctSource = mustReplace(correctSource, "import { callAI } from '@/lib/ai/openai';", 'const callAI = async (args) => globalThis.__S4_AI__(args);', 'correct stub openai');
correctSource = mustReplace(correctSource, "import { MODEL_FAST } from '@/lib/ai/modelConfig';", "const MODEL_FAST = 'mock';", 'correct stub modelConfig');
correctSource = mustReplace(correctSource, "import { keyNumbersOf, hasKeyNumber } from './flagFixerService';",
  'const keyNumbersOf = () => []; const hasKeyNumber = () => true;', 'correct stub flagFixer');

if (MUTATION === 'allow-empty-suggestion') {
  scrubSource = mustReplace(scrubSource, "&& typeof issue.suggestion === 'string' && issue.suggestion.length > 0", "&& typeof issue.suggestion === 'string'", 'allow-empty 1');
  scrubSource = mustReplace(scrubSource, "if (typeof iss.suggestion === 'string' && iss.suggestion.length === 0) {", 'if (false) {', 'allow-empty 2');
} else if (MUTATION === 'split-join-fallback') {
  scrubSource = mustReplace(scrubSource, 'const r = replaceAllAtWordBoundaries(out, iss.text, iss.suggestion, scanOpts);\n      if (r !== null) out = r;',
    'out = out.split(iss.text).join(iss.suggestion);', 'split-join-fallback');
} else if (MUTATION === 'bait-restore') {
  scrubSource = mustReplace(scrubSource, "if (!iss || iss.type !== 'engagement_bait' || typeof iss.text !== 'string' || !iss.text) continue;", 'continue;', 'bait-restore');
} else if (MUTATION === 'no-verify') {
  scrubSource = mustReplace(scrubSource, 'if (verify && !verify(candidate))', 'if (false)', 'no-verify');
} else if (MUTATION === 'no-legacy-switch') {
  pipelineSource = mustReplace(pipelineSource, 'if (isCorrRollbackLegacy()) {', 'if (false) {', 'no-legacy-switch');
}

const rs = await importPatchedModule(scrubSource, srcUrl('../src/lib/correction/rollbackScrub.js'), 'rollbackScrub-under-test');
const { auditOutput } = await importPatchedModule(auditSource, srcUrl('../src/lib/correction/outputAuditService.js'), 'audit-s4');
const { safeCorrect, guardCoreNews } = await importPatchedModule(correctSource, srcUrl('../src/lib/correction/safeCorrectionService.js'), 'correct-s4');
const factSource = readSrc('../src/lib/correction/factPreservationCheck.js');
const checkFactPreservation = new Function(`${factSource.replace('export function checkFactPreservation', 'function checkFactPreservation')}\nreturn checkFactPreservation;`)();

const aiFail = () => { globalThis.__S4_AI__ = async () => { throw new Error('mock-ai-down'); }; };
// L3B "สำเร็จ" แต่เขียนเลขใหม่ (ต้นเหตุ rollback ที่สมจริงตามรายงาน) — คืนเนื้อจากพรอมต์ที่แปลงด้วย fn
const aiTransform = (fn) => { globalThis.__S4_AI__ = async (args) => ({ content: fn((args.prompt.match(/=== เนื้อหา ===\n([\s\S]*?)\n=== จบ ===/u) || [])[1] || '') }); };
aiFail();
const auditIssues = async (content) => (await quiet(() => auditOutput({ content }))).issues;
const factVerify = (original) => (candidate) => checkFactPreservation(original, candidate, {}).action !== 'rollback';

// ── ท่อ correction จริง (ตัดฟังก์ชันจากซอร์สแบบเดียวกับ tests/correction-fact-stability) · ด่าน AI อื่นเป็น stub ผ่านตรง ──
function buildPipeline({ audit = auditOutput, correct = safeCorrect, scrubFn = rs.scrubRollbackContent, legacySwitch = rs.isCorrRollbackLegacy } = {}) {
  const start = pipelineSource.indexOf('export async function runCorrectionPipeline');
  assert.ok(start >= 0, 'ต้องหา runCorrectionPipeline ในซอร์สจริงได้');
  return new Function(
    'auditOutput', 'safeCorrect', 'guardCoreNews', 'checkFactPreservation', 'editorialPolish', 'semanticSanityCheck', 'fabricationGate', 'bbStep',
    'isRiskWordsLegacy', 'replaceRiskWordIssue', 'isL45Legacy', 'scrubHallucinatedPlaces', 'isCorrRollbackLegacy', 'scrubRollbackContent',
    `${pipelineSource.slice(start).replace('export async function runCorrectionPipeline', 'async function runCorrectionPipeline')}\nreturn runCorrectionPipeline;`,
  )(
    audit, correct, guardCoreNews, checkFactPreservation,
    (content) => ({ polishedContent: content, changes: [] }),
    async (content) => ({ sanitizedContent: content, issuesFound: [], fixed: false }),
    async (content) => ({ content, debug: { sus: 0, confirmed: 0, fixed: false } }),
    (arr, layer, before, after, extra = {}) => arr.push({ layer, changed: before !== after, before, after, ...extra }),
    isRiskWordsLegacy, replaceRiskWordIssue, isL45Legacy, scrubHallucinatedPlaces, legacySwitch, scrubFn,
  );
}
const pipeline = buildPipeline();
// newsBody = เนื้อเดียวกัน → L4.5 (ล้างสถานที่หลอน) เห็นทุกชื่อว่ามีจริง = ไม่แตะ (แยกผลของ scrub ออกจากด่านอื่น)
const runPipeline = (content, run = pipeline) =>
  quiet(() => withEnv('SKIP_CORRECTION', undefined, async () => (await run([{ content, style: 's4' }], { newsBody: content }, {}))[0]));
const runIn = (mode, content, run) => inMode(mode, () => runPipeline(content, run));
const bbScrub = (result) => result._blackbox.find((b) => b.layer === 'L4+-ล้างเนื้อ rollback');

// ═══ A) สวิตช์ถอย ═══
test('A1 ค่าสวิตช์ CORR_ROLLBACK_LEGACY: 1/true/on/yes/legacy (ทนช่องว่าง/อัญประกาศ/ตัวพิมพ์) = ถอย · ไม่ตั้ง/0/off/false/ค่าอื่น = ฉบับใหม่', async () => {
  for (const v of ['1', 'true', 'on', 'yes', 'legacy', ' 1 ', '"1"', 'TRUE', 'Legacy']) {
    await withEnv('CORR_ROLLBACK_LEGACY', v, () => assert.equal(rs.isCorrRollbackLegacy(), true, `ต้องถอย: ${JSON.stringify(v)}`));
  }
  for (const v of [undefined, '', '0', 'off', 'false', 'no', 'new', '2']) {
    await withEnv('CORR_ROLLBACK_LEGACY', v, () => assert.equal(rs.isCorrRollbackLegacy(), false, `ต้องใหม่: ${JSON.stringify(v)}`));
  }
});

// ═══ B) โมดูล — คำต้องห้าม ═══
const RIVER = 'ระดับน้ำในคลองสูงขึ้น ทีมกู้ภัยเข้าช่วยเหลือตามลำดับ ความหวังของชาวบ้านดับลง อีกคนดับที่โรงพยาบาล';
const RIVER_EXPECTED = 'ระดับน้ำในคลองสูงขึ้น ทีมกู้ภัยเข้าช่วยเหลือตามลำดับ ความหวังของชาวบ้านจากไปลง อีกคนจากไปที่โรงพยาบาล';

test('B1 กฎ suggestion ว่าง (ด่วน → \'\') ถูกข้ามเหมือน L3A: เร่งด่วน/ข่าวด่วน/ทางด่วน คงทุกไบต์ · isScrubbableForbidden คงเกณฑ์เดิม (≤25 · ไม่มี เช่น/สำนวน/บริบท//) + ไม่ว่าง', async () => {
  const text = 'รถชนกันบนทางด่วนขาเข้า ตำรวจเร่งด่วนปิดการจราจร ข่าวด่วน วันนี้';
  await inMode('default', async () => {
    const issues = await auditIssues(text);
    assert.deepEqual(issues.filter((i) => i.type === 'forbidden_word').map((i) => [i.text, i.suggestion]), [['ด่วน', ''], ['ด่วน', '']], 'L2 จริงจับ ด่วน (คำแทนว่าง) 2 จุดบนขอบคำ');
    const r = rs.scrubRollbackContent(text, issues);
    assert.equal(r.content, text, 'ต้องไม่ลบ ด่วน');
    assert.equal(r.changed, false);
    assert.deepEqual(r.skippedEmpty, ['ด่วน', 'ด่วน']);
    assert.deepEqual(r.forbidden, []);
  });
  assert.equal(rs.isScrubbableForbidden({ type: 'forbidden_word', text: 'ด่วน', suggestion: '' }), false);
  assert.equal(rs.isScrubbableForbidden({ type: 'forbidden_word', text: 'ดับ', suggestion: 'จากไป' }), true);
  assert.equal(rs.isScrubbableForbidden({ type: 'forbidden_word', text: 'ดับ', suggestion: 'x'.repeat(26) }), false, 'เกณฑ์เดิม ≤25');
  assert.equal(rs.isScrubbableForbidden({ type: 'forbidden_word', text: 'ดับ', suggestion: 'เช่น จากไป' }), false, 'เกณฑ์เดิม: คำแนะนำเชิงอธิบายไม่ใช่คำแทน');
  assert.equal(rs.isScrubbableForbidden({ type: 'engagement_bait', text: 'ห้ามพลาด', suggestion: 'ลบออก' }), false);
});

test('B2 issue มี ruleId (L2 ตารางกลาง) → แทนทุกตำแหน่งที่กฎจับ: ระดับ/ตามลำดับ คง · ดับลง/ดับที่ แทน (S2 ยังทำงานผ่านโมดูล)', async () => {
  await inMode('default', async () => {
    const issues = await auditIssues(RIVER);
    assert.deepEqual(issues.map((i) => [i.text, i.ruleId]), [['ดับ', 'ดับ'], ['ดับ', 'ดับ']]);
    const r = rs.scrubRollbackContent(RIVER, issues);
    assert.equal(r.content, RIVER_EXPECTED);
    assert.deepEqual(r.forbidden.map((f) => [f.via, f.changed]), [['rule', true], ['rule', false]], 'ตัวแรกแทนทั้งหมด ตัวสองไม่เหลืออะไรให้แทน');
    assert.equal(r.changed, true);
  });
});

test('B3 issue ไม่มี ruleId (issue ทำมือ/ด่านอื่น) → ขอบคำ Intl.Segmenter ไม่ใช่ split/join: ระดับ/ตามลำดับ/สองตายาย/เส้นเลือด คง · ไม่มีเครื่องตัดคำ = ไม่แทน', async () => {
  await inMode('default', () => {
    const r = rs.scrubRollbackContent(RIVER, [{ type: 'forbidden_word', text: 'ดับ', suggestion: 'จากไป', severity: 'medium' }]);
    assert.equal(r.content, RIVER_EXPECTED, 'ต้องได้ผลเดียวกับเส้น ruleId');
    assert.deepEqual(r.forbidden.map((f) => [f.via, f.changed]), [['boundary', true]]);
    const elder = 'สองตายายวัยเกษียณถูกพบว่ามีเลือดไหลออกจากศีรษะ แพทย์ระบุว่าเป็นเส้นเลือดในสมองตีบ';
    const e = rs.scrubRollbackContent(elder, [
      { type: 'forbidden_word', text: 'ตาย', suggestion: 'จากไป', severity: 'high' },
      { type: 'forbidden_word', text: 'เลือด', suggestion: 'ร่องรอยเหตุการณ์', severity: 'medium' },
    ]);
    assert.equal(e.content, 'สองตายายวัยเกษียณถูกพบว่ามีร่องรอยเหตุการณ์ไหลออกจากศีรษะ แพทย์ระบุว่าเป็นเส้นเลือดในสมองตีบ');
    assert.match(e.content, /สองตายาย/u);
    assert.match(e.content, /เส้นเลือดในสมอง/u);
    assert.equal(rs.replaceAllAtWordBoundaries('ระดับน้ำ ดับลง', 'ดับ', 'จากไป'), 'ระดับน้ำ จากไปลง');
    assert.equal(rs.replaceAllAtWordBoundaries('ระดับน้ำ', 'ดับ', 'จากไป'), null, 'ไม่มีตำแหน่งบนขอบคำ → null');
    const noSeg = rs.scrubRollbackContent(RIVER, [{ type: 'forbidden_word', text: 'ดับ', suggestion: 'จากไป', severity: 'medium' }], { segmenter: null });
    assert.equal(noSeg.content, RIVER, 'ไม่มี Intl.Segmenter → ไม่แทน (ทิศ S1: ไม่แทนดีกว่าแทนกลางคำ)');
    assert.deepEqual(noSeg.forbidden.map((f) => [f.via, f.changed]), [['boundary', false]]);
  });
});

test('B4 สัญญา S2: RISK_WORDS_LEGACY=1 + issue ไม่มี ruleId → split/join เดิม ("ระจากไป"/"ตามลำจากไป" ทำซ้ำได้ในโหมดถอย S2)', async () => {
  await inMode('all-legacy', () => {
    const r = rs.scrubRollbackContent(RIVER, [{ type: 'forbidden_word', text: 'ดับ', suggestion: 'จากไป', severity: 'medium' }]);
    assert.equal(r.content, RIVER.split('ดับ').join('จากไป'));
    assert.match(r.content, /ระจากไปน้ำ/u);
    assert.match(r.content, /ตามลำจากไป/u);
    assert.deepEqual(r.forbidden.map((f) => f.via), ['split-join']);
  });
});

// ═══ C) โมดูล — คำชวนเมนต์ (engagement bait) ═══
const BAIT = 'ข่าวนี้ห้ามพลาด รถชนกัน 3 คันบนถนน ห้ามพลาด แชร์ด่วน ก่อนโดนลบ รายการ "ห้ามพลาด" ออกอากาศคืนนี้ พิมพ์ 1 ถ้าเป็นกำลังใจ คุณคิดยังไง?';
const BAIT_EXPECTED = 'ข่าวนี้ รถชนกัน 3 คันบนถนน ก่อนโดนลบ รายการ "ห้ามพลาด" ออกอากาศคืนนี้ พิมพ์ 1 ถ้าเป็นกำลังใจ คุณคิดยังไง?';

test('C1 bait สั้นถูกลบทุกตำแหน่งบนขอบคำ + เก็บกวาดช่องว่าง · ในเครื่องหมายคำพูดไม่แตะ · ยาว ≥30 ไม่แตะ · verify (ด่านข้อเท็จจริง) ไม่ผ่าน = คงไว้ (พิมพ์ 1 / คุณคิดยังไง?)', async () => {
  await inMode('default', async () => {
    const issues = await auditIssues(BAIT);
    const baits = issues.filter((i) => i.type === 'engagement_bait').map((i) => i.text);
    for (const b of ['แชร์ด่วน', 'ห้ามพลาด', 'พิมพ์ 1', 'คุณคิดยังไง?']) assert.ok(baits.includes(b), `L2 จริงต้องรายงาน bait "${b}"`);
    assert.ok(baits.some((b) => b.length >= 30), 'L2 รายงานประโยคท้ายที่เป็นคำถาม (ท่อนยาว ≥30)');
    const r = rs.scrubRollbackContent(BAIT, issues, { verify: factVerify(BAIT) });
    assert.equal(r.content, BAIT_EXPECTED);
    const by = Object.fromEntries(r.bait.map((b) => [b.text, b]));
    assert.deepEqual([by['ห้ามพลาด'].removed, by['แชร์ด่วน'].removed], [true, true]);
    assert.deepEqual([by['พิมพ์ 1'].removed, by['พิมพ์ 1'].reason], [false, 'fact-gate'], 'ลบแล้วเลข 1 หาย → L4 จะทิ้งทั้ง scrub → คงไว้');
    assert.deepEqual([by['คุณคิดยังไง?'].removed, by['คุณคิดยังไง?'].reason], [false, 'fact-gate'], 'regex ชื่อของ L4 นับ "คุณคิดยังไง" เป็นชื่อ → คงไว้');
    assert.ok(r.bait.some((b) => b.reason === 'too-long'), 'ท่อนยาว ≥30 = ไม่แตะ (เกณฑ์ L3A)');
    assert.deepEqual(r.skippedEmpty, ['ด่วน'], 'ด่วน ใน "แชร์ด่วน" คือกฎคำแทนว่าง → ข้าม (bait ถูกลบผ่านเส้น bait แทน)');
    assert.equal(rs.scrubRollbackContent(BAIT, issues, { verify: () => false }).content, BAIT, 'verify ปฏิเสธทุกชิ้น = ไม่แตะ');
    const noVerify = rs.scrubRollbackContent(BAIT, issues);
    assert.doesNotMatch(noVerify.content, /พิมพ์ 1|คุณคิดยังไง\?/u, 'ไม่ส่ง verify = ลบหมด (ผู้เรียกรับผิดชอบเอง)');
    assert.match(noVerify.content, /"ห้ามพลาด"/u, 'ชื่อรายการในเครื่องหมายคำพูดยังคง');
    const noSeg = rs.scrubRollbackContent(BAIT, issues, { verify: factVerify(BAIT), segmenter: null });
    assert.equal(noSeg.content, BAIT, 'ไม่มี Intl.Segmenter → ไม่ลบ bait (needsBoundary)');
    assert.ok(noSeg.bait.filter((b) => b.text.length < 30).every((b) => b.reason === 'not-on-boundary'));
  });
});

// ═══ D) ท่อจริง ═══
// R7 + bait (รายงาน PL-05): L3 ลบ "พิมพ์ 1" → เลข 1 หาย → ย้อนต้นฉบับ → scrub — ค่าเริ่มต้นต้องคง เร่งด่วน/ทางด่วน + ลบ ห้ามพลาด + คง พิมพ์ 1 (ด่าน L4)
const R7 = 'รถชนกันบนทางด่วนขาเข้า ตำรวจเร่งด่วนปิดการจราจร 3 ช่องทาง ผู้บาดเจ็บ 4 รายถูกส่งโรงพยาบาล ความหวังของญาติเลยดับลงเมื่อรู้ข่าว ห้ามพลาด คลิปเต็มในคอมเมนต์ พิมพ์ 1 ถ้าเป็นกำลังใจ';
test('D1 ท่อจริง R7+bait 3 โหมด: ค่าเริ่มต้น = เร่งด่วน/ทางด่วน คง · ดับ→จากไป · ห้ามพลาด หาย · พิมพ์ 1 คง (L4) · CORR_ROLLBACK_LEGACY=1 = "เร่งปิด" + bait กลับ · +RISK_WORDS_LEGACY=1 = "บนทางขาเข้า"', async () => {
  aiFail();
  const fresh = await runIn('default', R7);
  assert.equal(fresh._correctionDebug.path, 'rollback', 'L3 ลบ "พิมพ์ 1" ทำเลข 1 หาย → ต้องย้อนต้นฉบับ');
  assert.equal(fresh._correctionDebug.rollbackScrub?.error, undefined, 'scrub ต้องไม่ล้มเงียบ');
  assert.equal(fresh.content, R7.replace('เลยดับลง', 'เลยจากไปลง').replace('เมื่อรู้ข่าว ห้ามพลาด คลิป', 'เมื่อรู้ข่าว คลิป'));
  assert.match(fresh.content, /บนทางด่วนขาเข้า/u);
  assert.match(fresh.content, /ตำรวจเร่งด่วนปิด/u);
  assert.match(fresh.content, /พิมพ์ 1 ถ้าเป็นกำลังใจ/u, 'bait ที่มีเลข: ลบแล้ว L4 ทิ้งทั้ง scrub → คงไว้ (จดเหตุผล)');
  assert.deepEqual(fresh._correctionDebug.rollbackScrub.baitRemoved, ['ห้ามพลาด']);
  assert.deepEqual(fresh._correctionDebug.rollbackScrub.baitKept, ['พิมพ์ 1 (fact-gate)']);
  assert.equal(fresh._correctionDebug.rollbackScrub.skippedEmptySuggestion, 1, 'ด่วน (เร่งด่วน) ข้าม');
  assert.equal(fresh._correctionDebug.rollbackScrub.forbiddenScrubbed, 1, 'นับเฉพาะ ดับ');
  assert.equal(fresh._correctionDebug.rolledBack, true);
  assert.ok(fresh._correctionDebug.rejectedFactDrifts >= 1, 'drift ที่ถูกปฏิเสธมาจากผล L3 (เลข 1 หาย) — ฉบับหลัง scrub ต้องผ่านด่านท้าย (ไม่ถูกทิ้งซ้ำ)');
  // หมายเหตุ: factPreserved ของฉบับที่คืนเป็น false (factDrifts=1 medium) เพราะ regex สถานที่ของ L4 กิน "โรงพยาบาล ความหวังของญาติเลยดับลง…" ทั้งท่อนเป็นชื่อสถานที่
  //   = บั๊กแยกที่ผู้ตรวจ PL-05 จดไว้นอกขอบเขต (regex โลภของ L4/L4.5) ไม่ใช่ผลของ scrub — ข้อสอบนี้ล็อกแค่ว่าไม่มี drift สูง (เนื้อที่คืน = ฉบับ scrub ไม่ใช่ต้นฉบับ)
  assert.equal(fresh._correctionDebug.factDrifts, 1);

  const s4Legacy = await runIn('s4-legacy', R7);
  assert.equal(s4Legacy._correctionDebug.path, 'rollback');
  assert.equal(s4Legacy.content, R7.replace('เลยดับลง', 'เลยจากไปลง').replace('ตำรวจเร่งด่วนปิด', 'ตำรวจเร่งปิด'), 'บล็อกเดิม: กฎคำแทนว่างลบ ด่วน + bait กลับเข้าโพสต์');
  assert.match(s4Legacy.content, /ห้ามพลาด/u);
  assert.deepEqual(s4Legacy._correctionDebug.rollbackScrub, { reAuditIssues: fresh._correctionDebug.rollbackScrub.reAuditIssues, forbiddenScrubbed: 2 }, 'debug โหมดถอย = รูปเดิมทุกคีย์ (ด่วน+ดับ)');

  const allLegacy = await runIn('all-legacy', R7);
  assert.equal(allLegacy._correctionDebug.path, 'rollback');
  assert.equal(allLegacy.content, R7.replace('เลยดับลง', 'เลยจากไปลง').replace('บนทางด่วนขาเข้า', 'บนทางขาเข้า').replace('ตำรวจเร่งด่วนปิด', 'ตำรวจเร่งปิด'), 'production ก่อนแคมเปญ: split/join ลบ ด่วน ทุกตำแหน่ง');
  assert.match(allLegacy.content, /ห้ามพลาด/u);
});

// R1b (รายงาน): L3B เขียน "2 ชั่วโมง" → "สองชั่วโมง" → เลขหาย → ย้อนต้นฉบับ → scrub "ดับ" — ระดับ/ไฟดับ/ตามลำดับ ต้องคง
const R1B = 'ระดับความเสียหายยังประเมินไม่ได้ ไฟไหม้นาน 2 ชั่วโมงจนไฟดับสนิท ความหวังของครอบครัวแทบดับลง ค่าเสียหายราว 1,500,000 บาท เจ้าหน้าที่เข้าช่วยเหลือตามลำดับ';
test('D2 ท่อจริง R1b: ค่าเริ่มต้นและ CORR_ROLLBACK_LEGACY=1 (เส้น ruleId ของ S2) แทนเฉพาะ "แทบดับลง" · +RISK_WORDS_LEGACY=1 ได้ ระจากไป/ไฟจากไป/ตามลำจากไป (บั๊กเดิม)', async () => {
  aiTransform((c) => c.replace('2 ชั่วโมง', 'สองชั่วโมง'));
  try {
    const expected = R1B.replace('แทบดับลง', 'แทบจากไปลง');
    for (const mode of ['default', 's4-legacy']) {
      const r = await runIn(mode, R1B);
      assert.equal(r._correctionDebug.path, 'rollback', `${mode}: เลข 2 หาย → ย้อนต้นฉบับ`);
      assert.equal(r.content, expected, mode);
      assert.match(r.content, /2 ชั่วโมง/u);
    }
    const old = await runIn('all-legacy', R1B);
    assert.equal(old._correctionDebug.path, 'rollback');
    assert.equal(old.content, R1B.split('ดับ').join('จากไป'), 'production ก่อนแคมเปญ: split/join ทุกตำแหน่ง');
    assert.match(old.content, /ระจากไปความเสียหาย/u);
    assert.match(old.content, /ตามลำจากไป/u);
  } finally { aiFail(); }
});

// R6b (รายงาน): สองตายาย + เส้นเลือด — L3B เขียน "3 วัน" → "สามวัน" → ย้อนต้นฉบับ → scrub "เลือด"
const R6B = 'สองตายายวัยเกษียณถูกพบว่ามีเลือดไหลออกจากศีรษะ แพทย์ระบุว่าเป็นเส้นเลือดในสมองตีบ รักษาตัวมาแล้ว 3 วัน';
test('D3 ท่อจริง R6b: ค่าเริ่มต้น "มีเลือดไหล"→"มีร่องรอยเหตุการณ์ไหล" เท่านั้น · +RISK_WORDS_LEGACY=1 ได้ "สองจากไปาย"/"เส้นร่องรอยเหตุการณ์" (บั๊กเดิม 10 ก.ค.)', async () => {
  aiTransform((c) => c.replace('3 วัน', 'สามวัน'));
  try {
    const r = await runIn('default', R6B);
    assert.equal(r._correctionDebug.path, 'rollback');
    assert.equal(r.content, R6B.replace('มีเลือดไหล', 'มีร่องรอยเหตุการณ์ไหล'));
    const old = await runIn('all-legacy', R6B);
    assert.equal(old._correctionDebug.path, 'rollback');
    assert.match(old.content, /สองจากไปาย/u);
    assert.match(old.content, /เส้นร่องรอยเหตุการณ์ในสมอง/u);
  } finally { aiFail(); }
});

// issue ไม่มี ruleId ในโหมดตารางกลาง (L2 ของด่านอื่น/ทำมือ): ค่าเริ่มต้นขอบคำ · CORR_ROLLBACK_LEGACY=1 split/join ("ระจากไป" กลับมา)
const NO_RULE = 'บ้านเลขที่ 45 อยู่ท้ายหมู่บ้าน ระดับน้ำสูงขึ้นทุกชั่วโมง ความหวังของชาวบ้านดับลงในคืนนั้น เจ้าหน้าที่เข้าช่วยเหลือตามลำดับ';
test('D4 ท่อจริง issue ไม่มี ruleId (audit stub) + L3 ทำเลขหาย: ค่าเริ่มต้นแทนบนขอบคำ (ระดับ/ตามลำดับ คง) · CORR_ROLLBACK_LEGACY=1 = split/join "ระจากไป"', async () => {
  const stubbed = buildPipeline({
    audit: async () => ({ auditScore: 60, issues: [{ type: 'forbidden_word', severity: 'medium', text: 'ดับ', suggestion: 'จากไป' }] }),
    correct: async (content) => ({ correctedContent: content.replace('บ้านเลขที่ 45 ', 'บ้านหลังหนึ่ง ').replace('ดับลง', 'จากไปลง'), rollbackContent: content, corrections: [{ type: 'regex_replace' }] }),
  });
  const fresh = await runIn('default', NO_RULE, stubbed);
  assert.equal(fresh._correctionDebug.path, 'rollback', 'เลข 45 หาย → ย้อนต้นฉบับ');
  assert.equal(fresh.content, NO_RULE.replace('ดับลง', 'จากไปลง'));
  assert.equal(fresh._correctionDebug.rollbackScrub.forbiddenReplaced, 1);
  const legacy = await runIn('s4-legacy', NO_RULE, stubbed);
  assert.equal(legacy._correctionDebug.path, 'rollback');
  assert.equal(legacy.content, NO_RULE.split('ดับ').join('จากไป'));
  assert.match(legacy.content, /ระจากไปน้ำ/u);
  assert.match(legacy.content, /ตามลำจากไป/u);
});

test('D5 debug/กล่องดำ: ค่าเริ่มต้นมีคีย์ใหม่ + ด่าน "L4+-ล้างเนื้อ rollback" ในกล่องดำ · โหมดถอย = รูปเดิม {reAuditIssues, forbiddenScrubbed} ไม่มีด่านใหม่', async () => {
  aiFail();
  const fresh = await runIn('default', R7);
  assert.deepEqual(Object.keys(fresh._correctionDebug.rollbackScrub).sort(),
    ['baitKept', 'baitRemoved', 'forbiddenReplaced', 'forbiddenScrubbed', 'reAuditIssues', 'skippedEmptySuggestion']);
  const bb = bbScrub(fresh);
  assert.ok(bb, 'กล่องดำต้องมีด่าน scrub');
  assert.equal(bb.changed, true);
  assert.equal(bb.after, fresh.content, 'เนื้อหลัง scrub = เนื้อที่คืนจริง (ด่านหลังจากนั้นไม่แตะในข้อสอบนี้)');
  assert.deepEqual(bb.rollbackScrub, fresh._correctionDebug.rollbackScrub);
  const legacy = await runIn('s4-legacy', R7);
  assert.deepEqual(Object.keys(legacy._correctionDebug.rollbackScrub).sort(), ['forbiddenScrubbed', 'reAuditIssues']);
  assert.equal(bbScrub(legacy), undefined, 'โหมดถอย: กล่องดำรายการเดิม');
});

test('D6 fail-open: โมดูลโยน error → ปล่อยเนื้อ rollback เดิมผ่าน (เหมือน scrub เดิมล้ม) บันทึก error ใน debug · ท่อไม่ล้ม', async () => {
  aiFail();
  const boom = buildPipeline({ scrubFn: () => { throw new Error('boom-scrub'); } });
  const r = await runIn('default', R7, boom);
  assert.equal(r._correctionDebug.path, 'rollback');
  assert.deepEqual(r._correctionDebug.rollbackScrub, { error: 'boom-scrub' });
  assert.equal(r.content, R7, 'ล้ม = เนื้อ rollback เดิม (คำต้องห้าม/bait ยังอยู่ ให้ด่านถัดไป/คนตรวจ)');
  assert.equal(r._correctionError, undefined);
});
