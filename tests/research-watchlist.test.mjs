// ============================================================
// 🧪 Research Watchlist (เฟส 6 — เลนสัมภาษณ์คนดัง) — offline unit test
// Target: src/lib/services/deskV2/researchWatchlist.js
//   • WATCHLIST_SEED_V1 / getWatchlistSeed — ชุดรายชื่อตั้งต้น 27 คน + 2 รายการ
//   • selectWatchlistForRound — หมุนโควตาต่อรอบ (least-recently-used, deterministic)
//   • buildWatchlistIndex / matchWatchlistNames — จับชื่อแบบ "คำเต็ม" เท่านั้น
//   • deriveStaffSignals — เก็บคน/รายการจากข้อมูลพนักงาน (best-effort)
// pure: import ผ่าน dnaContract (crypto builtin) เท่านั้น — ไม่ต้อง stub persistStore
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WATCHLIST_SEED_V1,
  getWatchlistSeed,
  selectWatchlistForRound,
  buildWatchlistIndex,
  matchWatchlistNames,
  deriveStaffSignals,
} from '../src/lib/services/deskV2/researchWatchlist.js';

const WATCHLIST_PATH = new URL('../src/lib/services/deskV2/researchWatchlist.js', import.meta.url);

// ── ชุด seed: 27 คน + 2 รายการ ไม่ซ้ำ ──
test('WATCHLIST_SEED_V1: มี 27 person + 2 program พอดี, id/name ไม่ซ้ำ', () => {
  const persons = WATCHLIST_SEED_V1.filter((e) => e.kind === 'person');
  const programs = WATCHLIST_SEED_V1.filter((e) => e.kind === 'program');
  assert.equal(persons.length, 27, `ต้องมี person 27 คน ได้ ${persons.length}`);
  assert.equal(programs.length, 2, `ต้องมี program 2 รายการ ได้ ${programs.length}`);
  assert.equal(WATCHLIST_SEED_V1.length, 29);

  const ids = WATCHLIST_SEED_V1.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'id ต้องไม่ซ้ำ');
  const names = WATCHLIST_SEED_V1.map((e) => e.name.toLowerCase());
  assert.equal(new Set(names).size, names.length, 'name ต้องไม่ซ้ำ');

  for (const e of WATCHLIST_SEED_V1) {
    assert.equal(e.sourceVersion, 'seed-v1');
    assert.equal(e.active, true);
    assert.ok(Array.isArray(e.aliases), 'aliases ต้องเป็น array');
    assert.equal(e.aliases.length, 0, 'seed-v1 ต้องไม่เติม alias ที่ไม่ได้ให้มา');
    assert.equal(typeof e.needsContext, 'boolean');
  }

  const programNames = programs.map((p) => p.name).sort();
  assert.deepEqual(programNames, ['Sad Bar', 'แฉ'].sort());
});

// ── needsContext ถูกเฉพาะ 3 ชื่อกำกวม ──
test('needsContext: true เฉพาะ คิว/พี่ช้าง/ป๋ากิ๊ก เท่านั้น', () => {
  const flagged = WATCHLIST_SEED_V1.filter((e) => e.needsContext).map((e) => e.name).sort();
  assert.deepEqual(flagged, ['คิว', 'ป๋ากิ๊ก', 'พี่ช้าง'].sort());
  assert.equal(flagged.length, 3);
});

// ── getWatchlistSeed: ไม่คืน ref เดิม ──
test('getWatchlistSeed: object/array ใหม่ทุกครั้ง — แก้ผลลัพธ์ไม่กระทบ seed ต้นทาง', () => {
  const first = getWatchlistSeed();
  assert.notEqual(first, WATCHLIST_SEED_V1, 'array reference ต้องใหม่');
  first[0].name = 'ถูกแก้แล้ว';
  first[0].aliases.push('ปลอม');
  first.push({ id: 'fake', name: 'fake', aliases: [], kind: 'person', needsContext: false, sourceVersion: 'x', active: true });

  const second = getWatchlistSeed();
  assert.notEqual(second[0], first[0], 'object reference ต่อ entry ต้องใหม่ทุกครั้งที่เรียก');
  assert.notEqual(second[0].name, 'ถูกแก้แล้ว');
  assert.equal(second[0].aliases.length, 0);
  assert.equal(second.length, 29, 'push เข้าผลลัพธ์เก่า ต้องไม่ทำให้ seed ต้นทางยาวขึ้น');
  assert.ok(!second.some((e) => e.id === 'fake'));
});

