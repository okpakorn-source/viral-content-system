// ============================================================
// [ระบบทำปกออโต้] Gemini Vision — คัดเฟรมจากคลิป
// ------------------------------------------------------------
// ส่งภาพเฟรม (base64) เป็นแบตช์ → ให้ Gemini เลือกเฟรมที่เห็น
// บุคคลเป้าหมายชัด คุณภาพดี ใช้ทำปกได้ → คืน index ที่เลือก
// คีย์: GEMINI_API_KEY (หรือ GOOGLE_API_KEY)
// ============================================================

import { withRetry, isRetryable } from './retry.js';
import { recordLLM } from './costStore.js';
import { types as nodeUtilTypes } from 'node:util';

const DEFAULT_MODEL = 'gemini-2.5-flash';

export function geminiModel() {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

function getKey() {
  const k = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!k) {
    const e = new Error('ยังไม่ได้ตั้ง GEMINI_API_KEY — ใส่ในไฟล์ .env.local ของโปรเจกต์นี้');
    e.errorType = 'NO_GEMINI_KEY';
    throw e;
  }
  return k;
}

// เรียก Gemini พร้อม retry (กัน 503/429/overloaded) → คืน data (JSON)
// onRetry(attempt, waitMs) เรียกตอนต้องรอคิวลองใหม่ (ใช้อัปเดตสถานะ)
async function callGemini(body, { onRetry, cost } = {}) {
  const key = getKey();
  const model = geminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const data = await withRetry(
    async () => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        const busy = res.status >= 500 || res.status === 429;
        const e = new Error(
          busy
            ? `Gemini ไม่ว่างชั่วคราว (${res.status}) — ลองหลายครั้งแล้วยังไม่ว่าง กดใหม่อีกครั้งสักครู่`
            : 'Gemini error ' + res.status + ': ' + JSON.stringify(d.error || d).slice(0, 200)
        );
        e.status = res.status;
        e.errorType = busy ? 'AI_BUSY' : 'PROVIDER_ERROR';
        throw e;
      }
      return d;
    },
    { retries: 8, onAttempt: onRetry }
  );
  // บันทึกต้นทุน (usageMetadata: promptTokenCount/candidatesTokenCount)
  if (cost) await recordLLM({ provider: 'gemini', model, usage: data.usageMetadata, step: cost.step, caseId: cost.caseId });
  return data;
}

function geminiText(data) {
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
}

// frames: [{ index:number, base64:string }]  → คืน [{ index, reason }]
export async function geminiSelectFrames({ frames, subjects, onRetry, caseId, newsGist, pinpoint }) {
  const COST_STEP = 'แคปเฟรม YouTube (คัดภาพ)';
  const names =
    (subjects || []).map((s) => s.name).filter(Boolean).join(', ') || 'บุคคลในข่าว';

  // ★ DEVIATION 6 ก.ค. (ผู้ใช้สั่ง): ส่ง "บริบทข่าว" ให้ตา + บังคับเก็บซีน/อารมณ์หลากหลาย
  const gistBlock = newsGist ? `\nบริบทข่าว (ใช้ตัดสินว่าเฟรมไหน "เล่าเรื่องข่าวนี้"): ${String(newsGist).slice(0, 500)}\n` : '';

  // ★ โหมดเจาะจงคลิป: ผู้ใช้ชี้คลิปนี้มาเอง = ต้องได้ภาพเยอะหลายมุม (คลิปข่าวจริงถ่ายมือ สั่นบ้างเป็นปกติ)
  const pinpointBlock = pinpoint
    ? `\n🎯 โหมดคลิปที่ผู้ใช้ชี้มาเอง (สำคัญ): ผู้ใช้ต้องการภาพจากคลิปนี้ "จำนวนมาก หลายมุม หลายซีน"
- เป้าหมาย: เลือกให้ได้มากที่สุดที่พอใช้ได้ (คลิปยาวควรได้ 12-20 เฟรม)
- ผ่อนเกณฑ์ความคม 1 ระดับ: "ชัดพอใช้" (เห็นหน้า/ท่าทาง/บริบทรู้เรื่อง) = เก็บ — ตัดเฉพาะเบลอหนักมาก/มืดสนิท/เฟรมเปลี่ยนฉากล้วนๆ
- กระจายให้ครบทุกช่วงคลิป (ต้น-กลาง-ท้าย) และทุกมุมกล้อง/ทุกคนที่ปรากฏ ไม่ใช่ซีนเดียวซ้ำ\n`
    : '';

  const promptText = `คุณคือผู้ช่วยคัดภาพจากคลิปข่าวเพื่อนำไปทำ "ปกข่าว"
มีภาพเฟรมที่แคปจากวิดีโอมาให้หลายรูป (กำกับด้วย "รูปที่ N:")
งานของคุณ: เลือกเฉพาะเฟรมที่ "ใช้ทำปกได้ดีจริง" ตามเกณฑ์
${gistBlock}${pinpointBlock}
เกณฑ์ที่ต้องผ่าน:
- เห็นบุคคลเป้าหมายชัดเจน: ${names}
- ใบหน้า/ตัวบุคคลคมชัด ไม่เบลอ ไม่ไหว ไม่มืดจนมองไม่เห็น
- เห็นสีหน้า อารมณ์ หรือองค์ประกอบที่สื่อเรื่องราว

🎭 เก็บให้ "ครบซีน ครบอารมณ์" (สำคัญ):
- ถ้ามีหลายฉาก/หลายโมเมนต์ในคลิป ให้เลือกตัวแทนของแต่ละฉากที่ผ่านเกณฑ์ ไม่ใช่ฉากเดียวซ้ำๆ
- อารมณ์ห้ามเลือกโทนเดียว: ยิ้ม, ร้องไห้/ตื้นตัน, อึ้ง/ตกใจ, กอด, จริงจัง, โมเมนต์แอ็คชัน — มีให้เก็บให้ครบ
- เฟรม "หลักฐาน/ของสำคัญในข่าว" (เอกสาร/สิ่งของ/ป้าย/สถานที่) ที่ชัดเจน = เก็บด้วย

ตัดทิ้ง (ห้ามเลือก):
- เฟรมเบลอ/ไหว/เปลี่ยนฉาก
- ไม่มีบุคคลเป้าหมาย หรือเห็นไม่ชัด (ยกเว้นเฟรมหลักฐาน/สถานที่ตามข้อบน)
- ตัวอักษร/กราฟิก/โลโก้เต็มจอ, ฉากไตเติล, โฆษณา, จอดำ

${pinpoint ? 'เลือกแบบ "ครบทุกซีนที่พอใช้ได้" (ปริมาณ+ครอบคลุม)' : 'เลือกแบบ "คุณภาพเหนือปริมาณ"'} ตอบกลับเป็น JSON เท่านั้น:
{ "selected": [ { "index": <เลขรูป>, "reason": "เหตุผลสั้นๆ" } ] }
ถ้าไม่มีเฟรมไหนดีเลย ให้ "selected": []`;

  const parts = [{ text: promptText }];
  for (const f of frames) {
    parts.push({ text: frameLabel(f) });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: f.base64 } });
  }

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  };

  const data = await callGemini(body, { onRetry, cost: { step: COST_STEP, caseId } });
  const text = geminiText(data);
  const parsed = safeParse(text);
  if (!parsed) return [];
  const list = Array.isArray(parsed) ? parsed : parsed.selected || parsed.frames || [];
  return list.filter((x) => x && typeof x.index === 'number');
}

// จำแนกภาพเพื่อจับคู่เข้าช่องปก + คืนกรอบใบหน้าไว้ครอป
// frames: [{index, base64}] → [{index, category, quality, faceBox|null, note}]
// รายชื่อ "ที่มา" แคตตาล็อก/โฆษณา/อสังหา ที่มักให้ภาพ "วัตถุมั่ว" (บ้าน/โครงการทั่วไป ไม่ใช่ของคนในข่าว)
// ใช้เป็น "ตัวอย่างสัญญาณ" ป้อนให้ Gemini ตัดสิน (ไม่ลบอัตโนมัติ — ให้ตาดูภาพประกอบเสมอ)
const CATALOG_SOURCE_HINTS =
  'Dot Property, AP (Thai), แสนสิริ/Sansiri, SHERA/เฌอร่า, NaiBann, CheckRaka, homethaidd, homenayoo, บ้าน-Kapook, Home.co.th, พฤกษา/Pruksa, ศุภาลัย, อนันดา, ศูนย์รวมแบบบ้าน, รับสร้างบ้าน, แบบบ้าน';

// บล็อกอธิบาย "บุคคล/สิ่งของหลักในข่าว" (ชื่อ + บทบาท) — ช่วยให้ AI รู้ว่าอะไรคือ "วัตถุ" ของข่าว
function subjectsBlock(subjects) {
  const list = (subjects || [])
    .map((s) => {
      const nm = s.name || '';
      if (!nm) return '';
      // ใส่ hint "เพศ + บทบาท/วัย" ช่วย AI แยกตัวละครในภาพครอบครัว/คู่ (พ่อ=ชายผู้ใหญ่ / ลูกชายวัย 23=ชายหนุ่ม / แม่=หญิง)
      const bits = [s.gender, s.role].filter(Boolean);
      const hint = bits.length ? ` (${bits.join(' — ')})` : '';
      return `• ${nm}${hint}`;
    })
    .filter(Boolean)
    .join('\n');
  return list || '• บุคคลในข่าว';
}

// 🎯 กฎ "ความเป็นเจ้าของ" ของภาพวัตถุ (บ้าน/รถ/สิ่งของ) — แก้ช่องโหว่ "ค้นวัตถุมั่ว"
const OWNERSHIP_RULES = `🎯 กฎ "ความเป็นเจ้าของ" ภาพวัตถุ (บ้าน/รถ/สิ่งของ/ทรัพย์สิน) — จุดที่ระบบเคยพลาดหนัก:
ภาพบ้าน/รถ/สิ่งของ จะ "ใช้ได้" เฉพาะเมื่อเป็น "ของคนในข่าวจริงๆ" เท่านั้น (เช่น บ้านของเบิ้ล ไม่ใช่บ้านสองชั้นของใครก็ไม่รู้)
- ✅ ของคนในข่าว (เก็บไว้): มีคนในข่าวอยู่ในภาพ/คู่กับวัตถุ, เป็นภาพข่าว/แคนดิดจริง, ที่มาเป็นสำนักข่าว/เพจ/โซเชียลของบุคคลนั้นที่รายงานเรื่องนี้
- ❌ วัตถุมั่ว ไม่ใช่ของคนในข่าว (ตัดทิ้ง):
   • มาจากเว็บอสังหา/รับสร้างบ้าน/แคตตาล็อก/โฆษณาโครงการ (เช่น ${CATALOG_SOURCE_HINTS})
   • เป็นภาพเรนเดอร์/โบรชัวร์/โฆษณา, มีสเปค "x ห้องนอน / พื้นที่ใช้สอย ตร.ม. / ราคา", โลโก้บริษัทรับสร้างบ้าน
   • บ้าน/รถ สวยแบบสต็อก/สตูดิโอ ที่แค่ "ตรงคีย์เวิร์ด" แต่ไม่มีอะไรโยงกับคนในข่าว
- 🏛️ ข้อยกเว้น "สถานที่สาธารณะที่ข่าวเอ่ยชื่อ": ป้าย/อาคาร/รั้วของสถาบันที่อยู่ในแก่นข่าว (เช่น มหาวิทยาลัย/โรงพยาบาล/วัด/โรงเรียน/มูลนิธิ ที่ข่าวระบุชื่อ) = ✅ ใช้ได้ ไม่ใช่วัตถุมั่ว แม้ไม่มีคนในภาพ — เป็นภาพบริบท/ปลายทางของเรื่อง (ชื่อเฉพาะระบุตัวตนสถานที่แล้ว)
ใช้ "ที่มา (source)" + "หัวข้อ (title)" ที่กำกับหน้าแต่ละรูป ประกอบการตัดสินเสมอ`;

