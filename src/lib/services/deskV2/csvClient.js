/**
 * =====================================================
 * 🧬 CSV Client — พาร์ส/แมป CSV Meta Business Suite ฝั่ง browser (โต๊ะข่าวกลาง v2, DNA Lab)
 * =====================================================
 * pure JS ล้วน — ไม่มี node API (fs/crypto) เพื่อให้เรียกได้ทั้งฝั่ง client (FileReader) และ node เทสตรง
 * ตรรกะ parseCsv พอร์ตมาจาก parser เดิมของ repo (src/app/api/news-desk/learn-performance/route.js)
 * — รองรับ field มี comma / ขึ้นบรรทัดใน quotes / "" escape / BOM นำหน้า
 *
 * 🔒 MAPPING ล็อกจากไฟล์จริง (Meta export ไทย, 30 คอลัมน์):
 *   ID โพสต์(postId) · ชื่อ(title — exact ก่อน includes กัน "ชื่อเพจ") · คำอธิบาย(desc) ·
 *   เวลาที่เผยแพร่(time MM/DD/YYYY HH:mm) · ลิงก์ถาวร(permalink) · ประเภทโพสต์(postType) ·
 *   ยอดดู(views) · การเข้าถึง(reach) · ความรู้สึก(reactions — exact ก่อน includes กัน
 *   "ความรู้สึก ความคิดเห็น และการแชร์")
 */

// 🔴 ไฟล์นี้ต้อง bundle ฝั่ง client ได้ → "ห้าม" import dnaContract.js (มันมี `import crypto from 'crypto'`
//    ระดับ top-level ซึ่งจะดึง node builtin เข้า client bundle แล้ว build พัง). ค่าเกณฑ์กลุ่ม/ตรรกะ tier
//    จึงคัดลอกมาไว้ที่นี่ให้ตรงกับ dnaContract.DEFAULT_TIERS/tierOf เป๊ะ (dnaContract = แหล่งความจริง —
//    backend re-validate ทุก record ด้วย tierOf ของมันอยู่แล้ว ค่าฝั่ง client นี้ใช้เพื่อแสดง/นับเท่านั้น)

// ── เกณฑ์กลุ่ม default (mirror ของ dnaContract.DEFAULT_TIERS — ห้ามให้ต่างกัน) ──
export const DEFAULT_TIERS = {
  S: { min: 900_000 },
  A: { min: 500_000, max: 900_000 },
};

// ── tierOf (mirror ของ dnaContract.tierOf) — คืน 'S' | 'A' | null (null = กลุ่มควบคุม) ──
export function tierOf(reach, tiers = DEFAULT_TIERS) {
  const r = Number(reach) || 0;
  if (r >= tiers.S.min) return 'S';
  if (r >= tiers.A.min && r < tiers.A.max) return 'A';
  return null;
}

// ── ป้ายหัวคอลัมน์ที่ใช้ค้น (แต่ละช่องอาจมีชื่อสำรอง — ตัวแรก = ตรงเป๊ะที่คาดหวัง) ──
export const COLUMN_LABELS = {
  postId: ['ID โพสต์'],
  title: ['ชื่อ'],            // ⚠️ exact ก่อน includes — ห้ามจับ "ชื่อเพจ"
  desc: ['คำอธิบาย'],
  time: ['เวลาที่เผยแพร่'],
  permalink: ['ลิงก์ถาวร'],
  postType: ['ประเภทโพสต์'],
  views: ['ยอดดู'],
  reach: ['การเข้าถึง'],
  reactions: ['ความรู้สึก'],  // ⚠️ exact ก่อน includes — ห้ามจับ "ความรู้สึก ความคิดเห็น และการแชร์"
};

// ── ฉลากภาษาไทยของแต่ละช่อง (ใช้แสดงใน UI mapping table) ──
export const FIELD_LABELS_TH = {
  postId: 'ID โพสต์',
  title: 'หัวข้อ/เนื้อหา (ชื่อ)',
  desc: 'คำอธิบายเพิ่ม',
  time: 'เวลาที่เผยแพร่',
  permalink: 'ลิงก์โพสต์',
  postType: 'ประเภทโพสต์',
  views: 'ยอดดู',
  reach: 'การเข้าถึง',
  reactions: 'ยอดความรู้สึก',
};

/**
 * parseCsv — แปลงข้อความ CSV เป็น array ของ row (แต่ละ row = array ของ cell)
 * รองรับ: field ใน "..." ที่มี comma/newline · "" = อัญประกาศ escape · BOM นำหน้า · \r\n และ \n
 * @param {string} text
 * @returns {string[][]} rows (รวมหัวตารางเป็น rows[0])
 */
export function parseCsv(text) {
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // ตัด BOM

  const rows = [];
  let row = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; } // "" → "
        else inQ = false;
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/**
 * autoMapColumns — หา index คอลัมน์จากหัวตาราง (exact ก่อน includes เสมอ)
 * @param {string[]} header
 * @returns {{postId:number,title:number,desc:number,time:number,permalink:number,postType:number,views:number,reach:number,reactions:number}}
 *          index ที่หาไม่เจอ = -1
 */
export function autoMapColumns(header = []) {
  const h = Array.isArray(header) ? header.map((x) => String(x ?? '').trim()) : [];
  const find = (names) => {
    // exact ก่อน — กัน "ชื่อ"↔"ชื่อเพจ" และ "ความรู้สึก"↔"ความรู้สึก ความคิดเห็น และการแชร์"
    const exact = h.findIndex((cell) => names.some((n) => cell === n));
    if (exact >= 0) return exact;
    return h.findIndex((cell) => names.some((n) => cell.includes(n)));
  };
  const mapping = {};
  for (const [field, names] of Object.entries(COLUMN_LABELS)) {
    mapping[field] = find(names);
  }
  return mapping;
}

