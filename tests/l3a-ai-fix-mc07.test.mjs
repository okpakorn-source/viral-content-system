// 🔏 ข้อสอบ L3A fixSentenceWithAI — อ่านผล callAI ที่เป็น object จริง + ด่านตรวจผลก่อนใช้ + สวิตช์ L3A_AI_FIX (MC-07 / PL-12) — src/lib/correction/safeCorrectionService.js
// ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S5 · เจ้าของอนุมัติ)
//
// บั๊กที่ปิด: ของเดิมเช็ค `typeof result === 'string'` แต่ callAI (openai.js) บังคับ json_object + JSON.parse → คืน object เสมอ → L3A ทิ้งผลทุกครั้งตั้งแต่ 1 มิ.ย. 69
//   (จ่าย luna 1 ครั้ง/วลี · ล้มถอย terra อีก 1 · maxTokens 200 กับโมเดล reasoning เสี่ยงตอบว่าง) — L3B ซ่อมสัญญาเดียวกัน 14 ส.ค. แต่ L3A ตกหล่น
//
// สิ่งที่ล็อกไว้:
//   A. สวิตช์ L3A_AI_FIX: ไม่ตั้ง/1/on/true/yes/ค่าอื่น = ใช้ผล AI จริง (ค่าเริ่มต้น) · 0/off/false/no = ไม่เรียก AI เลย (ไม่จ่ายเงิน · ผลเท่าของเดิมทุกไบต์
//      เพราะของเดิมไม่เคยแก้อะไรได้) · legacy = โค้ดเดิมทุกไบต์ (เรียก AI พรอมต์เดิม maxTokens 200 แล้วทิ้งผล object เพราะเช็ค typeof string)
//   B. สัญญาผล callAI (ค่าเริ่มต้น): {sentence} → ใช้จริง (ai_sentence_fix) · สตริง → ใช้จริง (สัญญาเดิม) · object ที่มีสตริงเดียวไม่กำกวม → ใช้ ·
//      {} / null / {sentence:''} / {sentence:{…}} / 2 สตริง / {_error} / โยน error → คงประโยคเดิม ไม่ล้ม ไม่มี ai_sentence_fix
//   C. ด่านตรวจผล validateL3aFix (ไม่เพิ่มข้อเท็จจริง): วลีหลักต้องหาย · ยาวไม่เกิน 120% · ไม่หดต่ำกว่า 60% · ชุดตัวเลขเท่าเดิมเป๊ะ (ไม่หาย/ไม่เพิ่ม/ไม่เปลี่ยน) ·
//      ไม่เพิ่มคำเสี่ยง (ตารางกลาง) · ไม่ขึ้นบรรทัดใหม่ · คำใหม่ไม่เกินเพดาน (Intl.Segmenter) · ไม่ผ่าน = เนื้อคงเดิมผ่าน safeCorrect จริง
//   D. พรอมต์/ค่าเรียก: ค่าเริ่มต้นสั่งตอบ {"sentence": …} + แจ้งทุกวลีในประโยคเดียวกัน + maxTokens ≥ 1000 · legacy = พรอมต์เดิมทุกไบต์ + maxTokens 200 + temperature 0.1
//   E. ต้นทุน: วลีหลายตัวในย่อหน้าเดียว = เรียก 1 ครั้ง (ไม่ใช่ 1 ครั้ง/วลี) · 2 ย่อหน้า = 2 ครั้ง · off = 0 ครั้ง · legacy = 1 ครั้ง/วลี (พฤติกรรมเดิม)
//   F. ปลายน้ำจริง: L2 (auditOutput จริง) → L3 (safeCorrect จริง) ข่าวไทย 4 กลุ่ม (อาชญากรรม/อุบัติเหตุ/ราชาศัพท์/สถานที่) — ค่าเริ่มต้นวลี AI หายหมด
//      (re-audit ไม่เหลือ ai_wording) ตัวเลขครบ · off/legacy คงเดิม
//
// วิธีรัน:  node --test tests/l3a-ai-fix-mc07.test.mjs
// โหมดกลายพันธุ์ (พิสูจน์ว่าข้อสอบกัดจริง — เทสต้องแดง · แก้เฉพาะสำเนาในหน่วยความจำ ไม่แตะไฟล์ใน repo):
//   L3A_TEST_MUTATION=typeof-string     กลับไปรับเฉพาะ typeof result === 'string' (บั๊ก MC-07/PL-12 กลับมา — ผล object ถูกทิ้ง)
//   L3A_TEST_MUTATION=no-validate       ด่านตรวจผลรับทุกอย่าง (AI เพิ่มข้อเท็จจริง/คำเสี่ยงได้)
//   L3A_TEST_MUTATION=no-number-check   ไม่ตรวจตัวเลข (AI เปลี่ยน/เพิ่ม/ลบเลขได้)
//   L3A_TEST_MUTATION=no-off-switch     L3A_AI_FIX=0 ไม่ปิดการเรียก AI (จ่ายเงินทั้งที่สั่งปิด)
//   L3A_TEST_MUTATION=no-legacy-switch  L3A_AI_FIX=legacy ไม่ได้โค้ดเดิม (พรอมต์/maxTokens ใหม่)
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { importPatchedModule } from './helpers/temp-module.mjs';

