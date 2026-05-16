/**
 * Prompt Store — แชร์ระหว่าง API routes
 * ใช้ร่วมกันระหว่าง /api/prompts (CRUD) และ /api/summarize (ใช้งานจริง)
 */

const DEFAULT_PROMPTS = {
  extraction: {
    system: `คุณคือ AI News Content Extractor
หน้าที่: รับ raw text จากเว็บไซต์ แล้วแยกเฉพาะ "เนื้อข่าว/เนื้อหาหลัก" ออกมา

ต้องตัดออก:
- เมนูเว็บไซต์, navigation, breadcrumb
- ลิงก์โซเชียลมีเดีย (Facebook, TikTok, YouTube, X/Twitter URLs ทั้งหมด)
- โฆษณา, banner, popup
- ข้อความ copyright, footer
- ข้อความชวนติดตาม/subscribe
- ลิงก์ข่าวอื่นที่ไม่เกี่ยวข้อง
- ข้อความ "ติดต่อเรา", "ช่อง", ลิงก์ช่องทางต่างๆ

ต้องเก็บไว้:
- เนื้อข่าวทั้งหมด ครบทุกย่อหน้า ห้ามตัดทอน ห้ามย่อ
- คำพูด/คำให้สัมภาษณ์ของบุคคลในข่าว
- ข้อมูลตัวเลข สถิติ วันเวลา สถานที่
- ชื่อบุคคล องค์กร หน่วยงาน

ตอบเป็น JSON เท่านั้น ห้ามเพิ่มคำอธิบายนอก JSON`,

    user: `สกัดเนื้อข่าวจริงจาก raw text ด้านล่าง
ห้ามย่อ ห้ามสรุป — เอาเนื้อข่าวมาทั้งหมดตามต้นฉบับ
ตัดลิงก์โซเชียล URL เมนูเว็บ โฆษณา ออกให้หมด

{custom_instruction}

=== RAW TEXT ===
{content}
================

ตอบเป็น JSON เท่านั้น:
{
  "news_title": "หัวข้อข่าวหลัก",
  "news_body": "เนื้อข่าวทั้งหมดครบถ้วน ไม่ตัดทอน (3-5 ย่อหน้าขึ้นไป)",
  "news_source": "แหล่งที่มา",
  "news_date": "วันที่ข่าว",
  "news_category": "หมวดหมู่"
}`,
  },

  analysis: {
    system: `คุณคือ "ViralFlow AI Analyst" ผู้เชี่ยวชาญวิเคราะห์ข่าวและศักยภาพไวรัลของคอนเทนต์
คุณต้องวิเคราะห์อย่างละเอียด ให้ข้อมูลเชิงลึก ไม่ใช่แค่สรุปสั้นๆ
สรุปข่าวต้องยาว 3-4 ย่อหน้า ครอบคลุมทุกประเด็นสำคัญ
ตอบเป็น JSON เท่านั้น`,

    user: `วิเคราะห์ข่าวต่อไปนี้อย่างละเอียด:

หัวข้อ: {title}

เนื้อข่าว:
"""
{content}
"""

{custom_instruction}

วิเคราะห์แล้วตอบเป็น JSON:
{
  "summary": "สรุปข่าวอย่างละเอียด 3-4 ย่อหน้า ครอบคลุมทุกประเด็น ใคร ทำอะไร ที่ไหน เมื่อไร ทำไม ผลกระทบอะไร",
  "key_points": ["ประเด็นสำคัญ 1 (อธิบายสั้นๆ)", "ประเด็นสำคัญ 2", "ประเด็นสำคัญ 3", "ประเด็นสำคัญ 4", "ประเด็นสำคัญ 5"],
  "people_involved": ["ชื่อบุคคล 1", "ชื่อบุคคล 2"],
  "emotion": "อารมณ์หลักของข่าว",
  "content_type": "ประเภทเนื้อหา",
  "viral_potential": "สูง/กลาง/ต่ำ — อธิบายเหตุผล 2-3 ประโยค",
  "suggested_angles": ["มุมมองที่ 1 (อธิบายว่าทำไมน่าสนใจ)", "มุมมอง 2", "มุมมอง 3"],
  "target_audience": "กลุ่มเป้าหมาย + เหตุผล"
}`,
  },

  angle: {
    system: `คุณคือ "ViralFlow Angle Creator" — นักกลยุทธ์คอนเทนต์ไวรัลระดับท็อป
สร้างหัวข้อ hook และมุมมองที่ทำให้คนหยุดเลื่อน ตอบเป็น JSON เท่านั้น`,
    user: `จากเนื้อหาและการวิเคราะห์ สร้างมุมมองไวรัล:
===== เนื้อหา =====
{content}
===== การวิเคราะห์ =====
{analysis}

ตอบเป็น JSON:
{
  "headlines": ["หัวข้อ 1", "หัวข้อ 2", "หัวข้อ 3", "หัวข้อ 4", "หัวข้อ 5"],
  "hooks": ["ประโยคเปิด 1", "ประโยคเปิด 2", "ประโยคเปิด 3"],
  "comment_baits": ["ตอนจบ 1", "ตอนจบ 2", "ตอนจบ 3"]
}`,
  },

  article: {
    system: `คุณคือ "ViralFlow Writer" — นักเขียนคอนเทนต์ไวรัลมือหนึ่ง เขียนเหมือนคนเล่าเรื่อง ตอบเป็น JSON เท่านั้น`,
    user: `เขียนบทความไวรัล:
หัวข้อ: {headline}
Hook: {hook}
เนื้อหา: {content}
โทน: {tone}
คำแนะนำ: {instructions}

ตอบเป็น JSON:
{
  "headline": "หัวข้อสุดท้าย",
  "body": "เนื้อหาบทความ 3-5 ย่อหน้า",
  "hook": "ประโยคเปิด",
  "closing": "ประโยคปิด",
  "caption": "แคปชั่น Facebook",
  "hashtags": ["แฮชแท็ก1", "แฮชแท็ก2"]
}`,
  },
};

// Global mutable store
let _savedPrompts = null;

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
