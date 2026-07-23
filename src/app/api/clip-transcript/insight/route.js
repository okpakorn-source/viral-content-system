export const maxDuration = 800; // ★ 25 มิ.ย.: 300→800 — Gemini retry ได้ 4×180s=720s เกิน 300 → Vercel ฆ่าฟังก์ชันกลางคัน คืน error page (text) ทำหน้าเว็บ parse JSON พัง "An error o..." (แพลนรองรับ 800 เท่า queue worker)
import { NextResponse } from 'next/server';
import { extractClipInsight, extractInsightFromVideoBuffer, extractMultiTopicInsight, extractMultiTopicFromVideoBuffer } from '@/lib/services/clipInsightService';
import { createStore } from '@/lib/persistStore';
import { getClipVideoQueue } from '@/lib/services/clipQueue';
import { randomUUID } from 'crypto';

// โหลดไฟล์วิดีโอ TikTok (tikwm) — ใช้บนคลาวด์ได้
// ★ 22 ก.ค. 69: ใส่ timeout ทั้ง 2 จังหวะ — วันที่ tikwm ค้าง (เจอจริง: แขวนเกิน 7 นาที) งานเคยค้างจนโดนตัด 16 นาที/รอบแล้ววนใหม่
//   fail เร็ว → เข้าคิว retry ปกติ (ทุก ~3 นาที) แทนการแขวนคิวยาว
async function downloadTiktokBuffer(url) {
  const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`, { signal: AbortSignal.timeout(30_000) });
  const data = await res.json();
  const playUrl = data?.data?.hdplay || data?.data?.play;
  if (!playUrl) throw new Error('tikwm: ไม่พบลิงก์วิดีโอ');
  const vres = await fetch(playUrl, { signal: AbortSignal.timeout(120_000) });
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
// ★ 26 มิ.ย. (ค่ำ): จำว่า "Gemini โหลด YouTube URL เองค้าง" → ข้ามไปโหลดเองเลยชั่วคราว (กันเสีย 170 วิ ซ้ำ ๆ ทุกคลิป)
//   เครื่องทีมที่มี yt-dlp: เจอค้างครั้งแรก → จำ 20 นาที → คลิปถัดไปข้าม URL ไปโหลดเองทันที (เร็วขึ้นมาก)
//   ครบ 20 นาทีลอง URL ใหม่ (เผื่อ Gemini ฝั่งโหลด YouTube ฟื้น) — ปรับอัตโนมัติ ไม่ต้องแก้มือ
//   ★ เริ่มต้น = ข้าม URL ไว้ก่อน 20 นาที (26 มิ.ย. Gemini โหลด YouTube เองพังทั้งวัน) → YouTube เร็วทันทีทุกตัว
//     ถ้าฝั่งโหลด YouTube ฟื้น: ครบ 20 นาทีจะลอง URL เอง · ถ้าอยากกลับไปลอง URL ก่อนเสมอ ตั้งเป็น 0
let _ytUrlBrokenUntil = Date.now() + 20 * 60 * 1000;

async function buildInsight({ url, type }, ctx = null) {
  // ★ 23 ก.ค.: ctx (optional) — เก็บ buffer/URL ที่ใช้จริง ให้รอบ "เนื้อดิบมีมิติ" หยิบไปใช้ซ้ำ ไม่โหลด/ไม่แตะ insight เดิม
  // ★ 25 มิ.ย.: ใช้ insight เดียว (enhanced) เสมอ — Gemini "ตัดสินเอง" (content-aware) ว่าคลิปมีหลายประเด็นไหม
  //   มีหลายประเด็น → ใส่ subStories (เนื้อดิบแยกประเด็น) เพิ่มจาก rawData รวม · เรื่องเดียว → subStories ว่าง
  //   เลิกพึ่ง getClipDurationSec (ยึด yt-dlp = พังบนคลาวด์ → เคยได้ single เสมอ) — ตอนนี้ทำงานทั้ง cloud+โลคัล
  // ★ 26 มิ.ย. (ผู้ใช้สั่ง): ใช้ "Gemini ดูคลิปจริง" เท่านั้น — ปิด fallback ถอดเสียง+OpenAI
  //   เหตุผล: Gemini ดูคลิป (เห็นภาพ+ตัวหนังสือบนจอ+ฟังเสียง) ถอดข้อมูลดิบมีประสิทธิภาพกว่ามาก
  //   ถ้า Gemini แน่น → โยน error ให้ผู้ใช้ "รอ/กดใหม่" ดีกว่าได้ผลด้อยจาก transcript ล้วน
  //   (ฟังก์ชัน transcript ยังอยู่ในโค้ด เผื่อเปิดใช้ภายหลัง — แค่ไม่เรียกในเส้นทาง insight)
  if (type === 'youtube') {
    // ★ 26 มิ.ย. (ผู้ใช้สั่ง + ปรับเร็วขึ้น): YouTube ไฮบริด "อัจฉริยะ"
    //   - เครื่องทีม (win32 มี yt-dlp): ถ้าเพิ่งเจอ URL ค้าง (ใน 20 นาที) → ข้ามไปโหลดเองเลย (ไม่เสีย 170 วิ ซ้ำ)
    //     ไม่งั้นลอง URL ก่อน (170 วิ) → ค้าง → จำไว้ + สลับโหลดเอง+อัปไฟล์ (เหมือน TikTok/FB คุณภาพเท่าเดิม)
    //   - cloud (Vercel ไม่มี yt-dlp): ใช้ URL อย่างเดียว (ทางเลือกเดียว)
    const YT_FMT = 'best[height<=480][ext=mp4]/best[height<=480]/best[ext=mp4]/best';
    const downloadAndExtract = async () => {
      const buf = await downloadMetaBuffer(url, YT_FMT);
      if (ctx) { ctx.mode = 'buffer'; ctx.buffer = buf; ctx.mimeType = 'video/mp4'; } // ★ 23 ก.ค.: เก็บ buffer ให้รอบเนื้อดิบมีมิติใช้ซ้ำ
      return await extractInsightFromVideoBuffer(buf, 'video/mp4');
    };
    if (process.platform === 'win32') {
      if (Date.now() < _ytUrlBrokenUntil) {
        console.log('[ClipInsight] ⏩ YouTube: ข้าม URL (เพิ่งค้าง) → โหลดเองเลย');
        return await downloadAndExtract();
      }
      try {
        const _r = await _raceTimeout(extractClipInsight({ url, platform: 'youtube' }), 170_000, 'YouTube URL passthrough');
        if (ctx) { ctx.mode = 'youtube-url'; ctx.url = url; } // ★ 23 ก.ค.: รอบเนื้อดิบมีมิติใช้ URL passthrough เช่นกัน
        return _r;
      } catch (e) {
        _ytUrlBrokenUntil = Date.now() + 20 * 60 * 1000; // จำว่า URL ค้าง → ข้าม 20 นาที
        console.log(`[ClipInsight] 🔄 YouTube URL ค้าง → โหลดเอง + ข้าม URL 20 นาที: ${String(e.message).slice(0, 60)}`);
        return await downloadAndExtract();
      }
    }
    if (ctx) { ctx.mode = 'youtube-url'; ctx.url = url; }
    return await extractClipInsight({ url, platform: 'youtube' }); // cloud: URL passthrough เท่านั้น
  }
  // TikTok/FB/IG → โหลดไฟล์ให้ Gemini "ดูจริง" (เห็นภาพ+ตัวหนังสือบนจอ) — ไม่มี fallback ถอดเสียง
  const buf = type === 'tiktok' ? await downloadTiktokBuffer(url) : await downloadMetaBuffer(url);
  if (ctx) { ctx.mode = 'buffer'; ctx.buffer = buf; ctx.mimeType = 'video/mp4'; } // ★ 23 ก.ค.: เก็บ buffer ให้รอบเนื้อดิบมีมิติใช้ซ้ำ
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

// ★ 8 ก.ค.: ด่านตรวจคุณภาพก่อนเก็บคลัง — เช็คง่ายๆ ไม่เรียก AI (เคยมีเคส rawData ว่าง 0 ตัวอักษรหลุดเข้าคลัง
//   จาก JSON ถูกตัดท้ายแล้วซ่อมไม่ครบ) — คืน [] = ผ่าน, ไม่ผ่านคืนรายการปัญหา
const RAWDATA_MIN_CHARS = 300;
function insightQualityIssues(insight) {
  const issues = [];
  const raw = String(insight?.rawData || '');
  if (raw.length < RAWDATA_MIN_CHARS) issues.push(`เนื้อดิบสั้นผิดปกติ (${raw.length} ตัวอักษร)`);
  if (!String(insight?.headline || '').trim()) issues.push('ไม่มีหัวข้อข่าว');
  return issues;
}

export async function POST(request) {
  try {
    // ★ 8 ก.ค.: รับเพิ่ม force (ถอดใหม่ ไม่เอาผลจากคลัง) + user (ใครส่ง — เก็บเป็น metadata คลัง)
    const { url: _rawUrl, force = false, user = '' } = await request.json();
    if (!_rawUrl || typeof _rawUrl !== 'string') {
      return NextResponse.json({ success: false, error: 'กรุณาวางลิงก์คลิป', errorType: 'MISSING_URL' }, { status: 400 });
    }
    const url = cleanClipUrl(_rawUrl); // ★ ล้าง fbclid/tracking ก่อน (กัน Gemini ดูคลิปพัง)
    const type = detectClipType(url);
    if (!type) {
      return NextResponse.json({ success: false, error: 'ลิงก์ไม่รองรับ — ใช้ได้เฉพาะ TikTok / YouTube / Facebook(IG)', errorType: 'UNSUPPORTED_URL' }, { status: 400 });
    }

    // ★ 8 ก.ค.: dedup ข้ามเวลา — คลิปนี้เคยถอดสำเร็จแล้ว (คุณภาพผ่านเกณฑ์) → คืนผลเดิมทันที ฟรี+เร็ว
    //   (เดิมกันซ้ำแค่งานที่ยังรันอยู่ 3 ชม. — กดซ้ำ/ส่งซ้ำคนละวัน = จ่ายค่า Gemini ดูคลิปเดิมเต็มราคา)
    //   force=true (ปุ่ม "ถอดใหม่" ใน UI) → ข้ามคลัง ถอดสดเสมอ
    if (!force) {
      try {
        const store = createStore('clip-insights');
        const all = await store.getAll();
        const hit = all
          .filter(c => c.url === url && !c.lowQuality && String(c.insight?.rawData || '').length >= RAWDATA_MIN_CHARS)
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
        if (hit) {
          console.log(`[ClipInsight] ⚡ ผลจากคลัง (เคยถอดแล้ว ${hit.createdAt}): ${url.slice(0, 60)}`);
          return NextResponse.json({ success: true, data: { id: hit.id, platform: hit.platform, ...hit.insight, cached: true, cachedAt: hit.createdAt } });
        }
      } catch (e) { console.warn('[ClipInsight] เช็คคลัง dedup ล้ม (ถอดสดตามปกติ):', e.message?.slice(0, 50)); }
    }

    console.log(`[ClipInsight] ${type}: ${url.slice(0, 80)}`);

    // ★ 22 มิ.ย.: ผ่าน "คิวงานหนัก" — กันยิง Gemini/Whisper ซ้อนกัน + เว้นช่วงอัตโนมัติเมื่อ API แน่น
    const startedAt = Date.now();
    const ctx = {}; // ★ 23 ก.ค.: buildInsight เก็บ buffer/URL ที่ใช้จริงไว้ที่นี่ → รอบเนื้อดิบมีมิติหยิบไปใช้ซ้ำ
    let insight;
    let attempts = 1;
    try {
      insight = await getClipVideoQueue().run(() => buildInsight({ url, type }, ctx), { label: `insight:${type}` });
    } catch (e) {
      const code = e.code || 'INSIGHT_FAILED';
      return NextResponse.json({ success: false, error: humanizeErr(e.message), errorType: code }, { status: 422 });
    }

    // ★ 8 ก.ค.: ด่านตรวจคุณภาพ — ไม่ผ่าน → ถอดใหม่อัตโนมัติ 1 ครั้ง (เฉพาะเมื่อรอบแรกเร็วพอ ไม่ชน timeout)
    //   ยังไม่ผ่านอีก → เก็บพร้อมธง lowQuality ให้เห็นชัดในคลัง (ไม่ทิ้งเงียบ ไม่ปนกับเคสดี)
    let lowQuality = false, qualityNote = '';
    let issues = insightQualityIssues(insight);
    if (issues.length && Date.now() - startedAt < 5 * 60 * 1000) {
      console.warn(`[ClipInsight] ⚠️ ไม่ผ่านด่านคุณภาพ (${issues.join(' · ')}) → ถอดใหม่อัตโนมัติ 1 ครั้ง`);
      attempts = 2;
      try {
        const retryInsight = await getClipVideoQueue().run(() => buildInsight({ url, type }), { label: `insight-qc-retry:${type}` });
        const retryIssues = insightQualityIssues(retryInsight);
        if (retryIssues.length < issues.length || String(retryInsight?.rawData || '').length > String(insight?.rawData || '').length) {
          insight = retryInsight; issues = retryIssues; // เอารอบที่ดีกว่า
        }
      } catch (e) { console.warn('[ClipInsight] ถอดซ้ำรอบ QC ล้ม (ใช้ผลรอบแรก):', e.message?.slice(0, 50)); }
    }
    if (issues.length) {
      lowQuality = true;
      qualityNote = `ผลอาจไม่สมบูรณ์: ${issues.join(' · ')} — แนะนำกดถอดใหม่`;
      console.warn(`[ClipInsight] ⚠️ เก็บแบบติดธง lowQuality: ${qualityNote}`);
    }

    // ★ 23 ก.ค. (ผู้ใช้สั่ง) — รอบ 2 "เนื้อดิบมีมิติ": Gemini ถอดคำพูดจริง (ไม่เอาเพลง) → ถักทอเข้าประเด็น (enrichedRaw)
    //   🔴 อิสระจาก insight เดิม 100%: ล้ม/แน่น = ข้าม ใช้ผลเดิมต่อได้ · ใช้ buffer/URL ซ้ำจาก ctx (ไม่โหลดใหม่)
    //   time-guard: เวลาเหลือน้อย (>8 นาที) = ข้าม กัน route โดน maxDuration ฆ่าก่อนคืน insight (insight ต้องได้เสมอ)
    if (ctx.mode && Date.now() - startedAt < 480_000) {
      try {
        const { extractTranscriptQuotes, extractTranscriptQuotesFromVideoBuffer } = await import('@/lib/services/clipInsightService');
        const tq = await getClipVideoQueue().run(
          () => (ctx.mode === 'buffer'
            ? extractTranscriptQuotesFromVideoBuffer(ctx.buffer, ctx.mimeType)
            : extractTranscriptQuotes({ url: ctx.url })),
          { label: `enrich:${type}` }
        );
        if (tq && (String(tq.enrichedRaw || '').trim() || String(tq.transcript || '').trim() || tq.punchyQuotes?.length)) {
          insight = { ...insight, transcriptQuotes: tq };
          console.log(`[ClipInsight] ✅ เนื้อดิบมีมิติ: enrichedRaw ${tq.enrichedRaw?.length || 0} ตัวอักษร · ประโยคเด็ด ${tq.punchyQuotes?.length || 0} · เพลง=${tq.hasSong ? 'มี' : 'ไม่มี'}`);
        }
      } catch (e) {
        console.warn('[ClipInsight] รอบเนื้อดิบมีมิติล้ม (ข้าม ใช้ผลเดิม):', e.message?.slice(0, 60));
      }
    }

    // เก็บเข้าคลังประเด็น (fire-and-forget) — ★ 8 ก.ค.: ขยาย 60→400 เคส (เดิมคลังหมุนทิ้งทุก ~2 วัน
    //   ประวัติเคสข่าวปังหายหมด) + เก็บ metadata (หมวด/ความยาวคลิป/ผู้ส่ง/เวลาถอด) + สำเนาถาวร NDJSON
    const caseId = randomUUID();
    const elapsedMs = Date.now() - startedAt;
    const record = {
      id: caseId, url, platform: type,
      title: (insight.headline || insight.overview || url).slice(0, 80),
      insight,
      category: insight.category || '', clipDurationSec: insight.clipDurationSec || 0,
      user: String(user || '').slice(0, 40), elapsedMs, attempts,
      ...(lowQuality ? { lowQuality: true, qualityNote } : {}),
      createdAt: new Date().toISOString(),
    };
    (async () => {
      try {
        const store = createStore('clip-insights');
        await store.add(record);
        const all = await store.getAll();
        if (all.length > 400) {
          const old = all.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(0, all.length - 400);
          for (const o of old) await store.remove(o.id).catch(() => {});
        }
      } catch (e) { console.warn('[ClipInsight] เก็บคลังล้ม:', e.message?.slice(0, 50)); }
      // ★ สำเนาถาวร append-only (ไม่ถูกลบตาม retention — ไว้วิเคราะห์ย้อนหลัง/ลูปเรียนรู้ในอนาคต)
      //   เขียนได้เฉพาะเครื่องที่มีดิสก์จริง (เครื่องทีม ~82% ของงาน) — บน Vercel จะเงียบๆ ข้ามไป ไม่กระทบงานหลัก
      try {
        const { appendFile } = await import('fs/promises');
        const { join } = await import('path');
        await appendFile(join(process.cwd(), 'data', 'clip-insights-archive.ndjson'), JSON.stringify(record) + '\n', 'utf8');
      } catch { /* Vercel filesystem อ่านอย่างเดียว — ข้าม */ }
    })();

    return NextResponse.json({ success: true, data: { id: caseId, platform: type, ...insight, ...(lowQuality ? { lowQuality: true, qualityNote } : {}) } });
  } catch (error) {
    console.error('[ClipInsight]', error.message);
    return NextResponse.json({ success: false, error: humanizeErr(error.message), errorType: 'INSIGHT_ERROR' }, { status: 500 });
  }
}
