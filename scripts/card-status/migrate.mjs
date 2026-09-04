/**
 * migrate.mjs — ใช้แผนคลังการ์ด v2 กับ store จริง ผ่าน createStore เท่านั้น (F13 · ขั้น S4/S6 ของแบบ)
 *
 * ค่าเริ่มต้น = dry-run: พิมพ์ diff รายใบ + สรุปจำนวน — ไม่เขียนอะไรเลย (ไม่แตะ store/ดิสก์)
 * --apply จึงเขียนจริง ตามลำดับบังคับ:
 *   1) backup อัตโนมัติทั้ง store (card-backup-<label>.json + sha256) — ล้ม = หยุดทันที
 *   2) เขียน reverse-script (restore-<label>.json = ค่าเดิมทุก field ที่จะแตะ + ใบใหม่ที่จะถอน) ก่อนเขียน store
 *   3) เขียนรายใบผ่าน store.update(id, fieldsที่เปลี่ยน) · ใบใหม่ผ่าน store.add (status:'proposed')
 *   4) อ่านกลับ (authoritative) ตรวจนับ + ตรวจทุก field ที่แตะ — ไม่ตรง = exit 1 (ไปใช้ restore.mjs)
 *
 * ย้อนกลับ: node scripts/card-status/restore.mjs C:\tmp\news-r233-run\restore-<label>.json --apply
 * สวิตช์ถอย: CARD_MIGRATE_APPLY=0 → โหมด --apply ปฏิเสธไม่เขียน (dry-run/restore ใช้ได้เสมอ — ห้ามบล็อกทางถอย)
 * กันพลาดเป้า: ไม่ใช่ Supabase (เช่น env ไม่ครบ → file fallback) ต้องใส่ --allow-file-store เองเท่านั้น
 *   (ใช้ตอน "ซ้อม restore กับสำเนา" ตามแบบ S0 — ห้ามใช้กับเครื่องที่ mirror คือของจริง)
 *
 * ใช้:
 *   node scripts/card-status/migrate.mjs                                  → dry-run ทั้งแผน
 *   node scripts/card-status/migrate.mjs --sections sweep,viralScore      → dry-run เฉพาะก้อน (บันได §6.4)
 *   node scripts/card-status/migrate.mjs --ladder B1|B2|B3                → dry-run ตามบันไดที่ลงทะเบียน
 *   node scripts/card-status/migrate.mjs --apply [--label <label>]        → เขียนจริง (backup+reverse ก่อนเสมอ)
 *   เพิ่มได้: --plans-dir <dir> · --out-dir <dir> (ที่เก็บ backup/reverse — ค่าเริ่มต้น C:\tmp\news-r233-run) ·
 *             --no-counts · --verbose (diff เต็มไม่ตัดคำ)
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  RUN_DIR, STORE_NAME, EXPECTED_COUNTS, PLANS_DIR_DEFAULT,
  loadPlans, validatePlans, jsonEqual, sortKeysDeep, parseCliArgs, isMainModule, printValidation, getRealStore,
} from './plan-schema.mjs';
import { applyPlans, SECTION_ORDER, LADDER_ARMS, formatChangeLines } from './build-arms.mjs';
import { writeBackup, defaultBackupLabel, assertLabel } from './backup.mjs';

/** reverse-script: ค่าเดิมของทุก field ที่ถูกแตะ (รวม updatedAt ที่ store ประทับเวลาเอง) + ใบใหม่ที่ต้องถอน */
export function buildReverseScript(originalCards, applied, { label, createdAt, baseBackup = null } = {}) {
  const origById = new Map(originalCards.map((c) => [c.id, c]));
  const updates = {};
  for (const ch of applied.changes) {
    const orig = origById.get(ch.id);
    const set = {};
    const unset = [];
    for (const f of ch.fields) {
      if (f.hadBefore) set[f.field] = structuredClone(f.before);
      else unset.push(f.field);
    }
    // store.update ประทับ updatedAt ทุกครั้ง (persistStore.js:331,460) — บันทึกค่าเดิมไว้คืน/ไว้เป็นหลักฐานเสมอ
    if (!('updatedAt' in set) && !unset.includes('updatedAt')) {
      if ('updatedAt' in orig) set.updatedAt = orig.updatedAt;
      else unset.push('updatedAt');
    }
    updates[ch.id] = { set, unset: unset.sort() };
  }
  return {
    version: 1,
    kind: 'card-restore-script',
    store: STORE_NAME,
    label,
    createdAt,
    baseBackup,
    note: 'ใช้กับ scripts/card-status/restore.mjs — set = ค่าเดิมที่ต้องคืน · unset = field ที่เดิมไม่มีต้องลบ · removes = ใบใหม่ที่ต้องถอน (updatedAt จะถูก store ประทับใหม่เสมอ คืนไบต์เดิมไม่ได้ที่ field นี้ field เดียว)',
    updates,
    removes: applied.newCards.map(({ id, card }) => ({ id, promptName: card.promptName })),
  };
}

