/**
 * 🔤 scripts/research-agent/encodingCheck.mjs — ตรวจผลเอเจนต์ที่ "เข้ารหัสผิด" (ภาษาไทยกลายเป็น ?) · ตัวช่วยใช้ร่วมทุกชั้น
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 10 · W4)
 * เหตุ: batch 8 ข่าว 1 ต.ค. 69 20:30 — 2/8 งาน (q_d764ba79bf9f9c4e มาเบล · q_6c9c302018601b41 เข้ม) out/result.json ที่เอเจนต์
 *   เขียนเองบน Windows ภาษาไทยทุกตัวกลายเป็น ? (ตัวเลข/URL/อังกฤษครบ · ไฟล์ CRLF ไม่มี BOM) — คาดว่าส่งสคริปต์/ข้อความไทยผ่าน
 *   pipe ของ PowerShell 5.1 ($OutputEncoding = ASCII) หรือเขียนด้วย Set-Content/Out-File แบบ ANSI · ด่าน gate เดิมปล่อยการ์ด ?
 *   ผ่าน 4 ใบ (conf 0.94–0.99) · บรรณาธิการอ่านไม่ออกจึงไม่ใช้ (ถูก) แต่เสียงานรีเสิร์ชทั้งรอบ
 * ผู้ใช้กฎชุดเดียวกันนี้ 3 ชั้น:
 *   1) scripts/research-tools/check-result.mjs — เอเจนต์รันเองก่อนจบงาน (exit 0/1 + JSON) → checkResultText()
 *   2) codexRunner.readAgentResult ติดผลตรวจ (encoding) → worker: รันซ้ำ 1 รอบ / failed + ธง ENCODING_BROKEN → isEncodingBroken()
 *   3) gate.gateCard: การ์ดที่ claim/evidence_quote เสีย → dropped เหตุผล ENCODING_BROKEN (กันกรณีเสียบางใบ) → cardEncodingBroken()
 * กฎ (นับทีละ code point หลังตัด URL · ไม่นับช่องว่าง/ตัวเลข 0–9 ๐–๙):
 *   "อักษรเสีย" = '?' + U+FFFD (ไบต์ที่ไม่ใช่ UTF-8 เช่นไฟล์ cp874) + mojibake 'à¸'/'à¹' (UTF-8 ถูกอ่านเป็น ANSI แล้วเขียนซ้ำ · คู่ละ 3 ตัว)
 *   ทั้งผล (สเปก: "ไทย ≥ 1 ตัว และ ? ≤ 5%") = เสียเมื่อมีอักษร > 0 และ
 *     (ก) ไม่มีอักษรไทยเลยแต่มีอักษรเสีย ≥ 1 (NO_THAI) หรือ (ข) อักษรเสีย ≥ 5 ตัว และ > 5% ของอักษรทั้งหมด (TOO_MANY_BAD_CHARS)
 *     ข้อปรับจากสเปก (กันจับผิด ไม่ลดการจับจริง — ไฟล์เสียจริงมี ? หลายร้อยตัว): ไม่มีข้อความเลย = ไม่เสีย (ผลว่างไม่ใช่ปัญหาเข้ารหัส) ·
 *     ? หลุดมาไม่ถึง 5 ตัว ไม่ตัดสินด้วยสัดส่วน (แผนข้อเดียว "ต้นทางอยู่ไหน?") · อังกฤษล้วนที่ไม่มีอักษรเสียเลย ไม่ใช่ปัญหาเข้ารหัส
 *   ช่องเดียว (สเปก: "? ≥ 50% ของอักษร") = เสียเมื่ออักษรเสีย ≥ 3 ตัว และ ≥ 50% ของอักษรในช่อง ("?" ตัวเดียว = เครื่องหมายไม่ทราบ ไม่ใช่เข้ารหัส)
 * ช่องที่นับ (ข้อความอิสระที่เอเจนต์เขียน · ไม่นับ enum เช่น decided/value_type/complexity และไม่นับ tool_log ที่เป็นคำสั่ง/อาร์กิวเมนต์):
 *   plan[].question/why_valuable/reason (รับชื่อแล็บเก่า research_plan · q · why) · cards[].claim/evidence_quote/why_it_adds_value/source_name
 *   + quote.text/speaker (รับ fact_cards · evidence · why) · skipped[] · raw_corrections[].field/raw_value/source_value/from/to ·
 *   raw_contradictions[] · origin_post.source_name · stale_news_warning · suggested_dimensions[] · browser_available ·
 *   self_report.what_would_help_next_time
 * ฟังก์ชันล้วน: ไม่อ่าน env · ไม่อ้างตำแหน่งไฟล์ตัวเอง · ไม่ import อะไร · ไม่โยน error (ข้อมูลผิดรูป = นับเท่าที่อ่านได้ — fail-open)
 */

