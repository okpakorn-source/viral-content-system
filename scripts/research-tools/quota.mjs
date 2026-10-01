// 📊 quota — ดูโควตา Codex ของ "บัญชีที่เอเจนต์ใช้อยู่" (CODEX_HOME ปัจจุบัน หรือ ~/.codex) ฟรี ไม่เผาโทเคน
// ใช้: node tools/quota.mjs
// คืน JSON: {ok, tool, account, usedPct, remainingPct, status, resetAt} · ไม่คืนอีเมล/โทเคน
// (worker เช็คโควตาเองทุกงานอยู่แล้ว — เครื่องมือนี้ไว้ให้เอเจนต์ประเมินว่าควรประหยัดไหม)
import os from 'node:os';
import path from 'node:path';
import { importFromRepo, parseArgs, repoRoot, runTool } from './_common.mjs';

export const USAGE = 'ใช้: node tools/quota.mjs';

export async function run(argv, { env = process.env, fetchImpl = globalThis.fetch, loadAccounts = null, homeDir = os.homedir() } = {}) {
  parseArgs(argv, {});
  const dir = String(env.CODEX_HOME || '').trim() || path.join(homeDir, '.codex');
  const base = path.basename(dir);
  const account = base === '.codex' ? 'main' : base.replace(/^\.codex-/, '');
  const mod = loadAccounts ? await loadAccounts() : await importFromRepo('scripts/research-agent/accounts.mjs', repoRoot(env));
  const q = await mod.readQuotaAtDir(dir, account, { fetchImpl });
  return {
    ok: q.status === 'OK' || q.status === 'FULL' || q.status === 'LOCKED',
    tool: 'quota', account, usedPct: q.usedPct, remainingPct: q.remainingPct, status: q.status, resetAt: q.resetAt, note: q.note || undefined,
  };
}

await runTool(import.meta.url, (argv) => run(argv), USAGE);
