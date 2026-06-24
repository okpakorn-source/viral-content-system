/**
 * ★ Clip Insight Service (16 มิ.ย. 69) — สมองวิเคราะห์คลิป (แยกจากเวิร์กโฟลว์ข่าว 100%)
 *  1) classifyTranscript() — จำแนกประเภทคลิป (สัมภาษณ์/พูดเดี่ยว/อ่านข่าว/สนทนา) + ใครพูด
 *  2) extractClipInsight() — ถอด "ประเด็นข่าว → ข้อมูลดิบ"
 *     • YouTube → ให้ Gemini "ดูคลิปจริง" ทั้งภาพ+เสียง (callGeminiVideo)
 *     • TikTok/FB หรือ fallback → ใช้บทถอดเสียง + LLM อ่าน
 */
import { callAI } from '@/lib/ai/openai';
import { MODEL_FAST } from '@/lib/ai/modelConfig';

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
  "speakers": ["ชื่อ/บทบาทคนพูดที่ระบุได้จากเนื้อหา เช่น 'พิธีกร', 'น้องเบล (ผู้ถูกสัมภาษณ์)' — ไม่รู้ชื่อใส่บทบาท"],
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

// ── 2) ถอดประเด็นข่าว → ข้อมูลดิบ ──
const INSIGHT_RULES = `กฎเหล็ก:
- ⛔ ข้อเท็จจริงล้วน ห้ามแต่งเติม/เดา/ใส่ความเห็นตัวเอง — เอาเฉพาะที่มีในคลิปจริง
- คงชื่อ/ตัวเลข/วันที่/จำนวนเงิน ตรงเป๊ะ
- ระบุว่าใครพูดอะไร อย่าสลับเจ้าของคำพูด (สำคัญมากในคลิปสัมภาษณ์)
- timeline: ชี้ช่วงจังหวะที่คุยเรื่องสำคัญในคลิป
- ภาษาไทย เขียนกระชับ อ่านเข้าใจง่าย`;

const INSIGHT_SCHEMA = `ตอบ JSON เท่านั้น:
{
  "clipType": "interview|monologue|news_report|conversation|other",
  "speakers": ["ใครพูดบ้าง (ชื่อ/บทบาท)"],
  "headline": "ข่าวนี้เกี่ยวกับอะไร (1 ประโยค)",
  "overview": "ภาพรวมข่าวนี้คืออะไร 2-4 บรรทัด (ข้อเท็จจริง)",
  "keyPoints": [{"point": "ประเด็นสำคัญ", "detail": "รายละเอียด/บริบทของประเด็นนี้ (ข้อเท็จจริง)"}],
  "quotes": ["คำพูดสำคัญตรงจากคลิป (ใส่ชื่อคนพูดถ้ารู้)"],
  "timeline": [{"time": "ช่วงเวลาโดยประมาณ เช่น 0:00–2:30 หรือ 'ช่วงต้น'", "topic": "ช่วงนี้คุยเรื่องอะไร"}],
  "rawData": "ข้อมูลดิบรวมของข่าวนี้ เรียบเรียงเป็นย่อหน้าอ่านเข้าใจง่าย ข้อเท็จจริงล้วน ครบทุกประเด็น พร้อมให้คนอ่านเข้าใจว่าข่าวนี้คืออะไรแล้วเอาไปใช้ต่อเอง"
}`;

