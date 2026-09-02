#!/usr/bin/env node
/**
 * scripts/import-fb-metrics.mjs <csv> [--dry-run] [--store post-metrics] [--no-mirror]
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ 2 ก.ย. 69 (ข้อ 5 ป้อนกลับผลจริง): นำเข้าไฟล์ส่งออกโพสต์ของเพจ (Facebook Insights CSV)
 *   → store 'post-metrics' ในตาราง store_items (id = ID โพสต์ · data = ฟิลด์โพสต์ + importedAt + textHash)
 *   · idempotent: นำเข้าซ้ำไม่ซ้ำแถว — แถวที่ข้อความ/ยอดเหมือนเดิมไม่ถูกเขียนซ้ำ (นับเป็น "ข้าม")
 *   · ยอดเปลี่ยน (ไลก์โตขึ้นในไฟล์ใหม่) = อัปเดต โดยคง importedAt เดิม เติม updatedAt
 *   · ไม่มี Supabase (ไม่ตั้ง env) = เขียนไฟล์ _planD/lift/post-metrics.json อย่างเดียว (โหมดเครื่องเดียว — รูป array เดียวกับ persistStore)
 *   · สำเนาในเครื่อง/ไฟล์โหมดเดี่ยวอยู่ใต้ _planD/lift/ (LOCAL_DIR) ซึ่ง .gitignore กันด้วย /_* — ข้อความโพสต์ทั้งเพจ ~6MB ห้ามหลุดเข้า commit
 *     (ผู้ตรวจ 2 ก.ย. 69: เดิมเขียน data/post-metrics.json ซึ่งไม่ถูก ignore → ทิ้งไฟล์จริงไว้ในต้นไม้ที่ tracked)
 *   · --dry-run = อ่านของเดิม + คำนวณแผน แต่ไม่เขียนอะไรเลย
 * รัน: node scripts/import-fb-metrics.mjs "C:\Users\User\Downloads\Jun-01-2026_Jul-31-2026_1544214010226189.csv"
 * เทส: tests/post-match.test.mjs import ฟังก์ชันล้วน (planImport/buildItem/textHash) — main ไม่รันเมื่อถูก import
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFbCsv } from '../src/lib/feedback/postMatch.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_STORE = 'post-metrics';
export const UPSERT_CHUNK = 200;
/** ฟิลด์ที่ใช้ตัดสินว่า "เปลี่ยน" (importedAt/updatedAt ไม่นับ) */
export const COMPARE_FIELDS = Object.freeze(['textHash', 'time', 'publishedAt', 'type', 'permalink', 'reactions', 'comments', 'shares', 'reach', 'views']);

/** โหลด .env.local เข้า process.env เฉพาะคีย์ที่ยังไม่มี — ไม่พิมพ์ค่าใดๆ ออก log */
export function loadEnvFile(file = path.join(ROOT, '.env.local'), env = process.env) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return 0; }
  let loaded = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (env[m[1]] != null && env[m[1]] !== '') continue;
    env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
    loaded++;
  }
  return loaded;
}

