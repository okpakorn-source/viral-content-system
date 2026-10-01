/**
 * 🚧 scripts/research-agent/gate.mjs — ด่านเชิงกลของผลเอเจนต์รีเสิร์ช (SPEC-v2 ส่วน 6 · ข้อ 13/14/15 ของเจ้าของ)
 * ─────────────────────────────────────────────────────────────────────────────
 * รันฝั่ง worker ก่อนรายงาน (และ /api/research/report รันซ้ำได้ด้วยกติกาเดียวกัน)
 *   1) schema ตรง 2.2 — ขาดคีย์บังคับ = failed (normalizeAgentResult)
 *   2) ทุกการ์ด: evidence_quote ≥ 20 ตัวอักษร และมีตัวเลข/ชื่อเฉพาะของ claim ≥ 1 token → ไม่ผ่าน = staff_only
 *   3) คำต้องห้าม (blacklist.mjs) ใน claim → dropped · อยู่แค่ในหลักฐาน → staff_only
 *   4) source_url ต้องเป็น http(s) (ไม่ใช่ = dropped) · ต้นทาง (origin_post) ห้ามเป็นเพจเราเอง (IG.dara/รวมไอจีดารา)
 *      — การ์ดที่อ้างเพจเราเอง = staff_only (โพสต์ของเราเองไม่ใช่หลักฐานอิสระ)
 *   5) contradicts_raw=true → ธง RAW_CONTRADICTION · raw_corrections ต้องมี source_url (ไม่มี = ตัดทิ้ง)
 *   6) confidence < 0.6 → staff_only
 *   7) นับ usage/cost จาก tool_log (pricing.mjs)
 *   8) การ์ด > 8 ใบ → เรียง confidence แล้วตัดเหลือ 8
 * เพิ่มเติม (สายกลาง ไม่ขัดสเปก): identity='verified' ต้อง gate=pass และ confidence ≥ 0.8 (แนวเดียวกับ
 *   identityConfidence ≥ 8 ของ smartResearch เดิม) · ข่าวเก่า: วันที่เรื่องเก่ากว่าวันส่ง > ctx.staleDays วัน = ธง STALE_NEWS
 *   (ข้อ 14: ธงอย่างเดียวทุกอายุ ไม่หยุดงาน · เกณฑ์ = env RESEARCH_AGENT_STALE_DAYS ที่ worker อ่านแล้วส่งมา · ไม่ส่ง = 7 วัน)
 * ไม่อ้างตำแหน่งไฟล์ตัวเอง · ไม่อ่าน env — ฟังก์ชันล้วน
 */
import { findBlacklist } from './blacklist.mjs';
import { costFromToolLog } from './pricing.mjs';
import { normalizeAgentResult, isHttpUrl, charCount, MAX_CARDS } from './schema.mjs';

export const GATE_RULES = Object.freeze({
  MIN_EVIDENCE_CHARS: 20,
  MIN_CONFIDENCE: 0.6,
  MAX_CARDS,
  VERIFIED_MIN_CONFIDENCE: 0.8,
  ORIGIN_MIN_CONFIDENCE: 0.5,
  STALE_DAYS: 7, // ค่าเริ่มต้นของ RESEARCH_AGENT_STALE_DAYS (ข้อตัดสินผู้คุมงาน 1 ต.ค. 69)
});

/** เกณฑ์ข่าวเก่า (วัน) ที่ใช้จริง: ค่าที่ worker ส่งมา (> 0) ไม่งั้นค่าเริ่มต้น */
export function staleDaysOf(v) {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) && n > 0 ? n : GATE_RULES.STALE_DAYS;
}

/** เพจของเราเอง — ห้ามเป็นต้นทาง (สเปกส่วน 4 + ด่าน 4) */
export const OWN_PAGE = Object.freeze({
  slugs: Object.freeze(['ig.dara']),
  names: Object.freeze(['รวมไอจีดารา', 'เล่าเรื่อง ดารา', 'เล่าเรื่องดารา']),
});

