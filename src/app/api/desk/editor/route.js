/**
 * ============================================================
 * 🧠 /api/desk/editor — สมอง บก. AI (โต๊ะข่าวกลาง v2, เฟส 2 — E1, 17 ก.ค. 69)
 * ============================================================
 * GET  → สถานะ บก. (ศึกษาแล้วหรือยัง/ทิศทาง top5/เวลาคัดล่าสุด) + รอบคัดข่าวล่าสุดแบบเต็ม
 * POST {action:'study', model?, maxExemplars?}                → บก. อ่านคลัง DNA + กลั่นเป็นธรรมนูญถาวร (งานยาว)
 * POST {action:'pick',  model?, limit?, autoSend?}             → คัดลีดข่าวตามธรรมนูญ + ด่านกันเชิงลบ + (ออปชัน) ส่งเจน
 * ห้ามแตะ contract ของ dnaContract.js/dnaSynthesis.js/dnaResearch.js/researchLeads.js/researchExtract.js —
 * ยิงผ่าน editorBrain.js เท่านั้น
 */
import { NextResponse } from 'next/server';
import { studyDna, editorPick, getBrainStatus, getLatestPickRun } from '@/lib/services/deskV2/editorBrain.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600; // studyDna อ่านคลังทั้งหมด + เรียก AI หลายก้อน (200s/call) — งานยาว

export async function GET() {
  try {
    const [status, lastRun] = await Promise.all([getBrainStatus(), getLatestPickRun()]);
    return NextResponse.json({ success: true, status, lastRun });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err?.message || 'อ่านสถานะ บก. ล้มเหลว',
      errorType: 'EDITOR_ERROR',
    }, { status: 500 });
  }
}

export async function POST(request) {
  const t0 = Date.now();
  try {
    const body = await request.json().catch(() => null);
    const action = body?.action;
    const modelKey = body?.model === 'fast' ? 'fast' : 'primary'; // 🔴 รับแค่ 2 ค่านี้เท่านั้น กันชื่อโมเดลดิบ

    if (action === 'study') {
      const maxExemplarsRaw = Number(body?.maxExemplars);
      const maxExemplars = Number.isFinite(maxExemplarsRaw) && maxExemplarsRaw > 0
        ? Math.floor(maxExemplarsRaw)
        : undefined; // ไม่ระบุ = อ่านทั้งคลัง (พฤติกรรมจริงของ production)

      const result = await studyDna({ modelKey, maxExemplars });
      return NextResponse.json({ success: true, ...result });
    }

    if (action === 'pick') {
      const limit = Math.max(1, Math.min(10, Number(body?.limit) || 5));
      const autoSend = !!body?.autoSend;
      const origin = request.nextUrl.origin;

      const result = await editorPick({ limit, autoSend, origin, modelKey });
      return NextResponse.json({ success: true, ...result });
    }

    return NextResponse.json({
      success: false,
      error: `action ไม่รู้จัก: ${action}`,
      errorType: 'EDITOR_ERROR',
    }, { status: 400 });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err?.message || 'บก. ทำงานล้มเหลว',
      errorType: 'EDITOR_ERROR',
      tookMs: Date.now() - t0,
    }, { status: 500 });
  }
}
