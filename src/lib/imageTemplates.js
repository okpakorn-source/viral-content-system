/**
 * News Image Template Definitions
 * แต่ละ template กำหนด zones, positions, effects, color scheme
 */

export const TEMPLATES = {

  // ─── A: ACCIDENT / DISASTER ───────────────────────────────
  accident: {
    id: 'accident',
    name: 'อุบัติเหตุ / ภัยพิบัติ',
    keywords: ['อุบัติเหตุ', 'ชน', 'ระเบิด', 'ไฟไหม้', 'น้ำท่วม', 'พังถล่ม', 'เสียชีวิต', 'บาดเจ็บ', 'เหยื่อ'],
    colorScheme: { border: '#22c55e', borderWidth: 7, overlay: 'rgba(0,0,0,0.25)' },
    layout: {
      canvas: { width: 1080, height: 1080 },
      zones: [
        { id: 'bg',        role: 'background',  position: { x: 0,   y: 0,   w: 1080, h: 1080 }, effect: 'blur_dark' },
        { id: 'main',      role: 'main_face',   position: { x: 0,   y: 0,   w: 590,  h: 680  }, effect: 'soft_right' },
        { id: 'context',   role: 'context',     position: { x: 595, y: 0,   w: 485,  h: 330  }, effect: 'none' },
        { id: 'event',     role: 'event',       position: { x: 595, y: 340, w: 485,  h: 330  }, effect: 'border_green' },
        { id: 'secondary', role: 'secondary',   position: { x: 340, y: 690, w: 420,  h: 390  }, effect: 'none' },
        { id: 'memorial',  role: 'memorial',    position: { x: 10,  y: 710, w: 310,  h: 310  }, effect: 'circle_bw' },
      ],
    },
  },

  // ─── B: CRIME ──────────────────────────────────────────────
  crime: {
    id: 'crime',
    name: 'อาชญากรรม',
    keywords: ['จับกุม', 'ยาเสพติด', 'ปล้น', 'ฆาตกรรม', 'ข่มขืน', 'ฉ้อโกง', 'โจร', 'ตำรวจ'],
    colorScheme: { border: '#ef4444', borderWidth: 7, overlay: 'rgba(0,0,0,0.35)' },
    layout: {
      canvas: { width: 1080, height: 1080 },
      zones: [
        { id: 'bg',       role: 'background', position: { x: 0,   y: 0,   w: 1080, h: 1080 }, effect: 'blur_dark' },
        { id: 'evidence', role: 'event',      position: { x: 0,   y: 0,   w: 1080, h: 480  }, effect: 'border_red' },
        { id: 'main',     role: 'main_face',  position: { x: 0,   y: 490, w: 560,  h: 590  }, effect: 'soft_top' },
        { id: 'context',  role: 'context',    position: { x: 570, y: 490, w: 510,  h: 590  }, effect: 'none' },
      ],
    },
  },

  // ─── C: POLITICS ──────────────────────────────────────────
  politics: {
    id: 'politics',
    name: 'การเมือง',
    keywords: ['รัฐบาล', 'นายก', 'รัฐมนตรี', 'สภา', 'พรรค', 'เลือกตั้ง', 'นโยบาย', 'รัฐประหาร'],
    colorScheme: { border: '#3b82f6', borderWidth: 7, overlay: 'rgba(0,0,0,0.3)' },
    layout: {
      canvas: { width: 1080, height: 1080 },
      zones: [
        { id: 'bg',      role: 'background', position: { x: 0,   y: 0,   w: 1080, h: 1080 }, effect: 'blur_dark' },
        { id: 'main',    role: 'main_face',  position: { x: 0,   y: 50,  w: 530,  h: 750  }, effect: 'soft_right' },
        { id: 'second',  role: 'secondary',  position: { x: 550, y: 50,  w: 530,  h: 750  }, effect: 'soft_left' },
        { id: 'context', role: 'context',    position: { x: 0,   y: 810, w: 1080, h: 270  }, effect: 'overlay_dark' },
      ],
    },
  },

  // ─── D: ECONOMY ───────────────────────────────────────────
  economy: {
    id: 'economy',
    name: 'เศรษฐกิจ / ธุรกิจ',
    keywords: ['เศรษฐกิจ', 'หุ้น', 'เงิน', 'ราคา', 'ธนาคาร', 'ลงทุน', 'GDP', 'ภาษี', 'ค่าเงิน'],
    colorScheme: { border: '#f59e0b', borderWidth: 7, overlay: 'rgba(0,0,0,0.2)' },
    layout: {
      canvas: { width: 1080, height: 1080 },
      zones: [
        { id: 'bg',     role: 'background', position: { x: 0,   y: 0,   w: 1080, h: 1080 }, effect: 'blur_dark' },
        { id: 'main',   role: 'main_face',  position: { x: 50,  y: 100, w: 500,  h: 600  }, effect: 'soft_right' },
        { id: 'chart',  role: 'event',      position: { x: 570, y: 80,  w: 460,  h: 360  }, effect: 'border_gold' },
        { id: 'second', role: 'context',    position: { x: 570, y: 460, w: 460,  h: 360  }, effect: 'none' },
      ],
    },
  },

  // ─── E: ENTERTAINMENT ─────────────────────────────────────
  entertainment: {
    id: 'entertainment',
    name: 'บันเทิง / ไลฟ์สไตล์',
    keywords: ['ดารา', 'นักร้อง', 'เพลง', 'หนัง', 'ซีรีส์', 'แต่งงาน', 'คู่รัก', 'ท่องเที่ยว'],
    colorScheme: { border: '#ec4899', borderWidth: 7, overlay: 'rgba(0,0,0,0.15)' },
    layout: {
      canvas: { width: 1080, height: 1080 },
      zones: [
        { id: 'bg',     role: 'background', position: { x: 0,   y: 0,   w: 1080, h: 1080 }, effect: 'blur_light' },
        { id: 'main',   role: 'main_face',  position: { x: 140, y: 40,  w: 800,  h: 800  }, effect: 'soft_all' },
        { id: 'second', role: 'secondary',  position: { x: 0,   y: 400, w: 200,  h: 300  }, effect: 'circle_color' },
      ],
    },
  },
};

// Auto-detect template from news type string
export function detectTemplate(newsType = '', newsTitle = '') {
  const text = (newsType + ' ' + newsTitle).toLowerCase();
  for (const [key, tmpl] of Object.entries(TEMPLATES)) {
    if (tmpl.keywords.some(kw => text.includes(kw))) return key;
  }
  return 'accident'; // default
}

export default TEMPLATES;
