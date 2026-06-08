/**
 * Event Resolver Service
 * ใช้เมื่อ entityData.found === false (ไม่พบ Social Profile ของตัวละครหลัก)
 * → ค้นภาพด้วย event-first queries แทน (สถานที่, ซีน, keywords)
 */

/**
 * resolveEvent — ค้นภาพด้วย event-first queries
 * @param {Object} identity — จาก analyzeStoryIdentity
 * @returns {{ eventImages: Array, mode: 'event_first', queriesUsed: string[] }}
 */
export async function resolveEvent(identity) {
  const SERPER_API_KEY = process.env.SERPER_API_KEY;
  if (!SERPER_API_KEY) {
    return { eventImages: [], mode: 'event_first', queriesUsed: [], warning: 'No SERPER_API_KEY' };
  }

  const mainChar = identity?.mainCharacter || '';
  const location = identity?.location || '';
  const keyScenes = identity?.keyScenes || [];
  const keywords = identity?.keywords || [];

  // Event-first queries: สถานที่/ซีน/keywords — ไม่เน้นชื่อคน
  const eventQueries = [
    location && keyScenes[0] ? `${keyScenes[0]} ${location}`.trim() : null,
    location && keyScenes[1] ? `${keyScenes[1]} ${location}`.trim() : null,
    keyScenes[0] || null,
    keyScenes[1] || null,
    ...keywords.slice(0, 3),
    mainChar && keyScenes[0] ? `${mainChar} ${keyScenes[0]}`.trim() : null,
    mainChar && location ? `${mainChar} ${location}`.trim() : null,
  ].filter(q => q && q.trim().length > 2);

  if (eventQueries.length === 0) {
    return { eventImages: [], mode: 'event_first', queriesUsed: [], warning: 'ไม่มี event queries' };
  }

  const allImages = [];

  try {
    const results = await Promise.allSettled(
      eventQueries.slice(0, 5).map(q =>
        fetch('https://google.serper.dev/images', {
          method: 'POST',
          headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q, gl: 'th', hl: 'th', num: 8, imgSize: 'large', imgType: 'photo' }),
          signal: AbortSignal.timeout(8000),
        })
          .then(r => r.json())
          .then(data =>
            (data.images || []).map(img => ({
              imageUrl: img.imageUrl,
              thumbnailUrl: img.thumbnailUrl,
              title: img.title,
              sourceUrl: img.link,
              query: q,
              category: 'event',
              mode: 'event_first',
            }))
          )
      )
    );

    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') allImages.push(...r.value);
      else console.warn(`[EventResolver] Query "${eventQueries[idx]}" failed: ${r.reason?.message?.slice(0, 60)}`);
    });

    // deduplicate
    const seen = new Set();
    const unique = allImages.filter(img => {
      if (!img.imageUrl || seen.has(img.imageUrl)) return false;
      seen.add(img.imageUrl);
      return true;
    }).slice(0, 30);

    console.log(`[EventResolver] event-first → ${unique.length} images from ${eventQueries.length} queries`);

    return {
      eventImages: unique,
      mode: 'event_first',
      queriesUsed: eventQueries,
      warning: unique.length === 0 ? 'ไม่พบภาพจาก Event Resolver' : null,
    };
  } catch (e) {
    console.error('[EventResolver] Error:', e.message);
    return {
      eventImages: [],
      mode: 'event_first',
      queriesUsed: eventQueries,
      warning: `Event Resolver error: ${e.message}`,
    };
  }
}
