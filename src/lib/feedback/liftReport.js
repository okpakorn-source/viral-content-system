/**
 * liftReport.js — รายงาน "lift" ของผลจริงจากเพจ ต่อมิติ: การ์ด · ครู · ความยาว · วิธีเปิดเรื่อง
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ 2 ก.ย. 69 (ข้อ 5 ป้อนกลับผลจริง): อ่านโพสต์จริง (store 'post-metrics' ที่ scripts/import-fb-metrics.mjs นำเข้า)
 *   + generation_logs (ช่วงวันที่ของโพสต์ ±3 วัน · แบ่งหน้า) + สมุดครู viral_pick_history (ช่วงเดียวกัน)
 *   → จับคู่เวอร์ชัน↔โพสต์ (postMatch.js) → คำนวณต่อกลุ่ม: n · ค่ากลาง · เฉลี่ย · ≥50k% · lift = ค่ากลางกลุ่ม / ค่ากลางทั้งเพจ
 *   กลุ่มที่ n < 5 = "ยังสรุปไม่ได้" ต้องรายงานแยก ห้ามนำไปเรียงอันดับ
 *
 * ไฟล์นี้ import แค่ ./postMatch.js — ตัวอ่านฐานข้อมูลรับ `sb` (Supabase client) จากผู้เรียก
 *   (route ใช้ getSupabase() · สคริปต์สร้างเอง · เทสส่งตัวปลอม) จึงไม่แตะเครือข่ายเองเลย
 * ★ 2 ก.ย. 69 รอบแก้ผู้ตรวจ: ตัวอ่านแบ่งหน้าทุกตัวมีคีย์เรียงสำรองที่ไม่ซ้ำ (แถวนำเข้ารอบเดียวมี created_at เท่ากันหมด → range() ซ้ำ/หล่นแถวเงียบๆ)
 *   · กลุ่มว่าง lift = null (ไม่ใช่ ×0.00) · versionWords นับด้วย Segmenter เสมอ · คีย์หัวข่าวจับสมุดครู 120 ตัว (สมุดเก็บตัดดิบ 140)
 */
import { DEFAULT_MATCH_THRESHOLD, matchPosts, parseFbTime, toNumber } from './postMatch.js';

export const DEFAULT_MIN_N = 5;
export const DEFAULT_PAD_DAYS = 3;
export const DEFAULT_PICK_GAP_DAYS = 2;
export const BIG_HIT_REACTIONS = 50000;
export const POST_METRICS_STORE = 'post-metrics';
export const PICK_HISTORY_STORE = 'viral_pick_history';
export const GENERATION_TABLE = 'generation_logs';
export const UNKNOWN_CARD = '(ไม่ระบุการ์ด)';

/** ช่วงความยาว (จำนวนคำของโพสต์จริง) — ขอบล่างรวม ขอบบนไม่รวม */
export const LENGTH_BANDS = Object.freeze([
  Object.freeze({ key: '0-170', min: 0, max: 170 }),
  Object.freeze({ key: '170-200', min: 170, max: 200 }),
  Object.freeze({ key: '200-230', min: 200, max: 230 }),
  Object.freeze({ key: '230-270', min: 230, max: 270 }),
  Object.freeze({ key: '270+', min: 270, max: Infinity }),
]);

export const OPENING_TYPES = Object.freeze(['คำพูด', 'ตัวเลข', 'ชื่อ+การกระทำ', 'ภาพ', 'อื่นๆ']);

const DAY_MS = 86400 * 1000;
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

// ─── ข้อความ: นับคำ / ช่วงความยาว / วิธีเปิดเรื่อง ───────────────────────────

let _segmenter;
/** นับคำไทยด้วย Intl.Segmenter (วิธีเดียวกับตัววิเคราะห์ CSV ต้นแบบ) · ไม่มี Segmenter = นับช่วงช่องว่าง (หยาบ) */
export function countWords(text) {
  const s = String(text ?? '').trim();
  if (!s) return 0;
  if (_segmenter === undefined) {
    try { _segmenter = new Intl.Segmenter('th', { granularity: 'word' }); } catch { _segmenter = null; }
  }
  if (!_segmenter) return s.split(/\s+/).filter(Boolean).length;
  let n = 0;
  for (const seg of _segmenter.segment(s)) if (seg.isWordLike) n++;
  return n;
}

export function lengthBand(words) {
  const w = toNumber(words);
  const band = LENGTH_BANDS.find((b) => w >= b.min && w < b.max) || LENGTH_BANDS[LENGTH_BANDS.length - 1];
  return band.key;
}

