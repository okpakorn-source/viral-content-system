// ============================================================
// 🧪 เฟส 0 — Research Discovery Config (offline unit test)
// ------------------------------------------------------------
// Target: src/lib/services/deskV2/researchDiscoveryConfig.js
//   • getDiscoveryConfig(env)       — อ่าน env → config เต็ม
//   • getPublicDiscoveryConfig(env) — ชุดย่อยปลอดภัยสำหรับ UI
//   • DISCOVERY_PRESETS             — 5 ปุ่ม preset
//
// 🟢 canary 20 ก.ค.: ชุดปลอดภัย default=ON (kill ด้วย env=0) · interviewLane+sources ยัง default=OFF (ต้อง env=1)
//    🔴 kill-switch: MASTER (DESK_V2_DISCOVERY_V2)=0 → ปิดหมด = ระบบเดิมเป๊ะ
// pure module ไม่มี external import → import ตรงได้ ไม่ต้อง stub
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDiscoveryConfig,
  getPublicDiscoveryConfig,
  DISCOVERY_PRESETS,
  MASTER_FLAG,
} from '../src/lib/services/deskV2/researchDiscoveryConfig.js';

const SAFE_ON = ['reels', 'diversity', 'queryPlanner', 'storyGrouping', 'highlightConfirm', 'researchUiV2', 'virtualThemes'];

test('canary: env ว่าง → master ON + ชุดปลอดภัย ON · interviewLane/sources OFF', () => {
  const c = getDiscoveryConfig({});
  assert.equal(c.masterOn, true);
  for (const k of SAFE_ON) assert.equal(c.flags[k], true, `ชุดปลอดภัย ${k} ต้องเปิด default`);
  assert.equal(c.flags.interviewLane, false); // รอ F3-F5
  assert.equal(c.flags.sourceExpansion, false); // มีค่า Serper
  for (const [k, v] of Object.entries(c.sources)) assert.equal(v, false, `source ${k} ต้องปิด default`);
  assert.equal(c.schemaVersion, 2);
});

test('kill-switch: MASTER=0 → ปิดหมดทุก flag/source (ระบบเดิมเป๊ะ)', () => {
  const c = getDiscoveryConfig({ [MASTER_FLAG]: '0' });
  assert.equal(c.masterOn, false);
  for (const [k, v] of Object.entries(c.flags)) assert.equal(v, false, `flag ${k} ต้องปิดตอน MASTER=0`);
  for (const [k, v] of Object.entries(c.sources)) assert.equal(v, false, `source ${k} ต้องปิดตอน MASTER=0`);
});

test('kill-switch รายตัว: DESK_V2_DIVERSITY=0 → diversity ปิด แต่ตัวอื่นยังเปิด', () => {
  const c = getDiscoveryConfig({ DESK_V2_DIVERSITY: '0' });
  assert.equal(c.masterOn, true);
  assert.equal(c.flags.diversity, false);
  assert.equal(c.flags.queryPlanner, true);
  assert.equal(c.flags.storyGrouping, true);
});

test('interviewLane ยัง opt-in: default OFF · env=1 → ON · MASTER=0 → OFF', () => {
  assert.equal(getDiscoveryConfig({}).flags.interviewLane, false);
  assert.equal(getDiscoveryConfig({ DESK_V2_INTERVIEW_LANE: '1' }).flags.interviewLane, true);
  assert.equal(getDiscoveryConfig({ DESK_V2_INTERVIEW_LANE: '1', [MASTER_FLAG]: '0' }).flags.interviewLane, false);
});

test('แหล่งข่าวใหม่ต้องเปิดครบ 3 ชั้น (master + expansion + ตัวแหล่ง)', () => {
  // ขาด expansion → แหล่งปิด แม้เปิดตัวแหล่งเอง
  const noExp = getDiscoveryConfig({ [MASTER_FLAG]: '1', DESK_V2_SOURCE_DIRECT_RSS: '1' });
  assert.equal(noExp.flags.sourceExpansion, false);
  assert.equal(noExp.sources.directRss, false);

  // เปิด expansion แต่ไม่เปิดตัวแหล่ง → แหล่งนั้นปิด
  const expOnly = getDiscoveryConfig({ [MASTER_FLAG]: '1', DESK_V2_SOURCE_EXPANSION: '1' });
  assert.equal(expOnly.flags.sourceExpansion, true);
  assert.equal(expOnly.sources.directRss, false);
  assert.equal(expOnly.sources.serperNews, false);

  // ครบ 3 ชั้น → แหล่งเปิด
  const full = getDiscoveryConfig({
    [MASTER_FLAG]: '1', DESK_V2_SOURCE_EXPANSION: '1', DESK_V2_SOURCE_DIRECT_RSS: '1',
  });
  assert.equal(full.sources.directRss, true);
  assert.equal(full.sources.serperNews, false); // ตัวที่ไม่เปิดยังปิด
});

