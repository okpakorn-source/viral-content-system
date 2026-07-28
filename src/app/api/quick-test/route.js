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
import { Agent } from 'undici';
import { createJob, patchJob, finishJob, listJobs, getJob, claimTeamJob, removeJob, getBootId } from '@/lib/quickTestJobs';
// ★ 27 ก.ค. 69: 3 ชนิดงานโต๊ะข่าว (desk_harvest/desk_search/desk_chief) — ยืม whitelist mode จาก taxonomy เดียวกับ /api/m/desk
import { HARVEST_MODE_KEYS, HARVEST_MODES } from '@/lib/services/newsDesk/taxonomy';

export const runtime = 'nodejs';
export const maxDuration = 300; // คลาวรัน compose sync ได้ถึง ~5 นาที (ต้อง Vercel Pro) · เครื่องทีมคืนทันที

// ── สภาพแวดล้อม + ความสามารถต่อ kind ──
//   คลาว (Vercel) = platform ไม่ใช่ win32 (บทเรียนเก่า: env.VERCEL หลอกบนเครื่องทีม)
//   คลาวทำได้ = รันบนคลาว sync · คลาวทำไม่ได้ = ส่งเครื่องทีม (worker claim)
//   compose (AI+sharp เร็ว) คลาวทำได้ · ref (เต็มท่อ 3-18 นาที + yt-dlp) คลาวทำไม่ได้
const IS_CLOUD = process.platform !== 'win32';
const CLOUD_KINDS = (process.env.QUICK_TEST_CLOUD_KINDS || 'compose').split(',').map((s) => s.trim()).filter(Boolean);
// ★ 27 ก.ค. 69 (sol-review วิกฤต 2): 2 คลาสงาน — แต่ละคลาส claim/รัน "ทีละงาน" เป็นช่องแยกกัน (ดู quickTestJobs.claimTeamJob)
//   คลาสปก (compose/ref) กับคลาสโต๊ะข่าว (desk_*) ต้องไม่บล็อกกัน — งานโต๊ะยาว 9+ นาทีไม่ควรกันงานปกรอคิวเปล่าๆ
const COVER_KINDS = ['compose', 'ref'];
const DESK_KINDS = ['desk_harvest', 'desk_search', 'desk_chief'];
// desk_* (ล่าข่าว/ค้นเอง/บก.ใหญ่) = ห้ามรันบนคลาวเสมอ (งานยาว 9+ นาที เกิน maxDuration 300 ของสาย sync)
//   บังคับ false ตรงๆ ไม่พึ่ง env CLOUD_KINDS กันตั้งค่าพลาดเปิดคลาวรันงานยาวเกิน
const canRunOnCloud = (kind) => (DESK_KINDS.includes(kind) ? false : CLOUD_KINDS.includes(kind));

function badReq(error) {
  return NextResponse.json({ success: false, error, errorType: 'BAD_INPUT' }, { status: 400 });
}

// ★ ชุด① sol-review 26 ก.ค. 69: ตรวจลิงก์คลิปเข้มขึ้น — ต้อง parse ผ่าน URL จริง + http(s) + hostname ไม่ว่าง (กัน "https://" เปล่า) + ยาว ≤500
const CLIP_URL_MAX_LEN = 500;
function isValidClipUrl(u) {
  const s = String(u || '').trim();
  if (!s || s.length > CLIP_URL_MAX_LEN) return false;
  try {
    const p = new URL(s);
    return (p.protocol === 'http:' || p.protocol === 'https:') && !!p.hostname;
  } catch { return false; }
}

