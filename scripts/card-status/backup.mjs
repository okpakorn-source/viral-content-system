/**
 * backup.mjs — ดัมพ์ store 'prompt-library' ทั้งชุด (F13 · read-only)
 *
 * อ่านผ่าน createStore('prompt-library').getAll({authoritative:true}) เท่านั้น →
 *   C:\tmp\news-r233-run\card-backup-<label>.json         (wrapper: {version, kind, store, label, createdAt, count, items})
 *   C:\tmp\news-r233-run\card-backup-<label>.json.sha256  (บรรทัดเดียวรูป "<hex>  <ชื่อไฟล์>" — ตรวจด้วย sha256sum -c ได้)
 *
 * ไม่มีการเขียน store ใดๆ ในไฟล์นี้ · หมายเหตุ: authoritative read ฝั่ง Supabase จะ sync mirror
 * data/prompt-library.json ตามพฤติกรรมของ store เอง (persistStore.js:229 — กฎ Database Fallback Sync)
 *
 * ใช้: node scripts/card-status/backup.mjs [--label <a-z0-9_->] [--out-dir <dir>] [--allow-empty] [--allow-file-store]
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  RUN_DIR, STORE_NAME, sha256Hex, parseCliArgs, isMainModule, getRealStore,
} from './plan-schema.mjs';

export function defaultBackupLabel(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, '-'); // 2026-09-03T12-00-00-000Z — เรียงตามเวลาได้ในชื่อไฟล์
}

export function assertLabel(label) {
  if (!/^[A-Za-z0-9_-]+$/.test(label)) throw new Error(`label ใช้ได้เฉพาะ A-Za-z0-9_- (ได้ "${label}")`);
  return label;
}

export function buildBackupObject(cards, { label, createdAt = new Date().toISOString() } = {}) {
  return {
    version: 1,
    kind: 'card-backup',
    store: STORE_NAME,
    label,
    createdAt,
    count: cards.length,
    items: cards, // ดัมพ์ตามที่ getAll คืนมาเป๊ะๆ (ไม่จัดเรียง/ไม่แต่ง — ไฟล์นี้คือความจริงไว้ restore)
  };
}

/** เขียนไฟล์ backup + sidecar sha256 — pure ต่อ store (รับ cards ที่อ่านมาแล้ว) */
export function writeBackup(cards, { label = defaultBackupLabel(), outDir = RUN_DIR, createdAt } = {}) {
  assertLabel(label);
  const fileName = `card-backup-${label}.json`;
  const filePath = path.join(outDir, fileName);
  if (fs.existsSync(filePath)) throw new Error(`มีไฟล์ backup ชื่อนี้แล้ว: ${filePath} — เปลี่ยน label (ห้ามเขียนทับของเก่า)`);
  const body = `${JSON.stringify(buildBackupObject(cards, { label, createdAt }), null, 2)}\n`;
  const sha256 = sha256Hex(body);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(filePath, body, 'utf8');
  const shaPath = `${filePath}.sha256`;
  fs.writeFileSync(shaPath, `${sha256}  ${fileName}\n`, 'utf8');
  return { file: filePath, shaFile: shaPath, sha256, count: cards.length, label };
}

/** อ่านไฟล์ backup กลับ + ตรวจ sha256 sidecar ถ้ามี (restore.mjs ใช้) */
export function readBackupFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const shaPath = `${filePath}.sha256`;
  if (fs.existsSync(shaPath)) {
    const want = fs.readFileSync(shaPath, 'utf8').trim().split(/\s+/)[0];
    const got = sha256Hex(raw);
    if (want && want !== got) throw new Error(`sha256 ไม่ตรง: ${filePath} (ไฟล์ถูกแก้หลัง backup?)`);
  }
  const data = JSON.parse(raw);
  const items = Array.isArray(data) ? data : data?.items;
  if (!Array.isArray(items)) throw new Error(`ไฟล์ backup ไม่ถูกรูป: ${filePath}`);
  return { data, items };
}

// ── main ─────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  try {
    const args = parseCliArgs(process.argv.slice(2), {
      flags: ['--allow-empty', '--allow-file-store'],
      options: ['--label', '--out-dir'],
    });
    const { store, supabaseMode } = await getRealStore({ allowFileStore: !!args['allow-file-store'] });
    const cards = await store.getAll({ authoritative: true });
    console.log(`อ่าน ${cards.length} ใบจาก ${supabaseMode ? 'Supabase' : 'file fallback'} (authoritative)`);
    if (!cards.length && !args['allow-empty']) {
      throw new Error('store ว่าง (0 ใบ) — เกือบแน่ว่า env ชี้ผิดที่ ไม่เขียน backup ว่าง (ถ้าตั้งใจจริง ใส่ --allow-empty)');
    }
    const out = writeBackup(cards, { label: args.label, outDir: args['out-dir'] ? path.resolve(args['out-dir']) : RUN_DIR });
    console.log(`✅ backup ${out.count} ใบ → ${out.file}`);
    console.log(`   sha256=${out.sha256} (${out.shaFile})`);
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
}
