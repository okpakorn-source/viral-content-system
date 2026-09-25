// 🔏 ข้อสอบตัวกรองคำเสี่ยงขอบคำ + ขอบเขต + สวิตช์ถอย — src/lib/ai/safetyFilter.js (MC-01 / PL-02)
// ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S1 · เจ้าของอนุมัติ)
//
// สิ่งที่ล็อกไว้:
//   A. SANITIZE_LEGACY=1 → ผลเท่าตัวกรองเดิมทุกไบต์ (รวมเคสพัง เพราะนั่นคือ "ของเดิม") และไม่สน scope
//   B. ค่าเริ่มต้น → ไม่กินกลางคำ (ประเทศพม่า/บรรยากาศพิธี/ตายตัว/ยิงยาว/พิมพ์ 10) · คำประสม/ราชาศัพท์/ชื่อในเครื่องหมายคำพูดคงเดิม
//   C. ค่าเริ่มต้น → ไม่เพิ่มข้อเท็จจริงการตาย (ผูกคอแต่ช่วยทัน · กระโดดตึกแต่รอด · พยายามฆ่าตัวตาย · ไม่อยากตาย)
//   D. คำเสี่ยงเดี่ยวๆ ยังถูกแทนอยู่ (ไม่ได้ปิดตัวกรอง)
//   E. scope 'facts' = คืน object เดิม · 'post'/ไม่ส่ง = กรอง
//   F. client จริง 3 ตัว (openai/claude/gemini · SDK ปลอม ไม่มี network) ส่ง sanitizeScope ถึงตัวกรอง
//   G. aiRouter จริง: extract/breakdown/analyze → 'facts' · write → 'post' · caller ส่งเองชนะ
//   H. รันไทม์ที่ไม่มี Intl.Segmenter → คำสั้น (ศพ/ฆ่า/โหด/สยอง) ไม่แตะ ดีกว่าแทนกลางคำ
//
// วิธีรัน:  node --test tests/safety-filter-word-boundary.test.mjs
// โหมดกลายพันธุ์ (พิสูจน์ว่าข้อสอบกัดจริง — เทสต้องแดง):
//   SAFETY_FILTER_TEST_MUTATION=no-boundary        ถอดการเช็คขอบคำ (กลับไปกินกลางคำ)
//   SAFETY_FILTER_TEST_MUTATION=legacy-death       ผูกคอ → 'เสียชีวิตอย่างน่าเศร้า' แบบเดิม (เพิ่มการตาย)
//   SAFETY_FILTER_TEST_MUTATION=no-compound-guard  ถอด prevBlock (ยาฆ่าเชื้อ/พระศพ พัง)
//   SAFETY_FILTER_TEST_MUTATION=ignore-scope       ตัวกรองไม่สน scope 'facts'
//   SAFETY_FILTER_TEST_MUTATION=no-legacy-switch   ถอดสวิตช์ถอย SANITIZE_LEGACY
//   SAFETY_FILTER_TEST_MUTATION=client-drops-scope client ทั้ง 3 ไม่ส่ง scope ให้ตัวกรอง
//   SAFETY_FILTER_TEST_MUTATION=router-drops-scope aiRouter ไม่ตั้ง scope ตาม task
// ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S2 · เจ้าของอนุมัติ): ตารางค่าเริ่มต้นย้ายไป src/lib/ai/riskWords.js (WORD_RULES ในไฟล์ตัวกรอง = โหมดถอย RISK_WORDS_LEGACY=1)
//   → mutation ที่แตะ "ตาราง" (legacy-death) ต้องกลายพันธุ์ riskWords.js ด้วย และโหลดตัวกรองผูกกับตารางที่กลายพันธุ์ผ่าน importPatchedGraph
//   (mutation ที่แตะ "เครื่องสแกน" no-boundary/no-compound-guard ยังอยู่ใน safetyFilter.js เพราะเครื่องสแกนใช้ร่วมทั้งสองโหมด)
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { importPatchedModule, importPatchedGraph } from './helpers/temp-module.mjs';

const MUTATION = process.env.SAFETY_FILTER_TEST_MUTATION || '';
const KNOWN_MUTATIONS = ['no-boundary', 'legacy-death', 'no-compound-guard', 'ignore-scope', 'no-legacy-switch', 'client-drops-scope', 'router-drops-scope'];
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

