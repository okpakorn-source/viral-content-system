// ============================================================
// 🧾 src/lib/research-agent/cardsSchema.js — สัญญา research-cards (SPEC-v2 ส่วน 2.2) + ด่านเชิงกลซ้ำที่ /report (ส่วน 6)
// ------------------------------------------------------------
// เลน B (ฝั่งเว็บ) · 1 ต.ค. 69 · โมดูล pure — ไม่มี import, ไม่แตะ DB/เน็ต (เทสตรงได้)
// หน้าที่: รับ `result` ที่ worker ส่งมา (รูป 2.2 ส่วนที่เอเจนต์กรอก) → ทำความสะอาด + จำกัดขนาด → เอกสาร research-cards
//   ด่านฝั่งเว็บ "บีบได้อย่างเดียว" (pass → staff_only → dropped) ไม่เคยปลดการ์ดที่ worker กันไว้:
//     1) schema: status ต้องเป็น done|failed|skipped · ถ้า done ต้องมี brain{kind} + plan[] + cards[] + raw_corrections[] + flags[]
//        ขาด = เอกสารสถานะ failed + ธง SCHEMA_INVALID (สเปก 6.1 "ขาด = failed")
//     2) evidence_quote ≥ 20 ตัวอักษร และมี token ร่วมกับ claim (ตัวเลข/คำละติน/คำไทย ≥4 ตัวอักษร) — ไม่ผ่าน → staff_only
//     4) source_url ต้อง http(s) และไม่ใช่เพจเราเอง (facebook.com/IG.dara) — ไม่ผ่าน → staff_only · origin_post ที่เป็นเพจเรา = ถือว่าไม่พบ
//     5) contradicts_raw / raw_corrections → ธง RAW_CONTRADICTION · raw_corrections ที่ไม่มี source_url http(s) ถูกตัด
//     6) confidence < 0.6 (หรือไม่ใช่ตัวเลข 0–1) → staff_only
//     8) การ์ดที่ไม่ dropped เกิน 8 ใบ → เก็บ 8 ใบ confidence สูงสุด ที่เหลือ dropped (OVER_LIMIT)
//   ข้อที่ "ไม่ได้" ทำซ้ำฝั่งเว็บ (อยู่ที่ worker เลน A): 3) คำต้องห้าม BLACKLIST (ไฟล์กลาง scripts/research-agent/blacklist.mjs)
//     7) คิดเงินจาก tool_log ด้วยตารางราคา (ฝั่งเว็บรับตัวเลข usage ที่ worker คำนวณ — แค่กรองให้เป็นตัวเลขไม่ติดลบ)
// ข้อความทุกช่องถูกตัดความยาว · tool_log ถูกลบรูปแบบกุญแจ (sk-… / api_key=… / Bearer …) ก่อนเก็บ — ห้ามมีคีย์ในผล
// ============================================================

export const RESEARCH_RESULT_STATUSES = Object.freeze(['done', 'failed', 'skipped']);
export const RESEARCH_CARD_GATES = Object.freeze(['pass', 'staff_only', 'dropped']);
export const RESEARCH_MAX_DISPLAY_CARDS = 8;
export const RESEARCH_MIN_EVIDENCE_CHARS = 20;
export const RESEARCH_MIN_PASS_CONFIDENCE = 0.6;
export const RESEARCH_MAX_FEEDBACK = 300;

const MAX_DROPPED_KEPT = 8;
const MAX_PLAN = 12;
const MAX_FLAGS = 20;
const MAX_RAW_CORRECTIONS = 10;
const MAX_SKIPPED = 20;
const MAX_TOOL_LOG = 100;
const FLAG_RE = /^[A-Z][A-Z0-9_]{1,47}$/;
const CARD_ID_RE = /^R\d{1,2}$/;
const GATE_RANK = { dropped: 0, staff_only: 1, pass: 2 };
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
const THAI_STOPWORDS = new Set([
  'เพราะ', 'สำหรับ', 'อย่างไร', 'ทั้งหมด', 'ระหว่าง', 'เกี่ยวกับ', 'อย่างไรก็ตาม', 'นอกจาก', 'ตั้งแต่', 'เมื่อวาน',
  'วันนี้', 'ที่ผ่านมา', 'ดังกล่าว', 'เท่านั้น', 'มากกว่า', 'น้อยกว่า', 'ขณะที่', 'ทั้งนี้', 'อย่างนั้น', 'อย่างนี้',
]);

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** ตัดสตริงตามจำนวนตัวอักษร (ไม่ตัดกลางคู่ surrogate) · ไม่ใช่สตริง = '' */
export function capText(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\u0000/g, '').trim();
  if (text.length <= max) return text;
  let out = text.slice(0, max);
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  return out;
}

