// ============================================================
// 🧪 tests/research-agent-schema.test.mjs — สัญญาข้อมูลเอเจนต์รีเสิร์ช (SPEC-v2 ส่วน 2.2 · ด่าน 1)
// ★ 1 ต.ค. 69 (research agent v2 เลน A · สเปกล็อกโดยเจ้าของ)
// fixture = ผลจริงของเอเจนต์ในแล็บ (C:\tmp\research-agent-lab\out*\result.json → tests/fixtures/research-agent/)
// กลายพันธุ์ 5 แบบ (patch ซอร์สจริงในโฟลเดอร์ชั่วคราว → ข้อตรวจต้องแดง · ซอร์สจริงต้องเขียว)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importPatchedModule } from './helpers/temp-module.mjs';
import * as schema from '../scripts/research-agent/schema.mjs';

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
  assert.deepEqual(Object.keys(rec).sort(), [...schema.RECORD_KEYS].sort());
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
