// ============================================================
// 🎲 seedKey variety (29 ก.ค. 69, แบตช์ variety — Opus ตรวจ 3 รอบ ก่อนผ่าน) — refCoverMatch.js / megaAdapters.js /
//   refTestPipeline.js / quick-test route.js / cover-ref-test route.js / compose-test route.js
// ------------------------------------------------------------
// รอบ 1: ผูก job.id เข้า seedKey ที่ 3 จุด (compose-test route + megaAdapters S6/S7) กันเคสเดิมได้ ref เดิม
//   ตลอดกาล — รอบ 2 (Opus FAIL): เส้นเต็มท่อ (refTestPipeline.js) synthesize job.id ใหม่ทุก HTTP request
//   (REFTEST-...) ทำให้ retry รอบ 2-6 ของงานเดียวกันได้ ref คนละใบ → แก้ด้วย job.varietySeed (ต้นทางจริงจาก
//   quick-test) แยกจาก job.id เฉพาะกิจ
// รอบ 3 (Opus ตรวจซ้ำ พบ FAIL แคบๆ 2 จุด) — แก้:
//   1) [หลัก] S7 HEAD เดิม "ไม่เคยส่ง opts.seedKey เลย" (ตกไป signals.newsTitle → JSON.stringify(signals))
//      — รอบ 2 เปลี่ยนเป็นส่ง seedKey แบบ title-based เสมอแม้ไม่มี varietySeed จริง/สวิตช์ปิด → hash ต้นทาง
//      เปลี่ยนจาก JSON.stringify(signals) เป็น title ทำให้ผลเลือกไม่ตรง HEAD (Opus โพรบ 60 เคส หลุด 37/60)
//      แก้: ส่ง opts.seedKey เฉพาะมี varietySeed จริง+สวิตช์เปิดเท่านั้น (spread แบบมีเงื่อนไข) ไม่งั้นส่ง {}
//      ว่างเปล่า (S6/compose-test ไม่แตะ — HEAD เดิมมี seedKey title-based อยู่แล้วเสมอ)
//   2) job.id ที่ขึ้นต้น 'REFTEST-' (trace id ชั่วคราวเปลี่ยนทุก HTTP request) ห้ามใช้เป็น variety seed —
//      ทั้ง S6/S7 ต้องกรองด้วย isEphemeralPipelineId ก่อน fallback ไป job.id เสมอ · id ถาวร (MG-####/qtj_...)
//      ใช้ได้ปกติ · ระวัง .trim(): buildVarietySeedKey ต้อง "ไม่ trim" caseIdentity (ให้ตรงกับค่าดิบที่ผู้เรียก
//      เคยส่งเป็น seedKey ตรงๆ ก่อนมีฟีเจอร์นี้ — trim จะทำให้ title ที่มีช่องว่างหัว/ท้ายได้ seedKey ต่างจากเดิม)
//   3) เทสนี้: เขียนใหม่ทั้งไฟล์ — เรียก buildVarietySeedKey/isEphemeralPipelineId/isVarietySeedEnabled/
//      pickBestRef จริงทั้งหมด (ไม่ copy สูตร) พิสูจน์ parity ระดับ pickBestRef ≥20 เคส + REFTEST-*/MG-####
// harness: stub @/lib/refCoverLibrary (พูลควบคุมได้ผ่าน globalThis) — แพทเทิร์นเดียวกับ ref-category-rotation.test.mjs
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

const STUB_REFLIB = _mod('export async function listRefCovers(n){ return globalThis.__RVS_POOL || []; }');

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

const { pickBestRef, buildVarietySeedKey, isEphemeralPipelineId, isVarietySeedEnabled } = await import('../src/lib/refCoverMatch.js');

const LIB = path.join(__dirname, '..', 'data', 'ref-cover-library.json');
const library = JSON.parse(fs.readFileSync(LIB, 'utf8'));
const BASE_DNA = structuredClone(library[0].dna);