export function summarizeMigration(applied) {
  const fieldTotal = applied.changes.reduce((n, ch) => n + ch.fields.length, 0);
  const byField = {};
  for (const ch of applied.changes) for (const f of ch.fields) byField[f.field] = (byField[f.field] || 0) + 1;
  return {
    cardsChanged: applied.changes.length,
    fieldTotal,
    byField,
    archived: applied.archivedIds.length,
    added: applied.newCards.length,
    sweepStats: applied.sweepStats,
    sectionCounts: applied.sectionCounts,
  };
}

/** เขียนจริงรายใบ — เรียกเฉพาะเส้นทาง --apply (สั่งงานทีละใบ กันชนกับ lock ของ store) */
export async function applyMigration(store, applied) {
  let updated = 0;
  let added = 0;
  for (const ch of applied.changes) {
    const fields = {};
    for (const f of ch.fields) {
      if (!('after' in f) || f.after === undefined) continue; // แผนเราไม่มีการลบ field — after undefined ไม่ควรเกิด
      fields[f.field] = structuredClone(f.after);
    }
    await store.update(ch.id, fields); // eslint-disable-line no-await-in-loop -- เขียนเรียงทีละใบโดยตั้งใจ
    updated += 1;
  }
  for (const { card } of applied.newCards) {
    await store.add(structuredClone(card)); // eslint-disable-line no-await-in-loop
    added += 1;
  }
  return { updated, added };
}

/** อ่านกลับตรวจทุก field ที่แตะ + ตรวจนับ (ข้าม updatedAt — store ประทับเวลาเอง) */
export async function verifyMigration(store, applied, { originalCount }) {
  const cards = await store.getAll({ authoritative: true });
  const byId = new Map(cards.map((c) => [c.id, c]));
  const mismatches = [];
  for (const ch of applied.changes) {
    const cur = byId.get(ch.id);
    if (!cur) { mismatches.push(`${ch.id}: หายจาก store`); continue; }
    for (const f of ch.fields) {
      if (f.field === 'updatedAt') continue;
      if (!jsonEqual(cur[f.field], f.after)) {
        mismatches.push(`${ch.id}.${f.field}: ค่าใน store ไม่ตรงกับที่ตั้งใจเขียน`);
      }
    }
  }
  for (const { id, card } of applied.newCards) {
    const cur = byId.get(id);
    if (!cur) { mismatches.push(`ใบใหม่ ${id}: ไม่พบใน store หลัง add`); continue; }
    for (const [f, v] of Object.entries(card)) {
      if (f === 'updatedAt') continue;
      if (!jsonEqual(cur[f], v)) mismatches.push(`ใบใหม่ ${id}.${f}: ไม่ตรงกับที่ add`);
    }
  }
  const expectedCount = originalCount + applied.newCards.length;
  if (cards.length !== expectedCount) {
    mismatches.push(`จำนวนรวม ${cards.length} ≠ ที่คาด ${expectedCount} (เดิม ${originalCount} + ใบใหม่ ${applied.newCards.length})`);
  }
  return { ok: mismatches.length === 0, mismatches, total: cards.length };
}

