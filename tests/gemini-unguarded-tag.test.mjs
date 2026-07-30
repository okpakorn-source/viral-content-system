// ============================================================
// 🧪 MEGA_UNGUARDED_TAG (30 ก.ค. 69) — "ตาคัดภาพ" มองเห็นมิติ unguarded/candid (ภาพจังหวะธรรมชาติ)
// ------------------------------------------------------------
// หลักฐานที่มาของฟีเจอร์: วิจัยปกจริง 390 viral vs 124 fail — "UNGUARDED CAPTURE" (ตาไม่มองกล้อง /
//   ปากกำลังพูด / กำลังเคลื่อนไหว / ไม่โพสท่า) พบใน viral 92% แต่ fail 29% (p=0.0001) — ระบบเดิมไม่มีมิตินี้เลย
//
// สวิตช์: process.env.MEGA_UNGUARDED_TAG === '1' เท่านั้นถึงเปิด (default OFF — dormant รอผู้บริโภคฝั่งให้คะแนน
//   hero แบตช์ถัดไป) · OFF ต้อง byte-parity 100% (ไม่มีคำใหม่ในพรอมป์/ไม่มีคีย์ใหม่ในสคีมา/ผลลัพธ์เดิมเป๊ะ)
//
// พิสูจน์:
//   (ก) OFF — prompt ที่ยิงจริง "เท่ากันทุกไบต์" กับตอนที่ไม่มีตัวแปรนี้เลย + ไม่มีคำ gazeAway/mouthOpen/
//       inMotion/posedShot + item ที่ parse กลับมาไม่มี 4 คีย์นี้ + triage record ไม่มี unguardedScore
//   (ข) ON + ตาตอบครบ 4 ช่อง → unguardedScore ถูกต้องทุกคอมบิเนชัน (ตารางความจริง 16 เคส) ทั้งที่
//       computeUnguardedScore ตรงๆ และปลายทางจริง (triage record จาก buildTriage)
//   (ค) คำตอบเก่าที่ไม่มีฟิลด์ใหม่: OFF = ผ่านเหมือนเดิมทุกประการ (guardExactObject ไม่ตีตก) ·
//       caller เก่าที่เรียก sanitizeStrictClassifierItem แบบ 3-4 args = พฤติกรรมเดิมเป๊ะ ·
//       ON แล้วตาไม่ตอบ = fail-closed (ปฏิเสธ ไม่เดา) ตาม precedent busy/faceFront
//   (ง) กับดัก Number(null)=0: ตาตอบ null (ไม่รู้) แม้ช่องเดียว → unguardedScore ต้อง undefined
//       ("วัดไม่ได้") ห้ามกลายเป็น 0 ("วัดได้ศูนย์") — ทั้งค่าที่คืนและคีย์ใน triage record
//
// วิธีทดสอบ prompt จริง: เหมือน gemini-busy-field.test.mjs — stub globalThis.fetch (จับ request body ที่จะยิงจริง)
// + stub ./costStore.js (กันเขียน data/cost-log.json) แล้วเรียก geminiClassifyFrames ตัวจริง ไม่มี network จริง
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const GEMINI_URL = new URL('../src/lib/gemini.js', import.meta.url).href;
const STUB_COST = 'data:text/javascript,' + encodeURIComponent(`
export async function recordLLM() { return null; }
`);
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === './costStore.js' && context.parentURL === ${JSON.stringify(GEMINI_URL)}) {
    return { url: ${JSON.stringify(STUB_COST)}, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const {
  geminiClassifyFrames,
  resolveGeminiClassifierPin,
  sanitizeStrictClassifierItem,
  computeUnguardedScore,
} = await import('../src/lib/gemini.js');
const { buildTriage } = await import('../src/lib/libraryTriage.js');

// ── env helper (คืนค่าเดิมเสมอ กันเทสอื่นเพี้ยน) ──
function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

const ORIGINAL_FETCH = globalThis.fetch;
after(() => {
  if (ORIGINAL_FETCH) globalThis.fetch = ORIGINAL_FETCH;
  else delete globalThis.fetch;
});

function makeFetchStub(capture, items) {
  return async (url, opts) => {
    capture.url = url;
    const body = JSON.parse(opts.body);
    capture.prompt = body.contents[0].parts[0].text;
    const pinModel = new URL(url).pathname.split('/models/')[1].split(':')[0];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        modelVersion: pinModel,
        candidates: [{ content: { parts: [{ text: JSON.stringify({ items }) }] } }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      }),
    };
  };
}

