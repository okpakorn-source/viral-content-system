#!/usr/bin/env node
/** One clip, direct pipeline, JSON report only; no store/route/queue writes. */
import { open } from 'node:fs/promises';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAB = fileURLToPath(new URL('../', import.meta.url));
const SRC = new URL('../src/', import.meta.url).href;

function inputError(message) {
  return Object.assign(new Error(message), { code: 'CLIP_BRAIN_ONCE_OPTIONS' });
}

export function parseArgs(argv) {
  const options = { v2: false };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) throw inputError(`Duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === '--v2') { options.v2 = true; continue; }
    if (flag === '--help') { options.help = true; continue; }
    if (!['--url', '--model', '--out'].includes(flag)) throw inputError('Use --url, --v2, --model and --out');
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw inputError(`Missing value: ${flag}`);
    options[flag.slice(2)] = value;
  }
  if (options.help) return options;
  let url;
  try { url = new URL(options.url); } catch { throw inputError('--url must be a YouTube HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || !/(^|\.)youtube\.com$|^youtu\.be$/i.test(url.hostname)) {
    throw inputError('Direct URL mode supports YouTube; other platforms need a prepared videoBuffer');
  }
  if (options.model && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(options.model)) throw inputError('Invalid --model');
  options.out = path.resolve(options.out || path.join(path.dirname(LAB), `clip-brain-once-${Date.now()}.json`));
  if (path.extname(options.out).toLowerCase() !== '.json') throw inputError('--out must be a new .json file');
  return options;
}

let resolverInstalled = false;
function installResolver() {
  if (resolverInstalled) return;
  register('data:text/javascript,' + encodeURIComponent(`
    const hasExt = (s) => /\\.[a-zA-Z0-9]{1,5}$/.test(s);
    export async function resolve(spec, ctx, next) {
      if (spec.startsWith('@/')) return next(new URL(spec.slice(2) + (hasExt(spec) ? '' : '.js'), ${JSON.stringify(SRC)}).href, ctx);
      if ((spec.startsWith('./') || spec.startsWith('../')) && !hasExt(spec)) {
        try { return await next(spec + '.js', ctx); } catch { /* Let Node resolve packages/directories normally. */ }
      }
      return next(spec, ctx);
    }
  `));
  resolverInstalled = true;
}

export function summaryLines(result, out) {
  const brain = result.brain || {};
  const attempts = brain.topicsV2?.attempts || [];
  const usedModels = [...new Set([...(brain.steps || []).map((s) => s.model).filter(Boolean), ...attempts.map((a) => a.model).filter(Boolean)])];
  return [
    `สถานะ: ${result.ok ? brain.status || 'สำเร็จ' : result.errorType || 'ไม่สำเร็จ'} · โมเดล: ${usedModels.join(', ') || '—'}`,
    `เวลา: ${((brain.elapsedMs || 0) / 1000).toFixed(1)} วินาที`,
    `ค่าใช้จ่าย: compose $${(brain.costs?.composeUSD || 0).toFixed(4)} · Gemini โดยประมาณ $${(brain.usage?.estUsd || 0).toFixed(4)}`,
    `Degradations: ${brain.degradations?.map((d) => d.type).join(', ') || 'ไม่มี'}`,
    `ผลลัพธ์: ${out}`,
  ];
}

export async function runOnce(argv, { runPipeline, loadEnv = true } = {}) {
  const options = parseArgs(argv);
  if (options.help) return { help: 'node scripts/clip-brain-once.mjs --url <YouTube URL> [--v2] [--model <Gemini model>] [--out <new.json>]' };
  if (loadEnv) {
    try { process.loadEnvFile(path.join(LAB, '.env.local')); }
    catch (error) { if (error?.code !== 'ENOENT') throw Object.assign(new Error('Unable to load lab .env.local'), { code: 'CLIP_BRAIN_ONCE_ENV' }); }
  }
  // The flag wins over both inherited environment and .env.local.
  process.env.CLIP_TOPIC_V2 = options.v2 ? '1' : '0';
  // Reserve output before any provider calls; never overwrite an existing file.
  const output = await open(options.out, 'wx');
  try {
    if (!runPipeline) {
      installResolver();
      runPipeline = (await import('../src/lib/services/clipBrain/clipBrainPipeline.js')).runClipBrainPipeline;
    }
    const result = await runPipeline({ url: options.url, isYouTube: true,
      ...(options.model ? { model: options.model } : {}), usageLogger: async () => {} });
    await output.writeFile(JSON.stringify({ insight: result.insight ?? null, brain: result.brain,
      ...(!result.ok ? { ok: false, errorType: result.errorType, error: result.error } : {}) }, null, 2) + '\n', 'utf8');
    return { result, out: options.out, summary: summaryLines(result, options.out) };
  } finally {
    await output.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runOnce(process.argv.slice(2)).then(({ help, result, summary }) => {
    process.stdout.write((help || summary.join('\n')) + '\n');
    if (result && !result.ok) process.exitCode = 1;
  }).catch((error) => {
    const errorType = /^[A-Z_0-9]+$/.test(error?.code || '') ? error.code : 'CLIP_BRAIN_ONCE_FAILED';
    console.error(JSON.stringify({ ok: false, errorType,
      error: errorType === 'CLIP_BRAIN_ONCE_OPTIONS' ? error.message : 'Unable to run the clip or save its report; check the error type.' }));
    process.exitCode = 1;
  });
}
