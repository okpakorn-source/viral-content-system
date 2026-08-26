/**
 * 🧠 clipBrain/brainRunner.js — ตัวเชื่อม "สมอง" CLI แบบโปรแกรม (B1 · 25 ส.ค. 69)
 * ------------------------------------------------------------------
 * เรียก Claude Code (`claude -p`) / Codex (`codex exec`) เป็นโปรเซสลูก
 * ใช้เฉพาะเครื่องทีม (มี CLI ติดตั้ง) — Vercel ไม่มี CLI จะได้ BRAIN_UNAVAILABLE
 *
 * สัญญาใจ (ห้ามผิด):
 *   1. ฟังก์ชันนี้ "ไม่โยน error เด็ดขาด" — ทุกทางล้มเหลวคืน { ok:false, errorType, error }
 *      ให้ผู้เรียกตัดสินใจถอยลงท่อเดิมเอง (fail-open)
 *   2. ทุกการเรียกมีเพดานเวลา (CLIP_BRAIN_TIMEOUT_MS, ค่าเริ่มต้น 120 วิ) — หมดเวลา = ฆ่าทั้งต้นไม้โปรเซส
 *   3. จำกัดงานพร้อมกัน (CLIP_BRAIN_MAX_CONCURRENT, ค่าเริ่มต้น 2) — เกิน = BRAIN_BUSY ไม่เข้าคิวแช่
 *   4. ห้าม log เนื้อพรอมต์/ผลลัพธ์ยาวๆ และห้ามมี secret ใน log
 *   5. พรอมต์ส่งทาง stdin เสมอ (กันปัญหาความยาว/อักขระไทยบน argv ของ Windows)
 *
 *   6. โปรเซสลูกได้ env แบบ "รายชื่อปิด" เท่านั้น — ห้ามยกทั้ง process.env ให้ (ความลับรั่ว)
 *      และห้ามอนุญาตแบบ "ทั้ง prefix" ด้วย (ผู้ตรวจอิสระรอบสอง CB-01 · 26 ส.ค. 69)
 *   7. เรียกลูกแบบ spawn(ไฟล์โปรแกรม, [อาร์กิวเมนต์], { shell:false }) — ไม่มี shell มาแปลสตริงให้อีก
 *      (ผู้ตรวจอิสระรอบสอง CB-02 · 26 ส.ค. 69)
 *
 * env ที่เกี่ยว:
 *   CLIP_BRAIN_CLAUDE_BIN  (ค่าเริ่มต้น 'claude')  — ชี้ไบนารี/สคริปต์อื่นได้ เช่น claude-b.cmd หรือ fake ตอนเทส
 *   CLIP_BRAIN_CODEX_BIN   (ค่าเริ่มต้น 'codex')
 *   CLIP_BRAIN_WRITER_MODEL (ค่าเริ่มต้น 'sonnet') — รุ่นของสมองเขียนฝั่ง claude
 *   CLIP_BRAIN_LEAN        — '0' = ปิดโหมดผอม (โหลดกฎ/เครื่องมือของโปรเจกต์ตามปกติ)
 *   CLIP_BRAIN_TIMEOUT_MS / CLIP_BRAIN_MAX_CONCURRENT / CLIP_BRAIN_WORKDIR
 *   CLIP_BRAIN_PASS_ENV    — รายชื่อ env เพิ่มเติมที่ยอมส่งต่อให้ลูก คั่นด้วยจุลภาค (เช่น HTTPS_PROXY)
 *                            ชื่อที่มีคำว่า KEY/SECRET/TOKEN/PASSWORD/COOKIE/CREDENTIAL/AUTH/
 *                            ชื่อผู้ให้บริการ ถูกปฏิเสธเสมอ · ตัวนี้ "ไม่" ถูกส่งต่อให้ลูก
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEF_TIMEOUT_MS = 120000;
const OUT_CAP = 4 * 1024 * 1024; // กันสมองพ่นจนความจำบวม
const ERR_CAP = 512 * 1024;

function envInt(name, def) {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}
const head = (s, n) => String(s == null ? '' : s).slice(0, n);
const tail = (s, n) => { const t = String(s == null ? '' : s); return t.length > n ? t.slice(-n) : t; };

function tryParse(x) {
  try { const v = JSON.parse(String(x).trim()); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

/** ดึง JSON object จากข้อความปนๆ (สมองมักมีคำเกริ่น/แบนเนอร์รอบคำตอบ) — เอาก้อนที่ parse ได้ตัวท้ายสุด */
export function extractJson(text) {
  const s = String(text == null ? '' : text);
  if (!s.trim()) return null;
  const direct = tryParse(s);
  if (direct) return direct;
  const fences = [...s.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  for (let i = fences.length - 1; i >= 0; i--) {
    const j = tryParse(fences[i]);
    if (j) return j;
  }
  const spans = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"' && depth > 0) { inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) { spans.push([start, i + 1]); start = -1; }
      }
    }
  }
  for (let i = spans.length - 1; i >= 0; i--) {
    const j = tryParse(s.slice(spans[i][0], spans[i][1]));
    if (j) return j;
  }
  // ไม้ตายสุดท้าย: ปีกกาค้างในร้อยแก้วก่อน JSON จริง (เช่น 'เขียน { แบบนี้ ... {"ok":true}')
  // ทำให้ตัวนับ depth ไม่มีวันกลับมา 0 → สแกนข้างบนไม่เจอก้อนไหนเลย (ผู้ตรวจไขว้พิสูจน์ 25 ส.ค.)
  // → ไล่จาก '{' ตัวท้ายๆ ย้อนขึ้นไป ลอง parse ถึง '}' ตัวท้ายสุดที่เป็นไปได้ · จำกัดจำนวนครั้งกันช้า
  const opens = [];
  for (let i = 0; i < s.length; i++) if (s[i] === '{') opens.push(i);
  const lastClose = s.lastIndexOf('}');
  if (lastClose > 0) {
    const tries = Math.min(opens.length, 40);
    for (let k = 0; k < tries; k++) {
      const start = opens[opens.length - 1 - k];
      if (start >= lastClose) continue;
      const j = tryParse(s.slice(start, lastClose + 1));
      if (j) return j;
    }
  }
  return null;
}

