import assert from 'node:assert/strict';
import { test, beforeEach, afterEach, after } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { register } from 'node:module';
import { spawnSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { deserialize } from 'node:v8';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const SRC = new URL('../src/', import.meta.url).href;
const PIPE_URL = new URL('../src/lib/services/clipBrain/clipBrainPipeline.js', import.meta.url);
const SERVICE_URL = new URL('../src/lib/services/clipInsightService.js', import.meta.url);
const COMPOSE_URL = new URL('../src/lib/services/clipBrain/composeTopics.js', import.meta.url);
const KEY = 'clip-topic-v2-wiring.state';
const state = { responses: [], calls: [], packs: [], fetches: [] };
globalThis[Symbol.for(KEY)] = state;
after(() => { delete globalThis[Symbol.for(KEY)]; });
const moduleData = (s) => 'data:text/javascript,' + encodeURIComponent(s);
const brainModule = moduleData(`
  export async function runBrain(opts) {
    const s = globalThis[Symbol.for(${JSON.stringify(KEY)})];
    s.calls.push(opts);
    if (opts.label === 'วางแผนผ่า') return { ok: true, json: { segments: s.plan }, costUSD: 0.02 };
    if (opts.label.startsWith('clip-compose-')) {
      if (!s.composeReplies.length) throw new Error('Unexpected composer call');
      const reply = s.composeReplies.shift();
      if (reply instanceof Error) throw reply;
      return reply;
    }
    if (opts.label === 'ผู้ตรวจ') return { ok: true, json: { verdict: s.findings.length ? 'ต้องตรวจ' : 'สะอาด', findings: s.findings } };
    if (opts.label === 'ตัวซ่อม') return s.repairReply || { ok: false, errorType: 'MOCK_REPAIR_UNAVAILABLE' };
    throw new Error('Unexpected brain label');
  }
`);
const composeModule = moduleData(`
  import { composeTopics as real } from ${JSON.stringify(COMPOSE_URL.href)};
  export async function composeTopics(opts) {
    const s = globalThis[Symbol.for(${JSON.stringify(KEY)})];
    s.packs.push(structuredClone(opts.evidencePack));
    if (s.composeCrash) throw new Error('synthetic composer crash');
    return real(opts);
  }
`);
register(moduleData(`
  import { readFile } from 'node:fs/promises';
  const hasExt = (s) => /\\.[a-zA-Z0-9]{1,5}$/.test(s);
  export async function resolve(spec, ctx, next) {
    if (spec === './brainRunner.js') return { url: ${JSON.stringify(brainModule)}, shortCircuit: true };
    if (spec === './composeTopics.js' && ctx.parentURL?.startsWith(${JSON.stringify(PIPE_URL.href)})) return { url: ${JSON.stringify(composeModule)}, shortCircuit: true };
    if (spec === '../../ai/usageLogger.js') return { url: 'data:text/javascript,export async function logApiUsage() {}', shortCircuit: true };
    if (spec === '@/lib/services/clipAI/openai') return { url: 'data:text/javascript,export function callAI() { throw new Error("Unexpected paid AI call"); }', shortCircuit: true };
    if (spec.startsWith('@/')) return next(new URL(spec.slice(2) + (hasExt(spec) ? '' : '.js'), ${JSON.stringify(SRC)}).href, ctx);
    if ((spec.startsWith('./') || spec.startsWith('../')) && !hasExt(spec)) {
      try { return await next(spec + '.js', ctx); } catch { /* Default resolution. */ }
    }
    return next(spec, ctx);
  }
  export async function load(url, ctx, next) {
    const result = await next(url, ctx);
    const isPipe = url === ${JSON.stringify(PIPE_URL.href)};
    const isService = url.split('?')[0] === ${JSON.stringify(SERVICE_URL.href)};
    if (!isPipe && !isService) return result;
    let source = String(result.source);
    // Used once to capture immutable pre-P3 snapshots, and by isolated mutation
    // children. Neither mechanism edits files in the working tree.
    const baseline = process.env.CLIP_TOPIC_TEST_BASELINE;
    if (baseline) source = await readFile(baseline + (isPipe ? '/src/lib/services/clipBrain/clipBrainPipeline.js' : '/src/lib/services/clipInsightService.js'), 'utf8');
    const mutation = process.env.CLIP_TOPIC_TEST_MUTATION;
    const patches = {
      flag: [isPipe, "process.env.CLIP_TOPIC_V2 === '1'", 'false'],
      normalize: [isService, 'p.topicsV2.schemaVersion === 2', 'false'],
      sync: [isPipe, 'const synced = syncTopicsV2FromLegacy(insight);', 'const synced = { insight, changed: [] };'],
    };
    const patch = patches[mutation];
    if (patch?.[0]) {
      if (!source.includes(patch[1])) throw new Error('Mutation anchor missing');
      source = source.replace(patch[1], patch[2]);
    }
    return { ...result, source };
  }
`));

const initialUncapped = process.env.CLIP_UNCAPPED;
process.env.CLIP_UNCAPPED = '1';
const { runClipBrainPipeline } = await import(PIPE_URL.href);
const { normalizeInsight } = await import(SERVICE_URL.href);
process.env.CLIP_UNCAPPED = '0';
const { normalizeInsight: normalizeCapped } = await import(SERVICE_URL.href + '?capped-p3-test');
if (initialUncapped === undefined) delete process.env.CLIP_UNCAPPED;
else process.env.CLIP_UNCAPPED = initialUncapped;
const { buildEvidencePackFromPipeline } = await import('../src/lib/services/clipBrain/topicEvidence.js');
const { buildComposePrompt } = await import(COMPOSE_URL.href);
const { emptyTopicDoc, toLegacyInsight, syncTopicsV2FromLegacy } = await import('../src/lib/services/clipBrain/topicSchema.js');
const { countThaiWords } = await import('../src/lib/services/clipBrain/topicMetrics.js');
const { runOnce, parseArgs } = await import('../scripts/clip-brain-once.mjs');

const ENV_KEYS = ['CLIP_TOPIC_V2', 'CLIP_TOPIC_MODEL', 'CLIP_TOPIC_EFFORT', 'CLIP_TOPIC_FALLBACK_MODEL', 'CLIP_TOPIC_FALLBACK_ON_TIMEOUT', 'CLIP_TOPIC_STYLE_GATE', 'CLIP_TOPIC_BRAIN', 'CLIP_TOPIC_FALLBACK_BRAIN', 'CLIP_REVIEWER_BRAIN', 'CLIP_REVIEWER_MODEL', 'CLIP_REVIEWER_EFFORT',
  'CLIP_TOPIC_FALLBACK_EFFORT', 'CLIP_TOPIC_TIMEOUT_MS', 'GEMINI_VIDEO_API_KEY', 'GEMINI_API_KEY',
  'CLIP_SAFE_TEXT', 'CLIP_USAGE_LOG', 'CLIP_GEMINI_MAX_ATTEMPTS', 'CLIP_GEMINI_FALLBACK_MODELS', 'CLIP_REVIEWER_ALWAYS'];
let saved;
function setup() {
  saved = { env: Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])), fetch: globalThis.fetch,
    Date: globalThis.Date, log: console.log, warn: console.warn };
  for (const key of ENV_KEYS) delete process.env[key];
  // ★ 9 ก.ย. 69: เทสเดินท่อใช้ fixture จริงที่มีคำอ้างที่มา → ปิดด่านสำนวน (ด่านนี้มีเทสของตัวเองใน clip-compose-topics)
  Object.assign(process.env, { GEMINI_VIDEO_API_KEY: 'offline-test-key', CLIP_SAFE_TEXT: '0',
    CLIP_USAGE_LOG: '0', CLIP_GEMINI_MAX_ATTEMPTS: '1', CLIP_GEMINI_FALLBACK_MODELS: '', CLIP_TOPIC_STYLE_GATE: '0',
    // ★ 9 ก.ย. 69 มาตรการ B: fixture ชุดนี้สะอาด (v2 hard 0) — เทสกลไก reviewer/repair จึงต้องบังคับตรวจ · พฤติกรรมข้ามมีเทสของตัวเองด้านล่าง
    CLIP_REVIEWER_ALWAYS: '1' });
  const fixed = 1788652800000;
  globalThis.Date = class extends saved.Date {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed; }
  };
  console.log = () => {};
  console.warn = () => {};
  globalThis.fetch = async (url, opts) => {
    state.fetches.push({ url, body: JSON.parse(opts.body) });
    assert.ok(state.responses.length, 'No unexpected Gemini calls');
    const data = state.responses.shift();
    if (data?.mockHttpFailure) return { ok: false, status: 400, json: async () => ({ error: { message: 'offline failure' } }) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{
      content: { parts: [{ text: JSON.stringify(data) }] }, finishReason: 'STOP',
    }] }) };
  };
}
function teardown() {
  globalThis.fetch = saved.fetch; globalThis.Date = saved.Date;
  console.log = saved.log; console.warn = saved.warn;
  for (const key of ENV_KEYS) {
    if (saved.env[key] === undefined) delete process.env[key]; else process.env[key] = saved.env[key];
  }
}
beforeEach(setup);
afterEach(teardown);

