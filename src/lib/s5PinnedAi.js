// ============================================================
// [MEGA V2 · Batch 5B1] S5 STRICT PINNED AI — analyze → keywords only
// ------------------------------------------------------------
// วัตถุประสงค์: ป้องกัน "AI แอบสลับรุ่นเงียบๆ" + บังคับสคีมาเป๊ะ ไม่มี default-positive
//   1) PIN: resolve provider/model ครั้งเดียวที่ analyze (resolvePin) → เก็บลง case.meta →
//      keywords อ่านคืนจาก case ที่บันทึกไว้เท่านั้น (readStoredPin) — ห้าม re-resolve จาก env ซ้ำ
//   2) IDENTITY: อ่าน data.model ที่ provider ตอบกลับจริง (actualModel) เทียบกับ pin แบบ literal —
//      ไม่ตรง/ไม่มี = terminal ทันที (ไม่ retry/ไม่ repair) — ★ นี่คือ "self-report" ของ provider เอง
//      ไม่ใช่ข้อพิสูจน์ทาง cryptographic — ส่วน actualProvider คือ adapter/endpoint ที่โค้ดเราเลือกเรียกเอง
//      (forceProvider กำหนดแน่นอน) จึงเป็นข้อเท็จจริงที่แน่นอน 100% ไม่ใช่การอ้างของฝั่งตรงข้าม
//   3) SCHEMA: parse ด้วย JSON.parse ตรงๆ เท่านั้น (ห้าม fence-strip/brace-extract/coerce/default) แล้ว
//      ตรวจโครงสร้างแบบ own-data-descriptor ล้วน (ห้าม getter/proxy/symbol/exotic เข้าเงียบๆ)
//   4) BOUNDED RETRY/REPAIR (★ 15 ก.ค. correction — real AbortController cancellation): generation ≤2
//      attempt (initial+retry ตามกติกา retryable เดิมของ retry.js) → สำเร็จ transport+identity แต่
//      JSON/schema พัง = repair ได้ "ครั้งเดียว" ด้วย pin เดิมเป๊ะ → พังอีก = terminal · ทุก attempt ≤45s
//      ผูกกับ AbortController จริง (ยกเลิก fetch จริง ไม่ใช่แค่เลิกรอ) · เพดานรวม ≤120s ผูกกับ parent
//      AbortController เดียวกันที่ครอบทุก attempt/repair — เกิน = abort ของจริงทันที ไม่มี background request
//      ค้าง · รวมไม่เกิน 3 provider invocation ตลอดสาย
//   5) TERMINAL EVIDENCE: ทุก error ที่ throw ออกจากสายนี้พก .provenance (requestedProvider/Model,
//      actualProvider, actualModel หรือ null, actualModelVersion, attemptCount, repairCount, errorType)
//      เสมอ — รวมถึง MODEL_PIN_MISMATCH ที่ต้องเก็บค่า actualModel ที่ "ผิด" ไว้เป็นหลักฐาน ไม่ทิ้ง
//   6) FAIL-CLOSED PROXY: ทุกจุดตรวจ object/array (รวม pin เอง) เช็ค util.types.isProxy ก่อนงาน
//      reflective ใดๆ เสมอ — Proxy ถูกปฏิเสธไม่ว่า trap จะดูปลอดภัยแค่ไหน (ไม่ trust behavior ของ trap)
//   7) REDACTION: strict calls ส่ง redactBody:true เข้า aiClient.js เสมอ — ไม่มี raw provider response
//      body หลุดเข้า error message/onRetry callback/route response ทางไหนเลย
//   8) ไม่มี fallback provider/model ใดๆ ทุกกรณี — ผิด pin = ตาย ไม่ใช่ถอย
// ============================================================

import { types as nodeUtilTypes } from 'node:util';
import { resolveProvider, resolveModel, callBrain } from './aiClient.js';
import { isRetryable } from './retry.js';

const WRAPPER_DEADLINE_MS = 120000; // เพดานรวมทั้งกระบวนการ (generation + repair) — ผูก AbortController จริง
const ATTEMPT_TIMEOUT_MS = 45000;   // เพดานต่อ 1 ครั้งที่ยิง provider จริง — ผูก AbortController จริงเช่นกัน
const GEN_MAX_ATTEMPTS = 2;         // initial + retry ตามกติกา retryable เดิม (retry.js:isRetryable)
const GEN_RETRY_GAP_MS = 300;       // หน่วงสั้นๆ ก่อนยิงซ้ำรอบ 2 (courtesy — ไม่ใช่ backoff เต็มรูปแบบ) · abort-aware
const MAX_PIN_MODEL_LEN = 256;

