/**
 * 💵 scripts/research-agent/pricing.mjs — ตารางราคาเครื่องมือรีเสิร์ช (SPEC-v2 ส่วน 6 ด่าน 7 · ข้อ 18 เพดาน $10/เดือน)
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ ราคาเครื่องมือ (TOOL_PRICE_USD) เป็น "ประมาณการต่อครั้งเรียก" (USD) ณ 1 ต.ค. 69 — ใช้เตือนงบรายเดือน ไม่ใช่บิลจริง
 *   ปรับตัวเลขที่ไฟล์นี้ที่เดียว (ไม่มี env ราคา — กันตัวแปรงอก) · ค่า Codex CLI = โควตา subscription ไม่คิดเงินที่นี่
 * ราคาโมเดลผ่าน API (MODEL_PRICE_PER_1M · โหมดสำรอง api-fallback) — ข้อตัดสินผู้คุมงาน 1 ต.ค. 69:
 *   gpt-6-astra = $10/1M in · $50/1M out (ราคาทางการ 1 ต.ค. 69) · gpt-6-sol / gpt-6-luna = ค่าประมาณ (TODO ยืนยันราคาจริง)
 *   ต้องเป็นค่าชุดเดียวกับตาราง gpt-6-* ใน src/lib/ai/usageLogger.js (เลน B) ทุกแถว — แก้ที่หนึ่งต้องแก้อีกที่ด้วย
 */

/** ราคาต่อครั้งเรียก (USD) แยกตามชนิดเครื่องมือ */
export const TOOL_PRICE_USD = Object.freeze({
  serper: 0.001,          // Serper ~$50/50k คำค้น
  'fetch-page': 0.001,    // Firecrawl ~1 เครดิต/หน้า · Jina/ตรง ถูกกว่า — เฉลี่ยกลาง
  apify: 0.01,            // actor run-sync ผลไม่กี่รายการ (facebook-posts/search · tiktok · crawler)
  'web-agent': 0.12,      // astra low ~3k in/1.2k out (×$10/$50 ต่อ 1M ≈ $0.09) + web_search 2-3 ครั้ง (≈ $0.025)
  transcribe: 0.02,       // Whisper ~$0.006/นาที (คลิปเฉลี่ย ~3 นาที) · ซับ YouTube ฟรี
  'gemini-video': 0.03,   // Gemini flash ดูคลิป ~3 นาที
  'youtube-meta': 0,      // YouTube Data API (หน่วยโควตาฟรี) / oEmbed
  ocr: 0.01,              // vision ต่อภาพ
  'reverse-image': 0.015, // SerpApi google_lens ต่อครั้ง (เท่ากับ costRates SERPAPI_PER_SEARCH)
  wiki: 0,
  'rss-news': 0,
  quota: 0,
  browser: 0,             // ปลั๊กอินเบราว์เซอร์ของ Codex — ในโควตา subscription
  'codex-web-search': 0,  // web search ในตัวของ Codex — ในโควตา subscription
  other: 0,               // อ่านไฟล์/เขียนผล/คำสั่งเชลล์ทั่วไป
});

/** ราคาโมเดลผ่าน API ต่อ 1M token (USD) — ใช้กับโหมดสำรอง api-fallback (ค่าชุดเดียวกับ usageLogger.js ของเลน B) */
export const MODEL_PRICE_PER_1M = Object.freeze({
  'gpt-6-astra': Object.freeze({ input: 10.0, output: 50.0 }), // ราคาทางการ 1 ต.ค. 69
  'gpt-6-sol': Object.freeze({ input: 5.0, output: 30.0 }),    // TODO(ยืนยันราคาจริง): ประมาณชั้น gpt-5.6-sol
  'gpt-6-luna': Object.freeze({ input: 1.0, output: 6.0 }),    // TODO(ยืนยันราคาจริง): ประมาณชั้น gpt-5.6-luna
});

/** ค่า web_search ต่อครั้งในโหมด API (Responses API tool call) */
export const API_WEB_SEARCH_PER_CALL_USD = 0.01;

