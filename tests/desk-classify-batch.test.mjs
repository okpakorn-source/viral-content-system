// ============================================================
// 💰 เทสด่านคัดกรองข่าว (deskBrain.classifyBatch) — งาน P4 ลดค่าคัดกรอง 2 ส.ค. 69
// ------------------------------------------------------------
// สิ่งที่ต้องพิสูจน์ (ทั้งหมดเป็น "พฤติกรรมจริง" ไม่ใช่ presence test):
//   A. ลำดับพรอมต์ — กติกาต้องมาก่อนรายชื่อข่าวเสมอ และหัวพรอมต์ต้องคงที่เป๊ะทุกก้อน
//      (เงื่อนไขเดียวที่ทำให้ส่วนลดค่าซ้ำ/prompt caching ของผู้ให้บริการทำงาน)
//   B. ขนาดก้อน 25 ใบ/คอล (default) · ปรับด้วย env DESK_CLASSIFY_BATCH · เกินช่วงถูกบีบ 5-30
//   C. maxTokens ต้องโตตามขนาดก้อน และ "พอจริง" เมื่อคิดจากเคสยาว + ที่ให้โทเคนคิดของโมเดล reasoning
//   D. ตัวกันพัง — โมเดลตอบไม่ครบ / ก้อนพังทั้งก้อน → ข่าวต้องไม่หาย แต่ต้อง fail-CLOSED
//      (ถูกกันออกจากโต๊ะด้วยค่าที่ด่านปลายทางใน harvester.js ใช้ตัดจริง + มีร่องรอยให้ตามได้)
//   E. กติกาต้องครบเท่าเดิม "ทั้งก้อน" — ปักหมุดด้วย hash ไม่ใช่แค่วลีตัวอย่าง
// แพทเทิร์น register-stub เดียวกับ tests/desk-pipeline-gate-reopen.test.mjs
// offline ล้วน — ไม่มี network/LLM จริง (fetch ถูกปิด + '@/' ที่ไม่ได้ stub = ระเบิด)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const _mod = (src) => 'data:text/javascript,' + encodeURIComponent(src);

// callAI ปลอม — บันทึกทุก args ที่ถูกส่งมา + วัดความขนานสูงสุด
const STUB_OPENAI = _mod(`
export async function callAI(args) {
  const bag = globalThis.__CLS;
  if (!bag) throw new Error('__CLS_NOT_SET');
  bag.calls.push(args);
  bag.live++; if (bag.live > bag.maxLive) bag.maxLive = bag.live;
  try { return await bag.respond(args); } finally { bag.live--; }
}
`);
const STUB_STORE = _mod(`
export function createStore() {
  return { getAll: async () => [], get: async () => null, add: async (r) => r, update: async (id, fn) => (typeof fn === 'function' ? fn({}) : {}) };
}
`);
const STUB_MODELCFG = _mod(`
export const DESK_MODEL_BRAIN = 'stub-brain';
export const DESK_MODEL_FAST = 'stub-fast';
`);

const hook = `
export async function resolve(specifier, ctx, next) {
  if (specifier === '@/lib/ai/openai') return { url: ${JSON.stringify(STUB_OPENAI)}, shortCircuit: true };
  if (specifier === '@/lib/persistStore') return { url: ${JSON.stringify(STUB_STORE)}, shortCircuit: true };
  if (specifier === '@/lib/services/deskModelConfig') return { url: ${JSON.stringify(STUB_MODELCFG)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    // ห้าม fail-open ไปโหลดโมดูลจริง — เจอ '@/' ที่ไม่รู้จัก = ระเบิดทันที ให้คนเติม stub
    throw new Error('UNSTUBBED_IMPORT_FORBIDDEN: ' + specifier);
  }
  return next(specifier, ctx);
}
`;
register(_mod(hook));

globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN'); };

const { classifyBatch } = await import('../src/lib/services/newsDesk/deskBrain.js');

// ── เครื่องมือช่วยอ่านพรอมต์ ─────────────────────────────
const LIST_HEADER = 'ข่าว (รูปแบบ: เลข: [โดเมนต้นทาง] หัวข้อ | คำโปรย):\n';
const listLines = (prompt) => {
  const s = String(prompt);
  const at = s.indexOf(LIST_HEADER);
  assert.ok(at >= 0, 'พรอมต์ต้องมีหัวรายชื่อข่าว');
  return s.slice(at + LIST_HEADER.length).split('\n').filter(x => x.length > 0);
};
/** ทุกตัวอักษรก่อนรายชื่อข่าว = ส่วนที่ต้อง "เหมือนกันเป๊ะทุกคอล" ถึงจะเข้าแคชได้ */
const prefixOf = (prompt) => {
  const s = String(prompt);
  return s.slice(0, s.indexOf(LIST_HEADER) + LIST_HEADER.length);
};
const sizes = (bag) => bag.calls.map(c => listLines(c.prompt).length);

