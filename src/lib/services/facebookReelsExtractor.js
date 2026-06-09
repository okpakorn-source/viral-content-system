/**
 * =====================================================
 * Facebook Reels Frame Extractor (v2 — Serper Thumbnail)
 * =====================================================
 * หา Facebook Reels จาก Google Search แล้วดึง thumbnail จาก Serper โดยตรง
 * 
 * Strategy (v2 — ไม่ใช้ Bright Data แล้ว):
 * 1. ใช้ Serper Web Search → หา Facebook Reel URLs + thumbnail
 * 2. Primary: ใช้ imageUrl จาก Serper result (Google cached thumbnail)
 * 3. Fallback: ใช้ og:image จาก Reel URL (ถ้า Serper ไม่มี thumbnail)
 * 4. Download thumbnail → sharp resize → return image data
 * 
 * Timeout: 12s overall
 */
import sharp from 'sharp';

const LOG_PREFIX = '[FBReelsExtractor]';
const MAX_REELS = 6;
const OVERALL_TIMEOUT_MS = 12000;

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// ==========================================
// Helper: Fetch with timeout
// ==========================================
async function fetchWithTimeout(url, options = {}) {
  const { timeout = 10000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      ...fetchOptions,
      headers: { ...DEFAULT_HEADERS, ...(fetchOptions.headers || {}) },
      signal: controller.signal,
      redirect: 'follow',
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ค้นหาและดึง frames จาก Facebook Reels
 * @param {Object} identity - identity object จาก AI pipeline
 * @param {string} identity.mainCharacter - ชื่อบุคคลหลัก เช่น "ชมพู่ อารยา"
 * @param {Object} [identity.coreStory] - ข้อมูลแกนเรื่อง
 * @returns {Promise<string[]>} - array ของ image URL strings
 */
export async function searchAndExtractReelFrames(identity) {
  const serperKey = process.env.SERPER_API_KEY;
  if (!serperKey) {
    console.log(`${LOG_PREFIX} ❌ No SERPER_API_KEY — skipping Facebook Reels search`);
    return [];
  }

  const overallDeadline = Date.now() + OVERALL_TIMEOUT_MS;

  try {
    // === Step 1: Search Google for Facebook Reel URLs + thumbnails ===
    const hero = identity?.mainCharacter || '';
    if (!hero) {
      console.log(`${LOG_PREFIX} ❌ No mainCharacter in identity — skipping`);
      return [];
    }

    const storySubject = identity?.coreStory?.storySubject || '';
    const queries = [
      `site:facebook.com/reel "${hero}"`,
      storySubject ? `site:facebook.com/reel ${hero} ${storySubject}` : '',
    ].filter(Boolean);

    console.log(`${LOG_PREFIX} 🔍 Searching Facebook Reels for: "${hero}" (${queries.length} queries)`);

    const reelResults = await searchReelUrlsWithThumbnails(serperKey, queries);

    if (reelResults.length === 0) {
      console.log(`${LOG_PREFIX} ❌ No Facebook Reel URLs found for: "${hero}"`);
      return [];
    }

    console.log(`${LOG_PREFIX} 📎 Found ${reelResults.length} Reels (${reelResults.filter(r => r.imageUrl).length} with thumbnails)`);

    // === Step 2: If no thumbnails from web search, try Serper IMAGE Search ===
    const allImageUrls = [];
    const hasAnyThumbnail = reelResults.some(r => r.imageUrl);

    if (!hasAnyThumbnail) {
      console.log(`${LOG_PREFIX} 🖼️ No web thumbnails — trying Serper Image Search...`);
      const imageResults = await searchReelImages(serperKey, hero, storySubject);
      for (const imgUrl of imageResults) {
        if (Date.now() >= overallDeadline) break;
        const processed = await downloadAndProcessThumbnail(imgUrl, 'serper-image-search');
        if (processed) allImageUrls.push(processed);
      }
      if (allImageUrls.length > 0) {
        console.log(`${LOG_PREFIX} ✅ Total: ${allImageUrls.length} Facebook Reel images (from Image Search)`);
        return allImageUrls;
      }
    }

    // === Step 3: Download thumbnails from web search results ===
    for (const reel of reelResults) {
      if (Date.now() >= overallDeadline) {
        console.log(`${LOG_PREFIX} ⏰ Timeout — stopping`);
        break;
      }

      try {
        // Strategy A: Serper thumbnail (Google cached — fast + reliable)
        if (reel.imageUrl) {
          const processed = await downloadAndProcessThumbnail(reel.imageUrl, 'serper-thumbnail');
          if (processed) {
            allImageUrls.push(processed);
            continue;
          }
        }

        // Strategy B: Serper sitelinks images
        if (reel.sitelinks?.length > 0) {
          for (const sl of reel.sitelinks.slice(0, 2)) {
            if (sl.imageUrl) {
              const processed = await downloadAndProcessThumbnail(sl.imageUrl, 'serper-sitelink');
              if (processed) {
                allImageUrls.push(processed);
                break;
              }
            }
          }
          if (allImageUrls.length > 0) continue;
        }

        // Strategy C: og:image fallback (direct fetch — might be blocked)
        const ogImage = await extractOgImage(reel.url);
        if (ogImage) {
          allImageUrls.push(ogImage);
        }
      } catch (err) {
        console.log(`${LOG_PREFIX} Error processing ${reel.url?.slice(0, 50)}: ${err.message?.slice(0, 60)}`);
      }
    }

    const unique = [...new Set(allImageUrls)];
    console.log(`${LOG_PREFIX} ✅ Total: ${unique.length} Facebook Reel images`);
    return unique;

  } catch (err) {
    console.log(`${LOG_PREFIX} Error: ${err.message}`);
    return [];
  }
}

// ==========================================
// Step 1: Search Facebook Reel URLs + thumbnails via Serper
// ==========================================
async function searchReelUrlsWithThumbnails(serperKey, queries) {
  const allResults = [];
  const seenUrls = new Set();

  for (const query of queries) {
    try {
      const res = await fetchWithTimeout('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: query,
          gl: 'th', hl: 'th', num: 10,
        }),
        timeout: 8000,
      });

      if (!res.ok) {
        console.log(`${LOG_PREFIX} Serper HTTP ${res.status} for query: "${query.slice(0, 50)}"`);
        continue;
      }

      const data = await res.json();
      const results = data.organic || [];

      // Filter: เอาเฉพาะ URL ที่เป็น Facebook Reel
      for (const r of results) {
        const url = r.link || '';
        if (/facebook\.com\/reel\/\d+/i.test(url) && !seenUrls.has(url)) {
          seenUrls.add(url);
          allResults.push({
            url,
            title: r.title || '',
            snippet: r.snippet || '',
            imageUrl: r.imageUrl || r.thumbnailUrl || '',     // Google cached thumbnail
            sitelinks: r.sitelinks || [],
          });
        }
      }

      // ลอง Image Search ด้วย (ได้ภาพ thumbnail ชัดกว่า)
      const imageResults = data.images || [];
      for (const img of imageResults) {
        const url = img.link || img.sourceUrl || '';
        if (/facebook\.com\/reel\/\d+/i.test(url) && !seenUrls.has(url)) {
          seenUrls.add(url);
          allResults.push({
            url,
            title: img.title || '',
            snippet: '',
            imageUrl: img.imageUrl || img.thumbnailUrl || '',
            sitelinks: [],
          });
        }
      }

      console.log(`${LOG_PREFIX} Serper query "${query.slice(0, 40)}": ${results.filter(r => /facebook\.com\/reel/i.test(r.link)).length} reel URLs`);
    } catch (err) {
      console.log(`${LOG_PREFIX} Serper error: ${err.message?.slice(0, 60)}`);
    }
  }

  return allResults.slice(0, MAX_REELS);
}

