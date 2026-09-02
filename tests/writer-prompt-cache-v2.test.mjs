// ★ เฟส 2 "พรอมต์นักเขียน" (2 ก.ย. 69) — ข้อสอบ WRITER_PROMPT_CACHE_V2 + สแนปช็อต "ปิดทุกสวิตช์ = ใบสั่งเดิมไบต์ต่อไบต์"
// รัน: node --test tests/writer-prompt-cache-v2.test.mjs (ไม่ยิง AI · aiRouter รันจริงด้วยไคลเอนต์ปลอมในไฟล์ชั่วคราว · ไม่แตะเน็ต/DB)
// วิธี: ดึงนิพจน์ประกอบ multiPrompt (จาก `let multiPrompt =` ถึงบรรทัดประกอบ) มาประเมินด้วยอินพุตคงที่ 8 ชุด แบบ tests/raw-first-prompt-authority
// สแนปช็อต: sha256 ของผล 8 ชุดจาก "โค้ดก่อนแก้" commit 3199a30b (git show 3199a30b:src/lib/services/summarizeServiceText.js —
//   ตอนนั้นเป็นนิพจน์เดียว prompt + '…' + formalModeRule + … + viralFewshotBlock + … + '}') คำนวณด้วย harness เดียวกันนี้
//   = ee6a3d707bd4d41f7ffbce0fa6879bbe08919044c461a1d1ccd93c982f68ad3d — โค้ดหลังแก้ (แยกก้อน _wpRules*) ต้องได้ค่าเดียวกัน
//   (ถ้าแก้ข้อความกฎในใบสั่งเขียนโดยตั้งใจ ให้คำนวณค่าใหม่ด้วย harness นี้แล้วอัปเดตพร้อมจดเหตุผล — ห้ามเปลี่ยนเงียบ)
// ผลทุบ (2 ก.ย. 69 — ทุบไฟล์จริงแล้วคืนโค้ดเดิมทุกไบต์):
//   M1 สลับลำดับประกอบ (_wpRulesCraft ก่อน _wpRulesQuality)                         ⇒ แดง "สวิตช์ปิด = ใบสั่งเดิมไบต์ต่อไบต์…"
//   M2 ใส่ _writerPolicyBlock หลัง _wpRulesFinal (หลัง JSON)                          ⇒ แดง "บล็อกกฎเฟส 2 ต้องอยู่…ก่อน ✨"
//   M3 ตัด finalizeRawFirst ออกจาก splitWriterPromptForCache (ก้อน 2 ไม่ครอบ RAW)     ⇒ แดง "เปิด WRITER_PROMPT_CACHE_V2…"
//   M4 aiRouter ส่ง promptBlocks เป็น undefined เสมอ (ไม่ใช้ spread มีเงื่อนไข)          ⇒ แดง "aiRouter…ไม่ส่ง = ไม่มีคีย์"
//   M5 ตัด ...(_writerPromptBlocks ? { promptBlocks … }) ออกจากการเรียก callSmartAI      ⇒ แดง "production wiring…"
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as policy from '../src/lib/services/writerPolicyText.js';
import * as lengthPolicy from '../src/lib/ai/legacyLengthRules.js';

const TESTS = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(TESTS, '..');
const SUMMARIZE_PATH = join(ROOT, 'src', 'lib', 'services', 'summarizeServiceText.js');
const ROUTER_PATH = join(ROOT, 'src', 'lib', 'ai', 'aiRouter.js');
const POLICY_PATH = join(ROOT, 'src', 'lib', 'services', 'writerPolicyText.js');
const summarizeSource = readFileSync(SUMMARIZE_PATH, 'utf8').replace(/\r\n/g, '\n');
const routerSource = readFileSync(ROUTER_PATH, 'utf8').replace(/\r\n/g, '\n');

const SNAPSHOT_SHA256_BEFORE_PHASE2 = 'ee6a3d707bd4d41f7ffbce0fa6879bbe08919044c461a1d1ccd93c982f68ad3d';
const FINAL_BEGIN = '=== FINAL RAW AUTHORITY CHECK — ตรวจเงียบ ๆ ก่อนคืน JSON ===';
const FINAL_END = '=== จบ FINAL RAW AUTHORITY CHECK ===';
const RAW_STEP1 = '=== ขั้นที่ 1: อ่านและประเมินเนื้อดิบเต็มก่อนวัตถุดิบอื่น ===';
const ENV_KEYS = ['LEGACY_LENGTH_RULES', 'LENGTH_BY_CONTENT', 'VIRAL_HITS_FORMULA', 'FEELING_ECHO'];