const OPEN_QUOTE_RE = /^["“‘'«]/;
const EARLY_QUOTE_RE = /^[^\n]{0,12}["“][^"”\n]{4,}["”]/;
const EARLY_NUMBER_RE = /^[^\n]{0,15}\d/;
// คำบอกตัวคน — ตัดคำสั้นที่เป็นเศษของคำอื่น (ตา→ตาม/ตาย · ยาย→ขยาย · น้า→หน้า) และกันเศษที่พบบ่อย (ป้าย · คุณภาพ · อย่า)
const PERSON_MARK_RE = /(คุณ(?!ภาพ|ค่า|สมบัติ|ลักษณะ)|นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|น้อง|พี่|ลุง|ป้า(?!ย)|คุณตา|คุณยาย|ตายาย|หนุ่ม|สาว|เด็ก|ครู|หมอ|พยาบาล|ตำรวจ|ทหาร|ดารา|นักร้อง|นักแสดง|พระ|หลวง|ดร\.|แม่|พ่อ|ปู่|(?<!อ)ย่า)/;
const SCENE_OPEN_RE = /^(ภาพ|วินาที|นาที|ท่ามกลาง|กลาง(ดึก|คืน|วัน|ถนน|ฝน|แดด|ป่า|ทะเล)|เช้า|สาย|บ่าย|เย็น|ค่ำ|ดึก|บน|ใน|ที่|ริม|หน้า|หลัง|ข้าง|ระหว่าง|ตอน|คืน|วัน|เสียง|แสง|ฝน|ถนน)/;

/**
 * จำแนกวิธีเปิดเรื่องจากต้นข้อความด้วย regex ง่ายๆ (ลำดับ: คำพูด → ตัวเลข → ชื่อ+การกระทำ → ภาพ → อื่นๆ)
 * · คำพูด = ขึ้นต้นด้วยเครื่องหมายคำพูด หรือมีคำพูดในอักษร 12 ตัวแรก
 * · ตัวเลข = มีตัวเลขในอักษร 15 ตัวแรก · ชื่อ+การกระทำ = มีคำบอกตัวคน (คุณ/นาย/น้อง/ลุง/ป้า…) ใน 40 ตัวแรก
 * · ภาพ = ขึ้นต้นด้วยคำบอกฉาก/เวลา/สถานที่ (ภาพ/วินาที/ท่ามกลาง/กลางดึก/ริม/หน้า…)
 */
export function openingType(text) {
  const t = String(text ?? '').trim();
  if (!t) return 'อื่นๆ';
  if (OPEN_QUOTE_RE.test(t) || EARLY_QUOTE_RE.test(t)) return 'คำพูด';
  if (EARLY_NUMBER_RE.test(t)) return 'ตัวเลข';
  if (PERSON_MARK_RE.test(t.slice(0, 40))) return 'ชื่อ+การกระทำ';
  if (SCENE_OPEN_RE.test(t)) return 'ภาพ';
  return 'อื่นๆ';
}

// ─── สถิติ ───────────────────────────────────────────────────────────────────

export function median(values) {
  const v = (values || []).map(toNumber).sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function mean(values) {
  const v = (values || []).map(toNumber);
  if (!v.length) return 0;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function _ranks(values) {
  const n = values.length;
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && order[j + 1][0] === order[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k][1]] = avg;
    i = j + 1;
  }
  return ranks;
}

/** สหสัมพันธ์อันดับ Spearman (−1..1) · n < 3 หรือค่าไม่แปรผัน = null */
export function spearman(xs, ys) {
  const n = Math.min(xs?.length || 0, ys?.length || 0);
  if (n < 3) return null;
  const rx = _ranks(xs.slice(0, n).map(toNumber));
  const ry = _ranks(ys.slice(0, n).map(toNumber));
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i] - mx;
    const b = ry[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (!dx || !dy) return null;
  return round3(num / Math.sqrt(dx * dy));
}

/** สถิติต่อกลุ่ม + lift เทียบค่ากลาง/เฉลี่ยของฐาน (ทั้งเพจ) · n < minN = insufficient (ยังสรุปไม่ได้) */
export function groupStats(values, baseline = {}, minN = DEFAULT_MIN_N) {
  const v = (values || []).map(toNumber);
  const n = v.length;
  const med = median(v);
  const avg = mean(v);
  const big = n ? (v.filter((x) => x >= BIG_HIT_REACTIONS).length / n) * 100 : 0;
  return {
    n,
    median: med,
    mean: Math.round(avg),
    bigHitPct: round1(big),
    // กลุ่มว่าง (n=0) ต้อง null ไม่ใช่ 0 — median([]) = 0 จะทำให้รายงานพิมพ์ "lift ×0.00" ทั้งที่ไม่มีข้อมูล (fmtLift มีทาง '—' รองรับ)
    lift: n > 0 && toNumber(baseline.median) > 0 ? round2(med / toNumber(baseline.median)) : null,
    liftMean: n > 0 && toNumber(baseline.mean) > 0 ? round2(avg / toNumber(baseline.mean)) : null,
    insufficient: n < minN,
  };
}

// ─── รูปข้อมูล: โพสต์ / เคส / สมุดครู ────────────────────────────────────────

/** โพสต์จาก CSV หรือ store → รูปเดียวกัน · ตัดโพสต์ไม่มีข้อความ · ตัดนอกหน้าต่างเวลา (ถ้ารู้เวลา) */
export function normalizePosts(posts, window = null) {
  const out = [];
  for (const raw of Array.isArray(posts) ? posts : []) {
    if (!raw) continue;
    const postId = String(raw.postId ?? raw.id ?? '').trim();
    const text = String(raw.text ?? '').trim();
    if (!postId || !text) continue;
    const publishedAt = raw.publishedAt || parseFbTime(raw.time) || null;
    if (window && publishedAt) {
      if (window.from && publishedAt < window.from) continue;
      if (window.to && publishedAt > window.to) continue;
    }
    out.push({
      postId,
      text,
      time: raw.time ?? null,
      publishedAt,
      type: raw.type ?? '',
      reactions: toNumber(raw.reactions),
      comments: toNumber(raw.comments),
      shares: toNumber(raw.shares),
      reach: toNumber(raw.reach),
      views: toNumber(raw.views),
    });
  }
  return out;
}

/** แถว generation_logs (snake_case จาก Supabase · camelCase จากไฟล์ local · promptName/promptId ที่ PostgREST ตั้งชื่อจาก pipeline_info->) → รูปเดียว */
export function normalizeGeneration(row) {
  if (!row || typeof row !== 'object') return null;
  const pi = row.pipeline_info || row.pipelineInfo || {};
  const caseId = String(row.case_id ?? row.caseId ?? '').trim();
  if (!caseId) return null;
  const createdAt = row.created_at || row.createdAt || null;
  return {
    caseId,
    createdAt,
    newsTitle: String(row.news_title ?? row.newsTitle ?? ''),
    promptName: String(pi.promptName || row.promptName || ''),
    promptId: String(pi.promptId || row.promptId || ''),
    versions: Array.isArray(row.versions) ? row.versions : [],
  };
}

/** เวอร์ชันทุกใบ → candidate สำหรับ matchPosts (id = เคส#ลำดับ) + ข้อมูลประกอบ (การ์ด/เวลา/หัวข่าว) */
export function buildCandidates(generations) {
  const candidates = [];
  const metaById = new Map();
  const cardNames = new Map();
  const idsByName = new Map();
  for (const g of generations) {
    if (!g.promptId || !g.promptName) continue;
    if (!cardNames.has(g.promptId)) cardNames.set(g.promptId, g.promptName);
    let ids = idsByName.get(g.promptName);
    if (!ids) { ids = new Set(); idsByName.set(g.promptName, ids); }
    ids.add(g.promptId);
  }
  // ชื่อการ์ดซ้ำกันคนละ id (การ์ดถูกแก้แล้วบันทึกใบใหม่) → ต่อท้ายเศษ id ให้แยกแถวในรายงานได้ ไม่งั้นเห็นชื่อเดียวกัน 2 แถวโดยไม่รู้ว่าใบไหน
  const labelFor = (key, name) => {
    if (!name) return key;
    if ((idsByName.get(name)?.size || 0) > 1 && key !== name) return `${name} [${String(key).slice(0, 8)}]`;
    return name;
  };
  for (const g of generations) {
    g.versions.forEach((v, i) => {
      const content = String(v?.content ?? '').trim();
      if (!content) return;
      const id = `${g.caseId}#${i}`;
      const versionPromptId = String(v?.promptId || '');
      const cardKey = versionPromptId || g.promptId || g.promptName || UNKNOWN_CARD;
      const cardName = labelFor(cardKey, (versionPromptId && cardNames.get(versionPromptId)) || g.promptName || '');
      candidates.push({ id, text: content });
      metaById.set(id, {
        caseId: g.caseId,
        versionIndex: i,
        createdAt: g.createdAt,
        newsTitle: g.newsTitle,
        cardKey,
        cardName,
        // นับด้วยตัวเดียวกับ words ของโพสต์จริงเสมอ — v.wordCount ของ generationLogger นับด้วยช่องว่าง (ไทย ≈ ¼ ของ Segmenter) ปนกันแล้วเทียบข้ามแถวไม่ได้
        versionWords: countWords(content),
      });
    });
  }
  return { candidates, metaById, cardNames };
}

/**
 * คีย์หัวข่าวสำหรับจับสมุดครู: ลบ zero-width → ยุบช่องว่าง → ตัด TITLE_KEY_LEN
 * สมุดครูเก็บ newsTitle แบบ "ตัดดิบ 140 ก่อนยุบช่องว่าง" (viralFewshot._recordPickHistory) ส่วนเคสเก็บเต็ม
 * → ถ้าตัดคีย์ที่ 140 เท่าเพดานเก็บ หัวข่าวยาวที่มีช่องว่างซ้ำ/ขึ้นบรรทัดใน 140 ตัวแรกจะยาวไม่เท่ากันหลังยุบ = จับไม่ติดทั้งที่เป็นเคสเดียวกัน
 *   จึงตัดคีย์ให้สั้นกว่าเพดานเก็บ 20 ตัว (เผื่อช่องว่างซ้ำ/ขึ้นบรรทัดได้ถึง 20 จุดในต้นหัวข่าว — ผู้ตรวจ 2 ก.ย. 69)
 */
export const TITLE_KEY_LEN = 120;
export function normalizeTitle(value) {
  return String(value ?? '')
    .replace(/[\u200B-\u200F\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TITLE_KEY_LEN);
}

/**
 * จับสมุดครู (viral_pick_history: { ts, newsTitle, picks:[{id,title}] }) เข้ากับเคส ด้วยหัวข่าวเดียวกัน
 * และเวลาห่างกันไม่เกิน maxGapDays (หัวข่าวซ้ำคนละสัปดาห์ = คนละเคส) · หลายแถวต่อเคส (หลายมุม) = รวมครูไม่ซ้ำ
 * → Map caseId → [{ id, title }]
 */
export function linkPickHistory(generations, pickRows, { maxGapDays = DEFAULT_PICK_GAP_DAYS } = {}) {
  const byTitle = new Map();
  for (const raw of Array.isArray(pickRows) ? pickRows : []) {
    const row = raw?.data && typeof raw.data === 'object' && !raw.picks ? raw.data : raw;
    if (!row || !Array.isArray(row.picks) || !row.picks.length) continue;
    const key = normalizeTitle(row.newsTitle);
    if (!key) continue;
    const ts = Date.parse(row.ts || row.createdAt || '');
    let list = byTitle.get(key);
    if (!list) { list = []; byTitle.set(key, list); }
    list.push({ ts: Number.isFinite(ts) ? ts : null, picks: row.picks });
  }
  const out = new Map();
  if (!byTitle.size) return out;
  const maxGapMs = maxGapDays * DAY_MS;
  for (const g of generations) {
    const rows = byTitle.get(normalizeTitle(g.newsTitle));
    if (!rows) continue;
    const created = Date.parse(g.createdAt || '');
    const seen = new Map();
    for (const r of rows) {
      if (r.ts != null && Number.isFinite(created) && Math.abs(r.ts - created) > maxGapMs) continue;
      for (const p of r.picks) {
        const id = String(p?.id ?? p?.title ?? '').trim();
        if (!id || seen.has(id)) continue;
        seen.set(id, { id, title: String(p?.title || id) });
      }
    }
    if (seen.size) out.set(g.caseId, [...seen.values()]);
  }
  return out;
}

// ─── สร้างรายงาน ─────────────────────────────────────────────────────────────

function _buildDimension(records, keysOf, baseline, minN) {
  const groups = new Map();
  for (const r of records) {
    for (const { key, label } of keysOf(r)) {
      let g = groups.get(key);
      if (!g) { g = { key, label, values: [], cases: new Set() }; groups.set(key, g); }
      g.values.push(r.reactions);
      g.cases.add(r.caseId);
    }
  }
  const all = [...groups.values()].map((g) => ({
    key: g.key,
    label: g.label,
    cases: g.cases.size,
    ...groupStats(g.values, baseline, minN),
  }));
  const byLift = (a, b) => (b.lift ?? -1) - (a.lift ?? -1) || b.n - a.n || String(a.label).localeCompare(String(b.label), 'th');
  const ranked = all.filter((g) => !g.insufficient).sort(byLift);
  const insufficient = all.filter((g) => g.insufficient).sort((a, b) => b.n - a.n || String(a.label).localeCompare(String(b.label), 'th'));
  return {
    records: records.length,
    groups: [...ranked, ...insufficient],
    ranked,
    insufficient: insufficient.map(({ key, label, n, median: med }) => ({ key, label, n, median: med })),
  };
}

function _windowFromPosts(posts) {
  let from = null;
  let to = null;
  for (const p of posts) {
    if (!p.publishedAt) continue;
    if (!from || p.publishedAt < from) from = p.publishedAt;
    if (!to || p.publishedAt > to) to = p.publishedAt;
  }
  return from && to ? { from, to } : null;
}

function _daysBetween(from, to) {
  const a = Date.parse(from || '');
  const b = Date.parse(to || '');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(1, Math.round((b - a) / DAY_MS));
}

/**
 * buildLiftReport({ posts, generations, pickHistory, threshold, minN, window, now }) → report (JSON ล้วน)
 * · posts = โพสต์จริงทั้งเพจในช่วง (ฐานเทียบ) · generations = แถว generation_logs · pickHistory = แถวสมุดครู
 * · ไม่แตะเครือข่าย — ผู้เรียกจัดหาข้อมูลเอง (runLiftReport ด้านล่างทำให้)
 */
export function buildLiftReport({
  posts = [],
  generations = [],
  pickHistory = [],
  threshold = DEFAULT_MATCH_THRESHOLD,
  minN = DEFAULT_MIN_N,
  window = null,
  now = new Date(),
  padDays = DEFAULT_PAD_DAYS,
  pickGapDays = DEFAULT_PICK_GAP_DAYS,
} = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const pagePosts = normalizePosts(posts, window);
  const effectiveWindow = window || _windowFromPosts(pagePosts);
  const gens = (Array.isArray(generations) ? generations : []).map(normalizeGeneration).filter(Boolean);
  const { candidates, metaById } = buildCandidates(gens);
  const matches = matchPosts(pagePosts, candidates, { threshold });
  const picksByCase = linkPickHistory(gens, pickHistory, { maxGapDays: pickGapDays });
  const postById = new Map(pagePosts.map((p) => [p.postId, p]));

  const links = [];
  for (const [candId, m] of Object.entries(matches)) {
    const meta = metaById.get(candId);
    const post = postById.get(m.postId);
    if (!meta || !post) continue;
    const words = countWords(post.text);
    links.push({
      caseId: meta.caseId,
      versionIndex: meta.versionIndex,
      postId: post.postId,
      sim: m.sim,
      reactions: post.reactions,
      comments: post.comments,
      shares: post.shares,
      reach: post.reach,
      views: post.views,
      publishedAt: post.publishedAt,
      words,
      versionWords: meta.versionWords,
      band: lengthBand(words),
      opening: openingType(post.text),
      cardKey: meta.cardKey,
      cardName: meta.cardName,
      teachers: picksByCase.get(meta.caseId) || [],
    });
  }
  links.sort((a, b) => b.reactions - a.reactions || a.caseId.localeCompare(b.caseId));

  const pageValues = pagePosts.map((p) => p.reactions);
  const page = { posts: pagePosts.length, ...groupStats(pageValues, {}, 0) };
  delete page.lift;
  delete page.liftMean;
  delete page.insufficient;
  const baseline = { median: page.median, mean: page.mean };
  const matched = {
    versions: links.length,
    posts: new Set(links.map((l) => l.postId)).size,
    cases: new Set(links.map((l) => l.caseId)).size,
    ...groupStats(links.map((l) => l.reactions), baseline, minN),
  };

  const pickRowsInWindow = (Array.isArray(pickHistory) ? pickHistory : []).length;
  const dimensions = {
    card: _buildDimension(links, (r) => [{ key: r.cardKey, label: r.cardName }], baseline, minN),
    teacher: _buildDimension(links, (r) => r.teachers.map((t) => ({ key: t.id, label: t.title })), baseline, minN),
    length: _buildDimension(links, (r) => [{ key: r.band, label: `${r.band} คำ` }], baseline, minN),
    opening: _buildDimension(links, (r) => [{ key: r.opening, label: r.opening }], baseline, minN),
  };
  dimensions.teacher.coverage = links.filter((l) => l.teachers.length).length;
  dimensions.teacher.pickRows = pickRowsInWindow;
  // ความยาวเรียงตามช่วง ไม่ใช่ตาม lift (อ่านง่ายกว่า) — ranked/insufficient ยังแยกตาม n ตามกติกาเดิม
  const bandOrder = new Map(LENGTH_BANDS.map((b, i) => [b.key, i]));
  dimensions.length.groups.sort((a, b) => (bandOrder.get(a.key) ?? 99) - (bandOrder.get(b.key) ?? 99));

  const correlation = {
    lengthVsReactionsPage: spearman(pagePosts.map((p) => countWords(p.text)), pageValues),
    lengthVsReactionsMatched: spearman(links.map((l) => l.words), links.map((l) => l.reactions)),
  };

  const notes = [];
  if (!pagePosts.length) notes.push('ไม่มีโพสต์ในช่วงนี้ — นำเข้า CSV ก่อน (scripts/import-fb-metrics.mjs)');
  if (!candidates.length) notes.push('ไม่มีเวอร์ชันของระบบในช่วงนี้ (generation_logs ว่าง)');
  if (!pickRowsInWindow) notes.push('ไม่มีสมุดประวัติครู (viral_pick_history) ในช่วงนี้ — มิติครูจึงว่าง (สมุดเริ่มจด 8 ส.ค. 69)');
  else if (!dimensions.teacher.coverage) notes.push('มีสมุดครูแต่จับกับเคสไม่ได้ (หัวข่าวไม่ตรง/เวลาห่างเกิน 2 วัน) — มิติครูจึงว่าง');
  for (const [name, label] of [['card', 'การ์ด'], ['teacher', 'ครู'], ['length', 'ความยาว'], ['opening', 'วิธีเปิดเรื่อง']]) {
    const dim = dimensions[name];
    if (dim.insufficient.length) {
      notes.push(`${label}: ${dim.insufficient.length} กลุ่มมี n < ${minN} ยังสรุปไม่ได้ (${dim.insufficient.slice(0, 5).map((g) => `${g.label} n=${g.n}`).join(' · ')}${dim.insufficient.length > 5 ? ' · …' : ''})`);
    }
  }

  return {
    generatedAt: nowDate.toISOString(),
    window: {
      from: effectiveWindow?.from || null,
      to: effectiveWindow?.to || null,
      days: effectiveWindow ? _daysBetween(effectiveWindow.from, effectiveWindow.to) : null,
      padDays,
    },
    params: { threshold, minN, bigHitReactions: BIG_HIT_REACTIONS, pickGapDays },
    page,
    matched,
    input: { generations: gens.length, versions: candidates.length, pickRows: pickRowsInWindow },
    correlation,
    dimensions,
    notes,
    links,
  };
}

// ─── Markdown ────────────────────────────────────────────────────────────────

const fmtInt = (n) => Math.round(toNumber(n)).toLocaleString('en-US');
const fmtLift = (x) => (x == null ? '—' : `×${x.toFixed(2)}`);
const fmtPct = (x) => `${toNumber(x).toFixed(1)}%`;
const fmtRho = (x) => (x == null ? 'คำนวณไม่ได้' : x.toFixed(3));
const fmtDate = (iso) => (iso ? String(iso).slice(0, 10) : '?');
const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\r?\n/g, ' ');

function _dimensionMarkdown(title, dim, unitLabel, minN) {
  const lines = [`## ${title}`, ''];
  if (!dim.records) {
    lines.push('ไม่มีข้อมูลในมิตินี้', '');
    return lines;
  }
  if (dim.ranked.length) {
    lines.push(`| ${unitLabel} | n | เคส | ค่ากลางไลก์ | เฉลี่ย | ≥50k | lift (ค่ากลาง) | lift (เฉลี่ย) |`);
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
    const rows = title.startsWith('ความยาว') ? dim.groups.filter((g) => !g.insufficient) : dim.ranked;
    for (const g of rows) {
      lines.push(`| ${cell(g.label)} | ${g.n} | ${g.cases} | ${fmtInt(g.median)} | ${fmtInt(g.mean)} | ${fmtPct(g.bigHitPct)} | ${fmtLift(g.lift)} | ${fmtLift(g.liftMean)} |`);
    }
  } else {
    lines.push(`ไม่มีกลุ่มไหนมี n ≥ ${minN} — ยังสรุปมิตินี้ไม่ได้`);
  }
  if (dim.insufficient.length) {
    lines.push('', `**ยังสรุปไม่ได้ (n < ${minN})**: ${dim.insufficient.map((g) => `${cell(g.label)} (n=${g.n}, ค่ากลาง ${fmtInt(g.median)})`).join(' · ')}`);
  }
  lines.push('');
  return lines;
}

export function renderLiftMarkdown(report) {
  const r = report || {};
  const p = r.params || {};
  const page = r.page || {};
  const m = r.matched || {};
  const w = r.window || {};
  const c = r.correlation || {};
  const d = r.dimensions || {};
  const minN = p.minN ?? DEFAULT_MIN_N;
  const lines = [
    '# LIFT REPORT — ผลจริงจากเพจ เทียบสิ่งที่ระบบเขียน',
    '',
    `สร้างเมื่อ ${r.generatedAt || '?'} · ช่วงโพสต์ ${fmtDate(w.from)} – ${fmtDate(w.to)} (${w.days ?? '?'} วัน · เคสของระบบ ±${w.padDays ?? DEFAULT_PAD_DAYS} วัน) · เกณฑ์จับคู่ ≥ ${p.threshold ?? DEFAULT_MATCH_THRESHOLD} · กลุ่มต้องมี n ≥ ${minN} จึงสรุป`,
    '',
    '## ภาพรวม',
    '',
    `- โพสต์ทั้งเพจ (ฐานเทียบ) ${fmtInt(page.posts)} โพสต์ · ค่ากลางไลก์ ${fmtInt(page.median)} · เฉลี่ย ${fmtInt(page.mean)} · ≥50k ${fmtPct(page.bigHitPct)}`,
    `- เวอร์ชันของระบบ ${fmtInt(r.input?.versions)} ใบ (${fmtInt(r.input?.generations)} เคส) → จับคู่กับโพสต์จริงได้ ${fmtInt(m.versions)} ใบ = ${fmtInt(m.posts)} โพสต์ / ${fmtInt(m.cases)} เคส`,
    `- โพสต์ที่ระบบเขียน: ค่ากลางไลก์ ${fmtInt(m.median)} (lift ${fmtLift(m.lift)} เทียบทั้งเพจ) · เฉลี่ย ${fmtInt(m.mean)} (${fmtLift(m.liftMean)}) · ≥50k ${fmtPct(m.bigHitPct)}`,
    `- Spearman ความยาว↔ไลก์: ทั้งเพจ ρ=${fmtRho(c.lengthVsReactionsPage)} · เฉพาะที่ระบบเขียน ρ=${fmtRho(c.lengthVsReactionsMatched)}`,
    '',
    '> lift = ค่ากลางไลก์ของกลุ่ม ÷ ค่ากลางไลก์ทั้งเพจ (×1.00 = เท่าเพจ) · กลุ่มที่ n < ' + minN + ' อยู่ท้ายแต่ละมิติ ห้ามนำไปสรุป',
    '',
  ];
  lines.push(..._dimensionMarkdown('การ์ด (promptName/promptId ของเคส)', d.card || { records: 0 }, 'การ์ด', minN));
  const teacherDim = d.teacher || { records: 0 };
  const teacherLines = _dimensionMarkdown('ครู (จากสมุด viral_pick_history — จับด้วยหัวข่าว)', teacherDim, 'ครู', minN);
  if (teacherDim.records && !teacherDim.coverage) {
    teacherLines.splice(2, teacherLines.length - 2, `เคสที่จับคู่ได้ ${teacherDim.records} ใบ แต่ไม่มีใบไหนมีสมุดครูในช่วงนี้ (แถวสมุด ${teacherDim.pickRows ?? 0}) — ยังสรุปมิติครูไม่ได้`, '');
  }
  lines.push(...teacherLines);
  lines.push(..._dimensionMarkdown('ความยาว (จำนวนคำของโพสต์จริง)', d.length || { records: 0 }, 'ช่วงคำ', minN));
  lines.push(..._dimensionMarkdown('วิธีเปิดเรื่อง (regex ต้นข้อความของโพสต์จริง)', d.opening || { records: 0 }, 'วิธีเปิด', minN));
  lines.push('## หมายเหตุ', '');
  for (const n of r.notes || []) lines.push(`- ${n}`);
  if (!(r.notes || []).length) lines.push('- (ไม่มี)');
  lines.push('', '---', '', `รายละเอียดต่อเคส (${fmtInt((r.links || []).length)} คู่) อยู่ใน lift-report.json → links`, '');
  return lines.join('\n');
}

// ─── อ่านข้อมูลจาก Supabase (แบ่งหน้า) — sb ถูกส่งเข้ามา ไม่สร้างเอง ─────────

/** วนดึงทีละหน้าจนหมด · หน้าไหน error = throw (ห้ามส่งรายงานจากข้อมูลครึ่งเดียวแบบเงียบๆ) */
export async function pageAll(makeQuery, { pageSize = 500, maxPages = 40, label = 'rows' } = {}) {
  const rows = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    // eslint-disable-next-line no-await-in-loop -- แต่ละหน้าบอกเองว่าต้องดึงหน้าถัดไปไหม
    const res = await makeQuery(from, from + pageSize - 1);
    if (res?.error) throw new Error(`${label}: ${res.error.message || 'read error'}`);
    const data = Array.isArray(res?.data) ? res.data : [];
    rows.push(...data);
    if (data.length < pageSize) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

export function padWindow(window, padDays = DEFAULT_PAD_DAYS) {
  if (!window?.from || !window?.to) return null;
  const pad = toNumber(padDays) * DAY_MS;
  return {
    from: new Date(Date.parse(window.from) - pad).toISOString(),
    to: new Date(Date.parse(window.to) + pad).toISOString(),
  };
}

export async function loadPostMetrics(sb, { window = null, store = POST_METRICS_STORE, pageSize, maxPages } = {}) {
  const { rows, truncated } = await pageAll((from, to) => {
    let q = sb.from('store_items').select('data').eq('store_name', store);
    if (window?.from) q = q.gte('data->>publishedAt', window.from);
    if (window?.to) q = q.lte('data->>publishedAt', window.to);
    // คีย์เรียงสำรอง id (ไม่ซ้ำใน store เดียว): แถวจากการนำเข้าครั้งเดียว created_at เท่ากันหมด → Postgres ไม่รับประกันลำดับข้าม range() ต่างค่า
    return q.order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to);
  }, { pageSize, maxPages, label: `store ${store}` });
  return { posts: rows.map((r) => r?.data).filter(Boolean), truncated };
}

export async function loadGenerations(sb, window, { table = GENERATION_TABLE, pageSize, maxPages } = {}) {
  if (!window?.from || !window?.to) return { generations: [], truncated: false };
  const { rows, truncated } = await pageAll((from, to) => sb
    .from(table)
    .select('case_id,created_at,news_title,versions,pipeline_info->promptName,pipeline_info->promptId')
    .gte('created_at', window.from)
    .lte('created_at', window.to)
    .order('created_at', { ascending: true })
    .order('case_id', { ascending: true }) // คีย์สำรองไม่ซ้ำ (case_id UNIQUE — scripts/create-generation-logs-table.sql) กันหน้าซ้ำ/หล่นเมื่อ created_at เท่ากัน
    .range(from, to), { pageSize, maxPages, label: table });
  return { generations: rows, truncated };
}

export async function loadPickHistory(sb, window, { store = PICK_HISTORY_STORE, pageSize, maxPages } = {}) {
  if (!window?.from || !window?.to) return { pickHistory: [], truncated: false };
  const { rows, truncated } = await pageAll((from, to) => sb
    .from('store_items')
    .select('data')
    .eq('store_name', store)
    .gte('created_at', window.from)
    .lte('created_at', window.to)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true }) // คีย์สำรองไม่ซ้ำใน store เดียว
    .range(from, to), { pageSize, maxPages, label: `store ${store}` });
  return { pickHistory: rows.map((r) => r?.data).filter(Boolean), truncated };
}

