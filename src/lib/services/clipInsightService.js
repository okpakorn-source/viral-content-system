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
  "rawData": "ข้อมูลดิบรวมของข่าวนี้ เรียบเรียงเป็นย่อหน้าอ่านเข้าใจง่าย ข้อเท็จจริงล้วน ครบทุกประเด็น พร้อมให้คนอ่านเข้าใจว่าข่าวนี้คืออะไรแล้วเอาไปใช้ต่อเอง",
  "subStories": [{"topic": "ชื่อประเด็นนี้ (สั้น ชัดเจน)", "timeRange": "ช่วงเวลาในคลิป เช่น 2:12–4:40", "rawData": "ข้อมูลดิบเจาะลึกเฉพาะประเด็นนี้ — ข้อเท็จจริงล้วน ลึกและครบเท่า rawData รวม แต่โฟกัสประเด็นเดียว พร้อมเขียนเป็นข่าวเดี่ยวได้ทันที", "keyPoints": ["ข้อเท็จจริงสำคัญของประเด็นนี้"], "quotes": ["คำพูดตรงของประเด็นนี้"]}]
}`;

// ★ 25 มิ.ย. (ผู้ใช้สั่ง) — เนื้อดิบ "แยกประเด็น" เพิ่มจาก rawData รวม (ไม่ใช่แทน) สำหรับคลิปหลายประเด็น
// ★ 8 ก.ค.: เข้มขึ้น — สถิติคลังจริง subStories โผล่แค่ 12% ทั้งที่ 63% เป็นคลิปสัมภาษณ์/สนทนา
//   เปลี่ยนจาก "ให้โมเดลตัดสินเองหลวมๆ" → บังคับ "ไล่นับประเด็นก่อนเสมอ" แล้วค่อยตัดว่าอันไหนดีพอเป็นข่าว
const SUBSTORY_RULES = `★★ เนื้อดิบแยกประเด็น (subStories) — "เพิ่ม" จาก rawData รวม ไม่ใช่แทน:
ขั้นตอนบังคับ (ทำก่อนเขียนผลเสมอ): ไล่นับในใจว่าคลิปนี้คุยกี่เรื่อง/กี่หัวข้อ ตั้งแต่ต้นจนจบ
- คลิปที่ "ต้องพิจารณาแยกอย่างจริงจัง": รายการสัมภาษณ์ · ทอล์ก/พอดแคสต์ · คลิปยาวเกิน ~8 นาที · คลิปที่เล่าหลายเหตุการณ์
  → คลิปแบบนี้ปกติแยกได้ 2-6 ประเด็น — ถ้าดูจบแล้วจะไม่แยกเลย ต้องแน่ใจจริงๆ ว่าทั้งคลิปคือเรื่องเดียวต่อเนื่อง
  → เกณฑ์ "1 subStory" = ประเด็นที่หยิบไปเขียนเป็นข่าวเดี่ยว 1 ชิ้นได้ (มีเหตุการณ์/คำพูด/รายละเอียดของตัวเองพอ)
  → แต่ละ subStory.rawData ต้องลึกและครบ "เท่า rawData รวม" แต่โฟกัสประเด็นเดียว — พร้อมเขียนเป็นข่าวเดี่ยวได้ทันที (ห้ามสั้น/ห้ามสรุปลอยๆ)
  → จำนวนยืดหยุ่นตามคลิป — มีประเด็นดีจริงกี่อันใส่ตามนั้น ไม่ต้องฝืนให้ครบ ไม่จำกัดเพดาน
  → ข้ามช่วงที่ไม่ใช่ประเด็นข่าว (โฆษณา/สปอนเซอร์/พาชมเฉยๆ ที่ไม่มีแก่นข่าว)
- ⛔ ถ้าคลิปเป็น "เรื่องเดียวต่อเนื่องทั้งคลิป" จริงๆ (เช่น คลิปเหตุการณ์สั้นเหตุการณ์เดียว) → subStories = [] (เว้นว่าง)`;

// พรอมต์ "ดูคลิปทั้งเรื่อง → ข้อมูลดิบ" — ใช้ร่วมทั้งดูลิงก์ YouTube และดูไฟล์วิดีโอ (TikTok/FB)
const VIDEO_INSIGHT_PROMPT = `คุณเป็นบรรณาธิการข่าว ดู "คลิปนี้ทั้งคลิป" (ภาพ + เสียง) แล้วถอดประเด็นข่าวออกมาเป็น "ข้อมูลดิบ"

