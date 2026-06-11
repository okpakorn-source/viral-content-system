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
    const { content, newsTitle = '', sourceUrl = '', _queueJobId = null, forceTemplateId = null } = body;

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
    let identity = await analyzeStoryIdentity(
      newsTitle || (content || '').slice(0, 100),
      { core_story: content || newsTitle }
    );
    if (!identity) {
      // ★ ข่าวฉาก/ฝูงชนไม่มีบุคคลตัวหลัก (เช่น ประชาชนเรียงแถวถวายบังคม) — เดิม fail ทั้งงาน (IDENTITY_FAILED 422)
      //   → fallback โหมด "เหตุการณ์นำ": ใช้ใจความข่าวแทนตัวบุคคล ให้ pipeline เดินต่อได้
      const headline = (newsTitle || (content || '').slice(0, 80)).trim();
      identity = {
        mainCharacter: headline.slice(0, 60) || 'เหตุการณ์ในข่าว',
        storyType: 'event_scene',
        coreStory: { celebratedAction: (content || newsTitle || '').slice(0, 200) },
        mainVisualShouldBe: headline,
        _fallback: true,
      };
      console.log('[CoverV3] ⚠️ identity fallback: ข่าวไม่มีตัวหลัก → โหมดเหตุการณ์นำ');
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

    // ── ตรวจจับตำแหน่งใบหน้า → ป้อนเป็น "ข้อมูลพิกัด" ให้ Director คำนวณกรอบแน่นแบบตัวเลข
    //    (rev.7 — feedback: ฮีโร่ไม่เด่น/วงกลมล้น เพราะ Director กะกรอบด้วยตาแล้วหลวม)
    let faceBoxes = [];
    try {
      const { batchDetectFaces } = await import('@/lib/services/faceDetector');
      const fdMap = await batchDetectFaces(imageBuffers.map((img, i) => ({ id: `v3_${i}`, buffer: img.buffer })));
      const sharpLib = (await import('sharp')).default;
      faceBoxes = await Promise.all(imageBuffers.map(async (img, i) => {
        const fd = fdMap?.get?.(`v3_${i}`);
        const hasText = !!fd?.hasBigText; // ★ สกรีนช็อต/กราฟิกข่าว — ต้องส่งธงต่อแม้ไม่มีหน้า
        if (!fd?.hasFaces || !fd.faces?.length) return hasText ? { hasText } : null;
        const meta = await sharpLib(img.buffer).metadata();
        const W = meta.width || 1, H = meta.height || 1;
        const largest = fd.faces.reduce((b, f) => (f.width * f.height > b.width * b.height ? f : b), fd.faces[0]);
        return {
          x1: +(largest.x / W).toFixed(2), y1: +(largest.y / H).toFixed(2),
          x2: +((largest.x + largest.width) / W).toFixed(2), y2: +((largest.y + largest.height) / H).toFixed(2),
          count: fd.faces.length,
          ...(hasText ? { hasText } : {}),
        };
      }));
      console.log(`[CoverV3] face boxes: ${faceBoxes.filter(b => b && b.x1 !== undefined).length}/${imageBuffers.length} images | มีตัวหนังสือฝัง: ${faceBoxes.filter(b => b?.hasText).length}`);
    } catch (e) { console.log('[CoverV3] face detect failed (non-fatal):', e.message?.slice(0, 50)); }

    // ── Quality floor (หลักเดียวกับ v1) ──
    const { V3_TEMPLATES, adaptRegistryTemplate } = await import('@/lib/services/coverExecutorService');
    if (imageBuffers.length < 3) {
      const msg = `ภาพใช้ได้ ${imageBuffers.length} ใบ (ต้องการอย่างน้อย 3) — ข่าวนี้ภาพหายาก`;
      await markQueueJob('failed', { error: msg });
      return NextResponse.json({ success: false, error: msg, errorType: 'INSUFFICIENT_QUALITY_IMAGES' }, { status: 422 });
    }

    // ── ② AI Vision Director — เลือกโครงเองจากแม่บทที่แกะจากปกไวรัลจริง ──
    // ★ rev.12: บังคับลุคไวรัลในโค้ด — ภาพพอเมื่อไหร่ ให้เลือกได้เฉพาะโครงที่มี "วงกลม+กรอบไฮไลต์"
    //   (บทเรียน CASE-045/050: เตือนใน prompt แล้ว Director ยังหนีไปโครงเรียบ → "การนำเสนอห่วย")
    const viralFirst = [
      V3_TEMPLATES.vt_hero_stack,   // 6 ภาพ — ผู้ดูแล/ผู้ช่วยเหลือ (วงกลม+คลิป)
      V3_TEMPLATES.vt_quad_circle,  // 5 ภาพ — สองฝ่าย ให้-รับ (วงกลมกลาง)
      V3_TEMPLATES.vt_faces_circle, // 5 ภาพ — ครอบครัว/เด็ก (วงกลม)
    ].filter(t => t.slots.length <= imageBuffers.length);
    const plainFallbacks = [
      V3_TEMPLATES.vt_hero_br,      // 4 ภาพ — อารมณ์น้ำตาเป็นจุดขาย
      V3_TEMPLATES.vt_hero_wide,    // 4 ภาพ — คนเล่า/สัมภาษณ์ + คู่กรณี
      V3_TEMPLATES.v3_grid3,        // 3 ภาพ — fallback ตารางสะอาด
    ].filter(t => t.slots.length <= imageBuffers.length);
    // forceTemplateId: บังคับโครงเจาะจง (ใช้ทดสอบ/Cover Lab เลือกเอง) — ข้าม viral-first logic
    const forced = forceTemplateId && V3_TEMPLATES[forceTemplateId] ? [V3_TEMPLATES[forceTemplateId]] : null;
    const templateOptions = forced || (viralFirst.length > 0 ? viralFirst : plainFallbacks);

    console.log(`[CoverV3] ③ Director (options: ${templateOptions.map(t => t.id).join(', ')} | pool=${imageBuffers.length})...`);
    const { directCover, reviewCover } = await import('@/lib/services/coverDirectorService');
    const direction = await directCover({ imageBuffers, identity, templateOptions, templateSpec: templateOptions[0], newsTitle, faceBoxes });
    if (!direction) {
      await markQueueJob('failed', { error: 'AI Director จัดวางไม่สำเร็จ' });
      return NextResponse.json({ success: false, error: 'AI Director จัดวางไม่สำเร็จ', errorType: 'DIRECTOR_FAILED' }, { status: 422 });
    }
    const templateSpec = direction.templateSpec; // โครงที่ Director เลือก

    // ── ③ Execute (พิกเซลแท้) ──
    const { executeCover, applyFixes } = await import('@/lib/services/coverExecutorService');
    let assignments = direction.assignments;
    let coverBuffer = await executeCover({ assignments, imageBuffers, templateSpec });
    console.log(`[CoverV3] ④ composed ${Math.round(coverBuffer.length / 1024)}KB`);

    // ── ④ Self-QC 1 รอบ (rev.8: สลับรูปได้ | rev.11: รู้เนื้อข่าว — จับภาพไม่เกี่ยวกับเรื่องได้) ──
    const qc = await reviewCover({ coverBuffer, templateSpec, assignments, imageBuffers, faceBoxes, identity, newsTitle });
    let qcApplied = false;
    if (!qc.ok && qc.fixes.length > 0) {
      assignments = applyFixes(assignments, qc.fixes);
      coverBuffer = await executeCover({ assignments, imageBuffers, templateSpec });
      qcApplied = true;
      console.log(`[CoverV3] ⑤ QC fixes applied (${qc.fixes.length}) → recomposed`);
    } else {
      console.log('[CoverV3] ⑤ QC passed first try');
    }

    // ── ให้คะแนนปกด้วย mini-judge (แก้ป้าย 0/10 ในคลัง) ──
    let score = 7;
    try {
      const { callAI } = await import('@/lib/ai/openai');
      const smallForScore = await (await import('sharp')).default(coverBuffer).resize(600, null, { fit: 'inside' }).jpeg({ quality: 75 }).toBuffer();
      // งานจากคิวมักไม่มี newsTitle → ใช้ identity แทน และบังคับให้คะแนนจากภาพเสมอ (กัน "ข้อมูลไม่พอ" = 0/10)
      const judgeCtx = (newsTitle || identity?.mainCharacter || identity?.storyType || '').slice(0, 80);
      const judgeRes = await callAI({
        prompt: `ให้คะแนนปกข่าวนี้ 0-10 จากภาพที่แนบ (องค์ประกอบ, ความเด่นของบุคคล, การเล่าเรื่อง, ความสะอาด)${judgeCtx ? ` บริบท: "${judgeCtx}"` : ''}\nต้องประเมินจากภาพเสมอแม้ไม่มีบริบทข่าว ห้ามตอบว่าข้อมูลไม่เพียงพอ\nตอบ JSON: {"score": 0-10, "reason": "สั้นๆ"}`,
        imageContents: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${smallForScore.toString('base64')}`, detail: 'low' } }],
        model: 'gpt-4o-mini',
        temperature: 0.2,
        maxTokens: 300,
      });
      const j = typeof judgeRes === 'object' ? judgeRes : JSON.parse(String(judgeRes).match(/\{[\s\S]*\}/)?.[0] || '{}');
      if (Number.isFinite(Number(j?.score))) score = Math.max(0, Math.min(10, Number(j.score)));
      console.log(`[CoverV3] 🏆 Judge score: ${score}/10 — ${String(j?.reason || '').slice(0, 70)}`);
    } catch (e) { console.log('[CoverV3] judge failed (non-fatal):', e.message?.slice(0, 50)); }

    // ── Archive (reuse v1 case archive) ──
    let caseId = null;
    try {
      const { saveCase } = await import('@/lib/services/coverCaseArchive');
      const saved = await saveCase(coverBuffer, {
        newsTitle: newsTitle || (content || '').slice(0, 80),
        content: (content || '').slice(0, 500),
        score,
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
      score,
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
