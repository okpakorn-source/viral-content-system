// ★ เฟส 2 "พรอมต์นักเขียน" (2 ก.ย. 69) — ข้อสอบด่านตัดฉบับยาว (src/lib/services/writerTrimPass.js) + จุดต่อสายใน autoFlowServiceText
// รัน: node --test tests/writer-trim-pass.test.mjs (AI = mock ทั้งหมด · findMissingFacts ของจริงจาก missingFactsGate · ไม่แตะเน็ต/DB)
// สัญญา: ไม่เกิน max = ไม่ยิง · เกิน → ยิง 1 ครั้ง → ผลสั้นลง = ใช้ · ข้อเท็จจริงหาย/สั้นกว่า 146/ไม่สั้นลง/AI ล้ม/หมดเวลา = ทิ้งผล ใช้ต้นฉบับ
// ผลทุบ (2 ก.ย. 69 — ทุบไฟล์จริงแล้วคืนโค้ดเดิมทุกไบต์):
//   M1 ตัดด่าน facts_lost (ไม่เทียบ findMissingFacts)                      ⇒ แดง "ผลทำข้อเท็จจริงหาย…"
//   M2 ตัดด่าน too_short (after < minWords)                                   ⇒ แดง "ผลสั้นกว่า 146…"
//   M3 ยิง AI แม้ไม่เกิน max (ลบเงื่อนไข before <= maxWords)                   ⇒ แดง "ไม่เกิน max…" (callAI ถูกเรียก)
//   M4 timeout ไม่ abort signal (ลบ ctrl.abort ใน timer)                     ⇒ แดง "หมดเวลา…" (signal ไม่ถูกยกเลิก)
//   M5 ย้ายจุดต่อสายใน autoFlow ไปหลัง runCorrectionPipeline                 ⇒ แดง "production wiring…"
// ★ แก้ตามผู้ตรวจไขว้ 2 ก.ย. 69 (medium): ด่าน facts_lost ต้องขอรายการเต็ม (FACT_CHECK_MAX_MISSING) — ค่าเริ่มต้น 20 ของ findMissingFacts
//   ซ่อนชื่อ/คำพูดที่หายเพิ่มเมื่อร่างขาดอยู่ก่อน ≥ 21 รายการ · เทสใหม่ 2 ข้อ ("ร่างที่ขาดอยู่ก่อน ≥ 21…" และ "รายงาน findMissingFacts ถูกตัด…")
//   ผลทุบเพิ่ม (ทุบไฟล์จริงแล้วคืนโค้ดเดิมทุกไบต์):
//   M6 ไม่ส่ง maxMissing ให้ findMissingFacts (กลับไปใช้ค่าเริ่มต้น 20 = รูเดิม)     ⇒ แดง "ร่างที่ขาดอยู่ก่อน ≥ 21…" + "รายงาน…ถูกตัด…"
//   M7 ตัด fail-safe truncated (ไม่ดู report.truncated)                          ⇒ แดง "รายงาน findMissingFacts ถูกตัด…"
// ★ ข้อแก้ ① หลังผล A/B (2 ก.ย. 69): trim pass รู้ว่า "ข้อเท็จจริง" คืออะไรก่อนตัด — เทสใหม่:
//   รายการข้อเท็จจริง (รวมชนิด detail) เข้าพรอมต์ · เพดาน ≤ 80 รายการ/3,000 ตัวอักษร + "…และอีก N รายการ" ·
//   ด่านกลไกประโยคคุ้มครอง (คำพูด/สมณศักดิ์-ยศ/วันที่/ตัวเลข → protected_sentence_cut ก่อนถึง findMissingFacts) ·
//   ไม่ฉีด extractFacts → ถอยไป findMissingFacts(raw, '') · ไม่มีทั้งคู่ → ยังทำงาน (ไม่มีหมวดรายการ)
//   ผลกระทบต่อเทสเดิม: การ "แก้คำ/ตัดประโยคที่มีเลข-คำพูด" ตอนนี้ถูกด่านกลไกจับก่อน (protected_sentence_cut) —
//   เทส facts_lost เดิมจึงเปลี่ยนไปใช้เคสที่ประโยคซึ่งถูกตัด "ไม่เข้ากติกาคุ้มครอง" (ประโยคชื่อ/detail ล้วน)
//   เพื่อพิสูจน์ว่าด่าน findMissingFacts เดิมยังกัดของที่ regex คุ้มครองไม่ครอบ · deps() เดิม (ไม่ฉีด extractFacts)
//   ทำให้ findMissingFacts ถูกเรียกเพิ่ม 1 รอบ (รายการเข้าพรอมต์ เนื้อว่าง) — เทส truncated นับ 3 รอบ
//   ผลทุบเพิ่ม (ทุบสำเนาโมดูลใน test + ทุบไฟล์จริงแล้วคืนโค้ดเดิมทุกไบต์):
//   M8 ตัดด่านกลไก (cutProtected = [])                                          ⇒ แดง "ด่านกลไกประโยคคุ้มครอง…"
//   M9 ตัด fallback findMissingFacts(raw, '') ใน resolveTrimFactList              ⇒ แดง "ไม่ฉีด extractFacts…"
// ★ รอบแก้ตามผู้ตรวจไขว้ (2 ก.ย. 69 · conditional): (1) normalize รูปอัญประกาศ/จุดไข่ปลาก่อนเทียบ — “”→"" ไม่ตีกลับ
//   (2) หน่วย = ก้อนคำสะสม ≥ TRIM_SENTENCE_MIN_CHARS (วัดจริง P2new: คุ้มครอง 84%→30% · ฉบับตัดไม่ได้ 3/10→0/10)
//   (3) pickTrimmedContent แกะ JSON ดิบที่มาเป็นสตริง · ผลทุบรอบนี้ (ทุบไฟล์จริงแล้วคืน):
//   M10 ถอด quote-map ใน normalizeTrimWhitespace  ⇒ แดง "luna คืน “”→""…"
//   M11 ปิดการปิดหน่วยตามเกณฑ์ (if (false))          ⇒ แดง "ตัวช่วยคุ้มครอง…" + "LONG ต้องมีหน่วยคุ้มครอง 4"
//   M12 ถอด JSON.parse ใน pickTrimmedContent          ⇒ แดง "ตัวช่วย: pickTrimmedContent…"
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FACT_CHECK_MAX_MISSING,
  PROTECTED_DATE_RE,
  PROTECTED_NUMBER_RE,
  PROTECTED_QUOTE_RE,
  PROTECTED_SENTENCE_RULES,
  PROTECTED_TITLE_PATTERNS,
  PROTECTED_TITLE_RE,
  TRIM_FACT_LIST_LIMITS,
  TRIM_PASS_DEFAULTS,
  TRIM_SENTENCE_MIN_CHARS,
  buildTrimPrompt,
  countThaiWordsDefault,
  formatTrimFactList,
  listProtectedSentences,
  missingFactKeys,
  normalizeExtractedFacts,
  normalizeTrimWhitespace,
  pickTrimmedContent,
  resolveTrimFactList,
  splitTrimSentences,
  trimIfTooLong,
} from '../src/lib/services/writerTrimPass.js';
import { extractSourceFactsDetailed, findMissingFacts } from '../src/lib/correction/missingFactsGate.js';
import { findSwitch } from '../src/lib/config/newsSwitches.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const AUTO_FLOW = readFileSync(join(ROOT, 'src', 'lib', 'services', 'autoFlowServiceText.js'), 'utf8').replace(/\r\n/g, '\n');

