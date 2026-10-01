// ============================================================
// 🧪 tests/research-agent-gate.test.mjs — ด่านเชิงกลของเอเจนต์รีเสิร์ช (SPEC-v2 ส่วน 6 ด่าน 1–8 · ข้อ 13/14/15)
// ★ 1 ต.ค. 69 (research agent v2 เลน A)
// fixture = ผลจริงของเอเจนต์ในแล็บ out/out2 · blacklist ต้องตรงกับ achievementResearch.js (เฝ้าความต่าง)
// กลายพันธุ์ 6 แบบ (patch gate.mjs จริงในโฟลเดอร์ชั่วคราว → ข้อตรวจต้องแดง)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importPatchedModule } from './helpers/temp-module.mjs';
import * as gate from '../scripts/research-agent/gate.mjs';
import { BLACKLIST_PATTERNS, findBlacklist, containsBlacklist } from '../scripts/research-agent/blacklist.mjs';
import { classifyTool, costFromToolLog, modelCostUsd, monthBudgetStatus, MODEL_PRICE_PER_1M, TOOL_PRICE_USD } from '../scripts/research-agent/pricing.mjs';
import { buildCardRecord, validateCardRecord } from '../scripts/research-agent/schema.mjs';

const FIX = (name) => JSON.parse(readFileSync(new URL(`./fixtures/research-agent/${name}`, import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const SRC_URL = new URL('../scripts/research-agent/gate.mjs', import.meta.url);
const SRC = readFileSync(SRC_URL, 'utf8');
const CREATED = '2026-10-01T05:15:38.248Z';

async function mutant(find, replace, name) {
  assert.ok(SRC.includes(find), `ไม่พบจุดกลายพันธุ์ ${name}`);
  return importPatchedModule(SRC.replace(find, replace), SRC_URL, `ra-gate-${name}`);
}

/** ผลเอเจนต์สังเคราะห์ (ข่าวสวีเดนขาเทียม) — การ์ดใบเดียวปรับได้ */
function synth(cards, extra = {}) {
  return {
    plan: [{ question: 'ต้นทางคือโพสต์ใด', why_valuable: 'กันข่าวเก่า', decided: 'ค้น', reason: 'ไม่มีลิงก์' }],
    origin_post: { url: 'https://www.thairath.co.th/news/local/123', source_name: 'ไทยรัฐ', date: '2026-09-30', confidence: 0.8 },
    story_date_estimate: '2026-09-30',
    stale_news_warning: null,
    cards,
    raw_corrections: [],
    flags: [],
    skipped: [],
    tool_log: [{ tool: 'serper', args: 'ขาเทียม ราชบุรี', ok: true, note: '', ms: 800 }],
    ...extra,
  };
}
const GOOD = {
  claim: 'ชายชาวสวีเดนที่สวมขาเทียมช่วยกรอกกระสอบทรายที่เขื่อนเทศบาลเมืองราชบุรี',
  value_type: 'ต้นทาง',
  why_it_adds_value: 'ยืนยันสถานที่จริง',
  evidence_quote: 'ชาวสวีเดนสวมขาเทียมมาช่วยกรอกกระสอบทรายกั้นน้ำที่เขื่อนเทศบาลเมืองราชบุรีตั้งแต่เช้า',
  source_url: 'https://www.thairath.co.th/news/local/123',
  source_name: 'ไทยรัฐ',
  source_date: '2026-09-30',
  confidence: 0.9,
  contradicts_raw: false,
  identity: 'generic',
};
const one = (m, card, extra) => m.runGate(synth([card], extra), { jobCreatedAt: CREATED, minutes: 2 }).cards[0];

// ── ข้อตรวจที่ใช้ซ้ำกับตัวกลายพันธุ์ ──
function checkEvidenceRule(m) {
  assert.equal(one(m, GOOD).gate, 'pass');
  const short = one(m, { ...GOOD, evidence_quote: '2 comments 1 share' });
  assert.equal(short.gate, 'staff_only');
  assert.match(short.gate_reason, /EVIDENCE_SHORT/);
  const unrelated = one(m, { ...GOOD, evidence_quote: 'วันนี้อากาศดีมาก ผู้คนออกมาเดินเล่นกันเต็มสวนสาธารณะ' });
  assert.equal(unrelated.gate, 'staff_only');
  assert.match(unrelated.gate_reason, /EVIDENCE_NO_TOKEN/);
}
function checkBlacklist(m) {
  const c = one(m, { ...GOOD, claim: `${GOOD.claim} และพบยาบ้าในที่เกิดเหตุ` });
  assert.equal(c.gate, 'dropped');
  assert.match(c.gate_reason, /BLACKLIST_CLAIM/);
  const ev = one(m, { ...GOOD, evidence_quote: `${GOOD.evidence_quote} ก่อนหน้านี้มีข่าวลือเรื่องคลิปหลุด` });
  assert.equal(ev.gate, 'staff_only');
  assert.match(ev.gate_reason, /BLACKLIST_EVIDENCE/);
}
function checkOwnPageOrigin(m) {
  const g = m.runGate(synth([GOOD], {
    origin_post: { url: 'https://www.facebook.com/IG.dara/posts/pfbid02xt', source_name: 'รวมไอจีดารา', date: '2026-10-01', confidence: 0.99 },
  }), { jobCreatedAt: CREATED });
  assert.equal(g.origin_post.url, null);
  assert.ok(g.flags.includes('OWN_PAGE_ORIGIN'));
  assert.ok(g.flags.includes('ORIGIN_NOT_FOUND'));
}
function checkLowConfidence(m) {
  const c = one(m, { ...GOOD, confidence: 0.55 });
  assert.equal(c.gate, 'staff_only');
  assert.match(c.gate_reason, /LOW_CONFIDENCE/);
  assert.equal(one(m, { ...GOOD, confidence: 0.6 }).gate, 'pass');
}
/** เกณฑ์ข่าวเก่า: ค่าเริ่มต้น 7 วัน · ctx.staleDays (env RESEARCH_AGENT_STALE_DAYS ผ่าน worker) ใช้แทนได้ทั้งสองทาง */
function checkStaleDays(m) {
  const at = (date, ctx = {}) => m.runGate(synth([GOOD], { story_date_estimate: date }), { jobCreatedAt: CREATED, ...ctx }).flags.includes('STALE_NEWS');
  assert.equal(m.GATE_RULES.STALE_DAYS, 7);
  assert.equal(at('2026-09-20'), true, 'ค่าเริ่มต้น: 11 วัน > 7 = ข่าวเก่า');
  assert.equal(at('2026-09-20', { staleDays: 30 }), false, 'staleDays 30: 11 วัน ยังไม่เก่า');
  assert.equal(at('2026-09-27'), false, 'ค่าเริ่มต้น: 4 วัน < 7');
  assert.equal(at('2026-09-27', { staleDays: 3 }), true, 'staleDays 3: 4 วัน = ข่าวเก่า');
}
function checkCap(m) {
  const cards = Array.from({ length: 11 }, (_, i) => ({ ...GOOD, claim: `${GOOD.claim} ข้อ ${i + 1}`, confidence: 0.6 + i * 0.03 }));
  const g = m.runGate(synth(cards), { jobCreatedAt: CREATED });
  assert.equal(g.cards.length, 8);
  assert.deepEqual(g.cards.map((c) => c.id), ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']);
  const confs = g.cards.map((c) => c.confidence);
  assert.deepEqual(confs, [...confs].sort((a, b) => b - a), 'เรียงความมั่นใจจากมากไปน้อย');
  assert.equal(g.stats.cut, 3);
  assert.ok(Math.min(...confs) >= 0.69, 'ใบที่ถูกตัดคือใบที่มั่นใจน้อยสุด');
}

test('1. fixture out → done · การ์ดบริบทผ่าน R1 · ธง ORIGIN_NOT_FOUND · ค่าเครื่องมือจาก tool_log', () => {
  const g = gate.runGate(FIX('lab-out-result.json'), { jobCreatedAt: CREATED, minutes: 2.75, maxCalls: 24, maxMinutes: 6 });
  assert.equal(g.ok, true);
  assert.equal(g.status, 'done');
  assert.equal(g.cards.length, 1);
  assert.equal(g.cards[0].id, 'R1');
  assert.equal(g.cards[0].gate, 'pass');
  assert.ok(!('gate_reason' in g.cards[0]));
  assert.deepEqual(g.flags, ['ORIGIN_NOT_FOUND']);
  assert.equal(g.usage.tool_calls, 12);
  assert.equal(g.usage.costUsd, 0.006, 'serper 4 + fetch-page 2 ครั้ง');
  assert.equal(g.usage.minutes, 2.75);
});

test('2. fixture out2 → ทุกการ์ดอ้างเพจเราเอง = staff_only · หลักฐานสั้น = EVIDENCE_SHORT · เรียกเกินงบ = OVER_BUDGET', () => {
  const g = gate.runGate(FIX('lab-out2-result.json'), { jobCreatedAt: CREATED, minutes: 4.86, maxCalls: 24, maxMinutes: 6 });
  assert.equal(g.status, 'done');
  assert.equal(g.cards.length, 3);
  assert.ok(g.cards.every((c) => c.gate === 'staff_only' && /OWN_PAGE_SOURCE/.test(c.gate_reason)));
  assert.equal(g.cards.filter((c) => /EVIDENCE_SHORT/.test(c.gate_reason)).length, 2);
  assert.ok(g.flags.includes('ORIGIN_NOT_FOUND'));
  assert.ok(g.flags.includes('OVER_BUDGET'), '25 ครั้ง > งบ 24');
  assert.equal(g.stats.pass, 0);
});

test('3. ด่าน 2 หลักฐาน ≥ 20 ตัวอักษร + มี token เฉพาะร่วมกับ claim', () => checkEvidenceRule(gate));

test('4. ด่าน 3 คำต้องห้ามใน claim = dropped · ในหลักฐานอย่างเดียว = staff_only', () => checkBlacklist(gate));

test('5. ด่าน 4 source_url ต้องเป็น http(s) ไม่งั้น dropped', () => {
  for (const u of ['ไม่พบ', 'javascript:alert(1)', 'ftp://x.com/a', '']) {
    const c = one(gate, { ...GOOD, source_url: u });
    assert.equal(c.gate, 'dropped', u);
    assert.match(c.gate_reason, /BAD_SOURCE_URL/);
  }
});

test('6. ด่าน 4 ต้นทางห้ามเป็นเพจเราเอง (IG.dara / รวมไอจีดารา / เล่าเรื่อง ดารา)', () => {
  checkOwnPageOrigin(gate);
  for (const u of ['https://m.facebook.com/IG.dara/posts/1', 'https://facebook.com/ig.dara', 'https://fb.com/IG.dara/videos/2']) assert.equal(gate.isOwnPage(u), true, u);
  assert.equal(gate.isOwnPage('https://www.facebook.com/somepage/posts/1', 'เล่าเรื่อง ดารา'), true, 'ชื่อแหล่ง');
  for (const u of ['https://www.facebook.com/IG.daraX/posts/1', 'https://www.facebook.com/tapeanews/posts/1', 'https://ig.dara.example.com/x']) assert.equal(gate.isOwnPage(u), false, u);
});

test('7. ด่าน 5 contradicts_raw → RAW_CONTRADICTION · raw_corrections ไม่มี source_url ถูกตัด (ข้อ 13)', () => {
  const g = gate.runGate(synth([{ ...GOOD, contradicts_raw: true }], {
    raw_corrections: [
      { field: 'จังหวัด', raw_value: 'ราชบุรี', source_value: 'กาญจนบุรี', source_url: 'https://www.thairath.co.th/news/local/123', confidence: 0.9 },
      { field: 'อายุ', raw_value: '30', source_value: '31', source_url: 'ไม่มี', confidence: 0.9 },
      { field: 'ชื่อ', raw_value: 'ก', source_value: 'ข', source_url: 'https://www.facebook.com/IG.dara/posts/9', confidence: 0.9 },
    ],
  }), { jobCreatedAt: CREATED });
  assert.ok(g.flags.includes('RAW_CONTRADICTION'));
  assert.equal(g.raw_corrections.length, 1);
  assert.equal(g.raw_corrections[0].source_value, 'กาญจนบุรี');
  const onlyCorrection = gate.runGate(synth([GOOD], { raw_corrections: [{ field: 'x', raw_value: 'a', source_value: 'b', source_url: 'https://a.co/b', confidence: 0.8 }] }), {});
  assert.ok(onlyCorrection.flags.includes('RAW_CONTRADICTION'));
});

test('8. ด่าน 6 confidence < 0.6 → staff_only', () => checkLowConfidence(gate));

test('9. ด่าน 8 การ์ด > 8 ใบ → เรียง confidence แล้วตัด · id R1..R8', () => checkCap(gate));

test('10. identity verified ต้องผ่านด่าน + มั่นใจ ≥ 0.8 ไม่งั้นกลับเป็น generic', () => {
  assert.equal(one(gate, { ...GOOD, identity: 'verified', confidence: 0.85 }).identity, 'verified');
  assert.equal(one(gate, { ...GOOD, identity: 'verified', confidence: 0.7 }).identity, 'generic');
  assert.equal(one(gate, { ...GOOD, identity: 'verified', confidence: 0.95, evidence_quote: 'สั้น' }).identity, 'generic');
});

test('11. ข่าวเก่า (ข้อ 14): วันที่เรื่องเก่ากว่าวันส่ง > เกณฑ์ (ค่าเริ่มต้น 7 วัน · ctx.staleDays) → STALE_NEWS · เอเจนต์ตั้งเองก็คงไว้', () => {
  checkStaleDays(gate);
  assert.ok(gate.runGate(synth([GOOD], { story_date_estimate: '2026-08-01' }), { jobCreatedAt: CREATED }).flags.includes('STALE_NEWS'));
  assert.ok(!gate.runGate(synth([GOOD], { story_date_estimate: '2026-09-25' }), { jobCreatedAt: CREATED }).flags.includes('STALE_NEWS'), '6 วัน < 7');
  assert.ok(gate.runGate(synth([GOOD], { flags: ['STALE_NEWS'] }), { jobCreatedAt: CREATED }).flags.includes('STALE_NEWS'));
  const old = gate.runGate(synth([GOOD], { story_date_estimate: '2020-01-01' }), { jobCreatedAt: CREATED });
  assert.equal(old.status, 'done', 'ข่าวเก่าแค่ไหนก็ธงอย่างเดียว ไม่หยุดงาน (เจ้าของข้อ 14)');
  assert.equal(old.cards[0].gate, 'pass');
  for (const bad of [undefined, null, '', 0, -3, 'x']) assert.equal(gate.staleDaysOf(bad), 7, `staleDays ${String(bad)} = ค่าเริ่มต้น`);
});

test('12. schema ไม่ครบ → failed + AGENT_FAILED (ด่าน 1)', () => {
  const g = gate.runGate({ cards: [] }, { minutes: 1 });
  assert.equal(g.ok, false);
  assert.equal(g.status, 'failed');
  assert.deepEqual(g.flags, ['AGENT_FAILED']);
  assert.ok(g.errors.length >= 2);
});

test('13. ผลด่าน → buildCardRecord ผ่าน validateCardRecord ทั้งสอง fixture (สัญญา 2.2 ครบทาง)', () => {
  for (const f of ['lab-out-result.json', 'lab-out2-result.json']) {
    const g = gate.runGate(FIX(f), { jobCreatedAt: CREATED, minutes: 3 });
    const rec = buildCardRecord({ jobId: 'q_0123456789abcdef', status: g.status, brain: { kind: 'codex', effort: 'low', account: 'main' }, gated: g, usage: g.usage, nowIso: CREATED });
    assert.deepEqual(validateCardRecord(rec), [], f);
  }
});

test('14. blacklist ไฟล์กลาง = รายการเดียวกับ achievementResearch.js (ลำดับเดียวกัน) · จับตัวพิมพ์เล็กได้จริง', () => {
  const src = readFileSync(new URL('../src/lib/services/achievementResearch.js', import.meta.url), 'utf8');
  const block = /const BLACKLIST_PATTERNS = \[([\s\S]*?)\];/.exec(src);
  assert.ok(block, 'หา BLACKLIST_PATTERNS ใน achievementResearch.js ไม่เจอ');
  const words = [...block[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.deepEqual([...BLACKLIST_PATTERNS], words, 'รายการคำต้องห้ามต่างจากต้นฉบับ — ซิงก์ให้ตรง');
  assert.ok(containsBlacklist('ผลตรวจ hiv เป็นลบ'), "ต้นฉบับจับ 'HIV' ไม่ได้ (lowercase ฝั่งเดียว) — ไฟล์กลางต้องจับได้");
  assert.deepEqual(findBlacklist('ข่าวฆาตกรรมและยาบ้า ถูกฆ่า'), ['ฆ่า', 'ฆาตกรรม', 'ยาบ้า']);
  assert.equal(containsBlacklist(''), false);
  assert.equal(containsBlacklist(null), false);
});

/** 'ฆ่า' ต้องไม่จับ 'ฆ่าเชื้อ' (ข้อตัดสินผู้คุมงาน 1 ต.ค. 69) แต่ 'ฆ่า' ตัวอื่นในข้อความเดียวกันยังจับ */
function checkKillDisinfect(bl) {
  for (const t of ['ใช้แอลกอฮอล์ฆ่าเชื้อโรคทุกวัน', 'ยาฆ่าเชื้อ', 'ฆ่าเชื้อ ฆ่าเชื้อ', 'โรงพยาบาลฆ่าเชื้อเครื่องมือ']) {
    assert.deepEqual(bl.findBlacklist(t), [], `ฆ่าเชื้อไม่ใช่คำต้องห้าม: ${t}`);
  }
  assert.deepEqual(bl.findBlacklist('ฆ่าเชื้อแล้วฆ่าคน'), ['ฆ่า'], "'ฆ่า' อีกตัวในข้อความเดียวกันยังจับ");
  assert.deepEqual(bl.findBlacklist('ถูกฆ่าตาย'), ['ฆ่า']);
  assert.deepEqual(bl.findBlacklist('ฆ่าเชื้อชาติอื่น'), ['ฆ่า'], "'ฆ่า'+'เชื้อชาติ' ไม่ใช่ข้อยกเว้น");
  assert.deepEqual(bl.findBlacklist('คิดฆ่าตัวตาย'), ['ฆ่า', 'ฆ่าตัวตาย'], 'ข้อยกเว้นไม่กระทบคำต้องห้ามอื่น');
}

test('14b. คำต้องห้าม: ฆ่าเชื้อ ≠ ฆ่า (รายการยกเว้นเฉพาะคำ) · การ์ดข่าวสุขอนามัยผ่านด่าน', () => {
  checkKillDisinfect({ findBlacklist });
  const card = {
    ...GOOD,
    claim: 'โรงพยาบาลราชบุรีฆ่าเชื้อกระสอบทรายทุกใบก่อนแจกชาวบ้าน 1,200 ใบ',
    evidence_quote: 'โรงพยาบาลราชบุรีฆ่าเชื้อกระสอบทรายก่อนแจกจ่ายให้ชาวบ้านรวม 1,200 ใบ',
  };
  const c = one(gate, card);
  assert.equal(c.gate, 'pass', c.gate_reason);
  assert.equal(one(gate, { ...card, claim: `${card.claim} หลังมีคนถูกฆ่า` }).gate, 'dropped');
});

test('15. ราคาเครื่องมือ: จัดชนิดจากชื่อ/อาร์กิวเมนต์ · worker ไม่นับ · งบเดือน', () => {
  assert.equal(classifyTool({ tool: 'exec_command / serper', args: 'node tools/serper.mjs x' }), 'serper');
  assert.equal(classifyTool({ tool: 'exec_command', args: 'node tools/fetch-page.mjs https://th.wikipedia.org/x' }), 'fetch-page');
  assert.equal(classifyTool({ tool: 'cua', args: 'getState' }), 'browser');
  assert.equal(classifyTool({ tool: 'web.run', args: 'ค้น' }), 'codex-web-search');
  assert.equal(classifyTool({ tool: 'node tools/web-agent.mjs' }), 'web-agent');
  assert.equal(classifyTool({ tool: 'exec_command', args: 'Get-Content README-TOOLS.md' }), 'other');
  const c = costFromToolLog([{ tool: 'apify' }, { tool: 'apify' }, { tool: 'worker', args: 'x' }, { tool: 'reverse-image' }]);
  assert.equal(c.tool_calls, 3);
  assert.equal(c.costUsd, TOOL_PRICE_USD.apify * 2 + TOOL_PRICE_USD['reverse-image']);
  // ราคา API (ข้อตัดสินผู้คุมงาน 1 ต.ค. 69 · ต้องตรงกับ usageLogger.js เลน B): astra $10/$50 ทางการ · sol/luna ประมาณ
  assert.equal(modelCostUsd('gpt-6-astra', 1e6, 1e6), 60);
  assert.equal(modelCostUsd('gpt-6-astra', 10_000, 2_000), 0.2);
  assert.deepEqual({ ...MODEL_PRICE_PER_1M['gpt-6-astra'] }, { input: 10, output: 50 });
  assert.deepEqual({ ...MODEL_PRICE_PER_1M['gpt-6-sol'] }, { input: 5, output: 30 });
  assert.deepEqual({ ...MODEL_PRICE_PER_1M['gpt-6-luna'] }, { input: 1, output: 6 });
  assert.equal(modelCostUsd('gpt-6-sol', 1e6, 1e6), 35);
  assert.equal(modelCostUsd('gpt-6-luna', 1e6, 1e6), 7);
  assert.equal(modelCostUsd('ไม่รู้จัก', 1e6, 0), 10, 'ไม่รู้จักรุ่น = ราคา astra (ประมาณสูงไว้ก่อน)');
  assert.equal(TOOL_PRICE_USD['web-agent'], 0.12, 'web-agent ~3k in/1.2k out ที่ราคาใหม่ + web_search 2–3 ครั้ง');
  assert.equal(monthBudgetStatus({ spentUsd: 9.99, addUsd: 0.02, capUsd: 10 }).reached, true);
  assert.equal(monthBudgetStatus({ spentUsd: 1, addUsd: 0.02, capUsd: 10 }).reached, false);
  assert.equal(monthBudgetStatus({ spentUsd: 1, addUsd: 1, capUsd: 0 }).reached, false, 'เพดาน 0 = ไม่เตือน');
});

test('16. token เฉพาะ: ตัวเลข/ละติน/ชื่อไทย (คู่คำที่ตัวตัดคำแยก) — คำสามัญไม่นับ', () => {
  assert.deepEqual(gate.evidenceSharesToken('ยอดแชร์ 1,250 ครั้ง', 'มีคนแชร์ 1250 ครั้งแล้ว').shared, ['1250']);
  assert.ok(gate.evidenceSharesToken('เงิน 1200000 บาท', 'ยอดรวม 1,200,000 บาท').shared.includes('1200000'), 'จุลภาคทุกกลุ่ม');
  assert.ok(gate.specificTokens('ยอด 1,200,000 บาท').includes('1200000'));
  assert.equal(gate.evidenceSharesToken('ยอดแชร์ 12 ครั้ง', 'โพสต์เมื่อ 2026-10-12').ok, true, 'ตัวเลขตรงทั้งก้อน 12');
  assert.equal(gate.evidenceSharesToken('ยอดแชร์ 2 ครั้ง', 'โพสต์เมื่อ 2026-10-12').ok, false, '2 ไม่ใช่ 2026/10/12');
  assert.ok(gate.evidenceSharesToken('Swedish volunteer', 'a SWEDISH man helped').ok);
  assert.ok(gate.evidenceSharesToken('ชาวสวีเดนสวมขาเทียม', 'He wore a prosthetic leg ขาเทียม').ok);
  assert.equal(gate.evidenceSharesToken('เรื่องที่เกิดขึ้นในเพจ', 'เรื่องนี้เกิดขึ้นเมื่อวาน').ok, false, 'มีแต่คำสามัญ');
  assert.ok(gate.specificTokens('ครู ๑๒ คน').includes('12'), 'เลขไทยแปลงเป็นอารบิก');
});

// ── กลายพันธุ์ (ต้องแดง) ──
test('M1 กลายพันธุ์: เกณฑ์หลักฐาน 20 → 2 ตัวอักษร (ข้อตรวจด่าน 2 ต้องแดง)', async () => {
  const m = await mutant('MIN_EVIDENCE_CHARS: 20,', 'MIN_EVIDENCE_CHARS: 2,', 'evidence-2');
  assert.throws(() => checkEvidenceRule(m));
});

test('M2 กลายพันธุ์: ไม่ตรวจคำต้องห้ามใน claim (ข้อตรวจด่าน 3 ต้องแดง)', async () => {
  const m = await mutant("if (findBlacklist(card.claim).length) { lower('dropped'); reasons.push('BLACKLIST_CLAIM'); }", '', 'no-blacklist');
  assert.throws(() => checkBlacklist(m));
});

test('M3 กลายพันธุ์: ยอมเพจเราเองเป็นต้นทาง (ข้อตรวจด่าน 4 ต้องแดง)', async () => {
  const m = await mutant('if (origin.url && isOwnPage(origin.url, origin.source_name, own)) {', 'if (false && isOwnPage(origin.url, origin.source_name, own)) {', 'own-origin');
  assert.throws(() => checkOwnPageOrigin(m));
});

test('M4 กลายพันธุ์: เกณฑ์ความมั่นใจ 0.6 → 0.1 (ข้อตรวจด่าน 6 ต้องแดง)', async () => {
  const m = await mutant('MIN_CONFIDENCE: 0.6,', 'MIN_CONFIDENCE: 0.1,', 'conf-01');
  assert.throws(() => checkLowConfidence(m));
});

test('M5 กลายพันธุ์: ไม่ตัดการ์ดเกิน 8 (ข้อตรวจด่าน 8 ต้องแดง)', async () => {
  const m = await mutant('gatedCards.slice(0, GATE_RULES.MAX_CARDS)', 'gatedCards.slice(0, 99)', 'no-cap');
  assert.throws(() => checkCap(m));
});

test('M6 กลายพันธุ์: หลักฐานไม่ต้องมี token ร่วม (ข้อตรวจด่าน 2 ต้องแดง)', async () => {
  const m = await mutant('return { ok: shared.length > 0, shared };', 'return { ok: true, shared };', 'token-always');
  assert.throws(() => checkEvidenceRule(m));
});

const BL_URL = new URL('../scripts/research-agent/blacklist.mjs', import.meta.url);
const BL_SRC = readFileSync(BL_URL, 'utf8');
async function blMutant(find, replace, name) {
  assert.ok(BL_SRC.includes(find), `ไม่พบจุดกลายพันธุ์ ${name}`);
  return importPatchedModule(BL_SRC.replace(find, replace), BL_URL, `ra-blacklist-${name}`);
}

test('M7 กลายพันธุ์: ไม่สน ctx.staleDays (env RESEARCH_AGENT_STALE_DAYS) (ข้อตรวจเกณฑ์ข่าวเก่าต้องแดง)', async () => {
  const m = await mutant('staleDaysOf(ctx.staleDays) * 86400000', 'GATE_RULES.STALE_DAYS * 86400000', 'stale-ctx-ignored');
  assert.throws(() => checkStaleDays(m));
});

test('M8 กลายพันธุ์: ค่าเริ่มต้นข่าวเก่ากลับเป็น 30 วัน (ข้อตรวจเกณฑ์ข่าวเก่าต้องแดง)', async () => {
  const m = await mutant('  STALE_DAYS: 7,', '  STALE_DAYS: 30,', 'stale-30');
  assert.throws(() => checkStaleDays(m));
});

test('M9 กลายพันธุ์: ไม่ใช้รายการยกเว้น — ฆ่าเชื้อโดนจับ (ข้อตรวจคำต้องห้ามต้องแดง)', async () => {
  const m = await blMutant("const hay = ex ? ex.reduce((s, re) => s.replace(re, ' '), lower) : lower;", 'const hay = lower;', 'no-exception');
  assert.throws(() => checkKillDisinfect(m));
});

test('M10 กลายพันธุ์: ข้อยกเว้นกว้างเกิน (ลบ ฆ่า ทุกตัว) (ข้อตรวจคำต้องห้ามต้องแดง)', async () => {
  const m = await blMutant('/ฆ่าเชื้อ(?!ชาติ)/gu', '/ฆ่า/gu', 'exception-too-broad');
  assert.throws(() => checkKillDisinfect(m));
});

// ============================================================
// ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.3 · เลน W2) — ด่านกับฟิลด์ใหม่: "ไม่ตัดการ์ดเพราะฟิลด์ใหม่"
//   quote: speaker_confidence นอกช่วง 0–1/อ่านไม่ได้ หรือมีคำต้องห้าม → ลบ quote การ์ดคง gate/ช่องเดิม
//   suggested_dimensions: blacklist ชุดเดียวกับ claim → ตัดเฉพาะข้อ · ผลเก่า = การ์ด/ธง/สถานะเดิม
// (ซอร์สที่ใช้กลายพันธุ์อ่านเป็น LF เสมอ — บทเรียน autocrlf ของ 827336d7)
// ============================================================
const SRC_LF = SRC.replace(/\r\n/g, '\n');
async function mutantW2(find, replace, name) {
  assert.ok(SRC_LF.includes(find), `ไม่พบจุดกลายพันธุ์ ${name}`);
  return importPatchedModule(SRC_LF.replace(find, replace), SRC_URL, `ra-gate-w2-${name}`);
}
const QUOTE_OK = Object.freeze({ text: 'ชาวสวีเดนบอกว่ามาช่วยกรอกกระสอบทรายเพราะอยากตอบแทนคนราชบุรี', speaker: 'ชายชาวสวีเดน', speaker_confidence: 0.93 });
const withoutQuote = (card) => { const c = { ...card }; delete c.quote; return c; };

function checkOldResultsGate(m) {
  for (const f of ['lab-out-result.json', 'lab-out2-result.json']) {
    const g = m.runGate(FIX(f), { jobCreatedAt: CREATED, minutes: 3 });
    assert.deepEqual(g.suggested_dimensions, [], `${f}: ไม่มีมุมเสนอ = []`);
    assert.ok(g.cards.every((c) => !('quote' in c)), `${f}: ไม่มี quote`);
    assert.deepEqual([g.stats.quotesDropped, g.stats.dimensionsDropped], [0, 0]);
  }
  const failed = m.runGate({ cards: [] }, { minutes: 1 });
  assert.deepEqual(failed.suggested_dimensions, [], 'ผลล้มรูปเดียวกัน');
}

test('W2-1. ผลเก่า (fixture out/out2) ผ่านด่านเหมือนเดิม: ไม่มี quote · มุมเสนอ [] · ตัวนับใหม่เป็น 0 (ข้อ 1/2 เดิมยังตรึงการ์ด/ธง/เงิน)', () => checkOldResultsGate(gate));

function checkQuoteGate(m) {
  const kept = one(m, { ...GOOD, quote: QUOTE_OK });
  assert.equal(kept.gate, 'pass');
  assert.deepEqual(kept.quote, QUOTE_OK, 'quote ถูกรูป = คงไว้ทุกช่อง');
  for (const [sc, label] of [[1.5, '> 1'], [-0.1, '< 0'], [95, 'สเกล 0–100'], [null, 'null'], ['สูงมาก', 'ข้อความไม่ใช่ตัวเลข'], [Number.NaN, 'NaN']]) {
    const g = m.runGate(synth([{ ...GOOD, quote: { ...QUOTE_OK, speaker_confidence: sc } }]), { jobCreatedAt: CREATED, minutes: 2 });
    const c = g.cards[0];
    assert.equal('quote' in c, false, `speaker_confidence ${label} → ลบ quote`);
    assert.equal(c.gate, 'pass', `${label}: การ์ดต้องไม่ถูกลดเพราะ quote`);
    assert.ok(!('gate_reason' in c), `${label}: ไม่มีเหตุผลด่านงอก`);
    assert.deepEqual(c, withoutQuote(one(m, GOOD)), `${label}: การ์ดเหมือนไม่เคยมี quote ทุกช่อง`);
    assert.deepEqual([g.stats.quotesDropped, g.stats.quoteDropReasons], [1, ['QUOTE_SPEAKER_CONFIDENCE']], label);
    assert.equal(g.status, 'done');
  }
  for (const [edge, value] of [['ขอบล่าง', 0], ['ขอบบน', 1]]) assert.equal(one(m, { ...GOOD, quote: { ...QUOTE_OK, speaker_confidence: value } }).quote.speaker_confidence, value, edge);
  const bl = m.runGate(synth([{ ...GOOD, quote: { ...QUOTE_OK, text: 'เขาเล่าว่าเคยติดยาบ้ามาก่อน' } }]), { jobCreatedAt: CREATED });
  assert.equal('quote' in bl.cards[0], false, 'คำต้องห้ามในคำพูด → ลบ quote');
  assert.equal(bl.cards[0].gate, 'pass', 'คำต้องห้ามในคำพูดไม่ลดการ์ด (claim สะอาด)');
  assert.deepEqual(bl.stats.quoteDropReasons, ['QUOTE_BLACKLIST']);
  const staff = one(m, { ...GOOD, confidence: 0.55, quote: QUOTE_OK });
  assert.equal(staff.gate, 'staff_only');
  assert.deepEqual(staff.quote, QUOTE_OK, 'การ์ด staff_only คง quote ที่ถูกรูป (ด่าน quote ไม่ขึ้นกับ gate)');
}

test('W2-2. quote: speaker_confidence นอกช่วง 0–1/อ่านไม่ได้ หรือมีคำต้องห้าม → ลบ quote ไม่ลบการ์ด (gate/ช่องเดิม) · ขอบ 0 และ 1 ผ่าน · นับใน stats', () => checkQuoteGate(gate));

function checkDimensionsGate(m) {
  const g = m.runGate(synth([GOOD], { suggested_dimensions: ['มุมน้ำใจข้ามชาติ', 'มุมคนติดยาบ้าในหมู่บ้าน', 'มุมคลิปหลุดของอาสา'] }), { jobCreatedAt: CREATED, minutes: 2 });
  assert.deepEqual(g.suggested_dimensions, ['มุมน้ำใจข้ามชาติ'], 'blacklist ชุดเดียวกับ claim ตัดเฉพาะข้อที่ติด');
  assert.equal(g.stats.dimensionsDropped, 2);
  assert.equal(g.status, 'done');
  assert.equal(g.cards[0].gate, 'pass', 'มุมเสนอติดคำต้องห้ามไม่กระทบการ์ด');
  assert.deepEqual(m.runGate(synth([GOOD], { suggested_dimensions: ['ใช้แอลกอฮอล์ฆ่าเชื้อกระสอบทราย'] }), { jobCreatedAt: CREATED }).suggested_dimensions,
    ['ใช้แอลกอฮอล์ฆ่าเชื้อกระสอบทราย'], 'ข้อยกเว้นคำประสม (ฆ่าเชื้อ) ใช้ร่วมกับ claim');
  const rec = buildCardRecord({ jobId: 'q_w2gate', status: g.status, mode: 'write', brain: { kind: 'codex' }, gated: g, usage: g.usage, nowIso: CREATED });
  assert.deepEqual(rec.suggested_dimensions, ['มุมน้ำใจข้ามชาติ'], 'ผลด่านถึงระเบียน');
  assert.deepEqual(validateCardRecord(rec), []);
}

test('W2-3. suggested_dimensions ผ่าน blacklist เดียวกับ claim (ตัดเฉพาะข้อ · ข้อยกเว้นฆ่าเชื้อใช้ร่วม) → ส่งต่อ buildCardRecord · การ์ดไม่กระทบ', () => checkDimensionsGate(gate));

function checkNewFieldsNeverCut(m) {
  const cards = [
    GOOD,
    { ...GOOD, claim: `${GOOD.claim} ข้อ 2`, confidence: 0.55 },
    { ...GOOD, claim: `${GOOD.claim} และพบยาบ้า` },
    { ...GOOD, claim: `${GOOD.claim} ข้อ 4`, source_url: 'ไม่พบ' },
  ];
  const plain = m.runGate(synth(cards), { jobCreatedAt: CREATED, minutes: 2 });
  const rich = m.runGate(synth(cards.map((c, i) => ({ ...c, quote: { ...QUOTE_OK, speaker_confidence: i % 2 ? 7 : 0.95 } })), {
    suggested_dimensions: ['มุมหนึ่ง', 'มุมสอง', 'มุมสาม', 'มุมสี่'],
  }), { jobCreatedAt: CREATED, minutes: 2 });
  assert.deepEqual(rich.cards.map(withoutQuote), plain.cards, 'ฟิลด์ใหม่ไม่เปลี่ยน id/gate/gate_reason/ลำดับของการ์ดใบไหนเลย');
  assert.deepEqual([rich.status, rich.flags, rich.usage], [plain.status, plain.flags, plain.usage]);
  assert.deepEqual(rich.suggested_dimensions, ['มุมหนึ่ง', 'มุมสอง', 'มุมสาม'], 'ตัวแปลงตัดเหลือ 3 ข้อ');
}

test('W2-4. "gate ไม่ตัดการ์ดเพราะฟิลด์ใหม่": ผลเดียวกัน มี/ไม่มี quote+มุมเสนอ → การ์ด (id/gate/เหตุผล/ลำดับ) ธง สถานะ เงิน เท่ากันทุกช่อง', () => checkNewFieldsNeverCut(gate));

// ── กลายพันธุ์ของ W2 (ต้องแดง) ──
test('MW1 กลายพันธุ์: ด่าน quote ไม่ตรวจช่วง speaker_confidence → ข้อตรวจ quote แดง', async () => {
  const m = await mutantW2("  else if (typeof sc !== 'number' || !Number.isFinite(sc)\n    || sc < GATE_RULES.QUOTE_SPEAKER_CONFIDENCE_MIN || sc > GATE_RULES.QUOTE_SPEAKER_CONFIDENCE_MAX) dropped = 'QUOTE_SPEAKER_CONFIDENCE';\n", '', 'no-sc-range');
  assert.throws(() => checkQuoteGate(m));
});

test('MW2 กลายพันธุ์: quote ผิดช่วงแล้วลดการ์ดเป็น dropped (ตัดการ์ดเพราะฟิลด์ใหม่) → ข้อตรวจแดง', async () => {
  const m = await mutantW2('  return { card: rest, dropped };', "  return { card: { ...rest, gate: 'dropped', gate_reason: dropped }, dropped };", 'drop-card');
  assert.throws(() => checkQuoteGate(m));
  assert.throws(() => checkNewFieldsNeverCut(m));
});

test('MW3 กลายพันธุ์: มุมเสนอไม่ผ่าน blacklist → ข้อตรวจมุมเสนอแดง', async () => {
  const m = await mutantW2("    if (typeof d === 'string' && d && !findBlacklist(d).length) kept.push(d);", "    if (typeof d === 'string' && d) kept.push(d);", 'dims-no-blacklist');
  assert.throws(() => checkDimensionsGate(m));
});

test('MW4 กลายพันธุ์: ด่านไม่ส่งมุมเสนอต่อ (ทิ้งทั้งหมด) → ข้อตรวจมุมเสนอ/ไม่ตัดการ์ดแดง', async () => {
  const m = await mutantW2('    suggested_dimensions: dims.kept,', '    suggested_dimensions: [],', 'dims-dropped');
  assert.throws(() => checkDimensionsGate(m));
  assert.throws(() => checkNewFieldsNeverCut(m));
});

test('MW5 กลายพันธุ์: ไม่ตรวจคำต้องห้ามในคำพูด → ข้อตรวจ quote แดง', async () => {
  const m = await mutantW2("  else if (findBlacklist(q.text).length || findBlacklist(q.speaker).length) dropped = 'QUOTE_BLACKLIST';\n", '', 'quote-no-blacklist');
  assert.throws(() => checkQuoteGate(m));
});

test('MW6 กลายพันธุ์: runGate ไม่เรียกด่าน quote → quote นอกช่วงหลุดถึงระเบียน → ข้อตรวจแดง', async () => {
  const m = await mutantW2('    const q = gateQuote(gateCard(c, own));', '    const q = { card: gateCard(c, own), dropped: null };', 'no-quote-gate');
  assert.throws(() => checkQuoteGate(m));
});