// ── ตัวกรอง (ซอร์สจริง · แพตช์เฉพาะโหมดกลายพันธุ์) ──
let filterSource = readSrc('../src/lib/ai/safetyFilter.js');
let riskSource = readSrc('../src/lib/ai/riskWords.js'); // ★ S2: ตารางค่าเริ่มต้น
if (MUTATION === 'no-boundary') {
  filterSource = mustReplace(filterSource, 'if (!boundaries.has(s) || !boundaries.has(e)) continue;', '/* mutated: no boundary check */', 'no-boundary');
} else if (MUTATION === 'legacy-death') {
  // ★ S2: กลายพันธุ์ทั้งตารางกลาง (ค่าเริ่มต้น) และตาราง S1 ในตัวกรอง (โหมดถอย) — ข้อสอบต้องแดงไม่ว่าโหมดไหน
  riskSource = mustReplace(riskSource, "{ id: 'ผูกคอ', find: 'ผูกคอ', to: 'ทำร้ายตัวเอง',", "{ id: 'ผูกคอ', find: 'ผูกคอ', to: 'เสียชีวิตอย่างน่าเศร้า',", 'legacy-death (riskWords)');
  filterSource = mustReplace(filterSource, "{ find: 'ผูกคอ', to: 'ทำร้ายตัวเอง' }", "{ find: 'ผูกคอ', to: 'เสียชีวิตอย่างน่าเศร้า' }", 'legacy-death');
} else if (MUTATION === 'no-compound-guard') {
  filterSource = mustReplace(filterSource, 'if (rule.prevBlock && rule.prevBlock.some((w) => before.endsWith(w))) continue;', '', 'no-compound-guard');
} else if (MUTATION === 'ignore-scope') {
  filterSource = mustReplace(filterSource, "if (options && options.scope === 'facts') return obj;", '', 'ignore-scope');
} else if (MUTATION === 'no-legacy-switch') {
  filterSource = mustReplace(filterSource, 'if (isSanitizeLegacy()) return sanitizeLegacy(obj);', '', 'no-legacy-switch');
}
// ★ S2: โหลดเป็นกราฟ (ตัวกรอง → ตารางกลางที่อาจกลายพันธุ์) แทน importPatchedModule เดี่ยวที่จะชี้ riskWords.js ไฟล์จริงเสมอ
const filter = MUTATION && !['client-drops-scope', 'router-drops-scope'].includes(MUTATION)
  ? (await importPatchedGraph({
    riskWords: { source: riskSource, originalUrl: srcUrl('../src/lib/ai/riskWords.js') },
    safetyFilter: { source: filterSource, originalUrl: srcUrl('../src/lib/ai/safetyFilter.js'), links: { './riskWords.js': 'riskWords' } },
  })).safetyFilter
  : await import('../src/lib/ai/safetyFilter.js');
const { sanitizeOutput, sanitizeThaiText, isSanitizeLegacy } = filter;

// ═══ A) สวิตช์ถอย: SANITIZE_LEGACY=1 = ของเดิมทุกไบต์ ═══
// ค่าคาดหวังฝั่ง legacy = ผลจริงของตัวกรองเดิม (บันทึกจากหลักฐานผู้ตรวจ MC-01/PL-02) — รวมเคสที่ "พัง" โดยตั้งใจ
const LEGACY_BYTES = [
  ['ชายวัย 40 ผูกคอแต่เพื่อนบ้านช่วยไว้ทัน', 'ชายวัย 40 เสียชีวิตอย่างน่าเศร้าแต่เพื่อนบ้านช่วยไว้ทัน'],
  ['เขากระโดดตึกแต่รอดชีวิต', 'เขาเสียชีวิตจากที่สูงแต่รอดชีวิต'],
  ['ชายวัย 40 ฆ่าตัวตายในบ้านพัก', 'ชายวัย 40 ทำให้เสียชีวิตตัวตายในบ้านพัก'],
  ['แม่ใช้ยาฆ่าเชื้อ', 'แม่ใช้ยาทำให้เสียชีวิตเชื้อ'],
  ['เธอบอกว่าไม่อยากตาย', 'เธอบอกว่าไม่ภาวะเครียดสะสม'],
  ['ชายแดนประเทศพม่า', 'ชายแดนประเทร่างผู้เสียชีวิตม่า'],
  ['สวดพระอภิธรรมพระศพ', 'สวดพระอภิธรรมพระร่างผู้เสียชีวิต'],
  ['สั่งพิมพ์ 10 เล่ม', 'สั่งคุณคิดเห็นยังไง0 เล่ม'],
  ['โหดร้าย', 'รุนแรงร้าย'],
  ['คดีฆาตกรรม', 'คดีเหตุสูญเสีย'],
];

test('A1 SANITIZE_LEGACY=1 → ผลเท่าตัวกรองเดิมทุกไบต์ (รวมเคสพัง) ทั้ง string และ object ซ้อน', async () => {
  await withEnv('SANITIZE_LEGACY', '1', () => {
    assert.equal(isSanitizeLegacy(), true);
    for (const [input, expected] of LEGACY_BYTES) assert.equal(sanitizeOutput(input), expected, `legacy: ${input}`);
    const nested = sanitizeOutput({ a: LEGACY_BYTES[0][0], b: [LEGACY_BYTES[3][0], { c: LEGACY_BYTES[7][0] }], n: 7, z: null });
    assert.deepEqual(nested, { a: LEGACY_BYTES[0][1], b: [LEGACY_BYTES[3][1], { c: LEGACY_BYTES[7][1] }], n: 7, z: null });
  });
});