// ── retry: วนทำซ้ำจน "ได้ผลจริง" (ระบบล่มชั่วคราว เช่น Gemini ล่ม → ห้ามปล่อยงานล้ม/คุณภาพต่ำ) ──
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRY_MAX = Math.max(1, parseInt(process.env.QUICK_TEST_MAX_ATTEMPTS || '6', 10));
const RETRY_BASE_MS = Math.max(3000, parseInt(process.env.QUICK_TEST_RETRY_MS || '20000', 10));
// ★ 27 ก.ค. 69 (sol-review ข้อ 2 ต่อเนื่อง): งานโต๊ะข่าววนน้อยกว่าปก — ล่าข่าว/ค้นเอง/บก.ใหญ่ ล้มซ้ำ = ยิง Serper/AI ซ้ำแพง
//   ต่างจากปก (compose/ref) ที่ล้มมักเป็นระบบล่มชั่วคราว วนคุ้มกว่า — desk วน 2 รอบพอ ล้มจริงค่อยกดใหม่เอง
const DESK_RETRY_MAX = Math.max(1, parseInt(process.env.QUICK_TEST_DESK_MAX_ATTEMPTS || '2', 10));
// หยุดวน (วนไปก็ไม่หาย): input ผิด + "ทำครบแล้วแต่วัตถุดิบไม่พอจริง" (พูล/ภาพไม่พอ — วนเนื้อเดิมก็ได้เท่าเดิม)
//   ต่างจาก "ระบบล่มชั่วคราว" (Gemini/SerpApi/network/5xx/timeout ล่ม) ที่ *ต้อง* วนซ้ำจนได้ผลจริง
const TERMINAL_ERRORS = new Set([
  'BAD_INPUT', 'NO_CONTENT', 'CASE_NOT_FOUND',                     // input ผิด
  'INSUFFICIENT_PICKED', 'POOL_TOO_THIN', 'NO_CLIPS', 'NO_FRAMES', // ทำครบแล้ววัตถุดิบไม่พอ (ไม่ใช่ระบบล่ม)
]);

