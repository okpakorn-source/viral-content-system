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
      { id: 'main',      role: 'hero',      x: 0,   y: 0,   w: 750, h: 1350, fadeRight: 280, fadeBottom: 250, zIndex: 2 },
      { id: 'bg_top',    role: 'scene',     x: 380, y: 0,   w: 820, h: 720,  fadeLeft: 320, fadeBottom: 140, zIndex: 0 },
      { id: 'bg_bottom', role: 'scene',     x: 350, y: 580, w: 850, h: 770,  fadeLeft: 320, fadeTop: 220, zIndex: 1 },
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
      { id: 'main',      role: 'hero',      x: 0,   y: 0,   w: 720, h: 1350, fadeRight: 280, fadeBottom: 250, zIndex: 2 },
      { id: 'bg_top',    role: 'scene',     x: 400, y: 0,   w: 800, h: 740,  fadeLeft: 320, fadeBottom: 150, zIndex: 0 },
      { id: 'bg_bottom', role: 'scene',     x: 380, y: 520, w: 820, h: 830,  fadeLeft: 320, fadeTop: 220, zIndex: 1 },
      { id: 'highlight', role: 'highlight', x: 120, y: 580, w: 560, h: 360,  border: '#CCFF00', borderWidth: 5, zIndex: 3 },
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
      { id: 'main',      role: 'hero',      x: 0,   y: 0,   w: 740, h: 1350, fadeRight: 280, fadeBottom: 250, zIndex: 2 },
      { id: 'bg_top',    role: 'scene',     x: 400, y: 0,   w: 800, h: 720,  fadeLeft: 320, fadeBottom: 140, zIndex: 0 },
      { id: 'bg_bottom', role: 'emotion',   x: 380, y: 580, w: 820, h: 770,  fadeLeft: 320, fadeTop: 220, zIndex: 1 },
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
    // ⛔ DISABLED: circle_small (diameter=200px) ยังเล็กเกินไป — ดูไม่รู้เรื่อง ดูสกปรก
    // ต้อง diameter ≥ 320px จึงจะเปิดใช้ได้
    disabled: true,
    disabledReason: 'circle_small diameter=200px < MIN_CIRCLE_SIZE(320px) — small red circle looks dirty and unreadable',
    canvasW: 1200, canvasH: 1350,
    imageSlots: 5,
    textSlots: [
      { id: 'line1', x: 730, y: 680, fontSize: 48, color: '#FFFFFF', fontWeight: 'bold', align: 'center', maxWidth: 500, stroke: '#000', strokeWidth: 4 },
      { id: 'line2', x: 730, y: 760, fontSize: 40, color: '#FFD700', fontWeight: 'bold', align: 'center', maxWidth: 520, stroke: '#000', strokeWidth: 3, bg: 'rgba(0,0,0,0.65)', bgPadY: 12 },
    ],
    slots: [
      { id: 'main',         role: 'hero',      x: 0,   y: 0,   w: 720, h: 1350, fadeRight: 170, zIndex: 2 },
      { id: 'bg_top',       role: 'scene',     x: 380, y: 0,   w: 820, h: 700,  fadeLeft: 170, fadeBottom: 140, zIndex: 0 },
      { id: 'bg_bottom',    role: 'scene',     x: 350, y: 550, w: 850, h: 800,  fadeLeft: 160, fadeTop: 150, zIndex: 1 },
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
      { id: 'main',      role: 'hero',      x: 0,   y: 0,   w: 730, h: 1350, fadeRight: 280, fadeBottom: 250, zIndex: 2 },
      { id: 'bg_top',    role: 'scene',     x: 400, y: 0,   w: 800, h: 700,  fadeLeft: 320, fadeBottom: 140, zIndex: 0 },
      { id: 'bg_bottom', role: 'scene',     x: 350, y: 560, w: 850, h: 790,  fadeLeft: 320, fadeTop: 220, zIndex: 1 },
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
    // ⛔ DISABLED: circle_small (diameter=160px) เล็กเกินไป — ดูไม่รู้เรื่องว่าใครเป็นใคร
    // ต้อง diameter ≥ 200px จึงจะเปิดใช้ได้
    disabled: true,
    disabledReason: 'circle_small diameter=160px < MIN_CIRCLE_SIZE(200px) — thumbnail too small to identify person',
    canvasW: 1200, canvasH: 1350,
    imageSlots: 5,
    textSlots: [
      { id: 'line1', x: 620, y: 580, fontSize: 46, color: '#FFFFFF', fontWeight: 'bold', align: 'center', maxWidth: 480, stroke: '#000', strokeWidth: 4 },
      { id: 'line2', x: 620, y: 660, fontSize: 40, color: '#FFFFFF', fontWeight: 'bold', align: 'center', maxWidth: 500, stroke: '#000', strokeWidth: 3 },
    ],
    slots: [
      { id: 'main',         role: 'hero',      x: 0,   y: 0,   w: 700, h: 1350, fadeRight: 160, zIndex: 2 },
      { id: 'bg_top',       role: 'scene',     x: 380, y: 0,   w: 820, h: 650,  fadeLeft: 170, fadeBottom: 130, zIndex: 0 },
      { id: 'bg_bottom',    role: 'emotion',   x: 340, y: 520, w: 860, h: 830,  fadeLeft: 160, fadeTop: 150, zIndex: 1 },
      { id: 'circle_small', role: 'highlight', x: 440, y: 180, shape: 'circle', diameter: 160, border: '#FF0000', borderWidth: 3, zIndex: 5 },
    ],
    circle: { id: 'circle', x: 50, y: 680, diameter: 360, border: '#FFFFFF', borderWidth: 5, zIndex: 4 },
  },
  // ═══════════════════════════════════════════════════════════
  // Template 7: 2 ตัวละคร — Hero1 ซ้ายบน + Hero2 ล่างขวา (ตามปกคู่รัก/ครอบครัว)
  // ★ ใหม่: จากตัวอย่างปกไวรัลที่มี 2 ตัวละครหลัก
  // Layout: Hero1 ครอง ซ้ายบน (face ใหญ่), Hero2 ครอง ล่างขวา (face ใหญ่)
  //         BG อยู่ขวาบน, Highlight ตรงกลางขวา, Circle ซ้ายล่าง
  // ═══════════════════════════════════════════════════════════
  {
    id: 'template_7',
    name: '2 ตัวละคร (คู่รัก/ครอบครัว)',
    desc: '5 รูป — Hero1 ซ้ายบน + Hero2 ล่างขวา + BG + Highlight + Circle',
    canvasW: 1200, canvasH: 1350,
    imageSlots: 5,
    textSlots: [],
    slots: [
      // Hero1: ซ้าย — face ใหญ่ ครองทั้งฝั่งซ้าย (ไม่มี gap ซ้ายล่าง!)
      { id: 'main',       role: 'hero',      x: 0,   y: 0,   w: 680, h: 1350, fadeRight: 150, fadeBottom: 0, zIndex: 3 },
      // BG: ขวาบน — context/สถานที่
      { id: 'bg_top',     role: 'scene',     x: 400, y: 0,   w: 800, h: 680,  fadeLeft: 170, fadeBottom: 130, zIndex: 0 },
      // Hero2: ล่างขวา — face คนที่ 2
      { id: 'bg_bottom',  role: 'hero2',     x: 480, y: 650, w: 720, h: 700,  fadeLeft: 120, fadeTop: 120, zIndex: 2 },
      // Highlight: กลางขวา — กรอบภาพบริบท
      { id: 'highlight',  role: 'highlight', x: 480, y: 320, w: 520, h: 360,  border: '#CCFF00', borderWidth: 5, zIndex: 4 },
    ],
    circle: { id: 'circle', x: 25, y: 780, diameter: 380, border: '#FFFFFF', borderWidth: 5, zIndex: 5 },
  },
  // ═══════════════════════════════════════════════════════════
  // Template 8: Clean 4 Zone — แบ่ง Zone ชัด ไม่ซ้อนกัน
  // ★ ใหม่: Fade น้อยลง → หน้าไม่หาย, Zone แยกกันชัด
  // Layout: Hero ครองซ้าย 50%, BG ขวาบน, BG ขวาล่าง, Highlight ขวากลาง
  // ═══════════════════════════════════════════════════════════
  {
    id: 'template_8',
    name: 'ข่าวสะอาด Zone ชัด',
    desc: '5 รูป — Hero ซ้าย 50% + BG แยก Zone + Highlight กลางขวา + Circle',
    canvasW: 1200, canvasH: 1350,
    imageSlots: 5,
    textSlots: [],
    slots: [
      // Hero: ซ้าย 50% — fade น้อยลง ไม่กินหน้า!
      { id: 'main',      role: 'hero',      x: 0,   y: 0,   w: 660, h: 1350, fadeRight: 120, zIndex: 2 },
      // BG top: ขวาบน — ไม่ fade มากเข้ามา
      { id: 'bg_top',    role: 'scene',     x: 480, y: 0,   w: 720, h: 650,  fadeLeft: 120, fadeBottom: 110, zIndex: 0 },
      // BG bottom: ขวาล่าง — แยกชัดจาก bg_top
      { id: 'bg_bottom', role: 'scene',     x: 460, y: 620, w: 740, h: 730,  fadeLeft: 130, fadeTop: 120, zIndex: 1 },
      // Highlight: ขวากลาง — กรอบชัดเจน ไม่ทับ hero
      { id: 'highlight', role: 'highlight', x: 520, y: 280, w: 500, h: 350,  border: '#CCFF00', borderWidth: 5, zIndex: 3 },
    ],
    circle: { id: 'circle', x: 30, y: 720, diameter: 400, border: '#FFFFFF', borderWidth: 5, zIndex: 4 },
  },
];