const ORIGINAL_TEXT = 'คนในชุมชนช่วยกันซ่อมบ้านและจัดเตรียมร้านก่อนเปิดขายของในตลาด '.repeat(10);
const BASE = { clipType: 'monologue', headline: 'ชุมชนเปิดร้าน', rawData: ORIGINAL_TEXT,
  overview: 'คนในชุมชนเตรียมเปิดร้าน', speakers: [], quotes: [], subStories: [] };
const TRUTH = { transcription: [{ time: '00:00–00:30', speaker: '', text: ORIGINAL_TEXT }], onScreenText: ['เปิดร้านในชุมชน'] };
const PLAN = [1, 2, 3].map((no) => ({ no, startSec: (no - 1) * 300, endSec: no * 300, topics: [] }));
function words(n, variant = 0) {
  const tokens = [['คน', 'รถ', 'บ้าน', 'น้ำ', 'งาน'], ['แมว', 'นก', 'ปลา', 'ช้าง', 'ม้า']][variant % 2];
  const value = Array.from({ length: n }, (_, i) => tokens[i % tokens.length]).join(' ');
  assert.equal(countThaiWords(value), n);
  return value;
}
function doc() {
  const d = emptyTopicDoc();
  d.mainTopicId = 's1'; d.mainStory = words(120, 1);
  d.stories = [{ id: 's1', topic: 'ชุมชนซ่อมบ้าน', highlight: 'คนในชุมชนช่วยกันซ่อมบ้าน', story: words(120),
    timeRanges: [{ startSec: 0, endSec: 30 }], sharePct: null,
    facts: [{ id: 'f1', text: 'คนในชุมชนช่วยกันซ่อมบ้าน', kind: 'speaker_statement', evidenceIds: ['t1'] }],
    quotes: [], standalone: true, overlaps: [], quality: { status: 'not_checked', issues: [] } }];
  return d;
}
async function execute(flag, options = {}) {
  if (flag === undefined) delete process.env.CLIP_TOPIC_V2; else process.env.CLIP_TOPIC_V2 = flag;
  Object.assign(state, { calls: [], packs: [], fetches: [], plan: PLAN,
    findings: options.findings || [], repairReply: options.repairReply,
    composeCrash: !!options.composeCrash,
    composeReplies: options.composeReplies || [{ ok: true, json: doc(), costUSD: 0.15 }] });
  const durationSec = options.long ? 900 : 60;
  const map = { headline: 'MAP_ONLY_FAKE_NAME', timeline: [], clipDurationSec: durationSec };
  state.responses = [map, ...(options.long
    ? [BASE, options.missing ? { mockHttpFailure: true } : BASE, BASE] : [BASE]), options.truth ?? TRUTH];
  const result = await runClipBrainPipeline({ url: 'https://www.youtube.com/watch?v=offline-test',
    isYouTube: true, durationSec, model: 'gemini-3.7-flash', usageLogger: () => {} });
  assert.equal(result.ok, true, result.error);
  assert.equal(state.responses.length, 0);
  return { result, calls: structuredClone(state.calls), packs: structuredClone(state.packs), fetches: structuredClone(state.fetches) };
}
const withoutBrain = (insight) => { const { brain, ...rest } = insight; void brain; return rest; };
const freeze = (v) => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };

