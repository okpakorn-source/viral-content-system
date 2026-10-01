// ============================================================
// 🧪 tests/research-encoding-check.test.mjs — กันไฟล์ผลเอเจนต์เข้ารหัสผิด (ภาษาไทยกลายเป็น ?) · SPEC-v3 ส่วน 10 · W4
// ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 10 · W4)
// fixture จริง (คัดลอกไบต์ต่อไบต์จาก out/result.json ในโฟลเดอร์งานของ worker · batch 8 ข่าว 1 ต.ค. 69 20:30):
//   encoding-broken-q_d764ba79bf9f9c4e-result.json (มาเบล) · encoding-broken-q_6c9c302018601b41-result.json (เข้ม)
//     = ไฟล์ที่ไทยทุกตัวเป็น ? (CRLF ไม่มี BOM) · claim ทุกใบตรงกับ cardsAfter.cards ของ e2e/results/write-q_*.json (ยึดไว้ข้อ W4-0)
//   encoding-good-q_65e6a2c12e0d37e7-result.json = งาน batch เดียวกันที่ไทยครบ · lab-out(2)-result.json = รูปแล็บเก่า (ไทยครบ)
// ตรวจ: กฎกลาง encodingCheck (ทั้งผล/ช่องเดียว/ขอบเขต) · check-result.mjs โปรเซสจริงทั้ง junction และโหมดสำเนา (prepareWorkdir ตัวจริง) ·
//   codexRunner.readAgentResult/runCodex (fake-codex โปรเซสจริง) ติด encoding · gate: การ์ดเสียรายใบ dropped ENCODING_BROKEN / quote เสียถูกตัด /
//   ผลไทยปกติ = gate ฉบับถอดบรรทัด W4 ทุกไบต์ · taskBuilder: ย่อหน้า apply_patch + check-result ในช่วงท้าย prefix แคชเดิม (sha เฟส 1) ·
//   worker: เวลาพอ = รันซ้ำ 1 รอบในโฟลเดอร์เดิม (ย้ายไฟล์เสียก่อน) · ขอบ 6 นาทีพอดี · ไม่พอ/ยังเสีย/ไม่ได้ผล/สมอง api = failed + ENCODING_BROKEN
//   การ์ดทุกใบ dropped · ไม่ยก medium · ผลปกติ = ระเบียนเท่ากับ worker ที่ปิดตัวตรวจ · ปลายทาง: ระเบียน → เอกสารฝั่งเว็บ (cardsSchema) → บัตรบอท
// กลายพันธุ์ 15 แบบ (patch ซอร์สจริงในโฟลเดอร์ชั่วคราว → ข้อตรวจชุดเดียวกันต้องแดง)
// ไม่ยิง Codex/API จริง (ตัวรันปลอม · fake-codex.mjs) · นาฬิกามือ/timer มือ (ไม่มี timer จริง ไม่ unref) · เขียนไฟล์ใต้ os.tmpdir() เท่านั้น ·
// ซอร์สที่ใช้กลายพันธุ์อ่านเป็น LF เสมอ (บทเรียน autocrlf 827336d7)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn as realSpawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { importPatchedModule } from './helpers/temp-module.mjs';
import { settleWithin } from './helpers/fake-deadline.mjs';
import * as enc from '../scripts/research-agent/encodingCheck.mjs';
import * as cr from '../scripts/research-agent/codexRunner.mjs';
import * as gate from '../scripts/research-agent/gate.mjs';
import * as tb from '../scripts/research-agent/taskBuilder.mjs';
import * as worker from '../scripts/research-agent-worker.mjs';
import * as checkTool from '../scripts/research-tools/check-result.mjs';
import { validateCardRecord, KNOWN_FLAGS, AGENT_FLAGS } from '../scripts/research-agent/schema.mjs';

const REAL_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TOOLS_DIR = join(REAL_ROOT, 'scripts', 'research-tools');
const FAKE_CODEX = fileURLToPath(new URL('./fixtures/research-agent/fake-codex.mjs', import.meta.url));
const { buildResearchCardsDoc, summarizeCardsDoc } = await import(pathToFileURL(join(REAL_ROOT, 'src', 'lib', 'research-agent', 'cardsSchema.js')).href);

// ── fixture ──────────────────────────────────────────────────────────────
const fixPath = (name) => fileURLToPath(new URL(`./fixtures/research-agent/${name}`, import.meta.url));
const readFix = (name) => JSON.parse(enc.decodeTextBuffer(readFileSync(fixPath(name))).text);
const BROKEN_D764 = 'encoding-broken-q_d764ba79bf9f9c4e-result.json';
const BROKEN_6C9C = 'encoding-broken-q_6c9c302018601b41-result.json';
const BROKEN_FILES = [BROKEN_D764, BROKEN_6C9C];
const GOOD_FILE = 'encoding-good-q_65e6a2c12e0d37e7-result.json';
const GOOD_FILES = [GOOD_FILE, 'lab-out-result.json', 'lab-out2-result.json'];
/** claim R1 ของระเบียนจริงใน research-cards (e2e/results/write-q_<id>.json → cardsAfter.cards · ด่านเดิมให้ gate=pass มั่นใจ 0.99/0.97) */
const ANCHOR_CLAIMS = Object.freeze({
  [BROKEN_D764]: '???????????????????????????? 3 ???? ??????????????????? 23 ???????? 2567',
  [BROKEN_6C9C]: '??????????????????????????????????? ??????????????? ????????????????? ?????????? ?????????????? ?????????????? 30 ??????? 2569',
});
const ENCODING_TEXT = '⚠️ ไฟล์ผลเอเจนต์เข้ารหัสผิด — รีเสิร์ชรอบนี้ใช้ไม่ได้'; // สเปกส่วน 10 ข้อ 3 ข (ข้อความบัตรพนักงานใบแรก)
const RETRY_PHRASE = '⚠️ รอบก่อนไฟล์ผลเข้ารหัสผิด (ไทยเป็น ?) — เขียน out/result.json ใหม่ด้วย apply_patch เท่านั้น และรัน check-result.mjs ก่อนจบ'; // สเปกข้อ 3 ก
const ARCHIVE_FILE = 'round-encoding-result.json';

// ── ซอร์สสำหรับกลายพันธุ์ (LF) ─────────────────────────────────────────────
function srcOf(rel) {
  const url = new URL(rel, import.meta.url);
  return { url, text: readFileSync(url, 'utf8').replace(/\r\n/g, '\n') };
}
const SRC = Object.freeze({
  enc: srcOf('../scripts/research-agent/encodingCheck.mjs'),
  gate: srcOf('../scripts/research-agent/gate.mjs'),
  tb: srcOf('../scripts/research-agent/taskBuilder.mjs'),
  cr: srcOf('../scripts/research-agent/codexRunner.mjs'),
  worker: srcOf('../scripts/research-agent-worker.mjs'),
  check: srcOf('../scripts/research-tools/check-result.mjs'),
  card: srcOf('../discord-bot/researchCard.js'),
});
/** แทนที่จุดเดียว (ต้องเจอครั้งเดียวพอดี — กันแทนคอมเมนต์ "ของเดิม" แทนโค้ดจริง) */
function patched(s, find, replace) {
  assert.equal(s.text.split(find).length, 2, `จุดกลายพันธุ์ต้องเจอครั้งเดียว: ${find.slice(0, 80)}`);
  return s.text.replace(find, () => replace);
}
async function mutantModule(s, find, replace, name) {
  const text = patched(s, find, replace).split('import.meta.url').join(JSON.stringify(s.url.href));
  return importPatchedModule(text, s.url, `ra-enc-${name}`);
}
const sha = (text) => createHash('sha256').update(text).digest('hex');
const isAscii = (s) => /^[\x00-\x7F]*$/u.test(String(s));
const withText = (text) => ({ plan: [{ question: text, why_valuable: '', decided: 'ค้น', reason: '' }], cards: [], tool_log: [], origin_post: { url: null } });
const THAI = (n) => 'ก'.repeat(n);
const Q = (n) => '?'.repeat(n);

