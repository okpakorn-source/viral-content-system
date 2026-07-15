// ============================================================
// [ระบบทำปกออโต้] POST /api/analyze
// ------------------------------------------------------------
// รับเนื้อข่าวเต็ม → ล็อก pin provider/model → เรียกสมอง AI ด้วย prompt กำกับ (ตายตัว)
// → ตรวจ identity ที่ provider ตอบกลับจริงตรง pin เป๊ะ → parse JSON เป๊ะ (ห้าม coerce) →
// ตรวจสคีมา analysis.v1 เต็มรูปแบบ → บันทึกเข้าคลังผลลัพธ์ (พร้อม provenance) → คืนผล
// ★ 15 ก.ค. (Batch 5B1 + correction): เส้นทาง strict pinned — ดู src/lib/s5PinnedAi.js สำหรับสัญญาเต็ม
// ============================================================

import { NextResponse } from 'next/server';
import {
  buildAnalysisSystemPrompt,
  buildAnalysisUserPrompt,
  ANALYSIS_SCHEMA_VERSION,
} from '@/lib/analysisPrompt';
import { resolvePin, runStrictPinned, validateAnalysisV1Structure } from '@/lib/s5PinnedAi';
import { addCase } from '@/lib/caseStore';
import { reporter, doneProgress, failProgress } from '@/lib/progress';

export const runtime = 'nodejs';
export const maxDuration = 300; // ★ 15 ก.ค.: ไม่ตั้ง = default โฮสต์ตัดสั้น — ผู้เรียก (s5_case ใน megaAdapters) รอถึง 240s จึงให้ 300

