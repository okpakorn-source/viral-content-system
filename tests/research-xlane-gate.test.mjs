// ============================================================
// 🧪 tests/research-xlane-gate.test.mjs — เทสข้ามเลน A↔B ของ Research Agent v2 (เลน B เป็นเจ้าของ · ข้อตัดสินผู้คุมงาน 1 ต.ค. 69)
// ------------------------------------------------------------
// คำถาม: ระเบียนที่ worker (เลน A) สร้างจากผลจริงของเอเจนต์ เมื่อผ่าน /api/research/report (เลน B) แล้ว "ไม่ถูกเปลี่ยน" ใช่ไหม
//   fixture แล็บ out/out2 (tests/fixtures/research-agent/lab-out{,2}-result.json ของเลน A = ผลจริงของเอเจนต์ 1 ต.ค. 69)
//   → runGate (A: scripts/research-agent/gate.mjs) → buildCardRecord + validateCardRecord (A: scripts/research-agent/schema.mjs)
//   → buildResearchCardsDoc (B: src/lib/research-agent/cardsSchema.js) ต้องได้ schemaErrors=[] และ gateChanges=[]
//     และเอกสารที่ B เก็บ = ระเบียนของ A ทุกช่องตามสัญญา 2.2 (RECORD_KEYS ของ A) + ผ่าน validator ของ A
//   เหตุผล: ด่านฝั่งเว็บ "บีบได้อย่างเดียว" — ถ้า B เข้มกว่า A (กติกา token ไทย/เกณฑ์/เพจเราเอง) การ์ดที่ worker ให้ผ่านจะถูกลด
//   เป็น staff_only เงียบๆ (contract-check: claimAnchorTokens ของ B ≠ token ร่วม+คู่คำไทยของ A) · ระเบียน skipped/failed ก็ต้องผ่านตรง
// + heartbeat (contract-check #1 #2): body จริงของ worker (heartbeatBody ของ A) → โควตา/เวอร์ชันที่ route เลน B อ่านได้
//   (ก่อนแก้ worker ส่ง quotaPct แต่ route อ่าน quota → โควตาระหว่างงานไม่ถึง /api/research/status เลย)
// ที่อยู่ไฟล์เลน A: รากของ repo นี้ก่อน (หลังรวมเลนอยู่ repo เดียวกัน) → ไม่พบค่อยถอยไป C:\tmp\news-ra-a (worktree เลน A · Windows)
//   ไม่พบทั้งสองที่ = skip ชัดๆ พร้อมรายชื่อไฟล์ที่ขาด (ด่าน npm run test:news นับ skip เป็นแดง — ตอนรวมเลนต้องไม่ skip)
//   import ข้าม worktree ด้วย path ตรงอนุญาตเฉพาะไฟล์นี้ (ข้อตัดสินผู้คุมงาน)
// ไม่ต่อเน็ต ไม่แตะ DB ไม่เขียนไฟล์ · mutation (ข้อท้าย): ฝั่ง B เข้มขึ้น (คำไทยยึดโยง/ความมั่นใจ/ความยาวหลักฐาน/เพจเราเอง/
//   ตัด claim/ธงงอก/heartbeat ไม่อ่าน quota) และฝั่ง A หลวมลง/เปลี่ยนรูป (ระเบียน A ปล่อยการ์ดเพจเราเองเป็น pass ·
//   heartbeat เปลี่ยนชื่อช่องโควตา) — ข้อสอบต้องแดงทุกแบบ
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { importSource, installResearchHooks, replaceOnce, srcUrl } from './helpers/research-web-fakes.mjs';