const mkItems = (n) => Array.from({ length: n }, (_, i) => ({
  id: 'N' + i,
  title: 'ข่าวทดสอบใบที่ ' + i + ' เรื่องน้ำใจคนไทยช่วยเหลือกัน',
  snippet: 'คำโปรยทดสอบของใบที่ ' + i,
  url: 'https://example.com/n' + i,
}));

const FULL_ANSWER = {
  category: 'สู้ชีวิต', tone: 'บวก', toxicity: 0, fbRisk: 0, toneable: true, country: '',
  storyNature: 'pattern', subject: 'ordinary', dramaType: 'none', hasMainChar: true,
  staleTrend: false, remakeable: true, clipWorthy: false, royalNegative: false,
  notability: 'famous', storyIntensity: 2, prelimScore: 7, field: 'ไวรัล',
};
const respondAll = (args) => ({ items: listLines(args.prompt).map((_, i) => ({ i, ...FULL_ANSWER })) });

/** ตั้ง env + กล่องบันทึก แล้วคืนค่าให้สะอาดเสมอ (เทสอื่นต้องไม่โดนหางเลข) */
function run(envVal, fn, respond) {
  return async () => {
    const saved = process.env.DESK_CLASSIFY_BATCH;
    if (envVal === undefined) delete process.env.DESK_CLASSIFY_BATCH;
    else process.env.DESK_CLASSIFY_BATCH = envVal;
    globalThis.__CLS = { calls: [], live: 0, maxLive: 0, respond: respond || respondAll };
    try { return await fn(globalThis.__CLS); } finally {
      if (saved === undefined) delete process.env.DESK_CLASSIFY_BATCH;
      else process.env.DESK_CLASSIFY_BATCH = saved;
      delete globalThis.__CLS;
    }
  };
}

// ════════════════════════════════════════════════════
// B. ขนาดก้อน
// ════════════════════════════════════════════════════
test('B1 default = 25 ใบ/คอล — 60 ใบ ยิงแค่ 3 คอล (ยุคก้อน 10 ใบต้องยิง 6)', run(undefined, async (bag) => {
  await classifyBatch(mkItems(60));
  assert.deepStrictEqual(sizes(bag), [25, 25, 10], 'ต้องแบ่งเป็น 25/25/10');
  assert.strictEqual(bag.calls.length, 3, '60 ใบต้องยิงแค่ 3 คอล');
  assert.strictEqual(bag.calls[0].model, 'stub-fast', 'ต้องยิงด้วยโมเดลสายเร็ว (DESK_MODEL_FAST)');
}));

test('B2 env DESK_CLASSIFY_BATCH ปรับขนาดก้อนได้จริง (=12 → 60 ใบ เป็น 5 ก้อนละ 12)', run('12', async (bag) => {
  await classifyBatch(mkItems(60));
  assert.deepStrictEqual(sizes(bag), [12, 12, 12, 12, 12]);
}));

test('B3 clamp: ตั้งเกินเพดาน (=999) ถูกบีบเหลือ 30 (เพดานใหม่ 2 ส.ค. รอบ 2 — เดิม 40 เผื่อโทเคนคิดไม่พอ)', run('999', async (bag) => {
  await classifyBatch(mkItems(60));
  assert.deepStrictEqual(sizes(bag), [30, 30], 'เกิน 30 ต้องถูกบีบเป็น 30');
}));

test('B3b clamp เป๊ะที่ขอบ: 30 ผ่าน / 31 ถูกบีบเหลือ 30 (ห้ามมีก้อนใหญ่กว่า 30 หลุดไปได้)', async () => {
  await run('30', async (bag) => {
    await classifyBatch(mkItems(30));
    assert.deepStrictEqual(sizes(bag), [30], 'ตั้ง 30 พอดีต้องได้ 30');
  })();
  await run('31', async (bag) => {
    await classifyBatch(mkItems(31));
    assert.deepStrictEqual(sizes(bag), [30, 1], 'ตั้ง 31 ต้องถูกบีบเหลือ 30');
  })();
});

test('B4 clamp: ตั้งต่ำกว่าพื้น (=1) ถูกบีบขึ้นเป็น 5', run('1', async (bag) => {
  await classifyBatch(mkItems(12));
  assert.deepStrictEqual(sizes(bag), [5, 5, 2], 'ต่ำกว่า 5 ต้องถูกบีบเป็น 5');
}));

test('B5 env ขยะ/ว่าง → กลับไปใช้ default 25 (ไม่พัง ไม่กลายเป็น NaN)', run('ขยะไม่ใช่ตัวเลข', async (bag) => {
  await classifyBatch(mkItems(30));
  assert.deepStrictEqual(sizes(bag), [25, 5]);
}));