// ============================================================
// 0) fixture จริง = ไฟล์เสียของจริง (ยึดกับระเบียนใน research-cards) · ด่านเดิมปล่อยการ์ด ? ผ่านจริง
// ============================================================
test('W4-0. fixture จริง: ไฟล์ผล 2 งานที่เสียไม่มีอักษรไทยเลย (CRLF ไม่มี BOM) · claim R1 ตรงระเบียน research-cards ที่บันทึกไว้ · ตัวเลข/URL ครบ', () => {
  for (const name of BROKEN_FILES) {
    const buf = readFileSync(fixPath(name));
    const text = buf.toString('utf8');
    assert.ok(!(buf[0] === 0xEF && buf[1] === 0xBB), `${name}: ไม่มี BOM (แบบไฟล์จริง)`);
    assert.ok(!/[\u{E00}-\u{E7F}]/u.test(text), `${name}: ไม่มีอักษรไทยสักตัว`);
    const json = JSON.parse(text);
    assert.ok(json.cards.some((c) => c.claim === ANCHOR_CLAIMS[name]), `${name}: claim R1 ตรงกับ cardsAfter ของ e2e`);
    assert.ok(json.cards.every((c) => /^https?:\/\//u.test(c.source_url)), `${name}: URL ครบ`);
  }
  assert.ok(readFileSync(fixPath(BROKEN_D764), 'utf8').includes('7,000'), 'ตัวเลขยังอยู่');
});

// ============================================================
// 1) กฎกลาง encodingCheck
// ============================================================
function checkRealFixtures(E) {
  for (const name of BROKEN_FILES) {
    const r = E.isEncodingBroken(readFix(name));
    assert.equal(r.broken, true, `${name}: ต้องจับได้`);
    assert.equal(r.reason, 'NO_THAI');
    assert.equal(r.thaiChars, 0);
    assert.ok(r.questionMarks > 2000, `${name}: ? ${r.questionMarks}`);
    assert.ok(r.ratio > 0.9, `${name}: สัดส่วน ${r.ratio}`);
    for (const f of ['plan[0].question', 'cards[0].claim', 'cards[0].evidence_quote']) assert.ok(r.badFields.includes(f), `${name}: ช่องเสีย ${f}`);
    assert.ok(r.badFieldCount >= 40);
  }
  for (const name of GOOD_FILES) {
    const r = E.isEncodingBroken(readFix(name));
    assert.equal(r.broken, false, `${name}: ไทยครบต้องผ่าน (${r.reason})`);
    assert.ok(r.thaiChars > 1000);
    assert.ok(r.ratio < 0.01, `${name}: สัดส่วน ${r.ratio}`);
    assert.equal(r.badFieldCount, 0);
  }
}

function checkBoundaries(E) {
  // ทั้งผล: อักษรเสีย > 5% (และ ≥ 5 ตัว) = เสีย · 5% พอดี = ผ่าน
  assert.equal(E.isEncodingBroken(withText(`${THAI(95)}${Q(5)}`)).broken, false, '5/100 = 5% พอดี = ผ่าน (กฎ "≤ 5%")');
  const six = E.isEncodingBroken(withText(`${THAI(94)}${Q(6)}`));
  assert.equal(six.broken, true, '6/100 = 6% = เสีย');
  assert.equal(six.reason, 'TOO_MANY_BAD_CHARS');
  assert.equal(E.isEncodingBroken(withText(`${THAI(10)}${Q(4)}`)).broken, false, 'อักษรเสีย 4 ตัว (< 5) ไม่ตัดสินด้วยสัดส่วน');
  assert.equal(E.isEncodingBroken(withText(`${THAI(10)}${Q(5)}`)).broken, true, 'อักษรเสีย 5 ตัว 33% = เสีย');
  // ไม่นับ URL/ตัวเลข/ช่องว่าง
  const url = E.isEncodingBroken(withText(`${THAI(20)} https://www.youtube.com/watch?v=S40g1p00Jw4?x=1 www.x.com/a?b=2?`));
  assert.equal(url.questionMarks, 0, '? ใน URL ไม่นับ');
  assert.equal(url.broken, false);
  const st = E.textEncodingStats('ก 1,000 ๑๒ ?');
  assert.deepEqual({ letters: st.letters, thai: st.thaiChars, q: st.questionMarks }, { letters: 3, thai: 1, q: 1 }, 'ไม่นับช่องว่าง/เลขอารบิก/เลขไทย');
  // อักษรเสียแบบอื่น: U+FFFD (ไบต์ไม่ใช่ UTF-8) · mojibake (UTF-8 ถูกอ่านเป็น ANSI)
  assert.equal(E.textEncodingStats('\u{FFFD}\u{FFFD}ก').bad, 2);
  const moji = Buffer.from('ความ', 'utf8').toString('latin1');
  assert.equal(E.textEncodingStats(moji).mojibake, 4);
  assert.equal(E.isEncodingBroken(withText(moji)).reason, 'NO_THAI');
  // ไม่ใช่ปัญหาเข้ารหัส: ไม่มีข้อความเลย · อังกฤษล้วนที่ไม่มีอักษรเสีย
  assert.equal(E.isEncodingBroken({ plan: [], cards: [], tool_log: [], origin_post: {} }).broken, false, 'ผลว่าง = ไม่เสีย');
  assert.equal(E.isEncodingBroken(withText('Origin post could not be found on the public web')).broken, false);
  // ชื่อแล็บเก่า (research_plan/fact_cards/evidence) ถูกนับ
  const legacy = E.isEncodingBroken({ research_plan: [{ q: Q(30) }], fact_cards: [{ claim: Q(40), evidence: Q(40) }], tool_log: [], origin_post: {} });
  assert.equal(legacy.broken, true);
  assert.ok(legacy.badFields.includes('fact_cards') || legacy.badFields.includes('cards[0].claim'));
  // ไม่โยน error กับข้อมูลประหลาด
  for (const v of [null, undefined, 1, 'x', [], { plan: 'x', cards: {} }]) assert.equal(E.isEncodingBroken(v).broken, false);
}

function checkNoThaiRule(E) {
  // ไฟล์เล็กที่เสียทั้งไฟล์: ? 4 ตัว (ไม่ถึงเกณฑ์สัดส่วน) แต่ไม่มีไทยเลย = เสีย (กฎสเปก "ไทย ≥ 1 ตัว")
  const r = E.isEncodingBroken(withText(Q(4)));
  assert.equal(r.broken, true, 'ไม่มีไทยเลย + มีอักษรเสีย = เสีย');
  assert.equal(r.reason, 'NO_THAI');
}

function checkFieldRule(E) {
  assert.equal(E.isFieldBroken(Q(3)), true, '??? = ช่องเสีย');
  assert.equal(E.isFieldBroken('?'), false, '? ตัวเดียว = เครื่องหมายไม่ทราบ ไม่ใช่เข้ารหัส');
  assert.equal(E.isFieldBroken('??'), false);
  assert.equal(E.isFieldBroken(`${Q(3)}ไทย`), true, '3/6 = 50% พอดี = เสีย (กฎ "≥ 50%")');
  assert.equal(E.isFieldBroken(`${Q(3)}ไทยไ`), false, '3/7 < 50% = ไม่เสีย');
  assert.equal(E.isFieldBroken('ราคา 1,000 บาท?'), false);
  assert.equal(E.isFieldBroken('https://www.youtube.com/watch?v=a?b?c?d'), false, 'URL ล้วนไม่นับ');
  assert.deepEqual(E.cardEncodingBroken({ claim: Q(20), evidence_quote: 'ประโยคหลักฐานภาษาไทยปกติ 1,000' }), { broken: true, fields: ['claim'] });
  assert.deepEqual(E.cardEncodingBroken({ claim: 'ข้อเท็จจริงไทยปกติ', evidence: Q(20) }), { broken: true, fields: ['evidence_quote'] }, 'รับชื่อแล็บเก่า evidence');
  assert.equal(E.cardEncodingBroken({ claim: 'ข้อเท็จจริงไทยปกติ', evidence_quote: 'หลักฐานไทยปกติยาวพอ', source_name: Q(8) }).broken, false, 'ป้ายแหล่งเสียอย่างเดียวไม่ทิ้งการ์ด');
  assert.equal(E.quoteEncodingBroken({ text: Q(12), speaker: 'x' }), true);
  assert.equal(E.quoteEncodingBroken({ text: 'คำพูดไทยปกติ', speaker: Q(5) }), false);
}

test('W4-1. กฎทั้งผล: ไฟล์เสียจริง 2 งาน = เสีย (NO_THAI · ? > 2,000 · สัดส่วน > 90%) · ไฟล์ดี 3 ไฟล์ = ผ่าน (สัดส่วน < 1%)', () => checkRealFixtures(enc));
test('W4-2. ขอบเขตกฎ: > 5% และ ≥ 5 ตัว · ไม่นับ URL/ตัวเลข/ช่องว่าง · U+FFFD/mojibake นับเป็นอักษรเสีย · ผลว่าง/อังกฤษล้วนไม่ใช่ปัญหาเข้ารหัส · ชื่อแล็บเก่า · ไม่โยน', () => {
  checkBoundaries(enc);
  checkNoThaiRule(enc);
});
test('W4-3. กฎช่องเดียว (≥ 50% และ ≥ 3 ตัว) · การ์ดตัดสินจาก claim/evidence_quote · quote.text', () => checkFieldRule(enc));

test('W4-4. dropCardsForEncoding: ทุกใบ dropped · เหตุผลขึ้นต้น ENCODING_BROKEN (ต่อเหตุผลเดิม ไม่ซ้ำ) · identity generic · ระเบียน failed ผ่านสัญญา 2.2', () => {
  const cards = [
    { id: 'R1', claim: Q(10), value_type: 'อื่นๆ', why_it_adds_value: '', evidence_quote: Q(30), source_url: 'https://x.test/a', source_name: '', source_date: '', confidence: 0.99, contradicts_raw: false, identity: 'verified', gate: 'pass' },
    { id: 'R2', claim: Q(10), value_type: 'อื่นๆ', why_it_adds_value: '', evidence_quote: Q(30), source_url: 'https://x.test/b', source_name: '', source_date: '', confidence: 0.9, contradicts_raw: false, identity: 'generic', gate: 'staff_only', gate_reason: 'EVIDENCE_NO_TOKEN' },
    { id: 'R3', claim: Q(10), value_type: 'อื่นๆ', why_it_adds_value: '', evidence_quote: Q(30), source_url: 'x', source_name: '', source_date: '', confidence: 0.9, contradicts_raw: false, identity: 'generic', gate: 'dropped', gate_reason: 'ENCODING_BROKEN,BAD_SOURCE_URL' },
  ];
  const out = enc.dropCardsForEncoding(cards);
  assert.deepEqual(out.map((c) => [c.gate, c.identity, c.gate_reason]), [
    ['dropped', 'generic', 'ENCODING_BROKEN'],
    ['dropped', 'generic', 'ENCODING_BROKEN,EVIDENCE_NO_TOKEN'],
    ['dropped', 'generic', 'ENCODING_BROKEN,BAD_SOURCE_URL'],
  ]);
  assert.equal(cards[0].gate, 'pass', 'ไม่แก้ object เดิม');
  assert.deepEqual(enc.dropCardsForEncoding(null), []);
  assert.ok(KNOWN_FLAGS.includes('ENCODING_BROKEN') && !AGENT_FLAGS.includes('ENCODING_BROKEN'), 'ธงระบบ (เอเจนต์ปลอมไม่ได้)');
  assert.equal(enc.ENCODING_FLAG, 'ENCODING_BROKEN');
});

test('W4-5. ถอดไบต์ + ตรวจข้อความไฟล์: BOM UTF-8 ยอม (ไม่บังคับ) · UTF-16LE (Out-File) ยอม · ไบต์ cp874 = เสีย · JSON พัง/ไม่ใช่ object/คีย์ขาด = ไม่ผ่าน', () => {
  const good = readFix(GOOD_FILE);
  const goodText = JSON.stringify(good);
  const bom = enc.decodeTextBuffer(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(goodText, 'utf8')]));
  assert.deepEqual([bom.encoding, bom.bom], ['utf8', true]);
  assert.equal(enc.checkResultText(bom.text).ok, true);
  assert.equal(enc.checkResultText(enc.decodeTextBuffer(Buffer.from(goodText, 'utf8')).text).ok, true, 'ไม่มี BOM ก็ผ่าน');
  const u16 = enc.decodeTextBuffer(Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(goodText, 'utf16le')]));
  assert.equal(u16.encoding, 'utf16le');
  assert.equal(enc.checkResultText(u16.text).ok, true);
  const cp874 = Buffer.concat([Buffer.from('{"plan":[{"question":"'), Buffer.from([0xA1, 0xD2, 0xC3, 0xA4, 0xE9, 0xB9]), Buffer.from('"}],"cards":[],"tool_log":[],"origin_post":{}}')]);
  const d = enc.decodeTextBuffer(cp874);
  assert.equal(d.encoding, 'invalid-utf8');
  const r874 = enc.checkResultText(d.text);
  assert.equal(r874.ok, false);
  assert.ok(r874.replacementChars >= 3);
  assert.equal(enc.checkResultText('{ไม่ใช่ json').reason, 'JSON_PARSE');
  assert.equal(enc.checkResultText('[1,2]').reason, 'NOT_OBJECT');
  assert.equal(enc.checkResultText('').reason, 'EMPTY_FILE');
  const missing = enc.checkResultText(JSON.stringify({ plan: [{ question: 'ต้นทางคือใคร' }], cards: [] }));
  assert.equal(missing.reason, 'MISSING_KEYS');
  assert.deepEqual(missing.missing_keys, ['tool_log', 'origin_post']);
  for (const r of [r874, missing, enc.checkResultText(readFileSync(fixPath(BROKEN_D764), 'utf8'))]) assert.ok(isAscii(JSON.stringify(r)), 'ผลตรวจเป็น ASCII ล้วน');
});

