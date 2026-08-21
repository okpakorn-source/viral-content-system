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
      const required = Math.max(0, Number(requiredMs) || 0);
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
  deadline.assertCanStart(step, requiredMs);
  return composeAbortSignals(signal, deadline.signal);
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
