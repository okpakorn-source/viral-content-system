/**
 * ========================================
 * TIMEOUT UTILITY — Per-Step Timeout Protection
 * ========================================
 * ครอบ Promise ด้วย timeout — ถ้าเกินเวลาจะ reject ทันที
 * ป้องกัน 504 จาก AI calls ที่ค้างนานเกินไป
 */
import {
  composeAbortSignals,
  getActivePipelineDeadline,
  PipelineDeadlineError,
} from './pipelineDeadline.js';

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
 * ★ 16 ก.ค. 69 (B4): timeout แบบ "หยุดงานจริง" — ของเดิม Promise.race แค่เลิกรอ
 * แต่ request AI ต้นทางยังวิ่งจนจบ = จ่ายเงิน 2 โมเดลซ้อนทุกครั้งที่ fallback ทำงาน
 * ตัวนี้รับ factory(signal) แล้ว abort() HTTP request จริงเมื่อ timer ยิง
 * ใต้สวิตช์ WITHTIMEOUT_ABORT=1 (default OFF = พฤติกรรมเดิมเป๊ะ) — เปิดเทสบน :3900 ก่อน
 * @param {(signal: AbortSignal|undefined) => Promise} factory — ฟังก์ชันสร้าง promise รับ signal
 * @param {number} ms
 * @param {string} stepName
 */
export function withTimeoutSignal(factory, ms, stepName = 'unknown', parentSignal) {
  const pipelineDeadline = getActivePipelineDeadline();
  pipelineDeadline?.assertCanStart(stepName, ms);
  const abortOn = (pipelineDeadline || parentSignal || process.env.WITHTIMEOUT_ABORT === '1')
    && typeof AbortController !== 'undefined';
  if (!abortOn) {
    return withTimeout(factory(undefined), ms, stepName);
  }
  const ctrl = new AbortController();
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(`TIMEOUT: ${stepName} ใช้เวลาเกิน ${Math.round(ms / 1000)}s (ยกเลิก request จริงแล้ว)`);
      err.failedStep = stepName;
      try { ctrl.abort(err); } catch {}
      reject(err);
    }, ms);
  });
  const linkedSignal = composeAbortSignals(ctrl.signal, parentSignal, pipelineDeadline?.signal);
  let linkedAbortHandler = null;
  const linkedAbort = linkedSignal
    ? new Promise((_, reject) => {
      const rejectAbort = () => reject(
        linkedSignal.reason instanceof Error
          ? linkedSignal.reason
          : new PipelineDeadlineError(stepName)
      );
      if (linkedSignal.aborted) rejectAbort();
      else {
        linkedAbortHandler = rejectAbort;
        linkedSignal.addEventListener('abort', linkedAbortHandler, { once: true });
      }
    })
    : null;
  return Promise.race([
    factory(linkedSignal),
    timeoutPromise,
    ...(linkedAbort ? [linkedAbort] : []),
  ]).finally(() => {
    clearTimeout(timeoutId);
    if (linkedAbortHandler) {
      linkedSignal.removeEventListener('abort', linkedAbortHandler);
    }
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