// ============================================================
// ★ correction (round 3) — allowlisted stable error codes + fixed non-sensitive messages per code.
//   ทุก terminal error ที่ throw ออกจากสายนี้ต้องมี errorType เป็นสมาชิกของ set นี้เท่านั้น (ไม่ตรง = PROVIDER_ERROR)
//   และ message ต้องมาจาก map นี้เท่านั้น — ห้าม derive จาก raw thrown message/provider body/URL/prompt ใดๆ
// ============================================================
const KNOWN_ERROR_TYPES = new Set([
  'NO_API_KEY', 'INVALID_FORCED_PIN', 'AI_BUSY', 'PROVIDER_ERROR', 'ABORTED',
  'MODEL_IDENTITY_MISSING', 'MODEL_PIN_MISMATCH', 'ATTEMPT_TIMEOUT', 'DEADLINE_EXCEEDED',
  'JSON_PARSE_FAILED', 'SCHEMA_VALIDATION_FAILED', 'PIN_INVALID', 'GENERATION_FAILED',
  'INVALID_RESOLVED_MODEL',
]);
// รหัสที่ต้อง terminal เสมอในสาย generation loop — ไม่มีทาง retryable ไม่ว่า transport จะว่าอย่างไร
const NEVER_RETRY_TYPES = new Set(['MODEL_IDENTITY_MISSING', 'MODEL_PIN_MISMATCH', 'DEADLINE_EXCEEDED', 'PIN_INVALID']);
const GENERIC_STRICT_MESSAGE = 'AI provider call failed (strict path)';
const FIXED_MESSAGE_BY_TYPE = Object.freeze({
  NO_API_KEY: 'ยังไม่ได้ตั้งคีย์ AI สำหรับ provider ที่ล็อกไว้',
  INVALID_FORCED_PIN: 'internal pin configuration is invalid',
  PIN_INVALID: 'pin ที่ส่งเข้า strict wrapper ไม่ถูกต้อง/ผิดรูปแบบ',
  AI_BUSY: 'AI provider ไม่ว่างชั่วคราว',
  PROVIDER_ERROR: 'AI provider request failed',
  ABORTED: 'AI provider request was aborted',
  MODEL_IDENTITY_MISSING: 'AI provider ไม่ได้แจ้งรุ่นโมเดลจริงที่ใช้ตอบกลับมา',
  MODEL_PIN_MISMATCH: 'AI provider ตอบกลับด้วยโมเดลที่ต่างจาก pin ที่ล็อกไว้',
  ATTEMPT_TIMEOUT: 'AI provider attempt exceeded its bounded timeout',
  DEADLINE_EXCEEDED: 'S5 strict wrapper deadline exceeded',
  JSON_PARSE_FAILED: 'AI response was not valid JSON',
  SCHEMA_VALIDATION_FAILED: 'AI response failed schema validation',
  GENERATION_FAILED: 'AI generation phase failed to produce a result',
  INVALID_RESOLVED_MODEL: 'โมเดลที่ resolve ได้จาก env ไม่ถูกต้อง',
});

// ============================================================
// PIN — resolve ครั้งเดียว (analyze) / อ่านคืนแบบ fail-closed (keywords)
// ============================================================
export function resolvePin() {
  const provider = resolveProvider();
  if (!provider) {
    const e = new Error('ยังไม่ได้ตั้งคีย์ AI — ใส่ ANTHROPIC_API_KEY (หรือ OPENAI_API_KEY) ในไฟล์ .env.local ของโปรเจกต์นี้');
    e.errorType = 'NO_API_KEY';
    throw e;
  }
  const model = resolveModel(provider);
  // ★ correction item 4 (round 2): ปฏิเสธ model ว่าง/ยาวเกิน/มีช่องว่างหัวท้าย — ห้าม trim ให้แล้วยอมรับ
  //   (เช่น ANALYSIS_MODEL="  claude-x  " ใน env ต้องถือว่า INVALID ไม่ใช่ "ตัดขอบให้เป็นค่าที่ใช้ได้")
  if (!isExactModelId(model, MAX_PIN_MODEL_LEN)) {
    const e = new Error(FIXED_MESSAGE_BY_TYPE.INVALID_RESOLVED_MODEL);
    e.errorType = 'INVALID_RESOLVED_MODEL';
    throw e;
  }
  return Object.freeze({ provider, model }); // ★ ไม่ trim — ใช้ค่าที่ resolve ได้ตรงๆ (ผ่านเช็คแล้วว่าสะอาดเป๊ะ)
}

// ★ correction (stored-meta exact-schema): meta ที่ readStoredPin รับเข้ามาคือ envelope เต็มที่ analyze route
//   บันทึกจริง (src/app/api/analyze/route.js) — ต้องตรวจ "ทั้งก้อน" ตรงกับ 12 key นี้เป๊ะก่อนเสมอ ไม่ใช่แค่เช็ค
//   requestedProvider/requestedModel สอง field ที่เราสนใจ (เดิมปล่อย key แปลกปลอมที่ไม่รู้จักผ่านเข้ามาได้เงียบๆ)
const ANALYZE_META_KEYS = [
  'provider', 'model', 'schema', 'usage', 'requestedProvider', 'requestedModel',
  'actualProvider', 'actualModel', 'actualModelVersion', 'schemaVersion', 'attemptCount', 'repairCount',
];

// ★ อ่าน pin ที่บันทึกไว้ตอน analyze กลับมา — descriptor-safe, fail-closed เป๊ะ ไม่มี default/coerce
//   ต้องเป็น own-data property, provider ∈ {anthropic, openai}, model เป็น nonblank bounded string
//   ผิดรูปแบบใดๆ (accessor/symbol/proxy/type ผิด/หาย/key แปลกปลอม/key ขาด) = null → caller ต้องปฏิเสธ ห้าม resolve
//   จาก env แทน — guardExactObject ครอบ proxy + isPlainObject + exact-key-count + no-accessor ให้ครบในทีเดียว
export function readStoredPin(meta) {
  if (!guardExactObject(meta, ANALYZE_META_KEYS)) return null;
  const providerR = ownRead(meta, 'requestedProvider');
  const modelR = ownRead(meta, 'requestedModel');
  if (!providerR.present || (providerR.value !== 'anthropic' && providerR.value !== 'openai')) return null;
  // ★ correction item 4 (round 2): ปฏิเสธ model ที่มีช่องว่างหัวท้าย — ไม่ trim ให้ (exact identity เท่านั้น)
  if (!modelR.present || !isExactModelId(modelR.value, MAX_PIN_MODEL_LEN)) return null;
  return Object.freeze({ provider: providerR.value, model: modelR.value });
}

