/* eslint-disable no-await-in-loop -- Stream limits, CAS retries, and ordered result reads must stay sequential. */
import { createHash, randomUUID } from 'node:crypto';
import { RoutineError, errorReply } from './errors.mjs';

const fail = (status, type, message) => { throw new RoutineError(status, type, message); };
const NAME = /^[a-z0-9-]{1,40}$/;
const WORKFLOW = /^routine_([a-z0-9-]{1,40})_[a-f0-9-]{36}$/;
const DAY_MS = 86_400_000;
const LEASE_MS = 900_000;
const PENDING_CLAIM_MS = 20 * 60_000; // Longer than the 700s pipeline deadline and 15m lease.
const GUARD = 'routine_guard_v1';
const hash = value => createHash('sha256').update(value).digest('hex');
export const thaiDay = ms => new Date(ms + 7 * 3_600_000).toISOString().slice(0, 10);

export function config(env) {
  const number = (name, fallback, integer = false, minimum = 0) => {
    const value = env[name] === undefined || env[name] === '' ? fallback : Number(env[name]);
    if (!Number.isFinite(value) || value < minimum || (integer && !Number.isSafeInteger(value))) {
      fail(503, 'ROUTINE_CONFIG_INVALID', `ค่าตั้ง ${name} ไม่ถูกต้อง`);
    }
    return value;
  };
  return {
    dailyUsd: number('ROUTINE_DAILY_USD', 10),
    dailyJobs: number('ROUTINE_DAILY_JOBS', 10, true),
    estimate: number('ROUTINE_EST_USD_PER_JOB', 1, false, 0.000001),
    maxConcurrent: number('ROUTINE_MAX_CONCURRENT', 2, true),
    maxInputChars: number('ROUTINE_MAX_INPUT_CHARS', 20000, true, 20),
  };
}

