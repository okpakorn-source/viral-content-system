/**
 * plan-schema.mjs — ตัวตรวจ + เครื่องมือกลางของแผนคลังการ์ด v2 (F13)
 * ตามแบบ docs/proposals/NEWS-CARD-LIBRARY-DESIGN-FINAL-3sep69.md + รูปแบบไฟล์แผนกลาง:
 *   data/card-library-v2/plan-cards.json  (สาย cards เขียน: surgery/rename/newCards)
 *   data/card-library-v2/plan-ops.json    (สาย ops เขียน: sweep/archive/names/merge/viralScoreRemap/evidence)
 *
 * หน้าที่ไฟล์นี้:
 *   1) validator ของแผนทั้งสองไฟล์ — id ต้องมีใน store จริง · field ต้องอยู่ในสคีมาการ์ดจริง ·
 *      regex คอมไพล์ได้ · จำนวนตามแบบ (surgery 11 · rename 5 · newCards 3 · archive 27 ·
 *      names 27 · merge 2 · viralScoreRemap 19)
 *   2) helper กลางที่ backup/build-arms/migrate/restore ใช้ร่วมกัน (โหลด env/store, canonical id,
 *      canonical JSON แบบ deterministic, sha256)
 *
 * ใช้เดี่ยว: node scripts/card-status/plan-schema.mjs [--plans-dir <dir>] [--from <cards.json>] [--no-counts]
 *   (ค่าเริ่มต้นตรวจกับ mirror data/prompt-library.json — build-arms/migrate จะตรวจซ้ำกับแหล่งจริงที่ตัวเองใช้)
 *
 * ไฟล์นี้ห้าม import อะไรจาก src/ ระดับบน (เทสโหลดตรงด้วย node:test) — โค้ดที่แตะ store จริงอยู่หลัง
 * dynamic import ใน getRealStore() เท่านั้น และไม่มีการเขียน store ใดๆ ในไฟล์นี้
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RUN_DIR = `${ROOT}-run`; // C:\tmp\news-r233 → C:\tmp\news-r233-run
export const STORE_NAME = 'prompt-library';
export const PLANS_DIR_DEFAULT = path.join(ROOT, 'data', 'card-library-v2');
export const PLAN_CARDS_FILE = 'plan-cards.json';
export const PLAN_OPS_FILE = 'plan-ops.json';
export const NEW_CARD_ID_NAMESPACE = 'cardlib-v2-3sep69'; // เกลือคงที่ของ id ใบใหม่ — ห้ามแก้หลัง import จริง

// จำนวนตามแบบ F4/F5/F8/F6/F10/F9/F3 (11/5/3/27/27/2/19)
export const EXPECTED_COUNTS = Object.freeze({
  surgery: 11, rename: 5, newCards: 3, archive: 27, names: 27, merge: 2, viralScoreRemap: 19,
});

// สคีมาการ์ดจริง — สำรวจจาก data/prompt-library.json 201 ใบ (3 ก.ย. 69): 27 field หลัก + updatedAt/lastUsedAt
// + status (ใหม่ตาม F6/F8 — ยังไม่มีใน store วันนี้)
export const CARD_FIELD_TYPES = Object.freeze({
  id: 'string', promptName: 'string', promptText: 'string', category: 'string', tone: 'string',
  hookStyle: 'string', structure: 'string', writingStyle: 'string', emotionalType: 'string',
  ctaStyle: 'string', shareTrigger: 'string', commentTrigger: 'string', exampleContent: 'string',
  visualImagination: 'string', narrativeArchetype: 'string', sourceContentId: 'string',
  doNot: 'string[]', exampleHooks: 'string[]', conflictTags: 'string[]', emotionalTags: 'string[]',
  targetCategories: 'string[]',
  emotionalArc: 'emotionalArc', dnaTemplate: 'dnaTemplate',
  viralScore: 'int', usageCount: 'int', successCount: 'int',
  createdAt: 'string', updatedAt: 'string', lastUsedAt: 'string',
  status: 'status',
});
export const STATUS_VALUES = Object.freeze(['active', 'proposed', 'archived']);
export const DNA_TEMPLATE_KEYS = Object.freeze(['emotion_formula', 'language_formula', 'rhythm_formula', 'structure_formula']);
export const EMOTIONAL_ARC_KEYS = Object.freeze(['open', 'middle', 'close']);

// field ที่แผนแก้ได้ — ห้ามแตะ id/เวลา/ตัวนับการใช้งาน/ที่มา
const IMMUTABLE_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'lastUsedAt', 'usageCount', 'successCount', 'sourceContentId']);
export const MUTABLE_CARD_FIELDS = Object.freeze(Object.keys(CARD_FIELD_TYPES).filter((f) => !IMMUTABLE_FIELDS.has(f)));

// ใบใหม่ = สคีมาเต็มเหมือนใบจริง ยกเว้น id/createdAt (สคริปต์เติมให้) และ updatedAt/lastUsedAt (runtime)
export const NEW_CARD_FORBIDDEN_FIELDS = Object.freeze(['id', 'createdAt', 'updatedAt', 'lastUsedAt']);
export const NEW_CARD_REQUIRED_FIELDS = Object.freeze(
  Object.keys(CARD_FIELD_TYPES).filter((f) => !NEW_CARD_FORBIDDEN_FIELDS.includes(f)),
);

// ── helpers พื้นฐาน ──────────────────────────────────────────────────────────
export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeysDeep(value[k]);
    return out;
  }
  return value;
}

export function jsonEqual(a, b) {
  return JSON.stringify(sortKeysDeep(a)) === JSON.stringify(sortKeysDeep(b));
}

/** JSON แบบ deterministic ของคลังการ์ด: เรียงใบตาม id + เรียง key ทุกชั้นตามตัวอักษร */
export function canonicalCardsJson(cards) {
  const sorted = [...cards].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return `${JSON.stringify(sorted.map(sortKeysDeep), null, 2)}\n`;
}

