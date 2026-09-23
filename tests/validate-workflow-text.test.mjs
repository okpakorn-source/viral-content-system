// ============================================================
// 🧪 ข้อสอบกลุ่มตรวจ "TEXT Pipeline" ใน scripts/validate-workflow.mjs (CFG-04 / DEBT-07)
// ★ 23 ก.ย. 69 (แคมเปญแก้บั๊ก ข้อ 1 · เจ้าของอนุมัติ)
// ------------------------------------------------------------
// ปัญหาเดิม: validator ตรวจแต่ไฟล์สาย URL ที่ปิดแล้ว (summarizeService.js/autoFlowService.js/promptStore.js)
//   ไม่แตะ summarizeServiceText/autoFlowServiceText/promptStoreText/safetyFilter/correction เลย → ท่อข่าวจริงหลุดสายได้เงียบๆ
// สิ่งที่ล็อก:
//   1 repo จริง + คีย์ปลอม (validator แค่ดูว่ามีคีย์ ไม่ยิง API) → N/N ผ่านหมด และกลุ่ม TEXT ✅ ครบทุกข้อ
//   2 ไม่มีคีย์ → ตก 1 ข้อแต่ยัง exit 0 (เกณฑ์ 95% เดิมไม่ถูกบีบให้เข้มขึ้น — กันบิลด์ Vercel ล้ม)
//   3 สำเนาที่มีแต่ไฟล์สาย TEXT → กลุ่ม TEXT ✅ แต่สาย URL ❌ จำนวนมาก → exit 1 (เกณฑ์เดิมยังตัดจริง ไม่ถูกคลาย)
//   4 ทุบในสำเนาชั่วคราว (ไม่แตะไฟล์จริง) → ข้อที่ตรงกันต้องเป็น ❌ และข้อ TEXT อื่นยัง ✅ (กันตรวจแบบเหมารวม):
//     เปลี่ยนชื่อ export · route ต่อผิดโมดูล · ถอด import correction · เหลือ import แต่ไม่เรียกจริง · ลบไฟล์ ·
//     ถอดกฎเหล็ก FACEBOOK SAFETY · safetyFilter ไม่ export sanitizeOutput
//     ★ 24 ก.ย. 69 รอบแก้ผู้ตรวจ (L4) — แบบ "ซ่อนในคอมเมนต์/สตริง" (validator รุ่นก่อนให้ ✅ ทุกข้อด้านล่าง):
//     worker ส่งงานไปที่อื่นแต่คอมเมนต์ยังเอ่ย /api/auto/process · กฎเหล็กเหลือแค่ในคอมเมนต์ · claudeClient คง import
//     แต่การเรียก sanitizeOutput( เหลือแค่ในคอมเมนต์/สตริง · import correction ถูกคอมเมนต์ทิ้ง · export อยู่ในคอมเมนต์บล็อก
// ไม่ได้ตรวจ: พฤติกรรมรันไทม์ของท่อ (เป็นหน้าที่ของเทสข่าวไฟล์อื่น) · ว่า Vercel เรียก prebuild จริงไหม (ดูรายงานแคมเปญ)
// วิธีรัน: node --test tests/validate-workflow-text.test.mjs
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VALIDATOR_REL = 'scripts/validate-workflow.mjs';
const FAKE_KEY = 'sk-test-validator-fake-0000000000';
// ไฟล์ที่กลุ่ม TEXT อ่าน (สำเนาชั่วคราวใช้ชุดนี้ชุดเดียว)
const TEXT_SOURCES = [
  'src/app/api/queue/add/route.js',
  'src/lib/services/queueService.js',
  'src/app/api/queue/worker/route.js',
  'src/app/api/auto/process/route.js',
  'src/lib/services/autoFlowServiceText.js',
  'src/lib/services/summarizeServiceText.js',
  'src/lib/ai/promptStoreText.js',
  'src/lib/ai/safetyFilter.js',
  'src/lib/correction/correctionPipeline.js',
  'src/lib/utils/publishablePostText.js',
  'src/lib/ai/claudeClient.js',
];

function runValidator(root, { withKey = true } = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/API_?KEY|TOKEN|SECRET/i.test(k)) delete env[k];
  if (withKey) env.OPENAI_API_KEY = FAKE_KEY;
  const r = spawnSync(process.execPath, [join(root, VALIDATOR_REL)], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const checks = new Map();
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\s+(✅|❌) (.+?)(?: — .*)?$/);
    if (m) checks.set(m[2].trim(), m[1] === '✅');
  }
  const textChecks = [...checks].filter(([name]) => name.startsWith('TEXT: '));
  return { code: r.status, out, checks, textChecks };
}

