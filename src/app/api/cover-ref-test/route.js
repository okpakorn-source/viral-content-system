// ============================================================
// 🎯 POST /api/cover-ref-test — เทสปก "ผ่านท่อ MEGA จริงทุกขั้น" (STRICT INGRESS ADAPTER)
// ------------------------------------------------------------
// R2 (move+delegate): ตรรกะท่อทั้งหมด (runCoverRefTest / runS7CaptureOnly + strict seam + compose + QC + archive)
//   ย้ายไปอยู่ที่ src/lib/refTestPipeline.js เพื่อ "แชร์ชุดเดียวกัน" กับโหมดคิว (rt_* stage ที่ /api/mega/tick เดิน).
//   ไฟล์นี้เหลือเฉพาะ: (ก) operator capture claim gate (one-shot TOCTOU-safe) · (ข) handler ที่แตกสาย
//   granted→capture / mode:'queue'→enqueue / อื่น→sync ordinary run · (ค) thin POST wrapper.
//   sync mode = delegate ตรงไปยัง lib runner → พฤติกรรม/ทุก field เดิมเป๊ะ (ผู้พิทักษ์: ac0099 + ac0084).
//
// กติกา strict / preview_advisory / capture-only ทั้งหมดอยู่ที่ refTestPipeline.js (ดูหัวไฟล์นั้น).
// ============================================================

import { NextResponse } from 'next/server';
import { newJob, updateJob } from '@/lib/megaJobStore';
import { runCoverRefTest, runS7CaptureOnly, enqueueRefTest, _CAPTURE_HOST } from '@/lib/refTestPipeline';

export const runtime = 'nodejs';
export const maxDuration = 800; // ★ 15 ก.ค.: 1800 เกินเพดานโฮสต์ (โดนตัดเงียบกลางทาง) → 800 เท่าท่อหนักตัวอื่น (/api/auto/process, /api/queue/worker) · รันจริง 8-11 นาที (~660s) ยังมี buffer

// ── re-export ให้ผู้พิทักษ์/ผู้เรียกเดิม import จาก route path นี้ได้ (ac0099/ac0084/batch2/batch4) ──
export { runCoverRefTest, runS7CaptureOnly };

// ── R1.5C AC0084 capture seam — narrow, additive, ONE-SHOT via a pure claim-gate factory. ห้ามเปิด default:
//   ต้อง exact host 127.0.0.2:3900 (origin string เดียวกับ convention whitelist ในไฟล์นี้) AND exact env latch
//   MEGA_AC0084_CAPTURE_ONESHOT==='1' พร้อมกัน — ไม่มีทาง fallback/truthy coercion ใดๆ. Gate mismatch = พฤติกรรม
//   เดิมเป๊ะ ไม่มี field/log/read/write ใหม่ และไม่ consume. Claim ต้อง synchronous ก่อน await แรกของ handler
//   (ก่อน req.json()) — production ใช้ module singleton หนึ่งตัว, เทสสร้าง gate สดเองผ่าน factory (ไม่ปน state ข้ามเทส).
//   matched+granted=false (ถูก consume ไปแล้ว) = 409 typed ก่อนอ่าน body/เรียก runner ใดๆ.
export function _createCaptureClaimGate() {
  let consumed = false; // private closure state — ไม่ expose ออกนอก gate
  return {
    claim(origin, env) {
      try {
        const matched = origin === _CAPTURE_HOST && env?.MEGA_AC0084_CAPTURE_ONESHOT === '1';
        if (!matched) return { matched: false, granted: false };
        if (consumed) return { matched: true, granted: false };
        consumed = true; // atomic — synchronous, ไม่มี await คั่นระหว่างเช็คกับ set นี้
        return { matched: true, granted: true };
      } catch { return { matched: false, granted: false }; }
    },
  };
}
const _productionCaptureGate = _createCaptureClaimGate(); // module singleton — production เท่านั้น

// ── R1.5C: POST-delegating handler — testable without a real NextRequest (req only needs .nextUrl.origin + .json()).
//   Origin + latch snapshot and the atomic claim happen SYNCHRONOUSLY as the very first statements, before ANY
//   await (including req.json()) — this is what makes the claim TOCTOU-safe even under Promise.all concurrency:
//   two calls each run their pre-first-await portion to completion before either suspends, so the gate's closure
//   state can never be read-then-written by two callers interleaved.
export async function handleCoverRefTestPost({
  req,
  runner = runCoverRefTest,
  captureRunner = runS7CaptureOnly,
  env = process.env,
  claimGate = _productionCaptureGate,
  enqueue = (body) => enqueueRefTest(body, { newJob, updateJob }),
  jsonResponder = (body, init) => NextResponse.json(body, init),
} = {}) {
  const origin = req?.nextUrl?.origin ?? '';
  const claimResult = claimGate.claim(origin, env); // synchronous, zero awaits above this line
  if (claimResult.matched && !claimResult.granted) {
    // already consumed by an earlier matching request in this process — typed 409 before body read / runner
    return jsonResponder({ success: false, error: 'operator capture already used in this process', errorType: 'OPERATOR_CAPTURE_ALREADY_USED' }, { status: 409 });
  }
  const trace = [];
  try {
    const body = await req.json().catch(() => ({}));
    // R1.6: TRUE fail-closed branch — granted ⇒ ONLY the capture-only replay path runs, NEVER the ordinary
    //   full runner (no fallback either way). Mismatch ⇒ the ordinary runner runs exactly as before, with
    //   no capture-only fields/args and no behavior drift (deps = {}, same as pre-capture-seam behavior).
    if (claimResult.granted) {
      const { status, body: out } = await captureRunner(body, { env });
      return jsonResponder(out, { status });
    }
    // ── โหมดคิว: ต่อคิวงาน (ผู้ใช้ปิดบราวเซอร์ได้ · tick เดินเอง) — validate ต่อรายการ, ตอบทันทีไม่รอท่อ ──
    if (body && body.mode === 'queue') {
      const { status, body: out } = await enqueue(body);
      return jsonResponder(out, { status });
    }
    const { status, body: out } = await runner({
      content: body.content,
      newsTitle: body.newsTitle,
      forceTemplateId: body.forceTemplateId,
      origin,
    }, {});
    return jsonResponder(out, { status });
  } catch (err) {
    return jsonResponder({ success: false, error: err.message || 'ผิดพลาดไม่คาดคิด', errorType: 'UNEXPECTED', trace }, { status: 500 });
  }
}

// ── thin POST wrapper — real production wiring delegates straight to the handler above ──
export async function POST(req) {
  return handleCoverRefTestPost({ req });
}