const FRAMES = [{ index: 0, base64: 'AAAA' }];
const SUBJECTS = [{ name: 'ทดสอบ' }];
const BASE_ENV = { FILE_SHOT_TAG: '0', MEGA_CLUTTER_GUARD: '0', MEGA_HERO_FRONTAL: undefined, GEMINI_API_KEY: 'test-key', GEMINI_MODEL: undefined };

// item รูปแบบ BASE (ธงอื่นปิดหมด — โฟกัสเฉพาะ 4 ฟิลด์ใหม่)
const baseItem = (extra = {}) => ({
  index: 0, category: 'context', quality: 7, relevant: true,
  person: null, persons: [], emotion: 'none', clean: true,
  faceCount: 0, faceBox: null, peopleBox: null, note: '', ...extra,
});
const UG_ALL = { gazeAway: true, mouthOpen: false, inMotion: true, posedShot: false };
const UG_KEYS = ['gazeAway', 'mouthOpen', 'inMotion', 'posedShot'];

async function runOnce(env, items) {
  const capture = {};
  await withEnv({ ...BASE_ENV, ...env }, async () => {
    globalThis.fetch = makeFetchStub(capture, items);
    const pin = resolveGeminiClassifierPin();
    capture.result = await geminiClassifyFrames({ frames: FRAMES, subjects: SUBJECTS, newsGist: 'แก่นข่าวทดสอบ', caseId: 'TEST-UG', pin });
  });
  return capture;
}

// ═══════════════ (ก) สวิตช์ OFF = byte-parity ═══════════════

test('(ก1) OFF (unset): prompt ไม่มีคำใหม่เลย + item ที่ผ่านสคีมาไม่มี 4 คีย์ใหม่', async () => {
  const cap = await runOnce({ MEGA_UNGUARDED_TAG: undefined }, [baseItem()]);
  for (const k of UG_KEYS) {
    assert.ok(!new RegExp(k, 'i').test(cap.prompt), `OFF: prompt ต้องไม่มีคำว่า ${k} เลย`);
  }
  assert.ok(!/จังหวะธรรมชาติ/.test(cap.prompt), 'OFF: prompt ต้องไม่มีบล็อกคำอธิบายใหม่');
  for (const k of UG_KEYS) {
    assert.ok(!Object.prototype.hasOwnProperty.call(cap.result.items[0], k), `OFF: item ต้องไม่มีคีย์ ${k}`);
  }
});

test('(ก2) OFF: prompt "เท่ากันทุกไบต์" ทุกค่าที่ไม่ใช่ \'1\' (unset/\'0\'/\'true\'/\'ON\'/\' 1\') — kill-switch ต้องเป็น ==="1" เป๊ะ', async () => {
  const baseline = (await runOnce({ MEGA_UNGUARDED_TAG: undefined }, [baseItem()])).prompt;
  for (const v of ['0', 'true', 'ON', ' 1', '2', '']) {
    const cap = await runOnce({ MEGA_UNGUARDED_TAG: v }, [baseItem()]);
    assert.equal(cap.prompt, baseline, `MEGA_UNGUARDED_TAG=${JSON.stringify(v)} ต้องยังปิดอยู่ + prompt เท่ากันทุกไบต์`);
  }
});

test('(ก3) OFF: ตาแอบตอบ 4 ฟิลด์มาเอง (ไม่ได้ขอ) → ปฏิเสธทั้งแบตช์เหมือนเดิม (extra key = SCHEMA_VALIDATION_FAILED ไม่ใช่ auto-accept)', async () => {
  await withEnv({ ...BASE_ENV, MEGA_UNGUARDED_TAG: undefined }, async () => {
    globalThis.fetch = makeFetchStub({}, [baseItem(UG_ALL)]);
    const pin = resolveGeminiClassifierPin();
    await assert.rejects(
      geminiClassifyFrames({ frames: FRAMES, subjects: SUBJECTS, newsGist: null, caseId: 'TEST-UG', pin }),
      (err) => err.errorType === 'SCHEMA_VALIDATION_FAILED',
    );
  });
});

test('(ก4) OFF: triage record เดิมเป๊ะ — ไม่มี 4 ฟิลด์ ไม่มี unguardedScore', () => {
  const t = buildTriage(baseItem(), SRC, opts());
  assert.ok(t, 'ต้องได้ triage');
  for (const k of [...UG_KEYS, 'unguardedScore']) {
    assert.ok(!Object.prototype.hasOwnProperty.call(t, k), `OFF: triage ต้องไม่มีคีย์ ${k}`);
  }
});

