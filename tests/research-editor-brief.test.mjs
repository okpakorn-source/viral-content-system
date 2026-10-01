// ============================================================
// 🧪 tests/research-editor-brief.test.mjs — บรรณาธิการเรียบเรียง (Research Agent v2 โหมด write · SPEC-v3 ส่วน 1/2 · เลน W1)
// ------------------------------------------------------------
// ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3) — ไฟล์ใหม่
// ตรวจ src/lib/research-agent/editorBrief.js แบบหน่วย (ไม่ต่อเน็ต ไม่ยิง AI จริง — invoke ปลอมทุกข้อ · claudeClient ถูก stub เป็นตัวบันทึก)
//   A. เกณฑ์การ์ด (ข้อ 6 · 11): 0.85 ทั่วไป · 0.75 สื่อหลัก (โดเมน/ชื่อรายการ) · gate=pass เท่านั้น · dropped ไม่แสดง · quote ตรง ≥ 0.9 + ผู้พูด
//   B. พรอมต์: กติกาคงที่ไว้ต้น (prefix แคช — เหมือนกันทุกข่าว) · ข้อมูลข่าวไว้ท้าย · บอกเพดานความยาว · quote อนุญาต/ห้ามอัญประกาศ
//   C. อ่านคำตอบ: object/สตริง/```json/ขยะ/enriched ว่าง
//   D. ด่านเชิงกล: URL · คำอ้างแหล่ง · ตัวเลข (เลขไทย) · คำอังกฤษ · อัญประกาศ · ชื่อคนหลังคำนำหน้า · ชื่อสถานที่ · ตัดเกิน 30% · ยาว >2 / <0.6 เท่า
//   E. runEditorBrief: done (args ถึงโมเดลถูก: opus-5-5 medium ห้าม low · maxTokens < เพดาน non-streaming · prefix cache · signal · facts)
//      skipped ไม่เรียกโมเดล · failed ทุกทาง (โยน/ขยะ/หมดเวลาด้วยนาฬิกาปลอม/ด่านตัด/ต้นฉบับยาว/อินพุตเพี้ยน) — ไม่โยนเลย
//   F. mutation ≥ 8 แบบ (ข้อท้ายไฟล์) — ของจริงเขียว ของกลายพันธุ์ต้องแดงทุกตัว
// ไม่มี timer จริงที่ค้าง: นาฬิกา/ตัวตั้งเวลาฉีดเอง · await ที่อาจค้างครอบ settleWithin (tests/helpers/fake-deadline.mjs — บทเรียน CI node 22)
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { settleWithin } from './helpers/fake-deadline.mjs';
import { importSource, installResearchHooks, replaceOnce, ROOT, srcUrl } from './helpers/research-web-fakes.mjs';

const hooks = installResearchHooks({
  stubs: {
    // ตัวเรียกโมเดลจริงถูกแทนด้วยตัวบันทึก — ถ้ามีข้อไหนหลุดไปเรียกโดยไม่ตั้งใจจะเห็นใน __RWE_CALLS (และไม่มีเน็ต)
    '@/lib/ai/claudeClient': 'export const callClaude = async (args) => { (globalThis.__RWE_CALLS ||= []).push(args); return globalThis.__RWE_REPLY ?? { enriched_source: "" }; };',
  },
});

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const SRC = read('src/lib/research-agent/editorBrief.js');
const EB = await import(srcUrl('lib/research-agent/editorBrief.js'));
const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

