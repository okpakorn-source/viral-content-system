'use strict';
// ============================================================
// 🧾 discord-bot/researchCard.js — บัตรข้อเท็จจริงจากเอเจนต์ค้นคว้า (Research Agent v2 · เฟส 1 · เลน C) · 1 ต.ค. 69
// ------------------------------------------------------------
// สเปก: C:\tmp\research-agent-lab\SPEC-v2.md — ส่วน 0 (เจ้าของข้อ 2 · 5 · 12 · 13 · 14 · 15 · 16 · 21 · 23) · 2.2 · 2.3 · 2.4 · 7 · 8(3)
// สวิตช์: RESEARCH_AGENT=1 บน Railway (env ของบอท · รับ '1' ตรงตัวแบบ envFlag ของ index.js)
//   ไม่ตั้ง/ค่าอื่น = ปิด = ทุกเมธอดเป็น no-op: ไม่ตั้ง timer ไม่ยิง HTTP ไม่แตะ payload → บอทเดิมทุกไบต์
// เปิดแล้วทำอะไร:
//   1) applySourceUrls — แยกลิงก์ออกจากข้อความพนักงาน → payload.sourceUrls · input = เนื้อที่ตัดลิงก์
//      (เหลือ < 20 ตัวอักษร = คง input เดิม = url mode เดิม)
//   2) watch — ได้ jobId + ack แล้ว: GET /api/research/cards?jobId= ทุก 20 วิ ระหว่างรองาน
//      · เว็บปิดสวิตช์ (เลน B ตอบ enabled:false) = เลิกถามทันที · ใบขอ expired/failed หรือ 401/403 = เลิกถาม
//   3) jobEnded — งานจบ (โพสต์ผล/ล้ม): ถามการ์ดทันที 1 ครั้งแล้วถามต่ออีก ≤ 15 นาที · โพสต์ผลแล้ว → POST /api/bot/posted
//      · /api/research/status บอกออฟไลน์ (เครื่องค้นคว้าเงียบ > 10 นาที) และยังไม่มีการ์ด → ติดป้าย 🔌 รีเสิร์ชออฟไลน์ แล้วเลิกตาม
//   4) การ์ดมาถึง → reply embed "🧾 บัตรข้อเท็จจริง" ใต้ข้อความพนักงาน (หัว 🧪 ทดลอง เมื่อ mode=shadow) + ติด 👍 👎
//      แผนเอเจนต์ย่อ 1 บรรทัด/ข้อ · การ์ด: claim · แหล่ง(ลิงก์)+วันที่ · ความมั่นใจ
//      · ธง ⚠️ ข่าวเก่า · ❗ ขัดต้นฉบับ (raw → source · ป้ายลิงก์ = ชื่อโดเมนของ source_url) · 🔍 ยืนยันต้นทางไม่ได้ · 🧭 ต้นทาง: ลิงก์
//      ก่อนโพสต์เช็ค GET /api/bot/posted ว่ามี instance อื่นโพสต์บัตรไปแล้วหรือยัง (ช่วง redeploy ทับกัน)
//      บัตรขึ้นก่อนงานจบ = เลิกถามแต่ "จอด" รอจบงานเพื่อจด caseId/ข้อความผลลง bot-posted
//      bot-posted = นิยามเดียวของเลน B: route /api/bot/posted → saveBotPosted/getBotPosted (src/lib/research-agent/store.js)
//      แถว store_items id 'bposted_<jobId>' · data.id = jobId · revision/cas (ดูหัวไฟล์ route)
//   5) handleReaction — 👍/👎 ของคน (ไม่ใช่บอท) บนบัตร → POST /api/research/feedback {jobId, cardId:'all', vote, userId}
//   6) โควตาเอเจนต์ ≤ RESEARCH_AGENT_QUOTA_ALERT_PCT (ค่าเริ่มต้น 15% · เหลือ 15% พอดีก็เตือน) จาก /api/research/status หรือจากบัตร
//      (ธง QUOTA_LOW / brain.quotaPctAfter) → โพสต์เตือนเจ้าของ (mention) วันละครั้ง (วันตามเวลาไทย) ในห้องเดิม
//      เจ้าของ = env RESEARCH_AGENT_OWNER_DISCORD_ID ถ้าตั้ง ไม่งั้นเจ้าของเซิร์ฟเวอร์ (guild.ownerId)
// กุญแจ: /api/research/* = x-api-key เดิมของบอท (API_KEY = DISCORD_API_SECRET ฝั่ง Vercel) อย่างเดียว · /api/bot/posted = x-bot-secret
//   ไม่ส่ง x-research-secret (ความลับของ worker — ห้ามตั้ง RESEARCH_AGENT_SECRET บน Railway · ถ้าตั้งไว้ บอทเตือนใน log ตอนเปิด ไม่พิมพ์ค่า)
// env ฝั่งบอท (Railway): RESEARCH_AGENT=1 (index.js) · RESEARCH_AGENT_QUOTA_ALERT_PCT (15) · RESEARCH_AGENT_OWNER_DISCORD_ID (ไม่ตั้ง = guild.ownerId)
// ★ r3 1 ต.ค. 69 — ข้อตัดสินผู้คุมงานหลังตรวจสัญญาข้ามเลน (C:\tmp\research-agent-lab\contract-check.json):
//   #4 bot-posted ใช้ store ของเลน B · #7 เลิกส่ง x-research-secret · #8 enabled:false → เลิกถาม · #9 raw_corrections ใช้ชื่อโดเมน
//   · หางหลังจบงาน 10 → 15 นาที (30–40 ข่าว/วัน มาเป็นจังหวะ · worker ขนาน 2 · เบราว์เซอร์ทีละงาน) · resultMsgIds ≤ 50 (= เพดานที่เลน B เก็บ)
// fail-open: เมธอดสาธารณะไม่โยน error และไม่ต้องรอ (index.js เรียกโดยไม่ await) → รีเสิร์ชล้ม/ช้า/ออฟไลน์ ข่าวไม่ล้ม ไม่ช้าลง
// ความปลอดภัย: เนื้อการ์ดมาจากเว็บ = DATA ONLY — แสดงอย่างเดียว ไม่ตีความ · ห้าม mention ใคร (allowedMentions ว่าง)
//   · ลิงก์รับเฉพาะ http(s) · escape markdown กัน masked link ปลอม · log ไม่มี header/คีย์/เนื้อข่าว
// ไม่ require discord.js/axios เอง — index.js ฉีดเข้ามา (เทสโหลดได้โดยไม่ต้องมี node_modules ของบอท)
// ============================================================

const POLL_MS = 20 * 1000;              // ถามการ์ดทุก 20 วิ (สเปกส่วน 7)
// ★ r3 1 ต.ค. 69 (ข้อตัดสินผู้คุมงาน): หาง 10 → 15 นาที — เจ้าของแจ้งปริมาณ 30–40 ข่าว/วัน (08:00–22:00) มาเป็นจังหวะไม่ตายตัว
//   worker รับขนาน RESEARCH_AGENT_CONCURRENCY (2) แต่เบราว์เซอร์ทีละงาน → ช่วงข่าวกระจุกการ์ดมาช้ากว่าผลข่าวได้
//   (ใบขอของเลน B หมดอายุที่ createdAt + RESEARCH_AGENT_DEADLINE_MIN ค่าเริ่มต้น 15 นาที → ใบที่ไม่ถูกหยิบทันจะ expired = บอทเลิกเอง)
const TAIL_MS = 15 * 60 * 1000;         // หลังงานจบ (โพสต์ผล/ล้ม) ถามต่อได้อีกไม่เกิน 15 นาที
// ตาข่ายนิรภัย: ตามงานเดียวไม่เกิน 90 นาทีนับจากเริ่มตาม — ปกติจบใน ~30 นาที (บอทรอผลไม่เกิน 15 นาทีใน pollJobUntilDone + หาง 15 นาที)
//   เพดานนี้มีไว้กันรั่วกรณี jobEnded ไม่ถูกเรียกเท่านั้น
const HARD_CAP_MS = 90 * 60 * 1000;
const STATUS_TTL_MS = 60 * 1000;        // แคชคำตอบ /api/research/status ข้ามงาน (กันยิงถี่)
const HTTP_TIMEOUT_MS = 10 * 1000;
const MIN_TEXT_AFTER_URLS = 20;         // ตัดลิงก์แล้วเหลือสั้นกว่านี้ = url mode ตามเดิม (สเปกส่วน 7)
const MAX_SOURCE_URLS = 10;
const MAX_URL_LENGTH = 2000;
const LINK_HREF_MAX = 500;              // ลิงก์ยาวกว่านี้ไม่ทำเป็น markdown link (กันตัดความยาวแล้วผ่ากลางลิงก์)
const MAX_WATCHES = 50;                 // งานที่ตามพร้อมกันสูงสุด (กันรั่ว) — เกินแล้วเลิกตามงานที่เก่าที่สุด
const CARD_MAP_MAX = 500;               // จำ messageId ของบัตร → jobId (ใช้ตอนกด 👍👎) · หลังรีสตาร์ตอ่าน jobId จากท้ายบัตรแทน
const MAX_RESULT_MSG_IDS = 50;          // = BOT_POSTED_MAX_RESULT_MSG_IDS ของ store เลน B (เก็บครบไม่ตัด) · route /api/bot/posted รับไม่เกินนี้ (เกิน = 400)
const DEFAULT_QUOTA_ALERT_PCT = 15;     // เจ้าของข้อ 16: เหลือ 15% ให้เตือน
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

