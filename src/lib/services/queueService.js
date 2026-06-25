import { createStore } from '@/lib/persistStore';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { getSupabase, isSupabaseReady } from '@/lib/supabase';

const QUEUE_STORE = 'job_queue';
const DEDUP_WINDOW_MS = 60 * 1000; // ส่งข่าวเดิมซ้ำภายในช่วงนี้ = job เดียวกัน (กันเจนซ้ำข้ามโปรเซส)

// ★ 25 มิ.ย. — job id แบบ deterministic ต่อ (เนื้อหา+ช่วงเวลา) = กุญแจกันซ้ำข้ามโปรเซส
//   in-memory lock กันได้แค่ในโปรเซสเดียว แต่ระบบรันหลายโปรเซส (Railway+Vercel/หลาย lambda)
//   → ส่งซ้ำใน WINDOW เดียวกัน = id เดียวกัน → Postgres PK กันชน insert ซ้ำ atomic ทุกโปรเซส
function _deterministicJobId(input, bucketOffset = 0) {
  const norm = String(input).trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 1000);
  const h = createHash('sha1').update(norm).digest('hex').slice(0, 16);
  const bucket = Math.floor(Date.now() / DEDUP_WINDOW_MS) + bucketOffset;
  return `q_${h}_${bucket}`;
}

// ★ Claim แบบ atomic ผ่าน Supabase conditional update — คืน true=ชนะ, false=แพ้ race, null=error(ให้ caller ถอย)
//   conditional update: set processing เฉพาะแถวที่ยัง pending → Postgres lock ให้ชนะแค่ตัวเดียว
async function _atomicClaimSupabase(job) {
  const sb = getSupabase();
  const startedAt = new Date().toISOString();
  const newData = { ...job, status: 'processing', startedAt, updatedAt: startedAt };
  const { data, error } = await sb
    .from('store_items')
    .update({ data: newData, updated_at: startedAt })
    .eq('id', job.id)
    .eq('store_name', QUEUE_STORE)
    .filter('data->>status', 'eq', 'pending') // ★ คว้าได้เฉพาะที่ยัง pending = atomic
    .select('id');
  if (error) return null;                       // error → caller ถอยใช้ update เดิม (ระบบไม่หยุด)
  return Array.isArray(data) && data.length > 0; // 1 = ชนะ, 0 = อีกโปรเซสคว้าไปแล้ว
}

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

// ★ Watchdog ในตัว (11 มิ.ย.): ลูกโซ่ worker ขาดได้ (trigger ตาย/server restart)
// → เช็คทุก 60s ถ้ามี pending แต่ไม่มีงานวิ่ง ปลุก worker เองโดยไม่ต้องรอใคร poll
// บน serverless interval จะถูก freeze (ไม่ได้ประโยชน์แต่ไม่เสียหาย) — เคสนั้นพึ่ง self-heal ใน status route แทน
if (!globalThis.__queueWatchdog) {
  globalThis.__queueWatchdog = setInterval(async () => {
    try {
      const store = await getQueueStore();
      const all = await store.getAll();
      const pending = all.filter(j => j.status === 'pending').length;
      const processing = all.filter(j => j.status === 'processing').length;
      if (pending > 0 && processing === 0) {
        console.log(`[QueueService] 🚑 Watchdog: ${pending} pending แต่ไม่มี worker วิ่ง — ปลุกเอง`);
        fetch(`http://localhost:${process.env.PORT || 3000}/api/queue/worker`, { method: 'POST' }).catch(() => {});
      }
    } catch { /* เงียบ — รอบหน้าค่อยลองใหม่ */ }
  }, 60_000);
  if (globalThis.__queueWatchdog.unref) globalThis.__queueWatchdog.unref();
}

/**
 * Adds a new job to the queue — ATOMIC with lock to prevent race conditions.
 * Two concurrent calls will be serialized so positions are always unique.
 */
