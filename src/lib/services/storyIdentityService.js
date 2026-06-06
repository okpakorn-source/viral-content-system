import { GoogleGenerativeAI } from '@google/generative-ai';

export async function analyzeStoryIdentity(newsTitle, breakdownData) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2
      }
    });

    const prompt = `คุณคือ News Analyst มืออาชีพ วิเคราะห์ข่าวนี้อย่างละเอียดแล้วสกัดข้อมูลสำหรับทีมค้นหาภาพ

ชื่อข่าว: "${newsTitle}"
เนื้อข่าว: "${breakdownData?.core_story || ''}"
คนที่เกี่ยวข้อง: ${JSON.stringify(breakdownData?.key_facts?.people || [])}

สร้าง search queries ที่หลากหลายมุมมอง เพื่อค้นหาภาพที่ตรงกับข่าวมากที่สุด
ต้องจับใจความข่าว จับซีนอารมณ์ จับสถานที่ จับคีย์เวิร์ดสำคัญ

⚠️ กลยุทธ์สำคัญ — ต้องหาภาพให้ได้อย่างน้อย 5-8 ภาพ:
- ภาพหน้าชัดของบุคคลหลัก ไม่จำเป็นต้องมาจากข่าวนี้! ค้นจากแหล่งใดก็ได้:
  - คลิปสัมภาษณ์อื่น, ละคร, ซีรีส์, รายการทีวี, MV, ช่อง YouTube ส่วนตัว
  - ภาพถ่ายงานอีเวนท์, งานแถลงข่าว, red carpet, backstage
  - ภาพจาก Instagram, ไลฟ์สด, vlog
- ★ ถ้าข่าวตีไปทางเศร้า → ค้นชื่อคน + "ร้องไห้" หรือ "เศร้า" จากคลิปอื่นที่ไม่ใช่ข่าวนี้ได้
- ★ ถ้าข่าวตีไปทางมีความสุข → ค้นชื่อคน + "ยิ้ม" หรือ "หัวเราะ" จากคลิปอื่นได้
- ★ ค้นชื่อคนตรงๆ ด้วย (ไม่ต้องใส่คำเพิ่ม) เพื่อหาภาพ portrait คมชัด
- ภาพสถานที่/เหตุการณ์ → ต้องตรงกับข่าวนี้โดยตรง

ตอบเป็น JSON object ตามโครงสร้างนี้เท่านั้น:
{
  "characters": ["ชื่อคนที่เกี่ยวข้องทั้งหมด"],
  "mainCharacter": "ชื่อตัวละครหลัก 1 คน ที่ต้องอยู่บนปก",
  "secondaryCharacter": "ชื่อตัวละครรอง (ถ้ามี) เช่น คนที่ให้สัมภาษณ์ หรือคู่กรณี",
  "story": "สรุปเนื้อข่าว 1 ประโยค",
  "emotion": "happy | sad | angry | shocked | neutral | dramatic",
  "coverEmotion": "drama | tragedy | shocking | hope | warm | neutral",
  "location": "ชื่อสถานที่เกิดเหตุ (ถ้ามี)",
  "timeframe": "วันเวลาเกิดเหตุ (ถ้ามี เช่น '2024' หรือ 'เมษายน 2567')",
  "keywords": ["คำสำคัญ", "สำหรับ tag ภาพในคลัง", "ควรมี 5-10 คำ"],
  "keyScenes": ["ซีนอารมณ์ที่อยากได้ เช่น 'ร้องไห้ในศาล', 'ยิ้มหัวเราะ', 'กอดลูก'"],
  
  "searchQueries": {
    "person_closeup": "ชื่อบุคคลหลัก + คำที่ได้ภาพหน้าชัด เช่น 'เจนสุดา ปานโต ภาพถ่าย' (ภาษาไทย)",
    "person_portrait": "ชื่อบุคคลหลัก ตรงๆ ไม่มีคำเพิ่ม เช่น 'เจนสุดา ปานโต' เพื่อหาภาพจากแหล่งไหนก็ได้",
    "person_interview": "ชื่อบุคคลหลัก สัมภาษณ์ — เพื่อหาภาพจากคลิปสัมภาษณ์อื่นที่ไม่ใช่ข่าวนี้",
    "person_drama": "ชื่อบุคคลหลัก + ผลงาน/ละคร/ซีรีส์ เพื่อหาภาพจากผลงาน เช่น 'เจนสุดา ละคร' (ภาษาไทย)",
    "person_emotion": "ชื่อบุคคลหลัก + อารมณ์ตามข่าว เช่น 'เจนสุดา ร้องไห้' หรือ 'เจนสุดา ยิ้ม' (ภาษาไทย)",
    "secondary_person": "ชื่อตัวละครรอง (ถ้ามี) ค้นชื่อตรงๆ เพื่อหาหน้าชัดจากแหล่งอื่น",
    "person_context": "คำค้นหาภาพบุคคลในบริบทเหตุการณ์ของข่าวนี้ (ภาษาไทย)",
    "event_scene": "คำค้นหาภาพเหตุการณ์ สถานที่ บรรยากาศ ของข่าวนี้ (ภาษาไทย)",
    "emotion_moment": "คำค้นหาภาพแสดงอารมณ์ของบุคคล ตามโทนข่าว (ภาษาไทย)",
    "location_photo": "คำค้นหาภาพสถานที่เกิดเหตุ (ภาษาไทย)",
    "related_people": "คำค้นหาภาพคนอื่นที่เกี่ยวข้อง (ภาษาไทย)"
  },

  "searchGoogle": "คำค้น Google Image หลัก (ภาษาไทย)",
  "searchYouTube": "คำค้น YouTube สำหรับหาคลิปที่เกี่ยวข้อง — ค้นชื่อคนหลัก + เหตุการณ์",
  "searchTikTok": "คำค้น TikTok สำหรับหาคลิปสั้น (ภาษาไทย)",
  "searchPexels": "คำค้นภาพ stock ที่อาจเกี่ยวข้อง (ภาษาอังกฤษ เช่น 'courtroom', 'crying woman')",

  "typography": {
    "hook": "1-3 คำ เช่น 'ช็อก!', 'ด่วน!', 'เศร้า'",
    "main": "4-8 คำ สรุปประเด็นหลัก",
    "punch": "2-4 คำ กระแทกอารมณ์"
  }
}`;

    // ★ Retry: ถ้า 503 → รอ 2 วิ แล้วลองใหม่
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        return JSON.parse(text);
      } catch (err) {
        lastError = err;
        console.log(`[StoryIdentity] Attempt ${attempt + 1} failed: ${err.message?.substring(0, 80)}`);
        if (attempt === 0 && err.message?.includes('503')) {
          console.log('[StoryIdentity] 503 → Retrying in 2s...');
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
    console.error('[StoryIdentity] All attempts failed:', lastError?.message?.substring(0, 100));
    return null;
  } catch (outerErr) {
    console.error('[StoryIdentity] Unexpected error:', outerErr.message);
    return null;
  }
}