// BASELINE_AND_TESTS
// Compressed V8 snapshots (including explicit undefined keys) captured from the pre-P3 backup with
// fixed clock and identical external mocks. These do not derive from new code.
const SNAPSHOTS = deserialize(inflateSync(Buffer.from('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', 'base64')));

test('off compatibility: absent, 0 and every non-1 flag deep-equal pre-P3 insight AND brain', async () => {
  for (const flag of [undefined, '0', '', 'true', '01', ' 1 ']) {
    const actual = await execute(flag);
    assert.deepEqual(actual, SNAPSHOTS.clean);
    assert.equal(Object.hasOwn(actual.result.brain, 'topicsV2'), false);
    assert.equal(Object.hasOwn(actual.result.insight, 'topicsV2'), false);
    assert.equal(actual.calls.some((c) => c.label.startsWith('clip-compose')), false);
    assert.deepEqual(actual.packs, []);
  }
  assert.deepEqual(await execute('0', { long: true, missing: true }), SNAPSHOTS.partial);
  assert.deepEqual(await execute(undefined, { truth: { transcription: [] } }), SNAPSHOTS.noTruth);
});

test('enabled success: truth and stage 3 evidence reach composer; normalized v2 reaches review and output', async () => {
  const actual = await execute('1');
  const { insight, brain } = actual.result;
  assert.ok(brain.topicsV2, 'Enabled pipeline must include composition metadata');
  assert.equal(brain.topicsV2.ok, true);
  assert.equal(brain.topicsV2.gate.pass, true);
  assert.equal(brain.topicsV2.stories, 1);
  assert.equal(brain.costs.composeUSD, 0.15);
  assert.equal(brain.topicsV2.attempts.length, 1);
  assert.equal(insight.topicsV2.schemaVersion, 2);
  assert.equal(insight.mainStory, doc().mainStory);
  assert.equal(insight.subStories[0].rawData, doc().stories[0].story);
  assert.equal(insight.subStories[0].storyId, 's1');
  assert.equal(insight.subStories[0].sharePct, 50);
  assert.equal(insight.subStories[0].quality.status, 'checked');
  assert.deepEqual(insight.subStories[0].quality, insight.topicsV2.stories[0].quality);
  assert.ok(insight.subStories[0].quality.issues.some((issue) => issue.code === 'long-sentence'));
  const composer = actual.calls.find((c) => c.label === 'clip-compose-compose');
  assert.deepEqual([composer.brain, composer.model, composer.effort, composer.timeoutMs], ['codex', 'gpt-6-astra', 'ultra', 1200000]);
  assert.ok(actual.calls.find((c) => c.label === 'ผู้ตรวจ').prompt.includes(doc().stories[0].story));
  const pack = actual.packs[0];
  assert.equal(pack.evidence.filter((e) => e.kind === 'transcript').map((e) => e.text).join(''), ORIGINAL_TEXT);
  assert.ok(pack.evidence.some((e) => e.kind === 'screen'));
  assert.ok(pack.evidence.some((e) => e.kind === 'segment' && e.provenance === 'ai-summary'));
  assert.ok(!JSON.stringify(pack).includes('MAP_ONLY_FAKE_NAME'));
  assert.deepEqual(pack.clipMeta.missingRanges, []);
  assert.deepEqual(brain.topicsV2.syncedAfterRepair, []);
  assert.equal(actual.fetches.length, 3);
});