/** Supabase client จาก env (service key) · ไม่ครบ = null (โหมดไฟล์) — โหลด @supabase/supabase-js ตอนใช้เท่านั้น */
export async function createSupabaseClient(env = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** ลายนิ้วมือข้อความ (ช่องว่างยุบเป็นตัวเดียว) — ไว้รู้ว่าข้อความโพสต์ถูกแก้หลังนำเข้า */
export function textHash(text) {
  const norm = String(text ?? '').replace(/\s+/g, ' ').trim();
  return createHash('sha1').update(norm, 'utf8').digest('hex');
}

/** แถว store จากโพสต์ (คง importedAt ของแถวเดิมถ้ามี) */
export function buildItem(post, { now = new Date().toISOString(), existing = null } = {}) {
  const postId = String(post?.postId ?? '').trim();
  return {
    id: postId,
    postId,
    text: String(post?.text ?? '').trim(),
    textHash: textHash(post?.text),
    time: post?.time ?? '',
    publishedAt: post?.publishedAt ?? null,
    type: post?.type ?? '',
    permalink: post?.permalink ?? '',
    reactions: Number(post?.reactions) || 0,
    comments: Number(post?.comments) || 0,
    shares: Number(post?.shares) || 0,
    reach: Number(post?.reach) || 0,
    views: Number(post?.views) || 0,
    source: 'fb-csv',
    importedAt: existing?.importedAt || now,
    updatedAt: now,
  };
}

export function itemChanged(existing, item) {
  if (!existing) return true;
  return COMPARE_FIELDS.some((f) => (existing[f] ?? null) !== (item[f] ?? null));
}

/**
 * planImport(posts, existingById, { now }) → { toWrite, summary }
 * · existingById = Map/Object id → data ของแถวเดิม · ไม่แตะฐานข้อมูล (เทสได้ตรงๆ)
 * · summary: rows, new, updated, unchanged (ข้าม), noText, noId, duplicateInCsv
 */
export function planImport(posts, existingById = new Map(), { now = new Date().toISOString() } = {}) {
  const getExisting = (id) => (existingById instanceof Map ? existingById.get(id) : existingById?.[id]) || null;
  const summary = { rows: 0, new: 0, updated: 0, unchanged: 0, noText: 0, noId: 0, duplicateInCsv: 0 };
  const toWrite = [];
  const seen = new Set();
  for (const post of Array.isArray(posts) ? posts : []) {
    summary.rows++;
    const postId = String(post?.postId ?? '').trim();
    if (!postId) { summary.noId++; continue; }
    if (!String(post?.text ?? '').trim()) { summary.noText++; continue; }
    if (seen.has(postId)) { summary.duplicateInCsv++; continue; }
    seen.add(postId);
    const existing = getExisting(postId);
    const item = buildItem(post, { now, existing });
    if (!existing) {
      summary.new++;
      toWrite.push(item);
    } else if (itemChanged(existing, item)) {
      summary.updated++;
      toWrite.push(item);
    } else {
      summary.unchanged++;
    }
  }
  return { toWrite, summary };
}

/** อ่านแถวเดิมของ store ทั้งหมด (แบ่งหน้า) → Map id → data */
export async function readStoreRows(sb, store = DEFAULT_STORE, { pageSize = 1000, maxPages = 50 } = {}) {
  const out = new Map();
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    // eslint-disable-next-line no-await-in-loop -- แต่ละหน้าบอกเองว่ามีหน้าถัดไปไหม
    // เรียง created_at แล้ว id (ไม่ซ้ำใน store เดียว) — แถวนำเข้ารอบเดียวกัน created_at เท่ากันหมด ถ้าไม่มีคีย์สำรอง range() อาจคืนแถวซ้ำ/หล่น
    //   → แถวที่หล่นถูกมองเป็น "ใหม่" ทุกรอบ (idempotent ไม่จริง) และ importedAt ถูกทับ (ผู้ตรวจ 2 ก.ย. 69)
    const { data, error } = await sb.from('store_items').select('id,data').eq('store_name', store)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw new Error(`อ่าน store ${store} ล้ม: ${error.message}`);
    for (const row of data || []) if (row?.id) out.set(String(row.id), row.data || {});
    if (!data || data.length < pageSize) break;
  }
  return out;
}

/** upsert เป็นก้อน (onConflict id · ถ้าตารางใช้คีย์คู่ id+store_name ลองใหม่อัตโนมัติ) → จำนวนแถวที่เขียน */
export async function upsertItems(sb, store, items, { chunk = UPSERT_CHUNK } = {}) {
  let written = 0;
  let onConflict = 'id';
  for (let i = 0; i < items.length; i += chunk) {
    const rows = items.slice(i, i + chunk).map((it) => ({
      id: it.id, store_name: store, data: it, created_at: it.importedAt, updated_at: it.updatedAt,
    }));
    // eslint-disable-next-line no-await-in-loop -- เขียนทีละก้อนตามลำดับ กันยิงพร้อมกันเป็นร้อยคำสั่ง
    let res = await sb.from('store_items').upsert(rows, { onConflict });
    if (res?.error && onConflict === 'id' && /no unique or exclusion constraint|ON CONFLICT/i.test(res.error.message || '')) {
      onConflict = 'id,store_name';
      // eslint-disable-next-line no-await-in-loop -- ลองซ้ำก้อนเดิมด้วยคีย์คู่
      res = await sb.from('store_items').upsert(rows, { onConflict });
    }
    if (res?.error) throw new Error(`upsert ล้มที่ก้อน ${Math.floor(i / chunk) + 1}: ${res.error.message}`);
    written += rows.length;
  }
  return written;
}

/** โฟลเดอร์ไฟล์ในเครื่องของฟีเจอร์นี้ (สัมพัทธ์กับ root) — อยู่ใต้ /_* ที่ .gitignore กันไว้ ไม่ใช่ data/ ที่ tracked */
export const LOCAL_DIR = path.join('_planD', 'lift');

export function localStorePath(store = DEFAULT_STORE, root = ROOT, dir = LOCAL_DIR) {
  return path.join(root, dir, `${store}.json`);
}

