/**
 * =====================================================
 * YouTube Frame Extractor — Lightweight (No Playwright/ffmpeg)
 * =====================================================
 * ดึงเฟรมจากวิดีโอ YouTube โดยใช้เฉพาะ fetch() + sharp
 * 
 * Strategy:
 * 1. Fetch HTML ของ YouTube watch page
 * 2. Parse ytInitialPlayerResponse → หา storyboard spec
 * 3. Download sprite sheets → ตัดเป็นเฟรมด้วย Sharp
 * 4. Fallback: ใช้ YouTube auto-generated frame URLs (1.jpg, 2.jpg, 3.jpg)
 * 
 * ❌ ไม่ใช้: Playwright, ffmpeg, yt-dlp
 * ✅ ใช้เฉพาะ: fetch() + sharp
 */
import sharp from 'sharp';

const LOG_PREFIX = '[YTFrameExtractor]';
const MAX_VIDEOS = 5;
const MAX_FRAMES_PER_VIDEO = 10;

// User-Agent เพื่อให้ YouTube ส่ง HTML ปกติ (ไม่ใช่ consent page)
const YT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  // Cookie เพื่อข้ามหน้า consent ของ EU — ★ อัปเดต 2025-06
  'Cookie': 'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjUwNjAxLjA3X3AwGgJlbiADGgYIgPPTvAY; CONSENT=YES+cb.20210622-15-p0.en+FX+634',
};

/**
 * ดึงเฟรมจาก YouTube videos หลายตัว
 * @param {string[]} videoIds - Array ของ YouTube video IDs
 * @returns {Promise<Array<{buffer: Buffer, source: string, videoId: string, timestamp: string}>>}
 */
export async function extractYouTubeFrames(videoIds) {
  if (!videoIds || videoIds.length === 0) {
    console.log(`${LOG_PREFIX} ❌ No video IDs provided`);
    return [];
  }

  // จำกัดจำนวนวิดีโอ
  const limitedIds = videoIds.slice(0, MAX_VIDEOS);
  console.log(`${LOG_PREFIX} 🎬 Processing ${limitedIds.length} videos: ${limitedIds.join(', ')}`);

  const allFrames = [];

  for (const videoId of limitedIds) {
    try {
      const frames = await extractFramesFromSingleVideo(videoId);
      console.log(`${LOG_PREFIX} ✅ Video ${videoId}: got ${frames.length} frames`);
      allFrames.push(...frames);
    } catch (err) {
      console.log(`${LOG_PREFIX} ⚠️ Video ${videoId} failed: ${err.message?.slice(0, 100)}`);
    }
  }

  console.log(`${LOG_PREFIX} 🏁 Total frames extracted: ${allFrames.length}`);
  return allFrames;
}

/**
 * ดึงเฟรมจากวิดีโอ YouTube เดียว
 * ลอง storyboard ก่อน → ถ้าไม่ได้ fallback ไป auto-generated frames
 */
async function extractFramesFromSingleVideo(videoId) {
  // === Strategy 1: Storyboard sprite sheets ===
  try {
    const storyboardFrames = await extractViaStoryboard(videoId);
    if (storyboardFrames.length > 0) {
      return storyboardFrames.slice(0, MAX_FRAMES_PER_VIDEO);
    }
  } catch (err) {
    console.log(`${LOG_PREFIX} Storyboard failed for ${videoId}: ${err.message?.slice(0, 80)}`);
  }

  // === Strategy 2: Auto-generated frame URLs (fallback) ===
  console.log(`${LOG_PREFIX} Falling back to auto-generated frames for ${videoId}`);
  return await extractViaAutoFrames(videoId);
}

// ==========================================
// Strategy 1: Storyboard Sprite Sheets
// ==========================================

/**
 * ดึง storyboard spec จาก YouTube page HTML แล้วตัดเป็นเฟรม
 */
