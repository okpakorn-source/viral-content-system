// ============================================================
// 🧪 ท่าทาง/สภาพคนในภาพ (30 ก.ค. 69) — 2 ชั้นแยกกันเด็ดขาด
// ------------------------------------------------------------
// ชั้นที่ 1 "การรับรู้" — ตาคัดตอบ eyesClosed/lyingDown ใต้ MEGA_HERO_H_GATES โดยตรง
//   แยกจาก MEGA_UNGUARDED_TAG; ปิด H-gates = byte-parity
// ชั้นที่ 2 "นโยบาย" (คาลิเบรตจากสำมะโน hero 478 ใบ):
//   • MEGA_HERO_H_GATES          = default ON; ตัดภาพนอน/หลับตาออกจาก hero เมื่อมีตัวเลือกที่ผ่านจริง
//   • MEGA_HERO_UNGUARDED_BOOST  = default OFF; วิจัยรองรับ gate ไม่ใช่ booster
//   ทุกน้ำหนักตั้งได้ผ่าน env (MEGA_HERO_H_EVIDENCE_BONUS / MEGA_HERO_UNGUARDED_WEIGHT)
//
// พิสูจน์:
//   (ก) สคีมา/พรอมป์: OFF ไม่มีคำ/คีย์ใหม่เลย · ON ตอบ missing|bool|null ได้ · ค่าผิดชนิดยัง fail-closed
//   (ข) triage: ป้าย eyesClosed/lyingDown ถึงปลายทาง + ค่า null คงเป็น null + ไม่กระทบ unguardedScore
//   (ค) MEGA_HERO_H_GATES='0' = พฤติกรรมเดิมเป๊ะ (hero นอนก็ได้ขึ้น · ไม่มี meta/ธง/patch ใหม่)
//   (ง) default ON: มีตัวเลือกตื่นที่ eligible → สลับ · ไม่มีเลย → ใช้ต่อ + ธง hero_sleeping_kept
//   (จ) ON + ตาไม่รู้ (null/ไม่มีป้าย) = fail-open ไม่ตัดสิทธิ์ใคร
//   (ฉ) ตารางความจริง 9 ช่อง (eyesClosed × lyingDown) ของ "นับเป็นนอน/หลับไหม"
//   (ช) MEGA_HERO_UNGUARDED_BOOST OFF = ลำดับเดิมเป๊ะ · ON = ตัวตัดสินตอนหน้าใหญ่พอกัน
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const GEMINI_URL = new URL('../src/lib/gemini.js', import.meta.url).href;
const STUB_COST = 'data:text/javascript,' + encodeURIComponent('export async function recordLLM() { return null; }');
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
  if (specifier === './costStore.js' && context.parentURL === ${JSON.stringify(GEMINI_URL)}) {
    return { url: ${JSON.stringify(STUB_COST)}, shortCircuit: true };
  }
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`));

// เทสสาย s6 ต้องเดิน legacy ล้วน (เหมือน mega-hero-prominence.test.mjs)
for (const k of [
  'MEGA_SEMANTIC_SELECTION', 'MEGA_SELECTION_SPEC', 'MEGA_REF_SHOT_AUTHORITY', 'MEGA_SLOT_SOLVER_LIVE',
  'MEGA_REF_HERO_V2', 'MEGA_ROLE_READINESS', 'MEGA_FINAL_DECISION_EVIDENCE_V2', 'MEGA_CROSS_CASE_BORROW',
]) delete process.env[k];

const { geminiClassifyFrames, resolveGeminiClassifierPin, sanitizeStrictClassifierItem, computeUnguardedScore } = await import('../src/lib/gemini.js');
const { buildTriage } = await import('../src/lib/libraryTriage.js');
const { s6_slots } = await import('@/lib/megaAdapters');

// ── env helper ──
function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  return Promise.resolve().then(fn).finally(() => {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
}

// ══════════════════════════════════════════════════════════════
// ชั้นที่ 1 — การรับรู้ (gemini.js + libraryTriage.js)
// ══════════════════════════════════════════════════════════════
const ORIGINAL_FETCH = globalThis.fetch;
const FRAMES = [{ index: 0, base64: 'AAAA' }];
const SUBJECTS = [{ name: 'ทดสอบ' }];
const BASE_ENV = {
  FILE_SHOT_TAG: '0',
  MEGA_CLUTTER_GUARD: '0',
  MEGA_HERO_FRONTAL: undefined,
  MEGA_UNGUARDED_TAG: '0',
  GEMINI_API_KEY: 'test-key',
  GEMINI_MODEL: undefined,
};
const UG4 = { gazeAway: true, mouthOpen: false, inMotion: true, posedShot: false };
const POSE = { eyesClosed: false, lyingDown: false };
const item = (extra = {}) => ({
  index: 0, category: 'context', quality: 7, relevant: true,
  person: null, persons: [], emotion: 'none', clean: true,
  faceCount: 0, faceBox: null, peopleBox: null, note: '', ...extra,
});
const SRC = { realWidth: 1200, realHeight: 1600, brightness: 128, detail: 60, measuredFrom: 'full' };
const triOpts = (o = {}) => ({ strict: true, caseId: 'C', batchIndex: 0, resultIndex: 0, ...o, evidence: { requestedModel: 'gemini-2.5-flash', actualModel: null, actualModelVersion: 'gemini-2.5-flash', modelMatchMode: 'exact', provider: 'gemini', schemaVersion: 'gemini-classify-frames.v1', attemptCount: 1, repairCount: 0 } });

function stubFetch(capture, items) {
  globalThis.fetch = async (url, opts) => {
    capture.prompt = JSON.parse(opts.body).contents[0].parts[0].text;
    const pinModel = new URL(url).pathname.split('/models/')[1].split(':')[0];
    return {
      ok: true, status: 200,
      json: async () => ({ modelVersion: pinModel, candidates: [{ content: { parts: [{ text: JSON.stringify({ items }) }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }),
    };
  };
}

test('(ก1) OFF: พรอมป์/สคีมาไม่มีคำ eyesClosed/lyingDown เลย + item ที่ผ่านไม่มีคีย์ใหม่', async () => {
  const cap = {};
  await withEnv({ ...BASE_ENV, MEGA_HERO_H_GATES: '0' }, async () => {
    stubFetch(cap, [item()]);
    const r = await geminiClassifyFrames({ frames: FRAMES, subjects: SUBJECTS, newsGist: null, caseId: 'T', pin: resolveGeminiClassifierPin() });
    for (const k of ['eyesClosed', 'lyingDown']) {
      assert.ok(!new RegExp(k, 'i').test(cap.prompt), `OFF: พรอมป์ต้องไม่มีคำว่า ${k}`);
      assert.ok(!Object.prototype.hasOwnProperty.call(r.items[0], k), `OFF: item ต้องไม่มีคีย์ ${k}`);
    }
    assert.ok(!/นอน\/เอนราบ/.test(cap.prompt), 'OFF: ต้องไม่มีบล็อกคำอธิบายท่าทาง');
  });
  globalThis.fetch = ORIGINAL_FETCH;
});

test('(ก2) ON: พรอมป์ขอทั้งสองช่อง (nullable) + มีคำอธิบาย "หลับ" และ "นอน" ชัด', async () => {
  const cap = {};
  await withEnv({ ...BASE_ENV, MEGA_HERO_H_GATES: '1' }, async () => {
    stubFetch(cap, [item(POSE)]);
    const r = await geminiClassifyFrames({ frames: FRAMES, subjects: SUBJECTS, newsGist: null, caseId: 'T', pin: resolveGeminiClassifierPin() });
    assert.match(cap.prompt, /"eyesClosed": true\/false\/null/);
    assert.match(cap.prompt, /"lyingDown": true\/false\/null/);
    assert.match(cap.prompt, /ตาปิดสนิททั้งสองข้าง/);
    assert.match(cap.prompt, /นอน\/เอนราบ/);
    assert.equal(r.items[0].eyesClosed, false);
    assert.equal(r.items[0].lyingDown, false);
  });
  globalThis.fetch = ORIGINAL_FETCH;
});

test('(ก3) ON: ค่า bool|null ผ่าน · ชนิดอื่น (สตริง/ตัวเลข/undefined/object) ปฏิเสธทั้งใบ ไม่ coerce', () => {
  for (const v of [true, false, null]) {
    assert.ok(sanitizeStrictClassifierItem(item({ ...POSE, eyesClosed: v }), false, false, false, false, true) !== null, `eyesClosed=${v} ต้องผ่าน`);
    assert.ok(sanitizeStrictClassifierItem(item({ ...POSE, lyingDown: v }), false, false, false, false, true) !== null, `lyingDown=${v} ต้องผ่าน`);
  }
  for (const bad of ['true', 'false', 1, 0, undefined, {}, []]) {
    assert.equal(sanitizeStrictClassifierItem(item({ ...POSE, eyesClosed: bad }), false, false, false, false, true), null, `eyesClosed=${JSON.stringify(bad)}`);
    assert.equal(sanitizeStrictClassifierItem(item({ ...POSE, lyingDown: bad }), false, false, false, false, true), null, `lyingDown=${JSON.stringify(bad)}`);
  }
});

test('(ก4) H ON: pose เป็น optional ต่อใบ; โพรบ 3 ใบขาด lyingDown 1 ใบยังติดป้ายครบ', async () => {
  const missingBoth = sanitizeStrictClassifierItem(item(), false, false, false, false, true);
  assert.ok(missingBoth, 'ขาดทั้งคู่ = ไม่รู้ ไม่ใช่ schema failure');
  assert.ok(!Object.prototype.hasOwnProperty.call(missingBoth, 'eyesClosed'));
  assert.ok(!Object.prototype.hasOwnProperty.call(missingBoth, 'lyingDown'));
  const eyesOnly = sanitizeStrictClassifierItem(item({ eyesClosed: false }), false, false, false, false, true);
  assert.ok(eyesOnly, 'ขาด lyingDown = ไม่รู้ ไม่ใช่ schema failure');
  assert.equal(eyesOnly.eyesClosed, false);
  assert.ok(!Object.prototype.hasOwnProperty.call(eyesOnly, 'lyingDown'));

  const cap = {};
  const frames = [0, 1, 2].map((index) => ({ index, base64: 'AAAA' }));
  await withEnv({ ...BASE_ENV, MEGA_HERO_H_GATES: '1' }, async () => {
    stubFetch(cap, [
      item({ index: 0, ...POSE }),
      item({ index: 1, eyesClosed: false }),
      item({ index: 2, eyesClosed: null, lyingDown: null }),
    ]);
    const r = await geminiClassifyFrames({ frames, subjects: SUBJECTS, newsGist: null, caseId: 'T', pin: resolveGeminiClassifierPin() });
    assert.equal(r.items.length, 3, 'schema ต้องรับครบทั้ง 3 ใบ');
    const tagged = r.items
      .map((it, resultIndex) => buildTriage(it, SRC, triOpts({ heroPoseOn: true, resultIndex })))
      .filter(Boolean);
    assert.equal(tagged.length, 3, 'ขาด lyingDown หนึ่งใบต้องไม่ทำให้ทั้งแบตช์ tagged 0');
    assert.equal(tagged[1].eyesClosed, false);
    assert.ok(!Object.prototype.hasOwnProperty.call(tagged[1], 'lyingDown'));
  });
  globalThis.fetch = ORIGINAL_FETCH;
});

test('(ข1) triage: ป้ายท่าทางถึงปลายทาง + null คงเป็น null (ห้ามแปลงเป็น false)', () => {
  const t1 = buildTriage(item({ eyesClosed: true, lyingDown: true }), SRC, triOpts({ heroPoseOn: true }));
  assert.equal(t1.eyesClosed, true);
  assert.equal(t1.lyingDown, true);
  const t2 = buildTriage(item({ eyesClosed: null, lyingDown: null }), SRC, triOpts({ heroPoseOn: true }));
  assert.equal(t2.eyesClosed, null, '"ไม่รู้" ต้องคง null');
  assert.equal(t2.lyingDown, null);
  assert.notEqual(t2.eyesClosed, false);
});

test('(ข2) ป้ายท่าทางต้อง "ไม่" กระทบ unguardedScore (คนละมิติ — สูตรคะแนนอ่านแค่ 4 ป้ายเดิม)', () => {
  const base = computeUnguardedScore({ ...UG4, ...POSE });
  assert.equal(base, 2, 'gaze+motion = 2');
  for (const pose of [{ eyesClosed: true, lyingDown: true }, { eyesClosed: null, lyingDown: null }, {}]) {
    assert.equal(computeUnguardedScore({ ...UG4, ...pose }), base, `ท่าทาง ${JSON.stringify(pose)} ห้ามเปลี่ยนคะแนน`);
  }
  const t = buildTriage(item({ ...UG4, eyesClosed: null, lyingDown: true }), SRC, triOpts({ unguardedOn: true, heroPoseOn: true }));
  assert.equal(t.unguardedScore, 2, 'ท่าทางเป็น null ก็ยังคำนวณคะแนนได้ (คนละชุด)');
});

// ══════════════════════════════════════════════════════════════
// ชั้นที่ 2 — นโยบาย (megaAdapters s6_slots)
// ══════════════════════════════════════════════════════════════
const HERO = 'มะปราง';
const mkJob = () => ({
  dossier: {
    images: { caseId: 'CASE-HERO-AWAKE' },
    compass: { angle: 'มุมทดสอบ hero ตื่น', primaryEmotion: 'warm', secondaryEmotions: [], mainCharacters: [{ name: HERO, role: 'hero' }], visualDreamShots: [], doNotUse: [] },
    desk: { title: 'ข่าวทดสอบ hero ตื่น' },
    refMatch: { styleName: 'test-ref', typeMatched: false, imagePath: '', reason: 'weak-match-test' },
    artBrief: { storyNote: 'เรื่องทดสอบ', orders: [] },
  },
});
const fetchStub = (pool) => async (url) => (String(url).includes('/api/images/') ? { success: true, images: pool } : (() => { throw new Error('unexpected fetch: ' + url); })());
const NO_BRAIN = { slotDirectorBrain: async () => { throw new Error('test-stub-no-brain'); } };
const brainPicks = (id) => ({ slotDirectorBrain: async () => ({ slots: { hero: { id, reason: 'brain เลือกตรง (stub)' } }, note: 'stub-brain' }) });

// hero ทั้งสองใบ: หน้าใหญ่เท่ากัน (0.40) คุณภาพเท่ากัน ขนาดจริงผ่านเกณฑ์ — ต่างกัน "แค่ท่าทาง" อย่างเดียว
const heroBase = (id, pose, extraTriage = {}) => ({
  id, imageUrl: `https://cdn.test/${id}.jpg`, realWidth: 1400, realHeight: 1750,
  triage: {
    relevant: true, clean: true, faceCount: 1, person: HERO, persons: [HERO],
    category: 'face-emotional', emotion: 'warm', note: '', newsScene: true, quality: 8,
    faceBox: { x: 0.30, y: 0.1, w: 0.35, h: 0.40 }, ...pose, ...extraTriage,
  },
});
const SLEEPING = { eyesClosed: true, lyingDown: true };
const AWAKE = { eyesClosed: false, lyingDown: false };
const heroId = (r) => r.dossierPatch.pickImages.slots.hero?.id;

