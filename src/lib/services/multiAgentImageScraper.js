import * as cheerio from 'cheerio';
import { GoogleGenerativeAI } from '@google/generative-ai';
import sharp from 'sharp';

// ==========================================
// Helper: Fetch with timeout
// ==========================================
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
};

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 10000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const response = await fetch(resource, {
    ...options,
    headers: { ...DEFAULT_HEADERS, ...(options.headers || {}) },
    signal: controller.signal,
    redirect: 'follow'
  });
  clearTimeout(id);
  return response;
}

// ==========================================
// Helper: Download image for AI Vision
// ==========================================
async function downloadForVision(url) {
  try {
    const res = await fetchWithTimeout(url, { timeout: 8000 });
    if (!res.ok) {
      console.log(`[Download] Failed ${res.status} for ${url.substring(0, 80)}`);
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length < 2000) {
      console.log(`[Download] Too small (${buffer.length} bytes), skipping: ${url.substring(0, 80)}`);
      return null;
    }

    const resized = await sharp(buffer)
      .resize(512, 512, { fit: 'inside' })
      .jpeg({ quality: 80 })
      .toBuffer();

    return {
      inlineData: {
        data: resized.toString('base64'),
        mimeType: 'image/jpeg'
      }
    };
  } catch (e) {
    console.log(`[Download] Error for ${url.substring(0, 60)}: ${e.message}`);
    return null;
  }
}

// ==========================================
// Blocked domains & URL filters
// ==========================================
const BLOCKED_DOMAINS = [
  'amarintv.com', 'amarin.co.th', 'thairath.co.th', 'khaosod.co.th',
  'sanook.com', 'mgronline.com', 'ch7.com', 'thaipbs.or.th',
  'matichon.co.th', 'dailynews.co.th', 'bangkokpost.com',
  'nationtv.tv', 'pptvhd36.com', 'one31.net', 'ch3thailand.com',
  'workpointtoday.com', 'mono29.com', 'tnn16.com', 'springnews.co.th',
  // Social media — ดาวน์โหลดภาพตรงไม่ได้ (403/redirect)
  'tiktok.com', 'fbsbx.com', 'fbcdn.net', 'facebook.com',
  'lookaside.instagram.com', 'instagram.com', 'cdninstagram.com',
  'twitter.com', 'x.com', 'twimg.com'
];

const BLOCKED_URL_KEYWORDS = ['logo', 'icon', 'banner', 'watermark', 'avatar', 'sprite', 'pixel', 'tracking', 'crawler', 'widget'];

function isCleanImageUrl(url) {
  if (!url || !url.startsWith('http')) return false;
  const lower = url.toLowerCase();
  if (BLOCKED_DOMAINS.some(domain => lower.includes(domain))) return false;
  if (BLOCKED_URL_KEYWORDS.some(kw => lower.includes(kw))) return false;
  // Prefer direct image file URLs
  const hasImageExt = /\.(jpg|jpeg|png|webp|gif)/i.test(url);
  const isApiUrl = /\/api\//i.test(url);
  // If it's an API URL without image extension, skip it
  if (isApiUrl && !hasImageExt) return false;
  return true;
}

