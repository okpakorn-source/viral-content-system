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
export async function claimTeamJob() {
  const jobs = await listJobs(200);
  const staleMs = 30 * 60 * 1000;
  const now = Date.now();
  const isFreshRunning = (j) => j.status === 'running' && j.dispatch === 'team'
    && (now - Date.parse(j.claimedAt || j.startedAt || j.createdAt)) <= staleMs;
  // มีงานเครื่องทีมกำลังรันสดอยู่ → ยังไม่หยิบเพิ่ม (รันทีละงาน)
  if (jobs.some(isFreshRunning)) return null;
  const pick = jobs.slice().reverse().find((j) => j.status === 'pending' && j.dispatch === 'team') // เก่าสุดก่อน
    || jobs.find((j) => j.status === 'running' && j.dispatch === 'team'
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
    return claimTeamJob();
  }
  await saveJob(updated);
  return updated;
}

// อัปเดตระหว่างรัน (step/detail/status) — มือถือโพลอ่านไปโชว์
export async function patchJob(id, patch) {
  const job = await getJob(id);
  if (!job) return null;
  const updated = { ...job, ...patch, progress: { ...job.progress, ...(patch.progress || {}) } };
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
