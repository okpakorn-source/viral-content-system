import OpenAI from 'openai';

let openaiClient = null;

export function getOpenAIClient() {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn('⚠️ OPENAI_API_KEY not set');
      return null;
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

/**
 * เรียก AI — Single prompt system
 * callAI({ prompt: "..." }) — prompt เดียวครบ
 */
export async function callAI({ prompt, systemPrompt, userPrompt, model = 'gpt-4o', temperature = 0.7, maxTokens = 4000 }) {
  const client = getOpenAIClient();

  if (!client) {
    throw new Error('OPENAI_API_KEY ไม่ได้ตั้งค่า');
  }

  // System message — บังคับ AI + กฎเหล็ก DNA + Facebook Safety ถาวร
  const systemMsg = `คุณเป็น AI assistant ที่ต้องปฏิบัติตามคำสั่งใน user message อย่างเคร่งครัด

=== กฎเหล็ก DNA ระบบ (IRON RULES — บังคับทุกคำสั่ง ทุกโหมด ห้ามฝ่าฝืน) ===

[กฎที่ 1: ห้ามทำนอก Flow]
- ทำเฉพาะสิ่งที่คำสั่งสั่งเท่านั้น ห้ามคิดเอง ห้ามเพิ่มขั้นตอน ห้ามข้ามขั้นตอน
- ถ้าคำสั่งบอกให้ "สกัดข่าว" → ทำแค่สกัดข่าว ห้ามวิเคราะห์เพิ่ม
- ถ้าคำสั่งบอกให้ "แตกประเด็น" → ทำแค่แตกประเด็น ห้ามเขียนเนื้อหา

[กฎที่ 2: ห้ามแต่งเรื่อง]
- ใช้ข้อมูลจากเนื้อข่าวที่ให้มาเท่านั้น ห้ามเพิ่มข้อมูลจากความรู้ของตัวเอง
- ชื่อคน สถานที่ ตัวเลข วันที่ → ต้องตรงกับข่าวต้นฉบับ 100% ห้ามเดา ห้ามแก้
- ถ้าข่าวไม่ได้ระบุข้อมูลบางอย่าง → ห้ามสร้างขึ้นมาเอง ให้ข้ามไป

[กฎที่ 3: ติดขัดต้องแจ้ง ห้ามแก้เอง]
- ถ้าข้อมูลไม่เพียงพอ → ใส่ "_error": "ข้อมูลไม่เพียงพอ: [รายละเอียด]" ใน JSON
- ถ้าเนื้อข่าวไม่ชัด → ใส่ "_warning": "เนื้อข่าวคลุมเครือ: [จุดที่ไม่ชัด]"
- ห้ามเดาหรือสร้างข้อมูลขึ้นมาเพื่อ "แก้ปัญหา" ให้แจ้งปัญหาแทน

[กฎที่ 4: JSON เท่านั้น]
- ตอบเป็น JSON เท่านั้น ใช้ key names ตามที่ระบุใน prompt
- ถ้า prompt มีเนื้อข่าวอยู่ระหว่าง === เนื้อข่าว === ให้ใช้ข้อมูลจากส่วนนั้นเท่านั้น

[กฎที่ 5: โครงสร้างเนื้อหา Facebook]
- เนื้อหาต้องยาวอย่างน้อย 250 คำ หรือ 3 ย่อหน้าเต็ม (แต่ละย่อหน้า 3-5 ประโยค คั่นด้วย \\n\\n)
- โครงสร้าง: [เปิดแรง hook] → [เล่ารายละเอียด storytelling] → [ปิดด้วยประโยคบรรยายทรงพลัง]
- ⚠️ ห้ามตั้งคำถามปิดท้าย ห้ามจบด้วย "คุณคิดยังไง?" "เห็นด้วยไหม?" — ปิดด้วยบรรยายเท่านั้น
- ห้ามเขียนสั้น ห้ามสรุปรวบรัด ต้องเล่าเรื่องเต็มที่เหมือนโพสต์ Facebook จริง

=== จบกฎเหล็ก DNA ===

=== FACEBOOK SAFETY RULES (บังคับทุกคำตอบ) ===
ก่อนสร้างเนื้อหาทุกครั้ง ต้องตรวจสอบและ rewrite คำเสี่ยงทั้งหมด:

[ความรุนแรง] ห้ามใช้: ฆ่า, ยิงหัว, ปาดคอ, หั่นศพ, เลือดสาด, ศพ, สยอง, โหด, คว้านท้อง, ไลฟ์ตาย, ดับสลด
→ ใช้แทน: ทำร้ายจนเสียชีวิต, เหตุรุนแรง, ร่างผู้เสียชีวิต, เหตุสะเทือนใจ, เหตุไม่คาดคิด

[Self-harm] ห้ามใช้: ผูกคอ, ยิงตัวตาย, กระโดดตึก, อยากตาย, จบชีวิต, ลาก่อนโลกนี้
→ ใช้แทน: เสียชีวิต, จากไป, เหตุเศร้า, ภาวะเครียดสะสม

[Sexual/18+] ห้ามใช้: หลุด, AV, xxx, เย็ด, เสียว, คอลเสียว, เด็กเอ็น, OnlyFans
→ ใช้แทน: คลิปปริศนา, คอนเทนต์ส่วนตัว, ภาพไม่เหมาะสม, ประเด็นบนโซเชียล

[การพนัน] ห้ามใช้: สล็อต, บาคาร่า, แทงบอล, ฝากถอน, เว็บตรง, แตกหนัก, ยิงปลา
→ ใช้แทน: เว็บไซต์ผิดกฎหมาย, สูญเงินจำนวนมาก

[ยาเสพติด] ห้ามใช้: ดูด, พอต, vape, THC, ยาไอซ์, โคเคน, สายเขียว
→ ใช้แทน: อุปกรณ์สูบ, สารเสพติด, อุปกรณ์ดังกล่าว

[Hate Speech] ห้ามใช้: ไอ้ดำ, ไอ้ลาว, อีกะเทย, พวกเกย์มัน..., พวกมุสลิม
→ ใช้แทน: บุคคลดังกล่าว, กลุ่มคนบางส่วน, เกิดประเด็นถกเถียง

[Fake News] ห้ามใช้: รักษาหาย 100%, หมอไม่อยากให้รู้, กินแล้วหาย, รัฐบาลแจกจริง, ด่วนที่สุด
→ ใช้แทน: มีการแชร์ข้อมูลว่า..., ผู้ใช้บางรายอ้างว่า..., ควรตรวจสอบเพิ่มเติม

[Clickbait] ห้ามใช้: คุณจะไม่เชื่อ, รีบดูด่วน, แชร์ด่วน, ดูก่อนโดนลบ, อึ้งทั้งประเทศ
→ ใช้แทน: หลายคนพูดถึง, กลายเป็นประเด็น, คนบนโซเชียลวิจารณ์

[Engagement Bait] ห้ามใช้: พิมพ์ 1, เมนต์ 99, แชร์วนไป, ใครเห็นด้วยกดไลก์
→ ใช้แทน: คุณคิดเห็นยังไง, ถ้าเป็นคุณจะ..., มองเรื่องนี้ยังไง

หลักการ: เปลี่ยนจาก "ความแรง" → "อารมณ์" เน้น emotional storytelling, human emotion, social conflict แทน shock/gore/rage bait
=== จบ FACEBOOK SAFETY RULES ===`;

  const messages = prompt
    ? [
        { role: 'system', content: systemMsg },
        { role: 'user', content: prompt },
      ]
    : [
        { role: 'system', content: systemPrompt || systemMsg },
        { role: 'user', content: userPrompt },
      ];

  // Debug log — แสดง prompt ที่ส่งไปจริง
  console.log(`[callAI] model=${model}, temp=${temperature}, maxTokens=${maxTokens}`);
  console.log(`[callAI] prompt preview (first 500ch): ${(prompt || userPrompt || '').slice(0, 500)}`);

  const response = await client.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  console.log(`[callAI] OK: tokens=${response.usage?.total_tokens || '?'}, output=${content?.length || 0}ch`);

  if (!content) throw new Error('AI ไม่ส่งข้อมูลกลับ');

  try {
    const parsed = JSON.parse(content);

    // === กฎเหล็ก: ตรวจจับ _error/_warning จาก AI ===
    if (parsed._error) {
      console.warn(`[callAI] ⚠️ AI reported error: ${parsed._error}`);
    }
    if (parsed._warning) {
      console.warn(`[callAI] ⚠️ AI reported warning: ${parsed._warning}`);
    }

    // === POST-PROCESSING SAFETY FILTER ===
    // แม้ AI จะไม่ทำตาม prompt → filter คำเสี่ยงออกจาก output ก่อน return
    return sanitizeOutput(parsed);
  } catch (e) {
    console.error('[callAI] JSON parse failed:', content.slice(0, 300));
    throw new Error('AI ส่งข้อมูลที่ parse ไม่ได้');
  }
}

/**
 * Post-processing safety filter — replace คำเสี่ยงใน output ทุกครั้ง
 * ทำงานเป็น last line of defense ไม่ว่า prompt จะสั่งหรือไม่
 */
const SAFETY_REPLACEMENTS = [
  // ความรุนแรง
  [/ฆ่า/g, 'ทำให้เสียชีวิต'],
  [/ฆาตกรรม/g, 'เหตุสูญเสีย'],
  [/หมกศพ/g, 'ซ่อนร่างผู้เสียชีวิต'],
  [/ชำแหละ/g, 'เหตุรุนแรงอย่างยิ่ง'],
  [/ศพ/g, 'ร่างผู้เสียชีวิต'],
  [/แทงตาย/g, 'ใช้ของมีคมจนเสียชีวิต'],
  [/ยิงตาย/g, 'ใช้อาวุธปืนจนเสียชีวิต'],
  [/ดับสลด/g, 'เสียชีวิตอย่างสะเทือนใจ'],
  [/ดับคาที่/g, 'เสียชีวิตในที่เกิดเหตุ'],
  [/สยองขวัญ/g, 'สะเทือนขวัญ'],
  [/สยอง/g, 'สะเทือนใจ'],
  [/โหดเหี้ยม/g, 'รุนแรงอย่างยิ่ง'],
  [/โหด/g, 'รุนแรง'],
  [/เลือดสาด/g, 'เหตุรุนแรง'],
  [/เลือดอาบ/g, 'เหตุรุนแรง'],
  [/ทุบตี/g, 'ใช้ความรุนแรง'],
  // Self-harm
  [/ผูกคอตาย/g, 'เสียชีวิตอย่างน่าเศร้า'],
  [/ผูกคอ/g, 'เสียชีวิตอย่างน่าเศร้า'],
  [/กระโดดตึก/g, 'เสียชีวิตจากที่สูง'],
  [/จบชีวิตตัวเอง/g, 'จากไปอย่างกะทันหัน'],
  [/อยากตาย/g, 'ภาวะเครียดสะสม'],
  // Sexual
  [/ข่มขืน/g, 'ล่วงละเมิดทางเพศ'],
  [/อนาจาร/g, 'กระทำไม่เหมาะสม'],
  // Clickbait
  [/คุณจะไม่เชื่อ/g, 'หลายคนพูดถึง'],
  [/แชร์ด่วน/g, 'กลายเป็นประเด็น'],
  [/ดูก่อนโดนลบ/g, 'เป็นที่สนใจ'],
  [/อึ้งทั้งประเทศ/g, 'เป็นที่วิพากษ์วิจารณ์'],
  [/รีบดูด่วน/g, 'น่าติดตาม'],
  // Engagement bait
  [/พิมพ์ 1/g, 'คุณคิดเห็นยังไง'],
  [/เมนต์ 99/g, 'แสดงความเห็น'],
  [/แชร์วนไป/g, 'แบ่งปันให้คนรู้จัก'],
  [/ใครเห็นด้วยกดไลก์/g, 'คุณเห็นด้วยไหม'],
];

function sanitizeOutput(obj) {
  if (typeof obj === 'string') {
    let result = obj;
    for (const [pattern, replacement] of SAFETY_REPLACEMENTS) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeOutput(item));
  }
  if (obj && typeof obj === 'object') {
    const sanitized = {};
    for (const [key, val] of Object.entries(obj)) {
      sanitized[key] = sanitizeOutput(val);
    }
    return sanitized;
  }
  return obj;
}
