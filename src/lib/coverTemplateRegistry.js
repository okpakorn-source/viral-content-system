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