const textOrNull = (value, max) => {
  const text = capText(value, max);
  return text ? text : null;
};

/** URL http(s) ที่ parse ได้จริง (คืน href ที่ normalize แล้ว) · อื่นๆ = null */
export function normalizeHttpUrl(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** เพจของเราเอง (รวมไอจีดารา / IG.dara) — ห้ามนับเป็นต้นทางหรือหลักฐาน (สเปก 4 + 6.4) */
export function isOwnPageUrl(value) {
  const href = normalizeHttpUrl(value);
  if (!href) return false;
  const url = new URL(href);
  const host = url.hostname.toLowerCase().replace(/^(www|m|mbasic|web)\./, '');
  if (host !== 'facebook.com' && host !== 'fb.com') return false;
  let first = url.pathname.split('/').filter(Boolean)[0] || '';
  try { first = decodeURIComponent(first); } catch { /* path เพี้ยน = ใช้ตัวดิบ */ }
  return first.toLowerCase() === 'ig.dara';
}

/** ตัวเลข 0–1 (นอกช่วง/ไม่ใช่ตัวเลข = null) */
function unitNumber(value) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

function nonNegative(value, { integer = false, max = 1e9 } = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  const bounded = Math.min(n, max);
  return integer ? Math.round(bounded) : bounded;
}

const SECRET_PATTERNS = [
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '[REDACTED]'],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, '[REDACTED]'],
  [/\bapify_api_[A-Za-z0-9]{10,}/gi, '[REDACTED]'],
  [/\btvly-[A-Za-z0-9_-]{10,}/gi, '[REDACTED]'],
  [/\bjina_[A-Za-z0-9]{16,}/gi, '[REDACTED]'],
  [/\bfc-[A-Za-z0-9]{16,}/g, '[REDACTED]'],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{10,}/g, '$1[REDACTED]'],
  [/((?:api[_-]?key|apikey|token|secret|password|authorization|x-api-key|x-research-secret)["']?\s*[:=]\s*["']?)[^\s"'&,;]{4,}/gi, '$1[REDACTED]'],
];

/** ลบรูปแบบกุญแจ/โทเคนออกจากข้อความ (ใช้กับ tool_log ที่เป็นคำสั่ง shell ของเอเจนต์) */
export function redactSecrets(text) {
  let out = String(text ?? '');
  for (const [re, replacement] of SECRET_PATTERNS) out = out.replace(re, replacement);
  return out;
}

const thaiDigitsToArabic = (text) => String(text ?? '').replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));

let _segmenter;
function thaiSegmenter() {
  if (_segmenter !== undefined) return _segmenter;
  try {
    _segmenter = typeof Intl?.Segmenter === 'function' ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
  } catch {
    _segmenter = null;
  }
  return _segmenter;
}

/** token ยึดโยงของ claim: ตัวเลข (ตัดจุลภาค) · คำละติน ≥3 ตัว · คำไทย ≥4 ตัวอักษรที่ไม่ใช่คำเชื่อมทั่วไป */
export function claimAnchorTokens(claim) {
  const text = thaiDigitsToArabic(claim);
  const tokens = new Set();
  for (const match of text.matchAll(/\d[\d,.]*/g)) {
    const digits = match[0].replace(/[,.]+$/, '').replace(/,/g, '');
    if (digits) tokens.add(digits);
  }
  for (const match of text.matchAll(/[A-Za-z][A-Za-z0-9'.-]{2,}/g)) tokens.add(match[0].toLowerCase().replace(/[.'-]+$/, ''));
  const segmenter = thaiSegmenter();
  if (segmenter) {
    for (const part of segmenter.segment(text)) {
      const word = part.segment;
      if (part.isWordLike && /[฀-๿]/.test(word) && word.length >= 4 && !THAI_STOPWORDS.has(word)) tokens.add(word);
    }
  }
  tokens.delete('');
  return tokens;
}

