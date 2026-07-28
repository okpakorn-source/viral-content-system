// ============================================================
// 🎯 pickBestRef — MEGA_REF_TAG_EXACT (29 ก.ค. 69, แก้ตามผลตรวจ Opus แบตช์ ref-category-rotation รอบ 2)
// ------------------------------------------------------------
// เดิม matchNewsType ให้ +3 เท่ากันหมดไม่ว่าตรงทั้งป้าย (exact) หรือแค่บางส่วน (substring/fragment) — ป้ายกว้าง
//   (เช่น "น้ำใจ") ยุบรวมแมตช์กับเคสที่ควรตรงป้ายเจาะจงกว่า (เช่น "น้ำใจคนดัง") เพราะเป็น substring ของกัน
// แก้: แยก 2 ระดับ — เป๊ะ (ป้ายทั้งก้อน = "คำ/วลี" ที่แยกด้วยช่องว่างได้ใน hay พอดี) = +3 · substring = +1
//   ใต้ MEGA_REF_TAG_EXACT default ON · ==='0' → พฤติกรรมเดิมทุก byte (+3 เท่ากันทั้งคู่ ไม่แยกระดับ)
// harness: เหมือน tests/pickbestref-fidelity.test.mjs (stub @/lib/refCoverLibrary, refCoverGrade ของจริง)
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);

const STUB_REFLIB = _mod('export async function listRefCovers(n){ return globalThis.__TEM_POOL || []; }');

const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/refCoverLibrary') return { url: ${JSON.stringify(STUB_REFLIB)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register(_mod(hook));

const { pickBestRef } = await import('../src/lib/refCoverMatch.js');

const LIB = path.join(__dirname, '..', 'data', 'ref-cover-library.json');
const library = JSON.parse(fs.readFileSync(LIB, 'utf8'));
const BASE_DNA = structuredClone(library[0].dna);

function mkRef(id, matchNewsType) {
  const dna = structuredClone(BASE_DNA);
  delete dna._templateGrade;
  delete dna._duplicateOf;
  delete dna._fidelity;
  dna._humanVerified = false;
  dna._reproducible = true;
  dna.matchNewsType = matchNewsType;
  return { id, imagePath: `/ref-covers/${id}.jpg`, dna };
}

const setEnv = (k, v) => { if (v === null) delete process.env[k]; else process.env[k] = v; };

// ★ ปิด fidelity bonus ตลอดทั้งไฟล์นี้ — เทสชุดนี้สนใจแค่ผลของ matchNewsType exact/substring ล้วนๆ
//   (ไม่มี _fidelity เลย → refFidelityBonus ปกติ = -3 ซึ่งจะหักคะแนนจน bestScore<=0 กลายเป็น "ไม่แมตช์" ผิดจุดสนใจ)
process.env.MEGA_REF_FIDELITY_PREF = '0';

test('MEGA_REF_TAG_EXACT default ON: ป้ายตรงเป๊ะ (เป็นคำ/วลีแยกช่องว่างใน hay พอดี) → +3', async () => {
  setEnv('MEGA_REF_TAG_EXACT', null);
  const ref = mkRef('REF-EXACT', ['กตัญญู']);
  globalThis.__TEM_POOL = [ref];
  const result = await pickBestRef({ text: 'กตัญญู ลูกดูแลแม่ยามแก่เฒ่า', emotion: '' });
  assert.equal(result.score, 3, 'matchNewsType exact +3 (fidelity ปิดสวิตช์ทั้งไฟล์นี้ = ไม่มีเทอมนี้ปน)');
  assert.ok(result.reason.includes('กตัญญู') && !result.reason.includes('บางส่วน'), 'ต้องระบุว่าแมตช์แบบเป๊ะ (ไม่มีคำว่า "บางส่วน" ต่อท้าย)');
});

test('MEGA_REF_TAG_EXACT default ON: ป้ายแค่ substring ฝังอยู่ในคำ/ประโยคยาว (ไม่ใช่วลีแยกเดี่ยว) → +1 เท่านั้น (ไม่ใช่ +3)', async () => {
  setEnv('MEGA_REF_TAG_EXACT', null);
  // ป้าย "รัก" เป็น substring ของคำ "ความรักคู่" ในเนื้อข่าว แต่ไม่ใช่ "วลีแยกช่องว่าง" ของ hay เอง (คำเดียวติดกันทั้งท่อน)
  const refExact = mkRef('REF-A', ['ความรักคู่']);      // ตรงเป๊ะกับ token "ความรักคู่" ใน hay
  const refSubstr = mkRef('REF-B', ['รัก']);            // แค่ substring ฝังอยู่ใน "ความรักคู่"
  globalThis.__TEM_POOL = [refExact, refSubstr];
  const resultA = await pickBestRef({ text: 'ความรักคู่ เรื่องเล่าวันวาน', emotion: '' });
  assert.equal(resultA.ref.id, 'REF-A', 'ป้ายตรงเป๊ะ (+3) ต้องชนะป้ายที่เป็นแค่ substring (+1) — gap 2 > MARGIN default 1');
});