// ==========================================
// Agent 1: Google Clean Image Search (Serper API)
// 3 separate searches, block major Thai news sites
// ==========================================
async function agentGoogleCleanImages(identity) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.log('[Agent1: Google] ❌ No SERPER_API_KEY, skipping');
    return [];
  }

  const blockSitesParam = BLOCKED_DOMAINS.map(d => `-site:${d}`).join(' ');
  const allImages = [];

  // Search 1: Main keyword from identity.searchGoogle → 10 results
  const q1 = identity?.searchGoogle || '';
  if (q1) {
    console.log(`[Agent1: Google] Search 1: "${q1}" (10 results)`);
    try {
      const res = await fetchWithTimeout('https://google.serper.dev/images', {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: `${q1} ${blockSitesParam}`, gl: 'th', hl: 'th', num: 10 })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.images) {
          const urls = data.images.map(img => img.imageUrl).filter(isCleanImageUrl);
          console.log(`[Agent1: Google] Search 1 got ${urls.length} clean images`);
          allImages.push(...urls);
        }
      }
    } catch (e) { console.log('[Agent1: Google] Search 1 error:', e.message); }
  }

  // Search 2: Main character name → 5 results
  const q2 = identity?.mainCharacter || '';
  if (q2) {
    console.log(`[Agent1: Google] Search 2: "${q2}" (5 results)`);
    try {
      const res = await fetchWithTimeout('https://google.serper.dev/images', {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: `${q2} ${blockSitesParam}`, gl: 'th', hl: 'th', num: 5 })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.images) {
          const urls = data.images.map(img => img.imageUrl).filter(isCleanImageUrl);
          console.log(`[Agent1: Google] Search 2 got ${urls.length} clean images`);
          allImages.push(...urls);
        }
      }
    } catch (e) { console.log('[Agent1: Google] Search 2 error:', e.message); }
  }

  // Search 3: Main character + first key scene → 5 results
  const scene = identity?.keyScenes?.[0] || '';
  const q3 = `${q2} ${scene}`.trim();
  if (q3) {
    console.log(`[Agent1: Google] Search 3: "${q3}" (5 results)`);
    try {
      const res = await fetchWithTimeout('https://google.serper.dev/images', {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: `${q3} ${blockSitesParam}`, gl: 'th', hl: 'th', num: 5 })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.images) {
          const urls = data.images.map(img => img.imageUrl).filter(isCleanImageUrl);
          console.log(`[Agent1: Google] Search 3 got ${urls.length} clean images`);
          allImages.push(...urls);
        }
      }
    } catch (e) { console.log('[Agent1: Google] Search 3 error:', e.message); }
  }

  const unique = [...new Set(allImages)].slice(0, 15);
  console.log(`[Agent1: Google] ✅ Total: ${unique.length} unique clean images`);
  return unique;
}

// ==========================================
// Agent 2: YouTube Frame Capture (YouTube Data API v3)
// Search → 3 videos → all thumbnail variants + storyboard frames
// ==========================================
async function agentYouTubeFrames(identity) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.log('[Agent2: YouTube] ❌ No YOUTUBE_API_KEY, skipping');
    return [];
  }

  const query = identity?.searchYouTube || identity?.searchGoogle || '';
  if (!query) {
    console.log('[Agent2: YouTube] ❌ No search query available');
    return [];
  }

  console.log(`[Agent2: YouTube] Searching: "${query}" → 3 videos`);

  const allImages = [];

  try {
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&key=${apiKey}&maxResults=3&relevanceLanguage=th&regionCode=TH`;
    const response = await fetchWithTimeout(searchUrl, { timeout: 8000 });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      console.log(`[Agent2: YouTube] Search API error: ${response.status} — ${errBody.substring(0, 200)}`);
      return [];
    }

    const data = await response.json();
    const videos = data.items || [];
    console.log(`[Agent2: YouTube] Found ${videos.length} videos`);

    for (const item of videos) {
      const videoId = item.id?.videoId;
      if (!videoId) continue;

      console.log(`[Agent2: YouTube] Collecting frames for video: ${videoId}`);

      // Official thumbnails (highest quality first)
      allImages.push(`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`);
      allImages.push(`https://img.youtube.com/vi/${videoId}/sddefault.jpg`);
      allImages.push(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`);
      allImages.push(`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`);

      // Auto-generated storyboard frames (captured at different moments)
      allImages.push(`https://img.youtube.com/vi/${videoId}/1.jpg`);
      allImages.push(`https://img.youtube.com/vi/${videoId}/2.jpg`);
      allImages.push(`https://img.youtube.com/vi/${videoId}/3.jpg`);
    }

    console.log(`[Agent2: YouTube] ✅ Total: ${allImages.length} thumbnail/frame URLs from ${videos.length} clips`);
  } catch (e) {
    console.log('[Agent2: YouTube] Error:', e.message);
  }

  return allImages;
}