test('getWatchlistSeed: คืนเฉพาะ active (WATCHLIST_SEED_V1 ปัจจุบัน active ทั้งหมด → เท่ากับ 29)', () => {
  const seed = getWatchlistSeed();
  assert.ok(seed.every((e) => e.active === true));
  assert.equal(seed.length, WATCHLIST_SEED_V1.filter((e) => e.active).length);
});

// ── selectWatchlistForRound: หมุนไม่ซ้ำ deterministic ──
test('selectWatchlistForRound: ไม่มีประวัติ → เรียงตาม index เดิม', () => {
  const persons = getWatchlistSeed().filter((e) => e.kind === 'person');
  const picked = selectWatchlistForRound({ entries: persons, recentRunIds: [], limit: 6 });
  assert.deepEqual(picked.map((p) => p.id), persons.slice(0, 6).map((p) => p.id));
});

test('selectWatchlistForRound: หมุนครบ 27 คนภายใน 5 รอบ ไม่ซ้ำก่อนครบ + deterministic', () => {
  const persons = getWatchlistSeed().filter((e) => e.kind === 'person');
  const runHistory = [];
  const roundsPicked = [];
  for (let round = 0; round < 5; round++) {
    const picked = selectWatchlistForRound({ entries: persons, recentRunIds: runHistory, limit: 6 });
    roundsPicked.push(picked.map((p) => p.id));
    runHistory.push(picked.map((p) => p.id));
  }
  const coveredByRound4 = new Set(roundsPicked.slice(0, 4).flat());
  assert.equal(coveredByRound4.size, 24, 'รอบ 1-4 (6 คน/รอบ) ต้องไม่ซ้ำกันเลย รวม 24 คนต่างกัน');
  const coveredAll = new Set(roundsPicked.flat());
  assert.equal(coveredAll.size, 27, 'ครบ 27 คนภายใน 5 รอบ');

  // deterministic: รันซ้ำ input เดิมทั้งหมด (fresh entries object) ต้องได้ผลเดิมเป๊ะ
  const persons2 = getWatchlistSeed().filter((e) => e.kind === 'person');
  const runHistory2 = [];
  const roundsPicked2 = [];
  for (let round = 0; round < 5; round++) {
    const picked = selectWatchlistForRound({ entries: persons2, recentRunIds: runHistory2, limit: 6 });
    roundsPicked2.push(picked.map((p) => p.id));
    runHistory2.push(picked.map((p) => p.id));
  }
  assert.deepEqual(roundsPicked, roundsPicked2);
});

test('selectWatchlistForRound: ไม่ mutate entries/recentRunIds ที่ส่งเข้ามา', () => {
  const persons = getWatchlistSeed().filter((e) => e.kind === 'person');
  const before = JSON.stringify(persons);
  const history = [['wl-p01', 'wl-p02']];
  const historyBefore = JSON.stringify(history);
  selectWatchlistForRound({ entries: persons, recentRunIds: history, limit: 5 });
  assert.equal(JSON.stringify(persons), before);
  assert.equal(JSON.stringify(history), historyBefore);
});

test('selectWatchlistForRound: limit เกินจำนวน entries → คืนเท่าที่มี ไม่ throw', () => {
  const persons = getWatchlistSeed().filter((e) => e.kind === 'person');
  const picked = selectWatchlistForRound({ entries: persons, recentRunIds: [], limit: 999 });
  assert.equal(picked.length, 27);
});

// ── matchWatchlistNames: exact เท่านั้น ไม่จับ substring มั่ว ──
test('matchWatchlistNames: จับชื่อคำเต็มที่มีขอบเขตชัดเจน', () => {
  const index = buildWatchlistIndex(getWatchlistSeed());
  const hits = matchWatchlistNames('วันนี้ แพท ณปภา เปิดใจครั้งแรก', index);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, 'แพท ณปภา');
  assert.equal(hits[0].matched, true);
  assert.ok(hits[0].entryId);
});