async function extractViaStoryboard(videoId) {
  console.log(`${LOG_PREFIX} Trying storyboard extraction for ${videoId}...`);

  // Fetch YouTube watch page HTML
  const pageHtml = await fetchYouTubePage(videoId);
  if (!pageHtml) {
    throw new Error('Could not fetch YouTube page HTML');
  }

  // Parse ytInitialPlayerResponse จาก HTML
  const playerResponse = parsePlayerResponse(pageHtml);
  if (!playerResponse) {
    throw new Error('Could not parse ytInitialPlayerResponse');
  }

  // หา storyboard spec
  const storyboardSpec = extractStoryboardSpec(playerResponse);
  if (!storyboardSpec) {
    throw new Error('No storyboard spec found in player response');
  }

  const videoTitle = playerResponse?.videoDetails?.title || `Video ${videoId}`;
  console.log(`${LOG_PREFIX} Found storyboard for "${videoTitle.slice(0, 50)}"`);
  console.log(`${LOG_PREFIX} Spec (first 200ch): ${storyboardSpec.slice(0, 200)}`);

  // Parse spec → download sprite sheets → split into frames
  const frames = await downloadAndSplitStoryboard(storyboardSpec, videoId);
  return frames;
}

/**
 * Fetch YouTube watch page HTML ด้วย fetch()
 */
async function fetchYouTubePage(videoId) {
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
      headers: YT_HEADERS,
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.log(`${LOG_PREFIX} YouTube page HTTP ${res.status} for ${videoId}`);
      return null;
    }

    return await res.text();
  } catch (err) {
    console.log(`${LOG_PREFIX} Fetch YouTube page error: ${err.message?.slice(0, 80)}`);
    return null;
  }
}

/**
 * Parse ytInitialPlayerResponse จาก HTML source
 * YouTube ฝัง JSON ขนาดใหญ่ใน <script> tag
 */