test('A2 SANITIZE_LEGACY=1 → ไม่สน scope (ของเดิมไม่มีขอบเขต — facts ก็ถูกกรอง)', async () => {
  await withEnv('SANITIZE_LEGACY', '1', () => {
    const obj = { news_body: 'ชายวัย 40 ฆ่าตัวตายในบ้านพัก' };
    const out = sanitizeOutput(obj, { scope: 'facts' });
    assert.notEqual(out, obj, 'legacy สร้าง object ใหม่เสมอ');
    assert.equal(out.news_body, 'ชายวัย 40 ทำให้เสียชีวิตตัวตายในบ้านพัก');
  });
});

test('A3 ค่าสวิตช์: 1/true/on/yes/legacy (ทนช่องว่าง/อัญประกาศ/ตัวพิมพ์) = ถอย · ไม่ตั้ง/0/off/false/ค่าอื่น = ใหม่', async () => {
  for (const v of ['1', 'true', 'on', 'yes', 'legacy', ' 1 ', '"1"', 'TRUE', 'Legacy']) {
    await withEnv('SANITIZE_LEGACY', v, () => assert.equal(isSanitizeLegacy(), true, `ต้องถอย: ${JSON.stringify(v)}`));
  }
  for (const v of [undefined, '', '0', 'off', 'false', 'no', 'new', '2']) {
    await withEnv('SANITIZE_LEGACY', v, () => assert.equal(isSanitizeLegacy(), false, `ต้องใหม่: ${JSON.stringify(v)}`));
  }
  await withEnv('SANITIZE_LEGACY', '0', () => assert.equal(sanitizeOutput('ชายแดนประเทศพม่า'), 'ชายแดนประเทศพม่า', '=0 ต้องเป็นตัวกรองขอบคำ'));
});

// ═══ B) ค่าเริ่มต้น: ไม่กินกลางคำ · คำประสม/ราชาศัพท์/ชื่อเฉพาะ/ตัวเลข คงเดิม ═══
const MUST_NOT_TOUCH = [
  // กลางคำ (เดิมพังทุกเคส)
  'ชายแดนประเทศพม่า', 'บรรยากาศพิธีมอบรางวัล', 'ประกาศพื้นที่ประสบอุทกภัย', 'สภาพอากาศพรุ่งนี้', 'ทิศพายัพ', 'ต่างประเทศพบว่า',
  // คำประสม
  'เจ้าหน้าที่ฉีดยาฆ่าเชื้อทั่วบริเวณ', 'สารเคมียาฆ่าแมลงตกค้าง', 'เกษตรกรใช้ยาฆ่าหญ้า', 'นั่งฆ่าเวลาที่สนามบิน', 'นักฆ่ารับจ้าง',
  'ในงานศพของคุณพ่อ', 'ไปกราบหลุมศพพ่อ', 'บริจาคโลงศพ',
  // ราชาศัพท์
  'สวดพระอภิธรรมพระศพ', 'ถวายพระเพลิงพระบรมศพ', 'พระองค์ทรงฆ่าช้างศึกในสมรภูมิ',
  // ตัวอย่างในโจทย์ S1
  'อัตราตายตัว', 'ราคาตายตัว', 'ยิงยาว', 'โหดสัส',
  // ตัวเลข/ยอดพิมพ์
  'สั่งพิมพ์ 10 เล่ม', 'สั่งพิมพ์ 1,500 เล่ม', 'พิมพ์ 100 ใบ', 'เมนต์ 999',
  // ปฏิเสธ
  'เธอบอกว่าไม่อยากตาย อยากอยู่กับลูก', 'ไม่มีใครอยากตาย',
  // ชื่อรายการ/ชื่อเรื่องในเครื่องหมายคำพูด (สั้น)
  'รายการ "คดีฆาตกรรมที่โลกลืม"', 'ละครเรื่อง “ฆ่าไม่ตาย” ออกอากาศคืนนี้', 'หนังสือ «ศพใต้เตียง»',
];

test('B1 ค่าเริ่มต้น: ชุดคำที่ต้องไม่ถูกแตะ คงเดิมทุกตัวอักษร', async () => {
  await withEnv('SANITIZE_LEGACY', undefined, () => {
    for (const s of MUST_NOT_TOUCH) assert.equal(sanitizeOutput(s), s, `ห้ามแตะ: ${s}`);
  });
});

test('B2 ค่าเริ่มต้น: ข้อความข่าวยาวที่ปนคำประสม/ราชาศัพท์ — แทนเฉพาะคำเสี่ยงจริง ส่วนอื่นคงเดิม', async () => {
  await withEnv('SANITIZE_LEGACY', undefined, () => {
    const input = 'พยากรณ์อากาศพรุ่งนี้: ตำรวจพบศพชายในคลองใกล้ชายแดนประเทศพม่า ญาติเผยว่าเขาฆ่าตัวตาย ขณะที่ในงานศพมีการฉีดยาฆ่าเชื้อรอบบริเวณ';
    const out = sanitizeOutput(input);
    assert.equal(out, 'พยากรณ์อากาศพรุ่งนี้: ตำรวจพบร่างผู้เสียชีวิตชายในคลองใกล้ชายแดนประเทศพม่า ญาติเผยว่าเขาจากไปอย่างน่าเศร้า ขณะที่ในงานศพมีการฉีดยาฆ่าเชื้อรอบบริเวณ');
  });
});