const MUTATION = process.env.L3A_TEST_MUTATION || '';
const KNOWN_MUTATIONS = ['typeof-string', 'no-validate', 'no-number-check', 'no-off-switch', 'no-legacy-switch'];
if (MUTATION && !KNOWN_MUTATIONS.includes(MUTATION)) throw new Error('ไม่รู้จัก mutation: ' + MUTATION);
if (MUTATION) console.log(`🧬 MUTATION ACTIVE: ${MUTATION} — ข้อสอบชุดนี้ต้องแดงจึงจะถือว่ากัดจริง`);

const srcUrl = (rel) => new URL(rel, import.meta.url);
const readSrc = (rel) => readFileSync(srcUrl(rel), 'utf8').replace(/\r\n/g, '\n');
const mustReplace = (src, from, to, label) => {
  const out = src.replace(from, to);
  if (out === src) throw new Error('replace ไม่เกิดผล: ' + label);
  return out;
};
const withEnv = async (name, value, fn) => {
  const prior = process.env[name];
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
  try { return await fn(); } finally { if (prior === undefined) delete process.env[name]; else process.env[name] = prior; }
};
const quiet = async (fn) => {
  const prior = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = prior.log; console.warn = prior.warn; console.error = prior.error; }
};

// ── โหลดซอร์สจริง (L3 safeCorrect · L2 audit — stub เฉพาะ AI/modelConfig/flagFixer เหมือน tests/l3b-contract) ──
let correctSource = readSrc('../src/lib/correction/safeCorrectionService.js');
let auditSource = readSrc('../src/lib/correction/outputAuditService.js');
auditSource = mustReplace(auditSource, "import { callAI } from '@/lib/ai/openai';", "const callAI = async () => { throw new Error('AI-mock (audit ไม่ควรเรียก)'); };", 'audit stub openai');
correctSource = mustReplace(correctSource, "import { callAI } from '@/lib/ai/openai';", 'const callAI = async (args) => globalThis.__L3A_AI__(args);', 'correct stub openai');
correctSource = mustReplace(correctSource, "import { MODEL_FAST } from '@/lib/ai/modelConfig';", "const MODEL_FAST = 'mock-luna';", 'correct stub modelConfig');
correctSource = mustReplace(correctSource, "import { keyNumbersOf, hasKeyNumber } from './flagFixerService';",
  'const keyNumbersOf = () => []; const hasKeyNumber = () => true;', 'correct stub flagFixer');

if (MUTATION === 'typeof-string') {
  correctSource = mustReplace(correctSource, 'const verdict = validateL3aFix(sentence, pickL3aSentence(result), list);',
    "const verdict = validateL3aFix(sentence, typeof result === 'string' ? result : null, list);", 'typeof-string');
} else if (MUTATION === 'no-validate') {
  correctSource = mustReplace(correctSource, 'const reject = (reason) => ({ ok: false, fixed: null, reason });',
    "const reject = () => ({ ok: true, fixed: String(candidate || '').trim(), reason: null });", 'no-validate');
} else if (MUTATION === 'no-number-check') {
  correctSource = mustReplace(correctSource, "if (l3aNumbers(fixed) !== l3aNumbers(original)) return reject('ตัวเลขไม่ตรงต้นฉบับ (หาย/เพิ่ม/เปลี่ยน)');", '/* mutated */', 'no-number-check');
} else if (MUTATION === 'no-off-switch') {
  correctSource = mustReplace(correctSource, "if (mode === 'off') {", 'if (false) {', 'no-off-switch');
} else if (MUTATION === 'no-legacy-switch') {
  correctSource = mustReplace(correctSource, "if (mode === 'legacy') return fixSentenceWithAILegacy(sentence, issue);", '/* mutated */', 'no-legacy-switch');
}

const { safeCorrect, l3aAiFixMode, validateL3aFix, extractSentence } = await importPatchedModule(correctSource, srcUrl('../src/lib/correction/safeCorrectionService.js'), 'l3a-under-test');

