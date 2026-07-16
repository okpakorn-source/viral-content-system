/**
 * ============================================================
 * 🧬 POST /api/desk/dna/analyze — วิเคราะห์ DNA จากโพสต์ต้นแบบ (โต๊ะข่าวกลาง v2, เฟส 1 — 16 ก.ค. 69)
 * ============================================================
 * รับโพสต์ (1-10) → กันจ่ายเงินซ้ำด้วย postKey/titleHash เทียบกับคลัง STORE_EXEMPLARS ก่อนเสมอ →
 * เฉพาะโพสต์ที่ยังไม่เคยวิจัยส่งเข้า dnaResearch.researchBatch (gpt-5.5/gpt-5.4-mini ผ่าน modelConfig) →
 * คืนผลดิบให้ผู้เรียก — endpoint นี้ "ไม่" เขียนลงคลังเอง (หน้าที่ save เป็นของ endpoint อื่นในเฟสถัดไป)
 */
import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';
import { STORE_EXEMPLARS, buildPostKey, buildTitleHash } from '@/lib/services/deskV2/dnaContract.js';
import { researchBatch } from '@/lib/services/deskV2/dnaResearch.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request) {
  const t0 = Date.now();
  try {
    const body = await request.json().catch(() => null);
    const posts = body?.posts;
    if (!Array.isArray(posts) || posts.length < 1 || posts.length > 10) {
      return NextResponse.json({
        success: false,
        error: 'posts ต้องเป็น array ความยาว 1-10',
        errorType: 'VALIDATION_ERROR',
      }, { status: 400 });
    }

    const modelKey = body?.model === 'fast' ? 'fast' : 'primary'; // 🔴 รับแค่ 2 ค่านี้เท่านั้น กันชื่อโมเดลดิบ
    const runId = String(body?.runId || '').slice(0, 40);
    const sourceFile = String(body?.fileName || '').slice(0, 120);

    // 🔴 กันจ่ายเงินซ้ำ: โหลดคลังครั้งเดียว แล้วเทียบ postKey/titleHash ทุกใบก่อนส่งเข้า AI
    const exemplars = await createStore(STORE_EXEMPLARS).getAll();
    const existingKeys = new Set(exemplars.map((e) => e?.postKey).filter(Boolean));
    const existingTitleHashes = new Set(exemplars.map((e) => e?.titleHash).filter(Boolean));

    const existing = [];
    const toAnalyze = [];
    for (const p of posts) {
      const postKey = buildPostKey(p);
      const titleHash = buildTitleHash(p?.title);
      if (existingKeys.has(postKey) || existingTitleHashes.has(titleHash)) {
        existing.push({ postKey, existing: true, title: p?.title || '' });
      } else {
        toAnalyze.push(p);
      }
    }

    let results = [];
    let failed = [];
    let model = null;
    if (toAnalyze.length > 0) {
      const out = await researchBatch({ posts: toAnalyze, modelKey, runId, sourceFile });
      results = out.results;
      failed = out.failed;
      model = out.model;
    }

    return NextResponse.json({
      success: true,
      results,
      existing,
      failed,
      model,
      tookMs: Date.now() - t0,
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err?.message || 'วิเคราะห์ DNA ล้มเหลว',
      errorType: 'DNA_ANALYZE_ERROR',
    }, { status: 500 });
  }
}
