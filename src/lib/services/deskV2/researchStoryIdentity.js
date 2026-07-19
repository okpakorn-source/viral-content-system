/**
 * ============================================================
 * 🧬 Research Story Identity (เฟส 5) — ชี้ "เรื่องเดียวกัน" จากหลายแหล่ง + รวมแหล่งรอง
 * ============================================================
 * ต่อยอด provisionalStoryKey (เฟส 0) ให้เต็มขึ้น: มี confidence + วัดความคล้าย + รวมแหล่ง
 *   - เรื่องเดียวกันคนละเว็บ → รวมเป็นการ์ดเดียว (altSources) แต่ยังเปิดดูแหล่งรองได้
 *   - คนเดียวกันคนละเหตุการณ์ → คีย์ต่างกัน (ไม่รวม) เพราะคีย์ผูก "การกระทำ" ด้วย ไม่ใช่แค่ชื่อ
 *
 * 🔴 pure JS + import เฉพาะ sanitizeText (dnaContract = pure) — node --test ตรงได้ ไม่ง้อ persistStore
 * 🔴 ไม่มี AI — ใช้ fingerprint ที่ judge ให้มาแล้วเท่านั้น (ไม่เพิ่ม call)
 * 🔴 ทุกฟังก์ชันไม่ mutate input · altSources/channels มี cap · ทุก string ผ่าน sanitizeText
 */

import { sanitizeText } from './dnaContract.js';

const MAX_ALT_SOURCES = 12;
const STOPWORDS = new Set(['และ', 'ที่', 'ของ', 'ใน', 'การ', 'เป็น', 'ให้', 'กับ', 'มา', 'ไป', 'the', 'a', 'an', 'of', 'to', 'in', 'on']);

const lc = (x) => String(x == null ? '' : x).trim().toLowerCase();

