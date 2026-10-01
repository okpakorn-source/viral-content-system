// ============================================================
// 🧪 tests/research-web-store.test.mjs — Research Agent v2 ฝั่งเว็บ (เลน B · 1 ต.ค. 69): modes · สัญญา 2.2 · store insert/cas
// ------------------------------------------------------------
// ไม่ต่อเน็ต ไม่แตะ DB จริง ไม่เขียนไฟล์ใน repo: Supabase = ตัวปลอมในหน่วยความจำ (tests/helpers/research-web-fakes.mjs)
//   ตัวปลอมมี PK = id ทั้งตาราง เหมือนของจริง → พิสูจน์ว่า row id ต้องมีคำนำหน้า (job_queue ใช้ jobId เป็น id อยู่แล้ว)
// fixture = ผลจริงของเอเจนต์ (แล็บ out/out2 · 1 ต.ค. 69) ในรูปสัญญา 2.2
// mutation (ต้องแดงจริง — ข้อสุดท้าย): ตัดคำนำหน้า row id · cas ไม่เช็ค revision · lease ไม่ดู deadline ·
//   ด่านฝั่งเว็บปลดการ์ดได้ (tighten → cap) · ตัดการจับเพจเราเอง · ปิดสวิตช์แล้วยังสร้างใบขอ ·
//   ★ รอบข้อตัดสินผู้คุมงาน 1 ต.ค. 69: เส้นตายกลับเป็นสูตรเดิม 7 นาที · caseId บังคับตัวเลข · ไม่รับ postedAt ของบอท ·
//   โควตาไม่อ่าน quotaPct (worker รุ่นแรก) · ไม่อ่าน quota.remainingPct (สัญญาใหม่)
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  agentResultOut1, agentResultOut2, createFakeSupabase, importSource, installResearchHooks, passingCard, replaceOnce, ROOT, srcUrl,
} from './helpers/research-web-fakes.mjs';

installResearchHooks({
  stubs: {
    '@/lib/supabase': 'export const isSupabaseReady = () => globalThis.__RA_SB_READY !== false; export const getSupabase = () => globalThis.__RA_SB;',
  },
});

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const STORE_SOURCE = read('src/lib/research-agent/store.js');
const SCHEMA_SOURCE = read('src/lib/research-agent/cardsSchema.js');

const modes = await import(srcUrl('lib/research-agent/modes.js'));
const schema = await import(srcUrl('lib/research-agent/cardsSchema.js'));
const store = await import(srcUrl('lib/research-agent/store.js'));

// เส้นตายที่ไม่ส่ง deadlineMin มา = อ่าน env ของโปรเซส → ถอดค่าที่เครื่องรันอาจตั้งไว้ให้เทสคิดจากค่าเริ่มต้น 15 นาทีเสมอ
delete process.env.RESEARCH_AGENT_DEADLINE_MIN;

const T0 = Date.parse('2026-10-01T06:00:00.000Z');
const NOW_ISO = '2026-10-01T06:05:00.000Z';

function clock(start = T0) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; return t; } };
}

// ── modes ─────────────────────────────────────────────────────────
test('modes: ปิดเป็นค่าเริ่มต้น เปิดเฉพาะ RESEARCH_AGENT=1 · shadow ไม่รอแม้ตั้ง WAIT_MS · assist 90s · เพดาน 180s', () => {
  for (const value of [undefined, '', '0', 'true', 'on', 'yes', '2']) assert.equal(modes.isResearchAgentOn({ RESEARCH_AGENT: value }), false, String(value));
  for (const value of ['1', ' 1 ', '"1"']) assert.equal(modes.isResearchAgentOn({ RESEARCH_AGENT: value }), true, value);
  assert.equal(modes.getResearchAgentMode({}), 'shadow');
  assert.equal(modes.getResearchAgentMode({ RESEARCH_AGENT_MODE: 'ASSIST' }), 'assist');
  assert.equal(modes.getResearchAgentMode({ RESEARCH_AGENT_MODE: 'write' }), 'write');
  assert.equal(modes.getResearchAgentMode({ RESEARCH_AGENT_MODE: 'yolo' }), 'shadow');
  assert.equal(modes.getResearchAgentWaitMs({ RESEARCH_AGENT_MODE: 'shadow', RESEARCH_AGENT_WAIT_MS: '90000' }), 0);
  assert.equal(modes.getResearchAgentWaitMs({ RESEARCH_AGENT_MODE: 'assist' }), 90_000);
  assert.equal(modes.getResearchAgentWaitMs({ RESEARCH_AGENT_MODE: 'assist', RESEARCH_AGENT_WAIT_MS: '15000' }), 15_000);
  // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ข้อตัดสิน #1 · เลน W1): write แยกเพดาน 300000 แล้ว — เพดาน 180000 คงตรวจที่ assist
  //   ของเดิม: assert getResearchAgentWaitMs({ RESEARCH_AGENT_MODE: 'write', RESEARCH_AGENT_WAIT_MS: '999999' }) === 180_000 (สมัยเฟส 1 write = assist)
  assert.equal(modes.getResearchAgentWaitMs({ RESEARCH_AGENT_MODE: 'assist', RESEARCH_AGENT_WAIT_MS: '999999' }), 180_000);
  assert.equal(modes.getResearchAgentWaitMs({ RESEARCH_AGENT_MODE: 'write', RESEARCH_AGENT_WAIT_MS: '999999' }), 300_000);
  assert.equal(modes.getResearchAgentWaitMs({ RESEARCH_AGENT_MODE: 'write' }), 300_000);
  assert.equal(modes.getResearchAgentWaitMs({ RESEARCH_AGENT_MODE: 'assist', RESEARCH_AGENT_WAIT_MS: 'abc' }), 90_000);
  assert.equal(modes.getResearchAgentQuotaAlertPct({}), 15);
});