// กำกับ label หน้าแต่ละรูป: เลขรูป + ที่มา + หัวข้อ (บริบทช่วย AI ตัดสินความเป็นเจ้าของ)
function frameLabel(f) {
  const src = f.source ? ` [ที่มา: ${f.source}]` : '';
  const ttl = f.title ? ` “${String(f.title).slice(0, 80)}”` : '';
  return `รูปที่ ${f.index}:${src}${ttl}`;
}

// ============================================================
// ★ Batch 5B2 — strict pinned classifier path (geminiClassifyFrames เท่านั้น) — self-contained ในไฟล์นี้
//   (ไม่ import จาก s5PinnedAi.js — คนละ provider/shape) ไม่แตะ callGemini/geminiModel/ฟังก์ชัน Gemini อื่นเลย
//   1) PIN: resolveGeminiClassifierPin() resolve ครั้งเดียวต่อ vetImages/triageLibrary invocation (caller
//      เรียก) → freeze → ส่งต่อ pin เดิมเป๊ะทุกแบตช์/ทุก retry — ห้าม re-resolve จาก env ระหว่างงาน
//   2) IDENTITY: อ่าน data.modelVersion จาก own-data descriptor เท่านั้น (ไม่เรียก getter/trap) เทียบ pin.model
//      แบบ exact หรือ "exact + revision suffix 3 หลัก" เท่านั้น (ห้าม trim/lowercase/normalize ทั้งสองฝั่ง)
//   3) BOUNDED: AbortController จริง 2 ชั้น (parent deadline ครอบทั้ง call, child ต่อ attempt) — ≤2 attempt
//      รวม เฉพาะ transport/status ที่ retryable เดิม (isRetryable) · ไม่มี repair (0 เสมอ) · fetch ทุกครั้งผูก
//      signal จริง · JSON parse/schema/cost-log อยู่ใน scope เดียวกับ deadline
//   4) SCHEMA: exact {items:[...]} เท่านั้น ตรวจ key ครบ+ไม่เกิน (ตาม FILE_SHOT_TAG mode) + type/enum/bound
//      ทุก field + ครบ 1 รายการต่อ index ที่ส่งไปเป๊ะ ไม่ขาด/ไม่เกิน/ไม่ซ้ำ — พังจุดใดจุดหนึ่ง = ปฏิเสธทั้งแบตช์
//   5) คืน { items, evidence } — evidence ผูก requestedModel/actualModelVersion/modelMatchMode/attemptCount ฯลฯ
//      ให้ libraryTriage.js แนบเป็น provenance ต่อ triage แต่ละใบ
// ============================================================
const CLASSIFIER_SCHEMA_VERSION = 'gemini-classify-frames.v1';
const MAX_PIN_MODEL_LEN = 256;
const CLASSIFIER_MAX_STR = 4000;
const CLASSIFIER_MAX_LIST = 200;
const CLASSIFIER_ATTEMPT_TIMEOUT_MS = 40000; // เพดานต่อ 1 ครั้งยิง Gemini จริง
const CLASSIFIER_WRAPPER_DEADLINE_MS = 90000; // เพดานรวมทั้ง call (≤2 attempt + parse/schema + cost log)
const CLASSIFIER_MAX_ATTEMPTS = 2; // initial + retry เดียว — เฉพาะ transport/status ที่ retryable เดิม
const CLASSIFIER_RETRY_GAP_MS = 300;

const CLASSIFIER_KNOWN_ERROR_TYPES = new Set([
  'NO_GEMINI_KEY', 'INVALID_RESOLVED_MODEL', 'PIN_INVALID', 'INVALID_SIGNAL', 'AI_BUSY', 'PROVIDER_ERROR', 'ABORTED',
  'MODEL_IDENTITY_MISSING', 'MODEL_PIN_MISMATCH', 'ATTEMPT_TIMEOUT', 'DEADLINE_EXCEEDED',
  'JSON_PARSE_FAILED', 'SCHEMA_VALIDATION_FAILED', 'GENERATION_FAILED',
]);
// รหัสที่ต้อง terminal เสมอในสาย attempt loop — ไม่มีทาง retryable ไม่ว่า transport จะว่าอย่างไร
// ★ correction P1-5: เพิ่ม ABORTED/INVALID_SIGNAL — external cancel/malformed signal ต้อง terminal เสมอ (ไม่ retry
//   ต่อทั้งที่ caller สั่งยกเลิกไปแล้ว หรือ signal ที่ส่งมาผิดรูปแบบตั้งแต่ต้น)
const CLASSIFIER_NEVER_RETRY = new Set([
  'MODEL_IDENTITY_MISSING', 'MODEL_PIN_MISMATCH', 'DEADLINE_EXCEEDED', 'PIN_INVALID', 'INVALID_SIGNAL',
  'INVALID_RESOLVED_MODEL', 'JSON_PARSE_FAILED', 'SCHEMA_VALIDATION_FAILED', 'ABORTED',
]);
const CLASSIFIER_GENERIC_MESSAGE = 'Gemini classifier call failed (strict path)';
const CLASSIFIER_FIXED_MESSAGE = Object.freeze({
  NO_GEMINI_KEY: 'ยังไม่ได้ตั้งคีย์ Gemini สำหรับตัวจำแนกภาพเข้ม',
  INVALID_RESOLVED_MODEL: 'โมเดล Gemini ที่ resolve ได้จาก env ไม่ถูกต้อง',
  PIN_INVALID: 'pin ที่ส่งเข้าตัวจำแนกภาพเข้มไม่ถูกต้อง/ผิดรูปแบบ',
  INVALID_SIGNAL: 'signal ภายนอกที่ส่งเข้าตัวจำแนกภาพเข้มไม่ถูกต้อง/ผิดรูปแบบ',
  AI_BUSY: 'Gemini ไม่ว่างชั่วคราว',
  PROVIDER_ERROR: 'Gemini classifier request failed',
  ABORTED: 'Gemini classifier request was aborted',
  MODEL_IDENTITY_MISSING: 'Gemini ไม่ได้แจ้งรุ่นโมเดลจริงที่ใช้ตอบกลับมา',
  MODEL_PIN_MISMATCH: 'Gemini ตอบกลับด้วยโมเดลที่ต่างจาก pin ที่ล็อกไว้',
  ATTEMPT_TIMEOUT: 'Gemini classifier attempt exceeded its bounded timeout',
  DEADLINE_EXCEEDED: 'Gemini classifier deadline exceeded',
  JSON_PARSE_FAILED: 'Gemini classifier response was not valid JSON',
  SCHEMA_VALIDATION_FAILED: 'Gemini classifier response failed schema validation',
  GENERATION_FAILED: 'Gemini classifier generation phase failed to produce a result',
});

