#!/usr/bin/env node
// ============================================================
// measure-ref-fidelity.mjs — รันเครื่องวัด fidelity ทั้งคลัง ref-cover-library
// ------------------------------------------------------------
// สำหรับ DNA แต่ละใบ: dnaToTemplateSpec(dna) → measureTemplateFidelity(ภาพจริง, spec)
//   → เขียนผลลง dna._fidelity = { score, worstOffsetPx, meanOffsetPx, confidence,
//                                 confidentBoundaries, lowConfidenceBoundaries, measuredAt, engineVersion }
//   (แก้เฉพาะคีย์ _fidelity — ไม่แตะ field อื่นในใบ)
// ก่อนเขียน: backup ไฟล์เดิม → backup/ref-library_YYYY-MM-DD/ref-cover-library.json
// พิมพ์ตารางสรุป (id · score · worst · mean · conf)
//
// ใช้:  node scripts/measure-ref-fidelity.mjs [--dry-run]
//   --dry-run = คำนวณ+พิมพ์ตาราง แต่ไม่ backup และไม่เขียนไฟล์
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dnaToTemplateSpec } from '../src/lib/refTemplate.js';
import { measureTemplateFidelity, FIDELITY_ENGINE_VERSION } from '../src/lib/refTemplateFidelity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LIB_PATH = path.join(ROOT, 'data', 'ref-cover-library.json');
const PUBLIC_DIR = path.join(ROOT, 'public');

const DRY_RUN = process.argv.includes('--dry-run');

function todayStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

async function main() {
  const raw = fs.readFileSync(LIB_PATH, 'utf8');
  const lib = JSON.parse(raw);
  if (!Array.isArray(lib)) throw new Error('ref-cover-library.json ต้องเป็น array');

  console.log(`\n📏 Ref Template Fidelity — engine ${FIDELITY_ENGINE_VERSION}  (${DRY_RUN ? 'DRY-RUN' : 'WRITE'})`);
  console.log(`   คลัง: ${lib.length} ใบ\n`);

  const rows = [];
  const measuredAt = new Date().toISOString();

  for (const entry of lib) {
    const id = entry.id || '(no-id)';
    const imgRel = entry.imagePath || '';
    const imgPath = path.join(PUBLIC_DIR, imgRel.replace(/^\//, ''));
    let fidelity = null;
    let note = null;

    try {
      const spec = dnaToTemplateSpec(entry.dna);
      if (!spec) {
        note = 'template_unavailable'; // DNA โครงไม่พอ (dnaToTemplateSpec คืน null)
      } else if (!fs.existsSync(imgPath)) {
        note = 'image_missing';
      } else {
        const buf = fs.readFileSync(imgPath);
        const r = await measureTemplateFidelity({ imageBuffer: buf, templateSpec: spec });
        fidelity = {
          score: r.score,
          rawScore: r.rawScore,        // คะแนนจาก offset ดิบ (ไม่หัก featherTol) — 100 ที่ score ≠ rawScore = ไม่เป๊ะพิกเซล
          featherPx: r.featherPx,       // ความกว้าง feather ที่ใช้หักผ่อน (px)
          worstOffsetPx: r.worstOffsetPx,
          meanOffsetPx: r.meanOffsetPx,
          confidence: r.confidence,
          confidentBoundaries: r.confidentBoundaries,
          lowConfidenceBoundaries: r.lowConfidenceBoundaries,
          measuredAt,
          engineVersion: r.engineVersion,
        };
      }
    } catch (e) {
      note = `error:${e.message}`;
    }

    if (fidelity) {
      // แก้เฉพาะคีย์ _fidelity — field อื่นในใบไม่แตะ
      if (entry.dna && typeof entry.dna === 'object') entry.dna._fidelity = fidelity;
      rows.push({ id, score: fidelity.score, raw: fidelity.rawScore, worst: fidelity.worstOffsetPx, mean: fidelity.meanOffsetPx, conf: fidelity.confidence, cb: fidelity.confidentBoundaries, lb: fidelity.lowConfidenceBoundaries });
    } else {
      rows.push({ id, score: '-', raw: '-', worst: '-', mean: '-', conf: note || 'skip', cb: '-', lb: '-' });
    }
  }

  // ---- ตารางสรุป ----
  console.log(pad('#', 3) + pad('id', 22) + pad('score', 7) + pad('raw', 6) + pad('worst', 8) + pad('mean', 8) + pad('conf', 8) + 'bounds(ok/low)');
  console.log('-'.repeat(78));
  rows.forEach((r, i) => {
    console.log(
      pad(i + 1, 3) + pad(r.id, 22) + pad(r.score, 7) + pad(r.raw, 6) + pad(r.worst, 8) + pad(r.mean, 8) + pad(r.conf, 8) + `${r.cb}/${r.lb}`
    );
  });

  const scored = rows.filter((r) => typeof r.score === 'number');
  if (scored.length) {
    const avg = scored.reduce((s, r) => s + r.score, 0) / scored.length;
    const worstAll = Math.max(...scored.map((r) => Number(r.worst) || 0));
    console.log('-'.repeat(72));
    console.log(`สรุป: วัดได้ ${scored.length}/${rows.length} ใบ · score เฉลี่ย ${avg.toFixed(1)} · worst offset สูงสุด ${worstAll}px`);
  }

  if (DRY_RUN) {
    console.log('\n(DRY-RUN: ไม่ได้ backup / ไม่ได้เขียนไฟล์)\n');
    return;
  }

  // ---- backup ก่อนเขียน ----
  const backupDir = path.join(ROOT, 'backup', `ref-library_${todayStamp()}`);
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(backupDir, 'ref-cover-library.json'), raw, 'utf8');
  console.log(`\n💾 backup → ${path.relative(ROOT, path.join(backupDir, 'ref-cover-library.json'))}`);

  // ---- เขียนกลับ (2-space indent + newline ท้ายไฟล์ เหมือนเดิม) ----
  fs.writeFileSync(LIB_PATH, JSON.stringify(lib, null, 2) + '\n', 'utf8');
  console.log(`✍️  เขียน dna._fidelity ลง ${path.relative(ROOT, LIB_PATH)} แล้ว (${scored.length} ใบ)\n`);
}

main().catch((e) => { console.error('measure-ref-fidelity ล้มเหลว:', e); process.exit(1); });
