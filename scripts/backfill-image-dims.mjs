#!/usr/bin/env node
// ============================================================
// P2 lane B — ท่อเติม "ขนาดจริง" ให้คลังรูปต่อเคส (backfill real dims)
// ------------------------------------------------------------
// ปัญหาค้างเก่า: ~48% ของรูปในคลังเคสไม่มี realWidth/realHeight → ด่านครอป (candidateCropReadiness /
//   megaAdapters realShortSideOf) มองไม่เห็นขนาด → hero/slot เลือกพลาด/ถอยเกณฑ์.
// สคริปต์นี้ไล่รูปที่ "ยังไม่มี dims จริง" แล้ว:
//   • imageUrl เป็นไฟล์ local (ขึ้นต้น '/') หรือไฟล์ถาวรบน Supabase Storage (supabase.co) → โหลด buffer
//     พอ probe แล้วอ่าน metadata ด้วย sharp (อ่านหัวไฟล์อย่างเดียว — ไม่ decode/ไม่แก้พิกเซลแม้แต่ไบต์เดียว)
//   • เขียนเฉพาะ realWidth / realHeight / realShortSide + measuredFrom:'backfill_probe' ลง record
//     (ห้ามแตะฟิลด์อื่น · ห้ามทับ dims ที่มีอยู่แล้ว — record เก่าที่วัดตอน rehost แม่นกว่า)
//   • ข้าม hotlink เว็บนอก (http ที่ไม่ใช่ supabase.co) — กัน network หนัก + ลิงก์หมดอายุ → รายงานจำนวนที่ข้าม
//
// 🔴 ไม่มีการเจน/สังเคราะห์/แก้พิกเซลภาพใด ๆ — sharp ถูกใช้อ่าน metadata เท่านั้น (เป็นไปตาม AGENTS.md §6)
//
// การใช้งาน:
//   node scripts/backfill-image-dims.mjs --dry-run            # ไม่เขียน แค่รายงานว่าจะเติมกี่ใบ
//   node scripts/backfill-image-dims.mjs --dry-run --limit 5  # จำกัด 5 ใบต่อรอบ (พิสูจน์)
//   node scripts/backfill-image-dims.mjs --limit 200          # เขียนจริง (default limit 200/รอบ)
//   node scripts/backfill-image-dims.mjs --case CASE-063      # เฉพาะเคสเดียว (fs mode)
// ⚠️ อย่าเพิ่งรันเขียนจริงกับคลังทั้งหมด — ให้เจ้าของ/ผู้คุมสั่งรอบจริงทีหลัง (สคริปต์นี้พิสูจน์ด้วย --dry-run เท่านั้น)
// ============================================================

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

export const MEASURED_FROM_MARK = 'backfill_probe';
const MAX_PROBE_BYTES = 20 * 1024 * 1024; // กันไฟล์ประหลาด (สอดคล้อง rehost route MAX_BYTES)

// ---- pure helpers (ทดสอบตรงได้ ไม่แตะ network/disk) -------------------------

// record มีขนาดจริงแล้วหรือยัง (realWidth/realHeight เป็นจำนวนบวก) — มีแล้ว = ห้ามทับ
export function hasRealDims(rec) {
  const w = Number(rec && rec.realWidth);
  const h = Number(rec && rec.realHeight);
  return Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0;
}

// จำแนก imageUrl: 'local' (ไฟล์ในดิสก์) | 'supabase' (ไฟล์ถาวรของเรา) | 'hotlink' (เว็บนอก—ข้าม) | 'none'
export function classifyImageUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return 'none';
  const u = url.trim();
  if (u.startsWith('/')) return 'local';
  if (/^https?:\/\//i.test(u)) return /(^|\/\/|\.)supabase\.co\//i.test(u) ? 'supabase' : 'hotlink';
  return 'none';
}

// อ่านขนาดจาก buffer ด้วย sharp metadata (อ่านหัวไฟล์อย่างเดียว — ไม่ decode/ไม่แก้พิกเซล)
//   คืน { realWidth, realHeight, realShortSide } เมื่อได้จำนวนเต็มบวกทั้งคู่ · อ่านไม่ได้ = null (อย่าเดา)
export async function probeBufferDims(buf) {
  if (!buf || !buf.length) return null;
  try {
    const m = await sharp(buf, { failOn: 'none' }).metadata();
    const w = m.width, h = m.height;
    if (Number.isInteger(w) && w > 0 && Number.isInteger(h) && h > 0) {
      return { realWidth: w, realHeight: h, realShortSide: Math.min(w, h) };
    }
  } catch { /* อ่าน metadata ไม่ได้ = ไม่รู้ขนาดจริง */ }
  return null;
}

