// ============================================================
// 🧪 Research Query Planner (เฟส 3) — offline unit test
// Target: src/lib/services/deskV2/researchQueryPlanner.js
//   • allocateQueryBuckets — จัดสรรจำนวนคำค้น 4 กอง (largest-remainder / dna-guaranteed<4)
//   • collectDnaSeeds / collectEntitySeeds — เก็บ seed ต่อกอง (unique+sanitize)
//   • planResearchQueries — ประกอบแผนคำค้นสุดท้าย + redistribute เมื่อกองไหนไม่มี seed
// pure: import ผ่าน dnaContract (crypto builtin) + keywordBank (pure) — ไม่ต้อง stub persistStore
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BUCKET_WEIGHTS,
  allocateQueryBuckets,
  collectDnaSeeds,
  collectEntitySeeds,
  planResearchQueries,
} from '../src/lib/services/deskV2/researchQueryPlanner.js';
import { THEME_ACTIONS } from '../src/lib/services/newsDesk/keywordBank.js';

const PLANNER_PATH = new URL('../src/lib/services/deskV2/researchQueryPlanner.js', import.meta.url);

function makeExemplar(newsQueries = [], clipQueries = [], reach = 600000) {
  return {
    dna: {
      archetype: 'ทดสอบ',
      category: 'น้ำใจ/ช่วยเหลือ',
      characters: ['พระเอก'], // บทบาท — ต้องไม่ถูกใช้เป็นชื่อคนใน collectEntitySeeds
      newsQueries,
      clipQueries,
    },
    reach,
  };
}

// ── allocateQueryBuckets ──
test('allocateQueryBuckets(6) → {dna:2,angle:2,people:1,trend:1} (largest-remainder)', () => {
  assert.deepEqual(allocateQueryBuckets(6), { dna: 2, angle: 2, people: 1, trend: 1 });
});

test('allocateQueryBuckets(3) → dna ต้อง >=1 เสมอ และรวม = 3', () => {
  for (const seed of ['', 'a', 'seed-42', 'ทดสอบ', 'zzz']) {
    const alloc = allocateQueryBuckets(3, BUCKET_WEIGHTS, seed);
    assert.ok(alloc.dna >= 1, `dna ต้อง >=1 (seed=${seed})`);
    assert.equal(alloc.dna + alloc.angle + alloc.people + alloc.trend, 3, `รวมต้อง=3 (seed=${seed})`);
  }
});

test('allocateQueryBuckets: ผลรวมทุกกอง เท่ากับ total เสมอ (1,2,4,8,10)', () => {
  for (const total of [1, 2, 4, 8, 10]) {
    const alloc = allocateQueryBuckets(total);
    const sum = alloc.dna + alloc.angle + alloc.people + alloc.trend;
    assert.equal(sum, total, `total=${total} → sum ต้องเท่ากัน ได้ ${sum}`);
  }
});

test('allocateQueryBuckets: runSeed เดิม → ผลเดิมเป๊ะ (deterministic)', () => {
  const a1 = allocateQueryBuckets(2, BUCKET_WEIGHTS, 'seed-xyz');
  const a2 = allocateQueryBuckets(2, BUCKET_WEIGHTS, 'seed-xyz');
  assert.deepEqual(a1, a2);
  const b1 = allocateQueryBuckets(9, BUCKET_WEIGHTS, 'อีกชุด');
  const b2 = allocateQueryBuckets(9, BUCKET_WEIGHTS, 'อีกชุด');
  assert.deepEqual(b1, b2);
});

test('allocateQueryBuckets: runSeed ต่างกัน → การหมุนกอง (total<4) มีโอกาสต่างกัน', () => {
  const seeds = Array.from({ length: 15 }, (_, i) => `seed-${i}`);
  const shapes = new Set(seeds.map((s) => JSON.stringify(allocateQueryBuckets(2, BUCKET_WEIGHTS, s))));
  assert.ok(shapes.size > 1, `ควรมีอย่างน้อย 2 รูปแบบการหมุนในบรรดา ${seeds.length} seed ที่ลอง ได้ ${shapes.size}`);
});

test('allocateQueryBuckets: total<=0 → ทุกกองเป็น 0', () => {
  assert.deepEqual(allocateQueryBuckets(0), { dna: 0, angle: 0, people: 0, trend: 0 });
  assert.deepEqual(allocateQueryBuckets(-5), { dna: 0, angle: 0, people: 0, trend: 0 });
});

