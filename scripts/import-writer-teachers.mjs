/**
 * นำเข้า "ชุดครู writers-v1" (Nisada Jaraket · Po Ny — เพจรวมไอจีดารา) จาก data/teachers-writers-v1.json
 * WF5 · 4 ก.ย. 69 · แบบแผนความปลอดภัยยกมาจาก scripts/import-new-teachers.mjs ทั้งชุด
 *
 * โหมด:
 *   node scripts/import-writer-teachers.mjs                → dry-run (ค่าเริ่มต้น: พิมพ์แผนต่อใบ + diff ไฟล์ · ไม่เขียนอะไรเลย)
 *   node scripts/import-writer-teachers.mjs --dry-run      → เหมือนบรรทัดบน (--verbose = พิมพ์แถวเต็ม)
 *   node scripts/import-writer-teachers.mjs --apply        → backup ทั้งตาราง+ไฟล์ 2 ไฟล์ → insert ก้อนเดียว → เติมไฟล์ → manifest
 *   node scripts/import-writer-teachers.mjs --rollback [ไฟล์ manifest]
 *                                                          → ลบแถวตาม id ใน manifest + คืนไฟล์ 2 ไฟล์ไบต์ต่อไบต์ (ตรวจ backup ครบก่อนแตะ)
 *                                                            ("ถอยทั้งชุด": id ใน manifest รวมใบที่ตารางมีอยู่ก่อนรอบนี้ด้วย — ลบเฉพาะแถวที่ยังมีป้ายชุด ·
 *                                                             id ทุกตัวต้องคำนวณซ้ำได้จาก sourceUrl ในชุด ไม่งั้นหยุด · manifest ที่ถอยไปแล้วไม่รับซ้ำ ·
 *                                                             --apply หลัง rollback = วงจรใหม่ (backup/ids ใหม่ ไม่ชี้สำเนาเก่า) ·
 *                                                             ข้อจำกัด: คืนไฟล์ 2 ไฟล์ทั้งไฟล์จาก backup — คีย์ที่งานอื่นเติมหลัง --apply หายด้วย (เตือนตอนรัน))
 *   node scripts/import-writer-teachers.mjs --verify       → อ่านอย่างเดียว: นับแถวป้าย POOL_TAG ในตาราง + 28 id อยู่ครบ + ไฟล์ 2 ไฟล์ครบ
 *
 * กติกาความปลอดภัย:
 *   - อินพุตเดียว: data/teachers-writers-v1.json (สร้างโดยผู้บัญชาการ · อ่านอย่างเดียว · id ในไฟล์ต้องคำนวณซ้ำได้จาก
 *     sha256('igdara-writers-v1:' + sourceUrl) ทุกใบ — ไม่ตรง = ไฟล์เพี้ยน หยุดทันที)
 *   - ป้ายชุดครู: ตาราง viral_examples ไม่มีคอลัมน์ source/author → ใช้ tags ['igdara-writers-v1', 'author:<ชื่อ>', 'tier:master|senior']
 *   - กันซ้ำ: id มีในตารางแล้ว = ข้าม insert (แต่ยังเติมไฟล์ให้ครบ — เผื่อรอบก่อนล้มกลางทาง) ·
 *     เนื้อ (content แบบ normalize) ตรงกับแถวเดิมคนละ id = ข้ามทั้งใบ + เตือนดัง · ซ้ำกันเองในชุด = error
 *   - ไฟล์ data 2 ไฟล์: "เติมท้ายอย่างเดียว" — ของเดิมทุก key ไบต์เดิมเป๊ะ (ตรวจ round-trip ก่อนแตะ ทำไม่ได้ = หยุด)
 *     entry likes = {likes, matchedBy:'igdara-writers-v1'} · บัตรลักษณะ = {emotion, structure, themes, tone} ตามลำดับคีย์ไฟล์จริง
 *   - Supabase: client แบบเดียวกับ route.js · กุญแจจาก .env.local ตามแบบแผน scripts/export-viral-examples.mjs ·
 *     dry-run/verify อ่านอย่างเดียว (ต่อไม่ได้ = ทำงานต่อแบบ offline พร้อมบอก)
 *   - สวิตช์ถอย: TEACHER_IMPORT_APPLY=0 → โหมด --apply ปฏิเสธไม่เขียนอะไร (dry-run/rollback/verify ยังใช้ได้เสมอ)
 *   - TEACHER_IMPORT_OFFLINE=1 → dry-run/verify ไม่ต่อตาราง (เทสใช้ให้ผลนิ่ง ไม่ขึ้นกับเครือข่าย)
 *   - ชั้น IO (insert/delete/ตรวจ id คืน/backup ตาราง) ไม่มีข้อสอบใน tests/ (เทสห้ามแตะ DB) → ต้องพึ่ง --verify หลัง --apply เสมอ
 *   - ไม่มี side effect ตอน import โมดูล: main() ทำงานเฉพาะเมื่อรันตรง — เทส import pure functions ได้โดยไม่แตะ DB/ไฟล์
 *
 * เทส: tests/import-writer-teachers.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_DIR = ROOT + '-run'; // C:\tmp\news-r233 → C:\tmp\news-r233-run (แบบแผน import-new-teachers.mjs)
const MANIFEST_PATH = path.join(RUN_DIR, 'writer-teachers-import-manifest.json');
const TEACHERS_FILE = path.join(ROOT, 'data', 'teachers-writers-v1.json');
const LIKES_PATH = path.join(ROOT, 'data', 'viral-likes-real.json');
const ESS_PATH = path.join(ROOT, 'data', 'viral-essences.json');
const TAG = '[import-writer-teachers]';

// ── ค่าคงที่ของชุดนำเข้า (สเปก WF5 §1 — ห้ามแก้โดยไม่ผ่านผู้บัญชาการ) ──────────────────────────────────
export const ID_NAMESPACE = 'igdara-writers-v1';  // เกลือของ id: sha256(`${ID_NAMESPACE}:${sourceUrl}`) — ห้ามแตะหลังนำเข้าจริง
export const POOL_TAG = 'igdara-writers-v1';      // ป้ายพูลใน tags (viralFewshot TEACHER_POOL=writers-v1 กรองด้วยป้ายนี้)
export const MATCHED_BY = 'igdara-writers-v1';    // ป้ายที่มาของไลก์ใน viral-likes-real.json
export const SOURCE = 'igdara-writers-v1';        // ค่าช่อง source ในไฟล์ข้อมูล (ต้องตรงทุกใบ)
export const MANIFEST_KIND = 'writer-teachers-import-manifest';
// คอลัมน์จริงของ viral_examples ที่เขียน (สเปก §0: id, category, title, content, source_url, writing_notes, engagement_likes, tags)
export const INSERT_COLUMNS = Object.freeze(['id', 'category', 'title', 'content', 'source_url', 'writing_notes', 'engagement_likes', 'tags']);
export const ESSENCE_KEYS = Object.freeze(['emotion', 'structure', 'themes', 'tone']); // ลำดับคีย์บัตรใน data/viral-essences.json จริง
export const LIKES_FLOOR = 30000; // เกณฑ์ชุดนี้ (criteria.minReactions) — ไม่ใช่พื้น 50k ของชุด 3 ก.ย.
export const MIN_CONTENT = 200;   // viralFewshot กรอง (content||'').length > 200
export const TIERS = Object.freeze(['master', 'senior']);
export const SHELVES = Object.freeze([ // 14 ชั้นหอสมุด = LIB_SHELVES ของ viralFewshot.js (ชื่อเดียวกับ viral_examples.category)
  'ดราม่าครอบครัว', 'ข่าวเศร้า', 'ข่าวการเมือง', 'ช่วยเหลือกัน', 'สู้ชีวิต', 'ข่าวบันเทิง', 'พลิกชีวิต',
  'ข่าวเตือนใจ', 'ความรักสัตว์', 'ข่าวชาวบ้าน', 'ข่าวกีฬา', 'คนดังตกต่ำ', 'nostalgia', 'moral conflict',
]);
const DATA_FILES = Object.freeze(['viral-likes-real.json', 'viral-essences.json']);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// ── pure functions (มีข้อสอบใน tests/import-writer-teachers.test.mjs) ───────────────────────────────

/** uuid รูป v4 แบบคงที่ จาก sha256(ID_NAMESPACE + ':' + sourceUrl เต็ม) — สูตรเดียวกับ import-new-teachers แต่คีย์คือ URL */
export function deriveTeacherId(sourceUrl) {
  const src = String(sourceUrl ?? '').trim();
  if (!/^https?:\/\/\S+$/.test(src)) throw new Error(`sourceUrl ไม่ถูกต้อง: "${sourceUrl}"`);
  const hex = createHash('sha256').update(`${ID_NAMESPACE}:${src}`, 'utf8').digest('hex');
  const c = hex.slice(0, 32).split('');
  c[12] = '4'; // นิบเบิลเวอร์ชัน = 4
  c[16] = ((parseInt(c[16], 16) & 0x3) | 0x8).toString(16); // variant = 10xx (8/9/a/b)
  const s = c.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/** คีย์เทียบเนื้อแบบเดียวกับสัญญา _normLikeKey/match-real-likes (NFC + เก็บเฉพาะตัวอักษร/ตัวเลข) — เต็มความยาว */
export function normalizeContentKey(value) {
  return String(value ?? '').normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '');
}

