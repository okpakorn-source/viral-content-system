/**
 * 📐 scripts/research-agent/schema.mjs — สัญญาข้อมูลของเอเจนต์รีเสิร์ช (SPEC-v2 ส่วน 2.2 · ด่าน 1 ของส่วน 6)
 * ─────────────────────────────────────────────────────────────────────────────
 * แบ่ง 2 ชั้น:
 *   (ก) "ส่วนที่เอเจนต์กรอก" (out/result.json ของ Codex หรือคำตอบโหมด API) → normalizeAgentResult()
 *       รับชื่อฟิลด์แบบแล็บเก่าด้วย (research_plan / fact_cards / raw_contradictions / self_report)
 *       เพราะผลจริงในแล็บ (C:\tmp\research-agent-lab\out*\result.json) เป็นรูปนั้น — กันเอเจนต์ตอบรูปเก่าแล้วงานล้มทั้งใบ
 *   (ข) "ระเบียนเต็ม" ที่ worker ส่ง POST /api/research/report แล้วเก็บใน store 'research-cards' → buildCardRecord()/validateCardRecord()
 * กติกา: ข้อความทุกช่องถูกตัดความยาว + ลบอักขระควบคุม + ปิดค่าที่หน้าตาเหมือนคีย์ (redactSecrets) ก่อนออกจากเครื่อง
 * ไม่อ้างตำแหน่งไฟล์ตัวเอง · ไม่อ่าน env — ฟังก์ชันล้วน (เทสกลายพันธุ์โหลดสำเนา patch ได้)
 * ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.3 · เลน W2): ฟิลด์ใหม่ optional 2 ช่อง — ผลเก่าที่ไม่มีผ่านเหมือนเดิมทุกไบต์
 *   (ก) ระดับบน suggested_dimensions: string[] ≤3 ข้อ ≤120 ตัวอักษร/ข้อ · ไม่มี = [] (normalizeDimensions)
 *   (ข) ในการ์ด quote?: {text ≤300, speaker ≤80, speaker_confidence 0–1} · ไม่มี = ไม่ใส่คีย์ (normalizeQuote)
 *       speaker_confidence เก็บตามที่เอเจนต์ให้ (ไม่บีบ/ไม่แปลงสเกล) — ด่าน (gate.mjs gateQuote) ลบ quote ที่นอกช่วงทิ้งโดยไม่ลบการ์ด
 *   ระเบียน: OPTIONAL_RECORD_KEYS / OPTIONAL_CARD_KEYS (RECORD_KEYS/CARD_KEYS เดิมไม่เปลี่ยน) · ตัวอย่างผลโหมด write = AGENT_RESULT_WRITE_TEMPLATE
 *   (ท้ายใบงานเฉพาะงานโหมด write — AGENT_RESULT_TEMPLATE ที่อยู่ใน prefix แคชเดิมทุกไบต์)
 * ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 10 · W4): + ธงระบบ ENCODING_BROKEN (ไฟล์ผลเข้ารหัสผิดทั้งรอบ — worker ตั้ง)
 *   ตัวตรวจอยู่ที่ encodingCheck.mjs · ระดับการ์ด = gate_reason ENCODING_BROKEN (gate.mjs) · สัญญาผล/ช่องอื่นไม่เปลี่ยน
 */

export const VALUE_TYPES = Object.freeze(['ความคืบหน้า', 'ต้นทาง', 'ตัวตน', 'ตัวเลข-บริบท', 'อธิบาย', 'อื่นๆ']);
export const CARD_GATES = Object.freeze(['pass', 'staff_only', 'dropped']);
export const IDENTITIES = Object.freeze(['verified', 'generic']);
export const RECORD_STATUSES = Object.freeze(['done', 'failed', 'skipped']);
export const MODES = Object.freeze(['shadow', 'assist', 'write']);
export const BRAIN_KINDS = Object.freeze(['codex', 'api']);
export const EFFORTS = Object.freeze(['low', 'medium']);
/** ธงที่เอเจนต์ตั้งเองได้ — ธงอื่นจากเอเจนต์ถูกทิ้ง (กันเอเจนต์ปลอมธงของ worker เช่น QUOTA_LOW) */
export const AGENT_FLAGS = Object.freeze(['ORIGIN_NOT_FOUND', 'STALE_NEWS', 'RAW_CONTRADICTION', 'BROWSER_WRONG_ACCOUNT']);
/** ธงที่ด่าน/worker ตั้ง */
export const SYSTEM_FLAGS = Object.freeze([
  'QUOTA_LOW', 'TOOL_BUDGET_MONTH', 'OVER_BUDGET', 'AGENT_TIMEOUT', 'API_FALLBACK', 'OWN_PAGE_ORIGIN',
  'DEADLINE_PASSED', 'EMPTY_RAW', 'BRAIN_UNAVAILABLE', 'AGENT_FAILED',
  // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 10 · W4): ไฟล์ผลเอเจนต์เข้ารหัสผิดทั้งรอบ (ไทยกลายเป็น ?)
  //   worker ตั้งพร้อม status 'failed' + การ์ดทุกใบ dropped · เอเจนต์ตั้งเองไม่ได้ (ไม่อยู่ใน AGENT_FLAGS) · ค่าเดียวกับ encodingCheck.ENCODING_FLAG
  'ENCODING_BROKEN',
]);
// ★ 1 ต.ค. 69 (Research Agent v2 · ออดิตก่อน push · W5): ธงเหตุผลที่ worker ตั้งเมื่อ Codex ใช้ไม่ได้และไม่เรียกทางสำรอง API
//   (CODEX_AUTH = บัญชี Codex หลุดล็อกอิน · คู่กับ BRAIN_UNAVAILABLE) — แยกบรรทัดจาก SYSTEM_FLAGS ให้รวมกับเลนอื่นได้ไม่ชน · เอเจนต์ตั้งเองไม่ได้
export const WORKER_REASON_FLAGS = Object.freeze(['CODEX_AUTH']);
// ของเดิม: export const KNOWN_FLAGS = Object.freeze([...AGENT_FLAGS, ...SYSTEM_FLAGS]);
export const KNOWN_FLAGS = Object.freeze([...AGENT_FLAGS, ...SYSTEM_FLAGS, ...WORKER_REASON_FLAGS]);
export const MAX_CARDS = 8;
/** คีย์ที่ผลของเอเจนต์ต้องมี (หลังแปลงชื่อพ้อง) — ขาด/ผิดชนิด = งาน failed (ด่าน 1) */
export const REQUIRED_AGENT_KEYS = Object.freeze(['plan', 'origin_post', 'cards', 'tool_log']);

