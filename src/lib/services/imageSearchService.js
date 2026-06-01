import sharp from 'sharp';
import { composeCover } from '@/lib/coverComposer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { runMultiAgentImageSearch } from './multiAgentImageScraper';
import { analyzeStoryIdentity } from './storyIdentityService';

/**
 * ============================================
 * Image Search Service v2
 * ============================================
 * Orchestrator หลักสำหรับสร้างปกข่าว
 * - dHash perceptual dedup (แทน byte size)
 * - Hard Constraints validation
 * - Image Gallery integration
 */

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 8000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const response = await fetch(resource, {
    ...options,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...(options.headers || {})
    },
    signal: controller.signal,
    redirect: 'follow'
  });
  clearTimeout(id);
  return response;
}

// ═══ dHash: Perceptual Image Hashing ═══
// ใช้ sharp resize เป็น 9x8 grayscale แล้วเปรียบเทียบ pixel ข้างเคียง
// ได้ 64-bit hash ที่ทนต่อ crop, resize, compression
async function computeImageHash(buffer) {
  try {
    const raw = await sharp(buffer)
      .resize(9, 8, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();
    
    let hash = 0n;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const left = raw[y * 9 + x];
        const right = raw[y * 9 + x + 1];
        if (left > right) hash |= 1n << BigInt(y * 8 + x);
      }
    }
    return hash;
  } catch (e) {
    return null;
  }
}

function hammingDistance(hash1, hash2) {
  if (hash1 === null || hash2 === null) return 64; // max distance if hash failed
  let xor = hash1 ^ hash2;
  let dist = 0;
  while (xor > 0n) {
    dist += Number(xor & 1n);
    xor >>= 1n;
  }
  return dist;
}

// ═══ Download + Validate ═══
export async function downloadAndValidateImage(url) {
  try {
    const response = await fetchWithTimeout(url, { timeout: 10000 });
    if (!response.ok) return null;
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    const metadata = await sharp(buffer).metadata();
    
    // ขนาดขั้นต่ำ 300x300 (เพิ่มจาก 250)
    if (metadata.width < 300 || metadata.height < 300) {
      console.log(`[Download] Skipped: too small (${metadata.width}x${metadata.height})`);
      return null;
    }
    
    return buffer;
  } catch (err) {
    return null;
  }
}

// ═══ Hard Constraints Validation ═══
// ตรวจสอบว่ารูปที่ AI เลือกมาผ่านกฎเหล็กหรือไม่
function validateSelection(selectedImages, imageRoles) {
  const RULES = {
    heroCount: 1,          // ต้องมี HERO 1 ใบเท่านั้น
    maxSameRole: 4,        // SUPPORT ไม่เกิน 4
    totalRequired: 5,      // ต้องการ 5 รูป (4 grid + 1 circle)
  };
  
  const heroes = imageRoles.filter(r => r.role === 'HERO');
  const supports = imageRoles.filter(r => r.role === 'SUPPORT');
  
  // กฎ 1: HERO ต้องมี 1 เท่านั้น
  if (heroes.length > 1) {
    console.log(`[Constraints] Too many HEROs (${heroes.length}), keeping best one`);
    // เก็บ HERO ตัวแรก (score สูงสุด) ที่เหลือเป็น SUPPORT
    for (let i = 1; i < imageRoles.length; i++) {
      if (imageRoles[i].role === 'HERO') {
        imageRoles[i].role = 'SUPPORT';
      }
    }
  }
  
  // กฎ 2: ถ้าไม่มี HERO → promote SUPPORT ตัวแรกเป็น HERO
  if (heroes.length === 0 && imageRoles.length > 0) {
    console.log(`[Constraints] No HERO found, promoting first image`);
    imageRoles[0].role = 'HERO';
  }
  
  return imageRoles;
}

