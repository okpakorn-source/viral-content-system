/**
 * Clip Worker (24 มิ.ย. 69) — รันบน "เครื่องทีม (Windows)" เพื่อถอดคลิปที่พนักงานส่งเข้าคิวผ่านเว็บ
 * ─────────────────────────────────────────────────────────────────────────────
 * ทำงาน: วนเช็กคิว 'clip-jobs' (Supabase ที่แชร์กับ Vercel) → ดึงงาน pending →
 *        ถอดผ่าน localhost API (FB/IG ใช้ yt-dlp บนเครื่องนี้ได้) → รายงานผลกลับคิว
 *
 * วิธีใช้: เปิด `npm run dev` ค้างไว้ (เซิร์ฟเวอร์ในเครื่อง) แล้วเปิดอีกหน้าต่าง terminal รัน:
 *        node scripts/clip-worker.mjs
 *   (หรือชี้ไปเซิร์ฟเวอร์อื่นด้วย env CLIP_WORKER_BASE=http://localhost:3000)
 *
 * 🔴 แตะเฉพาะคิวคลิป (clip-jobs) — ไม่เกี่ยวกับระบบทำข่าวอัตโนมัติเลย
 */
try {
  process.loadEnvFile?.('.env.local');
} catch (error) {
  if (error?.code !== 'ENOENT') {
    console.warn('[clip-worker] โหลด .env.local ไม่สำเร็จ:', error.message);
  }
}

const BASE = process.env.CLIP_WORKER_BASE || 'http://localhost:3000';
const IDLE_MS = Number(process.env.CLIP_WORKER_IDLE_MS) || 5000;   // ว่าง → เช็กใหม่ทุก 5 วิ
const ERR_MS = 8000;
const WORKER_PROTOCOL = 'clip-lease-v1';
const WORKER_SECRET = process.env.CLIP_WORKER_SECRET || process.env.DISCORD_API_SECRET || '';
const HEARTBEAT_MS = Number(process.env.CLIP_WORKER_HEARTBEAT_MS) || 60_000;
const REPORT_TIMEOUT_MS = 12_000;
const REPORT_MAX_ATTEMPTS = 3;
const PROCESS_TIMEOUT_MS = 16 * 60 * 1000;

// ★ 26 มิ.ย.: คลิปยาว/FB reel (โหลด+อัป Gemini+ดู) ใช้เวลา >5 นาทีได้ — แต่ fetch ของ Node (undici)
//   ตัดที่ headersTimeout 5 นาทีโดยปริยาย → "fetch failed" ทั้งที่ insight ยังทำอยู่ → เข้าใจผิดว่าล้ม
//   ใช้ Agent ตั้ง timeout ยาว 15 นาที (เท่า maxDuration 800 ของ route + เผื่อ)
let longDispatcher = null;
try {
  const { Agent } = await import('undici');
  longDispatcher = new Agent({ headersTimeout: 900_000, bodyTimeout: 900_000, connectTimeout: 30_000 });
} catch (e) { console.log('[clip-worker] ⚠️ ตั้ง undici Agent ไม่ได้ (ใช้ timeout เริ่มต้น):', e.message); }

const log = (...a) => console.log(`[clip-worker ${new Date().toLocaleTimeString('th-TH')}]`, ...a);

function workerHeaders(contentType = false) {
  if (!WORKER_SECRET) {
    const error = new Error('ยังไม่ได้ตั้ง CLIP_WORKER_SECRET หรือ DISCORD_API_SECRET — หยุด worker เพื่อไม่ให้เปิดคิวโดยไม่มีสิทธิ์');
    error.code = 'CLIP_WORKER_SECRET_MISSING';
    throw error;
  }
  return {
    'X-Clip-Worker-Version': WORKER_PROTOCOL,
    'X-Clip-Worker-Secret': WORKER_SECRET,
    ...(contentType ? { 'Content-Type': 'application/json' } : {}),
  };
}