// ── descriptor-safe primitives (self-contained — ไม่ import จาก s5PinnedAi.js/megaAdapters.js) ──
function ownRead(obj, key) {
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return { present: false, value: undefined };
  let d;
  try { d = Object.getOwnPropertyDescriptor(obj, key); } catch { return { present: false, value: undefined }; }
  if (!d || !('value' in d)) return { present: false, value: undefined }; // accessor = ไม่เรียก getter, ถือว่าไม่มี
  return { present: true, value: d.value };
}
function isPlainObject(v) {
  if (nodeUtilTypes.isProxy(v)) return false; // ก่อนงาน reflective ใดๆ ทั้งสิ้น
  if (v === null || typeof v !== 'object') return false;
  let p;
  try { p = Object.getPrototypeOf(v); } catch { return false; }
  // ★ correction P2-4: JSON.parse/res.json() ไม่เคยสร้าง null-prototype object — ปฏิเสธด้วย (เดิมยอม p===null
  //   ผ่านผิด เปิดช่องให้ exotic null-prototype object หลบเลี่ยงเช็คได้) ต้องเป็น Object.prototype เป๊ะเท่านั้น
  return p === Object.prototype;
}
function isPlainArray(v) {
  if (nodeUtilTypes.isProxy(v)) return false;
  let isArr;
  try { isArr = Array.isArray(v); } catch { return false; }
  if (!isArr) return false;
  let p;
  try { p = Object.getPrototypeOf(v); } catch { return false; }
  return p === Array.prototype;
}
// object ที่มี "เฉพาะ" own-enumerable-data key ตาม requiredKeys เป๊ะ (ครบ+ไม่เกิน) — symbol/accessor/
// non-enumerable/proxy key = ปฏิเสธทั้งก้อน
function guardExactObject(obj, requiredKeys) {
  if (nodeUtilTypes.isProxy(obj)) return false;
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
    if (!d || !('value' in d) || d.enumerable !== true) return false; // accessor หรือ non-enumerable
  }
  return true;
}
// dense plain array อ่านผ่าน descriptor ล้วน (length + ทุก index enumerable data, ไม่มี key แถม) —
// hole/accessor/non-enumerable/proxy/เกิน cap = null
function guardArray(v, cap) {
  if (nodeUtilTypes.isProxy(v)) return null;
  if (!isPlainArray(v)) return null;
  let lenD;
  try { lenD = Object.getOwnPropertyDescriptor(v, 'length'); } catch { return null; }
  if (!lenD || !('value' in lenD) || !Number.isSafeInteger(lenD.value) || lenD.value < 0 || lenD.value > cap) return null;
  const out = [];
  for (let i = 0; i < lenD.value; i++) {
    let d;
    try { d = Object.getOwnPropertyDescriptor(v, String(i)); } catch { return null; }
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
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
// ★ correction P1-2: model-identity ต้องผ่าน grammar เป๊ะ — ตัวอักษร a-z/ตัวเลข/. _ - เท่านั้น ขึ้นต้นด้วย
//   alphanumeric เสมอ — ปฏิเสธ whitespace/control character ที่ไหนก็ตามในสตริง (ไม่ใช่แค่หัว-ท้าย), slash,
//   query/hash delimiter (? #), uppercase, unicode ทั้งหมด — ห้าม trim/normalize เด็ดขาด (ไม่ผ่าน grammar =
//   ปฏิเสธตรงๆ) — verified: ไม่มี trailing-newline quirk ใน JS $ (ต่างจากบาง regex engine อื่น)
const MODEL_ID_GRAMMAR = /^[a-z0-9][a-z0-9._-]*$/;
const isExactModelId = (v, maxLen) => typeof v === 'string' && v.length > 0 && v.length <= maxLen && MODEL_ID_GRAMMAR.test(v);
// ★ correction P1-2: บาง field (โดยเฉพาะ modelVersion จาก provider) ต้องเป็น own ENUMERABLE data descriptor
//   เท่านั้น — ต่างจาก ownRead() ทั่วไปที่ยอม non-enumerable data descriptor (ใช้กับ error-probe/pin ที่ไม่ต้อง
//   เข้มขนาดนี้) accessor/non-enumerable/proxy = ไม่มีอยู่ (ปฏิเสธ)
function ownReadEnumerable(obj, key) {
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return { present: false, value: undefined };
  let d;
  try { d = Object.getOwnPropertyDescriptor(obj, key); } catch { return { present: false, value: undefined }; }
  if (!d || !('value' in d) || d.enumerable !== true) return { present: false, value: undefined };
  return { present: true, value: d.value };
}

// ★ resolve ครั้งเดียวต่อ vetImages/triageLibrary invocation — caller (libraryTriage.js) เรียกก่อนเริ่มแบตช์แรก
//   แล้วส่ง pin เดิมเป๊ะเข้าทุกแบตช์/ทุก retry — ไม่ผ่าน geminiModel() (เดิม ยังใช้ได้กับสาย legacy อื่นเหมือนเดิม)
export function resolveGeminiClassifierPin() {
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  if (!isExactModelId(model, MAX_PIN_MODEL_LEN)) {
    const e = new Error(CLASSIFIER_FIXED_MESSAGE.INVALID_RESOLVED_MODEL);
    e.errorType = 'INVALID_RESOLVED_MODEL';
    throw e;
  }
  return Object.freeze({ model });
}

const CLASSIFIER_PIN_KEYS = ['model'];
// ★ defense-in-depth: ตรวจ pin ที่ได้รับซ้ำ (descriptor-safe, ปฏิเสธ proxy) ก่อนเรียก provider ใดๆ — ไม่ trust
//   ค่าที่ resolveGeminiClassifierPin() ส่งมาเฉยๆ (กันการ mutate/swap หลัง resolve)
function validateClassifierPin(pin) {
  if (nodeUtilTypes.isProxy(pin)) return null;
  if (!guardExactObject(pin, CLASSIFIER_PIN_KEYS)) return null;
  const model = ownRead(pin, 'model').value;
  if (!isExactModelId(model, MAX_PIN_MODEL_LEN)) return null;
  return { model };
}

// requested ไม่ถูก revision-pin อยู่แล้ว (ไม่ลงท้าย -NNN 3 หลัก) + actual = requested + "-" + NNN (3 หลักเป๊ะ
// ไม่มีอะไรต่อท้ายอีก) เท่านั้นถึงนับ 'versioned_revision' — ไม่รับ sibling/family (-lite/-pro), latest remap,
// suffix ว่าง/ไม่ใช่เลข, models/ prefix, หรือช่องว่าง/case ต่างกัน (ห้าม trim/lowercase ทั้งสองฝั่ง)
function isThreeDigitRevisionOf(requested, actual) {
  if (typeof requested !== 'string' || typeof actual !== 'string') return false;
  if (requested.length === 0 || actual.length === 0) return false;
  if (requested !== requested.trim() || actual !== actual.trim()) return false;
  if (/-\d{3}$/.test(requested)) return false; // requested ต้องไม่ revision-pinned อยู่แล้ว
  const prefix = requested + '-';
  if (!actual.startsWith(prefix)) return false;
  const suffix = actual.slice(prefix.length);
  return /^\d{3}$/.test(suffix);
}
function classifyIdentity(requested, actual) {
  if (actual === null) return null;
  if (actual === requested) return 'exact';
  if (isThreeDigitRevisionOf(requested, actual)) return 'versioned_revision';
  return null;
}
// ★ correction P1-2: อ่าน modelVersion จาก own ENUMERABLE data descriptor เท่านั้น (ownReadEnumerable) + grammar
//   เข้มเดียวกับ isExactModelId — ไม่เรียก getter/trap ใดๆ ไม่ trim/normalize — data ต้องเป็น plain object ก่อน
//   (กัน exotic/custom-prototype top-level response)
function readModelVersion(data) {
  if (nodeUtilTypes.isProxy(data)) return null;
  if (!isPlainObject(data)) return null;
  const r = ownReadEnumerable(data, 'modelVersion');
  if (!r.present || !isExactModelId(r.value, MAX_PIN_MODEL_LEN)) return null;
  return r.value;
}
const MAX_TOKEN_COUNT = 10000000; // เพดานกว้างพอ (10M token) กันค่าเพี้ยน/บิดเบือน ไม่ใช่ limit ธุรกิจจริง
// ★ correction P2: nonnegative safe integer ที่มีเพดาน — ห้าม NaN/เศษส่วน/ติดลบ/ค่ามหึมาเข้า cost logging
const isSafeTokenCount = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_TOKEN_COUNT;
// ดึงเฉพาะฟิลด์ตัวเลขที่ recordLLM อ่านจริง (promptTokenCount/candidatesTokenCount) เป็น literal object ใหม่
// — ห้ามส่ง data.usageMetadata ดิบ (untrusted จาก provider) เข้า recordLLM ที่ dot-access ตรงๆ ไม่ descriptor-safe
function safeUsageMetadata(data) {
  if (nodeUtilTypes.isProxy(data)) return undefined;
  if (!isPlainObject(data)) return undefined;
  const r = ownRead(data, 'usageMetadata');
  if (!r.present || !isPlainObject(r.value)) return undefined;
  const out = {};
  const p = ownRead(r.value, 'promptTokenCount');
  if (p.present && isSafeTokenCount(p.value)) out.promptTokenCount = p.value;
  const c = ownRead(r.value, 'candidatesTokenCount');
  if (c.present && isSafeTokenCount(c.value)) out.candidatesTokenCount = c.value;
  return out;
}
const CLASSIFIER_MAX_TEXT_LEN = 200000; // เพดานความยาวข้อความรวมก่อน JSON.parse — กว้างพอสำหรับแบตช์จริง (≤~50 เฟรม)
// อ่านข้อความ candidates[0].content.parts[].text แบบ descriptor-safe ล้วน (ห้าม optional-chaining dot-access
// บน response ดิบจาก provider) — โครงสร้างผิด/ type ผิดจุดใดจุดหนึ่ง = null (JSON_PARSE_FAILED ที่ผู้เรียก)
function strictGeminiText(data) {
  if (nodeUtilTypes.isProxy(data)) return null;
  if (!isPlainObject(data)) return null;
  const candidatesArr = guardArray(ownRead(data, 'candidates').value, 8);
  if (candidatesArr === null || candidatesArr.length === 0) return null;
  const c0 = candidatesArr[0];
  if (!isPlainObject(c0)) return null;
  const content = ownRead(c0, 'content').value;
  if (!isPlainObject(content)) return null;
  const partsArr = guardArray(ownRead(content, 'parts').value, 64);
  if (partsArr === null) return null;
  let text = '';
  for (const p of partsArr) {
    if (!isPlainObject(p)) return null;
    const tR = ownRead(p, 'text');
    if (tR.present) {
      if (typeof tR.value !== 'string') return null;
      // ★ correction P2-1: เพดานความยาวรวมก่อน JSON.parse — เกิน = ปฏิเสธทั้งก้อน ห้ามสะสมไม่มีเพดาน/ตัดทอนเงียบๆ
      if (text.length + tR.value.length > CLASSIFIER_MAX_TEXT_LEN) return null;
      text += tR.value;
    }
  }
  return text;
}
// exact JSON parse — ห้าม fence-strip/brace-extract/coerce (ต่างจาก safeParse เดิมโดยตั้งใจ — สายนี้เข้มกว่า)
function strictJsonParse(text) {
  if (typeof text !== 'string') return { ok: false };
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false }; }
}

// ── schema: geminiClassifyFrames items.v1 — mirror ของพรอมป์ด้านล่างเป๊ะ (ตาม FILE_SHOT_TAG mode) ──
const CLASSIFIER_CATEGORY_ENUM = new Set(['face-emotional', 'face-neutral', 'context', 'group', 'document', 'other']);
const CLASSIFIER_EMOTION_ENUM = new Set(['happy', 'laugh', 'warm', 'serious', 'sad', 'worried', 'shock', 'angry', 'none']);
const CLASSIFIER_ITEM_KEYS_BASE = ['index', 'category', 'quality', 'relevant', 'person', 'persons', 'emotion', 'clean', 'faceCount', 'faceBox', 'peopleBox', 'note'];
const CLASSIFIER_ITEM_KEYS_SCENE = ['index', 'category', 'quality', 'relevant', 'newsScene', 'person', 'persons', 'emotion', 'clean', 'faceCount', 'faceBox', 'peopleBox', 'note'];
const CLASSIFIER_BOX_KEYS = ['x', 'y', 'w', 'h'];

function readClassifierBox(v) {
  if (v === null) return { ok: true, value: null };
  if (!guardExactObject(v, CLASSIFIER_BOX_KEYS)) return { ok: false };
  const x = ownRead(v, 'x').value, y = ownRead(v, 'y').value, w = ownRead(v, 'w').value, h = ownRead(v, 'h').value;
  for (const n of [x, y, w, h]) { if (!isFiniteNum(n) || n < 0 || n > 1) return { ok: false }; }
  if (x + w > 1) return { ok: false };
  if (y + h > 1) return { ok: false };
  return { ok: true, value: { x, y, w, h } };
}
function readClassifierItem(raw, requiredKeys, fileTagOn) {
  if (!guardExactObject(raw, requiredKeys)) return null;
  const index = ownRead(raw, 'index').value;
  if (!Number.isInteger(index) || index < 0) return null;
  const category = ownRead(raw, 'category').value;
  if (!CLASSIFIER_CATEGORY_ENUM.has(category)) return null;
  const quality = ownRead(raw, 'quality').value;
  if (!isFiniteNum(quality) || quality < 1 || quality > 10) return null;
  const relevant = ownRead(raw, 'relevant').value;
  if (!isBoolLiteral(relevant)) return null;
  let newsScene;
  if (fileTagOn) {
    newsScene = ownRead(raw, 'newsScene').value;
    if (!isBoolLiteral(newsScene)) return null;
  }
  const person = ownRead(raw, 'person').value;
  if (person !== null && !isNonBlankStr(person, CLASSIFIER_MAX_STR)) return null;
  const personsArr = guardArray(ownRead(raw, 'persons').value, CLASSIFIER_MAX_LIST);
  if (personsArr === null) return null;
  const persons = [];
  for (const p of personsArr) {
    if (!isNonBlankStr(p, CLASSIFIER_MAX_STR)) return null;
    persons.push(p);
  }
  const emotion = ownRead(raw, 'emotion').value;
  if (!CLASSIFIER_EMOTION_ENUM.has(emotion)) return null;
  const clean = ownRead(raw, 'clean').value;
  if (!isBoolLiteral(clean)) return null;
  const faceCount = ownRead(raw, 'faceCount').value;
  if (!Number.isInteger(faceCount) || faceCount < 0 || faceCount > 64) return null;
  const faceBoxR = readClassifierBox(ownRead(raw, 'faceBox').value);
  if (!faceBoxR.ok) return null;
  const peopleBoxR = readClassifierBox(ownRead(raw, 'peopleBox').value);
  if (!peopleBoxR.ok) return null;
  const note = ownRead(raw, 'note').value;
  if (typeof note !== 'string' || note.length > CLASSIFIER_MAX_STR) return null;
  const out = { index, category, quality, relevant, person, persons, emotion, clean, faceCount, faceBox: faceBoxR.value, peopleBox: peopleBoxR.value, note };
  if (fileTagOn) out.newsScene = newsScene;
  return out;
}
// {items:[...]} เป๊ะ — ต้องมีครบ 1 รายการต่อทุก index ที่ส่งไป (0..expectedCount-1) ไม่ขาด/ไม่เกิน/ไม่ซ้ำ —
// พังจุดใดจุดหนึ่ง = ปฏิเสธทั้งแบตช์ (ไม่มี partial filtering/truthiness/default-positive/safeParse fallback)
function validateClassifierItemsV1(raw, expectedCount, fileTagOn) {
  if (!guardExactObject(raw, ['items'])) return { ok: false, reason: 'TOP_LEVEL_SHAPE' };
  const itemsArr = guardArray(ownRead(raw, 'items').value, expectedCount);
  if (itemsArr === null) return { ok: false, reason: 'items' };
  const requiredKeys = fileTagOn ? CLASSIFIER_ITEM_KEYS_SCENE : CLASSIFIER_ITEM_KEYS_BASE;
  const seen = new Set();
  const out = [];
  for (const rawItem of itemsArr) {
    const it = readClassifierItem(rawItem, requiredKeys, fileTagOn);
    if (it === null) return { ok: false, reason: 'items[]' };
    if (seen.has(it.index)) return { ok: false, reason: 'items[] duplicate index' };
    seen.add(it.index);
    out.push(it);
  }
  if (seen.size !== expectedCount) return { ok: false, reason: 'items[] count mismatch' };
  for (let i = 0; i < expectedCount; i++) { if (!seen.has(i)) return { ok: false, reason: 'items[] missing index' }; }
  return { ok: true, value: out };
}