// ============================================================
// 2) check-result.mjs — โปรเซสจริงแบบที่เอเจนต์เรียก (cwd = โฟลเดอร์งาน · tools/ จาก prepareWorkdir ตัวจริง)
// ============================================================
function childEnv() {
  const env = { ...process.env };
  delete env.RESEARCH_TOOLS_REPO_ROOT; // เชลล์ของ Codex อาจไม่ส่งต่อ — โหมดสำเนาต้องหารากเองจาก .repo-root
  return env;
}
function runCheckProc(cwd, args = []) {
  const r = spawnSync(process.execPath, [join('tools', 'check-result.mjs'), ...args], { cwd, env: childEnv(), encoding: 'utf8', timeout: 30_000 });
  const lines = String(r.stdout || '').trim().split(/\r?\n/u).filter(Boolean);
  let json = null;
  try { json = JSON.parse(lines[lines.length - 1] || ''); } catch { json = null; }
  return { status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || ''), json };
}
function agentWorkdir(mod, restricted) {
  const root = mkdtempSync(join(tmpdir(), 'ra-enc-wd-'));
  try {
    const wd = mod.prepareWorkdir({ root, jobId: 'q_encoding_proc', toolsDir: TOOLS_DIR, tools: restricted ? ['serper'] : undefined, restricted, taskText: 'งานทดสอบ' });
    return { ...wd, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  } catch (e) {
    rmSync(root, { recursive: true, force: true });
    throw e;
  }
}
/** ไฟล์เสียจริงทั้ง 2 งาน → exit 1 + JSON บอกเหตุ (cwd = โฟลเดอร์งานที่มี tools/ และ out/) */
function checkBrokenFilesRejected(cwd, label) {
  for (const name of BROKEN_FILES) {
    copyFileSync(fixPath(name), join(cwd, 'out', 'result.json'));
    const r = runCheckProc(cwd, ['out/result.json']);
    assert.equal(r.status, 1, `${label}/${name}: ไฟล์เสีย = exit 1 (${r.stderr.slice(0, 200)})`);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.reason, 'NO_THAI');
    assert.equal(r.json.thaiChars, 0);
    assert.ok(r.json.questionMarks > 2000);
    assert.ok(r.json.fields_bad.includes('cards[0].claim'));
    assert.match(r.json.hint, /apply_patch/u);
    assert.ok(isAscii(r.stdout), `${label}: stdout ASCII ล้วน`);
  }
}
function checkCheckResultProcess(mod = worker) {
  for (const restricted of [false, true]) {
    const label = restricted ? 'โหมดสำเนา' : 'junction';
    const w = agentWorkdir(mod, restricted);
    try {
      let r = runCheckProc(w.dir);
      assert.equal(r.status, 1, `${label}: ไม่มีไฟล์ = exit 1 (${r.stderr.slice(0, 200)})`);
      assert.equal(r.json && r.json.reason, 'FILE_NOT_FOUND', `${label}: ค่าเริ่มต้น out/result.json`);
      checkBrokenFilesRejected(w.dir, label);
      copyFileSync(fixPath(GOOD_FILE), join(w.outDir, 'result.json'));
      r = runCheckProc(w.dir);
      assert.equal(r.status, 0, `${label}: ไฟล์ดี = exit 0 (${r.stderr.slice(0, 200)})`);
      assert.equal(r.json.ok, true);
      assert.ok(r.json.thaiChars > 1000);
      assert.deepEqual(r.json.fields_bad, []);
      assert.ok(isAscii(r.stdout));
      r = runCheckProc(w.dir, ['--fix']);
      assert.equal(r.status, 2, `${label}: ตัวเลือกไม่รู้จัก = exit 2`);
    } finally { w.cleanup(); }
  }
}
test('W4-6. check-result.mjs โปรเซสจริง: junction และโหมดสำเนา (prepareWorkdir ตัวจริง คัด check-result ไปด้วย) · เสีย exit 1 · ดี exit 0 · ไม่มีไฟล์ exit 1 · ใช้ผิด exit 2 · stdout ASCII', () => checkCheckResultProcess(worker));

test('W4-7. check-result ในโปรเซสเดียวกัน: ไฟล์ UTF-16 (Out-File) ผ่าน · อ่านไม่ได้ = READ_ERROR · โหลดกฎไม่ได้ = fail-open · import แล้วไม่รันเอง', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-enc-chk-'));
  try {
    const f = join(dir, 'r.json');
    writeFileSync(f, Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(JSON.stringify(readFix(GOOD_FILE)), 'utf16le')]));
    const r = await settleWithin(checkTool.checkResultFile(f), 'checkResultFile');
    assert.equal(r.ok, true);
    assert.equal(r.encoding, 'utf16le');
    const bad = await settleWithin(checkTool.checkResultFile(f, { readFile: () => { const e = new Error('busy'); e.code = 'EBUSY'; throw e; } }), 'read error');
    assert.deepEqual([bad.ok, bad.reason], [false, 'READ_ERROR']);
    const noRules = await settleWithin(checkTool.checkResultFile(fixPath(BROKEN_D764), { loader: async () => { throw new Error('module not found'); } }), 'no rules');
    assert.deepEqual([noRules.ok, noRules.reason], [true, 'CHECKER_UNAVAILABLE'], 'โหลดกฎไม่ได้ = fail-open (worker ตรวจซ้ำอยู่แล้ว)');
    await assert.rejects(() => checkTool.run(['a.json', 'b.json']), /one file/u);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ============================================================