// ═══════════════ (ข) เปิดสวิตช์ + ตาตอบครบ ═══════════════

test('(ข1) ON: prompt มีทั้งใน JSON template และบล็อกคำอธิบาย + item ที่ตอบกลับผ่านสคีมาจริง', async () => {
  const cap = await runOnce({ MEGA_UNGUARDED_TAG: '1' }, [baseItem(UG_ALL)]);
  assert.match(cap.prompt, /"gazeAway": true\/false\/null/, 'JSON template ต้องขอ gazeAway (nullable)');
  assert.match(cap.prompt, /"posedShot": true\/false\/null/, 'JSON template ต้องขอ posedShot (nullable)');
  assert.match(cap.prompt, /จังหวะธรรมชาติ/, 'ต้องมีบล็อกคำอธิบาย "จังหวะธรรมชาติ"');
  assert.match(cap.prompt, /ไม่ได้มองกล้อง/, 'คำอธิบาย gazeAway ต้องพูดถึง "ไม่ได้มองกล้อง"');
  const it = cap.result.items[0];
  assert.equal(it.gazeAway, true);
  assert.equal(it.mouthOpen, false);
  assert.equal(it.inMotion, true);
  assert.equal(it.posedShot, false);
});

// ตารางความจริง 16 เคส: [gazeAway, mouthOpen, inMotion, posedShot, expectedScore]
//   สูตร: (gazeAway+mouthOpen+inMotion) − (posedShot?1:0) คุมช่วง 0-3 (เขียนคำตอบไว้ตรงๆ ไม่คำนวณซ้ำจากสูตรเดิม
//   — ถ้าลอกสูตรมาเทสก็จะไม่มีวันจับบั๊กของสูตร)
const TRUTH_TABLE = [
  [false, false, false, false, 0],
  [false, false, false, true, 0], // −1 → คุมเป็น 0
  [false, false, true, false, 1],
  [false, false, true, true, 0],
  [false, true, false, false, 1],
  [false, true, false, true, 0],
  [false, true, true, false, 2],
  [false, true, true, true, 1],
  [true, false, false, false, 1],
  [true, false, false, true, 0],
  [true, false, true, false, 2],
  [true, false, true, true, 1],
  [true, true, false, false, 2],
  [true, true, false, true, 1],
  [true, true, true, false, 3],
  [true, true, true, true, 2],
];

test('(ข2) computeUnguardedScore: ถูกต้องครบ 16 คอมบิเนชัน + อยู่ในช่วง 0-3 เสมอ', () => {
  assert.equal(TRUTH_TABLE.length, 16, 'ตารางต้องครบ 2^4 = 16 แถว');
  for (const [gazeAway, mouthOpen, inMotion, posedShot, expected] of TRUTH_TABLE) {
    const got = computeUnguardedScore({ gazeAway, mouthOpen, inMotion, posedShot });
    assert.equal(got, expected, `[${gazeAway},${mouthOpen},${inMotion},${posedShot}] ต้องได้ ${expected} (ได้ ${got})`);
    assert.ok(got >= 0 && got <= 3, 'ต้องอยู่ในช่วง 0-3 เสมอ');
  }
});

const evidence = Object.freeze({
  requestedModel: 'gemini-2.5-flash', actualModel: null, actualModelVersion: null,
  modelMatchMode: 'exact', provider: 'gemini', schemaVersion: 'gemini-classify-frames.v1',
  attemptCount: 1, repairCount: 0,
});
const SRC = { im: { id: 'IMG-UG', source: 'google' }, realWidth: 1200, realHeight: 1500, measuredFrom: 'full' };
const opts = (extra = {}) => ({ strict: true, evidence, caseId: 'CASE-UNGUARDED', batchIndex: 0, resultIndex: 0, fileTagOn: false, busyOn: false, ...extra });