// ── fixture: ข่าวเนย-แจม (ตัวอย่างในสเปก 8.1) ───────────────────────
const RAW = 'เนย กับ แจม สองพี่น้องช่วยกันผ่อนบ้านราคา 20 ล้าน ทั้งคู่ออกรายการตีท้ายครัวเล่าว่าซื้อบ้านหลังนี้ใหม่ และตั้งใจจะดูแลพ่อแม่ให้สบาย';
const EXTRACTED = { newsTitle: 'สองพี่น้องผ่อนบ้าน 20 ล้าน', newsBody: 'เนยและแจมช่วยกันผ่อนบ้าน 20 ล้าน ตั้งใจดูแลพ่อแม่' };
const card = (over) => ({
  id: 'R1', claim: 'c', value_type: 'อื่นๆ', why_it_adds_value: 'w', evidence_quote: 'หลักฐานยาวพอสมควรสำหรับการ์ดใบนี้',
  source_url: 'https://news.example.test/a', source_name: 'ข่าวท้องถิ่น', source_date: '2026-09-27', confidence: 0.9,
  contradicts_raw: false, identity: 'generic', gate: 'pass', ...over,
});
function cardsDocFixture() {
  return {
    id: 'q_rwe1', status: 'done', mode: 'write', flags: ['RAW_CONTRADICTION'],
    origin_post: { url: 'https://www.youtube.com/watch?v=abc', source_name: 'ตีท้ายครัว', date: '2026-09-27', confidence: 0.9 },
    story_date_estimate: '2026-09-27', stale_news_warning: null,
    suggested_dimensions: ['มุมพี่น้องช่วยกันผ่อนบ้าน'],
    cards: [
      card({ id: 'R1', claim: 'บ้านราคา 18 ล้าน บวกค่าตกแต่ง 3 ล้าน', evidence_quote: 'บ้านหลังนี้ราคา 18 ล้านบาท ตกแต่งเพิ่มอีก 3 ล้าน', source_url: 'https://www.kapook.com/view1', source_name: 'kapook', confidence: 0.8, contradicts_raw: true }),
      card({ id: 'R2', claim: 'ทั้งสองอยู่บ้านหลังนี้มา 5 ปีแล้ว', evidence_quote: 'เราอยู่บ้านหลังนี้มา 5 ปีแล้วค่ะ', source_url: 'https://www.youtube.com/watch?v=abc', source_name: 'ตีท้ายครัว (YouTube)', confidence: 0.9,
        quote: { text: 'เราอยู่บ้านหลังนี้มา 5 ปีแล้วค่ะ', speaker: 'เนย', speaker_confidence: 0.95 } }),
      card({ id: 'R3', claim: 'มีพี่น้อง 3 คน', evidence_quote: 'ครอบครัวนี้มีพี่น้องทั้งหมด 3 คน', source_url: 'https://blog.example.test/x', source_name: 'บล็อกส่วนตัว', confidence: 0.8 }),
      card({ id: 'R4', claim: 'แม่ทำงานโรงงาน', evidence_quote: 'สั้น', confidence: 0.99, gate: 'staff_only', gate_reason: 'EVIDENCE_TOO_SHORT' }),
      card({ id: 'R5', claim: 'ข้อความต้องห้าม', confidence: 0.99, gate: 'dropped', gate_reason: 'BLACKLIST' }),
      card({ id: 'R6', claim: 'แจมเคยเล่าเรื่องงานโรงงาน', evidence_quote: 'เคยทำงานโรงงานมาก่อนแล้วก็เก็บเงินเอง', source_url: 'https://www.facebook.com/somepage/videos/1', source_name: 'ไลฟ์ของแจม', confidence: 0.92,
        quote: { text: 'เคยทำงานโรงงานมาก่อน', speaker: 'แจม', speaker_confidence: 0.7 } }),
    ],
    raw_corrections: [
      { field: 'ราคาบ้าน', raw_value: '20 ล้าน', source_value: '18 ล้าน + ค่าตกแต่ง 3 ล้าน', source_url: 'https://www.kapook.com/view1', confidence: 0.8 },
      { field: 'จำนวนพี่น้อง', raw_value: '2', source_value: '3', source_url: 'https://blog.example.test/x', confidence: 0.7 },
    ],
  };
}
const ENRICHED_OK = [
  'เนย กับ แจม สองพี่น้องช่วยกันผ่อนบ้านราคา 18 ล้านบาท และตกแต่งเพิ่มอีก 3 ล้าน',
  'ทั้งคู่ออกรายการ "ตีท้ายครัว" และเล่าว่าอยู่บ้านหลังนี้มา 5 ปีแล้ว',
  'เนยบอกว่า "เราอยู่บ้านหลังนี้มา 5 ปีแล้วค่ะ"',
  '',
  'ทั้งสองตั้งใจจะดูแลพ่อแม่ให้สบาย',
].join('\n');
const replyOk = (over = {}) => ({
  enriched_source: ENRICHED_OK,
  used_cards: ['R1', 'R2', 'R9'],
  corrections: [
    { field: 'ราคาบ้าน', from: '20 ล้าน', to: '18 ล้าน + ตกแต่ง 3 ล้าน', source_url: 'https://www.kapook.com/view1' },
    { field: 'อายุบ้าน', from: 'ซื้อใหม่', to: 'อยู่มา 5 ปี', source_url: 'https://www.youtube.com/watch?v=abc' },
    { field: 'ยอดรวม', from: '20', to: '21 ล้าน', source_url: 'https://www.kapook.com/view1' },
  ],
  additions: [{ text: 'อยู่บ้านมา 5 ปี', card: 'R2' }, { text: 'ข้อความลอย', card: 'R7' }],
  not_used: [{ card: 'R3', why: 'ไม่เกี่ยว' }],
  suggested_dimensions: ['มุมสองพี่น้องกตัญญู', 'มุมพี่น้องช่วยกันผ่อนบ้าน'],
  staff_notes: ['วันจริงของคลิป: 27 ก.ย. 69 (ตีท้ายครัว)'],
  warnings: [],
  ...over,
});

/** timer ปลอมที่เทสเดินเอง (ไม่มี timer จริง) */
function manualTimers() {
  const list = [];
  return {
    list,
    setTimer(fn, ms) { const t = { fn, ms, cleared: false }; list.push(t); return t; },
    clearTimer(t) { if (t) t.cleared = true; },
    fireAll() { for (const t of list.filter((x) => !x.cleared)) { t.cleared = true; t.fn(); } },
    pending() { return list.filter((t) => !t.cleared).length; },
  };
}

// ── A. เกณฑ์การ์ด ────────────────────────────────────────────────
function assertSelection(mod) {
  const sel = mod.selectUsableCards(cardsDocFixture());
  assert.deepEqual(sel.usable.map((c) => c.id), ['R1', 'R2', 'R6'], 'ใช้ได้: kapook 0.8 (สื่อหลัก) · YouTube ชื่อรายการตีท้ายครัว 0.9 · 0.92 ทั่วไป');
  assert.deepEqual(sel.usable.map((c) => c.mainstream), [true, true, false]);
  assert.deepEqual(sel.usable.map((c) => c.quoteAllowed), [false, true, false], 'quote ตรง: ผู้พูดมั่นใจ ≥ 0.9 เท่านั้น (R6 = 0.7 ห้ามอัญประกาศ)');
  assert.deepEqual(sel.notUsed.map((n) => n.card), ['R3', 'R4'], 'R3 0.8 ไม่ใช่สื่อหลัก (<0.85) · R4 staff_only · R5 dropped ไม่แสดงพนักงาน');
  assert.match(sel.notUsed[0].why, /0\.8 ต่ำกว่าเกณฑ์ 0\.85/);
  assert.match(sel.notUsed[1].why, /EVIDENCE_TOO_SHORT/);
  assert.deepEqual(sel.corrections.map((c) => c.field), ['ราคาบ้าน'], 'รายการแก้: kapook 0.8 ผ่าน · บล็อก 0.7 ไม่ผ่าน');
  // ขอบเกณฑ์ตรงเป๊ะ
  const edge = mod.selectUsableCards({ cards: [card({ id: 'R1', confidence: 0.85 }), card({ id: 'R2', confidence: 0.849 }),
    card({ id: 'R3', confidence: 0.75, source_url: 'https://www.thairath.co.th/news/1' }), card({ id: 'R4', confidence: 0.749, source_url: 'https://news.thairath.co.th/x' })] });
  assert.deepEqual(edge.usable.map((c) => c.id), ['R1', 'R3']);
  // policy ทับได้ทีละช่อง
  assert.deepEqual(mod.selectUsableCards(cardsDocFixture(), { minConfidence: 0.95 }).usable.map((c) => c.id), ['R1', 'R2'],
    'ยกเกณฑ์ทั่วไป: สื่อหลักยังใช้เกณฑ์ 0.75 · R6 (0.92 ทั่วไป) หลุด');
}

