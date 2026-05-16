import * as cheerio from 'cheerio';

/**
 * ดึงเนื้อหาจาก URL
 */
export async function extractFromUrl(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'th,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const $ = cheerio.load(html);

    // ลบ elements ที่ไม่ต้องการ
    $('script, style, nav, footer, header, aside, .ads, .advertisement, .social-share, .comments').remove();

    // ดึง title
    const title = $('meta[property="og:title"]').attr('content')
      || $('title').text()
      || $('h1').first().text()
      || '';

    // ดึง description
    const description = $('meta[property="og:description"]').attr('content')
      || $('meta[name="description"]').attr('content')
      || '';

    // ดึง image
    const image = $('meta[property="og:image"]').attr('content') || '';

    // ดึงเนื้อหาหลัก
    let content = '';
    const articleSelectors = ['article', '.article-content', '.post-content', '.entry-content', '.content-body', 'main'];
    
    for (const selector of articleSelectors) {
      const el = $(selector);
      if (el.length && el.text().trim().length > 100) {
        content = el.text().trim();
        break;
      }
    }

    // ถ้าไม่เจอ ใช้ body paragraphs
    if (!content) {
      const paragraphs = [];
      $('p').each((_, el) => {
        const text = $(el).text().trim();
        if (text.length > 30) paragraphs.push(text);
      });
      content = paragraphs.join('\n\n');
    }

    return {
      title: title.trim(),
      content: cleanText(content),
      description: description.trim(),
      image,
      url,
      source: new URL(url).hostname,
    };
  } catch (error) {
    throw new Error(`ไม่สามารถดึงเนื้อหาจาก URL: ${error.message}`);
  }
}

/**
 * ทำความสะอาดข้อความ
 */
export function cleanText(text) {
  return text
    .replace(/\s+/g, ' ')             // รวม whitespace
    .replace(/\n\s*\n/g, '\n\n')     // รวมบรรทัดว่าง
    .replace(/\t/g, ' ')              // แทน tab
    .replace(/[^\S\n]+/g, ' ')       // รวม spaces
    .trim();
}

/**
 * ดึงจาก raw text input
 */
export function extractFromRawText(text) {
  return {
    title: text.substring(0, 80).split('\n')[0] || 'เนื้อหาจากข้อความ',
    content: cleanText(text),
    description: text.substring(0, 160),
    image: '',
    url: '',
    source: 'raw_text',
  };
}
