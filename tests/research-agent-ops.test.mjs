// ============================================================
// 🧪 tests/research-agent-ops.test.mjs — สัญญาไฟล์ ops ของเอเจนต์รีเสิร์ช (เลน D): guard autostart · .env.example · คู่มือ
// ★ 1 ต.ค. 69 รอบแก้ r2 (ผู้ตรวจอิสระ FAIL 2 ข้อ · SPEC-v2 ส่วน 8 + 2.5):
//   1) ไฟล์ธงหยุดของ guard ต้องเป็นไฟล์เดียวกับของ worker = <ราก>\logs\research-agent\research-agent.stop
//      (worker --stop/--resume วาง/ลบ · forever.cmd รอ) — รอบแรก guard/คู่มือใช้ <ราก>\research-agent.stop จึงพักไม่ได้จริง
//      และคู่มือสั่ง "ปิดหน้าต่าง worker" ทั้งที่ guard เปิด worker แบบซ่อนหน้าต่าง
//   2) worker ตีความ RESEARCH_AGENT_TOOLS: ตั้งเมื่อไร เบราว์เซอร์เปิดเฉพาะเมื่อมีคำ browser
//      → ตัวอย่างใน .env.example ต้องมี browser (เอา # ออก = เท่ากับไม่ตั้ง) · ตัวอย่างในคู่มือที่ไม่มี browser
//        ต้องเป็นบรรทัดที่บอก "ปิดเบราว์เซอร์" ตั้งใจ (เช่นเครื่องทีม) · ตาราง env และวิธีถอยต้องเตือนเรื่องคำ browser
// อ่านไฟล์อย่างเดียว ไม่เขียนไฟล์ · ไม่รัน cmd.exe/PowerShell (CI = ubuntu node 22) — พฤติกรรมจริงของ guard
//   (ธงจาก --stop จริง · พัก/ปลุก · หยุดทันที · PATH) ทดสอบมือบน Windows แล้ว ดูรายงานเลน D r2 + คู่มือส่วน 6
// เทียบโค้ดเลน A: เมื่อมี scripts/research-agent-worker.mjs + scripts/research-agent/taskBuilder.mjs (หลังรวม)
//   ข้อสุดท้ายเรียก loadConfig ตัวจริง (ตำแหน่งธง · ความหมาย browser · WORKER_ID) + mutation ฝั่งความหมาย ·
//   ก่อนรวม (worktree เลน D ไม่มีไฟล์เลน A) ข้อนั้นยืนยันว่าไม่มีทั้งคู่จริงแล้วพิมพ์ diagnostic — ไม่ใช้ skip (ด่านข่าวห้าม skip)
// ★ r3 1 ต.ค. 69 (ข้อตัดสินผู้คุมงานหลังตรวจสัญญาข้ามเลน · C:\tmp\research-agent-lab\contract-check.json #6 #7):
//   3) .env.example ต้องมีทุกชื่อที่โค้ดอ่าน (+ CODEX_BIN · IDLE_MS · OWNER_DISCORD_ID · CONCURRENCY · DEADLINE_MIN · STALE_DAYS)
//      และป้ายที่ตั้ง [Vercel]/[Railway]/[เครื่อง] ตรง "ทุกที่ที่โค้ดอ่าน" (ENV_PLACES) · บล็อก SECRET ต้องห้ามตั้งบน Railway
//   4) คู่มือ: ตาราง env ครบทุกชื่อ · ส่วน Railway บอก API_KEY ของบอท = DISCORD_API_SECRET ของ Vercel และห้ามตั้ง secret บน Railway
//   5) สแกนชื่อ env ที่โค้ดเลน A–D อ่านจริง (เท่าที่มีไฟล์ใน repo นี้) แล้วเทียบ .env.example — ตัวสแกนกัดกับซอร์สจำลองเสมอ
// กัดจริง: mutation ท้ายไฟล์ — patch ข้อความไฟล์ในหน่วยความจำ ตัวตรวจต้องเจอปัญหา · ข้อความเดิมต้องผ่าน
// await ทุกตัวครอบ settleWithin (บทเรียน node 22 — tests/helpers/fake-deadline.mjs)
// ============================================================
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { settleWithin } from './helpers/fake-deadline.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const TEXTS = Object.freeze({
  guard: read('scripts/research-agent-autostart.cmd'),
  env: read('.env.example'),
  doc: read('docs/RESEARCH-AGENT.md'),
});