test('B6 ความขนานคงเดิม — ยิงพร้อมกันไม่เกิน 5 ก้อน (12 ก้อนต้องไม่ระเบิดพร้อมกันหมด)', run('5', async (bag) => {
  const slow = async (args) => { await new Promise(r => setTimeout(r, 5)); return respondAll(args); };
  bag.respond = slow;
  await classifyBatch(mkItems(60)); // 60/5 = 12 ก้อน
  assert.strictEqual(bag.calls.length, 12);
  assert.ok(bag.maxLive <= 5, `ความขนานต้องไม่เกิน 5 ก้อน (วัดได้ ${bag.maxLive})`);
  assert.ok(bag.maxLive > 1, 'ต้องยังยิงขนานอยู่จริง ไม่ใช่ทีละก้อน');
}));

// ════════════════════════════════════════════════════
// A. ลำดับพรอมต์ + หัวคงที่ (หัวใจของการลดค่าใช้จ่าย)
// ════════════════════════════════════════════════════
test('A1 ลำดับพรอมต์: กติกาทุกบรรทัดต้องมาก่อนรายชื่อข่าวเสมอ และรายชื่อข่าวปิดท้ายพรอมต์', run(undefined, async (bag) => {
  await classifyBatch(mkItems(30));
  for (const call of bag.calls) {
    const p = String(call.prompt);
    const iList = p.indexOf(LIST_HEADER);
    assert.ok(iList > 0, 'ต้องมีหัวรายชื่อข่าว');
    // marker 2 ตัว: กติกาบรรทัดแรก และกติกาบรรทัดสุดท้าย
    const iFirstRule = p.indexOf('- toxicity: 0=สะอาด 3=หดหู่/รุนแรง');
    const iLastRule = p.indexOf('นี่คือคะแนนคัดรอบแรก (บก.ตัวจริงจะตัดสินซ้ำเฉพาะตัวท็อป)');
    assert.ok(iFirstRule > 0, 'ต้องเจอกติกาบรรทัดแรก');
    assert.ok(iLastRule > 0, 'ต้องเจอกติกาบรรทัดสุดท้าย');
    assert.ok(iFirstRule < iList, 'กติกาบรรทัดแรกต้องมาก่อนรายชื่อข่าว');
    assert.ok(iLastRule < iList, 'กติกาบรรทัดสุดท้ายต้องมาก่อนรายชื่อข่าว (ห้ามย้ายรายชื่อขึ้นไปกลางพรอมต์)');
    // รูปแบบ JSON ที่ต้องตอบ ก็ต้องอยู่ก่อนรายชื่อข่าวเช่นกัน
    assert.ok(p.indexOf('ตอบ: {"items":[{"i":0,') < iList, 'รูปแบบ JSON ต้องมาก่อนรายชื่อข่าว');
    // รายชื่อข่าวต้องเป็นสิ่งสุดท้ายจริงๆ
    const lines = listLines(p);
    assert.ok(p.endsWith(lines[lines.length - 1]), 'พรอมต์ต้องจบด้วยบรรทัดข่าวบรรทัดสุดท้าย');
  }
}));

test('A2 หัวพรอมต์คงที่เป๊ะทุกก้อน — เงื่อนไขที่ทำให้ส่วนลดค่าซ้ำ (prompt caching) ใช้ได้', run(undefined, async (bag) => {
  await classifyBatch(mkItems(60));
  assert.strictEqual(bag.calls.length, 3);
  const p0 = prefixOf(bag.calls[0].prompt);
  assert.ok(p0.length >= 5000, `หัวคงที่ต้องยาวจริง (กติกา ~5,500 ตัวอักษร) วัดได้ ${p0.length}`);
  for (let i = 1; i < bag.calls.length; i++) {
    assert.strictEqual(prefixOf(bag.calls[i].prompt), p0, `หัวพรอมต์ก้อนที่ ${i + 1} ต้องเหมือนก้อนแรกทุกตัวอักษร`);
  }
  // และเนื้อข่าวต้องต่างกันจริง (ไม่ใช่เหมือนกันเพราะส่งซ้ำผิด)
  assert.notStrictEqual(String(bag.calls[0].prompt), String(bag.calls[1].prompt));
}));