หน้าที่: ดูคลิปตั้งแต่ต้นจนจบ จับใจความว่าคลิปนี้ต้องการสื่อสารข่าวเรื่องอะไร เก็บทั้งเนื้อหา–คำพูด–บริบท แล้วสรุปเป็นข้อมูลดิบให้คนที่ "ยังไม่ได้ดูคลิป" อ่านแล้วเข้าใจว่าข่าวนี้คืออะไร

⚠️ คลิปอาจยาว (5-15 นาที) — ต้อง "ดูจนจบจริง" ครอบคลุมทุกช่วง ตั้งแต่ต้น–กลาง–ท้าย ห้ามสรุปแค่ช่วงต้นแล้วข้ามที่เหลือ ประเด็นสำคัญมักโผล่ช่วงกลาง/ท้ายด้วย
อ่านตัวหนังสือบนจอ (CG/ซับ/แคปชั่น/ป้ายชื่อ) ประกอบด้วย — คลิป TikTok/Reels มักมีตัวหนังสือบนจอที่บอกประเด็นข่าวสำคัญ ใช้ช่วยระบุชื่อคน/ตำแหน่ง/บริบท (แต่ถ้าไม่มีตัวหนังสือ/เสียงบอกชื่อ → ห้ามเดาชื่อเอง ตามกฎหลักฐานตัวตนด้านล่าง)

${INSIGHT_RULES}

${IDENTITY_RULES}

${SUBSTORY_RULES}

${INSIGHT_SCHEMA}`;

function normalizeInsight(p, engine) {
  const t = pickType(p.clipType);
  return {
    engine,
    clipType: t,
    clipTypeLabel: CLIP_TYPES[t].label,
    emoji: CLIP_TYPES[t].emoji,
    usageNote: CLIP_TYPES[t].note,
    // ★ 8 ก.ค.: หมวดเนื้อหา + ความยาวคลิป (metadata คลัง — เดิมว่างทุกเคสเพราะสคีมาวิดีโอไม่มีช่องนี้)
    category: String(p.category || 'อื่นๆ').slice(0, 30),
    clipDurationSec: Math.max(0, Number(p.clipDurationSec) || 0),
    speakers: Array.isArray(p.speakers) ? p.speakers.slice(0, 8).map(s => String(s).slice(0, 80)) : [],
    headline: String(p.headline || '').slice(0, 200),
    overview: String(p.overview || '').slice(0, 1500),
    keyPoints: Array.isArray(p.keyPoints) ? p.keyPoints.slice(0, 12).map(k => ({
      point: String(k?.point || k || '').slice(0, 200),
      detail: String(k?.detail || '').slice(0, 600),
    })).filter(k => k.point) : [],
    quotes: Array.isArray(p.quotes) ? p.quotes.slice(0, 12).map(q => String(q).slice(0, 400)).filter(Boolean) : [],
    timeline: Array.isArray(p.timeline) ? p.timeline.slice(0, 15).map(tl => ({
      time: String(tl?.time || '').slice(0, 40),
      topic: String(tl?.topic || '').slice(0, 200),
    })).filter(tl => tl.topic) : [],
    rawData: String(p.rawData || '').slice(0, 8000),
    // ★ 25 มิ.ย. — เนื้อดิบแยกประเด็น (เพิ่มจาก rawData รวม) — ว่างได้ถ้าคลิปเรื่องเดียว
    subStories: Array.isArray(p.subStories) ? p.subStories.slice(0, 8).map((s, i) => ({
      no: i + 1,
      topic: String(s?.topic || s?.title || '').slice(0, 200),
      timeRange: String(s?.timeRange || s?.time || '').slice(0, 40),
      rawData: String(s?.rawData || '').slice(0, 6000),
      keyPoints: Array.isArray(s?.keyPoints) ? s.keyPoints.slice(0, 12).map(k => String(k?.point || k || '').slice(0, 300)).filter(Boolean) : [],
      quotes: Array.isArray(s?.quotes) ? s.quotes.slice(0, 10).map(q => String(q).slice(0, 400)).filter(Boolean) : [],
    })).filter(s => s.topic && s.rawData) : [],
  };
}

/**
 * @param {object} args
 * @param {string} args.url       ลิงก์คลิป (ใช้ตอน platform='youtube' ให้ Gemini ดู)
 * @param {string} args.platform  'youtube' = Gemini ดูคลิป | อื่น = ใช้ rawText + LLM
 * @param {string} args.rawText   บทถอดเสียง (จำเป็นเมื่อไม่ใช่ youtube หรือ fallback)
 */
export async function extractClipInsight({ url, platform, rawText = '' }) {
  // YouTube → ให้ Gemini ดูคลิปจริงจากลิงก์ตรง — ปล่อย error ขึ้นไปให้ route จัดการ fallback
  if (platform === 'youtube') {
    const { callGeminiVideo } = await import('@/lib/ai/geminiClient');
    // ★ 21 มิ.ย.: 8000→16000 · ★ 25 มิ.ย.: 16000→24000 (เพิ่ม subStories) · ★ 8 ก.ค.: 24000→32000
    //   (พรอมต์ใหม่บังคับ rawData ละเอียดขึ้นมาก — เผื่อ output กัน JSON ถูกตัดท้าย = ต้นเหตุเคส rawData ว่างในคลัง)
    const r = await callGeminiVideo({ prompt: VIDEO_INSIGHT_PROMPT, youtubeUrl: url, maxTokens: 32000 });
    return normalizeInsight(r, 'gemini-video');
  }

  // TikTok/FB หรือ fallback → ใช้บทถอดเสียง + LLM
  const text = String(rawText || '').trim();
  if (text.length < 40) throw new Error('ไม่มีบทถอดให้วิเคราะห์ (คลิปอาจไม่มีเสียง/ถอดไม่ได้)');
  const prompt = `คุณเป็นบรรณาธิการข่าว อ่าน "บทถอดเสียงจากคลิป" ด้านล่าง แล้วถอดประเด็นข่าวออกมาเป็น "ข้อมูลดิบ"