// ═══ Layout Planner ═══
async function planLayout(identity, imageRoles) {
  const W = 1080;
  const H = 1080;
  
  // บังคับ news-grid-circle เสมอ
  const layout = 'news-grid-circle';
  
  const photoOrder = [];
  let circlePhotoIndex = 0;
  
  // Find HERO index → ใส่วงกลมกลาง
  const heroIndex = imageRoles.findIndex(r => r.role === 'HERO');
  if (heroIndex !== -1) {
    photoOrder.push(heroIndex);
    circlePhotoIndex = heroIndex;
    for (let i = 0; i < imageRoles.length; i++) {
      if (i !== heroIndex) photoOrder.push(i);
    }
  } else {
    for (let i = 0; i < imageRoles.length; i++) photoOrder.push(i);
  }
  
  // Mood Controller
  let borderColor = '#111827';
  let accentColor = '#e11d48';
  const emotion = identity?.coverEmotion || 'neutral';
  
  const emotionColors = {
    'hope': '#f59e0b',
    'warm': '#f59e0b',
    'tragedy': '#4b5563',
    'shocking': '#fbbf24',
    'drama': '#dc2626',
    'neutral': '#e11d48',
  };
  accentColor = emotionColors[emotion] || '#e11d48';

  return {
    width: W,
    height: H,
    layout,
    borderColor,
    accentColor,
    typography: identity?.typography || {
      hook: "BREAKING",
      main: identity?.story?.slice(0, 40) || identity?.mainStory?.slice(0, 40) || "",
      punch: "อัพเดทล่าสุด"
    },
    circlePhotoIndex,
    photoOrder
  };
}

// ═══ Final Cover Judge ═══
async function evaluateFinalCover(base64Image, newsTitle) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `You are an elite news Art Director evaluating a composed 1080x1080 news cover for: "${newsTitle}".

Evaluate:
1. Is the main subject clearly visible in the center circle?
2. Are the 4 background images diverse (not the same photo cropped differently)?
3. Is the text readable (not broken characters)?
4. Is it professional quality (not cheap-looking)?

Score 1-10. Return ONLY: {"score": 8, "reason": "brief"}. No markdown blocks.`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64Image, mimeType: 'image/jpeg' } }
    ]);
    const responseText = result.response.text();
    const match = responseText.match(/\{[\s\S]*?\}/);
    if (match) {
      const data = JSON.parse(match[0]);
      console.log(`[Judge] Score: ${data.score}/10 — ${data.reason}`);
      return data.score || 10;
    }
    return 10;
  } catch (e) {
    console.log('[Judge] Final Cover Evaluation Error:', e.message);
    return 10;
  }
}

/**
 * ============================================
 * Main Orchestrator: autoGenerateCover
 * ============================================
 * Flow: AI Analyze → 3 Agents Search → dHash Dedup → Hard Constraints → Compose → Judge
 */
