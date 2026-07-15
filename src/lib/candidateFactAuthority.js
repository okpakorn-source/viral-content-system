// ============================================================
// [MEGA · Candidate Fact Authority — Stage A] แหล่งความจริงของ "ข้อเท็จจริงต่อภาพผู้สมัคร"
// ------------------------------------------------------------
// โมดูลนี้ PURE 100% — ไม่มี import / env / IO / Date / random เลยแม้แต่ตัวเดียว
//
// สองหน้าที่แยกกันชัดเจน:
//   A) buildCandidateFactsV1  = "ผู้ผลิต" (producer) — libraryTriage เรียกตอนคัดกรอง
//        รับ descriptor ที่ไม่น่าเชื่อถือ → คืน facts-v1 ที่ตรวจแล้ว/แช่แข็ง/ตัดขาด
//   B) buildCandidateAuthoritySnapshotV1 = "ผู้ตรวจ+รวม" (validator/aggregator) — route เรียกตอน opt-in
//        รับ store snapshot proof → ตรวจว่าทุกแถวพก candidateFacts เวอร์ชัน/ผู้ผลิตถูกต้อง
//        + verdict ตรงกัน (literal) + caseId ผูกกับ snapshot → คืน vetted universe
//        ★ ห้ามสร้าง facts ใหม่จาก raw triage เด็ดขาด (no reconstruction) — legacy/ไม่มีเวอร์ชัน = fail-closed
//
// กฎเหล็กความปลอดภัย (fail-closed ทุกจุด):
//   • อ่าน untrusted object ด้วย getOwnPropertyDescriptor เท่านั้น — accessor (getter) ไม่เรียกเด็ดขาด
//   • ทุก reflective op (getOwnPropertyDescriptor/getPrototypeOf/Reflect.ownKeys/length/index) ครอบ try/catch
//     — proxy กับดัก/ revoked proxy / exotic ต้อง "ไม่ทำให้ throw" (fail-closed แทน)
//   • verdict = boolean เป๊ะ เท่านั้น (ไม่มี default-positive)
//   • resolution เป็นสถานะมีโครง { level, width, height } เสมอ — ไม่ยุบเป็น string เดี่ยว
//   • faceBox: null = "ยืนยันไม่มี" · 'unknown' = หาย/พัง · hash 16 hex lower + algo เท่านั้น มิฉะนั้น 'unknown'
//   • ห้าม map peopleBox → subjectBox · ห้าม emit identity / highRes / eligibility / subjectBox / pHashCluster
//   • vetted scope ต้องเป็น 'case_image_store_full_vetted_v1' เท่านั้น — ไม่ใช่ 'full_vetted_v1' ของ F
// ============================================================

export const FACTS_SCOPE = 'candidate_facts_v1';
export const FACTS_VERSION = 1;
export const FACTS_PRODUCER = 'LIBRARY_TRIAGE_CANDIDATE_FACTS_V1';
export const DHASH_ALGO = 'dhash_9x8_v1';

export const SNAPSHOT_INPUT_SCOPE = 'case_image_store_snapshot_v1';
export const VETTED_SCOPE = 'case_image_store_full_vetted_v1';
export const VETTED_POPULATION = 'literal_relevant_true_v1';
export const SNAPSHOT_OUTPUT_SCOPE = 'candidate_authority_snapshot_v1';
export const SNAPSHOT_PRODUCER = 'CANDIDATE_AUTHORITY_SNAPSHOT_V1';
export const SNAPSHOT_VERSION = 1;

const HEX16_LOWER = /^[0-9a-f]{16}$/; // 16 ตัว · เฉพาะพิมพ์เล็ก (uppercase ⇒ ปฏิเสธ)
const VERDICT_KEYS = ['relevant', 'clean', 'newsScene'];
const MEASURED_LEVELS = new Set(['full', 'thumb', 'unknown']);
const MAX_ROWS = 2000;
const MAX_ID_LEN = 512;
const MAX_REASONS = 16;
const MAX_DIMENSION = 100000; // เพดานกว้าง/สูง (px) กันตัวเลขเพี้ยน/หลอก
const INVALID = Symbol('invalid');

