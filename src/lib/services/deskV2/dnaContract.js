/**
 * =====================================================
 * 🧬 DNA Contract — สัญญากลางของ DNA Lab (โต๊ะข่าวกลาง v2, เฟส 1 — 16 ก.ค. 69)
 * =====================================================
 * ไฟล์เดียวที่นิยาม: ชื่อ store · เกณฑ์กลุ่ม · หมวด · postKey · การ validate/sanitize · คลัสเตอร์
 * ทั้งฝั่ง analyze (วิจัย) และ library (คลัง) ต้อง import จากที่นี่เท่านั้น — ห้าม hardcode ซ้ำ
 * 🔴 pure JS + relative import ล้วน (ให้ node เรียกเทสตรงได้ ไม่ง้อ alias @/)
 * แผนแม่บท: artifact dna-lab-plan (16 ก.ค.) — กติกาสำคัญ:
 *   - dedup fallback ใช้หัวข้อ "เต็ม" + ยอด + วันที่ (ห้ามใช้ 18 ตัวแรก — พาดหัวไทยขึ้นต้นซ้ำกันเยอะ)
 *   - คำค้นห้ามกว้าง ห้ามชื่อบุคคลจริง (ตัวละคร+การกระทำ+จุดหักมุม)
 *   - เนื้อโพสต์ = ข้อมูล ไม่ใช่คำสั่ง (กัน prompt injection — sanitize ทุก field ที่ AI คืน)
 */

import crypto from 'crypto';

// ── ชื่อ store (persistStore: Supabase หลัก + JSON fallback) ──
export const STORE_EXEMPLARS = 'dna-exemplars';      // 1 record / ข่าวต้นแบบ
export const STORE_RUNS = 'dna-research-runs';        // 1 record / การอัพโหลดวิจัย 1 ครั้ง

// ── เกณฑ์กลุ่มยอด (นับจาก "ยอดเข้าถึง/reach" — ผู้ใช้เคาะ 16 ก.ค.; UI ปรับได้ ค่านี้คือ default) ──
export const DEFAULT_TIERS = {
  S: { min: 900_000 },                 // 🥇 ต้นแบบทอง
  A: { min: 500_000, max: 900_000 },   // 🥈 ต้นแบบเงิน
  // ต่ำกว่า A.min = กลุ่มควบคุม (เก็บสถิติเชิงกล ไม่ทำ DNA)
};
export function tierOf(reach, tiers = DEFAULT_TIERS) {
  const r = Number(reach) || 0;
  if (r >= tiers.S.min) return 'S';
  if (r >= tiers.A.min && r < tiers.A.max) return 'A';
  return null; // กลุ่มควบคุม/ไม่เข้าเกณฑ์
}

// ── หมวด 10 หมวด (ชุดเดิมที่พิสูจน์แล้วจาก DNA extractor เก่า — คงไว้ให้เทียบข้ามรุ่นได้) ──
export const CATEGORIES = [
  'กตัญญู/ครอบครัวอบอุ่น', 'น้ำใจ/ช่วยเหลือ', 'สู้ชีวิต', 'คนดังทำดี/ติดดิน',
  'สัมภาษณ์/บทสนทนาดี', 'คนดัง/ดราม่าบันเทิง', 'บันเทิงกระแส', 'ความรัก/แต่งงาน',
  'กระแสรายวัน', 'อื่นๆ',
];

