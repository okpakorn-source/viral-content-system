#!/usr/bin/env node
/**
 * scripts/lift-report.mjs [--days 60] [--threshold 0.4] [--min-n 5] [--pad-days 3] [--csv <file>] [--out _planD/lift] [--store post-metrics]
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ 2 ก.ย. 69 (ข้อ 5 ป้อนกลับผลจริง): คำนวณ lift ต่อ การ์ด / ครู / ความยาว / วิธีเปิดเรื่อง
 *   จากโพสต์จริง (store post-metrics) + generation_logs (ช่วงโพสต์ ±3 วัน) + สมุดครู viral_pick_history
 *   แล้วเขียน <out>/LIFT-REPORT.md + <out>/lift-report.json (ค่าเริ่มต้น out = _planD/lift/ — โฟลเดอร์ที่ .gitignore กันด้วย /_*)
 *   ⚠️ ไฟล์ผลไม่ commit — ผู้ตรวจ 2 ก.ย. 69: ค่าเริ่มต้นเดิม docs/ ทิ้งไฟล์ผลจริงเป็น untracked ในต้นไม้ที่ tracked จึงย้ายมา _planD/lift/
 *     จะรันจริงเมื่อเจ้าของสั่ง (เทสใช้ฟิกซ์เจอร์ ไม่แตะฐานข้อมูล)
 *   · --csv = ใช้โพสต์จากไฟล์ CSV ตรงๆ ไม่ต้องนำเข้า store ก่อน (ยังอ่านเคส/สมุดครูจาก Supabase)
 *   · ไม่มี Supabase env = โหมดไฟล์ในเครื่อง: _planD/lift/post-metrics.json (สำเนาจาก import-fb-metrics) + data/generation-logs.json
 *     (+ data/viral_pick_history.json ถ้ามี — fallback รูป persistStore ของ store นั้น)
 * รัน: node scripts/lift-report.mjs --days 60
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MATCH_THRESHOLD, parseFbCsv } from '../src/lib/feedback/postMatch.js';
import {
  DEFAULT_MIN_N,
  DEFAULT_PAD_DAYS,
  POST_METRICS_STORE,
  PICK_HISTORY_STORE,
  buildLiftReport,
  normalizeGeneration,
  normalizePosts,
  padWindow,
  renderLiftMarkdown,
  runLiftReport,
} from '../src/lib/feedback/liftReport.js';
import { LOCAL_DIR, ROOT, createSupabaseClient, loadEnvFile, readLocalStore } from './import-fb-metrics.mjs';

/** ไฟล์ผลลัพธ์ลงโฟลเดอร์เดียวกับสำเนา store ในเครื่อง (_planD/lift — ใต้ /_* ใน .gitignore) ไม่ใช่ docs/ ที่ tracked */
export const DEFAULT_OUT_DIR = path.join(ROOT, LOCAL_DIR);
export const REPORT_MD = 'LIFT-REPORT.md';
export const REPORT_JSON = 'lift-report.json';

export function parseArgs(argv) {
  const args = {
    days: 0, threshold: DEFAULT_MATCH_THRESHOLD, minN: DEFAULT_MIN_N, padDays: DEFAULT_PAD_DAYS,
    csv: '', out: DEFAULT_OUT_DIR, store: POST_METRICS_STORE, pageSize: 500,
  };
  const num = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [flag, inline] = a.includes('=') ? a.split(/=(.*)/s) : [a, undefined];
    const next = () => (inline !== undefined ? inline : argv[++i]);
    if (flag === '--days') args.days = Math.max(0, num(next(), 0));
    else if (flag === '--threshold') args.threshold = num(next(), DEFAULT_MATCH_THRESHOLD);
    else if (flag === '--min-n') args.minN = Math.max(1, num(next(), DEFAULT_MIN_N));
    else if (flag === '--pad-days') args.padDays = Math.max(0, num(next(), DEFAULT_PAD_DAYS));
    else if (flag === '--csv') args.csv = String(next() || '');
    else if (flag === '--out') args.out = path.resolve(String(next() || DEFAULT_OUT_DIR));
    else if (flag === '--store') args.store = String(next() || POST_METRICS_STORE);
    else if (flag === '--page-size') args.pageSize = Math.max(50, num(next(), 500));
  }
  return args;
}

