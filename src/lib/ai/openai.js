import OpenAI from 'openai';
import { logApiUsage } from './usageLogger';
import { sanitizeOutput } from './safetyFilter';
import { MODEL_PRIMARY, MODEL_FALLBACKS, MODEL_HEAVY_FALLBACK, clampMaxTokens } from './modelConfig.js';

let openaiClient = null;

export function getOpenAIClient() {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn('⚠️ OPENAI_API_KEY not set');
      return null;
    }
    // 🔴 ★ 25 ก.ค. 69 (ผลตรวจ Fable+sol ตรงกัน): เดิมสร้างแบบเปล่าๆ = ใช้ค่าโรงงาน
    //    รอได้ถึง 10 นาที + ลองซ้ำเอง 2 รอบ → 1 การเรียก = สูงสุด 3 คำขอ × 2 โมเดล (มี fallback) = 6
    //    วันที่ผู้ให้บริการอืด งานบวมทะลุเพดานทุกชั้นและจ่ายเงินซ้ำโดยไม่ได้อะไร
    //    ตั้ง 240s = สูงกว่าเพดานชั้นในที่ยาวสุด (breakdown 200s / write 180s) แต่ต่ำกว่าเพดานนอก 300s
    //    ปรับได้: env OPENAI_TIMEOUT_MS / OPENAI_MAX_RETRIES
    openaiClient = new OpenAI({
      apiKey,
      timeout: Number(process.env.OPENAI_TIMEOUT_MS) || 240_000,
      maxRetries: Number.isFinite(Number(process.env.OPENAI_MAX_RETRIES)) ? Number(process.env.OPENAI_MAX_RETRIES) : 1,
    });
  }
  return openaiClient;
}

/**
 * เรียก AI — Single prompt system
 * callAI({ prompt: "..." }) — prompt เดียวครบ
 */
