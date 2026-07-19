/**
 * ★ ACS YouTube Worker (6 ก.ค. 2026) — รันบน "เครื่องทีม (Windows)" เท่านั้น
 * ─────────────────────────────────────────────────────────────────────────────
 * ทำงาน: วนเช็กคิว 'acs-yt-jobs' (Supabase แชร์กับเว็บ Vercel) → หยิบงาน pending
 *        ที่ผู้ใช้กด "YouTube แคปเฟรม" บนเว็บ /image-search → รันแคปเฟรมผ่าน
 *        localhost API (yt-dlp+ffmpeg บนเครื่องนี้) พร้อม hostPublic:true
 *        (อัปเฟรมขึ้นโฮสต์สาธารณะ ให้เว็บเห็นรูป) → รายงานผลกลับคิว
 *
 * วิธีใช้: ต้องเปิด "2 เซิร์ฟเวอร์" พร้อมกันแล้วรัน:
 *        node scripts/acs-yt-worker.mjs
 *   - :3900 (ACS_FRAME_BASE) — งานแคปเฟรมจริงทั้งหมด: poll/claim/report คิว
 *     (/api/images/youtube-jobs) + แคปเฟรม yt-dlp/ffmpeg (/api/images/youtube)
 *     ★ 19 ก.ค.: ย้ายมา :3900 (เซิร์ฟเวอร์งานหนัก) กันชนกับพอร์ตถอดคลิปข่าว :3000
 *   - :3000 (ACS_WORKER_BASE) — งานอื่นเดิม: rehost ภาพ / mega tick / quick-test
 *   ถาวร: scripts\acs-yt-worker-forever.cmd (รีสตาร์ทเองเมื่อล้ม)
 *
 * 🔴 แตะเฉพาะคิวแคปเฟรม (acs-yt-jobs) — ไม่เกี่ยวระบบทำข่าวอัตโนมัติ/คิวข่าวเลย
 */
const BASE = process.env.ACS_WORKER_BASE || 'http://localhost:3000';
// ★ 19 ก.ค.: แยก base เฉพาะงานแคปเฟรม (คิว youtube-jobs + แคปเฟรมจริง) ไปวิ่งบน :3900
//   (เซิร์ฟเวอร์งานหนัก) กันชนพอร์ตถอดคลิปข่าว :3000 — งานอื่น (rehost/mega/quick-test) ยังใช้ BASE เดิม
const FRAME_BASE = process.env.ACS_FRAME_BASE || 'http://localhost:3900';
const IDLE_MS = Number(process.env.ACS_WORKER_IDLE_MS) || 20000; // ว่าง → เช็กใหม่ทุก 20 วิ
const ERR_MS = 30000;

// แคปเฟรม 1 งาน (ค้นคลิป+โหลด+แคป+ตาคัด+อัปโฮสต์) กินเวลาได้ 15-40 นาทีเมื่อ Gemini คิวแน่น
// → timeout 60 นาที (บทเรียน 6 ก.ค.: 15 นาทีสั้นไป งานจริงโดนตัดกลางคัน)
//   และ "route เป็นคนปิดงานในคิวเอง" — ต่อให้สายหลุด งานก็จบถูกสถานะ
let longDispatcher = null;
try {
  const { Agent } = await import('undici');
  longDispatcher = new Agent({ headersTimeout: 3_600_000, bodyTimeout: 3_600_000, connectTimeout: 30_000 });
} catch (e) {
  console.log('[acs-yt-worker] ⚠️ ตั้ง undici Agent ไม่ได้ (ใช้ timeout เริ่มต้น):', e.message);
}

const log = (...a) => console.log(`[acs-yt-worker ${new Date().toLocaleTimeString('th-TH')}]`, ...a);