// ★ correction item 5/6: runStrictPinned ต้อง validate pin ที่ได้รับแบบ descriptor-safe + ปฏิเสธ proxy
//   ก่อนเรียก provider ใดๆ ทั้งสิ้น — ไม่ trust ค่าที่ resolvePin()/readStoredPin() ส่งมาเฉยๆ (defense-in-depth
//   กันการ mutate/swap หลัง resolve หรือกรณีมี caller อื่นในอนาคตที่ส่ง pin เข้ามาโดยไม่ผ่านสองฟังก์ชันนี้)
const PIN_KEYS = ['provider', 'model'];
function validatePin(pin) {
  if (nodeUtilTypes.isProxy(pin)) return null;
  if (!guardExactObject(pin, PIN_KEYS)) return null;
  const provider = ownRead(pin, 'provider').value;
  const model = ownRead(pin, 'model').value;
  if (provider !== 'anthropic' && provider !== 'openai') return null;
  // ★ correction item 4 (round 2): ปฏิเสธ model ที่มีช่องว่างหัวท้าย — ไม่ trim ให้ (exact identity เท่านั้น)
  if (!isExactModelId(model, MAX_PIN_MODEL_LEN)) return null;
  return { provider, model };
}

// ============================================================
// descriptor-safe primitives (self-contained — ไม่ import จาก megaAdapters.js)
// ============================================================
function ownRead(obj, key) {
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return { present: false, value: undefined };
  let d;
  try { d = Object.getOwnPropertyDescriptor(obj, key); } catch { return { present: false, value: undefined }; }
  if (!d || !('value' in d)) return { present: false, value: undefined }; // accessor = ไม่เรียก getter, ถือว่าไม่มี
  return { present: true, value: d.value };
}
function isPlainObject(v) {
  if (nodeUtilTypes.isProxy(v)) return false; // ★ correction item 6: ก่อนงาน reflective ใดๆ ทั้งสิ้น
  if (v === null || typeof v !== 'object') return false;
  let p;
  try { p = Object.getPrototypeOf(v); } catch { return false; }
  return p === Object.prototype || p === null;
}
function isPlainArray(v) {
  if (nodeUtilTypes.isProxy(v)) return false; // ★ correction item 6
  let isArr;
  try { isArr = Array.isArray(v); } catch { return false; }
  if (!isArr) return false;
  let p;
  try { p = Object.getPrototypeOf(v); } catch { return false; }
  return p === Array.prototype;
}
// object ที่มี "เฉพาะ" own-data key ตาม requiredKeys เป๊ะ (ครบ+ไม่เกิน) — symbol/accessor/proxy key = ปฏิเสธทั้งก้อน
function guardExactObject(obj, requiredKeys) {
  if (nodeUtilTypes.isProxy(obj)) return false; // ★ correction item 6 — ชัดเจนก่อนแม้ isPlainObject ครอบซ้ำอยู่แล้ว
  if (!isPlainObject(obj)) return false;
  let ks;
  try { ks = Reflect.ownKeys(obj); } catch { return false; }
  if (ks.length !== requiredKeys.length) return false;
  const allow = new Set(requiredKeys);
  for (const k of ks) {
    if (typeof k !== 'string') return false; // symbol key
    if (!allow.has(k)) return false; // extra key
  }
  for (const k of ks) {
    let d;
    try { d = Object.getOwnPropertyDescriptor(obj, k); } catch { return false; }
    // ★ correction (strict-enumerability): own data descriptor เฉยๆ ไม่พอ — ต้อง enumerable === true ด้วย
    //   (non-enumerable field ไม่ใช่ own-enumerable-data ตามสัญญาสคีมาที่อนุมัติ = ปฏิเสธทั้งก้อน)
    if (!d || !('value' in d) || d.enumerable !== true) return false; // accessor หรือ non-enumerable
  }
  return true;
}
// dense plain array อ่านผ่าน descriptor ล้วน (length + ทุก index, ไม่มี key แถม) — hole/accessor/proxy/เกิน cap = null
function guardArray(v, cap) {
  if (nodeUtilTypes.isProxy(v)) return null; // ★ correction item 6
  if (!isPlainArray(v)) return null;
  let lenD;
  try { lenD = Object.getOwnPropertyDescriptor(v, 'length'); } catch { return null; }
  if (!lenD || !('value' in lenD) || !Number.isSafeInteger(lenD.value) || lenD.value < 0 || lenD.value > cap) return null;
  const out = [];
  for (let i = 0; i < lenD.value; i++) {
    let d;
    try { d = Object.getOwnPropertyDescriptor(v, String(i)); } catch { return null; }
    // ★ correction (strict-enumerability): index descriptor ต้องเป็น own data descriptor + enumerable === true
    //   ด้วย (ไม่แตะ 'length' descriptor — length ของ array ปกติ non-enumerable โดยสเปกอยู่แล้ว ไม่ใช่บัค)
    if (!d || !('value' in d) || d.enumerable !== true) return null; // hole/accessor/non-enumerable
    out.push(d.value);
  }
  let ks;
  try { ks = Reflect.ownKeys(v); } catch { return null; }
  if (ks.length !== lenD.value + 1) return null; // เฉพาะ index 0..len-1 + 'length' เท่านั้น
  return out;
}
const isNonBlankStr = (v, maxLen) => typeof v === 'string' && v.trim().length > 0 && v.length <= maxLen;
const isBoolLiteral = (v) => v === true || v === false;
// ★ correction item 4 (round 2): model-identity strings (pin/actual) ต้อง exact เป๊ะ — ห้าม trim/normalize
//   เด็ดขาด ต่างจาก isNonBlankStr (ใช้กับ prose content ทั่วไปที่ trim-tolerant ได้ตามสัญญาเดิม) — มีช่องว่าง
//   หัว/ท้ายเมื่อไหร่ = ปฏิเสธทันที (v === v.trim() พิสูจน์ว่าไม่มีช่องว่างหัวท้ายโดยไม่ต้อง normalize ค่าออกมา)
const isExactModelId = (v, maxLen) => typeof v === 'string' && v.length > 0 && v.length <= maxLen && v === v.trim();

