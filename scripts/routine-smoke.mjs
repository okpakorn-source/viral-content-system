#!/usr/bin/env node
/* eslint-disable no-console, no-await-in-loop -- This CLI prints its report and performs bounded sequential polling. */
/**
 * Routine API smoke client (Node.js 20+; no dependencies).
 * POST requests are sent once, with deterministic idempotency keys.
 * Output excludes API keys, article text, and raw server error messages.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const USAGE = `Usage:
  node scripts/routine-smoke.mjs --base https://YOUR-PREVIEW.vercel.app \\
    --key-env ROUTINE_API_KEY --input-file ./news.txt [options]

Options:
  --mode both|sync|queue|read-only  Default: both (up to two paid jobs)
  --timeout-ms NUMBER             Total deadline; default: 1200000 (20 min)
  --poll-ms NUMBER                Poll interval; default: 15000
  --max-polls NUMBER              Poll attempts; default: 60
  --content-length short|medium|long  Default: medium
  --help                         Show this message; no requests

The input file contains UTF-8 article text (20..20000 characters).
URL input requires the deployment's existing TEXT_ONLY_MODE=0 setting.
--base may include /api/routine. HTTPS is required except localhost.
--mode read-only does not require --input-file and never submits work.
The API key is read only from the named environment variable; never printed.
POST is never retried automatically. Reusing the same base/input/options uses
the same idempotency key for each mode (server retention: 24 hours).
`;

const ALLOWED_OPTIONS = new Set([
  'base', 'key-env', 'input-file', 'mode', 'timeout-ms', 'poll-ms',
  'max-polls', 'content-length',
]);

function cliError(message) {
  const error = new Error(message);
  error.safeMessage = message;
  return error;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help') return { help: true };
    if (!token.startsWith('--') || !ALLOWED_OPTIONS.has(token.slice(2))) {
      throw cliError('Unknown option. Use --help for supported arguments.');
    }
    const name = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--') || Object.hasOwn(options, name)) {
      throw cliError('Each option requires exactly one value and may appear once.');
    }
    options[name] = value;
    index += 1;
  }
  return options;
}

function boundedInteger(value, fallback, min, max, label) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw cliError(`${label} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function normalizeBase(raw) {
  if (!raw) throw cliError('--base is required.');
  let parsed;
  try { parsed = new URL(raw); } catch { throw cliError('--base must be a valid URL.'); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw cliError('--base must not contain credentials, a query, or a fragment.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
    throw cliError('--base requires HTTPS; HTTP is allowed only for localhost.');
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  if (path && path !== '/api/routine') {
    throw cliError('--base must be a site origin or end with /api/routine.');
  }
  return `${parsed.origin}/api/routine`;
}

function requireShape(condition, message) {
  if (!condition) throw cliError(`Contract check failed: ${message}`);
}

function checkResult(result, label) {
  requireShape(result && typeof result === 'object', `${label} result object`);
  requireShape(typeof result.workflowId === 'string' && result.workflowId.startsWith('routine_'), `${label} workflowId`);
  requireShape(Array.isArray(result.versions) && result.versions.length > 0, `${label} nonempty versions`);
  for (const version of result.versions) {
    requireShape(typeof version.content === 'string' && version.content.length > 0, `${label} version content`);
    requireShape(Number.isInteger(version.index), `${label} version index`);
    requireShape(Object.hasOwn(version, 'usedModel') && Object.hasOwn(version, 'promptName') && Object.hasOwn(version, 'promptSource'), `${label} version model/prompt metadata`);
    requireShape(Object.hasOwn(version, 'wordCount') && Object.hasOwn(version, 'paragraphs'), `${label} version length metadata`);
  }
  requireShape(Number.isFinite(result.cost?.usd) && typeof result.cost?.estimated === 'boolean', `${label} cost`);
  requireShape(Number.isFinite(result.timing?.ms), `${label} timing`);
  requireShape(result.pipeline && typeof result.pipeline === 'object', `${label} pipeline`);
  console.log(`${label}: PASS (${result.versions.length} versions; ${result.cost.estimated ? 'estimated' : 'reported'} cost)`);
}

function idempotencyKey(base, input, contentLength, routine) {
  const digest = createHash('sha256')
    .update(JSON.stringify({ base, input, contentLength, routine }))
    .digest('hex');
  return `smoke-${routine}-${digest}`;
}

async function readJson(response) {
  if (!response.body) throw cliError('Server returned an empty body.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  const maxBytes = 8 * 1024 * 1024;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw cliError('Server response exceeded the 8 MiB client limit.');
    }
    chunks.push(Buffer.from(value));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw cliError('Server returned non-JSON data; inspect deployment access settings.'); }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(USAGE); return; }
  const base = normalizeBase(options.base);
  const keyEnv = options['key-env'] || 'ROUTINE_API_KEY';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyEnv)) throw cliError('--key-env must be an environment variable name.');
  const key = process.env[keyEnv];
  if (!key || !key.trim()) throw cliError('The API key environment variable is missing or empty.');
  const mode = options.mode || 'both';
  if (!['both', 'sync', 'queue', 'read-only'].includes(mode)) throw cliError('Invalid --mode; use --help.');
  const contentLength = options['content-length'] || 'medium';
  if (!['short', 'medium', 'long'].includes(contentLength)) throw cliError('Invalid --content-length; use --help.');
  const timeoutMs = boundedInteger(options['timeout-ms'], 1200000, 1000, 3600000, '--timeout-ms');
  const pollMs = boundedInteger(options['poll-ms'], 15000, 1000, 60000, '--poll-ms');
  const maxPolls = boundedInteger(options['max-polls'], 60, 1, 240, '--max-polls');
  let input;
  if (mode !== 'read-only') {
    if (!options['input-file']) throw cliError('--input-file is required when submitting work.');
    try { input = (await readFile(options['input-file'], 'utf8')).replace(/^\uFEFF/, '').trim(); }
    catch { throw cliError('Cannot read --input-file as UTF-8 text.'); }
    if (input.length < 20 || input.length > 20000) throw cliError('Input must contain 20..20000 characters after trimming.');
  }

  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  const since = new Date(startedAt - 24 * 60 * 60 * 1000).toISOString();
  const remaining = () => {
    const value = deadline - Date.now();
    if (value <= 0) throw cliError('Total deadline reached. Submitted jobs may continue on the server; POST was not retried.');
    return value;
  };

  async function request(path, { method = 'GET', body, idem } = {}) {
    const attempts = method === 'GET' ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(remaining(), method === 'POST' ? 810000 : 30000));
      try {
        const headers = { 'x-routine-key': key, accept: 'application/json' };
        if (body) headers['content-type'] = 'application/json';
        if (idem) headers['idempotency-key'] = idem;
        const response = await fetch(`${base}${path}`, {
          method, headers, body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal, redirect: 'error',
        });
        if (method === 'GET' && attempt + 1 < attempts && [408, 429, 502, 503, 504].includes(response.status)) {
          await response.body?.cancel();
          clearTimeout(timer);
          await delay(Math.min(1000 * (attempt + 1), remaining()));
          continue;
        }
        const json = await readJson(response);
        if (!response.ok || json.success === false) {
          const errorType = /^ROUTINE_[A-Z0-9_]+$/.test(json.errorType || '') ? json.errorType : 'UNEXPECTED_RESPONSE';
          throw cliError(`HTTP ${response.status} ${errorType}. POST was not retried.`);
        }
        return json;
      } catch (error) {
        if (error.safeMessage) throw error;
        if (method === 'GET' && attempt + 1 < attempts) {
          clearTimeout(timer);
          await delay(Math.min(1000 * (attempt + 1), remaining()));
          continue;
        }
        throw cliError(method === 'POST'
          ? 'POST transport/timeout failure: server acceptance is unknown. No automatic retry. Reuse the same input/options within 24h to retain the idempotency key.'
          : 'GET transport/timeout failure after bounded retries.');
      } finally {
        clearTimeout(timer);
      }
    }
    throw cliError('GET retry limit reached.');
  }

  console.log(`Routine smoke: ${mode}; POST retries disabled; article text and secrets omitted.`);
  const health = await request('/health');
  requireShape(health.ok === true && health.enabled === true, 'health enabled');
  console.log('health: PASS');

  if (mode === 'both' || mode === 'sync') {
    const routine = 'smoke-sync';
    console.log('news: submitting once (may incur a charge; waiting for pipeline).');
    const result = await request('/news', {
      method: 'POST', body: { input, contentLength, routine },
      idem: idempotencyKey(base, input, contentLength, routine),
    });
    checkResult(result, 'news');
  }

  if (mode === 'both' || mode === 'queue') {
    const routine = 'smoke-queue';
    console.log('jobs: submitting once (may incur a charge).');
    const submitted = await request('/jobs', {
      method: 'POST', body: { input, contentLength, routine },
      idem: idempotencyKey(base, input, contentLength, routine),
    });
    requireShape(typeof submitted.jobId === 'string' && submitted.jobId.length > 0, 'jobs jobId');
    console.log('jobs: accepted; polling with a fixed limit.');
    let completed = false;
    for (let count = 1; count <= maxPolls; count += 1) {
      const job = await request(`/jobs/${encodeURIComponent(submitted.jobId)}`);
      if (job.status === 'done') {
        checkResult(job.result, 'job result');
        completed = true;
        break;
      }
      if (['failed', 'cancelled', 'canceled'].includes(job.status)) {
        throw cliError('Queued job failed or was cancelled. Raw server errors omitted; no resubmission.');
      }
      requireShape(['queued', 'running'].includes(job.status), 'known job status');
      console.log(`poll ${count}/${maxPolls}: ${job.status}`);
      if (count < maxPolls) await delay(Math.min(pollMs, remaining()));
    }
    if (!completed) throw cliError('Polling limit reached. The queued job may continue; no resubmission. Check worker/cron availability.');
  }

  const routines = mode === 'read-only' ? [null]
    : mode === 'both' ? ['smoke-sync', 'smoke-queue']
      : [mode === 'sync' ? 'smoke-sync' : 'smoke-queue'];
  for (const routine of routines) {
    const query = new URLSearchParams({ since, limit: '50' });
    if (routine) query.set('routine', routine);
    const results = await request(`/results?${query}`);
    requireShape(results.success === true && Array.isArray(results.items), 'results items array');
    console.log(`results${routine ? ` (${routine})` : ''}: PASS (${results.items.length} items; durable history can lag or lack legacy linkage)`);
  }
  console.log(`PASS: finished in ${Math.round((Date.now() - startedAt) / 1000)}s. No selection or publication requested.`);
}

main().catch((error) => {
  console.error(`FAIL: ${error.safeMessage || 'Unexpected local failure (details omitted to protect secrets).'}`);
  process.exitCode = 1;
});