// ── guaranteed terminal carrier (mirror ของแนวทาง s5PinnedAi.js — คนละไฟล์ ไม่ import ข้าม) ──
function readErrorProbe(rawErr) {
  const probe = { message: null, errorType: null, status: null };
  if (rawErr === null || typeof rawErr !== 'object') return probe;
  if (nodeUtilTypes.isProxy(rawErr)) return probe;
  const msgR = ownRead(rawErr, 'message');
  if (msgR.present && typeof msgR.value === 'string') probe.message = msgR.value;
  const typeR = ownRead(rawErr, 'errorType');
  if (typeR.present && typeof typeR.value === 'string') probe.errorType = typeR.value;
  const statusR = ownRead(rawErr, 'status');
  if (statusR.present && typeof statusR.value === 'number' && Number.isFinite(statusR.value)) probe.status = statusR.value;
  return probe;
}
function assembleClassifierError(errorType, retryable, pin, state) {
  const safeType = CLASSIFIER_KNOWN_ERROR_TYPES.has(errorType) ? errorType : 'PROVIDER_ERROR';
  const message = CLASSIFIER_FIXED_MESSAGE[safeType] || CLASSIFIER_GENERIC_MESSAGE;
  const out = new Error(message);
  out.errorType = safeType;
  out._classifierRetryable = CLASSIFIER_NEVER_RETRY.has(safeType) ? false : retryable;
  out.provenance = Object.freeze({
    requestedModel: pin.model,
    actualModel: null,
    actualModelVersion: state.lastActualModelVersion,
    modelMatchMode: null,
    provider: 'gemini',
    schemaVersion: CLASSIFIER_SCHEMA_VERSION,
    attemptCount: state.attemptCount,
    repairCount: 0,
    errorType: safeType,
  });
  return out;
}
function sanitizeClassifierCallback(err) {
  // ★ err มาจาก assembleClassifierError เสมอ ณ จุดที่เรียกฟังก์ชันนี้ — object ที่เราสร้างเอง ปลอดภัยเต็มที่
  return {
    errorType: (typeof err?.errorType === 'string') ? err.errorType : null,
    message: (typeof err?.message === 'string') ? err.message : CLASSIFIER_GENERIC_MESSAGE,
  };
}

// ── real AbortController cancellation (mirror ของ s5PinnedAi.js — คนละไฟล์ ไม่ import ข้าม) ──
function makeClassifierAttemptController(parentSignal, attemptMs) {
  const child = new AbortController();
  const timer = setTimeout(() => {
    child.abort(Object.assign(new Error('classifier attempt deadline'), { name: 'AbortError' }));
  }, attemptMs);
  const onParentAbort = () => child.abort(parentSignal.reason);
  if (parentSignal.aborted) {
    child.abort(parentSignal.reason);
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
function sleepOrAbortClassifier(ms, signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let onAbort;
    // ★ correction P2-3: ลบ listener ตอน timer ชนะด้วย (เดิมลบเฉพาะตอน abort ชนะ ทาง once:true จะลบเองเมื่อ abort
    //   ยิงในอนาคต แต่ถ้า signal ยังไม่ตายและมีอายุยาวกว่านี้ listener ที่ timer ชนะแล้วค้างไว้ก็เป็น leak โดยไม่จำเป็น)
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    onAbort = () => { clearTimeout(t); resolve(); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
function raceClassifierAgainstAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(Object.assign(new Error('classifier call aborted (deadline reached)'), { errorType: 'ABORTED' }));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); if (settled) return; settled = true; resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); if (settled) return; settled = true; reject(e); },
    );
  });
}

// ★ correction P1-5: จำแนก abort ที่ parent เห็นว่ามาจาก "external signal" (EXTERNAL_ABORT tag) vs "internal
//   90s wrapper timer" (WRAPPER_DEADLINE tag/ไม่มี tag) vs parent ยังไม่ abort เลย (= per-attempt child timeout)
//   — อ่าน parentController.signal.reason ตรงๆ ปลอดภัย เพราะเป็น Error ที่เราสร้างเองเสมอ (WRAPPER_DEADLINE
//   timer/EXTERNAL_ABORT cascade) ไม่ใช่ค่าจาก provider/ภายนอกที่ต้อง descriptor-safe อ่าน
function classifyAbortErrorType(parentController) {
  if (!parentController.signal.aborted) return 'ATTEMPT_TIMEOUT';
  const reason = parentController.signal.reason;
  if (reason && typeof reason === 'object' && reason._reasonTag === 'EXTERNAL_ABORT') return 'ABORTED';
  return 'DEADLINE_EXCEEDED';
}

// ยิง Gemini จริง 1 ครั้ง — ผูก AbortSignal จริงเสมอ (ทั้ง fetch เองและ call ทั้งก้อน กัน post-fetch ค้าง)
async function classifierAttemptOnce({ url, body, pin, state, parentController }) {
  const { signal, cleanup } = makeClassifierAttemptController(parentController.signal, CLASSIFIER_ATTEMPT_TIMEOUT_MS);
  try {
    const res = await raceClassifierAgainstAbort(
      fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal }),
      signal,
    );
    // ★ correction P1-3: เช็ค res.ok/status ก่อนอ่าน body เสมอ (res เป็น Response object จริงจาก fetch ของเราเอง
    //   — .ok/.status เป็น native getter เชื่อถือได้) — non-2xx ห้ามเรียก/parse provider error body เลย throw
    //   เฉพาะ fixed redacted typed transport error เท่านั้น
    if (!res.ok) {
      const busy = res.status >= 500 || res.status === 429;
      const e = new Error('classifier transport error');
      e.status = res.status;
      e.errorType = busy ? 'AI_BUSY' : 'PROVIDER_ERROR';
      throw e;
    }
    // ★ correction P1-3: race res.json() เองด้วย signal เดียวกัน — body อ่านค้าง (stream ช้า/hostile) ต้องโดน
    //   attempt/parent deadline ตัดเหมือน fetch เอง ไม่ปล่อยค้างเกิน cleanup · ห้าม .catch(()=>({})) กลืน abort
    //   rejection (เดิมกลืนทั้ง JSON parse error และ abort rejection ปนกัน ทำให้ timeout กลายเป็น "สำเร็จ" ปลอม)
    const d = await raceClassifierAgainstAbort(res.json(), signal);
    return d;
  } catch (rawErr) {
    const probe = readErrorProbe(rawErr);
    const typeOverride = probe.errorType === 'ABORTED' ? classifyAbortErrorType(parentController) : null;
    const retryable = typeOverride ? false : isRetryable({ status: probe.status, message: probe.message || '' });
    throw assembleClassifierError(typeOverride || probe.errorType, retryable, pin, state);
  } finally {
    cleanup();
  }
}

// ★ correction P1-5: signal ภายนอก optional — validate ก่อนงานใดๆ โดยไม่เรียก getter/trap เลย (Proxy/type ผิด
//   = ไม่ใช่ signal ที่ใช้ได้) · undefined = ไม่มี external signal ล้วนๆ (คนละกรณีกับ "ส่งมาแต่ผิดรูปแบบ")
function isMalformedExternalSignal(signal) {
  if (signal === undefined) return false; // ไม่ใช่ malformed — แค่ "ไม่ได้ส่งมา"
  if (nodeUtilTypes.isProxy(signal)) return true;
  if (signal === null || typeof signal !== 'object') return true;
  return false;
}

// entry point ภายใน — ≤2 attempt (เฉพาะ retryable transport/status), identity check, parse/schema, cost log
// ทั้งหมดอยู่ใน parent AbortController เดียว (deadline เดียว) — ไม่มี repair (repairCount เป็น 0 เสมอ)
// ★ correction P1-5: externalSignal (ผ่านด่าน isMalformedExternalSignal มาแล้วที่ geminiClassifyFrames) ผูกเข้า
//   parentController เดียวกัน — ไม่แทนที่ 90s wrapper deadline เดิม แค่เพิ่มแหล่ง abort อีกทาง (cascade เดียวกับ
//   ที่ child attempt controller ผูกกับ parent อยู่แล้ว) — ใช้ platform contract ปกติ (.aborted/addEventListener)
//   เพราะ signal ผ่านด่าน validate มาแล้ว ไม่ใช่ payload ข้อมูลที่ต้อง descriptor-safe อ่านค่า
async function runClassifierStrict({ url, body, pin, onRetry, cost, expectedCount, fileTagOn, externalSignal }) {
  const state = { attemptCount: 0, lastActualModelVersion: null };
  const parentController = new AbortController();
  const parentTimer = setTimeout(() => {
    parentController.abort(Object.assign(new Error(`Gemini classifier deadline exceeded (${CLASSIFIER_WRAPPER_DEADLINE_MS}ms)`), { name: 'AbortError', _reasonTag: 'WRAPPER_DEADLINE' }));
  }, CLASSIFIER_WRAPPER_DEADLINE_MS);

  const hasExternal = externalSignal !== undefined;
  let onExternalAbort = null;
  if (hasExternal) {
    onExternalAbort = () => {
      parentController.abort(Object.assign(new Error('external signal aborted'), { name: 'AbortError', _reasonTag: 'EXTERNAL_ABORT' }));
    };
    if (externalSignal.aborted) onExternalAbort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    // ★ correction P1-5 (verification finding): signal ที่ถูก abort อยู่แล้วตั้งแต่ก่อนเริ่ม (pre-aborted) ต้อง
    //   ไม่ไปถึงชั้น transport เลยแม้แต่ครั้งเดียว — เช็คทันทีก่อนเข้า attempt loop (เหมือน PIN_INVALID/
    //   INVALID_SIGNAL ที่ fail fast ก่อน getKey()/fetch ใดๆ) ไม่ปล่อยให้ classifierAttemptOnce เรียก fetch()
    //   ด้วย signal ที่ตายไปแล้วโดยไม่จำเป็น
    if (parentController.signal.aborted) {
      throw assembleClassifierError(classifyAbortErrorType(parentController), false, pin, state);
    }
    let lastErr = null;
    let data = null;
    for (let i = 1; i <= CLASSIFIER_MAX_ATTEMPTS; i++) {
      state.attemptCount++;
      try {
        data = await classifierAttemptOnce({ url, body, pin, state, parentController });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (i >= CLASSIFIER_MAX_ATTEMPTS || !err._classifierRetryable) throw err;
        try { if (typeof onRetry === 'function') onRetry(i, CLASSIFIER_RETRY_GAP_MS, sanitizeClassifierCallback(err)); } catch { /* ห้าม callback ล้มลาม */ }
        await sleepOrAbortClassifier(CLASSIFIER_RETRY_GAP_MS, parentController.signal);
        if (parentController.signal.aborted) throw assembleClassifierError(classifyAbortErrorType(parentController), false, pin, state);
      }
    }
    if (!data) throw lastErr || assembleClassifierError('GENERATION_FAILED', false, pin, state);

    const actualModelVersion = readModelVersion(data);
    state.lastActualModelVersion = actualModelVersion;
    const matchMode = classifyIdentity(pin.model, actualModelVersion);
    if (!matchMode) {
      throw assembleClassifierError(actualModelVersion === null ? 'MODEL_IDENTITY_MISSING' : 'MODEL_PIN_MISMATCH', false, pin, state);
    }

    const text = strictGeminiText(data);
    const parse = text === null ? { ok: false } : strictJsonParse(text);
    if (!parse.ok) throw assembleClassifierError('JSON_PARSE_FAILED', false, pin, state);
    const schemaResult = validateClassifierItemsV1(parse.value, expectedCount, fileTagOn);
    if (!schemaResult.ok) throw assembleClassifierError('SCHEMA_VALIDATION_FAILED', false, pin, state);

    if (cost) {
      const usage = safeUsageMetadata(data);
      const note = 'actualModelVersion=' + (actualModelVersion || 'null') + ' mode=' + matchMode;
      try {
        await raceClassifierAgainstAbort(
          recordLLM({ provider: 'gemini', model: pin.model, usage, step: cost.step, caseId: cost.caseId, note }),
          parentController.signal,
        );
      } catch (costErr) {
        // ★ correction P1-4: cost-log เอง (recordLLM) ไม่ throw อยู่แล้ว (best-effort ภายในตัวมันเอง) — rejection
        //   ที่นี่มาจาก raceClassifierAgainstAbort เท่านั้น (parent ยกเลิกระหว่าง/หลัง cost-log) → terminal จริง
        //   ห้ามกลืนทิ้งแล้วคืน success ปลอม (เดิม .catch(()=>{}) กลืนทุกกรณีปนกัน)
        const probe = readErrorProbe(costErr);
        if (probe.errorType === 'ABORTED') {
          throw assembleClassifierError(classifyAbortErrorType(parentController), false, pin, state);
        }
        // ไม่ใช่ ABORTED (ไม่ควรเกิดจริงเพราะ recordLLM ไม่ throw) — ปล่อยผ่านแบบ best-effort เดิมด้วยความระมัดระวัง
      }
    }

    // ★ correction P1-4: เช็คสถานะ parent controller "ทันทีก่อน" return success เสมอ (ครอบทั้งเส้นทางมี/ไม่มี
    //   cost logging) — deadline/external abort ที่ยิงในช่วงนี้ต้องไม่ปล่อยให้ผ่านเป็น success
    if (parentController.signal.aborted) {
      throw assembleClassifierError(classifyAbortErrorType(parentController), false, pin, state);
    }

    return {
      items: schemaResult.value,
      evidence: Object.freeze({
        requestedModel: pin.model,
        actualModel: null, // Gemini ไม่มี field "model" แยกจาก modelVersion — ไม่ fabricate หลักฐานที่ไม่มีจริง
        actualModelVersion,
        modelMatchMode: matchMode,
        provider: 'gemini',
        schemaVersion: CLASSIFIER_SCHEMA_VERSION,
        attemptCount: state.attemptCount,
        repairCount: 0,
      }),
    };
  } finally {
    clearTimeout(parentTimer);
    if (hasExternal && onExternalAbort) {
      try { externalSignal.removeEventListener('abort', onExternalAbort); } catch { /* best-effort cleanup */ }
    }
  }
}