// ============================================================
// SCHEMA: analysis.v1 — mirror ของ src/lib/analysisPrompt.js ANALYSIS_SCHEMA เป๊ะ
// ============================================================
const MAX_STR = 4000;   // ขอบเขตกว้างพอ ไม่ใช่ข้อจำกัดเนื้อหาจริง — กัน payload มหึมา/hostile เท่านั้น
const MAX_LIST = 200;
const MAX_CHARACTERS = 50;
const GENDER_ENUM = new Set(['ชาย', 'หญิง', 'ไม่ระบุ']);
const CONFIDENCE_ENUM = new Set(['สูง', 'กลาง', 'ต่ำ']);

function readStringArray(v, cap) {
  const arr = guardArray(v, cap);
  if (arr === null) return null;
  const out = [];
  for (const el of arr) {
    if (!isNonBlankStr(el, MAX_STR)) return null;
    out.push(el);
  }
  return out;
}

const CHARACTER_KEYS = ['name', 'role', 'gender', 'descriptors', 'evidence'];
function readCharacter(c) {
  if (!guardExactObject(c, CHARACTER_KEYS)) return null;
  const name = ownRead(c, 'name').value;
  const role = ownRead(c, 'role').value;
  const gender = ownRead(c, 'gender').value;
  const evidence = ownRead(c, 'evidence').value;
  if (!isNonBlankStr(name, MAX_STR)) return null;
  if (!isNonBlankStr(role, MAX_STR)) return null;
  if (!GENDER_ENUM.has(gender)) return null;
  if (!isNonBlankStr(evidence, MAX_STR)) return null;
  const descriptors = readStringArray(ownRead(c, 'descriptors').value, MAX_LIST);
  if (descriptors === null) return null;
  return { name, role, gender, descriptors, evidence };
}

const CONTENT_KEYS = ['what_happened', 'key_events', 'location', 'time', 'numbers_facts'];
function readContent(c) {
  if (!guardExactObject(c, CONTENT_KEYS)) return null;
  const what_happened = ownRead(c, 'what_happened').value;
  const location = ownRead(c, 'location').value;
  const time = ownRead(c, 'time').value;
  if (!isNonBlankStr(what_happened, MAX_STR)) return null;
  if (!isNonBlankStr(location, MAX_STR)) return null;
  if (!isNonBlankStr(time, MAX_STR)) return null;
  const key_events = readStringArray(ownRead(c, 'key_events').value, MAX_LIST);
  const numbers_facts = readStringArray(ownRead(c, 'numbers_facts').value, MAX_LIST);
  if (key_events === null || numbers_facts === null) return null;
  return { what_happened, key_events, location, time, numbers_facts };
}

const CONTEXT_KEYS = ['background', 'why_notable', 'emotional_tone', 'tone_evidence', 'key_moment'];
function readContext(c) {
  if (!guardExactObject(c, CONTEXT_KEYS)) return null;
  const background = ownRead(c, 'background').value;
  const why_notable = ownRead(c, 'why_notable').value;
  const emotional_tone = ownRead(c, 'emotional_tone').value;
  const tone_evidence = ownRead(c, 'tone_evidence').value;
  const key_moment = ownRead(c, 'key_moment').value;
  if (![background, why_notable, emotional_tone, tone_evidence, key_moment].every((s) => isNonBlankStr(s, MAX_STR))) return null;
  return { background, why_notable, emotional_tone, tone_evidence, key_moment };
}

const ANALYSIS_KEYS = ['headline', 'summary', 'characters', 'content', 'context', 'confidence', 'missing_info'];
// คืน { ok:true, value } | { ok:false, reason }  — raw = ผลจาก JSON.parse ตรงๆ (ไม่ผ่าน fence/brace fallback)
export function validateAnalysisV1Structure(raw) {
  if (!guardExactObject(raw, ANALYSIS_KEYS)) return { ok: false, reason: 'TOP_LEVEL_SHAPE' };
  const headline = ownRead(raw, 'headline').value;
  const summary = ownRead(raw, 'summary').value;
  if (!isNonBlankStr(headline, MAX_STR)) return { ok: false, reason: 'headline' };
  if (!isNonBlankStr(summary, MAX_STR)) return { ok: false, reason: 'summary' };
  const charsArr = guardArray(ownRead(raw, 'characters').value, MAX_CHARACTERS);
  if (charsArr === null) return { ok: false, reason: 'characters' };
  const characters = [];
  for (const c of charsArr) {
    const rc = readCharacter(c);
    if (rc === null) return { ok: false, reason: 'characters[]' };
    characters.push(rc);
  }
  const content = readContent(ownRead(raw, 'content').value);
  if (content === null) return { ok: false, reason: 'content' };
  const context = readContext(ownRead(raw, 'context').value);
  if (context === null) return { ok: false, reason: 'context' };
  const confidence = ownRead(raw, 'confidence').value;
  if (!CONFIDENCE_ENUM.has(confidence)) return { ok: false, reason: 'confidence' };
  const missing_info = readStringArray(ownRead(raw, 'missing_info').value, MAX_LIST);
  if (missing_info === null) return { ok: false, reason: 'missing_info' };
  return { ok: true, value: { headline, summary, characters, content, context, confidence, missing_info } };
}

