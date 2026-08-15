export const maxDuration = 800; // ~13 min — must match /api/auto/process (pipeline uses 5-12 min)
import { NextResponse } from 'next/server';
import { processAutoFlow } from '@/lib/services/autoFlowService';

export async function POST(request) {
  const startTime = Date.now();
  let _autoWorkflowId = null;

  try {
    const body = await request.json();
    _autoWorkflowId = body.workflowId || ('auto_' + Date.now());

    // ★ 16 ส.ค. 69 (เจ้าของสั่ง "ล็อกเส้นเทสให้ตรงกับทีม แล้วบล็อกอีกเส้นกันพลาด"):
    //   🔴 ประตูนี้เป็นกับดัก — มันเรียก processAutoFlow (สาย URL → summarizeService.js)
    //      แต่ทีมงานจริงทั้งดิสคอร์ดและหน้าเว็บ วิ่ง /api/queue/add → worker → /api/auto/process
    //      ซึ่งคัดแยกเป็น processAutoFlowText (สาย TEXT → summarizeServiceText.js) = คนละไฟล์กัน
    //   บทเรียน 15-16 ส.ค.: เทสทั้งวันยิงเข้าประตูนี้ ผลที่ได้จึงเป็นของอีกสายหนึ่ง ต้องทบทวนข้อสรุปทั้งหมด
    //   ตรวจแล้วไม่มีใครเรียกประตูนี้จริงสักที่ (page.js:356 เป็นแค่ป้ายชื่อในตัวติดตามงาน ไม่ใช่การยิง)
    //   ปลดล็อกชั่วคราว: ALLOW_LEGACY_AUTO=1
    if (process.env.ALLOW_LEGACY_AUTO !== '1') {
      return NextResponse.json({
        success: false,
        error: 'ประตูนี้ถูกปิด — ใช้ /api/auto/process แทน (เส้นเดียวกับที่ทีมใช้จริง: ดิสคอร์ด/หน้าเว็บ → คิว → process → สาย TEXT) · ถ้าจำเป็นจริงๆ ตั้ง ALLOW_LEGACY_AUTO=1',
        errorType: 'LEGACY_AUTO_BLOCKED',
        useInstead: '/api/auto/process',
      }, { status: 410 });
    }

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
