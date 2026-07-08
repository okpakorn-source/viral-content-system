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
  let dna;
  if (res && typeof res === 'object' && (res.layoutType || res.template || res.layout)) dna = res;
  else {
    const raw = typeof res === 'string' ? res : (res?.text || JSON.stringify(res || {}));
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('สกัด DNA ไม่สำเร็จ (AI ไม่ตอบ JSON)');
    dna = JSON.parse(m[0]);
  }
  // ★ A1 rev.2 (8 ก.ค. ผู้ใช้ชี้เคส 733758476 — ขอบเบลอหลอกตา AI ควบ 2 ภาพเป็นช่องเดียว):
  //   pass วัดต้อง "นับภาพต้นฉบับที่แตกต่างกันก่อน" แล้วผูกเนื้อหาต่อช่อง (ตำแหน่ง/ใคร/ระยะช็อต/อารมณ์) ค่อยวัด %
  //   → ได้ทั้ง (1) จำนวนช่องแม่น (2) "ข้อมูลจัดวาง" ส่งให้ระบบทำปกจัดตาม ref ต่อช่องได้จริง
  //   ตรวจ: จำนวนช่อง = จำนวนภาพที่นับได้ · ไม่ตรง → retry 1 ครั้ง · ยังไม่ตรง → คง pass แรก + ติดธง _geometryMismatch (โชว์ในคลัง)
  const GEO_SYSTEM = `คุณคือช่างถอดแบบปกคอลลาจข่าวไวรัลไทย ทำ 2 ขั้นตามลำดับ ห้ามข้าม:

ขั้น 1 — นับ "ภาพต้นฉบับที่แตกต่างกัน" ทั้งหมดบนปก:
⚠️ ปกไวรัลไทยชอบเบลอรอยต่อ (feather) จนดูเหมือนภาพเดียว — ห้ามใช้เส้นขอบตัดสิน ให้ดู "เนื้อหา":
   คนละฉาก/คนละแสง/คนละมุมกล้อง/คนละโมเมนต์/คนละระยะซูม = คนละภาพ แม้ขอบกลืนกัน · คนเดียวกันโผล่หลายภาพได้
   นับรวมภาพในวงกลม/กรอบซ้อนด้วย · แจกแจงทีละภาพ: อยู่ตรงไหน (บนซ้าย/ล่างขวา/ซ้ายเต็มสูง/วงกลมกลาง/กรอบซ้อน) ใคร/อะไร ระยะช็อต อารมณ์

ขั้น 2 — วัดพิกัดแต่ละภาพเป็น % ของทั้งปก (0-100 จำนวนเต็ม):
1. 1 ช่อง = 1 ภาพต้นฉบับเป๊ะ — ห้ามควบ 2 ภาพที่ต่างกันเป็นช่องเดียวเด็ดขาด
2. รอยต่อเบลอ → วางเส้นแบ่งที่กึ่งกลางโซนเบลอ
3. ช่องสี่เหลี่ยมต่อกันเต็มปก 100% ไม่มีร่อง — ขอบช่องข้างเคียงเลขเดียวกัน ช่องริมชนขอบ (0/100)
4. วงกลม/กรอบซ้อน = shape:circle หรือ zIndex สูง ไม่นับในกฎข้อ 3
5. ทุกช่องระบุ border ตามจริง (สี/หนา % — ไม่มี = false)

ตอบ JSON เท่านั้น:
{"photoCount":<จำนวนภาพต้นฉบับทั้งหมดจากขั้น 1>,
 "slots":[{"role":"hero|reaction|action|context|victim|evidence|moment|pair","shape":"rect|circle",
   "xPct":0,"yPct":0,"wPct":50,"hPct":100,"zIndex":0,"border":false,"borderColor":"-","borderWidthPct":0,
   "pos":"บนซ้าย|ซ้ายเต็มสูง|บนขวา|ล่างขวา|วงกลมกลาง|...","subject":"ใคร/อะไรในภาพ","shot":"closeup|medium|wide","emotion":"อารมณ์","facing":"ตรง|ข้าง|-"}],
 "seamStyle":"edge-to-edge|gap|feather","featherPx":0}
กฎเหล็ก: slots.length ต้องเท่ากับ photoCount เป๊ะ (1 ภาพ = 1 ช่อง)`;
  try {
    const draft = JSON.stringify(dna.template || {}, null, 0).slice(0, 1200);
    const askGeo = async (extraNote) => {
      const geo = await callAI({
        systemPrompt: GEO_SYSTEM,
        userPrompt: `ร่างวัดรอบแรก (อาจนับภาพขาด/ควบภาพ — เริ่มนับใหม่จากภาพจริงตามขั้น 1 ก่อนเสมอ):\n${draft}${extraNote ? `\n\n⚠️ ${extraNote}` : ''}`,
        imageContents: [{ type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }],
        model: 'gpt-4o',
        temperature: 0.1,
        maxTokens: 1600,
      });
      if (geo && typeof geo === 'object' && Array.isArray(geo.slots)) return geo;
      const raw2 = typeof geo === 'string' ? geo : (geo?.text || '');
      const m2 = String(raw2).match(/\{[\s\S]*\}/);
      return m2 ? JSON.parse(m2[0]) : null;
    };
    const valid = (g) => Array.isArray(g?.slots) && g.slots.length >= 3
      && g.slots.length === Number(g.photoCount)
      && g.slots.every((s) => Number.isFinite(Number(s.xPct)) && Number.isFinite(Number(s.wPct)));
    let g = await askGeo();
    if (g && !valid(g)) {
      g = await askGeo(`รอบก่อนตอบ slots ${g.slots?.length ?? 0} ช่อง แต่ photoCount ${g.photoCount ?? '?'} — ไม่ตรงกัน นับใหม่ให้ละเอียด (ระวังภาพขอบเบลอที่ควบกัน) แล้วตอบให้ slots.length = photoCount เป๊ะ`);
    }
    if (g && valid(g)) {
      dna.template = { slots: g.slots, seamStyle: g.seamStyle || dna.template?.seamStyle || 'edge-to-edge', featherPx: Number(g.featherPx) || dna.template?.featherPx || 0 };
      dna.panelCount = g.slots.length; // จำนวนช่องจริง (S6 ตัดจำนวนภาพตามนี้)
      // 🎯 ข้อมูลจัดวาง 1:1 กับช่อง — ให้ slotDirector/Director จัดภาพตาม ref ต่อช่องได้จริง
      dna.slots = g.slots.map((s) => ({
        role: s.role, subject: s.subject || '', emotion: s.emotion || '', facing: s.facing || '-',
        pos: s.pos || '', shot: s.shot || '', desc: [s.pos, s.shot, s.subject].filter(Boolean).join(' · '),
      }));
      dna._geometryRefined = true;
      delete dna._geometryMismatch;
    } else if (g) {
      dna._geometryMismatch = `นับภาพ ${g.photoCount ?? '?'} แต่วัดได้ ${g.slots?.length ?? 0} ช่อง — ต้องตรวจด้วยตาคน`;
    }
  } catch { /* pass 2 ล้ม → template จาก pass แรก */ }
  return dna;
}