test("(ค1) MEGA_HERO_H_GATES='0': พูลเรียงภาพนอนมาก่อน → ยังได้ภาพนอนเป็น hero เหมือนเดิมเป๊ะ", async () => {
  await withEnv({ MEGA_HERO_H_GATES: '0' }, async () => {
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...NO_BRAIN, fetchJson: fetchStub([heroBase('SLEEP', SLEEPING), heroBase('AWAKE', AWAKE)]) } });
    assert.equal(r.status, 'done');
    assert.equal(heroId(r), 'SLEEP', 'OFF = ลำดับเดิม ไม่มีด่านใหม่ทำงาน');
    assert.equal(r.dossierPatch.pickImages.heroAwake, undefined, 'OFF ต้องไม่มี patch heroAwake');
  });
});

test("(ค2) H-gates='0' + boost='0': meta ที่ส่งให้สมองไม่มี field ใหม่ (พรอมป์เดิมเป๊ะ)", async () => {
  await withEnv({ MEGA_HERO_H_GATES: '0', MEGA_HERO_UNGUARDED_BOOST: '0' }, async () => {
    let meta = null;
    const brain = { slotDirectorBrain: async ({ imagesMeta }) => { meta = imagesMeta; return { slots: { hero: { id: 'AWAKE' } }, note: 's' }; } };
    await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...brain, fetchJson: fetchStub([heroBase('AWAKE', AWAKE)]) } });
    for (const m of meta) {
      for (const k of ['eyesClosed', 'lyingDown', 'unguarded']) assert.ok(!(k in m), `OFF ต้องไม่มี ${k} ใน meta`);
    }
  });
});

