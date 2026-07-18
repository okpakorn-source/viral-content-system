/**
 * ============================================================
 * 🎯 POST /api/desk/research/hunt — เครื่องยิงค้นข่าวหลายแพลตฟอร์ม (Research Engine R1, เฟส 2.0 — 16 ก.ค. 69)
 * ============================================================
 * body: { clusterIds?, topClusters?, queriesPerCluster?, channels?, perQueryResults? }
 * → ยิงค้นจริงผ่าน src/lib/services/deskV2/researchHunt.js (ไม่มี AI ในขั้นนี้) → คืน candidates + stats
 */
import { NextResponse } from 'next/server';
import { huntClusters } from '@/lib/services/deskV2/researchHunt.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// ★ 18 ก.ค.: +reels — allow-list นี้ตกหล่นตอนเพิ่มช่อง FB Reels (17 ก.ค.) ทำ route ปัดช่องนี้ทิ้งเงียบๆ ทั้งที่ researchHunt.js/UI มีครบ
const KNOWN_CHANNELS = ['videos', 'facebook', 'tiktok', 'youtube', 'google', 'reels']; // ★ 16 ก.ค.: +google (ลิงก์ข่าวสำนักต่างๆ — ผู้ใช้สั่ง)

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));

    const clusterIds = Array.isArray(body?.clusterIds)
      ? body.clusterIds.filter((x) => typeof x === 'string' && x)
      : [];
    const topClusters = body?.topClusters != null ? Number(body.topClusters) : 10;
    const queriesPerCluster = body?.queriesPerCluster != null ? Number(body.queriesPerCluster) : 4;
    const channels = Array.isArray(body?.channels) ? body.channels : KNOWN_CHANNELS.slice();
    const perQueryResults = body?.perQueryResults != null ? Number(body.perQueryResults) : 10;

    if (!Number.isFinite(topClusters) || topClusters < 1 || topClusters > 30) {
      return NextResponse.json({
        success: false,
        error: 'topClusters ต้องเป็นตัวเลข 1-30',
        errorType: 'VALIDATION_ERROR',
      }, { status: 400 });
    }
    if (!Number.isFinite(queriesPerCluster) || queriesPerCluster < 1 || queriesPerCluster > 6) {
      return NextResponse.json({
        success: false,
        error: 'queriesPerCluster ต้องเป็นตัวเลข 1-6',
        errorType: 'VALIDATION_ERROR',
      }, { status: 400 });
    }
    const invalidChannels = channels.filter((c) => !KNOWN_CHANNELS.includes(c));
    if (channels.length === 0 || invalidChannels.length > 0) {
      return NextResponse.json({
        success: false,
        error: `channels ต้องเป็นสับเซตที่ไม่ว่างของ ${KNOWN_CHANNELS.join(', ')}`,
        errorType: 'VALIDATION_ERROR',
      }, { status: 400 });
    }

    const result = await huntClusters({ clusterIds, topClusters, queriesPerCluster, channels, perQueryResults });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[ResearchHunt POST]', error?.message);
    return NextResponse.json({
      success: false,
      error: error?.message || 'ยิงค้นข่าวล้มเหลว',
      errorType: 'RESEARCH_HUNT_ERROR',
    }, { status: 500 });
  }
}