// ═══ C) ค่าเริ่มต้น: ห้ามเพิ่มข้อเท็จจริงการตาย ═══
test('C1 ผูกคอแต่ช่วยทัน / กระโดดตึกแต่รอด → ต้องไม่มีคำว่าเสียชีวิต และคำเสี่ยงถูกแทน', async () => {
  await withEnv('SANITIZE_LEGACY', undefined, () => {
    const a = sanitizeOutput('ชายวัย 40 ผูกคอแต่เพื่อนบ้านช่วยไว้ทัน นำส่งโรงพยาบาลปลอดภัย');
    assert.equal(a, 'ชายวัย 40 ทำร้ายตัวเองแต่เพื่อนบ้านช่วยไว้ทัน นำส่งโรงพยาบาลปลอดภัย');
    assert.doesNotMatch(a, /เสียชีวิต/u);
    const b = sanitizeOutput('เขากระโดดตึกแต่รอดชีวิตอย่างปาฏิหาริย์');
    assert.equal(b, 'เขาตกจากที่สูงแต่รอดชีวิตอย่างปาฏิหาริย์');
    assert.doesNotMatch(b, /เสียชีวิต/u);
  });
});

test('C2 ฆ่าตัวตาย: ตายจริง → สำนวนสุภาพ · พยายาม/คิด/ขู่/ไม่ได้ → ทำร้ายตัวเอง (ไม่ยืนยันการตาย) · ไม่มีภาษาพังแบบเดิม', async () => {
  await withEnv('SANITIZE_LEGACY', undefined, () => {
    assert.equal(sanitizeOutput('ชายวัย 40 ฆ่าตัวตายในบ้านพัก'), 'ชายวัย 40 จากไปอย่างน่าเศร้าในบ้านพัก');
    assert.equal(sanitizeOutput('พยายามฆ่าตัวตายแต่ญาติช่วยทัน'), 'พยายามทำร้ายตัวเองแต่ญาติช่วยทัน');
    assert.equal(sanitizeOutput('คิดสั้นฆ่าตัวตาย'), 'คิดสั้นทำร้ายตัวเอง');
    assert.equal(sanitizeOutput('ขู่ฆ่าตัวตายหน้าห้อง'), 'ขู่ทำร้ายตัวเองหน้าห้อง');
    assert.equal(sanitizeOutput('ไม่ได้ฆ่าตัวตาย แต่ถูกฆ่า'), 'ไม่ได้ทำร้ายตัวเอง แต่ถูกทำให้เสียชีวิต');
    assert.equal(sanitizeOutput('พยายามผูกคอตายแต่ญาติช่วยทัน'), 'พยายามทำร้ายตัวเองแต่ญาติช่วยทัน');
    assert.equal(sanitizeOutput('พยายามจบชีวิตตัวเอง'), 'พยายามทำร้ายตัวเอง');
    assert.equal(sanitizeOutput('พบว่าผูกคอตายในห้อง'), 'พบว่าเสียชีวิตอย่างน่าเศร้าในห้อง', 'ตายจริงยังแทนเป็นถ้อยคำสุภาพได้');
    assert.equal(sanitizeOutput('กระโดดตึกตาย'), 'เสียชีวิตจากที่สูง');
  });
});

// ═══ D) ค่าเริ่มต้น: คำเสี่ยงเดี่ยวๆ ยังถูกแทน (ตัวกรองไม่ได้ถูกปิด) ═══
test('D1 คำเสี่ยงบนขอบคำยังถูกแทน · ตัวเลขข่าวไม่หาย · ลักษณนาม "3 ศพ" → "3 ราย"', async () => {
  await withEnv('SANITIZE_LEGACY', undefined, () => {
    const pairs = [
      ['ผู้ต้องหาสารภาพว่าฆ่าเหยื่อ', 'ผู้ต้องหาสารภาพว่าทำให้เสียชีวิตเหยื่อ'],
      ['ตำรวจพบศพชายในคลอง', 'ตำรวจพบร่างผู้เสียชีวิตชายในคลอง'],
      ['พบศพ', 'พบร่างผู้เสียชีวิต'],
      ['ซากศพ', 'ร่างผู้เสียชีวิต'],
      ['ผู้เสียชีวิต 3 ศพ', 'ผู้เสียชีวิต 3 ราย'],
      ['คดีฆาตกรรมต่อเนื่อง', 'คดีเหตุสูญเสียต่อเนื่อง'],
      ['ถูกยิงตายคาที่', 'ถูกใช้อาวุธปืนจนเสียชีวิตคาที่'],
      ['เหตุการณ์สยองขวัญ', 'เหตุการณ์สะเทือนขวัญ'],
      ['โหดร้าย', 'รุนแรง'],
      ['โหดเหี้ยม', 'รุนแรงอย่างยิ่ง'],
      ['เขาเคยบอกว่าอยากตาย', 'เขาเคยบอกว่าภาวะเครียดสะสม'],
      ['ข่มขืน', 'ล่วงละเมิดทางเพศ'],
      ['พิมพ์ 1 ถ้าเห็นด้วย', 'คุณคิดเห็นยังไง ถ้าเห็นด้วย'],
      ['เมนต์ 99 รับสิทธิ์', 'แสดงความเห็น รับสิทธิ์'],
      ['แชร์ด่วน คุณจะไม่เชื่อ', 'กลายเป็นประเด็น หลายคนพูดถึง'],
    ];
    for (const [input, expected] of pairs) assert.equal(sanitizeOutput(input), expected, `แทน: ${input}`);
    assert.doesNotMatch(sanitizeOutput('เขาฆ่าเหยื่อ'), /ฆ่า/u);
  });
});

