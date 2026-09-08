import { createHash, timingSafeEqual } from 'node:crypto';
import { RoutineError, errorReply } from './errors.mjs';

export function authenticate(request, env = process.env, compare = timingSafeEqual) {
  if (env.ROUTINE_API !== '1') {
    throw new RoutineError(404, 'ROUTINE_API_DISABLED', 'Routine API ปิดอยู่');
  }
  const supplied = request.headers.get('x-routine-key') || '';
  const configured = env.ROUTINE_API_KEY || '';
  // Fixed-size digests ensure different key lengths also reach timingSafeEqual.
  const digest = value => createHash('sha256').update(value).digest();
  const equal = compare(digest(supplied), digest(configured));
  if (!configured || !supplied || !equal) {
    throw new RoutineError(401, 'ROUTINE_UNAUTHORIZED', 'คีย์ Routine API ไม่ถูกต้องหรือยังไม่ได้ตั้งค่า');
  }
}

const methods = { health: 'GET', news: 'POST', jobs: 'POST', job: 'GET', results: 'GET', select: 'POST' };

// Only this routine-owned module is loaded by route entry points while disabled.
export function createHandler(operation, {
  env = () => process.env,
  load = () => import('./runtime.mjs'),
} = {}) {
  return async function handler(request, context = {}) {
    let reply;
    try {
      const environment = env();
      authenticate(request, environment);
      if (!methods[operation]) throw new RoutineError(404, 'ROUTINE_NOT_FOUND', 'ไม่พบ endpoint นี้');
      if (request.method !== methods[operation]) {
        throw new RoutineError(405, 'ROUTINE_METHOD_NOT_ALLOWED', 'HTTP method ไม่รองรับ');
      }
      if (operation === 'select') {
        throw new RoutineError(501, 'ROUTINE_NOT_IMPLEMENTED', 'ยังไม่รองรับการบันทึกฉบับสุดท้าย: Codex เลือกฉบับจาก versions[] เองได้');
      }
      const runtime = await load();
      reply = await runtime.dispatch(operation, request, await context.params || {}, environment);
    } catch (error) {
      reply = errorReply(error);
    }
    return Response.json(reply.body, {
      status: reply.status,
      headers: { 'Cache-Control': 'no-store', ...(reply.headers || {}) },
    });
  };
}