หน้าที่: จับใจความว่าคลิปนี้สื่อสารข่าวเรื่องอะไร เก็บเนื้อหา–คำพูด–บริบท สรุปเป็นข้อมูลดิบให้คนอ่านเข้าใจว่าข่าวนี้คืออะไร

${INSIGHT_RULES}
(หมายเหตุ: นี่คือบทถอดเสียง อาจไม่มีไทม์สแตมป์ละเอียด — timeline/timeRange ใส่เป็นช่วง 'ช่วงต้น/กลาง/ท้าย' ตามลำดับเนื้อหาได้)

${IDENTITY_RULES}

${SUBSTORY_RULES}

=== บทถอดเสียง ===
${text.slice(0, 12000)}
=== จบ ===

${INSIGHT_SCHEMA}`;
  // ★ 26 มิ.ย.: ใช้ gpt-5.5 (ตัวเก่งสุด) ไม่ใช่ mini — fallback นี้ทำงานตอน Gemini แน่น
  //   ผู้ใช้ให้ความสำคัญคุณภาพข้อมูลดิบสูง → ยอมจ่ายแพงขึ้นในเส้นทางสำรอง (ใช้นานๆครั้ง) เพื่อคงคุณภาพ
  const r = await callAI({ prompt, model: MODEL_NEWS_ANALYSIS, temperature: 0.2, maxTokens: 8000 });
  const p = typeof r === 'object' ? r : JSON.parse(String(r).match(/\{[\s\S]*\}/)?.[0] || '{}');
  return normalizeInsight(p, 'transcript-llm');
}

/**
 * ★ ถอดประเด็นจาก "ไฟล์วิดีโอ" ที่โหลดมาเอง (TikTok/Reels/FB) — Gemini ดูคลิปจริงจากไฟล์
 * @param {Buffer} videoBuffer
 * @param {string} mimeType
 */
export async function extractInsightFromVideoBuffer(videoBuffer, mimeType = 'video/mp4') {
  const { callGeminiVideoFile } = await import('@/lib/ai/geminiClient');
  // ★ 8 ก.ค.: 24000→32000 — เท่าเส้นทางลิงก์ตรง (พรอมต์ละเอียดขึ้น กัน JSON ถูกตัดท้าย)
  const r = await callGeminiVideoFile({ prompt: VIDEO_INSIGHT_PROMPT, videoBuffer, mimeType, maxTokens: 32000 });
  return normalizeInsight(r, 'gemini-video');
}

// ════════════════════════════════════════════════════════════════════════════
// 🎙️ สมอง "เนื้อดิบมีมิติ" (23 ก.ค. 69) — รอบที่ 2 อิสระ 100% (ไม่แตะ extractClipInsight เดิม)
//   เป้า: Gemini 3.6 ดู/ฟังคลิป → ถอดคำพูดจริง (ไม่เอาเพลง) → "ถักทอ" คำพูดเข้ากับประเด็นข่าว
//         ออกมาเป็นเนื้อดิบผสมผสาน อ่านลื่น มีมิติ คุณภาพสูง (enrichedRaw = ตัวหลัก)
//   🔴 คิดแบบมนุษย์: ตัดสินก่อนว่ามีพูด/มีเพลงไหม · แยกพูดกับเพลง · ไม่ชัด=ติดป้ายไม่เดา · ประโยคเด็ดเลือกด้วยวิจารณญาณข่าว
//   ผู้ใช้สั่ง 23 ก.ค.: ไม่ใช่ถอดคำพูดแยก แต่ผสมคำพูดเข้าเนื้อประเด็นให้เนื้อดิบมีมิติน่าสนใจขึ้น
// ════════════════════════════════════════════════════════════════════════════
const TRANSCRIPT_QUOTES_SCHEMA = `ตอบ JSON เท่านั้น (ห้าม markdown):
{
  "hasSpeech": true/false (คลิปนี้มีคน "พูด" ไหม — ร้องเพลงล้วน/ภาพเงียบ = false),
  "hasSong": true/false (มีเพลง/ร้องเพลง/ดนตรีเด่นไหม),
  "transcript": "บทพูดจริงเรียงตามคลิป แยกผู้พูดด้วย [ชื่อ/บทบาท] ขึ้นบรรทัดใหม่เมื่อเปลี่ยนคนพูด — เฉพาะ 'คำพูด' เท่านั้น · ช่วงเพลงเขียน '[เพลง 1:20–1:45]' ไม่ถอดเนื้อเพลง · ไม่ชัด/พูดทับใส่ [ไม่ชัด] · ไม่มีคำพูด=สตริงว่าง",
  "punchyQuotes": [{"quote":"คำพูดเด็ดตรงคำ","speaker":"ใครพูด (ชื่อ/บทบาทตามหลักฐาน)","why":"ทำไมเด็ด/พลิกเกม เช่น จุดพีคอารมณ์ เปิดเผยครั้งแรก พาดหัวได้"}],
  "enrichedRaw": "★ ตัวหลัก — เนื้อดิบมีมิติ: เล่าข่าวเป็นย่อหน้า ถักทอข้อเท็จจริงเข้ากับ 'คำพูดจริง verbatim' ของคนในคลิป โดยต้องมีคำพูดจริงในเครื่องหมายคำพูดแทรกในเนื้ออย่างน้อย 3-5 จุด (ในจังหวะที่คำพูดเสริมพลังเรื่อง เช่น ...เจ้าตัวเปิดใจว่า \\"...\\" ...) — ไม่ใช่เล่าใจความล้วน · อ่านลื่น พร้อมเขียนข่าวต่อ · คำพูดตรงคำจากคลิปจริง ห้ามเรียบเรียงใหม่",
  "note": "หมายเหตุสั้นๆ ถ้ามี เช่น 'คลิปไม่มีคำพูด' 'เสียงบางช่วงไม่ชัด' 'พูดภาษาอังกฤษ' — ปกติเว้นว่าง"
}`;

const TRANSCRIPT_QUOTES_PROMPT = `คุณเป็นบรรณาธิการข่าว + คนถอดเทปมืออาชีพ ดู "คลิปนี้ทั้งคลิป" (ภาพ+เสียง) แล้วทำตามลำดับ

