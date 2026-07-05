// ============================================================
// [ระบบทำปกออโต้] Retry + backoff กลาง
// ------------------------------------------------------------
// กัน AI (Gemini/Claude/OpenAI) ล้มชั่วคราว (503/429/overloaded/
// network) แล้วปล่อยผลมั่ว — ให้รอแล้วลองใหม่หลายรอบก่อนยอมแพ้
// ============================================================

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 529]);

export function isRetryable(err) {
  if (!err) return false;
  if (err.status && RETRYABLE_STATUS.has(err.status)) return true;
  const m = String(err.message || '');
  return /\b(408|425|429|500|502|503|504|529)\b|overloaded|unavailable|high demand|temporarily|rate.?limit|timeout|timed out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network/i.test(
    m
  );
}

// fn(attempt) → ผลลัพธ์ ; retry เมื่อ error retryable, backoff แบบทวีคูณ + jitter
// onAttempt(attempt, waitMs, err) เรียกก่อนรอรอบถัดไป (ใช้อัปเดตสถานะ "รอคิว")
export async function withRetry(fn, { retries = 6, baseMs = 2000, maxMs = 30000, onAttempt } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= retries || !isRetryable(err)) throw err;
      const wait = Math.min(maxMs, baseMs * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500);
      if (onAttempt) {
        try {
          onAttempt(attempt, wait, err);
        } catch {
          /* ไม่ให้ callback ล้มลาม */
        }
      }
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}