// 🔴 ชื่อรุ่นต้องเป็นอักขระปลอดภัยล้วน — ถึงตอนนี้จะไม่ผ่าน shell แล้ว (spawn shell:false) แต่ยังต้องกัน
//    เพราะ (ก) เส้น .cmd shim บน Windows ยังต้องผ่าน cmd.exe (ข) ค่าที่ขึ้นต้นด้วยขีดกลายเป็น "ธง" ของ CLI
//    ผู้ตรวจไขว้พิสูจน์จริง 25 ส.ค.: model ที่มี & แทรกคำสั่งได้สำเร็จ (สร้างไฟล์ได้จริง)
//    → ผิดรูป = โยน BadModelError ให้ชั้นบนคืน BRAIN_BAD_MODEL (ห้ามเงียบๆ ใช้ค่าเริ่มต้นแทน
//      เพราะจะกลบ config ที่ตั้งผิดจนหาไม่เจอ)
class BadModelError extends Error {}
// 🔴 ตัวแรกต้องเป็นตัวอักษร/ตัวเลขเท่านั้น (ผู้ตรวจอิสระพิสูจน์ 26 ส.ค.: ของเดิมยอมให้ขึ้นต้นด้วยขีด
//    ค่าอย่าง '--dangerously-bypass-approvals-and-sandbox' จึงผ่านด่านแล้วกลายเป็น "ธง" ของ CLI แทนชื่อรุ่น)
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
function safeModel(v, def) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return def;
  if (!SAFE_MODEL.test(s)) throw new BadModelError(`ชื่อรุ่นมีอักขระต้องห้าม/ขึ้นต้นผิด: ${s.slice(0, 40)}`);
  return s;
}

// 🔴 ค่า BIN มาจาก env แล้วกลายเป็นโปรแกรมที่เราสั่งรัน — ของเดิมยอมให้เป็น "หัวคำสั่งอิสระ" กี่โทเคนก็ได้
//    แล้วส่งลง shell (ผู้ตรวจอิสระรอบสอง CB-02 · 26 ส.ค. probe: CLIP_BRAIN_CLAUDE_BIN="cmd /c echo ..."
//    รันได้จริงและได้ ok:true) → ปิดสองชั้น:
//      ชั้น 1 (ที่นี่): BIN ต้องเป็น "ไฟล์โปรแกรมเดียว" · พ่วงได้อย่างมาก 1 ชิ้นและต้องเป็น
//                      ไฟล์สคริปต์ที่มีอยู่จริง (.mjs/.js/.cjs) เท่านั้น — เผื่อเส้น `node <script>`
//                      (ตัวปลอมตอนเทส / wrapper ของทีม) · ธง/คำอิสระอย่าง `/c`, `echo` ตกด่านทันที
//      ชั้น 2 (execBrain): spawn(ไฟล์, [args], { shell:false }) — ไม่มี shell มาแปลสตริงอีกเลย
//    กติกาอักขระ: อนุญาตเฉพาะ ตัวอักษร ตัวเลข \ / : . _ - และช่องว่าง (คั่นโทเคน)
//    "ตัวอักษร" นับตัวอักษรภาษาอื่นด้วย (\p{L}\p{M}\p{N}) เพราะโฟลเดอร์โปรไฟล์ Windows เป็นภาษาไทยได้
//    เครื่องหมายคำพูดคู่ใช้ได้เฉพาะ "ครอบทั้งโทเคน" กรณี path มีช่องว่าง — แทรกกลางโทเคนไม่ได้
//    อักขระสั่งงาน shell ทุกตัว (& | < > ^ ' % $ ( ) ; ` และขึ้นบรรทัดใหม่) ตกด่านทันที
class BadBinError extends Error {}
const SAFE_BIN_TOKEN = /^[\p{L}\p{M}\p{N}\\/:. _-]+$/u;
const SCRIPT_EXT = new Set(['.mjs', '.js', '.cjs']);
function tokenizeBin(s) {
  const toks = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === ' ') { i++; continue; }
    if (s[i] === '"') {
      const end = s.indexOf('"', i + 1);
      if (end < 0) throw new BadBinError('เครื่องหมายคำพูดไม่ครบคู่');
      if (end + 1 < s.length && s[end + 1] !== ' ') throw new BadBinError('เครื่องหมายคำพูดต้องครอบทั้งโทเคน');
      toks.push(s.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    let end = s.indexOf(' ', i);
    if (end < 0) end = s.length;
    toks.push(s.slice(i, end));
    i = end;
  }
  return toks;
}
/**
 * ตรวจค่า BIN แล้วคืน { file, preArgs } (โยน BadBinError ถ้าไม่ผ่าน)
 *   file    = ไฟล์โปรแกรมที่จะ spawn (ยังไม่ resolve — execBrain ทำต่อ)
 *   preArgs = [] หรือ [path เต็มของสคริปต์ที่พ่วง]  ← path เต็มเสมอ เพราะลูกรันใน cwd อื่น (workDir)
 */
