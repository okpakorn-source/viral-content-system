import { GoogleGenerativeAI } from '@google/generative-ai';
import { MODEL_PRIMARY } from '@/lib/ai/modelConfig';

// ★ Fix 24: Normalize GPT's Thai storyType to DNA_MAP enum
const VALID_STORY_ENUMS = [
  'family_warm','family_care','family_nature_learning','nature_learning',
  'drama','donation','rescue','celebrity','relationship','achievement',
  'conflict','accident','politics','default'
];

function normalizeStoryType(raw) {
  if (!raw || typeof raw !== 'string') return 'default';
  const lower = raw.toLowerCase().trim();
  
  // Already a valid enum
  if (VALID_STORY_ENUMS.includes(lower)) return lower;
  
  // Thai sentence → enum mapping (ordered: most specific first)
  if (/ครอบครัว/.test(lower) && /ธรรมชาติ|สวน|ที่ดิน|ปลูก|เลี้ยงปลา|เลี้ยงไก่|หลาน|เกษตร/.test(lower)) return 'family_nature_learning';
  if (/ธรรมชาติ|สวน|ที่ดิน|ปลูก|เลี้ยงปลา|เลี้ยงไก่|เกษตร/.test(lower) && /เรียนรู้|เด็ก|หลาน/.test(lower)) return 'family_nature_learning';
  if (/ครอบครัว|แม่|พ่อ|ลูก|หลาน|อบอุ่น|ดูแล/.test(lower) && !/ธรรมชาติ|สวน/.test(lower)) return 'family_warm';
  if (/บริจาค|ช่วยเหลือ|มอบทุน|การกุศล|สร้างโรงเรียน/.test(lower)) return 'donation';
  if (/อาชญากรรม|ฆาตกรรม|ปล้น|ชิงทรัพย์|ฆ่า/.test(lower)) return 'conflict';
  if (/อุบัติเหตุ|ชน|คว่ำ|ตกน้ำ/.test(lower)) return 'accident';
  if (/กีฬา|แข่ง|เหรียญ|สำเร็จ|ชนะ/.test(lower)) return 'achievement';
  if (/การเมือง|รัฐบาล|สภา|พรรค|เลือกตั้ง/.test(lower)) return 'politics';
  if (/ดราม่า|ดรา|วิจารณ์|โต้เถียง/.test(lower)) return 'drama';
  if (/คู่รัก|แต่งงาน|หย่า|เลิก|ความสัมพันธ์/.test(lower)) return 'relationship';
  if (/ดารา|คนดัง|เซเลบ|บันเทิง/.test(lower)) return 'celebrity';
  if (/กู้ภัย|ช่วยชีวิต|กู้/.test(lower)) return 'rescue';
  
  // Fallback: check for partial enum matches
  for (const e of VALID_STORY_ENUMS) {
    if (lower.includes(e)) return e;
  }
  
  return 'default';
}

// ★★★ Identity Anchor (20 มิ.ย. — CV3): สืบ "ชื่อจริง/ชื่อในวงการ" จากผลค้นหาจริง
//   ปัญหา: เนื้อข่าวบางชิ้นเอ่ยแค่ชื่อเล่นลอยๆ (เช่น "พลอย") ไม่มีนามสกุล → ค้นภาพได้คนผิด
//   ทางแก้: เอา ชื่อเล่น + บริบทข่าว ไปค้น Google จริง → ให้ AI สกัด "ชื่อเต็มที่ปรากฏจริง" ในผลค้นหา
//   ★ ไม่ใช่การเดา/generate — ยึดจากหัวข่าว/สนิปเพ็ตจริง (กันหน้าคนผิดขึ้นปก)
// คำเหตุการณ์ (ชื่อรายการ/โรค/ดราม่า) + คำอาชีพ/คำขยาย (ไม่ใช่นามสกุล) — ตัดทิ้งก่อนนับว่า "มีนามสกุลจริงไหม"
const _AMBIG_EVENT_TOKENS = /รายการ|วู้ดดี้|โหนกระแส|ทูไนท์|ตีท้ายครัว|คุยแซ่บ|ข่าว|มะเร็ง|ป่วย|โรค|ดราม่า|drama|สัมภาษณ์|เปิดใจ|คลิป|วิดีโอ|ล่าสุด|cover|thumbnail|ปก|งานแสดง|ละคร|ซีรีส์|นักแสดง|ดารา|นักร้อง|พิธีกร|เน็ตไอดอล|อินฟลูเอนเซอร์|อินฟลู|influencer|ไอดอล|นางแบบ|นางเอก|พระเอก|ซุปตาร์|ซุปตา|เซเลบ|คุณแม่|คุณพ่อ|สาว|หนุ่ม/gi;

