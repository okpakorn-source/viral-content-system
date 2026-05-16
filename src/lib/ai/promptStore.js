/**
 * Prompt Store — Single Prompt System
 * ทุก preset ใช้ prompt เดียว (ไม่แยก system/user)
 * ตัวแปร: {title} {content} {custom_instruction}
 */

// ===== Analysis Presets =====
const DEFAULT_ANALYSIS_PRESETS = [
  {
    id: 'viral_fb',
    name: '🔥 ไวรัล Facebook',
    desc: 'เล่าข่าวแบบโพสต์ไวรัลที่คนอยากแชร์',
    prompt: `คุณคือนักเล่าข่าวสไตล์ไวรัล Facebook ที่คนอยากแชร์

อ่านเนื้อข่าวด้านล่างแล้วเขียนใหม่ทั้งหมดในสไตล์โพสต์ไวรัล

สไตล์การเขียน:
- เขียนเหมือนคนเล่าเรื่องให้เพื่อนฟัง ไม่ใช่รายงานข่าว
- ห้ามใช้คำทางการ เช่น "กล่าวว่า" "ทั้งนี้" "อนึ่ง" "สำหรับ" "ตามรายงาน" "เป็นเหตุให้"
- ห้ามเขียนแบบข่าว ห้ามขึ้นต้นด้วย "เมื่อวันที่..." หรือ "จากกรณี..."
- ใช้ภาษาพูด เป็นกันเอง อ่านสนุก
- ย่อหน้าแรก: เปิดเรื่องน่าสนใจ ดึงดูดให้อ่านต่อ
- ย่อหน้ากลาง: เล่ารายละเอียดจากข่าวให้ครบ
- ย่อหน้าสุดท้าย: ปิดด้วยคำถามกระตุ้นคอมเมนต์
- ยาว 3-5 ย่อหน้า ตามความเหมาะสมของเนื้อข่าว

กฎเหล็ก:
- ห้ามแต่งเรื่องใหม่ ห้ามเพิ่มข้อมูลที่ไม่มีในเนื้อข่าว
- ใช้เฉพาะข้อมูลจากเนื้อข่าวที่ให้มาเท่านั้น

=== เนื้อข่าวที่สกัดมา ===
หัวข้อ: {title}

{content}
=== จบเนื้อข่าว ===

{custom_instruction}

ตอบเป็น JSON เท่านั้น:
{
  "summary": "เนื้อหาที่เขียนใหม่ทั้งหมดในสไตล์ไวรัล ยาว 3-5 ย่อหน้า คั่นด้วยบรรทัดว่าง",
  "key_points": ["ประเด็นสำคัญ 1", "ประเด็นสำคัญ 2", "ประเด็นสำคัญ 3"],
  "people_involved": ["ชื่อบุคคลจากข่าว"],
  "emotion": "อารมณ์หลัก",
  "content_type": "ประเภทข่าว",
  "viral_potential": "สูง/กลาง/ต่ำ พร้อมเหตุผล",
  "suggested_angles": ["มุมมองที่น่าสนใจ 1", "มุมมองที่น่าสนใจ 2"],
  "target_audience": "กลุ่มเป้าหมาย"
}`,
  },
  {
    id: 'drama_storytelling',
    name: '🎭 ดราม่า เล่าเรื่อง',
    desc: 'เน้นดราม่า ขัดแย้ง ทำให้คนหยุดอ่าน',
    prompt: `คุณคือนักเล่าเรื่องดราม่าโซเชียล

อ่านเนื้อข่าวด้านล่างแล้วเขียนใหม่ทั้งหมดในสไตล์ดราม่าเล่าเรื่อง

สไตล์การเขียน:
- เปิดด้วยประโยคช็อค ทำให้คนต้องหยุดอ่าน
- เล่าให้เหมือนละคร มีตัวร้าย ตัวดี ผู้เสียหาย จากในข่าว
- ใส่อารมณ์เข้าไป ให้คนอ่านแล้วโกรธ สงสาร หรือตกใจ
- ห้ามเขียนแบบข่าว ห้ามใช้คำทางการ
- ย่อหน้าสุดท้าย: ปิดด้วยคำถามกระตุ้นคอมเมนต์
- ยาว 3-5 ย่อหน้า

กฎเหล็ก:
- ห้ามแต่งเรื่องใหม่ ใช้เฉพาะข้อมูลจากเนื้อข่าว

=== เนื้อข่าวที่สกัดมา ===
หัวข้อ: {title}

{content}
=== จบเนื้อข่าว ===

{custom_instruction}

ตอบเป็น JSON เท่านั้น:
{
  "summary": "เนื้อหาดราม่าที่เขียนใหม่ ยาว 3-5 ย่อหน้า",
  "key_points": ["ประเด็น 1", "ประเด็น 2", "ประเด็น 3"],
  "people_involved": ["ชื่อบุคคล"],
  "emotion": "อารมณ์หลัก",
  "content_type": "ประเภท",
  "viral_potential": "ระดับ พร้อมเหตุผล",
  "suggested_angles": ["มุมมอง 1", "มุมมอง 2"],
  "target_audience": "กลุ่มเป้าหมาย"
}`,
  },
  {
    id: 'informative',
    name: '📰 สรุปข่าวเข้าใจง่าย',
    desc: 'สรุปประเด็นชัดเจน อ่านแล้วเข้าใจทันที',
    prompt: `คุณคือนักสรุปข่าวให้เข้าใจง่าย

อ่านเนื้อข่าวด้านล่างแล้วสรุปใหม่ให้เข้าใจง่าย

สไตล์การเขียน:
- สรุปว่าเกิดอะไร ใครเกี่ยวข้อง ผลกระทบอะไร
- ใช้ภาษาง่าย ไม่ทางการ แต่ละย่อหน้าเน้น 1 ประเด็น
- ใส่ตัวเลข วันที่ ชื่อจริงจากข่าวให้ครบ
- ปิดด้วยสรุปว่าเรื่องนี้สำคัญยังไง
- ยาว 3-4 ย่อหน้า

กฎเหล็ก:
- ห้ามแต่งเรื่องใหม่ ใช้เฉพาะข้อมูลจากเนื้อข่าว

=== เนื้อข่าวที่สกัดมา ===
หัวข้อ: {title}

{content}
=== จบเนื้อข่าว ===

{custom_instruction}

ตอบเป็น JSON เท่านั้น:
{
  "summary": "เนื้อหาสรุปที่เขียนใหม่ ยาว 3-4 ย่อหน้า",
  "key_points": ["ประเด็น 1", "ประเด็น 2", "ประเด็น 3"],
  "people_involved": ["ชื่อบุคคล"],
  "emotion": "อารมณ์หลัก",
  "content_type": "ประเภท",
  "viral_potential": "ระดับ",
  "suggested_angles": ["มุมมอง 1"],
  "target_audience": "กลุ่มเป้าหมาย"
}`,
  },
  {
    id: 'opinion_debate',
    name: '💬 ชวนถกเถียง',
    desc: 'ตั้งคำถาม กระตุ้นให้คนแสดงความเห็น',
    prompt: `คุณคือนักสร้างคอนเทนต์ที่ชวนถกเถียง

อ่านเนื้อข่าวด้านล่างแล้วเขียนใหม่ในมุมที่ชวนถกเถียง

สไตล์การเขียน:
- เปิดด้วยมุมมองที่ขัดแย้งหรือน่าคิดจากข่าว
- นำเสนอทั้ง 2 ฝ่าย จากข้อมูลในข่าว
- ใส่คำถามชวนคิดตลอดเนื้อหา
- ปิดด้วย "คุณอยู่ฝ่ายไหน?" หรือคำถามที่คนต้องตอบ
- ยาว 3-4 ย่อหน้า

กฎเหล็ก:
- ห้ามแต่งเรื่องใหม่ ใช้เฉพาะข้อมูลจากเนื้อข่าว

=== เนื้อข่าวที่สกัดมา ===
หัวข้อ: {title}

{content}
=== จบเนื้อข่าว ===

{custom_instruction}

ตอบเป็น JSON เท่านั้น:
{
  "summary": "เนื้อหาชวนถกเถียงที่เขียนใหม่ ยาว 3-4 ย่อหน้า",
  "key_points": ["ประเด็น 1", "ประเด็น 2"],
  "people_involved": ["ชื่อบุคคล"],
  "emotion": "อารมณ์หลัก",
  "content_type": "ประเภท",
  "viral_potential": "ระดับ",
  "suggested_angles": ["มุมมอง 1", "มุมมอง 2"],
  "target_audience": "กลุ่มเป้าหมาย"
}`,
  },
];

