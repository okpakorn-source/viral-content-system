/**
 * ★ Clip Insight Service (16 มิ.ย. 69) — สมองวิเคราะห์คลิป (แยกจากเวิร์กโฟลว์ข่าว 100%)
 *  1) classifyTranscript() — จำแนกประเภทคลิป (สัมภาษณ์/พูดเดี่ยว/อ่านข่าว/สนทนา) + ใครพูด
 *  2) extractClipInsight() — ถอด "ประเด็นข่าว → ข้อมูลดิบ"
 *     • YouTube → ให้ Gemini "ดูคลิปจริง" ทั้งภาพ+เสียง (callGeminiVideo)
 *     • TikTok/FB หรือ fallback → ใช้บทถอดเสียง + LLM อ่าน
 */
import { callAI } from '@/lib/ai/openai';
import { MODEL_FAST, MODEL_NEWS_ANALYSIS } from '@/lib/ai/modelConfig';

// ป้ายประเภทคลิป + คำแนะนำการใช้ (ให้คนหยิบไปใช้รู้ว่าข้อมูลมาจากคลิปแบบไหน)
export const CLIP_TYPES = {
  interview: { label: 'บทสัมภาษณ์', emoji: '🎤', note: 'มีผู้ถาม–ผู้ตอบ → คำให้สัมภาษณ์เป็นของ "ผู้ถูกสัมภาษณ์" ระวังอย่าสลับว่าใครพูดประโยคไหน' },
  monologue: { label: 'พูดคนเดียว', emoji: '🗣️', note: 'คนพูด/เล่า/ระบายฝ่ายเดียว → ทั้งหมดเป็นมุมมองของคนพูดคนเดียว' },
  news_report: { label: 'อ่านข่าว/รายงาน', emoji: '📰', note: 'ผู้ประกาศ/ผู้สื่อข่าวรายงาน → เนื้อหาเป็นการเล่าข่าว ไม่ใช่คำพูดส่วนตัวของผู้ประกาศ' },
  conversation: { label: 'สนทนาหลายคน', emoji: '👥', note: 'หลายคนคุยกัน → ต้องดูบริบทว่าความเห็น/ข้อมูลแต่ละท่อนเป็นของใคร' },
  other: { label: 'อื่นๆ', emoji: '🎬', note: '' },
};

const pickType = (t) => (CLIP_TYPES[t] ? t : 'other');

export const CLIP_EDITORIAL_RAW_REV = 'clip-editorial-direct-lead-v7-0822';

// งานถอดคลิปไม่ retry โมเดลเดิม: 3.7 หนึ่งครั้ง → 3.6 หนึ่งครั้ง เฉพาะ provider ปฏิเสธ 429/503 แบบชัดเจน
// JSON เสีย, timeout, network ขาดกลางทาง หรือคุณภาพสำนวนไม่ดีจะไม่เรียกซ้ำ
const CLIP_VIDEO_INFERENCE_POLICY = Object.freeze({
  maxAttempts: 1,
  allowModelFallback: true,
  fallbackModels: Object.freeze(['gemini-3.6-flash']),
});

// การ A/B ที่ระบุ model เองต้องได้โมเดลนั้นจริง ห้ามแอบสลับเป็น 3.6
const clipVideoInferenceOptions = (model = '') => {
  const exactModel = String(model || '').trim();
  return exactModel
    ? { maxAttempts: 1, allowModelFallback: false, fallbackModels: [], model: exactModel }
    : CLIP_VIDEO_INFERENCE_POLICY;
};

// ── 1) จำแนกประเภทคลิป + ผู้พูด (เบา เร็ว ใช้บทถอด) ──
export async function classifyTranscript(rawText, caption = '') {
  const text = String(rawText || '').trim();
  if (text.length < 40) {
    return { clipType: 'other', clipTypeLabel: 'อื่นๆ', emoji: '🎬', speakerCount: 0, speakers: [], mainSpeaker: '', usageNote: '' };
  }
  const prompt = `อ่านบทถอดเสียงจากคลิปด้านล่าง แล้วจำแนกว่าเป็นคลิปประเภทไหน + ใครพูดบ้าง

ประเภทคลิป (เลือก 1):
- interview = บทสัมภาษณ์ (มีคนถาม–คนตอบ)
- monologue = พูดคนเดียว/เล่า/ระบายฝ่ายเดียว
- news_report = อ่านข่าว/ผู้ประกาศ/ผู้สื่อข่าวรายงาน
- conversation = สนทนาหลายคนคุยกัน
- other = อื่นๆ

หมวดเนื้อหา (เลือก 1 ให้ตรงสุด): บันเทิง/ดารา · กีฬา · สังคม/ชีวิตคน · น้ำใจ/ทำดี · ไลฟ์สไตล์/ไวรัล · การเมือง · อาชญากรรม/คดี · อื่นๆ

${caption ? `แคปชั่น/ชื่อคลิป: ${caption}\n` : ''}=== บทถอดเสียง ===
${text.slice(0, 5000)}
=== จบ ===

ตอบ JSON: {
  "clipType": "interview|monologue|news_report|conversation|other",
  "category": "หมวดเนื้อหา 1 หมวดจากรายการข้างบน",
  "speakerCount": จำนวนคนพูดโดยประมาณ (ตัวเลข),
  "speakers": ["ชื่อ/บทบาทคนพูดที่ระบุได้จากเนื้อหา เช่น 'พิธีกร', 'น้องเบล (ผู้ถูกสัมภาษณ์)' — ไม่รู้ชื่อใส่บทบาท ห้ามเดาชื่อที่ไม่ปรากฏในบทถอด"],
  "mainSpeaker": "ใครคือคนพูดหลัก/เจ้าของเรื่อง (ถ้ามี)"
}`;
  try {
    const res = await callAI({ prompt, model: MODEL_FAST, temperature: 0.1, maxTokens: 700 });
    const p = typeof res === 'object' ? res : JSON.parse(String(res).match(/\{[\s\S]*\}/)?.[0] || '{}');
    const t = pickType(p.clipType);
    return {
      clipType: t,
      clipTypeLabel: CLIP_TYPES[t].label,
      emoji: CLIP_TYPES[t].emoji,
      category: String(p.category || 'อื่นๆ').slice(0, 30), // ★ 21 มิ.ย.: หมวดเนื้อหา (แยกคลังให้ชัด)
      speakerCount: Number(p.speakerCount) || 0,
      speakers: Array.isArray(p.speakers) ? p.speakers.slice(0, 8).map(s => String(s).slice(0, 60)) : [],
      mainSpeaker: String(p.mainSpeaker || '').slice(0, 80),
      usageNote: CLIP_TYPES[t].note,
    };
  } catch (e) {
    console.warn('[ClipInsight] classify fail:', e.message?.slice(0, 50));
    return { clipType: 'other', clipTypeLabel: 'อื่นๆ', emoji: '🎬', speakerCount: 0, speakers: [], mainSpeaker: '', usageNote: '' };
  }
}