// ═══ EXPORTS ═══

// ── Circle size gate ─────────────────────────────────────────────────────────
// Templates ที่มี circle หรือ frame slot ขนาดเล็ก (< MIN_CIRCLE_SIZE) จะถูก filter ออก
// เพื่อไม่ให้ thumbnail จิ๋วที่ดูไม่รู้เรื่องปรากฏบนปก
const MIN_CIRCLE_SIZE = 320; // px บน canvas 1200×1350 — ต้องใหญ่พอมองเห็นหน้าคนชัด

/**
 * คืน true ถ้า template มี circle/frame zone ที่เล็กเกินกว่า MIN_CIRCLE_SIZE
 * (ตรวจทั้ง slots[].shape==='circle' และ template.circle / template.circleSmall)
 */
function hasSmallCircle(template) {
  // ตรวจ slots ที่มี shape = 'circle'
  const smallSlot = (template.slots || []).some(
    (s) => s.shape === 'circle' && (s.diameter || 0) < MIN_CIRCLE_SIZE
  );
  if (smallSlot) return true;

  // ตรวจ top-level circle / circleSmall
  if (template.circle && (template.circle.diameter || 0) < MIN_CIRCLE_SIZE) return true;
  if (template.circleSmall && (template.circleSmall.diameter || 0) < MIN_CIRCLE_SIZE) return true;

  return false;
}