test('(ข3) ปลายทางจริง: triage record ได้ unguardedScore ถูกต้องครบ 16 คอมบิเนชัน + ป้ายดิบ 4 ตัวติดมาด้วย', () => {
  for (const [gazeAway, mouthOpen, inMotion, posedShot, expected] of TRUTH_TABLE) {
    const it = baseItem({ gazeAway, mouthOpen, inMotion, posedShot });
    const t = buildTriage(it, SRC, opts({ unguardedOn: true }));
    assert.ok(t, `[${gazeAway},${mouthOpen},${inMotion},${posedShot}] ต้องได้ triage ไม่ใช่ null`);
    assert.equal(t.unguardedScore, expected, `triage.unguardedScore ต้อง = ${expected}`);
    assert.equal(t.gazeAway, gazeAway);
    assert.equal(t.mouthOpen, mouthOpen);
    assert.equal(t.inMotion, inMotion);
    assert.equal(t.posedShot, posedShot);
  }
});

test('(ข4) ON: ทำงานร่วมกับธงอื่นได้ (fileTag + busy + frontal + unguarded พร้อมกัน — 4 ธงอิสระกัน)', async () => {
  const item = baseItem({ newsScene: true, busy: 1, peopleCount: 3, faceFront: 2, ...UG_ALL });
  const cap = await runOnce(
    { FILE_SHOT_TAG: '1', MEGA_CLUTTER_GUARD: '1', MEGA_HERO_FRONTAL: '1', MEGA_UNGUARDED_TAG: '1' },
    [item],
  );
  const got = cap.result.items[0];
  assert.equal(got.newsScene, true);
  assert.equal(got.busy, 1);
  assert.equal(got.faceFront, 2);
  assert.equal(got.gazeAway, true);
  const t = buildTriage(item, SRC, opts({ fileTagOn: true, busyOn: true, frontalOn: true, unguardedOn: true }));
  assert.ok(t, 'triage ต้องผ่านเมื่อทั้ง 4 ธงเปิดพร้อมกัน');
  assert.equal(t.unguardedScore, 2, 'gaze+motion = 2, ไม่โพส');
});

test('(ข5) ON: ค่าผิดชนิด (สตริง/ตัวเลข/undefined) → ปฏิเสธทั้งใบ ไม่ coerce', () => {
  for (const bad of ['true', 'false', 1, 0, undefined, {}, []]) {
    const it = baseItem({ ...UG_ALL, gazeAway: bad });
    assert.equal(
      sanitizeStrictClassifierItem(it, false, false, false, true), null,
      `gazeAway=${JSON.stringify(bad)} ต้องถูกปฏิเสธ (bool literal หรือ null เท่านั้น)`,
    );
  }
});

// ═══════════════ (ค) คำตอบเก่า / caller เก่า ═══════════════

test('(ค1) คำตอบเก่าไม่มีฟิลด์ใหม่ + สวิตช์ OFF → ผ่านเหมือนเดิมทุกประการ (guardExactObject ไม่ตีตก)', () => {
  const outOld3 = sanitizeStrictClassifierItem(baseItem(), false, false, false); // caller เก่า 4 args
  assert.ok(outOld3 !== null, 'item เก่า + caller เก่า ต้องผ่าน');
  const outOld2 = sanitizeStrictClassifierItem(baseItem(), false); // caller เก่ากว่า 2 args
  assert.ok(outOld2 !== null, 'caller 2 args (ยุคก่อน busyOn) ต้องยังผ่าน');
  const outNewArg = sanitizeStrictClassifierItem(baseItem(), false, false, false, false); // caller ใหม่ส่ง unguardedOn=false
  assert.ok(outNewArg !== null, 'ส่ง unguardedOn=false ต้องได้ผลเดิม');
  assert.deepEqual({ ...outOld3 }, { ...outNewArg }, 'ผลลัพธ์ต้องเหมือนกันทุกฟิลด์ (byte-parity ระดับค่า)');
  for (const k of UG_KEYS) assert.ok(!Object.prototype.hasOwnProperty.call(outOld3, k));
});

test('(ค2) triage record เก่า (ไม่มีป้าย unguarded) → consumer อ่าน .unguardedScore ได้ undefined ไม่ใช่ 0', () => {
  const t = buildTriage(baseItem(), SRC, opts());
  assert.equal(t.unguardedScore, undefined, '"ไม่มีข้อมูล" ต้องเป็น undefined (0 = วัดได้ศูนย์ คนละความหมาย)');
  assert.notEqual(t.unguardedScore, 0);
});

test('(ค3) ON แล้วตาไม่ตอบ 4 ฟิลด์ → fail-closed ปฏิเสธ (precedent เดียวกับ busy — คำตอบไม่ครบสัญญา ไม่เดาแทน)', () => {
  assert.equal(sanitizeStrictClassifierItem(baseItem(), false, false, false, true), null);
  assert.equal(buildTriage(baseItem(), SRC, opts({ unguardedOn: true })), null);
});

