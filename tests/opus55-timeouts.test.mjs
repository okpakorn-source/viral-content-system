// 🔏 ข้อสอบเพดานเวลาชุด 2 ของสวิตช์ opus-5-5 (★ 23 ก.ย. 69 เจ้าของสั่ง "ปรับเพดานเวลาให้รอนานขึ้นได้จะได้ไม่ล้ม")
// อ่านซอร์สจริง 3 ไฟล์ → ตัดบรรทัดคอมเมนต์ทิ้ง → ดึงตัวเลขจริงด้วย regex → ตรวจค่า + ความสัมพันธ์ของงบซ้อนชั้น
//   src/lib/ai/aiRouter.js                  WRITER_ATTEMPT_TIMEOUT_MS { opus, fable, sol } + ต้องถูกใช้จริงกับไม้ writer_opus/fable/sol
//   src/lib/services/summarizeServiceText.js withTimeoutSignal(callSmartAI('write' ...), N, 'write_inner', ...)
//   src/lib/services/autoFlowServiceText.js  withTimeoutSignal(performSummarize({ mode: 'extract' ... }), N, 'extract')
//                                            withTimeoutSignal(..., N, `generate_A${index + 1}`)
// ไม่มี API/network/DB — อ่านไฟล์อย่างเดียว
//
// วิธีรัน:  node --test tests/opus55-timeouts.test.mjs
// โหมดกลายพันธุ์ (พิสูจน์ว่ากัดจริง — แก้เฉพาะสำเนาในหน่วยความจำ ไม่แตะไฟล์จริง · ตั้งโหมดไหนเทสต้องแดง):
//   OPUS55_TIMEOUTS_MUTATION=opus | fable | sol | write-inner | mix-inner | generate | extract | opus-unwired
//   (opus/fable/write-inner/mix-inner/extract = ย้อนเลขกลับค่าก่อนชุด 2 · generate = ยก generate_A เกินหน้าต่างงบ 700s · sol = ขยับ sol ออกจาก 90s · opus-unwired = ไม้ opus ไม่ใช้ค่าคงที่)
// ชุดนี้ไม่ได้ตรวจ: พฤติกรรม timeout จริงตอนรัน (อยู่ที่ tests/writer-fable-switch.test.mjs ข้อ 5.1)
//   และไม่ได้ตรวจงบรวมทั้งใบ 700s ของ src/lib/utils/pipelineDeadline.js (ไม่ได้แก้ในชุดนี้)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROUTER = '../src/lib/ai/aiRouter.js';
const TEXT_SERVICE = '../src/lib/services/summarizeServiceText.js';
const AUTO_FLOW = '../src/lib/services/autoFlowServiceText.js';

// [ไฟล์, สตริงในซอร์สปัจจุบัน, สตริงหลังกลายพันธุ์]
const MUTATIONS = {
  opus: [ROUTER, 'opus: 150_000,', 'opus: 90_000,'],
  fable: [ROUTER, 'fable: 90_000,', 'fable: 75_000,'],
  sol: [ROUTER, 'sol: 90_000,', 'sol: 150_000,'],
  'write-inner': [TEXT_SERVICE, "350000, 'write_inner'", "270000, 'write_inner'"],
  'mix-inner': [TEXT_SERVICE, "350000, 'mix_inner'", "270000, 'mix_inner'"],
  generate: [AUTO_FLOW, '420000, `generate_A${index + 1}`', '500000, `generate_A${index + 1}`'],
  extract: [AUTO_FLOW, "180000, 'extract')", "120000, 'extract')"],
  'opus-unwired': [ROUTER, "WRITER_ATTEMPT_TIMEOUT_MS.opus, 'writer_opus'", "90_000, 'writer_opus'"],
};
const MUTATION = process.env.OPUS55_TIMEOUTS_MUTATION || '';
if (MUTATION && !MUTATIONS[MUTATION]) throw new Error('ไม่รู้จัก mutation: ' + MUTATION);
if (MUTATION) console.log(`🧬 MUTATION ACTIVE: ${MUTATION} — ข้อสอบชุดนี้ต้องแดงจึงจะถือว่ากัดจริง`);

const read = (rel) => {
  const src = readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const m = MUTATIONS[MUTATION];
  if (!m || m[0] !== rel) return src;
  assert.ok(src.includes(m[1]), `mutation ${MUTATION}: หาสตริงต้นทางใน ${rel} ไม่เจอ`);
  return src.replace(m[1], m[2]);
};
// ตัดบรรทัดคอมเมนต์ทิ้ง — คอมเมนต์ประวัติ "(ของเดิม: ...)" ต้องไม่ทำให้ข้อสอบหลงไปอ่านเลขเก่า
const codeOnly = (src) => src.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
const toMs = (raw) => Number(String(raw).replace(/_/g, ''));

// ดึงเลขจากจุดเดียวในโค้ดจริง — เจอ 0 หรือ >1 จุด = ข้อสอบล้ม (กันอ่านผิดตำแหน่ง)
const onlyNumber = (code, re, label) => {
  const hits = [...code.matchAll(re)].map((m) => m[1]);
  assert.equal(hits.length, 1, `${label}: ต้องเจอในโค้ดจริงพอดี 1 จุด (เจอ ${hits.length})`);
  const ms = toMs(hits[0]);
  assert.ok(Number.isFinite(ms) && ms > 0, `${label}: อ่านตัวเลขไม่ได้ (${hits[0]})`);
  return ms;
};

