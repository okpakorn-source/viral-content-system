/** Deterministic diagnostics only. Never truncates, rewrites, or rejects stories. */
const wordSegmenter = new Intl.Segmenter('th', { granularity: 'word' });
const asText = (value) => typeof value === 'string' ? value : '';
const list = (value) => Array.isArray(value) ? value : [];
const pct = (part, total) => total ? part / total * 100 : 0;

/** Exact ICU/Intl count, including mixed Thai/English/numbers; empty text is zero.
 * Requires Intl.Segmenter: no approximate fallback that would skew the baseline.
 */
export function countThaiWords(text) {
  let words = 0;
  for (const segment of wordSegmenter.segment(asText(text))) if (segment.isWordLike) words++;
  return words;
}

// ★ 8 ก.ย. 69 (เจ้าของ: "เกินได้ ไม่ต้องจำกัดกรอบ"): เพดานบน 170 ปลดออก เหลือขั้นต่ำ 100 คำ
//   ปรับได้ด้วย env CLIP_TOPIC_WORDS_MIN / CLIP_TOPIC_WORDS_MAX (0 หรือไม่ตั้ง = ไม่จำกัดเพดาน) — ทุกจุดที่พูดถึงกรอบคำต้องอ่านจากที่นี่
const envInt = (key, def) => { const raw = String(process.env[key] ?? '').trim(); if (!raw) return def; const n = Number(raw); return Number.isInteger(n) && n >= 0 ? n : def; };
export function wordRange() {
  const min = Math.max(1, envInt('CLIP_TOPIC_WORDS_MIN', 100));
  const max = envInt('CLIP_TOPIC_WORDS_MAX', 0);
  return { min, max: max > min ? max : 0 };
}
export function wordRangeLabel() {
  const { min, max } = wordRange();
  return max ? `${min}–${max} คำ` : `อย่างน้อย ${min} คำ`;
}
export function lengthBand(words) {
  const { min, max } = wordRange();
  return words < min ? 'short' : (max && words > max) ? 'long' : 'ok';
}

export const BUREAUCRATIC_WORDS = Object.freeze([
  'ดังกล่าว', 'ทั้งนี้', 'อย่างไรก็ตาม', 'นอกจากนี้', 'ขณะเดียวกัน',
  'สำหรับ', 'โดยระบุว่า', 'ได้กล่าวว่า', 'กล่าวเพิ่มเติมว่า', 'ในส่วนของ',
  'เนื่องจาก', 'จึงทำให้', 'ส่งผลให้', 'อันเนื่องมาจาก', 'ภายหลังจาก',
  'ในขณะที่', 'ในการนี้', 'ดำเนินการ', 'ดำเนินงาน', 'บูรณาการ',
  'กรณีดังกล่าว', 'เพื่อให้เกิด', 'เป็นที่เรียบร้อย', 'ตามที่ได้',
]);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Literal, non-overlapping occurrences per 1,000 Unicode characters, INCLUDING
 * whitespace/punctuation. opts.words replaces the dictionary. Longest match wins
 * when terms overlap (e.g. กรณีดังกล่าว / ดังกล่าว); repeated terms count each time.
 */
export function bureaucraticRate(text, opts = {}) {
  const body = asText(text);
  const chars = Array.from(body).length;
  const words = [...new Set(list(opts.words ?? BUREAUCRATIC_WORDS).filter((w) => typeof w === 'string' && w.length))].sort((a, b) => b.length - a.length);
  if (!chars || !words.length) return 0;
  const pattern = new RegExp(words.map(escapeRegex).join('|'), 'gu');
  return Array.from(body.matchAll(pattern)).length / chars * 1000;
}

/** Sentence proxy: punctuation or line/paragraph boundaries, not ordinary spaces.
 * Keep decimal dots intact. Thai prose without punctuation is one unit per line;
 * abbreviations may split units. This is a reproducible style metric, not parsing.
 */
function sentences(text) {
  return asText(text).split(/(?:[!?;…。！？]+|\.(?!\d)|[\r\n]+)/u).map((s) => s.trim()).filter(Boolean);
}

export function longSentenceCount(text, maxWords = 60) {
  return sentences(text).filter((sentence) => countThaiWords(sentence) > maxWords).length;
}

