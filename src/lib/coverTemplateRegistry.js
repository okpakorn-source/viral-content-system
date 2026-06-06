/**
 * Cover Template Registry — Template ปกข่าวไวรัล
 * 
 * Canvas = 1200 × 1350 px
 * วิเคราะห์จากปกตัวอย่างจริง — ภาพเต็มทุกมุม ไม่มีช่องว่าง
 * 
 * หลักการ: Background images (hero + scene + context) ต้องคลุม 100% ของ canvas
 * โดยใช้ fade/gradient edges ทำให้ overlap กันอย่างสวยงาม
 * 
 * ⚠️ SYNC กับ src/app/cover-tester/page.js BUILTIN_TEMPLATES
 */

// ═══ TEMPLATES (จากปกตัวอย่างจริง) ═══
const BUILTIN_TEMPLATES = [
  // ═══════════════════════════════════════════════════════════
  // Template 1: Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Highlight กลาง + Sub ซ้ายล่าง
  // ═══════════════════════════════════════════════════════════
  {
    id: 'template_1',
    name: 'ข่าวดราม่า 5 ช่อง',
    desc: '5 รูป — Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Highlight + ภาพรอง',
    canvasW: 1200, canvasH: 1350,
    imageSlots: 5,
    textSlots: [],
    slots: [
      { id: 'main',      role: 'hero',      x: 0,   y: 0,   w: 750, h: 1350, fadeRight: 320, zIndex: 2 },
      { id: 'bg_top',    role: 'scene',     x: 380, y: 0,   w: 820, h: 720,  fadeLeft: 380, fadeBottom: 250, zIndex: 0 },
      { id: 'bg_bottom', role: 'scene',     x: 350, y: 580, w: 850, h: 770,  fadeLeft: 320, fadeTop: 280, zIndex: 1 },
      { id: 'highlight', role: 'highlight', x: 370, y: 280, w: 560, h: 400,  border: '#CCFF00', borderWidth: 5, zIndex: 3 },
      { id: 'sub_left',  role: 'support',   x: 15,  y: 610, w: 520, h: 430,  border: '#FFFFFF', borderWidth: 4, zIndex: 4 },
    ],
    circle: null,
  },
  // ═══════════════════════════════════════════════════════════
  // Template 2: Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Highlight กลาง (ไม่มี Circle)
  // ═══════════════════════════════════════════════════════════
  {
    id: 'template_2',
    name: 'ข่าวสะอาด 4 ช่อง',
    desc: '4 รูป — Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Highlight กลาง',
    canvasW: 1200, canvasH: 1350,
    imageSlots: 4,
    textSlots: [],
    slots: [
      { id: 'main',      role: 'hero',      x: 0,   y: 0,   w: 720, h: 1350, fadeRight: 300, zIndex: 2 },
      { id: 'bg_top',    role: 'scene',     x: 400, y: 0,   w: 800, h: 740,  fadeLeft: 360, fadeBottom: 260, zIndex: 0 },
      { id: 'bg_bottom', role: 'scene',     x: 380, y: 520, w: 820, h: 830,  fadeLeft: 340, fadeTop: 280, zIndex: 1 },
      { id: 'highlight', role: 'highlight', x: 120, y: 580, w: 560, h: 360,  border: '#333333', borderWidth: 5, zIndex: 3 },
    ],
    circle: null,
  },
  // ═══════════════════════════════════════════════════════════
  // Template 3: Hero ซ้ายเต็ม + Scene ขวาบน + Emotion ขวาล่าง + Highlight + Circle
  // ═══════════════════════════════════════════════════════════
  {
    id: 'template_3',
    name: 'ข่าวดราม่า + วงกลม',
    desc: '5 รูป — Hero ซ้ายเต็ม + Scene ขวาบน + Emotion ขวาล่าง + Highlight + Circle',
    canvasW: 1200, canvasH: 1350,
    imageSlots: 5,
    textSlots: [],
    slots: [
      { id: 'main',      role: 'hero',      x: 0,   y: 0,   w: 740, h: 1350, fadeRight: 310, zIndex: 2 },
      { id: 'bg_top',    role: 'scene',     x: 400, y: 0,   w: 800, h: 720,  fadeLeft: 360, fadeBottom: 240, zIndex: 0 },
      { id: 'bg_bottom', role: 'emotion',   x: 380, y: 580, w: 820, h: 770,  fadeLeft: 320, fadeTop: 260, zIndex: 1 },
      { id: 'highlight', role: 'highlight', x: 340, y: 280, w: 630, h: 440,  border: '#CCFF00', borderWidth: 5, zIndex: 3 },
    ],
    circle: { id: 'circle', x: 25, y: 680, diameter: 440, border: '#FFFFFF', borderWidth: 6, zIndex: 4 },
  },
  // ═══════════════════════════════════════════════════════════
  // Template 4: Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + 2 วงกลม + ข้อความ
  // ═══════════════════════════════════════════════════════════
  {
    id: 'template_4',
    name: 'ข่าวสังคม + 2 วงกลม',
    desc: '5 รูป + 2 ข้อความ — Hero + Scene + Context + Circle ใหญ่ + Circle เล็กแดง',
    canvasW: 1200, canvasH: 1350,
    imageSlots: 5,
    textSlots: [
      { id: 'line1', x: 730, y: 680, fontSize: 48, color: '#FFFFFF', fontWeight: 'bold', align: 'center', maxWidth: 500, stroke: '#000', strokeWidth: 4 },
      { id: 'line2', x: 730, y: 760, fontSize: 40, color: '#FFD700', fontWeight: 'bold', align: 'center', maxWidth: 520, stroke: '#000', strokeWidth: 3, bg: 'rgba(0,0,0,0.65)', bgPadY: 12 },
    ],
    slots: [
      { id: 'main',         role: 'hero',      x: 0,   y: 0,   w: 720, h: 1350, fadeRight: 300, zIndex: 2 },
      { id: 'bg_top',       role: 'scene',     x: 380, y: 0,   w: 820, h: 700,  fadeLeft: 350, fadeBottom: 240, zIndex: 0 },
      { id: 'bg_bottom',    role: 'scene',     x: 350, y: 550, w: 850, h: 800,  fadeLeft: 320, fadeTop: 260, zIndex: 1 },
      { id: 'circle_small', role: 'highlight', x: 890, y: 15,  shape: 'circle', diameter: 200, border: '#FF0000', borderWidth: 4, zIndex: 5 },
    ],
    circle: { id: 'circle', x: 25, y: 680, diameter: 400, border: '#FFFFFF', borderWidth: 5, zIndex: 4 },
  },
  // ═══════════════════════════════════════════════════════════
  // Template 5: Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Highlight เหลือง + Circle ขาวใหญ่
  // ═══════════════════════════════════════════════════════════
  {
    id: 'template_5',
    name: 'ข่าวเหตุการณ์ 5 ช่อง',
    desc: '5 รูป — Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Highlight เหลือง + Circle ขาว',
    canvasW: 1200, canvasH: 1350,
    imageSlots: 5,
    textSlots: [],
    slots: [
      { id: 'main',      role: 'hero',      x: 0,   y: 0,   w: 730, h: 1350, fadeRight: 300, zIndex: 2 },
      { id: 'bg_top',    role: 'scene',     x: 400, y: 0,   w: 800, h: 700,  fadeLeft: 360, fadeBottom: 240, zIndex: 0 },
      { id: 'bg_bottom', role: 'scene',     x: 350, y: 560, w: 850, h: 790,  fadeLeft: 320, fadeTop: 260, zIndex: 1 },
      { id: 'highlight', role: 'highlight', x: 420, y: 310, w: 580, h: 410,  border: '#FFD700', borderWidth: 5, zIndex: 3 },
    ],
    circle: { id: 'circle', x: 15, y: 630, diameter: 460, border: '#FFFFFF', borderWidth: 5, zIndex: 4 },
  },
  // ═══════════════════════════════════════════════════════════
  // Template 6: Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Circle แดงกลาง + Circle ขาว + ข้อความ
  // ═══════════════════════════════════════════════════════════
  {
    id: 'template_6',
    name: 'ข่าวสะเทือนใจ + ข้อความ',
    desc: '5 รูป + 2 ข้อความ — Hero + Scene + Context + Circle แดงกลาง + Circle ขาวล่าง',
    canvasW: 1200, canvasH: 1350,
    imageSlots: 5,
    textSlots: [
      { id: 'line1', x: 620, y: 580, fontSize: 46, color: '#FFFFFF', fontWeight: 'bold', align: 'center', maxWidth: 480, stroke: '#000', strokeWidth: 4 },
      { id: 'line2', x: 620, y: 660, fontSize: 40, color: '#FFFFFF', fontWeight: 'bold', align: 'center', maxWidth: 500, stroke: '#000', strokeWidth: 3 },
    ],
    slots: [
      { id: 'main',         role: 'hero',      x: 0,   y: 0,   w: 700, h: 1350, fadeRight: 280, zIndex: 2 },
      { id: 'bg_top',       role: 'scene',     x: 380, y: 0,   w: 820, h: 650,  fadeLeft: 350, fadeBottom: 220, zIndex: 0 },
      { id: 'bg_bottom',    role: 'emotion',   x: 340, y: 520, w: 860, h: 830,  fadeLeft: 320, fadeTop: 260, zIndex: 1 },
      { id: 'circle_small', role: 'highlight', x: 440, y: 180, shape: 'circle', diameter: 160, border: '#FF0000', borderWidth: 3, zIndex: 5 },
    ],
    circle: { id: 'circle', x: 50, y: 680, diameter: 360, border: '#FFFFFF', borderWidth: 5, zIndex: 4 },
  },
];

