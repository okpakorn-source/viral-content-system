import { NextResponse } from 'next/server';

// In-memory prompt storage (persists until server restart)
// Production: ใช้ database จริงแทน
const defaultPrompts = {
  extraction: {
    system: `คุณคือ AI สกัดเนื้อข่าว — ดึงเฉพาะเนื้อหาข่าวจริงออกมา ตัดส่วนที่ไม่เกี่ยวข้องออก เช่น เมนูเว็บ, โฆษณา, ลิงก์โซเชียล, ข้อความ copyright ตอบเป็น JSON เท่านั้น`,
    user: `จากข้อความที่ได้มาจากเว็บไซต์ด้านล่าง ให้สกัดเฉพาะ "เนื้อข่าว/เนื้อหาหลัก" ออกมา

ข้อความ:
"""
{content}
"""

{custom_instruction}

ตอบเป็น JSON:
{
  "news_title": "หัวข้อข่าวหลัก",
  "news_body": "เนื้อข่าวทั้งหมดที่สกัดได้ (เขียนต่อเนื่อง ครบถ้วน)",
  "news_source": "แหล่งที่มา/สำนักข่าว (ถ้ามี)",
  "news_date": "วันที่ข่าว (ถ้ามี)",
  "news_category": "หมวดหมู่ข่าว"
}`,
  },
  analysis: {
    system: `คุณคือ "ViralFlow AI Analyst" — ผู้เชี่ยวชาญวิเคราะห์ศักยภาพไวรัลของคอนเทนต์บนโซเชียลมีเดียไทย ตอบเป็น JSON เท่านั้น`,
    user: `วิเคราะห์ข่าวต่อไปนี้:

หัวข้อ: {title}
เนื้อข่าว:
"""
{content}
"""

{custom_instruction}

ตอบเป็น JSON:
{
  "summary": "สรุปข่าวใน 3-5 ประโยค",
  "key_points": ["ประเด็นสำคัญ 1", "ประเด็นสำคัญ 2", "ประเด็นสำคัญ 3"],
  "people_involved": ["ชื่อบุคคลที่เกี่ยวข้อง"],
  "emotion": "อารมณ์หลักของข่าว",
  "content_type": "ประเภทเนื้อหา",
  "viral_potential": "สูง/กลาง/ต่ำ — พร้อมเหตุผล",
  "suggested_angles": ["มุมมอง 1", "มุมมอง 2", "มุมมอง 3"],
  "target_audience": "กลุ่มเป้าหมาย"
}`,
  },
  angle: {
    system: `คุณคือ "ViralFlow Angle Creator" — นักกลยุทธ์คอนเทนต์ไวรัลระดับท็อป สร้างหัวข้อข่าว, hook, และมุมมองที่ทำให้คนหยุดเลื่อน ตอบเป็น JSON เท่านั้น`,
    user: `จากเนื้อหาและการวิเคราะห์ต่อไปนี้ ให้สร้างมุมมองไวรัล:

===== เนื้อหา =====
{content}

===== การวิเคราะห์ =====
{analysis}
===================

สร้างผลลัพธ์เป็น JSON:
{
  "headlines": ["หัวข้อ 1", "หัวข้อ 2", "หัวข้อ 3", "หัวข้อ 4", "หัวข้อ 5"],
  "hooks": ["ประโยคเปิด 1", "ประโยคเปิด 2", "ประโยคเปิด 3"],
  "comment_baits": ["ตอนจบกระตุ้นคอมเมนต์ 1", "ตอนจบ 2", "ตอนจบ 3"]
}`,
  },
  article: {
    system: `คุณคือ "ViralFlow Writer" — นักเขียนคอนเทนต์ไวรัลมือหนึ่งของไทย เขียนเหมือนคนเล่าเรื่อง ใช้ภาษาที่คนไทยพูดจริงๆ ตอบเป็น JSON เท่านั้น`,
    user: `เขียนบทความไวรัลจากข้อมูลต่อไปนี้:

===== หัวข้อ =====
{headline}
===== Hook =====
{hook}
===== เนื้อหาต้นฉบับ =====
{content}
===== โทน =====
{tone}
===== คำแนะนำเพิ่มเติม =====
{instructions}

ตอบเป็น JSON:
{
  "headline": "หัวข้อสุดท้าย",
  "body": "เนื้อหาบทความ",
  "hook": "ประโยคเปิด",
  "closing": "ประโยคปิด",
  "caption": "แคปชั่น Facebook",
  "hashtags": ["แฮชแท็ก1", "แฮชแท็ก2"]
}`,
  },
};

// Global mutable store
let savedPrompts = JSON.parse(JSON.stringify(defaultPrompts));

export async function GET() {
  return NextResponse.json({ success: true, data: savedPrompts });
}

export async function POST(request) {
  try {
    const { key, system, user } = await request.json();
    if (!key || !savedPrompts[key]) {
      return NextResponse.json({ success: false, error: 'Invalid prompt key' }, { status: 400 });
    }
    savedPrompts[key] = { system, user };
    return NextResponse.json({ success: true, data: savedPrompts[key] });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { key } = await request.json();
    if (key && defaultPrompts[key]) {
      savedPrompts[key] = JSON.parse(JSON.stringify(defaultPrompts[key]));
    } else {
      savedPrompts = JSON.parse(JSON.stringify(defaultPrompts));
    }
    return NextResponse.json({ success: true, data: savedPrompts });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
