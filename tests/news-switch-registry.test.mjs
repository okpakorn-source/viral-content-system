// ★ 2 ก.ย. 69 — ด่านทะเบียนสวิตช์ท่อข่าว (ข้อ 13): ใครเพิ่ม process.env.X ในไฟล์ท่อข่าวโดยไม่ลงทะเบียน = แดง
// รัน: node --test tests/news-switch-registry.test.mjs (ไม่ต้องตั้ง env · ไม่แตะเครือข่าย/DB)
// ตัวสแกน = AST (@babel/parser แบบเดียวกับ text-queue-handoff-contract / archive-save-truth) — แก้ตามผู้ตรวจไขว้รอบ 2 (2 ก.ย. 69):
//   · จับ const { X } = process.env · process.env?.X · process['env'].X ได้ (เดิม regex หลุด 3 รูปแบบ — ข้อ 4)
//   · ไม่หลงคอมเมนต์ท้ายบรรทัด / '/*' '//' ในสตริง (เดิมตัดคอมเมนต์ด้วย regex — ข้อ 5, 6)
//   · การอ่านที่ตามชื่อไม่ได้ (process.env[ตัวแปร] / const e = process.env / {...process.env} / helper(ตัวแปร))
//     อนุญาตเฉพาะฟังก์ชันใน DYNAMIC_ENV_READERS — ที่อื่น = แดง
//   · readBy ต้องตรงสองทาง: ไฟล์ที่อ่านจริงต้องอยู่ใน readBy และไฟล์ใน readBy ต้องอ่านจริง (เดิมตรวจทางเดียว
//     จึงปล่อยรายการ MISSING_FACTS_GATE ที่ระบุ readBy ผิดไฟล์/ค่าเริ่มต้นผิดหลุดมาได้ — ข้อ 1)
// ผลทุบ (2 ก.ย. 69 รอบ 2 — ทุบแล้วคืนโค้ดเดิมทุกไบต์):
//   M1 เพิ่ม `process.env.ZZ_FAKE_SWITCH` ใน src/lib/utils/withTimeout.js        ⇒ แดง "ทุกสวิตช์ที่โค้ดอ่านต้องอยู่ในทะเบียน"
//   M2 ลบรายการ OPENING_IDENTITY_RULE ออกจากทะเบียน                           ⇒ แดง 2 เคส (เคสเดียวกัน + "สวิตช์ของเฟสนี้ครบตามสเปก")
//   M3 ทำชื่อซ้ำในทะเบียน (เปลี่ยนชื่อ ALLOW_LEGACY_AUTO เป็น TEXT_ONLY_MODE)      ⇒ แดง 4 เคส (รวม "ทะเบียนต้องไม่มีชื่อซ้ำ")
//   M4 ลบ rollback ของ VIRAL_ROTATE                                             ⇒ แดง "ทุกรายการต้องมี default/meaning/rollback"
//   M5 ตัด readBy ของ ANGLE_CLOSING_SPLIT ให้เหลือไฟล์เดียว                      ⇒ แดง "readBy ต้องครอบทุกไฟล์ที่อ่านจริง"
//   M6 `const { ZZ_DESTRUCTURED } = process.env;` ใน withTimeout.js             ⇒ แดง (ทะเบียนไม่มี ZZ_DESTRUCTURED) — เดิม regex ไม่แดง
//   M7 `const _e = process.env; const _z = _e.ZZ_ALIASED;` ใน withTimeout.js    ⇒ แดง "อ่าน env แบบตามชื่อไม่ได้นอก DYNAMIC_ENV_READERS"
//   M8 `const _zc = 1; // เดิมอ่าน process.env.ZZ_TRAIL` ใน withTimeout.js      ⇒ ยังเขียว (คอมเมนต์ไม่ใช่การอ่าน) — เดิม regex แดงผิด
//   M9 readBy ของ MISSING_FACTS_GATE ชี้ autoFlowServiceText.js แทน               ⇒ แดง 2 เคส (readBy ไม่ครอบ + readBy อ้างไฟล์ที่ไม่ได้อ่าน)
//   M10 ลบ 'isSwitchEnabled' ออกจาก DYNAMIC_ENV_READERS ของ cardAuthority.js   ⇒ แดง (จุด dynamic ไม่ได้รับอนุญาต)
//   M11 ใส่ kind: 'pending' ให้ TEACHER_RANK_V2                                  ⇒ แดง "kind ต้องเป็น switch/value/platform"
//   M12 `const _s = 'x /* y'; const _zs = process.env.ZZ_AFTER_STRING;`         ⇒ แดง (สตริงไม่กลืนโค้ด) — เดิม regex กลืน
//   M13 `const _zo = process.env?.ZZ_OPTIONAL;` ใน withTimeout.js               ⇒ แดง (ทะเบียนไม่มี ZZ_OPTIONAL) — เดิม regex ไม่แดง
//   ทุกท่าคืนไฟล์แล้วเทียบไบต์ = ตรงเดิม (withTimeout.js เป็นไฟล์ล็อกข่าว git status สะอาด)
// ★ รอบยืนยัน 2 ก.ย. 69 (ผู้ตรวจ 2 ข้อ): ข้อ 1 ขยาย NEWS_SWITCH_FILES อีก 8 ไฟล์สาย TEXT (promptMatcher/objText/newsCap/
//   narrativePayloadText/rawFactCompletenessGate/researchService/achievementResearch/api/auto/stream) · ข้อ 2 เพิ่มเทส
//   "ค่าเริ่มต้นในทะเบียนต้องตรงกับที่โค้ดอ่านจริง" (inferEnvDefaults ด้านล่าง) — รันครั้งแรกจับทะเบียนเดิมผิด 2 รายการ:
//   CLAUDE_WRITE_MODEL ('' → โค้ด || 'claude-opus-4-8') และ WRITER_SOURCE_CHARS (12000 → ตัวอ่านที่วิ่งจริง newsForStage ไม่ตั้ง = ไม่จำกัด)
// ผลทุบรอบยืนยัน (ทุบทะเบียน src/lib/config/newsSwitches.js ทีละท่า แล้วคืน — md5 ตรงเดิมทุกท่า · scripts อยู่ scratchpad/mutate.sh):
//   M14 ANGLE_CARD_CONTEXT default 1→0 (โค้ด !== '0')                       ⇒ แดง "ค่าเริ่มต้นในทะเบียนต้องตรงกับที่โค้ดอ่านจริง"
//   M15 MODEL_BREAKDOWN default sol→luna (โค้ด || 'gpt-5.6-sol')              ⇒ แดง (เคสเดียวกัน)
//   M16 STYLE_PACK_V2 default 1→0 (อ่านผ่าน helper isDefaultOnSwitch)          ⇒ แดง (เคสเดียวกัน)
//   M17 CARD_AUTHORITY default 0→1 (ตีความจาก body isSwitchEnabled === '1')   ⇒ แดง (เคสเดียวกัน)
//   M18 ANGLE_BLUEPRINT_MODE default ''→'per_angle' (โค้ด === 'per_angle')     ⇒ แดง (ตรวจแบบอ่อน: ไม่ตั้ง env ย่อมไม่เท่าค่าที่เทียบ)
//   M19 BOT_RESUME_TRACKING default 1→0 (envFlag ในไฟล์บอทนอกชุดสแกน)         ⇒ แดง 2 เคส (ค่าเริ่มต้น + "สวิตช์ของเฟสนี้ต้องเปิด")
//   M20 RAW_FACT_COMPLETENESS_GATE default 1→0 (โค้ด ?? '1' ก่อน !== '0')     ⇒ แดง (ค่าเริ่มต้น)
//   M21 ANGLE_MIN_MATCH_SCORE default 45→50 (โค้ด || '45' ใน 2 ไฟล์)          ⇒ แดง (ค่าเริ่มต้น)
//   M22 ถอด newsCap.js ออกจาก NEWS_SWITCH_FILES                               ⇒ แดง "DYNAMIC_ENV_READERS อ้างไฟล์นอกชุดสแกน"
//   M23 ตัด narrativePayloadText ออกจาก readBy ของ ANGLE_CLOSING_SPLIT        ⇒ แดง "readBy ต้องครอบทุกไฟล์ที่อ่านจริง"
//   M24 ลบรายการ PROMPT_VARIETY_BAND ทั้งก้อน                                  ⇒ แดง 5 เคส (รวม "ทุกสวิตช์ที่โค้ดอ่านต้องอยู่ในทะเบียน")
//   M25 คืนค่าผิดเดิม CLAUDE_WRITE_MODEL default → ''                          ⇒ แดง (ค่าเริ่มต้น) — พิสูจน์ว่าเทสจับของจริงที่เคยหลุด
//   สถานะหลังคืน: 10/10 เขียว · ตีความได้ 66/94 · บอกได้แค่ "ไม่ใช่ค่า X" 3 · ข้าม 25 (พิมพ์ชื่อทุกครั้งที่รัน)
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import {
  DYNAMIC_ENV_READERS,
  ENV_HELPERS,
  NEWS_SWITCHES,
  NEWS_SWITCH_FILES,
  findSwitch,
  isSecretEnvName,
  registeredNames,
} from '../src/lib/config/newsSwitches.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const HELPERS = new Set(ENV_HELPERS);
const KINDS = new Set(['switch', 'value', 'platform']);
const SKIP_KEYS = new Set(['loc', 'start', 'end', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments']);

/** node คือ `process.env` (รวม process?.env / process['env']) */
function isProcessEnv(node) {
  if (!node || (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression')) return false;
  if (node.object?.type !== 'Identifier' || node.object.name !== 'process') return false;
  const { property } = node;
  return node.computed
    ? property?.type === 'StringLiteral' && property.value === 'env'
    : property?.type === 'Identifier' && property.name === 'env';
}

/** ชื่อฟังก์ชันที่ node นี้เปิด (ใช้บอกว่าจุดอ่านแบบ dynamic อยู่ใน helper ตัวไหน) — null ถ้าไม่ใช่ฟังก์ชัน */
function functionNameOf(node, parent) {
  if (node.type === 'FunctionDeclaration') return node.id?.name || '(anonymous)';
  if (node.type === 'ObjectMethod' || node.type === 'ClassMethod' || node.type === 'ClassPrivateMethod') {
    return node.key?.name || node.key?.value || '(method)';
  }
  if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
    if (node.id?.name) return node.id.name;
    if (parent?.type === 'VariableDeclarator' && parent.init === node && parent.id?.type === 'Identifier') return parent.id.name;
    if ((parent?.type === 'ObjectProperty' || parent?.type === 'ClassProperty') && parent.value === node) {
      return parent.key?.name || parent.key?.value || '(property)';
    }
    if (parent?.type === 'AssignmentExpression' && parent.right === node) {
      return parent.left?.name || parent.left?.property?.name || '(assigned)';
    }
    return '(anonymous)';
  }
  return null;
}

function walk(node, parent, stack, visit) {
  if (!node || typeof node.type !== 'string') return;
  const opened = functionNameOf(node, parent);
  if (opened) stack.push(opened);
  visit(node, parent, stack[stack.length - 1] || '(top-level)');
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) for (const child of value) walk(child, node, stack, visit);
    else if (value && typeof value.type === 'string') walk(value, node, stack, visit);
  }
  if (opened) stack.pop();
}

/**
 * สแกนซอร์สด้วย AST → { names: ชื่อ env ที่อ่าน (ไม่ซ้ำ เรียง), dynamic: จุดที่ตามชื่อไม่ได้ [{ line, where, form }] }
 * นับเป็นการอ่านชื่อ X: process.env.X · process.env['X'] · process.env?.X · const { X, Y: alias } = process.env · helper('X')
 *   · ไฟล์ cardAuthority.js: สตริงคงที่ 'CARD_AUTH…' (แม็ปชื่ออยู่ใน object แล้วอ่านผ่าน process.env[envName])
 *   · ไฟล์ newsCap.js: ค่าของช่อง `env: '…'` ในตาราง NEWS_CAPS (อ่านผ่าน process.env[cfg.env] ใน newsForStage) — ★ รอบยืนยัน 2 ก.ย. 69
 *   · ชื่อที่ไม่เข้ารูป A-Z0-9_ (เช่น process.env.npm_x) ข้าม — เหมือนตัวสแกนเดิม
 * นับเป็น dynamic: process.env[ตัวแปร] · helper(ตัวแปร) · const e = process.env · {...process.env} · ส่ง process.env เป็นอาร์กิวเมนต์
 *   · const { ...rest } = process.env · const { [k]: v } = process.env
 * คอมเมนต์/สตริงไม่มีผล (AST) — ต่างจาก regex เดิมที่แดงผิดเมื่อคอมเมนต์ท้ายบรรทัดเอ่ย process.env.X
 */
export function scanEnvReads(source, fileName = '') {
  const ast = parse(String(source || '').replace(/\r\n/g, '\n'), { sourceType: 'module', plugins: ['jsx'] });
  const names = new Set();
  const dynamic = [];
  const addName = value => { if (ENV_NAME_RE.test(String(value))) names.add(String(value)); };
  const isCardAuthority = /cardAuthority\.js$/.test(fileName);
  const isNewsCap = /newsCap\.js$/.test(fileName);
  walk(ast.program, null, [], (node, parent, where) => {
    if (isNewsCap && node.type === 'ObjectProperty' && !node.computed && node.key?.type === 'Identifier' && node.key.name === 'env'
        && node.value?.type === 'StringLiteral') {
      addName(node.value.value);
      return;
    }
    if (isProcessEnv(node)) {
      const line = node.loc.start.line;
      if ((parent?.type === 'MemberExpression' || parent?.type === 'OptionalMemberExpression') && parent.object === node) {
        if (!parent.computed) addName(parent.property.name);
        else if (parent.property.type === 'StringLiteral') addName(parent.property.value);
        else dynamic.push({ line, where, form: 'process.env[ตัวแปร]' });
      } else if (parent?.type === 'VariableDeclarator' && parent.init === node && parent.id?.type === 'ObjectPattern') {
        for (const prop of parent.id.properties) {
          if (prop.type === 'RestElement') dynamic.push({ line, where, form: 'const { ...rest } = process.env' });
          else if (prop.computed) dynamic.push({ line, where, form: 'const { [ตัวแปร]: x } = process.env' });
          else addName(prop.key.type === 'Identifier' ? prop.key.name : prop.key.value);
        }
      } else {
        dynamic.push({ line, where, form: `process.env ใช้ลอยๆ (${parent?.type || 'ไม่มี parent'})` });
      }
      return;
    }
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && HELPERS.has(node.callee.name)) {
      const arg = node.arguments[0];
      if (arg?.type === 'StringLiteral') addName(arg.value);
      else dynamic.push({ line: node.loc.start.line, where, form: `${node.callee.name}(ตัวแปร)` });
      return;
    }
    if (isCardAuthority && node.type === 'StringLiteral' && /^CARD_AUTH[A-Z0-9_]*$/.test(node.value)) names.add(node.value);
  });
  return { names: [...names].sort(), dynamic };
}

