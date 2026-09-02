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
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FACT_CHECK_MAX_MISSING,
  TRIM_PASS_DEFAULTS,
  buildTrimPrompt,
  countThaiWordsDefault,
  missingFactKeys,
  pickTrimmedContent,
  trimIfTooLong,
} from '../src/lib/services/writerTrimPass.js';
import { findMissingFacts } from '../src/lib/correction/missingFactsGate.js';
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
  assert.deepEqual(out._trimPass, { before: countWords(LONG), after: countWords(shorter), applied: true, reason: 'trimmed', originalChars: LONG.length });
  assert.ok(out._trimPass.after < out._trimPass.before);
  for (const key of ['title', 'hook', 'closing', 'style', 'usedModel', 'promptId', '_source', '_sourceLabel', '_rawModelDraft']) {
    assert.equal(out[key], version[key], `provenance/ช่อง ${key} ต้องคงเดิม`);
  }
  assert.equal(version.content, LONG, 'ห้ามแก้ object เดิม');
});

test('ผลทำข้อเท็จจริงหาย (findMissingFacts เทียบเนื้อดิบ) = ทิ้งผล ใช้ต้นฉบับ พร้อมรายการที่หาย', async () => {
  const lostNumber = `${FACTS.replace('ชามละ 20 บาท', 'ชามละราคาเดิม')}\n\n${filler(160, 'น้ำ')}`;
  const { callAI, calls } = mockAI({ content: lostNumber });
  const version = baseVersion();
  const out = await trimIfTooLong(version, deps({ callAI }));
  assert.equal(calls.length, 1);
  assert.equal(out.content, LONG, 'ต้องคืนต้นฉบับ');
  assert.equal(out._trimPass.applied, false);
  assert.equal(out._trimPass.reason, 'facts_lost');
  assert.ok(out._trimPass.lost.some((item) => /20 บาท/u.test(item)), `ต้องบอกว่าอะไรหาย: ${JSON.stringify(out._trimPass.lost)}`);
  assert.equal(out._trimPass.before, countWords(LONG));
  assert.equal(out._trimPass.after, countWords(lostNumber));

  // ของที่ต้นฉบับนักเขียนทิ้งไปตั้งแต่แรก (หายอยู่แล้ว) ไม่นับเป็น "หายเพิ่ม" — ด่านนี้จับเฉพาะที่ตัดทิ้งเพิ่ม
  const alreadyMissing = { ...baseVersion(), content: `${FACTS.replace('ชามละ 20 บาท', 'ชามละราคาเดิม')}\n\n${filler(230, 'น้ำ')}` };
  const stillMissing = `${FACTS.replace('ชามละ 20 บาท', 'ชามละราคาเดิม')}\n\n${filler(160, 'น้ำ')}`;
  const second = mockAI({ content: stillMissing });
  const out2 = await trimIfTooLong(alreadyMissing, deps({ callAI: second.callAI }));
  assert.equal(out2._trimPass.applied, true, 'ของที่หายอยู่แล้วก่อนตัดต้องไม่บล็อกการตัด');
  assert.ok(missingFactKeys(findMissingFacts(RAW, alreadyMissing.content)).size >= 1, 'กรณีนี้ต้องมีของหายอยู่ก่อนจริง');
});