/**
 * ตัวเดินงานหลัก (CLI และเทสใช้ตัวเดียวกัน — เทสส่ง store สตับ + hooks ที่จดบันทึกแทนเขียนดิสก์)
 * dry-run รับประกันไม่เรียก store.update/add และไม่เรียก hooks เขียนไฟล์ใดๆ
 */
export async function runMigrate({
  store,
  plans,
  sections = SECTION_ORDER,
  apply = false,
  label = defaultBackupLabel(),
  now = new Date().toISOString(),
  expectedCounts = EXPECTED_COUNTS,
  hooks = {},
  env = process.env,
}) {
  assertLabel(label);
  const cards = await store.getAll({ authoritative: true });
  if (!cards.length) throw new Error('store ว่าง (0 ใบ) — env น่าจะชี้ผิดที่ หยุดก่อน');
  const validation = validatePlans(plans, cards, { expectedCounts });
  if (!validation.ok) return { ok: false, stage: 'validate', validation };

  const applied = applyPlans(cards, validation.canonical, { mode: 'migrate', sections, now });
  const reverse = buildReverseScript(cards, applied, { label, createdAt: now, baseBackup: `card-backup-${label}.json` });
  const summary = summarizeMigration(applied);

  if (!apply) {
    return { ok: true, stage: 'dry-run', dryRun: true, validation, applied, reverse, summary };
  }

  // ── เส้นทางเขียนจริง ──
  // env ไม่ได้ฉีด = อ่าน process.env ตรงตัว (ทะเบียนสวิตช์สแกนชื่อจากจุดอ่านตรงเท่านั้น) — ค่าเท่าเดิมทุกกรณี
  const applyKill = env === process.env ? process.env.CARD_MIGRATE_APPLY : env.CARD_MIGRATE_APPLY;
  if (applyKill === '0') {
    throw new Error('CARD_MIGRATE_APPLY=0 — โหมด --apply ถูกปิดไว้ (สวิตช์ถอยของสคริปต์) · dry-run/restore ใช้ได้ปกติ');
  }
  if (typeof hooks.writeBackup !== 'function' || typeof hooks.writeReverse !== 'function') {
    throw new Error('โหมด apply ต้องมี hooks.writeBackup และ hooks.writeReverse — backup ก่อนเขียนเป็นขั้นบังคับ ห้ามข้าม');
  }
  const backupInfo = await hooks.writeBackup(cards, { label });
  if (!backupInfo || backupInfo.count !== cards.length) {
    throw new Error(`backup นับแถวไม่ตรง (backup=${backupInfo?.count} vs store=${cards.length}) — หยุดก่อนเขียน`);
  }
  const reverseInfo = await hooks.writeReverse(reverse, { label });
  const written = await applyMigration(store, applied);
  const verify = await verifyMigration(store, applied, { originalCount: cards.length });
  return {
    ok: verify.ok,
    stage: 'apply',
    dryRun: false,
    validation,
    applied,
    reverse,
    summary,
    backupInfo,
    reverseInfo,
    written,
    verify,
  };
}

export function printMigrationSummary(result, { verbose = false } = {}) {
  const { summary, applied } = result;
  console.log(`ใบที่เนื้อเปลี่ยน: ${summary.cardsChanged} ใบ · field รวม ${summary.fieldTotal}`);
  console.log(`  ต่อ field: ${Object.entries(summary.byField).sort().map(([f, n]) => `${f}=${n}`).join(' · ') || '-'}`);
  console.log(`  ต่อก้อน: ${Object.entries(summary.sectionCounts).map(([s, n]) => `${s}=${n}`).join(' · ')}`);
  console.log(`  กวาด: ctaStyle ${summary.sweepStats.ctaStyle} ใบ${summary.sweepStats.rules.map((r) => ` · ${r.field}~/${r.source}/ ${r.cards} ใบ`).join('')}`);
  console.log(`  archive (status:'archived'): ${applied.archivedIds.length} ใบ · ใบใหม่ (status:'proposed'): ${applied.newCards.map((n) => n.id).join(', ') || '-'}`);
  console.log('');
  console.log('diff รายใบ:');
  for (const line of formatChangeLines(applied.changes, { maxLen: verbose ? 100000 : 90 })) console.log(line);
}