// ★ 16 ก.ค.: กฎหลักฐานตัวตน — แก้เคส AI มโนชื่อดารา/บุคคลจากการจำหน้า (คลิปไม่มีเสียงพูด/ป้ายชื่อ → เดาชื่อผิดคน)
//   ใช้ร่วมทุกเส้นทาง: ดูคลิปจริง (single+multitopic) และ fallback บทถอดเสียง
const IDENTITY_RULES = `★★ กฎหลักฐานตัวตน (ห้ามมโนชื่อคน — สำคัญมาก):
- ระบุ "ชื่อจริงของบุคคล" ได้เฉพาะเมื่อมีหลักฐานในคลิปเท่านั้น: มีคนเอ่ยชื่อในเสียง · ตัวหนังสือบนจอ (CG/ซับ/ป้ายชื่อ) · แคปชั่น/ชื่อคลิประบุชัด
- ✅ มีหลักฐานข้อใดข้อหนึ่งชัดเจน (เช่น พิธีกรแนะนำชื่อแขก, CG ขึ้นชื่อ-ตำแหน่ง) → ใส่ชื่อเต็มได้ตามปกติทันที ไม่ต้องกำกับอะไรเพิ่ม — กฎนี้ป้องกันเฉพาะการ "เดา/มโน" เท่านั้น
- ⛔ "จำหน้าได้/หน้าคล้ายดารา-คนดัง" ไม่นับเป็นหลักฐาน — ห้ามใส่ชื่อจากการจำหน้าเด็ดขาด (เสี่ยงผิดคน = ข่าวเสียหายจริง)
- ไม่มีหลักฐานชื่อ → ใช้คำกลางแทน เช่น "ชายในคลิป" "หญิงสาวในคลิป" "ผู้ถูกสัมภาษณ์" "เจ้าของร้าน"
- เห็นหน้าคล้ายคนดังแต่ไม่มีหลักฐานยืนยันในคลิป → เขียนได้อย่างมากแค่ "ลุคคล้าย..." และต้องกำกับ "(ไม่ยืนยันตัวตน)" ชัดๆ — ห้ามฟันธงเป็นชื่อคนนั้น
- อาชีพ/ตำแหน่ง/สังกัด ต้องมีหลักฐานในคลิปเช่นกัน — ห้ามเดาจากภาพลักษณ์/การแต่งตัว
- ห้ามเดาเพศจากชื่อหรือรูปลักษณ์ — ไม่แน่ใจให้เรียกชื่อ/บทบาท หรือใช้คำกลางว่า "เจ้าตัว"`;

// ── 2) ถอดประเด็นข่าว → ข้อมูลดิบ ──
const INSIGHT_RULES = `กฎเหล็ก:
- ⛔ ข้อเท็จจริงล้วน ห้ามแต่งเติม/เดา/ใส่ความเห็นตัวเอง — เอาเฉพาะที่มีในคลิปจริง
- คงชื่อ/ตัวเลข/วันที่/จำนวนเงิน ตรงเป๊ะ — ทุกตัวเลข/ชื่อ/จำนวนเงินที่ปรากฏในคลิป (พูดหรือขึ้นจอ) ต้องอยู่ใน rawData ห้ามตกหล่น
- ระบุว่าใครพูดอะไร อย่าสลับเจ้าของคำพูด (สำคัญมากในคลิปสัมภาษณ์)
- timeline: ชี้ช่วงจังหวะที่คุยเรื่องสำคัญในคลิป
- ภาษาไทย อ่านเข้าใจง่าย — "ละเอียดสำคัญกว่าสั้น" ห้ามย่อจนรายละเอียดหาย

★★ ความละเอียดของ rawData (สำคัญที่สุด — คนอ่านต้องเขียนข่าวได้โดยไม่ต้องดูคลิปเอง):
- คลิปสั้น (ต่ำกว่า ~2 นาที): 1-2 ย่อหน้าแน่นๆ (~600+ ตัวอักษร) เก็บทุกรายละเอียดที่เห็น/ได้ยิน
- คลิปกลาง (~2-8 นาที): 2-4 ย่อหน้า (~1,500+ ตัวอักษร) ไล่ตามลำดับเหตุการณ์ในคลิป
- คลิปยาว (เกิน ~8 นาที): 4-8 ย่อหน้า (~2,500+ ตัวอักษร) แบ่งย่อหน้าตามช่วงเนื้อหา ครอบต้น–กลาง–ท้ายครบ
- ทุกย่อหน้าต้องมี "เนื้อ" (ใคร ทำอะไร ที่ไหน เมื่อไหร่ เท่าไหร่ พูดว่าอะไร) ไม่ใช่สรุปลอยๆ
- ⚠️ ข้อยกเว้นสำคัญ: คลิปภาพเหตุการณ์ล้วน/ไม่มีคำพูด/เนื้อหาน้อยจริง → บรรยายเฉพาะที่เห็น-ได้ยินจริง สั้นกว่าเป้าได้ — ⛔ ห้ามยืดความยาวด้วยการแต่งเติม เดา หรือใส่ข้อมูลนอกคลิป

★★ quotes (คำพูดตรง = วัตถุดิบพาดหัวข่าว — เก็บให้มากที่สุด):
- คลิปสัมภาษณ์/พูดเดี่ยว/สนทนา: เก็บคำพูดเด็ดตรงจากปาก 5-10 ประโยค (ถ้ามีจริง) พร้อมชื่อ/บทบาทคนพูด
- เลือกประโยคที่ "แรง/สะเทือนใจ/เห็นภาพ/เป็นข่าวได้" — คำต่อคำ ห้ามเรียบเรียงใหม่
- คลิปไม่มีคำพูด (ภาพเหตุการณ์ล้วน) ปล่อยว่างได้ ไม่ต้องฝืน`;

