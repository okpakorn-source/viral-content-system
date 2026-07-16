#!/usr/bin/env node
// ============================================================
// 🧬 derive-ref-variants.mjs (R5b) — กลั่น "โครงลูก" จากใบแม่ ref เกรด A/B แล้ว append เข้าคลัง
// ------------------------------------------------------------
// ยืนบน R5a (พิกัดตรงตะเข็บจริงแล้ว) + refTemplateVariants (กลั่น PURE) + refCoverGrade (เส้น derived).
// ทำ:
//   1) เลือกใบแม่ = record เกรด A/B ที่ไม่ใช่ duplicate และ "ไม่ใช่ variant" (ไม่มี _derived) — กลั่นจากต้นแบบจริง
//   2) เรียงแม่ตาม _fidelity.score มาก→น้อย (tiebreak id) → กลั่น variant ทุกวิธี
//   3) เพดานรวม ≤12 variants (ตัดตามลำดับแม่คะแนนสูงก่อน)
//   4) idempotent: variant id ที่มีในคลังแล้ว → ข้าม (ไม่เขียนซ้ำ)
//   5) เขียนแบบ "append เท่านั้น" — ไม่แตะ record เดิมแม้ byte เดียว. ตั้ง dna._templateGrade ของ variant
//      (computeTemplateGrade เส้น derived) เพื่อให้ stored == recompute (เทส grade ยืน)
//   6) backup ก่อนเขียนจริง → backup/ref-library_YYYY-MM-DD-r5b/ref-cover-library.json
//
// ใช้:  node scripts/derive-ref-variants.mjs [--dry-run]
//   --dry-run = คำนวณ + พิมพ์ตาราง แต่ไม่ backup/ไม่เขียนไฟล์
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeTemplateGrade, refPoolGateOpen } from '../src/lib/refCoverGrade.js';
import { deriveTemplateVariants, VARIANTS_ENGINE_VERSION } from '../src/lib/refTemplateVariants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LIB_PATH = path.join(ROOT, 'data', 'ref-cover-library.json');
const DRY = process.argv.includes('--dry-run');
const MAX_VARIANTS = 12;

function todayStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); }
const scoreOf = (rec) => { const s = Number(rec?.dna?._fidelity?.score); return Number.isFinite(s) ? s : -1; };