const FB_HOST_RE = /(^|\.)(facebook\.com|fb\.com|fb\.watch|messenger\.com)$/i;

/** true เมื่อ url/ชื่อแหล่งชี้เพจของเราเอง */
export function isOwnPage(url, sourceName = '', own = OWN_PAGE) {
  const slugs = (own.slugs || []).map((s) => String(s).toLowerCase());
  const names = (own.names || []).map((s) => String(s).toLowerCase());
  const nm = String(sourceName || '').toLowerCase();
  if (nm && names.some((n) => n && nm.includes(n))) return true;
  if (typeof url !== 'string' || !url) return false;
  try {
    const u = new URL(url.trim());
    if (!FB_HOST_RE.test(u.hostname)) return false;
    const first = decodeURIComponent(u.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
    if (slugs.includes(first)) return true;
    const id = (u.searchParams.get('id') || '').toLowerCase();
    return !!id && slugs.includes(id);
  } catch {
    return false;
  }
}

// ── ด่าน 2: token เฉพาะของ claim ต้องโผล่ในหลักฐาน ─────────────────────────
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
const toArabic = (s) => String(s).replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
/** ตัดจุลภาคหลักพัน: 1,200,000 → 1200000 (ทุกกลุ่ม ไม่ใช่แค่กลุ่มแรก) */
const stripThousands = (s) => String(s).replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
const SEGMENTER = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
/** คำไทยกว้างๆ ที่ยาวพอผ่านเกณฑ์แต่ไม่ใช่ "ชื่อเฉพาะ" (กันหลักฐานที่แค่บังเอิญมีคำสามัญร่วม) */
const THAI_STOP = new Set([
  'เรื่อง', 'โพสต์', 'ข้อมูล', 'เผยแพร่', 'ต้นทาง', 'แหล่ง', 'ยืนยัน', 'เกี่ยวกับ', 'เพื่อ', 'เมื่อ', 'ความคิดเห็น',
  'ชาวบ้าน', 'สังคม', 'ออนไลน์', 'เฟซบุ๊ก', 'ข่าวดิบ', 'ประชาชน', 'คนอื่น', 'ทั้งหมด', 'เหตุการณ์', 'ที่เกิด',
  'อย่างไร', 'เพราะ', 'สำหรับ', 'ระหว่าง', 'หลังจาก', 'ก่อนหน้า', 'ปัจจุบัน', 'ครั้งนี้', 'ตอนนี้', 'แต่ละ',
  'เนื้อหา', 'ผู้ใช้', 'ภายหลัง', 'แสดงว่า', 'สามารถ', 'เท่านั้น', 'ทุกคน', 'บางอย่าง', 'อย่างยิ่ง',
  'เมือง', 'จังหวัด', 'อำเภอ', 'ตำบล', 'หมู่บ้าน', 'ประเทศ', 'ครั้ง', 'เดียวกัน', 'ทำงาน', 'ช่วยเหลือ',
  'เกิดขึ้น', 'ได้รับ', 'ทำให้', 'กล่าวว่า', 'บอกว่า', 'ระบุว่า', 'เปิดเผย', 'ล่าสุด', 'ขณะนี้', 'ทั้งนี้', 'ต่อมา',
  'จากนั้น', 'พบว่า', 'รายหนึ่ง', 'คนหนึ่ง', 'เมื่อวาน', 'วันนี้', 'ตั้งแต่', 'ประมาณ', 'จำนวน', 'อย่างน้อย', 'มากกว่า',
]);
/** คำเชื่อม/คำสามัญสั้นๆ — คู่คำที่มีคำพวกนี้ไม่นับเป็นชื่อเฉพาะ (เช่น "น้ำที่" "มีโพสต์") */
const THAI_FUNCTION = new Set([
  'ที่', 'มี', 'และ', 'ใน', 'ของ', 'ได้', 'ให้', 'จะ', 'ว่า', 'เป็น', 'ไป', 'มา', 'กับ', 'แต่', 'หรือ', 'จาก', 'ก็',
  'ยัง', 'แล้ว', 'นี้', 'นั้น', 'คน', 'ไม่', 'การ', 'ความ', 'โดย', 'เพื่อ', 'เมื่อ', 'ซึ่ง', 'อยู่', 'ถึง', 'ต่อ', 'แค่',
  'อีก', 'ทั้ง', 'เขา', 'เธอ', 'เรา', 'ตาม', 'ช่วย', 'เพจ', 'โพสต์', 'ข่าว', 'เรื่อง', 'เล่า',
]);
const LATIN_STOP = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'facebook', 'post', 'posts', 'page', 'http', 'https', 'www', 'com']);