const CARD_TITLE = '🧾 บัตรข้อเท็จจริง';
const SHADOW_TAG = '🧪 ทดลอง';
// ข้อความผลข่าวของ index.js (pollJobUntilDone) ขึ้นต้นแบบนี้เสมอเมื่อโพสต์ผลครบ — ใช้แยก "โพสต์ผลแล้ว" กับ "ล้ม" ตอนงานจบ
//   (เทสเส้นทางจริงใน tests/bot-research-card.test.mjs กันข้อความนี้เปลี่ยนโดยไม่รู้ตัว)
const RESULT_POSTED_PREFIX = '✅ **สร้างข่าวสำเร็จ!**';
const OFFLINE_TEXT = '🔌 รีเสิร์ชออฟไลน์ — ข่าวนี้ไม่มีบัตรข้อเท็จจริง (เครื่องค้นคว้าไม่ส่งสัญญาณเกิน 10 นาที · ข่าวทำงานตามปกติ)';
const SHADOW_LEAD = '_ทดลอง: ข่าวยังไม่ใช้บัตรนี้ — ช่วยกด 👍/👎 ว่าบัตรมีประโยชน์ไหม_';
const FEEDBACK_VOTES = Object.freeze({ '👍': 'up', '👎': 'down' });
const TERMINAL_CARD_STATUSES = new Set(['done', 'failed', 'skipped']);
const DEAD_REQUEST_STATUSES = new Set(['expired', 'failed']);
const KNOWN_FLAGS = new Set(['ORIGIN_NOT_FOUND', 'STALE_NEWS', 'RAW_CONTRADICTION', 'BROWSER_WRONG_ACCOUNT', 'QUOTA_LOW']);
const CASE_LINK_RE = /\/generation-logs\/([A-Za-z0-9_-]+)/u; // รูปเดียวกับ index.js (ลิงก์ 🔗 ดูผลลัพธ์เต็ม)
const FOOTER_JOB_RE = /jobId:\s*([A-Za-z0-9_-]{1,200})/u;

// เพดาน embed ของ Discord: title 256 · description 4096 · field name 256 / value 1024 · footer 2048 · รวมทั้งก้อน 6000
const EMBED_TOTAL_BUDGET = 5800;
const DESCRIPTION_BUDGET = 2400;
const FIELD_VALUE_MAX = 1024;
const FIELD_NAME_MAX = 256;
const FOOTER_MAX = 2048;

const COLOR_SHADOW = '#f59e0b';
const COLOR_LIVE = '#3b82f6';
const COLOR_ALERT = '#ef4444';
const COLOR_MUTED = '#6b7280';