const EDITORIAL_RAW_RULES = `★★ เนื้อดิบพร้อมส่งเข้าระบบข่าว (ใช้กับ rawData และ subStory.rawData ทุกก้อน):
- เนื้อดิบไม่ใช่บทถอดคำต่อคำและไม่ใช่สรุปรายการ ให้เริ่มที่เหตุการณ์หรือสาระข่าวทันที แล้วเรียงข้อเท็จจริงตามลำดับที่ทำให้คนอ่านเข้าใจง่าย
- ประโยคแรกต้องเริ่มด้วยข้อเท็จจริง เหตุการณ์ หรือใจความสำคัญของเจ้าตัวโดยตรง ห้ามเริ่มด้วยถ้อยคำเมตาว่าใคร “เปิดใจ” “ให้สัมภาษณ์” “เล่าถึง” หรือ “เผยเรื่องราว” แล้วค่อยเข้าสาระ แม้ต้นทางเป็นรายการสัมภาษณ์ก็ตาม
- ก่อนเขียน rawData ทุกก้อน ให้เขียน directLead เป็นประโยคเปิดพร้อมใช้ 1 ประโยค โดยเลือก “ข้อเท็จจริงหนึ่งก้อน” เช่น ความขัดแย้ง การกระทำ เหตุการณ์ หรือความรู้สึกที่เจ้าตัวพูดจริง แล้ว rawData ต้องเริ่มด้วย directLead เดิมแบบคำต่อคำ ก่อนเล่ารายละเอียดถัดไป
- directLead ห้ามทำหน้าที่เป็นสารบัญหรือประกาศว่าจะเล่าเรื่อง เช่น “เปิดเผยเส้นทางชีวิต” “เผยเรื่องราว” “ถ่ายทอดประสบการณ์” “ย้อนเล่าชีวิตตั้งแต่...ถึง...” ให้หยิบเหตุการณ์จริงหนึ่งจุดมาเปิดเลย แม้ rawData รวมจะครอบหลายช่วงชีวิตก็ตาม
- ตรวจไวยากรณ์ directLead ก่อนส่ง JSON: หลังชื่อบุคคล กริยาหลักต้องเป็นสิ่งที่บุคคล “ทำ/เจอ/รู้สึก/ตัดสินใจ” ในเรื่อง ห้ามเป็นกริยารายงานว่า เปิดใจ เปิดเผย เผย เล่า เล่าถึง ย้อนชีวิต ถ่ายทอด พูดถึง กล่าวถึง หรือให้สัมภาษณ์ หากเจอให้เขียน directLead ใหม่ภายในคำตอบรอบเดิม
- ตัวอย่างผิด → ถูก: “เอ็ม บุษราคัม เล่าถึงชีวิตในวัยเด็กที่ไม่ค่อยได้รับคำชม” → “เอ็ม บุษราคัม เติบโตมากับความรู้สึกว่าไม่ค่อยได้รับคำชมตรง ๆ จากพ่อ” · “เอ็มเผยประสบการณ์ถูกกลั่นแกล้ง” → “เอ็มเคยถูกเพื่อนกลั่นแกล้งและล้อเลียนในช่วงวัยเรียน”
- ตั้ง interviewEventIsNews = true ได้เฉพาะเมื่อ “การออกมาพูดครั้งนี้” เป็นเหตุการณ์ข่าวเองจริง เช่น พูดครั้งแรกหลังเงียบ ชี้แจง ยืนยัน ปฏิเสธ ขอโทษ แถลง หรือแก้ข่าว และ directLead ต้องบอกด้วยว่าชี้แจงหรือยืนยันเรื่องอะไร ห้ามตั้ง true เพียงเพราะต้นทางเป็นรายการสัมภาษณ์
- rawData และ subStory.rawData ห้ามเปิดด้วยกรอบว่าใครมาออกรายการ ให้สัมภาษณ์ช่องใด หรือพิธีกรถามว่าอะไร ให้เปิดด้วยคนและเหตุการณ์ของข่าวโดยตรง
- คำว่า “ให้สัมภาษณ์” “เปิดเผยในรายการ” “ผู้สื่อข่าวถาม” และคำบอกขั้นตอนสัมภาษณ์เป็นเพียงวิธีได้ข้อมูล ไม่ใช่ตัวข่าว ห้ามใช้เป็นคำเปิดหรือสะพานเชื่อม เว้นแต่การให้สัมภาษณ์เป็นเหตุการณ์ข่าวเอง ให้เปลี่ยนเป็นชื่อหรือบทบาทของเจ้าของข้อมูล แล้วเล่าสิ่งที่เขาบอกหรือยืนยันโดยตรง
- ตัดชื่อรายการ ชื่อช่อง ชื่อพิธีกร คำเกริ่นของผู้ดำเนินรายการ คำเอ้อ คำถามซ้ำ คำทักทาย คำโปรโมต สปอนเซอร์ คำชวนติดตาม และคำแนะนำทั่วไป เมื่อสิ่งนั้นไม่ใช่ตัวข่าว การรู้ว่าใครพูดให้ระบุเจ้าของข้อความตรงๆ โดยไม่ใช้ชื่อรายการหรือพิธีกรเป็นสะพานเล่า
- หากไม่ทราบชื่อผู้พูด ให้ใช้บทบาทในเรื่องที่คลิปยืนยันได้ เช่น “เพื่อนคนหนึ่งในกลุ่ม” หรือ “ผู้ร่วมเหตุการณ์” ห้ามบรรยายสีเสื้อ แว่นตา หรือตำแหน่งในภาพแทนชื่อ เว้นแต่จำเป็นจริงเพื่อแยกเจ้าของคำพูดและไม่มีข้อมูลอื่น
- เก็บชื่อรายการ/ช่อง/พิธีกร/โปรโมชันไว้เฉพาะเมื่อสิ่งนั้นเป็นตัวข่าว หรือจำเป็นจริงต่อการแยกว่าใครเป็นเจ้าของข้อเท็จจริง ถ้าจำเป็นให้กล่าวสั้นเพียงครั้งเดียวหลังข้อเท็จจริงแรก ห้ามใช้เป็นคำเปิดหรือคำเปรย
- ถ้าคลิปมีการเปิดตัวสินค้าหรือธุรกิจ ให้เก็บเฉพาะข้อเท็จจริงที่เป็นข่าว เช่น ใครร่วมธุรกิจ สินค้าคืออะไร และจุดเริ่มต้นที่คลิปยืนยัน ตัดราคาปกติ ราคาลด ของแถม ค่าส่ง ช่องทางสั่งซื้อ และคำเร่งขายออก เว้นแต่ราคา/โปรโมชันนั้นเป็นเหตุการณ์ข่าวหรือข้อพิพาทที่กำลังรายงานโดยตรง
- ทุกประโยคต้องเพิ่มข้อเท็จจริง บริบท หรือคำพูดสำคัญใหม่ ถ้าข้อมูลเดิมถูกพูดซ้ำให้รวมเป็นครั้งเดียว โดยห้ามทำชื่อ ตัวเลข วัน เวลา จำนวนเงิน สถานที่ เหตุและผล หรือลำดับที่คลิปยืนยันหาย
- คำพูดตรงที่เลือกไว้ใน quotes และสำคัญต่อข่าว ต้องวางรวมใน rawData ของประเด็นนั้นตรงจังหวะที่เกี่ยวข้องด้วย ให้ quotes เป็นหลักฐานสำรอง ไม่ใช่ที่เก็บข้อมูลสำคัญซึ่งหายไปจากเนื้อดิบ
- เกลาคำพูดติดขัดและคำซ้ำให้เป็นภาษาไทยธรรมชาติได้เมื่อความหมายชัดเจน เขียนประธาน–กริยาให้ชัด เลี่ยงภาษารายงานแข็งหรือประโยคซ้อนที่อ่านสะดุดเมื่อเขียนตรงและง่ายกว่าได้ แต่ห้ามเปลี่ยนความหมาย
- ตรวจทุกประโยคว่ามีความหมายและถูกไวยากรณ์ในบริบท ถ้าวลีจากเสียง/ซับเพี้ยน ขาดคำ ขัดกันเอง หรืออ่านแล้วไม่เป็นภาษาไทยธรรมชาติ ห้ามคัดลอกและห้ามซ่อมด้วยการเดา ให้ตัดเฉพาะวลีที่ไม่ชัดแล้วคงข้อเท็จจริงส่วนที่ฟังรู้เรื่องไว้ ส่วน quotes ให้เก็บเฉพาะประโยคที่ได้ยินครบและเข้าใจความหมายแน่นอน
- ก่อนตอบให้อ่าน rawData และแต่ละ subStory.rawData ต่อเนื่องอีกครั้ง แล้วตัดข้อเท็จจริงหรือวลีที่กล่าวซ้ำในก้อนเดียวกัน โดยเก็บรายละเอียดใหม่และคำพูดสำคัญไว้ครบ
- คลิปหลายประเด็นต้องแยกคน เหตุการณ์ คำพูด ตัวเลข และบริบทไว้ใน subStory ของเรื่องนั้น ห้ามนำคน คำพูด เหตุการณ์ หรือตัวเลขของคนละประเด็นมาปนกัน
- จบที่ข้อเท็จจริงหรือคำพูดสำคัญสุดท้ายของเรื่อง ไม่เติมบทสรุปสอนใจ คำแนะนำ หรือความเห็นของผู้เรียบเรียง`;

