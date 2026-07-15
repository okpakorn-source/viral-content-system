// ============================================================
// ★ 9 ก.ค. 2026 — POST/GET /api/quick-test — เทสปก "รันเบื้องหลัง"
// ------------------------------------------------------------
// รวม 2 ระบบเทสปกไว้ที่เดียว + ทำให้รันเบื้องหลัง (มือถือกดแล้วปิดจอได้)
//   kind='compose' → ยิง /api/mega/compose-test (เร็ว ~20-80 วิ ใช้คลังเคสเดิม)
//   kind='ref'     → ยิง /api/cover-ref-test (เต็มท่อ MEGA ~3-6 นาที)
// ไม่แตะโค้ด 2 ระบบเดิม — แค่ห่อเป็นงาน + เรียกซ้ำ · ผลปกเก็บคลังคลาวด์เดิม
//   POST {kind, ...input} → สร้าง job แล้ว fire-and-forget → คืน {jobId}
//   GET                   → รายการงานล่าสุด (มือถือโพล)
//   GET ?jobId=..         → สถานะงานเดียว
// ⚠️ fire-and-forget ทำงานบนเซิร์ฟเวอร์ที่รันยาว (เครื่องทีม :3000/:9871) —
//    ตรงกับที่ 2 ระบบนี้ต้องรันบนเครื่องทีมอยู่แล้ว (คลัง/ท่อ MEGA)
// ============================================================

import { NextResponse } from 'next/server';
import { createJob, patchJob, finishJob, listJobs, getJob, claimTeamJob, removeJob } from '@/lib/quickTestJobs';

export const runtime = 'nodejs';
export const maxDuration = 300; // คลาวรัน compose sync ได้ถึง ~5 นาที (ต้อง Vercel Pro) · เครื่องทีมคืนทันที

// ── สภาพแวดล้อม + ความสามารถต่อ kind ──
//   คลาว (Vercel) = platform ไม่ใช่ win32 (บทเรียนเก่า: env.VERCEL หลอกบนเครื่องทีม)
//   คลาวทำได้ = รันบนคลาว sync · คลาวทำไม่ได้ = ส่งเครื่องทีม (worker claim)
//   compose (AI+sharp เร็ว) คลาวทำได้ · ref (เต็มท่อ 3-18 นาที + yt-dlp) คลาวทำไม่ได้
const IS_CLOUD = process.platform !== 'win32';
const CLOUD_KINDS = (process.env.QUICK_TEST_CLOUD_KINDS || 'compose').split(',').map((s) => s.trim()).filter(Boolean);
const canRunOnCloud = (kind) => CLOUD_KINDS.includes(kind);

function badReq(error) {
  return NextResponse.json({ success: false, error, errorType: 'BAD_INPUT' }, { status: 400 });
}

// ── retry: วนทำซ้ำจน "ได้ผลจริง" (ระบบล่มชั่วคราว เช่น Gemini ล่ม → ห้ามปล่อยงานล้ม/คุณภาพต่ำ) ──
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRY_MAX = Math.max(1, parseInt(process.env.QUICK_TEST_MAX_ATTEMPTS || '6', 10));
const RETRY_BASE_MS = Math.max(3000, parseInt(process.env.QUICK_TEST_RETRY_MS || '20000', 10));
// หยุดวน (วนไปก็ไม่หาย): input ผิด + "ทำครบแล้วแต่วัตถุดิบไม่พอจริง" (พูล/ภาพไม่พอ — วนเนื้อเดิมก็ได้เท่าเดิม)
//   ต่างจาก "ระบบล่มชั่วคราว" (Gemini/SerpApi/network/5xx/timeout ล่ม) ที่ *ต้อง* วนซ้ำจนได้ผลจริง
const TERMINAL_ERRORS = new Set([
  'BAD_INPUT', 'NO_CONTENT', 'CASE_NOT_FOUND',                     // input ผิด
  'INSUFFICIENT_PICKED', 'POOL_TOO_THIN', 'NO_CLIPS', 'NO_FRAMES', // ทำครบแล้ววัตถุดิบไม่พอ (ไม่ใช่ระบบล่ม)
]);

