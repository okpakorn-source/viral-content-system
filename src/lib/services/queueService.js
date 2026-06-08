import { createStore } from '@/lib/persistStore';
import { v4 as uuidv4 } from 'uuid';
import { getSupabase, isSupabaseReady } from '@/lib/supabase';

const QUEUE_STORE = 'job_queue';

// === In-memory lock to prevent concurrent enqueue race conditions ===
let _enqueueLock = false;
const _enqueueQueue = [];

async function withEnqueueLock(fn) {
  return new Promise((resolve, reject) => {
    const execute = async () => {
      _enqueueLock = true;
      try {
        const result = await fn();
        resolve(result);
      } catch (err) {
        reject(err);
      } finally {
        _enqueueLock = false;
        // Process next waiting request
        if (_enqueueQueue.length > 0) {
          const next = _enqueueQueue.shift();
          next();
        }
      }
    };

    if (_enqueueLock) {
      _enqueueQueue.push(execute);
    } else {
      execute();
    }
  });
}

/**
 * Helper to get the queue store instance.
 */
async function getQueueStore() {
  const store = createStore(QUEUE_STORE);
  return store;
}

/**
 * Adds a new job to the queue — ATOMIC with lock to prevent race conditions.
 * Two concurrent calls will be serialized so positions are always unique.
 */
export async function enqueueJob(payload, sourceUserId = 'system') {
  return withEnqueueLock(async () => {
    const store = await getQueueStore();
    
    const jobId = uuidv4();
    const createdAt = new Date().toISOString();
    
    // 0. Single getAll() call — then do cleanup in-memory to avoid multiple round-trips
    const allJobs = await store.getAll();
    
    // 0a. Auto-cleanup: reset stale "processing" jobs stuck > 15 minutes (pipeline uses 5-12 min)
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
    for (const j of allJobs) {
      if (j.status === 'processing' && new Date(j.startedAt || j.createdAt) < cutoff) {
        await store.update(j.id, (existing) => ({
          ...existing,
          status: 'failed',
          error: `Stale job — stuck for >15 minutes, auto-reset by enqueue cleanup`,
          completedAt: new Date().toISOString(),
        }));
        j.status = 'failed'; // Update in-memory too
        console.log(`[QueueService] 🧹 Auto-cleaned stale job: ${j.id.slice(0, 8)}`);
      }
    }
    
    // 0b. Auto-purge: remove old completed/failed jobs to prevent Supabase bloat
    //     Keep jobs finished < 5 minutes (so polling can still retrieve results)
    //     Then keep only the newest 10 beyond that
    const purgeMinAge = 30 * 60 * 1000; // 30 minutes — must keep results long enough for bot to poll
    const finishedJobs = allJobs
      .filter(j => j.status === 'completed' || j.status === 'failed')
      .sort((a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt));
    
    if (finishedJobs.length > 10) {
      const toRemove = finishedJobs.slice(10).filter(j => {
        const finishedAt = new Date(j.completedAt || j.createdAt);
        return (Date.now() - finishedAt.getTime()) > purgeMinAge; // ★ Only purge if > 5 min old
      });
      for (const old of toRemove) {
        await store.remove(old.id).catch(() => {});
      }
      if (toRemove.length > 0) {
        console.log(`[QueueService] 🗑️ Purged ${toRemove.length} old finished jobs (kept recent + 10)`);
      }
    }
    
    // 1. Use the already-fetched allJobs (with in-memory status updates) for position calc

    // Duplicate Check: Prevents adding the exact same input if it's already pending/processing
    // NOTE: Ignores 'processing' jobs older than 5 minutes (likely stuck — will be auto-cleaned)
    const inputToCheck = payload.input || payload.url || payload.text;
    if (inputToCheck) {
      const dupeCutoff = new Date(Date.now() - 5 * 60 * 1000);
      const isDuplicate = allJobs.some(j => {
        if (j.status === 'pending') {
          return j.payload.input === inputToCheck || j.payload.url === inputToCheck || j.payload.text === inputToCheck;
        }
        if (j.status === 'processing') {
          // Only count as duplicate if processing started < 5 minutes ago
          const startedAt = new Date(j.startedAt || j.createdAt);
          if (startedAt < dupeCutoff) return false; // Stale — ignore
          return j.payload.input === inputToCheck || j.payload.url === inputToCheck || j.payload.text === inputToCheck;
        }
        return false;
      });
      
      if (isDuplicate) {
        throw new Error("ข่าวนี้กำลังประมวลผลอยู่ หรืออยู่ในคิวแล้ว กรุณารอสักครู่...");
      }
    }

    const pendingJobs = allJobs
      .filter(j => j.status === 'pending' || j.status === 'processing')
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    
    // Position = pending count + 1 (this job will be next)
    const position = pendingJobs.length + 1;
    const queuesAhead = pendingJobs.length;
    
    const job = {
      id: jobId,
      userId: sourceUserId,
      payload,
      status: 'pending',
      position, // Store the assigned position
      result: null,
      error: null,
      createdAt,
      startedAt: null,
      completedAt: null,
    };
    
    // 2. Add to store AFTER calculating position
    await store.add(job);
    
    console.log(`[QueueService] ✅ Job ${jobId} enqueued at position ${position} (${queuesAhead} ahead)`);
    
    return { jobId, position, queuesAhead, status: 'pending' };
  });
}