function mkRef(id, { matchNewsType = [] } = {}) {
  const dna = structuredClone(BASE_DNA);
  delete dna._templateGrade;
  delete dna._duplicateOf;
  delete dna._humanVerified;
  delete dna._fidelity;
  dna._humanVerified = true;
  dna._reproducible = true;
  dna.matchNewsType = matchNewsType;
  return { id, imagePath: `/ref-covers/${id}.jpg`, dna };
}

const setEnv = (k, v) => { if (v === null || v === undefined) delete process.env[k]; else process.env[k] = v; };
const NEAR_TIE_POOL = () => [
  mkRef('REF-A', { matchNewsType: ['กตัญญู'] }),
  mkRef('REF-B', { matchNewsType: ['กตัญญู'] }),
  mkRef('REF-C', { matchNewsType: ['กตัญญู'] }),
];

// ★ จำลอง call site S7 จริงเป๊ะ (megaAdapters.js) — ใช้ฟังก์ชันจริงที่ import มาทั้งหมด ไม่ copy สูตรเลข/เงื่อนไข
function resolveS7SeedOpts(job, caseIdentity) {
  const varietySeed = job.varietySeed || (job.id && !isEphemeralPipelineId(job.id) ? job.id : '');
  return (varietySeed && isVarietySeedEnabled()) ? { seedKey: buildVarietySeedKey(caseIdentity, varietySeed) } : {};
}
// ★ จำลอง call site S6 จริงเป๊ะ — S6 ส่ง seedKey เสมอ (HEAD เดิมมี title-based seedKey อยู่แล้ว ไม่ต้อง omit)
function resolveS6SeedKey(job, caseIdentity) {
  const varietySeed = job.varietySeed || (job.id && !isEphemeralPipelineId(job.id) ? job.id : '');
  return buildVarietySeedKey(caseIdentity, varietySeed);
}

// ============================================================
// ① buildVarietySeedKey / isEphemeralPipelineId / isVarietySeedEnabled — unit เพียว
// ============================================================
test('buildVarietySeedKey: มี varietySeed → ประกอบ "identity:seed"', () => {
  setEnv('MEGA_REF_VARIETY_SEED', null);
  assert.equal(buildVarietySeedKey('CASE-1', 'job-abc'), 'CASE-1:job-abc');
});

test('buildVarietySeedKey: ไม่มี varietySeed (undefined/null/ว่าง) → คืน identity ดิบเป๊ะ', () => {
  setEnv('MEGA_REF_VARIETY_SEED', null);
  assert.equal(buildVarietySeedKey('CASE-1', undefined), 'CASE-1');
  assert.equal(buildVarietySeedKey('CASE-1', null), 'CASE-1');
  assert.equal(buildVarietySeedKey('CASE-1', ''), 'CASE-1');
  assert.equal(buildVarietySeedKey('CASE-1', '   '), 'CASE-1');
});

test('buildVarietySeedKey: ห้าม trim caseIdentity (Opus รอบ 3 — กันช่องว่างหัว/ท้ายทำ byte-parity หลุด)', () => {
  setEnv('MEGA_REF_VARIETY_SEED', null);
  assert.equal(buildVarietySeedKey('  ชื่อเคสมีช่องว่าง  ', undefined), '  ชื่อเคสมีช่องว่าง  ', 'ไม่มี seed → ต้องคืนค่าดิบเป๊ะ ห้าม trim');
  assert.equal(buildVarietySeedKey('  ชื่อเคสมีช่องว่าง  ', 'seed1'), '  ชื่อเคสมีช่องว่าง  :seed1', 'มี seed → identity ส่วนหน้ายังดิบเหมือนเดิม (trim เฉพาะ seed)');
});

test('buildVarietySeedKey: kill-switch MEGA_REF_VARIETY_SEED=0 → ไม่ผูก varietySeed เลย แม้ส่งมา (byte-parity)', () => {
  setEnv('MEGA_REF_VARIETY_SEED', '0');
  assert.equal(buildVarietySeedKey('CASE-1', 'job-abc'), 'CASE-1');
  setEnv('MEGA_REF_VARIETY_SEED', null);
});