// ★ P1-2: เพดานจำนวน key ต่อพื้นผิว (key-flood guard) — object ปลอมยัด key มหาศาล
//   ต้องล้มก่อนจ่ายค่า per-key work (descriptor scan) · เช็ค length ทันทีหลัง Reflect.ownKeys
const KEY_CAP_PROOF = 32;
const KEY_CAP_ROW = 256; // image record จริง ~15-30 key — 256 เผื่อกว้างแล้ว
const KEY_CAP_TRIAGE = 128; // triage จริง ~20 key
const KEY_CAP_FACTS = 8; // facts-v1 มี 7 key เป๊ะ
const KEY_CAP_SUB = 8; // sub-object ของ facts (verdicts/resolution/faceBox/hash)

// allowlist ต่อพื้นผิวที่ schema ตายตัว — unknown/symbol key = fail-closed
const PROOF_KEYS = new Set(['scope', 'caseId', 'complete', 'truncated', 'count', 'rows', 'reason']);
const FACTS_KEYS = new Set(['scope', 'version', 'producer', 'verdicts', 'resolution', 'faceBox', 'hash']);
const VERDICT_KEY_SET = new Set(VERDICT_KEYS);
const RESOLUTION_KEYS = new Set(['level', 'width', 'height']);
const FACEBOX_KEYS = new Set(['x1', 'y1', 'x2', 'y2']);
const HASH_KEYS = new Set(['value', 'algo', 'measuredFrom']);

// ============================================================
// safe reflective readers — ห้าม throw, ห้ามเรียก getter
// ============================================================
function safeOwnDescriptor(obj, key) {
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return undefined;
  try {
    return Object.getOwnPropertyDescriptor(obj, key);
  } catch {
    return undefined;
  }
}

// อ่าน own-data-property (ไม่แตะ accessor, ไม่ throw)
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
    return false; // revoked/exotic proxy → ไม่ใช่ plain (fail-closed)
  }
  return proto === Object.prototype || proto === null;
}

function safeOwnKeys(obj) {
  try {
    return Reflect.ownKeys(obj);
  } catch {
    return null; // threw = hostile
  }
}

// ★ P1-2: ด่านตรวจ object ไม่น่าเชื่อถือแบบ bounded — คืน token ความผิด หรือ null = ผ่าน
//   ลำดับถูกออกแบบให้ "ล้มก่อนจ่ายค่าแพง": (1) Reflect.ownKeys (engine-native ครั้งเดียว)
//   → (2) เช็คจำนวน key เทียบ cap ทันที (key-flood ล้มตรงนี้ ไม่แตะ descriptor แม้ตัวเดียว)
//   → (3) allowlist/symbol เช็คจาก key string ล้วน (ยังไม่แตะ descriptor)
//   → (4) descriptor scan หา accessor — ถึงตรงนี้จำนวน key ≤ cap แล้วเสมอ
//   (JS ไม่มีทางรู้จำนวน own key โดยไม่ materialize รายการ key — Reflect.ownKeys ครั้งเดียว
//    คือขั้นต่ำสุดที่เป็นไปได้ แล้วทุกงาน per-key ถูก cap คุม)
function guardObject(obj, cap, allow) {
  const keys = safeOwnKeys(obj);
  if (keys === null) return 'GETTER'; // reflection โยน = hostile
  if (keys.length > cap) return 'KEY_FLOOD';
  for (const key of keys) {
    if (typeof key !== 'string') return 'UNEXPECTED_KEY'; // symbol key — ข้อมูลจาก JSON จริงไม่มีทางมี
    if (allow && !allow.has(key)) return 'UNEXPECTED_KEY';
  }
  for (const key of keys) {
    let d;
    try {
      d = Object.getOwnPropertyDescriptor(obj, key);
    } catch {
      return 'GETTER'; // descriptor อ่านไม่ได้ = hostile
    }
    if (d && !('value' in d)) return 'GETTER'; // accessor — ห้ามมี
  }
  return null;
}