export async function geminiClassifyFrames({ frames, subjects, newsGist, onRetry, caseId, pin, signal }) {
  const COST_STEP = 'ประกอบปก (จับคู่ภาพ)';
  // ★ Batch 5B2: pin ต้องมาจาก resolveGeminiClassifierPin() ของ caller เท่านั้น (vetImages/triageLibrary
  //   resolve ครั้งเดียว ส่งเดิมเป๊ะทุกแบตช์) — ตรวจซ้ำ descriptor-safe ก่อนงานใดๆ ทั้งสิ้น (ก่อนแม้แต่ getKey())
  const validPin = validateClassifierPin(pin);
  if (!validPin) {
    const e = new Error(CLASSIFIER_FIXED_MESSAGE.PIN_INVALID);
    e.errorType = 'PIN_INVALID';
    e.provenance = Object.freeze({
      requestedModel: null, actualModel: null, actualModelVersion: null, modelMatchMode: null,
      provider: 'gemini', schemaVersion: CLASSIFIER_SCHEMA_VERSION, attemptCount: 0, repairCount: 0, errorType: 'PIN_INVALID',
    });
    throw e;
  }
  // ★ correction P1-5: signal ภายนอก optional — validate ก่อนงานใดๆ ทั้งสิ้น (ก่อนแม้แต่ getKey()) โดยไม่เรียก
  //   getter/trap ใดๆ (isMalformedExternalSignal เช็ค Proxy/type ล้วน ไม่แตะ property) · undefined = พฤติกรรม
  //   เดิม 100% (ไม่มี external signal)
  if (isMalformedExternalSignal(signal)) {
    const e = new Error(CLASSIFIER_FIXED_MESSAGE.INVALID_SIGNAL);
    e.errorType = 'INVALID_SIGNAL';
    e.provenance = Object.freeze({
      requestedModel: validPin.model, actualModel: null, actualModelVersion: null, modelMatchMode: null,
      provider: 'gemini', schemaVersion: CLASSIFIER_SCHEMA_VERSION, attemptCount: 0, repairCount: 0, errorType: 'INVALID_SIGNAL',
    });
    throw e;
  }
  const names =
    (subjects || []).map((s) => s.name).filter(Boolean).join(', ') || 'บุคคลในข่าว';

  // ★ 8 ก.ค. (ผู้ใช้อนุมัติเฟส A "ป้ายภาพแฟ้ม"): พอร์เทรตคนในข่าวตัวจริงจากงานอื่น = เก็บ + ติดป้าย newsScene=false
  //   ปิดกลับพฤติกรรมเดิม (แฟ้ม=ทิ้ง): FILE_SHOT_TAG=0
  const FILE_TAG = process.env.FILE_SHOT_TAG !== '0';
  // ★ 9 ก.ค. (เคาะ 6 แหล่ง): เกณฑ์ clean เดิมไม่ระบุ คอลลาจ/แถบกราฟิกหัวข่าว/ปุ่ม▶ ชัด (มีแต่ใน junkScan
  //   ที่สายอัตโนมัติไม่เรียก) → ปกคลิปสำนักข่าวรอด clean=true มาโผล่บนปกได้ · ปิดเกณฑ์เสริม: CLEAN_COVER_JUNK=0
  const COVER_JUNK = process.env.CLEAN_COVER_JUNK !== '0';

  const promptText = `จำแนกภาพแต่ละรูป (กำกับด้วย "รูปที่ N:") เพื่อนำไปทำ "ปกข่าวคอลลาจ"
บุคคล/สิ่งของหลักในข่าว:
${subjectsBlock(subjects)}${newsGist ? `\nแก่นข่าว: ${newsGist}` : ''}

ตอบเป็น JSON เท่านั้น:
{ "items": [ { "index": <เลขรูป>, "category": "...", "quality": <1-10>, "relevant": true/false,${FILE_TAG ? ' "newsScene": true/false,' : ''} "person": "<ชื่อคนหลัก หรือ null>", "persons": ["<ชื่อคนในข่าวทุกคนที่เห็นชัดในรูป>"], "emotion": "<อารมณ์สีหน้า>", "clean": true/false, "faceCount": <จำนวนใบหน้าที่เห็นชัด>, "faceBox": {"x":0-1,"y":0-1,"w":0-1,"h":0-1} หรือ null, "peopleBox": {"x":0-1,"y":0-1,"w":0-1,"h":0-1} หรือ null, "note": "สั้นๆ" } ] }

relevant = "ภาพนี้เกี่ยวกับข่าวนี้ไหม" (แยกจากคุณภาพ!) —
          true = มี "บุคคล/สิ่งของ/สถานที่/เหตุการณ์ในข่าวนี้" **แม้ภาพจะมีลายน้ำ/ตัวหนังสือ/เป็นการ์ด/คุณภาพต่ำ** (ยังเกี่ยว = เก็บไว้)
          false = "ไม่เกี่ยวเลย" เท่านั้น: คนอื่น/ดาราคนอื่นที่ไม่ใช่ในข่าว, หัวข้อ/เหตุการณ์อื่น, ภาพสต็อก/โฆษณา/วัตถุมั่วที่ไม่ใช่ของคนในข่าว, กราฟิก/ภาพประกอบที่ไม่เกี่ยว
          ⚠️ อย่าตี relevant=false เพราะ "ภาพไม่สวย/มีลายน้ำ/มีตัวหนังสือ" — นั่นคือเรื่อง clean ไม่ใช่ relevant
          🏞️ ภาพ "สถานที่/บริบท" ที่ไม่มีคนในข่าว (สำคัญ): relevant=true เฉพาะเมื่อเป็นสถานที่/วัตถุ "เฉพาะของข่าวนี้"
          ที่เชื่อมโยงได้จริง (บ้าน/สิ่งของที่ข่าวพูดถึง, ป้ายชื่อสถานที่ที่ข่าวเอ่ย, เอกสาร/หลักฐานของข่าว, ฉากเหตุการณ์จริง)
          — วิวทิวทัศน์ทั่วไป/ภาพมุมกว้างของหมู่บ้าน-อำเภอ-จังหวัด/ภาพประกอบพื้นที่ ที่ไม่มีจุดเชื่อมชัดกับข่าวนี้ = relevant=false
          (ภาพบริบทต้องเกี่ยวกับข่าวโดยตรง ไม่ใช่แค่ "ถ่ายในจังหวัดเดียวกัน")${FILE_TAG ? `
          🧑‍🎨 พอร์เทรต/ภาพชัดของ "บุคคลในข่าว" ที่ยืนยันหน้าได้ว่าตรงคนจริง: relevant=true เสมอ แม้ภาพจะมาจาก
          งาน/อีเวนต์/บริบทอื่นที่ไม่ใช่ข่าวนี้ (เป็นวัตถุดิบหน้าเด่น — ป้าย newsScene ด้านล่างจะแยกให้เอง)
          ⚠️ ต้องเป็น "คนถูกจริง" เท่านั้น — หน้าคล้าย/ไม่แน่ใจว่าใช่คนในข่าว = relevant=false เหมือนเดิม
newsScene = ป้ายแยก "ภาพข่าวจริง vs ภาพแฟ้ม" (ตอบทุกรูปที่ relevant=true):
          true  = ภาพจากเหตุการณ์/ฉากของ "ข่าวนี้" จริง (ลงพื้นที่ มอบของ ฉากในเรื่อง สถานที่/หลักฐานของข่าว)
          false = "ภาพแฟ้ม" — คนในข่าวตัวจริง แต่ถ่ายจากงาน/อีเวนต์/บริบทอื่น (พรมแดง งานเก่า ภาพโปรไฟล์ ละคร)
          ไม่แน่ใจว่าฉากไหน → ถ้าองค์ประกอบภาพเข้ากับแก่นข่าว = true, ถ้าดูเป็นภาพสวยจากงานอื่นชัด = false` : ''}
clean   = true ถ้าเป็นภาพ "สะอาด + เกี่ยวกับข่าวนี้จริง" เอาขึ้นเฟรมปกได้ (คนในข่าวเด่น หรือวัตถุที่เป็นของคนในข่าวจริง)
          false ถ้าเป็น "ขยะ" — ห้ามขึ้นเฟรม:
          (ก) ลายน้ำหนา, ปกคลิป/ปกวิดีโอ, ภาพปกขาว/การ์ด, ตัวหนังสือ/แคปชั่นทับ(โดยเฉพาะทับหน้า), โลโก้/ซับ/UI บดบัง, คนไม่เด่น/ถูกบัง/มีของมาบัง
          (ก2) ลายน้ำ/username/ชื่อเพจ "แม้ตัวเล็ก" (IG/TikTok/@handle/โลโก้มุม) ที่ทับตัวคนหรืออยู่กลางภาพ = clean=false (ครอปหลบไม่ได้) — ถ้าอยู่มุมภาพห่างตัวคนและครอปหลบได้ = clean=true แต่บันทึกใน note ว่า "ลายน้ำมุมX"
          (ก3) ภาพ "แคปโพสต์ทั้งใบ" (มีกรอบขาว/หัวโพสต์ชื่อบัญชี/ปุ่มไลก์/คอมเมนต์/UI แอป) = clean=false เสมอ — ภาพจริงข้างในต่อให้ดีก็ห้าม (กรอบ/หัวโพสต์จะติดขึ้นปก)${COVER_JUNK ? `
          (ก4) "ปกที่สำนักข่าว/ช่องทำแล้ว" = clean=false เสมอ: ภาพที่มีแถบกราฟิกพาดหัว/แถบสีทึบพร้อมตัวหนังสือข่าว,
          ภาพคอลลาจ/แบ่งหลายช่องในใบเดียว, การ์ด quote/กราฟิกล้วน, ปุ่มเล่น ▶/แถบเวลา/UI เครื่องเล่นวิดีโอ,
          โลโก้ช่อง+พาดหัวสไตล์ thumbnail คลิป — นี่คือ "ปกของคนอื่น" ไม่ใช่ภาพดิบ ห้ามเอามาขึ้นปกเราเด็ดขาด` : ''}
          (ข) ภาพ "วัตถุ" (บ้าน/รถ/สิ่งของ) ที่ "ไม่ใช่ของคนในข่าว" — บ้าน/รถทั่วไปจากแคตตาล็อก/โฆษณา/อสังหา ที่แค่ตรงคีย์เวิร์ด (ดูกฎความเป็นเจ้าของด้านล่าง)
          🏛️ ยกเว้น: "สถานที่สาธารณะ/หลักฐานที่ข่าวเอ่ยถึง" (ป้าย-อาคารมหาวิทยาลัย/โรงพยาบาล/วัด ตามแก่นข่าว, จดหมาย/เช็ค/เอกสาร) = clean=true แม้ไม่มีคน/มีตัวหนังสือบนป้าย-หลักฐาน (นั่นคือของที่ต้องการ)
          ⚠️ ข้อยกเว้นนี้ใช้กับ "ภาพถ่ายจริง" เท่านั้น — โลโก้/ตราสัญลักษณ์/emblem/กราฟิกล้วนของสถาบัน = clean=false เสมอ (เป็นกราฟิก ไม่ใช่ภาพถ่ายสถานที่)

${OWNERSHIP_RULES}

emotion = อารมณ์ "สีหน้า" จริงของคนในรูป เลือก 1 (ดูตาให้ดี อย่าเหมารวมเป็น serious/happy):
  happy(ยิ้มกว้าง ร่าเริงสดใส) / laugh(หัวเราะเห็นฟัน) / warm(ยิ้มอ่อนโยน/ซึ้ง/ภูมิใจ/รักใคร่ — สายตานุ่มนวลอบอุ่น เช่นข่าวครอบครัว-ภูมิใจ-กตัญญู) / serious(นิ่งเฉย เป็นทางการ ไม่ยิ้ม) / sad(เศร้า-ร้องไห้) / worried(กังวล-เครียด-หนักใจ) / shock(ตกใจ-อึ้ง) / angry(โกรธ) / none(ไม่มีคน/ไม่ชัด)
  ⚠️ "ยิ้มบางๆ ดูอบอุ่น/ภูมิใจ" = warm (ไม่ใช่ happy); "หน้านิ่งดูอ่อนโยน" ในข่าวโทนอบอุ่น = warm (ไม่ใช่ serious)

category เลือกจาก:
- "face-emotional" = โคลสอัพใบหน้า อารมณ์ชัด (ร้องไห้/เศร้า/ตกใจ/สะเทือนใจ/เครียด/ซึ้ง)
- "face-neutral"   = โคลสอัพใบหน้าชัด แต่สีหน้าเฉยๆ
- "context"        = มีเดียม/กว้าง เห็นฉาก/แอ็คชัน/ชีวิตประจำวัน
- "group"          = มีคนตั้งแต่ 2 คนขึ้นไป
- "document"       = เอกสาร/ตัวหนังสือ/กระดาษ
- "other"          = เบลอ/มืด/ไม่มีคน/ใช้ไม่ได้

person   = ชื่อบุคคลเป้าหมายที่เป็น "คนหลัก/หน้าใหญ่สุด" ในรูป เลือกจาก: ${names} — ถ้าไม่ใช่คนเป้าหมายหรือไม่แน่ใจให้ null
persons  = ชื่อ "คนในข่าวทุกคน" ที่เห็นชัดในรูป (array) — ภาพคู่/หมู่ต้องลงให้ครบ เช่นภาพพ่อกับลูก = ["นุ้ย เชิญยิ้ม","น้องภู"] ; ไม่มีคนในข่าว = []
  🔎 วิธีแยกตัวละครในภาพครอบครัว/คู่/หมู่ (สำคัญ): ใช้ "เพศ + วัย + บทบาท" ที่กำกับข้างชื่อด้านบน + "หัวข้อรูป(title)" ประกอบ —
     เช่น พ่อ=ชายผู้ใหญ่, ลูกชายวัย 23=ชายหนุ่ม, แม่=หญิง ; ในภาพรับปริญญาที่มีชายผู้ใหญ่ยืนข้างชายหนุ่มใส่ครุย → ชายหนุ่มใส่ครุย=ลูก, ชายผู้ใหญ่=พ่อ
  👶 กฎกันผิดคน (สำคัญมาก): subject ที่เป็น "คนนิรนาม/เด็ก/ชาวบ้าน" ที่ไม่มีรูปลักษณ์สาธารณะให้เทียบ (เช่น "เด็กหญิง (ลูกสาวของแม่บ้าน)") — ห้ามเดาว่าเด็ก/คนแปลกหน้าในรูปคือคนนั้น! ให้ person=null และ **clean=false** (เอาเด็ก/คนแปลกหน้าที่ยืนยันไม่ได้ขึ้นปก = ผิดคน ร้ายแรงมาก) ; แมป person/persons ได้เฉพาะ 2 กรณีเท่านั้น:
     (1) "คนดัง/ดาราที่จดจำหน้าได้จริง"
     (2) คนนิรนามที่ "องค์ประกอบในภาพ" ยืนยันเอง — เห็นอยู่ในฉากเหตุการณ์ของข่าวนี้จริง (เช่น ยืนหน้าบ้านหลังเดิมในข่าว / กำลังรับมอบของคู่กับคนดังในข่าว) + เพศ/วัยตรงกับที่กำกับ
  🚫 "แคปชั่น/หัวโพสต์โซเชียล/ชื่อเพจ/ชื่อไฟล์/คำค้น" ไม่นับเป็นหลักฐานยืนยันตัวตนเด็ดขาด — โพสต์เพจ/คอลลาจชอบปนภาพคนละเรื่อง (บทเรียนจริง: คอลลาจเพจรวมดาราแปะรูปหญิงนิรนาม → ถูกเดาเป็น "ป้าหน่อย" = ผิดคน) ; ภาพบุคคลเดี่ยวๆ ที่ไม่มีฉากข่าวช่วยยืนยัน = person=null เสมอ
  🧑‍🤝‍🧑 กฎ "ชื่อพ้อง/ไม่ใช่คนดังระดับจำหน้าได้" (สำคัญ — กันผิดคนจากชื่อซ้ำ): ถ้าคนในข่าว "ไม่ใช่ดารา/บุคคลสาธารณะที่คนทั่วไปจำหน้าได้จริง" (เช่น ครู/ชาวบ้าน/เจ้าของร้าน/พยาบาล ที่ชื่อหรือฉายาซ้ำกับคนอื่นได้ง่าย เช่น "ครูปลา" "หมอเอ") — ห้ามแมป person จาก "หน้าคล้าย + ตรงคำค้น" เพียงอย่างเดียว เพราะ Google คืน "คนละคนที่ชื่อพ้อง" ได้บ่อย · ต้องมี "ฉาก/เหตุการณ์/สถานที่/ของ/คนอื่นในข่าวนี้" ในภาพช่วยยืนยันด้วย ไม่งั้น person=null (ตรงคำค้นได้ภาพมา ≠ ยืนยันว่าเป็นคนคนนั้น)
faceCount= จำนวนใบหน้าคนที่เห็น "ชัด" ในรูป (เต็มหน้า ไม่ใช่หน้าเบลอ/ด้านหลัง)
faceBox  = กรอบใบหน้า "คนหลัก" เป็นสัดส่วน 0-1 (x,y = มุมซ้ายบนของกรอบ) ถ้าไม่มีใบหน้าให้ null
peopleBox= กรอบครอบ "ตัวคนทุกคนรวมกัน" (normalized 0-1) เฉพาะเมื่อมี 2 คนขึ้นไปที่เห็นชัดทั้งคู่ ไม่งั้น null
quality  = คุณภาพรวมสำหรับทำปก (คมชัด องค์ประกอบ เห็นหน้า) 1-10`;

  const parts = [{ text: promptText }];
  for (const f of frames) {
    parts.push({ text: frameLabel(f) });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: f.base64 } });
  }

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
  };

  // ★ Batch 5B2: getKey() เหมือนเดิมเป๊ะ (NO_GEMINI_KEY throw ก่อน network ใดๆ — errorType/timing ไม่เปลี่ยน)
  //   แต่ URL ผูก validPin.model (ไม่ใช่ geminiModel()) — ห้าม re-resolve จาก env ระหว่างงาน
  const key = getKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${validPin.model}:generateContent?key=${key}`;

  return runClassifierStrict({
    url, body, pin: validPin, onRetry,
    cost: { step: COST_STEP, caseId },
    expectedCount: frames.length,
    fileTagOn: FILE_TAG,
    externalSignal: signal,
  });
}

// ============================================================
// ★ correction P1-6 — exported strict-seam helpers: libraryTriage.js ต้อง reuse ชุดนี้แทน dot-access it.*/
//   evidence.* ตรงๆ (เดิมหลุด Proxy/accessor/custom-prototype input ผ่านได้ + evidence ปลอม/null-filled แนบเข้า
//   triage ได้) — single source of truth กัน validate-logic สองชุด drift กันเมื่อพรอมป์/สคีมาเปลี่ยนในอนาคต
// ============================================================
// ตรวจ+สร้าง classifier item ใหม่ (frozen, literal ล้วน, nested faceBox/peopleBox/persons frozen ด้วย) จาก it
// ที่ "ไม่รู้จักที่มา" (อาจเป็น Proxy/accessor/custom-prototype/exotic ใดๆ) — reuse exact-schema validator ตัวเดียว
// กับที่ตรวจผล Gemini จริงทุกประการ — พังจุดใดจุดหนึ่ง = null (ไม่มีทาง getter/trap ใดถูกเรียกก่อนปฏิเสธ)
export function sanitizeStrictClassifierItem(it, fileTagOn) {
  const requiredKeys = fileTagOn === true ? CLASSIFIER_ITEM_KEYS_SCENE : CLASSIFIER_ITEM_KEYS_BASE;
  const out = readClassifierItem(it, requiredKeys, fileTagOn === true);
  if (out === null) return null;
  if (out.faceBox !== null) Object.freeze(out.faceBox);
  if (out.peopleBox !== null) Object.freeze(out.peopleBox);
  Object.freeze(out.persons);
  return Object.freeze(out);
}

const CLASSIFIER_EVIDENCE_KEYS = ['requestedModel', 'actualModel', 'actualModelVersion', 'modelMatchMode', 'provider', 'schemaVersion', 'attemptCount', 'repairCount'];
const CLASSIFIER_MATCH_MODES = new Set(['exact', 'versioned_revision']);
// ตรวจว่า evidence object ตรงสัญญา literal ที่ runClassifierStrict สร้างเองเป๊ะ (exact-key + type + value bound
// ทุกฟิลด์, descriptor-safe เต็มรูปแบบ) — ใช้ก่อน libraryTriage.js แนบ classifierEvidence เข้า triage เสมอ
export function isValidClassifierEvidence(evidence) {
  if (!guardExactObject(evidence, CLASSIFIER_EVIDENCE_KEYS)) return false;
  const requestedModel = ownRead(evidence, 'requestedModel').value;
  const actualModel = ownRead(evidence, 'actualModel').value;
  const actualModelVersion = ownRead(evidence, 'actualModelVersion').value;
  const modelMatchMode = ownRead(evidence, 'modelMatchMode').value;
  const provider = ownRead(evidence, 'provider').value;
  const schemaVersion = ownRead(evidence, 'schemaVersion').value;
  const attemptCount = ownRead(evidence, 'attemptCount').value;
  const repairCount = ownRead(evidence, 'repairCount').value;
  if (requestedModel !== null && !isExactModelId(requestedModel, MAX_PIN_MODEL_LEN)) return false;
  if (actualModel !== null) return false; // Gemini ไม่มี field นี้จริง — ต้องเป็น null เท่านั้นเสมอ (ไม่ fabricate)
  if (actualModelVersion !== null && !isExactModelId(actualModelVersion, MAX_PIN_MODEL_LEN)) return false;
  if (!CLASSIFIER_MATCH_MODES.has(modelMatchMode)) return false;
  if (provider !== 'gemini') return false;
  if (schemaVersion !== CLASSIFIER_SCHEMA_VERSION) return false;
  if (!Number.isInteger(attemptCount) || attemptCount < 1 || attemptCount > CLASSIFIER_MAX_ATTEMPTS) return false;
  if (repairCount !== 0) return false;
  return true;
}

// สแกน "ภาพขยะ" ที่ใช้ทำปกข่าวไม่ได้ → [{index, junk, reason}]
export async function geminiJunkScan({ frames, subjects, newsGist, onRetry, caseId }) {
  const COST_STEP = 'คัดขยะภาพ';
  const promptText = `คุณคือ "บรรณาธิการภาพข่าว" มืออาชีพ ใช้ "ตา" ส่องภาพแต่ละรูปอย่างละเอียด (กำกับ "รูปที่ N:")
