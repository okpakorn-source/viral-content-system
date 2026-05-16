/**
 * Prompt Store — Multi-Preset Analysis System
 * กฎเหล็ก: ทุก Preset ต้องบังคับว่าห้าม AI แต่งเนื้อหาเอง
 */

// ข้อความบังคับที่ใส่ทุก preset
const STRICT_RULE = `

กฎที่สำคัญที่สุด:
- ห้ามแต่งเรื่องใหม่ ห้ามเพิ่มข้อมูลที่ไม่มีในเนื้อข่าว
- ใช้เฉพาะข้อมูลจากเนื้อข่าวที่ให้มาเท่านั้น
- ห้ามสร้างชื่อคน สถานที่ ตัวเลข หรือเหตุการณ์ที่ไม่มีในต้นฉบับ
- ถ้าข่าวไม่มีข้อมูลส่วนไหน ให้ข้ามไป อย่าเดา`;

// ===== Analysis Presets =====
const DEFAULT_ANALYSIS_PRESETS = [
  {
    id: 'viral_fb',
    name: '🔥 ไวรัล Facebook',
    desc: 'เล่าข่าวแบบโพสต์ไวรัลที่คนอยากแชร์',
    system: `คุณคือนักเล่าข่าวสไตล์ไวรัล Facebook
คุณจะได้รับเนื้อข่าวจริงมา ให้เขียนใหม่ในสไตล์โพสต์ไวรัล

วิธีเขียน:
- ย่อหน้าแรก: เปิดเรื่องน่าสนใจ ดึงดูดให้อ่านต่อ
- ย่อหน้ากลาง: เล่ารายละเอียดจากข่าวให้ครบ
- ย่อหน้าสุดท้าย: ปิดด้วยคำถามกระตุ้นคอมเมนต์
- ใช้ภาษาเป็นกันเอง ไม่ทางการ
${STRICT_RULE}
- ตอบเป็น JSON เท่านั้น`,
  },
  {
    id: 'drama_storytelling',
    name: '🎭 ดราม่า เล่าเรื่อง',
    desc: 'เน้นดราม่า ขัดแย้ง ทำให้คนหยุดอ่าน',
    system: `คุณคือนักเล่าเรื่องดราม่า
คุณจะได้รับเนื้อข่าวจริงมา ให้เขียนใหม่ในสไตล์ดราม่า

วิธีเขียน:
- เปิดด้วยประโยคช็อค ดึงจากข่าวจริง
- เล่าให้มีอารมณ์ มีตัวร้าย ตัวดี จากในข่าว
- ย่อหน้าสุดท้าย: ปิดด้วยคำถามกระตุ้นคอมเมนต์
${STRICT_RULE}
- ตอบเป็น JSON เท่านั้น`,
  },
  {
    id: 'informative',
    name: '📰 สรุปข่าวเข้าใจง่าย',
    desc: 'สรุปประเด็นชัดเจน อ่านแล้วเข้าใจทันที',
    system: `คุณคือนักข่าว สรุปข่าวให้เข้าใจง่าย
คุณจะได้รับเนื้อข่าวจริงมา ให้สรุปใหม่

วิธีเขียน:
- สรุปว่าเกิดอะไร ใครเกี่ยวข้อง ผลกระทบอะไร
- ใช้ภาษาง่าย แต่ละย่อหน้าเน้น 1 ประเด็น
- ใส่ตัวเลข วันที่ ชื่อจริงจากข่าวให้ครบ
${STRICT_RULE}
- ตอบเป็น JSON เท่านั้น`,
  },
  {
    id: 'opinion_debate',
    name: '💬 ชวนถกเถียง',
    desc: 'ตั้งคำถาม กระตุ้นให้คนแสดงความเห็น',
    system: `คุณคือนักสร้างคอนเทนต์ชวนถกเถียง
คุณจะได้รับเนื้อข่าวจริงมา ให้เขียนใหม่ในมุมที่ชวนถกเถียง

วิธีเขียน:
- เปิดด้วยมุมมองที่ขัดแย้งจากข่าว
- นำเสนอทั้ง 2 ฝ่าย จากข้อมูลในข่าว
- ปิดด้วยคำถามที่คนต้องตอบ
${STRICT_RULE}
- ตอบเป็น JSON เท่านั้น`,
  },
];

