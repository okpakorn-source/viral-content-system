#!/usr/bin/env node
/** Lab-only, offline adapter. Reads saved documents; never invokes an AI provider. */
import { readFile, writeFile, realpath, stat, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import { toLegacyInsight } from '../src/lib/services/clipBrain/topicSchema.js';
import { assessReadiness, quoteCoverage } from '../src/lib/services/clipBrain/clipVerify.js';

const LAB = path.resolve('C:/tmp/clip-brain-lab');
const SCRIPT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const NOTE = 'ใบงานตัวอย่าง P5: ไฟล์ทดลองไม่มี truth จึงใช้ rawData ของใบงานเดิมตรวจความพร้อมและคำพูด ไม่ใช่การตรวจซ้ำกับเสียงต้นทาง';
const json = async (p) => JSON.parse((await readFile(p, 'utf8')).replace(/^\uFEFF/, ''));
const inside = (root, target) => { const rel = path.relative(root, target); return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel); };

export function parseArgs(argv) {
  const options = { dryRun: false };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === '--dry-run') { options.dryRun = true; continue; }
    if (!['--from', '--archive', '--out'].includes(flag)) throw new Error(`Unknown option: ${flag}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value: ${flag}`);
    options[flag.slice(2)] = value;
  }
  for (const key of ['from', 'archive', 'out']) if (!options[key]) throw new Error(`Required: --${key}`);
  return options;
}

async function normalizer() {
  // Only the pure normalizer is used; loading or calling the paid client is forbidden.
  const hook = registerHooks({ resolve(spec, context, next) {
    if (spec === '@/lib/ai/openai') return { url: 'data:text/javascript,export function callAI(){throw new Error("FIXTURE_AI_FORBIDDEN")}', shortCircuit: true };
    if (spec === '@/lib/ai/modelConfig') return { url: 'data:text/javascript,export const MODEL_FAST="fixture-disabled", MODEL_NEWS_ANALYSIS="fixture-disabled"', shortCircuit: true };
    return next(spec, context);
  } });
  try { return (await import('../src/lib/services/clipInsightService.js')).normalizeInsight; }
  finally { hook.deregister(); }
}

/** Offline record builder shared by the CLI and portable tests; performs no file writes. */
export async function createFixtureRecord(composed, record, { from = '', createdAt = new Date().toISOString() } = {}) {
  if (composed?.doc?.schemaVersion !== 2) throw new Error('Composed record must contain a v2 document');
  if (record?.id !== composed.id || !record?.insight?.rawData) throw new Error('Matching archive record with rawData is required');
  const normalizeInsight = await normalizer();
  const insight = normalizeInsight(toLegacyInsight(composed.doc, record.insight), record.insight.engine);
  const truth = record.insight.rawData;
  const readiness = await assessReadiness(insight, { truth });
  const quality = new Map(readiness.stories.map((s) => [s.id, { status: 'checked', issues: s.issues }]));
  for (const story of insight.topicsV2.stories) {
    story.quality = structuredClone(quality.get(story.id));
    for (const quote of story.quotes || []) quote.verification = quoteCoverage(quote.text, truth) >= 0.6 ? 'verified' : 'unverified';
  }
  insight.topicsV2.mainStoryQuality = { status: 'checked', issues: readiness.mainStory.issues };
  for (const story of insight.subStories) story.quality = structuredClone(quality.get(story.storyId));
  const byCode = {};
  for (const issue of [...readiness.stories.flatMap((s) => s.issues), ...readiness.mainStory.issues]) byCode[issue.code] = (byCode[issue.code] || 0) + 1;
  // Old truth findings concern the archived result, so the fixture does not claim a new truth review.
  insight.brain = { status: 'ไม่ได้ตรวจ', check: { code: null, ai: null, repair: null,
    readiness: { findings: readiness.findings, counts: { stories: readiness.stories.length,
      withIssues: readiness.stories.filter((s) => s.issues.length).length, byCode }, note: NOTE } },
    topicsV2: { ok: composed.ok, gate: composed.gate, summary: composed.after,
      stories: insight.topicsV2.stories, attempts: composed.attempts || [], elapsedMs: composed.elapsedMs }, degradations: [] };
  insight.usageNote = `${NOTE}\n${insight.usageNote || ''}`;
  const fixture = { ...record, id: `p5-v2-${record.id}`, title: `[P5 ตัวอย่าง] ${record.title || ''}`, insight,
    user: 'P5 lab fixture', chosen: false, createdAt,
    fixture: { source: from, archiveId: record.id, truthSource: 'archive.insight.rawData', note: NOTE } };
  return fixture;
}

// Optional roots let imported tests use their checkout and an isolated temporary store.
// CLI callers retain the original lab-only defaults and all output/link checks.
export async function runFixture(argv, { labRoot = LAB, outputRoot } = {}) {
  const opts = parseArgs(argv);
  const lab = await realpath(labRoot);
  if ((await realpath(SCRIPT_ROOT)).toLowerCase() !== lab.toLowerCase()) throw new Error('Fixture must run from the clip-brain-lab checkout');
  const output = path.resolve(opts.out);
  const dataRoot = outputRoot ? await realpath(outputRoot) : path.join(lab, 'data');
  if (!inside(dataRoot, output) || path.extname(output) !== '.json') throw new Error('--out must be a JSON file inside lab/data');
  const parent = await realpath(path.dirname(output));
  if (parent.toLowerCase() !== dataRoot.toLowerCase() && !inside(dataRoot, parent)) throw new Error('Output parent resolves outside lab/data');
  let existing = [];
  try {
    const resolved = await realpath(output);
    if (!inside(dataRoot, resolved) || (await stat(output)).nlink !== 1) throw new Error('Output links are not allowed');
    existing = await json(output);
    if (!Array.isArray(existing)) throw new Error('Output store must contain a JSON array');
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const from = await realpath(path.resolve(opts.from));
  const archivePath = await realpath(path.resolve(opts.archive));
  if ([from, archivePath].some((p) => p.toLowerCase() === output.toLowerCase())) throw new Error('Output cannot overwrite an input');
  const source = await json(from);
  const composed = source.records?.[0] ?? source;
  if (composed?.doc?.schemaVersion !== 2) throw new Error('records[0].doc must be a v2 document');
  const archive = await json(archivePath);
  if (!Array.isArray(archive)) throw new Error('Archive must contain a JSON array');
  const record = archive.find((r) => r.id === composed.id);
  if (!record?.insight || !record.insight.rawData) throw new Error('Matching archive record with rawData is required');
  const fixture = await createFixtureRecord(composed, record, { from });
  const index = existing.findIndex((r) => r.id === fixture.id);
  if (index >= 0 && existing[index].fixture?.archiveId !== record.id) throw new Error('Fixture ID collides with an existing record');
  const rows = [...existing];
  if (index >= 0) rows[index] = fixture; else rows.push(fixture);
  if (!opts.dryRun) {
    const temp = `${output}.p5-${process.pid}.tmp`;
    try { await writeFile(temp, JSON.stringify(rows, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' }); await rename(temp, output); }
    catch (e) { await unlink(temp).catch(() => {}); throw e; }
  }
  return { success: true, dryRun: opts.dryRun, output, id: fixture.id, stories: fixture.insight.topicsV2.stories.length, records: rows.length, note: NOTE };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runFixture(process.argv.slice(2)), null, 2)); }
  catch (e) { console.error(JSON.stringify({ success: false, errorType: 'CLIP_TOPIC_FIXTURE_ERROR', error: e.message })); process.exitCode = 1; }
}