export function loadJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/** รับได้ทั้งไฟล์ array ตรงๆ (data/prompt-library.json, ไฟล์แขน) และ wrapper ของ backup ({ items: [...] }) */
export function loadCardsFile(filePath) {
  const data = loadJsonFile(filePath);
  const items = Array.isArray(data) ? data : data?.items;
  if (!Array.isArray(items)) throw new Error(`ไฟล์การ์ดไม่ถูกรูป (ต้องเป็น array หรือ {items:[...]}): ${filePath}`);
  for (const c of items) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id) {
      throw new Error(`ไฟล์การ์ดมีใบที่ไม่มี id: ${filePath}`);
    }
  }
  return items;
}

/** id ในแบบ/แผนอาจเขียนย่อ 8 hex (เช่น da627c89) — canonical = id เต็มใน store (prompt_da627c89) */
export function canonicalCardId(rawId, storeIdSet) {
  if (typeof rawId !== 'string' || !rawId) return null;
  if (storeIdSet.has(rawId)) return rawId;
  if (/^[0-9a-f]{8}$/i.test(rawId) && storeIdSet.has(`prompt_${rawId}`)) return `prompt_${rawId}`;
  return null;
}

/** id ใบใหม่แบบ deterministic — รันกี่ครั้งก็ได้ id เดิม (idempotent + ไฟล์แขนแล็บได้ id เดียวกับ import จริง) */
export function deriveNewCardId(promptName, namespace = NEW_CARD_ID_NAMESPACE) {
  return `prompt_${sha256Hex(`${namespace}|${promptName}`).slice(0, 8)}`;
}

/** โหลด .env.local ของ worktree เข้า process.env (เฉพาะ key ที่ยังไม่ตั้ง — env จริงชนะเสมอ) */
export function loadEnvLocal(rootDir = ROOT) {
  const p = path.join(rootDir, '.env.local');
  if (!fs.existsSync(p)) return 0;
  let n = 0;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    n += 1;
  }
  return n;
}

/**
 * เปิด store จริงผ่าน createStore (dynamic import — เทสไม่โหลดของหนัก/ไม่แตะ DB)
 * หมายเหตุพฤติกรรม store เอง: getAll({authoritative:true}) ฝั่ง Supabase จะ sync mirror
 * data/prompt-library.json ทุกครั้งที่อ่านสำเร็จ (persistStore.js:229 — กฎ Database Fallback Sync)
 */
