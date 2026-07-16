// ============================================================
// 🏷️ grade-ref-library.mjs — คำนวณ dna._templateGrade ให้ทุกใบในคลัง ref cover (R3)
// ------------------------------------------------------------
// ใช้ computeTemplateGrade (PURE, deterministic) จาก src/lib/refCoverGrade.js
//   เขียน "เฉพาะ key dna._templateGrade" ต่อใบ — ไม่แตะ field อื่นเลย
// idempotent: รันซ้ำได้ผลเท่าเดิม (record เดิม → เกรดเดิม → เขียนค่าเดิมทับ)
//
// การใช้งาน:
//   node scripts/grade-ref-library.mjs --dry-run   # แสดงตารางเกรด ไม่เขียนไฟล์
//   node scripts/grade-ref-library.mjs             # backup → เขียน dna._templateGrade กลับคลัง
// ============================================================

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeTemplateGrade, GRADE_ENGINE_VERSION } from '../src/lib/refCoverGrade.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'data', 'ref-cover-library.json');

const DRY = process.argv.includes('--dry-run');

function todayStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function main() {
  const raw = await fs.readFile(FILE, 'utf8');
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) throw new Error('รูปแบบคลังไม่ใช่ array — ยกเลิก');

  // ── backup ก่อนเขียนจริง (dry-run ไม่ backup) ──
  //   ★ ไม่ทับไฟล์ backup เดิมถ้ามีแล้ว — รันซ้ำวันเดียวกันต้องคงสแนปช็อต "ก่อนแก้ครั้งแรก" ไว้
  //     (ถ้าทับ = สแนปช็อตกลายเป็นเวอร์ชันที่ติดเกรดแล้ว กู้กลับต้นฉบับไม่ได้)
  if (!DRY) {
    const backupDir = path.join(ROOT, 'backup', `ref-library_${todayStamp()}-r3`);
    const backupFile = path.join(backupDir, 'ref-cover-library.json');
    await fs.mkdir(backupDir, { recursive: true });
    const exists = await fs.access(backupFile).then(() => true).catch(() => false);
    if (exists) {
      console.log(`💾 backup มีอยู่แล้ว (คงต้นฉบับเดิม ไม่ทับ) → ${path.relative(ROOT, backupFile)}`);
    } else {
      await fs.writeFile(backupFile, raw, 'utf8');
      console.log(`💾 backup → ${path.relative(ROOT, backupFile)}`);
    }
  }

  const tally = { A: 0, B: 0, C: 0, F: 0 };
  const rows = [];
  for (const rec of arr) {
    const g = computeTemplateGrade(rec);
    tally[g.grade] = (tally[g.grade] || 0) + 1;
    rows.push({
      id: rec.id || '(no-id)',
      grade: g.grade,
      score: rec?.dna?._fidelity?.score ?? '-',
      repro: rec?.dna?._reproducible,
      worst: rec?.dna?._fidelity?.worstOffsetPx ?? '-',
      reason: g.reasons[0] || '',
    });
    // ── เขียนเฉพาะ key dna._templateGrade (ไม่แตะ field อื่น) ──
    if (!DRY) {
      if (!rec.dna || typeof rec.dna !== 'object') {
        // ไม่มี dna → เกรดยังเก็บที่ระดับ record ไม่ได้ (spec เก็บใน dna) → ข้ามเขียน แต่ยังนับในสรุป
        continue;
      }
      rec.dna._templateGrade = g;
    }
  }

  // ── ตารางแจกแจงรายใบ ──
  console.log('');
  console.log('ID                       | GRADE | score | repro | worstOff | เหตุผลหลัก');
  console.log('-------------------------|-------|-------|-------|----------|-----------------------------');
  for (const r of rows) {
    console.log(
      `${String(r.id).padEnd(24)} |   ${r.grade}   | ${String(r.score).padStart(5)} | ${String(r.repro).padStart(5)} | ${String(r.worst).padStart(8)} | ${r.reason}`
    );
  }

  console.log('');
  console.log(`เครื่องคิดเกรด: ${GRADE_ENGINE_VERSION}`);
  console.log(`สรุป ${arr.length} ใบ → A:${tally.A}  B:${tally.B}  C:${tally.C}  F:${tally.F}`);
  console.log(`ผ่านประตู (A/B, ไม่นับใบซ้ำ): ${tally.A + tally.B} ใบ`);

  if (DRY) {
    console.log('\n(--dry-run: ไม่เขียนไฟล์)');
    return;
  }

  await fs.writeFile(FILE, JSON.stringify(arr, null, 2), 'utf8');
  console.log(`\n✅ เขียน dna._templateGrade กลับ ${path.relative(ROOT, FILE)} แล้ว (${arr.length} ใบ)`);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