// ==========================================
// Step 2: Serper IMAGE Search — ดึง thumbnail จาก Google Images โดยตรง
// ==========================================
async function searchReelImages(serperKey, hero, storySubject) {
  const imageUrls = [];
  const queries = [
    `"${hero}" facebook reel`,
    storySubject ? `"${hero}" ${storySubject} reel` : '',
    `"${hero}" reels video`,
  ].filter(Boolean);

  for (const query of queries) {
    try {
      const res = await fetchWithTimeout('https://google.serper.dev/images', {
        method: 'POST',
        headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: query,
          gl: 'th', hl: 'th', num: 6,
        }),
        timeout: 8000,
      });

      if (!res.ok) {
        console.log(`${LOG_PREFIX} Serper Images HTTP ${res.status}`);
        continue;
      }

      const data = await res.json();
      const images = data.images || [];

      for (const img of images) {
        const imgUrl = img.imageUrl || '';
        const sourceUrl = img.link || img.sourceUrl || '';
        
        // เอาภาพที่มาจาก Facebook หรือเกี่ยวข้องกับ hero
        if (imgUrl && imgUrl.startsWith('http')) {
          // Prefer Facebook source images
          const isFacebookSource = /facebook\.com|fbcdn\.net/i.test(sourceUrl) || /facebook\.com|fbcdn\.net/i.test(imgUrl);
          if (isFacebookSource || imageUrls.length < 3) {
            if (!imageUrls.includes(imgUrl)) {
              imageUrls.push(imgUrl);
              console.log(`${LOG_PREFIX} 🖼️ Image Search: ${imgUrl.slice(0, 80)} (source: ${sourceUrl.slice(0, 40)})`);
            }
          }
        }
        
        if (imageUrls.length >= 4) break;
      }

      console.log(`${LOG_PREFIX} Serper Images "${query.slice(0, 40)}": ${images.length} results, ${imageUrls.length} selected`);
    } catch (err) {
      console.log(`${LOG_PREFIX} Serper Images error: ${err.message?.slice(0, 60)}`);
    }

    if (imageUrls.length >= 4) break;
  }

  return imageUrls.slice(0, MAX_REELS);
}

