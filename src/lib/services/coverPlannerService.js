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

★★★ OCCUPATION DOMINANCE GUARD (บังคับใช้ — ห้ามฝ่าฝืน):
ข่าวนี้คือข่าว ครอบครัว/เสียสละ/กตัญญู — ไม่ใช่ข่าวอาชีพหรือสัตว์

กฎเหล็ก:
1. hero slot → ต้องเป็นหน้าชัดของตัวละครหลัก — ห้ามเป็นภาพสัตว์/ที่ทำงาน EVER
2. circle → ต้องเป็นแม่/พ่อ/ครอบครัว — สำคัญยิ่งกว่าภาพอาชีพ!
3. ภาพสัตว์/เครื่องแบบ/ที่ทำงาน = evidence รอง ไม่เกิน ${occupationMaxPct}% ของ cover
4. slot ที่เหลือ → ลำดับ: caregiving → mother/father/family → interview → hero (สีหน้า)
5. ภาพสัตว์/อาชีพ → ใช้ได้เฉพาะ "support" slot เล็กๆ เท่านั้น

SEVERE FAIL: ถ้าสัตว์หรืออาชีพไปอยู่ใน hero/circle/highlight → cover จะทำให้คนเข้าใจผิดว่าเป็นข่าวอาชีพ ไม่ใช่ข่าวครอบครัว!` : '';

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `คุณเป็น Photo Editor วางแผนปกข่าวไวรัล

ข่าว:
ตัวละครหลัก: "${heroName}"
ตัวละครอื่น: ${relDesc}
ซีนสำคัญ: ${(identity?.keyScenes || []).join(', ') || 'ไม่ระบุ'}
บริบท: ${identity?.story?.slice(0, 200) || 'ไม่ระบุ'}
ประเภทข่าว: ${storyType}

Template: ${templateId}
Slots: ${slotDesc}${hasCircle ? ', circle (portrait ของบุคคล)' : ''}

Evidence categories ที่มีภาพอยู่: ${catList}

กฎพื้นฐาน:
- slot hero → ต้องใช้ "hero" เสมอ
- slot scene → ใช้ location/activity/caregiving/work (ไม่ใช่ hero)
- slot emotion → ใช้ caregiving/activity/interview (ไม่ใช่ hero ถ้าทำได้)
- slot hero2 → ใช้ category ที่เป็น relationship สำคัญ (mother/spouse/child)
- slot highlight → ใช้ activity/caregiving/evidence/interview
- slot support → ใช้ relationship/family/interview
- circle → ใช้ hero หรือ relationship สำคัญ (ต้องเป็นภาพหน้า 1 คน)
${occupationGuardText}

ใช้แค่ categories ที่มีใน: ${catList}

ตอบ JSON เท่านั้น:
{
  "slots": [
    {"slotId": "main", "templateRole": "hero", "evidenceCategory": "hero", "description": "หน้าชัด${heroName}"},
    {"slotId": "bg_top", "templateRole": "scene", "evidenceCategory": "caregiving", "description": "ภาพดูแลแม่/ครอบครัว"}
  ]
}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PLANNER_TIMEOUT_MS);
    let result;
    try {
      result = await model.generateContent(prompt);
    } finally {
      clearTimeout(timer);
    }

    const text = result.response.text().trim();
    const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || text.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) throw new Error('ไม่พบ JSON ใน CoverPlanner response');

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

    console.log(`[CoverPlanner] ✅ ${parsedSlots.length} slots planned: ${parsedSlots.map(s => `${s.slotId}→${s.evidenceCategory}`).join(', ')}`);

    return {
      layout: templateId,
      slots: parsedSlots,
      source: 'gemini',
      dna: dnaResult,
    };
  } catch (e) {
    console.warn(`[CoverPlanner] Gemini failed (${e.message?.slice(0, 60)}) → fallback`);
    const fp = buildFallbackPlan(templateId, templateSpec, resolvedRelationships, identity);
    fp.dna = dnaResult;
    return fp;
  }
}
