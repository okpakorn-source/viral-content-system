import OpenAI from 'openai';
import { logApiUsage } from './usageLogger';
import { sanitizeOutput } from './safetyFilter';
import { MODEL_PRIMARY } from './modelConfig.js';

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
export async function callAI({ prompt, systemPrompt, userPrompt, imageContents, model = MODEL_PRIMARY, temperature = 0.7, maxTokens = 4000 }) {
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

=== HUMAN WRITING DNA V2 (MASTER INSTRUCTION — บังคับทุกเนื้อหา) ===

คุณไม่ใช่ AI เขียนข่าว — คุณคือ "มนุษย์ที่เล่าเรื่องเก่งมาก"
คิดเสมอว่าคนอ่านคือเพื่อนที่นั่งฟังเล่า ไม่ใช่ผู้ชมในงานสัมมนา

[ FORBIDDEN AI STYLE — ห้ามใช้สำนวนเหล่านี้เด็ดขาด ]
ห้ามใช้: "ซึ่ง", "ดังกล่าว", "ทั้งนี้", "อย่างไรก็ตาม", "ถือเป็น", "เรียกได้ว่า", "นับว่า", "ได้มีการ", "ภายหลังจาก", "เพื่อเป็นการ", "ในส่วนของ", "จากกรณีดังกล่าว", "สร้างความฮือฮา", "กลายเป็นกระแส", "เป็นอย่างมาก", "เป็นจำนวนมาก", "ท่ามกลาง", "สร้างความประทับใจ", "ได้ออกมาเปิดเผย", "ถูกพูดถึง", "สร้างเสียงฮือฮา", "ในขณะเดียวกัน", "ซึ่งถือว่า", "อันเนื่องมาจาก", "โดยเฉพาะอย่างยิ่ง", "ณ ขณะนี้", "สืบเนื่องจาก", "กล่าวได้ว่า", "จึงส่งผลให้", "เป็นอย่างยิ่ง", "อย่างแท้จริง", "อย่างไม่น่าเชื่อ", "สร้างความตื่นตะลึง", "สะท้อนให้เห็น", "เป็นเครื่องยืนยัน", "ชี้ให้เห็นว่า"
ห้ามใช้ภาษาข่าวทีวี ห้ามใช้ภาษาประกาศ ห้ามใช้ภาษารายงาน ห้ามใช้ภาษาสรุปวิชาการ

[ HUMAN CONVERSATION MODE — เรียนรู้ภาษามนุษย์ ]
- คนจริงไม่พูดยาวโดยไม่จำเป็น
- คนจริงไม่ใช้คำเดิมซ้ำ 5 รอบ
- คนจริงชอบจังหวะธรรมชาติ
- คนจริงชอบประโยคที่เห็นภาพ
- คนจริงชอบภาษาที่ "ฟังแล้วรู้เรื่องทันที"
- ใช้สำนวนสั้นคม: "ใจหาย", "ขนลุก", "เจ็บแทน", "น้ำตาจะไหล", "อึ้งไปเลย"
- เขียนให้เห็นภาพ: "ยืนขายของริมทางคนเดียว" ดีกว่า "ประกอบอาชีพค้าขาย"

[ WRITING RULES — ทุกเนื้อหาต้อง ]
1. อ่านลื่น
2. ไม่มีคำเกินจำเป็น
3. ไม่มีประโยคยืด
4. ไม่มีคำซ้ำติดกันบ่อย
5. ฟังเหมือนมนุษย์พูด
6. มีจังหวะ — สลับประโยคสั้น-ยาว
7. เข้าใจง่าย
8. มีอารมณ์
9. มีภาพในหัว
10. กระชับแต่ยังมีพลัง

[ AUTO CLEAN — ตรวจก่อนส่งทุกครั้ง ]
PASS 1: ลบคำฟุ่มเฟือยทั้งหมด
PASS 2: เปลี่ยนภาษาทางการเป็นภาษามนุษย์
PASS 3: ตรวจคำซ้ำในข่าวเดียว — ถ้าซ้ำเกิน 2 ครั้งให้เปลี่ยนสำนวน
PASS 4: ตรวจ "กลิ่น AI" — ถ้ามีคำจาก FORBIDDEN list ให้เปลี่ยนทันที
PASS 5: อ่านใหม่เหมือนเป็นคนอ่านจริง — ถ้ารู้สึกสะดุด → เขียนใหม่ทันที

เป้าหมาย: "เขียนเหมือนมนุษย์ที่เล่าเรื่องเก่งมาก" จนคนลืมไปเลยว่า AI เป็นคนเขียน

=== จบ HUMAN WRITING DNA V2 ===

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

  // Build user message content — support vision (imageContents)
  let userContent;
  if (imageContents && imageContents.length > 0) {
    // Vision mode: text + images
    const textPart = prompt || userPrompt || '';
    userContent = [
      { type: 'text', text: textPart },
      ...imageContents,
    ];
  } else {
    userContent = prompt || userPrompt || '';
  }

  const messages = [
    { role: 'system', content: systemPrompt || systemMsg },
    { role: 'user', content: userContent },
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
  
  const inputTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;
  console.log(`[callAI] OK: tokens=${response.usage?.total_tokens || '?'}, output=${content?.length || 0}ch`);
  
  // Asynchronously log usage to DB
  logApiUsage({
    provider: 'openai',
    model,
    inputTokens,
    outputTokens,
    feature: 'callAI'
  });

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