// ─── ตัวช่วยข้อความ ─────────────────────────────────────────────
function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function oneLine(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

// จุดตัดที่ไม่ผ่ากลางคู่ surrogate (อีโมจิ)
function safeCut(text, cut) {
  const code = text.charCodeAt(cut - 1);
  return cut > 0 && code >= 0xd800 && code <= 0xdbff ? cut - 1 : cut;
}

// ตัดความยาว (นับแบบ .length = UTF-16 ซึ่งไม่น้อยกว่าที่ Discord นับ) · ผลยาวไม่เกิน max
function clip(value, max) {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  return `${text.slice(0, safeCut(text, Math.max(0, max - 1)))}…`;
}

// เนื้อจากเอเจนต์/เว็บ = DATA: กัน markdown เปลี่ยนความหมาย (ตัวหนา/สปอยล์/masked link [ข้อความ](ลิงก์ปลอม)/<@mention>)
function escapeMd(value) {
  return String(value ?? '').replace(/[\\*_~`|[\]<>]/gu, (ch) => `\\${ch}`);
}

// ข้อความจากเอเจนต์ → บรรทัดเดียว + escape + ตัดความยาว · ผลยาวไม่เกิน max เสมอ · ไม่ผ่ากลางคู่ escape หรือคู่ surrogate
function safe(value, max) {
  const escaped = escapeMd(oneLine(value));
  if (escaped.length <= max) return escaped;
  let cut = safeCut(escaped, Math.max(0, max - 1));
  let backslashes = 0;
  for (let i = cut - 1; i >= 0 && escaped[i] === '\\'; i--) backslashes++;
  if (backslashes % 2 === 1) cut -= 1; // backslash ตัวสุดท้ายกำลัง escape ตัวที่ถูกตัดทิ้ง
  return `${escaped.slice(0, cut)}…`;
}

function shortId(jobId) {
  return String(jobId ?? '').slice(0, 12);
}

function errText(err) {
  return String(err?.message || err).slice(0, 80);
}

function idOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() && value.length <= 200 ? value.trim() : null;
}

function isJobId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/u.test(value);
}

function readPct(raw, fallback) {
  const text = String(raw ?? '').trim();
  const n = Number(text);
  return text && Number.isFinite(n) && n > 0 && n <= 100 ? n : fallback;
}

function readSnowflake(raw) {
  const value = String(raw ?? '').trim();
  return /^\d{15,25}$/u.test(value) ? value : null;
}

function compareSnowflake(a, b) {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

function bangkokDay(ms) {
  return new Date(ms + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

function firstFinite(...values) {
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// ─── ลิงก์ ───────────────────────────────────────────────────────
// ลิงก์ http(s) จริงเท่านั้น (มีโดเมน · ยาวไม่เกินเพดาน) · คืนรูปที่ encode แล้ว (ช่องว่าง/อักขระพิเศษไม่ทำลาย markdown)
function safeUrl(raw) {
  const text = str(raw);
  if (!text || text.length > MAX_URL_LENGTH) return null;
  try {
    const parsed = new URL(text);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return '';
  }
}

// [ชื่อแหล่ง](ลิงก์) — ชื่อถูก escape · วงเล็บ/ช่องว่างในลิงก์ถูก percent-encode (ลิงก์ผ่าน safeUrl มาแล้วเท่านั้น)
//   ลิงก์ยาวเกิน LINK_HREF_MAX = แสดงชื่อแหล่ง (+โดเมน) ไม่ทำลิงก์
function mdLink(name, url) {
  const host = escapeMd(hostOf(url));
  const label = safe(name, 80) || host || 'ลิงก์';
  const href = String(url).replace(/[()\s<>]/gu, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
  if (href.length > LINK_HREF_MAX) return `${label} (${host || 'ลิงก์ยาวเกิน'})`;
  return `[${label}](${href})`;
}

// [โดเมน](ลิงก์) — ป้ายเป็นชื่อโดเมนของลิงก์เสมอ (ใช้กับ raw_corrections ซึ่งสัญญา 2.2 ไม่มีชื่อแหล่ง)
function hostLink(url) {
  return mdLink('', url);
}

// ─── 1) แยกลิงก์ออกจากข้อความพนักงาน (เจ้าของข้อ 2) ─────────────────
const URL_TOKEN_RE = /<?(https?:\/\/[^\s<>]+)>?/giu;
const TRAILING_PUNCT_RE = /[.,;:!?'"*_~`…»”’]/u;
const CLOSERS = Object.freeze({ ')': '(', ']': '[', '}': '{' });

function countChar(text, ch) {
  let n = 0;
  for (const c of text) if (c === ch) n++;
  return n;
}

// ตัดเครื่องหมายท้ายที่ติดมากับลิงก์ในแชท (จุด/จุลภาค/วงเล็บปิดของ markdown) · วงเล็บที่จับคู่ครบในลิงก์ (เช่น วิกิ) เก็บไว้
function trimUrlTail(raw) {
  let url = String(raw ?? '');
  for (let guard = 0; guard < 64 && url.length > 0; guard++) {
    const last = url[url.length - 1];
    if (TRAILING_PUNCT_RE.test(last)) { url = url.slice(0, -1); continue; }
    const opener = CLOSERS[last];
    if (opener && countChar(url, last) > countChar(url, opener)) { url = url.slice(0, -1); continue; }
    break;
  }
  return url;
}

function tidyText(text) {
  return String(text ?? '')
    .replace(/\[([^\]\n]*)\]\(\s*\)/gu, '$1') // [ข้อความ](ลิงก์) ที่ลิงก์ถูกดึงออก → เหลือข้อความ
    .replace(/\(\s*\)|<\s*>/gu, '')           // วงเล็บว่างที่ลิงก์เคยอยู่
    .replace(/[ \t\u00a0]+([.,;:!?])(?=\s|$)/gu, '$1') // ช่องว่างค้างหน้าเครื่องหมายที่เคยต่อท้ายลิงก์
    .replace(/[ \t\u00a0]+(\r?\n)/gu, '$1')
    .replace(/[ \t\u00a0]{2,}/gu, ' ')
    .replace(/(?:\r?\n){3,}/gu, '\n\n')
    .trim();
}

/**
 * แยกลิงก์ http(s) ออกจากข้อความ → { sourceUrls (ไม่ซ้ำ · ≤ 10 · ตามลำดับที่พบ), text (เนื้อที่ตัดลิงก์ออกแล้ว) }
 * ข้อความที่หน้าตาเหมือนลิงก์แต่ใช้ไม่ได้ (เช่น "https://" เปล่า) คงไว้ในเนื้อ
 */
function splitSourceUrls(content) {
  const source = typeof content === 'string' ? content : '';
  const sourceUrls = [];
  const text = source.replace(URL_TOKEN_RE, (token, inner) => {
    const trimmed = trimUrlTail(inner);
    if (!safeUrl(trimmed)) return token;
    if (!sourceUrls.includes(trimmed) && sourceUrls.length < MAX_SOURCE_URLS) sourceUrls.push(trimmed);
    return inner.slice(trimmed.length); // เครื่องหมายท้ายที่ไม่ใช่ส่วนของลิงก์คืนกลับเข้าเนื้อ
  });
  return { sourceUrls, text: tidyText(text) };
}

// ─── อ่านคำตอบ API ฝั่งเว็บ (เลน B) แบบทนรูปทรง ─────────────────────
function looksLikeRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.status === 'string';
}

function latestRevision(records) {
  return records.reduce((best, cur) => ((Number(cur.revision) || 0) >= (Number(best.revision) || 0) ? cur : best));
}

/**
 * ดึงแถว research-cards (สเปก 2.2) ออกจากคำตอบ GET /api/research/cards
 * รูปจริงของเลน B (src/app/api/research/cards/route.js): {success, jobId, found, enabled, mode, request:{status,…}|null,
 *   cards: แถว research-cards (object · ไม่มี tool_log) | null, summary} → แถวอยู่ใต้คีย์ "cards"
 *   (★ 1 ต.ค. 69 r2: เดิมไม่อ่านคีย์นี้ = บัตรไม่เคยขึ้นหลังรวมเลน · looksLikeRecord ไม่รับ array → {cards:[แถว…]} ยังไปทางเดิม)
 * รูปอื่นที่ยังรับไว้ (ทนรูปทรง): {card}|{item}|{data}|{items:[…]}|{cards:[แถว…]}|แบบกางทั้งก้อน
 */
function pickCardRecord(body) {
  if (!body || typeof body !== 'object' || body.success === false) return null;
  for (const key of ['card', 'cards', 'item', 'record', 'researchCard', 'data', 'result']) {
    if (looksLikeRecord(body[key])) return body[key];
  }
  for (const key of ['items', 'records']) {
    const list = Array.isArray(body[key]) ? body[key].filter(looksLikeRecord) : [];
    if (list.length > 0) return latestRevision(list);
  }
  if (Array.isArray(body.cards) && body.cards.length > 0 && body.cards.every(looksLikeRecord)
    && body.cards.some((c) => Array.isArray(c.cards) || Array.isArray(c.plan))) {
    return latestRevision(body.cards);
  }
  if (looksLikeRecord(body) && (Array.isArray(body.cards) || Array.isArray(body.plan) || typeof body.mode === 'string')) return body;
  return null;
}

/** คำตอบ GET /api/research/status → { offline, quotaPct (เหลือ %), quotaLow, account } · อ่านไม่ออก = null (ถือว่าไม่รู้ ไม่ใช่ออฟไลน์) */
function parseStatus(body) {
  if (!body || typeof body !== 'object' || body.success === false) return null;
  const lower = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
  const worker = body.worker && typeof body.worker === 'object' ? body.worker : {};
  const quota = body.quota && typeof body.quota === 'object' ? body.quota : {};
  const offline = body.offline === true || [body.status, body.state, body.workerStatus, worker.status].map(lower).includes('offline');
  const pct = firstFinite(body.quotaPct, quota.pct, quota.percent, quota.remainingPct, quota.leftPct,
    worker.quotaPct, worker.quota?.pct, body.quotaPctAfter);
  const flags = [body.flags, worker.flags].flatMap((f) => (Array.isArray(f) ? f : []));
  const quotaLow = body.quotaLow === true || quota.low === true || flags.includes('QUOTA_LOW');
  const account = str(quota.account) || str(body.account) || str(worker.account) || null;
  return { offline, quotaPct: pct === null ? null : Math.max(0, Math.min(100, pct)), quotaLow, account };
}

// ─── 4) หน้าตาบัตร (pure — เทสได้โดยไม่ต้องมี discord.js) ───────────────
function normalizeFlags(card) {
  const flags = new Set();
  for (const f of Array.isArray(card?.flags) ? card.flags : []) {
    const name = typeof f === 'string' ? f.trim() : '';
    if (/^[A-Z0-9_]{2,40}$/u.test(name)) flags.add(name);
  }
  return flags;
}

function confidenceText(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n <= 1) return `${Math.round(n * 100)}%`;
  if (n <= 100) return `${Math.round(n)}%`;
  return null;
}

