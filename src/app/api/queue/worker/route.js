import { NextResponse } from 'next/server';
import { Agent } from 'undici';
import { getNextPendingJobs, updateJobStatus, cleanupStaleJobs } from '@/lib/services/queueService';
import { createLogger } from '@/lib/logger';
import { resolveNewsQueueTiming } from '@/lib/utils/pipelineDeadline';

const logger = createLogger('QUEUE_WORKER');

// ★ 15 ส.ค. 69 (Sol + Fable ตรวจตรงกัน · เจ้าของสั่งแก้): "fetch failed" ปลอมของงานข่าว
//   ต้นตอ: fetch ที่ไม่ส่ง dispatcher โดน undici headersTimeout ค่าโรงงาน 300 วิ ตัดเอง —
//   AbortSignal 900 วิ คุมไม่ถึงชั้นนี้ · ข่าวจริงวันนี้ p90 = 279 วิ (เกิน 300 แล้ว 1 เคส = ตัวที่ล้มพอดี)
//   → งานเขียนเสร็จ+เข้าคลังจริง แต่ worker ตีตรา failed ทีมเห็น ❌ แล้วส่งซ้ำ = เจนซ้ำเปลืองเงิน
//   แพตเทิร์นเดียวกับที่ระบบเคยแก้โรคนี้ที่ quick-test/route.js:16,75 (REF_LONG_AGENT)
//   ⚠️ ใช้เฉพาะ "งานข่าว" — ปก/mineclip คงเส้นเดิมทุกไบต์ (มี self-report + เส้นผ่อนผันของตัวเอง)
//   ถอยกลับ: QUEUE_FETCH_LONG_AGENT=0 (กลับพฤติกรรมเดิมทันที) · ปรับเพดาน: QUEUE_NEWS_DEADLINE_MS
const {
  workerDeadlineMs: NEWS_DEADLINE_MS,
  pipelineBudgetMs: NEWS_PIPELINE_BUDGET_MS,
} = resolveNewsQueueTiming(process.env.QUEUE_NEWS_DEADLINE_MS);
let _newsAgent = null;
function getNewsAgent() {
  if (process.env.QUEUE_FETCH_LONG_AGENT === '0') return undefined; // สวิตช์ถอย = ไม่ส่ง dispatcher (พฤติกรรมเดิม)
  if (!_newsAgent) {
    _newsAgent = new Agent({
      connectTimeout: 30_000,          // ต่อไม่ติดให้รู้เร็ว (Sol)
      headersTimeout: NEWS_DEADLINE_MS + 20_000, // สูงกว่า deadline ของแอป แต่ยังต่ำกว่า maxDuration 800s
      bodyTimeout: NEWS_DEADLINE_MS + 20_000,
    });
  }
  return _newsAgent;
}

function classifyQueueFetchFailure(error) {
  const causeCode = String(error?.cause?.code || error?.code || '').toUpperCase();
  const definitelyNotStarted = /^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|UND_ERR_CONNECT_TIMEOUT|ERR_INVALID_URL)$/.test(causeCode);
  // เฉพาะ error ที่เกิดจาก fetch/อ่าน response จริงเท่านั้นที่อาจหมายถึง route ยังทำต่ออยู่
  // API ตอบ error ที่มีคำว่า timeout ต้องไม่ถูก rescue เพราะ route จบและรายงานผลแล้ว
  const routeMayStillBeRunning = error?.queueFetchOrigin === true && !definitelyNotStarted;
  return { causeCode, definitelyNotStarted, routeMayStillBeRunning };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 800; // ~13 min server limit (pipeline >12min + buffer)

// ★ Vercel Cron (ทุก 1 นาที — vercel.json) เรียกด้วย GET → ใช้ logic เดียวกับ POST
//   ชั้นกันสุดท้ายของเคส "สั่งงานผ่าน Discord แล้วปิดทุกอย่าง" บนโปรดักชัน
export async function GET(req) {
  return POST(req);
}

