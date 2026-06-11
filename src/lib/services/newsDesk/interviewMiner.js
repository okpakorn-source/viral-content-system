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
  if (transcript.length < 80) throw new Error('ถอดเสียงได้สั้นเกินไป — คลิปอาจไม่มีเสียงพูด');

  // ขุดนาทีทอง — gpt-5.5 (reasoning ต้องมี headroom)
  const res = await callAI({
    prompt: `คุณคือบรรณาธิการเพจข่าวไวรัลไทย (แนวถนัด: เรื่องคนตัวเล็ก น้ำใจ กตัญญู บทสนทนาอบอุ่น/สะเทือนใจ)
นี่คือบทถอดเสียงจากคลิปสัมภาษณ์/รายการ:
${caption ? `แคปชันคลิป: ${caption.slice(0, 200)}\n` : ''}
=== บทถอดเสียง ===
${transcript.slice(0, 9000)}
=== จบบทถอดเสียง ===

หน้าที่:
1. หา "นาทีทอง" 1-3 จุด — ช่วงที่คนฟังแล้วต้องแชร์ (คำพูดสะเทือนใจ/ความจริงที่ไม่เคยพูด/ตัวเลขเจาะใจ/ประโยคสัจธรรม) — ยกคำพูดจริงจากบทถอดเสียงเท่านั้น ห้ามแต่ง
2. ตัดสินว่าคลิปนี้น่าเอามาทำโพสต์ไหม (0-10) ตามแนวเพจ
3. เขียน "โครงแคปชัน" สั้นๆ ให้นักเขียนเอาไปขยายต่อ: เปิดด้วยอะไร → เล่าอะไร → จบด้วยอะไร (ไม่ใช่แคปชันเต็ม)

ตอบ JSON เท่านั้น:
{"title":"หัวข้อข่าวสั้นจากคลิปนี้","speaker":"ใครพูด (ถ้ารู้)","score":0-10,"reason":"ทำไมน่าทำ/ไม่น่าทำ",
"category":"หมวด: น้ำใจ/ช่วยเหลือ|กตัญญู/ครอบครัวอบอุ่น|สู้ชีวิต|คนดังทำดี/ติดดิน|สัมภาษณ์/บทสนทนาดี|บันเทิงกระแส|ดราม่าสังคม|อื่นๆ",
"goldenMoments":[{"quote":"คำพูดจริงจากคลิป","why":"ทำไมแชร์ได้"}],
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
    title: String(parsed.title).slice(0, 140),
    snippet: (parsed.goldenMoments?.[0]?.quote || '').slice(0, 180),
    url,
    source: parsed.speaker ? `คลิป: ${String(parsed.speaker).slice(0, 40)}` : 'คลิปสัมภาษณ์',
    publishedAt: new Date().toISOString(),
    category: parsed.category || 'สัมภาษณ์/บทสนทนาดี',
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
      `คลิปสัมภาษณ์: ${parsed.title}`,
      parsed.speaker ? `ผู้พูด: ${parsed.speaker}` : '',
      caption ? `แคปชันคลิป: ${caption.slice(0, 300)}` : '',
      '',
      'นาทีทองที่ขุดได้:',
      ...(parsed.goldenMoments || []).map(g => `- "${g.quote}" (${g.why})`),
      '',
      `โครงเล่าที่แนะนำ: ${parsed.captionSkeleton || '-'}`,
      '',
      '=== บทถอดเสียงเต็ม ===',
      transcript.slice(0, 7000),
    ].filter(Boolean).join('\n'),
  };
}
