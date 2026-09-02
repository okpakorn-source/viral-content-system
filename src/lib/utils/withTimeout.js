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
  if (pipelineDeadline) {
    // ★ 1 ก.ย. 69 (บั๊กระดับกลาง พิสูจน์แล้ว): เดิม "จอง" งบเต็ม ms ทุกขั้น รวมกันเกินงบทั้งระบบ
    //   ขั้นก่อนหน้าช้า (เช่นแตกประเด็นถอยตัวสำรอง) → ขั้นเขียนถูกโยนทิ้งทั้งที่เวลาเหลือพอเขียน
    //   ใหม่: ต้องเหลืออย่างน้อย MIN_STEP_MS ถึงเริ่ม แล้วหั่น ms ให้พอดีเวลาที่เหลือ (เผื่อ 5s ให้ชั้นนอกรายงานผล)
    const MIN_STEP_MS = 60_000;
    const remaining = pipelineDeadline.assertCanStart(stepName, Math.min(ms, MIN_STEP_MS));
    if (remaining < ms) {
      const clamped = Math.max(MIN_STEP_MS, remaining - 5_000);
      console.warn(`[withTimeout] ⏱️ ${stepName}: งบ ${Math.round(ms / 1000)}s แต่เหลือ ${Math.round(remaining / 1000)}s → หั่นเหลือ ${Math.round(clamped / 1000)}s`);
      ms = clamped;
    }
  }
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
