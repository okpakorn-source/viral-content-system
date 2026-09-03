/**
 * นำเข้า "ครูใหม่ชุด 8 ใบ" ตามข้อเสนอ docs/proposals/NEWS-NEW-TEACHERS-15-2sep69.md ข้อ 4 (ชุดใส่ก่อน)
 * เจ้าของเคาะ 3 ก.ย. 69: กลุ่มฮลุนเอา #1 (อาร์เมเนีย) + #10 (พาย่า) · ไม่เอา #13 (พี่หนุ่ม)
 * และใส่ยอดไลก์จริงทั้งคอลัมน์ engagement_likes และ data/viral-likes-real.json (byId)
 *
 * โหมด:
 *   node scripts/import-new-teachers.mjs                → dry-run (ค่าเริ่มต้น: พิมพ์แถว + diff ไฟล์ · ไม่เขียนอะไรเลย)
 *   node scripts/import-new-teachers.mjs --dry-run      → เหมือนบรรทัดบน (--verbose = พิมพ์เนื้อเต็ม)
 *   node scripts/import-new-teachers.mjs --apply        → backup ทั้งตาราง+ไฟล์ 2 ไฟล์ → insert → เติมไฟล์ → เขียน manifest
 *   node scripts/import-new-teachers.mjs --rollback [ไฟล์ manifest]
 *                                                       → ลบแถวตาม id ใน manifest + คืนไฟล์ 2 ไฟล์จาก backup (ตรวจครบทุกขั้น)
 *
 * กติกาความปลอดภัย:
 *   - id ครูใหม่ "คงที่" เสมอ: ใช้ id จากไฟล์ import ถ้ามี → id ใน manifest เดิม → uuid รูปแบบ v4
 *     ที่คำนวณจาก sha256(namespace + _sourcePostId) — ห้ามใช้ Date.now/สุ่ม (รันกี่ครั้งก็ได้ id เดิม)
 *   - กันซ้ำ: id มีในตารางแล้ว = ข้าม insert (แต่ยังเติมไฟล์ให้ครบ — เผื่อรอบก่อนล้มกลางทาง) ·
 *     เนื้อ (content แบบ normalize) ตรงกับแถวเดิมคนละ id = ข้ามทั้งใบ + เตือนดัง
 *   - ไฟล์ data 2 ไฟล์: แก้แบบ "เติมท้ายอย่างเดียว" — ของเดิมทุก key ไบต์เดิมเป๊ะ (ตรวจ round-trip ก่อนแตะ
 *     ถ้า serialize คืนไบต์เดิมไม่ได้ = หยุดทันที ไม่เขียนทับ) · โครง entry likes = {likes, matchedBy}
 *     และบัตรลักษณะ = {emotion, structure, themes, tone} ตามลำดับคีย์เดิมของไฟล์จริง
 *   - Supabase: เขียนผ่าน client แบบเดียวกับ src/app/api/viral-library/route.js (sb.from('viral_examples').insert)
 *     กุญแจอ่านจาก .env.local ตามแบบแผน scripts/export-viral-examples.mjs · dry-run อ่านอย่างเดียว (ล้ม = ทำงานต่อแบบ offline)
 *   - สวิตช์ถอย: TEACHER_IMPORT_APPLY=0 → โหมด --apply ปฏิเสธไม่เขียนอะไร (dry-run/rollback ยังใช้ได้เสมอ
 *     — ห้ามบล็อกทางถอย) · ปิดสวิตช์/ไม่รันสคริปต์ = ระบบเดิมไบต์ต่อไบต์ (สคริปต์นี้ไม่ถูก import โดยโค้ดรันไทม์ใดๆ)
 *
 * เทส: tests/import-new-teachers.test.mjs (pure functions ล้วน — ไม่แตะ DB)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_DIR = ROOT + '-run'; // C:\tmp\news-r233 → C:\tmp\news-r233-run (โฟลเดอร์ run ประจำสายงานนี้)
const MANIFEST_PATH = path.join(RUN_DIR, 'teachers-import-manifest.json');
const PROPOSAL_DOC = 'docs/proposals/NEWS-NEW-TEACHERS-15-2sep69.md';
const IMPORT_FILE = path.join(ROOT, 'docs', 'proposals', 'new-teachers-15-import-2sep69.json');
const ESSENCE_FILE = path.join(ROOT, 'docs', 'proposals', 'new-teachers-15-essences-2sep69.json');
const LIKES_PATH = path.join(ROOT, 'data', 'viral-likes-real.json');
const ESS_PATH = path.join(ROOT, 'data', 'viral-essences.json');

// ── ค่าคงที่ของชุดนำเข้า (ห้ามแก้โดยไม่ผ่านเจ้าของ — ชุดนี้คือคำเคาะ 3 ก.ย. 69) ──────────────────────────
// ชุด "ใส่ก่อน" 8 ใบ ตามข้อเสนอข้อ 4 เรียงลำดับตามตารางในเอกสาร:
//   #1 ฮลุนอาร์เมเนีย · #10 ฮลุนพาย่า · #5 ภูฏาน · #6 พ่อเดิน 28 กิโล · #9 มิกโก ·
//   #11 เด็กหญิงกระปุก · #14 ฮีโร่-อาเธอร์ · #15 เจ๊แห้ง
//   (ไม่มี #13 พี่หนุ่ม และไม่มีใบชะลออื่น #2 #3 #4 #7 #8 #12 — ตามคำเคาะ)
export const SELECTED_SOURCE_IDS = Object.freeze([
  '1566277485525968', // #1  ฮลุนอาร์เมเนีย (165,089 · ข่าวเศร้า)
  '1565194475634269', // #10 ฮลุนพาย่า (86,694 · ดราม่าครอบครัว)
  '1517110340442683', // #5  ภูฏาน (114,795 · ช่วยเหลือกัน)
  '1560145569472493', // #6  พ่อเดิน 28 กิโล (95,064 · ดราม่าครอบครัว)
  '1504220288398355', // #9  มิกโก (88,395 · ช่วยเหลือกัน)
  '1516280530525664', // #11 เด็กหญิงกระปุก (86,449 · ช่วยเหลือกัน)
  '1562486582571725', // #14 ฮีโร่-อาเธอร์ (82,104 · ดราม่าครอบครัว)
  '1510528697767514', // #15 เจ๊แห้ง (80,410 · ช่วยเหลือกัน)
]);
export const ID_NAMESPACE = 'news-teachers-3sep69'; // เกลือคงที่ของ id — เปลี่ยน = ได้ id คนละชุด ห้ามแตะหลังนำเข้าจริง
export const MATCHED_BY = 'proposal-3sep69'; // ป้ายที่มาของไลก์ใน viral-likes-real.json (เจ้าของกำหนด)
// คอลัมน์จริงของตาราง viral_examples ที่ระบบเขียน/อ่าน (proposal ข้อ 2.6 + viralFewshot.js:1053 select
// 'id, title, content, writing_notes, category, engagement_likes' + route.js เขียน source_url)
export const INSERT_COLUMNS = Object.freeze(['id', 'category', 'title', 'content', 'source_url', 'writing_notes', 'engagement_likes']);
export const ESSENCE_KEYS = Object.freeze(['emotion', 'structure', 'themes', 'tone']); // ลำดับคีย์บัตรใน data/viral-essences.json จริง
const LIKES_FLOOR = 50000; // พื้น rank-v2 — ครูใหม่ทุกใบของชุดนี้ต้องถึงพื้น (ต่ำกว่า = ใส่ไปก็โดนข้าม)
const MIN_CONTENT = 200;   // viralFewshot กรอง (content||'').length > 200 — สั้นกว่านี้ = ครูล่องหน

// ── pure functions (มีข้อสอบใน tests/import-new-teachers.test.mjs) ─────────────────────────────────────

/** uuid รูปแบบ v4 แบบคงที่ จาก sha256(namespace + sourcePostId) — ไม่มีการสุ่ม/เวลาปน */
export function deriveTeacherId(sourcePostId) {
  const src = String(sourcePostId ?? '').trim();
  if (!/^\d{6,}$/.test(src)) throw new Error(`sourcePostId ไม่ถูกต้อง: "${sourcePostId}"`);
  const hex = createHash('sha256').update(`${ID_NAMESPACE}:${src}`, 'utf8').digest('hex');
  const c = hex.slice(0, 32).split('');
  c[12] = '4'; // นิบเบิลเวอร์ชัน = 4
  c[16] = ((parseInt(c[16], 16) & 0x3) | 0x8).toString(16); // variant = 10xx (8/9/a/b)
  const s = c.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/** คีย์เทียบเนื้อแบบเดียวกับสัญญา _normLikeKey/match-real-likes (NFC + เก็บเฉพาะตัวอักษร/ตัวเลข) — เต็มความยาว ไม่ตัด 120 */
export function normalizeContentKey(value) {
  return String(value ?? '').normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '');
}

