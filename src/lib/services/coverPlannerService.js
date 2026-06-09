/**
 * Cover Planner Service
 * วางแผน Layout + กำหนดว่าต้องการภาพอะไรใน slot ไหน
 * Input: resolvedRelationships, templateId, identity
 * Output: { layout, slots: [{slotId, role, evidenceCategory, description}], dna }
 *
 * v3: เรียก coverDNAService ก่อนเพื่อ recommend template ตาม story type
 */

const PLANNER_TIMEOUT_MS = 8000;

/**
 * Map slot roles จาก coverTemplateRegistry → evidenceCategory เหมาะสม
 * slot role: 'hero', 'scene', 'emotion', 'hero2', 'highlight', 'support'
 */
function getDefaultCategoryForSlot(slotRole, evidenceCategories, relationships) {
  const hasCategory = (cat) => evidenceCategories.includes(cat);
  const relRoles = relationships.map(r => r.role);

  switch (slotRole) {
    case 'hero':
      return 'hero';

    case 'scene':
      // ค้นหา context/location ก่อน → ถ้าไม่มี fallback activity/interview
      if (hasCategory('location')) return 'location';
      if (hasCategory('activity')) return 'activity';
      if (hasCategory('caregiving')) return 'caregiving';
      if (hasCategory('work')) return 'work';
      return 'hero';

    case 'emotion':
      // อารมณ์/บริบท
      if (hasCategory('caregiving')) return 'caregiving';
      if (hasCategory('activity')) return 'activity';
      if (hasCategory('interview')) return 'interview';
      return 'hero';

    case 'hero2':
      // ตัวละครที่ 2 — หา relationship ที่ importance=high ก่อน
      const highRel = relationships.find(r => r.importance === 'high');
      if (highRel && hasCategory(highRel.role)) return highRel.role;
      if (hasCategory('mother')) return 'mother';
      if (hasCategory('spouse')) return 'spouse';
      if (hasCategory('child')) return 'child';
      if (hasCategory('relationship')) return 'relationship';
      return 'hero';

    case 'highlight':
      // กิจกรรมหลัก / หลักฐาน
      if (hasCategory('activity')) return 'activity';
      if (hasCategory('caregiving')) return 'caregiving';
      if (hasCategory('evidence')) return 'evidence';
      if (hasCategory('interview')) return 'interview';
      if (hasCategory('work')) return 'work';
      return 'hero';

    case 'support':
      // รองรับทั้งหมด — ใช้ relationship ที่เหลือ
      const medRel = relationships.find(r => r.importance !== 'low');
      if (medRel && hasCategory(medRel.role)) return medRel.role;
      if (hasCategory('family')) return 'family';
      if (hasCategory('interview')) return 'interview';
      return 'hero';

    default:
      return 'hero';
  }
}

/**
 * สร้าง default cover plan โดยไม่ใช้ AI (fallback)
 */
function buildFallbackPlan(templateId, templateSpec, resolvedRelationships, identity) {
  const { evidenceCategories = [], relationships = [] } = resolvedRelationships || {};
  const slots = [];

  for (const slot of (templateSpec?.slots || [])) {
    const evidenceCat = getDefaultCategoryForSlot(slot.role, evidenceCategories, relationships);
    slots.push({
      slotId: slot.id,
      templateRole: slot.role,
      evidenceCategory: evidenceCat,
      description: `${slot.id} slot → ${evidenceCat} images`,
    });
  }

  // Circle slot
  if (templateSpec?.circle) {
    // Circle ต้องการหน้าคนชัด — ลำดับ: hero2/relationship → hero
    const circleRel = relationships.find(r => r.importance === 'high');
    const circleCat = circleRel && evidenceCategories.includes(circleRel.role)
      ? circleRel.role
      : 'hero';
    slots.push({
      slotId: 'circle',
      templateRole: 'circle',
      evidenceCategory: circleCat,
      description: `circle → ${circleCat} portrait`,
    });
  }

  return {
    layout: templateId,
    slots,
    source: 'fallback',
  };
}

/**
 * planCoverLayout — วางแผน slot-to-evidence mapping ด้วย Gemini Flash
 * @param {Object} resolvedRelationships — output จาก resolveRelationships
 * @param {string} templateId — template ที่เลือก
 * @param {Object} identity — จาก analyzeStoryIdentity
 * @returns {{ layout, slots, source }}
 */
