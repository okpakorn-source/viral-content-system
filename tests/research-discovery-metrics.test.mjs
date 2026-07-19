// ============================================================
// 🧪 เฟส 0 — Research Discovery Metrics (offline unit test)
// ------------------------------------------------------------
// Target: src/lib/services/deskV2/researchDiscoveryMetrics.js
//   • computeDiscoveryMetrics({sample, priorStoryKeys, targets, ...})
//
// 🔴 พิสูจน์: นับ "เรื่องใหม่จริง" ถูก (ตัดเรื่องที่เพจเคยทำ), สัดส่วนช่องทาง, ลีดสัมภาษณ์, เรื่องซ้ำ
// pure module ไม่มี import → import ตรงได้
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDiscoveryMetrics, provisionalStoryKey } from '../src/lib/services/deskV2/researchDiscoveryMetrics.js';

test('sample ว่าง → ทุกตัวเป็น 0 + noveltyRate 0', () => {
  const m = computeDiscoveryMetrics({});
  assert.equal(m.candidateCount, 0);
  assert.equal(m.keptCount, 0);
  assert.equal(m.uniqueStoryCount, 0);
  assert.equal(m.noveltyRate, 0);
  assert.equal(m.mode, 'shadow');
  assert.equal(m.schemaVersion, 2);
});

test('novelty: 3 เรื่องที่เก็บ 1 เรื่องเคยทำ → ใหม่ 2/3 = 0.667', () => {
  const sample = [
    { urlKey: 'u1', storyKey: 's1', kept: true },
    { urlKey: 'u2', storyKey: 's2', kept: true },
    { urlKey: 'u3', storyKey: 's3', kept: true },
    { urlKey: 'u4', storyKey: 's4', kept: false }, // ไม่เก็บ ไม่นับ
  ];
  const m = computeDiscoveryMetrics({ sample, priorStoryKeys: ['s2'] });
  assert.equal(m.keptCount, 3);
  assert.equal(m.uniqueStoryCount, 3);
  assert.equal(m.novelStoryCount, 2);
  assert.equal(m.noveltyRate, 0.667);
});

test('เรื่องเดียวกันคนละ URL (storyKey ซ้ำ) นับเป็นเรื่องเดียว', () => {
  const sample = [
    { urlKey: 'a1', storyKey: 'same', kept: true },
    { urlKey: 'a2', storyKey: 'same', kept: true },
  ];
  const m = computeDiscoveryMetrics({ sample });
  assert.equal(m.keptCount, 2);
  assert.equal(m.uniqueStoryCount, 1); // เรื่องเดียว
});

test('fallback ตัวชี้เรื่อง: ไม่มี storyKey ใช้ fingerprint แล้ว urlKey', () => {
  const sample = [
    { urlKey: 'x1', fingerprint: 'fp1', kept: true },
    { urlKey: 'x2', kept: true }, // ใช้ urlKey
  ];
  const m = computeDiscoveryMetrics({ sample, priorStoryKeys: ['fp1'] });
  assert.equal(m.uniqueStoryCount, 2);
  assert.equal(m.novelStoryCount, 1); // fp1 เคยทำ → เหลือใหม่ 1 (x2)
});

test('byPlatformGroup / byCategory นับถูก', () => {
  const sample = [
    { urlKey: 'u1', platformGroup: 'meta', category: 'บันเทิง/ดารา', kept: true },
    { urlKey: 'u2', platformGroup: 'meta', category: 'น้ำใจ/ทำดี', kept: true },
    { urlKey: 'u3', platformGroup: 'tiktok', category: 'บันเทิง/ดารา', kept: false },
  ];
  const m = computeDiscoveryMetrics({ sample });
  assert.deepEqual(m.byPlatformGroup, { meta: 2, tiktok: 1 });
  assert.deepEqual(m.byCategory, { 'บันเทิง/ดารา': 2, 'น้ำใจ/ทำดี': 1 });
});