// 3) codexRunner — readAgentResult/runCodex ติดผลตรวจ encoding (json/ลำดับแหล่งเดิม)
// ============================================================
function manualTimers() {
  const timers = [];
  return {
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.cleared = true; },
  };
}
function checkReadAgentResult(C) {
  const wd = mkdtempSync(join(tmpdir(), 'ra-enc-read-'));
  try {
    mkdirSync(join(wd, 'out'));
    copyFileSync(fixPath(BROKEN_D764), join(wd, 'out', 'result.json'));
    const bad = C.readAgentResult({ workdir: wd });
    assert.equal(bad.source, 'result.json');
    assert.deepEqual(bad.json, readFix(BROKEN_D764), 'json เดิมทุกช่อง');
    assert.ok(bad.encoding, 'ต้องมีช่อง encoding');
    assert.equal(bad.encoding.broken, true);
    assert.equal(bad.encoding.reason, 'NO_THAI');
    copyFileSync(fixPath(GOOD_FILE), join(wd, 'out', 'result.json'));
    assert.equal(C.readAgentResult({ workdir: wd }).encoding.broken, false);
    rmSync(join(wd, 'out', 'result.json'));
    const fromLast = C.readAgentResult({ workdir: wd, lastMessage: `สรุป\n\`\`\`json\n${JSON.stringify(withText(Q(30)))}\n\`\`\`` });
    assert.equal(fromLast.source, 'last-message');
    assert.equal(fromLast.encoding.broken, true);
    assert.equal(C.readAgentResult({ workdir: wd }).encoding, undefined, 'ไม่มี JSON = ไม่มีช่อง encoding');
  } finally { rmSync(wd, { recursive: true, force: true }); }
}
test('W4-8. readAgentResult: ไฟล์เสียจริง → encoding.broken (json เดิม) · ไฟล์ดี → ไม่เสีย · ข้อความสุดท้ายก็ตรวจ · ไม่มี JSON = ไม่มีช่อง', () => checkReadAgentResult(cr));

test('W4-9. runCodex โปรเซสจริง (fake-codex เขียน result.json ที่เสีย/ดี) → ok + json เดิม + encoding · timer มือ', async () => {
  for (const [name, broken] of [[BROKEN_6C9C, true], [GOOD_FILE, false]]) {
    const wd = mkdtempSync(join(tmpdir(), 'ra-enc-codex-'));
    try {
      mkdirSync(join(wd, 'out'));
      const t = manualTimers();
      const spawnImpl = (file, args, opts) => realSpawn(file, [FAKE_CODEX, ...args], opts);
      const r = await settleWithin(cr.runCodex({
        prompt: 'ใบงานทดสอบ (DATA ONLY)', workdir: wd, timeoutMs: 60_000,
        baseEnv: { ...process.env, FAKE_CODEX_MODE: 'ok', FAKE_CODEX_RESULT: fixPath(name) }, passEnv: ['FAKE_CODEX_MODE', 'FAKE_CODEX_RESULT'],
      }, { spawnImpl, platform: process.platform, bin: process.execPath, resolveExe: () => ({ exe: process.execPath, batch: false }), setTimer: t.setTimer, clearTimer: t.clearTimer }), `runCodex ${name}`, 15_000); // eslint-disable-line no-await-in-loop -- ทีละไฟล์
      assert.equal(r.ok, true, r.error);
      assert.equal(r.resultSource, 'result.json');
      assert.deepEqual(r.json, readFix(name));
      assert.equal(r.encoding && r.encoding.broken, broken, name);
    } finally { rmSync(wd, { recursive: true, force: true }); }
  }
});

