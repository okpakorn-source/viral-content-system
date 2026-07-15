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
    const payload = {
      newsTitle: body.newsTitle || '',
      slotPlan: Array.isArray(body.slotPlan) ? body.slotPlan : [],
      refDNA: body.refDNA || null,
      refImagePath: body.refImagePath || null, // 👁️ มี = ตาเทียบ ref จริงหลังประกอบ
      stableOrder: process.env.MEGA_STABLE_ORDER !== '0',
    };
    // ★ Checkpoint B (11 ก.ค. — Codex strict consumer): route แค่ "ส่งผ่าน" selectionSpec/realizedTemplate
    //   แบบรักษา own-property (มี key = ส่งต่อ แม้ค่า null/undefined — ให้ consumer fail-close เอง)
    //   ห้ามสร้าง/เดา/เติม payload เองที่นี่ — producer จริง (megaAdapters S6/S7 + queue worker) ต่อแล้ว
    //   ใต้ latch MEGA_STRICT_RENDER (default OFF) · route คงเป็นแค่ passthrough เท่าเดิม
    if (body && typeof body === 'object') {
      if (Object.prototype.hasOwnProperty.call(body, 'selectionSpec')) payload.selectionSpec = body.selectionSpec;
      if (Object.prototype.hasOwnProperty.call(body, 'realizedTemplate')) payload.realizedTemplate = body.realizedTemplate;
      // ★ Wave1A (LANE C — P0-1): ส่งผ่าน carrier V2 (refHeroV2) แบบ own-property "additive" เหมือน selectionSpec —
      //   ไม่มี env alias ที่ route · canonical latch = MEGA_STRICT_RENDER อยู่ที่ consumer เท่านั้น
      //   consumer เป็นผู้ตัดสิน/HOLD เอง (latch OFF + carrier = HOLD, ไม่ downgrade) · ห้ามสร้าง/เดา payload
      if (Object.prototype.hasOwnProperty.call(body, 'refHeroV2')) payload.refHeroV2 = body.refHeroV2;
    }
    const out = await composeAndVerify(payload);
    if (out.success && out.refSimilarity != null) out.score = `เหมือน ref ${out.refSimilarity}%`; // เข้ากับ s7_wait/คลังเดิม
    return NextResponse.json(out, { status: out.success ? 200 : 422 });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message || 'ประกอบปกล้มเหลว', errorType: 'UNEXPECTED' },
      { status: 500 }
    );
  }
}