test('ร่างที่ขาดอยู่ก่อน ≥ 21 รายการ (ข่าว URL ตัวเลขเยอะ) + ผลตัดทิ้งชื่อ/คำพูด = facts_lost — ค่าเริ่มต้น maxMissing 20 ของ findMissingFacts ห้ามซ่อนของหาย (ผู้ตรวจไขว้ 2 ก.ย. 69)', async () => {
  const numbers = Array.from({ length: 25 }, (_, i) => `${101 + i} บาท`).join(' ');
  const rawMany = `นายสมชาย ใจดี อายุ 45 ปี ขายก๋วยเตี๋ยว เขาบอกว่า “ผมไม่เคยขึ้นราคาเพราะอยากให้ทุกคนได้กิน” ราคาสินค้าในตลาด ${numbers} ที่ตลาดบางกะปิ`;
  const kept = 'นายสมชาย ใจดี อายุ 45 ปี ขายก๋วยเตี๋ยว เขาบอกว่า “ผมไม่เคยขึ้นราคาเพราะอยากให้ทุกคนได้กิน” ที่ตลาดบางกะปิ';
  const draft = `${kept}\n\n${filler(230, 'น้ำ')}`; // > 220 คำ และขาดตัวเลข 25 ตัวอยู่ก่อนแล้ว (นักเขียนทิ้งเอง)
  const droppedNameQuote = `อายุ 45 ปี ขายก๋วยเตี๋ยว ที่ตลาดบางกะปิ\n\n${filler(170, 'น้ำ')}`; // luna ตัดชื่อ + คำพูดทิ้งเพิ่ม
  assert.ok(countWords(draft) > TRIM_PASS_DEFAULTS.maxWords && countWords(droppedNameQuote) >= TRIM_PASS_DEFAULTS.minWords, 'ตัวอย่างต้องเข้าเงื่อนไขยิงและไม่สั้นเกิน');

  // เงื่อนไขของรู (กันข้อสอบหลอกตัวเอง): ค่าเริ่มต้นของ findMissingFacts ชนเพดาน 20 จริง และชื่อ/คำพูดที่หายตกนอก 20 อันดับแรก
  const defaultReport = findMissingFacts(rawMany, droppedNameQuote);
  assert.equal(defaultReport.missing.length, 20, `เคสนี้ต้องชนเพดาน 20 ของด่าน (truncated=${defaultReport.truncated})`);
  assert.ok(defaultReport.truncated >= 1, 'รายงานค่าเริ่มต้นต้องถูกตัดจริง');
  assert.ok(!defaultReport.missing.some((m) => m.type === 'name' || m.type === 'quote'), 'ชื่อ/คำพูดที่หายต้องไม่อยู่ใน 20 อันดับแรก (นี่คือรู)');
  const fullReport = findMissingFacts(rawMany, droppedNameQuote, { maxMissing: FACT_CHECK_MAX_MISSING });
  assert.ok(!fullReport.truncated && fullReport.missing.some((m) => m.type === 'name') && fullReport.missing.some((m) => m.type === 'quote'), 'เทียบเต็มต้องเห็นชื่อ+คำพูดหาย');

  const { callAI, calls } = mockAI({ content: droppedNameQuote });
  const out = await trimIfTooLong({ ...baseVersion(), content: draft }, deps({ raw: rawMany, callAI }));
  assert.equal(calls.length, 1);
  assert.equal(out.content, draft, 'ต้องคืนต้นฉบับ');
  assert.equal(out._trimPass.applied, false);
  assert.equal(out._trimPass.reason, 'facts_lost');
  assert.ok(out._trimPass.lost.some((item) => item.startsWith('name:สมชาย')), `ต้องบอกว่าชื่อหาย: ${JSON.stringify(out._trimPass.lost)}`);
  assert.ok(out._trimPass.lost.some((item) => item.startsWith('quote:ผมไม่เคยขึ้นราคา')), `ต้องบอกว่าคำพูดหาย: ${JSON.stringify(out._trimPass.lost)}`);

  // ทางกลับ: ขาดอยู่ก่อน ≥ 21 รายการเหมือนกัน แต่ผลตัดคงชื่อ/คำพูด/ตัวเลขที่เหลือครบ → ต้องยังตัดได้ (ของที่หายอยู่แล้วไม่บล็อก แม้เกิน 20)
  const cleanTrim = `${kept}\n\n${filler(160, 'น้ำ')}`;
  const ok = await trimIfTooLong({ ...baseVersion(), content: draft }, deps({ raw: rawMany, callAI: mockAI({ content: cleanTrim }).callAI }));
  assert.equal(ok._trimPass.applied, true, `ของที่หายอยู่ก่อน (แม้ > 20 รายการ) ต้องไม่บล็อกการตัด: ${JSON.stringify(ok._trimPass)}`);
  assert.equal(ok.content, cleanTrim);
});

