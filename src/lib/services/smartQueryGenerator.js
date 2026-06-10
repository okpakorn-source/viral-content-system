/**
 * Smart Query Generator — AI News Analyzer
 * =========================================
 * วิเคราะห์ข่าวด้วย GPT/Claude แล้วสร้าง search queries ที่ฉลาด
 * ไม่ใช่ค้นแค่ชื่อคน แต่รู้จักใช้บริบทค้นด้วย
 *
 * ตัวอย่าง:
 *   ข่าว: "ชมพู่ อารยา ซื้อที่ดิน 1 ไร่ ทำสวนให้หลาน"
 *   ก่อน: ["ชมพู่ อารยา", "ชมพู่ ครอบครัว"]  ← ได้ภาพสนามบิน/แฟชั่น
 *   หลัง: ["สวนแม่ชมพู่", "สวนยายหนิง", "ชมพู่ ปลูกผัก สวน", "ที่ดิน 1 ไร่ ธรรมชาติ"] ← ตรงข่าว!
 */

const LOG = '[SmartQuery]';

/**
 * วิเคราะห์ข่าวแล้วสร้าง smart search queries
 * @param {string} newsTitle - หัวข้อข่าว
 * @param {string} newsContent - เนื้อหาข่าว
 * @param {Object} identity - identity จาก StoryIdentity
 * @returns {Object} - { smartQueries: string[], storyKeywords: string[], injected: boolean }
 */
export async function generateSmartQueries(newsTitle, newsContent, identity) {
  const hero = identity?.mainCharacter || '';
  const storySubject = identity?.coreStory?.storySubject || '';
  const celebratedAction = identity?.coreStory?.celebratedAction || '';

  console.log(`${LOG} 🧠 Analyzing news for smart queries...`);
  console.log(`${LOG}   Hero: "${hero}"`);
  console.log(`${LOG}   StorySubject: "${storySubject}"`);
  console.log(`${LOG}   CelebratedAction: "${celebratedAction}"`);

  const fullContext = `${newsTitle}\n${(newsContent || '').slice(0, 2000)}`;

  try {
    // Try GPT first, fallback to Claude
    const result = await callAIForQueries(fullContext, hero, storySubject, celebratedAction);

    if (result && result.smartQueries?.length > 0) {
      console.log(`${LOG} ✅ Generated ${result.smartQueries.length} smart queries:`);
      result.smartQueries.forEach((q, i) => console.log(`${LOG}   ${i + 1}. "${q}"`));

      // Inject into identity
      injectQueries(identity, result);
      return { ...result, injected: true };
    }

    console.log(`${LOG} ⚠️ AI returned no queries — using fallback`);
    return fallbackQueries(hero, storySubject, celebratedAction, newsTitle);

  } catch (err) {
    console.log(`${LOG} ❌ Error: ${err.message?.slice(0, 80)} — using fallback`);
    return fallbackQueries(hero, storySubject, celebratedAction, newsTitle);
  }
}

/**
 * เรียก GPT/Claude เพื่อวิเคราะห์ข่าวและสร้าง queries
 */