// ============================================================
// SCHEMA: keywords.v1 — mirror ของ src/lib/keywordPrompt.js KEYWORD_SCHEMA เป๊ะ
// ============================================================
const SUBJECT_KEYS = ['name', 'role', 'must_have', 'kind', 'owner'];
const KIND_ENUM = new Set(['person', 'object']);
function readSubject(s) {
  if (!guardExactObject(s, SUBJECT_KEYS)) return null;
  const name = ownRead(s, 'name').value;
  const role = ownRead(s, 'role').value;
  const must_have = ownRead(s, 'must_have').value;
  const kind = ownRead(s, 'kind').value;
  const owner = ownRead(s, 'owner').value;
  if (!isNonBlankStr(name, MAX_STR)) return null;
  if (!isNonBlankStr(role, MAX_STR)) return null;
  if (!isBoolLiteral(must_have)) return null;
  // ★ correction item 6: owner ผูกกับ kind แบบ exact — person ต้องว่างเป๊ะ, object ต้องไม่ว่าง
  if (kind === 'person') {
    if (owner !== '') return null;
  } else if (kind === 'object') {
    if (!isNonBlankStr(owner, MAX_STR)) return null;
  } else {
    return null; // ไม่ตรง KIND_ENUM
  }
  return { name, role, must_have, kind, owner };
}

export const KEYWORD_LIST_KEYS = Object.freeze([
  'queries_th', 'queries_en', 'object_queries', 'scene_place', 'moment_action',
  'emotion', 'source_show', 'hashtags', 'relationship_archive', 'lifestyle_travel',
  'family_album', 'landmark_context',
]);
const KEYWORDS_TOP_KEYS = ['subjects', ...KEYWORD_LIST_KEYS];

export function validateKeywordsV1Structure(raw) {
  if (!guardExactObject(raw, KEYWORDS_TOP_KEYS)) return { ok: false, reason: 'TOP_LEVEL_SHAPE' };
  const subjArr = guardArray(ownRead(raw, 'subjects').value, MAX_LIST);
  if (subjArr === null) return { ok: false, reason: 'subjects' };
  const subjects = [];
  for (const s of subjArr) {
    const rs = readSubject(s);
    if (rs === null) return { ok: false, reason: 'subjects[]' };
    subjects.push(rs);
  }
  const out = { subjects };
  for (const key of KEYWORD_LIST_KEYS) {
    const list = readStringArray(ownRead(raw, key).value, MAX_LIST);
    if (list === null) return { ok: false, reason: key };
    out[key] = list;
  }
  return { ok: true, value: out };
}

// ============================================================
// exact JSON parse — ห้าม fence-strip/brace-extract/coerce (ต่างจาก safeParseJson เดิมโดยตั้งใจ)
// ============================================================
function strictJsonParse(text) {
  if (typeof text !== 'string') return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

// ============================================================
// ★ correction item 1 — REAL cancellation ผูก AbortController จริง (ไม่ใช่ Promise.race เฉยๆ)
//   parent = เพดานรวม 120000ms (ครอบทุก attempt+repair) · child = เพดานต่อ attempt 45000ms ผูกกับ parent
//   (parent abort ⇒ child abort ทันที) · cleanup() ล้าง timer+listener เสมอ กัน leak ข้าม attempt
// ============================================================
function makeAttemptController(parentSignal, attemptMs) {
  const child = new AbortController();
  const timer = setTimeout(() => {
    child.abort(Object.assign(new Error('attempt deadline'), { name: 'AbortError' }));
  }, attemptMs);
  const onParentAbort = () => child.abort(parentSignal.reason);
  if (parentSignal.aborted) {
    child.abort(parentSignal.reason); // เกิน deadline รวมไปแล้ว — attempt ใหม่ต้องไม่ยิงจริง (fetch reject ทันที)
  } else {
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }
  return {
    signal: child.signal,
    cleanup() {
      clearTimeout(timer);
      parentSignal.removeEventListener('abort', onParentAbort);
    },
  };
}
// หน่วงระหว่าง generation attempt แบบ abort-aware — parent deadline มาถึงระหว่างหน่วง = เลิกรอทันที (ไม่ค้าง)
function sleepOrAbort(ms, signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    const onAbort = () => { clearTimeout(t); resolve(); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
// ★ correction item 1 (round 2) — COMPLETION-BOUNDED cancellation: signal ถูกส่งเข้า fetch จริงอยู่แล้ว
//   (ยกเลิก request จริงระดับ network) แต่ถ้า post-fetch bookkeeping ของ callBrain (recordLLM/logApiUsage)
//   ค้าง — fetch เสร็จไปแล้วแต่ promise ของ callBrain เองยังไม่ resolve — ตัว signal ที่ fetch ถืออยู่ "ใช้ไม่ได้
//   อีกแล้ว" (fetch จบไปแล้ว) ดังนั้นต้อง race ทั้ง call ของ callBrain(...) เองกับ signal นี้ด้วย เพื่อให้
//   attemptOnce settle ตรงเพดานเป๊ะเสมอ ไม่ว่าจุดค้างจะอยู่ตรงไหนของ callBrain · call เดิมที่ยังค้างอยู่เบื้องหลัง
//   ถูก attach .then() เสมอ (ไม่ conditional) กัน unhandled rejection เมื่อมันเพิ่ง settle ทีหลัง (ค่า/error ถูก
//   ทิ้งเงียบๆ เพราะ race ตัดสินไปแล้ว) — "race ที่ไม่มี abort จริง" เป็นสิ่งต้องห้าม: ที่นี่ signal ยกเลิก fetch
//   จริงเสมอ ส่วน race ชั้นนี้เป็นการันตีเพิ่มว่า "แม้ fetch จบแล้วแต่ส่วนอื่นค้าง ก็ยัง settle ตรงเวลา"
function raceAgainstAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(Object.assign(new Error('call aborted (deadline reached — possibly during post-fetch stage)'), { errorType: 'ABORTED' }));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); if (settled) return; settled = true; resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); if (settled) return; settled = true; reject(e); },
    );
  });
}

