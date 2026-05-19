import { NextResponse } from 'next/server';
import { isSupabaseReady } from '@/lib/supabase';
import { createLogger } from '@/lib/logger';

const rlog = createLogger('SYSTEM-HEALTH');

/**
 * GET /api/system-health
 * Quick health check — ไม่ต้องรัน full test suite
 * ใช้สำหรับ monitoring, uptime check, หรือ browser fetch
 * หากต้องการ full test → ใช้ /api/system-test แทน
 */
export async function GET(request) {
  const startTime = Date.now();
  rlog.start('quick health check');

  const checks = {};
  let overallStatus = 'healthy';

  // ─── 1. OpenAI ────────────────────────────────────────────────
  checks.openai = {
    configured: Boolean(process.env.OPENAI_API_KEY),
    keyPrefix: process.env.OPENAI_API_KEY?.slice(0, 7) || 'missing',
  };
  if (!checks.openai.configured) overallStatus = 'degraded';

  // ─── 2. FAL.ai ───────────────────────────────────────────────
  checks.fal = {
    configured: Boolean(process.env.FAL_KEY),
    keyPrefix: process.env.FAL_KEY?.slice(0, 6) || 'missing',
  };

  // ─── 3. Ideogram ─────────────────────────────────────────────
  checks.ideogram = {
    configured: Boolean(process.env.IDEOGRAM_API_KEY),
    keyPrefix: process.env.IDEOGRAM_API_KEY?.slice(0, 6) || 'missing',
  };

  // ─── 4. Serper ───────────────────────────────────────────────
  checks.serper = {
    configured: Boolean(process.env.SERPER_API_KEY),
    keyPrefix: process.env.SERPER_API_KEY?.slice(0, 6) || 'missing',
  };

  // ─── 5. Supabase ─────────────────────────────────────────────
  checks.supabase = {
    configured: isSupabaseReady(),
    status: isSupabaseReady() ? 'ready' : 'not configured (using fallback)',
  };

  // ─── 6. Prisma DB ─────────────────────────────────────────────
  try {
    const { prisma } = await import('@/lib/db');
    const count = await prisma.content.count();
    checks.database = { status: 'connected', contentItems: count };
  } catch (e) {
    checks.database = { status: 'error', error: e.message.slice(0, 80) };
    overallStatus = 'degraded';
  }

  // ─── 7. Environment ───────────────────────────────────────────
  checks.environment = {
    nodeVersion: process.version,
    nextEnv: process.env.NODE_ENV || 'development',
  };

  const elapsed = Date.now() - startTime;
  rlog.done(`status: ${overallStatus} | ${elapsed}ms`);

  // Determine HTTP status
  const httpStatus = overallStatus === 'healthy' ? 200 : 200; // always 200 — let clients decide

  return NextResponse.json({
    success: true,
    status: overallStatus,
    timestamp: new Date().toISOString(),
    responseTimeMs: elapsed,
    checks,
    message: overallStatus === 'healthy'
      ? '✅ All systems operational'
      : '⚠️ System degraded — some services unavailable',
    hint: 'For full test suite, call GET /api/system-test',
  }, { status: httpStatus });
}