test('D2 ข้อความในเครื่องหมายคำพูดยาวเกิน 40 ตัวอักษร = คำพูดคน ไม่ใช่ชื่อเรื่อง → ยังกรอง', async () => {
  await withEnv('SANITIZE_LEGACY', undefined, () => {
    const out = sanitizeOutput('เขาบอกว่า "ฉันจะฆ่าแกให้หมดทั้งบ้านทั้งตระกูลไม่ให้เหลือแม้แต่คนเดียว"');
    assert.doesNotMatch(out, /ฆ่า/u);
  });
});

// ═══ E) ขอบเขต scope ═══
test('E1 scope facts → คืน object เดิม (อ้างอิงเดิม ไม่แตะสักไบต์) · post/ไม่ส่ง → กรอง', async () => {
  await withEnv('SANITIZE_LEGACY', undefined, () => {
    const facts = { news_title: 'ชายวัย 40 ผูกคอแต่เพื่อนบ้านช่วยไว้ทัน', news_body: 'ตำรวจพบศพชายในคลอง', nested: ['ฆ่าตัวตาย'] };
    const snapshot = JSON.stringify(facts);
    assert.equal(sanitizeOutput(facts, { scope: 'facts' }), facts, 'facts ต้องคืน reference เดิม');
    assert.equal(JSON.stringify(facts), snapshot, 'facts ต้องไม่ถูกแก้ในที่');
    const post = sanitizeOutput(facts, { scope: 'post' });
    assert.notEqual(post, facts);
    assert.equal(post.news_title, 'ชายวัย 40 ทำร้ายตัวเองแต่เพื่อนบ้านช่วยไว้ทัน');
    assert.deepEqual(post.nested, ['จากไปอย่างน่าเศร้า']);
    assert.deepEqual(sanitizeOutput(facts), post, 'ไม่ส่ง scope = post');
    assert.deepEqual(sanitizeOutput(facts, {}), post);
    assert.deepEqual(sanitizeOutput(facts, { scope: 'unknown' }), post, 'ค่าไม่รู้จัก = กรอง (ปลอดภัยไว้ก่อน)');
  });
});

// ═══ H) รันไทม์ที่ไม่มี Intl.Segmenter ═══
test('H1 ไม่มีตัวตัดคำ → คำสั้น (ศพ/ฆ่า/โหด/สยอง) ไม่แตะ · วลีเจาะจง/คำประสม/ตัวเลข ยังปลอดภัย', async () => {
  await withEnv('SANITIZE_LEGACY', undefined, () => {
    const noSeg = (s) => sanitizeThaiText(s, { segmenter: null });
    assert.equal(noSeg('ชายแดนประเทศพม่า'), 'ชายแดนประเทศพม่า');
    assert.equal(noSeg('ถูกฆ่า'), 'ถูกฆ่า', 'คำสั้นไม่แตะเมื่อไม่มีขอบคำ (ดีกว่าแทนพลาด)');
    assert.equal(noSeg('ยาฆ่าเชื้อ'), 'ยาฆ่าเชื้อ');
    assert.equal(noSeg('พบศพชาย'), 'พบร่างผู้เสียชีวิตชาย', 'วลีเจาะจงยังแทน');
    assert.equal(noSeg('ผูกคอแต่ช่วยทัน'), 'ทำร้ายตัวเองแต่ช่วยทัน');
    assert.equal(noSeg('พยายามฆ่าตัวตาย'), 'พยายามทำร้ายตัวเอง');
    assert.equal(noSeg('ไม่อยากตาย'), 'ไม่อยากตาย');
    assert.equal(noSeg('สั่งพิมพ์ 10 เล่ม'), 'สั่งพิมพ์ 10 เล่ม');
    assert.equal(noSeg('สั่งพิมพ์ 1,500 เล่ม'), 'สั่งพิมพ์ 1,500 เล่ม');
    assert.equal(noSeg('พิมพ์ 1 ถ้าเห็นด้วย'), 'คุณคิดเห็นยังไง ถ้าเห็นด้วย');
    assert.equal(sanitizeThaiText('ไม่มีคำเสี่ยงเลย'), 'ไม่มีคำเสี่ยงเลย', 'ทางด่วน: ไม่มีคำเสี่ยง = คืนเดิม');
    assert.equal(sanitizeThaiText(''), '');
    assert.equal(sanitizeThaiText(null), null);
  });
});