const cps = (s) => [...s].length;

/** token เฉพาะของข้อความ: ตัวเลข · คำละติน ≥ 3 · คำไทย ≥ 5 code point · คำไทยติดกัน 2 คำรวม ≥ 5 (ชื่อที่ตัวตัดคำแยก) */
export function specificTokens(text) {
  const s = toArabic(String(text == null ? '' : text));
  const tokens = new Set();
  for (const m of stripThousands(s).matchAll(/\d+(?:\.\d+)?/g)) tokens.add(m[0]);
  for (const m of s.matchAll(/[A-Za-z][A-Za-z'.-]{2,}/g)) {
    const w = m[0].toLowerCase().replace(/[.'-]+$/, '');
    if (w.length >= 3 && !LATIN_STOP.has(w)) tokens.add(w);
  }
  if (SEGMENTER) {
    const words = [];
    for (const seg of SEGMENTER.segment(s)) {
      if (seg.isWordLike && /[\u0E00-\u0E7F]/.test(seg.segment)) words.push(seg.segment);
      else words.push(null); // ช่องว่าง/เครื่องหมาย ตัดลำดับคำติดกัน
    }
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (!w) continue;
      if (cps(w) >= 5 && !THAI_STOP.has(w)) tokens.add(w);
      const next = words[i + 1];
      if (next && !THAI_FUNCTION.has(w) && !THAI_FUNCTION.has(next)) {
        const bi = w + next;
        if (cps(bi) >= 5 && !THAI_STOP.has(bi)) tokens.add(bi);
      }
    }
  }
  return [...tokens];
}

/** หลักฐานมี token เฉพาะของ claim อย่างน้อย 1 ตัวไหม (เทียบแบบไม่สนตัวพิมพ์ · ตัวเลขต้องตรงทั้งก้อน) */
export function evidenceSharesToken(claim, evidence) {
  const ev = stripThousands(toArabic(String(evidence == null ? '' : evidence)));
  const evLower = ev.toLowerCase();
  const evNumbers = new Set([...ev.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]));
  const shared = [];
  for (const t of specificTokens(claim)) {
    if (/^\d/.test(t)) { if (evNumbers.has(t)) shared.push(t); continue; }
    if (evLower.includes(t.toLowerCase())) shared.push(t);
  }
  return { ok: shared.length > 0, shared };
}

function parseStoryDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '').trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? t : null;
}

const GATE_RANK = { pass: 0, staff_only: 1, dropped: 2 };

/**
 * ตรวจการ์ดใบเดียว → คืนการ์ดพร้อม gate/gate_reason (ยังไม่มี id)
 * @param {object} card  การ์ดที่ normalize แล้ว
 * @param {object} [own]
 */
