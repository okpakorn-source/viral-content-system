import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);
const STORE_STUB = _mod(`
export function createStore() {
  return {
    getAll: async () => globalThis.__FORMULA_ARCHIVE_ROWS,
    add: async (entry) => { globalThis.__FORMULA_ARCHIVE_ROWS.push(structuredClone(entry)); return entry; },
    remove: async (id) => {
      globalThis.__FORMULA_ARCHIVE_ROWS = globalThis.__FORMULA_ARCHIVE_ROWS.filter((row) => row.id !== id);
    },
    get: async (id) => globalThis.__FORMULA_ARCHIVE_ROWS.find((row) => row.id === id) || null,
    update: async () => null,
    upsert: async () => null,
  };
}
`);
const SUPABASE_STUB = _mod(`
export function getSupabase(){ return null; }
export function isSupabaseReady(){ return false; }
`);
const AI_STUB = _mod('export function callBrain(){ throw new Error("LLM_FORBIDDEN_IN_TEST"); }');
const NEXT_STUB = _mod('export const NextResponse = { json: (obj, init) => ({ _body: obj, status: (init && init.status) || 200 }) };');
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/persistStore') return { url: ${JSON.stringify(STORE_STUB)}, shortCircuit: true };
  if (specifier === './supabase.js') return { url: ${JSON.stringify(SUPABASE_STUB)}, shortCircuit: true };
  if (specifier === '@/lib/aiClient') return { url: ${JSON.stringify(AI_STUB)}, shortCircuit: true };
  if (specifier === 'next/server') return { url: ${JSON.stringify(NEXT_STUB)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`));

globalThis.__FORMULA_ARCHIVE_ROWS = [];
const { addMegaCover, resolveArchiveFormulaScore } = await import('../src/lib/megaCoverArchive.js');

const resetRows = () => { globalThis.__FORMULA_ARCHIVE_ROWS = []; };

test('archive preserves an explicit S7 formulaScore and writes it into the simulated record', async () => {
  resetRows();
  const explicit = {
    passed: 1,
    total: 2,
    score: 50,
    checks: [
      { key: 'pass', pass: true },
      { key: 'unknown', pass: null },
      { key: 'fail', pass: false },
    ],
  };
  const entry = await addMegaCover({ id: 'EXPLICIT', source: 'mega', formulaScore: explicit });
  assert.deepEqual(entry.formulaScore.checks.map((check) => check.key), ['pass', 'fail']);
  assert.deepEqual(globalThis.__FORMULA_ARCHIVE_ROWS[0].formulaScore, entry.formulaScore);
  assert.equal(explicit.checks.length, 3, 'archive pruning must not mutate the caller object');
});

test('direct compose/ref archive path computes a numeric score from real qcFlags when caller omitted it', async () => {
  resetRows();
  const entry = await addMegaCover({
    id: 'DIRECT',
    source: 'compose-test',
    qcFlags: [
      'face_share_out:main:57.1',
      'duplicate_scene:main:circle',
      'circle_same_person_as_hero',
    ],
  });
  assert.ok(Object.hasOwn(entry, 'formulaScore'));
  assert.equal(typeof entry.formulaScore.score, 'number');
  // qcFlags-only direct callers truthfully measure face_share_hero + no_dup here. The circle flag alone
  // must not fabricate a circle slot, so circle_distinct remains unmeasurable without slot metadata.
  assert.ok(entry.formulaScore.total >= 2, `expected >=2 measurable checks, got ${entry.formulaScore.total}`);
  assert.equal(
    entry.formulaScore.checks.find((check) => check.key === 'face_share_hero')?.pass,
    false,
  );
  assert.ok(entry.formulaScore.checks.every((check) => check.pass !== null));
  assert.deepEqual(globalThis.__FORMULA_ARCHIVE_ROWS[0].formulaScore, entry.formulaScore);
});

test('missing measurement input is persisted honestly as an unavailable score object, not omitted or fabricated', async () => {
  resetRows();
  const entry = await addMegaCover({ id: 'NO-INPUT', source: 'cover-ref-test' });
  assert.deepEqual(
    {
      passed: entry.formulaScore.passed,
      total: entry.formulaScore.total,
      score: entry.formulaScore.score,
      reason: entry.formulaScore.reason,
    },
    { passed: 0, total: 0, score: null, reason: 'input_unavailable' },
  );
  assert.ok(Array.isArray(entry.formulaScore.checks));
  assert.equal(entry.formulaScore.checks.length, 0);
});

test('MEGA_FORMULA_CHECK=0 performs no evaluation and persists an explicit null field', async () => {
  resetRows();
  const before = process.env.MEGA_FORMULA_CHECK;
  try {
    process.env.MEGA_FORMULA_CHECK = '0';
    const resolved = await resolveArchiveFormulaScore({
      qcFlags: ['face_share_out:main:57.1'],
    });
    assert.equal(resolved, null);
    const entry = await addMegaCover({
      id: 'SWITCH-OFF',
      source: 'compose-test',
      qcFlags: ['face_share_out:main:57.1'],
    });
    assert.ok(Object.hasOwn(entry, 'formulaScore'));
    assert.equal(entry.formulaScore, null);
    assert.ok(Object.hasOwn(globalThis.__FORMULA_ARCHIVE_ROWS[0], 'formulaScore'));
    assert.equal(globalThis.__FORMULA_ARCHIVE_ROWS[0].formulaScore, null);
  } finally {
    if (before === undefined) delete process.env.MEGA_FORMULA_CHECK;
    else process.env.MEGA_FORMULA_CHECK = before;
  }
});
