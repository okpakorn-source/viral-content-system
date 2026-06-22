export const maxDuration = 300; // Gemini ดูคลิปทั้งเรื่อง — เผื่อเวลา
import { NextResponse } from 'next/server';
import { extractClipInsight, extractInsightFromVideoBuffer } from '@/lib/services/clipInsightService';
import { createStore } from '@/lib/persistStore';
import { randomUUID } from 'crypto';

// โหลดไฟล์วิดีโอ TikTok (tikwm) — ใช้บนคลาวด์ได้
async function downloadTiktokBuffer(url) {
  const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`);
  const data = await res.json();
  const playUrl = data?.data?.hdplay || data?.data?.play;
  if (!playUrl) throw new Error('tikwm: ไม่พบลิงก์วิดีโอ');
  const vres = await fetch(playUrl);
  const buf = Buffer.from(await vres.arrayBuffer());
  if (buf.length < 10000) throw new Error('วิดีโอเล็กเกินไป');
  if (buf.length > 150 * 1e6) throw new Error('วิดีโอใหญ่เกิน 150MB');
  return buf;
}

// โหลดไฟล์วิดีโอ Facebook/IG (yt-dlp) — เครื่องทีม Windows เท่านั้น
async function downloadMetaBuffer(url) {
  if (process.platform !== 'win32') throw new Error('Facebook/IG โหลดวิดีโอได้เฉพาะเครื่องทีม (Windows)');
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const { join } = await import('path');
  const { tmpdir } = await import('os');
  const { readFile, unlink } = await import('fs/promises');
  const { existsSync } = await import('fs');
  const execFileAsync = promisify(execFile);
  const exe = join(process.cwd(), 'bin', 'yt-dlp.exe');
  if (!existsSync(exe)) throw new Error('ไม่พบ bin/yt-dlp.exe');
  const cookies = join(process.cwd(), 'bin', 'cookies.txt');
  const out = join(tmpdir(), `meta_${Date.now()}.mp4`);
  const args = ['-f', 'mp4/best[ext=mp4]/best', '-o', out, '--no-warnings', '--no-playlist'];
  if (existsSync(cookies)) args.push('--cookies', cookies);
  args.push(url);
  try {
    await execFileAsync(exe, args, { maxBuffer: 1024 * 1024 * 20, timeout: 180_000 });
    if (!existsSync(out)) throw new Error('โหลดวิดีโอ Meta ไม่สำเร็จ');
    const buf = await readFile(out);
    if (buf.length < 10000) throw new Error('วิดีโอเล็กเกินไป');
    return buf;
  } finally { await unlink(out).catch(() => {}); }
}

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

// ★ 21 มิ.ย. (บั๊ก: URL ติด &fbclid=... ยาว → Gemini ดูคลิปไม่ได้): ล้าง URL ให้สะอาด
//   YouTube → ดึง video ID สร้าง watch URL ใหม่ (กันพารามิเตอร์เฟซบุ๊ก/ติดตามทำพัง) · อื่นๆ → ตัด tracking params
export function cleanClipUrl(raw) {
  const u = String(raw || '').trim();
  const yt = u.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (yt) return `https://www.youtube.com/watch?v=${yt[1]}`;
  try {
    const url = new URL(u);
    ['fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'si', 'feature', 'app_id', '_aem', 'mibextid'].forEach(p => url.searchParams.delete(p));
    return url.toString();
  } catch { return u.split('#')[0]; }
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
    const { url: _rawUrl } = await request.json();
    if (!_rawUrl || typeof _rawUrl !== 'string') {
      return NextResponse.json({ success: false, error: 'กรุณาวางลิงก์คลิป', errorType: 'MISSING_URL' }, { status: 400 });
    }
    const url = cleanClipUrl(_rawUrl); // ★ ล้าง fbclid/tracking ก่อน (กัน Gemini ดูคลิปพัง)
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
      // TikTok/FB/IG → ① โหลดวิดีโอให้ Gemini "ดูจริง" (เห็นภาพ+ตัวหนังสือบนจอ) ② ล้ม→ถอดเสียง+LLM
      let usedVideo = false;
      try {
        const buf = type === 'tiktok' ? await downloadTiktokBuffer(url) : await downloadMetaBuffer(url);
        insight = await extractInsightFromVideoBuffer(buf, 'video/mp4');
        usedVideo = true;
      } catch (vErr) {
        console.warn('[ClipInsight] Gemini ดูไฟล์วิดีโอล้ม → fallback ถอดเสียง:', vErr.message?.slice(0, 90));
      }
      if (!usedVideo) {
        const rawText = await transcribeFor(url, type);
        if (!rawText || rawText.length < 40) {
          return NextResponse.json({ success: false, error: 'ดูคลิป/ถอดเสียงไม่สำเร็จ — คลิปอาจไม่มีเสียง หรือ Facebook/IG ทำได้เฉพาะเครื่องทีม', errorType: 'CLIP_FAILED' }, { status: 422 });
        }
        insight = await extractClipInsight({ url, platform: 'transcript', rawText });
      }
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
