/**
 * ★ Trend Tracker API (16 มิ.ย. 69) — "ติดตามกระแส"
 * POST { topic } → AI วิเคราะห์ตัวละคร+คีย์เวิร์ด → ค้นทุกแหล่ง (news/search/videos) → เลน 'trend-track'
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// ★ GET — ดึงคลังค้นหาติดตามทั้งหมด (เคสคีย์เวิร์ด + ลิงก์) เรียงล่าสุดก่อน
export async function GET() {
  try {
    const { createStore } = await import('@/lib/persistStore');
    const cases = await createStore('trend-track-cases').getAll();
    cases.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
    return NextResponse.json({ success: true, cases });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message, cases: [] }, { status: 500 });
  }
}

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
    //    จำกัด 6 คีย์เวิร์ด — กันช้าจนแพลตฟอร์ม timeout (เดิม 8 → ช้า ~3 นาที)
    const extraQueries = [];
    keywords.slice(0, 6).forEach((kw, i) => {
      const tag = { trendTopic: clean };
      extraQueries.push({ q: kw, endpoint: 'news', lane: 'trend-track', timeRange: 'qdr:w', tag });
      extraQueries.push({ q: kw, endpoint: 'search', lane: 'trend-track', timeRange: 'qdr:w', tag });
      if (i < 3) extraQueries.push({ q: kw, endpoint: 'videos', lane: 'trend-track', tag });
    });

    // ③ ยิงผ่าน pipeline ปกติ (gate → classify → judge → ลงคลัง) — auto-pilot ข้ามเลนนี้เอง
    //    judgeTop 8 (ไม่ใช่ 20) — เลนนี้เป็นดิสคัฟเวอรี ทีมคัดเอง ไม่ต้อง judge เยอะ + เร็วขึ้นมาก กัน timeout
    const { runHarvest } = await import('@/lib/services/newsDesk/harvester');
    const stats = await runHarvest({ lanes: [], extraQueries, judgeTop: 8 });

    // ④ เก็บเข้า "คลังค้นหาติดตาม" (persistent ใน Supabase) — เคสคีย์เวิร์ดนี้ + ลิงก์ทั้งหมดที่เจอ
    //    เปิดเบราว์เซอร์ใหม่ยังอยู่ + รวมคีย์เวิร์ดเดียวกันเป็นเคสเดียว (อัปเดตลิงก์)
    let savedLinks = 0;
    try {
      const { createStore } = await import('@/lib/persistStore');
      const { randomUUID } = await import('crypto');
      const desk = await createStore('news-desk').getAll();
      const links = desk
        .filter(c => c.trendTopic === clean && c.status !== 'dismissed' && !c.used)
        .sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0))
        .map(c => ({ title: c.title, url: c.url, source: c.source || '', score: c.finalScore ?? null }));
      savedLinks = links.length;
      if (links.length > 0) {
        const cases = createStore('trend-track-cases');
        const all = await cases.getAll();
        const existing = all.find(x => x.keyword === clean);
        if (existing) {
          await cases.update(existing.id, (ex) => ({ ...ex, links, count: links.length, people, keywords, updatedAt: new Date().toISOString() }));
        } else {
          await cases.add({ id: randomUUID(), keyword: clean, people, keywords, links, count: links.length, createdAt: new Date().toISOString() });
        }
        // เก็บ 50 เคสล่าสุด
        const after = await cases.getAll();
        if (after.length > 50) {
          const old = after.sort((a, b) => new Date(a.updatedAt || a.createdAt) - new Date(b.updatedAt || b.createdAt)).slice(0, after.length - 50);
          for (const o of old) await cases.remove(o.id).catch(() => {});
        }
      }
    } catch (e) { console.log('[TrendTrack] save case failed:', e.message?.slice(0, 60)); }

    return NextResponse.json({ success: true, topic: clean, people, keywords, savedLinks, ...stats });
  } catch (error) {
    console.error('[TrendTrack API]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'TREND_TRACK_ERROR' }, { status: 500 });
  }
}