/** ธงระดับระเบียน (schema.mjs SYSTEM_FLAGS) และเหตุผลระดับการ์ด (gate_reason) */
export const ENCODING_FLAG = 'ENCODING_BROKEN';

export const ENCODING_RULES = Object.freeze({
  MAX_BAD_RATIO: 0.05, // ทั้งผล: อักษรเสียเกิน 5% ของอักษรทั้งหมด = เสีย (สเปกส่วน 10 ชั้น 2)
  MIN_BAD_FOR_RATIO: 5, // สัดส่วนใช้ตัดสินเมื่ออักษรเสีย ≥ 5 ตัว
  FIELD_BAD_RATIO: 0.5, // ช่องเดียว: อักษรเสีย ≥ 50% ของอักษรในช่อง = ช่องเสีย (สเปกส่วน 10 schema/gate)
  MIN_BAD_FIELD: 3, // ช่องเดียวต้องมีอักษรเสีย ≥ 3 ตัว
  MAX_FIELDS_LISTED: 20, // รายชื่อช่องเสียที่คืน (นับทั้งหมดใน badFieldCount)
});

const URL_RE = /(?:https?:\/\/|www\.)\S+/giu;
const MOJIBAKE_RE = /\u{E0}[\u{B8}\u{B9}]/gu;
const SPACE_RE = /\s/u;
const DIGIT_RE = /[0-9\u{E50}-\u{E59}]/u;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const emptyStats = () => ({ letters: 0, thaiChars: 0, questionMarks: 0, replacementChars: 0, mojibake: 0, bad: 0 });

/**
 * นับอักษรของข้อความ 1 ช่อง (ตัด URL · ไม่นับช่องว่าง/ตัวเลข)
 * @param {unknown} text
 * @returns {{letters:number, thaiChars:number, questionMarks:number, replacementChars:number, mojibake:number, bad:number}}
 */
export function textEncodingStats(text) {
  const out = emptyStats();
  if (typeof text !== 'string' || !text) return out;
  const s = text.replace(URL_RE, ' ');
  for (const ch of s) {
    if (SPACE_RE.test(ch) || DIGIT_RE.test(ch)) continue;
    out.letters += 1;
    if (ch === '?') out.questionMarks += 1;
    else if (ch === '\u{FFFD}') out.replacementChars += 1;
    else if (ch >= '\u{E00}' && ch <= '\u{E7F}') out.thaiChars += 1;
  }
  out.mojibake = (s.match(MOJIBAKE_RE) || []).length;
  out.bad = Math.min(out.letters, out.questionMarks + out.replacementChars + out.mojibake * 3);
  return out;
}

/** ช่องข้อความ 1 ช่องเสียไหม (อักษรเสีย ≥ 3 ตัว และ ≥ 50% ของอักษรในช่อง) */
export function isFieldBroken(text) {
  const st = textEncodingStats(text);
  return st.bad >= ENCODING_RULES.MIN_BAD_FIELD && st.bad / Math.max(1, st.letters) >= ENCODING_RULES.FIELD_BAD_RATIO;
}

/** ข้อความของค่า 1 ค่า: สตริง = ตัวเอง · object/array = สตริงชั้นแรกต่อกัน · อื่นๆ = '' */
function flatText(v) {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join(' ');
  if (isObj(v)) return Object.values(v).filter((x) => typeof x === 'string').join(' ');
  return '';
}
const firstArray = (...vals) => vals.find((v) => Array.isArray(v)) || [];

/**
 * ช่องข้อความอิสระของผลเอเจนต์ (ยังไม่ normalize ก็ได้ · รับชื่อแล็บเก่า) → [{path, text}] เฉพาะช่องที่เป็นสตริงไม่ว่าง
 * @param {unknown} result
 * @returns {Array<{path:string, text:string}>}
 */
