// ============================================================
// [ระบบทำปกออโต้] คลังบันทึกต้นทุน API + สรุปยอด
// ------------------------------------------------------------
// บันทึกทุกครั้งที่เรียก API เสียเงิน (LLM/SerpApi/Replicate)
// เก็บ data/cost-log.json (in-memory globalThis กันเขียนชนกัน)
// ⚠️ ห้าม throw — การบันทึกต้นทุนต้องไม่ทำให้ท่อหลักพัง
// ============================================================

import { promises as fs } from 'fs';
import path from 'path';
import { llmCost, SERPAPI_PER_SEARCH, REPLICATE_PER_SEC, REPLICATE_FLAT } from './costRates.js';

// ★ 5 ก.ค. (copy เข้า repo ไวรัล): Vercel ดิสก์ read-only → /tmp (best-effort ต่อ lambda)
const FILE = process.env.VERCEL ? '/tmp/acs-cost-log.json' : path.join(process.cwd(), 'data', 'cost-log.json');
const MAX_EVENTS = 8000;

async function load() {
  if (globalThis.__COST_LOG) return globalThis.__COST_LOG;
  try {
    const t = await fs.readFile(FILE, 'utf8');
    const arr = JSON.parse(t);
    globalThis.__COST_LOG = Array.isArray(arr) ? arr : [];
  } catch {
    globalThis.__COST_LOG = [];
  }
  return globalThis.__COST_LOG;
}

let writeChain = Promise.resolve();
function persist() {
  const arr = globalThis.__COST_LOG || [];
  writeChain = writeChain.then(() => fs.writeFile(FILE, JSON.stringify(arr, null, 2)).catch(() => {}));
  return writeChain;
}

async function logEvent(ev) {
  try {
    const arr = await load();
    arr.push({
      id: 'C' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      at: new Date().toISOString(),
      cost: 0,
      ...ev,
    });
    if (arr.length > MAX_EVENTS) arr.splice(0, arr.length - MAX_EVENTS);
    persist();
  } catch {
    /* บันทึกไม่ได้ก็ห้ามพังท่อหลัก */
  }
}

// ---- ตัวบันทึกแยกตามชนิด (คำนวณต้นทุนให้เลย) ----

// LLM (Claude/OpenAI/Gemini) — usage รูปแบบต่าง provider
export async function recordLLM({ provider, model, usage, step, caseId, note }) {
  let inTok = 0;
  let outTok = 0;
  if (usage) {
    // Anthropic: input_tokens/output_tokens · OpenAI: prompt_tokens/completion_tokens · Gemini: promptTokenCount/candidatesTokenCount
    inTok = usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount ?? 0;
    outTok = usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount ?? 0;
  }
  const cost = llmCost(provider, model, inTok, outTok);
  await logEvent({ kind: 'llm', provider, model, step, caseId: caseId || null, inTok, outTok, units: inTok + outTok, unitKind: 'token', cost, note: note || '' });
}

// SerpApi — 1 ครั้ง = 1 เครดิต
export async function recordSerp({ engine, step, caseId, count = 1 }) {
  const cost = SERPAPI_PER_SEARCH * count;
  await logEvent({ kind: 'serpapi', provider: 'serpapi', model: engine || 'search', step: step || 'ค้นภาพ', caseId: caseId || null, units: count, unitKind: 'search', cost, note: engine || '' });
}

// Replicate Real-ESRGAN — คิดตามเวลารัน (วินาที) ถ้ามี, ไม่งั้น flat
export async function recordReplicate({ predictTime, caseId, note }) {
  const cost = predictTime > 0 ? predictTime * REPLICATE_PER_SEC : REPLICATE_FLAT;
  await logEvent({ kind: 'replicate', provider: 'replicate', model: 'real-esrgan', step: 'เพิ่มความชัด HD', caseId: caseId || null, units: predictTime || 1, unitKind: predictTime ? 'sec' : 'run', cost, note: note || '' });
}

// ---- อ่าน + สรุป ----
export async function readCostLog() {
  return (await load()).slice();
}

function addTo(map, key, cost, count) {
  if (!map[key]) map[key] = { cost: 0, count: 0 };
  map[key].cost += cost;
  map[key].count += count || 1;
}

export async function summarizeCost() {
  const events = await load();
  const byStep = {};
  const byProvider = {};
  const byDay = {};
  const byCase = {};
  let total = 0;
  for (const e of events) {
    const c = e.cost || 0;
    total += c;
    addTo(byStep, e.step || 'อื่นๆ', c);
    addTo(byProvider, e.provider || 'อื่นๆ', c);
    addTo(byDay, (e.at || '').slice(0, 10) || 'ไม่ทราบ', c);
    if (e.caseId) addTo(byCase, e.caseId, c);
  }
  const recent = events.slice(-40).reverse();
  return {
    total,
    count: events.length,
    byStep,
    byProvider,
    byDay,
    byCase,
    recent,
    currency: 'USD',
    fxTHB: parseFloat(process.env.USD_THB || '36.5'),
  };
}

export async function clearCostLog() {
  globalThis.__COST_LOG = [];
  await persist();
  return { cleared: true };
}
