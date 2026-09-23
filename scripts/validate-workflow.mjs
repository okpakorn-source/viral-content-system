/**
 * ========================================
 * WORKFLOW VALIDATOR — ตรวจสอบระบบทุกจุดเชื่อมต่อ
 * ========================================
 * 
 * ⚠️ คำสั่งถาวร: ต้องรัน script นี้ทุกครั้งที่แก้ไขระบบ
 * ห้ามข้ามขั้นตอนนี้เด็ดขาด
 * 
 * ใช้: node scripts/validate-workflow.mjs
 * 
 * ตรวจสอบ:
 * 1. ไฟล์ทุกไฟล์ที่จำเป็นมีอยู่จริง
 * 2. Import/Export เชื่อมต่อถูกต้อง
 * 3. API Keys ตั้งค่าแล้ว
 * 4. Prompt templates ครบ
 * 5. DB schema พร้อม
 * 6. ทุก step ของ workflow เชื่อมต่อกัน
 * 7. ★ 23 ก.ย. 69 (แคมเปญแก้บั๊ก ข้อ 1 · เจ้าของอนุมัติ) — CFG-04/DEBT-07: สาย TEXT ที่ข่าวจริงวิ่ง
 *    (Discord → /api/queue/add → queue worker → /api/auto/process → autoFlowServiceText → summarizeServiceText
 *    → promptStoreText/aiRouter → correction/correctionPipeline → publishablePostText) — ไฟล์มีอยู่ + export จริง
 *    + import/เรียกใช้จริง · เดิมตรวจแต่ไฟล์สาย URL ที่ปิดแล้ว · กลุ่มนี้นับใน Total (เกณฑ์ 95% เดิมไม่แตะ)
 *    ★ 24 ก.ย. 69 (L4): ทุกข้อ TEXT ตรวจบนซอร์สที่ตัดคอมเมนต์แล้ว — ข้อความ/import/การเรียกที่อยู่แค่ในคอมเมนต์ไม่นับ
 *    ข้อสอบ: tests/validate-workflow-text.test.mjs (ทุบ export/import ในสำเนาชั่วคราวแล้วต้องขึ้น ❌ · รวมแบบซ่อนในคอมเมนต์)
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;
const issues = [];

function check(name, condition, detail = '') {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`  ✅ ${name}`);
  } else {
    failedChecks++;
    const msg = `${name}${detail ? ' — ' + detail : ''}`;
    issues.push(msg);
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function fileExists(relativePath) {
  return existsSync(resolve(ROOT, relativePath));
}

function fileContains(relativePath, searchStr) {
  if (!fileExists(relativePath)) return false;
  const content = readFileSync(resolve(ROOT, relativePath), 'utf-8');
  return content.includes(searchStr);
}

function fileContainsAll(relativePath, searches) {
  if (!fileExists(relativePath)) return false;
  const content = readFileSync(resolve(ROOT, relativePath), 'utf-8');
  return searches.every(s => content.includes(s));
}

console.log('\n========================================');
console.log('🔬 WORKFLOW VALIDATOR — Full System Check');
console.log('========================================\n');

// ============================================
// 1. CRITICAL FILES CHECK
// ============================================
console.log('📁 [1/7] Critical Files...');
const criticalFiles = [
  'src/app/api/summarize/route.js',
  'src/lib/services/summarizeService.js',
  'src/lib/services/autoFlowService.js',
  'src/lib/services/imageEnhanceService.js',
  'src/lib/services/imageTextService.js',
  'src/app/api/extract/route.js',
  'src/app/api/workflow/route.js',
  'src/app/api/settings/route.js',
  'src/app/content/new/page.js',
  'src/lib/ai/openai.js',
  'src/lib/ai/promptStore.js',
  'src/lib/ai/aiRouter.js',
  'src/lib/ai/claudeClient.js',
  'src/lib/ai/geminiClient.js',
  'src/lib/ai/moderationAgent.js',
  'src/lib/agents/masterAgent.js',
  'src/lib/workflow/workflowEngine.js',
  'src/lib/db.js',
  'prisma/schema.prisma',
];
criticalFiles.forEach(f => check(f, fileExists(f), 'ไฟล์หายไป!'));

// ============================================
// 2. API KEYS CHECK
// ============================================
console.log('\n🔑 [2/7] API Keys...');
const envPath = resolve(ROOT, '.env');
// Vercel ไม่มี .env file → เช็คจาก process.env แทน
const getEnvValue = (key) => {
  // ลอง .env file ก่อน
  if (fileExists('.env')) {
    const envContent = readFileSync(envPath, 'utf-8');
    const match = envContent.match(new RegExp(`^${key}=(.+)$`, 'm'));
    if (match && match[1].trim().length > 5) return match[1].trim();
  }
  // Fallback: process.env (Vercel)
  return process.env[key] || '';
};

check('OPENAI_API_KEY', getEnvValue('OPENAI_API_KEY').length > 10, 'ต้องมี — ระบบหลักใช้ GPT-4o');
// Claude/Gemini/Firecrawl เป็น optional — warn แต่ไม่ fail
const firecrawl = getEnvValue('FIRECRAWL_API_KEY').length > 5;
const claude = getEnvValue('ANTHROPIC_API_KEY').length > 10;
const gemini = getEnvValue('GEMINI_API_KEY').length > 10;
if (firecrawl) { check('FIRECRAWL_API_KEY', true); } else { console.log('  ⚠️  FIRECRAWL_API_KEY — ไม่มี (ดึง URL จะใช้ fallback)'); totalChecks++; passedChecks++; }
if (claude) { check('ANTHROPIC_API_KEY', true); } else { console.log('  ⚠️  ANTHROPIC_API_KEY — ไม่มี (จะใช้ GPT-4o แทน Claude)'); totalChecks++; passedChecks++; }
if (gemini) { check('GEMINI_API_KEY', true); } else { console.log('  ⚠️  GEMINI_API_KEY — ไม่มี (จะใช้ GPT-4o แทน Gemini)'); totalChecks++; passedChecks++; }

// ============================================
// 3. IMPORT/EXPORT CHAIN CHECK
// ============================================
console.log('\n🔗 [3/7] Import/Export Chain...');

// summarizeService.js imports
check('summarizeService.js → callAI', fileContains('src/lib/services/summarizeService.js', "import { callAI }"), 'Missing callAI import');
check('summarizeService.js → promptStore', fileContains('src/lib/services/summarizeService.js', "import { getPrompt"), 'Missing promptStore import');
check('summarizeService.js → workflowEngine', fileContains('src/lib/services/summarizeService.js', "import { getWorkflow"), 'Missing workflowEngine import');
check('summarizeService.js → MasterAgent', fileContains('src/lib/services/summarizeService.js', "import { MasterAgent }"), 'Missing MasterAgent import');
check('summarizeService.js → aiRouter', fileContains('src/lib/services/summarizeService.js', "import { callSmartAI"), 'Missing aiRouter import');
check('summarizeService.js → moderationAgent', fileContains('src/lib/services/summarizeService.js', "import { moderateVersions }"), 'Missing moderationAgent import');

// aiRouter imports
check('aiRouter → callAI', fileContains('src/lib/ai/aiRouter.js', "import { callAI }"), 'Missing callAI import');
check('aiRouter → callClaude', fileContains('src/lib/ai/aiRouter.js', "import { callClaude"), 'Missing callClaude import');
check('aiRouter → callGemini', fileContains('src/lib/ai/aiRouter.js', "import { callGemini"), 'Missing callGemini import');

// moderationAgent imports
check('moderationAgent → getOpenAIClient', fileContains('src/lib/ai/moderationAgent.js', "import { getOpenAIClient }"), 'Missing getOpenAIClient import');

// masterAgent imports
check('masterAgent → prisma', fileContains('src/lib/agents/masterAgent.js', "import { prisma }"), 'Missing prisma import');

// ============================================
// 4. WORKFLOW STEPS CONNECTION CHECK
// ============================================
console.log('\n🔄 [4/7] Workflow Steps Connection...');

const routeContent = fileExists('src/lib/services/summarizeService.js') 
  ? readFileSync(resolve(ROOT, 'src/lib/services/summarizeService.js'), 'utf-8') : '';

// Step 2: Extract
check('Step2: mode=extract handler', routeContent.includes("mode === 'extract'"), 'ไม่มี extract mode');
check('Step2: callSmartAI(extract)', routeContent.includes("callSmartAI('extract'"), 'ไม่ได้ใช้ SmartAI สำหรับ extract');
check('Step2: saveExtraction', routeContent.includes('saveExtraction(workflowId'), 'ไม่ save ลง DB');
check('Step2: MasterAgent update', routeContent.includes('agent.onExtractionComplete'), 'ไม่ update MasterAgent');

// Step 3: Breakdown
check('Step3: mode=breakdown handler', routeContent.includes("mode === 'breakdown'"), 'ไม่มี breakdown mode');
check('Step3: getPrompt(breakdown)', routeContent.includes("getPrompt('breakdown')"), 'ไม่โหลด breakdown prompt');
// ตรวจเฉพาะ breakdown section — extract mode ใช้ slice ได้ปกติ
const breakdownSection = routeContent.split("mode === 'breakdown'")[1]?.split("mode === 'analyze'")[0] || '';
check('Step3: full news body (no slice on content)', !breakdownSection.includes("replace('{content}', actualNewsBody.slice") && !breakdownSection.includes("replace('{content}', text.slice"), 'Breakdown ตัด news body ด้วย slice!');
check('Step3: DB context load', routeContent.includes('getWorkflow(workflowId)'), 'ไม่โหลด context จาก DB');
check('Step3: saveBreakdown', routeContent.includes('saveBreakdown(workflowId'), 'ไม่ save ลง DB');
check('Step3: MasterAgent update', routeContent.includes('agent.onBreakdownComplete'), 'ไม่ update MasterAgent');

// Step 4: Analyze
check('Step4: mode=analyze handler', routeContent.includes("mode === 'analyze'"), 'ไม่มี analyze mode');
check('Step4: callSmartAI(write)', routeContent.includes("callSmartAI('write'"), 'ไม่ได้ใช้ SmartAI สำหรับ write');
check('Step4: MasterAgent compileContext', routeContent.includes('agent.compileContext()'), 'ไม่ใช้ MasterAgent context');
check('Step4: moderateVersions', routeContent.includes('moderateVersions(versions)'), 'ไม่มี Moderation check');
check('Step4: saveAnalysis', routeContent.includes('saveAnalysis(workflowId'), 'ไม่ save ลง DB');
check('Step4: MasterAgent update', routeContent.includes('agent.onAnalysisComplete'), 'ไม่ update MasterAgent');
check('Step4: validation', routeContent.includes('validateOutput(result'), 'ไม่มี output validation');

// ============================================
// 5. SAFETY SYSTEM CHECK
// ============================================
console.log('\n🛡️ [5/7] Safety System...');

const openaiContent = fileExists('src/lib/ai/openai.js')
  ? readFileSync(resolve(ROOT, 'src/lib/ai/openai.js'), 'utf-8') : '';

check('Safety: System prompt rules', openaiContent.includes('FACEBOOK SAFETY RULES'), 'ไม่มี safety rules ใน system prompt');
check('Safety: Post-processing filter', openaiContent.includes('sanitizeOutput'), 'ไม่มี post-processing safety filter');
check('Safety: sanitizeOutput from safetyFilter', openaiContent.includes("import { sanitizeOutput } from './safetyFilter'"), 'ไม่ได้ import sanitizeOutput จาก safetyFilter');
check('Safety: sanitizeOutput function exists', fileContains('src/lib/ai/safetyFilter.js', 'function sanitizeOutput'), 'ไม่มี sanitizeOutput function ใน safetyFilter');
check('Safety: User prompt rules', routeContent.includes('กฎเหล็ก FACEBOOK SAFETY'), 'ไม่มี safety rules ใน user prompt');

// ============================================
// 6. PROMPT INTEGRITY CHECK
// ============================================
console.log('\n📝 [6/7] Prompt Integrity...');

const promptContent = fileExists('src/lib/ai/promptStore.js')
  ? readFileSync(resolve(ROOT, 'src/lib/ai/promptStore.js'), 'utf-8') : '';

check('Prompt: extraction template', promptContent.includes("extraction:"), 'ไม่มี extraction prompt');
check('Prompt: breakdown template', promptContent.includes("breakdown:"), 'ไม่มี breakdown prompt');
check('Prompt: 7-step strategist', promptContent.includes('Viral News Angle Strategist'), 'ไม่มี 7-Step prompt');
check('Prompt: 12 angle categories', promptContent.includes('12 หมวด'), 'ไม่มี 12 angle categories');
check('Prompt: {title} placeholder', promptContent.includes('{title}'), 'ไม่มี {title} placeholder');
check('Prompt: {content} placeholder', promptContent.includes('{content}'), 'ไม่มี {content} placeholder');

// ============================================
// 7. DATABASE SCHEMA CHECK
// ============================================
console.log('\n💾 [7/7] Database Schema...');

const schemaContent = fileExists('prisma/schema.prisma')
  ? readFileSync(resolve(ROOT, 'prisma/schema.prisma'), 'utf-8') : '';

check('Schema: WorkflowRun model', schemaContent.includes('model WorkflowRun'), 'ไม่มี WorkflowRun model');
check('Schema: newsBody field', schemaContent.includes('newsBody'), 'ไม่มี newsBody field');
check('Schema: breakdownData field', schemaContent.includes('breakdownData'), 'ไม่มี breakdownData field');
check('Schema: analysisResult field', schemaContent.includes('analysisResult'), 'ไม่มี analysisResult field');
check('Schema: metadata field', schemaContent.includes('metadata'), 'ไม่มี metadata field (MasterAgent)');
check('Schema: PromptTemplate model', schemaContent.includes('model PromptTemplate'), 'ไม่มี PromptTemplate model');

// ============================================
// TEXT PIPELINE — สายข่าวจริง (★ 23 ก.ย. 69 แคมเปญแก้บั๊ก ข้อ 1 · เจ้าของอนุมัติ · CFG-04/DEBT-07)
// ============================================
// ชื่อ export/import ด้านล่างอ่านจากไฟล์จริง ณ 23 ก.ย. 69 (route เรียก processAutoFlowText · service เรียก
// performSummarize/runCorrectionPipeline/buildPublishableAnalysisResult) — ตรวจด้วย regex ของประโยค export/import
// + การเรียกใช้จริง (ไม่ใช่ includes ชื่อลอยๆ ที่เจอในคอมเมนต์ก็ผ่าน)
// ★ 24 ก.ย. 69 รอบแก้ผู้ตรวจ (L4): ทุกข้อในกลุ่มนี้ตรวจบน "ซอร์สที่ตัดคอมเมนต์แล้ว" — เดิม 'queue worker → /api/auto/process'
//   และ 'กฎเหล็ก FACEBOOK SAFETY' ใช้ includes บนไฟล์ดิบ (คอมเมนต์ก็ผ่าน) · import ที่ถูกคอมเมนต์ทิ้งก็ผ่าน ·
//   claudeClient → sanitizeOutput ตรวจแค่ import · ตอนนี้: export/import/คำในพรอมต์ ตรวจบน code (ตัดคอมเมนต์ สตริงคงไว้)
//   และ "การเรียก" ตรวจบน bare (ตัดคอมเมนต์ + เนื้อในสตริง/template/regex) — ชื่อที่อยู่แค่ในคอมเมนต์หรือในสตริงไม่นับว่าเรียก
//   ตัวแยก (splitJsSource) ทวนกับ acorn 24 ก.ย. 69: ตรงกันทั้ง code และชุดการเรียก ทุกไฟล์ .js/.mjs ของ src/ scripts/
//   tests/ discord-bot/ ที่ acorn parse ได้ (697 ไฟล์) · ข้อสอบ: tests/validate-workflow-text.test.mjs ข้อ 4 (ทุบแบบซ่อนในคอมเมนต์)
console.log('\n📰 [TEXT] TEXT Pipeline (Discord → queue → /api/auto/process → autoFlowServiceText → …)...');

const REGEX_AFTER_WORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const IDENT_CHAR = /[\w$\u0080-￿]/;
/**
 * ซอร์ส JS → { code, bare } ในรอบเดียว · code = ตัดคอมเมนต์ // และ /* *\/ (สตริงคงไว้ · ขึ้นบรรทัดใหม่ของคอมเมนต์คงไว้
 * ^export จึงยังอยู่ต้นบรรทัด) · bare = code ที่ลบเนื้อในสตริง '…' "…" / ข้อความใน template `…${expr}…` (expr คงไว้) / regex
 * แยก regex กับเครื่องหมายหารแบบ tokenizer ทั่วไป (หลังค่า = หาร · หลังตัวดำเนินการ/keyword = regex)
 */
