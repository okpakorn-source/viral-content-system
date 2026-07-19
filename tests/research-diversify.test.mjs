// ============================================================
// 🧪 Research Diversify (เฟส 2) — offline unit test
// Target: src/lib/services/deskV2/researchDiversify.js
//   • mergeCandidateEvidence — รวม URL ซ้ำ + สะสมหลักฐาน (hitCount/queryHits/channels)
//   • allocateWeightedSlots  — จัดโควตาถ่วงน้ำหนัก (Meta/TikTok/YouTube → 7/5/4) + redistribute
//   • rankDiverseCandidates  — จัดอันดับกระจายข้ามแพลตฟอร์ม (deterministic, ไม่ mutate)
// pure: import ผ่าน dnaContract (crypto builtin) — ไม่ต้อง stub persistStore
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCandidateEvidence, allocateWeightedSlots, rankDiverseCandidates } from '../src/lib/services/deskV2/researchDiversify.js';

// ── mergeCandidateEvidence ──
test('URL ซ้ำ 3 คำค้น → 1 ใบ แต่ hitCount=3 + เก็บทุกคำค้น/ช่อง', () => {
  const cands = [
    { url: 'https://a.com/1', channel: 'google', discoveredVia: 'google', query: 'q1', position: 1, platformGroup: 'web' },
    { url: 'https://a.com/1', channel: 'facebook', discoveredVia: 'facebook', query: 'q2', position: 3, platformGroup: 'meta' },
    { url: 'https://a.com/1', channel: 'tiktok', discoveredVia: 'google', query: 'q3', position: 2, platformGroup: 'tiktok' },
    { url: 'https://b.com/2', channel: 'youtube', query: 'q1', position: 1, platformGroup: 'youtube' },
  ];
  const merged = mergeCandidateEvidence(cands, { urlKeyFn: (c) => c.url });
  assert.equal(merged.length, 2);
  const a = merged.find((m) => m.url === 'https://a.com/1');
  assert.equal(a.evidence.hitCount, 3);
  assert.equal(a.evidence.queryHits.length, 3);
  assert.equal(a.channel, 'google'); // first-seen wins
  assert.ok(a.evidence.discoveryChannels.includes('google') && a.evidence.discoveryChannels.includes('facebook'));
  const b = merged.find((m) => m.url === 'https://b.com/2');
  assert.equal(b.evidence.hitCount, 1);
});

test('mergeCandidateEvidence ไม่ mutate input', () => {
  const cands = [{ url: 'u', channel: 'google', query: 'q', position: 1 }];
  const before = JSON.stringify(cands);
  mergeCandidateEvidence(cands, { urlKeyFn: (c) => c.url });
  assert.equal(JSON.stringify(cands), before);
  assert.equal(cands[0].evidence, undefined);
});

test('input สลับลำดับ → set ผลเดียวกัน (จำนวน+hitCount)', () => {
  const base = [
    { url: 'u1', query: 'a', position: 1 },
    { url: 'u1', query: 'b', position: 2 },
    { url: 'u2', query: 'a', position: 1 },
  ];
  const m1 = mergeCandidateEvidence(base, { urlKeyFn: (c) => c.url });
  const m2 = mergeCandidateEvidence(base.slice().reverse(), { urlKeyFn: (c) => c.url });
  assert.equal(m1.length, m2.length);
  const h1 = Object.fromEntries(m1.map((m) => [m.url, m.evidence.hitCount]));
  const h2 = Object.fromEntries(m2.map((m) => [m.url, m.evidence.hitCount]));
  assert.deepEqual(h1, h2);
});

// ── allocateWeightedSlots ──
test('16 ที่นั่ง social ครบ 3 กลุ่ม (45/29/26) → 7 Meta / 5 TikTok / 4 YouTube', () => {
  const alloc = allocateWeightedSlots(16, { meta: 20, tiktok: 20, youtube: 20 }, { meta: 45, tiktok: 29, youtube: 26 });
  assert.deepEqual(alloc, { meta: 7, tiktok: 5, youtube: 4 });
  assert.equal(alloc.meta + alloc.tiktok + alloc.youtube, 16);
});

test('ของไม่พอ → cap + redistribute ไม่ปล่อยที่ว่าง (รวมยังเท่าที่มี)', () => {
  const alloc = allocateWeightedSlots(16, { meta: 2, tiktok: 20, youtube: 20 }, { meta: 45, tiktok: 29, youtube: 26 });
  assert.equal(alloc.meta, 2); // cap ที่ของที่มี
  assert.equal(alloc.meta + alloc.tiktok + alloc.youtube, 16); // เต็ม 16 ไม่มีที่ว่าง
});

test('total เกินของที่มีทั้งหมด → จัดสรรได้แค่เท่าที่มี', () => {
  const alloc = allocateWeightedSlots(16, { meta: 3, tiktok: 2 }, { meta: 45, tiktok: 29 });
  assert.equal(alloc.meta + alloc.tiktok, 5);
});

// ── rankDiverseCandidates ──
function makeGroup(group, n) {
  return Array.from({ length: n }, (_, i) => ({ url: `${group}-${i}`, platformGroup: group, position: i + 1 }));
}

test('social ครบ 3 กลุ่ม → top 16 = 7 Meta / 5 TikTok / 4 YouTube', () => {
  const list = [...makeGroup('meta', 10), ...makeGroup('tiktok', 10), ...makeGroup('youtube', 10)];
  const ranked = rankDiverseCandidates(list);
  const top16 = ranked.slice(0, 16);
  const by = {};
  for (const c of top16) by[c.platformGroup] = (by[c.platformGroup] || 0) + 1;
  assert.deepEqual(by, { meta: 7, tiktok: 5, youtube: 4 });
  // diversityRank ต่อเนื่อง 1..N
  assert.equal(ranked[0].diversityRank, 1);
  assert.equal(ranked[ranked.length - 1].diversityRank, ranked.length);
});

test('ทุกกลุ่มที่มีของได้โอกาสในรอบแรก (ก่อนกลุ่มใดได้ใบที่ 2)', () => {
  const list = [...makeGroup('meta', 5), ...makeGroup('tiktok', 5), ...makeGroup('youtube', 5), ...makeGroup('web', 1)];
  const ranked = rankDiverseCandidates(list);
  const first4 = ranked.slice(0, 4).map((c) => c.platformGroup);
  assert.equal(new Set(first4).size, 4, '4 กลุ่มแรกต้องเป็นคนละกลุ่ม (ทุกกลุ่มได้รอบแรกก่อน)');
});

test('สลับลำดับ input → ผลอันดับเดียวกัน (deterministic)', () => {
  const list = [...makeGroup('meta', 6), ...makeGroup('tiktok', 6), ...makeGroup('youtube', 6)];
  const r1 = rankDiverseCandidates(list).map((c) => c.url);
  const r2 = rankDiverseCandidates(list.slice().reverse()).map((c) => c.url);
  assert.deepEqual(r1, r2);
});

test('rankDiverseCandidates ไม่ mutate input + ไม่ทำใบหาย', () => {
  const list = [...makeGroup('meta', 3), ...makeGroup('tiktok', 2)];
  const before = JSON.stringify(list);
  const ranked = rankDiverseCandidates(list);
  assert.equal(JSON.stringify(list), before);
  assert.equal(list[0].diversityRank, undefined);
  assert.equal(ranked.length, 5); // ครบทุกใบ
});