function parsePlayerResponse(html) {
  try {
    // Pattern 1: var ytInitialPlayerResponse = {...};
    const match1 = html.match(/var\s+ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
    if (match1) {
      return JSON.parse(match1[1]);
    }

    // Pattern 2: ytInitialPlayerResponse = {...}; (ไม่มี var)
    const match2 = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
    if (match2) {
      return JSON.parse(match2[1]);
    }

    // Pattern 3: ฝังใน ytcfg — หา playerStoryboardSpecRenderer โดยตรง
    const match3 = html.match(/"playerStoryboardSpecRenderer"\s*:\s*\{\s*"spec"\s*:\s*"([^"]+)"/);
    if (match3) {
      // สร้าง minimal player response object ที่มีแค่ storyboard
      return {
        storyboards: {
          playerStoryboardSpecRenderer: {
            spec: match3[1].replace(/\\u0026/g, '&'),
          },
        },
      };
    }

    return null;
  } catch (err) {
    console.log(`${LOG_PREFIX} JSON parse error: ${err.message?.slice(0, 80)}`);
    return null;
  }
}

/**
 * หา storyboard spec จาก playerResponse object
 * ลองหลายตำแหน่งที่ YouTube อาจเก็บข้อมูล
 */
function extractStoryboardSpec(playerResponse) {
  // ตำแหน่งที่ 1: playerStoryboardSpecRenderer (มาตรฐาน)
  const spec1 = playerResponse?.storyboards?.playerStoryboardSpecRenderer?.spec;
  if (spec1) return spec1;

  // ตำแหน่งที่ 2: playerLiveStoryboardSpecRenderer (สำหรับ live replay)
  const spec2 = playerResponse?.storyboards?.playerLiveStoryboardSpecRenderer?.spec;
  if (spec2) return spec2;

  return null;
}

/**
 * Parse storyboard spec string, download sprite sheets, แล้วตัดเป็นเฟรมด้วย Sharp
 * 
 * Format ของ spec:
 * baseUrl|w#h#count#cols#rows#interval#namePattern#sigh|w#h#...|...
 * - | = แบ่ง base URL กับแต่ละ quality level
 * - # = แบ่ง fields ภายใน level
 * - baseUrl มี $L (level index) และ $N (sheet filename)
 */
async function downloadAndSplitStoryboard(fullSpec, videoId) {
  const pipeSegments = fullSpec.split('|');
  const baseUrl = pipeSegments[0];

  // Parse แต่ละ quality level
  const levels = pipeSegments.slice(1).map((seg) => {
    const fields = seg.split('#');
    return {
      width: parseInt(fields[0]) || 160,
      height: parseInt(fields[1]) || 90,
      count: parseInt(fields[2]) || 100,
      cols: parseInt(fields[3]) || 5,
      rows: parseInt(fields[4]) || 5,
      interval: parseInt(fields[5]) || 0,
      namePattern: fields[6] || 'M$M',
      sigh: fields[7] || '',
    };
  });

  if (levels.length === 0) {
    throw new Error('No storyboard levels found in spec');
  }

  // เลือก level ที่มี resolution สูงสุดต่อเฟรม (ไม่ใช่แค่ตัวสุดท้ายเสมอ)
  let levelIndex = levels.length - 1;
  let bestArea = 0;
  for (let i = 0; i < levels.length; i++) {
    const area = levels[i].width * levels[i].height;
    if (area > bestArea) {
      bestArea = area;
      levelIndex = i;
    }
  }
  const best = levels[levelIndex];
  const framesPerSheet = best.cols * best.rows;
  const totalSheets = Math.ceil(best.count / framesPerSheet);

  // Reject ถ้าเฟรมเล็กเกินไป (< 160x90) → ไม่คุ้มที่จะดาวน์โหลด
  if (best.width < 160 || best.height < 90) {
    console.log(`${LOG_PREFIX} Storyboard too small: ${best.width}x${best.height}, skipping`);
    return [];
  }

  console.log(`${LOG_PREFIX} Storyboard L${levelIndex}: ${best.count} frames, ${best.cols}x${best.rows}/sheet, ${totalSheets} sheets, ${best.width}x${best.height}px`);

  // เลือก sheets ที่จะดาวน์โหลด (กระจายสม่ำเสมอ ไม่เกิน 4 sheets)
  const sheetsToDownload = Math.min(totalSheets, 4);
  const sheetIndices = [];
  for (let i = 0; i < sheetsToDownload; i++) {
    sheetIndices.push(Math.floor(i * totalSheets / sheetsToDownload));
  }

  const allFrames = [];

  for (const sheetIdx of sheetIndices) {
    try {
      // สร้าง URL ของ sprite sheet
      const sheetName = best.namePattern.replace('$M', String(sheetIdx));
      let sheetUrl = baseUrl
        .replace('$L', String(levelIndex))
        .replace('$N', sheetName);

      // เพิ่ม sigh parameter สำหรับ authentication
      if (best.sigh && !sheetUrl.includes('sigh=')) {
        sheetUrl += (sheetUrl.includes('?') ? '&' : '?') + `sigh=${best.sigh}`;
      }

      console.log(`${LOG_PREFIX} Downloading sheet ${sheetIdx}: ${sheetUrl.slice(0, 100)}...`);

      // ดาวน์โหลด sprite sheet
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);
      const imgRes = await fetch(sheetUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': YT_HEADERS['User-Agent'] },
      });
      clearTimeout(timeoutId);

      if (!imgRes.ok) {
        console.log(`${LOG_PREFIX} Sheet ${sheetIdx} HTTP ${imgRes.status}`);
        continue;
      }

      const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

      // ตรวจสอบว่าเป็นภาพที่ valid
      let metadata;
      try {
        metadata = await sharp(imgBuffer).metadata();
      } catch {
        console.log(`${LOG_PREFIX} Sheet ${sheetIdx} is not a valid image`);
        continue;
      }

      if (!metadata.width || !metadata.height) {
        console.log(`${LOG_PREFIX} Sheet ${sheetIdx} has no dimensions`);
        continue;
      }

      // ตัด sprite sheet เป็นเฟรมเดี่ยวด้วย Sharp
      const thumbWidth = best.width;
      const thumbHeight = best.height;

      // กระจายเฟรมที่จะตัด — ไม่ต้องตัดทั้งหมด
      const totalInSheet = best.cols * best.rows;
      const framesToExtract = Math.min(totalInSheet, 6);
      const frameStep = Math.max(1, Math.floor(totalInSheet / framesToExtract));

      let frameIndex = 0;
      for (let row = 0; row < best.rows && allFrames.length < MAX_FRAMES_PER_VIDEO; row++) {
        for (let col = 0; col < best.cols && allFrames.length < MAX_FRAMES_PER_VIDEO; col++) {
          // ข้ามเฟรมที่ไม่ต้องการ (สุ่มตัดเฉพาะบางตัว)
          if (frameIndex % frameStep !== 0) {
            frameIndex++;
            continue;
          }
          frameIndex++;

          const left = col * thumbWidth;
          const top = row * thumbHeight;

          // ตรวจสอบว่า crop area ไม่เกินขอบภาพ
          if (left + thumbWidth > metadata.width || top + thumbHeight > metadata.height) {
            continue;
          }

          try {
            const frameBuf = await sharp(imgBuffer)
              .extract({ left, top, width: thumbWidth, height: thumbHeight })
              .jpeg({ quality: 85 })
              .toBuffer();

            // Validate: ต้องไม่เล็กเกินไป
            if (frameBuf.length < 1000) continue;

            // Validate: ขนาดอย่างน้อย 100x60 (storyboard อาจเล็กกว่า 200x200)
            const frameMeta = await sharp(frameBuf).metadata();
            if (frameMeta.width < 100 || frameMeta.height < 60) continue;

            // ตรวจว่าไม่ใช่ภาพว่างเปล่า (สีเดียว)
            const isBlank = await checkIfBlank(frameBuf);
            if (isBlank) continue;

            // คำนวณ timestamp โดยประมาณ
            const globalFrameIdx = sheetIdx * framesPerSheet + row * best.cols + col;
            const estimatedTime = best.interval > 0
              ? `${Math.round(globalFrameIdx * best.interval / 1000)}s`
              : `frame-${globalFrameIdx}`;

            allFrames.push({
              buffer: frameBuf,
              source: 'youtube-storyboard',
              videoId,
              timestamp: estimatedTime,
            });
          } catch (extractErr) {
            // ข้ามเฟรมที่ extract ไม่ได้
          }
        }
      }

      console.log(`${LOG_PREFIX} Sheet ${sheetIdx}: extracted frames, total so far: ${allFrames.length}`);
    } catch (err) {
      console.log(`${LOG_PREFIX} Sheet ${sheetIdx} error: ${err.message?.slice(0, 60)}`);
    }
  }

  return allFrames;
}

