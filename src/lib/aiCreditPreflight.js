/**
 * =====================================================
 * AI Credit Preflight — เช็ค "OpenAI หมดเครดิต/โควต้า"
 * =====================================================
 * ผู้ใช้สั่ง (19 มิ.ย.): API หมด → แจ้งเตือนตอนกดสร้าง อย่าปล่อยให้ได้ "ปกกาๆ"
 *
 * ★ raw fetch ล้วน — ไม่ import openai.js / aiRouter (แยกขาดจากเวิร์กโฟลว์ทำข่าว 100%)
 * ใช้ร่วมกัน:
 *   - /api/ai-preflight        → เช็คตอนกดสร้าง (UI)
 *   - /api/auto-cover-v3       → ตาข่ายชั้นท้าย (งานจาก Discord/cron/เครดิตหมดกลางทาง)
 */

/** จัดประเภท error จาก OpenAI — คืน {errorType, error} ถ้าเป็นเคสที่ต้อง "บล็อกการสร้าง", ไม่งั้น null */
export function classifyOpenAIError(status, bodyText) {
  const t = String(bodyText || '').toLowerCase();
  if (status === 429 && (t.includes('insufficient_quota') || t.includes('exceeded your current quota') || t.includes('billing'))) {
    return { errorType: 'API_QUOTA_EXCEEDED', error: '⚠️ ระบบ AI (OpenAI) หมดเครดิต/โควต้า — กรุณาเติมเงินก่อนกดสร้างปก (ยังสร้างไม่ได้ตอนนี้)' };
  }
  if (status === 401 || t.includes('invalid api key') || t.includes('incorrect api key')) {
    return { errorType: 'API_KEY_INVALID', error: '⚠️ คีย์ OpenAI ไม่ถูกต้อง/หมดอายุ — ตรวจสอบ OPENAI_API_KEY ก่อนกดสร้าง' };
  }
  // rate limit ชั่วคราว (ไม่ใช่เครดิตหมด) → ไม่บล็อก
  return null;
}

/**
 * ยิง completion เล็กสุด (1 token) เช็คว่าเครดิตหมดจริงไหม
 * คืน: { ok:true } | { ok:false, errorType, error, provider }
 * error อื่นๆ (5xx/เน็ตหลุด/rate limit) → fail-open (ok:true) กันบล็อกผิดพลาด
 */
export async function checkOpenAICredit({ timeoutMs = 12_000 } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return { ok: false, provider: 'openai', errorType: 'API_KEY_MISSING', error: '⚠️ ยังไม่ได้ตั้งค่า OPENAI_API_KEY — สร้างปกไม่ได้' };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
    });
    clearTimeout(timer);
    if (res.ok) return { ok: true, provider: 'openai' };
    const bodyText = await res.text().catch(() => '');
    const cls = classifyOpenAIError(res.status, bodyText);
    if (cls) return { ok: false, provider: 'openai', ...cls };
    return { ok: true, provider: 'openai', note: `non-blocking openai status ${res.status}` };
  } catch (err) {
    return { ok: true, provider: 'openai', note: `preflight network skip: ${String(err.message || err).slice(0, 60)}` };
  }
}