// ==========================================
// Agent 3: TikTok via Apify (with Serper fallback)
// ==========================================
async function agentTikTokImages(identity) {
  const apifyKey = process.env.APIFY_API_KEY;
  const serperKey = process.env.SERPER_API_KEY;
  const query = identity?.searchTikTok || identity?.searchGoogle || '';

  if (!query) {
    console.log('[Agent3: TikTok] ❌ No search query available');
    return [];
  }

  // --- Primary: Apify TikTok Scraper ---
  if (apifyKey) {
    console.log(`[Agent3: TikTok] Using Apify API with query: "${query}"`);
    try {
      // Start the actor run
      const startRes = await fetchWithTimeout(
        `https://api.apify.com/v2/acts/clockworks~free-tiktok-scraper/runs?token=${apifyKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            searchQueries: [query],
            resultsPerPage: 3
          }),
          timeout: 15000
        }
      );

      if (!startRes.ok) {
        console.log(`[Agent3: TikTok] Apify start failed: ${startRes.status}`);
        // Fall through to Serper fallback
      } else {
        const runData = await startRes.json();
        const runId = runData?.data?.id;
        console.log(`[Agent3: TikTok] Apify run started: ${runId}`);

        if (runId) {
          // Poll for completion (max 60s, check every 5s)
          let status = 'RUNNING';
          let attempts = 0;
          while (status === 'RUNNING' && attempts < 12) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            attempts++;

            try {
              const statusRes = await fetchWithTimeout(
                `https://api.apify.com/v2/actor-runs/${runId}?token=${apifyKey}`,
                { timeout: 8000 }
              );
              if (statusRes.ok) {
                const statusData = await statusRes.json();
                status = statusData?.data?.status || 'FAILED';
                console.log(`[Agent3: TikTok] Apify poll #${attempts}: ${status}`);
              }
            } catch (e) {
              console.log(`[Agent3: TikTok] Poll error: ${e.message}`);
            }
          }

          if (status === 'SUCCEEDED') {
            // Get results from dataset
            const datasetId = runData?.data?.defaultDatasetId;
            if (datasetId) {
              const dataRes = await fetchWithTimeout(
                `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyKey}&format=json`,
                { timeout: 10000 }
              );
              if (dataRes.ok) {
                const items = await dataRes.json();
                const covers = [];
                for (const item of items) {
                  // Extract cover images from various possible fields
                  if (item.videoMeta?.covers) {
                    covers.push(...(Array.isArray(item.videoMeta.covers) ? item.videoMeta.covers : [item.videoMeta.covers]));
                  }
                  if (item.covers?.default) covers.push(item.covers.default);
                  if (item.covers?.dynamic) covers.push(item.covers.dynamic);
                  if (item.coverUrl) covers.push(item.coverUrl);
                  if (item.dynamicCover) covers.push(item.dynamicCover);
                }
                const validCovers = covers.filter(u => u && u.startsWith('http'));
                console.log(`[Agent3: TikTok] ✅ Apify got ${validCovers.length} cover images`);
                return validCovers;
              }
            }
          } else {
            console.log(`[Agent3: TikTok] Apify run did not succeed (status: ${status}), falling back to Serper`);
          }
        }
      }
    } catch (e) {
      console.log(`[Agent3: TikTok] Apify error: ${e.message}, falling back to Serper`);
    }
  }

  // --- Fallback: Serper Image search with site:tiktok.com ---
  if (!serperKey) {
    console.log('[Agent3: TikTok] ❌ No SERPER_API_KEY for fallback, skipping');
    return [];
  }

  console.log(`[Agent3: TikTok] Fallback → Serper image search: "site:tiktok.com ${query}"`);
  try {
    const res = await fetchWithTimeout('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: `site:tiktok.com ${query}`, gl: 'th', hl: 'th', num: 5 })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.images) {
        const urls = data.images.map(img => img.imageUrl).filter(u => u && u.startsWith('http'));
        console.log(`[Agent3: TikTok] ✅ Serper fallback got ${urls.length} images`);
        return urls;
      }
    }
  } catch (e) {
    console.log(`[Agent3: TikTok] Serper fallback error: ${e.message}`);
  }

  return [];
}

