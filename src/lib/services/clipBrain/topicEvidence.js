/** Pipeline evidence only. No AI/application imports and no inferred identities/times. */
const list = (v) => Array.isArray(v) ? v : [];
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' ? v : '';
const MAX_PACK_CHARS = 60000;
const words = new Intl.Segmenter('th', { granularity: 'word' });

function chunks(raw) {
  const chars = Array.from(raw);
  const result = [];
  let start = 0;
  while (chars.length - start > 500) {
    const window = chars.slice(start, start + 500).join('');
    let size = [...window.matchAll(/(?:\r?\n|[.!?。！？](?!\d))\s*/gu)]
      .map((m) => Array.from(window.slice(0, m.index + m[0].length)).length)
      .filter((n) => n >= 300 && n <= 500).at(-1);
    if (!size) {
      for (const part of words.segment(window)) {
        const end = Array.from(window.slice(0, part.index + part.segment.length)).length;
        if (end >= 300 && end < 500) size = end;
      }
    }
    size ||= 500;
    result.push(chars.slice(start, start + size).join(''));
    start += size;
  }
  if (start < chars.length) result.push(chars.slice(start).join(''));
  return result;
}

function seconds(value) {
  if (Number.isFinite(value) && value >= 0) return value;
  if (!/^\d+:\d{2}(?::\d{2})?(?:\.\d+)?$/.test(text(value).trim())) return null;
  const parts = value.trim().split(':').map(Number);
  if (parts.slice(1).some((v) => v >= 60)) return null;
  const n = parts.reduce((sum, v) => sum * 60 + v, 0);
  return Number.isFinite(n) ? n : null;
}

function timeRange(value) {
  let startSec, endSec;
  if (object(value)) {
    startSec = seconds(value.startSec);
    endSec = seconds(value.endSec);
  } else {
    const parts = text(value).split(/\s*[-–—]\s*/u);
    if (parts.length > 2) return null;
    startSec = seconds(parts[0]);
    endSec = parts.length === 2 ? seconds(parts[1]) : null;
    if (parts.length === 2 && endSec === null) return null;
  }
  if (startSec === null || (endSec !== null && endSec <= startSec)) return null;
  // A point timestamp never manufactures an end from the next row or clip length.
  return { startSec, endSec };
}

function entryText(value) {
  if (typeof value === 'string') return value;
  const meaningful = (v) => typeof v === 'string' ? !!v.trim()
    : Array.isArray(v) ? v.some(meaningful)
      : object(v) ? Object.values(v).some(meaningful) : v !== null && v !== undefined;
  return object(value) && meaningful(value) ? JSON.stringify(value) : '';
}

function missingRanges(planned, results) {
  const full = (v) => { const r = timeRange(v); return r?.endSec !== null && r ? [r] : []; };
  const covered = results.filter((x) => x?.r?.ok).flatMap((x) => full(x.seg));
  const gaps = list(planned).flatMap(full).flatMap((range) => {
    let remaining = [range];
    for (const cover of covered) {
      remaining = remaining.flatMap((part) => {
        if (cover.endSec <= part.startSec || cover.startSec >= part.endSec) return [part];
        return [
          ...(cover.startSec > part.startSec ? [{ startSec: part.startSec, endSec: cover.startSec }] : []),
          ...(cover.endSec < part.endSec ? [{ startSec: cover.endSec, endSec: part.endSec }] : []),
        ];
      });
    }
    return remaining;
  }).sort((a, b) => a.startSec - b.startSec);
  const merged = [];
  for (const gap of gaps) {
    const last = merged.at(-1);
    if (last && gap.startSec <= last.endSec) last.endSec = Math.max(last.endSec, gap.endSec);
    else merged.push({ ...gap });
  }
  return merged;
}

export function buildEvidencePackFromPipeline({ truth, segmentResults, plannedSegments, map, durSec, clipMeta } = {}) {
  if (typeof truth === 'string') {
    try { truth = JSON.parse(truth); } catch { truth = { transcription: truth }; }
  }
  const evidence = [];
  const counts = {};
  const prefixes = { transcript: 't', screen: 'x', substory: 's', segment: 'g', quote: 'q', timeline: 'l' };
  const add = (kind, value, meta = {}) => {
    const body = entryText(value);
    if (!body.trim()) return;
    counts[kind] = (counts[kind] || 0) + 1;
    evidence.push({ id: prefixes[kind] + counts[kind], kind, text: body,
      provenance: kind === 'transcript' || kind === 'screen' ? 'truth' : 'ai-summary', ...meta });
  };
  const transcription = typeof truth?.transcription === 'string'
    ? [{ text: truth.transcription }] : list(truth?.transcription);
  for (const row of transcription) {
    const body = typeof row === 'string' ? row : text(row?.text);
    if (!body.trim()) continue;
    const name = text(row?.speaker).trim();
    const speaker = !name || /^(?:unknown|ไม่ทราบ|ไม่ระบุ|ไม่ทราบชื่อ|\?+|[-–—])$/iu.test(name) ? null : name;
    for (const chunk of chunks(body)) add('transcript', chunk, { timeRange: timeRange(row?.timeRange ?? row?.time), speaker });
  }
  for (const row of list(truth?.onScreenText)) {
    add('screen', row, { timeRange: timeRange(row?.timeRange ?? row?.time) });
  }
  const results = list(segmentResults);
  for (const { seg, r } of results.filter((x) => x?.r?.ok)) {
    const meta = { sourceNo: seg?.no ?? null, timeRange: timeRange(seg) };
    for (const sub of list(r.data?.subStories)) {
      add('substory', sub, { ...meta, timeRange: timeRange(sub?.timeRange) });
    }
    add('segment', r.data?.rawData, meta);
    for (const quote of list(r.data?.quotes)) {
      add('quote', quote, { ...meta, speaker: text(quote?.speaker).trim() || null });
    }
  }
  for (const row of list(map?.timeline)) add('timeline', row, { timeRange: timeRange(row?.timeRange ?? row?.time) });
  const pack = {
    clipMeta: { ...(object(clipMeta) ? structuredClone(clipMeta) : {}),
      clipDurationSec: Number.isFinite(durSec) && durSec > 0 ? durSec : null,
      missingRanges: missingRanges(plannedSegments, results) },
    evidence,
  };
  if (JSON.stringify(pack).length > MAX_PACK_CHARS) {
    pack.clipMeta.evidenceTruncated = true;
    // Bound the serialized pack, including metadata. Drop redundant AI summaries
    // before losing any transcript; kept evidence entries are never paraphrased.
    let size = JSON.stringify(pack).length;
    const removed = new Set();
    for (const kind of ['segment', 'timeline', 'substory', 'quote', 'screen', 'transcript']) {
      for (let i = evidence.length - 1; i >= 0 && size > MAX_PACK_CHARS; i--) {
        if (evidence[i].kind !== kind) continue;
        size -= JSON.stringify(evidence[i]).length + (evidence.length - removed.size > 1 ? 1 : 0);
        removed.add(i);
      }
    }
    pack.evidence = evidence.filter((_, i) => !removed.has(i));
    if (JSON.stringify(pack).length > MAX_PACK_CHARS) throw new Error('TOPIC_EVIDENCE_METADATA_TOO_LARGE');
  }
  return pack;
}
