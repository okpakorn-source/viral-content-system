// ============================================================
// 🧬 Ref Cover Brain — ถอด "ชุดข้อมูลครบ" ของปกตัวอย่าง (gpt-4o vision)
// ------------------------------------------------------------
// ไม่ใช่แค่การจัดวาง — ถอดยัน "แทมเพลต render ได้จริง" (พิกัด % ของ canvas):
//   ① template (slots พิกัด % → executor สร้างปกได้) ② layout ③ slots semantic
//   ④ style/สี/เอฟเฟกต์ ⑤ ตรรกะ+story flow ⑥ เงื่อนไข match ข่าว
// → MEGA workflow ดึงชุดนี้ไปเลือก+สร้างปกตามแนว ref ได้จริง
// reuse callAI (openai.js) — vision + auto-log /cost
// ============================================================

import { callAI } from '@/lib/ai/openai';

const SYSTEM = `คุณคือผู้เชี่ยวชาญออกแบบ "ปกข่าวไวรัลไทย" (คอลลาจหลายภาพ) — งานคือ "ถอดแบบ" ปกตัวอย่างที่ให้มาให้ละเอียดที่สุด เป็นชุดข้อมูลที่เอาไปสร้างปกใหม่แนวเดียวกันได้จริง
มองภาพจริงเท่านั้น · ประเมินพิกัด/สัดส่วนเป็น % ของทั้งปก (0-100) ให้แม่นที่สุดเท่าที่ตาเห็น · ตอบ JSON ล้วนตาม schema (ไม่มีข้อความอื่น):
{
  "aspectRatio": "เช่น 4:5, 1:1, 9:16",
  "canvasWpx": <แนะนำ px กว้าง เช่น 1080>, "canvasHpx": <เช่น 1350>,
  "layoutFamily": "จัดกลุ่มโครง: hero-left-collage | hero-top-strip | grid-4 | dual-split | circle-center | อื่นๆ",
  "layoutType": "วลีสรุปโครงเป็นภาษาคน เช่น 'ฮีโร่ซ้ายเต็มสูง + ขวา 2 ช่อง + วงกลมล่างซ้าย'",
  "panelCount": <จำนวนช่องภาพทั้งหมดรวมวงกลม>,

  "template": {
    "slots": [
      { "role": "hero|reaction|action|context|victim|evidence|moment|pair", "shape": "rect|circle",
        "xPct": <ซ้ายบน x %>, "yPct": <ซ้ายบน y %>, "wPct": <กว้าง %>, "hPct": <สูง %>,
        "zIndex": <ชั้นซ้อน 0 ปกติ, วงกลม/ทับ = สูงกว่า>,
        "border": true/false, "borderColor": "เช่น #FFFFFF หรือ -", "borderWidthPct": <หนาขอบ % หรือ 0> }
    ],
    "seamStyle": "edge-to-edge | gap | feather (รอยต่อระหว่างช่อง)",
    "featherPx": <ความนุ่มรอยต่อโดยประมาณ px หรือ 0>
  },

  "layout": {
    "hero": { "position": "left|top|center|...", "widthPct": <%>, "facePct": <หน้ากิน %ของช่องฮีโร่>, "facePosition": "upper-center|center|..." },
    "sidePanels": { "count": <>, "stack": "vertical|horizontal|grid", "split": "เช่น 40/60, 50/50, -" },
    "circle": { "present": true/false, "xPct": <>, "yPct": <>, "diameterPct": <เส้นผ่าศูนย์กลาง %ของกว้างปก>, "position": "bottom-left|center|...", "role": "moment|evidence|face" }
  },

  "slots": [ { "role": "...", "subject": "ใคร/อะไร", "emotion": "อารมณ์ในช่อง", "faceSizePct": <หน้ากิน %ช่อง>, "facing": "ตรง|ข้าง|-", "desc": "สั้นๆ" } ],
  "subjectsRelation": "ความสัมพันธ์คนในปก เช่น 'ฮีโร่=ตัวเอก, ขวาบน=คู่คนละคน, วงกลม=โมเมนต์ตัวเอก+คนอื่น'",

  "style": {
    "tone": "โทนสีรวม เช่น อุ่น/เย็น/ขาวดำ",
    "palette": ["สีเด่น 2-4 สีเป็น hex เช่น #E8C9A0"],
    "hasText": true/false, "textNote": "มีตัวหนังสือไหม อยู่ตรงไหน หรือ -",
    "effects": ["เอฟเฟกต์ที่เห็น เช่น feathered-seams, motion-blur, no-border, faces-fill, drop-shadow, วงกลมขอบขาว"],
    "retouch": "ลักษณะแต่งภาพ เช่น เนียน/คมกริบ/โทนเดียวกันทั้งใบ/-"
  },

  "emotion": "อารมณ์รวมของปก เช่น เศร้า/กตัญญู/ดีใจ/ช็อก",
  "compositionLogic": "ตรรกะการจัดวาง 1-2 ประโยค: ทำไมวางแบบนี้",
  "storyFlow": "ปกเล่าเรื่องยังไงใน 2 วินาที (ใคร→รู้สึก→ทำอะไร→บริบท→โมเมนต์/หลักฐาน)",

  "matchNewsType": ["แนวข่าวที่เหมาะ เช่น human-interest, ครอบครัว-ดราม่า, สูญเสีย, คดี, บันเทิง, กตัญญู"],
  "matchEmotion": ["อารมณ์ข่าวที่เข้ากับปกนี้"],
  "neededShots": ["ช็อตที่ข่าวต้องมีถึงจะทำปกแนวนี้ได้ เช่น 'ฮีโร่หน้าอารมณ์', 'ภาพคู่', 'โมเมนต์เหตุการณ์'"]
}
กฎ: slots ใน template ต้องรวม %แล้วเต็มปกพอดี (ช่องสี่เหลี่ยมไม่ทับกันนอกจากวงกลม/ช่องซ้อน zIndex สูง) · ประเมินให้ใกล้ภาพจริงที่สุด · ถ้าไม่เห็นชัดใส่ค่าที่ดีที่สุดเท่าที่ประเมินได้ อย่าเว้นว่าง`;

/**
 * ถอดชุดข้อมูลครบจากภาพปก (template ที่ render ได้ + layout + logic + style + match)
 * @param {string} dataUrl - data:image/...;base64,....
 * @returns {Promise<object>}
 */
export async function extractCoverDNA(dataUrl) {
  const res = await callAI({
    systemPrompt: SYSTEM,
    userPrompt: 'ถอดแบบปกนี้เป็นชุดข้อมูลครบตาม schema (รวม template พิกัด % ที่ render ได้จริง) — ตอบ JSON ล้วนเท่านั้น',
    imageContents: [{ type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }],
    model: 'gpt-4o',
    temperature: 0.2,
    maxTokens: 2500,
  });
  if (res && typeof res === 'object' && (res.layoutType || res.template || res.layout)) return res;
  const raw = typeof res === 'string' ? res : (res?.text || JSON.stringify(res || {}));
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('สกัด DNA ไม่สำเร็จ (AI ไม่ตอบ JSON)');
  return JSON.parse(m[0]);
}
