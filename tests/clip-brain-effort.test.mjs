import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runBrain } from '../src/lib/services/clipBrain/brainRunner.js';

async function withFake(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clip-brain-effort-'));
  const script = path.join(dir, 'argv.mjs');
  const keys = ['CLIP_BRAIN_CLAUDE_BIN', 'CLIP_BRAIN_CODEX_BIN', 'CLIP_BRAIN_CLAUDE_ACCOUNTS', 'CLIP_BRAIN_CODEX_ACCOUNTS', 'CLIP_BRAIN_PASS_ENV', 'CLIP_BRAIN_LEAN', 'SUPABASE_SERVICE_KEY'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    await writeFile(script, "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({argv:process.argv.slice(2),leaked:!!process.env.SUPABASE_SERVICE_KEY})));", 'utf8');
    for (const k of keys) delete process.env[k];
    const bin = 'node "' + script + '"';
    process.env.CLIP_BRAIN_CLAUDE_BIN = bin; process.env.CLIP_BRAIN_CODEX_BIN = bin;
    process.env.CLIP_BRAIN_PASS_ENV = 'SUPABASE_SERVICE_KEY';
    process.env.SUPABASE_SERVICE_KEY = 'fake-secret-must-not-reach-child';
    await fn({ dir, script });
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
}

test('codex forwards every allowlisted effort using -c before stdin and maps max to ultra', async () => {
  await withFake(async () => {
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'ultra', 'max']) {
      const r = await runBrain({ brain: 'codex', model: 'gpt-6-astra', effort, prompt: 'test' });
      assert.equal(r.ok, true);
      const applied = effort === 'max' ? 'ultra' : effort;
      assert.deepEqual(r.json.argv, ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '--ignore-user-config', '-m', 'gpt-6-astra', '-c', 'model_reasoning_effort="' + applied + '"', '-']);
      assert.equal(r.effortApplied, applied); assert.equal(r.effortIgnored, false);
      assert.equal(r.json.leaked, false);
    }
  });
});

test('claude forwards supported local CLI efforts and reports unsupported ultra as ignored', async () => {
  await withFake(async () => {
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']) {
      const r = await runBrain({ brain: 'claude', model: 'claude-fable-5', effort, prompt: 'test' });
      assert.equal(r.ok, true); assert.equal(r.json.leaked, false);
      const index = r.json.argv.indexOf('--effort');
      if (effort === 'ultra') { assert.equal(index, -1); assert.equal(r.effortIgnored, true); assert.equal(r.effortApplied, undefined); }
      else { assert.equal(r.json.argv[index + 1], effort); assert.equal(r.effortIgnored, false); }
      assert.ok(r.json.argv.includes('--strict-mcp-config'));
      assert.ok(r.json.argv.includes('--allowed-tools'));
    }
  });
});

test('effort injection/objects/getters cannot change argv and never bypass model guard', async () => {
  await withFake(async () => {
    for (const brain of ['codex', 'claude']) {
      const normal = await runBrain({ brain, prompt: 'test' });
      assert.equal(normal.effortIgnored, undefined);
      for (const effort of ['', 'HIGH', 'high ', '--dangerously-bypass-approvals-and-sandbox', 'high" & echo injected', 'xhigh\n--tool', { toString: () => 'high' }]) {
        const r = await runBrain({ brain, effort, prompt: 'test' });
        assert.equal(r.ok, true); assert.equal(r.effortIgnored, true);
        assert.deepEqual(r.json.argv, normal.json.argv);
      }
      const opts = { brain, prompt: 'test', get effort() { throw new Error('bad getter'); } };
      const getter = await runBrain(opts);
      assert.equal(getter.ok, true); assert.equal(getter.effortIgnored, true);
      const model = await runBrain({ brain, prompt: 'test', model: 'bad & model', effort: 'high' });
      assert.equal(model.ok, false); assert.equal(model.errorType, 'BRAIN_BAD_MODEL');
    }
    const empty = await runBrain({ brain: 'codex', prompt: '', effort: '--bad' });
    assert.equal(empty.errorType, 'BRAIN_EMPTY_PROMPT'); assert.equal(empty.effortIgnored, true);
  });
});

test('Windows cmd shim also receives the exact TOML effort argument', { skip: process.platform !== 'win32' }, async () => {
  await withFake(async ({ dir, script }) => {
    const shim = path.join(dir, 'fake-codex.cmd');
    await writeFile(shim, '@echo off\r\nnode "' + script + '" %*\r\n');
    process.env.CLIP_BRAIN_CODEX_BIN = shim;
    const r = await runBrain({ brain: 'codex', prompt: 'test', effort: 'ultra', model: 'gpt-6-astra' });
    assert.equal(r.ok, true);
    const index = r.json.argv.indexOf('-c');
    assert.equal(r.json.argv[index + 1], 'model_reasoning_effort="ultra"');
    assert.equal(r.json.argv.at(-1), '-');
  });
});