// ── collectDnaSeeds ──
test('collectDnaSeeds: รวม newsQueries+clipQueries ทุก exemplar + unique(case-insensitive) + sanitize', () => {
  const exemplars = [
    { dna: { newsQueries: ['อันดับหนึ่ง ทดสอบ', 'อันดับหนึ่ง ทดสอบ'], clipQueries: ['คลิปเด็ดมาก'] } },
    { dna: { newsQueries: ['ข่าวสอง ยอดเยี่ยม'], clipQueries: [] } },
  ];
  const seeds = collectDnaSeeds(exemplars);
  assert.equal(seeds.length, 3);
  assert.equal(new Set(seeds.map((s) => s.toLowerCase())).size, seeds.length);
});

test('collectDnaSeeds: exemplars ว่าง/ไม่มี dna → คืน []', () => {
  assert.deepEqual(collectDnaSeeds([]), []);
  assert.deepEqual(collectDnaSeeds([{}, { dna: {} }]), []);
});

// ── collectEntitySeeds ──
test('collectEntitySeeds: characters เป็นบทบาท ต้องไม่ถูกใช้เป็นชื่อคน; ไม่มี seed เลย → []', () => {
  assert.deepEqual(collectEntitySeeds([], []), []);
  assert.deepEqual(collectEntitySeeds([{ dna: { characters: ['พระเอก', 'นางเอก'] } }], []), []);
});

test('collectEntitySeeds: staffHints เป็นแหล่งหลัก + dedup', () => {
  const seeds = collectEntitySeeds([], ['รายการทุบโต๊ะข่าว', 'รายการทุบโต๊ะข่าว', 'คุณสมชาย']);
  assert.deepEqual(seeds, ['รายการทุบโต๊ะข่าว', 'คุณสมชาย']);
});

// ── planResearchQueries ──
test('planResearchQueries: ยาว ≤ total, ทุกใบมี bucket/lane/text ไม่ว่าง, text ไม่ซ้ำ', () => {
  const exemplars = [
    makeExemplar(['เด็กหญิงกตัญญูช่วยแม่ทำงาน', 'ชายวัย 60 บริจาคเงินทั้งชีวิต', 'ชาวบ้านรวมใจช่วยผู้ประสบภัยน้ำท่วม']),
  ];
  const plan = planResearchQueries({ exemplars, total: 6, runSeed: 'r1' });
  assert.ok(plan.length <= 6, `ยาว ${plan.length} ต้อง <= 6`);
  const seen = new Set();
  for (const q of plan) {
    assert.ok(typeof q.bucket === 'string' && q.bucket.length > 0, 'bucket ต้องไม่ว่าง');
    assert.ok(typeof q.lane === 'string' && q.lane.length > 0, 'lane ต้องไม่ว่าง');
    assert.ok(typeof q.text === 'string' && q.text.length > 0, 'text ต้องไม่ว่าง');
    assert.ok(['dna', 'angle', 'people', 'trend'].includes(q.bucket));
    assert.ok(['dna', 'interview'].includes(q.lane));
    const key = q.text.toLowerCase();
    assert.ok(!seen.has(key), `text ซ้ำ: ${q.text}`);
    seen.add(key);
  }
});

test('redistribute: people ไม่มี seed (staffHints/trendTerms ว่าง) → โควตาย้ายไปกองที่มี ผลรวมไม่ขาด', () => {
  const exemplars = [
    makeExemplar(['ข่าวหนึ่ง อบอุ่นใจ', 'ข่าวสอง ประทับใจมาก', 'ข่าวสาม น้ำตาซึม', 'ข่าวสี่ ให้กำลังใจ']),
    makeExemplar(['ข่าวห้า สู้ชีวิต', 'ข่าวหก กตัญญูสุดซึ้ง']),
  ];
  const plan = planResearchQueries({ exemplars, total: 6, runSeed: 'r2', staffHints: [], trendTerms: [] });
  const byBucket = {};
  for (const q of plan) byBucket[q.bucket] = (byBucket[q.bucket] || 0) + 1;
  assert.equal(byBucket.people || 0, 0, 'people ไม่ควรมีใบเลย (ไม่มี seed จริง — staffHints ว่าง + exemplar ไม่มี entity field)');
  assert.equal(plan.length, 6, 'รวมยังเต็ม 6 (โควตาที่ควรลง people ถูกย้ายไปกองอื่นแทน ไม่ขาด)');
});