test('env overrides and fallback preserve provider routing, attempts and all known compose costs', async () => {
  // ★ 8 ก.ย. 69: ค่าเริ่มต้นใหม่ = ตัวหลักหมดเวลาแล้ว "ข้าม" ตัวสำรอง (คลิปยาวเคยเสีย 8+8 นาที) — เปิดพฤติกรรมเดิมด้วย CLIP_TOPIC_FALLBACK_ON_TIMEOUT=1
  Object.assign(process.env, { CLIP_TOPIC_MODEL: 'gpt-6-astra-test', CLIP_TOPIC_EFFORT: 'high',
    CLIP_TOPIC_FALLBACK_MODEL: 'claude-fable-5-test', CLIP_TOPIC_FALLBACK_EFFORT: 'high', CLIP_TOPIC_TIMEOUT_MS: '1500000', CLIP_TOPIC_FALLBACK_ON_TIMEOUT: '1' });
  const actual = await execute('1', { composeReplies: [
    { ok: false, errorType: 'BRAIN_TIMEOUT', costUSD: 0.2 }, { ok: true, json: doc(), costUSD: 0.3 },
  ] });
  const calls = actual.calls.filter((c) => c.label.startsWith('clip-compose'));
  assert.deepEqual(calls.map((c) => [c.brain, c.model, c.effort, c.timeoutMs]), [
    ['codex', 'gpt-6-astra-test', 'high', 1500000], ['claude', 'claude-fable-5-test', 'high', 1500000],
  ]);
  assert.equal(actual.result.brain.costs.composeUSD, 0.5);
  assert.equal(actual.result.brain.topicsV2.attempts.length, 2);
  // ค่าเริ่มต้น (ไม่ตั้ง env): ตัวหลักหมดเวลา → ไม่เรียกตัวสำรอง · attempts มีตัวสำรองเป็นรายการ "ข้าม" · ค่าใช้จ่ายนับเฉพาะที่เรียกจริง
  delete process.env.CLIP_TOPIC_FALLBACK_ON_TIMEOUT;
  const skipped = await execute('1', { composeReplies: [
    { ok: false, errorType: 'BRAIN_TIMEOUT', costUSD: 0.2 }, { ok: true, json: doc(), costUSD: 0.3 },
  ] });
  assert.deepEqual(skipped.calls.filter((c) => c.label.startsWith('clip-compose')).map((c) => c.brain), ['codex']);
  assert.equal(skipped.result.brain.topicsV2.ok, false);
  assert.deepEqual(skipped.result.brain.topicsV2.attempts.map((a) => [a.brain, a.errorType, a.skipped === true]), [['codex', 'BRAIN_TIMEOUT', false], ['claude', 'COMPOSE_FALLBACK_SKIPPED_TIMEOUT', true]]);
  assert.equal(skipped.result.brain.costs.composeUSD, 0.2);
  for (const timeout of ['bad', '0', '-1', 'Infinity', '2147483648']) {
    process.env.CLIP_TOPIC_TIMEOUT_MS = timeout;
    assert.equal((await execute('1')).calls.find((c) => c.label.startsWith('clip-compose')).timeoutMs, 1200000);
  }
});

test('injected runBrain needs no extractJson export even for CLI text with an unmatched prose brace', async () => {
  const actual = await execute('1', { composeReplies: [{ ok: true, text: 'คำเกริ่น { แล้วตามด้วย JSON\n' + JSON.stringify(doc()) }] });
  assert.equal(actual.result.brain.topicsV2.ok, true);
  assert.equal(actual.result.insight.topicsV2.stories[0].id, 's1');
});

test('failed transport, JSON, quality and composer crash all retain extraction and continue verification', async () => {
  const failures = [
    { composeReplies: [{ ok: false, errorType: 'BRAIN_TIMEOUT' }, { ok: false, errorType: 'BRAIN_QUOTA' }] },
    { composeReplies: Array.from({ length: 3 }, () => ({ ok: true, text: '{broken' })) },
    { composeReplies: Array.from({ length: 3 }, () => ({ ok: true, json: { ...doc(), mainStory: 'สั้น' } })) },
    { composeReplies: [new Error('runner failed'), new Error('fallback failed')] },
    { composeCrash: true },
  ];
  for (const options of failures) {
    const actual = await execute('1', options);
    assert.deepEqual(withoutBrain(actual.result.insight), withoutBrain(SNAPSHOTS.clean.result.insight));
    assert.equal(actual.result.brain.topicsV2.ok, false);
    assert.ok(actual.result.brain.degradations.some((d) => d.type === (options.composeCrash ? 'topics-v2-crashed' : 'topics-v2-failed')));
    assert.ok(actual.calls.some((c) => c.label === 'ผู้ตรวจ'));
    assert.equal(actual.fetches.length, 3);
  }
});

