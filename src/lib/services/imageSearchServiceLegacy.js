import { getYoutubeVideoId } from '@/lib/scraper/youtubeExtractor';
import { getTiktokVideoId } from '@/lib/scraper/tiktokExtractor';
import { extractFromUrl } from '@/lib/scraper/urlExtractor';

/**
 * Legacy: extractSourceImage
 * เก็บไว้สำหรับ backward compatibility
 */

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 8000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const response = await fetch(resource, {
    ...options,
    signal: controller.signal  
  });
  clearTimeout(id);
  return response;
}

export async function extractSourceImage(url, sourceType) {
  try {
    if (!url) return null;
    
    if (sourceType === 'youtube' || url.includes('youtube.com') || url.includes('youtu.be')) {
      const videoId = getYoutubeVideoId(url);
      if (videoId) {
        return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
      }
    }
    
    if (sourceType === 'tiktok' || url.includes('tiktok.com')) {
      const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
      const response = await fetchWithTimeout(oembedUrl);
      if (response.ok) {
        const data = await response.json();
        return data.thumbnail_url || null;
      }
    }
    
    const scrapeData = await extractFromUrl(url);
    if (scrapeData.success && scrapeData.image) {
      return scrapeData.image;
    }
    
    return null;
  } catch (err) {
    console.error('[ImageSearch] Error extracting source image:', err.message);
    return null;
  }
}

export async function searchGoogleImages(keyword, newsTitle, limit = 5) {
  try {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) return [];
    const safeTitle = (newsTitle || '').length > 60 ? (newsTitle || '').slice(0, 60) : (newsTitle || '');
    const searchQuery = `${safeTitle} ${keyword}`;
    
    const response = await fetchWithTimeout('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: searchQuery, gl: 'th', hl: 'th', num: limit + 10 }),
      timeout: 10000
    });

    if (!response.ok) return [];
    const data = await response.json();
    if (data?.images?.length > 0) {
      return data.images.map(img => img.imageUrl).slice(0, limit);
    }
    return [];
  } catch (err) {
    return [];
  }
}
