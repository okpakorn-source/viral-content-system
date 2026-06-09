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
import { GoogleGenerativeAI } from '@google/generative-ai';

// ============================================================================
// ★ GEMINI GLOBAL FETCH INTERCEPTOR — AUTO FALLBACK FOR 503/429/TIMEOUTS ★
// ★★★ Fix 11: จำกัด retry สูงสุด 3 ครั้ง แล้วปล่อยให้ caller fallback เอง (GPT-4o)
// ============================================================================
try {
  if (!globalThis.__isFetchIntercepted) {
    globalThis.__isFetchIntercepted = true;
    globalThis.__geminiRetryCount = 0; // ★ Fix 11: นับจำนวน retry
    const MAX_GEMINI_RETRIES = 3;      // ★ Fix 11: จำกัด 3 ครั้งต่อ pipeline
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async function(input, init) {
      let url = '';
      if (typeof input === 'string') {
        url = input;
      } else if (input && typeof input === 'object' && input.url) {
        url = input.url;
      }

      const isGemini25Flash = url.includes('generativelanguage.googleapis.com') && url.includes('gemini-2.5-flash');
      const isGemini25Pro = url.includes('generativelanguage.googleapis.com') && url.includes('gemini-2.5-pro');

      if (isGemini25Flash || isGemini25Pro) {
        const fallbackModel = 'gemini-2.5-pro';
        try {
          const response = await originalFetch.call(this, input, init);
          if (!response.ok && (response.status === 503 || response.status === 429)) {
            // ★ Fix 11: เช็ค retry limit
            if (globalThis.__geminiRetryCount >= MAX_GEMINI_RETRIES) {
              console.warn(`[Gemini Fetch Interceptor] ⛔ Max retries (${MAX_GEMINI_RETRIES}) reached — letting error pass to caller for GPT-4o fallback`);
              return response; // ปล่อยให้ caller จัดการเอง (มี GPT-4o fallback)
            }
            globalThis.__geminiRetryCount++;
            if (isGemini25Pro) {
              console.warn(`[Gemini Fetch Interceptor] HTTP ${response.status} for gemini-2.5-pro. Sleeping 1500ms before retry... (${globalThis.__geminiRetryCount}/${MAX_GEMINI_RETRIES})`);
              await new Promise(r => setTimeout(r, 1500));
            }
            const newUrl = url.replace(/gemini-2.5-(flash|pro)/, fallbackModel);
            console.warn(`[Gemini Fetch Interceptor] HTTP ${response.status} for ${url}. Retrying with ${fallbackModel}... (${globalThis.__geminiRetryCount}/${MAX_GEMINI_RETRIES})`);
            if (typeof input !== 'string' && typeof Request !== 'undefined' && input instanceof Request) {
              const newRequest = new Request(newUrl, input);
              return await originalFetch.call(this, newRequest, init);
            }
            return await originalFetch.call(this, newUrl, init);
          }
          // ★ Fix 11: รีเซ็ต counter เมื่อสำเร็จ
          if (response.ok) globalThis.__geminiRetryCount = 0;
          return response;
        } catch (err) {
          // ★ Fix 11: เช็ค retry limit
          if (globalThis.__geminiRetryCount >= MAX_GEMINI_RETRIES) {
            console.warn(`[Gemini Fetch Interceptor] ⛔ Max retries (${MAX_GEMINI_RETRIES}) reached on error — letting error pass to caller`);
            throw err;
          }
          globalThis.__geminiRetryCount++;
          if (isGemini25Pro) {
            console.warn(`[Gemini Fetch Interceptor] Fetch error for gemini-2.5-pro. Sleeping 1500ms before retry... (${globalThis.__geminiRetryCount}/${MAX_GEMINI_RETRIES})`);
            await new Promise(r => setTimeout(r, 1500));
          }
          const newUrl = url.replace(/gemini-2.5-(flash|pro)/, fallbackModel);
          console.warn(`[Gemini Fetch Interceptor] Fetch error: ${err.message} for ${url}. Retrying with ${fallbackModel}... (${globalThis.__geminiRetryCount}/${MAX_GEMINI_RETRIES})`);
          if (typeof input !== 'string' && typeof Request !== 'undefined' && input instanceof Request) {
            const newRequest = new Request(newUrl, input);
            return await originalFetch.call(this, newRequest, init);
          }
          return await originalFetch.call(this, newUrl, init);
        }
      }

      return await originalFetch.apply(this, arguments);
    };
    console.log('[Gemini Fetch Interceptor] Installed global fetch interceptor successfully. (max retries: 3)');
  }
} catch (e) {
  console.error('[Gemini Fetch Interceptor] Failed to install:', e);
}

export const maxDuration = 600; // ★ Fix 12: 10 minutes — Gemini 503 fallback chain needs more time

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

// ═══ Final Cover Judge (GPT-4o-mini Vision — Fix 17: ปิด Gemini) ═══
async function evaluateFinalCover(base64Image, newsTitle) {
  // ★★★ Fix 17: ใช้ GPT-4o-mini ตรง ไม่ผ่าน Gemini (503 ทั้งวัน)
  try {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) return 7; // default score ถ้าไม่มี key

    const prompt = `You are an elite news Art Director evaluating a composed 1200x1350 news cover for: "${newsTitle}".
Evaluate: 1) Main subject visible? 2) Background images diverse? 3) Composition balanced? 4) Quality high?
Score 1-10. Return ONLY valid JSON: {"score": 8, "reason": "brief"}`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'low' } }
        ]}],
        max_tokens: 200,
        temperature: 0.2
      }),
      signal: AbortSignal.timeout(15000) // 15s timeout
    });

    if (res.ok) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      const match = text.match(/\{[\s\S]*?"score"[\s\S]*?\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        const score = parseInt(parsed.score, 10);
        if (score >= 1 && score <= 10) {
          console.log(`[AutoCover Judge] ✅ Score: ${score}/10 using gpt-4o-mini — ${parsed.reason}`);
          return score;
        }
      }
    }
    console.log('[AutoCover Judge] ⚠️ GPT-4o-mini judge failed, using default score 7');
    return 7;
  } catch (e) {
    console.warn('[AutoCover Judge] Error:', e.message?.substring(0, 60));
    return 7; // default score
  }
}
// ★ Old Gemini evaluateFinalCover (disabled by Fix 17)
// Original code preserved below — uncomment to re-enable Gemini
/*
  for (const modelName of models) { ... }
  return null;
}
*/