// ============================================================
// ★ correction (round 3, finding 1/2/3) — GUARANTEED TERMINAL CARRIER: ทุก error ที่ throw ออกจากสายนี้
//   ต้องเป็น "Error object ใหม่เอี่ยม" ที่โค้ดนี้สร้างเอง — ไม่เคย mutate/trust ต้นฉบับที่ throw เข้ามาเลย
//   (primitive / frozen-sealed Error / Proxy / accessor-bearing object / exotic ใดๆ ก็ไม่มีทางทำให้ตรงนี้
//   throw ซ้อนหรือทำให้ errorType/provenance หาย) · อ่านต้นฉบับผ่าน readErrorProbe เท่านั้น (descriptor-only,
//   ปฏิเสธ Proxy ก่อนงาน reflective ใดๆ, ไม่เรียก getter/trap ใดเลย) · message สุดท้ายมาจาก FIXED_MESSAGE_BY_TYPE
//   เท่านั้น (ไม่ derive จาก raw message/provider body/URL/prompt) · errorType ต้องอยู่ใน allowlist เท่านั้น
//   ไม่งั้นตกเป็น PROVIDER_ERROR
// ============================================================

// ★ อ่านค่าจาก "ต้นฉบับที่ throw เข้ามา" แบบปลอดภัยที่สุด — ไม่เรียก getter/trap ใดๆ ทั้งสิ้น ไม่ mutate ต้นฉบับ
//   คืนเฉพาะ {message, errorType, status} ที่เป็น own DATA property ชนิดถูกต้องเท่านั้น (อย่างอื่น = null)
function readErrorProbe(rawErr) {
  const probe = { message: null, errorType: null, status: null };
  if (rawErr === null || typeof rawErr !== 'object') return probe; // primitive throw (string/number/ฯลฯ) = ไม่มีข้อมูลให้อ่าน
  if (nodeUtilTypes.isProxy(rawErr)) return probe; // ★ ปฏิเสธ Proxy ก่อนงาน reflective ใดๆ — ไม่เรียก trap แม้แต่ตัวเดียว
  const msgR = ownRead(rawErr, 'message');
  if (msgR.present && typeof msgR.value === 'string') probe.message = msgR.value;
  const typeR = ownRead(rawErr, 'errorType');
  if (typeR.present && typeof typeR.value === 'string') probe.errorType = typeR.value;
  const statusR = ownRead(rawErr, 'status');
  if (statusR.present && typeof statusR.value === 'number' && Number.isFinite(statusR.value)) probe.status = statusR.value;
  return probe;
}

// ★ ประกอบ terminal error "ใหม่เอี่ยม" จาก errorType ที่ผ่าน allowlist แล้ว + retryable decision ที่คำนวณไว้แล้ว
//   (safe own literal — ไม่ต้องอ่านต้นฉบับซ้ำ) · เป็นจุดเดียวที่สร้าง .provenance (frozen) ให้ตรงกันทุกที่
function _assembleError(errorType, retryable, pin, state) {
  const safeType = KNOWN_ERROR_TYPES.has(errorType) ? errorType : 'PROVIDER_ERROR';
  const message = FIXED_MESSAGE_BY_TYPE[safeType] || GENERIC_STRICT_MESSAGE;
  const out = new Error(message); // ★ ใหม่เอี่ยมเสมอ — ไม่แตะ/ไม่ return ต้นฉบับที่ throw เข้ามาเลย
  out.errorType = safeType;
  out._strictRetryable = NEVER_RETRY_TYPES.has(safeType) ? false : retryable; // safe own literal — boolean ล้วน
  out.provenance = Object.freeze({
    requestedProvider: pin.provider,
    requestedModel: pin.model,
    actualProvider: pin.provider, // แน่นอน 100% — เราเลือก branch เอง (forceProvider), ไม่ใช่คำอ้างของฝั่งตรงข้าม
    actualModel: state.lastActualModel, // provider self-report ล่าสุดที่สังเกตได้ (เก็บไว้แม้กำลัง mismatch)
    actualModelVersion: null, // ไม่มี field รุ่นย่อยแยกต่างหากที่อ่านได้จริงจาก Anthropic/OpenAI ในโค้ดนี้
    attemptCount: state.attemptCount,
    repairCount: state.repairCount,
    errorType: safeType, // ★ ตัวเดียวกับ out.errorType เป๊ะ — ไม่มีทางเป็น null/ไม่ตรงกัน
  });
  return out;
}