test('truth unavailable skips v2; missing segments annotate the pack and prompt without inventing evidence', async () => {
  for (const truth of [{ transcription: [] }, { mockHttpFailure: true }]) {
    const actual = await execute('1', { truth });
    assert.equal(Object.hasOwn(actual.result.brain, 'topicsV2'), false);
    assert.ok(actual.result.brain.degradations.some((d) => d.type === 'topics-v2-skipped-no-truth'));
    assert.deepEqual(actual.calls, []);
    assert.deepEqual(actual.packs, []);
  }
  const actual = await execute('1', { long: true, missing: true });
  const pack = actual.packs[0];
  assert.deepEqual(pack.clipMeta.missingRanges, [{ startSec: 300, endSec: 600 }]);
  assert.deepEqual(pack.evidence.filter((e) => e.kind === 'segment').map((e) => e.sourceNo), [1, 3]);
  assert.match(buildComposePrompt({ evidencePack: pack }), /ช่วง 300–600 วินาทีถอดไม่สำเร็จ ห้ามแต่งเติม/);
});

test('evidence retains Unicode, explicit times, speakers, provenance, substory details and source numbers', () => {
  const raw = 'คนในชุมชนช่วยกันซ่อมบ้าน 🏠\n'.repeat(70) + 'จบ';
  const input = freeze({ truth: { transcription: [
    { time: '1:02:03–1:02:10', speaker: 'ผู้พูด ก', text: raw },
    { time: '02:03', text: 'มีเฉพาะเวลาเริ่ม' }, { time: '00:99', speaker: 'unknown', text: 'เวลาไม่ถูกต้อง' },
  ], onScreenText: ['ข้อความหน้าจอ'] }, segmentResults: [{ seg: { no: 7, startSec: 0, endSec: 100 }, r: { ok: true, data: {
    rawData: 'สรุปจาก AI', subStories: [{ topic: 'เรื่องหนึ่ง', rawData: 'รายละเอียดครบ', timeRange: '00:10–00:20' }], quotes: ['คำพูดในผล AI'],
  } } }], plannedSegments: [], map: { headline: 'MAP_ONLY_FAKE_NAME', timeline: [{ time: '00:00–00:10', topic: 'เริ่มเรื่อง' }] }, durSec: 4000 });
  const pack = buildEvidencePackFromPipeline(input);
  assert.deepEqual(pack, buildEvidencePackFromPipeline(input));
  const transcript = pack.evidence.filter((e) => e.kind === 'transcript');
  const firstRow = transcript.filter((e) => e.speaker === 'ผู้พูด ก');
  assert.equal(firstRow.map((e) => e.text).join(''), raw);
  firstRow.slice(0, -1).forEach((e) => assert.ok(Array.from(e.text).length >= 300 && Array.from(e.text).length <= 500));
  assert.ok(firstRow.every((e) => !e.text.includes('\ufffd')));
  assert.deepEqual(firstRow[0].timeRange, { startSec: 3723, endSec: 3730 });
  assert.deepEqual(transcript.at(-2).timeRange, { startSec: 123, endSec: null });
  assert.equal(transcript.at(-1).timeRange, null);
  assert.equal(transcript.at(-1).speaker, null);
  assert.deepEqual(transcript.map((e) => e.id), transcript.map((_, i) => `t${i + 1}`));
  assert.equal(pack.evidence.find((e) => e.kind === 'screen').id, 'x1');
  assert.deepEqual(pack.evidence.find((e) => e.kind === 'substory').timeRange, { startSec: 10, endSec: 20 });
  assert.ok(pack.evidence.filter((e) => ['substory', 'segment', 'quote'].includes(e.kind)).every((e) => e.sourceNo === 7 && e.provenance === 'ai-summary'));
  assert.ok(!JSON.stringify(pack).includes('MAP_ONLY_FAKE_NAME'));
  assert.match(buildComposePrompt({ evidencePack: pack }), /ห้ามใช้ข้อสรุป AI ยืนยันชื่อบุคคล/);
  const overlap = buildEvidencePackFromPipeline({ plannedSegments: [{ startSec: 0, endSec: 30 }],
    segmentResults: [{ seg: { startSec: 10, endSec: 20 }, r: { ok: true } }] });
  assert.deepEqual(overlap.clipMeta.missingRanges, [{ startSec: 0, endSec: 10 }, { startSec: 20, endSec: 30 }]);
});