export async function POST(request) {
  const startTime = Date.now();
  const TIMEOUT_MS = 540_000; // ★ Fix 12: 9 minutes — Gemini 503 fallback to GPT-4o needs ~5-8 min

  try {
    const body = await request.json();
    const { content, newsTitle, templateId = 'auto', sourceUrl = '', regenerate = false, caseId: bodyCaseId, clearCache = false } = body;

    const sessionId = bodyCaseId || `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

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

    // ════════════════════════════════════════════════════════
    // ★★★ Step 1.4: Smart Query Generator — AI วิเคราะห์ข่าวสร้าง keyword ฉลาดๆ
    // ไม่ค้นแค่ชื่อคน แต่ใช้บริบทข่าว เช่น "สวนแม่ชมพู่", "ที่ดิน 1 ไร่ ยายหนิง"
    // ════════════════════════════════════════════════════════
    try {
      console.log('[AutoCover] 🧠 Step 1.4: Smart Query Generator...');
      const { generateSmartQueries } = await import('@/lib/services/smartQueryGenerator');
      const smartResult = await generateSmartQueries(newsTitle, content, identity);
      if (smartResult?.injected) {
        console.log(`[AutoCover] 🧠 Smart queries injected: ${smartResult.smartQueries?.length || 0} queries`);
      } else {
        console.log(`[AutoCover] 🧠 Smart queries: fallback mode (${smartResult?.smartQueries?.length || 0} queries)`);
      }
    } catch (smartErr) {
      console.warn('[AutoCover] 🧠 Smart Query Generator failed (non-critical):', smartErr.message?.slice(0, 80));
    }

    // ════════════════════════════════════════════════════════
    // ★ PROGRAMMATIC QUERY OVERRIDE (ROOT FIX)
    // ไม่ได้พึ่ง AI ทำตาม schema — override ตาม celebratedAction จริงๆ
    // ★★★ ถ้า celebratedAction มี → ALWAYS override ทันที
    //     (ลบ occupationImportance threshold — มันเข้มเกินไป)
    //     occupation threshold ใช้แค่กับ image scoring ไม่ใช่ query gen
    // ════════════════════════════════════════════════════════
    {
      const cs = identity?.coreStory || {};
      const celebratedAction = cs.celebratedAction;
      const occupationImportance = cs.occupationImportance ?? 1.0;
      const relationship = cs.relationship;
      const hero = identity?.mainCharacter || '';

      if (celebratedAction && hero && identity?.searchQueries) {
        // ★ Always override — celebratedAction drives queries regardless of occupationImportance
        const sq = identity.searchQueries;
        const prevKeyActivity = sq.key_activity;
        const prevPersonContext = sq.person_context;
        sq.key_activity     = `${hero} ${celebratedAction}`.trim();
        sq.key_relationship = relationship ? `${hero} ${relationship}`.trim() : `${hero} ครอบครัว`;
        sq.person_context   = relationship ? `${hero} ${relationship}`.trim() : `${hero} ${celebratedAction}`.trim();
        sq.event_scene      = `${hero} ${celebratedAction}`.trim();
        identity.searchGoogle  = `${hero} ${celebratedAction}`.trim().substring(0, 80);
        identity.searchYouTube = relationship ? `${hero} ${relationship} ${celebratedAction}`.trim().substring(0, 60) : `${hero} ${celebratedAction}`.trim().substring(0, 60);
        // ★★★ Fix 1: Override person_portrait + person_closeup เมื่อข่าวไม่เกี่ยวอาชีพ
        // ป้องกัน Google คืนภาพแฟชั่น/พรมแดง เมื่อค้นชื่อคนดังดิบๆ
        if (occupationImportance < 0.3) {
          const storyContext = relationship || celebratedAction || '';
          const prevPortrait = sq.person_portrait;
          const prevCloseup = sq.person_closeup;
          sq.person_portrait = `${hero} ${storyContext}`.trim();
          sq.person_closeup = `${hero} สัมภาษณ์`.trim();
          console.log(`  person_portrait:  "${prevPortrait}" -> "${sq.person_portrait}" (★ story context override)`);
          console.log(`  person_closeup:   "${prevCloseup}" -> "${sq.person_closeup}" (★ interview mode)`);
        }

        console.log(`[AutoCover] ★ QUERY OVERRIDE (occupationImportance=${occupationImportance})`);
        console.log(`  key_activity:     "${prevKeyActivity}" -> "${sq.key_activity}"`);
        console.log(`  person_context:   "${prevPersonContext}" -> "${sq.person_context}"`);
        console.log(`  key_relationship: "${sq.key_relationship}"`);
        console.log(`  searchGoogle:     "${identity.searchGoogle}"`);
      } else {
        console.log(`[AutoCover] No override: celebratedAction="${celebratedAction || 'N/A'}", occImportance=${occupationImportance}`);
      }
    }

    // ════════════════════════════════════════════════════════
    // ★ BUILD coreImageQueries — ชุดคีย์เดียวใช้ทุก Agent
    // ทุก Agent (Google/YouTube/Tavily/Context) ใช้ชุดเดียวกัน
    // ไม่แยก "YouTube ใช้คีย์หนึ่ง Tavily ใช้คีย์อื่น"
    // ════════════════════════════════════════════════════════
    if (identity) {
      const _hero = identity.mainCharacter || '';
      const _action = identity.coreStory?.celebratedAction || '';
      const _rel = identity.coreStory?.relationship || '';
      const _subject = identity.coreStory?.storySubject || '';  // ★ ใคร/อะไรที่ข่าวเล่าถึงจริงๆ
      const _sq = identity.searchQueries || {};

      console.log(`[AutoCover] ★ STORY FOCUS: hero="${_hero}" | storySubject="${_subject}" | relationship="${_rel}" | celebratedAction="${_action}"`);

      if (_hero && (_action || _rel || _subject)) {
        // Core queries — ทุก Agent MUST search เหล่านี้ก่อน
        const core = [
          // ★★★ storySubject ก่อนเสมอ — ข่าวเล่าเรื่องใคร?
          (_subject && _subject !== _hero) ? `${_hero} ${_subject}` : null,
          (_subject && _subject !== _hero) ? _subject : null,  // ค้น storySubject ตรงๆ
          _rel  ? `${_hero} ${_rel}` : null,
          _action ? `${_hero} ${_action}` : null,
          (_rel && _action) ? `${_hero} ${_rel} ${_action}` : null,
          _sq.key_relationship && _sq.key_relationship !== `${_hero} ${_rel}` ? _sq.key_relationship : null,
          _sq.key_activity && _sq.key_activity !== `${_hero} ${_action}` ? _sq.key_activity : null,
        ].filter(Boolean).map(q => q.trim()).filter((q, i, a) => q.length > 3 && a.indexOf(q) === i);

        // Optional queries — occupation/context — ค้นหลัง core เสร็จ
        const optional = [
          _sq.person_portrait,
          _sq.person_closeup,
          _sq.person_emotion,
        ].filter(Boolean);

        identity.coreImageQueries = core;
        identity.optionalContextQueries = optional;
        identity._storySubject = _subject || _rel || _action; // ★ ใช้ใน Vision Judge
        console.log(`[AutoCover] ★ coreImageQueries: ${JSON.stringify(core)}`);
        console.log(`[AutoCover]   storySubject:     "${_subject || '(same as hero)'}"`);
        console.log(`[AutoCover]   optionalContext:  ${JSON.stringify(optional)}`);
      } else {
        identity.coreImageQueries = [];
        identity.optionalContextQueries = [];
        console.log(`[AutoCover] ⚠️ coreImageQueries EMPTY — hero="${_hero}" subject="${_subject}" action="${_action}" rel="${_rel}"`);
      }
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
        entityData = await resolveEntity(identity.mainCharacter, newsTitle || '', identity);
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
    // ★★★ Fix 15: ปิด Relationship Resolver ชั่วคราว — Gemini 503 ทั้งวัน ใช้ข้อมูลจาก StoryIdentity แทน
    // เปิดใหม่โดย uncomment block ด้านล่าง
    /*
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
    */
    console.log('[AutoCover] ⚡ Step 1.6: Relationship Resolver SKIPPED (Fix 15 — Gemini disabled)');
    // ★ ใช้ข้อมูลจาก StoryIdentity แทน
    if (identity?.coreStory?.relationship && identity?.mainCharacter) {
      resolvedRelationships = {
        hero: { name: identity.mainCharacter, searchName: identity.mainCharacter },
        relationships: [{ name: identity.coreStory.relationship, role: 'relationship' }],
        evidenceCategories: ['hero', 'relationship', 'interview'],
      };
    }

    // ═══════════════════════════════════════════════════════
    // ★★★ IMAGE CACHE CHECK — ก่อนค้น Google ให้เช็ค cache ก่อน!
    // ป้องกันปัญหา: Google ให้ภาพชุดต่างทุกครั้ง → ผลไม่คงที่
    // ถ้ามี cache ที่ดี → ใช้เลย ไม่ต้องค้นใหม่!

    // ★ Clear cache ถ้า user ร้องขอ (ล้างภาพเก่าที่แย่ออก)
    if (clearCache && newsTitle) {
      try {
        const { clearCacheByTitle } = await import('@/lib/services/imageCacheService');
        const newsHash = generateNewsHash(newsTitle || content?.substring(0, 100));
        await clearCacheByTitle(newsHash);
        console.log(`[AutoCover] 🗑️ Cache CLEARED for hash: ${newsHash?.slice(0,8)} — will search Google fresh!`);
      } catch (e) {
        console.log(`[AutoCover] ⚠️ Cache clear failed: ${e.message}`);
      }
    }
    // ═══════════════════════════════════════════════════════
    let useCachedImages = false;
    let cachedImageBuffers = [];
    
    if (!regenerate) {
      try {
        const { generateNewsHash, getFromCache, downloadFromStorage } = await import('@/lib/services/imageCacheService');
        const newsHash = generateNewsHash(newsTitle || content?.substring(0, 100));
        console.log(`[AutoCover] 📦 Checking image cache (hash: ${newsHash?.substring(0, 12)}...)...`);
        
        const cached = await getFromCache(newsHash);
        if (cached && cached.length >= 4) {
          // ★ กรอง REJECT ออก + เรียงตาม score สูง → ต่ำ
          const goodCached = cached
            .filter(img => img.role !== 'REJECT' && (img.ai_score || 0) >= 4)
            .sort((a, b) => (b.ai_score || 0) - (a.ai_score || 0));
          const usableCached = goodCached.length >= 4 ? goodCached : cached.sort((a, b) => (b.ai_score || 0) - (a.ai_score || 0));
          console.log(`[AutoCover] 📦 Cache HIT! ${cached.length} total, ${goodCached.length} non-REJECT — downloading from storage...`);
          
          const cacheDownloads = await Promise.allSettled(
            usableCached.slice(0, 12).map(async (img) => {
              try {
                if (img.storage_path) {
                  const buf = await downloadFromStorage(img.storage_path);
                  if (buf && buf.length > 5000) {
                    return {
                      buffer: buf,
                      url: img.image_url || '',
                      role: img.role || 'SUPPORT',
                      score: img.ai_score || 7,
                      source: 'cache',
                      width: img.width || 0,
                      height: img.height || 0,
                    };
                  }
                }
                return null;
              } catch { return null; }
            })
          );
          
          cachedImageBuffers = cacheDownloads
            .filter(r => r.status === 'fulfilled' && r.value)
            .map(r => r.value);
          
          if (cachedImageBuffers.length >= 8) {
            // ★ 8+ ภาพดี → ใช้ cache เท่านั้น ข้าม Google
            useCachedImages = true;
            console.log(`[AutoCover] 📦 ✅ Using ${cachedImageBuffers.length} cached images — SKIPPING Google search!`);
          } else if (cachedImageBuffers.length >= 4) {
            // ★★★ HYBRID MODE: 4-7 ภาพ → ใช้ cache + ค้น Google เพิ่ม!
            useCachedImages = false; // ยังค้น Google เพิ่ม
            console.log(`[AutoCover] 📦 🔄 HYBRID MODE: ${cachedImageBuffers.length} cached images + will search Google for more!`);
          } else {
            console.log(`[AutoCover] 📦 ⚠️ Only ${cachedImageBuffers.length} cached images — falling back to full Google search`);
            cachedImageBuffers = [];
          }
        } else {
          console.log(`[AutoCover] 📦 Cache MISS (${cached?.length || 0} images) — will search Google`);
        }
      } catch (cacheErr) {
        console.warn('[AutoCover] 📦 Cache check failed (non-critical):', cacheErr.message);
      }
    } else {
      console.log('[AutoCover] 📦 Regenerate mode — skipping cache, fresh search');
    }

    // Step 2: Multi-agent image search (parallel กับ Step 1.7–1.8)
    const { runMultiAgentImageSearch } = await import('@/lib/services/multiAgentImageScraper');

    // ★ Run Step 1.7 (CoverPlanner) + Step 1.8 (EvidenceLibrary) + Step 2 (MultiAgent) แบบ parallel
    // ★★★ SKIP if cache hit!
    if (useCachedImages) {
      console.log(`[AutoCover] 📦 CACHE MODE — skipping Google search + Evidence Library`);
      // Still run CoverPlanner for slot mapping
      try {
        const planTemplateId = templateId !== 'auto' ? templateId : 'template_5';
        console.log(`[AutoCover] 📋 Step 1.7: Cover Planner → template: ${planTemplateId}`);
        const { planCoverLayout } = await import('@/lib/services/coverPlannerService');
        coverPlan = await planCoverLayout(resolvedRelationships, planTemplateId, identity);
        console.log(`[AutoCover] 📋 Cover Plan: ${coverPlan.slots?.length || 0} slots mapped (source: ${coverPlan.source})`);
      } catch (planErr) {
        console.warn('[AutoCover] CoverPlanner failed:', planErr.message);
      }
    }
    
    const [multiAgentResult, evidenceResult] = useCachedImages 
      ? [{ status: 'fulfilled', value: [] }, { status: 'fulfilled', value: null }]
      : await Promise.allSettled([
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

          // ★ v3 Step 1.9: Event Resolver — fallback เมื่อ entity ไม่พบ Social Profile
          if (!entityData?.found && evidencePoolTotal === 0) {
            console.log('[AutoCover] 🌐 Step 1.9: Event Resolver fallback (no entity profile found)...');
            try {
              const { resolveEvent } = await import('@/lib/services/eventResolverService');
              const eventResult = await resolveEvent(identity);
              if (eventResult.eventImages && eventResult.eventImages.length > 0) {
                // inject event images เข้า evidencePool ใน category 'event'
                evidencePool['event'] = eventResult.eventImages;
                evidencePoolTotal += eventResult.eventImages.length;
                console.log(`[AutoCover] 🌐 Event Resolver: ${eventResult.eventImages.length} images added`);
              } else if (eventResult.warning) {
                console.log(`[AutoCover] ⚠️ Event Resolver: ${eventResult.warning}`);
              }
            } catch (evtErr) {
              console.warn('[AutoCover] Event Resolver failed (non-critical):', evtErr.message);
            }
          }

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
      const catToRole = {
        hero: 'HERO_FACE',
        mother: 'RELATIONSHIP', father: 'RELATIONSHIP', sibling: 'RELATIONSHIP',
        child: 'RELATIONSHIP', spouse: 'RELATIONSHIP', partner: 'RELATIONSHIP',
        caregiving: 'KEY_ACTIVITY', activity: 'KEY_ACTIVITY', work: 'KEY_ACTIVITY',
        interview: 'PERSON_SUPPORT',
        location: 'CONTEXT_SCENE', evidence: 'EVIDENCE',
        relationship: 'RELATIONSHIP', family: 'RELATIONSHIP',
        event: 'CONTEXT_SCENE', // ★ v3: event images จาก eventResolverService
      };

      const RELATIONSHIP_CATS = new Set(['mother', 'father', 'spouse', 'partner', 'child', 'sibling', 'friend']);
      const heroNameForConfidence = resolvedRelationships?.hero?.name || identity?.mainCharacter || '';
      const { filterRelationshipImages } = await import('@/lib/services/evidenceConfidenceService').catch(() => ({ filterRelationshipImages: null }));

      for (const [cat, imgs] of Object.entries(evidencePool)) {
        const role = catToRole[cat] || 'PERSON_SUPPORT';
        let catImgs = (imgs || []).filter(img => img.imageUrl);

        // ★ v3: กรอง relationship images ด้วย Evidence Confidence (เฉพาะ high-importance)
        if (RELATIONSHIP_CATS.has(cat) && filterRelationshipImages && catImgs.length > 0) {
          try {
            // ★ v4 Step 1.9: Caption Analyzer — pre-sort ด้วย text (เบากว่า Vision มาก)
            let sortedImgs = catImgs;
            try {
              const { sortAndFilterByCaptions } = await import('@/lib/services/captionAnalyzerService').catch(() => ({ sortAndFilterByCaptions: null }));
              if (sortAndFilterByCaptions) {
                sortedImgs = await sortAndFilterByCaptions(catImgs, cat, heroNameForConfidence);
                console.log(`[AutoCover] 📝 Caption sort (${cat}): ${sortedImgs.length}/${catImgs.length} after caption filter`);
              }
            } catch (capErr) {
              console.warn(`[AutoCover] Caption Analyzer error (${cat}):`, capErr.message);
            }

            // ★ v3 Step 1.10: ตรวจ top 3 (caption-sorted) ด้วย Vision
            const toCheck = sortedImgs.slice(0, 3);
            const passed = await filterRelationshipImages(toCheck, heroNameForConfidence);
            const passedUrls = new Set(passed.map(p => p.imageUrl || p.url));
            const passedCount = toCheck.filter(img => passedUrls.has(img.imageUrl)).length;
            console.log(`[AutoCover] 🔬 Confidence filter (${cat}): ${passedCount}/${toCheck.length} passed`);
            // ถ้าไม่ผ่าน → ใช้ hero category แทน slot นั้น (fallback)
            if (passedCount === 0 && toCheck.length > 0) {
              console.log(`[AutoCover] ⚠️ Confidence: all ${cat} images failed → using hero fallback for this slot`);
              catImgs = []; // skip — hero fallback จะถูกเลือกโดย assignImagesToSlots
            } else {
              catImgs = sortedImgs.filter(img => passedUrls.has(img.imageUrl) || !toCheck.find(t => t.imageUrl === img.imageUrl));
            }
          } catch (cfErr) {
            console.warn(`[AutoCover] Confidence filter error (${cat}):`, cfErr.message);
          }
        }

        for (const img of catImgs) {
          // combine quality score: authorityScore (0.3) + captionScore (0.4) + base (0.3)
          const authorityScore = img.authorityScore || 0.35;
          const captionScore = img.captionScore || 0.5;
          // ★★★ Fix 8v2: ลด hero score เล็กน้อย แต่ยังต้องมีหน้าคนชัดสำหรับ main slot
          const occImpForHero = identity?.coreStory?.occupationImportance ?? 1.0;
          const heroBonus = (cat === 'hero' && occImpForHero < 0.3) ? 0.7 : (cat === 'hero' ? 1.0 : 0.7);
          const heroScore = (cat === 'hero' && occImpForHero < 0.3) ? 7 : (cat === 'hero' ? 9 : 7);
          const qualityScore = (authorityScore * 0.3) + (captionScore * 0.4) + (0.3 * heroBonus);
          entityFirstImages.push({
            url: img.imageUrl,
            role,
            score: heroScore,
            qualityScore,
            authorityScore,
            captionScore: img.captionScore,
            captionMatch: img.captionMatch,
            source: 'entity_first',
            evidenceCat: cat,
            title: img.title || img.caption || '',
            snippet: img.query || img.snippet || img.queryLabel || '',
          });
        }
      }
      console.log(`[AutoCover] 🔀 Step 2.5: Merged ${entityFirstImages.length} entity-first + ${multiAgentImages.length} multiAgent images`);
    }

    // ★ Sort entity-first images by qualityScore DESC before merge
    entityFirstImages.sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0));

    // รวม: entity-first มาก่อน (priority, sorted by quality) → multiAgent ตามหลัง
    // ★★★ ถ้า cache hit → ใช้ cached images แทน!
    const bestImages = useCachedImages ? [] : [...entityFirstImages, ...multiAgentImages];
    if (!useCachedImages) {
      console.log(`[AutoCover] 🏆 Best images: ${entityFirstImages.length} entity-first (sorted) + ${multiAgentImages.length} multiAgent`);
    }

    if (!useCachedImages && (!bestImages || bestImages.length === 0)) {
      return NextResponse.json(
        { success: false, error: 'ไม่พบภาพที่เหมาะสม', errorType: 'NO_IMAGES_FOUND', status: 'NEED_MANUAL_COVER' },
        { status: 422 }
      );
    }

    console.log(`[AutoCover] Found ${useCachedImages ? cachedImageBuffers.length + ' (from cache)' : bestImages.length} images`);


    // Step 3: Download + validate + dedup
    const { downloadAndValidateImage } = await import('@/lib/services/imageSearchService');

    const imageBuffers = [];
    const imageHashes = [];

    // ★★★ CACHE INJECTION — ถ้า cache hit ให้ใช้ภาพจาก cache โดยตรง!
    if (useCachedImages && cachedImageBuffers.length >= 4) {
      for (const img of cachedImageBuffers) {
        try {
          const imgMeta = await sharp(img.buffer).metadata().catch(() => ({}));
          imageBuffers.push({
            ...img,
            width: imgMeta.width || img.width || 0,
            height: imgMeta.height || img.height || 0,
          });
          console.log(`[Cache] ✅ #${imageBuffers.length} ${img.role} ${imgMeta.width}x${imgMeta.height} (cached)`);
        } catch { /* skip corrupt cache entry */ }
      }
      console.log(`[AutoCover] 📦 Loaded ${imageBuffers.length} images from cache — skipping Google download!`);
    }

    if (!useCachedImages) {
    // ★★★ Fix 7v2: Balanced story-first mode
    // HERO_FACE ยัง priority 2 (ต้องมีหน้าคนสำหรับ slot หลัก!)
    // แต่ KEY_ACTIVITY + CONTEXT_SCENE download ก่อน เพื่อเติม slot อื่น
    const occImpForSort = identity?.coreStory?.occupationImportance ?? 1.0;
    const rolePriority = occImpForSort < 0.3
      ? {
        // ★ Story-first mode: สลับ context ขึ้นก่อน แต่ยัง download HERO_FACE ด้วย
        'KEY_ACTIVITY': 0,    // ★ ภาพกิจกรรมหลักในข่าว (สำหรับ bg slots)
        'CONTEXT_SCENE': 1,   // ★ ภาพสถานที่/บริบทข่าว (สำหรับ bg slots)
        'HERO_FACE': 2, 'HERO': 2,  // ★★★ ยังต้องมีหน้าคนชัด สำหรับ main slot!
        'RELATIONSHIP': 3,    // ภาพความสัมพันธ์ (สำหรับ circle)
        'EVIDENCE': 4,
        'TIMELINE_PAST': 5,
        'EMOTION': 6,
        'PERSON_SUPPORT': 7,
        'SUPPORT': 8,
      }
      : { 
        'HERO_FACE': 0, 'HERO': 1, 
        'KEY_ACTIVITY': 2,
        'CONTEXT_SCENE': 3,
        'EVIDENCE': 4, 
        'RELATIONSHIP': 5,
        'TIMELINE_PAST': 6,
        'EMOTION': 7, 
        'PERSON_SUPPORT': 8,
        'SUPPORT': 9 
      };
    console.log(`[AutoCover] ★ Download priority: ${occImpForSort < 0.3 ? 'STORY-FIRST-v2 (context+hero balanced)' : 'HERO-FIRST (default)'}`)
    const orderedImages = [...bestImages].sort((a, b) => {
      const pA = rolePriority[a.role] ?? 8;
      const pB = rolePriority[b.role] ?? 8;
      if (pA !== pB) return pA - pB;
      // ★ Same priority → เรียงตาม score สูง→ต่ำ
      return (b.score || 0) - (a.score || 0);
    });

    // Download up to 24 candidates in parallel
    const candidatesToDownload = orderedImages.slice(0, 24);
    console.log(`[AutoCover] 📥 Downloading ${candidatesToDownload.length} candidate images in parallel...`);

    const downloadPromises = candidatesToDownload.map(async (img) => {
      try {
        const buf = await downloadAndValidateImage(img.url);
        if (!buf) return null;
        return {
          ...img, // Copy all original metadata fields (like title, snippet, evidenceCat, etc.)
          buffer: buf,
        };
      } catch (err) {
        return null;
      }
    });

    const downloadResults = await Promise.allSettled(downloadPromises);
    const downloadedImages = downloadResults
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);

    console.log(`[AutoCover] 📥 Downloaded ${downloadedImages.length}/${candidatesToDownload.length} successfully. Filtering for diversity & dedup...`);

    // First pass: try selecting with role diversity limit
    const downloadedRoleCounts = {};
    const maxPerRole = {
      'HERO_FACE': 3,
      'HERO': 2,
      'KEY_ACTIVITY': 3,
      'CONTEXT_SCENE': 3,
      'RELATIONSHIP': 3,
      'EVIDENCE': 2,
      'TIMELINE_PAST': 2,
      'EMOTION': 2,
      'PERSON_SUPPORT': 2,
      'SUPPORT': 2
    };
    const skippedImages = [];

    for (const img of downloadedImages) {
      if (imageBuffers.length >= 12) break; // เพิ่ม max เป็น 12 เพื่อให้ได้ภาพหลากหลายขึ้น
      
      const role = img.role || 'SUPPORT';
      const currentCount = downloadedRoleCounts[role] || 0;
      const maxAllowed = maxPerRole[role] ?? 2;
      
      if (currentCount >= maxAllowed) {
        skippedImages.push(img);
        continue;
      }

      try {
        // Dedup check via dHash
        const hash = await computeImageHash(img.buffer);
        const isDuplicate = imageHashes.some(h => hammingDistance(hash, h) < 12);
        if (isDuplicate) {
          console.log(`[Download] Skipped duplicate (hamming < 12): ${img.url?.substring(0, 60)}`);
          continue;
        }

        // ★ เก็บ metadata ความละเอียดด้วย
        const imgMeta = await sharp(img.buffer).metadata().catch(() => ({}));
        imageHashes.push(hash);
        imageBuffers.push({
          ...img, // Copy all fields
          buffer: img.buffer,
          width: imgMeta.width || 0,
          height: imgMeta.height || 0,
        });
        downloadedRoleCounts[role] = (downloadedRoleCounts[role] || 0) + 1;
        console.log(`[Download] ✅ #${imageBuffers.length} ${img.role} ${imgMeta.width}x${imgMeta.height} — ${img.url?.substring(0, 60)}`);
      } catch {
        // Skip silently
      }
    }

    // Second pass: fill remaining capacity up to 12 if diversity limits left some space
    if (imageBuffers.length < 12 && skippedImages.length > 0) {
      console.log(`[Download] 🔄 Filling remaining slots from skipped list: ${imageBuffers.length}/12...`);
      for (const img of skippedImages) {
        if (imageBuffers.length >= 12) break;
        try {
          const hash = await computeImageHash(img.buffer);
          const isDuplicate = imageHashes.some(h => hammingDistance(hash, h) < 12);
          if (isDuplicate) continue;

          const imgMeta = await sharp(img.buffer).metadata().catch(() => ({}));
          imageHashes.push(hash);
          imageBuffers.push({
            ...img, // Copy all fields
            buffer: img.buffer,
            width: imgMeta.width || 0,
            height: imgMeta.height || 0,
          });
          console.log(`[Download Fill] ✅ #${imageBuffers.length} ${img.role} ${imgMeta.width}x${imgMeta.height} — ${img.url?.substring(0, 60)}`);
        } catch {
          // Skip
        }
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
            if (imageBuffers.length >= 10) break; // เพิ่มจาก 6 เป็น 10
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
                  if (imageBuffers.length >= 12) break; // เพิ่มจาก 8 เป็น 12
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

    } // end if (!useCachedImages)

    // ★★★ HYBRID MODE: inject cached images เข้า pool ร่วมกับ Google results
    if (!useCachedImages && cachedImageBuffers.length > 0) {
      console.log(`[AutoCover] 🔄 HYBRID: Injecting ${cachedImageBuffers.length} cached images into pool (${imageBuffers.length} from Google)`);
      for (const img of cachedImageBuffers) {
        try {
          const imgMeta = await sharp(img.buffer).metadata().catch(() => ({}));
          // Check dedup — ไม่เพิ่มภาพที่ซ้ำกับ Google
          const isDuplicate = imageBuffers.some(existing => 
            Math.abs((existing.width || 0) - (imgMeta.width || 0)) < 10 && 
            Math.abs((existing.height || 0) - (imgMeta.height || 0)) < 10 &&
            Math.abs((existing.buffer?.length || 0) - (img.buffer?.length || 0)) < 1000
          );
          if (!isDuplicate) {
            imageBuffers.push({
              ...img,
              width: imgMeta.width || img.width || 0,
              height: imgMeta.height || img.height || 0,
              source: 'cache+hybrid',
            });
          }
        } catch { /* skip */ }
      }
      console.log(`[AutoCover] 🔄 HYBRID: Total pool = ${imageBuffers.length} images (Google + Cache)`);
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

    // Step 4: Face detection on best candidate images (limit to 8 to prevent timeout & API overload)
    const MAX_CANDIDATE_IMAGES = 8;
    let candidateImages = [...imageBuffers];
    if (candidateImages.length > MAX_CANDIDATE_IMAGES) {
      candidateImages = candidateImages
        .map((img, idx) => ({ img, idx }))
        .sort((a, b) => {
          const scoreA = a.img.score || 0;
          const scoreB = b.img.score || 0;
          if (scoreA !== scoreB) return scoreB - scoreA;
          return (b.img.width * b.img.height) - (a.img.width * a.img.height);
        })
        .slice(0, MAX_CANDIDATE_IMAGES)
        .map(x => x.img);
      
      console.log(`[AutoCover] ✂️ Sliced candidate images from ${imageBuffers.length} to ${candidateImages.length} to prevent timeout`);
      imageBuffers.length = 0;
      imageBuffers.push(...candidateImages);
    }

    const { batchDetectFaces } = await import('@/lib/services/faceDetector');
    const faceInput = imageBuffers.map((img, i) => ({ id: String(i), buffer: img.buffer }));
    const faceDataMap = await batchDetectFaces(faceInput);

    console.log('[AutoCover] Face detection complete');

    // ═══ Step 3.5: Story Coverage Controller ═══
    // ★ FIX: Coverage dynamic ตาม storyType — ไม่ hardcode ทุกข่าว!
    {
      // กำหนด coverage ตาม storyType จาก identity
      const storyType = (identity?.coreStory?.storyType || identity?.emotion || 'general').toLowerCase();
      
      let coverageRequired, coverageOptional;
      
      // ใช้ coverageRequired จาก identity ถ้ามี (จาก Story Event Extraction)
      if (identity?.coverageRequired?.length > 0) {
        coverageRequired = identity.coverageRequired;
        coverageOptional = identity.coverageOptional || [];
      } else {
        // Fallback: กำหนดตาม storyType
        if (storyType.includes('family') || storyType.includes('warm') || storyType.includes('love') || storyType.includes('ครอบครัว')) {
          coverageRequired = ['HERO_FACE', 'RELATIONSHIP', 'EMOTION'];
          coverageOptional = ['KEY_ACTIVITY', 'CONTEXT_SCENE'];
        } else if (storyType.includes('crime') || storyType.includes('อาชญากรรม')) {
          coverageRequired = ['HERO_FACE', 'CONTEXT_SCENE'];
          coverageOptional = ['EVIDENCE', 'KEY_ACTIVITY'];
        } else if (storyType.includes('sport') || storyType.includes('กีฬา')) {
          coverageRequired = ['HERO_FACE', 'KEY_ACTIVITY'];
          coverageOptional = ['CONTEXT_SCENE', 'EMOTION'];
        } else if (storyType.includes('charity') || storyType.includes('บริจาค') || storyType.includes('donate')) {
          coverageRequired = ['HERO_FACE', 'KEY_ACTIVITY', 'EMOTION'];
          coverageOptional = ['RELATIONSHIP', 'CONTEXT_SCENE'];
        } else {
          // Default: minimal
          coverageRequired = ['HERO_FACE', 'KEY_ACTIVITY', 'CONTEXT_SCENE'];
          coverageOptional = ['RELATIONSHIP', 'EMOTION'];
        }
      }
      
      const ALL_ROLES = [...new Set([...coverageRequired, ...coverageOptional])];
      const coverageReport = {};
      for (const role of ALL_ROLES) {
        const count = imageBuffers.filter(img => img.role === role || img.role === role.replace('_', ' ')).length;
        coverageReport[role] = count;
      }
      
      const missingRequired = coverageRequired.filter(r => (coverageReport[r] || 0) === 0);
      const coveredRequired = coverageRequired.filter(r => (coverageReport[r] || 0) > 0);
      
      console.log(`[Coverage] 📊 Story type: "${storyType}" → Required: [${coverageRequired.join(', ')}]`);
      console.log(`[Coverage] 📊 Coverage: ${coveredRequired.length}/${coverageRequired.length} required roles covered`);
      for (const [role, count] of Object.entries(coverageReport)) {
        const isRequired = coverageRequired.includes(role);
        const status = count > 0 ? '✅' : (isRequired ? '❌' : '⚪');
        console.log(`[Coverage]   ${status} ${role}: ${count} images ${isRequired ? '(required)' : '(optional)'}`);
      }
      
      if (missingRequired.length > 0) {
        console.log(`[Coverage] ⚠️ Missing REQUIRED: ${missingRequired.join(', ')}`);
      }
    }

    // Step 5: Choose template — ★ ถ้าภาพน้อย ต้องเลือก template ที่ slot น้อยลง
    let chosenTemplate = templateId;
    if (templateId === 'auto') {
      const hasMultipleFaces = [...faceDataMap.values()].filter(f => f.hasFaces).length;
      const numImages = imageBuffers.length;

      // ★ v4: Cover DNA override — ถ้า DNA recommend template → ใช้ก่อน autoSelectTemplate
      let dnaTemplate = null;
      try {
        const { matchCoverDNA } = await import('@/lib/services/coverDNAService');
        const dna = matchCoverDNA(identity);
        if (dna?.templateId) {
          dnaTemplate = dna.templateId;
          console.log(`[AutoCover] 🧬 Cover DNA override: ${dnaTemplate} (storyType: ${identity?.coverEmotion || 'unknown'})`);
        }
      } catch { /* DNA fail → ใช้ autoSelect */ }

      try {
        const { autoSelectTemplate } = await import('@/lib/coverTemplateRegistry');
        const autoTemplate = autoSelectTemplate(numImages, hasMultipleFaces, identity);
        // DNA มี priority — แต่ถ้า DNA template ไม่รองรับ image count → fallback autoSelect
        chosenTemplate = dnaTemplate || autoTemplate;
      } catch {
        chosenTemplate = dnaTemplate || 'template_5'; // fallback
      }
      console.log(`[AutoCover] Template selected: ${chosenTemplate} (source: ${dnaTemplate ? 'DNA' : 'autoSelect'})`);
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

    // ════════════════════════════════════════════════════════════
    // ★★★ SMART KEYWORD MATCH BOOST — ก่อน Curator!
    // ต้องทำก่อน Curator เพื่อให้ Curator เห็น score ที่ boost แล้ว
    // ════════════════════════════════════════════════════════════
    {
      const smartKeywords = identity?._smartQueryKeywords || [];
      const queryTypes = identity?._smartQueryTypes || {};
      const hero = (identity?.mainCharacter || '').toLowerCase();
      const heroWords = hero.split(/\s+/).filter(w => w.length > 2);

      const storyQueries = [
        ...(queryTypes?.event_visual || []),
        ...(queryTypes?.person_relationship || []),
        ...(queryTypes?.context_fallback || []),
        ...(queryTypes?.exact_person || []),
        // backward compat (old type names)
        ...(queryTypes?.hero_action || []),
        ...(queryTypes?.relationship || []),
        ...(queryTypes?.scene_with_people || []),
        ...(queryTypes?.hero_portrait || []),
        ...(queryTypes?.story_specific || []),
        ...(queryTypes?.scene_object || []),
        ...(queryTypes?.nickname || []),
      ];

      const allWords = [];
      for (const q of storyQueries) {
        const words = (q || '').split(/\s+/).filter(w => w.length > 2);
        allWords.push(...words);
      }
      for (const kw of smartKeywords) {
        const words = (kw || '').split(/\s+/).filter(w => w.length > 2);
        allWords.push(...words);
      }

      const storyOnlyKeywords = [...new Set(allWords.map(k => k.toLowerCase()))]
        .filter(k => k.length > 2)
        .filter(k => !heroWords.includes(k))
        .filter(k => !['ภาพ', 'รูป', 'ข่าว', 'ไทย', 'วิดีโอ', 'คลิป'].includes(k));

      if (storyOnlyKeywords.length > 0) {
        console.log(`[SmartBoost] 🔑 Story keywords (excl. hero name): [${storyOnlyKeywords.slice(0, 10).join(', ')}]`);
        let boostedCount = 0;
        for (let i = 0; i < imageBuffers.length; i++) {
          const img = imageBuffers[i];
          const searchText = `${img.title || ''} ${img.snippet || ''} ${img.url || ''}`.toLowerCase();

          let matchCount = 0;
          const matchedWords = [];
          for (const kw of storyOnlyKeywords) {
            if (searchText.includes(kw)) {
              matchCount++;
              matchedWords.push(kw);
            }
          }

          if (matchCount > 0) {
            const boost = Math.min(matchCount * 2, 4);
            const oldScore = img.score || 5;
            img.score = Math.min(10, oldScore + boost);
            img._keywordMatch = matchCount;
            img._keywordBoost = boost;
            img._smartBoosted = true;
            boostedCount++;
            console.log(`[SmartBoost] 🎯 #${i} matched ${matchCount} story kw: [${matchedWords.join(', ')}] → score ${oldScore}→${img.score} (${img.role})`);
          }
        }
        console.log(`[SmartBoost] ✅ ${boostedCount}/${imageBuffers.length} images boosted (${storyOnlyKeywords.length} story keywords, hero name excluded)`);
      } else {
        console.log(`[SmartBoost] ⚠️ No story-specific keywords found — skipping boost`);
      }
    }

    // ═══ Step 6.5: ★ AI Content Curator — วิเคราะห์เนื้อหา + ภาพ ก่อนเลือกลง slot ═══
    // "สมอง" ตัวที่ 2: ดูเนื้อข่าวทั้งหมด + ภาพทั้ง 12 → ตัดสินว่าภาพไหนตรงกับข่าวจริง
    try {
      const curatorResult = await curateImagesForCover(
        imageBuffers, 
        newsTitle || content?.substring(0, 200), 
        content || newsTitle,
        identity,
        templateSpec,
        faceDataMap
      );
      
      // ★ Handle new format: { curated, artDirection } or legacy array
      const curatedOrder = curatorResult?.curated || (Array.isArray(curatorResult) ? curatorResult : null);
      var artDirection = curatorResult?.artDirection || null;
      
      if (artDirection) {
        console.log(`[AutoCover] ★ AI Art Director decisions received — will override rule-based slot assignment`);
      }
      
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

    // ════════════════════════════════════════════════════════
    // ★★★ SMART KEYWORD MATCH BOOST — ก่อน assignSlots
    // ★ FIX: ไม่ boost ด้วยชื่อคน (ทุกภาพ match → ไร้ประโยชน์)
    //   ใช้แค่ story-specific keywords: สวน, ที่ดิน, ปลูก, ธรรมชาติ
    // ════════════════════════════════════════════════════════
    {
      const smartKeywords = identity?._smartQueryKeywords || [];
      const queryTypes = identity?._smartQueryTypes || {};
      const hero = (identity?.mainCharacter || '').toLowerCase();
      const heroWords = hero.split(/\s+/).filter(w => w.length > 2);

      // ★ เฉพาะ Visual Intent queries (ไม่เอา hero name)
      const storyQueries = [
        ...(queryTypes?.event_visual || []),
        ...(queryTypes?.person_relationship || []),
        ...(queryTypes?.context_fallback || []),
        ...(queryTypes?.exact_person || []),
        // backward compat (old type names)
        ...(queryTypes?.hero_action || []),
        ...(queryTypes?.relationship || []),
        ...(queryTypes?.scene_with_people || []),
        ...(queryTypes?.hero_portrait || []),
        ...(queryTypes?.story_specific || []),
        ...(queryTypes?.scene_object || []),
        ...(queryTypes?.nickname || []),
      ];

      // แยกคำจาก story queries + keywords
      const allWords = [];
      for (const q of storyQueries) {
        const words = (q || '').split(/\s+/).filter(w => w.length > 2);
        allWords.push(...words);
      }
      for (const kw of smartKeywords) {
        const words = (kw || '').split(/\s+/).filter(w => w.length > 2);
        allWords.push(...words);
      }

      // ★ ตัดชื่อคน (hero) ออก — ไม่งั้นทุกภาพ match เท่ากันหมด!
      const storyOnlyKeywords = [...new Set(allWords.map(k => k.toLowerCase()))]
        .filter(k => k.length > 2)
        .filter(k => !heroWords.includes(k))
        .filter(k => !['ภาพ', 'รูป', 'ข่าว', 'ไทย', 'วิดีโอ', 'คลิป'].includes(k));

      if (storyOnlyKeywords.length > 0) {
        console.log(`[SmartBoost] 🔑 Story keywords (excl. hero name): [${storyOnlyKeywords.slice(0, 10).join(', ')}]`);
        let boostedCount = 0;
        for (let i = 0; i < imageBuffers.length; i++) {
          const img = imageBuffers[i];
          const searchText = `${img.title || ''} ${img.snippet || ''} ${img.url || ''}`.toLowerCase();

          let matchCount = 0;
          const matchedWords = [];
          for (const kw of storyOnlyKeywords) {
            if (searchText.includes(kw)) {
              matchCount++;
              matchedWords.push(kw);
            }
          }

          if (matchCount > 0) {
            // ★ Boost: +2 per match (max +4) — story match = ได้เปรียบมาก
            const boost = Math.min(matchCount * 2, 4);
            const oldScore = img.score || 5;
            img.score = Math.min(10, oldScore + boost);
            img._keywordMatch = matchCount;
            img._keywordBoost = boost;
            boostedCount++;
            console.log(`[SmartBoost] 🎯 #${i} matched ${matchCount} story kw: [${matchedWords.join(', ')}] → score ${oldScore}→${img.score} (${img.role})`);
          }
        }
        console.log(`[SmartBoost] ✅ ${boostedCount}/${imageBuffers.length} images boosted (${storyOnlyKeywords.length} story keywords, hero name excluded)`);
      } else {
        console.log(`[SmartBoost] ⚠️ No story-specific keywords found — skipping boost`);
      }
    }

    // ═══ Image Sufficiency Check — Rescue Re-search ═══
    // ★ FIX: LOW_PRIORITY = fallback ใช้ได้ (ไม่ใช่ REJECT!)
    // ★ FIX: Max 2 rescue attempts + fallback to simpler template
    {
      const MAX_RESCUE_ATTEMPTS = 2;
      const MIN_IMAGES_FULL = 4;
      const MIN_IMAGES_SIMPLE = 2;

      // แบ่ง 3 ระดับ:
      const preferred = imageBuffers.filter(img => 
        img.role !== 'LOW_PRIORITY' && img.role !== 'TECHNICAL_BAD' && (img.curatorScore || img.score || 0) >= 3
      );
      const fallbackPool = imageBuffers.filter(img => img.role === 'LOW_PRIORITY');
      
      console.log(`[Sufficiency] 📊 Preferred: ${preferred.length}, Fallback(LOW_PRIORITY): ${fallbackPool.length}, Total: ${imageBuffers.length}`);
      
      if (preferred.length >= MIN_IMAGES_FULL) {
        console.log(`[Sufficiency] ✅ ${preferred.length} preferred images — sufficient`);
      } else {
        // ขั้น 1: ใช้ LOW_PRIORITY เติมก่อน (ไม่ต้อง search ใหม่!)
        if (preferred.length < MIN_IMAGES_FULL && fallbackPool.length > 0) {
          const needed = MIN_IMAGES_FULL - preferred.length;
          const recovered = fallbackPool.slice(0, needed);
          for (const img of recovered) {
            img.role = 'CONTEXT_SCENE'; // upgrade จาก LOW_PRIORITY
            img._recoveredFromFallback = true;
            console.log(`[Sufficiency] ★ Recovered LOW_PRIORITY → CONTEXT_SCENE (score:${img.curatorScore || img.score || '?'})`);
          }
          const newPreferred = imageBuffers.filter(img => 
            img.role !== 'LOW_PRIORITY' && img.role !== 'TECHNICAL_BAD'
          ).length;
          console.log(`[Sufficiency] 🔄 After LOW_PRIORITY recovery: ${newPreferred} usable`);
        }
        
        // ขั้น 2: Rescue search (max 2 รอบ)
        const currentUsable = imageBuffers.filter(img => 
          img.role !== 'LOW_PRIORITY' && img.role !== 'TECHNICAL_BAD'
        ).length;
        
        if (currentUsable < MIN_IMAGES_FULL) {
          console.log(`[Rescue] ⚠️ Still only ${currentUsable} usable — triggering rescue search`);
          
          const hero = identity?.mainCharacter || '';
          const storySubject = identity?.coreStory?.storySubject || identity?.coreStory?.celebratedAction || '';
          let rescueAttempts = 0;
          
          while (rescueAttempts < MAX_RESCUE_ATTEMPTS) {
            rescueAttempts++;
            const usableNow = imageBuffers.filter(img => 
              img.role !== 'LOW_PRIORITY' && img.role !== 'TECHNICAL_BAD'
            ).length;
            if (usableNow >= MIN_IMAGES_FULL || imageBuffers.length >= 10) break;
            
            const rescueQueries = rescueAttempts === 1 
              ? [`${hero} ${storySubject}`.trim(), `${hero} สัมภาษณ์`]
              : [`${hero} กิจกรรม`, `${hero} ข่าว`];
            
            try {
              const { searchGoogleImages } = await import('@/lib/services/imageSearchService');
              let rescueCount = 0;
              
              for (const query of rescueQueries.filter(q => q.length > 3)) {
                if (imageBuffers.length >= 10) break;
                try {
                  const results = await searchGoogleImages(query, 4);
                  for (const result of (results || [])) {
                    if (!result?.url || imageBuffers.some(img => img.url === result.url)) continue;
                    try {
                      const { downloadAndValidateImage } = await import('@/lib/services/imageSearchService');
                      const downloaded = await downloadAndValidateImage(result.url);
                      if (downloaded?.buffer) {
                        imageBuffers.push({
                          buffer: downloaded.buffer,
                          url: result.url,
                          title: result.title || '',
                          width: downloaded.width,
                          height: downloaded.height,
                          role: 'CONTEXT_SCENE',
                          score: 5,
                          _rescueSearch: true,
                          _rescueAttempt: rescueAttempts,
                        });
                        rescueCount++;
                        console.log(`[Rescue] ★ Attempt ${rescueAttempts}: Added "${result.title?.slice(0, 40)}"`);
                      }
                    } catch {}
                  }
                } catch {}
              }
              console.log(`[Rescue] Attempt ${rescueAttempts}: Added ${rescueCount} images (total: ${imageBuffers.length})`);
            } catch (err) {
              console.log(`[Rescue] ⚠️ Attempt ${rescueAttempts} failed: ${err.message?.slice(0, 50)}`);
            }
          }
        }
        
        // ขั้น 3: ถ้ายังไม่พอ → switch to simpler template
        const finalUsable = imageBuffers.filter(img => 
          img.role !== 'TECHNICAL_BAD'
        ).length;
        
        if (finalUsable < MIN_IMAGES_FULL && finalUsable >= MIN_IMAGES_SIMPLE) {
          console.log(`[Sufficiency] ⚠️ Only ${finalUsable} images — switching to simpler template`);
          try {
            const { getTemplateById, getAllTemplateIds } = await import('@/lib/coverTemplateRegistry');
            const allIds = getAllTemplateIds();
            // หา template ที่ต้องการ slot น้อยที่สุด
            const simpleTemplate = allIds
              .map(id => ({ id, spec: getTemplateById(id) }))
              .filter(t => t.spec && t.spec.slots.length <= finalUsable)
              .sort((a, b) => b.spec.slots.length - a.spec.slots.length)[0];
            
            if (simpleTemplate) {
              console.log(`[Sufficiency] ★ Switched template: ${chosenTemplate} → ${simpleTemplate.id} (${simpleTemplate.spec.slots.length} slots)`);
              chosenTemplate = simpleTemplate.id;
              templateSpec = simpleTemplate.spec;
            }
          } catch {}
        }
      }
    }

    // ═══ Layout Fitness Score — ภาพต้องเหมาะกับ slot ที่จะใส่ ═══
    {
      for (let i = 0; i < imageBuffers.length; i++) {
        const img = imageBuffers[i];
        const faceData = faceDataMap?.get?.(String(i)) || { hasFaces: false, faceCount: 0, faces: [] };
        const faces = faceData.faces || [];
        const imgW = img.width || 800;
        const imgH = img.height || 600;
        const isPortrait = imgH > imgW;
        const hasSingleFace = faces.length === 1;
        const hasMultiFace = faces.length >= 2;
        const biggestFaceRatio = faces.length > 0 ? Math.max(...faces.map(f => (f.width || 0) / imgW)) : 0;
        
        img._layoutFitness = {
          // Hero slot: ต้องเห็นหน้า > 15% ของภาพ + หน้าเดียว
          hero: hasSingleFace && biggestFaceRatio > 0.15 ? 10 : 
                hasSingleFace ? 6 : hasMultiFace ? 4 : 2,
          // Circle slot: ต้องมีใบหน้าเดี่ยวชัด
          circle: hasSingleFace && biggestFaceRatio > 0.2 ? 10 : 
                  hasSingleFace ? 7 : hasMultiFace ? 4 : 1,
          // Background slot: ไม่มีหน้าคนใหญ่ = ดี
          background: faces.length === 0 ? 10 : 
                      biggestFaceRatio < 0.15 ? 8 : 4,
          // Highlight slot: มีคนกำลังทำอะไร
          highlight: hasMultiFace ? 10 : hasSingleFace ? 7 : 3,
          // Portrait bonus
          isPortrait,
          biggestFaceRatio: Math.round(biggestFaceRatio * 100),
        };
      }
      
      console.log(`[LayoutFitness] 📍 Scored ${imageBuffers.length} images for layout compatibility`);
      const heroReady = imageBuffers.filter(img => img._layoutFitness?.hero >= 8).length;
      const circleReady = imageBuffers.filter(img => img._layoutFitness?.circle >= 8).length;
      console.log(`[LayoutFitness]   Hero-ready: ${heroReady}, Circle-ready: ${circleReady}`);
    }

    // Step 7: AI Slot Assignment (with cover library reference)
    const slotAssignment = await assignImagesToSlots(
      imageBuffers, faceDataMap, chosenTemplate, identity, coverReferences, artDirection
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
        imageBuffers
          .filter(img => img.role !== 'REJECT' && img.role !== 'LOW_PRIORITY') // ★ ไม่เก็บภาพขยะเข้า cache!
          .map((img, i) => ({
          buffer: img.buffer,
          url: img.url || '',
          role: img.role || 'SUPPORT',
          source: img.url?.startsWith('data:') ? 'youtube' : 'google',
          score: img.curatorScore || img.score || 7,  // ★ ใช้คะแนนจริง
        })),
        newsTitle || content?.substring(0, 100),
        identity
      ).then(r => {
        if (r?.success) console.log(`[AutoCover] ★ Saved ${r.saved} images to cache (hash: ${r.newsHash?.slice(0,8)})`);
      }).catch(() => {});
    } catch {}

    // Step 8: AI Final Judge
    let score = 7; // Default fallback
    
    // Resize cover buffer to 800px max dimension for Vision Judge and Story Match Validator to reduce payload size and speed up API calls.
    let resizedCoverBase64 = null;
    try {
      const resizedBuf = await sharp(coverBuffer)
        .resize(800, 900, { fit: 'inside' })
        .jpeg({ quality: 75 })
        .toBuffer();
      resizedCoverBase64 = resizedBuf.toString('base64');
    } catch (resizeErr) {
      console.warn('[AutoCover] Failed to resize cover for judge:', resizeErr.message);
      resizedCoverBase64 = coverBuffer.toString('base64');
    }

    try {
      const judgeScore = await evaluateFinalCover(resizedCoverBase64, newsTitle || '');
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

    // FIX C: Cover Praising Test -- Story Match Validator (upgraded)
    let storyMatchScore = null;
    let storyMatchReason = null;
    let viewerImpression = null;
    let dominantElement = null;
    let coverPraises = null;
    let isCorrectPraise = null;
    try {
      if (identity?.coreStory?.emotionalHook && coverBuffer) {
        const { callAI } = await import('@/lib/ai/openai');

        const celebratedTarget = identity.coreStory?.celebratedAction
          || identity.coreStory?.emotionalHook
          || 'the main story';

        const storyMatchPrompt = `You are a cover critic. Look at this news cover image.

Question 1: What is this cover PRAISING or CELEBRATING? (one sentence)
Question 2: What story does the viewer think this is about? (one sentence)

Target: This cover should praise: "${celebratedTarget}"

Return JSON:
{
  "coverPraises": "what the cover is praising/celebrating",
  "viewerThinks": "what story viewer thinks this is",
  "storyMatch": 0-10,
  "isCorrectPraise": true/false,
  "dominantVisual": "what takes most space",
  "reason": "why match or mismatch"
}`;

        // ★ Use GPT-4o-mini via callAI (replaces Gemini which is 503)
        const smData = await callAI({
          prompt: storyMatchPrompt,
          imageContents: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${resizedCoverBase64}`, detail: 'low' } }
          ],
          model: 'gpt-4o-mini',
          temperature: 0.3,
          maxTokens: 500,
        });
        console.log(`[AutoCover] Story Match Validator evaluated using model: gpt-4o-mini`);

        if (smData && typeof smData.storyMatch !== 'undefined') {
          storyMatchScore = smData.storyMatch;
          storyMatchReason = smData.reason;
          viewerImpression = smData.viewerThinks;
          dominantElement = smData.dominantVisual;
          coverPraises = smData.coverPraises;
          isCorrectPraise = smData.isCorrectPraise;
          if (storyMatchScore < 3) {
            console.warn(`[AutoCover] HARD REJECT: storyMatch=${storyMatchScore}/10`);
            console.warn(`[AutoCover]   Cover praises: "${coverPraises}"`);
            console.warn(`[AutoCover]   Should praise: "${celebratedTarget}"`);
            console.warn(`[AutoCover]   Viewer thinks: "${viewerImpression}"`);
          } else if (storyMatchScore < 5) {
            console.warn(`[AutoCover] Story Match LOW: ${storyMatchScore}/10`);
            console.warn(`[AutoCover] Cover praises: "${coverPraises}" | Should: "${celebratedTarget}"`);
            console.warn(`[AutoCover] Viewer: "${viewerImpression}" | Dominant: "${dominantElement}"`);
          } else {
            console.log(`[AutoCover] Story Match: ${storyMatchScore}/10 -- ${storyMatchReason}`);
          }
        }
      }
    } catch (smErr) {
      console.warn('[AutoCover] Story Match Validator error:', smErr.message);
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

    // Save all candidate images to the database cover_images gallery
    let gallerySaveList = [];
    try {
      const selectedUrls = new Set(
        [
          ...(plan.photoOrder || []),
          plan.circlePhotoIndex,
          plan.circleSmallPhotoIndex
        ]
        .filter(idx => idx !== undefined && idx !== null)
        .map(idx => imageBuffers[idx]?.url)
        .filter(Boolean)
      );

      const seenUrls = new Set();

      // 1. Downloaded images (in imageBuffers) — บันทึกเฉพาะรูปที่ผ่านการกรองโดย AI (คะแนน >= 4 และไม่ REJECT)
      imageBuffers.forEach((img, i) => {
        const scoreVal = img.curatorScore || img.score || 0;
        const roleVal = img.role || 'SUPPORT';
        
        // ★ คัดกรองอย่างเข้มงวด: ไม่บันทึกภาพที่เป็น LOW_PRIORITY หรือคะแนนต่ำลงแกลเลอรี
        if (roleVal === 'REJECT' || roleVal === 'reject' || roleVal === 'LOW_PRIORITY' || scoreVal < 4) {
          return; 
        }

        if (img.url && !seenUrls.has(img.url)) {
          seenUrls.add(img.url);
          const fd = faceDataMap?.get?.(String(i)) || { hasFaces: false, faceCount: 0 };
          
          let sourceAgent = 'google';
          const urlStr = img.url || '';
          const lowerUrl = urlStr.toLowerCase();
          if (lowerUrl.includes('youtube') || lowerUrl.includes('hunter') || urlStr.startsWith('data:') || img.source?.includes('youtube') || img.sourceAgent === 'youtube') {
            sourceAgent = 'youtube';
          } else if (lowerUrl.includes('tiktok') || img.source?.includes('tiktok') || img.sourceAgent === 'tiktok') {
            sourceAgent = 'tiktok';
          }

          gallerySaveList.push({
            url: img.url,
            sourceAgent: sourceAgent,
            role: roleVal,
            score: scoreVal,
            reason: img.reason || (img.curatorScore ? `Curator relevance: ${img.curatorScore}/10` : 'Selected candidate'),
            width: img.width || 0,
            height: img.height || 0,
            thumbnailBase64: null,
            isSelected: selectedUrls.has(img.url),
            hasFace: fd.hasFaces || false,
            faceCount: fd.faceCount || 0,
          });
        }
      });

      const { saveToGallery } = await import('@/lib/services/imageGallery');
      let finalSessionId = caseResult?.caseId || bodyCaseId || sessionId;
      if (!bodyCaseId && finalSessionId === 'CASE-001') {
        // If it falls back to CASE-001 and was not explicitly requested, use sessionId to prevent mixing.
        finalSessionId = sessionId;
      }
      const galleryTitle = newsTitle || content?.substring(0, 100) || 'Untitled';
      
      await saveToGallery(finalSessionId, galleryTitle, gallerySaveList);
      console.log(`[AutoCover] 💾 Saved ${gallerySaveList.length} images to cover_images table for session ${finalSessionId}`);
    } catch (galErr) {
      console.warn('[AutoCover] ⚠️ Failed to save to image gallery:', galErr.message);
    }

    if (gallerySaveList.length === 0) {
      gallerySaveList = imageBuffers.map((img, i) => {
        const fd = faceDataMap?.get?.(String(i)) || { hasFaces: false, faceCount: 0 };
        return {
          url: img.url,
          role: img.role || 'SUPPORT',
          score: img.score || 0,
          hasFace: fd.hasFaces || false,
          faceCount: fd.faceCount || 0,
          width: img.width || 0,
          height: img.height || 0,
        };
      });
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
      // FIX C: Cover Praising Test results
      storyMatchScore: storyMatchScore ?? null,
      storyMatchReason: storyMatchReason ?? null,
      viewerImpression: viewerImpression ?? null,
      dominantElement: dominantElement ?? null,
      coverPraises: coverPraises ?? null,
      isCorrectPraise: isCorrectPraise ?? null,
      // storyMismatch: true = HARD REJECT (score < 3) -- UI should show warning
      storyMismatch: storyMatchScore !== null && storyMatchScore < 3,
      // coverPraising: viewer impression when score is LOW (< 5)
      ...(storyMatchScore !== null && storyMatchScore < 5 ? { coverPraising: viewerImpression } : {}),
      // Gallery: all fetched images + role/score (thumbnails generated later)
      gallery: gallerySaveList.map((img, i) => ({
        index: i,
        url: img.url || null,
        role: img.role || 'SUPPORT',
        score: img.score || 0,
        hasFace: img.hasFace || false,
        faceCount: img.faceCount || 0,
        width: img.width || 0,
        height: img.height || 0,
      })),
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
// ★ AI Content Curator — The "brain" that reviews content + images before assigning to slots
// Reviews all downloaded images + news content → determines which images are truly relevant to the news
// =============================================
async function curateImagesForCover(imageBuffers, newsTitle, newsContent, identity, templateSpec, faceDataMap = null) {
  try {
    if (!imageBuffers || imageBuffers.length < 2) return null;
    
    const { callAI } = await import('@/lib/ai/openai');
    
    // Create sharper thumbnails for Vision API (to help AI clearly distinguish faces and AI-generated images)
    const thumbnails = [];
    for (let i = 0; i < Math.min(imageBuffers.length, 8); i++) { // Limit to 8 most important images
      try {
        const thumb = await sharp(imageBuffers[i].buffer)
          .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
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
    
    // Find the index of the image used as the Hero Face Reference for the main character
    let heroRefIndex = 0;
    let foundHeroRef = false;
    
    if (faceDataMap) {
      // 1. First try to find a single-face image (faceCount = 1) to ensure it's the main character
      for (const thumb of thumbnails) {
        const faceData = faceDataMap.get(String(thumb.index));
        if (faceData && faceData.hasFaces && faceData.faceCount === 1) {
          heroRefIndex = thumb.index;
          foundHeroRef = true;
          break;
        }
      }
      // 2. If no single-face image found, use any image with faces (faceCount > 0)
      if (!foundHeroRef) {
        for (const thumb of thumbnails) {
          const faceData = faceDataMap.get(String(thumb.index));
          if (faceData && faceData.hasFaces && faceData.faceCount > 0) {
            heroRefIndex = thumb.index;
            foundHeroRef = true;
            break;
          }
        }
      }
    }
    
    if (foundHeroRef) {
      console.log(`[Curator] 🎯 Resolved Hero face reference index: #${heroRefIndex} (${identity?.mainCharacter || 'main character'})`);
    } else {
      console.log(`[Curator] ⚠️ No clear Hero face reference detected. Defaulting reference to image #0.`);
    }
    
    // Build slot description from template
    const slotDesc = templateSpec?.slots?.map(s => `${s.id} (${s.role})`).join(', ') || 'main (hero), bg_top (scene), bg_bottom (scene/emotion), highlight';
    const hasCircle = !!templateSpec?.circle;
    
    // ★ Build imageContents array for Vision API (use detail: auto for higher clarity in face recognition)
    const imageContents = thumbnails.map((t, idx) => ({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${t.base64}`, detail: 'auto' }
    }));
    
    // ★ Prompt: AI reviews news content + images then ranks them — emphasis on "visual storytelling"
    // ★ Inject subjects (characters) into prompt for subject-matching
    const subjectsForPrompt = [
      identity?.mainCharacter,
      identity?.secondaryCharacter,
      ...(identity?.characters || []),
    ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 5);
    const subjectsStr = subjectsForPrompt.length > 0
      ? subjectsForPrompt.join(', ')
      : 'ไม่ระบุ';
      
    const faceReferenceInstruction = foundHeroRef
      ? `- **Image #${heroRefIndex}** is the real photograph of the main character in this news story: "${identity?.mainCharacter || 'ไม่ระบุ'}" (this is the Hero Face Reference image)
- Strictly compare the face of every person in all other images (#0 to #${thumbnails.length - 1}, except #${heroRefIndex}) against the person in image #${heroRefIndex}!
- If a person in any image has clearly different facial features, bone structure, gender, or skin tone from the person in image #${heroRefIndex} (e.g., image #${heroRefIndex} shows a dark-skinned male but another image shows a fair-skinned male or a random female), or they appear to be a different person -> set relevance = 0 and recommend role "REJECT" immediately!
- The system requires ONLY images of people who are actual characters in the news story. NEVER include images of unrelated people or other celebrities who are not the character in image #${heroRefIndex} on the cover!`
      : `- No single clear face photo was detected to serve as a Hero Reference for this story.
- Please select images based on relevance to the main character "${identity?.mainCharacter || 'ไม่ระบุ'}" and the core news topic carefully. NEVER include unrelated people or random celebrities.`;

    const prompt = `You are a "Content Curator and Art Director" for viral news covers.
Review the ${thumbnails.length} images above (image #0 to #${thumbnails.length - 1} in order).

## News Content:
📰 Headline: "${newsTitle || 'ไม่ระบุ'}"
📝 Summary: "${(newsContent || '').slice(0, 500)}"

## ★★★ Face Reference Matching Rule:
${faceReferenceInstruction}

## ★★★ Main Subjects (people in the news): ${subjectsStr}
Anyone NOT related to these subjects = stranger → relevance <= 2!

## Main Character (Hero): ${identity?.mainCharacter || 'ไม่ระบุ'}
## ★★★ STORY SUBJECT (what the news is actually about — MOST IMPORTANT!): ${identity?._storySubject || identity?.coreStory?.storySubject || identity?.coreStory?.relationship || 'ไม่ระบุ'}
   → Images showing this STORY SUBJECT must score 8-10!
   → Hero-only images WITHOUT the Story Subject → score ≤ 5 only!
## Location: ${identity?.location || 'ไม่ระบุ'}
## Key Issues/Scenes: ${identity?.keyScenes?.join(', ') || identity?.story?.substring(0, 100) || 'ไม่ระบุ'}

## Layout slots: ${slotDesc}${hasCircle ? ' + circle slot' : ''}

## ★★★ MOST IMPORTANT PRINCIPLE: Images MUST be relevant to the news!
A great viral news cover must "tell the story" through images — not just pile up pretty photos of the person!

★★★ IRON RULES FOR RELEVANCE:
- Hero (1 image): A beautiful portrait is allowed even if not directly in news context → score 8-10
- ALL other images: ★ MUST directly relate to the "news content"! ★
  - Beautiful but news-irrelevant images (beach scenery, fashion, travel, lifestyle) → score ≤ 3 only!
  - Images directly related to the news (activities in the news, locations in the news, people in the news) → score ≥ 7

★★★ SCORING GUIDE — STORY SUBJECT FOCUS (HIGHEST PRIORITY):
Give HIGH score (8-10) to images that:
- Clearly show the STORY SUBJECT: "${identity?._storySubject || identity?.coreStory?.storySubject || identity?.coreStory?.relationship || 'ไม่ระบุ'}"
- Show Hero + Story Subject together (family, relationship photos)
- Capture the KEY moment/emotion of this specific news event

Give MEDIUM score (5-7) to images that:
- Show the main character (Hero) in context that relates to the news
- Show secondary characters related to the news

Give LOW score (1-4) to images that:
- Show ONLY the Hero in unrelated context (fashion, event, red carpet) with NO story subject → score ≤ 4!
- Are generic glamour/fashion shots of the hero alone → score 3
- Show only backgrounds/locations without people (EXCEPTION: if the location/background/object IS the STORY_SUBJECT itself, e.g., the house of the main character, the school being donated, then give it a high score 8-10!)
- Show people who are NOT subjects of this news story → score ≤ 2

★★★ CRITICAL RULE:
- Hero alone (portrait/glamour/fashion unrelated to the news) → score ≤ 4! NEVER give 8-10!
- Hero + story subject (child/mother/family together) → score 9-10!

Example: News "ก้อยรัชวิน บริจาค 5 แสนให้โรงเรียน" (celebrity donates 500K to school)
- Photo of ก้อย at the beach → score 2 (beautiful but news-irrelevant)
- Photo of ก้อย in fashion outfit → score 2 (beautiful but news-irrelevant)
- Photo of ก้อย with students → score 9 (directly related to donation news)
- Photo of โรงเรียนบ้านขุนสมุทร → score 9 (location in the news)
- Photo of ก้อย handing over money → score 10 (KEY_ACTIVITY matches the news)

Example: News "น้องทาเรีย ลูกน้ำฝน สวยเหมือนแม่" (daughter looks like celebrity mother)
- Photo of น้ำฝน alone at the beach → score 3 (irrelevant)
- Photo of น้ำฝน with น้องทาเรีย → score 9 (RELATIONSHIP matches the news)
- Photo of น้องทาเรีย clear face → score 10 (main character of the story)
- Photo of น้ำฝน in her younger days → score 7 (beauty comparison, relevant to the news)

## Available Roles:
- HERO_FACE: Clear solo close-up face of the main character (e.g., หมอโบว์ alone, smiling/facing camera) — allowed to be visually appealing even if slightly off-topic
- OCCUPATION_WORK: Main character in professional role/work uniform/working (e.g., หมอโบว์ wearing blue scrubs, green hair cap, working in clinic/examination room)
- CO_CHARACTER_EMOTION: Clear solo face of an important co-character (e.g., mother with Alzheimer's) to convey drama/exhaustion/emotion in the story
- RELATIONSHIP: Image showing intimate, warm relationship between people in the news (e.g., หมอโบว์ hugging her mother, cheek to cheek, smiling with eyes closed happily)
- KEY_ACTIVITY: Main activity that IS the news story (e.g., หมอโบว์ feeding her mother, supporting her, providing care)
- CONTEXT_SCENE: Location/event setting in the news (school, farm, house, hospital)
- TIMELINE_PAST: Character in the past/younger days
- EVIDENCE: Evidence, signs, documents
- EMOTION: Other standalone emotional images related to the news
- PERSON_SUPPORT: Other characters in news-related context (★ NOT just pretty photos!)

## ZERO TOLERANCE RULES:
1. ★★★ Beautiful but news-irrelevant images → relevance ≤ 3! (NEVER give 7!)
2. ★ Choose DIVERSE roles — do NOT assign only HERO + PERSON_SUPPORT!
3. ★ If the news involves an activity/location → there MUST be a KEY_ACTIVITY or CONTEXT_SCENE
4. ★ If the news involves a relationship → there MUST be a RELATIONSHIP role
5. ★★ PERSON_SUPPORT images with no news context (generic photos/fashion/lifestyle) → relevance ≤ 3
6. ⚠️⚠️⚠️ ⛔ ZERO TOLERANCE — NO overlaid text/graphics allowed ⛔ (HIGHEST PRIORITY!):
   - NEVER select images with large overlaid text or floating text on the image (e.g., red/yellow news headlines, subtitle speech bubbles, news ticker bars at the bottom, price tags/numbers like "10 ล้าน", news channel logos, YouTube thumbnail text) → set relevance = 0 and recommend role "REJECT" immediately! NEVER place in any slot!
   - Only allow "clean" images with no overlaid text/graphics whatsoever
   - Natural signs at real locations (e.g., real house number signs, real school name signs, license plates) are allowed as EVIDENCE or CONTEXT_SCENE and can score high (>= 7)
7. ⚠️⚠️⚠️ ⛔ ZERO TOLERANCE — NO elephant/animal treatment images for family news ⛔:
   - If the news is about family love / filial piety / caring for a mother with Alzheimer's (NOT about elephant tourism) → NEVER score elephant images, elephant care equipment, jungle elephant scenes, or veterinary animal treatment!
   - Any image containing elephants or animal treatment (even slightly visible) → set relevance = 0 and recommend role "REJECT" immediately!
8. ⚠️⚠️⚠️ ⛔ ZERO TOLERANCE — NO AI-generated / 3D / drawn / synthetic images ⛔:
   - Inspect carefully: NEVER select images with unnaturally smooth skin (highly smoothed/airbrushed plastic skin), perfect lighting/shadows as if generated by Midjourney/Stable Diffusion, distorted fingers/proportions, or drawings/cartoons/3D models/anime → set relevance = 0 and recommend role "REJECT" immediately! We require REAL camera photographs only!
9. ⚠️⚠️⚠️ ⛔ ZERO TOLERANCE — NO strangers or wrong-person images ⛔:
   - Check main character (Hero) name: "${identity?.mainCharacter || 'ไม่ระบุ'}"
   - If this is a single-person news story (no named secondary character) such as a story about "กัน นภัทร" or "แม่ทัพกุ้ง" → NEVER select face images of strangers or random other people (e.g., other celebrities, random models, random women) who are not the protagonist and not actual characters in the news!
   - If an image prominently features a stranger → set relevance <= 2 and recommend role "REJECT" immediately!
10. ★ Images of people NOT in the news (strangers, other celebrities) → relevance ≤ 2

Respond in JSON (★★ MUST score EVERY image, do NOT skip any!):
{"curated": [
  {"index": 0, "relevance": 10, "recommendedRole": "HERO_FACE", "reason": "Clear face, main character"},
  {"index": 1, "relevance": 9, "recommendedRole": "KEY_ACTIVITY", "reason": "Donation photo, matches the news"},
  {"index": 2, "relevance": 2, "recommendedRole": "PERSON_SUPPORT", "reason": "Beach scenery, beautiful but news-irrelevant"},
  ...score ALL images #0 - #${thumbnails.length - 1}...
],
"artDirection": {
  "heroIndex": <index of Hero image — professional clear-face portrait/interview/news shot, NOT selfie, NO watermark>,
  "circleIndex": <index of circle image — relationship photo of 2 people (couple/family) or a single warm image>,
  "highlightIndex": <index of highlight image — key activity (caregiving, feeding, donating, family together)>,
  "secondaryPersonIndex": <index of 2nd person or null>,
  "bgIndices": [<indices for background — location/story context>],
  "rejectIndices": [<indices to NEVER use — AI images/watermark/strangers>],
  "heroReason": "Brief reason for choosing this Hero image",
  "circleReason": "Brief reason for choosing this Circle image"
}}

## ★★★ ART DIRECTOR DECISIONS ★★★
In addition to relevance scoring, make the following Art Director decisions.
Review ALL images and decide like a professional cover layout designer:
1. Hero image (main): Must be a professional clear-face shot (portrait/interview/news) — NOT a selfie, NO watermark
2. Circle image: Relationship photo of 2 people (couple/family) or a single warm image
3. Highlight image (rectangle): Key activity image (caregiving, feeding, donating, family together)
4. Background image: Location/story context
5. Secondary person image (bottom-right): Another relevant person (mother, father, recipient)

## ★★★ CIRCLE SLOT RULES (if layout has circle):
- Circle must show exactly 1 person who is a main subject: ${subjectsStr}
- Image for circle must have relevance >= 6
- NEVER select teenager/child/stranger images that are NOT a subject
- NEVER select group photos (>1 person) for circle
- If no image matches subjects with relevance >= 6 → reuse the HERO_FACE image (duplication is allowed)

★★★ CRITICAL RULES:
- MUST include an entry for EVERY image (index 0 to ${thumbnails.length - 1}), do NOT skip any!
- Stock photos / studio shots / graphics → relevance <= 2
- Images of people NOT in the news → relevance <= 2
- ★★★ Images of news characters but in unrelated context (lifestyle/fashion/travel) → relevance <= 3

## ★★★ STORY WEIGHT SCORING (MOST IMPORTANT):

This news story has the following weight distribution:
${JSON.stringify(identity?.coreStory?.storyWeight || {})}

Items that must NEVER score high (negativeFocus):
${(identity?.coreStory?.negativeFocus || []).join(', ') || 'ไม่มี'}

## 🧠 SMART KEYWORDS (AI-analyzed from news content):
Story Theme: "${identity?._smartQueryTheme || identity?.coreStory?.celebratedAction || 'ไม่ระบุ'}"
Keywords: ${(identity?._smartQueryKeywords || []).join(', ') || 'N/A'}
Search Queries used to find these images:
${(identity?.coreImageQueries || []).slice(0, 8).map((q, i) => `  ${i+1}. "${q}"`).join('\n') || '  (none)'}

★ Images matching these keywords → HIGH score (8-10)!
★ Images not matching any keyword → LOW score (≤ 3)!

STORY MATCH RULES:
- Images reflecting the core story (relationship/sacrifice/caregiving) → HIGH score (8-10)
- Images reflecting only context/occupation → score ≤ 4 always
- Images where a negativeFocus item is the dominant subject → score ≤ 2

Ask yourself before scoring each image:
"If a viewer sees this image on the cover, will they understand what this news story is about?"
If the answer does NOT match the core story → score must be LOW`;

    console.log(`[Curator] 🧠 Analyzing ${thumbnails.length} images against news content...`);
    
    const response = await callAI({
      prompt,
      imageContents,
      model: 'gpt-5.5',
      temperature: 0.1,
      maxTokens: 2000,
      systemPrompt: 'You are an AI Art Director and Content Curator for viral news covers. Analyze all images and make decisions like a professional cover layout designer. Respond with JSON only.',
    });

    // Parse response (callAI in openai.js already parses JSON)
    let parsed = null;
    let artDirection = null;
    
    if (response && typeof response === 'object') {
      // callAI already parsed JSON
      parsed = response.curated || response;
      artDirection = response?.artDirection || null;
      if (artDirection) {
        console.log(`[ArtDirector] ★ Hero: #${artDirection.heroIndex}, Circle: #${artDirection.circleIndex}, Highlight: #${artDirection.highlightIndex}`);
        console.log(`[ArtDirector]   Hero reason: ${artDirection.heroReason}`);
        console.log(`[ArtDirector]   Circle reason: ${artDirection.circleReason}`);
        if (artDirection.rejectIndices?.length > 0) {
          console.log(`[ArtDirector]   Reject indices: ${artDirection.rejectIndices.join(', ')}`);
        }
      }
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
    
    // ★★★ FIX 1.1: CURATOR RANK-ONLY MODE ★★★
    // Curator ไม่มีสิทธิ์ฆ่าภาพอีกต่อไป — ได้แค่จัดลำดับ!
    // เฉพาะ Zero Tolerance (text overlay, AI-generated, คนผิดชัดเจน relevance=0) 
    // ถึงจะถูกลดเป็น LOW_PRIORITY
    
    // ★ Judge Score Protection — ยังคงใช้
    for (const item of validItems) {
      const img = imageBuffers[item.index];
      const judgeScore = img?.score || 0;
      if (judgeScore >= 7 && (item.relevance || 0) < 3) {
        console.log(`[Curator] ★ Judge-protected #${item.index}: relevance ${item.relevance} → 3 (Judge gave ${judgeScore}/10)`);
        item.relevance = 3;
      }
    }
    
    // ★★★ RANK-ONLY: เรียงตาม relevance สูง→ต่ำ — ไม่ตัดออก!
    const ranked = [...validItems].sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
    
    // เฉพาะ Zero Tolerance (relevance = 0 + REJECT จาก AI) → LOW_PRIORITY
    // ภาพอื่นทั้งหมดยังอยู่ในระบบ
    for (const item of ranked) {
      if (item.recommendedRole === 'REJECT') {
        if ((item.relevance || 0) === 0) {
          // Zero Tolerance: text overlay, AI-generated, คนผิด → LOW_PRIORITY
          item.recommendedRole = 'LOW_PRIORITY';
          console.log(`[Curator] ⛔ Zero Tolerance #${item.index} (rel:0) → LOW_PRIORITY`);
        } else {
          // Curator บอก REJECT แต่ relevance > 0 → เปลี่ยนเป็น CONTEXT_SCENE (ยังใช้ได้!)
          item.recommendedRole = 'CONTEXT_SCENE';
          console.log(`[Curator] ★ Rank-mode: #${item.index} REJECT(rel:${item.relevance}) → CONTEXT_SCENE (kept in pool)`);
        }
      }
    }
    
    const finalCurated = ranked; // ★ ทุกภาพอยู่ในระบบ!
    
    console.log(`[Curator] 🎯 RANK-ONLY mode: ${validItems.length} images → ALL kept, sorted by relevance`);
    console.log(`[Curator]   Top: ${ranked.slice(0, 3).map(i => `#${i.index}(${i.relevance})`).join(', ')}`);
    console.log(`[Curator]   Bottom: ${ranked.slice(-2).map(i => `#${i.index}(${i.relevance})`).join(', ')}`);
    
    // Log all ranked results
    const contextImages = finalCurated.filter(i => 
      i.recommendedRole === 'CONTEXT_SCENE' || i.recommendedRole === 'EVIDENCE'
    );
    
    for (const item of finalCurated) {
      const marker = (item.relevance || 0) >= 5 ? '✅' : (item.relevance || 0) >= 3 ? '🟡' : '⚪';
      console.log(`[Curator] ${marker} #${item.index}: ${item.recommendedRole} (rel:${item.relevance}/10) — ${item.reason || ''}`);
    }
    console.log(`[Curator] 📊 Results: ${finalCurated.length} images ranked (ALL kept), ${contextImages.length} context/evidence`);
    
    // ★ ส่งทุกภาพออกไป — ไม่มีการ map เป็น REJECT อีกต่อไป!
    return { curated: finalCurated, artDirection: artDirection || null };
    
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
async function createModifiedBuffer(originalBuffer, mode) {
  try {
    let sh = sharp(originalBuffer);
    if (mode === 'flip') {
      sh = sh.flop();
    } else if (mode === 'zoom') {
      const meta = await sh.metadata();
      if (meta.width && meta.height) {
        const w = Math.round(meta.width * 0.7);
        const h = Math.round(meta.height * 0.7);
        const left = Math.round((meta.width - w) / 2);
        const top = Math.round((meta.height - h) / 2);
        sh = sh.extract({ left, top, width: w, height: h });
      }
    } else if (mode === 'zoom-left') {
      const meta = await sh.metadata();
      if (meta.width && meta.height) {
        const w = Math.round(meta.width * 0.65);
        const h = Math.round(meta.height * 0.65);
        const left = Math.round(meta.width * 0.05);
        const top = Math.round((meta.height - h) / 2);
        sh = sh.extract({ left, top, width: w, height: h });
      }
    } else if (mode === 'zoom-right') {
      const meta = await sh.metadata();
      if (meta.width && meta.height) {
        const w = Math.round(meta.width * 0.65);
        const h = Math.round(meta.height * 0.65);
        const left = Math.round(meta.width * 0.3);
        const top = Math.round((meta.height - h) / 2);
        sh = sh.extract({ left, top, width: w, height: h });
      }
    }
    return await sh.toBuffer();
  } catch (err) {
    console.error('[createModifiedBuffer] Error:', err.message);
    return originalBuffer;
  }
}

async function cropFaceTightly(buffer, face) {
  try {
    let sh = sharp(buffer);
    const meta = await sh.metadata();
    if (meta.width && meta.height && face) {
      const padW = Math.round(face.width * 0.3);
      const padH = Math.round(face.height * 0.3);
      
      const left = Math.round(Math.max(0, face.x - padW));
      const top = Math.round(Math.max(0, face.y - padH));
      const width = Math.round(Math.min(meta.width - left, face.width + 2 * padW));
      const height = Math.round(Math.min(meta.height - top, face.height + 2 * padH));
      
      const size = Math.round(Math.min(width, height));
      if (size > 50) {
        sh = sh.extract({ left, top, width: size, height: size });
      }
    }
    return await sh.toBuffer();
  } catch (err) {
    console.error('[cropFaceTightly] Error:', err.message);
    return await createModifiedBuffer(buffer, 'zoom');
  }
}

// (Maintained by Character Focus Rule above — hero is guaranteed to have a face)
async function assignImagesToSlots(imageBuffers, faceDataMap, templateId, identity, coverReferences, artDirection = null) {
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

    // ★ Define negative focus terms at the top for reuse
    const negFocusTerms = identity?.coreStory?.negativeFocus || [];
    const coreStoryAnchor = identity?.coreStory?.sacrifice || identity?.coreStory?.relationship || null;
    const isNegativeImage = (imgIdx) => {
      const img = imageBuffers[imgIdx];
      if (!img) return false;
      if (img.role === 'LOW_PRIORITY' || img.role === 'low_priority') return true;
      
      const cat = (img.evidenceCat || '').toLowerCase();
      const textToCheck = `${img.url || ''} ${img.role || ''} ${img.evidenceCat || ''} ${img.title || ''} ${img.snippet || ''}`.toLowerCase();
      
      // ★ Hardcoded fallback safeguard: ถ้าเรื่องหลักคือการดูแลแม่อัลไซเมอร์ แต่ภาพมีช้างหรือรักษาสัตว์
      const titleToCheck = (identity?._newsTitle || identity?.story || '').toLowerCase();
      const contentToCheck = (identity?._newsContent || '').toLowerCase();
      const isAlzheimerStory = titleToCheck.match(/อัลไซเมอร์|ดูแลแม่|แม่ป่วย|ป่วยหนัก|ค่าน้ำนม/) || 
                               contentToCheck.match(/อัลไซเมอร์|ดูแลแม่|แม่ป่วย|ป่วยหนัก|ค่าน้ำนม/);
      if (isAlzheimerStory) {
        const hasElephantOrVet = textToCheck.match(/ช้าง|elephant|สัตวแพทย์|รักษาสัตว์|หมอช้าง|vet|veterinary|animal/);
        if (hasElephantOrVet) {
          console.log(`[isNegativeImage] 🐘 Safeguard triggered: elephant/vet image #${imgIdx} marked negative for Alzheimer story`);
          // Set curator score to 0 to prevent accidental usage in other fallback logic
          img.curatorScore = 0;
          img.role = 'LOW_PRIORITY';
          return true;
        }
      }

      const matchesNegative = negFocusTerms.some(neg => {
        const cleanNeg = neg.toLowerCase();
        if (textToCheck.includes(cleanNeg)) return true;
        
        // ตรวจคีย์เวิร์ดช้าง (Elephant)
        if (cleanNeg.includes('elephant') || cleanNeg.includes('ช้าง')) {
          if (textToCheck.includes('ช้าง') || textToCheck.includes('elephant') || cat.includes('elephant')) return true;
        }
        // ตรวจคีย์เวิร์ดสัตวแพทย์/รักษาสัตว์ (Veterinary/vet)
        if (cleanNeg.includes('vet') || cleanNeg.includes('veterinary') || cleanNeg.includes('animal') || cleanNeg.includes('สัตวแพทย์') || cleanNeg.includes('รักษาสัตว์')) {
          if (textToCheck.includes('สัตวแพทย์') || textToCheck.includes('รักษาสัตว์') || textToCheck.includes('หมอรักษาสัตว์') || textToCheck.includes('สัตว์') || textToCheck.includes('vet') || cat.includes('work')) return true;
        }
        return false;
      });

      if (matchesNegative) {
        img.curatorScore = 0;
        img.role = 'LOW_PRIORITY';
      }

      if (cat === 'work' && matchesNegative) {
        return true;
      }

      return matchesNegative;
    };

    // จัดกลุ่มภาพตาม role
    const byRole = {
      HERO_FACE: [],
      HERO: [],
      OCCUPATION_WORK: [], // ภาพอาชีพ/ชุดทำงาน
      CO_CHARACTER_EMOTION: [], // ภาพหน้าตัวละครร่วมเด่น (แม่)
      PERSON_SUPPORT: [],
      CONTEXT_SCENE: [],
      KEY_ACTIVITY: [], // แยก KEY_ACTIVITY ออกมาจาก CONTEXT_SCENE
      EVIDENCE: [],
      EMOTION: [],
      RELATIONSHIP: [],
      SUPPORT: [],
      NEGATIVE: [], // Separate pool for negative images
    };

    imageBuffers.forEach((img, i) => {
      const role = img.role || 'SUPPORT';
      const faceData = faceDataMap.get(String(i)) || { hasFaces: false, faceCount: 0 };
      
      if (isNegativeImage(i)) {
        byRole.NEGATIVE.push({ index: i, faceData, role });
      } else if (role === 'HERO_FACE' || role === 'HERO') {
        byRole.HERO_FACE.push({ index: i, faceData, role });
      } else if (role === 'OCCUPATION_WORK') {
        byRole.OCCUPATION_WORK.push({ index: i, faceData, role });
      } else if (role === 'CO_CHARACTER_EMOTION') {
        byRole.CO_CHARACTER_EMOTION.push({ index: i, faceData, role });
      } else if (role === 'PERSON_SUPPORT') {
        byRole.PERSON_SUPPORT.push({ index: i, faceData, role });
      } else if (role === 'KEY_ACTIVITY') {
        byRole.KEY_ACTIVITY.push({ index: i, faceData, role });
      } else if (role === 'CONTEXT_SCENE') {
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

    // ★★★ AI Art Director Override: ถ้ามี artDirection จาก GPT-5.5 → ใช้ AI ตัดสินใจแทน rule-based logic
    if (artDirection && artDirection.heroIndex !== undefined && artDirection.heroIndex !== null) {
      console.log(`[assignSlots] ★★★ Using AI Art Director decisions (GPT-5.5) instead of rule-based logic`);
      
      // Validate indices are within bounds
      const maxIdx = imageBuffers.length - 1;
      const validIdx = (idx) => typeof idx === 'number' && idx >= 0 && idx <= maxIdx && !isNegativeImage(idx);
      
      // Hero
      if (validIdx(artDirection.heroIndex)) {
        heroIndex = artDirection.heroIndex;
        console.log(`[assignSlots] ★ Art Director Hero: #${heroIndex} — ${artDirection.heroReason || 'AI selected'}`);
      }
      
      // Circle
      if (hasCircle && validIdx(artDirection.circleIndex)) {
        circleIndex = artDirection.circleIndex;
        console.log(`[assignSlots] ★ Art Director Circle: #${circleIndex} — ${artDirection.circleReason || 'AI selected'}`);
      }
      
      // Build photoOrder from artDirection
      const usedByAD = new Set([heroIndex]);
      if (circleIndex !== undefined) usedByAD.add(circleIndex);
      
      // Slot 0 = hero
      photoOrder = [heroIndex];
      
      // Highlight slot
      if (validIdx(artDirection.highlightIndex) && !usedByAD.has(artDirection.highlightIndex)) {
        photoOrder.push(artDirection.highlightIndex);
        usedByAD.add(artDirection.highlightIndex);
        console.log(`[assignSlots] ★ Art Director Highlight: #${artDirection.highlightIndex}`);
      }
      
      // Secondary person
      if (validIdx(artDirection.secondaryPersonIndex) && !usedByAD.has(artDirection.secondaryPersonIndex)) {
        photoOrder.push(artDirection.secondaryPersonIndex);
        usedByAD.add(artDirection.secondaryPersonIndex);
        console.log(`[assignSlots] ★ Art Director Secondary Person: #${artDirection.secondaryPersonIndex}`);
      }
      
      // Background indices
      if (Array.isArray(artDirection.bgIndices)) {
        for (const bgIdx of artDirection.bgIndices) {
          if (validIdx(bgIdx) && !usedByAD.has(bgIdx)) {
            photoOrder.push(bgIdx);
            usedByAD.add(bgIdx);
          }
        }
      }
      
      // Fill remaining slots from high-scoring images
      const remainingForAD = imageBuffers
        .map((img, i) => ({ index: i, score: img.curatorScore || 0 }))
        .filter(x => !usedByAD.has(x.index) && !isNegativeImage(x.index) && x.score >= 4)
        .sort((a, b) => b.score - a.score);
      
      while (photoOrder.length < slotCount && remainingForAD.length > 0) {
        const next = remainingForAD.shift();
        photoOrder.push(next.index);
        usedByAD.add(next.index);
      }
      
      // Apply reject indices
      if (Array.isArray(artDirection.rejectIndices)) {
        for (const rejIdx of artDirection.rejectIndices) {
          if (typeof rejIdx === 'number' && rejIdx >= 0 && rejIdx <= maxIdx) {
            imageBuffers[rejIdx].role = 'REJECT';
            imageBuffers[rejIdx].curatorScore = 0;
          }
        }
      }
      
      console.log(`[assignSlots] ★ Art Director final: Hero=#${heroIndex}, Circle=#${circleIndex}, PhotoOrder=${JSON.stringify(photoOrder)}`);
      
      return {
        photoOrder,
        circleIndex: circleIndex !== undefined ? circleIndex : 0,
        circleSmallIndex: undefined,
        heroIndex,
      };
    }
    
    // ★ Fallback: ไม่มี artDirection → ใช้ rule-based logic ปกติ
    if (hasRoles) {
      // ★★★ Hero: Viral Cover Pattern — ALWAYS the best quality single-face professional photo
      // Priority: single face > high resolution > HERO_FACE with curatorScore>=6 > penalize selfie
      const heroCandidates = [...byRole.HERO_FACE, ...byRole.HERO];
      // ★ Also consider high-scoring non-hero candidates with single clear face (ภาพดีที่ AI ไม่ได้ tag HERO)
      const heroExpandedPool = [
        ...heroCandidates,
        ...byRole.CO_CHARACTER_EMOTION.filter(x => x.faceData.faceCount === 1 && (imageBuffers[x.index]?.curatorScore || 0) >= 7),
        ...byRole.PERSON_SUPPORT.filter(x => x.faceData.faceCount === 1 && (imageBuffers[x.index]?.curatorScore || 0) >= 7),
      ];

      if (heroExpandedPool.length > 0) {
        // ★ Weighted scoring system for hero selection (viral cover patterns)
        const heroScored = heroExpandedPool.map(candidate => {
          const img = imageBuffers[candidate.index];
          const curatorScore = img?.curatorScore || 0;
          const faceCount = candidate.faceData.faceCount || 0;
          const imgWidth = img?.width || img?.naturalWidth || 0;
          let totalScore = 0;

          // Rule 1: Prefer single face (faceCount === 1)
          if (faceCount === 1) totalScore += 40;
          else if (faceCount > 1) totalScore += 10; // multiple faces = less ideal for hero
          else totalScore += 0; // no face at all

          // Rule 2: Prefer higher resolution (width > 600px)
          if (imgWidth > 800) totalScore += 25;
          else if (imgWidth > 600) totalScore += 20;
          else if (imgWidth > 400) totalScore += 10;

          // Rule 3: Penalize selfie-like images (PERSON_SUPPORT role)
          if (candidate.role === 'PERSON_SUPPORT') totalScore -= 30;

          // Rule 4: Strong preference for HERO_FACE with curatorScore >= 6
          if (candidate.role === 'HERO_FACE' && curatorScore >= 6) totalScore += 60;
          else if (candidate.role === 'HERO_FACE') totalScore += 30;
          else if (candidate.role === 'HERO') totalScore += 20;

          // Curator relevance score (0-10 → 0-30 points)
          totalScore += curatorScore * 3;

          // Scraper quality score as tie-breaker
          totalScore += (img?.score || 0) * 0.5;

          return { ...candidate, totalScore };
        });

        heroScored.sort((a, b) => b.totalScore - a.totalScore);
        heroIndex = heroScored[0].index;
        console.log(`[assignSlots] ★ Hero scored: ${heroScored.slice(0, 3).map(h => `#${h.index}(${h.totalScore.toFixed(1)})`).join(', ')}`);
      } else {
        // ไม่มี HERO → หาภาพที่มีความเกี่ยวข้องสูงสุด (score) และหน้าชัด (และไม่ใช่ negative image)
        const withFace = imageBuffers.map((img, i) => ({
          index: i,
          score: img.curatorScore || 0,
          faceData: faceDataMap.get(String(i)) || { hasFaces: false, faceCount: 0 },
          role: img.role || 'SUPPORT',
        })).filter(x => x.faceData.hasFaces && !isNegativeImage(x.index)).sort((a, b) => {
          // ★ Weighted sort: single face + high curator score + not selfie
          const aW = (a.faceData.faceCount === 1 ? 40 : 0) + a.score * 3 + (a.role === 'PERSON_SUPPORT' ? -30 : 0);
          const bW = (b.faceData.faceCount === 1 ? 40 : 0) + b.score * 3 + (b.role === 'PERSON_SUPPORT' ? -30 : 0);
          return bW - aW;
        });
        
        if (withFace.length > 0) {
          heroIndex = withFace[0].index;
        } else {
          // ★ Fallback: หาภาพที่เกี่ยวข้องสูงสุด (score) ที่ไม่ใช่ negative image แม้ไม่มีหน้าคนก็ยอม!
          const withoutFace = imageBuffers.map((img, i) => ({
            index: i,
            score: img.curatorScore || 0,
          })).filter(x => !isNegativeImage(x.index)).sort((a, b) => b.score - a.score);
          
          heroIndex = withoutFace.length > 0 ? withoutFace[0].index : 0;
        }
      }

      // Circle: ★★★ Smart Slot Assignment
      // ★ FIX: Circle ต้องเป็นภาพหน้า 1 คนชัด — ห้ามใช้ภาพโซเชลฟี่/กลุ่มที่มีคนมากกว่า 1
      if (hasCircle) {
        // ★★★ Circle: Viral Cover Pattern — ALWAYS a relationship photo (couple, parent-child, 2 people together)
        // NEVER select an image with watermark for circle
        const hasWatermark = (idx) => {
          const img = imageBuffers[idx];
          if (!img) return false;
          const text = `${img.url || ''} ${img.title || ''} ${img.snippet || ''}`.toLowerCase();
          return text.includes('watermark') || text.includes('ลายน้ำ') || img.hasWatermark === true;
        };

        // ★ FIRST priority: images with exactly 2 faces (relationship/couple photo) — THE viral circle pattern
        const twoFaceRelationship = [
          ...byRole.RELATIONSHIP,
          ...byRole.CO_CHARACTER_EMOTION,
          ...byRole.EMOTION,
          ...byRole.KEY_ACTIVITY,
          ...byRole.HERO_FACE,
          ...byRole.HERO,
          ...byRole.PERSON_SUPPORT,
        ]
          .filter(x => x.index !== heroIndex
            && x.faceData.faceCount === 2
            && !isNegativeImage(x.index)
            && !hasWatermark(x.index)
            && (imageBuffers[x.index]?.curatorScore || 0) >= 3)
          .sort((a, b) => {
            // Prefer RELATIONSHIP role first, then by curatorScore
            const roleBonus = (r) => r === 'RELATIONSHIP' ? 20 : (r === 'CO_CHARACTER_EMOTION' ? 10 : 0);
            const aW = roleBonus(a.role) + (imageBuffers[a.index]?.curatorScore || 0) * 3;
            const bW = roleBonus(b.role) + (imageBuffers[b.index]?.curatorScore || 0) * 3;
            return bW - aW;
          });

        // ★ SECOND priority: RELATIONSHIP role images with score >= 4 (any face count)
        const relationshipScored = byRole.RELATIONSHIP
          .filter(x => x.index !== heroIndex
            && !isNegativeImage(x.index)
            && !hasWatermark(x.index)
            && (imageBuffers[x.index]?.curatorScore || 0) >= 4)
          .sort((a, b) => {
            // Prefer 2 faces, then by score
            const aFaceBonus = a.faceData.faceCount === 2 ? 50 : (a.faceData.faceCount >= 1 ? 10 : 0);
            const bFaceBonus = b.faceData.faceCount === 2 ? 50 : (b.faceData.faceCount >= 1 ? 10 : 0);
            return (bFaceBonus + (imageBuffers[b.index]?.curatorScore || 0) * 3) - (aFaceBonus + (imageBuffers[a.index]?.curatorScore || 0) * 3);
          });

        // ★ THIRD priority: CO_CHARACTER_EMOTION with face (parent-child, supporting character)
        const coCharCircle = byRole.CO_CHARACTER_EMOTION
          .filter(x => x.index !== heroIndex
            && x.faceData.hasFaces
            && !isNegativeImage(x.index)
            && !hasWatermark(x.index)
            && (imageBuffers[x.index]?.curatorScore || 0) >= 4)
          .sort((a, b) => {
            const aFaceBonus = a.faceData.faceCount === 2 ? 30 : 0;
            const bFaceBonus = b.faceData.faceCount === 2 ? 30 : 0;
            return (bFaceBonus + (imageBuffers[b.index]?.curatorScore || 0)) - (aFaceBonus + (imageBuffers[a.index]?.curatorScore || 0));
          });

        // ★ Step 4: HERO_FACE ที่มี faceCount === 1 (ไม่ใช่ hero หลัก) — single-face portrait fallback
        const singleFaceHero = [...byRole.HERO_FACE, ...byRole.HERO]
          .filter(x => x.index !== heroIndex && x.faceData.faceCount === 1 && !hasWatermark(x.index));

        // ★ Step 5: ภาพอะไรก็ได้ที่มี faceCount === 1 — ต้อง score >= 5 (last resort portrait)
        const anySingleFace = imageBuffers
          .map((img, i) => ({ index: i, faceData: faceDataMap.get(String(i)) || {}, score: img.curatorScore || 0, role: img.role }))
          .filter(x => x.index !== heroIndex && (x.faceData.faceCount === 1) && x.score >= 5
            && !isNegativeImage(x.index)
            && !hasWatermark(x.index)
            && (x.role !== 'SUPPORT' || x.score >= 7));

        // ★ Step 6 (LAST RESORT): any remaining usable image
        const anyFallback = [
          ...byRole.RELATIONSHIP,
          ...byRole.CO_CHARACTER_EMOTION,
          ...byRole.EVIDENCE,
          ...byRole.EMOTION,
          ...heroCandidates.slice(1),
          ...byRole.SUPPORT.filter(x => (imageBuffers[x.index]?.curatorScore || 0) >= 6),
        ].filter(x => x.index !== heroIndex && !hasWatermark(x.index) && (imageBuffers[x.index]?.curatorScore || 0) >= 4)
         .sort((a, b) => {
           // Prefer relationship (2 faces) even in fallback
           const aRelBonus = a.faceData.faceCount === 2 ? 100 : (a.faceData.faceCount === 1 ? 50 : 0);
           const bRelBonus = b.faceData.faceCount === 2 ? 100 : (b.faceData.faceCount === 1 ? 50 : 0);
           if (aRelBonus !== bRelBonus) return bRelBonus - aRelBonus;
           return (imageBuffers[b.index]?.curatorScore || 0) - (imageBuffers[a.index]?.curatorScore || 0);
         });

        // ★★★ Circle selection — relationship-first priority chain
        const circlePool = twoFaceRelationship.length > 0 ? twoFaceRelationship
          : relationshipScored.length > 0 ? relationshipScored
          : coCharCircle.length > 0 ? coCharCircle
          : singleFaceHero.length > 0 ? singleFaceHero
          : anySingleFace.length > 0 ? anySingleFace
          : anyFallback;

        if (circlePool.length > 0) {
          circleIndex = circlePool[0].index;
          const chosenRole = imageBuffers[circleIndex]?.role || circlePool[0].role || '?';
          const faces = faceDataMap.get(String(circleIndex))?.faceCount || 0;
          const curScore = imageBuffers[circleIndex]?.curatorScore || 0;
          const pickedStep = twoFaceRelationship.length > 0 ? '2-FACE relationship (BEST)'
            : relationshipScored.length > 0 ? 'RELATIONSHIP scored'
            : coCharCircle.length > 0 ? 'CO_CHARACTER_EMOTION'
            : singleFaceHero.length > 0 ? 'HERO single-face'
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
          const baseIndexForCircle = otherHero.length > 0 ? otherHero[0].index : heroIndex;
          
          console.log(`[assignSlots] ★ Circle: fallback — creating tightly cropped face from image #${baseIndexForCircle}`);
          const origImg = imageBuffers[baseIndexForCircle];
          if (origImg) {
            let modBuffer;
            const faceData = faceDataMap?.get?.(String(baseIndexForCircle));
            if (faceData && faceData.hasFaces && faceData.faces?.length > 0) {
              modBuffer = await cropFaceTightly(origImg.buffer, faceData.faces[0]);
            } else {
              modBuffer = await createModifiedBuffer(origImg.buffer, 'zoom');
            }
            
            const newIndex = imageBuffers.length;
            imageBuffers.push({
              ...origImg,
              buffer: modBuffer,
              isVirtual: true,
              originalIndex: baseIndexForCircle,
              modificationMode: 'circle-crop'
            });
            
            if (faceDataMap) {
              faceDataMap.set(String(newIndex), { hasFaces: true, faceCount: 1 });
            }
            
            circleIndex = newIndex;
            console.log(`[assignSlots] ★ Circle: created virtual image #${circleIndex} for slot`);
          } else {
            circleIndex = heroIndex;
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

      // เตรียม pool ภาพแยกตาม category (กรองภาพ negative ออกจาก pools ทั้งหมด)
      const MIN_SLOT_SCORE = 4; // ★ ห้ามใช้ภาพ score < 4 (ไม่เกี่ยวกับข่าว!)
      const remaining = imageBuffers
        .map((img, i) => ({ index: i, role: img.role, score: img.curatorScore || 0 }))
        .filter(x => !usedIndices.has(x.index) && !isNegativeImage(x.index));

      const isSceneRole = (r) => ['CONTEXT_SCENE', 'OCCUPATION_WORK'].includes(r);
      const isPersonRole = (r) => ['PERSON_SUPPORT', 'HERO_FACE', 'HERO', 'CO_CHARACTER_EMOTION'].includes(r);
      const isEmotionRole = (r) => ['EMOTION', 'TIMELINE_PAST', 'CO_CHARACTER_EMOTION'].includes(r);
      const isEvidenceRole = (r) => ['EVIDENCE'].includes(r);

      // ★ กรอง score >= MIN_SLOT_SCORE — ไม่เอาภาพ stock/ไม่เกี่ยว
      // ★ Tie-breaker: เรียงตามความสำคัญของ AI Curator (score) แล้วตามด้วยคุณภาพของ scraper (original score) เพื่อป้องกันภาพคนหน้าตาเบลอ/เก่า
      const sortPoolWithQuality = (pool) => {
        return pool.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          const qualA = imageBuffers[a.index]?.score || 0;
          const qualB = imageBuffers[b.index]?.score || 0;
          return qualB - qualA;
        });
      };

      const scenePool = sortPoolWithQuality(remaining.filter(x => isSceneRole(x.role) && x.score >= MIN_SLOT_SCORE));
      const occupationPool = sortPoolWithQuality(remaining.filter(x => x.role === 'OCCUPATION_WORK' && x.score >= MIN_SLOT_SCORE));
      const coCharacterPool = sortPoolWithQuality(remaining.filter(x => x.role === 'CO_CHARACTER_EMOTION' && x.score >= MIN_SLOT_SCORE));
      const activityPool = sortPoolWithQuality(remaining.filter(x => x.role === 'KEY_ACTIVITY' && x.score >= MIN_SLOT_SCORE));
      const personPool = sortPoolWithQuality(remaining.filter(x => isPersonRole(x.role) && x.score >= MIN_SLOT_SCORE));
      const emotionPool = sortPoolWithQuality(remaining.filter(x => isEmotionRole(x.role) && x.score >= MIN_SLOT_SCORE));
      const evidencePool = sortPoolWithQuality(remaining.filter(x => isEvidenceRole(x.role) && x.score >= MIN_SLOT_SCORE));
      const otherPool = sortPoolWithQuality(remaining.filter(x => ['RELATIONSHIP', 'SUPPORT', 'KEY_ACTIVITY'].includes(x.role) && x.score >= MIN_SLOT_SCORE));
      
      // ★★★ Role-aware slot assignment: จับคู่ภาพกับ slot ตาม template role
      // Slot 0 = main (hero) → จัดแล้ว = heroIndex
      // Slot 1+ = ดู role จาก template แล้วหยิบภาพที่เหมาะ
      const slotQueue = [];
      const assignedIndices = new Set();
      
      // ใช้ counters เพื่อหยิบจาก pool ไม่ซ้ำ
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
      // scene → ภาพอาชีพ/สครับ (OCCUPATION_WORK) > ภาพสถานที่ (CONTEXT_SCENE)
      // emotion → ภาพเดี่ยวตัวละครร่วมเด่น (CO_CHARACTER_EMOTION) > ภาพอารมณ์ (EMOTION)
      // highlight → ภาพกิจกรรมกตัญญู (KEY_ACTIVITY) > หลักฐาน (EVIDENCE)
      // support → ภาพอะไรก็ได้

      const counters = {
        scene: { val: 0 }, occupation: { val: 0 }, coCharacter: { val: 0 },
        activity: { val: 0 }, person: { val: 0 }, emotion: { val: 0 },
        evidence: { val: 0 }, other: { val: 0 }
      };

      for (let si = 1; si < templateSlotRoles.length && si < slotCount; si++) {
        const slotRole = templateSlotRoles[si]; // 'scene', 'emotion', 'hero2', 'highlight', 'support'
        let picked = null;

        if (slotRole === 'scene') {
          // bg_top slot: อาชีพ (OCCUPATION_WORK) > ฉากสถานที่ (CONTEXT_SCENE)
          picked = pickFromPool(occupationPool, counters.occupation);
          if (!picked) picked = pickFromPool(scenePool, counters.scene);
          if (!picked) picked = pickFromPool(evidencePool, counters.evidence);
          if (!picked) picked = pickFromPool(otherPool, counters.other);
        } else if (slotRole === 'emotion') {
          // bg_bottom slot: หน้าตัวละครร่วมเด่น (CO_CHARACTER_EMOTION) > อารมณ์ (EMOTION)
          picked = pickFromPool(coCharacterPool, counters.coCharacter);
          if (!picked) picked = pickFromPool(emotionPool, counters.emotion);
          if (!picked) picked = pickFromPool(personPool, counters.person);
        } else if (slotRole === 'hero2') {
          picked = pickFromPool(personPool, counters.person);
          if (!picked) picked = pickFromPool(emotionPool, counters.emotion);
        } else if (slotRole === 'highlight') {
          // ★★★ Highlight: Viral Cover Pattern — ALWAYS a key activity/scene (caregiving, family gathering, evidence)
          // FIRST priority: KEY_ACTIVITY images with 2+ faces (showing interaction — THE viral highlight pattern)
          const activityWithInteraction = activityPool.filter(x => {
            const fd = faceDataMap.get(String(x.index)) || { faceCount: 0 };
            return fd.faceCount >= 2 && !assignedIndices.has(x.index);
          });
          if (activityWithInteraction.length > 0) {
            picked = activityWithInteraction[0];
            assignedIndices.add(picked.index);
            console.log(`[assignSlots] ★ Highlight: KEY_ACTIVITY with ${faceDataMap.get(String(picked.index))?.faceCount} faces (interaction scene)`);
          }
          // Then try any KEY_ACTIVITY (even single person doing activity)
          if (!picked) {
            // Avoid pure portrait (1 face, no activity) — prefer images with some action context
            const activityNonPortrait = activityPool.filter(x => {
              const fd = faceDataMap.get(String(x.index)) || { faceCount: 0 };
              return !assignedIndices.has(x.index) && !(fd.faceCount === 1 && (imageBuffers[x.index]?.curatorScore || 0) < 5);
            });
            if (activityNonPortrait.length > 0) {
              picked = activityNonPortrait[0];
              assignedIndices.add(picked.index);
            } else {
              picked = pickFromPool(activityPool, counters.activity);
            }
          }
          // SECOND priority: EVIDENCE images (proof, documents, screenshots)
          if (!picked) picked = pickFromPool(evidencePool, counters.evidence);
          // THIRD: scene/person fallback (avoid solo portraits)
          if (!picked) {
            // Try scene images that aren't just a single-face portrait
            const sceneNonPortrait = scenePool.filter(x => {
              const fd = faceDataMap.get(String(x.index)) || { faceCount: 0 };
              return !assignedIndices.has(x.index) && fd.faceCount !== 1;
            });
            if (sceneNonPortrait.length > 0) {
              picked = sceneNonPortrait[0];
              assignedIndices.add(picked.index);
            } else {
              picked = pickFromPool(scenePool, counters.scene);
            }
          }
          if (!picked) picked = pickFromPool(personPool, counters.person);
        } else if (slotRole === 'support') {
          picked = pickFromPool(personPool, counters.person);
          if (!picked) picked = pickFromPool(otherPool, counters.other);
        } else {
          // Unknown role → any remaining
          picked = pickFromPool(activityPool, counters.activity)
            || pickFromPool(occupationPool, counters.occupation)
            || pickFromPool(scenePool, counters.scene)
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
      
      // เอาภาพที่เหลือทั้งหมด sort by score (กรองภาพ negative ออก)
      const fillCandidates = imageBuffers
        .map((img, i) => ({ index: i, score: img.curatorScore || 0 }))
        .filter(x => !usedInPhoto.has(x.index) && !isNegativeImage(x.index))
        .sort((a, b) => b.score - a.score);
      
      for (const c of fillCandidates) {
        if (photoOrder.length >= slotCount) break;
        photoOrder.push(c.index);
        console.log(`[assignSlots] 🔄 Fill slot ${photoOrder.length}: image #${c.index} (score: ${c.score})`);
      }
      
      // Ultimate fallback: ถ้าช่องยังไม่ครบ ค่อยยินยอมเอาภาพ non-negative มาซ้ำก่อน! (ดีกว่าเอาภาพ negative มาใส่สล็อตให้หลุดธีม)
      if (photoOrder.length < slotCount) {
        const nonNegCandidates = imageBuffers
          .map((img, i) => ({ index: i, score: img.curatorScore || 0 }))
          .filter(x => !isNegativeImage(x.index))
          .sort((a, b) => b.score - a.score);
        
        if (nonNegCandidates.length > 0) {
          let idx = 0;
          const modes = ['zoom', 'flip', 'zoom-left', 'zoom-right'];
          
          while (photoOrder.length < slotCount) {
            const c = nonNegCandidates[idx % nonNegCandidates.length];
            const mode = modes[Math.floor(idx / nonNegCandidates.length) % modes.length];
            
            console.log(`[assignSlots] 🔄 Creating modified virtual duplicate of image #${c.index} (mode: ${mode}) for slot ${photoOrder.length + 1}`);
            
            const origImg = imageBuffers[c.index];
            if (origImg) {
              const modBuffer = await createModifiedBuffer(origImg.buffer, mode);
              const newIndex = imageBuffers.length;
              imageBuffers.push({
                ...origImg,
                buffer: modBuffer,
                isVirtual: true,
                originalIndex: c.index,
                modificationMode: mode
              });
              
              if (faceDataMap) {
                const faceData = faceDataMap.get(String(c.index));
                if (faceData) {
                  faceDataMap.set(String(newIndex), { ...faceData });
                }
              }
              
              photoOrder.push(newIndex);
              console.log(`[assignSlots] 🔄 Added virtual duplicate image #${newIndex} to photoOrder`);
            } else {
              photoOrder.push(c.index);
            }
            idx++;
          }
        }
      }

      // ★ ถ้า non-negative candidates ก็หมดแล้ว → ยอมรับว่าภาพไม่พอ ไม่ดึงภาพ LOW_PRIORITY กลับมา (ดีกว่าใส่ขยะบนปก!)
      if (photoOrder.length < slotCount) {
        console.log(`[assignSlots] ⚠️ Only ${photoOrder.length}/${slotCount} clean images — refusing to use LOW_PRIORITY images on cover`);
      }

      if (photoOrder.length < slotCount) {
        console.log(`[assignSlots] ⚠️ Still only ${photoOrder.length}/${slotCount} images after fill`);
      }
    }

    // ★ FIX 5: Negative Evidence Rules — ห้าม negativeFocus อยู่ใน hero/circle slots
    // (ตอนนี้ผ่านการกรองข้างบนแล้ว แต่รักษาไว้เป็น extra guard สำรอง)
    if (negFocusTerms.length > 0) {
      console.log(`[assignSlots] ★ NEGATIVE EVIDENCE RULES active — blocked: ${negFocusTerms.join(', ')}`);
      if (coreStoryAnchor) {
        console.log(`[assignSlots] ★ CORE STORY ANCHOR: "${coreStoryAnchor}" — remaining slots must reflect this`);
      }
      // ★ Hero slot guard: ถ้า hero ตาม negativeFocus → swap กับ alt ที่มีหน้าคน
      if (heroIndex !== undefined && isNegativeImage(heroIndex)) {
        const altHero = photoOrder.find(i => i !== heroIndex && !isNegativeImage(i) && (faceDataMap?.get?.(String(i))?.hasFaces));
        if (altHero !== undefined) {
          console.warn(`[assignSlots] ⚠️ FIX5: Hero #${heroIndex} in negativeFocus → swapping to #${altHero}`);
          const heroPos = photoOrder.indexOf(heroIndex);
          const altPos = photoOrder.indexOf(altHero);
          if (heroPos >= 0 && altPos >= 0) {
            photoOrder[heroPos] = altHero;
            photoOrder[altPos] = heroIndex;
          }
          heroIndex = altHero;
        }
      }
      // ★ Circle slot guard: ถ้า circle ตาม negativeFocus → swap กับ alt
      if (circleIndex !== undefined && isNegativeImage(circleIndex)) {
        const altCircle = photoOrder.find(i => i !== heroIndex && i !== circleIndex && !isNegativeImage(i));
        if (altCircle !== undefined) {
          console.warn(`[assignSlots] ⚠️ FIX5: Circle #${circleIndex} in negativeFocus → swapping to #${altCircle}`);
          circleIndex = altCircle;
        }
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