const scanCache = new Map();
/** สแกนไฟล์ตาม path จากราก (แคชต่อไฟล์ — ไฟล์ท่อข่าว 40+ ไฟล์ parse ครั้งเดียวพอ) */
function scanFile(relative) {
  if (!scanCache.has(relative)) {
    const absolute = join(ROOT, relative);
    assert.ok(existsSync(absolute), `ไฟล์ต้องมีจริง: ${relative}`);
    scanCache.set(relative, scanEnvReads(readFileSync(absolute, 'utf8'), relative));
  }
  return scanCache.get(relative);
}

/** สแกนทุกไฟล์ในชุด → Map ชื่อ env → [ไฟล์ที่อ่าน] (ตัดคีย์ลับออก) */
function scanPipelineFiles() {
  const readers = new Map();
  for (const relative of NEWS_SWITCH_FILES) {
    for (const name of scanFile(relative).names) {
      if (isSecretEnvName(name)) continue;
      if (!readers.has(name)) readers.set(name, []);
      readers.get(name).push(relative);
    }
  }
  return readers;
}

test('ตัวสแกน AST จับการอ่าน env ทุกรูปแบบ มองข้ามคอมเมนต์/สตริง และชี้จุดที่ตามชื่อไม่ได้', () => {
  const sample = [
    "const a = process.env.ALPHA_SWITCH === '1';",
    "const b = process.env['BRAVO_MODE'] || '';",
    "const c = envOn('CHARLIE_FLAG');",
    "const d = _envTok('DELTA_TOK');",
    "const k = process.env.SOME_API_KEY; const s = process.env.X_SECRET; const u = process.env.BASE_URL;",
    '/* process.env.IN_BLOCK_COMMENT */',
    '  // process.env.IN_LINE_COMMENT',
    "const e = `${process.env.ECHO_TPL}`;",
    'const { FOX_ONE, FOX_TWO: foxTwo } = process.env;', // ผู้ตรวจไขว้ข้อ 4: destructuring
    'const g = process.env?.GOLF_OPTIONAL;', // ผู้ตรวจไขว้ข้อ 4: optional chaining
    "const h = process['env'].HOTEL_BRACKET;",
    'const t = 1; // เดิมอ่าน process.env.TRAILING_COMMENT', // ผู้ตรวจไขว้ข้อ 5: คอมเมนต์ท้ายบรรทัดต้องไม่นับ
    "const str = 'มี /* และ // ในสตริง'; const i = process.env.INDIA_AFTER_STRING;", // ผู้ตรวจไขว้ข้อ 6: สตริงต้องไม่กลืนโค้ด
    'const lower = process.env.npm_config_x;', // ไม่ใช่รูปแบบชื่อสวิตช์ — ข้าม
  ].join('\n');
  const { names, dynamic } = scanEnvReads(sample, 'sample.js');
  assert.deepEqual(names, [
    'ALPHA_SWITCH', 'BASE_URL', 'BRAVO_MODE', 'CHARLIE_FLAG', 'DELTA_TOK', 'ECHO_TPL', 'FOX_ONE', 'FOX_TWO',
    'GOLF_OPTIONAL', 'HOTEL_BRACKET', 'INDIA_AFTER_STRING', 'SOME_API_KEY', 'X_SECRET',
  ]);
  assert.deepEqual(names.filter(name => !isSecretEnvName(name)), [
    'ALPHA_SWITCH', 'BRAVO_MODE', 'CHARLIE_FLAG', 'DELTA_TOK', 'ECHO_TPL', 'FOX_ONE', 'FOX_TWO', 'GOLF_OPTIONAL', 'HOTEL_BRACKET', 'INDIA_AFTER_STRING',
  ]);
  assert.deepEqual(dynamic, []);

  const unfollowable = scanEnvReads([
    'const _e = process.env;', // alias
    'const _za = _e.ZZ_ALIASED;',
    'function pick(name) { return process.env[name]; }', // index ตัวแปร
    'const spread = { ...process.env };', // spread
    'const viaHelper = (n) => envOn(n);', // helper(ตัวแปร)
    'const { ...rest } = process.env;', // rest
  ].join('\n'), 'x.js');
  assert.deepEqual(unfollowable.names, []);
  assert.deepEqual(unfollowable.dynamic.map(site => `${site.line}:${site.where}:${site.form}`), [
    '1:(top-level):process.env ใช้ลอยๆ (VariableDeclarator)',
    '3:pick:process.env[ตัวแปร]',
    '4:(top-level):process.env ใช้ลอยๆ (SpreadElement)',
    '5:viaHelper:envOn(ตัวแปร)',
    '6:(top-level):const { ...rest } = process.env',
  ]);

  assert.deepEqual(
    scanEnvReads(
      "const ENV = { master: 'CARD_AUTHORITY', rules: { R7: 'CARD_AUTH_R7' } };\nfunction isSwitchEnabled(n) { return process.env[n] === '1'; }",
      'src/lib/ai/cardAuthority.js',
    ),
    { names: ['CARD_AUTHORITY', 'CARD_AUTH_R7'], dynamic: [{ line: 2, where: 'isSwitchEnabled', form: 'process.env[ตัวแปร]' }] },
  );

  // ★ รอบยืนยัน 2 ก.ย. 69: newsCap.js เก็บชื่อ env ในตาราง NEWS_CAPS แล้วอ่านผ่าน process.env[cfg.env] — ตัวสแกนเก็บจากช่อง env: '…'
  //   (ช่อง env ของไฟล์อื่น และช่องอื่นของ newsCap เช่น desc ไม่นับ)
  const newsCapSample = "export const NEWS_CAPS = { DNA: { env: 'NEWS_CAP_DNA', was: 1500, desc: 'x' }, WRITER: { env: 'WRITER_SOURCE_CHARS', fallback: 0 } };\n"
    + "export function newsForStage(stage) { const cfg = NEWS_CAPS[stage]; return String(process.env[cfg.env] ?? ''); }";
  assert.deepEqual(scanEnvReads(newsCapSample, 'src/lib/utils/newsCap.js'), {
    names: ['NEWS_CAP_DNA', 'WRITER_SOURCE_CHARS'],
    dynamic: [{ line: 2, where: 'newsForStage', form: 'process.env[ตัวแปร]' }],
  });
  assert.deepEqual(scanEnvReads(newsCapSample, 'src/lib/utils/other.js').names, [], 'ช่อง env: ในไฟล์อื่นต้องไม่นับเป็นการอ่าน');

  // helper ของบอท: envFlag('X', bool) นับเป็นการอ่าน X (ใช้ตรวจ readBy ของหมวดบอท)
  assert.deepEqual(scanEnvReads("const on = envFlag('BOT_RESUME_TRACKING', true);", 'discord-bot/index.js').names, ['BOT_RESUME_TRACKING']);
});