function withSandbox(mutate, fn) {
  const root = mkdtempSync(join(tmpdir(), 'news-validator-'));
  try {
    for (const rel of [VALIDATOR_REL, ...TEXT_SOURCES]) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      copyFileSync(join(ROOT, rel), join(root, rel));
    }
    mutate?.(root);
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function replaceIn(root, rel, from, to) {
  const abs = join(root, rel);
  const before = readFileSync(abs, 'utf8');
  const after = typeof from === 'string' ? before.split(from).join(to) : before.replace(from, to);
  assert.notEqual(after, before, `ทุบไม่เกิดผล (${rel}): ${String(from).slice(0, 60)}`);
  writeFileSync(abs, after);
}

function appendIn(root, rel, text) {
  const abs = join(root, rel);
  writeFileSync(abs, readFileSync(abs, 'utf8') + text);
}

test('1 repo จริง + คีย์ (ปลอม) → ผ่าน N/N และกลุ่ม TEXT ✅ ครบ', () => {
  const r = runValidator(ROOT);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /❌ Failed: 0/);
  assert.match(r.out, /ALL CHECKS PASSED/);
  const total = Number(r.out.match(/Total checks: (\d+)/)?.[1]);
  const passed = Number(r.out.match(/✅ Passed: (\d+)/)?.[1]);
  assert.equal(passed, total, `ต้องได้ N/N (ได้ ${passed}/${total})`);
  assert.ok(r.textChecks.length >= 25, `กลุ่ม TEXT ต้องมีครบ (พบ ${r.textChecks.length})`);
  assert.deepEqual(r.textChecks.filter(([, ok]) => !ok), []);
});

test('2 ไม่มีคีย์ → ตก 1 ข้อแต่ยังผ่านเกณฑ์ 95% เดิม (ไม่บีบให้บิลด์ Vercel ล้ม)', () => {
  const r = runValidator(ROOT, { withKey: false });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.checks.get('OPENAI_API_KEY'), false);
  assert.match(r.out, /Minor issues found/);
});

test('3 สำเนาที่มีแต่ไฟล์สาย TEXT → TEXT ✅ ครบ แต่สาย URL ❌ จำนวนมากจน exit 1 (เกณฑ์เดิมยังตัดจริง)', () => withSandbox(null, (root) => {
  const r = runValidator(root);
  assert.deepEqual(r.textChecks.filter(([, ok]) => !ok), [], 'สำเนาที่ไม่ทุบ กลุ่ม TEXT ต้องผ่านหมด');
  assert.ok(r.textChecks.length >= 25);
  assert.equal(r.code, 1, 'ไฟล์สาย URL หายหลายไฟล์ ต้องไม่ผ่านเกณฑ์ 95%');
  assert.match(r.out, /VALIDATION FAILED/);
}));

