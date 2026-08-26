/**
 * 🎥 clipBrain/clipGeminiVideo.js — ตัวเรียก Gemini "ของสายคลิปโดยเฉพาะ" (26 ส.ค. 69)
 * ==================================================================
 * ⛔ ไฟล์นี้เป็นของระบบคลิปล้วน — ไม่มีใครในระบบข่าวเรียกใช้ และไม่แตะไฟล์ล็อกใดๆ
 *
 * ทำไมต้องมีตัวนี้ (เจ้าของสั่ง 26 ส.ค.: "ระบบคำกรองไม่แตะถ้ายุ่งกับข่าว ถ้าจะทำให้แยกมาสร้างใหม่ของคลิป"):
 *   ตัวเรียกกลาง (geminiClient.js) เป็นไฟล์ล็อกที่ทุกท่อใช้ร่วมกัน และมีข้อจำกัด 4 อย่างที่แก้จากข้างนอกไม่ได้
 *   ① คืนแค่ผลที่ parse แล้ว → **ไม่รู้ว่าใช้โมเดลไหนจริง** (สลับ 3.7→3.6 เงียบ)
 *   ② **ไม่คืน usageMetadata** → วัดค่าใช้จ่ายต่อใบไม่ได้เลย
 *   ③ **ไม่คืน finishReason** → จับ "คำตอบถูกตัดกลางคัน" ไม่ได้
 *   ④ วิ่งผ่าน sanitizeOutput ที่แทนคำแบบไม่ดูขอบเขตคำ → **ทำข้อความไทยเพี้ยน 5% ของทุกใบ**
 *      (พิสูจน์แล้ว: "บรรยากา[ศพ]ิธี" → "บรรยากา[ร่างผู้เสียชีวิต]ิธี" · "ยา[ฆ่า]แมลง" → "ยา[ทำให้เสียชีวิต]แมลง")
 *
 * 🔑 ของเดิมไม่ถูกแตะเลย — ตัวนี้เป็นทางเลือกที่เปิดด้วยสวิตช์ ปิดแล้วระบบเดินเส้นเดิมทุกไบต์
 *
 * 🛡️ เรื่องคำเสี่ยง Facebook: เนื้อถอดคลิปเป็น **วัตถุดิบให้คนอ่าน/ป้อนท่อข่าวต่อ ไม่ใช่ข้อความที่โพสต์**
 *    ตัวกรองของจริงยังทำงานอยู่ที่ปลายทาง (ท่อเขียนข่าวเรียก callAI ซึ่งกรองให้อยู่แล้ว)
 *    ที่นี่จึงใช้ตัวกรองแบบ "วลีเจาะจง + ดูขอบเขตคำ" ที่พิสูจน์แล้วว่าไม่ทำคำไทยเพี้ยน (clipSafeText.js)
 */
import { sanitizeClipText, CLIP_SAFE_REV } from './clipSafeText.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = process.env.GEMINI_VIDEO_MODEL || 'gemini-3.7-flash';
const INLINE_CAP = 19 * 1024 * 1024;

