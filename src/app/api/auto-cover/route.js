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
import { MODEL_VISION } from '@/lib/ai/modelConfig';
import sharp from 'sharp';

export const maxDuration = 300; // 5 minutes — cover pipeline needs 70-120s normally

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
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `You are an elite news Art Director evaluating a composed 1200x1350 news cover for: "${newsTitle}".

Evaluate:
1. Is the main subject clearly visible?
2. Are background images diverse (not the same photo repeated)?
3. Is the composition balanced and professional?
4. Is the overall quality high (not cheap-looking)?

Score 1-10. Return ONLY valid JSON without any markdown: {"score": 8, "reason": "brief"}. Do NOT wrap in code blocks.`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64Image, mimeType: 'image/jpeg' } }
    ]);
    const responseText = result.response.text().trim();
    // Support both raw JSON and markdown-wrapped JSON
    const match = responseText.match(/```(?:json)?\s*({[\s\S]*?})\s*```/) ||
                  responseText.match(/({[\s\S]*?"score"[\s\S]*?})/);
    if (match) {
      const data = JSON.parse(match[1] || match[0]);
      const score = parseInt(data.score, 10);
      if (score >= 1 && score <= 10) {
        console.log(`[AutoCover Judge] ✅ Score: ${score}/10 — ${data.reason}`);
        return score;
      }
    }
    console.log('[AutoCover Judge] ⚠️ Could not parse score from response:', responseText.slice(0, 100));
    return null;
  } catch (e) {
    console.log('[AutoCover Judge] Evaluation error:', e.message);
    return null;
  }
}