test('(ค3) พูลไม่มีป้ายท่าทางเลย: H ON ต้องเลือก hero เหมือน H=0 ทุกเคส รวมใบถูกคนที่ clean:false', async () => {
  const cases = [
    () => [
      heroBase('DIRTY-CORRECT-HIGH', {}, { clean: false, quality: 10 }),
      heroBase('CLEAN-CORRECT-LOW', {}, { clean: true, quality: 7 }),
    ],
    () => [
      heroBase('FIRST-NO-POSE', {}, { quality: 8 }),
      heroBase('SECOND-NO-POSE', {}, { quality: 8 }),
    ],
    () => {
      const wrong = heroBase('WRONG-PERSON-HIGH', {}, { quality: 10 });
      wrong.triage.person = 'คนอื่น';
      wrong.triage.persons = ['คนอื่น'];
      return [wrong, heroBase('CORRECT-PERSON', {}, { quality: 7 })];
    },
  ];

  for (const makePool of cases) {
    const select = (hGate) => withEnv({
      MEGA_HERO_H_GATES: hGate,
      MEGA_SECOND_EYE: '0',
      MEGA_HERO_FRONTAL: '0',
      MEGA_HERO_FACE_VISIBLE: '0',
    }, async () => {
      const r = await s6_slots(mkJob(), {
        origin: 'http://mock',
        _deps: { ...NO_BRAIN, fetchJson: fetchStub(makePool()) },
      });
      return heroId(r);
    });
    // eslint-disable-next-line no-await-in-loop
    const off = await select('0');
    // eslint-disable-next-line no-await-in-loop
    const on = await select('1');
    assert.equal(on, off, `ไม่มี pose label: H ON ต้องคง hero เดิม (${off})`);
  }
});

