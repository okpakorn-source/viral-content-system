// ============================================================
// [ระบบทำปกออโต้] POST /api/keywords
// ------------------------------------------------------------
// รับ caseId → อ่าน pin provider/model ที่ล็อกไว้ตอน analyze คืนจากเคส (ห้าม resolve จาก env ซ้ำ) →
// เรียกสมอง AI ด้วย prompt กำกับ → ตรวจ identity ตรง pin เป๊ะ → parse JSON เป๊ะ → ตรวจสคีมา keywords.v1
// เต็มรูปแบบ → นับจำนวน → แนบกลับเข้าเคส (พร้อม provenance) → คืนผล
// ★ 15 ก.ค. (Batch 5B1 + correction): เส้นทาง strict pinned — ดู src/lib/s5PinnedAi.js สำหรับสัญญาเต็ม ·
//   สายนี้ต้องมี caseId เสมอ (s5_keywords ใน megaAdapters.js ส่ง caseId ทุกครั้งอยู่แล้ว) — โหมด "ส่ง analysis
//   ตรงไม่มีเคส" ของเดิมถูกถอดออก เพราะไม่มี pin ที่บันทึกไว้ให้อ่านคืนได้ (ขัดกับกติกา "ห้าม re-resolve จาก env")
// ============================================================

import { NextResponse } from 'next/server';
import {
  buildKeywordSystemPrompt,
  buildKeywordUserPrompt,
  KEYWORD_SCHEMA_VERSION,
} from '@/lib/keywordPrompt';
import { readStoredPin, runStrictPinned, validateKeywordsV1Structure, KEYWORD_LIST_KEYS } from '@/lib/s5PinnedAi';
import { getCase, updateCase } from '@/lib/caseStore';
import { reporter, doneProgress, failProgress } from '@/lib/progress';