test('MEGA_REF_TAG_EXACT default ON: กันการ "ยุบรวม" — ป้ายเจาะจง ("น้ำใจคนดัง") vs ป้ายกว้าง ("น้ำใจ") ต้องได้คะแนนต่างกันเมื่อ hay มีแค่วลีเจาะจง', async () => {
  setEnv('MEGA_REF_TAG_EXACT', null);
  const refSpecific = mkRef('REF-SPECIFIC', ['น้ำใจคนดัง']); // ตรงเป๊ะกับ token ใน hay
  const refGeneric = mkRef('REF-GENERIC', ['น้ำใจ']);        // เป็นแค่ substring ของ "น้ำใจคนดัง" ใน hay (ไม่ใช่วลีแยกเดี่ยว)
  globalThis.__TEM_POOL = [refSpecific, refGeneric];
  const result = await pickBestRef({ text: 'น้ำใจคนดัง ดาราควักเงินช่วยเหลือ', emotion: '' });
  assert.equal(result.ref.id, 'REF-SPECIFIC', 'ป้ายเจาะจงตรงเป๊ะต้องชนะป้ายกว้างที่เป็นแค่ substring (ไม่ยุบรวมเป็นคะแนนเท่ากันเหมือนเดิม)');
});

test('MEGA_REF_TAG_EXACT=0: พฤติกรรมเดิมทุก byte — ป้ายตรงเป๊ะและป้ายแค่ substring ได้ +3 เท่ากัน (ไม่แยกระดับ, ยุบรวมเหมือนเดิม)', async () => {
  setEnv('MEGA_REF_TAG_EXACT', '0');
  const refSpecific = mkRef('REF-SPECIFIC2', ['น้ำใจคนดัง']);
  const refGeneric = mkRef('REF-GENERIC2', ['น้ำใจ']);
  globalThis.__TEM_POOL = [refSpecific, refGeneric];
  const result = await pickBestRef({ text: 'น้ำใจคนดัง ดาราควักเงินช่วยเหลือ', emotion: '' });
  assert.match(result.reason, /สุ่ม 1\/2/, 'ปิดสวิตช์: คะแนนเท่ากันทั้งคู่ (+3 ทั้งคู่) → ต้องอยู่กลุ่มใกล้กัน/สุ่ม เหมือนพฤติกรรมเดิมก่อนแก้');
  setEnv('MEGA_REF_TAG_EXACT', null);
});

test('MEGA_REF_TAG_EXACT=0: substring fragment ก็ยัง +3 เหมือนเดิม (ไม่ลดเป็น +1)', async () => {
  setEnv('MEGA_REF_TAG_EXACT', '0');
  const ref = mkRef('REF-B2', ['รัก']);
  globalThis.__TEM_POOL = [ref];
  const result = await pickBestRef({ text: 'ความรักคู่ เรื่องเล่าวันวาน', emotion: '' });
  assert.equal(result.typeMatched, true);
  assert.ok(!result.reason.includes('บางส่วน'), 'ปิดสวิตช์ต้องไม่มีข้อความ "(บางส่วน)" เลย (ไม่แยกระดับ)');
  setEnv('MEGA_REF_TAG_EXACT', null);
});

test('MEGA_REF_TAG_EXACT: ไม่ตั้ง env (undefined) ได้ผลเหมือนตั้ง "1" ทุกประการ (default = ON)', async () => {
  const refSpecific = mkRef('REF-S3', ['น้ำใจคนดัง']);
  const refGeneric = mkRef('REF-G3', ['น้ำใจ']);
  globalThis.__TEM_POOL = [refSpecific, refGeneric];

  setEnv('MEGA_REF_TAG_EXACT', null);
  const resultUnset = await pickBestRef({ text: 'น้ำใจคนดัง ดาราควักเงินช่วยเหลือ', emotion: '' });

  const refSpecific2 = mkRef('REF-S3', ['น้ำใจคนดัง']);
  const refGeneric2 = mkRef('REF-G3', ['น้ำใจ']);
  globalThis.__TEM_POOL = [refSpecific2, refGeneric2];
  setEnv('MEGA_REF_TAG_EXACT', '1');
  const resultOne = await pickBestRef({ text: 'น้ำใจคนดัง ดาราควักเงินช่วยเหลือ', emotion: '' });

  assert.equal(resultUnset.ref.id, resultOne.ref.id);
  assert.equal(resultUnset.score, resultOne.score);
  setEnv('MEGA_REF_TAG_EXACT', null);
});

test('MEGA_REF_TAG_EXACT default ON: หลายป้ายตรงเป๊ะพร้อมกันในใบเดียว → บวกสะสม +3 ต่อป้าย (ไม่ผสมกับ substring ป้ายอื่นในใบเดียวกัน)', async () => {
  setEnv('MEGA_REF_TAG_EXACT', null);
  const ref = mkRef('REF-MULTI', ['กตัญญู', 'รัก']); // "กตัญญู" ตรงเป๊ะ (+3) · "รัก" แค่ substring ของ "รักษา" ใน hay (+1)
  globalThis.__TEM_POOL = [ref];
  const result = await pickBestRef({ text: 'กตัญญู คนไข้ที่หมอรักษาจนหาย', emotion: '' });
  assert.equal(result.score, 4, `คะแนนรวมต้องเป็น 3(exact กตัญญู)+1(substring รัก)=4 (ได้ ${result.score})`);
});