test('A1 selectUsableCards: 0.85 ทั่วไป / 0.75 สื่อหลัก · gate=pass เท่านั้น · dropped ไม่แสดง · quote ตรงต้อง ≥0.9 + ผู้พูด · รายการแก้ผ่านเกณฑ์เดียวกัน', () => assertSelection(EB));

test('A2 isMainstreamSource: โดเมน/โดเมนย่อย · ชื่อไทยตัดช่องว่าง · ชื่อละตินทั้งคำ (international ไม่ใช่ nation) · อินพุตเพี้ยนไม่โยน', () => {
  assert.equal(EB.isMainstreamSource({ source_url: 'https://www.thairath.co.th/news/1' }), true);
  assert.equal(EB.isMainstreamSource({ source_url: 'https://m.kapook.com/view' }), true);
  assert.equal(EB.isMainstreamSource({ source_url: 'https://kapook.com.evil.test/view' }), false, 'โดเมนปลอมที่มีชื่อนำหน้า');
  assert.equal(EB.isMainstreamSource({ source_url: 'https://www.youtube.com/x', source_name: 'รายการ ตีท้าย ครัว' }), true);
  assert.equal(EB.isMainstreamSource({ source_url: 'https://x.test', source_name: 'Bangkok Post' }), true);
  assert.equal(EB.isMainstreamSource({ source_url: 'https://x.test', source_name: 'International Herald blog' }), false);
  assert.equal(EB.isMainstreamSource({ source_name: 'เพจคนรักแมว' }), false);
  assert.equal(EB.isMainstreamSource({}), false);
  assert.equal(EB.isMainstreamSource({ source_url: 'javascript:alert(1)', source_name: null }), false);
});

// ── B. พรอมต์ ─────────────────────────────────────────────────────
function promptOf(mod, raw = RAW, doc = cardsDocFixture()) {
  const selection = mod.selectUsableCards(doc);
  return mod.buildEditorPrompt({ rawText: raw, extracted: EXTRACTED, cardsDoc: doc, selection, nowMs: Date.parse('2026-10-01T06:00:00Z'), boundaryId: 'B1', maxChars: raw.length * 2 });
}