export function gateCard(card, own = OWN_PAGE) {
  const reasons = [];
  let gate = 'pass';
  const lower = (g) => { if (GATE_RANK[g] > GATE_RANK[gate]) gate = g; };
  if (!card.claim) { lower('dropped'); reasons.push('SCHEMA_CARD'); }
  if (!isHttpUrl(card.source_url)) { lower('dropped'); reasons.push('BAD_SOURCE_URL'); }
  if (findBlacklist(card.claim).length) { lower('dropped'); reasons.push('BLACKLIST_CLAIM'); }
  if (charCount(card.evidence_quote) < GATE_RULES.MIN_EVIDENCE_CHARS) { lower('staff_only'); reasons.push('EVIDENCE_SHORT'); }
  else if (!evidenceSharesToken(card.claim, card.evidence_quote).ok) { lower('staff_only'); reasons.push('EVIDENCE_NO_TOKEN'); }
  if (findBlacklist(card.evidence_quote).length && !reasons.includes('BLACKLIST_CLAIM')) { lower('staff_only'); reasons.push('BLACKLIST_EVIDENCE'); }
  if (card.confidence < GATE_RULES.MIN_CONFIDENCE) { lower('staff_only'); reasons.push('LOW_CONFIDENCE'); }
  if (isHttpUrl(card.source_url) && isOwnPage(card.source_url, card.source_name, own)) { lower('staff_only'); reasons.push('OWN_PAGE_SOURCE'); }
  const identity = card.identity === 'verified' && gate === 'pass' && card.confidence >= GATE_RULES.VERIFIED_MIN_CONFIDENCE
    ? 'verified' : 'generic';
  const out = { ...card, identity, gate };
  if (gate !== 'pass') out.gate_reason = reasons.join(',');
  return out;
}

/**
 * รันด่านทั้งหมดบนผลของเอเจนต์
 * @param {unknown} rawResult  JSON ของเอเจนต์ (ยังไม่ normalize ก็ได้)
 * @param {object} ctx
 * @param {string} [ctx.jobCreatedAt]  เวลาที่พนักงานส่งข่าว (ISO) ใช้ตัดสินข่าวเก่า
 * @param {number} [ctx.minutes]       เวลาที่ worker วัดจริง (นาที)
 * @param {number} [ctx.maxCalls]      งบครั้งเรียกเครื่องมือ
 * @param {number} [ctx.maxMinutes]    งบเวลา (นาที)
 * @param {number} [ctx.staleDays]     เกณฑ์ข่าวเก่า (วัน · env RESEARCH_AGENT_STALE_DAYS ผ่าน worker · ไม่ส่ง = 7)
 * @param {string[]} [ctx.secretValues] ค่าความลับที่ต้องปิด
 * @param {object} [ctx.ownPage]
 * @returns {{ok:boolean, status:'done'|'failed', errors:string[], complexity:string|null, plan:Array, origin_post:object,
 *   story_date_estimate:string, stale_news_warning:string|null, cards:Array, raw_corrections:Array, flags:string[],
 *   skipped:string[], tool_log:Array, usage:object, stats:object}}
 */