// ============================================================
// 4) gate — การ์ดเสียรายใบ dropped · quote เสียถูกตัด · ผลไทยปกติ = gate ฉบับถอดบรรทัด W4 ทุกไบต์
// ============================================================
const CTX = { jobCreatedAt: '2026-10-01T12:49:00.000Z', minutes: 4, maxCalls: 24, maxMinutes: 6, staleDays: 7 };
function checkGateDrops(G) {
  for (const name of BROKEN_FILES) {
    const g = G.runGate(readFix(name), CTX);
    assert.equal(g.ok, true, 'โครง JSON ถูก (เสียแค่ตัวอักษร)');
    assert.ok(g.cards.length >= 6);
    for (const c of g.cards) {
      assert.equal(c.gate, 'dropped', `${name}/${c.id}: การ์ด ? ต้อง dropped`);
      assert.match(c.gate_reason, /^ENCODING_BROKEN/u);
      assert.equal(c.identity, 'generic');
      assert.ok(!('quote' in c), `${name}/${c.id}: คำพูดเสียต้องถูกตัด`);
    }
    assert.equal(g.stats.pass, 0);
  }
  const d764 = G.runGate(readFix(BROKEN_D764), CTX);
  assert.ok(d764.stats.quoteDropReasons.includes('QUOTE_ENCODING'), 'quote.text เสีย = QUOTE_ENCODING');
}
function checkGatePartial(G) {
  const good = readFix(GOOD_FILE);
  const base = G.runGate(good, CTX);
  const hurt = JSON.parse(JSON.stringify(good));
  hurt.cards[0].claim = Q([...hurt.cards[0].claim].length);
  hurt.cards[1].quote = { text: Q(40), speaker: 'มด', speaker_confidence: 0.95 };
  const g = G.runGate(hurt, CTX);
  const dropped = g.cards.filter((c) => /ENCODING_BROKEN/u.test(c.gate_reason || ''));
  assert.equal(dropped.length, 1, 'เสียใบเดียว = ทิ้งใบเดียว');
  assert.equal(dropped[0].source_url, good.cards[0].source_url.trim());
  assert.equal(dropped[0].gate, 'dropped');
  const pick = (c) => ({ claim: c.claim, gate: c.gate, reason: c.gate_reason || null });
  const baseOthers = base.cards.filter((c) => c.claim !== good.cards[0].claim.trim());
  assert.equal(baseOthers.length, base.cards.length - 1, 'หาใบต้นแบบเจอ');
  const hurtOthers = g.cards.filter((c) => !/ENCODING_BROKEN/u.test(c.gate_reason || ''));
  assert.deepEqual(hurtOthers.map(pick), baseOthers.map(pick), 'ใบอื่นตัดสินเหมือนเดิม (เทียบ claim/gate/เหตุผล)');
  assert.ok(g.stats.quoteDropReasons.includes('QUOTE_ENCODING'), 'quote เสียถูกตัด การ์ดคงอยู่');
  assert.equal(enc.isEncodingBroken(hurt).broken, false, 'เสียใบเดียวในผลใหญ่ ไม่ถึงเกณฑ์ทั้งผล (worker ไม่ตีทั้งงานเป็น failed)');
}
/** gate ฉบับก่อน W4: ถอดบรรทัดโค้ด W4 ทั้ง 3 จุด (ต้องเจอครั้งเดียวทุกจุด) */
async function legacyGate() {
  let text = SRC.gate.text;
  for (const line of [
    "import { cardEncodingBroken, quoteEncodingBroken, ENCODING_FLAG } from './encodingCheck.mjs'; // ★ 1 ต.ค. 69 (SPEC-v3 ส่วน 10 · W4)\n",
    '  if (cardEncodingBroken(card).broken) { lower(\'dropped\'); reasons.push(ENCODING_FLAG); }\n',
    "  else if (quoteEncodingBroken(q)) dropped = 'QUOTE_ENCODING'; // ★ 1 ต.ค. 69 (SPEC-v3 ส่วน 10 · W4): คำพูดไทยกลายเป็น ?\n",
  ]) {
    assert.equal(text.split(line).length, 2, `บรรทัด W4 ใน gate ต้องเจอครั้งเดียว: ${line.slice(0, 60)}`);
    text = text.replace(line, () => '');
  }
  assert.ok(!/encodingCheck|ENCODING_FLAG/u.test(text.replace(/\/\/.*$/gmu, '').replace(/\/\*[\s\S]*?\*\//gu, '')), 'ถอดแล้วต้องไม่เหลือโค้ด W4');
  return importPatchedModule(text, SRC.gate.url, 'ra-enc-gate-legacy');
}
test('W4-10. gate: ไฟล์เสียจริงทุกใบ dropped ENCODING_BROKEN + quote เสียถูกตัด · เสียใบเดียว = ทิ้งใบเดียว (ใบอื่นเดิม)', () => {
  checkGateDrops(gate);
  checkGatePartial(gate);
});
test('W4-11. gate ผลไทยปกติ = gate ฉบับถอดบรรทัด W4 ทุกไบต์ · ฉบับเดิมปล่อยการ์ด ? ผ่าน 4 ใบต่องานจริง (ยืนยันบั๊กที่แก้)', async () => {
  const old = await legacyGate();
  const synthetic = { plan: [{ question: 'ราคา?', decided: 'ค้น' }], origin_post: { url: 'https://news.test/a', source_name: 'ข่าว', confidence: 0.9 }, tool_log: [],
    cards: [{ claim: 'ราคาบ้าน 1,000 บาทจริงหรือ?', evidence_quote: 'ผู้ขายยืนยันว่าราคาบ้าน 1,000 บาท?', source_url: 'https://news.test/a', confidence: 0.9, quote: { text: 'จริงหรือ?', speaker: '?', speaker_confidence: 0.9 } }] };
  for (const json of [...GOOD_FILES.map(readFix), synthetic]) assert.deepEqual(gate.runGate(json, CTX), old.runGate(json, CTX), 'ผลปกติเดิมทุกไบต์');
  for (const name of BROKEN_FILES) assert.equal(old.runGate(readFix(name), CTX).stats.pass, 4, `${name}: ด่านเดิมปล่อยผ่าน 4 ใบ (ตรงรายงาน batch)`);
});

// ============================================================
// 5) taskBuilder — ย่อหน้า "เขียนไฟล์ผล" ช่วงท้าย (codex ทุกโหมด) · prefix แคชเดิม · ย่อหน้าเตือนรอบซ้ำ
// ============================================================
const RAW = 'หัวข้อ: มาเบลเล่าเรื่องงานแรกหลังเรียนจบ ได้เงินเดือน 7,000 บาท\nพนักงานพิมพ์สรุปจากคลิปรายการ';
const JOB_TB = { id: 'q_d764ba79bf9f9c4e', rawText: RAW, sourceUrls: [], createdAt: '2026-10-01T12:49:00.000Z' };
const BUDGET = { maxCalls: 24, maxMinutes: 6, effort: 'low' };
/** sha ของ prefix แคชเฟส 1 (827336d7 · ล็อกเดียวกับ tests/research-agent-task-builder.test.mjs W2-1 — prefix ไม่ขึ้นกับงาน) */
const PREFIX_SHA = Object.freeze({
  codex: 'c9144721f899b88d3d7f28c0e53443bf0949bd7dc7adcf048bcc0f77f8737f21',
  api: 'c134292b6aeef79ae4a067efed525956f796865a4dc7d729d17d1320d57324d7',
});
const BUDGET_HEAD = '## งบงานนี้';
function checkTaskSection(T) {
  const head = T.resultFileSection()[0];
  for (const mode of [undefined, 'shadow', 'assist', 'write']) {
    const { text, stablePrefix, boundary } = T.buildTask({ job: { ...JOB_TB, mode }, budget: BUDGET });
    assert.equal(sha(stablePrefix), PREFIX_SHA.codex, `codex/${mode}: prefix แคชเดิมทุกไบต์`);
    assert.ok(!/apply_patch|check-result/u.test(stablePrefix), 'ย่อหน้า W4 ห้ามอยู่ใน prefix');
    const at = text.indexOf(head);
    assert.ok(at > stablePrefix.length, `codex/${mode}: ย่อหน้าเขียนไฟล์ผลอยู่ช่วงท้าย`);
    assert.ok(at < text.indexOf(BUDGET_HEAD), 'ก่อนงบ/ตัวอย่าง/ลิงก์/ข่าวดิบ');
    const section = text.slice(at, text.indexOf(BUDGET_HEAD));
    for (const must of ['apply_patch) เท่านั้น', 'Set-Content', 'Out-File', 'echo', ' > ', '| python -', '| node -', 'node tools/check-result.mjs out/result.json', '"ok":true', '"ok":false']) {
      assert.ok(section.includes(must), `codex/${mode}: ต้องมี "${must}"`);
    }
    assert.equal(text.split(head).length - 1, 1, 'ย่อหน้าครั้งเดียว');
    assert.ok(!text.includes(RETRY_PHRASE), 'ไม่ใช่รอบซ้ำ = ไม่มีย่อหน้าเตือน');
    assert.ok(text.trimEnd().endsWith(`⟦/RAW-${boundary}⟧`), 'ข่าวดิบปิดท้ายเสมอ');
  }
  const api = T.buildTask({ job: { ...JOB_TB, mode: 'write' }, budget: BUDGET, brainKind: 'api', encodingRetry: true });
  assert.equal(sha(api.stablePrefix), PREFIX_SHA.api);
  assert.ok(!/apply_patch|check-result|round-encoding/u.test(api.text), 'สมอง api ไม่มีไฟล์/เชลล์ = ไม่มีย่อหน้า W4');
  const cut = (t) => t.text.slice(0, t.text.indexOf(BUDGET_HEAD));
  assert.equal(cut(T.buildTask({ job: JOB_TB, budget: BUDGET, tasteExamples: ['ตัวอย่าง A'] })),
    cut(T.buildTask({ job: { id: 'q_ffff', rawText: 'ข่าวอื่น', sourceUrls: ['https://x.test/1'] }, budget: { ...BUDGET, effort: 'medium' }, staleDays: 3, browser: false })),
    'ย่อหน้า W4 ไม่มีข้อมูลเฉพาะงาน (แคชต่อจาก prefix ได้)');
}
function checkRetrySection(T) {
  for (const mode of ['shadow', 'write']) {
    const { text, stablePrefix, boundary } = T.buildTask({ job: { ...JOB_TB, mode }, budget: BUDGET, encodingRetry: true });
    assert.equal(sha(stablePrefix), PREFIX_SHA.codex, 'รอบซ้ำ prefix แคชเดิม');
    const at = text.indexOf(RETRY_PHRASE);
    assert.ok(at > text.indexOf(T.resultFileSection()[0]), `${mode}: ย่อหน้าเตือนต่อจากย่อหน้าเขียนไฟล์ผล`);
    assert.ok(at < text.indexOf(BUDGET_HEAD), 'ก่อนงบ');
    const section = text.slice(at, text.indexOf(BUDGET_HEAD));
    assert.ok(section.includes(`out/${ARCHIVE_FILE}`), 'บอกตำแหน่งไฟล์เสียที่ย้ายไว้');
    assert.ok(section.includes('node tools/check-result.mjs out/result.json'));
    assert.ok(text.trimEnd().endsWith(`⟦/RAW-${boundary}⟧`), 'คำเตือนไม่อยู่ท้ายข่าวดิบ (ท้ายใบงาน = DATA)');
  }
}
test('W4-12. ใบงาน codex ทุกโหมด: ย่อหน้า apply_patch เท่านั้น · ห้าม Set-Content/Out-File/echo/> · ห้าม pipe ไทย · รัน check-result ก่อนจบ — ช่วงท้าย prefix แคชเดิม (sha เฟส 1) · api ไม่มี · แคชต่อได้', () => checkTaskSection(tb));
test('W4-13. ใบงานรอบซ้ำ (encodingRetry): ย่อหน้าเตือนตามสเปกตรงตัว + ตำแหน่งไฟล์เสีย · ก่อนงบ · prefix เดิม · ข่าวดิบยังปิดท้าย', () => checkRetrySection(tb));

// ============================================================
// 6) worker — รันซ้ำ 1 รอบเมื่อเวลาพอ / failed + ENCODING_BROKEN เมื่อไม่พอหรือยังเสีย (ตัวรันปลอม + นาฬิกามือ)
// ============================================================
const NOW = Date.parse('2026-10-01T12:50:00.000Z');
const CODEX_MS = 90_000;
const jobAt = (deadlineFromNowMs, extra = {}) => ({
  id: 'q_d764ba79bf9f9c4e', workflowId: 'unify_q_d764ba79bf9f9c4e', rawText: RAW, sourceUrls: [], userId: 'discord-1', status: 'leased', attempt: 1,
  createdAt: new Date(NOW - 60_000).toISOString(), deadlineAt: new Date(NOW + deadlineFromNowMs).toISOString(), mode: 'write', ...extra,
});
const ENOUGH = 15 * 60_000; // เส้นตายปกติ (createdAt + 15 นาที) — หลังรอบแรกเหลือ ~13.5 นาที
const EXACT = CODEX_MS + worker.ENCODING_RETRY_MIN_LEFT_MS; // หลังรอบแรกเหลือ 6 นาทีพอดี
function setup(mod, envOverrides = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'ra-enc-worker-'));
  const env = {
    RESEARCH_AGENT_API_BASE: 'http://localhost:3999', RESEARCH_AGENT_SECRET: 'test-secret-value-123456', RESEARCH_AGENT_WORKER_ID: 'w1',
    RESEARCH_AGENT_WORKDIR: join(tmp, 'work'), ...envOverrides,
  };
  const cfg = mod.loadConfig(env, { repoRoot: REAL_ROOT });
  cfg.logDir = join(tmp, 'logs');
  cfg.stopFile = join(cfg.logDir, 'research-agent.stop');
  cfg.browserLockFile = join(tmp, 'browser.lock');
  return { tmp, env, cfg, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}
function clock(start = NOW) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}
/** ตัวรันปลอมทีละรอบ: steps[i](p) คืนผล · แต่ละรอบเดินนาฬิกา 90 วิ · เก็บพารามิเตอร์ทุกครั้ง */
function codexSeq(steps, c) {
  const calls = [];
  const fn = async (p) => {
    calls.push(p);
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    c.advance(CODEX_MS);
    return step(p);
  };
  fn.calls = calls;
  return fn;
}
const okCodex = (json, extra = {}) => ({ ok: true, brain: 'codex', model: 'gpt-6-astra', effort: 'low', account: 'main', json, tokensUsed: 5000, elapsedMs: CODEX_MS, timedOut: false, warning: null, ...extra });
/** ผลรอบที่เขียนไฟล์เสียจริงลงโฟลเดอร์งาน (แบบ Codex จริง) แล้วคืน JSON เดียวกัน */
const brokenStep = (name = BROKEN_D764) => (p) => { copyFileSync(fixPath(name), join(p.workdir, 'out', 'result.json')); return okCodex(readFix(name)); };
const goodStep = () => () => okCodex(readFix(GOOD_FILE));
const quotaStub = () => async (name) => ({ account: name, status: 'OK', remainingPct: 80 });
function collectLog() {
  const lines = [];
  const log = (level, msg) => lines.push(`${level} ${msg}`);
  log.lines = lines;
  return log;
}
const NO_REAL = Object.freeze({
  runCodex: async () => { throw new Error('เทสห้ามเรียก Codex จริง'); },
  runApi: async () => { throw new Error('เทสห้ามเรียก API จริง'); },
  readQuota: async () => { throw new Error('เทสห้ามอ่านโควตาจริง'); },
});
function processCtx(s, deps) {
  return { cfg: s.cfg, env: s.env, state: { cooldown: {} }, deps: { ...NO_REAL, log: collectLog(), every: () => () => {}, heartbeat: async () => ({}), ...deps } };
}
/** รันงาน 1 ชิ้น → {record, calls, log, workdir, files} (เก็บไฟล์ในโฟลเดอร์งานก่อนลบ) */
async function runJob(mod, { deadline = ENOUGH, steps, envOverrides = {}, job = null, runApi = null } = {}) {
  const s = setup(mod, envOverrides);
  try {
    const c = clock();
    const runCodex = codexSeq(steps, c);
    const log = collectLog();
    const deps = { runCodex, readQuota: quotaStub(), now: c.now, log };
    if (runApi) deps.runApi = runApi;
    const { record } = await settleWithin(mod.processJob(job || jobAt(deadline), processCtx(s, deps)), 'processJob');
    const workdir = join(s.cfg.workdirRoot, 'q_d764ba79bf9f9c4e');
    const files = {
      archive: existsSync(join(workdir, 'out', ARCHIVE_FILE)) ? readFileSync(join(workdir, 'out', ARCHIVE_FILE)) : null,
      retryTask: existsSync(join(workdir, 'TASK-encoding-retry.txt')),
    };
    return { record, calls: runCodex.calls, log, workdir, files };
  } finally { s.cleanup(); }
}
const workerNotes = (record, args) => record.tool_log.filter((t) => t.tool === 'worker' && t.args === args);

async function checkRetryWhenTime(mod) {
  const seen = [];
  const r = await runJob(mod, {
    steps: [brokenStep(), (p) => { seen.push({ archive: existsSync(join(p.workdir, 'out', ARCHIVE_FILE)), stale: existsSync(join(p.workdir, 'out', 'result.json')) }); return goodStep()(p); }],
  });
  assert.equal(r.calls.length, 2, 'ไฟล์เสีย + เวลาพอ = รันซ้ำ 1 รอบ');
  assert.equal(r.calls[1].workdir, r.calls[0].workdir, 'รันซ้ำในโฟลเดอร์งานเดิม (ค้นต่อจากของเดิมได้)');
  assert.equal(r.calls[1].effort, r.calls[0].effort);
  assert.ok(!r.calls[0].prompt.includes(RETRY_PHRASE), 'รอบแรกไม่มีคำเตือน');
  assert.ok(r.calls[1].prompt.includes(RETRY_PHRASE), 'รอบซ้ำมีคำเตือนตามสเปก');
  assert.deepEqual(seen, [{ archive: true, stale: false }], 'ย้ายไฟล์เสียไป round-encoding-result.json ก่อนรันซ้ำ (ไม่มี result.json เก่าค้าง)');
  assert.deepEqual(r.files.archive, readFileSync(fixPath(BROKEN_D764)), 'ไฟล์เสียเก็บไว้ทั้งไฟล์');
  assert.equal(r.files.retryTask, true, 'เก็บใบงานรอบซ้ำไว้ดู');
  assert.ok(r.calls[1].timeoutMs <= ENOUGH - CODEX_MS - 5000, 'เพดานเวลารอบซ้ำไม่เกินเส้นตาย');
  assert.equal(r.record.status, 'done');
  assert.ok(!r.record.flags.includes('ENCODING_BROKEN'));
  assert.ok(r.record.cards.some((c) => c.gate === 'pass'), 'ใช้การ์ดไทยของรอบซ้ำ');
  assert.deepEqual(validateCardRecord(r.record), []);
  const notes = workerNotes(r.record, 'encoding');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].ok, true);
  assert.match(notes[0].note, /รันซ้ำ 1 รอบ/u);
  assert.ok(r.log.lines.some((l) => /ไฟล์ผลเข้ารหัสผิด/u.test(l)), 'log บอกเหตุ (ตัวเลขล้วน)');
}

