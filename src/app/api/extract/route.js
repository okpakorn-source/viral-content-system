import { NextResponse } from 'next/server';
import { extractContent } from '@/lib/scraper/index.js';

/**
 * POST /api/extract — ดึงเนื้อหาจาก URL (preview ก่อนวิเคราะห์)
 */
export async function POST(request) {
  try {
    const { url, type, rawContent } = await request.json();

    if (!url && !rawContent) {
      return NextResponse.json(
        { success: false, error: 'ต้องระบุ URL หรือข้อความ' },
        { status: 400 }
      );
    }

    const result = await extractContent({ url, type, rawContent });

    return NextResponse.json({
      success: result.success,
      data: result,
    });
  } catch (error) {
    console.error('Extract API Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
