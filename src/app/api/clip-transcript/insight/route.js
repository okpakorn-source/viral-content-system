export const maxDuration = 800; // ★ 25 มิ.ย.: 300→800 — Gemini retry ได้ 4×180s=720s เกิน 300 → Vercel ฆ่าฟังก์ชันกลางคัน คืน error page (text) ทำหน้าเว็บ parse JSON พัง "An error o..." (แพลนรองรับ 800 เท่า queue worker)
import { NextResponse } from 'next/server';
import { extractClipInsight, extractInsightFromVideoBuffer, extractMultiTopicInsight, extractMultiTopicFromVideoBuffer } from '@/lib/services/clipInsightService';
import { createStore } from '@/lib/persistStore';
import { getClipVideoQueue } from '@/lib/services/clipQueue';
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

// โหลดไฟล์วิดีโอ Facebook/IG/YouTube (yt-dlp) — เครื่องทีม Windows เท่านั้น
//   ★ 26 มิ.ย.: รับ fmt ได้ (YouTube ใช้ ≤480p กันไฟล์ใหญ่/อัปนาน · FB/IG ใช้ค่าเดิม)
async function downloadMetaBuffer(url, fmt) {
  if (process.platform !== 'win32') throw new Error('Facebook/IG/YouTube โหลดวิดีโอได้เฉพาะเครื่องทีม (Windows)');
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
  const args = ['-f', fmt || 'mp4/best[ext=mp4]/best', '-o', out, '--no-warnings', '--no-playlist'];
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

// ★ 24 มิ.ย.: หาความยาวคลิป (วินาที) ด้วย yt-dlp — ใช้ตัดสินใจ "คลิปยาว→แยกทุกประเด็น"
//   คืน 0 ถ้าหาไม่ได้ (ไม่มี yt-dlp/cloud) → ระบบจะใช้โหมด single (คลิปสั้น) เป็นค่าปลอดภัย ไม่ทำของเดิมพัง
async function getClipDurationSec(url) {
  try {
    if (process.platform !== 'win32') return 0;
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const { join } = await import('path');
    const { existsSync } = await import('fs');
    const execFileAsync = promisify(execFile);
    const exe = join(process.cwd(), 'bin', 'yt-dlp.exe');
    if (!existsSync(exe)) return 0;
    const cookies = join(process.cwd(), 'bin', 'cookies.txt');
    const args = ['--no-warnings', '--no-playlist', '--get-duration'];
    if (existsSync(cookies)) args.push('--cookies', cookies);
    args.push(url);
    const { stdout } = await execFileAsync(exe, args, { timeout: 60_000, maxBuffer: 1024 * 1024 });
    const line = String(stdout).trim().split('\n').filter(Boolean).pop() || '';
    const parts = line.trim().split(':').map(n => parseInt(n, 10));
    if (!parts.length || parts.some(isNaN)) return 0;
    let sec = 0; for (const n of parts) sec = sec * 60 + (n || 0);
    return sec;
  } catch { return 0; }
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

// ★ 22 มิ.ย.: แปลง error ดิบให้คนเข้าใจ — กรณี Gemini แน่นชั่วคราว (503) บอกให้กดใหม่ ไม่ใช่ "parse ไม่ได้" งงๆ
function humanizeErr(raw) {
  const m = String(raw || '');
  // ★ 25 มิ.ย.: แยก 2 กรณีให้ผู้ใช้รู้ — (ก) ระบบเรา timeout เอง (คลิปยาว/ช้า)  (ข) Gemini แน่นจริง
  // (ก) timeout/deadline = คลิปยาวเกินเวลาที่ตั้ง (ไม่ใช่ Gemini ล่ม) → บอกตรงๆ + ทางออก
  if (/deadline|timed out|timeout|ETIMEDOUT|aborted|\b504\b/i.test(m)) {
    return 'คลิปนี้ยาว/ประมวลผลนานเกินเวลาที่ตั้งไว้ (ระบบขยายเวลาเป็น ~4.5 นาทีแล้ว) — ลองกด "ถอดประเด็นข่าว" อีกครั้ง · ถ้าคลิปยาวมาก (เกิน ~15 นาที) แนะนำกด "ส่งเข้าคิว (เครื่องทีม)" ที่ให้เวลานานกว่า';
  }
  // (ข2) Gemini เปิดดูคลิปไม่ได้จริง (ส่วนตัว/จำกัดอายุ/ลิงก์เสีย) — กดใหม่ไม่ช่วย
  if (/ดูคลิปไม่ได้|ส่วนตัว|private|age.?restrict|จำกัดอายุ|unsupported|ไม่ส่งข้อมูล/i.test(m)) {
    return 'Gemini เปิดดูคลิปนี้ไม่ได้ (อาจเป็นคลิปส่วนตัว/จำกัดอายุ/ลิงก์มีปัญหา) — ลองเช็คว่าคลิปเปิดสาธารณะ หรือใช้คลิปอื่น';
  }
  // (ข) Gemini แน่น/ล่มชั่วคราว (503/429/overload) → รอแล้วกดใหม่ (ระบบใช้ Gemini ดูคลิปจริงเท่านั้น เพื่อคุณภาพสูงสุด)
  //   ★ 26 มิ.ย. (ผู้ใช้สั่ง): ไม่ถอย fallback OpenAI — รอ Gemini ดูคลิปจริงดีกว่า (ข้อมูลดิบดีกว่ามาก)
  if (/503|429|high demand|overload|unavailable|temporar|rate limit|parse ไม่ได้/i.test(m)) {
    return 'ตอนนี้ Gemini มีคนใช้งานหนัก (แน่นชั่วคราว) — กดปุ่ม "ถอดประเด็นข่าว" อีกครั้งได้เลย เดี๋ยวก็ผ่าน (ระบบรอ Gemini ดูคลิปจริงเพื่อข้อมูลดิบคุณภาพสูงสุด ไม่ถอยไปสรุปจากเสียงล้วน)';
  }
  return m.slice(0, 120) || 'ถอดประเด็นล้มเหลว';
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

// ★ 22 มิ.ย.: รวมตรรกะสกัด "ข้อมูลดิบ" ไว้ในฟังก์ชันเดียว (ดูคลิป→fallback ถอดเสียง) — โยน error ที่มี .code
//   เพื่อให้ห่อด้วยคิวได้สะอาด (ไม่ปน NextResponse กับงานหนัก)
// ★ 26 มิ.ย.: ตัดเวลา promise — กัน YouTube URL passthrough ค้างนาน (Gemini โหลด YouTube ไม่ได้) → รีบสลับเส้นทาง
function _raceTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => { const e = new Error(`${label} ค้างเกิน ${Math.round(ms / 1000)} วิ`); e.code = 'URL_TIMEOUT'; rej(e); }, ms)),
  ]);
}

