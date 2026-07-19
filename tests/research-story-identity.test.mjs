// ============================================================
// 🧪 Research Story Identity (เฟส 5) — offline unit test (pure)
// Target: src/lib/services/deskV2/researchStoryIdentity.js
//   • buildStoryIdentity — คีย์เรื่อง + confidence จาก fingerprint (fallback title)
//   • storySimilarity    — เรื่องเดียวสูง / คนเดียวคนละเหตุการณ์ต่ำ
//   • mergeStorySources  — รวมแหล่งรอง (altSources) canonical id คงเดิม
// pure: import ผ่าน dnaContract (crypto) — ไม่ต้อง stub
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStoryIdentity, storySimilarity, mergeStorySources } from '../src/lib/services/deskV2/researchStoryIdentity.js';

const fp = (names, action, timeHint = '', numbers = []) => ({ fingerprint: { names, action, timeHint, numbers } });

// ── buildStoryIdentity ──
test('ชื่อ+การกระทำ+เลข → confidence 0.9', () => {
  const id = buildStoryIdentity(fp(['ก้อย'], 'บริจาค', '', ['1000000']));
  assert.equal(id.storyKeyConfidence, 0.9);
  assert.ok(id.storyKey.includes('ก้อย') && id.storyKey.includes('บริจาค'));
  assert.equal(id.basis, 'fingerprint');
});

test('ชื่อ+การกระทำ (ไม่มีเลข/เวลา) → 0.75', () => {
  assert.equal(buildStoryIdentity(fp(['ตูน'], 'วิ่งการกุศล')).storyKeyConfidence, 0.75);
});

test('ชื่อสลับลำดับ → คีย์เดียวกัน', () => {
  const a = buildStoryIdentity(fp(['ก้อย', 'ตูน'], 'แต่งงาน')).storyKey;
  const b = buildStoryIdentity(fp(['ตูน', 'ก้อย'], 'แต่งงาน')).storyKey;
  assert.equal(a, b);
});

test('คนเดียวกัน คนละการกระทำ → คีย์ต่างกัน (ไม่รวมเป็นเรื่องเดียว)', () => {
  const a = buildStoryIdentity(fp(['เบสท์'], 'เปิดใจเรื่องพ่อ')).storyKey;
  const b = buildStoryIdentity(fp(['เบสท์'], 'เปิดตัวแฟนใหม่')).storyKey;
  assert.notEqual(a, b);
});

test('ไม่มี fingerprint → fallback title tokens (0.3) ; ว่างจริง → 0', () => {
  const id = buildStoryIdentity({ title: 'ชายใจบุญ บริจาคเงินช่วยโรงพยาบาล', publishedAt: '2026-07-19T00:00:00Z' });
  assert.equal(id.storyKeyConfidence, 0.3);
  assert.equal(id.basis, 'title-tokens');
  assert.equal(buildStoryIdentity({}).storyKey, '');
  assert.equal(buildStoryIdentity({}).storyKeyConfidence, 0);
});

// ── storySimilarity ──
test('เรื่องเดียวกัน (ชื่อ+การกระทำตรง) → คล้ายสูง', () => {
  const s = storySimilarity(fp(['ก้อย'], 'บริจาค'), fp(['ก้อย'], 'บริจาค'));
  assert.ok(s >= 0.85, `ควรสูง ได้ ${s}`);
});

test('คนเดียวกัน คนละเหตุการณ์ → คล้ายต่ำกว่าเรื่องเดียวกันชัดเจน', () => {
  const same = storySimilarity(fp(['เบสท์'], 'เปิดใจเรื่องพ่อ'), fp(['เบสท์'], 'เปิดใจเรื่องพ่อ'));
  const diff = storySimilarity(fp(['เบสท์'], 'เปิดใจเรื่องพ่อ'), fp(['เบสท์'], 'เปิดตัวแฟนใหม่'));
  assert.ok(diff < same, `คนละเหตุการณ์ (${diff}) ต้องต่ำกว่าเรื่องเดียวกัน (${same})`);
});

test('ไม่มีชื่อร่วมเลย → คล้ายต่ำมาก (≤0.2)', () => {
  assert.ok(storySimilarity(fp(['ก้อย'], 'บริจาค'), fp(['ตูน'], 'วิ่ง')) <= 0.2);
});

// ── mergeStorySources ──
test('รวม 2 เว็บเป็นการ์ดเดียว — altSources + sourceCount + channels; primary url คงเดิม', () => {
  const primary = { id: 'lead_x', url: 'https://a.com/1', channel: 'google', sourceHost: 'a.com', ...fp(['ก้อย'], 'บริจาค') };
  const dups = [
    { url: 'https://b.com/2', channel: 'facebook', sourceHost: 'b.com', sourceType: 'serper-news', title: 'ข่าว b' },
    { url: 'https://c.com/3', channel: 'youtube', sourceHost: 'c.com', title: 'ข่าว c' },
  ];
  const merged = mergeStorySources(primary, dups);
  assert.equal(merged.url, 'https://a.com/1'); // canonical คงเดิม
  assert.equal(merged.id, 'lead_x');
  assert.equal(merged.sourceCount, 3);
  assert.equal(merged.altSources.length, 2);
  assert.ok(merged.channels.includes('google') && merged.channels.includes('facebook') && merged.channels.includes('youtube'));
  assert.ok(merged.storyKey.includes('ก้อย'));
});

test('mergeStorySources: url ซ้ำกับ primary/กันเอง ไม่เข้า altSources + ไม่ mutate input', () => {
  const primary = { url: 'https://a.com/1', channel: 'google' };
  const dups = [{ url: 'https://a.com/1', channel: 'google' }, { url: 'https://b.com/2', channel: 'tiktok' }];
  const before = JSON.stringify({ primary, dups });
  const merged = mergeStorySources(primary, dups);
  assert.equal(merged.altSources.length, 1); // a.com/1 ซ้ำ primary → ตัด
  assert.equal(merged.sourceCount, 2);
  assert.equal(JSON.stringify({ primary, dups }), before); // ไม่ mutate
  assert.equal(primary.altSources, undefined);
});

test('altSources cap ที่ 12', () => {
  const dups = Array.from({ length: 20 }, (_, i) => ({ url: `https://x.com/${i}`, channel: 'google' }));
  const merged = mergeStorySources({ url: 'https://p.com/0' }, dups);
  assert.equal(merged.altSources.length, 12);
});
