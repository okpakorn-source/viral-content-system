/**
 * =====================================================
 * TikTok Frame Extractor
 * =====================================================
 * หาคลิป TikTok จาก Google Search แล้ว extract frames ด้วย ytdl-core + ffmpeg
 * 
 * Strategy:
 * 1. ใช้ Serper Web Search → หา TikTok URLs
 * 2. ลองดาวน์โหลด video ผ่าน ytdl-core
 * 3. ใช้ ffmpeg scene detection → extract key frames
 * 4. Fallback: ดึง thumbnail จาก oEmbed API
 */
import sharp from 'sharp';

const LOG_PREFIX = '[TikTokExtractor]';
const MAX_VIDEOS = 3;
const MAX_FRAMES_PER_VIDEO = 8;

/**
 * ค้นหาและดึงเฟรมจาก TikTok
 * @param {string} query - คำค้นหา (เช่น "เชียร์ ทีชัมพร")
 * @returns {Promise<Array<{buffer: Buffer, source: string, timestamp: string}>>}
 */
export async function searchAndExtractTikTokFrames(query) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.log(`${LOG_PREFIX} ❌ No SERPER_API_KEY — skipping TikTok search`);
    return [];
  }

  try {
    // Step 1: Search Google for TikTok videos
    console.log(`${LOG_PREFIX} 🔍 Searching TikTok: "${query}"`);
    
    const searchRes = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: `site:tiktok.com ${query}`,
        gl: 'th', hl: 'th', num: 8,
      }),
    });

    if (!searchRes.ok) {
      console.log(`${LOG_PREFIX} Serper HTTP ${searchRes.status}`);
      return [];
    }

    const data = await searchRes.json();
    const results = data.organic || [];
    
    // Filter: เอาเฉพาะ URL ที่เป็น TikTok video
    const tiktokUrls = results
      .map(r => r.link)
      .filter(url => url && /tiktok\.com\/@[^/]+\/video\/\d+/.test(url))
      .slice(0, MAX_VIDEOS);

    if (tiktokUrls.length === 0) {
      console.log(`${LOG_PREFIX} No TikTok video URLs found for: "${query}"`);
      // Fallback: ลองดึง thumbnail จาก search results
      return await extractFromThumbnails(results);
    }

    console.log(`${LOG_PREFIX} Found ${tiktokUrls.length} TikTok videos`);

    // Step 2: Extract frames from each video
    const allFrames = [];
    
    for (const url of tiktokUrls) {
      try {
        // Strategy A: ytdl-core + ffmpeg (HD frames)
        const hdFrames = await extractTikTokHD(url);
        if (hdFrames.length > 0) {
          allFrames.push(...hdFrames);
          continue;
        }
      } catch (err) {
        console.log(`${LOG_PREFIX} HD extraction failed: ${err.message?.slice(0, 80)}`);
      }

      try {
        // Strategy B: oEmbed thumbnail
        const thumbFrame = await extractTikTokThumbnail(url);
        if (thumbFrame) allFrames.push(thumbFrame);
      } catch (err) {
        console.log(`${LOG_PREFIX} Thumbnail fallback failed: ${err.message?.slice(0, 60)}`);
      }
    }

    console.log(`${LOG_PREFIX} ✅ Total: ${allFrames.length} TikTok frames`);
    return allFrames;

  } catch (err) {
    console.log(`${LOG_PREFIX} Error: ${err.message}`);
    return [];
  }
}

/**
 * Strategy A: ดาวน์โหลด TikTok video ผ่าน ytdl-core + ffmpeg extract frames
 */