const BS = '\\';
/** ตำแหน่งธงหยุดเทียบรากโปรเจกต์ — สัญญากับเลน A (loadConfig().stopFile · STOPFLAG ใน forever.cmd) */
const STOP_REL = ['logs', 'research-agent', 'research-agent.stop'].join(BS);
/** คำที่ guard ใช้จับโปรเซส worker (forever.cmd และ worker มีคำนี้ใน command line) */
const MATCH = 'research-agent-worker';
/** เครื่องมือ 12 ชิ้นตามสเปกข้อ 5 (หลังรวมเทียบกับ ALL_TOOLS ของเลน A ด้วย) */
const SPEC_TOOLS = Object.freeze(['serper', 'fetch-page', 'apify', 'web-agent', 'transcribe', 'gemini-video', 'youtube-meta', 'ocr', 'reverse-image', 'wiki', 'rss-news', 'quota']);
/** ชื่อ env ที่ .env.example ต้องมี: สเปก 2.5 + ฝั่ง worker ที่สเปกข้อ 4/8 และโค้ดเลน A ใช้ (+ r3: 6 ชื่อที่ตกหล่น · contract-check #6) */
const REQUIRED_ENV = Object.freeze([
  'RESEARCH_AGENT', 'RESEARCH_AGENT_MODE', 'RESEARCH_AGENT_SECRET', 'RESEARCH_AGENT_WAIT_MS', 'RESEARCH_AGENT_MAX_CALLS',
  'RESEARCH_AGENT_MAX_MINUTES', 'RESEARCH_AGENT_EFFORT', 'RESEARCH_AGENT_ALLOW_MEDIUM', 'RESEARCH_AGENT_TOOLS', 'RESEARCH_AGENT_BRAIN',
  'RESEARCH_AGENT_QUOTA_ALERT_PCT', 'RESEARCH_AGENT_TOOL_BUDGET_USD_MONTH', 'RESEARCH_AGENT_API_BASE', 'CODEX_ACCOUNT',
  'RESEARCH_AGENT_CODEX_ACCOUNTS', 'RESEARCH_AGENT_WORKDIR', 'RESEARCH_AGENT_WORKER_ID',
  'RESEARCH_AGENT_DEADLINE_MIN', 'RESEARCH_AGENT_CONCURRENCY', 'RESEARCH_AGENT_STALE_DAYS', 'RESEARCH_AGENT_OWNER_DISCORD_ID',
  'RESEARCH_AGENT_CODEX_BIN', 'RESEARCH_AGENT_IDLE_MS',
  // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 9 · W3): คิวชะลอหยิบงาน (src/lib/research-agent/queueHold.js อ่าน)
  'RESEARCH_AGENT_HOLD_MS',
  // ★ 1 ต.ค. 69 (Research Agent v2 · ออดิตก่อน push · W5): ทางสำรอง OpenAI API ของ worker (ค่าเริ่มต้นปิด · scripts/research-agent-worker.mjs อ่าน)
  'RESEARCH_AGENT_API_FALLBACK',
]);
/**
 * ที่ตั้ง (ป้ายใน .env.example) = ทุกที่ที่ต้องตั้งให้ค่านั้นมีผล · Vercel = เลน B · Railway = บอทเลน C · เครื่อง = worker เลน A
 * (RESEARCH_AGENT_MODE: worker อ่านเป็นค่าสำรองเฉพาะเมื่อ lease ไม่ส่ง mode — เว็บส่งเสมอ จึงไม่ติดป้ายเครื่อง)
 */
const ENV_PLACES = Object.freeze({
  RESEARCH_AGENT: ['Vercel', 'Railway'],
  RESEARCH_AGENT_MODE: ['Vercel'],
  RESEARCH_AGENT_SECRET: ['Vercel', 'เครื่อง'], // ⛔ ไม่ใช่ Railway (contract-check #7)
  RESEARCH_AGENT_WAIT_MS: ['Vercel'],
  RESEARCH_AGENT_DEADLINE_MIN: ['Vercel'],
  RESEARCH_AGENT_HOLD_MS: ['Vercel'], // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 9 · W3): ตัวหยิบงานคิว + /api/queue/status บน Vercel
  RESEARCH_AGENT_MAX_CALLS: ['เครื่อง'],
  RESEARCH_AGENT_MAX_MINUTES: ['เครื่อง'], // ฝั่งเว็บเลิกอ่านแล้ว (เส้นตายใบขอ = DEADLINE_MIN)
  RESEARCH_AGENT_EFFORT: ['เครื่อง'],
  RESEARCH_AGENT_ALLOW_MEDIUM: ['เครื่อง'],
  RESEARCH_AGENT_TOOLS: ['เครื่อง'],
  RESEARCH_AGENT_BRAIN: ['เครื่อง'],
  RESEARCH_AGENT_API_FALLBACK: ['เครื่อง'], // ★ 1 ต.ค. 69 (W5): worker เท่านั้น (ทางสำรอง API ค่าเริ่มต้นปิด)
  RESEARCH_AGENT_CONCURRENCY: ['เครื่อง'],
  RESEARCH_AGENT_STALE_DAYS: ['เครื่อง'],
  RESEARCH_AGENT_QUOTA_ALERT_PCT: ['Vercel', 'Railway', 'เครื่อง'],
  RESEARCH_AGENT_OWNER_DISCORD_ID: ['Railway'],
  RESEARCH_AGENT_TOOL_BUDGET_USD_MONTH: ['เครื่อง'],
  RESEARCH_AGENT_API_BASE: ['เครื่อง'],
  CODEX_ACCOUNT: ['เครื่อง'],
  RESEARCH_AGENT_CODEX_ACCOUNTS: ['เครื่อง'],
  RESEARCH_AGENT_CODEX_BIN: ['เครื่อง'],
  RESEARCH_AGENT_IDLE_MS: ['เครื่อง'],
  RESEARCH_AGENT_WORKDIR: ['เครื่อง'],
  RESEARCH_AGENT_WORKER_ID: ['เครื่อง'],
});
const PLACES = Object.freeze(['Vercel', 'Railway', 'เครื่อง']);
/** บรรทัดในคู่มือที่ตั้งใจปิดเบราว์เซอร์ต้องมีคำนี้ (ตัวอย่างที่ไม่มี browser) */
const BROWSER_OFF_MARK = 'ปิดเบราว์เซอร์';

// ── ตัวช่วยอ่าน .cmd ─────────────────────────────────────────────────────
/** บรรทัดคำสั่งของ .cmd (ตัด rem/::/บรรทัดว่าง) พร้อมเลขบรรทัด */
function cmdCodeLines(text) {
  return text.split('\n')
    .map((line, i) => ({ line, no: i + 1 }))
    .filter(({ line }) => line.trim() && !/^\s*(rem\b|::)/i.test(line));
}
/** ค่าของ set "NAME=value" ทุกครั้งที่ตั้ง (ตามลำดับ) */
function cmdSetValues(text, name) {
  const re = new RegExp(`^\\s*set\\s+"${name}=(.*)"\\s*$`, 'i');
  return cmdCodeLines(text).map(({ line }) => re.exec(line)).filter(Boolean).map((m) => m[1]);
}