export async function POST(request) {
  const startTime = Date.now();
  const TIMEOUT_MS = 280_000; // 280s safety — pipeline needs 70-120s, allow buffer for slow AI/network

  try {
    const body = await request.json();
    const { content, newsTitle, templateId = 'auto', sourceUrl = '', regenerate = false, caseId: bodyCaseId } = body;

    if (!content && !newsTitle) {
      return NextResponse.json(
        { success: false, error: 'ต้องระบุ content หรือ newsTitle', errorType: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    console.log('[AutoCover] Starting pipeline...');
    console.log(`[AutoCover] Title: ${(newsTitle || '').substring(0, 80)}`);
    console.log(`[AutoCover] Template: ${templateId}, Regenerate: ${regenerate}`);

    // Step 1: Analyze story identity (extract keywords, characters, emotions)
    const { analyzeStoryIdentity } = await import('@/lib/services/storyIdentityService');

    // Build breakdown data from content — ★ สกัดชื่อคนจาก content ก่อนส่ง
    const contentText = content || '';
    const titleText = newsTitle || '';
    // ดึงชื่อคนจากเนื้อหา (ชื่อไทย 2-4 พยางค์ หรือชื่อต่างชาติ)
    const extractedPeople = [];
    // หาชื่อที่ถูก quote หรืออยู่ในตำแหน่งสำคัญ
    const nameMatches = (titleText + ' ' + contentText.substring(0, 1000)).match(/[\u0E00-\u0E7F]{2,}(?:\s[\u0E00-\u0E7F]{2,}){0,2}/g);
    if (nameMatches) {
      // เอาคำที่ยาว 2-6 คำ มาเป็น candidate
      for (const match of nameMatches.slice(0, 10)) {
        if (match.length >= 4 && !extractedPeople.includes(match)) {
          extractedPeople.push(match);
        }
      }
    }
    
    const breakdownData = {
      core_story: contentText.substring(0, 3000) || titleText, // ★ เพิ่มเป็น 3000 chars เพื่อให้ AI สร้าง search queries ที่แม่นขึ้น
      key_facts: {
        people: extractedPeople.slice(0, 5), // ★ ส่งชื่อคนจริง
      },
    };

    let identity = await analyzeStoryIdentity(newsTitle || content?.substring(0, 100), breakdownData);

    // ★ Fallback: ถ้า Gemini 503/ล้มเหลว → สร้าง identity พื้นฐานจาก title
    if (!identity) {
      console.log('[AutoCover] ⚠️ AI identity failed — using fallback from title');
      const title = newsTitle || content?.substring(0, 100) || '';
      const fullText = `${title} ${(content || '').substring(0, 500)}`;
      const words = title.split(/[\s,]+/).filter(w => w.length > 1);
      const mainChar = words.slice(0, 3).join(' ') || 'ข่าว';
      
      // ★ ดึงชื่อสถานที่/องค์กรสำคัญจากเนื้อหา
      const locationPatterns = [
        /โรงเรียน[\u0E00-\u0E7F\s]{2,20}/g,
        /โรงพยาบาล[\u0E00-\u0E7F\s]{2,20}/g,
        /วัด[\u0E00-\u0E7F\s]{2,15}/g,
        /จังหวัด[\u0E00-\u0E7F\s]{2,15}/g,
        /มูลนิธิ[\u0E00-\u0E7F\s]{2,20}/g,
      ];
      const foundLocations = [];
      for (const pat of locationPatterns) {
        const m = fullText.match(pat);
        if (m) foundLocations.push(...m.map(s => s.trim()));
      }
      
      // ★ ดึง keywords กิจกรรมจากเนื้อหา
      const activityKeywords = ['บริจาค', 'มอบเงิน', 'สร้าง', 'ช่วย', 'ให้ทุน', 'บวช', 'แต่งงาน', 'หย่า', 
        'เสียชีวิต', 'ป่วย', 'อุบัติเหตุ', 'จับ', 'ฟ้อง', 'แจ้งความ', 'ชนะ', 'แพ้', 'เปิดตัว'];
      const foundActivities = activityKeywords.filter(kw => fullText.includes(kw));
      
      // ★ สร้าง search queries ที่ผูกกับเนื้อข่าวโดยตรง
      const locationStr = foundLocations[0] || '';
      const activityStr = foundActivities.join(' ');
      
      identity = {
        characters: [mainChar],
        mainCharacter: mainChar,
        secondaryCharacter: '',
        story: title,
        emotion: 'neutral',
        coverEmotion: 'drama',
        location: locationStr,
        keywords: words.slice(0, 8),
        keyScenes: [],
        searchQueries: {
          person_portrait: mainChar,
          person_closeup: `${mainChar} ภาพถ่ายหน้าชัด`,
          // ★ context ใช้ title + สถานที่ + กิจกรรม
          person_context: `${mainChar} ${locationStr} ${activityStr}`.trim().substring(0, 80),
          event_scene: `${mainChar} ${activityStr} ${locationStr}`.trim().substring(0, 60),
          emotion_moment: `${mainChar} ${foundActivities[0] || ''}`.trim(),
          location_photo: locationStr,
          // ★ เพิ่ม key_activity ที่ตรงกับเนื้อข่าว!
          key_activity: `${mainChar} ${activityStr}`.trim(),
          key_relationship: `${mainChar} ${locationStr}`.trim(),
        },
        searchGoogle: `${mainChar} ${locationStr} ${activityStr}`.trim().substring(0, 80),
        searchYouTube: `${mainChar} ${activityStr} ${locationStr}`.trim().substring(0, 60),
        searchPexels: foundActivities.length > 0 ? `${foundActivities[0]} charity event` : 'news event person',
        typography: { hook: 'ด่วน!', main: title.substring(0, 30), punch: '' },
      };
    }

    // ★ Detailed logging of searchQueries for debugging
    console.log(`[AutoCover] Identity: ${identity.mainCharacter}, emotion: ${identity.emotion}`);
    console.log(`[AutoCover] Characters: ${JSON.stringify(identity.characters)}`);
    console.log(`[AutoCover] Location: ${identity.location || 'N/A'}`);
    if (identity.searchQueries) {
      const sq = identity.searchQueries;
      console.log(`[AutoCover] 🔍 SearchQueries:`);
      console.log(`  person_closeup: "${sq.person_closeup || 'N/A'}"`);
      console.log(`  person_portrait: "${sq.person_portrait || 'N/A'}"`);
      console.log(`  event_scene: "${sq.event_scene || 'N/A'}"`);
      console.log(`  location_photo: "${sq.location_photo || 'N/A'}"`);
      console.log(`  emotion_moment: "${sq.emotion_moment || 'N/A'}"`);
      console.log(`  related_people: "${sq.related_people || 'N/A'}"`);
    }
    console.log(`[AutoCover] Google: "${identity.searchGoogle || 'N/A'}"`);
    console.log(`[AutoCover] YouTube: "${identity.searchYouTube || 'N/A'}"`);
    console.log(`[AutoCover] Keywords: ${JSON.stringify(identity.keywords || [])}`);
    console.log(`[AutoCover] KeyScenes: ${JSON.stringify(identity.keyScenes || [])}`);
    console.log(`[AutoCover] People sent to AI: ${JSON.stringify(breakdownData.key_facts.people)}`);

    // ★ Inject full newsContent into identity for Vision Judge
    if (identity) {
      identity._newsContent = (content || '').slice(0, 2000);
      identity._newsTitle = newsTitle || '';
    }

    // ═══════════════════════════════════════════════════════
    // Step 1.5: Entity Resolver — ค้นหา Social Profile ของตัวละครหลัก
    // ═══════════════════════════════════════════════════════
    let entityData = { found: false, warning: null };
    let resolvedRelationships = { hero: { name: identity?.mainCharacter || '', searchName: identity?.mainCharacter || '' }, relationships: [], evidenceCategories: ['hero', 'interview'] };
    let coverPlan = null;
    let evidencePool = {};
    let evidencePoolTotal = 0;

    try {
      if (identity?.mainCharacter) {
        console.log(`[AutoCover] 🔍 Step 1.5: Entity Resolver → "${identity.mainCharacter}"`);
        const { resolveEntity } = await import('@/lib/services/entityResolverService');
        entityData = await resolveEntity(identity.mainCharacter, newsTitle || '');
        if (entityData.warning) console.log(`[AutoCover] ⚠️ Entity: ${entityData.warning}`);
      } else {
        entityData.warning = 'storyIdentity ไม่สามารถระบุตัวละครหลักได้จากข่าวนี้';
        console.log('[AutoCover] ⚠️ No mainCharacter — skipping Entity Resolver');
      }
    } catch (entityErr) {
      console.error('[AutoCover] Entity Resolver failed (non-critical):', entityErr.message);
      entityData = { found: false, warning: `Entity Resolver error: ${entityErr.message}` };
    }

    // ═══════════════════════════════════════════════════════
    // Step 1.6: Relationship Resolver — วิเคราะห์ตัวละครและความสัมพันธ์ในข่าว
    // ═══════════════════════════════════════════════════════
    try {
      if (identity?.mainCharacter) {
        console.log('[AutoCover] 👥 Step 1.6: Relationship Resolver...');
        const { resolveRelationships } = await import('@/lib/services/relationshipResolverService');
        resolvedRelationships = await resolveRelationships(identity, content || '');
        console.log(`[AutoCover] 👥 Relationships: ${resolvedRelationships.relationships?.length || 0} found, categories: ${(resolvedRelationships.evidenceCategories || []).join(', ')}`);
      }
    } catch (relErr) {
      console.error('[AutoCover] Relationship Resolver failed (non-critical):', relErr.message);
    }

    // Step 2: Multi-agent image search (parallel กับ Step 1.7–1.8)
    const { runMultiAgentImageSearch } = await import('@/lib/services/multiAgentImageScraper');

    // ★ Run Step 1.7 (CoverPlanner) + Step 1.8 (EvidenceLibrary) + Step 2 (MultiAgent) แบบ parallel
    const [multiAgentResult, evidenceResult] = await Promise.allSettled([
      // Step 2: Multi-agent image search (keyword-based เหมือนเดิม)
      runMultiAgentImageSearch(
        sourceUrl || '',
        sourceUrl ? 'url' : 'text',
        identity.characters || [],
        newsTitle || content?.substring(0, 100),
        identity
      ),
      // Step 1.7 + 1.8: CoverPlanner + EvidenceLibrary (entity-first)
      (async () => {
        try {
          // Step 1.7: Cover Planner — วางแผน slot-to-category mapping
          // (ต้องรู้ chosenTemplate ก่อน — แต่ตอนนี้ยังไม่รู้ เลยใช้ templateId จาก body หรือ 'auto')
          // ★ ถ้า templateId='auto' → ใช้ fallback plan ก่อน (จะ refine หลัง autoSelectTemplate)
          const planTemplateId = templateId !== 'auto' ? templateId : 'template_5';
          console.log(`[AutoCover] 📋 Step 1.7: Cover Planner → template: ${planTemplateId}`);
          const { planCoverLayout } = await import('@/lib/services/coverPlannerService');
          coverPlan = await planCoverLayout(resolvedRelationships, planTemplateId, identity);
          console.log(`[AutoCover] 📋 Cover Plan: ${coverPlan.slots?.length || 0} slots mapped (source: ${coverPlan.source})`);

          // Step 1.8: Evidence Library — ค้นภาพแยกตาม category
          console.log('[AutoCover] 📚 Step 1.8: Evidence Library...');
          const { buildEvidenceLibrary } = await import('@/lib/services/evidenceLibrary');
          const evLib = await buildEvidenceLibrary(resolvedRelationships, identity);
          evidencePoolTotal = evLib.totalCount || 0;
          evidencePool = evLib._raw || {};
          console.log(`[AutoCover] 📚 Evidence Library: ${evidencePoolTotal} images across ${Object.keys(evidencePool).length} categories`);
          return evLib;
        } catch (evErr) {
          console.error('[AutoCover] Evidence pipeline failed (non-critical):', evErr.message);
          return null;
        }
      })()
    ]);

    // แยก results
    const multiAgentImages = multiAgentResult.status === 'fulfilled' ? (multiAgentResult.value || []) : [];
    if (multiAgentResult.status === 'rejected') {
      console.error('[AutoCover] MultiAgent search failed:', multiAgentResult.reason?.message);
    }

    // ═══════════════════════════════════════════════════════
    // Step 2.5: Merge Entity-First images (priority) + MultiAgent images (fallback)
    // ═══════════════════════════════════════════════════════
    const entityFirstImages = [];
    if (evidencePoolTotal > 0) {
      // แปลง evidencePool → format เดียวกับ bestImages (จาก multiAgent Judge)
      // evidencePool[category] = [{imageUrl, query, category, entityName, ...}]
      // bestImages format: [{url, role, score}]
      const catToRole = {
        hero: 'HERO_FACE',
        mother: 'RELATIONSHIP', father: 'RELATIONSHIP', sibling: 'RELATIONSHIP',
        child: 'RELATIONSHIP', spouse: 'RELATIONSHIP', partner: 'RELATIONSHIP',
        caregiving: 'KEY_ACTIVITY', activity: 'KEY_ACTIVITY', work: 'KEY_ACTIVITY',
        interview: 'PERSON_SUPPORT',
        location: 'CONTEXT_SCENE', evidence: 'EVIDENCE',
        relationship: 'RELATIONSHIP', family: 'RELATIONSHIP',
      };

      for (const [cat, imgs] of Object.entries(evidencePool)) {
        const role = catToRole[cat] || 'PERSON_SUPPORT';
        for (const img of (imgs || [])) {
          if (img.imageUrl) {
            entityFirstImages.push({
              url: img.imageUrl,
              role,
              score: cat === 'hero' ? 9 : 7, // entity-first images ได้ score สูงกว่า
              source: 'entity_first',
              evidenceCat: cat,
            });
          }
        }
      }
      console.log(`[AutoCover] 🔀 Step 2.5: Merged ${entityFirstImages.length} entity-first + ${multiAgentImages.length} multiAgent images`);
    }

    // รวม: entity-first มาก่อน (priority) → multiAgent ตามหลัง
    const bestImages = [...entityFirstImages, ...multiAgentImages];

    if (!bestImages || bestImages.length === 0) {
      return NextResponse.json(
        { success: false, error: 'ไม่พบภาพที่เหมาะสม', errorType: 'NO_IMAGES_FOUND', status: 'NEED_MANUAL_COVER' },
        { status: 422 }
      );
    }

    console.log(`[AutoCover] Found ${bestImages.length} images`);

    // Step 3: Download + validate + dedup
    const { downloadAndValidateImage } = await import('@/lib/services/imageSearchService');

    const imageBuffers = [];
    const imageHashes = [];
    // ★★★ เรียงลำดับ: HERO_FACE → KEY_ACTIVITY → CONTEXT_SCENE → EVIDENCE → RELATIONSHIP → TIMELINE_PAST → EMOTION → PERSON_SUPPORT
    // ภาพเล่าเรื่อง (KEY_ACTIVITY, CONTEXT_SCENE) ต้องถูก download ก่อนภาพสวย (PERSON_SUPPORT)!
    const rolePriority = { 
      'HERO_FACE': 0, 'HERO': 1, 
      'KEY_ACTIVITY': 2,    // ★ สำคัญมาก! ภาพกิจกรรมหลักในข่าว
      'CONTEXT_SCENE': 3,   // ★ ภาพสถานที่/บริบทข่าว
      'EVIDENCE': 4, 
      'RELATIONSHIP': 5,    // ภาพความสัมพันธ์
      'TIMELINE_PAST': 6,
      'EMOTION': 7, 
      'PERSON_SUPPORT': 8,  // ★ ต่ำสุด! ภาพหน้าคนทั่วไป download ทีหลัง
      'SUPPORT': 9 
    };
    const orderedImages = [...bestImages].sort((a, b) => {
      const pA = rolePriority[a.role] ?? 8;
      const pB = rolePriority[b.role] ?? 8;
      if (pA !== pB) return pA - pB;
      // ★ Same priority → เรียงตาม score สูง→ต่ำ
      return (b.score || 0) - (a.score || 0);
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
     // Emergency: ค้นจาก identity — เน้นภาพตรงประเด็นข่าว ไม่ใช่ภาพคนดังทั่วไป
      if (identity?.mainCharacter) {
        const mc = identity.mainCharacter;
        const sq = identity.searchQueries || {};
        const sd = identity.specific_details || {};
        
        // ★ สร้าง query ที่เฉพาะเจาะจงกับข่าว ไม่ใช่ค้นคนดังกว้างๆ
        const emergencyQueries = [
          // Query 1: ภาพหน้าชัดของบุคคลหลัก (สำคัญสุด)
          sq.person_closeup || `${mc} ภาพถ่ายหน้าชัด`,
          // Query 2: สถานที่ในข่าว (ถ้ามี)
          ...(sd.place_names || []).slice(0, 2).map(p => `${p} ภาพ`),
          // Query 3: เหตุการณ์ + บริบท
          sq.person_context || sq.event_scene || `${mc} ${identity.story?.substring(0, 20) || ''}`,
          // Query 4: location
          identity.location ? `${identity.location} ภาพ` : '',
        ].filter(q => q.trim());
        
        const serperKey = process.env.SERPER_API_KEY;
        if (serperKey) {
          for (const eq of emergencyQueries) {
            if (imageBuffers.length >= 6) break;
            try {
              console.log(`[Emergency] 🔍 Searching: "${eq}"`);
              const res = await fetch('https://google.serper.dev/images', {
                method: 'POST',
                headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ q: `${eq} -ปก -cover -thumbnail -watermark`, gl: 'th', hl: 'th', num: 8, imgSize: 'large', imgType: 'photo' })
              });
              if (res.ok) {
                const data = await res.json();
                for (const img of (data.images || [])) {
                  if (imageBuffers.length >= 8) break;
                  try {
                    const { downloadAndValidateImage } = await import('@/lib/services/imageSearchService');
                    const buf = await downloadAndValidateImage(img.imageUrl);
                    if (!buf) continue;
                    const hash = await computeImageHash(buf);
                    const isDup = imageHashes.some(h => hammingDistance(hash, h) < 12);
                    if (isDup) continue;
                    const imgMeta = await sharp(buf).metadata().catch(() => ({}));
                    imageHashes.push(hash);
                    imageBuffers.push({ buffer: buf, role: 'SUPPORT', url: img.imageUrl, score: 5, width: imgMeta.width || 0, height: imgMeta.height || 0 });
                    console.log(`[Emergency] ✅ Found: ${imgMeta.width}x${imgMeta.height}`);
                  } catch {}
                }
              }
            } catch {}
          }
          console.log(`[Emergency] Total images now: ${imageBuffers.length}`);
        }
      }
    }

    if (imageBuffers.length < 2) {
      return NextResponse.json({
        success: false,
        error: `ภาพที่ใช้ได้มีแค่ ${imageBuffers.length} ภาพ (ต้องการอย่างน้อย 2)`,
        errorType: 'INSUFFICIENT_IMAGES',
        status: 'NEED_MANUAL_COVER',
        imageCount: imageBuffers.length,
      }, { status: 422 });
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
        chosenTemplate = 'template_5'; // fallback — safe general-purpose template
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
      const { getTemplateById } = await import('@/lib/coverTemplateRegistry');
      templateSpec = getTemplateById(chosenTemplate);
    } catch {}

    // ═══ Step 6.5: ★ AI Content Curator — วิเคราะห์เนื้อหา + ภาพ ก่อนเลือกลง slot ═══
    // "สมอง" ตัวที่ 2: ดูเนื้อข่าวทั้งหมด + ภาพทั้ง 8 → ตัดสินว่าภาพไหนตรงกับข่าวจริง
    try {
      const curatedOrder = await curateImagesForCover(
        imageBuffers, 
        newsTitle || content?.substring(0, 200), 
        content || newsTitle,
        identity,
        templateSpec
      );
      
      if (curatedOrder && curatedOrder.length > 0) {
        // ★ ปรับ role ตามผล AI Curator
        curatedOrder.forEach(item => {
          if (item.index < imageBuffers.length && item.recommendedRole) {
            const img = imageBuffers[item.index];
            const oldRole = img.role;
            img.role = item.recommendedRole;
            img.curatorScore = item.relevance || 0;
            if (oldRole !== item.recommendedRole) {
              console.log(`[Curator] Image #${item.index}: ${oldRole} → ${item.recommendedRole} (relevance: ${item.relevance}/10)`);
            }
          }
        });
        
        // ★ เรียงลำดับ imageBuffers ตาม curator relevance (สูงสุดมาก่อน)
        // ทำให้ assignSlots หยิบภาพที่ตรงกับข่าวก่อน
        const relevanceMap = new Map();
        curatedOrder.forEach(item => {
          relevanceMap.set(item.index, item.relevance || 0);
        });
        
        console.log(`[Curator] ✅ Curated ${curatedOrder.length} images by news relevance`);
      }
    } catch (curatorErr) {
      console.warn('[Curator] AI Content Curation failed (non-critical):', curatorErr.message);
      // ถ้า Curator ล้มเหลว → ใช้ role เดิมจาก Judge (ไม่พัง!)
    }

    // ★★★ Character Focus Rule: ถ้า heroImage ไม่มีหน้าคน (hasFaces=false)
    // และมีภาพอื่นที่มีหน้าคน + curatorScore สูงกว่า → swap heroImage
    // ป้องกันปัญหา: hero slot กลายเป็นภาพวิวทะเล/สถานที่ ไม่มีตัวละครหลัก
    {
      const heroCandidate = imageBuffers.find(img => img.role === 'HERO_FACE' || img.role === 'HERO');
      if (heroCandidate) {
        const heroIdx = imageBuffers.indexOf(heroCandidate);
        const heroFaceData = faceDataMap?.get?.(String(heroIdx));
        if (!heroFaceData?.hasFaces) {
          // Hero ไม่มีหน้าคน → หาภาพอื่นที่มีหน้าคน + curatorScore สูงสุด
          const faceImages = imageBuffers
            .map((img, i) => ({ img, i, fd: faceDataMap?.get?.(String(i)) }))
            .filter(({ i, img, fd }) => i !== heroIdx && fd?.hasFaces && (img.curatorScore || 0) >= 5);
          
          if (faceImages.length > 0) {
            faceImages.sort((a, b) => (b.img.curatorScore || 0) - (a.img.curatorScore || 0));
            const best = faceImages[0];
            const oldRole = best.img.role;
            best.img.role = 'HERO_FACE';
            heroCandidate.role = oldRole || 'CONTEXT_SCENE';
            console.log(`[AutoCover] 🔄 Character Focus Rule: swapped hero #${heroIdx} (no face) ↔ image #${best.i} (${oldRole}, score: ${best.img.curatorScore}) — now hero has face`);
          } else {
            console.log(`[AutoCover] ⚠️ Character Focus Rule: hero has no face, but no better face-image found (min score 5)`);
          }
        }
      }
    }

    // Timeout check before Step 7
    if (Date.now() - startTime > TIMEOUT_MS) {
      return NextResponse.json({ success: false, error: 'Pipeline timeout', errorType: 'TIMEOUT' }, { status: 504 });
    }

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
    let score = 7; // Default fallback
    try {
      const judgeScore = await evaluateFinalCover(coverBuffer.toString('base64'), newsTitle || '');
      if (judgeScore !== null) {
        score = judgeScore;
        console.log(`[AutoCover] 🏆 AI Judge score: ${score}/10`);
      } else {
        // Dynamic fallback: average of curator relevance scores
        const scoredImages = assignedImages || selectedImages || [];
        if (scoredImages.length > 0) {
          const avg = scoredImages.reduce((sum, img) => sum + (img.curatorScore || img.relevanceScore || img.score || 5), 0) / scoredImages.length;
          score = Math.round(Math.min(9, Math.max(4, avg)));
          console.log(`[AutoCover] ⚠️ Judge parse failed, curator avg fallback: ${score}/10`);
        } else {
          console.log('[AutoCover] ⚠️ Judge failed, using default score: 7/10');
        }
      }
    } catch {
      // Keep default score 7
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[AutoCover] ✅ Complete! Score: ${score}/10, Time: ${elapsed}s, Template: ${chosenTemplate}`);

    // สร้าง newsHash สำหรับ regenerate
    let newsHash = '';
    try {
      const { generateNewsHash } = await import('@/lib/services/imageCacheService');
      newsHash = generateNewsHash(newsTitle || content?.substring(0, 100));
    } catch {}

    // Step 9: Save to Case Archive
    let caseResult = null;
    try {
      const { saveCase } = await import('@/lib/services/coverCaseArchive');
      caseResult = await saveCase(coverBuffer, {
        newsTitle: newsTitle || content?.substring(0, 100),
        content: content || '',
        score,
        templateUsed: chosenTemplate,
        elapsed: `${elapsed}s`,
        imageCount: imageBuffers.length,
        newsUrl: sourceUrl || '',
        identity: {
          mainCharacter: identity?.mainCharacter || '',
          emotion: identity?.emotion || '',
          coverEmotion: identity?.coverEmotion || '',
        },
        batchId: body.batchId || null,
      });
      console.log(`[AutoCover] 📁 Saved as ${caseResult.caseId}`);
    } catch (e) {
      console.log(`[AutoCover] ⚠️ Case archive save failed: ${e.message}`);
    }

    // ★ Step 10: Auto-save ปกเข้า "คลังปก" (cover_examples) — fire-and-forget ★
    // ไม่ block response หลัก, ถ้า save ล้มเหลวจะ log warning เท่านั้น
    try {
      const { saveGeneratedCoverToLibrary } = await import('@/lib/services/coverLibrarySaver');
      const finalCaseId = caseResult?.caseId || bodyCaseId || null;
      const subjects = identity?.characters?.slice(0, 5) || [
        identity?.mainCharacter,
        identity?.secondaryCharacter,
      ].filter(Boolean);

      console.log(`[AutoCover] 📚 Step 10: Saving to cover library... caseId=${finalCaseId}, subjects=${JSON.stringify(subjects)}`);
      
      saveGeneratedCoverToLibrary({
        coverBuffer,
        templateId: chosenTemplate,
        newsTitle: newsTitle || content?.substring(0, 100) || '',
        newsUrl: sourceUrl || '',
        newsBody: content || '',
        caseId: finalCaseId,
        score,
        subjects,
        emotion: identity?.coverEmotion || identity?.emotion || '',
        imageCount: imageBuffers.length,
      }).then((result) => {
        if (result?.success) {
          console.log(`[AutoCover] ✅ Cover library auto-save SUCCESS: id=${result.id}, version=${result.version || 1}`);
        } else {
          console.warn(`[AutoCover] ⚠️ Cover library auto-save returned error: ${result?.error || 'unknown'}`);
        }
      }).catch((err) =>
        console.warn('[AutoCover] ⚠️ Cover library auto-save error:', err?.message)
      );
    } catch (libErr) {
      // ห้าม throw — ไม่กระทบ response หลัก
      console.warn('[AutoCover] ⚠️ Cover library import error:', libErr?.message);
    }

    return NextResponse.json({
      success: true,
      base64,
      templateUsed: chosenTemplate,
      imageCount: imageBuffers.length,
      score,
      elapsed: `${elapsed}s`,
      newsHash,
      cachedImages: imageBuffers.length,
      caseId: caseResult?.caseId || null,
      entityFound: entityData?.found || false,
      entityWarning: entityData?.warning || null,
      evidenceCategories: resolvedRelationships?.evidenceCategories || [],
      evidenceImageCount: evidencePoolTotal || 0,
      identity: {
        mainCharacter: identity.mainCharacter,
        emotion: identity.emotion,
        coverEmotion: identity.coverEmotion,
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
// ★ AI Content Curator — "สมอง" ดูเนื้อหา + ภาพ ก่อนเลือกลง slot
// ดูภาพทั้งหมดที่ดาวน์โหลดมา + เนื้อข่าว → ตัดสินว่าภาพไหนตรงกับข่าวจริง
// =============================================
async function curateImagesForCover(imageBuffers, newsTitle, newsContent, identity, templateSpec) {
  try {
    if (!imageBuffers || imageBuffers.length < 2) return null;
    
    const { callAI } = await import('@/lib/ai/openai');
    
    // สร้าง thumbnail ขนาดเล็กสำหรับ Vision API
    const thumbnails = [];
    for (let i = 0; i < Math.min(imageBuffers.length, 8); i++) {
      try {
        const thumb = await sharp(imageBuffers[i].buffer)
          .resize(300, 300, { fit: 'cover' })
          .jpeg({ quality: 60 })
          .toBuffer();
        thumbnails.push({
          index: i,
          base64: thumb.toString('base64'),
          currentRole: imageBuffers[i].role || 'SUPPORT',
          url: imageBuffers[i].url || '',
        });
      } catch {
        // skip failed thumbnails
      }
    }
    
    if (thumbnails.length < 2) return null;
    
    // สร้าง slot description จาก template
    const slotDesc = templateSpec?.slots?.map(s => `${s.id} (${s.role})`).join(', ') || 'main (hero), bg_top (scene), bg_bottom (scene/emotion), highlight';
    const hasCircle = !!templateSpec?.circle;
    
    // ★ สร้าง imageContents array สำหรับ Vision API
    const imageContents = thumbnails.map((t, idx) => ({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${t.base64}`, detail: 'low' }
    }));
    
    // ★ Prompt: AI ดูเนื้อข่าว + ภาพ แล้วจัดลำดับ — เน้น "เล่าเรื่องผ่านภาพ"
    // ★ Inject subjects (characters) into prompt for subject-matching
    const subjectsForPrompt = [
      identity?.mainCharacter,
      identity?.secondaryCharacter,
      ...(identity?.characters || []),
    ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 5);
    const subjectsStr = subjectsForPrompt.length > 0
      ? subjectsForPrompt.join(', ')
      : 'ไม่ระบุ';
    const prompt = `คุณเป็น "Content Curator" สำหรับปกข่าวไวรัล
ดูภาพ ${thumbnails.length} ภาพด้านบน (ภาพ #0 ถึง #${thumbnails.length - 1} ตามลำดับ)

## เนื้อข่าว:
📰 หัวข้อข่าว: "${newsTitle || 'ไม่ระบุ'}"
📝 เนื้อข่าวย่อ: "${(newsContent || '').slice(0, 500)}"

## ★★★ Subjects หลัก (คนที่อยู่ในข่าว): ${subjectsStr}
คนอื่นที่ไม่เกี่ยวกับ subjects เหล่านี้ = คนแปลก → relevance <= 2!

## ตัวละครหลัก: ${identity?.mainCharacter || 'ไม่ระบุ'}
## สถานที่: ${identity?.location || 'ไม่ระบุ'}
## ประเด็นหลัก: ${identity?.keyScenes?.join(', ') || identity?.story?.substring(0, 100) || 'ไม่ระบุ'}

## Layout slots: ${slotDesc}${hasCircle ? ' + วงกลม (circle)' : ''}

## ★★★ หลักการสำคัญที่สุด: ภาพต้องเกี่ยวกับข่าว!
ปกข่าวไวรัลที่ดี ต้อง "เล่าเรื่อง" ผ่านภาพ — ไม่ใช่แค่เอาภาพสวยๆ ของคนมากอง!

★★★ กฎเหล็กเรื่อง RELEVANCE:
- Hero (1 ภาพ): อนุญาตให้ใช้ภาพ portrait สวยๆ ได้ แม้ไม่ตรงบริบทข่าว → score 8-10
- ภาพอื่นทั้งหมด: ★ ต้องเกี่ยวกับ "เนื้อหาข่าว" โดยตรง! ★
  - ภาพสวยแต่ไม่เกี่ยวข่าว (วิวทะเล, fashion, ท่องเที่ยว, ไลฟ์สไตล์) → score ≤ 3 เท่านั้น!
  - ภาพที่เกี่ยวกับข่าวโดยตรง (กิจกรรมในข่าว, สถานที่ในข่าว, คนในข่าว) → score ≥ 7

★★★ SCORING GUIDE — CHARACTER FOCUS:
Give HIGH score (8-10) to images that:
- Clearly show the main character's face (recognizable, close-up or medium-shot)
- Capture the KEY moment/emotion of this specific news event
- Are from the ACTUAL event (not generic stock, not old unrelated photos)

Give MEDIUM score (5-7) to images that:
- Show the main character but in unrelated context (old interview, fashion, lifestyle)
- Show the event location/activity WITHOUT the main character
- Show secondary characters related to the news

Give LOW score (1-4) to images that:
- Show only backgrounds/locations without any recognizable people
- Are generic stock photos unrelated to this specific person or event
- Are duplicate scenes of another already-scored image
- Show people who are NOT subjects of this news story
  
ตัวอย่าง: ข่าว "ก้อยรัชวิน บริจาค 5 แสนให้โรงเรียน"
- ภาพก้อยถ่ายริมทะเล → score 2 (สวยแต่ไม่เกี่ยวข่าว)
- ภาพก้อยแต่งตัวแฟชั่น → score 2 (สวยแต่ไม่เกี่ยวข่าว)
- ภาพก้อยกับเด็กนักเรียน → score 9 (เกี่ยวกับข่าวบริจาค)
- ภาพโรงเรียนบ้านขุนสมุทร → score 9 (สถานที่ในข่าว)
- ภาพก้อยมอบเงิน → score 10 (KEY_ACTIVITY ตรงข่าว)

ตัวอย่าง: ข่าว "น้องทาเรีย ลูกน้ำฝน สวยเหมือนแม่"
- ภาพน้ำฝนถ่ายคนเดียวที่ชายหาด → score 3 (ไม่เกี่ยว)
- ภาพน้ำฝนกับน้องทาเรีย → score 9 (RELATIONSHIP ตรงข่าว)
- ภาพน้องทาเรียหน้าชัด → score 10 (ตัวละครหลัก)
- ภาพน้ำฝนสมัยสาว → score 7 (เปรียบเทียบความสวย ตรงข่าว)

## Role ที่ใช้ได้:
- HERO_FACE: ภาพหน้าชัด closeup ตัวละครหลัก (ปัจจุบัน) — อนุญาตให้สวยๆ ไม่ตรงข่าวได้
- TIMELINE_PAST: ภาพตัวละครในอดีต/สมัยหนุ่มสาว
- RELATIONSHIP: ภาพตัวละครกับคนสำคัญในข่าว (ภรรยา, แฟน, ลูก)
- KEY_ACTIVITY: ภาพกิจกรรมหลักในข่าว (บริจาค, ทำสวน, ช่วยเด็ก)
- CONTEXT_SCENE: สถานที่/เหตุการณ์ในข่าว (โรงเรียน, ไร่, มูลนิธิ)
- EVIDENCE: หลักฐาน ป้าย เอกสาร
- EMOTION: ภาพอารมณ์ที่เกี่ยวกับข่าว (ร้องไห้, ยิ้ม)
- PERSON_SUPPORT: ภาพตัวละครในบริบทที่เกี่ยวกับข่าว (★ ไม่ใช่แค่สวย!)

## กฎเหล็ก:
1. ★★★ ภาพที่สวยแต่ไม่เกี่ยวข่าว → relevance ≤ 3! (ห้ามให้ 7 เด็ดขาด!)
2. ★ ต้องเลือก Role ที่หลากหลาย — ห้ามมีแค่ HERO+PERSON_SUPPORT!
3. ★ ถ้าข่าวมีกิจกรรม/สถานที่ → ต้องมี KEY_ACTIVITY หรือ CONTEXT_SCENE
4. ★ ถ้าข่าวมีความสัมพันธ์ → ต้องมี RELATIONSHIP
5. ★★ ภาพ PERSON_SUPPORT ที่ไม่มีบริบทข่าว (ภาพถ่ายทั่วไป/แฟชั่น/ไลฟ์สไตล์) → relevance ≤ 3
6. ★★ แยก "text แต่งเติม" vs "text ธรรมชาติ":
   - text แต่งเติม (ปกข่าว/ปกคลิป/ลายน้ำ) → relevance ≤ 2 ❌
   - text ธรรมชาติ (ป้ายโรงเรียน/ป้ายสถานที่) → EVIDENCE, relevance ≥ 7 ✅
7. ★ ภาพที่ไม่ใช่ตัวละครในข่าว (คนแปลก ดาราอื่น) → relevance ≤ 2

ตอบ JSON (★★ ต้อง score ทุกภาพ ห้ามข้าม!):
{"curated": [
  {"index": 0, "relevance": 10, "recommendedRole": "HERO_FACE", "reason": "หน้าชัด ตัวละครหลัก"},
  {"index": 1, "relevance": 9, "recommendedRole": "KEY_ACTIVITY", "reason": "ภาพบริจาค ตรงกับข่าว"},
  {"index": 2, "relevance": 2, "recommendedRole": "PERSON_SUPPORT", "reason": "ภาพวิวทะเล สวยแต่ไม่เกี่ยวข่าว"},
  ...จนครบทุกภาพ #0 - #${thumbnails.length - 1}...
]}

## ★★★ CIRCLE SLOT RULES (ถ้าข่าวมีวงกลม):
- วงกลมต้องแสดง 1 คน ที่เป็น subject หลักเท่านั้น: ${subjectsStr}
- ภาพที่จะอยู่ใน circle ต้องมี relevance >= 6
- ห้ามเลือกภาพวัยรุ่น/เด็ก/คนแปลกหน้าที่ไม่ใช่ subject
- ห้ามเลือกภาพกลุ่มคน (>1 คน) สำหรับ circle
- ถ้าไม่มีภาพที่ตรง subjects และ relevance >= 6 → ให้ใช้ภาพ HERO_FACE เดิม (ซ้ำได้)

★★★ กฎสำคัญ: 
- ต้องมี entry ครบทุกภาพ (index 0 ถึง ${thumbnails.length - 1}) ห้ามข้ามภาพไหน!
- ภาพ stock photo / studio / กราฟิก → relevance <= 2
- ภาพที่ไม่ใช่คนในข่าว → relevance <= 2
- ★★★ ภาพที่เป็นคนในข่าวแต่ไม่เกี่ยวกับเนื้อหาข่าว (ไลฟ์สไตล์/แฟชั่น/ท่องเที่ยว) → relevance <= 3`;

    console.log(`[Curator] 🧠 Analyzing ${thumbnails.length} images against news content...`);
    
    const response = await callAI({
      prompt,
      imageContents,
      model: MODEL_VISION,
      temperature: 0.1,
      maxTokens: 1000,
      systemPrompt: 'คุณเป็น Content Curator สำหรับปกข่าว วิเคราะห์ภาพแต่ละภาพว่าตรงกับเนื้อข่าวไหม ตอบ JSON เท่านั้น',
    });

    // Parse response (callAI ใน openai.js จะ parse JSON ให้แล้ว)
    let parsed = null;
    
    if (response && typeof response === 'object') {
      // callAI parse JSON ให้แล้ว
      parsed = response.curated || response;
    }
    
    if (!parsed || !Array.isArray(parsed)) {
      console.log('[Curator] ⚠️ Could not parse AI response, using original roles');
      return null;
    }
    
    // Validate & log
    const validItems = parsed.filter(item => 
      typeof item.index === 'number' && 
      item.index >= 0 && 
      item.index < imageBuffers.length &&
      item.recommendedRole
    );
    
    // ★ Fix 4: Filter by relevance threshold — ภาพไม่เกี่ยวข่าว ห้ามเข้า layout!
    const MIN_RELEVANCE = 5;
    const relevantItems = validItems.filter(item => (item.relevance || 0) >= MIN_RELEVANCE);
    
    // Fallback: ถ้าเหลือน้อยกว่า 3 ภาพ → ลดเกณฑ์เป็น >= 4
    const finalCurated = relevantItems.length >= 3 
      ? relevantItems 
      : validItems.filter(item => (item.relevance || 0) >= 4);
    
    console.log(`[Curator] 🎯 Relevance filter: ${validItems.length} total → ${relevantItems.length} (≥${MIN_RELEVANCE}) → ${finalCurated.length} final`);
    
    // Log ผล Curator
    const contextImages = finalCurated.filter(i => 
      i.recommendedRole === 'CONTEXT_SCENE' || i.recommendedRole === 'EVIDENCE'
    );
    
    for (const item of finalCurated) {
      console.log(`[Curator] Image #${item.index}: ${item.recommendedRole} (relevance: ${item.relevance}/10) — ${item.reason || ''}`);
    }
    console.log(`[Curator] 📊 Results: ${finalCurated.length} images curated, ${contextImages.length} context/evidence images`);
    
    return finalCurated;
    
  } catch (err) {
    console.warn('[Curator] Error:', err.message);
    return null;
  }
}

