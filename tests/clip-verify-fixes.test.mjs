import assert from 'node:assert/strict';
import { test, beforeEach, afterEach, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

const SRC = new URL('../src/', import.meta.url).href;
const PIPE_URL = new URL('../src/lib/services/clipBrain/clipBrainPipeline.js', import.meta.url);
const VERIFY_URL = new URL('../src/lib/services/clipBrain/clipVerify.js', import.meta.url);
const stateKey = Symbol.for('clip-verify-fixes.test.state');
const state = { replies: [], brainCalls: [], fetches: [], responses: [] };
globalThis[stateKey] = state;
after(() => { delete globalThis[stateKey]; });

// Real pipeline, verifier, normalization and Gemini request code; only external boundaries are mocked.
const brainModule = 'data:text/javascript,' + encodeURIComponent(`
  export async function runBrain(opts) {
    const state = globalThis[Symbol.for('clip-verify-fixes.test.state')];
    state.brainCalls.push(opts);
    if (!state.replies.length) throw new Error('Unexpected brain call');
    return state.replies.shift();
  }
`);
register('data:text/javascript,' + encodeURIComponent(`
  const hasExt = (s) => /\\.[a-zA-Z0-9]{1,5}$/.test(s);
  export async function resolve(spec, ctx, next) {
    if (spec === './brainRunner.js' && ctx.parentURL === ${JSON.stringify(PIPE_URL.href)}) {
      return { url: ${JSON.stringify(brainModule)}, shortCircuit: true };
    }
    if (spec === '../../ai/usageLogger.js' && ctx.parentURL === ${JSON.stringify(PIPE_URL.href)}) {
      return { url: 'data:text/javascript,export async function logApiUsage() {}', shortCircuit: true };
    }
    if (spec === '@/lib/ai/openai') {
      return { url: 'data:text/javascript,export function callAI() { throw new Error("Unexpected AI call"); }', shortCircuit: true };
    }
    if (spec.startsWith('@/')) return next(new URL(spec.slice(2) + (hasExt(spec) ? '' : '.js'), ${JSON.stringify(SRC)}).href, ctx);
    if ((spec.startsWith('./') || spec.startsWith('../')) && !hasExt(spec)) {
      try { return await next(spec + '.js', ctx); } catch { /* Try original specifier. */ }
    }
    return next(spec, ctx);
  }
`));

const { checkAgainstTruth, quoteCoverage, selectTruthForFindings, buildReviewPrompt,
  buildRepairPrompt, applyRepairPatch, repairFabricatedNames } = await import(VERIFY_URL.href);
const { runClipBrainPipeline } = await import(PIPE_URL.href);

const ENV_KEYS = ['GEMINI_VIDEO_API_KEY', 'GEMINI_API_KEY', 'CLIP_SAFE_TEXT', 'CLIP_USAGE_LOG',
  'CLIP_GEMINI_MAX_ATTEMPTS', 'CLIP_GEMINI_FALLBACK_MODELS'];
let savedEnv, savedFetch;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, { GEMINI_VIDEO_API_KEY: 'offline-test-key', CLIP_SAFE_TEXT: '0',
    CLIP_GEMINI_MAX_ATTEMPTS: '1', CLIP_GEMINI_FALLBACK_MODELS: '' });
  savedFetch = globalThis.fetch;
  state.replies = []; state.brainCalls = []; state.fetches = []; state.responses = [];
  globalThis.fetch = async (url, opts) => {
    state.fetches.push({ url, body: JSON.parse(opts.body) });
    assert.ok(state.responses.length, 'No unexpected Gemini requests');
    return { ok: true, status: 200, json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(state.responses.shift()) }] }, finishReason: 'STOP' }],
    }) };
  };
});
afterEach(() => {
  globalThis.fetch = savedFetch;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const TRUTH = 'ผู้พูดกล่าวถึงการเปิดร้านในตลาดและการทำงานร่วมกันของคนในชุมชน '.repeat(8);
const BAD = 'The course used to take twenty years and now takes six months.';
const GOOD = 'The course took twenty years to develop; students study for six months.';
const BAD_OVERVIEW = 'Every student passed automatically.';
const GOOD_OVERVIEW = 'The speaker described the course.';
const BASE = { headline: 'เรื่องหลักสูตร', clipType: 'monologue', speakers: [], quotes: [], subStories: [],
  rawData: `The speaker explained the course. ${BAD} This is a recorded interview.`, overview: BAD_OVERVIEW };
const AI_FINDINGS = [
  { kind: 'ของงอก', severity: 'สูง', where: BAD, detail: 'เชื่อมระยะเวลาพัฒนากับระยะเวลาเรียนผิด', fix: 'แยกระยะเวลาทั้งสอง' },
  { kind: 'ของงอก', severity: 'สูง', where: BAD_OVERVIEW, detail: 'ไม่ได้บอกว่าทุกคนสอบผ่าน', fix: 'แก้ภาพรวม' },
];
const report = (fromFinding = 1, path = 'rawData', before = BAD, after = GOOD) => ({
  fromFinding, summary: 'แก้ข้อความตามต้นทาง', edits: [{ path, before, after }],
});
const fixedRaw = BASE.rawData.replace(BAD, GOOD);
async function pipeline({ insight = BASE, mapHeadline = 'เรื่องหลักสูตร', caption,
  findings = [], patch, changed = [], unfixed = [], repairFailure = false } = {}) {
  state.fetches = []; state.brainCalls = [];
  state.responses = [{ headline: mapHeadline, clipDurationSec: 60, timeline: [] }, insight, { transcription: TRUTH }];
  state.replies = [{ ok: true, json: { verdict: findings.length ? 'ต้องตรวจ' : 'สะอาด', findings } }];
  if (patch !== undefined || repairFailure) state.replies.push(repairFailure
    ? { ok: false, errorType: 'TEST_REPAIR_FAILED' }
    : { ok: true, json: { patch, changed, unfixed } });
  const r = await runClipBrainPipeline({ url: 'https://www.youtube.com/watch?v=offline-test', isYouTube: true,
    durationSec: 60, model: 'gemini-3.7-flash', caption, usageLogger: () => {} });
  assert.equal(r.ok, true, r.error);
  assert.equal(state.fetches.length, 3);
  assert.equal(state.responses.length, 0);
  assert.equal(state.replies.length, 0);
  return r;
}

test('A: map headline never becomes source evidence in initial check, AI prompt or recheck', async () => {
  const r = await pipeline({ insight: { ...BASE, speakers: ['สมชาย ใจดี'] },
    mapHeadline: 'สมชาย ใจดี เปิดใจ', patch: {} });
  assert.equal(r.brain.check.code.findings.filter((f) => f.kind === 'ของงอก-ชื่อ').length, 1);
  assert.equal(r.brain.recheck.high, 1, 'Recheck must still flag the unsupported name');
  assert.equal(r.brain.status, 'ต้องตรวจ');
  const review = state.brainCalls.find((c) => c.label === 'ผู้ตรวจ').prompt;
  const captionBlock = review.split('=== แคปชั่นต้นทาง ===')[1].split('=== เฉลยจากคลิป')[0];
  assert.match(captionBlock, /\(ไม่มี\)/);
  assert.doesNotMatch(captionBlock, /สมชาย|ใจดี/);
  assert.equal(state.brainCalls.length, 2, 'Review and repair only; no extra AI pass');
  assert.doesNotMatch(readFileSync(PIPE_URL, 'utf8'), /caption:\s*caption\s*\|\|\s*map\.headline/);
});

test('A: a real source caption can still establish the speaker name', async () => {
  const r = await pipeline({ insight: { ...BASE, speakers: ['สมชาย ใจดี'] }, caption: 'สมชาย ใจดี เปิดร้าน' });
  assert.equal(r.brain.check.code.findings.length, 0);
  assert.equal(r.brain.status, 'สะอาด');
  assert.equal(state.brainCalls.length, 1);
  assert.match(state.brainCalls[0].prompt, /=== แคปชั่นต้นทาง ===\nสมชาย ใจดี เปิดร้าน/);
  assert.equal(checkAgainstTruth({ speakers: ['สมชาย ใจดี'] }, TRUTH).findings[0].kind, 'ของงอก-ชื่อ');
  assert.equal(checkAgainstTruth({ speakers: ['สมชาย ใจดี'] }, TRUTH, { caption: 'สมชาย ใจดี' }).findings.length, 0);
  assert.deepEqual(repairFabricatedNames({ speakers: ['สมชาย ใจดี'] }, TRUTH, { caption: 'สมชาย ใจดี' }).changes, []);
});

test('A: review explicitly treats the generated headline as content to verify', () => {
  const prompt = buildReviewPrompt({ insight: { headline: 'ชื่อที่ AI แต่ง' }, truth: TRUTH });
  assert.match(prompt, /headline.*AI.*ห้ามใช้เป็นหลักฐาน/);
  assert.match(prompt, /=== แคปชั่นต้นทาง ===\n\(ไม่มี\)/);
});

const QUOTE = Array.from({ length: 100 }, (_, i) => String.fromCharCode(0x4e00 + i)).join('');
for (const [chars, expectedKind, severity] of [
  [100, null, null], [60, null, null], [59, 'คำพูดตรงบางส่วน', 'กลาง'],
  [30, 'คำพูดตรงบางส่วน', 'กลาง'], [29, 'คำพูดไม่ตรงคลิป', 'สูง'],
  [14, 'คำพูดไม่ตรงคลิป', 'สูง'], [0, 'คำพูดไม่ตรงคลิป', 'สูง'],
]) {
  test(`B: ${chars}% coverage has the correct boundary verdict`, () => {
    const truth = QUOTE.slice(0, chars);
    assert.equal(quoteCoverage(QUOTE, truth), chars / 100);
    const r = checkAgainstTruth({ quotes: [QUOTE] }, truth);
    if (!expectedKind) assert.deepEqual(r.findings, []);
    else {
      assert.equal(r.findings.length, 1);
      assert.equal(r.findings[0].kind, expectedKind);
      assert.equal(r.findings[0].severity, severity);
      assert.equal(r.findings[0].coverage, chars / 100);
    }
  });
}

test('B: union coverage counts overlapping windows once and includes separated matching spans', () => {
  assert.equal(quoteCoverage(QUOTE, `${QUOTE.slice(0, 20)} x ${QUOTE.slice(40, 60)}`), 0.4);
  for (const offset of [1, 2, 3]) {
    const quote = 'z'.repeat(offset) + QUOTE.slice(0, 14);
    assert.equal(quoteCoverage(quote, QUOTE), 14 / (14 + offset));
    assert.deepEqual(checkAgainstTruth({ quotes: [quote] }, QUOTE).findings, []);
  }
});

test('B: speaker labels, punctuation, spaces and Thai numerals retain normalization', () => {
  const quote = 'สมชาย: ผมเปิดรับผู้เรียนจำนวน ๑๒ คนในปีนี้ - สมชาย';
  assert.equal(quoteCoverage(quote, 'ผมเปิดรับ ผู้เรียนจำนวน 12 คนในปีนี้'), 1);
});

test('B: short quotes are explicitly unverified, including exact short matches and substory quotes', () => {
  assert.equal(quoteCoverage('สั้นมาก', 'สั้นมาก'), 0);
  assert.equal(quoteCoverage(null, null), 0);
  const r = checkAgainstTruth({ subStories: [{ quotes: ['สั้นมาก'] }] }, 'สั้นมาก');
  assert.equal(r.findings[0].kind, 'คำพูดสั้นตรวจไม่ได้');
  assert.equal(r.findings[0].severity, 'ต่ำ');
  assert.equal(r.verdict, 'มีข้อสังเกต');
});

const LATE = 'ทุนวิจัยปลายคลิปเปิดรับสมัครเดือนหน้า';
const LONG_TRUTH = 'ก'.repeat(25000) + LATE + 'ข'.repeat(5000 - LATE.length);
const LATE_FINDINGS = [{ kind: 'ของหาย-ประเด็น', severity: 'สูง', where: LATE, detail: 'เพิ่มรายละเอียดช่วงท้าย', fix: 'เติมเรื่องนี้' }];

test('C: evidence at character 25000 reaches the repair prompt within the 12000-character budget', () => {
  assert.equal(LONG_TRUTH.length, 30000);
  const before = structuredClone(LATE_FINDINGS);
  const selected = selectTruthForFindings(LONG_TRUTH, LATE_FINDINGS);
  assert.ok(selected.includes(LATE));
  assert.ok(selected.length <= 12000);
  const prompt = buildRepairPrompt({ insight: BASE, truth: LONG_TRUTH, findings: LATE_FINDINGS });
  const evidence = prompt.split('=== เฉลยจากคลิป (ใช้ยืนยันข้อเท็จจริง) ===\n')[1].split('\n\n=== ผลถอดปัจจุบัน')[0];
  assert.ok(evidence.includes(LATE));
  assert.ok(evidence.length <= 12000);
  assert.deepEqual(LATE_FINDINGS, before);
});

test('C: overlapping windows merge without duplicating source evidence', () => {
  const second = 'หลักฐานอีกเรื่องอยู่ใกล้กัน';
  const truth = 'ก'.repeat(25000) + LATE + ' '.repeat(40) + second + 'ข'.repeat(5000);
  const selected = selectTruthForFindings(truth, [...LATE_FINDINGS, { where: second }]);
  assert.equal(selected.split(LATE).length - 1, 1);
  assert.equal(selected.split(second).length - 1, 1);
  assert.ok(truth.includes(selected), 'Merged excerpt is unchanged source text');
});

test('C: budget covers distant findings and respects smaller custom windows', () => {
  const early = 'โครงการศึกษาต้นคลิป';
  const truth = 'ก'.repeat(2000) + early + 'ข'.repeat(22000) + LATE + 'ค'.repeat(6000);
  const selected = selectTruthForFindings(truth, [{ where: early }, ...LATE_FINDINGS], { maxChars: 1000, window: 100 });
  assert.ok(selected.includes(early));
  assert.ok(selected.includes(LATE));
  assert.ok(selected.includes('\n…\n'));
  assert.ok(selected.length <= 1000);
});

test('C: normalized keyword search preserves original Thai numerals and whitespace', () => {
  const evidence = 'สมชาย   ใจดี ได้รับทุนจำนวน ๒๕๖๙ บาท';
  const truth = 'ก'.repeat(25000) + evidence + 'ข'.repeat(5000);
  const selected = selectTruthForFindings(truth, [{ where: 'สมชายใจดี' }, { where: '2569' }]);
  assert.ok(selected.includes(evidence));
});

test('C: repeated generic wording cannot crowd out a specific number near the end', () => {
  const truth = ('รายละเอียด' + 'ก'.repeat(1600)).repeat(16) + 'ยอดทุน 987654 บาท' + 'ข'.repeat(5000);
  const selected = selectTruthForFindings(truth, [{ where: 'รายละเอียด 987654' }]);
  assert.ok(selected.includes('ยอดทุน 987654 บาท'));
  assert.ok(selected.length <= 12000);
});

test('C: no keyword match falls back to both ends with separator counted in every budget', () => {
  const truth = 'HEAD' + 'ก'.repeat(30000) + 'TAIL';
  for (const findings of [[], null, [{ where: 'ไม่พบคำนี้ในเฉลย' }]]) {
    const selected = selectTruthForFindings(truth, findings);
    assert.equal(selected.length, 12000);
    assert.ok(selected.startsWith('HEAD'));
    assert.ok(selected.endsWith('TAIL'));
    assert.ok(selected.includes('\n…\n'));
  }
  for (const cap of [0, 1, 3, 4, 40, 11999]) {
    assert.ok(selectTruthForFindings(truth, [], { maxChars: cap }).length <= cap);
    assert.ok(selectTruthForFindings(LONG_TRUTH, LATE_FINDINGS, { maxChars: cap }).length <= cap);
  }
  assert.equal(selectTruthForFindings(null, []), '');
  assert.equal(selectTruthForFindings('ข้อความเดิมสั้น', []), 'ข้อความเดิมสั้น');
});

test('D: two high AI findings, one actually repaired, leaves exactly one pending and status ต้องตรวจ', async () => {
  const r = await pipeline({ findings: AI_FINDINGS, patch: { rawData: fixedRaw }, changed: [report()],
    unfixed: [{ fromFinding: 2, reason: 'ยังไม่มีข้อมูลพอ' }] });
  assert.equal(r.insight.rawData, fixedRaw);
  assert.deepEqual(r.brain.check.repair.unverifiedAi, [{ ...AI_FINDINGS[1], side: 'ความจริง' }]);
  assert.equal(r.brain.recheck.unverifiedAi, 1);
  assert.equal(r.brain.recheck.high, 0);
  assert.equal(r.brain.recheck.verdict, 'ต้องตรวจ');
  assert.equal(r.brain.status, 'ต้องตรวจ');
  assert.deepEqual(r.brain.check.ai.findings, AI_FINDINGS.map((f) => ({ ...f, side: 'ความจริง' })));
  assert.equal(typeof r.brain.check.repair.note[0], 'string');
  assert.equal(typeof r.brain.check.repair.unfixed[0], 'string');
  assert.equal(state.brainCalls.length, 2);
});

for (const [name, patch, changed, unfixed] of [
  ['legacy free-text claims', { rawData: fixedRaw }, ['แก้ทุกอย่างแล้ว'], []],
  ['no-op patch', { rawData: BASE.rawData }, [report()], []],
  ['rejected patch', { rawData: 'x' }, [report()], []],
  ['unrelated field accepted', { headline: 'หัวข้อที่แก้แล้ว' }, [report()], []],
  ['claim for unchanged text in an accepted field', { rawData: fixedRaw }, [report(1, 'rawData', 'absent old text', 'absent new text')], []],
  ['explicitly unfixed finding', { rawData: fixedRaw }, [report()], [{ fromFinding: 1, reason: 'แก้ได้บางส่วน' }]],
  ['ambiguous unfixed report', { rawData: fixedRaw }, [report()], ['ยังเหลือเรื่องที่แก้ไม่ได้']],
  ['invalid finding number', { rawData: fixedRaw }, [report(999)], []],
]) {
  test(`D: ${name} cannot clear AI findings`, async () => {
    const r = await pipeline({ findings: AI_FINDINGS, patch, changed, unfixed });
    assert.equal(r.brain.check.repair.unverifiedAi.length, 2);
    assert.equal(r.brain.recheck.unverifiedAi, 2);
    assert.equal(r.brain.status, 'ต้องตรวจ');
  });
}

test('D: all explicitly linked edits accepted allows the existing repaired status', async () => {
  const r = await pipeline({ findings: AI_FINDINGS, patch: { rawData: fixedRaw, overview: GOOD_OVERVIEW },
    changed: [report(), report(2, 'overview', BAD_OVERVIEW, GOOD_OVERVIEW)] });
  assert.deepEqual(r.brain.check.repair.unverifiedAi, []);
  assert.equal(r.brain.recheck.unverifiedAi, 0);
  assert.equal(r.brain.status, 'ซ่อมแล้ว');
});

test('D: repair failure retains the original output and all high AI findings', async () => {
  const r = await pipeline({ findings: AI_FINDINGS, repairFailure: true });
  assert.equal(r.insight.rawData, BASE.rawData);
  assert.deepEqual(r.brain.check.repair.unverifiedAi, AI_FINDINGS.map((f) => ({ ...f, side: 'ความจริง' })));
  assert.equal(r.brain.status, 'ต้องตรวจ');
  assert.ok(r.brain.degradations.some((d) => d.type === 'repair-failed'));
});

test('D: findings beyond the repair cap remain pending', async () => {
  const findings = [...AI_FINDINGS, ...Array.from({ length: 11 }, (_, i) => ({ ...AI_FINDINGS[1], where: `untouched finding ${i}` }))];
  const r = await pipeline({ findings, patch: { rawData: fixedRaw }, changed: [report()] });
  assert.equal(r.brain.check.repair.unverifiedAi.length, 12);
  assert.deepEqual(r.brain.check.repair.unverifiedAi.find((f) => f.where === findings[12].where),
    { ...findings[12], side: 'ความจริง' });
  assert.equal(r.brain.status, 'ต้องตรวจ');
  assert.ok(r.brain.degradations.some((d) => d.type === 'repair-capped'));
});

test('D: partial substory patch only credits edits actually accepted, using original story numbers', () => {
  const base = { ...BASE, subStories: [{ no: 5, topic: 'Old topic', rawData: 'x'.repeat(200), quotes: [] }] };
  const r = applyRepairPatch(base, { subStories: [{ no: 5, topic: 'New topic', rawData: 'short' }] }, {
    findings: AI_FINDINGS, changed: [report(1, 'subStories.5.topic', 'Old topic', 'New topic'),
      report(2, 'subStories.5.rawData', 'x'.repeat(200), 'short')], unfixed: [],
  });
  assert.deepEqual(r.resolvedFindings, [1]);
  assert.equal(r.insight.subStories[0].topic, 'New topic');
  assert.equal(r.insight.subStories[0].rawData, 'x'.repeat(200));
  assert.equal(base.subStories[0].topic, 'Old topic');
});

test('D: all edits for a finding must pass, and an invalid patch cannot claim resolution', () => {
  const claim = report();
  claim.edits.push({ path: 'overview', before: BAD_OVERVIEW, after: GOOD_OVERVIEW });
  const opts = { findings: AI_FINDINGS, changed: [claim], unfixed: [] };
  assert.deepEqual(applyRepairPatch(BASE, { rawData: fixedRaw }, opts).resolvedFindings, []);
  for (const patch of [null, undefined, [], 'invalid']) {
    const r = applyRepairPatch(BASE, patch, opts);
    assert.deepEqual(r.resolvedFindings, []);
    assert.deepEqual(r.insight, BASE);
  }
});

test('regression: clean and low-only output stays clean; medium-only findings remain observations', async () => {
  const clean = await pipeline();
  assert.equal(clean.brain.status, 'สะอาด');
  assert.equal(clean.brain.check.repair, null);
  const shortQuote = await pipeline({ insight: { ...BASE, quotes: ['เปิดร้าน'] } });
  assert.equal(shortQuote.brain.status, 'สะอาด');
  assert.equal(shortQuote.brain.check.lowCount, 1);
  assert.equal(shortQuote.brain.check.code.findings[0].severity, 'ต่ำ');
  assert.equal(shortQuote.brain.check.repair, null);
  const observed = await pipeline({ findings: [{ ...AI_FINDINGS[0], severity: 'กลาง' }] });
  assert.equal(observed.brain.status, 'มีข้อสังเกต');
  assert.equal(observed.brain.check.repair, null);
  assert.equal(BASE.rawData.includes(BAD), true, 'Original fixtures must remain unchanged');
});
