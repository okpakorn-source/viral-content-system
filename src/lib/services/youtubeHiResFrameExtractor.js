/**
 * YouTube Hi-Res Frame Extractor (24 มิ.ย. 69) — ดึงเฟรม "ความละเอียดสูง" จากคลิป YouTube
 * ─────────────────────────────────────────────────────────────────────────────
 * ปัญหาเดิม: ระบบทำปกหาคลิปทัวร์บ้าน/สวนเจอ แต่ดึงได้แค่ storyboard 160×90 (เบลอ) → judge ตัดทิ้ง
 *           → ภาพ "ห้อง/สวน/บริบทจริง" ไม่เคยขึ้นปก เหลือแต่รูปคน
 * วิธี: yt-dlp โหลดคลิป ≤480p → ffmpeg ตัด "เฟรมที่ฉากเปลี่ยน" (scene-detect) คม ≥350px → คืน buffer
 *
 * 🔴 แยกอิสระ 100% — ไม่แตะ crop/template/ระบบทำข่าว · เป็นแค่ "แหล่งภาพเพิ่ม" ให้สมองหาภาพปก
 * ⚠️ ทำงานเฉพาะเครื่องที่มี bin/yt-dlp.exe + ffmpeg (Windows local) — คลาวด์/ไม่มี binary → คืน [] (fallback storyboard เดิม)
 */
import sharp from 'sharp';

const LOG = '[YTHiRes]';

/** มี yt-dlp.exe + ffmpeg พร้อมใช้ไหม (เครื่องทีม Windows) */
export async function hiResFramesAvailable() {
  if (process.platform !== 'win32') return false;
  const fs = await import('fs');
  const path = await import('path');
  const { execSync } = await import('child_process');
  if (!fs.existsSync(path.join(process.cwd(), 'bin', 'yt-dlp.exe'))) return false;
  try { execSync('ffmpeg -version', { stdio: 'ignore', timeout: 4000 }); return true; } catch { return false; }
}

/**
 * ดึงเฟรมคมชัดจากคลิป YouTube 1 ลิงก์
 * @param {string} videoUrl
 * @param {{maxFrames?:number, dlTimeoutMs?:number}} opts
 * @returns {Promise<Array<{buffer:Buffer, source:string, sourceUrl:string}>>}
 */
export async function extractYouTubeHiResFrames(videoUrl, { maxFrames = 12, dlTimeoutMs = 150000 } = {}) {
  if (process.platform !== 'win32') return [];
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');
  const { execFile, execSync } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  const exe = path.join(process.cwd(), 'bin', 'yt-dlp.exe');
  if (!fs.existsSync(exe)) return [];
  try { execSync('ffmpeg -version', { stdio: 'ignore', timeout: 4000 }); } catch {
    console.warn(`${LOG} ไม่พบ ffmpeg — ข้าม (ใช้ storyboard เดิม)`); return [];
  }

  const tmpDir = path.join(os.tmpdir(), `ythf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const videoPath = path.join(tmpDir, 'v.mp4');
  try {
    // 1) yt-dlp โหลดคลิป ≤480p (เล็ก+เร็ว แต่ ≥854×480 = คมพอทำปก)
    const cookies = path.join(process.cwd(), 'bin', 'cookies.txt');
    const dlArgs = ['-f', 'best[height<=480][ext=mp4]/best[height<=480]/18/best[ext=mp4]/best',
      '-o', videoPath, '--no-warnings', '--no-playlist', '--no-part'];
    if (fs.existsSync(cookies)) dlArgs.push('--cookies', cookies);
    dlArgs.push(videoUrl);
    await execFileAsync(exe, dlArgs, { timeout: dlTimeoutMs, maxBuffer: 1024 * 1024 * 30 });
    if (!fs.existsSync(videoPath) || fs.statSync(videoPath).size < 50000) return [];

    // 2) ffmpeg ตัด "เฟรมตอนฉากเปลี่ยน" (scene-detect) — ได้ห้อง/มุมต่างๆ ของบ้าน/สวน · scale ≥ ความกว้างเดิม สูงสุด 1280
    const framesDir = path.join(tmpDir, 'f');
    fs.mkdirSync(framesDir, { recursive: true });
    await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', videoPath,
      '-vf', "select='gt(scene\\,0.35)',scale='min(1280\\,iw):-2'",
      '-fps_mode', 'vfr', '-q:v', '2', '-frames:v', String(maxFrames),
      path.join(framesDir, 'f_%04d.jpg')], { timeout: 90000, maxBuffer: 1024 * 1024 * 10 });

    // 3) อ่านเฟรม + กรองความละเอียด (≥350px = ผ่านด่าน judge) + รีทัชคมเบาๆ
    const files = fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg')).sort();
    const frames = [];
    for (const f of files.slice(0, maxFrames)) {
      try {
        const buf = fs.readFileSync(path.join(framesDir, f));
        const meta = await sharp(buf).metadata();
        if (!meta.width || meta.width < 350) continue;
        const proc = await sharp(buf).sharpen({ sigma: 0.7 }).jpeg({ quality: 88 }).toBuffer();
        frames.push({ buffer: proc, source: 'youtube-hires', sourceUrl: videoUrl });
      } catch {}
    }
    console.log(`${LOG} ${String(videoUrl).slice(-14)} → เฟรมคมชัด ${frames.length} ใบ (≥350px)`);
    return frames;
  } catch (e) {
    console.warn(`${LOG} ดึงเฟรมล้ม (${String(videoUrl).slice(-14)}):`, e.message?.slice(0, 80));
    return [];
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * ดึงเฟรมคมจากหลายคลิป (เรียงตามลำดับ) — หยุดเมื่อได้ครบ targetTotal เพื่อไม่โหลดเกินจำเป็น
 * @param {string[]} videoUrls
 * @param {{targetTotal?:number, perVideo?:number}} opts
 */
export async function extractHiResFromVideos(videoUrls = [], { targetTotal = 12, perVideo = 8 } = {}) {
  const out = [];
  for (const url of videoUrls) {
    if (out.length >= targetTotal) break;
    const fr = await extractYouTubeHiResFrames(url, { maxFrames: perVideo }).catch(() => []);
    out.push(...fr);
  }
  return out.slice(0, targetTotal);
}