function checkFailedRecord(record, label) {
  assert.equal(record.status, 'failed', `${label}: status failed`);
  assert.ok(record.flags.includes('ENCODING_BROKEN'), `${label}: ธง ENCODING_BROKEN`);
  assert.ok(!record.flags.includes('AGENT_FAILED'), `${label}: ไม่ใช่ AGENT_FAILED`);
  for (const f of ['STALE_NEWS', 'RAW_CONTRADICTION', 'OVER_BUDGET', 'ORIGIN_NOT_FOUND']) assert.ok(!record.flags.includes(f), `${label}: ไม่มีธงจากเนื้อที่เสีย (${f})`);
  assert.ok(record.cards.length >= 6, `${label}: เก็บการ์ดไว้ตรวจย้อนหลัง`);
  for (const c of record.cards) {
    assert.equal(c.gate, 'dropped', `${label}/${c.id}: ทุกใบ dropped`);
    assert.match(c.gate_reason, /^ENCODING_BROKEN/u);
  }
  assert.deepEqual([record.plan, record.raw_corrections, record.suggested_dimensions, record.origin_post.url, record.stale_news_warning], [[], [], [], null, null],
    `${label}: ไม่มีแผน/ข้อแก้/มุมเสนอ/ต้นทาง/คำเตือนข่าวเก่าจากเนื้อที่เสีย`);
  assert.ok(record.usage.tool_calls > 0, 'usage จริงคงไว้');
  assert.deepEqual(validateCardRecord(record), [], `${label}: ระเบียนผ่านสัญญา 2.2`);
}
async function checkNoRetryWhenShort(mod) {
  const r = await runJob(mod, { deadline: EXACT - 1, steps: [brokenStep(), goodStep()] });
  assert.equal(r.calls.length, 1, 'เหลือ < 6 นาที = ไม่รันซ้ำ');
  checkFailedRecord(r.record, 'เวลาไม่พอ');
  const notes = workerNotes(r.record, 'encoding');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].ok, false);
  assert.match(notes[0].note, /ไม่รันซ้ำ/u);
  assert.equal(r.files.archive, null, 'ไม่รันซ้ำ = ไม่ย้ายไฟล์');
  return r;
}
async function checkRetryBoundary(mod) {
  const at = await runJob(mod, { deadline: EXACT, steps: [brokenStep(), goodStep()] });
  assert.equal(at.calls.length, 2, 'เหลือ 6 นาทีพอดี (≥ 6) = รันซ้ำ');
  assert.equal(at.record.status, 'done');
  await checkNoRetryWhenShort(mod);
}
async function checkStillBroken(mod) {
  const r = await runJob(mod, { steps: [brokenStep(BROKEN_D764), brokenStep(BROKEN_6C9C), goodStep()] });
  assert.equal(r.calls.length, 2, 'รันซ้ำได้ครั้งเดียว');
  checkFailedRecord(r.record, 'รันซ้ำแล้วยังเสีย');
  assert.match(workerNotes(r.record, 'encoding')[0].note, /ยังเสีย/u);
  const none = await runJob(mod, { steps: [brokenStep(), () => ({ ok: false, errorType: 'CODEX_NO_RESULT', error: 'ไม่พบผล' })] });
  assert.equal(none.calls.length, 2);
  checkFailedRecord(none.record, 'รันซ้ำแล้วไม่ได้ผล');
  assert.match(workerNotes(none.record, 'encoding')[0].note, /ไม่ได้ผล/u);
}
async function checkNoEscalationWhenBroken(mod) {
  const hard = () => (p) => { const j = readFix(BROKEN_D764); j.complexity = 'high'; copyFileSync(fixPath(BROKEN_D764), join(p.workdir, 'out', 'result.json')); return okCodex(j); };
  const r = await runJob(mod, { deadline: EXACT - 1, steps: [hard(), goodStep()] });
  assert.equal(r.calls.length, 1, 'ผลเสีย (แม้ประเมินว่ายาก) ห้ามยก medium');
  assert.equal(r.record.brain.effort, 'low');
  checkFailedRecord(r.record, 'ยากแต่เสีย');
}
async function checkApiBrainBroken(mod) {
  const apiCalls = [];
  const runApi = async (p) => { apiCalls.push(p); return { ok: true, json: readFix(BROKEN_6C9C), costUsd: 0.01 }; };
  const r = await runJob(mod, { steps: [goodStep()], envOverrides: { RESEARCH_AGENT_BRAIN: 'api' }, runApi });
  assert.equal(apiCalls.length, 1, 'สมอง api ไม่รันซ้ำ');
  assert.equal(r.calls.length, 0, 'ไม่เรียก Codex');
  checkFailedRecord(r.record, 'สมอง api');
}
async function checkGoodUnchanged(mod, disabled) {
  const a = await runJob(mod, { steps: [goodStep()] });
  const b = await runJob(disabled, { steps: [goodStep()] });
  assert.equal(a.calls.length, 1, 'ผลปกติ = รอบเดียว');
  assert.deepEqual(a.record, b.record, 'ผลปกติ = ระเบียนเท่ากับ worker ที่ปิดตัวตรวจทุกไบต์');
  assert.equal(workerNotes(a.record, 'encoding').length, 0);
  assert.ok(!a.record.flags.includes('ENCODING_BROKEN'));
  const partial = await runJob(mod, { steps: [() => { const j = readFix(GOOD_FILE); j.cards[0].claim = Q(60); return okCodex(j); }] });
  assert.equal(partial.calls.length, 1, 'เสียใบเดียว ไม่รันซ้ำทั้งงาน');
  assert.equal(partial.record.status, 'done');
  assert.equal(partial.record.cards.filter((c) => /ENCODING_BROKEN/u.test(c.gate_reason || '')).length, 1, 'ทิ้งเฉพาะใบที่เสีย (ด่านรายใบ)');
}
const disabledWorker = () => mutantModule(SRC.worker, 'export function encodingOfResult(res) {\n', 'export function encodingOfResult(res) {\n  return null;\n', 'disabled');
/** รอบ low ไทยครบแต่ยาก+ว่าง (ยก medium ตามเดิม) · รอบ medium ไฟล์เสีย (มีลิงก์ต้นทาง = ค่าผลสูงกว่าถ้าไม่ดูการเข้ารหัส) → ต้องคงรอบ low */
const HARD_EMPTY = Object.freeze({
  complexity: 'สูง',
  plan: [{ question: 'ต้นทางคือคลิปรายการใด', why_valuable: 'ยืนยันที่มาของเรื่องเงินเดือน', decided: 'ค้น', reason: 'ไม่มีลิงก์แนบ' }],
  origin_post: { url: null, source_name: '', date: 'ไม่ทราบ', confidence: 0 }, story_date_estimate: 'ไม่ทราบ', stale_news_warning: null,
  cards: [], raw_corrections: [], flags: ['ORIGIN_NOT_FOUND'], skipped: [], tool_log: [{ tool: 'serper', args: 'มาเบล เงินเดือน 7000', ok: true, note: 'ไม่พบ', ms: 900 }],
});
async function checkMediumBrokenNotBetter(mod) {
  const r = await runJob(mod, { steps: [() => okCodex(JSON.parse(JSON.stringify(HARD_EMPTY))), brokenStep(BROKEN_D764)] });
  assert.equal(r.calls.length, 2, 'ยก medium ตามกติกาเดิม (ยาก + ไม่มีการ์ด)');
  assert.equal(r.calls[1].effort, 'medium');
  assert.equal(r.record.status, 'done');
  assert.deepEqual(r.record.plan.map((p) => p.question), [HARD_EMPTY.plan[0].question], 'รอบ medium ไฟล์เสีย = คงผลรอบ low');
  assert.ok(workerNotes(r.record, 'encoding').some((n) => /รอบ medium/u.test(n.note)), 'บันทึกเหตุใน tool_log');
}