export async function getRealStore({ allowFileStore = false } = {}) {
  loadEnvLocal();
  // ด่านกันแขนแล็บค้าง (ข้อติงผู้ตรวจ 3 ก.ย. 69): ถ้า CARD_LIBRARY_LAB=1 ยังตั้งอยู่ (เช่นจาก set-arm card-*)
  // createStore('prompt-library') จะคืน overlay store ก่อนถึง Supabase (persistStore.js:262 — F2 short-circuit)
  // ขณะที่ป้าย supabaseMode ข้างล่างยังบอก "Supabase (ของจริง)" → backup/migrate ได้ของแล็บติดป้ายของจริง
  // สคริปต์ชุดนี้ต้องไม่เห็น overlay store เด็ดขาด — จงใจไม่มีสวิตช์ข้ามด่านนี้
  if (process.env.CARD_LIBRARY_LAB === '1') {
    throw new Error(
      'แขนแล็บยังตั้งค้าง (CARD_LIBRARY_LAB=1) — createStore จะคืน overlay store ไม่ใช่ store จริง '
      + '· สลับกลับก่อน: node set-arm.mjs prod (ในโฟลเดอร์ run) แล้วค่อยรันสคริปต์นี้ใหม่',
    );
  }
  process.chdir(ROOT); // persistStore หา data/ จาก cwd — ต้องยืนที่รากโปรเจกต์เสมอ
  const { isSupabaseReady } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'supabase.js')).href);
  const supabaseMode = isSupabaseReady();
  if (!supabaseMode && !allowFileStore) {
    throw new Error(
      'ไม่พบกุญแจ Supabase (.env.local) — store จริงคือ Supabase; โหมดไฟล์จะเขียนแค่ data/prompt-library.json '
      + 'ซึ่งจะถูก sync ทับเมื่ออ่านจาก Supabase ครั้งถัดไป · ถ้าตั้งใจซ้อมกับสำเนา ให้ใส่ --allow-file-store',
    );
  }
  const { createStore } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'persistStore.js')).href);
  return { store: createStore(STORE_NAME), supabaseMode };
}

/** โหลดไฟล์แผนทั้งคู่จากโฟลเดอร์กลาง พร้อม sha256 ของไบต์จริง (ใส่ใน diff-report) */
export function loadPlans(plansDir = PLANS_DIR_DEFAULT) {
  const cardsPath = path.join(plansDir, PLAN_CARDS_FILE);
  const opsPath = path.join(plansDir, PLAN_OPS_FILE);
  const missing = [cardsPath, opsPath].filter((p) => !fs.existsSync(p));
  if (missing.length) {
    throw new Error(`ยังไม่มีไฟล์แผน: ${missing.join(' · ')} (สาย cards/ops เป็นคนเขียน — ดูรูปแบบในแบบ F13)`);
  }
  const cardsRaw = fs.readFileSync(cardsPath, 'utf8');
  const opsRaw = fs.readFileSync(opsPath, 'utf8');
  return {
    planCards: JSON.parse(cardsRaw),
    planOps: JSON.parse(opsRaw),
    files: { planCards: cardsPath, planOps: opsPath },
    shas: { planCards: sha256Hex(cardsRaw), planOps: sha256Hex(opsRaw) },
  };
}

// ── ตัวตรวจชนิดค่า field ────────────────────────────────────────────────────
function checkFieldValue(field, value) {
  const errors = [];
  const warnings = [];
  const t = CARD_FIELD_TYPES[field];
  const bad = (msg) => errors.push(msg);
  if (t === 'string') {
    if (typeof value !== 'string') bad(`${field}: ต้องเป็น string`);
  } else if (t === 'int') {
    if (!Number.isInteger(value) || value < 0 || value > 100) bad(`${field}: ต้องเป็นจำนวนเต็ม 0-100`);
  } else if (t === 'string[]') {
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) bad(`${field}: ต้องเป็น array ของ string`);
  } else if (t === 'status') {
    if (!STATUS_VALUES.includes(value)) bad(`${field}: ต้องเป็นหนึ่งใน ${STATUS_VALUES.join('/')}`);
  } else if (t === 'emotionalArc') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) bad('emotionalArc: ต้องเป็น object {open, middle, close}');
    else {
      for (const k of EMOTIONAL_ARC_KEYS) if (typeof value[k] !== 'string') bad(`emotionalArc.${k}: ต้องเป็น string`);
      for (const k of Object.keys(value)) if (!EMOTIONAL_ARC_KEYS.includes(k)) bad(`emotionalArc: key แปลกปลอม "${k}"`);
    }
  } else if (t === 'dnaTemplate') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) bad('dnaTemplate: ต้องเป็น object ของสูตร (ค่าเป็น string)');
    else {
      for (const [k, v] of Object.entries(value)) {
        if (typeof v !== 'string') bad(`dnaTemplate.${k}: ต้องเป็น string`);
        if (!DNA_TEMPLATE_KEYS.includes(k)) warnings.push(`dnaTemplate: key นอกสูตรที่รู้จัก "${k}" (ใน store มีแค่ ${DNA_TEMPLATE_KEYS.join(', ')})`);
      }
    }
  } else {
    bad(`field "${field}" ไม่อยู่ในสคีมาการ์ดจริง`);
  }
  return { errors, warnings };
}

const SWEEP_ALLOWED_KEYS = Object.freeze([
  'ctaStyle', 'promptTextRemovePatterns', 'structureRemovePatterns', 'emotionalArcCloseRemovePatterns',
  'dnaTemplateRemovePatterns', // ส่วนขยายตาม F3 (แบบระบุกวาด dnaTemplate ด้วย แต่รูปแบบกลางไม่มีช่อง)
  'perCardPromptTextRemovePatterns', // ส่วนขยายจากแผนจริงของสาย ops: {id: [pattern,...]} ลบเฉพาะใบ (วลีสำเร็จรูปรายใบที่ regex กลางจับไม่ได้)
  'notes',
]);