/** evidence_quote มี token ยึดโยงของ claim อย่างน้อย 1 ตัว */
export function evidenceAnchorsClaim(claim, quote) {
  const haystack = thaiDigitsToArabic(quote).toLowerCase().replace(/,/g, '');
  if (!haystack) return false;
  for (const token of claimAnchorTokens(claim)) {
    if (haystack.includes(token)) return true;
  }
  return false;
}

const tighten = (gate, cap) => (GATE_RANK[cap] < GATE_RANK[gate] ? cap : gate);

function normalizePlan(plan) {
  if (!Array.isArray(plan)) return [];
  return plan.filter(isPlainObject).slice(0, MAX_PLAN).map((item) => {
    const rawDecided = capText(item.decided, 20);
    const decided = rawDecided === 'ค้น' || rawDecided === 'ไม่ค้น' ? rawDecided : (/ไม่/.test(rawDecided) ? 'ไม่ค้น' : 'ค้น');
    return {
      question: capText(item.question, 300),
      why_valuable: capText(item.why_valuable, 300),
      decided,
      reason: capText(item.reason, 300),
    };
  }).filter((item) => item.question);
}

function normalizeBrain(brain) {
  if (!isPlainObject(brain)) return null;
  const kind = capText(brain.kind, 10).toLowerCase();
  const out = {
    kind: kind === 'api' ? 'api' : (kind === 'codex' ? 'codex' : null),
    model: capText(brain.model, 60) || 'gpt-6-astra',
    effort: capText(brain.effort, 20).toLowerCase() || 'low',
    account: capText(brain.account, 40) || null,
  };
  const quota = nonNegative(brain.quotaPctAfter, { max: 100 });
  if (quota !== null) out.quotaPctAfter = quota;
  return out;
}

function normalizeOrigin(origin, flags, gateChanges) {
  if (!isPlainObject(origin)) {
    if (flags) flags.add('ORIGIN_NOT_FOUND');
    return null;
  }
  let url = normalizeHttpUrl(origin.url);
  let confidence = unitNumber(origin.confidence) ?? 0;
  if (url && isOwnPageUrl(url)) {
    gateChanges.push({ field: 'origin_post', reason: 'OWN_PAGE_ORIGIN' });
    url = null;
  }
  if (!url) {
    if (flags) flags.add('ORIGIN_NOT_FOUND');
    confidence = 0;
  }
  return {
    url,
    source_name: capText(origin.source_name, 200),
    date: capText(origin.date, 80),
    confidence,
  };
}

function normalizeCard(card, gateChanges) {
  if (!isPlainObject(card)) return null;
  const claim = capText(card.claim, 600);
  if (!claim) return null;
  const evidence = capText(card.evidence_quote, 1000);
  const sourceUrl = normalizeHttpUrl(card.source_url);
  const confidence = unitNumber(card.confidence);
  const workerGate = RESEARCH_CARD_GATES.includes(card.gate) ? card.gate : 'staff_only';
  const reasons = [];
  let gate = workerGate;
  if (!sourceUrl) { gate = tighten(gate, 'staff_only'); reasons.push('SOURCE_URL_INVALID'); }
  else if (isOwnPageUrl(sourceUrl)) { gate = tighten(gate, 'staff_only'); reasons.push('OWN_PAGE_SOURCE'); }
  if (confidence === null || confidence < RESEARCH_MIN_PASS_CONFIDENCE) { gate = tighten(gate, 'staff_only'); reasons.push('LOW_CONFIDENCE'); }
  if (evidence.length < RESEARCH_MIN_EVIDENCE_CHARS) { gate = tighten(gate, 'staff_only'); reasons.push('EVIDENCE_TOO_SHORT'); }
  else if (!evidenceAnchorsClaim(claim, evidence)) { gate = tighten(gate, 'staff_only'); reasons.push('EVIDENCE_NO_ANCHOR'); }
  const workerReason = capText(card.gate_reason, 200);
  const changed = gate !== workerGate;
  if (!RESEARCH_CARD_GATES.includes(card.gate)) {
    gateChanges.push({ cardId: capText(card.id, 8) || null, from: null, to: gate, reasons: ['GATE_MISSING', ...reasons] });
  } else if (changed) {
    gateChanges.push({ cardId: capText(card.id, 8) || null, from: workerGate, to: gate, reasons });
  }
  const out = {
    id: CARD_ID_RE.test(card.id) ? card.id : null,
    claim,
    value_type: capText(card.value_type, 40),
    why_it_adds_value: capText(card.why_it_adds_value, 400),
    evidence_quote: evidence,
    source_url: sourceUrl,
    source_name: capText(card.source_name, 200),
    source_date: capText(card.source_date, 120),
    confidence: confidence ?? 0,
    contradicts_raw: card.contradicts_raw === true,
    identity: card.identity === 'verified' ? 'verified' : 'generic',
    gate,
  };
  const reasonText = [workerReason, changed && reasons.length ? `web:${reasons.join('+')}` : ''].filter(Boolean).join(' · ');
  if (reasonText) out.gate_reason = capText(reasonText, 240);
  return out;
}