// ★ 15 ส.ค. 69 (เจ้าของสั่ง) — คืน "สมอความลึกแบบครบในตัวเอง" ให้ประเด็นย่อย (ของยุค 31 ก.ค. ที่หลุดไปตอนย้อนยุคนิ่ง 14 ส.ค. 499df17)
//   ปัญหาที่ย้อนกลับมา: สมอผูกความลึกประเด็นย่อยไว้กับเนื้อรวม ("ครบเท่า rawData รวม") → เนื้อรวมสั้นเมื่อไหร่ ประเด็นย่อยหดตามทันที
//   เกลาให้เข้ายุคปัจจุบัน (ไม่ใช่ยกของเก่ามาทั้งดุ้น): ยุคนี้ไม่มีกติกา "เขียนกระชับ" แล้ว มี "บันไดความยาวตามความยาวคลิป" แทน
//   → บรรทัดกันกฎลามจึงอ้างบันไดนั้นตรงๆ (ของเก่าอ้างกฎที่ถูกลบไปแล้ว = โมเดลอ่านแล้วไม่รู้ว่าหมายถึงอะไร)
//   ปิดคืนพรอมต์เดิมเป๊ะทุกตัวอักษร: CLIP_SUBSTORY_DEEP=0
const SUBSTORY_DEEP = process.env.CLIP_SUBSTORY_DEEP !== '0';

const SUBSTORY_SCHEMA_RAW = SUBSTORY_DEEP
  ? 'ข้อมูลดิบเจาะลึกเฉพาะประเด็นนี้ — ข้อเท็จจริงล้วน ลึกและครบในตัวเอง อ่านแล้วเข้าใจประเด็นนี้ได้ทั้งเรื่องโดยไม่ต้องดูคลิป (เก็บตัวเลข/จำนวนเงิน/คำพูดของประเด็นนี้ครบ) พร้อมเขียนเป็นข่าวเดี่ยวได้ทันที ห้ามย่อจนรายละเอียดหาย'
  : 'ข้อมูลดิบเจาะลึกเฉพาะประเด็นนี้ — ข้อเท็จจริงล้วน ลึกและครบเท่า rawData รวม แต่โฟกัสประเด็นเดียว พร้อมเขียนเป็นข่าวเดี่ยวได้ทันที';

const SUBSTORY_DEPTH_LINE = SUBSTORY_DEEP
  ? `  → แต่ละ subStory.rawData ต้อง "ลึกและครบในตัวเอง" — คนที่ยังไม่ได้ดูคลิปอ่านแล้วเข้าใจประเด็นนั้นได้ทั้งเรื่อง
    (ใคร–ทำอะไร–ที่ไหน–เมื่อไหร่–ผลลงเอยยังไง + ตัวเลข/จำนวนเงิน/คำพูดตรงของประเด็นนั้นครบทุกตัวที่มีในคลิป)
    พร้อมหยิบเขียนเป็นข่าวเดี่ยวได้ทันที — ห้ามสั้น/ห้ามสรุปลอยๆ/ห้ามย่อจนรายละเอียดของประเด็นหาย
    ★ บันไดความยาวตามความยาวคลิปด้านบนเป็นเกณฑ์ของ rawData รวมเท่านั้น — subStories แต่ละก้อนยาวได้เท่าที่เนื้อหาจริงของประเด็นนั้นมี ไม่ต้องหารความยาวกัน`
  : `  → แต่ละ subStory.rawData ต้องลึกและครบ "เท่า rawData รวม" แต่โฟกัสประเด็นเดียว — พร้อมเขียนเป็นข่าวเดี่ยวได้ทันที (ห้ามสั้น/ห้ามสรุปลอยๆ)`;

const INSIGHT_SCHEMA = `ตอบ JSON เท่านั้น:
{
  "clipType": "interview|monologue|news_report|conversation|other",
  "category": "หมวดเนื้อหา 1 หมวดที่ตรงสุด: บันเทิง/ดารา · กีฬา · สังคม/ชีวิตคน · น้ำใจ/ทำดี · ไลฟ์สไตล์/ไวรัล · การเมือง · อาชญากรรม/คดี · เศรษฐกิจ/ธุรกิจ · อื่นๆ",
  "clipDurationSec": ความยาวคลิปโดยประมาณเป็นวินาที (ตัวเลข เช่น 754),
  "speakers": ["ใครพูดบ้าง — ชื่อจริงเฉพาะที่มีหลักฐานในคลิป ไม่มีหลักฐานให้ใส่บทบาทแทน"],
  "headline": "ข่าวนี้เกี่ยวกับอะไร (1 ประโยค)",
  "overview": "ภาพรวมข่าวนี้คืออะไร 2-4 บรรทัด (ข้อเท็จจริง)",
  "keyPoints": [{"point": "ประเด็นสำคัญ", "detail": "รายละเอียด/บริบทของประเด็นนี้ (ข้อเท็จจริง)"}],
  "quotes": ["คำพูดสำคัญตรงจากคลิป (ใส่ชื่อคนพูดถ้ารู้)"],
  "timeline": [{"time": "ช่วงเวลาโดยประมาณ เช่น 0:00–2:30 หรือ 'ช่วงต้น'", "topic": "ช่วงนี้คุยเรื่องอะไร"}],
  "directLead": "ประโยคเปิดพร้อมใช้ 1 ประโยคที่เริ่มด้วยเนื้อข่าวจริง ไม่ใช่กรอบรายการหรือคำว่าเปิดใจ/ให้สัมภาษณ์",
  "interviewEventIsNews": false,
  "rawData": "ต้องเริ่มด้วย directLead เดิมแบบคำต่อคำ แล้วเรียบเรียงข้อมูลดิบรวมของข่าวนี้เป็นย่อหน้าอ่านเข้าใจง่าย ข้อเท็จจริงล้วน ครบทุกประเด็น พร้อมให้คนอ่านเข้าใจว่าข่าวนี้คืออะไรแล้วเอาไปใช้ต่อเอง",
  "subStories": [{"topic": "ชื่อประเด็นนี้ (สั้น ชัดเจน)", "timeRange": "ช่วงเวลาในคลิป เช่น 2:12–4:40", "directLead": "ประโยคเปิดพร้อมใช้ของประเด็นนี้", "interviewEventIsNews": false, "rawData": "ต้องเริ่มด้วย directLead เดิมแบบคำต่อคำ แล้วตามด้วย ${SUBSTORY_SCHEMA_RAW}", "keyPoints": ["ข้อเท็จจริงสำคัญของประเด็นนี้"], "quotes": ["คำพูดตรงของประเด็นนี้"]}]
}`;