async function callAIForQueries(newsText, hero, storySubject, celebratedAction) {
  const prompt = `คุณเป็นนักวิเคราะห์ข่าวผู้เชี่ยวชาญ ทำหน้าที่สร้าง search queries สำหรับค้นภาพข่าวใน Google Images

## ข่าว:
${newsText.slice(0, 1500)}

## ตัวละครหลัก: "${hero}"
## เนื้อหาหลัก: "${storySubject || celebratedAction || 'ไม่ระบุ'}"

## คำสั่ง:
สร้าง search queries 10-12 คำ โดยคิดแบบ **Visual Intent** — บอกว่าภาพที่อยากเห็นหน้าตาเป็นอย่างไร

### กฎ Visual Intent (สำคัญมาก!):
1. **คิดแบบช่างภาพ**: "ถ้าช่างภาพถ่ายข่าวนี้ ภาพจะเป็นอย่างไร?"
2. **ห้าม query abstract** เช่น "ธรรมชาติ", "ความรัก", "ชีวิตเรียบง่าย" — ได้ภาพ stock photo
3. **ผสม query ทั้งมีชื่อคน + ไม่มีชื่อคน** — Google อาจไม่มีภาพตรงชื่อคน + action ทุกกรณี
4. **context_fallback สำคัญมาก** — เป็นตาข่ายรองรับเมื่อหาภาพตรงชื่อคนไม่เจอ

### ประเภท queries ที่ต้องการ (4 ประเภท):
- **exact_person** (2 queries): แค่ชื่อคนตรงๆ เช่น "ชมพู่ อารยา", "น้องสายฟ้า"
- **person_relationship** (2-3 queries): ชื่อคน + ความสัมพันธ์ เช่น "ชมพู่ อารยา กับลูก", "ยายหนิง อุ้มหลาน"
- **event_visual** (3-4 queries): ชื่อคน + กิจกรรมจากข่าว เช่น "ชมพู่ อารยา ทำสวนกับลูก", "ชมพู่ ปลูกผัก"
- **context_fallback** (2-3 queries): ฉาก/บริบท **ไม่มีชื่อคน** เช่น "สวนครอบครัว เด็กเล่นในสวน", "ที่ดิน 1 ไร่ สวนผัก"

## ตอบเป็น JSON:
{
  "smartQueries": ["query1", "query2", ...],
  "storyKeywords": ["keyword1", "keyword2", ...],
  "storyTheme": "สรุปเนื้อข่าวใน 1 ประโยค",
  "visualEvent": "one sentence describing what a photographer would capture at this news event",
  "visualScenes": ["scene1", "scene2", "scene3"],
  "queryTypes": {
    "exact_person": ["ชื่อคนตรงๆ query1", "ชื่อคนตรงๆ query2"],
    "person_relationship": ["คน+ความสัมพันธ์ query1", "คน+ความสัมพันธ์ query2"],
    "event_visual": ["คน+กิจกรรม query1", "คน+กิจกรรม query2", "คน+กิจกรรม query3"],
    "context_fallback": ["ฉากไม่มีชื่อคน query1", "ฉากไม่มีชื่อคน query2"]
  }
}`;

  // === Try GPT ===
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const _isNew = true; // GPT-5.5+ compatibility
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_completion_tokens: 1500,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || '';
        const parsed = JSON.parse(text);
        if (parsed.smartQueries?.length > 0) {
          console.log(`${LOG} ✅ GPT-4o-mini generated ${parsed.smartQueries.length} queries (theme: "${parsed.storyTheme || ''}")`);

          // Log cost
          const usage = data.usage || {};
          const cost = ((usage.prompt_tokens || 0) * 0.15 + (usage.completion_tokens || 0) * 0.6) / 1_000_000;
          console.log(`${LOG} 💰 Cost: $${cost.toFixed(5)} (${usage.prompt_tokens}+${usage.completion_tokens} tokens)`);

          return parsed;
        }
      }
    } catch (err) {
      console.log(`${LOG} GPT error: ${err.message?.slice(0, 60)}`);
    }
  }

  // === Fallback: Claude ===
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6', // ★ 10 มิ.ย.: sonnet-4-20250514 ปลดระวาง 15 มิ.ย. 2026
          max_tokens: 1500,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.content?.[0]?.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.smartQueries?.length > 0) {
            console.log(`${LOG} ✅ Claude generated ${parsed.smartQueries.length} queries`);
            return parsed;
          }
        }
      }
    } catch (err) {
      console.log(`${LOG} Claude error: ${err.message?.slice(0, 60)}`);
    }
  }

  return null;
}

/**
 * Inject smart queries เข้า identity.searchQueries
 */