// ═══ F) client จริง 3 ตัว — SDK ปลอม ไม่มี network · ตัวกรองจริง (ไม่ stub sanitizeOutput) ═══
const PAYLOAD = {
  news_title: 'ชายวัย 40 ผูกคอแต่เพื่อนบ้านช่วยไว้ทัน',
  news_body: 'ตำรวจพบศพชายในคลองใกล้ชายแดนประเทศพม่า',
  nested: ['ยาฆ่าเชื้อ', 'พิมพ์ 1 ถ้าเห็นด้วย'],
};
const EXPECTED_POST = {
  news_title: 'ชายวัย 40 ทำร้ายตัวเองแต่เพื่อนบ้านช่วยไว้ทัน',
  news_body: 'ตำรวจพบร่างผู้เสียชีวิตชายในคลองใกล้ชายแดนประเทศพม่า',
  nested: ['ยาฆ่าเชื้อ', 'คุณคิดเห็นยังไง ถ้าเห็นด้วย'],
};
const EXPECTED_LEGACY = {
  news_title: 'ชายวัย 40 เสียชีวิตอย่างน่าเศร้าแต่เพื่อนบ้านช่วยไว้ทัน',
  news_body: 'ตำรวจพบร่างผู้เสียชีวิตชายในคลองใกล้ชายแดนประเทร่างผู้เสียชีวิตม่า',
  nested: ['ยาทำให้เสียชีวิตเชื้อ', 'คุณคิดเห็นยังไง ถ้าเห็นด้วย'],
};
const payloadJson = () => JSON.stringify(PAYLOAD);

function replaceBlock(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error('หา block ไม่เจอ: ' + label);
  return source.slice(0, start) + replacement + source.slice(end + 2);
}
const stubCommonImports = (src) => src
  .replace("import { logApiUsage } from './usageLogger';", 'const logApiUsage = () => {};')
  .replace(/import \{ ironRule5LengthLine, legacyLengthRule \}[^\n]*\n/u, "const ironRule5LengthLine = () => ''; const legacyLengthRule = () => '';\n")
  .replace(/import \{ preparePipelineSignal, rethrowPipelineDeadline \}[^\n]*\n/u, 'const preparePipelineSignal = (signal) => signal; const rethrowPipelineDeadline = () => {};\n');

async function loadClients() {
  let openaiSrc = stubCommonImports(readSrc('../src/lib/ai/openai.js'))
    .replace("import OpenAI from 'openai';", 'class OpenAI {}')
    .replace("import { MODEL_PRIMARY } from './modelConfig.js';", "const MODEL_PRIMARY = 'gpt-5.6-sol';");
  openaiSrc = replaceBlock(openaiSrc, 'export function getOpenAIClient() {', '\n}\n\n/**\n * เรียก AI',
    'export function getOpenAIClient() { return { chat: { completions: { create: async () => ({ choices: [{ message: { content: globalThis.__S1_PAYLOAD_JSON__ } }], usage: {} }) } } }; }', 'openai client');
  let claudeSrc = stubCommonImports(readSrc('../src/lib/ai/claudeClient.js'))
    .replace("import Anthropic from '@anthropic-ai/sdk';", 'class Anthropic {}');
  claudeSrc = replaceBlock(claudeSrc, 'function getClaudeClient() {', '\n}\n\n/**\n * เรียก Claude',
    "function getClaudeClient() { return { messages: { create: async () => ({ stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: globalThis.__S1_PAYLOAD_JSON__ }] }) } }; }", 'claude client');
  let geminiSrc = stubCommonImports(readSrc('../src/lib/ai/geminiClient.js'))
    .replace("import { GoogleGenerativeAI } from '@google/generative-ai';", 'class GoogleGenerativeAI {}');
  geminiSrc = replaceBlock(geminiSrc, 'function getGeminiClient() {', '\n}\n\n// Google SDK รับ request options',
    'function getGeminiClient() { return { getGenerativeModel: () => ({ generateContent: async () => ({ response: { text: () => globalThis.__S1_PAYLOAD_JSON__, usageMetadata: {} } }) }) }; }', 'gemini client');
  // ตัวกรองจริง ไม่ stub — แค่เติม .js ให้ specifier (ESM ในโฟลเดอร์ชั่วคราวต้องมีนามสกุล) · import เดิมต้องอยู่ครบทั้ง 3 client
  const useRealFilter = (name, src) => {
    const from = "import { sanitizeOutput } from './safetyFilter';";
    if (!src.includes(from)) throw new Error(`${name}: import sanitizeOutput เดิมต้องอยู่ (ตัวกรองจริง ไม่ stub)`);
    return src.replace(from, "import { sanitizeOutput } from './safetyFilter.js';");
  };
  openaiSrc = useRealFilter('openai', openaiSrc);
  claudeSrc = useRealFilter('claude', claudeSrc);
  geminiSrc = useRealFilter('gemini', geminiSrc);
  if (MUTATION === 'client-drops-scope') {
    openaiSrc = mustReplace(openaiSrc, 'sanitizeOutput(parsed, { scope: sanitizeScope })', 'sanitizeOutput(parsed)', 'openai drops scope');
    claudeSrc = mustReplace(claudeSrc, 'sanitizeOutput(JSON.parse(jsonStr), { scope: sanitizeScope })', 'sanitizeOutput(JSON.parse(jsonStr))', 'claude drops scope');
    geminiSrc = mustReplace(geminiSrc, 'sanitizeOutput(JSON.parse(content), { scope: sanitizeScope })', 'sanitizeOutput(JSON.parse(content))', 'gemini drops scope');
  }
  const [openai, claude, gemini] = await Promise.all([
    importPatchedModule(openaiSrc, srcUrl('../src/lib/ai/openai.js'), 'openai-s1'),
    importPatchedModule(claudeSrc, srcUrl('../src/lib/ai/claudeClient.js'), 'claude-s1'),
    importPatchedModule(geminiSrc, srcUrl('../src/lib/ai/geminiClient.js'), 'gemini-s1'),
  ]);
  return {
    openai: (args) => openai.callAI({ prompt: 'x', model: 'gpt-5.6-sol', allowModelFallback: false, ...args }),
    claude: (args) => claude.callClaude({ prompt: 'x', model: 'claude-opus-4-8', ...args }),
    gemini: (args) => gemini.callGemini({ prompt: 'x', ...args }),
  };
}