// ═══ NORMALIZE USER TEMPLATES ═══

/** Guess slot role from slot id (for user templates that don't have role) */
function guessRole(id) {
  if (!id) return 'support';
  const lower = id.toLowerCase();
  if (lower === 'main' || lower.includes('hero')) return 'hero';
  if (lower.includes('bg_top') || lower.includes('scene')) return 'scene';
  if (lower.includes('bg_bottom') || lower.includes('emotion')) return 'scene';
  if (lower.includes('highlight') || lower.includes('evidence')) return 'highlight';
  if (lower.includes('circle')) return 'highlight';
  if (lower.includes('sub') || lower.includes('support')) return 'support';
  return 'support';
}

/**
 * Normalize a user template (from template-library/store) to match
 * the builtin template format expected by the auto-cover pipeline.
 * 
 * Fills: canvasW/canvasH, imageSlots, role per slot, standalone circle field.
 * Safe to call on builtin templates too (no-op in practice).
 */
export function normalizeTemplate(tmpl) {
  if (!tmpl || !tmpl.slots) return tmpl;

  // Extract standalone circle from slots[] if not already present
  let circle = tmpl.circle || null;
  if (!circle) {
    const circleSlot = tmpl.slots.find(
      s => s.shape === 'circle' && (s.id === 'circle' || s.id?.startsWith('circle'))
    );
    if (circleSlot) {
      circle = {
        id: circleSlot.id,
        x: circleSlot.x,
        y: circleSlot.y,
        diameter: circleSlot.diameter,
        border: circleSlot.border || '#FFFFFF',
        borderWidth: circleSlot.borderWidth || 5,
        zIndex: circleSlot.zIndex || 4,
      };
    }
  }

  // Normalize slots: add role, keep all existing fields
  const normalizedSlots = (tmpl.slots || []).map(s => ({
    role: s.role || guessRole(s.id),
    ...s,
  }));

  // Count non-circle image slots for imageSlots
  const imageSlots = tmpl.imageSlots || normalizedSlots.length;

  return {
    canvasW: tmpl.canvasW || 1200,
    canvasH: tmpl.canvasH || 1350,
    imageSlots,
    textSlots: tmpl.textSlots || [],
    circle,
    ...tmpl,
    // Override with normalized values (after spread so they win)
    slots: normalizedSlots,
  };
}

