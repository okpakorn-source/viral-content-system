#!/usr/bin/env node
// ============================================================
// 🩺 repair-ref-library.mjs — R2 migration (16 ก.ค. 69)
// ------------------------------------------------------------
// ซ่อมคลัง data/ref-cover-library.json สองอาการจากนิติเวช:
//   (ก) dna.slots (semantic) ไม่ align กับ dna.template.slots (geometry) — dangling / unmatched
//       ต้นตอ: PATCH แก้เทมเพลตมือแล้วไม่ sync dna.slots (แก้ที่ต้นทางแล้วใน route.js/refCoverLibrary.js)
//       ตรรกะ sync = syncDnaSlotsToTemplate เดียวกับ PATCH (ผู้ตัดสิน align = resolveRefSlotView template_v1)
//   (ข) ภาพซ้ำ byte-identical → ใบที่อัปทีหลังติดธง _duplicateOf: '<id ต้นฉบับ>' (soft-flag เท่านั้น —
//       ไม่ลบ record · การกันออกจาก pool เป็นหน้าที่ประตู R3)
//
// SAFETY:
//   · backup คลังเดิม → backup/ref-library_YYYY-MM-DD-r2/ ก่อนเขียนจริงเสมอ
//   · แก้เฉพาะ dna.slots + _duplicateOf เท่านั้น — field อื่น (รวม _fidelity ของ R1) byte-unchanged
//   · idempotent: รันซ้ำไม่เปลี่ยนอะไร
//
// USAGE:
//   node scripts/repair-ref-library.mjs --dry-run   # รายงานอย่างเดียว ไม่เขียน
//   node scripts/repair-ref-library.mjs             # backup + เขียนจริง
// ============================================================

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { syncDnaSlotsToTemplate } from '../src/lib/refCoverLibrary.js';
import { resolveRefSlotView } from '../src/lib/refSlotContract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'data', 'ref-cover-library.json');

const DRY = process.argv.includes('--dry-run');

function jeq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * คำนวณแผนซ่อมทั้งคลัง (pure — ไม่แตะไฟล์/ไม่ mutate input).
 * คืน { records: ผลลัพธ์ต่อใบ [{id, before, after, slotsChanged, duplicateOf}], dupGroups }.
 * @param {Array} records คลังดิบ
 * @param {Map<string,string>} imageHashById sha256(ไฟล์ภาพ) ต่อ id (สำหรับหา duplicate)
 */
export function planRepair(records, imageHashById = new Map()) {
  const arr = Array.isArray(records) ? records : [];

  // ── (ข) หา duplicate group จาก hash ภาพ → ใบที่ "อัปทีหลัง" ชี้ไปใบแรกสุด ──
  const byHash = new Map();
  for (const rec of arr) {
    const h = imageHashById.get(rec.id);
    if (!h) continue;
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push(rec);
  }
  const duplicateOf = new Map(); // id → originalId
  const dupGroups = [];
  for (const [h, group] of byHash) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => String(a.uploadedAt || '').localeCompare(String(b.uploadedAt || '')));
    const original = sorted[0];
    dupGroups.push({ hash: h, originalId: original.id, dups: sorted.slice(1).map((r) => r.id) });
    for (const dup of sorted.slice(1)) duplicateOf.set(dup.id, original.id);
  }

  const results = [];
  for (const rec of arr) {
    const tplSlots = rec?.dna?.template?.slots;
    const dnaSlots = rec?.dna?.slots;
    const hasTemplate = Array.isArray(tplSlots) && tplSlots.length > 0;

    // (ก) sync dna.slots — เฉพาะใบที่มี template axis
    let synced = Array.isArray(dnaSlots) ? dnaSlots : (dnaSlots === undefined ? undefined : dnaSlots);
    let slotsChanged = false;
    if (hasTemplate) {
      synced = syncDnaSlotsToTemplate(dnaSlots, tplSlots);
      slotsChanged = !jeq(dnaSlots ?? null, synced ?? null);
    }

    // (ข) duplicate flag
    const wantDupOf = duplicateOf.get(rec.id) || null;
    const curDupOf = rec._duplicateOf || null;
    const dupChanged = wantDupOf !== curDupOf;

    results.push({
      id: rec.id,
      hasTemplate,
      before: { dnaRoles: (dnaSlots || []).map((s) => s?.role), duplicateOf: curDupOf },
      after: { dnaRoles: (synced || []).map((s) => s?.role), duplicateOf: wantDupOf },
      syncedSlots: synced,
      slotsChanged,
      duplicateOf: wantDupOf,
      dupChanged,
      changed: slotsChanged || dupChanged,
    });
  }
  return { results, dupGroups };
}

