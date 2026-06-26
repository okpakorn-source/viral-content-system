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
  const r = await fetch(`${BASE}/api/clip-transcript/worker`, { method: 'GET' });
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
  return { ok: false, error: d?.error || `HTTP ${r.status}` };
}

// ★ 26 มิ.ย.: Gemini แน่นชั่วคราว = ไม่ fail · ขอ retry (server ตั้งเวลารอ → หยิบทำใหม่อัตโนมัติ)
//   อาการ "ชั่วคราว" (503/แน่น/เน็ตสะดุด) → retry · อาการถาวร (ดูคลิปไม่ได้/ส่วนตัว) → error เลย
const isTransient = (err = '') =>
  /503|429|high demand|overload|unavailable|temporar|rate limit|แน่น|มีคนใช้งานหนัก|parse ไม่ได้|fetch failed|ECONNRESET|socket hang up|network|ETIMEDOUT/i.test(String(err));

async function report(id, statusOrOk, payload) {
  // statusOrOk: true='done' · 'retry'='retry' · false/อื่น='error'
  const status = statusOrOk === true ? 'done' : statusOrOk === 'retry' ? 'retry' : 'error';
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

    log(`▶️ งานใหม่: [${job.platform}/${job.kind}] ${String(job.url).slice(0, 60)}`);
    try {
      const res = await processJob(job);
      if (res.ok) { await report(job.id, true, res.result); log(`✅ เสร็จ: ${job.id.slice(0, 8)}`); }
      else if (isTransient(res.error)) { await report(job.id, 'retry', res.error); log(`⏳ Gemini แน่น → ขอลองใหม่ภายหลัง: ${res.error?.slice(0, 60)}`); }
      else { await report(job.id, false, res.error); log(`❌ ถอดไม่สำเร็จ: ${res.error?.slice(0, 80)}`); }
    } catch (e) {
      if (isTransient(e.message)) { await report(job.id, 'retry', e.message); log(`⏳ Gemini แน่น → ขอลองใหม่: ${e.message?.slice(0, 60)}`); }
      else { await report(job.id, false, e.message); log(`❌ error: ${e.message?.slice(0, 80)}`); }
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
loop().catch((e) => { console.error('clip-worker crashed:', e); process.exit(1); });