test('modes: เส้นตายใบขอ RESEARCH_AGENT_DEADLINE_MIN ค่าเริ่มต้น 15 นาที · บีบ 1–120 · MAX_MINUTES (ของ worker) ไม่เกี่ยว', () => {
  assert.equal(modes.getResearchAgentDeadlineMin({}), 15);
  assert.equal(modes.getResearchAgentDeadlineMin({ RESEARCH_AGENT_DEADLINE_MIN: '25' }), 25);
  assert.equal(modes.getResearchAgentDeadlineMin({ RESEARCH_AGENT_DEADLINE_MIN: ' "30" ' }), 30);
  assert.equal(modes.getResearchAgentDeadlineMin({ RESEARCH_AGENT_DEADLINE_MIN: '0' }), 1);
  assert.equal(modes.getResearchAgentDeadlineMin({ RESEARCH_AGENT_DEADLINE_MIN: '9999' }), 120);
  assert.equal(modes.getResearchAgentDeadlineMin({ RESEARCH_AGENT_DEADLINE_MIN: 'abc' }), 15);
  assert.equal(modes.getResearchAgentDeadlineMin({ RESEARCH_AGENT_MAX_MINUTES: '9' }), 15, 'MAX_MINUTES เป็นงบต่องานของ worker — ไม่ใช่เส้นตายใบขอ');
  assert.equal('getResearchAgentMaxMinutes' in modes, false, 'ฝั่งเว็บไม่อ่าน MAX_MINUTES แล้ว');
});

test('modes: config ไม่มีค่า secret · ไม่มีตัวสร้าง limits ส่ง worker แล้ว (ข้อตัดสิน 1 ต.ค. 69: ค่างานอยู่ฝั่ง worker)', () => {
  const env = { RESEARCH_AGENT: '1', RESEARCH_AGENT_SECRET: 'S3CRET-VALUE-XYZ', RESEARCH_AGENT_EFFORT: 'medium', RESEARCH_AGENT_TOOLS: 'serper', RESEARCH_AGENT_DEADLINE_MIN: '20' };
  const config = modes.getResearchAgentConfig(env);
  assert.equal(config.secretConfigured, true);
  assert.equal(config.deadlineMin, 20);
  assert.equal('maxMinutes' in config, false);
  assert.doesNotMatch(JSON.stringify(config), /S3CRET-VALUE-XYZ/);
  assert.equal('getResearchAgentAdvisoryLimits' in modes, false, 'lease ไม่ส่ง limits — ฝั่งเว็บไม่มีตัวสร้างค่าให้ worker');
  assert.equal(modes.getResearchAgentSecret({ RESEARCH_AGENT_SECRET: '  ' }), '');
});

function assertWorkerQuotaBody(mod) {
  assert.deepEqual(mod.workerQuotaFromBody({ jobId: 'q_1', workerId: 'w1', version: 'research-lease-v1', account: 'b', quota: { remainingPct: 42 } }),
    { pct: 42, account: 'b' }, 'สัญญาใหม่ quota.remainingPct');
  assert.deepEqual(mod.workerQuotaFromBody({ workerId: 'w1', account: 'c', quotaPct: 9 }), { pct: 9, account: 'c' }, 'worker รุ่นแรก quotaPct');
  assert.deepEqual(mod.workerQuotaFromBody({ quota: { remainingPct: 30, account: 'main' }, quotaPct: 80 }), { pct: 30, account: 'main' }, 'quota ใหม่มาก่อน');
  assert.deepEqual(mod.workerQuotaFromBody({ quota: { remainingPct: null }, quotaPct: 12 }), { pct: 12, account: null }, 'quota ว่าง → ถอยไป quotaPct');
  for (const body of [{}, { quotaPct: 101 }, { quotaPct: '40' }, { quota: { remainingPct: -1 } }, null, 'x', []]) {
    assert.equal(mod.workerQuotaFromBody(body), null, JSON.stringify(body));
  }
}

test('workerQuotaFromBody (contract-check #1): รับ quota.remainingPct และ quotaPct · นอก 0–100/ไม่ใช่ตัวเลข = null · version เฉพาะอักขระปลอดภัย', () => {
  assertWorkerQuotaBody(store);
  assert.equal(store.normalizeWorkerVersion(' research-lease-v1 '), 'research-lease-v1');
  for (const value of ['<b>x</b>', 'x'.repeat(41), 42, '', null, 'a b']) assert.equal(store.normalizeWorkerVersion(value), null, String(value));
});

// ── สัญญา 2.2 + ด่านซ้ำฝั่งเว็บ ─────────────────────────────────
function assertOut1(mod) {
  const { doc, schemaErrors, gateChanges } = mod.buildResearchCardsDoc(agentResultOut1(), { jobId: 'q_out1', mode: 'shadow', nowIso: NOW_ISO });
  assert.deepEqual(schemaErrors, []);
  assert.equal(doc.id, 'q_out1');
  assert.equal(doc.status, 'done');
  assert.equal(doc.mode, 'shadow');
  assert.equal(doc.revision, 1);
  assert.deepEqual(doc.brain, { kind: 'codex', model: 'gpt-6-astra', effort: 'low', account: 'main', quotaPctAfter: 72 });
  assert.equal(doc.cards.length, 1);
  assert.equal(doc.cards[0].gate, 'pass', 'การ์ดที่มีหลักฐานคัดจากหน้าเว็บจริงต้องคงผ่าน');
  assert.equal(doc.cards[0].id, 'R1');
  assert.deepEqual(doc.origin_post, { url: null, source_name: 'ไม่พบต้นทางที่ตรงกับเรื่องชายชาวสวีเดน', date: 'ไม่ทราบ', confidence: 0 });
  assert.deepEqual(doc.flags, ['ORIGIN_NOT_FOUND']);
  assert.deepEqual(doc.feedback, []);
  assert.equal(doc.createdAt, NOW_ISO);
  assert.deepEqual(gateChanges, []);
  assert.deepEqual(mod.summarizeCardsDoc(doc), { status: 'done', cardsCount: 1, passCount: 1, staffOnlyCount: 0, droppedCount: 0, flags: ['ORIGIN_NOT_FOUND'] });
}

