// ============================================================
// [MEGA · Candidate Metric Authority — Batch B1 SHADOW] แหล่งความจริงของ "ค่าที่วัดได้ต่อภาพผู้สมัคร"
// ------------------------------------------------------------
// โมดูลนี้ PURE 100% — ไม่มี import / env / IO / Date / random เลยแม้แต่ตัวเดียว
// (แพตเทิร์นแฝดของ candidateFactAuthority.js — builder/validator/detach/literal-check เดียวกันเป๊ะ)
//
// เหตุผลที่มี: hero/global candidate ต้องการ "ค่าที่วัดจริง" (identityConfidence / faceCount /
// occlusion / edgeCut / cleanliness-numeric / visibleBodyRegion / faceShare / headroom /
// cropSafeBySlot) ที่ "ไม่มี producer ที่รับได้" ในระบบวันนี้ (Batch 4A audit) — จึงถูกกักกันเป็น
// absent เสมอ ทำให้ _rhHeroCandidate/_rhGlobalCandidate คืน null (fail-closed). โมดูลนี้คือ
// producer/authority ที่ถูกต้องของค่าเหล่านั้น: descriptor-safe, literal-only, hash-bindable.
//
// สองหน้าที่แยกกันชัดเจน (เหมือน candidateFactAuthority):
//   A) buildCandidateMetricsV1  = "ผู้ผลิต" (producer) — คืน metrics-v1 ที่ตรวจแล้ว/แช่แข็ง/ตัดขาด
//        ★ ฟิลด์ที่ "ไม่ได้วัด" = ห้ามใส่ (absent ≠ default) — ผู้บริโภคเห็น "ไม่มีหลักฐาน" ชัดเจน
//   B) buildCandidateMetricsSnapshotV1 = "ผู้รวม" + validateCandidateMetricsSnapshotV1 = "ผู้ตรวจ"
//        snapshot ผูก caseId + imageIds เป๊ะ (same-snapshot binding) → คืน metricsById detached
//
// 🔴 B1 = SHADOW: โมดูลนี้ถูกเดินท่อ (evidence bridge สร้าง metricsById ขนานกับ factsById) แต่
//   _rhCastCandidate/_rhHeroCandidate/_rhGlobalCandidate "ยังไม่อ่าน" metricsById ในแบตช์นี้ —
//   การ consume คือแบตช์หลัง
//
// กฎเหล็กความปลอดภัย (fail-closed ทุกจุด — เหมือน candidateFactAuthority):
//   • อ่าน untrusted object ด้วย getOwnPropertyDescriptor เท่านั้น — accessor (getter) ไม่เรียกเด็ดขาด
//   • ทุก reflective op ครอบ try/catch — proxy กับดัก / revoked proxy / exotic ต้อง "ไม่ทำให้ throw"
//   • ค่าตัวเลขต้องเป็น literal finite number ในช่วงที่กำหนด · enum ต้องตรง literal
//   • ฟิลด์ไหนไม่ครบเงื่อนไข = ตกไป absent (ไม่ default ค่ามั่ว) · snapshot ผิดจุดเดียว = fail ทั้งก้อน
// ============================================================

export const METRICS_SCOPE = 'candidate_metrics_v1';
export const METRICS_VERSION = 1;
export const METRICS_PRODUCER = 'CANDIDATE_METRIC_AUTHORITY_V1';

export const SNAPSHOT_SCOPE = 'candidate_metrics_snapshot_v1';
export const SNAPSHOT_PRODUCER = 'CANDIDATE_METRIC_SNAPSHOT_V1';
export const SNAPSHOT_VERSION = 1;

// mirrors heroShotContract.VISIBLE_BODY_REGIONS (import-free by design — re-declared locally,
// same pattern heroShotContract uses to re-implement the provenance enum without importing).
export const VISIBLE_BODY_REGIONS = Object.freeze([
  'face_only', 'head_shoulders', 'bust', 'half_body', 'three_quarter', 'full_body',
]);
const VISIBLE_BODY_REGION_SET = new Set(VISIBLE_BODY_REGIONS);