/** เลือก 8 ใบตามชุดใส่ก่อน + ตรวจคุณสมบัติที่ทำให้ครู "มีตัวตนจริง" ในระบบ · คืนตามลำดับชุด */
export function selectTeacherRows(importRows) {
  if (!Array.isArray(importRows) || !importRows.length) throw new Error('ไฟล์ import ว่าง/ไม่ใช่อาเรย์');
  const bySource = new Map(importRows.map((r) => [String(r?._sourcePostId ?? ''), r]));
  const rows = SELECTED_SOURCE_IDS.map((sid) => {
    const r = bySource.get(sid);
    if (!r) throw new Error(`ไม่พบใบ ${sid} ในไฟล์ import`);
    return r;
  });
  for (const r of rows) {
    const sid = String(r._sourcePostId);
    if (String(r.content ?? '').length <= MIN_CONTENT) throw new Error(`ใบ ${sid}: content ยาว ${String(r.content ?? '').length} ≤ ${MIN_CONTENT} — viralFewshot จะกรองทิ้ง (ครูล่องหน)`);
    const likes = Number(r._realLikes ?? r.engagement_likes);
    if (!Number.isFinite(likes) || likes < LIKES_FLOOR) throw new Error(`ใบ ${sid}: ไลก์ ${likes} ต่ำกว่าพื้น rank-v2 (${LIKES_FLOOR})`);
    if (Number(r.engagement_likes) !== likes) throw new Error(`ใบ ${sid}: engagement_likes (${r.engagement_likes}) ไม่เท่า _realLikes (${r._realLikes}) — ไฟล์ import เพี้ยน ต้องเช็กก่อน`);
    for (const k of ['category', 'title', 'writing_notes']) {
      if (!String(r[k] ?? '').trim()) throw new Error(`ใบ ${sid}: ช่อง ${k} ว่าง`);
    }
  }
  return rows;
}

