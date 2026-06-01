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

    const prompt = `คุณคือ News Analyst มืออาชีพ วิเคราะห์ข่าวนี้แล้วสกัดข้อมูลสำหรับทีมค้นหาภาพ

ชื่อข่าว: "${newsTitle}"
เนื้อข่าว: "${breakdownData?.core_story || ''}"
คนที่เกี่ยวข้อง: ${JSON.stringify(breakdownData?.key_facts?.people || [])}

ตอบเป็น JSON object ตามโครงสร้างนี้เท่านั้น:
{
  "characters": ["ชื่อคนที่เกี่ยวข้องทั้งหมด"],
  "mainCharacter": "ชื่อตัวละครหลัก 1 คน ที่ต้องอยู่บนปก",
  "story": "สรุปเนื้อข่าว 1 ประโยค",
  "emotion": "happy | sad | angry | shocked | neutral | dramatic",
  "keyScenes": ["คำอธิบายซีนอารมณ์ที่ต้องการเช่น 'ยิ้มหัวเราะ', 'ร้องไห้', 'ตกใจ'"],
  "searchGoogle": "คำค้น Google Image สำหรับหารูปสะอาด (ภาษาไทย)",
  "searchYouTube": "คำค้น YouTube สำหรับหาคลิปที่เกี่ยวข้อง (ภาษาไทย)",
  "searchTikTok": "คำค้น TikTok สำหรับหาคลิปสั้น (ภาษาไทย)",
  "coverEmotion": "drama | tragedy | shocking | hope | warm | neutral",
  "typography": {
    "hook": "1-3 คำ เช่น 'ช็อก!', 'ด่วน!', 'เศร้า'",
    "main": "4-8 คำ สรุปประเด็นหลัก",
    "punch": "2-4 คำ กระแทกอารมณ์"
  }
}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return JSON.parse(text);
  } catch (error) {
    console.error('[StoryIdentity] Error:', error.message);
    return null;
  }
}
