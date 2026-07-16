#!/usr/bin/env node
// ============================================================
// 🩹 rehab-ref-library.mjs (R5a) — กู้พิกัดเทมเพลตทั้งคลัง ref ให้ตรงตะเข็บจริง แล้วเกรดใหม่
// ------------------------------------------------------------
// ยืนบน R1 (measureTemplateFidelity) + R2 (syncDnaSlotsToTemplate) + R3 (computeTemplateGrade)
// ทำเฉพาะใบเกรด C/F ที่ไม่ใช่ duplicate:
//   วัด (R1) → กู้ (rehabilitateTemplate) → วัดซ้ำ → ถ้า score ใหม่ > เดิมจริง:
//     เขียน template.slots ใหม่ + dna._fidelity ใหม่ + dna._templateGrade ใหม่ (computeTemplateGrade)
//     + dna._rehabbed (rehabFlag) + sync dna.slots (syncDnaSlotsToTemplate) กัน dangling กลับมา
//   ถ้าไม่ดีขึ้น → ไม่แตะใบนั้น (รายงานเหตุ)
// backup ก่อนเขียนจริง → backup/ref-library_YYYY-MM-DD-r5a/ref-cover-library.json
//
// ใช้:  node scripts/rehab-ref-library.mjs [--dry-run]
//   --dry-run = คำนวณ + พิมพ์ตารางก่อน/หลัง แต่ไม่ backup/ไม่เขียนไฟล์
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dnaToTemplateSpec } from '../src/lib/refTemplate.js';
import { measureTemplateFidelity, FIDELITY_ENGINE_VERSION } from '../src/lib/refTemplateFidelity.js';
import { rehabilitateTemplate } from '../src/lib/refTemplateRehab.js';
import { computeTemplateGrade } from '../src/lib/refCoverGrade.js';
import { syncDnaSlotsToTemplate } from '../src/lib/refCoverLibrary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LIB_PATH = path.join(ROOT, 'data', 'ref-cover-library.json');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DRY = process.argv.includes('--dry-run');

function todayStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); }

