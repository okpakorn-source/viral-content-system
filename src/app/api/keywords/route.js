// ============================================================
// [ระบบทำปกออโต้] POST /api/keywords
// ------------------------------------------------------------
// รับ caseId (หรือ analysis+newsText ตรงๆ) → สกัดคำค้นหาภาพ
// ด้วย prompt กำกับ → parse → นับจำนวน → แนบกลับเข้าเคส → คืนผล
// ============================================================

import { NextResponse } from 'next/server';
import {
  buildKeywordSystemPrompt,
  buildKeywordUserPrompt,
  KEYWORD_SCHEMA_VERSION,
} from '@/lib/keywordPrompt';
import { callBrain } from '@/lib/aiClient';
import { getCase, updateCase } from '@/lib/caseStore';
import { reporter, doneProgress, failProgress } from '@/lib/progress';

export const runtime = 'nodejs';
export const maxDuration = 300; // ★ 15 ก.ค.: ไม่ตั้ง = default โฮสต์ตัดสั้น — ผู้เรียก (s5_keywords ใน megaAdapters) รอ 240s + aiClient ลองได้ถึง 5 ครั้ง (รวมครั้งแรก) จึงให้ 300 เท่า /api/analyze (Codex audit: 120 เสี่ยงตัดกลาง retry)

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const jobId = body.jobId || null;
  const P = reporter(jobId);
  try {
    const caseId = (body.caseId || '').trim();

    // แหล่งข้อมูล: จากเคสในคลัง หรือส่ง analysis มาตรงๆ
    let analysis = body.analysis || null;
    let newsText = body.newsText || '';
    let existingCase = null;

    if (caseId) {
      existingCase = await getCase(caseId);
      if (!existingCase) {
        return NextResponse.json(
          { success: false, error: 'ไม่พบเคส ' + caseId + ' ในคลัง', errorType: 'CASE_NOT_FOUND' },
          { status: 404 }
        );
      }
      analysis = existingCase.analysis;
      newsText = existingCase.newsText || '';
    }

    if (!analysis || typeof analysis !== 'object') {
      return NextResponse.json(
        {
          success: false,
          error: 'ต้องมีผลวิเคราะห์ก่อน (ส่ง caseId หรือ analysis)',
          errorType: 'NO_ANALYSIS',
        },
        { status: 400 }
      );
    }

    const system = buildKeywordSystemPrompt();
    const user = buildKeywordUserPrompt(analysis, newsText);

    P('สกัดคีย์เวิร์ด', 'เรียกสมอง AI สกัดคำค้นหาภาพ', { pct: 40 });
    let brain;
    try {
      brain = await callBrain({ system, user, maxTokens: 3500, temperature: 0.4, onRetry: P.onRetry, cost: { step: 'สกัดคีย์เวิร์ด', caseId } });
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

    const keywords = safeParseJson(brain.text);
    if (!keywords) {
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

    // เติมหมวดที่ขาดให้เป็น [] และนับจำนวนคำค้นทั้งหมด
    normalizeKeywords(keywords);
    const total = countKeywords(keywords);
    keywords.total_count = total;

    const meta = {
      provider: brain.provider,
      model: brain.model,
      schema: KEYWORD_SCHEMA_VERSION,
      usage: brain.usage,
      total,
    };

    // แนบกลับเข้าเคส (ถ้ามาจากคลัง)
    if (existingCase) {
      try {
        await updateCase(caseId, { keywords, keywordsMeta: meta });
      } catch {
        /* บันทึกไม่ได้ก็ยังคืนผลให้ผู้ใช้ ไม่ให้ล้ม */
      }
    }

    doneProgress(jobId, { step: 'เสร็จ', detail: `สกัดได้ ${total} คำค้น` });
    return NextResponse.json({ success: true, caseId: caseId || null, keywords, meta });
  } catch (err) {
    failProgress(jobId, err.message);
    return NextResponse.json(
      { success: false, error: err.message || 'เกิดข้อผิดพลาดไม่คาดคิด', errorType: 'UNEXPECTED' },
      { status: 500 }
    );
  }
}

const LIST_KEYS = [
  'queries_th',
  'queries_en',
  'object_queries',
  'scene_place',
  'moment_action',
  'emotion',
  'source_show',
  'hashtags',
  // ★ 9 ก.ค. เฟส 4a — หมวดภาพเชิงเรื่องราว (normalize + นับให้ครบ; consumer เดิมอ่านหมวดเดิมได้ไม่พัง)
  'relationship_archive',
  'lifestyle_travel',
  'family_album',
  'landmark_context',
];

function normalizeKeywords(k) {
  if (!Array.isArray(k.subjects)) k.subjects = [];
  for (const key of LIST_KEYS) {
    if (!Array.isArray(k[key])) k[key] = [];
    // ตัดค่าว่าง/ซ้ำ
    k[key] = [...new Set(k[key].map((s) => String(s).trim()).filter(Boolean))];
  }
}

function countKeywords(k) {
  let n = 0;
  for (const key of LIST_KEYS) n += k[key].length;
  return n;
}

function safeParseJson(text) {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
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