// extractSentence เดิมทุกไบต์ (ก่อน S5) — ไว้คำนวณ "ประโยค" ที่โหมด legacy ต้องส่งให้ AI (นับ '.' ทุกตัวเป็นจุดจบประโยค → "สน.บางนา" ถูกตัดเป็น "บางนา …")
function legacyExtract(content, phrase) {
  const idx = content.indexOf(phrase);
  if (idx === -1) return null;
  let start = idx;
  while (start > 0 && content[start - 1] !== '\n' && content[start - 1] !== '.' && content[start - 1] !== '。') start--;
  let end = idx + phrase.length;
  while (end < content.length && content[end] !== '\n' && content[end] !== '.' && content[end] !== '。') end++;
  return content.substring(start, end + 1).trim();
}
const { auditOutput } = await importPatchedModule(auditSource, srcUrl('../src/lib/correction/outputAuditService.js'), 'audit-s5');

// ── AI ปลอม (จดทุกคำขอ) ──
const calls = [];
const setAI = (fn) => { globalThis.__L3A_AI__ = async (args) => { calls.push(args); return fn(args); }; };
const resetCalls = () => { calls.length = 0; };
const aiThrow = () => setAI(() => { throw new Error('mock-ai-down'); });
const sentenceFromPrompt = (args) => (args.prompt.match(/ประโยคเดิม: ([^\n]*)/u) || [])[1] || '';
// ตัวเกลาจำลอง (deterministic): ถอด/เปลี่ยนวลี AI ตามตาราง — ไม่แตะตัวเลข/ชื่อ/ราชาศัพท์
const EDIT_TABLE = [
  ['ซึ่งถือเป็น', 'ซึ่งเป็น'], ['ถือเป็น', 'เป็น'], ['นับว่า', ''], ['ทั้งนี้ ', ''], ['ทั้งนี้', ''], ['ดังกล่าว', 'นี้'],
  ['อย่างไรก็ตาม ', 'แต่'], ['อย่างไรก็ตาม', 'แต่'], ['ได้มีการ', 'ได้'], ['สะท้อนให้เห็นถึง', 'ทำให้เห็น'], ['เรียกได้ว่า', ''], ['ในส่วนของ', 'ส่วน'],
];
const mockEdit = (s) => { let out = s; for (const [a, b] of EDIT_TABLE) out = out.split(a).join(b); return out.replace(/  +/g, ' ').trim(); };
const aiEditor = () => setAI((args) => ({ sentence: mockEdit(sentenceFromPrompt(args)) }));
aiThrow();

const wording = (text) => ({ type: 'ai_wording', text, location: 0, severity: 'medium', suggestion: 'ลบหรือเปลี่ยนเป็นภาษาคนพูดจริง' });
// mode: 'default' = ไม่ตั้ง env · ค่าอื่น = ค่า L3A_AI_FIX ตรงตัว
const run = (mode, content, issues) => withEnv('L3A_AI_FIX', mode === 'default' ? undefined : mode, () => quiet(() => safeCorrect(content, issues)));
const auditIssues = async (content) => (await quiet(() => auditOutput({ content }))).issues;
const numbersOf = (t) => (t.match(/[0-9๐-๙]+(?:[.,:][0-9๐-๙]+)*/g) || []).sort().join(' ');

// ข่าวอาชญากรรม ย่อหน้าเดียว มีวลี AI 3 ตัวซ้อนกัน (ถือเป็น อยู่ใน ซึ่งถือเป็น) + เลข 34/3/2
const CRIME = 'ตำรวจ สน.บางนา จับกุมชายวัย 34 ปี ผู้ต้องสงสัยชิงทรัพย์ร้านทอง 3 ร้านภายใน 2 สัปดาห์ ได้ที่บ้านพักย่านบางนา ทั้งนี้ ผู้ต้องหาให้การรับสารภาพแล้ว ซึ่งถือเป็นคดีที่ชาวบ้านจับตามากที่สุดในรอบปี';
const CRIME_ISSUES = [wording('ถือเป็น'), wording('ทั้งนี้'), wording('ซึ่งถือเป็น')];
const OLD_PROMPT = (sentence, phrase) => `แก้ประโยคนี้ให้เป็นภาษาคนพูดจริงบน Facebook โดยรักษาความหมายเดิม
ห้ามเปลี่ยน fact ห้ามเพิ่มอารมณ์ ห้ามเปลี่ยนโทน ห้ามยาวกว่าเดิม

ประโยคเดิม: ${sentence}
ปัญหา: พบคำที่ฟังเหมือน AI "${phrase}"

ตอบเฉพาะประโยคที่แก้แล้ว ไม่ต้องอธิบาย ไม่ต้องใส่เครื่องหมายคำพูด`;