// store.js ของ B ใช้ '@/…' — hook แปลงเป็นไฟล์จริงใต้ src · Supabase เป็นตัวปลอม (เทสนี้ไม่แตะฐาน)
installResearchHooks({ stubs: { '@/lib/supabase': 'export const isSupabaseReady = () => false; export const getSupabase = () => null;' } });

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LANE_A_FILES = Object.freeze({
  gate: 'scripts/research-agent/gate.mjs',
  schema: 'scripts/research-agent/schema.mjs',
  worker: 'scripts/research-agent-worker.mjs',
  out1: 'tests/fixtures/research-agent/lab-out-result.json',
  out2: 'tests/fixtures/research-agent/lab-out2-result.json',
});
const LANE_A_FALLBACK = 'C:/tmp/news-ra-a';
const missingIn = (root) => Object.values(LANE_A_FILES).filter((rel) => !existsSync(join(root, rel)));
const LANE_A_ROOT = [ROOT, ...(process.platform === 'win32' ? [LANE_A_FALLBACK] : [])].find((root) => missingIn(root).length === 0) || null;
const SKIP = LANE_A_ROOT
  ? false
  : `ไม่พบไฟล์เลน A (${missingIn(ROOT).join(', ')}) ทั้งใต้ราก repo และ ${LANE_A_FALLBACK} — ข้ามเทสข้ามเลน (ตอนรวมเลนต้องไม่ skip)`;

const B_SCHEMA_PATH = join(ROOT, 'src', 'lib', 'research-agent', 'cardsSchema.js');
const B_SCHEMA_SOURCE = readFileSync(B_SCHEMA_PATH, 'utf8').replace(/\r\n/g, '\n');
const B_STORE_SOURCE = readFileSync(join(ROOT, 'src', 'lib', 'research-agent', 'store.js'), 'utf8').replace(/\r\n/g, '\n');
const bSchema = await import(pathToFileURL(B_SCHEMA_PATH).href);
const bStore = await import(srcUrl('lib/research-agent/store.js'));
const laneA = LANE_A_ROOT
  ? {
    gate: await import(pathToFileURL(join(LANE_A_ROOT, LANE_A_FILES.gate)).href),
    schema: await import(pathToFileURL(join(LANE_A_ROOT, LANE_A_FILES.schema)).href),
    worker: await import(pathToFileURL(join(LANE_A_ROOT, LANE_A_FILES.worker)).href), // import เฉยๆ ไม่เริ่มลูป ไม่ยิงเน็ต
    out1: JSON.parse(readFileSync(join(LANE_A_ROOT, LANE_A_FILES.out1), 'utf8')),
    out2: JSON.parse(readFileSync(join(LANE_A_ROOT, LANE_A_FILES.out2), 'utf8')),
  }
  : null;

const JOB = 'q_xlane0001';
const CREATED_ISO = '2026-10-01T06:00:00.000Z';
const NOW_ISO = '2026-10-01T06:05:00.000Z';
// งบเดียวกับที่ worker ส่ง runGate (ค่าเริ่มต้นสเปก 24 calls / 6 นาที · เอเจนต์ใช้ไป 3 นาที)
const GATE_CTX = Object.freeze({ jobCreatedAt: CREATED_ISO, minutes: 3, maxCalls: 24, maxMinutes: 6, secretValues: [] });

/** ระเบียนแบบที่ worker ส่ง /report จริง: done ×2 (fixture แล็บ) + skipped (ข่าวดิบว่าง) + failed (ผลผิดสัญญา) */
function laneARecords() {
  const { runGate } = laneA.gate;
  const { buildCardRecord } = laneA.schema;
  const brain = { kind: 'codex', model: 'gpt-6-astra', effort: 'low', account: 'main', quotaPctAfter: 40 };
  const records = [];
  for (const [label, raw] of [['out', laneA.out1], ['out2', laneA.out2]]) {
    const gated = runGate(structuredClone(raw), { ...GATE_CTX });
    assert.equal(gated.ok, true, `${label}: fixture ต้องผ่าน schema ของ A (${(gated.errors || []).join(' | ')})`);
    records.push([label, buildCardRecord({ jobId: JOB, status: 'done', mode: 'shadow', brain, gated, nowIso: NOW_ISO })]);
  }
  records.push(['skipped', buildCardRecord({
    jobId: JOB, status: 'skipped', mode: 'shadow', brain: { kind: 'codex', effort: 'low', account: 'none' },
    flags: ['EMPTY_RAW'], skipped: ['ข่าวดิบว่าง'], nowIso: NOW_ISO,
  })]);
  const failedGate = runGate({}, { ...GATE_CTX });
  assert.equal(failedGate.ok, false, 'ผลว่าง {} ต้องไม่ผ่าน schema ของ A');
  records.push(['failed', buildCardRecord({ jobId: JOB, status: 'failed', mode: 'shadow', brain, gated: failedGate, nowIso: NOW_ISO })]);
  return records;
}