export function resultTextFields(result) {
  const out = [];
  if (!isObj(result)) return out;
  const push = (p, v) => { const t = flatText(v); if (t.trim()) out.push({ path: p, text: t }); };
  firstArray(result.plan, result.research_plan).forEach((p, i) => {
    if (typeof p === 'string') { push(`plan[${i}]`, p); return; }
    if (!isObj(p)) return;
    push(`plan[${i}].question`, p.question ?? p.q);
    push(`plan[${i}].why_valuable`, p.why_valuable ?? p.why);
    push(`plan[${i}].reason`, p.reason);
  });
  firstArray(result.cards, result.fact_cards).forEach((c, i) => {
    if (!isObj(c)) return;
    push(`cards[${i}].claim`, c.claim);
    push(`cards[${i}].evidence_quote`, c.evidence_quote ?? c.evidence);
    push(`cards[${i}].why_it_adds_value`, c.why_it_adds_value ?? c.why);
    push(`cards[${i}].source_name`, c.source_name);
    if (isObj(c.quote)) {
      push(`cards[${i}].quote.text`, c.quote.text);
      push(`cards[${i}].quote.speaker`, c.quote.speaker);
    }
  });
  arr(result.skipped).forEach((s, i) => push(`skipped[${i}]`, s));
  arr(result.raw_corrections).forEach((x, i) => {
    if (!isObj(x)) return;
    for (const k of ['field', 'raw_value', 'source_value', 'from', 'to']) push(`raw_corrections[${i}].${k}`, x[k]);
  });
  arr(result.raw_contradictions).forEach((s, i) => push(`raw_contradictions[${i}]`, s));
  if (isObj(result.origin_post)) push('origin_post.source_name', result.origin_post.source_name);
  push('stale_news_warning', typeof result.stale_news_warning === 'string' ? result.stale_news_warning : '');
  arr(result.suggested_dimensions).forEach((d, i) => push(`suggested_dimensions[${i}]`, typeof d === 'string' ? d : ''));
  push('browser_available', typeof result.browser_available === 'string' ? result.browser_available : '');
  if (isObj(result.self_report)) push('self_report.what_would_help_next_time', result.self_report.what_would_help_next_time);
  return out;
}

/**
 * ผลเอเจนต์ทั้งก้อนเข้ารหัสผิดไหม (กฎเดียวกับ check-result.mjs และ worker) — ไม่โยน error
 * @param {unknown} result  JSON ของเอเจนต์ (out/result.json · ข้อความสุดท้าย · โหมด API)
 * @returns {{broken:boolean, reason:null|'NO_THAI'|'TOO_MANY_BAD_CHARS', thaiChars:number, questionMarks:number,
 *   replacementChars:number, mojibake:number, letters:number, bad:number, ratio:number, badFields:string[], badFieldCount:number, fieldCount:number}}
 */
export function isEncodingBroken(result) {
  const total = emptyStats();
  const badFields = [];
  let fieldCount = 0;
  try {
    for (const f of resultTextFields(result)) {
      fieldCount += 1;
      const st = textEncodingStats(f.text);
      for (const k of Object.keys(total)) total[k] += st[k];
      if (st.bad >= ENCODING_RULES.MIN_BAD_FIELD && st.bad / Math.max(1, st.letters) >= ENCODING_RULES.FIELD_BAD_RATIO) badFields.push(f.path);
    }
  } catch {
    // fail-open: ข้อมูลประหลาดจนนับไม่ได้ = ตัดสินจากที่นับได้ถึงตรงนั้น
  }
  const ratio = total.letters > 0 ? total.bad / total.letters : 0;
  let reason = null;
  if (total.letters > 0) {
    if (total.thaiChars === 0 && total.bad > 0) reason = 'NO_THAI';
    else if (total.bad >= ENCODING_RULES.MIN_BAD_FOR_RATIO && ratio > ENCODING_RULES.MAX_BAD_RATIO) reason = 'TOO_MANY_BAD_CHARS';
  }
  return {
    broken: reason !== null,
    reason,
    thaiChars: total.thaiChars,
    questionMarks: total.questionMarks,
    replacementChars: total.replacementChars,
    mojibake: total.mojibake,
    letters: total.letters,
    bad: total.bad,
    ratio: Math.round(ratio * 10000) / 10000,
    badFields: badFields.slice(0, ENCODING_RULES.MAX_FIELDS_LISTED),
    badFieldCount: badFields.length,
    fieldCount,
  };
}

