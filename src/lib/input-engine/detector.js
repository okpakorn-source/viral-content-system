/**
 * UNIFIED AUTO INPUT ENGINE — Universal Input Detector
 * ─────────────────────────────────────────────────────
 * detectInputType(input, images?) → DetectionResult
 *
 * รองรับ:
 *  - TikTok URL (vt.tiktok, vm.tiktok, tiktok.com)
 *  - YouTube URL (youtu.be, youtube.com)
 *  - Facebook URL (fb.watch, facebook.com)
 *  - Article / Website URL
 *  - Plain text (ข่าว, บทความ, transcript)
 *  - Image only (base64 / file)
 *  - Hybrid (URL + image, text + image, multiple URLs)
 *  - Multiple URLs
 *  - Unknown / unsupported
 */

// ─── Platform URL Patterns ─────────────────────────────────────────
const PATTERNS = {
  tiktok:   /tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com/i,
  youtube:  /youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts/i,
  facebook: /facebook\.com\/(?:.*\/)?(watch|video|reel|permalink|posts|photo|groups|story)|fb\.watch/i,
  twitter:  /twitter\.com\/|x\.com\//i,
  instagram:/instagram\.com\/(p|reel|tv)\//i,
  article:  /^https?:\/\/.{5,}/i,
};

