// ============================================================
// 🧪 PL-08 — รวมผลหลายมุมแบบรับบางส่วน (tests/partial-angles-pl08.test.mjs)
// ★ 30 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 2 · เจ้าของอนุมัติ)
// ------------------------------------------------------------
// บั๊ก: src/lib/services/autoFlowServiceText.js รวมผลหลายมุมแบบ all-or-nothing — มุมเดียวล้ม (โซ่นักเขียนหมด / หมดเวลาต่อมุม /
//   ผิดสัญญา versions/title) = throw 'auto_generate_contract' ทิ้งทั้งงานรวมมุมที่จ่ายค่าเขียนแล้ว → ส่งซ้ำ = จ่ายทุกขั้นซ้ำ
// แก้: ≥1 มุมผ่านสัญญา → ส่งเฉพาะมุมที่สำเร็จ + ระบุมุมที่ล้มพร้อมเหตุ (qualityWarnings + data.angleGate) · ทุกมุมล้ม = ล้มเหมือนเดิม
//   · ถอย PARTIAL_ANGLES=0 = all-or-nothing เดิม
// วิธีเทส: รัน processAutoFlowText ตัวจริงทั้งฟังก์ชัน (โค้ดจริง withTimeout/pipelineDeadline/publishablePostText) ใต้เส้นตายที่เทสคุมเอง
//   (tests/helpers/fake-deadline.mjs — นาฬิกาหยุดนิ่ง ไม่มี timer จริงของเส้นตาย) · '@/...' ที่เหลือแทนด้วยตัวปลอมในหน่วยความจำ
//   ผ่าน module.registerHooks (ไม่ต่อเน็ต ไม่เรียก AI ไม่แตะ DB ไม่เขียนไฟล์ใน repo) · ตัวปลอมตอบทันที ไม่มีการรอ timer จริง
// mutation (ต้องแดงจริง): ปิดสวิตช์ในเงื่อนไขรวมผล / ตัดบรรทัดส่งคำเตือนเข้า qualityWarnings / ตัดเงื่อนไข "≥1 มุม"
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { manualPipelineDeadline, settleWithin } from './helpers/fake-deadline.mjs';
import { PipelineDeadlineError, runWithPipelineDeadline } from '../src/lib/utils/pipelineDeadline.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const srcUrl = (rel) => pathToFileURL(join(ROOT, 'src', rel)).href;
const AUTO_FLOW_PATH = join(ROOT, 'src', 'lib', 'services', 'autoFlowServiceText.js');
const AUTO_FLOW_SOURCE = readFileSync(AUTO_FLOW_PATH, 'utf8').replace(/\r\n/g, '\n');

