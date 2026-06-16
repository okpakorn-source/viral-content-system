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

ประเภท (เลือก 1):
- interview = บทสัมภาษณ์ (มีคนถาม–คนตอบ)
- monologue = พูดคนเดียว/เล่า/ระบายฝ่ายเดียว
- news_report = อ่านข่าว/ผู้ประกาศ/ผู้สื่อข่าวรายงาน
- conversation = สนทนาหลายคนคุยกัน
- other = อื่นๆ

${caption ? `แคปชั่น/ชื่อคลิป: ${caption}\n` : ''}=== บทถอดเสียง ===
${text.slice(0, 5000)}
=== จบ ===

ตอบ JSON: {
  "clipType": "interview|monologue|news_report|conversation|other",
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
  // YouTube → ให้ Gemini ดูคลิปจริง (ภาพ+เสียงทั้งคลิป) — ปล่อย error ขึ้นไปให้ route จัดการ fallback
  if (platform === 'youtube') {
    const { callGeminiVideo } = await import('@/lib/ai/geminiClient');
    const prompt = `คุณเป็นบรรณาธิการข่าว ดู "คลิปนี้ทั้งคลิป" (ภาพ + เสียง) แล้วถอดประเด็นข่าวออกมาเป็น "ข้อมูลดิบ"

หน้าที่: ดูคลิปตั้งแต่ต้นจนจบ จับใจความว่าคลิปนี้ต้องการสื่อสารข่าวเรื่องอะไร เก็บทั้งเนื้อหา–คำพูด–บริบท แล้วสรุปเป็นข้อมูลดิบให้คนที่ "ยังไม่ได้ดูคลิป" อ่านแล้วเข้าใจว่าข่าวนี้คืออะไร

${INSIGHT_RULES}

${INSIGHT_SCHEMA}`;
    const r = await callGeminiVideo({ prompt, youtubeUrl: url });
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
