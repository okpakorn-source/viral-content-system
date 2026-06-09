import { GoogleGenerativeAI } from '@google/generative-ai';
import { MODEL_PRIMARY } from '@/lib/ai/modelConfig';

export async function analyzeStoryIdentity(newsTitle, breakdownData) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-pro",
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2
      }
    });

    const prompt = `You are a professional News Story Analyst. Analyze this news article in detail and extract data for the image search team.
CRITICAL: ALL output field values (names, descriptions, search queries, story, emotionalHook, keywords, etc.) MUST be in Thai language. Only the JSON keys and enum values (emotion, coverEmotion) are in English.

News title: "${newsTitle}"
Full article content: "${(breakdownData?.core_story || '').slice(0, 3000)}"
People involved: ${JSON.stringify(breakdownData?.key_facts?.people || [])}

Generate diverse search queries from multiple angles to find images that best match the news story.
You must capture the essence of the story, emotional scenes, locations, and important keywords.

★★★ MOST IMPORTANT RULE — Person Disambiguation (clear identity required):
- Short nicknames (e.g. "เจนนี่", "ลิซ่า", "มิว") → MUST always include additional context!
  Good example: "เจนนี่ ได้หมดถ้าสดชื่น" or "เจนนี่ รัชนก สุวรรณเกตุ"
  Bad example: "เจนนี่" ← This will return Jennie BLACKPINK! NEVER do this!
- If no surname appears in the article → append a title/show name/occupation to disambiguate
  e.g.: "ตั๊ก บงกช" not "ตั๊ก", "ยิว ฉัตรบริรักษ์" not "ยิว"
- mainCharacter MUST be a name that returns the correct person on Google!
- ★ person_portrait MUST NEVER use a standalone nickname! Always include title/surname/context!

★★★ IMPORTANT RULE — Children of celebrities:
- If the news is about a celebrity's child → search "child's name + child of + parent's name"
  Example: News about "น้องทาเรีย" daughter of น้ำฝน → mainCharacter: "น้องทาเรีย ลูกน้ำฝน กุลณัฐ"
  ★ NEVER search just "ทาเรีย" → will return the wrong person! Always include "ลูกน้ำฝน"!
  Example: "น้องเป่าเปา ลูกเป้ย ปานวาด" not "น้องเป่าเปา"
  Example: "น้องมะลิ ลูกพ่อโน้ต อุดม" not "น้องมะลิ"
- ★ mainCharacter + searchQueries MUST always include parent's name!

★★★ IMPORTANT RULE — Search queries must "tell the story", not just find faces!
A good viral news cover needs 5 types of images:
1. Clear face of main character (HERO) — beautiful portrait
2. Activity scene from the news (KEY_ACTIVITY) — ★ Very important! e.g. "บริจาค", "ทำสวน", "ในถ้ำ"
3. Real location from the news (CONTEXT_SCENE) — e.g. school, home, temple
4. Relationship (RELATIONSHIP) — with partner, child, parents
5. Secondary character face (HERO2)

★ Do NOT only search for "pretty face" photos! MUST also search for "activity/location" images!
Good examples (news: ก้อยรัชวิน donates to school):
- "ก้อย รัชวิน บริจาค โรงเรียน" ✅
- "โรงเรียนบ้านขุนสมุทรไทย" ✅
- "ก้อย รัชวิน ตูน บอดี้สแลม" ✅
Bad examples:
- "ก้อย รัชวิน ชายหาด" ❌ (unrelated to the news!)
- "ก้อย รัชวิน แฟชั่น" ❌ (unrelated to the news!)

⚠️ KEY STRATEGY — Must find at least 5-8 images:
- Clear face of main person — search from any source (interviews, IG, events)
- ★ Activity/event images from the news — MUST use news-specific search terms!
- ★ Real location images — always use full location names
- ★ If sad news → search "person's name + ร้องไห้" but must be a relevant scene
- ★ If news has 2 people → search "personA + personB + news context"
- Search full name + title directly for sharp portraits

★★★ STRICT RULE — Search queries must be specific, NEVER generic:
- If news has a location name → MUST include full name in query
- If news has a specific event → MUST include details in query
- event_scene and location_photo MUST always include specific location names
- person_context MUST include news-specific context

★★★ HIGHEST PRIORITY RULE — Every people-related query MUST contain the main character's real name:
- NEVER search "ดาราร้องไห้" → MUST search "[real name] ร้องไห้"
- NEVER search "นักการเมือง แถลงข่าว" → MUST search "[real name] แถลงข่าว"
- NEVER search "แม่ลูก" → MUST search "[real mother's name] กับ [real child's name]"
- person_portrait, person_closeup, person_emotion, person_context MUST have real names in every field!
- Only exception: location_photo and event_scene (if purely location-based) don't need person names

Respond with ONLY a JSON object following this exact structure (ALL values in Thai!):
{
  "characters": ["Full names of all people involved, including titles/surnames — in Thai"],
  "mainCharacter": "Full name + title/surname that returns the correct person on Google — in Thai (★ If celebrity's child, MUST include parent's name! e.g. 'น้องทาเรีย ลูกน้ำฝน กุลณัฐ')",
  "secondaryCharacter": "Full name + title/surname of secondary character (if any, e.g. father/mother/partner) — in Thai",
  "story": "One-sentence summary of the news — in Thai",
  "emotion": "happy | sad | angry | shocked | neutral | dramatic",
  "coverEmotion": "drama | tragedy | shocking | hope | warm | neutral",
  "location": "Full name of the location where the event occurred (if any) — in Thai",
  "timeframe": "Date/time of the event (if any) — in Thai",
  "keywords": ["Important keywords for image tagging, should have 5-10 words — in Thai"],
  "keyScenes": ["★ Activity scenes to find images for, e.g. 'มอบเงิน บริจาคโรงเรียน', 'ทำสวน ปลูกผัก', 'ในถ้ำ ช่วยเด็ก' — in Thai"],
  
  "specific_details": {
    "place_names": ["All location names appearing in the news, must be full names — in Thai"],
    "organization_names": ["Names of relevant agencies/organizations — in Thai"],
    "key_events": ["★ Key events, e.g. 'บริจาคเงินสร้างหลังคาโรงเรียน' — in Thai"],
    "evidence_items": ["Evidence items, e.g. 'ป้ายโรงเรียน', 'เอกสารบริจาค' — in Thai"]
  },

  "searchQueries": {
    "person_closeup": "Main person's name + terms for clear face photo, no occupation needed — in Thai",
    "person_portrait": "★ Full name + title directly (if celebrity's child: 'น้องทาเรีย ลูกน้ำฝน') — in Thai",
    "person_emotion": "Main person's name + emotion matching the news — in Thai",
    "secondary_person": "Secondary character's name (if any) for clear face — if relationship='แม่', use 'hero name แม่' — in Thai",

    "★★★ CELEBRATED_ACTION_FIRST RULE ★★★": "key_activity, person_context, key_relationship MUST use celebratedAction as PRIMARY — NEVER use occupation!",
    "person_context": "★★★ Name + celebratedAction. e.g. if celebratedAction='ดูแลแม่' → 'หมอโบว์ ดูแลแม่' NOT 'หมอโบว์ สัตวแพทย์' — in Thai",
    "event_scene": "★★★ Main activity keywords + location, using celebratedAction. e.g. 'ดูแลผู้ป่วยอัลไซเมอร์' or 'มอบเงิน บริจาค สร้างหลังคา' — in Thai",
    "emotion_moment": "Emotional image search terms matching the news tone — in Thai",
    "location_photo": "★ Full location name, e.g. 'โรงเรียนบ้านขุนสมุทรไทย' — in Thai",
    "related_people": "Search terms for other related people — in Thai",
    
    "person_past": "★★ Past image search terms, e.g. 'นิรุตติ์ ศิริจรรยา สมัยหนุ่ม' (if news has timeline) — in Thai",
    "key_relationship": "★★★ Name + relationship. e.g. if relationship='แม่' → 'หมอโบว์ แม่' or 'หมอโบว์ ครอบครัว' — NEVER include animal names/occupation — in Thai",
    "key_activity": "★★★ Name + celebratedAction only. e.g. 'หมอโบว์ ดูแลแม่' or 'ก้อย รัชวิน บริจาค' — REQUIRED! NEVER use occupation! — in Thai",
    "story_contrast": "★★ Contrast search terms, e.g. 'น้ำฝน สมัยสาว' or 'โรงเรียน ก่อนบูรณะ' — in Thai",
    "storySubject_direct": "★★★★ Direct search for storySubject (NOT the protagonist!). e.g. if storySubject='สายฟ้า-พายุ' → 'ชมพู่ ลูก สายฟ้า พายุ', if storySubject='แม่' → 'หมอโบว์ แม่ ครอบครัว' — must search what the news is actually about! — in Thai"

  },

  "searchGoogle": "Primary Google Image search query — in Thai",
  "searchYouTube": "YouTube search query — in Thai",
  "searchTikTok": "TikTok search query — in Thai",
  "searchPexels": "Stock photo search query — in English",

  "typography": {
    "hook": "1-3 words, e.g. 'ช็อก!', 'ด่วน!', 'เศร้า' — in Thai",
    "main": "4-8 words summarizing the main point — in Thai",
    "punch": "2-4 words for emotional impact — in Thai"
  },

  "coreStory": {
    "relationship": "Name/role of the most important secondary character (e.g. mother, child, husband) — in Thai",
    "storySubject": "★★★ Who/what is the news ACTUALLY about — may NOT be the protagonist! Example: news about ชมพู่ talking about her kids → storySubject='สายฟ้า-พายุ', news about หมอโบว์ caring for her mother → storySubject='แม่'. If it's about the protagonist themselves, use their name — in Thai",
    "sacrifice": "What the protagonist sacrificed/did for others (e.g. resigned from government, lost 10 million baht) — null if none — in Thai",
    "emotionalHook": "One short sentence that makes people click to read (reflecting the true core of the news) — in Thai",
    "celebratedAction": "The action the news celebrates/praises, as an activity. e.g. caring for Alzheimer's mother for 9 years, helping the community (NOT an occupation) — in Thai",
    "occupationImportance": 0.1,
    "storyWeight": {
      "_comment": "Weight of each element in the news, total = 100 — Rule: occupation/work/location must NEVER exceed 20"
    },
    "negativeFocus": [
      "Things that must NOT be used as dominant cover elements even if they appear in the news (e.g. 'elephant as main subject', 'veterinary work as dominant')"
    ],
    "contextOnly": ["Words/context that are just background, not the core of the news — in Thai"]
  },

  "storyType": "string - ประเภทข่าว เช่น family_warm, crime, sport, charity, entertainment, political, nature_learning",
  "mainVisualShouldBe": "string - อธิบายว่าภาพหลักของปกควรเป็นอะไร ตอบเป็นคำอธิบายภาพ ไม่ใช่แค่ชื่อคน เช่น 'ยายหนิงหรือหลานอยู่ในสวน/ที่ดิน/ธรรมชาติ' ไม่ใช่ 'ชมพู่สวย' หรือ 'ชมพู่ อารยา'",
  "coverageRequired": ["array of roles that the cover MUST have - ordered by importance. Roles: STORY_ANCHOR (ภาพที่เล่าแก่นข่าว), KEY_ACTIVITY (กิจกรรมหลัก), CONTEXT_SCENE (สถานที่/บรรยากาศ), RELATIONSHIP (ความสัมพันธ์), HERO_FACE (portrait ตัวละครหลัก), EVIDENCE (หลักฐาน), EMOTION (อารมณ์)"],
  "coverageOptional": ["array of roles that are nice to have but not essential"],
  "visualPriority": {"group_name": "percent — allocate visual weight to each image group, total = 100"},
  "storyAnchorQueries": ["search queries to find STORY_ANCHOR images — must describe the visual scene, not just person names. Include activity/location context"]
}

★★★ Visual Priority Rules:
- mainVisualShouldBe: Think "if we make a cover for this news, what should the BIGGEST image show?" Answer as visual description, NOT person name.
  - News about "grandma bought land to make garden for grandchildren" → mainVisualShouldBe: "ยายหนิงหรือหลานอยู่ในสวน/ที่ดิน/ธรรมชาติ"
  - News about "celebrity donates money" → mainVisualShouldBe: "ดาราถือของบริจาค/อยู่กับผู้รับบริจาค"
  - News about "actor wins award" → mainVisualShouldBe: "นักแสดงถือรางวัล/บนเวที"
  - News about scandal/personal → mainVisualShouldBe: "ตัวละครหลัก"

- STORY_ANCHOR = the image that tells the CORE of the story. NOT the celebrity portrait. HERO_FACE = portrait of a person.
  - If news is about an EVENT/PLACE/ACTIVITY → STORY_ANCHOR is MORE important than HERO_FACE
  - If news is about a PERSON DIRECTLY (scandal, personal life) → HERO_FACE can be the anchor

- coverageRequired order matters: first role = most important for main slot

- storyAnchorQueries: search queries to find the STORY_ANCHOR image
  - Must describe the visual scene, not just person names
  - Include supporting character names + activity/location
  - Example for garden story: ["ยายหนิง สวน ชมพู่", "สวนยายหนิง ชมพู่", "ที่ดิน 1 ไร่ ยายหนิง"]
  - Example for donation story: ["ก้อย รัชวิน มอบเงิน บริจาค", "โรงเรียน รับบริจาค", "ก้อย รัชวิน บริจาค โรงเรียน"]
  - Example for scandal: ["ชื่อดารา แถลงข่าว", "ชื่อดารา ให้สัมภาษณ์"]

★★★ coreStory RULES:
- relationship: Use the name/role of the secondary character most discussed in the news — value in Thai
- sacrifice: What the protagonist actually sacrificed in this news (if none, set null) — value in Thai
- emotionalHook: One short sentence capturing the core of the news — value in Thai

★★★ storySubject RULES (VERY IMPORTANT!):
  In most news, the protagonist (mainCharacter) is NOT what the cover should emphasize!
  Ask yourself: "Who/what is the news ACTUALLY telling the story about?"
  Examples:
    News about ชมพู่ telling about her kids → storySubject = "สายฟ้า-พายุ"
    News about หมอโบว์ caring for her mother → storySubject = "แม่"
    News about a singer donating → storySubject = "ผู้รับบริจาค/เด็กๆ ที่ได้รับ"
    News about a celebrity being interviewed about themselves → storySubject = celebrity's name
  coverVisualWeight: storySubject MUST get the highest visual weight on the cover!

★ celebratedAction: What the news wants people to admire (NOT an occupation, but an ACTION)
  Example หมอโบว์ news: "ดูแลแม่อัลไซเมอร์ 9 ปี" NOT "รักษาช้าง"
  Example ก้อย news: "บริจาคสร้างหลังคาโรงเรียน" NOT "นักแสดง"
★ occupationImportance: Weight 0-1 of occupation relevance in the news
  - If news is NOT about occupation → set 0.05-0.1
  - If news is directly about occupation → set 0.5-1.0
  - Example หมอโบว์ caring for mother: 0.05 (news is NOT about veterinary work)
- storyWeight: Assign % weight to each element where:
  * Occupation/work/workplace = MUST NEVER exceed 20%
  * Primary relationship (mother/child/husband) must have highest weight if discussed in news
  * Example หมอโบว์ news: { "mother_care": 45, "caregiving": 30, "sacrifice": 15, "vet_work": 10 }
- negativeFocus: Things that are NOT the core story but could dominate the cover if not careful
  Example: หมอโบว์ news → "elephant", "vet work", "animal treatment" should be in negativeFocus
- contextOnly: Words/context that are just background (e.g. name of the hospital where they work) — in Thai`;


    // ★★★ Fix 14: ปิด Gemini ชั่วคราว — ใช้ GPT ตรงเลย (Gemini 503 ทั้งวัน)
    // เปิดใหม่โดย uncomment Gemini loop ด้านล่าง
    /*
    let lastError;
    for (let attempt = 0; attempt < 1; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        return JSON.parse(text);
      } catch (err) {
        lastError = err;
        console.log(`[StoryIdentity] Attempt ${attempt + 1} failed: ${err.message?.substring(0, 80)}`);
      }
    }
    */
    let lastError = new Error('Gemini disabled — using GPT directly');
    console.log('[StoryIdentity] ⚡ Gemini disabled — going straight to GPT');

    // ★★★ Fallback: GPT-4o เมื่อ Gemini ล้มเหลว (สำคัญมาก! ถ้า identity null → ค้นภาพมั่วทั้งหมด)
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      try {
        console.log(`[StoryIdentity] 🔄 Trying ${MODEL_PRIMARY} fallback...`);
        // ★ GPT-5.5 compatibility
        const _isNew = MODEL_PRIMARY.startsWith('gpt-5') || MODEL_PRIMARY.startsWith('o1') || MODEL_PRIMARY.startsWith('o3');
        const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: MODEL_PRIMARY,
            messages: [{ role: 'user', content: prompt }],
            ...(_isNew ? { max_completion_tokens: 4000 } : { max_tokens: 4000 }),
            ...(_isNew ? {} : { temperature: 0.2 }),
            response_format: { type: 'json_object' }
          })
        });

        if (gptRes.ok) {
          const gptData = await gptRes.json();
          const gptText = gptData.choices?.[0]?.message?.content || '';
          const parsed = JSON.parse(gptText);
          // ★ Extract new visual priority fields with safe defaults
          parsed.storyType = parsed.storyType || 'general';
          parsed.mainVisualShouldBe = parsed.mainVisualShouldBe || '';
          parsed.coverageRequired = parsed.coverageRequired || [];
          parsed.coverageOptional = parsed.coverageOptional || [];
          parsed.visualPriority = parsed.visualPriority || {};
          parsed.storyAnchorQueries = parsed.storyAnchorQueries || [];
          console.log(`[StoryIdentity] ✅ ${MODEL_PRIMARY} fallback success: ${parsed.mainCharacter} | storyType=${parsed.storyType} | coverageRequired=${parsed.coverageRequired.length} roles`);
          return parsed;
        } else {
          console.log(`[StoryIdentity] ❌ ${MODEL_PRIMARY} HTTP ${gptRes.status}`);
        }
      } catch (gptErr) {
        console.log(`[StoryIdentity] ❌ GPT-4o error: ${gptErr.message?.substring(0, 80)}`);
      }
    }

    console.error('[StoryIdentity] All attempts failed:', lastError?.message?.substring(0, 100));
    return null;
  } catch (outerErr) {
    console.error('[StoryIdentity] Unexpected error:', outerErr.message);
    return null;
  }
}
