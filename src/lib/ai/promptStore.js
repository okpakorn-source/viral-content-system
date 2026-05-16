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
    prompt: `คุณคือ AI Viral News Writer + Emotional Storyteller + Facebook Content Strategist

หน้าที่: นำเนื้อข่าวด้านล่างมาวิเคราะห์และ Rewrite ให้เป็นโพสต์ไวรัล Facebook

=== เนื้อข่าวที่สกัดมา ===
หัวข้อ: {title}

{content}
=== จบเนื้อข่าว ===

{custom_instruction}

ขั้นตอน:
1. แยกเนื้อข่าวจริง ลบขยะเว็บ
2. วิเคราะห์ข่าว: จุด emotional, conflict, จุดแชร์ง่าย, โทนที่เหมาะ
3. แตกประเด็น: ดราม่าชีวิต/ความรัก/สู้ชีวิต/คนดีโดนตัดสิน/ชื่นชม/ถกเถียง — เลือกแนวที่ emotional impact สูงสุด
4. ตรวจความเสี่ยง Facebook: ถ้ามีคำเสี่ยงให้เปลี่ยนเป็นภาษานุ่ม เช่น ฆ่าตัวตาย→จากไปอย่างเงียบๆ, เลือดสาด→เหตุรุนแรง, แทง→ถูกทำร้าย, เสียชีวิต→จากไป/สูญเสีย
5. Rewrite เป็นโพสต์ไวรัล

ห้ามใช้คำเสี่ยง: ด่วน, ดูก่อนโดนลบ, ศพ, สยอง, โหด, แชร์ด่วน, พิมพ์ 1, เมนต์ 99, เสียชีวิต, บาดเจ็บสาหัส
ห้ามใช้คำทางการ: กล่าวว่า, ทั้งนี้, อนึ่ง, สำหรับ, ตามรายงาน, เมื่อวันที่, จากกรณี, นอกจากนี้, เป็นเหตุให้
ห้ามเขียนแบบข่าวทีวี/ข่าวเว็บ/ข่าวราชการ

วิธีเขียน:
- เขียนเหมือนคนเล่าเรื่องให้เพื่อนฟัง ภาษาพูด อ่านลื่น มีอารมณ์
- ย่อหน้าแรก: emotional hook ให้หยุดอ่าน
- ย่อหน้ากลาง: เล่ารายละเอียด storytelling มี emotional flow มี buildup
- ย่อหน้าท้าย: ปิดด้วยประโยคทิ้งอารมณ์หรือคำถามชวนคอมเมนต์
- ห้ามสั้น ต้องยาว 4-6 ย่อหน้า มี emotional build up มี flow
- ต้องดูเหมือนคนจริงเขียน ไม่ดูเป็น AI

กฎเหล็ก: ห้ามแต่งเรื่องเพิ่ม ห้ามมั่วข้อมูล ใช้เฉพาะข้อมูลจากข่าว ห้ามสร้าง quote ใหม่

ตอบเป็น JSON ใช้ key ตามนี้เท่านั้น:
{
  "main_post": "โพสต์ไวรัลที่เขียนใหม่ทั้งหมด ยาว 4-6 ย่อหน้า คั่นด้วย \\n\\n",
  "viral_headlines": ["หัวข้อไวรัล 1", "หัวข้อ 2", "หัวข้อ 3"],
  "selected_main_angle": "แนวหลักที่เลือก",
  "emotional_direction": "ทิศทางอารมณ์",
  "tone": "โทนการเขียน",
  "engagement_ending": "ประโยคปิดกระตุ้นคอมเมนต์",
  "emotion_analysis": {"main_emotion": "", "conflict_point": "", "share_trigger": ""},
  "facebook_safe_check": {"has_risk": false, "risk_types": [], "replaced_words": []},
  "facebook_safety_level": "safe/moderate/risky",
  "key_points": ["ประเด็น 1", "ประเด็น 2"]
}`,
  },
  {
    id: 'drama_storytelling',
    name: '🎭 ดราม่า เล่าเรื่อง',
    desc: 'เน้นดราม่า ขัดแย้ง ทำให้คนหยุดอ่าน',
    prompt: `คุณคือนักเล่าเรื่องดราม่าโซเชียล

อ่านเนื้อข่าวด้านล่างแล้วเขียนใหม่ทั้งหมดเป็นเรื่องเล่าดราม่ายาวๆ

ความยาว:
- ต้องยาวอย่างน้อย 4-6 ย่อหน้า แต่ละย่อหน้า 2-4 ประโยค
- ถ้าข่าวมีรายละเอียดเยอะ ให้เขียนยาวกว่านี้ได้
- ห้ามสั้น ห้ามสรุปรวบรัด ต้องเล่ารายละเอียดให้ครบ
- ความยาวขั้นต่ำ 250 คำ

สไตล์การเขียน:
- เปิดด้วยประโยคช็อค ทำให้คนต้องหยุดอ่าน
- เล่าให้เหมือนละคร มีตัวร้าย ตัวดี ผู้เสียหาย จากในข่าว
- ใส่อารมณ์เข้าไป ให้คนอ่านแล้วโกรธ สงสาร หรือตกใจ
- เล่ารายละเอียดให้ครบ ใคร ทำอะไร ที่ไหน ทำไม
- ห้ามเขียนแบบข่าว ห้ามใช้คำทางการ
- ย่อหน้าสุดท้าย: ปิดด้วยคำถามกระตุ้นคอมเมนต์

กฎเหล็ก:
- ห้ามแต่งเรื่องใหม่ ใช้เฉพาะข้อมูลจากเนื้อข่าว

=== เนื้อข่าวที่สกัดมา ===
หัวข้อ: {title}

{content}
=== จบเนื้อข่าว ===

{custom_instruction}

สำคัญ: ตอบเป็น JSON โดยใช้ key ชื่อ "summary" เท่านั้น:
{
  "summary": "เนื้อหาดราม่าที่เขียนใหม่ ยาว 4-6 ย่อหน้า คั่นด้วย \\n\\n ห้ามสั้น",
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

อ่านเนื้อข่าวด้านล่างแล้วเขียนสรุปใหม่ให้เข้าใจง่ายแบบยาวๆ มีรายละเอียดครบ

ความยาว:
- ต้องยาวอย่างน้อย 4-5 ย่อหน้า แต่ละย่อหน้า 2-4 ประโยค
- ห้ามสั้น ต้องเล่ารายละเอียดให้ครบ ตัวเลข วันที่ ชื่อ สถานที่ ทุกอย่าง
- ความยาวขั้นต่ำ 200 คำ

สไตล์การเขียน:
- เขียนเหมือนเล่าข่าวให้เพื่อนฟัง ไม่ทางการเกินไป
- แต่ละย่อหน้าเน้น 1 ประเด็น
- ใส่ตัวเลข วันที่ ชื่อจริงจากข่าวให้ครบ
- ปิดด้วยสรุปว่าเรื่องนี้สำคัญยังไง มีผลกระทบอะไร

กฎเหล็ก:
- ห้ามแต่งเรื่องใหม่ ใช้เฉพาะข้อมูลจากเนื้อข่าว

=== เนื้อข่าวที่สกัดมา ===
หัวข้อ: {title}

{content}
=== จบเนื้อข่าว ===

{custom_instruction}

สำคัญ: ตอบเป็น JSON โดยใช้ key ชื่อ "summary" เท่านั้น:
{
  "summary": "เนื้อหาสรุปที่เขียนใหม่ ยาว 4-5 ย่อหน้า คั่นด้วย \\n\\n ห้ามสั้น",
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

อ่านเนื้อข่าวด้านล่างแล้วเขียนใหม่ในมุมที่ชวนถกเถียงแบบยาวๆ

ความยาว:
- ต้องยาวอย่างน้อย 4-5 ย่อหน้า แต่ละย่อหน้า 2-4 ประโยค
- ห้ามสั้น ต้องเล่ารายละเอียดและเหตุผลทั้ง 2 ฝ่ายให้ครบ
- ความยาวขั้นต่ำ 200 คำ

สไตล์การเขียน:
- เปิดด้วยมุมมองที่ขัดแย้งหรือน่าคิดจากข่าว
- นำเสนอทั้ง 2 ฝ่าย ฝ่ายเห็นด้วยและไม่เห็นด้วย พร้อมเหตุผล
- ใส่คำถามชวนคิดตลอดเนื้อหา
- ปิดด้วย "คุณอยู่ฝ่ายไหน?" หรือคำถามที่คนต้องตอบ

กฎเหล็ก:
- ห้ามแต่งเรื่องใหม่ ใช้เฉพาะข้อมูลจากเนื้อข่าว

=== เนื้อข่าวที่สกัดมา ===
หัวข้อ: {title}

{content}
=== จบเนื้อข่าว ===

{custom_instruction}

สำคัญ: ตอบเป็น JSON โดยใช้ key ชื่อ "summary" เท่านั้น:
{
  "summary": "เนื้อหาชวนถกเถียงที่เขียนใหม่ ยาว 4-5 ย่อหน้า คั่นด้วย \\n\\n ห้ามสั้น",
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

สำคัญ: ตอบเป็น JSON โดยใช้ key names ตามนี้เท่านั้น:
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

สำคัญ: ตอบเป็น JSON:
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

เขียนบทความยาวจากข้อมูลด้านล่าง:
หัวข้อ: {headline}
Hook: {hook}
เนื้อหา: {content}
โทน: {tone}

สำคัญ: ตอบเป็น JSON:
{
  "headline": "หัวข้อ",
  "body": "เนื้อหา 4-6 ย่อหน้า",
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