test('evidence budget drops segment then timeline, bounds large truth and advertises truncation', () => {
  const make = (rawData, timeline = 'แผน', raw = ORIGINAL_TEXT) => buildEvidencePackFromPipeline({
    truth: { transcription: [{ text: raw }] }, segmentResults: [{ seg: { no: 1 }, r: { ok: true, data: { rawData } } }],
    map: { timeline: [{ topic: timeline }] },
  });
  const a = make('ก'.repeat(60000));
  assert.ok(!a.evidence.some((e) => e.kind === 'segment'));
  assert.ok(a.evidence.some((e) => e.kind === 'timeline'));
  const b = make('สรุป', 'ข'.repeat(60000));
  assert.ok(!b.evidence.some((e) => ['segment', 'timeline'].includes(e.kind)));
  assert.equal(b.evidence.map((e) => e.text).join(''), ORIGINAL_TEXT);
  const c = make('สรุป', 'แผน', 'ก🏠'.repeat(50000));
  for (const pack of [a, b, c]) {
    assert.equal(pack.clipMeta.evidenceTruncated, true);
    assert.ok(JSON.stringify(pack).length <= 60000);
    assert.match(buildComposePrompt({ evidencePack: pack }), /หลักฐานบางส่วนถูกตัดตามเพดาน/);
  }
  assert.ok(c.evidence.every((e) => !e.text.includes('\ufffd')));
});

test('normalizer preserves v2 only when present, rejects wrong versions, detaches metadata and respects both LIM modes', () => {
  const input = toLegacyInsight(doc(), BASE);
  const snapshot = structuredClone(input);
  const normalized = normalizeInsight(freeze(input), 'clip-brain');
  assert.deepEqual(normalized.topicsV2, snapshot.topicsV2);
  for (const key of ['storyId', 'highlight', 'sharePct', 'standalone', 'overlaps', 'quality']) {
    assert.deepEqual(normalized.subStories[0][key], snapshot.subStories[0][key]);
  }
  assert.equal(normalized.mainStory, snapshot.mainStory);
  normalized.topicsV2.stories[0].story = 'mutated';
  normalized.subStories[0].quality.issues.push('mutated');
  assert.deepEqual(input, snapshot);
  for (const topicsV2 of [null, [], { schemaVersion: 1 }, { schemaVersion: '2' }]) {
    assert.equal(Object.hasOwn(normalizeInsight({ ...BASE, topicsV2 }, 'clip-brain'), 'topicsV2'), false);
  }
  const long = { ...BASE, mainStory: 'ก'.repeat(9000), topicsV2: doc(), subStories: [{ topic: 'ข่าว', rawData: 'ก'.repeat(7000), highlight: 'ข'.repeat(700) }] };
  assert.equal(normalizeCapped(long, 'clip-brain').mainStory.length, 8000);
  assert.equal(normalizeCapped(long, 'clip-brain').subStories[0].rawData.length, 6000);
  assert.equal(normalizeCapped(long, 'clip-brain').subStories[0].highlight.length, 500);
  assert.equal(normalizeInsight(long, 'clip-brain').mainStory.length, 9000);
});

test('three real archive records deep-equal pre-P3 normalization in capped AND uncapped modes', (t) => {
  const archivePath = 'C:/tmp/news-pipeline-runtime-r133/data/clip-insights.json';
  if (!existsSync(archivePath)) return t.skip('Optional local archive is not available');
  const archive = JSON.parse(readFileSync(archivePath, 'utf8'));
  assert.equal(SNAPSHOTS.archive.length, 3);
  for (const expected of SNAPSHOTS.archive) {
    const row = archive.find((r) => r.id === expected.id);
    assert.ok(row, `Archive row ${expected.id} remains available`);
    assert.deepEqual(normalizeInsight(row.insight, 'clip-brain'), expected.uncapped);
    assert.deepEqual(normalizeCapped(row.insight, 'clip-brain'), expected.capped);
  }
});

test('repair sync: accepted stage 6 rawData repair updates matching v2 story and preserves mainStory with a stale issue', async () => {
  const d = doc();
  const bad = 'The course takes twenty years.';
  const good = 'The course takes six months.';
  d.stories[0].story = words(110) + '\n' + bad;
  const corrected = d.stories[0].story.replace(bad, good);
  const findings = [{ kind: 'ของงอก', severity: 'สูง', where: bad, detail: 'ระยะเวลาเรียนผิด', fix: good }];
  const actual = await execute('1', { composeReplies: [{ ok: true, json: d }], findings,
    repairReply: { ok: true, costUSD: 0.03, json: {
      patch: { subStories: [{ no: 1, rawData: corrected }] }, unfixed: [],
      changed: [{ fromFinding: 1, summary: 'แก้เวลาเรียน', edits: [{ path: 'subStories.1.rawData', before: bad, after: good }] }],
    } },
  });
  const { insight, brain } = actual.result;
  assert.equal(insight.subStories[0].rawData, corrected);
  assert.equal(insight.topicsV2.stories[0].story, corrected);
  assert.equal(insight.topicsV2.mainStory, d.mainStory);
  assert.equal(insight.mainStory, d.mainStory);
  assert.equal(insight.topicsV2.mainStoryStale, true);
  assert.ok(insight.topicsV2.mainStoryQuality.issues.some((issue) => issue.code === 'main-story-stale'));
  assert.ok(brain.topicsV2.syncedAfterRepair.includes('topicsV2.stories[0].story'));
  assert.ok(brain.topicsV2.syncedAfterRepair.includes('topicsV2.mainStoryStale'));
  assert.equal(brain.topicsV2.syncedAfterRepair.includes('mainStory'), false);
  assert.equal(brain.costs.repairUSD, 0.03);
});

