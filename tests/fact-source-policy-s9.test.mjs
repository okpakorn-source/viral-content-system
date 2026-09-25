// 🔏 ข้อสอบนโยบายแหล่งข้อเท็จจริง (OV-05 / PL-23) — src/lib/ai/factSourcePolicy.js + narrativePayloadText.js (ใบสั่งนักเขียนสาย TEXT)
//   + กิ่ง breakdown ของ summarizeServiceText.js (รันโค้ดจริงของกิ่ง) + สายไฟ autoFlowServiceText.js
// ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S9 · เจ้าของอนุมัติ)
//
// บั๊กที่ปิด (ผู้ตรวจ 2 คนยืนยัน · ทดสอบซ้ำออฟไลน์จากโค้ดจริง):
//   OV-05 — สาย TEXT (ตัวที่รันจริง) สั่ง "ขยายความ/ยกตัวอย่าง" เมื่อ factSufficiency = 'insufficient' = ชวนแต่งเติม · สาย URL สั่ง "อย่าแต่งเพิ่ม"
//   PL-23 — พรอมต์แตกประเด็นครอบ "เนื้อที่ AI สกัดแล้ว" ด้วยหัว "เนื้อข่าวต้นฉบับ" และเรียกว่า RAW ทั้งที่ RAW จริงไปถึงเฉพาะนักเขียน/ด่าน
//
// สิ่งที่ล็อกไว้:
//   A. สวิตช์ NARRATIVE_LEGACY: ไม่ตั้ง/ว่าง/0/ค่าอื่น = ใหม่ · 1/true/on/yes/legacy (ทนช่องว่าง/อัญประกาศ/ตัวพิมพ์) = ถอย
//   B. OV-05 กับ formatNarrativePayload/buildNarrativePayload จริง (4 ข่าวไทย: อาชญากรรม/อุบัติเหตุ/ราชาศัพท์/สถานที่): insufficient → บรรทัดใหม่ (ไม่เติม เล่าเท่าที่มี สั้นได้)
//      · ถอย = บรรทัดเดิมทุกไบต์ · ใบสั่งต่างกัน "เฉพาะบรรทัดนั้น" · minimal/sufficient = ใบสั่งเท่ากันทุกไบต์ทั้ง 2 โหมด · ข้อความใหม่ขึ้นต้นเหมือนสาย URL
//   C. PL-23 buildBreakdownPrompt กับแม่แบบจริง (promptStoreText ไม่ถูกแตะ): ถอย = ห่วงโซ่ .replace เดิมทุกไบต์ · ใหม่+RAW = กรอบ RAW NEWS (boundary id + ประกาศไม่ใช่คำสั่ง)
//      ก่อนเนื้อที่สกัดแล้ว + ป้าย "เนื้อที่สกัดแล้ว" + นิยาม RAW ในกฎ · หัว/ท้ายที่เหลือเท่าเดิมทุกไบต์ · ไม่มี RAW = เนื้อที่สกัดแล้วคือ RAW · ตัด >12k ที่ขอบช่องว่างพร้อมบอกจำนวน
//      · boundary id คงที่/สุ่ม · "$&" ในเนื้อไม่ถูกตีความ · แม่แบบที่ผู้ใช้แก้ไม่โยน · breakdownRawSourceArgs ตามโหมด
//   D. กิ่ง breakdown ของ summarizeServiceText จริง (ตัดจากซอร์ส · callAI ปลอมจดพรอมต์): พรอมต์ที่ส่งจริง = ผล builder ทั้ง 2 โหมด · args อื่น (sanitizeScope/slimSystem) คงเดิม · debug.rawSource เฉพาะโหมดใหม่
//   E. สายไฟ: autoFlow spread ...breakdownRawSourceArgs(writerRawSourceText) ใน call แตกประเด็น · "rawSourceText: writerRawSourceText," ของนักเขียนยังมีครั้งเดียว (raw-first) · import ครบ · ห่วงโซ่เดิมไม่เหลือในกิ่ง
//   F. mutation 8 แบบ (แก้เฉพาะสำเนาในหน่วยความจำ · ต้องแดงทุกตัว): สวิตช์ไม่มีผลกับบรรทัด · narrativePayloadText ใช้ข้อความเดิม · builder ทิ้ง RAW · ไม่ตัด · ป้ายเดิม ·
//      โหมดถอยไม่ใช่ห่วงโซ่เดิม · กิ่ง breakdown ไม่ส่ง rawSourceText · autoFlow ไม่ส่ง spread
//
// วิธีรัน:  node --test tests/fact-source-policy-s9.test.mjs   (ไม่มี API/network · ไม่เขียนไฟล์ลง src — โหลดสำเนาผ่าน tests/helpers/temp-module.mjs)
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { importPatchedModule } from './helpers/temp-module.mjs';
import * as FSP from '../src/lib/ai/factSourcePolicy.js';
import * as NP from '../src/lib/input-engine/narrativePayloadText.js';
import { getPrompt } from '../src/lib/ai/promptStoreText.js';
import { slimSystem, BREAKDOWN_SYSTEM_PROMPT } from '../src/lib/ai/taskSystemPrompts.js';