function flagLines(card, flags) {
  const lines = [];
  const origin = card.origin_post && typeof card.origin_post === 'object' ? card.origin_post : {};
  const originUrl = safeUrl(origin.url);
  if (flags.has('ORIGIN_NOT_FOUND')) {
    lines.push('🔍 ยืนยันต้นทางไม่ได้ — ข่าวทำตามปกติ');
  } else if (originUrl) {
    const date = safe(origin.date, 60);
    const conf = confidenceText(origin.confidence);
    lines.push(`🧭 ต้นทาง: ${mdLink(origin.source_name, originUrl)}${date ? ` · ${date}` : ''}${conf ? ` · มั่นใจ ${conf}` : ''}`);
  }
  if (flags.has('STALE_NEWS')) {
    const detail = safe(card.stale_news_warning, 300)
      || (str(card.story_date_estimate) ? `เรื่องน่าจะเกิดเมื่อ ${safe(card.story_date_estimate, 80)}` : 'ต้นทางเก่ากว่าวันที่ส่งข่าว');
    lines.push(`⚠️ ข่าวเก่า: ${detail}`);
  }
  const corrections = (Array.isArray(card.raw_corrections) ? card.raw_corrections : []).filter((c) => c && typeof c === 'object');
  // ★ r3 1 ต.ค. 69 (ข้อตัดสินผู้คุมงาน · mismatch #9): raw_corrections ตามสัญญา 2.2 = {field, raw_value, source_value, source_url, confidence}
  //   ไม่มี source_name (normalizeRawCorrections ของเลน B ตัดช่องอื่นทิ้งอยู่แล้ว) → ป้ายลิงก์ = ชื่อโดเมนของ source_url โดยตั้งใจ
  //   (มีช่องชื่อแหล่งติดมาจากที่ไหนก็ไม่อ่าน — ชื่อที่ไม่ได้ผ่านด่านห้ามขึ้นบัตร)
  for (const fix of corrections.slice(0, 5)) {
    const link = safeUrl(fix.source_url);
    const field = safe(fix.field, 40);
    lines.push(`❗ ขัดต้นฉบับ: ${field ? `${field}: ` : ''}"${safe(fix.raw_value, 120)}" → "${safe(fix.source_value, 120)}"${link ? ` (${hostLink(link)})` : ''}`);
  }
  if (corrections.length > 5) lines.push(`❗ (+${corrections.length - 5} จุด)`);
  if (flags.has('RAW_CONTRADICTION') && corrections.length === 0) lines.push('❗ ขัดต้นฉบับ — ดูการ์ดที่ติด ❗ ด้านล่าง');
  if (flags.has('BROWSER_WRONG_ACCOUNT')) lines.push('🛑 เบราว์เซอร์ล็อกอินบัญชีอื่น — เอเจนต์หยุดใช้เบราว์เซอร์แล้ว (เจ้าของตรวจเครื่อง)');
  if (flags.has('QUOTA_LOW')) lines.push('🔋 โควตาเอเจนต์ใกล้หมด');
  const others = [...flags].filter((f) => !KNOWN_FLAGS.has(f)).slice(0, 6);
  if (others.length > 0) lines.push(`🏷️ ${others.map((f) => escapeMd(f)).join(' · ')}`);
  return lines;
}

// เจ้าของข้อ 21: แผนเอเจนต์แบบย่อ 1 บรรทัด/ข้อ — 🔎 = ค้น · ⏭️ = ไม่ค้น (พร้อมเหตุผลสั้น)
function planLines(plan) {
  if (!Array.isArray(plan)) return [];
  return plan
    .filter((p) => p && typeof p === 'object' && str(p.question))
    .map((p) => (str(p.decided) === 'ค้น'
      ? `🔎 ${safe(p.question, 140)}`
      : `⏭️ ${safe(p.question, 100)} — ${safe(p.reason, 60) || 'ไม่ค้น'}`));
}

function cardField(c, index, claimMax) {
  const id = /^[A-Za-z0-9_-]{1,12}$/u.test(str(c.id)) ? str(c.id) : `R${index + 1}`;
  const conf = confidenceText(c.confidence);
  const tags = [
    id,
    conf ? `ความมั่นใจ ${conf}` : null,
    c.contradicts_raw === true ? '❗ ขัดต้นฉบับ' : null,
    c.gate === 'staff_only' ? '👀 เฉพาะพนักงาน' : null,
    c.identity === 'verified' ? '🪪 ยืนยันตัวตน' : null,
  ].filter(Boolean);
  const url = safeUrl(c.source_url);
  const date = safe(c.source_date, 70);
  const source = url ? mdLink(c.source_name, url) : (safe(c.source_name, 80) || 'ไม่ระบุแหล่ง');
  const tail = `\n📎 ${source}${date ? ` · ${date}` : ''}`;
  return {
    name: clip(tags.join(' · '), FIELD_NAME_MAX),
    value: `${safe(c.claim, Math.max(40, Math.min(claimMax, FIELD_VALUE_MAX - tail.length)))}${tail}`,
  };
}

function fitLines(lines, budget) {
  const out = [];
  let used = 0;
  for (let i = 0; i < lines.length; i++) {
    const add = lines[i].length + (out.length > 0 ? 1 : 0);
    if (used + add > budget) {
      const rest = lines.slice(i).filter((l) => l.trim()).length;
      if (rest > 0) out.push(`… (+${rest} บรรทัด)`);
      break;
    }
    out.push(lines[i]);
    used += add;
  }
  return out.join('\n').trim();
}

/**
 * แถว research-cards (สเปก 2.2) → ข้อมูล embed ล้วน { title, color, description, fields[], footer, reactable, cardCount, shadow, status }
 * โหมด shadow (หรือไม่ระบุโหมด — ปลอดภัยไว้ก่อน) = หัว "🧪 ทดลอง" · การ์ด gate=dropped ไม่แสดง · ท้ายบัตรมี "jobId: …" เสมอ
 */
function buildCardView(card, jobId) {
  const record = card && typeof card === 'object' ? card : {};
  const status = TERMINAL_CARD_STATUSES.has(record.status) ? record.status : 'done';
  const mode = str(record.mode);
  const shadow = mode !== 'assist' && mode !== 'write';
  const flags = normalizeFlags(record);
  const corrections = Array.isArray(record.raw_corrections) ? record.raw_corrections.filter((c) => c && typeof c === 'object') : [];
  const cards = (Array.isArray(record.cards) ? record.cards : [])
    .filter((c) => c && typeof c === 'object' && c.gate !== 'dropped' && str(c.claim));

  const lines = [];
  if (shadow && status === 'done') lines.push(SHADOW_LEAD);
  if (status === 'failed') lines.push('⚠️ รีเสิร์ชข่าวนี้ไม่สำเร็จ — ข่าวทำตามปกติจากเนื้อที่ส่งมา');
  if (status === 'skipped') {
    const why = safe((Array.isArray(record.skipped) ? record.skipped : []).find((s) => typeof s === 'string' && s.trim()), 160);
    lines.push(`⏭️ เอเจนต์ข้ามข่าวนี้${why ? `: ${why}` : ''} — ข่าวทำตามปกติ`);
  }
  lines.push(...flagLines(record, flags));
  const plan = planLines(record.plan);
  if (plan.length > 0) lines.push(...(lines.length > 0 ? [''] : []), '**แผนเอเจนต์**', ...plan);
  if (status === 'done' && cards.length === 0) lines.push(...(lines.length > 0 ? [''] : []), '_ไม่มีข้อเท็จจริงที่ผ่านด่าน — ข่าวใช้เนื้อที่ส่งมา_');
  const description = fitLines(lines, DESCRIPTION_BUDGET) || '_ไม่มีรายละเอียด_';

  const title = shadow ? `${SHADOW_TAG} · ${CARD_TITLE}` : CARD_TITLE;
  const brain = record.brain && typeof record.brain === 'object' ? record.brain : {};
  const usage = record.usage && typeof record.usage === 'object' ? record.usage : {};
  const footerParts = [`jobId: ${jobId}`];
  const brainText = [safe(brain.model, 40), safe(brain.effort, 12)].filter(Boolean).join(' ');
  if (brainText) footerParts.push(brain.kind === 'api' ? `${brainText} (API สำรอง)` : brainText);
  const calls = firstFinite(usage.tool_calls);
  const minutes = firstFinite(usage.minutes);
  if (calls !== null) footerParts.push(`${calls} ครั้ง`);
  if (minutes !== null) footerParts.push(`${Math.round(minutes * 10) / 10} นาที`);

  // งบรวม 6000 ของ Discord: ลองตัด claim ให้สั้นลงก่อน ถ้ายังเกินค่อยตัดใบท้ายๆ ออก (บอกจำนวนไว้ท้ายบัตร)
  let fields = [];
  let omitted = 0;
  const fixedLength = title.length + description.length + footerParts.join(' · ').length + 80; // 80 = ป้ายท้ายบัตรที่ต่อทีหลัง
  for (const claimMax of [360, 200, 120]) {
    fields = cards.map((c, i) => cardField(c, i, claimMax));
    omitted = 0;
    let total = fixedLength + fields.reduce((sum, f) => sum + f.name.length + f.value.length, 0);
    while (total > EMBED_TOTAL_BUDGET && fields.length > 0) {
      const dropped = fields.pop();
      omitted++;
      total -= dropped.name.length + dropped.value.length;
    }
    if (omitted === 0) break;
  }
  if (omitted > 0) footerParts.push(`+${omitted} ใบที่ไม่พอที่แสดง`);
  if (status === 'done') footerParts.push('กด 👍/👎 ให้คะแนนบัตรนี้');

  const contradiction = flags.has('RAW_CONTRADICTION') || corrections.length > 0 || cards.some((c) => c.contradicts_raw === true);
  const color = status !== 'done' ? COLOR_MUTED : contradiction ? COLOR_ALERT : shadow ? COLOR_SHADOW : COLOR_LIVE;
  return {
    title,
    color,
    description,
    fields,
    footer: clip(footerParts.join(' · '), FOOTER_MAX),
    reactable: status === 'done',
    cardCount: cards.length,
    shadow,
    status,
  };
}