// แยกคำหยาบๆ (ไทย/อังกฤษ) จาก title สำหรับ fallback key — ตัด stopword + คำสั้น
function tokenizeTitle(title) {
  const t = lc(title).replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return t.split(/\s+/).filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

// bucket วันที่ (YYYY-MM-DD) — ต่างวัน = คนละ time bucket (กันรวมข่าวคนละวัน)
function dateBucketOf(dateish) {
  const s = String(dateish || '');
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return 'nodate';
}

// อ่าน fingerprint ให้เป็นรูปมาตรฐาน (names เรียง, lowercase)
function normFingerprint(fp) {
  const f = fp || {};
  return {
    names: (Array.isArray(f.names) ? f.names : []).map(lc).filter(Boolean).sort(),
    action: lc(f.action),
    timeHint: lc(f.timeHint),
    numbers: (Array.isArray(f.numbers) ? f.numbers : []).map((x) => String(x).trim()).filter(Boolean).sort(),
  };
}

/**
 * buildStoryIdentity — สร้างคีย์เรื่อง + ความมั่นใจ จาก candidate (ใช้ fingerprint เป็นหลัก)
 *   confidence: 0.9 (ชื่อ+การกระทำ+เลข/เวลา) · 0.75 (ชื่อ+การกระทำ) · 0.5 (ชื่อ หรือ การกระทำ อย่างใดอย่างหนึ่ง)
 *              · 0.3 (fallback title tokens + วันที่) · 0 (ไม่มีตัวชี้เลย)
 * @param {object} candidate - { fingerprint?, title?, publishedAt?, publishedHint? }
 * @returns {{storyKey:string, storyKeyConfidence:number, basis:string}}
 */
export function buildStoryIdentity(candidate) {
  const c = candidate || {};
  const fp = normFingerprint(c.fingerprint);

  if (fp.names.length && fp.action) {
    const key = [fp.names.join('|'), fp.action, fp.timeHint, fp.numbers.join('|')].join('::');
    const conf = fp.numbers.length || fp.timeHint ? 0.9 : 0.75;
    return { storyKey: key, storyKeyConfidence: conf, basis: 'fingerprint' };
  }
  if (fp.names.length || fp.action) {
    const key = [fp.names.join('|'), fp.action, fp.timeHint, fp.numbers.join('|')].join('::');
    return { storyKey: key, storyKeyConfidence: 0.5, basis: 'partial-fingerprint' };
  }
  // fallback: title tokens + วันที่ (confidence ต่ำ — เตือนผู้เรียกว่าคีย์ไม่แน่น)
  const tokens = tokenizeTitle(c.title).slice(0, 6).sort();
  if (tokens.length) {
    return { storyKey: `tt::${tokens.join('|')}::${dateBucketOf(c.publishedAt || c.publishedHint)}`, storyKeyConfidence: 0.3, basis: 'title-tokens' };
  }
  return { storyKey: '', storyKeyConfidence: 0, basis: 'none' };
}

// Jaccard ของ set
function jaccard(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/**
 * storySimilarity — ความคล้าย 0..1 ของสองเรื่อง (ชื่อ Jaccard + การกระทำตรง + เลขทับ)
 *   ออกแบบให้ "คนเดียวคนละเหตุการณ์" ได้คะแนนต่ำ (การกระทำต่าง → ดึงคะแนนลง)
 * @param {object} a - candidate
 * @param {object} b - candidate
 * @returns {number}
 */
export function storySimilarity(a, b) {
  const fa = normFingerprint((a || {}).fingerprint);
  const fb = normFingerprint((b || {}).fingerprint);
  const nameSim = jaccard(fa.names, fb.names);
  const actionSim = fa.action && fb.action ? (fa.action === fb.action ? 1 : jaccard(fa.action.split(/\s+/), fb.action.split(/\s+/))) : 0;
  const numSim = fa.numbers.length && fb.numbers.length ? jaccard(fa.numbers, fb.numbers) : 0;
  // ถ้าไม่มีชื่อร่วมเลย = คนละเรื่องแทบแน่ (คืนต่ำ) ; มีชื่อร่วม → ถ่วงด้วยการกระทำเป็นหลัก
  if (nameSim === 0) return Math.min(0.2, actionSim * 0.2);
  return Math.round((nameSim * 0.5 + actionSim * 0.4 + numSim * 0.1) * 1000) / 1000;
}

/**
 * mergeStorySources — รวมแหล่งรองเข้าเรื่องหลัก (primary คงเดิม + altSources/sourceCount/channels)
 *   canonical: คืน object ใหม่ที่ "id/url ของ primary คงเดิม" (ไม่เปลี่ยน) — ผู้เรียกใช้ id เดิมเสมอ
 * @param {object} primary
 * @param {object[]} duplicates
 * @returns {object} primary + { storyKey, storyKeyConfidence, altSources[], sourceCount, channels[] }
 */
export function mergeStorySources(primary, duplicates) {
  const p = primary || {};
  const dups = (Array.isArray(duplicates) ? duplicates : []).filter(Boolean);
  const identity = buildStoryIdentity(p);

  const channels = new Set();
  if (p.channel) channels.add(sanitizeText(p.channel, 20));
  const altSources = [];
  const seenUrl = new Set([lc(p.url)]);
  for (const d of dups) {
    const url = sanitizeText(d.url, 500);
    if (!url || seenUrl.has(lc(url))) continue;
    seenUrl.add(lc(url));
    if (d.channel) channels.add(sanitizeText(d.channel, 20));
    altSources.push({
      url,
      sourceHost: sanitizeText(d.sourceHost, 100),
      channel: sanitizeText(d.channel, 20),
      sourceType: sanitizeText(d.sourceType, 20),
      title: sanitizeText(d.title, 300),
    });
    if (altSources.length >= MAX_ALT_SOURCES) break;
  }

  return {
    ...p,
    storyKey: identity.storyKey,
    storyKeyConfidence: identity.storyKeyConfidence,
    altSources,
    sourceCount: 1 + altSources.length,
    channels: [...channels].filter(Boolean).slice(0, 10),
  };
}