🧠 คิดแบบมนุษย์ที่ใช้เหตุผล (ทำตามลำดับ ห้ามข้าม):
ขั้น 1 — ฟังทั้งคลิปก่อนตัดสิน: คลิปนี้มี "คนพูด" ไหม? มี "เพลง/ร้องเพลง/ดนตรี" ไหม? (ตั้ง hasSpeech/hasSong)
ขั้น 2 — แยก "คำพูด" ออกจาก "เพลง":
   • มีทำนอง/บีต/ดนตรีคลอเป็นหลัก + ร้องเป็นเมโลดี้ = "เพลง" → ⛔ ห้ามถอดเนื้อเพลง เขียนแค่ '[เพลง ช่วงเวลา]'
   • น้ำเสียงสนทนา/เล่า/สัมภาษณ์/พากย์ = "คำพูด" → ถอด
   • แร็ป/พูดมีจังหวะที่เป็น "เนื้อหาข่าว" → ถอดได้ · เป็นท่อนเพลงจริง → ข้าม · ไม่แน่ใจ → ทำเครื่องหมายไว้
ขั้น 3 — ถอด "บทพูดจริง" (transcript): ตรงคำเท่าที่ได้ยิน แยกผู้พูด · ไม่ชัด/พูดทับ → [ไม่ชัด] ⛔ ห้ามเดาคำ
ขั้น 4 — เลือก "ประโยคเด็ด" (punchyQuotes) ด้วยวิจารณญาณข่าว: ประโยคแรง/สะเทือนใจ/เห็นภาพ/พาดหัวได้/พลิกเกมไวรัล + บอกใครพูด+ทำไมเด็ด (ไม่ใช่หยิบประโยคแรกๆ มั่ว)
ขั้น 5 — เขียน "เนื้อดิบมีมิติ" (enrichedRaw): เล่าเรื่องข่าวเป็นย่อหน้าที่อ่านลื่น มีมิติ คุณภาพสูง โดย 🔴 **ต้องยก "คำพูดจริง" (verbatim ในเครื่องหมายคำพูด) ของคนในคลิปมาแทรกในเนื้ออย่างน้อย 3-5 จุด** ในจังหวะที่คำพูดนั้นทำให้เรื่องมีพลัง/เห็นภาพ/สะเทือนใจ (เช่น ...เจ้าตัวเปิดใจว่า "…" ก่อนจะ...) — ⛔ ไม่ใช่เล่าแต่ใจความล้วน (ต้อง "เห็นคำพูดจริง" ในเนื้อ) และไม่ใช่แปะคำพูดกองไว้ท้าย · คำพูดที่ยกมาต้องตรงคำจากคลิป ห้ามเรียบเรียงใหม่