/** อ่านไฟล์ <dir>/<store>.json (รูป persistStore = array ของ item) → Map id → item · ไม่มีไฟล์ = ว่าง · dir='data' = อ่าน fallback ของ persistStore */
export function readLocalStore(store = DEFAULT_STORE, root = ROOT, dir = LOCAL_DIR) {
  const file = localStorePath(store, root, dir);
  const out = new Map();
  if (!existsSync(file)) return out;
  let raw = readFileSync(file, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const parsed = JSON.parse(raw);
  for (const it of Array.isArray(parsed) ? parsed : []) if (it?.id != null) out.set(String(it.id), it);
  return out;
}

/** เขียน <dir>/<store>.json ทั้งก้อน (ใหม่สุดก่อน · เขียนไฟล์ข้างเคียงแล้วสลับชื่อ กันไฟล์ขาดกลางทาง) */
export function writeLocalStore(store, itemsById, root = ROOT, dir = LOCAL_DIR) {
  const file = localStorePath(store, root, dir);
  mkdirSync(path.dirname(file), { recursive: true });
  const items = [...itemsById.values()].sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
  const tmp = `${file}.${process.pid}-${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(items, null, 2), 'utf8');
    renameSync(tmp, file);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* ยังไม่ได้สร้าง หรือสลับชื่อไปแล้ว */ }
    throw e;
  }
  return { file, count: items.length };
}

export function parseArgs(argv) {
  const args = { csv: '', dryRun: false, store: DEFAULT_STORE, mirror: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--no-mirror') args.mirror = false;
    else if (a === '--store') args.store = String(argv[++i] || DEFAULT_STORE);
    else if (a.startsWith('--store=')) args.store = a.slice('--store='.length) || DEFAULT_STORE;
    else if (!a.startsWith('--') && !args.csv) args.csv = a;
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.csv) {
    console.error('ใช้: node scripts/import-fb-metrics.mjs <csv> [--dry-run] [--store post-metrics] [--no-mirror]');
    process.exitCode = 2;
    return null;
  }
  const csvPath = path.resolve(args.csv);
  const posts = parseFbCsv(readFileSync(csvPath, 'utf8'));
  loadEnvFile();
  const sb = await createSupabaseClient();
  const mode = sb ? 'Supabase' : 'ไฟล์ในเครื่อง (ไม่มี Supabase env)';
  const existing = sb ? await readStoreRows(sb, args.store) : readLocalStore(args.store);
  const now = new Date().toISOString();
  const { toWrite, summary } = planImport(posts, existing, { now });
  console.log(`[import-fb-metrics] ไฟล์ ${path.basename(csvPath)} · แถว ${summary.rows} · store '${args.store}' (${mode}) · ของเดิม ${existing.size} แถว`);
  console.log(`[import-fb-metrics] ใหม่ ${summary.new} · อัปเดต ${summary.updated} · ข้าม(เหมือนเดิม) ${summary.unchanged} · ไม่มีข้อความ ${summary.noText} · ไม่มี id ${summary.noId} · ซ้ำในไฟล์ ${summary.duplicateInCsv}`);
  if (args.dryRun) {
    console.log('[import-fb-metrics] DRY-RUN — ไม่เขียนอะไร');
    return { summary, toWrite, written: 0, dryRun: true };
  }
  let written = 0;
  if (toWrite.length) {
    const merged = new Map(existing);
    for (const it of toWrite) merged.set(it.id, it);
    if (sb) {
      written = await upsertItems(sb, args.store, toWrite);
      console.log(`[import-fb-metrics] เขียน Supabase ${written} แถว`);
      if (args.mirror) {
        try {
          const m = writeLocalStore(args.store, merged);
          console.log(`[import-fb-metrics] สำเนาในเครื่อง ${m.file} (${m.count} แถว)`);
        } catch (e) {
          console.warn(`[import-fb-metrics] เขียนสำเนาในเครื่องไม่สำเร็จ (ไม่กระทบ Supabase): ${e.message}`);
        }
      }
    } else {
      const m = writeLocalStore(args.store, merged);
      written = toWrite.length;
      console.log(`[import-fb-metrics] เขียนไฟล์ ${m.file} (${m.count} แถว)`);
    }
  } else {
    console.log('[import-fb-metrics] ไม่มีอะไรต้องเขียน (นำเข้าซ้ำ = เหมือนเดิมทั้งหมด)');
  }
  return { summary, toWrite, written, dryRun: false };
}

// รันเป็น CLI เท่านั้น (import จากเทส/สคริปต์อื่นจะไม่รัน main) — เทียบ path แบบทนพาธ unicode (Windows)
let _isMain = false;
try {
  _isMain = !!process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
} catch { _isMain = false; }
if (_isMain) {
  main().catch((e) => {
    console.error('[import-fb-metrics] ล้ม:', e && e.message);
    process.exitCode = 1;
  });
}