export const ALL_TEMPLATES = BUILTIN_TEMPLATES;

export function getTemplateById(id) {
  return ALL_TEMPLATES.find(t => t.id === id) || null;
}

export function getTemplateChoices() {
  return ALL_TEMPLATES
    .filter(t => !t.disabled) // ★ BUG C-12: hide disabled templates from dropdown
    .map(t => ({
      id: t.id,
      name: t.name,
      desc: t.desc,
      imageSlots: t.imageSlots,
      hasText: t.textSlots?.length > 0,
    }));
}

/**
 * Normalize a user/external template object to match the internal format.
 * Used by /api/auto-cover/templates to merge user templates with built-in ones.
 * @param {Object} t — raw template object (may be partial)
 * @returns {Object} normalized template
 */
export function normalizeTemplate(t) {
  return {
    id: t.id || `user_${Date.now()}`,
    name: t.name || t.title || 'Custom Template',
    desc: t.desc || t.description || '',
    canvasW: t.canvasW || 1200,
    canvasH: t.canvasH || 1350,
    imageSlots: t.imageSlots || (t.slots?.length || 4),
    textSlots: t.textSlots || [],
    slots: (t.slots || []).map(s => ({
      id: s.id || 'main',
      role: s.role || 'hero',
      x: s.x || 0,
      y: s.y || 0,
      w: s.w || s.width || 600,
      h: s.h || s.height || 675,
      fadeRight: s.fadeRight || undefined,
      fadeLeft: s.fadeLeft || undefined,
      fadeTop: s.fadeTop || undefined,
      fadeBottom: s.fadeBottom || undefined,
      border: s.border || undefined,
      borderWidth: s.borderWidth || undefined,
      zIndex: s.zIndex || 0,
      shape: s.shape || undefined,
      diameter: s.diameter || undefined,
    })),
    circle: t.circle || null,
    circleSmall: t.circleSmall || null,
    disabled: !!t.disabled,
  };
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
  // ── ก่อน scoring: ตัด templates ที่ disabled หรือมี small circle ออก ──
  const ELIGIBLE_IDS = new Set(
    ALL_TEMPLATES
      .filter((t) => !t.disabled && !hasSmallCircle(t))
      .map((t) => t.id)
  );
  console.log(`[TemplateSelect] Eligible templates (no small circles): ${[...ELIGIBLE_IDS].join(', ')}`);

  if (ELIGIBLE_IDS.size === 0) return null;
  
  const emotion = storyIdentity?.emotion || '';
  const coverEmotion = storyIdentity?.coverEmotion || '';
  const emotionAll = `${emotion} ${coverEmotion}`;
  const storyText = storyIdentity?.story || '';
  const hasText = storyIdentity?.typography?.hook || storyIdentity?.typography?.punch;
  
  // ★ Emotion detection
  const isSad = /เศร้า|สะเทือน|ร้องไห้|เสียใจ|สูญเสีย|ตาย|จากไป|sad|tragedy/i.test(emotionAll);
  const isDrama = /drama|dramatic|shocking|shocked|angry|โกรธ|ช็อก|ด่วน|ฟ้อง|คดี/i.test(emotionAll);
  const isWarm = /warm|hope|happy|สังคม|ช่วยเหลือ|น่ารัก|อบอุ่น|ภูมิใจ/i.test(emotionAll);
  const isNeutral = /neutral/i.test(emotionAll) || (!isSad && !isDrama && !isWarm);
  
  // ★ ตรวจสอบว่าเป็นข่าว "ความสัมพันธ์" จริงๆ ไหม (ไม่ใช่แค่มี 2 ชื่อ)
  const characters = storyIdentity?.characters || [];
  const has2Characters = characters.length >= 2;
  const isRelationshipNews = /คู่รัก|สามี|ภรรยา|แฟน|ครอบครัว|แต่งงาน|หย่า|เลิก|พ่อ|แม่|ลูก|คู่กรณี|พี่น้อง|ผัว|เมีย|คู่ชีวิต|ชีวิตคู่/i.test(storyText);
  
  // ═══ Scoring System — แต่ละ template ได้คะแนนตามความเหมาะสม ═══
  // (เฉพาะ template ที่อยู่ใน ELIGIBLE_IDS เท่านั้น)
  const scores = {};
  
  // --- Template 7: 2 ตัวละคร (คู่รัก/ครอบครัว) ---
  // ★ ต้องเป็นข่าวที่เน้นความสัมพันธ์จริงๆ + มี 2 คน
  if (ELIGIBLE_IDS.has('template_7') && imageCount >= 4 && faceCount >= 2 && has2Characters && isRelationshipNews) {
    scores['template_7'] = 90;
  }
  
  // --- Template 6: สะเทือนใจ + ข้อความ --- ⛔ DISABLED (circle_small=160px)
  // if (imageCount >= 5 && faceCount >= 1 && isSad) {
  //   scores['template_6'] = hasText ? 85 : 70;
  // }
  
  // --- Template 1: ดราม่า 5 ช่อง (ไม่มี circle) ---
  if (ELIGIBLE_IDS.has('template_1') && imageCount >= 5 && faceCount >= 1 && isDrama) {
    scores['template_1'] = 80;
  }
  
  // --- Template 3: ดราม่า + วงกลม ---
  if (ELIGIBLE_IDS.has('template_3') && imageCount >= 5 && faceCount >= 2 && (isSad || isDrama)) {
    scores['template_3'] = 75;
  }
  
  // --- Template 5: เหตุการณ์ 5 ช่อง + circle ---
  if (ELIGIBLE_IDS.has('template_5') && imageCount >= 4 && faceCount >= 1) {
    scores['template_5'] = isDrama ? 72 : (isWarm ? 68 : 65);
  }
  
  // --- Template 8: สะอาด Zone ชัด ---
  if (ELIGIBLE_IDS.has('template_8') && imageCount >= 4 && faceCount >= 1) {
    scores['template_8'] = isWarm ? 78 : (isNeutral ? 72 : 60);
  }
  
  // --- Template 4: สังคม + 2 วงกลม + text ---
  if (ELIGIBLE_IDS.has('template_4') && imageCount >= 5 && faceCount >= 2 && isWarm) {
    scores['template_4'] = hasText ? 80 : 65;
  }
  
  // --- Template 2: สะอาด 4 ช่อง (ไม่มี circle) ---
  // ★ ใหม่! เหมาะกับข่าว neutral / ภาพน้อย / เนื้อหาเรียบ
  if (ELIGIBLE_IDS.has('template_2') && imageCount >= 3) {
    scores['template_2'] = imageCount <= 5 ? 70 : (isNeutral ? 55 : 45);
  }
  
  // ═══ เลือก template จาก score ═══
  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1]);
  
  if (sorted.length === 0) {
    // fallback ต้องเป็น template ที่ eligible เท่านั้น
    return ELIGIBLE_IDS.has('template_5') ? 'template_5' : [...ELIGIBLE_IDS][0] || null;
  }
  
  // ★ Weighted random: เลือกจาก top 2-3 candidates (ไม่ใช่ตัวเดียวทุกครั้ง!)
  const topScore = sorted[0][1];
  // เอา candidates ที่คะแนนห่างจาก top ไม่เกิน 25 คะแนน (ขยาย pool ให้มี variety มากขึ้น)
  const candidates = sorted.filter(([_, score]) => topScore - score <= 25);
  
  // สุ่มแบบถ่วงน้ำหนัก — score สูง = โอกาสมาก
  const totalWeight = candidates.reduce((sum, [_, score]) => sum + score, 0);
  let rand = Math.random() * totalWeight;
  for (const [templateId, score] of candidates) {
    rand -= score;
    if (rand <= 0) {
      console.log(`[TemplateSelect] Chose: ${templateId} (score: ${score}/${topScore}) from ${candidates.length} candidates: ${candidates.map(c => `${c[0]}=${c[1]}`).join(', ')}`);
      return templateId;
    }
  }
  
  // Fallback
  console.log(`[TemplateSelect] Fallback: ${sorted[0][0]}`);
  return sorted[0][0];
}

