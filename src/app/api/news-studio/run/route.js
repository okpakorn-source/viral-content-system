/**
 * POST /api/news-studio/run — สั่งเขียนข่าว 1 งานด้วยท่อเขียนตัวใหม่ (ส่งความคืบหน้าจริงกลับทีละบรรทัด)
 * body: { rawText: string, useResearch?: boolean }
 * ตอบ: application/x-ndjson — บรรทัดละ 1 เหตุการณ์
 *   {type:'start', runId, saved}  {type:'progress', step, status, detail, ms}  {type:'warning', code, message}
 *   {type:'result', run}  {type:'error', error, errorType, runId?}  {type:'heartbeat'}
 * หน้าจอหลุดกลางทาง: งานยังเดินต่อจนจบและถูกเก็บลงคลังประวัติ — เปิดดูได้จาก GET /api/news-studio/runs/<runId>
 */
import { after } from 'next/server';
import { runStudioJob, assertStudioQuota } from '@/lib/services/newsStudio/server';
import { NEWS_STUDIO } from '@/lib/services/newsStudio/pipeline';
import { studioSession, canWrite, unauthorized, forbidden, errorJson, serviceError } from '@/lib/services/newsStudio/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const HEARTBEAT_MS = 10000;

export async function POST(request) {
  try {
    const session = await studioSession();
    if (!session) return unauthorized();
    if (!canWrite(session)) return forbidden();

    let body;
    try { body = await request.json(); } catch { return errorJson('คำขอไม่ใช่ JSON ที่อ่านได้', 'INVALID_REQUEST_BODY', 400); }
    const rawText = String(body?.rawText ?? '').replace(/\r\n/g, '\n').trim();
    if (rawText.length < NEWS_STUDIO.minRawChars) return errorJson(`เนื้อข่าวสั้นเกินไป (${rawText.length} ตัวอักษร) — ต้องมีอย่างน้อย ${NEWS_STUDIO.minRawChars} ตัวอักษร`, 'RAW_TEXT_TOO_SHORT', 400);
    if (rawText.length > NEWS_STUDIO.maxRawChars) return errorJson(`เนื้อข่าวยาวเกินไป (${rawText.length} ตัวอักษร) — รับได้ไม่เกิน ${NEWS_STUDIO.maxRawChars} ตัวอักษร`, 'RAW_TEXT_TOO_LONG', 400);

    const encoder = new TextEncoder();
    let controllerRef = null;
    let open = true;
    const waiting = []; // เหตุการณ์ที่เกิดก่อนสตรีมเปิด (งานเริ่มเดินก่อนคืน response) — เก็บไว้ส่งทันทีที่เปิด ไม่ทิ้ง
    const send = (obj) => {
      if (!open) return;
      if (!controllerRef) { waiting.push(obj); return; }
      try { controllerRef.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch { open = false; }
    };

    // เริ่มงานก่อนคืน response: ถ้างานพร้อมกันเต็ม ให้ตอบ 429 เป็น JSON ปกติ (ไม่ใช่สตรีมที่มีแต่ error)
    let job;
    try {
      // ด่านโควตา + งานพร้อมกันทั้งระบบ (นับจากคลังประวัติ) — ไม่ผ่าน = ตอบ 429 เป็น JSON ก่อนเปิดสตรีม
      const { runs } = await assertStudioQuota(session);
      job = runStudioJob({ rawText, useResearch: body?.useResearch === true, user: session, onEvent: send, snapshot: runs });
      // runStudioJob โยนทันทีเฉพาะตอนงานเต็ม — รอ 1 จังหวะเพื่อจับเหตุนั้นก่อนเปิดสตรีม
      await Promise.race([job, new Promise((resolve) => setTimeout(resolve, 0))]);
    } catch (e) {
      return serviceError(e, 'NEWS_STUDIO_FAILED');
    }
    // หน้าจอหลุด/ปิดแท็บ: ให้งานเดินต่อจนเก็บลงคลังประวัติ
    after(() => job.catch(() => {}));

    const stream = new ReadableStream({
      start(controller) {
        controllerRef = controller;
        // Safari รอครบ 1024 ไบต์ก่อนเริ่มส่งให้หน้าเว็บ — เติมช่องว่างในบรรทัดแรกให้ความคืบหน้าขึ้นทันที
        send({ type: 'open', pad: ' '.repeat(1024) });
        for (const e of waiting.splice(0)) send(e);
        const beat = setInterval(() => send({ type: 'heartbeat' }), HEARTBEAT_MS);
        job
          .catch((e) => send({ type: 'error', error: String(e?.message || e).slice(0, 400), errorType: e?.errorType || 'NEWS_STUDIO_FAILED' }))
          .finally(() => {
            clearInterval(beat);
            if (open) { open = false; try { controller.close(); } catch { /* ปิดไปแล้ว */ } }
          });
      },
      cancel() { open = false; },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    return serviceError(e, 'NEWS_STUDIO_FAILED');
  }
}