function splitJsSource(src) {
  let code = '';
  let bare = '';
  const n = src.length;
  let i = 0;
  if (src.startsWith('#!')) { while (i < n && src[i] !== '\n' && src[i] !== '\r') i += 1; }
  const templateBraces = []; // ระดับวงเล็บปีกกาตอนเปิด ${ ของ template แต่ละชั้น
  let braces = 0;
  let valueEnd = false; // โทเคนก่อนหน้าเป็น "ค่า" (ชื่อ/ตัวเลข/สตริง/ปิดวงเล็บ) → '/' ถัดไปคือหาร
  let word = '';
  const both = (text) => { code += text; bare += text; };
  const readTemplateText = () => {
    while (i < n) {
      const ch = src[i];
      if (ch === '\\') { code += src.slice(i, i + 2); i += 2; continue; }
      if (ch === '`') { both(ch); i += 1; valueEnd = true; return; }
      if (ch === '$' && src[i + 1] === '{') { both('${'); i += 2; templateBraces.push(braces); braces += 1; valueEnd = false; return; }
      code += ch; i += 1;
    }
  };
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      while (i < n && src[i] !== '\n' && src[i] !== '\r') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      both(` ${src.slice(i, stop).replace(/[^\r\n]/g, '')}`);
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && src[j] !== ch && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      code += src.slice(i, j + 1);
      bare += ch + ch;
      i = j + 1; valueEnd = true; word = '';
      continue;
    }
    if (ch === '`') { both(ch); i += 1; word = ''; readTemplateText(); continue; }
    if (ch === '{') { braces += 1; both(ch); i += 1; valueEnd = false; word = ''; continue; }
    if (ch === '}') {
      braces -= 1; both(ch); i += 1; word = '';
      if (templateBraces.length && templateBraces[templateBraces.length - 1] === braces) { templateBraces.pop(); readTemplateText(); continue; }
      valueEnd = true;
      continue;
    }
    if (ch === '/' && (!valueEnd || REGEX_AFTER_WORDS.has(word))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n') {
        const c = src[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        j += 1;
      }
      j += 1;
      while (j < n && /[a-z]/i.test(src[j])) j += 1;
      code += src.slice(i, j);
      bare += '/ /';
      i = j; valueEnd = true; word = '';
      continue;
    }
    if (IDENT_CHAR.test(ch)) {
      let j = i + 1;
      while (j < n && IDENT_CHAR.test(src[j])) j += 1;
      word = src.slice(i, j);
      both(word); i = j; valueEnd = true;
      continue;
    }
    both(ch); i += 1;
    if (!/\s/.test(ch)) { word = ''; valueEnd = ch === ')' || ch === ']'; }
  }
  return { code, bare };
}