// ════════════════════════════════════════════════════
// E. กติกาครบเท่าเดิม — ปักหมุดวลีสำคัญ (ย้ายตำแหน่งได้ ห้ามหาย/ห้ามย่อ)
// ════════════════════════════════════════════════════
const PINNED_RULES = [
  '- toxicity: 0=สะอาด 3=หดหู่/รุนแรง | fbRisk: ความเสี่ยงโดน Facebook ลดรีช/ลบ',
  '- ★★ notability (17 มิ.ย. ทีมขอ "เอาแต่คนมีชื่อเสียง ตัดชาวบ้านนิรนาม"): ตัวเอกของข่าวนี้ดังแค่ไหน',
  '- subject: ★ "celeb"=ดารา/นักร้อง/นักแสดง/คนดังบันเทิง',
  '- dramaType: ★ "soft"=ดราม่านุ่มเล่นเป็นข่าวได้',
  '- country: ★ ถ้าเหตุการณ์เกิดนอกประเทศไทย ใส่ชื่อประเทศ',
  '- storyNature: ★ "pattern" = เรื่องแบบแผนไร้กาลเวลา เล่าวันไหนก็ได้',
  '- hasMainChar: ★ (16 มิ.ย.) มี "ตัวละครคน" หลักให้เล่าเป็นศูนย์กลางไหม',
  '- royalNegative: ★★ (16 มิ.ย. สำคัญสุด — ต้องแยกให้ขาด)',
  '- staleTrend: ★ (16 มิ.ย. สำคัญ) เป็น "กระแส/ดราม่าเก่าที่จบไปแล้ว เล่นใหม่ไม่ได้" ไหม',
  '- ★★★ remakeable (26 มิ.ย. — สำคัญสุด ผู้ใช้สั่ง): "ข่าวนี้หยิบมาทำคอนเทนต์ใหม่ได้จริงไหม วันไหนก็ได้" = true/false',
  '- ★★★ clipWorthy (2 ก.ค. — เฉพาะรายการที่ขึ้นต้น 🎬คลิป): "คลิปนี้เอามาทำข่าวได้ไหม" = true/false',
  '- ★★★ storyIntensity (2 ก.ค. — เกณฑ์จากผลโพสต์จริง 949 โพสต์): "ความเข้มของสตอรี่" 0-3',
  '- ★★★ prelimScore (3 ก.ค. — แก้คอขวด "ข่าวส่วนใหญ่ไม่เคยถูกประเมิน"): คะแนนเบื้องต้น 0-10',
  'contrast = ช่องว่างสุดขั้วในเรื่อง: จนมาก↔เก่งมาก',
  '  นี่คือคะแนนคัดรอบแรก (บก.ตัวจริงจะตัดสินซ้ำเฉพาะตัวท็อป) — ให้ตามจริง อย่าใจดีเกิน',
];

test('E1 กติกาครบเท่าเดิม — ปักหมุด 15 วลีสำคัญ ต้องอยู่ครบทุกตัวอักษร (ด่านหยาบ อ่านง่ายตอนพัง)', run(undefined, async (bag) => {
  await classifyBatch(mkItems(3));
  const p = String(bag.calls[0].prompt);
  assert.ok(PINNED_RULES.length >= 8, 'ต้องปักหมุดอย่างน้อย 8 วลี');
  for (const phrase of PINNED_RULES) {
    assert.ok(p.includes(phrase), `กติกาหาย/ถูกแก้ถ้อยคำ: "${phrase.slice(0, 45)}..."`);
  }
  // ฟิลด์ทั้ง 18 ต้องยังอยู่ในรูปแบบ JSON ที่สั่งให้ตอบ
  for (const f of ['category', 'tone', 'toxicity', 'fbRisk', 'toneable', 'country', 'storyNature', 'subject',
    'dramaType', 'hasMainChar', 'staleTrend', 'remakeable', 'clipWorthy', 'royalNegative',
    'notability', 'storyIntensity', 'prelimScore', 'field']) {
    assert.ok(p.includes(`"${f}"`), `ฟิลด์ ${f} หายจากรูปแบบ JSON`);
  }
}));

// ── E2: ปักหมุด "ทั้งก้อน" ด้วย hash ────────────────────────
//   เหตุผล (ผู้ตรวจไขว้ 2 ส.ค.): เทสรายวลี 15 ข้อพิสูจน์แล้วว่าไม่พอ — แก้คำที่ไม่อยู่ในลิสต์
//   (เช่น "เคยไวรัล" → "เคยดัง") ยังผ่าน 15/15 ทั้งที่กติกาเปลี่ยนความหมายไปแล้ว
//   ตรงนี้จึงล็อกทุกตัวอักษรตั้งแต่ต้นพรอมต์จนถึงหัวรายชื่อข่าว (= ส่วนที่ต้องคงที่เพื่อเข้าแคชด้วย)
//   normalize CRLF→LF ก่อน เพื่อไม่ให้ค่าเปลี่ยนตาม git autocrlf / โปรแกรมแก้ไฟล์บนวินโดวส์
const RULES_SHA256 = 'c80a28ecef1548dbf43231c21ca63053188368ac0244ee53f43644eb42ffe8e9';
const RULES_CHARS = 7544;
const hashRules = (prompt) => createHash('sha256')
  .update(prefixOf(prompt).replace(/\r\n/g, '\n'), 'utf8').digest('hex');