const HEX16_LOWER = /^[0-9a-f]{16}$/;
const MAX_ID_LEN = 512;
const MAX_ROWS = 2000;
const MAX_REASONS = 16;
const MAX_FACE_COUNT = 100000; // เพดานกันตัวเลขเพี้ยน/หลอก
const MAX_SLOTS = 64;          // cropSafeBySlot: ช่องต่อปกจริง ≤ ~8, 64 เผื่อกว้าง
const INVALID = Symbol('invalid');

// key-flood guard + exact-surface allowlist (เหมือน candidateFactAuthority)
const KEY_CAP_METRICS = 8;      // metrics-v1 มี 6 key เป๊ะ (scope/version/producer/sourceAssetId/caseId/measurements/hash = 7) — 8 เผื่อ
const KEY_CAP_MEASUREMENTS = 16; // measured fields ≤ 9
const KEY_CAP_SLOTMAP = MAX_SLOTS + 1;
const KEY_CAP_SNAPSHOT = 8;
const KEY_CAP_ENTRY = 4;

const METRICS_KEYS = new Set(['scope', 'version', 'producer', 'sourceAssetId', 'caseId', 'measurements', 'hash']);
const MEASUREMENT_KEYS = new Set([
  'identityConfidence', 'faceCount', 'occlusion', 'edgeCut', 'cleanliness',
  'visibleBodyRegion', 'faceShare', 'headroom', 'cropSafeBySlot',
]);
const SNAPSHOT_KEYS = new Set(['scope', 'version', 'producer', 'caseId', 'imageIds', 'metrics', 'hash']);
const ENTRY_KEYS = new Set(['imageId', 'metrics']);

// unit-interval measured fields [0,1]
const UNIT_FIELDS = ['identityConfidence', 'occlusion', 'edgeCut', 'cleanliness', 'faceShare', 'headroom'];

// ============================================================
// safe reflective readers — ห้าม throw, ห้ามเรียก getter (คัดลอกแพตเทิร์นจาก candidateFactAuthority)
// ============================================================
function safeOwnDescriptor(obj, key) {
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return undefined;
  try {
    return Object.getOwnPropertyDescriptor(obj, key);
  } catch {
    return undefined;
  }
}

function ownRead(obj, key) {
  const d = safeOwnDescriptor(obj, key);
  if (!d) return { present: false, value: undefined };
  if (!('value' in d)) return { present: false, value: undefined }; // accessor — ห้ามเรียก
  return { present: true, value: d.value };
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object') return false;
  let proto;
  try {
    proto = Object.getPrototypeOf(v);
  } catch {
    return false;
  }
  return proto === Object.prototype || proto === null;
}

function safeOwnKeys(obj) {
  try {
    return Reflect.ownKeys(obj);
  } catch {
    return null;
  }
}

// bounded object guard: cap + string-key-only + optional allowlist + no-accessor. null = ผ่าน, token = ผิด
function guardObject(obj, cap, allow) {
  const keys = safeOwnKeys(obj);
  if (keys === null) return 'GETTER';
  if (keys.length > cap) return 'KEY_FLOOD';
  for (const key of keys) {
    if (typeof key !== 'string') return 'UNEXPECTED_KEY';
    if (allow && !allow.has(key)) return 'UNEXPECTED_KEY';
  }
  for (const key of keys) {
    let d;
    try {
      d = Object.getOwnPropertyDescriptor(obj, key);
    } catch {
      return 'GETTER';
    }
    if (d && !('value' in d)) return 'GETTER';
  }
  return null;
}

function safeIsArray(v) {
  try {
    return Array.isArray(v);
  } catch {
    return false;
  }
}

function safeArrayLength(arr) {
  const d = safeOwnDescriptor(arr, 'length');
  if (!d || !('value' in d)) return null;
  const n = d.value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
}

function safeIndexRead(arr, i) {
  const d = safeOwnDescriptor(arr, String(i));
  if (!d) return { present: false, value: undefined };
  if (!('value' in d)) return { present: false, value: undefined };
  return { present: true, value: d.value };
}

function deepFreeze(node) {
  if (node && typeof node === 'object' && !Object.isFrozen(node)) {
    Object.freeze(node);
    for (const key of Object.keys(node)) deepFreeze(node[key]);
  }
  return node;
}