/**
 * การ์ด 1 ใบ: ข้อความหลัก (claim · evidence_quote) เสียไหม — ใช้ที่ gate.gateCard (ใบนั้น dropped เหตุผล ENCODING_BROKEN)
 * ไม่นับ source_name/why ในการตัดสินใบ (ป้ายสั้น/คำอธิบายเสียอย่างเดียวไม่ทำให้ข้อเท็จจริงใช้ไม่ได้ — ไฟล์เสียจริงเสียทุกช่องพร้อมกัน)
 * @param {unknown} card  การ์ด (normalize แล้วหรือรูปแล็บเก่า)
 * @returns {{broken:boolean, fields:string[]}}
 */
export function cardEncodingBroken(card) {
  if (!isObj(card)) return { broken: false, fields: [] };
  const fields = [];
  if (isFieldBroken(card.claim)) fields.push('claim');
  if (isFieldBroken(card.evidence_quote ?? card.evidence)) fields.push('evidence_quote');
  return { broken: fields.length > 0, fields };
}

/** คำพูดตรงในการ์ด (quote.text) เสียไหม — gate.gateQuote ลบ quote ทิ้ง (การ์ดคงเดิม · แนวเดียวกับ W2 "ไม่ตัดการ์ดเพราะฟิลด์ใหม่") */
export function quoteEncodingBroken(quote) {
  return isObj(quote) && isFieldBroken(quote.text);
}

/**
 * ผลทั้งรอบเสีย (worker ตัดสินแล้วว่าใช้ไม่ได้) → การ์ดทุกใบ gate=dropped + เหตุผล ENCODING_BROKEN (ไม่ส่งบรรณาธิการ/ไม่โชว์เป็นข้อเท็จจริง)
 * คงช่องอื่นเดิม (ไว้ตรวจย้อนหลัง) · identity = generic · เหตุผลเดิมต่อท้าย · ไม่ใช่ array = []
 * @param {unknown} cards
 * @returns {object[]}
 */
export function dropCardsForEncoding(cards) {
  return arr(cards).filter(isObj).map((c) => {
    const prev = typeof c.gate_reason === 'string' ? c.gate_reason.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const reasons = [ENCODING_FLAG, ...prev.filter((r) => r !== ENCODING_FLAG)];
    return { ...c, gate: 'dropped', identity: 'generic', gate_reason: reasons.join(',') };
  });
}

/**
 * ถอดไบต์ไฟล์ผล: BOM UTF-8 (ยอม ไม่บังคับ) · UTF-16LE/BE มี BOM (PowerShell Out-File) · อื่นๆ = UTF-8
 * ไบต์ที่ไม่ใช่ UTF-8 (เช่นไฟล์ cp874) ถอดเป็น U+FFFD → นับเป็นอักษรเสีย · encoding บอกว่าเจออะไร
 * @param {Buffer|Uint8Array|null} buf
 * @returns {{text:string, encoding:'empty'|'utf8'|'invalid-utf8'|'utf16le'|'utf16be', bom:boolean}}
 */
export function decodeTextBuffer(buf) {
  if (!buf || !buf.length) return { text: '', encoding: 'empty', bom: false };
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b[0] === 0xFF && b[1] === 0xFE) return { text: b.subarray(2).toString('utf16le'), encoding: 'utf16le', bom: true };
  if (b[0] === 0xFE && b[1] === 0xFF) {
    const body = Buffer.from(b.subarray(2, 2 + Math.floor((b.length - 2) / 2) * 2));
    body.swap16();
    return { text: body.toString('utf16le'), encoding: 'utf16be', bom: true };
  }
  const bom = b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
  const body = bom ? b.subarray(3) : b;
  let valid = true;
  try { new TextDecoder('utf-8', { fatal: true }).decode(body); } catch { valid = false; }
  return { text: body.toString('utf8'), encoding: valid ? 'utf8' : 'invalid-utf8', bom };
}

/** คีย์บังคับของผล (ชื่อพ้องแบบแล็บเก่าใช้ได้ — ตรงกับ schema.normalizeAgentResult) */
const REQUIRED_SHAPE = Object.freeze([
  ['plan', ['plan', 'research_plan'], 'array'],
  ['cards', ['cards', 'fact_cards'], 'array'],
  ['tool_log', ['tool_log', 'tools_log'], 'array'],
  ['origin_post', ['origin_post'], 'object'],
]);
/** คีย์บังคับที่ขาด/ผิดชนิด (ชื่อหลัก) — ขาด = worker ตีงานเป็น AGENT_FAILED จึงให้เอเจนต์แก้ก่อนจบ */
export function missingResultKeys(result) {
  if (!isObj(result)) return REQUIRED_SHAPE.map(([name]) => name);
  return REQUIRED_SHAPE.filter(([, keys, kind]) => {
    const k = keys.find((x) => Object.prototype.hasOwnProperty.call(result, x));
    if (!k) return true;
    return kind === 'array' ? !Array.isArray(result[k]) : !isObj(result[k]);
  }).map(([name]) => name);
}