// Array.isArray กัน revoked proxy (โยน TypeError ได้) → fail-closed
function safeIsArray(v) {
  try {
    return Array.isArray(v);
  } catch {
    return false;
  }
}

// อ่าน length จาก OWN DATA descriptor เท่านั้น (ไม่แตะ get trap ของ proxy)
function safeArrayLength(arr) {
  const d = safeOwnDescriptor(arr, 'length');
  if (!d || !('value' in d)) return null;
  const n = d.value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
}

// อ่าน element ของ array ด้วย descriptor (dense) — เลี่ยง index getter trap
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

const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n);

// ============================================================
// A) buildCandidateFactsV1 — descriptor (untrusted) → facts-v1 (frozen/detached)
// ============================================================
function pickVerdicts(descriptor) {
  const out = {};
  const r = ownRead(descriptor, 'verdicts');
  const holder = r.value;
  if (r.present !== true || holder === null || typeof holder !== 'object') return out;
  for (const k of VERDICT_KEYS) {
    const v = ownRead(holder, k);
    if (v.present && (v.value === true || v.value === false)) out[k] = v.value; // literal boolean เท่านั้น
  }
  return out;
}

function pickResolution(descriptor) {
  const unknown = { level: 'unknown', width: null, height: null };
  const r = ownRead(descriptor, 'resolution');
  const res = r.value;
  if (r.present !== true || res === null || typeof res !== 'object') return unknown;
  const decoded = ownRead(res, 'decodedBuffer').value;
  const provenance = ownRead(res, 'provenance').value;
  const width = ownRead(res, 'width').value;
  const height = ownRead(res, 'height').value;
  if (decoded !== true) return unknown; // ต้องมีหลักฐาน buffer ที่ decode จริง
  if (provenance !== 'full' && provenance !== 'thumb') return unknown;
  if (!Number.isInteger(width) || width <= 0 || width > MAX_DIMENSION) return unknown;
  if (!Number.isInteger(height) || height <= 0 || height > MAX_DIMENSION) return unknown;
  return { level: provenance, width, height };
}

function pickFaceBox(descriptor) {
  const r = ownRead(descriptor, 'faceBox');
  if (r.present !== true) return 'unknown'; // property หาย
  const fb = r.value;
  if (fb === null) return null; // ยืนยันว่าไม่มีใบหน้า
  if (fb === undefined) return 'unknown'; // property มีแต่ค่า undefined = ถือว่าหาย
  if (typeof fb !== 'object') return 'unknown';
  const x = ownRead(fb, 'x').value;
  const y = ownRead(fb, 'y').value;
  const w = ownRead(fb, 'w').value;
  const h = ownRead(fb, 'h').value;
  if (![x, y, w, h].every(isFiniteNum)) return 'unknown';
  if (x < 0 || y < 0 || w <= 0 || h <= 0) return 'unknown';
  if (x > 1 || y > 1) return 'unknown';
  const x2raw = x + w;
  const y2raw = y + h;
  if (x2raw > 1 + 1e-6 || y2raw > 1 + 1e-6) return 'unknown';
  const x2 = Math.min(1, x2raw);
  const y2 = Math.min(1, y2raw);
  if (!(x2 > x) || !(y2 > y)) return 'unknown'; // ต้องมีพื้นที่จริง (positive area)
  return { x1: x, y1: y, x2, y2 };
}

function pickHash(descriptor) {
  const r = ownRead(descriptor, 'hash');
  if (r.present !== true || r.value === null || typeof r.value !== 'object') return 'unknown';
  const hv = r.value;
  const value = ownRead(hv, 'value').value;
  const algo = ownRead(hv, 'algo').value;
  let measuredFrom = ownRead(hv, 'measuredFrom').value;
  if (typeof value !== 'string' || !HEX16_LOWER.test(value)) return 'unknown';
  if (algo !== DHASH_ALGO) return 'unknown';
  if (!MEASURED_LEVELS.has(measuredFrom)) measuredFrom = 'unknown';
  return { value, algo: DHASH_ALGO, measuredFrom };
}

