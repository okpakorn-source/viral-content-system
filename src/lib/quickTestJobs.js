// ============================================================
// ★ 9 ก.ค. 2026 — คิวงาน "เทสปกเบื้องหลัง" (/quick-cover บนมือถือ)
// ------------------------------------------------------------
// 2 ระบบเทสปก (compose-test เร็ว / cover-ref-test เต็มท่อ) เดิมรัน
// แบบ sync — บนมือถือต้องเปิดจอค้างหลายนาที กดพลาด/สลับแอปคือหลุด
// → หน้าใหม่ยิง /api/quick-test สร้าง job แล้ว "รันเบื้องหลัง" บนเซิร์ฟเวอร์
//   (เครื่องทีมรันยาว) · มือถือโพลสถานะ · ผลปกเก็บคลังคลาวด์ (megaCoverArchive)
// เก็บ Supabase store_items (store 'quick-test-jobs') — fallback ไฟล์ data/quick-test-jobs.json
// เก็บล่าสุด MAX_JOBS งาน (prune กันบวม) · ไม่เก็บ base64 (โหลดภาพจากคลังคลาวด์)
// ============================================================

import { promises as fs } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { resilientFetch } from './supabase.js';

const STORE_NAME = 'quick-test-jobs';
const TABLE = 'store_items';
const FILE = path.join(process.cwd(), 'data', 'quick-test-jobs.json');
const MAX_JOBS = parseInt(process.env.QUICK_TEST_MAX_JOBS || '60', 10);

// ★ 29 ก.ค. 69 (Opus fix — ข้ามพอร์ตกู้งานที่ยังรันจริง): bootId สุ่มครั้งเดียวต่อโปรเซส (globalThis กันหาย
//   ตอน hot-reload dev เรียกโมดูลซ้ำ) — ใช้แยก "งานของโปรเซสตัวเอง" (ยังไม่ตายแน่ เพราะกำลังรันสแกนนี้อยู่)
//   ออกจาก "งานของโปรเซสอื่นที่แชร์ store เดียวกัน" (:3000 vs :3900) — ดู recoverOrphanJobs ด้านล่าง
export function getBootId() {
  if (!globalThis.__QTJ_BOOT_ID) {
    globalThis.__QTJ_BOOT_ID = 'boot_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  }
  return globalThis.__QTJ_BOOT_ID;
}

let _sb = null;
function sb() {
  if (_sb !== null) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  _sb = url && key ? createClient(url, key, { global: { fetch: resilientFetch } }) : false;
  return _sb;
}

async function fsReadAll() {
  try {
    return JSON.parse(await fs.readFile(FILE, 'utf8'));
  } catch {
    return [];
  }
}
async function fsWriteAll(jobs) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(jobs, null, 2), 'utf8');
}

export async function listJobs(limit = MAX_JOBS) {
  const c = sb();
  let jobs;
  if (!c) {
    jobs = await fsReadAll();
  } else {
    const { data, error } = await c.from(TABLE).select('data').eq('store_name', STORE_NAME);
    if (error) throw new Error('อ่านคิวเทสปกไม่สำเร็จ: ' + error.message);
    jobs = (data || []).map((r) => r.data).filter(Boolean);
  }
  jobs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')); // ใหม่สุดก่อน
  return jobs.slice(0, limit);
}

export async function getJob(id) {
  const c = sb();
  if (!c) {
    const jobs = await fsReadAll();
    return jobs.find((j) => j.id === id) || null;
  }
  const { data } = await c.from(TABLE).select('data').eq('store_name', STORE_NAME).eq('id', id).maybeSingle();
  return data?.data || null;
}

async function saveJob(job) {
  const c = sb();
  if (!c) {
    const jobs = await fsReadAll();
    const i = jobs.findIndex((j) => j.id === job.id);
    if (i >= 0) jobs[i] = job;
    else jobs.push(job);
    // prune: เก็บใหม่สุด MAX_JOBS
    jobs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    await fsWriteAll(jobs.slice(0, MAX_JOBS));
    return job;
  }
  const now = new Date().toISOString();
  const { error } = await c
    .from(TABLE)
    .upsert({ id: job.id, store_name: STORE_NAME, data: job, updated_at: now }, { onConflict: 'id' });
  if (error) throw new Error('บันทึกงานเทสปกไม่สำเร็จ: ' + error.message);
  return job;
}