// ═══ A) สวิตช์ ═══
test('A1 ค่าสวิตช์ L3A_AI_FIX: ไม่ตั้ง/1/on/true/yes/ค่าอื่น = on · 0/off/false/no (ทนช่องว่าง/อัญประกาศ/ตัวพิมพ์) = off · legacy = legacy', async () => {
  for (const v of [undefined, '', '1', 'on', 'true', 'yes', ' ON ', '"1"', 'new', '2']) {
    await withEnv('L3A_AI_FIX', v, () => assert.equal(l3aAiFixMode(), 'on', `ต้อง on: ${JSON.stringify(v)}`));
  }
  for (const v of ['0', 'off', 'false', 'no', ' 0 ', '"off"', 'OFF', "'false'"]) {
    await withEnv('L3A_AI_FIX', v, () => assert.equal(l3aAiFixMode(), 'off', `ต้อง off: ${JSON.stringify(v)}`));
  }
  for (const v of ['legacy', 'LEGACY', ' legacy ', '"legacy"']) {
    await withEnv('L3A_AI_FIX', v, () => assert.equal(l3aAiFixMode(), 'legacy', `ต้อง legacy: ${JSON.stringify(v)}`));
  }
});

// ═══ B) สัญญาผล callAI (ค่าเริ่มต้น) ═══
test('B1 ค่าเริ่มต้น: callAI คืน {sentence} → ใช้จริง (ai_sentence_fix) วลี AI หายทั้ง 3 · เลขครบ · rollbackContent = ต้นฉบับ · เรียก 1 ครั้ง (3 วลีย่อหน้าเดียว)', async () => {
  resetCalls(); aiEditor();
  const r = await run('default', CRIME, CRIME_ISSUES);
  assert.equal(calls.length, 1, 'วลี 3 ตัวในย่อหน้าเดียว = เรียก AI 1 ครั้ง');
  assert.equal(r.correctedContent, mockEdit(CRIME));
  assert.doesNotMatch(r.correctedContent, /ทั้งนี้|ถือเป็น/u);
  assert.equal(numbersOf(r.correctedContent), numbersOf(CRIME));
  assert.equal(r.rollbackContent, CRIME);
  assert.deepEqual(r.corrections.map((c) => c.type), ['ai_sentence_fix']);
  assert.equal(r._coreGuard, 'passed');
});

test('B2 ค่าเริ่มต้น: callAI คืนสตริง (สัญญาเดิม) → ยังใช้จริง', async () => {
  resetCalls(); setAI((args) => mockEdit(sentenceFromPrompt(args)));
  const r = await run('default', CRIME, CRIME_ISSUES);
  assert.equal(calls.length, 1);
  assert.equal(r.correctedContent, mockEdit(CRIME));
  assert.deepEqual(r.corrections.map((c) => c.type), ['ai_sentence_fix']);
});

test('B3 รูปผลอื่น: object สตริงเดียว key อื่น = ใช้ · 2 สตริง/{}/null/{sentence:""}/{sentence:{…}}/{_error}/array/โยน error = คงเดิม ไม่ล้ม', async () => {
  const cases = [
    ['object สตริงเดียว key อื่น', (s) => ({ fixed: mockEdit(s) }), true],
    ['object 2 สตริง (กำกวม)', (s) => ({ a: mockEdit(s), b: mockEdit(s) }), false],
    ['{}', () => ({}), false],
    ['null', () => null, false],
    ['{sentence:""}', () => ({ sentence: '' }), false],
    ['{sentence:{nested}}', (s) => ({ sentence: { nested: mockEdit(s) } }), false],
    ['{_error: สตริง}', (s) => ({ _error: mockEdit(s) }), false],
    ['array', (s) => [mockEdit(s)], false],
  ];
  for (const [label, make, expectChanged] of cases) {
    resetCalls(); setAI((args) => make(sentenceFromPrompt(args)));
    const r = await run('default', CRIME, [wording('ทั้งนี้')]);
    assert.equal(r.correctedContent !== CRIME, expectChanged, `${label}: changed ต้องเป็น ${expectChanged}`);
    assert.equal(r.corrections.some((c) => c.type === 'ai_sentence_fix'), expectChanged, `${label}: ai_sentence_fix`);
    assert.equal(r.rollbackContent, CRIME, label);
  }
  resetCalls(); aiThrow();
  const r = await run('default', CRIME, [wording('ทั้งนี้')]);
  assert.equal(calls.length, 1);
  assert.equal(r.correctedContent, CRIME, 'AI โยน error → คงเดิม');
  assert.deepEqual(r.corrections, []);
});