/** แถว insert ตามคอลัมน์จริงเป๊ะ (ตัดคีย์ _... ทิ้งโดยโครงสร้าง — ประกอบใหม่ทีละช่อง) */
export function buildInsertRow(row, id) {
  return {
    id: String(id),
    category: String(row.category),
    title: String(row.title),
    content: String(row.content),
    source_url: row.source_url ?? null,
    writing_notes: String(row.writing_notes),
    engagement_likes: Number(row.engagement_likes),
  };
}

/** entry ของ data/viral-likes-real.json byId — โครง/ลำดับคีย์เดียวกับ entry เดิม ({likes, matchedBy}) */
export function buildLikesEntry(row) {
  const likes = Number(row._realLikes ?? row.engagement_likes);
  if (!Number.isFinite(likes) || likes <= 0) throw new Error('ไลก์ไม่ถูกต้อง: ' + likes);
  return { likes, matchedBy: MATCHED_BY };
}

/** บัตรลักษณะ — บังคับสคีมา+ลำดับคีย์ให้ตรงไฟล์ data/viral-essences.json เดิมเป๊ะ */
export function buildEssenceCard(card) {
  if (!card || typeof card !== 'object') throw new Error('บัตรลักษณะไม่ใช่ object');
  const bad = Object.keys(card).filter((k) => !ESSENCE_KEYS.includes(k));
  if (bad.length) throw new Error('บัตรลักษณะมีคีย์แปลกปลอม: ' + bad.join(','));
  const { emotion, structure, themes, tone } = card;
  const okList = (a) => Array.isArray(a) && a.length && a.every((x) => typeof x === 'string' && x.trim());
  if (!okList(emotion)) throw new Error('emotion ต้องเป็นอาเรย์สตริงไม่ว่าง');
  if (!okList(themes)) throw new Error('themes ต้องเป็นอาเรย์สตริงไม่ว่าง');
  if (typeof structure !== 'string' || !structure.trim()) throw new Error('structure ว่าง');
  if (typeof tone !== 'string' || !tone.trim()) throw new Error('tone ว่าง');
  return { emotion: [...emotion], structure, themes: [...themes], tone };
}

