export const maxDuration = 300; // Gemini ดูคลิปทั้งเรื่อง — เผื่อเวลา
import { NextResponse } from 'next/server';
import { extractClipInsight } from '@/lib/services/clipInsightService';
import { createStore } from '@/lib/persistStore';
import { randomUUID } from 'crypto';

/**
 * POST /api/clip-transcript/insight (16 มิ.ย. 69) — ถอดประเด็นข่าวจากคลิป → "ข้อมูลดิบ"
 *  • YouTube → Gemini ดูคลิปจริง (ภาพ+เสียง) | ล้ม → fallback ถอดเสียง + LLM
 *  • TikTok/FB → ถอดเสียง + LLM
 * ★ แยกจากเวิร์กโฟลว์ข่าว 100% — เรียกตัววิเคราะห์ตรงๆ ไม่แตะคิว/worker/ไลน์เขียน
 */
function detectClipType(url) {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/facebook\.com|fb\.watch|instagram\.com/i.test(url)) return 'meta';
  return null;
}

async function transcribeFor(url, type) {
  if (type === 'youtube') {
    const { transcribeYoutube } = await import('@/lib/services/youtubeService');
    const r = await transcribeYoutube({ url });
    return r.success ? (r.rawText || r.text || '') : '';
  }
  if (type === 'tiktok') {
    const { transcribeTiktok } = await import('@/lib/services/tiktokService');
    const r = await transcribeTiktok({ url });
    return r.success ? (r.rawText || r.text || '') : '';
  }
  if (type === 'meta') {
    const { transcribeMetaReel } = await import('@/lib/services/metaReelsService');
    const r = await transcribeMetaReel({ url });
    return r.success ? (r.rawText || r.text || '') : '';
  }
  return '';
}

export async function POST(request) {
  try {
    const { url } = await request.json();
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ success: false, error: 'กรุณาวางลิงก์คลิป', errorType: 'MISSING_URL' }, { status: 400 });
    }
    const type = detectClipType(url);
    if (!type) {
      return NextResponse.json({ success: false, error: 'ลิงก์ไม่รองรับ — ใช้ได้เฉพาะ TikTok / YouTube / Facebook(IG)', errorType: 'UNSUPPORTED_URL' }, { status: 400 });
    }

    console.log(`[ClipInsight] ${type}: ${url.slice(0, 80)}`);
    let insight;

    if (type === 'youtube') {
      // ① ให้ Gemini ดูคลิปจริงก่อน
      try {
        insight = await extractClipInsight({ url, platform: 'youtube' });
      } catch (gErr) {
        // ② Gemini ดูไม่ได้ (คลิปส่วนตัว/รุ่นไม่รองรับ/เน็ต) → fallback ถอดเสียง + LLM
        console.warn('[ClipInsight] Gemini video ล้ม → fallback ถอดเสียง:', gErr.message?.slice(0, 80));
        const rawText = await transcribeFor(url, 'youtube');
        if (!rawText || rawText.length < 40) {
          return NextResponse.json({ success: false, error: `ดูคลิปด้วย Gemini ไม่ได้ และถอดเสียงสำรองก็ไม่สำเร็จ (${gErr.message?.slice(0, 60) || ''})`, errorType: 'INSIGHT_FAILED' }, { status: 422 });
        }
        insight = await extractClipInsight({ url, platform: 'transcript', rawText });
      }
    } else {
      // TikTok/FB → ถอดเสียงก่อน แล้ววิเคราะห์
      const rawText = await transcribeFor(url, type);
      if (!rawText || rawText.length < 40) {
        return NextResponse.json({ success: false, error: 'ถอดเสียงไม่สำเร็จ — คลิปอาจไม่มีเสียง หรือ Facebook/IG ถอดได้เฉพาะเครื่องทีม', errorType: 'TRANSCRIBE_FAILED' }, { status: 422 });
      }
      insight = await extractClipInsight({ url, platform: type, rawText });
    }

    // เก็บเข้าคลังประเด็น (fire-and-forget) — เก็บ 60 เคสล่าสุด
    const caseId = randomUUID();
    (async () => {
      try {
        const store = createStore('clip-insights');
        await store.add({
          id: caseId, url, platform: type,
          title: (insight.headline || insight.overview || url).slice(0, 80),
          insight, createdAt: new Date().toISOString(),
        });
        const all = await store.getAll();
        if (all.length > 60) {
          const old = all.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(0, all.length - 60);
          for (const o of old) await store.remove(o.id).catch(() => {});
        }
      } catch (e) { console.warn('[ClipInsight] เก็บคลังล้ม:', e.message?.slice(0, 50)); }
    })();

    return NextResponse.json({ success: true, data: { id: caseId, platform: type, ...insight } });
  } catch (error) {
    console.error('[ClipInsight]', error.message);
    return NextResponse.json({ success: false, error: error.message || 'ถอดประเด็นล้มเหลว', errorType: 'INSIGHT_ERROR' }, { status: 500 });
  }
}
