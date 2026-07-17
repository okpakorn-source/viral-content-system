/**
 * ============================================================
 * 🧠 /api/desk/editor — สมอง บก. AI (โต๊ะข่าวกลาง v2, เฟส 2 — E1, 17 ก.ค. 69)
 * ============================================================
 * GET  → สถานะ บก. (ศึกษาแล้วหรือยัง/ทิศทาง top5/เวลาคัดล่าสุด) + รอบคัดข่าวล่าสุดแบบเต็ม
 *        🆕 P1 (17 ก.ค. 69): + "ห้องรอ" (outbox: รายการ waiting/sending/sent/error + outboxStats)
 * POST {action:'study', model?, maxExemplars?}                → บก. อ่านคลัง DNA + กลั่นเป็นธรรมนูญถาวร (งานยาว)
 * POST {action:'pick',  model?, limit?, autoSend?, sendMode?}  → คัดลีดข่าวตามธรรมนูญ + ด่านกันเชิงลบ + (ออปชัน) ส่ง/เข้าห้องรอ
 * POST {action:'cancelOutbox', id}                             → 🆕 P1: ยกเลิกรายการในห้องรอ (เฉพาะ waiting/error)
 * ห้ามแตะ contract ของ dnaContract.js/dnaSynthesis.js/dnaResearch.js/researchLeads.js/researchExtract.js —
 * ยิงผ่าน editorBrain.js/editorOutbox.js เท่านั้น
 */
import { NextResponse } from 'next/server';
import { studyDna, editorPick, getBrainStatus, getLatestPickRun } from '@/lib/services/deskV2/editorBrain.js';
import { listOutbox, outboxStats, cancelOutbox } from '@/lib/services/deskV2/editorOutbox.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600; // studyDna อ่านคลังทั้งหมด + เรียก AI หลายก้อน (200s/call) — งานยาว

export async function GET() {
  try {
    const [status, lastRun, outbox, outboxStatsResult] = await Promise.all([
      getBrainStatus(),
      getLatestPickRun(),
      listOutbox(),
      outboxStats(),
    ]);
    return NextResponse.json({ success: true, status, lastRun, outbox, outboxStats: outboxStatsResult });
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
      const sendMode = body?.sendMode === 'polite' ? 'polite' : 'immediate'; // 🔴 รับแค่ 2 ค่านี้เท่านั้น (default 'immediate' — 17 ก.ค. 69 ผู้ใช้สั่งถอดยาม ส่งตรงเข้าคิวปกติ)
      const origin = request.nextUrl.origin;

      const result = await editorPick({ limit, autoSend, sendMode, origin, modelKey });
      return NextResponse.json({ success: true, ...result });
    }

    // 🆕 P1 (17 ก.ค. 69): ยกเลิกรายการในห้องรอ (เฉพาะ status waiting/error — กำลังส่ง/ส่งแล้วยกเลิกไม่ได้)
    if (action === 'cancelOutbox') {
      const id = body?.id;
      if (!id) {
        return NextResponse.json({
          success: false,
          error: 'ต้องระบุ id',
          errorType: 'EDITOR_ERROR',
        }, { status: 400 });
      }
      const result = await cancelOutbox(id);
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