test('E2 ปักหมุดกติกาทั้งก้อนด้วย hash — แก้ถ้อยคำแม้ตัวเดียวต้องแดง', run(undefined, async (bag) => {
  await classifyBatch(mkItems(3));
  const block = prefixOf(bag.calls[0].prompt).replace(/\r\n/g, '\n');
  const got = hashRules(bag.calls[0].prompt);
  assert.strictEqual(got, RULES_SHA256,
    `❌ กติกาคัดกรองถูกแก้ถ้อยคำ (sha256 ไม่ตรงค่าปักหมุด)\n`
    + `   ค่าที่ปักหมุดไว้ = ${RULES_SHA256} (${RULES_CHARS} ตัวอักษร)\n`
    + `   ค่าที่วัดได้จริง = ${got} (${block.length} ตัวอักษร)\n`
    + `   👉 ถ้า "ตั้งใจ" แก้กติกา: ให้อัปเดตค่า RULES_SHA256/RULES_CHARS ในเทสนี้พร้อมกัน\n`
    + `   👉 ถ้า "ไม่ได้ตั้งใจ": แปลว่ามีคนแก้/ย่อ/ตัดกติกาใน deskBrain.js โดยไม่รู้ตัว`);
  assert.strictEqual(block.length, RULES_CHARS, 'ความยาวบล็อกกติกาต้องตรงค่าปักหมุด');
}));

test('E2b hash ต้องคงที่ทุกก้อน (ก้อนที่ 2,3 ต้องได้ hash เดียวกับก้อนแรก)', run(undefined, async (bag) => {
  await classifyBatch(mkItems(60));
  assert.ok(bag.calls.length >= 2, 'ต้องมีหลายก้อนถึงจะเทียบได้');
  for (const c of bag.calls) assert.strictEqual(hashRules(c.prompt), RULES_SHA256);
}));

// ════════════════════════════════════════════════════
// C. maxTokens โตตามก้อน
// ════════════════════════════════════════════════════
test('C1 maxTokens โตตามขนาดก้อน ไม่ใช่ค่าคงที่ 1500 (ก้อน 25 ต้องได้เพดานใหญ่กว่าก้อน 10 มาก)', run(undefined, async (bag) => {
  await classifyBatch(mkItems(60)); // 25/25/10
  const [a, b, c] = bag.calls.map(x => x.maxTokens);
  assert.strictEqual(a, b, 'ก้อนขนาดเท่ากันต้องได้เพดานเท่ากัน');
  assert.ok(a > 1500, `ก้อน 25 ใบต้องได้เพดาน > 1500 (ได้ ${a})`);
  assert.ok(c < a, 'ก้อนเล็กกว่าต้องได้เพดานเล็กกว่า (โตตามจำนวนใบจริง)');
  // สัดส่วนต้องสมเหตุผล: อย่างน้อย ~150 โทเคน/ใบ (JSON 18 ฟิลด์ วัดจริง ~167)
  assert.ok(a / 25 >= 150, `เพดานต่อใบต้อง ≥150 โทเคน (ได้ ${Math.round(a / 25)})`);
  assert.ok(c / 10 >= 150, `เพดานต่อใบของก้อนเล็กต้อง ≥150 โทเคน (ได้ ${Math.round(c / 10)})`);
  // ส่วนต่างระหว่างก้อน 25 กับก้อน 10 = 15 ใบ ต้องสะท้อนจำนวนใบจริง
  assert.ok((a - c) / 15 >= 150, 'ส่วนต่างเพดานต้องเป็นสัดส่วนกับจำนวนใบที่ต่างกัน');
}));

test('C2 พื้นเพดานไม่ต่ำกว่าเดิม — ก้อนเล็กสุด (5 ใบ) ยังได้อย่างน้อย 1500', run('5', async (bag) => {
  await classifyBatch(mkItems(5));
  assert.strictEqual(bag.calls.length, 1);
  assert.ok(bag.calls[0].maxTokens >= 1500, `ก้อนเล็กต้องไม่ต่ำกว่า 1500 (ได้ ${bag.calls[0].maxTokens})`);
}));

// ── C3: เพดานต้อง "พอจริง" เมื่อคิดจากเคสยาว ไม่ใช่เคสกลาง ──────────
//   ผู้ตรวจไขว้ชี้: สูตรเดิม 400+200×N ที่ก้อน 40 เหลือที่ให้โทเคนคิดแค่ ~5%
//   และ max_completion_tokens ของโมเดลสาย reasoning (gpt-5.6-luna) "นับโทเคนคิดรวมด้วย"
//   ⇒ ไม่พอ = ทั้งก้อนตกไปที่ตัวกันพัง (ซึ่งตอนนี้ fail-closed = ข่าวทั้งก้อนไม่ได้ขึ้นโต๊ะ)
//   เทสนี้คำนวณความต้องการใหม่เองจากสตริงจริง ไม่ยอมรับตัวเลขที่คอมเมนต์อ้างลอยๆ
const LONG_ROW = '{"i":29,"category":"กตัญญู/ครอบครัวอบอุ่น","tone":"กลาง","toxicity":2,"fbRisk":1,'
  + '"toneable":true,"country":"เกาหลีใต้","storyNature":"pattern","subject":"ordinary","dramaType":"soft",'
  + '"hasMainChar":true,"staleTrend":false,"remakeable":true,"clipWorthy":false,"royalNegative":false,'
  + '"notability":"semiKnown","storyIntensity":2,"prelimScore":7,"field":"สัตว์เซเลบ"},';
