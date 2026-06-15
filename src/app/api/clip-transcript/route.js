export const maxDuration = 300; // ถอดเสียงคลิปยาวใช้เวลา — 5 นาที
import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';
import { randomUUID } from 'crypto';
import { callAI } from '@/lib/ai/openai';
import { MODEL_FAST } from '@/lib/ai/modelConfig';

/**
 * Clip Transcript Extractor (15 มิ.ย. 69) — เครื่องถอดบทสัมภาษณ์จากคลิป (แยกจากเวิร์กโฟลว์ข่าว 100%)
 * จุดประสงค์: โยนลิงก์ TikTok/YouTube/Facebook → ได้บทพูด/บทสัมภาษณ์เป็น text → เก็บเข้าคลัง → คนหยิบไปเรียบเรียงเป็นข่าวเอง
 * ★ ไม่แตะคิว/worker/ไลน์เขียน — เรียกตัวถอดเสียง (cloud API) ตรงๆ
 * Body: { url, tidy?: boolean }  tidy=true → AI เรียบเรียงให้อ่านลื่น (ไม่สรุป ไม่ตัดเนื้อ แค่จัดลำดับ/ตัดคำซ้ำ)
 */
function detectClipType(url) {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/facebook\.com|fb\.watch|instagram\.com/i.test(url)) return 'meta';
  return null;
}

async function getRawTranscript(url, type) {
  if (type === 'youtube') {
    const { transcribeYoutube } = await import('@/lib/services/youtubeService');
    const r = await transcribeYoutube({ url });
    if (!r.success) throw new Error(`YouTube: ${r.error || 'ถอดไม่สำเร็จ'}`);
    return { text: r.transcript || r.text || '', caption: r.title || '' };
  }
  if (type === 'tiktok') {
    const { transcribeTiktok } = await import('@/lib/services/tiktokService');
    const r = await transcribeTiktok({ url });
    if (!r.success) throw new Error(`TikTok: ${r.error || 'ถอดไม่สำเร็จ'}`);
    return { text: r.rawText || r.text || '', caption: r.title || '' };
  }
  if (type === 'meta') {
    const { transcribeMetaReel } = await import('@/lib/services/metaReelsService');
    const r = await transcribeMetaReel({ url });
    if (!r.success) throw new Error(r.error || 'Facebook/IG ถอดได้เฉพาะบนเครื่องทีม (ใช้ yt-dlp)');
    return { text: r.rawText || r.text || '', caption: r.caption || '' };
  }
  throw new Error('ลิงก์ไม่รองรับ — ใช้ได้เฉพาะ TikTok / YouTube / Facebook(IG)');
}

export async function POST(request) {
  try {
    const { url, tidy = false } = await request.json();
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ success: false, error: 'กรุณาวางลิงก์คลิป', errorType: 'MISSING_URL' }, { status: 400 });
    }
    const type = detectClipType(url);
    if (!type) {
      return NextResponse.json({ success: false, error: 'ลิงก์ไม่รองรับ — ใช้ได้เฉพาะ TikTok / YouTube / Facebook(IG)', errorType: 'UNSUPPORTED_URL' }, { status: 400 });
    }

    console.log(`[ClipTranscript] ${type}: ${url.slice(0, 80)}`);
    const { text, caption } = await getRawTranscript(url, type);
    const rawText = String(text || '').trim();
    if (rawText.length < 40) {
      return NextResponse.json({ success: false, error: 'ถอดเสียงได้สั้นเกินไป — คลิปอาจไม่มีเสียงพูด หรือลิงก์ไม่ถูก', errorType: 'TRANSCRIPT_TOO_SHORT' }, { status: 422 });
    }

    // ★ ตัวเลือก: เรียบเรียงให้อ่านลื่น (บทสัมภาษณ์มักวับไปวนมา) — ไม่สรุป ไม่ตัดเนื้อหา แค่จัดลำดับ+ตัดคำซ้ำ/เสียงเอ้อ
    let tidyText = '';
    if (tidy) {
      try {
        const res = await callAI({
          model: MODEL_FAST, temperature: 0.2, maxTokens: 4000,
          prompt: `นี่คือบทถอดเสียงจากคลิปสัมภาษณ์ (ดิบ มักพูดวับไปวนมา มีคำซ้ำ/เสียงเอ้ออ้า)
จัดเรียงให้ "อ่านลื่นเป็นบทสนทนา/บทพูด" — กฎ:
- ห้ามสรุป ห้ามตัดใจความ ห้ามเติมข้อมูล — เก็บทุกประเด็นที่พูดไว้ครบ
- แค่จัดลำดับให้ต่อเนื่อง ตัดคำซ้ำ/เสียงเอ้ออ้า/คำฟุ่มเฟือยที่ไม่มีความหมาย
- ถ้ามีหลายคนพูด พยายามแยกผู้พูด (ผู้สัมภาษณ์/ผู้ให้สัมภาษณ์) ถ้าจับได้
- คงคำพูดสำคัญตามต้นฉบับ

=== บทถอดเสียงดิบ ===
${rawText.slice(0, 9000)}
=== จบ ===
ตอบ JSON: {"tidy":"บทที่จัดเรียงแล้ว"}`,
        });
        const parsed = typeof res === 'object' ? res : JSON.parse(String(res).match(/\{[\s\S]*\}/)?.[0] || '{}');
        tidyText = String(parsed.tidy || '').trim();
      } catch (e) { console.warn('[ClipTranscript] tidy ล้ม (คืนดิบ):', e.message?.slice(0, 50)); }
    }

    // ★ เก็บเข้าคลังอัตโนมัติ (fire-and-forget) — เก็บ 80 เคสล่าสุด
    const caseId = randomUUID();
    (async () => {
      try {
        const store = createStore('clip-transcripts');
        await store.add({
          id: caseId, url, platform: type, caption: String(caption || '').slice(0, 200),
          rawText: rawText.slice(0, 20000), tidyText: tidyText.slice(0, 20000),
          title: (caption || rawText).slice(0, 70), wordCount: rawText.length,
          createdAt: new Date().toISOString(),
        });
        const all = await store.getAll();
        if (all.length > 80) {
          const old = all.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(0, all.length - 80);
          for (const o of old) await store.remove(o.id).catch(() => {});
        }
      } catch (e) { console.warn('[ClipTranscript] เก็บคลังล้ม:', e.message?.slice(0, 50)); }
    })();

    return NextResponse.json({ success: true, data: { id: caseId, platform: type, caption, rawText, tidyText } });
  } catch (error) {
    console.error('[ClipTranscript]', error.message);
    return NextResponse.json({ success: false, error: error.message || 'ถอดเสียงล้มเหลว', errorType: 'TRANSCRIBE_ERROR' }, { status: 500 });
  }
}
