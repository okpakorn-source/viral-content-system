/**
 * News Desk Harvest — สั่งเก็บ+คัดกรองข่าวรอบใหม่
 * POST { lanes?: ['trend','good'], judgeTop?: 24 }
 * GET  → เหมือน POST (รองรับ Vercel Cron ภายหลัง)
 */
import { NextResponse } from 'next/server';
import { runHarvest, pruneOldItems } from '@/lib/services/newsDesk/harvester';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600; // harvest + auto-research ตัวท็อป 3 ใบ

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
    // ★ สั่งหาเฉพาะแนว (15 มิ.ย.): focus → คำค้นเฉพาะแนวนั้น → harvest แค่แนวนั้น (judge ได้ลึกขึ้นเพราะคำน้อย)
    if (body.focus) {
      const { generateFocusQueries } = await import('@/lib/services/newsDesk/goodNewsScout');
      const fq = generateFocusQueries(body.focus, Number(body.count) || 8);
      if (!fq.length) {
        return NextResponse.json({ success: false, error: 'ไม่รู้จักแนวที่สั่ง', errorType: 'UNKNOWN_FOCUS' }, { status: 400 });
      }
      // ★ 16 มิ.ย.: ติดป้าย focusTag + searchedAt → ผลค้นไปรวมในแท็บ "🎯 ผลค้นหา" (กลับมาดูได้ ไม่หาย)
      const _searchedAt = new Date().toISOString();
      return await doHarvest({
        lanes: [],
        extraQueries: fq.map(f => ({ q: f.q, lane: f.lane, timeRange: f.timeRange, endpoint: f.endpoint, tag: { focusTag: body.focus, searchedAt: _searchedAt } })),
        judgeTop: Math.min(40, Number(body.judgeTop) || 20),
      });
    }
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
