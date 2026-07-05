// ============================================================
// [ระบบทำปกออโต้] ตารางราคา API (ประมาณการ — แก้ได้)
// ------------------------------------------------------------
// ราคาต่อ 1 ล้าน token (USD) สำหรับ LLM + ราคาต่อหน่วยสำหรับบริการอื่น
// ⚠️ เป็น "ประมาณการ" (ม.ค. 2026) ปรับได้ผ่าน .env.local หรือแก้ไฟล์นี้
// ============================================================

const num = (v, d) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

// ราคา LLM ต่อ 1,000,000 token: { in: ราคา input, out: ราคา output }
export const LLM_RATES = {
  'claude-opus-4-8': { in: num(process.env.RATE_CLAUDE_OPUS_IN, 15), out: num(process.env.RATE_CLAUDE_OPUS_OUT, 75) },
  'gpt-4o': { in: num(process.env.RATE_GPT4O_IN, 2.5), out: num(process.env.RATE_GPT4O_OUT, 10) },
  'gemini-2.5-flash': { in: num(process.env.RATE_GEMINI_FLASH_IN, 0.3), out: num(process.env.RATE_GEMINI_FLASH_OUT, 2.5) },
  'gemini-2.0-flash': { in: 0.1, out: 0.4 },
};

// ราคาเริ่มต้นต่อ provider (เผื่อ model ไม่อยู่ในตาราง)
const PROVIDER_DEFAULT = {
  anthropic: { in: 15, out: 75 },
  openai: { in: 2.5, out: 10 },
  gemini: { in: 0.3, out: 2.5 },
};

// SerpApi: ราคาต่อ 1 ครั้งค้นหา (แผนฟรี = 0; แผนจ่ายเงินราว $0.01–0.015/ครั้ง)
export const SERPAPI_PER_SEARCH = num(process.env.SERPAPI_COST_PER_SEARCH, 0.015);

// Replicate Real-ESRGAN: คิดตามเวลารัน (predict_time) × ราคา/วินาที (T4 ~ $0.000225/s)
export const REPLICATE_PER_SEC = num(process.env.REPLICATE_COST_PER_SEC, 0.000225);
export const REPLICATE_FLAT = num(process.env.REPLICATE_FLAT_COST, 0.005); // เผื่อไม่มี metric

// normalize ชื่อ model → key ในตาราง (ตัด suffix วันที่/เวอร์ชัน)
function rateFor(provider, model) {
  const m = String(model || '').toLowerCase();
  if (LLM_RATES[m]) return LLM_RATES[m];
  for (const key of Object.keys(LLM_RATES)) {
    if (m.startsWith(key) || m.includes(key)) return LLM_RATES[key];
  }
  return PROVIDER_DEFAULT[provider] || PROVIDER_DEFAULT.openai;
}

// คำนวณต้นทุน LLM (USD) จาก token
export function llmCost(provider, model, inTok, outTok) {
  const r = rateFor(provider, model);
  const cost = (inTok || 0) / 1e6 * r.in + (outTok || 0) / 1e6 * r.out;
  return Math.max(0, cost);
}
