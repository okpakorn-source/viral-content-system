import { GoogleGenerativeAI } from '@google/generative-ai';
import { MODEL_PRIMARY } from '@/lib/ai/modelConfig';

export async function analyzeStoryIdentity(newsTitle, breakdownData) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-pro",
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2
      }
    });

    const prompt = `คุณคือ News Analyst มืออาชีพ วิเคราะห์ข่าวนี้อย่างละเอียดแล้วสกัดข้อมูลสำหรับทีมค้นหาภาพ

ชื่อข่าว: "${newsTitle}"
เนื้อข่าว (ครบถ้วน): "${(breakdownData?.core_story || '').slice(0, 3000)}"
คนที่เกี่ยวข้อง: ${JSON.stringify(breakdownData?.key_facts?.people || [])}

สร้าง search queries ที่หลากหลายมุมมอง เพื่อค้นหาภาพที่ตรงกับข่าวมากที่สุด
ต้องจับใจความข่าว จับซีนอารมณ์ จับสถานที่ จับคีย์เวิร์ดสำคัญ

★★★ กฎสำคัญที่สุด — ต้องระบุตัวตนคนชัดเจน (Disambiguation):
- ชื่อเล่น/ฉายาสั้นๆ (เช่น "เจนนี่", "ลิซ่า", "มิว") → ต้องใส่บริบทเพิ่มเสมอ!
  ตัวอย่างดี: "เจนนี่ ได้หมดถ้าสดชื่น" หรือ "เจนนี่ รัชนก สุวรรณเกตุ"
  ตัวอย่างแย่: "เจนนี่" ← จะได้ Jennie BLACKPINK! ห้ามทำแบบนี้!
- ถ้าชื่อไม่มีนามสกุลปรากฏในข่าว → ใส่ฉายา/รายการ/อาชีพ ต่อท้ายเพื่อแยกแยะ
  เช่น: "ตั๊ก บงกช" ไม่ใช่ "ตั๊ก", "ยิว ฉัตรบริรักษ์" ไม่ใช่ "ยิว"
- mainCharacter ต้องเป็นชื่อที่ค้น Google แล้วได้คนถูกคน!
- ★ person_portrait ห้ามใช้ชื่อเล่นเดี่ยวเด็ดขาด! ต้องมีฉายา/นามสกุล/บริบทเสมอ!

★★★ กฎสำคัญ — ลูกดารา/ลูกคนดัง:
- ถ้าข่าวเกี่ยวกับลูกของดารา → ค้น "ชื่อลูก + ลูกของ + ชื่อพ่อ/แม่"
  ตัวอย่าง: ข่าว "น้องทาเรีย" ลูกของน้ำฝน → mainCharacter: "น้องทาเรีย ลูกน้ำฝน กุลณัฐ"
  ★ ห้ามค้นแค่ "ทาเรีย" → จะได้คนผิด! ต้องใส่ "ลูกน้ำฝน" เสมอ!
  ตัวอย่าง: "น้องเป่าเปา ลูกเป้ย ปานวาด" ไม่ใช่ "น้องเป่าเปา"
  ตัวอย่าง: "น้องมะลิ ลูกพ่อโน้ต อุดม" ไม่ใช่ "น้องมะลิ"
- ★ mainCharacter + searchQueries ต้องมีชื่อพ่อ/แม่กำกับเสมอ!

★★★ กฎสำคัญ — Search queries ต้อง "เล่าเรื่อง" ไม่ใช่แค่หาหน้าคน!
ปกข่าวไวรัลที่ดีต้องมีภาพ 5 แบบ:
1. หน้าชัดตัวละครหลัก (HERO) — portrait สวย
2. ซีนกิจกรรมจากข่าว (KEY_ACTIVITY) — ★ สำคัญมาก! เช่น "บริจาค", "ทำสวน", "ในถ้ำ"
3. สถานที่จริงในข่าว (CONTEXT_SCENE) — เช่น โรงเรียน, บ้าน, วัด
4. ความสัมพันธ์ (RELATIONSHIP) — กับคู่รัก, ลูก, พ่อแม่
5. หน้าตัวละครรอง (HERO2)

★ ห้ามค้นแต่ภาพ "หน้าสวย" ของคน! ต้องค้นภาพ "กิจกรรม/สถานที่" ด้วย!
ตัวอย่างดี (ข่าวก้อยรัชวิน บริจาคโรงเรียน):
- "ก้อย รัชวิน บริจาค โรงเรียน" ✅
- "โรงเรียนบ้านขุนสมุทรไทย" ✅
- "ก้อย รัชวิน ตูน บอดี้สแลม" ✅
ตัวอย่างแย่:
- "ก้อย รัชวิน ชายหาด" ❌ (ไม่เกี่ยวข่าว!)
- "ก้อย รัชวิน แฟชั่น" ❌ (ไม่เกี่ยวข่าว!)

⚠️ กลยุทธ์สำคัญ — ต้องหาภาพให้ได้อย่างน้อย 5-8 ภาพ:
- ภาพหน้าชัดของบุคคลหลัก — ค้นจากแหล่งใดก็ได้ (สัมภาษณ์, IG, งานอีเวนท์)
- ★ ภาพกิจกรรม/เหตุการณ์ในข่าว — ต้องค้นคำค้นเฉพาะของข่าวนี้!
- ★ ภาพสถานที่จริง — ใส่ชื่อเต็มสถานที่เสมอ
- ★ ถ้าข่าวเศร้า → ค้น "ชื่อคน + ร้องไห้" แต่ต้องเป็นซีนที่เกี่ยวข้อง
- ★ ถ้าข่าวมี 2 คน → ค้น "คนA + คนB + บริบทข่าว"
- ค้นชื่อเต็ม+ฉายา ตรงๆ เพื่อหา portrait คมชัด

★★★ กฎเหล็ก — search queries ต้องเฉพาะเจาะจง ห้ามกว้าง:
- ถ้าข่าวมีชื่อสถานที่ → ต้องใส่ชื่อเต็มใน query
- ถ้าข่าวมีเหตุการณ์เฉพาะ → ต้องใส่รายละเอียดใน query
- event_scene และ location_photo ต้องมีชื่อสถานที่เฉพาะเสมอ
- person_context ต้องมีบริบทเฉพาะของข่าวนี้

★★★ กฎเหล็กสูงสุด — ทุก query ที่เกี่ยวกับคนต้องมีชื่อจริงของตัวละครหลัก:
- ห้ามค้น "ดาราร้องไห้" → ต้องค้น "[ชื่อจริง] ร้องไห้"
- ห้ามค้น "นักการเมือง แถลงข่าว" → ต้องค้น "[ชื่อจริง] แถลงข่าว"
- ห้ามค้น "แม่ลูก" → ต้องค้น "[ชื่อแม่จริง] กับ [ชื่อลูกจริง]"
- person_portrait, person_closeup, person_emotion, person_context ต้องมีชื่อจริงทุก field!
- ข้อยกเว้นเพียงอย่างเดียว: location_photo และ event_scene (ถ้าเป็นสถานที่ล้วน) ไม่ต้องมีชื่อคน

ตอบเป็น JSON object ตามโครงสร้างนี้เท่านั้น:
{
  "characters": ["ชื่อเต็มคนที่เกี่ยวข้องทั้งหมด รวมฉายา/นามสกุล"],
  "mainCharacter": "ชื่อเต็ม+ฉายา/นามสกุล ที่ค้น Google ได้ถูกคน (★ ถ้าเป็นลูกดารา ต้องมีชื่อพ่อ/แม่กำกับ! เช่น 'น้องทาเรีย ลูกน้ำฝน กุลณัฐ')",
  "secondaryCharacter": "ชื่อเต็ม+ฉายา/นามสกุล ของตัวละครรอง (ถ้ามี เช่น พ่อ/แม่/คู่รัก)",
  "story": "สรุปเนื้อข่าว 1 ประโยค",
  "emotion": "happy | sad | angry | shocked | neutral | dramatic",
  "coverEmotion": "drama | tragedy | shocking | hope | warm | neutral",
  "location": "ชื่อสถานที่เกิดเหตุ เต็มๆ (ถ้ามี)",
  "timeframe": "วันเวลาเกิดเหตุ (ถ้ามี)",
  "keywords": ["คำสำคัญ", "สำหรับ tag ภาพในคลัง", "ควรมี 5-10 คำ"],
  "keyScenes": ["★ ซีนกิจกรรมที่ต้องหาภาพ เช่น 'มอบเงิน บริจาคโรงเรียน', 'ทำสวน ปลูกผัก', 'ในถ้ำ ช่วยเด็ก'"],
  
  "specific_details": {
    "place_names": ["ชื่อสถานที่ทั้งหมดที่ปรากฏในข่าว ต้องเป็นชื่อเต็ม"],
    "organization_names": ["ชื่อหน่วยงาน/องค์กรที่เกี่ยวข้อง"],
    "key_events": ["★ เหตุการณ์สำคัญ เช่น 'บริจาคเงินสร้างหลังคาโรงเรียน'"],
    "evidence_items": ["หลักฐาน เช่น 'ป้ายโรงเรียน', 'เอกสารบริจาค'"]
  },

  "searchQueries": {
    "person_closeup": "ชื่อบุคคลหลัก + คำที่ได้ภาพหน้าชัด เฉยๆ ไม่ต้องใส่อาชีพ (ภาษาไทย)",
    "person_portrait": "★ ชื่อเต็ม+ฉายา ตรงๆ (ถ้าลูกดารา: 'น้องทาเรีย ลูกน้ำฝน')",
    "person_emotion": "ชื่อบุคคลหลัก + อารมณ์ตามข่าว (ภาษาไทย)",
    "secondary_person": "ชื่อตัวละครรอง (ถ้ามี) เพื่อหาหน้าชัด — ถ้า relationship='แม่' ให้ใส่ 'ชื่อhero แม่'",

    "★★★ CELEBRATED_ACTION_FIRST RULE ★★★": "key_activity, person_context, key_relationship ต้องใช้ celebratedAction เป็น PRIMARY — ห้ามใช้ occupation!",
    "person_context": "★★★ ชื่อ + celebratedAction เช่น ถ้า celebratedAction='ดูแลแม่' → 'หมอโบว์ ดูแลแม่' ไม่ใช่ 'หมอโบว์ สัตวแพทย์'",
    "event_scene": "★★★ คำค้นกิจกรรมหลัก+สถานที่ ใช้ celebratedAction เช่น 'ดูแลผู้ป่วยอัลไซเมอร์' หรือ 'มอบเงิน บริจาค สร้างหลังคา'",
    "emotion_moment": "คำค้นภาพอารมณ์ ตามโทนข่าว (ภาษาไทย)",
    "location_photo": "★ คำค้นสถานที่เต็ม เช่น 'โรงเรียนบ้านขุนสมุทรไทย'",
    "related_people": "คำค้นคนอื่นที่เกี่ยวข้อง (ภาษาไทย)",
    
    "person_past": "★★ คำค้นภาพอดีต เช่น 'นิรุตติ์ ศิริจรรยา สมัยหนุ่ม' (ถ้าข่าวมีไทม์ไลน์)",
    "key_relationship": "★★★ ชื่อ + relationship เช่น ถ้า relationship='แม่' → 'หมอโบว์ แม่' หรือ 'หมอโบว์ ครอบครัว' — ห้ามใส่ชื่อสัตว์/อาชีพ",
    "key_activity": "★★★ ชื่อ + celebratedAction ล้วนๆ เช่น 'หมอโบว์ ดูแลแม่' หรือ 'ก้อย รัชวิน บริจาค' — ต้องมี! ห้ามใช้ occupation!",
    "story_contrast": "★★ คำค้นที่สร้างความต่าง เช่น 'น้ำฝน สมัยสาว' หรือ 'โรงเรียน ก่อนบูรณะ'"
  },

  "searchGoogle": "คำค้น Google Image หลัก (ภาษาไทย)",
  "searchYouTube": "คำค้น YouTube",
  "searchTikTok": "คำค้น TikTok (ภาษาไทย)",
  "searchPexels": "คำค้นภาพ stock (ภาษาอังกฤษ)",

  "typography": {
    "hook": "1-3 คำ เช่น 'ช็อก!', 'ด่วน!', 'เศร้า'",
    "main": "4-8 คำ สรุปประเด็นหลัก",
    "punch": "2-4 คำ กระแทกอารมณ์"
  },

  "coreStory": {
    "relationship": "ชื่อ/บทบาทตัวละครรองที่สำคัญที่สุด (เช่น แม่, ลูก, สามี)",
    "sacrifice": "สิ่งที่ตัวเอกเสียสละ/ทำเพื่อ (เช่น ลาออกราชการ สูญเงิน 10 ล้าน) — null ถ้าไม่มี",
    "emotionalHook": "ประโยคสั้นๆ 1 ประโยคที่ทำให้คนกดอ่าน (สะท้อนแก่นข่าวจริง)",
    "celebratedAction": "สิ่งที่ข่าวยกย่อง/ชื่นชม ในรูปกิจกรรม เช่น ดูแลแม่อัลไซเมอร์ 9 ปี, ช่วยเหลือชุมชน (ไม่ใช่อาชีพ)",
    "occupationImportance": 0.1,
    "storyWeight": {
      "_comment": "น้ำหนักของแต่ละ element ในข่าว รวมกัน = 100 — กฎ: occupation/work/location ต้องไม่เกิน 20 เสมอ"
    },
    "negativeFocus": [
      "สิ่งที่ห้ามใช้เป็น dominant cover element แม้ปรากฏในข่าว (เช่น 'elephant as main subject', 'veterinary work as dominant')"
    ],
    "contextOnly": ["คำ/บริบทที่เป็นแค่ background ไม่ใช่แก่นข่าว"]
  }
}

★★★ coreStory RULES:
- relationship: ใส่ชื่อ/บทบาทของตัวละครรองที่ข่าวพูดถึงมากที่สุด
- sacrifice: สิ่งที่ตัวเอกเสียสละจริงๆ ในข่าวนี้ (ถ้าไม่มีให้ใส่ null)
- emotionalHook: ประโยคสั้น 1 ประโยคที่จับใจความแก่นข่าว
★ celebratedAction: สิ่งที่ข่าวต้องการให้คนชื่นชม (ไม่ใช่อาชีพ แต่เป็นการกระทำ)
  ตัวอย่าง ข่าวหมอโบว์: "ดูแลแม่อัลไซเมอร์ 9 ปี" ไม่ใช่ "รักษาช้าง"
  ตัวอย่าง ข่าวก้อย: "บริจาคสร้างหลังคาโรงเรียน" ไม่ใช่ "นักแสดง"
★ occupationImportance: น้ำหนัก 0-1 ของอาชีพในข่าว
  - ถ้าข่าวไม่ได้เกี่ยวกับอาชีพ → ใส่ 0.05-0.1
  - ถ้าข่าวเกี่ยวกับอาชีพโดยตรง → ใส่ 0.5-1.0
  - ตัวอย่าง ข่าวหมอโบว์ดูแลแม่: 0.05 (ข่าวไม่ได้เกี่ยวงานสัตวแพทย์)
- storyWeight: ให้น้ำหนัก % แก่แต่ละ element โดย:
  * อาชีพ/งาน/สถานที่ทำงาน = ห้ามเกิน 20% เสมอ
  * ความสัมพันธ์หลัก (แม่/ลูก/สามี) ต้องมีน้ำหนักสูงที่สุดถ้าข่าวพูดถึง
  * ตัวอย่างข่าวหมอโบว์: { "mother_care": 45, "caregiving": 30, "sacrifice": 15, "vet_work": 10 }
- negativeFocus: สิ่งที่ไม่ใช่แก่นข่าว แต่อาจ dominate cover ได้ถ้าไม่ระวัง
  ตัวอย่าง: ข่าวหมอโบว์ → "elephant", "vet work", "animal treatment" ควรอยู่ใน negativeFocus
- contextOnly: คำ/บริบทที่เป็นแค่ background (เช่น ชื่อโรงพยาบาลที่ทำงาน)`;

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

    // ★★★ Fallback: GPT-4o เมื่อ Gemini ล้มเหลว (สำคัญมาก! ถ้า identity null → ค้นภาพมั่วทั้งหมด)
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      try {
        console.log(`[StoryIdentity] 🔄 Trying ${MODEL_PRIMARY} fallback...`);
        // ★ GPT-5.5 compatibility
        const _isNew = MODEL_PRIMARY.startsWith('gpt-5') || MODEL_PRIMARY.startsWith('o1') || MODEL_PRIMARY.startsWith('o3');
        const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: MODEL_PRIMARY,
            messages: [{ role: 'user', content: prompt }],
            ...(_isNew ? { max_completion_tokens: 4000 } : { max_tokens: 4000 }),
            ...(_isNew ? {} : { temperature: 0.2 }),
            response_format: { type: 'json_object' }
          })
        });

        if (gptRes.ok) {
          const gptData = await gptRes.json();
          const gptText = gptData.choices?.[0]?.message?.content || '';
          const parsed = JSON.parse(gptText);
          console.log(`[StoryIdentity] ✅ ${MODEL_PRIMARY} fallback success: ${parsed.mainCharacter}`);
          return parsed;
        } else {
          console.log(`[StoryIdentity] ❌ ${MODEL_PRIMARY} HTTP ${gptRes.status}`);
        }
      } catch (gptErr) {
        console.log(`[StoryIdentity] ❌ GPT-4o error: ${gptErr.message?.substring(0, 80)}`);
      }
    }

    console.error('[StoryIdentity] All attempts failed:', lastError?.message?.substring(0, 100));
    return null;
  } catch (outerErr) {
    console.error('[StoryIdentity] Unexpected error:', outerErr.message);
    return null;
  }
}
