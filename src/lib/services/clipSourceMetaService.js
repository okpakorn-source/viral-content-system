/**
 * ★ Clip Source Meta Service (4 ส.ค. 69) — ดึง "ข้อมูลโพสต์ต้นทาง" ของคลิป (เพจ/หัวข้อ/แคปชั่น)
 *
 *  ใช้เป็นหลักฐานระดับแคปชั่นตาม "กฎหลักฐานตัวตน" — ช่วยยืนยันชื่อคน/บริบทที่คลิปพูดถึงแต่ไม่ได้เขียนบนจอ
 *
 *  🔴 สัญญาของไฟล์นี้ (ห้ามผิด): best-effort ล้วน — **ห้าม throw เด็ดขาด** ทุกทางล้มคืน null
 *     ผู้เรียกอยู่กลางท่อถอดคลิปที่จ่าย Gemini ไปแล้ว ถ้าไฟล์นี้โยน error ทั้งเคสจะพังทั้งที่เนื้อครบ
 *  🔴 ทั้งไฟล์นี้ถูกเรียกเฉพาะเมื่อ CLIP_SOURCE_META=1 (ประตูอยู่ฝั่งผู้เรียก) — ปิด = ไม่มีใครแตะเน็ต/yt-dlp
 *  🔴 ห้าม log คีย์/โทเคน — ข้อความ error ถูกกรอง URL + พารามิเตอร์ลับก่อนขึ้นล็อกเสมอ (safeErr)
 */

const UPLOADER_MAX = 120;
const TITLE_MAX = 200;
const CAPTION_MAX = 800; // ★ ข้อตกลงกลาง: แคปชั่นยาวสุด 800 ตัวอักษร (คำอธิบาย YouTube ยาวเป็นหมื่น = เปลืองพรอมต์ฟรีๆ)

const OEMBED_TIMEOUT_MS = 8_000;
const YTDLP_TIMEOUT_YOUTUBE_MS = 20_000;
const YTDLP_TIMEOUT_META_MS = 25_000;

/** ตัดความยาว + ยุบช่องว่าง/บรรทัดว่าง (คำอธิบายคลิปมักมีบรรทัดว่างเพียบ) */
function clip(value, max) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max).trim();
}

/** ★ กัน URL ที่มีลายเซ็น/โทเคน (googlevideo, cookies) หลุดลงล็อก — ข้อความ error ของ yt-dlp มีบ่อย */
function safeErr(err) {
  return String(err?.message || err || '')
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/\b(api[_-]?key|access[_-]?token|token|signature|cookie|authorization)\b\s*[=:]\s*\S+/gi, '$1=<redacted>')
    .slice(0, 200);
}

function detectPlatform(url) {
  const u = String(url || '');
  if (/youtube\.com|youtu\.be/i.test(u)) return 'youtube';
  if (/tiktok\.com/i.test(u)) return 'tiktok';
  if (/facebook\.com|fb\.watch|instagram\.com/i.test(u)) return 'meta';
  return null;
}

/** ว่างทุกช่อง = ไม่มีอะไรให้ฉีดเข้าพรอมต์ → คืน null ดีกว่าคืนกล่องเปล่าให้ผู้เรียกไปเช็คเอง */
function finalize({ uploader = '', title = '', caption = '', source }) {
  if (!uploader && !title && !caption) return null;
  return { uploader, title, caption, source };
}

/**
 * เรียก yt-dlp --dump-json (เครื่องทีม Windows เท่านั้น — คลาวด์ไม่มีไฟล์นี้)
 * ธรรมเนียม path ตาม src/app/api/clip-transcript/insight/route.js: bin/yt-dlp.exe + bin/cookies.txt (ถ้ามี)
 * @returns {Promise<object|null>} JSON ก้อนแรกที่ parse ได้ หรือ null
 */
async function dumpJson(url, timeoutMs) {
  try {
    if (process.platform !== 'win32') return null;
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const { join } = await import('path');
    const { existsSync } = await import('fs');
    const execFileAsync = promisify(execFile);

    const exe = join(process.cwd(), 'bin', 'yt-dlp.exe');
    if (!existsSync(exe)) return null;
    const cookies = join(process.cwd(), 'bin', 'cookies.txt');

    const args = ['--dump-json', '--skip-download', '--no-warnings', '--no-playlist'];
    if (existsSync(cookies)) args.push('--cookies', cookies);
    args.push(String(url));

    const { stdout } = await execFileAsync(exe, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 20,
      windowsHide: true,
    });
    // --no-playlist แล้วยังอาจได้หลายบรรทัด (เพลย์ลิสต์ที่ตัดไม่ขาด) → ใช้ก้อนแรกที่ parse ผ่าน
    for (const line of String(stdout).split('\n')) {
      const s = line.trim();
      if (!s.startsWith('{')) continue;
      try { return JSON.parse(s); } catch { /* บรรทัดนี้ไม่ใช่ JSON — ลองบรรทัดถัดไป */ }
    }
    return null;
  } catch (err) {
    console.warn('[ClipSourceMeta] yt-dlp --dump-json ไม่สำเร็จ:', safeErr(err));
    return null;
  }
}