// สร้างงานใหม่ (pending) — kind: 'compose' | 'ref' · dispatch: 'cloud'|'team'|'local'
//   cloud = รันบนคลาว (Vercel) sync · team = คลาวทำไม่ได้ ส่งเครื่องทีม (worker claim) · local = เครื่องทีม fire-and-forget
export async function createJob({ kind, label, input, dispatch = 'local' }) {
  const job = {
    id: 'qtj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    kind,
    dispatch,
    label: label || '',
    input: input || {},
    status: 'pending', // pending → running → done | failed
    progress: { step: dispatch === 'team' ? 'รอเครื่องทีม' : 'เข้าคิว', detail: '', pct: 0 },
    result: null,
    error: null,
    retries: 0,
    createdAt: new Date().toISOString(),
    claimedAt: null,
    startedAt: null,
    finishedAt: null,
  };
  await saveJob(job);
  return job;
}

// ★ worker เครื่องทีม claim งาน dispatch='team' ที่ค้าง (pending) มารัน — ทีละงาน (กันรุมโหลด)
//   งาน running ค้างเกิน 30 นาที = ถือว่าตาย → หยิบมาทำใหม่ (สูงสุด 2 รอบ) เหมือน ytJobStore
// ★ 27 ก.ค. 69 (sol-review วิกฤต 2 — แยกคิวงานโต๊ะข่าวออกจากงานปก): kinds = filter คลาส เช่น
//   ['compose','ref'] (คลาสปก) หรือ ['desk_harvest','desk_search','desk_chief'] (คลาสโต๊ะข่าว)
//   → isFreshRunning เช็คเฉพาะคลาสเดียวกัน + ค้นหา pending เฉพาะคลาสเดียวกัน = งานยาวคลาสหนึ่ง (เช่น desk_harvest
//   9+ นาที) ไม่บล็อกอีกคลาส (compose/ref) รอคิวอยู่ "ทีละงาน" ในช่องของมันเอง
//   ไม่ส่ง kinds (undefined/null ตามค่า default) = พฤติกรรมเดิมเป๊ะ (ไม่กรอง ข้ามคลาสได้เหมือนก่อน) ผู้เรียกเก่าไม่พัง
export async function claimTeamJob(kinds = null) {
  const jobs = await listJobs(200);
  const inClass = (j) => !kinds || kinds.includes(j.kind);
  // ★ 27 ก.ค. 69: ยก 30→40 นาที — desk_harvest mode 'all' เพดานจริงตอนนี้ 30 นาที (harvestTimeoutMs ใน quick-test/route.js)
  //   staleMs เดิม 30 นาทีเท่ากันพอดี เสี่ยง reclaim งานที่ยังรันอยู่จริงกลางทาง (claim ซ้ำ = ยิงซ้ำ/เปลืองโควตา) ต้องมี buffer เผื่อ
  const staleMs = 40 * 60 * 1000;
  const now = Date.now();
  const isFreshRunning = (j) => j.status === 'running' && j.dispatch === 'team' && inClass(j)
    && (now - Date.parse(j.claimedAt || j.startedAt || j.createdAt)) <= staleMs;
  // มีงานเครื่องทีมกำลังรันสดอยู่ (คลาสเดียวกัน) → ยังไม่หยิบเพิ่ม (รันทีละงานต่อคลาส)
  if (jobs.some(isFreshRunning)) return null;
  const pick = jobs.slice().reverse().find((j) => j.status === 'pending' && j.dispatch === 'team' && inClass(j)) // เก่าสุดก่อน
    || jobs.find((j) => j.status === 'running' && j.dispatch === 'team' && inClass(j)
      && (now - Date.parse(j.claimedAt || j.startedAt || j.createdAt)) > staleMs);
  if (!pick) return null;
  const nowIso = new Date().toISOString();
  const updated = {
    ...pick,
    status: 'running',
    claimedAt: nowIso,
    startedAt: pick.startedAt || nowIso,
    retries: pick.status === 'running' ? (pick.retries || 0) + 1 : (pick.retries || 0),
  };
  if (updated.retries > 2) {
    await saveJob({ ...updated, status: 'failed', error: 'งานค้างเกิน 2 รอบ (เครื่องทีมรันไม่จบ)', finishedAt: nowIso });
    return claimTeamJob(kinds); // ★ ต้องส่ง kinds ต่อ ไม่งั้น recurse หลังบังคับ fail จะข้ามคลาสหลุด filter
  }
  await saveJob(updated);
  return updated;
}

