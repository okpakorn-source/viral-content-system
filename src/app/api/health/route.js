import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

/**
 * GET /api/health
 * Operational health check — Supabase, API keys, last activity, runtime
 * 
 * Returns:
 * - status: 'healthy' | 'degraded' | 'critical'
 * - checks: supabase, api_keys, last_activity, runtime
 * - issues: human-readable list of problems
 */
export async function GET() {
  const startTime = Date.now();
  const issues = [];

  // ─── 1. Supabase Connection ───────────────────────────────────
  let supabaseCheck = { status: 'error', latency_ms: 0, row_count: null };
  try {
    const supabase = getSupabase();
    if (!supabase) {
      supabaseCheck.status = 'error';
      supabaseCheck.error = 'Supabase client not configured';
      issues.push('Supabase not configured (missing URL or key)');
    } else {
      const t0 = Date.now();
      const { count, error } = await supabase
        .from('cover_cases')
        .select('*', { count: 'exact', head: true });
      supabaseCheck.latency_ms = Date.now() - t0;

      if (error) {
        supabaseCheck.status = 'error';
        supabaseCheck.error = error.message?.slice(0, 120);
        issues.push(`Supabase query error: ${error.message?.slice(0, 80)}`);
      } else {
        supabaseCheck.status = 'ok';
        supabaseCheck.row_count = count;
      }
    }
  } catch (err) {
    supabaseCheck.status = 'error';
    supabaseCheck.error = err.message?.slice(0, 120);
    issues.push(`Supabase connection failed: ${err.message?.slice(0, 80)}`);
  }

  // ─── 2. API Keys ──────────────────────────────────────────────
  const apiKeysCheck = {
    openai: Boolean(process.env.OPENAI_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    serper: Boolean(process.env.SERPER_API_KEY),
    supabase: Boolean(
      (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL) &&
      (process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    ),
  };

  if (!apiKeysCheck.openai) issues.push('OpenAI API key missing');
  if (!apiKeysCheck.gemini) issues.push('Gemini API key missing');
  if (!apiKeysCheck.serper) issues.push('Serper API key missing');
  if (!apiKeysCheck.supabase) issues.push('Supabase credentials missing');

  // ─── 3. Last Activity ─────────────────────────────────────────
  const lastActivity = { cover_cases: null, news_cases: null };
  try {
    const supabase = getSupabase();
    if (supabase) {
      // Last cover_cases entry
      const { data: coverData } = await supabase
        .from('cover_cases')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1);
      if (coverData?.[0]?.created_at) {
        lastActivity.cover_cases = formatTimeAgo(coverData[0].created_at);
      }

      // Last news_cases entry
      const { data: newsData } = await supabase
        .from('news_cases')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1);
      if (newsData?.[0]?.created_at) {
        lastActivity.news_cases = formatTimeAgo(newsData[0].created_at);
      }
    }
  } catch {
    // Non-critical — activity check failure doesn't affect status
  }

  // Check if last activity is stale (> 24h)
  let activityStale = false;
  try {
    const supabase = getSupabase();
    if (supabase) {
      const { data } = await supabase
        .from('cover_cases')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1);
      if (data?.[0]?.created_at) {
        const hoursAgo = (Date.now() - new Date(data[0].created_at).getTime()) / (1000 * 60 * 60);
        if (hoursAgo > 24) {
          activityStale = true;
          issues.push(`Last cover_cases activity was ${Math.round(hoursAgo)}h ago (>24h)`);
        }
      }
    }
  } catch {
    // Ignore
  }

  // ─── 4. Runtime Info ──────────────────────────────────────────
  const mem = process.memoryUsage();
  const runtimeCheck = {
    uptime_hours: +(process.uptime() / 3600).toFixed(2),
    memory_mb: {
      rss: +(mem.rss / 1048576).toFixed(1),
      heapUsed: +(mem.heapUsed / 1048576).toFixed(1),
      heapTotal: +(mem.heapTotal / 1048576).toFixed(1),
    },
    node_version: process.version,
  };

  // ─── 5. Build Info ────────────────────────────────────────────
  let version = 'unknown';
  try {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8'));
    version = pkg.version || 'unknown';
  } catch {
    // Non-critical
  }

  // ─── Status Logic ─────────────────────────────────────────────
  // critical: Supabase down OR OpenAI key missing
  // degraded: any non-critical key missing OR last activity > 24h
  // healthy: everything OK
  let status = 'healthy';
  if (supabaseCheck.status === 'error' || !apiKeysCheck.openai) {
    status = 'critical';
  } else if (!apiKeysCheck.gemini || !apiKeysCheck.serper || activityStale) {
    status = 'degraded';
  }

  const elapsed = Date.now() - startTime;

  return NextResponse.json({
    status,
    timestamp: new Date().toISOString(),
    version,
    response_time_ms: elapsed,
    checks: {
      supabase: supabaseCheck,
      api_keys: apiKeysCheck,
      last_activity: lastActivity,
      runtime: runtimeCheck,
    },
    issues,
  }, { status: 200 });
}

/**
 * Format a timestamp into a human-readable "Xh ago" / "Xm ago" string
 */
function formatTimeAgo(isoString) {
  try {
    const diff = Date.now() - new Date(isoString).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return 'unknown';
  }
}