/** tags ของแถว (รับทั้งอาเรย์และสตริง JSON/สตริงเดี่ยว) → อาเรย์สตริง */
export function parseTags(tags) {
  if (Array.isArray(tags)) return tags.map((t) => String(t));
  if (tags == null || tags === '') return [];
  if (typeof tags === 'string') {
    const s = tags.trim();
    if (s.startsWith('[')) { try { const a = JSON.parse(s); return Array.isArray(a) ? a.map((t) => String(t)) : []; } catch { return []; } }
    if (s.startsWith('{') && s.endsWith('}')) return s.slice(1, -1).split(',').map((t) => t.trim().replace(/^"|"$/g, '')).filter(Boolean); // Postgres text[] literal
    return [s];
  }
  return [];
}

/** แถวนี้เป็นครูของพูลชุดนี้ไหม (tags มี POOL_TAG) */
export function rowHasPoolTag(row) {
  return parseTags(row?.tags).includes(POOL_TAG);
}

/** บัตรลักษณะ — บังคับสคีมา+ลำดับคีย์ให้ตรงไฟล์ data/viral-essences.json เดิมเป๊ะ */
export function buildEssenceCard(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error('บัตรลักษณะไม่ใช่ object');
  const keys = Object.keys(card);
  const bad = keys.filter((k) => !ESSENCE_KEYS.includes(k));
  if (bad.length) throw new Error('บัตรลักษณะมีคีย์แปลกปลอม: ' + bad.join(','));
  if (keys.join(',') !== ESSENCE_KEYS.join(',')) throw new Error(`ลำดับคีย์บัตรต้องเป็น ${ESSENCE_KEYS.join(',')} (ได้ ${keys.join(',')})`);
  const { emotion, structure, themes, tone } = card;
  const okList = (a) => Array.isArray(a) && a.length && a.every((x) => typeof x === 'string' && x.trim());
  if (!okList(emotion)) throw new Error('emotion ต้องเป็นอาเรย์สตริงไม่ว่าง');
  if (!okList(themes)) throw new Error('themes ต้องเป็นอาเรย์สตริงไม่ว่าง');
  if (typeof structure !== 'string' || !structure.trim()) throw new Error('structure ว่าง');
  if (typeof tone !== 'string' || !tone.trim()) throw new Error('tone ว่าง');
  return { emotion: [...emotion], structure, themes: [...themes], tone };
}