// นับคำแบบคาดเดาได้ (คั่นด้วยช่องว่าง) — ของจริงฉีด countPublishableThaiWords (ICU) เข้ามาแทน
const countWords = (text) => String(text || '').split(/\s+/).filter(Boolean).length;
// คำน้ำต้อง "ไม่มีตัวเลข" — findMissingFacts ของจริงถือว่าเลขที่โผล่ที่ไหนก็ได้ = ยังอยู่ (เช่น น้ำ20 จะทำให้ "20 บาท" ไม่ถูกนับว่าหาย)
const letters = (i) => { let s = ''; let n = i; do { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
const filler = (n, tag = 'คำ') => Array.from({ length: n }, (_, i) => `${tag}${letters(i)}`).join(' ');

const RAW = 'นายสมชาย ใจดี อายุ 45 ปี ขายก๋วยเตี๋ยวชามละ 20 บาท มานาน 30 ปี ที่ตลาดบางกะปิ เมื่อวันที่ 10 ส.ค. 2569 เขาบอกว่า “ผมไม่เคยขึ้นราคาเพราะอยากให้ทุกคนได้กิน” ลูกค้าห่วงเรื่องสุขภาพของเขา';
// ประโยคข้อเท็จจริงครบ (ชื่อ/ตัวเลข/วันที่/คำพูด/ประเด็นย่อย) + ประโยคน้ำ
const FACTS = 'นายสมชาย ใจดี อายุ 45 ปี ขายก๋วยเตี๋ยวชามละ 20 บาท มานาน 30 ปี ที่ตลาดบางกะปิ เมื่อวันที่ 10 ส.ค. 2569 เขาบอกว่า “ผมไม่เคยขึ้นราคาเพราะอยากให้ทุกคนได้กิน” ลูกค้าห่วงเรื่องสุขภาพของเขา';
const LONG = `${FACTS}\n\n${filler(230, 'น้ำ')}`; // ≈ 250 คำ > 220
const baseVersion = () => ({
  title: 'พาดหัวเดิม', content: LONG, hook: 'h', closing: 'c', style: '[A1] เล่า',
  usedModel: 'claude-opus-4-8', promptId: 'card-7', _source: 'classic', _sourceLabel: 'มุม 1', _rawModelDraft: LONG.slice(0, 50),
});

function mockAI(plan) {
  const calls = [];
  const callAI = async (args) => {
    calls.push(args);
    const step = typeof plan === 'function' ? plan(args) : plan;
    if (step instanceof Error) throw step;
    return step;
  };
  return { callAI, calls };
}

function deps(extra = {}) {
  return { raw: RAW, countWords, findMissingFacts, model: 'gpt-5.6-luna', ...extra };
}

// ★ ข้อแก้ ①: ค่าดีบักคาดหวังของ deps() เดิม (ไม่ฉีด extractFacts → fallback findMissingFacts(RAW, '') = รายการเต็ม)
const FACTS_LISTED_FALLBACK = findMissingFacts(RAW, '', { maxMissing: FACT_CHECK_MAX_MISSING }).missing.length;
const PROTECTED_IN_LONG = listProtectedSentences(LONG).length;
assert.ok(FACTS_LISTED_FALLBACK >= 5, 'RAW ตัวอย่างต้องมีข้อเท็จจริงหลายรายการ (กันข้อสอบหลอกตัวเอง)');
// ★ ผู้ตรวจไขว้ 2 ก.ย. 69: หน่วยละเอียดขึ้น (fold ที่ช่องว่าง ≥ 20 ตัวอักษร) — FACTS แตกเป็น 6 หน่วย คุ้มครอง 4:
//   "นายสมชาย ใจดี อายุ 45" · "20 บาท มานาน 30 ปี ที่ตลาดบางกะปิ" · "เมื่อวันที่ 10 ส.ค. 2569" · หน่วยคำพูด
//   ("ปี ขายก๋วยเตี๋ยวชามละ" กับประโยค detail ไม่คุ้มครอง — luna ตัดส่วนน้ำได้จริง) · เปลี่ยนตัวแตกหน่วยต้องรู้ตัว
assert.equal(PROTECTED_IN_LONG, 4, 'LONG ต้องมีหน่วยคุ้มครอง 4 หน่วยตามนิยาม fold ใหม่');

test('ไม่เกิน max = ไม่ยิง AI และเวอร์ชันเดิมทุกช่อง (เพิ่มแค่ _trimPass)', async () => {
  const { callAI, calls } = mockAI({ content: 'ไม่ควรถูกใช้' });
  const version = { ...baseVersion(), content: `${FACTS}\n\n${filler(150)}` };
  const snapshot = JSON.parse(JSON.stringify(version));
  const out = await trimIfTooLong(version, deps({ callAI }));
  assert.equal(calls.length, 0, 'ห้ามยิง AI เมื่อไม่เกิน max');
  assert.deepEqual(out._trimPass, { before: countWords(version.content), after: countWords(version.content), applied: false, reason: 'within_max' });
  const { _trimPass, ...rest } = out;
  assert.deepEqual(rest, snapshot, 'ช่องอื่นต้องเหมือนเดิมทุกไบต์');
  assert.deepEqual(version, snapshot, 'ห้ามแก้ object เดิม');
  assert.equal(countWords(LONG) > TRIM_PASS_DEFAULTS.maxWords, true, 'ตัวอย่างยาวต้องเกิน max จริง (กันข้อสอบหลอกตัวเอง)');
  assert.deepEqual(TRIM_PASS_DEFAULTS, { maxWords: 220, target: 180, minWords: 146, timeoutMs: 25_000, rawChars: 6000 });
});

test('เกิน max → ยิง luna ครั้งเดียวด้วยคำสั่งตัด → ผลสั้นลงและข้อเท็จจริงครบ = ใช้ผล (provenance คงเดิม)', async () => {
  const shorter = `${FACTS}\n\n${filler(160, 'น้ำ')}`; // ≈ 180 คำ
  const { callAI, calls } = mockAI({ content: shorter });
  const version = baseVersion();
  const out = await trimIfTooLong(version, deps({ callAI }));
  assert.equal(calls.length, 1, 'ต้องยิงครั้งเดียว');
  const call = calls[0];
  assert.equal(call.model, 'gpt-5.6-luna');
  assert.equal(call.allowModelFallback, false);
  assert.equal(call.maxRetries, 0);
  assert.equal(call.temperature, 0.2);
  assert.ok(call.signal && typeof call.signal.aborted === 'boolean', 'ต้องส่ง AbortSignal ให้ callAI');
  assert.match(call.prompt, /TRIM PASS/u);
  assert.match(call.prompt, new RegExp(`ยาว ${countWords(LONG)} คำ ต้องเหลือประมาณ 180 คำ \\(ห้ามต่ำกว่า 146 คำ\\)`, 'u'));
  assert.match(call.prompt, /ตัดได้เฉพาะประโยคที่ "ไม่มีข้อเท็จจริงใหม่"/u);
  assert.match(call.prompt, /ห้ามตัดหรือแก้ ชื่อ ตัวเลข วันที่ คำพูดในเครื่องหมายคำพูด จุดหักของเรื่อง และผลลัพธ์/u);
  assert.ok(call.prompt.includes(RAW), 'ต้องแนบเนื้อดิบให้เทียบ');
  assert.ok(call.prompt.includes(LONG), 'ต้องแนบข้อความที่ต้องตัด');
  assert.match(call.prompt, /\{"content": "ข้อความหลังตัด"\}/u);

  assert.equal(out.content, shorter);
  assert.deepEqual(out._trimPass, { before: countWords(LONG), after: countWords(shorter), applied: true, reason: 'trimmed', originalChars: LONG.length, factsListed: FACTS_LISTED_FALLBACK, protectedSentences: PROTECTED_IN_LONG });
  assert.ok(out._trimPass.after < out._trimPass.before);
  for (const key of ['title', 'hook', 'closing', 'style', 'usedModel', 'promptId', '_source', '_sourceLabel', '_rawModelDraft']) {
    assert.equal(out[key], version[key], `provenance/ช่อง ${key} ต้องคงเดิม`);
  }
  assert.equal(version.content, LONG, 'ห้ามแก้ object เดิม');
});

test('ผลทำข้อเท็จจริงหาย (findMissingFacts เทียบเนื้อดิบ) = ทิ้งผล ใช้ต้นฉบับ พร้อมรายการที่หาย', async () => {
  // ★ ข้อแก้ ①: เคสต้องหลุดด่านกลไกก่อน (ประโยคที่ถูกตัดคือ detail ล้วน ไม่มีเลข/คำพูด/ยศ/วันที่)
  //   เพื่อพิสูจน์ว่าด่าน findMissingFacts เดิมยังกัดของที่ regex คุ้มครองไม่ครอบ (การตัด/แก้ประโยคที่มีเลข-คำพูด
  //   ตอนนี้โดน protected_sentence_cut จับก่อน — มีเทสแยกด้านล่าง)
  const detailSentence = ' ลูกค้าห่วงเรื่องสุขภาพของเขา';
  assert.ok(FACTS.endsWith(detailSentence.trim()), 'ตัวอย่างต้องจบด้วยประโยค detail จริง (กันข้อสอบหลอกตัวเอง)');
  assert.equal(listProtectedSentences(detailSentence).length, 0, 'ประโยค detail ต้องไม่เข้ากติกาคุ้มครอง — จะได้ทดสอบด่าน findMissingFacts จริง');
  const lostDetail = `${FACTS.replace(detailSentence, '')}\n\n${filler(160, 'น้ำ')}`;
  const { callAI, calls } = mockAI({ content: lostDetail });
  const version = baseVersion();
  const out = await trimIfTooLong(version, deps({ callAI }));
  assert.equal(calls.length, 1);
  assert.equal(out.content, LONG, 'ต้องคืนต้นฉบับ');
  assert.equal(out._trimPass.applied, false);
  assert.equal(out._trimPass.reason, 'facts_lost');
  assert.ok(out._trimPass.lost.some((item) => item.startsWith('detail:ห่วงเรื่องสุขภาพ')), `ต้องบอกว่าอะไรหาย: ${JSON.stringify(out._trimPass.lost)}`);
  assert.equal(out._trimPass.before, countWords(LONG));
  assert.equal(out._trimPass.after, countWords(lostDetail));

  // ของที่ต้นฉบับนักเขียนทิ้งไปตั้งแต่แรก (หายอยู่แล้ว) ไม่นับเป็น "หายเพิ่ม" — ด่านนี้จับเฉพาะที่ตัดทิ้งเพิ่ม
  const alreadyMissing = { ...baseVersion(), content: `${FACTS.replace('ชามละ 20 บาท', 'ชามละราคาเดิม')}\n\n${filler(230, 'น้ำ')}` };
  const stillMissing = `${FACTS.replace('ชามละ 20 บาท', 'ชามละราคาเดิม')}\n\n${filler(160, 'น้ำ')}`;
  const second = mockAI({ content: stillMissing });
  const out2 = await trimIfTooLong(alreadyMissing, deps({ callAI: second.callAI }));
  assert.equal(out2._trimPass.applied, true, 'ของที่หายอยู่แล้วก่อนตัดต้องไม่บล็อกการตัด');
  assert.ok(missingFactKeys(findMissingFacts(RAW, alreadyMissing.content)).size >= 1, 'กรณีนี้ต้องมีของหายอยู่ก่อนจริง');
});

test('ร่างที่ขาดอยู่ก่อน ≥ 21 รายการ (ข่าว URL ตัวเลขเยอะ) + ผลตัดทิ้งชื่อ = facts_lost — ค่าเริ่มต้น maxMissing 20 ของ findMissingFacts ห้ามซ่อนของหาย (ผู้ตรวจไขว้ 2 ก.ย. 69)', async () => {
  const numbers = Array.from({ length: 25 }, (_, i) => `${101 + i} บาท`).join(' ');
  const rawMany = `นายสมชาย ใจดี อายุ 45 ปี ขายก๋วยเตี๋ยว เขาบอกว่า “ผมไม่เคยขึ้นราคาเพราะอยากให้ทุกคนได้กิน” ราคาสินค้าในตลาด ${numbers} ที่ตลาดบางกะปิ`;
  // ★ ข้อแก้ ①: ประโยคชื่อแยกเป็นหน่วยของตัวเอง ไม่มีเลข/คำพูด = ไม่เข้ากติกาคุ้มครอง — การตัดจึงหลุดด่านกลไก
  //   ไปให้ด่าน findMissingFacts จับ (การตัดประโยคคำพูดโดน protected_sentence_cut ก่อน — มีเทสแยก)
  const keptName = 'นายสมชาย ใจดีเปิดร้านขายก๋วยเตี๋ยวที่ตลาดบางกะปิ';
  const keptQuote = 'เขาบอกว่า “ผมไม่เคยขึ้นราคาเพราะอยากให้ทุกคนได้กิน”';
  assert.equal(listProtectedSentences(keptName).length, 0, 'ประโยคชื่อต้องไม่เข้ากติกาคุ้มครอง (กันข้อสอบหลอกตัวเอง)');
  const draft = `${keptName}\n${keptQuote}\n\n${filler(230, 'น้ำ')}`; // > 220 คำ และขาดตัวเลข 26 ตัวอยู่ก่อนแล้ว (นักเขียนทิ้งเอง)
  const droppedName = `${keptQuote}\n\n${filler(170, 'น้ำ')}`; // luna ตัดประโยคชื่อทิ้งเพิ่ม (คำพูดยังครบ)
  assert.ok(countWords(draft) > TRIM_PASS_DEFAULTS.maxWords && countWords(droppedName) >= TRIM_PASS_DEFAULTS.minWords, 'ตัวอย่างต้องเข้าเงื่อนไขยิงและไม่สั้นเกิน');

  // เงื่อนไขของรู (กันข้อสอบหลอกตัวเอง): ค่าเริ่มต้นของ findMissingFacts ชนเพดาน 20 จริง และชื่อที่หายตกนอก 20 อันดับแรก
  const defaultReport = findMissingFacts(rawMany, droppedName);
  assert.equal(defaultReport.missing.length, 20, `เคสนี้ต้องชนเพดาน 20 ของด่าน (truncated=${defaultReport.truncated})`);
  assert.ok(defaultReport.truncated >= 1, 'รายงานค่าเริ่มต้นต้องถูกตัดจริง');
  assert.ok(!defaultReport.missing.some((m) => m.type === 'name'), 'ชื่อที่หายต้องไม่อยู่ใน 20 อันดับแรก (นี่คือรู)');
  const fullReport = findMissingFacts(rawMany, droppedName, { maxMissing: FACT_CHECK_MAX_MISSING });
  assert.ok(!fullReport.truncated && fullReport.missing.some((m) => m.type === 'name'), 'เทียบเต็มต้องเห็นชื่อหาย');
  assert.ok(!fullReport.missing.some((m) => m.type === 'quote'), 'คำพูดต้องยังอยู่ (เคสนี้ทดสอบชื่อหายอย่างเดียว — ให้หลุดด่านกลไก)');

  const { callAI, calls } = mockAI({ content: droppedName });
  const out = await trimIfTooLong({ ...baseVersion(), content: draft }, deps({ raw: rawMany, callAI }));
  assert.equal(calls.length, 1);
  assert.equal(out.content, draft, 'ต้องคืนต้นฉบับ');
  assert.equal(out._trimPass.applied, false);
  assert.equal(out._trimPass.reason, 'facts_lost', `ต้องมาจากด่าน findMissingFacts ไม่ใช่ด่านกลไก: ${JSON.stringify(out._trimPass)}`);
  assert.ok(out._trimPass.lost.some((item) => item.startsWith('name:สมชาย')), `ต้องบอกว่าชื่อหาย: ${JSON.stringify(out._trimPass.lost)}`);

  // ทางกลับ: ขาดอยู่ก่อน ≥ 21 รายการเหมือนกัน แต่ผลตัดคงชื่อ/คำพูด/ตัวเลขที่เหลือครบ → ต้องยังตัดได้ (ของที่หายอยู่แล้วไม่บล็อก แม้เกิน 20)
  const cleanTrim = `${keptName}\n${keptQuote}\n\n${filler(160, 'น้ำ')}`;
  const ok = await trimIfTooLong({ ...baseVersion(), content: draft }, deps({ raw: rawMany, callAI: mockAI({ content: cleanTrim }).callAI }));
  assert.equal(ok._trimPass.applied, true, `ของที่หายอยู่ก่อน (แม้ > 20 รายการ) ต้องไม่บล็อกการตัด: ${JSON.stringify(ok._trimPass)}`);
  assert.equal(ok.content, cleanTrim);
});

test('รายงาน findMissingFacts ถูกตัด (truncated) = ตรวจไม่ครบ → ทิ้งผล reason=fact_check_truncated · ต้องขอรายการเต็มทั้ง 2 รอบ · เห็นของหายแน่ๆ ให้ facts_lost นำ', async () => {
  const shorter = `${FACTS}\n\n${filler(160, 'น้ำ')}`;
  const seenCalls = [];
  const truncating = (raw, out, opts) => { seenCalls.push({ out, opts }); return { missing: [], checked: 30, coverage: 1, byType: {}, truncated: 3 }; };
  const out = await trimIfTooLong(baseVersion(), deps({ callAI: mockAI({ content: shorter }).callAI, findMissingFacts: truncating }));
  assert.equal(out.content, LONG, 'ตรวจไม่ครบต้องคืนต้นฉบับ');
  assert.equal(out._trimPass.applied, false);
  assert.equal(out._trimPass.reason, 'fact_check_truncated');
  assert.equal(out._trimPass.truncated, 6, 'นับรวมที่ถูกตัดทั้งรอบร่างเดิมและรอบผลตัด (fallback รายการเข้าพรอมต์ไม่นับ)');
  // ★ ข้อแก้ ①: ไม่ฉีด extractFacts → findMissingFacts ถูกใช้เพิ่ม 1 รอบเป็นรายการเข้าพรอมต์ (เนื้อว่าง) ก่อน 2 รอบด่านเดิม
  assert.equal(seenCalls.length, 3, 'เรียก 3 รอบ: รายการเข้าพรอมต์ (fallback) + ร่างเดิม + ผลตัด');
  assert.equal(seenCalls[0].out, '', 'รอบแรกคือ fallback รายการข้อเท็จจริง (เนื้อว่าง = รายการเต็ม)');
  assert.notEqual(seenCalls[1].out, '', 'รอบสองคือด่านเดิมเทียบร่างเดิม');
  for (const call of seenCalls) assert.equal(call.opts?.maxMissing, FACT_CHECK_MAX_MISSING, 'ต้องขอรายการเต็มทุกรอบ');
  assert.ok(Number.isInteger(FACT_CHECK_MAX_MISSING) && FACT_CHECK_MAX_MISSING >= 1000, 'เพดานต้องใหญ่กว่าจำนวนข้อเท็จจริงในข่าวจริงมาก');

  // ถูกตัดด้วย + เห็นชื่อหายแน่ๆ ในรอบผลตัด → facts_lost (ข้อมูลชัดกว่า) แต่ยังทิ้งผลเหมือนกัน
  // (รอบ 0 = fallback รายการพรอมต์ · รอบ 1 = ร่างเดิม · รอบ 2 = ผลตัด)
  let round = 0;
  const truncatingWithLoss = () => ({ missing: round++ <= 1 ? [] : [{ type: 'name', text: 'สมชาย' }], truncated: 1 });
  const lost = await trimIfTooLong(baseVersion(), deps({ callAI: mockAI({ content: shorter }).callAI, findMissingFacts: truncatingWithLoss }));
  assert.equal(lost.content, LONG);
  assert.deepEqual([lost._trimPass.applied, lost._trimPass.reason, lost._trimPass.lost], [false, 'facts_lost', ['name:สมชาย']]);
});

test('ผลสั้นกว่า 146 คำ = ทิ้งผล ใช้ต้นฉบับ', async () => {
  const tooShort = `${FACTS}\n\n${filler(100, 'น้ำ')}`; // ≈ 120 คำ
  const { callAI } = mockAI({ content: tooShort });
  const out = await trimIfTooLong(baseVersion(), deps({ callAI }));
  assert.equal(out.content, LONG);
  assert.deepEqual(out._trimPass, { before: countWords(LONG), after: countWords(tooShort), applied: false, reason: 'too_short', factsListed: FACTS_LISTED_FALLBACK, protectedSentences: PROTECTED_IN_LONG });
  assert.ok(countWords(tooShort) < 146);
});

test('ผลไม่สั้นลง / ตอบว่าง / ไม่มี callAI = ทิ้งผล ใช้ต้นฉบับ (เหตุผลระบุชัด)', async () => {
  const longer = `${LONG}\n\n${filler(20, 'เพิ่ม')}`;
  const notShorter = await trimIfTooLong(baseVersion(), deps({ callAI: mockAI({ content: longer }).callAI }));
  assert.equal(notShorter.content, LONG);
  assert.equal(notShorter._trimPass.reason, 'not_shorter');

  const empty = await trimIfTooLong(baseVersion(), deps({ callAI: mockAI({}).callAI }));
  assert.equal(empty.content, LONG);
  assert.deepEqual(empty._trimPass, { before: countWords(LONG), after: countWords(LONG), applied: false, reason: 'empty_result', factsListed: FACTS_LISTED_FALLBACK, protectedSentences: PROTECTED_IN_LONG });

  const noAI = await trimIfTooLong(baseVersion(), deps({ callAI: undefined }));
  assert.equal(noAI._trimPass.reason, 'no_ai');
  assert.equal(noAI.content, LONG);
});

test('AI ล้ม (throw) = ทิ้งผล ใช้ต้นฉบับ ไม่โยน error ออกไปล้มท่อ', async () => {
  const { callAI } = mockAI(new Error('mock luna down'));
  const out = await trimIfTooLong(baseVersion(), deps({ callAI }));
  assert.equal(out.content, LONG);
  assert.equal(out._trimPass.applied, false);
  assert.equal(out._trimPass.reason, 'ai_error');
  assert.match(out._trimPass.error, /mock luna down/u);
  assert.equal(out._trimPass.before, countWords(LONG));
});

test('หมดเวลา: AI ไม่ตอบใน timeoutMs = ทิ้งผล ยกเลิก signal ที่ส่งให้ AI และไม่ค้างรอ', async () => {
  let seenSignal = null;
  const callAI = (args) => new Promise((resolve) => {
    seenSignal = args.signal;
    setTimeout(() => resolve({ content: `${FACTS}\n\n${filler(160, 'น้ำ')}` }), 150);
  });
  const started = Date.now();
  const out = await trimIfTooLong(baseVersion(), deps({ callAI, timeoutMs: 25 }));
  assert.ok(Date.now() - started < 140, 'ต้องคืนผลก่อน AI ตอบ (ไม่รอ)');
  assert.equal(out.content, LONG);
  assert.equal(out._trimPass.applied, false);
  assert.equal(out._trimPass.reason, 'timeout');
  assert.match(out._trimPass.error, /^TIMEOUT: writer_trim_pass/u);
  assert.equal(seenSignal?.aborted, true, 'signal ที่ส่งให้ AI ต้องถูกยกเลิกจริง (ตัดจ่ายซ้อน)');
  await new Promise((resolve) => setTimeout(resolve, 170)); // ปล่อยให้ timer ของ mock จบ — ห้ามมีผลข้างเคียงย้อนกลับ
  assert.equal(out.content, LONG);
});

test('parent signal ถูกยกเลิกไว้ก่อน (งบท่อหมด) = ไม่ยิง AI คืนต้นฉบับ reason=aborted', async () => {
  const ctrl = new AbortController();
  ctrl.abort(new Error('pipeline deadline'));
  const { callAI, calls } = mockAI({ content: `${FACTS}\n\n${filler(160, 'น้ำ')}` });
  const out = await trimIfTooLong(baseVersion(), deps({ callAI, signal: ctrl.signal }));
  assert.equal(calls.length, 0);
  assert.equal(out.content, LONG);
  assert.equal(out._trimPass.reason, 'aborted');
});

test('ตัวช่วย: pickTrimmedContent / missingFactKeys / countThaiWordsDefault / buildTrimPrompt ตัดเนื้อดิบยาว', () => {
  assert.equal(pickTrimmedContent({ content: '  ก ข  ' }), 'ก ข');
  assert.equal(pickTrimmedContent('สตริง'), 'สตริง');
  // ★ ผู้ตรวจไขว้ 2 ก.ย. 69 (low): สตริงที่เป็น JSON ดิบทั้งก้อน → แกะ .content · แกะไม่ได้ = คืนสตริงเดิม
  assert.equal(pickTrimmedContent('  {"content": " ตัดแล้ว "}  '), 'ตัดแล้ว', 'JSON ดิบเป็นสตริงต้องแกะ .content');
  assert.equal(pickTrimmedContent('{ not json'), '{ not json', 'ขึ้นต้น { แต่ parse ไม่ได้ = คืนสตริงเดิม');
  assert.equal(pickTrimmedContent('{"versions": [1]}'), '{"versions": [1]}', 'JSON ที่ไม่มี .content = คืนสตริงเดิม');
  assert.equal(pickTrimmedContent({ versions: [{ content: 'จากเวอร์ชัน' }] }), 'จากเวอร์ชัน');
  assert.equal(pickTrimmedContent({ content: 5 }), '');
  assert.equal(pickTrimmedContent(null), '');
  assert.deepEqual([...missingFactKeys({ missing: [{ type: 'number', text: '20 บาท' }] })], ['number|20 บาท']);
  assert.equal(missingFactKeys(null).size, 0);
  assert.ok(countThaiWordsDefault('ลุงขายก๋วยเตี๋ยวมานานสามสิบปี') >= 4, 'ตัวนับสำรองต้องนับคำไทยได้');
  const prompt = buildTrimPrompt({ content: 'เนื้อ', before: 250, target: 180, minWords: 146, raw: 'ก'.repeat(7000), rawChars: 6000 });
  assert.ok(prompt.includes('ก'.repeat(6000)) && !prompt.includes('ก'.repeat(6001)), 'เนื้อดิบต้องถูกตัดที่ rawChars');
  assert.match(prompt, /…\(ตัดแสดง\)/u);
});

test('★ ข้อแก้ ①: รายการข้อเท็จจริงเข้าพรอมต์ครบชนิด (extractSourceFactsDetailed จริง — รวม detail) + กฎคุ้มครองในพรอมต์ + factsListed', async () => {
  const shorter = `${FACTS}\n\n${filler(160, 'น้ำ')}`;
  const { callAI, calls } = mockAI({ content: shorter });
  const out = await trimIfTooLong(baseVersion(), deps({ callAI, extractFacts: extractSourceFactsDetailed }));
  assert.equal(calls.length, 1);
  const prompt = calls[0].prompt;
  assert.match(prompt, /=== 📌 รายการข้อเท็จจริงที่ห้ามหาย \(นับจากต้นฉบับดิบ\) ===/u);
  for (const needle of ['- number|45 ปี', '- number|20 บาท', '- date|10 ส.ค. 2569', '- quote|ผมไม่เคยขึ้นราคาเพราะอยากให้ทุกคนได้กิน', '- name|สมชาย', '- detail|ห่วงเรื่องสุขภาพ']) {
    assert.ok(prompt.includes(needle), `พรอมต์ต้องมีรายการ "${needle}"`);
  }
  assert.ok(prompt.indexOf('=== จบรายการข้อเท็จจริง ===') < prompt.indexOf('ตอบเป็น JSON เท่านั้น'), 'หมวดรายการต้องอยู่ก่อนคำสั่ง JSON');
  assert.match(prompt, /🔒 ห้ามตัดประโยคที่มี/u, 'กฎคุ้มครองต้องอยู่ในพรอมต์');
  assert.match(prompt, /สมณศักดิ์\/ยศ\/ตำแหน่ง \(พระครู พระอาจารย์ หลวงพ่อ หลวงปู่ พระมหา สมเด็จ พ\.ต\.อ\. ร\.ต\.ท\. นายก ผอ\. ฯลฯ\)/u);
  assert.match(prompt, /วันที่\/เวลา \(1 พ\.ย\. · 12 ม\.ค\. 68 · เวลา 03\.00 น\. · ปี 2567\)/u);
  const expectedFacts = normalizeExtractedFacts(extractSourceFactsDetailed(RAW));
  assert.ok(expectedFacts.some((f) => f.type === 'detail'), 'ตัวสกัดจริงต้องให้ชนิด detail (กันข้อสอบหลอกตัวเอง)');
  assert.equal(out._trimPass.factsListed, expectedFacts.length, 'factsListed = จำนวนที่เข้าพรอมต์จริง');
  assert.equal(out._trimPass.protectedSentences, PROTECTED_IN_LONG);
  assert.equal(out._trimPass.applied, true, 'เคสผ่านปกติยัง trimmed');
  assert.equal(out._trimPass.reason, 'trimmed');
});

test('★ ข้อแก้ ①: เพดานรายการ — เกิน 80 รายการ/3,000 ตัวอักษร ถูกตัด + พรอมต์บอก "…และอีก N รายการ" + ข้อความยาวถูกหั่นต่อรายการ', () => {
  assert.deepEqual(TRIM_FACT_LIST_LIMITS, { maxItems: 80, maxChars: 3000, maxItemChars: 160 });
  const many = Array.from({ length: 100 }, (_, i) => ({ type: 'number', text: `${i + 1} บาท` }));
  const capped = formatTrimFactList(many);
  assert.equal(capped.listed, 80);
  assert.equal(capped.omitted, 20);
  assert.equal(capped.lines.length, 80);
  const promptWithMany = buildTrimPrompt({ content: 'เนื้อ', before: 250, target: 180, minWords: 146, raw: RAW, facts: many });
  assert.ok(promptWithMany.includes('…และอีก 20 รายการ'), 'พรอมต์ต้องบอกจำนวนที่ไม่ได้แสดง');
  // เพดานอักษรรวม: รายการยาวจนเกิน 3,000 ต้องหยุดก่อน และแต่ละรายการโดนหั่นที่ maxItemChars
  const longItems = Array.from({ length: 40 }, (_, i) => ({ type: 'quote', text: `${letters(i)}${'ก'.repeat(500)}` }));
  const cappedChars = formatTrimFactList(longItems);
  assert.ok(cappedChars.lines.every((line) => line.length <= TRIM_FACT_LIST_LIMITS.maxItemChars + '- quote|'.length));
  assert.ok(cappedChars.lines.join('').length <= TRIM_FACT_LIST_LIMITS.maxChars, 'ผลรวมต้องไม่เกิน 3,000 ตัวอักษร');
  assert.ok(cappedChars.listed < 40 && cappedChars.omitted === 40 - cappedChars.listed);
  // ไม่มีรายการ = ไม่มีหมวด (พรอมต์ไม่บวมด้วยหัวเปล่า)
  const bare = buildTrimPrompt({ content: 'เนื้อ', before: 250, target: 180, minWords: 146, raw: RAW });
  assert.ok(!bare.includes('รายการข้อเท็จจริงที่ห้ามหาย'));
  assert.match(bare, /🔒 ห้ามตัดประโยคที่มี/u, 'กฎคุ้มครองอยู่เสมอแม้ไม่มีรายการ');
});

test('★ ข้อแก้ ①: ด่านกลไกประโยคคุ้มครอง — ตัด/แก้ประโยคที่มีคำพูด = protected_sentence_cut คืนต้นฉบับ ก่อนถึงด่าน findMissingFacts', async () => {
  // ตัดประโยคคำพูดทิ้งทั้งประโยค
  const quoteSentence = ' เขาบอกว่า “ผมไม่เคยขึ้นราคาเพราะอยากให้ทุกคนได้กิน”';
  const cutQuote = `${FACTS.replace(quoteSentence, '')}\n\n${filler(165, 'น้ำ')}`;
  const spyCalls = [];
  const spyFind = (raw, outText, opts) => { spyCalls.push(outText); return findMissingFacts(raw, outText, opts); };
  const { callAI } = mockAI({ content: cutQuote });
  const out = await trimIfTooLong(baseVersion(), deps({ callAI, findMissingFacts: spyFind }));
  assert.equal(out.content, LONG, 'ต้องคืนต้นฉบับ');
  assert.equal(out._trimPass.applied, false);
  assert.equal(out._trimPass.reason, 'protected_sentence_cut');
  assert.ok(Array.isArray(out._trimPass.cut) && out._trimPass.cut.length >= 1 && out._trimPass.cut.length <= 3, 'ต้องมีตัวอย่างประโยคที่หาย ≤ 3');
  assert.ok(out._trimPass.cut.some((s) => s.includes('ผมไม่เคยขึ้นราคา')), `ตัวอย่างต้องชี้ประโยคคำพูดที่หาย: ${JSON.stringify(out._trimPass.cut)}`);
  assert.deepEqual(spyCalls, [''], 'ด่านกลไกต้องจับก่อน — findMissingFacts ถูกเรียกแค่รอบรายการพรอมต์ (เนื้อว่าง) ไม่ถึงรอบเทียบร่าง/ผลตัด');
  assert.equal(out._trimPass.protectedSentences, PROTECTED_IN_LONG);

  // แก้คำในประโยคคุ้มครอง (เลขหาย — เคสเดิมของ facts_lost ยุคก่อนข้อแก้ ①) → ด่านกลไกจับเช่นกัน (substring ไม่ตรง)
  const editedNumber = `${FACTS.replace('ชามละ 20 บาท', 'ชามละราคาเดิม')}\n\n${filler(160, 'น้ำ')}`;
  const edited = await trimIfTooLong(baseVersion(), deps({ callAI: mockAI({ content: editedNumber }).callAI }));
  assert.equal(edited.content, LONG);
  assert.equal(edited._trimPass.reason, 'protected_sentence_cut');

  // ช่องว่างต่างกันอย่างเดียว (normalize ได้) ต้องไม่ถูกตีเป็นของหาย
  const reWrapped = `${FACTS.replace(' เขาบอกว่า', '\nเขาบอกว่า')}\n\n${filler(160, 'น้ำ')}`;
  const okWrap = await trimIfTooLong(baseVersion(), deps({ callAI: mockAI({ content: reWrapped }).callAI }));
  assert.equal(okWrap._trimPass.applied, true, `ยุบช่องว่างแล้วเทียบได้ ต้องไม่ตีกลับ: ${JSON.stringify(okWrap._trimPass)}`);
});

test('★ ผู้ตรวจไขว้ 2 ก.ย. 69: luna คืน “”→"" โดยประโยคครบ = ไม่ตีกลับ (normalize รูปอัญประกาศ) · แก้คำในคำพูด = ยังจับ', async () => {
  // วัดจริง 10 ฉบับ: อัญประกาศต่างชนิดอย่างเดียวเคยทำ protected_sentence_cut 4/4 ฉบับที่มี “” (trim เป็นหมัน)
  const quoteInner = 'ผมไม่เคยขึ้นราคาเพราะอยากให้ทุกคนได้กิน';
  const asciiQuotes = `${FACTS.replace(`“${quoteInner}”`, `"${quoteInner}"`)}\n\n${filler(160, 'น้ำ')}`;
  assert.ok(asciiQuotes.includes(`"${quoteInner}"`), 'เคสต้องแปลงชนิดอัญประกาศจริง (กันข้อสอบหลอกตัวเอง)');
  const out = await trimIfTooLong(baseVersion(), deps({ callAI: mockAI({ content: asciiQuotes }).callAI }));
  assert.equal(out._trimPass.applied, true, `ประโยคครบ ต่างแค่ชนิดอัญประกาศ ต้องไม่ตีกลับ: ${JSON.stringify(out._trimPass)}`);
  assert.equal(out.content, asciiQuotes);
  assert.equal(normalizeTrimWhitespace('“ก” ‘ข’ …'), '"ก" \'ข\' ...', 'map “”→" · ‘’→\' · …→... ก่อนยุบช่องว่าง');

  // คำในคำพูดเปลี่ยน (ขึ้น→ลด) — แม้ชนิดอัญประกาศเปลี่ยนด้วย ก็ต้องยังจับ
  const editedQuote = `${FACTS.replace(`“${quoteInner}”`, '"ผมไม่เคยลดราคาเพราะอยากให้ทุกคนได้กิน"')}\n\n${filler(160, 'น้ำ')}`;
  const caught = await trimIfTooLong(baseVersion(), deps({ callAI: mockAI({ content: editedQuote }).callAI }));
  assert.equal(caught._trimPass.reason, 'protected_sentence_cut', `แก้คำในคำพูดต้องถูกจับ: ${JSON.stringify(caught._trimPass)}`);
  assert.equal(caught.content, LONG);
});

test('★ ข้อแก้ ①: ไม่ฉีด extractFacts → ถอยไป findMissingFacts(raw, "") · ไม่มีทั้งคู่ → ไม่มีหมวดรายการแต่ยังตัดได้ · resolveTrimFactList ห้ามล้ม', async () => {
  // deps() เดิม (ไม่มี extractFacts): รายการมาจาก findMissingFacts(raw, '') — พรอมต์ต้องมีหมวด
  const shorter = `${FACTS}\n\n${filler(160, 'น้ำ')}`;
  const first = mockAI({ content: shorter });
  const viaFallback = await trimIfTooLong(baseVersion(), deps({ callAI: first.callAI }));
  assert.match(first.calls[0].prompt, /=== 📌 รายการข้อเท็จจริงที่ห้ามหาย/u, 'fallback ต้องได้รายการจาก findMissingFacts(raw, "")');
  assert.equal(viaFallback._trimPass.factsListed, FACTS_LISTED_FALLBACK);
  assert.equal(viaFallback._trimPass.applied, true);
  const fallbackList = resolveTrimFactList({ findMissingFacts, raw: RAW });
  assert.deepEqual(fallbackList, normalizeExtractedFacts(findMissingFacts(RAW, '', { maxMissing: FACT_CHECK_MAX_MISSING }).missing));

  // ไม่มีทั้งคู่: ไม่มีหมวดรายการ · factsListed = 0 · ยังตัดได้ (ด่านกลไกยังคุ้มครองตามเดิม)
  const second = mockAI({ content: shorter });
  const noDeps = await trimIfTooLong(baseVersion(), { raw: RAW, countWords, callAI: second.callAI });
  assert.ok(!second.calls[0].prompt.includes('รายการข้อเท็จจริงที่ห้ามหาย'), 'ไม่มีตัวสกัดเลย = ไม่ใส่หมวด');
  assert.equal(noDeps._trimPass.factsListed, 0);
  assert.equal(noDeps._trimPass.protectedSentences, PROTECTED_IN_LONG);
  assert.equal(noDeps._trimPass.applied, true, 'ห้ามล้ม — ตัดได้ตามปกติ');

  // ตัวสกัดระเบิด = เหมือนไม่มีรายการ (ห้ามล้มท่อ) และ trimIfTooLong ยังทำงานจบ
  assert.deepEqual(resolveTrimFactList({ extractFacts: () => { throw new Error('boom'); }, findMissingFacts, raw: RAW }), []);
  assert.deepEqual(resolveTrimFactList({}), []);
  assert.deepEqual(resolveTrimFactList({ findMissingFacts, raw: '' }), []);
  const third = mockAI({ content: shorter });
  const exploded = await trimIfTooLong(baseVersion(), deps({ callAI: third.callAI, extractFacts: () => { throw new Error('boom'); } }));
  assert.equal(exploded._trimPass.applied, true);
  assert.equal(exploded._trimPass.factsListed, 0);
});

test('★ ข้อแก้ ①: ตัวช่วยคุ้มครอง — regex สมณศักดิ์/ยศ/วันที่/ตัวเลข/คำพูด + splitTrimSentences + listProtectedSentences + normalizeExtractedFacts', () => {
  // รายการ regex ยศ/สมณศักดิ์ export ให้เทสได้ และครอบตัวอย่างในสเปก
  for (const needle of ['พระครู', 'พระอาจารย์', 'หลวงพ่อ', 'หลวงปู่', 'พระมหา', 'สมเด็จ', 'พ\\.ต\\.อ\\.', 'ร\\.ต\\.ท\\.', 'ผอ\\.']) {
    assert.ok(PROTECTED_TITLE_PATTERNS.includes(needle), `PROTECTED_TITLE_PATTERNS ต้องมี ${needle}`);
  }
  assert.ok(PROTECTED_TITLE_PATTERNS.some((p) => p.startsWith('นายก')), 'ต้องครอบตำแหน่งนายกฯ');
  for (const sample of ['พระครูสมุห์สมบัติ', 'หลวงพ่อเงิน', 'พ.ต.อ.ประวิทย์', 'ร.ต.ท.สมหมาย', 'นายกฯ ลงพื้นที่', 'ผอ.โรงเรียน', 'สมเด็จพระพุฒาจารย์']) {
    assert.ok(PROTECTED_TITLE_RE.test(sample), `PROTECTED_TITLE_RE ต้องจับ "${sample}"`);
  }
  for (const sample of ['นายสมชาย', 'ประชาชนทั่วไป', 'คนขับรถ']) {
    assert.ok(!PROTECTED_TITLE_RE.test(sample), `PROTECTED_TITLE_RE ต้องไม่จับ "${sample}"`);
  }
  for (const sample of ['1 พ.ย.', '12 ม.ค. 68', 'เวลา 03.00 น.', '03.00 น.', 'ปี 2567', '10/8/2569', 'วันที่ 1 พฤศจิกายน']) {
    assert.ok(PROTECTED_DATE_RE.test(sample), `PROTECTED_DATE_RE ต้องจับ "${sample}"`);
  }
  assert.ok(!PROTECTED_DATE_RE.test('วันนี้อากาศดี'), 'วันแบบไม่มีเลข/เดือนต้องไม่จับ');
  assert.ok(PROTECTED_NUMBER_RE.test('มี ๕ คน') && PROTECTED_NUMBER_RE.test('20 บาท') && !PROTECTED_NUMBER_RE.test('ยี่สิบบาท'));
  assert.ok(PROTECTED_QUOTE_RE.test('เขาว่า “สู้”') && PROTECTED_QUOTE_RE.test("เธอว่า 'ไหว'") && !PROTECTED_QUOTE_RE.test('ไม่มีคำพูด'));
  assert.deepEqual(PROTECTED_SENTENCE_RULES.map((r) => r.type), ['quote', 'title', 'date', 'number']);

  // ★ ผู้ตรวจไขว้ 2 ก.ย. 69: หน่วย = ก้อนคำสะสม ≥ TRIM_SENTENCE_MIN_CHARS (แตกที่ช่องว่าง/บรรทัด · เศษท้ายรวมหน่วยก่อนหน้า)
  assert.equal(TRIM_SENTENCE_MIN_CHARS, 20);
  const units = splitTrimSentences('บรรทัดแรกมี 20 บาท\nเขาพูดว่า “สู้ต่อ” แล้วเดินจากไป\n\nประโยคน้ำล้วนไม่มีอะไร');
  assert.deepEqual(units, ['บรรทัดแรกมี 20 บาท', 'เขาพูดว่า “สู้ต่อ” แล้วเดินจากไป', 'ประโยคน้ำล้วนไม่มีอะไร'], 'ขึ้นบรรทัดใหม่ = ตัดเสมอ · ในบรรทัดสะสมถึงเกณฑ์แล้วปิดหน่วย');
  assert.deepEqual(splitTrimSentences('เดิน 28 กิโล ทุกวัน'), ['เดิน 28 กิโล ทุกวัน'], '"28"/"กิโล" ต้องไม่เป็นหน่วยเดี่ยวที่ substring ผ่านง่าย');
  const folded = splitTrimSentences('ประโยคแรกยาวพอที่จะปิดหน่วยเองได้เลย แล้วมีเศษ ท้าย');
  assert.ok(folded.length >= 1 && folded[folded.length - 1].endsWith('ท้าย') && folded.every((u) => u.length >= TRIM_SENTENCE_MIN_CHARS || folded.length === 1), `เศษสั้นท้ายบรรทัดต้องรวมเข้าหน่วยก่อนหน้า: ${JSON.stringify(folded)}`);
  const medians = splitTrimSentences(LONG).map((u) => u.length).sort((a, b) => a - b);
  assert.ok(medians[Math.floor(medians.length / 2)] < 60, 'หน่วยส่วนใหญ่ต้องเล็กระดับอนุประโยค ไม่ใช่ทั้งย่อหน้า (ผู้ตรวจวัด median เดิม 93–278)');
  const guarded = listProtectedSentences('มีเลข 20 บาทอยู่หนึ่งประโยค\nเขาพูดว่า “สู้ต่อ” ตรงนี้\nประโยคน้ำล้วนไม่มีอะไร');
  assert.equal(guarded.length, 2, 'เลข 1 + คำพูด 1 (ประโยคน้ำไม่นับ)');
  assert.deepEqual(guarded[0].types, ['number']);
  assert.ok(guarded[1].types.includes('quote'));
  assert.equal(normalizeTrimWhitespace('ก  ข\n\tค'), 'ก ข ค');

  // normalizeExtractedFacts: รับทั้งทรง object (detailed — รวม detail) และ array {type, text}
  const detailed = normalizeExtractedFacts(extractSourceFactsDetailed(RAW));
  for (const type of ['number', 'date', 'quote', 'name', 'detail']) {
    assert.ok(detailed.some((f) => f.type === type), `ทรง detailed ต้องได้ชนิด ${type}`);
  }
  assert.deepEqual(normalizeExtractedFacts([{ type: 'name', text: 'สมชาย' }, { text: '' }, null]), [{ type: 'name', text: 'สมชาย' }]);
  assert.deepEqual(normalizeExtractedFacts({ numbers: ['5 บาท'], names: [{ text: 'ดำ' }], junk: [{ text: 'x' }] }), [{ type: 'number', text: '5 บาท' }, { type: 'name', text: 'ดำ' }]);
  assert.deepEqual(normalizeExtractedFacts('ไม่ใช่ทรงที่รู้จัก'), []);
});

test('production wiring: autoFlowServiceText ต่อสาย trim pass หลังได้ร่างครบ ก่อน correctionPipeline ใต้ deadline เดิม และปิด = ไม่แตะ', () => {
  const gate = AUTO_FLOW.indexOf("if (process.env.WRITER_TRIM_PASS === '1') {");
  const grounding = AUTO_FLOW.indexOf('const groundingSourceText = ');
  const correction = AUTO_FLOW.indexOf('finalVersions = await runCorrectionPipeline(');
  assert.ok(gate >= 0, 'ต้องมีประตูสวิตช์ WRITER_TRIM_PASS === "1" (รับเฉพาะ 1 ตรงตัว)');
  assert.ok(grounding >= 0 && grounding < gate, 'ต้องมีเนื้อดิบ (groundingSourceText) ก่อนตัด');
  assert.ok(gate < correction, 'trim pass ต้องอยู่ก่อน runCorrectionPipeline');
  const block = AUTO_FLOW.slice(gate, correction);
  assert.match(block, /import\('@\/lib\/services\/writerTrimPass'\)/u, 'โหลดแบบ dynamic (กันเทสสตับเดิมพัง)');
  assert.match(block, /import\('@\/lib\/correction\/missingFactsGate'\)/u);
  assert.match(block, /countPublishableThaiWords\(\{ content: text \}\)/u, 'นับคำด้วยตัวเดียวกับด่านพื้น 146');
  assert.match(block, /raw: groundingSourceText,/u, 'เทียบข้อเท็จจริงกับเนื้อดิบตัวเดียวกับด่าน grounding');
  assert.match(block, /extractFacts: extractSourceFactsDetailed,/u, '★ ข้อแก้ ①: ฉีดตัวสกัดรายการข้อเท็จจริง (จาก missingFactsGate ตัวเดียวกัน)');
  assert.match(block, /\{ findMissingFacts, extractSourceFactsDetailed \}/u, 'destructure จาก dynamic import เดิม — ไม่เพิ่ม import ใหม่');
  assert.match(block, /model: MODEL_FAST_CHEAP,/u, 'ใช้โมเดลถูก (luna)');
  assert.match(block, /withTimeoutSignal\([\s\S]*?25_000, 'writer_trim_pass', _trimDeadline\?\.signal,/u, 'งบ 25s ใต้ pipeline deadline เดิม');
  assert.match(block, /remainingMs\(\) < 60_000/u, 'งบท่อเหลือน้อยต้องข้าม ไม่เบียดด่านแก้ไข');
  assert.match(block, /rethrowPipelineDeadline\(trimErr, 'writer_trim_pass'\)/u);
  assert.match(block, /allVersions\[index\] = version;/u, 'ผลตัดต้องแทนที่ร่างก่อนเข้าด่านแก้ไข');
  assert.doesNotMatch(AUTO_FLOW, /^import .*writerTrimPass/mu, 'ห้ามเพิ่ม static import ในไฟล์ที่เทสสตับโหลด');
  const entry = findSwitch('WRITER_TRIM_PASS');
  assert.equal(entry?.default, '0');
  assert.deepEqual(entry?.readBy, ['src/lib/services/autoFlowServiceText.js']);
});

test('mutation oracle: ย้ายจุดต่อสายไปหลัง correction แล้วข้อสอบ wiring ต้องแดง', () => {
  const gateLine = "if (process.env.WRITER_TRIM_PASS === '1') {";
  const gate = AUTO_FLOW.indexOf(gateLine);
  const correction = AUTO_FLOW.indexOf('finalVersions = await runCorrectionPipeline(');
  const moved = AUTO_FLOW.slice(0, gate) + AUTO_FLOW.slice(correction) + AUTO_FLOW.slice(gate, correction);
  assert.notEqual(moved, AUTO_FLOW);
  assert.throws(() => {
    const g = moved.indexOf(gateLine);
    const c = moved.indexOf('finalVersions = await runCorrectionPipeline(');
    assert.ok(g < c, 'trim pass ต้องอยู่ก่อน runCorrectionPipeline');
  });
});

// ★ ข้อแก้ ①: ทุบสำเนาโมดูลจริง (data: URL — ไฟล์ไม่มี import จึงโหลดตรงได้) แล้วข้อสอบใหม่ต้องแดง
const TRIM_PATH = join(ROOT, 'src', 'lib', 'services', 'writerTrimPass.js');
async function loadTrimModule(mutate = (source) => source) {
  const source = mutate(readFileSync(TRIM_PATH, 'utf8').replace(/\r\n/g, '\n'));
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}-${Math.random()}`);
}

test('mutation oracle ★ ข้อแก้ ①: ถอดด่านกลไก (M8) / ถอด fallback รายการ (M9) แล้วข้อสอบใหม่ต้องแดง', async () => {
  const intact = await loadTrimModule();
  const quoteSentence = ' เขาบอกว่า “ผมไม่เคยขึ้นราคาเพราะอยากให้ทุกคนได้กิน”';
  const cutQuote = `${FACTS.replace(quoteSentence, '')}\n\n${filler(165, 'น้ำ')}`;
  const runCutQuote = async (mod) => mod.trimIfTooLong(baseVersion(), deps({ callAI: mockAI({ content: cutQuote }).callAI }));
  assert.equal((await runCutQuote(intact))._trimPass.reason, 'protected_sentence_cut', 'สำเนาไม่ทุบต้องเหมือนของจริง');

  const noMechanicalGate = await loadTrimModule((source) => {
    const mutated = source.replace('const cutProtected = protectedSentences.filter((s) => !normNext.includes(s.norm));', 'const cutProtected = [];');
    assert.notEqual(mutated, source, 'mutation M8 ต้องเกิดจริง');
    return mutated;
  });
  await assert.rejects(async () => {
    const out = await runCutQuote(noMechanicalGate);
    assert.equal(out._trimPass.reason, 'protected_sentence_cut');
  }, 'M8: ถอดด่านกลไกแล้ว reason ต้องเพี้ยน (ข้อสอบด่านกลไกจับได้)');

  const noFallback = await loadTrimModule((source) => {
    const mutated = source.replace("if (typeof findMissingFacts === 'function') {", 'if (false) {');
    assert.notEqual(mutated, source, 'mutation M9 ต้องเกิดจริง');
    return mutated;
  });
  await assert.rejects(async () => {
    const { callAI, calls } = mockAI({ content: `${FACTS}\n\n${filler(160, 'น้ำ')}` });
    await noFallback.trimIfTooLong(baseVersion(), deps({ callAI }));
    assert.match(calls[0].prompt, /=== 📌 รายการข้อเท็จจริงที่ห้ามหาย/u);
  }, 'M9: ถอด fallback แล้วหมวดรายการต้องหาย (ข้อสอบ fallback จับได้)');
});
