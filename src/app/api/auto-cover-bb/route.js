import { NextResponse } from 'next/server';

/**
 * =====================================================
 * Auto Cover v2 — Bannerbear Edition (ระบบแยกทดลอง)
 * =====================================================
 * แนวคิดตามไอเดียผู้ใช้ (11 มิ.ย.): ตัดชั้นประกอบภาพที่ซับซ้อนทิ้ง —
 * AI ของเราทำแค่ "หาภาพ + คัดที่ตรงข่าวที่สุด" แล้วโยนให้ Bannerbear
 * render ตาม template ตายตัวที่ออกแบบเลียนแบบปกไวรัลตัวอย่าง
 *
 * Pipeline บาง: storyIdentity → multiAgent scrape+judge → เลือก 4 ภาพเด่น
 *               → Bannerbear (template + smart face crop + auto text)
 *
 * ข้อจำกัด v1: ใช้เฉพาะภาพที่เป็น URL สาธารณะ (เฟรม YouTube ที่เป็น data-URI ถูกข้าม)
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request) {
  try {
    const body = await request.json();
    const { content, newsTitle = '', sourceUrl = '', templateUid = null } = body;

    if (!content && !newsTitle) {
      return NextResponse.json(
        { success: false, error: 'ต้องระบุ content หรือ newsTitle', errorType: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const { isBannerbearAvailable, composeCoverViaBannerbear } = await import('@/lib/services/bannerbearComposer');
    if (!isBannerbearAvailable() && !templateUid) {
      return NextResponse.json({
        success: false,
        error: 'ยังไม่ได้ตั้งค่า Bannerbear — เพิ่ม BANNERBEAR_API_KEY และ BANNERBEAR_TEMPLATE_UID ใน .env (สมัครที่ bannerbear.com มี free trial)',
        errorType: 'BANNERBEAR_NOT_CONFIGURED',
      }, { status: 503 });
    }

    // ── Step 1: วิเคราะห์ตัวตนเรื่อง (ใช้สมองเดิมของระบบ) ──
    console.log('[CoverBB] Step 1: Story identity...');
    const { analyzeStoryIdentity } = await import('@/lib/services/storyIdentityService');
    const identity = await analyzeStoryIdentity(
      newsTitle || (content || '').slice(0, 100),
      { core_story: content || newsTitle }
    );
    if (!identity) {
      return NextResponse.json(
        { success: false, error: 'วิเคราะห์เนื้อข่าวไม่สำเร็จ', errorType: 'IDENTITY_FAILED' },
        { status: 422 }
      );
    }
    console.log(`[CoverBB] Identity: ${identity.mainCharacter} | ${identity.storyType}`);

    // ── Step 2: หาภาพ 5 สาย + AI Judge คัด (ใช้สมองเดิมของระบบ) ──
    console.log('[CoverBB] Step 2: Multi-agent image search...');
    const { runMultiAgentImageSearch } = await import('@/lib/services/multiAgentImageScraper');
    const selected = await runMultiAgentImageSearch(
      sourceUrl || '',
      sourceUrl ? 'url' : 'text',
      identity.characters || [],
      newsTitle || (content || '').slice(0, 100),
      identity
    );

    // ── Step 3: เลือก 4 ภาพเด่น (URL สาธารณะ, ไม่ซ้ำ, hero นำ) ──
    const publicImages = (selected || [])
      .filter(img => typeof img.url === 'string' && /^https?:\/\//i.test(img.url))
      .sort((a, b) => (b.score || 0) - (a.score || 0));

    const seen = new Set();
    const heroFirst = [
      ...publicImages.filter(img => /HERO/i.test(img.role || '')),
      ...publicImages.filter(img => !/HERO/i.test(img.role || '')),
    ].filter(img => {
      if (seen.has(img.url)) return false;
      seen.add(img.url);
      return true;
    });

    if (heroFirst.length < 2) {
      return NextResponse.json({
        success: false,
        error: `ภาพ URL สาธารณะที่ใช้ได้มีแค่ ${heroFirst.length} ใบ (ต้องการอย่างน้อย 2)`,
        errorType: 'INSUFFICIENT_QUALITY_IMAGES',
      }, { status: 422 });
    }

    const pick = heroFirst.slice(0, 4);
    console.log(`[CoverBB] Step 3: Picked ${pick.length} images (hero: ${pick[0]?.role || '?'} score ${pick[0]?.score || '?'})`);

    // ── Step 4: ข้อความปก — ผู้ใช้เลือกแนว "คลีนไม่มีข้อความ" (11 มิ.ย.) → ไม่ส่ง text ไป Bannerbear
    //   (เปิดกลับได้ด้วย env COVER_BB_TEXT=1)
    const typography = process.env.COVER_BB_TEXT === '1'
      ? {
          hook: identity.coverEmotion || 'ข่าวเด่น',
          main: (newsTitle || identity.mainCharacter || '').slice(0, 34),
          punch: (identity.emotionalHook || identity.coreStory?.celebratedAction || '').slice(0, 46),
        }
      : {};

    // ── Step 5: โยนให้ Bannerbear ประกอบ ──
    console.log('[CoverBB] Step 5: Rendering via Bannerbear...');
    const rendered = await composeCoverViaBannerbear({
      imageUrls: pick.map(img => img.url),
      typography,
      templateUid,
    });

    if (!rendered.success) {
      return NextResponse.json(
        { success: false, error: rendered.error, errorType: 'BANNERBEAR_RENDER_FAILED' },
        { status: 502 }
      );
    }

    console.log(`[CoverBB] ✅ Done: ${rendered.imageUrl}`);
    return NextResponse.json({
      success: true,
      imageUrl: rendered.imageUrl,
      composer: 'bannerbear',
      typography,
      usedImages: pick.map(img => ({ url: img.url, role: img.role, score: img.score, title: (img.title || '').slice(0, 60) })),
      identity: {
        mainCharacter: identity.mainCharacter,
        storyType: identity.storyType,
      },
    });
  } catch (error) {
    console.error('[CoverBB] Error:', error.message);
    return NextResponse.json(
      { success: false, error: error.message, errorType: 'PIPELINE_ERROR' },
      { status: 500 }
    );
  }
}
