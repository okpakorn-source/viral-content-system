/**
 * Relationship Resolver Service
 * วิเคราะห์ว่าในข่าวนี้มีตัวละครสำคัญคนไหนบ้าง + role ของแต่ละคน
 * Input: identity (จาก storyIdentity), newsBody
 * Output: { hero, relationships, evidenceCategories }
 */

const RELATIONSHIP_TIMEOUT_MS = 8000;

/**
 * สร้าง fallback relationships จาก identity.characters โดยไม่ใช้ AI
 */
function buildFallbackRelationships(identity) {
  const heroName = identity?.mainCharacter || '';
  const otherChars = (identity?.characters || [])
    .filter(c => c && c !== heroName)
    .slice(0, 4);

  const relationships = otherChars.map((name, idx) => ({
    name,
    role: 'unknown',
    searchName: name,
    importance: idx === 0 ? 'high' : 'medium',
  }));

  // สร้าง evidenceCategories พื้นฐาน
  const evidenceCategories = ['hero', 'interview'];
  if (relationships.length > 0) evidenceCategories.push('relationship');
  const keyScenes = identity?.keyScenes || [];
  if (keyScenes.length > 0) evidenceCategories.push('activity');

  return {
    hero: { name: heroName, searchName: heroName },
    relationships,
    evidenceCategories,
    source: 'fallback',
  };
}

/**
 * resolveRelationships — วิเคราะห์ตัวละครและความสัมพันธ์ในข่าว
 * @param {Object} identity — จาก analyzeStoryIdentity
 * @param {string} newsBody — เนื้อข่าว (slice 2000 chars ภายในนี้)
 * @returns {{ hero, relationships, evidenceCategories, source }}
 */
