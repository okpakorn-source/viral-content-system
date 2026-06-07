import { NextResponse } from 'next/server';
import { expandKeywords } from '@/lib/services/radar/keywordExpansion';
import { collectFromAllSources } from '@/lib/services/radar/sourceCollector';
import { detectDuplicates } from '@/lib/services/radar/duplicateDetector';
import { clusterArticles } from '@/lib/services/radar/newsClusterer';
import { calculateHeatScore, calculateRewriteScore } from '@/lib/services/radar/heatScorer';
import { calculateCredibilityScore } from '@/lib/services/radar/sourceCredibility';
import { analyzeAngles } from '@/lib/services/radar/angleAnalyzer';
import { callAI } from '@/lib/ai/openai';
import { MODEL_FAST } from '@/lib/ai/modelConfig';

// เพิ่ม timeout สำหรับ multi-source pipeline
export const maxDuration = 120;

// === Main GET handler — รองรับ 2 modes ===
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode');

  try {
    // === MODE 1: Hot Keywords ===
    if (mode === 'keywords') {
      return await handleKeywords();
    }

    // === MODE 2: Full Search Pipeline ===
    if (mode === 'search') {
      const query = searchParams.get('q');
      const sources = searchParams.get('sources')?.split(',') || ['serper', 'gdelt', 'rss', 'youtube', 'social'];
      const timeRange = searchParams.get('time') || '7d';
      if (!query) {
        return NextResponse.json(
          { success: false, error: 'ไม่มีคำค้น', errorType: 'MISSING_QUERY' },
          { status: 400 }
        );
      }
      return await handleSearch(query, sources, timeRange);
    }

    return NextResponse.json(
      { success: false, error: 'Invalid mode', errorType: 'INVALID_MODE' },
      { status: 400 }
    );
  } catch (err) {
    console.error('[Radar-API] Error:', err.message);
    return NextResponse.json(
      { success: false, error: err.message, errorType: 'RADAR_ERROR' },
      { status: 500 }
    );
  }
}

// =============================================
// handleKeywords — ดึงคีย์เวิร์ดฮอตจาก Serper Autocomplete + News + AI
// =============================================
async function handleKeywords() {
  const seeds = [
    'ข่าวด่วนวันนี้', 'ดราม่า', 'ข่าวดารา', 'ข่าวการเมืองวันนี้',
    'ข่าวอาชญากรรม', 'ข่าวไวรัล', 'ข่าวสังคม', 'ข่าวบันเทิง',
  ];

  try {
    const SERPER_KEY = process.env.SERPER_API_KEY;

    // Serper autocomplete สำหรับทุก seed
    const autoPromises = seeds.map(seed =>
      fetch('https://google.serper.dev/autocomplete', {
        method: 'POST',
        headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: seed, gl: 'th', hl: 'th' }),
      }).then(r => r.json()).catch(() => ({ suggestions: [] }))
    );

    // Serper news สำหรับ trending (ใช้ 4 seed แรก)
    const newsPromises = seeds.slice(0, 4).map(seed =>
      fetch('https://google.serper.dev/news', {
        method: 'POST',
        headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: seed, gl: 'th', hl: 'th', num: 5 }),
      }).then(r => r.json()).catch(() => ({ news: [] }))
    );

    const [autoResults, newsResults] = await Promise.all([
      Promise.all(autoPromises),
      Promise.all(newsPromises),
    ]);

    // รวม suggestions + headlines
    const allSuggestions = autoResults.flatMap(r =>
      (r.suggestions || []).map(s => s.value || s)
    );
    const allHeadlines = newsResults.flatMap(r =>
      (r.news || []).map(n => n.title)
    );

    // AI สรุปเป็น hot keywords
    const aiPrompt = `คุณคือ AI วิเคราะห์เทรนด์ข่าว

=== Autocomplete Suggestions ===
${allSuggestions.slice(0, 40).join('\n')}

=== Headlines ===
${allHeadlines.slice(0, 20).join('\n')}

จากข้อมูลด้านบน สรุปเป็น 12-15 คีย์เวิร์ดฮอตที่ควรค้นหาต่อ

ตอบเป็น JSON:
{ "keywords": [{ "keyword": "คำค้นหา", "category": "drama|celeb|politics|crime|social|tech|sport|economy|health|other", "searchQuery": "คำค้นหาแบบยาวขึ้น", "heatLevel": 1|2|3 }] }

heatLevel: 3=ร้อนมาก, 2=กำลังมา, 1=น่าสนใจ
เลือกคีย์เวิร์ดที่กำลังเป็นที่สนใจ มีความเกี่ยวข้อง และทำข่าวไวรัลได้จริง`;

    try {
      const aiResult = await callAI({
        prompt: aiPrompt,
        model: MODEL_FAST,
        temperature: 0.4,
        maxTokens: 2000,
      });
      if (aiResult?.keywords?.length > 0) {
        return NextResponse.json({ success: true, keywords: aiResult.keywords });
      }
    } catch (aiErr) {
      console.warn('[Radar-API] AI keywords failed:', aiErr.message);
    }

    // Fallback: ใช้ raw autocomplete โดยตรง
    const fallbackKeywords = allSuggestions.slice(0, 12).map((s, i) => ({
      keyword: s,
      category: 'other',
      searchQuery: s,
      heatLevel: i < 3 ? 3 : i < 7 ? 2 : 1,
    }));

    return NextResponse.json({ success: true, keywords: fallbackKeywords });
  } catch (err) {
    console.error('[Radar-API] Keywords error:', err.message);
    return NextResponse.json(
      { success: false, error: err.message, errorType: 'KEYWORDS_ERROR' },
      { status: 500 }
    );
  }
}

