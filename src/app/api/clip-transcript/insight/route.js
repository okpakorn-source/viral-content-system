export const maxDuration = 800; // เผื่อดาวน์โหลด/บีบ/อัปโหลดคลิปยาว แต่ inference ถอดคลิปถูกล็อกไว้หนึ่งครั้งต่อคำขอ
import { NextResponse } from 'next/server';
import { extractClipInsight, extractInsightFromVideoBuffer } from '@/lib/services/clipInsightService';
import { createStore } from '@/lib/persistStore';
import { getClipVideoQueue } from '@/lib/services/clipQueue';
import { pickCasesToPurge, CLIP_CASE_KEEP, archiveRowId, CLIP_ARCHIVE_STORE } from '@/lib/services/clipArchive';
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

// ★ 14 ส.ค. 69: Google ตัดสิทธิ์เส้น Files API (generateContent อ้างไฟล์ = 403 ทุกคีย์) เหลือแนบ inline ≤19MB —
//   คลิปใหญ่กว่านั้น (เจอจริง: FB 85MB) บีบอัดด้วย ffmpeg (แปลงไฟล์ธรรมดา ไม่ใช่ generative — ไม่ขัดกฎห้ามเจนภาพ)
//   ให้พอดีเพดานก่อนส่ง: 360p + บิตเรตคำนวณจากความยาวคลิป · ไม่มี ffmpeg/บีบแล้วยังเกิน → คืนไฟล์เดิม (เส้น Files API เดิม)
const INLINE_MAX_BYTES = 19 * 1024 * 1024;
async function _fitForInline(buf, url) {
  if (buf.length <= INLINE_MAX_BYTES) return buf;
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { writeFile, readFile, unlink } = await import('fs/promises');
    const execFileAsync = promisify(execFile);
    await execFileAsync('ffmpeg', ['-version'], { timeout: 10_000 }); // เช็คว่าเครื่องมี ffmpeg (PATH)
    const durSec = (await getClipDurationSec(url)) || 900; // หาความยาวไม่ได้ = เผื่อ 15 นาที
    const audioK = 48;
    const videoK = Math.max(60, Math.floor(((INLINE_MAX_BYTES * 8 * 0.93) / 1000) / durSec) - audioK);
    const inP = join(tmpdir(), `fit_in_${Date.now()}.mp4`);
    const outP = join(tmpdir(), `fit_out_${Date.now()}.mp4`);
    await writeFile(inP, buf);
    try {
      await execFileAsync('ffmpeg', ['-y', '-i', inP, '-vf', 'scale=-2:360', '-c:v', 'libx264', '-preset', 'veryfast',
        '-b:v', `${videoK}k`, '-maxrate', `${videoK}k`, '-bufsize', `${videoK * 2}k`,
        '-c:a', 'aac', '-b:a', `${audioK}k`, '-ac', '1', '-movflags', '+faststart', outP],
        { timeout: 600_000, maxBuffer: 1024 * 1024 * 20 });
      const out = await readFile(outP);
      if (out.length >= 10000 && out.length <= INLINE_MAX_BYTES) {
        console.log(`[ClipInsight] 🗜️ บีบอัดคลิปใหญ่ ${(buf.length / 1e6).toFixed(1)}MB → ${(out.length / 1e6).toFixed(1)}MB (${videoK}k/360p ยาว ~${Math.round(durSec / 60)} นาที)`);
        return out;
      }
      console.warn(`[ClipInsight] 🗜️ บีบแล้วยังเกินเพดาน (${(out.length / 1e6).toFixed(1)}MB) → ใช้ไฟล์เดิม`);
      return buf;
    } finally { await unlink(inP).catch(() => {}); await unlink(outP).catch(() => {}); }
  } catch (e) {
    console.warn(`[ClipInsight] 🗜️ บีบอัดไม่ได้ (${String(e.message).slice(0, 60)}) → ใช้ไฟล์เดิม`);
    return buf;
  }
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
  return m.slice(0, 300) || 'ถอดประเด็นล้มเหลว'; // ★ 14 ส.ค. 69: 120→300 — error สั้นเกินจนวินิจฉัยเคสโมเดลใหม่ไม่ได้
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
// ★ 14 ส.ค. 69 (เจ้าของสั่งเทียบสองโมเดล): model (optional) — ไม่ส่ง = VIDEO_MODEL ตามเดิมเป๊ะ
async function buildInsight({ url, type, model = '' }) {
  // ★ 25 มิ.ย.: ใช้ insight เดียว (enhanced) เสมอ — Gemini "ตัดสินเอง" (content-aware) ว่าคลิปมีหลายประเด็นไหม
  //   มีหลายประเด็น → ใส่ subStories (เนื้อดิบแยกประเด็น) เพิ่มจาก rawData รวม · เรื่องเดียว → subStories ว่าง
  //   เลิกพึ่ง getClipDurationSec (ยึด yt-dlp = พังบนคลาวด์ → เคยได้ single เสมอ) — ตอนนี้ทำงานทั้ง cloud+โลคัล
  // ★ 26 มิ.ย. (ผู้ใช้สั่ง): ใช้ "Gemini ดูคลิปจริง" เท่านั้น — ปิด fallback ถอดเสียง+OpenAI
  //   เหตุผล: Gemini ดูคลิป (เห็นภาพ+ตัวหนังสือบนจอ+ฟังเสียง) ถอดข้อมูลดิบมีประสิทธิภาพกว่ามาก
  //   ถ้า Gemini แน่น → โยน error ให้ผู้ใช้ "รอ/กดใหม่" ดีกว่าได้ผลด้อยจาก transcript ล้วน
  //   (ฟังก์ชัน transcript ยังอยู่ในโค้ด เผื่อเปิดใช้ภายหลัง — แค่ไม่เรียกในเส้นทาง insight)
  if (type === 'youtube') {
    // หนึ่งคำขอเลือกทางเดียวเท่านั้น เพื่อไม่ให้ URL inference และ file inference ซ้อนกัน:
    //   - Windows ทีมงาน: โหลดคลิปแล้วส่งไฟล์ให้ Gemini หนึ่งครั้ง
    //   - cloud: ส่ง URL ให้ Gemini หนึ่งครั้ง
    const YT_FMT = 'best[height<=480][ext=mp4]/best[height<=480]/best[ext=mp4]/best';
    const downloadAndExtract = async () => {
      const buf = await _fitForInline(await downloadMetaBuffer(url, YT_FMT), url); // ★ 14 ส.ค.: >19MB บีบก่อนแนบ inline
      return await extractInsightFromVideoBuffer(buf, 'video/mp4', model);
    };
    if (process.platform === 'win32') return await downloadAndExtract();
    return await extractClipInsight({ url, platform: 'youtube', ...(model ? { model } : {}) }); // cloud: URL passthrough เท่านั้น
  }
  // TikTok/FB/IG → โหลดไฟล์ให้ Gemini "ดูจริง" (เห็นภาพ+ตัวหนังสือบนจอ) — ไม่มี fallback ถอดเสียง
  const raw = type === 'tiktok' ? await downloadTiktokBuffer(url) : await downloadMetaBuffer(url);
  const buf = await _fitForInline(raw, url); // ★ 14 ส.ค.: >19MB บีบก่อนแนบ inline (เส้น Files API โดน Google ตัดสิทธิ์)
  return await extractInsightFromVideoBuffer(buf, 'video/mp4', model);
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
    // ★ 14 ส.ค. 69 (เจ้าของสั่งเทียบสองโมเดล): model (optional) — ใช้คู่ force เสมอ (คลังกันซ้ำไม่แยกตามโมเดล)
    //   จำกัด allowlist เพราะ endpoint เปิดรับจากภายนอก · ค่านอกรายการ = เพิกเฉย ใช้โมเดลหลักตามเดิม ไม่ล้มคำขอ
    const { url: _rawUrl, force = false, user = '', model: _reqModel = '' } = await request.json();
    const MODEL_ALLOWED = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash'];
    const modelOverride = MODEL_ALLOWED.includes(String(_reqModel)) ? String(_reqModel) : '';
    if (_reqModel && !modelOverride) console.warn(`[ClipInsight] ⚠️ model นอกรายการ "${String(_reqModel).slice(0, 30)}" → ใช้โมเดลหลักตามเดิม`);
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
    let insight;
    const attempts = 1;
    try {
      insight = await getClipVideoQueue().run(() => buildInsight({ url, type, model: modelOverride }), { label: `insight:${type}${modelOverride ? `@${modelOverride}` : ''}` });
    } catch (e) {
      const code = e.code || 'INSIGHT_FAILED';
      return NextResponse.json({ success: false, error: humanizeErr(e.message), errorType: code }, { status: 422 });
    }

    // ด่านตรวจคุณภาพแบบไม่เสียรอบเพิ่ม: ผลไม่ครบให้ติดธงไว้ พนักงานเป็นผู้ตัดสินใจกดถอดใหม่เอง
    // ห้ามเริ่ม Gemini รอบสองอัตโนมัติ เพราะงานรอบแรกอาจจ่ายค่า inference ไปแล้ว
    let lowQuality = false, qualityNote = '';
    const issues = insightQualityIssues(insight);
    if (issues.length) {
      lowQuality = true;
      qualityNote = `ผลอาจไม่สมบูรณ์: ${issues.join(' · ')} — กรุณาตรวจหรือกดถอดใหม่เอง`;
      console.warn(`[ClipInsight] ⚠️ เก็บแบบติดธง lowQuality: ${qualityNote}`);
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
      ...(modelOverride ? { modelUsed: modelOverride } : {}), // ★ 14 ส.ค.: ใบเทสโมเดลระบุรุ่นที่ใช้จริง (ไม่ส่ง = โมเดลหลัก)
      ...(lowQuality ? { lowQuality: true, qualityNote } : {}),
      createdAt: new Date().toISOString(),
    };
    (async () => {
      try {
        const store = createStore('clip-insights');
        await store.add(record);
        const all = await store.getAll();
        // ★ 15 ส.ค. 69 (เจ้าของสั่ง "เก็บทุกบทความที่พนักงานถอด"): ใบที่พนักงานปักหมุด "ใช้ใบนี้" ห้ามลบ
        //   กติกาอยู่ที่ clipArchive.pickCasesToPurge (มีเทสคุม กันหลุดซ้ำแบบตอนย้อนยุคนิ่ง 14 ส.ค.)
        for (const o of pickCasesToPurge(all, CLIP_CASE_KEEP)) await store.remove(o.id).catch(() => {});
      } catch (e) { console.warn('[ClipInsight] เก็บคลังล้ม:', e.message?.slice(0, 50)); }
      // ★ สำเนาถาวร append-only (ไม่ถูกลบตาม retention — ไว้วิเคราะห์ย้อนหลัง/ลูปเรียนรู้ในอนาคต)
      //   เขียนได้เฉพาะเครื่องที่มีดิสก์จริง (เครื่องทีม ~82% ของงาน) — บน Vercel จะเงียบๆ ข้ามไป ไม่กระทบงานหลัก
      try {
        const { appendFile } = await import('fs/promises');
        const { join } = await import('path');
        await appendFile(join(process.cwd(), 'data', 'clip-insights-archive.ndjson'), JSON.stringify(record) + '\n', 'utf8');
      } catch { /* Vercel filesystem อ่านอย่างเดียว — ข้าม */ }
      // ★ 15 ส.ค. 69 (เจ้าของสั่ง) — สำเนาถาวรบนคลาวด์ ให้ "ถอดผ่านเว็บ" ก็ไม่หายเหมือนกัน
      //   ที่มา: สำเนา NDJSON ข้างบนเขียนได้เฉพาะเครื่องที่มีดิสก์จริง → งานที่ถอดผ่าน Vercel ไม่มีสำเนาเลย
      //   วัดจริง 15 ส.ค.: คลังหลัก 400 ใบ แต่ NDJSON มีแค่ 125 ใบ = ส่วนต่างคืองานที่ถอดผ่านเว็บแล้วหลุดคลังไป
      //   เขียนตรงเข้าตารางกลาง ไม่ผ่าน createStore ตั้งใจ — createStore.add() จะ sync ไฟล์แคชทั้งก้อนทุกครั้ง
      //   (คลังโตขึ้นเรื่อยๆ = เขียนไฟล์ใหญ่ขึ้นทุกใบ) และไม่มีการ getAll() ที่นี่เลย → ค่า egress คงที่ต่อใบ
      //   ล้มยังไงก็ไม่กระทบผลถอด (fire-and-forget + try/catch) · ปิดได้ด้วย CLIP_ARCHIVE_CLOUD=0
      if (process.env.CLIP_ARCHIVE_CLOUD !== '0') {
        try {
          const { getSupabase, isSupabaseReady } = await import('@/lib/supabase');
          if (isSupabaseReady()) {
            // 🔴 id ต้องไม่ซ้ำใบจริง — กติกา + เหตุผลอยู่ที่ clipArchive.archiveRowId (มีเทสคุม)
            const { error } = await getSupabase().from('store_items').insert({
              id: archiveRowId(caseId), store_name: CLIP_ARCHIVE_STORE, data: record,
              created_at: record.createdAt, updated_at: record.createdAt,
            });
            if (error) console.warn('[ClipInsight] สำเนาถาวรคลาวด์ล้ม:', error.message?.slice(0, 60));
          }
        } catch (e) { console.warn('[ClipInsight] สำเนาถาวรคลาวด์ล้ม:', e.message?.slice(0, 60)); }
      }
    })();

    return NextResponse.json({ success: true, data: { id: caseId, platform: type, ...insight, ...(modelOverride ? { modelUsed: modelOverride } : {}), ...(lowQuality ? { lowQuality: true, qualityNote } : {}) } });
  } catch (error) {
    console.error('[ClipInsight]', error.message);
    return NextResponse.json({ success: false, error: humanizeErr(error.message), errorType: 'INSIGHT_ERROR' }, { status: 500 });
  }
}