// ═══ C) ด่านตรวจผล ═══
const SENT = 'ทั้งนี้ ตำรวจยึดของกลางได้ 12 รายการ มูลค่ารวม 350,000 บาท จากบ้านพักของผู้ต้องหาย่านลาดพร้าว';
const SENT_OK = 'ตำรวจยึดของกลางได้ 12 รายการ มูลค่ารวม 350,000 บาท จากบ้านพักของผู้ต้องหาย่านลาดพร้าว';
const BAD_FIXES = [
  ['ยาวเกิน 120%', SENT_OK + ' และตำรวจยังพบว่าผู้ต้องหาเคยมีประวัติก่อเหตุลักษณะเดียวกันในหลายพื้นที่มาก่อน', /ยาวขึ้น/u],
  ['หดต่ำกว่า 60%', 'ตำรวจยึดของกลาง', /หดเหลือ/u],
  ['เลขหาย', SENT_OK.replace('12 รายการ', 'หลายรายการ'), /ตัวเลขไม่ตรง/u],
  ['เลขเปลี่ยน', SENT_OK.replace('350,000', '450,000'), /ตัวเลขไม่ตรง/u],
  ['เลขเพิ่ม', SENT_OK.replace('จากบ้านพัก', 'จากบ้านพัก 2 หลัง'), /ตัวเลขไม่ตรง/u],
  ['เพิ่มคำเสี่ยง (ฆาตกรรม)', SENT_OK.replace('ยึดของกลาง', 'พบหลักฐานฆาตกรรม'), /เพิ่มคำเสี่ยง "ฆาตกรรม"/u],
  ['วลีหลักยังอยู่', SENT.replace('ยึด', 'ตรวจยึด'), /ยังอยู่/u],
  ['ขึ้นบรรทัดใหม่', SENT_OK.replace(' มูลค่า', '\nมูลค่า'), /ขึ้นบรรทัดใหม่/u],
  ['คำใหม่เกินเพดาน (แต่งข้อเท็จจริงใหม่)', SENT_OK.replace('จากบ้านพักของผู้ต้องหาย่านลาดพร้าว', 'จากคอนโดหรูของนักธุรกิจชื่อดังกลางเมือง'), /คำใหม่ .* เกินเพดาน/u],
  ['ว่างเปล่า', '   ', /ว่างเปล่า/u],
  ['ประโยคเดิม', SENT, /ประโยคเดิม/u],
];

test('C1 validateL3aFix ตรง: ผลดี = ok · ผลเพี้ยน 11 แบบ = ทิ้งพร้อมเหตุผล · ไม่ใช่สตริง = ทิ้ง', () => {
  const good = validateL3aFix(SENT, SENT_OK, ['ทั้งนี้']);
  assert.deepEqual(good, { ok: true, fixed: SENT_OK, reason: null });
  assert.equal(validateL3aFix(SENT, `  ${SENT_OK}  `, ['ทั้งนี้']).fixed, SENT_OK, 'trim ช่องว่างหัวท้าย');
  assert.equal(validateL3aFix(SENT, SENT_OK.replace('ผู้ต้องหา', 'ชายคนดังกล่าว').replace('ดังกล่าว', 'นี้'), ['ทั้งนี้']).ok, true, 'เกลาคำเล็กน้อย (คำใหม่ ≤ เพดาน) ผ่าน');
  for (const [label, candidate, re] of BAD_FIXES) {
    const v = validateL3aFix(SENT, candidate, ['ทั้งนี้']);
    assert.equal(v.ok, false, `${label}: ต้องทิ้ง`);
    assert.equal(v.fixed, null, label);
    assert.match(v.reason, re, `${label}: เหตุผล`);
  }
  for (const bad of [null, undefined, 42, { sentence: 'x' }]) assert.equal(validateL3aFix(SENT, bad, ['ทั้งนี้']).ok, false, `ไม่ใช่สตริง: ${JSON.stringify(bad)}`);
});

test('C2 ผ่าน safeCorrect จริง: ผลเพี้ยนทุกแบบ → เนื้อคงเดิม ไม่มี ai_sentence_fix (จ่ายแล้วทิ้ง ดีกว่าข้อเท็จจริงเพี้ยน) · ผลดี → ใช้', async () => {
  for (const [label, candidate] of BAD_FIXES) {
    resetCalls(); setAI(() => ({ sentence: candidate }));
    const r = await run('default', SENT, [wording('ทั้งนี้')]);
    assert.equal(calls.length, 1, label);
    assert.equal(r.correctedContent, SENT, `${label}: เนื้อต้องคงเดิม`);
    assert.deepEqual(r.corrections, [], label);
  }
  resetCalls(); setAI(() => ({ sentence: SENT_OK }));
  const ok = await run('default', SENT, [wording('ทั้งนี้')]);
  assert.equal(ok.correctedContent, SENT_OK);
  assert.deepEqual(ok.corrections.map((c) => c.type), ['ai_sentence_fix']);
});

