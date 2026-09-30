import { AsyncLocalStorage } from 'node:async_hooks';

const deadlineStorage = new AsyncLocalStorage();

export class PipelineDeadlineError extends Error {
  constructor(step = 'unknown', message = '') {
    super(message || `เวลารวมของระบบข่าวไม่พอเริ่มขั้น ${step}`);
    this.name = 'PipelineDeadlineError';
    this.code = 'PIPELINE_DEADLINE_EXCEEDED';
    this.errorType = 'PIPELINE_DEADLINE_EXCEEDED';
    this.failedStep = 'pipeline_deadline';
    this.deadlineStep = step;
  }
}

export function isPipelineDeadlineError(error) {
  return error instanceof PipelineDeadlineError
    || error?.code === 'PIPELINE_DEADLINE_EXCEEDED'
    || error?.errorType === 'PIPELINE_DEADLINE_EXCEEDED';
}

// ============================================================
// ★ 30 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 2 · เจ้าของอนุมัติ) — T1 (PL-03 / MC-02 / BUG-02): "เวลาขั้นต่ำเพื่อเริ่ม" แยกจาก "เพดาน"
// ------------------------------------------------------------
// บั๊ก: ทุกขั้น "จอง" งบรวม 700s เต็มเพดานก่อนเริ่ม — withTimeoutSignal → assertCanStart(step, ms เต็ม) · ด่าน RAW assertCanStart(…, 180_000) ×3
//   + preparePipelineSignal(AbortSignal.timeout(180_000), 'raw_fact_audit', 180_000) → generate_A (เพดาน 420s) เริ่มได้เมื่อเหลือ ≥ 420s
//   = ขั้นก่อนเขียนต้องจบใน 280s · เคส ledger: สกัด 40 + sol หมดเวลา 200 + terra 42 + blueprint 30 + การ์ด 10 = 322s →
//   "เวลาเหลือ 378000ms ไม่พอสำหรับขั้น generate_A1 ที่ต้องมี 420000ms" = 504 หลังจ่ายค่าสกัด/แตกประเด็น 2 โมเดล/blueprint/การ์ด ทั้งที่เหลือ 6 นาที
//   · ด่าน RAW: หลัง audit + Sol editor เหลือ 170s → audit รอบสุดท้ายถูกปฏิเสธ (ต้องมี 180s) = 504 หลังจ่ายไปแล้ว
//   · เคยแก้ 1–2 ก.ย. (621ad46e / 2c54d4ef — clamp ขั้นต่ำ 60s) แต่ restore 7 ก.ย. (a313281c) ย้อนทิ้งไปทั้งชุด = regression
// ค่าเริ่มต้น (ตัดสินที่ไฟล์นี้ + withTimeoutSignal ใน ./withTimeout.js ที่เดียว — ไม่แตะ call site ของท่อ):
//   · assertCanStart(step, requiredMs) ตรวจแค่ขั้นต่ำเพื่อเริ่ม = min(requiredMs, ตาราง) — ขั้นที่เพดานต่ำกว่าตาราง
//     (client 15s · correction 60s · smart_research 60s) ต้องเหลือเท่าเดิมทุกประการ
//   · เพดานที่ใช้จริงหลังผ่านด่านเริ่ม = min(เพดาน, เวลาที่เหลือ − 5s) (stepEffectiveTimeoutMs) — withTimeoutSignal ตั้ง timer ตามนี้
//     · preparePipelineSignal ที่จองเกินขั้นต่ำ (ด่าน RAW ส่งเพดานต่อคำขอ 180s เป็น requiredMs) ได้ตัวตัดคำขอเพิ่มที่ค่าเดียวกัน
//     · client ทั่วไป (15s ≤ ขั้นต่ำ) ไม่มีตัวตัดเพิ่ม = เหมือนเดิม
//   · เส้นตายรวมยังตัดทุกขั้นเหมือนเดิม (linkedSignal ของ withTimeoutSignal · composeAbortSignals ของ preparePipelineSignal)
//   ตาราง (ปรับได้ด้วย env · ว่าง/ค่าเพี้ยน/ติดลบ = ค่าในตาราง): ขั้นอื่น 60s DEADLINE_MIN_START_DEFAULT_MS · generate_A* / write_inner 90s
//     DEADLINE_MIN_START_WRITE_MS · raw_fact_* 45s DEADLINE_MIN_START_RAW_FACT_MS · extract 30s DEADLINE_MIN_START_EXTRACT_MS
// สวิตช์ถอย DEADLINE_RESERVE_LEGACY = 1 | true | on | yes | legacy (ทนช่องว่าง/อัญประกาศ/ตัวพิมพ์) → จองเต็มเพดานแบบเดิมทุกไบต์
//   (assertCanStart ต้องเหลือเต็ม requiredMs · withTimeoutSignal ใช้เพดานเดิม · preparePipelineSignal ไม่มีตัวตัดเพิ่ม)
//   ไม่ตั้ง / ว่าง / 0 / ค่าอื่น = ค่าเริ่มต้นใหม่ · อ่าน env ทุกครั้ง ไม่แคช · ไม่มีเส้นตายรวม (ระบบคลิป/ปก/นอก route ข่าว) = ไม่ถูกแตะ
// ข้อสอบ: tests/deadline-reserve-t1.test.mjs (2 โหมดสวิตช์ · tests/helpers/fake-deadline.mjs · mutation)
// ============================================================