test('buildVarietySeedKey: env อื่นที่ไม่ใช่ "0" (เช่น "1"/undefined) → เปิดตามปกติ (default ON)', () => {
  assert.equal(buildVarietySeedKey('CASE-1', 'job-abc', { MEGA_REF_VARIETY_SEED: '1' }), 'CASE-1:job-abc');
  assert.equal(buildVarietySeedKey('CASE-1', 'job-abc', {}), 'CASE-1:job-abc');
});

test('isEphemeralPipelineId: REFTEST-* → true (id ชั่วคราว) · MG-####/qtj_.../ว่าง → false (id ถาวรหรือไม่มี)', () => {
  assert.equal(isEphemeralPipelineId('REFTEST-abc123'), true);
  assert.equal(isEphemeralPipelineId('REFTEST-mfx8k2p9'), true);
  assert.equal(isEphemeralPipelineId('MG-0001'), false);
  assert.equal(isEphemeralPipelineId('MG-9999'), false);
  assert.equal(isEphemeralPipelineId('qtj_1234_abcd'), false);
  assert.equal(isEphemeralPipelineId(''), false);
  assert.equal(isEphemeralPipelineId(null), false);
  assert.equal(isEphemeralPipelineId(undefined), false);
});

test('isVarietySeedEnabled: default (ไม่ตั้ง/ค่าอื่น) = true · "0" = false', () => {
  assert.equal(isVarietySeedEnabled({}), true);
  assert.equal(isVarietySeedEnabled({ MEGA_REF_VARIETY_SEED: '1' }), true);
  assert.equal(isVarietySeedEnabled({ MEGA_REF_VARIETY_SEED: '0' }), false);
});

// ============================================================
// ② S6/S7 seed resolution — REFTEST-* ไม่ถูกใช้เป็น seed / MG-#### และ qtj_ ถูกใช้ (ข้อ 4-ข)
// ============================================================
test('(ข) S7: job.id ขึ้นต้น REFTEST- (ไม่มี varietySeed) → ไม่ถือเป็น seed เลย → opts ว่างเปล่า {} (ไม่ส่ง seedKey)', () => {
  setEnv('MEGA_REF_VARIETY_SEED', null);
  const opts = resolveS7SeedOpts({ id: 'REFTEST-mfx8k2p9' }, 'case-identity');
  assert.deepEqual(opts, {}, 'REFTEST-* ต้องไม่ถูกใช้เป็น seed เด็ดขาด — ต้องได้ opts ว่างเปล่า');
});

test('(ข) S7: job.id ถาวร (MG-0001, ไม่มี varietySeed) → ถูกใช้เป็น seed จริง', () => {
  setEnv('MEGA_REF_VARIETY_SEED', null);
  const opts = resolveS7SeedOpts({ id: 'MG-0001' }, 'case-identity');
  assert.deepEqual(opts, { seedKey: 'case-identity:MG-0001' }, 'MG-#### ต้องถูกใช้เป็น seed ปกติ');
});

test('(ข) S7: job.id แบบ qtj_... (id ถาวรของ quick-test ตรงๆ ไม่ผ่าน varietySeed) → ถูกใช้เป็น seed จริง', () => {
  setEnv('MEGA_REF_VARIETY_SEED', null);
  const opts = resolveS7SeedOpts({ id: 'qtj_1753000000_ab12cd' }, 'case-identity');
  assert.deepEqual(opts, { seedKey: 'case-identity:qtj_1753000000_ab12cd' });
});

test('(ข) S6: job.id ขึ้นต้น REFTEST- → seedKey = caseIdentity ล้วน (ไม่ผูก id ชั่วคราว)', () => {
  setEnv('MEGA_REF_VARIETY_SEED', null);
  assert.equal(resolveS6SeedKey({ id: 'REFTEST-abc' }, 'case-identity'), 'case-identity');
});