const URL_REGEX = /https?:\/\/[^\s"'<>]{8,}/gi;

/**
 * แยก URLs ทั้งหมดออกจาก string
 */
function extractUrls(text) {
  if (!text) return [];
  const matches = text.match(URL_REGEX) || [];
  return [...new Set(matches)].slice(0, 10); // max 10 URLs
}

/**
 * ตรวจ platform จาก URL เดียว
 */
function detectPlatform(url) {
  if (!url) return 'unknown';
  if (PATTERNS.tiktok.test(url))   return 'tiktok';
  if (PATTERNS.youtube.test(url))  return 'youtube';
  if (PATTERNS.facebook.test(url)) return 'facebook';
  if (PATTERNS.twitter.test(url))  return 'twitter';
  if (PATTERNS.instagram.test(url))return 'instagram';
  if (PATTERNS.article.test(url))  return 'article';
  return 'unknown';
}

/**
 * ตรวจว่า input เป็น base64 image หรือไม่
 */
function isBase64Image(str) {
  if (!str || typeof str !== 'string') return false;
  return str.startsWith('data:image/') || (str.length > 200 && /^[A-Za-z0-9+/]{100,}={0,2}$/.test(str.slice(0, 100)));
}

/**
 * ตรวจความยาว text ที่เป็นเนื้อหาจริง (ไม่ใช่ URL)
 */
function getTextContent(input) {
  if (!input) return '';
  // ลบ URLs ออก แล้วดูว่าเหลือ text อะไร
  return input.replace(URL_REGEX, '').replace(/\s+/g, ' ').trim();
}

// ─── MAIN DETECTOR ─────────────────────────────────────────────────

/**
 * @param {string|null} input       — text input (URL, text, mixed)
 * @param {string[]}    images      — array of base64 images (optional)
 * @returns {DetectionResult}
 */
export function detectInputType(input = '', images = []) {
  const trimmed    = (input || '').trim();
  const urls       = extractUrls(trimmed);
  const textOnly   = getTextContent(trimmed);
  const hasImages  = Array.isArray(images) && images.length > 0;
  const hasText    = textOnly.length > 20;
  const hasUrls    = urls.length > 0;

  // ── Case 1: ไม่มีอะไรเลย ─────────────────────────────────────
  if (!trimmed && !hasImages) {
    return {
      inputType:       'empty',
      platform:        null,
      contentMode:     null,
      hasImage:        false,
      hasText:         false,
      hasUrls:         false,
      urls:            [],
      textContent:     '',
      priorityPipeline:'none',
      confidence:      0,
      label:           'ว่างเปล่า',
      error:           'กรุณาวาง URL, ข้อความ หรือรูปภาพ',
    };
  }

  // ── Case 2: Image only ───────────────────────────────────────
  if (!trimmed && hasImages) {
    return build({
      inputType:       'image_only',
      platform:        'image',
      contentMode:     'image',
      hasImage:        true,
      hasText:         false,
      hasUrls:         false,
      urls:            [],
      textContent:     '',
      priorityPipeline:'vision_pipeline',
      confidence:      0.95,
      label:           'รูปภาพ',
      images,
    });
  }

  // ── Case 3: Single URL only ───────────────────────────────────
  if (urls.length === 1 && !hasText && !hasImages) {
    const url      = urls[0];
    const platform = detectPlatform(url);
    return build({
      inputType:       platform + '_url',
      platform,
      contentMode:     platform === 'tiktok' || platform === 'youtube' ? 'video' : 'article',
      hasImage:        false,
      hasText:         false,
      hasUrls:         true,
      urls:            [url],
      textContent:     '',
      priorityPipeline:platformToPipeline(platform),
      confidence:      0.98,
      label:           platformLabel(platform) + ' URL',
      images:          [],
    });
  }

  // ── Case 4: Multiple URLs ─────────────────────────────────────
  if (urls.length > 1 && !hasImages) {
    const platforms = urls.map(detectPlatform);
    const primary   = platforms[0];
    return build({
      inputType:       'multi_url',
      platform:        primary,
      contentMode:     'mixed',
      hasImage:        false,
      hasText:         hasText,
      hasUrls:         true,
      urls,
      textContent:     textOnly,
      priorityPipeline:'multi_url_pipeline',
      confidence:      0.90,
      label:           `${urls.length} URLs (${platforms.slice(0,3).join(', ')})`,
      images:          [],
    });
  }

  // ── Case 5: URL + Image (Hybrid) ─────────────────────────────
  if (urls.length >= 1 && hasImages) {
    const url      = urls[0];
    const platform = detectPlatform(url);
    return build({
      inputType:       'hybrid_url_image',
      platform,
      contentMode:     'hybrid',
      hasImage:        true,
      hasText:         hasText,
      hasUrls:         true,
      urls,
      textContent:     textOnly,
      priorityPipeline:'hybrid_pipeline',
      confidence:      0.85,
      label:           `${platformLabel(platform)} + รูปภาพ`,
      images,
    });
  }

  // ── Case 6: Text + Image (Hybrid) ────────────────────────────
  if (!hasUrls && hasText && hasImages) {
    return build({
      inputType:       'hybrid_text_image',
      platform:        'hybrid',
      contentMode:     'hybrid',
      hasImage:        true,
      hasText:         true,
      hasUrls:         false,
      urls:            [],
      textContent:     textOnly,
      priorityPipeline:'hybrid_pipeline',
      confidence:      0.88,
      label:           'ข้อความ + รูปภาพ',
      images,
    });
  }

  // ── Case 7: Plain text only ───────────────────────────────────
  if (!hasUrls && hasText && !hasImages) {
    // ตรวจว่าเป็น transcript หรือ article body
    const isLong     = textOnly.length > 500;
    const isThai     = /[\u0e00-\u0e7f]/.test(textOnly);
    return build({
      inputType:       'plain_text',
      platform:        'text',
      contentMode:     isLong ? 'article' : 'snippet',
      hasImage:        false,
      hasText:         true,
      hasUrls:         false,
      urls:            [],
      textContent:     textOnly,
      priorityPipeline:'text_pipeline',
      confidence:      isThai ? 0.92 : 0.80,
      label:           isLong ? 'บทความ/ข้อความยาว' : 'ข้อความสั้น',
      images:          [],
    });
  }

  // ── Case 8: URL + Text (no images) ───────────────────────────
  if (urls.length >= 1 && hasText && !hasImages) {
    const url      = urls[0];
    const platform = detectPlatform(url);
    return build({
      inputType:       'url_with_context',
      platform,
      contentMode:     'article',
      hasImage:        false,
      hasText:         true,
      hasUrls:         true,
      urls,
      textContent:     textOnly,
      priorityPipeline:platformToPipeline(platform),
      confidence:      0.88,
      label:           `${platformLabel(platform)} + ข้อความ`,
      images:          [],
    });
  }

  // ── Fallback ──────────────────────────────────────────────────
  return build({
    inputType:       'unknown',
    platform:        'unknown',
    contentMode:     null,
    hasImage:        hasImages,
    hasText,
    hasUrls,
    urls,
    textContent:     textOnly,
    priorityPipeline:'text_pipeline',
    confidence:      0.40,
    label:           'ไม่ระบุประเภท',
    images:          images || [],
  });
}

// ─── Helpers ───────────────────────────────────────────────────────

function platformToPipeline(platform) {
  const map = {
    tiktok:   'tiktok_pipeline',
    youtube:  'youtube_pipeline',
    facebook: 'facebook_pipeline',
    twitter:  'social_pipeline',
    instagram:'social_pipeline',
    article:  'article_pipeline',
    unknown:  'article_pipeline', // try scraping anyway
  };
  return map[platform] || 'article_pipeline';
}

function platformLabel(platform) {
  const labels = {
    tiktok:   'TikTok',
    youtube:  'YouTube',
    facebook: 'Facebook',
    twitter:  'X (Twitter)',
    instagram:'Instagram',
    article:  'เว็บข่าว',
    unknown:  'URL',
  };
  return labels[platform] || 'URL';
}

function build(data) {
  return {
    inputType:       data.inputType,
    platform:        data.platform,
    contentMode:     data.contentMode,
    hasImage:        data.hasImage   || false,
    hasText:         data.hasText    || false,
    hasUrls:         data.hasUrls    || false,
    urls:            data.urls       || [],
    primaryUrl:      data.urls?.[0]  || null,
    textContent:     data.textContent || '',
    images:          data.images     || [],
    priorityPipeline:data.priorityPipeline,
    confidence:      data.confidence || 0.5,
    label:           data.label      || data.inputType,
    detectedAt:      new Date().toISOString(),
    error:           data.error      || null,
  };
}
