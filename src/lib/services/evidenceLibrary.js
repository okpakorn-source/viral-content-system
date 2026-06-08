/**
 * Evidence Library Builder
 * Layer 3: รับ relationships + evidenceCategories → ค้นภาพแยกตาม category
 * Output: { hero: [urls], mother: [urls], caregiving: [urls], ... }
 */

const MAX_PER_CATEGORY = 10;
const MAX_TOTAL = 40;
const QUERY_TIMEOUT_MS = 8000;

/**
 * สร้าง Serper Image search queries ต่อ category
 */
function buildCategoryQueries(category, hero, relationships, identity) {
  const heroName = hero?.searchName || hero?.name || '';
  const keyScenes = identity?.keyScenes || [];
  const location = identity?.location || '';

  // หา relationship ที่ตรงกับ category
  const relMatch = relationships.find(r => r.role === category);
  const relName = relMatch?.searchName || relMatch?.name || '';

  switch (category) {
    case 'hero':
      return [
        heroName,
        `${heroName} ภาพล่าสุด`,
      ].filter(Boolean);

    case 'mother':
    case 'father':
    case 'sibling':
    case 'child':
    case 'spouse':
    case 'partner': {
      const relLabel = { mother: 'แม่', father: 'พ่อ', sibling: 'พี่น้อง', child: 'ลูก', spouse: 'สามีภรรยา', partner: 'แฟน' }[category] || category;
      const queries = relName
        ? [`${heroName} ${relName}`, `${heroName} ${relLabel}`]
        : [`${heroName} ${relLabel}`, `${heroName} ครอบครัว`];
      return queries.filter(Boolean);
    }

    case 'caregiving':
      return [
        keyScenes[0] ? `${heroName} ${keyScenes[0]}` : `${heroName} ดูแล`,
        `${heroName} ช่วยเหลือ`,
      ].filter(Boolean);

    case 'activity':
      return [
        keyScenes[0] ? `${heroName} ${keyScenes[0]}` : null,
        keyScenes[1] ? `${heroName} ${keyScenes[1]}` : null,
        `${heroName} กิจกรรม`,
      ].filter(Boolean);

    case 'interview':
      return [
        `${heroName} สัมภาษณ์`,
        `${heroName} รายการ`,
      ].filter(Boolean);

    case 'work':
      return [
        `${heroName} ทำงาน`,
        `${heroName} อาชีพ`,
      ].filter(Boolean);

    case 'location':
      return location
        ? [`${location} ภาพ`, `${heroName} ${location}`]
        : [`${heroName} สถานที่`];

    case 'evidence':
      return keyScenes.length > 0
        ? [`${keyScenes[0]} หลักฐาน`, `${heroName} ${keyScenes[0]} ภาพ`]
        : [`${heroName} หลักฐาน`];

    case 'relationship':
      return relName
        ? [`${heroName} ${relName}`, `${heroName} คนสำคัญ`]
        : [`${heroName} ครอบครัว`];

    case 'family':
      return [`${heroName} ครอบครัว`, `${heroName} family`];

    default:
      return [`${heroName} ${category}`];
  }
}

/**
 * buildEvidenceLibrary — ค้นภาพแยกตาม evidenceCategories
 * @param {Object} resolvedRelationships — output จาก resolveRelationships
 * @param {Object} identity — จาก analyzeStoryIdentity
 * @returns {{ [category]: Array<{imageUrl, query, category}>, totalCount, warning }}
 */
export async function buildEvidenceLibrary(resolvedRelationships, identity) {
  const SERPER_API_KEY = process.env.SERPER_API_KEY;

  if (!SERPER_API_KEY) {
    return { totalCount: 0, warning: 'No SERPER_API_KEY', _raw: {} };
  }

  const { hero, relationships = [], evidenceCategories = ['hero', 'interview'] } = resolvedRelationships || {};

  if (!hero?.searchName && !hero?.name) {
    return { totalCount: 0, warning: 'ไม่มีข้อมูล hero — ข้ามการค้นภาพ', _raw: {} };
  }

  const library = {};
  let totalCount = 0;

  // สร้าง tasks ทั้งหมด (category × queries)
  const tasks = [];
  for (const category of evidenceCategories) {
    const queries = buildCategoryQueries(category, hero, relationships, identity);
    if (queries.length === 0) continue;
    for (const q of queries.slice(0, 2)) {
      tasks.push({ category, q });
    }
  }

  console.log(`[EvidenceLibrary] 🔍 ${tasks.length} queries across ${evidenceCategories.length} categories`);

  // ยิงทั้งหมด parallel
  const results = await Promise.allSettled(
    tasks.map(({ category, q }) =>
      fetch('https://google.serper.dev/images', {
        method: 'POST',
        headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, gl: 'th', hl: 'th', num: 10, imgSize: 'large', imgType: 'photo' }),
        signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
      })
        .then(r => r.json())
        .then(data =>
          (data.images || []).map(img => ({
            imageUrl: img.imageUrl,
            thumbnailUrl: img.thumbnailUrl,
            title: img.title,
            sourceUrl: img.link,
            query: q,
            category,
            entityName: hero.name,
          }))
        )
    )
  );

  // รวมผลลัพธ์แยก category
  const seen = new Set();
  results.forEach((r, idx) => {
    if (r.status !== 'fulfilled') {
      console.warn(`[EvidenceLibrary] Query "${tasks[idx]?.q}" failed: ${r.reason?.message?.slice(0, 60)}`);
      return;
    }
    const cat = tasks[idx].category;
    if (!library[cat]) library[cat] = [];

    for (const img of r.value) {
      if (!img.imageUrl || seen.has(img.imageUrl)) continue;
      if (library[cat].length >= MAX_PER_CATEGORY) continue;
      if (totalCount >= MAX_TOTAL) break;
      seen.add(img.imageUrl);
      library[cat].push(img);
      totalCount++;
    }
  });

  // Log summary
  const catSummary = Object.entries(library)
    .map(([cat, imgs]) => `${cat}:${imgs.length}`)
    .join(' ');
  console.log(`[EvidenceLibrary] ✅ Total: ${totalCount} images — ${catSummary}`);

  return {
    ...library,
    totalCount,
    warning: totalCount === 0 ? 'ไม่พบภาพจาก Evidence Library' : null,
    _raw: library,
  };
}
