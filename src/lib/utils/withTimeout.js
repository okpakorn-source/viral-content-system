/**
 * ========================================
 * TIMEOUT UTILITY — Per-Step Timeout Protection
 * ========================================
 * ครอบ Promise ด้วย timeout — ถ้าเกินเวลาจะ reject ทันที
 * ป้องกัน 504 จาก AI calls ที่ค้างนานเกินไป
 */

/**
 * ครอบ promise ด้วย timeout
 * @param {Promise} promise — promise ที่ต้องการ timeout
 * @param {number} ms — เวลา timeout (milliseconds)
 * @param {string} stepName — ชื่อ step สำหรับ error message
 * @returns {Promise} — resolved value หรือ reject ด้วย TimeoutError
 */
export function withTimeout(promise, ms, stepName = 'unknown') {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(`TIMEOUT: ${stepName} ใช้เวลาเกิน ${Math.round(ms / 1000)}s`);
      err.failedStep = stepName; // ป้ายชื่อ step จริง — กัน route ชั้นบน default เป็น step ผิดตัว
      reject(err);
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

/**
 * ครอบ Promise.allSettled ด้วย per-item timeout
 * @param {Array<{promise: Promise, name: string, timeoutMs: number}>} tasks
 * @returns {Promise<PromiseSettledResult[]>}
 */
export function allSettledWithTimeout(tasks) {
  return Promise.allSettled(
    tasks.map(({ promise, name, timeoutMs }) =>
      withTimeout(promise, timeoutMs, name)
    )
  );
}