const textViews = new Map();
function textView(relativePath) {
  if (!textViews.has(relativePath)) {
    textViews.set(relativePath, fileExists(relativePath)
      ? splitJsSource(readFileSync(resolve(ROOT, relativePath), 'utf-8'))
      : { code: '', bare: '' });
  }
  return textViews.get(relativePath);
}
const textSource = (relativePath) => textView(relativePath).code; // ตัดคอมเมนต์แล้ว (สตริงคงไว้)
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function textExports(relativePath, name) {
  const n = escapeRe(name);
  return new RegExp(
    `^export\\s+(?:async\\s+)?function\\s*\\*?\\s*${n}\\b|^export\\s+(?:const|let|var|class)\\s+${n}\\b|^export\\s*\\{[^}]*\\b${n}\\b[^}]*\\}`,
    'm',
  ).test(textSource(relativePath));
}
function textImports(relativePath, name, fromSpec) {
  return new RegExp(`import\\s*\\{[^}]*\\b${escapeRe(name)}\\b[^}]*\\}\\s*from\\s*['"]${escapeRe(fromSpec)}(?:\\.js)?['"]`)
    .test(textSource(relativePath));
}
// การเรียกจริง = ชื่อ( ในโค้ดที่ลบคอมเมนต์และเนื้อในสตริงแล้ว (`import { x }` ไม่มี '(' จึงไม่นับเป็นการเรียก)
const textCalls = (relativePath, name) => new RegExp(`(?<![\\w$])${escapeRe(name)}\\s*\\(`).test(textView(relativePath).bare);
const textWired = (relativePath, name, fromSpec) => textImports(relativePath, name, fromSpec) && textCalls(relativePath, name);

