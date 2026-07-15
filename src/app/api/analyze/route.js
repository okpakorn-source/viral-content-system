// ============================================================
// [ระบบทำปกออโต้] POST /api/analyze
// ------------------------------------------------------------
// รับเนื้อข่าวเต็ม → เรียกสมอง AI ด้วย prompt กำกับ (ตายตัว)
// → parse JSON → validate → บันทึกเข้าคลังผลลัพธ์ → คืนผล
// ============================================================

import { NextResponse } from 'next/server';
import {
  buildAnalysisSystemPrompt,
  buildAnalysisUserPrompt,
  ANALYSIS_SCHEMA_VERSION,
} from '@/lib/analysisPrompt';
import { callBrain } from '@/lib/aiClient';
import { addCase } from '@/lib/caseStore';
import { reporter, doneProgress, failProgress } from '@/lib/progress';

export const runtime = 'nodejs';
export const maxDuration = 300; // ★ 15 ก.ค.: ไม่ตั้ง = default โฮสต์ตัดสั้น — ผู้เรียก (s5_case ใน megaAdapters) รอถึง 240s จึงให้ 300

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

    const system = buildAnalysisSystemPrompt();
    const user = buildAnalysisUserPrompt(newsText);

    P('วิเคราะห์ข่าว', 'เรียกสมอง AI อ่าน+ถอดตัวละคร/เนื้อ/บริบท', { pct: 30 });
    let brain;
    try {
      brain = await callBrain({ system, user, maxTokens: 4000, temperature: 0.2, onRetry: P.onRetry, cost: { step: 'วิเคราะห์ข่าว' } });
    } catch (err) {
      failProgress(jobId, err.message);
      const status = err.errorType === 'NO_API_KEY' ? 400 : 502;
      return NextResponse.json(
        {
          success: false,
          error: err.message || 'เรียกสมอง AI ไม่สำเร็จ',
          errorType: err.errorType || 'PROVIDER_ERROR',
        },
        { status }
      );
    }

    const analysis = safeParseJson(brain.text);
    if (!analysis) {
      return NextResponse.json(
        {
          success: false,
          error: 'สมอง AI ตอบกลับไม่เป็น JSON ที่อ่านได้',
          errorType: 'BAD_AI_JSON',
          raw: brain.text?.slice(0, 800),
        },
        { status: 502 }
      );
    }

    const shape = validateShape(analysis);
    if (!shape.ok) {
      return NextResponse.json(
        {
          success: false,
          error: 'ผลวิเคราะห์ไม่ครบตามสคีมา: ' + shape.missing.join(', '),
          errorType: 'SCHEMA_INCOMPLETE',
          raw: analysis,
        },
        { status: 502 }
      );
    }

    const meta = {
      provider: brain.provider,
      model: brain.model,
      schema: ANALYSIS_SCHEMA_VERSION,
      usage: brain.usage,
    };

    let saved;
    try {
      saved = await addCase({ newsText, analysis, meta });
    } catch (err) {
      return NextResponse.json(
        {
          success: false,
          error: 'บันทึกเข้าคลังไม่สำเร็จ: ' + (err.message || ''),
          errorType: 'STORE_WRITE_FAILED',
          analysis,
          meta,
        },
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

// ---- ดึง JSON ออกจากคำตอบ AI อย่างทนทาน (เผื่อมี code fence/ข้อความปน) ----
function safeParseJson(text) {
  if (!text) return null;
  let t = text.trim();

  // ตัด code fence ```json ... ```
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();

  try {
    return JSON.parse(t);
  } catch {
    // fallback: คว้าบล็อก { ... } ก้อนแรกที่สมดุล
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ---- ตรวจว่าโครงผลลัพธ์ครบ key หลักที่บังคับ ----
function validateShape(a) {
  const missing = [];
  if (typeof a.headline !== 'string') missing.push('headline');
  if (typeof a.summary !== 'string') missing.push('summary');
  if (!Array.isArray(a.characters)) missing.push('characters');
  if (!a.content || typeof a.content !== 'object') missing.push('content');
  if (!a.context || typeof a.context !== 'object') missing.push('context');
  if (!Array.isArray(a.missing_info)) missing.push('missing_info');
  return { ok: missing.length === 0, missing };
}