test('F1 client จริง: sanitizeScope facts → ผลเท่า payload ดิบทุกไบต์ · ไม่ส่ง/post → ตัวกรองขอบคำ · SANITIZE_LEGACY=1 → ไบต์เดิม', async () => {
  const quiet = { log: console.log, warn: console.warn };
  console.log = () => {}; console.warn = () => {};
  try {
    const clients = await loadClients();
    globalThis.__S1_PAYLOAD_JSON__ = payloadJson();
    for (const [name, call] of Object.entries(clients)) {
      await withEnv('SANITIZE_LEGACY', undefined, async () => {
        assert.deepEqual({ ...await call({ sanitizeScope: 'facts' }) }, PAYLOAD, `${name}: facts ต้องไม่ถูกกรอง`);
        assert.deepEqual({ ...await call({}) }, EXPECTED_POST, `${name}: ไม่ส่ง scope = กรองขอบคำ`);
        assert.deepEqual({ ...await call({ sanitizeScope: 'post' }) }, EXPECTED_POST, `${name}: post = กรองขอบคำ`);
      });
      await withEnv('SANITIZE_LEGACY', '1', async () => {
        assert.deepEqual({ ...await call({ sanitizeScope: 'facts' }) }, EXPECTED_LEGACY, `${name}: legacy ไม่สน scope`);
        assert.deepEqual({ ...await call({}) }, EXPECTED_LEGACY, `${name}: legacy ไบต์เดิม`);
      });
    }
  } finally {
    console.log = quiet.log; console.warn = quiet.warn;
  }
});

