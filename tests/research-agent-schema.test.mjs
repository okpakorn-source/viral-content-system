// ============================================================
// 🧪 tests/research-agent-schema.test.mjs — สัญญาข้อมูลเอเจนต์รีเสิร์ช (SPEC-v2 ส่วน 2.2 · ด่าน 1)
// ★ 1 ต.ค. 69 (research agent v2 เลน A · สเปกล็อกโดยเจ้าของ)
// fixture = ผลจริงของเอเจนต์ในแล็บ (C:\tmp\research-agent-lab\out*\result.json → tests/fixtures/research-agent/)
// กลายพันธุ์ 5 แบบ (patch ซอร์สจริงในโฟลเดอร์ชั่วคราว → ข้อตรวจต้องแดง · ซอร์สจริงต้องเขียว)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto'; // ★ 1 ต.ค. 69 (SPEC-v3 · W2): ล็อกผลเก่าเทียบลายนิ้วมือเฟส 1
import { importPatchedModule } from './helpers/temp-module.mjs';
import * as schema from '../scripts/research-agent/schema.mjs';
import { runGate } from '../scripts/research-agent/gate.mjs'; // ★ W2: ผลเก่าผ่านด่าน → ระเบียน → validator

const FIX = (name) => JSON.parse(readFileSync(new URL(`./fixtures/research-agent/${name}`, import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const SRC_URL = new URL('../scripts/research-agent/schema.mjs', import.meta.url);
const SRC = readFileSync(SRC_URL, 'utf8').replace(/\r\n/g, '\n');

async function mutant(find, replace, name) {
  assert.ok(SRC.includes(find), `ไม่พบจุดกลายพันธุ์ ${name} ในซอร์ส (ซอร์สเปลี่ยน → แก้เทสด้วย)`);
  return importPatchedModule(SRC.replace(find, replace), SRC_URL, `ra-schema-${name}`);
}

// ── ข้อตรวจที่ใช้ทั้งกับซอร์สจริงและตัวกลายพันธุ์ ──
function checkLabAliases(m) {
  const r = m.normalizeAgentResult(FIX('lab-out-result.json'));
  assert.equal(r.ok, true, r.errors.join(','));
  assert.equal(r.result.plan.length, 5);
  assert.equal(r.result.cards.length, 1);
  assert.deepEqual([...r.aliases].sort(), ['fact_cards', 'raw_contradictions', 'research_plan']);
}
function checkMissingRequired(m) {
  for (const key of ['research_plan', 'fact_cards', 'tool_log', 'origin_post']) {
    const raw = FIX('lab-out-result.json');
    delete raw[key];
    const r = m.normalizeAgentResult(raw);
    assert.equal(r.ok, false, `ขาด ${key} ต้องไม่ผ่าน`);
    assert.equal(r.result, null);
  }
}
function checkConfidence(m) {
  assert.equal(m.normalizeConfidence(0.95), 0.95);
  assert.equal(m.normalizeConfidence(85), 0.85);
  assert.equal(m.normalizeConfidence('0.7'), 0.7);
  assert.equal(m.normalizeConfidence(-1), 0);
  assert.equal(m.normalizeConfidence(250), 1);
  assert.equal(m.normalizeConfidence('ไม่รู้'), 0);
}
function checkFlagSpoof(m) {
  const raw = FIX('lab-out-result.json');
  raw.flags = ['QUOTA_LOW', 'stale_news', 'BROWSER_WRONG_ACCOUNT', 'TOOL_BUDGET_MONTH', 'WHATEVER', 'STALE_NEWS'];
  const r = m.normalizeAgentResult(raw);
  assert.deepEqual(r.result.flags, ['STALE_NEWS', 'BROWSER_WRONG_ACCOUNT'], 'เอเจนต์ตั้งได้เฉพาะธงของเอเจนต์ (ไม่ซ้ำ)');
}
function checkRedaction(m) {
  const raw = FIX('lab-out-result.json');
  raw.research_plan[0].reason = 'ใช้คีย์ sk-abcdefghijklmnopqrstuvwxyz123456 แล้ว';
  raw.tool_log.push({ tool: 'serper', args: 'x-api-key=SECRETVALUE12345678', ok: true, note: 'ค่า supersecretvalue99 รั่ว · Bearer abcdefghijklmnopqrstu' });
  raw.fact_cards[0].evidence_quote += ' AIzaSyA1234567890abcdefghijklmnop';
  const r = m.normalizeAgentResult(raw, { secretValues: ['supersecretvalue99'] });
  const blob = JSON.stringify(r.result);
  for (const leak of ['sk-abcdefghijklmnopqrstuvwxyz123456', 'SECRETVALUE12345678', 'supersecretvalue99', 'abcdefghijklmnopqrstu', 'AIzaSyA1234567890abcdefghijklmnop']) {
    assert.ok(!blob.includes(leak), `ค่าความลับรั่ว: ${leak.slice(0, 6)}…`);
  }
  assert.match(blob, /\[REDACTED\]/);
}

test('1. ผลจริงในแล็บ (out) ชื่อฟิลด์แบบเก่า → แปลงเข้าสัญญาเดียวได้ครบ', () => {
  checkLabAliases(schema);
  const r = schema.normalizeAgentResult(FIX('lab-out-result.json')).result;
  assert.equal(r.origin_post.url, null, 'url "ไม่พบ" → null');
  assert.equal(r.origin_post.confidence, 0);
  assert.equal(r.story_date_estimate, 'ไม่ทราบ');
  assert.equal(r.cards[0].value_type, 'อื่นๆ');
  assert.equal(r.cards[0].identity, 'generic');
  assert.equal(r.cards[0].contradicts_raw, false);
  assert.equal(r.tool_log.length, 12);
  assert.equal(r.self_report.tool_calls, 12);
  assert.ok(r.skipped.length >= 6);
});

test('2. ผลจริงในแล็บ (out2) — การ์ด 3 ใบ · ต้นทางไม่พบ · tool_log 25 รายการ', () => {
  const r = schema.normalizeAgentResult(FIX('lab-out2-result.json'));
  assert.equal(r.ok, true);
  assert.equal(r.result.cards.length, 3);
  assert.equal(r.result.origin_post.url, null);
  assert.equal(r.result.tool_log.length, 25);
  assert.ok(r.result.cards.every((c) => c.source_url.startsWith('https://www.facebook.com/IG.dara/')));
  assert.ok(r.result.stale_news_warning && r.result.stale_news_warning.includes('05:51:22'));
});

test('3. ขาดคีย์บังคับ/ไม่ใช่ object = ไม่ผ่าน (ด่าน 1: ขาด = failed)', () => {
  checkMissingRequired(schema);
  for (const bad of [null, 'x', [], 42]) assert.equal(schema.normalizeAgentResult(bad).ok, false);
});

test('4. ความมั่นใจ 0–1 (รับ 0–100) · ตัวเลขเพี้ยน = 0', () => checkConfidence(schema));

test('5. เอเจนต์ปลอมธงของ worker ไม่ได้ (QUOTA_LOW/TOOL_BUDGET_MONTH ถูกทิ้ง)', () => checkFlagSpoof(schema));

test('6. ข้อความทุกช่องปิดค่าคีย์ก่อนออกจากเครื่อง', () => checkRedaction(schema));

test('7. โครงผลในใบงาน (AGENT_RESULT_TEMPLATE) เป็น JSON ที่ตัวแปลงรับได้ — สัญญาที่บอกเอเจนต์ตรงกับที่ตรวจ', () => {
  const tmpl = JSON.parse(schema.AGENT_RESULT_TEMPLATE);
  const r = schema.normalizeAgentResult(tmpl);
  assert.equal(r.ok, true, r.errors.join(','));
  for (const k of schema.REQUIRED_AGENT_KEYS) assert.ok(k in tmpl, `template ต้องมี ${k}`);
  assert.equal(r.result.complexity, null, '"ต่ำ|กลาง|สูง" ไม่ใช่ค่าจริง');
  assert.equal(schema.normalizeComplexity('สูง'), 'high');
  assert.equal(schema.normalizeComplexity('ยาก'), 'high');
  assert.equal(schema.normalizeComplexity('กลาง'), 'normal');
});

test('8. buildCardRecord → ระเบียนตรงสัญญา 2.2 ครบทุกฟิลด์ ไม่มีฟิลด์เกิน', () => {
  const rec = schema.buildCardRecord({
    jobId: 'q_abc123', status: 'done', mode: 'shadow',
    brain: { kind: 'codex', model: 'gpt-6-astra', effort: 'low', account: 'main', quotaPctAfter: 42.25 },
    gated: {
      plan: [{ question: 'q', why_valuable: '', decided: 'ค้น', reason: '' }],
      origin_post: { url: null, source_name: '', date: '', confidence: 0 },
      story_date_estimate: 'ไม่ทราบ', stale_news_warning: null,
      cards: [{ id: 'R1', claim: 'c', value_type: 'อื่นๆ', why_it_adds_value: '', evidence_quote: 'e', source_url: 'https://a.b/c', source_name: 'n', source_date: '', confidence: 0.9, contradicts_raw: false, identity: 'generic', gate: 'pass' }],
      raw_corrections: [], flags: ['ORIGIN_NOT_FOUND'], skipped: [], tool_log: [{ tool: 'serper', args: '', ok: true, note: '', ms: null }],
    },
    flags: ['QUOTA_LOW', 'ORIGIN_NOT_FOUND', 'NOT_A_FLAG'],
    usage: { tool_calls: 3, minutes: 1.234, costUsd: 0.00312, codexTokens: 0 },
    nowIso: '2026-10-01T06:00:00.000Z',
  });
  assert.deepEqual(schema.validateCardRecord(rec), []);
  // ★ 1 ต.ค. 69 (SPEC-v3 สัญญา 8.3 · W2): ระเบียนมี suggested_dimensions ระดับบนเสมอ (ไม่มี = []) — ช่อง optional ของสัญญา
  //   ของเดิม: assert.deepEqual(Object.keys(rec).sort(), [...schema.RECORD_KEYS].sort());
  assert.deepEqual(Object.keys(rec).sort(), [...schema.RECORD_KEYS, ...schema.OPTIONAL_RECORD_KEYS].sort());
  assert.deepEqual(rec.suggested_dimensions, [], 'ไม่มีมุมเสนอ = []');
  assert.deepEqual(rec.flags, ['ORIGIN_NOT_FOUND', 'QUOTA_LOW'], 'ธงไม่ซ้ำ + ธงที่ไม่รู้จักถูกทิ้ง');
  assert.equal(rec.brain.quotaPctAfter, 42.3);
  assert.equal(rec.usage.minutes, 1.23);
  assert.ok(!('codexTokens' in rec.usage), 'codexTokens = 0 ไม่ใส่');
  assert.deepEqual(rec.feedback, []);
  const noQuota = schema.buildCardRecord({ jobId: 'x', status: 'skipped', brain: { kind: 'codex', quotaPctAfter: null } });
  assert.ok(!('quotaPctAfter' in noQuota.brain), 'ไม่รู้โควตา = ไม่ใส่ฟิลด์');
  assert.deepEqual(schema.validateCardRecord(noQuota), []);
});

test('9. validateCardRecord จับระเบียนผิดสัญญา', () => {
  const ok = schema.buildCardRecord({ jobId: 'x', status: 'done' });
  assert.deepEqual(schema.validateCardRecord(ok), []);
  const bad = (patch) => schema.validateCardRecord({ ...structuredClone(ok), ...patch });
  assert.ok(bad({ extra: 1 }).some((e) => e.includes('นอกสัญญา')));
  assert.ok(bad({ status: 'weird' }).length);
  assert.ok(bad({ revision: 0 }).length);
  assert.ok(bad({ flags: ['HACKED'] }).length);
  assert.ok(bad({ raw_corrections: [{ field: 'x', source_url: 'ไม่มี' }] }).length);
  const card = { id: 'R1', claim: 'c', value_type: 'อื่นๆ', why_it_adds_value: '', evidence_quote: 'e', source_url: 'ftp://x', source_name: '', source_date: '', confidence: 0.9, contradicts_raw: false, identity: 'generic', gate: 'pass' };
  assert.ok(bad({ cards: [card] }).some((e) => e.includes('source_url')));
  assert.ok(bad({ cards: Array.from({ length: 9 }, (_, i) => ({ ...card, id: `R${i + 1}`, source_url: 'https://a.b' })) }).some((e) => e.includes('เกิน')));
  assert.ok(bad({ cards: [{ ...card, source_url: 'https://a.b', gate_reason: 'X' }] }).some((e) => e.includes('gate_reason')));
});

test('10. charCount / isHttpUrl / cleanText (ตัดความยาว + ลบอักขระควบคุม)', () => {
  assert.equal(schema.charCount('  ก  ข  '), 3);
  assert.equal(schema.isHttpUrl('https://x.com/a'), true);
  for (const u of ['ไม่พบ', 'javascript:alert(1)', 'ftp://x.com', '', null]) assert.equal(schema.isHttpUrl(u), false);
  const long = schema.cleanText('ก'.repeat(50), 10);
  assert.equal([...long].length, 10);
  assert.ok(long.endsWith('…'));
  assert.equal(schema.cleanText('a\u0000b\u0007c'), 'abc');
  assert.equal(schema.cleanText({ x: 1 }), '');
});

// ── กลายพันธุ์ (ต้องแดง) ──
test('M1 กลายพันธุ์: ตัดชื่อพ้อง research_plan → ผลแล็บแปลงไม่ได้ (ข้อตรวจต้องแดง)', async () => {
  const m = await mutant("pickField(raw, ['plan', 'research_plan'])", "pickField(raw, ['plan'])", 'no-alias');
  assert.throws(() => checkLabAliases(m));
});

test('M2 กลายพันธุ์: ไม่บังคับ plan → ขาดคีย์แล้วผ่าน (ข้อตรวจต้องแดง)', async () => {
  const m = await mutant("if (!Array.isArray(plan.value)) errors.push('ขาด plan (array)');", '', 'no-plan-required');
  assert.throws(() => checkMissingRequired(m));
});

test('M3 กลายพันธุ์: ไม่แปลงสเกล 0–100 → 85 กลายเป็น 1 (ข้อตรวจต้องแดง)', async () => {
  const m = await mutant('if (n > 1 && n <= 100) n /= 100;', '', 'no-scale');
  assert.throws(() => checkConfidence(m));
});

test('M4 กลายพันธุ์: ยอมธงทุกตัวจากเอเจนต์ → ปลอม QUOTA_LOW ได้ (ข้อตรวจต้องแดง)', async () => {
  const m = await mutant('if (AGENT_FLAGS.includes(s) && !out.includes(s)) out.push(s);', 'if (KNOWN_FLAGS.includes(s) && !out.includes(s)) out.push(s);', 'flag-spoof');
  assert.throws(() => checkFlagSpoof(m));
});

test('M5 กลายพันธุ์: ไม่ปิดคีย์ → ค่าความลับรั่วในผล (ข้อตรวจต้องแดง)', async () => {
  const m = await mutant("let s = String(text == null ? '' : text);\n  if (!s) return s;", "let s = String(text == null ? '' : text);\n  return s;", 'no-redact');
  assert.throws(() => checkRedaction(m));
});

// ============================================================
// ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.3 · เลน W2) — ฟิลด์ใหม่ optional: suggested_dimensions + quote
//   ผลเก่า (fixture แล็บ out/out2 = สำเนาตรงตัวของ C:\tmp\research-agent-lab\out*\result.json) ต้องผ่านเหมือนเดิมทุกไบต์:
//   ลายนิ้วมือ sha256 ของผล normalizeAgentResult (ตัดช่องใหม่ออก) จับจากโค้ดเฟส 1 (827336d7 ก่อนแก้ W2) · ไม่พึ่งตัวตัดคำ ICU (นิ่งข้ามรุ่น node)
// ============================================================
const PHASE1_NORMALIZED_SHA = Object.freeze({
  'lab-out-result.json': '1648321f4ff01cb36df23194302d27850d85bc85d6e65dca52aed9bd9ee77eed',
  'lab-out2-result.json': 'f7062eeabe268b77351a329879c376fef1898ca40910b40a540a197fdd238c03',
});
const PHASE1_TEMPLATE_SHA = '2e76d60667fb34f2a34c9eca5652cd3b92fed898c07b5e52de9098258d1b3b8a';
const sha = (text) => createHash('sha256').update(text).digest('hex');

function checkOldResultsUnchanged(m) {
  for (const [file, expected] of Object.entries(PHASE1_NORMALIZED_SHA)) {
    const r = m.normalizeAgentResult(FIX(file));
    assert.equal(r.ok, true, file);
    const { suggested_dimensions: dims, ...rest } = r.result;
    assert.deepEqual(dims, [], `${file}: ไม่มีฟิลด์ใหม่ = []`);
    assert.equal(sha(JSON.stringify(rest)), expected, `${file}: ช่องอื่นต้องเหมือนเฟส 1 ทุกไบต์`);
    assert.ok(r.result.cards.every((c) => !('quote' in c)), `${file}: ไม่มี quote = ไม่ใส่คีย์`);
    const gated = runGate(FIX(file), { jobCreatedAt: '2026-10-01T05:15:38.248Z', minutes: 3 });
    const rec = m.buildCardRecord({ jobId: 'q_0123456789abcdef', status: gated.status, brain: { kind: 'codex' }, gated, usage: gated.usage, nowIso: '2026-10-01T06:00:00.000Z' });
    assert.deepEqual(m.validateCardRecord(rec), [], `${file}: ระเบียนผ่านสัญญา`);
    assert.deepEqual(rec.suggested_dimensions, []);
    assert.ok(rec.cards.every((c) => !('quote' in c)));
  }
  assert.equal(sha(m.AGENT_RESULT_TEMPLATE), PHASE1_TEMPLATE_SHA, 'โครงผลหลัก (อยู่ใน prefix แคชของใบงาน) ต้องเดิมทุกไบต์');
}

test('W2-1. ผลเก่าในแล็บ (ไม่มีฟิลด์ใหม่) ผ่านเหมือนเดิมทุกไบต์ — normalize ตรงลายนิ้วมือเฟส 1 · ระเบียนผ่าน validator · โครงผลหลักเดิม', () => {
  checkOldResultsUnchanged(schema);
});

function checkDimensions(m) {
  const long = 'ม'.repeat(150);
  assert.deepEqual(m.normalizeDimensions(['มุมพี่น้องช่วยกันผ่อนบ้าน', '  มุม\nบ้านหลังแรก  ', 'มุมพี่น้องช่วยกันผ่อนบ้าน', '', '…', 42, { x: 1 }, long, 'มุมที่สี่']), [
    'มุมพี่น้องช่วยกันผ่อนบ้าน', 'มุม บ้านหลังแรก', `${'ม'.repeat(119)}…`,
  ], 'string เท่านั้น · ยุบช่องว่าง · ไม่ซ้ำ · ตัดว่าง/จุด · ≤120 ตัวอักษร · ≤3 ข้อ');
  assert.deepEqual(m.normalizeDimensions('มุมเดียว'), ['มุมเดียว'], 'สตริงเดี่ยว = 1 ข้อ');
  for (const bad of [undefined, null, 5, {}, '', [], [null]]) assert.deepEqual(m.normalizeDimensions(bad), [], JSON.stringify(bad));
  assert.deepEqual(m.normalizeDimensions(['มุมเล่าที่ข้อมูลของคุณเปิดให้ 1 บรรทัด (ไม่เกิน 120 ตัวอักษร)']), [], 'ค่าตัวอย่างจากโครงไม่ใช่คำตอบ');
  assert.deepEqual(m.normalizeDimensions(['มุมใหม่ sk-abcdefghijklmnopqrstuvwxyz123456']), ['มุมใหม่ [REDACTED]'], 'ปิดคีย์ก่อนออกจากเครื่อง');
  const once = m.normalizeDimensions(['ก'.repeat(130), 'ข']);
  assert.deepEqual(m.normalizeDimensions(once), once, 'ทำซ้ำได้ (buildCardRecord ทำซ้ำอีกรอบ) ค่าไม่เปลี่ยน');
  const raw = { ...FIX('lab-out-result.json'), suggested_dimensions: ['มุมชาวต่างชาติช่วยงานชุมชน', 'มุมน้ำใจข้ามชาติ', 'มุมเขื่อนราชบุรี', 'มุมที่สี่'] };
  assert.deepEqual(m.normalizeAgentResult(raw).result.suggested_dimensions, ['มุมชาวต่างชาติช่วยงานชุมชน', 'มุมน้ำใจข้ามชาติ', 'มุมเขื่อนราชบุรี']);
}

test('W2-2. suggested_dimensions: ≤3 ข้อ · ≤120 ตัวอักษร · ไม่มี = [] · ตัดซ้ำ/ว่าง/ค่าตัวอย่าง · ปิดคีย์ · ถึงผล normalize', () => checkDimensions(schema));

function checkQuote(m) {
  const card = (quote) => m.normalizeAgentResult({ ...FIX('lab-out-result.json'), fact_cards: [{ ...FIX('lab-out-result.json').fact_cards[0], quote }] }).result.cards[0];
  const ok = card({ text: 'อยู่บ้านหลังนี้มาได้ 5 ปีแล้วค่ะ', speaker: 'สมหญิง', speaker_confidence: 0.93 });
  assert.deepEqual(ok.quote, { text: 'อยู่บ้านหลังนี้มาได้ 5 ปีแล้วค่ะ', speaker: 'สมหญิง', speaker_confidence: 0.93 });
  assert.equal(Object.keys(ok).at(-1), 'quote', 'quote ต่อท้ายการ์ด (ช่องเดิมลำดับเดิม)');
  for (const [given, kept] of [[1.5, 1.5], [95, 95], [-0.2, -0.2], ['0.9', 0.9], [0, 0], [1, 1], [0.899, 0.899]]) {
    assert.equal(card({ text: 'คำพูด', speaker: 'ก', speaker_confidence: given }).quote.speaker_confidence, kept,
      `speaker_confidence ${given}: เก็บตามที่ให้ (ไม่บีบช่วง/ไม่แปลงสเกล/ไม่ปัด) — ด่านเป็นคนตัด`);
  }
  for (const bad of ['สูง', '', null, undefined, true, [0.9], {}]) {
    assert.equal(card({ text: 'คำพูด', speaker: 'ก', speaker_confidence: bad }).quote.speaker_confidence, null, `อ่านไม่ได้ = null: ${JSON.stringify(bad)}`);
  }
  const longQ = card({ text: 'ค'.repeat(400), speaker: 'ผ'.repeat(100), speaker_confidence: 0.95 }).quote;
  assert.equal([...longQ.text].length, 300);
  assert.equal([...longQ.speaker].length, 80);
  for (const none of [undefined, null, 'คำพูดลอยๆ', ['x'], { speaker: 'ก', speaker_confidence: 0.9 }, { text: '   ', speaker_confidence: 0.9 },
    { text: 'คำพูดตรงตามคลิป/ถอดเสียง (ไม่เกิน 300 ตัวอักษร)', speaker: 'ชื่อหรือบทบาทผู้พูด', speaker_confidence: 0.0 }]) {
    assert.equal('quote' in card(none), false, `ไม่มี quote ที่ใช้ได้ = ไม่ใส่คีย์: ${JSON.stringify(none)}`);
  }
  assert.equal(card({ text: 'โทเคน sk-abcdefghijklmnopqrstuvwxyz123456', speaker: 'ก', speaker_confidence: 0.9 }).quote.text, 'โทเคน [REDACTED]');
}

test('W2-3. การ์ด quote: {text ≤300, speaker ≤80, speaker_confidence ตามที่ให้} · ไม่มี/ไม่มีข้อความ/ค่าตัวอย่าง = ไม่ใส่คีย์ · ปิดคีย์', () => checkQuote(schema));

function checkRecordValidation(m) {
  const card = { id: 'R1', claim: 'c', value_type: 'อื่นๆ', why_it_adds_value: '', evidence_quote: 'e', source_url: 'https://a.b/c', source_name: 'n', source_date: '', confidence: 0.9, contradicts_raw: false, identity: 'generic', gate: 'pass' };
  const rec = m.buildCardRecord({
    jobId: 'q_w2', status: 'done', mode: 'write',
    gated: { cards: [{ ...card, quote: { text: 'คำพูด', speaker: 'ก', speaker_confidence: 0.95 } }], suggested_dimensions: ['มุมหนึ่ง', 'มุมสอง'] },
    nowIso: '2026-10-01T06:00:00.000Z',
  });
  assert.deepEqual(rec.suggested_dimensions, ['มุมหนึ่ง', 'มุมสอง']);
  assert.deepEqual(rec.cards[0].quote, { text: 'คำพูด', speaker: 'ก', speaker_confidence: 0.95 });
  assert.deepEqual(m.validateCardRecord(rec), [], 'ฟิลด์ใหม่ที่ถูกรูปผ่านสัญญา');
  const old = structuredClone(rec);
  delete old.suggested_dimensions;
  assert.deepEqual(m.validateCardRecord(old), [], 'ระเบียนเก่า/ฝั่งเว็บรุ่นก่อนที่ไม่มีช่องใหม่ยังผ่าน (optional)');
  const bad = (patch) => m.validateCardRecord({ ...structuredClone(rec), ...patch });
  assert.ok(bad({ suggested_dimensions: ['a', 'b', 'c', 'd'] }).some((e) => e.startsWith('suggested_dimensions')), '> 3 ข้อ');
  assert.ok(bad({ suggested_dimensions: ['ก'.repeat(121)] }).some((e) => e.startsWith('suggested_dimensions')), '> 120 ตัวอักษร');
  assert.ok(bad({ suggested_dimensions: [''] }).length, 'ข้อว่าง');
  assert.ok(bad({ suggested_dimensions: 'มุม' }).length, 'ไม่ใช่ array');
  assert.ok(bad({ suggested_dimensions: [5] }).length);
  const withQuote = (quote) => bad({ cards: [{ ...card, quote }] });
  for (const q of [{ text: 'x', speaker: 'ก', speaker_confidence: 1.5 }, { text: 'x', speaker: 'ก', speaker_confidence: null }, { text: '', speaker: 'ก', speaker_confidence: 0.9 },
    { text: 'x', speaker: 'ผ'.repeat(81), speaker_confidence: 0.9 }, { text: 'ค'.repeat(301), speaker: '', speaker_confidence: 0.9 }, 'คำพูด', null]) {
    assert.ok(withQuote(q).some((e) => e.includes('cards[0].quote')), `quote ผิดรูปต้องไม่ผ่าน: ${JSON.stringify(q)?.slice(0, 50)}`);
  }
  assert.deepEqual(withQuote({ text: 'x', speaker: '', speaker_confidence: 0 }), [], 'ขอบล่าง 0 + ไม่รู้ผู้พูด = ผ่านรูป');
  assert.ok(bad({ extra: 1 }).some((e) => e.includes('นอกสัญญา')), 'ช่องที่ไม่รู้จักยังถูกจับเหมือนเดิม');
}

test('W2-4. validateCardRecord: ช่อง optional ถูกรูปผ่าน · ไม่มีก็ผ่าน (ระเบียนเก่า) · ผิดรูป (มุมเกิน 3/ยาว/ว่าง · quote นอกช่วง/ยาว/ไม่มีข้อความ) ไม่ผ่าน', () => checkRecordValidation(schema));

function checkWriteTemplate(m) {
  const extra = JSON.parse(m.AGENT_RESULT_WRITE_TEMPLATE);
  assert.ok(Array.isArray(extra.suggested_dimensions));
  assert.ok(extra.cards[0].quote && 'speaker_confidence' in extra.cards[0].quote, 'ตัวอย่างโหมด write มี quote อยู่ในการ์ด');
  const merged = { ...JSON.parse(m.AGENT_RESULT_TEMPLATE), ...extra };
  const r = m.normalizeAgentResult(merged);
  assert.equal(r.ok, true, r.errors.join(','));
  assert.deepEqual(r.result.suggested_dimensions, [], 'เอเจนต์ลอกค่าตัวอย่างมาทั้งดุ้น = ไม่ใช่มุมเสนอจริง');
  assert.equal('quote' in r.result.cards[0], false, 'ลอก quote ตัวอย่างมาทั้งดุ้น = ไม่ใช่คำพูดจริง');
  for (const k of m.CARD_KEYS.filter((x) => x !== 'id' && x !== 'gate')) assert.ok(k in extra.cards[0], `การ์ดตัวอย่างโหมด write แสดงช่องเดิม ${k}`);
}

test('W2-5. ตัวอย่างผลโหมด write (AGENT_RESULT_WRITE_TEMPLATE) เป็น JSON ที่รวมกับโครงหลักแล้วตัวแปลงรับได้ · ค่าตัวอย่างลอกมาไม่ถูกนับ', () => checkWriteTemplate(schema));

// ── กลายพันธุ์ของ W2 (ต้องแดง) ──
test('MW1 กลายพันธุ์: ไม่จำกัด 3 ข้อ (suggested_dimensions) → ข้อตรวจมุมเสนอแดง', async () => {
  const m = await mutant('    if (out.length >= LIMITS.dimensions) break;\n', '', 'w2-no-dim-cap');
  assert.throws(() => checkDimensions(m));
});

test('MW2 กลายพันธุ์: บีบ speaker_confidence เข้า 0–1 ตั้งแต่ตัวแปลง (ด่านมองไม่เห็นค่านอกช่วง) → ข้อตรวจ quote แดง', async () => {
  const m = await mutant('    speaker_confidence: quoteScore(value.speaker_confidence),', '    speaker_confidence: normalizeConfidence(value.speaker_confidence),', 'w2-clamp-speaker');
  assert.throws(() => checkQuote(m));
});

test('MW3 กลายพันธุ์: ช่อง optional ถูกนับเป็นฟิลด์นอกสัญญา → ผลเก่า/ระเบียนใหม่แดง', async () => {
  const m = await mutant('if (!RECORD_KEYS.includes(k) && !OPTIONAL_RECORD_KEYS.includes(k)) errs.push(', 'if (!RECORD_KEYS.includes(k)) errs.push(', 'w2-optional-unknown');
  assert.throws(() => checkOldResultsUnchanged(m));
  assert.throws(() => checkRecordValidation(m));
});

test('MW4 กลายพันธุ์: ตัวแปลงทิ้ง suggested_dimensions ของเอเจนต์ → ข้อตรวจมุมเสนอแดง', async () => {
  const m = await mutant('    suggested_dimensions: normalizeDimensions(raw.suggested_dimensions, secrets),', '    suggested_dimensions: [],', 'w2-drop-dims');
  assert.throws(() => checkDimensions(m));
});

test('MW5 กลายพันธุ์: ตัวแปลงทิ้ง quote ของการ์ด → ข้อตรวจ quote แดง', async () => {
  const m = await mutant('  if (quote) card.quote = quote;', '', 'w2-drop-quote');
  assert.throws(() => checkQuote(m));
});

test('MW6 กลายพันธุ์: ไม่กรองค่าตัวอย่างจากโครง (มุมเสนอ) → เอเจนต์ลอกตัวอย่างมาแล้วกลายเป็นมุมจริง → ข้อตรวจแดง', async () => {
  const m = await mutant(' || s.includes(WRITE_TEMPLATE_PLACEHOLDERS.dimension)) continue;', ') continue;', 'w2-no-placeholder');
  assert.throws(() => checkWriteTemplate(m));
});

test('MW7 กลายพันธุ์: validator ไม่ตรวจรูป quote → quote นอกช่วงหลุดเข้าระเบียน → ข้อตรวจแดง', async () => {
  const m = await mutant('      if (problem) errs.push(`cards[${i}].quote ${problem}`);', '', 'w2-no-quote-validate');
  assert.throws(() => checkRecordValidation(m));
});
