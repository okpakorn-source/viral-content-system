// 💸 ข้อสอบข้อ 8 (25 ต.ค. 69 · ผลทดสอบท่อทีละขั้น): ตัวนับเงินต้องรู้ราคารุ่นใหม่ที่ท่อข่าว/คลิปใช้ — ไม่บันทึก $0 เงียบๆ
//   gpt-6.1-sol (ขั้นเลือกการ์ด) · claude-sonnet-5-5 (ตัวเลือกนักเขียน) · gemini-3.8-flash (สมองคลิป)
//   ใช้ usageLogger.js จริง แทนเฉพาะ prisma (จดแถวที่จะบันทึก)
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { importPatchedModule } from './helpers/temp-module.mjs';

const srcUrl = (rel) => new URL(rel, import.meta.url);
let s = readFileSync(srcUrl('../src/lib/ai/usageLogger.js'), 'utf8');
const from = "import { prisma } from '../db.js';";
assert.ok(s.includes(from), 'ต้องพบ import prisma');
s = s.replace(from, 'const prisma = { apiUsageLog: { create: async ({ data }) => { globalThis.__USAGE_ROWS__.push(data); } } };');
const { logApiUsage } = await importPatchedModule(s, srcUrl('../src/lib/ai/usageLogger.js'), 'usage-pricing');

async function costOf(model, inputTokens = 1_000_000, outputTokens = 1_000_000) {
  globalThis.__USAGE_ROWS__ = [];
  await logApiUsage({ provider: 'test', model, inputTokens, outputTokens });
  return globalThis.__USAGE_ROWS__[0]?.costUsd;
}

test('A1 รุ่นใหม่ได้ราคา (1M เข้า + 1M ออก)', async () => {
  assert.equal(await costOf('gpt-6.1-sol'), 35, 'gpt-6.1-sol = 5 + 30 (ประมาณชั้น gpt-6-sol)');
  assert.equal(await costOf('claude-sonnet-5-5'), 12, 'claude-sonnet-5-5 = 2 + 10');
  assert.equal(await costOf('gemini-3.8-flash'), 10.5, 'gemini-3.8-flash = 1.5 + 9 (ยืมชั้น 3.6)');
});

test('A2 ของเดิมไม่เปลี่ยน: luna/sol/opus-5/sonnet-5', async () => {
  assert.equal(await costOf('gpt-5.6-luna'), 7);
  assert.equal(await costOf('gpt-5.6-sol'), 35);
  assert.equal(await costOf('claude-opus-5'), 30);
  assert.equal(await costOf('claude-sonnet-5'), 12);
});