function httpError(response, data, fallback) {
  const error = new Error(data?.error || `${fallback} (HTTP ${response.status})`);
  error.status = response.status;
  error.code = data?.errorType || '';
  return error;
}

async function pullJob() {
  // ★ 26 มิ.ย.: timeout 12 วิ — poll ต้องเร็ว (<2 วิ) ถ้าค้าง = connection เก่าตาย (server รีสตาร์ท) → ตัดทิ้ง เปิดใหม่
  const r = await fetch(`${BASE}/api/clip-transcript/worker`, {
    method: 'GET',
    headers: workerHeaders(),
    signal: AbortSignal.timeout(12_000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d?.success === false) throw httpError(r, d, 'ดึงคิวไม่สำเร็จ');
  if (d?.job && !d.job.claimToken) throw new Error('เซิร์ฟเวอร์คืนงานโดยไม่มี claimToken — หยุดก่อนเพื่อไม่ให้ถอดซ้ำ');
  return d?.job || null;
}

async function processJob(job, { signal } = {}) {
  // transcript → /api/clip-transcript | insight → /api/clip-transcript/insight
  // ★ 8 ก.ค.: เพิ่ม kind 'hunt' (ถอด+ค้นข่าวคล้าย) + ส่ง user เก็บเป็น metadata คลัง
  const endpoint = job.kind === 'transcript' ? '/api/clip-transcript'
    : job.kind === 'hunt' ? '/api/clip-transcript/hunt'
    : '/api/clip-transcript/insight';
  const body = job.kind === 'transcript' ? { url: job.url, tidy: !!job.tidy }
    : job.kind === 'hunt' ? { url: job.url, user: job.user || '', _fromWorker: true }
    // (★ 14 ส.ค. 69: ถอด smooth ออก · ส่ง model ต่อเมื่อเป็นใบงานเทสสองโมเดล — ใบงานปกติไม่มีฟิลด์นี้)
    // (★ 26 ส.ค. 69: ปุ่ม "ทำใหม่" ติด force มากับใบงาน → ส่งต่อให้ /insight ถอดใหม่ ไม่คืนของเดิมในคลัง)
    : { url: job.url, user: job.user || '', ...(job.force ? { force: true } : {}), ...(job.model ? { model: job.model, force: true } : {}) };
  const r = await fetch(`${BASE}${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
    ...(longDispatcher ? { dispatcher: longDispatcher } : {}), // ★ timeout ยาว — กัน fetch failed ที่ 5 นาที
  });
  let d;
  try {
    d = await r.json();
  } catch (cause) {
    // HTTP response มาถึงแล้วแต่ body ขาด อาจเป็นงานที่ AI ทำเสร็จแล้ว ห้ามตีเป็น transient แล้วเสียเงินซ้ำ
    const error = new Error(`อ่านผลถอดคลิปจาก HTTP ${r.status} ไม่ครบ: ${cause.message}`);
    error.code = 'AMBIGUOUS_RESPONSE_BODY';
    throw error;
  }
  if (!r.ok && d?.success === true) {
    // HTTP บอกว่าล้ม แต่ body บอกว่างานสำเร็จ: อาจจ่าย AI และได้ผลแล้ว ห้ามทิ้งผลแล้ววนถอดใหม่
    const error = new Error(`HTTP ${r.status} ขัดกับผล success:true จึงหยุดไว้เพื่อกันถอดซ้ำ`);
    error.code = 'AMBIGUOUS_RESPONSE_BODY';
    throw error;
  }
  if (r.ok && typeof d?.success !== 'boolean') {
    // 2xx แต่ไม่มีผลสำเร็จ/ล้มเหลวชัดเจน ก็ไม่รู้ว่า AI ถูกคิดเงินไปแล้วหรือไม่
    const error = new Error(`ผลถอดคลิปจาก HTTP ${r.status} ไม่มีสถานะ success ที่ชัดเจน`);
    error.code = 'AMBIGUOUS_RESPONSE_BODY';
    throw error;
  }
  if (r.ok && d?.success) return { ok: true, result: d.data };
  return {
    ok: false,
    error: d?.error || `HTTP ${r.status}`,
    errorType: d?.errorType || '',
    retrySafe: d?.retrySafe === true,
  };
}

// ★ แยก server ตอบว่า "Gemini แน่นชั่วคราว" ออกจาก "ดูคลิปไม่ได้จริง" และ network ambiguity
//   - server ตอบชัดว่า 503/429/แน่น → report 'retry' → เข้า retry_wait แล้วลองใหม่
//   - fetch/timeout ไม่มี response → report 'error' ให้คนตรวจเอง เพราะ server อาจยังทำ AI อยู่
//   - คลิปส่วนตัว/ดูไม่ได้/ลิงก์ไม่รองรับ → report 'error' ทันที (วนใหม่ก็ไม่ช่วย)
//   ต่างจากเดิม: ผู้ใช้เห็นสถานะ "อยู่ในคิว ลองครั้งที่ N" ตลอด — ไม่ใช่ retry เงียบ
function isTransient(error = '', errorType = '') {
  const s = `${error} ${errorType}`.toLowerCase();
  // (ก) ถาวร — กดใหม่ไม่ช่วย → ไม่ retry
  if (/ดูคลิปไม่ได้|ส่วนตัว|private|age.?restrict|จำกัดอายุ|unsupported|ลิงก์ไม่รองรับ|missing_url|cant_watch|กดใหม่ไม่ช่วย|ดูไม่ได้/.test(s)) return false;
  // ★ 27 มิ.ย. (ผู้ใช้สั่ง): ลิงก์เสีย/ไม่พบคอนเทนต์ → ถาวร (เลิก retry วนซ้ำ 80 รอบ) แจ้งชัดว่าลิงก์เสีย
  if (/ไม่พบคอนเทนต์|ไม่พบเนื้อหา|ไม่พบคลิป|ไม่พบวิดีโอ|ไม่มีเนื้อหา|ไม่มีคอนเทนต์|ถูกลบ|โหลดคลิปไม่ได้|ดึงคอนเทนต์ไม่ได้|not\s?found|404|video\s?unavailable|deleted|removed|no\s?content|content\s?not\s?(available|found)|empty\s?(content|video)/.test(s)) return false;
  // (ข) ชั่วคราว — Gemini แน่น/เน็ต/timeout → รอลองใหม่ (ตรวจ "ก่อน" ด่านดาวน์โหลดถาวรด้านล่าง —
  //     'command failed: ... HTTP 503' ต้องนับเป็นชั่วคราวไว้ก่อน ไม่โดนเหมาว่าถาวร)
  if (/503|429|overload|unavailable|high demand|temporar|rate limit|แน่น|ใช้งานหนัก|timeout|timed\s?out|deadline|fetch failed|econn|network|socket|parse|เดี๋ยวก็ผ่าน/.test(s)) return true;
  // ★ Batch B (18 ก.ค.): yt-dlp ดาวน์โหลดล้ม/ไม่มีสตรีมวิดีโอ (โพสต์-รูป/อัลบั้ม/คุกกี้หมด) → ถาวร กดใหม่ไม่ช่วย
  //   เดิมตกเป็น default retry 80 รอบ/~4 ชม. แล้วแจ้ง "Gemini แน่น" ผิดสาเหตุ (เคสจริง 17 ก.ค.: Command failed yt-dlp)
  if (/command failed|โหลดวิดีโอ.*ไม่สำเร็จ|วิดีโอเล็กเกินไป|ไม่มีวิดีโอ|ไม่ใช่(คลิป|วิดีโอ)|no\s?video|not\s?a\s?video|no\s?(playable\s?)?(video\s?)?(format|stream)|requested format|unable to (download|extract)/.test(s)) return false;
  // ไม่ชัด → ถือเป็นชั่วคราว (ผู้ใช้อยากให้ "รอจนได้") · MAX_ATTEMPTS คุมไม่ให้วนฟรีตลอด
  return true;
}

function reportStatusForFailure(error = '', errorType = '', { serverResponded = false } = {}) {
  // ถ้าไม่มี HTTP response เราไม่รู้ว่า AI ฝั่งเซิร์ฟเวอร์ยังทำต่อหรือไม่ จึงห้ามเริ่มรอบใหม่อัตโนมัติ
  if (!serverResponded) return 'error';
  return isTransient(error, errorType) ? 'retry' : 'error';
}

function reportStatusForProcessResult(result) {
  if (result?.ok) return 'done';
  // ห้ามเดาจาก 429/503/timeout ว่า AI ยังไม่เริ่ม เพราะ error อาจเกิดหลังจ่ายค่า inference แล้ว
  // retry ได้เฉพาะ processing endpoint ที่ยืนยันเองว่าเป็น pre-provider failure เท่านั้น
  if (result?.retrySafe === true) {
    return reportStatusForFailure(result?.error, result?.errorType, { serverResponded: true });
  }
  return 'error';
}

async function postWorkerState(id, status, payload, claimToken) {
  const body = status === 'done'
    ? { id, status, claimToken, result: payload }
    : status === 'heartbeat'
      ? { id, status, claimToken }
      : { id, status, claimToken, error: payload };
  const response = await fetch(`${BASE}/api/clip-transcript/worker`, {
    method: 'POST',
    headers: workerHeaders(true),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) throw httpError(response, data, 'รายงานสถานะไม่สำเร็จ');
  return data;
}

async function report(id, status, payload, claimToken, { maxAttempts = REPORT_MAX_ATTEMPTS } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- retry ต้องเรียงลำดับและมีเพดาน
      return await postWorkerState(id, status, payload, claimToken);
    } catch (error) {
      lastError = error;
      if (error.code === 'CLAIM_LOST' || (error.status && error.status < 500 && error.status !== 429)) throw error;
      if (attempt < maxAttempts) {
        // eslint-disable-next-line no-await-in-loop -- backoff แบบ bounded
        await sleep(500 * (2 ** (attempt - 1)));
      }
    }
  }
  throw lastError || new Error('รายงานสถานะไม่สำเร็จ');
}

function startHeartbeat(job, processController) {
  let stopped = false;
  let timer = null;
  let active = Promise.resolve();
  let ownershipError = null;
  let confirmedLeaseMs = new Date(job.leaseExpiresAt || 0).getTime();

  const schedule = () => {
    if (stopped || ownershipError) return;
    timer = setTimeout(() => {
      active = (async () => {
        try {
          const data = await report(job.id, 'heartbeat', null, job.claimToken, { maxAttempts: 1 });
          confirmedLeaseMs = new Date(data.leaseExpiresAt || confirmedLeaseMs).getTime();
        } catch (error) {
          if (error.code === 'CLAIM_LOST') {
            ownershipError = error;
            processController.abort(error);
            return;
          }
          log(`⚠️ heartbeat ${job.id.slice(0, 8)} ล้มชั่วคราว: ${error.message}`);
          if (Number.isFinite(confirmedLeaseMs) && Date.now() >= confirmedLeaseMs - 30_000) {
            ownershipError = new Error('ยืนยัน lease ไม่ได้ก่อนหมดเวลา — หยุดงานเพื่อกันถอดซ้ำ');
            ownershipError.code = 'LEASE_HEARTBEAT_EXPIRED';
            processController.abort(ownershipError);
            return;
          }
        } finally {
          schedule();
        }
      })();
    }, HEARTBEAT_MS);
  };

  schedule();
  return {
    get ownershipError() { return ownershipError; },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await active.catch(() => {});
    },
  };
}

async function loop() {
  if (!WORKER_SECRET) {
    const error = new Error('ยังไม่ได้ตั้ง CLIP_WORKER_SECRET หรือ DISCORD_API_SECRET — ไม่เริ่มดึงคิว');
    error.code = 'CLIP_WORKER_SECRET_MISSING';
    throw error;
  }
  log(`เริ่มทำงาน — เช็กคิวที่ ${BASE}/api/clip-transcript/worker`);
  for (;;) {
    let job = null;
    try { job = await pullJob(); }
    catch (e) { log('⚠️ ต่อเซิร์ฟเวอร์ไม่ได้ (เปิด npm run dev ไว้ไหม?):', e.message); await sleep(ERR_MS); continue; }

    if (!job) { await sleep(IDLE_MS); continue; }

    const tag = job.id.slice(0, 8);
    const tries = (job.attempts || 0) + 1;
    log(`▶️ ทำงาน [${job.platform}/${job.kind}] ครั้งที่ ${tries}: ${String(job.url).slice(0, 55)}`);
    const processController = new AbortController();
    const processTimeout = setTimeout(() => {
      const error = new Error('processJob timeout 16 นาที — ไม่ยืนยันว่า server หยุด AI แล้ว จึงหยุดไว้ไม่ลองซ้ำ');
      error.code = 'PROCESS_TIMEOUT';
      processController.abort(error);
    }, PROCESS_TIMEOUT_MS);
    const heartbeat = startHeartbeat(job, processController);
    let finalStatus = '';
    let finalPayload = null;
    let finalLog = '';
    try {
      const res = await processJob(job, { signal: processController.signal });
      const resultStatus = reportStatusForProcessResult(res);
      if (resultStatus === 'done') {
        finalStatus = 'done';
        finalPayload = res.result;
        finalLog = `✅ เสร็จ: ${tag}`;
      } else if (resultStatus === 'retry') {
        finalStatus = 'retry';
        finalPayload = res.error;
        finalLog = `⏳ สะดุดชั่วคราว → เข้าคิวรอลองใหม่เองใน ~3 นาที (${tag}): ${res.error?.slice(0, 70)}`;
      } else {
        finalStatus = 'error';
        finalPayload = res.error;
        finalLog = `❌ ถอดไม่ได้จริง (กดใหม่ไม่ช่วย) ${tag}: ${res.error?.slice(0, 70)}`;
      }
    } catch (e) {
      if (e.code !== 'CLAIM_LOST') {
        // fetch/timeout ไม่ยืนยันว่าฝั่งเซิร์ฟเวอร์หยุด AI แล้ว จึงห้าม retry อัตโนมัติซ้อนรอบเดิม
        finalStatus = 'error';
        finalPayload = `${e.message} · ระบบหยุดไว้เพื่อกันเสียค่า API ซ้ำ กรุณาตรวจแล้วส่งใหม่ด้วยตนเอง`;
        finalLog = `❌ การเชื่อมต่อไม่ยืนยันผล จึงไม่ลองซ้ำอัตโนมัติ (${tag}): ${e.message?.slice(0, 70)}`;
      }
    } finally {
      clearTimeout(processTimeout);
      await heartbeat.stop();
    }

    if (heartbeat.ownershipError?.code === 'CLAIM_LOST') {
      log(`🛑 หยุด ${tag}: งานถูก worker อื่นรับช่วงแล้ว จึงไม่ส่งผลเก่าทับ`);
      continue;
    }
    if (!finalStatus) continue;

    try {
      await report(job.id, finalStatus, finalPayload, job.claimToken);
      log(finalLog);
    } catch (error) {
      if (error.code === 'CLAIM_LOST') {
        log(`🛑 ไม่ส่งผล ${tag}: lease เปลี่ยนเจ้าของแล้ว`);
      } else {
        // ห้ามเปลี่ยนงานที่ทำสำเร็จเป็น retry เพียงเพราะรายงานสะดุด มิฉะนั้นจะเสียค่า AI ซ้ำทันที
        log(`⚠️ รายงานผล ${tag} ไม่สำเร็จหลังลอง ${REPORT_MAX_ATTEMPTS} ครั้ง: ${error.message} — เมื่อ lease หมดระบบจะหยุดงานนี้ ไม่ถอดใหม่อัตโนมัติ`);
      }
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
loop().catch((e) => { console.error('clip-worker crashed:', e); process.exit(1); });