export async function planCoverLayout(resolvedRelationships, templateId, identity) {
  // ★ v3: Cover DNA — ดู story type ก่อน → อาจ override templateId
  let dnaResult = null;
  try {
    const { matchCoverDNA } = await import('@/lib/services/coverDNAService');
    dnaResult = matchCoverDNA(identity);
    // ถ้า DNA recommend template ที่ชัดเจน (ไม่ใช่ null) → ใช้ แทน templateId ที่ส่งมา
    if (dnaResult.recommendedTemplate && templateId === 'auto') {
      console.log(`[CoverPlanner] 🧬 DNA override: ${templateId} → ${dnaResult.recommendedTemplate} (${dnaResult.storyType})`);
      templateId = dnaResult.recommendedTemplate;
    } else if (dnaResult.recommendedTemplate) {
      console.log(`[CoverPlanner] 🧬 DNA suggestion: ${dnaResult.recommendedTemplate} (${dnaResult.storyType}) — using provided: ${templateId}`);
    }
  } catch (dnaErr) {
    console.warn('[CoverPlanner] CoverDNA error (non-critical):', dnaErr.message);
  }

  // อ่าน template spec
  let templateSpec = null;
  try {
    const { getTemplateById } = await import('@/lib/coverTemplateRegistry');
    templateSpec = getTemplateById(templateId);
  } catch (e) {
    console.warn('[CoverPlanner] Cannot load template spec:', e.message);
  }

  if (!templateSpec) {
    console.warn(`[CoverPlanner] Template "${templateId}" not found → fallback plan`);
    return buildFallbackPlan(templateId, null, resolvedRelationships, identity);
  }

  const { hero, relationships = [], evidenceCategories = [] } = resolvedRelationships || {};
  const heroName = hero?.name || identity?.mainCharacter || '';

  if (!heroName || evidenceCategories.length === 0) {
    return buildFallbackPlan(templateId, templateSpec, resolvedRelationships, identity);
  }

  // สร้าง slot descriptions สำหรับ Gemini
  const slotDesc = templateSpec.slots.map(s => `${s.id} (role: ${s.role})`).join(', ');
  const hasCircle = !!templateSpec.circle;
  const catList = evidenceCategories.join(', ');
  const relDesc = relationships.map(r => `${r.name} (${r.role}, ${r.importance})`).join(', ') || 'ไม่มี';

  // ★ Occupation Guard: ตรวจ storyType → สร้าง guard text สำหรับ family_care
  const storyType = dnaResult?.storyType || 'default';
  const isFamilyCare = storyType === 'family_care' || storyType === 'relationship';
  const occupationMaxPct = isFamilyCare ? (storyType === 'relationship' ? 15 : 20) : 100;
  const occupationGuardText = isFamilyCare ? `

★★★ OCCUPATION DOMINANCE GUARD (STRICTLY ENFORCED — NO EXCEPTIONS):
This is a FAMILY/SACRIFICE/GRATITUDE story — NOT an occupation or animal story.

Strict Rules:
1. hero slot → MUST be a clear face of the main character — NEVER animals/workplace images
2. circle → MUST be mother/father/family — MORE important than occupation images!
3. Animal/uniform/workplace images = secondary evidence, max ${occupationMaxPct}% of cover
4. Remaining slots → priority order: caregiving → mother/father/family → interview → hero (expression)
5. Animal/occupation images → ONLY allowed in small "support" slots

SEVERE FAIL: If animals or occupation images end up in hero/circle/highlight → the cover will mislead viewers into thinking this is an occupation story, not a family story!` : '';

  // ★ GPT-4o-mini — replace Gemini with OpenAI
  try {
    const prompt = `You are a Photo Editor planning a viral news cover layout.

News Context:
Main character: "${heroName}"
Other characters: ${relDesc}
Key scenes: ${(identity?.keyScenes || []).join(', ') || 'unspecified'}
Context: ${identity?.story?.slice(0, 200) || 'unspecified'}
Story type: ${storyType}

Template: ${templateId}
Slots: ${slotDesc}${hasCircle ? ', circle (single person portrait)' : ''}

Available evidence categories: ${catList}

Slot Assignment Rules:
- hero slot → ALWAYS use "hero" category
- scene slot → use location/activity/caregiving/work (NOT hero)
- emotion slot → use caregiving/activity/interview (avoid hero if possible)
- hero2 slot → use the most important relationship category (mother/spouse/child)
- highlight slot → use activity/caregiving/evidence/interview
- support slot → use relationship/family/interview
- circle → use hero or important relationship (MUST be single face portrait)
${occupationGuardText}

ONLY use categories from: ${catList}

Respond with JSON ONLY:
{
  "slots": [
    {"slotId": "main", "templateRole": "hero", "evidenceCategory": "hero", "description": "clear face of ${heroName}"},
    {"slotId": "bg_top", "templateRole": "scene", "evidenceCategory": "caregiving", "description": "caregiving/family scene"}
  ]
}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PLANNER_TIMEOUT_MS);

    let gptRes;
    try {
      gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 800,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!gptRes.ok) {
      const errBody = await gptRes.text().catch(() => '');
      throw new Error(`OpenAI API ${gptRes.status}: ${errBody.slice(0, 100)}`);
    }

    const gptData = await gptRes.json();
    const text = (gptData.choices?.[0]?.message?.content || '').trim();
    const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || text.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) throw new Error('ไม่พบ JSON ใน CoverPlanner GPT response');

    const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    const parsedSlots = (parsed.slots || []).filter(s =>
      s.slotId && s.evidenceCategory && evidenceCategories.includes(s.evidenceCategory)
    );

    if (parsedSlots.length === 0) throw new Error('ไม่มี slot ที่ valid');

    // เพิ่ม circle ถ้า AI ไม่ได้ใส่
    if (hasCircle && !parsedSlots.find(s => s.slotId === 'circle')) {
      const circleRel = relationships.find(r => r.importance === 'high');
      const circleCat = circleRel && evidenceCategories.includes(circleRel.role)
        ? circleRel.role
        : 'hero';
      parsedSlots.push({
        slotId: 'circle',
        templateRole: 'circle',
        evidenceCategory: circleCat,
        description: `circle portrait → ${circleCat}`,
      });
    }

    console.log(`[CoverPlanner] ✅ ${parsedSlots.length} slots planned: ${parsedSlots.map(s => `${s.slotId}→${s.evidenceCategory}`).join(', ')} (model: gpt-4o-mini)`);

    return {
      layout: templateId,
      slots: parsedSlots,
      source: 'gpt',
      dna: dnaResult,
      modelUsed: 'gpt-4o-mini',
    };
  } catch (e) {
    console.warn(`[CoverPlanner] GPT-4o-mini failed (${e.message?.slice(0, 80)}) → fallback`);
    const fp = buildFallbackPlan(templateId, templateSpec, resolvedRelationships, identity);
    fp.dna = dnaResult;
    return fp;
  }
}
