// ============================================================
// 🩹 recoverOrphanJobs (29 ก.ค. 69, แบตช์เสถียรภาพ) — src/lib/quickTestJobs.js
// ------------------------------------------------------------
// บริบท: :3900 โดน hard-kill (TerminateProcess ไม่มี signal) 5 ครั้ง — งาน dispatch='local' ที่ runJob()
//   ตั้ง status='running' ไว้ค้างกำพร้าถาวร (ไม่มีใคร poll ซ้ำเหมือน dispatch='team') ต้องกู้ตอนบูต
// พิสูจน์: (1) running+local ค้าง>90วิ → pending+dispatch:'team'+retries++ (2) สด≤90วิ → ไม่แตะ (3) ครบ 6
//   รอบ → failed พร้อมข้อความ (4) flag ปิด (MEGA_ORPHAN_RECOVERY=0) → ไม่ทำอะไรเลย (5) dispatch='team'/kind
//   นอกลิสต์/timestamp พัง → ข้าม (6) listJobs/saveJob ล้ม → ไม่ throw ออกไปนอกฟังก์ชัน
// harness: inject _deps.listJobs/_deps.saveJob (in-memory array) — ไม่แตะ Supabase/ไฟล์จริงเลย
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverOrphanJobs, ORPHAN_STALE_MS, ORPHAN_MAX_ROUNDS, ORPHAN_KINDS, ORPHAN_LEGACY_STALE_MS, getBootId } from '../src/lib/quickTestJobs.js';

const NOW = Date.now();
const isoAgo = (ms) => new Date(NOW - ms).toISOString();

// ★ 29 ก.ค. 69 (Opus fix #2): ทุกงานใน fixture เดิมของไฟล์นี้ stamp ownerBootId เป็น "โปรเซสอื่นที่ตายไปแล้ว"
//   โดย default — ต่างจาก bootId จริงของโปรเซสเทสนี้เสมอ (getBootId() คืนค่าสุ่มต่อโปรเซส) → เทสเดิมทั้งหมด
//   (ที่ตั้งเวลาไว้ 90 วิ/120 วิ/200 วิ ฯลฯ) ยังคงทดสอบ "เส้นทางกรณี 2" (bootId ต่างโปรเซส เชื่อ heartbeat/claimedAt
//   เทียบ 90 วิ) เหมือนเดิมทุกกรณี ไม่ต้องแก้เวลาเดิมเลย — ส่วนกรณี 1 (bootId ตรงกัน) และกรณี 3 (legacy ไม่มี stamp)
//   มีเทสแยกเพิ่มด้านล่าง
const OTHER_DEAD_BOOT_ID = 'boot_other_dead_process_never_matches';

function mkJob(overrides = {}) {
  return {
    id: 'qtj_test_' + Math.random().toString(36).slice(2, 8),
    kind: 'compose',
    dispatch: 'local',
    status: 'running',
    label: 'ทดสอบ',
    input: {},
    progress: { step: 'กำลังรัน', pct: 5 },
    result: null,
    error: null,
    retries: 0,
    ownerBootId: OTHER_DEAD_BOOT_ID,
    ownerPort: '3900', // ★ 29 ก.ค. รอบ 3 (Opus): พอร์ตเดียวกับ scanner = เส้นทางกู้เร็ว 90 วิ (คนละพอร์ต=ข้าม)
    createdAt: isoAgo(200 * 1000),
    claimedAt: isoAgo(200 * 1000),
    startedAt: isoAgo(200 * 1000),
    finishedAt: null,
    ...overrides,
  };
}

function mkDeps(initialJobs) {
  const store = new Map(initialJobs.map((j) => [j.id, { ...j }]));
  const saved = [];
  return {
    store, saved,
    listJobs: async () => Array.from(store.values()),
    saveJob: async (job) => { store.set(job.id, { ...job }); saved.push({ ...job }); return job; },
  };
}

const setEnv = (k, v) => { if (v === null) delete process.env[k]; else process.env[k] = v; };

test('ค่าคงที่พื้นฐาน: เกณฑ์เวลา 90 วิ (bootId ต่าง) + 40 นาที (legacy) + เพดาน 6 รอบ + kinds ที่รันบน :3900 จริง', () => {
  assert.equal(ORPHAN_STALE_MS, 90 * 1000);
  assert.equal(ORPHAN_LEGACY_STALE_MS, 40 * 60 * 1000);
  assert.equal(ORPHAN_MAX_ROUNDS, 6);
  assert.deepEqual(ORPHAN_KINDS, ['compose', 'ref', 'desk_harvest', 'desk_search', 'desk_chief']);
});