test('(ค4 mutation guard) _awakeOnly ต้องเช็กว่ามีใบนอนก่อนกรอง และกรองด้วยท่าทางล้วน', () => {
  const source = readFileSync(new URL('../src/lib/megaAdapters.js', import.meta.url), 'utf8');
  const body = source.match(/const _awakeOnly = \(arr\) => \{[\s\S]*?\n\s*\};/)?.[0] || '';
  assert.match(body, /arr\.some\(_heroAsleepOf\)/, 'ต้องคืน arr เดิมเมื่อไม่มีใบนอน; mutation ที่กรองทุกพูลต้องตาย');
  assert.match(body, /arr\.filter\(\(x\) => !_heroAsleepOf\(x\)\)/, 'ตัวกรองด่านนี้ต้องดูเฉพาะนอน/หลับตา');
  assert.doesNotMatch(body, /_eligibleAwakeHero/, 'ห้ามทิ้งใบถูกคนเพราะ clean/frontal/face-visible ใน _awakeOnly');

  const secondEyeCall = source.match(/const _se = await _runSecondEye\(\{[\s\S]*?\n\s*\}\);/)?.[0] || '';
  assert.match(secondEyeCall, /_hGateHasNonSleeping[\s\S]*heroCandidateAllowed:\s*\(x\) => !_heroAsleepOf\(x\)/,
    'caller production ต้องส่ง guard ท่าทางให้ตาสองเมื่อพูลยังมีใบไม่นอน');
  assert.doesNotMatch(secondEyeCall, /heroCandidateAllowed:\s*_eligibleAwakeHero/,
    'ตาสองห้ามใช้ eligibility เต็มชุดแทน predicate ท่าทาง');
  assert.ok(source.indexOf('let _heroAwakePatch = null;') > source.indexOf('const _se = await _runSecondEye({'),
    'ธง hero_sleeping_kept ต้องคำนวณหลังตาสองจบจาก hero ตัวจริงใบสุดท้าย');
});

