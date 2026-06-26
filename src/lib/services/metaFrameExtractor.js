/**
 * =====================================================
 * Meta (Facebook/Instagram) Video Frame Extractor — สำหรับ "ทำปก"
 * =====================================================
 * เครื่องทีมเท่านั้น: bin/yt-dlp.exe (โหลดคลิป FB/IG) + system ffmpeg (แตกเฟรม)
 *   - บน Vercel/Linux: yt-dlp.exe รันไม่ได้ → คืน [] (route จะแจ้งผู้ใช้ให้ใช้ลิงก์อื่น)
 *   - ไม่พึ่ง fluent-ffmpeg/ffmpeg-static (โปรเจกต์จงใจไม่ใช้) — เรียก ffmpeg จาก PATH ตรงๆ
 *
 * คืนเฟรมเป็น data:image/jpeg;base64 URI (กระจายทั้งคลิป) → เข้า judge ของ pipeline ปกติต่อ
 *   (judge คัดใบหน้า/คุณภาพ/กันคนผิดเองอยู่แล้ว — ที่นี่แค่ "ป้อนวัตถุดิบเฟรม")
 *
 * 🔴 แยกอิสระจากระบบทำข่าวอัตโนมัติ — ใช้เฉพาะตอนพนักงานวางลิงก์ FB/IG ในช่อง "แหล่งรูป" ของ Cover Lab
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const execFileAsync = promisify(execFile);
const LOG = '[MetaFrame]';

function ytdlpPaths() {
  const exe = path.join(process.cwd(), 'bin', 'yt-dlp.exe');
  const cookies = path.join(process.cwd(), 'bin', 'cookies.txt');
  return { exe, cookies: existsSync(cookies) ? cookies : null };
}

// เรียก yt-dlp — มี cookies ลองก่อน (IG/บางโพสต์ FB ต้องล็อกอิน) พังค่อยลองไม่มี
async function runYtdlp(args, timeout = 180_000) {
  const { exe, cookies } = ytdlpPaths();
  if (cookies) {
    try {
      return await execFileAsync(exe, ['--cookies', cookies, ...args], { maxBuffer: 1024 * 1024 * 20, timeout });
    } catch (e) {
      console.log(`${LOG} cookies.txt failed:`, e.message?.slice(0, 70));
    }
  }
  return await execFileAsync(exe, args, { maxBuffer: 1024 * 1024 * 20, timeout });
}

/**
 * แตกเฟรมจากคลิป Facebook/Instagram
 * @param {string} url - ลิงก์คลิป FB/IG
 * @param {number} numFrames - จำนวนเฟรมที่อยากได้ (กระจายทั้งคลิป)
 * @returns {Promise<string[]>} - array ของ data:image/jpeg;base64 URI (หรือ [] ถ้าทำไม่ได้)
 */
export async function extractMetaVideoFrames(url, numFrames = 8) {
  // yt-dlp.exe เป็นไบนารี Windows — บน Vercel (Linux) รันไม่ได้
  if (process.platform !== 'win32') {
    console.log(`${LOG} ข้าม — แตกเฟรม FB/IG ได้เฉพาะเครื่องทีม (Windows)`);
    return [];
  }
  const { exe } = ytdlpPaths();
  if (!existsSync(exe)) {
    console.log(`${LOG} ไม่พบ bin/yt-dlp.exe — แตกเฟรม FB/IG ได้เฉพาะเครื่องทีม`);
    return [];
  }

  const tmpDir = path.join(process.cwd(), 'tmp', 'meta-frames');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const id = crypto.randomUUID();
  const videoPath = path.join(tmpDir, `${id}.mp4`);
  const cleanupGlobIds = [id];

  try {
    // ① metadata: ความยาวคลิป (ใช้คำนวณช่วงแตกเฟรมให้กระจายทั้งคลิป)
    let duration = 0;
    try {
      const { stdout } = await runYtdlp(['--dump-json', '--no-warnings', '--no-playlist', url], 60_000);
      const info = JSON.parse(stdout.trim());
      duration = Number(info.duration) || 0;
      console.log(`${LOG} ① duration ${duration}s`);
    } catch (e) {
      console.log(`${LOG} ⚠️ metadata failed:`, e.message?.slice(0, 80));
    }
    if (duration > 20 * 60) {
      console.log(`${LOG} คลิปยาว ${Math.round(duration / 60)} นาที — ข้าม (เกินลิมิต)`);
      return [];
    }

    // ② ดาวน์โหลดคลิป (ไม่เกิน 720p — เล็ก เร็ว พอทำปก) · FB sd/hd = ไฟล์เดี่ยวมีภาพในตัว
    await runYtdlp(['-f', 'best[height<=720]/sd/hd/b[ext=mp4]/b', '-o', videoPath, '--no-warnings', '--no-playlist', url], 180_000);
    if (!existsSync(videoPath)) {
      console.log(`${LOG} ❌ ดาวน์โหลดคลิปไม่สำเร็จ`);
      return [];
    }

    // ③ แตกเฟรมเว้นช่วงเท่ากันด้วย system ffmpeg (เลี่ยงต้น/ท้ายคลิป 8%)
    const dur = duration > 1 ? duration : 30; // ถ้าไม่รู้ความยาว เดา 30s
    const start = Math.max(dur * 0.08, 1);
    const span = Math.max(dur * 0.84, dur - start - 1);
    const step = span / Math.max(numFrames, 1);
    const frames = [];
    for (let i = 0; i < numFrames; i++) {
      const t = start + step * (i + 0.5);
      const out = path.join(tmpDir, `${id}-${String(i).padStart(2, '0')}.jpg`);
      try {
        // -ss ก่อน -i = seek เร็ว · -frames:v 1 = 1 เฟรม · -q:v 3 = คุณภาพดี
        await execFileAsync('ffmpeg', ['-y', '-ss', t.toFixed(2), '-i', videoPath, '-frames:v', '1', '-q:v', '3', out],
          { maxBuffer: 1024 * 1024 * 10, timeout: 30_000 });
        if (existsSync(out)) {
          const buf = await fs.readFile(out);
          if (buf.length > 2000) frames.push(`data:image/jpeg;base64,${buf.toString('base64')}`);
        }
      } catch (e) {
        // ffmpeg ไม่อยู่ใน PATH → เลิกทั้งชุด (ไม่มีประโยชน์ลองต่อ)
        if (/ENOENT/.test(e.message || '')) {
          console.log(`${LOG} ❌ ไม่พบ ffmpeg ใน PATH — แตกเฟรมไม่ได้`);
          break;
        }
        console.log(`${LOG} เฟรม ${i} ล้ม:`, e.message?.slice(0, 60));
      }
    }
    console.log(`${LOG} ✅ FB/IG คลิป → ${frames.length}/${numFrames} เฟรม`);
    return frames;
  } catch (e) {
    const stderr = String(e.stderr || '').trim().split('\n').slice(-2).join(' | ');
    console.log(`${LOG} ❌ แตกเฟรมล้ม:`, (stderr || e.message || '').slice(0, 140));
    return [];
  } finally {
    // ลบไฟล์ชั่วคราวทั้งหมดของ batch นี้
    try {
      const files = await fs.readdir(tmpDir);
      for (const f of files) {
        if (cleanupGlobIds.some(gid => f.startsWith(gid))) {
          await fs.unlink(path.join(tmpDir, f)).catch(() => {});
        }
      }
    } catch { /* cleanup ล้ม = ไม่เป็นไร */ }
  }
}
