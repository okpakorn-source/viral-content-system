/**
 * News Image Template Definitions
 * แต่ละ template กำหนด zones, positions, effects, color scheme
 *
 * Template naming:
 *   grid_circle    — 2x2 grid + circle กลาง  (รูปแบบที่ 1)
 *   big_face_multi — ใบหน้าใหญ่ bg + multi zones (รูปแบบที่ 2)
 *   big_face_ev    — ใบหน้าใหญ่ bg + evidence bordered (รูปแบบที่ 3)
 *   accident / crime / politics / economy / entertainment — templates เดิม
 */

export const TEMPLATES = {

  // ═══════════════════════════════════════════════════════════════
  // NEW TEMPLATES — จากรูปตัวอย่างจริง
  // ═══════════════════════════════════════════════════════════════

  // ─── 1: 2x2 Grid + Circle Center ─────────────────────────────
  grid_circle: {
    id: 'grid_circle',
    name: 'Grid + วงกลมกลาง',
    emoji: '⊞',
    keywords: ['กลุ่ม', 'คนหลายคน', 'ไลฟ์สไตล์', 'อาชีพ', 'human interest'],
    colorScheme: { border: '#ffffff', borderWidth: 6, overlay: 'rgba(0,0,0,0.0)' },
    zones: [
      // 4 ช่องเท่ากัน
      { id: 'z1', role: 'main_face',  position: { x: 0,   y: 0,   w: 537, h: 537 }, effect: 'none' },
      { id: 'z2', role: 'context',    position: { x: 543, y: 0,   w: 537, h: 537 }, effect: 'none' },
      { id: 'z3', role: 'secondary',  position: { x: 0,   y: 543, w: 537, h: 537 }, effect: 'none' },
      { id: 'z4', role: 'event',      position: { x: 543, y: 543, w: 537, h: 537 }, effect: 'none' },
      // วงกลมกลาง overlap (340px diameter, centred at 540,540)
      { id: 'circle', role: 'memorial', position: { x: 370, y: 370, w: 340, h: 340 }, effect: 'circle_color' },
    ],
    layout: { canvas: { width: 1080, height: 1080 } },
  },

  // ─── 2: Big Face BG + Multi Zones ────────────────────────────
  big_face_multi: {
    id: 'big_face_multi',
    name: 'ใบหน้าใหญ่ + Multi',
    emoji: '👤',
    keywords: ['ดารา', 'บ้าน', 'ครอบครัว', 'คนดัง', 'ไลฟ์สไตล์', 'entertainment'],
    colorScheme: { border: '#a3e635', borderWidth: 7, overlay: 'rgba(0,0,0,0.0)' },
    zones: [
      // ใบหน้าใหญ่ซ้าย — soft edge ขวา
      { id: 'main',      role: 'main_face',  position: { x: 0,   y: 0,    w: 590,  h: 780 }, effect: 'soft_right' },
      // บนขวา — บ้าน / สถานที่
      { id: 'bg_right',  role: 'context',    position: { x: 600, y: 0,    w: 480,  h: 370 }, effect: 'none' },
      // กลางขวา — bordered เขียวสด
      { id: 'event',     role: 'event',      position: { x: 600, y: 380,  w: 480,  h: 280 }, effect: 'border_lime' },
      // ล่างซ้าย — วงกลมครอบครัว
      { id: 'circle',    role: 'memorial',   position: { x: 20,  y: 790,  w: 290,  h: 290 }, effect: 'circle_color' },
      // ล่างขวา — ใบหน้าที่ 2
      { id: 'secondary', role: 'secondary',  position: { x: 360, y: 680,  w: 720,  h: 400 }, effect: 'none' },
    ],
    layout: { canvas: { width: 1080, height: 1080 } },
  },

  // ─── 3: Big Face BG + Evidence Bordered ──────────────────────
  big_face_ev: {
    id: 'big_face_ev',
    name: 'ใบหน้า BG + หลักฐาน',
    emoji: '🔍',
    keywords: ['ทหาร', 'หลักฐาน', 'ข่าวหนัก', 'อาชญากรรม', 'เหตุการณ์', 'viral'],
    colorScheme: { border: '#a3e635', borderWidth: 8, overlay: 'rgba(0,0,0,0.0)' },
    zones: [
      // ใบหน้าใหญ่ซ้าย bg (desaturate เล็กน้อย)
      { id: 'main',   role: 'main_face', position: { x: 0,   y: 0,   w: 620,  h: 1080 }, effect: 'desaturate' },
      // ขวาบน — evidence bordered เขียวสด
      { id: 'ev1',    role: 'event',     position: { x: 630, y: 0,   w: 450,  h: 440  }, effect: 'border_lime' },
      // กลางซ้าย overlap — bordered เขียวสด
      { id: 'ev2',    role: 'context',   position: { x: 20,  y: 630, w: 400,  h: 350  }, effect: 'border_lime' },
      // ขวาล่าง — รูปที่ 4
      { id: 'extra',  role: 'secondary', position: { x: 630, y: 450, w: 450,  h: 630  }, effect: 'none' },
    ],
    layout: { canvas: { width: 1080, height: 1080 } },
  },

  // ═══════════════════════════════════════════════════════════════
  // ORIGINAL TEMPLATES
  // ═══════════════════════════════════════════════════════════════

  // ─── A: ACCIDENT / DISASTER ───────────────────────────────────
  accident: {
    id: 'accident',
    name: 'อุบัติเหตุ / ภัยพิบัติ',
    emoji: '🚨',
    keywords: ['อุบัติเหตุ', 'ชน', 'ระเบิด', 'ไฟไหม้', 'น้ำท่วม', 'พังถล่ม', 'เสียชีวิต', 'บาดเจ็บ', 'เหยื่อ'],
    colorScheme: { border: '#22c55e', borderWidth: 7, overlay: 'rgba(0,0,0,0.25)' },
    layout: { canvas: { width: 1080, height: 1080 } },
    zones: [
      { id: 'bg',        role: 'background',  position: { x: 0,   y: 0,   w: 1080, h: 1080 }, effect: 'blur_dark' },
      { id: 'main',      role: 'main_face',   position: { x: 0,   y: 0,   w: 590,  h: 680  }, effect: 'soft_right' },
      { id: 'context',   role: 'context',     position: { x: 595, y: 0,   w: 485,  h: 330  }, effect: 'none' },
      { id: 'event',     role: 'event',       position: { x: 595, y: 340, w: 485,  h: 330  }, effect: 'border_green' },
      { id: 'secondary', role: 'secondary',   position: { x: 340, y: 690, w: 420,  h: 390  }, effect: 'none' },
      { id: 'memorial',  role: 'memorial',    position: { x: 10,  y: 710, w: 310,  h: 310  }, effect: 'circle_bw' },
    ],
  },

  // ─── B: CRIME ─────────────────────────────────────────────────
  crime: {
    id: 'crime',
    name: 'อาชญากรรม',
    emoji: '🔴',
    keywords: ['จับกุม', 'ยาเสพติด', 'ปล้น', 'ฆาตกรรม', 'ข่มขืน', 'ฉ้อโกง', 'โจร', 'ตำรวจ'],
    colorScheme: { border: '#ef4444', borderWidth: 7, overlay: 'rgba(0,0,0,0.35)' },
    layout: { canvas: { width: 1080, height: 1080 } },
    zones: [
      { id: 'bg',       role: 'background', position: { x: 0,   y: 0,   w: 1080, h: 1080 }, effect: 'blur_dark' },
      { id: 'evidence', role: 'event',      position: { x: 0,   y: 0,   w: 1080, h: 480  }, effect: 'border_red' },
      { id: 'main',     role: 'main_face',  position: { x: 0,   y: 490, w: 560,  h: 590  }, effect: 'soft_top' },
      { id: 'context',  role: 'context',    position: { x: 570, y: 490, w: 510,  h: 590  }, effect: 'none' },
    ],
  },

  // ─── C: POLITICS ──────────────────────────────────────────────
  politics: {
    id: 'politics',
    name: 'การเมือง',
    emoji: '🏛️',
    keywords: ['รัฐบาล', 'นายก', 'รัฐมนตรี', 'สภา', 'พรรค', 'เลือกตั้ง', 'นโยบาย', 'รัฐประหาร'],
    colorScheme: { border: '#3b82f6', borderWidth: 7, overlay: 'rgba(0,0,0,0.3)' },
    layout: { canvas: { width: 1080, height: 1080 } },
    zones: [
      { id: 'bg',      role: 'background', position: { x: 0,   y: 0,   w: 1080, h: 1080 }, effect: 'blur_dark' },
      { id: 'main',    role: 'main_face',  position: { x: 0,   y: 50,  w: 530,  h: 750  }, effect: 'soft_right' },
      { id: 'second',  role: 'secondary',  position: { x: 550, y: 50,  w: 530,  h: 750  }, effect: 'soft_left' },
      { id: 'context', role: 'context',    position: { x: 0,   y: 810, w: 1080, h: 270  }, effect: 'overlay_dark' },
    ],
  },

  // ─── D: ECONOMY ───────────────────────────────────────────────
  economy: {
    id: 'economy',
    name: 'เศรษฐกิจ / ธุรกิจ',
    emoji: '💰',
    keywords: ['เศรษฐกิจ', 'หุ้น', 'เงิน', 'ราคา', 'ธนาคาร', 'ลงทุน', 'GDP', 'ภาษี', 'ค่าเงิน'],
    colorScheme: { border: '#f59e0b', borderWidth: 7, overlay: 'rgba(0,0,0,0.2)' },
    layout: { canvas: { width: 1080, height: 1080 } },
    zones: [
      { id: 'bg',     role: 'background', position: { x: 0,   y: 0,   w: 1080, h: 1080 }, effect: 'blur_dark' },
      { id: 'main',   role: 'main_face',  position: { x: 50,  y: 100, w: 500,  h: 600  }, effect: 'soft_right' },
      { id: 'chart',  role: 'event',      position: { x: 570, y: 80,  w: 460,  h: 360  }, effect: 'border_gold' },
      { id: 'second', role: 'context',    position: { x: 570, y: 460, w: 460,  h: 360  }, effect: 'none' },
    ],
  },

  // ─── E: ENTERTAINMENT ─────────────────────────────────────────
  entertainment: {
    id: 'entertainment',
    name: 'บันเทิง / ไลฟ์สไตล์',
    emoji: '🎬',
    keywords: ['ดารา', 'นักร้อง', 'เพลง', 'หนัง', 'ซีรีส์', 'แต่งงาน', 'คู่รัก', 'ท่องเที่ยว'],
    colorScheme: { border: '#ec4899', borderWidth: 7, overlay: 'rgba(0,0,0,0.15)' },
    layout: { canvas: { width: 1080, height: 1080 } },
    zones: [
      { id: 'bg',     role: 'background', position: { x: 0,   y: 0,   w: 1080, h: 1080 }, effect: 'blur_light' },
      { id: 'main',   role: 'main_face',  position: { x: 140, y: 40,  w: 800,  h: 800  }, effect: 'soft_all' },
      { id: 'second', role: 'secondary',  position: { x: 0,   y: 400, w: 200,  h: 300  }, effect: 'circle_color' },
    ],
  },
};

// ─── getZones helper (ใช้ได้กับทั้ง structure เดิมและใหม่) ─────
export function getZones(tmpl) {
  return tmpl.zones ?? tmpl.layout?.zones ?? [];
}

// ─── Auto-detect template ──────────────────────────────────────
export function detectTemplate(newsType = '', newsTitle = '') {
  const text = (newsType + ' ' + newsTitle).toLowerCase();
  for (const [key, tmpl] of Object.entries(TEMPLATES)) {
    if (tmpl.keywords?.some(kw => text.includes(kw))) return key;
  }
  return 'accident';
}

export default TEMPLATES;