/** TikTok — ใช้ผลที่ผู้เรียกได้จาก tikwm อยู่แล้ว (ไม่ยิงซ้ำ = ไม่เพิ่มภาระ/ไม่เสี่ยงโดนบล็อก) */
function fromTikwm(tikwmInfo) {
  const d = (tikwmInfo && typeof tikwmInfo === 'object' && tikwmInfo.data && typeof tikwmInfo.data === 'object')
    ? tikwmInfo.data
    : tikwmInfo;
  if (!d || typeof d !== 'object') return null;
  const author = (d.author && typeof d.author === 'object') ? d.author : {};
  return finalize({
    uploader: clip(author.nickname || author.unique_id || d.author_name, UPLOADER_MAX),
    // ★ tikwm ไม่มีช่อง "แคปชั่น" แยก — data.title คือข้อความที่เจ้าของโพสต์เขียน จึงลงทั้งสองช่อง
    //   (ช่องหัวข้อสั้น 200 ไว้ให้อ่านเร็ว · ช่องแคปชั่น 800 เก็บข้อความเต็มกว่า)
    title: clip(d.title, TITLE_MAX),
    caption: clip(d.title, CAPTION_MAX),
    source: 'tikwm',
  });
}

/** YouTube — oEmbed ก่อน (ใช้ได้ทั้งคลาวด์+เครื่องทีม ไม่ต้องมีคีย์) แล้วเติมคำอธิบายเต็มด้วย yt-dlp ถ้าอยู่เครื่องทีม */
async function fromYoutube(url, opts) {
  let uploader = '';
  let title = '';
  let caption = '';
  let source = '';

  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(String(url))}&format=json`,
      { signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS) },
    );
    if (res && res.ok !== false) {
      const j = await res.json();
      uploader = clip(j?.author_name, UPLOADER_MAX);
      title = clip(j?.title, TITLE_MAX);
      if (uploader || title) source = 'oembed';
    }
  } catch (err) {
    console.warn('[ClipSourceMeta] oEmbed ไม่สำเร็จ:', safeErr(err));
  }

  // oEmbed ไม่มีคำอธิบายโพสต์เลย → ต้องพึ่ง yt-dlp เมื่ออยากได้แคปชั่นเต็ม (เครื่องทีมเท่านั้น)
  const dumped = opts?.skipYtDlp ? null : await dumpJson(url, YTDLP_TIMEOUT_YOUTUBE_MS);
  if (dumped) {
    uploader = uploader || clip(dumped.uploader || dumped.channel || dumped.uploader_id, UPLOADER_MAX);
    title = title || clip(dumped.title, TITLE_MAX);
    caption = clip(dumped.description, CAPTION_MAX);
    if (caption || !source) source = 'ytdlp';
  }

  return finalize({ uploader, title, caption, source: source || 'oembed' });
}

/** Facebook/Instagram — มีทางเดียวคือ yt-dlp บนเครื่องทีม (คลาวด์คืน null เงียบๆ ตามสัญญา) */
async function fromMeta(url, opts) {
  if (process.platform !== 'win32') return null;
  const d = opts?.skipYtDlp ? null : await dumpJson(url, YTDLP_TIMEOUT_META_MS);
  if (!d) return null;
  return finalize({
    uploader: clip(d.uploader || d.channel || d.uploader_id, UPLOADER_MAX),
    title: clip(d.title, TITLE_MAX),
    caption: clip(d.description, CAPTION_MAX),
    source: 'ytdlp',
  });
}

/**
 * ดึง metadata โพสต์ต้นทางแบบ best-effort
 * @param {string} url ลิงก์คลิป
 * @param {object} [opts]
 * @param {'youtube'|'tiktok'|'meta'} [opts.platform] แพลตฟอร์ม (ไม่ส่ง = เดาจาก url)
 * @param {object} [opts.tikwmInfo] ผล tikwm ที่ผู้เรียกมีอยู่แล้ว (รับได้ทั้งก้อนเต็ม {data:{...}} และเฉพาะ data)
 * @param {boolean} [opts.skipYtDlp] ปิดการเรียก yt-dlp (ใช้ในเทส/สภาพแวดล้อมที่ห้ามยิงโปรเซสนอก)
 * @returns {Promise<{uploader:string,title:string,caption:string,source:'tikwm'|'ytdlp'|'oembed'}|null>}
 */
export async function getClipSourceMeta(url, opts = {}) {
  try {
    const platform = opts?.platform || detectPlatform(url);
    if (platform === 'tiktok') return fromTikwm(opts?.tikwmInfo);
    if (!url) return null;
    if (platform === 'youtube') return await fromYoutube(url, opts);
    if (platform === 'meta') return await fromMeta(url, opts);
    return null;
  } catch (err) {
    // 🔴 ตาข่ายชั้นสุดท้าย — ไม่ว่าอะไรพังข้างใน ผู้เรียกต้องได้ null ไม่ใช่ exception
    console.warn('[ClipSourceMeta] ดึงข้อมูลต้นทางไม่สำเร็จ:', safeErr(err));
    return null;
  }
}

export default getClipSourceMeta;
