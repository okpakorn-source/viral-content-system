// ============================================================
// 🧪 Plan A — Preset → คีย์ค้นกว้าง (offline unit test)
// ------------------------------------------------------------
// Target: src/lib/services/deskV2/researchPresetQueries.js
//   • presetCategories(id)     — preset → หมวด
//   • buildPresetQueries(id,o) — คีย์กว้าง วงการ×แอ็กชัน + field angles
//
// 🔴 พิสูจน์: คีย์กว้าง (ไม่ ·1) · ติดหมวดถูก · unique · สั้น ≤70 · deterministic · หมุนได้ · ไม่มี AI/ภาพ
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  presetCategories,
  buildPresetQueries,
  PRESET_CATEGORIES,
} from '../src/lib/services/deskV2/researchPresetQueries.js';

test('presetCategories: รู้จัก 4 preset · ไม่รู้จัก/economy → []', () => {
  assert.deepEqual(presetCategories('kindness'), ['น้ำใจ/ช่วยเหลือ', 'กตัญญู/ครอบครัวอบอุ่น']);
  assert.deepEqual(presetCategories('INTERVIEW'), ['สัมภาษณ์/บทสนทนาดี', 'คนดัง/ดราม่าบันเทิง']); // case-insensitive
  assert.deepEqual(presetCategories('economy'), []);
  assert.deepEqual(presetCategories('mystery'), []);
  assert.deepEqual(presetCategories(''), []);
});

test('buildPresetQueries: คืนคีย์กว้างของหมวดที่ตรง preset (ไม่ว่าง)', () => {
  const q = buildPresetQueries('kindness', { count: 24 });
  assert.ok(q.length > 5, 'ควรได้คีย์หลายอัน');
  assert.ok(q.length <= 24, 'ไม่เกิน count');
  const cats = new Set(PRESET_CATEGORIES.kindness);
  for (const item of q) {
    assert.ok(cats.has(item.category), `หมวด ${item.category} ต้องอยู่ใน preset kindness`);
    assert.equal(item.lane, 'broad');
    assert.ok(item.query.length > 0 && item.query.length <= 70, 'คีย์สั้น ≤70');
    assert.ok(item.query.includes(' '), 'คีย์ = วงการ + แอ็กชัน (มีช่องว่าง)'); // กว้าง ไม่ใช่ narrative ยาว
  }
});

test('buildPresetQueries: unique ไม่ซ้ำ', () => {
  const q = buildPresetQueries('society', { count: 50 });
  const keys = q.map((x) => x.query.toLowerCase());
  assert.equal(new Set(keys).size, keys.length, 'ห้ามมีคีย์ซ้ำ');
});

test('buildPresetQueries: preset ไม่รู้จัก/economy → []', () => {
  assert.deepEqual(buildPresetQueries('economy'), []);
  assert.deepEqual(buildPresetQueries('mystery'), []);
});

test('buildPresetQueries: deterministic (seed เดิม → ผลเท่าเดิม)', () => {
  const a = buildPresetQueries('interview', { count: 20, runSeed: 'r1' });
  const b = buildPresetQueries('interview', { count: 20, runSeed: 'r1' });
  assert.deepEqual(a, b);
});

test('buildPresetQueries: runSeed ต่าง → หมุนได้ชุดต่างมุม (variety)', () => {
  const a = buildPresetQueries('interview', { count: 12, runSeed: 'rA' }).map((x) => x.query);
  const b = buildPresetQueries('interview', { count: 12, runSeed: 'rB' }).map((x) => x.query);
  // อย่างน้อยลำดับ/ชุดต้องต่างกันบ้าง (หมุนด้วย seed)
  assert.notDeepEqual(a, b);
});

test('field angles ตรงหมวด: kindness ต้องมีวงการเฉพาะทาง (หมอ/พระ/กู้ภัย)', () => {
  const q = buildPresetQueries('kindness', { count: 100 }).map((x) => x.query);
  const joined = q.join(' | ');
  assert.ok(/หมอ|พระ|กู้ภัย|พยาบาล|ตำรวจ|ทหาร/.test(joined), 'ควรมีวงการเฉพาะทางน้ำใจ');
});

test('researchPresetQueries.js: ไม่มี AI/ภาพ/import ต้องห้าม', () => {
  const src = readFileSync(new URL('../src/lib/services/deskV2/researchPresetQueries.js', import.meta.url), 'utf8');
  assert.ok(!/openai|aiRouter|callAI|persistStore|Date\.now|Math\.random/.test(src), 'ห้ามมี AI/persist/เวลา/สุ่ม');
  assert.ok(!/sharp|jimp|canvas|image/i.test(src), 'ห้ามแตะภาพ');
});