test('(ข) S6: job.id ถาวร (MG-0001) → seedKey = caseIdentity:MG-0001', () => {
  setEnv('MEGA_REF_VARIETY_SEED', null);
  assert.equal(resolveS6SeedKey({ id: 'MG-0001' }, 'case-identity'), 'case-identity:MG-0001');
});

test('(ข) job.varietySeed ชนะเสมอไม่ว่า job.id จะเป็นอะไร (REFTEST-*/MG-####/ว่าง)', () => {
  setEnv('MEGA_REF_VARIETY_SEED', null);
  assert.equal(resolveS6SeedKey({ id: 'REFTEST-abc', varietySeed: 'qtj_real_777' }, 'case'), 'case:qtj_real_777');
  assert.equal(resolveS6SeedKey({ id: 'MG-0001', varietySeed: 'qtj_real_777' }, 'case'), 'case:qtj_real_777');
  assert.deepEqual(resolveS7SeedOpts({ id: 'REFTEST-abc', varietySeed: 'qtj_real_777' }, 'case'), { seedKey: 'case:qtj_real_777' });
});

test('(ข) เส้นยิงตรงหน้า /cover-ref-test ซ้ำๆ (REFTEST-* เปลี่ยนทุกครั้ง ไม่มี varietySeed เลย) → ผลลัพธ์นิ่ง (ใบเดิม) แม้ id ต่างกันทุกรอบ', async () => {
  setEnv('MEGA_REF_VARIETY_SEED', null);
  globalThis.__RVS_POOL = NEAR_TIE_POOL();
  const signals = { text: 'กตัญญู ลูกตอบแทนบุญคุณแม่', emotion: '' };
  const results = [];
  for (let i = 0; i < 6; i++) {
    // จำลองยิงตรงหน้า /cover-ref-test ซ้ำ (ไม่ผ่าน quick-test) — job.id เปลี่ยนใหม่ทุกครั้งแบบ REFTEST-* จริง
    const job = { id: `REFTEST-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}` };
    const r = await pickBestRef(signals, resolveS7SeedOpts(job, 'case-fixed-direct-hit'));
    results.push(r.ref.id);
  }
  assert.ok(results.every((id) => id === results[0]), `ยิงตรงซ้ำเนื้อเดิมต้องได้ ref เดิมนิ่งเหมือนก่อนมีฟีเจอร์นี้ (REFTEST-* ไม่ถูกใช้เป็น seed) — ได้: ${results.join(',')}`);
});

// ============================================================
// ③ parity ระดับ pickBestRef ≥20 เคส (ข้อ 4-ก): pickBestRef(signals) [ไม่มี opts เลย = พฤติกรรม HEAD ของ S7]
//   เทียบกับเส้นสวิตช์ปิด/ไม่มี seed หลังแก้ (resolveS7SeedOpts คืน {}) — ต้องได้ ref ใบเดียวกัน 100%
// ============================================================
test('(ก) parity ≥20 เคส: ไม่มี varietySeed จริง (REFTEST-*/ไม่มี id เลย) → S7 หลังแก้ ตรงกับ pickBestRef(signals) แบบไม่มี opts เป๊ะทุกเคส', async () => {
  setEnv('MEGA_REF_VARIETY_SEED', null);
  globalThis.__RVS_POOL = NEAR_TIE_POOL();
  const emotions = ['ซึ้งใจ', 'เศร้า', 'อบอุ่น', ''];
  const texts = [
    'กตัญญู ลูกตอบแทนบุญคุณแม่',
    'ไรเดอร์เอ็นขาดยังวิ่งงานหาเช้ากินค่ำ',
    'ดารามอบเงินช่วยเหลือครอบครัวยากไร้',
    'คู่รักแต่งงานครบรอบแต่ง 10 ปี',
    'หมาจรจัดถูกทิ้งข้างวัด',
    'เหยื่อแจ้งความดำเนินคดี',
  ];
  const jobShapes = [
    { id: 'REFTEST-abc111' },
    { id: 'REFTEST-xyz222' },
    {}, // ไม่มี id เลย
    { id: null },
  ];
  let compared = 0;
  for (const emotion of emotions) {
    for (const text of texts) {
      for (const job of jobShapes) {
        const signals = { emotion, text, charCount: text.length % 4 };
        const baseline = await pickBestRef(signals); // ★ ไม่มี opts เลย = พฤติกรรม HEAD ของ S7 เป๊ะ
        const opts = resolveS7SeedOpts(job, 'case-parity-fixed');
        const afterFix = await pickBestRef(signals, opts);
        assert.equal(afterFix.ref.id, baseline.ref.id, `เคส emotion="${emotion}" text="${text}" job=${JSON.stringify(job)} ต้องได้ ref เดียวกับ baseline (ไม่มี opts)`);
        compared++;
      }
    }
  }
  assert.ok(compared >= 20, `ต้องเทียบ ≥20 เคส — เทียบจริง ${compared} เคส`);
});