test('pure sync matches IDs through reordering, preserves exact quote metadata and resets changed quotes', () => {
  const d = doc();
  d.stories[0].quotes = [{ text: 'คำพูดเดิม', speaker: 'ผู้พูด ก', evidenceIds: ['t1'], verification: 'verified' }];
  d.stories.push({ ...structuredClone(d.stories[0]), id: 's2', story: 'เรื่องที่สอง', quotes: [] });
  const input = toLegacyInsight(d, BASE);
  input.subStories.reverse();
  input.subStories[0].topic = 'หัวข้อใหม่';
  input.subStories[0].directLead = 'ประโยคเปิดใหม่';
  input.subStories[1].quotes = ['คำพูดเดิม', 'คำพูดแก้ใหม่'];
  const before = structuredClone(input);
  const actual = syncTopicsV2FromLegacy(freeze(input));
  assert.deepEqual(input, before);
  assert.equal(actual.insight.topicsV2.stories[1].topic, 'หัวข้อใหม่');
  assert.equal(actual.insight.topicsV2.stories[1].highlight, 'ประโยคเปิดใหม่');
  assert.equal(actual.insight.subStories[0].highlight, 'ประโยคเปิดใหม่');
  assert.deepEqual(actual.insight.topicsV2.stories[0].quotes, [d.stories[0].quotes[0],
    { text: 'คำพูดแก้ใหม่', speaker: '', evidenceIds: [], verification: 'pending' }]);
  assert.equal(actual.insight.mainStory, d.mainStory);
  assert.deepEqual(syncTopicsV2FromLegacy(actual.insight).changed, []);
  assert.deepEqual(syncTopicsV2FromLegacy(BASE), { insight: BASE, changed: [] });
});