function unknownFacts() {
  return {
    scope: FACTS_SCOPE,
    version: FACTS_VERSION,
    producer: FACTS_PRODUCER,
    verdicts: {},
    resolution: { level: 'unknown', width: null, height: null },
    faceBox: 'unknown',
    hash: 'unknown',
  };
}

export function buildCandidateFactsV1(descriptor) {
  try {
    return deepFreeze({
      scope: FACTS_SCOPE,
      version: FACTS_VERSION,
      producer: FACTS_PRODUCER,
      verdicts: pickVerdicts(descriptor),
      resolution: pickResolution(descriptor),
      faceBox: pickFaceBox(descriptor),
      hash: pickHash(descriptor),
    });
  } catch {
    return deepFreeze(unknownFacts()); // top-level backstop — ห้าม throw กับ input ใด ๆ
  }
}

// ============================================================
// validators — อ่าน facts ที่ "เก็บไว้แล้ว" (stored) เพื่อ re-normalize (ไม่ใช่สร้างจาก raw triage)
// ============================================================
function readVerdictsStrict(v) {
  if (!isPlainObject(v)) return INVALID;
  if (guardObject(v, KEY_CAP_SUB, VERDICT_KEY_SET) !== null) return INVALID; // cap+allowlist+accessor
  const out = {};
  for (const k of VERDICT_KEYS) {
    const r = ownRead(v, k);
    if (!r.present) continue; // subset อนุญาต (unknown verdict = ไม่มี key)
    if (r.value !== true && r.value !== false) return INVALID;
    out[k] = r.value;
  }
  return out;
}

function readResolutionStrict(r) {
  if (!isPlainObject(r)) return INVALID;
  if (guardObject(r, KEY_CAP_SUB, RESOLUTION_KEYS) !== null) return INVALID;
  const level = ownRead(r, 'level').value;
  const width = ownRead(r, 'width').value;
  const height = ownRead(r, 'height').value;
  if (level === 'unknown') {
    if (width !== null || height !== null) return INVALID;
    return { level: 'unknown', width: null, height: null };
  }
  if (level === 'full' || level === 'thumb') {
    if (!Number.isInteger(width) || width <= 0 || width > MAX_DIMENSION) return INVALID;
    if (!Number.isInteger(height) || height <= 0 || height > MAX_DIMENSION) return INVALID;
    return { level, width, height };
  }
  return INVALID;
}

function readFaceBoxStrict(rInfo) {
  if (!rInfo.present) return INVALID; // facts ต้องพก faceBox ชัดเจน (producer ตั้งเสมอ)
  const fb = rInfo.value;
  if (fb === null) return null;
  if (fb === 'unknown') return 'unknown';
  if (!isPlainObject(fb)) return INVALID;
  if (guardObject(fb, KEY_CAP_SUB, FACEBOX_KEYS) !== null) return INVALID;
  const x1 = ownRead(fb, 'x1').value;
  const y1 = ownRead(fb, 'y1').value;
  const x2 = ownRead(fb, 'x2').value;
  const y2 = ownRead(fb, 'y2').value;
  if (![x1, y1, x2, y2].every(isFiniteNum)) return INVALID;
  if (x1 < 0 || y1 < 0 || x2 > 1 || y2 > 1) return INVALID;
  if (!(x2 > x1) || !(y2 > y1)) return INVALID; // positive-area เท่านั้น
  return { x1, y1, x2, y2 };
}

function readHashStrict(rInfo) {
  if (!rInfo.present) return INVALID;
  const h = rInfo.value;
  if (h === 'unknown') return 'unknown';
  if (!isPlainObject(h)) return INVALID;
  if (guardObject(h, KEY_CAP_SUB, HASH_KEYS) !== null) return INVALID;
  const value = ownRead(h, 'value').value;
  const algo = ownRead(h, 'algo').value;
  const measuredFrom = ownRead(h, 'measuredFrom').value;
  if (typeof value !== 'string' || !HEX16_LOWER.test(value)) return INVALID;
  if (algo !== DHASH_ALGO) return INVALID;
  if (!MEASURED_LEVELS.has(measuredFrom)) return INVALID;
  return { value, algo: DHASH_ALGO, measuredFrom };
}