/** เวลาที่กันไว้ท้ายเส้นตายรวมให้ชั้นนอกรายงานผล/บันทึก เมื่อหั่นเพดานของขั้น */
export const PIPELINE_TAIL_RESERVE_MS = 5_000;
/** เวลาขั้นต่ำเพื่อเริ่มของขั้นที่ไม่อยู่ในตาราง (ค่าเดียวกับ clamp ที่เจ้าของอนุมัติ 1 ก.ย. — 621ad46e) */
export const STEP_MIN_START_DEFAULT_MS = 60_000;
export const STEP_MIN_START_DEFAULT_ENV = 'DEADLINE_MIN_START_DEFAULT_MS';
/**
 * ตารางเวลาขั้นต่ำเพื่อเริ่มต่อขั้น · step = ชื่อขั้นตรงตัว หรือ prefix ลงท้าย '*' (ตรงตัวชนะ · prefix ยาวสุดชนะ) · ไม่เข้าแถวไหน = ค่าเริ่มต้น 60s
 * ค่าที่ใช้จริง = min(เพดานที่ผู้เรียกส่ง, ค่าในแถว) · env ของแถว (ถ้าตั้ง) แทน ms
 */
export const STEP_MIN_START_TABLE = Object.freeze([
  Object.freeze({ step: 'generate_A*', ms: 90_000, env: 'DEADLINE_MIN_START_WRITE_MS' }), // ขั้นเขียนต่อมุม (autoFlowServiceText · เพดาน 420s)
  Object.freeze({ step: 'write_inner', ms: 90_000, env: 'DEADLINE_MIN_START_WRITE_MS' }), // โซ่นักเขียน opus→fable→sol (summarizeServiceText · เพดาน 350s)
  Object.freeze({ step: 'raw_fact_*', ms: 45_000, env: 'DEADLINE_MIN_START_RAW_FACT_MS' }), // ด่าน RAW audit/editor/final + คำขอ Sol (เพดาน 180s)
  Object.freeze({ step: 'extract', ms: 30_000, env: 'DEADLINE_MIN_START_EXTRACT_MS' }), // ขั้นสกัด (autoFlowServiceText · เพดาน 180s)
]);