test('planResearchQueries: input เดิม (แม้คนละ object reference) → output เดิมเป๊ะ (deterministic)', () => {
  const input = {
    exemplars: [makeExemplar(['อันดับหนึ่ง ยอดเยี่ยม', 'อันดับสอง ซึ้งมาก'], ['คลิปหนึ่ง เด็ด'])],
    total: 8,
    runSeed: 'stable-seed',
    staffHints: ['รายการทุบโต๊ะข่าว'],
    trendTerms: ['กระแสทดสอบ'],
    preset: 'kindness',
    clusterId: 'cl_test123',
  };
  const p1 = planResearchQueries(input);
  const p2 = planResearchQueries(input);
  assert.deepEqual(p1, p2);
  const p3 = planResearchQueries(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(p1, p3);
});

test('planResearchQueries: exemplars ว่าง + total=4 (default) ไม่ throw และยาว <= 4', () => {
  const plan = planResearchQueries();
  assert.ok(plan.length <= 4);
  const plan2 = planResearchQueries({});
  assert.ok(plan2.length <= 4);
});

test('preset=kindness → คำแรกของกอง angle มาจากหมวดน้ำใจ/กตัญญูก่อนเสมอ', () => {
  const kindnessWords = new Set(
    [...THEME_ACTIONS['น้ำใจ/ช่วยเหลือ'], ...THEME_ACTIONS['กตัญญู/ครอบครัวอบอุ่น']].map((s) => s.toLowerCase())
  );
  for (const seed of ['a', 'b', 'zzz']) {
    const plan = planResearchQueries({ exemplars: [], total: 4, runSeed: seed, preset: 'kindness' });
    const angleItems = plan.filter((q) => q.bucket === 'angle');
    assert.ok(angleItems.length > 0, 'ควรมีอย่างน้อย 1 ใบในกอง angle');
    assert.ok(
      kindnessWords.has(angleItems[0].text.toLowerCase()),
      `angle ใบแรกควรมาจากหมวดน้ำใจ/กตัญญู ได้ "${angleItems[0].text}" (seed=${seed})`
    );
  }
});

test('id เป็น `${bucket}-${i}` ที่ stable+deterministic + weight ตรงกับ BUCKET_WEIGHTS ของกองจริง', () => {
  const exemplars = [makeExemplar(['หนึ่งสองสามสี่ห้า', 'อีกข่าวหนึ่ง กินใจ'])];
  const plan = planResearchQueries({ exemplars, total: 6, runSeed: 'id-check' });
  const perBucketSeq = {};
  for (const q of plan) {
    assert.match(q.id, /^(dna|angle|people|trend)-\d+$/);
    const [bucketFromId] = q.id.split('-');
    assert.equal(bucketFromId, q.bucket);
    perBucketSeq[q.bucket] = perBucketSeq[q.bucket] || 0;
    assert.equal(q.id, `${q.bucket}-${perBucketSeq[q.bucket]}`);
    perBucketSeq[q.bucket]++;
    assert.equal(q.weight, BUCKET_WEIGHTS[q.bucket]);
  }
});

// ── ยืนยันไม่มี import ต้องห้าม (deskV2 rule) ──
test('researchQueryPlanner.js ต้องไม่มีคำว่า openai/aiRouter/persistStore/callAI', () => {
  const src = readFileSync(PLANNER_PATH, 'utf8');
  assert.ok(!/openai/i.test(src), 'ห้ามมีคำว่า openai');
  assert.ok(!/aiRouter/i.test(src), 'ห้ามมีคำว่า aiRouter');
  assert.ok(!/persistStore/i.test(src), 'ห้ามมีคำว่า persistStore');
  assert.ok(!/callAI/i.test(src), 'ห้ามมีคำว่า callAI');
});

test('researchQueryPlanner.js ต้อง import ได้เฉพาะ keywordBank.js และ dnaContract.js เท่านั้น', () => {
  const src = readFileSync(PLANNER_PATH, 'utf8');
  const importSpecs = [...src.matchAll(/^import\s+.*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.ok(importSpecs.length > 0, 'ต้องมี import อย่างน้อย keywordBank + dnaContract');
  for (const spec of importSpecs) {
    assert.ok(
      spec.endsWith('keywordBank.js') || spec.endsWith('dnaContract.js'),
      `import ต้องห้าม: ${spec}`
    );
  }
  assert.ok(!/Math\.random/.test(src), 'ห้ามใช้ Math.random');
  assert.ok(!/Date\.now/.test(src), 'ห้ามใช้ Date.now');
});
