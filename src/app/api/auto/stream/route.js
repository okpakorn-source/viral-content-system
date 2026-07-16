// @deprecated This route is currently unused by the client UI.
// It provides streaming NDJSON output from processAutoFlow.
// TODO: Connect to UI or remove in next cleanup.
export const maxDuration = 300; // Allow 5 minutes for heavy LLM operations
import { processAutoFlow } from '@/lib/services/autoFlowService';
import { detectInputType } from '@/lib/input-engine/detector';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (parseError) {
    return new Response(
      JSON.stringify({ type: 'error', error: 'Invalid JSON in request body', errorType: 'INVALID_REQUEST_BODY' }) + '\n',
      { status: 400, headers: { 'Content-Type': 'application/x-ndjson' } }
    );
  }
  // ★ 16 ก.ค. 69: TEXT-ONLY MODE — ปิดสาย URL (route นี้ deprecated แต่ยังเรียกได้ จึงต้องมีด่านเดียวกัน)
  if (process.env.TEXT_ONLY_MODE !== '0' &&
      (body.url || /https?:\/\//i.test(String(body.input || body.text || '')))) {
    return new Response(
      JSON.stringify({ type: 'error', error: 'โหมดข้อความเท่านั้น: ระบบปิดรับการเจนข่าวจากลิงก์ชั่วคราว', errorType: 'TEXT_ONLY_MODE' }) + '\n',
      { status: 400, headers: { 'Content-Type': 'application/x-ndjson' } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Send a heartbeat every 15 seconds to prevent Vercel from closing the connection
      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'heartbeat' }) + '\n'));
        } catch (e) {
          clearInterval(interval);
        }
      }, 15000);

      try {
        if (body.input && !body.url && !body.text) {
          const detection = detectInputType(body.input, body.images || []);
          body.url = detection.primaryUrl || null;
          body.text = detection.textContent || body.input;
        }
        const _autoWorkflowId = body.workflowId || ('auto_' + Date.now());
        const result = await processAutoFlow({
          ...body,
          workflowId: _autoWorkflowId,
          onProgress: (logEntry) => {
            try {
              controller.enqueue(encoder.encode(JSON.stringify({ type: 'log', data: logEntry }) + '\n'));
            } catch (e) {}
          }
        });

        clearInterval(interval);
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'result', data: result }) + '\n'));
        controller.close();
      } catch (error) {
        console.error('[Auto Stream API Error]:', error.message);
        clearInterval(interval);
        controller.enqueue(encoder.encode(JSON.stringify({
          type: 'error',
          error: error.message,
          failedStep: error.failedStep || 'unknown_step'
        }) + '\n'));
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  });
}