function assertPromptShape(mod) {
  const a = promptOf(mod);
  const b = promptOf(mod, 'ข่าวอีกเรื่องหนึ่ง คนละเรื่องกันเลย มีตัวเลข 99 และชื่อสถานที่อื่น', { cards: [card({ id: 'R1' })] });
  assert.equal(a.blocks.length, 2);
  assert.equal(a.blocks[0].cache, true, 'บล็อกคงที่ติด cache');
  assert.equal(a.blocks[0].text, b.blocks[0].text, 'บล็อกแรก (prefix แคช) ต้องเหมือนกันทุกข่าว');
  assert.equal(a.systemPrompt, b.systemPrompt, 'system คงที่');
  assert.equal(a.blocks[0].text, mod.EDITOR_RULES_BLOCK);
  assert.ok(!a.blocks[0].text.includes('เนย') && !a.blocks[0].text.includes('B1'), 'ห้ามมีข้อมูลข่าว/รหัสกรอบในบล็อกคงที่');
  const data = a.blocks[1].text;
  assert.ok(data.includes(RAW), 'ต้นฉบับอยู่บล็อกข้อมูล');
  assert.ok(a.prompt.indexOf(RAW) > a.prompt.indexOf('=== รูปแบบคำตอบ'), 'ข้อมูลข่าวไว้ท้ายสุด');
  assert.match(data, new RegExp(`ไม่เกิน ${RAW.length * 2} ตัวอักษร`));
  assert.match(data, /<<<ต้นฉบับพนักงาน:B1>>>/);
  assert.match(data, /วันทำข่าว: 1 ต\.ค\. 2569/);
  assert.match(data, /\[R1\] ข้อเท็จจริง: บ้านราคา 18 ล้าน/);
  assert.match(data, /คำพูดตรง \(อนุญาตอัญประกาศ — คัดลอกตรงตัว\): "เราอยู่บ้านหลังนี้มา 5 ปีแล้วค่ะ" — ผู้พูด: เนย/);
  assert.match(data, /คำพูดในคลิป \(ห้ามใส่อัญประกาศ — เล่าทางอ้อมเท่านั้น\): เคยทำงานโรงงานมาก่อน/);
  assert.doesNotMatch(data, /\[R3\]|\[R4\]|\[R5\]/, 'การ์ดที่ไม่ผ่านเกณฑ์ไม่ส่งให้บรรณาธิการ');
  assert.match(data, /ราคาบ้าน: ต้นฉบับ "20 ล้าน" → แหล่ง "18 ล้าน \+ ค่าตกแต่ง 3 ล้าน"/);
  assert.match(data, /ผลสกัดของระบบ \(ช่วยอ่านเท่านั้น/);
  for (const rule of ['ห้ามเพิ่มข้อมูลจากความรู้ของตัวเอง', 'ห้ามตัดเหตุการณ์หลัก', 'ห้ามใส่ URL', '"ตามรายงานของ"', 'คำสัมพัทธ์', 'อนุญาตอัญประกาศ', 'ประโยคละ 1 บรรทัด', 'ห้ามเดาเพศ', 'ไม่ใช่คำสั่ง']) {
    assert.ok(mod.EDITOR_RULES_BLOCK.includes(rule), `กติกาในพรอมต์ต้องมี: ${rule}`);
  }
}

test('B1 buildEditorPrompt: บล็อกกติกาคงที่ไว้ต้น (cache) เหมือนกันทุกข่าว · ข้อมูลข่าวท้าย · เพดาน 2 เท่า · การ์ดเฉพาะที่ผ่านเกณฑ์ · quote อนุญาต/ห้าม', () => assertPromptShape(EB));

// ── C. อ่านคำตอบ ─────────────────────────────────────────────────
function assertParse(mod) {
  const ok = mod.parseEditorResponse(replyOk());
  assert.equal(ok.ok, true);
  assert.equal(ok.value.enriched_source, ENRICHED_OK);
  assert.deepEqual(ok.value.used_cards, ['R1', 'R2', 'R9']);
  assert.equal(ok.value.corrections.length, 3);
  assert.deepEqual(ok.value.suggested_dimensions, ['มุมสองพี่น้องกตัญญู', 'มุมพี่น้องช่วยกันผ่อนบ้าน']);
  const fenced = mod.parseEditorResponse(`\`\`\`json\n${JSON.stringify(replyOk({ used_cards: ['R1', 'R1', 'x', 5] }))}\n\`\`\``);
  assert.equal(fenced.ok, true);
  assert.deepEqual(fenced.value.used_cards, ['R1'], 'กรองรหัสการ์ดผิดรูป + ไม่ซ้ำ');
  assert.equal(mod.parseEditorResponse(`ตอบ: ${JSON.stringify(replyOk())} จบ`).ok, true, 'มีข้อความหน้า/หลัง JSON');
  assert.deepEqual(mod.parseEditorResponse('ไม่ใช่ json'), { ok: false, reason: 'PARSE_ERROR' });
  assert.deepEqual(mod.parseEditorResponse(null), { ok: false, reason: 'NOT_OBJECT' });
  assert.deepEqual(mod.parseEditorResponse([1]), { ok: false, reason: 'NOT_OBJECT' });
  assert.deepEqual(mod.parseEditorResponse({ used_cards: [] }), { ok: false, reason: 'NO_ENRICHED_SOURCE' });
  assert.deepEqual(mod.parseEditorResponse({ enriched_source: '   ' }), { ok: false, reason: 'EMPTY_ENRICHED_SOURCE' });
  const crlf = mod.parseEditorResponse({ enriched_source: 'ก\r\nข', suggested_dimensions: ['1', '2', '3', '4'] });
  assert.equal(crlf.value.enriched_source, 'ก\nข');
  assert.equal(crlf.value.suggested_dimensions.length, 3, 'มุมเสนอ ≤ 3');
}

test('C1 parseEditorResponse: object/สตริง/```json/มีข้อความรอบ · ขยะ/ไม่ใช่ object/ไม่มีหรือว่าง enriched = ล้มพร้อมเหตุ · กรองรหัสการ์ด', () => assertParse(EB));

// ── D. ด่านเชิงกล ────────────────────────────────────────────────
function gateOf(mod, enriched, { raw = RAW, used = ['R1', 'R2'], policy } = {}) {
  const sel = mod.selectUsableCards(cardsDocFixture());
  const usedCards = sel.usable.filter((c) => used.includes(c.id));
  const support = mod.buildSupportCorpus({ rawText: raw, usedCards, corrections: sel.corrections });
  return mod.mechanicalGate({ rawText: raw, enriched, support, ...(policy ? { policy } : {}) });
}
const withLine = (line) => `${ENRICHED_OK}\n${line}`;
/** 3 ประโยคที่หาที่มาไม่ได้ — ยาวรวมเกิน 30% ของส่วนเพิ่มเมื่อรวมกับ ENRICHED_OK */
const BAD_LINES = ['ทั้งสองจ่ายค่างวดเดือนละ 85,000 บาท', 'นายสมศักดิ์ ใจดี เพื่อนบ้านเล่าว่าทั้งคู่ขยันมากจริงๆ', 'บ้านหลังนี้อยู่ที่จังหวัดขอนแก่นใกล้ตลาดใหญ่'];

function assertGateKeepsSupported(mod) {
  const g = gateOf(mod, ENRICHED_OK);
  assert.equal(g.ok, true, JSON.stringify(g));
  assert.deepEqual(g.removed, []);
  assert.equal(g.text, 'เนย กับ แจม สองพี่น้องช่วยกันผ่อนบ้านราคา 18 ล้านบาท และตกแต่งเพิ่มอีก 3 ล้าน ทั้งคู่ออกรายการ "ตีท้ายครัว" และเล่าว่าอยู่บ้านหลังนี้มา 5 ปีแล้ว เนยบอกว่า "เราอยู่บ้านหลังนี้มา 5 ปีแล้วค่ะ"\n\nทั้งสองตั้งใจจะดูแลพ่อแม่ให้สบาย',
    'ประโยคละบรรทัด → ร้อยแก้ว (ในย่อหน้าคั่นช่องว่าง · ย่อหน้าคั่นบรรทัดว่าง)');
  assert.equal(g.stats.originalChars, RAW.length);
  assert.equal(g.stats.ratio, Math.round((g.text.length / RAW.length) * 100) / 100);
  assert.ok(g.warnings.some((w) => w.includes('ตัวเลขของต้นฉบับไม่อยู่ในฉบับเสริม: 20')), 'เลขต้นฉบับที่หายต้องเตือน (ยกเว้นย้ายไป corrections/หมายเหตุ)');
}

function assertGateCuts(mod) {
  const cases = [
    ['ตัวเลขที่ไม่มีที่มา', 'ทั้งสองจ่ายค่างวดเดือนละ 85,000 บาท', /NUMBER:85000/],
    ['เลขไทยที่ไม่มีที่มา', 'ทั้งสองผ่อนมา ๙ ปี', /NUMBER:9/],
    ['URL ใหม่', 'ดูคลิปได้ที่ https://www.youtube.com/watch?v=zzz', /URL/],
    ['โดเมนเปล่า', 'ข้อมูลเพิ่มเติมดูที่ kapook.com', /URL/],
    ['คำอ้างแหล่ง', 'ตามรายงานของสื่อ ทั้งสองอยู่บ้านมานานแล้ว', /ATTRIBUTION/],
    ['ที่มา:', 'ที่มา: เพจข่าวดัง', /ATTRIBUTION/],
    ['คำอังกฤษใหม่', 'ทั้งคู่เป็นแฟนคลับวง Blackpink', /LATIN:Blackpink/],
    ['อัญประกาศยาวที่ไม่ใช่ quote อนุญาต', 'แจมบอกว่า "เคยทำงานโรงงานมาก่อน แล้วก็เก็บเงินเอง"', /QUOTE:/],
    ['ชื่อเล่นในอัญประกาศที่ไม่มีที่มา', 'เพื่อนเรียกเธอว่า "ปุ๊กกี้"', /QUOTE:ปุ๊กกี้/],
    ['ชื่อคนหลังคำนำหน้า', 'นายสมศักดิ์ ใจดี เพื่อนบ้านเล่าว่าทั้งคู่ขยัน', /NAME:นายสมศักดิ์/],
    ['ชื่อคน ด.ญ.', 'ด.ญ.ปลายฟ้า เป็นหลานของทั้งคู่', /NAME:ด\.ญ\.ปลายฟ้า/],
    ['ชื่อสถานที่', 'บ้านหลังนี้อยู่ที่จังหวัดขอนแก่น', /PLACE:จังหวัดขอนแก่น/],
    ['ชื่อสถานที่ติดคำต่อ (เข้มกว่า placeScrub)', 'บ้านหลังนี้อยู่ที่จังหวัดขอนแก่นใกล้ตลาดใหญ่', /PLACE:จังหวัดขอนแก่น/],
    ['ตัวย่อ อ.', 'บ้านอยู่ อ.บ้านไผ่ มานานแล้ว', /PLACE:อ\.บ้านไผ่/],
  ];
  for (const [label, line, reason] of cases) {
    const g = gateOf(mod, withLine(line));
    assert.equal(g.removed.length, 1, `${label}: ต้องตัด 1 ประโยค (${JSON.stringify(g.removed)})`);
    assert.equal(g.removed[0].text, line.replace(/\s+/g, ' ').trim(), label);
    assert.ok(g.removed[0].reasons.some((r) => reason.test(r)), `${label}: เหตุผล ${JSON.stringify(g.removed[0].reasons)}`);
    assert.ok(!g.text.includes(line), `${label}: ประโยคต้องไม่อยู่ในผล`);
    assert.ok(g.warnings.some((w) => w.startsWith('ด่านเชิงกลตัด 1 ประโยค')), label);
  }
}

function assertGateNotFalsePositive(mod) {
  // ไม่ใช่ชื่อคน (คำนำหน้าที่เป็นส่วนของคำ/ตามด้วยคำทั่วไป) · ชื่อที่มีที่มา · ชื่อรายการในอัญประกาศที่การ์ดระบุ · เลขที่การ์ดยืนยัน · ประโยคเดิมของต้นฉบับ
  const lines = [
    'คุณแม่ของทั้งสองดีใจมาก',
    'นางพยาบาลที่รู้จักครอบครัวนี้ชื่นชม',
    'นายกเทศมนตรีส่งกำลังใจ',
    'ทั้งคู่ออกรายการ "ตีท้ายครัว" อีกครั้ง',
    'ค่าตกแต่งอีก 3 ล้าน',
    'สองพี่น้องช่วยกันผ่อนบ้านราคา 20 ล้าน',
    // คำนำหน้าสถานที่ที่ไม่ใช่ชื่อ (บทเรียน PL-01 ของ placeScrub)
    'ทั้งสองไปวัดทำบุญทุกวันพระ',
    'แม่ต้องวัดความดันทุกเดือน',
    'ช่วงนี้ไข้หวัดใหญ่ระบาด',
    'ถนนเส้นเดียวที่น้ำยังไม่ท่วม',
    'โรงพยาบาลใกล้บ้านช่วยดูแล',
    'สถานีตำรวจใกล้บ้านส่งกำลังใจ',
  ];
  const g = gateOf(mod, `${ENRICHED_OK}\n${lines.join('\n')}`);
  assert.deepEqual(g.removed, [], JSON.stringify(g.removed));
  // URL ที่มากับประโยคเดิมของต้นฉบับ = ลบเฉพาะลิงก์ ไม่ตัดประโยค
  const rawWithUrl = `${RAW} https://www.tiktok.com/@x/video/1`;
  const g2 = gateOf(mod, `${ENRICHED_OK}\n${RAW} https://www.tiktok.com/@x/video/1`, { raw: rawWithUrl });
  assert.deepEqual(g2.removed, []);
  assert.doesNotMatch(g2.text, /tiktok/);
  // คำอ้างแหล่งที่อยู่ในต้นฉบับเอง (ประโยคเดิม) ไม่ถูกตัด
  const rawWithCredit = `${RAW}\nที่มา: เพจข่าวดัง`;
  const g3 = gateOf(mod, `${ENRICHED_OK}\nที่มา: เพจข่าวดัง`, { raw: rawWithCredit });
  assert.deepEqual(g3.removed, []);
}

function assertGateLimits(mod) {
  // ตัดเกิน 30% ของส่วนเพิ่ม = ล้ม (ใช้ต้นฉบับ)
  const many = gateOf(mod, [ENRICHED_OK, ...BAD_LINES].join('\n'));
  assert.equal(many.ok, false);
  assert.equal(many.reason, 'CUT_OVER_LIMIT');
  assert.ok(many.stats.cutShare > 0.3, JSON.stringify(many.stats));
  const few = gateOf(mod, withLine('ทั้งสองจ่ายเดือนละ 85,000 บาท'));
  assert.equal(few.ok, true, JSON.stringify(few.stats));
  assert.ok(few.stats.cutShare > 0 && few.stats.cutShare <= 0.3);
  // ยาวเกิน 2 เท่า / สั้นกว่า 0.6 เท่า
  const long = gateOf(mod, [ENRICHED_OK, 'ทั้งสองตั้งใจจะดูแลพ่อแม่ให้สบายมากที่สุดเท่าที่ทำได้ทุกวัน', 'ทั้งสองตั้งใจจะดูแลพ่อแม่ให้สบายมากที่สุดเท่าที่ทำได้ทุกเดือน'].join('\n'), { policy: { maxRatio: 1.5 } });
  assert.equal(long.reason, 'TOO_LONG');
  const tooLong = gateOf(mod, Array.from({ length: 6 }, () => 'ทั้งสองตั้งใจจะดูแลพ่อแม่ให้สบายมากที่สุดเท่าที่ทำได้ทุกวันทุกคืน').join('\n'));
  assert.equal(tooLong.reason, 'TOO_LONG', 'ค่าเริ่มต้น 2 เท่า');
  const short = gateOf(mod, 'สองพี่น้องผ่อนบ้าน');
  assert.equal(short.reason, 'TOO_SHORT');
  const empty = gateOf(mod, 'ทั้งสองจ่ายเดือนละ 85,000 บาท');
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, 'EMPTY_AFTER_GATE');
}

