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
const BASE = process.env.CLIP_WORKER_BASE || 'http://localhost:3000';
const IDLE_MS = Number(process.env.CLIP_WORKER_IDLE_MS) || 5000;   // ว่าง → เช็กใหม่ทุก 5 วิ
const ERR_MS = 8000;

// ★ 26 มิ.ย.: คลิปยาว/FB reel (โหลด+อัป Gemini+ดู) ใช้เวลา >5 นาทีได้ — แต่ fetch ของ Node (undici)
//   ตัดที่ headersTimeout 5 นาทีโดยปริยาย → "fetch failed" ทั้งที่ insight ยังทำอยู่ → เข้าใจผิดว่าล้ม
//   ใช้ Agent ตั้ง timeout ยาว 15 นาที (เท่า maxDuration 800 ของ route + เผื่อ)
let longDispatcher = null;
try {
  const { Agent } = await import('undici');
  longDispatcher = new Agent({ headersTimeout: 900_000, bodyTimeout: 900_000, connectTimeout: 30_000 });
} catch (e) { console.log('[clip-worker] ⚠️ ตั้ง undici Agent ไม่ได้ (ใช้ timeout เริ่มต้น):', e.message); }

const log = (...a) => console.log(`[clip-worker ${new Date().toLocaleTimeString('th-TH')}]`, ...a);

async function pullJob() {
  // ★ 26 มิ.ย.: timeout 12 วิ — poll ต้องเร็ว (<2 วิ) ถ้าค้าง = connection เก่าตาย (server รีสตาร์ท) → ตัดทิ้ง เปิดใหม่
  const r = await fetch(`${BASE}/api/clip-transcript/worker`, { method: 'GET', signal: AbortSignal.timeout(12000) });
  const d = await r.json().catch(() => ({}));
  return d?.job || null;
}

async function processJob(job) {
  // transcript → /api/clip-transcript | insight → /api/clip-transcript/insight
  const endpoint = job.kind === 'transcript' ? '/api/clip-transcript' : '/api/clip-transcript/insight';
  const body = job.kind === 'transcript' ? { url: job.url, tidy: !!job.tidy } : { url: job.url };
  const r = await fetch(`${BASE}${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    ...(longDispatcher ? { dispatcher: longDispatcher } : {}), // ★ timeout ยาว — กัน fetch failed ที่ 5 นาที
  });
  const d = await r.json().catch(() => ({}));
  if (d?.success) return { ok: true, result: d.data };
  return { ok: false, error: d?.error || `HTTP ${r.status}`, errorType: d?.errorType || '' };
}

// ★ 26 มิ.ย. (เปิด auto-retry แบบ "เห็นชัด"): แยก "Gemini แน่นชั่วคราว" (รอลองใหม่เอง) ออกจาก "ดูคลิปไม่ได้จริง" (error เลย)
//   - แน่น/503/timeout/เน็ตสะดุด → report 'retry' → เข้า retry_wait → worker หยิบทำใหม่เองทุก ~3 นาที จน Gemini ว่าง
//   - คลิปส่วนตัว/ดูไม่ได้/ลิงก์ไม่รองรับ → report 'error' ทันที (วนใหม่ก็ไม่ช่วย)
//   ต่างจากเดิม: ผู้ใช้เห็นสถานะ "อยู่ในคิว ลองครั้งที่ N" ตลอด — ไม่ใช่ retry เงียบ
function isTransient(error = '', errorType = '') {
  const s = `${error} ${errorType}`.toLowerCase();
  // (ก) ถาวร — กดใหม่ไม่ช่วย → ไม่ retry
  if (/ดูคลิปไม่ได้|ส่วนตัว|private|age.?restrict|จำกัดอายุ|unsupported|ลิงก์ไม่รองรับ|missing_url|cant_watch|กดใหม่ไม่ช่วย|ดูไม่ได้/.test(s)) return false;
  // (ข) ชั่วคราว — Gemini แน่น/เน็ต/timeout → รอลองใหม่
  if (/503|429|overload|unavailable|high demand|temporar|rate limit|แน่น|ใช้งานหนัก|timeout|deadline|fetch failed|econn|network|socket|parse|เดี๋ยวก็ผ่าน/.test(s)) return true;
  // ไม่ชัด → ถือเป็นชั่วคราว (ผู้ใช้อยากให้ "รอจนได้") · MAX_ATTEMPTS คุมไม่ให้วนฟรีตลอด
  return true;
}

async function report(id, status, payload) { // status: 'done' | 'error' | 'retry'
  const body = status === 'done' ? { id, status, result: payload } : { id, status, error: payload };
  await fetch(`${BASE}/api/clip-transcript/worker`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch((e) => log('report ล้ม:', e.message));
}

async function loop() {
  log(`เริ่มทำงาน — เช็กคิวที่ ${BASE}/api/clip-transcript/worker`);
  for (;;) {
    let job = null;
    try { job = await pullJob(); }
    catch (e) { log('⚠️ ต่อเซิร์ฟเวอร์ไม่ได้ (เปิด npm run dev ไว้ไหม?):', e.message); await sleep(ERR_MS); continue; }

    if (!job) { await sleep(IDLE_MS); continue; }

    const tag = job.id.slice(0, 8);
    const tries = (job.attempts || 0) + 1;
    log(`▶️ ทำงาน [${job.platform}/${job.kind}] ครั้งที่ ${tries}: ${String(job.url).slice(0, 55)}`);
    try {
      // ★ 26 มิ.ย.: กัน worker ค้าง — ถ้า processJob ค้างเกิน 16 นาที (เช่น server รีสตาร์ท → fetch ค้าง) → ข้ามไปลองใหม่ ไม่บล็อกคิว
      const res = await Promise.race([
        processJob(job),
        new Promise((_, rej) => setTimeout(() => rej(new Error('processJob timeout 16 นาที — server อาจรีสตาร์ท ข้ามไปลองใหม่')), 16 * 60 * 1000)),
      ]);
      if (res.ok) { await report(job.id, 'done', res.result); log(`✅ เสร็จ: ${tag}`); }
      else if (isTransient(res.error, res.errorType)) { await report(job.id, 'retry', res.error); log(`⏳ Gemini แน่น → เข้าคิวรอลองใหม่เองใน ~3 นาที (${tag}): ${res.error?.slice(0, 70)}`); }
      else { await report(job.id, 'error', res.error); log(`❌ ถอดไม่ได้จริง (กดใหม่ไม่ช่วย) ${tag}: ${res.error?.slice(0, 70)}`); }
    } catch (e) {
      // exception ระดับเครือข่าย/โค้ด = ชั่วคราว → รอลองใหม่ (ไม่ทิ้งงาน)
      if (isTransient(e.message, '')) { await report(job.id, 'retry', e.message); log(`⏳ สะดุด → รอลองใหม่เอง (${tag}): ${e.message?.slice(0, 70)}`); }
      else { await report(job.id, 'error', e.message); log(`❌ error (${tag}): ${e.message?.slice(0, 70)}`); }
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
loop().catch((e) => { console.error('clip-worker crashed:', e); process.exit(1); });