const loadTimeouts = () => {
  const router = codeOnly(read(ROUTER));
  const blocks = [...router.matchAll(/const WRITER_ATTEMPT_TIMEOUT_MS = Object\.freeze\(\{([\s\S]*?)\}\);/g)];
  assert.equal(blocks.length, 1, 'aiRouter: ต้องมี WRITER_ATTEMPT_TIMEOUT_MS พอดี 1 ก้อน');
  const block = blocks[0][1];
  const writer = {};
  for (const name of ['opus', 'fable', 'sol']) {
    writer[name] = onlyNumber(block, new RegExp(`\\b${name}:\\s*([\\d_]+)\\s*,`, 'g'), `aiRouter WRITER_ATTEMPT_TIMEOUT_MS.${name}`);
  }

  const text = codeOnly(read(TEXT_SERVICE));
  const writeInner = onlyNumber(text,
    /withTimeoutSignal\(\s*\(requestSignal\) => callSmartAI\('write', \{ prompt: multiPrompt,[\s\S]*?\}\),\s*([\d_]+),\s*'write_inner'/g,
    "summarizeServiceText write_inner (ครอบ callSmartAI('write'))");

  const auto = codeOnly(read(AUTO_FLOW));
  const extract = onlyNumber(auto,
    /withTimeoutSignal\(\(stageSignal\) => performSummarize\(\{\s*text: rawText,[\s\S]*?mode: 'extract',[\s\S]*?\}\),\s*([\d_]+),\s*'extract'\)/g,
    "autoFlowServiceText extract (ครอบ performSummarize mode 'extract')");
  const generate = onlyNumber(auto,
    /\}\)\(\),\s*([\d_]+),\s*`generate_A\$\{index \+ 1\}`\)/g,
    'autoFlowServiceText generate_A (ต่อมุม)');
  const mixInner = onlyNumber(text, /([\d_]+),\s*'mix_inner'/g, 'summarizeServiceText mix_inner');

  return { router, writer, writeInner, mixInner, extract, generate };
};

test('(t1) เพดานต่อไม้ของนักเขียน = opus 150_000 · fable 90_000 · sol คง 90_000 และถูกใช้จริงกับไม้ของตัวเอง', () => {
  const { router, writer } = loadTimeouts();
  assert.equal(writer.opus, 150_000, 'opus-5-5 ต้องได้ 150s (ย้อนเป็น 90s = แดง)');
  assert.equal(writer.fable, 90_000, 'fable ต้องได้ 90s (ย้อนเป็น 75s = แดง)');
  assert.equal(writer.sol, 90_000, 'sol ต้องคง 90s ตามสเปก');
  for (const [name, step] of [['opus', 'writer_opus'], ['fable', 'writer_fable'], ['sol', 'writer_sol']]) {
    const uses = router.split(`WRITER_ATTEMPT_TIMEOUT_MS.${name}, '${step}'`).length - 1;
    assert.equal(uses, 1, `ไม้ ${step} ต้องใช้ WRITER_ATTEMPT_TIMEOUT_MS.${name} จริงพอดี 1 จุด (เจอ ${uses})`);
  }
});

test('(t2) write_inner ≥ ผลรวมโซ่นักเขียน + 20s (โซ่ครบ 3 ไม้ต้องจบก่อนเพดานชั้นใน) และ mix_inner = write_inner', () => {
  const { writer, writeInner, mixInner } = loadTimeouts();
  const chain = writer.opus + writer.fable + writer.sol;
  assert.ok(chain + 20_000 <= writeInner,
    `opus+fable+sol+20s = ${chain + 20_000}ms ต้อง ≤ write_inner ${writeInner}ms (ย้อน write_inner เป็น 270s = แดง)`);
  assert.equal(mixInner, writeInner, `mix_inner ${mixInner}ms ต้องเท่า write_inner ${writeInner}ms (โซ่นักเขียนเดียวกัน · ย้อน mix_inner เป็น 270s = แดง)`);
});

test('(t3) generate_A ≥ write_inner + 60s (เหลือที่ให้ research) และ generate_A ≤ 420s (assertCanStart จองเต็มค่าจากงบ 700s — หน้าต่างก่อนเขียนต้องเหลือ ≥ 280s)', () => {
  const { writeInner, generate } = loadTimeouts();
  assert.ok(writeInner + 60_000 <= generate,
    `write_inner+60s = ${writeInner + 60_000}ms ต้อง ≤ generate_A ${generate}ms`);
  assert.ok(generate <= 420_000,
    `generate_A ${generate}ms ต้อง ≤ 420000ms — ยกเกินนี้ = ขั้นก่อนเขียนเหลือ < 280s ในงบ 700s แล้วงานล้ม 504 ก่อนเรียกนักเขียน (ยกเป็น 500s = แดง)`);
});

test('(t4) ขั้น extract ≥ 180s (opus-5-5 สกัดช้ากว่า 4-8 + เผื่อ fallback gemini/gpt)', () => {
  const { extract } = loadTimeouts();
  assert.ok(extract >= 180_000, `extract ${extract}ms ต้อง ≥ 180000ms (ย้อนเป็น 120s = แดง)`);
});