// ==========================================
// Strategy 2: Auto-generated Frame URLs (Fallback)
// ==========================================

/**
 * YouTube สร้าง frame ที่ตำแหน่ง 25%, 50%, 75% ของวิดีโอโดยอัตโนมัติ
 * URLs: /vi/{id}/hq1.jpg, /vi/{id}/hq2.jpg, /vi/{id}/hq3.jpg
 * ❌ ไม่ใช้ maxresdefault.jpg, hqdefault.jpg — เป็นภาพปก ไม่ใช่เฟรม
 */
async function extractViaAutoFrames(videoId) {
  const frameUrls = [
    { url: `https://img.youtube.com/vi/${videoId}/hq1.jpg`, label: '25%' },
    { url: `https://img.youtube.com/vi/${videoId}/hq2.jpg`, label: '50%' },
    { url: `https://img.youtube.com/vi/${videoId}/hq3.jpg`, label: '75%' },
  ];

  const frames = [];

  for (const { url, label } of frameUrls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': YT_HEADERS['User-Agent'] },
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        console.log(`${LOG_PREFIX} Auto-frame ${label} HTTP ${res.status}`);
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());

      // Validate with Sharp
      const metadata = await sharp(buffer).metadata();
      if (!metadata.width || !metadata.height) continue;

      // ต้องไม่เล็กเกินไป (200x200 minimum)
      if (metadata.width < 200 || metadata.height < 200) {
        console.log(`${LOG_PREFIX} Auto-frame ${label} too small: ${metadata.width}x${metadata.height}`);
        continue;
      }

      // ตรวจว่าไม่ใช่ภาพ placeholder ว่างเปล่า
      const isBlank = await checkIfBlank(buffer);
      if (isBlank) {
        console.log(`${LOG_PREFIX} Auto-frame ${label} is blank, skipping`);
        continue;
      }

      // แปลงเป็น JPEG คุณภาพดี
      const processed = await sharp(buffer)
        .jpeg({ quality: 85 })
        .toBuffer();

      frames.push({
        buffer: processed,
        source: 'youtube-frame',
        videoId,
        timestamp: label,
      });

      console.log(`${LOG_PREFIX} ✅ Auto-frame ${label}: ${metadata.width}x${metadata.height}`);
    } catch (err) {
      console.log(`${LOG_PREFIX} Auto-frame ${label} error: ${err.message?.slice(0, 60)}`);
    }
  }

  return frames;
}