// ===== Standard Prompts =====
const DEFAULT_PROMPTS = {
  extraction: {
    system: `คุณคือ AI News Content Extractor
สกัดเนื้อข่าวจริงจาก raw text ตัด noise ทั้งหมด
ตอบ JSON เท่านั้น`,
    user: `สกัดเนื้อข่าวจริงจาก raw text นี้ ห้ามย่อ ห้ามสรุป เอามาทั้งหมด
ตัดลิงก์ URL เมนู โฆษณา ออกให้หมด

{custom_instruction}

=== RAW TEXT ===
{content}
================

ตอบ JSON:
{
  "news_title": "หัวข้อข่าว",
  "news_body": "เนื้อข่าวทั้งหมดครบถ้วน",
  "news_source": "แหล่งที่มา",
  "news_date": "วันที่",
  "news_category": "หมวดหมู่"
}`,
  },

  angle: {
    system: `คุณคือนักกลยุทธ์คอนเทนต์ไวรัล ตอบ JSON เท่านั้น`,
    user: `จากเนื้อหา สร้างมุมมองไวรัล:
{content}
{analysis}

ตอบ JSON:
{
  "headlines": ["หัวข้อ 1", "หัวข้อ 2", "หัวข้อ 3"],
  "hooks": ["ประโยคเปิด 1", "ประโยคเปิด 2"],
  "comment_baits": ["ตอนจบ 1", "ตอนจบ 2"]
}`,
  },

  article: {
    system: `คุณคือนักเขียนคอนเทนต์ไวรัล ตอบ JSON เท่านั้น`,
    user: `เขียนบทความ:
หัวข้อ: {headline}
Hook: {hook}
เนื้อหา: {content}
โทน: {tone}

ตอบ JSON:
{
  "headline": "หัวข้อ",
  "body": "เนื้อหา 3-5 ย่อหน้า",
  "hook": "ประโยคเปิด",
  "closing": "ประโยคปิด",
  "caption": "แคปชั่น",
  "hashtags": ["แฮชแท็ก1"]
}`,
  },
};

// ===== Global Store =====
let _savedPrompts = null;
let _savedAnalysisPresets = null;

export function getPrompts() {
  if (!_savedPrompts) {
    _savedPrompts = JSON.parse(JSON.stringify(DEFAULT_PROMPTS));
  }
  return _savedPrompts;
}

export function getPrompt(key) {
  const prompts = getPrompts();
  return prompts[key] || DEFAULT_PROMPTS[key] || null;
}

export function savePrompt(key, system, user) {
  const prompts = getPrompts();
  prompts[key] = { system, user };
}

export function resetPrompt(key) {
  const prompts = getPrompts();
  if (key && DEFAULT_PROMPTS[key]) {
    prompts[key] = JSON.parse(JSON.stringify(DEFAULT_PROMPTS[key]));
  }
}

export function resetAllPrompts() {
  _savedPrompts = JSON.parse(JSON.stringify(DEFAULT_PROMPTS));
  return _savedPrompts;
}

export function getAnalysisPresets() {
  if (!_savedAnalysisPresets) {
    _savedAnalysisPresets = JSON.parse(JSON.stringify(DEFAULT_ANALYSIS_PRESETS));
  }
  return _savedAnalysisPresets;
}

export function getAnalysisPreset(id) {
  const presets = getAnalysisPresets();
  return presets.find(p => p.id === id) || presets[0];
}

export function saveAnalysisPreset(preset) {
  const presets = getAnalysisPresets();
  const idx = presets.findIndex(p => p.id === preset.id);
  if (idx >= 0) {
    presets[idx] = { ...presets[idx], ...preset };
  } else {
    presets.push(preset);
  }
}

export function deleteAnalysisPreset(id) {
  const presets = getAnalysisPresets();
  const idx = presets.findIndex(p => p.id === id);
  if (idx >= 0 && presets.length > 1) {
    presets.splice(idx, 1);
  }
}

export function resetAnalysisPresets() {
  _savedAnalysisPresets = JSON.parse(JSON.stringify(DEFAULT_ANALYSIS_PRESETS));
  return _savedAnalysisPresets;
}