test('matchWatchlistNames: ไม่จับ substring ที่ฝังอยู่ในคำยาวกว่า (คิว ไม่ตรงใน คิวบา)', () => {
  const index = buildWatchlistIndex(getWatchlistSeed());
  const hits = matchWatchlistNames('ประเทศคิวบาอยู่ในทะเลแคริบเบียน', index);
  assert.deepEqual(hits, []);
});

test('matchWatchlistNames: ข้อความว่าง/ไม่มีชื่อใดตรงเลย → []', () => {
  const index = buildWatchlistIndex(getWatchlistSeed());
  assert.deepEqual(matchWatchlistNames('', index), []);
  assert.deepEqual(matchWatchlistNames('ข่าวทั่วไปไม่เกี่ยวกับใครในลิสต์เลย', index), []);
});

test('matchWatchlistNames: ชื่อหลายคนในข้อความเดียว → ได้ทุกคนที่ตรง ไม่ซ้ำ entryId', () => {
  const index = buildWatchlistIndex(getWatchlistSeed());
  const hits = matchWatchlistNames('อั้ม พัชราภา และ บุ๋ม ปนัดดา ร่วมงานกัน', index);
  const ids = hits.map((h) => h.entryId).sort();
  assert.equal(hits.length, 2);
  assert.equal(new Set(ids).size, 2);
});

// ── deriveStaffSignals: best-effort ทน field หาย ──
test('deriveStaffSignals: input ว่าง/ไม่มี field → ไม่ throw คืน array ว่าง', () => {
  assert.deepEqual(deriveStaffSignals({}), { peopleHints: [], programHints: [] });
  assert.deepEqual(deriveStaffSignals(), { peopleHints: [], programHints: [] });
  assert.deepEqual(
    deriveStaffSignals({ clipInsights: [null, {}, { foo: 'bar' }], topicHunts: ['ไม่ใช่ object'] }),
    { peopleHints: [], programHints: [] }
  );
});

test('deriveStaffSignals: เก็บ people/program จากฟิลด์ที่พบ + dedup', () => {
  const out = deriveStaffSignals({
    clipInsights: [
      { people: ['คนหนึ่ง', 'คนหนึ่ง'], program: 'แฉ' },
      { insight: { speakers: ['คนสอง'], programName: 'Sad Bar' } },
    ],
    topicHunts: [{ people: ['คนหนึ่ง'], programs: ['แฉ'] }],
  });
  assert.deepEqual(out.peopleHints, ['คนหนึ่ง', 'คนสอง']);
  assert.deepEqual(out.programHints, ['แฉ', 'Sad Bar']);
});

// ── ยืนยันไม่มี import ต้องห้าม (deskV2 rule) ──
test('researchWatchlist.js ต้องไม่มีคำว่า openai/aiRouter/persistStore/callAI/interviewMiner', () => {
  const src = readFileSync(WATCHLIST_PATH, 'utf8');
  assert.ok(!/openai/i.test(src), 'ห้ามมีคำว่า openai');
  assert.ok(!/aiRouter/i.test(src), 'ห้ามมีคำว่า aiRouter');
  assert.ok(!/persistStore/i.test(src), 'ห้ามมีคำว่า persistStore');
  assert.ok(!/callAI/i.test(src), 'ห้ามมีคำว่า callAI');
  assert.ok(!/interviewMiner/i.test(src), 'ห้ามมีคำว่า interviewMiner');
});

test('researchWatchlist.js ต้อง import ได้เฉพาะ dnaContract.js เท่านั้น + ห้าม import * / Math.random / Date.now', () => {
  const src = readFileSync(WATCHLIST_PATH, 'utf8');
  const importSpecs = [...src.matchAll(/^import\s+.*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.ok(importSpecs.length > 0, 'ต้องมี import อย่างน้อย dnaContract');
  for (const spec of importSpecs) {
    assert.ok(spec.endsWith('dnaContract.js'), `import ต้องห้าม: ${spec}`);
  }
  assert.ok(!/import\s*\*/.test(src), 'ห้าม import *');
  assert.ok(!/Math\.random/.test(src), 'ห้ามใช้ Math.random');
  assert.ok(!/Date\.now/.test(src), 'ห้ามใช้ Date.now');
});