// ═══ ★ รอบยืนยัน 2 ก.ย. 69 ข้อ 2: ตีความ "ค่าเริ่มต้น" จากโค้ดจริง แล้วเทียบกับทะเบียน ═══
// ปีนจากจุดอ่าน env ขึ้นตาม parent chain ผ่านตัวห่อที่ไม่เปลี่ยนความหมายของ "ไม่ตั้ง env"
//   (String()/Number()/parseInt()/parseFloat() · .trim()/.toLowerCase()/.toUpperCase()/.replace()) แล้วเก็บ:
//   · fallback:   `?? 'v'` / `|| 'v'` (literal สตริง/ตัวเลข — ตัวแรกที่ไม่ว่างชนะ · `|| ''` แล้ว `|| 'v'` ต่อ = 'v')
//   · เปรียบเทียบ: `=== 'v'` / `!== 'v'` (== / != ด้วย) กับ literal
// ตีความ (ตามสเปกผู้ตรวจ): === '1' → ค่าเริ่มต้น '0' · !== '0' → '1' · === '0' → '1' · !== '1' → '0' · ?? 'v' / || 'v' → 'v'
//   · มี fallback ไม่ว่างก่อนเปรียบเทียบ ((env || '1') === '1') → fallback ชนะ (ค่าจริงเมื่อไม่ตั้ง)
//   · เปรียบเทียบกับค่าอื่นที่ไม่ใช่ 0/1 (=== 'per_angle') → บอกได้แค่ "ค่าเริ่มต้นต้องไม่ใช่ค่านั้น" (notDefault)
//   · fallback '' ล้วน (?? '' / || '') → ตีความไม่ได้ (ค่าที่มีผลจริงอยู่ในโค้ดถัดไป เช่น raw === '' ? 12000 : n) → ข้าม
//   · env อยู่ฝั่งขวาของ ||/?? (a || env || 'v') → ปีนต่อ (ถ้า a มีค่า env ก็ไม่มีผลอยู่แล้ว) — เก็บ fallback ชั้นนอกได้
// helper: envOn('X'[, bool]) / envFlag('X', bool) / isDefaultOnSwitch('X') / _numEnv('X', n) → default จาก literal ในอาร์กิวเมนต์
//   readToken/_envTok/envStr คืนค่าดิบ (ไม่ตั้ง = '') → ปีนต่อหาเปรียบเทียบข้างบนได้ · helper อื่น = ตีความไม่ได้
//   cardAuthority.js: ชื่อ CARD_AUTH* ทุกตัววิ่งผ่าน isSwitchEnabled(envName) → ตีความจาก body ของ helper (process.env[param] === '1')
// ⚠️ ถ้าใครเปลี่ยนความหมายของ helper (เช่น envOn คืน def เมื่อไม่ตั้ง) ต้องแก้ตาราง HELPER_DEFAULTS ด้านล่างให้ตรง
const TRANSPARENT_CALLEES = new Set(['String', 'Number', 'parseInt', 'parseFloat']);
const NUMERIC_CALLEES = new Set(['Number', 'parseInt', 'parseFloat']);
const TRANSPARENT_METHODS = new Set(['trim', 'toLowerCase', 'toUpperCase', 'replace']);
const RAW_VALUE_HELPERS = new Set(['readToken', '_envTok', 'envStr']);
const literalOf = node => {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'NumericLiteral') return String(node.value);
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis.map(q => q.value.cooked).join('');
  return null;
};
const boolDefault = node => (node?.type === 'BooleanLiteral' ? (node.value ? '1' : '0') : null);
/** ค่าเริ่มต้นจากอาร์กิวเมนต์ helper — นิยามจริง: envOn=src/lib/utils/envFlag.js · envFlag=discord-bot/index.js · isDefaultOnSwitch=src/lib/ai/promptModes.js · _numEnv=summarizeServiceText.js */
const HELPER_DEFAULTS = {
  envOn: args => (args.length < 2 ? '0' : boolDefault(args[1])), // def=false เมื่อไม่ส่ง
  envFlag: args => (args.length < 2 ? null : boolDefault(args[1])), // บอทบังคับส่ง fallback
  isDefaultOnSwitch: () => '1',
  _numEnv: args => literalOf(args[1]),
};