// อัปเดตระหว่างรัน (step/detail/status) — มือถือโพลอ่านไปโชว์
// ★ 29 ก.ค. 69 (Opus fix): ทุกครั้งที่ patch = สัญญาณ "เจ้าของยังมีชีวิต" (heartbeat) — ประทับ heartbeatAt
//   เสมอ ไม่ว่า patch จะมีฟิลด์อะไรมาบ้าง (ตั้งไว้หลัง ...patch กันไม่ให้ผู้เรียกเผลอ override ค่าเก่า)
//   recoverOrphanJobs ใช้ค่านี้ตัดสินว่างานข้ามโปรเซสยังรันจริงอยู่ไหม (ดูคอมเมนต์ด้านล่าง)
export async function patchJob(id, patch) {
  const job = await getJob(id);
  if (!job) return null;
  const updated = {
    ...job,
    ...patch,
    progress: { ...job.progress, ...(patch.progress || {}) },
    heartbeatAt: new Date().toISOString(),
  };
  await saveJob(updated);
  return updated;
}

// ★ 9 ก.ค.: ลบงานออกจากคิว (ผู้ใช้กดลบใน UI) — งานที่กำลังรัน runJob จะเช็ค getJob เจอ null แล้วหยุดเอง
export async function removeJob(id) {
  const c = sb();
  if (!c) {
    const jobs = await fsReadAll();
    await fsWriteAll(jobs.filter((j) => j.id !== id));
    return true;
  }
  const { error } = await c.from(TABLE).delete().eq('id', id).eq('store_name', STORE_NAME);
  if (error) throw new Error('ลบงานไม่สำเร็จ: ' + error.message);
  return true;
}

// ปิดงาน — done (มี result) หรือ failed (มี error)
export async function finishJob(id, patch) {
  const job = await getJob(id);
  if (!job) return null;
  const updated = { ...job, ...patch, finishedAt: new Date().toISOString() };
  await saveJob(updated);
  return updated;
}