const isUnit = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
const isNonBlankStr = (s) => typeof s === 'string' && s.length > 0 && s.length <= MAX_ID_LEN;

// ============================================================
// pure content hash — FNV-1a 32-bit ×2 (seed ต่างกัน) → 16 hex lower (ไม่มี crypto import)
//   canonical serialize: key เรียงตาม code-unit · number = String(n) · boolean/null literal
// ============================================================
function stableSerialize(v) {
  if (v === null) return 'n';
  const t = typeof v;
  if (t === 'boolean') return v ? 't' : 'f';
  if (t === 'number') return Number.isFinite(v) ? 'd' + String(v) : 'dNaN';
  if (t === 'string') return 's' + v.length + ':' + v;
  if (Array.isArray(v)) return '[' + v.map(stableSerialize).join(',') + ']';
  if (v && t === 'object') {
    const ks = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return '{' + ks.map((k) => k + '=' + stableSerialize(v[k])).join(',') + '}';
  }
  return 'u';
}

function fnv1a32(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= (str.charCodeAt(i) >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function metricsHash(payload) {
  const s = stableSerialize(payload);
  const a = fnv1a32(s, 0x811c9dc5);
  const b = fnv1a32(s, 0x9e3779b1);
  return (a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')).toLowerCase();
}

// ============================================================
// A) buildCandidateMetricsV1 — measurements (untrusted) → metrics-v1 (frozen/detached)
//    ★ ฟิลด์ที่ไม่ผ่านการวัด/ผิดชนิด = ไม่ใส่เลย (absent) — ไม่มี default
// ============================================================
function pickMeasurements(measurements) {
  const out = {};
  if (measurements === null || typeof measurements !== 'object') return out;

  for (const field of UNIT_FIELDS) {
    const r = ownRead(measurements, field);
    if (r.present && isUnit(r.value)) out[field] = r.value;
  }

  const fc = ownRead(measurements, 'faceCount');
  if (fc.present && Number.isInteger(fc.value) && fc.value >= 0 && fc.value <= MAX_FACE_COUNT) {
    out.faceCount = fc.value;
  }

  const vbr = ownRead(measurements, 'visibleBodyRegion');
  if (vbr.present && typeof vbr.value === 'string' && VISIBLE_BODY_REGION_SET.has(vbr.value)) {
    out.visibleBodyRegion = vbr.value;
  }

  const csb = ownRead(measurements, 'cropSafeBySlot');
  const map = pickCropSafeBySlot(csb.present ? csb.value : undefined);
  if (map !== null) out.cropSafeBySlot = map;

  return out;
}

// cropSafeBySlot: object slotId(string) → boolean literal เท่านั้น · slot ที่ค่าไม่ใช่ literal boolean = ตัดทิ้ง
//   ไม่มี slot valid สักช่อง = คืน null (ฟิลด์ absent) · surface ผิด (accessor/exotic/flood) = null
function pickCropSafeBySlot(v) {
  if (v === null || typeof v !== 'object') return null;
  if (guardObject(v, KEY_CAP_SLOTMAP, null) !== null) return null;
  const out = {};
  let count = 0;
  const keys = safeOwnKeys(v);
  if (keys === null) return null;
  for (const slotId of keys) {
    if (typeof slotId !== 'string' || slotId.length === 0 || slotId.length > MAX_ID_LEN) continue;
    const r = ownRead(v, slotId);
    if (r.present && (r.value === true || r.value === false)) {
      out[slotId] = r.value;
      count++;
    }
  }
  return count > 0 ? out : null;
}

export function buildCandidateMetricsV1(input) {
  try {
    const src = (input === null || typeof input !== 'object') ? {} : input;
    const sourceAssetId = ownRead(src, 'sourceAssetId').value;
    const caseId = ownRead(src, 'caseId').value;
    const measurements = pickMeasurements(ownRead(src, 'measurements').value);

    const carrier = {
      scope: METRICS_SCOPE,
      version: METRICS_VERSION,
      producer: METRICS_PRODUCER,
      sourceAssetId: isNonBlankStr(sourceAssetId) ? sourceAssetId : null,
      caseId: isNonBlankStr(caseId) ? caseId : null,
      measurements,
    };
    const hash = metricsHash({
      sourceAssetId: carrier.sourceAssetId,
      caseId: carrier.caseId,
      measurements,
    });
    return deepFreeze({ ...carrier, hash });
  } catch {
    // top-level backstop — ห้าม throw กับ input ใด ๆ
    const measurements = {};
    return deepFreeze({
      scope: METRICS_SCOPE,
      version: METRICS_VERSION,
      producer: METRICS_PRODUCER,
      sourceAssetId: null,
      caseId: null,
      measurements,
      hash: metricsHash({ sourceAssetId: null, caseId: null, measurements }),
    });
  }
}

// ============================================================
// validator — อ่าน metrics ที่ "เก็บไว้แล้ว" (stored) → คืนสำเนา detached+frozen หรือ INVALID
//   ★ re-validate ทั้งใบ: scope/version/producer exact + binding string + measurements literal +
//     hash ตรงกับ payload ที่ re-serialize (integrity) — ปลอมค่าใดค่าหนึ่ง = INVALID
// ============================================================
function readMeasurementsStrict(m) {
  if (!isPlainObject(m)) return INVALID;
  if (guardObject(m, KEY_CAP_MEASUREMENTS, MEASUREMENT_KEYS) !== null) return INVALID;
  const out = {};
  for (const field of UNIT_FIELDS) {
    const r = ownRead(m, field);
    if (!r.present) continue;
    if (!isUnit(r.value)) return INVALID;
    out[field] = r.value;
  }
  const fc = ownRead(m, 'faceCount');
  if (fc.present) {
    if (!Number.isInteger(fc.value) || fc.value < 0 || fc.value > MAX_FACE_COUNT) return INVALID;
    out.faceCount = fc.value;
  }
  const vbr = ownRead(m, 'visibleBodyRegion');
  if (vbr.present) {
    if (typeof vbr.value !== 'string' || !VISIBLE_BODY_REGION_SET.has(vbr.value)) return INVALID;
    out.visibleBodyRegion = vbr.value;
  }
  const csb = ownRead(m, 'cropSafeBySlot');
  if (csb.present) {
    const map = readCropSafeBySlotStrict(csb.value);
    if (map === INVALID) return INVALID;
    out.cropSafeBySlot = map;
  }
  return out;
}

function readCropSafeBySlotStrict(v) {
  if (!isPlainObject(v)) return INVALID;
  if (guardObject(v, KEY_CAP_SLOTMAP, null) !== null) return INVALID;
  const keys = safeOwnKeys(v);
  if (keys === null) return INVALID;
  const out = {};
  let count = 0;
  for (const slotId of keys) {
    if (typeof slotId !== 'string' || slotId.length === 0 || slotId.length > MAX_ID_LEN) return INVALID;
    const r = ownRead(v, slotId);
    if (r.value !== true && r.value !== false) return INVALID;
    out[slotId] = r.value;
    count++;
  }
  if (count === 0) return INVALID; // ฟิลด์ที่ปรากฏต้องมีอย่างน้อย 1 slot จริง
  return out;
}

// อ่าน stored candidateMetrics → normalize+frozen ใหม่ (detached) หรือ INVALID
function readStoredCandidateMetricsV1(raw) {
  if (!isPlainObject(raw)) return INVALID;
  if (guardObject(raw, KEY_CAP_METRICS, METRICS_KEYS) !== null) return INVALID;
  if (ownRead(raw, 'scope').value !== METRICS_SCOPE) return INVALID;
  if (ownRead(raw, 'version').value !== METRICS_VERSION) return INVALID;
  if (ownRead(raw, 'producer').value !== METRICS_PRODUCER) return INVALID;

  const said = ownRead(raw, 'sourceAssetId').value;
  const cid = ownRead(raw, 'caseId').value;
  const sourceAssetId = (said === null) ? null : (isNonBlankStr(said) ? said : INVALID);
  if (sourceAssetId === INVALID) return INVALID;
  const caseId = (cid === null) ? null : (isNonBlankStr(cid) ? cid : INVALID);
  if (caseId === INVALID) return INVALID;

  const measurements = readMeasurementsStrict(ownRead(raw, 'measurements').value);
  if (measurements === INVALID) return INVALID;

  const expectHash = metricsHash({ sourceAssetId, caseId, measurements });
  const hash = ownRead(raw, 'hash').value;
  if (typeof hash !== 'string' || !HEX16_LOWER.test(hash) || hash !== expectHash) return INVALID;

  return deepFreeze({
    scope: METRICS_SCOPE,
    version: METRICS_VERSION,
    producer: METRICS_PRODUCER,
    sourceAssetId,
    caseId,
    measurements,
    hash,
  });
}

// exported thin wrapper (top-level backstop) — ห้าม throw
export function validateCandidateMetricsV1(raw) {
  try {
    const r = readStoredCandidateMetricsV1(raw);
    return r === INVALID ? null : r;
  } catch {
    return null;
  }
}

// ============================================================
// B) snapshot — ผูก caseId + imageIds เป๊ะ (same-snapshot binding)
// ============================================================
function normalizeImageIds(ids) {
  if (!safeIsArray(ids)) return null;
  const len = safeArrayLength(ids);
  if (len === null || len > MAX_ROWS) return null;
  const seen = new Set();
  const out = [];
  for (let i = 0; i < len; i++) {
    const idx = safeIndexRead(ids, i);
    if (!idx.present || !isNonBlankStr(idx.value) || seen.has(idx.value)) return null;
    seen.add(idx.value);
    out.push(idx.value);
  }
  return { list: out, set: seen };
}

// buildCandidateMetricsSnapshotV1({caseId, imageIds, metricsById})
//   metricsById = plain object imageId → candidateMetrics-v1 carrier (subset ของ imageIds อนุญาต) ·
//   ทุก metric ต้อง valid + sourceAssetId===imageId + caseId===snapshot caseId · ผิด = ทั้ง snapshot fail
export function buildCandidateMetricsSnapshotV1(input) {
  try {
    const src = (input === null || typeof input !== 'object') ? {} : input;
    const caseId = ownRead(src, 'caseId').value;
    if (!isNonBlankStr(caseId)) return failSnapshot(['BAD_CASE_ID']);
    const ids = normalizeImageIds(ownRead(src, 'imageIds').value);
    if (ids === null) return failSnapshot(['BAD_IMAGE_IDS']);

    const rawMap = ownRead(src, 'metricsById').value;
    const metrics = [];
    if (rawMap !== undefined && rawMap !== null) {
      if (!isPlainObject(rawMap)) return failSnapshot(['BAD_METRICS_MAP']);
      if (guardObject(rawMap, MAX_ROWS + 1, null) !== null) return failSnapshot(['BAD_METRICS_MAP']);
      const keys = safeOwnKeys(rawMap);
      if (keys === null) return failSnapshot(['BAD_METRICS_MAP']);
      for (const imageId of keys) {
        if (typeof imageId !== 'string' || !ids.set.has(imageId)) return failSnapshot(['METRIC_ID_NOT_IN_UNIVERSE']);
        const carrier = readStoredCandidateMetricsV1(ownRead(rawMap, imageId).value);
        if (carrier === INVALID) return failSnapshot(['BAD_METRIC']);
        if (carrier.sourceAssetId !== null && carrier.sourceAssetId !== imageId) return failSnapshot(['METRIC_ASSET_MISMATCH']);
        if (carrier.caseId !== null && carrier.caseId !== caseId) return failSnapshot(['METRIC_CASE_MISMATCH']);
        metrics.push({ imageId, metrics: carrier });
      }
    }

    const imageIds = ids.list;
    const hash = metricsHash({ caseId, imageIds, metrics: metrics.map((e) => ({ imageId: e.imageId, hash: e.metrics.hash })) });
    return deepFreeze({
      scope: SNAPSHOT_SCOPE,
      version: SNAPSHOT_VERSION,
      producer: SNAPSHOT_PRODUCER,
      caseId,
      imageIds,
      metrics,
      hash,
    });
  } catch {
    return failSnapshot(['INTERNAL_ERROR']);
  }
}

function failSnapshot(reasons) {
  return deepFreeze({
    scope: SNAPSHOT_SCOPE,
    version: SNAPSHOT_VERSION,
    producer: SNAPSHOT_PRODUCER,
    ok: false,
    caseId: null,
    imageIds: null,
    metricsById: null,
    reasons: reasons.slice(0, MAX_REASONS),
  });
}

// validateCandidateMetricsSnapshotV1 — fail-closed ทุกทาง + detach (deep copy) หลัง validate กัน TOCTOU
//   คืน { ok:true, scope, version, producer, caseId, imageIds:[...], metricsById: Map<imageId, frozenMetric> }
//   หรือ fail object (ok:false) — ห้าม throw
export function validateCandidateMetricsSnapshotV1(snapshot) {
  try {
    if (!isPlainObject(snapshot)) return failValidate(['EXOTIC_PROTO']);
    if (guardObject(snapshot, KEY_CAP_SNAPSHOT, SNAPSHOT_KEYS) !== null) return failValidate(['BAD_SURFACE']);
    if (ownRead(snapshot, 'scope').value !== SNAPSHOT_SCOPE) return failValidate(['BAD_SCOPE']);
    if (ownRead(snapshot, 'version').value !== SNAPSHOT_VERSION) return failValidate(['BAD_VERSION']);
    if (ownRead(snapshot, 'producer').value !== SNAPSHOT_PRODUCER) return failValidate(['BAD_PRODUCER']);

    const caseId = ownRead(snapshot, 'caseId').value;
    if (!isNonBlankStr(caseId)) return failValidate(['BAD_CASE_ID']);
    const ids = normalizeImageIds(ownRead(snapshot, 'imageIds').value);
    if (ids === null) return failValidate(['BAD_IMAGE_IDS']);

    const rows = ownRead(snapshot, 'metrics').value;
    if (!safeIsArray(rows)) return failValidate(['BAD_METRICS_ARRAY']);
    const len = safeArrayLength(rows);
    if (len === null || len > MAX_ROWS) return failValidate(['BAD_METRICS_ARRAY']);

    const metricsById = new Map();
    for (let i = 0; i < len; i++) {
      const idx = safeIndexRead(rows, i);
      if (!idx.present) return failValidate(['ROW_UNREADABLE']);
      const entry = idx.value;
      if (!isPlainObject(entry)) return failValidate(['BAD_ENTRY']);
      if (guardObject(entry, KEY_CAP_ENTRY, ENTRY_KEYS) !== null) return failValidate(['BAD_ENTRY']);
      const imageId = ownRead(entry, 'imageId').value;
      if (!isNonBlankStr(imageId) || !ids.set.has(imageId) || metricsById.has(imageId)) return failValidate(['BAD_ENTRY_ID']);
      const carrier = readStoredCandidateMetricsV1(ownRead(entry, 'metrics').value);
      if (carrier === INVALID) return failValidate(['BAD_METRIC']);
      if (carrier.sourceAssetId !== null && carrier.sourceAssetId !== imageId) return failValidate(['METRIC_ASSET_MISMATCH']);
      if (carrier.caseId !== null && carrier.caseId !== caseId) return failValidate(['METRIC_CASE_MISMATCH']);
      metricsById.set(imageId, carrier); // carrier already deep-frozen detached copy
    }

    return {
      ok: true,
      scope: SNAPSHOT_SCOPE,
      version: SNAPSHOT_VERSION,
      producer: SNAPSHOT_PRODUCER,
      caseId,
      imageIds: ids.list.slice(),
      metricsById,
    };
  } catch {
    return failValidate(['INTERNAL_ERROR']);
  }
}

function failValidate(reasons) {
  return {
    ok: false,
    scope: SNAPSHOT_SCOPE,
    version: SNAPSHOT_VERSION,
    producer: SNAPSHOT_PRODUCER,
    caseId: null,
    imageIds: null,
    metricsById: null,
    reasons: reasons.slice(0, MAX_REASONS),
  };
}
