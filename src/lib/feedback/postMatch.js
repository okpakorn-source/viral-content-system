/**
 * postMatch.js — จับคู่โพสต์จริงของเพจ (CSV จาก Facebook Insights) กับข้อความที่ระบบเขียน
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ 2 ก.ย. 69 (ข้อ 5 ป้อนกลับผลจริง): ยกวิธีที่พิสูจน์แล้วจาก C:\tmp\news-r233-run\fb-csv-analyze.mjs
 *   (จับคู่ครูได้ 145/202 ใบ · เวอร์ชันระบบ 409 จาก generation_logs มิ.ย.–ก.ค. 69) มาเป็นโมดูลกลาง
 * ไฟล์นี้ตั้งใจ "ไม่มี import" — ใช้ได้ทั้งใน Next (route) · สคริปต์ node · เทส โดยไม่ลากฐานข้อมูล/เครือข่าย
 *
 * วิธีจับคู่: ตัดช่องว่างทิ้ง → หั่นเป็นชิ้น 12 ตัวอักษร ก้าวทีละ 3 (grams)
 *   ความคล้าย = จำนวนชิ้นที่ซ้ำกัน / ขนาดชุดที่เล็กกว่า (0..1)
 *   เกณฑ์ที่พิสูจน์แล้ว: ≥ 0.35 สำหรับครู (เนื้อครูมักถูกตัดต่อก่อนโพสต์) · ≥ 0.4 สำหรับเวอร์ชันของระบบ
 * กัน 1 โพสต์ถูกจับหลายเคส: เรียงคู่ (เคส,โพสต์) ตามความคล้ายจากมากไปน้อย แล้วจับแบบ greedy —
 *   เคสที่คล้ายกว่าได้โพสต์นั้นไป เคสที่แพ้ตกไปโพสต์อันดับถัดไปของตัวเอง (ถ้ายังถึงเกณฑ์) ไม่งั้นไม่จับคู่
 */

/** ชื่อคอลัมน์ในไฟล์ CSV ที่ Facebook ส่งออก (ไทย/อังกฤษ) → ชื่อฟิลด์ที่ระบบใช้ */
export const FB_CSV_COLUMNS = Object.freeze({
  postId: ['ID โพสต์', 'Post ID'],
  pageId: ['ID เพจ', 'Page ID'],
  text: ['ชื่อ', 'Title'],
  description: ['คำอธิบาย', 'Description'],
  time: ['เวลาที่เผยแพร่', 'Publish time'],
  type: ['ประเภทโพสต์', 'Post type'],
  permalink: ['ลิงก์ถาวร', 'Permalink'],
  views: ['ยอดดู', 'Views'],
  reach: ['การเข้าถึง', 'Reach'],
  reactions: ['ความรู้สึก', 'Reactions'],
  comments: ['ความคิดเห็น', 'Comments'],
  shares: ['การแชร์', 'Shares'],
});

export const DEFAULT_GRAM_SIZE = 12;
export const DEFAULT_GRAM_STEP = 3;
export const DEFAULT_MATCH_THRESHOLD = 0.4;
export const TEACHER_MATCH_THRESHOLD = 0.35;

/** ตัวเลขจาก CSV: "1,234" → 1234 · "" / "N/A" → 0 · "31.07" → 31.07 */
export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '');
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * แยก CSV ตาม RFC4180: รองรับ BOM · เครื่องหมายคำพูด · "" ในช่อง · ขึ้นบรรทัดใหม่ในช่อง · CRLF/LF
 * คืน array ของแถว (แต่ละแถว = array ของช่อง) — ไม่ตีความหัวตาราง
 */
