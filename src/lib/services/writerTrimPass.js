/**
 * ★ เฟส 2 "พรอมต์นักเขียน" (2 ก.ย. 69) — ด่านตัดฉบับยาว (WRITER_TRIM_PASS) · ไฟล์นี้ไม่มี import (เทสดึงใช้ตรง · ผู้เรียกฉีด dependency)
 * ─────────────────────────────────────────────────────────────────────────────
 * ปัญหา: ระบบเขียน 228–296 คำ (ยาวกว่าดิบ 40–60% จากประโยคบรรยายอารมณ์/รายละเอียดแต่ง/สรุปซ้ำ) ขณะที่โพสต์ปังจริง 140–170 คำ
 *   (เพจจริง 1,927 โพสต์: 140–170 คำ ค่ากลาง 15,605 ไลก์ · 230+ ≈ 5–6 พัน)
 * วิธี: ฉบับที่ยาวเกิน maxWords (220) → AI ราคาถูก (luna ผ่าน callAI ที่ผู้เรียกฉีดมา) "ตัดเฉพาะประโยคที่ไม่มีข้อเท็จจริงใหม่
 *   ห้ามแก้ชื่อ/ตัวเลข/คำพูด ให้เหลือ ~target (180) คำ" แล้วตรวจผลด้วย findMissingFacts (src/lib/correction/missingFactsGate.js) เทียบเนื้อดิบ
 * fail-safe (ทิ้งผล ใช้ต้นฉบับ): ข้อเท็จจริงหายเพิ่ม · รายงานข้อเท็จจริงถูกตัด (ตรวจไม่ครบ) · สั้นกว่า minWords (146 = พื้นเผยแพร่) · ไม่สั้นลง · AI ล้ม/ตอบว่าง · หมดเวลา · นับคำไม่ได้
 *   ★ ผู้ตรวจไขว้ 2 ก.ย. 69 (medium): findMissingFacts ค่าเริ่มต้นคืนของหายแค่ 20 รายการ (slice ลำดับ number→date→quote→name→detail) —
 *     ร่างที่ขาดอยู่ก่อน ≥ 21 รายการ (ข่าว URL ตัวเลขเยอะ) ทำให้ชื่อ/คำพูดที่ luna ตัดหายเพิ่มตกนอก 20 อันดับแรก → รับผลทั้งที่ของหาย
 *     แก้: ขอ maxMissing = FACT_CHECK_MAX_MISSING ทั้ง 2 รอบ + ถ้ารายงานยังถูกตัด (truncated) = ตรวจไม่ครบ → ทิ้งผล (reason fact_check_truncated)
 * ทุกฉบับได้ version._trimPass = { before, after, applied, reason } (before/after = จำนวนคำ) · ห้ามแตะ title/provenance (usedModel/promptId/_source)
 * ผู้เรียก (autoFlowServiceText) เช็กสวิตช์ WRITER_TRIM_PASS === '1' ก่อนเรียก — ไฟล์นี้ไม่อ่าน env เอง (สวิตช์ปิด = ไม่ยิงเลย)
 * เทส: tests/writer-trim-pass.test.mjs
 */

export const TRIM_PASS_DEFAULTS = Object.freeze({
  maxWords: 220, // เกินนี้ถึงยิง
  target: 180, // เป้าหลังตัด (~)
  minWords: 146, // พื้นเผยแพร่ (legacyLengthRules NEW_LENGTH_CFG.min) — ผลสั้นกว่านี้ทิ้ง
  timeoutMs: 25_000,
  rawChars: 6000, // เนื้อดิบที่แนบให้ตัวตัดใช้เทียบ (กันพรอมต์บาน)
});

let _segmenter = null;
let _segmenterTried = false;
/** นับคำไทยสำรอง (Intl.Segmenter · ไม่มี = ประมาณ 4 ตัวอักษร/คำ) — ผู้เรียกจริงฉีด countPublishableThaiWords มาแทน */
export function countThaiWordsDefault(text) {
  if (!_segmenterTried) {
    _segmenterTried = true;
    try {
      if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') _segmenter = new Intl.Segmenter('th', { granularity: 'word' });
    } catch {
      _segmenter = null;
    }
  }
  const clean = String(text || '');
  if (_segmenter) {
    let n = 0;
    for (const s of _segmenter.segment(clean)) if (s.isWordLike) n++;
    return n;
  }
  return Math.max(1, Math.ceil(clean.replace(/\s+/g, '').length / 4));
}

