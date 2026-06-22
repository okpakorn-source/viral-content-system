import { NextResponse } from 'next/server';
import { RADAR_ENABLED, radarDisabledResponse } from '@/lib/radarKillSwitch';

// Cache ข่าว trending ใน memory (TTL 30 นาที)
let _trendingCache = null;
let _trendingExpiry = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 นาที

export async function GET() {
  if (!RADAR_ENABLED) return radarDisabledResponse(); // ★ 22 มิ.ย.: ปิดเรดาร์ — ไม่กินโทเคน
  try {
    // ถ้ามี cache ที่ยังไม่หมดอายุ → ใช้เลย
    if (_trendingCache && Date.now() < _trendingExpiry) {
      return NextResponse.json({ success: true, ..._trendingCache, cached: true });
    }

    const SERPER_KEY = process.env.SERPER_API_KEY;

    // หมวดหมู่ข่าวที่ต้องการ
    const categories = [
      { name: 'ข่าวมาแรง', query: 'ข่าวด่วนวันนี้ ไทย', icon: '🔥' },
      { name: 'ข่าวน้ำดี', query: 'ข่าวน้ำดี ช่วยเหลือ กตัญญู บริจาค', icon: '💚' },
      { name: 'ข่าวดารา', query: 'ข่าวดารา คนดัง เซเลบ ล่าสุด', icon: '⭐' },
      { name: 'ข่าวสังคม', query: 'ข่าวสังคม ดราม่า ประเด็นร้อน', icon: '💬' },
    ];

    // ดึงข่าวแต่ละหมวดพร้อมกัน
    const results = await Promise.all(
      categories.map(async (cat) => {
        try {
          const res = await fetch('https://google.serper.dev/news', {
            method: 'POST',
            headers: {
              'X-API-KEY': SERPER_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ q: cat.query, gl: 'th', hl: 'th', num: 5 }),
          });
          const data = await res.json();
          return {
            ...cat,
            articles: (data.news || []).slice(0, 5).map(n => ({
              title: n.title,
              source: n.source,
              url: n.link,
              date: n.date,
              imageUrl: n.imageUrl || null,
            })),
          };
        } catch {
          // Fallback: หมวดนี้ดึงไม่ได้ → คืนว่าง
          return { ...cat, articles: [] };
        }
      })
    );

    // อัปเดต cache
    _trendingCache = { categories: results, updatedAt: new Date().toISOString() };
    _trendingExpiry = Date.now() + CACHE_TTL;

    return NextResponse.json({ success: true, ..._trendingCache, cached: false });
  } catch (err) {
    console.error('[Radar-Trending] Error:', err.message);
    return NextResponse.json(
      { success: false, error: err.message, errorType: 'TRENDING_ERROR' },
      { status: 500 }
    );
  }
}