/** ★ 9 ก.ย. 69 (เจ้าของ: "ใจความล้วน ไม่อ้างที่มา ไม่มีคำเฟ้อ/คำเปรย ลบประโยคเร้าอารมณ์"): พจนานุกรมสำนวนที่ห้ามในเนื้อเรื่อง
 * นับแบบตัวอักษรตรงตัว ไม่ซ้อนกัน คำยาวชนะ (เหมือน bureaucraticRate) — เป็นตัววัดเชิงสไตล์ที่ทำซ้ำได้ ไม่ใช่การเข้าใจภาษา
 * attribution = คำอ้างที่มาในเนื้อเรื่อง · dramatic = คำเปรย/แต่งท่าที/เร้าอารมณ์ · filler = คำเฟ้อที่ตัดได้เสมอ · meta = เล่ากล้อง/เล่าคลิปแทนเล่าเนื้อ
 * (คำถม ก็/ยัง/แล้ว/อยู่ ไม่อยู่ในด่าน เพราะมักทำหน้าที่ไวยากรณ์ — คุมผ่านพรอมต์แทน)
 */
export const STYLE_WORDS = Object.freeze({
  attribution: Object.freeze(['เล่าว่า', 'บอกว่า', 'ยืนยันว่า', 'ระบุว่า', 'เผยว่า', 'กล่าวว่า', 'ย้ำว่า', 'รับว่า', 'ยอมรับว่า', 'มองว่า', 'อธิบายว่า', 'ตอบว่า', 'ชี้ว่า', 'เสริมว่า', 'ออกตัวว่า', 'นิยามตัวเองว่า', 'คิดว่า', 'ถือว่า', 'บอกตรงๆ ว่า', 'เล่าให้ฟังว่า']),
  dramatic: Object.freeze(['ถึงกับ', 'ทันที', 'ตรงๆ', 'ชัดเจน', 'เหนียวแน่น', 'น้ำตาคลอ', 'สะเทือนใจ', 'ซาบซึ้ง', 'สุดซึ้ง', 'ใจสลาย', 'อบอุ่นหัวใจ', 'สุดยอด', 'อย่างมาก', 'อย่างยิ่ง', 'เหลือเชื่อ', 'ไม่น่าเชื่อ', 'น่าทึ่ง', 'สุดๆ', 'ท่วมท้น', 'ปลื้มปริ่ม', 'น่าประทับใจ', 'อย่างน่าอัศจรรย์']),
  filler: Object.freeze(['ทั้งนี้', 'ดังกล่าว', 'พยายาม', 'เอาไว้ด้วย', 'สักหน่อย', 'สักผืน', 'สักแปลง', 'กลายเป็น', 'เป็นการ', 'อยู่เป็นประจำ', 'ต่อไปเรื่อยๆ', 'เรื่อยๆ', 'ไปหมด', 'เท่านั้นเอง', 'นั่นเอง', 'ไม่น้อย', 'แต่ละครั้ง']),
  meta: Object.freeze(['คลิปเริ่มจาก', 'ในคลิป', 'ปิดท้ายด้วย', 'คลิปปิดท้าย', 'ข้อความบนหน้าจอ', 'บนหน้าจอ', 'ช่วงท้ายคลิป', 'ต้นคลิป', 'หน้ากล้อง', 'กำกับไว้ตรงกัน']),
});
export const STYLE_MAX_SENTENCE_WORDS = 25;
export const STYLE_FILLER_PER_100 = 1;

function countTerms(body, terms) {
  const words = [...new Set(terms)].sort((a, b) => b.length - a.length);
  if (!body || !words.length) return [];
  const pattern = new RegExp(words.map(escapeRegex).join('|'), 'gu');
  return Array.from(body.matchAll(pattern)).map((m) => m[0]);
}

/** รายงานสำนวนของข้อความหนึ่งท่อน: จำนวนและคำที่เจอต่อหมวด + ประโยคยาว + คำเฟ้อต่อ 100 คำ */
export function styleReport(text) {
  const body = asText(text);
  const words = countThaiWords(body);
  const found = Object.fromEntries(Object.entries(STYLE_WORDS).map(([k, terms]) => [k, countTerms(body, terms)]));
  const longSentences = longSentenceCount(body, STYLE_MAX_SENTENCE_WORDS);
  return {
    words,
    attribution: found.attribution.length, dramatic: found.dramatic.length, filler: found.filler.length, meta: found.meta.length,
    fillerPer100: words ? found.filler.length / words * 100 : 0,
    longSentences,
    matches: found,
  };
}

