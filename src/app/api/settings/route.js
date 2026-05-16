import { NextResponse } from 'next/server';

/**
 * GET /api/settings — ดึงค่า environment ปัจจุบัน (ซ่อน key)
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      openai: !!process.env.OPENAI_API_KEY,
      firecrawl: !!process.env.FIRECRAWL_API_KEY,
      openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',
    },
  });
}