// ==========================================
// Fallback: og:image from Reel HTML
// ==========================================
async function extractOgImage(reelUrl) {
  try {
    console.log(`${LOG_PREFIX} 🔄 Fallback: fetching og:image from ${reelUrl.slice(0, 60)}`);

    const res = await fetchWithTimeout(reelUrl, {
      timeout: 6000,
      headers: {
        ...DEFAULT_HEADERS,
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!res.ok) {
      console.log(`${LOG_PREFIX} og:image fetch HTTP ${res.status}`);
      return null;
    }

    const html = await res.text();

    // Parse og:image from HTML meta tags
    const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)
      || html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);

    if (!ogImageMatch || !ogImageMatch[1]) {
      console.log(`${LOG_PREFIX} No og:image found in HTML`);
      return null;
    }

    const ogImageUrl = ogImageMatch[1].replace(/&amp;/g, '&');
    console.log(`${LOG_PREFIX} 🖼️ Found og:image: ${ogImageUrl.slice(0, 80)}`);

    const processed = await downloadAndProcessThumbnail(ogImageUrl, 'fb-reel-ogimage');
    return processed;

  } catch (err) {
    console.log(`${LOG_PREFIX} og:image error: ${err.message?.slice(0, 60)}`);
    return null;
  }
}

// ==========================================
// Download thumbnail → sharp resize → return data URL
// ==========================================
async function downloadAndProcessThumbnail(imageUrl, sourceLabel) {
  try {
    if (!imageUrl || !imageUrl.startsWith('http')) return null;

    const res = await fetchWithTimeout(imageUrl, { timeout: 6000 });
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 2000) {
      console.log(`${LOG_PREFIX} Image too small (${buffer.length} bytes), skipping`);
      return null;
    }

    const meta = await sharp(buffer).metadata();
    if (!meta.width || meta.width < 200 || !meta.height || meta.height < 200) {
      console.log(`${LOG_PREFIX} Image too small resolution: ${meta.width}x${meta.height}`);
      return null;
    }

    // Resize to landscape 960x540 for cover compatibility
    const processed = await sharp(buffer)
      .resize({ width: 960, height: 540, fit: 'cover', position: 'centre' })
      .sharpen({ sigma: 0.6 })
      .jpeg({ quality: 90 })
      .toBuffer();

    console.log(`${LOG_PREFIX} ✅ ${sourceLabel}: ${meta.width}x${meta.height} → 960x540`);

    // Return as data URL string (compatible with multiAgentImageScraper)
    const base64 = processed.toString('base64');
    return `data:image/jpeg;base64,${base64}`;

  } catch (err) {
    console.log(`${LOG_PREFIX} Download/process error: ${err.message?.slice(0, 60)}`);
    return null;
  }
}
