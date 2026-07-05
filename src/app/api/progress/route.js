// ============================================================
// [ระบบทำปกออโต้] GET /api/progress?jobId=... — ดูสถานะงานเรียลไทม์
// ============================================================

import { NextResponse } from 'next/server';
import { getProgress } from '@/lib/progress';

export const runtime = 'nodejs';

export async function GET(req) {
  const jobId = new URL(req.url).searchParams.get('jobId');
  const p = jobId ? getProgress(jobId) : null;
  return NextResponse.json({ success: true, jobId, progress: p });
}
