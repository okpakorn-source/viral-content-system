// ============================================================
// 🏭 MEGA Workflow — คลังแฟ้มงานข่าว (Story Dossier) + บัญชีรายขั้น
// ------------------------------------------------------------
// ระบบแยกใหม่ทั้งก้อน (ผู้ใช้สั่ง 6-7 ก.ค. 2026) — ไฟล์ใหม่ล้วน ไม่แตะระบบข่าว
// - 'mega-jobs' : แฟ้มงานต่อข่าว 1 ชิ้น (MG-0001…) เก็บ "สรุปล่าสุด" ทุกสถานี
// - 'mega-runs' : บัญชีการรันรายขั้น (attempt/idempotency/cost/error) — audit ได้
// - 'mega-flags': ธงระบบ (circuit breaker / pause)
// pattern เดียวกับ ytJobStore/imageStore: Supabase store_items + fs fallback
// ============================================================

import { promises as fs } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { resilientFetch } from '@/lib/supabase';

const TABLE = 'store_items';
const JOBS = 'mega-jobs';
const RUNS = 'mega-runs';
const FLAGS = 'mega-flags';
const DIR = path.join(process.cwd(), 'data', 'mega');

let _sb = null;
function sb() {
  if (_sb !== null) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  _sb = url && key ? createClient(url, key, { global: { fetch: resilientFetch } }) : false;
  return _sb;
}

// ---------- fs fallback (เทสในเครื่องไม่มี Supabase) ----------
async function fsRead(store) {
  try {
    return JSON.parse(await fs.readFile(path.join(DIR, store + '.json'), 'utf8'));
  } catch {
    return [];
  }
}
async function fsWrite(store, rows) {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, store + '.json'), JSON.stringify(rows, null, 2), 'utf8');
}

async function readAll(store) {
  const c = sb();
  if (!c) return fsRead(store);
  const { data, error } = await c.from(TABLE).select('data').eq('store_name', store);
  if (error) throw new Error(`อ่าน ${store} ไม่สำเร็จ: ` + error.message);
  return (data || []).map((r) => r.data).filter(Boolean);
}

async function upsertRow(store, row) {
  const c = sb();
  if (!c) {
    const rows = await fsRead(store);
    const i = rows.findIndex((r) => r.id === row.id);
    if (i >= 0) rows[i] = row;
    else rows.push(row);
    await fsWrite(store, rows);
    return row;
  }
  const now = new Date().toISOString();
  const { error } = await c
    .from(TABLE)
    .upsert({ id: row.id, store_name: store, data: row, updated_at: now }, { onConflict: 'id' });
  if (error) throw new Error(`บันทึก ${store} ไม่สำเร็จ: ` + error.message);
  return row;
}

// ---------- แฟ้มงาน (dossier) ----------
export async function newJob({ mode = 'auto' } = {}) {
  const all = await readAll(JOBS);
  let max = 0;
  for (const j of all) {
    const m = /^MG-(\d+)$/.exec(j.id || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const job = {
    id: `MG-${String(max + 1).padStart(4, '0')}`,
    status: 'pending', // pending|running|waiting|content_ready|done|failed|skipped|paused
    stage: 's1_pick',
    mode, // auto | checkpoint
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    quality: 'green', // green|yellow|red
    costTotal: 0,
    dossier: { s1Attempts: 0, triedCardIds: [] },
    stagesDone: [],
  };
  await upsertRow(JOBS, job);
  return job;
}

export async function getJob(id) {
  const all = await readAll(JOBS);
  return all.find((j) => j.id === id) || null;
}

export async function listJobs(limit = 30) {
  const all = await readAll(JOBS);
  all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return all.slice(0, limit);
}

// อัปเดตแฟ้ม (merge ชั้นเดียว + merge dossier ชั้นสอง)
export async function updateJob(id, patch) {
  const job = await getJob(id);
  if (!job) return null;
  const merged = {
    ...job,
    ...patch,
    dossier: { ...(job.dossier || {}), ...(patch.dossier || {}) },
    updatedAt: new Date().toISOString(),
  };
  await upsertRow(JOBS, merged);
  return merged;
}

// ---------- บัญชีรายขั้น (ledger) ----------
export async function addRun(jobId, stage, data) {
  const run = {
    id: `run_${jobId}_${stage}_${Date.now().toString(36)}`,
    jobId,
    stage,
    at: new Date().toISOString(),
    ...data, // { status, attempt, idempotencyKey, inputHash, summary, costActual, error }
  };
  await upsertRow(RUNS, run);
  return run;
}

export async function listRuns(jobId) {
  const all = await readAll(RUNS);
  return all.filter((r) => r.jobId === jobId).sort((a, b) => (a.at || '').localeCompare(b.at || ''));
}

// เคยรันขั้นนี้ด้วย input เดิมสำเร็จแล้วหรือยัง (idempotency — กันจ่ายซ้ำ)
export async function findDoneRun(jobId, stage, idempotencyKey) {
  const runs = await listRuns(jobId);
  return runs.find((r) => r.stage === stage && r.idempotencyKey === idempotencyKey && r.status === 'done') || null;
}

// ---------- ธงระบบ (circuit breaker) ----------
export async function getFlags() {
  const all = await readAll(FLAGS);
  return all.find((f) => f.id === 'mega-flags') || { id: 'mega-flags', paused: false, consecutiveFails: 0 };
}

export async function setFlags(patch) {
  const cur = await getFlags();
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  await upsertRow(FLAGS, next);
  return next;
}
