#!/usr/bin/env node
/**
 * ✅ scripts/research-tools/check-result.mjs — ตรวจไฟล์ผล out/result.json ก่อนจบงาน (เอเจนต์รันเองจากเชลล์ของ Codex)
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 10 ชั้น 2 · W4) — เหตุ: batch 1 ต.ค. 69 20:30 ไฟล์ผล 2/8 งานภาษาไทยกลายเป็น ?
 *   (เอเจนต์เขียนเองบน Windows แบบ ANSI/ผ่าน pipe ของ PowerShell) แต่เอเจนต์ไม่รู้ตัว (ข้อความสุดท้ายยังเป็นไทยปกติ) → ให้เครื่องมือนี้บอก
 * ใช้:  node tools/check-result.mjs [out/result.json]      (ไม่ใส่ = out/result.json ของโฟลเดอร์งานปัจจุบัน)
 * ตรวจ: อ่านไบต์ (BOM UTF-8 ยอมแต่ไม่บังคับ · UTF-16 ที่มี BOM ยอม) → JSON object ที่ parse ได้ → ไม่เข้ารหัสผิด
 *   (ไทย ≥ 1 ตัว และ ?/อักษรเสีย ≤ 5% ของอักษรในช่องข้อความ — กฎกลาง scripts/research-agent/encodingCheck.mjs ตัวเดียวกับ worker/gate)
 *   → มีคีย์บังคับ plan/cards/tool_log/origin_post (ขาด = worker ตีงานเป็น AGENT_FAILED อยู่แล้ว จึงบอกให้แก้ก่อนจบ)
 * พิมพ์ JSON บรรทัดเดียว (ASCII ล้วน — คอนโซลบางเครื่องทำไทยในผลเครื่องมือพัง):
 *   {ok, file, encoding, bom, reason, thaiChars, questionMarks, replacementChars, mojibake, letters, ratio, fields_bad[], fields_bad_count,
 *    missing_keys[], hint} · exit 0 = ผ่าน · 1 = ไม่ผ่าน/ไม่มีไฟล์/อ่านไม่ได้ · 2 = ใช้ผิด (ข้อความอยู่ stderr)
 *   โหลดกฎกลางไม่ได้ = fail-open: ok:true + reason CHECKER_UNAVAILABLE (ไม่ให้เอเจนต์วนเขียนซ้ำ · worker ตรวจซ้ำด้วยกฎเดียวกัน)
 * โหลดกฎกลางแบบ dynamic: ทางสัมพัทธ์ก่อน (ใน repo · tools/ เป็น junction ที่ node ตามไปไฟล์จริง) → ไม่เจอ = โหมดสำเนา
 *   (RESEARCH_AGENT_TOOLS ตั้งไว้ · tools/ เป็นสำเนานอก repo) ใช้รากโปรเจกต์จาก env/.repo-root (_common.importFromRepo)
 * อ่านอย่างเดียว: ไม่แก้ไฟล์ ไม่ยิงเน็ต ไม่ใช้คีย์
 */
import fs from 'node:fs';
import path from 'node:path';
import { runTool, importFromRepo, UsageError } from './_common.mjs';

const USAGE = 'usage: node tools/check-result.mjs [out/result.json]   (prints one JSON line · exit 0 = ok · 1 = not ok · 2 = usage)';
export const DEFAULT_RESULT_PATH = path.join('out', 'result.json');

/** โหลดกฎกลาง: ทางสัมพัทธ์ (repo / junction) → รากโปรเจกต์ (โหมดสำเนา) */
export async function loadEncodingCheck() {
  try {
    return await import('../research-agent/encodingCheck.mjs');
  } catch {
    return importFromRepo('scripts/research-agent/encodingCheck.mjs');
  }
}

const NOT_READABLE_HINT = Object.freeze({
  FILE_NOT_FOUND: 'out/result.json not found - write it with apply_patch first, then run this check again.',
  READ_ERROR: 'cannot read out/result.json - write it again with apply_patch, then run this check again.',
});

/**
 * ตรวจไฟล์ผล 1 ไฟล์ → ผล JSON (ไม่โยน error)
 * fail-open (สเปกส่วน 10 "fail-open ทุกชั้น"): โหลดกฎกลางไม่ได้ = ok:true + reason CHECKER_UNAVAILABLE (ไม่ขวางเอเจนต์ให้วนเขียนซ้ำ ·
 *   worker ตรวจไฟล์ซ้ำด้วยกฎเดียวกันอยู่แล้ว) — ต่างจากไฟล์ไม่มี/อ่านไม่ได้/เสีย ซึ่งเป็นเรื่องที่เอเจนต์แก้ได้ (ok:false)
 * @param {string} file
 * @param {{readFile?: Function, loader?: () => Promise<object>}} [deps]
 */
export async function checkResultFile(file, { readFile = fs.readFileSync, loader = loadEncodingCheck } = {}) {
  let buf;
  try { buf = readFile(file); } catch (e) {
    const reason = e && e.code === 'ENOENT' ? 'FILE_NOT_FOUND' : 'READ_ERROR';
    return { ok: false, file, reason, hint: NOT_READABLE_HINT[reason] };
  }
  let enc;
  try { enc = await loader(); } catch {
    return { ok: true, file, reason: 'CHECKER_UNAVAILABLE', hint: 'checker rules could not be loaded - finish normally (the worker re-checks out/result.json).' };
  }
  const dec = enc.decodeTextBuffer(buf);
  const r = enc.checkResultText(dec.text);
  return { ok: r.ok, file, encoding: dec.encoding, bom: dec.bom, ...r };
}

/** อาร์กิวเมนต์: ไฟล์เดียว (ตำแหน่ง) · ธงอื่น = ใช้ผิด (--help/-h จัดการโดย runTool) */
export async function run(argv) {
  const args = Array.isArray(argv) ? argv.map(String) : [];
  const flags = args.filter((a) => a.startsWith('-'));
  if (flags.length) throw new UsageError(`unknown option: ${flags[0].slice(0, 40)}`);
  if (args.length > 1) throw new UsageError('give one file only');
  return checkResultFile(args[0] || DEFAULT_RESULT_PATH);
}

runTool(import.meta.url, run, USAGE);
