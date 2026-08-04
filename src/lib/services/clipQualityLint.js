/**
 * ★ Clip Quality Lint (4 ส.ค. 69) — ด่านตรวจ "เชิงกลไก" ของเนื้อดิบจากคลิป
 *
 *  ฟังก์ชันบริสุทธิ์ล้วน: ไม่มี AI ไม่มีเน็ต ไม่มีไฟล์ ไม่มี env — เรียกกี่ครั้งก็ได้ผลเดิม ราคา 0 บาท
 *  หน้าที่เดียว: "ชี้" ว่าเจอรูปแบบภาษาที่เคยโดนติจริง ไม่ใช่ "ตัดสิน" หรือแก้เนื้อให้
 *  🔴 ผู้เรียกเป็นคนตัดสินใจว่าจะติดธง/ยิงซ้ำ และประตูอยู่ที่ CLIP_QC_GATES=1 (ไม่ใช่ในไฟล์นี้)
 *
 *  บทเรียนที่ฝังเป็นกฎในไฟล์นี้:
 *   • คำพูดจริงของคนในคลิปห้ามแตะ → ข้อความในเครื่องหมายคำพูดถูก "ปิดตา" ก่อนตรวจเสมอ
 *   • ข้อคิดปิดท้ายเป็นปัญหาเฉพาะตอนอยู่ "ท้ายเรื่อง" — กลางเรื่องมักเป็นคำที่คนในคลิปพูดเอง
 *   • คลิปเรื่องเดียวไม่มี topics = ถูกต้อง ห้ามตีเป็นปัญหา
 */

// ── ตารางรูปแบบภาษาที่ต้องชี้ (ห้ามไล่แบนรายวลี — จับ "หมวด" ตามตำแหน่ง/หน้าที่ของคำ) ──
const LANG_PATTERNS = [
  {
    // โปรโมต/ชวนติดตามท้ายคลิป — ไม่ใช่เนื้อข่าว (เคส PATEDTALK)
    type: 'cta',
    re: /ติดตามชม|ฝากกด|กดไลก์|กดไลค์|กดแชร์|กดติดตาม|กดกระดิ่ง|อย่าลืมกด|ช่องทางการติดตาม|ติดตามได้ที่|รับชมได้ที่|ฉบับเต็ม|subscribe/gi,
  },
  {
    // ข้อคิด/บทสรุปที่ผู้เล่าเติมเอง — นับเฉพาะเมื่ออยู่ 25% ท้ายของข้อความ (กลางเรื่องมักเป็นคำพูดของคนในคลิป)
    type: 'moral_ending',
    re: /เป็นเครื่องพิสูจน์|สะท้อนให้เห็น|(?:กลาย)?เป็นแรงบันดาลใจ|บทเรียนสำคัญ|พิสูจน์ให้เห็นว่า|เป็นตัวอย่างที่ดี/g,
    tailOnly: true,
  },
  {
    // ป้ายตัวตนที่เติมต่อท้ายชื่อ — ขัดกฎหลักฐานตัวตน (ชื่อล้วน)
    type: 'identity_label',
    re: /(?:อินฟลูเอนเซอร์|เน็ตไอดอล)?ชื่อดัง/g,
  },
  {
    // สำนวนข่าวไวรัลที่ไม่ได้อยู่ในคลิป
    type: 'viral_trend',
    re: /ชาวเน็ตแห่|โลกโซเชียลแห่|กลายเป็นไวรัล|ถูกแชร์ต่อ/g,
  },
  {
    // เล่า "คลิป" แทนที่จะเล่า "เหตุการณ์"
    type: 'meta_narration',
    re: /คลิปวิดีโอ(?:นี้|ดังกล่าว)?(?:ถ่ายทอด|เผยให้เห็น|บันทึกภาพ)|ในคลิปนี้/g,
  },
];

const MAX_FINDINGS = 40;      // กันกรณีเนื้อยาวมากจนธงท่วมจอ
const TAIL_RATIO = 0.75;      // 25% ท้าย = ตำแหน่งที่ข้อคิดปิดท้ายมักโผล่
const GAP_MIN_SEC = 180;      // ช่วงที่ไม่มีประเด็นครอบเกิน 3 นาที = น่าสงสัยว่าถอดไม่ครบ

/**
 * ปิดตาข้อความในเครื่องหมายคำพูด โดย "คงความยาวเดิม" ไว้ (แทนที่ด้วยช่องว่าง)
 * → index ที่ regex เจอยังชี้ตำแหน่งเดิมในข้อความต้นฉบับได้
 */
function maskQuoted(s) {
  const blank = (m) => ' '.repeat(m.length);
  return String(s)
    .replace(/“[^”]*”/g, blank)   // อัญประกาศโค้ง (ที่ใช้จริงในเนื้อดิบส่วนใหญ่)
    .replace(/"[^"]*"/g, blank);  // อัญประกาศตรง
}

/**
 * ตรวจภาษาที่ไม่ควรมีในเนื้อดิบ
 * @param {string} text
 * @returns {Array<{type:'cta'|'moral_ending'|'identity_label'|'viral_trend'|'meta_narration', match:string}>}
 */
