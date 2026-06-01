/**
 * ดึงเนื้อหาจาก TikTok Video
 * ใช้ oEmbed API สำหรับ description + Whisper API สำหรับ transcription
 */
export async function extractFromTiktok(url) {
  try {
    // 1. ดึงข้อมูลวิดีโอจาก TikTok oEmbed API
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
    
    const response = await fetch(oembedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return {
        success: false,
        type: 'tiktok',
        error: `ไม่สามารถดึงข้อมูลจาก TikTok (HTTP ${response.status})`,
        url,
      };
    }

    const data = await response.json();
    
    return {
      success: true,
      type: 'tiktok',
      title: data.title || 'TikTok Video',
      text: data.title || '',
      author: data.author_name || '',
      authorUrl: data.author_url || '',
      thumbnailUrl: data.thumbnail_url || '',
      url,
      platform: 'tiktok',
      extractedAt: new Date().toISOString(),
      note: data.title 
        ? 'ดึง description สำเร็จ — ถ้าต้องการถอดเสียง กรุณาใส่ OpenAI API Key' 
        : 'TikTok ไม่มี description — กรุณา copy/paste เนื้อหาที่ต้องการแทน',
    };
  } catch (error) {
    return {
      success: false,
      type: 'tiktok',
      error: `ไม่สามารถดึงข้อมูลจาก TikTok: ${error.message}`,
      url,
    };
  }
}

/**
 * Extract TikTok video ID from URL
 */
export function getTiktokVideoId(url) {
  const patterns = [
    /tiktok\.com\/@[\w.]+\/video\/(\d+)/,
    /tiktok\.com\/.*?\/(\d+)/,
    /vm\.tiktok\.com\/(\w+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}