// ★ 26 ก.ค. 69: ท่อ ref ตอบครั้งเดียวตอนจบ (>5 นาทีได้) — undici default headersTimeout 300s ตัดกลางทาง = "fetch failed"
//   ต้องยกเพดานผ่าน dispatcher เท่านั้น (AbortSignal คุมไม่ถึงชั้นนี้)
// ★ 27 ก.ค. 69: ยก 25→32 นาที — ต้องสูงกว่าเพดาน AbortSignal สูงสุดของ desk_harvest mode 'all' (30 นาที ดู harvestTimeoutMs
//   ด้านล่าง) เสมอ กันชั้น dispatcher ตัดก่อนที่ AbortSignal ชั้นในจะได้ทำงานตามที่ตั้งใจ
const REF_LONG_AGENT = new Agent({ headersTimeout: 32 * 60 * 1000, bodyTimeout: 32 * 60 * 1000 });

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
      // ★ 27 ก.ค. 69 (นโยบาย "เก็บทุกใบ+ติดป้ายสถานะ"): ป้ายสถานะ + เหตุผลถ้าไม่เข้าคลัง — ให้ progress.step ท้าย runJob() ใช้
      qcStatus: d.qcStatus || null,
      archiveSkipReason: d.archiveSkipReason || null,
      // ★ 27 ก.ค. ค่ำ (เจ้าของอนุมัติ — ปุ่ม "เปลี่ยนภาพรายช่อง" ใน /m): เก็บผังช่องที่ใช้จริง + id ต้นแบบ ติดไปกับผลงาน
      //   ให้ภายหลังหยิบมาสร้าง slotPlan แช่แข็งใหม่ได้โดยไม่ต้องยิง S6 ซ้ำ — กันขนาด payload ใหญ่: เก็บเฉพาะ url+slot+isHero ต่อช่อง (ตัด backup/thumbnail/triage ทิ้ง)
      slotPlanUsed: Array.isArray(d.slotPlanUsed)
        ? d.slotPlanUsed.filter((e) => e && e.slot).map((e) => ({ url: e.url, slot: e.slot, isHero: !!e.isHero }))
        : null,
      refUsed: d.refUsed?.id ? { id: d.refUsed.id } : null,
    };
  }
  // ★ 27 ก.ค. 69: 3 ชนิดงานโต๊ะข่าว — เรียกตรงเข้า /api/news-desk/* (ไม่ผ่าน middleware ป้องกัน คุมแค่ cover-ref-test/quick-test)
  //   ทุกตัวต้องใช้ dispatcher REF_LONG_AGENT เหมือน ref — undici headersTimeout/bodyTimeout ค่า default (300s) ตัดกลางทางถ้าไม่ตั้ง
  if (job.kind === 'desk_harvest' || job.kind === 'desk_search') {
    const body = job.kind === 'desk_harvest' ? { mode: job.input.mode } : { keyword: job.input.keyword };
    // ★ 27 ก.ค. 69 (หลักฐานงานจริง): mode 'all' ลาก 11 เลนพร้อมกัน วัดจริง ~20-25 นาที ชนเพดาน 20 นาทีเดิม
    //   → ยกเป็น 30 นาทีเฉพาะ desk_harvest mode 'all' · โหมดเดี่ยว (~9 นาที) และ desk_search คงเดิม 20 นาที (พอเหลือ)
    const harvestTimeoutMs = (job.kind === 'desk_harvest' && job.input.mode === 'all') ? 30 * 60 * 1000 : 20 * 60 * 1000;
    const res = await fetch(`${origin}/api/news-desk/harvest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(harvestTimeoutMs),
      dispatcher: REF_LONG_AGENT,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.success) throw Object.assign(new Error(d.error || `HTTP ${res.status}`), { errorType: d.errorType });
    const added = d.added ?? 0;
    const harvested = d.harvested ?? 0;
    if (job.kind === 'desk_harvest') {
      const modeInfo = HARVEST_MODES.find((m) => m.key === job.input.mode);
      return {
        added, harvested, mode: job.input.mode, lanes: modeInfo?.lanes || [],
        summary: `เก็บข่าวใหม่ได้ ${added} ใบ (เจอทั้งหมด ${harvested} · ซ้ำ ${d.dupSkipped ?? 0} · ไม่ผ่านด่าน ${d.gated ?? 0})`.slice(0, 2000),
      };
    }
    return {
      added, harvested, keyword: job.input.keyword,
      summary: `ค้น "${job.input.keyword}" เจอข่าวใหม่ ${added} ใบ (เจอทั้งหมด ${harvested} · ซ้ำ ${d.dupSkipped ?? 0})`.slice(0, 2000),
    };
  }
  if (job.kind === 'desk_chief') {
    const res = await fetch(`${origin}/api/news-desk/chief`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(20 * 60 * 1000),
      dispatcher: REF_LONG_AGENT,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.success) throw Object.assign(new Error(d.error || `HTTP ${res.status}`), { errorType: d.errorType });
    const orders = Array.isArray(d.orders) ? d.orders : [];
    const warnings = Array.isArray(d.warnings) ? d.warnings : [];
    const pushNow = Array.isArray(d.pushNow) ? d.pushNow : [];
    return {
      diagnosis: String(d.diagnosis || '').slice(0, 2000),
      orders, warnings, pushNow,
      extraQueries: Array.isArray(d.extraQueries) ? d.extraQueries : [],
      harvested: d.harvested ?? 0,
      summary: [d.diagnosis, ...orders, ...warnings].filter(Boolean).join(' · ').slice(0, 2000),
    };
  }

  // kind === 'ref' — เต็มท่อ MEGA
  // ★ 15 ก.ค. 69 แบตช์ 5: แนบคีย์ทีม (server-side env — ไม่รั่วสู่ client) ให้ผ่านด่านตรวจสิทธิ์ src/middleware.js เมื่อเรียกผ่านโฮสต์ (cloud)
  const refHeaders = { 'Content-Type': 'application/json' };
  if (process.env.COVER_TEST_KEY) refHeaders['x-cover-test-key'] = process.env.COVER_TEST_KEY;
  // ★ ชุด① 26 ก.ค. 69: ลิงก์คลิปต้นทาง 1-3 + สวิตช์ไม่ค้นเพิ่ม — ต่อท่อจากประตูกลางไปเต็มท่อ MEGA
  //   sol-review: คงรูป payload เดิมเป๊ะเมื่อไม่ใช้ฟีเจอร์ — แนบ field เฉพาะตอนมีค่าจริงเท่านั้น (ห้ามส่ง [] / false เปล่าๆ)
  const refBody = { newsTitle: job.input.newsTitle || '', content: job.input.content };
  if (Array.isArray(job.input.clipUrls) && job.input.clipUrls.length) refBody.clipUrls = job.input.clipUrls;
  if (job.input.sourceOnly === true) refBody.sourceOnly = true;
  const res = await fetch(`${origin}/api/cover-ref-test`, {
    method: 'POST',
    headers: refHeaders,
    body: JSON.stringify(refBody),
    signal: AbortSignal.timeout(25 * 60 * 1000),
    dispatcher: REF_LONG_AGENT,
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.success) throw Object.assign(new Error(d.error || `HTTP ${res.status}`), { errorType: d.errorType, trace: d.trace });
  // ★ 27 ก.ค. 69 (แก้บั๊ก "รูปปกไม่โชว์"): อ่านจาก src/lib/refTestPipeline.js buildCoverResponseBody จริง —
  //   field ชื่อ `archiveId` (ไม่ใช่ archivedId แบบสาย compose) + `coverPath` เป็นแค่ path ไฟล์ local
  //   (public/mega-covers/reftest-xxx.jpg เขียนบนเครื่องที่รันท่อเท่านั้น) → ใช้ข้ามโฮสต์ไม่ได้เลย
  //   (มือถือเปิดจากคลาวด์ แต่ท่อ ref รันบนเครื่องทีม = รูปหาย 404) ต้องเลือก /api/mega-covers/img?id=
  //   (คลังคลาวด์ ข้ามโฮสต์ได้จริง — แบบเดียวกับสาย compose ที่ใช้ archivedId ถูกอยู่แล้ว) ก่อนเสมอถ้ามี archiveId
  return {
    template: d.template || null,
    score: d.score ?? null,
    refSimilarity: d.refSimilarity ?? null,
    elapsed: d.elapsedTotal || d.elapsed || null,
    archiveId: d.archiveId || null,
    coverImgUrl: d.archiveId ? `/api/mega-covers/img?id=${encodeURIComponent(d.archiveId)}` : (d.coverPath || null),
    refImgUrl: d.matchedRef?.imagePath || null,
    refName: d.matchedRef?.styleName || null,
    imageCaseId: d.imageCaseId || null,
    poolSize: d.poolSize ?? null,
    trace: Array.isArray(d.trace) ? d.trace.map((t) => ({ stage: t.stage, status: t.status })) : [],
    // ★ 27 ก.ค. 69 (นโยบาย "เก็บทุกใบ+ติดป้ายสถานะ"): ป้ายสถานะ + เหตุผลถ้าไม่เข้าคลัง — ให้ progress.step ท้าย runJob() ใช้
    qcStatus: d.qcStatus || null,
    archiveSkipReason: d.archiveSkipReason || null,
    // ★ 27 ก.ค. ค่ำ (เจ้าของอนุมัติ): ท่อ ref (buildCoverResponseBody) ไม่มี slotPlanUsed ให้เก็บ (ไม่ผ่าน compose-test) —
    //   เก็บได้แค่ id ต้นแบบที่ใช้จริง (matchedRef.refId) ให้ "เปลี่ยนตัวเอก/เปลี่ยนต้นแบบ" ยิงต่อได้ (ปุ่ม "เปลี่ยนภาพรายช่อง" จะปิดไว้ที่จอ เพราะไม่มี slotPlanUsed)
    caseId: d.imageCaseId || null,
    refUsed: d.matchedRef?.refId ? { id: d.matchedRef.refId } : null,
  };
}

// ── งานรันเบื้องหลัง + วนซ้ำจนได้ผลจริง ──
//   cloud (sync บน Vercel maxDuration 300) = ลองรอบเดียว → ล้มให้ POST fallback ส่งเครื่องทีม (วนซ้ำได้ไม่จำกัดเวลา)
//   team/local (เครื่องทีมรันยาว) = วนซ้ำ RETRY_MAX รอบ + backoff เพิ่มขึ้น · refresh claimedAt กัน stale-reclaim ระหว่างวน
async function runJob(job, origin) {
  // ★ 27 ก.ค. 69: desk_* ใช้เพดานวนของตัวเอง (2 รอบ) — ดู DESK_RETRY_MAX ด้านบน
  const maxAttempts = job.dispatch === 'cloud' ? 1 : (DESK_KINDS.includes(job.kind) ? DESK_RETRY_MAX : RETRY_MAX);
  const nowIso = () => new Date().toISOString();
  // ★ 29 ก.ค. 69 (Opus fix): stamp ownerBootId/ownerPort ตอนตั้ง running — recoverOrphanJobs (quickTestJobs.js)
  //   ใช้แยกงานของโปรเซสตัวเอง (ยังไม่ตายแน่) ออกจากโปรเซสอื่นที่แชร์ store เดียวกัน (:3000 vs :3900)
  await patchJob(job.id, { status: 'running', startedAt: nowIso(), claimedAt: nowIso(), ownerBootId: getBootId(), ownerPort: process.env.PORT || null, progress: { step: 'กำลังรัน', pct: 5 } });
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // ★ 9 ก.ค.: ผู้ใช้กดลบระหว่างรัน → getJob เจอ null → หยุดทันที ไม่วนต่อ ไม่เขียนผลกลับ (ปุ่มลบใน UI)
    if (!(await getJob(job.id))) return;
    try {
      if (attempt > 1) await patchJob(job.id, { claimedAt: nowIso(), progress: { step: `ลองใหม่รอบ ${attempt}/${maxAttempts}`, pct: 5 } });
      const result = await callOnce(job, origin);
      if (!(await getJob(job.id))) return; // ถูกลบระหว่างรอบนี้ → ไม่เขียน done ทับ
      // ★ 27 ก.ค. 69 (งานไม่โกหก — นโยบาย "เก็บทุกใบ+ติดป้ายสถานะ"): เฉพาะสายปก (compose/ref) มี qcStatus/archiveSkipReason
      //   แนบมา — desk_* ไม่มีฟิลด์นี้เลย ตกไปข้อความเดิม 'เสร็จ' ตามปกติ
      let doneStep = 'เสร็จ';
      if (result && result.archiveSkipReason) {
        doneStep = `เสร็จ แต่ไม่เข้าคลัง: ${String(result.archiveSkipReason).slice(0, 80)}`;
      } else if (result && result.qcStatus === 'manual_review') {
        doneStep = 'เสร็จ (ปกรอตรวจ — ดูในคลัง)';
      }
      await finishJob(job.id, { status: 'done', progress: { step: doneStep, pct: 100 }, result, attempts: attempt, error: null });
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
      // ★ 27 ก.ค. 69 (sol-review วิกฤต 2): kinds ทางเลือก — จำกัดสโคปลบเฉพาะคลาส (array หรือ 'a,b' คั่นจุลภาค)
      //   กันปุ่ม "ล้างคิวค้าง" ของหน้าปก (/quick-cover, /m ทำปก) ไปลบงานโต๊ะข่าวที่ค้างอยู่ด้วยโดยไม่ตั้งใจ
      const allowKinds = Array.isArray(body.kinds)
        ? body.kinds.map((s) => String(s || '').trim()).filter(Boolean)
        : (typeof body.kinds === 'string' && body.kinds
          ? body.kinds.split(',').map((s) => s.trim()).filter(Boolean)
          : null);
      if (body.jobId) {
        await removeJob(String(body.jobId)).catch(() => {});
        return NextResponse.json({ success: true, deleted: 1 });
      }
      if (body.scope === 'active' || body.scope === 'all') {
        const jobs = await listJobs(200);
        let targets = body.scope === 'all' ? jobs : jobs.filter((j) => j.status === 'pending' || j.status === 'running');
        if (allowKinds) targets = targets.filter((j) => allowKinds.includes(j.kind));
        for (const j of targets) await removeJob(j.id).catch(() => {});
        return NextResponse.json({ success: true, deleted: targets.length });
      }
      return badReq('ต้องระบุ jobId หรือ scope=active|all');
    }

    if (body.action === 'run') {
      if (IS_CLOUD) return NextResponse.json({ success: false, error: 'action run ใช้บนเครื่องทีมเท่านั้น', errorType: 'CLOUD_CANNOT_RUN' }, { status: 400 });
      // ★ 27 ก.ค. 69 (sol-review วิกฤต 2): claim แยกช่องตามคลาส (cover/desk) แบบอิสระในรอบเดียวกัน —
      //   งานคลาสหนึ่งกำลังรันยาวอยู่ ไม่กันอีกคลาสถูกหยิบ (เดิม claimTeamJob() ตัวเดียวกันข้ามคลาสหมด รันได้ทีละงานทั้งระบบ)
      const claimedCover = await claimTeamJob(COVER_KINDS);
      if (claimedCover) runJob(claimedCover, origin).catch(() => {});
      const claimedDesk = await claimTeamJob(DESK_KINDS);
      if (claimedDesk) runJob(claimedDesk, origin).catch(() => {});
      const claimed = claimedCover || claimedDesk; // ★ คงชื่อฟิลด์เดิม (worker เก่าอ่าน d.claimed/d.kind เป็นค่าเดี่ยวสำหรับล็อก)
      if (!claimed) return NextResponse.json({ success: true, claimed: null });
      return NextResponse.json({
        success: true, claimed: claimed.id, kind: claimed.kind,
        // ★ เสริมไว้เผื่อใช้ต่อ (ไม่กระทบผู้เรียกเดิมที่อ่านแค่ claimed/kind) — โผล่เฉพาะตอน claim ได้ทั้ง 2 คลาสพร้อมกันจริง
        ...(claimedCover && claimedDesk ? { claimedBoth: [{ id: claimedCover.id, kind: claimedCover.kind }, { id: claimedDesk.id, kind: claimedDesk.kind }] } : {}),
      });
    }

    // ★ 27 ก.ค. 69: +desk_harvest/desk_search/desk_chief (งานเบื้องหลังโต๊ะข่าว — เจ้าของอนุมัติ)
    const VALID_KINDS = new Set(['ref', 'compose', 'desk_harvest', 'desk_search', 'desk_chief']);
    const kind = VALID_KINDS.has(body.kind) ? body.kind : null;
    if (!kind) return badReq('ต้องระบุ kind = compose | ref | desk_harvest | desk_search | desk_chief');

    let input;
    let label;
    if (kind === 'compose') {
      const caseId = String(body.caseId || '').trim();
      if (!caseId) return badReq('ต้องระบุ caseId (เลือกเคส)');
      const heroPersonHint = String(body.heroPersonHint || '').trim();
      input = { caseId, refId: String(body.refId || '').trim() || null, heroPersonHint: heroPersonHint || null };
      label = `⚡ ทางลัด · ${caseId}${heroPersonHint ? ' · ' + heroPersonHint : ''}`;
    } else if (kind === 'desk_harvest') {
      // ★ HARVEST_MODE_KEYS จาก taxonomy มี 'all' รวมอยู่แล้ว (ดู HARVEST_MODES ในไฟล์ต้นทาง)
      const mode = String(body.mode || '').trim();
      if (!HARVEST_MODE_KEYS.includes(mode)) return badReq(`mode ไม่ถูกต้อง: ${mode}`);
      const modeInfo = HARVEST_MODES.find((m) => m.key === mode);
      input = { mode };
      label = `🗞️ ล่าข่าว · ${modeInfo?.label || mode}`;
    } else if (kind === 'desk_search') {
      const keyword = String(body.keyword || '').trim();
      if (keyword.length < 2 || keyword.length > 60) return badReq('คีย์เวิร์ดต้องยาว 2-60 ตัวอักษร');
      input = { keyword };
      label = `🔎 ค้นเอง · ${keyword}`;
    } else if (kind === 'desk_chief') {
      input = {};
      label = '🧠 บก.ใหญ่วินิจฉัย';
    } else {
      const content = String(body.content || '').trim();
      const newsTitle = String(body.newsTitle || '').trim();
      // ★ 15 ก.ค. 69: gate สองชั้นแบบเดียวกับ /api/cover-ref-test — content ≥100 ตัว และ (newsTitle+content ตาม filter(Boolean)) รวม ≥200 ตัว
      if (content.length < 100) return badReq(`เนื้อข่าวเต็มต้อง ≥100 ตัวอักษร (ตอนนี้มี ${content.length} ตัวอักษร — ห้ามเนื้อสั้นตัดทอน)`);
      const combinedLen = [newsTitle, content].filter(Boolean).join('\n\n').length;
      if (combinedLen < 200) return badReq(`เนื้อหารวม (หัวข่าว+เนื้อข่าว) ต้อง ≥200 ตัวอักษร (ตอนนี้มี ${combinedLen} ตัวอักษร — ห้ามเนื้อสั้นตัดทอน)`);
      // ★ ชุด① 26 ก.ค. 69: ลิงก์คลิปต้นทาง 1-3 (รับ array หรือสตริง) + สวิตช์ไม่ค้นเพิ่ม (sourceOnly) — เก็บไว้ใน input ส่งต่อ /api/cover-ref-test
      //   sol-review: คงรูป input เดิมเมื่อไม่ใช้ฟีเจอร์ — ใส่ field เฉพาะมีค่าจริง (ไม่งั้น omit ไปเลย ห้าม [] / false)
      const clipUrlsRaw = Array.isArray(body.clipUrls) ? body.clipUrls : (body.clipUrls != null ? String(body.clipUrls).split(/[\n,]+/) : []);
      const clipUrls = clipUrlsRaw.map((u) => String(u || '').trim()).filter(isValidClipUrl).slice(0, 3);
      const sourceOnly = body.sourceOnly === true;
      input = { newsTitle, content, ...(clipUrls.length ? { clipUrls } : {}), ...(sourceOnly ? { sourceOnly: true } : {}) };
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
    // ★ 27 ก.ค. 69 (sol-review วิกฤต 2): kinds= (คั่นจุลภาค) — กรอง "ก่อน" ตัด limit เพื่อไม่ให้งานคลาสหนึ่ง
    //   หลุดพ้นหน้าต่าง N งานล่าสุดของอีกคลาส (เดิม /api/m/desk ดึง limit=40 มากรอง desk_* เอง — พลาดได้ถ้า
    //   คลาสปกยิงถี่กว่าจนดันงานโต๊ะเกิน 40 ไป) — ผู้เรียกส่ง kinds ตามคลาสของตัวเอง (compose,ref หรือ desk_*)
    const kindsParam = searchParams.get('kinds');
    if (kindsParam) {
      const allow = new Set(kindsParam.split(',').map((s) => s.trim()).filter(Boolean));
      const all = await listJobs(200);
      const jobs = all.filter((j) => allow.has(j.kind)).slice(0, limit);
      return NextResponse.json({ success: true, jobs });
    }
    const jobs = await listJobs(limit);
    return NextResponse.json({ success: true, jobs });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message, errorType: 'UNEXPECTED' }, { status: 500 });
  }
}
