/** Offline topic contract. No application/AI imports; safe to import with node --test. */
export const TOPIC_SCHEMA_VERSION = 2;

export function emptyTopicDoc() {
  return { schemaVersion: TOPIC_SCHEMA_VERSION, mainTopicId: null, mainStory: '', stories: [], evidence: [], identityLeads: [] };
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => Array.isArray(v) ? v : [];
const text = (v) => typeof v === 'string' ? v : '';
const hasText = (v) => typeof v === 'string' && v.trim().length > 0;
const copy = (v) => structuredClone(v);
const identityKey = (v) => text(v).normalize('NFKC').toLowerCase().replace(/[\s\u200b-\u200d\ufeff]+/gu, '');

/** Structural checks only: evidence references do not establish factual truth.
 * identityLeads contains unverified names: strings or {name, aliases?: string[]}.
 * Its literal-name guard also checks mainStory; it cannot detect unnamed paraphrases.
 */
export function validateTopicDoc(doc) {
  const errors = [];
  const fail = (path, msg) => errors.push({ path, msg });
  if (!isObject(doc)) return { ok: false, errors: [{ path: '$', msg: 'Expected a topic document object' }] };
  if (doc.schemaVersion !== TOPIC_SCHEMA_VERSION) fail('schemaVersion', 'Expected schema version 2');
  if (typeof doc.mainStory !== 'string') fail('mainStory', 'Expected a string');
  for (const field of ['stories', 'evidence', 'identityLeads']) {
    if (!Array.isArray(doc[field])) fail(field, 'Expected an array');
  }
  const stories = list(doc.stories);
  const collectIds = (items, path) => {
    const ids = new Set();
    items.forEach((item, i) => {
      if (!isObject(item)) { fail(`${path}[${i}]`, 'Expected an object'); return; }
      if (!hasText(item.id)) fail(`${path}[${i}].id`, 'Expected a nonempty ID');
      else if (ids.has(item.id)) fail(`${path}[${i}].id`, 'Duplicate ID');
      else ids.add(item.id);
    });
    return ids;
  };
  const storyIds = collectIds(stories, 'stories');
  const evidenceIds = collectIds(list(doc.evidence), 'evidence');
  if (doc.mainTopicId !== null || stories.length) {
    if (!hasText(doc.mainTopicId) || !storyIds.has(doc.mainTopicId)) fail('mainTopicId', 'Must reference an existing story');
  }
  const refs = (value, path) => {
    if (!Array.isArray(value)) { fail(path, 'Expected an array of evidence IDs'); return; }
    value.forEach((id, i) => {
      if (!hasText(id) || !evidenceIds.has(id)) fail(`${path}[${i}]`, 'Unknown evidence ID');
    });
  };
  const factIds = new Set();
  stories.forEach((s, i) => {
    if (!isObject(s)) return;
    const p = `stories[${i}]`;
    for (const field of ['topic', 'highlight', 'story']) {
      if (typeof s[field] !== 'string') fail(`${p}.${field}`, 'Expected a string');
    }
    for (const field of ['timeRanges', 'facts', 'quotes', 'overlaps']) {
      if (!Array.isArray(s[field])) fail(`${p}.${field}`, 'Expected an array');
    }
    if (s.sharePct !== null && !(typeof s.sharePct === 'number' && Number.isFinite(s.sharePct) && s.sharePct >= 0 && s.sharePct <= 100)) {
      fail(`${p}.sharePct`, 'Expected null or a finite percentage from 0 to 100');
    }
    if (typeof s.standalone !== 'boolean') fail(`${p}.standalone`, 'Expected a boolean');
    list(s.timeRanges).forEach((range, j) => {
      if (!isObject(range) || !Number.isFinite(range.startSec) || !Number.isFinite(range.endSec) || range.startSec < 0 || range.startSec >= range.endSec) {
        fail(`${p}.timeRanges[${j}]`, 'Expected finite seconds with 0 <= startSec < endSec');
      }
    });
    list(s.facts).forEach((f, j) => {
      const fp = `${p}.facts[${j}]`;
      if (!isObject(f)) { fail(fp, 'Expected a fact object'); return; }
      if (!hasText(f.id)) fail(`${fp}.id`, 'Expected a nonempty ID');
      else if (factIds.has(f.id)) fail(`${fp}.id`, 'Duplicate fact ID');
      else factIds.add(f.id);
      if (!hasText(f.text)) fail(`${fp}.text`, 'Expected nonempty fact text');
      if (!['speaker_statement', 'observed', 'on_screen', 'derived'].includes(f.kind)) fail(`${fp}.kind`, 'Invalid fact kind');
      refs(f.evidenceIds, `${fp}.evidenceIds`);
    });
    list(s.quotes).forEach((q, j) => {
      const qp = `${p}.quotes[${j}]`;
      if (!isObject(q)) { fail(qp, 'Expected a quote object'); return; }
      if (!hasText(q.text)) fail(`${qp}.text`, 'Expected nonempty quote text');
      if (typeof q.speaker !== 'string') fail(`${qp}.speaker`, 'Expected a string (empty if unknown)');
      if (!['verified', 'pending', 'unverified'].includes(q.verification)) fail(`${qp}.verification`, 'Invalid quote verification');
      refs(q.evidenceIds, `${qp}.evidenceIds`);
    });
    list(s.overlaps).forEach((overlap, j) => {
      const op = `${p}.overlaps[${j}]`;
      if (!isObject(overlap)) { fail(op, 'Expected an overlap object'); return; }
      if (!storyIds.has(overlap.storyId) || overlap.storyId === s.id) fail(`${op}.storyId`, 'Must reference a different existing story');
      if (!['duplicate', 'shared_context', 'follow_up'].includes(overlap.kind)) fail(`${op}.kind`, 'Invalid overlap kind');
    });
    if (!isObject(s.quality)) fail(`${p}.quality`, 'Expected a quality object');
    else {
      if (!['not_checked', 'checked'].includes(s.quality.status)) fail(`${p}.quality.status`, 'Invalid quality status');
      if (!Array.isArray(s.quality.issues)) fail(`${p}.quality.issues`, 'Expected an array');
    }
  });
  const leadNames = [];
  list(doc.identityLeads).forEach((lead, i) => {
    const p = `identityLeads[${i}]`;
    if (hasText(lead)) leadNames.push(lead);
    else if (isObject(lead) && hasText(lead.name)) {
      leadNames.push(lead.name);
      if (lead.aliases !== undefined && (!Array.isArray(lead.aliases) || !lead.aliases.every(hasText))) fail(`${p}.aliases`, 'Expected nonempty name strings');
      else leadNames.push(...list(lead.aliases));
    } else fail(p, 'Expected an unverified name string or {name, aliases?}');
  });
  const checkLeak = (value, path) => {
    const key = identityKey(value);
    if (leadNames.some((name) => key.includes(identityKey(name)))) fail(path, 'Unverified identity lead appears in publishable text');
  };
  checkLeak(doc.mainStory, 'mainStory');
  stories.forEach((s, i) => {
    for (const field of ['topic', 'highlight', 'story']) checkLeak(s?.[field], `stories[${i}].${field}`);
  });
  return { ok: errors.length === 0, errors };
}

/** Return a copy. Each share uses the union of that story's ranges / clip duration.
 * Ranges are clipped to [0, duration]. Different stories may share time, so totals
 * need not equal 100. Unknown duration or no usable ranges yields null.
 */
export function computeSharePct(doc, clipDurationSec) {
  const result = copy(doc);
  const durationKnown = Number.isFinite(clipDurationSec) && clipDurationSec > 0;
  result.stories = list(result.stories).map((s) => {
    const ranges = list(s.timeRanges).filter((r) => Number.isFinite(r?.startSec) && Number.isFinite(r?.endSec) && r.startSec < r.endSec);
    if (!durationKnown || !ranges.length) return { ...s, sharePct: null };
    const clipped = ranges.map((r) => [Math.max(0, Math.min(clipDurationSec, r.startSec)), Math.max(0, Math.min(clipDurationSec, r.endSec))]).sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let end = 0;
    for (const [start, stop] of clipped) {
      covered += Math.max(0, stop - Math.max(start, end));
      end = Math.max(end, stop);
    }
    return { ...s, sharePct: covered / clipDurationSec * 100 };
  });
  return result;
}

function formatTime(sec) {
  const minutes = Math.floor(sec / 60);
  const seconds = Number((sec - minutes * 60).toFixed(6));
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function parseTimeRanges(value) {
  const stamp = '(?:\\d+:)?\\d+:\\d{2}(?:\\.\\d+)?';
  const pattern = new RegExp(`^\\s*(${stamp})\\s*[-–—]\\s*(${stamp})\\s*$`, 'u');
  const seconds = (stampText) => {
    const parts = stampText.split(':').map(Number);
    if (parts.slice(1).some((n) => n >= 60)) return NaN;
    return parts.reduce((sum, n) => sum * 60 + n, 0);
  };
  return text(value).split(',').flatMap((part) => {
    const match = part.match(pattern);
    if (!match) return [];
    const startSec = seconds(match[1]);
    const endSec = seconds(match[2]);
    return Number.isFinite(startSec) && Number.isFinite(endSec) && startSec < endSec ? [{ startSec, endSec }] : [];
  });
}

const quoteText = (q) => typeof q === 'string' ? q : text(q?.text) || text(q?.quote);

/** Mirror accepted legacy repairs by stable story ID, without mutating the input.
 * An edited quote loses prior attribution/verification; exact surviving quotes
 * retain their evidence. Unmapped stories and unrelated document fields survive.
 */
export function syncTopicsV2FromLegacy(insight) {
  const result = copy(insight);
  const changed = [];
  if (!isObject(result?.topicsV2) || result.topicsV2.schemaVersion !== 2) return { insight: result, changed };
  const doc = result.topicsV2;
  const set = (owner, field, value, path) => {
    if (JSON.stringify(owner[field]) === JSON.stringify(value)) return;
    owner[field] = copy(value);
    changed.push(path);
  };
  const legacyById = new Map(list(result.subStories).filter((s) => hasText(s?.storyId)).map((s) => [s.storyId, s]));
  let repairedMain = false;
  list(doc.stories).forEach((story, i) => {
    const legacy = legacyById.get(story?.id);
    if (!legacy || !isObject(story)) return;
    const path = `topicsV2.stories[${i}]`;
    if (story.id === doc.mainTopicId && typeof legacy.rawData === 'string' && legacy.rawData !== story.story) repairedMain = true;
    for (const [from, to] of [['topic', 'topic'], ['rawData', 'story'], ['directLead', 'highlight']]) {
      if (typeof legacy[from] === 'string') set(story, to, legacy[from], `${path}.${to}`);
    }
    if (typeof legacy.directLead === 'string' && Object.hasOwn(legacy, 'highlight')) {
      const index = result.subStories.indexOf(legacy);
      set(legacy, 'highlight', legacy.directLead, `subStories[${index}].highlight`);
    }
    if (Array.isArray(legacy.quotes)) {
      const existing = list(story.quotes);
      const quotes = legacy.quotes.filter((q) => typeof q === 'string').map((value) =>
        existing.find((q) => q.text === value) || { text: value, speaker: '', evidenceIds: [], verification: 'pending' });
      set(story, 'quotes', quotes, `${path}.quotes`);
    }
  });
  // mainStory is a separate narrative. Preserve it and flag the need for review;
  // a repaired topic cannot safely replace the whole narrative automatically.
  if (repairedMain) set(doc, 'mainStoryStale', true, 'topicsV2.mainStoryStale');
  return { insight: result, changed, ...(doc.mainStoryStale === true ? { mainStoryStale: true } : {}) };
}

/** Preserve the full legacy archive and unrelated fields, then project only v2
 * presentation fields. The v2 document and base insight remain independently owned.
 * Apply after legacy normalization in any future integration (not wired up in P1).
 */
export function toLegacyInsight(doc, baseInsight = {}) {
  const base = isObject(baseInsight) ? copy(baseInsight) : {};
  const topicsV2 = copy(doc);
  const stories = list(topicsV2.stories);
  const main = stories.find((s) => s.id === topicsV2.mainTopicId);
  return {
    ...base,
    headline: hasText(base.headline) ? base.headline : text(main?.topic),
    quotes: list(base.quotes).map(quoteText).filter(hasText),
    mainStory: topicsV2.mainStory,
    topicsV2,
    subStories: stories.map((s) => ({
      topic: s.topic,
      timeRange: list(s.timeRanges).map((r) => `${formatTime(r.startSec)}–${formatTime(r.endSec)}`).join(', '),
      directLead: s.highlight,
      rawData: s.story,
      quotes: list(s.quotes).map((q) => q.text),
      keyPoints: list(s.facts).map((f) => f.text),
      storyId: s.id,
      highlight: s.highlight,
      sharePct: s.sharePct,
      standalone: s.standalone,
      overlaps: copy(s.overlaps),
      quality: copy(s.quality),
    })),
  };
}

/** Conservative migration: keep all legacy subStories, including empty ones.
 * No fabricated evidence, quote verification, main story, or new story splitting.
 * Call toLegacyInsight(doc, originalInsight) to retain the full legacy envelope.
 */
export function fromLegacyInsight(insight) {
  const doc = emptyTopicDoc();
  const used = new Set();
  const reserved = new Set(list(insight?.subStories).map((s) => s?.storyId).filter(hasText));
  doc.stories = list(insight?.subStories).map((s, i) => {
    let id = text(s?.storyId);
    if (!id || used.has(id)) {
      id = `s${i + 1}`;
      while (used.has(id) || reserved.has(id)) id += '_';
    }
    used.add(id);
    return {
      id,
      topic: text(s?.topic),
      timeRanges: parseTimeRanges(s?.timeRange),
      sharePct: Number.isFinite(s?.sharePct) && s.sharePct >= 0 && s.sharePct <= 100 ? s.sharePct : null,
      highlight: text(s?.directLead) || text(s?.highlight),
      story: text(s?.rawData),
      facts: list(s?.keyPoints).map((f) => typeof f === 'string' ? f : text(f?.point)).filter(hasText).map((value, j) => ({ id: `${id}-f${j + 1}`, text: value, kind: 'speaker_statement', evidenceIds: [] })),
      quotes: list(s?.quotes).map(quoteText).filter(hasText).map((value) => ({ text: value, speaker: '', evidenceIds: [], verification: 'pending' })),
      standalone: s?.standalone === true,
      overlaps: [],
      quality: { status: 'not_checked', issues: [] },
    };
  });
  doc.mainTopicId = doc.stories[0]?.id ?? null;
  return doc;
}