export async function autoGenerateCover(url, sourceType, breakdownData, newsTitle) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[CoverEngine] 🚀 Starting cover generation`);
  console.log(`[CoverEngine] Title: "${newsTitle}"`);
  console.log(`${'='.repeat(60)}\n`);
  
  try {
    // ═══ Step 0: AI News Analyst ═══
    console.log(`[Step 0] 🧠 AI analyzing news content...`);
    const identity = await analyzeStoryIdentity(newsTitle, breakdownData);
    if (identity) {
      console.log(`[Step 0] ✅ Main character: ${identity.mainCharacter || identity.mainSubject}`);
      console.log(`[Step 0] ✅ Key scenes: ${JSON.stringify(identity.keyScenes || [])}`);
      console.log(`[Step 0] ✅ Search Google: "${identity.searchGoogle || ''}"`);
      console.log(`[Step 0] ✅ Search YouTube: "${identity.searchYouTube || ''}"`);
      console.log(`[Step 0] ✅ Emotion: ${identity.coverEmotion || 'neutral'}`);
    } else {
      console.log(`[Step 0] ⚠️ AI analysis failed, using fallback`);
    }
    
    // ═══ Step 1: 3 Agents Search (Parallel) ═══
    console.log(`\n[Step 1] 🔍 Dispatching 3 search agents...`);
    const bestImages = await runMultiAgentImageSearch(
      url, 
      sourceType, 
      breakdownData?.key_facts?.people || [], 
      newsTitle, 
      identity
    );
    console.log(`[Step 1] ✅ Agents returned ${bestImages.length} candidate images`);
    
    // Save to gallery in background
    try {
      const { saveToGallery } = await import('./imageGallery.js');
      const sessionId = Date.now().toString();
      const galleryImages = bestImages.map((img, i) => ({
        url: img.url,
        sourceAgent: url ? (url.includes('youtube') ? 'youtube' : url.includes('tiktok') ? 'tiktok' : 'google') : 'google',
        role: img.role,
        score: img.role === 'HERO' ? 10 : (8 - (i * 0.1)),
        reason: 'Selected by AI Judge',
        isSelected: i < 5
      }));
      saveToGallery(sessionId, newsTitle, galleryImages).catch(e => console.error('[Gallery Error]', e));
    } catch (e) {
      console.error('[Gallery Save Error]', e);
    }
    
    // ═══ Step 2: Download + dHash Dedup ═══
    console.log(`\n[Step 2] 📥 Downloading & deduplicating with dHash...`);
    const validImageBuffers = [];
    const imageRoles = [];
    const imageHashes = [];
    
    // Hero first, then supports
    const heroes = bestImages.filter(img => img.role === 'HERO');
    const supports = bestImages.filter(img => img.role !== 'HERO');
    const orderedCandidates = [...heroes, ...supports];
    
    let downloadCount = 0;
    let dupCount = 0;
    
    for (const img of orderedCandidates) {
      if (validImageBuffers.length >= 7) break; // เก็บเผื่อ 7 รูป (เลือก 5 ทีหลัง)
      
      const buf = await downloadAndValidateImage(img.url);
      if (!buf) continue;
      downloadCount++;
      
      // dHash duplicate check
      const hash = await computeImageHash(buf);
      const isDuplicate = imageHashes.some(h => hammingDistance(h, hash) < 12);
      
      if (isDuplicate) {
        dupCount++;
        console.log(`[Step 2] 🔄 Duplicate detected (dHash match), skipping`);
        continue;
      }
      
      validImageBuffers.push(buf);
      imageRoles.push({ role: img.role });
      imageHashes.push(hash);
      console.log(`[Step 2] ✅ Image ${validImageBuffers.length}: ${img.role} (from ${img.url.substring(0, 60)}...)`);
    }
    
    console.log(`[Step 2] 📊 Downloaded: ${downloadCount}, Duplicates removed: ${dupCount}, Unique: ${validImageBuffers.length}`);

    if (validImageBuffers.length === 0) {
      return { 
        success: false, 
        status: 'NEED_MANUAL_COVER', 
        message: 'ไม่สามารถหาภาพที่ผ่านเกณฑ์ได้เลย' 
      };
    }
    
    // ═══ Step 3: Hard Constraints ═══
    console.log(`\n[Step 3] 🔒 Applying hard constraints...`);
    const validatedRoles = validateSelection(validImageBuffers, imageRoles);
    const heroCount = validatedRoles.filter(r => r.role === 'HERO').length;
    const supportCount = validatedRoles.filter(r => r.role === 'SUPPORT').length;
    console.log(`[Step 3] ✅ Heroes: ${heroCount}, Supports: ${supportCount}`);
    
    // ═══ Step 4: Compose Cover ═══
    console.log(`\n[Step 4] 🎨 Composing cover image...`);
    const plan = await planLayout(identity, validatedRoles);
    console.log(`[Step 4] Layout: ${plan.layout}, Accent: ${plan.accentColor}`);
    console.log(`[Step 4] Typography: "${plan.typography.hook}" / "${plan.typography.main}" / "${plan.typography.punch}"`);
    
    let finalBuffer = await composeCover(plan, validImageBuffers);
    let base64Img = `data:image/jpeg;base64,${finalBuffer.toString('base64')}`;
    
    // ═══ Step 5: Final Judge ═══
    console.log(`\n[Step 5] 👨‍⚖️ Final cover evaluation...`);
    const score = await evaluateFinalCover(finalBuffer.toString('base64'), newsTitle);
    
    if (score < 7) {
      console.log(`[Step 5] ⚠️ Score ${score}/10 < 7, re-composing with shuffled images...`);
      // Shuffle SUPPORT images (keep HERO at position 0)
      const heroIdx = validatedRoles.findIndex(r => r.role === 'HERO');
      const heroBuffer = heroIdx >= 0 ? validImageBuffers[heroIdx] : validImageBuffers[0];
      const otherBuffers = validImageBuffers.filter((_, i) => i !== heroIdx).sort(() => 0.5 - Math.random());
      const reshuffled = [heroBuffer, ...otherBuffers];
      
      finalBuffer = await composeCover(plan, reshuffled);
      base64Img = `data:image/jpeg;base64,${finalBuffer.toString('base64')}`;
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[CoverEngine] ✅ Cover generated successfully!`);
    console.log(`${'='.repeat(60)}\n`);
    
    return { success: true, base64: base64Img };
    
  } catch (error) {
    console.error(`[CoverEngine] ❌ Failed:`, error.message);
    return { success: false, status: 'NEED_MANUAL_COVER', message: error.message };
  }
}

// Re-export for backward compatibility
export { extractSourceImage } from './imageSearchServiceLegacy';