const envInt = (k, d) => { const v = parseInt(process.env[k] || '', 10); return Number.isFinite(v) && v > 0 ? v : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** คีย์แยกของสายวิดีโอ (เหมือนเดิม) — อ่านสดทุกครั้ง ไม่แคช (เปลี่ยนคีย์แล้วไม่ต้องรีสตาร์ท) */
function videoApiKey() {
  return process.env.GEMINI_VIDEO_API_KEY || process.env.GEMINI_API_KEY || '';
}

/** จัดกลุ่มความล้มเหลว — ตัดสินว่ายิงซ้ำแล้วมีโอกาสสำเร็จไหม */
export function classifyFailure({ httpStatus, errorMessage, finishReason }) {
  const m = String(errorMessage || '').toLowerCase();
  if (finishReason === 'MAX_TOKENS') return { kind: 'TRUNCATED', retry: false, note: 'คำตอบถูกตัดเพราะชนเพดาน — ยิงซ้ำเหมือนเดิมก็ตันเหมือนเดิม' };
  if (finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT') return { kind: 'BLOCKED', retry: false, note: 'ถูกบล็อกด้วยนโยบายเนื้อหา' };
  if (httpStatus === 429) return { kind: 'RATE_LIMIT', retry: true, note: 'โควตาเต็มชั่วคราว' };
  if (httpStatus === 503 || /overload|high demand|unavailable/i.test(m)) return { kind: 'BUSY', retry: true, note: 'ผู้ให้บริการแน่นชั่วคราว' };
  if (httpStatus === 500 || httpStatus === 502 || httpStatus === 504) return { kind: 'SERVER', retry: true, note: 'ฝั่งผู้ให้บริการพลาดชั่วคราว' };
  if (httpStatus === 400) return { kind: 'BAD_REQUEST', retry: false, note: 'คำขอผิดรูป — ยิงซ้ำก็ผิดเหมือนเดิม' };
  if (httpStatus === 403) return { kind: 'FORBIDDEN', retry: false, note: 'ไม่มีสิทธิ์เข้าถึง' };
  if (/aborted|timeout|timed out|etimedout/i.test(m)) return { kind: 'TIMEOUT', retry: true, note: 'หมดเวลารอ' };
  if (/fetch failed|econnreset|enotfound|network|socket/i.test(m)) return { kind: 'NETWORK', retry: true, note: 'เน็ตสะดุด' };
  if (/parse|json/i.test(m)) return { kind: 'BAD_JSON', retry: true, note: 'ตอบมาไม่เป็น JSON — ยิงใหม่มีโอกาสได้ของดี' };
  if (/ไม่ส่งข้อมูล|empty/i.test(m)) return { kind: 'EMPTY', retry: true, note: 'ตอบว่างเปล่า' };
  return { kind: 'UNKNOWN', retry: false, note: 'ไม่รู้จักอาการ — ไม่ยิงซ้ำเพื่อความปลอดภัย' };
}

/** ตัวเลขต้องอยู่ในกรอบเสมอ — กันค่าเพี้ยน/Infinity ทำให้ลูปไม่จบหรือยิงเงินไม่จำกัด */
function clampInt(v, lo, hi, dflt) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** รายชื่อโมเดลต้องเป็น array ของ string ที่หน้าตาเหมือนชื่อโมเดลเท่านั้น (string เดี่ยวจะถูก spread เป็นรายตัวอักษร) */
function normalizeModelList(v, cap) {
  const arr = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(',') : []);
  const out = [];
  for (const raw of arr) {
    if (typeof raw !== 'string') continue;
    const s = raw.trim();
    if (!MODEL_RE.test(s) || out.includes(s)) continue;
    out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

/** ผลที่รับได้ต้องเป็นออบเจ็กต์ธรรมดาเท่านั้น — string/array/number ที่ truthy ห้ามผ่านเป็นของสำเร็จ */
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** ดึง JSON จากข้อความที่อาจมีของปน */
function parseJsonLoose(text) {
  const s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch { /* ลองต่อ */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* ลองต่อ */ } }
  return null;
}

/**
 * เรียก Gemini ให้ดูคลิปจากไฟล์ — คืน "ผล + ใบรับรองว่าเกิดอะไรขึ้น"
 * @returns {Promise<{ok:boolean, data?:object, receipt:object, errorType?:string, error?:string}>}
 *   ⚠️ ไม่โยน error — ผู้เรียกดู ok แล้วตัดสินใจถอยเอง (fail-open)
 *   receipt = { model, attempts:[...], usage:{...}, finishReason, degradations:[...], elapsedMs, filterRev }
 */
export async function callClipGeminiVideo(rawOpts = {}) {
  const t0 = Date.now();
  const receipt = {
    model: null, requestedModel: null,
    attempts: [], usage: null, finishReason: null,
    degradations: [], filterRev: CLIP_SAFE_REV, elapsedMs: 0,
  };
  const done = (extra) => ({ ...extra, receipt: { ...receipt, elapsedMs: Date.now() - t0 } });

  try {
  // ── อ่านตัวเลือกในตาข่าย (ส่ง null/ของแปลกมาก็ไม่โยน) ──
  const {
    prompt,
    videoBuffer,
    youtubeUrl = '',            // ★ ใช้ลิงก์แทนไฟล์ (YouTube เท่านั้น) — ไม่ต้องโหลด ไม่ต้องบีบ ภาพต้นฉบับ 100%
    mimeType = 'video/mp4',
    model = DEFAULT_MODEL,
    temperature = 0.2,
    maxTokens = 32000,
    videoRange = null,          // [startSec, endSec] — ให้ดูเฉพาะช่วง (ประหยัดและตรงจุด)
    maxAttempts = envInt('CLIP_GEMINI_MAX_ATTEMPTS', 3),
    fallbackModels = null,      // null = อ่านจาก env · [] = ห้ามสลับโมเดล
    timeoutMs = envInt('CLIP_GEMINI_TIMEOUT_MS', 300000),
    totalTimeoutMs = envInt('CLIP_GEMINI_TOTAL_TIMEOUT_MS', 600000), // เพดานรวมทั้ง call (ไม่ใช่ต่อครั้ง)
  } = (rawOpts && typeof rawOpts === 'object') ? rawOpts : {};
  receipt.requestedModel = typeof model === 'string' ? model : String(model ?? '');

  // ── กรอบทุกค่าให้อยู่ในพิสัยก่อนใช้งาน (กันลูปไม่จบ/ยิงเงินไม่จำกัด) ──
  const attemptsCap = clampInt(maxAttempts, 1, 5, 3);
  const perAttemptMs = clampInt(timeoutMs, 5000, 600000, 300000);
  const wholeCallMs = clampInt(totalTimeoutMs, 10000, 3600000, 600000);
  const deadline = t0 + wholeCallMs;
  receipt.limits = { maxAttempts: attemptsCap, timeoutMs: perAttemptMs, totalTimeoutMs: wholeCallMs };

  const apiKey = videoApiKey();
  if (!apiKey) return done({ ok: false, errorType: 'NO_KEY', error: 'ยังไม่ได้ตั้งคีย์ Gemini สำหรับวิดีโอ' });
  const useLink = !!youtubeUrl;
  if (!useLink) {
    if (!Buffer.isBuffer(videoBuffer) || videoBuffer.length < 10000) {
      return done({ ok: false, errorType: 'BAD_INPUT', error: 'ไฟล์วิดีโอเล็ก/ว่างเกินไป' });
    }
    if (videoBuffer.length > INLINE_CAP) {
      return done({ ok: false, errorType: 'TOO_LARGE', error: `ไฟล์ ${(videoBuffer.length / 1e6).toFixed(1)}MB เกินเพดานแนบตรง 19MB — ต้องย่อหรือผ่าท่อนก่อน` });
    }
  }
  receipt.source = useLink ? 'link' : 'file';

  const envFb = normalizeModelList(process.env.CLIP_GEMINI_FALLBACK_MODELS || '', 3);
  const fbList = normalizeModelList(fallbackModels === null ? envFb : fallbackModels, 3);
  const candidates = normalizeModelList([model, ...fbList], 4);
  if (!candidates.length) {
    return done({ ok: false, errorType: 'BAD_INPUT', error: 'ไม่มีชื่อโมเดลที่ใช้ได้ (ชื่อโมเดลต้องเป็นข้อความ)' });
  }

  const rangePart = Array.isArray(videoRange) && videoRange.length === 2
    ? { videoMetadata: { startOffset: `${Math.max(0, Math.round(videoRange[0]))}s`, endOffset: `${Math.round(videoRange[1])}s` } }
    : {};
  const videoPart = useLink
    ? { fileData: { fileUri: youtubeUrl }, ...rangePart }
    : { inlineData: { mimeType, data: videoBuffer.toString('base64') }, ...rangePart };
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [videoPart, { text: String(prompt || '') }] }],
    generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
  });

  let lastFail = null;
  let ranOutOfTime = false;
  for (const m of candidates) {
    if (ranOutOfTime) break;
    for (let n = 1; n <= attemptsCap; n++) {
      const leftMs = deadline - Date.now();
      if (leftMs <= 1000) {                        // หมดเวลารวมทั้ง call — หยุดทุกโมเดล
        ranOutOfTime = true;
        lastFail = { kind: 'TIMEOUT', retry: false, note: `หมดเวลารวมทั้งงาน ${Math.round(wholeCallMs / 1000)} วินาที` };
        receipt.degradations.push({ type: 'total-deadline', note: lastFail.note });
        break;
      }
      const aT0 = Date.now();
      const rec = { no: receipt.attempts.length + 1, model: m, startedAt: new Date().toISOString() };
      let httpStatus = 0, errMsg = '', finishReason = null, json = null, textLength = 0;
      try {
        const res = await fetch(`${API_BASE}/${encodeURIComponent(m)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body,
          signal: AbortSignal.timeout(Math.min(perAttemptMs, leftMs)),
        });
        httpStatus = res.status;
        json = await res.json().catch(() => null);
        if (json?.error) errMsg = `${json.error.code || res.status} ${json.error.message || ''}`;
        const cand = (json?.candidates || [])[0] || {};
        finishReason = cand.finishReason || null;
        const text = ((cand.content || {}).parts || []).map((p) => p.text || '').join('');
        textLength = text.length;
        if (res.ok && text) {
          // 🔴 ด่านแรก: คำตอบต้องจบเอง (STOP) เท่านั้นถึงรับได้ — MAX_TOKENS = เนื้อขาดท้าย แม้ JSON จะ parse ได้
          if (finishReason && finishReason !== 'STOP') {
            errMsg = errMsg || `คำตอบไม่สมบูรณ์ (finishReason=${finishReason}, ได้ข้อความ ${textLength} ตัวอักษร)`;
          } else {
            const parsed = parseJsonLoose(text);
            if (isPlainObject(parsed)) {
              const cleaned = sanitizeClipText(parsed);
              Object.assign(rec, { ok: true, ms: Date.now() - aT0, httpStatus, finishReason, textLength, usage: json?.usageMetadata || null });
              receipt.attempts.push(rec);
              receipt.model = m;
              receipt.usage = json?.usageMetadata || null;
              receipt.finishReason = finishReason;
              receipt.textLength = textLength;
              if (m !== receipt.requestedModel) {
                receipt.degradations.push({ type: 'model-fallback', from: receipt.requestedModel, to: m, why: lastFail?.kind || 'unknown' });
              }
              if (!finishReason) {
                receipt.degradations.push({ type: 'no-finish-reason', note: 'ไม่มี finishReason กลับมา — รับผลไว้แต่ยืนยันไม่ได้ว่าคำตอบจบเอง' });
              }
              if (Array.isArray(videoRange)) receipt.videoRange = videoRange;
              return done({ ok: true, data: cleaned });
            }
            errMsg = errMsg || (parsed ? 'ผลที่ได้ไม่ใช่ออบเจ็กต์ JSON' : 'ตอบมาไม่เป็น JSON');
          }
        } else if (res.ok && !text) {
          errMsg = errMsg || 'Gemini ไม่ส่งข้อมูลกลับ';
        }
      } catch (e) {
        errMsg = String((e && e.message) || e);
      }

      const cls = classifyFailure({ httpStatus, errorMessage: errMsg, finishReason });
      Object.assign(rec, { ok: false, ms: Date.now() - aT0, httpStatus, finishReason, textLength, errorType: cls.kind, error: String(errMsg).slice(0, 300) });
      receipt.attempts.push(rec);
      receipt.finishReason = finishReason;
      lastFail = cls;
      try { console.warn(`[ClipGemini] ✗ ${m} ครั้งที่ ${n}: ${cls.kind} — ${String(errMsg).slice(0, 120)}`); } catch {}

      if (!cls.retry) break;                       // ยิงซ้ำไปก็ล้มเหมือนเดิม → ไปลองโมเดลถัดไป (ถ้ามี)
      if (n < attemptsCap) {
        const waitMs = Math.min(20000, 2000 * 2 ** (n - 1), Math.max(0, deadline - Date.now() - 1000));
        if (waitMs > 0) await sleep(waitMs);       // 2s → 4s → 8s (ไม่เกินเวลารวมที่เหลือ)
      }
    }
  }

  return done({
    ok: false,
    errorType: lastFail?.kind || 'UNKNOWN',
    error: `ถอดไม่สำเร็จหลังพยายาม ${receipt.attempts.length} ครั้ง (${lastFail?.note || 'ไม่ทราบสาเหตุ'})`,
  });
  } catch (e) {
    // 🛡️ ตาข่ายชั้นนอกสุด — ไม่ว่าอะไรพังก็ต้องคืนทรงเดิม ไม่โยน exception หลุดออกไป
    try { console.warn(`[ClipGemini] ✗ ภายในพัง: ${String((e && e.message) || e).slice(0, 200)}`); } catch {}
    return done({ ok: false, errorType: 'CLIP_GEMINI_INTERNAL', error: String((e && e.message) || e).slice(0, 300) });
  }
}
