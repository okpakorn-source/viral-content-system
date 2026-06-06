/**
 * Auto Cover API Route — /api/auto-cover
 * 
 * POST: Generate cover image automatically from content
 * Body: {
 *   content: string,        // เนื้อหาข่าว
 *   newsTitle: string,      // หัวข้อข่าว
 *   templateId?: string,    // 'auto' | 'builtin_1' | 'builtin_2' | 'builtin_3' | 'builtin_4' | 'builtin_5' | 'builtin_6'
 *   sourceUrl?: string,     // URL ข่าวต้นฉบับ (optional)
 * }
 * 
 * Returns: { success: true, base64: 'data:image/jpeg;base64,...', templateUsed, imageCount, score }
 */
import { NextResponse } from 'next/server';
import sharp from 'sharp';
import crypto from 'crypto';
import { getSupabase } from '@/lib/supabase';

// ═══ dHash: Perceptual Image Hashing ═══
// Inlined because imageSearchService.js does not export these utilities
async function computeImageHash(buffer) {
  try {
    const raw = await sharp(buffer)
      .resize(9, 8, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();

    let hash = 0n;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const left = raw[y * 9 + x];
        const right = raw[y * 9 + x + 1];
        if (left > right) hash |= 1n << BigInt(y * 8 + x);
      }
    }
    return hash;
  } catch (e) {
    return null;
  }
}

function hammingDistance(hash1, hash2) {
  if (hash1 === null || hash2 === null) return 64; // max distance if hash failed
  let xor = hash1 ^ hash2;
  let dist = 0;
  while (xor > 0n) {
    dist += Number(xor & 1n);
    xor >>= 1n;
  }
  return dist;
}

// ═══ Final Cover Judge (Gemini Vision) ═══
async function evaluateFinalCover(base64Image, newsTitle) {
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `You are an elite news Art Director evaluating a composed 1080x1080 news cover for: "${newsTitle}".

Evaluate:
1. Is the main subject clearly visible in the center circle?
2. Are the background images diverse (not the same photo cropped differently)?
3. Is the text readable (not broken characters)?
4. Is it professional quality (not cheap-looking)?

Score 1-10. Return ONLY: {"score": 8, "reason": "brief"}. No markdown blocks.`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64Image, mimeType: 'image/jpeg' } }
    ]);
    const responseText = result.response.text();
    const match = responseText.match(/\{[\s\S]*?\}/);
    if (match) {
      const data = JSON.parse(match[0]);
      console.log(`[AutoCover Judge] Score: ${data.score}/10 — ${data.reason}`);
      return data.score || 7;
    }
    return 7;
  } catch (e) {
    console.log('[AutoCover Judge] Evaluation error:', e.message);
    return 7;
  }
}