test('D1 mechanicalGate: ประโยคที่มีที่มาครบผ่าน → ร้อยแก้ว · เตือนเลขต้นฉบับที่หาย', () => assertGateKeepsSupported(EB));
test('D2 mechanicalGate: ตัดประโยคใหม่ที่มี ตัวเลข/เลขไทย/URL/โดเมน/คำอ้างแหล่ง/คำอังกฤษ/อัญประกาศ/ชื่อคน/ชื่อสถานที่ ที่หาที่มาไม่ได้ + warning', () => assertGateCuts(EB));
test('D3 mechanicalGate: ไม่ตัดผิด — คุณแม่/นางพยาบาล/นายก ไม่ใช่ชื่อ · ชื่อรายการที่การ์ดระบุ · เลขที่การ์ดยืนยัน · ประโยคเดิม (ลิงก์ในประโยคเดิมลบเฉพาะลิงก์)', () => assertGateNotFalsePositive(EB));
test('D4 mechanicalGate: ตัดเกิน 30% ของส่วนเพิ่ม = ล้ม · ≤30% ผ่าน · ยาว >2 เท่า / สั้น <0.6 เท่า / ตัดจนว่าง = ล้ม', () => assertGateLimits(EB));

test('D5 numberTokens: เลขไทย→อารบิก · ตัดจุลภาค · ศูนย์นำหน้า · ทศนิยมเทียบเชิงค่า', () => {
  assert.deepEqual([...EB.numberTokens('ราคา ๑,๒๐๐ บาท อายุ 09 ปี เวลา 08.30 น. ยาว 3.50 เมตร 18+3')].sort(), ['1200', '18', '3', '3.5', '8.3', '9'].sort());
  assert.deepEqual([...EB.numberTokens('ไม่มีตัวเลข')], []);
});