test('งานกำพร้าเก่า (running+local ค้าง >90วิ) → รีเซ็ตเป็น pending + dispatch เปลี่ยนเป็น team + retries++ + progress log ป้ายกู้', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  const job = mkJob({ claimedAt: isoAgo(120 * 1000), retries: 0 }); // ค้าง 120 วิ > 90 วิ
  const deps = mkDeps([job]);
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } });
  assert.equal(r.scanned, 1);
  assert.equal(r.recovered, 1);
  assert.equal(r.failed, 0);
  const updated = deps.store.get(job.id);
  assert.equal(updated.status, 'pending');
  assert.equal(updated.dispatch, 'team', 'ต้องสลับเป็น team ให้ worker เครื่องทีมหยิบไปรันต่อ');
  assert.equal(updated.retries, 1);
  assert.equal(updated.claimedAt, null);
  assert.match(updated.progress.step, /กู้งานกำพร้า.*1\/6/);
});

test('งานสด (claimedAt ≤90วิ) → ไม่แตะเลย (อาจมีโปรเซสอื่นกำลังทำงานจริงอยู่)', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  const job = mkJob({ claimedAt: isoAgo(30 * 1000) }); // ค้างแค่ 30 วิ
  const deps = mkDeps([job]);
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } });
  assert.equal(r.scanned, 0);
  assert.equal(r.recovered, 0);
  assert.equal(deps.saved.length, 0, 'ห้ามเขียนคลังเลยถ้ายังไม่ผ่านเกณฑ์ 90 วิ');
  assert.deepEqual(deps.store.get(job.id), job);
});

test('ใกล้เขตแดนแต่ยังไม่ถึง (89 วิ) → ยังไม่แตะ — ต้อง "เกิน" 90 วิจริงๆ ถึงจะถือว่ากำพร้า', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  const job = mkJob({ claimedAt: isoAgo(89 * 1000) }); // ต่ำกว่าเกณฑ์ชัดเจน (กันเทส flaky จากความคลาดเคลื่อนวินาที ณ ขอบเป๊ะ)
  const deps = mkDeps([job]);
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } });
  assert.equal(r.scanned, 0, '89 วิ (ต่ำกว่าเกณฑ์ 90 วิ) ยังไม่ถือว่ากำพร้า');
});

test('ครบ 6 รอบแล้ว (retries=6 ก่อนกู้ครั้งนี้) → mark failed พร้อมข้อความบอกเหตุ ไม่ใช่ reset เป็น pending อีก', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  const job = mkJob({ claimedAt: isoAgo(200 * 1000), retries: 6 });
  const deps = mkDeps([job]);
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } });
  assert.equal(r.recovered, 0);
  assert.equal(r.failed, 1);
  const updated = deps.store.get(job.id);
  assert.equal(updated.status, 'failed');
  assert.equal(updated.retries, 7);
  assert.match(updated.error, /เซิร์ฟเวอร์ดับกลางงาน/);
  assert.ok(updated.finishedAt, 'ต้องมี finishedAt ตอนปิดงานเป็น failed');
});

test('รอบที่ 5 (retries=5 ก่อนกู้) → รอบนี้ยังกู้ได้ (รอบ 6/6) ยังไม่ fail — รอบถัดไปถึงจะ fail', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  const job = mkJob({ claimedAt: isoAgo(200 * 1000), retries: 5 });
  const deps = mkDeps([job]);
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } });
  assert.equal(r.recovered, 1);
  assert.equal(r.failed, 0);
  const updated = deps.store.get(job.id);
  assert.equal(updated.status, 'pending');
  assert.equal(updated.retries, 6);
  assert.match(updated.progress.step, /6\/6/);
});

test('MEGA_ORPHAN_RECOVERY=0 → ไม่ทำอะไรเลย (ไม่แม้แต่จะเรียก listJobs)', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', '0');
  let listCalled = false;
  const deps = { listJobs: async () => { listCalled = true; return []; }, saveJob: async () => {} };
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } });
  assert.equal(r.on, false);
  assert.equal(r.scanned, 0);
  assert.ok(!listCalled, 'ปิดสวิตช์ต้องไม่เรียก listJobs เลยด้วยซ้ำ');
  setEnv('MEGA_ORPHAN_RECOVERY', null);
});