// อ่าน stored candidateFacts → คืน facts ที่ normalize+frozen ใหม่ (detached) หรือ INVALID
function readStoredCandidateFactsV1(rawFacts) {
  if (!isPlainObject(rawFacts)) return INVALID;
  if (guardObject(rawFacts, KEY_CAP_FACTS, FACTS_KEYS) !== null) return INVALID; // 7 key เป๊ะ — เกิน/แปลก/accessor = พัง
  if (ownRead(rawFacts, 'scope').value !== FACTS_SCOPE) return INVALID;
  if (ownRead(rawFacts, 'version').value !== FACTS_VERSION) return INVALID;
  if (ownRead(rawFacts, 'producer').value !== FACTS_PRODUCER) return INVALID;

  const verdicts = readVerdictsStrict(ownRead(rawFacts, 'verdicts').value);
  if (verdicts === INVALID) return INVALID;
  const resolution = readResolutionStrict(ownRead(rawFacts, 'resolution').value);
  if (resolution === INVALID) return INVALID;
  const faceBox = readFaceBoxStrict(ownRead(rawFacts, 'faceBox'));
  if (faceBox === INVALID) return INVALID;
  const hash = readHashStrict(ownRead(rawFacts, 'hash'));
  if (hash === INVALID) return INVALID;

  return deepFreeze({
    scope: FACTS_SCOPE,
    version: FACTS_VERSION,
    producer: FACTS_PRODUCER,
    verdicts,
    resolution,
    faceBox,
    hash,
  });
}

// ============================================================
// B) buildCandidateAuthoritySnapshotV1 — store proof (untrusted) → vetted universe
// ============================================================
function failSnapshot(reasons) {
  return deepFreeze({
    scope: SNAPSHOT_OUTPUT_SCOPE,
    version: SNAPSHOT_VERSION,
    producer: SNAPSHOT_PRODUCER,
    universeComplete: false,
    storeProof: null,
    vettedProof: null,
    candidates: null,
    reasons: reasons.slice(0, MAX_REASONS),
  });
}

const isLiteralBool = (v) => v === true || v === false;

