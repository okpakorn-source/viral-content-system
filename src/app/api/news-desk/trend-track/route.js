/**
 * ★ Trend Tracker API (16 มิ.ย. 69) — "ติดตามกระแส"
 * POST { topic } → AI วิเคราะห์ตัวละคร+คีย์เวิร์ด → ค้นทุกแหล่ง (news/search/videos) → เลน 'trend-track'
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request) {
  try {
    const { topic } = await request.json();
    if (!topic || typeof topic !== 'string' || topic.trim().length < 2) {
      return NextResponse.json({ success: false, error: 'กรุณาใส่ชื่อกระแส (เช่น "ตินติน ฟรีด้า")', errorType: 'MISSING_TOPIC' }, { status: 400 });
    }
    const clean = topic.trim().slice(0, 120);

    // ① AI วิเคราะห์ตัวละคร + คีย์เวิร์ด
    const { analyzeTrendKeywords } = await import('@/lib/services/newsDesk/trendTracker');
    const { keywords, people } = await analyzeTrendKeywords(clean);
    if (!keywords.length) {
      return NextResponse.json({ success: false, error: 'วิเคราะห์กระแสไม่สำเร็จ ลองใส่ชื่อให้ชัดขึ้น', errorType: 'ANALYZE_FAILED' }, { status: 422 });
    }

    // ② สร้างคำค้นทุกแหล่ง: แต่ละคีย์เวิร์ด × news + search, 3 คำแรก × videos (ครบทุกประเภท)
    const extraQueries = [];
    keywords.forEach((kw, i) => {
      const tag = { trendTopic: clean };
      extraQueries.push({ q: kw, endpoint: 'news', lane: 'trend-track', timeRange: 'qdr:w', tag });
      extraQueries.push({ q: kw, endpoint: 'search', lane: 'trend-track', timeRange: 'qdr:w', tag });
      if (i < 3) extraQueries.push({ q: kw, endpoint: 'videos', lane: 'trend-track', tag });
    });

    // ③ ยิงผ่าน pipeline ปกติ (gate → classify → judge → ลงคลัง) — auto-pilot ข้ามเลนนี้เอง
    const { runHarvest } = await import('@/lib/services/newsDesk/harvester');
    const stats = await runHarvest({ lanes: [], extraQueries, judgeTop: 20 });

    return NextResponse.json({ success: true, topic: clean, people, keywords, ...stats });
  } catch (error) {
    console.error('[TrendTrack API]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'TREND_TRACK_ERROR' }, { status: 500 });
  }
}