export const runtime = 'nodejs';
export const maxDuration = 300; // ★ 15 ก.ค.: ไม่ตั้ง = default โฮสต์ตัดสั้น — ผู้เรียก (s5_keywords ใน megaAdapters) รอ 240s + wrapper deadline 120s เอง จึงให้ 300 เท่า /api/analyze

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
    const caseId = (body.caseId || '').trim();

    if (!caseId) {
      return NextResponse.json(
        { success: false, error: 'ต้องระบุ caseId (สายนี้อ่าน pin จากเคสที่บันทึกไว้เท่านั้น)', errorType: 'CASE_ID_REQUIRED' },
        { status: 400 }
      );
    }

    const existingCase = await getCase(caseId);
    if (!existingCase) {
      return NextResponse.json(
        { success: false, error: 'ไม่พบเคส ' + caseId + ' ในคลัง', errorType: 'CASE_NOT_FOUND' },
        { status: 404 }
      );
    }

    const analysis = existingCase.analysis;
    const newsText = existingCase.newsText || '';

    if (!analysis || typeof analysis !== 'object') {
      return NextResponse.json(
        { success: false, error: 'เคสนี้ไม่มีผลวิเคราะห์', errorType: 'NO_ANALYSIS' },
        { status: 400 }
      );
    }

    // ★ Batch 5B1: pin ต้องอ่านจาก meta ที่บันทึกไว้ตอน analyze เท่านั้น — ห้าม resolve จาก env ซ้ำ (กัน
    //   provider/model เพี้ยนระหว่างขั้น analyze→keywords) · หาย/ผิดรูปแบบ = fail-closed ทันที
    const pin = readStoredPin(existingCase.meta);
    if (!pin) {
      return NextResponse.json(
        { success: false, error: 'เคสนี้ไม่มี pin โมเดลที่บันทึกไว้ถูกต้อง (ต้อง analyze ผ่านสาย strict ก่อน)', errorType: 'PIN_MISSING' },
        { status: 502 }
      );
    }

    const system = buildKeywordSystemPrompt();
    const user = buildKeywordUserPrompt(analysis, newsText);

    P('สกัดคีย์เวิร์ด', 'เรียกสมอง AI สกัดคำค้นหาภาพ', { pct: 40 });
    let result;
    try {
      result = await runStrictPinned({
        system,
        user,
        maxTokens: 3500,
        temperature: 0.4,
        pin,
        cost: { step: 'สกัดคีย์เวิร์ด', caseId },
        onRetry: P.onRetry,
        validate: validateKeywordsV1Structure,
      });
    } catch (err) {
      failProgress(jobId, err.message);
      // ★ correction item 3 (round 2): คำนวณ errorType "ครั้งเดียว" แล้วใช้ตัวแปรเดียวกันทั้ง top-level และ
      //   meta.errorType — การันตีตรงกันเป๊ะโดยโครงสร้าง (ไม่ใช่ fallback คนละที่ที่บังเอิญเหมือนกัน)
      const errorType = err.errorType || 'PROVIDER_ERROR';
      const status = STATUS_BY_ERROR_TYPE[errorType] || 502;
      // ★ correction item 2: แนบ terminal provenance (safe meta) เสมอ · ★ ห้ามคืน raw model output ใดๆ
      //   บนทาง error (ไม่มี field `raw`)
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
            schema: KEYWORD_SCHEMA_VERSION,
            schemaVersion: KEYWORD_SCHEMA_VERSION,
            attemptCount: prov.attemptCount ?? 0,
            repairCount: prov.repairCount ?? 0,
            errorType, // ★ correction item 3: ต้องตรงกับ top-level errorType เป๊ะ — ใช้ตัวแปรเดียวกัน
          },
        },
        { status }
      );
    }

    const keywords = result.value;
    // เติม total_count (post-processing เดิม — ไม่ใช่ส่วนของสัญญา JSON ที่ตรวจสคีมาแล้วข้างต้น)
    const total = countKeywords(keywords);
    keywords.total_count = total;

    // ★ correction item 3: คืนฟิลด์เดิม provider/model/schema/usage/total แบบไม่แตะ + เพิ่ม requested*/
    //   actual*/attemptCount/repairCount/schemaVersion เข้าไปแบบ additive ล้วน
    const meta = {
      provider: pin.provider,
      model: pin.model,
      schema: KEYWORD_SCHEMA_VERSION,
      usage: result.provenance.usage,
      total,
      requestedProvider: pin.provider,
      requestedModel: pin.model,
      actualProvider: result.provenance.actualProvider,
      actualModel: result.provenance.actualModel,
      actualModelVersion: result.provenance.actualModelVersion,
      schemaVersion: KEYWORD_SCHEMA_VERSION,
      attemptCount: result.provenance.attemptCount,
      repairCount: result.provenance.repairCount,
    };

    // ★ correction (round 3, finding 4): ห้ามกลืน error แล้วคืน success ปลอม — เขียนเคสไม่ได้ = fixed
    //   500 STORE_WRITE_FAILED เท่านั้น: ห้าม err.message (storage error ดิบ) และห้าม echo keywords/meta
    //   กลับบน failure path เลย (ไม่มี partial follow-on admission ใดๆ)
    try {
      await updateCase(caseId, { keywords, keywordsMeta: meta });
    } catch {
      return NextResponse.json(
        { success: false, error: 'บันทึกคำค้นเข้าเคสไม่สำเร็จ', errorType: 'STORE_WRITE_FAILED' },
        { status: 500 }
      );
    }

    doneProgress(jobId, { step: 'เสร็จ', detail: `สกัดได้ ${total} คำค้น` });
    return NextResponse.json({ success: true, caseId, keywords, meta });
  } catch (err) {
    failProgress(jobId, err.message);
    return NextResponse.json(
      { success: false, error: err.message || 'เกิดข้อผิดพลาดไม่คาดคิด', errorType: 'UNEXPECTED' },
      { status: 500 }
    );
  }
}

function countKeywords(k) {
  let n = 0;
  for (const key of KEYWORD_LIST_KEYS) n += k[key].length;
  return n;
}