const srcUrl = (rel) => new URL(rel, import.meta.url);
const readSrc = (rel) => readFileSync(srcUrl(rel), 'utf8').replace(/\r\n/g, '\n');
const mustReplace = (src, from, to, label) => {
  const out = src.replace(from, to);
  if (out === src) throw new Error('replace ไม่เกิดผล: ' + label);
  return out;
};
const withEnv = async (pairs, fn) => {
  const prior = {};
  for (const [name, value] of Object.entries(pairs)) {
    prior[name] = process.env[name];
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  try { return await fn(); } finally {
    for (const [name, value] of Object.entries(prior)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
};
const quiet = async (fn) => {
  const prior = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = prior.log; console.warn = prior.warn; console.error = prior.error; }
};
// ตัวแปรที่อาจรบกวนใบสั่งนักเขียน — ล็อกให้ว่างระหว่างทดสอบ (โหมดค่าเริ่มต้นของ production)
const BASE_ENV = { ALLOW_SIMULATION: undefined, LEGACY_LENGTH_RULES: undefined, HOOKS_AS_OPENERS: undefined, CARD_AUTHORITY_R3: undefined, HOOKS_OBJ_FIX: undefined, ANGLE_CLOSING_SPLIT: undefined, ANGLE_BLUEPRINT_MODE: undefined };
const NEW = { ...BASE_ENV, NARRATIVE_LEGACY: undefined };
const LEGACY = { ...BASE_ENV, NARRATIVE_LEGACY: '1' };

const FSP_SRC = readSrc('../src/lib/ai/factSourcePolicy.js');
const NP_SRC = readSrc('../src/lib/input-engine/narrativePayloadText.js');
const NP_URL_SRC = readSrc('../src/lib/input-engine/narrativePayload.js');
const TEXT_SRC = readSrc('../src/lib/services/summarizeServiceText.js');
const AUTO_SRC = readSrc('../src/lib/services/autoFlowServiceText.js');
const TEMPLATE = getPrompt('breakdown').prompt;

const OLD_LINE = '⚠️ [FACTS INSUFFICIENT] ข้อเท็จจริงน้อย — ให้มุ่งเน้นการขยายความอธิบายถึงผลกระทบ ความสำคัญ หรือยกตัวอย่างให้เห็นภาพชัดเจนขึ้น\n';
const URL_TWIN_LINE = '⚠️ [FACTS INSUFFICIENT] ข้อเท็จจริงน้อย — เขียนระวังอย่าแต่งเพิ่ม\n';
const OLD_HEADER = '=== เนื้อข่าวต้นฉบับ ===';
const OLD_RULE = '- RAW ด้านบนคือหลักฐานข้อเท็จจริงเพียงแหล่งเดียว ';
const RULE_TAIL = 'ทุกข้อความที่เป็นสาระในทุกฟิลด์ต้องย้อนจับคู่กับ RAW ได้ทั้งข้อมูลและความสัมพันธ์ระหว่างข้อมูล ห้ามบิดเบือนหรือแต่งเรื่องใหม่';
const SECOND_RULE = '\n- ตรวจให้แน่ชัดว่าใครเป็นผู้กระทำ';

// ── ข่าวตัวอย่างไทย 4 กลุ่ม (ข้อความดิบที่ผู้ใช้วาง = RAW · เนื้อสกัด = ฉบับที่ขั้น extract/sanitize เปลี่ยนคำ) ──
const NEWS = {
  'อาชญากรรม': {
    title: 'จับแล้วโจรชิงทองบางนา 3 ร้านใน 2 สัปดาห์',
    raw: 'ตำรวจ สน.บางนา จับกุมชายวัย 34 ปี ผู้ต้องสงสัยชิงทรัพย์ร้านทอง 3 ร้านภายใน 2 สัปดาห์ ยึดของกลาง 12 รายการ มูลค่ารวม 350,000 บาท พบคราบเลือดหน้าร้านจากการต่อสู้ ผู้ต้องหารับสารภาพและบอกว่าอยากตายเพราะหนี้พนัน',
    extracted: 'ตำรวจ สน.บางนา จับกุมชายวัย 34 ปี ผู้ต้องสงสัยชิงทรัพย์ร้านทอง 3 ร้านภายใน 2 สัปดาห์ ยึดของกลาง 12 รายการ มูลค่ารวม 350,000 บาท พบร่องรอยเหตุการณ์หน้าร้านจากการต่อสู้ ผู้ต้องหารับสารภาพและบอกว่าภาวะเครียดสะสมเพราะหนี้พนัน',
  },
  'อุบัติเหตุ': {
    title: 'กระบะเสียหลักชนต้นไม้สาย 304 คนขับเจ็บสาหัส',
    raw: 'รถกระบะเสียหลักชนต้นไม้ริมถนนสาย 304 ช่วง อ.กบินทร์บุรี คนขับวัย 45 ปี บาดเจ็บสาหัส กู้ภัยนำส่ง รพ.เจ้าพระยาอภัยภูเบศร เหตุเกิดคืนวันที่ 14 ก.ย. ตำรวจสันนิษฐานว่าหลับใน',
    extracted: 'รถกระบะเสียหลักชนต้นไม้ริมถนนสาย 304 ช่วง อ.กบินทร์บุรี คนขับวัย 45 ปี บาดเจ็บหนัก กู้ภัยนำส่ง รพ.เจ้าพระยาอภัยภูเบศร เหตุเกิดคืนวันที่ 14 ก.ย. ตำรวจสันนิษฐานว่าหลับใน',
  },
  'ราชาศัพท์': {
    title: 'ในหลวง-พระราชินี เสด็จฯ ทรงเปิดอาคารโรงพยาบาลแห่งใหม่',
    raw: 'พระบาทสมเด็จพระเจ้าอยู่หัว และสมเด็จพระนางเจ้าฯ พระบรมราชินี เสด็จพระราชดำเนินไปทรงเปิดอาคารโรงพยาบาลแห่งใหม่ โดยมีประชาชนเฝ้าฯ รับเสด็จจำนวนมาก ทรงมีพระราชดำรัสให้บุคลากรดูแลผู้ป่วยด้วยความเมตตา',
    extracted: 'พระบาทสมเด็จพระเจ้าอยู่หัว และสมเด็จพระนางเจ้าฯ พระบรมราชินี เสด็จพระราชดำเนินไปทรงเปิดอาคารโรงพยาบาลแห่งใหม่ มีประชาชนเฝ้าฯ รับเสด็จจำนวนมาก ทรงมีพระราชดำรัสให้บุคลากรดูแลผู้ป่วยด้วยความเมตตา',
  },
  'สถานที่': {
    title: 'น้ำท่วมฉับพลันบ้านโป่ง ชาวบ้านกว่า 200 คนอพยพขึ้นวัด',
    raw: 'น้ำท่วมฉับพลันในพื้นที่ ต.บ้านโป่ง อ.บ้านโป่ง จ.ราชบุรี หลังฝนตกหนักต่อเนื่อง 6 ชั่วโมง ถนนสายหลักถูกตัดขาด ชาวบ้านกว่า 200 คน อพยพไปพักที่ศาลาวัดบ้านโป่ง',
    extracted: 'น้ำท่วมฉับพลันในพื้นที่บ้านโป่ง หลังฝนตกหนักต่อเนื่อง 6 ชั่วโมง ถนนสายหลักถูกตัดขาด ชาวบ้านกว่า 200 คน อพยพไปพักที่ศาลาวัด',
  },
};
const CASES = Object.entries(NEWS);

// breakdown บาง (1 ประเด็น ไม่มีคน/ขัดแย้ง/ไทม์ไลน์) → factCount ≤ 2 = insufficient · breakdown ปกติ → sufficient · 3 ประเด็นล้วน → minimal
const thinBreakdown = (point) => ({ key_points: [{ point }], possible_angles: [{ angle_name: 'มุมเดียว', description: 'เล่าตามข้อเท็จจริงที่มี' }] });
const normalBreakdown = (point) => ({
  key_points: [{ point }, { point: 'ประเด็นที่สอง' }, { point: 'ประเด็นที่สาม' }],
  key_facts: { people: ['ผู้เกี่ยวข้อง ก'], dates: ['14 ก.ย. 2569'] },
  conflict_point: 'จุดขัดแย้งหลัก',
  possible_angles: [{ angle_name: 'มุมหลัก', description: 'เล่าตามข้อเท็จจริงที่มี' }],
});
const minimalBreakdown = (point) => ({ key_points: [{ point }, { point: 'ประเด็นที่สอง' }, { point: 'ประเด็นที่สาม' }] });

const writerPrompt = (np, title, breakdown, raw) => np.formatNarrativePayload(np.buildNarrativePayload(title, breakdown, null, null, raw));

// ── oracle OV-05 (รับ namespace ของ narrativePayloadText — ใช้ซ้ำกับสำเนาที่กลายพันธุ์) ──
async function assertOv05(np) {
  for (const [label, news] of CASES) {
    const thin = thinBreakdown(news.title);
    const payload = np.buildNarrativePayload(news.title, thin, null, null, news.raw);
    assert.equal(payload.factSufficiency, 'insufficient', `${label}: breakdown บางต้องได้ insufficient (ได้ factCount จาก key_points+คน+ขัดแย้ง+ไทม์ไลน์)`);
    const fresh = await withEnv(NEW, () => writerPrompt(np, news.title, thin, news.raw));
    const old = await withEnv(LEGACY, () => writerPrompt(np, news.title, thin, news.raw));
    assert.ok(fresh.includes(FSP.FACTS_INSUFFICIENT_LINE), `${label}: ค่าเริ่มต้นต้องมีบรรทัดใหม่`);
    assert.ok(!fresh.includes(OLD_LINE), `${label}: ค่าเริ่มต้นห้ามมีบรรทัดเดิม "ขยายความ/ยกตัวอย่าง"`);
    assert.ok(old.includes(OLD_LINE), `${label}: โหมดถอยต้องมีบรรทัดเดิมทุกไบต์`);
    assert.ok(!old.includes(FSP.FACTS_INSUFFICIENT_LINE), `${label}: โหมดถอยห้ามมีบรรทัดใหม่`);
    assert.equal(fresh.replace(FSP.FACTS_INSUFFICIENT_LINE, OLD_LINE), old, `${label}: ใบสั่ง 2 โหมดต้องต่างกันเฉพาะบรรทัด FACTS INSUFFICIENT`);
    assert.ok(fresh.includes('=== FACT SAFETY LAYER ===\n') && fresh.indexOf(FSP.FACTS_INSUFFICIENT_LINE) < fresh.indexOf('=== จบ FACT SAFETY ===\n'), `${label}: บรรทัดต้องอยู่ในบล็อก FACT SAFETY`);
  }
}

// ── oracle PL-23 (รับ namespace ของ factSourcePolicy) ──
function legacyChain(title, content, custom) {
  return TEMPLATE.replace('{title}', title).replace('{content}', content).replace('{custom_instruction}', custom);
}
async function assertLegacyChain(fsp) {
  for (const [label, news] of CASES) {
    for (const custom of ['', 'คำสั่งเพิ่มเติมจากผู้ใช้: "เน้นมุมครอบครัว"']) {
      const out = await withEnv(LEGACY, () => fsp.buildBreakdownPrompt({ template: TEMPLATE, title: news.title, content: news.extracted, customInstruction: custom, rawSourceText: news.raw }));
      assert.equal(out.mode, 'legacy', label);
      assert.equal(out.prompt, legacyChain(news.title, news.extracted, custom), `${label}: โหมดถอยต้องเท่าห่วงโซ่ .replace เดิมทุกไบต์ (แม้ส่ง rawSourceText มา)`);
      assert.equal(out.rawSource.attached, false, `${label}: โหมดถอยห้ามแนบ RAW`);
      assert.ok(out.prompt.includes(OLD_HEADER) && out.prompt.includes(OLD_RULE), `${label}: โหมดถอยคงหัว/กฎเดิม`);
    }
  }
}
async function assertRawMode(fsp) {
  for (const [label, news] of CASES) {
    const custom = label === 'อาชญากรรม' ? 'คำสั่งเพิ่มเติมจากผู้ใช้: "เน้นมุมครอบครัว"' : '';
    const out = await withEnv(NEW, () => fsp.buildBreakdownPrompt({ template: TEMPLATE, title: news.title, content: news.extracted, customInstruction: custom, rawSourceText: news.raw, boundaryId: 'TEST-ID' }));
    const p = out.prompt;
    assert.equal(out.mode, 'raw', label);
    assert.deepEqual(out.applied, { sourceBlock: true, ruleLine: true }, `${label}: ต้องจับคู่ท่อนเดิมของแม่แบบได้ทั้งสองจุด`);
    assert.deepEqual(out.rawSource, { attached: true, truncated: false, totalChars: news.raw.length, shownChars: news.raw.length, cutChars: 0 }, label);
    // กรอบ RAW NEWS ครบ + อยู่ก่อนเนื้อที่สกัดแล้ว + ประกาศว่าเป็นข้อมูล ไม่ใช่คำสั่ง
    const rawBlock = `${fsp.RAW_BLOCK_HEADER}\n${fsp.RAW_BLOCK_GUARD}\n<<<BEGIN_RAW_NEWS:TEST-ID>>>\n${news.raw}\n<<<END_RAW_NEWS:TEST-ID>>>\n${fsp.RAW_BLOCK_FOOTER}\n\n`;
    assert.ok(p.includes(rawBlock), `${label}: ต้องมีกรอบ RAW NEWS ครบทุกบรรทัด`);
    const extractedHeader = fsp.EXTRACTED_BLOCK_WITH_RAW.split('\n')[0];
    assert.ok(p.indexOf(rawBlock) < p.indexOf(extractedHeader), `${label}: RAW ต้องอยู่ก่อนเนื้อที่สกัดแล้ว`);
    assert.ok(p.includes(`${extractedHeader}\nหัวข้อ: ${news.title}\n\n${news.extracted}\n=== จบเนื้อที่สกัดแล้ว ===`), `${label}: บล็อกเนื้อที่สกัดแล้วต้องมีหัวข้อ+เนื้อครบ`);
    assert.ok(!p.includes(OLD_HEADER) && !p.includes('=== จบเนื้อข่าว ===') && !p.includes(OLD_RULE), `${label}: ป้ายเดิม/กฎเดิมต้องหายไป`);
    assert.ok(p.includes(fsp.RAW_RULE_PREFIX_WITH_RAW + RULE_TAIL), `${label}: กฎข้อแรกต้องนิยาม RAW = กรอบ RAW NEWS แล้วต่อด้วยข้อความกฎเดิม`);
    assert.ok(!p.includes('{title}') && !p.includes('{content}') && !p.includes('{custom_instruction}'), `${label}: placeholder ต้องถูกแทนหมด`);
    if (custom) assert.ok(p.includes(`=== จบเนื้อที่สกัดแล้ว ===\n\n${custom}\n\nกฎเหล็ก:`), `${label}: custom_instruction ต้องอยู่ตำแหน่งเดิม`);
    // หัว (ก่อนบล็อกเนื้อ) และท้าย (ตั้งแต่กฎข้อ 2) ต้องเท่าโหมดถอยทุกไบต์
    const old = legacyChain(news.title, news.extracted, custom);
    assert.equal(p.slice(0, p.indexOf(fsp.RAW_BLOCK_HEADER)), old.slice(0, old.indexOf(OLD_HEADER)), `${label}: หัวพรอมต์ต้องเท่าเดิม`);
    assert.equal(p.slice(p.indexOf(SECOND_RULE)), old.slice(old.indexOf(SECOND_RULE)), `${label}: ตั้งแต่กฎข้อ 2 ลงไปต้องเท่าเดิมทุกไบต์`);
    // เนื้อ RAW จริง (คำก่อน sanitize) ต้องอยู่ในพรอมต์ ไม่ใช่มีแต่ฉบับสกัด
    assert.ok(p.includes(news.raw), `${label}: RAW ต้องอยู่ครบไม่ถูกแก้`);
  }
}
async function assertExtractedOnly(fsp) {
  for (const [label, news] of CASES) {
    for (const raw of [undefined, '', '   \n ']) {
      const out = await withEnv(NEW, () => fsp.buildBreakdownPrompt({ template: TEMPLATE, title: news.title, content: news.extracted, customInstruction: '', rawSourceText: raw }));
      const p = out.prompt;
      assert.equal(out.mode, 'extracted-only', `${label} raw=${JSON.stringify(raw)}`);
      assert.equal(out.rawSource.attached, false, label);
      assert.ok(!p.includes('RAW_NEWS:') && !p.includes(fsp.RAW_BLOCK_HEADER), `${label}: ไม่มีข้อความดิบ = ห้ามมีกรอบ RAW`);
      assert.ok(p.includes(`${fsp.EXTRACTED_BLOCK_NO_RAW.split('\n')[0]}\nหัวข้อ: ${news.title}\n\n${news.extracted}\n=== จบเนื้อที่สกัดแล้ว ===`), `${label}: ป้ายเนื้อที่สกัดแล้ว (ไม่มีข้อความดิบ)`);
      assert.ok(p.includes(fsp.RAW_RULE_PREFIX_NO_RAW + RULE_TAIL), `${label}: กฎข้อแรกต้องบอกว่าเนื้อที่สกัดแล้วคือ RAW`);
      assert.ok(!p.includes(OLD_HEADER) && !p.includes(OLD_RULE), label);
      const old = legacyChain(news.title, news.extracted, '');
      assert.equal(p.slice(p.indexOf(SECOND_RULE)), old.slice(old.indexOf(SECOND_RULE)), `${label}: ท้ายเท่าเดิม`);
    }
  }
}
async function assertTruncation(fsp) {
  const big = 'ก'.repeat(5000) + ' ' + 'ข'.repeat(6900) + ' ' + 'TAILCUT' + 'ค'.repeat(2993); // 14,902 ตัวอักษร · ขอบช่องว่างล่าสุดก่อน 12,000 อยู่ที่ 11,901
  const out = await withEnv(NEW, () => fsp.buildBreakdownPrompt({ template: TEMPLATE, title: 'ยาว', content: 'เนื้อสกัดสั้น', customInstruction: '', rawSourceText: big, boundaryId: 'T' }));
  assert.equal(out.mode, 'raw');
  assert.deepEqual(out.rawSource, { attached: true, truncated: true, totalChars: 14902, shownChars: 11901, cutChars: 3001 }, 'ต้องตัดที่ขอบช่องว่างล่าสุดภายใน 200 ตัวอักษรก่อนเพดาน');
  assert.ok(out.rawSource.shownChars <= fsp.BREAKDOWN_RAW_MAX_CHARS, 'ห้ามเกินเพดาน');
  assert.ok(!out.prompt.includes('TAILCUT'), 'ส่วนท้ายที่ถูกตัดต้องไม่อยู่ในพรอมต์');
  assert.ok(out.prompt.includes(`<<<BEGIN_RAW_NEWS:T>>>\n${'ก'.repeat(5000)} ${'ข'.repeat(6900)}\n<<<END_RAW_NEWS:T>>>`), 'ส่วนที่แสดง = ถึงขอบช่องว่างล่าสุด ไม่มีช่องว่างท้าย');
  assert.ok(out.prompt.includes('<<<END_RAW_NEWS:T>>>\n⚠️ RAW ยาว 14,902 ตัวอักษร เกินเพดาน 12,000 — แสดง 11,901 ตัวอักษรแรก (ตัดท้าย 3,001 ตัวอักษร) · ส่วนที่ถูกตัดให้อ่านจากเนื้อที่สกัดแล้วด้านล่าง\n=== จบ RAW NEWS ==='), 'ต้องบอกจำนวนที่ตัดใต้กรอบ');
  assert.ok(out.prompt.includes(fsp.RAW_RULE_PREFIX_WITH_RAW_TRUNCATED + RULE_TAIL), 'กฎข้อแรกต้องบอกว่าส่วนท้ายที่ถูกตัดให้ใช้เนื้อที่สกัดแล้ว');
  // พอดีเพดาน = ไม่ตัด · ไม่มีขอบช่องว่าง = ตัดตรงเพดาน · เพดานกำหนดเองได้
  const exact = 'ง'.repeat(fsp.BREAKDOWN_RAW_MAX_CHARS);
  const okOut = await withEnv(NEW, () => fsp.buildBreakdownPrompt({ template: TEMPLATE, title: 'x', content: 'y', customInstruction: '', rawSourceText: exact, boundaryId: 'T' }));
  assert.deepEqual(okOut.rawSource, { attached: true, truncated: false, totalChars: 12000, shownChars: 12000, cutChars: 0 });
  assert.ok(okOut.prompt.includes(fsp.RAW_RULE_PREFIX_WITH_RAW + RULE_TAIL) && !okOut.prompt.includes('⚠️ RAW ยาว'), 'พอดีเพดาน = ไม่มีบรรทัดตัด');
  const noBreak = fsp.truncateRawForBreakdown('จ'.repeat(12500));
  assert.deepEqual(noBreak, { text: 'จ'.repeat(12000), truncated: true, totalChars: 12500, shownChars: 12000, cutChars: 500 }, 'ไม่มีขอบช่องว่าง = ตัดตรงเพดาน');
  const custom = fsp.truncateRawForBreakdown('หนึ่ง สอง สาม สี่ ห้า', 9);
  assert.deepEqual(custom, { text: 'หนึ่ง', truncated: true, totalChars: 21, shownChars: 5, cutChars: 16 }, 'เพดานเล็ก: ตัดที่ช่องว่างล่าสุด + ตัดช่องว่างท้าย');
}

// ── กิ่ง breakdown ของ summarizeServiceText จริง: ตัดจากซอร์ส รันด้วย dependency ที่ฉีด (callAI ปลอมจดพรอมต์ ไม่มี API) ──
function makeBreakdownBranch(serviceSource = TEXT_SRC) {
  const start = serviceSource.indexOf("  if (mode === 'breakdown') {");
  const end = serviceSource.indexOf('  // ===== MODE: analyze', start);
  assert.ok(start >= 0 && end > start, 'ไม่พบกิ่ง breakdown ในซอร์ส');
  const branch = serviceSource.slice(start, end);
  const body = [
    'return async function runBreakdown(args, deps) {',
    "  const { text, rawSourceText, newsTitle, customPrompt, workflowId, signal, mode = 'breakdown' } = args;",
    '  const { getPrompt, getWorkflow, withTimeoutSignal, callAI, MODEL_BREAKDOWN, MODEL_HEAVY_FALLBACK, slimSystem, BREAKDOWN_SYSTEM_PROMPT,',
    '    assertBreakdownAngleContract, rethrowPipelineDeadline, saveBreakdown, MasterAgent, logPipeline, buildBreakdownPrompt } = deps;',
    '  const _pipelineStart = Date.now();',
    branch,
    "  throw new Error('กิ่ง breakdown ไม่ return');",
    '};',
  ].join('\n');
  return new Function(body)();
}
const fourAngles = () => ({
  core_story: 'แก่นข่าว', key_points: [{ point: 'ก' }, { point: 'ข' }, { point: 'ค' }],
  best_main_angle: { angle_name: 'มุม 1', why_best: 'แรงสุด' },
  possible_angles: [1, 2, 3, 4].map((n) => ({ angle_name: `มุม ${n}`, description: `คำอธิบายมุม ${n}` })),
});
async function runBranch(branchFn, { text, rawSourceText, newsTitle, customPrompt, fsp = FSP }) {
  const calls = [];
  const deps = {
    getPrompt,
    getWorkflow: async () => null,
    withTimeoutSignal: async (fn, _ms, _label, sig) => fn(sig),
    callAI: async (args) => { calls.push(args); return fourAngles(); },
    MODEL_BREAKDOWN: 'gpt-5.6-sol', MODEL_HEAVY_FALLBACK: 'gpt-5.6-terra',
    slimSystem, BREAKDOWN_SYSTEM_PROMPT,
    assertBreakdownAngleContract: () => {},
    rethrowPipelineDeadline: () => {},
    saveBreakdown: async () => {}, MasterAgent: class {}, logPipeline: async () => {},
    buildBreakdownPrompt: (opts) => fsp.buildBreakdownPrompt({ ...opts, boundaryId: 'BRANCH-ID' }),
  };
  const result = await quiet(() => branchFn({ text, rawSourceText, newsTitle, customPrompt, workflowId: undefined, signal: undefined }, deps));
  return { result, calls };
}
async function assertBranchWiring(branchFn, fsp = FSP) {
  for (const [label, news] of CASES) {
    const fresh = await withEnv(NEW, () => runBranch(branchFn, { text: news.extracted, rawSourceText: news.raw, newsTitle: news.title, customPrompt: '', fsp }));
    assert.equal(fresh.calls.length, 1, label);
    const expectFresh = await withEnv(NEW, () => fsp.buildBreakdownPrompt({ template: TEMPLATE, title: news.title, content: news.extracted, customInstruction: '', rawSourceText: news.raw, boundaryId: 'BRANCH-ID' }));
    assert.equal(fresh.calls[0].prompt, expectFresh.prompt, `${label}: พรอมต์ที่กิ่งส่งให้ callAI ต้องเท่าผล builder (โหมดใหม่)`);
    assert.ok(fresh.calls[0].prompt.includes(`<<<BEGIN_RAW_NEWS:BRANCH-ID>>>\n${news.raw}\n<<<END_RAW_NEWS:BRANCH-ID>>>`), `${label}: RAW จริงต้องถึง callAI`);
    assert.equal(fresh.calls[0].sanitizeScope, 'facts', `${label}: args S1 คงเดิม`);
    assert.equal(fresh.calls[0].systemPrompt, BREAKDOWN_SYSTEM_PROMPT, `${label}: args S8 คงเดิม`);
    assert.equal(fresh.calls[0].model, 'gpt-5.6-sol');
    assert.equal(fresh.result.success, true);
    assert.deepEqual(fresh.result.debug.rawSource, { mode: 'raw', attached: true, truncated: false, totalChars: news.raw.length, shownChars: news.raw.length, cutChars: 0 }, `${label}: debug.rawSource`);
    assert.equal(fresh.result.data.possible_angles.length, 4);

    const old = await withEnv(LEGACY, () => runBranch(branchFn, { text: news.extracted, rawSourceText: news.raw, newsTitle: news.title, customPrompt: '', fsp }));
    assert.equal(old.calls[0].prompt, legacyChain(news.title, news.extracted, ''), `${label}: โหมดถอย พรอมต์ที่ส่งจริง = ห่วงโซ่เดิมทุกไบต์`);
    assert.ok(!('rawSource' in old.result.debug), `${label}: โหมดถอย debug รูปเดิม (ไม่มี rawSource)`);
    assert.deepEqual(Object.keys(old.result.debug), ['contextSource', 'newsBodyLength', 'promptLength', 'newsTitle'], label);
    assert.deepEqual(Object.keys(old.calls[0]).sort(), Object.keys(fresh.calls[0]).sort(), `${label}: keys ของ args callAI เท่ากันทั้ง 2 โหมด`);
  }
}
function assertAutoFlowWiring(autoSrc = AUTO_SRC) {
  const callStart = autoSrc.indexOf("mode: 'breakdown',");
  const callEnd = autoSrc.indexOf("}), 300000, 'breakdown');", callStart);
  assert.ok(callStart >= 0 && callEnd > callStart, 'ไม่พบ call แตกประเด็นใน autoFlowServiceText');
  const call = autoSrc.slice(callStart, callEnd);
  assert.match(call, /\.\.\.breakdownRawSourceArgs\(writerRawSourceText\),/, 'call แตกประเด็นต้อง spread breakdownRawSourceArgs(writerRawSourceText)');
  assert.doesNotMatch(call, /rawSourceText:\s*writerRawSourceText/, 'ห้ามใช้บรรทัดของนักเขียนซ้ำ (raw-first ล็อกว่ามีได้ครั้งเดียว)');
  assert.equal((autoSrc.match(/rawSourceText:\s*writerRawSourceText,/g) || []).length, 1, 'บรรทัดของนักเขียนต้องยังมีครั้งเดียว (tests/raw-first-prompt-authority)');
  assert.match(autoSrc, /import \{ breakdownRawSourceArgs \} from '@\/lib\/ai\/factSourcePolicy';/);
  assert.match(autoSrc, /if \(breakRes\.debug\?\.rawSource\?\.attached\) \{/, 'log ให้พนักงานเมื่อแนบ RAW');
}

// ═══ A) สวิตช์ ═══
test('A1 NARRATIVE_LEGACY: ไม่ตั้ง/ว่าง/0/ค่าอื่น = ใหม่ · 1/true/on/yes/legacy (ทนช่องว่าง/อัญประกาศ/ตัวพิมพ์) = ถอย', async () => {
  for (const v of [undefined, '', '  ', '0', 'off', 'false', 'no', 'new', 'x']) {
    await withEnv({ NARRATIVE_LEGACY: v }, () => assert.equal(FSP.isNarrativeLegacy(), false, `ต้องเป็นโหมดใหม่: ${JSON.stringify(v)}`));
  }
  for (const v of ['1', 'true', 'on', 'yes', 'legacy', ' 1 ', '"legacy"', 'ON', "'True'"]) {
    await withEnv({ NARRATIVE_LEGACY: v }, () => assert.equal(FSP.isNarrativeLegacy(), true, `ต้องถอย: ${JSON.stringify(v)}`));
  }
  await withEnv(NEW, () => assert.equal(FSP.factsInsufficientLine(), FSP.FACTS_INSUFFICIENT_LINE));
  await withEnv(LEGACY, () => assert.equal(FSP.factsInsufficientLine(), FSP.FACTS_INSUFFICIENT_LINE_LEGACY));
  assert.equal(FSP.FACTS_INSUFFICIENT_LINE_LEGACY, OLD_LINE, 'ข้อความโหมดถอยต้องเท่าบรรทัดเดิม 1cfdef43 ทุกไบต์');
});

// ═══ B) OV-05 ═══
test('B1 formatNarrativePayload จริง · 4 ข่าว · insufficient: ค่าเริ่มต้น = บรรทัดแบบสาย URL · ถอย = บรรทัดเดิมทุกไบต์ · ต่างกันเฉพาะบรรทัดนั้น', async () => {
  await assertOv05(NP);
});

test('B2 minimal/sufficient: ใบสั่งเท่ากันทุกไบต์ทั้ง 2 โหมด และไม่มีบรรทัด FACTS INSUFFICIENT (เปลี่ยนเฉพาะกรณี fact น้อย)', async () => {
  for (const [label, news] of CASES) {
    for (const [kind, bd, expected] of [['normal', normalBreakdown(news.title), 'sufficient'], ['minimal', minimalBreakdown(news.title), 'minimal']]) {
      const payload = NP.buildNarrativePayload(news.title, bd, null, null, news.raw);
      assert.equal(payload.factSufficiency, expected, `${label}/${kind}`);
      const fresh = await withEnv(NEW, () => writerPrompt(NP, news.title, bd, news.raw));
      const old = await withEnv(LEGACY, () => writerPrompt(NP, news.title, bd, news.raw));
      assert.equal(fresh, old, `${label}/${kind}: ต้องเท่ากันทุกไบต์`);
      assert.ok(!fresh.includes('[FACTS INSUFFICIENT]'), `${label}/${kind}: ไม่มีบรรทัด FACTS INSUFFICIENT`);
    }
  }
});

test('B3 ข้อความใหม่: ขึ้นต้นเหมือนสาย URL "เขียนระวังอย่าแต่งเพิ่ม" + เล่าเท่าที่มี + สั้นได้ (แถวขั้นต่ำของกฎความยาว) · ไม่มี "ขยายความ/ยกตัวอย่างให้เห็นภาพ" · ซอร์สสาย TEXT ไม่มีข้อความเดิมนอกคอมเมนต์', () => {
  assert.ok(NP_URL_SRC.includes(`p += '${URL_TWIN_LINE.replace('\n', '\\n')}';`), 'ไฟล์แฝดสาย URL ต้องยังมีบรรทัด "เขียนระวังอย่าแต่งเพิ่ม" (ไม่ถูกแตะ)');
  assert.ok(FSP.FACTS_INSUFFICIENT_LINE.startsWith(URL_TWIN_LINE.trim()), 'ต้องขึ้นต้นด้วยถ้อยคำเดียวกับสาย URL');
  for (const must of ['เล่าเท่าที่ข้อมูลมี', 'ห้ามยกตัวอย่าง ผลกระทบ หรือสถานการณ์ที่ต้นฉบับไม่ได้ให้มา', 'สั้นได้', 'ขั้นต่ำของกฎความยาว']) {
    assert.ok(FSP.FACTS_INSUFFICIENT_LINE.includes(must), `ต้องมี "${must}"`);
  }
  for (const banned of ['ขยายความ', 'ยกตัวอย่างให้เห็นภาพ', 'ความสำคัญ']) {
    assert.ok(!FSP.FACTS_INSUFFICIENT_LINE.includes(banned), `ห้ามมี "${banned}"`);
  }
  assert.ok(FSP.FACTS_INSUFFICIENT_LINE.endsWith('\n') && FSP.FACTS_INSUFFICIENT_LINE.startsWith('⚠️ [FACTS INSUFFICIENT] ข้อเท็จจริงน้อย — '), 'รูปบรรทัดเดิม (ป้าย + ขึ้นบรรทัดใหม่)');
  const code = NP_SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(code.includes("if (payload.factSufficiency === 'insufficient') {\n    p += factsInsufficientLine();\n  }"), 'สาย TEXT ต้องต่อบรรทัดจาก factsInsufficientLine()');
  assert.ok(!code.includes("p += '⚠️ [FACTS INSUFFICIENT]"), 'ห้ามมีข้อความฝังตายตัวในโค้ด (นอกคอมเมนต์)');
  assert.match(NP_SRC, /import \{ factsInsufficientLine \} from '\.\.\/ai\/factSourcePolicy\.js';/);
});

// ═══ C) PL-23 builder ═══
test('C1 โหมดถอย: buildBreakdownPrompt = ห่วงโซ่ .replace เดิมทุกไบต์ (4 ข่าว × มี/ไม่มี custom · แม้ส่ง rawSourceText)', async () => {
  await assertLegacyChain(FSP);
});

test('C2 ค่าเริ่มต้น + RAW: กรอบ RAW NEWS ก่อนเนื้อที่สกัดแล้ว · ป้ายใหม่ · นิยาม RAW ในกฎข้อแรก · หัว/ท้ายเท่าเดิมทุกไบต์ · RAW ครบไม่ถูกแก้', async () => {
  await assertRawMode(FSP);
});

test('C3 ค่าเริ่มต้น ไม่มี RAW (undefined/ว่าง/ช่องว่าง): ป้าย "เนื้อที่สกัดแล้ว" + นิยามว่าเนื้อที่สกัดแล้วคือ RAW · ไม่มีกรอบ · ท้ายเท่าเดิม', async () => {
  await assertExtractedOnly(FSP);
});

test('C4 RAW เกิน 12,000 ตัวอักษร: ตัดที่ขอบช่องว่างล่าสุด (ย้อน ≤200) + บรรทัดบอกจำนวน + กฎข้อแรกบอกให้ใช้เนื้อที่สกัดแล้วแทนส่วนที่ตัด · พอดีเพดานไม่ตัด · ไม่มีขอบ = ตัดตรงเพดาน', async () => {
  await assertTruncation(FSP);
});

test('C5 boundary id: ระบุ = คงที่ · ไม่ระบุ = UUID สุ่ม (สองครั้งไม่เท่ากัน · ขอบเปิด/ปิด id เดียวกัน)', async () => {
  const raw = NEWS['สถานที่'].raw;
  const a = await withEnv(NEW, () => FSP.buildBreakdownPrompt({ template: TEMPLATE, title: 'x', content: 'y', customInstruction: '', rawSourceText: raw, boundaryId: 'FIX' }));
  const b = await withEnv(NEW, () => FSP.buildBreakdownPrompt({ template: TEMPLATE, title: 'x', content: 'y', customInstruction: '', rawSourceText: raw, boundaryId: 'FIX' }));
  assert.equal(a.prompt, b.prompt, 'boundary id คงที่ = deterministic');
  const c = await withEnv(NEW, () => FSP.buildBreakdownPrompt({ template: TEMPLATE, title: 'x', content: 'y', customInstruction: '', rawSourceText: raw }));
  const d = await withEnv(NEW, () => FSP.buildBreakdownPrompt({ template: TEMPLATE, title: 'x', content: 'y', customInstruction: '', rawSourceText: raw }));
  const idOf = (p) => { const m = p.match(/<<<BEGIN_RAW_NEWS:([0-9a-f-]{36})>>>\n[\s\S]*?\n<<<END_RAW_NEWS:\1>>>/u); assert.ok(m, 'ต้องมีขอบเปิด/ปิด id เดียวกันรูป UUID'); return m[1]; };
  assert.notEqual(idOf(c.prompt), idOf(d.prompt), 'ไม่ระบุ = สุ่มใหม่ทุกครั้ง (กันข่าวปลอมขอบกรอบ)');
});

test('C6 ค่าที่มี $-pattern ("$&", "$\'", "$1") ในเนื้อ/RAW/หัวข้อ: โหมดใหม่คงตัวอักษรตรงตัว · โหมดถอย = พฤติกรรม String.replace เดิม (ตรงห่วงโซ่เดิม)', async () => {
  const content = 'ราคาทอง $1,000 และเครื่องหมาย $& กับ $\' ท้ายประโยค';
  const raw = 'RAW มี $& ด้วย';
  const title = 'หัว $&';
  const fresh = await withEnv(NEW, () => FSP.buildBreakdownPrompt({ template: TEMPLATE, title, content, customInstruction: 'คำสั่ง $&', rawSourceText: raw, boundaryId: 'D' }));
  assert.ok(fresh.prompt.includes(`\nหัวข้อ: ${title}\n\n${content}\n=== จบเนื้อที่สกัดแล้ว ===\n\nคำสั่ง $&\n\nกฎเหล็ก:`), 'โหมดใหม่: ค่าถูกวางตรงตัว ไม่ถูกตีความเป็น $-pattern');
  assert.ok(fresh.prompt.includes(`<<<BEGIN_RAW_NEWS:D>>>\n${raw}\n<<<END_RAW_NEWS:D>>>`), 'RAW ตรงตัว');
  const old = await withEnv(LEGACY, () => FSP.buildBreakdownPrompt({ template: TEMPLATE, title, content, customInstruction: 'คำสั่ง $&', rawSourceText: raw }));
  assert.equal(old.prompt, legacyChain(title, content, 'คำสั่ง $&'), 'โหมดถอยต้องตรงห่วงโซ่เดิม (รวมพฤติกรรม $-pattern เดิม)');
});

test('C7 แม่แบบที่ผู้ใช้แก้จนไม่มีท่อนเดิม: ไม่โยน · แทนที่ค่าตามปกติ · วางกรอบ RAW + นิยามไว้บนสุด · applied รายงานว่าไม่ได้จับคู่', async () => {
  const edited = 'พรอมต์ที่ผู้ใช้เขียนเอง\nหัวข้อ: {title}\nเนื้อ: {content}\n{custom_instruction}\nจบ';
  const out = await withEnv(NEW, () => FSP.buildBreakdownPrompt({ template: edited, title: 'T', content: 'C', customInstruction: 'X', rawSourceText: 'RAW-EDITED', boundaryId: 'E' }));
  assert.deepEqual(out.applied, { sourceBlock: false, ruleLine: false });
  assert.equal(out.mode, 'raw');
  assert.ok(out.prompt.startsWith(`${FSP.RAW_BLOCK_HEADER}\n${FSP.RAW_BLOCK_GUARD}\n<<<BEGIN_RAW_NEWS:E>>>\nRAW-EDITED\n<<<END_RAW_NEWS:E>>>\n${FSP.RAW_BLOCK_FOOTER}\n${FSP.RAW_RULE_PREFIX_WITH_RAW.trim()}\n\nพรอมต์ที่ผู้ใช้เขียนเอง\nหัวข้อ: T\nเนื้อ: C\nX\nจบ`), out.prompt);
  const noRaw = await withEnv(NEW, () => FSP.buildBreakdownPrompt({ template: edited, title: 'T', content: 'C', customInstruction: 'X' }));
  assert.equal(noRaw.prompt, 'พรอมต์ที่ผู้ใช้เขียนเอง\nหัวข้อ: T\nเนื้อ: C\nX\nจบ');
  const old = await withEnv(LEGACY, () => FSP.buildBreakdownPrompt({ template: edited, title: 'T', content: 'C', customInstruction: 'X', rawSourceText: 'RAW-EDITED' }));
  assert.equal(old.prompt, 'พรอมต์ที่ผู้ใช้เขียนเอง\nหัวข้อ: T\nเนื้อ: C\nX\nจบ');
});

test('C8 breakdownRawSourceArgs: ค่าเริ่มต้น = { rawSourceText } เมื่อมีข้อความ · ไม่มี/ว่าง/ช่องว่าง = {} · โหมดถอย = {} เสมอ (args เดิมทุกไบต์)', async () => {
  await withEnv(NEW, () => {
    assert.deepEqual(FSP.breakdownRawSourceArgs('ข้อความดิบ'), { rawSourceText: 'ข้อความดิบ' });
    for (const v of [undefined, null, '', '  \n', 42]) assert.deepEqual(FSP.breakdownRawSourceArgs(v), {}, JSON.stringify(v));
  });
  await withEnv(LEGACY, () => {
    assert.deepEqual(FSP.breakdownRawSourceArgs('ข้อความดิบ'), {});
    assert.deepEqual(FSP.breakdownRawSourceArgs(undefined), {});
  });
});

// ═══ D) กิ่ง breakdown ของ summarizeServiceText จริง ═══
test('D1 กิ่ง breakdown จริง (callAI ปลอม): พรอมต์ที่ส่งจริง = ผล builder ทั้ง 2 โหมด · RAW ถึง callAI · args S1/S8 คงเดิม · debug.rawSource เฉพาะโหมดใหม่', async () => {
  await assertBranchWiring(makeBreakdownBranch());
});

test('D2 กิ่ง breakdown: ถอย (getWorkflow คืน DB ที่ยาวกว่า) ยังใช้ builder กับเนื้อจาก DB และ RAW เดิม', async () => {
  const branch = makeBreakdownBranch();
  const news = NEWS['อุบัติเหตุ'];
  const dbBody = news.extracted + ' (ฉบับเต็มจาก DB ยาวกว่า)';
  const calls = [];
  const deps = {
    getPrompt, getWorkflow: async () => ({ newsBody: dbBody, newsTitle: 'หัวข้อจาก DB' }),
    withTimeoutSignal: async (fn) => fn(undefined), callAI: async (args) => { calls.push(args); return fourAngles(); },
    MODEL_BREAKDOWN: 'gpt-5.6-sol', MODEL_HEAVY_FALLBACK: 'gpt-5.6-terra', slimSystem, BREAKDOWN_SYSTEM_PROMPT,
    assertBreakdownAngleContract: () => {}, rethrowPipelineDeadline: () => {},
    saveBreakdown: async () => {}, MasterAgent: class { async loadFromDB() {} onBreakdownComplete() {} async saveMemoryToDB() {} }, logPipeline: async () => {},
    buildBreakdownPrompt: (opts) => FSP.buildBreakdownPrompt({ ...opts, boundaryId: 'DB' }),
  };
  const res = await withEnv(NEW, () => quiet(() => branch({ text: news.extracted, rawSourceText: news.raw, newsTitle: news.title, customPrompt: '', workflowId: 'wf-1', signal: undefined }, deps)));
  const expected = await withEnv(NEW, () => FSP.buildBreakdownPrompt({ template: TEMPLATE, title: 'หัวข้อจาก DB', content: dbBody, customInstruction: '', rawSourceText: news.raw, boundaryId: 'DB' }));
  assert.equal(calls[0].prompt, expected.prompt);
  assert.equal(res.debug.contextSource, 'DB (workflow)');
  assert.equal(res.debug.rawSource.attached, true);
});

// ═══ E) สายไฟ ═══
test('E1 autoFlowServiceText: call แตกประเด็น spread breakdownRawSourceArgs(writerRawSourceText) · บรรทัดของนักเขียนยังมีครั้งเดียว · import + log', () => {
  assertAutoFlowWiring(AUTO_SRC);
});

test('E2 summarizeServiceText: กิ่ง breakdown ใช้ buildBreakdownPrompt พร้อม rawSourceText · ห่วงโซ่เดิมไม่เหลือในกิ่ง · import · สัญญา 4 มุม/args S1/S8 ยังอยู่', () => {
  const start = TEXT_SRC.indexOf("  if (mode === 'breakdown') {");
  const end = TEXT_SRC.indexOf('  // ===== MODE: analyze', start);
  const branch = TEXT_SRC.slice(start, end);
  assert.match(branch, /const _bdBuild = buildBreakdownPrompt\(\{\n\s+template: breakdownPrompt\.prompt,\n\s+title: actualNewsTitle \|\| actualNewsBody\.slice\(0, 100\),\n\s+content: actualNewsBody,\n\s+customInstruction: customPrompt \? `คำสั่งเพิ่มเติมจากผู้ใช้: "\$\{customPrompt\}"` : '',\n\s+rawSourceText,\n\s+\}\);/u);
  assert.match(branch, /const prompt = _bdBuild\.prompt;/);
  const code = branch.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /\.replace\('\{content\}', actualNewsBody\)/, 'ห่วงโซ่เดิมต้องไม่เหลือในโค้ดของกิ่ง (อยู่ใน builder โหมดถอยแทน)');
  assert.equal((branch.match(/assertBreakdownAngleContract\(result\);/g) || []).length, 2);
  assert.equal((branch.match(/sanitizeScope: 'facts', \.\.\.slimSystem\(BREAKDOWN_SYSTEM_PROMPT\)/g) || []).length, 2);
  assert.match(TEXT_SRC, /import \{ buildBreakdownPrompt \} from '@\/lib\/ai\/factSourcePolicy';/);
  assert.match(branch, /\.\.\.\(_bdBuild\.mode !== 'legacy' \? \{ rawSource: \{ mode: _bdBuild\.mode, \.\.\._bdBuild\.rawSource \} \} : \{\}\),/);
});

// ═══ F) mutation — แก้เฉพาะสำเนาในหน่วยความจำ ต้องแดงทุกตัว ═══
test('F1 mutation: factsInsufficientLine ไม่สนสวิตช์ (คืนบรรทัดใหม่เสมอ) → oracle โหมดถอยต้องแดง', async () => {
  const mutated = mustReplace(FSP_SRC, 'return isNarrativeLegacy() ? FACTS_INSUFFICIENT_LINE_LEGACY : FACTS_INSUFFICIENT_LINE;', 'return FACTS_INSUFFICIENT_LINE;', 'F1');
  const fsp = await importPatchedModule(mutated, srcUrl('../src/lib/ai/factSourcePolicy.js'), 'fsp-f1');
  await withEnv(LEGACY, () => assert.equal(fsp.factsInsufficientLine(), FSP.FACTS_INSUFFICIENT_LINE, 'mutant ต้องคืนบรรทัดใหม่แม้ถอย'));
  const npSrc = mustReplace(NP_SRC, "from '../ai/factSourcePolicy.js'", "from './__fsp_f1__.js'", 'F1 link');
  // ต่อสาย narrativePayloadText → factSourcePolicy ที่กลายพันธุ์ ผ่านโฟลเดอร์ชั่วคราวเดียวกัน
  const { importPatchedGraph } = await import('./helpers/temp-module.mjs');
  const graph = await importPatchedGraph({
    fsp: { source: mutated, originalUrl: srcUrl('../src/lib/ai/factSourcePolicy.js') },
    np: { source: npSrc, originalUrl: srcUrl('../src/lib/input-engine/narrativePayloadText.js'), links: { './__fsp_f1__.js': 'fsp' } },
  });
  await assert.rejects(() => assertOv05(graph.np), /โหมดถอยต้องมีบรรทัดเดิมทุกไบต์/);
});

test('F2 mutation: narrativePayloadText กลับไปใช้ข้อความเดิมฝังตายตัว → oracle ค่าเริ่มต้นต้องแดง', async () => {
  const mutated = mustReplace(NP_SRC, 'p += factsInsufficientLine();', `p += '${OLD_LINE.replace('\n', '\\n')}';`, 'F2');
  const np = await importPatchedModule(mutated, srcUrl('../src/lib/input-engine/narrativePayloadText.js'), 'np-f2');
  await assert.rejects(() => assertOv05(np), /ค่าเริ่มต้นต้องมีบรรทัดใหม่/);
});

test('F3 mutation: builder ทิ้ง rawSourceText → oracle โหมด RAW ต้องแดง (และกิ่ง breakdown จริงที่ใช้ builder นี้ก็แดง)', async () => {
  const mutated = mustReplace(FSP_SRC, 'const raw = buildBreakdownRawBlock(rawSourceText, { boundaryId, maxChars });', 'const raw = buildBreakdownRawBlock(undefined, { boundaryId, maxChars });', 'F3');
  const fsp = await importPatchedModule(mutated, srcUrl('../src/lib/ai/factSourcePolicy.js'), 'fsp-f3');
  await assert.rejects(() => assertRawMode(fsp), /raw/u);
  await assert.rejects(() => assertBranchWiring(makeBreakdownBranch(), fsp), /RAW จริงต้องถึง callAI|debug\.rawSource/u);
});

test('F4 mutation: ไม่ตัด RAW ที่เกินเพดาน → oracle ตัดต้องแดง', async () => {
  const mutated = mustReplace(FSP_SRC, 'if (!(cap > 0) || totalChars <= cap) {', 'if (true) {', 'F4');
  const fsp = await importPatchedModule(mutated, srcUrl('../src/lib/ai/factSourcePolicy.js'), 'fsp-f4');
  await assert.rejects(() => assertTruncation(fsp), /ตัดที่ขอบช่องว่าง/u);
});

test('F5 mutation: ป้ายเนื้อยังเป็น "เนื้อข่าวต้นฉบับ" → oracle ป้ายใหม่ต้องแดง', async () => {
  const mutated = mustReplace(FSP_SRC,
    "export const EXTRACTED_BLOCK_WITH_RAW = '=== เนื้อที่สกัดแล้ว (AI สกัดจาก RAW NEWS ด้านบน — ใช้ช่วยอ่าน ไม่ใช่หลักฐาน · ขัดกับ RAW ให้ยึด RAW) ===",
    "export const EXTRACTED_BLOCK_WITH_RAW = '=== เนื้อข่าวต้นฉบับ ===", 'F5');
  const fsp = await importPatchedModule(mutated, srcUrl('../src/lib/ai/factSourcePolicy.js'), 'fsp-f5');
  await assert.rejects(() => assertRawMode(fsp), /ป้ายเดิม\/กฎเดิมต้องหายไป|บล็อกเนื้อที่สกัดแล้ว/u);
});

test('F6 mutation: โหมดถอยไม่ใช่ห่วงโซ่เดิม (ถอดกิ่ง isNarrativeLegacy ใน builder) → oracle โหมดถอยต้องแดง', async () => {
  const mutated = mustReplace(FSP_SRC, '  if (isNarrativeLegacy()) {\n    const prompt = tpl', '  if (false) {\n    const prompt = tpl', 'F6');
  const fsp = await importPatchedModule(mutated, srcUrl('../src/lib/ai/factSourcePolicy.js'), 'fsp-f6');
  await assert.rejects(() => assertLegacyChain(fsp), /legacy|โหมดถอย/u);
});

test('F7 mutation: กิ่ง breakdown ไม่ส่ง rawSourceText เข้า builder → oracle กิ่งจริงต้องแดง', async () => {
  const mutated = mustReplace(TEXT_SRC, '      content: actualNewsBody,\n      customInstruction: customPrompt ? `คำสั่งเพิ่มเติมจากผู้ใช้: "${customPrompt}"` : \'\',\n      rawSourceText,\n    });',
    '      content: actualNewsBody,\n      customInstruction: customPrompt ? `คำสั่งเพิ่มเติมจากผู้ใช้: "${customPrompt}"` : \'\',\n    });', 'F7');
  await assert.rejects(() => assertBranchWiring(makeBreakdownBranch(mutated)), /พรอมต์ที่กิ่งส่งให้ callAI ต้องเท่าผล builder/u);
});

test('F8 mutation: autoFlow ไม่ spread breakdownRawSourceArgs → oracle สายไฟต้องแดง · ใช้บรรทัดของนักเขียนซ้ำ → raw-first แดง', () => {
  const removed = mustReplace(AUTO_SRC, '    ...breakdownRawSourceArgs(writerRawSourceText),\n', '', 'F8a');
  assert.throws(() => assertAutoFlowWiring(removed), /spread breakdownRawSourceArgs/u);
  const swapped = mustReplace(AUTO_SRC, '    ...breakdownRawSourceArgs(writerRawSourceText),\n', '    rawSourceText: writerRawSourceText,\n', 'F8b');
  assert.throws(() => assertAutoFlowWiring(swapped), /spread breakdownRawSourceArgs|ห้ามใช้บรรทัดของนักเขียนซ้ำ/u);
  const duplicated = mustReplace(AUTO_SRC, '    ...breakdownRawSourceArgs(writerRawSourceText),\n', '    ...breakdownRawSourceArgs(writerRawSourceText),\n    rawSourceText: writerRawSourceText,\n', 'F8c');
  assert.throws(() => assertAutoFlowWiring(duplicated), /ห้ามใช้บรรทัดของนักเขียนซ้ำ/u);
});