/** ระเบียนของ A ผ่าน B แล้วต้องเหมือนเดิมทุกช่อง (B ไม่บีบซ้ำ ไม่ตัด ไม่เติมธง) */
function assertLanesAgree(bMod, records) {
  const { validateCardRecord, RECORD_KEYS } = laneA.schema;
  assert.ok(Array.isArray(RECORD_KEYS) && RECORD_KEYS.length > 0, 'A ต้อง export RECORD_KEYS (สัญญา 2.2)');
  const gates = { pass: 0, staff_only: 0, dropped: 0 };
  for (const [label, rec] of records) {
    assert.deepEqual(validateCardRecord(rec), [], `${label}: ระเบียนของ A ต้องผ่านสัญญาของ A เอง`);
    const { doc, schemaErrors, gateChanges } = bMod.buildResearchCardsDoc(structuredClone(rec), { jobId: JOB, mode: rec.mode, nowIso: NOW_ISO });
    assert.deepEqual(schemaErrors, [], `${label}: B ต้องรับระเบียน A โดยไม่มี schema error`);
    assert.deepEqual(gateChanges, [], `${label}: B ต้องไม่บีบ/ตัดสิ่งที่ A ตัดสินแล้ว ${JSON.stringify(gateChanges)}`);
    assert.deepEqual(Object.keys(doc).sort(), [...RECORD_KEYS].sort(), `${label}: เอกสาร B มีช่องตรงสัญญา 2.2 ของ A`);
    for (const key of RECORD_KEYS) {
      if (key === 'flags') assert.deepEqual([...doc.flags].sort(), [...rec.flags].sort(), `${label}: ธงตรงกัน`);
      else assert.deepEqual(doc[key], rec[key], `${label}: ช่อง ${key} ต้องตรงกัน`);
    }
    assert.deepEqual(validateCardRecord(doc), [], `${label}: เอกสารที่ B เก็บต้องผ่าน validator ของ A`);
    for (const card of doc.cards) if (card.gate in gates) gates[card.gate] += 1;
  }
  assert.ok(gates.pass >= 1 && gates.staff_only >= 1,
    `fixture ต้องมีการ์ด pass และ staff_only อย่างละ ≥1 ใบ ไม่งั้นเทสนี้ไม่ได้ตรวจทิศใดทิศหนึ่ง (${JSON.stringify(gates)})`);
}

/** เกณฑ์ของ A ต้องเข้มเท่ากับหรือมากกว่า B (การ์ดที่ A ให้ผ่าน B จะได้ไม่ต้องบีบ) · เพจเราเองของ B ⊆ ของ A */
function assertThresholdsCompatible(bMod) {
  const { GATE_RULES, isOwnPage } = laneA.gate;
  for (const key of ['MIN_EVIDENCE_CHARS', 'MIN_CONFIDENCE', 'MAX_CARDS']) {
    assert.equal(typeof GATE_RULES?.[key], 'number', `A ต้อง export GATE_RULES.${key}`);
  }
  assert.ok(GATE_RULES.MIN_EVIDENCE_CHARS >= bMod.RESEARCH_MIN_EVIDENCE_CHARS,
    `หลักฐานขั้นต่ำ A ${GATE_RULES.MIN_EVIDENCE_CHARS} < B ${bMod.RESEARCH_MIN_EVIDENCE_CHARS}`);
  assert.ok(GATE_RULES.MIN_CONFIDENCE >= bMod.RESEARCH_MIN_PASS_CONFIDENCE,
    `ความมั่นใจขั้นต่ำ A ${GATE_RULES.MIN_CONFIDENCE} < B ${bMod.RESEARCH_MIN_PASS_CONFIDENCE}`);
  assert.ok(GATE_RULES.MAX_CARDS <= bMod.RESEARCH_MAX_DISPLAY_CARDS, `การ์ดสูงสุด A ${GATE_RULES.MAX_CARDS} > B ${bMod.RESEARCH_MAX_DISPLAY_CARDS}`);
  const urls = [
    'https://www.facebook.com/IG.dara/posts/pfbid02xtmH9UpCU2yNs9dKTV6R9ZgeQyrXm7EU97zBkZ64t9MrSAXTe4jxBsyzLoiaKK1el',
    'https://m.facebook.com/ig.dara/videos/1', 'https://mbasic.facebook.com/IG.dara', 'https://web.facebook.com/IG.dara/',
    'https://fb.com/IG.dara', 'https://www.facebook.com/IG%2Edara/posts/1', 'https://www.facebook.com/tapeanews/posts/1649392430310047/',
    'https://www.facebook.com/groups/123/posts/456', 'https://news.example.test/ig.dara', 'https://www.youtube.com/watch?v=abc',
  ];
  let ownSeen = 0;
  for (const url of urls) {
    if (!bMod.isOwnPageUrl(url)) continue;
    ownSeen += 1;
    assert.equal(isOwnPage(url), true, `B นับ ${url} เป็นเพจเราเอง แต่ A ไม่นับ → B จะบีบการ์ดที่ A ให้ผ่าน`);
  }
  assert.ok(ownSeen >= 5, `ตาราง URL ต้องมีเพจเราเองที่ B จับได้ (${ownSeen})`);
}