⛔ กฎเหล็ก:
- ข้อเท็จจริง+คำพูด มาจากคลิปจริงเท่านั้น ห้ามแต่งเติม/เดา
- คำพูดทุกช่อง = ตรงคำจากปากคนในคลิป (verbatim) ห้ามเรียบเรียงใหม่
- เนื้อเพลง = ห้ามถอดเด็ดขาด (ลิขสิทธิ์ + ไม่ใช่คำพูดข่าว)

${IDENTITY_RULES}

${TRANSCRIPT_QUOTES_SCHEMA}`;

function normalizeTranscriptQuotes(p) {
  return {
    hasSpeech: p?.hasSpeech !== false,
    hasSong: !!p?.hasSong,
    transcript: String(p?.transcript || '').slice(0, 12000),
    punchyQuotes: Array.isArray(p?.punchyQuotes) ? p.punchyQuotes.slice(0, 15).map(q => ({
      quote: String(q?.quote || '').slice(0, 400),
      speaker: String(q?.speaker || '').slice(0, 80),
      why: String(q?.why || '').slice(0, 200),
    })).filter(q => q.quote) : [],
    enrichedRaw: String(p?.enrichedRaw || '').slice(0, 10000),
    note: String(p?.note || '').slice(0, 300),
  };
}

/** ★ เนื้อดิบมีมิติ จากลิงก์ YouTube (Gemini ดูคลิปตรง) */
export async function extractTranscriptQuotes({ url }) {
  const { callGeminiVideo } = await import('@/lib/ai/geminiClient');
  const r = await callGeminiVideo({ prompt: TRANSCRIPT_QUOTES_PROMPT, youtubeUrl: url, maxTokens: 24000 });
  return normalizeTranscriptQuotes(r);
}

/** ★ เนื้อดิบมีมิติ จากไฟล์วิดีโอ (TikTok/FB/IG ที่โหลดมาแล้ว — ใช้ buffer ซ้ำจากรอบ insight) */
export async function extractTranscriptQuotesFromVideoBuffer(videoBuffer, mimeType = 'video/mp4') {
  const { callGeminiVideoFile } = await import('@/lib/ai/geminiClient');
  const r = await callGeminiVideoFile({ prompt: TRANSCRIPT_QUOTES_PROMPT, videoBuffer, mimeType, maxTokens: 24000 });
  return normalizeTranscriptQuotes(r);
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
  const topics = Array.isArray(p.topics) ? p.topics.slice(0, 50).map((t, i) => ({
    no: Number(t?.no) || (i + 1),
    title: String(t?.title || '').slice(0, 200),
    timeStart: String(t?.timeStart || '').slice(0, 20),
    timeEnd: String(t?.timeEnd || '').slice(0, 20),
    summary: String(t?.summary || '').slice(0, 1500),
    keyPoints: Array.isArray(t?.keyPoints) ? t.keyPoints.slice(0, 12).map(k => String(k?.point || k || '').slice(0, 300)).filter(Boolean) : [],
    quotes: Array.isArray(t?.quotes) ? t.quotes.slice(0, 10).map(q => String(q).slice(0, 400)).filter(Boolean) : [],
  })).filter(t => t.title || t.summary) : [];
  const ct = pickType(p.clipType);
  return {
    engine,
    multiTopic: true,
    clipType: ct,
    clipTypeLabel: CLIP_TYPES[ct].label,
    emoji: CLIP_TYPES[ct].emoji,
    usageNote: CLIP_TYPES[ct].note,
    headline: String(p.headline || '').slice(0, 200),
    overview: String(p.overview || '').slice(0, 1500),
    totalTopics: topics.length,
    topics,
  };
}

/** ★ คลิปยาว (ไฟล์วิดีโอ TikTok/FB/Reels) → แยกทุกประเด็น */
export async function extractMultiTopicFromVideoBuffer(videoBuffer, mimeType = 'video/mp4') {
  const { callGeminiVideoFile } = await import('@/lib/ai/geminiClient');
  const r = await callGeminiVideoFile({ prompt: VIDEO_MULTITOPIC_PROMPT, videoBuffer, mimeType, maxTokens: 24000 });
  return normalizeMultiTopic(r, 'gemini-video-multitopic');
}

/** ★ คลิปยาว (YouTube ลิงก์ตรง / fallback บทถอดเสียง) → แยกทุกประเด็น */
export async function extractMultiTopicInsight({ url, platform, rawText = '' }) {
  if (platform === 'youtube') {
    const { callGeminiVideo } = await import('@/lib/ai/geminiClient');
    const r = await callGeminiVideo({ prompt: VIDEO_MULTITOPIC_PROMPT, youtubeUrl: url, maxTokens: 24000 });
    return normalizeMultiTopic(r, 'gemini-video-multitopic');
  }
  const text = String(rawText || '').trim();
  if (text.length < 40) throw new Error('ไม่มีบทถอดให้วิเคราะห์ (คลิปอาจไม่มีเสียง/ถอดไม่ได้)');
  const prompt = `${VIDEO_MULTITOPIC_PROMPT}

=== บทถอดเสียงทั้งคลิป ===
${text.slice(0, 24000)}
=== จบ ===`;
  // ★ 26 มิ.ย.: gpt-5.5 (ตัวเก่งสุด) — fallback แตกหลายประเด็นต้องคุณภาพสูง เหมือนเส้นทางหลัก
  const r = await callAI({ prompt, model: MODEL_NEWS_ANALYSIS, temperature: 0.2, maxTokens: 8000 });
  const pp = typeof r === 'object' ? r : JSON.parse(String(r).match(/\{[\s\S]*\}/)?.[0] || '{}');
  return normalizeMultiTopic(pp, 'transcript-llm-multitopic');
}
