/**
 * Personal Image Library Builder
 * Layer 2: รับ entityData → ค้นภาพด้วย entity-first Serper Image queries
 * Priority: ชื่อคน + กิจกรรมในข่าว (ไม่ใช่ keyword topic อย่างเดียว)
 */

export async function buildPersonalImageLibrary(entityData, identity, keyScenes = []) {
  if (!entityData?.found || !entityData?.entityName) {
    return { images: [], source: 'none', warning: entityData?.warning };
  }

  const SERPER_API_KEY = process.env.SERPER_API_KEY;
  if (!SERPER_API_KEY) {
    return { images: [], source: 'none', warning: 'No SERPER_API_KEY' };
  }

  const name = entityData.entityName;

  // Entity-first queries: ชื่อคนก่อนเสมอ → ตามด้วย context
  const entityQueries = [
    name,
    identity?.location ? `${name} ${identity.location}` : null,
    ...keyScenes.slice(0, 3).map(scene => `${name} ${scene}`),
    ...(entityData.entityImageQueries || []).slice(0, 2),
  ].filter(q => q && q.trim().length > 2);

  const allImages = [];

  try {
    const imageResults = await Promise.allSettled(
      entityQueries.slice(0, 5).map(q =>
        fetch('https://google.serper.dev/images', {
          method: 'POST',
          headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q, gl: 'th', hl: 'th', num: 10 }),
          signal: AbortSignal.timeout(10000),
        })
          .then(r => r.json())
          .then(data =>
            (data.images || []).map(img => ({
              ...img,
              query: q,
              source: 'entity_first',
              entityName: name,
            }))
          )
      )
    );

    imageResults.forEach(r => {
      if (r.status === 'fulfilled') allImages.push(...r.value);
    });

    // deduplicate by imageUrl
    const seen = new Set();
    const unique = allImages
      .filter(img => {
        if (!img.imageUrl || seen.has(img.imageUrl)) return false;
        seen.add(img.imageUrl);
        return true;
      })
      .slice(0, 30);

    console.log(
      `[PersonalImageLibrary] "${name}" → ${unique.length} unique entity-first images from ${entityQueries.length} queries`
    );

    return {
      images: unique,
      source: 'entity_first',
      entityName: name,
      queriesUsed: entityQueries,
      warning: null,
    };
  } catch (e) {
    console.error('[PersonalImageLibrary] Error:', e.message);
    return { images: [], source: 'error', warning: e.message };
  }
}