test('dispatch=team (แม้ running+ค้างนาน) → ไม่แตะ (มี claimTeamJob เดิมคอย stale-reclaim อยู่แล้ว คนละกลไก)', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  const job = mkJob({ dispatch: 'team', claimedAt: isoAgo(200 * 1000) });
  const deps = mkDeps([job]);
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } });
  assert.equal(r.scanned, 0);
  assert.equal(deps.saved.length, 0);
});

test('dispatch=cloud (running+ค้างนาน) → ไม่แตะ (ไม่ใช่ local)', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  const job = mkJob({ dispatch: 'cloud', claimedAt: isoAgo(200 * 1000) });
  const deps = mkDeps([job]);
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } });
  assert.equal(r.scanned, 0);
});

test('status=pending/done/failed (ไม่ใช่ running) → ข้ามหมด ไม่ว่า claimedAt จะเก่าแค่ไหน', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  const jobs = ['pending', 'done', 'failed'].map((status) => mkJob({ status, claimedAt: isoAgo(999999) }));
  const deps = mkDeps(jobs);
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } });
  assert.equal(r.scanned, 0);
  assert.equal(deps.saved.length, 0);
});

test('kind นอกลิสต์ที่รันบน :3900 (ไม่รู้จัก) → ข้าม แม้ running+local+ค้างนาน', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  const job = mkJob({ kind: 'some_future_kind', claimedAt: isoAgo(200 * 1000) });
  const deps = mkDeps([job]);
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } });
  assert.equal(r.scanned, 0);
});

test('ครอบคลุมทุก kind ใน ORPHAN_KINDS (compose/ref/desk_harvest/desk_search/desk_chief) — ทุกตัวกู้ได้เหมือนกันหมด', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  const jobs = ORPHAN_KINDS.map((kind) => mkJob({ kind, claimedAt: isoAgo(200 * 1000) }));
  const deps = mkDeps(jobs);
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } });
  assert.equal(r.scanned, ORPHAN_KINDS.length);
  assert.equal(r.recovered, ORPHAN_KINDS.length);
  for (const kind of ORPHAN_KINDS) {
    const j = Array.from(deps.store.values()).find((x) => x.kind === kind);
    assert.equal(j.status, 'pending', `${kind} ต้องกู้ได้`);
  }
});

test('claimedAt/startedAt/createdAt พังรูปแบบทั้งหมด (parse ไม่ได้) → ข้าม ปลอดภัยไว้ก่อน (fail-safe) ไม่ throw', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  const job = mkJob({ claimedAt: 'ไม่ใช่วันที่', startedAt: null, createdAt: 'garbage' });
  const deps = mkDeps([job]);
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } });
  assert.equal(r.scanned, 0);
  assert.equal(deps.saved.length, 0);
});

test('ไม่มี claimedAt (null) → ใช้ startedAt แทน (ตามลำดับ fallback claimedAt→startedAt→createdAt)', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  const job = mkJob({ claimedAt: null, startedAt: isoAgo(200 * 1000) });
  const deps = mkDeps([job]);
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } });
  assert.equal(r.recovered, 1, 'ต้องใช้ startedAt คำนวณความค้างได้เมื่อ claimedAt ว่าง');
});

test('listJobs ล้ม (throw) → ไม่ throw ออกนอกฟังก์ชัน คืนผลลัพธ์ว่างพร้อม error message', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  const deps = { listJobs: async () => { throw new Error('Supabase ล่มจำลอง'); }, saveJob: async () => {} };
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } });
  assert.equal(r.scanned, 0);
  assert.equal(r.recovered, 0);
  assert.match(r.error, /Supabase ล่มจำลอง/);
});

test('saveJob ล้มสำหรับใบหนึ่ง → ไม่ทำให้ทั้งฟังก์ชัน throw — ใบอื่นในสแกนเดียวกันยังกู้ได้ปกติ', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  const jobBad = mkJob({ id: 'qtj_bad', claimedAt: isoAgo(200 * 1000) });
  const jobGood = mkJob({ id: 'qtj_good', claimedAt: isoAgo(200 * 1000) });
  const store = new Map([[jobBad.id, jobBad], [jobGood.id, jobGood]]);
  const deps = {
    listJobs: async () => Array.from(store.values()),
    saveJob: async (job) => {
      if (job.id === 'qtj_bad') throw new Error('เขียนล้มจำลอง');
      store.set(job.id, job);
      return job;
    },
  };
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } });
  assert.equal(r.scanned, 2);
  assert.equal(r.recovered, 1, 'ใบที่เขียนสำเร็จต้องนับว่ากู้ได้ 1 ใบ');
  assert.equal(store.get('qtj_good').status, 'pending');
  assert.equal(store.get('qtj_bad').status, 'running', 'ใบที่เขียนล้มต้องคงสภาพเดิม (ไม่ครึ่งๆ กลางๆ)');
});