function parseBin(v, def) {
  const raw = String(v == null ? '' : v).trim() || def;
  if (/[\r\n\t\0]/.test(raw)) throw new BadBinError('ค่า BIN มีอักขระขึ้นบรรทัดใหม่/แท็บ');
  const toks = tokenizeBin(raw);
  if (!toks.length) throw new BadBinError('ค่า BIN ว่าง');
  // ตรวจอักขระ "ก่อน" ตรวจโครงสร้างเสมอ — ค่าที่มีอักขระสั่งงานต้องได้เหตุผล "อักขระต้องห้าม" ตรงๆ
  for (const t of toks) {
    if (!t || !SAFE_BIN_TOKEN.test(t)) throw new BadBinError(`ค่า BIN มีอักขระต้องห้าม: ${raw.slice(0, 60)}`);
  }
  if (toks.length === 1) return { file: toks[0], preArgs: [] };
  if (toks.length > 2) {
    throw new BadBinError(`ค่า BIN ต้องเป็นไฟล์โปรแกรมเดียว (พ่วงสคริปต์ได้ 1 ชิ้น) แต่ได้ ${toks.length} ชิ้น: ${raw.slice(0, 60)}`);
  }
  const script = path.resolve(toks[1]);
  let isFile = false;
  try { isFile = fs.statSync(script).isFile(); } catch { isFile = false; }
  if (!isFile || !SCRIPT_EXT.has(path.extname(script).toLowerCase())) {
    throw new BadBinError(`ค่า BIN พ่วงได้เฉพาะไฟล์สคริปต์ (.mjs/.js/.cjs) ที่มีอยู่จริง ไม่ใช่ธง/คำสั่ง: ${toks[1].slice(0, 60)}`);
  }
  return { file: toks[0], preArgs: [script] };
}

