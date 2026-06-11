/**
 * News Desk Harvest — สั่งเก็บ+คัดกรองข่าวรอบใหม่
 * POST { lanes?: ['trend','good'], judgeTop?: 24 }
 * GET  → เหมือน POST (รองรับ Vercel Cron ภายหลัง)
 */
import { NextResponse } from 'next/server';
import { runHarvest, pruneOldItems } from '@/lib/services/newsDesk/harvester';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// กันเก็บซ้อนกัน — เครื่องหนึ่งเก็บทีละรอบ
let _harvestLock = Promise.resolve();

async function doHarvest(opts) {
  const prev = _harvestLock;
  let release;
  _harvestLock = new Promise((r) => (release = r));
  await prev;
  try {
    await pruneOldItems(3);
    const stats = await runHarvest(opts);
    return NextResponse.json({ success: true, ...stats });
  } finally {
    release();
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    return await doHarvest({
      lanes: Array.isArray(body.lanes) && body.lanes.length ? body.lanes : ['trend', 'good'],
      judgeTop: Math.min(40, Number(body.judgeTop) || 24),
    });
  } catch (error) {
    console.error('[NewsDesk Harvest]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'HARVEST_ERROR' }, { status: 500 });
  }
}

export async function GET(request) {
  return POST(request);
}