// ============================================================
// 🩹 recoverOrphanJobs — กู้งานกำพร้าตอนเซิร์ฟเวอร์บูต (29 ก.ค. 69 แบตช์เสถียรภาพ)
// ------------------------------------------------------------
// บริบท: :3900 (เซิร์ฟเวอร์งานหนัก) โดน hard-kill ปริศนา 5 ครั้ง — ยืนยันแล้วว่าเป็น TerminateProcess (ไม่มี
//   signal ให้ดักจับ — instrumentation-node.js ติดตาข่าย unhandledRejection/uncaughtException ไว้แล้ว แต่นั่น
//   ดักได้เฉพาะ "โปรเซสยังอยู่แต่โค้ดพัง" ไม่ใช่ "โปรเซสถูกฆ่าทั้งก้อนจากภายนอก" ซึ่งไม่มีทางดักจากในโค้ดได้เลย)
// ต้นตอ: runJob() (src/app/api/quick-test/route.js) ตั้ง status='running' ตอนเริ่ม แล้ว await callOnce()
//   (fetch ภายในกินเวลาได้ 20 วิ ถึง 25+ นาทีแล้วแต่ kind) — งาน dispatch='local' เป็น fire-and-forget รันครั้ง
//   เดียวตอนสร้างงาน "ไม่มีใครมา poll ซ้ำเลย" (ต่างจาก dispatch='team' ที่มี claimTeamJob ด้านบนคอย stale-reclaim
//   ทุกครั้งที่ worker เครื่องทีม (scripts/acs-yt-worker.mjs) ยิง action:'run' เข้ามาเป็นระยะ) — ถ้าโปรเซสตายกลาง
//   callOnce() ไม่มีโค้ดจุดไหนในระบบวกกลับมาแก้ไข job แถวนั้นอีกเลย → ค้างสถานะ "running" กำพร้าถาวร
// แก้: สแกนตอนบูต (เรียกจาก instrumentation-node.js — จุดเดียวที่ Next.js การันตีรันครั้งเดียวก่อนเซิร์ฟเวอร์
//   พร้อมรับ request) หา running+dispatch='local' ที่ไม่ขยับ (claimedAt/startedAt/createdAt) นาน >90 วิ —
//   เกณฑ์เข้มพอสมควร (ไม่ใช่ 0 วิ) กันชนงานที่เพิ่ง claim ไปเมื่อกี้บนโปรเซสอื่นที่แชร์ store เดียวกันจริงๆ
//   ยังไม่ครบ 6 รอบ → รีเซ็ตเป็น pending + สลับ dispatch เป็น 'team' (ให้ worker เครื่องทีมที่ poll action:'run'
//   อยู่แล้วทุก ~20 วิ หยิบไปรันต่ออัตโนมัติ — ★ ตั้งใจไม่เรียก runJob() ตรงๆ จาก instrumentation.js เพราะ Next.js
//   การันตีว่า register() ต้องจบสมบูรณ์ก่อนเซิร์ฟเวอร์พร้อมรับ request เสมอ — ยิง fetch เข้าตัวเองตอนนั้นเสี่ยง
//   deadlock ตรงๆ (เซิร์ฟเวอร์รอ register() จบ แต่ register() รอเซิร์ฟเวอร์ตอบ fetch)) + retries++ + log
//   ครบ 6 รอบแล้ว → mark failed พร้อมข้อความบอกเหตุชัดเจน (เซิร์ฟเวอร์ดับกลางงาน)
// เฉพาะ dispatch='local' เท่านั้น (dispatch='team' มี claimTeamJob เดิมคอย stale-reclaim อยู่แล้ว — คนละกลไก
//   คนละเกณฑ์เวลา (40 นาที vs 90 วิ) และคนละเพดานรอบ (2 vs 6) — ปล่อยให้กลไกเดิมทำงานของมันเองไปตามปกติ ไม่ปนกัน)
// kill-switch: MEGA_ORPHAN_RECOVERY==='0' → ปิดทั้งชุด ไม่แตะอะไรเลย (default ON)
// ★ testability: รับ _deps.listJobs/_deps.saveJob/_deps.bootId ฉีดแทนของจริงได้ (เทสไม่ต้องแตะ Supabase/ไฟล์จริง)
//
// ★ 29 ก.ค. 69 (Opus fix #2 — ข้ามพอร์ตกู้งานที่ยังรันจริง → ยิงซ้ำ):
//   ปัญหาที่พบ: :3000 กับ :3900 แชร์ store เดียวกัน (Supabase) — งาน dispatch='local' ที่ยังรันจริงอยู่บน :3000
//   (เช่น ref/desk_harvest ตัวเดียวกินเวลา 20-30 นาทีต่อ 1 attempt โดยไม่มี patchJob คั่นระหว่างทางเลย) จะมี
//   claimedAt ค้างนิ่ง >90วิ ได้ทั้งที่ "ไม่ตาย" — ถ้า :3900 บูตขึ้นมากลางทางแล้วสแกนด้วยเกณฑ์ claimedAt ล้วนๆ
//   จะกู้งานนี้ผิด (ยิงซ้ำ ทั้งที่ :3000 ยังทำอยู่จริง)
//   แก้ (ผสมทางเลือก 2+3 ตาม Opus): stamp ownerBootId ตอน runJob ตั้ง running (quick-test/route.js) +
//   heartbeatAt ขยับทุกครั้งที่ patchJob ถูกเรียก (ด้านบน) → แยก 3 กรณี:
//   1) ownerBootId ตรงกับ bootId ของโปรเซสที่กำลังสแกนอยู่ตอนนี้ → ข้ามเด็ดขาด (สแกนนี้รันอยู่ = โปรเซสนี้ยังไม่ตาย
//      แน่นอน ดังนั้นงานที่มี bootId เดียวกันก็ยังไม่ตายตาม — ไม่มีทางเป็น "โปรเซสอื่นตาย" ได้เลย)
//   2) ownerBootId ต่างจากปัจจุบัน (โปรเซสอื่นที่อาจตายไปแล้ว หรืออาจยังมีชีวิตอยู่จริงบนพอร์ตอื่น) → เชื่อ
//      heartbeatAt (fallback claimedAt/startedAt/createdAt ถ้าไม่มี) เทียบเกณฑ์เดิม 90วิ — ถ้ายังอุ่นแปลว่ามี
//      ใครสักคน (อีกโปรเซส) กำลังทำงานอยู่จริง (patchJob ถูกเรียกล่าสุด) ไม่กู้; เย็นเกิน 90วิ = น่าจะตายจริง กู้
//   3) ไม่มี ownerBootId เลย (legacy — สร้างก่อนแพตช์นี้ deploy) → ไม่รู้เจ้าของ ไม่มี heartbeat ให้เชื่อ ใช้เกณฑ์
//      ปลอดภัยกว่าเดิมแทน = เท่ากับ claimTeamJob.staleMs (40 นาที) จาก claimedAt/startedAt/createdAt
//
// ★ 29 ก.ค. 69 คืน — Opus fix #3 (เหตุ :3900 hard-kill 4 ครั้งซ้อน 19:14/19:17/19:31/19:33 คืนเดียวกัน):
//   บั๊กที่พบ: กู้งานสำเร็จ (pending+dispatch:'team') → worker (claimTeamJob) หยิบไปรันต่อ (status:'running' อีก
//   ครั้ง, dispatch ยังเป็น 'team') → ถ้าเซิร์ฟตายซ้ำกลางทาง (ตามที่เกิดจริงคืนนี้ ตายรัวๆ ห่างกันแค่ 2-14 นาที)
//   บรรทัดกรอง "if (j.dispatch !== 'local') continue;" เดิมจะตัดงานนี้ทิ้งจากกลไกนี้ถาวร (เพราะ dispatch ไม่ใช่
//   'local' อีกต่อไปแล้ว) เหลือแค่ claimTeamJob เองที่ต้องรอ 40 นาที + เพดาน 2 รอบ (ออกแบบมาสำหรับงาน team แท้ๆ
//   ที่ยาวนานปกติ ไม่ใช่สำหรับ "ตายซ้ำเร็ว" ระดับนาที) → งานติดค้าง running ถาวรตลอดช่วง incident (เจอจริง 2 ใบ
//   คืนนี้ qtj_...ou236m/qtj_...9gohnv ต้องลบมือทั้งคู่)
//   แก้: ตอนกู้สำเร็จ stamp recoveredAt ไว้ (เครื่องหมาย "เคยผ่านกลไกนี้มาแล้ว") → รอบสแกนถัดไป อนุญาตให้งานที่มี
//   recoveredAt ผ่านด่านกรอง dispatch ต่อได้แม้ dispatch จะเป็น 'team' แล้ว (งาน team แท้ๆ ที่ไม่เคยผ่านกลไกนี้ —
//   ไม่มี recoveredAt — ยังคงถูกตัดเหมือนเดิมทุกกรณี ปล่อยให้ claimTeamJob ดูแลเอง) เกณฑ์เวลา/ownerBootId/heartbeat
//   ทั้งหมดยังคงเดิมทุกอย่าง (ไม่ผ่อนความปลอดภัย) + เพดานรอบเดิม 6 (retries ตัวเดิม ใช้ร่วมกับ claimTeamJob)
// ============================================================
export const ORPHAN_STALE_MS = 90 * 1000;
export const ORPHAN_MAX_ROUNDS = 6;
export const ORPHAN_KINDS = ['compose', 'ref', 'desk_harvest', 'desk_search', 'desk_chief'];
// งาน legacy ไม่มี ownerBootId stamp (สร้างก่อนแพตช์ 29 ก.ค. 69) — ไม่รู้เจ้าของ/ไม่มี heartbeat ใช้เกณฑ์นี้แทน
export const ORPHAN_LEGACY_STALE_MS = 40 * 60 * 1000; // เท่ากับ claimTeamJob.staleMs