/** จับรูปแบบไฟล์ JSON เดิม (ย่อหน้า/ปลายบรรทัด/บรรทัดท้าย) เพื่อเขียนกลับไบต์แบบเดียวกัน */
export function detectJsonFormat(raw) {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const m = raw.replace(/\r\n/g, '\n').match(/\n( +)"/);
  const indent = m ? m[1].length : 2;
  const trailing = raw.endsWith(eol) ? eol : '';
  return { eol, indent, trailing };
}

export function serializeJson(value, fmt) {
  return JSON.stringify(value, null, fmt.indent).replace(/\n/g, fmt.eol) + fmt.trailing;
}

/** parse + พิสูจน์ว่า serialize คืนไบต์เดิมได้เป๊ะ — ทำไม่ได้ = ห้ามแตะไฟล์นั้น (โยน error) */
export function assertRoundTrip(raw, label) {
  if (raw.charCodeAt(0) === 0xFEFF) throw new Error(`${label}: มี BOM นำหน้า — สคริปต์นี้ไม่รองรับ ห้ามเขียนทับ (กันไฟล์เพี้ยน)`);
  const data = JSON.parse(raw);
  const fmt = detectJsonFormat(raw);
  const again = serializeJson(data, fmt);
  if (again !== raw) {
    let i = 0;
    while (i < raw.length && raw[i] === again[i]) i++;
    throw new Error(`${label}: round-trip ไม่ตรงไบต์เดิม (ต่างตั้งแต่ตำแหน่ง ${i}) — หยุดก่อนทำไฟล์เสีย`);
  }
  return { data, fmt };
}

/** เติม byId แบบไม่ทำลายของเดิม: คีย์เดิมทุกตัวคงที่ · คีย์ที่มีแล้ว = ข้าม (ไม่ทับ) · คีย์ใหม่ต่อท้าย */
export function mergeLikes(likesData, additions) {
  if (!likesData || typeof likesData !== 'object' || !likesData.byId || typeof likesData.byId !== 'object') {
    throw new Error('โครง viral-likes-real.json ผิด (ไม่มี byId)');
  }
  const byId = { ...likesData.byId };
  const added = [], skippedExisting = [];
  for (const [id, entry] of Object.entries(additions)) {
    if (Object.prototype.hasOwnProperty.call(byId, id)) { skippedExisting.push(id); continue; }
    byId[id] = { likes: entry.likes, matchedBy: entry.matchedBy };
    added.push(id);
  }
  const out = {};
  for (const k of Object.keys(likesData)) out[k] = k === 'byId' ? byId : likesData[k];
  return { data: out, added, skippedExisting };
}

/** เติมบัตรลักษณะ (แผนที่แบน id → card) กติกาเดียวกับ mergeLikes */
export function mergeEssences(essData, additions) {
  if (!essData || typeof essData !== 'object' || Array.isArray(essData)) throw new Error('โครง viral-essences.json ผิด');
  const out = { ...essData };
  const added = [], skippedExisting = [];
  for (const [id, card] of Object.entries(additions)) {
    if (Object.prototype.hasOwnProperty.call(out, id)) { skippedExisting.push(id); continue; }
    out[id] = buildEssenceCard(card);
    added.push(id);
  }
  return { data: out, added, skippedExisting };
}

/**
 * แผนนำเข้าทั้งก้อน (pure): เลือกใบ → id คงที่ → กันซ้ำ → merge ไฟล์ 2 ไฟล์ (ยังไม่เขียนอะไร)
 * existingRows = ดัมพ์ตารางจริง (null = offline: ตัดสินซ้ำจาก manifest เดิมเท่านั้น)
 */
export function planImport({ importRows, essencesBySource, likesRaw, essencesRaw, existingRows = null, priorManifest = null }) {
  const rows = selectTeacherRows(importRows);
  const priorIdBySource = new Map((priorManifest?.rows || []).map((r) => [String(r.sourcePostId), String(r.id)]));
  const existingById = new Map((existingRows || []).map((r) => [String(r.id), r]));
  const existingByContent = new Map((existingRows || []).map((r) => [normalizeContentKey(r.content), r]));
  const likes = assertRoundTrip(likesRaw, 'data/viral-likes-real.json');
  const ess = assertRoundTrip(essencesRaw, 'data/viral-essences.json');

  const entries = [];
  for (const row of rows) {
    const sid = String(row._sourcePostId);
    const essSrc = essencesBySource?.[sid];
    if (!essSrc) throw new Error(`ไม่มีบัตรลักษณะของใบ ${sid} ในไฟล์ essences`);
    // ลำดับความสำคัญของ id: ไฟล์ import (ถ้าวันหลังเติม uuid มาให้) → manifest เดิม → คำนวณคงที่
    const id = String(row.id || priorIdBySource.get(sid) || deriveTeacherId(sid));
    const e = {
      sourcePostId: sid, id, row,
      insertRow: buildInsertRow(row, id),
      likesEntry: buildLikesEntry(row),
      essCard: buildEssenceCard(essSrc),
      skip: null,
    };
    if (existingRows) {
      if (existingById.has(id)) e.skip = { reason: 'id-in-table' }; // เคย insert แล้ว — เติมไฟล์ต่อได้ (งานค้าง)
      else {
        const hit = existingByContent.get(normalizeContentKey(row.content));
        if (hit) e.skip = { reason: 'content-in-table', foreignId: String(hit.id) }; // เนื้อชนใบอื่น — ข้ามทั้งใบ
      }
    } else if (priorIdBySource.has(sid)) {
      e.skip = { reason: 'manifest-prior' }; // ดูจาก manifest (offline) — ของจริงตัดสินอีกทีตอน --apply
    }
    entries.push(e);
  }
  const ids = entries.map((e) => e.id);
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dup.length) throw new Error('id ซ้ำกันเองในชุดนำเข้า: ' + [...new Set(dup)].join(','));

  const insertRows = entries.filter((e) => !e.skip).map((e) => e.insertRow);
  // ไฟล์ 2 ไฟล์: เติมเฉพาะใบที่ "มี/จะมีตัวตนในตารางด้วย id นี้" — content ชนใบอื่น (foreignId) ห้ามเติม
  const fileEntries = entries.filter((e) => !e.skip || e.skip.reason !== 'content-in-table');
  const likesAdd = {}, essAdd = {};
  for (const e of fileEntries) { likesAdd[e.id] = e.likesEntry; essAdd[e.id] = e.essCard; }
  const likesMerge = mergeLikes(likes.data, likesAdd);
  const essMerge = mergeEssences(ess.data, essAdd);
  return {
    entries, insertRows,
    skipped: entries.filter((e) => e.skip),
    likes: { fmt: likes.fmt, before: likesRaw, after: serializeJson(likesMerge.data, likes.fmt), added: likesMerge.added, skippedExisting: likesMerge.skippedExisting },
    essences: { fmt: ess.fmt, before: essencesRaw, after: serializeJson(essMerge.data, ess.fmt), added: essMerge.added, skippedExisting: essMerge.skippedExisting },
  };
}