function injectQueries(identity, result) {
  if (!identity) return;
  const sq = identity.searchQueries || {};
  const smart = result.smartQueries || [];
  const types = result.queryTypes || {};

  // ★ Override ด้วย Visual Intent queries (new 4-type system)
  // exact_person → person_portrait, person_closeup
  if (types.exact_person?.length > 0) {
    sq.person_portrait = types.exact_person[0];
    if (types.exact_person[1]) sq.person_closeup = types.exact_person[1];
  }

  // person_relationship → key_relationship, related_people
  if (types.person_relationship?.length > 0) {
    sq.key_relationship = types.person_relationship[0];
    if (types.person_relationship[1]) sq.related_people = types.person_relationship[1];
  }

  // event_visual → key_activity, event_scene
  if (types.event_visual?.length > 0) {
    sq.key_activity = types.event_visual[0];
    sq.event_scene = types.event_visual[1] || types.event_visual[0];
    sq.storySubject_direct = types.event_visual[0];
  }

  // context_fallback → location_photo, emotion_moment
  if (types.context_fallback?.length > 0) {
    sq.location_photo = types.context_fallback[0];
    if (types.context_fallback[1]) sq.emotion_moment = types.context_fallback[1];
  }

  // ★ Backward compat: old type names still work
  if (types.hero_portrait?.length > 0 && !types.exact_person?.length) {
    sq.person_portrait = types.hero_portrait[0];
    if (types.hero_portrait[1]) sq.person_closeup = types.hero_portrait[1];
  }
  if (types.hero_action?.length > 0 && !types.event_visual?.length) {
    sq.key_activity = types.hero_action[0];
    sq.event_scene = types.hero_action[1] || types.hero_action[0];
  }
  if (types.relationship?.length > 0 && !types.person_relationship?.length) {
    sq.key_relationship = types.relationship[0];
    if (types.relationship[1]) sq.related_people = types.relationship[1];
  }
  if (types.scene_with_people?.length > 0 && !types.context_fallback?.length) {
    sq.person_context = types.scene_with_people[0];
    if (types.scene_with_people[1]) sq.location_photo = types.scene_with_people[1];
  }
  if (types.emotion_moment?.length > 0 && !sq.emotion_moment) {
    sq.emotion_moment = types.emotion_moment[0];
  }

  // ★ Add ALL smart queries เข้า coreImageQueries (ถ้ายังไม่มี)
  const existing = identity.coreImageQueries || [];
  const existingSet = new Set(existing.map(q => q.toLowerCase()));

  for (const q of smart) {
    if (q && !existingSet.has(q.toLowerCase())) {
      existing.push(q);
      existingSet.add(q.toLowerCase());
    }
  }
  identity.coreImageQueries = existing.slice(0, 12);

  // Update searchQueries
  identity.searchQueries = sq;

  // ★★★ Store for SmartBoost + Judge access
  identity._smartQueryKeywords = result.storyKeywords || [];
  identity._smartQueryTheme = result.storyTheme || '';
  identity._visualEvent = result.visualEvent || '';
  identity._visualScenes = result.visualScenes || [];
  identity._smartQueryTypes = types;  // ★ FIX: SmartBoost ต้องใช้ Visual Intent types

  console.log(`${LOG} 💉 Injected into identity: ${Object.keys(types).filter(k => types[k]?.length > 0).join(', ')}`);
  console.log(`${LOG} 📦 coreImageQueries now: ${identity.coreImageQueries.length} total`);
  console.log(`${LOG} 👤 Exact person: [${(types.exact_person || types.hero_portrait || []).join(' | ')}]`);
  console.log(`${LOG} 💑 Person+relationship: [${(types.person_relationship || types.relationship || []).join(' | ')}]`);
  console.log(`${LOG} 🎬 Event visual: [${(types.event_visual || types.hero_action || []).join(' | ')}]`);
  console.log(`${LOG} 🏞️ Context fallback: [${(types.context_fallback || types.scene_with_people || []).join(' | ')}]`);
}

/**
 * Fallback: สร้าง queries จาก data ที่มี (ไม่ใช้ AI)
 */
function fallbackQueries(hero, storySubject, celebratedAction, newsTitle) {
  const queries = [];

  if (hero && storySubject) {
    queries.push(`${hero} ${storySubject}`);
    queries.push(storySubject);
  }
  if (hero && celebratedAction) {
    queries.push(`${hero} ${celebratedAction}`);
  }
  if (newsTitle) {
    // Extract key phrases from title
    const words = newsTitle.replace(/['"]/g, '').split(/\s+/).filter(w => w.length > 2);
    if (words.length > 3) {
      queries.push(words.slice(0, 4).join(' '));
    }
  }
  if (hero) {
    queries.push(`${hero} สัมภาษณ์`);
  }

  console.log(`${LOG} 📋 Fallback: ${queries.length} basic queries`);
  return { smartQueries: queries, storyKeywords: [], injected: false };
}