/** ใช้แผนซ่อมกับ record (mutate เฉพาะ dna.slots + _duplicateOf) */
export function applyRepairPlan(records, plan) {
  const byId = new Map(records.map((r) => [r.id, r]));
  for (const res of plan.results) {
    const rec = byId.get(res.id);
    if (!rec) continue;
    if (res.slotsChanged && rec.dna) rec.dna.slots = res.syncedSlots;
    if (res.dupChanged) {
      if (res.duplicateOf) rec._duplicateOf = res.duplicateOf;
      else delete rec._duplicateOf;
    }
  }
  return records;
}

async function hashImages(records) {
  const map = new Map();
  for (const rec of records) {
    if (!rec.imagePath) continue;
    const fp = path.join(ROOT, 'public', String(rec.imagePath).replace(/^\//, ''));
    try {
      const buf = await fs.readFile(fp);
      map.set(rec.id, crypto.createHash('sha256').update(buf).digest('hex'));
    } catch { /* ไฟล์หาย = ข้าม (ไม่นับเป็น dup) */ }
  }
  return map;
}

// verify: resolveRefSlotView ต้องสะอาด (0 dangling + 0 unmatched) ทุกใบที่มี template
function verifyClean(records) {
  const rows = [];
  for (const rec of records) {
    if (!Array.isArray(rec?.dna?.template?.slots) || !rec.dna.template.slots.length) {
      rows.push({ id: rec.id, template: 0, clean: true, note: 'no-template' });
      continue;
    }
    const v = resolveRefSlotView(rec.dna, { mode: 'template_v1' });
    const unmatched = v.views.filter((x) => !x.semanticMatched).map((x) => x.role);
    const dangling = v.diagnostics.danglingDnaRoles.map((x) => x.role);
    rows.push({ id: rec.id, template: v.views.length, unmatched, dangling, clean: unmatched.length === 0 && dangling.length === 0 });
  }
  return rows;
}

async function main() {
  const raw = await fs.readFile(FILE, 'utf8');
  const records = JSON.parse(raw);
  const imageHashById = await hashImages(records);
  const plan = planRepair(records, imageHashById);

  // ── ตารางรายงานก่อน/หลังต่อใบ ──
  console.log(`\n📋 R2 repair plan — ${records.length} records ${DRY ? '(DRY-RUN)' : '(WRITE)'}\n`);
  console.log('ID'.padEnd(22), '│ slots', '│ dup');
  console.log('─'.repeat(70));
  let nSlots = 0, nDup = 0;
  for (const r of plan.results) {
    if (!r.changed) continue;
    const slotCol = r.slotsChanged
      ? `[${r.before.dnaRoles.join(',')}] → [${r.after.dnaRoles.join(',')}]`
      : '—';
    const dupCol = r.dupChanged ? `+_duplicateOf=${r.duplicateOf}` : '—';
    console.log(r.id.padEnd(22), '│', slotCol);
    if (r.dupChanged) console.log(''.padEnd(22), '│', dupCol);
    if (r.slotsChanged) nSlots++;
    if (r.dupChanged) nDup++;
  }
  if (nSlots === 0 && nDup === 0) console.log('(ไม่มีอะไรต้องซ่อม — คลังสะอาดอยู่แล้ว)');
  console.log('─'.repeat(70));
  console.log(`สรุป: dna.slots ซ่อม ${nSlots} ใบ · duplicate flag ${nDup} ใบ`);
  if (plan.dupGroups.length) {
    console.log('\n🔁 duplicate groups (byte-identical images):');
    for (const g of plan.dupGroups) console.log(`  original=${g.originalId} ← dups=[${g.dups.join(', ')}]`);
  }

  if (!DRY) {
    // backup ก่อนเขียนเสมอ
    const day = new Date().toISOString().slice(0, 10);
    const backupDir = path.join(ROOT, 'backup', `ref-library_${day}-r2`);
    await fs.mkdir(backupDir, { recursive: true });
    await fs.writeFile(path.join(backupDir, 'ref-cover-library.json'), raw, 'utf8');
    console.log(`\n💾 backup → ${path.relative(ROOT, backupDir)}/ref-cover-library.json`);

    applyRepairPlan(records, plan);
    await fs.writeFile(FILE, JSON.stringify(records, null, 2), 'utf8');
    console.log(`✅ เขียนคลังแล้ว (${records.length} records)`);
  }

  // ── verify: resolveRefSlotView 21/21 สะอาด ──
  const verifyRecords = DRY ? applyRepairPlan(JSON.parse(raw), planRepair(JSON.parse(raw), imageHashById)) : records;
  const rows = verifyClean(verifyRecords);
  const dirty = rows.filter((r) => !r.clean);
  console.log(`\n🔎 resolveRefSlotView verify: ${rows.filter((r) => r.clean).length}/${rows.length} สะอาด`);
  for (const d of dirty) console.log(`  ❌ ${d.id} unmatched=${JSON.stringify(d.unmatched)} dangling=${JSON.stringify(d.dangling)}`);
  if (dirty.length) process.exitCode = 1;
}

// รันเป็น CLI เท่านั้น (import ไม่รัน main)
if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error('❌ repair ล้ม:', e); process.exit(1); });
}