// พรอมต์ "ดูคลิปทั้งเรื่อง → ข้อมูลดิบ" — ใช้ร่วมทั้งดูลิงก์ YouTube และดูไฟล์วิดีโอ (TikTok/FB)
const VIDEO_INSIGHT_PROMPT = `คุณเป็นบรรณาธิการข่าว ดู "คลิปนี้ทั้งคลิป" (ภาพ + เสียง) แล้วถอดประเด็นข่าวออกมาเป็น "ข้อมูลดิบ"

หน้าที่: ดูคลิปตั้งแต่ต้นจนจบ จับใจความว่าคลิปนี้ต้องการสื่อสารข่าวเรื่องอะไร เก็บทั้งเนื้อหา–คำพูด–บริบท แล้วสรุปเป็นข้อมูลดิบให้คนที่ "ยังไม่ได้ดูคลิป" อ่านแล้วเข้าใจว่าข่าวนี้คืออะไร

⚠️ คลิปอาจยาว (5-15 นาที) — ต้อง "ดูจนจบจริง" ครอบคลุมทุกช่วง ตั้งแต่ต้น–กลาง–ท้าย ห้ามสรุปแค่ช่วงต้นแล้วข้ามที่เหลือ ประเด็นสำคัญมักโผล่ช่วงกลาง/ท้ายด้วย
อ่านตัวหนังสือบนจอ (CG/ซับ/แคปชั่น/ป้ายชื่อ) ประกอบด้วย — คลิป TikTok/Reels มักมีตัวหนังสือบนจอที่บอกประเด็นข่าวสำคัญ ใช้ช่วยระบุชื่อคน/ตำแหน่ง/บริบท

${INSIGHT_RULES}

${INSIGHT_SCHEMA}`;

function normalizeInsight(p, engine) {
  const t = pickType(p.clipType);
  return {
    engine,
    clipType: t,
    clipTypeLabel: CLIP_TYPES[t].label,
    emoji: CLIP_TYPES[t].emoji,
    usageNote: CLIP_TYPES[t].note,
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
    // ★ 21 มิ.ย.: 8000→16000 — คลิปรายการเล่าหลายข่าว 8 นาที output JSON ยาว เคยโดนตัดจน parse พัง
    const r = await callGeminiVideo({ prompt: VIDEO_INSIGHT_PROMPT, youtubeUrl: url, maxTokens: 16000 });
    return normalizeInsight(r, 'gemini-video');
  }

  // TikTok/FB หรือ fallback → ใช้บทถอดเสียง + LLM
  const text = String(rawText || '').trim();
  if (text.length < 40) throw new Error('ไม่มีบทถอดให้วิเคราะห์ (คลิปอาจไม่มีเสียง/ถอดไม่ได้)');
  const prompt = `คุณเป็นบรรณาธิการข่าว อ่าน "บทถอดเสียงจากคลิป" ด้านล่าง แล้วถอดประเด็นข่าวออกมาเป็น "ข้อมูลดิบ"

หน้าที่: จับใจความว่าคลิปนี้สื่อสารข่าวเรื่องอะไร เก็บเนื้อหา–คำพูด–บริบท สรุปเป็นข้อมูลดิบให้คนอ่านเข้าใจว่าข่าวนี้คืออะไร

${INSIGHT_RULES}
(หมายเหตุ: นี่คือบทถอดเสียง อาจไม่มีไทม์สแตมป์ละเอียด — timeline ใส่เป็นช่วง 'ช่วงต้น/กลาง/ท้าย' ตามลำดับเนื้อหาได้)

=== บทถอดเสียง ===
${text.slice(0, 9000)}
=== จบ ===

${INSIGHT_SCHEMA}`;
  const r = await callAI({ prompt, model: MODEL_FAST, temperature: 0.2, maxTokens: 5000 });
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
  const r = await callGeminiVideoFile({ prompt: VIDEO_INSIGHT_PROMPT, videoBuffer, mimeType });
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
- อ่านตัวหนังสือบนจอ (CG/ซับ/ป้ายชื่อ) ประกอบ — ระบุชื่อคน/ตำแหน่ง/บริบท
- ข้อเท็จจริงล้วน ไม่แต่งเติม ไม่เดา — ไม่ชัดให้บอกว่าไม่ชัด

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
  const r = await callAI({ prompt, model: MODEL_FAST, temperature: 0.2, maxTokens: 8000 });
  const pp = typeof r === 'object' ? r : JSON.parse(String(r).match(/\{[\s\S]*\}/)?.[0] || '{}');
  return normalizeMultiTopic(pp, 'transcript-llm-multitopic');
}
