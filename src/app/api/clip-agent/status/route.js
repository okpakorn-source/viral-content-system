import { NextResponse } from 'next/server';
import { setTimeout as delay } from 'node:timers/promises';
import { createStore } from '@/lib/persistStore';
import { authorizeClipAgent } from '@/lib/services/clipAgent/auth';
import { compactResult } from '@/lib/services/clipAgent/compactResult';
import { readRowFresh } from '@/lib/services/clipAgent/storeRead';
import { isHeartbeatRow } from '@/app/api/clip-transcript/workerHeartbeat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 800; // เพดาน wait 780 วินาที เผื่ออ่าน store/ส่งผลให้ทันโฮสต์

const TERMINAL = new Set(['done', 'error', 'cancelled']);

function waitMilliseconds(value, capEnv = process.env.CLIP_AGENT_WAIT_CAP_SEC) {
  // env ว่าง ("CLIP_AGENT_WAIT_CAP_SEC=") = ไม่ได้ตั้ง → ใช้ 25 ไม่ใช่ 0 (ไม่งั้น long-poll ปิดเงียบ)
  const configured = capEnv === undefined || String(capEnv).trim() === '' ? 25 : Number(capEnv);
  const cap = Number.isFinite(configured) && configured >= 0 ? Math.min(configured, 780) : 25;
  const requested = Number(value);
  return Number.isFinite(requested) ? Math.max(0, Math.min(requested, cap)) * 1000 : 0;
}

export async function GET(request) {
  try {
    const denied = authorizeClipAgent(request);
    if (denied) return denied;
    const params = new URL(request.url).searchParams;
    const id = params.get('id');
    const notFound = () => NextResponse.json({ ok: false, errorType: 'JOB_NOT_FOUND' }, { status: 404 });
    if (!id) return notFound();
    const store = createStore('clip-jobs');
    const waitMs = waitMilliseconds(params.get('wait'));
    const deadline = Date.now() + waitMs;
    // ปรับรอบเช็คให้สั้นได้สำหรับเทส แต่เครื่องจริงอ่านทุก 2 วินาที
    const pollMs = Math.max(10, Math.min(2000, Number(process.env.CLIP_AGENT_POLL_INTERVAL_MS) || 2000));
    let job = null;
    while (true) {
      // อ่านเฉพาะแถวของงานนี้ (สดทุกครั้ง เพราะ worker เขียนจากอีกโปรเซส) — ไม่ดึงทั้งคิวทุก 2 วิ
      const fresh = await readRowFresh(store, id);
      if (fresh && !isHeartbeatRow(fresh)) job = fresh;
      // อ่านไม่ได้รอบนี้ (store สะดุดชั่วคราว): ถ้าเคยเห็นงานแล้วให้รอต่อจนครบเวลา แล้วตอบสถานะล่าสุดที่เห็น — ไม่ตอบ 404 กลางทาง
      //   (404 กลางทางจะทำให้เอเจนต์เข้าใจว่างานหาย แล้วส่งซ้ำเสียเงิน) · ไม่เคยเห็นเลย = ไม่มีงานนี้จริง
      else if (!job) return notFound();
      if (TERMINAL.has(job.status) || Date.now() >= deadline || request.signal?.aborted) break;
      try {
        await delay(Math.min(pollMs, deadline - Date.now()), undefined, { signal: request.signal });
      } catch (error) {
        if (request.signal?.aborted) break;
        throw error;
      }
    }
    // ลำดับคิวต้องเห็นทั้งคิว — อ่านทั้งตารางครั้งเดียวเฉพาะตอนงานยังรอคิว
    let position = 0;
    if (job.status === 'pending') {
      const all = (await store.getAll()).filter((row) => !isHeartbeatRow(row));
      position = all.filter((row) => row.status === 'processing'
        || (row.status === 'pending' && new Date(row.createdAt) < new Date(job.createdAt))).length + 1;
    }
    // worker คืนผลแบบแบนและไม่มี URL ส่วนใบคลังมี insight ซ้อนอยู่ — รองรับทั้งสองแบบ
    const compactInput = { ...job.result, url: job.result?.url ?? job.url, platform: job.result?.platform ?? job.platform };
    const result = job.status === 'done'
      ? (params.get('full') === '1' ? (job.result ?? null) : compactResult(compactInput, job.kind || 'insight'))
      : null;
    return NextResponse.json({
      ok: true, jobId: job.id, status: job.status, position,
      attempts: job.attempts || 0, statusNote: job.statusNote || '', lastError: job.lastError || '',
      error: job.status === 'error' ? (job.error || '') : '',
      createdAt: job.createdAt || null, startedAt: job.startedAt || null, doneAt: job.doneAt || null,
      nextRetryAt: job.nextRetryAt || null, platform: job.platform || null,
      kind: job.kind || 'insight', user: job.user || '', result,
      timedOut: waitMs > 0 && !TERMINAL.has(job.status) && Date.now() >= deadline,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    // log ฝั่งเซิร์ฟเวอร์เฉพาะข้อความ (ไม่มีกุญแจ) ให้ตามรอย 500 ได้
    console.error('[ClipAgent:status]', error?.message || error);
    return NextResponse.json({ ok: false, errorType: 'STATUS_ERROR', error: 'อ่านสถานะงานคลิปไม่สำเร็จ กรุณาลองใหม่ภายหลัง' }, { status: 500 });
  }
}