/** คำแนะนำ (ASCII ล้วน — คอนโซล PowerShell บางเครื่องทำภาษาไทยในผลเครื่องมือพังได้) */
const HINTS = Object.freeze({
  EMPTY_FILE: 'out/result.json is empty - write the full result JSON with apply_patch, then run this check again.',
  JSON_PARSE: 'out/result.json is not valid JSON - rewrite it with apply_patch (one JSON object, UTF-8), then run this check again.',
  NOT_OBJECT: 'out/result.json must be one JSON object (not an array/string) - rewrite it with apply_patch.',
  NO_THAI: "Thai text became '?' (file saved as ANSI or Thai piped through PowerShell). Delete out/result.json and write it again with apply_patch only - never Set-Content/Out-File/echo/> or '| python -' / '| node -'. Then run this check again.",
  TOO_MANY_BAD_CHARS: "Too many '?' or broken characters - part of the Thai text was lost. Delete out/result.json and write it again with apply_patch only (no Set-Content/Out-File/echo/>/pipes). Then run this check again.",
  MISSING_KEYS: 'Required keys missing (plan, cards, tool_log arrays and origin_post object) - fix out/result.json with apply_patch, then run this check again.',
});

/**
 * ตรวจข้อความไฟล์ผลทั้งไฟล์ (ที่ถอดไบต์แล้ว) — ใช้โดย check-result.mjs · ไม่โยน error
 * ok = JSON object ที่ parse ได้ + ไม่เข้ารหัสผิด (isEncodingBroken) + มีคีย์บังคับครบ
 * @param {string} text
 * @returns {{ok:boolean, reason:string|null, thaiChars:number, questionMarks:number, replacementChars:number, mojibake:number,
 *   letters:number, ratio:number, fields_bad:string[], fields_bad_count:number, missing_keys:string[], hint:string|null, error?:string}}
 */
export function checkResultText(text) {
  const base = {
    ok: false, reason: null, thaiChars: 0, questionMarks: 0, replacementChars: 0, mojibake: 0, letters: 0, ratio: 0,
    fields_bad: [], fields_bad_count: 0, missing_keys: [], hint: null,
  };
  const raw = String(text == null ? '' : text).replace(/^\u{FEFF}/u, '');
  if (!raw.trim()) return { ...base, reason: 'EMPTY_FILE', hint: HINTS.EMPTY_FILE };
  let json;
  try { json = JSON.parse(raw); } catch (e) {
    return { ...base, reason: 'JSON_PARSE', error: String((e && e.message) || e).replace(/[^\x20-\x7E]/gu, '?').slice(0, 160), hint: HINTS.JSON_PARSE };
  }
  if (!isObj(json)) return { ...base, reason: 'NOT_OBJECT', hint: HINTS.NOT_OBJECT };
  const enc = isEncodingBroken(json);
  const missing = missingResultKeys(json);
  let reason = enc.reason;
  if (!reason && missing.length) reason = 'MISSING_KEYS';
  return {
    ...base,
    ok: reason === null,
    reason,
    thaiChars: enc.thaiChars,
    questionMarks: enc.questionMarks,
    replacementChars: enc.replacementChars,
    mojibake: enc.mojibake,
    letters: enc.letters,
    ratio: enc.ratio,
    fields_bad: enc.badFields,
    fields_bad_count: enc.badFieldCount,
    missing_keys: missing,
    hint: reason ? HINTS[reason] : null,
  };
}

/** สรุปสั้นสำหรับ log/tool_log ของ worker (ไม่มีเนื้อข่าว · ตัวเลขล้วน) */
export function summarizeEncoding(enc) {
  if (!enc || typeof enc !== 'object') return 'ตรวจการเข้ารหัสไม่ได้';
  const pct = Math.round((Number(enc.ratio) || 0) * 1000) / 10;
  return `ไทย ${enc.thaiChars} ตัว · อักษรเสีย ${enc.bad}/${enc.letters} (${pct}%) · ช่องเสีย ${enc.badFieldCount}/${enc.fieldCount}${enc.reason ? ` · ${enc.reason}` : ''}`;
}
