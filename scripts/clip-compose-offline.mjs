#!/usr/bin/env node
/** Offline archive-only P2 experiment. Never fetches video or invokes Gemini. */
import { readFile, writeFile, open, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEvidencePack, buildComposePrompt, composeTopics } from '../src/lib/services/clipBrain/composeTopics.js';
import { fromLegacyInsight } from '../src/lib/services/clipBrain/topicSchema.js';
import { scoreTopicDoc, bureaucraticRate } from '../src/lib/services/clipBrain/topicMetrics.js';

const DEFAULT_INPUT = 'C:/tmp/news-pipeline-runtime-r133/data/clip-insights.json';
const PRIMARY = { brain: 'codex', model: 'gpt-6-astra', effort: 'ultra' };
const FALLBACK = { brain: 'claude', model: 'claude-fable-5', effort: 'max' };
const chars = (s) => Array.from(s || '').length;
const pct = (n, d) => d ? n / d * 100 : 0;
const mean = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
function distribution(values) {
  if (!values.length) return { min: null, median: null, max: null };
  const v = [...values].sort((a, b) => a - b), mid = Math.floor(v.length / 2);
  return { min: v[0], median: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2, max: v.at(-1) };
}

function inputError(message) {
  const error = new Error(message);
  error.name = 'OfflineInputError';
  return error;
}

export function parseArgs(argv) {
  const options = { input: DEFAULT_INPUT, dryRun: false };
  const flags = new Map([['--input', 'input'], ['--limit', 'limit'], ['--ids', 'ids'], ['--brain', 'brain'], ['--model', 'model'], ['--effort', 'effort'], ['--out', 'out'], ['--timeout-ms', 'timeoutMs']]);
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) throw inputError(`Duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === '--dry-run') { options.dryRun = true; continue; }
    if (flag === '--no-fallback') { options.noFallback = true; continue; }
    const key = flags.get(flag);
    if (!key) throw inputError(`Unknown option: ${flag}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw inputError(`Missing value: ${flag}`);
    options[key] = value;
  }
  if (options.limit !== undefined) {
    if (!/^[1-9]\d*$/.test(options.limit) || !Number.isSafeInteger(Number(options.limit))) throw inputError('--limit must be a positive safe integer');
    options.limit = Number(options.limit);
  }
  if (options.brain && !['codex', 'claude'].includes(options.brain)) throw inputError('--brain must be codex or claude');
  if (options.model && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(options.model)) throw inputError('Invalid --model');
  if (options.effort && !['low', 'medium', 'high', 'xhigh', 'ultra', 'max'].includes(options.effort)) throw inputError('Invalid --effort');
  if (options.timeoutMs !== undefined) {
    if (!/^[1-9][0-9]*$/.test(options.timeoutMs)) throw inputError('--timeout-ms must be a positive integer (milliseconds)');
    options.timeoutMs = Number(options.timeoutMs);
  }
  if (options.ids !== undefined) {
    options.ids = [...new Set(options.ids.split(',').map((s) => s.trim()))];
    if (options.ids.some((s) => !s)) throw inputError('--ids contains an empty ID');
  }
  if (!options.dryRun && !options.out) throw inputError('Real composition requires --out before any AI call; default batch is 5. Inspect all records with --dry-run first.');
  return options;
}

function aggregate(docs) {
  const metrics = docs.map(scoreTopicDoc);
  const stories = metrics.flatMap((m) => m.stories);
  const texts = docs.flatMap((d) => d.stories.map((s) => s.story));
  const totalChars = texts.reduce((n, s) => n + chars(s), 0);
  return {
    records: docs.length, stories: stories.length,
    inRangePct: pct(stories.filter((s) => s.band === 'ok').length, stories.length),
    highlightPct: pct(stories.filter((s) => s.hasHighlight).length, stories.length),
    mainStoryOkPct: pct(metrics.filter((m) => m.summary.mainStoryBand === 'ok').length, docs.length),
    overlapPctMean: mean(metrics.map((m) => m.summary.overlapPct)),
    bureaucraticPer1000Chars: totalChars ? texts.reduce((n, s) => n + bureaucraticRate(s) * chars(s), 0) / totalChars : 0,
  };
}