async function claim() {
  const r = await fetch(`${FRAME_BASE}/api/images/youtube-jobs`, {
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
    await fetch(`${FRAME_BASE}/api/images/youtube-jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: ok ? 'done' : 'fail', id, ...extra }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    log('⚠️ รายงานผลไม่สำเร็จ:', e.message);
  }
}

// สถานะจริงจากคิว — route ปิดงานเองได้ ดังนั้นก่อน worker จะรายงาน ให้เช็คก่อนว่างานยังค้างไหม
async function jobStatus(id) {
  try {
    const r = await fetch(`${FRAME_BASE}/api/images/youtube-jobs`, { signal: AbortSignal.timeout(15000) });
    const d = await r.json().catch(() => ({}));
    const j = (d?.jobs || []).find((x) => x.id === id);
    return j?.status || 'gone';
  } catch {
    return 'unknown';
  }
}

async function processJob(job) {
  log(`▶️ เริ่มงาน ${job.id} เคส ${job.caseId}`);
  const r = await fetch(`${FRAME_BASE}/api/images/youtube`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caseId: job.caseId, hostPublic: true, ytJobId: job.id, clipUrl: job.clipUrl || undefined }),
    ...(longDispatcher ? { dispatcher: longDispatcher } : {}),
  });
  const d = await r.json().catch(() => ({}));
  // route ปิดงานในคิวเองแล้ว — worker รายงานซ้ำเฉพาะกรณี route ยังไม่ทันปิด (กันสถานะทับกัน)
  const st = await jobStatus(job.id);
  if (d.success) {
    log(`✅ เสร็จ ${job.id} — เพิ่ม ${d.added} เฟรมเข้าคลัง ${job.caseId}`);
    if (st === 'running') await report(job.id, true, { added: d.added });
  } else {
    log(`❌ ล้ม ${job.id}: [${d.errorType || 'ERROR'}] ${d.error || 'ไม่ทราบสาเหตุ'}`);
    if (st === 'running') await report(job.id, false, { error: `[${d.errorType || 'ERROR'}] ${d.error || ''}`.slice(0, 500) });
  }
}

log(`🚀 เริ่ม worker — แคปเฟรม ${FRAME_BASE} · งานอื่น ${BASE} · เช็กคิวทุก ${IDLE_MS / 1000} วิ`);
for (;;) {
  let wait = IDLE_MS;
  try {
    const job = await claim();
    if (job) {
      try {
        await processJob(job);
      } catch (e) {
        // สายหลุด/timeout — "ไม่รายงานล้ม" เพราะ pipeline อาจยังวิ่งอยู่ใน server และ route จะปิดงานเอง
        // ถ้า server ตายจริง งานค้าง 30 นาทีแล้วโดนหยิบมาทำใหม่อัตโนมัติ (สูงสุด 2 รอบ)
        log('⚠️ สายหลุดจากงาน', job.id, ':', e.message, '— รอ route ปิดงานเอง/ระบบ requeue');
      }
      wait = 3000; // เพิ่งจบงาน → เช็กต่อเร็วเผื่อมีคิวค้าง
    } else {
      // ★ 6 ก.ค. (ผู้ใช้สั่ง "ภาพพร้อมใช้"): คิวแคปเฟรมว่าง → เซฟไฟล์ภาพต้นฉบับคุณภาพเต็ม
      //   เข้าคลังถาวรทีละก้อนเล็ก (ภาพที่ยังเป็นลิงก์เว็บนอก โหลดมาเก็บ Supabase Storage)
      try {
        const r = await fetch(`${BASE}/api/images/rehost`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'run', limit: 8 }),
          signal: AbortSignal.timeout(300000),
        });
        const d = await r.json().catch(() => ({}));
        if (d.success && d.checked > 0) {
          log(`💾 เซฟภาพต้นฉบับเข้าคลังถาวร ${d.hosted}/${d.checked} ใบ${d.failed ? ` (พลาด ${d.failed})` : ''}`);
          wait = 3000; // ยังมีคิวภาพ → เก็บต่อทันที
        }
      } catch {
        /* เงียบ — รอบหน้าลองใหม่ */
      }

      // 🏭 MEGA (7 ก.ค.): เดินสายพานข่าวครบวงจร 1 จังหวะตอนว่าง — ไม่มีงาน = no-op เร็วมาก
      // ★ 17 ก.ค. (Q1 คิว rt_*): ปิดได้ด้วย ACS_WORKER_MEGA_TICK=0 — จำเป็นเมื่อ build ที่ BASE เก่ากว่าคิว rt_*
      //   (STAGE_FLOW เก่าไม่รู้จัก rt_s5case → เขียน failed เปล่าลง Supabase ที่แชร์กับ cloud = ฆ่างานคิวเงียบๆ
      //   ชนะ race กับ Vercel cron ตลอดเพราะลูปนี้ถี่กว่า) · เปิดคืน: ลบ env หรือ =1 หลัง rebuild :3900 รุ่นมี rt_*
      if (process.env.ACS_WORKER_MEGA_TICK !== '0') {
        try {
          const r = await fetch(`${BASE}/api/mega/tick`, {
            method: 'POST',
            ...(longDispatcher ? { dispatcher: longDispatcher } : {}),
          });
          const d = await r.json().catch(() => ({}));
          if (d.success && !d.idle) {
            log(`🏭 MEGA ${d.jobId} · ${d.stageLabel || d.stage}: ${(d.result && d.result.summary) || d.skipped || ''}`);
            wait = 3000; // สายพานยังเดินอยู่ → จังหวะถัดไปเร็วๆ
          } else if (d.success === false && d.error) {
            log(`🏭 MEGA tick ตอบ error: ${String(d.error).slice(0, 120)}`); // ★ 17 ก.ค.: เลิกกลืนเงียบ — ให้เห็นใน log
          }
        } catch {
          /* เงียบ */
        }
      }

      // 📱 Quick-test (9 ก.ค.): งานเทสปกที่ผู้ใช้กดบนเว็บ Vercel แล้ว "คลาวทำไม่ได้" (ref เต็มท่อ)
      //   ถูกส่งเข้าคิวเครื่องทีม → หยิบมารัน 1 งาน (server fire-and-forget รันต่อเอง ไม่บล็อก worker)
      try {
        const r = await fetch(`${BASE}/api/quick-test`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'run' }),
          signal: AbortSignal.timeout(20000),
        });
        const d = await r.json().catch(() => ({}));
        if (d.success && d.claimed) {
          log(`📱 quick-test รับงาน ${d.claimed} (${d.kind}) — เครื่องทีมรันเบื้องหลังต่อ`);
          wait = 3000;
        }
      } catch {
        /* เงียบ */
      }
    }
  } catch (e) {
    // claim() ยิงไป FRAME_BASE (:3900 งานหนัก) — ถ้าพังตรงนี้แปลว่าเซิร์ฟเวอร์แคปเฟรมล่ม/รีสตาร์ท ไม่ใช่ :3000
    log(`⚠️ เช็กคิวไม่ได้ (เซิร์ฟเวอร์แคปเฟรม ${FRAME_BASE} ล่ม/รีสตาร์ท?):`, e.message);
    wait = ERR_MS;
  }
  await new Promise((res) => setTimeout(res, wait));
}
