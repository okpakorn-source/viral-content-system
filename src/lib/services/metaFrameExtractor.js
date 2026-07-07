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
  try {
    return await execFileAsync(exe, args, { maxBuffer: 1024 * 1024 * 20, timeout });
  } catch (e) {
    // ★ FIX (2 ก.ค. CASE-345): YouTube bot-check "Sign in to confirm you're not a bot" ฆ่า Tier REAL ทุกคลิป
    //   → เฟรมโมเมนต์ (หัวใจปกแสนไลค์) ไม่เคยเข้าพูล — ลองดึงคุกกี้จากเบราว์เซอร์เครื่องทีมก่อนยอมแพ้ (non-fatal ต่อชั้น)
    if (!/sign in to confirm|not a bot|login required/i.test(String(e?.message || ''))) throw e;
    for (const br of ['chrome', 'edge']) {
      try {
        const r = await execFileAsync(exe, ['--cookies-from-browser', br, ...args], { maxBuffer: 1024 * 1024 * 20, timeout });
        console.log(`${LOG} 🍪 bot-check ผ่านด้วยคุกกี้ ${br}`);
        return r;
      } catch (e2) {
        console.log(`${LOG} cookies-from-browser ${br} failed:`, e2.message?.slice(0, 60));
      }
    }
    throw e;
  }
}

/**
 * แตกเฟรมจากคลิป Facebook/Instagram
 * @param {string} url - ลิงก์คลิป FB/IG
 * @param {number} numFrames - จำนวนเฟรมที่อยากได้ (กระจายทั้งคลิป)
 * @returns {Promise<string[]>} - array ของ data:image/jpeg;base64 URI (หรือ [] ถ้าทำไม่ได้)
 */