/**
 * loadLiftInputs(sb, { window, posts, padDays }) → { posts, generations, pickHistory, window, generationWindow, truncated }
 * · ไม่ส่ง posts = อ่านจาก store post-metrics (กรองด้วย window ถ้ามี) · ไม่มี window = ใช้ช่วงเวลาของโพสต์ที่อ่านได้
 * · เคส/สมุดครู อ่านช่วง window ±padDays
 */
export async function loadLiftInputs(sb, { window = null, posts = null, padDays = DEFAULT_PAD_DAYS, pageSize, maxPages } = {}) {
  if (!sb && !posts) throw new Error('ไม่มี Supabase client และไม่มีโพสต์ที่ส่งเข้ามา');
  const truncated = {};
  let rawPosts = posts;
  if (!rawPosts) {
    const r = await loadPostMetrics(sb, { window, pageSize, maxPages });
    rawPosts = r.posts;
    truncated.posts = r.truncated;
  }
  const cleanPosts = normalizePosts(rawPosts, window);
  const effectiveWindow = window || _windowFromPosts(cleanPosts);
  const generationWindow = padWindow(effectiveWindow, padDays);
  let generations = [];
  let pickHistory = [];
  if (sb && generationWindow) {
    const g = await loadGenerations(sb, generationWindow, { pageSize, maxPages });
    generations = g.generations;
    truncated.generations = g.truncated;
    const h = await loadPickHistory(sb, generationWindow, { pageSize, maxPages });
    pickHistory = h.pickHistory;
    truncated.pickHistory = h.truncated;
  }
  return { posts: cleanPosts, generations, pickHistory, window: effectiveWindow, generationWindow, truncated };
}

