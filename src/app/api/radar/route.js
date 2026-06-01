import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai/openai';
import { getSupabase } from '@/lib/supabase';

export const maxDuration = 60;

// === Serper fetch helper ===
async function serperFetch(endpoint, query, num = 5) {
  const SERPER_API_KEY = process.env.SERPER_API_KEY;
  if (!SERPER_API_KEY) throw new Error('SERPER_API_KEY not configured');

  const res = await fetch(`https://google.serper.dev/${endpoint}`, {
    method: 'POST',
    headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, gl: 'th', hl: 'th', num }),
  });
  if (!res.ok) throw new Error(`Serper ${endpoint} error: ${res.status}`);
  return res.json();
}

// =============================================
// MODE 1: GET /api/radar?mode=keywords
// → ดึงคีย์เวิร์ดร้อนจาก Autocomplete + News headlines
// → แสดงเป็นปุ่มให้เลือกก่อน
// =============================================
async function getHotKeywords() {
  const seedQueries = [
    'ข่าวด่วนวันนี้',
    'ดราม่า',
    'ข่าวดารา',
    'ข่าวการเมืองวันนี้',
    'ข่าวอาชญากรรม',
    'ข่าวไวรัล',
  ];

  // Parallel: autocomplete + news headlines from multiple seeds
  const tasks = seedQueries.flatMap(q => [
    serperFetch('autocomplete', q, 8).catch(() => ({ suggestions: [] })),
    serperFetch('news', q, 5).catch(() => ({ news: [] })),
  ]);

  const results = await Promise.allSettled(tasks);

  const rawKeywords = new Set();
  const newsHeadlines = [];

  results.forEach(r => {
    if (r.status !== 'fulfilled' || !r.value) return;
    const data = r.value;

    // Autocomplete suggestions
    (data.suggestions || []).forEach(s => {
      const val = (typeof s === 'string' ? s : s.value || '').trim();
      if (val && val.length > 3 && val.length < 60) rawKeywords.add(val);
    });

    // News titles → extract as keywords
    (data.news || []).forEach(item => {
      if (item.title) {
        newsHeadlines.push({
          title: item.title,
          source: item.source || '',
          date: item.date || '',
          link: item.link || '',
        });
      }
    });
  });

  // AI: จากข่าว + autocomplete → สรุปเป็นคีย์เวิร์ดร้อน 12 คำ
  const headlinesSummary = newsHeadlines.slice(0, 25).map((h, i) =>
    `${i + 1}. "${h.title}" (${h.source})`
  ).join('\n');

  const autocompleteSummary = [...rawKeywords].slice(0, 30).join(', ');

  const prompt = `จากข้อมูลด้านล่าง สรุปเป็น "คีย์เวิร์ดร้อน" 12 คำ ที่คนไทยกำลังสนใจตอนนี้

กฎ:
- แต่ละคีย์ต้องเป็นประเด็นที่แตกต่างกัน (ห้ามซ้ำบริบท)
- เขียนสั้นกระชับ 3-8 คำ ภาษาคน (ไม่ใช่ภาษาข่าว)
- ใส่ emoji 1 ตัวนำหน้าแต่ละคีย์
- เรียงจากร้อนสุด → น้อยสุด
- ระบุหมวดของแต่ละคีย์ (drama/celeb/politics/crime/social/tech/sport/economy/health)

=== พาดหัวข่าว 25 เรื่อง ===
${headlinesSummary}

=== คำค้นหา Autocomplete ===
${autocompleteSummary}

=== ส่งคืน JSON ===
{
  "keywords": [
    {
      "keyword": "🔥 กราดยิง อตก ตลาดสด",
      "category": "crime",
      "searchQuery": "กราดยิง อตก ตลาด ข่าวล่าสุด",
      "heatLevel": 3
    }
  ]
}

heatLevel: 3 = ร้อนมาก, 2 = กำลังมา, 1 = น่าสนใจ`;

  try {
    const aiResult = await callAI({
      prompt,
      model: 'gpt-4o-mini',
      temperature: 0.4,
      maxTokens: 1500,
      systemPrompt: 'คุณคือ Trend Analyst ตอบเป็น JSON เท่านั้น',
    });
    return aiResult.keywords || [];
  } catch (err) {
    console.error('[Radar Keywords AI] Error:', err.message);
    // Fallback: use raw autocomplete
    return [...rawKeywords].slice(0, 12).map((kw, i) => ({
      keyword: kw,
      category: 'other',
      searchQuery: kw,
      heatLevel: i < 4 ? 3 : i < 8 ? 2 : 1,
    }));
  }
}