function assertOwnPage(mod) {
  const { doc, gateChanges } = mod.buildResearchCardsDoc(agentResultOut2(), { jobId: 'q_out2', mode: 'assist', nowIso: NOW_ISO });
  assert.deepEqual(doc.cards.map((c) => c.gate), ['staff_only', 'staff_only', 'staff_only'], 'การ์ดจากเพจเราเอง (IG.dara) ห้ามเป็นหลักฐานนักเขียน');
  for (const card of doc.cards) assert.match(card.gate_reason, /OWN_PAGE_SOURCE/);
  assert.match(doc.cards.find((c) => c.id === 'R3').gate_reason, /EVIDENCE_TOO_SHORT/);
  assert.equal(doc.origin_post.url, null, 'origin ที่เป็นเพจเรา = ถือว่าไม่พบ');
  assert.equal(doc.origin_post.confidence, 0);
  assert.ok(gateChanges.some((g) => g.reason === 'OWN_PAGE_ORIGIN'));
  assert.ok(doc.flags.includes('ORIGIN_NOT_FOUND'));
  assert.ok(doc.flags.includes('QUOTA_LOW'));
  assert.equal(mod.isOwnPageUrl('https://m.facebook.com/ig.dara/videos/1'), true);
  assert.equal(mod.isOwnPageUrl('https://www.facebook.com/tapeanews/posts/1'), false);
}

test('สัญญา 2.2: fixture out1 — การ์ดหลักฐานจริงคง pass · origin "ไม่พบ" = url null + ธง ORIGIN_NOT_FOUND', () => assertOut1(schema));

test('สัญญา 2.2: fixture out2 — การ์ด/ต้นทางจากเพจเราเอง (IG.dara) ถูกบีบเป็น staff_only/ไม่พบ · หลักฐานสั้นถูกจับ', () => assertOwnPage(schema));

function assertTightenOnly(mod) {
  const good = passingCard(1);
  const result = {
    ...agentResultOut1(),
    cards: [
      { ...good, id: 'R1', gate: 'staff_only' },
      { ...passingCard(2), id: 'R2', gate: 'dropped', gate_reason: 'blacklist' },
      { ...passingCard(3), id: 'R3', gate: undefined },
      { ...passingCard(4), id: 'R4', confidence: 0.59 },
      { ...passingCard(5), id: 'R5', source_url: 'javascript:alert(1)' },
      { ...passingCard(6), id: 'R6', evidence_quote: 'เมื่อวานฝนตกหนักมากจนน้ำท่วมถนนสายหลักทั้งเส้น' },
      { ...passingCard(7), id: 'R7', gate: 'dropped', confidence: 0.3, source_url: 'not a url' },
    ],
  };
  const { doc } = mod.buildResearchCardsDoc(result, { jobId: 'q_t', mode: 'assist', nowIso: NOW_ISO });
  const gate = Object.fromEntries(doc.cards.map((c) => [c.id, c.gate]));
  assert.equal(gate.R1, 'staff_only', 'worker กันไว้ = ฝั่งเว็บห้ามปลด');
  assert.equal(gate.R2, 'dropped', 'dropped ห้ามฟื้น');
  assert.equal(gate.R3, 'staff_only', 'ไม่มี gate = staff_only');
  assert.equal(gate.R4, 'staff_only', 'confidence < 0.6');
  assert.equal(gate.R5, 'staff_only', 'source_url ไม่ใช่ http(s)');
  assert.equal(gate.R6, 'staff_only', 'หลักฐานไม่มี token ร่วมกับ claim');
  assert.equal(gate.R7, 'dropped', 'dropped ที่ตกด่านอื่นด้วย ต้องไม่ถูก "บีบ" ขึ้นเป็น staff_only');
  assert.match(doc.cards.find((c) => c.id === 'R6').gate_reason, /EVIDENCE_NO_ANCHOR/);
  assert.equal(doc.cards.find((c) => c.id === 'R5').source_url, null);
  assert.equal(mod.summarizeCardsDoc(doc).cardsCount, 5, 'dropped ไม่นับเป็นการ์ดที่แสดงได้');
}

test('ด่านฝั่งเว็บบีบได้อย่างเดียว: staff_only/dropped ไม่ถูกปลด · gate หาย/conf ต่ำ/URL เสีย/หลักฐานไม่ยึด claim = staff_only', () => assertTightenOnly(schema));

