/**
 * restore.mjs — คืนค่า store 'prompt-library' รายใบ จาก reverse-script หรือไฟล์ backup (F13)
 *
 * ค่าเริ่มต้น = dry-run: พิมพ์ว่าจะคืนใบไหน field ไหน จากค่าอะไรเป็นอะไร — ไม่เขียนอะไรเลย
 * --apply จึงเขียนจริงผ่าน createStore เท่านั้น แล้วอ่านกลับตรวจทุกใบ
 *
 * แหล่งคืนค่า 2 แบบ:
 *   1) reverse-script (restore-<label>.json จาก migrate --apply): คืนทุกใบในสคริปต์ (หรือ --ids เลือกใบ)
 *      · set = คืนค่าเดิม · unset = ลบ field ที่เดิมไม่มี (เช่น status) · removes = ถอนใบใหม่ที่ import ไป
 *   2) backup (card-backup-<label>.json): คืน "ทั้งใบ" เป๊ะตาม backup รายใบ — ต้องระบุ --ids หรือ --all
 *
 * ข้อจำกัดที่หลีกไม่ได้: store.update ประทับ updatedAt ใหม่เสมอ (persistStore.js:331,460) —
 * ทุก field คืนไบต์เดิมได้ยกเว้น updatedAt (ตรวจหลังเขียนจะข้าม field นี้ field เดียว)
 *
 * สคริปต์นี้คือทางถอย — ไม่ผูกกับ CARD_MIGRATE_APPLY (ห้ามบล็อกทางถอย ตามแบบแผน import-new-teachers)
 *
 * ใช้: node scripts/card-status/restore.mjs <ไฟล์> [--ids a,b] [--all] [--apply] [--allow-file-store] [--verbose]
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  STORE_NAME, jsonEqual, parseCliArgs, isMainModule, getRealStore,
} from './plan-schema.mjs';
import { readBackupFile } from './backup.mjs';

export function detectRestoreKind(data) {
  if (Array.isArray(data)) return 'backup';
  if (data?.kind === 'card-restore-script') return 'restore-script';
  if (data?.kind === 'card-backup' || Array.isArray(data?.items)) return 'backup';
  throw new Error('ไม่รู้จักรูปไฟล์ — ต้องเป็น restore-<label>.json (kind:card-restore-script) หรือ card-backup-<label>.json');
}

const resolveIds = (requested, available, label) => requested.map((raw) => {
  if (available.has(raw)) return raw;
  if (available.has(`prompt_${raw}`)) return `prompt_${raw}`;
  throw new Error(`${label}: ไม่พบ id "${raw}" ในไฟล์`);
});

/** แปลง reverse-script → รายการปฏิบัติการรายใบ (เรียงตาม id · เลือกด้วย ids ได้) */
export function planRestoreFromScript(script, { ids = null } = {}) {
  if (script?.kind !== 'card-restore-script' || script?.version !== 1) throw new Error('reverse-script ไม่ถูกรูป (version/kind)');
  const updates = script.updates || {};
  const removes = script.removes || [];
  const available = new Set([...Object.keys(updates), ...removes.map((r) => r.id)]);
  const wanted = ids ? new Set(resolveIds(ids, available, '--ids')) : null;
  const ops = [];
  for (const id of Object.keys(updates).sort()) {
    if (wanted && !wanted.has(id)) continue;
    const { set = {}, unset = [] } = updates[id];
    ops.push({ type: 'update', id, set: structuredClone(set), unset: [...unset] });
  }
  for (const r of [...removes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (wanted && !wanted.has(r.id)) continue;
    ops.push({ type: 'remove', id: r.id, promptName: r.promptName });
  }
  if (!ops.length) throw new Error('ไม่มีใบให้คืน (ids ไม่ตรงกับในไฟล์?)');
  return ops;
}

/** แปลง backup → ปฏิบัติการ "คืนทั้งใบ" รายใบ (--ids รายใบ หรือ --all ทุกใบใน backup) */
export function planRestoreFromBackup(backupItems, { ids = null, all = false } = {}) {
  if (!ids && !all) throw new Error('คืนจาก backup ต้องระบุ --ids <id,...> (รายใบ) หรือ --all (ทุกใบใน backup) — กันคืนทั้งชุดโดยไม่ตั้งใจ');
  const byId = new Map(backupItems.map((c) => [c.id, c]));
  const chosen = ids ? resolveIds(ids, new Set(byId.keys()), '--ids') : [...byId.keys()];
  return [...new Set(chosen)].sort().map((id) => ({ type: 'replace', id, card: structuredClone(byId.get(id)) }));
}

/** diff เพื่อ dry-run/รายงาน — เทียบ ops กับสภาพปัจจุบันใน store */
export function describeRestoreOps(ops, currentCards, { maxLen = 90 } = {}) {
  const snip = (v) => {
    const s = v === undefined ? '(ไม่มี field)' : JSON.stringify(v);
    return s.length > maxLen ? `${s.slice(0, maxLen)}…(${s.length})` : s;
  };
  const byId = new Map(currentCards.map((c) => [c.id, c]));
  const lines = [];
  for (const op of ops) {
    const cur = byId.get(op.id);
    if (op.type === 'update') {
      lines.push(`### ${op.id} — คืนค่า ${Object.keys(op.set).length} field · ลบ ${op.unset.length} field`);
      if (!cur) { lines.push('- ‼️ ไม่พบใบนี้ใน store ปัจจุบัน (update จะล้ม)'); continue; }
      for (const [f, v] of Object.entries(op.set)) {
        if (jsonEqual(cur[f], v)) lines.push(`- ${f}: ตรงอยู่แล้ว`);
        else lines.push(`- ${f}: ${snip(cur[f])} → ${snip(v)}`);
      }
      for (const f of op.unset) lines.push(`- ${f}: ${f in (cur || {}) ? `${snip(cur[f])} → (ลบ field)` : 'ไม่มีอยู่แล้ว'}`);
    } else if (op.type === 'remove') {
      if (!cur) lines.push(`### ${op.id} — ถอนใบใหม่: ไม่มีอยู่แล้ว (ข้าม)`);
      else if (cur.promptName !== op.promptName) lines.push(`### ${op.id} — ‼️ ชื่อใบไม่ตรงกับตอน import (${snip(cur.promptName)} ≠ ${snip(op.promptName)}) — จะไม่ถอน`);
      else lines.push(`### ${op.id} — ถอนใบใหม่ ${snip(op.promptName)}`);
    } else if (op.type === 'replace') {
      lines.push(`### ${op.id} — คืนทั้งใบจาก backup${cur ? '' : ' (ใบหายไป — จะ add กลับ)'}`);
      if (cur) {
        const keys = [...new Set([...Object.keys(cur), ...Object.keys(op.card)])].sort();
        let diff = 0;
        for (const f of keys) {
          if (jsonEqual(cur[f], op.card[f])) continue;
          diff += 1;
          lines.push(`- ${f}: ${snip(cur[f])} → ${snip(op.card[f])}`);
        }
        if (!diff) lines.push('- ตรงกับ backup อยู่แล้วทุก field');
      }
    }
  }
  return lines;
}

/** เขียนจริงรายใบ — เก็บ error รายใบแล้วไปต่อ (ปฏิบัติการอิสระต่อกัน) */
export async function applyRestore(store, ops, currentCards) {
  const byId = new Map(currentCards.map((c) => [c.id, c]));
  const done = [];
  const failed = [];
  for (const op of ops) {
    try {
      if (op.type === 'update') {
        await store.update(op.id, (card) => { // eslint-disable-line no-await-in-loop
          const c = { ...card, ...structuredClone(op.set) };
          for (const f of op.unset) delete c[f];
          return c;
        });
        done.push(`update ${op.id}`);
      } else if (op.type === 'remove') {
        const cur = byId.get(op.id);
        if (!cur) { done.push(`remove ${op.id} (ไม่มีอยู่แล้ว — ข้าม)`); continue; }
        if (cur.promptName !== op.promptName) throw new Error(`ชื่อใบไม่ตรงกับตอน import — ไม่ถอน (กันลบผิดใบ): ${op.id}`);
        await store.remove(op.id); // eslint-disable-line no-await-in-loop
        done.push(`remove ${op.id}`);
      } else if (op.type === 'replace') {
        if (byId.has(op.id)) {
          await store.update(op.id, () => structuredClone(op.card)); // eslint-disable-line no-await-in-loop
        } else {
          await store.add(structuredClone(op.card)); // eslint-disable-line no-await-in-loop
        }
        done.push(`replace ${op.id}`);
      }
    } catch (e) {
      failed.push({ id: op.id, type: op.type, error: e.message });
    }
  }
  return { done, failed };
}

/** อ่านกลับตรวจหลังคืนค่า — ข้าม updatedAt (store ประทับใหม่เสมอ) · เจออะไรไม่ตรง = รายงาน+ไม่ผ่าน */
export async function verifyRestore(store, ops) {
  const cards = await store.getAll({ authoritative: true });
  const byId = new Map(cards.map((c) => [c.id, c]));
  const mismatches = [];
  for (const op of ops) {
    const cur = byId.get(op.id);
    if (op.type === 'update') {
      if (!cur) { mismatches.push(`${op.id}: หายจาก store`); continue; }
      for (const [f, v] of Object.entries(op.set)) {
        if (f === 'updatedAt') continue;
        if (!jsonEqual(cur[f], v)) mismatches.push(`${op.id}.${f}: ยังไม่ตรงค่าเดิม`);
      }
      for (const f of op.unset) {
        if (f === 'updatedAt') continue;
        if (f in cur) mismatches.push(`${op.id}.${f}: field ควรถูกลบแต่ยังอยู่`);
      }
    } else if (op.type === 'remove') {
      if (cur && cur.promptName === op.promptName) mismatches.push(`${op.id}: ใบใหม่ยังไม่ถูกถอน`);
    } else if (op.type === 'replace') {
      if (!cur) { mismatches.push(`${op.id}: หายจาก store`); continue; }
      for (const f of new Set([...Object.keys(cur), ...Object.keys(op.card)])) {
        if (f === 'updatedAt') continue;
        if (!jsonEqual(cur[f], op.card[f])) mismatches.push(`${op.id}.${f}: ไม่ตรง backup`);
      }
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

/** ตัวเดินงานหลัก — เทสส่ง store สตับ + data ที่โหลดแล้ว */
export async function runRestore({ store, data, ids = null, all = false, apply = false }) {
  const kind = detectRestoreKind(data);
  const currentCards = await store.getAll({ authoritative: true });
  const ops = kind === 'restore-script'
    ? planRestoreFromScript(data, { ids })
    : planRestoreFromBackup(Array.isArray(data) ? data : data.items, { ids, all });
  if (!apply) return { ok: true, dryRun: true, kind, ops, currentCards };
  const written = await applyRestore(store, ops, currentCards);
  const verify = await verifyRestore(store, ops.filter((op) => !written.failed.some((f) => f.id === op.id)));
  return { ok: written.failed.length === 0 && verify.ok, dryRun: false, kind, ops, currentCards, written, verify };
}

// ── main ─────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  try {
    const args = parseCliArgs(process.argv.slice(2), {
      flags: ['--apply', '--all', '--allow-file-store', '--verbose'],
      options: ['--ids'],
    });
    const file = args._[0];
    if (!file) throw new Error('ต้องระบุไฟล์: restore.mjs <restore-<label>.json | card-backup-<label>.json> [--ids ...] [--apply]');
    const filePath = path.resolve(file);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const kind = detectRestoreKind(raw);
    const data = kind === 'backup' ? readBackupFile(filePath).data : raw; // backup ตรวจ sha256 sidecar ด้วย
    const ids = args.ids ? args.ids.split(',').map((s) => s.trim()).filter(Boolean) : null;

    const { store, supabaseMode } = await getRealStore({ allowFileStore: !!args['allow-file-store'] });
    console.log(`คืนค่าจาก ${kind === 'restore-script' ? 'reverse-script' : 'backup'}: ${filePath}`);
    console.log(`เป้าหมาย: createStore('${STORE_NAME}') → ${supabaseMode ? 'Supabase (ของจริง)' : 'file fallback (ซ้อม/สำเนา)'}`);

    const result = await runRestore({ store, data, ids, all: !!args.all, apply: !!args.apply });
    console.log(`ปฏิบัติการ ${result.ops.length} ใบ:`);
    for (const line of describeRestoreOps(result.ops, result.currentCards, { maxLen: args.verbose ? 100000 : 90 })) console.log(line);

    if (result.dryRun) {
      console.log('');
      console.log('🔍 dry-run เท่านั้น — ยังไม่เขียนอะไร · ใช้ --apply เพื่อคืนจริง (updatedAt จะถูกประทับใหม่ เป็น field เดียวที่คืนไบต์เดิมไม่ได้)');
    } else {
      console.log('');
      for (const d of result.written.done) console.log(`✔ ${d}`);
      for (const f of result.written.failed) console.error(`✖ ${f.type} ${f.id}: ${f.error}`);
      if (result.verify.mismatches.length) {
        for (const m of result.verify.mismatches) console.error(`❌ ตรวจกลับ: ${m}`);
      }
      if (result.ok) console.log(`✅ คืนค่าสำเร็จ ${result.written.done.length} รายการ · ตรวจกลับตรงทุก field (ยกเว้น updatedAt ตามข้อจำกัด store)`);
      else { console.error('❌ คืนค่าไม่ครบ/ไม่ตรง — ดูรายการข้างบน'); process.exit(1); }
    }
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
}