/** manifest ฉบับรวม (merge กับของเดิม): backupDir = สำเนา "ก่อนนำเข้าครั้งแรกสุด" เสมอ — rollback คืนถึงสภาพก่อนมีครูชุดนี้ */
export function buildManifest({ prior = null, at, phase, backupDir, entries, runNote = '' }) {
  const rowsById = new Map((prior?.rows || []).map((r) => [String(r.id), r]));
  for (const e of entries) {
    rowsById.set(e.id, {
      id: e.id, sourcePostId: e.sourcePostId,
      title: String(e.row.title).slice(0, 80),
      category: e.row.category, likes: e.likesEntry.likes,
    });
  }
  return {
    kind: 'teachers-import-manifest',
    proposal: PROPOSAL_DOC,
    idNamespace: ID_NAMESPACE,
    matchedBy: MATCHED_BY,
    at, phase,
    root: ROOT,
    backupDir: prior?.backupDir || backupDir,
    lastBackupDir: backupDir,
    files: ['data/viral-likes-real.json', 'data/viral-essences.json'],
    ids: [...rowsById.keys()],
    rows: [...rowsById.values()],
    runs: [...(prior?.runs || []), { at, phase, backupDir, note: runNote }],
  };
}

/** คืนไฟล์ 2 ไฟล์จาก backup แบบไบต์ต่อไบต์ + พิสูจน์ว่าเขียนแล้วตรง backup จริง */
export function restoreDataFiles({ backupDir, root }) {
  const results = [];
  for (const name of ['viral-likes-real.json', 'viral-essences.json']) {
    const src = path.join(backupDir, name);
    const dst = path.join(root, 'data', name);
    if (!fs.existsSync(src)) throw new Error('ไม่พบไฟล์ backup: ' + src);
    const bytes = fs.readFileSync(src);
    fs.writeFileSync(dst, bytes);
    const check = fs.readFileSync(dst);
    if (!bytes.equals(check)) throw new Error('คืนไฟล์แล้วไบต์ไม่ตรง backup: ' + dst);
    results.push({ file: dst, bytes: bytes.length });
  }
  return results;
}

// ── ชั้น IO (ไม่มีข้อสอบยิงตรง — เทสห้ามแตะ DB) ───────────────────────────────────────────────────────

function loadInputs() {
  const importRows = JSON.parse(fs.readFileSync(IMPORT_FILE, 'utf8'));
  const essencesBySource = JSON.parse(fs.readFileSync(ESSENCE_FILE, 'utf8'));
  const likesRaw = fs.readFileSync(LIKES_PATH, 'utf8');
  const essencesRaw = fs.readFileSync(ESS_PATH, 'utf8');
  return { importRows, essencesBySource, likesRaw, essencesRaw };
}

function loadPriorManifest() {
  try {
    const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    return m && m.kind === 'teachers-import-manifest' ? m : null;
  } catch { return null; }
}

