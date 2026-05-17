import { NextResponse } from 'next/server';

/**
 * === 🔍 System Health Check & Auto Test ===
 * GET /api/system-test — ทดสอบระบบทั้งหมดอัตโนมัติ
 * 
 * ตรวจสอบ:
 * 1. AI API connections (OpenAI, Claude)
 * 2. Prompt Library integrity
 * 3. Pipeline flow validation
 * 4. Data file read/write
 * 5. Iron Rules enforcement
 */

export async function GET(request) {
  const startTime = Date.now();
  const results = [];
  let passed = 0;
  let failed = 0;
  let warnings = 0;

  function addResult(name, status, detail, durationMs) {
    const r = { name, status, detail, durationMs };
    results.push(r);
    if (status === 'pass') passed++;
    else if (status === 'fail') failed++;
    else warnings++;
  }

  // === TEST 1: OpenAI API Key ===
  try {
    const t = Date.now();
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      addResult('OpenAI API Key', 'fail', 'OPENAI_API_KEY not set', Date.now() - t);
    } else {
      addResult('OpenAI API Key', 'pass', `Key set (${apiKey.slice(0, 8)}...${apiKey.slice(-4)})`, Date.now() - t);
    }
  } catch (e) { addResult('OpenAI API Key', 'fail', e.message, 0); }

  // === TEST 2: Claude API Key ===
  try {
    const t = Date.now();
    const claudeKey = process.env.ANTHROPIC_API_KEY;
    if (!claudeKey) {
      addResult('Claude API Key', 'warn', 'ANTHROPIC_API_KEY not set — Claude fallback disabled', Date.now() - t);
    } else {
      addResult('Claude API Key', 'pass', `Key set (${claudeKey.slice(0, 8)}...${claudeKey.slice(-4)})`, Date.now() - t);
    }
  } catch (e) { addResult('Claude API Key', 'warn', e.message, 0); }

  // === TEST 3: OpenAI API Connection ===
  try {
    const t = Date.now();
    const { callAI } = await import('@/lib/ai/openai');
    const result = await callAI({
      prompt: 'ตอบ JSON: {"status":"ok","test":true}',
      model: 'gpt-4o-mini',
      temperature: 0,
      maxTokens: 50,
    });
    if (result?.status === 'ok') {
      addResult('OpenAI API Connection', 'pass', `GPT-4o-mini responds OK (${Date.now() - t}ms)`, Date.now() - t);
    } else {
      addResult('OpenAI API Connection', 'warn', `Unexpected response: ${JSON.stringify(result).slice(0, 100)}`, Date.now() - t);
    }
  } catch (e) { addResult('OpenAI API Connection', 'fail', e.message, 0); }

  // === TEST 4: Prompt Library File ===
  try {
    const t = Date.now();
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');
    const IS_V = !!process.env.VERCEL;
    const paths = [
      join(IS_V ? '/tmp' : process.cwd() + '/data', 'prompt-library.json'),
      join(process.cwd(), 'data', 'prompt-library.json'),
    ];
    let loaded = false;
    let promptCount = 0;
    for (const p of paths) {
      try {
        const data = JSON.parse(await readFile(p, 'utf-8'));
        promptCount = data.length;
        loaded = true;
        // Validate structure
        const invalid = data.filter(d => !d.id || !d.promptText || !d.category);
        if (invalid.length > 0) {
          addResult('Prompt Library Structure', 'warn', `${invalid.length}/${data.length} prompts missing required fields (id/promptText/category)`, Date.now() - t);
        } else {
          addResult('Prompt Library Structure', 'pass', `All ${data.length} prompts have valid structure`, Date.now() - t);
        }
        break;
      } catch {}
    }
    if (loaded) {
      addResult('Prompt Library File', 'pass', `Loaded: ${promptCount} prompts`, Date.now() - t);
    } else {
      addResult('Prompt Library File', 'warn', 'No prompt library file found — will start empty', Date.now() - t);
    }
  } catch (e) { addResult('Prompt Library File', 'fail', e.message, 0); }

  // === TEST 5: Viral Library File ===
  try {
    const t = Date.now();
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');
    const vPaths = [
      join(process.cwd(), 'data', 'viral-library.json'),
      join('/tmp', 'viral-library.json'),
    ];
    let vLoaded = false;
    for (const vp of vPaths) {
      try {
        const data = JSON.parse(await readFile(vp, 'utf-8'));
        addResult('Viral Library File', 'pass', `${data.length} items (raw: ${data.filter(d => d.status === 'raw').length}, analyzed: ${data.filter(d => d.status === 'analyzed').length}, prompted: ${data.filter(d => d.status === 'prompted').length})`, Date.now() - t);
        vLoaded = true;
        break;
      } catch {}
    }
    if (!vLoaded) {
      addResult('Viral Library File', 'warn', 'No viral library file — will start empty', Date.now() - t);
    }
  } catch (e) { addResult('Viral Library File', 'warn', e.message, 0); }

  // === TEST 6: Prompt Store Presets ===
  try {
    const t = Date.now();
    const { getAnalysisPreset } = await import('@/lib/ai/promptStore');
    const presets = ['viral_fb', 'drama', 'emotional', 'expose', 'analysis'];
    const validPresets = presets.filter(id => {
      const p = getAnalysisPreset(id);
      return p && p.prompt && p.prompt.length > 50;
    });
    if (validPresets.length >= 3) {
      addResult('Prompt Store Presets', 'pass', `${validPresets.length}/${presets.length} presets loaded`, Date.now() - t);
    } else {
      addResult('Prompt Store Presets', 'warn', `Only ${validPresets.length} presets valid`, Date.now() - t);
    }
  } catch (e) { addResult('Prompt Store Presets', 'fail', e.message, 0); }

  // === TEST 7: Workflow Engine ===
  try {
    const t = Date.now();
    const { buildFullContext, validateOutput } = await import('@/lib/workflow/workflowEngine');
    const ctx = buildFullContext({
      newsBody: 'ทดสอบเนื้อข่าว',
      newsTitle: 'ข่าวทดสอบ',
      breakdownData: { key_points: [{ point: 'test', detail: 'test' }] },
    });
    if (ctx && ctx.length > 20) {
      addResult('Workflow Engine', 'pass', `buildFullContext OK (${ctx.length}ch)`, Date.now() - t);
    } else {
      addResult('Workflow Engine', 'fail', 'buildFullContext returned empty', Date.now() - t);
    }
  } catch (e) { addResult('Workflow Engine', 'fail', e.message, 0); }

  // === TEST 8: Smart AI Router ===
  try {
    const t = Date.now();
    const { getAvailableModels } = await import('@/lib/ai/aiRouter');
    const models = getAvailableModels();
    if (models && Object.keys(models).length > 0) {
      const available = Object.entries(models).filter(([, v]) => v).map(([k]) => k);
      addResult('AI Router', 'pass', `Available: ${available.join(', ')}`, Date.now() - t);
    } else {
      addResult('AI Router', 'warn', 'No models available', Date.now() - t);
    }
  } catch (e) { addResult('AI Router', 'fail', e.message, 0); }

  // === TEST 9: Master Agent ===
  try {
    const t = Date.now();
    const { MasterAgent } = await import('@/lib/agents/masterAgent');
    const agent = new MasterAgent('test-system-check');
    if (agent && agent.memory) {
      addResult('Master Agent', 'pass', 'MasterAgent initialized OK', Date.now() - t);
    } else {
      addResult('Master Agent', 'fail', 'MasterAgent initialization failed', Date.now() - t);
    }
  } catch (e) { addResult('Master Agent', 'fail', e.message, 0); }

  // === TEST 10: Iron Rules in System Prompt ===
  try {
    const t = Date.now();
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');
    const openaiSrc = await readFile(join(process.cwd(), 'src/lib/ai/openai.js'), 'utf-8');
    const hasIronRules = openaiSrc.includes('กฎเหล็ก DNA');
    const hasSafety = openaiSrc.includes('FACEBOOK SAFETY RULES');
    const hasSanitize = openaiSrc.includes('sanitizeOutput');
    const hasErrorDetection = openaiSrc.includes('_error') && openaiSrc.includes('_warning');

    if (hasIronRules && hasSafety && hasSanitize && hasErrorDetection) {
      addResult('Iron Rules DNA', 'pass', 'กฎเหล็ก DNA + Safety Rules + Sanitizer + Error Detection ✅', Date.now() - t);
    } else {
      const missing = [];
      if (!hasIronRules) missing.push('กฎเหล็ก DNA');
      if (!hasSafety) missing.push('Safety Rules');
      if (!hasSanitize) missing.push('Sanitizer');
      if (!hasErrorDetection) missing.push('Error Detection');
      addResult('Iron Rules DNA', 'fail', `Missing: ${missing.join(', ')}`, Date.now() - t);
    }
  } catch (e) { addResult('Iron Rules DNA', 'fail', e.message, 0); }

  // === TEST 11: AI Smart Match Logic ===
  try {
    const t = Date.now();
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');
    const routeSrc = await readFile(join(process.cwd(), 'src/app/api/summarize/route.js'), 'utf-8');
    const hasSmartMatch = routeSrc.includes('AI Smart Prompt Match') || routeSrc.includes('gpt-4o-mini');
    const hasBreakdownInject = routeSrc.includes('ผลแตกประเด็นจาก AI');
    const hasStrictRules = routeSrc.includes('กฎสำคัญที่ต้องทำตาม') || routeSrc.includes('ห้ามแต่งเรื่อง') || routeSrc.includes('คำสั่งเหล็ก');

    if (hasSmartMatch && hasBreakdownInject && hasStrictRules) {
      addResult('AI Smart Match + Breakdown', 'pass', 'Smart Match + Direct Breakdown Inject + Strict Rules ✅', Date.now() - t);
    } else {
      const missing = [];
      if (!hasSmartMatch) missing.push('Smart Match');
      if (!hasBreakdownInject) missing.push('Breakdown Inject');
      if (!hasStrictRules) missing.push('Strict Rules');
      addResult('AI Smart Match + Breakdown', 'fail', `Missing: ${missing.join(', ')}`, Date.now() - t);
    }
  } catch (e) { addResult('AI Smart Match + Breakdown', 'fail', e.message, 0); }

  // === TEST 12: Database/Prisma ===
  try {
    const t = Date.now();
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      addResult('Database (Prisma)', 'warn', 'DATABASE_URL not set', Date.now() - t);
    } else {
      // Prisma v7+ reads DATABASE_URL from env automatically
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      await prisma.$connect();
      const count = await prisma.workflow.count();
      await prisma.$disconnect();
      addResult('Database (Prisma)', 'pass', `Connected — ${count} workflows (${dbUrl.startsWith('file:') ? 'SQLite' : 'Remote'})`, Date.now() - t);
    }
  } catch (e) {
    addResult('Database (Prisma)', 'warn', `DB error: ${e.message.slice(0, 80)}`, 0);
  }

  const totalTime = Date.now() - startTime;

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    totalTimeMs: totalTime,
    summary: {
      total: results.length,
      passed,
      failed,
      warnings,
      health: failed === 0 ? (warnings > 2 ? '🟡 DEGRADED' : '🟢 HEALTHY') : '🔴 CRITICAL',
    },
    results,
    ironRulesVersion: 'v1.0 — DNA Level',
    systemVersion: 'v4.5-iron-rules',
  });
}