const TEXT_FILES = {
  queueAdd: 'src/app/api/queue/add/route.js',
  queueService: 'src/lib/services/queueService.js',
  queueWorker: 'src/app/api/queue/worker/route.js',
  processRoute: 'src/app/api/auto/process/route.js',
  autoFlow: 'src/lib/services/autoFlowServiceText.js',
  summarize: 'src/lib/services/summarizeServiceText.js',
  promptStore: 'src/lib/ai/promptStoreText.js',
  safetyFilter: 'src/lib/ai/safetyFilter.js',
  correction: 'src/lib/correction/correctionPipeline.js',
  publishable: 'src/lib/utils/publishablePostText.js',
};
Object.values(TEXT_FILES).forEach((f) => check(`TEXT: ${f}`, fileExists(f), 'ไฟล์สาย TEXT หายไป!'));

check('TEXT: queueService export enqueueJob', textExports(TEXT_FILES.queueService, 'enqueueJob'), 'ไม่มี export enqueueJob');
check('TEXT: autoFlowServiceText export processAutoFlowText', textExports(TEXT_FILES.autoFlow, 'processAutoFlowText'), 'ไม่มี export processAutoFlowText');
check('TEXT: summarizeServiceText export performSummarize', textExports(TEXT_FILES.summarize, 'performSummarize'), 'ไม่มี export performSummarize');
check('TEXT: promptStoreText export getPrompt', textExports(TEXT_FILES.promptStore, 'getPrompt'), 'ไม่มี export getPrompt');
check('TEXT: safetyFilter export sanitizeOutput', textExports(TEXT_FILES.safetyFilter, 'sanitizeOutput'), 'ไม่มี export sanitizeOutput');
check('TEXT: correctionPipeline export runCorrectionPipeline', textExports(TEXT_FILES.correction, 'runCorrectionPipeline'), 'ไม่มี export runCorrectionPipeline');
check('TEXT: publishablePostText export getPublishablePostText/buildPublishableAnalysisResult/enforceTextNewsPublicationFloor',
  ['getPublishablePostText', 'buildPublishableAnalysisResult', 'enforceTextNewsPublicationFloor'].every((n) => textExports(TEXT_FILES.publishable, n)),
  'export ของตัวประกอบโพสต์ที่เผยแพร่ได้ไม่ครบ');