แล้วใช้ "ตรรกะ" ตัดสินว่าเป็น "ภาพขยะ" (junk=true) หรือ "ภาพใช้ได้" (junk=false)
เพื่อคัดคลังรูปให้เหลือเฉพาะภาพที่ "เกี่ยวกับข่าวนี้จริงๆ"

บุคคล/สิ่งของหลักในข่าว:
${subjectsBlock(subjects)}${newsGist ? `\nแก่นข่าว: ${newsGist}` : ''}

นิยาม "ภาพใช้ได้" (junk=false) — เก็บไว้:
- ภาพถ่ายจริง "บุคคลในข่าว" เด่น สะอาด เห็นหน้าชัด ไม่มีตัวหนังสือ/ลายน้ำ/กราฟิกมาทับ
- ภาพ "วัตถุของคนในข่าว" (บ้าน/รถ/สิ่งของ) ที่เป็น "ของคนในข่าวจริงๆ" (ดูกฎความเป็นเจ้าของด้านล่าง)
- เอกสาร/หลักฐานที่เกี่ยวกับข่าวนี้โดยตรง (จดหมาย/เช็ค/ป้าย — ตัวหนังสือบนหลักฐานคือของที่ต้องการ ไม่ใช่ขยะ)
- 🏛️ "สถานที่สาธารณะที่ข่าวเอ่ยชื่อ" (ป้าย/อาคาร/รั้ว มหาวิทยาลัย/โรงพยาบาล/วัด/โรงเรียน ที่อยู่ในแก่นข่าว) = เก็บไว้ แม้ไม่มีคนในภาพ — เป็นภาพบริบทปลายทางของเรื่อง (เฉพาะ "ภาพถ่ายจริง" — โลโก้/ตราสัญลักษณ์/กราฟิกล้วนของสถาบัน = ขยะเหมือนเดิม)
- เอาไป "รีทัช/ครอปทำปกได้ทันที" ไม่ติดนู่นติดนี่