test('หลายงานปนกัน (บาง kind/dispatch/status ผ่านเกณฑ์ บางไม่ผ่าน) → กรองถูกต้องแม่นยำทุกใบ', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  const jobs = [
    mkJob({ id: 'orphan1', claimedAt: isoAgo(200 * 1000) }), // ผ่าน
    mkJob({ id: 'fresh1', claimedAt: isoAgo(10 * 1000) }), // สดไป
    mkJob({ id: 'team1', dispatch: 'team', claimedAt: isoAgo(200 * 1000) }), // ไม่ใช่ local
    mkJob({ id: 'done1', status: 'done', claimedAt: isoAgo(200 * 1000) }), // ไม่ใช่ running
    mkJob({ id: 'orphan2', kind: 'ref', claimedAt: isoAgo(500 * 1000), retries: 6 }), // ผ่าน แต่ครบรอบ → fail
  ];
  const deps = mkDeps(jobs);
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } });
  assert.equal(r.scanned, 2, 'ต้องเจอแค่ orphan1+orphan2 (2 ใบ) ที่ผ่านเกณฑ์ครบทุกข้อ');
  assert.equal(r.recovered, 1);
  assert.equal(r.failed, 1);
  assert.equal(deps.store.get('orphan1').status, 'pending');
  assert.equal(deps.store.get('orphan2').status, 'failed');
  assert.equal(deps.store.get('fresh1').status, 'running');
  assert.equal(deps.store.get('team1').status, 'running');
  assert.equal(deps.store.get('done1').status, 'done');
});

// ============================================================
// 🩹 29 ก.ค. 69 — Opus fix #2: ownerBootId + heartbeat (ข้ามพอร์ตกู้งานที่ยังรันจริง → ยิงซ้ำ)
// ============================================================

test('bootId ตรงกับโปรเซสที่กำลังสแกนอยู่ (ตัวเอง) → ข้ามเด็ดขาด แม้ค้างนานแค่ไหน ไม่เช็คเวลาเลย', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  const myBootId = getBootId(); // bootId จริงของโปรเซสเทสนี้ (recoverOrphanJobs default ใช้ค่าเดียวกันเมื่อไม่ inject _deps.bootId)
  const job = mkJob({ ownerBootId: myBootId, claimedAt: isoAgo(999999 * 1000) }); // ค้างนานมาก แต่ bootId ตรงตัวเอง
  const deps = mkDeps([job]);
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } }); // ไม่ inject bootId → ใช้ getBootId() จริงเป็นค่า default
  assert.equal(r.scanned, 0, 'bootId ตรงกับตัวเอง = ยังไม่ตายแน่ ต้องข้ามไม่ว่าค้างนานแค่ไหน');
  assert.equal(deps.saved.length, 0);
});

test('(ก) bootId ต่างโปรเซส + heartbeat สดอยู่ (<90วิ) → ไม่กู้ แม้ claimedAt เก่ามาก (มีคนอื่นทำงานอยู่จริง)', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  const job = mkJob({
    ownerBootId: OTHER_DEAD_BOOT_ID,
    claimedAt: isoAgo(999 * 1000), // claimedAt เก่ามาก
    heartbeatAt: isoAgo(10 * 1000), // แต่ heartbeat เพิ่งขยับเมื่อกี้ (10 วิ) — งานยังรันจริงอยู่บนอีกโปรเซส
  });
  const deps = mkDeps([job]);
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } });
  assert.equal(r.scanned, 0, 'heartbeat สด ต้องชนะ claimedAt เก่า — ห้ามกู้');
  assert.equal(deps.saved.length, 0);
});

test('(ข) bootId ต่างโปรเซส + heartbeat เงียบเกิน 90วิ → กู้ได้ (เจ้าของน่าจะตายจริง)', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  const job = mkJob({
    ownerBootId: OTHER_DEAD_BOOT_ID,
    claimedAt: isoAgo(999 * 1000),
    heartbeatAt: isoAgo(120 * 1000), // heartbeat ก็เงียบไป 120 วิ (>90) แล้วเหมือนกัน
  });
  const deps = mkDeps([job]);
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } });
  assert.equal(r.scanned, 1);
  assert.equal(r.recovered, 1);
  assert.equal(deps.store.get(job.id).status, 'pending');
});