// รัน 1 รอบ — สำเร็จคืน result object, ล้ม throw (แนบ errorType/trace)
async function callOnce(job, origin) {
  if (job.kind === 'compose') {
    const res = await fetch(`${origin}/api/mega/compose-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId: job.input.caseId, refId: job.input.refId || undefined, heroPersonHint: job.input.heroPersonHint || undefined }),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.success) throw Object.assign(new Error(d.error || `HTTP ${res.status}`), { errorType: d.errorType });
    return {
      template: d.template || null,
      refSimilarity: d.refSimilarity ?? null,
      refDiffs: d.refDiffs || [],
      eyeFixed: d.eyeFixed || 0,
      poolSize: d.poolSize ?? null,
      elapsed: d.elapsed || null,
      archivedId: d.archivedId || null,
      coverImgUrl: d.archivedId ? `/api/mega-covers/img?id=${encodeURIComponent(d.archivedId)}` : null,
      refImgUrl: d.refUsed?.imagePath || null,
      refName: d.refUsed?.styleName || null,
      caseId: d.caseId || job.input.caseId,
    };
  }
  // kind === 'ref' — เต็มท่อ MEGA
  // ★ 15 ก.ค. 69 แบตช์ 5: แนบคีย์ทีม (server-side env — ไม่รั่วสู่ client) ให้ผ่านด่านตรวจสิทธิ์ src/middleware.js เมื่อเรียกผ่านโฮสต์ (cloud)
  const refHeaders = { 'Content-Type': 'application/json' };
  if (process.env.COVER_TEST_KEY) refHeaders['x-cover-test-key'] = process.env.COVER_TEST_KEY;
  const res = await fetch(`${origin}/api/cover-ref-test`, {
    method: 'POST',
    headers: refHeaders,
    body: JSON.stringify({ newsTitle: job.input.newsTitle || '', content: job.input.content }),
    signal: AbortSignal.timeout(25 * 60 * 1000),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.success) throw Object.assign(new Error(d.error || `HTTP ${res.status}`), { errorType: d.errorType, trace: d.trace });
  return {
    template: d.template || null,
    score: d.score ?? null,
    refSimilarity: d.refSimilarity ?? null,
    elapsed: d.elapsedTotal || d.elapsed || null,
    coverImgUrl: d.coverPath || null,
    refImgUrl: d.matchedRef?.imagePath || null,
    refName: d.matchedRef?.styleName || null,
    imageCaseId: d.imageCaseId || null,
    poolSize: d.poolSize ?? null,
    trace: Array.isArray(d.trace) ? d.trace.map((t) => ({ stage: t.stage, status: t.status })) : [],
  };
}

// ── งานรันเบื้องหลัง + วนซ้ำจนได้ผลจริง ──
//   cloud (sync บน Vercel maxDuration 300) = ลองรอบเดียว → ล้มให้ POST fallback ส่งเครื่องทีม (วนซ้ำได้ไม่จำกัดเวลา)
//   team/local (เครื่องทีมรันยาว) = วนซ้ำ RETRY_MAX รอบ + backoff เพิ่มขึ้น · refresh claimedAt กัน stale-reclaim ระหว่างวน
async function runJob(job, origin) {
  const maxAttempts = job.dispatch === 'cloud' ? 1 : RETRY_MAX;
  const nowIso = () => new Date().toISOString();
  await patchJob(job.id, { status: 'running', startedAt: nowIso(), claimedAt: nowIso(), progress: { step: 'กำลังรัน', pct: 5 } });
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // ★ 9 ก.ค.: ผู้ใช้กดลบระหว่างรัน → getJob เจอ null → หยุดทันที ไม่วนต่อ ไม่เขียนผลกลับ (ปุ่มลบใน UI)
    if (!(await getJob(job.id))) return;
    try {
      if (attempt > 1) await patchJob(job.id, { claimedAt: nowIso(), progress: { step: `ลองใหม่รอบ ${attempt}/${maxAttempts}`, pct: 5 } });
      const result = await callOnce(job, origin);
      if (!(await getJob(job.id))) return; // ถูกลบระหว่างรอบนี้ → ไม่เขียน done ทับ
      await finishJob(job.id, { status: 'done', progress: { step: 'เสร็จ', pct: 100 }, result, attempts: attempt, error: null });
      return;
    } catch (e) {
      lastErr = e;
      if (TERMINAL_ERRORS.has(e?.errorType)) break; // input ผิด — วนไปก็ไม่หาย
      if (attempt < maxAttempts) {
        const waitMs = Math.min(RETRY_BASE_MS * attempt, 120000); // backoff เพิ่มขึ้น เพดาน 2 นาที
        await patchJob(job.id, { claimedAt: nowIso(), progress: { step: `⚠️ ล่ม (${(e?.message || '').slice(0, 40)}) — รอ ${Math.round(waitMs / 1000)}วิ วนใหม่ ${attempt + 1}/${maxAttempts}`, pct: 5 } });
        await sleep(waitMs);
      }
    }
  }
  if (!(await getJob(job.id))) return; // ถูกลบระหว่างวน → ไม่เขียน failed ทับ
  await finishJob(job.id, {
    status: 'failed',
    progress: { step: `ล้มเหลว (ครบ ${maxAttempts} รอบ)`, pct: 100 },
    error: (lastErr?.message || 'ล้มเหลว').slice(0, 300),
    errorType: lastErr?.errorType || null,
    attempts: maxAttempts,
    result: Array.isArray(lastErr?.trace) ? { trace: lastErr.trace.map((t) => ({ stage: t.stage, status: t.status })) } : null,
  }).catch(() => {});
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const origin = req.nextUrl.origin;

    // ── action 'run': worker เครื่องทีมสั่งรันงาน dispatch='team' ที่ค้าง 1 งาน (fire-and-forget) ──
    //   เรียกจาก scripts/acs-yt-worker.mjs ตอนว่าง — รันบนเครื่องทีม (yt-dlp/ffmpeg/ท่อ MEGA ครบ)
    // ── action 'delete': ผู้ใช้กดลบคิว (ทีละงาน jobId หรือ ล้างค้างทั้งหมด scope='active') ──
    //   งานที่กำลังรัน: ลบแถวออก → runJob เจอ getJob=null แล้วหยุด+ไม่เขียนผลทับ (ไม่ต้องฆ่า process)
    if (body.action === 'delete') {
      if (body.jobId) {
        await removeJob(String(body.jobId)).catch(() => {});
        return NextResponse.json({ success: true, deleted: 1 });
      }
      if (body.scope === 'active' || body.scope === 'all') {
        const jobs = await listJobs(200);
        const targets = body.scope === 'all' ? jobs : jobs.filter((j) => j.status === 'pending' || j.status === 'running');
        for (const j of targets) await removeJob(j.id).catch(() => {});
        return NextResponse.json({ success: true, deleted: targets.length });
      }
      return badReq('ต้องระบุ jobId หรือ scope=active|all');
    }

    if (body.action === 'run') {
      if (IS_CLOUD) return NextResponse.json({ success: false, error: 'action run ใช้บนเครื่องทีมเท่านั้น', errorType: 'CLOUD_CANNOT_RUN' }, { status: 400 });
      const claimed = await claimTeamJob();
      if (!claimed) return NextResponse.json({ success: true, claimed: null });
      runJob(claimed, origin).catch(() => {});
      return NextResponse.json({ success: true, claimed: claimed.id, kind: claimed.kind });
    }

    const kind = body.kind === 'ref' ? 'ref' : body.kind === 'compose' ? 'compose' : null;
    if (!kind) return badReq('ต้องระบุ kind = compose | ref');

    let input;
    let label;
    if (kind === 'compose') {
      const caseId = String(body.caseId || '').trim();
      if (!caseId) return badReq('ต้องระบุ caseId (เลือกเคส)');
      const heroPersonHint = String(body.heroPersonHint || '').trim();
      input = { caseId, refId: String(body.refId || '').trim() || null, heroPersonHint: heroPersonHint || null };
      label = `⚡ ทางลัด · ${caseId}${heroPersonHint ? ' · ' + heroPersonHint : ''}`;
    } else {
      const content = String(body.content || '').trim();
      const newsTitle = String(body.newsTitle || '').trim();
      // ★ 15 ก.ค. 69: gate สองชั้นแบบเดียวกับ /api/cover-ref-test — content ≥100 ตัว และ (newsTitle+content ตาม filter(Boolean)) รวม ≥200 ตัว
      if (content.length < 100) return badReq(`เนื้อข่าวเต็มต้อง ≥100 ตัวอักษร (ตอนนี้มี ${content.length} ตัวอักษร — ห้ามเนื้อสั้นตัดทอน)`);
      const combinedLen = [newsTitle, content].filter(Boolean).join('\n\n').length;
      if (combinedLen < 200) return badReq(`เนื้อหารวม (หัวข่าว+เนื้อข่าว) ต้อง ≥200 ตัวอักษร (ตอนนี้มี ${combinedLen} ตัวอักษร — ห้ามเนื้อสั้นตัดทอน)`);
      input = { newsTitle, content };
      label = `🎯 เต็มท่อ · ${(newsTitle || content).slice(0, 40)}`;
    }

    // ── ตัดสิน dispatch ──
    //   local = เครื่องทีมเข้า LAN (fire-and-forget) · cloud = Vercel รัน sync · team = ส่งคิวเครื่องทีม (worker claim)
    //   🧪 _forceDispatch ('team'|'cloud') = ทดสอบ path ข้ามการตรวจสภาพแวดล้อม (งานของผู้ใช้เอง ไม่มีผลความปลอดภัย)
    const forceDispatch = ['team', 'cloud'].includes(body._forceDispatch) ? body._forceDispatch : null;
    let effective;
    if (forceDispatch) effective = forceDispatch;
    else if (!IS_CLOUD) effective = 'local';
    else if (canRunOnCloud(kind)) effective = 'cloud';
    else effective = 'team';

    if (effective === 'team') {
      // ส่งเข้าคิวเครื่องทีม — worker (acs-yt-worker) หยิบไปรัน แล้วเขียนผลกลับ · มือถือ poll
      const job = await createJob({ kind, label, input, dispatch: 'team' });
      return NextResponse.json({ success: true, jobId: job.id, dispatch: 'team', job, message: '🖥️ ส่งเข้าเครื่องทีมแล้ว — เดี๋ยว worker รับไปรัน (ดูสถานะสดที่นี่)' });
    }
    const job = await createJob({ kind, label, input, dispatch: effective });
    if (effective === 'cloud') {
      // รันบนคลาว sync (job row สร้างก่อนแล้ว มือถือ poll เห็น running ระหว่างรอ ~20-80 วิ)
      await runJob(job, origin);
      let done = await getJob(job.id);
      // 🔁 auto-fallback: คลาวรันไม่สำเร็จ (เช่น ภาพบางใบเป็น local เครื่องทีม) → ส่งต่อเข้าคิวเครื่องทีมเอง
      //   (ปิดได้ด้วย QUICK_TEST_CLOUD_FALLBACK=0) — ตรงหลักการ "คลาวทำได้ก็คลาว ทำไม่ได้ก็เครื่องทีม"
      if (done && done.status === 'failed' && process.env.QUICK_TEST_CLOUD_FALLBACK !== '0') {
        await patchJob(job.id, { status: 'pending', dispatch: 'team', error: null, result: null, claimedAt: null, startedAt: null, retries: 0, progress: { step: 'คลาวล้ม → ส่งเครื่องทีม', pct: 0 } });
        done = await getJob(job.id);
        return NextResponse.json({ success: true, jobId: job.id, dispatch: 'team', job: done, message: '☁️→🖥️ คลาวรันไม่สำเร็จ ส่งเข้าเครื่องทีมแทน (worker รับต่อ)' });
      }
      return NextResponse.json({ success: true, jobId: job.id, dispatch: 'cloud', job: done });
    }
    // local — fire-and-forget (เซิร์ฟเวอร์เครื่องทีมรันยาว รับได้ทุก kind)
    runJob(job, origin).catch(() => {});
    return NextResponse.json({ success: true, jobId: job.id, dispatch: 'local', job });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message, errorType: 'UNEXPECTED' }, { status: 500 });
  }
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');
    if (jobId) {
      const job = await getJob(jobId);
      if (!job) return NextResponse.json({ success: false, error: 'ไม่พบงาน', errorType: 'NOT_FOUND' }, { status: 404 });
      return NextResponse.json({ success: true, job });
    }
    const limit = Math.min(parseInt(searchParams.get('limit') || '30', 10) || 30, 60);
    const jobs = await listJobs(limit);
    return NextResponse.json({ success: true, jobs });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message, errorType: 'UNEXPECTED' }, { status: 500 });
  }
}
