import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';
import { getSupabase, isSupabaseReady } from '@/lib/supabase';

/**
 * Clip Worker bridge — ให้เครื่องทีมดึงงานและรายงานผลผ่าน lease เดียวต่อหนึ่งงาน
 * GET  → claim งานแบบ conditional update แล้วคืน claimToken
 * POST → heartbeat/done/error/retry ต้องถือ claimToken ปัจจุบันเท่านั้น
 * คิวนี้แยกเป็น clip-jobs และไม่แตะ job_queue ของระบบข่าว
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STORE_NAME = 'clip-jobs';
const TABLE = 'store_items';
const WORKER_PROTOCOL = 'clip-lease-v1';
const WORKER_PROTOCOL_HEADER = 'x-clip-worker-version';
const WORKER_SECRET_HEADER = 'x-clip-worker-secret';
const LEASE_MS = 20 * 60 * 1000; // ยาวกว่า processJob watchdog 16 นาที

const RETRY_DELAY_MS = 3 * 60 * 1000;
const MAX_ATTEMPTS = 80;

function protocolAccepted(request) {
  return request?.headers?.get?.(WORKER_PROTOCOL_HEADER) === WORKER_PROTOCOL;
}

function secretDigest(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest();
}

function workerAuthorizationResponse(request) {
  const expected = process.env.CLIP_WORKER_SECRET || process.env.DISCORD_API_SECRET || '';
  if (!expected) {
    return NextResponse.json({
      success: false,
      errorType: 'CLIP_WORKER_SECRET_UNAVAILABLE',
      error: 'ยังไม่ได้ตั้ง secret สำหรับ clip worker ระบบจึงหยุดคิวไว้ก่อน',
    }, { status: 503 });
  }

  const provided = request?.headers?.get?.(WORKER_SECRET_HEADER) || '';
  const authorized = provided.length > 0
    && timingSafeEqual(secretDigest(provided), secretDigest(expected));
  if (authorized) return null;

  return NextResponse.json({
    success: false,
    errorType: 'CLIP_WORKER_UNAUTHORIZED',
    error: 'ไม่มีสิทธิ์ใช้งาน clip worker',
  }, { status: 401 });
}

function timestamp(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function claimKind(job, nowMs) {
  if (job?.status === 'pending') return 'pending';
  if (job?.status === 'retry_wait' && timestamp(job.nextRetryAt) <= nowMs) return 'retry';
  if (job?.status !== 'processing') return null;

  if (job.leaseExpiresAt) {
    return timestamp(job.leaseExpiresAt) <= nowMs ? 'expired' : null;
  }

  // งานจาก worker รุ่นเก่าที่ไม่มี lease: รอเต็ม 20 นาที ไม่กู้ที่ 8 นาทีอีกแล้ว
  return timestamp(job.startedAt) <= nowMs - LEASE_MS ? 'legacy-expired' : null;
}

function transitionForClaim(candidate, kind, nowIso) {
  const reclaimed = kind === 'expired' || kind === 'legacy-expired';
  const reclaims = (candidate.reclaims || 0) + (reclaimed ? 1 : 0);

  if (reclaimed) {
    return {
      terminal: true,
      data: {
        ...candidate,
        status: 'error',
        startedAt: null,
        reclaims,
        claimToken: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
        statusNote: '',
        error: 'งานเดิมหมดเวลายืนยันเจ้าของ โดยยังไม่ทราบว่ารอบเดิมจบหรือไม่ ระบบจึงหยุดไว้เพื่อกันเสียค่า API ซ้ำ · ตรวจผลเดิมก่อนแล้วค่อยส่งใหม่',
        doneAt: nowIso,
        updatedAt: nowIso,
      },
    };
  }

  const claimToken = randomUUID();
  return {
    terminal: false,
    data: {
      ...candidate,
      status: 'processing',
      startedAt: nowIso,
      reclaims,
      claimToken,
      claimCount: (candidate.claimCount || 0) + 1,
      leaseExpiresAt: new Date(new Date(nowIso).getTime() + LEASE_MS).toISOString(),
      lastHeartbeatAt: nowIso,
      nextRetryAt: null,
      statusNote: '',
      updatedAt: nowIso,
    },
  };
}

function applyClaimFilters(query, candidate, kind) {
  let filtered = query.filter('data->>status', 'eq', candidate.status);
  if (kind === 'retry') {
    filtered = filtered.filter('data->>nextRetryAt', 'eq', candidate.nextRetryAt);
  } else if (kind === 'expired') {
    filtered = filtered
      .filter('data->>claimToken', 'eq', candidate.claimToken)
      .filter('data->>leaseExpiresAt', 'eq', candidate.leaseExpiresAt);
  } else if (kind === 'legacy-expired') {
    filtered = filtered
      .is('data->>claimToken', null)
      .is('data->>leaseExpiresAt', null)
      .filter('data->>startedAt', 'eq', candidate.startedAt);
  }
  return filtered;
}

async function claimSupabase(candidate, kind, transition, nowIso) {
  const sb = getSupabase();
  let query = sb
    .from(TABLE)
    .update({ data: transition.data, updated_at: nowIso })
    .eq('id', candidate.id)
    .eq('store_name', STORE_NAME);
  query = applyClaimFilters(query, candidate, kind);
  const { data, error } = await query.select('data');
  if (error) throw new Error(`claim งานถอดคลิปแบบ atomic ไม่สำเร็จ: ${error.message}`);
  return Array.isArray(data) && data.length === 1 ? data[0].data : null;
}

async function claimCandidate(candidate, kind, nowIso) {
  const transition = transitionForClaim(candidate, kind, nowIso);
  const updated = await claimSupabase(candidate, kind, transition, nowIso);
  if (!updated) return null;
  return transition.terminal ? { terminal: true } : { terminal: false, job: updated };
}

async function readSupabaseJob(id) {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('data')
    .eq('id', id)
    .eq('store_name', STORE_NAME)
    .single();
  if (error || !data?.data) return null;
  return data.data;
}

async function updateOwnedSupabase(id, claimToken, mutate, { requireActiveLease = false } = {}) {
  const current = await readSupabaseJob(id);
  if (!current || current.status !== 'processing' || current.claimToken !== claimToken) return null;

  const nowIso = new Date().toISOString();
  if (requireActiveLease && timestamp(current.leaseExpiresAt) <= timestamp(nowIso)) return null;

  const updated = { ...mutate(current, nowIso), updatedAt: nowIso };
  let query = getSupabase()
    .from(TABLE)
    .update({ data: updated, updated_at: nowIso })
    .eq('id', id)
    .eq('store_name', STORE_NAME)
    .filter('data->>status', 'eq', 'processing')
    .filter('data->>claimToken', 'eq', claimToken);
  if (requireActiveLease) {
    query = query
      .filter('data->>leaseExpiresAt', 'eq', current.leaseExpiresAt)
      .filter('data->>leaseExpiresAt', 'gt', nowIso);
  }
  const { data, error } = await query.select('data');
  if (error) throw new Error(`บันทึกสถานะงานถอดคลิปไม่สำเร็จ: ${error.message}`);
  return Array.isArray(data) && data.length === 1 ? data[0].data : null;
}

function clearLease(job) {
  return {
    ...job,
    claimToken: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    startedAt: null,
  };
}

function claimLostResponse() {
  return NextResponse.json({
    success: false,
    errorType: 'CLAIM_LOST',
    error: 'สิทธิ์งานนี้หมดอายุหรือถูก worker อื่นรับช่วงแล้ว',
  }, { status: 409 });
}

function primaryUnavailableResponse() {
  return NextResponse.json({
    success: false,
    errorType: 'CLIP_QUEUE_PRIMARY_UNAVAILABLE',
    error: 'ฐานคิวหลักไม่พร้อม ระบบหยุด worker ไว้เพื่อกันหยิบงานซ้ำข้ามเครื่อง',
  }, { status: 503 });
}

export async function GET(request) {
  const authorizationError = workerAuthorizationResponse(request);
  if (authorizationError) return authorizationError;
  if (!protocolAccepted(request)) {
    return NextResponse.json({
      success: false,
      errorType: 'WORKER_UPGRADE_REQUIRED',
      error: 'clip-worker รุ่นเก่าไม่รองรับ lease กรุณารีสตาร์ท worker รุ่นล่าสุด',
    }, { status: 426 });
  }
  if (!isSupabaseReady()) return primaryUnavailableResponse();

  try {
    const store = createStore(STORE_NAME);
    // production ห้าม fallback ไปอ่านไฟล์ cache เก่า เพราะอาจทำให้หยิบงานซ้ำข้ามเครื่อง
    const all = await store.getAll({ authoritative: true });
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const candidates = all
      .map(job => ({ job, kind: claimKind(job, nowMs) }))
      .filter(item => item.kind)
      .sort((a, b) => timestamp(a.job.createdAt) - timestamp(b.job.createdAt));

    for (const candidate of candidates) {
      // conditional update อาจแพ้ worker อีกตัว จึงลองแถวถัดไปโดยไม่เริ่มถอดซ้ำ
      // eslint-disable-next-line no-await-in-loop
      const claim = await claimCandidate(candidate.job, candidate.kind, nowIso);
      if (!claim || claim.terminal) continue;
      const job = claim.job;
      return NextResponse.json({
        success: true,
        job: {
          id: job.id,
          url: job.url,
          kind: job.kind,
          tidy: job.tidy,
          platform: job.platform,
          user: job.user || '',
          model: job.model || '',
          claimToken: job.claimToken,
          leaseExpiresAt: job.leaseExpiresAt,
        },
      });
    }

    return NextResponse.json({ success: true, job: null });
  } catch (error) {
    console.error('[ClipWorker:GET]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  const authorizationError = workerAuthorizationResponse(request);
  if (authorizationError) return authorizationError;
  if (!protocolAccepted(request)) {
    return NextResponse.json({
      success: false,
      errorType: 'WORKER_UPGRADE_REQUIRED',
      error: 'clip-worker รุ่นเก่าไม่รองรับ lease กรุณารีสตาร์ท worker รุ่นล่าสุด',
    }, { status: 426 });
  }
  if (!isSupabaseReady()) return primaryUnavailableResponse();

  try {
    const { id, status, claimToken, result = null, error = '' } = await request.json();
    if (!id || !claimToken || !['heartbeat', 'done', 'error', 'retry'].includes(status)) {
      return NextResponse.json({
        success: false,
        error: 'ต้องระบุ id + claimToken + status (heartbeat|done|error|retry)',
      }, { status: 400 });
    }

    let updated;

    if (status === 'heartbeat') {
      updated = await updateOwnedSupabase(id, claimToken, (current, nowIso) => ({
        ...current,
        leaseExpiresAt: new Date(new Date(nowIso).getTime() + LEASE_MS).toISOString(),
        lastHeartbeatAt: nowIso,
      }), { requireActiveLease: true });
      if (!updated) return claimLostResponse();
      return NextResponse.json({ success: true, leaseExpiresAt: updated.leaseExpiresAt });
    }

    if (status === 'retry') {
      updated = await updateOwnedSupabase(id, claimToken, (current, nowIso) => {
        const attempts = (current.attempts || 0) + 1;
        if (attempts >= MAX_ATTEMPTS) {
          const lastErr = String(current.lastError || error || '').slice(0, 160);
          return {
            ...clearLease(current),
            status: 'error',
            attempts,
            statusNote: '',
            error: `ถอดคลิปไม่สำเร็จหลังลองอัตโนมัติ ${attempts} ครั้ง (~${Math.round(attempts * RETRY_DELAY_MS / 60000)} นาที)${lastErr ? ` — สาเหตุล่าสุด: ${lastErr}` : ' — ลองส่งใหม่ภายหลัง'}`,
            doneAt: nowIso,
          };
        }
        return {
          ...clearLease(current),
          status: 'retry_wait',
          attempts,
          nextRetryAt: new Date(new Date(nowIso).getTime() + RETRY_DELAY_MS).toISOString(),
          statusNote: `⏳ Gemini แน่น — อยู่ในคิว ระบบลองใหม่ให้เองทุก ~3 นาที จน Gemini ว่าง (ลองไปแล้ว ${attempts} ครั้ง) · ปิดหน้าได้ ผลจะเข้าคลังอัตโนมัติ`,
          lastError: String(error).slice(0, 200),
        };
      }, { requireActiveLease: true });
      if (!updated) return claimLostResponse();
      return NextResponse.json({ success: true, retrying: updated.status === 'retry_wait' });
    }

    updated = await updateOwnedSupabase(id, claimToken, (current, nowIso) => ({
      ...clearLease(current),
      status,
      result: status === 'done' ? result : null,
      error: status === 'error' ? String(error).slice(0, 300) : '',
      statusNote: '',
      doneAt: nowIso,
    }));
    if (!updated) return claimLostResponse();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[ClipWorker:POST]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
