// ขั้น 2 ของชุดทดลอง: วิเคราะห์หมวด/อารมณ์ของข่าว เพื่อใช้จับคู่ครู
// ใช้คำถามและโมเดลเดียวกับท่อจริง (ตัววิเคราะห์ใน getTopPrompts — src/lib/services/summarizeServiceText.js) เพื่อให้ผลทดลองตรงกับของจริง
// รัน: node scripts/teacher-trial/analyze.mjs        ผล: scratch/teacher-trial/analyses.json
// ค่าใช้จ่าย: โมเดลเล็ก 1 ครั้งต่อข่าว · ข่าวที่วิเคราะห์แล้วไม่ยิงซ้ำ
import OpenAI from 'openai';
import fs from 'node:fs';
import { outPath, readJson, writeJson, loadEnvKeys, mapLimit } from './common.mjs';

loadEnvKeys(['OPENAI_API_KEY']);
const MODEL = process.env.TEACHER_TRIAL_ANALYZER_MODEL || 'gpt-5.4-mini';
const client = new OpenAI();

// ข้อความเดียวกับตัววิเคราะห์ของท่อจริง (ไม่มีมุมเล่า — ระบบใหม่ไม่แตกมุม)
const analyzerPrompt = (title, body) => `คุณเป็นนักวิเคราะห์ข่าวและผู้เชี่ยวชาญการทำไวรัลคอนเทนต์
จงวิเคราะห์ข่าวต่อไปนี้ในหลากหลายมิติ (Multi-Dimensional News Analysis) เพื่อใช้สำหรับการจับคู่กับสไตล์การเล่าเรื่องที่ดีที่สุด

=== ข่าวที่ต้องวิเคราะห์ ===
หัวข้อ: ${title || 'ไม่มีหัวข้อ'}
เนื้อหาย่อ: ${String(body || '').slice(0, 1500)}
=== จบข่าว ===

โปรดแตกมิติของข่าวตามหมวดหมู่ดังต่อไปนี้ (ต้องเลือกจากตัวเลือกที่กำหนดเท่านั้น):

1. primaryCategory: เลือก 1 จาก: ช่วยเหลือกัน, สู้ชีวิต, ดราม่าครอบครัว, ดราม่าสังคม, ข่าวเตือนใจ, ข่าวอาชญากรรม, ความรัก, อบอุ่นใจ, ฮีโร่ชาวบ้าน, ชีวิตพลิกผัน
2. secondaryCategories: เลือก 1-3 จากรายการเดียวกับ primaryCategory (ห้ามซ้ำกับ primaryCategory)
3. emotionalTags: เลือก 2-4 จาก: เห็นใจ, สงสาร, โกรธ, เดือด, ซึ้ง, ตื้นตัน, กลัว, ช็อก, ภูมิใจ, ชื่นชม, คาใจ, สงสัย, เศร้า, หดหู่, สนุก, ขำ, แค้น, อบอุ่น, สะเทือนใจ, หวาดกลัว — เพจเล่ามุมบวกเสมอ ใส่อารมณ์ของมุมบวกที่จะเล่าอย่างน้อย 1 คำ (ข่าวเศร้า→ซึ้ง/ตื้นตัน, ข่าวโกรธ→เห็นใจ/ชื่นชมคนทำถูก)
4. conflictTags: เลือก 1-3 จาก: ความอยุติธรรม, การตัดสิน, การสูญเสีย, การต่อสู้, การเอาเปรียบ, ความผิดพลาด, การทรยศ, ความขัดแย้ง, การกดขี่, ความเหลื่อมล้ำ
5. narrativeArchetype: เลือก 1 จาก: สู้ชีวิต, ฮีโร่ชาวบ้าน, เปิดโปง, น้ำใจคนไทย, ชีวิตพลิกผัน, ดราม่าครอบครัว, ข่าวเตือนภัย, ความรักข้ามขีดจำกัด, ผู้ถูกกระทำ, คนดีที่โลกลืม
6. viralHooks: จุดกระตุ้นให้คนแชร์หรือพูดถึงในโลกโซเชียล (ระบุเป็นอาร์เรย์ 1-3 ข้อ)
7. humanAngles: ประเด็นเชิงลึกของชีวิตมนุษย์ในข่าว (ระบุเป็นอาร์เรย์ 1-3 ข้อ)

ตอบเป็น JSON เท่านั้นในรูปแบบนี้:
{
  "primaryCategory": "...",
  "secondaryCategories": ["..."],
  "emotionalTags": ["...", "..."],
  "conflictTags": ["..."],
  "narrativeArchetype": "...",
  "viralHooks": ["..."],
  "humanAngles": ["..."]
}`;

const cases = readJson(outPath('cases.json'));
const outFile = outPath('analyses.json');
const done = fs.existsSync(outFile) ? readJson(outFile) : {};

await mapLimit(cases.filter((c) => !done[c.caseId]), 4, async (c) => {
  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: analyzerPrompt(c.newsTitle, c.rawText) }],
      max_completion_tokens: 800,
      response_format: { type: 'json_object' },
    });
    done[c.caseId] = JSON.parse(res.choices[0]?.message?.content || '{}');
    console.log(`#${c.caseId} → ${done[c.caseId].primaryCategory} | ${(done[c.caseId].emotionalTags || []).join(',')}`);
  } catch (e) {
    console.error(`#${c.caseId} วิเคราะห์ไม่สำเร็จ: ${e?.status || ''} ${String(e?.message || e).slice(0, 120)}`);
  }
});

writeJson(outFile, done);
console.log(`วิเคราะห์แล้ว ${Object.keys(done).length}/${cases.length} เคส → scratch/teacher-trial/analyses.json`);