// ==========================================
// Utility: ตรวจสอบภาพว่างเปล่า
// ==========================================

/**
 * ตรวจว่าภาพเป็นสีเดียว/ว่างเปล่าหรือไม่
 * ใช้ Sharp stats() → ถ้า standard deviation ต่ำมาก = ภาพว่าง
 */
async function checkIfBlank(buffer) {
  try {
    const stats = await sharp(buffer).stats();
    // ถ้าทุก channel มี std deviation < 5 → น่าจะเป็นสีเดียว
    const allLow = stats.channels.every((ch) => ch.stdev < 5);
    return allLow;
  } catch {
    return false; // ถ้า stats ไม่ได้ ให้ถือว่าไม่ blank
  }
}

// ==========================================
// Search + Extract: ค้นหา YouTube แล้วดึงเฟรม
// ==========================================

/**
 * ค้นหาวิดีโอ YouTube ด้วย query แล้วดึงเฟรมจากผลลัพธ์
 * ใช้โดย Agent 2 ใน multiAgentImageScraper.js
 * @param {string} query - คำค้นหา
 * @param {number} maxVideos - จำนวนวิดีโอสูงสุดที่จะค้นหา (default: 5)
 * @returns {Promise<Array<{buffer: Buffer, source: string, videoId: string, timestamp: string}>>}
 */
export async function searchAndExtractFrames(query, maxVideos = 5) {
  // Step 1: Search YouTube using YouTube Data API v3
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.log(`${LOG_PREFIX} ❌ No YOUTUBE_API_KEY for search`);
    return [];
  }

  try {
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&key=${apiKey}&maxResults=${maxVideos}&relevanceLanguage=th&regionCode=TH`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(searchUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.log(`${LOG_PREFIX} YouTube search HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    const videoIds = (data.items || [])
      .map(item => item.id?.videoId)
      .filter(Boolean);

    if (videoIds.length === 0) {
      console.log(`${LOG_PREFIX} No videos found for: "${query}"`);
      return [];
    }

    console.log(`${LOG_PREFIX} Found ${videoIds.length} videos: ${videoIds.join(', ')}`);

    // Step 2: Extract frames using existing function
    const frames = await extractYouTubeFrames(videoIds);

    // Step 3: Filter + Upscale frames
    // ★ ภาพ 160x90 เล็กเกินไป — upscale ไปก็เบลอ ต้อง reject
    const upscaledFrames = [];
    for (const frame of frames) {
      try {
        const meta = await sharp(frame.buffer).metadata();
        
        // ★ Reject frame ที่เล็กเกินไป (ต้นทาง < 320x180 = thumbnail ขนาดจิ๋ว)
        if (meta.width < 320 || meta.height < 180) {
          console.log(`${LOG_PREFIX} ❌ Rejected tiny frame ${meta.width}x${meta.height} (need 320x180+)`);
          continue; // ข้ามเลย ไม่ upscale
        }
        
        // Upscale frame ที่ขนาดปานกลาง (320-640) ให้ใหญ่ขึ้น
        if (meta.width < 800) {
          const scale = Math.min(3, Math.ceil(960 / meta.width));
          const targetW = meta.width * scale;
          const targetH = meta.height * scale;
          frame.buffer = await sharp(frame.buffer)
            .resize(targetW, targetH, { 
              fit: 'inside', 
              kernel: 'lanczos3',
              withoutEnlargement: false 
            })
            .sharpen({ sigma: 1.2 })
            .jpeg({ quality: 92 })
            .toBuffer();
          console.log(`${LOG_PREFIX} Upscaled frame from ${meta.width}x${meta.height} → ${targetW}x${targetH}`);
        }
        upscaledFrames.push(frame);
      } catch (upErr) {
        upscaledFrames.push(frame); // Keep original if upscale fails
      }
    }

    return upscaledFrames;
  } catch (err) {
    console.log(`${LOG_PREFIX} searchAndExtractFrames error: ${err.message}`);
    return [];
  }
}