/** โทเคนที่ "มองเห็น" ต่อ 1 ใบ แบบอนุรักษ์: ASCII 2 ตัวอักษร/โทเคน · ไทย 1.5 โทเคน/ตัวอักษร */
const VISIBLE_PER_ITEM = (() => {
  const thai = (LONG_ROW.match(/[฀-๿]/g) || []).length;
  const ascii = LONG_ROW.length - thai;
  return ascii / 2 + thai * 1.5;
})();

test('C3 ก้อนใหญ่สุด (30) — เพดานต้องคลุมเคสยาว + เหลือที่ให้โทเคนคิดจริง', run('999', async (bag) => {
  await classifyBatch(mkItems(30));
  assert.deepStrictEqual(sizes(bag), [30], 'ก้อนใหญ่สุดต้องเป็น 30 ใบ');
  const cap = bag.calls[0].maxTokens;
  const visible = VISIBLE_PER_ITEM * 30;           // ≈ 224 × 30 = 6,720
  const headroom = cap - visible;
  assert.ok(VISIBLE_PER_ITEM > 200, `เคสยาวต้องคิดได้ >200 โทเคน/ใบ (ได้ ${VISIBLE_PER_ITEM.toFixed(1)})`);
  assert.ok(cap >= visible, `เพดาน ${cap} ต้องไม่น้อยกว่าคำตอบที่มองเห็นของเคสยาว ${Math.round(visible)}`);
  assert.ok(headroom >= 2500,
    `ต้องเหลือที่ให้โทเคนคิดอย่างน้อย 2,500 (เพดาน ${cap} − มองเห็น ${Math.round(visible)} = ${Math.round(headroom)})`);
  assert.ok(headroom / 30 >= 100,
    `ที่ให้โทเคนคิดต้อง ≥100 ต่อใบ (ได้ ${Math.round(headroom / 30)})`);
  // margin เทียบคำตอบที่มองเห็น ต้องไม่ใช่ ~5% แบบสูตรเดิม
  assert.ok(headroom / visible >= 0.30,
    `margin ต้อง ≥30% ของคำตอบที่มองเห็น (ได้ ${Math.round((headroom / visible) * 100)}%)`);
}));

test('C4 เพดานสูงสุดต้องไม่เกิน 16,384 — ลิมิต completion ของ gpt-4o/4o-mini (ไม้สองสายเก่า ถูกบีบเงียบ)', run('999', async (bag) => {
  await classifyBatch(mkItems(30));
  assert.ok(bag.calls[0].maxTokens <= 16384,
    `เพดาน ${bag.calls[0].maxTokens} เกิน 16,384 → openai.js จะ Math.min บีบเงียบตอน fallback`);
}));

// ════════════════════════════════════════════════════
// D. ตัวกันพัง — ข่าวต้องไม่หาย แต่ต้อง "ไม่ผ่านฟรี" (fail-CLOSED)
// ------------------------------------------------------------
// จำลองด่านกรองปลายทางของ harvester.js ตามลำดับจริง (คัดลอกเงื่อนไขมาตรงๆ):
//   681  c.toxicity >= 3            → junk 'เนื้อหารุนแรง/สยอง (พิษ≥3)'
//   689  c.foreignCountry           → junk 'ข่าวต่างประเทศ'
//   698  c.royalNegative === true   → junk 'สถาบันแง่ลบ/อ่อนไหว (ม.112)'
//   711  c.remakeable === false     → junk 'ทำใหม่ไม่ได้ (...)'   ← คันโยกที่ตัวกันพังใช้
// (เลน broad ที่ 763-766 ใช้ชุดเดียวกันทั้ง 4 เงื่อนไข)
// ════════════════════════════════════════════════════
const harvesterGatePass = (c) => {
  if (c.toxicity >= 3) return false;
  if (c.foreignCountry) return false;
  if (c.royalNegative === true) return false;
  if (c.remakeable === false) return false;
  return true;
};
test('D1 ส่ง 60 ใบ → ได้กลับครบ 60 ใบ ไม่มีใบหาย (id ตรงกันหมด)', run(undefined, async () => {
  const items = mkItems(60);
  const out = await classifyBatch(items);
  assert.strictEqual(out.length, 60, 'ต้องได้กลับครบ 60 ใบ');
  assert.deepStrictEqual(new Set(out.map(o => o.id)), new Set(items.map(i => i.id)), 'id ต้องครบทุกใบ ไม่ซ้ำไม่ขาด');
  assert.ok(out.every(o => o.category === 'สู้ชีวิต' && o.prelimScore === 7), 'ใบที่โมเดลตอบต้องได้ค่าจากโมเดลจริง');
}));