// ═══ EXPORTS ═══

export const ALL_TEMPLATES = BUILTIN_TEMPLATES;

export function getTemplateById(id) {
  return ALL_TEMPLATES.find(t => t.id === id) || null;
}

export function getTemplateChoices() {
  return ALL_TEMPLATES.map(t => ({
    id: t.id,
    name: t.name,
    desc: t.desc,
    imageSlots: t.imageSlots,
    hasText: t.textSlots?.length > 0,
  }));
}

export function scaleTemplateSlots(template, targetW, targetH) {
  const scaleX = targetW / template.canvasW;
  const scaleY = targetH / template.canvasH;

  const scaledSlots = template.slots.map(s => ({
    ...s,
    x: Math.round(s.x * scaleX),
    y: Math.round(s.y * scaleY),
    w: Math.round(s.w * scaleX),
    h: Math.round(s.h * scaleY),
    fadeRight: s.fadeRight ? Math.round(s.fadeRight * scaleX) : undefined,
    fadeLeft: s.fadeLeft ? Math.round(s.fadeLeft * scaleX) : undefined,
    fadeTop: s.fadeTop ? Math.round(s.fadeTop * scaleY) : undefined,
    fadeBottom: s.fadeBottom ? Math.round(s.fadeBottom * scaleY) : undefined,
  }));

  const scaleCircle = (c) => {
    if (!c) return null;
    return {
      ...c,
      x: Math.round(c.x * scaleX),
      y: Math.round(c.y * scaleY),
      diameter: Math.round(c.diameter * Math.min(scaleX, scaleY)),
    };
  };

  return {
    slots: scaledSlots,
    circle: scaleCircle(template.circle),
    circleSmall: scaleCircle(template.circleSmall),
  };
}