test('(ก) parity เพิ่ม: สวิตช์ MEGA_REF_VARIETY_SEED=0 แม้มี varietySeed จริงถูกต้อง (MG-####) → ยังต้องตรงกับ baseline (ไม่มี opts) เพราะ S7 ต้องไม่ส่ง seedKey เลยตอนสวิตช์ปิด', async () => {
  globalThis.__RVS_POOL = NEAR_TIE_POOL();
  const signals = { emotion: 'ซึ้งใจ', text: 'กตัญญู ลูกตอบแทนบุญคุณแม่', charCount: 2 };
  const baseline = await pickBestRef(signals);
  setEnv('MEGA_REF_VARIETY_SEED', '0');
  const opts = resolveS7SeedOpts({ id: 'MG-0001', varietySeed: 'qtj_real_777' }, 'case-parity-fixed');
  assert.deepEqual(opts, {}, 'สวิตช์ปิด → opts ต้องว่างเปล่าแม้มี varietySeed ถูกต้องครบ');
  const afterFix = await pickBestRef(signals, opts);
  assert.equal(afterFix.ref.id, baseline.ref.id);
  setEnv('MEGA_REF_VARIETY_SEED', null);
});

// ============================================================
// ④ varietySeed จริง (id ถาวร/varietySeed ส่งมา + สวิตช์เปิด) — ยังทำงานตามดีไซน์เดิม (retry เดิม/งานใหม่ต่าง)
// ============================================================
test('varietySeed จริงซ้ำ 6 รอบ (retry ของงานเดียวกัน) → ได้ ref ใบเดิมทุกรอบ (ทั้ง S6 และ S7 หลังแก้)', async () => {
  setEnv('MEGA_REF_VARIETY_SEED', null);
  globalThis.__RVS_POOL = NEAR_TIE_POOL();
  const signals = { text: 'กตัญญู ลูกตอบแทนบุญคุณแม่', emotion: '' };
  const jobStable = { id: 'MG-0042' }; // id ถาวร นิ่งตลอด retry
  const s6Results = [];
  const s7Results = [];
  for (let attempt = 1; attempt <= 6; attempt++) {
    const r6 = await pickBestRef(signals, { seedKey: resolveS6SeedKey(jobStable, 'case-fixed') });
    const r7 = await pickBestRef(signals, resolveS7SeedOpts(jobStable, 'case-fixed'));
    s6Results.push(r6.ref.id);
    s7Results.push(r7.ref.id);
  }
  assert.ok(s6Results.every((id) => id === s6Results[0]), `S6 retry ต้องได้ ref เดิมทุกรอบ — ได้: ${s6Results.join(',')}`);
  assert.ok(s7Results.every((id) => id === s7Results[0]), `S7 retry ต้องได้ ref เดิมทุกรอบ — ได้: ${s7Results.join(',')}`);
});

