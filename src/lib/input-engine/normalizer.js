/**
 * UNIFIED AUTO INPUT ENGINE — Data Normalizer
 * ─────────────────────────────────────────────────────
 * แปลง raw provider output → NormalizedContent schema เดียวกัน
 * ทุก pipeline ต้องใช้ NormalizedContent เท่านั้น ห้ามใช้ raw source
 *
 * NormalizedContent schema:
 * {
 *   sourceType, platform, url, title, rawText, transcript,
 *   images[], metadata{}, keywords[], language, contentCategory,
 *   author, publishedAt, extractedEntities[], emotionSignals[],
 *   confidence
 * }
 */

// ─── Keyword Extractor (lightweight, no AI needed) ─────────────────

function extractKeywords(text, maxKeywords = 10) {
  if (!text || text.length < 10) return [];
  try {
    // ลบ HTML tags, URLs, special chars
    const clean = text
      .replace(/<[^>]+>/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^\u0e00-\u0e7f\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // ตัดคำ (simple Thai/EN word freq)
    const words = clean.split(/\s+/).filter(w => w.length > 2);
    const freq = {};
    for (const w of words) {
      const key = w.toLowerCase();
      freq[key] = (freq[key] || 0) + 1;
    }

    // เอา top keywords (freq >= 2 หรือ top 10 ถ้าทั้งหมดมีครั้งเดียว)
    const sorted = Object.entries(freq)
      .sort(([, a], [, b]) => b - a)
      .slice(0, maxKeywords)
      .map(([word]) => word);

    return sorted;
  } catch {
    return [];
  }
}

// ─── Language Detector ─────────────────────────────────────────────

function detectLanguage(text) {
  if (!text) return 'unknown';
  const thaiChars = (text.match(/[\u0e00-\u0e7f]/g) || []).length;
  const total = text.length;
  if (total === 0) return 'unknown';
  return thaiChars / total > 0.1 ? 'th' : 'en';
}

// ─── Content Category Guesser ──────────────────────────────────────

function guessCategory(title, text) {
  const combined = (title + ' ' + text).toLowerCase();
  const categories = {
    'crime':       ['จับกุม', 'คดี', 'ตำรวจ', 'อาชญากร', 'ข่มขืน', 'ฆ่า', 'ยาเสพติด', 'โจร', 'robbery', 'crime', 'police', 'arrest'],
    'accident':    ['อุบัติเหตุ', 'ชนกัน', 'เสียชีวิต', 'บาดเจ็บ', 'ไฟไหม้', 'น้ำท่วม', 'ตาย', 'accident', 'crash', 'fire', 'flood'],
    'politics':    ['นายกฯ', 'รัฐบาล', 'สภา', 'พรรค', 'เลือกตั้ง', 'รัฐมนตรี', 'politics', 'election', 'parliament'],
    'economy':     ['เศรษฐกิจ', 'หุ้น', 'เงิน', 'ธนาคาร', 'ลงทุน', 'ราคา', 'economy', 'stock', 'finance', 'market'],
    'entertainment':['ดารา', 'นักร้อง', 'ซีรีส์', 'ภาพยนตร์', 'บันเทิง', 'celebrity', 'movie', 'music', 'drama'],
    'health':      ['โรค', 'สุขภาพ', 'ยา', 'โรงพยาบาล', 'แพทย์', 'วัคซีน', 'health', 'disease', 'hospital', 'medicine'],
    'sports':      ['ฟุตบอล', 'กีฬา', 'แข่ง', 'นักกีฬา', 'sport', 'football', 'soccer', 'basketball', 'tennis'],
    'technology':  ['AI', 'เทคโนโลยี', 'แอป', 'ซอฟต์แวร์', 'tech', 'technology', 'software', 'digital', 'internet'],
  };

  for (const [cat, keywords] of Object.entries(categories)) {
    if (keywords.some(kw => combined.includes(kw))) {
      return cat;
    }
  }
  return 'general';
}

// ─── MAIN NORMALIZER ───────────────────────────────────────────────

/**
 * แปลง provider output → NormalizedContent
 *
 * @param {object} rawData       — output จาก provider (firecrawl, apify, youtube, etc.)
 * @param {string} sourceType    — 'article'|'tiktok'|'youtube'|'facebook'|'image'|'text'|'hybrid'
 * @param {object} opts          — { originalUrl, inputImages[] }
 * @returns {NormalizedContent}
 */
export function normalizeToSchema(rawData = {}, sourceType = 'article', opts = {}) {
  // ── Pull common fields ────────────────────────────────────────
  const title       = rawData.title       || opts.title       || '';
  const rawText     = rawData.text        || rawData.rawText   || rawData.transcript || rawData.content || opts.rawText || '';
  const transcript  = rawData.transcript  || (sourceType === 'tiktok' || sourceType === 'youtube' ? rawText : '');
  const author      = rawData.author      || rawData.channelName || '';
  const publishedAt = rawData.publishedAt || '';
  const language    = rawData.language    || detectLanguage(rawText + title) || 'th';

  // ── Images ───────────────────────────────────────────────────
  const providerImages = rawData.images || (rawData.thumbnail ? [rawData.thumbnail] : []);
  const inputImages    = opts.inputImages || [];
  const images = [...new Set([...providerImages, ...inputImages])].filter(Boolean).slice(0, 5);

  // ── Keywords ─────────────────────────────────────────────────
  const keywords = rawData.keywords?.length
    ? rawData.keywords
    : extractKeywords(rawText + ' ' + title);

  // ── Category ─────────────────────────────────────────────────
  const contentCategory = rawData.contentCategory || guessCategory(title, rawText);

  // ── Metadata ─────────────────────────────────────────────────
  const metadata = {
    provider:     rawData.provider || 'unknown',
    fallbackUsed: rawData.fallbackUsed || false,
    fallbackProvider: rawData.fallbackProvider || null,
    scrapeSuccess: rawData.success !== false,
    errors:       rawData.errors || [],
    // Social stats
    views:    rawData.views    || 0,
    likes:    rawData.likes    || 0,
    comments: rawData.comments || 0,
    shares:   rawData.shares   || 0,
    // Video
    duration: rawData.duration || '',
    videoId:  rawData.videoId  || '',
    // Article
    siteName:    rawData.siteName    || '',
    description: rawData.description || '',
    // Tags
    tags:     rawData.tags     || [],
    hashtags: rawData.hashtags || [],
  };

  // ── Entities (basic extraction) ──────────────────────────────
  const extractedEntities = extractBasicEntities(rawText + ' ' + title);

  // ── Confidence ───────────────────────────────────────────────
  let confidence = 0.5;
  if (rawText.length > 500) confidence += 0.2;
  if (rawText.length > 200) confidence += 0.1;
  if (title.length > 10)    confidence += 0.1;
  if (images.length > 0)    confidence += 0.05;
  if (rawData.success === false) confidence = Math.min(confidence, 0.3);
  confidence = Math.min(1.0, Math.round(confidence * 100) / 100);

  return {
    // ── Source identity ───────────────────────────────────────
    sourceType,
    platform:         rawData.platform  || sourceType,
    url:              rawData.url        || opts.originalUrl || '',
    // ── Content ──────────────────────────────────────────────
    title,
    rawText,
    transcript,
    // ── Media ────────────────────────────────────────────────
    images,
    // ── Structured data ──────────────────────────────────────
    keywords,
    language,
    contentCategory,
    author,
    publishedAt,
    extractedEntities,
    emotionSignals:   [],   // filled by AI breakdown step
    metadata,
    // ── Quality ──────────────────────────────────────────────
    confidence,
    // ── Normalized at ────────────────────────────────────────
    normalizedAt: new Date().toISOString(),
    // ── Summary for pipeline ─────────────────────────────────
    summary: {
      hasTitle:      title.length > 0,
      hasBody:       rawText.length > 100,
      hasTranscript: transcript.length > 0,
      hasImages:     images.length > 0,
      textLength:    rawText.length,
      isViable:      rawText.length > 80 || title.length > 10,
    },
  };
}

// ─── Entity Extractor (simple, no AI) ─────────────────────────────

function extractBasicEntities(text) {
  if (!text) return [];
  const entities = [];

  // Thai names (คำนาม ตาม pattern: นาย/นาง/น.ส./พล.ต./ร.ต./ดร.)
  const thaiPersonPattern = /(?:นาย|นาง(?:สาว)?|น\.ส\.|ดร\.|พล\.[ตอ]\.|ร\.[ตอ]\.|พ\.ต\.)[^\s,。.!?]{2,20}/g;
  const thaiPersons = text.match(thaiPersonPattern) || [];
  thaiPersons.forEach(p => entities.push({ type: 'person', value: p.trim() }));

  // Organizations (กรม/กระทรวง/บริษัท)
  const orgPattern = /(?:กรม|กระทรวง|บริษัท|สำนักงาน|ศาล|โรงพยาบาล)[^\s,。.!?]{1,20}/g;
  const orgs = text.match(orgPattern) || [];
  orgs.forEach(o => entities.push({ type: 'organization', value: o.trim() }));

  // URLs mentioned
  const urlPattern = /https?:\/\/[^\s]{8,50}/g;
  const urls = text.match(urlPattern) || [];
  urls.slice(0, 3).forEach(u => entities.push({ type: 'url', value: u }));

  return [...new Set(entities.map(e => JSON.stringify(e)))].map(s => JSON.parse(s)).slice(0, 15);
}

export { extractKeywords, detectLanguage, guessCategory };