const RESERVE_LEGACY_ON_VALUES = new Set(['1', 'true', 'on', 'yes', 'legacy']);
const cleanDeadlineEnv = (raw) => String(raw).trim().replace(/^["']|["']$/g, '').trim();

/** โหมดถอย DEADLINE_RESERVE_LEGACY เปิดอยู่หรือไม่ (ค่าเริ่มต้น = ปิด = พฤติกรรมใหม่) */
export function isDeadlineReserveLegacy() {
  const raw = process.env.DEADLINE_RESERVE_LEGACY;
  if (raw == null) return false;
  return RESERVE_LEGACY_ON_VALUES.has(cleanDeadlineEnv(raw).toLowerCase());
}

function envMinStartMs(name, fallback) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const value = cleanDeadlineEnv(raw);
  if (value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback; // ค่าเพี้ยน = ค่าในตาราง (ไม่ใช่ "ไม่มีขั้นต่ำ")
}

function minStartRule(step) {
  const name = String(step ?? '');
  let prefixRule = null;
  let prefixLength = -1;
  for (const rule of STEP_MIN_START_TABLE) {
    if (!rule.step.endsWith('*')) {
      if (rule.step === name) return rule;
      continue;
    }
    const prefix = rule.step.slice(0, -1);
    if (name.startsWith(prefix) && prefix.length > prefixLength) {
      prefixRule = rule;
      prefixLength = prefix.length;
    }
  }
  return prefixRule;
}

/** เวลาขั้นต่ำเพื่อเริ่มของขั้นตามตาราง + env (ยังไม่ min กับเพดาน) */
export function stepMinStartMs(step) {
  const rule = minStartRule(step);
  return rule
    ? envMinStartMs(rule.env, rule.ms)
    : envMinStartMs(STEP_MIN_START_DEFAULT_ENV, STEP_MIN_START_DEFAULT_MS);
}

/** เวลาที่ต้องเหลือเพื่อเริ่มขั้น (ค่าเริ่มต้นใหม่) = min(เพดาน, ขั้นต่ำตามตาราง) */
export function stepStartRequirementMs(step, capMs) {
  return Math.min(Math.max(0, Number(capMs) || 0), stepMinStartMs(step));
}

/**
 * เพดานที่ใช้จริงหลังผ่านด่านเริ่ม = min(เพดาน, เวลาที่เหลือ − 5s) → ไม่มีขั้นไหนวิ่งเลยเส้นตายรวม และเหลือท้าย 5s ให้ชั้นนอก
 * เหลือไม่ถึง 6s (มีได้เฉพาะขั้นเพดานสั้นมาก) = ไม่ต่ำกว่า min(1s, เวลาที่เหลือ) · ไม่รู้เวลาที่เหลือ / เพดานไม่ใช่ตัวเลขบวก = เพดานเดิม
 */
export function stepEffectiveTimeoutMs(capMs, remainingMs) {
  const cap = Number(capMs);
  const remaining = remainingMs == null ? NaN : Number(remainingMs); // null/undefined = ไม่รู้ (ไม่ใช่ 0)
  if (!Number.isFinite(cap) || cap <= 0 || !Number.isFinite(remaining)) return capMs;
  const room = Math.max(remaining - PIPELINE_TAIL_RESERVE_MS, Math.min(remaining, 1_000));
  return Math.min(cap, room);
}

function warnStepClamped(kind, step, capMs, remainingMs, effectiveMs) {
  const secs = (ms) => Math.round(ms / 1000);
  console.warn(`[pipelineDeadline] ⏱️ ${kind} ${step}: เพดาน ${secs(capMs)}s แต่เส้นตายรวมเหลือ ${secs(remainingMs)}s → ใช้ ${secs(effectiveMs)}s`
    + ` (กันท้าย ${secs(PIPELINE_TAIL_RESERVE_MS)}s · ถอย DEADLINE_RESERVE_LEGACY=1)`);
}

/**
 * จองงบของขั้นกับเส้นตายรวมก่อนเริ่ม แล้วคืนเพดานที่ใช้จริง (ms) — ใช้โดย withTimeoutSignal (./withTimeout.js)
 * ค่าเริ่มต้น: assertCanStart ตรวจขั้นต่ำเพื่อเริ่ม (ไม่พอ = PipelineDeadlineError ก่อนเริ่ม ไม่จ่ายเงิน) → คืน min(เพดาน, เหลือ − 5s)
 * โหมดถอย: assertCanStart(step, เพดานเต็ม) แล้วคืนเพดานเดิม = ของเดิมทุกประการ · ไม่มีเส้นตาย = คืนเพดานเดิม ไม่ตรวจ
 */
export function reservePipelineStepMs(deadline, step, capMs) {
  if (!deadline) return capMs;
  const remaining = deadline.assertCanStart(step, capMs);
  if (isDeadlineReserveLegacy()) return capMs;
  const effective = stepEffectiveTimeoutMs(capMs, remaining);
  if (effective < capMs) warnStepClamped('ขั้น', step, capMs, remaining, effective);
  return effective;
}

/** ตัวตัดคำขอเพิ่มของ preparePipelineSignal เมื่อผู้เรียกจองเกินขั้นต่ำ (requiredMs = เพดานต่อคำขอ) — ไม่ต้องตัด/โหมดถอย = undefined */
function requestTailCutSignal(step, requiredMs, remaining) {
  if (isDeadlineReserveLegacy()) return undefined; // ของเดิม: ผูกแค่เส้นตายรวม
  const cap = Number(requiredMs);
  if (!Number.isFinite(cap) || cap <= stepMinStartMs(step)) return undefined; // client ทั่วไป (15s) = ไม่แตะ
  const effective = stepEffectiveTimeoutMs(cap, remaining);
  if (!(effective < cap) || typeof AbortSignal?.timeout !== 'function') return undefined;
  warnStepClamped('คำขอ', step, cap, remaining, effective);
  return AbortSignal.timeout(effective);
}

export function createPipelineDeadline({
  deadlineAt,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const absoluteDeadline = Number(deadlineAt);
  if (!Number.isFinite(absoluteDeadline)) {
    throw new TypeError('deadlineAt ต้องเป็นเวลาแบบ milliseconds ที่ถูกต้อง');
  }

  const controller = new AbortController();
  let disposed = false;
  const remainingMs = () => Math.max(0, absoluteDeadline - now());
  // ข่าวหลายมุมทำงานพร้อมกัน จึงห้ามเก็บชื่อขั้นไว้ในตัวแปรร่วม
  // ไม่เช่นนั้นงานที่เริ่มทีหลังจะเขียนทับชื่อขั้นของงานที่หมดเวลาก่อน
  const timeoutError = () => new PipelineDeadlineError('pipeline',
    'เวลารวมของระบบข่าวครบกำหนด');
  let timer = null;
  if (remainingMs() <= 0) {
    // setTimeout(0) ยังเปิดช่องให้ handler เริ่มก่อน event loop รอบถัดไป
    // คำขอที่หมดอายุมาแล้วต้องถูกปิดแบบ synchronous ก่อนเริ่มงานใด ๆ
    controller.abort(timeoutError());
  } else {
    timer = setTimer(() => {
      if (!controller.signal.aborted) controller.abort(timeoutError());
    }, remainingMs());
  }
  timer?.unref?.();

  return {
    deadlineAt: absoluteDeadline,
    signal: controller.signal,
    remainingMs,
    assertCanStart(step, requiredMs = 0) {
      const requestedStep = step || 'unknown';
      // ★ 30 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 2 · เจ้าของอนุมัติ) — T1 PL-03/MC-02/BUG-02: ค่าเริ่มต้นตรวจแค่ "เวลาขั้นต่ำเพื่อเริ่ม"
      //   = min(requiredMs, ตาราง STEP_MIN_START_TABLE ด้านล่าง) — requiredMs ที่ผู้เรียกส่ง (= เพดานของขั้น) ไม่ถูกจองเต็มก้อนแล้ว
      //   (ด่าน RAW assertCanStart(…, 180_000) ×3 ได้ผลด้วยโดยไม่แตะ call site) · โหมดถอย DEADLINE_RESERVE_LEGACY=1 = ต้องเหลือเต็ม requiredMs
      //   (ของเดิม: const required = Math.max(0, Number(requiredMs) || 0);)
      const required = isDeadlineReserveLegacy()
        ? Math.max(0, Number(requiredMs) || 0)
        : stepStartRequirementMs(requestedStep, requiredMs);
      if (controller.signal.aborted || remainingMs() < required) {
        throw controller.signal.reason instanceof PipelineDeadlineError
          ? controller.signal.reason
          : new PipelineDeadlineError(requestedStep,
            `เวลาเหลือ ${remainingMs()}ms ไม่พอสำหรับขั้น ${requestedStep} ที่ต้องมี ${required}ms`);
      }
      return remainingMs();
    },
    throwIfExpired(step = 'pipeline') {
      const requestedStep = step || 'pipeline';
      if (controller.signal.aborted || remainingMs() <= 0) {
        throw controller.signal.reason instanceof PipelineDeadlineError
          ? controller.signal.reason
          : new PipelineDeadlineError(requestedStep,
            `เวลารวมของระบบข่าวครบกำหนดก่อนขั้น ${requestedStep}`);
      }
    },
    dispose({ abortPending = true } = {}) {
      if (disposed) return;
      disposed = true;
      clearTimer(timer);
      // Promise.race เก่าบางชั้นอาจคืนก่อน HTTP ลูกจบ การปิด request ต้องตัดลูกที่ยังค้างด้วย
      if (abortPending && !controller.signal.aborted) {
        controller.abort(new DOMException('News pipeline request finished', 'AbortError'));
      }
    },
  };
}

export function runWithPipelineDeadline(deadline, fn) {
  return deadlineStorage.run(deadline, async () => {
    // ปิดช่อง request ที่รับ header deadline ซึ่งหมดอายุแล้ว แต่ timer 0ms ยังไม่ทำงาน
    deadline.throwIfExpired('pipeline');
    let abortHandler;
    const deadlineReached = new Promise((_, reject) => {
      abortHandler = () => reject(
        deadline.signal.reason instanceof Error
          ? deadline.signal.reason
          : new PipelineDeadlineError('pipeline')
      );
      if (deadline.signal.aborted) abortHandler();
      else deadline.signal.addEventListener('abort', abortHandler, { once: true });
    });
    try {
      // บังคับให้ handler คืนการควบคุมแม้กำลังค้างใน DB/logger ที่ไม่รับ AbortSignal
      return await Promise.race([Promise.resolve().then(fn), deadlineReached]);
    } finally {
      if (abortHandler) deadline.signal.removeEventListener('abort', abortHandler);
      deadline.dispose({ abortPending: true });
    }
  });
}

export function getActivePipelineDeadline() {
  return deadlineStorage.getStore() || null;
}

export function resolvePipelineDeadlineAt(headerValue, routeStartedAt, maxBudgetMs = 700_000) {
  const routeLimit = routeStartedAt + maxBudgetMs;
  const headerDeadline = Number(String(headerValue || '').trim());
  return Number.isFinite(headerDeadline) && headerDeadline > 0
    ? Math.min(routeLimit, headerDeadline)
    : routeLimit;
}

export function resolveNewsQueueTiming(rawDeadline) {
  const parsed = Number(String(rawDeadline || '').trim().replace(/^["']|["']$/g, ''));
  // ต้องเหลือ buffer 70s ให้ route self-report/worker commit และ Agent ต้องจบก่อน maxDuration 800s
  const workerDeadlineMs = Number.isFinite(parsed) && parsed >= 71_000 && parsed <= 770_000
    ? parsed
    : 770_000;
  return {
    workerDeadlineMs,
    pipelineBudgetMs: Math.min(700_000, workerDeadlineMs - 70_000),
  };
}

export function composeAbortSignals(...signals) {
  const valid = signals.filter(signal => signal && typeof signal.addEventListener === 'function');
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(valid);

  const controller = new AbortController();
  const abort = (signal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  for (const signal of valid) {
    if (signal.aborted) {
      abort(signal);
      break;
    }
    signal.addEventListener('abort', () => abort(signal), { once: true });
  }
  return controller.signal;
}

export function preparePipelineSignal(signal, step = 'ai_request', requiredMs = 15_000) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new PipelineDeadlineError(step, `ขั้น ${step} ถูกยกเลิกก่อนเริ่ม request`);
  }
  const deadline = getActivePipelineDeadline();
  if (!deadline) return signal;
  // ★ 30 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 2 · เจ้าของอนุมัติ) — T1 PL-03/MC-02/BUG-02: assertCanStart ตรวจแค่ขั้นต่ำเพื่อเริ่มแล้ว
  //   ผู้เรียกที่จองเกินขั้นต่ำ (ด่าน RAW: AbortSignal.timeout(180_000) + requiredMs 180_000) ได้ตัวตัดคำขอเพิ่มที่ min(เพดาน, เหลือ − 5s)
  //   client ทั่วไป (15_000 ≤ ขั้นต่ำ) ไม่มีตัวตัดเพิ่ม · โหมดถอย DEADLINE_RESERVE_LEGACY=1 = ของเดิมทุกไบต์
  //   (ของเดิม: deadline.assertCanStart(step, requiredMs); return composeAbortSignals(signal, deadline.signal);)
  const remaining = deadline.assertCanStart(step, requiredMs);
  return composeAbortSignals(signal, deadline.signal, requestTailCutSignal(step, requiredMs, remaining));
}

export function rethrowPipelineDeadline(error, step = 'unknown') {
  if (isPipelineDeadlineError(error)) throw error;
  const deadline = getActivePipelineDeadline();
  if (deadline?.signal?.aborted) {
    throw deadline.signal.reason instanceof PipelineDeadlineError
      ? deadline.signal.reason
      : new PipelineDeadlineError(step);
  }
}
