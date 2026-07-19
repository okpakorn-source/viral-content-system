// ============================================================
// 🧪 Research Theme Index (เฟส 9) — offline unit test
// Target: src/lib/services/deskV2/researchThemeIndex.js
//   • buildVirtualThemeIndex        — จัดกลุ่ม "คลัสเตอร์เสมือน" ครอบหลายคลัสเตอร์ (ไม่แตะ clusterId เดิม)
//   • resolveVirtualThemeSelection  — คลี่กลุ่มเสมือนที่เลือกกลับเป็น clusterId จริง (unique)
// pure: import ผ่าน dnaContract (sanitizeText เท่านั้น) — ไม่ต้อง stub persistStore/dnaLibrary
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildVirtualThemeIndex,
  resolveVirtualThemeSelection,
} from '../src/lib/services/deskV2/researchThemeIndex.js';

const MODULE_PATH = new URL('../src/lib/services/deskV2/researchThemeIndex.js', import.meta.url);

// ── fixture ──────────────────────────────────────────────────────────────
// cl_1/cl_2/cl_3: category เดียวกัน ('น้ำใจ/ช่วยเหลือ') + คำเด่นซ้อนกันชัดเจน ('สู้ชีวิต'/'เลี้ยงเดี่ยว'
//   ปรากฏซ้ำในทุก query ของแต่ละคลัสเตอร์ → นับได้สูงสุดชัดเจน ไม่ชนคำอื่นที่นับได้แค่ 1 ครั้ง)
//   แต่ละคลัสเตอร์มี exemplar ใบเดียว = singleton ก่อนจัดกลุ่ม ต้องถูกรวมเป็น virtual theme เดียวกัน
// cl_4: category อื่น ('ความรัก/แต่งงาน') คำไม่ซ้อน → singleton ก่อน/หลังจัดกลุ่ม (ไม่ถูกรวม)
// cl_5: category อื่น ('กระแสรายวัน') มี exemplar 2 ใบ (ไม่ใช่ singleton ตั้งแต่ต้น)
// characters ต่างกันในแต่ละใบโดยเจตนา — เพื่อยืนยันว่าไม่ถูกใช้จัดกลุ่ม (สเปกระบุเฉพาะ archetype/newsQueries/clipQueries)
function makeExemplar(clusterId, reach, archetype, category, newsQueries = [], clipQueries = [], characters = []) {
  return { clusterId, reach, dna: { archetype, category, newsQueries, clipQueries, characters } };
}

function makeFixture() {
  return [
    makeExemplar('cl_1', 900000, 'สู้ชีวิต', 'น้ำใจ/ช่วยเหลือ',
      ['สู้ชีวิต เลี้ยงเดี่ยว เก็บขยะขาย', 'สู้ชีวิต เลี้ยงเดี่ยว หาเช้ากินค่ำ'], [], ['แม่']),
    makeExemplar('cl_2', 600000, 'สู้ชีวิต', 'น้ำใจ/ช่วยเหลือ',
      ['สู้ชีวิต เลี้ยงเดี่ยว ขายของเก่า', 'สู้ชีวิต เลี้ยงเดี่ยว ริมถนน'], [], ['พ่อ']),
    makeExemplar('cl_3', 550000, 'สู้ชีวิต', 'น้ำใจ/ช่วยเหลือ',
      ['สู้ชีวิต เลี้ยงเดี่ยว แบกของหนัก', 'สู้ชีวิต เลี้ยงเดี่ยว ทุกวันไม่หยุด'], [], ['ปู่ย่า']),
    makeExemplar('cl_4', 700000, 'ดารา', 'ความรัก/แต่งงาน',
      ['ดารา แต่งงาน เซอร์ไพรส์', 'ดารา แต่งงาน หวานซึ้ง'], [], ['พระเอก']),
    makeExemplar('cl_5', 800000, 'เทรนด์ประจำวัน', 'กระแสรายวัน', ['เทรนด์ ประจำวัน อัปเดต'], [], []),
    makeExemplar('cl_5', 500000, 'เทรนด์ประจำวัน', 'กระแสรายวัน', ['เทรนด์ ประจำวัน อัปเดต'], [], []),
  ];
}