/** ปัญหาของ guard (คืน [] = ผ่าน) */
function guardProblems(text) {
  const p = [];
  const code = cmdCodeLines(text);
  const startIdx = code.findIndex(({ line }) => /^\s*powershell\b/i.test(line) && /Start-Process/i.test(line));
  if (startIdx < 0) p.push('ไม่เจอบรรทัด powershell ... Start-Process ที่เปิด forever');
  // 1) ธงหยุด = ไฟล์ของ worker และเช็คก่อนเปิด
  const stops = cmdSetValues(text, 'RA_STOP');
  if (stops.length !== 1) p.push(`ต้องตั้ง RA_STOP ครั้งเดียว (เจอ ${stops.length})`);
  else if (stops[0].toLowerCase() !== `%RA_ROOT%${BS}${STOP_REL}`.toLowerCase()) p.push(`RA_STOP ต้องเป็น %RA_ROOT%${BS}${STOP_REL} (เจอ ${stops[0]})`);
  const stopIdx = code.findIndex(({ line }) => /^\s*if\s+exist\s+"%RA_STOP%"\s*\(\s*$/i.test(line));
  if (stopIdx < 0 || (startIdx >= 0 && stopIdx > startIdx)) p.push('ต้องเช็ค if exist "%RA_STOP%" ก่อนเปิด worker');
  // 2) จับโปรเซส: คำค้นมาทาง env (บรรทัด powershell ไม่จับตัวเอง) · ชื่อ forever.cmd มีคำนี้ · เปิดแบบซ่อนหน้าต่าง
  const match = cmdSetValues(text, 'RA_MATCH');
  if (match.length !== 1 || match[0] !== MATCH) p.push(`RA_MATCH ต้องเป็น ${MATCH}`);
  const forever = cmdSetValues(text, 'RA_FOREVER');
  if (forever.length !== 1 || !forever[0].toLowerCase().endsWith(`${BS}scripts${BS}research-agent-worker-forever.cmd`)) {
    p.push('RA_FOREVER ต้องชี้ scripts\\research-agent-worker-forever.cmd');
  }
  if (startIdx >= 0) {
    const ps = code[startIdx].line;
    if (!ps.includes('$env:RA_MATCH')) p.push('บรรทัด powershell ต้องอ่านคำค้นจาก $env:RA_MATCH');
    if (ps.includes(MATCH)) p.push('บรรทัด powershell ห้ามมีคำค้นตรงตัว (จะจับ command line ของตัวเองว่า running)');
    if (!/-WindowStyle\s+Hidden/i.test(ps)) p.push('ต้องเปิด forever แบบซ่อนหน้าต่าง');
  }
  // 3) PATH: เครื่องมือ Windows มาก่อน (เรียกจาก Git Bash แล้ว timeout ของ GNU ทำ forever วนรัว)
  const pathIdx = code.findIndex(({ line }) => /^\s*set\s+"PATH=%SystemRoot%\\System32;%PATH%"\s*$/i.test(line));
  if (pathIdx < 0 || (startIdx >= 0 && pathIdx > startIdx)) p.push('ต้องตั้ง PATH=%SystemRoot%\\System32;%PATH% ก่อนเปิด forever');
  // 4) ไวยากรณ์ที่พังง่าย: ASCII ล้วน · echo ในบล็อก ( ) ห้ามมีวงเล็บที่ไม่ได้ escape ด้วย ^ (บล็อกจะปิดก่อนเวลา)
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(text)) p.push('ไฟล์ .cmd ต้องเป็น ASCII ล้วน');
  let depth = 0;
  for (const { line, no } of code) {
    const t = line.trim();
    if (t === ')') { depth = Math.max(0, depth - 1); continue; }
    if (depth > 0) {
      const m = /^(?:>>?"[^"]*"\s+)?echo\b(.*)$/i.exec(t);
      if (m && /(^|[^^])[()]/.test(m[1])) p.push(`บรรทัด ${no}: echo ในบล็อก ( ) มีวงเล็บที่ไม่ได้ escape`);
    }
    if (t.endsWith('(')) depth++;
  }
  if (depth !== 0) p.push('บล็อก ( ) ไม่ปิดครบ');
  return p;
}

// ── .env.example ──────────────────────────────────────────────────────────
/** ตัวอย่าง "# NAME=value" ในไฟล์ (ชื่อแรกที่เจอ) */
function envExamples(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    const m = /^#\s?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && !out.has(m[1])) out.set(m[1], m[2].trim());
  }
  return out;
}
const toolTokens = (list) => String(list).split(',').map((s) => s.trim()).filter(Boolean);

/**
 * ป้ายที่ตั้งของตัวอย่างแต่ละตัว → Map ชื่อ → {label, block}
 *   label = ข้อความใน [..] ของบรรทัดคอมเมนต์ที่ขึ้นต้นบล็อก (null = บล็อกไม่มีป้าย) · ตัวอย่างติดกันใช้บล็อกเดียวกัน
 *   block = บรรทัดคอมเมนต์เหนือตัวอย่าง (ตั้งแต่ตัวอย่างก่อนหน้า/บรรทัดว่าง)
 */
function envExampleBlocks(text) {
  const out = new Map();
  let label = null;
  let block = [];
  let afterExample = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const ex = /^#\s?([A-Z][A-Z0-9_]*)=/.exec(line);
    if (ex) {
      if (!out.has(ex[1])) out.set(ex[1], { label, block: block.join('\n') });
      afterExample = true;
      continue;
    }
    if (!line.startsWith('#')) { label = null; block = []; afterExample = false; continue; }
    const tag = /^#\s*\[([^\]]+)\]/.exec(line);
    if (afterExample) { block = []; if (!tag) label = null; }
    if (tag) label = tag[1];
    block.push(line);
    afterExample = false;
  }
  return out;
}

