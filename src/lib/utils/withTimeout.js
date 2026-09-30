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
  reservePipelineStepMs, // ★ 30 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 2 · เจ้าของอนุมัติ) — T1: ขั้นต่ำเพื่อเริ่ม/เพดานที่ใช้จริง (ตารางอยู่ที่ pipelineDeadline.js)
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
  // ★ 30 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 2 · เจ้าของอนุมัติ) — T1 PL-03/MC-02/BUG-02: เดิม "จอง" งบรวมเต็มเพดาน ms ทุกขั้น
  //   → generate_A (420s) ต้องเหลือ ≥420s = ขั้นก่อนเขียนช้า (แตกประเด็นถอย terra) แล้วงานตาย 504 ก่อนเรียกนักเขียน ทั้งที่เหลือ 6 นาที
  //   ใหม่ (ตัดสินที่ ./pipelineDeadline.js ที่เดียว — reservePipelineStepMs): ต้องเหลือ "เวลาขั้นต่ำเพื่อเริ่ม" (ตาราง STEP_MIN_START_TABLE
  //   · ค่าเริ่มต้น 60s · generate_A/write_inner 90s · raw_fact_* 45s · extract 30s) ถึงเริ่ม แล้วใช้เพดาน min(ms, เวลาที่เหลือ − 5s)
  //   เส้นตายรวมยังตัดทุกขั้นผ่าน linkedSignal ด้านล่าง · ถอย DEADLINE_RESERVE_LEGACY=1 = จองเต็มเพดานแบบเดิม
  //   (ของเดิม: pipelineDeadline?.assertCanStart(stepName, ms);)
  if (pipelineDeadline) ms = reservePipelineStepMs(pipelineDeadline, stepName, ms);
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