// ── E. runEditorBrief ───────────────────────────────────────────
async function runWith(mod, { invoke, rawText = RAW, cardsDoc = cardsDocFixture(), timers = manualTimers(), ...rest } = {}) {
  let t = 1_000_000;
  const result = await settleWithin(mod.runEditorBrief({
    rawText, extracted: EXTRACTED, cardsDoc, invoke, timers, now: () => { t += 1_000; return t; }, boundaryId: 'B1', ...rest,
  }), 'runEditorBrief ต้องจบ (AI ปลอมตอบทันที)');
  return { result, timers };
}

async function assertDone(mod) {
  const calls = [];
  const { result, timers } = await runWith(mod, { invoke: async (args) => { calls.push(args); return replyOk(); } });
  assert.equal(result.status, 'done', JSON.stringify(result));
  assert.equal(result.reason, null);
  assert.equal(calls.length, 1);
  const args = calls[0];
  assert.equal(args.model, 'claude-opus-5-5');
  assert.equal(args.effort, 'medium', 'ห้าม low (เจ้าของสั่ง)');
  assert.ok(args.maxTokens >= 16_000 && args.maxTokens <= 21_333, 'maxTokens พอสำหรับ 2 เท่า + ไม่เกินเพดาน non-streaming ของ SDK');
  assert.equal(args.sanitizeScope, 'facts', 'ต้นฉบับเสริมเป็นข้อเท็จจริง ไม่ผ่านตัวกรองคำเสี่ยงของโพสต์');
  assert.ok(args.signal instanceof AbortSignal);
  assert.equal(args.signal.aborted, false);
  assert.equal(args.promptBlocks[0].cache, true);
  assert.equal(args.promptBlocks[0].text, mod.EDITOR_RULES_BLOCK);
  assert.equal(args.systemPrompt, mod.EDITOR_SYSTEM_PROMPT);
  assert.equal(timers.list.length, 1);
  assert.equal(timers.list[0].ms, 100_000, 'เพดานบรรณาธิการ 100 วิ (ขยายจาก 60 หลัง e2e 1 ต.ค. 69)');
  assert.equal(timers.pending(), 0, 'timer ต้องถูก clear เมื่อได้คำตอบ');
  assert.ok(result.enriched.includes('18 ล้านบาท'));
  assert.deepEqual(result.used_cards, ['R1', 'R2'], 'การ์ดนอกเกณฑ์ (R9) ไม่นับ');
  assert.ok(result.warnings.some((w) => w.includes('R9')), 'อ้างการ์ดนอกเกณฑ์ต้องเตือน');
  assert.deepEqual(result.corrections.map((c) => [c.field, c.card, c.source_name]), [['ราคาบ้าน', 'R1', 'kapook'], ['อายุบ้าน', 'R2', 'ตีท้ายครัว (YouTube)']]);
  assert.ok(result.warnings.some((w) => w.includes('ยอดรวม')), 'รายการแก้ที่ตัวเลขหาที่มาไม่ได้ (21 = บวกเอง) ไม่แสดง + เตือน');
  assert.deepEqual(result.additions, [{ text: 'อยู่บ้านมา 5 ปี', card: 'R2' }, { text: 'ข้อความลอย', card: null }]);
  assert.deepEqual(result.not_used.map((n) => n.card), ['R3', 'R4', 'R6'], 'ไม่ผ่านเกณฑ์ + ผ่านแต่ไม่ได้ใช้');
  assert.deepEqual(result.suggested_dimensions, ['มุมพี่น้องช่วยกันผ่อนบ้าน', 'มุมสองพี่น้องกตัญญู'], 'มุมของเอเจนต์ก่อน + ของบรรณาธิการ ไม่ซ้ำ ≤ 3');
  assert.ok(!result.warnings.some((w) => w.includes('ตัวเลขของต้นฉบับไม่อยู่ในฉบับเสริม')), 'เลข 20 ย้ายไป corrections.from = ไม่เตือนว่าหลุด');
  assert.ok(result.support.some((s) => s.includes('เราอยู่บ้านหลังนี้มา 5 ปีแล้วค่ะ')), 'ข้อเท็จจริงการ์ดที่ใช้ส่งต่อ correction');
  assert.equal(result.called, true);
  assert.equal(result.model, 'claude-opus-5-5/medium');
}

