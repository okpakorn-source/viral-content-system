#!/usr/bin/env node
/**
 * Weekly Audit Script
 * รัน: node scripts/weekly-audit.mjs
 *
 * 1. PROMPT SYNC AUDIT — เปรียบเทียบ promptStore.js กับ promptStoreText.js
 * 2. MODEL CONFIG AUDIT — ค้นหา hardcoded model names นอก modelConfig.js
 * 3. QUALITY SNAPSHOT — ดึงคะแนนปก/ข่าวล่าสุดจาก Supabase
 * 4. COST ESTIMATE — ประมาณค่าใช้จ่ายจากจำนวน cases ใน 7 วัน
 * 5. Report — แสดงผลเป็น text + ส่ง Discord (ถ้ามี webhook)
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join, relative, extname } from 'path';
import { createClient } from '@supabase/supabase-js';

// ─── Helpers ──────────────────────────────────────
const ROOT = resolve(process.cwd());

function loadEnv() {
  try {
    const envPath = resolve(ROOT, '.env.local');
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env.local might not exist
  }
}

loadEnv();

const TODAY = new Date().toISOString().split('T')[0];
const issues = [];
const sections = {};

// ─── 1. PROMPT SYNC AUDIT ──────────────────────────
function auditPromptSync() {
  const urlPath = resolve(ROOT, 'src/lib/ai/promptStore.js');
  const textPath = resolve(ROOT, 'src/lib/ai/promptStoreText.js');

  let urlPrompts, textPrompts;
  try {
    urlPrompts = readFileSync(urlPath, 'utf8');
  } catch {
    issues.push('❌ Cannot read promptStore.js');
    return;
  }
  try {
    textPrompts = readFileSync(textPath, 'utf8');
  } catch {
    issues.push('❌ Cannot read promptStoreText.js');
    return;
  }

  // ── Preset IDs (from DEFAULT_ANALYSIS_PRESETS array) ──
  const urlPresetIds = [...urlPrompts.matchAll(/id:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  const textPresetIds = [...textPrompts.matchAll(/id:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);

  // ── Category fields ──
  const urlCategories = [...urlPrompts.matchAll(/category:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  const textCategories = [...textPrompts.matchAll(/category:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);

  // ── Tone fields ──
  const urlTones = [...urlPrompts.matchAll(/tone:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  const textTones = [...textPrompts.matchAll(/tone:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);

  // ── Compare preset IDs ──
  const missingInText = urlPresetIds.filter(id => !textPresetIds.includes(id));
  const missingInUrl = textPresetIds.filter(id => !urlPresetIds.includes(id));

  const presetSync = missingInText.length === 0 && missingInUrl.length === 0;

  if (missingInText.length > 0) {
    issues.push(`⚠️ Preset IDs in URL store but missing in Text store: ${missingInText.join(', ')}`);
  }
  if (missingInUrl.length > 0) {
    issues.push(`⚠️ Preset IDs in Text store but missing in URL store: ${missingInUrl.join(', ')}`);
  }

  // ── Compare category lists ──
  const urlCatSet = new Set(urlCategories);
  const textCatSet = new Set(textCategories);
  const catSync = urlCatSet.size === textCatSet.size &&
    [...urlCatSet].every(c => textCatSet.has(c));

  if (!catSync) {
    issues.push(`⚠️ Category mismatch — URL: [${[...urlCatSet].join(',')}] vs Text: [${[...textCatSet].join(',')}]`);
  }

  // ── Compare tone counts ──
  const toneSync = urlTones.length === textTones.length;
  if (!toneSync) {
    issues.push(`⚠️ Tone field count mismatch — URL: ${urlTones.length} vs Text: ${textTones.length}`);
  }

  // ── DEFAULT_PROMPTS keys ──
  const urlPromptKeys = [...urlPrompts.matchAll(/^\s+(extraction|transcript_extraction|breakdown|research):\s*\{/gm)].map(m => m[1]);
  const textPromptKeys = [...textPrompts.matchAll(/^\s+(extraction|transcript_extraction|breakdown|research):\s*\{/gm)].map(m => m[1]);
  const keysSync = urlPromptKeys.length === textPromptKeys.length &&
    urlPromptKeys.every(k => textPromptKeys.includes(k));

  if (!keysSync) {
    issues.push(`⚠️ DEFAULT_PROMPTS keys differ — URL: [${urlPromptKeys.join(',')}] vs Text: [${textPromptKeys.join(',')}]`);
  }

  sections.promptSync = {
    urlPresets: urlPresetIds.length,
    textPresets: textPresetIds.length,
    presetSync,
    urlTones: urlTones.length,
    textTones: textTones.length,
    toneSync,
    catSync,
    keysSync,
    urlPromptKeys: urlPromptKeys.length,
    textPromptKeys: textPromptKeys.length,
  };
}

// ─── 2. MODEL CONFIG AUDIT ──────────────────────────
function auditModelConfig() {
  // Models to check for hardcoded usage
  const FORBIDDEN_PATTERNS = [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-5.5',
    'gpt-5.4-mini',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'claude-3-5-sonnet',
    'claude-sonnet',
  ];

  const ALLOWED_FILES = [
    'modelConfig.js',
    'aiRouter.js',
    '.env',
    '.env.local',
    'weekly-audit.mjs', // ตัวเราเอง
  ];

  const foundIssues = [];

  // Recursively walk src/ directory
  function walkDir(dir) {
    let results = [];
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            // Skip node_modules, .next, .git
            if (['node_modules', '.next', '.git'].includes(entry)) continue;
            results = results.concat(walkDir(fullPath));
          } else {
            const ext = extname(entry);
            if (['.js', '.mjs', '.ts', '.jsx', '.tsx'].includes(ext)) {
              results.push(fullPath);
            }
          }
        } catch { /* skip inaccessible */ }
      }
    } catch { /* skip inaccessible dirs */ }
    return results;
  }

  const srcFiles = walkDir(resolve(ROOT, 'src'));
  const scriptFiles = walkDir(resolve(ROOT, 'scripts'));
  const allFiles = [...srcFiles, ...scriptFiles];

  for (const filePath of allFiles) {
    const relPath = relative(ROOT, filePath).replace(/\\/g, '/');
    if (ALLOWED_FILES.some(a => relPath.endsWith(a))) continue;

    try {
      const content = readFileSync(filePath, 'utf8');
      for (const model of FORBIDDEN_PATTERNS) {
        // Match literal model name in quotes (string literal)
        const regex = new RegExp(`['"\`]${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`, 'g');
        const matches = content.match(regex);
        if (matches && matches.length > 0) {
          foundIssues.push({ model, file: relPath, count: matches.length });
        }
      }
    } catch { /* skip unreadable */ }
  }

  // Deduplicate by file+model
  const uniqueIssues = [];
  const seen = new Set();
  for (const issue of foundIssues) {
    const key = `${issue.file}:${issue.model}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueIssues.push(issue);
    }
  }

  if (uniqueIssues.length > 0) {
    for (const { model, file, count } of uniqueIssues) {
      issues.push(`⚠️ Hardcoded '${model}' found in ${file} (${count}x)`);
    }
  }

  sections.modelConfig = {
    hardcodedCount: uniqueIssues.length,
    details: uniqueIssues,
    filesScanned: allFiles.length,
  };
}

// ─── 3. QUALITY SNAPSHOT ────────────────────────────
async function auditQuality() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    sections.quality = { connected: false, reason: 'No Supabase credentials found' };
    issues.push('⚠️ Cannot connect to Supabase — no credentials in .env.local');
    return;
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── Recent cases (last 10) ──
    const { data: recentCases, error: recentErr } = await supabase
      .from('cover_cases')
      .select('case_id, score, created_at, news_title')
      .order('created_at', { ascending: false })
      .limit(10);

    if (recentErr) {
      sections.quality = { connected: false, reason: recentErr.message };
      issues.push(`⚠️ Supabase query failed: ${recentErr.message}`);
      return;
    }

    const validScores = (recentCases || []).filter(c => c.score && c.score > 0);
    const avgScore = validScores.length > 0
      ? (validScores.reduce((a, c) => a + c.score, 0) / validScores.length).toFixed(1)
      : 'N/A';

    // ── Cases this week (last 7 days) ──
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString();

    const { data: weekCases, error: weekErr } = await supabase
      .from('cover_cases')
      .select('case_id', { count: 'exact' })
      .gte('created_at', weekAgoStr);

    const casesThisWeek = weekErr ? 0 : (weekCases?.length || 0);

    // ── Score warning ──
    if (avgScore !== 'N/A' && parseFloat(avgScore) < 6) {
      issues.push(`🔴 Average cover score is LOW: ${avgScore}/10 (threshold: 6.0)`);
    }

    sections.quality = {
      connected: true,
      totalRecent: recentCases?.length || 0,
      avgScore,
      casesThisWeek,
      scoreBelowThreshold: avgScore !== 'N/A' && parseFloat(avgScore) < 6,
    };
  } catch (e) {
    sections.quality = { connected: false, reason: e.message };
    issues.push(`⚠️ Supabase connection error: ${e.message}`);
  }
}

// ─── 4. COST ESTIMATE ───────────────────────────────
function auditCost() {
  const casesThisWeek = sections.quality?.casesThisWeek || 0;
  const costPerCase = 0.15; // USD estimated
  const weekCost = (casesThisWeek * costPerCase).toFixed(2);
  const monthEstimate = (casesThisWeek * costPerCase * 4.3).toFixed(2);

  sections.cost = {
    casesThisWeek,
    costPerCase,
    weekCost,
    monthEstimate,
  };
}

// ─── 5. REPORT ──────────────────────────────────────
function generateReport() {
  const ps = sections.promptSync || {};
  const mc = sections.modelConfig || {};
  const q = sections.quality || {};
  const c = sections.cost || {};

  const lines = [
    '',
    '═══════════════════════════════════════',
    `  📊 Weekly Audit Report — ${TODAY}`,
    '═══════════════════════════════════════',
    '',
    '📝 PROMPT SYNC',
    `  ├── URL presets: ${ps.urlPresets || 0} IDs`,
    `  ├── Text presets: ${ps.textPresets || 0} IDs`,
    `  ├── Preset sync: ${ps.presetSync ? '✅ All matched' : '❌ MISMATCH'}`,
    `  ├── Tone fields: ${ps.toneSync ? '✅' : '❌'} URL=${ps.urlTones || 0} Text=${ps.textTones || 0}`,
    `  ├── Category sync: ${ps.catSync ? '✅ Matched' : '❌ MISMATCH'}`,
    `  └── Pipeline keys: ${ps.keysSync ? '✅' : '❌'} URL=${ps.urlPromptKeys || 0} Text=${ps.textPromptKeys || 0}`,
    '',
    '🤖 MODEL CONFIG',
    `  ├── Files scanned: ${mc.filesScanned || 0}`,
    `  ├── Hardcoded models found: ${mc.hardcodedCount || 0}`,
  ];

  if (mc.details && mc.details.length > 0) {
    for (const d of mc.details) {
      lines.push(`  │   ⚠️ '${d.model}' in ${d.file} (${d.count}x)`);
    }
  }

  lines.push(`  └── Status: ${(mc.hardcodedCount || 0) === 0 ? '✅ All centralized' : '⚠️ Needs cleanup'}`);
  lines.push('');

  if (q.connected) {
    lines.push(`📈 QUALITY (Last ${q.totalRecent} cases)`);
    lines.push(`  ├── Avg cover score: ${q.avgScore}/10`);
    lines.push(`  ├── Cases this week: ${q.casesThisWeek}`);
    lines.push(`  └── Status: ${q.scoreBelowThreshold ? '🔴 BELOW threshold (< 6.0)' : '✅ Above threshold'}`);
  } else {
    lines.push('📈 QUALITY');
    lines.push(`  └── ⚠️ Supabase unavailable: ${q.reason || 'unknown'}`);
  }

  lines.push('');
  lines.push('💰 COST ESTIMATE');
  lines.push(`  ├── Cases: ${c.casesThisWeek || 0} × $${c.costPerCase || 0.15} = ~$${c.weekCost || '0.00'}`);
  lines.push(`  └── Estimated monthly: ~$${c.monthEstimate || '0.00'}`);
  lines.push('');

  lines.push(`⚠️ ISSUES (${issues.length})`);
  if (issues.length === 0) {
    lines.push('  None — system healthy! 🎉');
  } else {
    for (const issue of issues) {
      lines.push(`  • ${issue}`);
    }
  }

  lines.push('');
  lines.push('═══════════════════════════════════════');

  return lines.join('\n');
}

// ─── Discord Webhook ────────────────────────────────
async function sendDiscord(report) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    // Truncate if too long for Discord (max 2000 chars)
    const content = report.length > 1900
      ? report.substring(0, 1900) + '\n... (truncated)'
      : report;

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `\`\`\`\n${content}\n\`\`\`` }),
    });

    if (res.ok) {
      console.log('📨 Discord notification sent!');
    } else {
      console.log(`⚠️ Discord webhook returned ${res.status}`);
    }
  } catch (e) {
    console.log(`⚠️ Discord webhook failed: ${e.message}`);
  }
}

// ─── Main ───────────────────────────────────────────
async function main() {
  console.log('🔍 Running Weekly Audit...\n');

  // 1. Prompt Sync
  auditPromptSync();
  console.log('  ✓ Prompt sync check done');

  // 2. Model Config
  auditModelConfig();
  console.log('  ✓ Model config check done');

  // 3. Quality Snapshot
  await auditQuality();
  console.log('  ✓ Quality snapshot done');

  // 4. Cost Estimate
  auditCost();
  console.log('  ✓ Cost estimate done');

  // 5. Generate Report
  const report = generateReport();
  console.log(report);

  // 6. Discord (optional)
  await sendDiscord(report);

  // Exit code
  const hasErrors = issues.some(i => i.startsWith('❌') || i.startsWith('🔴'));
  process.exit(hasErrors ? 1 : 0);
}

main().catch(e => {
  console.error('💥 Audit script crashed:', e);
  process.exit(2);
});