const MUTATIONS = [
  {
    name: 'เปลี่ยนชื่อ export processAutoFlowText',
    expectRed: ['TEXT: autoFlowServiceText export processAutoFlowText'],
    mutate: (root) => replaceIn(root, 'src/lib/services/autoFlowServiceText.js', 'export async function processAutoFlowText(', 'export async function processAutoFlowTextRenamed('),
  },
  {
    name: 'route ต่อผิดโมดูล (กลับไปสาย URL)',
    expectRed: ['TEXT: /api/auto/process → processAutoFlowText'],
    mutate: (root) => replaceIn(root, 'src/app/api/auto/process/route.js',
      "import { processAutoFlowText } from '@/lib/services/autoFlowServiceText';",
      "import { processAutoFlowText } from '@/lib/services/autoFlowService';"),
  },
  {
    name: 'ถอด import ด่าน correction ออกจากสาย TEXT',
    expectRed: ['TEXT: autoFlowServiceText → runCorrectionPipeline (correction)'],
    mutate: (root) => replaceIn(root, 'src/lib/services/autoFlowServiceText.js',
      "import { runCorrectionPipeline } from '@/lib/correction/correctionPipeline';",
      'const runCorrectionPipeline = async (versions) => versions;'),
  },
  {
    name: 'คง import correction แต่ไม่เรียกจริง',
    expectRed: ['TEXT: autoFlowServiceText → runCorrectionPipeline (correction)'],
    mutate: (root) => replaceIn(root, 'src/lib/services/autoFlowServiceText.js', /\brunCorrectionPipeline\s*\(/g, 'skipCorrection('),
  },
  {
    name: 'ลบไฟล์ publishablePostText',
    expectRed: [
      'TEXT: src/lib/utils/publishablePostText.js',
      'TEXT: publishablePostText export getPublishablePostText/buildPublishableAnalysisResult/enforceTextNewsPublicationFloor',
    ],
    mutate: (root) => rmSync(join(root, 'src/lib/utils/publishablePostText.js')),
  },
  {
    name: 'ถอดกฎเหล็ก FACEBOOK SAFETY ออกจากพรอมต์สาย TEXT',
    expectRed: ['TEXT: summarizeServiceText มีกฎเหล็ก FACEBOOK SAFETY ในพรอมต์'],
    mutate: (root) => replaceIn(root, 'src/lib/services/summarizeServiceText.js', 'กฎเหล็ก FACEBOOK SAFETY', 'กฎ SAFETY'),
  },
  {
    name: 'safetyFilter ไม่ export sanitizeOutput',
    expectRed: ['TEXT: safetyFilter export sanitizeOutput'],
    mutate: (root) => replaceIn(root, 'src/lib/ai/safetyFilter.js', 'export function sanitizeOutput(', 'function sanitizeOutput('),
  },
  // ── แบบซ่อนในคอมเมนต์/สตริง (L4) ──
  {
    name: 'worker ส่งงานข่าวไปที่อื่น แต่คอมเมนต์ยังเอ่ย /api/auto/process',
    expectRed: ['TEXT: queue worker → /api/auto/process'],
    mutate: (root) => replaceIn(root, 'src/app/api/queue/worker/route.js', '`${baseUrl}/api/auto/process`', '`${baseUrl}/api/auto/elsewhere`'),
  },
  {
    name: 'กฎเหล็ก FACEBOOK SAFETY หายจากพรอมต์ เหลือแค่ในคอมเมนต์',
    expectRed: ['TEXT: summarizeServiceText มีกฎเหล็ก FACEBOOK SAFETY ในพรอมต์'],
    mutate: (root) => {
      replaceIn(root, 'src/lib/services/summarizeServiceText.js', 'กฎเหล็ก FACEBOOK SAFETY', 'กฎ SAFETY');
      appendIn(root, 'src/lib/services/summarizeServiceText.js', '\n// กฎเหล็ก FACEBOOK SAFETY — ย้ายออกจากพรอมต์แล้ว เหลือแค่คอมเมนต์นี้\n');
    },
  },
  {
    name: 'claudeClient คง import sanitizeOutput แต่การเรียกเหลือแค่ในคอมเมนต์/สตริง',
    expectRed: ['TEXT: claudeClient (นักเขียนหลัก) → sanitizeOutput (safetyFilter)'],
    mutate: (root) => {
      replaceIn(root, 'src/lib/ai/claudeClient.js', /\bsanitizeOutput\(JSON\.parse\(/g, '/* sanitizeOutput( */ (JSON.parse(');
      appendIn(root, 'src/lib/ai/claudeClient.js', "\nexport const __sanitizeNote = 'sanitizeOutput(x) ปิดชั่วคราว';\n");
    },
  },
  {
    name: 'import ด่าน correction ถูกคอมเมนต์ทิ้ง (เรียกตัวปลอมในไฟล์แทน)',
    expectRed: ['TEXT: autoFlowServiceText → runCorrectionPipeline (correction)'],
    mutate: (root) => replaceIn(root, 'src/lib/services/autoFlowServiceText.js',
      "import { runCorrectionPipeline } from '@/lib/correction/correctionPipeline';",
      "// import { runCorrectionPipeline } from '@/lib/correction/correctionPipeline';\nconst runCorrectionPipeline = async (versions) => versions;"),
  },
  {
    name: 'export sanitizeOutput อยู่แค่ในคอมเมนต์บล็อก',
    expectRed: ['TEXT: safetyFilter export sanitizeOutput'],
    mutate: (root) => {
      replaceIn(root, 'src/lib/ai/safetyFilter.js', 'export function sanitizeOutput(', 'function sanitizeOutput(');
      appendIn(root, 'src/lib/ai/safetyFilter.js', '\n/*\nexport function sanitizeOutput(value) { return value; }\n*/\n');
    },
  },
];

for (const m of MUTATIONS) {
  test(`4 ทุบ: ${m.name} → ข้อที่ตรงกันเป็น ❌ · ข้อ TEXT อื่นยัง ✅`, () => withSandbox(m.mutate, (root) => {
    const r = runValidator(root);
    const red = r.textChecks.filter(([, ok]) => !ok).map(([name]) => name).sort();
    assert.deepEqual(red, [...m.expectRed].sort(), r.out);
  }));
}