/** body heartbeat ของ worker (A) → ค่าที่ route heartbeat ของ B ดึงไปเก็บที่ชีพจร (workerQuotaFromBody · normalizeWorkerVersion) */
function assertHeartbeatAgree(storeMod, worker) {
  const { heartbeatBody, PROTOCOL } = worker;
  assert.equal(typeof heartbeatBody, 'function', 'A ต้อง export heartbeatBody (body ของ POST /api/research/heartbeat)');
  assert.equal(typeof PROTOCOL, 'string', 'A ต้อง export PROTOCOL');
  const body = heartbeatBody({ jobId: JOB, workerId: 'owner-pc', account: 'b', remainingPct: 13 });
  assert.deepEqual(storeMod.workerQuotaFromBody(body), { pct: 13, account: 'b' }, 'โควตาระหว่างทำงานของ A ต้องถึงชีพจรของ B (contract-check #1)');
  assert.equal(storeMod.normalizeWorkerVersion(body.version), PROTOCOL, 'เวอร์ชันใน body ของ A ต้องผ่านตัวกรองของ B (contract-check #2)');
  assert.ok(storeMod.RESEARCH_WORKER_ID_RE.test(body.workerId) && storeMod.RESEARCH_JOB_ID_RE.test(body.jobId), 'workerId/jobId ของ A ต้องผ่าน regex ของ B');
  const unknown = heartbeatBody({ jobId: JOB, workerId: 'owner-pc' });
  assert.equal(storeMod.workerQuotaFromBody(unknown), null, 'ไม่รู้โควตา = ไม่มีรายงาน (ไม่ใช่ 0%)');
  assert.equal(storeMod.normalizeWorkerVersion(unknown.version), PROTOCOL);
}

test('ข้ามเลน A→B: fixture แล็บ out/out2 (+ระเบียน skipped/failed) ผ่าน runGate+buildCardRecord ของ A แล้ว buildResearchCardsDoc ของ B ต้อง gateChanges ว่างและเก็บตรงทุกช่อง', { skip: SKIP }, (t) => {
  t.diagnostic(`ไฟล์เลน A จาก: ${LANE_A_ROOT}`);
  assertLanesAgree(bSchema, laneARecords());
});

test('ข้ามเลน A→B: เกณฑ์ด่านของ A เข้ม ≥ B (หลักฐาน ≥20 ตัว · ความมั่นใจ ≥0.6 · การ์ด ≤8) · เพจเราเองของ B เป็นส่วนย่อยของ A', { skip: SKIP }, () => {
  assertThresholdsCompatible(bSchema);
});

test('ข้ามเลน A→B heartbeat: body จริงของ worker (heartbeatBody) → โควตา quota.remainingPct + version ที่ route เลน B อ่านได้ (contract-check #1 #2)', { skip: SKIP }, () => {
  assertHeartbeatAgree(bStore, laneA.worker);
});