// ═══ D) พรอมต์/ค่าเรียก ═══
test('D1 ค่าเริ่มต้น: พรอมต์สั่งตอบ {"sentence"} + ระบุทุกวลีในประโยค + ห้ามเพิ่มข้อมูล · model = MODEL_FAST · maxTokens ≥ 1000 · ไม่มีพรอมต์เดิม', async () => {
  resetCalls(); aiEditor();
  await run('default', CRIME, CRIME_ISSUES);
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.model, 'mock-luna');
  assert.equal(c.temperature, 0.1);
  assert.ok(c.maxTokens >= 1000, `maxTokens ${c.maxTokens} ต้อง ≥ 1000 (ของเดิม 200 ตอบว่าง)`);
  assert.match(c.prompt, /\{"sentence": /u);
  assert.match(c.prompt, /ห้ามเพิ่มข้อมูล/u);
  assert.match(c.prompt, /ประโยคเดิม: /u);
  assert.equal(sentenceFromPrompt(c), CRIME);
  for (const p of ['ถือเป็น', 'ทั้งนี้', 'ซึ่งถือเป็น']) assert.ok(c.prompt.includes(`"${p}"`), `พรอมต์ต้องระบุวลี "${p}"`);
  assert.doesNotMatch(c.prompt, /ปัญหา: พบคำที่ฟังเหมือน AI/u, 'ไม่ใช่พรอมต์เดิม');
});

test('D2 L3A_AI_FIX=legacy: คำขอเดิมทุกไบต์ (พรอมต์เดิม · ประโยคตัดที่ "สน." แบบเดิม · maxTokens 200 · temperature 0.1) · 1 ครั้ง/วลี · ผล {sentence} ถูกทิ้ง (ทำซ้ำบั๊ก) · ผลสตริงยังใช้ (สัญญาเดิม)', async () => {
  resetCalls(); aiEditor();
  const r = await run('legacy', CRIME, CRIME_ISSUES);
  assert.equal(calls.length, 3, 'legacy: เรียก 1 ครั้ง/วลี (3 วลี) และไม่ได้อะไรกลับมา');
  const legacySentence = legacyExtract(CRIME, 'ถือเป็น');
  assert.ok(legacySentence.startsWith('บางนา จับกุม'), 'ของเดิมตัดประโยคที่จุดใน "สน." (บั๊กขอบประโยคเดิม — โหมดถอยต้องทำซ้ำได้)');
  assert.deepEqual(calls[0], { model: 'mock-luna', temperature: 0.1, maxTokens: 200, prompt: OLD_PROMPT(legacySentence, 'ถือเป็น') });
  assert.deepEqual(calls[1], { model: 'mock-luna', temperature: 0.1, maxTokens: 200, prompt: OLD_PROMPT(legacySentence, 'ทั้งนี้') });
  assert.deepEqual(calls[2], { model: 'mock-luna', temperature: 0.1, maxTokens: 200, prompt: OLD_PROMPT(legacySentence, 'ซึ่งถือเป็น') });
  assert.equal(r.correctedContent, CRIME, 'legacy: ผล object ถูกทิ้ง = เนื้อคงเดิม (บั๊กเดิม)');
  assert.deepEqual(r.corrections, []);
  await withEnv('L3A_AI_FIX', 'legacy', () => assert.equal(extractSentence(CRIME, 'ถือเป็น'), legacySentence, 'extractSentence โหมด legacy = ของเดิมทุกไบต์'));

  resetCalls(); setAI((args) => mockEdit(sentenceFromPrompt(args)));
  const s = await run('legacy', CRIME, CRIME_ISSUES);
  assert.equal(s.correctedContent, mockEdit(CRIME), 'legacy + สตริง = ใช้ (โค้ดเดิม)');
  assert.equal(calls.length, 1, 'วลีที่เหลือหายไปกับผลแรก → ไม่เรียกซ้ำ (extractSentence หาไม่เจอ)');
});

test('D3 ขอบประโยค (ค่าเริ่มต้น): จุดในตัวย่อ/เวลา/ทศนิยม/ชื่อย่อ (สน. จ. อ. น. 02.30 1.5 พ.ต.อ.) ไม่ใช่จุดจบประโยค · \\n และ 。 ยังตัด · จุดหลังคำไทย ≥4 ตัว+ช่องว่าง ตัด · ไม่พบวลี = null', async () => {
  await withEnv('L3A_AI_FIX', undefined, () => {
    assert.equal(extractSentence(CRIME, 'ถือเป็น'), CRIME, 'ทั้งย่อหน้า ไม่ตัดที่ "สน."');
    const t = 'เมื่อเวลา 02.30 น. รถชนกันที่ อ.เมือง จ.สุโขทัย เสียหาย 1.5 ล้านบาท พ.ต.อ. สมชาย ระบุว่า ทั้งนี้ ยังไม่สรุปสาเหตุ';
    assert.equal(extractSentence(t, 'ทั้งนี้'), t);
    assert.equal(extractSentence('ย่อหน้าแรก\nทีมวิจัยยืนยันผลแล้ว. ทั้งนี้ ต้องรอผลซ้ำ。ท่อนหลัง', 'ทั้งนี้'), 'ทั้งนี้ ต้องรอผลซ้ำ。', 'จุดหลังคำไทย ≥4 ตัว + ช่องว่าง = จบประโยค · 。 ตัด · \\n ตัด');
    assert.equal(extractSentence('ข้อ 1. ทั้งนี้ ต้องรอผล', 'ทั้งนี้'), 'ข้อ 1. ทั้งนี้ ต้องรอผล', 'จุดหลังตัวเลข (ลำดับข้อ) ไม่ตัด');
    assert.equal(extractSentence('The report is final. ทั้งนี้ ต้องรอผล', 'ทั้งนี้'), 'ทั้งนี้ ต้องรอผล', 'จุดหลังคำอังกฤษ + ช่องว่าง = จบประโยค');
    assert.equal(extractSentence('ไม่มีวลีนี้', 'ทั้งนี้'), null);
    assert.equal(legacyExtract(t, 'ทั้งนี้'), 'สมชาย ระบุว่า ทั้งนี้ ยังไม่สรุปสาเหตุ', 'ของเดิมตัดที่ "พ.ต.อ." (บั๊กที่ค่าเริ่มต้นปิด)');
  });
});