// ★ 25 มิ.ย. (ผู้ใช้สั่ง) — เนื้อดิบ "แยกประเด็น" เพิ่มจาก rawData รวม (ไม่ใช่แทน) สำหรับคลิปหลายประเด็น
// ★ 8 ก.ค.: เข้มขึ้น — สถิติคลังจริง subStories โผล่แค่ 12% ทั้งที่ 63% เป็นคลิปสัมภาษณ์/สนทนา
//   เปลี่ยนจาก "ให้โมเดลตัดสินเองหลวมๆ" → บังคับ "ไล่นับประเด็นก่อนเสมอ" แล้วค่อยตัดว่าอันไหนดีพอเป็นข่าว
const SUBSTORY_RULES = `★★ เนื้อดิบแยกประเด็น (subStories) — "เพิ่ม" จาก rawData รวม ไม่ใช่แทน:
ขั้นตอนบังคับ (ทำก่อนเขียนผลเสมอ): ไล่นับในใจว่าคลิปนี้คุยกี่เรื่อง/กี่หัวข้อ ตั้งแต่ต้นจนจบ
- คลิปที่ "ต้องพิจารณาแยกอย่างจริงจัง": รายการสัมภาษณ์ · ทอล์ก/พอดแคสต์ · คลิปยาวเกิน ~8 นาที · คลิปที่เล่าหลายเหตุการณ์
  → คลิปแบบนี้ปกติแยกได้ 2-6 ประเด็น — ถ้าดูจบแล้วจะไม่แยกเลย ต้องแน่ใจจริงๆ ว่าทั้งคลิปคือเรื่องเดียวต่อเนื่อง
  → เกณฑ์ "1 subStory" = ประเด็นที่หยิบไปเขียนเป็นข่าวเดี่ยว 1 ชิ้นได้ (มีเหตุการณ์/คำพูด/รายละเอียดของตัวเองพอ)
${SUBSTORY_DEPTH_LINE}
  → จำนวนยืดหยุ่นตามคลิป — มีประเด็นดีจริงกี่อันใส่ตามนั้น ไม่ต้องฝืนให้ครบ ไม่จำกัดเพดาน
  → ข้ามช่วงที่ไม่ใช่ประเด็นข่าว (โฆษณา/สปอนเซอร์/พาชมเฉยๆ ที่ไม่มีแก่นข่าว)
- ⛔ ถ้าคลิปเป็น "เรื่องเดียวต่อเนื่องทั้งคลิป" จริงๆ (เช่น คลิปเหตุการณ์สั้นเหตุการณ์เดียว) → subStories = [] (เว้นว่าง)`;

// พรอมต์ "ดูคลิปทั้งเรื่อง → ข้อมูลดิบ" — ใช้ร่วมทั้งดูลิงก์ YouTube และดูไฟล์วิดีโอ (TikTok/FB)
const VIDEO_INSIGHT_PROMPT = `คุณเป็นบรรณาธิการข่าว ดู "คลิปนี้ทั้งคลิป" (ภาพ + เสียง) แล้วถอดประเด็นข่าวออกมาเป็น "ข้อมูลดิบ"

หน้าที่: ดูคลิปตั้งแต่ต้นจนจบ จับใจความว่าคลิปนี้ต้องการสื่อสารข่าวเรื่องอะไร เก็บทั้งเนื้อหา–คำพูด–บริบท แล้วสรุปเป็นข้อมูลดิบให้คนที่ "ยังไม่ได้ดูคลิป" อ่านแล้วเข้าใจว่าข่าวนี้คืออะไร

⚠️ คลิปอาจยาว (5-15 นาที) — ต้อง "ดูจนจบจริง" ครอบคลุมทุกช่วง ตั้งแต่ต้น–กลาง–ท้าย ห้ามสรุปแค่ช่วงต้นแล้วข้ามที่เหลือ ประเด็นสำคัญมักโผล่ช่วงกลาง/ท้ายด้วย
อ่านตัวหนังสือบนจอ (CG/ซับ/แคปชั่น/ป้ายชื่อ) ประกอบด้วย — คลิป TikTok/Reels มักมีตัวหนังสือบนจอที่บอกประเด็นข่าวสำคัญ ใช้ช่วยระบุชื่อคน/ตำแหน่ง/บริบท (แต่ถ้าไม่มีตัวหนังสือ/เสียงบอกชื่อ → ห้ามเดาชื่อเอง ตามกฎหลักฐานตัวตนด้านล่าง)

${INSIGHT_RULES}

${EDITORIAL_RAW_RULES}

${IDENTITY_RULES}

${SUBSTORY_RULES}

${INSIGHT_SCHEMA}`;

const DIRECT_LEAD_META_PATTERN = /(?:เปิดใจ|เปิดเผย|เผย|เล่า(?:ถึง)?|ย้อน(?:เล่า|ชีวิต|เส้นทาง)?|ถ่ายทอด|พูดถึง|กล่าวถึง|ให้สัมภาษณ์|มาเป็นแขกรับเชิญ|ร่วมพูดคุยในรายการ)/u;
const INTERVIEW_NEWS_EVENT_PATTERN = /(?:เป็นครั้งแรก|ครั้งแรกหลัง|หลัง(?:จาก)?เงียบ|ชี้แจง|ยืนยัน|ปฏิเสธ|ขอโทษ|แถลง|ประกาศ|ตอบโต้|แก้ข่าว|ยอมรับ|ถอนคำพูด|ยุติข่าวลือ)/u;
const usesInterviewFrameAtStart = (text) => {
  const match = String(text || '').trimStart().slice(0, 180).match(DIRECT_LEAD_META_PATTERN);
  return Boolean(match && Number(match.index) <= 48);
};

// ตรวจด้วยโค้ดล้วนหลัง inference เดิม: ไม่แก้ข้อความ ไม่บล็อกผล และไม่เรียก AI ซ้ำ
export function assessClipDirectLead({ directLead = '', rawData = '', interviewEventIsNews = false, label = 'ก้อนรวม' } = {}) {
  const lead = String(directLead || '').trim();
  const raw = String(rawData || '');
  if (!raw.trim()) return [];

  const warnings = [];
  if (!lead) {
    warnings.push(`${label}: ไม่มีประโยคเปิด directLead สำหรับตรวจ`);
    return warnings;
  }

  const opening = raw.trimStart().slice(0, 240);
  const rawStartsWithLead = raw.trimStart().startsWith(lead);
  const leadUsesInterviewFrame = usesInterviewFrameAtStart(lead);
  const openingUsesInterviewFrame = !rawStartsWithLead && usesInterviewFrameAtStart(opening);
  const hasConcreteInterviewEvent = INTERVIEW_NEWS_EVENT_PATTERN.test(lead.slice(0, 240));
  const interviewFrameAllowed = interviewEventIsNews === true && hasConcreteInterviewEvent;

  if ((leadUsesInterviewFrame || openingUsesInterviewFrame) && !interviewFrameAllowed) {
    warnings.push(`${label}: ประโยคเปิดยังเป็นคำเปรยหรือกรอบรายการ/สัมภาษณ์ ควรเปิดด้วยข้อเท็จจริงของข่าว`);
  }
  if (interviewEventIsNews === true && !hasConcreteInterviewEvent) {
    warnings.push(`${label}: ระบุว่าการให้สัมภาษณ์เป็นข่าว แต่ประโยคเปิดไม่มีเหตุการณ์ชี้แจงหรือยืนยันที่ชัดเจน`);
  }
  if (!rawStartsWithLead) {
    warnings.push(`${label}: เนื้อดิบไม่ได้เริ่มด้วย directLead ตามที่โมเดลส่งมา`);
  }
  return [...new Set(warnings)];
}