export function parseCsvRows(text) {
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * เวลาที่เผยแพร่ในไฟล์เพจ = "MM/DD/YYYY HH:mm" ตามเวลาไทย (UTC+7) → ISO (UTC)
 * รับ ISO อยู่แล้วก็คืนเดิม · อ่านไม่ออก = null (ห้ามเดา)
 */
export function parseFbTime(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, mm, dd, yyyy, hh = '0', mi = '0', ss = '0'] = m;
    const utcMs = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss)) - 7 * 3600 * 1000;
    const d = new Date(utcMs);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  return null;
}

function _headerIndex(headerRow) {
  const cleaned = headerRow.map((h) => String(h ?? '').replace(/^\uFEFF/, '').trim());
  const idx = {};
  for (const [field, aliases] of Object.entries(FB_CSV_COLUMNS)) {
    const at = cleaned.findIndex((h) => aliases.includes(h));
    if (at >= 0) idx[field] = at;
  }
  return idx;
}

/**
 * parseFbCsv(text) → posts[{ postId, text, time, publishedAt, type, permalink, reactions, comments, shares, reach, views }]
 * · แถวที่ไม่มี ID โพสต์ = ข้าม (บรรทัดว่าง/แถวสรุป) · ข้อความว่างยังคืน (ผู้ใช้ตัดสินใจเองว่าจะเก็บไหม)
 * · ต้องมีคอลัมน์ ID โพสต์ + ชื่อ อย่างน้อย ไม่งั้น throw (ไฟล์ผิดชนิด — ห้ามเงียบ)
 */
export function parseFbCsv(text) {
  const rows = parseCsvRows(text).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  if (!rows.length) return [];
  const idx = _headerIndex(rows[0]);
  if (idx.postId == null || idx.text == null) {
    throw new Error(`CSV ไม่ใช่ไฟล์ส่งออกโพสต์ของเพจ: หาคอลัมน์ "${FB_CSV_COLUMNS.postId[0]}" / "${FB_CSV_COLUMNS.text[0]}" ไม่พบ`);
  }
  const pick = (r, field) => (idx[field] == null ? '' : (r[idx[field]] ?? ''));
  const posts = [];
  for (const r of rows.slice(1)) {
    const postId = String(pick(r, 'postId')).trim();
    if (!postId) continue;
    const time = String(pick(r, 'time')).trim();
    posts.push({
      postId,
      text: String(pick(r, 'text')).trim(),
      time,
      publishedAt: parseFbTime(time),
      type: String(pick(r, 'type')).trim(),
      permalink: String(pick(r, 'permalink')).trim(),
      reactions: toNumber(pick(r, 'reactions')),
      comments: toNumber(pick(r, 'comments')),
      shares: toNumber(pick(r, 'shares')),
      reach: toNumber(pick(r, 'reach')),
      views: toNumber(pick(r, 'views')),
    });
  }
  return posts;
}

/** ชุดชิ้นข้อความ: ตัดช่องว่างทั้งหมด → ชิ้นละ size ตัวอักษร ก้าว step */
export function grams(text, { size = DEFAULT_GRAM_SIZE, step = DEFAULT_GRAM_STEP } = {}) {
  const x = String(text ?? '').replace(/\s+/g, '');
  const out = new Set();
  const sz = Math.max(1, Number(size) || DEFAULT_GRAM_SIZE);
  const st = Math.max(1, Number(step) || DEFAULT_GRAM_STEP);
  for (let i = 0; i + sz <= x.length; i += st) out.add(x.slice(i, i + sz));
  return out;
}

/** ความคล้าย 0..1 ระหว่างข้อความ/ชุด grams สองชุด (ชุดว่าง = 0) */
export function similarity(a, b, opts) {
  const A = a instanceof Set ? a : grams(a, opts);
  const B = b instanceof Set ? b : grams(b, opts);
  if (!A.size || !B.size) return 0;
  const [small, large] = A.size <= B.size ? [A, B] : [B, A];
  let hit = 0;
  for (const g of small) if (large.has(g)) hit++;
  return hit / Math.max(1, Math.min(A.size, B.size));
}