check('TEXT: /api/queue/add → enqueueJob (queueService)', textWired(TEXT_FILES.queueAdd, 'enqueueJob', '@/lib/services/queueService'), 'queue ingress ไม่ได้ส่งงานเข้าคิว');
check('TEXT: queue worker → /api/auto/process', /\/api\/auto\/process(?![\w/-])/.test(textSource(TEXT_FILES.queueWorker)), 'worker ไม่ได้ส่งงานข่าวต่อให้ /api/auto/process (นับเฉพาะในโค้ด ไม่นับคอมเมนต์)');
check('TEXT: /api/auto/process → processAutoFlowText', textWired(TEXT_FILES.processRoute, 'processAutoFlowText', '@/lib/services/autoFlowServiceText'), 'route ไม่ได้เรียกสาย TEXT');
check('TEXT: autoFlowServiceText → performSummarize (summarizeServiceText)', textWired(TEXT_FILES.autoFlow, 'performSummarize', '@/lib/services/summarizeServiceText'), 'ไม่ได้ต่อ summarizeServiceText');
check('TEXT: autoFlowServiceText → runCorrectionPipeline (correction)', textWired(TEXT_FILES.autoFlow, 'runCorrectionPipeline', '@/lib/correction/correctionPipeline'), 'ไม่ได้ต่อด่านแก้ไข correction');
check('TEXT: autoFlowServiceText → publishablePostText (buildPublishableAnalysisResult/enforceTextNewsPublicationFloor)',
  textWired(TEXT_FILES.autoFlow, 'buildPublishableAnalysisResult', '@/lib/utils/publishablePostText')
  && textWired(TEXT_FILES.autoFlow, 'enforceTextNewsPublicationFloor', '@/lib/utils/publishablePostText'),
  'ไม่ได้ประกอบผลผ่าน publishablePostText');