// ==========================================
// AI Judge: Strict image selection with Gemini Vision
// Rejects watermarks, duplicates, cut faces
// Enforces scene diversity, assigns HERO/SUPPORT roles
// ==========================================
async function judgeImages(candidates, newsTitle, identity) {
  if (!candidates || candidates.length === 0) return [];

  console.log(`[Judge] 🔍 Downloading ${candidates.length} candidates for AI Vision analysis...`);

  const imageParts = [];
  const validCandidates = [];

  const results = await Promise.allSettled(candidates.map(url => downloadForVision(url)));

  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled' && results[i].value) {
      imageParts.push(results[i].value);
      validCandidates.push(candidates[i]);
    }
  }

  if (validCandidates.length === 0) {
    console.log('[Judge] ❌ No images could be downloaded');
    return [];
  }

  console.log(`[Judge] 📤 Sending ${imageParts.length} valid images to Gemini Vision...`);

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const mainChar = identity?.mainCharacter || 'ตัวละครหลักในข่าว';
    const storyContext = identity?.story || newsTitle;
    const emotion = identity?.emotion || 'neutral';
    const coverEmotion = identity?.coverEmotion || 'drama';

    const prompt = `คุณคือ Photo Editor มืออาชีพ สำหรับสำนักข่าวไวรัล กำลังเลือกภาพทำปกข่าว
You are a STRICT photo editor selecting images for a viral news cover.

📰 ข่าว / News: "${storyContext}"
🎭 ตัวละครหลัก / Main Character: "${mainChar}"
💢 อารมณ์ข่าว / Emotion: ${emotion} → Cover mood: ${coverEmotion}

มีภาพ ${imageParts.length} ภาพ (index 0 ถึง ${imageParts.length - 1}) ให้ตัดสิน

=== กฎเข้มงวด / STRICT RULES ===

❌ REJECT ทันที (score = 0):
1. ภาพมี text overlay, ข้อความซ้อน, ตัวหนังสือบนภาพ, lower-third graphics, TV show graphics
2. ภาพมี watermark, logo สำนักข่าว, แบนเนอร์, กราฟิกช่อง
3. ภาพซ้ำกัน (same person + same angle + same scene) → เก็บแค่ภาพที่คมที่สุด 1 ภาพ
4. ภาพที่หน้าถูกตัด (face cut off), เบลอ, มืดเกินไป
5. ภาพ collage / รูปรวม / screenshot จอทีวี / screenshot ข่าว
6. ภาพไม่เกี่ยวกับข่าวนี้เลย

✅ ACCEPT (score 5-10):
1. ภาพคมชัด หน้าเต็ม ไม่มีข้อความซ้อน
2. ภาพสะอาด ไม่มี watermark หรือ logo
3. ภาพแสดงอารมณ์ที่ตรงกับข่าว (${emotion})
4. มีความหลากหลายของซีน (different angles, different moments) → ห้ามเลือกแต่ภาพมุมเดียว

🏷️ ROLES:
- "HERO" (ต้องมีแค่ 1 ภาพเท่านั้น!): ภาพที่ดีที่สุด แสดง ${mainChar} ชัดเจน หน้าเต็ม อารมณ์ตรง
- "SUPPORT": ภาพเสริม บริบท มุมอื่น คนอื่นที่เกี่ยวข้อง สถานที่

=== OUTPUT FORMAT ===
Return JSON array เท่านั้น ห้ามมี markdown blocks
เลือกไม่เกิน 15 ภาพที่ score >= 5
HERO ต้องมีแค่ 1 ตัวเท่านั้น

[{"index": 0, "score": 10, "role": "HERO", "reason": "..."}, {"index": 3, "score": 8, "role": "SUPPORT", "reason": "..."}]`;

    const result = await model.generateContent([prompt, ...imageParts]);
    const responseText = result.response.text();

    // Parse JSON array from response
    const match = responseText.match(/\[[\s\S]*?\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);

      if (!Array.isArray(parsed) || parsed.length === 0) {
        console.log('[Judge] ⚠️ AI returned empty array, using fallback');
        return fallbackSelection(validCandidates);
      }

      console.log(`[Judge] AI scores:`, parsed.map(s => `#${s.index}=${s.score}(${s.role})`).join(', '));

      // Ensure only 1 HERO
      let heroAssigned = false;
      const validScores = parsed
        .filter(s => s.score >= 3 && s.index >= 0 && s.index < validCandidates.length)
        .sort((a, b) => {
          if (a.role === 'HERO' && b.role !== 'HERO') return -1;
          if (b.role === 'HERO' && a.role !== 'HERO') return 1;
          return b.score - a.score;
        });

      const selectedImages = [];
      for (const s of validScores) {
        let role = s.role || 'SUPPORT';
        if (role === 'HERO') {
          if (heroAssigned) role = 'SUPPORT'; // Demote extra HEROs
          else heroAssigned = true;
        }
        selectedImages.push({
          url: validCandidates[s.index],
          role: role
        });
      }

      if (selectedImages.length > 0) {
        // If judge was too strict (< 5 images), supplement with remaining candidates
        if (selectedImages.length < 5) {
          const selectedUrls = new Set(selectedImages.map(i => i.url));
          for (const candidate of validCandidates) {
            if (selectedImages.length >= 10) break;
            if (!selectedUrls.has(candidate)) {
              selectedImages.push({ url: candidate, role: 'SUPPORT' });
              selectedUrls.add(candidate);
            }
          }
          console.log(`[Judge] 📦 Supplemented to ${selectedImages.length} images (judge was strict)`);
        }
        console.log(`[Judge] ✅ Selected ${selectedImages.length} images (${selectedImages.filter(i => i.role === 'HERO').length} HERO, ${selectedImages.filter(i => i.role === 'SUPPORT').length} SUPPORT)`);
        return selectedImages;
      }
    }

    console.log('[Judge] ⚠️ Could not parse AI response, using fallback');
    return fallbackSelection(validCandidates);
  } catch (e) {
    console.log('[Judge] ❌ AI Vision Error:', e.message);
    return fallbackSelection(validCandidates);
  }
}