// ── normalize ประเภทโพสต์ อังกฤษ→ไทย (ค่าจริงในไฟล์ปน "รูปภาพ"/"Photos") ──
const POST_TYPE_MAP = [
  [/(^|\b)(photo|photos|image|images|รูปภาพ|ภาพ)($|\b)/i, 'รูปภาพ'],
  [/(^|\b)(reel|reels|รีล)($|\b)/i, 'รีล'],
  [/(^|\b)(video|videos|วิดีโอ|วีดีโอ)($|\b)/i, 'วิดีโอ'],
  [/(^|\b)(live|ถ่ายทอดสด|ไลฟ์)($|\b)/i, 'ไลฟ์'],
  [/(^|\b)(link|links|ลิงก์|ลิงค์)($|\b)/i, 'ลิงก์'],
  [/(^|\b)(status|text|ข้อความ|สถานะ)($|\b)/i, 'สถานะ'],
];
export function normalizePostType(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return '';
  for (const [re, th] of POST_TYPE_MAP) {
    if (re.test(v)) return th;
  }
  return v.slice(0, 30); // ค่าที่ไม่รู้จัก — คงไว้ (ตัดสั้น)
}

/**
 * toIsoDate — แปลงเวลา Meta "MM/DD/YYYY HH:mm" → ISO local "YYYY-MM-DDTHH:mm:ss"
 * (ไม่ใส่ Z — ให้ new Date() ตีความเป็นเวลาท้องถิ่น ตรงกับ publishHour/dayOfWeek ใน dnaContract)
 * @param {string} raw
 * @returns {string} ISO หรือ '' ถ้าแปลงไม่ได้
 */
export function toIsoDate(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return '';
  const [, mm, dd, yyyy, hh = '00', mi = '00', ss = '00'] = m;
  const p2 = (x) => String(x).padStart(2, '0');
  return `${yyyy}-${p2(mm)}-${p2(dd)}T${p2(hh)}:${p2(mi)}:${p2(ss)}`;
}

// ── แปลงตัวเลข: ตัด comma/ช่องว่าง/อักขระอื่น ก่อน Number ──
export function toNumber(raw) {
  const n = Number(String(raw ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * rowsToPosts — แปลงแถวข้อมูล (ไม่รวมหัว) เป็น posts array พร้อมส่งเข้า /api/desk/dna/analyze
 * @param {string[][]} rows       - rows จาก parseCsv "ทั้งชุด" (จะตัดหัว rows[0] ให้เอง)
 * @param {object} mapping        - จาก autoMapColumns (หรือผู้ใช้แก้แล้ว)
 * @param {object} [opts]
 * @param {'reach'|'views'} [opts.metricKey='reach'] - เมตริกที่ใช้จัดกลุ่ม S/A → เก็บเป็น field reach
 * @param {object} [opts.tiers]   - เกณฑ์กลุ่ม (default = DEFAULT_TIERS ผ่าน tierOf)
 * @returns {Array<object>} posts: { postId,title,contentExcerpt,permalink,postType,publishedAt,reach,views,reactions,tier }
 */
export function rowsToPosts(rows, mapping = {}, opts = {}) {
  const metricKey = opts.metricKey === 'views' ? 'views' : 'reach';
  const tiers = opts.tiers; // undefined → tierOf ใช้ DEFAULT_TIERS
  const data = Array.isArray(rows) ? rows.slice(1) : []; // ตัดหัวตาราง
  const at = (r, i) => (i != null && i >= 0 && i < r.length ? r[i] : '');
  const clean = (x) => String(x ?? '').replace(/\s+/g, ' ').trim();

  const posts = [];
  for (const r of data) {
    // ข้ามแถวว่างจริง (ไม่มีทั้งหัวข้อและ postId)
    const title = clean(at(r, mapping.title));
    const postId = clean(at(r, mapping.postId));
    if (!title && !postId) continue;

    const reach = toNumber(at(r, mapping.reach));
    const views = toNumber(at(r, mapping.views));
    const metricValue = metricKey === 'views' ? views : reach;

    posts.push({
      postId,
      title,
      contentExcerpt: clean(at(r, mapping.desc)),
      permalink: clean(at(r, mapping.permalink)),
      postType: normalizePostType(at(r, mapping.postType)),
      publishedAt: toIsoDate(at(r, mapping.time)),
      reach: metricValue,          // 🔴 field ที่ backend ใช้จัดกลุ่ม = เมตริกที่ผู้ใช้เลือก
      views,                        // เก็บยอดดูจริงไว้ให้ UI แสดง (backend ไม่ใช้ตรงๆ)
      reachActual: reach,           // ยอดเข้าถึงจริง (เผื่อ UI เทียบ เวลาเลือก metric=views)
      reactions: toNumber(at(r, mapping.reactions)),
      tier: tierOf(metricValue, tiers), // 'S' | 'A' | null (null = กลุ่มควบคุม)
    });
  }
  return posts;
}

/**
 * summarizePosts — นับกลุ่ม S/A/ควบคุม/แถวเสีย (แถวเสีย = ไม่มีหัวข้อ หรือ หัวข้อสั้น <10)
 * @param {Array<object>} posts
 * @returns {{S:number,A:number,control:number,bad:number,total:number,research:number}}
 */
export function summarizePosts(posts = []) {
  let S = 0, A = 0, control = 0, bad = 0;
  for (const p of posts) {
    if (!p.title || p.title.length < 10) { bad++; continue; }
    if (p.tier === 'S') S++;
    else if (p.tier === 'A') A++;
    else control++;
  }
  return { S, A, control, bad, total: posts.length, research: S + A };
}