// โมดูล pure ใช้ตัวจริง (ต้องเป็น URL เดียวกับที่เทส/helper import เพื่อแชร์ AsyncLocalStorage ของเส้นตาย)
const REAL = {
  '@/lib/utils/withTimeout': srcUrl('lib/utils/withTimeout.js'),
  '@/lib/utils/pipelineDeadline': srcUrl('lib/utils/pipelineDeadline.js'),
  '@/lib/utils/publishablePostText': srcUrl('lib/utils/publishablePostText.js'),
};
const fnStub = (names) => names.map((n) => `export const ${n} = (...a) => globalThis.__PL08.${n}(...a);`).join('\n');
const STUBS = {
  '@/lib/scraper/index.js': fnStub(['extractContent']),
  '@/lib/services/tiktokService': fnStub(['transcribeTiktok']),
  '@/lib/services/youtubeService': fnStub(['transcribeYoutube']),
  '@/lib/services/metaReelsService': fnStub(['transcribeMetaReel', 'isMetaVideoUrl']),
  '@/lib/services/researchService': fnStub(['performResearch']),
  '@/lib/utils/researchSwitch': fnStub(['isNewsResearchOn']),
  '@/lib/services/summarizeServiceText': fnStub(['performSummarize', 'getTopPrompts']),
  '@/lib/services/achievementResearch': fnStub(['smartResearch']),
  '@/lib/services/generationLogger': fnStub(['logGeneration']),
  '@/lib/auth': fnStub(['getSession']),
  '@/lib/pipelineLogger': fnStub(['logPipeline']),
  '@/lib/logger': fnStub(['createLogger']),
  '@/lib/correction/correctionPipeline': fnStub(['runCorrectionPipeline']),
  '@/lib/services/rawFactCompletenessGate': fnStub(['enforceRawFactCompleteness', 'isRawFactCompletenessGateEnabled', 'persistFactualReviewOrThrow']),
  '@/lib/workflow/workflowEngine': fnStub(['saveAnalysis', 'saveFactualReview']),
  '@/lib/ai/builtinFallbackPrompt': fnStub(['getBuiltinFallbackPrompt']),
  '@/lib/ai/legacyLengthRules': `${fnStub(['isLegacyLengthOn'])}\nexport const NEW_LENGTH_CFG = Object.freeze({ min: 146 });`,
  '@/lib/input-engine/narrativePayloadText': fnStub(['assignAngleClosings', 'closingTailMatches']),
  '@/lib/ai/factSourcePolicy': fnStub(['breakdownRawSourceArgs']),
  '@/lib/ai/cardAuthority': fnStub(['isCardAuthorityR6Enabled']),
  '@/lib/utils/textCleaner': fnStub(['cleanScrapedText']),
  'next/headers': fnStub(['cookies']),
};
const unknownSpecifiers = new Set();
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (REAL[specifier]) return { url: REAL[specifier], shortCircuit: true };
    if (Object.hasOwn(STUBS, specifier)) {
      return { url: `data:text/javascript,${encodeURIComponent(`/*${specifier}*/\n${STUBS[specifier]}`)}`, shortCircuit: true };
    }
    if (specifier.startsWith('@/')) unknownSpecifiers.add(specifier);
    return nextResolve(specifier, context);
  },
});

const THAI_BODY = 'ลุงสมชายคนเก็บขยะวัย 62 ปี เก็บกระเป๋าสตางค์ที่มีเงินสด 25,000 บาทได้ข้างถนนหน้าตลาดเช้า แล้วนำไปคืนเจ้าของที่สถานีตำรวจทันที เจ้าของกระเป๋าเป็นแม่ค้าที่เพิ่งถอนเงินมาจ่ายค่าเทอมลูก เธอร้องไห้และมอบเงินตอบแทน แต่ลุงปฏิเสธ บอกว่าของใครก็ต้องคืนคนนั้น ';
const LONG_CONTENT = (tag) => Array.from({ length: 3 }, (_, i) => `ย่อหน้า ${i + 1} ของฉบับ ${tag}: ${THAI_BODY}${THAI_BODY}`).join('\n\n');
const ANGLES = [
  { angle_name: 'มุมความซื่อสัตย์', description: 'ลุงคืนเงินทั้งที่ลำบาก' },
  { angle_name: 'มุมค่าเทอมลูก', description: 'เงินก้อนนั้นคือค่าเทอมของลูกแม่ค้า' },
];