// วัด fidelity ของ record 1 ใบ (คืน { fidelity(สรุป), detail(เต็ม+boundaries), spec } | { note })
async function measure(rec, measuredAt) {
  const imgRel = rec.imagePath || '';
  const imgPath = path.join(PUBLIC_DIR, imgRel.replace(/^\//, ''));
  const spec = dnaToTemplateSpec(rec.dna);
  if (!spec) return { note: 'template_unavailable' };
  if (!fs.existsSync(imgPath)) return { note: 'image_missing' };
  const buf = fs.readFileSync(imgPath);
  const r = await measureTemplateFidelity({ imageBuffer: buf, templateSpec: spec });
  const fidelity = {
    score: r.score, rawScore: r.rawScore, featherPx: r.featherPx,
    worstOffsetPx: r.worstOffsetPx, meanOffsetPx: r.meanOffsetPx,
    confidence: r.confidence, confidentBoundaries: r.confidentBoundaries,
    lowConfidenceBoundaries: r.lowConfidenceBoundaries,
    measuredAt, engineVersion: r.engineVersion,
  };
  return { fidelity, detail: r, spec };
}

const dupOf = (rec) => rec?._duplicateOf ?? rec?.dna?._duplicateOf ?? null;

async function main() {
  const raw = fs.readFileSync(LIB_PATH, 'utf8');
  const lib = JSON.parse(raw);
  if (!Array.isArray(lib)) throw new Error('ref-cover-library.json ต้องเป็น array');

  console.log(`\n🩹 Ref Template Rehab (R5a) — fidelity ${FIDELITY_ENGINE_VERSION}  (${DRY ? 'DRY-RUN' : 'WRITE'})`);
  console.log(`   คลัง: ${lib.length} ใบ\n`);

  const measuredAt = new Date().toISOString();
  const nowIso = measuredAt;
  const rows = [];              // ตารางกู้ต่อใบ (เฉพาะที่พยายามกู้)
  const gradeBefore = { A: 0, B: 0, C: 0, F: 0 };

  // เกรดเดิมทั้งคลัง (recompute เพื่อเทียบ ก่อนแตะ)
  for (const rec of lib) gradeBefore[computeTemplateGrade(rec).grade]++;

  let rehabbed = 0, notImproved = 0, aborted = 0, skipped = 0;

  for (const rec of lib) {
    const id = rec.id || '(no-id)';
    const beforeGrade = computeTemplateGrade(rec).grade;

    // เลือกเฉพาะ C/F ที่ไม่ใช่ duplicate
    if (dupOf(rec)) { skipped++; continue; }
    if (beforeGrade === 'A' || beforeGrade === 'B') { skipped++; continue; }

    const m0 = await measure(rec, measuredAt);
    if (m0.note) {
      rows.push({ id, before: beforeGrade, s0: '-', s1: '-', after: beforeGrade, moved: '-', status: m0.note });
      skipped++;
      continue;
    }
    const score0 = m0.fidelity.score;

    // กู้ (PURE) — ไม่ mutate rec
    const reh = rehabilitateTemplate({ record: rec, fidelityDetail: m0.detail, now: nowIso });
    if (reh.aborted) {
      rows.push({ id, before: beforeGrade, s0: score0, s1: '-', after: beforeGrade, moved: 0, status: `abort:${reh.reason}` });
      aborted++;
      continue;
    }
    if (!reh.changed) {
      rows.push({ id, before: beforeGrade, s0: score0, s1: score0, after: beforeGrade, moved: 0, status: reh.reason });
      notImproved++;
      continue;
    }

    // สร้าง record จำลอง (dna ใหม่ template.slots ที่กู้) → วัดซ้ำ
    const trial = { ...rec, dna: { ...rec.dna, template: { ...rec.dna.template, slots: reh.slots } } };
    const m1 = await measure(trial, measuredAt);
    if (m1.note) {
      rows.push({ id, before: beforeGrade, s0: score0, s1: '-', after: beforeGrade, moved: reh.movedBoundaries, status: `re-measure:${m1.note}` });
      notImproved++;
      continue;
    }
    const score1 = m1.fidelity.score;

    // เขียนเฉพาะเมื่อ score ใหม่ > เดิมจริง (ตัวเลข — ไม่นับ null)
    const improved = Number.isFinite(score1) && Number.isFinite(score0) && score1 > score0;
    if (!improved) {
      rows.push({ id, before: beforeGrade, s0: score0, s1: score1, after: beforeGrade, moved: reh.movedBoundaries, status: 'not-improved' });
      notImproved++;
      continue;
    }

    // ── ยืนยันแล้ว: เขียนกลับ (นอก dry-run) ──
    const newSlots = reh.slots;
    // sync dna.slots ↔ template.slots ใหม่ กัน dangling/unmatched กลับมา (R2)
    const newDnaSlots = syncDnaSlotsToTemplate(rec.dna.slots, newSlots);
    if (!DRY) {
      rec.dna.template.slots = newSlots;
      rec.dna.slots = newDnaSlots;
      rec.dna._fidelity = m1.fidelity;
      rec.dna._rehabbed = reh.rehabFlag;
      rec.dna._templateGrade = computeTemplateGrade(rec); // เกรดใหม่จาก _fidelity ใหม่
    }
    const afterGrade = computeTemplateGrade(DRY
      ? { ...rec, dna: { ...rec.dna, _fidelity: m1.fidelity, template: { ...rec.dna.template, slots: newSlots } } }
      : rec).grade;
    rows.push({ id, before: beforeGrade, s0: score0, s1: score1, after: afterGrade, moved: reh.movedBoundaries, status: 'REHABBED' });
    rehabbed++;
  }

  // ── ตารางกู้ต่อใบ ──
  console.log(pad('id', 24) + pad('gradeBefore', 12) + pad('score0', 8) + pad('score1', 8) + pad('gradeAfter', 12) + pad('moved', 7) + 'status');
  console.log('-'.repeat(96));
  for (const r of rows) {
    console.log(pad(r.id, 24) + pad(r.before, 12) + pad(r.s0, 8) + pad(r.s1, 8) + pad(r.after, 12) + pad(r.moved, 7) + r.status);
  }

  // ── เกรดใหม่ทั้งคลัง (recompute หลังแก้) ──
  const gradeAfter = { A: 0, B: 0, C: 0, F: 0 };
  for (const rec of lib) {
    // ใน dry-run rec ยังไม่ถูกเขียน → ใช้ afterGrade ที่คำนวณแล้วในตาราง (map by id)
    const row = rows.find((x) => x.id === (rec.id || '(no-id)'));
    const g = (DRY && row && row.status === 'REHABBED') ? row.after : computeTemplateGrade(rec).grade;
    gradeAfter[g]++;
  }

  const passBefore = gradeBefore.A + gradeBefore.B;
  const passAfter = gradeAfter.A + gradeAfter.B;

  console.log('\n' + '='.repeat(60));
  console.log(`สรุป: กู้สำเร็จ ${rehabbed} ใบ · ไม่ดีขึ้น ${notImproved} · ยกเลิก(fail-closed) ${aborted} · ข้าม(A/B/dup/ภาพหาย) ${skipped}`);
  console.log(`เกรดก่อน:  A:${gradeBefore.A}  B:${gradeBefore.B}  C:${gradeBefore.C}  F:${gradeBefore.F}   → ผ่านประตู(A/B) ${passBefore} ใบ`);
  console.log(`เกรดหลัง:  A:${gradeAfter.A}  B:${gradeAfter.B}  C:${gradeAfter.C}  F:${gradeAfter.F}   → ผ่านประตู(A/B) ${passAfter} ใบ`);
  console.log('='.repeat(60));

  if (DRY) {
    console.log('\n(--dry-run: ไม่ได้ backup / ไม่ได้เขียนไฟล์)\n');
    return;
  }

  // ── backup ก่อนเขียน (คงต้นฉบับเดิมถ้ามีแล้ว) ──
  const backupDir = path.join(ROOT, 'backup', `ref-library_${todayStamp()}-r5a`);
  const backupFile = path.join(backupDir, 'ref-cover-library.json');
  fs.mkdirSync(backupDir, { recursive: true });
  if (fs.existsSync(backupFile)) {
    console.log(`\n💾 backup มีอยู่แล้ว (คงต้นฉบับเดิม ไม่ทับ) → ${path.relative(ROOT, backupFile)}`);
  } else {
    fs.writeFileSync(backupFile, raw, 'utf8');
    console.log(`\n💾 backup → ${path.relative(ROOT, backupFile)}`);
  }

  fs.writeFileSync(LIB_PATH, JSON.stringify(lib, null, 2) + '\n', 'utf8');
  console.log(`✍️  เขียนคลังกลับ ${path.relative(ROOT, LIB_PATH)} แล้ว (กู้ ${rehabbed} ใบ)\n`);
}

main().catch((e) => { console.error('❌ rehab-ref-library ล้มเหลว:', e); process.exit(1); });
