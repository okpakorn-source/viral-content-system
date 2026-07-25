/**
 * =====================================================
 * Interview Miner — เหมืองบทสัมภาษณ์ (News Desk เฟส 2)
 * =====================================================
 * โยนลิงก์คลิป (YouTube / FB Reel / TikTok) → ถอดเสียงด้วยเครื่องที่มีอยู่แล้ว
 * → gpt-5.5 ขุด "นาทีทอง" 1-3 จุด (ประโยคที่คนจะแชร์) + โครงแคปชันพร้อมเขียนต่อ
 * แก้ปัญหาจริงของทีม: สรุปบทสัมภาษณ์ 35 นาทีเป็นแคปชันกระชับ ทำได้แค่ 2-3 คนจาก 10
 * → ระบบบีบมาให้ พนักงานทุกคนเขียนต่อได้ไม่ออกทะเล
 */

import crypto from 'crypto';
import { callAI } from '@/lib/ai/openai';

const idOf = (url) => 'clip_' + crypto.createHash('md5').update(String(url)).digest('hex').slice(0, 10);

function detectClipType(url) {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/facebook\.com|fb\.watch|instagram\.com/i.test(url)) return 'meta';
  return null;
}

async function getTranscript(url, type) {
  if (type === 'youtube') {
    const { transcribeYoutube } = await import('@/lib/services/youtubeService');
    const r = await transcribeYoutube({ url });
    if (!r.success) throw new Error(`YouTube: ${r.error}`);
    return { text: r.transcript || r.text || '', caption: r.title || '' };
  }
  if (type === 'tiktok') {
    const { transcribeTiktok } = await import('@/lib/services/tiktokService');
    const r = await transcribeTiktok({ url });
    if (!r.success) throw new Error(`TikTok: ${r.error}`);
    return { text: r.rawText || r.text || '', caption: r.title || '' };
  }
  if (type === 'meta') {
    const { transcribeMetaReel } = await import('@/lib/services/metaReelsService');
    const r = await transcribeMetaReel({ url });
    if (!r.success) throw new Error(r.error);
    return { text: r.rawText || r.text || '', caption: r.caption || '' };
  }
  throw new Error('ลิงก์นี้ไม่ใช่คลิปที่รองรับ (YouTube / Facebook / IG / TikTok)');
}

/**
 * ขุดนาทีทองจากคลิปสัมภาษณ์ → คืน desk item พร้อมโครงแคปชัน
 */
