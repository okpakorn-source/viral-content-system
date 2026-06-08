#!/usr/bin/env node

/**
 * Watchdog — System Health Checker
 * 
 * Usage:
 *   node scripts/watchdog/check-system.mjs          # basic check
 *   node scripts/watchdog/check-system.mjs --build   # + next build validation
 * 
 * Exit codes: 0 (healthy), 1 (degraded), 2 (critical)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

// ─── Load .env.local ────────────────────────────────────────────
const projectRoot = resolve(process.cwd());
const envPath = resolve(projectRoot, '.env.local');

if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  // Fallback: try .env
  dotenv.config({ path: resolve(projectRoot, '.env') });
}

const args = process.argv.slice(2);
const shouldBuild = args.includes('--build');

// ─── Helpers ────────────────────────────────────────────────────
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

function ok(msg)   { return `${GREEN}✅${RESET} ${msg}`; }
function warn(msg) { return `${YELLOW}⚠️${RESET}  ${msg}`; }
function fail(msg) { return `${RED}❌${RESET} ${msg}`; }
function skip(msg) { return `${CYAN}⏭️${RESET}  ${msg}`; }

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

// ─── Main ───────────────────────────────────────────────────────
async function main() {
  const issues = [];
  const report = {};

  const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  console.log(`\n${BOLD}[Watchdog] System Health Report — ${now}${RESET}\n`);

  // ─── 1. Try /api/health if server is running ──────────────────
  let serverOnline = false;
  try {
    const res = await fetch('http://localhost:3000/api/health', { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      serverOnline = true;
      report.apiHealth = data;
      console.log(`├── Server: ${ok('Online (localhost:3000)')}`);
      console.log(`│   └── API Health Status: ${data.status === 'healthy' ? ok(data.status) : data.status === 'degraded' ? warn(data.status) : fail(data.status)}`);
    }
  } catch {
    console.log(`├── Server: ${warn('Offline — checking env + Supabase directly')}`);
  }

  // ─── 2. Check .env.local keys ─────────────────────────────────
  const requiredKeys = [
    { key: 'OPENAI_API_KEY',   label: 'OpenAI',   critical: true },
    { key: 'GEMINI_API_KEY',   label: 'Gemini',   critical: false },
    { key: 'SERPER_API_KEY',   label: 'Serper',   critical: false },
  ];

  // Supabase check (multiple env var names)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseOk = Boolean(supabaseUrl && supabaseKey);

  let allKeysPresent = supabaseOk;
  let missingCount = 0;
  const keyStatuses = [];

  for (const { key, label, critical } of requiredKeys) {
    const present = Boolean(process.env[key]);
    keyStatuses.push({ label, present, critical });
    if (!present) {
      missingCount++;
      allKeysPresent = false;
      issues.push(`${label} API key missing${critical ? ' (CRITICAL)' : ''}`);
    }
  }

  if (!supabaseOk) {
    missingCount++;
    issues.push('Supabase credentials missing (CRITICAL)');
  }

  const totalKeys = requiredKeys.length + 1; // +1 for supabase
  const presentCount = totalKeys - missingCount;

  if (allKeysPresent) {
    console.log(`├── API Keys: ${ok(`All present (${presentCount}/${totalKeys})`)}`);
  } else {
    console.log(`├── API Keys: ${warn(`${presentCount}/${totalKeys} present`)}`);
    for (const s of keyStatuses) {
      if (!s.present) console.log(`│   └── ${fail(`${s.label} missing${s.critical ? ' ⚠️ CRITICAL' : ''}`)}`);
    }
    if (!supabaseOk) console.log(`│   └── ${fail('Supabase credentials missing ⚠️ CRITICAL')}`);
  }

  // ─── 3. Supabase Direct Check ─────────────────────────────────
  let supabaseStatus = 'error';
  let coverCount = 0;
  let examplesCount = 0;
  let storeCount = 0;
  let lastCoverAt = null;

  if (supabaseOk) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);

      // cover_cases count
      const { count: cc, error: e1 } = await supabase
        .from('cover_cases')
        .select('*', { count: 'exact', head: true });
      if (e1) throw new Error(`cover_cases: ${e1.message}`);
      coverCount = cc || 0;

      // cover_examples count
      const { count: ce, error: e2 } = await supabase
        .from('cover_examples')
        .select('*', { count: 'exact', head: true });
      if (!e2) examplesCount = ce || 0;

      // store_items count
      const { count: si, error: e3 } = await supabase
        .from('store_items')
        .select('*', { count: 'exact', head: true });
      if (!e3) storeCount = si || 0;

      // Last activity
      const { data: lastCover } = await supabase
        .from('cover_cases')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1);
      if (lastCover?.[0]?.created_at) {
        lastCoverAt = lastCover[0].created_at;
      }

      supabaseStatus = 'ok';
      console.log(`├── Supabase: ${ok(`Connected (${coverCount} cover_cases, ${examplesCount} cover_examples, ${storeCount} store_items)`)}`);
    } catch (err) {
      supabaseStatus = 'error';
      issues.push(`Supabase connection error: ${err.message?.slice(0, 80)}`);
      console.log(`├── Supabase: ${fail(`Error — ${err.message?.slice(0, 60)}`)}`);
    }
  } else {
    console.log(`├── Supabase: ${fail('Not configured')}`);
  }

  // ─── 4. Last Activity ─────────────────────────────────────────
  if (lastCoverAt) {
    const hoursAgo = (Date.now() - new Date(lastCoverAt).getTime()) / (1000 * 60 * 60);
    const agoText = formatTimeAgo(lastCoverAt);
    if (hoursAgo > 24) {
      console.log(`├── Last Activity: ${warn(`${agoText} (>24h)`)}`);
      issues.push(`Last cover_cases activity was ${Math.round(hoursAgo)}h ago`);
    } else {
      console.log(`├── Last Activity: ${ok(agoText)}`);
    }
  } else if (supabaseOk) {
    console.log(`├── Last Activity: ${warn('No records found')}`);
  } else {
    console.log(`├── Last Activity: ${skip('Skipped (no Supabase)')}`);
  }

  // ─── 5. Build Check (optional) ────────────────────────────────
  if (shouldBuild) {
    console.log(`├── Build: checking...`);
    try {
      execSync('npx next build', {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 120000,
      });
      console.log(`├── Build: ${ok('Passed')}`);
    } catch (err) {
      const stderr = err.stderr?.toString()?.slice(0, 200) || 'unknown error';
      issues.push(`Build failed: ${stderr}`);
      console.log(`├── Build: ${fail(`Failed — ${stderr.slice(0, 80)}`)}`);
    }
  } else {
    console.log(`├── Build: ${skip('Skipped (use --build to check)')}`);
  }

  // ─── 6. Overall Status ────────────────────────────────────────
  let status = 'HEALTHY';
  let exitCode = 0;

  const criticalKeyMissing = !process.env.OPENAI_API_KEY || !supabaseOk;
  
  if (supabaseStatus === 'error' || criticalKeyMissing) {
    status = 'CRITICAL';
    exitCode = 2;
  } else if (issues.length > 0) {
    status = 'DEGRADED';
    exitCode = 1;
  }

  const statusIcon = status === 'HEALTHY' ? ok(status) : status === 'DEGRADED' ? warn(status) : fail(status);
  console.log(`└── Status: ${statusIcon}\n`);

  if (issues.length > 0) {
    console.log(`${YELLOW}Issues:${RESET}`);
    issues.forEach(i => console.log(`  • ${i}`));
    console.log('');
  }

  // ─── 7. Build JSON report ─────────────────────────────────────
  report.status = status.toLowerCase();
  report.timestamp = new Date().toISOString();
  report.supabase = { status: supabaseStatus, coverCount, examplesCount, storeCount };
  report.apiKeys = { present: presentCount, total: totalKeys };
  report.lastActivity = lastCoverAt ? formatTimeAgo(lastCoverAt) : null;
  report.build = shouldBuild ? (exitCode <= 1 ? 'passed' : 'failed') : 'skipped';
  report.issues = issues;

  // ─── 8. Discord Webhook (if configured + issues found) ────────
  const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
  if (DISCORD_WEBHOOK && issues.length > 0) {
    try {
      await fetch(DISCORD_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `⚠️ **Watchdog Alert** — ${status}\n${issues.map(i => `• ${i}`).join('\n')}`,
        }),
      });
      console.log(`${GREEN}Discord alert sent.${RESET}`);
    } catch (err) {
      console.log(`${YELLOW}Discord webhook failed: ${err.message?.slice(0, 60)}${RESET}`);
    }
  }

  process.exit(exitCode);
}

main().catch(err => {
  console.error(`${RED}[Watchdog] Fatal error: ${err.message}${RESET}`);
  process.exit(2);
});