// 🔎 หาไฟล์โปรแกรมจริงบน Windows ก่อน spawn — จำเป็นสองเรื่อง
//    1) ต้องรู้ว่าเป็น .cmd/.bat ไหม เพราะ Node ≥20.12 "โยน EINVAL" ถ้า spawn .cmd/.bat โดยไม่ผ่าน shell
//       (พิสูจน์บนเครื่องนี้ 26 ส.ค. Node v24.15.0) และ CLI จริงของทีมคือ claude.cmd/codex.cmd
//    2) ไม่พบไฟล์ = บอก ENOENT ตรงๆ ให้ชั้นบนแปลเป็น BRAIN_UNAVAILABLE (ผู้เรียกถอยลงท่อเดิมได้ถูกทาง)
const WIN = process.platform === 'win32';
const WIN_EXEC_EXT = ['.COM', '.EXE', '.BAT', '.CMD'];
function isFileSync(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
function hasDirPart(f) { return /[\\/]/.test(f) || /^[A-Za-z]:/.test(f); }
function resolveWinExe(file) {
  const bases = hasDirPart(file)
    ? [path.resolve(file)]
    : String(process.env.PATH || '').split(path.delimiter).filter(Boolean).map((d) => path.join(d, file));
  for (const b of bases) {
    const cands = WIN_EXEC_EXT.includes(path.extname(b).toUpperCase())
      ? [b]
      : [...WIN_EXEC_EXT.map((e) => b + e), b];
    for (const c of cands) if (isFileSync(c)) return { exe: c, batch: /\.(cmd|bat)$/i.test(c) };
  }
  return null;
}

// 🔴 env ของลูก: "รายชื่อปิด" เท่านั้น (ผู้ตรวจอิสระจับ 26 ส.ค.: ของเดิมยก {...process.env} ให้ทั้งก้อน
//    → API key/ความลับทุกตัวของเซิร์ฟเวอร์ตกถึงมือ CLI ลูกที่รับพรอมต์จากเนื้อคลิปซึ่งเชื่อไม่ได้)
//    🔴 รอบสอง CB-01 (26 ส.ค.): กฎ K.startsWith('CLIP_BRAIN_') ยังกว้างเกิน — probe ผู้ตรวจ
//    ตั้ง CLIP_BRAIN_PASSWORD_* / COOKIE_* / CREDENTIAL_* / AUTH_* แล้วเห็นครบใน child env
//    → เลิกอนุญาตทั้ง prefix · ใส่เฉพาะชื่อที่ "โค้ดในโมดูลนี้อ่านจริง" ทีละตัว
//      (grep ทั้ง src/ scripts/ 26 ส.ค.: ไม่มีไฟล์อื่นในระบบอ่าน CLIP_BRAIN_* เลย นอกจากไฟล์นี้)
//      CLIP_BRAIN_PASS_ENV ตั้งใจไม่ส่งต่อ — เป็นนโยบายของฝั่งแม่ ไม่ใช่ค่าที่ลูกต้องใช้
//    ⚠️ USERPROFILE/APPDATA/LOCALAPPDATA ตัดไม่ได้ — CLI หาโฟลเดอร์โปรไฟล์/auth ของตัวเองจากตรงนี้
const ENV_ALLOW = new Set([
  // ฝั่งระบบปฏิบัติการ — ตัดแล้วลูกหา CLI/โฟลเดอร์ชั่วคราว/โปรไฟล์ตัวเองไม่เจอ
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'COMSPEC', 'WINDIR', 'TEMP', 'TMP',
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'HOME',
  'USERNAME', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'LANG', 'LC_ALL',
  // ค่าตั้งของโมดูลนี้ — เฉพาะตัวที่โค้ดอ่านจริงเท่านั้น
  'CLIP_BRAIN_LEAN', 'CLIP_BRAIN_WRITER_MODEL',
  'CLIP_BRAIN_CLAUDE_BIN', 'CLIP_BRAIN_CODEX_BIN', 'CLIP_BRAIN_WORKDIR',
  'CLIP_BRAIN_TIMEOUT_MS', 'CLIP_BRAIN_MAX_CONCURRENT',
]);
// ★ 26 ส.ค. 69 (เจ้าของสั่ง "ต้องมีสวิตช์สลับบัญชี ห้ามล่มเงียบ"):
//   ตัวแปรชี้ "โฟลเดอร์บัญชี" ของ CLI — ค่าเป็น path ไม่ใช่ความลับ แต่ต้องส่งให้ลูกถึงจะสลับบัญชีได้
//   ⚠️ ชื่อ CODEX_HOME/CLAUDE_CONFIG_DIR ไม่ชนคำต้องห้าม แต่ประกาศแยกไว้ให้เห็นชัดว่าเป็นข้อยกเว้นที่ตั้งใจ
const ENV_ACCOUNT_DIR = new Set(['CLAUDE_CONFIG_DIR', 'CODEX_HOME']);
// คำต้องห้ามชนะทุกอย่าง — ชนะทั้ง allowlist ข้างบนและ PASS_ENV (ห้ามผ่านไม่ว่าใครสั่ง)
const ENV_DENY_WORD = /KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|COOKIE|AUTH|SESSION|PRIVATE|SUPABASE|GEMINI|OPENAI|ANTHROPIC|DISCORD/;
export function buildChildEnv(accountDirs = null) {
  const extra = new Set(
    String(process.env.CLIP_BRAIN_PASS_ENV || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
  );
  const out = {};
  for (const k of Object.keys(process.env)) {
    const K = k.toUpperCase();
    if (ENV_ACCOUNT_DIR.has(K)) { out[k] = process.env[k]; continue; }  // โฟลเดอร์บัญชี = path ไม่ใช่ความลับ
    if (ENV_DENY_WORD.test(K)) continue;
    if (ENV_ALLOW.has(K) || extra.has(K)) out[k] = process.env[k];
  }
  // บัญชีที่ผู้เรียกสั่งมา ชนะค่าจากสภาพแวดล้อมเสมอ (ใช้ตอนสลับบัญชีอัตโนมัติ)
  if (accountDirs && typeof accountDirs === 'object') {
    for (const k of Object.keys(accountDirs)) {
      const K = k.toUpperCase();
      if (ENV_ACCOUNT_DIR.has(K) && accountDirs[k]) out[K] = String(accountDirs[k]);
    }
  }
  out.NO_COLOR = '1';
  out.FORCE_COLOR = '0';
  return out;
}

/**
 * ★ ทะเบียนบัญชีสมอง — เจ้าของสั่ง 26 ส.ค. 69 "ห้ามล่มเงียบ ต้องมีสวิตช์สลับบัญชี"
 * ตั้งผ่าน env (คั่นด้วย ,) เช่น
 *   CLIP_BRAIN_CLAUDE_ACCOUNTS="C:\Users\User\.claude,C:\Users\User\.claude-okpakorn"
 *   CLIP_BRAIN_CODEX_ACCOUNTS="C:\Users\User\.codex,C:\Users\User\.codex-mumoo"
 * ไม่ตั้ง = ใช้บัญชีเริ่มต้นของเครื่องตัวเดียว (พฤติกรรมเดิมเป๊ะ)
 */
export function accountList(brain) {
  const envName = brain === 'claude' ? 'CLIP_BRAIN_CLAUDE_ACCOUNTS' : 'CLIP_BRAIN_CODEX_ACCOUNTS';
  const dirVar = brain === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME';
  const raw = String(process.env[envName] || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!raw.length) return [{ name: 'default', dirVar, dir: null }];   // ไม่ตั้ง = เดิม
  return raw.slice(0, 5).map((dir, i) => ({ name: i === 0 ? 'หลัก' : `สำรอง${i}`, dirVar, dir }));
}

/**
 * จับ "โควตาหมด/ถูกจำกัดอัตรา" ให้แยกจากพังทั่วไป — ของเดิมตกไปเป็น BRAIN_EXIT ปนสาเหตุอื่น = ล่มเงียบ
 * ตรวจจากข้อความที่ CLI พ่นออกมา (ทั้ง stdout/stderr) ครอบทั้งฝั่ง Claude และ Codex
 */
const QUOTA_RE = /usage limit reached|rate.?limit|quota (?:exceeded|exhausted)|out of (?:credits?|quota)|insufficient (?:credits?|quota)|429|too many requests|upgrade to increase|limit will reset|credit balance is too low|plan limit/i;
export function isQuotaMessage(s) { return QUOTA_RE.test(String(s || '')); }

// 🔑 พิสูจน์จริง 25 ส.ค.: โหมด "ผอม" (ไม่โหลดเครื่องมือ/กฎโปรเจกต์/MCP) เร็วกว่าเดิม ~8 เท่า
//    (พรอมต์วางแผนเดียวกัน: ค่าเริ่มต้น 62.8 วิ → ผอม 8.0 วิ) และกันกฎเขียนโค้ดของโปรเจกต์
//    (CLAUDE.md/สกิล) ไหลเข้าสมองบรรณาธิการข่าวโดยไม่ตั้งใจ
// ⚠️ ข้อความนี้ต้องคงที่ทุกครั้ง — เปลี่ยนเมื่อไหร่ แคชฝั่งผู้ให้บริการหลุด ค่าใช้จ่ายเด้งขึ้นหลายเท่า
//    (วัดจริง: แคชอุ่น $0.039/ครั้ง · แคชเย็น $0.22/ครั้ง)
const CLAUDE_SYSTEM = 'You are a careful Thai news editor. Follow the user instructions exactly and output only what is requested.';

const BRAINS = {
  claude: {
    binEnv: 'CLIP_BRAIN_CLAUDE_BIN',
    defBin: 'claude',
    buildArgs(opts) {
      const model = safeModel(opts.model || process.env.CLIP_BRAIN_WRITER_MODEL, 'sonnet');
      const args = ['-p', '--model', model, '--output-format', 'json'];
      // ⚠️ ไม่ครอบ quote เองแล้ว — args ส่งเป็น "อาร์เรย์" ตรงเข้า spawn (shell:false) ค่าที่ CLI ได้รับ
      //    เท่ากับของเดิมทุกตัวอักษร (เมื่อก่อน shell เป็นคนแกะ quote ออกให้) → แคชฝั่งผู้ให้บริการไม่หลุด
      if (process.env.CLIP_BRAIN_LEAN !== '0') {
        args.push('--system-prompt', CLAUDE_SYSTEM, '--setting-sources', '', '--strict-mcp-config', '--allowed-tools', '');
      }
      return args;
    },
    // ซอง --output-format json: { type:'result', subtype:'success', result:'<ข้อความคำตอบ>', modelUsage:{...costUSD} }
    parse(out) {
      const env = tryParse(out) || extractJson(out);
      if (env && (env.type === 'result' || env.subtype || env.is_error)) {
        if (env.is_error || (env.subtype && env.subtype !== 'success')) {
          return { cliError: `claude: ${env.subtype || 'error'} — ${head(env.result || env.error || '', 200)}` };
        }
        // มิเตอร์เงิน: ใช้ยอดที่ CLI สรุปเองเป็นหลัก (authoritative) — ผู้ตรวจไขว้ชี้ว่าถ้า modelUsage
        // มาไม่ครบ/ว่าง จะบวกได้ $0 ทั้งที่จ่ายจริง → งบต่อคลิปเพี้ยน
        let cost = null;
        if (Number.isFinite(env.total_cost_usd)) cost = Number(env.total_cost_usd);
        else if (env.modelUsage && typeof env.modelUsage === 'object' && Object.keys(env.modelUsage).length) {
          cost = 0;
          for (const k of Object.keys(env.modelUsage)) cost += Number((env.modelUsage[k] || {}).costUSD || 0);
        }
        return { text: String(env.result || ''), costUSD: cost };
      }
      return { text: out }; // ไม่ใช่ซองที่รู้จัก (CLI รุ่นอื่น) — ใช้ดิบ ให้ชั้น JSON ข้างบนตัดสิน
    },
  },
  codex: {
    binEnv: 'CLIP_BRAIN_CODEX_BIN',
    defBin: 'codex',
    buildArgs(opts) {
      // --ephemeral = ไม่เขียนไฟล์ session ลงดิสก์ · --ignore-user-config = ไม่โหลด config/MCP/hook ของผู้ใช้
      // (ตรวจจาก `codex exec --help` บนเครื่องนี้ 26 ส.ค. ว่ามีธงสองตัวนี้จริง — ไม่ใส่ธงที่ไม่มี)
      const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '--ignore-user-config'];
      const m = opts.model ? safeModel(opts.model, '') : '';
      if (m) args.push('-m', m);
      args.push('-'); // อ่านพรอมต์จาก stdin
      return args;
    },
    parse(out) {
      const m = String(out).match(/tokens used[^\d]*([\d,]+)/i);
      return { text: out, tokensUsed: m ? Number(m[1].replace(/,/g, '')) : null };
    },
  },
};

let inflight = 0;

function workDir() {
  // ไดเรกทอรีกลางๆ — กัน CLI ไปโหลดกติกาโปรเจกต์ (CLAUDE.md) เข้าพรอมต์บรรณาธิการโดยไม่ตั้งใจ
  const d = process.env.CLIP_BRAIN_WORKDIR || path.join(os.tmpdir(), 'clip-brain-work');
  try { fs.mkdirSync(d, { recursive: true }); return d; } catch { return os.tmpdir(); }
}

/**
 * ฆ่าทั้งต้นไม้โปรเซส — คืน { killFailed, reason } (ผู้ตรวจอิสระจับ 26 ส.ค.)
 *   Windows: ต้อง "รอ taskkill จบจริง" ไม่ใช่ยิงทิ้ง จะได้รู้ว่าฆ่าสำเร็จไหม
 *   POSIX  : ลูกถูก spawn แบบ detached (เป็นหัวกลุ่ม) → ฆ่าทั้งกลุ่มด้วย pid ติดลบ
 *            ของเดิม child.kill ฆ่าแค่ตัว shell แม่ ลูกหลานรอดอยู่ต่อ
 */
function killTree(child) {
  return new Promise((resolve) => {
    const pid = child && child.pid;
    if (!pid) return resolve({ killFailed: true, reason: 'ไม่มี pid' });
    if (process.platform === 'win32') {
      let tk;
      try {
        tk = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } catch (e) { return resolve({ killFailed: true, reason: (e && e.message) || 'taskkill พลาด' }); }
      const guard = setTimeout(() => resolve({ killFailed: true, reason: 'taskkill ไม่จบใน 4 วิ' }), 4000);
      if (guard.unref) guard.unref();
      tk.on('error', (e) => { clearTimeout(guard); resolve({ killFailed: true, reason: (e && e.message) || 'taskkill error' }); });
      // โค้ด 128 = ไม่พบโปรเซส (ตายไปเองก่อน) — ถือว่าสำเร็จ
      tk.on('close', (code) => {
        clearTimeout(guard);
        resolve({ killFailed: !(code === 0 || code === 128), reason: `taskkill โค้ด ${code}` });
      });
      return;
    }
    try { process.kill(-pid, 'SIGKILL'); return resolve({ killFailed: false }); } catch (e) {
      if (e && e.code === 'ESRCH') return resolve({ killFailed: false, reason: 'กลุ่มตายไปแล้ว' });
      // ฆ่าทั้งกลุ่มไม่ได้ → อย่างน้อยฆ่าตัวแม่ แต่ต้องรายงานตรงๆ ว่าลูกหลานอาจรอด
      try { child.kill('SIGKILL'); } catch { /* ตายไปแล้ว */ }
      return resolve({ killFailed: true, reason: `ฆ่าทั้งกลุ่มไม่ได้: ${(e && e.message) || e}` });
    }
  });
}

/**
 * เรียกโปรเซสลูกจริง — ไม่ผ่าน shell (CB-02) และมีสถานะจบเดียวไม่แข่งกัน (CB-03)
 * @param {object} p { file, args:[], cwdDir, timeoutMs, prompt }
 */
function execBrain({ file, args, cwdDir, timeoutMs, prompt, accountDirs = null }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };

    let spawnFile = file;
    let spawnArgs = Array.isArray(args) ? args : [];
    const spawnOpts = {
      shell: false, // 🔴 หัวใจ CB-02 — ไม่มี shell มาแปลสตริงให้อีก args ไปเป็นอาร์เรย์ตรงๆ
      cwd: cwdDir,
      windowsHide: true,
      detached: !WIN, // POSIX: ให้ลูกเป็นหัวกลุ่ม จะได้ฆ่าทั้งกลุ่มตอนหมดเวลา
      env: buildChildEnv(accountDirs),
    };
    if (WIN) {
      const found = resolveWinExe(file);
      if (!found) {
        const e = new Error(`spawn ${file} ENOENT`);
        e.code = 'ENOENT';
        return finish({ spawnError: e });
      }
      if (found.batch) {
        // .cmd/.bat รันตรงไม่ได้ (Node ≥20.12 โยน EINVAL) — CLI จริงของทีมคือ claude.cmd/codex.cmd
        // → เรียกผ่าน cmd.exe แบบ "เราประกอบบรรทัดคำสั่งเองและครอบ quote ทุกชิ้น" + verbatim
        //   ปลอดภัยเพราะทุกชิ้นผ่านด่านแล้ว: ไม่มี " % & | < > ^ ` $ หรือขึ้นบรรทัดใหม่ เหลือรอด
        //   (path ผ่าน SAFE_BIN_TOKEN · model ผ่าน SAFE_MODEL · ที่เหลือเป็นค่าคงที่ในไฟล์นี้)
        const q = (s) => `"${String(s).replace(/"/g, '')}"`;
        const line = [q(found.exe), ...spawnArgs.map(q)].join(' ');
        spawnFile = process.env.COMSPEC || 'cmd.exe';
        spawnArgs = ['/d', '/s', '/c', `"${line}"`];
        spawnOpts.windowsVerbatimArguments = true;
      } else {
        spawnFile = found.exe;
      }
    } else if (hasDirPart(file)) {
      spawnFile = path.resolve(file); // ลูกรันใน workDir — path สัมพัทธ์ต้องกางก่อน ไม่งั้นชี้ผิดที่
    }

    let child;
    try { child = spawn(spawnFile, spawnArgs, spawnOpts); }
    catch (e) { return finish({ spawnError: e }); }

    let out = '', err = '', outTrunc = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { if (out.length < OUT_CAP) out += d; else outTrunc = true; });
    child.stderr.on('data', (d) => { if (err.length < ERR_CAP) err += d; });

    // 🔴 CB-03 (ผู้ตรวจอิสระรอบสอง 26 ส.ค.): ของเดิมยิง killTree().then() ทิ้งไว้ไม่ await
    //    แล้ว listener 'close' เรียก finish() ได้ก่อน → รายงาน killFailed:false ทั้งที่ยังไม่รู้ผล taskkill
    //    → รวมเป็น "สถานะเดียว เจ้าของเดียว": พอ timedOut=true แล้ว เส้น timeout เท่านั้นที่สรุปผล
    //      close/error แค่บันทึกว่าลูกตายแล้วและปลุกคนรอ · orphaned = ฆ่าเสร็จแล้ว close ยังไม่มา
    let timedOut = false;
    let closed = false;
    let closeCode = null;
    let closeWaiter = null;
    let backstop = null;
    const markClosed = (code) => {
      closed = true;
      closeCode = code;
      if (closeWaiter) { const w = closeWaiter; closeWaiter = null; w(); }
    };
    const waitClosed = (ms) => (closed ? Promise.resolve() : new Promise((res) => {
      const t = setTimeout(() => { closeWaiter = null; res(); }, ms);
      if (t.unref) t.unref();
      closeWaiter = () => { clearTimeout(t); res(); };
    }));

    const timer = setTimeout(async () => {
      timedOut = true;
      // 🔴 ตาข่ายกันตาย (ผู้ตรวจไขว้เสนอ 25 ส.ค.): ถ้าฆ่าต้นไม้ไม่หมด (หลานถือ pipe ไว้)
      //    event 'close' จะไม่ยิง → Promise ค้างตลอดกาล → inflight ไม่ลด → ติด BRAIN_BUSY
      //    ถาวรจนต้องรีสตาร์ทเซิร์ฟเวอร์ · บังคับจบเองภายใน 5 วิ ไม่ว่าลูกจะตายจริงหรือไม่
      //    (ตั้งตาข่ายก่อนสั่งฆ่า เผื่อ taskkill เองค้าง) — เส้นนี้ "ไม่รู้ผลฆ่า" จึงต้องรายงาน killFailed:true
      backstop = setTimeout(() => finish({
        code: null, out, err, timedOut: true, outTrunc,
        killFailed: true, orphaned: !closed, killReason: 'สรุปผลการฆ่าไม่ทันใน 5 วิ',
      }), 5000);
      if (backstop.unref) backstop.unref();
      let k;
      try { k = await killTree(child); } catch (e) { k = { killFailed: true, reason: (e && e.message) || 'killTree พลาด' }; }
      // 🔑 ปลดตาข่ายทันทีที่ "รู้ผลฆ่าจริง" — ถ้าปล่อยไว้ ตาข่ายอาจเด้งตอนกำลังรอ close
      //    แล้วรายงาน killFailed:true ทั้งที่ฆ่าสำเร็จ (รายงานผิด = ผู้เรียกตัดสินใจผิด)
      //    เพดานเวลาที่เหลือจากจุดนี้คุมด้วย waitClosed(2 วิ) เอง จึงไม่มีทางค้างตลอดกาล
      if (backstop) { clearTimeout(backstop); backstop = null; }
      if (k.killFailed) { try { console.warn(`[ClipBrain] ⚠️ ฆ่าโปรเซสไม่สำเร็จ: ${head(k.reason, 120)}`); } catch {} }
      // ฆ่าแล้วต้องรอ 'close' ยืนยันว่าตายจริง — ฆ่าผ่านแต่ close ไม่มา = ยังมีลูกหลานถือ pipe อยู่
      if (!closed) await waitClosed(2000);
      finish({
        code: closed ? closeCode : null, out, err, timedOut: true, outTrunc,
        killFailed: !!k.killFailed, orphaned: !closed, killReason: k.reason || null,
      });
    }, timeoutMs);

    const clearAll = () => { clearTimeout(timer); if (backstop) { clearTimeout(backstop); backstop = null; } };
    child.on('error', (e) => {
      if (timedOut) { markClosed(null); return; } // หมดเวลาไปแล้ว — เส้น timeout เป็นเจ้าของผล
      clearAll();
      finish({ spawnError: e, out, err });
    });
    child.on('close', (code) => {
      markClosed(code);
      if (timedOut) return; // หมดเวลาไปแล้ว — เส้น timeout เป็นเจ้าของผล (กันแข่งกับ taskkill)
      clearAll();
      finish({ code, out, err, timedOut: false, outTrunc });
    });
    try {
      child.stdin.on('error', () => {}); // EPIPE ตอนลูกตายเร็ว — ให้ close เป็นคนสรุป
      child.stdin.write(prompt, 'utf8');
      child.stdin.end();
    } catch { /* ปล่อยให้ close จัดการ */ }
  });
}