/** ข้อบกพร่องสำนวน 2 ระดับ (ว่าง = ผ่าน)
 *   hard = ผิดกติกาใจความล้วนโดยตรง → ตกด่าน ต้องซ่อม: อ้างที่มา 0 · คำเปรย/เร้าอารมณ์ 0 · เล่ากล้อง 0
 *   soft = ความสวยของสำนวน → เป็น "ข้อสังเกตความพร้อม" ให้คนเห็น ไม่ทิ้งทั้งฉบับ: ประโยค > 25 คำ · คำเฟ้อ > 1 ต่อ 100 คำ
 *   (★ 9 ก.ย. 69 บทเรียนคลิป 53 นาที: ฉบับดีทั้ง 10 เรื่องถูกทิ้งเพราะประโยคยาว 8 ประโยค เสีย 38 นาที)
 */
export function styleIssues(report, { level = 'all' } = {}) {
  const r = report || styleReport('');
  const hard = [];
  const soft = [];
  const show = (arr) => [...new Set(arr)].slice(0, 4).join(' / ');
  if (r.attribution > 0) hard.push(`อ้างที่มาในเนื้อเรื่อง ${r.attribution} ครั้ง (${show(r.matches.attribution)}) — เล่าเป็นเหตุการณ์ตรงๆ หรือย้ายไป quotes`);
  if (r.dramatic > 0) hard.push(`คำเปรย/เร้าอารมณ์ ${r.dramatic} ครั้ง (${show(r.matches.dramatic)}) — ตัดออกทั้งวลี`);
  if (r.meta > 0) hard.push(`เล่ากล้อง/เล่าคลิป ${r.meta} ครั้ง (${show(r.matches.meta)}) — เล่าเนื้อหาแทน`);
  if (r.longSentences > 0) soft.push(`ประโยคยาวเกิน ${STYLE_MAX_SENTENCE_WORDS} คำ ${r.longSentences} ประโยค — แบ่งประโยค`);
  if (r.fillerPer100 > STYLE_FILLER_PER_100) soft.push(`คำเฟ้อ ${r.filler} ครั้ง (${show(r.matches.filler)}) เกิน ${STYLE_FILLER_PER_100} ต่อ 100 คำ`);
  return level === 'hard' ? hard : level === 'soft' ? soft : [...hard, ...soft];
}

/** Compare the first 40 Unicode characters after NFKC/lowercase and removal of
 * whitespace/punctuation. Ignore shorter units. This flags candidate duplicates,
 * including equal prefixes with different endings; it is not a semantic verdict.
 * Denominator: unique eligible units within each story. Numerator: occurrences
 * in additional stories beyond the first. A unit in 3 stories contributes 2/3,
 * with all three pair combinations reported. Never compares different clips.
 */
export function crossStoryOverlap(stories) {
  const seen = new Map();
  const pairs = [];
  let total = 0;
  let repeated = 0;
  list(stories).forEach((story, index) => {
    const local = new Set();
    for (const sentence of sentences(story?.story)) {
      const normalized = Array.from(sentence.normalize('NFKC').toLowerCase().replace(/[\s\p{P}]+/gu, ''));
      if (normalized.length < 40) continue;
      const key = normalized.slice(0, 40).join('');
      if (local.has(key)) continue;
      local.add(key);
      total++;
      const previous = seen.get(key) || [];
      if (previous.length) repeated++;
      for (const other of previous) pairs.push({ a: other.id, b: story?.id ?? index, sentence: other.sentence });
      previous.push({ id: story?.id ?? index, sentence });
      seen.set(key, previous);
    }
  });
  return { pct: pct(repeated, total), pairs };
}

export function scoreTopicDoc(doc) {
  const evidenceIds = new Set(list(doc?.evidence).map((e) => e?.id).filter((id) => typeof id === 'string' && id.trim()));
  const stories = list(doc?.stories).map((s) => {
    const words = countThaiWords(s?.story);
    const facts = list(s?.facts);
    const linked = facts.filter((f) => list(f?.evidenceIds).length > 0 && f.evidenceIds.every((id) => evidenceIds.has(id))).length;
    return {
      id: s?.id,
      words,
      band: lengthBand(words),
      bureaucratic: bureaucraticRate(s?.story),
      longSentences: longSentenceCount(s?.story),
      style: styleReport(s?.story),
      hasHighlight: !!asText(s?.highlight).trim(),
      hasQuote: list(s?.quotes).some((q) => !!asText(q?.text).trim()),
      factsWithEvidencePct: pct(linked, facts.length),
    };
  });
  const mainStoryWords = countThaiWords(doc?.mainStory);
  return {
    stories,
    summary: {
      storiesInRangePct: pct(stories.filter((s) => s.band === 'ok').length, stories.length),
      overlapPct: crossStoryOverlap(doc?.stories).pct,
      mainStoryWords,
      mainStoryBand: lengthBand(mainStoryWords),
      mainStoryStyle: styleReport(doc?.mainStory),
    },
  };
}