/**
 * ★ 25 ส.ค. 69 — ปลดเพดานตัดผลลัพธ์ (เจ้าของสั่ง: "ไม่จำกัดตัวอักษรหรือคำ เพื่อให้ได้ประเด็นครบจริง ไม่ย่อ")
 * ------------------------------------------------------------------
 * ที่มา: วัดคลังจริง 400 ใบ เพดานเดิมแทบไม่ถูกชน (2%) — **เพราะโมเดลเขียนสั้นอยู่แล้ว**
 *   แต่ทันทีที่สั่งให้เขียนละเอียด เพดานจะกัดทันที (เทสจริง: ได้คำพูด 39 ประโยค เพดานเดิม 12 = ตัดทิ้ง 27)
 * ตัวเลขชุด UNCAPPED ไม่ใช่ "ไม่จำกัด" แบบไร้ขอบ แต่เป็น **เพดานกันระบบพัง** ที่สูงเกินเนื้อจริงหลายสิบเท่า
 *   (กันกรณีโมเดลตอบพังเป็นลูปจนทำฐานข้อมูล/หน้าเว็บล่ม) — เนื้อข่าวจริงไม่มีทางแตะ
 * ถอยกลับพฤติกรรมเดิมเป๊ะทุกไบต์: ตั้ง env `CLIP_UNCAPPED=0`
 */
const UNCAPPED = process.env.CLIP_UNCAPPED !== '0';
const LIM = UNCAPPED ? {
  rawData: 200000, subRawData: 100000, overview: 20000, headline: 500, topic: 500,
  directLead: 3000, timeRange: 60, category: 100,
  keyPointsN: 200, keyPointText: 500, keyPointDetail: 5000,
  quotesN: 300, quoteText: 2000, subQuotesN: 200,
  timelineN: 300, timelineTime: 60, timelineTopic: 500,
  speakersN: 100, speakerName: 200,
  topicsN: 500, summary: 20000, transcriptIn: 400000, transcriptInLong: 400000,
} : {
  rawData: 8000, subRawData: 6000, overview: 1500, headline: 200, topic: 200,
  directLead: 500, timeRange: 40, category: 30,
  keyPointsN: 12, keyPointText: 200, keyPointDetail: 600,
  quotesN: 12, quoteText: 400, subQuotesN: 10,
  timelineN: 15, timelineTime: 40, timelineTopic: 200,
  speakersN: 8, speakerName: 80,
  topicsN: 50, summary: 1500, transcriptIn: 12000, transcriptInLong: 24000,
};

// เพดานคำตอบของโมเดล — ปลดคู่กับ LIM (เดิม 32000/8000 · reasoning model เพดานต่ำ = ตอบว่างเปล่า จึงต้องเผื่อ)
const VIDEO_MAX_TOKENS = UNCAPPED ? 65000 : 32000;
const TEXT_MAX_TOKENS = UNCAPPED ? 32000 : 8000;

/** ตัดข้อความพร้อม "ส่งเสียง" เมื่อตัดจริง — เดิมตัดเงียบ ไม่มีใครรู้ว่าเนื้อหาย */
function cut(value, max, what) {
  const s = String(value == null ? '' : value);
  if (s.length <= max) return s;
  try { console.warn(`[ClipInsight] ✂️ ตัด ${what}: ${s.length} → ${max} ตัวอักษร (เนื้อหาย ${s.length - max})`); } catch {}
  return s.slice(0, max);
}
/** ตัดจำนวนรายการพร้อมส่งเสียงเช่นกัน */
function cutList(arr, max, what) {
  const a = Array.isArray(arr) ? arr : [];
  if (a.length <= max) return a;
  try { console.warn(`[ClipInsight] ✂️ ตัด ${what}: ${a.length} → ${max} รายการ (หาย ${a.length - max})`); } catch {}
  return a.slice(0, max);
}

function normalizeInsight(p, engine) {
  const t = pickType(p.clipType);
  const directLead = cut(p.directLead, LIM.directLead, 'ประโยคเปิด');
  const interviewEventIsNews = p.interviewEventIsNews === true;
  const rawData = cut(p.rawData, LIM.rawData, 'เนื้อดิบรวม');
  const subStories = Array.isArray(p.subStories) ? p.subStories.map((s, i) => ({
    no: i + 1,
    topic: cut(s?.topic || s?.title, LIM.topic, 'ชื่อประเด็นย่อย'),
    timeRange: cut(s?.timeRange || s?.time, LIM.timeRange, 'ช่วงเวลาประเด็นย่อย'),
    directLead: cut(s?.directLead, LIM.directLead, 'ประโยคเปิดประเด็นย่อย'),
    interviewEventIsNews: s?.interviewEventIsNews === true,
    rawData: cut(s?.rawData, LIM.subRawData, `เนื้อประเด็นย่อยที่ ${i + 1}`),
    keyPoints: cutList(s?.keyPoints, LIM.keyPointsN, `ข้อสรุปประเด็นย่อยที่ ${i + 1}`).map(k => cut(k?.point || k, LIM.keyPointDetail, 'ข้อสรุป')).filter(Boolean),
    quotes: cutList(s?.quotes, LIM.subQuotesN, `คำพูดในประเด็นย่อยที่ ${i + 1}`).map(q => cut(q, LIM.quoteText, 'คำพูด')).filter(Boolean),
  })).filter(s => s.topic && s.rawData) : [];
  const editorialWarnings = [
    ...assessClipDirectLead({ directLead, rawData, interviewEventIsNews, label: 'ก้อนรวม' }),
    ...subStories.flatMap((story) => assessClipDirectLead({
      directLead: story.directLead,
      rawData: story.rawData,
      interviewEventIsNews: story.interviewEventIsNews,
      label: `ประเด็น ${story.no}`,
    })),
  ];
  return {
    engine,
    promptRev: CLIP_EDITORIAL_RAW_REV,
    clipType: t,
    clipTypeLabel: CLIP_TYPES[t].label,
    emoji: CLIP_TYPES[t].emoji,
    usageNote: CLIP_TYPES[t].note,
    // ★ 8 ก.ค.: หมวดเนื้อหา + ความยาวคลิป (metadata คลัง — เดิมว่างทุกเคสเพราะสคีมาวิดีโอไม่มีช่องนี้)
    category: cut(p.category || 'อื่นๆ', LIM.category, 'หมวด'),
    clipDurationSec: Math.max(0, Number(p.clipDurationSec) || 0),
    speakers: cutList(p.speakers, LIM.speakersN, 'รายชื่อผู้พูด').map(s => cut(s, LIM.speakerName, 'ชื่อผู้พูด')),
    headline: cut(p.headline, LIM.headline, 'พาดหัว'),
    overview: cut(p.overview, LIM.overview, 'ภาพรวม'),
    keyPoints: cutList(p.keyPoints, LIM.keyPointsN, 'ข้อสรุป').map(k => ({
      point: cut(k?.point || k, LIM.keyPointText, 'ข้อสรุป'),
      detail: cut(k?.detail, LIM.keyPointDetail, 'รายละเอียดข้อสรุป'),
    })).filter(k => k.point),
    quotes: cutList(p.quotes, LIM.quotesN, 'คำพูดรวม').map(q => cut(q, LIM.quoteText, 'คำพูด')).filter(Boolean),
    timeline: cutList(p.timeline, LIM.timelineN, 'แผนที่ประเด็น (timeline)').map(tl => ({
      time: cut(tl?.time, LIM.timelineTime, 'เวลาใน timeline'),
      topic: cut(tl?.topic, LIM.timelineTopic, 'หัวข้อใน timeline'),
    })).filter(tl => tl.topic),
    directLead,
    interviewEventIsNews,
    rawData,
    editorialWarnings: [...new Set(editorialWarnings)],
    // ★ 25 มิ.ย. — เนื้อดิบแยกประเด็น (เพิ่มจาก rawData รวม) — ว่างได้ถ้าคลิปเรื่องเดียว
    subStories,
  };
}

