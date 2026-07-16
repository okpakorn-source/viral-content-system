/**
 * ============================================================
 * 🧬 POST /api/desk/dna/synthesize — สังเคราะห์เทียบกลุ่ม DNA (โต๊ะข่าวกลาง v2, เฟส 1 — 16 ก.ค. 69)
 * ============================================================
 * รับก้อนข้อมูลที่ไคลเอนต์เตรียมมาแล้ว (groups.S/groups.A + control) →
 * ส่งเข้า dnaSynthesis.synthesizeRun (AI call เดียว gpt-5.5/gpt-5.4-mini ผ่าน modelConfig) →
 * คืนผลวิเคราะห์ดิบให้ผู้เรียก — endpoint นี้ "ไม่" เขียนลงคลังเอง
 */
import { NextResponse } from 'next/server';
import { synthesizeRun } from '@/lib/services/deskV2/dnaSynthesis.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request) {
  const t0 = Date.now();
  try {
    const body = await request.json().catch(() => null);
    const groups = body?.groups;
    const control = body?.control;

    if (!groups || typeof groups !== 'object' || !groups.S || typeof groups.S !== 'object' || !groups.A || typeof groups.A !== 'object') {
      return NextResponse.json({
        success: false,
        error: 'groups.S และ groups.A ต้องเป็น object',
        errorType: 'VALIDATION_ERROR',
      }, { status: 400 });
    }

    const sExemplars = Array.isArray(groups.S.exemplars) ? groups.S.exemplars.length : 0;
    const aExemplars = Array.isArray(groups.A.exemplars) ? groups.A.exemplars.length : 0;
    if (sExemplars + aExemplars < 3) {
      return NextResponse.json({
        success: false,
        error: 'exemplars รวมกันต้องมีอย่างน้อย 3 ใบ (S+A)',
        errorType: 'VALIDATION_ERROR',
      }, { status: 400 });
    }

    const modelKey = body?.model === 'fast' ? 'fast' : 'primary'; // 🔴 รับแค่ 2 ค่านี้เท่านั้น กันชื่อโมเดลดิบ
    const runId = String(body?.runId || '').slice(0, 40);

    const { synthesis, model, tookMs } = await synthesizeRun({ groups, control, runId, modelKey });

    return NextResponse.json({
      success: true,
      synthesis,
      model,
      tookMs,
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err?.message || 'สังเคราะห์เทียบกลุ่ม DNA ล้มเหลว',
      errorType: 'DNA_SYNTHESIZE_ERROR',
      tookMs: Date.now() - t0,
    }, { status: 500 });
  }
}