/** `process.env.X` / `process.env['X']` / `process.env?.X` → 'X' (null ถ้าไม่ใช่การอ่านชื่อคงที่) */
function staticEnvName(node) {
  if (!node || (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression')) return null;
  if (!isProcessEnv(node.object)) return null;
  if (!node.computed) return node.property.name;
  return node.property.type === 'StringLiteral' ? node.property.value : null;
}

/** ปีนจาก node ค่าดิบขึ้นตาม parent chain → { fallback, cmp, stop } */
function climbEnvUse(ancestors, start, initialFallback) {
  let cur = start;
  let fallback = initialFallback;
  let numeric = false;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const p = ancestors[i];
    if (p.type === 'CallExpression' && p.callee.type === 'Identifier' && TRANSPARENT_CALLEES.has(p.callee.name) && p.arguments[0] === cur) {
      if (NUMERIC_CALLEES.has(p.callee.name)) numeric = true;
      cur = p; continue;
    }
    if (p.type === 'MemberExpression' && p.object === cur && !p.computed && TRANSPARENT_METHODS.has(p.property.name)) { cur = p; continue; }
    if (p.type === 'CallExpression' && p.callee === cur) { cur = p; continue; } // ตัวเรียก .trim() เอง
    if (p.type === 'LogicalExpression' && (p.operator === '||' || p.operator === '??')) {
      if (p.right === cur) { cur = p; continue; } // a || env || 'v' — ปีนต่อ
      const lit = literalOf(p.right);
      if (lit === null) return { fallback, cmp: null, stop: 'fallback ไม่ใช่ literal' };
      if (fallback === null || (p.operator === '||' && (fallback === '' || (numeric && !Number(fallback))))) fallback = lit;
      cur = p; continue;
    }
    if (p.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(p.operator)) {
      const lit = literalOf(p.left === cur ? p.right : p.left);
      if (lit === null) return { fallback, cmp: null, stop: 'เปรียบเทียบกับสิ่งที่ไม่ใช่ literal' };
      return { fallback, cmp: { op: p.operator, value: lit }, stop: null };
    }
    return { fallback, cmp: null, stop: `หยุดที่ ${p.type}` };
  }
  return { fallback, cmp: null, stop: 'สุดต้นไม้' };
}

/** ผลการปีน → { default: สตริง|null, notDefault: สตริง|null, reason } */
function interpretEnvUse({ fallback, cmp, stop }) {
  if (cmp) {
    if (fallback !== null && fallback !== '') return { default: fallback, notDefault: null, reason: `fallback '${fallback}' ก่อน ${cmp.op} '${cmp.value}'` };
    if (cmp.value === '0' || cmp.value === '1') return { default: cmp.value === '1' ? '0' : '1', notDefault: null, reason: `${cmp.op} '${cmp.value}'` };
    return { default: null, notDefault: cmp.value, reason: `${cmp.op} '${cmp.value}'` };
  }
  if (fallback !== null && fallback !== '') return { default: fallback, notDefault: null, reason: `fallback '${fallback}'` };
  return { default: null, notDefault: null, reason: fallback === '' ? `fallback '' แล้ว${stop}` : stop };
}

function walkAncestors(node, ancestors, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, ancestors);
  ancestors.push(node);
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) for (const child of value) walkAncestors(child, ancestors, visit);
    else if (value && typeof value.type === 'string') walkAncestors(value, ancestors, visit);
  }
  ancestors.pop();
}