export function lintLanguage(text) {
  const raw = String(text ?? '');
  if (!raw.trim()) return [];

  const masked = maskQuoted(raw);
  const tailStart = Math.floor(masked.length * TAIL_RATIO);
  const out = [];
  const seen = new Set();

  for (const { type, re, tailOnly } of LANG_PATTERNS) {
    // สร้าง regex ใหม่ทุกครั้ง — กัน lastIndex ค้างข้ามรอบเรียก (regex global เป็น stateful)
    const rx = new RegExp(re.source, re.flags);
    for (const m of masked.matchAll(rx)) {
      if (tailOnly && m.index < tailStart) continue;
      // masked แทนเฉพาะช่วงในเครื่องหมายคำพูด ตำแหน่งอื่นตรงกับต้นฉบับ → หยิบข้อความจริงมารายงาน
      const match = raw.slice(m.index, m.index + m[0].length).trim();
      if (!match) continue;
      const key = `${type}::${match}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type, match });
      if (out.length >= MAX_FINDINGS) return out;
    }
  }
  return out;
}

// คำที่บอกว่าคลิปนี้ "ไม่มีเสียงพูด" — เจอใน note แล้วห้ามคาดหวังคำพูดในเนื้อ
const NO_SPEECH_RE = /ไม่มีเสียงพูด|ไม่มีคำพูด|ไม่มีคนพูด|ไม่มีบทพูด|ไม่มีเสียง|ไม่ได้ยินเสียง|คลิปเงียบ|เงียบทั้งคลิป/;

/**
 * คลิปที่มีคนพูด เนื้อต้องมีคำพูดจริงในเครื่องหมายคำพูด
 * @param {{speakers?:any[], quotes?:any[], note?:string}|null} insightLike ผลรอบแรก
 * @param {string} storyText เนื้อที่จะตรวจ
 * @returns {{expected:boolean, present:boolean, ok:boolean}}
 */
export function lintQuotePresence(insightLike, storyText) {
  const speakers = Array.isArray(insightLike?.speakers)
    ? insightLike.speakers.filter((s) => String(s ?? '').trim())
    : [];
  const quotes = Array.isArray(insightLike?.quotes)
    ? insightLike.quotes.filter((q) => String(q ?? '').trim())
    : [];
  const note = String(insightLike?.note ?? '');

  const expected = !NO_SPEECH_RE.test(note) && (speakers.length > 0 || quotes.length > 0);
  // 🔴 บทเรียนเก่า: เช็คแค่ " กับ “ แล้วพลาดเนื้อที่ใช้ ” ปิดท้าย — ต้องนับอัญประกาศปิดด้วย
  const present = /["“”]/.test(String(storyText ?? ''));

  return { expected, present, ok: !expected || present };
}

/** '45' | 'MM:SS' | 'H:MM:SS' → วินาที (คืน null ถ้าอ่านไม่ออก) */
function parseClock(s) {
  const parts = String(s).trim().split(':').map((p) => Number(p.trim()));
  if (!parts.length || parts.length > 3) return null;
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** '00:12–01:40' / '0:10:00 - 0:25:30' → {from,to} (รองรับขีดกลาง ขีดยาว ~ ถึง to) */
function parseRange(timeRange) {
  const s = String(timeRange ?? '').trim();
  if (!s) return null;
  const m = s.match(/(\d{1,3}(?::\d{1,2}){0,2})\s*(?:-|–|—|~|ถึง|to)\s*(\d{1,3}(?::\d{1,2}){0,2})/i);
  if (!m) return null;
  const from = parseClock(m[1]);
  const to = parseClock(m[2]);
  if (from === null || to === null || to <= from) return null;
  return { from, to };
}

/**
 * ประเด็นย่อยครอบคลุมความยาวคลิปพอไหม
 * @param {Array<{timeRange?:string,time?:string}>} topics
 * @param {number} clipDurationSec ความยาวคลิป (0/ไม่รู้ = ใช้ปลายประเด็นสุดท้ายแทน)
 * @returns {{ok:boolean, gaps:Array<{fromSec:number,toSec:number}>, coveredRatio:number}}
 */
export function lintTopicCoverage(topics, clipDurationSec) {
  const list = Array.isArray(topics) ? topics : [];
  const ranges = list.map((t) => parseRange(t?.timeRange ?? t?.time)).filter(Boolean);
  // 🔴 คลิปเรื่องเดียว (topics ว่าง) หรือไม่ได้ให้ช่วงเวลา = ถูกต้องตามกติกา ห้ามตีเป็นปัญหา
  if (!ranges.length) return { ok: true, gaps: [], coveredRatio: 1 };

  ranges.sort((a, b) => a.from - b.from);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
    else merged.push({ ...r });
  }

  const durInput = Number(clipDurationSec);
  const dur = Number.isFinite(durInput) && durInput > 0 ? durInput : merged[merged.length - 1].to;
  if (!(dur > 0)) return { ok: true, gaps: [], coveredRatio: 1 };

  const gaps = [];
  let cursor = 0;
  let covered = 0;
  for (const r of merged) {
    const from = Math.max(0, Math.min(r.from, dur));
    const to = Math.max(0, Math.min(r.to, dur));
    if (from - cursor > GAP_MIN_SEC) gaps.push({ fromSec: cursor, toSec: from });
    if (to > from) covered += to - from;
    cursor = Math.max(cursor, to);
  }
  if (dur - cursor > GAP_MIN_SEC) gaps.push({ fromSec: cursor, toSec: dur });

  const coveredRatio = Math.min(1, Math.max(0, covered / dur));
  return { ok: gaps.length === 0, gaps, coveredRatio: Number(coveredRatio.toFixed(3)) };
}