// สร้าง patch เฉพาะ 4 ฟิลด์ที่อนุญาต — คืน null เมื่อ record มี dims แล้ว (ห้ามทับ) หรือ dims ไม่ถูกต้อง
export function buildBackfillPatch(rec, dims) {
  if (!rec || typeof rec !== 'object') return null;
  if (hasRealDims(rec)) return null; // มีขนาดจริงอยู่แล้ว (rehost/triage วัดไว้) — ห้ามเขียนทับ
  if (!dims) return null;
  const w = Number(dims.realWidth), h = Number(dims.realHeight);
  if (!Number.isInteger(w) || w <= 0 || !Number.isInteger(h) || h <= 0) return null;
  return { realWidth: w, realHeight: h, realShortSide: Math.min(w, h), measuredFrom: MEASURED_FROM_MARK };
}

function emptySummary() {
  return {
    scanned: 0, alreadyHadDims: 0, skippedHotlink: 0, skippedNoUrl: 0,
    probeAttempts: 0, probeFailed: 0, wouldWrite: 0, wrote: 0, hitLimit: false,
    byClass: { local: 0, supabase: 0, hotlink: 0, none: 0 },
  };
}

// ---- core engine (injectable — เทสส่ง loadBuffer/applyPatch จำลอง) -----------
//   records   : array ของ record รูป (มี id / imageUrl)
//   loadBuffer: async (rec, cls) => Buffer|null  (โหลด buffer จาก local/supabase — hotlink/none ไม่ถูกเรียก)
//   applyPatch: async (rec, patch) => void       (เขียน patch ลง store — dry-run จะไม่ถูกเรียก)
//   limit     : จำนวน "การ probe" (โหลด buffer) สูงสุดต่อรอบ (default 200)
//   dryRun    : true = ไม่เรียก applyPatch, นับ wouldWrite แทน
export async function backfillRecords({ records, loadBuffer, applyPatch, limit = 200, dryRun = false, onRow } = {}) {
  const summary = emptySummary();
  const rows = [];
  for (const rec of Array.isArray(records) ? records : []) {
    summary.scanned++;
    if (hasRealDims(rec)) { summary.alreadyHadDims++; continue; }
    const cls = classifyImageUrl(rec && rec.imageUrl);
    summary.byClass[cls] = (summary.byClass[cls] || 0) + 1;
    if (cls === 'hotlink') { summary.skippedHotlink++; continue; }
    if (cls === 'none') { summary.skippedNoUrl++; continue; }
    // local | supabase → ต้องโหลด buffer เพื่อ probe (นี่คือส่วนที่แพง → นับเข้า limit)
    if (summary.probeAttempts >= limit) { summary.hitLimit = true; break; }
    summary.probeAttempts++;
    let buf = null;
    try { buf = await loadBuffer(rec, cls); } catch { buf = null; }
    const dims = buf ? await probeBufferDims(buf) : null;
    const patch = buildBackfillPatch(rec, dims);
    if (!patch) { summary.probeFailed++; continue; }
    if (dryRun) {
      summary.wouldWrite++;
    } else {
      await applyPatch(rec, patch);
      summary.wrote++;
    }
    const row = { id: rec.id, cls, w: patch.realWidth, h: patch.realHeight, short: patch.realShortSide };
    rows.push(row);
    if (typeof onRow === 'function') onRow(row);
  }
  return { summary, rows };
}

// ---- real loaders / enumeration (CLI เท่านั้น) -------------------------------