async function buildInsight({ url, type }) {
  // ★ 25 มิ.ย.: ใช้ insight เดียว (enhanced) เสมอ — Gemini "ตัดสินเอง" (content-aware) ว่าคลิปมีหลายประเด็นไหม
  //   มีหลายประเด็น → ใส่ subStories (เนื้อดิบแยกประเด็น) เพิ่มจาก rawData รวม · เรื่องเดียว → subStories ว่าง
  //   เลิกพึ่ง getClipDurationSec (ยึด yt-dlp = พังบนคลาวด์ → เคยได้ single เสมอ) — ตอนนี้ทำงานทั้ง cloud+โลคัล
  // ★ 26 มิ.ย. (ผู้ใช้สั่ง): ใช้ "Gemini ดูคลิปจริง" เท่านั้น — ปิด fallback ถอดเสียง+OpenAI
  //   เหตุผล: Gemini ดูคลิป (เห็นภาพ+ตัวหนังสือบนจอ+ฟังเสียง) ถอดข้อมูลดิบมีประสิทธิภาพกว่ามาก
  //   ถ้า Gemini แน่น → โยน error ให้ผู้ใช้ "รอ/กดใหม่" ดีกว่าได้ผลด้อยจาก transcript ล้วน
  //   (ฟังก์ชัน transcript ยังอยู่ในโค้ด เผื่อเปิดใช้ภายหลัง — แค่ไม่เรียกในเส้นทาง insight)
  if (type === 'youtube') {
    // ★ 26 มิ.ย. (ผู้ใช้สั่ง): YouTube ไฮบริด — ลอง "ให้ Gemini โหลด URL เอง" ก่อน (เร็ว ใช้ได้ทั้ง cloud + เมื่อ Google ปกติ)
    //   ถ้าค้าง/ล้ม (Gemini โหลด YouTube ไม่ได้ — เคสจริง 26 มิ.ย. ค้าง >50 วิ ทั้งที่ model ขึ้น) + อยู่เครื่องทีม (win32 มี yt-dlp)
    //   → สลับมา "โหลดเอง + อัปไฟล์ให้ Gemini" เหมือน TikTok/FB/IG ที่ใช้ได้อยู่ (คุณภาพเท่าเดิม Gemini ดูวิดีโอจริง)
    try {
      return await _raceTimeout(extractClipInsight({ url, platform: 'youtube' }), 170_000, 'YouTube URL passthrough');
    } catch (e) {
      if (process.platform !== 'win32') throw e; // บน cloud ไม่มี yt-dlp → โยน error เดิม (ผู้ใช้ส่งเข้าคิวเครื่องทีมแทน)
      console.log(`[ClipInsight] 🔄 YouTube URL ล้ม/ค้าง → สลับโหลดเอง (yt-dlp): ${String(e.message).slice(0, 70)}`);
      const buf = await downloadMetaBuffer(url, 'best[height<=480][ext=mp4]/best[height<=480]/best[ext=mp4]/best');
      return await extractInsightFromVideoBuffer(buf, 'video/mp4');
    }
  }
  // TikTok/FB/IG → โหลดไฟล์ให้ Gemini "ดูจริง" (เห็นภาพ+ตัวหนังสือบนจอ) — ไม่มี fallback ถอดเสียง
  const buf = type === 'tiktok' ? await downloadTiktokBuffer(url) : await downloadMetaBuffer(url);
  return await extractInsightFromVideoBuffer(buf, 'video/mp4');
}