/**
 * สแกนซอร์ส → รายการจุดอ่าน env พร้อมค่าเริ่มต้นที่ตีความได้
 * @returns {{ name: string, line: number, via: string, default: string|null, notDefault: string|null, reason: string }[]}
 */
export function inferEnvDefaults(source, fileName = '') {
  const ast = parse(String(source || '').replace(/\r\n/g, '\n'), { sourceType: 'module', plugins: ['jsx'] });
  const sites = [];
  const push = (node, name, via, verdict) => { if (ENV_NAME_RE.test(name)) sites.push({ name, line: node.loc.start.line, via, ...verdict }); };
  const isCardAuthority = /cardAuthority\.js$/.test(fileName);
  const cardAuthNames = new Set();
  let cardAuthVerdict = null;
  walkAncestors(ast.program, [], (node, ancestors) => {
    const name = staticEnvName(node);
    if (name) { push(node, name, 'process.env', interpretEnvUse(climbEnvUse(ancestors, node, null))); return; }
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && HELPERS.has(node.callee.name) && node.arguments[0]?.type === 'StringLiteral') {
      const fn = node.callee.name;
      if (HELPER_DEFAULTS[fn]) {
        const value = HELPER_DEFAULTS[fn](node.arguments);
        push(node, node.arguments[0].value, fn, { default: value, notDefault: null, reason: value === null ? `${fn}(…) ไม่มี default literal` : `${fn}(…) → '${value}'` });
      } else if (RAW_VALUE_HELPERS.has(fn)) {
        push(node, node.arguments[0].value, fn, interpretEnvUse(climbEnvUse(ancestors, node, '')));
      } else {
        push(node, node.arguments[0].value, fn, { default: null, notDefault: null, reason: `${fn}(…) ตีความไม่ได้` });
      }
      return;
    }
    if (!isCardAuthority) return;
    if (node.type === 'StringLiteral' && /^CARD_AUTH[A-Z0-9_]*$/.test(node.value)) cardAuthNames.add(node.value);
    if (node.type === 'MemberExpression' && node.computed && isProcessEnv(node.object) && node.property.type === 'Identifier') {
      const fn = [...ancestors].reverse().find(a => a.type === 'FunctionDeclaration');
      if (fn?.id?.name === 'isSwitchEnabled' && fn.params[0]?.type === 'Identifier' && fn.params[0].name === node.property.name) {
        cardAuthVerdict = { line: node.loc.start.line, ...interpretEnvUse(climbEnvUse(ancestors, node, null)) };
      }
    }
  });
  if (cardAuthVerdict) for (const name of [...cardAuthNames].sort()) sites.push({ name, via: 'isSwitchEnabled', ...cardAuthVerdict });
  return sites;
}