test('(ค5) เมื่อมีใบนอนจริง ใบตื่นที่ถูกคนต้องชนะได้แม้ clean:false', async () => {
  await withEnv({
    MEGA_HERO_H_GATES: '1',
    MEGA_SECOND_EYE: '0',
    MEGA_HERO_FRONTAL: '0',
    MEGA_HERO_FACE_VISIBLE: '0',
  }, async () => {
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: {
        ...NO_BRAIN,
        fetchJson: fetchStub([
          heroBase('SLEEP-CLEAN', SLEEPING, { clean: true, quality: 10 }),
          heroBase('AWAKE-DIRTY-CORRECT', AWAKE, { clean: false, quality: 7 }),
        ]),
      },
    });
    assert.equal(heroId(r), 'AWAKE-DIRTY-CORRECT', 'ถูกคนและตื่นต้องไม่ถูก _eligibleAwakeHero ทิ้งเพราะ clean:false');
  });
});

test('(ง1) default ON + มีตัวเลือกตื่น → สลับจากภาพนอนเป็นภาพตื่น (fallback path)', async () => {
  await withEnv({ MEGA_HERO_H_GATES: undefined }, async () => {
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...NO_BRAIN, fetchJson: fetchStub([heroBase('SLEEP', SLEEPING), heroBase('AWAKE', AWAKE)]) } });
    assert.equal(r.status, 'done');
    assert.equal(heroId(r), 'AWAKE', 'ON ต้องข้ามภาพนอนไปหยิบภาพตื่น แม้ภาพนอนมาก่อนในลำดับ');
    assert.equal(r.dossierPatch.pickImages.heroAwake, undefined, 'สลับสำเร็จ = ไม่มีธง');
  });
});

test('(ง2) ON + สมองเลือกภาพนอนมาตรงๆ → ด่านสลับบังคับเปลี่ยนเป็นภาพตื่น + reason บอกเหตุผล', async () => {
  await withEnv({ MEGA_HERO_H_GATES: '1' }, async () => {
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...brainPicks('SLEEP'), fetchJson: fetchStub([heroBase('SLEEP', SLEEPING), heroBase('AWAKE', AWAKE)]) } });
    assert.equal(heroId(r), 'AWAKE');
    assert.match(r.dossierPatch.pickImages.slots.hero?.reason || '', /ตื่น/);
  });
});

test('(ง3) ON + ทั้งพูลนอนหมด → ไม่ทำงานตาย: ใช้ต่อได้ + ธง hero_sleeping_kept + patch heroAwake ครบ', async () => {
  await withEnv({ MEGA_HERO_H_GATES: '1' }, async () => {
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...NO_BRAIN, fetchJson: fetchStub([heroBase('SLEEP-A', SLEEPING), heroBase('SLEEP-B', { eyesClosed: true, lyingDown: false })]) } });
    assert.equal(r.status, 'done', '🔴 ห้าม HOLD — นโยบายยังไม่ผ่านการพิสูจน์');
    assert.ok(heroId(r), 'ต้องยังได้ hero');
    const p = r.dossierPatch.pickImages.heroAwake;
    assert.ok(p, 'ต้องมี patch heroAwake');
    assert.equal(p.sleepingKept, true);
    assert.equal(p.imageId, heroId(r));
    assert.equal(r.dossierPatch.pickImages.slots.hero._heroAwakeFlag, 'hero_sleeping_kept', 'ธงต้องติดที่ slot เพื่อต่อสายไป composer');
  });
});