test('varietySeed ต่างกัน (job.id ถาวรคนละอันของ "งานใหม่") + near-tie → ได้ ref มากกว่า 1 ใบ (ทั้ง S6 และ S7)', async () => {
  setEnv('MEGA_REF_VARIETY_SEED', null);
  globalThis.__RVS_POOL = NEAR_TIE_POOL();
  const signals = { text: 'กตัญญู ลูกตอบแทนบุญคุณแม่', emotion: '' };
  const seenS6 = new Set();
  const seenS7 = new Set();
  for (let i = 0; i < 40; i++) {
    const job = { id: `MG-${String(i).padStart(4, '0')}` };
    const r6 = await pickBestRef(signals, { seedKey: resolveS6SeedKey(job, 'case-fixed') });
    const r7 = await pickBestRef(signals, resolveS7SeedOpts(job, 'case-fixed'));
    seenS6.add(r6.ref.id);
    seenS7.add(r7.ref.id);
  }
  assert.ok(seenS6.size > 1, `S6 คาดว่าได้ ref มากกว่า 1 ใบจาก 40 งานใหม่ — ได้จริง ${seenS6.size} ใบ`);
  assert.ok(seenS7.size > 1, `S7 คาดว่าได้ ref มากกว่า 1 ใบจาก 40 งานใหม่ — ได้จริง ${seenS7.size} ใบ`);
});

// ============================================================
// (ง) compose-test: ไม่ส่ง varietySeed → พฤติกรรมเดิม byte (seedKey = caseId ล้วน) — ไม่แตะรอบนี้ ยังต้องผ่านเหมือนเดิม
// ============================================================
test('(ง) compose-test: ไม่ส่ง varietySeed → seedKey = caseId ล้วน (byte-parity) ผ่าน pickBestRef จริง', async () => {
  setEnv('MEGA_REF_VARIETY_SEED', null);
  globalThis.__RVS_POOL = NEAR_TIE_POOL();
  const caseId = 'CASE-BYTE-PARITY';
  const seedKeyOld = caseId;
  const seedKeyNew = buildVarietySeedKey(caseId, undefined);
  assert.equal(seedKeyNew, seedKeyOld);
  const r1 = await pickBestRef({ text: 'กตัญญู ลูกตอบแทนบุญคุณแม่', emotion: '' }, { seedKey: seedKeyOld });
  const r2 = await pickBestRef({ text: 'กตัญญู ลูกตอบแทนบุญคุณแม่', emotion: '' }, { seedKey: seedKeyNew });
  assert.equal(r1.ref.id, r2.ref.id);
});

// ============================================================
// เสียบจริงในซอร์ส — ยืนยัน wiring ครบทุกจุด (ปรับตามรูปแบบใหม่หลังรอบ 3)
// ============================================================
test('เสียบจริง: megaAdapters.js S6+S7 import ครบ (buildVarietySeedKey/isEphemeralPipelineId) — S7 เพิ่ม isVarietySeedEnabled', () => {
  const src = fs.readFileSync(new URL('../src/lib/megaAdapters.js', import.meta.url), 'utf8');
  const s6ImportHits = src.match(/pickBestRef, refCategoryHint, inferRefCategory, buildVarietySeedKey, isEphemeralPipelineId\s*}\s*=\s*await import\('@\/lib\/refCoverMatch'\)/g) || [];
  assert.equal(s6ImportHits.length, 1, 'S6 ต้อง import buildVarietySeedKey + isEphemeralPipelineId');
  const s7ImportHits = src.match(/pickBestRef, refCategoryHint, inferRefCategory, buildVarietySeedKey, isEphemeralPipelineId, isVarietySeedEnabled\s*}\s*=\s*await import\('@\/lib\/refCoverMatch'\)/g) || [];
  assert.equal(s7ImportHits.length, 1, 'S7 ต้อง import isVarietySeedEnabled เพิ่มด้วย (ใช้ตัดสิน spread opts แบบมีเงื่อนไข)');
});

test('เสียบจริง: megaAdapters.js S6/S7 กรอง job.id ด้วย isEphemeralPipelineId ก่อน fallback ทั้งคู่', () => {
  const src = fs.readFileSync(new URL('../src/lib/megaAdapters.js', import.meta.url), 'utf8');
  const hits = src.match(/job\.varietySeed \|\| \(job\.id && !isEphemeralPipelineId\(job\.id\) \? job\.id : ''\)/g) || [];
  assert.equal(hits.length, 2, 'ต้องกรอง REFTEST-* ทิ้งก่อน fallback job.id ครบ 2 จุด (S6+S7)');
});