/**
 * เรียกสมอง 1 ครั้ง — ไม่โยน error เด็ดขาด
 * @param {object} opts { brain:'claude'|'codex', prompt, expectJson=true, timeoutMs?, model?, label? }
 * @returns {Promise<{ok:boolean, brain, label, text?, json?, costUSD?, tokensUsed?, elapsedMs, errorType?, error?, rawSample?, truncated?}>}
 */
export async function runBrain(rawOpts) {
  const t0 = Date.now();
  // 🔴 สัญญา fail-open ต้องเริ่มตั้งแต่บรรทัดแรก (ผู้ตรวจอิสระจับ 26 ส.ค.: runBrain(null) โยน TypeError
  //    เพราะอ่าน opts ก่อนเข้า try) — ค่าที่ไม่ใช่ object, Symbol, หรือ getter ที่โยน ต้องกลายเป็น { ok:false }
  const opts = (rawOpts && typeof rawOpts === 'object') ? rawOpts : {};
  const pick = (k) => { try { const v = opts[k]; return v == null ? '' : String(v); } catch { return ''; } };
  const kind = pick('brain');
  const label = pick('label') || kind || 'brain';
  const base = { brain: kind, label };
  const fail = (errorType, error, extra = {}) => {
    const r = { ok: false, ...base, errorType, error: head(error || errorType, 500), elapsedMs: Date.now() - t0, ...extra };
    try { console.warn(`[ClipBrain] ✗ ${label} (${kind || '?'}) ${errorType} ${r.elapsedMs}ms`); } catch {}
    return r;
  };
  try {
    const spec = BRAINS[kind];
    if (!spec) return fail('BRAIN_BAD_KIND', `ไม่รู้จักสมอง: ${kind || '(ว่าง)'}`);
    const prompt = String(opts.prompt || '');
    if (!prompt.trim()) return fail('BRAIN_EMPTY_PROMPT', 'พรอมต์ว่าง');
    const cap = envInt('CLIP_BRAIN_MAX_CONCURRENT', 2);
    if (inflight >= cap) return fail('BRAIN_BUSY', `สมองไม่ว่าง (${inflight}/${cap}) — ถอยลงท่อเดิม`);
    const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : envInt('CLIP_BRAIN_TIMEOUT_MS', DEF_TIMEOUT_MS);
    const bin = process.env[spec.binEnv] || spec.defBin;
    let launch;
    try {
      const parsed = parseBin(bin, spec.defBin);
      launch = { file: parsed.file, args: [...parsed.preArgs, ...spec.buildArgs(opts)] };
    } catch (e) {
      if (e instanceof BadModelError) return fail('BRAIN_BAD_MODEL', e.message);
      if (e instanceof BadBinError) return fail('BRAIN_BAD_BIN', `${spec.binEnv}: ${e.message}`);
      throw e;
    }
    inflight++;
    try {
      // ★ สลับบัญชีอัตโนมัติเมื่อโควตาหมด (เจ้าของสั่ง 26 ส.ค. "ห้ามล่มเงียบ")
      //   ลองบัญชีตามลำดับในทะเบียน — เจอโควตาหมดค่อยขยับไปตัวถัดไป · สาเหตุอื่นหยุดทันที (ไม่เผาโควตาซ้ำ)
      const accounts = accountList(kind);
      const tried = [];
      let r = null, used = null;
      for (const acc of accounts) {
        const dirs = acc.dir ? { [acc.dirVar]: acc.dir } : null;
        r = await execBrain({ file: launch.file, args: launch.args, cwdDir: workDir(), timeoutMs, prompt, accountDirs: dirs });
        used = acc;
        const blob = `${r.out || ''}\n${r.err || ''}`;
        const quotaHit = !r.spawnError && !r.timedOut && isQuotaMessage(blob);
        tried.push({ account: acc.name, dir: acc.dir, quotaHit });
        if (!quotaHit) break;
        try { console.warn(`[ClipBrain] 🔁 ${label}: บัญชี "${acc.name}" โควตาหมด → สลับบัญชีถัดไป`); } catch {}
      }
      const accountInfo = { account: used?.name || 'default', accountsTried: tried };
      // ทุกบัญชีโควตาหมด → บอกตรงๆ ห้ามกลืนเป็น error ทั่วไป
      if (tried.length && tried.every((t) => t.quotaHit)) {
        return fail('BRAIN_QUOTA',
          `โควตาหมดทุกบัญชี (ลองแล้ว ${tried.length}: ${tried.map((t) => t.account).join(', ')}) — ต้องเติมแพลนหรือเพิ่มบัญชีสำรอง`,
          { ...accountInfo, rawSample: tail(`${r?.out || ''}\n${r?.err || ''}`, 300) });
      }
      if (r.spawnError) {
        const msg = (r.spawnError && (r.spawnError.message || r.spawnError.code)) || String(r.spawnError);
        return fail(/ENOENT/i.test(String(msg)) ? 'BRAIN_UNAVAILABLE' : 'BRAIN_SPAWN_ERROR', msg, accountInfo);
      }
      // orphaned/killFailed = บอกผู้เรียกตรงๆ ว่าโปรเซสลูกอาจยังไม่ตาย (จะได้ตัดสินใจเตือน/ไม่ยิงซ้ำรัวๆ)
      if (r.timedOut) {
        return fail('BRAIN_TIMEOUT', `เกินเพดานเวลา ${timeoutMs}ms`, {
          rawSample: tail(r.out, 300),
          orphaned: !!r.orphaned,
          killFailed: !!r.killFailed,
          killReason: r.killReason || null, // เหตุผลจริงจาก taskkill/kill — ไม่ปั้นเอง
          ...accountInfo,
        });
      }
      if (r.code !== 0) {
        // "เครื่องนี้ไม่มี CLI ตัวนี้" ต้องแยกจาก "CLI ทำงานแล้วพัง" — ผู้เรียกตัดสินใจถอยคนละแบบ
        // 🔑 พิสูจน์จริงบน Windows (25 ส.ค.): spawn shell:true วิ่งผ่าน cmd.exe ซึ่งคืน **โค้ด 1**
        //    ('xxx' is not recognized...) ไม่ใช่ 9009 (นั่นเป็นของ PowerShell) → เช็คข้อความควบคู่โค้ด
        // 🔴 ผู้ตรวจไขว้จับได้ 25 ส.ค.: ต้องเช็ค "เฉพาะตอนโค้ดไม่ใช่ 0" และดู stderr เท่านั้น —
        //    ของเดิมเช็ค stdout ด้วยตั้งแต่ก่อนดูโค้ด ทำให้คำตอบสำเร็จที่บังเอิญมีวลีนี้
        //    (เช่นคลิปสอนคอมพูดถึง "command not found") ถูกตีเป็น "ไม่มีสมองบนเครื่อง" ทั้งที่ทำงานปกติ
        if (r.code === 9009 || r.code === 127 ||
            /is not recognized as an internal or external command|command not found|not recognized as the name of a cmdlet/i.test(String(r.err || ''))) {
          return fail('BRAIN_UNAVAILABLE', `ไม่พบ CLI '${bin}' บนเครื่องนี้ (โค้ด ${r.code})`, { exitCode: r.code, ...accountInfo });
        }
        return fail('BRAIN_EXIT', `สมองออกด้วยโค้ด ${r.code}: ${tail(r.err || r.out, 300)}`, { exitCode: r.code, ...accountInfo });
      }
      const parsed = spec.parse(r.out);
      // CLI ตอบสำเร็จแต่ข้างในบอกโควตาหมด (เช่นซอง json ของ claude) — ต้องแยกให้ชัดเช่นกัน
      if (parsed.cliError && isQuotaMessage(parsed.cliError)) return fail('BRAIN_QUOTA', parsed.cliError, { ...accountInfo, rawSample: head(r.out, 300) });
      if (parsed.cliError) return fail('BRAIN_CLI_ERROR', parsed.cliError, { rawSample: head(r.out, 300), ...accountInfo });
      const text = String(parsed.text || '');
      if (!text.trim()) return fail('BRAIN_EMPTY_ANSWER', 'สมองตอบว่างเปล่า', accountInfo);
      let json = null;
      if (opts.expectJson !== false) {
        json = extractJson(text) || (kind === 'codex' ? extractJson(r.out) : null);
        if (!json) return fail('BRAIN_BAD_JSON', 'ไม่พบ JSON ในคำตอบสมอง', { text: head(text, 2000), rawSample: head(r.out, 300), ...accountInfo });
      }
      const res = {
        ok: true, ...base, ...accountInfo, text, json,
        costUSD: parsed.costUSD != null ? parsed.costUSD : null,
        tokensUsed: parsed.tokensUsed != null ? parsed.tokensUsed : null,
        elapsedMs: Date.now() - t0,
        truncated: !!r.outTrunc,
      };
      try {
        const costStr = res.costUSD != null ? ` $${Number(res.costUSD).toFixed(4)}` : '';
        const tokStr = res.tokensUsed ? ` ${res.tokensUsed}tok` : '';
        console.log(`[ClipBrain] ✓ ${label} (${kind}) ${res.elapsedMs}ms${costStr}${tokStr}`);
      } catch {}
      return res;
    } finally { inflight--; }
  } catch (e) {
    return fail('BRAIN_SPAWN_ERROR', (e && e.message) || e);
  }
}