export async function POST(request) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const { content, newsTitle, templateId = 'auto', sourceUrl = '', regenerate = false, selectedImageUrls = null, manualSlots = null, manualCharacters = [], manualKeywords = [] } = body;

    if (!content && !newsTitle) {
      return NextResponse.json(
        { success: false, error: 'ต้องระบุ content หรือ newsTitle', errorType: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Generate unique session ID for image bank tracking
    const sessionId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    console.log('[AutoCover] Starting pipeline...');
    console.log(`[AutoCover] Title: ${(newsTitle || '').substring(0, 80)}`);
    console.log(`[AutoCover] Template: ${templateId}, Regenerate: ${regenerate}, Session: ${sessionId}`);

    // Step 1: Analyze story identity (extract keywords, characters, emotions)
    const { analyzeStoryIdentity } = await import('@/lib/services/storyIdentityService');

    // Build breakdown data from content — ส่งเนื้อหาเต็มมากขึ้นเพื่อให้ AI วิเคราะห์ตัวละครได้ครบ
    const fullContent = content || newsTitle || '';
    // ดึงชื่อคนจากเนื้อหาเบื้องต้น (ด.ช., ด.ญ., นาย, นาง, นางสาว ฯลฯ)
    const peopleRegex = /(?:ด\.ช\.|ด\.ญ\.|นาย|นาง|นางสาว|พ\.ต\.ท\.|พ\.ต\.อ\.|น\.ส\.|ร\.ต\.อ\.)\s*[\u0E00-\u0E7F]+(?:\s+[\u0E00-\u0E7F]+)*/g;
    const extractedPeople = [...new Set((fullContent.match(peopleRegex) || []).map(p => p.trim()))];
    const breakdownData = {
      core_story: fullContent.substring(0, 1500), // เพิ่มจาก 500 → 1500 ตัวอักษร
      key_facts: {
        people: extractedPeople,
      },
    };

    let identity = await analyzeStoryIdentity(newsTitle || content?.substring(0, 100), breakdownData);

    // ★ Fallback: ถ้า Gemini 503/ล้มเหลว → สร้าง identity พื้นฐานจาก title
    if (!identity) {
      console.log('[AutoCover] ⚠️ AI identity failed — using fallback from title');
      const title = newsTitle || content?.substring(0, 100) || '';
      // ดึงชื่อคนจาก title (คำที่ไม่ใช่ stop words + 2 คำแรก)
      const words = title.split(/[\s,]+/).filter(w => w.length > 1);
      const mainChar = words.slice(0, 3).join(' ') || 'ข่าว';
      
      identity = {
        characters: [mainChar],
        mainCharacter: mainChar,
        secondaryCharacter: '',
        story: title,
        emotion: 'neutral',
        coverEmotion: 'drama',
        location: '',
        keywords: words.slice(0, 8),
        keyScenes: [],
        searchQueries: {
          person_portrait: mainChar,
          person_closeup: `${mainChar} ภาพถ่าย`,
          person_interview: `${mainChar} สัมภาษณ์`,
          person_drama: `${mainChar} ผลงาน`,
          person_emotion: mainChar,
        },
        searchGoogle: title,
        searchYouTube: mainChar,
        searchPexels: 'news event person',
        typography: { hook: 'ด่วน!', main: title.substring(0, 30), punch: '' },
      };
    }

    console.log(`[AutoCover] Identity: ${identity.mainCharacter}, emotion: ${identity.emotion}`);

    // ★ Merge manual characters + keywords from user input
    if (manualCharacters && manualCharacters.length > 0) {
      console.log(`[AutoCover] 👤 Manual characters: ${manualCharacters.join(', ')}`);
      identity.characters = [...new Set([...manualCharacters, ...(identity.characters || [])])];
      // ถ้า AI ไม่ได้เลือก mainCharacter → ใช้คนแรกจาก manual
      if (!identity.mainCharacter || identity.mainCharacter === 'ข่าว') {
        identity.mainCharacter = manualCharacters[0];
      }
      // สร้าง search queries เพิ่มสำหรับแต่ละ manual character
      const sq = identity.searchQueries || {};
      for (const charName of manualCharacters) {
        if (charName === identity.mainCharacter) continue; // main มี queries อยู่แล้ว
        // เพิ่มเป็น characterRoles
        if (!identity.characterRoles) identity.characterRoles = [];
        if (!identity.characterRoles.some(cr => cr.name === charName)) {
          identity.characterRoles.push({ name: charName, role: 'important', relation: 'ตัวละครสำคัญ' });
        }
      }
      // เพิ่ม secondary character ถ้ายังไม่มี
      if (!identity.secondaryCharacter && manualCharacters.length > 1) {
        identity.secondaryCharacter = manualCharacters.find(c => c !== identity.mainCharacter) || '';
      }
    }
    if (manualKeywords && manualKeywords.length > 0) {
      console.log(`[AutoCover] 🏷️ Manual keywords: ${manualKeywords.join(', ')}`);
      identity.keywords = [...new Set([...manualKeywords, ...(identity.keywords || [])])];
      // เพิ่มเป็น keyScenes ด้วย
      identity.keyScenes = [...new Set([...(identity.keyScenes || []), ...manualKeywords.slice(0, 3)])];
    }

    // Step 2: Multi-agent image search OR use manually selected images
    let bestImages;

    if (selectedImageUrls && Array.isArray(selectedImageUrls) && selectedImageUrls.length >= 2) {
      // ★ Manual mode: user เลือกภาพจาก image bank → ข้าม search
      console.log(`[AutoCover] 🎯 Manual mode: using ${selectedImageUrls.length} pre-selected images`);
      bestImages = selectedImageUrls.map((url, i) => ({
        url,
        role: i === 0 ? 'HERO_FACE' : 'SUPPORT',
        score: 7,
        reason: 'user selected',
      }));
    } else if (manualSlots && typeof manualSlots === 'object' && Object.keys(manualSlots).length > 0) {
      // ★ Manual slot mode: convert slot assignments to URL list
      console.log(`[AutoCover] 🎛️ Manual slot mode: ${Object.keys(manualSlots).length} slots assigned`);
      const urls = Object.values(manualSlots).filter(url => url && url.length > 0);
      if (urls.length >= 2) {
        bestImages = urls.map((url, i) => ({
          url,
          role: i === 0 ? 'HERO_FACE' : 'SUPPORT',
          score: 7,
          reason: 'manual slot assignment',
        }));
      } else {
        // Not enough manual slots — fall through to auto search
        const { runMultiAgentImageSearch } = await import('@/lib/services/multiAgentImageScraper');
        bestImages = await runMultiAgentImageSearch(sourceUrl || '', sourceUrl ? 'url' : 'text', identity.characters || [], newsTitle || content?.substring(0, 100), identity);
      }
    } else {
      // ★ Auto mode: AI ค้นหาภาพ
      const { runMultiAgentImageSearch } = await import('@/lib/services/multiAgentImageScraper');
      bestImages = await runMultiAgentImageSearch(
        sourceUrl || '',
        sourceUrl ? 'url' : 'text',
        identity.characters || [],
        newsTitle || content?.substring(0, 100),
        identity
      );
    }

    if (!bestImages || bestImages.length === 0) {
      return NextResponse.json(
        { success: false, error: 'ไม่พบภาพที่เหมาะสม', errorType: 'NO_IMAGES_FOUND', status: 'NEED_MANUAL_COVER' },
        { status: 200 }
      );
    }

    console.log(`[AutoCover] Found ${bestImages.length} images`);

    // Step 3: Download + validate + dedup
    const { downloadAndValidateImage } = await import('@/lib/services/imageSearchService');

    const imageBuffers = [];
    const imageHashes = [];
    // เรียงลำดับ: HERO_FACE → HERO → CONTEXT_SCENE → EVIDENCE → EMOTION → RELATIONSHIP → SUPPORT
    const rolePriority = { 'HERO_FACE': 0, 'HERO': 1, 'CONTEXT_SCENE': 2, 'EVIDENCE': 3, 'EMOTION': 4, 'RELATIONSHIP': 5, 'SUPPORT': 6 };
    const orderedImages = [...bestImages].sort((a, b) => {
      return (rolePriority[a.role] ?? 6) - (rolePriority[b.role] ?? 6);
    });

    for (const img of orderedImages) {
      if (imageBuffers.length >= 8) break; // เพิ่ม max เป็น 8 (เผื่อ template ใหญ่)
      try {
        const buf = await downloadAndValidateImage(img.url);
        if (!buf) {
          console.log(`[Download] Skipped: ${img.url?.substring(0, 60)}`);
          continue;
        }

        // Dedup check via dHash
        const hash = await computeImageHash(buf);
        const isDuplicate = imageHashes.some(h => hammingDistance(hash, h) < 12);
        if (isDuplicate) {
          console.log(`[Download] Skipped duplicate (hamming < 12)`);
          continue;
        }

        // ★ เก็บ metadata ความละเอียดด้วย
        const imgMeta = await sharp(buf).metadata().catch(() => ({}));
        imageHashes.push(hash);
        imageBuffers.push({
          buffer: buf,
          role: img.role || 'SUPPORT',
          url: img.url,
          score: img.score,
          width: imgMeta.width || 0,
          height: imgMeta.height || 0,
        });
        console.log(`[Download] ✅ #${imageBuffers.length} ${img.role} ${imgMeta.width}x${imgMeta.height} — ${img.url?.substring(0, 60)}`);
      } catch {
        // Skip failed downloads silently
      }
    }

    // ★ ต้องมีอย่างน้อย 4 ภาพ unique — ถ้าน้อยกว่า ลองค้นเพิ่มเติม
    if (imageBuffers.length < 4) {
      console.log(`[AutoCover] ⚠️ Only ${imageBuffers.length} images! Trying emergency search...`);
      // Emergency: ค้นชื่อบุคคลตรงๆ เพิ่ม
      if (identity?.mainCharacter) {
        const emergencyQueries = [
          `${identity.mainCharacter} สัมภาษณ์`,
          `${identity.mainCharacter} ละคร ซีรีส์`,
          `${identity.mainCharacter} งานอีเวนท์`,
          `${identity.mainCharacter} ภาพถ่าย`,
        ];
        const serperKey = process.env.SERPER_API_KEY;
        if (serperKey) {
          const emergencyCandidates = []; // รวบรวม URL ก่อน แล้วส่ง Judge ทีเดียว
          for (const eq of emergencyQueries) {
            if (emergencyCandidates.length >= 15) break;
            try {
              console.log(`[Emergency] 🔍 Searching: "${eq}"`);
              const res = await fetch('https://google.serper.dev/images', {
                method: 'POST',
                headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ q: eq, gl: 'th', hl: 'th', num: 8, imgSize: 'large', imgType: 'photo' })
              });
              if (res.ok) {
                const data = await res.json();
                for (const img of (data.images || [])) {
                  if (emergencyCandidates.length >= 15) break;
                  const url = img.imageUrl;
                  // ★ Pre-filter: ข้าม URL ที่ชัดว่าไม่ clean
                  if (!url || url.includes('facebook.com') || url.includes('tiktok.com')) continue;
                  if (imageBuffers.some(ib => ib.url === url)) continue; // ข้ามซ้ำ
                  emergencyCandidates.push(url);
                }
              }
            } catch {}
          }

          // ★ ส่ง emergency candidates ผ่าน Judge (ใช้ระบบเดียวกัน)
          if (emergencyCandidates.length > 0) {
            console.log(`[Emergency] 📤 Sending ${emergencyCandidates.length} candidates to Judge...`);
            try {
              const { runMultiAgentImageSearch } = await import('@/lib/services/multiAgentImageScraper');
              // ส่ง judge โดยตรง (import judgeImages ไม่ได้ เพราะไม่ export)
              // → ใช้ downloadAndValidate แทน + basic filter
              const { downloadAndValidateImage } = await import('@/lib/services/imageSearchService');
              for (const url of emergencyCandidates) {
                if (imageBuffers.length >= 8) break;
                try {
                  const buf = await downloadAndValidateImage(url);
                  if (!buf) continue;
                  const imgMeta = await sharp(buf).metadata().catch(() => ({}));
                  // ★ Basic quality filter
                  if (imgMeta.width && imgMeta.height && (imgMeta.width < 500 || imgMeta.height < 350)) {
                    console.log(`[Emergency] 🚫 Low res ${imgMeta.width}x${imgMeta.height}: ${url.substring(0, 60)}`);
                    continue;
                  }
                  const hash = await computeImageHash(buf);
                  const isDup = imageHashes.some(h => hammingDistance(hash, h) < 12);
                  if (isDup) continue;
                  imageHashes.push(hash);
                  // ★ Emergency images get role SUPPORT + low score (3) so they rank below Judge-approved images
                  imageBuffers.push({ buffer: buf, role: 'SUPPORT', url, score: 3, width: imgMeta.width || 0, height: imgMeta.height || 0 });
                  console.log(`[Emergency] ✅ Found: ${imgMeta.width}x${imgMeta.height}`);
                } catch {}
              }
            } catch (e) {
              console.log(`[Emergency] Judge error: ${e.message?.substring(0, 80)}`);
            }
          }
          console.log(`[Emergency] Total images now: ${imageBuffers.length}`);
        }
      }
    }

    // ★ Save ALL images to image bank (Supabase cover_images table)
    const supabaseForBank = getSupabase();
    if (supabaseForBank && imageBuffers.length > 0) {
      const bankEntries = imageBuffers.map(img => ({
        session_id: sessionId,
        news_title: newsTitle || '',
        source_url: sourceUrl || '',
        image_url: img.url || '',
        ai_score: img.score || 0,
        ai_role: img.role || 'SUPPORT',
        ai_reason: img.reason || '',
        is_selected: (img.score >= 4 && img.role !== 'REJECT'),
        width: img.width || 0,
        height: img.height || 0,
      }));
      try {
        await supabaseForBank.from('cover_images').insert(bankEntries);
        console.log(`[AutoCover] ★ Saved ${bankEntries.length} images to image bank (session: ${sessionId})`);
      } catch (e) {
        console.log(`[AutoCover] Image bank save error: ${e.message?.substring(0, 80)}`);
      }
    }

    if (imageBuffers.length < 2) {
      return NextResponse.json({
        success: false,
        error: `ภาพที่ใช้ได้มีแค่ ${imageBuffers.length} ภาพ (ต้องการอย่างน้อย 2)`,
        errorType: 'INSUFFICIENT_IMAGES',
        status: 'NEED_MANUAL_COVER',
        imageCount: imageBuffers.length,
        sessionId,
      }, { status: 200 });
    }

    console.log(`[AutoCover] Downloaded ${imageBuffers.length} valid images`);

    // Step 4: Face detection on all images
    const { batchDetectFaces } = await import('@/lib/services/faceDetector');
    const faceInput = imageBuffers.map((img, i) => ({ id: String(i), buffer: img.buffer }));
    const faceDataMap = await batchDetectFaces(faceInput);

    console.log('[AutoCover] Face detection complete');

    // Step 5: Choose template — ★ ถ้าภาพน้อย ต้องเลือก template ที่ slot น้อยลง
    let chosenTemplate = templateId;
    if (templateId === 'auto') {
      const hasMultipleFaces = [...faceDataMap.values()].filter(f => f.hasFaces).length;
      const numImages = imageBuffers.length;

      try {
        const { autoSelectTemplate } = await import('@/lib/coverTemplateRegistry');
        chosenTemplate = autoSelectTemplate(numImages, hasMultipleFaces, identity);
      } catch {
        chosenTemplate = 'template_4'; // fallback default
      }
      console.log(`[AutoCover] Auto-selected template: ${chosenTemplate}`);
    }

    // Step 6: ★ ดึงคลังปกไวรัลมาเป็น reference ★
    let coverReferences = [];
    try {
      const { getSupabase } = await import('@/lib/supabase');
      const supabase = getSupabase();
      const { data: refs } = await supabase
        .from('cover_examples')
        .select('analysis, composition, quality_score')
        .eq('composition->>layout_type', chosenTemplate === 'auto' ? 'grid_2x2_circle' : chosenTemplate)
        .order('quality_score', { ascending: false })
        .limit(5);
      
      if (!refs || refs.length === 0) {
        // ถ้าไม่เจอ layout ตรง → ดึง top 5 ปกดีสุด
        const { data: topRefs } = await supabase
          .from('cover_examples')
          .select('analysis, composition, quality_score')
          .order('quality_score', { ascending: false })
          .limit(5);
        coverReferences = topRefs || [];
      } else {
        coverReferences = refs;
      }
      
      if (coverReferences.length > 0) {
        console.log(`[AutoCover] ★ Found ${coverReferences.length} cover references from library`);
      }
    } catch (refErr) {
      console.warn('[AutoCover] Cover library lookup failed (non-critical):', refErr.message);
    }

    // ดึง template spec เพื่อรู้จำนวน slot จริง
    let templateSpec = null;
    try {
      const { getTemplateById, normalizeTemplate } = await import('@/lib/coverTemplateRegistry');
      templateSpec = getTemplateById(chosenTemplate);
      // ★ Fallback: ถ้าไม่ใช่ builtin → ลองหาจาก user templates
      if (!templateSpec) {
        try {
          const { getTemplate } = await import('@/lib/template-library/store');
          const userTmpl = await getTemplate(chosenTemplate);
          if (userTmpl) {
            templateSpec = normalizeTemplate(userTmpl);
            console.log(`[AutoCover] ✅ Using user template: ${chosenTemplate}`);
          }
        } catch (utErr) {
          console.warn('[AutoCover] User template lookup failed:', utErr.message);
        }
      }
    } catch {}

    // Step 7: AI Slot Assignment (with cover library reference)
    const slotAssignment = await assignImagesToSlots(
      imageBuffers, faceDataMap, chosenTemplate, identity, coverReferences
    );

    console.log(`[AutoCover] Slot assignment: ${JSON.stringify(slotAssignment.photoOrder)}`);

    // Step 7: Compose cover
    const { composeCover } = await import('@/lib/coverComposer');

    const plan = {
      layout: chosenTemplate,
      photoOrder: slotAssignment.photoOrder,
      circlePhotoIndex: slotAssignment.circleIndex,
      circleSmallPhotoIndex: slotAssignment.circleSmallIndex,
    };

    // ส่ง buffers ทั้งหมดไป — composeCover จะ map ตาม photoOrder เอง
    const allBuffers = imageBuffers.map(img => img.buffer);

    const coverBuffer = await composeCover(plan, allBuffers, faceDataMap);
    const base64 = `data:image/jpeg;base64,${coverBuffer.toString('base64')}`;
    const orderedBuffers = allBuffers;

    // ★ บันทึกภาพลงคลัง (ไม่ block response) ★
    try {
      const { saveToCache } = await import('@/lib/services/imageCacheService');
      saveToCache(
        imageBuffers.map((img, i) => ({
          buffer: img.buffer,
          url: img.url || '',
          role: img.role || 'SUPPORT',
          source: img.url?.startsWith('data:') ? 'youtube' : 'google',
          score: 7,
        })),
        newsTitle || content?.substring(0, 100),
        identity
      ).then(r => {
        if (r?.success) console.log(`[AutoCover] ★ Saved ${r.saved} images to cache (hash: ${r.newsHash?.slice(0,8)})`);
      }).catch(() => {});
    } catch {}

    // Step 8: AI Final Judge
    let score = 7; // Default
    try {
      score = await evaluateFinalCover(coverBuffer.toString('base64'), newsTitle || '');
    } catch {
      // Keep default score
    }

    // ═══ Step 9: Generate SECOND cover with alternate template ═══
    let cover2Data = null;
    try {
      const { getAlternateTemplate } = await import('@/lib/coverTemplateRegistry');
      const altTemplateId = getAlternateTemplate(chosenTemplate, imageBuffers.length);

      if (altTemplateId && altTemplateId !== chosenTemplate) {
        console.log(`[AutoCover] 🎨 Generating 2nd cover with template: ${altTemplateId}`);

        // Re-run slot assignment with alternate template + shuffled hero
        const altSlotAssignment = await assignImagesToSlots(
          imageBuffers, faceDataMap, altTemplateId, identity, coverReferences,
          { shuffleHero: true }
        );

        const altPlan = {
          layout: altTemplateId,
          photoOrder: altSlotAssignment.photoOrder,
          circlePhotoIndex: altSlotAssignment.circleIndex,
          circleSmallPhotoIndex: altSlotAssignment.circleSmallIndex,
        };

        const altCoverBuffer = await composeCover(altPlan, allBuffers, faceDataMap);
        const altBase64 = `data:image/jpeg;base64,${altCoverBuffer.toString('base64')}`;

        // Score the 2nd cover
        let altScore = 7;
        try {
          altScore = await evaluateFinalCover(altCoverBuffer.toString('base64'), newsTitle || '');
        } catch {
          // Keep default
        }

        cover2Data = {
          base64: altBase64,
          templateUsed: altTemplateId,
          score: altScore,
        };
        console.log(`[AutoCover] 🎨 2nd cover score: ${altScore}/10 (template: ${altTemplateId})`);
      }
    } catch (cover2Err) {
      console.log(`[AutoCover] ⚠️ 2nd cover generation failed (non-critical): ${cover2Err.message?.substring(0, 80)}`);
      // Non-critical — proceed with single cover
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[AutoCover] ✅ Complete! Score: ${score}/10, Time: ${elapsed}s, Template: ${chosenTemplate}${cover2Data ? `, 2nd: ${cover2Data.templateUsed} (${cover2Data.score}/10)` : ''}`);

    // สร้าง newsHash สำหรับ regenerate
    let newsHash = '';
    try {
      const { generateNewsHash } = await import('@/lib/services/imageCacheService');
      newsHash = generateNewsHash(newsTitle || content?.substring(0, 100));
    } catch {}

    // ★ Build covers array (cover1 always first, cover2 if available)
    const covers = [
      { base64, templateUsed: chosenTemplate, score },
    ];
    if (cover2Data) {
      covers.push(cover2Data);
    }

    return NextResponse.json({
      success: true,
      // ★ New: covers array for comparison UI
      covers,
      // ★ Backward compat: keep original flat fields
      base64,
      templateUsed: chosenTemplate,
      imageCount: orderedBuffers.length,
      score,
      elapsed: `${elapsed}s`,
      newsHash,
      cachedImages: imageBuffers.length,
      sessionId,
      identity: identity ? {
        characters: identity.characters,
        characterRoles: identity.characterRoles,
        mainCharacter: identity.mainCharacter,
        secondaryCharacter: identity.secondaryCharacter,
        emotion: identity.emotion,
        coverEmotion: identity.coverEmotion,
        keywords: identity.keywords,
        keyScenes: identity.keyScenes,
        searchQueries: identity.searchQueries,
        location: identity.location,
        story: identity.story,
      } : null,
      imageBank: {
        total: imageBuffers.length,
        selected: imageBuffers.filter(i => i.score >= 4 && i.role !== 'REJECT').length,
        rejected: imageBuffers.filter(i => i.role === 'REJECT' || i.score < 4).length,
      },
      // Gallery: ภาพทั้งหมดที่ค้นมา + role/score (thumbnail สร้างทีหลัง)
      gallery: imageBuffers.map((img, i) => {
        const fd = faceDataMap?.get?.(String(i));
        return {
          index: i,
          url: img.url || null,
          role: img.role || 'SUPPORT',
          score: img.score || 0,
          hasFace: fd?.hasFaces || false,
          faceCount: fd?.faceCount || 0,
          width: img.width || 0,
          height: img.height || 0,
        };
      }),
    });
  } catch (error) {
    console.error('[AutoCover] Pipeline error:', error.message);
    return NextResponse.json(
      { success: false, error: error.message, errorType: 'PIPELINE_ERROR' },
      { status: 500 }
    );
  }
}

// =============================================
// AI Slot Assignment — Role-based: เรียนรู้จากปกตัวอย่าง 5 ภาพ
// Slot 0 (Main): HERO_FACE — ใบหน้า closeup ชัด
// Slot 1 (Top-right): CONTEXT_SCENE — สถานที่/เหตุการณ์
// Highlight: EVIDENCE — ป้าย/เอกสาร/หลักฐาน
// Bottom: EMOTION — อารมณ์/reaction
// Circle: RELATIONSHIP — ความสัมพันธ์/ภาพคู่
// =============================================
async function assignImagesToSlots(imageBuffers, faceDataMap, templateId, identity, coverReferences, options = {}) {
  try {
    let slotCount = 4;
    let hasCircle = false;
    let hasCircleSmall = false;
    try {
      const { getTemplateById, normalizeTemplate } = await import('@/lib/coverTemplateRegistry');
      let tmpl = getTemplateById(templateId);
      // ★ Fallback: user template
      if (!tmpl) {
        try {
          const { getTemplate } = await import('@/lib/template-library/store');
          const userTmpl = await getTemplate(templateId);
          if (userTmpl) tmpl = normalizeTemplate(userTmpl);
        } catch {}
      }
      if (tmpl) {
        slotCount = tmpl.slots.length;
        hasCircle = !!tmpl.circle;
        hasCircleSmall = !!tmpl.circleSmall;
      }
    } catch {}

    // จัดกลุ่มภาพตาม role
    const byRole = {
      HERO_FACE: [],
      HERO: [],
      CONTEXT_SCENE: [],
      EVIDENCE: [],
      EMOTION: [],
      RELATIONSHIP: [],
      FAMILY_SUPPORT: [],
      SUPPORT: [],
    };

    imageBuffers.forEach((img, i) => {
      const role = img.role || 'SUPPORT';
      const faceData = faceDataMap.get(String(i)) || { hasFaces: false, faceCount: 0 };
      
      if (role === 'HERO_FACE' || role === 'HERO') {
        byRole.HERO_FACE.push({ index: i, faceData, role });
      } else if (role === 'CONTEXT_SCENE') {
        byRole.CONTEXT_SCENE.push({ index: i, faceData, role });
      } else if (role === 'EVIDENCE') {
        byRole.EVIDENCE.push({ index: i, faceData, role });
      } else if (role === 'EMOTION') {
        byRole.EMOTION.push({ index: i, faceData, role });
      } else if (role === 'RELATIONSHIP') {
        byRole.RELATIONSHIP.push({ index: i, faceData, role });
      } else if (role === 'FAMILY_SUPPORT') {
        byRole.FAMILY_SUPPORT.push({ index: i, faceData, role });
      } else {
        byRole.SUPPORT.push({ index: i, faceData, role });
      }
    });

    // ถ้าไม่มี role-based images (Judge เก่ายังไม่ให้ role ใหม่) → fallback เป็น heuristic
    const hasRoles = byRole.HERO_FACE.length > 0 || byRole.CONTEXT_SCENE.length > 0;

    let heroIndex, circleIndex, circleSmallIndex;
    let photoOrder = [];

    if (hasRoles) {
      // === Role-based assignment ===
      
      // Hero: ภาพ HERO_FACE ที่มีหน้าชัดที่สุด (faceCount === 1 ดีสุด)
      const heroCandidates = [...byRole.HERO_FACE, ...byRole.HERO];
      if (heroCandidates.length > 0) {
        heroCandidates.sort((a, b) => {
          const aFace = a.faceData.faceCount === 1 ? 100 : (a.faceData.hasFaces ? 50 : 0);
          const bFace = b.faceData.faceCount === 1 ? 100 : (b.faceData.hasFaces ? 50 : 0);
          return bFace - aFace;
        });
        // ★ shuffleHero: ใช้ภาพตัวที่ 2 เป็น hero (สลับกับ cover แรก)
        if (options.shuffleHero && heroCandidates.length > 1) {
          heroIndex = heroCandidates[1].index;
        } else {
          heroIndex = heroCandidates[0].index;
        }
      } else {
        // ไม่มี HERO → หาภาพที่มีหน้า 1 คนชัดสุด
        const withFace = imageBuffers.map((img, i) => ({
          index: i,
          faceData: faceDataMap.get(String(i)) || { hasFaces: false },
        })).filter(x => x.faceData.hasFaces).sort((a, b) => {
          return (a.faceData.faceCount === 1 ? 100 : 0) - (b.faceData.faceCount === 1 ? 100 : 0);
        });
        heroIndex = withFace.length > 0 ? withFace[withFace.length - 1].index : 0;
      }

      // Circle: RELATIONSHIP ถ้ามี, ถ้าไม่มีใช้ภาพ HERO_FACE ตัวที่ 2
      if (hasCircle) {
        if (byRole.RELATIONSHIP.length > 0) {
          circleIndex = byRole.RELATIONSHIP[0].index;
        } else if (heroCandidates.length > 1) {
          circleIndex = heroCandidates[1].index;
        } else {
          // ใช้ภาพที่มีหน้า (ไม่ใช่ hero)
          const otherFace = imageBuffers.map((_, i) => i)
            .filter(i => i !== heroIndex && (faceDataMap.get(String(i))?.hasFaces));
          circleIndex = otherFace.length > 0 ? otherFace[0] : (heroIndex === 0 ? 1 : 0);
        }
      }

      // CircleSmall
      if (hasCircleSmall) {
        const candidates = [...byRole.EMOTION, ...byRole.SUPPORT]
          .filter(x => x.index !== heroIndex && x.index !== circleIndex);
        circleSmallIndex = candidates.length > 0 ? candidates[0].index : undefined;
      }

      // PhotoOrder: [Hero, Context/Evidence/Emotion/Support...]
      const usedIndices = new Set([heroIndex]);
      if (circleIndex !== undefined) usedIndices.add(circleIndex);
      if (circleSmallIndex !== undefined) usedIndices.add(circleSmallIndex);

      // เรียงลำดับ slots: Context → Evidence → Family → Emotion → Support
      const slotQueue = [
        ...byRole.CONTEXT_SCENE.slice(0, 2), // จำกัด context ไม่เกิน 2
        ...byRole.EVIDENCE,
        ...byRole.FAMILY_SUPPORT, // ★ ภาพครอบครัว/พ่อแม่
        ...byRole.EMOTION,
        ...byRole.SUPPORT,
        ...byRole.RELATIONSHIP.slice(1), // relationship ตัวแรกไป circle แล้ว
        ...byRole.CONTEXT_SCENE.slice(2), // context เกิน 2 ใส่ท้ายๆ
      ].filter(x => !usedIndices.has(x.index)).map(x => x.index);

      photoOrder = [heroIndex, ...slotQueue.slice(0, slotCount - 1)];
    } else {
      // === Fallback: Heuristic scoring (เหมือนเดิม) ===
      const scored = imageBuffers.map((img, i) => {
        const faceData = faceDataMap.get(String(i)) || { hasFaces: false, faceCount: 0 };
        let score = 0;
        if (faceData.hasFaces) score += 30;
        if (faceData.faceCount === 1) score += 20;
        if (faceData.faceCount > 1) score += 10;
        if (img.role === 'HERO') score += 50;
        return { index: i, score, hasFace: faceData.hasFaces };
      });
      scored.sort((a, b) => b.score - a.score);

      heroIndex = scored[0]?.index ?? 0;
      
      const circleCandidates = scored.filter(s => s.index !== heroIndex && s.hasFace);
      circleIndex = hasCircle
        ? (circleCandidates.length > 0 ? circleCandidates[0].index : (scored[1]?.index ?? 1))
        : undefined;
      circleSmallIndex = hasCircleSmall
        ? (circleCandidates.length > 1 ? circleCandidates[1].index : (scored[2]?.index ?? 2))
        : undefined;

      const usedIndices = new Set([heroIndex]);
      if (circleIndex !== undefined) usedIndices.add(circleIndex);
      if (circleSmallIndex !== undefined) usedIndices.add(circleSmallIndex);

      const remaining = scored.filter(s => !usedIndices.has(s.index)).map(s => s.index);
      photoOrder = [heroIndex, ...remaining.slice(0, slotCount - 1)];
    }

    // ★ ห้าม pad ด้วยภาพซ้ำ — ถ้าภาพไม่พอให้เว้น slot
    // ถ้า photoOrder มีไม่ครบ ให้ใช้เท่าที่มี ไม่ loop ซ้ำ
    if (photoOrder.length < slotCount) {
      console.log(`[assignSlots] ⚠️ Only ${photoOrder.length}/${slotCount} unique images — slots จะเว้นว่างแทนการซ้ำ`);
    }

    console.log(`[assignSlots] Hero: ${heroIndex}, Circle: ${circleIndex}, CircleSmall: ${circleSmallIndex}`);
    console.log(`[assignSlots] PhotoOrder (${slotCount} slots): ${JSON.stringify(photoOrder)}`);
    console.log(`[assignSlots] Roles: HERO=${byRole.HERO_FACE.length}, SCENE=${byRole.CONTEXT_SCENE.length}, EVIDENCE=${byRole.EVIDENCE.length}, EMOTION=${byRole.EMOTION.length}`);

    return {
      photoOrder,
      circleIndex: circleIndex !== undefined ? circleIndex : 0,
      circleSmallIndex,
      heroIndex,
    };
  } catch (err) {
    console.error('[assignImagesToSlots] Error:', err.message);
    return {
      photoOrder: imageBuffers.map((_, i) => i).slice(0, 6),
      circleIndex: 0,
      circleSmallIndex: undefined,
      heroIndex: 0,
    };
  }
}
