/**
 * =====================================================
 * Meta Reels Extractor — Facebook Reel / fb.watch / Instagram Reel → เนื้อข่าว
 * =====================================================
 * (11 มิ.ย. — ผู้ใช้: คลิปข่าวส่วนใหญ่อยู่บน Meta ต้องใช้ Reels ทำข่าวเยอะมาก)
 * เส้นทาง: yt-dlp (bin/yt-dlp.exe + bin/cookies.txt ถ้ามี) → แคปชันโพสต์ + ดาวน์โหลด "เสียง m4a" ตรง
 *        (Whisper รับ m4a/mp4 ได้เลย — ไม่พึ่ง ffmpeg ซึ่งไม่มีในโปรเจกต์) → Whisper ถอดเสียงไทย
 *        → รวม "แคปชัน + เสียงพากย์" เป็นเนื้อข่าวก้อนเดียว
 * โครง/conventions เดียวกับ tiktokService — fail คืน { success:false, error } ให้ caller fallback ไป scrape
 * ข้อจำกัด: ใช้ได้เฉพาะเครื่องที่มี bin/yt-dlp.exe (local) — บน Vercel จะคืน error แบบสุภาพ
 */
import OpenAI from 'openai';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createReadStream, existsSync, statSync } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ★ lazy-init เหมือน tiktokService — กัน SDK throw ตอน build ถ้า env ไม่มี key
let _openai = null;
const getOpenai = () => {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
};

/** ลิงก์วิดีโอของ Meta ไหม (Reel/Watch/วิดีโอโพสต์) — โพสต์ข้อความ/รูปล้วนไม่นับ */
export function isMetaVideoUrl(url = '') {
  return /facebook\.com\/(reel|watch|share\/[rv]\/|video)|fb\.watch\/|instagram\.com\/(reel|reels|tv)\//i.test(url);
}

function ytdlpPaths() {
  const exe = path.join(process.cwd(), 'bin', 'yt-dlp.exe');
  const cookies = path.join(process.cwd(), 'bin', 'cookies.txt');
  return { exe, cookies: existsSync(cookies) ? cookies : null };
}

async function runYtdlp(args, timeout = 90_000) {
  const { exe, cookies } = ytdlpPaths();
  if (!existsSync(exe)) throw new Error('ไม่พบ bin/yt-dlp.exe — Reels ดึงได้เฉพาะเครื่อง local');
  // มี cookies ลองก่อน (IG/บางโพสต์ FB ต้องล็อกอิน) — พังค่อยลองแบบไม่มี
  if (cookies) {
    try {
      return await execFileAsync(exe, ['--cookies', cookies, ...args], { maxBuffer: 1024 * 1024 * 20, timeout });
    } catch (e) {
      console.log('[MetaReels] cookies.txt failed:', e.message?.slice(0, 80));
    }
  }
  return execFileAsync(exe, args, { maxBuffer: 1024 * 1024 * 20, timeout });
}

