import * as cheerio from 'cheerio';

/**
 * ดึงเนื้อหาจาก URL เว็บไซต์ข่าว/บทความ
 */
export async function extractFromUrl(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove unwanted elements
    $('script, style, nav, footer, header, aside, .ads, .advertisement, .social-share, .comments, .related-posts, iframe, noscript').remove();

    // Extract title
    const title = $('meta[property="og:title"]').attr('content')
      || $('title').text()
      || $('h1').first().text()
      || '';

    // Extract description
    const description = $('meta[property="og:description"]').attr('content')
      || $('meta[name="description"]').attr('content')
      || '';

    // Extract main image
    const image = $('meta[property="og:image"]').attr('content') || '';

    // Extract article body — try common selectors
    const articleSelectors = [
      'article .entry-content',
      'article .post-content',
      'article .article-content',
      'article .content-detail',
      '.article-body',
      '.post-body',
      '.entry-content',
      '.content-area',
      '[itemprop="articleBody"]',
      '.detail-content',
      '#article-content',
      'article',
      '.post',
      'main',
    ];

    let bodyText = '';
    for (const selector of articleSelectors) {
      const el = $(selector);
      if (el.length && el.text().trim().length > 100) {
        // Get paragraphs
        const paragraphs = [];
        el.find('p').each((_, p) => {
          const text = $(p).text().trim();
          if (text.length > 20) paragraphs.push(text);
        });
        if (paragraphs.length > 0) {
          bodyText = paragraphs.join('\n\n');
          break;
        }
      }
    }

    // Fallback: get all p tags
    if (!bodyText) {
      const allP = [];
      $('p').each((_, p) => {
        const text = $(p).text().trim();
        if (text.length > 30) allP.push(text);
      });
      bodyText = allP.slice(0, 30).join('\n\n');
    }

    // Final fallback: get body text
    if (!bodyText || bodyText.length < 50) {
      bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 3000);
    }

    return {
      success: true,
      type: 'url',
      title: title.trim(),
      description: description.trim(),
      text: bodyText.trim(),
      image,
      url,
      extractedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      success: false,
      type: 'url',
      error: `ไม่สามารถดึงเนื้อหาจาก URL ได้: ${error.message}`,
      url,
    };
  }
}