test('เสียบจริง: megaAdapters.js S7 ส่ง opts แบบมีเงื่อนไข (ไม่ใช่ seedKey ตรงๆ เสมอแบบ S6)', () => {
  const src = fs.readFileSync(new URL('../src/lib/megaAdapters.js', import.meta.url), 'utf8');
  assert.match(src, /_seedOptsS7\s*=\s*\(_varietySeedS7 && isVarietySeedEnabled\(\)\)\s*\?\s*\{\s*seedKey:\s*buildVarietySeedKey\(_caseIdentityS7,\s*_varietySeedS7\)\s*\}\s*:\s*\{\}/, 'S7 ต้อง spread opts แบบมีเงื่อนไข — ว่างเปล่าเมื่อไม่มี seed จริง/สวิตช์ปิด');
  assert.match(src, /\}, _seedOptsS7\);/, 'S7 ต้องส่ง _seedOptsS7 ที่คำนวณแบบมีเงื่อนไข ไม่ใช่ object literal ตรงๆ');
  // S6 ยังคงส่ง seedKey เสมอ (ไม่ omit) — HEAD เดิมมี seedKey title-based อยู่แล้ว
  assert.match(src, /seedKey:\s*buildVarietySeedKey\(_caseIdentity,\s*_varietySeedS6\)/, 'S6 ต้องยังส่ง seedKey เสมอ (ไม่ omit แบบ S7)');
});

test('เสียบจริง: compose-test/route.js เรียก buildVarietySeedKey จริง + จำกัดความยาว varietySeed .slice(0,64) — ไม่แตะรอบ 3', () => {
  const src = fs.readFileSync(new URL('../src/app/api/mega/compose-test/route.js', import.meta.url), 'utf8');
  assert.match(src, /body\.varietySeed/);
  assert.match(src, /\.slice\(0,\s*64\)/);
  assert.match(src, /buildVarietySeedKey\(caseId,\s*_varietySeed\)/);
});

test('เสียบจริง: quick-test/route.js callOnce ส่ง varietySeed:job.id ทั้ง kind=compose และ kind=ref (รอบ 2 wiring ยังอยู่ครบ)', () => {
  const src = fs.readFileSync(new URL('../src/app/api/quick-test/route.js', import.meta.url), 'utf8');
  assert.match(src, /varietySeed:\s*job\.id/, 'kind=compose: ต้องส่ง varietySeed: job.id ใน body fetch ไป compose-test');
  assert.match(src, /refBody\.varietySeed\s*=\s*job\.id/, 'kind=ref: ต้องส่ง refBody.varietySeed = job.id ก่อนยิง /api/cover-ref-test');
});

test('เสียบจริง: cover-ref-test/route.js ส่ง body.varietySeed ต่อให้ runner (refTestPipeline.runCoverRefTest) — รอบ 2 wiring ยังอยู่ครบ', () => {
  const src = fs.readFileSync(new URL('../src/app/api/cover-ref-test/route.js', import.meta.url), 'utf8');
  assert.match(src, /varietySeed:\s*body\.varietySeed/);
});

test('เสียบจริง: refTestPipeline.js อ่าน input.varietySeed และเก็บลง job.varietySeed (แยกจาก job.id เฉพาะกิจ) — รอบ 2 wiring ยังอยู่ครบ', () => {
  const src = fs.readFileSync(new URL('../src/lib/refTestPipeline.js', import.meta.url), 'utf8');
  assert.match(src, /const varietySeed = String\(input\.varietySeed \|\| ''\)\.trim\(\)\.slice\(0,\s*64\)/);
  assert.match(src, /\.\.\.\(varietySeed \? \{ varietySeed \} : \{\}\)/);
});