/**
 * runLiftReport({ sb, days, threshold, minN, padDays, now, posts }) → { report, markdown }
 * · days = หน้าต่างย้อนหลังจาก now (route ใช้) · ไม่ใส่ = ทุกโพสต์ที่มี (สคริปต์)
 * · posts = ส่งโพสต์มาเอง (เช่นอ่านจาก CSV ตรงๆ โดยไม่นำเข้า store) — ยังอ่านเคส/สมุดครูจาก sb ถ้ามี
 */
export async function runLiftReport({
  sb = null,
  days = null,
  threshold = DEFAULT_MATCH_THRESHOLD,
  minN = DEFAULT_MIN_N,
  padDays = DEFAULT_PAD_DAYS,
  pickGapDays = DEFAULT_PICK_GAP_DAYS,
  now = new Date(),
  posts = null,
  pageSize,
  maxPages,
} = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nDays = toNumber(days);
  const window = nDays > 0
    ? { from: new Date(nowDate.getTime() - nDays * DAY_MS).toISOString(), to: nowDate.toISOString() }
    : null;
  const inputs = await loadLiftInputs(sb, { window, posts, padDays, pageSize, maxPages });
  const report = buildLiftReport({
    posts: inputs.posts,
    generations: inputs.generations,
    pickHistory: inputs.pickHistory,
    threshold,
    minN,
    window: inputs.window,
    now: nowDate,
    padDays,
    pickGapDays,
  });
  report.window.generationFrom = inputs.generationWindow?.from || null;
  report.window.generationTo = inputs.generationWindow?.to || null;
  report.window.requestedDays = nDays > 0 ? nDays : null;
  if (Object.values(inputs.truncated).some(Boolean)) {
    report.truncated = inputs.truncated;
    report.notes.push('ข้อมูลบางส่วนถูกตัดที่เพดานหน้า (maxPages) — ตัวเลขเป็นของช่วงที่อ่านได้เท่านั้น');
  }
  return { report, markdown: renderLiftMarkdown(report) };
}
