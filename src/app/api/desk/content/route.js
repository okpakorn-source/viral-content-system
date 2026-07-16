/**
 * ============================================================
 * 📚 /api/desk/content — คลังเนื้อพร้อมใช้ (โต๊ะข่าวกลาง v2, โมดูลที่ 3 — C1, 17 ก.ค. 69)
 * ============================================================
 * GET  — ดูรายการเนื้อ (query filter: status/q/limit) หรือ ?view=stats ดูสรุปตัวเลข
 * POST — action: 'harvest' (ดึงผลเจนที่เสร็จแล้วจากลีดที่ส่งคิว) | 'setStatus' (ready↔used) | 'delete'
 */
import { NextResponse } from 'next/server';
import {
  listContent,
  contentStats,
  harvestFromLeads,
  setStatus,
  removeItem,
} from '@/lib/services/deskV2/readyContent.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // harvest ยิง /api/queue/status ทีละใบ (sequential, ≤10 ใบ/รอบ default)

export async function GET(request) {
  try {
    const { searchParams } = request.nextUrl;

    if (searchParams.get('view') === 'stats') {
      const stats = await contentStats();
      return NextResponse.json({ success: true, stats });
    }

    const limitRaw = searchParams.get('limit');
    const items = await listContent({
      status: searchParams.get('status') || undefined,
      q: searchParams.get('q') || undefined,
      limit: limitRaw != null ? Number(limitRaw) : undefined,
    });

    return NextResponse.json({ success: true, items, count: items.length });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error?.message || 'ดึงคลังเนื้อล้มเหลว',
      errorType: 'READY_CONTENT_ERROR',
    }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    const action = body?.action;

    if (action === 'harvest') {
      const origin = request.nextUrl.origin;
      const result = await harvestFromLeads({ origin, maxJobs: body?.maxJobs });
      return NextResponse.json({ success: true, ...result });
    }

    if (action === 'setStatus') {
      if (!body?.id || !body?.status) {
        return NextResponse.json({
          success: false,
          error: 'ต้องระบุ id และ status',
          errorType: 'READY_CONTENT_ERROR',
        }, { status: 400 });
      }
      const item = await setStatus(body.id, body.status);
      return NextResponse.json({ success: true, item });
    }

    if (action === 'delete') {
      if (!body?.id) {
        return NextResponse.json({
          success: false,
          error: 'ต้องระบุ id',
          errorType: 'READY_CONTENT_ERROR',
        }, { status: 400 });
      }
      const result = await removeItem(body.id);
      return NextResponse.json({ success: true, ...result });
    }

    return NextResponse.json({
      success: false,
      error: `action ไม่รู้จัก: ${action}`,
      errorType: 'READY_CONTENT_ERROR',
    }, { status: 400 });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error?.message || 'ทำรายการคลังเนื้อล้มเหลว',
      errorType: 'READY_CONTENT_ERROR',
    }, { status: 500 });
  }
}