/** โหมดไฟล์ในเครื่อง — ไม่มี Supabase: โพสต์จาก _planD/lift/<store>.json · เคส/สมุดครูจาก data/*.json แล้วคำนวณเหมือนกัน (เคสกรองช่วง ±padDays ด้วย) */
export function buildFromLocalFiles(args, root = ROOT) {
  const posts = [...readLocalStore(args.store, root).values()];
  const genFile = path.join(root, 'data', 'generation-logs.json');
  let generations = [];
  if (existsSync(genFile)) {
    let raw = readFileSync(genFile, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    const parsed = JSON.parse(raw);
    generations = Array.isArray(parsed) ? parsed : [];
  }
  // สมุดครูไม่ใช่ของฟีเจอร์นี้ — ถ้ามีไฟล์ในเครื่องจะอยู่ที่ data/<store>.json ตามรูป persistStore ไม่ใช่ _planD/lift/
  const pickHistory = [...readLocalStore(PICK_HISTORY_STORE, root, 'data').values()];
  const now = new Date();
  const window = args.days > 0
    ? { from: new Date(now.getTime() - args.days * 86400e3).toISOString(), to: now.toISOString() }
    : null;
  const cleanPosts = normalizePosts(posts, window);
  const effectiveWindow = window || (cleanPosts.length ? {
    from: cleanPosts.map((p) => p.publishedAt).filter(Boolean).sort()[0] || null,
    to: cleanPosts.map((p) => p.publishedAt).filter(Boolean).sort().at(-1) || null,
  } : null);
  const genWindow = padWindow(effectiveWindow, args.padDays);
  const inWindow = (row) => {
    if (!genWindow) return true;
    const g = normalizeGeneration(row);
    const t = g?.createdAt ? new Date(g.createdAt).toISOString() : null;
    return !t || (t >= genWindow.from && t <= genWindow.to);
  };
  const report = buildLiftReport({
    posts: cleanPosts,
    generations: generations.filter(inWindow),
    pickHistory,
    threshold: args.threshold,
    minN: args.minN,
    window: effectiveWindow,
    now,
    padDays: args.padDays,
  });
  report.window.generationFrom = genWindow?.from || null;
  report.window.generationTo = genWindow?.to || null;
  report.notes.push(`โหมดไฟล์ในเครื่อง (ไม่มี Supabase env): โพสต์จาก ${path.join(LOCAL_DIR, `${args.store}.json`)} · เคสจาก data/generation-logs.json · สมุดครูจาก data/${PICK_HISTORY_STORE}.json`);
  return { report, markdown: renderLiftMarkdown(report) };
}

export function writeOutputs(outDir, { report, markdown }) {
  mkdirSync(outDir, { recursive: true });
  const md = path.join(outDir, REPORT_MD);
  const json = path.join(outDir, REPORT_JSON);
  writeFileSync(md, markdown, 'utf8');
  writeFileSync(json, JSON.stringify(report, null, 2), 'utf8');
  return { md, json };
}

export function summaryLines(report) {
  const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
  const lift = (x) => (x == null ? '—' : `×${Number(x).toFixed(2)}`);
  const lines = [
    `โพสต์ทั้งเพจ ${fmt(report.page.posts)} (ค่ากลางไลก์ ${fmt(report.page.median)}) · เวอร์ชันระบบ ${fmt(report.input.versions)} ใบ/${fmt(report.input.generations)} เคส → จับคู่ได้ ${fmt(report.matched.versions)} ใบ (ค่ากลาง ${fmt(report.matched.median)} · lift ${lift(report.matched.lift)})`,
  ];
  for (const [name, label] of [['card', 'การ์ด'], ['teacher', 'ครู'], ['length', 'ความยาว'], ['opening', 'วิธีเปิด']]) {
    const dim = report.dimensions[name];
    const top = dim.ranked.slice(0, 3).map((g) => `${g.label} ${lift(g.lift)} (n=${g.n})`).join(' · ');
    lines.push(`${label}: สรุปได้ ${dim.ranked.length} กลุ่ม${top ? ' — ' + top : ''} · ยังสรุปไม่ได้ (n<${report.params.minN}) ${dim.insufficient.length} กลุ่ม`);
  }
  return lines;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  loadEnvFile();
  const sb = await createSupabaseClient();
  let result;
  if (args.csv) {
    const posts = parseFbCsv(readFileSync(path.resolve(args.csv), 'utf8'));
    result = await runLiftReport({ sb, days: args.days, threshold: args.threshold, minN: args.minN, padDays: args.padDays, posts, pageSize: args.pageSize });
    result.report.notes.push(`โพสต์อ่านจาก CSV โดยตรง (${path.basename(args.csv)}) ไม่ผ่าน store ${args.store}`);
    if (!sb) result.report.notes.push('ไม่มี Supabase env — ไม่ได้อ่านเคส/สมุดครู มีแต่ฐานทั้งเพจจาก CSV');
    result.markdown = renderLiftMarkdown(result.report);
  } else if (sb) {
    result = await runLiftReport({ sb, days: args.days, threshold: args.threshold, minN: args.minN, padDays: args.padDays, pageSize: args.pageSize });
  } else {
    result = buildFromLocalFiles(args);
  }
  const files = writeOutputs(args.out, result);
  for (const line of summaryLines(result.report)) console.log(`[lift-report] ${line}`);
  console.log(`[lift-report] เขียน ${files.md} · ${files.json}`);
  return { ...result, files };
}

// รันเป็น CLI เท่านั้น (import จากเทสจะไม่รัน main) — เทียบ path แบบทนพาธ unicode (Windows)
let _isMain = false;
try {
  _isMain = !!process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
} catch { _isMain = false; }
if (_isMain) {
  main().catch((e) => {
    console.error('[lift-report] ล้ม:', e && e.message);
    process.exitCode = 1;
  });
}
