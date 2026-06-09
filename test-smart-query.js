require('dotenv').config({ path: '.env.local' });

const newsTitle = "ชมพู่ อารยา รู้เรื่องที่ดิน 1 ไร่ของ ยายหนิง ก็ตอนที่ซื้อ";
const newsContent = `ชมพู่ อารยา รู้เรื่องที่ดิน 1 ไร่ของ ยายหนิง ก็ตอนที่ซื้อไปแล้วเรียบร้อย ไม่มีการปรึกษา ไม่มีการบอกล่วงหน้า แน่นอนว่าชมพู่งอนไปพักหนึ่ง แต่พอได้เห็นว่าแม่ตั้งใจซื้อที่ดินแปลงนั้นเพื่อหลาน จากงอนก็กลับเป็นซึ้งทันที ยายหนิงไม่ได้ซื้อมาปล่อยรกร้าง แต่ยายเริ่มขุดบ่อเลี้ยงปลา ปลูกผักออร์แกนิก เลี้ยงไก่ และค่อยๆ เติมชีวิตลงไปในทุกมุมของพื้นที่ผืนนั้น ทั้งหมดนี้ทำไว้เพื่อให้หลานๆ ได้มาวิ่งเล่น เหยียบดิน เก็บไข่ เก็บผัก และซึมซับวิถีชีวิตที่ใกล้ธรรมชาติจริงๆ โดยไม่ต้องขับรถไปไหนไกล ทั้งหมดนี้ยายหนิงดูแลสวนเองทุกขั้นตอน ตั้งแต่ปลูก ทั้งรดน้ำ เพราะอยากให้หลานๆ ได้เรียนรู้วิถีชีวิตเรียบง่ายท่ามกลางธรรมชาติที่หาได้ยากในเมืองใหญ่ ไม่ใช่แค่ผ่านหน้าจอ`;

const hero = "ชมพู่ อารยา เอ ฮาร์เก็ต";
const storySubject = "สวน ของชมพู่ อารยา";
const celebratedAction = "ซื้อที่ดินและทำสวนธรรมชาติให้หลานๆ ได้เรียนรู้ชีวิตเรียบง่าย";

const prompt = `คุณเป็นนักวิเคราะห์ข่าวผู้เชี่ยวชาญ ทำหน้าที่สร้าง search keywords สำหรับค้นภาพข่าวใน Google Images

## ข่าว:
${newsTitle}
${newsContent}

## ตัวละครหลัก: "${hero}"
## เนื้อหาหลัก: "${storySubject}"
## กิจกรรมหลัก: "${celebratedAction}"

## คำสั่ง:
วิเคราะห์ข่าวนี้แล้วสร้าง search queries 10-15 คำ ที่จะได้ภาพตรงกับเนื้อข่าวจริงๆ

### กฎสำคัญ:
1. ห้ามค้นแค่ชื่อคนตรงๆ เช่น "ชมพู่ อารยา" เฉยๆ → จะได้ภาพแฟชั่น/สนามบิน ไม่ตรงข่าว!
2. ใช้คำ nickname/ชื่อเรียก เช่น "แม่ชมพู่", "สวนยายหนิง", "พ่อเจ"
3. ใช้บริบทข่าว ผสม เช่น "ชมพู่ อารยา สวนธรรมชาติ", "ที่ดิน 1 ไร่ ยายหนิง"
4. ค้นสิ่งของ/สถานที่/กิจกรรม ในข่าว เช่น "สวนผัก ธรรมชาติ เด็ก เรียนรู้"
5. ค้นภาพสัมภาษณ์ เช่น "ยายหนิง สัมภาษณ์", "ชมพู่ พูดเรื่องที่ดิน"
6. ค้นแบบ specific มากที่สุด
7. ต้องมีอย่างน้อย 3 queries ที่ไม่มีชื่อคน

### ประเภท queries:
- story_specific (3-4): ค้นเฉพาะเนื้อข่าว
- hero_context (2-3): ชื่อคน + บริบทข่าว
- scene_object (2-3): สิ่งของ/สถานที่ (ไม่มีชื่อคน)
- interview (1-2): สัมภาษณ์
- nickname (1-2): ชื่อเรียกเฉพาะ

## ตอบเป็น JSON:
{
  "smartQueries": ["query1", "query2", ...],
  "storyKeywords": ["keyword1", "keyword2", ...],
  "storyTheme": "สรุปเนื้อข่าวใน 1 ประโยค",
  "queryTypes": {
    "story_specific": [],
    "hero_context": [],
    "scene_object": [],
    "interview": [],
    "nickname": []
  }
}`;

(async () => {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 1500,
      response_format: { type: 'json_object' },
    }),
  });
  const data = await res.json();
  const result = JSON.parse(data.choices[0].message.content);
  
  console.log('\n=== 🧠 SMART QUERY GENERATOR — ผลลัพธ์ ===\n');
  console.log('📌 Theme:', result.storyTheme);
  console.log('\n📋 Smart Queries ทั้งหมด:');
  result.smartQueries.forEach((q, i) => console.log(`  ${i+1}. "${q}"`));
  
  console.log('\n📦 แยกตามประเภท:');
  for (const [type, queries] of Object.entries(result.queryTypes)) {
    console.log(`  [${type}]`);
    queries.forEach(q => console.log(`    → "${q}"`));
  }
  
  console.log('\n🔑 Story Keywords:', result.storyKeywords.join(', '));
  
  const u = data.usage;
  console.log(`\n💰 Cost: $${(((u.prompt_tokens * 0.15) + (u.completion_tokens * 0.6)) / 1000000).toFixed(5)} (${u.prompt_tokens}+${u.completion_tokens} tokens)`);
})();
