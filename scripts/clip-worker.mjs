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
  });
  const d = await r.json().catch(() => ({}));
  if (d?.success) return { ok: true, result: d.data };
  return { ok: false, error: d?.error || `HTTP ${r.status}` };
}

async function report(id, ok, payload) {
  await fetch(`${BASE}/api/clip-transcript/worker`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ok ? { id, status: 'done', result: payload } : { id, status: 'error', error: payload }),
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
      else { await report(job.id, false, res.error); log(`❌ ถอดไม่สำเร็จ: ${res.error?.slice(0, 80)}`); }
    } catch (e) {
      await report(job.id, false, e.message); log(`❌ error: ${e.message?.slice(0, 80)}`);
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
loop().catch((e) => { console.error('clip-worker crashed:', e); process.exit(1); });
