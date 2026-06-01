#!/usr/bin/env node
/**
 * verify-smart-research-flow.mjs
 * ตรวจสอบ Smart Research flow ทั้งระบบแบบอัตโนมัติ
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label} ${detail ? '— ' + detail : ''}`);
    failed++;
  }
}

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

function fileContains(rel, pattern) {
  try {
    const content = readFile(rel);
    if (typeof pattern === 'string') return content.includes(pattern);
    return pattern.test(content);
  } catch { return false; }
}

console.log('\n🔍 Smart Research Flow Verification\n');

// ═════════════════════════════════════════
// 1. achievementResearch.js
// ═════════════════════════════════════════
console.log('📦 1. achievementResearch.js');
const ar = readFile('src/lib/services/achievementResearch.js');
check('Export smartResearch function', ar.includes('export async function smartResearch'));
check('Import callAI', ar.includes("import { callAI }"));
check('Import createLogger', ar.includes("import { createLogger }"));
check('SERPER_API_KEY usage', ar.includes('SERPER_API_KEY'));
check('totalResults uses let (not const)', /let totalResults/.test(ar));
check('totalResults += 1 (not + 1)', ar.includes('totalResults += 1'));
check('Blacklist safety filter', ar.includes('BLACKLIST_PATTERNS'));
check('Safety score filter (>= 5)', ar.includes('safetyScore') && ar.includes('< 5'));
check('Graceful return null', ar.includes('return null'));
check('factPool.facts in return', ar.includes('...factPool'));
check('duration in return', ar.includes('duration: parseFloat'));

// ═════════════════════════════════════════
// 2. autoFlowService.js (URL pipeline)
// ═════════════════════════════════════════
console.log('\n📦 2. autoFlowService.js');
const afs = readFile('src/lib/services/autoFlowService.js');
check('Import smartResearch', afs.includes("import { smartResearch }"));
check('factPool variable init', afs.includes('let factPool = null'));
check('withTimeout wrapping (20s)', afs.includes('withTimeout') && afs.includes('20000'));
check('factPool fallback to null on error', /factPool = null/.test(afs));
check('factPool passed to performSummarize', afs.includes('factPool: factPool'));
check('factPool in return data', afs.includes('factPool: factPool || null'));

// ═════════════════════════════════════════
// 3. autoFlowServiceText.js (Text pipeline)
// ═════════════════════════════════════════
console.log('\n📦 3. autoFlowServiceText.js');
const afst = readFile('src/lib/services/autoFlowServiceText.js');
check('Import smartResearch', afst.includes("import { smartResearch }"));
check('factPool variable init', afst.includes('let factPool = null'));
check('factPool passed to performSummarize', afst.includes('factPool: factPool'));
check('factPool in return data', afst.includes('factPool: factPool || null'));

// ═════════════════════════════════════════
// 4. summarizeService.js (Prompt injection)
// ═════════════════════════════════════════
console.log('\n📦 4. summarizeService.js');
const ss = readFile('src/lib/services/summarizeService.js');
check('factPool parameter in function', ss.includes('factPool,'));
check('factPoolCtx variable', ss.includes("let factPoolCtx = ''"));
check('factPool.facts check', ss.includes('factPool.facts?.length > 0'));
check('factPoolCtx injected into prompt', ss.includes('factPoolCtx'));
check('Safety warning in factPool', ss.includes('ห้ามแทรก URL'));

// ═════════════════════════════════════════
// 5. summarizeServiceText.js
// ═════════════════════════════════════════
console.log('\n📦 5. summarizeServiceText.js');
const sst = readFile('src/lib/services/summarizeServiceText.js');
check('factPool parameter in function', sst.includes('factPool,'));
check('factPoolCtx injected into prompt', sst.includes('factPoolCtx'));

// ═════════════════════════════════════════
// 6. /api/auto/route.js (passthrough)
// ═════════════════════════════════════════
console.log('\n📦 6. /api/auto/route.js');
const autoRoute = readFile('src/app/api/auto/route.js');
check('Returns result directly (passthrough)', autoRoute.includes('return NextResponse.json(result)'));

// ═════════════════════════════════════════
// 7. /api/auto/process/route.js (Universal)
// ═════════════════════════════════════════
console.log('\n📦 7. /api/auto/process/route.js');
const processRoute = readFile('src/app/api/auto/process/route.js');
check('factPool in response JSON', processRoute.includes('factPool:'));

// ═════════════════════════════════════════
// 8. page.js (Frontend state)
// ═════════════════════════════════════════
console.log('\n📦 8. page.js (Frontend)');
const page = readFile('src/app/content/new/page.js');
check('factPoolData state declaration', page.includes('useState(null); // Smart Research'));
check('Auto mode sets factPoolData', page.includes('setFactPoolData(data.data.factPool)'));
check('Universal mode sets factPoolData', page.includes('setFactPoolData(universalFactPool)'));
check('Reset clears factPoolData', page.includes('setFactPoolData(null)'));
check('factPoolData passed to ResultVersions', page.includes('factPoolData'));

// ═════════════════════════════════════════
// 9. ResultVersions.js (UI display)
// ═════════════════════════════════════════
console.log('\n📦 9. ResultVersions.js (UI)');
const rv = readFile('src/components/content/ResultVersions.js');
check('Destructures factPoolData from states', rv.includes('factPoolData }'));
check('Smart Research card render', rv.includes('Smart Research'));
check('Entity name display', rv.includes('factPoolData.entityName'));
check('Entity summary display', rv.includes('factPoolData.entitySummary'));
check('Facts map with categories', rv.includes('fact.category'));
check('Fact source display', rv.includes('fact.source'));
check('Research items (existing) display', rv.includes('แหล่งอ้างอิงข้อมูล'));
check('Copy excludes references', rv.includes("copyText((v.title ? v.title + '\\n\\n' : '') + v.content"));

// ═════════════════════════════════════════
// 10. Discord Bot
// ═════════════════════════════════════════
console.log('\n📦 10. discord-bot/index.js');
const discord = readFile('discord-bot/index.js');
check('factPool in summary embed', discord.includes('_factPool'));
check('Smart Research line in summary', discord.includes('Smart Research:'));
check('factPool in version embeds', discord.includes('factPoolText'));
check('Category icons mapping', discord.includes('catIcons'));
check('No push().filter() bug', !discord.includes('.push(') || !discord.includes(').filter(Boolean)'));

// ═════════════════════════════════════════
// Summary
// ═════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'═'.repeat(50)}`);

if (failed > 0) {
  console.log('\n🔴 FAILED — มีปัญหาที่ต้องแก้ไข\n');
  process.exit(1);
} else {
  console.log('\n🟢 ALL PASSED — Flow ทั้งหมดถูกต้อง!\n');
  process.exit(0);
}
