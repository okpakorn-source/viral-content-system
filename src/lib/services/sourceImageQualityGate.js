/**
 * Source Image Quality Gate — Phase 3
 * ─────────────────────────────────────────────────────────────
 * Classifies source images as CLEAN_PHOTO, TEXT_OVERLAY, NEWS_THUMBNAIL, etc.
 * Blocks or downgrades bad sources BEFORE they reach final slots.
 *
 * Integration: Called after image download, before slot assignment.
 * Uses policy from coverStoryPolicyRegistry to determine forbidden types.
 *
 * Principle: The system should use clean source photos and create its own cover.
 * It should NOT reuse another page's finished cover/thumbnail as a source image.
 */

import sharp from 'sharp';
import { getPolicyForStoryType, isSourceTypeForbidden } from './coverStoryPolicyRegistry.js';

// ─── Source image type constants ───────────────────────────────────────────────

export const SOURCE_TYPES = {
  CLEAN_PHOTO: 'CLEAN_PHOTO',
  NEWS_THUMBNAIL: 'NEWS_THUMBNAIL',
  TEXT_OVERLAY: 'TEXT_OVERLAY',
  COLLAGE: 'COLLAGE',
  SCREENSHOT: 'SCREENSHOT',
  SPLIT_SCREEN: 'SPLIT_SCREEN',
  WATERMARKED: 'WATERMARKED',
  PREVIOUS_COVER: 'PREVIOUS_COVER',
  YOUTUBE_THUMBNAIL: 'YOUTUBE_THUMBNAIL',
  SOCIAL_POST: 'SOCIAL_POST',
  INTERVIEW_FRAME: 'INTERVIEW_FRAME',
  EVIDENCE_CANDIDATE: 'EVIDENCE_CANDIDATE',
};

// ─── Known news/media domain patterns ──────────────────────────────────────────

const NEWS_DOMAINS = [
  'mgronline', 'matichon', 'thairath', 'dailynews', 'bangkokbiznews', 'posttoday',
  'komchadluek', 'nationtv', 'mcot', 'pptvhd', 'one31', 'trueid', 'workpointnews',
  'ch3', 'ch7', 'amarin', 'thaipost', 'sanook', 'kapook', 'khaosod', 'springnews',
  'tnnthailand', 'brighttv', 'siamrath', 'naewna', 'manager.co.th', 'thethaiger',
  'thansettakij', 'prachachat',
];

const YOUTUBE_PATTERNS = [
  /ytimg\.com/i, /maxresdefault/i, /hqdefault/i, /sddefault/i, /mqdefault/i,
  /i\.ytimg/i, /youtube\.com.*thumbnail/i, /yt[0-9]+\.ggpht/i,
];

const SOCIAL_PATTERNS = [
  /fbcdn\.net.*\/[stv]_/i, /scontent.*fbcdn/i,
  /instagram\.com.*\/[stv]\d+/i, /cdninstagram/i,
  /pantip\.com.*\/topic/i, /pantip\.com.*\/img/i,
  /tiktokcdn/i, /tiktok\.com.*cover/i,
];

// ─── Thai text detection patterns (in title/snippet/URL) ───────────────────────

const THAI_NEWS_TITLE_PATTERNS = [
  // News outlet names in image titles
  /ผู้จัดการ|มติชน|ไทยรัฐ|เดลินิวส์|คมชัดลึก|ข่าวสด|กรุงเทพธุรกิจ|ประชาชาติ|สยามรัฐ|แนวหน้า/i,
  /PPTVHD|TNN|Workpoint|Amarin|CH3|CH7|one31|บันเทิง.*ช่อง/i,
  // Interview/program patterns
  /สัมภาษณ์.*รายการ|รายการ.*ช่อง|ช่อง\s*\d+/i,
  // Article/cover patterns
  /ปก.*ข่าว|บทความ|ข่าวเด่น|ข่าวด่วน|สกู๊ป|พาดหัว/i,
];

const EMBEDDED_TEXT_INDICATORS = [
  // Patterns suggesting the image itself contains Thai headline text
  /ด่วน!|ช็อก!|เศร้า!|Breaking/i,
  /ข่าว\d|EP\.\d|ตอนที่/i,
  /OFFICIAL|official/i,
  /ที่นี่หมอชิต|คุย.*คนดัง|เรื่อง.*เล่า|ข่าวใส่ไข่/i,
  /Made.*วันนี้|คุณหมอเคียง|รักษาช้าง/i,
  /credits?:|photo:|ภาพจาก|ขอบคุณภาพ/i,
];