export async function readInput(request, caps) {
  // Bound encoded JSON as well as decoded input, including chunked requests.
  const maxBytes = caps.maxInputChars * 6 + 8192;
  if (Number(request.headers.get('content-length')) > maxBytes) fail(400, 'ROUTINE_INPUT_TOO_LARGE', 'ข้อมูลยาวเกินเพดาน');
  const reader = request.body?.getReader();
  const chunks = [];
  let length = 0;
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maxBytes) {
          await reader.cancel();
          fail(400, 'ROUTINE_INPUT_TOO_LARGE', 'ข้อมูลยาวเกินเพดาน');
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail(400, 'ROUTINE_INVALID_JSON', 'body ต้องเป็น JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'ROUTINE_INVALID_REQUEST', 'body ต้องเป็น object');
  const allowed = new Set(['input', 'contentLength', 'routine', 'idempotencyKey']);
  if (Object.keys(body).some(key => !allowed.has(key))) fail(400, 'ROUTINE_INVALID_REQUEST', 'มีฟิลด์ที่ไม่รองรับ');
  if (typeof body.input !== 'string' || body.input.trim().length < 20) fail(400, 'ROUTINE_INVALID_INPUT', 'input ต้องมีอย่างน้อย 20 ตัวอักษร');
  if (body.input.length > caps.maxInputChars) fail(400, 'ROUTINE_INPUT_TOO_LARGE', 'input ยาวเกินเพดาน');
  if (typeof body.routine !== 'string' || !NAME.test(body.routine)) fail(400, 'ROUTINE_INVALID_ROUTINE', 'routine ต้องเป็น a-z, 0-9 หรือ - ยาว 1–40 ตัว');
  const contentLength = body.contentLength === undefined ? 'medium' : body.contentLength;
  if (!['short', 'medium', 'long'].includes(contentLength)) fail(400, 'ROUTINE_INVALID_CONTENT_LENGTH', 'contentLength ต้องเป็น short, medium หรือ long');
  const header = request.headers.get('idempotency-key') ?? request.headers.get('idempotencyKey');
  const key = header ?? body.idempotencyKey;
  if ((header !== null && body.idempotencyKey !== undefined && header !== body.idempotencyKey)
      || (key !== undefined && (typeof key !== 'string' || !key.trim() || key.length > 200))) {
    fail(400, 'ROUTINE_INVALID_IDEMPOTENCY_KEY', 'idempotencyKey ต้องยาว 1–200 ตัวและ header/body ต้องตรงกัน');
  }
  return { input: body.input, contentLength, routine: body.routine, idempotencyKey: key };
}

export function actualCost(raw) {
  const data = raw?.data || raw || {};
  const candidates = [raw?.cost, data.cost, raw?.usage, data.usage];
  for (const item of candidates) {
    if (!item || item.estimated === true) continue;
    const value = item.usd ?? item.costUsd ?? item.totalCostUsd;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}

function compactResponse(value) {
  if (Array.isArray(value)) return value.map(compactResponse);
  if (!value || typeof value !== 'object') return value;
  const result = Object.fromEntries(Object.entries(value)
    .filter(([key]) => !key.startsWith('_'))
    .map(([key, child]) => [key, compactResponse(child)]));
  // Mirror auto/process compactDelegatedVersions without importing the route's
  // news dependencies. Preserve even non-enumerable writer provenance.
  if (typeof value.usedModel === 'string') result.usedModel = value.usedModel.trim();
  return result;
}

export function normalizeResult(raw, workflowId, ms, estimate) {
  if (!raw?.success) fail(502, 'ROUTINE_PIPELINE_FAILED', 'ท่อข่าวไม่สำเร็จ');
  const data = raw.data || raw;
  const versions = data.analysisResult?.versions || raw.versions || data.versions;
  if (!Array.isArray(versions) || !versions.length) fail(502, 'ROUTINE_RESULT_UNAVAILABLE', 'ท่อข่าวยังไม่มีฉบับที่อ่านได้');
  const usd = actualCost(raw);
  const caseId = data.generationLog?.caseId || raw.caseId || data.caseId;
  return compactResponse({
    success: true, workflowId, ...(caseId ? { caseId } : {}),
    versions: versions.map((version, index) => ({
      index,
      content: typeof version.content === 'string' ? version.content : '',
      usedModel: version.usedModel ?? null,
      promptName: version.promptName ?? null,
      promptSource: version.promptSource ?? null,
      wordCount: version.wordCount ?? null,
      paragraphs: version.paragraphs ?? null,
    })),
    cost: { usd: usd ?? estimate, estimated: usd === undefined },
    timing: { ms: Math.max(0, ms) },
    pipeline: data,
  });
}

export function createCore({ storage, pipeline, now = Date.now, uuid = randomUUID }) {
  const recordId = workflowId => `routine_record_${workflowId}`;
  const revision = data => ({ ...data, revision: uuid() });
  const getRecord = workflowId => storage.get('routine_meter', recordId(workflowId));
  const storeRecord = async record => {
    const id = recordId(record.workflowId);
    const old = await storage.get('routine_meter', id);
    const next = revision(record);
    const saved = old
      ? await storage.cas('routine_meter', id, old.revision, next)
      : await storage.insert('routine_meter', id, next);
    if (!saved) fail(503, 'ROUTINE_STORAGE_UNAVAILABLE', 'บันทึกผล routine ชนกับคำขออื่น กรุณาอ่านสถานะด้วยรหัสเดิม');
    return next;
  };
  const guard = async () => {
    let current = await storage.get('routine_meter', GUARD);
    if (!current) {
      await storage.insert('routine_meter', GUARD, revision({ kind: 'guard', days: {}, entries: {} }));
      current = await storage.get('routine_meter', GUARD);
    }
    validateGuard(current);
    return current;
  };
  const validateGuard = current => {
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    const valid = Number.isFinite;
    if (!current?.revision || !object(current.days) || !object(current.entries)
        || Object.values(current.days).some(day => !valid(day?.usd) || day.usd < 0 || !Number.isSafeInteger(day.jobs) || day.jobs < 0)
        || Object.entries(current.entries).some(([id, entry]) => !WORKFLOW.test(id) || !entry || !valid(entry.usd) || entry.usd < 0
          || !valid(entry.expiresAt) || !valid(entry.createdAt) || !['reserved', 'queued', 'settled'].includes(entry.state)
          || !/^\d{4}-\d\d-\d\d$/.test(entry.day) || !current.days[entry.day])) {
      fail(503, 'ROUTINE_STORAGE_UNAVAILABLE', 'อ่านมิเตอร์กลางไม่สำเร็จ');
    }
  };
  const inflight = async current => {
    const [queue, leases] = await Promise.all([storage.activeQueue(), storage.list('routine_lease')]);
    const ids = new Set(queue.map(job => job.payload.workflowId));
    for (const lease of leases) {
      if (!WORKFLOW.test(lease.workflowId || '') || !Number.isFinite(lease.expiresAt)) fail(503, 'ROUTINE_STORAGE_UNAVAILABLE', 'อ่าน lease ไม่สำเร็จ');
      if (lease.expiresAt > now()) ids.add(lease.workflowId);
    }
    for (const [id, entry] of Object.entries(current.entries)) {
      if (entry.state === 'reserved' && entry.expiresAt > now()) ids.add(id);
    }
    return ids.size;
  };
  const reserve = async (workflowId, mode, caps) => {
    for (let retry = 0; retry < 12; retry++) {
      const current = await guard(); // Read revision BEFORE queue/lease reads.
      const count = await inflight(current);
      const day = thaiDay(now());
      const today = current.days[day] || { usd: 0, jobs: 0 };
      if (today.jobs >= caps.dailyJobs || today.usd + caps.estimate > caps.dailyUsd + 1e-9) fail(429, 'ROUTINE_DAILY_CAP', 'ถึงเพดานงานหรือค่าใช้จ่ายประมาณการประจำวันแล้ว');
      if (count >= caps.maxConcurrent) fail(429, 'ROUTINE_BUSY', 'จำนวนงาน routine พร้อมกันถึงเพดานแล้ว');
      const entries = { ...current.entries };
      for (const [id, entry] of Object.entries(entries)) {
        if (entry.state === 'settled' && entry.createdAt < now() - 2 * DAY_MS) delete entries[id];
      }
      if (Object.keys(entries).length >= 10000) fail(503, 'ROUTINE_STORAGE_UNAVAILABLE', 'มิเตอร์มีงานรอตรวจสอบมากเกินขอบเขต');
      const entry = { day, mode, usd: caps.estimate, estimated: true, state: 'reserved', createdAt: now(), expiresAt: now() + LEASE_MS };
      const next = revision({ ...current, entries: { ...entries, [workflowId]: entry }, days: { ...current.days, [day]: { usd: today.usd + caps.estimate, jobs: today.jobs + 1 } } });
      if (await storage.cas('routine_meter', GUARD, current.revision, next)) return entry;
    }
    fail(429, 'ROUTINE_BUSY', 'มีคำขอรับงานพร้อมกันมาก กรุณาลองใหม่ด้วยคีย์เดิม');
  };
  const settle = async (workflowId, cost, state = 'settled') => {
    for (let retry = 0; retry < 12; retry++) {
      const current = await guard();
      const previous = current.entries[workflowId];
      if (!previous) return; // Already pruned after its final charge.
      const entry = { ...previous, state };
      const days = { ...current.days };
      if (cost && !cost.estimated) {
        entry.usd = cost.usd;
        entry.estimated = false;
        days[entry.day] = { ...days[entry.day], usd: Math.max(0, days[entry.day].usd + cost.usd - previous.usd) };
      }
      if (await storage.cas('routine_meter', GUARD, current.revision, revision({ ...current, days, entries: { ...current.entries, [workflowId]: entry } }))) return;
    }
    fail(503, 'ROUTINE_STORAGE_UNAVAILABLE', 'ปรับมิเตอร์ไม่สำเร็จ ยังคงยอดสำรองไว้');
  };

  const replay = async idem => {
    if (idem.reply) return compactResponse(idem.reply);
    if (idem.workflowId) {
      const record = await getRecord(idem.workflowId);
      if (record?.reply) return compactResponse(record.reply);
      if (record?.result) {
        if (record.mode === 'jobs' && record.jobId) return { status: 202, body: { success: true, jobId: record.jobId, workflowId: idem.workflowId } };
        return { status: 200, body: compactResponse(record.result) };
      }
      if (record?.jobId) {
        const job = await storage.getJob(record.jobId);
        if (job?.payload?.workflowId === idem.workflowId) return { status: 202, body: { success: true, jobId: record.jobId, workflowId: idem.workflowId } };
      }
    }
    // Missing work can be a request still admitting/enqueuing. Reclaim only
    // after the pending deadline; committed replies/jobs above retain 24h replay.
    if (Number.isFinite(idem.createdAt) && now() - idem.createdAt >= PENDING_CLAIM_MS) return null;
    fail(409, 'ROUTINE_IN_PROGRESS', 'คำขอเดิมกำลังทำงานหรือรอตรวจสอบ ใช้คีย์เดิมอ่านอีกครั้ง ห้ามสร้างคีย์ใหม่เพื่อ retry');
  };
  const claim = async (body, mode, workflowId) => {
    if (body.idempotencyKey === undefined) return null;
    const id = `routine_idem_${hash(body.idempotencyKey)}`;
    const fingerprint = hash(JSON.stringify([mode, body.routine, body.input, body.contentLength]));
    for (let attempt = 0; attempt < 4; attempt++) {
      const previous = await storage.get('routine_idem', id);
      if (previous && previous.expiresAt > now()) {
        if (previous.fingerprint !== fingerprint) fail(409, 'ROUTINE_IDEMPOTENCY_CONFLICT', 'คีย์เดิมถูกใช้กับคำขอที่ต่างกัน');
        const reply = await replay(previous);
        if (reply) return { replay: reply };
      }
      const value = revision({ fingerprint, workflowId, createdAt: now(), expiresAt: now() + DAY_MS });
      const saved = previous
        ? await storage.cas('routine_idem', id, previous.revision, value)
        : await storage.insert('routine_idem', id, value);
      if (saved) return { id, value };
    }
    fail(409, 'ROUTINE_IN_PROGRESS', 'คีย์คำขอนี้กำลังถูกใช้งาน');
  };

  const submit = async (mode, request, caps) => {
    const body = await readInput(request, caps);
    const workflowId = `routine_${body.routine}_${uuid()}`;
    const idem = await claim(body, mode, workflowId);
    if (idem?.replay) return idem.replay;
    let admitted, lease, record, reply;
    let started = now();
    let enqueuing = false;
    try {
      const plan = pipeline.prepare(body, mode);
      admitted = await reserve(workflowId, mode, caps);
      record = await storeRecord({ kind: 'job', workflowId, routine: body.routine, createdAt: new Date(started).toISOString(), day: admitted.day, mode, cost: { usd: caps.estimate, estimated: true }, ...(mode === 'jobs' ? { jobId: uuid() } : {}) });
      if (mode === 'jobs') {
        enqueuing = true;
        await storage.enqueue({ input: body.input, images: [], contentLength: body.contentLength, preset: '', workflowId }, record.jobId);
        reply = { status: 202, body: { success: true, jobId: record.jobId, workflowId } };
        record = await storeRecord({ ...record, reply });
        await settle(workflowId, null, 'queued');
      } else {
        lease = revision({ workflowId, expiresAt: admitted.expiresAt });
        if (!await storage.insert('routine_lease', workflowId, lease)) fail(503, 'ROUTINE_STORAGE_UNAVAILABLE', 'สร้าง lease ไม่สำเร็จ');
        started = now();
        const raw = await pipeline.execute(plan, workflowId);
        const result = normalizeResult(raw, workflowId, now() - started, caps.estimate);
        reply = { status: 200, body: result };
        record = await storeRecord({ ...record, reply, result, caseId: result.caseId, cost: result.cost });
        await settle(workflowId, result.cost);
      }
    } catch (error) {
      if (record?.result) {
        reply = { status: 200, body: { ...record.result, maintenancePending: true } };
      } else reply = errorReply(error);
      // An uncertain enqueue may already be committed. Keep receipt pending so
      // the SAME key recovers its jobId; missing work can retry after 20 minutes.
      if (record && !record.result && !enqueuing) {
        // Read first: a timed-out write can already have committed the result.
        const saved = await getRecord(workflowId);
        if (saved?.result) {
          record = saved;
          reply = { status: 200, body: { ...saved.result, maintenancePending: true } };
        } else await storeRecord({ ...record, reply });
      }
    } finally {
      const cleanup = await Promise.allSettled([
        ...(lease ? [storage.remove('routine_lease', workflowId, lease.revision)] : []),
        ...(admitted && mode === 'news' ? [settle(workflowId, reply?.body?.cost)] : []),
      ]);
      if (cleanup.some(result => result.status === 'rejected') && reply?.body?.success) {
        reply = { ...reply, body: { ...reply.body, maintenancePending: true } };
      }
    }
    if (idem && !enqueuing) {
      if (!admitted) await storage.remove('routine_idem', idem.id, idem.value.revision);
      else if (!await storage.cas('routine_idem', idem.id, idem.value.revision, revision({ ...idem.value, reply }))) fail(503, 'ROUTINE_STORAGE_UNAVAILABLE', 'บันทึก idempotency ไม่สำเร็จ ใช้คีย์เดิมตรวจสอบ');
    }
    return reply;
  };

  const status = async (jobId, caps) => {
    if (typeof jobId !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(jobId)) fail(404, 'ROUTINE_NOT_FOUND', 'ไม่พบงาน routine');
    const job = await storage.getJob(jobId);
    if (!job) {
      const records = await storage.list('routine_meter');
      const saved = records.find(record => record.kind === 'job' && record.jobId === jobId && WORKFLOW.test(record.workflowId || ''));
      if (saved?.result) return { status: 200, body: { success: true, status: 'done', result: compactResponse(saved.result) } };
      fail(404, 'ROUTINE_NOT_FOUND', 'ไม่พบงาน routine หรือคิวถูกล้างก่อนบันทึกผล');
    }
    const workflowId = job?.payload?.workflowId;
    if (!WORKFLOW.test(workflowId || '')) fail(404, 'ROUTINE_NOT_FOUND', 'ไม่พบงาน routine');
    const record = await getRecord(workflowId);
    if (!record || record.jobId !== jobId) fail(404, 'ROUTINE_NOT_FOUND', 'ไม่พบงานที่รับผ่าน Routine API');
    if (job.status === 'completed') {
      let raw = job.result;
      const caseId = raw?.data?.generationLog?.caseId || raw?.generationLog?.caseId || record.caseId;
      if (!raw && caseId) {
        const log = await storage.generation(caseId);
        if (log) raw = { success: true, data: { versions: log.versions, generationLog: { caseId }, pipelineInfo: log.pipeline_info } };
      }
      const ms = Math.max(0, Date.parse(job.completedAt || job.createdAt) - Date.parse(job.startedAt || job.createdAt));
      const result = record.result ? compactResponse(record.result) : normalizeResult(raw, workflowId, ms, record.cost?.usd ?? caps.estimate);
      await storeRecord({ ...record, result, caseId: result.caseId, cost: result.cost });
      await settle(workflowId, result.cost);
      return { status: 200, body: { success: true, status: 'done', result } };
    }
    if (['failed', 'cancelled', 'superseded'].includes(job.status)) {
      await settle(workflowId, null);
      return { status: 200, body: { success: true, status: 'failed', error: 'งานคิวไม่สำเร็จ', errorType: 'ROUTINE_PIPELINE_FAILED' } };
    }
    const state = ({ pending: 'queued', queued: 'queued', staging: 'queued', processing: 'running', running: 'running', recovering: 'running' })[job.status];
    if (!state) fail(503, 'ROUTINE_QUEUE_UNAVAILABLE', 'สถานะคิวไม่อยู่ในสัญญาที่รองรับ');
    return { status: 200, body: { success: true, status: state } };
  };

  return {
    async dispatch(operation, request, params, env) {
      const caps = config(env);
      if (operation === 'news' || operation === 'jobs') return submit(operation, request, caps);
      if (operation === 'health') {
        const current = await storage.get('routine_meter', GUARD) || { days: {}, entries: {} };
        if (current.revision) validateGuard(current);
        return { status: 200, body: { ok: true, enabled: true, keyConfigured: !!env.ROUTINE_API_KEY, caps: { dailyUsd: caps.dailyUsd, dailyJobs: caps.dailyJobs, maxConcurrent: caps.maxConcurrent }, today: { ...(current.days[thaiDay(now())] || { usd: 0, jobs: 0 }), estimated: true, date: thaiDay(now()), timezone: 'Asia/Bangkok' }, estimateUsdPerJob: caps.estimate, costBasis: 'ประมาณการสำรองต่อการรับงาน; ใช้ต้นทุนจริงเมื่อท่อคืนมา', inFlight: await inflight(current) } };
      }
      if (operation === 'job') return status(params.jobId, caps);
      if (operation === 'results') {
        const query = new URL(request.url).searchParams;
        const since = query.get('since');
        const routine = query.get('routine');
        const limit = query.get('limit') === null ? 50 : Number(query.get('limit'));
        if ((since !== null && (!/^\d{4}-\d\d-\d\dT/.test(since) || !Number.isFinite(Date.parse(since)))) || (routine !== null && !NAME.test(routine)) || !Number.isInteger(limit) || limit < 1 || limit > 50) fail(400, 'ROUTINE_INVALID_QUERY', 'since ต้องเป็น ISO; limit 1–50; routine ต้องเป็นชื่อที่ถูกต้อง');
        const records = await storage.list('routine_meter', { ...(since ? { since: new Date(since).toISOString() } : {}), ...(routine ? { routine } : {}) });
        const owned = records.filter(record => record.kind === 'job' && WORKFLOW.test(record.workflowId || '')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const items = [];
        for (const record of owned) {
          let result = record.result;
          if (!result && record.jobId) {
            try { result = (await status(record.jobId, caps)).body.result; }
            catch (error) { if (!(error instanceof RoutineError) || error.status !== 404) throw error; }
          }
          if (!result) continue;
          items.push({ ...(result.caseId ? { caseId: result.caseId } : {}), workflowId: record.workflowId, routine: record.routine, createdAt: record.createdAt, versions: compactResponse(result.versions) });
          if (items.length === limit) break;
        }
        return { status: 200, body: { success: true, items } };
      }
      fail(404, 'ROUTINE_NOT_FOUND', 'ไม่พบ endpoint นี้');
    },
  };
}