/**
 * ตรวจครู 1 ใบตามสเปก §1 — ผ่าน = คืนใบเดิม · ไม่ผ่าน = โยน error บอกใบ+เหตุ
 * (id ตรงสูตร · content > 200 · likes ≥ 30000 · category ใน SHELVES · title === content.slice(0,80) ·
 *  tags มี POOL_TAG + author:/tier: · essence สคีมา/ลำดับคีย์ · writing_notes ไม่ว่าง · source === 'igdara-writers-v1')
 */
export function validateTeacher(t) {
  if (!t || typeof t !== 'object') throw new Error('ใบครูไม่ใช่ object');
  const label = `ใบ ${String(t.id ?? '?').slice(0, 8)} (${t.author ?? '?'})`;
  const fail = (msg) => { throw new Error(`${label}: ${msg}`); };
  if (t.source !== SOURCE) fail(`source ต้องเป็น '${SOURCE}' (ได้ '${t.source}')`);
  if (typeof t.author !== 'string' || !t.author.trim()) fail('author ว่าง');
  if (!TIERS.includes(t.tier)) fail(`tier ต้องเป็น ${TIERS.join('|')} (ได้ '${t.tier}')`);
  if (typeof t.sourceUrl !== 'string' || !t.sourceUrl.trim()) fail('sourceUrl ว่าง');
  if (t.source_url !== t.sourceUrl) fail('source_url ไม่เท่า sourceUrl');
  const want = deriveTeacherId(t.sourceUrl);
  if (t.id !== want) fail(`id ไม่ตรงสูตร sha256('${ID_NAMESPACE}:' + sourceUrl) (ไฟล์ ${t.id} · คำนวณ ${want}) — ไฟล์เพี้ยน`);
  if (!UUID_V4.test(t.id)) fail('id ไม่ใช่รูป uuid v4');
  const content = String(t.content ?? '');
  if (typeof t.content !== 'string' || content.length <= MIN_CONTENT) fail(`content ยาว ${content.length} ≤ ${MIN_CONTENT} — viralFewshot จะกรองทิ้ง`);
  const likes = Number(t.engagement_likes);
  if (!Number.isInteger(likes) || likes < LIKES_FLOOR) fail(`engagement_likes ${t.engagement_likes} ต่ำกว่าเกณฑ์ชุด (${LIKES_FLOOR}) หรือไม่ใช่จำนวนเต็ม`);
  if (!SHELVES.includes(t.category)) fail(`category '${t.category}' ไม่อยู่ใน 14 ชั้นหอสมุด`);
  if (t.title !== content.slice(0, 80)) fail('title ต้องเท่ากับ content.slice(0, 80) เป๊ะ');
  if (typeof t.writing_notes !== 'string' || !t.writing_notes.trim()) fail('writing_notes ว่าง');
  if (!Array.isArray(t.tags) || !t.tags.every((x) => typeof x === 'string' && x.trim())) fail('tags ต้องเป็นอาเรย์สตริงไม่ว่าง');
  if (!t.tags.includes(POOL_TAG)) fail(`tags ไม่มีป้ายพูล '${POOL_TAG}'`);
  if (!t.tags.includes('author:' + t.author)) fail(`tags ไม่มี 'author:${t.author}'`);
  if (!t.tags.includes('tier:' + t.tier)) fail(`tags ไม่มี 'tier:${t.tier}'`);
  try { buildEssenceCard(t.essence); } catch (err) { fail('essence: ' + err.message); }
  return t;
}

/** แถว insert ตามคอลัมน์จริงเป๊ะ (ประกอบใหม่ทีละช่อง — คีย์ author/tier/essence/reactions ไม่หลุดเข้าตาราง) */
export function buildInsertRow(t) {
  return {
    id: String(t.id),
    category: String(t.category),
    title: String(t.title),
    content: String(t.content),
    source_url: t.source_url ?? null,
    writing_notes: String(t.writing_notes),
    engagement_likes: Number(t.engagement_likes),
    tags: (Array.isArray(t.tags) ? t.tags : []).map((x) => String(x)),
  };
}