test('(ค) legacy (ไม่มี ownerBootId เลย) ค้าง <40 นาที → ไม่กู้ (ไม่รู้เจ้าของ ใช้เกณฑ์ปลอดภัยกว่าเดิม)', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  const job = mkJob({ ownerBootId: undefined, claimedAt: isoAgo(30 * 60 * 1000) }); // ค้าง 30 นาที < 40 นาที
  delete job.ownerBootId;
  const deps = mkDeps([job]);
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } });
  assert.equal(r.scanned, 0, '30 นาที ยังไม่ถึงเกณฑ์ legacy 40 นาที');
});

test('(ค) legacy (ไม่มี ownerBootId เลย) ค้าง >40 นาที → กู้ได้', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  const job = mkJob({ ownerBootId: undefined, claimedAt: isoAgo(45 * 60 * 1000) }); // ค้าง 45 นาที > 40 นาที
  delete job.ownerBootId;
  const deps = mkDeps([job]);
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } });
  assert.equal(r.scanned, 1);
  assert.equal(r.recovered, 1);
  assert.equal(deps.store.get(job.id).status, 'pending');
});

test('_deps.bootId ฉีดแทนได้ (ไม่ต้องพึ่ง getBootId() จริงของโปรเซส) — ใช้ทดสอบ "ตัวเอง" แบบกำหนดเอง', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  const fakeBootId = 'boot_fake_current_process';
  const jobSelf = mkJob({ id: 'self1', ownerBootId: fakeBootId, claimedAt: isoAgo(999999 * 1000) });
  const jobOther = mkJob({ id: 'other1', ownerBootId: OTHER_DEAD_BOOT_ID, claimedAt: isoAgo(200 * 1000) });
  const deps = mkDeps([jobSelf, jobOther]);
  const r = await recoverOrphanJobs({ _deps: { ...deps, bootId: fakeBootId, port: '3900' } });
  assert.equal(r.scanned, 1, 'ต้องนับแค่ other1 (self1 ตรง bootId ที่ฉีดเข้าไปเป็น "ตัวเอง")');
  assert.equal(deps.store.get('self1').status, 'running', 'self1 ต้องไม่ถูกแตะเลย');
  assert.equal(deps.store.get('other1').status, 'pending');
});

// ★ 29 ก.ค. รอบ 3 (คำตัดสิน Opus): กติกาพอร์ตในกรณี 2 — คนละพอร์ต=ข้ามเด็ดขาด / ไม่รู้พอร์ต=เกณฑ์ 40 นาที
test('กรณี 2 ข้ามพอร์ต: งานของพอร์ตอื่น (ownerPort ต่าง) → ข้ามเด็ดขาดแม้ idle นาน (ให้เจ้าของกู้เอง)', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  const job = mkJob({ id: 'xport1', ownerPort: '3000', claimedAt: isoAgo(999999 * 1000) });
  const deps = mkDeps([job]);
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } });
  assert.equal(r.scanned, 0, 'คนละพอร์ตต้องไม่ถูกสแกน/กู้เลย');
  assert.equal(deps.store.get('xport1').status, 'running');
});

test('กรณี 2 ไม่รู้พอร์ต (ฝั่งงานหรือฝั่งสแกนไม่มีพอร์ต) → ใช้เกณฑ์ปลอดภัย 40 นาที ไม่ใช่ 90 วิ', async () => {
  setEnv('MEGA_ORPHAN_RECOVERY', null);
  // งานมี bootId อื่น + idle 5 นาที (เกิน 90 วิ แต่ไม่ถึง 40 นาที) + ไม่มี ownerPort
  const jFresh = mkJob({ id: 'noport1', ownerPort: null, claimedAt: isoAgo(5 * 60 * 1000) });
  // งานแบบเดียวกันแต่ idle 50 นาที (เกิน 40 นาที) → กู้ได้
  const jStale = mkJob({ id: 'noport2', ownerPort: null, claimedAt: isoAgo(50 * 60 * 1000) });
  const deps = mkDeps([jFresh, jStale]);
  const r = await recoverOrphanJobs({ _deps: { ...deps, port: '3900' } });
  assert.equal(deps.store.get('noport1').status, 'running', 'idle 5 นาที ไม่รู้พอร์ต ต้องยังไม่โดนกู้');
  assert.equal(deps.store.get('noport2').status, 'pending', 'idle 50 นาที เกินเกณฑ์ 40 นาที ต้องถูกกู้');
  assert.equal(r.scanned, 1);
});