// ★ ใช้เมื่อมี probe (จาก readErrorProbe บน rawErr ที่ "ไม่น่าเชื่อถือ" — callBrain/checkIdentity/raceAgainstAbort)
//   — รับ probe ที่ probe ไว้แล้วครั้งเดียวจาก caller (ไม่ probe ซ้ำ) · typeOverride (optional) ใช้ตอน
//   disambiguate ABORTED → ATTEMPT_TIMEOUT/DEADLINE_EXCEEDED
function buildTerminalError(probe, typeOverride, pin, state) {
  const errorType = typeOverride || probe.errorType;
  // ★ correction finding 2: probe ปลอดภัย (plain literal ที่สร้างเอง) เข้า isRetryable — ไม่ใช่ rawErr ดิบ
  const retryable = isRetryable({ status: probe.status, message: probe.message || '' });
  return _assembleError(errorType, retryable, pin, state);
}

// ★ ใช้เมื่อ errorType มาจาก literal ที่โค้ดนี้กำหนดเองล้วนๆ (deadline/schema/generation-exhausted) — ไม่มี
//   rawErr ที่ต้อง probe เลย · terminal เสมอโดยดีไซน์ (retryable=false)
function buildKnownError(errorType, pin, state) {
  return _assembleError(errorType, false, pin, state);
}

// ★ correction finding 3: onRetry ต้องเห็นแค่ errorType+message ที่ "fixed" อยู่แล้ว (err มาจาก
//   buildTerminalError/buildKnownError เสมอ ณ จุดที่เรียกฟังก์ชันนี้ — จึงเป็น object ที่เราสร้างเอง ปลอดภัยเต็มที่)
//   ไม่ export field อื่นของ Error (เช่น stack/provenance/cause) ออกไปที่ callback
function sanitizeForCallback(err) {
  return {
    errorType: (typeof err?.errorType === 'string') ? err.errorType : null,
    message: (typeof err?.message === 'string') ? err.message : GENERIC_STRICT_MESSAGE,
  };
}

function checkIdentity(brain, pin, state) {
  // ★ correction item 2 (round 2): ต้องเป็นค่าจาก "การตอบกลับครั้งนี้" เท่านั้น — actualModel มาจาก aiClient.js
  //   แล้ว (bounded verbatim string หรือ null) ไม่ต้อง trim ซ้ำที่นี่ (ห้ามซ้อน normalize)
  const actual = typeof brain?.actualModel === 'string' ? brain.actualModel : null;
  // ★ แทนที่ state.lastActualModel "แบบไม่มีเงื่อนไข" ทุกครั้ง รวมถึงกรณี null — ห้ามค้างค่าจาก attempt ก่อนหน้า
  //   (บัค: repair ที่ไม่มี model ตอบกลับ ต้องไม่แอบสวมค่า actualModel ของรอบ generation ก่อนหน้า)
  state.lastActualModel = actual;
  if (!actual) {
    const e = new Error('AI provider ไม่ได้แจ้งรุ่นโมเดลจริงที่ใช้ตอบกลับมา');
    e.errorType = 'MODEL_IDENTITY_MISSING';
    throw e;
  }
  if (actual !== pin.model) {
    const e = new Error('AI provider ตอบกลับด้วยโมเดลที่ต่างจาก pin ที่ล็อกไว้');
    e.errorType = 'MODEL_PIN_MISMATCH';
    throw e;
  }
  return actual;
}

async function attemptOnce({ system, user, maxTokens, temperature, pin, cost, onRetry, label, parentController, state }) {
  const { signal, cleanup } = makeAttemptController(parentController.signal, ATTEMPT_TIMEOUT_MS);
  try {
    // ★ correction item 1 (round 2): signal ยกเลิก fetch จริง (ผ่าน callBrain→provider adapter) เสมอ + race
    //   ทั้ง call กับ signal นี้ด้วย กัน post-fetch bookkeeping (recordLLM/logApiUsage) ค้างเกินเพดาน
    const brain = await raceAgainstAbort(
      callBrain({
        system, user, maxTokens, temperature, onRetry, cost, retries: 1,
        forceProvider: pin.provider, forceModel: pin.model, signal, redactBody: true,
      }),
      signal,
    );
    const actualModel = checkIdentity(brain, pin, state);
    return { brain, actualModel };
  } catch (rawErr) {
    // ★ correction (round 3, finding 1/2): probe rawErr แบบปลอดภัยครั้งเดียว (ไม่แตะ/ไม่ mutate ต้นฉบับเลย) —
    //   disambiguate ABORTED → ATTEMPT_TIMEOUT/DEADLINE_EXCEEDED จากสถานะ controller จริง ณ ตอนนี้ แล้วสร้าง
    //   terminal error ใหม่เอี่ยมเพียงครั้งเดียวผ่าน buildTerminalError (ไม่ throw ต้นฉบับ/ไม่คืนต้นฉบับเลย)
    const probe = readErrorProbe(rawErr);
    const typeOverride = probe.errorType === 'ABORTED'
      ? (parentController.signal.aborted ? 'DEADLINE_EXCEEDED' : 'ATTEMPT_TIMEOUT')
      : null;
    throw buildTerminalError(probe, typeOverride, pin, state);
  } finally {
    cleanup(); // ล้าง timer/listener เสมอ ไม่ว่าสำเร็จ/ล้ม — กัน leak ข้าม attempt
  }
}

