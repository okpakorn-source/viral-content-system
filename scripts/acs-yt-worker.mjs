/**
 * ★ ACS YouTube Worker (6 ก.ค. 2026) — รันบน "เครื่องทีม (Windows)" เท่านั้น
 * ─────────────────────────────────────────────────────────────────────────────
 * ทำงาน: วนเช็กคิว 'acs-yt-jobs' (Supabase แชร์กับเว็บ Vercel) → หยิบงาน pending
 *        ที่ผู้ใช้กด "YouTube แคปเฟรม" บนเว็บ /image-search → รันแคปเฟรมผ่าน
 *        localhost API (yt-dlp+ffmpeg บนเครื่องนี้) พร้อม hostPublic:true
 *        (อัปเฟรมขึ้นโฮสต์สาธารณะ ให้เว็บเห็นรูป) → รายงานผลกลับคิว
 *
 * วิธีใช้: เซิร์ฟเวอร์ :3000 ต้องรันอยู่ แล้วรัน:
 *        node scripts/acs-yt-worker.mjs
 *   ถาวร: scripts\acs-yt-worker-forever.cmd (รีสตาร์ทเองเมื่อล้ม)
 *
 * 🔴 แตะเฉพาะคิวแคปเฟรม (acs-yt-jobs) — ไม่เกี่ยวระบบทำข่าวอัตโนมัติ/คิวข่าวเลย
 */
const BASE = process.env.ACS_WORKER_BASE || 'http://localhost:3000';
const IDLE_MS = Number(process.env.ACS_WORKER_IDLE_MS) || 20000; // ว่าง → เช็กใหม่ทุก 20 วิ
const ERR_MS = 30000;

// แคปเฟรม 1 งาน (ค้นคลิป+โหลด+แคป+ตาคัด+อัปโฮสต์) กินเวลาได้ >5 นาที
// → ตั้ง undici timeout ยาว 15 นาที (บทเรียนเดียวกับ clip-worker)
let longDispatcher = null;
try {
  const { Agent } = await import('undici');
  longDispatcher = new Agent({ headersTimeout: 900_000, bodyTimeout: 900_000, connectTimeout: 30_000 });
} catch (e) {
  console.log('[acs-yt-worker] ⚠️ ตั้ง undici Agent ไม่ได้ (ใช้ timeout เริ่มต้น):', e.message);
}

const log = (...a) => console.log(`[acs-yt-worker ${new Date().toLocaleTimeString('th-TH')}]`, ...a);

async function claim() {
  const r = await fetch(`${BASE}/api/images/youtube-jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'claim' }),
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json().catch(() => ({}));
  return d?.job || null;
}

async function report(id, ok, extra = {}) {
  try {
    await fetch(`${BASE}/api/images/youtube-jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: ok ? 'done' : 'fail', id, ...extra }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    log('⚠️ รายงานผลไม่สำเร็จ:', e.message);
  }
}

async function processJob(job) {
  log(`▶️ เริ่มงาน ${job.id} เคส ${job.caseId}`);
  const r = await fetch(`${BASE}/api/images/youtube`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caseId: job.caseId, hostPublic: true }),
    ...(longDispatcher ? { dispatcher: longDispatcher } : {}),
  });
  const d = await r.json().catch(() => ({}));
  if (d.success) {
    log(`✅ เสร็จ ${job.id} — เพิ่ม ${d.added} เฟรมเข้าคลัง ${job.caseId}`);
    await report(job.id, true, { added: d.added });
  } else {
    log(`❌ ล้ม ${job.id}: [${d.errorType || 'ERROR'}] ${d.error || 'ไม่ทราบสาเหตุ'}`);
    await report(job.id, false, { error: `[${d.errorType || 'ERROR'}] ${d.error || ''}`.slice(0, 500) });
  }
}

log(`🚀 เริ่ม worker — base ${BASE} · เช็กคิวทุก ${IDLE_MS / 1000} วิ`);
for (;;) {
  let wait = IDLE_MS;
  try {
    const job = await claim();
    if (job) {
      try {
        await processJob(job);
      } catch (e) {
        log('❌ processJob พัง:', e.message);
        await report(job.id, false, { error: e.message.slice(0, 500) });
      }
      wait = 3000; // เพิ่งจบงาน → เช็กต่อเร็วเผื่อมีคิวค้าง
    }
  } catch (e) {
    log('⚠️ เช็กคิวไม่ได้ (เซิร์ฟเวอร์ :3000 ล่ม/รีสตาร์ท?):', e.message);
    wait = ERR_MS;
  }
  await new Promise((res) => setTimeout(res, wait));
}