export async function runOffline(argv, { runBrain } = {}) {
  const options = parseArgs(argv);
  const input = await realpath(path.resolve(options.input));
  const bytes = await readFile(input);
  const rows = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  if (!Array.isArray(rows)) throw inputError('Input must be an array of saved clip records');
  const cohort = rows.filter((r) => r?.insight && typeof r.insight === 'object' && !Array.isArray(r.insight) && r.insight.brain);
  let selected = cohort;
  if (options.ids) {
    const ids = new Set(options.ids);
    const missing = options.ids.filter((id) => !cohort.some((r) => r.id === id));
    if (missing.length) throw inputError(`IDs missing from brain cohort: ${missing.join(', ')}`);
    selected = cohort.filter((r) => ids.has(r.id));
  }
  const limit = options.limit ?? (options.dryRun || options.ids ? selected.length : 5);
  selected = selected.slice(0, limit);
  if (!selected.length) throw inputError('No matching brain records');
  let output = null;
  if (options.out) {
    output = path.resolve(options.out);
    let existing;
    try { existing = await realpath(output); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (output.toLowerCase() === input.toLowerCase() || existing?.toLowerCase() === input.toLowerCase()) throw inputError('Refusing to overwrite input dataset');
    if (existing) {
      const [a, b] = await Promise.all([stat(input), stat(existing)]);
      if (a.dev === b.dev && a.ino === b.ino) throw inputError('Output is a hard link to input dataset');
      throw inputError('Output already exists; choose a new --out path to preserve prior experiment results');
    }
    // Reserve a writable file BEFORE spending any tokens. wx also catches races.
    const handle = await open(output, 'wx');
    await handle.close();
  }
  const primary = { ...(options.brain === 'claude' ? FALLBACK : PRIMARY), ...(options.brain ? { brain: options.brain } : {}), ...(options.model ? { model: options.model } : {}), ...(options.effort ? { effort: options.effort } : {}) };
  const fallback = options.noFallback ? null : (primary.brain === 'claude' ? PRIMARY : FALLBACK);
  const beforeDocs = selected.map((r) => fromLegacyInsight(r.insight));
  const report = {
    source: { path: input, sha256: createHash('sha256').update(bytes).digest('hex'), totalRecords: rows.length, brainRecords: cohort.length },
    dryRun: options.dryRun, selectedRecords: selected.length,
    selection: { limit, explicitLimit: options.limit ?? null, ids: options.ids ?? null },
    primary, fallback,
    methodology: {
      wordCount: 'P1 Intl.Segmenter(th, word), isWordLike',
      promptChars: 'Unicode code points of exact initial prompt; repair prompts additionally include the candidate document and diagnostics',
      overlap: 'Arithmetic mean of P1 per-clip overlapPct; no cross-clip comparisons',
      bureaucratic: 'Character-weighted P1 rate per 1000 Unicode characters, including whitespace and punctuation',
      evidence: 'Saved AI-extracted text only. Not verified against video; no Gemini or external retrieval.',
      before: 'P1 legacy adapter leaves mainStory and evidence empty. Zero coverage is unmeasured provenance.',
      after: 'Latest structurally valid drafts only, including gate failures. Missing drafts counted separately.',
      cost: 'Reported costUSD only. Missing costs are unknown, not free.',
    },
    before: aggregate(beforeDocs), after: null, records: [],
  };
  const started = Date.now();
  const afterDocs = [];
  for (const [index, row] of selected.entries()) {
    const evidencePack = buildEvidencePack(row);
    const prompt = buildComposePrompt({ evidencePack });
    const sizes = {
      evidenceCount: evidencePack.evidence.length,
      evidenceKinds: Object.fromEntries(['transcript', 'substory', 'quote', 'timeline', 'speaker', 'keypoint'].map((kind) => [kind, evidencePack.evidence.filter((e) => e.kind === kind).length])),
      evidenceTextChars: evidencePack.evidence.reduce((n, e) => n + chars(e.text), 0),
      evidencePackChars: chars(JSON.stringify({ clipMeta: evidencePack.clipMeta, evidence: evidencePack.evidence })),
      promptChars: chars(prompt),
    };
    const base = { id: row.id, title: row.title, url: row.url, clipDurationSec: evidencePack.clipMeta.clipDurationSec, before: scoreTopicDoc(beforeDocs[index]).summary, ...sizes };
    if (options.dryRun) report.records.push({ ...base, after: null, gate: null, attempts: [], doc: null });
    else {
      const clipStarted = Date.now();
      const result = await composeTopics({ evidencePack, primary, fallback, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}), ...(runBrain ? { runBrain } : {}) });
      report.records.push({ ...base, elapsedMs: Date.now() - clipStarted, ok: result.ok, after: result.metrics?.summary ?? null, gate: result.gate, attempts: result.attempts, doc: result.doc, ...(result.errorType ? { errorType: result.errorType } : {}) });
      if (result.doc) afterDocs.push(result.doc);
    }
    if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
  }
  const attempts = report.records.flatMap((r) => r.attempts);
  const knownCosts = attempts.filter((a) => Number.isFinite(a.costUSD));
  report.after = options.dryRun ? null : aggregate(afterDocs);
  report.promptChars = distribution(report.records.map((r) => r.promptChars));
  report.evidencePackChars = distribution(report.records.map((r) => r.evidencePackChars));
  report.execution = {
    aiCalls: attempts.length,
    gatePassed: report.records.filter((r) => r.gate?.pass).length,
    gateFailed: options.dryRun ? 0 : report.records.filter((r) => !r.gate?.pass).length,
    recordsWithoutValidDoc: options.dryRun ? null : selected.length - afterDocs.length,
    failuresByType: Object.fromEntries([...new Set(attempts.filter((a) => !a.ok).map((a) => a.errorType))].map((type) => [type, attempts.filter((a) => a.errorType === type).length])),
    elapsedMs: Date.now() - started,
    attemptTimeMs: distribution(attempts.map((a) => a.elapsedMs)),
    clipTimeMs: distribution(report.records.map((r) => r.elapsedMs).filter(Number.isFinite)),
    costUSDKnownTotal: knownCosts.length ? knownCosts.reduce((n, a) => n + a.costUSD, 0) : null,
    attemptsWithCost: knownCosts.length,
    attemptsWithoutCost: attempts.length - knownCosts.length,
    costUSDPerSelectedClip: knownCosts.length === attempts.length && attempts.length ? knownCosts.reduce((n, a) => n + a.costUSD, 0) / selected.length : null,
  };
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return { report, output };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runOffline(process.argv.slice(2)).then(({ report, output }) => {
    const { records, ...summary } = report;
    process.stdout.write(JSON.stringify({ output, ...summary, records: records.map(({ doc, attempts, ...row }) => ({ ...row, attemptCount: attempts.length })) }, null, 2) + '\n');
    if (!report.dryRun && report.execution.gateFailed) process.exitCode = 1;
  }).catch((error) => {
    const errorType = error.name === 'OfflineInputError' ? 'CLIP_COMPOSE_OPTIONS_ERROR'
      : error instanceof SyntaxError ? 'CLIP_COMPOSE_INPUT_JSON_ERROR'
        : typeof error.code === 'string' && /^[A-Z_0-9]+$/.test(error.code) ? 'CLIP_COMPOSE_IO_' + error.code : 'CLIP_COMPOSE_OFFLINE_ERROR';
    const message = error.name === 'OfflineInputError' ? error.message : 'Unable to read input or save output; check the error type and file paths.';
    process.stderr.write(JSON.stringify({ ok: false, errorType, error: message }) + '\n');
    process.exitCode = 1;
  });
}