test('(ง3b) awake ที่ผิดคนไม่ใช่ตัวเลือก hero: ต้องคงภาพนอนที่ถูกคนและติดธง H8', async () => {
  await withEnv({ MEGA_HERO_H_GATES: undefined }, async () => {
    const wrongPerson = heroBase('AWAKE-WRONG-PERSON', AWAKE);
    wrongPerson.triage.person = 'คนอื่น';
    wrongPerson.triage.persons = ['คนอื่น'];
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...brainPicks('SLEEP'), fetchJson: fetchStub([heroBase('SLEEP', SLEEPING), wrongPerson]) },
    });
    assert.equal(r.status, 'done');
    assert.equal(heroId(r), 'SLEEP', 'ห้ามใช้แค่สถานะตื่นกลบ identity gate');
    assert.equal(r.dossierPatch.pickImages.heroAwake?.sleepingKept, true);
  });
});

test('(ง3c) awake ต้องผ่าน frontal/face-visible gates ที่เปิดอยู่ จึงนับเป็นทางเลือก H5/H8 ได้', async () => {
  const sleepingFrontal = heroBase('SLEEP-FRONTAL', SLEEPING, { faceFront: 2 });
  const awakeSide = heroBase('AWAKE-SIDE', AWAKE, { faceFront: 1 });
  await withEnv({
    MEGA_HERO_H_GATES: undefined,
    MEGA_HERO_FRONTAL: '1',
    MEGA_HERO_FACE_VISIBLE: '0',
    MEGA_SECOND_EYE: '0',
  }, async () => {
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...brainPicks('SLEEP-FRONTAL'), fetchJson: fetchStub([sleepingFrontal, awakeSide]) },
    });
    assert.equal(r.status, 'done');
    assert.equal(heroId(r), 'SLEEP-FRONTAL', 'ภาพตื่นมุมข้างไม่ใช่ alternative เมื่อ frontal gate เปิด');
    assert.equal(r.dossierPatch.pickImages.heroAwake?.sleepingKept, true);
  });

  const sleepingVisible = heroBase('SLEEP-VISIBLE', SLEEPING);
  const awakeHidden = heroBase('AWAKE-HIDDEN', AWAKE);
  delete awakeHidden.triage.faceBox;
  await withEnv({
    MEGA_HERO_H_GATES: undefined,
    MEGA_HERO_FRONTAL: '0',
    MEGA_HERO_FACE_VISIBLE: '1',
    MEGA_SECOND_EYE: '0',
  }, async () => {
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...brainPicks('SLEEP-VISIBLE'), fetchJson: fetchStub([sleepingVisible, awakeHidden]) },
    });
    assert.equal(r.status, 'done');
    assert.equal(heroId(r), 'SLEEP-VISIBLE', 'ภาพตื่นที่วัดหน้าไม่ได้ไม่ใช่ alternative เมื่อ face-visible gate เปิด');
    assert.equal(r.dossierPatch.pickImages.heroAwake?.sleepingKept, true);
  });
});

test('(ง4) ON: "หลับตาอย่างเดียว" กับ "นอนอย่างเดียว" ต้องถูกตัดสิทธิ์ทั้งคู่ (OR ไม่ใช่ AND)', async () => {
  for (const pose of [{ eyesClosed: true, lyingDown: false }, { eyesClosed: false, lyingDown: true }]) {
    await withEnv({ MEGA_HERO_H_GATES: '1' }, async () => {
      const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...NO_BRAIN, fetchJson: fetchStub([heroBase('BAD', pose), heroBase('AWAKE', AWAKE)]) } });
      assert.equal(heroId(r), 'AWAKE', `pose ${JSON.stringify(pose)} ต้องถูกตัดสิทธิ์`);
    });
  }
});

test('(จ1) ON + ตาไม่รู้ (null) หรือไม่มีป้ายเลย → fail-open ไม่ตัดสิทธิ์ (ลำดับเดิม)', async () => {
  for (const pose of [{ eyesClosed: null, lyingDown: null }, {}]) {
    await withEnv({ MEGA_HERO_H_GATES: '1' }, async () => {
      const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...NO_BRAIN, fetchJson: fetchStub([heroBase('UNKNOWN', pose), heroBase('AWAKE', AWAKE)]) } });
      assert.equal(heroId(r), 'UNKNOWN', `pose ${JSON.stringify(pose)} = ไม่รู้ ห้ามตัดสิทธิ์`);
      assert.equal(r.dossierPatch.pickImages.heroAwake, undefined, '"ไม่รู้" ไม่นับเป็นนอน จึงไม่มีธง');
    });
  }
});

