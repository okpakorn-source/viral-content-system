// ============================================================
// ⏱️ tests/helpers/fake-deadline.mjs — รอแบบไม่ปล่อย event loop ว่าง + เส้นตายรวมที่เทสกดยิงเอง (ใช้ซ้ำได้ทุกไฟล์เทส)
// ★ 25 ก.ย. 69 (แคมเปญแก้บั๊ก · CI run 36091468303) — ย้ายจาก tests/text-queue-handoff-contract.test.mjs (commit 42b3086e)
//   ความหมายเดิมทุกอย่าง (ไฟล์นั้นยังใช้สำเนาของตัวเองอยู่ — ย้ายไปใช้ helper นี้ได้โดยไม่เปลี่ยนผล)
// ------------------------------------------------------------
// บทเรียน node 22 (CI = ubuntu · setup-node 22) — แดงมาแล้ว 2 ไฟล์ด้วยต้นเหตุเดียวกัน:
//   node:test ฟัง process 'beforeExit' (lib/internal/test_runner/harness.js exitHandler) — ถ้า event loop ว่าง
//   (ไม่เหลือ handle ที่ ref) ขณะเทสยัง await อยู่ node 22 เรียก root.postRun(...) ทันที → ข้อที่กำลังรัน + ทุกข้อที่ยังไม่รัน
//   = cancelled "Promise resolution is still pending but the event loop has already resolved" (ลามทั้งไฟล์ ไม่ใช่ fail ข้อเดียว)
//   node 24: nodejs/node#58800 ใส่ keepAlive = setInterval(() => {}, TIMEOUT_MAX) แล้วรอ subtests ต่อ → timer ที่ unref ได้ยิง
//   = เขียวบน Windows/node 24 โดยบังเอิญ (keepAlive ค้างจนจบไฟล์ จึงบังจุดว่างถัดๆ ไปด้วย — รันบน node 24 ไม่เห็นปัญหาเลย)
//   เคสจริง: (1) text-queue-handoff-contract ข้อ 8 รอ timer ของ createPipelineDeadline ซึ่ง production ตั้งใจ unref()
//                (src/lib/utils/pipelineDeadline.js — ไม่ให้เส้นตายค้ำ process) → CI แดง 7/12 cancelled 5
//            (2) correction-ai-timeout-pl11 ข้อ 7/11/13/17 (โหมดถอย ไม่มีเพดานเวลา) รอ AI ปลอมที่ setTimeout แล้ว unref()
//                → CI แดง pass 6/24 cancelled 18
// กติกาเทสที่รอเวลา/สัญญาณ async:
//   1. ห้าม await สิ่งที่ตัวขับเดียวคือ timer ที่ unref (ของเทสเอง หรือของ production ที่ตั้งใจ unref) → ใช้สัญญาณที่เทสคุม
//      (deferred · manualPipelineDeadline().expire()) หรือ timer ที่ ref ไว้ + clear ใน finally
//   2. await ที่อาจค้าง → ครอบ settleWithin: timer ref ค้ำ loop ระหว่างรอ + แดง "ข้อเดียว" พร้อมข้อความเมื่อสัญญาณไม่มา
//   3. ตรวจบน node 24 ก่อน push: preload ดัก 'beforeExit' + reporter ติดตาม test:dequeue/test:complete (รันแบบไม่ใส่ --test)
//      ห่อ exitHandler ของ harness แล้วเรียก exitHandler(true) = เส้นทางของ node 22 (ข้าม keepAlive) — จำลองได้ตรงผล CI
//      (ไม่ใช้ test:start ติดตาม: node 24 ยิง test:start ใน report() หลังข้อบนสุดรันจบแล้ว)
// ============================================================
import assert from 'node:assert/strict';
import { createPipelineDeadline } from '../../src/lib/utils/pipelineDeadline.js';

/**
 * รอ promise ที่เทสควบคุมไม่เกิน ms แล้วแดงพร้อมข้อความ · timer นี้ ref โดยตั้งใจ: ระหว่างรอ event loop ไม่ว่าง
 * (node:test ของ node 22 จึงไม่ยกเลิกทั้งไฟล์) ถ้าสัญญาณไม่มาจริงจะแดงข้อเดียว · clear ทุกทางกัน timer รั่วค้ำ process
 * @param {Promise} promise
 * @param {string} label  ข้อความตอนแดง (บอกว่ารอสัญญาณอะไร)
 * @param {number} [ms]
 */
export async function settleWithin(promise, label, ms = 2_000) {
  let guard = null;
  const timeout = new Promise((_, reject) => {
    guard = setTimeout(
      () => reject(new Error(`${label} (รอเกิน ${ms}ms — กันเทสค้างจน node:test ยกเลิกทั้งไฟล์)`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(guard);
  }
}

/**
 * deadline ที่เทสกดยิงเอง: createPipelineDeadline ตัวจริงของ production + นาฬิกาหยุดนิ่ง/timer มือ
 * (แบบเดียวกับ fakeClock ใน tests/pipeline-deadline-contract.test.mjs) → หมดเวลาเฉพาะตอนเทสเรียก expire()
 * ไม่พึ่ง timer จริงที่ unref หรือความเร็วเครื่อง CI · remainingMs() คงที่จนกว่าเทสจะ expire()
 * ใช้กับ runWithPipelineDeadline ตัวจริงได้ตรงๆ (withTimeoutSignal/preparePipelineSignal เห็นผ่าน AsyncLocalStorage เดียวกัน)
 * @param {number} remainingMs  เวลาที่เหลือของเส้นตาย (ms) ตามนาฬิกาหยุดนิ่ง
 * @returns {{ deadline: ReturnType<typeof createPipelineDeadline>, timers: Array<{at:number, callback:Function, cleared:boolean}>, expire(): void }}
 */
export function manualPipelineDeadline(remainingMs) {
  let now = 1_000_000;
  const timers = [];
  const deadline = createPipelineDeadline({
    deadlineAt: now + remainingMs,
    now: () => now,
    setTimer(callback, delay) {
      const timer = { at: now + delay, callback, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      if (timer) timer.cleared = true;
    },
  });
  return {
    deadline,
    timers,
    expire() {
      assert.equal(timers.length, 1, 'createPipelineDeadline ต้องตั้ง timer deadline หนึ่งตัว');
      assert.equal(timers[0].at, deadline.deadlineAt, 'timer deadline ต้องครบกำหนดตรง deadlineAt');
      assert.equal(timers[0].cleared, false, 'deadline ต้องยังไม่ถูก dispose ก่อนเทสยิง (งานที่ครอบต้องยังค้างอยู่)');
      now = deadline.deadlineAt;
      timers[0].callback();
    },
  };
}