export async function recoverOrphanJobs({ env = process.env, _deps = {} } = {}) {
  if (env.MEGA_ORPHAN_RECOVERY === '0') return { scanned: 0, recovered: 0, failed: 0, on: false };
  const _listJobs = _deps.listJobs || listJobs;
  const _saveJob = _deps.saveJob || saveJob;
  const currentBootId = _deps.bootId || getBootId();
  const orphanKindSet = new Set(ORPHAN_KINDS);

  let jobs;
  try {
    jobs = await _listJobs(200);
  } catch (e) {
    console.error('🩹 กู้งานกำพร้า: อ่านคิวไม่สำเร็จ ข้ามรอบนี้ (ไม่กระทบการบูต):', e?.message);
    return { scanned: 0, recovered: 0, failed: 0, on: true, error: e?.message };
  }

  const _now = _deps.now || Date.now; // ★ ตรวจซ้ำ: injectable เพื่อเทส "สแกนซ้ำเป็นรอบ" ข้ามเวลาได้โดยไม่ต้องรอจริง
  const now = _now();
  let scanned = 0, recovered = 0, failedCount = 0;
  for (const j of jobs) {
    if (!j || j.status !== 'running') continue;
    // ★ ตรวจซ้ำ (Opus fix #3): งาน team แท้ๆ (ไม่เคยผ่านกลไกนี้ — ไม่มี recoveredAt) ยังคงถูกตัดเหมือนเดิม
    //   (ปล่อยให้ claimTeamJob ดูแลเอง คนละเกณฑ์เวลา/เพดานรอบ) แต่งานที่เคยกู้ผ่านกลไกนี้มาแล้ว (มี recoveredAt —
    //   ถูก flip local→team ไปตอนกู้ครั้งก่อน) ต้องผ่านด่านนี้ต่อได้ ไม่งั้นถ้ากำพร้าซ้ำ (ตายซ้ำระหว่าง worker รันต่อ)
    //   จะไม่มีใครมองเห็นมันอีกเลย
    if (j.dispatch !== 'local' && !j.recoveredAt) continue;
    if (!orphanKindSet.has(j.kind)) continue;
    // ★ กรณี 1: bootId ตรงกับโปรเซสที่กำลังสแกนอยู่ตอนนี้ — ยังไม่ตายแน่ (ข้ามเด็ดขาด ไม่ต้องเช็คเวลาเลย)
    if (j.ownerBootId && j.ownerBootId === currentBootId) continue;
    let lastTouch, staleMs;
    if (j.ownerBootId) {
      // ★ กรณี 2 (คำตัดสิน Opus 29 ก.ค. รอบ 2): heartbeat ปัจจุบันขยับเฉพาะ start/retry/backoff —
      //   callOnce เป็น await เดี่ยว งาน ref/desk ยาว 8-11 นาทีไม่มี heartbeat ระหว่างทาง เกณฑ์ 90 วิจึงกู้งานมีชีวิตได้
      //   ทางแก้ผสม: (ก) คนละพอร์ต = คนละโปรเซสที่มีวงจรบูต/กู้ของตัวเอง → ข้ามเด็ดขาด ให้เจ้าของกู้เอง
      //   (ข) พอร์ตเดียวกัน + bootId ต่าง = บูตก่อนหน้าของเซิร์ฟเวอร์ตัวเดียวกัน ตายแน่นอน → กู้เร็ว 90 วิ
      //   (ค) ไม่รู้พอร์ตฝั่งใดฝั่งหนึ่ง = ตัดสินไม่ได้ → เกณฑ์ปลอดภัย 40 นาที (เท่ากับ claimTeamJob.staleMs)
      const myPort = _deps.port !== undefined ? _deps.port : (env.PORT || null);
      const samePortKnown = j.ownerPort != null && myPort != null;
      if (samePortKnown && String(j.ownerPort) !== String(myPort)) continue;
      lastTouch = Date.parse(j.heartbeatAt || j.claimedAt || j.startedAt || j.createdAt || '');
      staleMs = samePortKnown ? ORPHAN_STALE_MS : ORPHAN_LEGACY_STALE_MS;
    } else {
      // ★ กรณี 3: legacy ไม่มี stamp เลย — ไม่รู้เจ้าของ ใช้เกณฑ์ปลอดภัยกว่าเดิม (40 นาที)
      lastTouch = Date.parse(j.claimedAt || j.startedAt || j.createdAt || '');
      staleMs = ORPHAN_LEGACY_STALE_MS;
    }
    if (!Number.isFinite(lastTouch)) continue; // timestamp พังรูปแบบ = ข้าม ปลอดภัยไว้ก่อน (fail-safe)
    const idleMs = now - lastTouch;
    if (idleMs <= staleMs) continue; // สดอยู่ — อาจมีโปรเซสอื่นกำลังทำงานจริงอยู่ ห้ามแตะ
    scanned++;
    const nextRetries = (j.retries || 0) + 1;
    try {
      if (nextRetries > ORPHAN_MAX_ROUNDS) {
        await _saveJob({
          ...j,
          status: 'failed',
          retries: nextRetries,
          error: 'เซิร์ฟเวอร์ดับกลางงาน (กู้ครบ 6 รอบแล้วยังไม่จบ — ตรวจ log/รันด้วยมืออีกครั้ง)',
          finishedAt: new Date().toISOString(),
        });
        failedCount++;
        console.log(`🩹 กู้งานกำพร้าล้ม: ${j.id} (${j.kind}) ครบ ${ORPHAN_MAX_ROUNDS} รอบแล้ว → mark failed`);
      } else {
        await _saveJob({
          ...j,
          status: 'pending',
          dispatch: 'team', // ★ ให้ worker เครื่องทีม (poll action:'run' อยู่แล้ว) หยิบไปรันต่ออัตโนมัติ
          retries: nextRetries,
          claimedAt: null,
          // ★ ตรวจซ้ำ (Opus fix #3): เครื่องหมาย "ผ่านกลไกนี้แล้ว" — ให้สแกนรอบถัดไปยังคุ้มครองต่อได้แม้ dispatch
          //   จะเป็น 'team' แล้ว (กันซอมบี้ถาวรถ้ากำพร้าซ้ำระหว่าง worker รันต่อ) ไม่ถูกเขียนทับหายแม้กู้ซ้ำหลายรอบ
          recoveredAt: new Date().toISOString(),
          progress: { ...(j.progress || {}), step: `🩹 กู้งานกำพร้า (รอบ ${nextRetries}/${ORPHAN_MAX_ROUNDS})` },
        });
        recovered++;
        console.log(`🩹 กู้งานกำพร้า ${j.id} (${j.kind}) (รอบ ${nextRetries}/${ORPHAN_MAX_ROUNDS})`);
      }
    } catch (e) {
      console.error(`🩹 กู้งานกำพร้า ${j.id}: เขียนคลังไม่สำเร็จ`, e?.message);
    }
  }
  if (scanned) console.log(`🩹 กู้งานกำพร้า: สแกนเจอ ${scanned} ใบ (running+local ค้าง>90วิ) — กู้คืน ${recovered} · fail ${failedCount}`);
  return { scanned, recovered, failed: failedCount, on: true };
}