/** entry ของ data/viral-likes-real.json byId — โครง/ลำดับคีย์เดียวกับ entry เดิม ({likes, matchedBy}) */
export function buildLikesEntry(t) {
  const likes = Number(t.engagement_likes);
  if (!Number.isFinite(likes) || likes <= 0) throw new Error('ไลก์ไม่ถูกต้อง: ' + likes);
  return { likes, matchedBy: MATCHED_BY };
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

/** รับไฟล์ข้อมูล (object {kind, teachers:[…]} หรืออาเรย์ครูตรงๆ) → อาเรย์ครูที่ตรวจแล้วทุกใบ + กันซ้ำกันเองในชุด */
export function selectTeachers(input) {
  const list = Array.isArray(input) ? input : input?.teachers;
  if (!Array.isArray(list) || !list.length) throw new Error('ไฟล์ข้อมูลว่าง/ไม่มี teachers');
  if (!Array.isArray(input)) {
    if (input.kind !== 'teachers-writers-v1') throw new Error(`kind ของไฟล์ต้องเป็น 'teachers-writers-v1' (ได้ '${input.kind}')`);
    if (input.source !== SOURCE) throw new Error(`source ของไฟล์ต้องเป็น '${SOURCE}' (ได้ '${input.source}')`);
  }
  const teachers = list.map(validateTeacher);
  const seenId = new Map(), seenContent = new Map(), seenUrl = new Map();
  for (const t of teachers) {
    if (seenId.has(t.id)) throw new Error(`id ซ้ำกันเองในชุด: ${t.id}`);
    seenId.set(t.id, t);
    const ck = normalizeContentKey(t.content);
    if (seenContent.has(ck)) throw new Error(`เนื้อซ้ำกันเองในชุด: ${t.id.slice(0, 8)} กับ ${seenContent.get(ck).id.slice(0, 8)}`);
    seenContent.set(ck, t);
    if (seenUrl.has(t.sourceUrl)) throw new Error(`sourceUrl ซ้ำกันเองในชุด: ${t.sourceUrl}`);
    seenUrl.set(t.sourceUrl, t);
  }
  return teachers;
}

/**
 * แผนนำเข้าทั้งก้อน (pure): ตรวจใบ → กันซ้ำ → merge ไฟล์ 2 ไฟล์ (ยังไม่เขียนอะไร)
 * existingRows = ดัมพ์ตารางจริง (null = offline: ตัดสินซ้ำจาก manifest เดิมเท่านั้น)
 */
export function planImport({ teachers, likesRaw, essencesRaw, existingRows = null, priorManifest = null }) {
  const rows = selectTeachers(teachers);
  const priorIds = new Set((priorManifest?.ids || []).map(String));
  const existingById = new Map((existingRows || []).map((r) => [String(r.id), r]));
  const existingByContent = new Map((existingRows || []).map((r) => [normalizeContentKey(r.content), r]));
  const likes = assertRoundTrip(likesRaw, 'data/viral-likes-real.json');
  const ess = assertRoundTrip(essencesRaw, 'data/viral-essences.json');

  const entries = [];
  const warnings = [];
  for (const t of rows) {
    const e = {
      id: t.id, teacher: t,
      insertRow: buildInsertRow(t),
      likesEntry: buildLikesEntry(t),
      essCard: buildEssenceCard(t.essence),
      skip: null,
    };
    if (existingRows) {
      if (existingById.has(t.id)) e.skip = { reason: 'id-in-table' }; // เคย insert แล้ว — เติมไฟล์ต่อได้ (งานค้าง)
      else {
        const hit = existingByContent.get(normalizeContentKey(t.content));
        if (hit) {
          e.skip = { reason: 'content-in-table', foreignId: String(hit.id) }; // เนื้อชนใบอื่น — ข้ามทั้งใบ
          warnings.push(`ใบ ${t.id.slice(0, 8)} (${t.author}) เนื้อชนแถวเดิม id ${String(hit.id)} — ข้ามทั้งใบ (ตาราง+ไฟล์) ต้องให้ผู้บัญชาการดูเอง`);
        }
      }
    } else if (priorIds.has(t.id)) {
      e.skip = { reason: 'manifest-prior' }; // ดูจาก manifest (offline) — ของจริงตัดสินอีกทีตอน --apply
    }
    entries.push(e);
  }
  const insertRows = entries.filter((e) => !e.skip).map((e) => e.insertRow);
  // ไฟล์ 2 ไฟล์: เติมเฉพาะใบที่ "มี/จะมีตัวตนในตารางด้วย id นี้" — content ชนใบอื่น (foreignId) ห้ามเติม
  const fileEntries = entries.filter((e) => !e.skip || e.skip.reason !== 'content-in-table');
  const likesAdd = {}, essAdd = {};
  for (const e of fileEntries) { likesAdd[e.id] = e.likesEntry; essAdd[e.id] = e.essCard; }
  const likesMerge = mergeLikes(likes.data, likesAdd);
  const essMerge = mergeEssences(ess.data, essAdd);
  return {
    entries, insertRows, warnings,
    skipped: entries.filter((e) => e.skip),
    fileEntries,
    likes: { fmt: likes.fmt, before: likesRaw, after: serializeJson(likesMerge.data, likes.fmt), added: likesMerge.added, skippedExisting: likesMerge.skippedExisting },
    essences: { fmt: ess.fmt, before: essencesRaw, after: serializeJson(essMerge.data, ess.fmt), added: essMerge.added, skippedExisting: essMerge.skippedExisting },
  };
}

/** manifest ฉบับรวม (merge กับของเดิม): backupDir = สำเนา "ก่อนนำเข้าครั้งแรกสุด" เสมอ — rollback คืนถึงสภาพก่อนมีครูชุดนี้ */
export function buildManifest({ prior = null, at, phase, backupDir, entries, runNote = '' }) {
  const rowsById = new Map((prior?.rows || []).map((r) => [String(r.id), r]));
  for (const e of entries) {
    const t = e.teacher;
    rowsById.set(e.id, {
      id: e.id, author: t.author, tier: t.tier, sourceUrl: t.sourceUrl,
      title: String(t.title).slice(0, 80),
      category: t.category, likes: e.likesEntry.likes,
    });
  }
  return {
    kind: MANIFEST_KIND,
    dataFile: 'data/teachers-writers-v1.json',
    idNamespace: ID_NAMESPACE,
    poolTag: POOL_TAG,
    matchedBy: MATCHED_BY,
    at, phase,
    root: ROOT,
    backupDir: prior?.backupDir || backupDir,
    lastBackupDir: backupDir,
    files: DATA_FILES.map((f) => 'data/' + f),
    ids: [...rowsById.keys()],
    rows: [...rowsById.values()],
    runs: [...(prior?.runs || []), { at, phase, backupDir, note: runNote }],
  };
}

/** คืนไฟล์ 2 ไฟล์จาก backup แบบไบต์ต่อไบต์ + พิสูจน์ว่าเขียนแล้วตรง backup จริง (ตรวจว่ามีครบก่อนแตะไฟล์แรก) */
export function restoreDataFiles({ backupDir, root }) {
  for (const name of DATA_FILES) {
    const src = path.join(backupDir, name);
    if (!fs.existsSync(src)) throw new Error('ไม่พบไฟล์ backup: ' + src);
  }
  const results = [];
  for (const name of DATA_FILES) {
    const src = path.join(backupDir, name);
    const dst = path.join(root, 'data', name);
    const bytes = fs.readFileSync(src);
    fs.writeFileSync(dst, bytes);
    const check = fs.readFileSync(dst);
    if (!bytes.equals(check)) throw new Error('คืนไฟล์แล้วไบต์ไม่ตรง backup: ' + dst);
    results.push({ file: dst, bytes: bytes.length });
  }
  return results;
}

/** รายงาน --verify (pure): ตาราง (null = offline) + ไฟล์ 2 ไฟล์ เทียบกับ 28 id ของชุด */
export function buildVerifyReport({ teachers, likesRaw, essencesRaw, existingRows = null }) {
  const rows = selectTeachers(teachers);
  const ids = rows.map((t) => t.id);
  const likesData = JSON.parse(likesRaw);
  const essData = JSON.parse(essencesRaw);
  const likesMissing = ids.filter((id) => !likesData?.byId?.[id]);
  const likesWrong = ids.filter((id) => likesData?.byId?.[id] && (Number(likesData.byId[id].likes) !== Number(rows.find((t) => t.id === id).engagement_likes) || likesData.byId[id].matchedBy !== MATCHED_BY));
  const essMissing = ids.filter((id) => !essData?.[id]);
  let table = null;
  if (existingRows) {
    const byId = new Map(existingRows.map((r) => [String(r.id), r]));
    const tagged = existingRows.filter(rowHasPoolTag);
    const missing = ids.filter((id) => !byId.has(id));
    const untagged = ids.filter((id) => byId.has(id) && !rowHasPoolTag(byId.get(id)));
    const strangers = tagged.filter((r) => !ids.includes(String(r.id))).map((r) => String(r.id));
    table = { totalRows: existingRows.length, taggedRows: tagged.length, missing, untagged, strangers };
  }
  const ok = !likesMissing.length && !likesWrong.length && !essMissing.length && (!table || (!table.missing.length && !table.untagged.length));
  return { total: ids.length, ids, table, likesMissing, likesWrong, essMissing, ok };
}

// ── ชั้น IO (ไม่มีข้อสอบยิงตรง — เทสห้ามแตะ DB) ───────────────────────────────────────────────────────

function loadInputs() {
  const teachers = JSON.parse(fs.readFileSync(TEACHERS_FILE, 'utf8'));
  const likesRaw = fs.readFileSync(LIKES_PATH, 'utf8');
  const essencesRaw = fs.readFileSync(ESS_PATH, 'utf8');
  return { teachers, likesRaw, essencesRaw };
}

/** pure: manifest เดิมใช้ต่อวงจรได้ไหม — ถอยไปแล้ว (phase rolled-back) = เริ่มวงจรใหม่ (backupDir/ids ของรอบใหม่ · ไม่ชี้สำเนาเก่าที่ล้าสมัย) */
export function isUsablePriorManifest(m) {
  return !!(m && m.kind === MANIFEST_KIND && m.phase !== 'rolled-back');
}

function loadPriorManifest() {
  try {
    const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    if (m && m.kind === MANIFEST_KIND && m.phase === 'rolled-back') {
      console.log(`${TAG} manifest เดิมถอยไปแล้ว (${m.rolledBackAt || '?'}) — ไม่ใช้ตัดสิน เริ่มวงจรใหม่`);
      return null;
    }
    return isUsablePriorManifest(m) ? m : null;
  } catch { return null; }
}

/** pure: id ที่จะถอยต้องเป็นของชุดนี้จริง (คำนวณซ้ำได้จาก sourceUrl ใน manifest.rows หรืออยู่ในไฟล์ชุด) — id แปลกปลอม = โยน ไม่ลบอะไร */
export function assertRollbackIds(ids, manifest, teachersFileIds = []) {
  const ok = new Set([...(manifest.rows || []).map((r) => (r.sourceUrl ? deriveTeacherId(r.sourceUrl) : null)).filter(Boolean), ...teachersFileIds.map(String)]);
  const alien = ids.map(String).filter((id) => !ok.has(id));
  if (!ok.size) throw new Error('manifest ไม่มี rows/sourceUrl และไม่มีไฟล์ชุด — พิสูจน์ id ไม่ได้ ยกเลิก ไม่ลบอะไร');
  if (alien.length) throw new Error(`manifest มี id นอกชุด ${alien.length} ตัว (เช่น ${alien.slice(0, 3).join(', ')}) — ยกเลิก ไม่ลบอะไร (manifest ถูกแก้/เพี้ยน?)`);
  return ids.map(String);
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

/** client แบบเดียวกับ route.js — สร้างเฉพาะตอนต้องใช้ ไม่โหลดตอน import */
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

/** อ่านตารางแบบไม่ล้ม: ต่อไม่ได้ = null + เหตุ (dry-run/verify ทำงานต่อแบบ offline) */
async function tryFetchTable() {
  if (process.env.TEACHER_IMPORT_OFFLINE === '1') return { rows: null, note: 'TEACHER_IMPORT_OFFLINE=1 — ไม่ต่อตาราง ทำงานแบบ offline' };
  try {
    const sb = await makeClient();
    const rows = await fetchAllExamples(sb); // อ่านอย่างเดียว
    return { rows, note: `เทียบกับตารางจริงแล้ว (${rows.length} แถว)` };
  } catch (err) {
    return { rows: null, note: `เทียบตารางจริงไม่ได้ (${err.message}) — ทำงานแบบ offline` };
  }
}

const fmtNum = (n) => Number(n).toLocaleString('en-US');

function printPlan(plan, { verbose = false, offline = false } = {}) {
  const byAuthor = {};
  for (const e of plan.entries) byAuthor[e.teacher.author] = (byAuthor[e.teacher.author] || 0) + 1;
  const who = Object.entries(byAuthor).map(([a, n]) => `${a} ${n}`).join(' · ');
  console.log(`\nชุดครู writers-v1 ${plan.entries.length} ใบ (${who})${offline ? ' [offline: ยังไม่ได้เทียบตารางจริง]' : ''}`);
  for (const e of plan.entries) {
    const t = e.teacher;
    const st = e.skip ? `skip:${e.skip.reason}${e.skip.foreignId ? '→' + e.skip.foreignId : ''}` : 'insert';
    console.log(`- ${e.id.slice(0, 8)} · ${t.author} · ${t.tier} · ${t.category} · ${fmtNum(t.engagement_likes)} ไลก์ · ${t.content.length} ตัวอักษร · [${st}]`);
    if (verbose) {
      console.log(`    "${t.title}"`);
      console.log('    แถวเต็ม:', JSON.stringify(e.insertRow, null, 2).replace(/\n/g, '\n    '));
      console.log('    likes entry:', JSON.stringify(e.likesEntry), '· บัตร:', JSON.stringify(e.essCard));
    }
  }
  const bytes = (s) => Buffer.byteLength(s, 'utf8');
  for (const [label, f] of [['data/viral-likes-real.json', plan.likes], ['data/viral-essences.json', plan.essences]]) {
    console.log(`\n${label}: +${f.added.length} key (${bytes(f.before)} → ${bytes(f.after)} ไบต์) · ของเดิมทุก key คงไบต์เดิม`);
    for (const id of f.added) console.log('    + ' + id);
    for (const id of f.skippedExisting) console.log('    = มีอยู่แล้ว ไม่แตะ: ' + id);
  }
  for (const w of plan.warnings) console.log('\nคำเตือน: ' + w);
}

export function summarizePlan(plan) {
  const count = (list) => { const c = { master: 0, senior: 0 }; for (const e of list) c[e.teacher.tier]++; return c; };
  return { insert: count(plan.entries.filter((e) => !e.skip)), set: count(plan.entries) };
}

function printSummary(plan) {
  const { insert, set } = summarizePlan(plan); // วงเล็บหลัง insert นับเฉพาะใบที่จะ insert จริง (ไม่รวม skip) · "ในชุด" = ทั้งไฟล์
  console.log(`\nสรุป: insert ${plan.insertRows.length} แถว (master ${insert.master} · senior ${insert.senior}) · ในชุดทั้งหมด master ${set.master} · senior ${set.senior} · เติม likes ${plan.likes.added.length} · เติมบัตร ${plan.essences.added.length} · ข้าม ${plan.skipped.length}`);
}

export async function runDryRun({ verbose = false } = {}) {
  const inputs = loadInputs();
  const priorManifest = loadPriorManifest();
  const { rows: existingRows, note } = await tryFetchTable();
  const offline = !existingRows;
  const plan = planImport({ ...inputs, existingRows, priorManifest });
  console.log(`${TAG} โหมด dry-run — ไม่เขียนอะไรทั้งสิ้น`);
  console.log(`${TAG} ${note}`);
  if (priorManifest) console.log(`${TAG} พบ manifest เดิม (${priorManifest.at} · ${priorManifest.phase}) — ${offline ? 'ใช้ตัดสินใบที่เคยนำเข้า' : 'ตารางจริงเป็นผู้ตัดสิน'}`);
  if (existingRows) console.log(`${TAG} ตารางมีแถวป้าย '${POOL_TAG}' อยู่แล้ว ${existingRows.filter(rowHasPoolTag).length} แถว`);
  printPlan(plan, { verbose, offline });
  printSummary(plan);
  console.log('ถ้าตรงตามต้องการ: node scripts/import-writer-teachers.mjs --apply (ผู้บัญชาการ/เจ้าของเท่านั้น)');
}

function writeManifest(manifest) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

/** --apply: ยาม TEACHER_IMPORT_APPLY=0 อยู่บรรทัดแรก — ปฏิเสธก่อนอ่าน/แตะอะไรทั้งสิ้น */
/** pure: id ที่ insert คืนต้องตรงชุดที่ส่งเป๊ะ (ไม่ขาด ไม่เกิน ไม่แปลกปลอม) — ไม่ตรง = โยน (เทสข้อ 12) */
export function assertInsertReturned(data, insertRows, backupDir = '?') {
  const got = (data || []).map((r) => String(r.id)).sort();
  const want = insertRows.map((r) => String(r.id)).sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`insert คืน id ไม่ครบ (ได้ ${got.length}/${want.length}) — ตรวจตารางแล้วค่อยตัดสินใจ (backup: ${backupDir})`);
  }
  return got;
}