test('W4-14. worker เวลาพอ: ไฟล์เสีย → ย้ายไฟล์ → รัน Codex ซ้ำ 1 รอบในโฟลเดอร์เดิมพร้อมคำเตือน → ผลรอบซ้ำไทยครบ = done', () => checkRetryWhenTime(worker));
test('W4-15. worker ขอบเวลา: เหลือ 6 นาทีพอดี = รันซ้ำ · ขาด 1 ms = ไม่รันซ้ำ → failed + ENCODING_BROKEN การ์ดทุกใบ dropped ไม่มีเนื้อเสีย', () => checkRetryBoundary(worker));
test('W4-16. worker รันซ้ำแล้วยังเสีย/ไม่ได้ผล → failed + ENCODING_BROKEN (รันซ้ำครั้งเดียว · ไม่สำรอง API)', () => checkStillBroken(worker));
test('W4-17. worker ผลเสียห้ามยก medium แม้เอเจนต์ประเมินว่ายาก · สมอง api ผลเสีย = failed ไม่รันซ้ำ', async () => {
  await checkNoEscalationWhenBroken(worker);
  await checkApiBrainBroken(worker);
});
test('W4-18. worker ผลไทยปกติ = ระเบียนเท่ากับ worker ที่ปิดตัวตรวจทุกไบต์ (รอบเดียว ไม่มีบันทึก encoding) · เสียใบเดียว = ทิ้งใบเดียวไม่รันซ้ำ', async () => {
  await checkGoodUnchanged(worker, await disabledWorker());
});
test('W4-18b. worker รอบยก medium ไฟล์เสีย (แม้มีลิงก์ต้นทาง) ไม่นับว่าดีกว่า → คงผลรอบ low ไทยครบ', () => checkMediumBrokenNotBetter(worker));

test('W4-19. encodingOfResult: ใช้ช่อง encoding จาก codexRunner เมื่อรูปถูก · ไม่มี = คำนวณเอง · ไม่มี JSON = null', () => {
  const given = { broken: false, reason: null };
  assert.equal(worker.encodingOfResult({ ok: true, json: readFix(BROKEN_D764), encoding: given }), given);
  assert.equal(worker.encodingOfResult({ ok: true, json: readFix(BROKEN_D764), encoding: { broken: 'x' } }).broken, true);
  assert.equal(worker.encodingOfResult({ ok: true, json: readFix(BROKEN_D764) }).broken, true);
  for (const res of [null, { ok: false, json: readFix(BROKEN_D764) }, { ok: true, json: null }]) assert.equal(worker.encodingOfResult(res), null);
});

test('W4-19b. worker + codexRunner ตัวจริง + child ปลอม (fake-codex โปรเซสจริง): รอบแรกเขียนไฟล์เสีย → ช่อง encoding จาก codexRunner → รันซ้ำในโฟลเดอร์เดิม → รอบสองไทยครบ = done', async () => {
  const s = setup(worker);
  try {
    const c = clock();
    const results = [fixPath(BROKEN_6C9C), fixPath(GOOD_FILE)];
    const seen = [];
    const t = manualTimers();
    const runCodex = async (p, d) => {
      const i = seen.length;
      seen.push({ prompt: p.prompt, workdir: p.workdir });
      c.advance(CODEX_MS);
      const res = await cr.runCodex({
        ...p, baseEnv: { ...process.env, FAKE_CODEX_MODE: 'ok', FAKE_CODEX_RESULT: results[Math.min(i, 1)] }, passEnv: ['FAKE_CODEX_MODE', 'FAKE_CODEX_RESULT'],
      }, {
        ...d, spawnImpl: (file, args, opts) => realSpawn(file, [FAKE_CODEX, ...args], opts), platform: process.platform, bin: process.execPath,
        resolveExe: () => ({ exe: process.execPath, batch: false }), setTimer: t.setTimer, clearTimer: t.clearTimer,
      });
      seen[i].encoding = res.encoding;
      return res;
    };
    const { record } = await settleWithin(worker.processJob(jobAt(ENOUGH), processCtx(s, { runCodex, readQuota: quotaStub(), now: c.now })), 'worker + codexRunner จริง', 20_000);
    assert.equal(seen.length, 2, 'รันซ้ำ 1 รอบ');
    assert.equal(seen[0].encoding && seen[0].encoding.broken, true, 'codexRunner ติด encoding.broken มากับผลรอบแรก');
    assert.equal(seen[1].encoding && seen[1].encoding.broken, false);
    assert.equal(seen[1].workdir, seen[0].workdir);
    assert.ok(seen[1].prompt.includes(RETRY_PHRASE));
    const out = join(seen[0].workdir, 'out');
    assert.deepEqual(readFileSync(join(out, ARCHIVE_FILE)), readFileSync(fixPath(BROKEN_6C9C)), 'ไฟล์เสียของรอบแรกถูกย้ายเก็บ');
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'result.json'), 'utf8')), readFix(GOOD_FILE), 'result.json = ผลรอบซ้ำ');
    assert.equal(record.status, 'done');
    assert.ok(!record.flags.includes('ENCODING_BROKEN'));
    assert.deepEqual(validateCardRecord(record), []);
  } finally { s.cleanup(); }
});

// ============================================================
// 7) ปลายทาง: ระเบียน worker → เอกสารฝั่งเว็บ (cardsSchema ตัวจริง) → บัตรบอทใบแรก/ใบที่สอง
// ============================================================
const cardRequire = createRequire(SRC.card.url);
function loadCardModule(text = SRC.card.text) {
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', text)(cardRequire, mod, mod.exports);
  return mod.exports;
}
const RC = loadCardModule();
function checkBotCard(R, doc) {
  assert.equal(R.constants.ENCODING_BROKEN_TEXT, ENCODING_TEXT, 'ข้อความตามสเปกตรงตัว');
  const view = R.buildCardView(doc, 'q_d764ba79bf9f9c4e');
  assert.ok(view.description.includes(ENCODING_TEXT), 'บัตรใบแรกบอกว่าไฟล์ผลเข้ารหัสผิด');
  assert.ok(!view.description.includes('🏷️'), 'ไม่ขึ้นป้ายธงดิบ');
  assert.ok(!/\?{3}/u.test(`${view.description}${view.fields.map((f) => f.value).join('')}`), 'ไม่มีข้อความ ? หลุดขึ้นบัตร');
  assert.equal(view.fields.length, 0, 'ไม่โชว์การ์ดเสียเป็นข้อเท็จจริง');
  assert.equal(view.reactable, false);
  const plain = R.buildCardView({ ...doc, flags: [] }, 'q_x');
  assert.ok(!plain.description.includes(ENCODING_TEXT), 'ไม่มีธง = ไม่มีบรรทัด (additive)');
  const ed = R.renderEditorCard({ status: 'skipped', reason: 'เอเจนต์ค้นคว้าจบด้วยสถานะ failed', flags: ['ENCODING_BROKEN'] }, { jobId: 'q_x' });
  assert.ok(ed.description.includes('ไฟล์ผลเอเจนต์เข้ารหัสผิด'), 'ใบที่สองแสดงธงเป็นคำไทย');
  assert.ok(!ed.description.includes('ENCODING_BROKEN'));
}
async function endToEndDoc() {
  const r = await runJob(worker, { deadline: EXACT - 1, steps: [brokenStep()] });
  const { doc, schemaErrors } = buildResearchCardsDoc(r.record, { jobId: r.record.id, mode: 'write', nowIso: '2026-10-01T12:56:00.000Z' });
  assert.deepEqual(schemaErrors, []);
  return doc;
}
test('W4-20. ปลายทาง: ระเบียน ENCODING_BROKEN → เอกสาร research-cards ฝั่งเว็บ (status failed · ธงคงอยู่ · การ์ด dropped ไม่นับ) → บัตรบอทขึ้นบรรทัดเตือนตามสเปก', async () => {
  const doc = await endToEndDoc();
  assert.equal(doc.status, 'failed');
  assert.ok(doc.flags.includes('ENCODING_BROKEN'));
  assert.ok(doc.cards.length > 0 && doc.cards.every((c) => c.gate === 'dropped'));
  assert.equal(summarizeCardsDoc(doc).cardsCount, 0, 'บรรณาธิการ/บอทไม่เห็นการ์ดที่ใช้ได้');
  checkBotCard(RC, doc);
});