export function runGate(rawResult, ctx = {}) {
  const norm = normalizeAgentResult(rawResult, { secretValues: ctx.secretValues || [] });
  if (!norm.ok) {
    return {
      ok: false, status: 'failed', errors: norm.errors, complexity: null, plan: [],
      origin_post: { url: null, source_name: '', date: '', confidence: 0 },
      story_date_estimate: 'ไม่ทราบ', stale_news_warning: null, cards: [], raw_corrections: [],
      flags: ['AGENT_FAILED'], skipped: [], tool_log: [], usage: { tool_calls: 0, minutes: Number(ctx.minutes) || 0, costUsd: 0 },
      stats: { aliases: norm.aliases },
    };
  }
  const r = norm.result;
  const own = ctx.ownPage || OWN_PAGE;
  const flags = [...r.flags];
  const addFlag = (f) => { if (!flags.includes(f)) flags.push(f); };

  // การ์ด: ด่าน 2/3/4/6 → เรียง confidence (เสถียร) → ตัด 8 (ด่าน 8) → ตั้ง id R1..Rn
  const gatedCards = r.cards.map((c, i) => ({ c: gateCard(c, own), i }));
  gatedCards.sort((a, b) => (b.c.confidence - a.c.confidence) || (a.i - b.i));
  const kept = gatedCards.slice(0, GATE_RULES.MAX_CARDS).map(({ c }, idx) => ({ id: `R${idx + 1}`, ...c }));
  const cut = Math.max(0, gatedCards.length - kept.length);
  if (kept.some((c) => c.contradicts_raw)) addFlag('RAW_CONTRADICTION'); // ด่าน 5

  // ต้นทาง: ห้ามเป็นเพจเราเอง · ไม่พบ/ไม่มั่นใจ = ธง (ข้อ 15)
  let origin = { ...r.origin_post };
  if (origin.url && isOwnPage(origin.url, origin.source_name, own)) {
    origin = { url: null, source_name: '', date: '', confidence: 0 };
    addFlag('OWN_PAGE_ORIGIN');
  }
  if (!origin.url || origin.confidence < GATE_RULES.ORIGIN_MIN_CONFIDENCE) addFlag('ORIGIN_NOT_FOUND');

  // raw_corrections: ต้องมี source_url http(s) ที่ไม่ใช่เพจเรา + ค่าจากต้นทาง (ข้อ 13 แก้ตามต้นทาง + ติดธง)
  const corrections = r.raw_corrections.filter((x) => isHttpUrl(x.source_url) && !isOwnPage(x.source_url, '', own) && x.source_value);
  if (corrections.length) addFlag('RAW_CONTRADICTION');

  // ข่าวเก่า (ข้อ 14): เอเจนต์ตั้งเอง หรือวันที่เรื่องเก่ากว่าวันส่งเกินเกณฑ์ (ธงอย่างเดียว ไม่หยุดงาน)
  const storyT = parseStoryDate(r.story_date_estimate);
  const createdT = Date.parse(ctx.jobCreatedAt || '');
  if (storyT !== null && Number.isFinite(createdT) && createdT - storyT > staleDaysOf(ctx.staleDays) * 86400000) addFlag('STALE_NEWS');

  // ด่าน 7: usage จาก tool_log
  const cost = costFromToolLog(r.tool_log);
  const minutes = Number.isFinite(Number(ctx.minutes)) ? Number(ctx.minutes) : (r.self_report.minutes || 0);
  const usage = { tool_calls: cost.tool_calls, minutes: Math.round(minutes * 100) / 100, costUsd: cost.costUsd };
  const maxCalls = Number(ctx.maxCalls);
  const maxMinutes = Number(ctx.maxMinutes);
  if ((Number.isFinite(maxCalls) && maxCalls > 0 && usage.tool_calls > maxCalls)
    || (Number.isFinite(maxMinutes) && maxMinutes > 0 && usage.minutes > maxMinutes + 1)) addFlag('OVER_BUDGET');

  const counts = { pass: 0, staff_only: 0, dropped: 0 };
  for (const c of kept) counts[c.gate]++;
  return {
    ok: true,
    status: 'done',
    errors: [],
    complexity: r.complexity,
    plan: r.plan,
    origin_post: origin,
    story_date_estimate: r.story_date_estimate,
    stale_news_warning: r.stale_news_warning,
    cards: kept,
    raw_corrections: corrections,
    flags,
    skipped: r.skipped,
    tool_log: r.tool_log,
    usage,
    stats: { ...counts, cut, aliases: norm.aliases, byTool: cost.byTool, browser: r.browser_available, selfReport: r.self_report },
  };
}

/** ค่าความคุ้มของผล (ใช้เทียบผลรอบ low กับ medium): การ์ดที่ใช้ได้ + ต้นทางที่พบ */
export function resultValue(gated) {
  if (!gated || !gated.ok) return -1;
  const usable = gated.cards.filter((c) => c.gate === 'pass').length * 2 + gated.cards.filter((c) => c.gate === 'staff_only').length;
  return usable + (gated.origin_post && gated.origin_post.url ? 3 : 0);
}