/**
 * คอมไพล์ regex กวาด F3 — โยน error ถ้าคอมไพล์ไม่ได้ (validator เรียกใน try)
 * flags 'gu' ตามสัญญาใน notes ของแผน ops จริง (unicode เข้มกว่า = pattern หลวมๆ จะโดนจับตั้งแต่ validator)
 */
export function compileSweepPatterns(sweep = {}) {
  const compile = (list = [], label) => list.map((src) => {
    if (typeof src !== 'string' || src === '') throw new Error(`${label}: pattern ต้องเป็น string ไม่ว่าง`);
    return { source: src, re: new RegExp(src, 'gu') };
  });
  const perCard = {};
  for (const [id, list] of Object.entries(sweep.perCardPromptTextRemovePatterns || {})) {
    if (!Array.isArray(list)) throw new Error(`perCardPromptTextRemovePatterns[${id}]: ต้องเป็น array ของ pattern`);
    perCard[id] = compile(list, `perCardPromptTextRemovePatterns[${id}]`);
  }
  return {
    promptText: compile(sweep.promptTextRemovePatterns, 'promptTextRemovePatterns'),
    structure: compile(sweep.structureRemovePatterns, 'structureRemovePatterns'),
    emotionalArcClose: compile(sweep.emotionalArcCloseRemovePatterns, 'emotionalArcCloseRemovePatterns'),
    dnaTemplate: compile(sweep.dnaTemplateRemovePatterns, 'dnaTemplateRemovePatterns'),
    perCardPromptText: perCard,
  };
}

// ── validator หลัก ───────────────────────────────────────────────────────────
/**
 * ตรวจแผนทั้งคู่กับ store จริง
 * @param {{planCards: object, planOps: object}} plans
 * @param {object[]} storeCards การ์ดจาก store (backup/mirror/authoritative)
 * @param {{expectedCounts: object|null}} opts — expectedCounts=null ข้ามการตรวจจำนวน (ใช้ใน fixture เทส)
 * @returns {{ok, errors, warnings, counts, canonical, derivedNewIds}}
 *   canonical = แผนที่แปลง id ทุกตัวเป็น id เต็มของ store แล้ว (ห้ามใช้แผนดิบไป apply)
 */