// ★ (เลิกใช้ชั่วคราว 26 มิ.ย. — เก็บไว้เผื่อเปิด fallback ถอดเสียงภายหลัง)
async function _buildInsightTranscriptFallback({ url, type }) {
  const rawText = await transcribeFor(url, type);
  if (!rawText || rawText.length < 40) {
    const e = new Error('ดูคลิป/ถอดเสียงไม่สำเร็จ — คลิปอาจไม่มีเสียง หรือ Facebook/IG ทำได้เฉพาะเครื่องทีม'); e.code = 'CLIP_FAILED'; throw e;
  }
  return await extractClipInsight({ url, platform: 'transcript', rawText });
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

    // ★ 22 มิ.ย.: ผ่าน "คิวงานหนัก" — กันยิง Gemini/Whisper ซ้อนกัน + เว้นช่วงอัตโนมัติเมื่อ API แน่น
    let insight;
    try {
      insight = await getClipVideoQueue().run(() => buildInsight({ url, type }), { label: `insight:${type}` });
    } catch (e) {
      const code = e.code || 'INSIGHT_FAILED';
      return NextResponse.json({ success: false, error: humanizeErr(e.message), errorType: code }, { status: 422 });
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
    return NextResponse.json({ success: false, error: humanizeErr(error.message), errorType: 'INSIGHT_ERROR' }, { status: 500 });
  }
}