function main() {
  const raw = fs.readFileSync(LIB_PATH, 'utf8');
  const lib = JSON.parse(raw);
  if (!Array.isArray(lib)) throw new Error('ref-cover-library.json ต้องเป็น array');

  console.log(`\n🧬 Ref Template Variants (R5b) — engine ${VARIANTS_ENGINE_VERSION}  (${DRY ? 'DRY-RUN' : 'WRITE'})`);
  console.log(`   คลังก่อนกลั่น: ${lib.length} ใบ\n`);

  const existingIds = new Set(lib.map((r) => r.id));
  const now = new Date().toISOString();
  // เพดาน "รวม" — นับ variant (derived) ที่มีในคลังอยู่แล้วด้วย → รันซ้ำไม่โตเกิน 12 (idempotent แท้)
  const existingDerived = lib.filter((r) => r?.dna?._derived).length;
  const budget = Math.max(0, MAX_VARIANTS - existingDerived);

  // ใบแม่: เกรด A/B · ไม่ใช่ duplicate · ไม่ใช่ variant (ไม่มี _derived) — เรียงคะแนนมาก→น้อย
  const mothers = lib
    .filter((r) => !r?.dna?._derived && !(r?._duplicateOf ?? r?.dna?._duplicateOf))
    .filter((r) => { const g = computeTemplateGrade(r).grade; return g === 'A' || g === 'B'; })
    .sort((a, b) => (scoreOf(b) - scoreOf(a)) || String(a.id).localeCompare(String(b.id)));

  const rows = [];
  const toAppend = [];
  for (const mom of mothers) {
    if (toAppend.length >= budget) break;
    const momGrade = computeTemplateGrade(mom).grade;
    const vs = deriveTemplateVariants(mom, { now });
    for (const v of vs) {
      if (toAppend.length >= budget) break;
      const exists = existingIds.has(v.id);
      const vGrade = computeTemplateGrade(v).grade;
      if (!exists) {
        v.dna._templateGrade = computeTemplateGrade(v); // stored == recompute
        toAppend.push(v);
        existingIds.add(v.id);
      }
      rows.push({
        id: v.id, method: v.dna._derived.method, mother: mom.id,
        mGrade: momGrade, vGrade, status: exists ? 'skip (มีแล้ว)' : 'NEW',
      });
    }
  }

  // ── ตาราง variant ──
  console.log(pad('variant id', 34) + pad('method', 13) + pad('mother', 22) + pad('แม่', 5) + pad('เกรด', 6) + 'status');
  console.log('-'.repeat(96));
  for (const r of rows) {
    console.log(pad(r.id, 34) + pad(r.method, 13) + pad(r.mother, 22) + pad(r.mGrade, 5) + pad(r.vGrade, 6) + r.status);
  }
  if (!rows.length) console.log('(ไม่มี variant ที่กลั่นได้ — ทุกวิธีถูกทิ้ง/ซ้ำ)');

  // ── คลังใหม่ (จำลอง append เพื่อรายงาน) ──
  const projected = lib.concat(toAppend);
  const dist = { A: 0, B: 0, C: 0, F: 0 };
  let derivedCount = 0;
  for (const r of projected) {
    dist[computeTemplateGrade(r).grade]++;
    if (r?.dna?._derived) derivedCount++;
  }
  const gateOn = { REF_TEMPLATE_GRADE_GATE: '1' };
  const passGate = projected.filter((r) => refPoolGateOpen(r, gateOn)).length;

  console.log('\n' + '='.repeat(60));
  console.log(`variant ใหม่ที่ append: ${toAppend.length} ใบ (เพดาน ${MAX_VARIANTS}) · derived ในคลังรวม ${derivedCount} ใบ`);
  console.log(`คลังใหม่รวม: ${projected.length} ใบ`);
  console.log(`เกรดคลังใหม่:  A:${dist.A}  B:${dist.B}  C:${dist.C}  F:${dist.F}`);
  console.log(`ผ่านประตูพูล (gate ON, A/B ไม่ซ้ำ): ${passGate} ใบ`);
  console.log('='.repeat(60));

  if (DRY) { console.log('\n(--dry-run: ไม่ได้ backup / ไม่ได้เขียนไฟล์)\n'); return; }
  if (!toAppend.length) { console.log('\n(ไม่มี variant ใหม่ — ไม่เขียนไฟล์)\n'); return; }

  // ── backup ก่อนเขียน (คงต้นฉบับเดิมถ้ามีแล้ว) ──
  const backupDir = path.join(ROOT, 'backup', `ref-library_${todayStamp()}-r5b`);
  const backupFile = path.join(backupDir, 'ref-cover-library.json');
  fs.mkdirSync(backupDir, { recursive: true });
  if (fs.existsSync(backupFile)) {
    console.log(`\n💾 backup มีอยู่แล้ว (คงต้นฉบับเดิม ไม่ทับ) → ${path.relative(ROOT, backupFile)}`);
  } else {
    fs.writeFileSync(backupFile, raw, 'utf8');
    console.log(`\n💾 backup → ${path.relative(ROOT, backupFile)}`);
  }

  // append เท่านั้น: lib เดิมไม่ถูกแตะ (spread ใหม่)
  fs.writeFileSync(LIB_PATH, JSON.stringify(lib.concat(toAppend), null, 2), 'utf8');
  console.log(`✍️  append ${toAppend.length} variant เข้า ${path.relative(ROOT, LIB_PATH)} แล้ว\n`);
}

main();