function freshState(writer = {}) {
  const S = {
    calls: { analyzeStarted: 0, analyzeBilled: 0, analyzeFailed: 0, correction: 0, correctionVersions: 0, saveAnalysis: 0 },
    saved: [],
    extractContent: async () => ({ success: false, error: 'stub' }),
    transcribeTiktok: async () => ({ success: false }),
    transcribeYoutube: async () => ({ success: false }),
    transcribeMetaReel: async () => ({ success: false }),
    isMetaVideoUrl: () => false,
    performResearch: async () => ({ items: [] }),
    isNewsResearchOn: () => false,
    smartResearch: async () => null,
    logGeneration: async () => ({ success: true, caseId: 'CASE-PL08' }),
    getSession: async () => null,
    logPipeline: async () => {},
    createLogger: () => new Proxy({}, { get: () => () => {} }),
    isRawFactCompletenessGateEnabled: () => false,
    enforceRawFactCompleteness: async () => { throw new Error('ด่าน RAW ปิดในเทสนี้'); },
    persistFactualReviewOrThrow: async () => ({}),
    saveFactualReview: async () => ({}),
    saveAnalysis: async (id, analysisResult) => { S.calls.saveAnalysis += 1; S.saved.push({ id, analysisResult }); return { id }; },
    getBuiltinFallbackPrompt: () => ({ id: 'fallback_builtin', promptName: 'Built-in V12' }),
    isLegacyLengthOn: () => false,
    assignAngleClosings: () => [],
    closingTailMatches: () => false,
    breakdownRawSourceArgs: () => ({}),
    isCardAuthorityR6Enabled: () => false,
    cleanScrapedText: (s) => s,
    cookies: async () => ({ get: () => undefined }),
    runCorrectionPipeline: async (versions) => {
      S.calls.correction += 1;
      S.calls.correctionVersions += versions.length;
      return versions.map((v) => ({ ...v, _correctionApplied: true }));
    },
    getTopPrompts: async ({ excludePromptIds = [] }) => {
      const n = excludePromptIds.length + 1; // มุม 1 → card_1 · มุม 2 → card_2
      return {
        prompts: [{ id: `card_${n}`, promptName: `การ์ด ${n}`, tone: 'อบอุ่น', hookStyle: 'เปิดด้วยภาพ', _matchScore: 90, _matchType: 'AI_PICKED' }],
        newsAnalysis: { category: 'ข่าวน้ำดี' }, _promptLib: [{ id: 'lib' }], _catalogPicks: [],
      };
    },
    performSummarize: async (input) => {
      if (input.mode === 'extract') return { success: true, data: { newsTitle: 'ลุงเก็บขยะคืนเงินสองหมื่นห้า', newsBody: THAI_BODY.repeat(2) } };
      if (input.mode === 'breakdown') {
        return { success: true, data: { key_points: ['เก็บกระเป๋าได้', 'คืนเจ้าของ'], primaryCategory: 'ข่าวน้ำดี', core_story: 'ความซื่อสัตย์', possible_angles: ANGLES } };
      }
      if (input.mode === 'blueprint') return { success: true, data: { blueprint: { core_emotion: 'ซึ้ง', emotional_timeline: [] } } };
      if (input.mode !== 'analyze') throw new Error(`unexpected mode ${input.mode}`);
      S.calls.analyzeStarted += 1;
      const cardId = input.presetPrompt?.id;
      const behavior = writer[cardId] || 'ok';
      if (behavior === 'throw') {
        S.calls.analyzeFailed += 1;
        throw new Error('AI ล้มเหลวครบทุกช่องทาง: claude-write: 529 overloaded, writer-sol: 503');
      }
      if (behavior === 'timeout') {
        S.calls.analyzeFailed += 1;
        const err = new Error(`TIMEOUT: generate_A${cardId === 'card_1' ? 1 : 2} ใช้เวลาเกิน 420s`); // รูปเดียวกับ withTimeout (ไม่รอเวลาจริง)
        err.failedStep = 'generate_A2';
        throw err;
      }
      if (behavior === 'deadline') {
        S.calls.analyzeFailed += 1;
        throw new PipelineDeadlineError('write_A2');
      }
      S.calls.analyzeBilled += 1; // = ค่าเขียนที่จ่ายแล้ว 1 ครั้ง
      const one = { style: 'แนว', title: `พาดหัว ${cardId}`, content: LONG_CONTENT(cardId) };
      const versions = behavior === 'extra_version'
        ? [one, { ...one, title: `พาดหัวเกิน ${cardId}`, content: LONG_CONTENT(`${cardId}b`) }]
        : behavior === 'empty_title' ? [{ ...one, title: '' }] : [one];
      return {
        success: true,
        data: {
          usedModel: 'claude-opus-5-5',
          versions,
          usedPreset: { id: 'library', name: `🏛️ การ์ด ${cardId}`, source: 'library', promptId: cardId, promptName: `การ์ด ${cardId}` },
          debug: { promptMatchReason: 'stub' },
        },
      };
    },
  };
  return S;
}

// autoFlowServiceText เรียก createLogger ตอนโหลดโมดูล → ต้องมีสถานะตัวปลอมก่อน import ครั้งแรก
globalThis.__PL08 = freshState();