function assignCardIds(cards) {
  const used = new Set();
  for (const card of cards) {
    if (card.id && !used.has(card.id)) used.add(card.id);
    else card.id = null;
  }
  let next = 1;
  for (const card of cards) {
    if (card.id) continue;
    while (used.has(`R${next}`)) next += 1;
    card.id = `R${next}`;
    used.add(card.id);
  }
  return cards;
}

function capCards(cards, gateChanges) {
  const live = cards.filter((c) => c.gate !== 'dropped');
  const dropped = cards.filter((c) => c.gate === 'dropped');
  const ranked = live
    .map((card, index) => ({ card, index }))
    .sort((a, b) => (b.card.confidence - a.card.confidence) || (a.index - b.index))
    .map(({ card }) => card);
  const kept = ranked.slice(0, RESEARCH_MAX_DISPLAY_CARDS);
  for (const card of ranked.slice(RESEARCH_MAX_DISPLAY_CARDS)) {
    gateChanges.push({ cardId: card.id, from: card.gate, to: 'dropped', reasons: ['OVER_LIMIT'] });
    card.gate = 'dropped';
    card.gate_reason = capText([card.gate_reason, 'web:OVER_LIMIT'].filter(Boolean).join(' · '), 240);
    dropped.push(card);
  }
  return [...kept, ...dropped.slice(0, MAX_DROPPED_KEPT)];
}

function normalizeRawCorrections(list, gateChanges) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (!isPlainObject(item)) continue;
    const field = capText(item.field, 80);
    const sourceUrl = normalizeHttpUrl(item.source_url);
    if (!field || !sourceUrl || isOwnPageUrl(sourceUrl)) {
      gateChanges.push({ field: 'raw_corrections', reason: !field ? 'FIELD_MISSING' : 'SOURCE_URL_INVALID' });
      continue;
    }
    out.push({
      field,
      raw_value: capText(String(item.raw_value ?? ''), 300),
      source_value: capText(String(item.source_value ?? ''), 300),
      source_url: sourceUrl,
      confidence: unitNumber(item.confidence) ?? 0,
    });
    if (out.length >= MAX_RAW_CORRECTIONS) break;
  }
  return out;
}

function normalizeToolLog(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(isPlainObject).slice(0, MAX_TOOL_LOG).map((entry) => ({
    tool: capText(redactSecrets(entry.tool), 80),
    args: capText(redactSecrets(typeof entry.args === 'string' ? entry.args : JSON.stringify(entry.args ?? '')), 400),
    ok: entry.ok === true,
    note: capText(redactSecrets(entry.note), 400),
    ms: nonNegative(entry.ms, { integer: true, max: 3_600_000 }),
  }));
}

function normalizeUsage(usage, toolLog) {
  const source = isPlainObject(usage) ? usage : {};
  const out = {
    tool_calls: nonNegative(source.tool_calls, { integer: true, max: 10_000 }) ?? toolLog.length,
    minutes: nonNegative(source.minutes, { max: 1_440 }) ?? 0,
    costUsd: nonNegative(source.costUsd, { max: 10_000 }) ?? 0,
  };
  const tokens = nonNegative(source.codexTokens, { integer: true, max: 1e9 });
  if (tokens !== null) out.codexTokens = tokens;
  return out;
}

function normalizeFlags(list) {
  const flags = new Set();
  if (Array.isArray(list)) {
    for (const flag of list) {
      const value = capText(flag, 48).toUpperCase();
      if (FLAG_RE.test(value)) flags.add(value);
    }
  }
  return flags;
}

/** รายการ feedback ที่ปลอดภัย (ของเดิมในเอกสาร — worker ส่งมาไม่ได้) */
export function normalizeFeedbackList(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((f) => isPlainObject(f)
    && typeof f.userId === 'string' && f.userId
    && typeof f.cardId === 'string' && f.cardId
    && (f.vote === 'up' || f.vote === 'down')).slice(-RESEARCH_MAX_FEEDBACK);
}