test('one-shot CLI applies the explicit flag, invokes direct pipeline once, writes JSON and prints five summary lines', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clip-p3-cli-'));
  try {
    for (const v2 of [false, true]) {
      process.env.CLIP_TOPIC_V2 = v2 ? '0' : '1';
      const out = path.join(dir, `${v2}.json`);
      let calls = 0;
      const result = await runOnce(['--url', 'https://youtu.be/offline-test', '--model', 'gemini-3.7-flash', '--out', out, ...(v2 ? ['--v2'] : [])], {
        loadEnv: false, runPipeline: async (opts) => {
          calls++;
          assert.equal(process.env.CLIP_TOPIC_V2, v2 ? '1' : '0');
          assert.equal(opts.model, 'gemini-3.7-flash');
          assert.equal(opts.isYouTube, true);
          return SNAPSHOTS.clean.result;
        },
      });
      assert.equal(calls, 1);
      assert.equal(result.summary.length, 5);
      assert.deepEqual(JSON.parse(await readFile(out, 'utf8')), JSON.parse(JSON.stringify({ insight: SNAPSHOTS.clean.result.insight, brain: SNAPSHOTS.clean.result.brain })));
      await assert.rejects(runOnce(['--url', 'https://youtu.be/offline-test', '--out', out], { loadEnv: false,
        runPipeline: () => assert.fail('Existing output must be rejected before API calls') }), { code: 'EEXIST' });
    }
    assert.throws(() => parseArgs(['--url', 'https://example.com/video']), /YouTube/);
    assert.throws(() => parseArgs(['--url', 'https://youtu.be/x', '--out', 'script.mjs']), /\.json/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const [mutation, pattern] of [['flag', '^enabled success'], ['normalize', '^normalizer preserves v2'], ['sync', '^repair sync']]) {
  test(`mutation ${mutation}: the unchanged assertions reject the defective source in an isolated child`, { skip: !!process.env.CLIP_TOPIC_TEST_MUTATION }, () => {
    const env = { ...process.env, CLIP_TOPIC_TEST_MUTATION: mutation };
    delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(process.execPath, ['--test', '--test-name-pattern', pattern, fileURLToPath(import.meta.url)], {
      env, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 1, `${child.stdout}\n${child.stderr}`);
    assert.match(child.stdout + child.stderr, /ERR_ASSERTION|AssertionError/);
  });
}

// ★ 8 ก.ย. 69 (เจ้าของ: Claude Opus 5 high เป็นสมองหลัก): เลือกค่ายของตัวเรียบเรียง/ตัวสำรอง/ผู้ตรวจผ่าน env — ไม่ตั้ง = พฤติกรรมเดิม (codex)
test('brain selection env switches composer, fallback and reviewer providers with per-brain defaults', async () => {
  const legacy = await execute('1');
  assert.equal(legacy.calls.find((c) => c.label === 'clip-compose-compose').brain, 'codex');
  assert.equal(legacy.calls.find((c) => c.label === 'ผู้ตรวจ').brain, 'codex');
  assert.equal(legacy.calls.find((c) => c.label === 'ผู้ตรวจ').model, undefined, 'reviewer keeps codex auto when unset');
  Object.assign(process.env, { CLIP_TOPIC_BRAIN: 'claude', CLIP_TOPIC_FALLBACK_BRAIN: 'codex', CLIP_REVIEWER_BRAIN: 'claude', CLIP_REVIEWER_MODEL: 'claude-opus-5', CLIP_REVIEWER_EFFORT: 'high' });
  const swapped = await execute('1', { composeReplies: [{ ok: false, errorType: 'BRAIN_QUOTA' }, { ok: true, json: doc(), costUSD: 0.1 }] });
  const compose = swapped.calls.filter((c) => c.label.startsWith('clip-compose'));
  assert.deepEqual(compose.map((c) => [c.brain, c.model, c.effort]), [['claude', 'claude-opus-5', 'high'], ['codex', 'gpt-6-astra', 'xhigh']], 'claude primary with opus-5/high defaults, codex fallback with astra/xhigh defaults');
  const reviewer = swapped.calls.find((c) => c.label === 'ผู้ตรวจ');
  assert.deepEqual([reviewer.brain, reviewer.model, reviewer.effort], ['claude', 'claude-opus-5', 'high']);
  assert.equal(swapped.result.brain.topicsV2.ok, true);
  process.env.CLIP_TOPIC_MODEL = 'claude-fable-5'; process.env.CLIP_TOPIC_EFFORT = 'max';
  const overridden = await execute('1');
  assert.deepEqual([overridden.calls.find((c) => c.label === 'clip-compose-compose').brain, overridden.calls.find((c) => c.label === 'clip-compose-compose').model, overridden.calls.find((c) => c.label === 'clip-compose-compose').effort], ['claude', 'claude-fable-5', 'max'], 'explicit model/effort env still wins');
  process.env.CLIP_TOPIC_BRAIN = 'gemini';
  assert.equal((await execute('1')).calls.find((c) => c.label === 'clip-compose-compose').brain, 'codex', 'unknown brain value falls back to codex');
});

// ★ 9 ก.ย. 69 มาตรการ B (เจ้าของเคาะ "เอาไวและลื่น"): งานสะอาดสองชั้นข้ามผู้ตรวจ AI
test('มาตรการ B: v2 ผ่าน hard 0 + ชั้นโค้ดสะอาด → ข้ามผู้ตรวจ (default) · CLIP_REVIEWER_ALWAYS=1 บังคับตรวจคืน', async () => {
  delete process.env.CLIP_REVIEWER_ALWAYS;
  const skipped = await execute('1');
  assert.equal(skipped.result.brain.topicsV2.ok, true, 'fixture ต้องผ่านด่าน v2 จริง');
  assert.equal(skipped.calls.find((c) => c.label === 'ผู้ตรวจ'), undefined, 'งานสะอาดต้องไม่จ่ายค่าผู้ตรวจ');
  assert.equal(skipped.result.brain.check.reviewerSkipped, 'v2-hard0-code-clean', 'ใบเสร็จต้องบอกว่าข้ามเพราะสะอาด');
  assert.equal(skipped.result.brain.check.ai, null, 'ชั้นสมองต้องว่างเมื่อข้าม');
  assert.ok(!skipped.result.brain.degradations.some((d) => d.type === 'reviewer-unavailable'),
    'ข้ามโดยตั้งใจห้ามนับเป็นผู้ตรวจล้ม');
  // บังคับตรวจกลับพฤติกรรมเดิมได้ด้วย env ตัวเดียว
  process.env.CLIP_REVIEWER_ALWAYS = '1';
  const forced = await execute('1');
  assert.ok(forced.calls.find((c) => c.label === 'ผู้ตรวจ'), 'บังคับตรวจแล้วผู้ตรวจต้องวิ่ง');
  assert.equal(forced.result.brain.check.reviewerSkipped, undefined, 'บังคับตรวจต้องไม่มีธงข้าม');
});

test('มาตรการ B: v2 ไม่ผ่าน → ผู้ตรวจยังวิ่งตามเดิม (ห้ามข้ามงานไม่สะอาด)', async () => {
  delete process.env.CLIP_REVIEWER_ALWAYS;
  // compose ล้มทุก attempt → topicsV2.ok = false → เส้นทางเดิมต้องมีผู้ตรวจ
  const failed = await execute('1', { composeReplies: [
    { ok: false, errorType: 'BRAIN_TIMEOUT', costUSD: 0.1 },
  ] });
  assert.equal(failed.result.brain.topicsV2.ok, false);
  assert.ok(failed.calls.find((c) => c.label === 'ผู้ตรวจ'), 'v2 ไม่ผ่านต้องตรวจเสมอ');
  assert.equal(failed.result.brain.check.reviewerSkipped, undefined);
});
