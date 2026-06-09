/**
 * Evidence Library Builder
 * Layer 3: รับ relationships + evidenceCategories → ค้นภาพแยกตาม category
 * Output: { hero: [urls], mother: [urls], caregiving: [urls], ... }
 * v4: เพิ่ม Source Authority scoring + stock photo filter
 */

import { scoreAndFilterImages } from '@/lib/services/sourceAuthorityService';

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

  // รวมผลลัพธ์แยก category + apply Authority scoring
  const seen = new Set();
  results.forEach((r, idx) => {
    if (r.status !== 'fulfilled') {
      console.warn(`[EvidenceLibrary] Query "${tasks[idx]?.q}" failed: ${r.reason?.message?.slice(0, 60)}`);
      return;
    }
    const cat = tasks[idx].category;
    if (!library[cat]) library[cat] = [];

    // ★ v4: apply Source Authority scoring + filter stock photos
    const scoredImgs = scoreAndFilterImages(r.value);

    for (const img of scoredImgs) {
      if (!img.imageUrl || seen.has(img.imageUrl)) continue;
      if (library[cat].length >= MAX_PER_CATEGORY) continue;
      if (totalCount >= MAX_TOTAL) break;
      seen.add(img.imageUrl);
      library[cat].push(img);
      totalCount++;
    }
  });

  // ★ FIX 2: Story Weight Quota + negativeFocus Demoting
  // ใช้ coreStory จาก identity เพื่อ cap จำนวนภาพต่อ category + demote ภาพ negativeFocus
  const storyWeight = identity?.coreStory?.storyWeight || {};
  const negativeFocus = identity?.coreStory?.negativeFocus || [];
  const hasStoryWeight = Object.keys(storyWeight).filter(k => k !== '_comment').length > 0;

  for (const cat of Object.keys(library)) {
    let catImgs = library[cat];
    if (!catImgs || catImgs.length === 0) continue;

    // ★ negativeFocus demoting: ภาพที่ title/snippet/url มีคำใน negativeFocus → ย้ายไปท้าย
    if (negativeFocus.length > 0) {
      const kept = [];
      const demoted = [];
      for (const img of catImgs) {
        const textToCheck = `${img.title || ''} ${img.snippet || ''} ${img.imageUrl || ''}`.toLowerCase();
        const isNegative = negativeFocus.some(neg => textToCheck.includes(neg.toLowerCase()));
        if (isNegative) {
          img.negativeFocusPenalty = -0.4;
          img.authorityScore = Math.max(0, (img.authorityScore || 0.35) - 0.4);
          demoted.push(img);
        } else {
          kept.push(img);
        }
      }
      if (demoted.length > 0) {
        console.log(`[EvidenceLibrary] ⚠️ negativeFocus demote (${cat}): ${demoted.length} images moved to back`);
        library[cat] = [...kept, ...demoted];
      }
    }

    // ★ storyWeight quota: cap จำนวนภาพต่อ category ตาม weight
    if (hasStoryWeight) {
      // หา weight ที่ตรงกับ category (match แบบ substring ไม่ sensitive)
      const matchedKey = Object.keys(storyWeight).find(k =>
        k !== '_comment' && (cat.includes(k) || k.includes(cat))
      );
      if (matchedKey) {
        const weightPct = Number(storyWeight[matchedKey]) || 0;
        const maxImages = Math.max(1, Math.round((weightPct / 100) * MAX_TOTAL));
        if (library[cat].length > maxImages) {
          console.log(`[EvidenceLibrary] 📊 storyWeight cap (${cat}): ${library[cat].length} → ${maxImages} (weight: ${weightPct}%)`);
          library[cat] = library[cat].slice(0, maxImages);
        }
      }
    }
  }

  // Recount after quota/demote
  totalCount = Object.values(library).reduce((sum, imgs) => sum + (imgs?.length || 0), 0);

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
