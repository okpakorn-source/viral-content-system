/**
 * ============================================================
 * 📥 /api/desk/research/leads — คลังลีดข่าว + ทางส่งเข้าคิวเขียน (โต๊ะข่าวกลาง v2, R3 เฟส 2.0 — 16 ก.ค. 69)
 * ============================================================
 * GET  — ดูรายการลีด (query filter) หรือ ?view=stats ดูสรุปตัวเลข
 * POST — action: 'saveBatch' (เซฟลีดจาก R2) | 'setStatus' (เปลี่ยนสถานะ) | 'sendQueue' (ส่งเข้าคิวเขียนข่าว)
 * แผนแม่บท: artifact research-engine-plan (16 ก.ค.)
 */
import { NextResponse } from 'next/server';
import {
  listLeads,
  leadStats,
  saveLeads,
  setLeadStatus,
  sendLeadToQueue,
} from '@/lib/services/deskV2/researchLeads.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  try {
    const { searchParams } = request.nextUrl;

    if (searchParams.get('view') === 'stats') {
      const stats = await leadStats();
      return NextResponse.json({ success: true, stats });
    }

    const minScoreRaw = searchParams.get('minScore');
    const limitRaw = searchParams.get('limit');

    const leads = await listLeads({
      clusterId: searchParams.get('clusterId') || undefined,
      status: searchParams.get('status') || undefined,
      channel: searchParams.get('channel') || undefined,
      fetchability: searchParams.get('fetchability') || undefined,
      minScore: minScoreRaw != null ? Number(minScoreRaw) : undefined,
      q: searchParams.get('q') || undefined,
      runId: searchParams.get('runId') || undefined, // 🔒 audit R2: ดึงเฉพาะลีดของรอบล่า — กันลีดเก่าคะแนนสูงบัง
      limit: limitRaw != null ? Number(limitRaw) : undefined,
    });

    return NextResponse.json({ success: true, leads, count: leads.length });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error?.message || 'ดึงลีดล้มเหลว',
      errorType: 'RESEARCH_LEADS_ERROR',
    }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    const action = body?.action;

    if (action === 'saveBatch') {
      const result = await saveLeads(body?.leads, { runId: body?.runId });
      return NextResponse.json({ success: true, ...result });
    }

    if (action === 'setStatus') {
      if (!body?.id || !body?.status) {
        return NextResponse.json({
          success: false,
          error: 'ต้องระบุ id และ status',
          errorType: 'RESEARCH_LEADS_ERROR',
        }, { status: 400 });
      }
      const lead = await setLeadStatus(body.id, body.status);
      return NextResponse.json({ success: true, lead });
    }

    if (action === 'sendQueue') {
      if (!body?.id) {
        return NextResponse.json({
          success: false,
          error: 'ต้องระบุ id',
          errorType: 'RESEARCH_LEADS_ERROR',
        }, { status: 400 });
      }
      const origin = request.nextUrl.origin;
      const result = await sendLeadToQueue(body.id, { origin });
      return NextResponse.json(result);
    }

    return NextResponse.json({
      success: false,
      error: `action ไม่รู้จัก: ${action}`,
      errorType: 'RESEARCH_LEADS_ERROR',
    }, { status: 400 });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error?.message || 'ทำรายการลีดล้มเหลว',
      errorType: 'RESEARCH_LEADS_ERROR',
    }, { status: 500 });
  }
}