test('(จ2) ON: meta ส่งให้สมองมี eyesClosed/lyingDown เฉพาะใบที่ตาตอบจริง (null = ไม่ใส่ field)', async () => {
  await withEnv({ MEGA_HERO_H_GATES: '1' }, async () => {
    let meta = null;
    const brain = { slotDirectorBrain: async ({ imagesMeta }) => { meta = imagesMeta; return { slots: { hero: { id: 'AWAKE' } }, note: 's' }; } };
    await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...brain, fetchJson: fetchStub([heroBase('AWAKE', AWAKE), heroBase('UNKNOWN', { eyesClosed: null, lyingDown: null })]) } });
    const mA = meta.find((m) => m.id === 'AWAKE');
    const mU = meta.find((m) => m.id === 'UNKNOWN');
    assert.equal(mA.eyesClosed, false);
    assert.equal(mA.lyingDown, false);
    assert.equal(mU.eyesClosed, undefined);
    assert.ok(!('eyesClosed' in JSON.parse(JSON.stringify(mU))), 'หลัง JSON.stringify (ตัวจริงที่เข้าพรอมป์) ต้องไม่มี field');
  });
});

test('(ฉ) ตารางความจริง 9 ช่อง: (eyesClosed × lyingDown) → "นับเป็นนอน/หลับ" หรือไม่', async () => {
  // true=นับ · false/null=ไม่นับ (fail-open) — เขียนคำตอบไว้ตรงๆ ไม่ลอกสูตร
  const TABLE = [
    [true, true, true], [true, false, true], [true, null, true],
    [false, true, true], [false, false, false], [false, null, false],
    [null, true, true], [null, false, false], [null, null, false],
  ];
  for (const [eyesClosed, lyingDown, isSleeping] of TABLE) {
    await withEnv({ MEGA_HERO_H_GATES: undefined }, async () => {
      const r = await s6_slots(mkJob(), {
        origin: 'http://mock',
        _deps: { ...NO_BRAIN, fetchJson: fetchStub([heroBase('CAND', { eyesClosed, lyingDown }), heroBase('AWAKE', AWAKE)]) },
      });
      assert.equal(heroId(r), isSleeping ? 'AWAKE' : 'CAND',
        `[eyesClosed=${eyesClosed}, lyingDown=${lyingDown}] ต้อง${isSleeping ? '' : 'ไม่'}ถูกตัดสิทธิ์`);
    });
  }
});

test('(ฉ2) H6: ภาพนอน/หลับตาได้ evidence bonus ใน circle และ kill-switch=0 คืนลำดับเดิม', async () => {
  const other = (id, pose = AWAKE) => {
    const rec = heroBase(id, pose);
    rec.triage.person = `คน-${id}`;
    rec.triage.persons = [rec.triage.person];
    rec.triage.category = 'face-neutral';
    rec.triage.emotion = 'none';
    return rec;
  };
  const pool = [
    heroBase('HERO', AWAKE),
    other('REACTION'), other('ACTION'), other('CONTEXT'),
    other('CIRCLE-AWAKE', AWAKE), other('CIRCLE-SLEEP', SLEEPING),
  ];
  const fixedBrain = {
    slotDirectorBrain: async () => ({
      slots: {
        hero: { id: 'HERO' },
        reaction: { id: 'REACTION' },
        action: { id: 'ACTION' },
        context: { id: 'CONTEXT' },
      },
      note: 'leave-circle-to-fallback',
    }),
  };
  const selectCircle = async (hGate) => withEnv({
    MEGA_HERO_H_GATES: hGate,
    MEGA_SECOND_EYE: '0',
  }, async () => {
    const job = mkJob();
    const r = await s6_slots(job, {
      origin: 'http://mock',
      _deps: { ...fixedBrain, fetchJson: fetchStub(pool) },
    });
    return r.dossierPatch.pickImages.slots.circle?.id;
  });
  assert.equal(await selectCircle('0'), 'CIRCLE-AWAKE', 'OFF ต้องรักษาลำดับ legacy');
  assert.equal(await selectCircle(undefined), 'CIRCLE-SLEEP', 'default ON ต้องให้ evidence bonus ครอบคลุม circle');
});