const ID_RE = /^vt_[0-9a-f]{16}$/;

// ── buildVirtualThemeIndex: ไม่ mutate input ───────────────────────────────
test('buildVirtualThemeIndex ไม่ mutate input (exemplars) — clusterId + ทุก field เท่าเดิม byte-equivalent', () => {
  const exemplars = makeFixture();
  const before = JSON.parse(JSON.stringify(exemplars));
  buildVirtualThemeIndex(exemplars);
  assert.deepEqual(exemplars, before, 'exemplars ต้องเหมือนเดิมทุก field หลังเรียก');
  assert.deepEqual(exemplars.map((e) => e.clusterId), before.map((e) => e.clusterId));
});

test('buildVirtualThemeIndex([]) / input แปลกๆ → โครงสร้างว่างที่ปลอดภัย ไม่ throw', () => {
  const empty = { themes: [], byClusterId: {}, stats: { totalClusters: 0, totalThemes: 0, singletonClustersBefore: 0, clustersGroupedAfter: 0 } };
  assert.deepEqual(buildVirtualThemeIndex([]), empty);
  assert.deepEqual(buildVirtualThemeIndex(null), empty);
  assert.deepEqual(buildVirtualThemeIndex(undefined), empty);
  assert.deepEqual(buildVirtualThemeIndex([null, 42, 'x', { noClusterId: true }, { clusterId: '' }]), empty);
});

// ── virtualThemeId: deterministic ──────────────────────────────────────────
test('เรียกซ้ำ input เดิม → ผลลัพธ์ทั้งก้อนเท่ากันทุกจุด (deterministic)', () => {
  const exemplars = makeFixture();
  const r1 = buildVirtualThemeIndex(exemplars);
  const r2 = buildVirtualThemeIndex(exemplars);
  assert.deepEqual(r1, r2);
});

test('สลับลำดับ exemplars (reverse + custom shuffle) → id ของกลุ่มเดิม/ผลรวมทั้งก้อนเท่าเดิมเป๊ะ', () => {
  const exemplars = makeFixture();
  const baseline = buildVirtualThemeIndex(exemplars);

  const reversed = buildVirtualThemeIndex(exemplars.slice().reverse());
  assert.deepEqual(reversed, baseline, 'reverse ต้องได้ผลเดิมเป๊ะ');

  const shuffled = [exemplars[3], exemplars[1], exemplars[5], exemplars[0], exemplars[4], exemplars[2]];
  const shuffledResult = buildVirtualThemeIndex(shuffled);
  assert.deepEqual(shuffledResult, baseline, 'สลับลำดับแบบสุ่มต้องได้ผลเดิมเป๊ะ');
});

test('virtualThemeId มีรูปแบบ vt_ + hex 16 ตัว เสมอ', () => {
  const idx = buildVirtualThemeIndex(makeFixture());
  assert.ok(idx.themes.length > 0);
  for (const t of idx.themes) assert.match(t.id, ID_RE, `id ผิดรูป: ${t.id}`);
});