test('schema ขาด = เอกสาร failed + SCHEMA_INVALID (สเปก 6.1) · failed/skipped ไม่บังคับ array', () => {
  const broken = { ...agentResultOut1(), cards: 'not-an-array', brain: { kind: 'robot' } };
  const { doc, schemaErrors } = schema.buildResearchCardsDoc(broken, { jobId: 'q_b', mode: 'shadow', nowIso: NOW_ISO });
  assert.equal(doc.status, 'failed');
  assert.ok(doc.flags.includes('SCHEMA_INVALID'));
  assert.ok(schemaErrors.some((e) => /cards/.test(e)) && schemaErrors.some((e) => /brain\.kind/.test(e)), schemaErrors.join(' | '));
  assert.deepEqual(doc.cards, []);
  assert.deepEqual(doc.schema_errors, schemaErrors);
  const notObject = schema.buildResearchCardsDoc(null, { jobId: 'q_b', mode: 'shadow', nowIso: NOW_ISO });
  assert.equal(notObject.doc.status, 'failed');
  const failed = schema.buildResearchCardsDoc({ status: 'failed', flags: ['QUOTA_LOW'] }, { jobId: 'q_f', mode: 'shadow', nowIso: NOW_ISO });
  assert.deepEqual(failed.schemaErrors, []);
  assert.equal(failed.doc.status, 'failed');
  assert.deepEqual(failed.doc.flags, ['QUOTA_LOW']);
  assert.equal(failed.doc.flags.includes('ORIGIN_NOT_FOUND'), false, 'งาน failed ไม่ต้องเติมธงต้นทาง');
});

function assertCapEight(mod) {
  const cards = Array.from({ length: 10 }, (_, i) => passingCard(i + 1, 0.6 + (i + 1) * 0.03));
  cards[9].id = 'R1'; // id ซ้ำ → ต้องแจกใหม่
  const { doc, gateChanges } = mod.buildResearchCardsDoc({ ...agentResultOut1(), cards }, { jobId: 'q_c', mode: 'assist', nowIso: NOW_ISO });
  const live = doc.cards.filter((c) => c.gate !== 'dropped');
  const dropped = doc.cards.filter((c) => c.gate === 'dropped');
  assert.equal(live.length, 8, 'แสดงไม่เกิน 8 ใบ');
  assert.equal(dropped.length, 2);
  assert.ok(dropped.every((c) => /OVER_LIMIT/.test(c.gate_reason)));
  assert.ok(Math.min(...live.map((c) => c.confidence)) > Math.max(...dropped.map((c) => c.confidence)), 'เก็บใบ confidence สูงสุด');
  assert.equal(new Set(doc.cards.map((c) => c.id)).size, doc.cards.length, 'id ต้องไม่ซ้ำ');
  assert.equal(gateChanges.filter((g) => g.reasons?.includes('OVER_LIMIT')).length, 2);
}

test('การ์ดเกิน 8 ใบ: เก็บ 8 ใบ confidence สูงสุด ที่เหลือ dropped (OVER_LIMIT) · id ซ้ำถูกแจกใหม่', () => assertCapEight(schema));

test('raw_corrections ต้องมี source_url http(s) ที่ไม่ใช่เพจเรา · มีของจริง/การ์ดขัด RAW → ธง RAW_CONTRADICTION', () => {
  const result = {
    ...agentResultOut1(),
    raw_corrections: [
      { field: 'สัญชาติ', raw_value: 'สวีเดน', source_value: 'นอร์เวย์', source_url: 'https://news.example.test/a', confidence: 0.8 },
      { field: 'อายุ', raw_value: '40', source_value: '45' },
      { field: 'สถานที่', raw_value: 'ราชบุรี', source_value: 'กาญจนบุรี', source_url: 'https://www.facebook.com/IG.dara/posts/1' },
    ],
  };
  const { doc } = schema.buildResearchCardsDoc(result, { jobId: 'q_r', mode: 'assist', nowIso: NOW_ISO });
  assert.deepEqual(doc.raw_corrections.map((r) => r.field), ['สัญชาติ']);
  assert.ok(doc.flags.includes('RAW_CONTRADICTION'));
  const viaCard = schema.buildResearchCardsDoc({ ...agentResultOut1(), cards: [{ ...passingCard(1), contradicts_raw: true }] },
    { jobId: 'q_r2', mode: 'assist', nowIso: NOW_ISO });
  assert.ok(viaCard.doc.flags.includes('RAW_CONTRADICTION'));
});

test('tool_log ถูกลบรูปแบบกุญแจก่อนเก็บ · ข้อความยาวถูกตัด', () => {
  const secretArgs = 'curl -H "x-api-key: abcd1234secretvalue" "https://x.test/?api_key=SECRETVALUE123&q=1" sk-abcdefghijklmnopqrstuvwxyz0123 Bearer eyJhbGciOiJIUzI1NiJ9.payload';
  const result = { ...agentResultOut1(), tool_log: [{ tool: 'exec_command', args: secretArgs, ok: true, note: 'token=zzzzzzzzzzzz', ms: 5 }], stale_news_warning: 'ก'.repeat(5000) };
  const { doc } = schema.buildResearchCardsDoc(result, { jobId: 'q_s', mode: 'shadow', nowIso: NOW_ISO });
  const text = JSON.stringify(doc.tool_log);
  for (const secret of ['abcd1234secretvalue', 'SECRETVALUE123', 'sk-abcdefghijklmnopqrstuvwxyz0123', 'eyJhbGciOiJIUzI1NiJ9', 'zzzzzzzzzzzz']) {
    assert.equal(text.includes(secret), false, `ต้องลบ ${secret.slice(0, 6)}…`);
  }
  assert.equal(doc.stale_news_warning.length, 600);
  assert.equal(doc.usage.tool_calls, 12);
});

// ── store (Supabase ปลอม) ─────────────────────────────────────────
function newStorage(mod = store, { start = T0 } = {}) {
  const sb = createFakeSupabase();
  const c = clock(start);
  return { sb, clock: c, storage: mod.createResearchStorage({ sb, now: c.now }) };
}