function buildCardEmbed(EmbedBuilder, card, jobId) {
  const view = buildCardView(card, jobId);
  const embed = new EmbedBuilder()
    .setColor(view.color)
    .setTitle(view.title)
    .setDescription(view.description);
  if (view.fields.length > 0) embed.addFields(...view.fields);
  embed.setFooter({ text: view.footer });
  return { embed, view };
}

// บัตรที่บอทโพสต์ไว้ก่อนรีสตาร์ต: อ่าน jobId จากท้ายบัตร (หัวต้องเป็นบัตรข้อเท็จจริงจริง ไม่ใช่ embed ผลข่าว)
function jobIdFromCardMessage(message) {
  const embeds = Array.isArray(message?.embeds) ? message.embeds : [];
  for (const embed of embeds) {
    const title = String(embed?.title ?? embed?.data?.title ?? '');
    const footer = String(embed?.footer?.text ?? embed?.data?.footer?.text ?? '');
    if (!title.includes(CARD_TITLE)) continue;
    const match = footer.match(FOOTER_JOB_RE);
    if (match) return match[1];
  }
  return null;
}

// ─── ตัวควบคุม ───────────────────────────────────────────────────
/**
 * @param {object} options
 * @param {boolean} options.enabled          สวิตช์ RESEARCH_AGENT (ปิด = no-op ทั้งหมด)
 * @param {object} options.env               process.env ของบอท — อ่านแค่ 3 ชื่อ (ไม่ตั้ง = ค่าเริ่มต้น):
 *                                           RESEARCH_AGENT_QUOTA_ALERT_PCT (15) · RESEARCH_AGENT_OWNER_DISCORD_ID (เจ้าของเซิร์ฟเวอร์)
 *                                           · RESEARCH_AGENT_SECRET (ดูแค่ว่าตั้งไว้ไหม → เตือนให้ลบออกจาก Railway · ไม่ส่ง ไม่ log ค่า)
 * @param {{get:Function, post:Function}} options.http   axios
 * @param {Function} options.EmbedBuilder    discord.js EmbedBuilder
 * @param {object} [options.client]          discord.js Client (ใช้ client.user.id กรองรีแอ็กชันของบอทเอง)
 * @param {(path:string)=>string} options.buildApiUrl   path → URL เต็ม (ฐานเดียวกับคิว)
 * @param {()=>object} options.buildApiHeaders           header x-api-key แบบ /api/queue/add
 * @param {()=>object} [options.buildBotHeaders]         header ของ /api/bot/* (x-bot-secret)
 * @param {()=>boolean} [options.isShuttingDown]
 * @param {()=>number} [options.now]          นาฬิกา (เทสฉีดได้) · options.setTimeout · options.clearTimeout · options.logger
 */