// ── singleton ลดลงจากการจัดกลุ่มเสมือน ──────────────────────────────────────
test('exemplars category เดียวกัน + token เด่นซ้อนกัน (ต่างคลัสเตอร์ ใบเดียว) → รวมเป็น virtual theme เดียว, ลด singleton', () => {
  const idx = buildVirtualThemeIndex(makeFixture());

  assert.equal(idx.stats.totalClusters, 5);
  assert.equal(idx.stats.singletonClustersBefore, 4, 'cl_1..cl_4 มีใบเดียว (cl_5 มี 2 ใบ ไม่นับ)');
  assert.equal(idx.stats.clustersGroupedAfter, 3, 'cl_1,cl_2,cl_3 เคย singleton แล้วถูกรวมเข้ากลุ่มเดียวกัน');
  assert.equal(idx.stats.totalThemes, 3, '{cl_1,cl_2,cl_3} + {cl_4} + {cl_5}');
  assert.ok(idx.stats.singletonClustersBefore > 0);

  const themeOfCl1 = idx.themes.find((t) => t.clusterIds.includes('cl_1'));
  assert.ok(themeOfCl1, 'ต้องหา theme ของ cl_1 เจอ');
  assert.deepEqual(themeOfCl1.clusterIds, ['cl_1', 'cl_2', 'cl_3']);
  assert.equal(themeOfCl1.exemplarCount, 3);
  assert.equal(themeOfCl1.category, 'น้ำใจ/ช่วยเหลือ');
  assert.equal(themeOfCl1.label, 'น้ำใจ/ช่วยเหลือ · สู้ชีวิต เลี้ยงเดี่ยว');
  assert.deepEqual(themeOfCl1.actionTokens.slice(0, 2), ['สู้ชีวิต', 'เลี้ยงเดี่ยว'], 'top-2 token เด่นต้องมาก่อน (นับได้ 9 กับ 6 ครั้ง ชัดเจนกว่าคำอื่นที่นับได้ 1)');
  assert.ok(themeOfCl1.actionTokens.includes('เก็บขยะขาย'));
  assert.ok(themeOfCl1.actionTokens.includes('ขายของเก่า'));

  // cl_4/cl_5 category คนละกลุ่ม → ยังเดี่ยว (ไม่ถูกรวม แม้จะเคย/ยังเป็น singleton)
  const themeOfCl4 = idx.themes.find((t) => t.clusterIds.includes('cl_4'));
  assert.deepEqual(themeOfCl4.clusterIds, ['cl_4']);
  const themeOfCl5 = idx.themes.find((t) => t.clusterIds.includes('cl_5'));
  assert.deepEqual(themeOfCl5.clusterIds, ['cl_5']);
  assert.equal(themeOfCl5.exemplarCount, 2, 'cl_5 มี exemplar 2 ใบ (ไม่ใช่ singleton ตั้งแต่ต้น)');
});

// ── clusterId ก่อน/หลัง byte-equal ──────────────────────────────────────────
test('index.byClusterId มี clusterId เดิมครบทุกตัว ไม่มีการแปลงค่า (byte-equal)', () => {
  const exemplars = makeFixture();
  const idx = buildVirtualThemeIndex(exemplars);
  const inputClusterIds = [...new Set(exemplars.map((e) => e.clusterId))].sort();
  const outputClusterIds = Object.keys(idx.byClusterId).sort();
  assert.deepEqual(outputClusterIds, inputClusterIds, 'ต้องมี clusterId เดิมครบ ไม่ขาด/ไม่เกิน/ไม่แปลงค่า');
  for (const cid of inputClusterIds) {
    assert.equal(typeof idx.byClusterId[cid], 'string');
    assert.match(idx.byClusterId[cid], ID_RE);
  }
});

// ── resolveVirtualThemeSelection ────────────────────────────────────────────
test('resolveVirtualThemeSelection: คืน clusterId ครบของกลุ่มที่เลือก (unique, deterministic)', () => {
  const idx = buildVirtualThemeIndex(makeFixture());
  const themeOfCl1 = idx.themes.find((t) => t.clusterIds.includes('cl_1'));
  const result = resolveVirtualThemeSelection([themeOfCl1.id], idx);
  assert.deepEqual(result, themeOfCl1.clusterIds);
  assert.deepEqual(result, ['cl_1', 'cl_2', 'cl_3']);

  // เรียกซ้ำ → ผลเดิมเป๊ะ
  assert.deepEqual(resolveVirtualThemeSelection([themeOfCl1.id], idx), result);
});

test('resolveVirtualThemeSelection: id ไม่พบ → []', () => {
  const idx = buildVirtualThemeIndex(makeFixture());
  assert.deepEqual(resolveVirtualThemeSelection(['vt_0000000000000000'], idx), []);
  assert.deepEqual(resolveVirtualThemeSelection(['ไม่มีจริงแน่นอน'], idx), []);
});