// =============================================
// AI Slot Assignment — Role-based NARRATIVE ORDER:
// ★ hero slot      → MUST be clearest face of main character (HERO_FACE)
// ★ highlight slot → key moment/climax of the news event (KEY_ACTIVITY / EVIDENCE)
// ★ scene/bg_top   → location or context of the event (CONTEXT_SCENE)
// ★ emotion/bg_bot → supporting mood or secondary character (EMOTION / RELATIONSHIP)
// ★ circle         → single-face portrait of main character (not background!)
// NEVER put a background/location-only image in hero slot.
// NEVER put a duplicate of hero into any other slot.
// =============================================
// (Maintained by Character Focus Rule above — hero is guaranteed to have a face)
async function assignImagesToSlots(imageBuffers, faceDataMap, templateId, identity, coverReferences) {
  try {
    let slotCount = 4;
    let hasCircle = false;
    let hasCircleSmall = false;
    try {
      const { getTemplateById } = await import('@/lib/coverTemplateRegistry');
      const tmpl = getTemplateById(templateId);
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
      PERSON_SUPPORT: [],
      CONTEXT_SCENE: [],
      EVIDENCE: [],
      EMOTION: [],
      RELATIONSHIP: [],
      SUPPORT: [],
    };

    imageBuffers.forEach((img, i) => {
      const role = img.role || 'SUPPORT';
      const faceData = faceDataMap.get(String(i)) || { hasFaces: false, faceCount: 0 };
      
      if (role === 'HERO_FACE' || role === 'HERO') {
        byRole.HERO_FACE.push({ index: i, faceData, role });
      } else if (role === 'PERSON_SUPPORT') {
        byRole.PERSON_SUPPORT.push({ index: i, faceData, role });
      } else if (role === 'CONTEXT_SCENE' || role === 'KEY_ACTIVITY') {
        // ★ KEY_ACTIVITY → ใส่ใน CONTEXT_SCENE (เพราะเป็นภาพบริบท/กิจกรรมในข่าว)
        byRole.CONTEXT_SCENE.push({ index: i, faceData, role });
      } else if (role === 'EVIDENCE') {
        byRole.EVIDENCE.push({ index: i, faceData, role });
      } else if (role === 'EMOTION' || role === 'TIMELINE_PAST') {
        // ★ TIMELINE_PAST → ใส่ใน EMOTION (เพราะเป็นภาพ contrast อารมณ์/เวลา)
        byRole.EMOTION.push({ index: i, faceData, role });
      } else if (role === 'RELATIONSHIP') {
        byRole.RELATIONSHIP.push({ index: i, faceData, role });
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
        heroIndex = heroCandidates[0].index;
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

      // Circle: ★★★ Smart Slot Assignment
      // ★ FIX: Circle ต้องเป็นภาพหน้า 1 คนชัด — ห้ามใช้ภาพโซเชลฟี่/กลุ่มที่มีคนมากกว่า 1
      if (hasCircle) {
        // ★ Step 1 (BEST): HERO_FACE ที่มี faceCount === 1 (ไม่ใช่ hero หลัก) — ภาพหน้าชัดสุดสำหรับวงกลม!
        const singleFaceHero = [...byRole.HERO_FACE, ...byRole.HERO]
          .filter(x => x.index !== heroIndex && x.faceData.faceCount === 1);
        
        // ★ Step 2: PERSON_SUPPORT ที่มี faceCount === 1 และ curatorScore >= 4
        const singleFacePerson = byRole.PERSON_SUPPORT
          .filter(x => x.index !== heroIndex && x.faceData.faceCount === 1 && (imageBuffers[x.index]?.curatorScore || 0) >= 4);
        
        // ★ Step 3: RELATIONSHIP ที่มี faceCount === 1 (ภาพ portrait เดี่ยว)
        const singleFaceRelation = byRole.RELATIONSHIP
          .filter(x => x.index !== heroIndex && x.faceData.faceCount === 1 && (imageBuffers[x.index]?.curatorScore || 0) >= 4);
        
        // ★ Step 4: EMOTION/EVIDENCE ที่มี face เดียว
        const singleFaceEmotion = [...byRole.EMOTION, ...byRole.EVIDENCE]
          .filter(x => x.index !== heroIndex && x.faceData.faceCount === 1 && (imageBuffers[x.index]?.curatorScore || 0) >= 4);
        
        // ★ Step 5: ภาพอะไรก็ได้ที่มี faceCount === 1 — ต้อง score >= 5 เพื่อป้องกันภาพคนไม่เกี่ยว!
        // score 2-4 = คนในภาพแต่ไม่ใช่ subject หลัก (เช่น วัยรุ่นสุ่มที่ AI เลือกมา) → ห้ามใช้ circle!
        const anySingleFace = imageBuffers
          .map((img, i) => ({ index: i, faceData: faceDataMap.get(String(i)) || {}, score: img.curatorScore || 0, role: img.role }))
          .filter(x => x.index !== heroIndex && (x.faceData.faceCount === 1) && x.score >= 5
            // ★ ยอมให้ SUPPORT ได้เฉพาะ score >= 7 (มั่นใจว่าเป็น subject)
            && (x.role !== 'SUPPORT' || x.score >= 7));
        
        // ★ Step 6 (LAST RESORT): ภาพใดก็ได้ที่ไม่ใช่ hero — แต่ต้อง score >= 4 (ไม่ใช่คนแปลกหน้า!)
        const anyFallback = [
          ...byRole.RELATIONSHIP, ...byRole.EVIDENCE, ...byRole.EMOTION,
          ...heroCandidates.slice(1), ...byRole.CONTEXT_SCENE,
          // ★ SUPPORT เฉพาะ score >= 6 — ป้องกันภาพคนไม่เกี่ยวข่าว
          ...byRole.SUPPORT.filter(x => (imageBuffers[x.index]?.curatorScore || 0) >= 6),
        ].filter(x => x.index !== heroIndex && (imageBuffers[x.index]?.curatorScore || 0) >= 4);

        // เลือกตาม priority — single-face ก่อนเสมอ
        const circlePool = singleFaceHero.length > 0 ? singleFaceHero
          : singleFacePerson.length > 0 ? singleFacePerson
          : singleFaceRelation.length > 0 ? singleFaceRelation
          : singleFaceEmotion.length > 0 ? singleFaceEmotion
          : anySingleFace.length > 0 ? anySingleFace
          : anyFallback;

        if (circlePool.length > 0) {
          circleIndex = circlePool[0].index;
          const chosenRole = imageBuffers[circleIndex]?.role || circlePool[0].role || '?';
          const faces = faceDataMap.get(String(circleIndex))?.faceCount || 0;
          const curScore = imageBuffers[circleIndex]?.curatorScore || 0;
          const pickedStep = singleFaceHero.length > 0 ? 'HERO single-face'
            : singleFacePerson.length > 0 ? 'PERSON single-face'
            : singleFaceRelation.length > 0 ? 'RELATION single-face'
            : singleFaceEmotion.length > 0 ? 'EMOTION single-face'
            : anySingleFace.length > 0 ? 'any single-face (score>=5)'
            : 'fallback (score>=4)';
          console.log(`[assignSlots] ★ Circle: image #${circleIndex} (${chosenRole}, faces: ${faces}, score: ${curScore}) [${pickedStep}]`);
          // ★ Guard: ถ้า circle ได้ภาพจาก fallback แต่ score ต่ำมาก → ใช้ hero ดีกว่า
          if (curScore < 4 && pickedStep.includes('fallback')) {
            const otherHeroFallback = heroCandidates.filter(x => x.index !== heroIndex);
            if (otherHeroFallback.length > 0) {
              circleIndex = otherHeroFallback[0].index;
              console.log(`[assignSlots] ★ Circle fallback score too low (${curScore}) → using secondary hero #${circleIndex}`);
            }
          }
        } else {
          // ★ ถ้าไม่มีเลย → ใช้ hero ซ้ำ ดีกว่าภาพไม่เกี่ยว
          const otherHero = heroCandidates.filter(x => x.index !== heroIndex);
          if (otherHero.length > 0) {
            circleIndex = otherHero[0].index;
            console.log(`[assignSlots] ★ Circle: fallback to hero #${circleIndex}`);
          } else {
            circleIndex = heroIndex === 0 ? 1 : 0;
            console.log(`[assignSlots] ⚠️ Circle: no relevant images — using image #${circleIndex}`);
          }
        }
      }

      // CircleSmall
      if (hasCircleSmall) {
        const candidates = [...byRole.EMOTION, ...byRole.SUPPORT]
          .filter(x => x.index !== heroIndex && x.index !== circleIndex);
        circleSmallIndex = candidates.length > 0 ? candidates[0].index : undefined;
      }

      // PhotoOrder: [Hero, ...remaining sorted by SLOT ROLE MATCHING]
      const usedIndices = new Set([heroIndex]);
      if (circleIndex !== undefined) usedIndices.add(circleIndex);
      if (circleSmallIndex !== undefined) usedIndices.add(circleSmallIndex);

      // ★★★ ดึง slot roles จาก template เพื่อจับคู่ภาพให้ตรง slot!
      let templateSlotRoles = [];
      try {
        const { getTemplateById } = await import('@/lib/coverTemplateRegistry');
        const tmpl = getTemplateById(templateId);
        if (tmpl) {
          templateSlotRoles = tmpl.slots.map(s => s.role || s.id);
        }
      } catch {}

      // เตรียม pool ภาพแยกตาม category
      const MIN_SLOT_SCORE = 4; // ★ ห้ามใช้ภาพ score < 4 (ไม่เกี่ยวกับข่าว!)
      const remaining = imageBuffers
        .map((img, i) => ({ index: i, role: img.role, score: img.curatorScore || 0 }))
        .filter(x => !usedIndices.has(x.index));

      const isSceneRole = (r) => ['CONTEXT_SCENE', 'KEY_ACTIVITY'].includes(r);
      const isPersonRole = (r) => ['PERSON_SUPPORT', 'HERO_FACE', 'HERO'].includes(r);
      const isEmotionRole = (r) => ['EMOTION', 'TIMELINE_PAST'].includes(r);
      const isEvidenceRole = (r) => ['EVIDENCE'].includes(r);

      // ★ กรอง score >= MIN_SLOT_SCORE — ไม่เอาภาพ stock/ไม่เกี่ยว
      const scenePool = remaining.filter(x => isSceneRole(x.role) && x.score >= MIN_SLOT_SCORE).sort((a, b) => b.score - a.score);
      const personPool = remaining.filter(x => isPersonRole(x.role) && x.score >= MIN_SLOT_SCORE).sort((a, b) => b.score - a.score);
      const emotionPool = remaining.filter(x => isEmotionRole(x.role) && x.score >= MIN_SLOT_SCORE).sort((a, b) => b.score - a.score);
      const evidencePool = remaining.filter(x => isEvidenceRole(x.role) && x.score >= MIN_SLOT_SCORE).sort((a, b) => b.score - a.score);
      const otherPool = remaining.filter(x => ['RELATIONSHIP', 'SUPPORT'].includes(x.role) && x.score >= MIN_SLOT_SCORE).sort((a, b) => b.score - a.score);
      
      // ★★★ Role-aware slot assignment: จับคู่ภาพกับ slot ตาม template role
      // Slot 0 = main (hero) → จัดแล้ว = heroIndex
      // Slot 1+ = ดู role จาก template แล้วหยิบภาพที่เหมาะ
      const slotQueue = [];
      const assignedIndices = new Set();
      
      // ใช้ counters เพื่อหยิบจาก pool ไม่ซ้ำ
      let sceneIdx = 0, personIdx = 0, emotionIdx = 0, evidenceIdx = 0, otherIdx = 0;
      
      const pickFromPool = (pool, counter) => {
        while (counter.val < pool.length) {
          const item = pool[counter.val];
          counter.val++;
          if (!assignedIndices.has(item.index)) {
            assignedIndices.add(item.index);
            return item;
          }
        }
        return null;
      };

      // ★ Map: template slot role → image role preference
      // scene → ภาพ scene/activity (ไม่ใช่คน! เพราะ scene slot มี fadeLeft กินหน้า)
      // emotion → ภาพอารมณ์/timeline
      // hero2 → ภาพคน (PERSON_SUPPORT)
      // highlight → ภาพ activity/evidence/person (หลากหลาย — อยู่ในกรอบ ไม่มี fade)
      // support → ภาพอะไรก็ได้

      const counters = {
        scene: { val: 0 }, person: { val: 0 }, emotion: { val: 0 },
        evidence: { val: 0 }, other: { val: 0 }
      };

      for (let si = 1; si < templateSlotRoles.length && si < slotCount; si++) {
        const slotRole = templateSlotRoles[si]; // 'scene', 'emotion', 'hero2', 'highlight', 'support'
        let picked = null;

        if (slotRole === 'scene') {
          // ★ Scene slot มี fadeLeft → ใส่ภาพ scene/activity (ไม่มีหน้าคนสำคัญ!)
          picked = pickFromPool(scenePool, counters.scene);
          if (!picked) picked = pickFromPool(evidencePool, counters.evidence);
          if (!picked) picked = pickFromPool(otherPool, counters.other);
        } else if (slotRole === 'emotion') {
          picked = pickFromPool(emotionPool, counters.emotion);
          if (!picked) picked = pickFromPool(personPool, counters.person);
        } else if (slotRole === 'hero2') {
          picked = pickFromPool(personPool, counters.person);
          if (!picked) picked = pickFromPool(emotionPool, counters.emotion);
        } else if (slotRole === 'highlight') {
          // Highlight อยู่ในกรอบ ไม่มี fade → ใส่ภาพอะไรก็ได้ ★ priority: activity > evidence > person
          picked = pickFromPool(scenePool, counters.scene);
          if (!picked) picked = pickFromPool(evidencePool, counters.evidence);
          if (!picked) picked = pickFromPool(personPool, counters.person);
        } else if (slotRole === 'support') {
          picked = pickFromPool(personPool, counters.person);
          if (!picked) picked = pickFromPool(otherPool, counters.other);
        } else {
          // Unknown role → any remaining
          picked = pickFromPool(scenePool, counters.scene)
            || pickFromPool(personPool, counters.person)
            || pickFromPool(emotionPool, counters.emotion);
        }

        // Fallback: ถ้า pool หมด → adaptive threshold
        if (!picked) {
          // ★ ลอง score >= MIN_SLOT_SCORE ก่อน
          let relevantFallback = remaining
            .filter(x => !assignedIndices.has(x.index) && x.score >= MIN_SLOT_SCORE)
            .sort((a, b) => {
              const personBonus = (r) => ['PERSON_SUPPORT', 'RELATIONSHIP', 'EMOTION'].includes(r) ? 10 : 0;
              return (b.score + personBonus(b.role)) - (a.score + personBonus(a.role));
            });
          
          // ★ ถ้าไม่มี score >= MIN_SLOT_SCORE → ลดเกณฑ์เป็น >= 2 สำหรับ ANY role
          // ภาพ score ต่ำแต่มีอยู่ = ดีกว่าเว้นว่าง (ปกที่ slot ว่างดูเสีย!)
          if (relevantFallback.length === 0) {
            relevantFallback = remaining
              .filter(x => !assignedIndices.has(x.index) && x.score >= 2)
              .sort((a, b) => b.score - a.score);
          }
          
          // ★★ Ultimate fallback: ใช้ภาพ score >= 1 (ดีกว่า slot ว่าง!)
          if (relevantFallback.length === 0) {
            relevantFallback = remaining
              .filter(x => !assignedIndices.has(x.index) && x.score >= 1)
              .sort((a, b) => b.score - a.score);
          }
          
          if (relevantFallback.length > 0) {
            picked = relevantFallback[0];
            assignedIndices.add(picked.index);
            console.log(`[assignSlots] ⚠️ Slot ${si} (${slotRole}): fallback image #${picked.index} (${picked.role}, score: ${picked.score})`);
          } else {
            console.log(`[assignSlots] ⚠️ Slot ${si} (${slotRole}): ไม่มีภาพเลย — เว้นว่าง`);
          }
        }

        if (picked) {
          slotQueue.push(picked.index);
          console.log(`[assignSlots] Slot ${si} (${slotRole}): image #${picked.index} (${picked.role}, score: ${picked.score})`);
        }
      }

      // Fallback: ถ้า templateSlotRoles ว่าง → ใช้ diverse queue
      if (slotQueue.length === 0) {
        // ★ Adaptive threshold: ลอง score >= 4 ก่อน → ถ้าไม่มีให้ลด >= 2
        let effectiveMin = MIN_SLOT_SCORE;
        let relevantRemaining = remaining
          .filter(x => x.score >= effectiveMin)
          .sort((a, b) => b.score - a.score)
          .map(x => x.index);
        
        // ★ ถ้าไม่มี score >= MIN_SLOT_SCORE → fallback เฉพาะ PERSON roles
        if (relevantRemaining.length === 0) {
          const personRoles = ['PERSON_SUPPORT', 'HERO_FACE', 'RELATIONSHIP', 'EMOTION'];
          relevantRemaining = remaining
            .filter(x => x.score >= 2 && !assignedIndices.has(x.index) && personRoles.includes(x.role))
            .sort((a, b) => b.score - a.score)
            .map(x => x.index);
        }
        
        if (relevantRemaining.length > 0) {
          slotQueue.push(...relevantRemaining.slice(0, slotCount - 1));
          console.log(`[assignSlots] ⚠️ No template roles — using ${Math.min(relevantRemaining.length, slotCount - 1)} images (min score: ${effectiveMin})`);
        } else {
          console.log(`[assignSlots] ⚠️ No images at all — cover จะใช้แค่ hero`);
        }
      }

      photoOrder = [heroIndex, ...slotQueue];
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

    // ★★★ ถ้า photoOrder ไม่ครบ → fill จากภาพที่ยังไม่ได้ใช้ (ดีกว่าเว้นว่าง!)
    if (photoOrder.length < slotCount) {
      const usedInPhoto = new Set(photoOrder);
      if (circleIndex !== undefined) usedInPhoto.add(circleIndex);
      if (circleSmallIndex !== undefined) usedInPhoto.add(circleSmallIndex);
      
      // เอาภาพที่เหลือทั้งหมด sort by score
      const fillCandidates = imageBuffers
        .map((img, i) => ({ index: i, score: img.curatorScore || 0 }))
        .filter(x => !usedInPhoto.has(x.index))
        .sort((a, b) => b.score - a.score);
      
      for (const c of fillCandidates) {
        if (photoOrder.length >= slotCount) break;
        photoOrder.push(c.index);
        console.log(`[assignSlots] 🔄 Fill slot ${photoOrder.length}: image #${c.index} (score: ${c.score})`);
      }
      
      if (photoOrder.length < slotCount) {
        console.log(`[assignSlots] ⚠️ Still only ${photoOrder.length}/${slotCount} images after fill`);
      }
    }

    console.log(`[assignSlots] Hero: ${heroIndex}, Circle: ${circleIndex}, CircleSmall: ${circleSmallIndex}`);
    console.log(`[assignSlots] PhotoOrder (${slotCount} slots): ${JSON.stringify(photoOrder)}`);
    console.log(`[assignSlots] Roles: HERO=${byRole.HERO_FACE.length}, PERSON=${byRole.PERSON_SUPPORT.length}, SCENE=${byRole.CONTEXT_SCENE.length}, EVIDENCE=${byRole.EVIDENCE.length}, EMOTION=${byRole.EMOTION.length}`);

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