test('ตัวตีความค่าเริ่มต้นอ่านทุกรูปแบบตามสเปก และบอก "ตีความไม่ได้" แทนการเดา', () => {
  const sample = [
    "const a = process.env.A_ON_IS_ONE === '1';", // → '0'
    "const b = process.env.B_NOT_ZERO !== '0';", // → '1'
    "const c = process.env.C_IS_ZERO === '0';", // → '1'
    "const d = process.env.D_NOT_ONE !== '1';", // → '0'
    "const e = process.env.E_NULLISH ?? 'ev';", // → 'ev'
    "const f = process.env.F_OR || 'fv';", // → 'fv'
    "const g = String(process.env.G_WRAPPED ?? '1').trim() !== '0';", // fallback ชนะ → '1'
    "const h = Math.min(Number(process.env.H_NUMERIC) || 0, 8);", // → '0'
    "const i = Math.max(0, parseInt(process.env.I_PARSE || '45', 10) || 45);", // → '45'
    "const j = (process.env.J_EMPTY_THEN || '').trim() || 'jv';", // '' แล้ว 'jv' → 'jv'
    "const k = opts.k || process.env.K_RIGHT_SIDE || 'kv';", // ฝั่งขวา → ปีนต่อ → 'kv'
    "const l = process.env.L_MODE === 'per_angle';", // notDefault 'per_angle'
    "const m = String(process.env.M_EMPTY_ONLY ?? '').trim();", // ตีความไม่ได้
    'const n = Boolean(process.env.N_BOOLEAN);', // ตีความไม่ได้
    "const o = process.env.O_NON_LITERAL || SOME_CONST;", // ตีความไม่ได้
    "const p = envOn('P_ENVON');", // → '0'
    "const q = envOn('Q_ENVON_TRUE', true);", // → '1'
    "const r = envFlag('R_BOT', false);", // → '0'
    "const s = isDefaultOnSwitch('S_DEFAULT_ON');", // → '1'
    "const t = _numEnv('T_NUM', 165);", // → '165'
    "const u = readToken('U_TOKEN') === 'plain' ? 'plain' : 'truth';", // notDefault 'plain'
    "const v = ['1', 'true'].includes(_envTok('V_TOK'));", // ตีความไม่ได้
    "const w = (process.env.W_FB_THEN_CMP || '1') === '1';", // fallback ชนะ → '1'
  ].join('\n');
  const byName = Object.fromEntries(inferEnvDefaults(sample, 'sample.js').map(site => [site.name, [site.default, site.notDefault]]));
  assert.deepEqual(byName, {
    A_ON_IS_ONE: ['0', null], B_NOT_ZERO: ['1', null], C_IS_ZERO: ['1', null], D_NOT_ONE: ['0', null],
    E_NULLISH: ['ev', null], F_OR: ['fv', null], G_WRAPPED: ['1', null], H_NUMERIC: ['0', null], I_PARSE: ['45', null],
    J_EMPTY_THEN: ['jv', null], K_RIGHT_SIDE: ['kv', null], L_MODE: [null, 'per_angle'],
    M_EMPTY_ONLY: [null, null], N_BOOLEAN: [null, null], O_NON_LITERAL: [null, null],
    P_ENVON: ['0', null], Q_ENVON_TRUE: ['1', null], R_BOT: ['0', null], S_DEFAULT_ON: ['1', null], T_NUM: ['165', null],
    U_TOKEN: [null, 'plain'], V_TOK: [null, null], W_FB_THEN_CMP: ['1', null],
  });

  const cardAuth = inferEnvDefaults(
    "const ENV = { master: 'CARD_AUTHORITY', rules: { R7: 'CARD_AUTH_R7' } };\nfunction isSwitchEnabled(n) { return process.env[n] === '1'; }",
    'src/lib/ai/cardAuthority.js',
  );
  assert.deepEqual(cardAuth.map(site => `${site.name}=${site.default}`), ['CARD_AUTHORITY=0', 'CARD_AUTH_R7=0']);
  assert.deepEqual(
    inferEnvDefaults("function isSwitchEnabled(n) { return process.env[n] !== '0'; }\nconst x = 'CARD_AUTH_R2';", 'src/lib/ai/cardAuthority.js').map(site => site.default),
    ['1'], 'เปลี่ยน body ของ isSwitchEnabled แล้วค่าเริ่มต้นของ CARD_AUTH* ต้องเปลี่ยนตาม',
  );
});