async function assertPrefixedRows(mod) {
  const { sb, storage } = newStorage(mod);
  sb.seed('q_abc', 'job_queue', { id: 'q_abc', status: 'pending', payload: { input: 'x' } }); // แถวคิวจริงใช้ jobId เป็น id
  const first = await storage.createRequest({ jobId: 'q_abc', rawText: 'ข่าวทดสอบ', sourceUrls: [], userId: 'discord-1' });
  assert.equal(first.created, true, 'ใบขอต้องสร้างได้แม้แถวคิวใช้ id = jobId (PK ทั้งตาราง)');
  assert.ok(sb.rows.has('rreq_q_abc'));
  assert.equal(sb.doc('rreq_q_abc').id, 'q_abc', 'data.id = jobId ตามสัญญา 2.1');
  assert.equal(sb.rows.get('rreq_q_abc').store_name, 'research-requests');
  assert.equal(sb.doc('q_abc').status, 'pending', 'ห้ามแตะแถวคิว');
  const again = await storage.createRequest({ jobId: 'q_abc', rawText: 'อื่น', sourceUrls: [] });
  assert.equal(again.created, false, 'สร้างซ้ำ = มีแล้ว ไม่ทับ');
  assert.equal(sb.doc('rreq_q_abc').rawText, 'ข่าวทดสอบ');
}

test('store: row id มีคำนำหน้า (rreq_) ไม่ชนแถว job_queue ที่ใช้ jobId เดียวกัน · data.id = jobId · สร้างซ้ำไม่ทับ', () => assertPrefixedRows(store));

async function assertRequestDeadline(mod) {
  const { sb, storage } = newStorage(mod);
  await storage.createRequest({ jobId: 'q_d', rawText: 'ข่าว', sourceUrls: ['https://a.test/1'], userId: 'u1' });
  const doc = sb.doc('rreq_q_d');
  assert.deepEqual(Object.keys(doc).sort(), ['attempt', 'createdAt', 'deadlineAt', 'id', 'rawText', 'revision', 'sourceUrls', 'status', 'userId', 'workflowId'].sort());
  assert.equal(doc.workflowId, 'unify_q_d');
  assert.equal(doc.status, 'queued');
  assert.equal(Date.parse(doc.deadlineAt) - Date.parse(doc.createdAt), 15 * 60_000, 'ค่าเริ่มต้น 15 นาที (ข้อตัดสิน 1 ต.ค. 69 · ไม่ใช่สูตรเดิม 6+1 นาที)');
  await storage.createRequest({ jobId: 'q_d30', rawText: 'ข่าว', sourceUrls: [], deadlineMin: 30 });
  const custom = sb.doc('rreq_q_d30');
  assert.equal(Date.parse(custom.deadlineAt) - Date.parse(custom.createdAt), 30 * 60_000, 'deadlineMin ที่ส่งมา (จาก env) ถูกใช้ตรงๆ');
}

test('store: ใบขอตามสัญญา 2.1 — deadlineAt = createdAt + RESEARCH_AGENT_DEADLINE_MIN (15 นาที) · ไม่มี channel/msg = ไม่มีคีย์', () => assertRequestDeadline(store));

async function assertLeaseRace(mod) {
  const { sb, storage, clock: c } = newStorage(mod);
  await storage.createRequest({ jobId: 'q_old', rawText: 'เก่า', sourceUrls: [] });
  c.advance(1_000);
  await storage.createRequest({ jobId: 'q_new', rawText: 'ใหม่', sourceUrls: [] });
  const [a, b] = await Promise.all([storage.leaseNext({ workerId: 'w1' }), storage.leaseNext({ workerId: 'w2' })]);
  const leased = [a, b].filter(Boolean);
  assert.equal(leased.length, 2, 'สองเครื่องได้คนละใบ');
  assert.notEqual(leased[0].id, leased[1].id, 'cas ต้องกันสองเครื่องหยิบใบเดียวกัน');
  assert.equal(a.id, 'q_old', 'FIFO: ใบเก่าสุดก่อน');
  assert.equal(sb.doc('rreq_q_old').leasedBy, 'w1');
  assert.equal(sb.doc('rreq_q_old').attempt, 1);
  assert.equal(await storage.leaseNext({ workerId: 'w3' }), null, 'หมดงานแล้ว');
}

test('store: lease FIFO + cas กันสอง worker หยิบใบเดียวกัน', () => assertLeaseRace(store));

async function assertLeaseDeadline(mod) {
  const { sb, storage, clock: c } = newStorage(mod);
  await storage.createRequest({ jobId: 'q_wait', rawText: 'รอคิว', sourceUrls: [], deadlineMin: 15 });
  c.advance(1);
  await storage.createRequest({ jobId: 'q_late', rawText: 'ช้า', sourceUrls: [], deadlineMin: 15 });
  c.advance(14 * 60_000);
  const first = await storage.leaseNext({ workerId: 'w1' });
  assert.equal(first?.id, 'q_wait', 'ใบที่รอคิว 14 นาที (ข่าวเข้าถี่ · worker ไม่ว่าง) ยังหยิบได้');
  c.advance(60_000 + 1);
  assert.equal(await storage.leaseNext({ workerId: 'w2' }), null, 'เลย deadline ห้ามแจก');
  assert.equal(sb.doc('rreq_q_late').status, 'expired');
}

test('store: ใบที่รอคิว < 15 นาทียังแจกได้ · เลย deadline ไม่ถูกแจกและถูกปิดเป็น expired', () => assertLeaseDeadline(store));