/**
 * @param {object} args
 * @param {string} args.url       ลิงก์คลิป (ใช้ตอน platform='youtube' ให้ Gemini ดู)
 * @param {string} args.platform  'youtube' = Gemini ดูคลิป | อื่น = ใช้ rawText + LLM
 * @param {string} args.rawText   บทถอดเสียง (จำเป็นเมื่อไม่ใช่ youtube หรือ fallback)
 */
// ★ 14 ส.ค. 69 (เจ้าของสั่งเทียบสองโมเดล): รับ model (optional) — ไม่ส่ง = ใช้ VIDEO_MODEL ตามเดิมเป๊ะ
export async function extractClipInsight({ url, platform, rawText = '', model = '' }) {
  // YouTube → ให้ Gemini ดูคลิปจริงจากลิงก์ตรง — ปล่อย error ขึ้นไปให้ route จัดการ fallback
  if (platform === 'youtube') {
    const { callGeminiVideo } = await import('@/lib/ai/geminiClient');
    // ★ 21 มิ.ย.: 8000→16000 · ★ 25 มิ.ย.: 16000→24000 (เพิ่ม subStories) · ★ 8 ก.ค.: 24000→32000
    //   (พรอมต์ใหม่บังคับ rawData ละเอียดขึ้นมาก — เผื่อ output กัน JSON ถูกตัดท้าย = ต้นเหตุเคส rawData ว่างในคลัง)
    const r = await callGeminiVideo({
      prompt: VIDEO_INSIGHT_PROMPT,
      youtubeUrl: url,
      maxTokens: VIDEO_MAX_TOKENS,
      ...clipVideoInferenceOptions(model),
    });
    return normalizeInsight(r, 'gemini-video');
  }

  // TikTok/FB หรือ fallback → ใช้บทถอดเสียง + LLM
  const text = String(rawText || '').trim();
  if (text.length < 40) throw new Error('ไม่มีบทถอดให้วิเคราะห์ (คลิปอาจไม่มีเสียง/ถอดไม่ได้)');
  const prompt = `คุณเป็นบรรณาธิการข่าว อ่าน "บทถอดเสียงจากคลิป" ด้านล่าง แล้วถอดประเด็นข่าวออกมาเป็น "ข้อมูลดิบ"

หน้าที่: จับใจความว่าคลิปนี้สื่อสารข่าวเรื่องอะไร เก็บเนื้อหา–คำพูด–บริบท สรุปเป็นข้อมูลดิบให้คนอ่านเข้าใจว่าข่าวนี้คืออะไร

${INSIGHT_RULES}
${EDITORIAL_RAW_RULES}
(หมายเหตุ: นี่คือบทถอดเสียง อาจไม่มีไทม์สแตมป์ละเอียด — timeline/timeRange ใส่เป็นช่วง 'ช่วงต้น/กลาง/ท้าย' ตามลำดับเนื้อหาได้)

${IDENTITY_RULES}

${SUBSTORY_RULES}

=== บทถอดเสียง ===
${cut(text, LIM.transcriptIn, "บทถอดเสียงขาเข้า")}
=== จบ ===

${INSIGHT_SCHEMA}`;
  // ★ 26 มิ.ย.: ใช้ gpt-5.5 (ตัวเก่งสุด) ไม่ใช่ mini — fallback นี้ทำงานตอน Gemini แน่น
  //   ผู้ใช้ให้ความสำคัญคุณภาพข้อมูลดิบสูง → ยอมจ่ายแพงขึ้นในเส้นทางสำรอง (ใช้นานๆครั้ง) เพื่อคงคุณภาพ
  const r = await callAI({ prompt, model: MODEL_NEWS_ANALYSIS, temperature: 0.2, maxTokens: TEXT_MAX_TOKENS });
  const p = typeof r === 'object' ? r : JSON.parse(String(r).match(/\{[\s\S]*\}/)?.[0] || '{}');
  return normalizeInsight(p, 'transcript-llm');
}

/**
 * ★ ถอดประเด็นจาก "ไฟล์วิดีโอ" ที่โหลดมาเอง (TikTok/Reels/FB) — Gemini ดูคลิปจริงจากไฟล์
 * @param {Buffer} videoBuffer
 * @param {string} mimeType
 */
export async function extractInsightFromVideoBuffer(videoBuffer, mimeType = 'video/mp4', model = '') {
  const { callGeminiVideoFile } = await import('@/lib/ai/geminiClient');
  // ★ 8 ก.ค.: 24000→32000 — เท่าเส้นทางลิงก์ตรง (พรอมต์ละเอียดขึ้น กัน JSON ถูกตัดท้าย)
  // ★ 14 ส.ค. 69: model (optional) — ไม่ส่ง = VIDEO_MODEL ตามเดิมเป๊ะ (ใช้เทียบสองโมเดลบนคลิปเดียวกัน)
  const r = await callGeminiVideoFile({
    prompt: VIDEO_INSIGHT_PROMPT,
    videoBuffer,
    mimeType,
    maxTokens: VIDEO_MAX_TOKENS,
    ...clipVideoInferenceOptions(model),
  });
  return normalizeInsight(r, 'gemini-video');
}

