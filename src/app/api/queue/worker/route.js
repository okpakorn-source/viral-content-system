import { NextResponse } from 'next/server';
import { getNextPendingJobs, updateJobStatus, cleanupStaleJobs } from '@/lib/services/queueService';
import { createLogger } from '@/lib/logger';

const logger = createLogger('QUEUE_WORKER');

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
    
    const baseUrl = req.nextUrl.origin;
    
    // 3. Process jobs ONE AT A TIME (sequential, not concurrent)
    for (const job of jobs) {
      try {
        // ★ Routing ตามชนิดงาน: cover → auto-cover | mineclip → ขุดนาทีทอง | อื่นๆ → /api/auto/process
        const isCoverJob = job.payload?.jobType === 'cover';
        const isMineClipJob = job.payload?.jobType === 'mineclip';
        // 🏭 8 ก.ค.: auto-cover-v3 ถอดทิ้ง (ผู้ใช้สั่ง) — งานปก MEGA (composer:'mega') → โรงประกอบใหม่ · อื่นๆ → โรงเดิม v1
        const coverPath = job.payload?.composer === 'mega' ? '/api/mega/compose' : '/api/auto-cover';
        const processUrl = isCoverJob ? `${baseUrl}${coverPath}`
          : isMineClipJob ? `${baseUrl}/api/news-desk/mine-clip`
          : `${baseUrl}/api/auto/process`;
        logger.info(`[Queue Worker] ▶️ Starting ${isCoverJob ? 'cover ' : ''}job ${job.id.slice(0, 8)}`);

        // AbortController: pipeline ใช้เวลา >12min — timeout ต้องมากกว่านั้น
        // maxDuration=800 → ใช้ 900s (15 min) เป็น safety margin
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 900_000); // 900s = 15 min

        const res = await fetch(processUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ ...job.payload, _queueJobId: job.id }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        
        // Guard: ถ้า HTTP error ให้ throw เข้า catch block เพื่อ mark failed
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          throw new Error(`process API failed: ${res.status} — ${errText.substring(0, 200)}`);
        }

        // ★ 26 มิ.ย.: route อาจคืนหน้า HTML (timeout/crash ระดับ platform) แทน JSON
        //   เดิม res.json() พังเป็น "Unexpected token '<'" → job.error เก็บข้อความดิบ → โชว์ให้ผู้ใช้
        //   parse แบบปลอดภัย: ถ้าได้ HTML แปลงเป็นข้อความสะอาดอ่านออก
        let data;
        {
          const rawText = await res.text();
          try {
            data = JSON.parse(rawText);
          } catch {
            const looksHtml = /<!DOCTYPE|<html|FUNCTION_INVOCATION|error occurred|deadline|timed? ?out/i.test(rawText);
            throw new Error(looksHtml
              ? 'เซิร์ฟเวอร์ทำปกใช้เวลานานเกิน/ขัดข้องชั่วคราว — ลองสร้างปกใหม่อีกครั้ง (ถ้าใส่ลิงก์แหล่งรูปเป็นคลิป FB/วิดีโอ ลองเอาออกก่อน)'
              : `เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ (${res.status}) — ลองใหม่อีกครั้ง`);
          }
        }

        // ★ Cover ที่ render สำเร็จแต่ติด save-gate (success:false + base64) ก็นับเป็น completed
        //   — เก็บ result เต็มให้ client ตัดสินใจแสดง warning เอง (เทียบเท่า sync path ที่ได้ JSON เต็ม)
        if (res.ok && (data.success || (isCoverJob && data.base64))) {
          await updateJobStatus(job.id, 'completed', {
            result: data,
            completedAt: new Date().toISOString()
          });
          logger.info(`[Queue Worker] ✅ Job ${job.id.slice(0, 8)} completed successfully.`);
        } else {
          await updateJobStatus(job.id, 'failed', {
            error: data.error || data.manualReviewReason || 'Unknown API Error',
            completedAt: new Date().toISOString()
          });
          logger.error(`[Queue Worker] ❌ Job ${job.id.slice(0, 8)} failed: ${data.error}`);
        }
      } catch (err) {
        // ★ FIX (11 มิ.ย.): cover job >5 นาทีโดน undici headersTimeout ("fetch failed") ทั้งที่ pipeline ยังวิ่งจนจบ
        //   → อย่า mark failed; route จะ self-report สถานะเอง (มี cleanupStaleJobs เป็น safety net ถ้าค้างจริง)
        const isTimeoutish = /fetch failed|UND_ERR|HeadersTimeout|aborted|timeout/i.test(err.message || '');
        const isCoverJob2 = job.payload?.jobType === 'cover';
        if (isCoverJob2 && isTimeoutish) {
          logger.info(`[Queue Worker] ⏳ Cover job ${job.id.slice(0, 8)} fetch died (${err.message?.slice(0, 50)}) — pipeline ยังวิ่งต่อ รอ self-report จาก route`);
        } else {
          await updateJobStatus(job.id, 'failed', {
            error: err.message,
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