async function extractTikTokHD(url) {
  let ytdl;
  try {
    ytdl = (await import('@distube/ytdl-core')).default;
  } catch {
    console.log(`${LOG_PREFIX} @distube/ytdl-core not available`);
    return [];
  }

  const { execSync, execFile } = await import('child_process');
  try {
    execSync('ffmpeg -version', { stdio: 'ignore', timeout: 3000 });
  } catch {
    return [];
  }

  // ytdl-core ไม่รองรับ TikTok โดยตรง — ลองใช้ TikTok API download แทน
  // ถ้า ytdl-core ไม่รองรับ URL นี้ → return เปล่า
  if (!ytdl.validateURL(url)) {
    console.log(`${LOG_PREFIX} ytdl-core doesn't support TikTok URLs — trying direct download`);
    return await extractTikTokDirect(url);
  }

  // ถ้า validateURL ผ่าน (unlikely สำหรับ TikTok) — ใช้วิธีเดียวกับ YouTube HD
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');
  const tmpDir = path.join(os.tmpdir(), `tkframes_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const info = await ytdl.getInfo(url);
    const videoPath = path.join(tmpDir, 'tiktok.mp4');
    
    await new Promise((resolve, reject) => {
      const stream = ytdl.downloadFromInfo(info, { quality: 'lowest', filter: 'videoonly' });
      const ws = fs.createWriteStream(videoPath);
      const timeout = setTimeout(() => { stream.destroy(); ws.end(); resolve(); }, 15000);
      stream.pipe(ws);
      ws.on('finish', () => { clearTimeout(timeout); resolve(); });
      stream.on('error', (e) => { clearTimeout(timeout); reject(e); });
    });

    return await ffmpegExtractFrames(videoPath, tmpDir, 'tiktok-hd');
  } finally {
    try { (await import('fs')).rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * ดาวน์โหลด TikTok video โดยตรง (ไม่ผ่าน ytdl-core)
 * ใช้ redirect chain ของ TikTok video URL
 */
async function extractTikTokDirect(url) {
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');
  const { execFile } = await import('child_process');

  const tmpDir = path.join(os.tmpdir(), `tkdirect_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // ลอง oEmbed → หา video URL
    const oembedRes = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });

    if (!oembedRes.ok) {
      console.log(`${LOG_PREFIX} oEmbed failed for TikTok`);
      return [];
    }

    const oembed = await oembedRes.json();
    
    // oEmbed gives thumbnail_url — download that as a frame
    if (oembed.thumbnail_url) {
      const thumbRes = await fetch(oembed.thumbnail_url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });
      if (thumbRes.ok) {
        const buffer = Buffer.from(await thumbRes.arrayBuffer());
        const meta = await sharp(buffer).metadata();
        if (meta.width >= 200 && meta.height >= 200) {
          // TikTok thumbnails are typically 1080x1920 — crop to landscape
          const processed = await sharp(buffer)
            .resize({ width: 960, height: 540, fit: 'cover', position: 'centre' })
            .sharpen({ sigma: 0.6 })
            .jpeg({ quality: 90 })
            .toBuffer();

          console.log(`${LOG_PREFIX} ✅ TikTok thumbnail: ${meta.width}x${meta.height} → cropped 960x540`);
          return [{
            buffer: processed,
            source: 'tiktok-thumbnail',
            timestamp: 'cover',
          }];
        }
      }
    }

    return [];
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Strategy B: ดึง thumbnail จาก TikTok oEmbed API
 */
async function extractTikTokThumbnail(url) {
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });

    if (!res.ok) return null;
    const data = await res.json();

    if (!data.thumbnail_url) return null;

    const imgRes = await fetch(data.thumbnail_url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (!imgRes.ok) return null;

    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    
    if (!meta.width || meta.width < 200) return null;

    // TikTok = vertical 1080x1920 → crop to landscape 960x540
    const processed = await sharp(buffer)
      .resize({ width: 960, height: 540, fit: 'cover', position: 'centre' })
      .sharpen({ sigma: 0.6 })
      .jpeg({ quality: 90 })
      .toBuffer();

    console.log(`${LOG_PREFIX} ✅ Thumbnail from ${url.slice(0, 50)}: ${meta.width}x${meta.height}`);
    return {
      buffer: processed,
      source: 'tiktok-thumbnail',
      timestamp: 'cover',
    };
  } catch (err) {
    console.log(`${LOG_PREFIX} Thumbnail error: ${err.message?.slice(0, 60)}`);
    return null;
  }
}

/**
 * Fallback: ดึง image URLs จาก search result thumbnails
 */
async function extractFromThumbnails(searchResults) {
  const frames = [];
  
  for (const result of searchResults.slice(0, 5)) {
    // Google search results อาจมี thumbnail
    const imgUrl = result.imageUrl || result.thumbnailUrl;
    if (!imgUrl) continue;

    try {
      const res = await fetch(imgUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });
      if (!res.ok) continue;

      const buffer = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(buffer).metadata();
      if (!meta.width || meta.width < 200) continue;

      const processed = await sharp(buffer)
        .resize({ width: 960, height: 540, fit: 'cover', position: 'centre' })
        .jpeg({ quality: 88 })
        .toBuffer();

      frames.push({
        buffer: processed,
        source: 'tiktok-search-thumb',
        timestamp: `result-${frames.length}`,
      });
    } catch {}
  }

  return frames;
}

/**
 * Shared: ffmpeg extract scene frames from downloaded video
 */
async function ffmpegExtractFrames(videoPath, tmpDir, sourceLabel) {
  const fs = await import('fs');
  const path = await import('path');
  const { execFile } = await import('child_process');

  const framesDir = path.join(tmpDir, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });

  await new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-i', videoPath, '-t', '30',
      '-vf', "select='gt(scene\\,0.3)',scale='min(960\\,iw):-2'",
      '-fps_mode', 'vfr', '-q:v', '2', '-frames:v', '8',
      path.join(framesDir, 'tk_%04d.jpg'),
    ], { timeout: 20000 }, (err) => {
      if (err && !fs.readdirSync(framesDir).length) reject(err);
      else resolve();
    });
  });

  const frameFiles = fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg')).sort();
  const frames = [];

  for (const filename of frameFiles) {
    try {
      const buf = fs.readFileSync(path.join(framesDir, filename));
      const meta = await sharp(buf).metadata();
      if (!meta.width || meta.width < 200) continue;

      const processed = await sharp(buf)
        .sharpen({ sigma: 0.8 })
        .jpeg({ quality: 90 })
        .toBuffer();

      frames.push({
        buffer: processed,
        source: sourceLabel,
        timestamp: `scene-${frames.length}`,
      });
    } catch {}
  }

  return frames;
}