// ลำดับสำคัญ: ชื่อเฉพาะก่อนคำกว้าง (เช่น web-agent ก่อน web search)
const CLASSIFIERS = [
  ['web-agent', /web[-_ ]?agent/i],
  ['fetch-page', /fetch[-_ ]?page/i],
  ['gemini-video', /gemini[-_ ]?video/i],
  ['youtube-meta', /youtube[-_ ]?meta/i],
  ['reverse-image', /reverse[-_ ]?image/i],
  ['rss-news', /rss/i],
  ['transcribe', /transcribe/i],
  ['serper', /serper/i],
  ['apify', /apify/i],
  ['ocr', /\bocr\b/i],
  ['wiki', /wiki/i],
  ['quota', /\bquota\b/i],
  ['browser', /\bcua\b|browser|chrome|\bedge\b|playwright/i],
  ['codex-web-search', /web\.run|web_search|websearch|web search/i],
];

/** จัดชนิดรายการ tool_log จากชื่อเครื่องมือ + อาร์กิวเมนต์ (เอเจนต์เขียนชื่อไม่คงที่ เช่น "exec_command / serper") */
export function classifyTool(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const blob = `${e.tool == null ? '' : e.tool} ${e.args == null ? '' : e.args}`;
  for (const [kind, re] of CLASSIFIERS) if (re.test(blob)) return kind;
  return 'other';
}

const round4 = (n) => Math.round(n * 10000) / 10000;

/**
 * นับการใช้งาน/ค่าใช้จ่ายจาก tool_log (ด่าน 7)
 * @param {Array} toolLog
 * @returns {{tool_calls:number, costUsd:number, byTool:Record<string,{calls:number,costUsd:number}>}}
 */
export function costFromToolLog(toolLog) {
  const list = Array.isArray(toolLog) ? toolLog : [];
  const byTool = {};
  let cost = 0;
  let calls = 0;
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.tool === 'worker') continue; // บันทึกของ worker เอง ไม่ใช่การเรียกเครื่องมือ
    calls++;
    const kind = classifyTool(entry);
    const price = TOOL_PRICE_USD[kind] ?? 0; // โหมด API: ค่าโทเคนจริง worker บวกแยก (ไม่อยู่ใน tool_log)
    cost += price;
    const slot = byTool[kind] || (byTool[kind] = { calls: 0, costUsd: 0 });
    slot.calls++;
    slot.costUsd = round4(slot.costUsd + price);
  }
  return { tool_calls: calls, costUsd: round4(cost), byTool };
}

/** ค่าโมเดลผ่าน API จากจำนวนโทเคน (ไม่รู้จักรุ่น = ใช้ราคา gpt-6-astra) */
export function modelCostUsd(model, inputTokens, outputTokens) {
  const rate = MODEL_PRICE_PER_1M[String(model || '')] || MODEL_PRICE_PER_1M['gpt-6-astra'];
  const inTok = Math.max(0, Number(inputTokens) || 0);
  const outTok = Math.max(0, Number(outputTokens) || 0);
  return round4((inTok / 1e6) * rate.input + (outTok / 1e6) * rate.output);
}

/**
 * ตรวจงบรายเดือน: คืนยอดใหม่และสถานะเกินเพดานหรือยัง (เตือนเท่านั้น ไม่หยุดงาน — ข้อ 18)
 * @param {{spentUsd:number, addUsd:number, capUsd:number}} p
 */
export function monthBudgetStatus({ spentUsd = 0, addUsd = 0, capUsd = 10 } = {}) {
  const before = Math.max(0, Number(spentUsd) || 0);
  const add = Math.max(0, Number(addUsd) || 0);
  const cap = Number(capUsd);
  const after = round4(before + add);
  const capOk = Number.isFinite(cap) && cap > 0;
  return { spentBefore: round4(before), spentAfter: after, capUsd: capOk ? cap : null, reached: capOk ? after >= cap : false };
}