// ═══ G) aiRouter จริง — stub 3 client บันทึก args (แม่แบบ tests/extract-claude-switch.test.mjs) ═══
async function loadRouter() {
  let src = readSrc('../src/lib/ai/aiRouter.js');
  src = mustReplace(src, "import { callClaude, isClaudeAvailable } from './claudeClient.js';", `
const isClaudeAvailable = () => true;
const callClaude = async (args) => { globalThis.__S1_CALLS__.push({ fn: 'claude', ...args }); return { content: 'c', _modelUsed: args.model }; };`, 'stub claude');
  src = mustReplace(src, /import \{ callGemini[^\n]*\n/u, `
const isGeminiAvailable = () => true;
const callGemini = async (args) => { globalThis.__S1_CALLS__.push({ fn: 'gemini', ...args }); return { content: 'g', _modelUsed: 'gemini-3.6-flash' }; };
`, 'stub gemini');
  src = mustReplace(src, "import { callAI } from './openai.js';", `
const callAI = async (args) => { globalThis.__S1_CALLS__.push({ fn: 'gpt', ...args }); return { content: 'o', _modelUsed: args.model }; };`, 'stub openai');
  src = mustReplace(src, /import \{ MODEL_PRIMARY[^\n]*\n/u, "const MODEL_PRIMARY = 'gpt-5.6-sol';\n", 'stub modelConfig');
  if (MUTATION === 'router-drops-scope') {
    src = mustReplace(src, 'const sanitizeScope = sanitizeScopeOpt || TASK_SANITIZE_SCOPE[task];', 'const sanitizeScope = undefined;', 'router drops scope');
  }
  return importPatchedModule(src, srcUrl('../src/lib/ai/aiRouter.js'), 'router-s1');
}

test('G1 aiRouter: extract/breakdown/analyze → facts ทุก client ในโซ่ · write → post (opus→fable→sol) · caller ส่งเองชนะ · task อื่น = ไม่กำหนด', async () => {
  const quiet = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  const priorExtract = process.env.EXTRACT_PRIMARY;
  try {
    process.env.EXTRACT_PRIMARY = 'claude';
    const router = await loadRouter();
    const run = async (task, opts = {}) => { globalThis.__S1_CALLS__ = []; await router.callSmartAI(task, { prompt: 'x', ...opts }); return globalThis.__S1_CALLS__; };

    const extract = await run('extract');
    assert.equal(extract[0].fn, 'claude');
    assert.equal(extract[0].sanitizeScope, 'facts', 'claude-extract ต้องได้ facts');
    const breakdown = await run('breakdown');
    assert.equal(breakdown[0].fn, 'gpt');
    assert.equal(breakdown[0].sanitizeScope, 'facts', 'breakdown ต้องได้ facts');
    const analyze = await run('analyze');
    assert.equal(analyze[0].sanitizeScope, 'facts', 'analyze (รีเสิร์ช) ต้องได้ facts');
    const write = await run('write');
    assert.equal(write[0].fn, 'claude');
    assert.equal(write[0].sanitizeScope, 'post', 'นักเขียนต้องได้ post');
    const override = await run('write', { sanitizeScope: 'facts' });
    assert.equal(override[0].sanitizeScope, 'facts', 'caller ส่งเองต้องชนะตาราง');
    const general = await run('general');
    assert.equal(general[0].sanitizeScope, undefined, 'task อื่นไม่กำหนด ให้ client ใช้ค่าเริ่มต้น');
    assert.equal(write[0].textNewsLengthPolicy, false, 'ห้ามกระทบสิทธิ์ความยาวเดิม');
  } finally {
    if (priorExtract === undefined) delete process.env.EXTRACT_PRIMARY; else process.env.EXTRACT_PRIMARY = priorExtract;
    console.log = quiet.log; console.warn = quiet.warn; console.error = quiet.error;
  }
});

test('G2 aiRouter: โซ่สกัดตกตัวสำรอง (gemini → gpt4o) ทุกไม้ยังได้ facts', async () => {
  const quiet = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  const priorExtract = process.env.EXTRACT_PRIMARY;
  try {
    delete process.env.EXTRACT_PRIMARY;
    const router = await loadRouter();
    globalThis.__S1_CALLS__ = [];
    await router.callSmartAI('extract', { prompt: 'x' });
    assert.equal(globalThis.__S1_CALLS__[0].fn, 'gemini');
    assert.equal(globalThis.__S1_CALLS__[0].sanitizeScope, 'facts');
  } finally {
    if (priorExtract === undefined) delete process.env.EXTRACT_PRIMARY; else process.env.EXTRACT_PRIMARY = priorExtract;
    console.log = quiet.log; console.warn = quiet.warn; console.error = quiet.error;
  }
});

// ═══ สายไฟในไฟล์ท่อข่าว: จุด "ข้อเท็จจริง" ต้องส่ง facts (กันใครถอดออกเงียบๆ) ═══
test('W1 summarizeServiceText/summarizeService: breakdown · blueprint · รีเสิร์ชสำรอง · DNA · สกัด legacy ส่ง sanitizeScope facts', () => {
  for (const rel of ['../src/lib/services/summarizeServiceText.js', '../src/lib/services/summarizeService.js']) {
    const src = readSrc(rel);
    const facts = (src.match(/sanitizeScope: 'facts'/gu) || []).length;
    assert.ok(facts >= 7, `${rel}: ต้องมีจุด facts อย่างน้อย 7 จุด (พบ ${facts})`);
    assert.match(src, /MODEL_BREAKDOWN|breakdown_gpt55_inner/u);
    assert.match(src, /maxTokens: 24000, signal: requestSignal, sanitizeScope: 'facts'|maxTokens: 24000, sanitizeScope: 'facts'/u, `${rel}: breakdown หลักต้องเป็น facts`);
    assert.match(src, /maxTokens: 8000,\n\s+(signal,\n\s+)?sanitizeScope: 'facts'/u, `${rel}: blueprint ต้องเป็น facts`);
    // ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S8 · เจ้าของอนุมัติ): สาย TEXT ต่อท้ายด้วย ...slimSystem(EXTRACT_SYSTEM_PROMPT) (system สั้นขั้นสกัด) · สาย URL ยังเป็นรูปเดิม — regex รับทั้งสองรูป · facts ยังต้องอยู่
    assert.match(src, /callAI\(\{ prompt, temperature: 0\.2, sanitizeScope: 'facts'(?:, \.\.\.slimSystem\(EXTRACT_SYSTEM_PROMPT\))? \}\)/u, `${rel}: สกัด legacy ต้องเป็น facts`);
  }
});