/** คำสั่งตัด — ตัดทั้งประโยคหรือคงทั้งประโยคเท่านั้น ห้ามเรียบเรียงใหม่ (ให้ด่านตรวจข้อเท็จจริงจับได้ง่าย) */
export function buildTrimPrompt({ content, before, target, minWords, raw, rawChars = TRIM_PASS_DEFAULTS.rawChars }) {
  const rawText = String(raw || '');
  const rawShown = rawText.length > rawChars ? `${rawText.slice(0, rawChars)}\n…(ตัดแสดง)` : rawText;
  return [
    '=== งาน: ตัดฉบับให้กระชับ (TRIM PASS) ===',
    `ข้อความด้านล่างยาว ${before} คำ ต้องเหลือประมาณ ${target} คำ (ห้ามต่ำกว่า ${minWords} คำ)`,
    'กติกา:',
    '- ตัดได้เฉพาะประโยคที่ "ไม่มีข้อเท็จจริงใหม่": ประโยคบรรยายอารมณ์/ความเห็นของผู้เขียน ประโยคสรุปซ้ำใจความเดิม รายละเอียดตัวละครรอง ตัวอย่างที่ซ้ำกัน',
    '- ตัดทั้งประโยค หรือคงไว้ทั้งประโยคเท่านั้น — ห้ามเรียบเรียงใหม่ ห้ามเปลี่ยนคำ ห้ามเติมคำ ในประโยคที่เหลือ',
    '- ห้ามตัดหรือแก้ ชื่อ ตัวเลข วันที่ คำพูดในเครื่องหมายคำพูด จุดหักของเรื่อง และผลลัพธ์',
    '- คงจำนวนย่อหน้าและลำดับย่อหน้าเดิม (คั่นด้วยบรรทัดว่าง) ห้ามรวมย่อหน้า ห้ามเปลี่ยนประโยคเปิดของย่อหน้าแรก',
    '- ถ้าตัดแล้วข้อเท็จจริงจะหาย ให้คงประโยคนั้นไว้แม้จะยาวเกินเป้า',
    'ตอบเป็น JSON เท่านั้น: {"content": "ข้อความหลังตัด"}',
    '',
    '=== ต้นฉบับข่าวดิบ (ใช้เทียบว่าประโยคไหนมีข้อเท็จจริง — ห้ามคัดลอกสำนวนจากนี้) ===',
    rawShown,
    '=== จบต้นฉบับข่าวดิบ ===',
    '',
    '=== ข้อความที่ต้องตัด ===',
    String(content || ''),
    '=== จบข้อความที่ต้องตัด ===',
  ].join('\n');
}

/** ดึงเนื้อจากคำตอบ AI — รับ {content} · สตริง · {versions:[{content}]} · อื่น = '' */
export function pickTrimmedContent(result) {
  if (typeof result === 'string') return result.trim();
  if (result && typeof result === 'object') {
    if (typeof result.content === 'string') return result.content.trim();
    const first = Array.isArray(result.versions) ? result.versions[0] : null;
    if (first && typeof first.content === 'string') return first.content.trim();
  }
  return '';
}

/** คีย์ของรายการที่หาย (จาก findMissingFacts) — ชนิด|ข้อความ */
export function missingFactKeys(report) {
  const missing = Array.isArray(report?.missing) ? report.missing : [];
  return new Set(missing.map((m) => `${m?.type || ''}|${m?.text || ''}`));
}

/** เพดานเวลาในตัว (ไม่พึ่ง withTimeout ของท่อ — ไฟล์นี้ไม่มี import) · parentSignal ยกเลิก = ยกเลิกตาม */
function runWithTrimTimeout(factory, timeoutMs, parentSignal) {
  if (parentSignal?.aborted) {
    return Promise.reject(parentSignal.reason instanceof Error ? parentSignal.reason : new Error('writer_trim_pass: ถูกยกเลิกก่อนเริ่ม (parent signal aborted)'));
  }
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const onParentAbort = () => { if (ctrl && !ctrl.signal.aborted) ctrl.abort(parentSignal?.reason); };
  if (parentSignal && typeof parentSignal.addEventListener === 'function') parentSignal.addEventListener('abort', onParentAbort, { once: true });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`TIMEOUT: writer_trim_pass ใช้เวลาเกิน ${Math.round(timeoutMs / 1000)}s (ยกเลิก request แล้ว)`);
      err.failedStep = 'writer_trim_pass';
      if (ctrl && !ctrl.signal.aborted) ctrl.abort(err);
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve().then(() => factory(ctrl ? ctrl.signal : undefined)), timeout]).finally(() => {
    clearTimeout(timer);
    if (parentSignal && typeof parentSignal.removeEventListener === 'function') parentSignal.removeEventListener('abort', onParentAbort);
  });
}

/** เพดานรายการที่หายที่ขอจาก findMissingFacts ทั้ง 2 รอบ — ห้ามใช้ค่าเริ่มต้น 20 ของด่านนั้น (ของที่หายเพิ่มต้องไม่ตกนอกรายการ — ดูหมายเหตุผู้ตรวจไขว้หัวไฟล์) */
export const FACT_CHECK_MAX_MISSING = 10_000;