export async function POST(req) {
  try {
    // 1. Verify API Key — allow same-origin web triggers without auth
    const apiKeyHeader = req.headers.get('x-api-key') || '';
    const expectedKey = process.env.API_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-key';
    const discordKey = process.env.DISCORD_API_SECRET;
    
    if (apiKeyHeader) {
      const isAuthorized = 
        apiKeyHeader === expectedKey || 
        (discordKey && apiKeyHeader === discordKey);
      
      if (!isAuthorized) {
        return NextResponse.json({ success: false, error: 'Unauthorized', errorType: 'UNAUTHORIZED' }, { status: 401 });
      }
    }
    // No auth header = same-origin trigger (web client or server self-call) = allowed
    
    // 1.5. Cleanup stale jobs first (stuck > 6 minutes)
    const cleaned = await cleanupStaleJobs(15).catch(() => 0);
    if (cleaned > 0) {
      logger.info(`[Queue Worker] 🧹 Cleaned ${cleaned} stale jobs`);
    }
    
    // 2. Fetch next pending job (1 at a time — true queue behavior)
    //    getNextPendingJobs already marks them as 'processing' atomically
    const jobs = await getNextPendingJobs(1);
    
    if (!jobs || jobs.length === 0) {
      return NextResponse.json({ success: true, message: 'No pending jobs or concurrency limit reached' });
    }
    
    logger.info(`[Queue Worker] 🔄 Processing ${jobs.length} job(s): ${jobs.map(j => j.id.slice(0, 8)).join(', ')}`);
    
    // ★ 10 ก.ค. 69: Vercel Cron เรียก worker ผ่าน "deployment URL" (มี Vercel Authentication ขวาง)
    //   → self-fetch ไป /api/auto/process เจอหน้า SSO = 401 ทั้งที่โค้ดปกติ (เกิดจริง 3 งาน 14:02-14:08)
    //   แก้: origin เป็น *.vercel.app (deployment URL) → สลับไปโดเมน production ที่เปิด public
    //   ⚠️ ห้ามตัดสินจาก env VERCEL/VERCEL_URL — เครื่องทีมมีค่าค้างจาก `vercel env pull` (กับดักที่รู้กัน)
    let baseUrl = req.nextUrl.origin;
    const prodHost = process.env.QUEUE_SELF_BASE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
    if (prodHost && baseUrl.endsWith('.vercel.app') && !baseUrl.includes(prodHost.replace(/^https?:\/\//, ''))) {
      baseUrl = prodHost.startsWith('http') ? prodHost : `https://${prodHost}`;
      logger.info(`[Queue Worker] 🔀 origin เป็น deployment URL — สลับไป production: ${baseUrl}`);
    }
    
    // 3. Process jobs ONE AT A TIME (sequential, not concurrent)
    for (const job of jobs) {
      const isCoverJob = job.payload?.jobType === 'cover';
      const isMineClipJob = job.payload?.jobType === 'mineclip';
      const _isNewsJob = !isCoverJob && !isMineClipJob;
      const updateOwnedJob = async (status, extra) => {
        if (!_isNewsJob) return updateJobStatus(job.id, status, extra);
        try {
          return await updateJobStatus(job.id, status, extra, { expectedAttemptId: job.attemptId });
        } catch (statusError) {
          if (statusError?.code === 'STALE_QUEUE_ATTEMPT'
              || statusError?.errorType === 'STALE_QUEUE_ATTEMPT') {
            logger.info(`[Queue Worker] ⏭️ Job ${job.id.slice(0, 8)} เปลี่ยนรอบหรือ route รายงานผลแล้ว — ไม่เขียนทับ`);
            return null;
          }
          throw statusError;
        }
      };
      try {
        // ★ Routing ตามชนิดงาน: cover → auto-cover | mineclip → ขุดนาทีทอง | อื่นๆ → /api/auto/process
        // 🏭 8 ก.ค.: auto-cover-v3 ถอดทิ้ง (ผู้ใช้สั่ง) — งานปก MEGA (composer:'mega') → โรงประกอบใหม่ · อื่นๆ → โรงเดิม v1
        const coverPath = job.payload?.composer === 'mega' ? '/api/mega/compose' : '/api/auto-cover';
        const processUrl = isCoverJob ? `${baseUrl}${coverPath}`
          : isMineClipJob ? `${baseUrl}/api/news-desk/mine-clip`
          : `${baseUrl}/api/auto/process`;
        logger.info(`[Queue Worker] ▶️ Starting ${isCoverJob ? 'cover ' : ''}job ${job.id.slice(0, 8)}`);

        // AbortController: pipeline ใช้เวลา >12min — timeout ต้องมากกว่านั้น
        // ★ 15 ส.ค. 69: งานข่าวใช้ deadline 770s (ต่ำกว่า maxDuration 800 — ของเดิม 900s ไม่มีวันได้ใช้จริง)
        //   ปก/mineclip คงของเดิม 900s ทุกไบต์ · ของเดิม: setTimeout(() => controller.abort(), 900_000)
        const controller = new AbortController();
        const workerFetchStartedAt = Date.now();
        const timeout = setTimeout(() => controller.abort(), _isNewsJob ? NEWS_DEADLINE_MS : 900_000);

        let res;
        try {
          res = await fetch(processUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(_isNewsJob ? {
                'x-news-pipeline-deadline-at': String(workerFetchStartedAt + NEWS_PIPELINE_BUDGET_MS),
              } : {}),
              // ชั้นกันที่สอง: ถ้าตั้ง bypass secret ไว้ใน Vercel จะทะลุ Deployment Protection ได้เสมอ (ไม่ตั้ง = header ไม่ถูกส่ง)
              ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}),
            },
            body: JSON.stringify({ ...job.payload, _queueJobId: job.id, _queueAttemptId: job.attemptId }),
            signal: controller.signal,
            // ★ dispatcher เฉพาะงานข่าว — ยกเพดาน transport ที่ AbortSignal คุมไม่ถึง (ปก/mineclip ไม่ส่ง = เส้นเดิม)
            ...(_isNewsJob && getNewsAgent() ? { dispatcher: getNewsAgent() } : {}),
          });
        } catch (fetchErr) {
          // ★ Sol: log ให้ชี้ตัวได้ทันทีว่าเป็นเพดาน transport หรือ deadline ของแอป (ห้าม log payload/secret)
          logger.warn(`[Queue Worker] fetch ล้ม job=${job.id.slice(0, 8)} type=${job.payload?.jobType || 'news'} name=${fetchErr?.name} code=${fetchErr?.cause?.code || '-'}`);
          fetchErr.queueFetchOrigin = true;
          throw fetchErr;
        } finally {
          // ★ Sol: ย้าย clearTimeout มา finally — เดิมถ้า fetch โยน error timer ค้าง
          clearTimeout(timeout);
        }

        // ★ 26 มิ.ย.: route อาจคืนหน้า HTML (timeout/crash ระดับ platform) แทน JSON
        //   เดิม res.json() พังเป็น "Unexpected token '<'" → job.error เก็บข้อความดิบ → โชว์ให้ผู้ใช้
        //   parse แบบปลอดภัย: ถ้าได้ HTML แปลงเป็นข้อความสะอาดอ่านออก
        let data;
        let rawText;
        try {
          rawText = await res.text();
        } catch (bodyReadError) {
          bodyReadError.queueFetchOrigin = true;
          throw bodyReadError;
        }
        try {
          data = JSON.parse(rawText);
        } catch {
          const looksHtml = /<!DOCTYPE|<html|FUNCTION_INVOCATION|error occurred|deadline|timed? ?out/i.test(rawText);
          throw new Error(looksHtml
            ? 'เซิร์ฟเวอร์ทำปกใช้เวลานานเกิน/ขัดข้องชั่วคราว — ลองสร้างปกใหม่อีกครั้ง (ถ้าใส่ลิงก์แหล่งรูปเป็นคลิป FB/วิดีโอ ลองเอาออกก่อน)'
            : `เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ (${res.status}) — ลองใหม่อีกครั้ง`);
        }

        if (!res.ok) {
          const apiError = new Error(data?.error || `process API failed: ${res.status}`);
          apiError.errorType = data?.errorType || 'PROCESS_API_FAILED';
          apiError.failedStep = data?.failedStep || 'queue_process';
          throw apiError;
        }

        // ★ Cover ที่ render สำเร็จแต่ติด save-gate (success:false + base64) ก็นับเป็น completed
        //   — เก็บ result เต็มให้ client ตัดสินใจแสดง warning เอง (เทียบเท่า sync path ที่ได้ JSON เต็ม)
        if (res.ok && (data.success || (isCoverJob && data.base64))) {
          await updateOwnedJob('completed', {
            result: data,
            completedAt: new Date().toISOString()
          });
          logger.info(`[Queue Worker] ✅ Job ${job.id.slice(0, 8)} completed successfully.`);
        } else {
          await updateOwnedJob('failed', {
            error: data.error || data.manualReviewReason || 'Unknown API Error',
            errorType: data.errorType || 'PROCESS_API_FAILED',
            failedStep: data.failedStep || 'queue_process',
            completedAt: new Date().toISOString()
          });
          logger.error(`[Queue Worker] ❌ Job ${job.id.slice(0, 8)} failed: ${data.error}`);
        }
      } catch (err) {
        // ★ FIX (11 มิ.ย.): cover job >5 นาทีโดน undici headersTimeout ("fetch failed") ทั้งที่ pipeline ยังวิ่งจนจบ
        //   → อย่า mark failed; route จะ self-report สถานะเอง (มี cleanupStaleJobs เป็น safety net ถ้าค้างจริง)
        // ★ 16 ส.ค. 69 (เจ้าของสั่ง): ถอดเงื่อนไข "เฉพาะงานปก" ออก — ให้ตาข่ายนี้ครอบงานข่าวด้วย
        //   ปัญหาเดิม: ตาข่ายเขียนไว้ตั้งแต่ 11 มิ.ย. ตอนที่มีแต่งานปกยาวเกิน 5 นาที
        //   พองานข่าวยาวขึ้น (เพดานตอนนี้ 770 วิ) ข่าวที่เขียนเสร็จ+บันทึกคลังแล้ว
        //   แต่ชั้นเชื่อมต่อตายก่อน กลับถูกตีตรา ❌ → ทีมเห็นล้มแล้วส่งซ้ำ = จ่ายซ้ำ + ข่าวซ้ำในคลัง
        //   ทุกงานที่ตายด้วยอาการ timeout จะรอ route รายงานสถานะเอง (มี cleanupStaleJobs กันค้างอยู่แล้ว)
        //   ถอยกลับพฤติกรรมเดิม (กู้เฉพาะงานปก): QUEUE_TIMEOUT_RESCUE=cover-only
        // Rescue ได้เฉพาะอาการที่ request อาจถึง route แล้วและ route ยังทำงานต่ออยู่จริง
        // generic "fetch failed" หรือ connect/DNS failure ห้าม rescue เพราะไม่มี route ใดมารายงานผลภายหลัง
        const { definitelyNotStarted, routeMayStillBeRunning } = classifyQueueFetchFailure(err);
        const _rescueMode = String(process.env.QUEUE_TIMEOUT_RESCUE || '').trim().toLowerCase().replace(/^["']|["']$/g, '');
        const _rescueOn = _rescueMode === 'cover-only'
          ? job.payload?.jobType === 'cover'
          : _rescueMode !== 'off';
        if (_rescueOn && routeMayStillBeRunning) {
          logger.info(`[Queue Worker] ⏳ Job ${job.id.slice(0, 8)} (${job.payload?.jobType || 'news'}) fetch died (${err.message?.slice(0, 50)}) — pipeline ยังวิ่งต่อ รอ self-report จาก route`);
        } else {
          await updateOwnedJob('failed', {
            error: err.message,
            errorType: err.errorType || (definitelyNotStarted ? 'QUEUE_UPSTREAM_UNREACHABLE' : 'QUEUE_WORKER_ERROR'),
            failedStep: err.failedStep || (definitelyNotStarted ? 'queue_connect' : 'queue_worker'),
            completedAt: new Date().toISOString()
          });
          logger.error(`[Queue Worker] ❌ Job ${job.id.slice(0, 8)} threw error: ${err.message}`);
        }
      }
    }
    
    // 4. งานถัดไป: ★ 24 มิ.ย. (ทางเลือก A — ผู้ใช้เลือก) ตัด self-fetch worker→worker ออก
    //    เดิม triggerNext() ยิง /api/queue/worker หาตัวเอง → บน Vercel งานปกยาว worker หลายตัว
    //    (triggerNext + cron ทุกนาที + status self-heal) วนยิงกัน → Vercel ตรวจเป็น loop → 508 INFINITE_LOOP
    //    ตอนนี้พึ่ง 2 ตาข่ายที่ไม่วน: (1) Vercel cron /api/queue/worker ทุก 1 นาที (vercel.json)
    //    (2) status route self-heal ยิง worker เมื่อ pending>0 && processing===0 (ผู้ใช้/บอท poll ทุก 3 วิ)
    //    → งานข่าว/ปกถัดไปยังถูกหยิบเสมอ (ช้าสุด ~1 นาที) แต่ไม่เกิด loop อีก · ไม่แตะตรรกะเจนข่าว
    return NextResponse.json({ success: true, processed: jobs.length });
    
  } catch (error) {
    logger.error(`[Queue Worker Error] ${error.message}`);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
