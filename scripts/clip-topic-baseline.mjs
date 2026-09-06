#!/usr/bin/env node
/** Read-only source analysis. Usage: node scripts/clip-topic-baseline.mjs [input.json] [report.json] */
import { readFile, writeFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromLegacyInsight } from '../src/lib/services/clipBrain/topicSchema.js';
import { BUREAUCRATIC_WORDS, countThaiWords, bureaucraticRate, scoreTopicDoc } from '../src/lib/services/clipBrain/topicMetrics.js';

const DEFAULT_INPUT = 'C:/tmp/news-pipeline-runtime-r133/data/clip-insights.json';
const DEFAULT_OUTPUT = 'C:/tmp/clip-topic-baseline.json';
const percent = (n, d) => d ? n / d * 100 : 0;
const mean = (values) => values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const chars = (text) => Array.from(typeof text === 'string' ? text : '').length;
const asciiJSON = (value) => JSON.stringify(value, null, 2).replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

function cohortReport(entries) {
  const records = entries.map(({ row, index }) => {
    const insight = row.insight;
    const doc = fromLegacyInsight(insight);
    const score = scoreTopicDoc(doc);
    const storyTexts = doc.stories.map((s) => s.story);
    return {
      index,
      id: row.id ?? null,
      rawDataWords: countThaiWords(insight.rawData),
      rawDataChars: chars(insight.rawData),
      rawDataBureaucratic: bureaucraticRate(insight.rawData),
      storyChars: storyTexts.map(chars),
      ...score,
    };
  });
  const stories = records.flatMap((r) => r.stories);
  const rawChars = records.reduce((sum, r) => sum + r.rawDataChars, 0);
  const storyChars = records.reduce((sum, r) => sum + r.storyChars.reduce((a, n) => a + n, 0), 0);
  return {
    recordCount: records.length,
    recordsWithoutStories: records.filter((r) => !r.stories.length).length,
    rawDataWordsMedian: median(records.map((r) => r.rawDataWords)),
    rawDataWordsMean: mean(records.map((r) => r.rawDataWords)),
    rawDataBureaucraticPer1000Chars: rawChars ? records.reduce((sum, r) => sum + r.rawDataBureaucratic * r.rawDataChars, 0) / rawChars : 0,
    storyCount: stories.length,
    storyWordsMedian: median(stories.map((s) => s.words)),
    storyWordsMean: mean(stories.map((s) => s.words)),
    storiesInRangePct: percent(stories.filter((s) => s.band === 'ok').length, stories.length),
    storyBands: Object.fromEntries(['short', 'ok', 'long'].map((band) => [band, stories.filter((s) => s.band === band).length])),
    storiesWithHighlightPct: percent(stories.filter((s) => s.hasHighlight).length, stories.length),
    storiesWithQuotePct: percent(stories.filter((s) => s.hasQuote).length, stories.length),
    longSentences: stories.reduce((sum, s) => sum + s.longSentences, 0),
    storyBureaucraticPer1000Chars: storyChars ? records.reduce((sum, r) => sum + r.stories.reduce((subtotal, s, i) => subtotal + s.bureaucratic * r.storyChars[i], 0), 0) / storyChars : 0,
    overlapPctMean: mean(records.map((r) => r.summary.overlapPct)),
    records,
  };
}

export function buildBaseline(rows) {
  if (!Array.isArray(rows)) throw new TypeError('Input must be an array of saved clip insight records');
  const groups = { brain: [], other: [] };
  const skippedIndices = [];
  rows.forEach((row, index) => {
    if (!row || !row.insight || typeof row.insight !== 'object' || Array.isArray(row.insight)) { skippedIndices.push(index); return; }
    groups[row.insight.brain ? 'brain' : 'other'].push({ row, index });
  });
  const cohorts = { brain: cohortReport(groups.brain), other: cohortReport(groups.other) };
  const reference = { recordCount: 45, rawDataWordsMedian: 1214, storyWordsMedian: 135, storiesInRangePct: 67, overlapPctMean: 2.4, storyBureaucraticPer1000Chars: 2.3 };
  return {
    schemaVersion: 1,
    totalRecords: rows.length,
    skippedIndices,
    methodology: {
      cohort: 'Truthy insight.brain = brain; all other valid insights = other. No date or length filter.',
      wordCount: 'Intl.Segmenter(th, word), isWordLike. Includes English/numeric words; no approximation.',
      runtime: { node: process.versions.node, icu: process.versions.icu, unicode: process.versions.unicode },
      storyUnit: 'Each legacy subStories entry, unchanged rawData. No new story when subStories is empty.',
      mainStory: 'Legacy mainStory is unknown: migration leaves it empty; zero words does not indicate an extraction failure.',
      evidence: 'Legacy migration creates no evidence; zero linked-fact coverage means unmeasured provenance, not false facts.',
      length: '100 through 170 words inclusive. Empty subStories entries are included.',
      sentenceUnit: 'Split at line breaks or sentence punctuation; decimal dots retained, spaces retained. Thai unpunctuated paragraphs remain one unit.',
      overlap: 'Per clip: repeated eligible units beyond first story / unique eligible units per story. Key = first 40 normalized Unicode characters, ignoring whitespace/punctuation. Shorter units ignored. Cohort value = arithmetic mean over all records, including zero-story records. Clips are never compared to each other.',
      bureaucratic: 'Longest non-overlapping literal dictionary matches per 1000 Unicode characters including whitespace/punctuation. Cohort rate is weighted by characters. Report rawData and stories separately.',
      bureaucraticWords: BUREAUCRATIC_WORDS,
      referenceCaveat: 'Claude reference supplied by design brief; its exact dictionary, sentence splitting, and overlap denominator are unavailable. Rate differences are not evidence of content regression. The reference rate 2.3 is compared to stories here; rawData rate is also reported.',
    },
    cohorts,
    comparisonToClaudeReference: Object.fromEntries(Object.entries(reference).map(([metric, expected]) => [metric, {
      reference: expected,
      measured: cohorts.brain[metric],
      delta: cohorts.brain[metric] === null ? null : cohorts.brain[metric] - expected,
    }])),
  };
}

async function run() {
  const input = path.resolve(process.argv[2] || DEFAULT_INPUT);
  const output = path.resolve(process.argv[3] || DEFAULT_OUTPUT);
  const inputReal = await realpath(input);
  let outputReal;
  try { outputReal = await realpath(output); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const inputStat = await stat(inputReal);
  const outputStat = outputReal ? await stat(outputReal) : null;
  if (input === output || inputReal === outputReal || (outputStat && inputStat.dev === outputStat.dev && inputStat.ino === outputStat.ino)) {
    throw new Error('Refusing to overwrite the source dataset with a report');
  }
  const bytes = await readFile(inputReal);
  const rows = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  const report = buildBaseline(rows);
  report.source = { path: inputReal, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  await writeFile(output, `${asciiJSON(report)}\n`, 'utf8');
  const compact = Object.fromEntries(Object.entries(report.cohorts).map(([name, { records, ...summary }]) => [name, { ...summary, measuredRecords: records.length }]));
  process.stdout.write(`${asciiJSON({ report: output, sourceSha256: report.source.sha256, cohorts: compact, comparisonToClaudeReference: report.comparisonToClaudeReference })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(asciiJSON({ success: false, errorType: 'CLIP_TOPIC_BASELINE_ERROR', error: String(error.message || error) }));
    process.exitCode = 1;
  });
}