function createResearchCards(options = {}) {
  const enabled = options.enabled === true;
  const env = options.env && typeof options.env === 'object' ? options.env : {};
  const http = options.http;
  const EmbedBuilder = options.EmbedBuilder;
  const client = options.client || null;
  const logger = options.logger || console;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const setTimer = typeof options.setTimeout === 'function' ? options.setTimeout : setTimeout;
  const clearTimer = typeof options.clearTimeout === 'function' ? options.clearTimeout : clearTimeout;
  const isShuttingDown = typeof options.isShuttingDown === 'function' ? options.isShuttingDown : () => false;
  const quotaAlertPct = readPct(env.RESEARCH_AGENT_QUOTA_ALERT_PCT, DEFAULT_QUOTA_ALERT_PCT);
  const ownerOverride = readSnowflake(env.RESEARCH_AGENT_OWNER_DISCORD_ID);

  const watches = new Map();          // jobId → state
  const cardJobByMessage = new Map(); // messageId ของบัตร → jobId
  const feedbackChains = new Map();   // messageId → promise (กด 👍 แล้ว 👎 เร็วๆ = บันทึกเรียงตามลำดับกด)
  let statusCache = null;             // { at, value }
  let lastQuotaAlertDay = null;

  // สเปก 2.4: /api/research/* ฝั่งบอทใช้ x-api-key เดิม (API_KEY = DISCORD_API_SECRET ของ Vercel) อย่างเดียว — เลน B ตรวจแค่ x-bot-secret/x-api-key
  //   ★ r3 1 ต.ค. 69 (ข้อตัดสินผู้คุมงาน · mismatch #7): เลิกส่ง x-research-secret — เป็นความลับของ worker ที่บอทไม่ต้องรู้
  //   (เดิมส่งเมื่อ Railway ตั้ง RESEARCH_AGENT_SECRET = ชวนเอาความลับ worker ไปวางเพิ่มอีกที่) · ห้าม log ค่ากุญแจใดๆ
  const workerSecretOnBot = str(env.RESEARCH_AGENT_SECRET) !== '';
  const apiUrl = (path) => options.buildApiUrl(path);
  const apiHeaders = () => ({ ...options.buildApiHeaders() });
  const botHeaders = () => (typeof options.buildBotHeaders === 'function' ? options.buildBotHeaders() : options.buildApiHeaders());
  const botUserId = () => idOf(client?.user?.id);
  const warn = (text) => { try { logger.warn(text); } catch { /* log ล้มห้ามทำงานหลักพัง */ } };
  const info = (text) => { try { logger.log(text); } catch { /* log ล้มห้ามทำงานหลักพัง */ } };

  if (enabled) {
    info(`🧾 [Research] เปิดบัตรข้อเท็จจริง (RESEARCH_AGENT=1) · ถามการ์ดทุก ${POLL_MS / 1000} วิ · ต่อ ≤${TAIL_MS / 60000} นาทีหลังจบงาน · เตือนโควตา ≤${quotaAlertPct}%`);
    if (workerSecretOnBot) {
      warn('[Research] ⚠️ env ของบอทมี RESEARCH_AGENT_SECRET — บอทไม่ใช้ค่านี้แล้ว (ใช้ API_KEY) · ลบออกจาก Railway ได้เลย (ความลับของ worker ควรอยู่แค่ Vercel + เครื่อง worker)');
    }
  }

  // ── วงจรชีวิตการตามงาน ──
  function endWatch(state, reason) {
    if (state.ended) return;
    state.ended = true;
    state.endReason = reason;
    if (state.timer) {
      try { clearTimer(state.timer); } catch { /* timer หายไปแล้ว */ }
      state.timer = null;
    }
    if (watches.get(state.jobId) === state) watches.delete(state.jobId);
    state.resolveDone(reason);
  }

  // งานของ watch เดียวกันวิ่งเรียงทีละอัน (รอบถาม · งานจบ) — กันโพสต์บัตรซ้ำจากสองทาง
  function enqueue(state, fn) {
    const run = state.chain.then(() => (state.ended ? undefined : fn()));
    state.chain = run.catch((err) => {
      warn(`[Research] 🩹 ตามบัตร job ${shortId(state.jobId)} ล้ม (ไม่กระทบข่าว): ${errText(err)}`);
      endWatch(state, 'error');
    });
    return state.chain;
  }

  function schedule(state, ms) {
    if (state.ended) return;
    state.timer = setTimer(() => {
      state.timer = null;
      return enqueue(state, () => tick(state));
    }, ms);
  }

  function evictOldestIfFull() {
    if (watches.size < MAX_WATCHES) return;
    let oldest = null;
    for (const s of watches.values()) if (!oldest || s.startedAt < oldest.startedAt) oldest = s;
    if (oldest) endWatch(oldest, 'evicted');
  }

  // ── HTTP (ทุกตัวล้มเงียบ · ไม่ log header) ──
  async function fetchCard(jobId) {
    let res;
    try {
      res = await http.get(`${apiUrl('/api/research/cards')}?jobId=${encodeURIComponent(jobId)}`, { headers: apiHeaders(), timeout: HTTP_TIMEOUT_MS });
    } catch (err) {
      const status = Number(err?.response?.status);
      // กุญแจผิด/ไม่ได้ตั้ง = ถามต่อก็ไม่มีวันได้ → เลิกตามงานนี้ · 404 (ยังไม่มีการ์ด/route ยังไม่ขึ้น) และ 5xx/สายหลุด = รอรอบหน้า
      if (status === 401 || status === 403) return { kind: 'stop', reason: `http_${status}` };
      return { kind: 'wait' };
    }
    const body = res?.data;
    if (body && body.success === false) {
      if (/(^|_)(OFF|DISABLED|NOT_CONFIGURED)($|_)/u.test(String(body.errorType || ''))) return { kind: 'stop', reason: 'disabled' };
      return { kind: 'wait' };
    }
    // ★ r3 1 ต.ค. 69 (ข้อตัดสินผู้คุมงาน · mismatch #8): เว็บปิดสวิตช์ RESEARCH_AGENT → เลน B ตอบ success:true + enabled:false
    //   (request/cards = null) = ใบขอ/การ์ดใหม่ไม่มีวันมา → เลิกถามทันที ไม่วนทุก 20 วิจนหมดหาง
    //   ตัดสินก่อนอ่านการ์ด: สวิตช์เว็บเป็นตัวหลัก (เจ้าของปิดฝั่งเว็บ = ถอยทั้งระบบ — การ์ดค้างจากก่อนปิดก็ไม่โพสต์)
    if (body && body.enabled === false) return { kind: 'stop', reason: 'disabled' };
    const record = pickCardRecord(body);
    if (record && TERMINAL_CARD_STATUSES.has(record.status)) return { kind: 'card', card: record };
    const requestStatus = String(body?.request?.status ?? body?.requestStatus ?? '');
    if (!record && DEAD_REQUEST_STATUSES.has(requestStatus)) return { kind: 'stop', reason: `request_${requestStatus}` };
    return { kind: 'wait' };
  }

  async function readStatus(maxAgeMs) {
    if (statusCache && now() - statusCache.at <= maxAgeMs) return statusCache.value;
    let value = null;
    try {
      const res = await http.get(apiUrl('/api/research/status'), { headers: apiHeaders(), timeout: HTTP_TIMEOUT_MS });
      value = parseStatus(res?.data);
    } catch {
      value = null; // อ่านไม่ได้ = ไม่รู้ (ไม่ถือว่าออฟไลน์ · ไม่เตือน)
    }
    statusCache = { at: now(), value };
    return value;
  }

  async function readPosted(jobId) {
    try {
      const res = await http.get(`${apiUrl('/api/bot/posted')}?jobId=${encodeURIComponent(jobId)}`, { headers: botHeaders(), timeout: HTTP_TIMEOUT_MS });
      const item = res?.data?.success === true ? res.data.item : null;
      return item && typeof item === 'object' ? item : null;
    } catch {
      return null; // อ่านไม่ได้ = ถือว่ายังไม่มีใครโพสต์ (fail-open: ยอมเสี่ยงซ้ำดีกว่าบัตรหาย)
    }
  }

  // สเปก 2.3 — ส่งทุกช่องที่รู้ ณ ตอนนั้น · route → saveBotPosted ของเลน B รวมกับแถวเดิมแบบ cas (ช่องที่ไม่ส่งคงค่าเดิม) · ไม่มีห้อง = ไม่จด
  //   postedAt = เวลาโพสต์ผล (ส่งเฉพาะตอนจดผลข่าว) · แถวที่จดตอนบัตรขึ้นก่อนผล = postedAt null จนกว่าจะจดผล (createdAt = ครั้งแรกที่จด)
  async function writePosted(state) {
    const channelId = idOf(state.processingMsg?.channelId) || idOf(state.message?.channelId) || idOf(state.message?.channel?.id);
    if (!channelId) return false;
    const body = { jobId: state.jobId, channelId };
    const sourceMessageId = idOf(state.message?.id);
    const processingMsgId = idOf(state.processingMsg?.id);
    if (sourceMessageId) body.sourceMessageId = sourceMessageId;
    if (processingMsgId) body.processingMsgId = processingMsgId;
    if (state.result) {
      body.resultMsgIds = state.result.resultMsgIds;
      body.postedAt = state.result.postedAt;
      if (state.result.caseId) body.caseId = state.result.caseId;
    }
    if (state.cardMsgId) body.researchCardMsgId = state.cardMsgId;
    try {
      const res = await http.post(apiUrl('/api/bot/posted'), body, { headers: botHeaders(), timeout: HTTP_TIMEOUT_MS });
      if (res?.data?.success !== true) {
        warn(`[Research] 🩹 จด bot-posted job ${shortId(state.jobId)} ไม่สำเร็จ (เซิร์ฟเวอร์ตอบไม่รับ): ${String(res?.data?.error || 'unknown').slice(0, 80)}`);
        return false;
      }
      return true;
    } catch (err) {
      warn(`[Research] 🩹 จด bot-posted job ${shortId(state.jobId)} ไม่สำเร็จ (ไม่กระทบข่าว): ${errText(err)}`);
      return false;
    }
  }

  // ── 6) เตือนโควตา: วันละครั้ง (วันตามเวลาไทย) · ส่งไม่สำเร็จ = ยังไม่นับว่าเตือนแล้ว ──
  async function maybeQuotaAlert(state, { pct, low, account }) {
    const hasPct = Number.isFinite(pct);
    // เจ้าของข้อ 16 "เหลือ 15% ให้เตือน" → เกณฑ์รวมค่าเท่ากัน (เหลือ 15% พอดี = เตือน · 16% = ยัง)
    if (!low && !(hasPct && pct <= quotaAlertPct)) return false;
    const day = bangkokDay(now());
    if (lastQuotaAlertDay === day) return false;
    const channel = state.message?.channel || state.processingMsg?.channel || null;
    if (!channel || typeof channel.send !== 'function') return false;
    const ownerId = ownerOverride || readSnowflake(state.message?.guild?.ownerId);
    lastQuotaAlertDay = day;
    const content = `${ownerId ? `<@${ownerId}> ` : ''}🔋 โควตาเอเจนต์ค้นคว้าเหลือ ${hasPct ? `${Math.round(pct)}%` : 'น้อย'}`
      + `${account ? ` (บัญชี ${safe(account, 20)})` : ''} — ถึงเกณฑ์เตือน ≤${quotaAlertPct}% · สลับบัญชีที่เครื่องเจ้าของ: scripts/research-agent-account.cmd use <ตัวอักษร>`;
    try {
      await channel.send({ content, allowedMentions: ownerId ? { parse: [], users: [ownerId] } : { parse: [] } });
      info(`[Research] 🔋 เตือนโควตาเจ้าของแล้ว (${hasPct ? `${Math.round(pct)}%` : 'QUOTA_LOW'})`);
      return true;
    } catch (err) {
      lastQuotaAlertDay = null;
      warn(`[Research] 🩹 โพสต์เตือนโควตาไม่สำเร็จ: ${errText(err)}`);
      return false;
    }
  }

  // ── ส่งข้อความใต้ข้อความพนักงาน · ข้อความต้นทางถูกลบ → ใต้ข้อความ ack ของบอทแทน ──
  async function replyUnderSource(state, payload) {
    const targets = [state.message, state.processingMsg].filter((m) => m && typeof m.reply === 'function');
    for (const target of targets) {
      try {
        // eslint-disable-next-line no-await-in-loop -- ลองทีละที่ ได้แล้วหยุด
        const sent = await target.reply(payload);
        if (sent && idOf(sent.id)) return sent;
      } catch (err) {
        warn(`[Research] 🩹 ตอบใต้ข้อความ ${String(target.id ?? '?').slice(0, 20)} ไม่ได้: ${errText(err)}`);
      }
    }
    return null;
  }

  // ── 4) โพสต์บัตร ──
  async function deliverCard(state, card) {
    if (state.cardMsgId || isShuttingDown()) return false;
    // กันโพสต์ซ้ำข้าม instance (ช่วง Railway redeploy ทับกัน / งานที่กู้หลังรีสตาร์ต): มีคนจดบัตรของงานนี้ไว้แล้ว = ไม่โพสต์
    const prior = await readPosted(state.jobId);
    const priorCard = idOf(prior?.researchCardMsgId);
    if (priorCard) {
      state.cardMsgId = priorCard;
      info(`[Research] ⏭️ บัตรของ job ${shortId(state.jobId)} โพสต์ไว้แล้ว (msg ${priorCard}) — ไม่โพสต์ซ้ำ`);
      return false;
    }
    if (state.ended || isShuttingDown()) return false;
    const { embed, view } = buildCardEmbed(EmbedBuilder, card, state.jobId);
    const sent = await replyUnderSource(state, { embeds: [embed], allowedMentions: { parse: [], repliedUser: false } });
    if (!sent) return false;
    state.cardMsgId = String(sent.id);
    cardJobByMessage.set(state.cardMsgId, state.jobId);
    if (cardJobByMessage.size > CARD_MAP_MAX) {
      for (const key of [...cardJobByMessage.keys()].slice(0, cardJobByMessage.size - CARD_MAP_MAX)) cardJobByMessage.delete(key);
    }
    if (view.reactable && typeof sent.react === 'function') {
      for (const emoji of Object.keys(FEEDBACK_VOTES)) {
        try {
          // eslint-disable-next-line no-await-in-loop -- ติดตามลำดับ 👍 แล้ว 👎
          await sent.react(emoji);
        } catch (err) {
          warn(`[Research] 🩹 ติด ${emoji} บนบัตรไม่สำเร็จ: ${errText(err)}`);
        }
      }
    }
    info(`[Research] 🧾 โพสต์บัตรข้อเท็จจริง job ${shortId(state.jobId)} · ${view.cardCount} ใบ · ${view.status}${view.shadow ? ' · ทดลอง' : ''}`);
    await writePosted(state);
    const brain = card.brain && typeof card.brain === 'object' ? card.brain : {};
    await maybeQuotaAlert(state, {
      pct: firstFinite(brain.quotaPctAfter),
      low: normalizeFlags(card).has('QUOTA_LOW'),
      account: str(brain.account) || null,
    });
    return true;
  }

  // บัตรโพสต์แล้ว:
  //   · งานยังไม่จบ → เลิกถามแต่ "จอด" ไว้รอจบงาน (ต้องจด caseId/ข้อความผลลง bot-posted ตอนโพสต์ผล) ไม่เกินเพดาน HARD_CAP_MS
  //   · งานจบและเช็คผลแล้ว → เลิกตามทันที
  //   · งานจบแต่ afterJob ยังรอคิวอยู่ (รอบถามที่ค้างอยู่ตอนงานจบเพิ่งเจอบัตร) → ไม่ทำอะไร ให้ afterJob จดผล+บัตรแล้วเลิกตามเอง
  function parkOrEnd(state) {
    if (state.jobEndedAt === null) { schedule(state, Math.max(0, HARD_CAP_MS - (now() - state.startedAt))); return; }
    if (state.resultChecked) endWatch(state, 'card');
  }

  // ── 2) รอบถาม ──
  async function tick(state) {
    if (state.ended) return;
    if (isShuttingDown()) { endWatch(state, 'shutdown'); return; }
    const t = now();
    if (t - state.startedAt >= HARD_CAP_MS) { endWatch(state, 'hard_cap'); return; }
    if (state.cardMsgId) { parkOrEnd(state); return; }
    if (state.tailUntil !== null && t >= state.tailUntil) { endWatch(state, 'tail_done'); return; }
    state.polls++;
    if (state.polls === 1) {
      const st = await readStatus(STATUS_TTL_MS);
      if (st) await maybeQuotaAlert(state, { pct: st.quotaPct, low: st.quotaLow, account: st.account });
    }
    const outcome = await fetchCard(state.jobId);
    if (state.ended) return;
    if (outcome.kind === 'card') {
      await deliverCard(state, outcome.card);
      if (state.cardMsgId) { parkOrEnd(state); return; }
      schedule(state, POLL_MS); // โพสต์ไม่ได้ชั่วคราว (Discord ล้ม) → ลองใหม่รอบหน้า (ยังอยู่ใต้เพดานหาง/HARD_CAP)
      return;
    }
    if (outcome.kind === 'stop') {
      info(`[Research] ⏹️ เลิกตามบัตร job ${shortId(state.jobId)} (${outcome.reason})`);
      endWatch(state, outcome.reason);
      return;
    }
    schedule(state, POLL_MS);
  }

  // ── 3) งานจบ: แยก "โพสต์ผลแล้ว" (ข้อความ ack กลายเป็น ✅) กับ "ล้ม" · เก็บ caseId + id ข้อความผลไว้จด bot-posted ──
  async function collectResult(state) {
    const pm = state.processingMsg;
    if (!pm) return null;
    let fresh = pm;
    if (typeof pm.fetch === 'function') {
      try { fresh = (await pm.fetch()) || pm; } catch { fresh = pm; }
    }
    const content = typeof fresh?.content === 'string' ? fresh.content : '';
    if (!content.startsWith(RESULT_POSTED_PREFIX)) return null;
    const match = content.match(CASE_LINK_RE);
    const resultMsgIds = [];
    const channel = fresh.channel || pm.channel || state.message?.channel || null;
    const sourceId = idOf(state.message?.id);
    const ackId = idOf(pm.id);
    if (channel?.messages && typeof channel.messages.fetch === 'function' && sourceId && ackId) {
      try {
        const page = await channel.messages.fetch({ after: ackId, limit: 100 });
        const list = page && typeof page.values === 'function' ? [...page.values()] : (Array.isArray(page) ? page : []);
        const botId = botUserId() || idOf(pm.author?.id);
        for (const m of list) {
          const id = idOf(m?.id);
          if (!id || id === state.cardMsgId) continue;
          if (botId && idOf(m.author?.id) !== botId) continue;
          if (idOf(m.reference?.messageId) !== sourceId) continue;
          resultMsgIds.push(id);
        }
      } catch (err) {
        warn(`[Research] 🩹 อ่านรายการข้อความผลของ job ${shortId(state.jobId)} ไม่ได้: ${errText(err)}`);
      }
    }
    resultMsgIds.sort(compareSnowflake);
    return { caseId: match ? match[1] : null, resultMsgIds: resultMsgIds.slice(0, MAX_RESULT_MSG_IDS), postedAt: new Date(now()).toISOString() };
  }

  async function afterJob(state) {
    state.result = await collectResult(state);
    state.resultChecked = true;
    if (state.result) await writePosted(state); // มีบัตรแล้ว (จอดรออยู่) = แถวนี้มีทั้งผลข่าวและบัตรครบ
    if (state.ended) return;
    if (state.cardMsgId) { endWatch(state, 'card'); return; }
    // ถามทันที 1 ครั้งตอนจบงาน (ไม่ต้องรอรอบ 20 วิ) — การ์ดมาก่อนผลข่าวจะได้ขึ้นต่อท้ายทันที
    const outcome = await fetchCard(state.jobId);
    if (state.ended) return;
    if (outcome.kind === 'card') {
      await deliverCard(state, outcome.card);
      if (state.cardMsgId) endWatch(state, 'card'); // โพสต์ไม่สำเร็จ = timer รอบถามเดิมยังอยู่ ลองใหม่รอบหน้า
      return;
    }
    if (outcome.kind === 'stop') { endWatch(state, outcome.reason); return; }
    // สเปก 8(3): เครื่องค้นคว้าออฟไลน์ (heartbeat เงียบ > 10 นาที) → ติดป้ายบอกพนักงาน แล้วเลิกตาม (การ์ดจะไม่มาแล้ว)
    const st = await readStatus(0);
    if (st?.offline === true && !state.ended && !state.cardMsgId && !isShuttingDown()) {
      await replyUnderSource(state, { content: OFFLINE_TEXT, allowedMentions: { parse: [], repliedUser: false } });
      info(`[Research] 🔌 รีเสิร์ชออฟไลน์ — ติดป้ายใต้ job ${shortId(state.jobId)}`);
      endWatch(state, 'offline');
    }
  }

  // ── 5) รีแอ็กชัน 👍/👎 บนบัตร ──
  async function handleReaction(reaction, user) {
    if (!enabled) return { ok: false, skipped: 'off' };
    if (!reaction || !user) return { ok: false, skipped: 'no_args' };
    const botId = botUserId();
    if (user.bot === true || (botId && idOf(user.id) === botId)) return { ok: false, skipped: 'bot' };
    const emojiName = typeof reaction === 'string' ? reaction : String(reaction.emoji?.name ?? '');
    const vote = FEEDBACK_VOTES[emojiName];
    if (!vote) return { ok: false, skipped: 'emoji' };
    let message = reaction.message;
    try {
      if (reaction.partial && typeof reaction.fetch === 'function') {
        const full = await reaction.fetch();
        message = full?.message || reaction.message;
      }
      if (message?.partial && typeof message.fetch === 'function') message = await message.fetch();
    } catch (err) {
      warn(`[Research] 🩹 ดึงบัตรที่ถูกกดไม่ได้: ${errText(err)}`);
      return { ok: false, skipped: 'fetch_failed' };
    }
    if (!message) return { ok: false, skipped: 'no_message' };
    if (botId && idOf(message.author?.id) !== botId) return { ok: false, skipped: 'not_ours' };
    const messageId = idOf(message.id);
    const jobId = (messageId && cardJobByMessage.get(messageId)) || jobIdFromCardMessage(message);
    if (!jobId) return { ok: false, skipped: 'not_card' };
    const userId = idOf(user.id);
    if (!userId) return { ok: false, skipped: 'no_user' };
    const body = { jobId, cardId: 'all', vote, userId: `discord-${userId}` };
    const run = async () => {
      try {
        const res = await http.post(apiUrl('/api/research/feedback'), body, { headers: apiHeaders(), timeout: HTTP_TIMEOUT_MS });
        if (res?.data?.success !== true) {
          warn(`[Research] 🩹 บันทึกคะแนนบัตร job ${shortId(jobId)} ไม่สำเร็จ (เซิร์ฟเวอร์ตอบไม่รับ): ${String(res?.data?.error || 'unknown').slice(0, 80)}`);
          return { ok: false, jobId, vote, error: String(res?.data?.error || 'unknown') };
        }
        info(`[Research] ✅ คะแนนบัตร job ${shortId(jobId)} → ${vote} โดย ${userId}`);
        return { ok: true, jobId, vote, userId: body.userId };
      } catch (err) {
        warn(`[Research] 🩹 บันทึกคะแนนบัตร job ${shortId(jobId)} ไม่สำเร็จ: ${errText(err)}`);
        return { ok: false, jobId, vote, error: errText(err) };
      }
    };
    const key = messageId || jobId;
    const chained = (feedbackChains.get(key) || Promise.resolve()).catch(() => {}).then(run);
    feedbackChains.set(key, chained);
    try {
      return await chained;
    } finally {
      if (feedbackChains.get(key) === chained) feedbackChains.delete(key);
    }
  }

  // ── เมธอดสาธารณะ (index.js เรียก — ห้ามโยน error · ไม่ต้องรอ) ──
  return {
    enabled,

    /** แยกลิงก์ → payload.sourceUrls (+ input ที่ตัดลิงก์) · ปิดสวิตช์ = ไม่แตะ payload แม้แต่คีย์เดียว */
    applySourceUrls(payload, content) {
      if (!enabled || !payload || typeof payload !== 'object') return payload;
      try {
        const { sourceUrls, text } = splitSourceUrls(content);
        payload.sourceUrls = sourceUrls;
        if (sourceUrls.length > 0 && text.length >= MIN_TEXT_AFTER_URLS) payload.input = text;
      } catch (err) {
        warn(`[Research] 🩹 แยกลิงก์ไม่สำเร็จ (ส่ง payload เดิม): ${errText(err)}`);
      }
      return payload;
    },

    /** เริ่มตามบัตรของงาน (หลัง ack) · คืน promise ที่ resolve เป็นเหตุผลตอนเลิกตาม (เทสใช้ · index.js ไม่รอ) */
    watch({ jobId, message, processingMsg } = {}) {
      if (!enabled) return null;
      try {
        if (!isJobId(jobId) || !message) return null;
        const existing = watches.get(jobId);
        if (existing && !existing.ended) {
          existing.message = message;
          existing.processingMsg = processingMsg || existing.processingMsg;
          return existing.done;
        }
        evictOldestIfFull();
        const state = {
          jobId,
          message,
          processingMsg: processingMsg || null,
          startedAt: now(),
          jobEndedAt: null,
          resultChecked: false,
          tailUntil: null,
          polls: 0,
          timer: null,
          ended: false,
          endReason: null,
          cardMsgId: null,
          result: null,
          chain: Promise.resolve(),
        };
        state.done = new Promise((resolve) => { state.resolveDone = resolve; });
        watches.set(jobId, state);
        schedule(state, POLL_MS);
        info(`[Research] 🧾 เริ่มตามบัตรข้อเท็จจริง job ${shortId(jobId)}`);
        return state.done;
      } catch (err) {
        warn(`[Research] 🩹 เริ่มตามบัตรไม่สำเร็จ (ไม่กระทบข่าว): ${errText(err)}`);
        return null;
      }
    },

    /** งานจบ (finally ของ processNewsJob / resumeTrackedJob) · ส่งต่อ instance อื่น/กำลังปิดตัว = เลิกตามเงียบๆ */
    jobEnded(jobId, { handedOff = false, shuttingDown = false } = {}) {
      if (!enabled) return null;
      try {
        const state = typeof jobId === 'string' ? watches.get(jobId) : null;
        if (!state || state.ended || state.jobEndedAt !== null) return null;
        if (handedOff) { endWatch(state, 'handed_off'); return null; }
        if (shuttingDown || isShuttingDown()) { endWatch(state, 'shutdown'); return null; }
        state.jobEndedAt = now();
        state.tailUntil = state.jobEndedAt + TAIL_MS;
        return enqueue(state, () => afterJob(state));
      } catch (err) {
        warn(`[Research] 🩹 จบงานฝั่งบัตรไม่สำเร็จ (ไม่กระทบข่าว): ${errText(err)}`);
        return null;
      }
    },

    handleReaction,

    // สำหรับเทส/ดีบัก
    activeJobIds: () => [...watches.keys()],
  };
}

module.exports = {
  createResearchCards,
  splitSourceUrls,
  pickCardRecord,
  parseStatus,
  buildCardView,
  buildCardEmbed,
  jobIdFromCardMessage,
  constants: Object.freeze({
    POLL_MS, TAIL_MS, HARD_CAP_MS, STATUS_TTL_MS, MIN_TEXT_AFTER_URLS, MAX_SOURCE_URLS, MAX_RESULT_MSG_IDS,
    CARD_TITLE, SHADOW_TAG, SHADOW_LEAD, RESULT_POSTED_PREFIX, OFFLINE_TEXT, DEFAULT_QUOTA_ALERT_PCT,
  }),
};