// ═══ E) ต้นทุน ═══
test('E1 L3A_AI_FIX=0/off: ไม่เรียก AI เลย (0 ครั้ง) · เนื้อคงเดิม · corrections ว่าง = ผลเท่าโหมด legacy ทุกไบต์', async () => {
  aiEditor();
  const legacyBaseline = await run('legacy', CRIME, CRIME_ISSUES);
  for (const mode of ['0', 'off', 'false', 'no']) {
    resetCalls();
    const r = await run(mode, CRIME, CRIME_ISSUES);
    assert.equal(calls.length, 0, `${mode}: ต้องไม่เรียก AI`);
    assert.equal(r.correctedContent, CRIME, mode);
    assert.deepEqual(r, legacyBaseline, `${mode}: ผลลัพธ์เท่าโหมด legacy ทุกฟิลด์`);
  }
});

test('E2 2 ย่อหน้า มีวลีคนละย่อหน้า = เรียก 2 ครั้ง (1 ครั้ง/ประโยค) · ทั้งคู่ถูกแก้ · ย่อหน้าคงโครง', async () => {
  const two = 'ย่อหน้าแรก ทั้งนี้ ตำรวจยังสอบสวนต่อ\n\nย่อหน้าสอง ซึ่งถือเป็นบทเรียนราคาแพงของทุกคน';
  resetCalls(); aiEditor();
  const r = await run('default', two, [wording('ถือเป็น'), wording('ทั้งนี้'), wording('ซึ่งถือเป็น')]);
  assert.equal(calls.length, 2);
  assert.equal(r.correctedContent, 'ย่อหน้าแรก ตำรวจยังสอบสวนต่อ\n\nย่อหน้าสอง ซึ่งเป็นบทเรียนราคาแพงของทุกคน');
  assert.equal(r.corrections.filter((c) => c.type === 'ai_sentence_fix').length, 2);
});

// ═══ F) ปลายน้ำจริง: L2 จริง → L3 จริง ═══
const STORIES = [
  ['อาชญากรรม', 'ตำรวจ สน.บางนา จับกุมชายวัย 34 ปี ผู้ต้องสงสัยชิงทรัพย์ร้านทอง 3 ร้านภายใน 2 สัปดาห์ ได้ที่บ้านพักย่านบางนา ทั้งนี้ ผู้ต้องหาให้การรับสารภาพแล้ว ซึ่งถือเป็นคดีที่ชาวบ้านจับตามากที่สุดในรอบปี\n\nเจ้าหน้าที่ยึดของกลางได้ 12 รายการ มูลค่ารวม 350,000 บาท ของกลางดังกล่าวจะนำส่งพนักงานสอบสวนต่อไป', 2],
  ['อุบัติเหตุ', 'รถกระบะเสียหลักพุ่งชนต้นไม้ริมถนนสาย 304 ช่วง อ.กบินทร์บุรี เมื่อเวลา 02.30 น. คนขับวัย 27 ปี ได้รับบาดเจ็บ ถูกนำส่งโรงพยาบาลกบินทร์บุรี อย่างไรก็ตาม เจ้าหน้าที่ระบุว่าถนนช่วงดังกล่าวมืดและไม่มีไฟส่องสว่าง นับว่าเป็นจุดเสี่ยงที่ชาวบ้านร้องเรียนมาแล้วหลายครั้ง', 1],
  ['ราชาศัพท์', 'ประชาชนกว่า 2,000 คนเฝ้ารับเสด็จ เมื่อเสด็จพระราชดำเนินไปทรงเปิดอาคารเรียนหลังใหม่ของโรงเรียนบ้านหนองแวง จ.ขอนแก่น ซึ่งถือเป็นอาคารหลังที่ 5 ที่ได้รับพระราชทาน ทั้งนี้ นักเรียน 320 คนได้เข้าใช้อาคารตั้งแต่ภาคเรียนนี้ สะท้อนให้เห็นถึงพระเมตตาที่ทรงมีต่อเด็กในถิ่นทุรกันดาร', 1],
  ['สถานที่', 'น้ำท่วมขยายวงกว้างใน อ.เมือง จ.สุโขทัย หลังฝนตกหนักต่อเนื่อง 3 วัน ระดับน้ำในถนนจรดวิถีถ่องสูงกว่า 40 เซนติเมตร ได้มีการอพยพชาวบ้าน 150 ครัวเรือนไปยังวัดคูหาสุวรรณ เรียกได้ว่าเป็นน้ำท่วมหนักสุดในรอบ 10 ปี ในส่วนของโรงเรียนในพื้นที่ประกาศปิด 4 แห่ง', 1],
];