async function resolveCanonicalIdentity(parsed) {
  try {
    const raw = (parsed?.mainCharacter || '').trim();
    if (!raw) return parsed;
    // ตัดคำเหตุการณ์ออกก่อน เหลือ "แกน" ของชื่อ
    const stripped = raw.replace(_AMBIG_EVENT_TOKENS, ' ').replace(/\s+/g, ' ').trim();
    const words = stripped.split(/\s+/).filter(Boolean);
    // มีนามสกุล/2 คำขึ้นไปแล้ว (เช่น "ก้อย รัชวิน") → เชื่อถือได้ ไม่ต้องสืบ (กันเปลือง)
    if (words.length >= 2) return parsed;
    const nickname = words[0] || stripped;
    if (!nickname || nickname.length < 2) return parsed;

    const serperKey = process.env.SERPER_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!serperKey || !openaiKey) return parsed;

    const context = (parsed.story || parsed.mainVisualShouldBe || parsed.newsTitle || '').slice(0, 90);
    // คีย์เหตุการณ์เด่น (ไม่ใช่ตัวเลข/คำกว้าง) — ใช้ยืนยันว่าชื่อที่ได้ "ผูกกับข่าวนี้จริง"
    const eventKeyword = (() => {
      const pool = `${(parsed.keyScenes || []).join(' ')} ${parsed.story || ''} ${parsed.newsTitle || ''}`;
      const words = pool.replace(/[0-9]+/g, ' ').match(/[ก-๙]{4,}/g) || [];
      const generic = new Set(['นักแสดง', 'ดารา', 'นักร้อง', 'เปิดใจ', 'ชีวิต', 'ครั้ง', 'กิโลกรัม', 'น้ำหนัก', 'เรื่อง', 'ตัวเอง', 'ร่างกาย', 'ผู้หญิง', 'ผู้ชาย', 'ล่าสุด', 'ปัจจุบัน']);
      return words.find(w => !generic.has(w) && !w.includes(nickname)) || '';
    })();
    const q = `${nickname} ${context}`.trim().slice(0, 120);
    const sres = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl: 'th', hl: 'th', num: 8 }),
    });
    if (!sres.ok) { console.log('[IdentityAnchor] serper HTTP', sres.status); return parsed; }
    const sdata = await sres.json();
    const snippets = (sdata.organic || []).slice(0, 6)
      .map(o => `${o.title || ''} — ${o.snippet || ''}`).join('\n').slice(0, 1600);
    if (!snippets) { console.log('[IdentityAnchor] no organic results'); return parsed; }

    const ask = `ข่าวนี้เรียกบุคคลด้วยชื่อเล่นว่า "${nickname}" บริบทข่าว: ${context}
นี่คือผลค้นหาเว็บจริง:
${snippets}

จากสนิปเพ็ตจริงข้างบน ระบุ "ชื่อ-นามสกุล หรือชื่อในวงการเต็ม" (ภาษาไทย) ของบุคคลที่ข่าวนี้พูดถึง
⛔ กฎเข้ม:
1. ต้องเป็นชื่อที่ปรากฏจริงในสนิปเพ็ต — ห้ามเดา/เติมจากความรู้ของคุณเอง
2. ชื่อนั้นต้องอยู่ในสนิปเพ็ตที่พูดถึง "เหตุการณ์เดียวกับข่าวนี้"${eventKeyword ? ` (เช่น มีคำว่า "${eventKeyword}")` : ''} ด้วย
3. ★ ห้ามเลือก "คนดังที่ชื่อเล่นบังเอิญตรงกัน" แต่สนิปเพ็ตของเขาไม่ได้พูดถึงเหตุการณ์นี้ ← นี่คือกับดักที่ทำให้หน้าคนผิดขึ้นปก
4. ถ้าไม่มีสนิปเพ็ตไหนเชื่อมชื่อกับเหตุการณ์นี้ชัดเจน → ตอบ null
ตอบ JSON เท่านั้น: {"fullName": "ชื่อเต็มที่ปรากฏจริง หรือ null", "confidence": 0-1}`;
    const ores = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini', messages: [{ role: 'user', content: ask }],
        temperature: 0, max_tokens: 200, response_format: { type: 'json_object' },
      }),
    });
    if (!ores.ok) { console.log('[IdentityAnchor] openai HTTP', ores.status); return parsed; }
    const odata = await ores.json();
    const pn = JSON.parse(odata.choices?.[0]?.message?.content || '{}');
    const fullName = String(pn.fullName || '').trim();
    const conf = Number(pn.confidence) || 0;
    const basicOk = fullName && fullName.toLowerCase() !== 'null' && conf >= 0.6
      && fullName.includes(nickname) && fullName.length > nickname.length;
    if (!basicOk) {
      console.log(`[IdentityAnchor] ไม่ resolve (fullName="${fullName || '-'}" conf=${conf})`);
      parsed._identityAmbiguous = true; // ★ ธงบอกปลายทาง: ชื่อกำกวม-สืบไม่ได้ (ควรให้คนยืนยันชื่อ)
      return parsed;
    }
    // ★ ผ่านเกณฑ์ → ใช้ชื่อจริงที่สืบได้ (query สืบรวมบริบทเหตุการณ์อยู่แล้ว + AI อ่านสนิปเพ็ตจริง = grounded)
    //   ถ้าได้คนผิดในบางเคส ผู้ใช้แก้ด้วยช่อง "ชื่อเต็มตัวละครหลัก" (override) ได้เสมอ — ไม่ hard-reject
    //   (เคยใส่ verify-guard แล้วมันปฏิเสธ "พลอย เฌอมาลย์" ที่ถูกต้อง — ถอดออก 20 มิ.ย.)
    console.log(`[IdentityAnchor] 🎯 "${raw}" → "${fullName}" (conf ${conf})${eventKeyword ? ` [evt: ${eventKeyword}]` : ''}`);
    const sq = parsed.searchQueries || (parsed.searchQueries = {});
    parsed.mainCharacter = fullName;
    sq.person_portrait = fullName;
    sq.person_closeup = `${fullName} หน้าตรง โคลสอัพ ภาพหน้าชัด`;
    parsed._identityResolved = { from: raw, to: fullName, conf };
  } catch (e) { console.log('[IdentityAnchor] err:', e.message?.slice(0, 70)); }
  return parsed;
}

