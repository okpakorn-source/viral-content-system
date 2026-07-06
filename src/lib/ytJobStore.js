// ============================================================
// ★ DEVIATION จากระบบทำปกออโต้ (ผู้ใช้สั่ง 6 ก.ค. 2026)
// คิวงานแคปเฟรม YouTube "เว็บ → เครื่องทีม" (/image-search)
// ------------------------------------------------------------
// เว็บ (Vercel) แคปเฟรมเองไม่ได้ (ไม่มี yt-dlp/ffmpeg/ดิสก์เขียนได้)
// → /api/images/youtube บนเว็บฝากงานไว้ที่นี่แทนการตอบ error
// → worker บนเครื่องทีม (scripts/acs-yt-worker.mjs) วนหยิบไปรันแล้ว
//   ส่งรูป (โฮสต์สาธารณะแล้ว) เข้าคลังเคส — เว็บเห็นรูปเอง
// เก็บ Supabase store_items (store 'acs-yt-jobs' แถวละงาน)
// ไม่มี Supabase → fallback ไฟล์ data/acs-yt-jobs.json (เทสในเครื่อง)
// ============================================================

import { promises as fs } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const STORE_NAME = 'acs-yt-jobs';
const TABLE = 'store_items';
const FILE = path.join(process.cwd(), 'data', 'acs-yt-jobs.json');

let _sb = null;
function sb() {
  if (_sb !== null) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  _sb = url && key ? createClient(url, key) : false;
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

export async function listJobs(status = null) {
  const c = sb();
  let jobs;
  if (!c) {
    jobs = await fsReadAll();
  } else {
    const { data, error } = await c.from(TABLE).select('data').eq('store_name', STORE_NAME);
    if (error) throw new Error('อ่านคิวงาน YouTube ไม่สำเร็จ: ' + error.message);
    jobs = (data || []).map((r) => r.data).filter(Boolean);
  }
  jobs.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  return status ? jobs.filter((j) => j.status === status) : jobs;
}

async function saveJob(job) {
  const c = sb();
  if (!c) {
    const jobs = await fsReadAll();
    const i = jobs.findIndex((j) => j.id === job.id);
    if (i >= 0) jobs[i] = job;
    else jobs.push(job);
    await fsWriteAll(jobs);
    return job;
  }
  const now = new Date().toISOString();
  const { error } = await c
    .from(TABLE)
    .upsert({ id: job.id, store_name: STORE_NAME, data: job, updated_at: now }, { onConflict: 'id' });
  if (error) throw new Error('บันทึกงาน YouTube ไม่สำเร็จ: ' + error.message);
  return job;
}

// ฝากงานใหม่ — เคสเดียวกันมีงานค้าง (pending/running) อยู่แล้ว = ไม่สร้างซ้ำ
export async function enqueueJob(caseId) {
  const all = await listJobs();
  const existing = all.find((j) => j.caseId === caseId && (j.status === 'pending' || j.status === 'running'));
  if (existing) return { job: existing, existing: true };
  const job = {
    id: 'ytj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    caseId,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  await saveJob(job);
  return { job, existing: false };
}

// worker หยิบงานเก่าสุดที่ pending (ตัวหยิบมีตัวเดียว = ไม่ต้อง atomic)
export async function claimJob() {
  const pending = await listJobs('pending');
  if (!pending.length) return null;
  const job = { ...pending[0], status: 'running', claimedAt: new Date().toISOString() };
  await saveJob(job);
  return job;
}

// worker รายงานผล — done/failed + ข้อมูลแนบ (added/error)
export async function finishJob(id, patch) {
  const all = await listJobs();
  const job = all.find((j) => j.id === id);
  if (!job) return null;
  const updated = { ...job, ...patch, finishedAt: new Date().toISOString() };
  await saveJob(updated);
  return updated;
}