export const LIMITS = Object.freeze({
  text: 300, claim: 500, evidence: 600, why: 400, name: 200, url: 1000, date: 120,
  planItems: 12, cardsIn: 30, corrections: 10, skipped: 20, toolLog: 80, warning: 500,
  // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.3): มุมเสนอ ≤3 ข้อ ข้อละ ≤120 ตัวอักษร · quote ≤300 · ผู้พูด ≤80
  dimensions: 3, dimension: 120, quoteText: 300, speaker: 80,
});

const VALUE_TYPE_ALIASES = Object.freeze({
  progress: 'ความคืบหน้า', update: 'ความคืบหน้า', origin: 'ต้นทาง', source: 'ต้นทาง',
  identity: 'ตัวตน', number: 'ตัวเลข-บริบท', numbers: 'ตัวเลข-บริบท', context: 'ตัวเลข-บริบท',
  explain: 'อธิบาย', explanation: 'อธิบาย', other: 'อื่นๆ',
});

// ── ความปลอดภัยของข้อความ ──────────────────────────────────────────────
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}/g, // OpenAI-style
  /\bAIza[0-9A-Za-z_-]{20,}/g, // Google API key
  /\bapify_api_[A-Za-z0-9]{10,}/g, // Apify token
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub token
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, // JWT
  /(\bBearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi,
  /((?:api[_-]?key|apikey|access[_-]?token|token|secret|password|passwd)\s*["']?\s*[=:]\s*["']?)[^\s&"',;]{8,}/gi,
];

/**
 * ปิดค่าที่หน้าตาเหมือนคีย์/โทเคน + ค่าจริงของความลับที่ผู้เรียกส่งมา (ห้ามพิมพ์คีย์ออกจากเครื่อง)
 * @param {string} text
 * @param {string[]} [secretValues] ค่าจริงของ env ความลับ (worker ส่งมา) — ยาว ≥ 8 ตัวเท่านั้นถึงจะถูกแทน
 */
export function redactSecrets(text, secretValues = []) {
  let s = String(text == null ? '' : text);
  if (!s) return s;
  for (const v of Array.isArray(secretValues) ? secretValues : []) {
    const val = String(v == null ? '' : v);
    if (val.length >= 8 && s.includes(val)) s = s.split(val).join('[REDACTED]');
  }
  for (const re of SECRET_PATTERNS) {
    s = s.replace(re, (m, lead) => (typeof lead === 'string' && m.startsWith(lead) ? `${lead}[REDACTED]` : '[REDACTED]'));
  }
  return s;
}

// ตั้งใจลบอักขระควบคุม (ยกเว้น \n \t)
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** ข้อความสะอาด: สตริง · ลบอักขระควบคุม · ตัดหัวท้าย · จำกัดความยาว (นับ code point) · ปิดคีย์ */
export function cleanText(value, max = LIMITS.text, secretValues = []) {
  if (value == null) return '';
  let s = '';
  if (typeof value === 'string') s = value;
  else if (typeof value === 'number' || typeof value === 'boolean') s = String(value);
  s = redactSecrets(s.replace(CONTROL_RE, '').replace(/\r\n?/g, '\n').trim(), secretValues);
  const cps = [...s];
  return cps.length > max ? `${cps.slice(0, Math.max(0, max - 1)).join('')}…` : s;
}

/** จำนวนตัวอักษร (code point) หลังยุบช่องว่าง — ใช้วัด "evidence_quote ≥ 20 ตัวอักษร" */
export function charCount(text) {
  return [...String(text == null ? '' : text).replace(/\s+/g, ' ').trim()].length;
}

/** URL http(s) ที่ parse ได้และมีโฮสต์ */
export function isHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const u = new URL(value.trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}

/** ความมั่นใจ 0–1 (รับ 0–100 ได้ · อ่านไม่ได้ = 0) ปัด 2 ตำแหน่ง */
export function normalizeConfidence(value) {
  let n = typeof value === 'string' ? parseFloat(value) : Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n > 1 && n <= 100) n /= 100;
  n = Math.min(1, Math.max(0, n));
  return Math.round(n * 100) / 100;
}

