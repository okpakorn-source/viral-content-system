/**
 * Entity Resolver Service
 * Layer 1: รับชื่อตัวละครหลัก → ค้นหา Social Profile URLs ด้วย Serper Web Search
 */

export async function resolveEntity(mainCharacter, newsTitle = '') {
  if (!mainCharacter || mainCharacter.length < 2) {
    return {
      found: false,
      warning: 'ไม่มีชื่อตัวละครหลัก — ไม่สามารถค้นหา Entity ได้',
      sources: {},
      imageSearchUrls: [],
      entityImageQueries: [],
    };
  }

  const SERPER_API_KEY = process.env.SERPER_API_KEY;
  if (!SERPER_API_KEY) {
    return {
      found: false,
      warning: 'ไม่มี SERPER_API_KEY',
      sources: {},
      imageSearchUrls: [],
      entityImageQueries: [`${mainCharacter}`],
    };
  }

  const queries = [
    `"${mainCharacter}" site:facebook.com`,
    `"${mainCharacter}" facebook page`,
    `"${mainCharacter}" youtube`,
    `"${mainCharacter}" site:kapook.com OR site:sanook.com OR site:thairath.co.th OR site:khaosod.co.th`,
  ];

  const sources = { facebook: [], youtube: [], newsPages: [] };

  try {
    const results = await Promise.allSettled(
      queries.map(q =>
        fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q, gl: 'th', hl: 'th', num: 5 }),
          signal: AbortSignal.timeout(8000),
        }).then(r => r.json())
      )
    );

    results.forEach(result => {
      if (result.status !== 'fulfilled') return;
      const organic = result.value?.organic || [];
      organic.forEach(item => {
        const url = item.link || '';
        if (!url) return;
        try {
          const hostname = new URL(url).hostname;
          if (hostname.includes('facebook.com')) {
            sources.facebook.push({ url, title: item.title, snippet: item.snippet });
          } else if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
            sources.youtube.push({ url, title: item.title });
          } else if (
            [
              'kapook.com', 'sanook.com', 'thairath.co.th', 'khaosod.co.th',
              'manager.co.th', 'posttoday.com', 'dailynews.co.th', 'matichon.co.th',
            ].some(d => hostname.includes(d))
          ) {
            sources.newsPages.push({ url, title: item.title, source: hostname });
          }
        } catch {
          // skip malformed URLs
        }
      });
    });

    // deduplicate
    sources.facebook = [...new Map(sources.facebook.map(s => [s.url, s])).values()].slice(0, 3);
    sources.youtube = [...new Map(sources.youtube.map(s => [s.url, s])).values()].slice(0, 2);
    sources.newsPages = [...new Map(sources.newsPages.map(s => [s.url, s])).values()].slice(0, 5);

    const found =
      sources.facebook.length > 0 ||
      sources.youtube.length > 0 ||
      sources.newsPages.length > 0;

    const warning = found
      ? null
      : `ไม่พบ Social Profile หรือหน้าข่าวของ "${mainCharacter}" — จะใช้ Google Images Fallback แทน`;

    const entityImageQueries = [
      mainCharacter,
      `${mainCharacter} ${newsTitle.slice(0, 30)}`.trim(),
      ...sources.facebook.slice(0, 1).map(() => `${mainCharacter} facebook`),
    ].filter(q => q.trim().length > 2);

    console.log(
      `[EntityResolver] "${mainCharacter}" → FB:${sources.facebook.length} YT:${sources.youtube.length} News:${sources.newsPages.length}`
    );
    if (warning) console.log(`[EntityResolver] ⚠️ ${warning}`);

    return {
      entityName: mainCharacter,
      found,
      sources,
      imageSearchUrls: sources.newsPages.map(n => n.url),
      entityImageQueries,
      warning,
    };
  } catch (e) {
    console.error('[EntityResolver] Error:', e.message);
    return {
      entityName: mainCharacter,
      found: false,
      warning: `Entity resolution error: ${e.message}`,
      sources: {},
      imageSearchUrls: [],
      entityImageQueries: [`${mainCharacter}`],
    };
  }
}