/**
 * Gets a job by ID and its current position in queue if pending.
 */
export async function getJobStatus(jobId) {
  const store = await getQueueStore();
  const job = await store.findById(jobId);
  if (!job) return null;
  
  if (job.status === 'completed' || job.status === 'failed') {
    return { ...job, position: 0, queuesAhead: 0 };
  }
  
  const allJobs = await store.getAll();
  const pendingJobs = allJobs
    .filter(j => j.status === 'pending' || j.status === 'processing')
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    
  const position = pendingJobs.findIndex(j => j.id === jobId) + 1;
  const queuesAhead = position > 0 ? position - 1 : 0;
  
  return { ...job, position, queuesAhead };
}

/**
 * Updates a job's status — with atomic Supabase update.
 */
export async function updateJobStatus(jobId, status, extraData = {}) {
  const store = await getQueueStore();
  return store.update(jobId, (existing) => {
    return { ...existing, status, ...extraData };
  });
}

/**
 * Atomically claims the next pending job for processing.
 * Uses Supabase RPC or sequential lock to prevent two workers from
 * picking up the same job.
 * 
 * IMPORTANT: limit=1 by default to process ONE at a time (true queue behavior).
 */
export async function getNextPendingJobs(limit = 1) {
  const store = await getQueueStore();
  
  return withEnqueueLock(async () => {
    const allJobs = await store.getAll();
    
    // Count currently processing jobs
    const processingCount = allJobs.filter(j => j.status === 'processing').length;
    
    // Concurrency limit: only 1 job at a time for true queue behavior
    const maxConcurrency = 1;
    if (processingCount >= maxConcurrency) {
      console.log(`[QueueService] ⏸️ Concurrency limit reached (${processingCount}/${maxConcurrency} processing)`);
      return [];
    }
    
    const availableSlots = Math.min(limit, maxConcurrency - processingCount);
    
    const pendingJobs = allJobs
      .filter(j => j.status === 'pending')
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .slice(0, availableSlots);
    
    // Immediately mark as 'processing' inside the lock to prevent double-pick
    for (const job of pendingJobs) {
      await store.update(job.id, (existing) => ({
        ...existing,
        status: 'processing',
        startedAt: new Date().toISOString(),
      }));
    }
    
    if (pendingJobs.length > 0) {
      console.log(`[QueueService] 🔄 Claimed ${pendingJobs.length} job(s): ${pendingJobs.map(j => j.id.slice(0, 8)).join(', ')}`);
    }
    
    return pendingJobs;
  });
}

/**
 * Cleans up stale "processing" jobs that have been stuck for too long.
 * Called periodically to recover from crashes.
 */
export async function cleanupStaleJobs(maxAgeMinutes = 10) {
  const store = await getQueueStore();
  const allJobs = await store.getAll();
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
  
  let cleaned = 0;
  for (const job of allJobs) {
    if (job.status === 'processing' && new Date(job.startedAt || job.createdAt) < cutoff) {
      await store.update(job.id, (existing) => ({
        ...existing,
        status: 'failed',
        error: `Stale job — stuck for >${maxAgeMinutes} minutes, reset by cleanup`,
        completedAt: new Date().toISOString(),
      }));
      cleaned++;
      console.log(`[QueueService] 🧹 Cleaned stale job: ${job.id}`);
    }
  }
  
  return cleaned;
}

/**
 * Get queue overview — how many jobs pending/processing.
 * Used by web UI to check if system is busy.
 */
export async function getQueueOverview() {
  const store = await getQueueStore();
  const allJobs = await store.getAll();
  
  const pending = allJobs.filter(j => j.status === 'pending').length;
  const processing = allJobs.filter(j => j.status === 'processing').length;
  const total = pending + processing;
  
  return {
    pending,
    processing,
    total,
    busy: processing > 0,
    estimatedWaitMinutes: total * 3, // ~3 min per job
  };
}
