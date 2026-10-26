/**
 * ✍️ clipSingle/writer.js — คนเขียนเนื้อข่าวช่องเดียว (อ่านบทถอดทั้งคลิป → พาดหัว + เนื้อข่าว + รายชื่อที่ใช้)
 * ------------------------------------------------------------------
 * เจ้าของเคาะ 25 ต.ค. 69: "เทียบก่อนเลือก" ระหว่าง Gemini 3.8 Flash กับ Claude Opus 4.8
 *   → เลือกค่ายด้วย env CLIP_WRITER_MODEL (ขึ้นต้น claude- = ค่าย Claude · อื่นๆ/ไม่ตั้ง = Gemini 3.8 Flash)
 *   ระหว่างรอผลเทียบใช้ Gemini 3.8 Flash (ตัวที่ใช้เรียบเรียงอยู่บนเครื่องทีมตอนนี้)
 * สัญญา: ไม่โยน error — คืน { ok:false, errorType, error } ให้ท่อหลักตัดสินใจ
 */
import { runBrain } from '../clipBrain/brainRunner.js';
import { SINGLE_WRITER_SYSTEM } from './prompts.js';

export const DEFAULT_WRITER_MODEL = 'gemini-3.8-flash';
const BUSY_RETRIES = 12;
const BUSY_WAIT_MS = 5000;
const envStr = (k) => String(process.env[k] || '').trim();
const envMs = (k, d) => { const n = Number(envStr(k)); return Number.isSafeInteger(n) && n > 0 ? n : d; };

export function resolveWriter(override = '') {
  const model = String(override || envStr('CLIP_WRITER_MODEL') || DEFAULT_WRITER_MODEL);
  if (/^claude-/.test(model)) return { kind: 'claude', model, effort: envStr('CLIP_WRITER_EFFORT') || 'medium' };
  return { kind: 'gemini', model: /^gemini-/.test(model) ? model : DEFAULT_WRITER_MODEL, effort: envStr('CLIP_WRITER_EFFORT') || 'high' };
}

/** ผลคนเขียนต้องมีพาดหัวกับเนื้อข่าวเป็นข้อความจริง */
export function validateDraft(json) {
  const headline = typeof json?.headline === 'string' ? json.headline.replace(/\s+/g, ' ').trim() : '';
  const body = typeof json?.body === 'string' ? json.body.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : '';
  const names = Array.isArray(json?.names) ? json.names.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim()) : [];
  if (!body) return { ok: false, error: 'คนเขียนไม่ส่งเนื้อข่าวกลับมา' };
  if (!headline) return { ok: false, error: 'คนเขียนไม่ส่งพาดหัวกลับมา' };
  return { ok: true, draft: { headline, body, names } };
}

/**
 * @param {{prompt:string, writer?:object, timeoutMs?:number, deps?:object}} o
 *   deps = ตัวเรียกแทน (ข้อสอบ) { runBrain, callClaude }
 */
export async function writeSingleBody({ prompt, writer = resolveWriter(), timeoutMs = envMs('CLIP_WRITER_TIMEOUT_MS', 300000), deps = {} } = {}) {
  const t0 = Date.now();
  try {
    if (writer.kind === 'claude') {
      const callClaude = deps.callClaude || (await import('../../ai/claudeClient.js')).callClaude;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(new Error(`คนเขียนเกินเวลา ${timeoutMs}ms`)), timeoutMs);
      try {
        const json = await callClaude({
          prompt, systemPrompt: SINGLE_WRITER_SYSTEM, model: writer.model, effort: writer.effort,
          temperature: 0.3, maxTokens: 16000, signal: ac.signal, sanitizeScope: 'facts',
        });
        const v = validateDraft(json);
        if (!v.ok) return { ok: false, errorType: 'WRITER_BAD_OUTPUT', error: v.error, model: writer.model, elapsedMs: Date.now() - t0 };
        return { ok: true, draft: v.draft, model: writer.model, kind: 'claude', elapsedMs: Date.now() - t0 };
      } finally { clearTimeout(timer); }
    }
    const run = deps.runBrain || runBrain;
    const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    // ★ ผู้ตรวจอิสระ 25 ต.ค.: BRAIN_BUSY = ช่องสมอง Gemini ของเซิร์ฟเวอร์เต็ม (ยังไม่ได้ส่งคำขอ = ยังไม่เสียเงิน)
    //   รอแล้วลองใหม่ (สูงสุด ~1 นาที) แทนการล้มทั้งงานที่จ่ายค่าดูคลิปไปแล้ว
    let r;
    for (let attempt = 0; attempt < BUSY_RETRIES; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- ลองใหม่ตามลำดับ มีเพดาน
      r = await run({ brain: 'gemini', prompt, model: writer.model, effort: writer.effort, timeoutMs, label: 'เขียนเนื้อข่าว' });
      if (r?.errorType !== 'BRAIN_BUSY') break;
      // eslint-disable-next-line no-await-in-loop -- รอช่องว่าง
      await sleep(BUSY_WAIT_MS);
    }
    if (!r?.ok) return { ok: false, errorType: r?.errorType || 'WRITER_FAILED', error: r?.error || 'คนเขียนล้ม', model: writer.model, elapsedMs: Date.now() - t0, usage: r?.usage, costUSD: r?.costUSD };
    const v = validateDraft(r.json);
    if (!v.ok) return { ok: false, errorType: 'WRITER_BAD_OUTPUT', error: v.error, model: r.model || writer.model, elapsedMs: Date.now() - t0, usage: r.usage, costUSD: r.costUSD };
    return { ok: true, draft: v.draft, model: r.model || writer.model, kind: 'gemini', elapsedMs: Date.now() - t0, usage: r.usage, costUSD: r.costUSD, tokensUsed: r.tokensUsed };
  } catch (e) {
    return { ok: false, errorType: 'WRITER_CRASHED', error: String(e?.message || e).slice(0, 300), model: writer.model, elapsedMs: Date.now() - t0 };
  }
}