export async function callAI({ prompt, systemPrompt, userPrompt, imageContents, model = MODEL_PRIMARY, temperature = 0.7, maxTokens = 4000, signal }) {
  const client = getOpenAIClient();

  if (!client) {
    throw new Error('OPENAI_API_KEY ไม่ได้ตั้งค่า');
  }

  // System message — บังคับ AI + กฎเหล็ก DNA + Facebook Safety ถาวร
  // ★ 25 ก.ค. 69 (เจ้าของสั่ง): กฎกลางถอยไปคุมแค่ความจริง+ความปลอดภัย — สไตล์ให้การ์ดในคลังพร้อมท์คุม
  //   ถอยกลับชุดเดิมทั้งก้อน: env HOUSE_RULES=legacy
  const HOUSE_CARD_FIRST = `คุณเป็น AI assistant ที่ต้องปฏิบัติตามคำสั่งใน user message อย่างเคร่งครัด

=== กฎกลาง (เหลือเฉพาะความจริง + ความปลอดภัย — 25 ก.ค. 69) ===
🔴 สไตล์การเขียน โครงเรื่อง จังหวะ สำนวน วิธีเปิด-ปิด ทั้งหมด "ให้ยึดคำสั่งจากคลังพร้อมท์ที่แนบมาในข้อความ"
   กฎกลางนี้ไม่กำหนดสไตล์ใดๆ และห้ามขัดกับคำสั่งของพร้อมท์

[1] ทำเฉพาะสิ่งที่คำสั่งสั่ง — ห้ามข้ามขั้น ห้ามเพิ่มขั้นเอง

[2] ห้ามแต่งเรื่อง
- ใช้ข้อมูลจากเนื้อข่าวที่ให้มาเท่านั้น ห้ามเพิ่มจากความรู้ของตัวเอง
- ชื่อคน สถานที่ ตัวเลข วันที่ ต้องตรงต้นฉบับ 100% ห้ามเดา ห้ามแก้
- 🔴 สถานะบุคคล "ยังมีชีวิต/เสียชีวิตแล้ว" ต้องตรงต้นฉบับ 100% — ถ้าต้นฉบับมีผู้เสียชีวิต ต้องบอกการจากไปให้ชัดอย่างน้อย 1 ครั้ง ("เสียชีวิต"/"จากไป" ใช้ได้ตรงๆ)
- ห้ามคาดเดาเพศจากชื่อ — ข่าวไม่ระบุเพศ ให้เรียกด้วยชื่อหรือ "เจ้าตัว"
- ลักษณนามถูกประเภท: พระสงฆ์ = "รูป", คนทั่วไป = "คน"
- ข่าวไม่ได้ระบุอะไร ห้ามสร้างขึ้นเอง ให้ข้ามไป

[3] ติดขัดต้องแจ้ง ห้ามแก้เอง
- ข้อมูลไม่พอ → ใส่ "_error": "ข้อมูลไม่เพียงพอ: [รายละเอียด]"
- เนื้อข่าวไม่ชัด → ใส่ "_warning": "เนื้อข่าวคลุมเครือ: [จุดที่ไม่ชัด]"

[4] ตอบเป็น JSON เท่านั้น ใช้ key names ตามที่ระบุใน prompt
- ถ้ามีเนื้อข่าวอยู่ระหว่าง === เนื้อข่าว === ให้ใช้ข้อมูลจากส่วนนั้นเท่านั้น
=== จบกฎกลาง ===

=== FACEBOOK SAFETY RULES ===
🔴 ถอดกฎแทนคำ/แบนคำออกทั้งหมดแล้ว (25 ก.ค. 69 — เจ้าของสั่ง)
เขียนตามข้อเท็จจริงในข่าวตรงๆ ไม่ต้องเลี่ยงคำ ไม่ต้องแทนคำใดๆ
=== จบ FACEBOOK SAFETY RULES ===`;
  const HOUSE_LEGACY = `คุณเป็น AI assistant ที่ต้องปฏิบัติตามคำสั่งใน user message อย่างเคร่งครัด

=== กฎเหล็ก DNA ระบบ (IRON RULES — บังคับทุกคำสั่ง ทุกโหมด ห้ามฝ่าฝืน) ===

[กฎที่ 1: ห้ามทำนอก Flow]
- ทำเฉพาะสิ่งที่คำสั่งสั่งเท่านั้น ห้ามคิดเอง ห้ามเพิ่มขั้นตอน ห้ามข้ามขั้นตอน
- ถ้าคำสั่งบอกให้ "สกัดข่าว" → ทำแค่สกัดข่าว ห้ามวิเคราะห์เพิ่ม
- ถ้าคำสั่งบอกให้ "แตกประเด็น" → ทำแค่แตกประเด็น ห้ามเขียนเนื้อหา

[กฎที่ 2: ห้ามแต่งเรื่อง]
- ใช้ข้อมูลจากเนื้อข่าวที่ให้มาเท่านั้น ห้ามเพิ่มข้อมูลจากความรู้ของตัวเอง
- ชื่อคน สถานที่ ตัวเลข วันที่ → ต้องตรงกับข่าวต้นฉบับ 100% ห้ามเดา ห้ามแก้
- สถานะบุคคล "ยังมีชีวิต/เสียชีวิตแล้ว" ต้องตรงต้นฉบับ 100% — ถ้าต้นฉบับมีผู้เสียชีวิต ต้องบอกการจากไปให้ชัดอย่างน้อย 1 ครั้ง ("เสียชีวิต"/"จากไป" คือคำมาตรฐานปลอดภัย ใช้ได้) ห้ามเล่าฉากอดีตแบบละคำบอกการจากไป จนคนอ่านเข้าใจว่ายังมีชีวิตอยู่
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

[กฎที่ 6: ตัวเลขและลักษณนาม — บังคับทุกการเขียน]
- ตัวเลขในประโยคเปิด/hook ใช้ได้กับ สิ่งของ จำนวนเงิน เวลา ระยะทาง ที่มีในข่าวจริงเท่านั้น — ถ้าข่าวไม่มีตัวเลข ห้ามประดิษฐ์ขึ้นเอง ให้เปิดด้วยภาพเหตุการณ์แทน
- ห้ามนับ "คน" รวมในรายการสิ่งของเด็ดขาด (เช่น ห้ามเขียน "บ้านหนึ่งหลัง พระสงฆ์หนึ่งชุด พัดลม...") — คนไม่ใช่ไอเทม
- ลักษณนามต้องถูกประเภท: พระสงฆ์ = "รูป", คนทั่วไป = "คน" — ห้ามใช้ลักษณนามสิ่งของ (ชุด/ชิ้น/อัน) กับคนหรือพระ

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

=== FACEBOOK SAFETY RULES ===
🔴 ถอดกฎแทนคำ/แบนคำออกทั้งหมดแล้ว (25 ก.ค. 69 — เจ้าของสั่ง: พนักงานเกลาเนื้อก่อนใส่เจนอยู่แล้ว)
ให้เขียนตามข้อเท็จจริงในข่าวตรงๆ ไม่ต้องเลี่ยงคำ ไม่ต้องแทนคำใดๆ
ข้อเดียวที่ยังบังคับ: ห้ามใส่ข้อมูลที่ไม่มีในข่าว และสถานะเป็น/ตายของบุคคลต้องตรงต้นฉบับ 100%
=== จบ FACEBOOK SAFETY RULES ===`;
  const _houseRules = process.env.HOUSE_RULES === 'legacy' ? HOUSE_LEGACY : HOUSE_CARD_FIRST;
  const systemMsg = _houseRules;

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

  // ★ 25 ก.ค. 69: ไม้สองอ่านจากแผนที่กลาง (modelConfig.MODEL_FALLBACKS) แทน hardcode gpt-4o
  //   บั๊กเดิม: ไม้สองเป็น gpt-4o เสมอ + ส่ง maxTokens เดิม (เช่น 24000) ซึ่งเกินเพดาน gpt-4o (16384)
  //   → ไม้สองถูก API ปฏิเสธทันทีทุกครั้ง = มีไว้แต่ไม่เคยช่วยอะไร แถม log ขึ้นบรรทัดล้มหลอกตา
  const modelsToTry = [model, ...(MODEL_FALLBACKS[model] || [MODEL_HEAVY_FALLBACK])]
    .filter((m, i, a) => m && a.indexOf(m) === i);

  let lastError = null;
  for (const currentModel of modelsToTry) {
    try {
      console.log(`[callAI] Trying model=${currentModel}`);
      const isNewModel = currentModel.startsWith('gpt-5') || currentModel.startsWith('o1') || currentModel.startsWith('o3');
      // ★ 25 ก.ค. 69: ตัดเพดาน token ให้พอดีกับโมเดลที่กำลังยิงจริง — กันขอเกินแล้วโดนปฏิเสธทั้งคำขอ
      const capped = clampMaxTokens(currentModel, maxTokens);
      if (capped !== maxTokens) {
        console.warn(`[callAI] ⚠️ ลด maxTokens ${maxTokens} → ${capped} ให้พอดีเพดานของ ${currentModel}`);
      }

      const response = await client.chat.completions.create({
        model: currentModel,
        messages,
        // ★ gpt-5.x ไม่รับ temperature ≠ 1 → ไม่ส่ง (ใช้ default)
        ...(isNewModel ? {} : { temperature }),
        ...(isNewModel
          ? { max_completion_tokens: capped }
          : { max_tokens: capped }),
        response_format: { type: 'json_object' },
      // ★ 16 ก.ค. 69 (B4): รับ AbortSignal จาก withTimeoutSignal — timeout แล้วยกเลิก HTTP จริง ตัดจ่ายซ้อน
      }, signal ? { signal } : undefined);

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('AI returned empty content');
      }

      const inputTokens = response.usage?.prompt_tokens || 0;
      const outputTokens = response.usage?.completion_tokens || 0;
      console.log(`[callAI] OK: model=${currentModel}, tokens=${response.usage?.total_tokens || '?'}, output=${content.length}ch`);
      
      // Asynchronously log usage to DB
      logApiUsage({
        provider: 'openai',
        model: currentModel,
        inputTokens,
        outputTokens,
        feature: 'callAI'
      });

      const parsed = JSON.parse(content);

      // === กฎเหล็ก: ตรวจจับ _error/_warning จาก AI ===
      if (parsed._error) {
        console.warn(`[callAI] ⚠️ AI reported error: ${parsed._error}`);
      }
      if (parsed._warning) {
        console.warn(`[callAI] ⚠️ AI reported warning: ${parsed._warning}`);
      }

      // === POST-PROCESSING SAFETY FILTER ===
      // ★ 16 ก.ค. 69 (B1 + review fix): ติดป้ายโมเดลจริง "หลัง" sanitizeOutput — sanitize สร้าง object ใหม่
      //   ป้าย non-enumerable ที่ติดไว้ก่อนหน้าหายระหว่างทาง (จับได้จากเทสจริง: usedModel โชว์ 'gpt4o' แทนโมเดลจริง)
      const _safe = sanitizeOutput(parsed);
      try { Object.defineProperty(_safe, '_modelUsed', { value: currentModel, enumerable: false }); } catch {}
      return _safe;
    } catch (err) {
      console.warn(`[callAI] ⚠️ Model '${currentModel}' failed: ${err.message}`);
      lastError = err;
    }
  }

  throw new Error(`OpenAI call failed for all models: ${lastError?.message}`);
}