test('resolveVirtualThemeSelection: virtualThemeIds ว่าง/ผิดชนิด → []', () => {
  const idx = buildVirtualThemeIndex(makeFixture());
  assert.deepEqual(resolveVirtualThemeSelection([], idx), []);
  assert.deepEqual(resolveVirtualThemeSelection(null, idx), []);
  assert.deepEqual(resolveVirtualThemeSelection(undefined, idx), []);
  assert.deepEqual(resolveVirtualThemeSelection([null, 42, ''], idx), []);
});

test('resolveVirtualThemeSelection: index ผิดรูป/ว่าง → []', () => {
  assert.deepEqual(resolveVirtualThemeSelection(['vt_x'], {}), []);
  assert.deepEqual(resolveVirtualThemeSelection(['vt_x'], null), []);
  assert.deepEqual(resolveVirtualThemeSelection(['vt_x'], { themes: [] }), []);
});

test('resolveVirtualThemeSelection: เลือกหลายกลุ่ม → union unique เรียงตามลำดับกลุ่มที่ขอ ไม่ซ้ำ', () => {
  const idx = buildVirtualThemeIndex(makeFixture());
  const themeOfCl1 = idx.themes.find((t) => t.clusterIds.includes('cl_1'));
  const themeOfCl4 = idx.themes.find((t) => t.clusterIds.includes('cl_4'));

  const result = resolveVirtualThemeSelection([themeOfCl1.id, themeOfCl4.id, themeOfCl1.id], idx);
  assert.deepEqual(result, [...themeOfCl1.clusterIds, ...themeOfCl4.clusterIds]);
  assert.equal(new Set(result).size, result.length, 'ต้องไม่มี clusterId ซ้ำ');

  // สลับลำดับกลุ่มที่ขอ → ลำดับผลลัพธ์สลับตาม (แต่ยังครบ unique เหมือนกัน)
  const swapped = resolveVirtualThemeSelection([themeOfCl4.id, themeOfCl1.id], idx);
  assert.deepEqual(swapped, [...themeOfCl4.clusterIds, ...themeOfCl1.clusterIds]);
  assert.deepEqual(new Set(swapped), new Set(result));
});

// ── static: กติกาเหล็ก deskV2 (pure, ห้าม import ต้องห้าม, ห้าม Math.random/Date.now) ──────
test('researchThemeIndex.js ต้องไม่มีคำว่า persistStore/openai/aiRouter/dnaLibrary/callAI', () => {
  const src = readFileSync(MODULE_PATH, 'utf8');
  assert.ok(!/persistStore/i.test(src), 'ห้ามมีคำว่า persistStore');
  assert.ok(!/openai/i.test(src), 'ห้ามมีคำว่า openai');
  assert.ok(!/aiRouter/i.test(src), 'ห้ามมีคำว่า aiRouter');
  assert.ok(!/dnaLibrary/i.test(src), 'ห้ามมีคำว่า dnaLibrary');
  assert.ok(!/callAI/i.test(src), 'ห้ามมีคำว่า callAI');
});

test('researchThemeIndex.js ต้อง import ได้เฉพาะ dnaContract.js เท่านั้น + ห้าม import* / network / fs', () => {
  const src = readFileSync(MODULE_PATH, 'utf8');
  const importSpecs = [...src.matchAll(/^import\s+.*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.ok(importSpecs.length > 0, 'ต้องมี import อย่างน้อย dnaContract.js');
  for (const spec of importSpecs) {
    assert.ok(spec.endsWith('dnaContract.js'), `import ต้องห้าม: ${spec}`);
  }
  assert.ok(!/import\s*\*/.test(src), 'ห้าม import *');
  assert.ok(!/\bfetch\s*\(/.test(src), 'ห้ามเรียก network (fetch)');
  assert.ok(!/from\s+['"]node:fs['"]/.test(src) && !/from\s+['"]fs['"]/.test(src), 'ห้าม import fs');
});

test('researchThemeIndex.js ต้อง deterministic ล้วน — ห้าม Math.random()/Date.now()', () => {
  const src = readFileSync(MODULE_PATH, 'utf8');
  assert.ok(!/Math\.random/.test(src), 'ห้ามใช้ Math.random');
  assert.ok(!/Date\.now/.test(src), 'ห้ามใช้ Date.now');
});