// ─── Graphic border / colored frame detection (URL-based) ──────────────────────

const GRAPHIC_OVERLAY_URL_PATTERNS = [
  /cover-image|og[-_]image|social[-_]share|featured[-_]image/i,
  /card[-_]image|share[-_]image|header[-_]image/i,
  /web[-_]cover|news[-_]cover|article[-_]cover/i,
  /banner[-_]|poster[-_]|graphic[-_]/i,
];

// ─── Core classification function ──────────────────────────────────────────────

/**
 * Classify a source image type based on URL, title, metadata, and pixel analysis.
 *
 * @param {Object} params
 * @param {Buffer} params.buffer - Image buffer (for pixel analysis)
 * @param {string} params.url - Image source URL
 * @param {string} params.title - Image title/caption from search
 * @param {string} params.snippet - Search snippet context
 * @param {number} params.width - Image width
 * @param {number} params.height - Image height
 * @param {string} params.role - Current assigned role
 * @param {string} params.source - Image source origin (entity_first, multiAgent, etc.)
 * @returns {Promise<{type: string, confidence: number, reasons: string[], isUsable: boolean}>}
 */
export async function classifySourceImage({ buffer, url = '', title = '', snippet = '', width = 0, height = 0, role = '', source = '' }) {
  const reasons = [];
  let type = SOURCE_TYPES.CLEAN_PHOTO;
  let confidence = 0;
  let isUsable = true;

  const urlLower = (url || '').toLowerCase();
  const titleLower = (title || '').toLowerCase();
  const snippetLower = (snippet || '').toLowerCase();
  const allText = `${urlLower} ${titleLower} ${snippetLower}`;
  const aspect = width && height ? width / height : 1;

  // ═══════════════════════════════════════════════
  // Rule 1: YouTube thumbnail detection (URL-based)
  // ═══════════════════════════════════════════════
  if (YOUTUBE_PATTERNS.some(p => p.test(urlLower))) {
    type = SOURCE_TYPES.YOUTUBE_THUMBNAIL;
    confidence = 0.95;
    reasons.push('URL matches YouTube thumbnail pattern');
    isUsable = false;
  }

  // ═══════════════════════════════════════════════
  // Rule 2: Social media post screenshot (URL-based)
  // ═══════════════════════════════════════════════
  if (type === SOURCE_TYPES.CLEAN_PHOTO && SOCIAL_PATTERNS.some(p => p.test(urlLower))) {
    // Social media images CAN be clean photos (Instagram portrait, etc.)
    // Only flag if there are additional indicators of screenshot
    if (titleLower.match(/โพสต์|post|story|สตอรี่|รีโพสต์|repost|share|แชร์/) ||
        titleLower.match(/comment|ความคิดเห็น|คอมเม้นต์|reply|ตอบกลับ/)) {
      type = SOURCE_TYPES.SOCIAL_POST;
      confidence = 0.75;
      reasons.push('Social platform URL + post/comment title');
      isUsable = false;
    }
  }

  // ═══════════════════════════════════════════════
  // Rule 3: News domain thumbnail (URL-based)
  // ═══════════════════════════════════════════════
  if (type === SOURCE_TYPES.CLEAN_PHOTO) {
    const isNewsDomain = NEWS_DOMAINS.some(d => urlLower.includes(d));
    const isGraphicUrl = GRAPHIC_OVERLAY_URL_PATTERNS.some(p => p.test(urlLower));

    if (isNewsDomain && isGraphicUrl) {
      type = SOURCE_TYPES.NEWS_THUMBNAIL;
      confidence = 0.9;
      reasons.push(`News domain (${NEWS_DOMAINS.find(d => urlLower.includes(d))}) + graphic URL pattern`);
      isUsable = false;
    } else if (isNewsDomain && (aspect > 1.6 && aspect < 1.9) && width > 400 && width < 1200) {
      // 16:9-ish aspect from news domain = likely article header/thumbnail
      type = SOURCE_TYPES.NEWS_THUMBNAIL;
      confidence = 0.7;
      reasons.push(`News domain + 16:9 thumbnail aspect (${aspect.toFixed(2)})`);
      isUsable = false;
    }
  }

  // ═══════════════════════════════════════════════
  // Rule 4: Previous cover / OG image detection
  // ═══════════════════════════════════════════════
  if (type === SOURCE_TYPES.CLEAN_PHOTO && GRAPHIC_OVERLAY_URL_PATTERNS.some(p => p.test(urlLower))) {
    // Non-news domain but still an og:image / cover
    type = SOURCE_TYPES.PREVIOUS_COVER;
    confidence = 0.6;
    reasons.push('URL contains cover/og/share image pattern');
    // May still be usable as support
  }

  // ═══════════════════════════════════════════════
  // Rule 5: Thai news title patterns (title-based)
  // ═══════════════════════════════════════════════
  if (type === SOURCE_TYPES.CLEAN_PHOTO || confidence < 0.8) {
    const newsMatch = THAI_NEWS_TITLE_PATTERNS.filter(p => p.test(titleLower));
    if (newsMatch.length >= 1) {
      // Title contains news outlet name → image likely came from their article
      const prevType = type;
      type = SOURCE_TYPES.TEXT_OVERLAY;
      confidence = Math.max(confidence, 0.75);
      reasons.push(`Title contains Thai news outlet/program name (${newsMatch.length} matches)`);
      isUsable = false;
    }
  }

  // ═══════════════════════════════════════════════
  // Rule 6: Embedded text indicators (title-based)
  // ═══════════════════════════════════════════════
  if (type === SOURCE_TYPES.CLEAN_PHOTO || confidence < 0.8) {
    const textIndicators = EMBEDDED_TEXT_INDICATORS.filter(p => p.test(allText));
    if (textIndicators.length >= 1) {
      type = SOURCE_TYPES.TEXT_OVERLAY;
      confidence = Math.max(confidence, 0.65);
      reasons.push(`Embedded text indicators detected (${textIndicators.length} matches)`);
      isUsable = false;
    }
  }

  // ═══════════════════════════════════════════════
  // Rule 7: Interview frame detection (title-based)
  // ═══════════════════════════════════════════════
  if (type === SOURCE_TYPES.CLEAN_PHOTO) {
    if (titleLower.match(/สัมภาษณ์|interview|ให้สัมภาษณ์|ตอบ.*ผู้สื่อข่าว|แถลงข่าว/) ||
        titleLower.match(/ช่อง\s*\d+.*สัมภาษณ์|MCOT|PPTV|Workpoint.*สัมภาษณ์/i)) {
      // Check if it's a clean interview photo or a TV screenshot
      if (titleLower.match(/ช่อง|channel|program|รายการ|HD|OFFICIAL/i)) {
        type = SOURCE_TYPES.INTERVIEW_FRAME;
        confidence = 0.7;
        reasons.push('TV interview frame with channel/program branding');
        // Can be usable as evidence/support but not main
      }
    }
  }

  // ═══════════════════════════════════════════════
  // Rule 8: Collage/multi-panel detection (dimension-based)
  // ═══════════════════════════════════════════════
  if (type === SOURCE_TYPES.CLEAN_PHOTO) {
    if (aspect > 2.5 && width > 600) {
      type = SOURCE_TYPES.COLLAGE;
      confidence = 0.85;
      reasons.push(`Wide panoramic strip (aspect ${aspect.toFixed(2)} > 2.5)`);
      isUsable = false;
    } else if (aspect < 0.35 && height > 600) {
      type = SOURCE_TYPES.COLLAGE;
      confidence = 0.85;
      reasons.push(`Tall vertical strip (aspect ${aspect.toFixed(2)} < 0.35)`);
      isUsable = false;
    }
  }

  // ═══════════════════════════════════════════════
  // Rule 9: Pixel-level analysis (if buffer available)
  // ═══════════════════════════════════════════════
  if (buffer && type === SOURCE_TYPES.CLEAN_PHOTO) {
    try {
      const pixelResult = await analyzePixelContent(buffer, width, height);
      if (pixelResult.isSplitScreen) {
        type = SOURCE_TYPES.SPLIT_SCREEN;
        confidence = Math.max(confidence, pixelResult.confidence);
        reasons.push(`Split screen detected: ${pixelResult.reason}`);
        isUsable = false;
      } else if (pixelResult.hasColorBorder) {
        type = SOURCE_TYPES.NEWS_THUMBNAIL;
        confidence = Math.max(confidence, pixelResult.confidence);
        reasons.push(`Colored graphic border detected: ${pixelResult.reason}`);
        isUsable = false;
      } else if (pixelResult.hasTextBanner) {
        type = SOURCE_TYPES.TEXT_OVERLAY;
        confidence = Math.max(confidence, pixelResult.confidence);
        reasons.push(`Text banner detected: ${pixelResult.reason}`);
        isUsable = false;
      }
    } catch {
      // Pixel analysis non-critical — skip
    }
  }

  // ═══════════════════════════════════════════════
  // Rule 10: Size-based thumbnail detection
  // ═══════════════════════════════════════════════
  if (type === SOURCE_TYPES.CLEAN_PHOTO) {
    if (width > 0 && height > 0 && width < 200 && height < 200) {
      type = SOURCE_TYPES.NEWS_THUMBNAIL;
      confidence = 0.9;
      reasons.push(`Very small image (${width}x${height}) — likely thumbnail/icon`);
      isUsable = false;
    }
  }

  // ═══════════════════════════════════════════════
  // Final: If nothing flagged → CLEAN_PHOTO
  // ═══════════════════════════════════════════════
  if (type === SOURCE_TYPES.CLEAN_PHOTO) {
    confidence = 1 - (reasons.length * 0.1); // slightly reduce if any minor warnings
    isUsable = true;
  }

  return { type, confidence: Math.max(0, Math.min(1, confidence)), reasons, isUsable };
}