/** ปัญหาเรื่องป้ายที่ตั้ง (contract-check #6 #7): ป้ายต้องตรง ENV_PLACES ทุกชื่อ · บล็อก SECRET ต้องห้ามตั้งบน Railway */
function envPlaceProblems(text) {
  const p = [];
  const blocks = envExampleBlocks(text);
  for (const name of REQUIRED_ENV) {
    const info = blocks.get(name);
    if (!info) continue; // ขาดตัวอย่าง — รายงานแล้วที่ envExampleProblems
    const want = ENV_PLACES[name];
    if (!want) { p.push(`เทสไม่มีป้ายที่คาดของ ${name} (ENV_PLACES)`); continue; }
    if (!info.label) { p.push(`.env.example: ${name} ไม่มีป้ายที่ตั้ง [Vercel]/[Railway]/[เครื่อง]`); continue; }
    const got = PLACES.filter((place) => info.label.includes(place));
    if ([...got].sort().join('+') !== [...want].sort().join('+')) {
      p.push(`.env.example: ป้ายของ ${name} = [${got.join(' + ') || '-'}] ต้องเป็น [${want.join(' + ')}] (ทุกที่ที่โค้ดอ่านจริง)`);
    }
  }
  const secret = blocks.get('RESEARCH_AGENT_SECRET');
  if (secret && !secret.block.includes('ห้ามตั้งบน Railway')) p.push('.env.example: บล็อก RESEARCH_AGENT_SECRET ต้องบอก "ห้ามตั้งบน Railway"');
  return p;
}

function envExampleProblems(text, tools = SPEC_TOOLS) {
  const p = [];
  const ex = envExamples(text);
  for (const name of REQUIRED_ENV) if (!ex.has(name)) p.push(`.env.example ขาดตัวอย่าง ${name}`);
  p.push(...envPlaceProblems(text));
  for (const line of text.split('\n')) {
    if (/^\s*(RESEARCH_AGENT\w*|CODEX_ACCOUNT\w*)\s*=/.test(line)) p.push(`.env.example ต้องเป็นคอมเมนต์ทั้งหมด (ไม่เปิดอะไรเอง): ${line.trim().slice(0, 40)}`);
  }
  if (ex.has('RESEARCH_AGENT_SECRET') && ex.get('RESEARCH_AGENT_SECRET') !== '') p.push('ตัวอย่าง RESEARCH_AGENT_SECRET ต้องว่าง');
  if (ex.has('RESEARCH_AGENT_TOOLS')) {
    const tokens = toolTokens(ex.get('RESEARCH_AGENT_TOOLS'));
    if (!tokens.includes('browser')) p.push('ตัวอย่าง RESEARCH_AGENT_TOOLS ต้องมี browser (ตั้งโดยไม่มี browser = เบราว์เซอร์ปิด)');
    const rest = tokens.filter((t) => t !== 'browser');
    if (new Set(rest).size !== rest.length) p.push('ตัวอย่าง RESEARCH_AGENT_TOOLS มีชื่อซ้ำ');
    const missing = tools.filter((t) => !rest.includes(t));
    const unknown = rest.filter((t) => !tools.includes(t));
    if (missing.length || unknown.length) {
      p.push(`ตัวอย่าง RESEARCH_AGENT_TOOLS ต้องครบ ${tools.length} ตัว (ขาด ${missing.join(',') || '-'} · ไม่รู้จัก ${unknown.join(',') || '-'})`);
    }
  }
  return p;
}

// ── คู่มือ ────────────────────────────────────────────────────────────────
function docProblems(text, tools = SPEC_TOOLS) {
  const p = [];
  const lines = text.split('\n');
  const flagPrefixes = [['logs', 'research-agent', ''].join(BS), 'logs/research-agent/'];
  lines.forEach((line, i) => {
    for (let at = line.indexOf('research-agent.stop'); at !== -1; at = line.indexOf('research-agent.stop', at + 1)) {
      if (!flagPrefixes.some((pre) => line.slice(0, at).endsWith(pre))) p.push(`บรรทัด ${i + 1}: อ้างไฟล์ธง research-agent.stop นอก ${STOP_REL}`);
    }
    if (line.includes('ปิดหน้าต่าง worker')) p.push(`บรรทัด ${i + 1}: สั่ง "ปิดหน้าต่าง worker" แต่ guard เปิด worker แบบซ่อนหน้าต่าง`);
    for (const m of line.matchAll(/RESEARCH_AGENT_TOOLS=([a-z0-9,-]+)/g)) {
      const tokens = toolTokens(m[1]);
      const unknown = tokens.filter((t) => t !== 'browser' && !tools.includes(t));
      if (unknown.length) p.push(`บรรทัด ${i + 1}: ตัวอย่าง RESEARCH_AGENT_TOOLS มีชื่อที่ไม่รู้จัก ${unknown.join(',')}`);
      const off = line.includes(BROWSER_OFF_MARK);
      if (!tokens.includes('browser') && !off) p.push(`บรรทัด ${i + 1}: ตัวอย่าง RESEARCH_AGENT_TOOLS ไม่มี browser แต่ไม่ได้บอกว่าตั้งใจ${BROWSER_OFF_MARK}`);
      if (tokens.includes('browser') && off) p.push(`บรรทัด ${i + 1}: ตัวอย่าง RESEARCH_AGENT_TOOLS มี browser แต่บรรทัดบอก${BROWSER_OFF_MARK}`);
    }
  });
  for (const flag of ['--stop', '--resume']) {
    if (!text.includes(`node scripts${BS}research-agent-worker.mjs ${flag}`)) p.push(`คู่มือต้องมีคำสั่ง node scripts${BS}research-agent-worker.mjs ${flag}`);
  }
  const envRow = lines.find((l) => l.startsWith('| `RESEARCH_AGENT_TOOLS` |'));
  if (!envRow || !envRow.includes('`browser`')) p.push('แถว RESEARCH_AGENT_TOOLS ในตาราง env ต้องบอกเรื่องคำ browser');
  const rollbackRow = lines.find((l) => l.startsWith('| จำกัดเครื่องมือ'));
  if (!rollbackRow || !rollbackRow.includes('`browser`')) p.push('แถว "จำกัดเครื่องมือ" ในวิธีถอยต้องบอกเรื่องคำ browser');
  // r3 (contract-check #6): ตาราง env ในคู่มือมีแถวครบทุกชื่อที่ .env.example ต้องมี
  for (const name of REQUIRED_ENV) {
    if (!lines.some((l) => l.startsWith(`| \`${name}\` |`))) p.push(`ตาราง env ในคู่มือขาดแถว ${name}`);
  }
  // r3 (contract-check #7 · ข้อตัดสินผู้คุมงาน): ส่วน Railway — กุญแจของบอทคือ API_KEY = DISCORD_API_SECRET · ห้ามตั้ง secret ของ worker
  if (!text.includes('`API_KEY` บน Railway ต้องเท่ากับ `DISCORD_API_SECRET` บน Vercel')) {
    p.push('คู่มือต้องบอกว่า API_KEY ของบอทบน Railway ต้องเท่ากับ DISCORD_API_SECRET บน Vercel');
  }
  if (!text.includes('ห้ามตั้ง `RESEARCH_AGENT_SECRET` บน Railway')) p.push('คู่มือต้องบอกว่าห้ามตั้ง RESEARCH_AGENT_SECRET บน Railway');
  return p;
}