export async function extractMetaVideoFrames(url, numFrames = 12) {
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
    // ★ 29 มิ.ย. (CASE-239 ผู้ใช้: ไม่มีภาพสัมภาษณ์/รายการ/คุก เพราะคลิปพวกนั้นยาว >20 นาที เลยถูกข้ามหมด):
    //   ยกลิมิต 20→60 นาที — คลิปสัมภาษณ์/รายการ(ที่มีหน้าเต็ม+บริบทคุก/ทักษิณ) มักยาว 20-60 นาที ต้องให้ผ่าน
    //   ★ ปลอดภัยเรื่องเวลา: section-load (บรรทัด ~89) โหลดแค่ 180วิแรกเสมอไม่ว่าคลิปยาวเท่าไหร่ → ดาวน์โหลดไม่บาน
    if (duration > 60 * 60) {
      console.log(`${LOG} คลิปยาว ${Math.round(duration / 60)} นาที — ข้าม (เกิน 60 นาที = น่าจะ live/รวมคลิป ไม่ตรงประเด็น)`);
      return [];
    }

    // ② ดาวน์โหลดคลิป (ไม่เกิน 720p — เล็ก เร็ว พอทำปก) · FB sd/hd = ไฟล์เดี่ยวมีภาพในตัว
    // ★ 28 มิ.ย. (#1 แก้รอบเบิร์ดค้าง: คลิป 6 นาทีโหลดทั้งคลิป → ช้า บล็อก agents Google/Context จน timeout):
    //   คลิปยาว → โหลด "แค่ช่วงต้น" (มากสุด CAP_SEC) พอแตกเฟรมหน้า — เร็วขึ้นหลายเท่า ไม่กิน bandwidth ยาว
    const CAP_SEC = 180; // โหลดมากสุด 3 นาที (เฟรมสัมภาษณ์/หน้าคนมักอยู่ช่วงต้น)
    // ★ 28 มิ.ย. (#1b): --limit-rate 3M = ไม่ให้โหลด FB กินแบนด์วิดท์หมด → fetch ของ agents หาภาพ identity ไม่ถูก abort
    const _dlArgs = ['-f', 'best[height<=720]/sd/hd/b[ext=mp4]/b', '--limit-rate', '3M', '-o', videoPath, '--no-warnings', '--no-playlist'];
    if (duration > CAP_SEC + 20) {
      _dlArgs.push('--download-sections', `*0-${CAP_SEC}`, '--force-keyframes-at-cuts');
      console.log(`${LOG} คลิปยาว ${Math.round(duration / 60)} นาที → โหลดแค่ช่วงต้น ${CAP_SEC}s (เร็วขึ้น ไม่บล็อก agents)`);
    }
    _dlArgs.push(url);
    await runYtdlp(_dlArgs, 180_000);
    if (!existsSync(videoPath)) {
      console.log(`${LOG} ❌ ดาวน์โหลดคลิปไม่สำเร็จ`);
      return [];
    }

    // ③ แตกเฟรม "คม + กระจายทั้งคลิป" — แบ่งคลิปเป็นช่วง แต่ละช่วงให้ ffmpeg `thumbnail`
    //    เลือกเฟรมตัวแทนที่คมที่สุด (เลี่ยงภาพเบลอ/ช่วงเปลี่ยนฉาก ที่ -ss ตายตัวมักโดน)
    //    ★ แตกเกินจำนวนที่ต้องการ ~1.7 เท่า เผื่อคัดเฉพาะเฟรมเห็นหน้า · เลี่ยงต้น/ท้ายคลิป 6%
    const want = Math.max(numFrames, 1);
    const extractCount = Math.min(Math.ceil(want * 1.7), 20);
    // ★ ถ้าโหลดแค่ช่วงต้น (capped) → แตกเฟรมในช่วงที่โหลดจริงเท่านั้น (กัน -ss เลยไฟล์)
    const _full = duration > 1 ? duration : 30;
    const dur = (duration > CAP_SEC + 20) ? CAP_SEC : _full; // ถ้าไม่รู้ความยาว เดา 30s
    const usable = Math.max(dur * 0.88, 5);
    const start = Math.max(dur * 0.06, 0.5);
    const segLen = usable / extractCount;
    const shots = []; // { buffer, idx }
    let ffmpegMissing = false;
    for (let i = 0; i < extractCount; i++) {
      const segStart = start + segLen * i;
      const out = path.join(tmpDir, `${id}-${String(i).padStart(2, '0')}.jpg`);
      try {
        // -ss segStart -t segLen = ดูเฉพาะช่วงนี้ · -vf thumbnail = เลือกเฟรมตัวแทนคมสุดในช่วง
        await execFileAsync('ffmpeg', ['-y', '-ss', segStart.toFixed(2), '-t', Math.max(segLen, 1).toFixed(2),
          '-i', videoPath, '-vf', 'thumbnail', '-frames:v', '1', '-q:v', '2', out],
          { maxBuffer: 1024 * 1024 * 10, timeout: 30_000 });
        if (existsSync(out)) {
          const buf = await fs.readFile(out);
          if (buf.length > 2000) shots.push({ buffer: buf, idx: i });
        }
      } catch (e) {
        // ffmpeg ไม่อยู่ใน PATH → เลิกทั้งชุด (ไม่มีประโยชน์ลองต่อ)
        if (/ENOENT/.test(e.message || '')) {
          console.log(`${LOG} ❌ ไม่พบ ffmpeg ใน PATH — แตกเฟรมไม่ได้`);
          ffmpegMissing = true;
          break;
        }
        console.log(`${LOG} เฟรม ${i} ล้ม:`, e.message?.slice(0, 60));
      }
    }
    if (ffmpegMissing || !shots.length) return [];

    // ④ คัด+เรียง "เฟรมที่เห็นหน้าคน" ขึ้นก่อน (gpt-4o-mini — ถูก ไม่เปลือง Gemini)
    //    คลิป POV (ถนน/มอเตอร์ไซค์/หมวกกันน็อก ไม่เห็นหน้า) จมท้าย/ถูกตัด → กันฮีโร่ไม่เด่น + หัวขาด
    //    ระบบจัดปก (close-up gate) ทำงานได้เพราะมีเฟรมหน้าพอ · ตรวจหน้าล้ม → ถอยใช้ลำดับเวลา
    let ordered = shots;
    try {
      const { batchDetectFaces } = await import('@/lib/services/faceDetector');
      const fdMap = await batchDetectFaces(shots.map((s, i) => ({ id: `mf_${i}`, buffer: s.buffer })));
      const scored = shots.map((s, i) => {
        const fd = fdMap?.get?.(`mf_${i}`);
        let score = -1; // ไม่เห็นหน้า = ท้ายแถว
        if (fd?.hasFaces && fd.faces?.length && fd.imageWidth && fd.imageHeight) {
          const imgArea = fd.imageWidth * fd.imageHeight;
          const big = fd.faces.reduce((b, x) => (x.width * x.height > b.width * b.height ? x : b), fd.faces[0]);
          score = (big.width * big.height) / imgArea; // สัดส่วนพื้นที่หน้า/ภาพ (0-1) — ใหญ่=โคลสอัพ=ดี
          if (fd.faces.length === 1) score += 0.05;    // หน้าเดี่ยวเด่น (มักเป็น hero)
        }
        if (fd?.hasBigText) score -= 0.15;             // ตัวหนังสือฝัง = เลี่ยงเข้าช่องคน
        return { s, score };
      });
      const faceCount = scored.filter(o => o.score > 0).length;
      scored.sort((a, b) => b.score - a.score);
      ordered = scored.map(o => o.s);
      console.log(`${LOG} 👤 คัดหน้า: ${faceCount}/${shots.length} เฟรมเห็นหน้า → เรียงหน้าเด่นขึ้นก่อน`);
    } catch (e) {
      console.log(`${LOG} ตรวจหน้าเฟรมข้าม (ใช้ลำดับเวลา):`, e.message?.slice(0, 50));
    }

    const frames = ordered.slice(0, want).map(s => `data:image/jpeg;base64,${s.buffer.toString('base64')}`);
    console.log(`${LOG} ✅ FB/IG คลิป → ${frames.length} เฟรม (เห็นหน้าก่อน)`);
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
