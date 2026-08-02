import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const FILES = Object.freeze({
  reframe: new URL('../src/lib/services/newsDesk/reframeEngine.js', import.meta.url),
  imageScout: new URL('../src/lib/services/newsDesk/imageScout.js', import.meta.url),
  angleEnrich: new URL('../src/lib/services/newsDesk/angleEnrich.js', import.meta.url),
});

const readSources = () => Object.fromEntries(
  Object.entries(FILES).map(([name, url]) => [name, readFileSync(url, 'utf8')]),
);

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing context start: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing context end: ${endMarker}`);
  return source.slice(start, end);
}

function callForMaxTokens(block, callee, maxTokens) {
  const token = `maxTokens: ${maxTokens}`;
  const tokenAt = block.indexOf(token);
  assert.notEqual(tokenAt, -1, `${callee} block must contain ${token}`);
  assert.equal(block.indexOf(token, tokenAt + token.length), -1, `${token} must identify one call in its context`);

  const callAt = block.lastIndexOf(`${callee}({`, tokenAt);
  assert.notEqual(callAt, -1, `${token} must belong to ${callee}`);
  const callEnd = block.indexOf('});', tokenAt);
  assert.notEqual(callEnd, -1, `${callee} call containing ${token} must close`);
  return block.slice(callAt, callEnd + 3);
}

function assertRoute(block, { callee, maxTokens, model, caller }) {
  const call = callForMaxTokens(block, callee, maxTokens);
  const modelMatches = call.match(/\bmodel:\s*DESK_MODEL_(?:FAST|BRAIN)\b/g) || [];
  assert.equal(modelMatches.length, 1, `${callee}/${maxTokens} must declare exactly one desk model`);
  assert.match(call, new RegExp(`\\bmodel:\\s*${model}\\b`), `${callee}/${maxTokens} must use ${model}`);
  if (caller) assert.match(call, new RegExp(`\\bcaller:\\s*'${caller}'`), `${callee}/${maxTokens} must identify its caller`);
  return call;
}

function assertAllRoutes(sources) {
  const reframeNews = section(
    sources.reframe,
    'export async function reframeNews',
    'export async function evaluateReframe',
  );
  const reframeJudge = section(
    sources.reframe,
    'export async function evaluateReframe',
    'export async function runReframeTest',
  );
  const imageQueries = section(
    sources.imageScout,
    'export async function analyzeImageQueries',
    'async function searchAllChannels',
  );
  const imageFilter = section(
    sources.imageScout,
    'async function filterByRelevance',
    'async function fetchHtml',
  );
  const angleFacts = section(
    sources.angleEnrich,
    'export async function enrichCelebAngle',
    'export async function weaveEnrichment',
  );
  const angleWeave = section(
    sources.angleEnrich,
    'export async function weaveEnrichment',
    '\n}',
  );

  assertRoute(reframeNews, {
    callee: 'callRawJSON', maxTokens: 2800, model: 'DESK_MODEL_BRAIN', caller: 'reframe-generate',
  });
  assertRoute(reframeJudge, {
    callee: 'callRawJSON', maxTokens: 450, model: 'DESK_MODEL_FAST', caller: 'reframe-judge',
  });
  assertRoute(imageQueries, {
    callee: 'callAI', maxTokens: 4000, model: 'DESK_MODEL_FAST',
  });
  assertRoute(imageFilter, {
    callee: 'callAI', maxTokens: 3000, model: 'DESK_MODEL_FAST',
  });
  assertRoute(angleFacts, {
    callee: 'callRawJSON', maxTokens: 300, model: 'DESK_MODEL_FAST', caller: 'angle-query',
  });
  assertRoute(angleFacts, {
    callee: 'callRawJSON', maxTokens: 800, model: 'DESK_MODEL_FAST', caller: 'angle-facts',
  });
  assertRoute(angleWeave, {
    callee: 'callRawJSON', maxTokens: 2200, model: 'DESK_MODEL_BRAIN', caller: 'angle-weave',
  });
}

test('source-bound routing maps prose to BRAIN and scoring/query/extraction work to FAST', () => {
  assertAllRoutes(readSources());
});

test('routing assertions reject every requested swap-back mutation without changing disk', () => {
  const originals = readSources();
  const mutations = [
    ['reframe', 'model: DESK_MODEL_BRAIN, temperature: 0.6, maxTokens: 2800', 'model: DESK_MODEL_FAST, temperature: 0.6, maxTokens: 2800'],
    ['reframe', 'model: DESK_MODEL_FAST, temperature: 0.2, maxTokens: 450', 'model: DESK_MODEL_BRAIN, temperature: 0.2, maxTokens: 450'],
    ['imageScout', 'model: DESK_MODEL_FAST,\n    temperature: 0.2,\n    maxTokens: 4000', 'model: DESK_MODEL_BRAIN,\n    temperature: 0.2,\n    maxTokens: 4000'],
    ['angleEnrich', 'model: DESK_MODEL_FAST, temperature: 0.3, maxTokens: 800', 'model: DESK_MODEL_BRAIN, temperature: 0.3, maxTokens: 800'],
  ];

  try {
    for (const [file, before, after] of mutations) {
      const normalized = originals[file].replace(/\r\n/g, '\n');
      const first = normalized.indexOf(before);
      assert.notEqual(first, -1, `mutation target must exist in ${file}`);
      assert.equal(normalized.indexOf(before, first + before.length), -1, `mutation target must be unique in ${file}`);
      const mutant = { ...originals, [file]: normalized.replace(before, after) };
      assert.throws(() => assertAllRoutes(mutant), /must use DESK_MODEL_/);
    }
  } finally {
    assert.deepEqual(readSources(), originals, 'source files must be byte-identical after in-memory mutations');
  }
});
