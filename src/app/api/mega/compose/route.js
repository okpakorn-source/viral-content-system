// ============================================================
// 🏭 POST /api/mega/compose — โรงประกอบปกของท่อ MEGA (แทน auto-cover-v3 · 8 ก.ค. 2026)
// ------------------------------------------------------------
// body: { newsTitle, slotPlan: [{url, slot, clean, faces, isHero, thumbnailUrl}], refDNA }
// deterministic: S6 ตัดสินมาแล้ว โรงนี้แค่ โหลด→หาหน้า→ครอปสูตร→วางตามโครง ref→คืน base64
// ผู้เรียก: cover-ref-test (ตรง) + queue worker (งาน composer:'mega' จาก MEGA S7)
// ============================================================

import { NextResponse } from 'next/server';
import { composeAndVerify } from '@/lib/services/megaComposerService';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    // ★ 10 ก.ค.: Wave1-A stableOrder default เปิด (race ลำดับโหลดภาพ) — ปิดคืน: MEGA_STABLE_ORDER=0
    const out = await composeAndVerify({
      newsTitle: body.newsTitle || '',
      slotPlan: Array.isArray(body.slotPlan) ? body.slotPlan : [],
      refDNA: body.refDNA || null,
      refImagePath: body.refImagePath || null, // 👁️ มี = ตาเทียบ ref จริงหลังประกอบ
      stableOrder: process.env.MEGA_STABLE_ORDER !== '0',
    });
    if (out.success && out.refSimilarity != null) out.score = `เหมือน ref ${out.refSimilarity}%`; // เข้ากับ s7_wait/คลังเดิม
    return NextResponse.json(out, { status: out.success ? 200 : 422 });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message || 'ประกอบปกล้มเหลว', errorType: 'UNEXPECTED' },
      { status: 500 }
    );
  }
}