function withCleanEnv(fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  try {
    return fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

/** ดึงนิพจน์ประกอบ multiPrompt — โค้ดใหม่: จบที่บรรทัดประกอบ · โค้ดก่อนแก้: จบที่ `      '}';` (harness เดียวกับตอนคำนวณสแนปช็อต) */
function extractAssembly(source) {
  const start = source.indexOf('    let multiPrompt = ');
  assert.ok(start >= 0, 'ต้องพบ let multiPrompt =');
  const asm = source.indexOf('\n    multiPrompt += _wpRulesHead', start);
  let end;
  if (asm >= 0) end = source.indexOf('\n', asm + 1);
  else {
    const schema = source.indexOf("      '}';", start);
    assert.ok(schema > start, 'ต้องพบจุดจบ JSON schema');
    end = schema + "      '}';".length;
  }
  return source.slice(start, end);
}

const PARAM_NAMES = [
  'prompt', 'formalModeRule', 'viralFewshotBlock', '_writerPolicyBlock', 'targetCount', 'lenCfg',
  'lengthLineAnalyze', 'sentenceQuotaLine', 'finalReminderLengthClause', 'analyzeJsonContentHint',
  'isCardAuthorityR4Enabled', 'isCardAuthorityR6Enabled', 'isEndingPlain', 'isWitnessFactLockEnabled', 'process',
];

/** ประเมินนิพจน์ด้วยอินพุตคงที่ — ตัวช่วยความยาวใช้ของจริง (env สะอาด) · สวิตช์การ์ด/โหมดถ้อยคำ = ค่า production ตั้งต้น */
function evaluateAssembly(slice, { prompt, formalModeRule, viralFewshotBlock, policyBlock = '', targetCount, returnParts = false }) {
  const tail = returnParts
    ? '\nreturn { multiPrompt, _wpRulesHead, _wpRulesQuality, _wpRulesCraft, _wpRulesFinal };'
    : '\nreturn multiPrompt;';
  const fn = new Function(...PARAM_NAMES, `${slice}${tail}`);
  return withCleanEnv(() => fn(
    prompt, formalModeRule, viralFewshotBlock, policyBlock, targetCount, { ...lengthPolicy.NEW_LENGTH_CFG },
    lengthPolicy.lengthLineAnalyze, lengthPolicy.sentenceQuotaLine, lengthPolicy.finalReminderLengthClause, lengthPolicy.analyzeJsonContentHint,
    () => false, () => false, () => false, () => true, { env: {} },
  ));
}

const MATRIX = [];
for (const targetCount of [1, 2]) for (const formalModeRule of ['', '[FORMAL]\n']) for (const viralFewshotBlock of ['', '[FEWSHOT]\n']) {
  MATRIX.push({ prompt: '[PROMPT]\n', formalModeRule, viralFewshotBlock, targetCount });
}

function snapshotHash(source) {
  const slice = extractAssembly(source);
  const outputs = MATRIX.map((inputs) => evaluateAssembly(slice, inputs));
  return { hash: createHash('sha256').update(JSON.stringify(outputs)).digest('hex'), outputs };
}

function extractTopLevelFunction(text, marker) {
  const start = text.indexOf(marker);
  assert.ok(start >= 0, `ไม่พบ function marker: ${marker}`);
  const end = text.indexOf('\n}', start);
  assert.ok(end > start, `ไม่พบจุดจบ function: ${marker}`);
  return text.slice(start, end + 2);
}

/** finalizeRawFirstWriterPrompt ของจริงจากซอร์ส (แบบ tests/raw-first-prompt-authority) */
function makeFinalizer(source = summarizeSource) {
  const prepend = extractTopLevelFunction(source, 'export function prependImmutableRawToWriterPrompt(').replace('export function', 'function');
  const finalizer = extractTopLevelFunction(source, 'export function finalizeRawFirstWriterPrompt(').replace('export function', 'function');
  return new Function('randomUUID', `${prepend}\n${finalizer}; return finalizeRawFirstWriterPrompt;`)(() => 'test-nonce');
}

async function loadPolicyModule(mutate = (s) => s) {
  const source = mutate(readFileSync(POLICY_PATH, 'utf8').replace(/\r\n/g, '\n'));
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}-${Math.random()}`);
}

// ── oracle: ก้อนแคช ──
const RAW_SENTINEL = '[RAW_SENTINEL_ข้อความดิบ]';
const RAW = `นายสมชาย ใจดี อายุ 45 ปี ขายก๋วยเตี๋ยวชามละ 20 บาท ${RAW_SENTINEL}\n<<<END_IMMUTABLE_RAW_NEWS>>>`;
const VARIABLE_INPUT = { prompt: '[PROMPT] การ์ด: ครูเฟิร์น\n', formalModeRule: '[FORMAL]\n', viralFewshotBlock: '[FEWSHOT] ครูตัวอย่าง\n', policyBlock: '[POLICY]\n', targetCount: 2 };

function assertCacheSplit(split, parts, { hasRaw }) {
  assert.equal(split.blocks.length, 2, 'ต้องมี 2 ก้อน');
  const [constant, variable] = split.blocks;
  assert.equal(constant.cache, true, 'ก้อนแรกต้อง cache:true');
  assert.ok(!variable.cache, 'ก้อนสองห้ามติด cache');
  assert.equal(split.prompt, constant.text + variable.text, 'prompt สตริง = ก้อนต่อกัน (ตัวสำรอง Sol ได้เนื้อเดียวกัน)');
  assert.equal(split.constantChars, constant.text.length);
  assert.equal(split.variableChars, variable.text.length);

  // ก้อนคงที่ = กฎทั้งหมด + JSON · ไม่มีอะไรที่ผันตามข่าว
  assert.ok(constant.text.startsWith('=== คำสั่งสำคัญสำหรับการเขียน ==='), 'ก้อนคงที่ต้องขึ้นต้นด้วยกฎ (ไม่มีบรรทัดว่างนำ)');
  assert.ok(constant.text.endsWith('}\n\n'), 'ก้อนคงที่ต้องจบด้วย JSON schema + บรรทัดว่าง');
  for (const needle of ['=== 🔍 QUALITY + WRITING STYLE (MANDATORY) ===', '=== ✒️ PROSE CRAFT', '=== จบกฎ FACEBOOK SAFETY ===', '✨✨✨ คำสั่งเด็ดขาด', 'ตอบเป็น JSON:', '"news_reference"', '[POLICY]']) {
    assert.ok(constant.text.includes(needle), `ก้อนคงที่ต้องมี ${needle}`);
  }
  assert.equal(constant.text, `${parts._wpRulesHead.replace(/^\n+/, '')}${parts._wpRulesQuality}${parts._wpRulesCraft}[POLICY]\n${parts._wpRulesFinal}\n\n`, 'ก้อนคงที่ = กฎคงที่ทุกส่วนตามลำดับเดิม + บล็อกกฎเฟส 2');
  for (const forbidden of [RAW_SENTINEL, 'สมชาย', '[PROMPT]', '[FORMAL]', '[FEWSHOT]', 'ครูเฟิร์น', 'ครูตัวอย่าง', FINAL_BEGIN, RAW_STEP1, 'IMMUTABLE_RAW_NEWS']) {
    assert.ok(!constant.text.includes(forbidden), `ก้อนคงที่ห้ามมี ${forbidden}`);
  }

  // ก้อนผันตามข่าว = RAW-first + วัตถุดิบเดิมตามลำดับ + FINAL RAW AUTHORITY ท้ายสุด
  const order = ['[PROMPT]', '[FORMAL]', '[FEWSHOT]'].map((n) => variable.text.indexOf(n));
  assert.ok(order.every((p) => p >= 0) && order[0] < order[1] && order[1] < order[2], 'วัตถุดิบเดิมต้องอยู่ครบและเรียงลำดับเดิม การ์ด → ทางการ → ครู');
  assert.ok(!variable.text.includes('[POLICY]'), 'บล็อกกฎเฟส 2 ต้องอยู่ก้อนคงที่ ไม่ปนเนื้อดิบ');
  if (hasRaw) {
    assert.ok(variable.text.startsWith(RAW_STEP1), 'เนื้อดิบต้องอยู่หัวก้อนผันตามข่าว (RAW-first ภายในก้อน)');
    const begin = '<<<BEGIN_IMMUTABLE_RAW_NEWS:test-nonce>>>\n';
    const rawStart = variable.text.indexOf(begin) + begin.length;
    assert.ok(rawStart > begin.length, 'ต้องมีกรอบ RAW');
    assert.equal(variable.text.slice(rawStart, rawStart + RAW.length), RAW, 'เนื้อดิบต้องอยู่ครบทุกไบต์ ไม่ถูก trim');
    assert.ok(variable.text.indexOf('[PROMPT]') > rawStart + RAW.length, 'วัตถุดิบต้องอยู่หลังเนื้อดิบ');
    assert.ok(variable.text.endsWith(FINAL_END), 'FINAL RAW AUTHORITY ต้องเป็นก้อนสุดท้ายของพรอมต์ทั้งใบ');
    assert.ok(variable.text.indexOf(FINAL_BEGIN) > order[2], 'FINAL RAW AUTHORITY ต้องอยู่หลังวัตถุดิบทุกชิ้น');
    assert.equal(split.prompt.split(FINAL_BEGIN).length - 1, 1, 'คำเตือนสุดท้ายต้องมีครั้งเดียว');
    assert.ok(split.prompt.endsWith(FINAL_END));
  } else {
    assert.equal(variable.text, VARIABLE_INPUT.prompt + VARIABLE_INPUT.formalModeRule + VARIABLE_INPUT.viralFewshotBlock, 'สาย URL (ไม่มีเนื้อดิบ) = วัตถุดิบเดิมล้วน');
    assert.ok(!split.prompt.includes(FINAL_BEGIN) && !split.prompt.includes(RAW_STEP1), 'ไม่มีเนื้อดิบ = ไม่มี RAW-first/FINAL');
  }
}

function assertProductionWiring(summarize = summarizeSource, router = routerSource) {
  // OFF path เดิมต้องอยู่ครบ (สัญญาเดียวกับ raw-first-prompt-authority)
  const buildStart = summarize.indexOf('    let multiPrompt = prompt;');
  const assembly = summarize.indexOf('    multiPrompt += _wpRulesHead + formalModeRule + _wpRulesQuality + viralFewshotBlock + _wpRulesCraft + _writerPolicyBlock + _wpRulesFinal;');
  // ★ ข้อแก้ ① (2 ก.ย. 69): finalizer รับ _writerFidelity เป็น param 3 (null เมื่อสวิตช์ปิด = ไบต์เดิม)
  const finalizer = summarize.indexOf('multiPrompt = finalizeRawFirstWriterPrompt(rawSourceText, multiPrompt, _writerFidelity);');
  const cacheGate = summarize.indexOf('if (_writerPolicy?.isWriterPromptCacheV2On?.()) {');
  const writerCall = summarize.indexOf("callSmartAI('write', { prompt: multiPrompt,");
  assert.ok(buildStart >= 0, 'ต้องเริ่มด้วย let multiPrompt = prompt;');
  assert.ok(assembly > buildStart, 'ต้องประกอบตามลำดับเดิม: head → formal → quality → fewshot → craft → policy → final');
  assert.ok(finalizer > assembly, 'RAW-first (สวิตช์ปิด) ต้องครอบหลังประกอบครบ');
  assert.ok(cacheGate > finalizer, 'แตกก้อนแคชต้องอยู่หลัง RAW-first เดิม (สวิตช์ปิด = ไม่แตะ)');
  assert.ok(writerCall > cacheGate, 'แตกก้อนเสร็จก่อนส่งให้นักเขียน');
  const cacheBlock = summarize.slice(cacheGate, writerCall);
  assert.match(cacheBlock, /constant: _wpRulesHead \+ _wpRulesQuality \+ _wpRulesCraft \+ _writerPolicyBlock \+ _wpRulesFinal,/u, 'ก้อนคงที่ = กฎทุกส่วน + บล็อกเฟส 2');
  // ★ ข้อแก้ ①: reminder ซื่อตรงต้องอยู่ก้อนผันตามข่าวเสมอ — ไม่มีเนื้อดิบ = ต่อท้าย variable · มีเนื้อดิบ = ผ่าน finalizer 3-arg
  assert.ok(
    cacheBlock.includes("variable: prompt + formalModeRule + viralFewshotBlock + (!_hasImmutableRawSource && _writerFidelity ? `\\n\\n${_writerFidelity.reminder}` : ''),"),
    'ก้อนผันตามข่าว = การ์ด/ทางการ/ครู (+ เตือนซื่อตรงท้ายก้อนเมื่อไม่มีเนื้อดิบและสวิตช์เปิด — สวิตช์ปิด = นิพจน์เดิม)',
  );
  assert.match(cacheBlock, /rawSourceText: _hasImmutableRawSource \? rawSourceText : '',/u);
  assert.match(cacheBlock, /finalizeRawFirst: \(rawText, supporting\) => finalizeRawFirstWriterPrompt\(rawText, supporting, _writerFidelity\),/u, 'ต้องใช้ finalizer ของจริง (RAW-first + FINAL RAW AUTHORITY) ส่ง _writerFidelity ต่อ');
  assert.match(cacheBlock, /\[WriterCacheV2\][^\n]*constantChars[^\n]*variableChars/u, 'ต้อง log ขนาดก้อนคงที่/ผันแปร');
  const callBlock = summarize.slice(writerCall, summarize.indexOf("270000, 'write_inner'", writerCall));
  assert.match(callBlock, /\.\.\.\(_writerPromptBlocks \? \{ promptBlocks: _writerPromptBlocks \} : \{\}\),/u, 'ส่ง promptBlocks เฉพาะเมื่อมี — ไม่มี = ไม่มีคีย์');
  assert.match(summarize, /await import\('@\/lib\/services\/writerPolicyText'\)/u, 'โหลดนโยบายแบบ dynamic ในบล็อก try');
  assert.doesNotMatch(summarize, /^import .*writerPolicyText/mu, 'ห้าม static import (เทสสตับเดิมโหลดไฟล์นี้)');
  assert.match(summarize, /let _writerPolicyBlock = '';[\s\S]*?_writerPolicyBlock = String\(_writerPolicy\.buildWriterPolicyBlock\(\) \|\| ''\);/u);
  // ★ ข้อแก้ ①: _writerFidelity มาจาก buildFidelityRawReminder (optional chaining — โมดูลเก่า/สตับไม่มีฟังก์ชัน = ปิด)
  assert.match(summarize, /let _writerFidelity = null;[\s\S]*?buildFidelityRawReminder\?\.\(\)[\s\S]*?_writerFidelity = \{ reminder: _fidelityReminder, finalCheckLine: String\(_writerPolicy\.buildFidelityFinalCheckLine\?\.\(\) \|\| ''\) \};/u);
  assert.match(summarize, /\} else if \(_writerFidelity\) \{[\s\S]*?multiPrompt = `\$\{multiPrompt\}\\n\\n\$\{_writerFidelity\.reminder\}`;/u, 'ไม่มีเนื้อดิบ = เตือนซื่อตรงท้ายพรอมต์ (เฉพาะสวิตช์เปิด)');

  // aiRouter: ส่งต่อ promptBlocks แบบ optional
  assert.match(router, /const \{ prompt, temperature, maxTokens, systemPrompt, signal, textNewsLengthPolicy = false, promptBlocks \} = options;/u);
  assert.match(router, /\.\.\.\(Array\.isArray\(promptBlocks\) && promptBlocks\.length > 0 \? \{ promptBlocks \} : \{\}\),/u);
  assert.match(router, /const _blocksArg = promptBlocks \? \{ promptBlocks \} : \{\};/u);
  const claudeWrite = router.slice(router.indexOf("case 'claude-write': {"), router.indexOf("case 'writer-sol':"));
  assert.equal((claudeWrite.match(/\.\.\._blocksArg,/gu) || []).length, 2, 'สายนักเขียน Claude ทั้งตัวหลักและตัวสำรองต้องได้ก้อนแคช');
  const sol = router.slice(router.indexOf("case 'writer-sol':"), router.indexOf("case 'gemini':"));
  assert.doesNotMatch(sol, /promptBlocks|_blocksArg/u, 'Sol ใช้ prompt สตริงเดิม');
}

test('สวิตช์ปิด = ใบสั่งเดิมไบต์ต่อไบต์ (sha256 สแนปช็อตจากโค้ดก่อนแก้ 3199a30b · อินพุตคงที่ 8 ชุด)', () => {
  const { hash, outputs } = snapshotHash(summarizeSource);
  assert.equal(hash, SNAPSHOT_SHA256_BEFORE_PHASE2, `ใบสั่งเขียน (สวิตช์ปิด) เปลี่ยนจากสแนปช็อตโค้ดก่อนแก้ — ความยาว ${outputs.map((o) => o.length).join(',')}`);
  assert.ok(outputs.every((o) => o.startsWith('[PROMPT]\n\n\n=== คำสั่งสำคัญสำหรับการเขียน ===') && o.endsWith('}')));
  assert.ok(outputs.every((o) => !o.includes('[POLICY]') && !o.includes('ความยาวเป้าหมาย') && !o.includes('FIDELITY')), 'สวิตช์ปิดต้องไม่มีกฎเฟส 2 โผล่');
  // MATRIX เรียง targetCount → formal → fewshot: [0]=(1,'',''), [1]=(1,'',FEWSHOT), [2]=(1,FORMAL,''), [3]=(1,FORMAL,FEWSHOT), …
  const withFormal = outputs[2];
  assert.ok(withFormal.indexOf('[FORMAL]') > withFormal.indexOf('ห้ามตั้งคำถามปิดท้ายเด็ดขาด') && withFormal.indexOf('[FORMAL]') < withFormal.indexOf('=== 🔍 QUALITY'), 'โหมดทางการยังอยู่ตำแหน่งเดิม (หลังคำสั่งสำคัญ ก่อน QUALITY)');
  const withFewshot = outputs[1];
  assert.ok(withFewshot.indexOf('[FEWSHOT]') > withFewshot.indexOf('ห้ามบอกอารมณ์แทนคนอ่าน') && withFewshot.indexOf('[FEWSHOT]') < withFewshot.indexOf('=== ✒️ PROSE CRAFT'), 'ครูตัวอย่างยังอยู่ตำแหน่งเดิม (หลัง QUALITY ก่อน PROSE CRAFT)');
});

test('บล็อกกฎเฟส 2 ต้องอยู่โซนกฎคงที่: หลัง FACEBOOK SAFETY ก่อน ✨ คำสั่งเด็ดขาด/JSON (= ก่อน FINAL RAW AUTHORITY เสมอ)', () => {
  const slice = extractAssembly(summarizeSource);
  const out = evaluateAssembly(slice, { ...MATRIX[3], policyBlock: '[POLICY]\n' });
  const policyAt = out.indexOf('[POLICY]');
  assert.ok(policyAt > out.indexOf('=== จบกฎ FACEBOOK SAFETY ===\n\n'), 'ต้องอยู่หลัง FACEBOOK SAFETY');
  assert.ok(policyAt < out.indexOf('✨✨✨ คำสั่งเด็ดขาด'), 'ต้องอยู่ก่อนคำสั่งเด็ดขาด/JSON');
  assert.equal(out.split('[POLICY]').length - 1, 1);
  // ครอบ RAW-first แล้ว FINAL RAW AUTHORITY ยังท้ายสุด และบล็อกกฎอยู่ก่อนมัน
  const finalized = makeFinalizer()(RAW, out);
  assert.ok(finalized.indexOf('[POLICY]') < finalized.indexOf(FINAL_BEGIN) && finalized.endsWith(FINAL_END));
  assert.equal(evaluateAssembly(slice, MATRIX[3]).replace('[POLICY]\n', ''), out.replace('[POLICY]\n', ''), 'บล็อกว่าง = ข้อความเดิมทุกไบต์');
});

test('เปิด WRITER_PROMPT_CACHE_V2: blocks[0] คงที่ไม่มีเนื้อดิบ/ชื่อคน · blocks[1] มีดิบขึ้นต้น + วัตถุดิบเดิม · FINAL RAW AUTHORITY ยังท้าย', () => {
  const slice = extractAssembly(summarizeSource);
  const parts = evaluateAssembly(slice, { ...VARIABLE_INPUT, returnParts: true });
  const finalizer = makeFinalizer();
  const constant = parts._wpRulesHead + parts._wpRulesQuality + parts._wpRulesCraft + VARIABLE_INPUT.policyBlock + parts._wpRulesFinal;
  const variable = VARIABLE_INPUT.prompt + VARIABLE_INPUT.formalModeRule + VARIABLE_INPUT.viralFewshotBlock;
  assertCacheSplit(policy.splitWriterPromptForCache({ constant, variable, rawSourceText: RAW, finalizeRawFirst: finalizer }), parts, { hasRaw: true });
  assertCacheSplit(policy.splitWriterPromptForCache({ constant, variable, rawSourceText: '', finalizeRawFirst: finalizer }), parts, { hasRaw: false });
  // เนื้อเดียวกับโหมดปิด (ต่างแค่ลำดับ): ก้อนคงที่ + ก้อนผันแปร ต้องมีทุกส่วนของใบสั่งเดิม
  const off = evaluateAssembly(slice, VARIABLE_INPUT);
  const on = policy.splitWriterPromptForCache({ constant, variable, rawSourceText: '', finalizeRawFirst: finalizer }).prompt;
  assert.equal(on.length, off.length + 2 - 2, 'ความยาวรวมเท่าเดิม (ย้ายบรรทัดว่างนำ 2 ตัวไปท้ายก้อนคงที่)');
  assert.deepEqual([...on].sort().join(''), [...off].sort().join(''), 'ตัวอักษรชุดเดียวกันทุกตัว — แค่สลับลำดับก้อน');
});

test('★ ข้อแก้ ①: เปิด WRITER_FIDELITY_RULES_V2 — reminder อยู่ก้อนผันตามข่าว (blocks[1]) หลังเนื้อดิบ + ข้อตรวจใน FINAL CHECK · ปิด/null = ไบต์เดิม', () => {
  const finalizer = makeFinalizer();
  const slice = extractAssembly(summarizeSource);
  const parts = evaluateAssembly(slice, { ...VARIABLE_INPUT, returnParts: true });
  const constant = parts._wpRulesHead + parts._wpRulesQuality + parts._wpRulesCraft + VARIABLE_INPUT.policyBlock + parts._wpRulesFinal;
  const variable = VARIABLE_INPUT.prompt + VARIABLE_INPUT.formalModeRule + VARIABLE_INPUT.viralFewshotBlock;

  // ปิด: param 3 = null/ไม่ส่ง ต้องได้ไบต์เดิมเป๊ะ (สัญญาสวิตช์ถอย)
  assert.equal(finalizer(RAW, variable, null), finalizer(RAW, variable), 'fidelity=null ต้องเท่ากับเรียกแบบ 2-arg เดิม');

  const savedFid = process.env.WRITER_FIDELITY_RULES_V2;
  process.env.WRITER_FIDELITY_RULES_V2 = '1';
  let fidelity;
  try {
    fidelity = { reminder: policy.buildFidelityRawReminder(), finalCheckLine: policy.buildFidelityFinalCheckLine() };
  } finally {
    if (savedFid === undefined) delete process.env.WRITER_FIDELITY_RULES_V2;
    else process.env.WRITER_FIDELITY_RULES_V2 = savedFid;
  }
  assert.ok(fidelity.reminder.includes('เตือนซื่อตรง') && fidelity.finalCheckLine.startsWith('- '), 'สวิตช์เปิดต้องได้ข้อความจริง');
  assert.equal(policy.buildFidelityRawReminder(), '', 'สวิตช์ปิด (env ปกติของเทส) ต้องว่าง');

  // มีเนื้อดิบ: reminder หลังกรอบ RAW ก่อนวัตถุดิบ + finalCheckLine ใน FINAL CHECK — ทั้งหมดอยู่ blocks[1] เท่านั้น
  const wrapped = (rawText, supporting) => finalizer(rawText, supporting, fidelity);
  const split = policy.splitWriterPromptForCache({ constant, variable, rawSourceText: RAW, finalizeRawFirst: wrapped });
  const [constantBlock, variableBlock] = split.blocks;
  assert.ok(!constantBlock.text.includes('เตือนซื่อตรง') && !constantBlock.text.includes(fidelity.finalCheckLine), 'ก้อน cache:true ห้ามมี reminder/ข้อตรวจซื่อตรง');
  const rawAt = variableBlock.text.indexOf(RAW_SENTINEL);
  const reminderAt = variableBlock.text.indexOf(fidelity.reminder);
  const promptAt = variableBlock.text.indexOf('[PROMPT]');
  assert.ok(rawAt >= 0 && reminderAt > rawAt, 'reminder ต้องอยู่หลังเนื้อดิบ (ทันทีหลังกรอบ RAW-first)');
  assert.ok(promptAt > reminderAt, 'reminder ต้องอยู่ก่อนวัตถุดิบประกอบ');
  assert.equal(variableBlock.text.split(fidelity.reminder).length - 1, 1, 'reminder ต้องมีครั้งเดียว');
  const finalAt = variableBlock.text.indexOf(FINAL_BEGIN);
  const lineAt = variableBlock.text.indexOf(fidelity.finalCheckLine);
  assert.ok(finalAt > promptAt && lineAt > finalAt && lineAt < variableBlock.text.indexOf(FINAL_END), 'ข้อตรวจซื่อตรงต้องเป็นข้อหนึ่งใน FINAL RAW AUTHORITY CHECK');
  assert.ok(variableBlock.text.endsWith(FINAL_END));

  // ไม่มีเนื้อดิบ (สาย URL — จำลอง wiring จริง: ต่อ reminder ท้ายก้อน variable): ยังอยู่ blocks[1] และก้อนคงที่สะอาด
  const noRawSplit = policy.splitWriterPromptForCache({ constant, variable: `${variable}\n\n${fidelity.reminder}`, rawSourceText: '', finalizeRawFirst: wrapped });
  assert.ok(noRawSplit.blocks[1].text.endsWith(fidelity.reminder), 'ไม่มีเนื้อดิบ = reminder ท้ายก้อนผันตามข่าว');
  assert.ok(!noRawSplit.blocks[0].text.includes('เตือนซื่อตรง'));
  assert.ok(!noRawSplit.prompt.includes(FINAL_BEGIN), 'ไม่มีเนื้อดิบ = ไม่มี FINAL CHECK เหมือนเดิม');

  // โหมดปกติ (ไม่แคช): finalizer 3-arg ตรงๆ — reminder หลังกรอบ RAW + ข้อตรวจใน FINAL CHECK และจบด้วย FINAL_END เดิม
  const plain = finalizer(RAW, variable, fidelity);
  assert.ok(plain.indexOf(fidelity.reminder) > plain.indexOf(RAW_SENTINEL) && plain.indexOf(fidelity.reminder) < plain.indexOf('[PROMPT]'));
  assert.ok(plain.indexOf(fidelity.finalCheckLine) > plain.indexOf(FINAL_BEGIN) && plain.endsWith(FINAL_END));
});

test('production wiring: ปิด = RAW-first สตริงเดิม · เปิด = แตกก้อนหลัง RAW-first ก่อนส่งนักเขียน · aiRouter ส่งต่อเฉพาะเมื่อมี', () => {
  assertProductionWiring();
});

test('aiRouter รันจริง (ไคลเอนต์ปลอม): ส่ง promptBlocks ถึง callClaude ครบ · ไม่ส่ง = ไม่มีคีย์ · อาเรย์ว่างไม่ส่ง · Sol ยังได้ prompt สตริง', async () => {
  let source = readFileSync(ROUTER_PATH, 'utf8');
  const stubs = [
    ["import { callAI } from './openai.js';", 'const callAI = async (args) => { globalThis.__WPC_CALLS__.push({ fn: "openai", ...args }); return { versions: [], _modelUsed: "gpt-5.6-sol" }; };'],
    ["import { callClaude, isClaudeAvailable } from './claudeClient.js';", 'const isClaudeAvailable = () => true; const callClaude = async (args) => { globalThis.__WPC_CALLS__.push({ fn: "claude", ...args }); if (globalThis.__WPC_CLAUDE_DOWN__) throw new Error("mock-claude-down"); return { versions: [], _modelUsed: args.model }; };'],
    ["import { callGemini, isGeminiAvailable } from './geminiClient.js';", 'const isGeminiAvailable = () => false; const callGemini = async () => ({});'],
  ];
  for (const [from, to] of stubs) {
    assert.ok(source.includes(from), `aiRouter ต้องมี import: ${from}`);
    source = source.replace(from, to);
  }
  const tmp = join(ROOT, 'src', 'lib', 'ai', `__tmp_writer_cache_router_${process.pid}.mjs`);
  writeFileSync(tmp, source);
  const savedLab = process.env.WRITER_MODEL_LAB;
  delete process.env.WRITER_MODEL_LAB;
  try {
    const { callSmartAI } = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`);
    const blocks = [{ text: 'กฎคงที่', cache: true }, { text: 'ดิบ+การ์ด' }];

    globalThis.__WPC_CALLS__ = [];
    globalThis.__WPC_CLAUDE_DOWN__ = false;
    const withBlocks = await callSmartAI('write', { prompt: 'P', promptBlocks: blocks, textNewsLengthPolicy: true });
    assert.equal(withBlocks.model, 'claude-opus-4-8');
    assert.equal(globalThis.__WPC_CALLS__.length, 1);
    assert.equal(globalThis.__WPC_CALLS__[0].fn, 'claude');
    assert.deepEqual(globalThis.__WPC_CALLS__[0].promptBlocks, blocks, 'ก้อนแคชต้องถึง callClaude ครบทุกก้อน');
    assert.equal(globalThis.__WPC_CALLS__[0].prompt, 'P', 'prompt สตริงยังส่งคู่ไป (preview/สำรอง)');

    globalThis.__WPC_CALLS__ = [];
    await callSmartAI('write', { prompt: 'P', textNewsLengthPolicy: true });
    assert.equal('promptBlocks' in globalThis.__WPC_CALLS__[0], false, 'ไม่ส่ง = ไม่มีคีย์ promptBlocks เลย (อาร์กิวเมนต์เดิมทุกคีย์)');

    globalThis.__WPC_CALLS__ = [];
    await callSmartAI('write', { prompt: 'P', promptBlocks: [], textNewsLengthPolicy: true });
    assert.equal('promptBlocks' in globalThis.__WPC_CALLS__[0], false, 'อาเรย์ว่างต้องไม่ส่ง');

    // นักเขียน Claude ล้มทั้งหลักและสำรอง → Sol ได้ prompt สตริง ไม่ได้ promptBlocks
    globalThis.__WPC_CALLS__ = [];
    globalThis.__WPC_CLAUDE_DOWN__ = true;
    const fallback = await callSmartAI('write', { prompt: 'P', promptBlocks: blocks, textNewsLengthPolicy: true });
    assert.equal(fallback.model, 'gpt-5.6-sol');
    const claudeCalls = globalThis.__WPC_CALLS__.filter((c) => c.fn === 'claude');
    const solCalls = globalThis.__WPC_CALLS__.filter((c) => c.fn === 'openai');
    assert.equal(claudeCalls.length, 2, 'หลัก + สำรอง Claude อย่างละครั้ง');
    assert.ok(claudeCalls.every((c) => c.promptBlocks === blocks), 'ตัวสำรอง Claude ก็ได้ก้อนแคช');
    assert.equal(solCalls.length, 1);
    assert.equal(solCalls[0].prompt, 'P');
    assert.equal('promptBlocks' in solCalls[0], false, 'Sol ไม่รู้จัก promptBlocks — ต้องไม่ถูกส่ง');
  } finally {
    rmSync(tmp, { force: true });
    if (savedLab === undefined) delete process.env.WRITER_MODEL_LAB;
    else process.env.WRITER_MODEL_LAB = savedLab;
    delete globalThis.__WPC_CALLS__;
    delete globalThis.__WPC_CLAUDE_DOWN__;
  }
});