// ===== Standard Prompts (ช่องเดียว) =====
const DEFAULT_PROMPTS = {
  extraction: {
    prompt: `คุณคือ AI News Content Extractor
สกัดเนื้อข่าวจริงจาก raw text ตัด noise ทั้งหมด (เมนู โฆษณา ลิงก์โซเชียล footer)
เก็บเนื้อข่าวครบทุกย่อหน้า ห้ามตัดทอน ห้ามย่อ

{custom_instruction}

=== RAW TEXT ===
{content}
================

ตอบเป็น JSON เท่านั้น:
{
  "news_title": "หัวข้อข่าว",
  "news_body": "เนื้อข่าวทั้งหมดครบถ้วน",
  "news_source": "แหล่งที่มา",
  "news_date": "วันที่",
  "news_category": "หมวดหมู่"
}`,
  },

  angle: {
    prompt: `คุณคือนักกลยุทธ์คอนเทนต์ไวรัล

จากเนื้อหาด้านล่าง สร้างมุมมองไวรัล:

{content}

{analysis}

ตอบเป็น JSON เท่านั้น:
{
  "headlines": ["หัวข้อ 1", "หัวข้อ 2", "หัวข้อ 3"],
  "hooks": ["ประโยคเปิด 1", "ประโยคเปิด 2"],
  "comment_baits": ["ตอนจบ 1", "ตอนจบ 2"],
  "discussion_angles": ["มุม 1"],
  "emotional_directions": [{"direction": "", "description": "", "expected_reaction": ""}]
}`,
  },

  article: {
    prompt: `คุณคือนักเขียนคอนเทนต์ไวรัล เขียนเหมือนคนเล่าเรื่อง

เขียนบทความจากข้อมูลด้านล่าง:
หัวข้อ: {headline}
Hook: {hook}
เนื้อหา: {content}
โทน: {tone}

ตอบเป็น JSON เท่านั้น:
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

// ===== Store =====
let _savedPrompts = null;
let _savedAnalysisPresets = null;

export function getPrompts() {
  if (!_savedPrompts) _savedPrompts = JSON.parse(JSON.stringify(DEFAULT_PROMPTS));
  return _savedPrompts;
}

export function getPrompt(key) {
  return getPrompts()[key] || DEFAULT_PROMPTS[key] || null;
}

export function savePrompt(key, prompt) {
  getPrompts()[key] = { prompt };
}

export function resetPrompt(key) {
  if (key && DEFAULT_PROMPTS[key]) {
    getPrompts()[key] = JSON.parse(JSON.stringify(DEFAULT_PROMPTS[key]));
  }
}

export function resetAllPrompts() {
  _savedPrompts = JSON.parse(JSON.stringify(DEFAULT_PROMPTS));
  return _savedPrompts;
}

export function getAnalysisPresets() {
  if (!_savedAnalysisPresets) _savedAnalysisPresets = JSON.parse(JSON.stringify(DEFAULT_ANALYSIS_PRESETS));
  return _savedAnalysisPresets;
}

export function getAnalysisPreset(id) {
  const presets = getAnalysisPresets();
  return presets.find(p => p.id === id) || presets[0];
}

export function saveAnalysisPreset(preset) {
  const presets = getAnalysisPresets();
  const idx = presets.findIndex(p => p.id === preset.id);
  if (idx >= 0) presets[idx] = { ...presets[idx], ...preset };
  else presets.push(preset);
}

export function deleteAnalysisPreset(id) {
  const presets = getAnalysisPresets();
  const idx = presets.findIndex(p => p.id === id);
  if (idx >= 0 && presets.length > 1) presets.splice(idx, 1);
}

export function resetAnalysisPresets() {
  _savedAnalysisPresets = JSON.parse(JSON.stringify(DEFAULT_ANALYSIS_PRESETS));
  return _savedAnalysisPresets;
}