นิยาม "ภาพขยะ" (junk=true) — ต้องลบทิ้ง (มองด้วยตาให้ครบ):
1. มี "ตัวหนังสือ/แคปชั่น/ข้อความ" ทับบนภาพหรือ "ทับใบหน้า" — โดยเฉพาะพาดหัวตัวใหญ่ → รีทัชไม่ได้ = ขยะ
2. ปกข่าว/ปกคลิป/thumbnail คลิกเบต ที่มีข้อความพาดหัว (เช่น "อึ้ง!!", "เผยคำพูดลับ", "10 ผลงานดัง...")
3. ลายน้ำ/โลโก้/ตราสำนักข่าว/ชื่อช่อง/เว็บไซต์ ประทับบนภาพ
4. ภาพคอลลาจหลายช่อง / การ์ดกราฟิก / quote card / การ์ดวันเกิด
5. การ์ดไตเติล/อินโทรรายการ, กราฟิกล้วน, ปุ่มเล่น ▶, หน้าจอ UI, จอดำ/ขาวเปล่า
6. เบลอหนัก/มัว/มืด/เฟรมเปลี่ยนฉาก จนใช้ไม่ได้
7. ไม่ใช่บุคคลเป้าหมาย/ไม่เกี่ยวข่าว — คนอื่น, มีม, ภาพสุ่มมั่ว
8. 🎯 "วัตถุมั่ว" (บ้าน/รถ/สิ่งของ ที่ "ไม่ใช่ของคนในข่าว") — บ้าน/รถทั่วไปจากแคตตาล็อก/โฆษณา/อสังหา ที่แค่ตรงคีย์เวิร์ด (ดูกฎด้านล่าง)

${OWNERSHIP_RULES}

หลักคิด: "เก็บไว้เฉพาะภาพที่เป็นคน/ของ ของคนในข่าวจริงๆ และสะอาดรีทัชได้" — สงสัยว่าเป็นบ้าน/รถมั่วที่ไม่ใช่ของคนในข่าว = ตัดทิ้ง
ตอบเป็น JSON เท่านั้น: { "items": [ { "index": <เลขรูป>, "junk": true/false, "reason": "สั้นๆ (เช่น 'บ้านแคตตาล็อกไม่ใช่ของคนในข่าว', 'มีข้อความทับหน้า', 'ลายน้ำสำนักข่าว')" } ] }`;

  const parts = [{ text: promptText }];
  for (const f of frames) {
    parts.push({ text: frameLabel(f) });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: f.base64 } });
  }

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
  };
  const data = await callGemini(body, { onRetry, cost: { step: COST_STEP, caseId } });
  const text = geminiText(data);
  const parsed = safeParse(text);
  if (!parsed) return [];
  const list = Array.isArray(parsed) ? parsed : parsed.items || [];
  return list.filter((x) => x && typeof x.index === 'number');
}

// แยก "อารมณ์ภาพ" เป็นหมวดหมู่ → [{index, emotion}]
// emotion keys: happy laugh sad serious angry shock warm worried context document other
export async function geminiEmotionScan({ frames, subjects, onRetry, caseId }) {
  const COST_STEP = 'แยกอารมณ์ภาพ';
  const names =
    (subjects || []).map((s) => s.name).filter(Boolean).join(', ') || 'บุคคลในข่าว';

  const promptText = `คุณคือ "ผู้กำกับภาพ" ใช้ "ตา" ส่องสีหน้า/อารมณ์ในแต่ละรูป (กำกับ "รูปที่ N:")
แล้วใช้ "ตรรกะ" จัดแต่ละรูปเข้า "หมวดอารมณ์" 1 หมวด (บุคคลเป้าหมาย: ${names})

หมวดอารมณ์ (เลือก key เดียวต่อรูป) — เกณฑ์ชัดเจน:
- "happy"   = ยิ้ม สีหน้าเบิกบาน อารมณ์ดี มีความสุข (ยิ้มพอดี ไม่ถึงกับหัวเราะ)
- "laugh"   = หัวเราะ ปากเปิดกว้าง สนุกสุดๆ ขำ
- "sad"     = เศร้า ร้องไห้ น้ำตา ซึม โศกเศร้า ทุกข์
- "serious" = สีหน้านิ่ง จริงจัง เคร่งขรึม ไม่ยิ้ม มองตรง (neutral/สุขุม)
- "angry"   = โกรธ ขมวดคิ้ว ไม่พอใจ ตวาด หน้าบึ้ง
- "shock"   = ตกใจ ตาเบิกกว้าง ปากอ้า ประหลาดใจ ช็อก
- "warm"    = อบอุ่น ซาบซึ้ง อ่อนโยน กอด/สัมผัส โมเมนต์ครอบครัว-กำลังใจ
- "worried" = กังวล เครียด ครุ่นคิด เหนื่อยล้า วิตก
- "context" = ไม่เน้นสีหน้า — เป็นฉาก/แอ็คชัน/สถานที่/ชีวิตประจำวัน/ทำงาน
- "document"= เอกสาร/ตัวหนังสือ/กระดาษ (ไม่ใช่คน)
- "other"   = ไม่ชัด/อารมณ์ปนกันจนแยกไม่ได้/ไม่มีคน

หลักคิด: ดู "สีหน้า+ท่าทาง" เป็นหลัก แล้วเลือกหมวดที่ "เด่นสุด" ของรูปนั้น
ตอบเป็น JSON เท่านั้น: { "items": [ { "index": <เลขรูป>, "emotion": "<key>" } ] }`;

  const parts = [{ text: promptText }];
  for (const f of frames) {
    parts.push({ text: frameLabel(f) });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: f.base64 } });
  }

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
  };
  const data = await callGemini(body, { onRetry, cost: { step: COST_STEP, caseId } });
  const text = geminiText(data);
  const parsed = safeParse(text);
  if (!parsed) return [];
  const list = Array.isArray(parsed) ? parsed : parsed.items || [];
  return list.filter((x) => x && typeof x.index === 'number' && x.emotion);
}

// 👁️ ตาเช็คฮีโร่: ดูภาพผู้ท้าชิงจริง → ใบไหน "หน้าเดี่ยวใหญ่ชัด" เหมาะเป็นฮีโร่ปกที่สุด
// (กันเคส faceBox มั่ว: ภาพผนัง/คนติดขอบถูกจัดเป็น face → ครอปฮีโร่แล้วได้ผนังเปล่า)
export async function geminiHeroPick({ frames, subjects, onRetry, caseId }) {
  const COST_STEP = 'ตาเช็คฮีโร่';
  const names = (subjects || []).map((s) => s.name).filter(Boolean).join(', ') || 'บุคคลในข่าว';
  const promptText = `ภาพแต่ละใบคือ "ตัวอย่างผลครอปฮีโร่ปกจริง" (กำกับ "รูปที่ K:") — สิ่งที่เห็นคือสิ่งที่จะขึ้นปกจริง