function snapshotUniverse(proof) {
  const reasons = [];
  const flag = (token) => {
    if (!reasons.includes(token) && reasons.length < MAX_REASONS) reasons.push(token);
  };

  if (!isPlainObject(proof)) { flag('EXOTIC_PROTO'); return failSnapshot(reasons); }
  const gProof = guardObject(proof, KEY_CAP_PROOF, PROOF_KEYS); // cap+allowlist ก่อนงาน per-key ใด ๆ
  if (gProof !== null) { flag(gProof); return failSnapshot(reasons); }

  if (ownRead(proof, 'scope').value !== SNAPSHOT_INPUT_SCOPE) { flag('BAD_SCOPE'); return failSnapshot(reasons); }

  const complete = ownRead(proof, 'complete').value;
  const truncated = ownRead(proof, 'truncated').value;
  const count = ownRead(proof, 'count').value;
  const rows = ownRead(proof, 'rows').value;
  const proofCaseId = ownRead(proof, 'caseId').value;

  if (typeof proofCaseId !== 'string' || proofCaseId.length === 0 || proofCaseId.length > MAX_ID_LEN) {
    flag('BAD_CASE_ID');
    return failSnapshot(reasons);
  }
  if (truncated === true) flag('TRUNCATED');
  else if (truncated !== false) flag('LEGACY_SHAPE');
  if (complete !== true) flag('NOT_COMPLETE');
  if (!safeIsArray(rows)) { flag('LEGACY_SHAPE'); return failSnapshot(reasons); }

  const len = safeArrayLength(rows);
  if (len === null) { flag('ROWS_UNREADABLE'); return failSnapshot(reasons); }
  if (len > MAX_ROWS) { flag('OVERSIZE'); return failSnapshot(reasons); }
  if (!Number.isInteger(count) || count !== len) flag('COUNT_MISMATCH');

  const seen = new Set();
  const candidates = [];
  let relevantTrue = 0;

  for (let i = 0; i < len; i++) {
    const idx = safeIndexRead(rows, i);
    if (!idx.present) { flag('ROW_UNREADABLE'); break; }
    const row = idx.value;
    if (!isPlainObject(row)) { flag('EXOTIC_PROTO'); break; }
    const gRow = guardObject(row, KEY_CAP_ROW, null); // record จริง field เปิดกว้าง → cap อย่างเดียว (ไม่ allowlist)
    if (gRow !== null) { flag(gRow); break; }

    const id = ownRead(row, 'id').value;
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LEN) { flag('BAD_ID'); break; }
    if (seen.has(id)) { flag('DUP_ID'); break; }
    seen.add(id);

    const rowCaseId = ownRead(row, 'caseId').value;
    if (typeof rowCaseId !== 'string' || rowCaseId !== proofCaseId) { flag('CASE_MISMATCH'); break; }

    const triage = ownRead(row, 'triage').value;
    if (!isPlainObject(triage)) { flag('UNTRIAGED_ROW'); break; }
    const gTriage = guardObject(triage, KEY_CAP_TRIAGE, null); // triage มี field legacy หลากหลาย → cap อย่างเดียว
    if (gTriage !== null) { flag(gTriage); break; }

    const rawFacts = ownRead(triage, 'candidateFacts');
    if (!rawFacts.present) { flag('LEGACY_ROW'); break; } // ไม่มี candidateFacts = legacy → ห้าม reconstruct
    const facts = readStoredCandidateFactsV1(rawFacts.value);
    if (facts === INVALID) { flag('BAD_FACTS'); break; }

    // ★ DUAL literal relevant equality — ทั้ง triage.relevant และ facts.verdicts.relevant
    //   ต้องเป็น own literal boolean ทั้งคู่ + เท่ากันเป๊ะ · ขาด/ต่าง = ล้มทั้ง proof
    const tRel = ownRead(triage, 'relevant');
    const fRel = ownRead(facts.verdicts, 'relevant');
    if (!tRel.present || !isLiteralBool(tRel.value)) { flag('BAD_RELEVANT'); break; }
    if (!fRel.present || !isLiteralBool(fRel.value)) { flag('BAD_RELEVANT'); break; }
    if (tRel.value !== fRel.value) { flag('VERDICT_DISAGREE'); break; }

    // verdict อื่น (clean/newsScene) — ถ้า facts อ้าง ต้องตรง triage literal เป๊ะ
    let disagree = false;
    for (const k of ['clean', 'newsScene']) {
      const fv = ownRead(facts.verdicts, k);
      if (!fv.present) continue;
      const tv = ownRead(triage, k).value;
      if (!isLiteralBool(tv) || fv.value !== tv) { disagree = true; break; }
    }
    if (disagree) { flag('VERDICT_DISAGREE'); break; }

    // candidacy = relevant true (ทั้งคู่ + เท่ากัน) เท่านั้น
    if (fRel.value === true) {
      relevantTrue++;
      candidates.push(deepFreeze({ imageId: id, facts }));
    }
  }

  if (reasons.length) return failSnapshot(reasons);

  return deepFreeze({
    scope: SNAPSHOT_OUTPUT_SCOPE,
    version: SNAPSHOT_VERSION,
    producer: SNAPSHOT_PRODUCER,
    universeComplete: true,
    storeProof: {
      scope: SNAPSHOT_INPUT_SCOPE,
      complete: true,
      truncated: false,
      expectedCount: count,
      observedCount: len,
    },
    vettedProof: {
      scope: VETTED_SCOPE,
      complete: true,
      truncated: false,
      expectedCount: relevantTrue,
      observedCount: candidates.length,
      population: VETTED_POPULATION,
      candidateFactsVersion: FACTS_VERSION,
    },
    candidates,
  });
}

export function buildCandidateAuthoritySnapshotV1(proof) {
  try {
    return snapshotUniverse(proof);
  } catch {
    return failSnapshot(['INTERNAL_ERROR']); // top-level backstop — ห้าม throw กับ input ใด ๆ
  }
}