test('ทุกสวิตช์ที่โค้ดท่อข่าวอ่านต้องอยู่ในทะเบียน (แดงถ้าใครเพิ่มสวิตช์โดยไม่ลงทะเบียน)', () => {
  const readers = scanPipelineFiles();
  const registered = registeredNames();
  const missing = [...readers.entries()]
    .filter(([name]) => !registered.has(name))
    .map(([name, files]) => `${name} ← ${files.join(', ')}`);
  assert.deepEqual(missing, [], `สวิตช์ที่ยังไม่ลงทะเบียนใน src/lib/config/newsSwitches.js:\n  ${missing.join('\n  ')}`);
  assert.ok(readers.size >= 60, `ตัวสแกนต้องเห็นสวิตช์จริงจำนวนมาก (เห็น ${readers.size}) — ถ้าน้อยผิดปกติแปลว่าตัวสแกนพัง`);
});

test('ทะเบียนต้องไม่มีชื่อซ้ำ', () => {
  const seen = new Map();
  for (const entry of NEWS_SWITCHES) seen.set(entry.name, (seen.get(entry.name) || 0) + 1);
  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);
  assert.deepEqual(duplicates, []);
});

test('ทุกรายการต้องมี default/meaning/rollback ครบ (และช่องอื่นถูกรูป · kind ต้องเป็น switch/value/platform)', () => {
  const problems = [];
  for (const entry of NEWS_SWITCHES) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(entry.name)) problems.push(`${entry.name}: ชื่อไม่ใช่รูปแบบ env`);
    if (typeof entry.default !== 'string') problems.push(`${entry.name}: default ต้องเป็นสตริง`);
    if (!Array.isArray(entry.values) || entry.values.length === 0) problems.push(`${entry.name}: values ว่าง`);
    if (!Array.isArray(entry.readBy) || entry.readBy.length === 0) problems.push(`${entry.name}: readBy ว่าง`);
    if (typeof entry.meaning !== 'string' || !/[ก-๙]/.test(entry.meaning)) problems.push(`${entry.name}: meaning ต้องเป็นภาษาไทย`);
    if (typeof entry.since !== 'string' || !entry.since.trim()) problems.push(`${entry.name}: since ว่าง`);
    if (typeof entry.rollback !== 'string' || !entry.rollback.trim()) problems.push(`${entry.name}: rollback ว่าง`);
    if (!KINDS.has(entry.kind)) problems.push(`${entry.name}: kind "${entry.kind}" ต้องเป็น switch/value/platform (ห้าม pending — ต้องยืนยันกับโค้ดจริงก่อนลงทะเบียน)`);
    if (isSecretEnvName(entry.name)) problems.push(`${entry.name}: คีย์ลับห้ามอยู่ในทะเบียน`);
    for (const file of entry.readBy || []) {
      if (!existsSync(join(ROOT, file))) problems.push(`${entry.name}: readBy ชี้ไฟล์ที่ไม่มี ${file}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('readBy ต้องครอบทุกไฟล์ที่อ่านสวิตช์นั้นจริง (ไม่โกหกว่าอ่านที่เดียว)', () => {
  const readers = scanPipelineFiles();
  const gaps = [];
  for (const entry of NEWS_SWITCHES) {
    const actual = readers.get(entry.name) || [];
    for (const file of actual) {
      if (!entry.readBy.includes(file)) gaps.push(`${entry.name}: อ่านจริงที่ ${file} แต่ readBy ไม่มี`);
    }
  }
  assert.deepEqual(gaps, []);
});

test('readBy ต้องไม่อ้างไฟล์ที่ไม่ได้อ่านสวิตช์นั้นจริง (ไฟล์นอกชุดสแกนก็ถูกตรวจ — กันลงทะเบียนจากแผนแทนโค้ด)', () => {
  const stale = [];
  for (const entry of NEWS_SWITCHES) {
    for (const file of entry.readBy) {
      if (!existsSync(join(ROOT, file))) continue; // เทสช่องครบรายงานไฟล์หายแล้ว
      if (!scanFile(file).names.includes(entry.name)) stale.push(`${entry.name}: readBy บอกว่าอ่านที่ ${file} แต่ไฟล์นั้นไม่ได้อ่าน`);
    }
  }
  assert.deepEqual(stale, []);
});

test('การอ่าน env แบบตามชื่อไม่ได้ (process.env[ตัวแปร]/alias/spread/helper(ตัวแปร)) ทำได้เฉพาะใน DYNAMIC_ENV_READERS', () => {
  const violations = [];
  const seen = new Set();
  for (const relative of NEWS_SWITCH_FILES) {
    const allowed = new Set(DYNAMIC_ENV_READERS[relative] || []);
    for (const site of scanFile(relative).dynamic) {
      if (allowed.has(site.where)) seen.add(`${relative} → ${site.where}`);
      else violations.push(`${relative}:${site.line} ใน ${site.where}: ${site.form} — ด่านทะเบียนตามชื่อไม่ได้ ให้เขียน process.env.ชื่อ ตรงๆ หรือลง DYNAMIC_ENV_READERS`);
    }
  }
  assert.deepEqual(violations, []);
  const stale = [];
  for (const [file, functions] of Object.entries(DYNAMIC_ENV_READERS)) {
    assert.ok(NEWS_SWITCH_FILES.includes(file), `DYNAMIC_ENV_READERS อ้างไฟล์นอกชุดสแกน: ${file}`);
    for (const name of functions) {
      if (!seen.has(`${file} → ${name}`)) stale.push(`${file} → ${name} ไม่มีการอ่านแบบ dynamic แล้ว — ลบออกจาก DYNAMIC_ENV_READERS`);
    }
  }
  assert.deepEqual(stale, []);
});

test('สวิตช์ 0/1 ต้องมี default อยู่ในค่าที่รับ และสวิตช์ของเฟสนี้ครบตามสเปก', () => {
  const problems = [];
  for (const entry of NEWS_SWITCHES) {
    if (entry.kind === 'switch' && entry.values.every(value => /^[01]/.test(value)) && !entry.values.some(value => value.startsWith(entry.default))) {
      problems.push(`${entry.name}: default "${entry.default}" ไม่อยู่ใน values ${JSON.stringify(entry.values)}`);
    }
  }
  assert.deepEqual(problems, []);
  const registered = registeredNames();
  for (const required of [
    'TEACHER_RANK_V2', 'LIB_CLASSIFIER_V2', 'ANGLE2_DISTINCT_V2', 'MISSING_FACTS_GATE',
    'OPENING_FAMILY_CONTRACT', 'OPENING_IDENTITY_RULE', 'WRITER_MODEL_LAB',
    'FORCE_LESSON_ANGLE', 'ALLOW_LEGACY_AUTO', // ผู้ตรวจไขว้ข้อ 3
    'PROMPT_VARIETY_BAND', 'HOOKS_OBJ_FIX', 'HOOKS_AS_OPENERS', 'ALLOW_SIMULATION', 'RAW_FACT_COMPLETENESS_GATE', // รอบยืนยัน ข้อ 1
    'NEWS_CAP_DNA', 'NEWS_CAP_VIRAL_MATCH', 'BOT_RESUME_TRACKING', // รอบยืนยัน ข้อ 1 (newsCap + หมวดบอท)
  ]) {
    assert.ok(registered.has(required), `สวิตช์เฟส 2 ก.ย. 69 ต้องอยู่ในทะเบียน: ${required}`);
  }
  // สวิตช์ใหม่ 4 ตัวของเพื่อนร่วมทีม + สวิตช์บอท: ค่าเริ่มต้นต้องเป็น "เปิด" ตามโค้ดจริง (เทสค่าเริ่มต้นด้านล่างเทียบกับโค้ดอีกชั้น)
  for (const name of ['TEACHER_RANK_V2', 'LIB_CLASSIFIER_V2', 'ANGLE2_DISTINCT_V2', 'MISSING_FACTS_GATE', 'BOT_RESUME_TRACKING']) {
    assert.equal(findSwitch(name)?.default, '1', `${name} ค่าเริ่มต้นต้องเปิด (รับ '0' ปิด)`);
  }
});

test('ค่าเริ่มต้นในทะเบียนต้องตรงกับที่โค้ดอ่านจริง (=== "1" / !== "0" / === "0" / ?? "v" / || "v" / helper ที่มี default literal) — ตีความไม่ได้ = ข้ามพร้อมพิมพ์ชื่อ', () => {
  // สแกนทุกไฟล์ในชุด + ทุกไฟล์ที่ readBy อ้าง (ไฟล์นอกชุดสแกนเช่น geminiClient/promptStore/discord-bot เทียบเฉพาะชื่อที่อยู่ในทะเบียน)
  const files = [...new Set([...NEWS_SWITCH_FILES, ...NEWS_SWITCHES.flatMap(entry => entry.readBy)])].filter(file => existsSync(join(ROOT, file)));
  const registered = registeredNames();
  const definitive = new Set();
  const weakOnly = new Set();
  const skippedSites = [];
  const mismatches = [];
  for (const file of files) {
    for (const site of inferEnvDefaults(readFileSync(join(ROOT, file), 'utf8'), file)) {
      if (!registered.has(site.name) || isSecretEnvName(site.name)) continue; // ชื่อนอกทะเบียนในชุดสแกน = เทส "ต้องอยู่ในทะเบียน" จัดการ
      const entry = findSwitch(site.name);
      const at = `${file}:${site.line} [${site.via}]`;
      if (site.default !== null) {
        definitive.add(site.name);
        if (entry.default !== site.default) mismatches.push(`${site.name}: ทะเบียนบอก "${entry.default}" แต่โค้ดที่ ${at} ให้ "${site.default}" (${site.reason})`);
      } else if (site.notDefault !== null) {
        weakOnly.add(site.name);
        if (entry.default === site.notDefault) mismatches.push(`${site.name}: ทะเบียนบอก "${entry.default}" แต่โค้ดที่ ${at} เทียบ ${site.reason} — ไม่ตั้ง env ย่อมไม่เท่าค่านั้น`);
      } else {
        skippedSites.push(`${site.name} @ ${at}: ${site.reason}`);
      }
    }
  }
  const names = NEWS_SWITCHES.map(entry => entry.name);
  const partial = names.filter(name => !definitive.has(name) && weakOnly.has(name));
  const skipped = names.filter(name => !definitive.has(name) && !weakOnly.has(name));
  // ห้ามเงียบ: พิมพ์ชื่อที่ตีความไม่ได้ทุกครั้ง (คนอ่านผลเทสเห็นว่าตัวไหนยังพึ่งการอ่านด้วยตา)
  console.log(`[switch-defaults] ตีความได้ ${definitive.size}/${names.length} · บอกได้แค่ "ไม่ใช่ค่า X" ${partial.length}: ${partial.join(', ') || '-'}`);
  console.log(`[switch-defaults] ข้าม ${skipped.length} ตัว (ตีความไม่ได้ — ตรวจด้วยตา): ${skipped.join(', ') || '-'}`);
  for (const line of skippedSites.filter(line => skipped.some(name => line.startsWith(`${name} @`)))) console.log(`[switch-defaults]   · ${line}`);
  assert.deepEqual(mismatches, [], `ค่าเริ่มต้นในทะเบียนผิดจากโค้ด:\n  ${mismatches.join('\n  ')}`);
  assert.ok(definitive.size >= 65, `ตัวตีความต้องยืนยันสวิตช์ได้จำนวนมาก (ได้ ${definitive.size}) — ถ้าน้อยผิดปกติแปลว่าตัวตีความพัง`);
  assert.ok(skipped.length <= Math.floor(names.length / 3), `สวิตช์ที่ตีความไม่ได้มากผิดปกติ (${skipped.length}/${names.length}) — ตรวจว่า helper/รูปแบบใหม่ไม่ได้หลุดจากตัวตีความ`);
});
