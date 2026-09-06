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

export function lengthBand(words) {
  return words < 100 ? 'short' : words <= 170 ? 'ok' : 'long';
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
    },
  };
}
