export const maxDuration = 800; // ~13 min — must match /api/auto/process (pipeline uses 5-12 min)
import { NextResponse } from 'next/server';
import { processAutoFlow } from '@/lib/services/autoFlowService';

export async function POST(request) {
  const startTime = Date.now();
  let _autoWorkflowId = null;

  try {
    const body = await request.json();
    _autoWorkflowId = body.workflowId || ('auto_' + Date.now());

    // ★ 16 ก.ค. 69: TEXT-ONLY MODE — ปิดสาย URL (ด่านหลักอยู่ /api/queue/add · เปิดคืน: TEXT_ONLY_MODE=0)
    if (process.env.TEXT_ONLY_MODE !== '0' &&
        (body.url || /https?:\/\//i.test(String(body.input || body.text || '')))) {
      return NextResponse.json({
        success: false,
        error: 'โหมดข้อความเท่านั้น: ระบบปิดรับการเจนข่าวจากลิงก์ชั่วคราว — กรุณาสรุปเนื้อข่าวเป็นข้อความล้วน (ไม่มีลิงก์) แล้วส่งใหม่',
        errorType: 'TEXT_ONLY_MODE',
        failedStep: 'text_only_gate',
      }, { status: 400 });
    }

    const result = await processAutoFlow({
      ...body,
      workflowId: _autoWorkflowId,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Auto API Endpoint] Error:', error.message);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    return NextResponse.json({
      success: false,
      error: error.message,
      failedStep: error.failedStep || 'unknown_step',
      totalTimeSeconds: parseFloat(elapsed),
    }, { status: 500 });
  }
}
