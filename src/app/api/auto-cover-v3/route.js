import { NextResponse } from 'next/server';

/**
 * =====================================================
 * Auto Cover v3 — Vision Director Edition
 * =====================================================
 * สถาปัตยกรรม (11 มิ.ย. — ออกแบบร่วมกับผู้ใช้):
 *   ① สมองเดิมหาภาพ+คัด (storyIdentity → multiAgent scrape → judge)
 *   ② AI Vision เป็น "ผู้กำกับ" — เห็นภาพจริง → สั่งเป็นตัวเลข (ช่อง+กรอบครอป)
 *   ③ ตัวประกอบพิกเซลแท้ทำตามเป๊ะ (extract/resize เท่านั้น — รูปต้นฉบับ 100%)
 *   ④ AI ตรวจงานตัวเอง 1 รอบ → แก้กรอบ → ประกอบใหม่
 * ไม่มีสูตรครอป ไม่มี face-detection math ไม่มี fade — แยกจาก v1 ทั้งเส้น เทียบ A/B ได้
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export async function POST(request) {
  const t0 = Date.now();
  let markQueueJob = async () => {};

  try {
    const body = await request.json();
    const { content, newsTitle = '', sourceUrl = '', _queueJobId = null } = body;

    if (!content && !newsTitle) {
      return NextResponse.json(
        { success: false, error: 'ต้องระบุ content หรือ newsTitle', errorType: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    markQueueJob = async (status, extra = {}) => {
      if (!_queueJobId) return;
      try {
        const { updateJobStatus } = await import('@/lib/services/queueService');
        await updateJobStatus(_queueJobId, status, { ...extra, completedAt: new Date().toISOString() });
      } catch (e) { console.log('[CoverV3] markQueueJob failed:', e.message); }
    };

    // ── ① Identity + Scrape + Judge (สมองเดิม — พิสูจน์แล้ว) ──
    console.log('[CoverV3] ① Story identity...');
    const { analyzeStoryIdentity } = await import('@/lib/services/storyIdentityService');
    const identity = await analyzeStoryIdentity(
      newsTitle || (content || '').slice(0, 100),
      { core_story: content || newsTitle }
    );
    if (!identity) {
      await markQueueJob('failed', { error: 'วิเคราะห์เนื้อข่าวไม่สำเร็จ' });
      return NextResponse.json({ success: false, error: 'วิเคราะห์เนื้อข่าวไม่สำเร็จ', errorType: 'IDENTITY_FAILED' }, { status: 422 });
    }
    console.log(`[CoverV3] identity: ${identity.mainCharacter} | ${identity.storyType}`);

    console.log('[CoverV3] ② Multi-agent search + judge...');
    const { runMultiAgentImageSearch } = await import('@/lib/services/multiAgentImageScraper');
    const selected = await runMultiAgentImageSearch(
      sourceUrl || '', sourceUrl ? 'url' : 'text',
      identity.characters || [],
      newsTitle || (content || '').slice(0, 100),
      identity
    );

    // ดาวน์โหลดภาพเป็น buffer (เฉพาะตัวท็อปที่ judge คัดแล้ว)
    const candidates = (selected || []).filter(img => img?.url).slice(0, 10);
    const imageBuffers = [];
    await Promise.all(candidates.map(async (img) => {
      try {
        if (img.buffer) { imageBuffers.push(img); return; }
        const isData = String(img.url).startsWith('data:');
        if (isData) {
          const b64 = String(img.url).split(',')[1];
          imageBuffers.push({ ...img, buffer: Buffer.from(b64, 'base64') });
          return;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(img.url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
        clearTimeout(timer);
        if (!res.ok) return;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 5000) imageBuffers.push({ ...img, buffer: buf });
      } catch { /* ข้ามภาพโหลดไม่ได้ */ }
    }));
    console.log(`[CoverV3] downloaded ${imageBuffers.length}/${candidates.length} buffers`);

    // ── Quality floor (หลักเดียวกับ v1) ──
    const { V3_TEMPLATES } = await import('@/lib/services/coverExecutorService');
    const minSlots = V3_TEMPLATES.v3_grid3.slots.length;
    if (imageBuffers.length < minSlots) {
      const msg = `ภาพใช้ได้ ${imageBuffers.length} ใบ (ต้องการอย่างน้อย ${minSlots}) — ข่าวนี้ภาพหายาก`;
      await markQueueJob('failed', { error: msg });
      return NextResponse.json({ success: false, error: msg, errorType: 'INSUFFICIENT_QUALITY_IMAGES' }, { status: 422 });
    }

    // ── ② AI Vision Director ──
    const templateSpec = imageBuffers.length >= 6 ? V3_TEMPLATES.v3_grid4 : V3_TEMPLATES.v3_grid3;
    console.log(`[CoverV3] ③ Director (${templateSpec.id}, pool=${imageBuffers.length})...`);
    const { directCover, reviewCover } = await import('@/lib/services/coverDirectorService');
    const direction = await directCover({ imageBuffers, identity, templateSpec, newsTitle });
    if (!direction) {
      await markQueueJob('failed', { error: 'AI Director จัดวางไม่สำเร็จ' });
      return NextResponse.json({ success: false, error: 'AI Director จัดวางไม่สำเร็จ', errorType: 'DIRECTOR_FAILED' }, { status: 422 });
    }

    // ── ③ Execute (พิกเซลแท้) ──
    const { executeCover, applyFixes } = await import('@/lib/services/coverExecutorService');
    let assignments = direction.assignments;
    let coverBuffer = await executeCover({ assignments, imageBuffers, templateSpec });
    console.log(`[CoverV3] ④ composed ${Math.round(coverBuffer.length / 1024)}KB`);

    // ── ④ Self-QC 1 รอบ ──
    const qc = await reviewCover({ coverBuffer, templateSpec, assignments });
    let qcApplied = false;
    if (!qc.ok && qc.fixes.length > 0) {
      assignments = applyFixes(assignments, qc.fixes);
      coverBuffer = await executeCover({ assignments, imageBuffers, templateSpec });
      qcApplied = true;
      console.log(`[CoverV3] ⑤ QC fixes applied (${qc.fixes.length}) → recomposed`);
    } else {
      console.log('[CoverV3] ⑤ QC passed first try');
    }

    // ── Archive (reuse v1 case archive) ──
    let caseId = null;
    try {
      const { saveCase } = await import('@/lib/services/coverCaseArchive');
      const saved = await saveCase(coverBuffer, {
        newsTitle: newsTitle || (content || '').slice(0, 80),
        content: (content || '').slice(0, 500),
        score: 0,
        templateUsed: templateSpec.id,
        elapsed: (Date.now() - t0) / 1000,
        imageCount: assignments.length,
        identity: { mainCharacter: identity.mainCharacter, storyType: identity.storyType, composer: 'v3-director' },
      });
      caseId = saved?.caseId || null;
      console.log(`[CoverV3] 📁 archived as ${caseId}`);
    } catch (e) { console.log('[CoverV3] archive failed (non-fatal):', e.message?.slice(0, 60)); }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[CoverV3] ✅ Done in ${elapsed}s`);

    const responsePayload = {
      success: true,
      composer: 'v3-director',
      base64: `data:image/jpeg;base64,${coverBuffer.toString('base64')}`,
      template: templateSpec.id,
      assignments: assignments.map(a => ({ slot: a.slotId, image: a.imageIndex, crop: a.crop, why: a.why })),
      directorReason: direction.reason,
      qcApplied,
      caseId,
      elapsed: `${elapsed}s`,
      identity: { mainCharacter: identity.mainCharacter, storyType: identity.storyType },
    };
    await markQueueJob('completed', { result: responsePayload });
    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('[CoverV3] Pipeline error:', error.message);
    await markQueueJob('failed', { error: error.message });
    return NextResponse.json(
      { success: false, error: error.message, errorType: 'PIPELINE_ERROR' },
      { status: 500 }
    );
  }
}