// =============================================
// MODE 2: GET /api/radar?mode=search&q=คีย์เวิร์ด
// → ไปหาข่าวเฉพาะคีย์นั้น + AI วิเคราะห์
// =============================================
async function searchKeyword(query) {
  // Parallel: News + Search
  const [newsRes, searchRes] = await Promise.allSettled([
    serperFetch('news', query, 10),
    serperFetch('search', query, 8),
  ]);

  const articles = [];
  const seenLinks = new Set();

  // News
  if (newsRes.status === 'fulfilled') {
    (newsRes.value.news || []).forEach(item => {
      if (item.link && !seenLinks.has(item.link)) {
        seenLinks.add(item.link);
        articles.push({
          title: item.title || '', link: item.link,
          snippet: item.snippet || '', source: item.source || '',
          date: item.date || '', imageUrl: item.imageUrl || null, _from: 'news',
        });
      }
    });
  }

  // Search organic + topStories
  if (searchRes.status === 'fulfilled') {
    const data = searchRes.value;
    [...(data.topStories || []), ...(data.organic || [])].forEach(item => {
      if (item.link && !seenLinks.has(item.link)) {
        seenLinks.add(item.link);
        articles.push({
          title: item.title || '', link: item.link,
          snippet: item.snippet || '', source: item.source || item.displayLink || '',
          date: item.date || '', imageUrl: item.imageUrl || null, _from: 'search',
        });
      }
    });
  }

  if (articles.length === 0) return { articles: [], aiSummary: null };

  // AI: วิเคราะห์ข่าวที่ได้ + dedup + แนะนำมุม
  const articlesSummary = articles.slice(0, 20).map((a, i) =>
    `[${i + 1}] "${a.title}" — ${a.source} ${a.date ? '(' + a.date + ')' : ''}\nSnippet: ${(a.snippet || '').slice(0, 80)}`
  ).join('\n\n');

  try {
    const aiResult = await callAI({
      prompt: `คุณเป็น Trend Analyst วิเคราะห์ข่าวคีย์เวิร์ด "${query}"

จากข่าว ${articles.length} เรื่องด้านล่าง:

1. **จัดกลุ่มข่าวซ้ำ** (ต่างสำนักแต่เรื่องเดียวกัน → รวมเป็น 1)
2. **เลือก Top 5 เรื่องที่แตกต่างกัน** (ห้ามซ้ำบริบท)
3. **ให้คะแนน Heat Score 0-100** แต่ละเรื่อง
4. **แนะนำมุมข่าว 2-3 มุม** สำหรับทำคอนเทนต์

=== ข่าว ${articles.length} เรื่อง ===
${articlesSummary}

=== ส่งคืน JSON ===
{
  "summary": "สรุปภาพรวมสถานการณ์ 1-2 ประโยค",
  "top5": [
    {
      "rank": 1,
      "title": "หัวข้อกระชับ ภาษาคน",
      "link": "URL ข่าวต้นฉบับ",
      "sources": ["ไทยรัฐ", "ข่าวสด"],
      "sourceCount": 2,
      "heatScore": 90,
      "snippet": "สรุปสั้นๆ 1-2 ประโยค",
      "suggestedAngles": ["มุม 1", "มุม 2"],
      "whyHot": "ทำไมข่าวนี้น่าสนใจ"
    }
  ],
  "duplicatesRemoved": 5
}`,
      model: 'gpt-4o-mini',
      temperature: 0.3,
      maxTokens: 2000,
      systemPrompt: 'คุณคือ Trend Analyst ตอบเป็น JSON เท่านั้น',
    });

    // Enrich with image + link from raw
    const top5 = (aiResult.top5 || []).map(item => {
      const matchedRaw = articles.find(a => a.link === item.link) ||
        articles.find(a => a.title?.includes(item.title?.slice(0, 15)));
      return {
        ...item,
        link: item.link || matchedRaw?.link || '',
        imageUrl: matchedRaw?.imageUrl || null,
        heatLevel: item.heatScore >= 80 ? '🔥🔥🔥' : item.heatScore >= 60 ? '🔥🔥' : item.heatScore >= 40 ? '🔥' : '❄️',
      };
    });

    return {
      articles: top5,
      aiSummary: aiResult.summary || null,
      duplicatesRemoved: aiResult.duplicatesRemoved || 0,
      totalRaw: articles.length,
    };
  } catch (err) {
    console.error('[Radar Search AI] Error:', err.message);
    // Fallback: raw articles
    return {
      articles: articles.slice(0, 5).map((a, i) => ({
        rank: i + 1, title: a.title, link: a.link, sources: [a.source],
        sourceCount: 1, heatScore: 50, snippet: a.snippet?.slice(0, 100),
        suggestedAngles: [], whyHot: '', heatLevel: '🔥', imageUrl: a.imageUrl,
      })),
      aiSummary: null,
      totalRaw: articles.length,
    };
  }
}

// === Save to history for freshness ===
async function saveToHistory(keyword, titles) {
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.from('radar_history').insert({
      category: keyword.slice(0, 50),
      titles,
      created_at: new Date().toISOString(),
    });
  } catch {}
}

// === Main GET handler ===
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'keywords';
    const query = searchParams.get('q') || '';

    // MODE 1: Get hot keywords
    if (mode === 'keywords') {
      console.log('[Radar] Scanning hot keywords...');
      const keywords = await getHotKeywords();
      return NextResponse.json({
        success: true,
        mode: 'keywords',
        keywords,
        scannedAt: new Date().toISOString(),
      });
    }

    // MODE 2: Search specific keyword
    if (mode === 'search' && query) {
      console.log(`[Radar] Deep search: "${query}"`);
      const result = await searchKeyword(query);

      // Save for freshness
      const titles = result.articles.map(a => a.title);
      saveToHistory(query, titles).catch(() => {});

      return NextResponse.json({
        success: true,
        mode: 'search',
        query,
        ...result,
        scannedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({ success: false, error: 'Invalid mode. Use mode=keywords or mode=search&q=...' }, { status: 400 });

  } catch (error) {
    console.error('[Radar API Error]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