export async function runApply({ env = process.env, client = makeClient } = {}) {
  // ยามต้องมาก่อน IO ทุกชนิด (ไม่อ่านไฟล์ ไม่ต่อ DB) — เทสข้อ 6 ส่ง client ที่โยนทันทีเพื่อพิสูจน์ลำดับนี้
  if (env.TEACHER_IMPORT_APPLY === '0') {
    throw new Error('TEACHER_IMPORT_APPLY=0 — โหมด --apply ถูกปิดไว้ (dry-run/rollback/verify ยังใช้ได้) เอา env นี้ออกถ้าจะนำเข้าจริง');
  }
  const inputs = loadInputs();
  const priorManifest = loadPriorManifest();
  const sb = await client();
  const existingRows = await fetchAllExamples(sb);
  const plan = planImport({ ...inputs, existingRows, priorManifest });

  if (!plan.insertRows.length && !plan.likes.added.length && !plan.essences.added.length) {
    console.log(`${TAG} ไม่มีอะไรต้องทำ — ครูทั้ง ${plan.entries.length} ใบอยู่ครบทั้งตารางและไฟล์แล้ว (ไม่เขียน backup/manifest ซ้ำ)`);
    printPlan(plan, { offline: false });
    return;
  }

  // 1) backup ก่อนแตะทุกอย่าง: ดัมพ์ทั้งตาราง + สำเนาไฟล์ 2 ไฟล์
  const at = new Date().toISOString();
  const backupDir = path.join(RUN_DIR, 'backup-writer-teachers-' + at.replace(/[:.]/g, '-'));
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(backupDir, 'viral-examples-backup.json'), JSON.stringify(existingRows, null, 1), 'utf8');
  fs.copyFileSync(LIKES_PATH, path.join(backupDir, 'viral-likes-real.json'));
  fs.copyFileSync(ESS_PATH, path.join(backupDir, 'viral-essences.json'));
  fs.writeFileSync(path.join(backupDir, 'backup-info.json'), JSON.stringify({
    at, tableRows: existingRows.length, root: ROOT, poolTag: POOL_TAG,
    files: ['viral-examples-backup.json', ...DATA_FILES],
  }, null, 2) + '\n', 'utf8');
  console.log(`${TAG} backup แล้ว: ตาราง ${existingRows.length} แถว + ไฟล์ 2 ไฟล์ → ${backupDir}`);

  // 2) insert เป็นก้อนเดียว (กันซ้ำแล้วจาก plan) + ตรวจ id คืนครบ
  if (plan.insertRows.length) {
    const { data, error } = await sb.from('viral_examples').insert(plan.insertRows).select('id');
    if (error) throw new Error('insert ล้ม (ยังไม่ได้แตะไฟล์ใดๆ · backup อยู่ที่ ' + backupDir + '): ' + error.message);
    const got = assertInsertReturned(data, plan.insertRows, backupDir);
    console.log(`${TAG} insert แล้ว ${got.length} แถว`);
  } else {
    console.log(`${TAG} ไม่มีแถวใหม่ต้อง insert (มีครบแล้ว) — ไปเติมไฟล์ที่ค้าง`);
  }
  writeManifest(buildManifest({ prior: priorManifest, at, phase: 'db-done', backupDir, entries: plan.fileEntries, runNote: `insert ${plan.insertRows.length} แถว` }));

  // 3-4) เติมไฟล์ 2 ไฟล์ (เขียนเฉพาะที่มีของใหม่)
  if (plan.likes.added.length) fs.writeFileSync(LIKES_PATH, plan.likes.after, 'utf8');
  if (plan.essences.added.length) fs.writeFileSync(ESS_PATH, plan.essences.after, 'utf8');

  // ตรวจหลังเขียน: parse ได้ + id ครบ + round-trip ยังเป๊ะ (รอบหน้าจะได้ merge ต่อได้)
  const likesBack = assertRoundTrip(fs.readFileSync(LIKES_PATH, 'utf8'), 'data/viral-likes-real.json (หลังเขียน)');
  const essBack = assertRoundTrip(fs.readFileSync(ESS_PATH, 'utf8'), 'data/viral-essences.json (หลังเขียน)');
  for (const e of plan.fileEntries) {
    if (!likesBack.data.byId[e.id]) throw new Error('เขียนแล้วแต่ likes byId ไม่มี ' + e.id);
    if (!essBack.data[e.id]) throw new Error('เขียนแล้วแต่บัตรลักษณะไม่มี ' + e.id);
  }
  console.log(`${TAG} เติมไฟล์แล้ว: likes +${plan.likes.added.length} · บัตรลักษณะ +${plan.essences.added.length}`);

  // 5) manifest ฉบับจบ
  const manifest = buildManifest({ prior: priorManifest, at, phase: 'complete', backupDir, entries: plan.fileEntries, runNote: `insert ${plan.insertRows.length} · likes +${plan.likes.added.length} · ess +${plan.essences.added.length}` });
  writeManifest(manifest);
  printPlan(plan, { offline: false });
  printSummary(plan);
  console.log(`\n${TAG} เสร็จ · manifest: ${MANIFEST_PATH}`);
  console.log(`${TAG} ถอยทั้งชุด: node scripts/import-writer-teachers.mjs --rollback "${MANIFEST_PATH}"`);
  console.log(`${TAG} ตรวจซ้ำ: node scripts/import-writer-teachers.mjs --verify`);
}