const CHECKERS = Object.freeze({ guard: guardProblems, env: envExampleProblems, doc: docProblems });

// ── ชื่อ env ที่โค้ดอ่านจริง (r3 · contract-check #6) ─────────────────────────
/** ไฟล์/โฟลเดอร์โค้ดของทุกเลนที่อ่าน env รีเสิร์ช (ไม่รวมเทส) — สแกนเท่าที่มีใน repo นี้ */
const CODE_ENV_SOURCES = Object.freeze([
  'scripts/research-agent-worker.mjs', 'scripts/research-agent', 'scripts/research-tools', 'scripts/research-agent-report.mjs',
  'src/lib/research-agent', 'src/app/api/research', 'src/app/api/queue/add/route.js', 'src/lib/services/autoFlowServiceText.js',
  'src/app/api/bot/posted/route.js', 'discord-bot/researchCard.js', 'discord-bot/index.js',
]);
/** รูปการอ่าน env: env.X · env?.X · process.env.X · env['X'] · envFlag('X') ของบอท · ชื่อเป็นสตริงตรงตัว (รายงาน env[name]) */
const ENV_READ_PATTERNS = Object.freeze([
  /\benv\??\.((?:RESEARCH_AGENT|CODEX_ACCOUNT)\w*)/g,
  /\benv\[\s*['"]((?:RESEARCH_AGENT|CODEX_ACCOUNT)\w*)['"]\s*\]/g,
  /\benvFlag\(\s*['"]((?:RESEARCH_AGENT|CODEX_ACCOUNT)\w*)['"]/g,
  /['"`]((?:RESEARCH_AGENT|CODEX_ACCOUNT)(?:_[A-Z0-9]+)*)['"`]/g,
]);

/** ชื่อ env รีเสิร์ชที่ซอร์สอ่าน → Map ชื่อ → [ไฟล์] (ค่าคงที่ชื่อขึ้นต้นเหมือนกัน/ข้อความ error ที่มีชื่อนำหน้า ไม่นับ) */
function envNamesRead(sources) {
  const out = new Map();
  for (const [file, text] of Object.entries(sources)) {
    for (const re of ENV_READ_PATTERNS) {
      for (const m of String(text).matchAll(re)) {
        if (!out.has(m[1])) out.set(m[1], []);
        if (!out.get(m[1]).includes(file)) out.get(m[1]).push(file);
      }
    }
  }
  return out;
}

function codeEnvProblems(sources, envText) {
  const ex = envExamples(envText);
  return [...envNamesRead(sources)].filter(([name]) => !ex.has(name))
    .map(([name, files]) => `โค้ดอ่าน ${name} (${files.join(', ')}) แต่ .env.example ไม่มีตัวอย่าง`);
}

function listCodeFiles(root, rels) {
  const out = [];
  const walk = (abs) => {
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) { for (const name of readdirSync(abs).sort()) walk(path.join(abs, name)); return; }
    if (/\.(m?js|cjs)$/.test(abs)) out.push(abs);
  };
  for (const rel of rels) walk(path.join(root, ...rel.split('/')));
  return out;
}

// ── เทียบโค้ดเลน A (หลังรวม) ──────────────────────────────────────────────
const LANE_A_FILES = Object.freeze({
  worker: path.join(ROOT, 'scripts', 'research-agent-worker.mjs'),
  taskBuilder: path.join(ROOT, 'scripts', 'research-agent', 'taskBuilder.mjs'),
  forever: path.join(ROOT, 'scripts', 'research-agent-worker-forever.cmd'),
});

async function loadLaneA() {
  const [worker, tb] = await settleWithin(
    Promise.all([import(pathToFileURL(LANE_A_FILES.worker).href), import(pathToFileURL(LANE_A_FILES.taskBuilder).href)]),
    'import โค้ดเลน A', 10_000,
  );
  const forever = existsSync(LANE_A_FILES.forever) ? readFileSync(LANE_A_FILES.forever, 'utf8').replace(/\r\n/g, '\n') : null;
  return { loadConfig: worker.loadConfig, ALL_TOOLS: tb.ALL_TOOLS, forever };
}

/** ปัญหาเมื่อเทียบไฟล์ ops กับ loadConfig ตัวจริงของเลน A (คืน [] = ตรงกัน) */
function laneAProblems({ loadConfig, ALL_TOOLS, forever }, texts = TEXTS) {
  const p = [];
  const fakeRoot = path.resolve(path.sep, 'fake-repo-root');
  const conf = (env) => loadConfig(env, { repoRoot: fakeRoot });
  const base = conf({});
  // ธงหยุด: worker = guard = forever.cmd = สัญญาที่คู่มือยึด
  const workerStop = path.relative(fakeRoot, base.stopFile).split(path.sep).join(BS);
  const guardStop = (cmdSetValues(texts.guard, 'RA_STOP')[0] || '').replace(/^%RA_ROOT%\\/i, '');
  if (workerStop.toLowerCase() !== guardStop.toLowerCase()) p.push(`ธงหยุดไม่ตรง: worker ${workerStop} · guard ${guardStop}`);
  if (workerStop !== STOP_REL) p.push(`ธงหยุดของ worker (${workerStop}) ไม่ตรงที่คู่มือ/เทสยึด (${STOP_REL})`);
  if (forever != null) {
    const ff = cmdSetValues(forever, 'STOPFLAG');
    if (ff.length !== 1 || ff[0].toLowerCase() !== STOP_REL.toLowerCase()) p.push(`STOPFLAG ใน forever.cmd (${ff.join('|')}) ไม่ตรง ${STOP_REL}`);
  }
  // เครื่องมือ: ชุดเดียวกับสเปก · ไม่ตั้ง = ครบ + เบราว์เซอร์ · ตัวอย่าง .env.example (เอา # ออก) = เท่ากับไม่ตั้ง
  if ([...ALL_TOOLS].sort().join(',') !== [...SPEC_TOOLS].sort().join(',')) p.push(`ALL_TOOLS ของเลน A (${ALL_TOOLS.join(',')}) ไม่ตรงสเปกข้อ 5`);
  if (base.browser !== true || base.tools.join(',') !== ALL_TOOLS.join(',')) p.push('ไม่ตั้ง RESEARCH_AGENT_TOOLS ต้องได้เครื่องมือครบ + เบราว์เซอร์');
  const exTools = envExamples(texts.env).get('RESEARCH_AGENT_TOOLS');
  if (exTools == null) p.push('.env.example ไม่มีตัวอย่าง RESEARCH_AGENT_TOOLS');
  else {
    const ex = conf({ RESEARCH_AGENT_TOOLS: exTools });
    if (ex.browser !== base.browser || ex.tools.join(',') !== base.tools.join(',')) {
      p.push(`เอา # ออกจากตัวอย่าง RESEARCH_AGENT_TOOLS ต้องได้ผลเท่ากับไม่ตั้ง (ได้เบราว์เซอร์=${ex.browser} · ${ex.tools.length} เครื่องมือ)`);
    }
  }
  // ตัวอย่างในคู่มือ: worker เปิด/ปิดเบราว์เซอร์ตรงกับที่ข้อความบอก
  for (const line of texts.doc.split('\n')) {
    for (const m of line.matchAll(/RESEARCH_AGENT_TOOLS=([a-z0-9,-]+)/g)) {
      const cfg = conf({ RESEARCH_AGENT_TOOLS: m[1] });
      const saysOff = line.includes(BROWSER_OFF_MARK);
      if (cfg.browser === saysOff) p.push(`ตัวอย่างในคู่มือ ${m[1]}: worker เปิดเบราว์เซอร์=${cfg.browser} แต่ข้อความบอก${saysOff ? 'ปิด' : 'เปิด'}`);
    }
  }
  // RESEARCH_AGENT_WORKER_ID ที่ .env.example/คู่มือแนะนำ ถูก worker อ่านจริง
  if (conf({ RESEARCH_AGENT_WORKER_ID: 'team-pc' }).workerId !== 'team-pc') p.push('RESEARCH_AGENT_WORKER_ID ไม่ถูก worker อ่าน');
  return p;
}

// ── ข้อสอบหลัก ────────────────────────────────────────────────────────────
test('guard: ธงหยุด = ไฟล์ของ worker และเช็คก่อนเปิด · จับโปรเซสไม่จับตัวเอง · ซ่อนหน้าต่าง · PATH Windows ก่อน · ไวยากรณ์ cmd ไม่พัง', () => {
  assert.deepEqual(guardProblems(TEXTS.guard), []);
});

test('.env.example: ครบทุกชื่อ · เป็นคอมเมนต์ทั้งหมด · secret ว่าง · ตัวอย่าง TOOLS ครบ 12 + browser (เอา # ออก = เท่ากับไม่ตั้ง) · ป้าย [Vercel]/[Railway]/[เครื่อง] ตรงที่โค้ดอ่าน · SECRET ห้ามตั้งบน Railway', () => {
  assert.deepEqual(envExampleProblems(TEXTS.env), []);
  assert.deepEqual(Object.keys(ENV_PLACES).sort(), [...REQUIRED_ENV].sort(), 'ทุกชื่อที่ต้องมีต้องมีป้ายที่คาด (และกลับกัน)');
});

test('คู่มือ: ธงหยุดอ้างตำแหน่งเดียว · ไม่สั่งปิดหน้าต่าง · มี --stop/--resume · ตัวอย่าง TOOLS มี browser หรือบอกว่าปิด · ตาราง env/วิธีถอยเตือนเรื่อง browser · ตาราง env ครบทุกชื่อ · ส่วน Railway (API_KEY = DISCORD_API_SECRET · ห้ามตั้ง secret)', () => {
  assert.deepEqual(docProblems(TEXTS.doc), []);
});

test('env ที่โค้ดอ่านจริงมีใน .env.example ครบ (contract-check #6) — สแกนไฟล์โค้ดเลน A–D ที่มีใน repo นี้ (ก่อนรวม = เท่าที่มี) · ตัวสแกนกัดกับซอร์สจำลอง', (t) => {
  const files = listCodeFiles(ROOT, CODE_ENV_SOURCES);
  const sources = Object.fromEntries(files.map((f) => [path.relative(ROOT, f).split(path.sep).join('/'), readFileSync(f, 'utf8')]));
  const found = envNamesRead(sources);
  t.diagnostic(`สแกน ${files.length} ไฟล์ · พบชื่อ env ${found.size} ตัว: ${[...found.keys()].sort().join(', ') || '-'}`);
  assert.ok(files.length >= 1 && found.has('RESEARCH_AGENT_TOOL_BUDGET_USD_MONTH'), 'อย่างน้อยต้องสแกนสคริปต์รายงานของเลน D เอง');
  assert.deepEqual(codeEnvProblems(sources, TEXTS.env), []);
  // ตัวสแกนต้องกัด (ไม่ขึ้นกับว่ารวมเลนแล้วหรือยัง): ชื่อใหม่ที่ .env.example ไม่มี = ปัญหา · ค่าคงที่/ข้อความ error ที่ขึ้นต้นด้วยชื่อ ไม่นับ
  const fake = {
    'a.mjs': 'const n = env.RESEARCH_AGENT_NEW_KNOB; const m = process.env.RESEARCH_AGENT_DEADLINE_MIN; const o = env?.CODEX_ACCOUNT;',
    'b.js': "const on = envFlag('RESEARCH_AGENT_OTHER_SWITCH', false); export const RESEARCH_AGENT_MODES = []; const e = 'RESEARCH_AGENT_CODEX_BIN ต้องเป็นไฟล์เดียว';",
    'c.mjs': "read(env['RESEARCH_AGENT_IDLE_MS']); budget(env, 'RESEARCH_AGENT_TOOL_BUDGET_USD_MONTH');",
  };
  assert.deepEqual([...envNamesRead(fake).keys()].sort(), [
    'CODEX_ACCOUNT', 'RESEARCH_AGENT_DEADLINE_MIN', 'RESEARCH_AGENT_IDLE_MS', 'RESEARCH_AGENT_NEW_KNOB', 'RESEARCH_AGENT_OTHER_SWITCH',
    'RESEARCH_AGENT_TOOL_BUDGET_USD_MONTH',
  ]);
  const fakeProblems = codeEnvProblems(fake, TEXTS.env);
  assert.equal(fakeProblems.length, 2, fakeProblems.join(' | '));
  assert.ok(fakeProblems.some((x) => x.includes('RESEARCH_AGENT_NEW_KNOB')) && fakeProblems.some((x) => x.includes('RESEARCH_AGENT_OTHER_SWITCH')));
  // ตัด 6 ชื่อที่ contract-check จับได้ออกจาก .env.example → ตัวสแกนต้องเห็นว่าขาด (โค้ดจำลองอ่านครบ 6 ชื่อ)
  const sixNames = ['RESEARCH_AGENT_CODEX_BIN', 'RESEARCH_AGENT_IDLE_MS', 'RESEARCH_AGENT_OWNER_DISCORD_ID', 'RESEARCH_AGENT_CONCURRENCY', 'RESEARCH_AGENT_DEADLINE_MIN', 'RESEARCH_AGENT_STALE_DAYS'];
  const readsSix = { 'six.mjs': sixNames.map((n) => `env.${n};`).join(' ') };
  assert.deepEqual(codeEnvProblems(readsSix, TEXTS.env), []);
  const withoutSix = TEXTS.env.split('\n').filter((line) => !sixNames.some((n) => line.trim().startsWith(`# ${n}=`))).join('\n');
  assert.equal(codeEnvProblems(readsSix, withoutSix).length, 6);
});

// ── mutation: ข้อความไฟล์ที่ patch แล้วต้องโดนจับ (กันข้อสอบเขียวลอยๆ) ──────────
const MUTATIONS = [
  { name: 'guard ใช้ธงที่รากโปรเจกต์ (บั๊กรอบแรก)', file: 'guard', find: `set "RA_STOP=%RA_ROOT%${BS}${STOP_REL}"`, replace: `set "RA_STOP=%RA_ROOT%${BS}research-agent.stop"` },
  { name: 'guard ไม่เช็คธงหยุดก่อนเปิด', file: 'guard', find: 'if exist "%RA_STOP%" (', replace: 'if exist "%RA_STOP%.off" (' },
  { name: 'guard echo ในบล็อกมีวงเล็บไม่ escape', file: 'guard', find: `- resume with: node scripts${BS}research-agent-worker.mjs --resume`, replace: `(resume: node scripts${BS}research-agent-worker.mjs --resume)` },
  { name: 'guard ไม่ตั้ง PATH ให้ timeout ของ Windows มาก่อน', file: 'guard', find: `set "PATH=%SystemRoot%${BS}System32;%PATH%"`, replace: 'rem PATH as inherited' },
  { name: 'guard ใส่คำค้นตรงตัวในบรรทัด powershell (จับตัวเอง)', file: 'guard', find: '$m = $env:RA_MATCH;', replace: "$m = 'research-agent-worker';" },
  { name: '.env.example ตัวอย่าง TOOLS ไม่มี browser (บั๊กรอบแรก)', file: 'env', find: ',quota,browser', replace: ',quota' },
  { name: '.env.example เปิดสวิตช์จริง (ไม่ใช่คอมเมนต์)', file: 'env', find: '# RESEARCH_AGENT=1', replace: 'RESEARCH_AGENT=1' },
  { name: '.env.example ไม่มี RESEARCH_AGENT_WORKER_ID', file: 'env', find: '# RESEARCH_AGENT_WORKER_ID=', replace: '# (ไม่มี)' },
  { name: 'คู่มืออ้างธงที่รากโปรเจกต์ (บั๊กรอบแรก)', file: 'doc', find: `มีไฟล์ธงหยุด \`logs${BS}research-agent${BS}research-agent.stop\` →`, replace: 'มีไฟล์ `research-agent.stop` ที่รากโปรเจกต์ →' },
  { name: 'คู่มือสั่งปิดหน้าต่าง worker (บั๊กรอบแรก)', file: 'doc', find: '→ รีสตาร์ต worker ตามตาราง', replace: '→ รีสตาร์ต worker (ปิดหน้าต่าง worker) ตามตาราง' },
  { name: 'คู่มือตัวอย่าง TOOLS ในวิธีถอยไม่มี browser (บั๊กรอบแรก)', file: 'doc', find: 'transcribe,browser` (ตัด', replace: 'transcribe` (ตัด' },
  { name: 'คู่มือตัวอย่างเครื่องทีมใส่ browser ทั้งที่บอกปิด', file: 'doc', find: 'rss-news,quota` 🔗 · ถ้าจะให้มีเบราว์เซอร์', replace: 'rss-news,quota,browser` 🔗 · ถ้าจะให้มีเบราว์เซอร์' },
  { name: 'คู่มือไม่มีคำสั่ง --resume', file: 'doc', all: true, find: `node scripts${BS}research-agent-worker.mjs --resume`, replace: 'ลบไฟล์ธงเอง' },
  // ── r3 (contract-check #6 #7 · ข้อตัดสินผู้คุมงาน 1 ต.ค. 69) — ต่อท้ายเท่านั้น (LANE_A_MUTATIONS อ้างลำดับเดิม) ──
  { name: '.env.example สวิตช์หลักไม่มีป้าย Railway (บอทต้องตั้ง RESEARCH_AGENT=1 ด้วย)', file: 'env', find: '# [Vercel + Railway] สวิตช์หลัก', replace: '# [Vercel] สวิตช์หลัก' },
  { name: '.env.example ไม่เตือนห้ามตั้ง RESEARCH_AGENT_SECRET บน Railway', file: 'env', find: '⛔ ห้ามตั้งบน Railway', replace: '⛔ ตั้งบน Railway ได้' },
  { name: '.env.example SECRET ติดป้าย Railway', file: 'env', find: '# [Vercel + เครื่อง ค่าเดียวกัน] ความลับ', replace: '# [Vercel + เครื่อง + Railway ค่าเดียวกัน] ความลับ' },
  { name: '.env.example MAX_MINUTES ยังติดป้าย Vercel (ฝั่งเว็บเลิกอ่านแล้ว)', file: 'env', find: '# [เครื่อง] เวลาสูงสุดต่องานเป็นนาที', replace: '# [เครื่อง + Vercel ค่าเดียวกัน] เวลาสูงสุดต่องานเป็นนาที' },
  { name: '.env.example ขาด RESEARCH_AGENT_DEADLINE_MIN', file: 'env', find: '# RESEARCH_AGENT_DEADLINE_MIN=15', replace: '# (ไม่มี)' },
  { name: '.env.example ขาด RESEARCH_AGENT_OWNER_DISCORD_ID', file: 'env', find: '# RESEARCH_AGENT_OWNER_DISCORD_ID=', replace: '# (ไม่มี)' },
  { name: '.env.example บล็อก CONCURRENCY ไม่มีป้ายที่ตั้ง', file: 'env', find: '# [เครื่อง] งานพร้อมกันต่อเครื่อง', replace: '# งานพร้อมกันต่อเครื่อง' },
  { name: 'คู่มือไม่มีแถว env RESEARCH_AGENT_CONCURRENCY', file: 'doc', find: '| `RESEARCH_AGENT_CONCURRENCY` |', replace: '| CONCURRENCY |' },
  { name: 'คู่มือไม่ห้ามตั้ง RESEARCH_AGENT_SECRET บน Railway', file: 'doc', find: 'ห้ามตั้ง `RESEARCH_AGENT_SECRET` บน Railway', replace: 'ตั้ง `RESEARCH_AGENT_SECRET` บน Railway ได้' },
  { name: 'คู่มือไม่บอก API_KEY ของบอท = DISCORD_API_SECRET', file: 'doc', find: '`API_KEY` บน Railway ต้องเท่ากับ `DISCORD_API_SECRET` บน Vercel', replace: '`API_KEY` บน Railway ตั้งอะไรก็ได้' },
];

/** ข้อความที่ patch แล้ว (ไม่ตีความ $ ในคำแทน) */
function applyMutation(m) {
  const original = TEXTS[m.file];
  const count = original.split(m.find).length - 1;
  assert.ok(m.all ? count >= 1 : count === 1, `ข้อความเป้าหมายของ mutation ต้องเจอ ${m.all ? '≥1' : '1'} ที่ (ไฟล์เปลี่ยน = อัปเดตเทสนี้): ${m.find}`);
  const mutated = m.all ? original.split(m.find).join(m.replace) : original.replace(m.find, () => m.replace);
  assert.notEqual(mutated, original);
  return mutated;
}

for (const m of MUTATIONS) {
  test(`mutation: ${m.name} → ตัวตรวจต้องเจอปัญหา (ข้อความเดิมผ่าน)`, () => {
    assert.deepEqual(CHECKERS[m.file](TEXTS[m.file]), [], 'ข้อความเดิมต้องผ่าน');
    const problems = CHECKERS[m.file](applyMutation(m));
    assert.ok(problems.length > 0, `mutation "${m.name}" ต้องทำให้ตัวตรวจเจอปัญหา`);
  });
}

/** mutation ฝั่งความหมาย — ต้องโดน loadConfig ตัวจริงของเลน A จับ (รันเมื่อมีโค้ดเลน A) */
const LANE_A_MUTATIONS = [
  MUTATIONS[0], // guard ธงที่ราก ≠ ธงของ worker
  MUTATIONS[5], // .env.example ไม่มี browser → worker ปิดเบราว์เซอร์เมื่อเอา # ออก
  MUTATIONS[11], // คู่มือบอกปิดเบราว์เซอร์แต่ตัวอย่างทำให้ worker เปิด
];

test('เทียบโค้ดเลน A (หลังรวม): loadConfig ตัวจริง — ธงหยุด worker = guard = forever.cmd · ตัวอย่าง TOOLS ใน .env.example = ไม่ตั้ง · ตัวอย่างในคู่มือเปิด/ปิดเบราว์เซอร์ตรงข้อความ · WORKER_ID ถูกอ่าน · mutation ฝั่งความหมาย 3 แบบ', async (t) => {
  const present = [LANE_A_FILES.worker, LANE_A_FILES.taskBuilder].map((f) => existsSync(f));
  if (!present[0] && !present[1]) {
    t.diagnostic('ก่อนรวมเลน A: worktree นี้ไม่มี scripts/research-agent-worker.mjs และ scripts/research-agent/taskBuilder.mjs — ข้อเทียบความหมายจะรันจริงหลังรวม (ตรวจแบบคงที่ข้างบนรันแล้ว)');
    return;
  }
  assert.deepEqual(present, [true, true], 'มีไฟล์เลน A ไม่ครบคู่ (worker + taskBuilder) — รวมโค้ดไม่ครบ');
  const laneA = await loadLaneA();
  assert.deepEqual(laneAProblems(laneA), []);
  for (const m of LANE_A_MUTATIONS) {
    const problems = laneAProblems(laneA, { ...TEXTS, [m.file]: applyMutation(m) });
    assert.ok(problems.length > 0, `mutation (เทียบเลน A) "${m.name}" ต้องทำให้ตรวจเจอปัญหา`);
  }
});