/**
 * ตัดฉบับที่ยาวเกิน — คืน version ใหม่ (ไม่แก้ object เดิม) พร้อม _trimPass เสมอ
 * @param {object} version ร่างจากนักเขียน (ใช้ .content)
 * @param {{
 *   raw?: string, maxWords?: number, target?: number, minWords?: number, timeoutMs?: number, rawChars?: number,
 *   callAI?: Function, model?: string, countWords?: (text: string) => number,
 *   findMissingFacts?: (raw: string, out: string, opts?: { maxMissing?: number }) => { missing: Array<{type: string, text: string}>, truncated?: number },
 *   signal?: AbortSignal,
 * }} [opts]
 */
export async function trimIfTooLong(version, opts = {}) {
  const {
    raw = '',
    maxWords = TRIM_PASS_DEFAULTS.maxWords,
    target = TRIM_PASS_DEFAULTS.target,
    minWords = TRIM_PASS_DEFAULTS.minWords,
    timeoutMs = TRIM_PASS_DEFAULTS.timeoutMs,
    rawChars = TRIM_PASS_DEFAULTS.rawChars,
    callAI,
    model,
    countWords = countThaiWordsDefault,
    findMissingFacts,
    signal,
  } = opts;
  const base = version && typeof version === 'object' ? version : {};
  const content = typeof base.content === 'string' ? base.content : '';
  const keep = (patch) => ({ ...base, _trimPass: { before: null, after: null, applied: false, reason: '', ...patch } });

  let before;
  try {
    before = countWords(content);
  } catch (err) {
    return keep({ reason: 'count_error', error: String(err?.message || err).slice(0, 120) });
  }
  if (!Number.isFinite(before) || before <= maxWords) return keep({ before, after: before, reason: 'within_max' });
  if (typeof callAI !== 'function') return keep({ before, after: before, reason: 'no_ai' });

  const prompt = buildTrimPrompt({ content, before, target, minWords, raw, rawChars });
  let result;
  try {
    result = await runWithTrimTimeout(
      (requestSignal) => callAI({
        prompt,
        ...(model ? { model } : {}),
        temperature: 0.2,
        maxTokens: 4000,
        ...(requestSignal ? { signal: requestSignal } : {}),
        allowModelFallback: false,
        maxRetries: 0,
      }),
      timeoutMs,
      signal,
    );
  } catch (err) {
    const message = String(err?.message || err);
    const reason = /^TIMEOUT/.test(message) ? 'timeout' : (signal?.aborted ? 'aborted' : 'ai_error');
    return keep({ before, after: before, reason, error: message.slice(0, 120) });
  }

  const next = pickTrimmedContent(result);
  if (!next) return keep({ before, after: before, reason: 'empty_result' });

  let after;
  try {
    after = countWords(next);
  } catch (err) {
    return keep({ before, after: before, reason: 'count_error', error: String(err?.message || err).slice(0, 120) });
  }
  if (!Number.isFinite(after) || after >= before) return keep({ before, after, reason: 'not_shorter' });
  if (after < minWords) return keep({ before, after, reason: 'too_short' });

  if (typeof findMissingFacts === 'function' && raw) {
    let lost = [];
    let truncated = 0;
    try {
      const factOpts = { maxMissing: FACT_CHECK_MAX_MISSING }; // ขอรายการเต็ม — ค่าเริ่มต้น 20 ของด่านซ่อนของที่หายเพิ่มได้ (ผู้ตรวจไขว้ 2 ก.ย. 69)
      const wasReport = findMissingFacts(raw, content, factOpts); // ของที่นักเขียนทิ้งไปตั้งแต่ร่างแรก — ไม่นับเป็น "หายเพิ่ม"
      const nowReport = findMissingFacts(raw, next, factOpts);
      truncated = (Number(wasReport?.truncated) || 0) + (Number(nowReport?.truncated) || 0);
      const wasMissing = missingFactKeys(wasReport);
      const nowMissing = Array.isArray(nowReport?.missing) ? nowReport.missing : [];
      lost = nowMissing.filter((m) => !wasMissing.has(`${m?.type || ''}|${m?.text || ''}`));
    } catch (err) {
      return keep({ before, after, reason: 'fact_check_error', error: String(err?.message || err).slice(0, 120) });
    }
    if (lost.length > 0) {
      return keep({ before, after, reason: 'facts_lost', lost: lost.slice(0, 5).map((m) => `${m.type}:${m.text}`) });
    }
    if (truncated > 0) {
      // รายงานถูกตัด = เทียบไม่ครบ ไม่รู้ว่าของที่ตกนอกรายการหายเพิ่มหรือไม่ → fail-safe ทิ้งผล ใช้ต้นฉบับ
      return keep({ before, after, reason: 'fact_check_truncated', truncated });
    }
  }

  return { ...base, content: next, _trimPass: { before, after, applied: true, reason: 'trimmed', originalChars: content.length } };
}