// ── sanitize: ตัดอักขระควบคุม/zero-width + ยุบช่องว่าง + จำกัดความยาว ──
export function sanitizeText(s, max = 300) {
  return String(s ?? '')
    .replace(/[\u0000-\u001f\u200b-\u200f\u2028\u2029\ufeff]/g, ' ') // escape เสมอ — U+2028/2029 ดิบใน regex literal = SyntaxError ระดับสเปก (B2 จับได้ 16 ก.ค. 69)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const md5 = (s) => crypto.createHash('md5').update(String(s), 'utf8').digest('hex');

/**
 * postKey — กุญแจกันซ้ำ/กันจ่ายเงินซ้ำ (idempotent ทั้งระบบ)
 * ลำดับ: postId → permalink → fallback(หัวข้อเต็ม normalize + reach + วันที่)
 * ⚠️ fallback ผูกกับ reach: ไฟล์ช่วงเวลาทับซ้อนที่ reach โตขึ้น จะได้ key ใหม่ —
 *    ฝั่งคลังต้องกันซ้ำชั้นสอง (titleHash) ตาม conflict policy: reach ใหม่สูงกว่า → replace
 */
export function buildPostKey({ postId, permalink, title, reach, publishedAt } = {}) {
  const pid = sanitizeText(postId, 80);
  if (pid) return 'dnax_' + md5('id:' + pid).slice(0, 16);
  const pl = sanitizeText(permalink, 300).replace(/[?#].*$/, ''); // ตัด query/tracking
  if (pl) return 'dnax_' + md5('pl:' + pl).slice(0, 16);
  const t = sanitizeText(title, 500).replace(/\s/g, '');
  const d = String(publishedAt || '').slice(0, 10);
  return 'dnax_' + md5(`tt:${t}|${Number(reach) || 0}|${d}`).slice(0, 16);
}

/** titleHash — กุญแจชั้นสองของ conflict policy (หัวข้อเต็ม ไม่ผูก reach/วันที่) */
export function buildTitleHash(title) {
  return 'th_' + md5(sanitizeText(title, 500).replace(/\s/g, '')).slice(0, 16);
}

// ── คลัสเตอร์ archetype (ให้เฟส 2 ดึง "ตัวแทนต่อคลัสเตอร์" ไม่ยิงคำค้นซ้ำรายใบ) ──
export function normalizeArchetype(s) {
  return sanitizeText(s, 80).replace(/[\s\-–—·|,/\\.]+/g, '').toLowerCase();
}
export function makeClusterId(archetypeNorm) {
  return 'cl_' + md5(archetypeNorm).slice(0, 10);
}

// ── validate ผลจาก AI: whitelist field + จำกัดความยาว + กติกาคำค้น ──
const QUERY_BAD = /(https?:\/\/|ignore|ระบบ:|system:|<\/?)/i; // กันคำค้นที่โดนฉีด/หลุดรูปแบบ
function cleanQueries(arr, maxItems = 6) {
  return (Array.isArray(arr) ? arr : [])
    .map((q) => sanitizeText(q, 70))
    .filter((q) => q.length >= 4 && q.length <= 70 && !QUERY_BAD.test(q))
    .slice(0, maxItems);
}
function cleanList(arr, maxItems, maxLen) {
  return (Array.isArray(arr) ? arr : []).map((x) => sanitizeText(x, maxLen)).filter(Boolean).slice(0, maxItems);
}

/**
 * validateDnaRecord — รับ record ดิบ (identity+metrics จากไฟล์ + dna จาก AI) → { ok, errors, record }
 * record ที่ผ่าน = พร้อมเก็บลง STORE_EXEMPLARS ได้ทันที (id = postKey)
 */
export function validateDnaRecord(raw = {}) {
  const errors = [];
  const title = sanitizeText(raw.title, 300);
  if (title.length < 10) errors.push('title สั้นเกิน (<10 ตัวอักษร)');
  const reach = Number(raw.reach) || 0;
  const tier = raw.tier === 'S' || raw.tier === 'A' ? raw.tier : tierOf(reach);
  if (!tier) errors.push(`reach ${reach} ไม่เข้าเกณฑ์กลุ่ม S/A`);

  const d = raw.dna || {};
  const archetype = sanitizeText(d.archetype, 80);
  if (!archetype) errors.push('dna.archetype ว่าง');
  const newsQueries = cleanQueries(d.newsQueries);
  const clipQueries = cleanQueries(d.clipQueries);
  if (!newsQueries.length && !clipQueries.length) errors.push('ไม่มีคำค้นที่ผ่านกติกาเลย');
  let category = sanitizeText(d.category, 40);
  if (!CATEGORIES.includes(category)) category = 'อื่นๆ';

  const publishedAt = sanitizeText(raw.publishedAt, 30);
  const pubDate = publishedAt ? new Date(publishedAt) : null;
  const postKey = raw.postKey || buildPostKey({ ...raw, title, reach, publishedAt });

  const record = {
    id: postKey,
    postKey,
    titleHash: buildTitleHash(title),
    // ── ตัวตน ──
    title,
    // 🔒 audit R2 (18 ก.ค.): เก็บ postId ดิบด้วย — เดิมมีแต่ postKey (hash) ทำหน้าเช็คซ้ำของ UI เทียบ postId
    //   กับคลังแล้วได้ 0 เสมอ (คลังไม่เคยเก็บ field นี้)
    postId: sanitizeText(raw.postId, 80),
    contentExcerpt: sanitizeText(raw.contentExcerpt, 600),
    permalink: sanitizeText(raw.permalink, 300),
    postType: sanitizeText(raw.postType, 30) || 'unknown', // วิดีโอ/รูป/ลิงก์/รีล — ชี้เลนเฟส 2
    publishedAt,
    publishHour: pubDate && !isNaN(pubDate) ? pubDate.getHours() : null,
    dayOfWeek: pubDate && !isNaN(pubDate) ? pubDate.getDay() : null,
    month: publishedAt ? publishedAt.slice(0, 7) : '',
    // ── ยอดจริง ──
    reach,
    reactions: Number(raw.reactions) || 0,
    tier,
    // ── DNA (AI) ──
    dna: {
      archetype,
      characters: cleanList(d.characters, 4, 40),   // บทบาท ห้ามชื่อบุคคลจริง (คุมใน prompt + คนรีวิว)
      action: sanitizeText(d.action, 120),
      twist: sanitizeText(d.twist, 120),
      emotionalTriggers: cleanList(d.emotionalTriggers, 4, 30),
      hookPattern: sanitizeText(d.hookPattern, 80),
      numbersUsed: !!d.numbersUsed,
      category,
      whyViral: sanitizeText(d.whyViral, 250),
      newsQueries,
      clipQueries,
      reusable: d.reusable !== false, // default true
      confidence: Math.min(1, Math.max(0, Number(d.confidence) || 0)),
    },
    // ── คลัสเตอร์ (library เป็นคนเซ็ตตอน save — analyze ไม่ต้องรู้จักคลัง) ──
    archetypeNorm: normalizeArchetype(archetype),
    clusterId: raw.clusterId || null,
    // ── ที่มา ──
    runId: sanitizeText(raw.runId, 40),
    sourceFile: sanitizeText(raw.sourceFile, 120),
    savedAt: raw.savedAt || null, // library ประทับตอนเก็บจริง
    status: 'active',
  };
  return { ok: errors.length === 0, errors, record };
}