/**
 * Get an alternate template ID different from the current one,
 * best-fit for the given image count.
 * @param {string} currentId - Current template ID
 * @param {number} imageCount - Number of available images
 * @returns {string|null} - Alternate template ID or null if none
 */
export function getAlternateTemplate(currentId, imageCount) {
  const all = ['template_1','template_2','template_3','template_4','template_5','template_6'];
  const others = all.filter(id => id !== currentId);
  if (others.length === 0) return null;
  // Pick based on imageCount fit
  if (imageCount >= 5) return others.find(id => ['template_1','template_4','template_5'].includes(id)) || others[0];
  if (imageCount >= 3) return others.find(id => ['template_3','template_6'].includes(id)) || others[0];
  return others[0];
}

export function autoSelectTemplate(imageCount, faceCount, storyIdentity) {
  if (ALL_TEMPLATES.length === 0) return null;
  
  const emotion = storyIdentity?.emotion || '';
  const hasText = storyIdentity?.typography?.hook || storyIdentity?.typography?.punch;
  const isSad = /เศร้า|สะเทือน|ร้องไห้|เสียใจ|สูญเสีย|ตาย/.test(emotion);
  const isSocial = /สังคม|ช่วยเหลือ|น่าสงสาร|คนจน/.test(emotion);
  
  // T6: สะเทือนใจ + text (5+ images, emotional, has text)
  if (imageCount >= 5 && faceCount >= 2 && isSad && hasText) return 'template_6';
  // T4: สังคม + 2 วงกลม (5+ images, social, has text)
  if (imageCount >= 5 && faceCount >= 2 && (isSocial || hasText)) return 'template_4';
  // T3: ดราม่า + วงกลม (5+ images, 2+ faces)
  if (imageCount >= 5 && faceCount >= 2) return 'template_3';
  // T5: เหตุการณ์ (5+ images, event focused)
  if (imageCount >= 5 && faceCount <= 1) return 'template_5';
  // T1: ดราม่า 5 ช่อง (5+ images)
  if (imageCount >= 5) return 'template_1';
  // T2: สะอาด 4 ช่อง (default)
  return 'template_2';
}

// ═══ AI-POWERED TEMPLATE SELECTION & TEXT GENERATION ═══

/**
 * AI-powered template selection — uses GPT to analyze news content
 * and choose the best template based on content, emotion, image count.
 * Falls back to rule-based autoSelectTemplate on failure.
 * 
 * @param {Object} context - { imageCount, faceCount, storyIdentity, newsTitle, newsContent, userTemplates }
 * @returns {Promise<{templateId: string, reason: string, coverTexts: Object|null}>}
 */