function fallbackSelection(candidates) {
  const shuffled = [...candidates].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, 10).map((url, i) => ({
    url,
    role: i === 0 ? 'HERO' : 'SUPPORT'
  }));
}

// ==========================================
// Main Orchestrator
// Run all 3 agents in parallel → deduplicate → judge
// ==========================================
export async function runMultiAgentImageSearch(url, sourceType, entities, newsTitle, identity) {
  console.log('============================================');
  console.log('[MultiAgent] 🚀 Starting parallel image search');
  console.log(`[MultiAgent] News: "${(newsTitle || '').slice(0, 60)}..."`);
  console.log(`[MultiAgent] Main character: ${identity?.mainCharacter || 'unknown'}`);
  console.log(`[MultiAgent] Search queries:`);
  console.log(`  Google: ${identity?.searchGoogle || 'N/A'}`);
  console.log(`  YouTube: ${identity?.searchYouTube || 'N/A'}`);
  console.log(`  TikTok: ${identity?.searchTikTok || 'N/A'}`);
  console.log('============================================');

  // Run all 3 agents in parallel
  const [googleResult, youtubeResult, tiktokResult] = await Promise.allSettled([
    agentGoogleCleanImages(identity),
    agentYouTubeFrames(identity),
    agentTikTokImages(identity)
  ]);

  // Collect results from each agent
  const googleImages = googleResult.status === 'fulfilled' ? googleResult.value : [];
  const youtubeImages = youtubeResult.status === 'fulfilled' ? youtubeResult.value : [];
  const tiktokImages = tiktokResult.status === 'fulfilled' ? tiktokResult.value : [];

  console.log('============================================');
  console.log(`[MultiAgent] Agent results:`);
  console.log(`  Agent 1 (Google):  ${googleImages.length} images ${googleResult.status !== 'fulfilled' ? '⚠️ FAILED: ' + googleResult.reason : ''}`);
  console.log(`  Agent 2 (YouTube): ${youtubeImages.length} images ${youtubeResult.status !== 'fulfilled' ? '⚠️ FAILED: ' + youtubeResult.reason : ''}`);
  console.log(`  Agent 3 (TikTok):  ${tiktokImages.length} images ${tiktokResult.status !== 'fulfilled' ? '⚠️ FAILED: ' + tiktokResult.reason : ''}`);

  // Combine and deduplicate
  let candidates = [...googleImages, ...youtubeImages, ...tiktokImages];
  candidates = [...new Set(candidates)];

  console.log(`[MultiAgent] Combined unique candidates: ${candidates.length}`);

  // Cap at 30 for the judge
  if (candidates.length > 30) {
    candidates = candidates.sort(() => 0.5 - Math.random()).slice(0, 30);
    console.log(`[MultiAgent] Capped to 30 candidates for judging`);
  }

  console.log(`[MultiAgent] 🏛️ Sending ${candidates.length} candidates to AI Judge...`);
  console.log('============================================');

  const selectedImages = await judgeImages(candidates, newsTitle, identity);

  console.log('============================================');
  console.log(`[MultiAgent] 🏁 Final selection: ${selectedImages.length} images`);
  console.log('============================================');

  return selectedImages;
}
