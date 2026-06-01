import { extractFromUrl } from './urlExtractor.js';
import { extractFromFacebook } from './facebookExtractor.js';
import { extractFromTiktok } from './tiktokExtractor.js';
import { extractFromYoutube } from './youtubeExtractor.js';

/**
 * Unified Content Extractor
 * รับ URL + type → เลือก extractor ที่ถูกต้องอัตโนมัติ
 */
export async function extractContent({ url, type, rawContent }) {
  // ถ้าเป็น raw text → return ทันที
  if (type === 'raw' || (!url && rawContent)) {
    return {
      success: true,
      type: 'raw',
      title: rawContent?.slice(0, 50) + '...',
      text: rawContent,
      extractedAt: new Date().toISOString(),
    };
  }

  if (!url) {
    return { success: false, error: 'ต้องระบุ URL หรือข้อความ' };
  }

  // Auto-detect type from URL if not specified
  const detectedType = type || detectSourceType(url);

  switch (detectedType) {
    case 'facebook':
      return await extractFromFacebook(url);
    case 'tiktok':
      return await extractFromTiktok(url);
    case 'youtube':
      return await extractFromYoutube(url);
    case 'url':
    default:
      return await extractFromUrl(url);
  }
}

/**
 * Auto-detect source type from URL
 */
export function detectSourceType(url) {
  if (!url) return 'raw';
  const lower = url.toLowerCase();
  
  if (lower.includes('facebook.com') || lower.includes('fb.com') || lower.includes('fb.watch')) {
    return 'facebook';
  }
  if (lower.includes('tiktok.com') || lower.includes('vm.tiktok')) {
    return 'tiktok';
  }
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) {
    return 'youtube';
  }
  return 'url';
}