// ── main ─────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  try {
    const args = parseCliArgs(process.argv.slice(2), {
      flags: ['--apply', '--no-counts', '--verbose', '--allow-file-store'],
      options: ['--plans-dir', '--sections', '--ladder', '--label', '--out-dir'],
    });
    let sections = SECTION_ORDER;
    if (args.ladder) {
      if (!LADDER_ARMS[args.ladder]) throw new Error(`ไม่รู้จักบันได: ${args.ladder} (มี ${Object.keys(LADDER_ARMS).join(', ')})`);
      sections = LADDER_ARMS[args.ladder];
    }
    if (args.sections) sections = args.sections.split(',').map((s) => s.trim()).filter(Boolean);
    const outDir = args['out-dir'] ? path.resolve(args['out-dir']) : RUN_DIR;
    const label = args.label || defaultBackupLabel();
    const plans = loadPlans(args['plans-dir'] ? path.resolve(args['plans-dir']) : PLANS_DIR_DEFAULT);
    if (args['no-counts']) console.warn('⚠️ ข้ามการตรวจจำนวนตามแบบ (--no-counts)');

    const { store, supabaseMode } = await getRealStore({ allowFileStore: !!args['allow-file-store'] });
    console.log(`เป้าหมาย: createStore('${STORE_NAME}') → ${supabaseMode ? 'Supabase (ของจริง)' : 'file fallback (ซ้อม/สำเนาเท่านั้น)'} · sections: ${sections.join(',')}`);

    const result = await runMigrate({
      store,
      plans,
      sections,
      apply: !!args.apply,
      label,
      expectedCounts: args['no-counts'] ? null : EXPECTED_COUNTS,
      hooks: {
        writeBackup: (cards, { label: l }) => writeBackup(cards, { label: l, outDir }),
        writeReverse: (reverse, { label: l }) => {
          const p = path.join(outDir, `restore-${l}.json`);
          if (fs.existsSync(p)) throw new Error(`มี reverse-script ชื่อนี้แล้ว: ${p} — เปลี่ยน label`);
          fs.writeFileSync(p, `${JSON.stringify(sortKeysDeep(reverse), null, 2)}\n`, 'utf8');
          return { file: p };
        },
      },
    });

    if (result.stage === 'validate') {
      printValidation(result.validation);
      console.error(`❌ แผนไม่ผ่าน validator (${result.validation.errors.length} ข้อ) — ไม่ไปต่อ`);
      process.exit(1);
    }
    printValidation(result.validation);
    printMigrationSummary(result, { verbose: !!args.verbose });

    if (result.dryRun) {
      console.log('');
      console.log('🔍 dry-run เท่านั้น — ยังไม่เขียนอะไรทั้งสิ้น (store/ไฟล์) · ใช้ --apply เมื่อกวาดตา diff แล้ว + Gate ผ่าน + เจ้าของเคาะ');
    } else {
      console.log('');
      console.log(`💾 backup: ${result.backupInfo.file} (${result.backupInfo.count} ใบ · sha256=${result.backupInfo.sha256.slice(0, 12)})`);
      console.log(`↩️ reverse-script: ${result.reverseInfo.file}`);
      console.log(`✍️ เขียนแล้ว: update ${result.written.updated} ใบ · add ${result.written.added} ใบ`);
      if (result.verify.ok) {
        console.log(`✅ ตรวจหลังเขียนผ่าน: ${result.verify.total} ใบ ทุก field ที่แตะตรงตามแผน`);
      } else {
        console.error(`❌ ตรวจหลังเขียนไม่ผ่าน ${result.verify.mismatches.length} จุด:`);
        for (const m of result.verify.mismatches) console.error(`   - ${m}`);
        console.error(`   → พิจารณาคืนค่า: node scripts/card-status/restore.mjs ${result.reverseInfo.file} --apply`);
        process.exit(1);
      }
    }
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
}