/** กุญแจจาก .env.local แบบเดียวกับ scripts/export-viral-examples.mjs (สคริปต์ CLI ไม่ผ่าน next) */
function readEnvKeys() {
  const env = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
  const pick = (k) => (env.match(new RegExp('^' + k + '=(.+)$', 'm'))?.[1] || '').trim().replace(/^["']|["']$/g, '');
  const url = pick('SUPABASE_URL') || pick('NEXT_PUBLIC_SUPABASE_URL');
  const key = pick('SUPABASE_SERVICE_KEY') || pick('SUPABASE_SERVICE_ROLE_KEY') || pick('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!url || !key) throw new Error('ไม่พบกุญแจ Supabase ใน .env.local');
  return { url, key };
}

/** client แบบเดียวกับ route.js (sb.from(...).insert/delete) — สร้างเฉพาะตอนต้องใช้ ไม่โหลดตอน import */
async function makeClient() {
  const { url, key } = readEnvKeys();
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function fetchAllExamples(sb) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('viral_examples').select('*')
      .order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error('ดึงตาราง viral_examples ล้ม: ' + error.message);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const fmtNum = (n) => Number(n).toLocaleString('en-US');

function printPlan(plan, { verbose = false, offline = false } = {}) {
  console.log(`\nชุดนำเข้า 8 ใบ (ข้อเสนอข้อ 4 — เจ้าของเคาะ: มี #1+#10 ไม่มี #13)${offline ? ' [offline: ยังไม่ได้เทียบตารางจริง]' : ''}`);
  for (const e of plan.entries) {
    const st = e.skip ? `ข้าม (${e.skip.reason}${e.skip.foreignId ? ' → ' + e.skip.foreignId : ''})` : 'insert';
    console.log(`- [${st}] ${e.id}`);
    console.log(`    post ${e.sourcePostId} · ${e.insertRow.category} · likes ${fmtNum(e.insertRow.engagement_likes)} · content ${e.insertRow.content.length} ตัวอักษร`);
    console.log(`    "${e.insertRow.title.slice(0, 70)}"`);
    if (verbose) {
      console.log('    แถวเต็ม:', JSON.stringify(e.insertRow, null, 2).replace(/\n/g, '\n    '));
      console.log('    likes entry:', JSON.stringify(e.likesEntry), '· บัตร:', JSON.stringify(e.essCard));
    }
  }
  const bytes = (s) => Buffer.byteLength(s, 'utf8');
  for (const [label, f, added] of [
    ['data/viral-likes-real.json', plan.likes, plan.likes.added],
    ['data/viral-essences.json', plan.essences, plan.essences.added],
  ]) {
    console.log(`\n${label}: +${added.length} key (${bytes(f.before)} → ${bytes(f.after)} ไบต์) · ของเดิมทุก key คงไบต์เดิม`);
    for (const id of added) console.log('    + ' + id);
    for (const id of f.skippedExisting) console.log('    = มีอยู่แล้ว ไม่แตะ: ' + id);
  }
  if (plan.skipped.some((e) => e.skip.reason === 'content-in-table')) {
    console.log('\nคำเตือน: มีใบที่เนื้อชนแถวเดิมคนละ id — ถูกข้ามทั้งใบ (ตาราง+ไฟล์) ต้องให้เจ้าของดูเอง');
  }
}

async function runDryRun({ verbose }) {
  const inputs = loadInputs();
  const priorManifest = loadPriorManifest();
  let existingRows = null, offline = false, note = '';
  try {
    const sb = await makeClient();
    existingRows = await fetchAllExamples(sb); // อ่านอย่างเดียว
    note = `เทียบกับตารางจริงแล้ว (${existingRows.length} แถว)`;
  } catch (err) {
    offline = true;
    note = `เทียบตารางจริงไม่ได้ (${err.message}) — จะเทียบจริงอีกครั้งตอน --apply`;
  }
  const plan = planImport({ ...inputs, existingRows, priorManifest });
  console.log('[import-new-teachers] โหมด dry-run — ไม่เขียนอะไรทั้งสิ้น');
  console.log('[import-new-teachers] ' + note);
  if (priorManifest) console.log(`[import-new-teachers] พบ manifest เดิม (${priorManifest.at}) — ใช้ id ชุดเดิม`);
  printPlan(plan, { verbose, offline });
  console.log(`\nสรุป: insert ${plan.insertRows.length} แถว · เติม likes ${plan.likes.added.length} · เติมบัตร ${plan.essences.added.length} · ข้าม ${plan.skipped.length}`);
  console.log('ถ้าตรงตามต้องการ: node scripts/import-new-teachers.mjs --apply');
}

function writeManifest(manifest) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

async function runApply() {
  if (process.env.TEACHER_IMPORT_APPLY === '0') {
    throw new Error('TEACHER_IMPORT_APPLY=0 — โหมด --apply ถูกปิดไว้ (dry-run/rollback ยังใช้ได้) เอา env นี้ออกถ้าจะนำเข้าจริง');
  }
  const inputs = loadInputs();
  const priorManifest = loadPriorManifest();
  const sb = await makeClient();
  const existingRows = await fetchAllExamples(sb);
  const plan = planImport({ ...inputs, existingRows, priorManifest });

  if (!plan.insertRows.length && !plan.likes.added.length && !plan.essences.added.length) {
    console.log('[import-new-teachers] ไม่มีอะไรต้องทำ — ครูทั้ง 8 อยู่ครบทั้งตารางและไฟล์แล้ว (ไม่เขียน backup/manifest ซ้ำ)');
    printPlan(plan, { offline: false });
    return;
  }

  // 1) backup ก่อนแตะทุกอย่าง: ดัมพ์ทั้งตาราง + สำเนาไฟล์ 2 ไฟล์
  const at = new Date().toISOString();
  const backupDir = path.join(RUN_DIR, 'backup-teachers-' + at.replace(/[:.]/g, '-'));
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(backupDir, 'viral-examples-backup.json'), JSON.stringify(existingRows, null, 1), 'utf8');
  fs.copyFileSync(LIKES_PATH, path.join(backupDir, 'viral-likes-real.json'));
  fs.copyFileSync(ESS_PATH, path.join(backupDir, 'viral-essences.json'));
  fs.writeFileSync(path.join(backupDir, 'backup-info.json'), JSON.stringify({
    at, tableRows: existingRows.length, root: ROOT,
    files: ['viral-examples-backup.json', 'viral-likes-real.json', 'viral-essences.json'],
  }, null, 2) + '\n', 'utf8');
  console.log(`[import-new-teachers] backup แล้ว: ตาราง ${existingRows.length} แถว + ไฟล์ 2 ไฟล์ → ${backupDir}`);

  // 2) insert (กันซ้ำแล้วจาก plan)
  if (plan.insertRows.length) {
    const { data, error } = await sb.from('viral_examples').insert(plan.insertRows).select('id');
    if (error) throw new Error('insert ล้ม (ยังไม่ได้แตะไฟล์ใดๆ · backup อยู่ที่ ' + backupDir + '): ' + error.message);
    const got = (data || []).map((r) => String(r.id)).sort();
    const want = plan.insertRows.map((r) => r.id).sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      throw new Error(`insert คืน id ไม่ครบ (ได้ ${got.length}/${want.length}) — ตรวจตารางแล้วค่อยตัดสินใจ (backup: ${backupDir})`);
    }
    console.log(`[import-new-teachers] insert แล้ว ${got.length} แถว`);
  } else {
    console.log('[import-new-teachers] ไม่มีแถวใหม่ต้อง insert (มีครบแล้ว) — ไปเติมไฟล์ที่ค้าง');
  }
  writeManifest(buildManifest({ prior: priorManifest, at, phase: 'db-done', backupDir, entries: plan.entries.filter((e) => !e.skip || e.skip.reason !== 'content-in-table'), runNote: `insert ${plan.insertRows.length} แถว` }));

  // 3-4) เติมไฟล์ 2 ไฟล์ (เขียนเฉพาะที่มีของใหม่)
  if (plan.likes.added.length) fs.writeFileSync(LIKES_PATH, plan.likes.after, 'utf8');
  if (plan.essences.added.length) fs.writeFileSync(ESS_PATH, plan.essences.after, 'utf8');

  // ตรวจหลังเขียน: parse ได้ + id ครบ + round-trip ยังเป๊ะ (รอบหน้าจะได้ merge ต่อได้)
  const likesBack = assertRoundTrip(fs.readFileSync(LIKES_PATH, 'utf8'), 'data/viral-likes-real.json (หลังเขียน)');
  const essBack = assertRoundTrip(fs.readFileSync(ESS_PATH, 'utf8'), 'data/viral-essences.json (หลังเขียน)');
  for (const e of plan.entries.filter((x) => !x.skip || x.skip.reason !== 'content-in-table')) {
    if (!likesBack.data.byId[e.id]) throw new Error('เขียนแล้วแต่ likes byId ไม่มี ' + e.id);
    if (!essBack.data[e.id]) throw new Error('เขียนแล้วแต่บัตรลักษณะไม่มี ' + e.id);
  }
  console.log(`[import-new-teachers] เติมไฟล์แล้ว: likes +${plan.likes.added.length} · บัตรลักษณะ +${plan.essences.added.length}`);

  // 5) manifest ฉบับจบ
  const manifest = buildManifest({ prior: priorManifest, at, phase: 'complete', backupDir, entries: plan.entries.filter((e) => !e.skip || e.skip.reason !== 'content-in-table'), runNote: `insert ${plan.insertRows.length} · likes +${plan.likes.added.length} · ess +${plan.essences.added.length}` });
  writeManifest(manifest);
  printPlan(plan, { offline: false });
  console.log(`\n[import-new-teachers] เสร็จ · manifest: ${MANIFEST_PATH}`);
  console.log(`[import-new-teachers] ถอยทั้งชุด: node scripts/import-new-teachers.mjs --rollback "${MANIFEST_PATH}"`);
  console.log('[import-new-teachers] ตรวจต่อตามข้อเสนอข้อ 5.3: export ซ้ำ + node --test tests/teacher-rank-v2.test.mjs tests/viral-shortlist.test.mjs');
}

async function runRollback(manifestArg) {
  const manifestPath = manifestArg ? path.resolve(manifestArg) : MANIFEST_PATH;
  if (!fs.existsSync(manifestPath)) throw new Error('ไม่พบ manifest: ' + manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.kind !== 'teachers-import-manifest' || !Array.isArray(manifest.ids) || !manifest.ids.length) {
    throw new Error('manifest ไม่ใช่ของงานนี้/ไม่มี ids: ' + manifestPath);
  }
  const backupDir = manifest.backupDir;
  // ตรวจของครบก่อนเริ่มลบ (ห้ามลบแล้วค่อยพบว่าคืนไฟล์ไม่ได้)
  for (const name of ['viral-likes-real.json', 'viral-essences.json']) {
    if (!fs.existsSync(path.join(backupDir, name))) throw new Error(`backup ไม่ครบ (ไม่มี ${name} ใน ${backupDir}) — ยกเลิก ไม่แตะอะไร`);
  }
  if (manifest.root && path.resolve(manifest.root) !== ROOT) {
    console.log(`[import-new-teachers] คำเตือน: manifest สร้างจาก root อื่น (${manifest.root}) — จะคืนไฟล์ลง root ปัจจุบัน (${ROOT})`);
  }
  const sb = await makeClient();
  const ids = manifest.ids.map(String);
  const { data: delRows, error: delErr } = await sb.from('viral_examples').delete().in('id', ids).select('id');
  if (delErr) throw new Error('ลบแถวล้ม: ' + delErr.message);
  const { data: leftRows, error: leftErr } = await sb.from('viral_examples').select('id').in('id', ids);
  if (leftErr) throw new Error('ตรวจหลังลบล้ม: ' + leftErr.message);
  if ((leftRows || []).length) throw new Error('ลบไม่หมด ยังเหลือในตาราง: ' + leftRows.map((r) => r.id).join(','));
  console.log(`[import-new-teachers] ลบจากตารางแล้ว ${(delRows || []).length} แถว (id ใน manifest ${ids.length} — ที่เหลือไม่มีอยู่แล้ว) · ตรวจซ้ำ: ไม่เหลือ`);

  const restored = restoreDataFiles({ backupDir, root: ROOT });
  for (const r of restored) console.log(`[import-new-teachers] คืนไฟล์ ${r.file} (${r.bytes} ไบต์ ตรง backup)`);
  console.log('[import-new-teachers] คำเตือน: ไฟล์ 2 ไฟล์ถูกคืนเป็นสภาพ ณ ตอน backup — การแก้อื่นหลังจากนั้น (ถ้ามี) หายไปด้วย');

  const updated = { ...manifest, phase: 'rolled-back', rolledBackAt: new Date().toISOString(), runs: [...(manifest.runs || []), { at: new Date().toISOString(), phase: 'rolled-back', backupDir, note: `ลบ ${(delRows || []).length} แถว + คืนไฟล์ 2 ไฟล์` }] };
  fs.writeFileSync(manifestPath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
  console.log('[import-new-teachers] ถอยเสร็จ · manifest ปรับสถานะเป็น rolled-back แล้ว');
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const known = ['--dry-run', '--apply', '--rollback', '--verbose'];
  const unknown = args.filter((a) => !known.includes(a) && a.startsWith('--'));
  const modes = args.filter((a) => ['--dry-run', '--apply', '--rollback'].includes(a));
  const mode = modes[0] || '--dry-run';
  const rollbackArg = mode === '--rollback' ? args[args.indexOf('--rollback') + 1] : undefined;
  const rollbackFile = rollbackArg && !rollbackArg.startsWith('--') ? rollbackArg : undefined;
  const positionals = args.filter((a) => !a.startsWith('--'));
  if (unknown.length || modes.length > 1 || positionals.length > (rollbackFile ? 1 : 0)) {
    console.error('ใช้: node scripts/import-new-teachers.mjs [--dry-run [--verbose] | --apply | --rollback [ไฟล์ manifest]]');
    process.exit(1);
  }
  const run = mode === '--apply' ? runApply()
    : mode === '--rollback' ? runRollback(rollbackFile)
    : runDryRun({ verbose });
  run.catch((err) => {
    console.error('[import-new-teachers] ล้ม: ' + err.message);
    process.exit(1);
  });
}