async function loadAutoFlow(source = null, tag = 'real') {
  if (!source) return import(pathToFileURL(AUTO_FLOW_PATH).href);
  const encoded = Buffer.from(`${source}\n//# sourceURL=autoFlowServiceText-${tag}.mjs`, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${tag}`);
}

async function withEnv(value, fn) {
  const old = process.env.PARTIAL_ANGLES;
  if (value === undefined) delete process.env.PARTIAL_ANGLES;
  else process.env.PARTIAL_ANGLES = value;
  try {
    return await fn();
  } finally {
    if (old === undefined) delete process.env.PARTIAL_ANGLES;
    else process.env.PARTIAL_ANGLES = old;
  }
}

/** รันงานจริงหนึ่งงานใต้เส้นตาย 700s (นาฬิกาหยุดนิ่ง) · คืนผล + ตัวนับ · console เงียบ */
async function runScenario(mod, { writer = {}, mode } = {}) {
  globalThis.__PL08 = freshState(writer);
  const S = globalThis.__PL08;
  const logs = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a) => { const s = a.join(' '); if (s.includes('[AUTO-PIPELINE-SERVICE]')) logs.push(s); };
  console.warn = () => {};
  console.error = () => {};
  const { deadline } = manualPipelineDeadline(700_000);
  try {
    const run = withEnv(mode, () => runWithPipelineDeadline(deadline, () => mod.processAutoFlowText({
      text: THAI_BODY.repeat(2),
      sourceType: 'plain_text',
      workflowId: 'wf_pl08',
      user: { userId: 'u-pl08', userName: 'tester' },
    })));
    const res = await settleWithin(run, 'processAutoFlowText ไม่จบ (ตัวปลอมทุกตัวตอบทันที — ห้ามค้าง)');
    return { ok: res?.success === true, res, S, logs };
  } catch (error) {
    return { ok: false, error, S, logs };
  } finally {
    Object.assign(console, original);
  }
}

const MODES = [['ค่าเริ่มต้น (ใหม่)', undefined], ['PARTIAL_ANGLES=0 (เดิม)', '0']];

// ── ข้อสอบที่ใช้ซ้ำกับ mutation ──
async function assertPartialDelivery(mod) {
  const r = await runScenario(mod, { writer: { card_2: 'throw' } });
  assert.equal(r.ok, true, `มุม 2 ล้มแต่มุม 1 สำเร็จ ต้องส่งมุม 1 (ได้ ${r.error?.failedStep}: ${r.error?.message})`);
  const data = r.res.data;
  assert.equal(data.analysisResult.versions.length, 1);
  assert.equal(data.analysisResult.versions[0].promptId, 'card_1');
  assert.equal(data.analysisResult.versions[0]._sourceLabel, 'มุมความซื่อสัตย์');
  assert.deepEqual(data.angleGate.succeededAngles, ['มุมความซื่อสัตย์']);
  assert.equal(data.angleGate.failedAngles.length, 1);
  assert.equal(data.angleGate.failedAngles[0].angle, 'มุมค่าเทอมลูก');
  assert.match(data.angleGate.failedAngles[0].reason, /AI ล้มเหลวครบทุกช่องทาง/u);
  assert.equal(data.angleGate.plannedVersions, 2);
  assert.equal(data.angleGate.deliveredVersions, 1);
  const warning = data.analysisResult.qualityWarnings.find((w) => w.includes('มุมที่ล้ม: มุมค่าเทอมลูก'));
  assert.ok(warning, `ต้องมีคำเตือนมุมที่ล้มใน qualityWarnings: ${JSON.stringify(data.analysisResult.qualityWarnings)}`);
  assert.equal(r.S.calls.analyzeBilled, 1, 'ไม่เรียกนักเขียนซ้ำ');
  assert.equal(r.S.calls.correctionVersions, 1, 'correction รันกับฉบับที่รอดเท่านั้น');
  assert.equal(r.S.calls.saveAnalysis, 1, 'บันทึกเคสครั้งเดียว');
  assert.equal(r.S.saved[0].analysisResult.qualityWarnings.includes(warning), true, 'คำเตือนต้องถึงเคส workflow ที่บันทึก');
  return r;
}

test('A ทั้งสองมุมสำเร็จ: ส่ง 2 ฉบับเหมือนกันทั้ง 2 โหมด · ไม่มี angleGate', async () => {
  const mod = await loadAutoFlow();
  assert.deepEqual([...unknownSpecifiers], [], 'ต้อง stub import ของ autoFlowServiceText ครบ');
  for (const [label, mode] of MODES) {
    const r = await runScenario(mod, { mode });
    assert.equal(r.ok, true, `${label}: ${r.error?.message}`);
    assert.equal(r.res.data.analysisResult.versions.length, 2, label);
    assert.equal('angleGate' in r.res.data, false, `${label}: ครบทุกมุมต้องไม่มี angleGate`);
    assert.ok(r.logs.some((l) => l.includes('📊 รวมครบ 2/2 เวอร์ชัน')), label);
  }
});

test('B มุม 2 โซ่นักเขียนล้มครบ: ใหม่ = ส่งมุม 1 + ระบุมุมที่ล้ม · เดิม = ทิ้งทั้งงาน (ทำซ้ำบั๊ก)', async () => {
  const mod = await loadAutoFlow();
  const fresh = await withEnv(undefined, () => assertPartialDelivery(mod));
  assert.ok(fresh.logs.some((l) => l.includes('📊 รวมได้ 1/2 เวอร์ชัน')), 'log ต้องไม่อ้างว่า "รวมครบ"');

  const legacy = await runScenario(mod, { writer: { card_2: 'throw' }, mode: '0' });
  assert.equal(legacy.ok, false);
  assert.equal(legacy.error.failedStep, 'auto_generate_contract');
  assert.match(legacy.error.message, /^ผลเขียนไม่ครบทุกมุม \(1\/2 เวอร์ชัน\) — มุมค่าเทอมลูก: AI ล้มเหลวครบทุกช่องทาง/u);
  assert.equal(legacy.S.calls.analyzeBilled, 1, 'บั๊กเดิม: จ่ายค่าเขียนมุม 1 แล้ว');
  assert.equal(legacy.S.calls.correction, 0, 'บั๊กเดิม: correction ไม่ได้รัน');
  assert.equal(legacy.S.calls.saveAnalysis, 0, 'บั๊กเดิม: ไม่มีเคสถูกบันทึก');
});

test('C/D/F ผิดสัญญา (versions เกิน/title ว่าง) และหมดเวลาต่อมุม: ใหม่ = ตัดทั้งมุมแล้วส่งมุมที่ผ่าน · เดิม = ล้มทั้งงาน', async () => {
  const mod = await loadAutoFlow();
  const cases = [
    ['versions เกิน', { card_2: 'extra_version' }, /contract ไม่ครบ \(versions=2\/1/u],
    ['title ว่าง', { card_2: 'empty_title' }, /version 1 ไม่มี title\/content/u],
    ['หมดเวลาต่อมุม', { card_2: 'timeout' }, /TIMEOUT: generate_A2 ใช้เวลาเกิน 420s/u],
  ];
  for (const [label, writer, reasonRe] of cases) {
    const fresh = await runScenario(mod, { writer });
    assert.equal(fresh.ok, true, `${label}: ${fresh.error?.message}`);
    assert.equal(fresh.res.data.analysisResult.versions.length, 1, label);
    assert.equal(fresh.res.data.analysisResult.versions[0].promptId, 'card_1', `${label}: ห้ามพาฉบับผิดสัญญาติดออกมา`);
    assert.match(fresh.res.data.angleGate.failedAngles[0].reason, reasonRe, label);
    const legacy = await runScenario(mod, { writer, mode: '0' });
    assert.equal(legacy.ok, false, label);
    assert.equal(legacy.error.failedStep, 'auto_generate_contract', label);
  }
});

test('D2 มุมแรกล้ม มุมสองสำเร็จ: ส่งมุมสอง · การ์ด/preset มาจากฉบับที่รอด', async () => {
  const mod = await loadAutoFlow();
  const r = await runScenario(mod, { writer: { card_1: 'throw' } });
  assert.equal(r.ok, true, r.error?.message);
  const { data } = r.res;
  assert.deepEqual(data.analysisResult.versions.map((v) => v.promptId), ['card_2']);
  assert.equal(data.usedPromptInfo.promptId, 'card_2');
  assert.deepEqual(data.angleGate.succeededAngles, ['มุมค่าเทอมลูก']);
  assert.equal(data.angleGate.failedAngles[0].angle, 'มุมความซื่อสัตย์');
});

test('E ทุกมุมล้ม: ล้มทั้งงานเหมือนเดิมทั้ง 2 โหมด (ข้อความ/ขั้นเดิม)', async () => {
  const mod = await loadAutoFlow();
  for (const [label, mode] of MODES) {
    const r = await runScenario(mod, { writer: { card_1: 'throw', card_2: 'timeout' }, mode });
    assert.equal(r.ok, false, label);
    assert.equal(r.error.failedStep, 'auto_generate_contract', label);
    assert.match(r.error.message, /^ผลเขียนไม่ครบทุกมุม \(0\/2 เวอร์ชัน\)/u, label);
    assert.equal(r.S.calls.saveAnalysis, 0, label);
  }
});

test('G เส้นตายรวมระหว่างเขียนมุม 2: ยังล้มทั้งงานด้วยเส้นตายทั้ง 2 โหมด (ห้ามตีเป็นมุมล้มแล้วส่งบางส่วน)', async () => {
  const mod = await loadAutoFlow();
  for (const [label, mode] of MODES) {
    const r = await runScenario(mod, { writer: { card_2: 'deadline' }, mode });
    assert.equal(r.ok, false, label);
    assert.equal(r.error.errorType, 'PIPELINE_DEADLINE_EXCEEDED', label);
    assert.equal(r.S.calls.saveAnalysis, 0, label);
  }
});

test('สวิตช์ PARTIAL_ANGLES: ไม่ตั้ง/1/on/ค่าอื่น = ใหม่ · 0/legacy/off/false/no (ทนช่องว่าง/อัญประกาศ/ตัวพิมพ์) = เดิม', async () => {
  const { isPartialAnglesEnabled } = await loadAutoFlow();
  for (const value of [undefined, '', '1', 'on', 'true', 'yes', 'abc']) {
    assert.equal(isPartialAnglesEnabled({ PARTIAL_ANGLES: value }), true, String(value));
  }
  for (const value of ['0', ' 0 ', '"0"', "'0'", 'legacy', 'LEGACY', 'off', 'Off', 'false', 'no', ' No ']) {
    assert.equal(isPartialAnglesEnabled({ PARTIAL_ANGLES: value }), false, String(value));
  }
});

test('mutation: ทุบเงื่อนไขรวมผล/คำเตือน/พื้น ≥1 มุม แล้วข้อสอบต้องแดง', async () => {
  const mutations = [
    ['ปิดสวิตช์ในเงื่อนไขรวมผล', "  if (isPartialAnglesEnabled()\n      && angleFailures.length > 0", "  if (false\n      && angleFailures.length > 0"],
    ['ตัดคำเตือนเข้า qualityWarnings', '  if (angleGate?.warning) pipelineQualityWarnings.push(angleGate.warning);', '  void angleGate;'],
    ['ตัด angleGate ออกจาก data', '      ...(angleGate ? { angleGate } : {}),', ''],
  ];
  for (const [index, [label, search, replacement]] of mutations.entries()) {
    assert.ok(AUTO_FLOW_SOURCE.includes(search), `สร้าง mutation ไม่ได้: ${label}`);
    const mutated = await loadAutoFlow(AUTO_FLOW_SOURCE.replace(search, replacement), `mut-${index}`);
    await assert.rejects(withEnv(undefined, () => assertPartialDelivery(mutated)), `${label}: ข้อสอบต้องแดง`);
  }
  // พื้น ≥1 มุม: ปล่อยให้ 0 มุมผ่านเข้าทาง partial → ทุกมุมล้มต้องไม่กลายเป็นงานสำเร็จ 0 ฉบับ
  const floorSearch = '      && succeededAngleCount >= 1\n';
  assert.ok(AUTO_FLOW_SOURCE.includes(floorSearch));
  const noFloor = await loadAutoFlow(AUTO_FLOW_SOURCE.replace(floorSearch, ''), 'mut-floor');
  const r = await runScenario(noFloor, { writer: { card_1: 'throw', card_2: 'throw' } });
  assert.doesNotMatch(String(r.error?.message || ''), /^ผลเขียนไม่ครบทุกมุม \(0\/2 เวอร์ชัน\)/u,
    'ทุบพื้นแล้วเส้นทุกมุมล้มต้องเปลี่ยน (พิสูจน์ว่าพื้น ≥1 มุมคือสิ่งที่คงข้อความ/ขั้นเดิมไว้)');
});