export function validatePlans(plans, storeCards, { expectedCounts = EXPECTED_COUNTS } = {}) {
  const errors = [];
  const warnings = [];
  const planCards = plans?.planCards;
  const planOps = plans?.planOps;
  const storeIdSet = new Set(storeCards.map((c) => c.id));
  const storeById = new Map(storeCards.map((c) => [c.id, c]));
  const storeCategories = new Set(storeCards.map((c) => c.category).filter(Boolean));

  const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
  for (const [label, p, allowed] of [
    // meta = ป้ายบอกที่มา/วิธีใช้ของสายผู้เขียนแผน — สคริปต์ไม่อ่านค่าไปใช้ (inert) แต่ยอมให้มีได้
    ['plan-cards', planCards, ['version', 'meta', 'surgery', 'rename', 'newCards']],
    ['plan-ops', planOps, ['version', 'meta', 'sweep', 'archive', 'names', 'merge', 'viralScoreRemap', 'evidence']],
  ]) {
    if (!isPlainObject(p)) { errors.push(`${label}: ต้องเป็น object`); continue; }
    if (p.version !== 1) errors.push(`${label}: version ต้องเป็น 1 (ได้ ${JSON.stringify(p.version)})`);
    if (p.meta !== undefined && !isPlainObject(p.meta)) errors.push(`${label}: meta ต้องเป็น object`);
    for (const k of Object.keys(p)) if (!allowed.includes(k)) errors.push(`${label}: key แปลกปลอมระดับบน "${k}"`);
  }
  if (errors.length) return { ok: false, errors, warnings, counts: {}, canonical: null, derivedNewIds: [] };

  // canonicalize id (รับทั้ง id เต็มและย่อ 8 hex) — id ไม่พบ/ซ้ำหลัง canonicalize = error
  const canonMap = (obj = {}, label) => {
    const out = {};
    for (const [rawId, v] of Object.entries(obj)) {
      const id = canonicalCardId(rawId, storeIdSet);
      if (!id) { errors.push(`${label}: ไม่พบ id "${rawId}" ใน store`); continue; }
      if (id in out) { errors.push(`${label}: id ซ้ำ "${rawId}" (canonical ${id})`); continue; }
      out[id] = v;
    }
    return out;
  };
  const canonList = (arr = [], label) => {
    const out = [];
    const seen = new Set();
    for (const rawId of arr) {
      const id = canonicalCardId(rawId, storeIdSet);
      if (!id) { errors.push(`${label}: ไม่พบ id "${rawId}" ใน store`); continue; }
      if (seen.has(id)) { errors.push(`${label}: id ซ้ำ "${rawId}" (canonical ${id})`); continue; }
      seen.add(id);
      out.push(id);
    }
    return out.sort();
  };

  // ── plan-cards ──
  const surgery = canonMap(planCards.surgery, 'surgery');
  for (const [id, fields] of Object.entries(surgery)) {
    if (!isPlainObject(fields) || Object.keys(fields).length === 0) { errors.push(`surgery ${id}: ต้องเป็น object ของ field ที่เปลี่ยน (ห้ามว่าง)`); continue; }
    for (const [f, v] of Object.entries(fields)) {
      if (!MUTABLE_CARD_FIELDS.includes(f)) { errors.push(`surgery ${id}: field "${f}" แก้ไม่ได้/ไม่อยู่ในสคีมา`); continue; }
      const r = checkFieldValue(f, v);
      errors.push(...r.errors.map((e) => `surgery ${id}: ${e}`));
      warnings.push(...r.warnings.map((w) => `surgery ${id}: ${w}`));
    }
    if (typeof fields.ctaStyle === 'string' && fields.ctaStyle !== '') {
      warnings.push(`surgery ${id}: ctaStyle ไม่ว่าง — ขัดมติ F3 (ทั้งคลังต้องเป็น '' · การกวาดจะทับเป็น '' ตอนท้ายอยู่ดี)`);
    }
    if (typeof fields.promptName === 'string' && !fields.promptName.startsWith('[')) {
      warnings.push(`surgery ${id}: promptName ไม่ขึ้นต้น "[หมวด-อารมณ์]" ตามกติกา F10`);
    }
  }

  const rename = canonMap(planCards.rename, 'rename');
  for (const [id, r] of Object.entries(rename)) {
    if (!isPlainObject(r)) { errors.push(`rename ${id}: ต้องเป็น object`); continue; }
    for (const k of Object.keys(r)) {
      if (!['promptName', 'promptTextHead', 'replaceUntil'].includes(k)) errors.push(`rename ${id}: key แปลกปลอม "${k}"`);
    }
    for (const k of ['promptName', 'promptTextHead', 'replaceUntil']) {
      if (typeof r[k] !== 'string' || r[k] === '') errors.push(`rename ${id}: ${k} ต้องเป็น string ไม่ว่าง`);
    }
    if (typeof r.promptTextHead === 'string' && r.promptTextHead.length > 1000) {
      warnings.push(`rename ${id}: promptTextHead ยาว ${r.promptTextHead.length} ตัว (แบบกำหนด ~600 ตัวแรก)`);
    }
    if (id in surgery) errors.push(`rename ${id}: อยู่ใน surgery ด้วย — ห้ามซ้อน (ต่างคนต่างเขียน promptText)`);
    const card = storeById.get(id);
    if (card && typeof r.promptTextHead === 'string' && typeof r.replaceUntil === 'string' && r.replaceUntil !== '') {
      const text = String(card.promptText ?? '');
      if (!text.startsWith(r.promptTextHead) && !text.includes(r.replaceUntil)) {
        errors.push(`rename ${id}: ไม่พบ replaceUntil ใน promptText ปัจจุบัน (และยังไม่ถูก apply มาก่อน)`);
      }
      // applyPlans ตัดที่ตำแหน่งแรกที่พบ — ปรากฏมากกว่าหนึ่งครั้ง = เสี่ยงตัดผิดท่อน
      const hits = text.split(r.replaceUntil).length - 1;
      if (!text.startsWith(r.promptTextHead) && hits > 1) {
        errors.push(`rename ${id}: replaceUntil ปรากฏ ${hits} ครั้งใน promptText — ต้องไม่ซ้ำ (ระบุข้อความให้ยาวขึ้นจนชี้ได้จุดเดียว)`);
      }
    }
  }

  const newCards = Array.isArray(planCards.newCards) ? planCards.newCards : [];
  if (planCards.newCards !== undefined && !Array.isArray(planCards.newCards)) errors.push('newCards: ต้องเป็น array');
  const derivedNewIds = [];
  const seenNewIds = new Set();
  newCards.forEach((nc, i) => {
    const label = `newCards[${i}]`;
    if (!isPlainObject(nc)) { errors.push(`${label}: ต้องเป็น object`); return; }
    for (const f of NEW_CARD_FORBIDDEN_FIELDS) if (f in nc) errors.push(`${label}: ห้ามมี field "${f}" (สคริปต์เติมให้เอง)`);
    for (const f of NEW_CARD_REQUIRED_FIELDS) {
      if (!(f in nc)) { errors.push(`${label}: ขาด field "${f}" (ใบใหม่ต้องเต็มสคีมาเดียวกับใบจริง)`); continue; }
      const r = checkFieldValue(f, nc[f]);
      errors.push(...r.errors.map((e) => `${label}: ${e}`));
      warnings.push(...r.warnings.map((w) => `${label}: ${w}`));
    }
    for (const f of Object.keys(nc)) if (!(f in CARD_FIELD_TYPES)) errors.push(`${label}: field แปลกปลอม "${f}"`);
    if (nc.status !== 'proposed') errors.push(`${label}: status ต้องเป็น 'proposed' (ได้ ${JSON.stringify(nc.status)})`);
    if (nc.usageCount !== 0) errors.push(`${label}: usageCount ต้องเป็น 0`);
    if (nc.successCount !== 0) errors.push(`${label}: successCount ต้องเป็น 0`);
    if (nc.ctaStyle !== '') errors.push(`${label}: ctaStyle ต้องเป็น '' (มติ F3/F8 — ความรู้ปิดเรื่องอยู่ที่ VR-006 ที่เดียว)`);
    if (typeof nc.category === 'string' && storeCategories.has(nc.category)) {
      warnings.push(`${label}: category "${nc.category}" มีอยู่แล้วใน store (แบบระบุว่าเป็นหมวดใหม่)`);
    }
    if (typeof nc.promptName === 'string' && nc.promptName) {
      const id = deriveNewCardId(nc.promptName);
      const existing = storeById.get(id);
      // ใบเดียวกันถูก import ไปแล้ว (promptName ตรง) = เคส idempotent — applyPlans จะข้ามเอง ไม่ใช่ error
      if (existing && existing.promptName !== nc.promptName) {
        errors.push(`${label}: id ที่จะได้ (${id}) ชนกับใบอื่นใน store (${existing.promptName}) — เปลี่ยน promptName หรือ namespace`);
      }
      if (seenNewIds.has(id)) errors.push(`${label}: promptName ซ้ำกับใบใหม่ใบอื่น (id ชนกัน ${id})`);
      seenNewIds.add(id);
      derivedNewIds.push(id);
    }
  });

  // ── plan-ops ──
  const sweepRaw = isPlainObject(planOps.sweep) ? planOps.sweep : {};
  if (planOps.sweep !== undefined && !isPlainObject(planOps.sweep)) errors.push('sweep: ต้องเป็น object');
  for (const k of Object.keys(sweepRaw)) if (!SWEEP_ALLOWED_KEYS.includes(k)) errors.push(`sweep: key แปลกปลอม "${k}"`);
  if (sweepRaw.ctaStyle !== undefined) {
    if (typeof sweepRaw.ctaStyle !== 'string') errors.push('sweep.ctaStyle: ต้องเป็น string');
    else if (sweepRaw.ctaStyle !== '') {
      errors.push('sweep.ctaStyle: ต้องเป็น "" — มติกรรมการ 3 (F3): บรรทัด "เป้าหมายตอนจบ:" ต้องหายทั้งบรรทัด ไม่ใช่ข้อความ callback');
    }
  }
  if (sweepRaw.notes !== undefined && typeof sweepRaw.notes !== 'string') errors.push('sweep.notes: ต้องเป็น string');
  const sweep = { ...sweepRaw };
  if (sweepRaw.perCardPromptTextRemovePatterns !== undefined) {
    if (!isPlainObject(sweepRaw.perCardPromptTextRemovePatterns)) {
      errors.push('sweep.perCardPromptTextRemovePatterns: ต้องเป็น object {id: [pattern,...]}');
      delete sweep.perCardPromptTextRemovePatterns;
    } else {
      sweep.perCardPromptTextRemovePatterns = canonMap(sweepRaw.perCardPromptTextRemovePatterns, 'sweep.perCardPromptTextRemovePatterns');
    }
  }
  try {
    const compiled = compileSweepPatterns(sweep);
    const flat = [
      ...Object.entries(compiled).filter(([g]) => g !== 'perCardPromptText').flatMap(([g, list]) => list.map((p) => [g, p.source])),
      ...Object.entries(compiled.perCardPromptText).flatMap(([id, list]) => list.map((p) => [`perCardPromptText[${id}]`, p.source])),
    ];
    for (const [group, source] of flat) {
      if (new RegExp(source, 'u').test('')) warnings.push(`sweep.${group}: pattern จับ string ว่างได้ ("${source}") — เกือบแน่ว่าเขียนผิด`);
    }
    // pattern ที่หาไม่เจอเลยในคลังปัจจุบัน = เกือบแน่ว่าเขียนผิด/ถูก apply ไปแล้ว (เจอจริงมาแล้ว:
    // วลีในแบบ "จบที่ใจความหรืออวยพร(สั้นๆ)" ไม่มีตรงตัวใน store — ของจริงคือ "คำอวยพร" หลายแบบ)
    const testRe = (src) => new RegExp(src, 'u');
    const fieldOf = {
      promptText: (c) => [c.promptText],
      structure: (c) => [c.structure],
      emotionalArcClose: (c) => [c.emotionalArc?.close],
      dnaTemplate: (c) => Object.values(c.dnaTemplate || {}),
    };
    for (const [group, getter] of Object.entries(fieldOf)) {
      for (const { source } of compiled[group]) {
        const hit = storeCards.some((c) => getter(c).some((v) => typeof v === 'string' && testRe(source).test(v)));
        if (!hit) warnings.push(`sweep.${group}: pattern ไม่เจอในใบไหนเลย ("${source}") — เขียนผิดหรือถูก apply ไปแล้ว`);
      }
    }
    for (const [id, list] of Object.entries(compiled.perCardPromptText)) {
      const card = storeById.get(id);
      if (!card) continue; // canonMap รายงาน id หายไปแล้ว
      // per-card ทำงาน "หลัง" surgery → rename → regex กลางทุกตัว — ต้องเทสกับเนื้อที่ pattern จะเห็นจริง
      // (แผน ops จริงมี per-card ที่เก็บเศษความที่ regex กลางลบแล้วเหลือทิ้งไว้ เช่น "ไม่มีคำว่าแพง ที่เกาะเรื่องจริง")
      let preview = String(card.promptText ?? '');
      if (typeof surgery[id]?.promptText === 'string') preview = surgery[id].promptText;
      const rn = rename[id];
      if (rn && typeof rn.promptTextHead === 'string' && typeof rn.replaceUntil === 'string' && !preview.startsWith(rn.promptTextHead)) {
        const at = preview.indexOf(rn.replaceUntil);
        if (at >= 0) preview = rn.promptTextHead + preview.slice(at + rn.replaceUntil.length);
      }
      for (const g of compiled.promptText) preview = preview.replace(g.re, '');
      for (const { source } of list) {
        if (!testRe(source).test(preview)) {
          warnings.push(`sweep.perCardPromptText[${id}]: pattern ไม่เจอใน promptText (หลังรวม surgery/rename แล้ว) ("${source}") — เขียนผิดหรือถูก apply ไปแล้ว`);
        }
      }
    }
  } catch (e) {
    errors.push(`sweep: regex คอมไพล์ไม่ได้ (flags gu) — ${e.message}`);
  }

  const archive = canonList(planOps.archive, 'archive');
  const archiveSet = new Set(archive);
  for (const id of archive) {
    if (id in surgery) errors.push(`archive ${id}: อยู่ใน surgery ด้วย — ขัดกัน (ผ่าตัด = ตั้งใจเก็บใบนี้)`);
    if (id in rename) errors.push(`archive ${id}: อยู่ใน rename ด้วย — ขัดกัน`);
  }

  const names = canonMap(planOps.names, 'names');
  for (const [id, name] of Object.entries(names)) {
    if (typeof name !== 'string' || name === '') errors.push(`names ${id}: ชื่อใหม่ต้องเป็น string ไม่ว่าง`);
    if (id in rename) errors.push(`names ${id}: อยู่ใน rename ด้วย — ชื่อใหม่มีสองแหล่ง ต้องเหลือแหล่งเดียว`);
    if (id in surgery && typeof surgery[id]?.promptName === 'string') {
      warnings.push(`names ${id}: surgery ก็ตั้ง promptName — ลำดับ apply คือ names ก่อน แล้ว surgery ทับ (ชื่อจาก surgery ชนะ)`);
    }
  }

  const merge = canonMap(planOps.merge, 'merge');
  for (const [id, fields] of Object.entries(merge)) {
    if (!isPlainObject(fields) || Object.keys(fields).length === 0) { errors.push(`merge ${id}: ต้องเป็น object ของ field (ห้ามว่าง)`); continue; }
    for (const [f, v] of Object.entries(fields)) {
      if (!MUTABLE_CARD_FIELDS.includes(f)) { errors.push(`merge ${id}: field "${f}" แก้ไม่ได้/ไม่อยู่ในสคีมา`); continue; }
      const r = checkFieldValue(f, v);
      errors.push(...r.errors.map((e) => `merge ${id}: ${e}`));
    }
    if (typeof fields.category === 'string' && !storeCategories.has(fields.category)) {
      warnings.push(`merge ${id}: category "${fields.category}" ไม่มีใน store — F9 คือยุบเข้าหมวดที่มีอยู่`);
    }
  }

  const viralScoreRemapRaw = canonMap(planOps.viralScoreRemap, 'viralScoreRemap');
  const viralScoreRemap = {};
  for (const [id, score] of Object.entries(viralScoreRemapRaw)) {
    if (!Number.isInteger(score) || score < 1 || score > 100) { errors.push(`viralScoreRemap ${id}: ต้องเป็นจำนวนเต็ม 1-100 (ได้ ${JSON.stringify(score)})`); continue; }
    if (archiveSet.has(id)) warnings.push(`viralScoreRemap ${id}: ใบนี้ถูก archive ด้วย — remap แล้วไม่มีผล`);
    viralScoreRemap[id] = score;
  }

  const evidence = canonMap(planOps.evidence, 'evidence');
  for (const [id, v] of Object.entries(evidence)) {
    if (typeof v !== 'string' || v === '') errors.push(`evidence ${id}: ต้องเป็น string ไม่ว่าง`);
  }

  const counts = {
    surgery: Object.keys(surgery).length,
    rename: Object.keys(rename).length,
    newCards: newCards.length,
    archive: archive.length,
    names: Object.keys(names).length,
    merge: Object.keys(merge).length,
    viralScoreRemap: Object.keys(viralScoreRemap).length,
  };
  if (expectedCounts) {
    for (const [k, want] of Object.entries(expectedCounts)) {
      if (counts[k] !== want) errors.push(`จำนวน ${k} = ${counts[k]} ไม่ตรงแบบ (${want}) — ถ้าตั้งใจให้ต่าง ใช้ --no-counts พร้อมเหตุผล`);
    }
  }

  const canonical = {
    planCards: { version: 1, surgery, rename, newCards },
    planOps: { version: 1, sweep, archive, names, merge, viralScoreRemap, evidence },
  };
  return { ok: errors.length === 0, errors, warnings, counts, canonical, derivedNewIds };
}