export async function enqueueJob(payload, sourceUserId = 'system') {
  return withEnqueueLock(async () => {
    const store = await getQueueStore();

    const createdAt = new Date().toISOString();
    // ★ 25 มิ.ย. — job id แบบ deterministic (เนื้อหา+ช่วง 60 วิ) = กันเจนซ้ำข้ามโปรเซส
    //   ส่งซ้ำใน WINDOW เดียวกัน = id เดียวกัน → ด่านล่าง + Postgres PK กันชนให้เหลือ job เดียว
    const _dedupInput = payload.input || payload.url || payload.text || '';
    const jobId = _dedupInput ? _deterministicJobId(_dedupInput) : uuidv4();

    // 0. Single getAll() call — then do cleanup in-memory to avoid multiple round-trips
    const allJobs = await store.getAll();
    
    // 0a. Auto-cleanup: reset stale "processing" jobs stuck > 15 minutes (pipeline uses 5-12 min)
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
    for (const j of allJobs) {
      if (j.status === 'processing' && new Date(j.startedAt || j.createdAt) < cutoff) {
        // ★ 12 มิ.ย.: คืนเข้าคิวลองใหม่ 1 ครั้งก่อนตีตาย (สอดคล้อง cleanupStaleJobs)
        if (!j.retriedOnce) {
          await store.update(j.id, (existing) => ({ ...existing, status: 'pending', startedAt: null, retriedOnce: true }));
          j.status = 'pending';
          console.log(`[QueueService] ♻️ งานค้าง ${j.id.slice(0, 8)} คืนเข้าคิวลองใหม่ (enqueue cleanup)`);
        } else {
          await store.update(j.id, (existing) => ({
            ...existing,
            status: 'failed',
            error: `Stale job — stuck >15 min twice, marked failed`,
            completedAt: new Date().toISOString(),
          }));
          j.status = 'failed'; // Update in-memory too
          console.log(`[QueueService] 🧹 งานค้างซ้ำรอบสอง ${j.id.slice(0, 8)} — ตีตาย (enqueue cleanup)`);
        }
      }
    }
    
    // 0b. Auto-purge: remove old completed/failed jobs to prevent Supabase bloat
    //     Keep jobs finished < 5 minutes (so polling can still retrieve results)
    //     Then keep only the newest 10 beyond that
    const purgeMinAge = 30 * 60 * 1000; // 30 minutes — must keep results long enough for bot to poll
    const finishedJobs = allJobs
      .filter(j => j.status === 'completed' || j.status === 'failed' || j.status === 'superseded')
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

    // ★ 17 มิ.ย. (ทีมขอ "ส่งใหม่ต้องเจนใหม่ได้เสมอ ไม่ให้ข่าวเสีย"): ตัวกันงานซ้ำแบบฉลาด — ไม่บล็อกถาวร
    //   • กำลังเจน "จริงๆ" (processing < 5 นาที) → บล็อก (ผลกำลังจะมา ไม่ต้องทำซ้ำให้เปลือง)
    //   • งานเดิมที่ค้าง/รอคิว (pending หรือ processing ค้าง) → "ลบทิ้งแล้วให้ส่งใหม่นี้เจนใหม่" (กันข่าวค้างถาวร)
    //   ★ ไม่แตะ pipeline เจน/worker — แค่ logic การรับงานเข้าคิว
    const inputToCheck = payload.input || payload.url || payload.text;

    // ★ 25 มิ.ย. — ด่านกันซ้ำข้ามโปรเซส (Railway+Vercel/หลาย lambda/หลายบอท ส่งข่าวเดียวพร้อมกัน):
    //   เจอ job id เดียวกัน (ส่งซ้ำใน 60 วิ) หรือ window ก่อนหน้าที่ยังทำงานอยู่ → คืน job เดิม ไม่เจนซ้ำ
    if (_dedupInput) {
      const prevId = _deterministicJobId(_dedupInput, -1);
      const existingDup = allJobs.find(j => j.id === jobId)
        || allJobs.find(j => j.id === prevId && (j.status === 'pending' || j.status === 'processing'));
      if (existingDup) {
        const pend = allJobs.filter(j => j.status === 'pending' || j.status === 'processing')
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        const pos = pend.findIndex(j => j.id === existingDup.id) + 1;
        console.log(`[QueueService] 🛑 ส่งซ้ำใน ${DEDUP_WINDOW_MS / 1000}s — ใช้ job เดิม ${existingDup.id} (กันเจนซ้ำเปลือง token)`);
        return { jobId: existingDup.id, position: pos > 0 ? pos : 0, queuesAhead: pos > 1 ? pos - 1 : 0, status: existingDup.status, duplicate: true };
      }
    }

    if (inputToCheck) {
      const matchInput = (j) => j.payload?.input === inputToCheck || j.payload?.url === inputToCheck || j.payload?.text === inputToCheck;
      const sameNews = allJobs.filter(j => j.id !== jobId && (j.status === 'pending' || j.status === 'processing') && matchInput(j));
      const activeFresh = sameNews.find(j => j.status === 'processing' && new Date(j.startedAt || j.createdAt) >= new Date(Date.now() - 5 * 60 * 1000));
      if (activeFresh) {
        throw new Error("ข่าวนี้กำลังประมวลผลอยู่ ผลลัพธ์กำลังจะมา รออีกสักครู่นะครับ...");
      }
      // งานเดิมที่ค้าง/รอ (ไม่ใช่กำลังเจนจริง) → ชี้ไปงานใหม่นี้ (superseded) แทนการลบทิ้ง
      //   ★ 24 มิ.ย.: เดิมลบทิ้ง (store.remove) → id งานเก่าหาย → บอท/หน้าเว็บที่ poll id เก่าได้ 404
      //   "Job not found" (บอท Discord ตีความ "Request failed..404" เป็นงานล้ม เด้ง error ใส่ผู้ใช้)
      //   → ตอนนี้ mark 'superseded' + supersededBy=jobId ใหม่ → getJobStatus เด้งไปสถานะงานใหม่ให้เนียน
      //   (ยังเจนใหม่เสมอตามที่ทีมขอ — แค่ไม่ทำให้ข้อความเก่ากลายเป็น error)
      if (sameNews.length > 0) {
        for (const stale of sameNews) {
          await store.update(stale.id, (ex) => ({ ...ex, status: 'superseded', supersededBy: jobId })).catch(() => {});
        }
        console.log(`[QueueService] ♻️ ส่งข่าวซ้ำ — ชี้งานเก่า ${sameNews.length} ตัว → งานใหม่ ${jobId.slice(0, 8)} (เจนใหม่)`);
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
    //    ★ 25 มิ.ย. — ถ้าอีกโปรเซสสร้าง id เดียวกันชนะไปก่อน (PK ชน) = ข่าวซ้ำ → ใช้ตัวนั้น ไม่เจนซ้ำ
    try {
      await store.add(job);
    } catch (addErr) {
      if (/duplicate key|_pkey|23505|already exists/i.test(addErr.message || '')) {
        console.log(`[QueueService] 🛑 ชน race insert id ${jobId} — อีกโปรเซสสร้างก่อนแล้ว ใช้ตัวนั้น (กันเจนซ้ำเปลือง token)`);
        return { jobId, position: 1, queuesAhead: 0, status: 'pending', duplicate: true };
      }
      throw addErr;
    }

    console.log(`[QueueService] ✅ Job ${jobId} enqueued at position ${position} (${queuesAhead} ahead)`);

    return { jobId, position, queuesAhead, status: 'pending' };
  });
}

/**
 * Gets a job by ID and its current position in queue if pending.
 */
export async function getJobStatus(jobId) {
  const store = await getQueueStore();
  let job = await store.findById(jobId);
  if (!job) return null;

  // ★ 24 มิ.ย.: งานถูกส่งซ้ำ (superseded) → ตามไปงานใหม่ ให้คนที่ poll id เก่าเห็นสถานะงานใหม่
  //   (กัน "Job not found" เด้งใส่บอท/หน้าเว็บ — เพราะงานใหม่กำลังเจนข่าวเดียวกันให้อยู่)
  let hops = 0;
  while (job && job.status === 'superseded' && job.supersededBy && hops < 5) {
    const next = await store.findById(job.supersededBy);
    if (!next) break;
    job = next;
    hops++;
  }

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

    // ★ แบ่งงานตามเครื่องแบบไม่ทับซ้อน (12 มิ.ย. 69 — คำสั่งทีม: อุดช่องโหว่ ไม่ให้ทำงานทับซ้อน)
    //   งานคลิป (yt-dlp.exe) → เครื่องทีม Windows เท่านั้น (เหมือนเดิม — Vercel รัน exe ไม่ได้)
    //   งานข่าว/อื่นๆ → Vercel เท่านั้น (โค้ด deploy สดเสมอ — ตัดปัญหาเครื่องทีมโค้ดค้าง/hot-reload/เครื่องดับ
    //   ที่เกิดจริง 3 รอบเมื่อ 12 มิ.ย. และตัด race สองเครื่องคว้างานเดียวกันไปในตัว)
    //   ทางหนีไฟ: ตั้ง env QUEUE_LOCAL_NEWS=1 บนเครื่องทีม = ยอมให้เครื่องทีมคว้างานข่าวชั่วคราว (กรณี Vercel ล่ม)
    const isMetaVideoJob = (j) => {
      if (j.payload?.jobType === 'mineclip') return true; // ขุดนาทีทองใช้ yt-dlp — เครื่องทีมเท่านั้น
      const u = String(j.payload?.input || j.payload?.url || '');
      return /facebook\.com\/(reel|watch|share\/[rv]\/|video)|fb\.watch\/|instagram\.com\/(reel|reels|tv)\//i.test(u);
    };
    const isLocalMachine = process.platform === 'win32';
    const localNewsOverride = process.env.QUEUE_LOCAL_NEWS === '1';
    const canRunHere = (j) => {
      if (isMetaVideoJob(j)) return isLocalMachine;                 // คลิป = เครื่องทีมเท่านั้น
      return !isLocalMachine || localNewsOverride;                  // ข่าว/อื่นๆ = Vercel เท่านั้น (เว้นเปิดทางหนีไฟ)
    };

    const pendingJobs = allJobs
      .filter(j => j.status === 'pending' && canRunHere(j))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .slice(0, availableSlots);

    const skipped = allJobs.filter(j => j.status === 'pending' && !canRunHere(j)).length;
    if (skipped > 0) console.log(`[QueueService] ⏭️ ข้าม ${skipped} งานที่เป็นของอีกเครื่อง (คลิป→เครื่องทีม | ข่าว→Vercel)`);
    
    // ★ 25 มิ.ย. — คว้างานแบบ atomic ระดับ DB (กัน worker 2 ตัวข้ามโปรเซสคว้างานเดียวกัน → เจนซ้ำเปลือง token)
    //   เดิม: update mark processing แบบไม่มีเงื่อนไข → 2 โปรเซสคว้าตัวเดียวกันได้
    //   ใหม่: conditional update (pending→processing เฉพาะที่ยัง pending) → Postgres ให้ชนะแค่ตัวเดียว
    //   fail-safe: error/ปิดสวิตช์ (QUEUE_ATOMIC_CLAIM=0) → ถอยใช้ update เดิม (ระบบข่าวต้องไม่หยุดเด็ดขาด)
    const claimed = [];
    const atomicOff = process.env.QUEUE_ATOMIC_CLAIM === '0';
    const startedAt = new Date().toISOString();
    for (const job of pendingJobs) {
      let won = true;
      if (!atomicOff && isSupabaseReady()) {
        won = await _atomicClaimSupabase(job).catch(() => null);
        if (won === null) { // error → ถอยใช้ update เดิม (ไม่ atomic แต่ระบบไม่หยุด)
          await store.update(job.id, (ex) => ({ ...ex, status: 'processing', startedAt })).catch(() => {});
          won = true;
        }
      } else {
        await store.update(job.id, (ex) => ({ ...ex, status: 'processing', startedAt }));
      }
      if (won) claimed.push({ ...job, status: 'processing', startedAt });
    }

    if (claimed.length > 0) {
      console.log(`[QueueService] 🔄 Claimed ${claimed.length} job(s): ${claimed.map(j => j.id.slice(0, 8)).join(', ')}`);
    }

    return claimed;
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
      // ★ 12 มิ.ย.: งานค้าง (เครื่องดับ/deploy คร่อม) ให้ "คืนเข้าคิวลองใหม่ 1 ครั้ง" ก่อน — เดิมตีตายทันที
      //   (12 มิ.ย. ต้องกู้มือ 2 รอบ) ถ้าค้างซ้ำรอบสองค่อยตีตายจริง (กันงานพังวนลูปไม่จบ)
      if (!job.retriedOnce) {
        await store.update(job.id, (existing) => ({
          ...existing,
          status: 'pending',
          startedAt: null,
          retriedOnce: true,
        }));
        cleaned++;
        console.log(`[QueueService] ♻️ งานค้าง ${job.id.slice(0, 8)} คืนเข้าคิวลองใหม่ (ครั้งเดียว)`);
      } else {
        await store.update(job.id, (existing) => ({
          ...existing,
          status: 'failed',
          error: `Stale job — stuck >${maxAgeMinutes} min twice, marked failed`,
          completedAt: new Date().toISOString(),
        }));
        cleaned++;
        console.log(`[QueueService] 🧹 งานค้างซ้ำรอบสอง ${job.id.slice(0, 8)} — ตีตาย`);
      }
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