test('mutation ข้ามเลน: B เข้มกว่า A หรือ A หลวมกว่า B → ข้อสอบต้องแดง (และของจริงเขียว)', { skip: SKIP }, async () => {
  const records = laneARecords();
  const bMutations = [
    ['B: คำไทยยึดโยงต้องยาว ≥40 (กติกา token ห่างจาก A)', 'word.length >= 4 &&', 'word.length >= 40 &&', 'agree'],
    ['B: เกณฑ์ความมั่นใจ 0.99', 'export const RESEARCH_MIN_PASS_CONFIDENCE = 0.6;', 'export const RESEARCH_MIN_PASS_CONFIDENCE = 0.99;', 'both'],
    ['B: หลักฐานขั้นต่ำ 200 ตัวอักษร', 'export const RESEARCH_MIN_EVIDENCE_CHARS = 20;', 'export const RESEARCH_MIN_EVIDENCE_CHARS = 200;', 'both'],
    ['B: นับทุกเพจ facebook เป็นเพจเราเอง', "  return first.toLowerCase() === 'ig.dara';", '  return true;', 'both'],
    ['B: ตัด claim สั้นกว่าที่ A อนุญาต', '  const claim = capText(card.claim, 600);', '  const claim = capText(card.claim, 60);', 'agree'],
    ['B: เติมธง RAW_CONTRADICTION เอง',
      "  if (cards.some((c) => c.contradicts_raw && c.gate !== 'dropped') || rawCorrections.length > 0) flags.add('RAW_CONTRADICTION');",
      "  flags.add('RAW_CONTRADICTION');", 'agree'],
  ];
  for (const [index, [label, search, replacement, scope]] of bMutations.entries()) {
    // eslint-disable-next-line no-await-in-loop -- โหลดซอร์สกลายพันธุ์ทีละแบบ (ตรวจทีละแบบ)
    const mutated = await importSource(replaceOnce(B_SCHEMA_SOURCE, search, replacement, label), `xlane-b-mut-${index}`);
    assert.throws(() => assertLanesAgree(mutated, records), `${label}: ข้อสอบ fixture ต้องแดง`);
    if (scope === 'both') assert.throws(() => assertThresholdsCompatible(mutated), `${label}: ข้อสอบเกณฑ์ต้องแดง`);
  }
  // ฝั่ง A หลวมลง (จำลองที่ผลลัพธ์ ไม่แตะซอร์สเลน A): การ์ดจากเพจเราเองที่ A เคยกันไว้ถูกปล่อยเป็น pass → B ต้องบีบ = แดง
  const loose = structuredClone(records);
  const ownCard = loose.find(([label]) => label === 'out2')[1].cards.find((card) => card.gate === 'staff_only');
  assert.ok(ownCard, 'fixture out2 ต้องมีการ์ด staff_only (การ์ดเพจเราเอง)');
  ownCard.gate = 'pass';
  delete ownCard.gate_reason;
  assert.throws(() => assertLanesAgree(bSchema, loose), 'A ปล่อยการ์ดที่ B ต้องบีบ: ข้อสอบต้องแดง');
  // heartbeat: B กลับไปอ่านแต่ quotaPct (ไม่อ่าน quota ของสัญญาใหม่) → โควตาของ A หาย = แดง
  const storeMut = await importSource(replaceOnce(B_STORE_SOURCE, '  return normalizeQuotaReport(body.quota, body.account) ?? ', '  return ',
    'B: heartbeat ไม่อ่าน quota.remainingPct'), 'xlane-store-mut');
  assert.throws(() => assertHeartbeatAgree(storeMut, laneA.worker), 'B ไม่อ่าน quota ของ A: ข้อสอบต้องแดง');
  // heartbeat: A เปลี่ยนชื่อช่องโควตา (จำลองที่ผลลัพธ์ ไม่แตะซอร์สเลน A) → B อ่านไม่ได้ = แดง
  const driftWorker = {
    ...laneA.worker,
    heartbeatBody: (args) => {
      const body = laneA.worker.heartbeatBody(args);
      if (body.quota) { body.quotaRemaining = body.quota.remainingPct; delete body.quota; }
      return body;
    },
  };
  assert.throws(() => assertHeartbeatAgree(bStore, driftWorker), 'A เปลี่ยนชื่อช่องโควตา: ข้อสอบต้องแดง');
  // ของจริงเขียว
  assertLanesAgree(bSchema, records);
  assertThresholdsCompatible(bSchema);
  assertHeartbeatAgree(bStore, laneA.worker);
});
