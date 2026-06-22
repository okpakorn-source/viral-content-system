import { NextResponse } from 'next/server';
import { RADAR_ENABLED, radarDisabledResponse } from '@/lib/radarKillSwitch';

// POST endpoint สำหรับ advanced search — รับ body แทน query params
export const maxDuration = 120;

export async function POST(request) {
  if (!RADAR_ENABLED) return radarDisabledResponse(); // ★ 22 มิ.ย.: ปิดเรดาร์ — ไม่ยิงแหล่งข่าว/AI = ไม่กินโทเคน
  try {
    const { keyword, sources, timeRange, category } = await request.json();

    if (!keyword) {
      return NextResponse.json(
        { success: false, error: 'ไม่มีคำค้น', errorType: 'MISSING_KEYWORD' },
        { status: 400 }
      );
    }

    // สร้าง URL เพื่อ redirect ไปยัง GET handler หลัก
    const url = new URL(request.url);
    url.pathname = '/api/radar';
    url.searchParams.set('mode', 'search');
    url.searchParams.set('q', keyword);
    if (sources) url.searchParams.set('sources', sources.join(','));
    if (timeRange) url.searchParams.set('time', timeRange);

    const res = await fetch(url.toString());
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('[Radar-Search] Error:', err.message);
    return NextResponse.json(
      { success: false, error: err.message, errorType: 'SEARCH_ERROR' },
      { status: 500 }
    );
  }
}