// ── CLI helpers (ใช้ร่วมทุกสคริปต์ในโฟลเดอร์นี้) ───────────────────────────────
export function parseCliArgs(argv, { flags = [], options = [] } = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (flags.includes(a)) { out[a.replace(/^--/, '')] = true; continue; }
    if (options.includes(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`อาร์กิวเมนต์ ${a} ต้องมีค่าตามหลัง`);
      out[a.replace(/^--/, '')] = v;
      i += 1;
      continue;
    }
    if (a.startsWith('--')) throw new Error(`ไม่รู้จักอาร์กิวเมนต์: ${a}`);
    out._.push(a);
  }
  return out;
}

export function isMainModule(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return metaUrl === pathToFileURL(path.resolve(process.argv[1])).href;
  } catch {
    return false;
  }
}

export function printValidation({ errors, warnings, counts }) {
  if (counts && Object.keys(counts).length) {
    console.log('จำนวนในแผน:', Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' · '));
  }
  for (const w of warnings) console.warn(`⚠️ ${w}`);
  for (const e of errors) console.error(`❌ ${e}`);
}

// ── main ─────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  try {
    const args = parseCliArgs(process.argv.slice(2), { flags: ['--no-counts'], options: ['--plans-dir', '--from'] });
    const plansDir = args['plans-dir'] ? path.resolve(args['plans-dir']) : PLANS_DIR_DEFAULT;
    const storePath = args.from ? path.resolve(args.from) : path.join(ROOT, 'data', `${STORE_NAME}.json`);
    const storeCards = loadCardsFile(storePath);
    console.log(`store: ${storePath} (${storeCards.length} ใบ)${args.from ? '' : ' — mirror ในเครื่อง (build-arms/migrate จะตรวจซ้ำกับแหล่งที่ใช้จริง)'}`);
    const plans = loadPlans(plansDir);
    console.log(`แผน: ${plans.files.planCards} sha256=${plans.shas.planCards.slice(0, 12)} · ${plans.files.planOps} sha256=${plans.shas.planOps.slice(0, 12)}`);
    const result = validatePlans(plans, storeCards, { expectedCounts: args['no-counts'] ? null : EXPECTED_COUNTS });
    if (args['no-counts']) console.warn('⚠️ ข้ามการตรวจจำนวนตามแบบ (--no-counts)');
    printValidation(result);
    if (!result.ok) { console.error(`❌ แผนไม่ผ่าน (${result.errors.length} ข้อ)`); process.exit(1); }
    console.log(`✅ แผนผ่านทุกข้อ (เตือน ${result.warnings.length} ข้อ) · ใบใหม่จะได้ id: ${result.derivedNewIds.join(', ') || '-'}`);
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(2);
  }
}