test('store: heartbeat ok/lost/not_found · report → การ์ด + ปิดใบขอ · ส่งซ้ำ = duplicate · worker อื่น = lost', async () => {
  const { sb, storage, clock: c } = newStorage();
  await storage.createRequest({ jobId: 'q_r', rawText: 'ข่าว', sourceUrls: [] });
  await storage.leaseNext({ workerId: 'w1' });
  c.advance(30_000);
  assert.equal((await storage.heartbeat({ jobId: 'q_r', workerId: 'w1' })).outcome, 'ok');
  assert.equal(sb.doc('rreq_q_r').heartbeatAt, new Date(c.now()).toISOString());
  assert.equal((await storage.heartbeat({ jobId: 'q_r', workerId: 'w2' })).outcome, 'lost');
  assert.equal((await storage.heartbeat({ jobId: 'q_none', workerId: 'w1' })).outcome, 'not_found');
  assert.equal((await storage.report({ jobId: 'q_r', workerId: 'w2', result: agentResultOut1(), mode: 'shadow' })).outcome, 'lost');
  const stored = await storage.report({ jobId: 'q_r', workerId: 'w1', result: agentResultOut1(), mode: 'shadow' });
  assert.equal(stored.outcome, 'stored');
  assert.equal(stored.requestClosed, true);
  assert.equal(sb.doc('rcard_q_r').status, 'done');
  assert.equal(sb.doc('rcard_q_r').id, 'q_r');
  assert.equal(sb.rows.get('rcard_q_r').store_name, 'research-cards');
  assert.equal(sb.doc('rreq_q_r').status, 'done');
  assert.equal(sb.doc('rreq_q_r').cardsRevision, 1);
  const dup = await storage.report({ jobId: 'q_r', workerId: 'w1', result: agentResultOut2(), mode: 'shadow' });
  assert.equal(dup.outcome, 'duplicate', 'worker retry หลังสำเร็จต้องไม่เขียนทับ');
  assert.equal(sb.doc('rcard_q_r').cards[0].claim.startsWith('เพจตาเป้'), true);
  const failedSchema = await storage.createRequest({ jobId: 'q_bad', rawText: 'x', sourceUrls: [] });
  assert.equal(failedSchema.created, true);
  await storage.leaseNext({ workerId: 'w1' });
  await storage.report({ jobId: 'q_bad', workerId: 'w1', result: { status: 'done' }, mode: 'shadow' });
  assert.equal(sb.doc('rcard_q_bad').status, 'failed');
  assert.equal(sb.doc('rreq_q_bad').status, 'failed');
});

test('store: feedback แทนโหวตเดิมของผู้ใช้เดิม · การ์ดไม่มี = unknown_card · ยังไม่มีการ์ด = not_found · ชน cas แล้วลองใหม่', async () => {
  const { sb, storage } = newStorage();
  assert.equal((await storage.addFeedback({ jobId: 'q_f', cardId: 'R1', vote: 'up', userId: 'u1' })).outcome, 'not_found');
  await storage.createRequest({ jobId: 'q_f', rawText: 'ข่าว', sourceUrls: [] });
  await storage.leaseNext({ workerId: 'w1' });
  await storage.report({ jobId: 'q_f', workerId: 'w1', result: agentResultOut1(), mode: 'shadow' });
  assert.equal((await storage.addFeedback({ jobId: 'q_f', cardId: 'R9', vote: 'up', userId: 'u1' })).outcome, 'unknown_card');
  await storage.addFeedback({ jobId: 'q_f', cardId: 'R1', vote: 'up', userId: 'u1' });
  await storage.addFeedback({ jobId: 'q_f', cardId: 'all', vote: 'down', userId: 'u2' });
  // ชน cas หนึ่งครั้ง (มีคนเขียนการ์ดระหว่างอ่าน-เขียน) → ต้องอ่านใหม่แล้วสำเร็จ
  const original = sb.from.bind(sb);
  let bumped = false;
  sb.from = (table) => {
    const q = original(table);
    const origUpdate = q.update;
    q.update = (payload) => {
      if (!bumped) { bumped = true; const row = sb.rows.get('rcard_q_f'); row.data.revision += 1; }
      return origUpdate(payload);
    };
    return q;
  };
  const third = await storage.addFeedback({ jobId: 'q_f', cardId: 'R1', vote: 'down', userId: 'u1' });
  sb.from = original;
  assert.equal(third.outcome, 'stored');
  const feedback = sb.doc('rcard_q_f').feedback;
  assert.deepEqual(feedback.map((f) => [f.userId, f.cardId, f.vote]), [['u2', 'all', 'down'], ['u1', 'R1', 'down']]);
});

test('store: ฐานล้ม = ResearchStorageError (503) ไม่มีข้อความดิบจาก DB', async () => {
  for (const mode of ['error', 'throw']) {
    const { sb, storage } = newStorage();
    sb.failNext(1, { mode });
    await assert.rejects(storage.getRequest('q_x'), (error) => error.errorType === 'RESEARCH_STORAGE_UNAVAILABLE'
      && error.status === 503 && !/SECRET/.test(error.message));
  }
  globalThis.__RA_SB = undefined; // ต่อ Supabase ไม่ได้ (client ว่าง)
  await assert.rejects(store.loadResearchStorage(), (error) => error.errorType === 'RESEARCH_STORAGE_UNAVAILABLE');
  globalThis.__RA_SB_READY = false; // ยังไม่ได้ตั้ง Supabase
  globalThis.__RA_SB = createFakeSupabase();
  await assert.rejects(store.loadResearchStorage(), (error) => error.errorType === 'RESEARCH_STORAGE_UNAVAILABLE');
  globalThis.__RA_SB_READY = true;
  assert.equal(typeof (await store.loadResearchStorage()).leaseNext, 'function');
  globalThis.__RA_SB = undefined;
});