// ★ Batch 5B1: 502 = mismatch/identity/schema/pin-invalid terminal (ปฏิเสธเนื้อหา) · 504 = deadline/attempt
//   timeout · 400 = ปัญหาคีย์/config ก่อนยิงจริง (แนวเดียวกับพฤติกรรมเดิม) · ที่เหลือ (AI_BUSY/PROVIDER_ERROR) = 502 เดิม
const STATUS_BY_ERROR_TYPE = {
  NO_API_KEY: 400,
  INVALID_FORCED_PIN: 400,
  INVALID_RESOLVED_MODEL: 400,
  PIN_INVALID: 502,
  MODEL_IDENTITY_MISSING: 502,
  MODEL_PIN_MISMATCH: 502,
  JSON_PARSE_FAILED: 502,
  SCHEMA_VALIDATION_FAILED: 502,
  DEADLINE_EXCEEDED: 504,
  ATTEMPT_TIMEOUT: 504,
  GENERATION_FAILED: 502,
};

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const jobId = body.jobId || null;
  const P = reporter(jobId);
  try {
    const newsText = (body.newsText || '').trim();

    if (!newsText || newsText.length < 40) {
      return NextResponse.json(
        {
          success: false,
          error: 'กรุณาใส่เนื้อข่าวเต็ม (อย่างน้อย 40 ตัวอักษร)',
          errorType: 'NEWS_TOO_SHORT',
        },
        { status: 400 }
      );
    }

    // ★ Batch 5B1: pin ครั้งเดียวตรงนี้ (immutable ตลอดสาย generation+repair) — เก็บลง meta ด้านล่างเพื่อให้
    //   /api/keywords อ่านคืนได้ (ห้าม re-resolve จาก env)
    let pin;
    try {
      pin = resolvePin();
    } catch (err) {
      failProgress(jobId, err.message);
      return NextResponse.json(
        { success: false, error: err.message, errorType: err.errorType || 'NO_API_KEY' },
        { status: STATUS_BY_ERROR_TYPE[err.errorType] || 400 }
      );
    }

    const system = buildAnalysisSystemPrompt();
    const user = buildAnalysisUserPrompt(newsText);

    P('วิเคราะห์ข่าว', 'เรียกสมอง AI อ่าน+ถอดตัวละคร/เนื้อ/บริบท', { pct: 30 });
    let result;
    try {
      result = await runStrictPinned({
        system,
        user,
        maxTokens: 4000,
        temperature: 0.2,
        pin,
        cost: { step: 'วิเคราะห์ข่าว' },
        onRetry: P.onRetry,
        validate: validateAnalysisV1Structure,
      });
    } catch (err) {
      failProgress(jobId, err.message);
      // ★ correction item 3 (round 2): คำนวณ errorType "ครั้งเดียว" แล้วใช้ตัวแปรเดียวกันทั้ง top-level และ
      //   meta.errorType — การันตีตรงกันเป๊ะโดยโครงสร้าง ไม่ใช่ fallback คนละที่ที่บังเอิญเหมือนกัน · s5PinnedAi.js
      //   normalize err.errorType ให้ไม่ null เสมอแล้ว (attachEvidence) แต่ยังเผื่อ fallback ไว้ที่นี่ด้วยความ
      //   ระมัดระวัง (defense-in-depth เผื่อ error หลุดมาจากที่อื่นก่อนถึงสาย strict)
      const errorType = err.errorType || 'PROVIDER_ERROR';
      const status = STATUS_BY_ERROR_TYPE[errorType] || 502;
      // ★ correction item 2: แนบ terminal provenance (safe meta) เสมอ — ★ ห้ามคืน raw model output ใดๆ
      //   บนทาง error (ไม่มี field `raw`) · err.provenance มาจาก s5PinnedAi.js เสมอ ยกเว้นความล้มก่อนสาย
      //   strict เริ่ม (ไม่เกิดในบล็อกนี้ เพราะ pin ผ่านมาแล้ว) จึงมี fallback ปลอดภัยไว้เผื่อ
      const prov = err.provenance || {};
      return NextResponse.json(
        {
          success: false,
          error: err.message || 'เรียกสมอง AI ไม่สำเร็จ',
          errorType,
          meta: {
            requestedProvider: prov.requestedProvider ?? pin.provider ?? null,
            requestedModel: prov.requestedModel ?? pin.model ?? null,
            actualProvider: prov.actualProvider ?? null,
            actualModel: prov.actualModel ?? null,
            actualModelVersion: prov.actualModelVersion ?? null,
            schema: ANALYSIS_SCHEMA_VERSION,
            schemaVersion: ANALYSIS_SCHEMA_VERSION,
            attemptCount: prov.attemptCount ?? 0,
            repairCount: prov.repairCount ?? 0,
            errorType, // ★ correction item 3: ต้องตรงกับ top-level errorType เป๊ะ — ใช้ตัวแปรเดียวกัน
          },
        },
        { status }
      );
    }

    const analysis = result.value;
    // ★ correction item 3: คืนฟิลด์เดิม provider/model/schema/usage แบบไม่แตะ (WorkflowTracker meta.model
    //   parity) + เพิ่ม requested*/actual*/attemptCount/repairCount/schemaVersion เข้าไปแบบ additive ล้วน
    const meta = {
      provider: pin.provider,
      model: pin.model,
      schema: ANALYSIS_SCHEMA_VERSION,
      usage: result.provenance.usage,
      requestedProvider: pin.provider,
      requestedModel: pin.model,
      actualProvider: result.provenance.actualProvider,
      actualModel: result.provenance.actualModel,
      actualModelVersion: result.provenance.actualModelVersion,
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      attemptCount: result.provenance.attemptCount,
      repairCount: result.provenance.repairCount,
    };

    let saved;
    try {
      saved = await addCase({ newsText, analysis, meta });
    } catch {
      // ★ correction (round 3, finding 4): ตอบ fixed message เดียวเท่านั้น — ห้าม err.message (storage error
      //   ดิบอาจมีรายละเอียดภายใน) และห้าม echo analysis/meta กลับบน failure path (ไม่มี partial admission)
      return NextResponse.json(
        { success: false, error: 'บันทึกเข้าคลังไม่สำเร็จ', errorType: 'STORE_WRITE_FAILED' },
        { status: 500 }
      );
    }

    doneProgress(jobId, { step: 'เสร็จ', detail: 'วิเคราะห์เสร็จ บันทึกเข้าคลัง ' + saved.id });
    return NextResponse.json({
      success: true,
      id: saved.id,
      createdAt: saved.createdAt,
      analysis,
      meta,
    });
  } catch (err) {
    failProgress(jobId, err.message);
    return NextResponse.json(
      {
        success: false,
        error: err.message || 'เกิดข้อผิดพลาดไม่คาดคิด',
        errorType: 'UNEXPECTED',
      },
      { status: 500 }
    );
  }
}