/** เช็คว่าสมองตัวนี้พร้อมใช้บนเครื่องนี้ไหม (ใช้ในหน้า health / ก่อนเปิดโหมดสมอง) */
export async function checkBrain(brain) {
  const spec = BRAINS[brain];
  if (!spec) return { available: false, reason: `ไม่รู้จักสมอง: ${brain}` };
  const bin = process.env[spec.binEnv] || spec.defBin;
  try {
    let parsed;
    try {
      parsed = parseBin(bin, spec.defBin); // เส้นเดียวกับ runBrain — ค่า BIN สกปรกต้องตกด่านตรงนี้ด้วย
    } catch (e) {
      if (e instanceof BadBinError) return { available: false, reason: `${spec.binEnv}: ${e.message}` };
      throw e;
    }
    const r = await execBrain({
      file: parsed.file, args: [...parsed.preArgs, '--version'], cwdDir: workDir(), timeoutMs: 15000, prompt: '',
    });
    if (r.spawnError) return { available: false, reason: head((r.spawnError.message || r.spawnError), 200) };
    if (r.timedOut) return { available: false, reason: 'เช็คเวอร์ชันค้างเกิน 15 วิ' };
    if (r.code !== 0) return { available: false, reason: `ออกด้วยโค้ด ${r.code}` };
    return { available: true, version: head(String(r.out || '').trim(), 80) };
  } catch (e) {
    return { available: false, reason: head((e && e.message) || e, 200) };
  }
}