test('(ค4) item มีฟิลด์ใหม่ + caller ลืมส่ง unguardedOn (บั๊ก key-parity ซ้ำรอย 20-21 ก.ค.) → null — เทสนี้กันเผลอถอด unguardedOn ออกจาก vetImages/triageLibrary', () => {
  const t = buildTriage(baseItem(UG_ALL), SRC, opts());
  assert.equal(t, null, 'ชุดคีย์สองชั้นไม่ตรง ต้อง null (คือรูปแบบบั๊ก tagged 0 ที่เคยฆ่า production)');
});

// ═══════════════ (ง) กับดัก null → ห้ามกลายเป็น 0 ═══════════════

test('(ง1) ตาตอบ null (ไม่มีคนในรูป/ตัดสินไม่ได้) → item ผ่านสคีมา (ไม่ล้มทั้งแบตช์) แต่คะแนน = undefined', async () => {
  const nulls = { gazeAway: null, mouthOpen: null, inMotion: null, posedShot: null };
  const cap = await runOnce({ MEGA_UNGUARDED_TAG: '1' }, [baseItem(nulls)]);
  assert.equal(cap.result.items[0].gazeAway, null, 'null ต้องผ่านสคีมา (บทเรียน newsScene/faceFront: บังคับ bool ล้วน = 1 ใบล้มทั้งแบตช์)');
  assert.equal(computeUnguardedScore(baseItem(nulls)), undefined, 'null ทั้ง 4 = ไม่รู้ → undefined ห้ามเป็น 0');
});

test('(ง2) null ปนแม้ช่องเดียว → undefined (ห้าม Number(null)=0 แอบทำให้ "วัดไม่ได้" กลายเป็น "วัดได้ 0")', () => {
  for (const k of UG_KEYS) {
    const partial = { ...UG_ALL, [k]: null };
    assert.equal(computeUnguardedScore(partial), undefined, `${k}=null → ต้อง undefined`);
    // เคสอันตรายที่สุด: ทุกช่องเป็น false ยกเว้นช่องที่เป็น null → ถ้าโค้ดเผลอ coerce จะได้ 0 เนียนๆ
    const allFalse = { gazeAway: false, mouthOpen: false, inMotion: false, posedShot: false, [k]: null };
    assert.equal(computeUnguardedScore(allFalse), undefined, `${k}=null (ที่เหลือ false) ต้อง undefined ไม่ใช่ 0`);
  }
});

test('(ง3) triage record: null ปน → มีป้ายดิบ 4 ตัว (คงค่า null ตรงๆ) แต่ "ไม่มีคีย์" unguardedScore เลย', () => {
  const it = baseItem({ ...UG_ALL, inMotion: null });
  const t = buildTriage(it, SRC, opts({ unguardedOn: true }));
  assert.ok(t, 'ต้องยังได้ triage (ป้ายดิบยังมีประโยชน์)');
  assert.equal(t.inMotion, null, 'ค่า "ไม่รู้" ต้องคง null ตรงๆ ห้ามแปลงเป็น false');
  assert.equal(t.gazeAway, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(t, 'unguardedScore'), 'คำนวณไม่ได้ = ไม่มีคีย์เลย (ไม่ใช่ null/0)');
  assert.equal(t.unguardedScore, undefined);
});

test('(ง4) computeUnguardedScore: input ขยะ (null/undefined/สตริง/array/Proxy/getter) → undefined ไม่ throw ไม่คืน 0', () => {
  for (const bad of [null, undefined, 'x', 42, [], () => {}]) {
    assert.equal(computeUnguardedScore(bad), undefined, `input=${JSON.stringify(bad) ?? String(bad)} ต้อง undefined`);
  }
  assert.equal(computeUnguardedScore(new Proxy({ ...UG_ALL }, {})), undefined, 'Proxy = ปฏิเสธ (descriptor-first เหมือนทั้งไฟล์)');
  let getterCalled = false;
  const withGetter = { mouthOpen: false, inMotion: true, posedShot: false };
  Object.defineProperty(withGetter, 'gazeAway', { get() { getterCalled = true; return true; }, enumerable: true, configurable: true });
  assert.equal(computeUnguardedScore(withGetter), undefined, 'accessor = ถือว่าไม่มีค่า');
  assert.equal(getterCalled, false, 'ห้ามเรียก getter เด็ดขาด');
});