/** ดัชนีกลับ gram → ตำแหน่งโพสต์ (ให้จับคู่หลายพันเคสได้โดยไม่ต้องเทียบทุกคู่) */
export function buildPostIndex(posts, opts) {
  const sizes = [];
  const byGram = new Map();
  (posts || []).forEach((post, i) => {
    const g = grams(post?.text, opts);
    sizes[i] = g.size;
    for (const gram of g) {
      let list = byGram.get(gram);
      if (!list) { list = []; byGram.set(gram, list); }
      list.push(i);
    }
  });
  return { sizes, byGram };
}

/** จัดอันดับโพสต์ที่คล้ายข้อความนี้ (≥ threshold) จากดัชนี — ใช้ซ้ำได้นอก matchPosts */
export function rankPostsFor(index, text, { threshold = DEFAULT_MATCH_THRESHOLD, size, step, limit = 5 } = {}) {
  const g = grams(text, { size, step });
  if (!g.size) return [];
  const hits = new Map();
  for (const gram of g) {
    const list = index.byGram.get(gram);
    if (!list) continue;
    for (const pi of list) hits.set(pi, (hits.get(pi) || 0) + 1);
  }
  const scored = [];
  for (const [pi, hit] of hits) {
    const sim = hit / Math.max(1, Math.min(g.size, index.sizes[pi]));
    if (sim >= threshold) scored.push({ postIndex: pi, sim });
  }
  scored.sort((x, y) => y.sim - x.sim || x.postIndex - y.postIndex);
  return limit > 0 ? scored.slice(0, limit) : scored;
}

const _round4 = (n) => Math.round(n * 10000) / 10000;

/**
 * matchPosts(posts, candidates, { threshold }) → { [candidateId]: { postId, sim, reactions, comments, shares, reach, views, time, publishedAt } }
 * · posts: ผลจาก parseFbCsv (หรือแถวจาก store post-metrics) · candidates: [{ id, text }]
 * · เลือกโพสต์ที่คล้ายที่สุดต่อเคส · 1 โพสต์ตกเป็นของเคสเดียว (ชนกัน = เคสที่คล้ายกว่าชนะ อีกเคสตกไปอันดับถัดไป)
 * · candidate ที่ไม่ถึงเกณฑ์ = ไม่มีคีย์ในผลลัพธ์ (ไม่ใส่ null ให้สับสน)
 */
export function matchPosts(posts, candidates, { threshold = DEFAULT_MATCH_THRESHOLD, size, step, topK = 5 } = {}) {
  const list = Array.isArray(posts) ? posts : [];
  const cands = Array.isArray(candidates) ? candidates : [];
  const index = buildPostIndex(list, { size, step });
  const pairs = [];
  cands.forEach((cand, ci) => {
    for (const { postIndex, sim } of rankPostsFor(index, cand?.text, { threshold, size, step, limit: topK })) {
      pairs.push({ ci, pi: postIndex, sim });
    }
  });
  // คล้ายมากก่อน · เท่ากัน = เคสที่มาก่อนในรายการก่อน (คงที่ทุกครั้งที่รัน)
  pairs.sort((x, y) => y.sim - x.sim || x.ci - y.ci || x.pi - y.pi);
  const usedPost = new Set();
  const usedCand = new Set();
  const out = {};
  for (const { ci, pi, sim } of pairs) {
    if (usedCand.has(ci) || usedPost.has(pi)) continue;
    usedCand.add(ci);
    usedPost.add(pi);
    const post = list[pi];
    out[String(cands[ci].id)] = {
      postId: String(post.postId ?? post.id ?? ''),
      sim: _round4(sim),
      reactions: toNumber(post.reactions),
      comments: toNumber(post.comments),
      shares: toNumber(post.shares),
      reach: toNumber(post.reach),
      views: toNumber(post.views),
      time: post.time ?? null,
      publishedAt: post.publishedAt ?? parseFbTime(post.time),
    };
  }
  return out;
}