// ─── Pixel-level analysis helper ───────────────────────────────────────────────

/**
 * Analyze pixel content for split screens, colored borders, and text banners.
 * Uses sharp to sample pixel rows/columns efficiently.
 */
async function analyzePixelContent(buffer, width, height) {
  const result = { isSplitScreen: false, hasColorBorder: false, hasTextBanner: false, confidence: 0, reason: '' };

  try {
    if (!buffer || !width || !height || width < 100 || height < 100) return result;

    // Downsample to 200px wide for fast analysis
    const sampleW = 200;
    const sampleH = Math.round(height * (sampleW / width));
    const { data, info } = await sharp(buffer)
      .resize(sampleW, sampleH, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels || 3;

    // ─── Check for colored top/bottom banner (common in news thumbnails) ───
    // Sample top 10% and bottom 10% — if they have uniform, saturated color → banner
    const topRowEnd = Math.floor(sampleH * 0.1);
    const bottomRowStart = Math.floor(sampleH * 0.9);

    const topColors = sampleRegionColor(data, sampleW, channels, 0, topRowEnd);
    const bottomColors = sampleRegionColor(data, sampleW, channels, bottomRowStart, sampleH);

    // Saturated, uniform color = likely a colored banner
    if (topColors.uniformity > 0.7 && topColors.saturation > 0.3) {
      result.hasColorBorder = true;
      result.confidence = 0.75;
      result.reason = `Top banner: uniform color (${topColors.uniformity.toFixed(2)}) with saturation ${topColors.saturation.toFixed(2)}`;
    }
    if (bottomColors.uniformity > 0.7 && bottomColors.saturation > 0.3) {
      result.hasTextBanner = true;
      result.confidence = Math.max(result.confidence, 0.7);
      result.reason += (result.reason ? ' + ' : '') + `Bottom banner: uniform color (${bottomColors.uniformity.toFixed(2)})`;
    }

    // ─── Check for vertical split (2 distinct halves) ───
    const leftColors = sampleRegionColor(data, sampleW, channels, 0, sampleH, 0, Math.floor(sampleW * 0.48));
    const rightColors = sampleRegionColor(data, sampleW, channels, 0, sampleH, Math.floor(sampleW * 0.52), sampleW);

    // If left and right halves have very different average colors → split screen
    const colorDiff = Math.abs(leftColors.avgBrightness - rightColors.avgBrightness);
    if (colorDiff > 50 && leftColors.uniformity > 0.4 && rightColors.uniformity > 0.4) {
      // Additional check: look for a thin vertical divider line in the middle
      const midCol = Math.floor(sampleW / 2);
      let dividerPixels = 0;
      for (let row = 0; row < sampleH; row++) {
        const idx = (row * sampleW + midCol) * channels;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        // Very dark or very light line
        const brightness = (r + g + b) / 3;
        if (brightness < 30 || brightness > 240) dividerPixels++;
      }
      if (dividerPixels / sampleH > 0.5) {
        result.isSplitScreen = true;
        result.confidence = Math.max(result.confidence, 0.8);
        result.reason = `Vertical split: brightness diff=${colorDiff.toFixed(0)}, divider=${(dividerPixels / sampleH * 100).toFixed(0)}%`;
      }
    }

  } catch {
    // Non-critical
  }

  return result;
}

/**
 * Sample average color properties from a rectangular region of raw pixel data.
 */
function sampleRegionColor(data, imgWidth, channels, rowStart, rowEnd, colStart = 0, colEnd = null) {
  colEnd = colEnd || imgWidth;
  let totalR = 0, totalG = 0, totalB = 0, count = 0;
  const pixelColors = [];

  const sampleStep = 3; // Sample every 3rd pixel for speed
  for (let row = rowStart; row < rowEnd; row += sampleStep) {
    for (let col = colStart; col < colEnd; col += sampleStep) {
      const idx = (row * imgWidth + col) * channels;
      if (idx + 2 >= data.length) continue;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      totalR += r; totalG += g; totalB += b;
      pixelColors.push((r << 16) | (g << 8) | b);
      count++;
    }
  }

  if (count === 0) return { uniformity: 0, saturation: 0, avgBrightness: 128 };

  const avgR = totalR / count, avgG = totalG / count, avgB = totalB / count;
  const avgBrightness = (avgR + avgG + avgB) / 3;

  // Uniformity: how similar are pixels to average
  let variance = 0;
  for (let i = 0; i < pixelColors.length; i++) {
    const r = (pixelColors[i] >> 16) & 0xFF;
    const g = (pixelColors[i] >> 8) & 0xFF;
    const b = pixelColors[i] & 0xFF;
    variance += Math.abs(r - avgR) + Math.abs(g - avgG) + Math.abs(b - avgB);
  }
  const avgVariance = variance / (count * 3);
  const uniformity = Math.max(0, 1 - (avgVariance / 80)); // 0=diverse, 1=uniform

  // Saturation: how colorful (vs. grayscale)
  const maxC = Math.max(avgR, avgG, avgB);
  const minC = Math.min(avgR, avgG, avgB);
  const saturation = maxC > 0 ? (maxC - minC) / maxC : 0;

  return { uniformity, saturation, avgBrightness };
}

// ─── Quality Gate — apply policy to filter images ──────────────────────────────

/**
 * Apply the quality gate to a set of downloaded images.
 * Returns classified images with pass/block/downgrade status.
 *
 * Enforces:
 * 1. Forbidden types → BLOCKED
 * 2. Per-type max quotas (excess → BLOCKED even if type is not forbidden)
 * 3. Slot restrictions (non-clean types get _forbiddenSlots metadata)
 * 4. qualityGatePassed = false if no clean images available for main slot
 *
 * @param {Array} images - Array of image objects from imageBuffers
 * @param {string} storyType - From identity.storyType
 * @param {Object} [policyOverride] - Optional policy override (default: auto from storyType)
 * @returns {Promise<{
 *   passed: Array, blocked: Array, downgraded: Array,
 *   summary: { total, passed, blocked, downgraded, types: Object, qualityGatePassed: boolean }
 * }>}
 */
export async function applyQualityGate(images, storyType, policyOverride = null) {
  const policy = policyOverride || getPolicyForStoryType(storyType);
  const forbiddenTypes = policy.forbiddenSourceTypes || [];

  // Per-type max quotas
  const maxQuotas = {
    [SOURCE_TYPES.TEXT_OVERLAY]:       policy.maxTextOverlaySourceImages ?? 0,
    [SOURCE_TYPES.NEWS_THUMBNAIL]:     policy.maxNewsThumbnailImages ?? 0,
    [SOURCE_TYPES.YOUTUBE_THUMBNAIL]:  policy.maxYoutubeThumbnailImages ?? 0,
    [SOURCE_TYPES.SOCIAL_POST]:        policy.maxSocialPostImages ?? 0,
  };

  // Slot restriction definitions from policy
  const forbiddenSlotTypes = policy.forbiddenSlotTypes || {
    main: ['NEWS_THUMBNAIL', 'YOUTUBE_THUMBNAIL', 'TEXT_OVERLAY', 'SOCIAL_POST', 'SCREENSHOT', 'COLLAGE', 'SPLIT_SCREEN', 'PREVIOUS_COVER', 'INTERVIEW_FRAME'],
    circle: ['NEWS_THUMBNAIL', 'YOUTUBE_THUMBNAIL', 'TEXT_OVERLAY', 'SOCIAL_POST', 'SCREENSHOT', 'COLLAGE', 'SPLIT_SCREEN', 'PREVIOUS_COVER'],
  };

  const passed = [];
  const blocked = [];
  const downgraded = [];
  const typeCounts = {};
  const quotaUsed = {};  // Track how many of each type have been allowed through

  console.log(`[QualityGate] ★ Applying quality gate: storyType="${storyType}", policy="${policy._policyKey}", forbidden=[${forbiddenTypes.join(',')}]`);
  console.log(`[QualityGate] ★ Quotas: TEXT_OVERLAY=${maxQuotas[SOURCE_TYPES.TEXT_OVERLAY]}, NEWS_THUMBNAIL=${maxQuotas[SOURCE_TYPES.NEWS_THUMBNAIL]}, YOUTUBE_THUMBNAIL=${maxQuotas[SOURCE_TYPES.YOUTUBE_THUMBNAIL]}, SOCIAL_POST=${maxQuotas[SOURCE_TYPES.SOCIAL_POST]}`);

  for (let i = 0; i < images.length; i++) {
    const img = images[i];

    // Skip already marked TECHNICAL_BAD
    if (img.role === 'TECHNICAL_BAD') {
      blocked.push({ ...img, _gateAction: 'ALREADY_BAD', _gateReason: img._techBadReason || 'pre-marked' });
      continue;
    }

    // Classify the image
    const classification = await classifySourceImage({
      buffer: img.buffer,
      url: img.url || '',
      title: img.title || '',
      snippet: img.snippet || '',
      width: img.width || 0,
      height: img.height || 0,
      role: img.role || '',
      source: img.source || '',
    });

    // Store classification on the image object
    img._sourceType = classification.type;
    img._sourceConfidence = classification.confidence;
    img._sourceReasons = classification.reasons;

    typeCounts[classification.type] = (typeCounts[classification.type] || 0) + 1;

    // ═══════════════════════════════════════════════
    // Decision: CLEAN_PHOTO → always pass
    // ═══════════════════════════════════════════════
    if (classification.type === SOURCE_TYPES.CLEAN_PHOTO) {
      img._gateAction = 'PASSED';
      passed.push(img);
      continue;
    }

    // ═══════════════════════════════════════════════
    // Non-clean image — check forbidden + quota
    // ═══════════════════════════════════════════════
    const isForbidden = forbiddenTypes.includes(classification.type);
    const typeQuota = maxQuotas[classification.type];
    const typeUsed = quotaUsed[classification.type] || 0;
    const hasQuota = typeQuota !== undefined && typeQuota !== null;
    const quotaExceeded = hasQuota && typeUsed >= typeQuota;

    // ─── Case A: Forbidden type ───
    if (isForbidden) {
      // Check if quota allows limited pass-through as evidence
      if (hasQuota && typeQuota > 0 && typeUsed < typeQuota) {
        // Quota allows: downgrade to evidence candidate
        quotaUsed[classification.type] = typeUsed + 1;
        img._gateAction = 'DOWNGRADED';
        img._gateReason = `${classification.type} allowed as evidence (${typeUsed + 1}/${typeQuota})`;
        img._originalRole = img.role;
        if (img.role !== 'EVIDENCE' && img.role !== 'EVIDENCE_CANDIDATE') {
          img.role = 'EVIDENCE_CANDIDATE';
        }
        // Mark slot restrictions
        img._forbiddenSlots = {
          main: (forbiddenSlotTypes.main || []).includes(classification.type),
          circle: (forbiddenSlotTypes.circle || []).includes(classification.type),
        };
        img.score = Math.max(1, (img.score || 5) - 3);
        downgraded.push(img);
        console.log(`[QualityGate] ⬇️ #${i} DOWNGRADED: ${classification.type} → EVIDENCE_CANDIDATE (${typeUsed + 1}/${typeQuota}) — ${classification.reasons[0]?.substring(0, 60)}`);
        continue;
      }

      // Blocked: forbidden and no quota remaining
      img._gateAction = 'BLOCKED';
      img._gateReason = `${classification.type} forbidden by ${policy._policyKey} policy`;
      img.role = 'QUALITY_BLOCKED';
      img.curatorScore = 0;
      blocked.push(img);
      console.log(`[QualityGate] ⛔ #${i} BLOCKED: ${classification.type} (conf=${classification.confidence.toFixed(2)}) — ${classification.reasons[0]?.substring(0, 60)}`);
      continue;
    }

    // ─── Case B: Not forbidden, but has quota limit ───
    if (hasQuota && quotaExceeded) {
      // Over quota → block excess
      img._gateAction = 'BLOCKED';
      img._gateReason = `${classification.type} over quota (${typeUsed}/${typeQuota}) in ${policy._policyKey} policy`;
      img.role = 'QUALITY_BLOCKED';
      img.curatorScore = 0;
      blocked.push(img);
      console.log(`[QualityGate] ⛔ #${i} BLOCKED: ${classification.type} over quota (${typeUsed}/${typeQuota}) — ${classification.reasons[0]?.substring(0, 60)}`);
      continue;
    }

    // ─── Case C: Not forbidden, within quota → downgrade ───
    if (hasQuota && typeQuota > 0 && typeUsed < typeQuota) {
      quotaUsed[classification.type] = typeUsed + 1;
      img._gateAction = 'DOWNGRADED';
      img._gateReason = `${classification.type} within quota (${typeUsed + 1}/${typeQuota}) — support/evidence only`;
      img._originalRole = img.role;
      if (img.role !== 'EVIDENCE' && img.role !== 'EVIDENCE_CANDIDATE') {
        img.role = 'EVIDENCE_CANDIDATE';
      }
      img._forbiddenSlots = {
        main: (forbiddenSlotTypes.main || []).includes(classification.type),
        circle: (forbiddenSlotTypes.circle || []).includes(classification.type),
      };
      img.score = Math.max(1, (img.score || 5) - 3);
      downgraded.push(img);
      console.log(`[QualityGate] ⬇️ #${i} DOWNGRADED: ${classification.type} → evidence (${typeUsed + 1}/${typeQuota}) — ${classification.reasons[0]?.substring(0, 60)}`);
      continue;
    }

    // ─── Case D: Not forbidden, no quota defined, non-clean type ───
    // Allow but downgrade with slot restrictions (INTERVIEW_FRAME, PREVIOUS_COVER, etc.)
    if (classification.type === SOURCE_TYPES.INTERVIEW_FRAME || 
        classification.type === SOURCE_TYPES.PREVIOUS_COVER) {
      img._gateAction = 'DOWNGRADED';
      img._gateReason = `${classification.type} — allowed but lower priority`;
      img._originalRole = img.role;
      img._forbiddenSlots = {
        main: (forbiddenSlotTypes.main || []).includes(classification.type),
        circle: (forbiddenSlotTypes.circle || []).includes(classification.type),
      };
      img.score = Math.max(1, (img.score || 5) - 2);
      downgraded.push(img);
      console.log(`[QualityGate] ⬇️ #${i} DOWNGRADED: ${classification.type} score-2 — ${classification.reasons[0]?.substring(0, 60)}`);
      continue;
    }

    // ─── Fallback: treat as passed but with slot restrictions ───
    img._gateAction = 'PASSED';
    img._forbiddenSlots = {
      main: (forbiddenSlotTypes.main || []).includes(classification.type),
      circle: (forbiddenSlotTypes.circle || []).includes(classification.type),
    };
    passed.push(img);
  }

  // ═══════════════════════════════════════════════
  // Compute qualityGatePassed — strict logic
  // ═══════════════════════════════════════════════
  const cleanPhotoPassed = passed.filter(img => img._sourceType === SOURCE_TYPES.CLEAN_PHOTO).length;
  const totalSurviving = passed.length + downgraded.length;
  const nonCleanSurviving = totalSurviving - cleanPhotoPassed;

  // qualityGatePassed is FALSE if:
  // 1. No images survived at all
  // 2. No clean photos available for main slot (all surviving are thumbnails/overlays)
  // 3. Non-clean images dominate (>60% of surviving pool)
  // 4. Fewer than 2 images survived total
  const noCleanForMain = cleanPhotoPassed === 0;
  const nonCleanDominates = totalSurviving > 0 && (nonCleanSurviving / totalSurviving) > 0.6;
  const tooFewImages = totalSurviving < 2;
  const qualityGatePassed = totalSurviving > 0 && !noCleanForMain && !tooFewImages;

  const failReasons = [];
  if (totalSurviving === 0) failReasons.push('NO_IMAGES_SURVIVED');
  if (noCleanForMain) failReasons.push('NO_CLEAN_PHOTO_FOR_MAIN');
  if (nonCleanDominates) failReasons.push('NON_CLEAN_DOMINATES_POOL');
  if (tooFewImages) failReasons.push('TOO_FEW_IMAGES');

  const summary = {
    total: images.length,
    passed: passed.length,
    blocked: blocked.length,
    downgraded: downgraded.length,
    types: typeCounts,
    cleanPhotoCount: cleanPhotoPassed,
    qualityGatePassed,
    qualityGateFailReasons: failReasons,
    policyKey: policy._policyKey,
    forbiddenTypes,
    quotasApplied: { ...maxQuotas },
    quotasUsed: { ...quotaUsed },
  };

  console.log(`[QualityGate] 📊 Results: ${passed.length} passed (${cleanPhotoPassed} clean), ${blocked.length} blocked, ${downgraded.length} downgraded out of ${images.length} total`);
  console.log(`[QualityGate] 📊 Type breakdown: ${JSON.stringify(typeCounts)}`);
  console.log(`[QualityGate] 📊 qualityGatePassed=${qualityGatePassed}${failReasons.length > 0 ? ` — reasons: [${failReasons.join(', ')}]` : ''}`);

  return { passed, blocked, downgraded, summary };
}

/**
 * Apply quality gate and return filtered imageBuffers array.
 * Blocked images are removed from the pool. Downgraded images stay but with modified roles.
 * 
 * @param {Array} imageBuffers - The mutable imageBuffers array
 * @param {string} storyType - From identity.storyType
 * @param {Object} [policyOverride] - Optional policy override
 * @returns {Promise<Object>} Quality gate diagnostics for ai-review
 */
export async function applyQualityGateToPool(imageBuffers, storyType, policyOverride = null) {
  const result = await applyQualityGate(imageBuffers, storyType, policyOverride);

  // Remove blocked images from the pool (keep passed + downgraded)
  const survivingImages = [...result.passed, ...result.downgraded];

  // Replace imageBuffers content
  imageBuffers.length = 0;
  imageBuffers.push(...survivingImages);

  console.log(`[QualityGate] ★ Pool filtered: ${result.summary.total} → ${imageBuffers.length} images (${result.summary.blocked} blocked)`);

  // Check if we still have enough clean images
  if (imageBuffers.length < 2) {
    console.warn(`[QualityGate] ⚠️ Only ${imageBuffers.length} images survived! May need fallback.`);
  }
  if (result.summary.cleanPhotoCount === 0 && imageBuffers.length > 0) {
    console.warn(`[QualityGate] ⚠️ No CLEAN_PHOTO in pool! All ${imageBuffers.length} surviving images are non-clean.`);
  }

  // Build diagnostics for ai-review
  const diagnostics = {
    sourceImageTypes: survivingImages.map(img => ({
      candidateId: img.candidateId || 'unknown',
      url: (img.url || '').substring(0, 80),
      role: img.role,
      sourceType: img._sourceType || 'CLEAN_PHOTO',
      confidence: img._sourceConfidence || 1,
      gateAction: img._gateAction || 'PASSED',
      gateReason: img._gateReason || '',
      reasons: img._sourceReasons || [],
      forbiddenSlots: img._forbiddenSlots || null,
    })),
    blockedSourceImages: result.blocked.map(img => ({
      url: (img.url || '').substring(0, 80),
      originalRole: img._originalRole || img.role,
      sourceType: img._sourceType || 'UNKNOWN',
      confidence: img._sourceConfidence || 0,
      reasons: img._sourceReasons || [],
      gateReason: img._gateReason || '',
    })),
    downgradedSourceImages: result.downgraded.map(img => ({
      url: (img.url || '').substring(0, 80),
      originalRole: img._originalRole || img.role,
      newRole: img.role,
      sourceType: img._sourceType || 'UNKNOWN',
      reasons: img._sourceReasons || [],
      forbiddenSlots: img._forbiddenSlots || null,
    })),
    evidenceCandidates: survivingImages
      .filter(img => img._sourceType === SOURCE_TYPES.EVIDENCE_CANDIDATE || img.role === 'EVIDENCE_CANDIDATE')
      .map(img => ({
        url: (img.url || '').substring(0, 80),
        originalRole: img._originalRole || img.role,
      })),
    qualityGateSummary: result.summary,
    qualityGatePassed: result.summary.qualityGatePassed,
  };

  return diagnostics;
}

