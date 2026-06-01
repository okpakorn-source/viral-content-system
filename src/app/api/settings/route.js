import { NextResponse } from 'next/server';

/**
 * GET /api/settings — ดึงค่า environment ปัจจุบัน (ซ่อน key)
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      openai: !!process.env.OPENAI_API_KEY,
      claude: !!process.env.ANTHROPIC_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY,
      firecrawl: !!process.env.FIRECRAWL_API_KEY,
      openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',
      activeModels: {
        extraction: process.env.GEMINI_API_KEY ? 'Gemini Flash' : 'GPT-4o',
        breakdown: 'GPT-4o',
        writing: process.env.ANTHROPIC_API_KEY ? 'Claude Sonnet' : 'GPT-4o',
        moderation: 'OpenAI (ฟรี)',
      },
    },
  });
}