// โหลด buffer พอ probe — local อ่านจากดิสก์ (public/), supabase fetch (จำกัดขนาด)
async function realLoadBuffer(rec, cls) {
  const url = (rec.imageUrl || '').trim();
  if (cls === 'local') {
    const fp = path.join(process.cwd(), 'public', url.replace(/^\//, ''));
    const buf = await fs.readFile(fp);
    if (buf.length > MAX_PROBE_BYTES) throw new Error('ไฟล์ใหญ่เกิน');
    return buf;
  }
  if (cls === 'supabase') {
    const r = await fetch(url, { signal: AbortSignal.timeout(25000), redirect: 'follow' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > MAX_PROBE_BYTES) throw new Error('ไฟล์ว่าง/ใหญ่เกิน');
    return buf;
  }
  return null;
}

// enumerate จาก fs fallback (data/case-images/*.json) — คืน [{ caseId, file, records }]
async function enumerateFsCases(onlyCase) {
  const dir = path.join(process.cwd(), 'data', 'case-images');
  let names = [];
  try { names = await fs.readdir(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const caseId = name.slice(0, -5);
    if (onlyCase && caseId !== onlyCase) continue;
    const file = path.join(dir, name);
    let records = [];
    try { records = JSON.parse(await fs.readFile(file, 'utf8')); } catch { records = []; }
    if (Array.isArray(records)) out.push({ caseId, file, records });
  }
  return out;
}

// เขียน patch ลงไฟล์ fs — merge เฉพาะ 4 ฟิลด์ ลง record ตาม id (ฟิลด์อื่นคงเดิมทุกไบต์)
function makeFsApplyPatch(file, records) {
  return async (rec, patch) => {
    const target = records.find((r) => r && r.id === rec.id);
    if (!target) return;
    Object.assign(target, patch);
    await fs.writeFile(file, JSON.stringify(records, null, 2), 'utf8');
  };
}

function parseArgs(argv) {
  const a = { dryRun: false, limit: 200, onlyCase: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--dry-run') a.dryRun = true;
    else if (t === '--limit') a.limit = Math.max(1, parseInt(argv[++i], 10) || 200);
    else if (t.startsWith('--limit=')) a.limit = Math.max(1, parseInt(t.slice(8), 10) || 200);
    else if (t === '--case') a.onlyCase = argv[++i] || null;
    else if (t.startsWith('--case=')) a.onlyCase = t.slice(7) || null;
  }
  return a;
}

function printTable(perCase, total) {
  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  console.log('\n' + pad('case', 16) + padL('scan', 6) + padL('had', 5) + padL('probe', 7) + padL('write', 7) + padL('hotlink', 9) + padL('fail', 6));
  console.log('-'.repeat(56));
  for (const c of perCase) {
    const s = c.summary;
    console.log(pad(c.caseId, 16) + padL(s.scanned, 6) + padL(s.alreadyHadDims, 5) + padL(s.probeAttempts, 7) + padL(s.wrote + s.wouldWrite, 7) + padL(s.skippedHotlink, 9) + padL(s.probeFailed, 6));
  }
  console.log('-'.repeat(56));
  console.log(pad('TOTAL', 16) + padL(total.scanned, 6) + padL(total.alreadyHadDims, 5) + padL(total.probeAttempts, 7) + padL(total.wrote + total.wouldWrite, 7) + padL(total.skippedHotlink, 9) + padL(total.probeFailed, 6));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[backfill-image-dims] dryRun=${args.dryRun} limit=${args.limit}` + (args.onlyCase ? ` case=${args.onlyCase}` : ''));

  // เวอร์ชันนี้ enumerate จาก fs fallback (data/case-images) เท่านั้น — คลังจริงบน Supabase ให้ผู้คุมรันรอบจริงด้วย
  //   worker ที่มี env (สคริปต์นี้จงใจไม่แตะ Supabase เพื่อความปลอดภัยของรอบพิสูจน์ + กันเขียนคลังจริงโดยไม่ตั้งใจ)
  const cases = await enumerateFsCases(args.onlyCase);
  if (!cases.length) {
    console.log('ไม่พบไฟล์คลังรูปใน data/case-images/ (fs fallback ว่าง) — คลังจริงอยู่บน Supabase; รอบจริงให้รันบน worker ที่มี env');
    return;
  }

  let remaining = args.limit; // limit รวมทั้งรอบ (กระจายข้ามเคส)
  const perCase = [];
  const total = emptySummary();
  for (const c of cases) {
    if (remaining <= 0) break;
    const { summary, rows } = await backfillRecords({
      records: c.records,
      loadBuffer: realLoadBuffer,
      applyPatch: args.dryRun ? undefined : makeFsApplyPatch(c.file, c.records),
      limit: remaining,
      dryRun: args.dryRun,
    });
    remaining -= summary.probeAttempts;
    perCase.push({ caseId: c.caseId, summary, rows });
    for (const k of ['scanned', 'alreadyHadDims', 'skippedHotlink', 'skippedNoUrl', 'probeAttempts', 'probeFailed', 'wouldWrite', 'wrote']) total[k] += summary[k];
  }
  printTable(perCase, total);
  console.log(`\n${args.dryRun ? 'DRY-RUN — ไม่มีการเขียน' : 'เขียนจริงแล้ว'}: ${total.wrote + total.wouldWrite} ใบ | ข้าม hotlink ${total.skippedHotlink} | probe ล้ม ${total.probeFailed}`);
}

// รันเป็น CLI เท่านั้น (import จากเทสจะไม่รัน main) — เทียบ path แบบทนพาธมี unicode/percent-encode (Windows)
let _isMain = false;
try {
  _isMain = !!process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
} catch { _isMain = false; }
if (_isMain) {
  main().catch((e) => { console.error('[backfill-image-dims] ล้ม:', e && e.message); process.exitCode = 1; });
}