async function runStrictInner({ system, user, maxTokens, temperature, pin, cost, onRetry, validate, parentController }) {
  const state = { attemptCount: 0, repairCount: 0, lastActualModel: null };
  let lastErr = null;
  let brainResult = null;

  // ── generation phase: ≤2 attempts, กติกา retryable เดิมของ retry.js (isRetryable) ──
  for (let i = 1; i <= GEN_MAX_ATTEMPTS; i++) {
    state.attemptCount++;
    try {
      brainResult = await attemptOnce({ system, user, maxTokens, temperature, pin, cost, onRetry, label: `generation-${i}`, parentController, state });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      // ★ correction (round 3, finding 1/2): err มาจาก buildTerminalError เสมอ (attemptOnce สร้างให้แล้ว) —
      //   errorType/_strictRetryable เป็น safe own literal ที่เราสร้างเอง อ่านตรงได้ปลอดภัยไม่ต้อง probe ซ้ำ ·
      //   _strictRetryable ผูก NEVER_RETRY_TYPES ไว้แล้วใน _assembleError จึงครอบคลุมกรณี identity/deadline
      //   terminal-เสมอโดยอัตโนมัติ ไม่ต้องเช็ค errorType ซ้ำอีกชั้น
      if (i >= GEN_MAX_ATTEMPTS || !err._strictRetryable) throw err;
      try { if (typeof onRetry === 'function') onRetry(i, GEN_RETRY_GAP_MS, sanitizeForCallback(err)); } catch { /* ห้าม callback ล้มลาม */ }
      await sleepOrAbort(GEN_RETRY_GAP_MS, parentController.signal);
      if (parentController.signal.aborted) {
        throw buildKnownError('DEADLINE_EXCEEDED', pin, state);
      }
    }
  }
  if (!brainResult) {
    throw lastErr || buildKnownError('GENERATION_FAILED', pin, state);
  }

  const parse = strictJsonParse(brainResult.brain.text);
  const schemaResult = parse.ok ? validate(parse.value) : { ok: false, reason: 'JSON_PARSE' };
  if (schemaResult.ok) {
    return {
      value: schemaResult.value,
      provenance: {
        actualProvider: pin.provider,
        actualModel: brainResult.actualModel,
        actualModelVersion: null,
        attemptCount: state.attemptCount,
        repairCount: state.repairCount,
        usage: brainResult.brain.usage,
      },
    };
  }

  // ── repair: ครั้งเดียว, pin เดิมเป๊ะ (forceProvider/forceModel เหมือนเดิม) — ไม่ทำถ้า deadline หมดแล้ว ──
  if (parentController.signal.aborted) {
    throw buildKnownError('DEADLINE_EXCEEDED', pin, state);
  }
  state.repairCount = 1;
  state.attemptCount++;
  try { if (typeof onRetry === 'function') onRetry('repair', 0, { reason: schemaResult.reason || null }); } catch { /* ห้าม callback ล้มลาม */ }
  const repairUser = `${user}\n\n---\nคำตอบก่อนหน้าไม่ผ่านสัญญา JSON ที่กำหนด (เหตุผล: ${String(schemaResult.reason || 'invalid').slice(0, 200)})\nกรุณาตอบใหม่เป็น JSON ล้วนที่ตรงสคีมาเป๊ะเท่านั้น ห้าม markdown ห้ามข้อความอื่น`;
  const repairResult = await attemptOnce({
    system, user: repairUser, maxTokens, temperature, pin, onRetry, label: 'repair', parentController, state,
    cost: cost ? { ...cost, step: `${cost.step} (ซ่อม)` } : undefined,
  });
  const repairParse = strictJsonParse(repairResult.brain.text);
  const repairSchema = repairParse.ok ? validate(repairParse.value) : { ok: false, reason: 'JSON_PARSE' };
  if (!repairSchema.ok) {
    // ★ correction finding 3: ไม่แปะ repairSchema.reason ต่อท้าย message อีกต่อไป (อาจเป็น field-name จาก
    //   ผลของ untrusted AI response แม้เป็นแค่ key แต่ยึดหลัก "fixed message เท่านั้น" ให้เข้มที่สุด)
    throw buildKnownError(repairParse.ok ? 'SCHEMA_VALIDATION_FAILED' : 'JSON_PARSE_FAILED', pin, state);
  }
  return {
    value: repairSchema.value,
    provenance: {
      actualProvider: pin.provider,
      actualModel: repairResult.actualModel,
      actualModelVersion: null,
      attemptCount: state.attemptCount,
      repairCount: state.repairCount,
      usage: repairResult.brain.usage,
    },
  };
}

// ★ entry point — ★ correction item 5/6: validate pin (descriptor-safe, ปฏิเสธ proxy) ก่อนเรียก provider
//   ใดๆ ทั้งสิ้น (ก่อนแม้แต่สร้าง AbortController) · deadline ผูกกับ AbortController จริงที่ครอบทุก attempt
export async function runStrictPinned(opts) {
  const pin = validatePin(opts?.pin);
  if (!pin) {
    const e = new Error(FIXED_MESSAGE_BY_TYPE.PIN_INVALID);
    e.errorType = 'PIN_INVALID';
    e.provenance = Object.freeze({
      requestedProvider: null, requestedModel: null, actualProvider: null, actualModel: null,
      actualModelVersion: null, attemptCount: 0, repairCount: 0, errorType: 'PIN_INVALID',
    });
    throw e;
  }
  const parentController = new AbortController();
  const parentTimer = setTimeout(() => {
    parentController.abort(Object.assign(new Error(`S5 strict wrapper deadline exceeded (${WRAPPER_DEADLINE_MS}ms)`), { name: 'AbortError' }));
  }, WRAPPER_DEADLINE_MS);
  try {
    return await runStrictInner({ ...opts, pin, parentController });
  } finally {
    clearTimeout(parentTimer); // กัน timer ค้างเกินอายุงานจริง (leak) ไม่ว่าจบแบบไหน
  }
}