ฮีโร่คือช่องใหญ่สุดของปก ต้องเป็น: ใบหน้า ${names} "เดี่ยว ใหญ่ ชัด เต็มหน้า" (หน้ากินพื้นที่ภาพมาก ไม่ถูกมือ/ไมค์/วัตถุบัง ไม่ติดขอบ ไม่เบลอ ไม่หันหลัง)
🚫 unusable เด็ดขาด: เห็นแต่ผนัง/เพดาน/ฉากเปล่า/แทบไม่เห็นหน้า, หน้าโดนขอบตัด/ถูกบัง, คนตัวเล็กอยู่ไกล, เบลอหนัก
ตอบ JSON: { "best": <index ที่ดีสุด>, "order": [index เรียงดีสุด→แย่], "unusable": [index ที่ห้ามใช้] }`;
  const parts = [{ text: promptText }];
  for (const f of frames) {
    parts.push({ text: `รูปที่ ${f.index}:` });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: f.base64 } });
  }
  const body = { contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } };
  const data = await callGemini(body, { onRetry, cost: { step: COST_STEP, caseId } });
  const parsed = safeParse(geminiText(data)) || {};
  return {
    best: typeof parsed.best === 'number' ? parsed.best : null,
    order: Array.isArray(parsed.order) ? parsed.order : [],
    unusable: Array.isArray(parsed.unusable) ? parsed.unusable : [],
  };
}

// 👁️ E-loop QC ทั้งปก: ดู "ผลครอปจริงของทุกช่อง" พร้อมกัน → ช่องไหนไม่ผ่าน (ผนังเปล่า/หน้าแหว่ง/ถูกบัง/ซ้ำ/ขัดแปลน)
export async function geminiCoverCheck({ frames, plan, subjects, onRetry, caseId }) {
  const COST_STEP = 'ตา QC ทั้งปก';
  const names = (subjects || []).map((s) => s.name).filter(Boolean).join(', ') || 'บุคคลในข่าว';
  const avoid = (plan?.avoid || []).join(' · ') || '-';
  const promptText = `คุณคือ QC ปกข่าวไวรัลที่เข้มงวดที่สุด — ภาพแต่ละใบคือ "ผลครอปจริง" ของช่องบนปก (กำกับ "ช่อง <ชื่อ>:")
สิ่งที่เห็นคือสิ่งที่คนจะเห็นบนปกจริง | บุคคลในข่าว: ${names}
แนวคิดปก: ${plan?.concept || '-'}
🚫 แปลนห้าม: ${avoid}

ตัดสินทีละช่อง "ไม่ผ่าน" เมื่อ:
1. เห็นแต่ผนัง/เพดาน/ผ้าม่าน/ฉากเปล่า — แทบไม่มีเนื้อหา/ไม่เห็นคน
2. หน้าแหว่ง/โดนขอบตัด/ถูกมือ-ไมค์-วัตถุ-หัวคนอื่นบังหน้า
3. เบลอหนัก/มืดมาก/ขาวโพลน
4. "ซ้ำ" = คนเดิม+อารมณ์เดิม+มุม/ฉากเดิม กับช่องอื่น → ไม่ผ่านช่องที่เล็กกว่า
   ⚠️ "ตัวเอกคนเดิมแต่คนละอารมณ์/มุม" = ถูกต้องตามสูตรปกไวรัล ห้ามตัดสินว่าซ้ำ!
5. 🚫 "คนแปลกหน้า" (ไม่ใช่บุคคลในข่าว) เป็นตัวเด่นของช่อง — โดยเฉพาะวงกลม = ตกทันที (ผิดคนร้ายแรงสุด)
6. ขัดข้อ "แปลนห้าม" ชัดเจน
ช่องที่พอใช้ได้แม้ไม่สมบูรณ์แบบ = ผ่าน (อย่าเข้มจนทุกช่องตก)
ตอบ JSON เท่านั้น: { "fail": [ { "slot": "<ชื่อช่อง>", "reason": "สั้นๆ" } ] } — ผ่านหมดให้ "fail": []`;
  const parts = [{ text: promptText }];
  for (const f of frames) {
    parts.push({ text: `ช่อง ${f.slot}:` });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: f.base64 } });
  }
  const body = { contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } };
  const data = await callGemini(body, { onRetry, cost: { step: COST_STEP, caseId } });
  const parsed = safeParse(geminiText(data)) || {};
  return { fail: Array.isArray(parsed.fail) ? parsed.fail.filter((x) => x && x.slot) : [] };
}

// 🎬 "ผู้กำกับการคัดเลือกภาพ" (casting director) — เลือกภาพจากคลังให้ตรง "แปลนผู้กำกับศิลป์" เคร่งครัด
// frames: [{index, base64}] (ผู้สมัครทั้งหมด) · plan: coverPlan (shots) → คืน { assignments: {SLOT:[index,...]}, notes }
export async function geminiCastToPlan({ frames, plan, subjects, onRetry, caseId }) {
  const COST_STEP = 'คัดภาพตามแปลนปก';
  const names = (subjects || []).map((s) => s.name).filter(Boolean).join(', ') || 'บุคคลในข่าว';
  const prio = { must: 'ต้องมี', should: 'ควรมี', nice: 'มีก็ดี' };
  const planText = (plan?.shots || [])
    .map((sh) => {
      const fb = (sh.fallbacks || []).slice(0, 3).join(' / ');
      return `[${sh.slot}] (${prio[sh.priority] || ''}) อารมณ์: ${sh.emotion || '-'}\n  ต้องการ(ideal): ${sh.ideal || '-'}\n  ถ้าไม่มีใช้แทนตามลำดับ: ${fb || '-'}`;
    })
    .join('\n');

  const promptText = `คุณคือ "ผู้กำกับการคัดเลือกภาพ (casting director)" ใช้ "ตา" ดูภาพจริงทุกใบ
แล้วเลือกภาพจากคลังให้ตรงกับที่ "ผู้กำกับศิลป์" สั่งไว้ในแปลนปก "เคร่งครัดที่สุด"
บุคคลในข่าว: ${names}
แนวคิดปก: ${plan?.concept || '-'}

== แปลนปก (แต่ละช่องต้องการภาพแบบนี้) ==
${planText}

🚫 ห้ามขึ้นปกเด็ดขาด: ${(plan?.avoid || []).join(' · ') || '-'}

มีภาพผู้สมัครหลายรูป (กำกับ "รูปที่ K:") ด้านล่าง — ส่องด้วยตาให้ครบ
งานของคุณ: สำหรับ "แต่ละช่อง (SLOT)" เลือก index รูปที่ตรงกับที่สั่ง "มากที่สุด" เรียงดีสุดก่อน (สูงสุด 3 index/ช่อง)

🏆 หลักจากปกจริงหลายหมื่นไลก์: ข่าวตัวเอกเดี่ยว → ใช้ "ตัวเอกคนเดิมหลายช่องได้และควรทำ" แต่แต่ละช่องต้อง "คนละอารมณ์/คนละมุม/คนละฉาก" (เล่า arc อารมณ์: ว้าว→ยิ้ม→นิ่งเท่)
"ซ้ำ" ที่ห้ามจริงๆ = คนเดิม + อารมณ์เดิม + มุม/ฉากเดิม เท่านั้น | HERO เลือกใบที่ "อารมณ์แรงสุด+คมชัดสุด" (ว้าว/ตกใจ/ยิ้มกว้าง — ไม่เอาหน้านิ่ง candid ถ้ามีตัวเลือกดีกว่า)

เกณฑ์ตัดสิน (เรียงความสำคัญ):
1. ต้องเป็น "บุคคล/สิ่งของที่ถูกต้องตามข่าว" จริง (ไม่ใช่คนอื่น/ของมั่ว)
   ⚠️ เด็ก/บุคคลทั่วไปที่ "ยืนยันไม่ได้ว่าเป็นคนในข่าวจริง" = ห้ามใช้เด็ดขาด (ข่าวมักไม่เผยรูปเด็ก — ถ้าไม่แน่ใจ ใช้ภาพหลักฐาน/สถานที่แทน ผิดคนร้ายแรงกว่าไม่มีภาพ)
2. ตรงกับ ideal ก่อน — ถ้าไม่มี ค่อยดู fallback ตามลำดับ
3. อารมณ์สีหน้า/ระยะ/ฉาก ตรงที่สั่ง
4. ภาพสะอาด (ไม่มืด/ไม่เบลอ) — 🧾 หมายเหตุ: "ตัวหนังสือ/ตัวเลขที่เป็นส่วนของฉากจริง" (เช็ค/ป้ายมอบเงิน/แบนเนอร์งาน/เอกสารหลักฐาน/ป้ายสถาบัน) "ไม่ถือว่าขยะ" ใช้ได้เลยสำหรับช่องหลักฐาน MOMENT/CIRCLE (นั่นคือของที่ต้องการ!) ; ห้ามเฉพาะ "ภาพคอลลาจหลายช่อง/พาดหัวคลิกเบตทับ/ลายน้ำสำนักข่าว"
   🚫 เฟรมวิดีโอที่มี "ซับไตเติล/แคปชั่นรายการทับภาพ" = เลือกได้เฉพาะเมื่อ "ไม่มีทางเลือกที่สะอาดกว่า" ในช่องนั้นจริงๆ (ถ้ามีรูปสะอาดใกล้เคียง เลือกรูปสะอาดเสมอ)
5. 🏛️ ช่องที่สื่อ "สถานที่/สถาบัน" (มหาวิทยาลัย/โรงพยาบาล/วัด/โรงเรียน): เลือกเฉพาะ "ภาพถ่ายจริง" — เรียงความดี:
   (1) 🥇 ป้ายชื่อ/ซุ้มทางเข้า ที่ "ตัวหนังสือชื่อสถาบันภาษาไทยตัวใหญ่เด่นกินเฟรม อ่านออกทันทีบนมือถือ" (ดีสุด — สื่อสารแรงสุด)
   (2) อาคารเด่นที่มีป้ายชื่ออ่านได้  (3) แลนด์มาร์กที่คนจำได้
   ภาพวิว/สวนสวยแต่ "ชื่อเล็กหรือไม่มีชื่อ" = เลือกเป็นทางเลือกท้ายๆ เท่านั้น (คนเลื่อนฟีดไม่รู้ว่าที่ไหน)
   🚫 ห้ามเลือกโลโก้/ตราสัญลักษณ์/emblem/กราฟิกล้วนเด็ดขาด ; ถ้าไม่มีภาพถ่ายจริงเลย ให้ข้ามช่องนั้น ([]) ดีกว่าใส่โลโก้
❗ ถ้าไม่มีรูปไหนตรงช่องนั้นเลย ให้ใส่ [] (ห้ามยัดรูปมั่วเพื่อให้ครบ)
ห้ามใช้ index รูปเดียวซ้ำหลายช่อง — แต่ "ตัวเอกคนเดิมคนละรูป/คนละอารมณ์" ใช้หลายช่องได้ (ดีด้วย)

ตอบเป็น JSON ล้วน:
{ "assignments": { "<SLOT>": [<index>, ...], ... }, "notes": { "<SLOT>": "เหตุผลสั้นๆ ว่าเลือกเพราะตรงอะไร" } }`;

  const parts = [{ text: promptText }];
  for (const f of frames) {
    parts.push({ text: `รูปที่ ${f.index}:` });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: f.base64 } });
  }
  const body = { contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } };
  const data = await callGemini(body, { onRetry, cost: { step: COST_STEP, caseId } });
  const parsed = safeParse(geminiText(data));
  if (!parsed || typeof parsed !== 'object') return { assignments: {}, notes: {} };
  return { assignments: parsed.assignments || {}, notes: parsed.notes || {} };
}

function safeParse(text) {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s !== -1 && e !== -1 && e > s) {
      try {
        return JSON.parse(t.slice(s, e + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
