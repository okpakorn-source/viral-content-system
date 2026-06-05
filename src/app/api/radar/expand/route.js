import { NextResponse } from 'next/server';
import { expandKeywords } from '@/lib/services/radar/keywordExpansion';

// POST endpoint สำหรับ preview การขยายคีย์เวิร์ด
export async function POST(request) {
  try {
    const { keyword } = await request.json();

    if (!keyword) {
      return NextResponse.json(
        { success: false, error: 'ไม่มีคำค้น', errorType: 'MISSING_KEYWORD' },
        { status: 400 }
      );
    }

    const queries = await expandKeywords(keyword);

    return NextResponse.json({
      success: true,
      queries,
      count: queries.length,
    });
  } catch (err) {
    console.error('[Radar-Expand] Error:', err.message);
    return NextResponse.json(
      { success: false, error: err.message, errorType: 'EXPAND_ERROR' },
      { status: 500 }
    );
  }
}