export async function transcribeMetaReel({ url }) {
  let videoPath = null;
  let audioPath = null;
  try {
    console.log(`[MetaReels] 🎞️ ${url.slice(0, 90)}`);

    // ① metadata: แคปชันโพสต์ (สำคัญ — Reels ข่าวมักสรุปเรื่องไว้ในแคปชัน)
    let caption = '';
    let duration = 0;
    try {
      const { stdout } = await runYtdlp(['--dump-json', '--no-warnings', '--no-playlist', url], 60_000);
      const info = JSON.parse(stdout.trim());
      caption = String(info.description || info.title || '').trim();
      duration = Number(info.duration) || 0;
      console.log(`[MetaReels] ① caption ${caption.length}ch | duration ${duration}s`);
    } catch (e) {
      console.log('[MetaReels] ⚠️ metadata failed:', e.message?.slice(0, 100));
    }

    if (duration > 15 * 60) {
      return { success: false, error: `คลิปยาว ${Math.round(duration / 60)} นาที — เกินลิมิต 15 นาที (ค่า Whisper จะแพง)` };
    }

    // ② ดาวน์โหลด "เสียง m4a" ตรงด้วย yt-dlp (เล็ก + Whisper รับได้เลย ไม่ต้องแปลง)
    //   FB บางคลิปไม่มีสตรีมเสียงแยก → fallback ดาวน์โหลด mp4 ทั้งไฟล์ (Whisper รับ mp4 ได้ ลิมิต 25MB)
    audioPath = join(tmpdir(), `meta_${Date.now()}.m4a`);
    try {
      await runYtdlp(['-f', 'ba[ext=m4a]/ba', '-o', audioPath, '--no-warnings', '--no-playlist', url], 180_000);
    } catch (e) {
      console.log('[MetaReels] no audio-only stream:', e.message?.slice(0, 60));
    }
    let mediaPath = existsSync(audioPath) ? audioPath : null;
    if (!mediaPath) {
      videoPath = join(tmpdir(), `meta_${Date.now()}.mp4`);
      await runYtdlp(['-f', 'b[ext=mp4]/b', '-o', videoPath, '--no-warnings', '--no-playlist', url], 180_000);
      if (existsSync(videoPath)) mediaPath = videoPath;
    }
    if (!mediaPath) {
      return { success: false, error: 'ดาวน์โหลดสื่อจาก Meta ไม่สำเร็จ (โพสต์อาจเป็นส่วนตัว/ต้องล็อกอิน — เพิ่ม bin/cookies.txt ช่วยได้)' };
    }
    const sizeMB = statSync(mediaPath).size / (1024 * 1024);
    if (sizeMB > 24) {
      return { success: false, error: `ไฟล์สื่อ ${sizeMB.toFixed(0)}MB เกินลิมิต Whisper 25MB — คลิปยาว/ละเอียดเกินไป` };
    }

    // ③ Whisper ถอดเสียงไทย (convention เดียวกับ tiktokService)
    console.log(`[MetaReels] ③ Whisper transcription (${sizeMB.toFixed(1)}MB)...`);
    const transcription = await getOpenai().audio.transcriptions.create({
      file: createReadStream(mediaPath),
      model: 'whisper-1',
      language: 'th',
      response_format: 'verbose_json',
      prompt: 'ถอดเสียงภาษาไทยจากคลิปข่าว Reels เฟซบุ๊ก เนื้อหา รายงานข่าว เสียงพากย์',
    });

    const speech = (transcription.text || '').trim();
    const dur = transcription.duration || duration || 0;

    if (!caption && (!speech || speech.length < 10)) {
      return { success: false, error: 'ไม่มีทั้งแคปชันและเสียงพูดในคลิป — อาจเป็นคลิปเพลง/ไม่มีเสียงบรรยาย' };
    }

    // ⑤ รวมเป็นเนื้อข่าวก้อนเดียว — แคปชันมาก่อน (มักเป็นสรุปเรื่อง) แล้วตามด้วยเสียงพากย์
    const parts = [];
    if (caption) parts.push(`=== แคปชันโพสต์ ===\n${caption}`);
    if (speech && speech.length >= 10) {
      parts.push(`=== ถอดเสียงจากคลิป (${Math.floor(dur / 60)}:${String(Math.floor(dur % 60)).padStart(2, '0')} นาที) ===\n${speech}`);
    }
    const formattedText = parts.join('\n\n');

    console.log(`[MetaReels] ✅ caption ${caption.length}ch + speech ${speech.length}ch (${dur.toFixed(0)}s)`);
    return {
      success: true,
      text: formattedText,
      rawText: speech,
      caption,
      title: (caption || speech).slice(0, 80),
      duration: Math.round(dur),
      chars: formattedText.length,
    };
  } catch (e) {
    console.log('[MetaReels] ❌', e.message?.slice(0, 120));
    return { success: false, error: `Meta Reels: ${e.message?.slice(0, 120)}` };
  } finally {
    for (const p of [videoPath, audioPath]) {
      if (p) { try { await unlink(p); } catch {} }
    }
  }
}
