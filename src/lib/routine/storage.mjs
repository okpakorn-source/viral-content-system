import { RoutineError } from './errors.mjs';

const TABLE = 'store_items';
const QUEUE = 'job_queue';
const PAGE_SIZE = 1000;
const MAX_ROWS = 10000;
const MAX_PAGES = 100;
const WORKFLOW_PREFIX = /^routine_[a-z0-9-]{1,40}_/;
const ACTIVE = new Set(['pending', 'processing', 'staging', 'recovering', 'queued', 'running']);
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'superseded']);

function unavailable(queue = false) {
  return new RoutineError(503, queue ? 'ROUTINE_QUEUE_UNAVAILABLE' : 'ROUTINE_STORAGE_UNAVAILABLE', 'Routine storage is unavailable; the request could not be verified.');
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function checked(query) {
  try {
    const result = await query;
    if (!result || result.error) throw unavailable();
    return result;
  } catch {
    throw unavailable();
  }
}

function changed(result) {
  if (!Array.isArray(result.data) || result.data.length > 1) throw unavailable();
  return result.data.length === 1;
}

function stored(row) {
  if (!object(row) || !object(row.data)) throw unavailable();
  return row.data;
}

// Call only after the facade switch and key checks. Importing this module alone
// does not initialize the legacy clients, local stores, watchdog, or AI pipeline.
export async function loadStorage() {
  try {
    const { getSupabase, isSupabaseReady } = await import('@/lib/supabase');
    if (!isSupabaseReady()) throw unavailable();
    const sb = getSupabase();
    if (!sb) throw unavailable();
    const { createStore } = await import('@/lib/persistStore');
    return createStorage({ sb, createStore });
  } catch {
    throw unavailable();
  }
}

export function createStorage({ sb, createStore }) {
  if (!sb || typeof sb.from !== 'function' || typeof createStore !== 'function') throw unavailable();

  async function pages(build, ceiling = MAX_ROWS) {
    if (!Number.isSafeInteger(ceiling) || ceiling < 1 || ceiling > MAX_ROWS) throw unavailable();
    const rows = [];
    const seen = new Set();
    let lastId;
    for (let page = 0; page < MAX_PAGES; page++) {
      const size = Math.min(PAGE_SIZE, ceiling + 1 - rows.length);
      let query = build().order('id', { ascending: true });
      if (lastId !== undefined) query = query.gt('id', lastId);
      // eslint-disable-next-line no-await-in-loop -- each page decides whether the bounded read is complete
      const result = await checked(query.range(0, size - 1));
      if (!Array.isArray(result.data) || result.data.length > size) throw unavailable();
      if (result.data.length === 0) return rows;
      for (const row of result.data) {
        if (typeof row?.id !== 'string' || !row.id || seen.has(row.id)) throw unavailable();
        seen.add(row.id);
        rows.push(stored(row));
      }
      if (rows.length > ceiling) throw unavailable();
      lastId = result.data[result.data.length - 1].id;
      // A short page may be a server row cap, not EOF. Continue to an empty
      // page; keyset paging avoids skipped active jobs when old rows are purged.
    }
    throw unavailable();
  }

  async function get(store, id) {
    const result = await checked(sb.from(TABLE).select('data').eq('store_name', store).eq('id', id).maybeSingle());
    return result.data === null ? null : stored(result.data);
  }

  return {
    get,

    async insert(store, id, data) {
      const now = new Date().toISOString();
      let result;
      try {
        const createdAt = data.createdAt === undefined || data.createdAt === null
          ? now : new Date(data.createdAt).toISOString();
        result = await sb.from(TABLE).insert({
          id, store_name: store, data, created_at: createdAt, updated_at: now,
        }).select('id');
      } catch {
        throw unavailable();
      }
      if (result?.error?.code === '23505') return false;
      if (!result || result.error || !changed(result)) throw unavailable();
      return true;
    },

    async cas(store, id, expectedRevision, data) {
      const result = await checked(sb.from(TABLE)
        .update({ data, updated_at: new Date().toISOString() })
        .eq('store_name', store).eq('id', id)
        .eq('data->>revision', expectedRevision).select('id'));
      return changed(result);
    },

    async remove(store, id, revision) {
      let query = sb.from(TABLE).delete().eq('store_name', store).eq('id', id);
      if (revision !== undefined) query = query.eq('data->>revision', revision);
      return changed(await checked(query.select('id')));
    },

    async list(store, { since, routine, limit = MAX_ROWS } = {}) {
      let sinceIso;
      if (since !== undefined) {
        const parsed = new Date(since);
        if (!Number.isFinite(parsed.getTime())) throw unavailable();
        sinceIso = parsed.toISOString();
      }
      return pages(() => {
        let query = sb.from(TABLE).select('id,data').eq('store_name', store);
        if (sinceIso !== undefined) query = query.gte('created_at', sinceIso);
        if (routine !== undefined) query = query.eq('data->>routine', routine);
        return query;
      }, limit);
    },

    async activeQueue() {
      try {
      // Escape SQL LIKE's underscore: only the literal routine_ namespace.
      const jobs = await pages(() => sb.from(TABLE).select('id,data')
        .eq('store_name', QUEUE).filter('data->payload->>workflowId', 'like', 'routine\\_%'));
      const active = [];
      for (const job of jobs) {
        if (!WORKFLOW_PREFIX.test(job.payload?.workflowId || '') || typeof job.id !== 'string') throw unavailable();
        if (ACTIVE.has(job.status)) active.push(job);
        else if (!TERMINAL.has(job.status)) throw unavailable();
      }
      return active;
      } catch { throw unavailable(true); }
    },

    async getJob(jobId) {
      // Ownership is checked by the facade. Do not follow supersededBy into a
      // bot/user job, as the legacy status helper deliberately does.
      try { return await get(QUEUE, jobId); }
      catch { throw unavailable(true); }
    },

    async enqueue(payload, jobId) {
      try {
      if (!object(payload) || !WORKFLOW_PREFIX.test(payload.workflowId || '')
          || Object.hasOwn(payload, 'userId') || typeof jobId !== 'string' || !jobId) throw unavailable();
      const job = {
        id: jobId,
        userId: 'discord-bot',
        payload,
        status: 'pending',
        attemptId: null,
        position: 1,
        result: null,
        error: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      };
      try {
        // The existing persistence service writes precisely the worker's
        // store_items/job_queue format and performs its existing cache sync.
        // Avoid enqueueJob's content dedupe (which ignores workflowId) and its
        // cleanup of unrelated jobs. Routine idempotency owns this supplied id.
        await createStore(QUEUE).add(job);
      } catch {
        // A timeout may have committed: callers must retain the admission/id
        // and reconcile it; never assume an error means the job was not stored.
        throw unavailable();
      }
      const saved = await get(QUEUE, jobId);
      if (!saved || saved.id !== jobId || saved.payload?.workflowId !== payload.workflowId) throw unavailable();
      return saved;
      } catch { throw unavailable(true); }
    },

    async generation(caseId) {
      const result = await checked(sb.from('generation_logs').select('*').eq('case_id', caseId).maybeSingle());
      if (result.data === null) return null;
      if (!object(result.data)) throw unavailable();
      let versions = result.data.versions;
      if (typeof versions === 'string') {
        try { versions = JSON.parse(versions); } catch { throw unavailable(); }
      }
      if (!Array.isArray(versions) || versions.some(version => !object(version))) throw unavailable();
      return { ...result.data, versions };
    },
  };
}