test('duplicateEvidenceCount = ผลรวมส่วนเกินของ url ซ้ำ', () => {
  const sample = [
    { urlKey: 'dup', kept: true },
    { urlKey: 'dup', kept: false },
    { urlKey: 'dup', kept: false },
    { urlKey: 'solo', kept: true },
  ];
  const m = computeDiscoveryMetrics({ sample });
  assert.equal(m.duplicateEvidenceCount, 2); // dup โผล่ 3 ครั้ง = เกิน 2
});

test('นับลีดสัมภาษณ์แยก (candidate + kept)', () => {
  const sample = [
    { urlKey: 'i1', lane: 'interview', kept: true },
    { urlKey: 'i2', lane: 'interview', kept: false },
    { urlKey: 'd1', lane: 'dna', kept: true },
  ];
  const m = computeDiscoveryMetrics({ sample });
  assert.equal(m.interviewCandidateCount, 2);
  assert.equal(m.interviewKeptCount, 1);
});

test('targetDelta เทียบสัดส่วนจริง vs เป้า', () => {
  const sample = [
    { urlKey: 'u1', platformGroup: 'meta' },
    { urlKey: 'u2', platformGroup: 'meta' },
    { urlKey: 'u3', platformGroup: 'tiktok' },
    { urlKey: 'u4', platformGroup: 'youtube' },
  ];
  const m = computeDiscoveryMetrics({ sample, targets: { platformPct: { meta: 45, tiktok: 29, youtube: 26 } } });
  // meta 2/4 = 50% (เป้า 45 → +5), tiktok 25% (เป้า 29 → -4), youtube 25% (เป้า 26 → -1)
  assert.equal(m.targetDelta.meta.actualPct, 50);
  assert.equal(m.targetDelta.meta.deltaPct, 5);
  assert.equal(m.targetDelta.tiktok.deltaPct, -4);
  assert.equal(m.targetDelta.youtube.deltaPct, -1);
});

test('deterministic: input เดิม → ผลเท่าเดิม', () => {
  const args = { sample: [{ urlKey: 'u1', storyKey: 's1', platformGroup: 'meta', kept: true }], priorStoryKeys: [], targets: { platformPct: { meta: 45 } } };
  assert.deepEqual(computeDiscoveryMetrics(args), computeDiscoveryMetrics(args));
});

test('provisionalStoryKey: ชื่อสลับลำดับ → คีย์เดียวกัน', () => {
  const a = provisionalStoryKey({ names: ['ก้อย', 'ตูน'], action: 'เปิดใจ', numbers: ['800'] });
  const b = provisionalStoryKey({ names: ['ตูน', 'ก้อย'], action: 'เปิดใจ', numbers: ['800'] });
  assert.equal(a, b);
  assert.ok(a.length > 0);
});

test('provisionalStoryKey: คนละเรื่อง → คีย์ต่างกัน; ไม่มีชื่อ+action → ""', () => {
  const a = provisionalStoryKey({ names: ['ก้อย'], action: 'เปิดใจ' });
  const b = provisionalStoryKey({ names: ['เชน'], action: 'ขอโทษ' });
  assert.notEqual(a, b);
  assert.equal(provisionalStoryKey({ names: [], action: '' }), '');
  assert.equal(provisionalStoryKey({}), '');
});

test('object fingerprint ใน sample ไม่พังคีย์ (ตกไปใช้ urlKey ไม่ใช่ "[object Object]")', () => {
  const sample = [
    { urlKey: 'u1', fingerprint: { names: ['x'], action: 'y' }, kept: true },
    { urlKey: 'u1', fingerprint: { names: ['x'], action: 'y' }, kept: true },
  ];
  const m = computeDiscoveryMetrics({ sample });
  assert.equal(m.uniqueStoryCount, 1); // url เดียว → เรื่องเดียว
});