function schemaProblems(result) {
  if (!isPlainObject(result)) return ['result ต้องเป็น object'];
  const problems = [];
  if (!RESEARCH_RESULT_STATUSES.includes(result.status)) problems.push('status ต้องเป็น done|failed|skipped');
  if (result.status === 'done') {
    if (!isPlainObject(result.brain)) problems.push('brain ต้องเป็น object');
    else if (!['codex', 'api'].includes(String(result.brain.kind || '').toLowerCase())) problems.push('brain.kind ต้องเป็น codex|api');
    for (const key of ['plan', 'cards', 'raw_corrections', 'flags']) {
      if (!Array.isArray(result[key])) problems.push(`${key} ต้องเป็น array`);
    }
  }
  return problems;
}

/**
 * แปลงผลจาก worker → เอกสาร research-cards (สัญญา 2.2) + ด่านซ้ำฝั่งเว็บ
 * @param {object} result  ผลที่ worker ส่งมา
 * @param {{ jobId: string, mode: string, nowIso: string, existing?: object|null }} ctx
 * @returns {{ doc: object, schemaErrors: string[], gateChanges: object[] }}
 */
export function buildResearchCardsDoc(result, { jobId, mode, nowIso, existing = null }) {
  const schemaErrors = schemaProblems(result);
  const source = isPlainObject(result) ? result : {};
  const gateChanges = [];
  const flags = normalizeFlags(source.flags);
  const schemaOk = schemaErrors.length === 0;
  if (!schemaOk) flags.add('SCHEMA_INVALID');
  const status = schemaOk ? source.status : 'failed';
  const toolLog = normalizeToolLog(source.tool_log);
  let cards = [];
  let rawCorrections = [];
  let origin = null;
  if (schemaOk) {
    cards = (Array.isArray(source.cards) ? source.cards : []).slice(0, 40)
      .map((card) => normalizeCard(card, gateChanges)).filter(Boolean);
    assignCardIds(cards);
    cards = capCards(cards, gateChanges);
    rawCorrections = normalizeRawCorrections(source.raw_corrections, gateChanges);
    origin = normalizeOrigin(source.origin_post, status === 'done' ? flags : null, gateChanges);
    if (cards.some((c) => c.contradicts_raw && c.gate !== 'dropped') || rawCorrections.length > 0) flags.add('RAW_CONTRADICTION');
  }
  const doc = {
    id: jobId,
    revision: (Number.isSafeInteger(existing?.revision) ? existing.revision : 0) + 1,
    status,
    mode,
    brain: normalizeBrain(source.brain),
    plan: schemaOk ? normalizePlan(source.plan) : [],
    origin_post: origin,
    story_date_estimate: textOrNull(source.story_date_estimate, 40),
    stale_news_warning: textOrNull(source.stale_news_warning, 600),
    cards,
    raw_corrections: rawCorrections,
    flags: [...flags].slice(0, MAX_FLAGS),
    skipped: (Array.isArray(source.skipped) ? source.skipped : []).map((s) => capText(s, 300)).filter(Boolean).slice(0, MAX_SKIPPED),
    tool_log: toolLog,
    usage: normalizeUsage(source.usage, toolLog),
    feedback: normalizeFeedbackList(existing?.feedback),
    createdAt: typeof existing?.createdAt === 'string' ? existing.createdAt : nowIso,
    updatedAt: nowIso,
  };
  if (!schemaOk) doc.schema_errors = schemaErrors.slice(0, 10);
  return { doc, schemaErrors, gateChanges };
}

/** นับการ์ดตาม gate (การ์ดที่ไม่ dropped = แสดงพนักงานได้) */
export function summarizeCardsDoc(doc) {
  const cards = Array.isArray(doc?.cards) ? doc.cards : [];
  const passCount = cards.filter((c) => c?.gate === 'pass').length;
  const staffOnlyCount = cards.filter((c) => c?.gate === 'staff_only').length;
  return {
    status: typeof doc?.status === 'string' ? doc.status : null,
    cardsCount: passCount + staffOnlyCount,
    passCount,
    staffOnlyCount,
    droppedCount: cards.filter((c) => c?.gate === 'dropped').length,
    flags: Array.isArray(doc?.flags) ? doc.flags.filter((f) => typeof f === 'string').slice(0, MAX_FLAGS) : [],
  };
}
