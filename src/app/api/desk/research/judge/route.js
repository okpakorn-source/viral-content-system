/**
 * ============================================================
 * 🚦 POST /api/desk/research/judge — ด่านคัดกรองผลค้น + AI ตัดสิน (โต๊ะข่าวกลาง v2, R2 เฟส 2.0 — 16 ก.ค. 69)
 * ============================================================
 * รับ candidates ดิบจากเครื่องยิงค้น (ทีมอื่นสร้างขนานอยู่ — ไฟล์นี้ไม่รู้จักเขา) + clusterId
 * → ส่งเข้า researchJudge.judgeCandidates (ด่านกติกาห้าม → กันซ้ำ → AI judge → post-process)
 * → คืนใบที่ผ่านพร้อม matchScore + ลายนิ้วมือเหตุการณ์ ให้ผู้เรียกไปตัดสินใจต่อ (endpoint นี้ไม่เขียนลง store ใดๆ)
 */
import { NextResponse } from 'next/server';
import { judgeCandidates } from '@/lib/services/deskV2/researchJudge.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request) {
  const t0 = Date.now();
  try {
    const body = await request.json().catch(() => null);
    const candidates = body?.candidates;
    const clusterId = body?.clusterId;

    if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 24) {
      return NextResponse.json({
        success: false,
        error: 'candidates ต้องเป็น array ความยาว 1-24',
        errorType: 'VALIDATION_ERROR',
      }, { status: 400 });
    }
    if (!clusterId) {
      return NextResponse.json({
        success: false,
        error: 'ต้องระบุ clusterId',
        errorType: 'VALIDATION_ERROR',
      }, { status: 400 });
    }

    const modelKey = body?.model === 'primary' ? 'primary' : 'fast'; // 🔴 รับแค่ 2 ค่านี้เท่านั้น กันชื่อโมเดลดิบ

    const result = await judgeCandidates({ candidates, clusterId, modelKey });

    return NextResponse.json({
      success: true,
      ...result,
      tookMs: Date.now() - t0,
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err?.message || 'คัดกรองผลค้นล้มเหลว',
      errorType: 'RESEARCH_JUDGE_ERROR',
    }, { status: 500 });
  }
}