// ============================================================
// 8) กลายพันธุ์ (ต้องแดงจริง — ข้อตรวจชุดเดียวกับข้างบน)
// ============================================================
test('MU1 กลายพันธุ์: ตัดกฎ "ไม่มีไทยเลย" (NO_THAI) → ไฟล์เล็กที่เสียทั้งไฟล์หลุด → ข้อตรวจแดง', async () => {
  const m = await mutantModule(SRC.enc, "    if (total.thaiChars === 0 && total.bad > 0) reason = 'NO_THAI';\n    else if", '    if', 'no-thai-rule');
  assert.throws(() => checkNoThaiRule(m), /ไม่มีไทยเลย/u);
});

test('MU2 กลายพันธุ์: เกณฑ์สัดส่วน > 5% เป็น ≥ 5% → ขอบ 5% พอดีกลายเป็นเสีย → ข้อตรวจขอบเขตแดง', async () => {
  const m = await mutantModule(SRC.enc, 'ratio > ENCODING_RULES.MAX_BAD_RATIO', 'ratio >= ENCODING_RULES.MAX_BAD_RATIO', 'ratio-gte');
  assert.throws(() => checkBoundaries(m), /5%/u);
});

test('MU3 กลายพันธุ์: ไม่ตัด URL ก่อนนับ → ? ใน URL ถูกนับ → ข้อตรวจขอบเขตแดง', async () => {
  const m = await mutantModule(SRC.enc, "const s = text.replace(URL_RE, ' ');", 'const s = text;', 'count-url');
  assert.throws(() => checkBoundaries(m), /URL/u);
});

test('MU4 กลายพันธุ์: gate ไม่ทิ้งการ์ดเข้ารหัสผิด → ไฟล์เสียจริงยังมีการ์ด pass → ข้อตรวจ gate แดง', async () => {
  const m = await mutantModule(SRC.gate, "  if (cardEncodingBroken(card).broken) { lower('dropped'); reasons.push(ENCODING_FLAG); }\n", '', 'no-card-drop');
  assert.throws(() => checkGateDrops(m), /dropped/u);
});

test('MU5 กลายพันธุ์: ไม่ใส่ย่อหน้าเขียนไฟล์ผลในใบงาน → ข้อตรวจใบงานแดง', async () => {
  const m = await mutantModule(SRC.tb, "  if (brainKind !== 'api') v.push(...resultFileSection());\n", '', 'no-section');
  assert.throws(() => checkTaskSection(m), /ช่วงท้าย/u);
});

test('MU6 กลายพันธุ์: ย้ายย่อหน้าเขียนไฟล์ผลเข้า prefix แคช → sha prefix เฟส 1 แดง', async () => {
  const m = await mutantModule(SRC.tb, "    AGENT_RESULT_TEMPLATE,\n    '',\n  );\n  return lines.join('\\n');",
    "    AGENT_RESULT_TEMPLATE,\n    '',\n  );\n  if (!isApi) lines.push(...resultFileSection());\n  return lines.join('\\n');", 'section-in-prefix');
  assert.throws(() => checkTaskSection(m), /prefix/u);
});

test('MU7 กลายพันธุ์: เงื่อนไขเวลารันซ้ำ ≥ 6 นาทีเป็น > 6 นาที → ขอบ 6 นาทีพอดีไม่รันซ้ำ → ข้อตรวจขอบเวลาแดง', async () => {
  const m = await mutantModule(SRC.worker, 'leftMs >= ENCODING_RETRY_MIN_LEFT_MS', 'leftMs > ENCODING_RETRY_MIN_LEFT_MS', 'retry-gt');
  await assert.rejects(() => checkRetryBoundary(m), /6 นาทีพอดี/u);
});

test('MU8 กลายพันธุ์: ไม่ย้ายไฟล์เสียก่อนรันซ้ำ → result.json เก่าค้างให้รอบซ้ำ → ข้อตรวจรันซ้ำแดง', async () => {
  const m = await mutantModule(SRC.worker, '          archiveRound(wd.outDir, ENCODING_RETRY_ARCHIVE_LABEL, fs);\n', '', 'no-archive');
  await assert.rejects(() => checkRetryWhenTime(m), /ย้ายไฟล์เสีย/u);
});

test('MU9 กลายพันธุ์: ไม่สร้างระเบียน failed (ส่งผลเสียเป็น done) → ข้อตรวจเวลาไม่พอแดง', async () => {
  const m = await mutantModule(SRC.worker, '      if (encodingFailed) {\n        addFlag(ENCODING_FLAG);', '      if (false) {\n        addFlag(ENCODING_FLAG);', 'no-failed-record');
  await assert.rejects(() => checkNoRetryWhenShort(m), /status failed/u);
});

test('MU10 กลายพันธุ์: ยก medium โดยไม่ดูว่าผลเสีย → รัน Codex รอบที่สอง → ข้อตรวจแดง', async () => {
  const m = await mutantModule(SRC.worker, 'good(r1) && !encodingFailed && g1.complexity', 'good(r1) && g1.complexity', 'escalate-broken');
  await assert.rejects(() => checkNoEscalationWhenBroken(m), /ยก medium/u);
});

test('MU10b กลายพันธุ์: รอบ medium ไฟล์เสียนับว่าดีกว่า (ไม่ดูการเข้ารหัส) → ใช้ผลเสียแทนรอบ low → ข้อตรวจแดง', async () => {
  const m = await mutantModule(SRC.worker, 'const better = good(r2) && !encodingBrokenRound(r2) && resultValue', 'const better = good(r2) && resultValue', 'medium-broken-better');
  await assert.rejects(() => checkMediumBrokenNotBetter(m), /คงผลรอบ low/u);
});

test('MU11 กลายพันธุ์: โหมดสำเนาไม่คัด check-result.mjs → เอเจนต์รันตรวจไม่ได้ → ข้อตรวจโปรเซสแดง', async () => {
  const m = await mutantModule(SRC.worker, "const HELPER_FILES = ['_common.mjs', '_alias-hooks.mjs', 'check-result.mjs'];", "const HELPER_FILES = ['_common.mjs', '_alias-hooks.mjs'];", 'no-helper');
  assert.throws(() => checkCheckResultProcess(m), /โหมดสำเนา/u);
});

test('MU12 กลายพันธุ์: readAgentResult ไม่ติดผลตรวจ encoding → ข้อตรวจ codexRunner แดง', async () => {
  const m = await mutantModule(SRC.cr, "if (j) return { json: j, source: 'result.json', encoding: encodingOf(j) };", "if (j) return { json: j, source: 'result.json' };", 'no-encoding');
  assert.throws(() => checkReadAgentResult(m), /encoding/u);
});

test('MU13 กลายพันธุ์: check-result ตอบผ่านเสมอ → ไฟล์เสีย exit 0 → ข้อตรวจโปรเซส (โหมดสำเนา) แดง', () => {
  const text = patched(SRC.check, '  const r = enc.checkResultText(dec.text);', '  const r = { ...enc.checkResultText(dec.text), ok: true };');
  const base = mkdtempSync(join(tmpdir(), 'ra-enc-mut-'));
  try {
    mkdirSync(join(base, 'tools'));
    mkdirSync(join(base, 'out'));
    writeFileSync(join(base, 'tools', 'check-result.mjs'), text);
    for (const f of ['_common.mjs', '_alias-hooks.mjs']) copyFileSync(join(TOOLS_DIR, f), join(base, 'tools', f));
    writeFileSync(join(base, 'tools', '.repo-root'), REAL_ROOT);
    copyFileSync(fixPath(BROKEN_D764), join(base, 'out', 'result.json'));
    const r = runCheckProc(base, ['out/result.json']);
    assert.equal(r.status, 0, `กลายพันธุ์ต้องรันได้จริงและตอบผ่าน (${r.stderr.slice(0, 200)})`);
    assert.throws(() => checkBrokenFilesRejected(base, 'กลายพันธุ์'), /exit 1/u);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('MU14 กลายพันธุ์: บอทไม่รู้จักธง ENCODING_BROKEN (ไม่มีบรรทัดเตือน) → ข้อตรวจบัตรแดง', async () => {
  const doc = await endToEndDoc();
  const R = loadCardModule(patched(SRC.card, '  if (flags.has(ENCODING_BROKEN_FLAG)) lines.push(ENCODING_BROKEN_TEXT); // ★ 1 ต.ค. 69 (SPEC-v3 ส่วน 10 · W4)\n', ''));
  assert.throws(() => checkBotCard(R, doc), /เข้ารหัสผิด/u);
});