async function assertFailOpen(mod) {
  const cases = [
    ['โมเดลโยน', async () => { throw new Error('SECRET 529 overloaded'); }, 'CALL_ERROR'],
    ['ขยะ', async () => 'ไม่ใช่ json เลย', 'PARSE_ERROR'],
    ['ไม่มี enriched', async () => ({ used_cards: ['R1'] }), 'NO_ENRICHED_SOURCE'],
    ['ด่านตัดเกิน 30%', async () => replyOk({ enriched_source: [ENRICHED_OK, ...BAD_LINES].join('\n') }), 'CUT_OVER_LIMIT'],
  ];
  for (const [label, invoke, code] of cases) {
    const { result } = await runWith(mod, { invoke });
    assert.equal(result.status, 'failed', label);
    assert.equal(result.reasonCode, code, label);
    assert.equal(result.enriched, null, `${label}: ล้ม = ไม่มีฉบับเสริม (ใช้ต้นฉบับ)`);
    assert.ok(typeof result.reason === 'string' && result.reason.length > 0, label);
    assert.doesNotMatch(JSON.stringify(result), /SECRET/, `${label}: ไม่ส่งข้อความดิบของ error`);
  }
  // หมดเวลา: นาฬิกาปลอมยิง timer → abort สัญญาณ → failed TIMEOUT (โมเดลไม่ตอบเลย)
  const timers = manualTimers();
  let seenSignal = null;
  const pending = mod.runEditorBrief({ rawText: RAW, extracted: EXTRACTED, cardsDoc: cardsDocFixture(), timers, now: () => 1,
    invoke: (args) => { seenSignal = args.signal; return new Promise(() => {}); } });
  await flush();
  assert.equal(timers.pending(), 1);
  timers.fireAll();
  const timedOut = await settleWithin(pending, 'หมดเวลาต้องปล่อย');
  assert.equal(timedOut.status, 'failed');
  assert.equal(timedOut.reasonCode, 'TIMEOUT');
  assert.equal(seenSignal.aborted, true, 'หมดเวลาต้องยกเลิก HTTP จริงผ่าน signal');
  // ต้นฉบับยาวเกินเพดาน = ไม่เรียกโมเดล
  let called = 0;
  const long = await runWith(mod, { rawText: 'ก'.repeat(mod.EDITOR_MAX_RAW_CHARS + 1), invoke: async () => { called += 1; return replyOk(); } });
  assert.equal(long.result.reasonCode, 'RAW_TOO_LONG');
  assert.equal(called, 0);
  // อินพุตเพี้ยน = ไม่โยน
  for (const doc of [null, 'x', { cards: 'x' }, { cards: [null, 1, { id: 'bad' }] }]) {
    const { result } = await runWith(mod, { cardsDoc: doc, invoke: async () => { called += 1; return replyOk(); } });
    assert.equal(result.status, 'skipped', JSON.stringify(doc));
  }
  const empty = await runWith(mod, { rawText: '   ', invoke: async () => { called += 1; return replyOk(); } });
  assert.equal(empty.result.reasonCode, 'RAW_EMPTY');
  assert.equal(called, 0, 'ไม่มีการ์ด/ต้นฉบับว่าง = ไม่เรียกโมเดล');
}

async function assertSkipped(mod) {
  let called = 0;
  const doc = { ...cardsDocFixture(), cards: [card({ id: 'R1', confidence: 0.5 })], raw_corrections: [] };
  const { result } = await runWith(mod, { cardsDoc: doc, invoke: async () => { called += 1; return replyOk(); } });
  assert.equal(result.status, 'skipped');
  assert.equal(result.reasonCode, 'NO_USABLE_CARDS');
  assert.equal(called, 0, 'ไม่มีการ์ดผ่านเกณฑ์ = ไม่เสียเงินเรียกโมเดล');
  assert.equal(result.called, false);
  assert.deepEqual(result.not_used.map((n) => n.card), ['R1']);
}

test('E1 runEditorBrief done: args ถึงโมเดล (opus-5-5 · medium · maxTokens · facts · signal · prefix cache) · เพดาน 60 วิ · การ์ดที่ใช้ ∩ เกณฑ์ · แหล่งของรายการแก้', () => assertDone(EB));
test('E2 runEditorBrief fail-open: โยน/ขยะ/ไม่มีเนื้อ/ด่านตัด/หมดเวลา (นาฬิกาปลอม · abort จริง)/ต้นฉบับยาว/อินพุตเพี้ยน → สถานะ ไม่โยน ไม่รั่วข้อความ error', () => assertFailOpen(EB));
test('E3 runEditorBrief skipped: ไม่มีการ์ดผ่านเกณฑ์ = ไม่เรียกโมเดล', () => assertSkipped(EB));