async function assertBotPosted(mod) {
  const { sb, storage, clock: c } = newStorage(mod);
  sb.seed('q_p', 'job_queue', { id: 'q_p', status: 'completed' }); // แถวคิวใช้ jobId เป็น row id — bot-posted ต้องไม่ชน
  // บัตรขึ้นก่อนผลข่าว: บอทจดช่องที่รู้ (ยังไม่มี postedAt)
  await storage.saveBotPosted({ jobId: 'q_p', channelId: '111', sourceMessageId: '222', processingMsgId: '333', researchCardMsgId: '555', resultMsgIds: ['444', 'bad id!', '444'] });
  let doc = sb.doc('bposted_q_p');
  assert.equal(doc.id, 'q_p', 'data.id = jobId (สัญญา 2.3)');
  assert.equal(sb.rows.get('bposted_q_p').store_name, 'bot-posted');
  assert.equal(sb.doc('q_p').status, 'completed', 'ห้ามแตะแถวคิว');
  assert.deepEqual(doc.resultMsgIds, ['444'], 'ตัดตัวผิดรูป + ไม่ซ้ำ');
  assert.equal(doc.postedAt, null, 'ยังไม่โพสต์ผล = postedAt null (ไม่ใช่เวลาที่จดบัตร)');
  assert.equal(doc.createdAt, new Date(T0).toISOString());
  assert.equal(doc.revision, 1);
  // งานจบ: บอทจดผล — caseId เป็นข้อความ (ไม่บังคับตัวเลข) · postedAt ของบอท · id ข้อความผลได้ถึง 50
  c.advance(5_000);
  const saved = await storage.saveBotPosted({
    jobId: 'q_p', caseId: 'case_06499-x', postedAt: '2026-10-01T13:10:00+07:00',
    resultMsgIds: Array.from({ length: 60 }, (_, i) => String(1290000000000000000n + BigInt(i))),
  });
  doc = sb.doc('bposted_q_p');
  assert.deepEqual(saved, doc, 'คืนเอกสารที่บันทึกจริง');
  assert.equal(doc.caseId, 'case_06499-x', 'caseId ข้อความ (ข้อตัดสิน 1 ต.ค. 69)');
  assert.equal(doc.postedAt, '2026-10-01T06:10:00.000Z');
  assert.equal(doc.resultMsgIds.length, 50, 'เก็บครบ 50 ตามที่บอทส่ง');
  assert.deepEqual([doc.channelId, doc.sourceMessageId, doc.processingMsgId, doc.researchCardMsgId], ['111', '222', '333', '555'], 'ช่องที่ไม่ส่งมาคงค่าเดิม');
  assert.equal(doc.revision, 2);
  // ค่าผิดรูป/null = คงค่าเดิม (ไม่ลบ) · caseId เลขจำนวนเต็ม → ข้อความ · เวลา ms → ISO
  await storage.saveBotPosted({ jobId: 'q_p', caseId: 6499, postedAt: 'not a date', channelId: null, researchCardMsgId: 'bad id!' });
  doc = sb.doc('bposted_q_p');
  assert.equal(doc.caseId, '6499');
  assert.equal(doc.postedAt, '2026-10-01T06:10:00.000Z');
  assert.equal(doc.channelId, '111');
  assert.equal(doc.researchCardMsgId, '555');
  await storage.saveBotPosted({ jobId: 'q_p', caseId: '06499', postedAt: Date.parse('2026-10-01T06:20:00.000Z') });
  doc = sb.doc('bposted_q_p');
  assert.deepEqual([doc.caseId, doc.postedAt], ['06499', '2026-10-01T06:20:00.000Z']);
  for (const bad of ['x y', '1.5', -1, 1.5]) {
    await storage.saveBotPosted({ jobId: 'q_p', caseId: bad });
    assert.equal(sb.doc('bposted_q_p').caseId, '06499', `caseId ผิดรูป (${bad}) ต้องไม่ทับ`);
  }
  assert.equal((await storage.getBotPosted('q_p')).processingMsgId, '333');
  assert.equal(await storage.getBotPosted('q_none'), null);
  await assert.rejects(storage.saveBotPosted({ jobId: '../x' }), (e) => e.code === 'RESEARCH_INVALID_INPUT');
}

test('store: bot-posted (สัญญา 2.3 · นิยามเดียวที่ /api/bot/posted เรียก) row id bposted_ · caseId ข้อความ · postedAt ของบอท · ผิดรูป = คงเดิม · id ผิด = 400', () => assertBotPosted(store));