test('D2 โมเดลตอบไม่ครบ (ตอบมาแค่เลขคู่) → ใบที่ขาดต้องถูกกันออกจากโต๊ะ + มีร่องรอย (ไม่ผ่านฟรี)', run(undefined, async (bag) => {
  bag.respond = (args) => ({
    items: listLines(args.prompt).map((_, i) => (i % 2 === 0 ? { i, ...FULL_ANSWER } : null)).filter(Boolean),
  });
  const items = mkItems(25);
  const out = await classifyBatch(items);
  assert.strictEqual(out.length, 25, 'ก้อนใหญ่ที่โมเดลตอบไม่ครบ ต้องยังได้ครบ 25 ใบ (ไม่ทิ้งข่าว)');
  assert.deepStrictEqual(new Set(out.map(o => o.id)), new Set(items.map(i => i.id)));
  const answered = out.filter(o => !o.classifyMissing);
  const missing = out.filter(o => o.classifyMissing === true);
  assert.strictEqual(answered.length, 13, 'เลขคู่ 0..24 = 13 ใบที่โมเดลตอบ');
  assert.strictEqual(missing.length, 12, 'อีก 12 ใบต้องถูกทำเครื่องหมาย classifyMissing ไม่ใช่หายไป');
  // 🔴 หัวใจ: ใบที่ไม่ถูกประเมิน ต้องไม่หลุดผ่านด่านปลายทาง
  assert.ok(missing.every(o => o.remakeable === false),
    'ใบที่โมเดลไม่ตอบ ต้องได้ remakeable=false (ค่าที่ harvester.js:711/:766 ใช้ตัดจริง)');
  assert.ok(missing.every(o => harvesterGatePass(o) === false),
    'ใบที่โมเดลไม่ตอบ ต้องถูกด่านกรองของ harvester ตัดทิ้งทุกใบ');
  assert.ok(answered.every(o => harvesterGatePass(o) === true),
    'ใบที่โมเดลตอบจริง (ค่าดี) ต้องยังผ่านด่านตามปกติ — ห้ามตัดเกิน');
  // ร่องรอยต้องตามได้ ไม่หายเงียบ
  assert.ok(missing.every(o => typeof o.classifyNote === 'string' && o.classifyNote.length > 0),
    'ต้องมีหมายเหตุบอกเหตุผล (classifyNote)');
  assert.ok(missing.every(o => /ตอบไม่ครบ/.test(o.classifyNote)), 'หมายเหตุต้องบอกว่าเป็นเคส "ตอบไม่ครบ"');
  // เกราะชั้น 2: คะแนนเบื้องต้น 0 → ถ้ามีเส้นไหนไม่ได้กรอง ก็ยังจมท้ายคิว (harvester.js:748 เรียงด้วย prelimScore×2)
  assert.ok(missing.every(o => o.prelimScore === 0), 'prelimScore ต้องเป็น 0 (เกราะชั้น 2)');
  // ห้ามปลอมป้ายความปลอดภัย — จะทำสถิติ/เหตุผลใน junk เพี้ยน
  assert.ok(missing.every(o => o.royalNegative === false && o.toxicity < 3),
    'ห้ามปลอมเป็น royalNegative/toxicity≥3 (ติดป้ายผิด + สถิติเพี้ยน)');
  // ฟิลด์ความปลอดภัยต้อง "มีค่าจริง" ทุกตัว ไม่ใช่ undefined (ต้นเหตุ fail-open เดิม)
  for (const f of ['remakeable', 'royalNegative', 'storyNature', 'toxicity', 'fbRisk', 'notability', 'hasMainChar']) {
    assert.ok(missing.every(o => o[f] !== undefined), `ฟิลด์ ${f} ต้องไม่เป็น undefined (undefined = ผ่านทุกด่าน)`);
  }
  assert.ok(missing.every(o => Object.prototype.hasOwnProperty.call(o, 'foreignCountry')),
    'ต้องมีฟิลด์ foreignCountry เสมอ (ไม่เดาประเทศ แต่ต้องมีค่า)');
}));

test('D3 ก้อนพังทั้งก้อน (JSON/โมเดลพัง) → ทั้งก้อนถูกกันออกจากโต๊ะ ไม่ทิ้งข่าว และก้อนอื่นไม่กระทบ', run(undefined, async (bag) => {
  let n = 0;
  bag.respond = (args) => { n++; if (n === 1) throw new Error('SIMULATED_MODEL_FAILURE'); return respondAll(args); };
  const items = mkItems(60);
  const out = await classifyBatch(items);
  assert.strictEqual(out.length, 60, 'ก้อนพัง 1 ก้อนต้องไม่ทำข่าวหาย');
  assert.deepStrictEqual(new Set(out.map(o => o.id)), new Set(items.map(i => i.id)));
  const missing = out.filter(o => o.classifyMissing === true);
  assert.strictEqual(missing.length, 25, 'ก้อนที่พัง (25 ใบ) ต้องถูกทำเครื่องหมายครบทั้งก้อน');
  assert.ok(missing.every(o => o.remakeable === false && harvesterGatePass(o) === false),
    '🔴 ทั้งก้อนที่พังต้องถูกกันออกจากโต๊ะ ไม่ใช่ผ่านฟรี 25 ใบรวด');
  assert.ok(missing.every(o => /ทั้งก้อนล้มเหลว/.test(o.classifyNote || '')), 'หมายเหตุต้องบอกว่าพังทั้งก้อน');
  assert.strictEqual(out.filter(o => harvesterGatePass(o)).length, 35, 'อีก 35 ใบที่ปกติต้องผ่านตามเดิม');
}));