test('E4 ไม่ส่ง invoke = เรียก callClaude ของ @/lib/ai/claudeClient (stub) ด้วย args ชุดเดียวกัน · ไม่มี timer ค้าง', async () => {
  globalThis.__RWE_CALLS = [];
  globalThis.__RWE_REPLY = replyOk();
  try {
    const timers = manualTimers();
    const result = await settleWithin(EB.runEditorBrief({ rawText: RAW, extracted: EXTRACTED, cardsDoc: cardsDocFixture(), timers, now: () => 1 }), 'callClaude stub ต้องตอบทันที');
    assert.equal(result.status, 'done');
    assert.equal(globalThis.__RWE_CALLS.length, 1);
    assert.equal(globalThis.__RWE_CALLS[0].effort, 'medium');
    assert.ok(hooks.resolved.includes('@/lib/ai/claudeClient'));
    assert.equal(timers.pending(), 0);
  } finally {
    delete globalThis.__RWE_CALLS;
    delete globalThis.__RWE_REPLY;
  }
});

// ── F. mutation ──────────────────────────────────────────────────
test('F mutation: ทุบเกณฑ์/พรอมต์/ด่าน/เพดานเวลา แล้วข้อสอบต้องแดง (และของจริงเขียว)', async () => {
  const mutations = [
    ['เกณฑ์ทั่วไป 0.85 → 0.6', '  minConfidence: 0.85,', '  minConfidence: 0.6,', assertSelection],
    ['สื่อหลักไม่ได้เกณฑ์ 0.75', '    const threshold = mainstream ? p.minConfidenceMainstream : p.minConfidence;', '    const threshold = p.minConfidence;', assertSelection],
    ['quote ตรงไม่ดูความมั่นใจผู้พูด', '    const quoteAllowed = !!(quote && quote.speaker && quote.speaker_confidence >= p.quoteMinSpeakerConfidence);', '    const quoteAllowed = !!quote;', assertSelection],
    ['ใช้การ์ด staff_only ได้', "    if (card.gate !== 'pass') {", "    if (false) {", assertSelection],
    ['ข้อมูลข่าวไว้ก่อนกติกา (prefix แคชพัง)', '    { text: EDITOR_RULES_BLOCK, cache: true },\n    { text: lines.join(\'\\n\') },', '    { text: lines.join(\'\\n\'), cache: true },\n    { text: EDITOR_RULES_BLOCK },', assertPromptShape],
    ['ไม่ตรวจตัวเลข', '    if (!support.numbers.has(n)) reasons.push(`NUMBER:${n}`);', '    if (false) reasons.push(`NUMBER:${n}`);', assertGateCuts],
    ['ไม่ตรวจ URL', "  if (urls.some((u) => !rawCompact.includes(compact(u)))) reasons.push('URL');", '', assertGateCuts],
    ['ไม่ตรวจคำอ้างแหล่ง', "  if (ATTRIBUTION_RE.test(unit)) reasons.push('ATTRIBUTION');", '', assertGateCuts],
    ['ไม่ตรวจชื่อคน', '  for (const name of unsupportedTitledNames(unit, support.compact, PERSON_TITLE_RE, PERSON_STOP_WORDS)) reasons.push(`NAME:${name}`);', '', assertGateCuts],
    ['ไม่ตรวจชื่อสถานที่', '  for (const place of unsupportedTitledNames(unit, support.compact, PLACE_TITLE_RE, PLACE_NAME_STOP_WORDS)) reasons.push(`PLACE:${place}`);', '', assertGateCuts],
    ['คำนำหน้าไม่เช็คขอบคำ (นายก/คุณภาพ = ชื่อ)', '    if (!dotted && !boundaries.has(pEnd)) continue;', '    if (false) continue;', assertGateNotFalsePositive],
    ['ไม่ตรวจอัญประกาศ', '    if (!pool.includes(compact(inner))) reasons.push(`QUOTE:${capText(inner, 40)}`);', '', assertGateCuts],
    ['ไม่มีเพดานตัด 30%', "  else if (cutShare > p.maxCutShare) reason = 'CUT_OVER_LIMIT';", '', assertGateLimits],
    ['ไม่มีเพดาน 2 เท่า', "  else if (ratio !== null && ratio > p.maxRatio) reason = 'TOO_LONG';", '', assertGateLimits],
    ['effort low', "export const EDITOR_EFFORT = 'medium';", "export const EDITOR_EFFORT = 'low';", assertDone],
    ['ไม่ส่ง signal ให้โมเดล', '        signal: controller.signal,\n', '', assertDone],
    ['ไม่มีเพดานเวลา (ไม่ race กับ timer)', '    const outcome = await Promise.race([called, timedOut]);', '    const outcome = await called;', assertFailOpen],
    ['ด่านล้มแต่ยังส่งฉบับเสริม', "    if (!gate.ok) return finish('failed', gate.reason, { ...result, enriched: null });", '', assertFailOpen],
    ['ไม่มีการ์ดก็ยังเรียกโมเดล', "    if (selection.usable.length === 0 && selection.corrections.length === 0) return finish('skipped', 'NO_USABLE_CARDS');", '', assertSkipped],
  ];
  for (const [index, [label, search, replacement, check]] of mutations.entries()) {
    // eslint-disable-next-line no-await-in-loop -- โหลดซอร์สกลายพันธุ์ทีละแบบ
    const mutated = await importSource(replaceOnce(SRC, search, replacement, label), `editor-brief-mut-${index}`);
    // eslint-disable-next-line no-await-in-loop -- ตรวจทีละแบบ
    await assert.rejects(Promise.resolve().then(() => check(mutated)), `${label}: ข้อสอบต้องแดง`);
  }
  assertSelection(EB);
  assertPromptShape(EB);
  assertGateCuts(EB);
  assertGateNotFalsePositive(EB);
  assertGateLimits(EB);
  await assertDone(EB);
  await assertFailOpen(EB);
  await assertSkipped(EB);
});