test('(ฉ3) final reconciliation สลับสองทางได้เมื่อทางเลือกตื่นอยู่ใน circle', async () => {
  const dna = {
    panelCount: 3,
    template: {
      slots: [
        { role: 'circle', shape: 'circle', xPct: 70, yPct: 0, wPct: 30, hPct: 30 },
        { role: 'hero', shape: 'rect', xPct: 0, yPct: 0, wPct: 70, hPct: 100 },
        { role: 'context', shape: 'rect', xPct: 70, yPct: 30, wPct: 30, hPct: 70 },
      ],
    },
    slots: [
      { role: 'circle', shot: 'closeup' },
      { role: 'hero', shot: 'closeup' },
      { role: 'context', shot: 'wide' },
    ],
  };
  const context = heroBase('CONTEXT', AWAKE);
  context.triage.person = 'ฉาก';
  context.triage.persons = ['ฉาก'];
  const job = mkJob();
  job.dossier.refMatch = {
    dna,
    styleName: 'circle-first-test',
    typeMatched: true,
    imagePath: '/ref-covers/test.jpg',
  };
  job.dossier.artBrief = { storyNote: 'ทดสอบ circle-first', orders: [] };
  const brain = {
    slotDirectorBrain: async () => ({
      slots: {
        circle: { id: 'AWAKE-IN-CIRCLE' },
        hero: { id: 'SLEEP-IN-HERO' },
        context: { id: 'CONTEXT' },
      },
      note: 'circle comes before hero',
    }),
  };
  await withEnv({
    MEGA_HERO_H_GATES: undefined,
    MEGA_SEMANTIC_SELECTION: '1',
    MEGA_SELECTION_SPEC: '1',
    MEGA_CROP_PREFILTER: '0',
    MEGA_HERO_MIN_SOURCE: '0',
    MEGA_SECOND_EYE: '0',
    MEGA_PERSON_DIVERSITY: '0',
  }, async () => {
    const r = await s6_slots(job, {
      origin: 'http://mock',
      _deps: {
        ...brain,
        fetchJson: fetchStub([
          heroBase('AWAKE-IN-CIRCLE', AWAKE),
          heroBase('SLEEP-IN-HERO', SLEEPING),
          context,
        ]),
      },
    });
    assert.equal(r.status, 'done');
    assert.equal(r.dossierPatch.pickImages.slots.hero?.id, 'AWAKE-IN-CIRCLE');
    assert.equal(r.dossierPatch.pickImages.slots.circle?.id, 'SLEEP-IN-HERO');
    assert.equal(r.dossierPatch.pickImages.heroAwake, undefined, 'มี awake alternative จริงจึงห้ามติดธง sleeping_kept');
  });
});

test('(ช1) MEGA_HERO_UNGUARDED_BOOST OFF (default): หน้าใหญ่เท่ากัน → ลำดับเดิมชนะ (คะแนนธรรมชาติไม่มีผล)', async () => {
  for (const offValue of [undefined, '0']) {
    // Each iteration mutates the same process env and must finish before the next value.
    // eslint-disable-next-line no-await-in-loop
    await withEnv({ MEGA_HERO_UNGUARDED_BOOST: offValue }, async () => {
      const r = await s6_slots(mkJob(), {
        origin: 'http://mock',
        _deps: { ...NO_BRAIN, fetchJson: fetchStub([heroBase('POSED', {}, { unguardedScore: 0 }), heroBase('CANDID', {}, { unguardedScore: 3 })]) },
      });
      assert.equal(heroId(r), 'POSED', `OFF=${String(offValue)} ต้องคงลำดับเดิม`);
    });
  }
});

test('(ช2) ON: หน้าใหญ่เท่ากัน → ใบที่จังหวะธรรมชาติสูงกว่าชนะ (ตัวตัดสินตอนสูสี)', async () => {
  await withEnv({ MEGA_HERO_UNGUARDED_BOOST: '1' }, async () => {
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...NO_BRAIN, fetchJson: fetchStub([heroBase('POSED', {}, { unguardedScore: 0 }), heroBase('CANDID', {}, { unguardedScore: 3 })]) },
    });
    assert.equal(heroId(r), 'CANDID', 'ON ต้องยกใบจังหวะธรรมชาติขึ้นมาชนะ');
  });
});

test('(ช3) ON: น้ำหนักต้องไม่ล้มขนาดหน้า — หน้าใหญ่กว่าชัดเจนต้องชนะแม้คะแนนธรรมชาติ 0', async () => {
  await withEnv({ MEGA_HERO_UNGUARDED_BOOST: '1' }, async () => {
    const big = heroBase('BIGFACE', {}, { unguardedScore: 0 });
    const small = heroBase('CANDID-SMALL', {}, { unguardedScore: 3 });
    big.triage.faceBox = { x: 0.28, y: 0.08, w: 0.38, h: 0.45 };
    small.triage.faceBox = { x: 0.35, y: 0.1, w: 0.3, h: 0.32 }; // ต่าง 0.13 > โบนัสสูงสุดปริยาย 0.10
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...NO_BRAIN, fetchJson: fetchStub([small, big]) } });
    assert.equal(heroId(r), 'BIGFACE', 'ขนาดหน้าต่างกัน 0.13 ต้องชนะโบนัสธรรมชาติเต็ม (0.10)');
  });
});

test('(ช4) น้ำหนักตั้งได้ผ่าน env — ยกเป็น 0.5 แล้วใบธรรมชาติหน้าเล็กกว่าพลิกชนะได้', async () => {
  await withEnv({ MEGA_HERO_UNGUARDED_BOOST: '1', MEGA_HERO_UNGUARDED_WEIGHT: '0.5' }, async () => {
    const big = heroBase('BIGFACE', {}, { unguardedScore: 0 });
    const small = heroBase('CANDID-SMALL', {}, { unguardedScore: 3 });
    small.triage.faceBox = { x: 0.35, y: 0.1, w: 0.3, h: 0.32 };
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...NO_BRAIN, fetchJson: fetchStub([small, big]) } });
    assert.equal(heroId(r), 'CANDID-SMALL', 'น้ำหนัก 0.5 > ส่วนต่างหน้า 0.08 → พลิก');
  });
});