// ════════════════════════════════════════════════════════════════════════════
// 🧠 สมอง "คลิปยาว — แยกทุกประเด็น" (rev. 24 มิ.ย.) — แยกขาดจาก single-topic ด้านบน
//   ใช้กับรายการ/สัมภาษณ์ยาว (หลายสิบนาที-ชั่วโมง) ที่คุยหลายประเด็น → ถอด "ทุกประเด็น" + ช่วงเวลา
//   🔴 แก้เฉพาะส่วนนี้เวลาจูน multi-topic — ไม่กระทบ single-topic (คลิปสั้น) ที่ทำงานดีอยู่แล้ว
// ════════════════════════════════════════════════════════════════════════════
const MULTITOPIC_SCHEMA = `ตอบเป็น JSON เท่านั้น (ห้ามมี markdown):
{
  "headline": "ภาพรวมทั้งคลิปนี้คือรายการ/สัมภาษณ์อะไร (1 ประโยค)",
  "overview": "ภาพรวมว่าคลิปนี้คุยเรื่องอะไรบ้างโดยรวม 2-4 บรรทัด",
  "topics": [
    {
      "no": 1,
      "title": "ชื่อประเด็นนี้ (สั้น กระชับ ชัดเจน)",
      "timeStart": "เวลาเริ่มโดยประมาณ เช่น 0:00",
      "timeEnd": "เวลาจบโดยประมาณ เช่น 5:30",
      "summary": "สรุปประเด็นนี้ 2-4 บรรทัด ข้อเท็จจริงล้วน อ่านแล้วเข้าใจว่าช่วงนี้คุยอะไร",
      "keyPoints": ["ข้อเท็จจริง/ประเด็นย่อยสำคัญในช่วงนี้"],
      "quotes": ["คำพูดสำคัญตรงจากช่วงนี้ (ใส่ชื่อคนพูดถ้ารู้)"]
    }
  ]
}`;

const VIDEO_MULTITOPIC_PROMPT = `คุณเป็นบรรณาธิการข่าว ดู "คลิปยาวนี้ทั้งคลิป" (ภาพ+เสียง) ซึ่งเป็นรายการ/สัมภาษณ์ที่คุยหลายประเด็น

🎯 ภารกิจสำคัญที่สุด: คลิปนี้ "ยาวและมีหลายประเด็น" — ⛔ ห้ามเลือกมาแค่ประเด็นเดียวหรือบางช่วงเด็ดขาด!
ให้ไล่ดู "ตั้งแต่ต้นจนจบจริง" แล้ว "แยกออกเป็นทุกประเด็นที่คุยกัน" — ถอดได้กี่ประเด็นส่งมาให้ครบทุกประเด็น
(คลิปยาวปกติมี 3-15 ประเด็น บางทีมากกว่า — เก็บให้ครบ อย่าให้เสียโอกาส)

นิยาม "1 ประเด็น" = 1 เรื่อง/หัวข้อที่คุยต่อเนื่องช่วงหนึ่ง พร้อมช่วงเวลา (เริ่ม–จบ) โดยประมาณ

กฎ:
- เรียงตามลำดับเวลาในคลิป (ต้น→ท้าย) · ครอบคลุมทุกช่วง อย่าข้ามกลาง/ท้าย
- ทุกประเด็นต้องมี: title + ช่วงเวลา + สรุป + ข้อเท็จจริงสำคัญ + คำพูดเด่น (ถ้ามี)
- อ่านตัวหนังสือบนจอ (CG/ซับ/ป้ายชื่อ) ประกอบ — ระบุชื่อคน/ตำแหน่ง/บริบท (ไม่มีตัวหนังสือ/เสียงบอกชื่อ → ห้ามเดาชื่อ/ตำแหน่งเอง ตามกฎหลักฐานตัวตนด้านล่าง)
- ข้อเท็จจริงล้วน ไม่แต่งเติม ไม่เดา — ไม่ชัดให้บอกว่าไม่ชัด

${IDENTITY_RULES}

${MULTITOPIC_SCHEMA}`;

function normalizeMultiTopic(p, engine) {
  const topics = cutList(p.topics, LIM.topicsN, 'ประเด็น (โหมดคลิปยาว)').map((t, i) => ({
    no: Number(t?.no) || (i + 1),
    title: cut(t?.title, LIM.topic, 'ชื่อประเด็น'),
    timeStart: cut(t?.timeStart, LIM.timeRange, 'เวลาเริ่ม'),
    timeEnd: cut(t?.timeEnd, LIM.timeRange, 'เวลาจบ'),
    summary: cut(t?.summary, LIM.summary, `เนื้อประเด็นที่ ${i + 1}`),
    keyPoints: cutList(t?.keyPoints, LIM.keyPointsN, `ข้อสรุปประเด็นที่ ${i + 1}`).map(k => cut(k?.point || k, LIM.keyPointDetail, 'ข้อสรุป')).filter(Boolean),
    quotes: cutList(t?.quotes, LIM.subQuotesN, `คำพูดประเด็นที่ ${i + 1}`).map(q => cut(q, LIM.quoteText, 'คำพูด')).filter(Boolean),
  })).filter(t => t.title || t.summary);
  const ct = pickType(p.clipType);
  return {
    engine,
    multiTopic: true,
    clipType: ct,
    clipTypeLabel: CLIP_TYPES[ct].label,
    emoji: CLIP_TYPES[ct].emoji,
    usageNote: CLIP_TYPES[ct].note,
    headline: cut(p.headline, LIM.headline, 'พาดหัว'),
    overview: cut(p.overview, LIM.overview, 'ภาพรวม'),
    totalTopics: topics.length,
    topics,
  };
}

/** ★ คลิปยาว (ไฟล์วิดีโอ TikTok/FB/Reels) → แยกทุกประเด็น */
export async function extractMultiTopicFromVideoBuffer(videoBuffer, mimeType = 'video/mp4') {
  const { callGeminiVideoFile } = await import('@/lib/ai/geminiClient');
  const r = await callGeminiVideoFile({
    prompt: VIDEO_MULTITOPIC_PROMPT,
    videoBuffer,
    mimeType,
    maxTokens: 24000,
    ...CLIP_VIDEO_INFERENCE_POLICY,
  });
  return normalizeMultiTopic(r, 'gemini-video-multitopic');
}

/** ★ คลิปยาว (YouTube ลิงก์ตรง / fallback บทถอดเสียง) → แยกทุกประเด็น */
export async function extractMultiTopicInsight({ url, platform, rawText = '' }) {
  if (platform === 'youtube') {
    const { callGeminiVideo } = await import('@/lib/ai/geminiClient');
    const r = await callGeminiVideo({
      prompt: VIDEO_MULTITOPIC_PROMPT,
      youtubeUrl: url,
      maxTokens: 24000,
      ...CLIP_VIDEO_INFERENCE_POLICY,
    });
    return normalizeMultiTopic(r, 'gemini-video-multitopic');
  }
  const text = String(rawText || '').trim();
  if (text.length < 40) throw new Error('ไม่มีบทถอดให้วิเคราะห์ (คลิปอาจไม่มีเสียง/ถอดไม่ได้)');
  const prompt = `${VIDEO_MULTITOPIC_PROMPT}

=== บทถอดเสียงทั้งคลิป ===
${cut(text, LIM.transcriptInLong, "บทถอดเสียงขาเข้า (โหมดคลิปยาว)")}
=== จบ ===`;
  // ★ 26 มิ.ย.: gpt-5.5 (ตัวเก่งสุด) — fallback แตกหลายประเด็นต้องคุณภาพสูง เหมือนเส้นทางหลัก
  const r = await callAI({ prompt, model: MODEL_NEWS_ANALYSIS, temperature: 0.2, maxTokens: TEXT_MAX_TOKENS });
  const pp = typeof r === 'object' ? r : JSON.parse(String(r).match(/\{[\s\S]*\}/)?.[0] || '{}');
  return normalizeMultiTopic(pp, 'transcript-llm-multitopic');
}
