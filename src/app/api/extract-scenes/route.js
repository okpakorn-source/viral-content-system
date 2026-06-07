import { NextResponse } from 'next/server';

/**
 * POST /api/extract-scenes
 * ★ สกัดซีนจากเนื้อข่าว — ให้ user ตรวจสอบก่อนสร้างปก
 * เร็ว: ใช้แค่ Gemini Flash call เดียว (~2-3 วินาที)
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { content, newsTitle, sourceUrl } = body;

    if (!content && !newsTitle) {
      return NextResponse.json({
        success: false,
        error: 'ต้องใส่เนื้อหาข่าวหรือหัวข้อข่าว',
        errorType: 'MISSING_INPUT',
      }, { status: 400 });
    }

    const startTime = Date.now();

    let fullContent = content || '';
    let title = newsTitle || '';

    // Step 1: ถ้ามี sourceUrl แต่ไม่มี content → extract ก่อน
    if (sourceUrl && !fullContent) {
      try {
        const extractRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: sourceUrl }),
        });
        const extractData = await extractRes.json();
        if (extractData.success) {
          fullContent = extractData.content || '';
          title = title || extractData.title || '';
        }
      } catch (e) {
        console.log('[ExtractScenes] URL extraction failed:', e.message);
      }
    }

    // Step 2: ดึงชื่อคนจากเนื้อหาเบื้องต้น (ไม่ต้อง self-fetch)
    const peopleRegex = /(?:ด\.ช\.|ด\.ญ\.|นาย|นาง|นางสาว|พ\.ต\.ท\.|พ\.ต\.อ\.|น\.ส\.|ร\.ต\.อ\.)\s*[\u0E00-\u0E7F]+(?:\s+[\u0E00-\u0E7F]+)*/g;
    const extractedPeople = [...new Set((fullContent.match(peopleRegex) || []).map(p => p.trim()))];
    
    const breakdownData = {
      core_story: fullContent.slice(0, 3000),
      key_facts: { people: extractedPeople },
    };

    // Step 3: สกัด identity + scenes (มี retry ในตัว storyIdentityService แล้ว)
    const { analyzeStoryIdentity } = await import('@/lib/services/storyIdentityService');
    const identity = await analyzeStoryIdentity(title || fullContent.slice(0, 200), breakdownData);

    if (!identity) {
      return NextResponse.json({
        success: false,
        error: 'ไม่สามารถวิเคราะห์เนื้อหาข่าวได้ (Gemini API อาจไม่ว่าง — ลองอีกครั้ง)',
        errorType: 'ANALYSIS_FAILED',
      }, { status: 500 });
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // ★ Return scenes for user review
    return NextResponse.json({
      success: true,
      elapsed: `${elapsed}s`,
      // ข้อมูลหลัก
      newsTitle: title,
      identity: {
        mainCharacter: identity.mainCharacter,
        secondaryCharacter: identity.secondaryCharacter,
        characters: identity.characters,
        characterRoles: identity.characterRoles,
        emotion: identity.emotion,
        coverEmotion: identity.coverEmotion,
        location: identity.location,
        story: identity.story,
        keywords: identity.keywords,
      },
      // ★ ซีนที่สกัดได้ — user ตรวจสอบ/แก้ไข/ลบได้
      scenes: (identity.keyScenes || []).map((scene, i) => ({
        id: `scene_${i}`,
        text: scene,
        enabled: true,
      })),
      // ★ Search queries ที่จะใช้ — user เห็นว่า AI จะค้นอะไร
      searchQueries: identity.searchQueries || {},
      // ★ Typography
      typography: identity.typography || {},
      // ★ Full identity (for passing to auto-cover later)
      fullIdentity: identity,
    });

  } catch (error) {
    console.error('[ExtractScenes] Error:', error.message);
    return NextResponse.json({
      success: false,
      error: error.message,
      errorType: 'EXTRACT_SCENES_ERROR',
    }, { status: 500 });
  }
}