export async function runRollback(manifestArg, { client = makeClient, root = ROOT, teachersFile = TEACHERS_FILE } = {}) {
  const manifestPath = manifestArg ? path.resolve(manifestArg) : MANIFEST_PATH;
  if (!fs.existsSync(manifestPath)) throw new Error('ไม่พบ manifest: ' + manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.kind !== MANIFEST_KIND || !Array.isArray(manifest.ids) || !manifest.ids.length) {
    throw new Error('manifest ไม่ใช่ของงานนี้/ไม่มี ids: ' + manifestPath);
  }
  if (manifest.phase === 'rolled-back') {
    throw new Error(`manifest นี้ถอยไปแล้วเมื่อ ${manifest.rolledBackAt || '?'} — ไม่ทำซ้ำ (กันเขียนทับไฟล์ data ด้วย backup เก่าอีกรอบ)`);
  }
  // ยาม id: ทุก id ต้องคำนวณซ้ำได้จาก sourceUrl ในชุด — manifest ถูกแก้/เพี้ยน = หยุดก่อนแตะตาราง
  let fileIds = [];
  try { fileIds = selectTeachers(JSON.parse(fs.readFileSync(teachersFile, 'utf8'))).map((t) => t.id); } catch { fileIds = []; }
  const ids = assertRollbackIds(manifest.ids, manifest, fileIds);
  const backupDir = manifest.backupDir;
  // ตรวจของครบก่อนเริ่มลบ (ห้ามลบแล้วค่อยพบว่าคืนไฟล์ไม่ได้)
  for (const name of DATA_FILES) {
    if (!fs.existsSync(path.join(backupDir, name))) throw new Error(`backup ไม่ครบ (ไม่มี ${name} ใน ${backupDir}) — ยกเลิก ไม่แตะอะไร`);
  }
  if (manifest.root && path.resolve(manifest.root) !== ROOT) {
    console.log(`${TAG} คำเตือน: manifest สร้างจาก root อื่น (${manifest.root}) — จะคืนไฟล์ลง root ปัจจุบัน (${ROOT})`);
  }
  const sb = await client();
  console.log(`${TAG} ถอยทั้งชุด: จะลบ id ใน manifest (${ids.length}) เฉพาะแถวที่มีป้าย '${POOL_TAG}' รวมแถวที่มีอยู่ก่อนรอบ --apply นี้ (id คำนวณจาก URL คงที่ จึงมาจากสคริปต์นี้เท่านั้น)`);
  // ลบเฉพาะแถวที่ยังมีป้ายชุด — แถว id ตรงแต่ไม่มีป้าย (ถูกแก้มือ) = รายงาน ไม่ลบ
  const { data: curRows, error: curErr } = await sb.from('viral_examples').select('id, tags').in('id', ids);
  if (curErr) throw new Error('อ่านแถวก่อนลบล้ม: ' + curErr.message);
  const tagged = (curRows || []).filter(rowHasPoolTag).map((r) => String(r.id));
  const untagged = (curRows || []).filter((r) => !rowHasPoolTag(r)).map((r) => String(r.id));
  for (const id of untagged) console.log(`${TAG} ⚠️ ไม่ลบ ${id} — id อยู่ในชุดแต่แถวไม่มีป้าย ${POOL_TAG} (ถูกแก้มือ?) ตรวจเอง`);
  let delCount = 0;
  if (tagged.length) {
    const { data: delRows, error: delErr } = await sb.from('viral_examples').delete().in('id', tagged).select('id');
    if (delErr) throw new Error('ลบแถวล้ม: ' + delErr.message);
    delCount = (delRows || []).length;
    const { data: leftRows, error: leftErr } = await sb.from('viral_examples').select('id').in('id', tagged);
    if (leftErr) throw new Error('ตรวจหลังลบล้ม: ' + leftErr.message);
    if ((leftRows || []).length) throw new Error('ลบไม่หมด ยังเหลือในตาราง: ' + leftRows.map((r) => r.id).join(','));
  }
  console.log(`${TAG} ลบจากตารางแล้ว ${delCount} แถว (id ใน manifest ${ids.length} · มีในตาราง ${(curRows || []).length} · ไม่มีป้าย-ไม่ลบ ${untagged.length}) · ตรวจซ้ำ: ไม่เหลือ`);

  const restored = restoreDataFiles({ backupDir, root });
  for (const r of restored) console.log(`${TAG} คืนไฟล์ ${r.file} (${r.bytes} ไบต์ ตรง backup)`);
  console.log(`${TAG} คำเตือน: ไฟล์ 2 ไฟล์ถูกคืนเป็นสภาพ ณ ตอน backup — การแก้อื่นหลังจากนั้น (ถ้ามี) หายไปด้วย`);

  const now = new Date().toISOString();
  const updated = { ...manifest, phase: 'rolled-back', rolledBackAt: now, runs: [...(manifest.runs || []), { at: now, phase: 'rolled-back', backupDir, note: `ลบ ${delCount} แถว + คืนไฟล์ 2 ไฟล์` }] };
  fs.writeFileSync(manifestPath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
  console.log(`${TAG} ถอยเสร็จ · manifest ปรับสถานะเป็น rolled-back แล้ว`);
}

/** --verify: อ่านอย่างเดียว — ตาราง (ถ้าต่อได้) + ไฟล์ 2 ไฟล์ · ไม่ครบ = exit 1 (ใช้เป็นด่านหลัง --apply) */
export async function runVerify() {
  const inputs = loadInputs();
  const { rows: existingRows, note } = await tryFetchTable();
  const r = buildVerifyReport({ ...inputs, existingRows });
  console.log(`${TAG} โหมด verify — อ่านอย่างเดียว`);
  console.log(`${TAG} ${note}`);
  if (r.table) {
    console.log(`ตาราง: แถวป้าย '${POOL_TAG}' ${r.table.taggedRows} จาก ${r.table.totalRows} แถว · ชุด ${r.total} id อยู่ครบ ${r.total - r.table.missing.length}/${r.total}`);
    for (const id of r.table.missing) console.log('    ขาดในตาราง: ' + id);
    for (const id of r.table.untagged) console.log('    อยู่ในตารางแต่ไม่มีป้ายพูล: ' + id);
    for (const id of r.table.strangers) console.log('    แถวมีป้ายพูลแต่ไม่อยู่ในชุด: ' + id);
  } else {
    console.log('ตาราง: ตรวจไม่ได้ (offline)');
  }
  console.log(`data/viral-likes-real.json: มี ${r.total - r.likesMissing.length}/${r.total}${r.likesWrong.length ? ` · ค่าไม่ตรง ${r.likesWrong.length}` : ''}`);
  for (const id of r.likesMissing) console.log('    ขาด likes: ' + id);
  for (const id of r.likesWrong) console.log('    likes ไม่ตรงไฟล์ข้อมูล/matchedBy: ' + id);
  console.log(`data/viral-essences.json: มี ${r.total - r.essMissing.length}/${r.total}`);
  for (const id of r.essMissing) console.log('    ขาดบัตร: ' + id);
  console.log(r.ok ? `\n${TAG} verify ผ่าน${r.table ? '' : ' (เฉพาะไฟล์ — ตารางยังไม่ได้ตรวจ)'}` : `\n${TAG} verify ไม่ผ่าน — ดูรายการด้านบน`);
  if (!r.ok) process.exitCode = 1;
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const MODES = ['--dry-run', '--apply', '--rollback', '--verify'];
  const known = [...MODES, '--verbose'];
  const unknown = args.filter((a) => !known.includes(a) && a.startsWith('--'));
  const modes = args.filter((a) => MODES.includes(a));
  const mode = modes[0] || '--dry-run';
  const rollbackArg = mode === '--rollback' ? args[args.indexOf('--rollback') + 1] : undefined;
  const rollbackFile = rollbackArg && !rollbackArg.startsWith('--') ? rollbackArg : undefined;
  const positionals = args.filter((a) => !a.startsWith('--'));
  if (unknown.length || modes.length > 1 || positionals.length > (rollbackFile ? 1 : 0)) {
    console.error('ใช้: node scripts/import-writer-teachers.mjs [--dry-run [--verbose] | --apply | --rollback [ไฟล์ manifest] | --verify]');
    process.exit(1);
  }
  const run = mode === '--apply' ? runApply()
    : mode === '--rollback' ? runRollback(rollbackFile)
    : mode === '--verify' ? runVerify()
    : runDryRun({ verbose });
  run.catch((err) => {
    console.error(`${TAG} ล้ม: ` + err.message);
    process.exit(1);
  });
}