test('D3b คำตอบเป็นข้อความ JSON พัง (โดนตัดกลาง) → เข้าทาง catch แล้วกันออกทั้งก้อนเหมือนกัน', run('5', async (bag) => {
  // จำลองของจริงตอนเพดานโทเคนไม่พอ: สตริงถูกตัดกลาง → JSON.parse ระเบิด → เข้า catch
  bag.respond = () => '{"items":[{"i":0,"category":"สู้ชีวิต","tone":"บวก"}';
  const out = await classifyBatch(mkItems(5));
  assert.strictEqual(out.length, 5, 'ไม่ทิ้งข่าว');
  assert.ok(out.every(o => o.classifyMissing === true), 'ทุกใบต้องถูกทำเครื่องหมายว่าไม่เคยถูกจัดหมวด');
  assert.ok(out.every(o => /ทั้งก้อนล้มเหลว/.test(o.classifyNote || '')), 'ต้องเป็นเส้นทาง catch (พังทั้งก้อน)');
  assert.ok(out.every(o => harvesterGatePass(o) === false), '🔴 ทุกใบต้องถูกกันออกจากโต๊ะ ไม่ใช่ผ่านฟรี');
}));

test('D3c คำตอบ parse แล้วไม่มี items เลย (ตอบ {} / ถูกตัดจนหาปีกกาปิดไม่เจอ) → กันออกทั้งก้อน', run('5', async (bag) => {
  bag.respond = () => ({});
  const out = await classifyBatch(mkItems(5));
  assert.strictEqual(out.length, 5);
  assert.ok(out.every(o => o.classifyMissing === true && harvesterGatePass(o) === false),
    'ไม่มีใบไหนถูกประเมิน ⇒ ต้องถูกกันออกทุกใบ');
}));

// ── D5: ยืนยันว่า "ค่าที่เลือกใช้" ยังตรงกับด่านจริงใน harvester.js ────────
//   ถ้าใครไปแก้ด่านปลายทาง (เปลี่ยนจาก remakeable เป็นอย่างอื่น) ตัวกันพังจะกลับไป fail-open เงียบๆ
//   เทสนี้จึงอ่านซอร์ส harvester.js มายืนยันว่าคันโยกยังอยู่ (อ่านอย่างเดียว ไม่แตะไฟล์)
test('D5 คันโยก fail-closed ต้องยังตรงกับด่านจริงใน harvester.js (curated + broad)', () => {
  const src = readFileSync(new URL('../src/lib/services/newsDesk/harvester.js', import.meta.url), 'utf8');
  const hits = src.split('c.remakeable === false').length - 1;
  assert.ok(hits >= 2,
    `harvester.js ต้องยังตัดด้วย "c.remakeable === false" ทั้ง 2 เส้น (curated ~711 + broad ~766) — เจอ ${hits} จุด\n`
    + '   👉 ถ้าด่านถูกเปลี่ยนเกณฑ์ ต้องแก้ค่าใน _classifyFailClosed() ของ deskBrain.js ให้ตรงกันด้วย');
  assert.ok(src.includes("junkReason: 'ทำใหม่ไม่ได้"),
    'ของที่ถูกตัดต้องยังตกไป junk พร้อมเหตุผล (ไม่หายเงียบ)');
  assert.ok(src.includes('c.royalNegative === true') && src.includes('c.toxicity >= 3'),
    'ด่านความปลอดภัยอื่นต้องยังอยู่ครบ (ใช้ยืนยันว่าจำลองด่านในเทสนี้ถูกต้อง)');
});

test('D4 โมเดลตอบเลขเกินขอบ/ซ้ำ → ไม่ทำใบซ้ำ ไม่ระเบิด (จำนวนใบยังเท่าที่ส่งไป)', run(undefined, async (bag) => {
  bag.respond = () => ({
    items: [{ i: 0, ...FULL_ANSWER }, { i: 0, ...FULL_ANSWER }, { i: 99, ...FULL_ANSWER }, { i: 'ขยะ', ...FULL_ANSWER }, { i: 1, ...FULL_ANSWER }],
  });
  const items = mkItems(10);
  const out = await classifyBatch(items);
  assert.strictEqual(out.length, 10, 'ต้องได้ 10 ใบพอดี ไม่มีใบซ้ำจากการตอบ i ซ้ำ');
  assert.deepStrictEqual(new Set(out.map(o => o.id)), new Set(items.map(i => i.id)));
  assert.strictEqual(out.filter(o => o.category === 'สู้ชีวิต').length, 2, 'ตอบจริงแค่ i=0,1');
}));