test('F1 ท่อจริง 4 กลุ่มข่าว: L2 จับ ai_wording ≥2 · ค่าเริ่มต้น = วลีหาย re-audit ไม่เหลือ ai_wording · เลขครบ · เรียก = จำนวนย่อหน้าที่มีวลี · off = 0 ครั้ง · legacy = 1 ครั้ง/วลี คงเดิม', async () => {
  for (const [label, content, paragraphsWithPhrase] of STORIES) {
    const issues = await auditIssues(content);
    const aiIssues = issues.filter((i) => i.type === 'ai_wording');
    assert.ok(aiIssues.length >= 2, `${label}: L2 จริงต้องจับวลี AI ≥2 (ได้ ${aiIssues.map((i) => i.text).join(',')})`);
    assert.equal(issues.filter((i) => i.type === 'forbidden_word').length, 0, `${label}: ตัวอย่างต้องไม่มีคำต้องห้าม (แยกผล L3A ออกจาก L3B)`);

    resetCalls(); aiEditor();
    const fresh = await run('default', content, issues);
    assert.equal(calls.length, paragraphsWithPhrase, `${label}: เรียก AI 1 ครั้ง/ย่อหน้าที่มีวลี`);
    assert.equal(fresh.correctedContent, mockEdit(content), label);
    for (const i of aiIssues) assert.ok(!fresh.correctedContent.includes(i.text), `${label}: วลี "${i.text}" ต้องหาย`);
    assert.equal((await auditIssues(fresh.correctedContent)).filter((i) => i.type === 'ai_wording').length, 0, `${label}: re-audit ต้องไม่เหลือ ai_wording`);
    assert.equal(numbersOf(fresh.correctedContent), numbersOf(content), `${label}: ตัวเลขครบ`);
    assert.equal(fresh.corrections.filter((c) => c.type === 'ai_sentence_fix').length, paragraphsWithPhrase, label);
    assert.equal(fresh.rollbackContent, content);

    resetCalls();
    const off = await run('0', content, issues);
    assert.equal(calls.length, 0, `${label}: off ไม่เรียก`);
    assert.equal(off.correctedContent, content, `${label}: off คงเดิม`);

    resetCalls();
    const legacy = await run('legacy', content, issues);
    assert.equal(calls.length, aiIssues.length, `${label}: legacy เรียก 1 ครั้ง/วลี (${aiIssues.length})`);
    assert.ok(calls.every((c) => c.maxTokens === 200), `${label}: legacy maxTokens 200`);
    assert.equal(legacy.correctedContent, content, `${label}: legacy ทิ้งผล = คงเดิม`);
  }
});

test('F2 ราชาศัพท์: ผลเกลาที่แตะคำราชาศัพท์/ชื่อ (คำใหม่เกินเพดาน) ถูกทิ้ง · ผลที่ถอดเฉพาะวลี AI ผ่าน', async () => {
  const [, royal] = STORIES[2];
  const issues = await auditIssues(royal);
  resetCalls(); setAI((args) => ({ sentence: mockEdit(sentenceFromPrompt(args)).replace('เสด็จพระราชดำเนินไปทรงเปิด', 'เดินทางมาเปิดงานพร้อมคณะผู้ติดตามจำนวนมาก') }));
  const bad = await run('default', royal, issues);
  assert.equal(bad.correctedContent, royal, 'แตะราชาศัพท์ + เติมคำใหม่เกินเพดาน → คงเดิม');
  resetCalls(); aiEditor();
  const good = await run('default', royal, issues);
  assert.match(good.correctedContent, /เสด็จพระราชดำเนินไปทรงเปิด/u);
  assert.match(good.correctedContent, /พระราชทาน/u);
  assert.doesNotMatch(good.correctedContent, /ซึ่งถือเป็น|ทั้งนี้|สะท้อนให้เห็นถึง/u);
});