// =============================================
// handleSearch — Full multi-source search pipeline
// =============================================
async function handleSearch(query, sources, timeRange) {
  const startTime = Date.now();
  console.log(`[Radar-API] 📡 Full search: "${query}" sources=[${sources}] time=${timeRange}`);

  // Step 1: ขยายคีย์เวิร์ดด้วย AI
  const expandedQueries = await expandKeywords(query);
  const enabledQueries = expandedQueries.filter(q => q.enabled);
  console.log(`[Radar-API] 🧠 Expanded: ${enabledQueries.length} queries`);

  // Step 2: รวบรวมข่าวจากทุกแหล่ง
  const { articles: rawArticles, meta } = await collectFromAllSources(enabledQueries, {
    sources,
    timeRange,
  });
  console.log(`[Radar-API] 📰 Collected: ${rawArticles.length} articles (${JSON.stringify(meta.perSource)})`);

  if (rawArticles.length === 0) {
    return NextResponse.json({
      success: true,
      clusters: [],
      expandedQueries: enabledQueries,
      meta: { ...meta, duration: Date.now() - startTime },
    });
  }

  // Step 3: ตรวจจับข่าวซ้ำ
  const { pairs: duplicatePairs } = detectDuplicates(rawArticles);
  console.log(`[Radar-API] 🔍 Duplicates: ${duplicatePairs.length} pairs found`);

  // Step 4: จัดกลุ่มข่าว
  let clusters = clusterArticles(rawArticles, duplicatePairs);
  console.log(`[Radar-API] 📋 Clusters: ${clusters.length} groups`);

  // Step 5: คำนวณคะแนนแต่ละ cluster + flatten ให้ UI อ่านง่าย
  clusters = clusters.map(cluster => {
    const heat = calculateHeatScore(cluster);
    const cred = calculateCredibilityScore(cluster);
    const rewrite = calculateRewriteScore(cluster);
    return {
      ...cluster,
      // === UI-friendly aliases ===
      title: cluster.mainTitle || '',
      snippet: cluster.summary || '',
      link: cluster.bestSourceUrl || '',
      heatScore: typeof heat === 'number' ? heat : (heat?.total || heat?.score || 0),
      credibilityScore: typeof cred === 'number' ? cred : (cred?.total || cred?.score || 0),
      rewriteScore: typeof rewrite === 'number' ? rewrite : (rewrite?.total || rewrite?.score || 0),
      // === Original nested scores ===
      scores: { heat, credibility: cred, rewritePotential: rewrite },
    };
  });

  // Step 6: เรียงตาม heat score (descending)
  clusters.sort((a, b) => (b.heatScore || 0) - (a.heatScore || 0));

  // Step 7: วิเคราะห์มุมข่าวสำหรับ top clusters (สูงสุด 10)
  const topClusters = clusters.slice(0, 10);
  const anglePromises = topClusters.map(c =>
    analyzeAngles(c).catch(err => {
      console.warn(`[Radar-API] Angle analysis failed for cluster ${c.clusterId}:`, err.message);
      return { angles: [], riskLabels: [] };
    })
  );
  const angleResults = await Promise.all(anglePromises);
  topClusters.forEach((c, i) => {
    c.suggestedAngles = angleResults[i]?.angles || [];
    c.riskLabels = angleResults[i]?.riskLabels || [];
  });

  const duration = Date.now() - startTime;
  console.log(`[Radar-API] ✅ Done in ${(duration / 1000).toFixed(1)}s: ${clusters.length} clusters, top heat=${topClusters[0]?.heatScore || 0}`);

  return NextResponse.json({
    success: true,
    clusters: topClusters,
    totalClusters: clusters.length,
    expandedQueries: enabledQueries,
    meta: {
      ...meta,
      duplicatesFound: duplicatePairs.length,
      clustersTotal: clusters.length,
      duration,
    },
  });
}