export async function mineClip(url) {
  const type = detectClipType(url);
  if (!type) throw new Error('ลิงก์นี้ไม่ใช่คลิปที่รองรับ (YouTube / Facebook / IG / TikTok)');

  console.log(`[InterviewMiner] ⛏️ ${type}: ${url.slice(0, 80)}`);
  const { text, caption } = await getTranscript(url, type);
  const transcript = String(text || '').trim();
  // ★ 4 ก.ค. (โหมดทีมวางลิงก์เอง): รับคลิปน้ำดี "ทุกแบบ" — คลิปแอ็กชัน/พลเมืองดีมักพูดน้อย
  //   เดิมตัดที่ <80 ตัวอักษร = คลิปชาวบ้านโดนทิ้ง · ใหม่: มีแคปชันหรือบทพูดอย่างใดอย่างหนึ่งก็พอ
  if (transcript.length < 80 && String(caption || '').trim().length < 15) {
    throw new Error('คลิปนี้ไม่มีทั้งเสียงพูดและแคปชัน — ประเมินไม่ได้ ลองคลิปอื่น');
  }
  const hasSpeech = transcript.length >= 80;

  // ประเมิน+ขุด — gpt-5.5 (reasoning ต้องมี headroom)
  const res = await callAI({
    prompt: `คุณคือบรรณาธิการเพจข่าวไวรัลไทยน้ำดี (แนวถนัด: เรื่องคนตัวเล็ก/ชาวบ้าน น้ำใจ พลเมืองดี ช่วยเหลือ สู้ชีวิต กตัญญู สังคมด้านดี — ทีมวางลิงก์คลิปที่เจอมาให้ประเมิน)
${caption ? `แคปชัน/ชื่อคลิป: ${caption.slice(0, 300)}\n` : ''}${hasSpeech ? `=== บทถอดเสียง ===\n${transcript.slice(0, 9000)}\n=== จบบทถอดเสียง ===` : '(คลิปนี้พูดน้อย/ไม่มีเสียงพูด — ประเมินจากแคปชัน + สิ่งที่เห็นได้ว่าเกิดอะไรในคลิป)'}

หน้าที่:
1. สรุป "เรื่องราวในคลิป" — เกิดอะไรขึ้น ใครทำอะไร (ถ้าเป็นคลิปแอ็กชันพูดน้อย ให้บรรยายเหตุการณ์จากแคปชัน)
2. ${hasSpeech ? 'หา "นาทีทอง" 1-3 จุด — คำพูดจริงจากบทถอดเสียง (สะเทือนใจ/ตัวเลขเจาะใจ) ห้ามแต่ง' : 'ถ้ามีคำพูดเด่นในแคปชันยกมา ถ้าไม่มีเว้น goldenMoments ว่าง'}
3. ตัดสินว่าน่าเอามาทำโพสต์ไหม (0-10) — เรื่องคนจริงกินใจ/พลเมืองดี/สู้ชีวิต/ช่วยเหลือ = สูง · โปรโมท/ขายของ/ไร้ประเด็น = ต่ำ
4. เขียน "โครงแคปชัน" สั้นให้นักเขียนขยายต่อ

ตอบ JSON เท่านั้น:
{"title":"หัวข้อข่าวสั้นจากคลิปนี้","speaker":"ใคร/ตัวละครในคลิป (ถ้ารู้)","score":0-10,"reason":"ทำไมน่าทำ/ไม่น่าทำ",
"category":"หมวด: น้ำใจ/ช่วยเหลือ|กตัญญู/ครอบครัวอบอุ่น|สู้ชีวิต|คนดังทำดี/ติดดิน|สัมภาษณ์/บทสนทนาดี|บันเทิงกระแส|ดราม่าสังคม|อื่นๆ",
"goldenMoments":[{"quote":"คำพูด/ประเด็นเด่น","why":"ทำไมแชร์ได้"}],
"captionSkeleton":"เปิด: ... → กลาง: ... → จบ: ...",
"angles":["มุมเล่า 1","มุมเล่า 2"]}`,
    model: 'gpt-5.5',
    temperature: 0.2,
    maxTokens: 8000,
  });

  const parsed = typeof res === 'object' ? res : JSON.parse(String(res).match(/\{[\s\S]*\}/)?.[0] || '{}');
  if (!parsed?.title) throw new Error('AI ขุดนาทีทองไม่สำเร็จ — ลองใหม่อีกครั้ง');

  return {
    id: idOf(url),
    lane: 'interview',
    pastedByTeam: true, // ★ 4 ก.ค.: ทีมวางลิงก์เอง (แยกจากที่ระบบหาเจอ)
    title: String(parsed.title).slice(0, 140),
    snippet: (parsed.goldenMoments?.[0]?.quote || String(caption || '')).slice(0, 180),
    url,
    source: parsed.speaker ? `คลิป: ${String(parsed.speaker).slice(0, 40)}` : (caption ? 'คลิปที่ทีมวาง' : 'คลิปสัมภาษณ์'),
    publishedAt: new Date().toISOString(),
    category: parsed.category || 'น้ำใจ/ช่วยเหลือ',
    tone: 'บวก',
    toxicity: 0,
    fbRisk: 0,
    judgeScore: Math.min(10, Math.max(0, Number(parsed.score) || 5)),
    judgeReason: String(parsed.reason || '').slice(0, 140),
    angles: (parsed.angles || []).slice(0, 3).map(a => String(a).slice(0, 90)),
    goldenMoments: (parsed.goldenMoments || []).slice(0, 3).map(g => ({
      quote: String(g.quote || '').slice(0, 220),
      why: String(g.why || '').slice(0, 100),
    })),
    captionSkeleton: String(parsed.captionSkeleton || '').slice(0, 400),
    // เก็บบทถอดเสียงไว้ — ตอนส่งเข้า workflow จะส่งเนื้อเต็มนี้ ไม่ใช่ลิงก์ (writer ได้วัตถุดิบครบ)
    fullText: [
      `คลิป: ${parsed.title}`,
      parsed.speaker ? `ตัวละคร/ผู้พูด: ${parsed.speaker}` : '',
      caption ? `แคปชันคลิป: ${caption.slice(0, 300)}` : '',
      '',
      (parsed.goldenMoments || []).length ? 'ประเด็น/นาทีทอง:' : '',
      ...(parsed.goldenMoments || []).map(g => `- "${g.quote}" (${g.why})`),
      '',
      `โครงเล่าที่แนะนำ: ${parsed.captionSkeleton || '-'}`,
      hasSpeech ? '\n=== บทถอดเสียงเต็ม ===' : '',
      hasSpeech ? transcript.slice(0, 7000) : '',
    ].filter(Boolean).join('\n'),
  };
}