function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string') return /^(true|yes|1|ใช่|ขัด)$/i.test(v.trim());
  return false;
}

function normalizeValueType(v) {
  const s = cleanText(v, 40);
  if (VALUE_TYPES.includes(s)) return s;
  const alias = VALUE_TYPE_ALIASES[s.toLowerCase()];
  return alias || 'อื่นๆ';
}

function normalizeDecided(v) {
  const s = cleanText(v, 20).toLowerCase();
  if (!s) return 'ค้น';
  if (s.includes('ไม่') || /^(no|skip|false|don't|dont)/.test(s)) return 'ไม่ค้น';
  return 'ค้น';
}

/** ความยากที่เอเจนต์ประเมิน → 'low' | 'normal' | 'high' | null (ใช้ตัดสินยก medium) */
export function normalizeComplexity(v) {
  const s = cleanText(v, 20).toLowerCase();
  if (!s || s.includes('|')) return null; // ค่าตัวอย่างจากโครง ("ต่ำ|กลาง|สูง") ไม่ใช่คำตอบ
  if (/สูง|ยาก|high|hard/.test(s)) return 'high';
  if (/ต่ำ|ง่าย|low|easy/.test(s)) return 'low';
  if (/กลาง|ปกติ|medium|normal/.test(s)) return 'normal';
  return null;
}

function nullishText(v, secretValues) {
  const s = cleanText(v, LIMITS.warning, secretValues);
  if (!s || /^(null|none|n\/a|-|ไม่มี|ไม่ใช่|ไม่พบ)$/i.test(s)) return null;
  return s;
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function pickField(raw, keys) {
  for (const k of keys) if (has(raw, k)) return { key: k, value: raw[k] };
  return { key: null, value: undefined };
}

function normalizePlan(list, secrets) {
  return list.slice(0, LIMITS.planItems).map((p) => {
    if (typeof p === 'string') return { question: cleanText(p, LIMITS.text, secrets), why_valuable: '', decided: 'ค้น', reason: '' };
    if (!isObj(p)) return null;
    return {
      question: cleanText(p.question ?? p.q, LIMITS.text, secrets),
      why_valuable: cleanText(p.why_valuable ?? p.why, LIMITS.text, secrets),
      decided: normalizeDecided(p.decided ?? p.decision),
      reason: cleanText(p.reason, LIMITS.text, secrets),
    };
  }).filter((p) => p && p.question);
}

// ── ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.3): ฟิลด์ใหม่ suggested_dimensions + quote (optional ทั้งคู่) ──
/** ค่าตัวอย่างในโครงผลโหมด write (AGENT_RESULT_WRITE_TEMPLATE) — เอเจนต์คัดลอกมาทั้งดุ้น = ไม่ใช่คำตอบ (แบบเดียวกับ "ต่ำ|กลาง|สูง") */
export const WRITE_TEMPLATE_PLACEHOLDERS = Object.freeze({
  dimension: 'มุมเล่าที่ข้อมูลของคุณเปิดให้',
  quoteText: 'คำพูดตรงตามคลิป/ถอดเสียง',
});

/**
 * มุมเล่าที่เอเจนต์เสนอ → string[] ไม่เกิน 3 ข้อ ข้อละไม่เกิน 120 ตัวอักษร (บรรทัดเดียว) · ไม่มี/ผิดชนิด = []
 * รับสตริงเดี่ยวเป็น 1 ข้อ (เอเจนต์บางรอบไม่ตอบเป็น array) · ตัดข้อว่าง/ซ้ำ/ค่าตัวอย่างจากโครง · ทำซ้ำได้ (ผลเดิม → ผลเดิม)
 * @param {unknown} value
 * @param {string[]} [secretValues]
 * @returns {string[]}
 */
export function normalizeDimensions(value, secretValues = []) {
  const list = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
  const out = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const s = cleanText(item.replace(/\s+/g, ' '), LIMITS.dimension, secretValues);
    if (!s || /^[\s.…\-–—]*$/.test(s) || s.includes(WRITE_TEMPLATE_PLACEHOLDERS.dimension)) continue;
    if (!out.includes(s)) out.push(s);
    if (out.length >= LIMITS.dimensions) break;
  }
  return out;
}

/** speaker_confidence ตามที่เอเจนต์ให้ (ไม่บีบช่วง · ไม่แปลงสเกล 0–100 · ไม่ปัด) — อ่านเป็นตัวเลขไม่ได้ = null · ด่านเป็นคนตัดสิน */
function quoteScore(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * คำพูดตรงในการ์ด → {text ≤300, speaker ≤80, speaker_confidence} · ไม่ใช่ object / ไม่มีข้อความ / ค่าตัวอย่างจากโครง = null (ไม่ใส่คีย์)
 * speaker_confidence เก็บตามที่ให้ (นอกช่วง 0–1 ก็เก็บ) เพื่อให้ด่าน (gate.mjs gateQuote) ลบ quote ทิ้งโดยไม่ลบการ์ด
 * @param {unknown} value
 * @param {string[]} [secretValues]
 * @returns {{text:string, speaker:string, speaker_confidence:number|null}|null}
 */
export function normalizeQuote(value, secretValues = []) {
  if (!isObj(value)) return null;
  const text = cleanText(value.text, LIMITS.quoteText, secretValues);
  if (!text || text.includes(WRITE_TEMPLATE_PLACEHOLDERS.quoteText)) return null;
  return {
    text,
    speaker: cleanText(value.speaker, LIMITS.speaker, secretValues).replace(/\s+/g, ' '),
    speaker_confidence: quoteScore(value.speaker_confidence),
  };
}

function normalizeCard(c, secrets) {
  if (!isObj(c)) return null;
  // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.3): เก็บการ์ดใส่ตัวแปรก่อนเพื่อเติม quote
  //   ไม่มี quote = ไม่ใส่คีย์ → การ์ดของผลเก่าเดิมทุกไบต์ · ของเดิม: return { …ช่องเดียวกันทุกช่อง… };
  const card = {
    claim: cleanText(c.claim, LIMITS.claim, secrets),
    value_type: normalizeValueType(c.value_type),
    why_it_adds_value: cleanText(c.why_it_adds_value ?? c.why, LIMITS.why, secrets),
    evidence_quote: cleanText(c.evidence_quote ?? c.evidence, LIMITS.evidence, secrets),
    source_url: cleanText(c.source_url ?? c.url, LIMITS.url, secrets),
    source_name: cleanText(c.source_name, LIMITS.name, secrets),
    source_date: cleanText(c.source_date, LIMITS.date, secrets),
    confidence: normalizeConfidence(c.confidence),
    contradicts_raw: toBool(c.contradicts_raw),
    identity: cleanText(c.identity, 20) === 'verified' ? 'verified' : 'generic',
  };
  const quote = normalizeQuote(c.quote, secrets);
  if (quote) card.quote = quote;
  return card;
}

function normalizeCorrection(r, secrets) {
  if (!isObj(r)) return null;
  return {
    field: cleanText(r.field, LIMITS.name, secrets),
    raw_value: cleanText(r.raw_value, LIMITS.text, secrets),
    source_value: cleanText(r.source_value, LIMITS.text, secrets),
    source_url: cleanText(r.source_url, LIMITS.url, secrets),
    confidence: normalizeConfidence(r.confidence),
  };
}

function normalizeToolEntry(t, secrets) {
  if (typeof t === 'string') return { tool: cleanText(t, 80, secrets) || 'unknown', args: '', ok: true, note: '', ms: null };
  if (!isObj(t)) return null;
  const ms = Number(t.ms);
  const argsText = typeof t.args === 'object' && t.args !== null ? JSON.stringify(t.args) : t.args;
  return {
    tool: cleanText(t.tool, 80, secrets) || 'unknown',
    args: cleanText(argsText, LIMITS.text, secrets),
    ok: t.ok === undefined ? true : toBool(t.ok),
    note: cleanText(t.note, LIMITS.text, secrets),
    ms: t.ms !== null && t.ms !== undefined && t.ms !== '' && Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : null,
  };
}

function normalizeAgentFlags(list) {
  const out = [];
  for (const f of Array.isArray(list) ? list : []) {
    const s = cleanText(f, 40).toUpperCase();
    if (AGENT_FLAGS.includes(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

const textOf = (s) => (typeof s === 'string' ? s : JSON.stringify(s));

/**
 * แปลงผลของเอเจนต์ (ส่วนที่เอเจนต์กรอก) ให้อยู่ในรูปสัญญาเดียว + ตรวจคีย์บังคับ (ด่าน 1)
 * @param {unknown} raw  JSON ที่อ่านจาก out/result.json หรือคำตอบโหมด API
 * @param {{secretValues?: string[]}} [opts]
 * @returns {{ok:boolean, errors:string[], aliases:string[], result:object|null}}
 */
export function normalizeAgentResult(raw, { secretValues = [] } = {}) {
  const errors = [];
  const aliases = [];
  if (!isObj(raw)) return { ok: false, errors: ['ผลไม่ใช่ JSON object'], aliases, result: null };
  const plan = pickField(raw, ['plan', 'research_plan']);
  const cards = pickField(raw, ['cards', 'fact_cards']);
  const tlog = pickField(raw, ['tool_log', 'tools_log']);
  for (const [p, canonical] of [[plan, 'plan'], [cards, 'cards'], [tlog, 'tool_log']]) {
    if (p.key && p.key !== canonical) aliases.push(p.key);
  }

  if (!Array.isArray(plan.value)) errors.push('ขาด plan (array)');
  if (!Array.isArray(cards.value)) errors.push('ขาด cards (array)');
  if (!Array.isArray(tlog.value)) errors.push('ขาด tool_log (array)');
  if (!isObj(raw.origin_post)) errors.push('ขาด origin_post (object)');
  if (errors.length) return { ok: false, errors, aliases, result: null };

  const secrets = secretValues;
  const op = raw.origin_post;
  const opUrl = cleanText(op.url, LIMITS.url, secrets);
  const originUrl = isHttpUrl(opUrl) ? opUrl : null;

  const skipped = (Array.isArray(raw.skipped) ? raw.skipped : [])
    .map((s) => cleanText(textOf(s), LIMITS.text, secrets)).filter(Boolean);
  // ชื่อแบบแล็บเก่า: raw_contradictions เป็นข้อความอิสระ (ไม่มี field/source_url) → แสดงพนักงานผ่าน skipped ไม่ใช่ raw_corrections
  if (Array.isArray(raw.raw_contradictions)) {
    aliases.push('raw_contradictions');
    for (const s of raw.raw_contradictions) {
      const t = cleanText(textOf(s), LIMITS.text, secrets);
      if (t) skipped.push(`ขัดข่าวดิบ (ไม่มีโครงสร้างยืนยัน): ${t}`);
    }
  }

  const selfReport = isObj(raw.self_report) ? raw.self_report : {};
  const num = (v) => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  const result = {
    complexity: normalizeComplexity(raw.complexity ?? selfReport.complexity),
    plan: normalizePlan(plan.value, secrets),
    origin_post: {
      url: originUrl,
      source_name: cleanText(op.source_name, LIMITS.name, secrets),
      date: cleanText(op.date, LIMITS.date, secrets),
      confidence: originUrl ? normalizeConfidence(op.confidence) : 0,
    },
    story_date_estimate: cleanText(raw.story_date_estimate, 40, secrets) || 'ไม่ทราบ',
    stale_news_warning: nullishText(raw.stale_news_warning, secrets),
    cards: cards.value.slice(0, LIMITS.cardsIn).map((c) => normalizeCard(c, secrets)).filter(Boolean),
    raw_corrections: (Array.isArray(raw.raw_corrections) ? raw.raw_corrections : [])
      .slice(0, LIMITS.corrections).map((r) => normalizeCorrection(r, secrets)).filter(Boolean),
    flags: normalizeAgentFlags(raw.flags),
    skipped: skipped.slice(0, LIMITS.skipped),
    tool_log: tlog.value.slice(0, LIMITS.toolLog).map((t) => normalizeToolEntry(t, secrets)).filter(Boolean),
    browser_available: cleanText(raw.browser_available, LIMITS.text, secrets) || null,
    self_report: {
      tool_calls: num(selfReport.tool_calls),
      minutes: num(selfReport.minutes),
      what_would_help_next_time: cleanText(selfReport.what_would_help_next_time, LIMITS.text, secrets),
    },
    // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.3): มุมเล่าที่เอเจนต์เสนอ — optional (ผลเก่าไม่มี = [] · ช่องอื่นเดิมทุกไบต์)
    suggested_dimensions: normalizeDimensions(raw.suggested_dimensions, secrets),
  };
  return { ok: true, errors, aliases, result };
}

/**
 * ประกอบระเบียน research-cards เต็มตามสัญญา 2.2 (ไม่มีฟิลด์นอกสัญญา)
 * ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.3): + suggested_dimensions ระดับบนเสมอ (ไม่มี = []) · การ์ดคง quote ที่ผ่านด่าน
 * @param {object} p
 */
export function buildCardRecord({
  jobId, status, mode = 'shadow', brain, gated = null, flags = [], usage = null,
  toolLog = null, skipped = null, nowIso, createdAt = null,
}) {
  const at = nowIso || new Date().toISOString();
  const g = gated || {};
  const allFlags = [];
  for (const f of [...(g.flags || []), ...flags]) {
    if (typeof f === 'string' && KNOWN_FLAGS.includes(f) && !allFlags.includes(f)) allFlags.push(f);
  }
  const b = brain || {};
  const brainOut = {
    kind: BRAIN_KINDS.includes(b.kind) ? b.kind : 'codex',
    model: cleanText(b.model, 64) || 'gpt-6-astra',
    effort: EFFORTS.includes(b.effort) ? b.effort : 'low',
    account: cleanText(b.account, 40) || 'main',
  };
  const q = b.quotaPctAfter;
  if (q !== null && q !== undefined && q !== '' && Number.isFinite(Number(q))) {
    brainOut.quotaPctAfter = Math.round(Math.min(100, Math.max(0, Number(q))) * 10) / 10;
  }
  const u = usage || g.usage || {};
  const usageOut = {
    tool_calls: Math.max(0, Math.round(Number(u.tool_calls) || 0)),
    minutes: Math.max(0, Math.round((Number(u.minutes) || 0) * 100) / 100),
    costUsd: Math.max(0, Math.round((Number(u.costUsd) || 0) * 10000) / 10000),
  };
  if (Number(u.codexTokens) > 0) usageOut.codexTokens = Math.round(Number(u.codexTokens));
  return {
    id: String(jobId),
    revision: 1,
    status: RECORD_STATUSES.includes(status) ? status : 'failed',
    mode: MODES.includes(mode) ? mode : 'shadow',
    brain: brainOut,
    plan: Array.isArray(g.plan) ? g.plan : [],
    origin_post: isObj(g.origin_post) ? g.origin_post : { url: null, source_name: '', date: '', confidence: 0 },
    story_date_estimate: typeof g.story_date_estimate === 'string' ? g.story_date_estimate : 'ไม่ทราบ',
    stale_news_warning: typeof g.stale_news_warning === 'string' ? g.stale_news_warning : null,
    cards: Array.isArray(g.cards) ? g.cards : [],
    raw_corrections: Array.isArray(g.raw_corrections) ? g.raw_corrections : [],
    // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.3): "ไม่มี = []" — คงคีย์เสมอ (ด่านกรองคำต้องห้ามแล้ว · ทำซ้ำได้ ค่าไม่เปลี่ยน)
    suggested_dimensions: normalizeDimensions(g.suggested_dimensions),
    flags: allFlags,
    skipped: Array.isArray(skipped) ? skipped : (Array.isArray(g.skipped) ? g.skipped : []),
    tool_log: Array.isArray(toolLog) ? toolLog : (Array.isArray(g.tool_log) ? g.tool_log : []),
    usage: usageOut,
    feedback: [],
    createdAt: createdAt || at,
    updatedAt: at,
  };
}

export const RECORD_KEYS = Object.freeze([
  'id', 'revision', 'status', 'mode', 'brain', 'plan', 'origin_post', 'story_date_estimate', 'stale_news_warning',
  'cards', 'raw_corrections', 'flags', 'skipped', 'tool_log', 'usage', 'feedback', 'createdAt', 'updatedAt',
]);
export const CARD_KEYS = Object.freeze([
  'id', 'claim', 'value_type', 'why_it_adds_value', 'evidence_quote', 'source_url', 'source_name', 'source_date',
  'confidence', 'contradicts_raw', 'identity', 'gate',
]);
// ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.3): ช่องที่ "มีได้" (optional) — RECORD_KEYS/CARD_KEYS เดิมไม่เปลี่ยน
//   ระดับบน suggested_dimensions: buildCardRecord ใส่เสมอ (ไม่มี = []) แต่ระเบียนเก่า/ฝั่งเว็บรุ่นก่อนที่ไม่มีช่องนี้ยังผ่าน validateCardRecord
//   การ์ด quote: มีเฉพาะเมื่อเอเจนต์ใส่มาและผ่านด่าน (gate.mjs ลบ quote ที่ speaker_confidence นอกช่วง 0–1)
export const OPTIONAL_RECORD_KEYS = Object.freeze(['suggested_dimensions']);
export const OPTIONAL_CARD_KEYS = Object.freeze(['quote']);

const cpLen = (s) => [...String(s)].length;
/** ปัญหารูป quote ('' = ผ่าน) — สัญญา 8.3: text 1–300 · speaker ≤80 · speaker_confidence ตัวเลข 0–1 */
function quoteProblem(q) {
  if (!isObj(q)) return 'ต้องเป็น object';
  if (typeof q.text !== 'string' || !q.text || cpLen(q.text) > LIMITS.quoteText) return 'text ต้องเป็นข้อความ 1–300 ตัวอักษร';
  if (typeof q.speaker !== 'string' || cpLen(q.speaker) > LIMITS.speaker) return 'speaker ต้องเป็นข้อความไม่เกิน 80 ตัวอักษร';
  if (typeof q.speaker_confidence !== 'number' || !(q.speaker_confidence >= 0 && q.speaker_confidence <= 1)) return 'speaker_confidence ต้องเป็นตัวเลข 0–1';
  return '';
}
/** ปัญหารูป suggested_dimensions ('' = ผ่าน) — สัญญา 8.3: array ไม่เกิน 3 ข้อ · ข้อละข้อความ 1–120 ตัวอักษร */
function dimensionsProblem(list) {
  if (!Array.isArray(list)) return 'ต้องเป็น array';
  if (list.length > LIMITS.dimensions) return `เกิน ${LIMITS.dimensions} ข้อ`;
  if (list.some((d) => typeof d !== 'string' || !d || cpLen(d) > LIMITS.dimension)) return 'ทุกข้อต้องเป็นข้อความ 1–120 ตัวอักษร';
  return '';
}

function validateCards(cards, errs) {
  if (!Array.isArray(cards)) { errs.push('cards ต้องเป็น array'); return; }
  if (cards.length > MAX_CARDS) errs.push(`cards เกิน ${MAX_CARDS}`);
  cards.forEach((c, i) => {
    if (!isObj(c)) { errs.push(`cards[${i}] ไม่ใช่ object`); return; }
    for (const k of CARD_KEYS) if (!(k in c)) errs.push(`cards[${i}] ขาด ${k}`);
    if (!/^R\d+$/.test(String(c.id))) errs.push(`cards[${i}].id ต้องเป็น R#`);
    if (!CARD_GATES.includes(c.gate)) errs.push(`cards[${i}].gate ผิด`);
    if (c.gate === 'pass' && 'gate_reason' in c) errs.push(`cards[${i}] gate=pass ต้องไม่มี gate_reason`);
    if (!IDENTITIES.includes(c.identity)) errs.push(`cards[${i}].identity ผิด`);
    if (!VALUE_TYPES.includes(c.value_type)) errs.push(`cards[${i}].value_type ผิด`);
    if (typeof c.confidence !== 'number' || c.confidence < 0 || c.confidence > 1) errs.push(`cards[${i}].confidence ผิด`);
    if (typeof c.contradicts_raw !== 'boolean') errs.push(`cards[${i}].contradicts_raw ต้องเป็น boolean`);
    if (c.gate !== 'dropped' && !isHttpUrl(c.source_url)) errs.push(`cards[${i}].source_url ต้องเป็น http(s)`);
    // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.3): quote optional — มีแล้วต้องครบรูป (ด่านลบ quote ผิดช่วงก่อนถึงตรงนี้)
    if ('quote' in c) {
      const problem = quoteProblem(c.quote);
      if (problem) errs.push(`cards[${i}].quote ${problem}`);
    }
  });
}

/**
 * ตรวจระเบียนเต็มตามสัญญา 2.2 — คืนรายการปัญหา (ว่าง = ผ่าน) · worker ตรวจก่อนส่งทุกครั้ง
 * @param {object} rec
 * @returns {string[]}
 */
export function validateCardRecord(rec) {
  const errs = [];
  if (!isObj(rec)) return ['ระเบียนไม่ใช่ object'];
  for (const k of RECORD_KEYS) if (!(k in rec)) errs.push(`ขาด ${k}`);
  // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.3): ช่อง optional ไม่นับเป็นฟิลด์นอกสัญญา (มีแล้วต้องถูกรูป)
  // ของเดิม: for (const k of Object.keys(rec)) if (!RECORD_KEYS.includes(k)) errs.push(`ฟิลด์นอกสัญญา ${k}`);
  for (const k of Object.keys(rec)) if (!RECORD_KEYS.includes(k) && !OPTIONAL_RECORD_KEYS.includes(k)) errs.push(`ฟิลด์นอกสัญญา ${k}`);
  if ('suggested_dimensions' in rec) {
    const problem = dimensionsProblem(rec.suggested_dimensions);
    if (problem) errs.push(`suggested_dimensions ${problem}`);
  }
  if (typeof rec.id !== 'string' || !rec.id) errs.push('id ต้องเป็นสตริง');
  if (!Number.isInteger(rec.revision) || rec.revision < 1) errs.push('revision ต้องเป็นจำนวนเต็ม ≥1');
  if (!RECORD_STATUSES.includes(rec.status)) errs.push(`status ผิด: ${rec.status}`);
  if (!MODES.includes(rec.mode)) errs.push(`mode ผิด: ${rec.mode}`);
  const b = rec.brain;
  if (!isObj(b) || !BRAIN_KINDS.includes(b.kind) || !EFFORTS.includes(b.effort) || typeof b.model !== 'string' || typeof b.account !== 'string') {
    errs.push('brain ผิดรูป');
  }
  if (!Array.isArray(rec.plan) || rec.plan.some((p) => !isObj(p) || typeof p.question !== 'string' || !['ค้น', 'ไม่ค้น'].includes(p.decided))) {
    errs.push('plan ผิดรูป');
  }
  const op = rec.origin_post;
  if (!isObj(op) || !(op.url === null || isHttpUrl(op.url)) || typeof op.confidence !== 'number') errs.push('origin_post ผิดรูป');
  if (typeof rec.story_date_estimate !== 'string') errs.push('story_date_estimate ต้องเป็นสตริง');
  if (!(rec.stale_news_warning === null || typeof rec.stale_news_warning === 'string')) errs.push('stale_news_warning ต้องเป็นสตริงหรือ null');
  validateCards(rec.cards, errs);
  if (!Array.isArray(rec.raw_corrections) || rec.raw_corrections.some((r) => !isObj(r) || !isHttpUrl(r.source_url))) {
    errs.push('raw_corrections ผิดรูป (ต้องมี source_url)');
  }
  if (!Array.isArray(rec.flags) || rec.flags.some((f) => !KNOWN_FLAGS.includes(f))) errs.push('flags มีค่าที่ไม่รู้จัก');
  if (!Array.isArray(rec.skipped) || rec.skipped.some((s) => typeof s !== 'string')) errs.push('skipped ต้องเป็น array ของสตริง');
  if (!Array.isArray(rec.tool_log) || rec.tool_log.some((t) => !isObj(t) || typeof t.tool !== 'string' || typeof t.ok !== 'boolean')) {
    errs.push('tool_log ผิดรูป');
  }
  const u = rec.usage;
  if (!isObj(u) || !Number.isFinite(u.tool_calls) || !Number.isFinite(u.minutes) || !Number.isFinite(u.costUsd)) errs.push('usage ผิดรูป');
  if (!Array.isArray(rec.feedback)) errs.push('feedback ต้องเป็น array');
  for (const k of ['createdAt', 'updatedAt']) {
    if (typeof rec[k] !== 'string' || Number.isNaN(Date.parse(rec[k]))) errs.push(`${k} ต้องเป็นเวลา ISO`);
  }
  return errs;
}

/**
 * โครงผลที่เอเจนต์ต้องเขียน (ส่วนที่เอเจนต์กรอกของสัญญา 2.2) — ใช้ประกอบ TASK (taskBuilder) ให้ตรงกับ normalizeAgentResult
 * คงที่ทุกงาน (อยู่ในช่วง prefix ของพรอมต์ → แคชไม่หลุด)
 */
export const AGENT_RESULT_TEMPLATE = `{
  "complexity": "ต่ำ|กลาง|สูง",
  "plan": [{"question": "...", "why_valuable": "...", "decided": "ค้น|ไม่ค้น", "reason": "..."}],
  "origin_post": {"url": "https://... หรือ null", "source_name": "...", "date": "YYYY-MM-DD หรือ ไม่ทราบ", "confidence": 0.0},
  "story_date_estimate": "YYYY-MM-DD หรือ ไม่ทราบ",
  "stale_news_warning": "ข้อความเตือน + วันที่ + แหล่ง หรือ null",
  "cards": [{"claim": "ข้อเท็จจริง 1 ประโยค (ไทย)", "value_type": "ความคืบหน้า|ต้นทาง|ตัวตน|ตัวเลข-บริบท|อธิบาย|อื่นๆ", "why_it_adds_value": "...", "evidence_quote": "ประโยคที่คัดตรงจากหน้าที่ดึงมาได้จริง", "source_url": "https://...", "source_name": "...", "source_date": "...", "confidence": 0.0, "contradicts_raw": false, "identity": "verified|generic"}],
  "raw_corrections": [{"field": "ชื่อ/ตัวเลข/สถานที่/วันที่ที่ข่าวดิบผิด", "raw_value": "ค่าในข่าวดิบ", "source_value": "ค่าตามต้นทาง", "source_url": "https://...", "confidence": 0.0}],
  "flags": ["ORIGIN_NOT_FOUND|STALE_NEWS|RAW_CONTRADICTION|BROWSER_WRONG_ACCOUNT"],
  "skipped": ["สิ่งที่ตั้งใจไม่ค้น + เหตุผล"],
  "tool_log": [{"tool": "serper", "args": "...", "ok": true, "note": "...", "ms": 0}],
  "browser_available": "ใช้เบราว์เซอร์ได้ไหม/ล็อกอินเป็นใคร (ชื่อที่แสดงเท่านั้น)",
  "self_report": {"tool_calls": 0, "minutes": 0, "what_would_help_next_time": "..."}
}`;

/**
 * ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.3): ตัวอย่าง "ช่องที่เพิ่ม" ของผลโหมด write
 *   suggested_dimensions ระดับบน + quote ในการ์ด (การ์ดตัวอย่างแสดงช่องเดิมครบ ให้เห็นว่า quote อยู่ในการ์ดใบเดียวกัน)
 *   ใช้เฉพาะท้ายใบงานของงานโหมด write (taskBuilder) — ไม่แตะ AGENT_RESULT_TEMPLATE ที่อยู่ใน prefix แคช
 *   ค่าตัวอย่างที่ถูกคัดลอกมาทั้งดุ้นถูกตัดทิ้ง (WRITE_TEMPLATE_PLACEHOLDERS) · เป็น JSON ที่ parse ได้ (เทสรวมกับ AGENT_RESULT_TEMPLATE แล้วผ่านตัวแปลงจริง)
 */
export const AGENT_RESULT_WRITE_TEMPLATE = `{
  "suggested_dimensions": ["มุมเล่าที่ข้อมูลของคุณเปิดให้ 1 บรรทัด (ไม่เกิน 120 ตัวอักษร · ไม่เกิน 3 ข้อ · ไม่มีให้ใส่ [])"],
  "cards": [{"claim": "...", "value_type": "...", "why_it_adds_value": "...", "evidence_quote": "...", "source_url": "https://...", "source_name": "...", "source_date": "...", "confidence": 0.0, "contradicts_raw": false, "identity": "verified|generic",
    "quote": {"text": "คำพูดตรงตามคลิป/ถอดเสียง (ไม่เกิน 300 ตัวอักษร)", "speaker": "ชื่อหรือบทบาทผู้พูด (ไม่เกิน 80 ตัวอักษร)", "speaker_confidence": 0.0}}]
}`;