export async function resolveRelationships(identity, newsBody = '') {
  const heroName = identity?.mainCharacter || '';

  if (!heroName || heroName.length < 2) {
    return {
      hero: { name: '', searchName: '' },
      relationships: [],
      evidenceCategories: ['hero', 'interview'],
      source: 'no_hero',
      warning: 'ไม่มีตัวละครหลัก — ข้ามการวิเคราะห์ Relationship',
    };
  }

  const storySnippet = (newsBody || identity?.story || '').slice(0, 2000);
  const chars = (identity?.characters || []).filter(c => c && c !== heroName).join(', ');
  const keyScenes = (identity?.keyScenes || []).join(', ');

  const modelsToTry = ['gemini-2.5-flash', 'gemini-2.5-pro'];
  let lastError = null;

  for (const modelName of modelsToTry) {
    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: modelName });

      const prompt = `คุณเป็น Content Analyst วิเคราะห์ตัวละครในข่าวภาษาไทย

ข่าว:
ตัวละครหลัก: "${heroName}"
ตัวละครอื่นที่พบ: ${chars || 'ไม่ระบุ'}
ซีนสำคัญ: ${keyScenes || 'ไม่ระบุ'}
เนื้อข่าว: "${storySnippet}"

วิเคราะห์:
1. hero → ชื่อตัวละครหลัก + searchName ที่ใช้ค้น Google ได้ดีที่สุด
2. relationships → ตัวละครสำคัญอื่นๆ + role + searchName + importance (high/medium/low)
   role ที่ใช้ได้: mother, father, sibling, child, spouse, partner, friend, colleague, victim, suspect, authority, other
3. evidenceCategories → ประเภทภาพที่ควรค้นหาจากรายการนี้เท่านั้น:
   hero, mother, father, sibling, child, spouse, caregiving, activity, interview, work, location, evidence, relationship, family

ตอบ JSON เท่านั้น ห้ามใส่ markdown:
{
  "hero": {"name": "ชื่อจริง", "searchName": "ชื่อค้นGoogle"},
  "relationships": [
    {"name": "ชื่อ", "role": "mother", "searchName": "ชื่อค้นGoogle", "importance": "high"}
  ],
  "evidenceCategories": ["hero", "caregiving", "interview"]
}`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), RELATIONSHIP_TIMEOUT_MS);

      let result;
      try {
        result = await model.generateContent(prompt, { requestOptions: { signal: controller.signal } });
      } finally {
        clearTimeout(timer);
      }

      const text = result.response.text().trim();

      // Parse JSON — strip markdown wrapper if present
      const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || text.match(/(\{[\s\S]*\})/);
      if (!jsonMatch) throw new Error('ไม่พบ JSON ใน response');

      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);

      const hero = parsed.hero || { name: heroName, searchName: heroName };
      if (!hero.searchName) hero.searchName = hero.name || heroName;

      const relationships = (parsed.relationships || [])
        .filter(r => r.name && r.role)
        .slice(0, 4);

      const evidenceCategories = (parsed.evidenceCategories || ['hero', 'interview'])
        .filter(c => typeof c === 'string' && c.length > 0)
        .slice(0, 6);

      // ตรวจว่า hero อยู่ใน categories เสมอ
      if (!evidenceCategories.includes('hero')) evidenceCategories.unshift('hero');

      console.log(`[RelationshipResolver] "${heroName}" → ${relationships.length} relationships, categories: ${evidenceCategories.join(', ')} (model: ${modelName})`);

      return {
        hero,
        relationships,
        evidenceCategories,
        source: 'gemini',
        modelUsed: modelName,
      };
    } catch (e) {
      console.warn(`[RelationshipResolver] Model ${modelName} failed: ${e.message?.slice(0, 80)}`);
      lastError = e;
    }
  }

  // ★★★ Fix 9: GPT-4o fallback เมื่อ Gemini ทั้ง Flash + Pro ล้มเหลว
  try {
    console.log(`[RelationshipResolver] ⚡ All Gemini failed → trying GPT-4o fallback...`);
    const { callAI } = await import('@/lib/ai/openai');
    const gptPrompt = `คุณเป็น Content Analyst วิเคราะห์ตัวละครในข่าวภาษาไทย

ข่าว:
ตัวละครหลัก: "${heroName}"
ตัวละครอื่นที่พบ: ${chars || 'ไม่ระบุ'}
ซีนสำคัญ: ${keyScenes || 'ไม่ระบุ'}
เนื้อข่าว: "${storySnippet}"

วิเคราะห์:
1. hero → ชื่อตัวละครหลัก + searchName ที่ใช้ค้น Google ได้ดีที่สุด
2. relationships → ตัวละครสำคัญอื่นๆ + role + searchName + importance
   role: mother, father, sibling, child, spouse, partner, friend, colleague, other
3. evidenceCategories → ประเภทภาพที่ควรค้นหา:
   hero, mother, father, sibling, child, spouse, caregiving, activity, interview, work, location, evidence, relationship, family

ตอบ JSON เท่านั้น:
{"hero":{"name":"","searchName":""},"relationships":[{"name":"","role":"","searchName":"","importance":""}],"evidenceCategories":[]}`;

    const gptResult = await callAI({
      prompt: gptPrompt,
      model: 'gpt-4o',
      temperature: 0.2,
      maxTokens: 1500,
    });

    const gptText = (gptResult?.text || gptResult || '').trim();
    const gptJson = gptText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || gptText.match(/(\{[\s\S]*\})/);
    if (!gptJson) throw new Error('GPT-4o: ไม่พบ JSON');

    const parsed = JSON.parse(gptJson[1] || gptJson[0]);
    const hero = parsed.hero || { name: heroName, searchName: heroName };
    if (!hero.searchName) hero.searchName = hero.name || heroName;

    const relationships = (parsed.relationships || []).filter(r => r.name && r.role).slice(0, 4);
    const evidenceCategories = (parsed.evidenceCategories || ['hero', 'interview']).filter(c => typeof c === 'string').slice(0, 6);
    if (!evidenceCategories.includes('hero')) evidenceCategories.unshift('hero');

    console.log(`[RelationshipResolver] ✅ GPT-4o fallback success: "${heroName}" → ${relationships.length} relationships`);

    return {
      hero,
      relationships,
      evidenceCategories,
      source: 'gpt4o_fallback',
      modelUsed: 'gpt-4o',
    };
  } catch (gptErr) {
    console.warn(`[RelationshipResolver] GPT-4o fallback also failed: ${gptErr.message?.slice(0, 60)}`);
  }

  console.warn(`[RelationshipResolver] All models failed (${lastError?.message?.slice(0, 60)}) → basic fallback`);
  return buildFallbackRelationships(identity);
}
