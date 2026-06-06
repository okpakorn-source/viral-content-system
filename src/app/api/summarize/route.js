export const maxDuration = 300; // Allow 5 minutes for heavy LLM operations
import { NextResponse } from 'next/server';
import { performSummarize } from '@/lib/services/summarizeService';

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await performSummarize(body);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Summarize API Endpoint] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Summarize error', errorType: 'SUMMARIZE_ERROR' },
      { status: 500 }
    );
  }
}