test('mutation oracle: สลับลำดับประกอบ / ย้ายบล็อกไปหลัง JSON / ถอด RAW-first จากก้อนแคช / ถอด promptBlocks ออกจากการเรียก ⇒ ต้องแดง', async () => {
  const swapped = summarizeSource.replace(
    'multiPrompt += _wpRulesHead + formalModeRule + _wpRulesQuality + viralFewshotBlock + _wpRulesCraft + _writerPolicyBlock + _wpRulesFinal;',
    'multiPrompt += _wpRulesHead + formalModeRule + _wpRulesCraft + viralFewshotBlock + _wpRulesQuality + _writerPolicyBlock + _wpRulesFinal;',
  );
  assert.notEqual(swapped, summarizeSource, 'mutation M1 ต้องเกิดจริง');
  assert.notEqual(snapshotHash(swapped).hash, SNAPSHOT_SHA256_BEFORE_PHASE2, 'สลับลำดับกฎแล้วสแนปช็อตต้องไม่ตรง');

  const policyAfterJson = summarizeSource.replace(
    'multiPrompt += _wpRulesHead + formalModeRule + _wpRulesQuality + viralFewshotBlock + _wpRulesCraft + _writerPolicyBlock + _wpRulesFinal;',
    'multiPrompt += _wpRulesHead + formalModeRule + _wpRulesQuality + viralFewshotBlock + _wpRulesCraft + _wpRulesFinal + _writerPolicyBlock;',
  );
  assert.notEqual(policyAfterJson, summarizeSource, 'mutation M2 ต้องเกิดจริง');
  assert.equal(snapshotHash(policyAfterJson).hash, SNAPSHOT_SHA256_BEFORE_PHASE2, 'บล็อกว่างจึงยังตรงสแนปช็อต — ต้องพึ่ง oracle ตำแหน่ง');
  const out = evaluateAssembly(extractAssembly(policyAfterJson), { ...MATRIX[3], policyBlock: '[POLICY]\n' });
  assert.throws(() => assert.ok(out.indexOf('[POLICY]') < out.indexOf('✨✨✨ คำสั่งเด็ดขาด')), 'บล็อกหลัง JSON ต้องถูกจับ');

  const noRawFirst = await loadPolicyModule((s) => {
    const mutated = s.replace('const variableBlock = hasRaw ? String(finalizeRawFirst(rawSourceText, supporting)) : supporting;', 'const variableBlock = supporting;');
    assert.notEqual(mutated, s, 'mutation M3 ต้องเกิดจริง');
    return mutated;
  });
  const parts = evaluateAssembly(extractAssembly(summarizeSource), { ...VARIABLE_INPUT, returnParts: true });
  const constant = parts._wpRulesHead + parts._wpRulesQuality + parts._wpRulesCraft + VARIABLE_INPUT.policyBlock + parts._wpRulesFinal;
  const variable = VARIABLE_INPUT.prompt + VARIABLE_INPUT.formalModeRule + VARIABLE_INPUT.viralFewshotBlock;
  assert.throws(() => assertCacheSplit(noRawFirst.splitWriterPromptForCache({ constant, variable, rawSourceText: RAW, finalizeRawFirst: makeFinalizer() }), parts, { hasRaw: true }));

  const noBlocksArg = summarizeSource.replace('...(_writerPromptBlocks ? { promptBlocks: _writerPromptBlocks } : {}),', '');
  assert.notEqual(noBlocksArg, summarizeSource, 'mutation M5 ต้องเกิดจริง');
  assert.throws(() => assertProductionWiring(noBlocksArg, routerSource));
  const alwaysSend = routerSource.replace('...(Array.isArray(promptBlocks) && promptBlocks.length > 0 ? { promptBlocks } : {}),', 'promptBlocks,');
  assert.notEqual(alwaysSend, routerSource, 'mutation M4 ต้องเกิดจริง');
  assert.throws(() => assertProductionWiring(summarizeSource, alwaysSend));
});