test('รายงาน findMissingFacts ถูกตัด (truncated) = ตรวจไม่ครบ → ทิ้งผล reason=fact_check_truncated · ต้องขอรายการเต็มทั้ง 2 รอบ · เห็นของหายแน่ๆ ให้ facts_lost นำ', async () => {
  const shorter = `${FACTS}\n\n${filler(160, 'น้ำ')}`;
  const seenOpts = [];
  const truncating = (raw, out, opts) => { seenOpts.push(opts); return { missing: [], checked: 30, coverage: 1, byType: {}, truncated: 3 }; };
  const out = await trimIfTooLong(baseVersion(), deps({ callAI: mockAI({ content: shorter }).callAI, findMissingFacts: truncating }));
  assert.equal(out.content, LONG, 'ตรวจไม่ครบต้องคืนต้นฉบับ');
  assert.equal(out._trimPass.applied, false);
  assert.equal(out._trimPass.reason, 'fact_check_truncated');
  assert.equal(out._trimPass.truncated, 6, 'นับรวมที่ถูกตัดทั้งรอบร่างเดิมและรอบผลตัด');
  assert.equal(seenOpts.length, 2, 'เทียบ 2 รอบ: ร่างเดิม + ผลตัด');
  for (const opts of seenOpts) assert.equal(opts?.maxMissing, FACT_CHECK_MAX_MISSING, 'ต้องขอรายการเต็มทั้งรอบร่างเดิมและรอบผลตัด');
  assert.ok(Number.isInteger(FACT_CHECK_MAX_MISSING) && FACT_CHECK_MAX_MISSING >= 1000, 'เพดานต้องใหญ่กว่าจำนวนข้อเท็จจริงในข่าวจริงมาก');

  // ถูกตัดด้วย + เห็นชื่อหายแน่ๆ ในรอบผลตัด → facts_lost (ข้อมูลชัดกว่า) แต่ยังทิ้งผลเหมือนกัน
  let round = 0;
  const truncatingWithLoss = () => ({ missing: round++ === 0 ? [] : [{ type: 'name', text: 'สมชาย' }], truncated: 1 });
  const lost = await trimIfTooLong(baseVersion(), deps({ callAI: mockAI({ content: shorter }).callAI, findMissingFacts: truncatingWithLoss }));
  assert.equal(lost.content, LONG);
  assert.deepEqual([lost._trimPass.applied, lost._trimPass.reason, lost._trimPass.lost], [false, 'facts_lost', ['name:สมชาย']]);
});

test('ผลสั้นกว่า 146 คำ = ทิ้งผล ใช้ต้นฉบับ', async () => {
  const tooShort = `${FACTS}\n\n${filler(100, 'น้ำ')}`; // ≈ 120 คำ
  const { callAI } = mockAI({ content: tooShort });
  const out = await trimIfTooLong(baseVersion(), deps({ callAI }));
  assert.equal(out.content, LONG);
  assert.deepEqual(out._trimPass, { before: countWords(LONG), after: countWords(tooShort), applied: false, reason: 'too_short' });
  assert.ok(countWords(tooShort) < 146);
});

test('ผลไม่สั้นลง / ตอบว่าง / ไม่มี callAI = ทิ้งผล ใช้ต้นฉบับ (เหตุผลระบุชัด)', async () => {
  const longer = `${LONG}\n\n${filler(20, 'เพิ่ม')}`;
  const notShorter = await trimIfTooLong(baseVersion(), deps({ callAI: mockAI({ content: longer }).callAI }));
  assert.equal(notShorter.content, LONG);
  assert.equal(notShorter._trimPass.reason, 'not_shorter');

  const empty = await trimIfTooLong(baseVersion(), deps({ callAI: mockAI({}).callAI }));
  assert.equal(empty.content, LONG);
  assert.deepEqual(empty._trimPass, { before: countWords(LONG), after: countWords(LONG), applied: false, reason: 'empty_result' });

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