check('TEXT: summarizeServiceText → getPrompt (promptStoreText)', textWired(TEXT_FILES.summarize, 'getPrompt', '@/lib/ai/promptStoreText'), 'ไม่ได้โหลดพรอมต์สาย TEXT');
check('TEXT: summarizeServiceText → callSmartAI (aiRouter)', textWired(TEXT_FILES.summarize, 'callSmartAI', '@/lib/ai/aiRouter'), 'ไม่ได้เรียกโมเดลผ่าน aiRouter');
check('TEXT: summarizeServiceText มีกฎเหล็ก FACEBOOK SAFETY ในพรอมต์', textSource(TEXT_FILES.summarize).includes('กฎเหล็ก FACEBOOK SAFETY'), 'ไม่มี safety rules ใน prompt สาย TEXT (นับเฉพาะในโค้ด/สตริงพรอมต์ ไม่นับคอมเมนต์)');
check('TEXT: claudeClient (นักเขียนหลัก) → sanitizeOutput (safetyFilter)', textWired('src/lib/ai/claudeClient.js', 'sanitizeOutput', './safetyFilter'), 'ผลนักเขียนไม่ผ่าน safety filter (ต้อง import และเรียก sanitizeOutput( จริง)');

// ============================================
// REPORT
// ============================================
console.log('\n========================================');
console.log('📊 VALIDATION REPORT');
console.log('========================================');
console.log(`  Total checks: ${totalChecks}`);
console.log(`  ✅ Passed: ${passedChecks}`);
console.log(`  ❌ Failed: ${failedChecks}`);
console.log(`  Score: ${Math.round((passedChecks / totalChecks) * 100)}%`);


const score = Math.round((passedChecks / totalChecks) * 100);
if (issues.length > 0) {
  console.log('\\n⚠️ ISSUES FOUND:');
  issues.forEach((issue, i) => console.log('  ' + (i + 1) + '. ' + issue));
  if (score < 95) {
    console.log('\\n❌ VALIDATION FAILED — Fix critical issues before deploying!');
    process.exit(1);
  } else {
    console.log('\\n⚠️ Minor issues found but score ' + score + '% >= 95% — Proceeding with deploy');
    process.exit(0);
  }
} else {
  console.log('\\n✅ ALL CHECKS PASSED — System ready for deployment!');
  process.exit(0);
}
