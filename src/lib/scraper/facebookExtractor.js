/**
 * ดึงเนื้อหาจาก Facebook Post
 * Facebook บล็อก scraping — ใช้ oEmbed API + fallback paste text
 */
export async function extractFromFacebook(url) {
  try {
    // ลอง Facebook oEmbed API (ไม่ต้อง token สำหรับ public posts)
    const oembedUrl = `https://www.facebook.com/plugins/post/oembed.json/?url=${encodeURIComponent(url)}`;
    
    const response = await fetch(oembedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = await response.json();
      
      // Extract text from HTML embed
      let text = '';
      if (data.html) {
        // Simple HTML text extraction
        text = data.html
          .replace(/<[^>]*>/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, ' ')
          .trim();
      }

      return {
        success: true,
        type: 'facebook',
        title: data.author_name || 'Facebook Post',
        text: text || 'ไม่สามารถดึงข้อความจากโพสต์ได้ — กรุณา copy/paste ข้อความมาแทน',
        author: data.author_name || '',
        authorUrl: data.author_url || '',
        url,
        extractedAt: new Date().toISOString(),
      };
    }

    // Fallback — ลอง scrape ตรง (อาจไม่ได้)
    return {
      success: false,
      type: 'facebook',
      error: 'Facebook บล็อกการดึงข้อมูลอัตโนมัติ — กรุณา copy/paste ข้อความจากโพสต์มาในช่อง "ข้อความ" แทน',
      url,
      suggestion: 'paste',
    };
  } catch (error) {
    return {
      success: false,
      type: 'facebook',
      error: `ไม่สามารถดึงเนื้อหาจาก Facebook: ${error.message} — กรุณา copy/paste ข้อความแทน`,
      url,
      suggestion: 'paste',
    };
  }
}