export async function aiSelectTemplate(context) {
  const { imageCount, faceCount, storyIdentity, newsTitle, newsContent, userTemplates = [] } = context;
  
  try {
    // Build template catalog for AI
    const builtinChoices = ALL_TEMPLATES.map(t => (
      `- ${t.id}: "${t.name}" — ${t.imageSlots} ภาพ${t.circle ? ' + วงกลม' : ''}${t.textSlots?.length ? ` + ${t.textSlots.length} บรรทัดข้อความ` : ''} — ${t.desc}`
    )).join('\n');
    
    const userChoices = userTemplates.map(t => (
      `- ${t.id}: "${t.name}" — ${t.imageSlots || t.slots?.length || '?'} ภาพ — ${t.desc || 'User template'}`
    )).join('\n');
    
    const allChoices = userChoices ? builtinChoices + '\n' + userChoices : builtinChoices;
    
    const prompt = `เลือก template ปกข่าวที่เหมาะสมที่สุดสำหรับข่าวนี้:

## ข้อมูลข่าว
หัวข้อ: ${newsTitle || 'ไม่ระบุ'}
อารมณ์: ${storyIdentity?.emotion || 'ไม่ระบุ'}
ตัวละคร: ${storyIdentity?.characters?.map(c => c.name || c).join(', ') || 'ไม่ระบุ'}
จำนวนภาพที่หาได้: ${imageCount} ภาพ
จำนวนภาพที่มีใบหน้า: ${faceCount} ภาพ

## Template ที่เลือกได้
${allChoices}

## กฎการเลือก
1. template ที่ต้องใช้ 5 ภาพ — ห้ามเลือกถ้ามีภาพ < 4
2. template ที่ต้องใช้ 4 ภาพ (template_2) — เหมาะกับภาพน้อย
3. ข่าวมีตัวละคร 2+ คน — ควรใช้ template ที่มีวงกลม (ใส่หน้าตัวละครเสริม)
4. ข่าวเศร้า/สะเทือนใจ — ควรใช้ template ที่มีข้อความ (template_4/6)
5. ข่าวเหตุการณ์/ผจญภัย — template_5 (เหตุการณ์ 5 ช่อง)
6. ข่าวดราม่าทั่วไป — template_1 หรือ template_3

ตอบเป็น JSON เท่านั้น:
{"templateId": "template_X", "reason": "เหตุผลสั้นๆ"}${context.needCoverText ? `

## ข้อความบนปก
ถ้า template ที่เลือกมีข้อความ (มี textSlots) ให้สร้างข้อความที่ทรงพลังด้านจิตใจที่สุด ด้านบวกที่สุด กระชับ สั้นๆ ดึงจุดเด่นที่สุดของข่าว
เพิ่มใน JSON: "coverTexts": {"line1": "บรรทัด 1", "line2": "บรรทัด 2"}` : ''}`;

    // Use callSmartAI for routing
    const { callSmartAI } = await import('@/lib/ai/aiRouter');
    const { result } = await callSmartAI('general', {
      prompt,
      temperature: 0.3,
      maxTokens: 500,
    });
    
    // Parse JSON from response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      // Validate templateId exists
      const validId = parsed.templateId;
      const found = ALL_TEMPLATES.find(t => t.id === validId) || userTemplates.find(t => t.id === validId);
      if (found) {
        return {
          templateId: validId,
          reason: parsed.reason || 'AI selected',
          coverTexts: parsed.coverTexts || null,
        };
      }
    }
    // If parsing fails, fallback
    throw new Error('AI response parsing failed');
  } catch (err) {
    console.warn('[CoverRegistry] AI template selection failed, using rule-based:', err.message);
    return {
      templateId: autoSelectTemplate(imageCount, faceCount, storyIdentity),
      reason: 'Rule-based fallback',
      coverTexts: null,
    };
  }
}

/**
 * Generate cover text for templates with textSlots.
 * Produces short, powerful, emotionally impactful headlines.
 * 
 * @param {Object} context - { newsTitle, newsContent, storyIdentity, templateId }
 * @returns {Promise<Object>} - { line1: string, line2: string }
 */
export async function aiGenerateCoverText(context) {
  const { newsTitle, newsContent, storyIdentity, templateId } = context;
  
  const template = getTemplateById(templateId);
  if (!template || !template.textSlots?.length) return null;
  
  try {
    const { callSmartAI } = await import('@/lib/ai/aiRouter');
    
    const prompt = `สร้างข้อความสำหรับปกข่าว ${template.textSlots.length} บรรทัด:

## ข่าว
หัวข้อ: ${newsTitle || ''}
เนื้อหา: ${(newsContent || '').slice(0, 500)}
อารมณ์: ${storyIdentity?.emotion || 'ไม่ระบุ'}

## กฎ
- บรรทัด 1: พาดหัวหลัก สั้นกระชับ ทรงพลัง ดึงดูดคนอ่าน (ไม่เกิน 10 ตัวอักษร)
- บรรทัด 2: รายละเอียดเสริม สั้นกว่าบรรทัด 1 เล็กน้อย (ไม่เกิน 15 ตัวอักษร)
- ดึงจุดเด่นที่สุดของข่าว ด้านบวกที่สุด ทรงพลังด้านจิตใจที่สุด
- ห้ามใส่อีโมจิ ห้ามใช้ภาษาที่หยาบคาย

ตอบ JSON เท่านั้น:
{"line1": "พาดหัวหลัก", "line2": "รายละเอียด"}`;

    const { result } = await callSmartAI('general', {
      prompt,
      temperature: 0.5,
      maxTokens: 300,
    });
    
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed;
    }
    return null;
  } catch (err) {
    console.warn('[CoverRegistry] AI text generation failed:', err.message);
    // Fallback: use news title
    return {
      line1: (newsTitle || '').slice(0, 20),
      line2: storyIdentity?.emotion || '',
    };
  }
}