test('งบ default 80 + override + clamp', () => {
  assert.equal(getDiscoveryConfig({}).budget.maxSerperCalls, 80);
  assert.equal(getDiscoveryConfig({ DESK_V2_MAX_SERPER_CALLS: '50' }).budget.maxSerperCalls, 50);
  assert.equal(getDiscoveryConfig({ DESK_V2_MAX_SERPER_CALLS: '9999' }).budget.maxSerperCalls, 1000); // clamp บน
  assert.equal(getDiscoveryConfig({ DESK_V2_MAX_SERPER_CALLS: '0' }).budget.maxSerperCalls, 1);      // clamp ล่าง
  assert.equal(getDiscoveryConfig({ DESK_V2_MAX_SERPER_CALLS: 'abc' }).budget.maxSerperCalls, 80);   // ค่าเสีย → default
});

test('เลนสัมภาษณ์ default 6/2/70 + override + clamp', () => {
  const d = getDiscoveryConfig({}).interview;
  assert.deepEqual([d.peoplePerRound, d.variantsPerPerson, d.maxCalls], [6, 2, 70]);
  const o = getDiscoveryConfig({
    DESK_V2_INTERVIEW_PEOPLE_PER_ROUND: '10',
    DESK_V2_INTERVIEW_VARIANTS_PER_PERSON: '3',
    DESK_V2_INTERVIEW_MAX_CALLS: '120',
  }).interview;
  assert.deepEqual([o.peoplePerRound, o.variantsPerPerson, o.maxCalls], [10, 3, 120]);
  // clamp: คนต่อรอบสูงสุด 27 (จำนวน watchlist), variants สูงสุด 6
  const cl = getDiscoveryConfig({
    DESK_V2_INTERVIEW_PEOPLE_PER_ROUND: '999',
    DESK_V2_INTERVIEW_VARIANTS_PER_PERSON: '999',
  }).interview;
  assert.equal(cl.peoplePerRound, 27);
  assert.equal(cl.variantsPerPerson, 6);
});

test('targets มีสัดส่วนช่องทาง + หมวดครบ', () => {
  const t = getDiscoveryConfig({}).targets;
  assert.deepEqual(t.platformPct, { meta: 45, tiktok: 29, youtube: 26 });
  assert.equal(t.categoryPct['บันเทิง/ดารา'], 40);
  assert.equal(t.categoryPct['น้ำใจ/ทำดี'], 28);
});

test('DISCOVERY_PRESETS = 5 ปุ่ม + คลิปสัมภาษณ์เป็น primary', () => {
  assert.equal(DISCOVERY_PRESETS.length, 5);
  const interview = DISCOVERY_PRESETS.find((p) => p.id === 'interview');
  assert.ok(interview);
  assert.equal(interview.primary, true);
  assert.equal(interview.lane, 'interview');
});

test('getPublicDiscoveryConfig ปลอดภัย: มี flags/presets แต่ไม่หลุดงบ/interview/targets', () => {
  const pub = getPublicDiscoveryConfig({ [MASTER_FLAG]: '1' });
  assert.equal(pub.masterOn, true);
  assert.ok(pub.flags);
  assert.equal(pub.presets.length, 5);
  assert.equal(pub.budget, undefined);
  assert.equal(pub.interview, undefined);
  assert.equal(pub.targets, undefined);
});

test('deterministic: env เดิม → ผลเท่าเดิม', () => {
  const env = { [MASTER_FLAG]: '1', DESK_V2_DIVERSITY: '1' };
  assert.deepEqual(getDiscoveryConfig(env), getDiscoveryConfig(env));
});