export async function analyzeStoryIdentity(newsTitle, breakdownData, opts = {}) {
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
Full article content: "${(breakdownData?.core_story || '').slice(0, 6000)}"
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

★★★ CRITICAL RULE — mainCharacter MUST come from the news text itself (ห้ามเดาชื่อดารา!):
- If the news does NOT explicitly name a specific real person → mainCharacter = role description (e.g. "ลูกชายผู้บริจาค", "แม่ผู้ป่วย"), NOT a guessed celebrity name
- ★ NEVER infer/guess a celebrity name that is NOT written in the news text (เคยเดา "ณเดชน์" ในข่าวลูกชายบริจาคเงิน = หน้าคนผิดขึ้นเต็มปก!)
- Generic role words alone — "ลูกชาย", "แม่", "พ่อ", "หนุ่ม", "สาว", "ชายคนหนึ่ง" — are NOT celebrity names → do NOT map them to any celebrity
- If you cannot name the person from the news text → use role + context (e.g. "ลูกชายผู้ใจบุญ", "แม่ผู้โพสต์"), NEVER a guessed name

★★★ CRITICAL RULE — mainCharacter MUST be a PERSON, never a product/brand/thing (ห้ามเลือกชื่อสินค้า/รถ!):
- ข่าวที่ "คนซื้อ/ใช้/รีวิว/โชว์/เทิร์น" สินค้า (รถ/มือถือ/นาฬิกา/บ้าน) → mainCharacter = "คนนั้น" เท่านั้น — NEVER the product
- ★ เคยผิด: ข่าว "เบสท์ คำสิงห์ เทิร์น Alphard แลก Vellfire" → เลือก "โตโยต้า อัลฟาร์ด" (รถ) = ผิด! ต้องเป็น "เบสท์ คำสิงห์" (คน)
- สินค้า/แบรนด์/รุ่นรถ (โตโยต้า/Alphard/Vellfire/iPhone/Benz) = "ของ" ในเรื่อง ไม่ใช่ตัวเอก → ตัวเอกคือ "คนในข่าว" เสมอ
- ยกเว้นข่าวสินค้าล้วนที่ไม่มีคนเลย (เปิดตัวรถรุ่นใหม่โดยบริษัท) → ใช้แบรนด์ได้ · แต่ถ้ามี "คน" ในข่าว = ต้องเลือกคน

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
  "characters": ["Names of people EXACTLY as written in the story text, combined with surname/family/context words FROM THE STORY ITSELF (e.g. story says 'ทราย' + 'ตระกูลภิรมย์ภักดี' → 'ทราย ภิรมย์ภักดี') — in Thai. ★ NEVER substitute a guessed identity of a different public figure (ห้ามเดาว่าชื่อเล่นนี้คือดาราคนไหน — เคยทำให้หน้าคนผิดขึ้นปกข่าวมาแล้ว!). NEVER write descriptive phrases like 'ผู้เกี่ยวข้องกับ...', 'ผู้ใหญ่ใน...'. If a person cannot be named from the story text, omit them"],
  "mainCharacter": "Full name + title/surname that returns the correct person on Google — in Thai (★ If celebrity's child, MUST include parent's name! e.g. 'น้องทาเรีย ลูกน้ำฝน กุลณัฐ')",
  "secondaryCharacter": "Full name + title/surname of secondary character (if any, e.g. father/mother/partner) — in Thai",
  "story": "One-sentence summary of the news — in Thai",
  "emotion": "happy | sad | angry | shocked | neutral | dramatic",
  "coverEmotion": "drama | tragedy | shocking | hope | warm | neutral",
  "location": "Full name of the location where the event occurred (if any) — in Thai",
  "timeframe": "Date/time of the event (if any) — in Thai",
  "keywords": ["★ Comprehensive image-tagging keywords — 15-30 words covering: every named person, the main action/event, the location, the time/occasion, and the story-objects that tell the story (e.g. for a celebrity buying a house for parents: ชื่อดารา, ชื่อพ่อแม่, บ้านหลังใหม่, มอบบ้าน, กตัญญู, ป้ายโฉนด, งานขึ้นบ้านใหม่...). The more complete, the more accurate the image selection — in Thai"],
  "keyScenes": ["★ Activity scenes to find images for, e.g. 'มอบเงิน บริจาคโรงเรียน', 'ทำสวน ปลูกผัก', 'ในถ้ำ ช่วยเด็ก' — in Thai"],
  
  "specific_details": {
    "place_names": ["All location names appearing in the news, must be full names — in Thai"],
    "organization_names": ["Names of relevant agencies/organizations — in Thai"],
    "key_events": ["★ Key events, e.g. 'บริจาคเงินสร้างหลังคาโรงเรียน' — in Thai"],
    "evidence_items": ["Evidence items, e.g. 'ป้ายโรงเรียน', 'เอกสารบริจาค' — in Thai"]
  },

  "searchQueries": {
    "person_closeup": "★★ CLEAN NAME ONLY for a clear portrait — e.g. 'พลอย เฌอมาลย์' or just 'พลอย ดารา/นักแสดง' if surname unknown. ⛔ NEVER append event keywords (TV-show name, illness, scandal) — they pollute results into low-quality VIDEO FRAMES instead of clean studio portraits — in Thai",
    "person_portrait": "★★ CLEAN NAME + 'ดารา/นักแสดง/สวย' for portfolio photos (if celebrity's child: 'น้องทาเรีย ลูกน้ำฝน'). ⛔ NO event/show/illness keywords — in Thai",
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
        // ★ rev.S2c (2 ก.ค. — 502 ชั่วคราวเคยพังทั้งท่อปก 5 นาที): ลองซ้ำ 1 ครั้งเฉพาะ 5xx/network (4xx ไม่ซ้ำ)
        const _gptCall = () => fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: MODEL_PRIMARY,
            messages: [{ role: 'user', content: prompt }],
            ...(_isNew ? { max_completion_tokens: 8000 } : { max_tokens: 4000 }), // ★ 8000 (was 4000) — reasoning model กินงบคิดก่อนตอบ เนื้อ JSON เลยโดนตัด ("Unexpected end of JSON input" เคสพี่จ่า 11 มิ.ย.)
            ...(_isNew ? {} : { temperature: 0.2 }),
            response_format: { type: 'json_object' }
          })
        });
        let gptRes = null;
        for (let _a = 0; _a < 2; _a++) {
          try {
            gptRes = await _gptCall();
            if (gptRes.ok || gptRes.status < 500) break; // สำเร็จ หรือ 4xx (ซ้ำไปก็เหมือนเดิม) → พอ
            if (_a === 0) console.log(`[StoryIdentity] ⚠️ ${MODEL_PRIMARY} HTTP ${gptRes.status} (ชั่วคราว) — รอ 3s ลองซ้ำ...`);
          } catch (_netErr) {
            if (_a === 0) console.log(`[StoryIdentity] ⚠️ ${MODEL_PRIMARY} network error: ${String(_netErr?.message || '').slice(0, 50)} — รอ 3s ลองซ้ำ...`);
            else throw _netErr; // ซ้ำแล้วยังพัง → โยนให้ catch เดิมจัดการ
          }
          if (_a === 0) await new Promise(r => setTimeout(r, 3000));
        }

        if (gptRes.ok) {
          const gptData = await gptRes.json();
          const gptText = gptData.choices?.[0]?.message?.content || '';
          if (!gptText.trim()) throw new Error(`empty content (finish=${gptData.choices?.[0]?.finish_reason})`);
          const parsed = JSON.parse((gptText.match(/\{[\s\S]*\}/) || [gptText])[0]);
          // ★ Extract new visual priority fields with safe defaults
          parsed.storyType = parsed.storyType || 'general';
          parsed.mainVisualShouldBe = parsed.mainVisualShouldBe || '';
          parsed.coverageRequired = parsed.coverageRequired || [];
          parsed.coverageOptional = parsed.coverageOptional || [];
          parsed.visualPriority = parsed.visualPriority || {};
          parsed.storyAnchorQueries = parsed.storyAnchorQueries || [];
          // ★ Fix 24: Normalize storyType from Thai sentence → enum
          parsed.rawStoryType = parsed.storyType;
          parsed.storyType = normalizeStoryType(parsed.storyType);
          console.log(`[StoryIdentity] ✅ ${MODEL_PRIMARY} fallback success: ${parsed.mainCharacter} | rawStoryType=${parsed.rawStoryType} | normalizedStoryType=${parsed.storyType} | coverageRequired=${parsed.coverageRequired.length} roles`);
          // ★ identity2 (Hermes CASE-285): guard ชื่อผิด — เตือนถ้า mainCharacter ไม่พบในเนื้อข่าว (gpt อาจเดาชื่อดารามั่วในข่าวคนทั่วไป) · แค่ log ไม่ override (กันพัง logic เดิม)
          try {
            const _nameWords = String(parsed.mainCharacter || '').split(/\s+/).filter(w => w.length > 1);
            const _hay = `${newsTitle || ''} ${breakdownData?.core_story || ''}`;
            if (_nameWords.length > 0 && !_nameWords.some(w => _hay.includes(w))) {
              console.warn(`[StoryIdentity] ⚠️ mainCharacter "${parsed.mainCharacter}" ไม่พบในเนื้อข่าว → อาจ infer/เดาชื่อผิด (identity2 guard)`);
            }
          } catch {}
          // ★ Bug#1 (Hermes CASE-296): บังคับ — ถ้า mainCharacter เป็น "ชื่อสินค้า/รถ" ให้หา "คน" ในหัวข้อมาแทน
          //   (ข่าว "เบสท์ เทิร์น Alphard" → gpt เลือก "โตโยต้า อัลฟาร์ด" (รถ) แทนคน = ปกได้ภาพรถ ไม่ใช่คน)
          try {
            const _mc = String(parsed.mainCharacter || '').trim();
            const _PRODUCT_RE = /โตโยต้า|toyota|ฮอนด้า|honda|อัลฟาร์ด|alphard|vellfire|เวลไฟร์|มาสด้า|mazda|นิสสัน|nissan|อีซูซุ|isuzu|เบนซ์|benz|\bbmw\b|\baudi\b|iphone|ไอโฟน|ซัมซุง|samsung|รถยนต์|รถเก๋ง|รถกระบะ|รถหรู|รถตู้|รถสปอร์ต|มอเตอร์ไซค์|บิ๊กไบค์|มือถือ|โทรศัพท์|นาฬิกาหรู|กระเป๋าแบรนด์/i;
            // ทริกเกอร์เฉพาะเมื่อ mainCharacter "มีคำสินค้า" (คนจริงชื่อไม่ตรง regex นี้) — กัน false trigger กับชื่อคน
            if (_mc && _PRODUCT_RE.test(_mc)) {
              const _title = String(newsTitle || parsed.newsTitle || '').trim();
              // แยก "คน" = คำนำหน้า title ก่อน action verb (เทิร์น/ซื้อ/แลก/รีวิว/โชว์/ถอย/เปลี่ยน...)
              const _m = _title.match(/^(.{2,40}?)\s*(?:เทิร์น|ซื้อ|แลก|ขาย|เปลี่ยน|รีวิว|โชว์|อวด|ควง|พา|ถอย|จอง|ขับ|เปิดตัว|ได้รับ|รับมอบ|ปล่อยรถ|ส่งมอบ)/);
              let _person = _m ? _m[1].trim().replace(/^[!?\s]+|[!?\s]+$/g, '') : '';
              // ตัด prefix ชื่นชม/ไวรัล ที่มักนำหน้าชื่อ
              _person = _person.replace(/^(ชื่นชม|แห่ชื่นชม|ชาวเน็ตแห่|เผย|ไวรัล|ด่วน|ล่าสุด)[!\s]*/,'').trim();
              // ยอมรับเฉพาะเมื่อได้ "คน" ที่ไม่ใช่สินค้า + ยาวพอเป็นชื่อ
              if (_person && !_PRODUCT_RE.test(_person) && _person.length >= 2 && _person.length <= 30) {
                console.log(`[StoryIdentity] 🔧 Bug#1: mainCharacter เป็นสินค้า "${_mc}" (rawStoryType=${parsed.rawStoryType}) → บังคับเป็นคน "${_person}"`);
                parsed.mainCharacter = _person;
                const sq = parsed.searchQueries || (parsed.searchQueries = {});
                sq.person_portrait = _person;
                sq.person_closeup = `${_person} หน้าตรง โคลสอัพ ภาพหน้าชัด`;
                parsed._productNameFixed = { was: _mc, now: _person };
              } else {
                console.warn(`[StoryIdentity] ⚠️ Bug#1: mainCharacter เป็นสินค้า "${_mc}" แต่หา "คน" ในหัวข้อไม่ได้ (คงค่าเดิม — พึ่ง prompt rule)`);
              }
            }
          } catch {}
          // ★ ผู้ใช้ระบุชื่อเต็มเอง (กฎ: ข่าวชื่อเล่นกำกวม → คนยืนยันชื่อ = ชัวร์สุด) — ข้ามการสืบ ใช้ชื่อนี้ตรงๆ
          const override = String(opts?.overrideMainCharacter || '').trim();
          if (override) {
            const sq = parsed.searchQueries || (parsed.searchQueries = {});
            parsed.mainCharacter = override;
            sq.person_portrait = override;
            sq.person_closeup = `${override} หน้าตรง โคลสอัพ ภาพหน้าชัด`;
            parsed._identityOverride = override;
            console.log(`[StoryIdentity] 🖐️ override mainCharacter → "${override}" (ผู้ใช้ระบุชื่อเต็มเอง)`);
          } else if (opts?.skipCanonicalResolve) {
            // ★ preflight-gate: โหมดวิเคราะห์เร็ว — ข้าม canonical resolution (Google search ~1-2 นาที)
            //   คืนชื่อดิบจาก gpt ทันที (~10 วิ) ให้ผู้ใช้ตรวจ/แก้ · ตัว resolve จริงจะทำตอนกดสร้างปก
            if (!parsed.newsTitle) parsed.newsTitle = newsTitle || '';
          } else {
            // ★ Identity Anchor: ถ้า mainCharacter เป็นชื่อเล่นโดดๆ → สืบชื่อจริงจากผลค้นหา (กันหยิบคนผิด)
            if (!parsed.newsTitle) parsed.newsTitle = newsTitle || '';
            await resolveCanonicalIdentity(parsed);
          }
          // ★ preflight-gate: ผู้ใช้แก้ field จากหน้าวิเคราะห์ข่าว → override เพิ่ม (secondary/emotion/action)
          if (opts?.overrideSecondaryCharacter) {
            parsed.secondaryCharacter = opts.overrideSecondaryCharacter;
            console.log(`[StoryIdentity] 🖐️ override secondaryCharacter → "${opts.overrideSecondaryCharacter}"`);
          }
          if (opts?.overrideCoverEmotion) {
            parsed.coverEmotion = opts.overrideCoverEmotion;
            console.log(`[StoryIdentity] 🖐️ override coverEmotion → "${opts.overrideCoverEmotion}"`);
          }
          if (opts?.overrideCelebratedAction) {
            parsed.coreStory = { ...(parsed.coreStory || {}), celebratedAction: opts.overrideCelebratedAction };
            console.log(`[StoryIdentity] 🖐️ override celebratedAction → "${opts.overrideCelebratedAction}"`);
          }
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