async function assertQueueHelper(mod) {
  let loads = 0;
  const { sb, storage } = newStorage(mod);
  const loadStorage = async () => { loads += 1; return storage; };
  const payload = {
    input: 'ชาวสวีเดนสวมขาเทียมช่วยชาวบ้านราชบุรีตักทราย',
    sourceUrls: ['https://a.test/x', 'javascript:alert(1)', 'https://a.test/x', 'ftp://b.test/', ' https://c.test/y '],
    _msgId: '1234567890', _channelId: '987654321',
  };
  assert.equal(await mod.queueResearchRequestFromPayload({ jobId: 'q_h', payload, userId: 'discord-1' }, { env: {}, loadStorage }), null);
  assert.equal(loads, 0, 'ปิดสวิตช์ = ไม่แตะฐาน');
  const on = await mod.queueResearchRequestFromPayload({ jobId: 'q_h', payload, userId: 'discord-1' }, { env: { RESEARCH_AGENT: '1' }, loadStorage });
  assert.deepEqual(on, { created: true });
  const doc = sb.doc('rreq_q_h');
  assert.deepEqual(doc.sourceUrls, ['https://a.test/x', 'https://c.test/y']);
  assert.equal(doc.sourceMessageId, '1234567890');
  assert.equal(doc.channelId, '987654321');
  assert.equal(doc.userId, 'discord-1');
  assert.equal(doc.rawText, payload.input);
  assert.equal(Date.parse(doc.deadlineAt) - Date.parse(doc.createdAt), 15 * 60_000, 'ไม่ตั้ง env = เส้นตาย 15 นาที');
  await mod.queueResearchRequestFromPayload({ jobId: 'q_h40', payload, userId: 'discord-1' },
    { env: { RESEARCH_AGENT: '1', RESEARCH_AGENT_DEADLINE_MIN: '40', RESEARCH_AGENT_MAX_MINUTES: '3' }, loadStorage });
  const custom = sb.doc('rreq_q_h40');
  assert.equal(Date.parse(custom.deadlineAt) - Date.parse(custom.createdAt), 40 * 60_000, 'RESEARCH_AGENT_DEADLINE_MIN จาก env ถึงใบขอ (MAX_MINUTES ไม่เกี่ยว)');
}

test('queueResearchRequestFromPayload: ปิดสวิตช์ = null ไม่แตะฐาน · เปิด = ใบขอพร้อม sourceUrls สะอาด + channel/msg + เส้นตายจาก env', () => assertQueueHelper(store));

test('mutation: ทุบกลไกหลักแล้วข้อสอบต้องแดง (และของจริงเขียว)', async () => {
  const storeMutations = [
    ['ตัดคำนำหน้า row id', 'export const researchRequestRowId = (jobId) => `rreq_${jobId}`;', 'export const researchRequestRowId = (jobId) => jobId;', assertPrefixedRows],
    ['cas ไม่เช็ค revision', "      .eq('data->>revision', String(expectedRevision))\n", '', assertLeaseRace],
    ['lease ไม่ดู deadline', '        if (Date.parse(request.deadlineAt) <= nowMs) {', '        if (false) {', assertLeaseDeadline],
    ['ปิดสวิตช์แล้วยังสร้างใบขอ', '  if (!isResearchAgentOn(env)) return null;\n  if (!RESEARCH_JOB_ID_RE', '  if (!RESEARCH_JOB_ID_RE', assertQueueHelper],
    ['เส้นตายกลับเป็นสูตรเดิม 6+1 นาที', '    deadlineAt: new Date(createdMs + minutes * 60_000).toISOString(),', '    deadlineAt: new Date(createdMs + 6 * 60_000 + 60_000).toISOString(),', assertRequestDeadline],
    ['เส้นตายไม่อ่าน env (queue/add)', '    deadlineMin: getResearchAgentDeadlineMin(env),\n', '', assertQueueHelper],
    ['caseId บังคับตัวเลข', '  return optionalId(value);\n}', "  return typeof value === 'string' && /^\\d{1,10}$/.test(value) ? value : null;\n}", assertBotPosted],
    ['ไม่รับ postedAt ของบอท', '  if (postedAt) patch.postedAt = postedAt;\n', '', assertBotPosted],
    ['โควตาไม่อ่าน quotaPct (worker รุ่นแรก)', ' ?? normalizeQuotaReport(body.quotaPct, body.account)', '', assertWorkerQuotaBody],
    ['โควตาไม่อ่าน quota.remainingPct (สัญญาใหม่)', '  return normalizeQuotaReport(body.quota, body.account) ?? ', '  return ', assertWorkerQuotaBody],
  ];
  for (const [index, [label, search, replacement, check]] of storeMutations.entries()) {
    const mutated = await importSource(replaceOnce(STORE_SOURCE, search, replacement, label), `store-mut-${index}`);
    await assert.rejects(Promise.resolve().then(() => check(mutated)), `${label}: ข้อสอบต้องแดง`);
  }
  const schemaMutations = [
    ['ด่านปลดการ์ดได้ (tighten → cap)', 'const tighten = (gate, cap) => (GATE_RANK[cap] < GATE_RANK[gate] ? cap : gate);', 'const tighten = (gate, cap) => cap;', assertTightenOnly],
    ['ตัดการจับเพจเราเอง', "  return first.toLowerCase() === 'ig.dara';", '  return false;', assertOwnPage],
    ['ไม่ตัดการ์ดเกิน 8 ใบ', '  const kept = ranked.slice(0, RESEARCH_MAX_DISPLAY_CARDS);\n  for (const card of ranked.slice(RESEARCH_MAX_DISPLAY_CARDS)) {', '  const kept = ranked;\n  for (const card of []) {', assertCapEight],
  ];
  for (const [index, [label, search, replacement, check]] of schemaMutations.entries()) {
    const mutated = await importSource(replaceOnce(SCHEMA_SOURCE, search, replacement, label), `schema-mut-${index}`);
    await assert.rejects(Promise.resolve().then(() => check(mutated)), `${label}: ข้อสอบต้องแดง`);
  }
  // ของจริงต้องเขียวกับข้อสอบชุดเดียวกัน
  await assertPrefixedRows(store);
  await assertLeaseRace(store);
  await assertLeaseDeadline(store);
  await assertQueueHelper(store);
  await assertRequestDeadline(store);
  await assertBotPosted(store);
  assertWorkerQuotaBody(store);
  assertTightenOnly(schema);
  assertOwnPage(schema);
  assertCapEight(schema);
});
