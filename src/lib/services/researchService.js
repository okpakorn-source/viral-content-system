import { callAI } from '@/lib/ai/openai';
import { logPipeline } from '@/lib/pipelineLogger';
import { createLogger } from '@/lib/logger';

const rlog = createLogger('RESEARCH-SERVICE');

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_URL = 'https://google.serper.dev/search';

// ── Serper Search ──────────────────────────────────────────────
async function serperSearch(query, num = 5) {
  if (!SERPER_API_KEY) throw new Error('SERPER_API_KEY not configured');
  
  const headers = { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' };
  const body = JSON.stringify({ q: query, gl: 'th', hl: 'th', num });

  const [resOrg, resNews] = await Promise.all([
    fetch('https://google.serper.dev/search', { method: 'POST', headers, body }),
    fetch('https://google.serper.dev/news', { method: 'POST', headers, body })
  ]);

  if (!resOrg.ok && !resNews.ok) throw new Error('Serper HTTP Error');

  let organicResults = [];
  if (resOrg.ok) {
    const data = await resOrg.json();
    organicResults = (data.organic || []).slice(0, num).map(r => ({
      title: r.title || '', snippet: r.snippet || '', link: r.link || '', source: r.displayLink || r.link || ''
    }));
  }

  let newsResults = [];
  if (resNews.ok) {
    const data = await resNews.json();
    newsResults = (data.news || []).slice(0, num).map(r => ({
      title: r.title || '', snippet: r.snippet || '', link: r.link || '', source: r.source || r.link || ''
    }));
  }

  // Combine and deduplicate by link, prioritizing news
  const combined = [...newsResults, ...organicResults];
  const seen = new Set();
  return combined.filter(r => {
    if (seen.has(r.link)) return false;
    seen.add(r.link);
    return true;
  }).slice(0, num + 1);
}

// ── Rule-based Keyword Extractor (fallback) ────────────────────
function extractKeywordsRuleBased(title, body, breakdownData) {
  const stopWords = new Set([
    'ที่', 'ซึ่ง', 'และ', 'หรือ', 'จาก', 'แล้ว', 'เพราะ', 'โดย', 'ของ',
    'กับ', 'ใน', 'บน', 'ให้', 'ได้', 'มี', 'ไม่', 'เป็น', 'จะ', 'ยัง',
    'นี้', 'นั้น', 'อยู่', 'ไป', 'มา', 'ว่า', 'แต่', 'ถ้า', 'เมื่อ', 'ตาม',
    'เพื่อ', 'อีก', 'แล้ว', 'ก็', 'ด้วย', 'แม้', 'จน', 'กว่า', 'ออก',
    'the', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'to', 'for',
  ]);

  const candidates = [];

  // 1. Key people
  if (breakdownData?.key_facts?.people?.length) {
    breakdownData.key_facts.people.forEach(p => candidates.push({ keyword: p, type: 'person', src: 'breakdown.people' }));
  }
  // 2. Key places
  if (breakdownData?.key_facts?.places?.length) {
    breakdownData.key_facts.places.forEach(p => candidates.push({ keyword: p, type: 'place', src: 'breakdown.places' }));
  }
  // 3. Core story
  if (breakdownData?.core_story) {
    const words = breakdownData.core_story.split(/[\s,。.]+/).filter(w => w.length >= 3 && !stopWords.has(w));
    words.slice(0, 3).forEach(w => candidates.push({ keyword: w, type: 'event', src: 'breakdown.core_story' }));
  }
  // 4. Key points
  if (breakdownData?.key_points?.length) {
    breakdownData.key_points.slice(0, 2).forEach(kp => {
      const text = kp.point || (typeof kp === 'string' ? kp : '');
      const words = text.split(/[\s,。.]+/).filter(w => w.length >= 3 && !stopWords.has(w));
      words.slice(0, 2).forEach(w => candidates.push({ keyword: w, type: 'context', src: 'breakdown.key_points' }));
    });
  }
  // 5. Title words
  if (title) {
    const words = title.split(/[\s,。.]+/).filter(w => w.length >= 3 && !stopWords.has(w));
    words.slice(0, 4).forEach(w => candidates.push({ keyword: w, type: 'context', src: 'title' }));
  }
  // 6. Body words (first 500 chars)
  if (body) {
    const words = body.slice(0, 500).split(/[\s,。.]+/).filter(w => w.length >= 4 && !stopWords.has(w));
    words.slice(0, 3).forEach(w => candidates.push({ keyword: w, type: 'context', src: 'body' }));
  }

  // Deduplicate + limit to 5-8
  const seen = new Set();
  const unique = candidates.filter(c => {
    if (!c.keyword || c.keyword.length < 2 || seen.has(c.keyword)) return false;
    seen.add(c.keyword);
    return true;
  }).slice(0, 8);

  return unique.map(c => ({
    keyword: c.keyword,
    type: c.type || 'context',
    searchQuery: c.keyword + (title ? ' ' + title.slice(0, 30) : ''),
    intent: 'ข้อมูลเพิ่มเติมเกี่ยวกับ ' + c.keyword,
    _source: c.src,
  }));
}

// ── Build keyword input from cascade ──────────────────────────
function resolveKeywordInput(newsTitle, newsBody, breakdownData) {
  if (breakdownData?.core_story && breakdownData.core_story.length > 10) {
    return { text: breakdownData.core_story, source: 'breakdown.core_story' };
  }
  if (breakdownData?.key_points?.length) {
    const kpText = breakdownData.key_points.map(kp => kp.point || kp).join(', ');
    return { text: kpText, source: 'breakdown.key_points' };
  }
  if (newsTitle && newsTitle.length > 5) {
    return { text: newsTitle, source: 'newsTitle' };
  }
  if (newsBody && newsBody.length > 20) {
    return { text: newsBody.slice(0, 500), source: 'newsBody[:500]' };
  }
  return null;
}

export async function performResearch({ newsBody, newsTitle, breakdownData, focusAngle, workflowId: wfId }) {
  const startTime = Date.now();
  const workflowId = wfId || ('research_' + Date.now());

  try {
    rlog.start('newsTitle: "' + (newsTitle || '').slice(0, 50) + '" | body: ' + (newsBody?.length || 0) + 'ch');
    console.log('[Research-Service] ═══════════════════════════════════════');
    console.log('[Research-Service] INPUT AUDIT:');
    console.log('  newsTitle: ' + (newsTitle ? '"' + newsTitle.slice(0, 60) + '" (' + newsTitle.length + 'ch)' : '❌ EMPTY'));
    console.log('  newsBody: ' + (newsBody ? newsBody.length + 'ch' : '❌ EMPTY'));
    console.log('  breakdownData.core_story: ' + (breakdownData?.core_story ? '"' + breakdownData.core_story.slice(0, 40) + '"' : '❌ empty'));
    console.log('  breakdownData.key_points: ' + (breakdownData?.key_points?.length || 0) + ' items');
    console.log('[Research-Service] ═══════════════════════════════════════');

    // Validate minimum input
    if (!newsBody || newsBody.length < 10) {
      console.error('[Research-Service] KEYWORD_INPUT_EMPTY: newsBody missing');
      throw {
        message: 'KEYWORD_INPUT_EMPTY: ไม่มีเนื้อข่าวสำหรับสร้าง keyword',
        errorType: 'KEYWORD_INPUT_EMPTY'
      };
    }

    // STEP 1: Keyword Extraction
    rlog.step('keyword-extraction', 'สกัด keywords...');
    const keyPointsSummary = breakdownData?.key_points?.map(kp => kp.point || kp).join(', ') || '';
    const coreStory = breakdownData?.core_story || '';
    const keyPeople = breakdownData?.key_facts?.people?.join(', ') || '';
    const keyPlaces = breakdownData?.key_facts?.places?.join(', ') || '';
    const quotes = breakdownData?.quotes?.join(' | ') || '';

    let keywords = [];
    let keywordSource = 'unknown';
    let keywordFallbackUsed = false;
    let keywordError = null;

    // AI Extraction
    try {
      const keywordPrompt = `คุณคือ AI ผู้เชี่ยวชาญวิเคราะห์ข่าวและสกัด keyword เพื่อค้นหาข้อมูลเพิ่มเติม

=== ข่าวที่ต้องวิเคราะห์ ===
หัวข้อ: ${newsTitle || '(ไม่มีหัวข้อ)'}
เนื้อหา: ${newsBody.slice(0, 2000)}
${coreStory ? 'แก่นข่าว: ' + coreStory : ''}
${keyPointsSummary ? 'ประเด็นสำคัญ: ' + keyPointsSummary : ''}
${keyPeople ? 'บุคคล: ' + keyPeople : ''}
${keyPlaces ? 'สถานที่: ' + keyPlaces : ''}
${quotes ? 'คำพูดสำคัญ: ' + quotes : ''}
=== จบข่าว ===
${focusAngle ? '\n=== มุมมองที่ต้องการเน้น (Focus Angle) ===\n' + focusAngle + '\n' : ''}
งาน: สกัด 5-8 keywords ที่สำคัญที่สุดในข่าวนี้ เพื่อนำไปค้นหาข้อมูลเพิ่มเติม

กฎ:
- เลือก keyword ที่ถ้าหาข้อมูลเพิ่มจะทำให้เนื้อหาข่าวน่าสนใจขึ้น
- ครอบคลุม: คนสำคัญ, สถานที่, เหตุการณ์, ตัวเลข/สถิติ, บริบท
- **สำคัญมาก**: ถ้าข่าวเกี่ยวข้องกับความสูญเสีย อาชญากรรม หรืออุบัติเหตุ คุณ **ต้อง** สร้าง Keyword พิเศษ 1 ตัวที่เน้นหาคำว่า "อัปเดตล่าสุด เงินเยียวยา / ความคืบหน้า" เสมอ
- searchQuery ต้องเฉพาะเจาะจง ไม่ใช่แค่ copy keyword
- ต้องมีอย่างน้อย 3 keywords

ตอบเป็น JSON เท่านั้น ห้ามอธิบายเพิ่ม:
{"keywords":[{"keyword":"คำสำคัญ","type":"person|place|event|statistic|context","searchQuery":"ประโยคค้นหาภาษาไทย","intent":"ต้องการข้อมูลอะไร"}]}`;

      console.log('[Research-Service] → Calling AI keyword extractor (gpt-4o-mini)...');
      const aiStart = Date.now();
      const keywordResult = await callAI({
        model: 'gpt-4o-mini',
        prompt: keywordPrompt,
        temperature: 0.2,
        maxTokens: 1500,
      });
      const aiDuration = Date.now() - aiStart;

      if (!keywordResult) {
        keywordError = 'KEYWORD_AI_FAILED: AI returned null/undefined';
        console.warn('[Research-Service] ⚠️ ' + keywordError + ' (' + aiDuration + 'ms)');
      } else if (!keywordResult.keywords) {
        keywordError = 'KEYWORD_PARSE_FAILED: response missing .keywords field';
        console.warn('[Research-Service] ⚠️ ' + keywordError);
      } else if (!Array.isArray(keywordResult.keywords) || keywordResult.keywords.length === 0) {
        keywordError = 'KEYWORD_AI_FAILED: .keywords is empty array';
        console.warn('[Research-Service] ⚠️ ' + keywordError);
      } else {
        keywords = keywordResult.keywords;
        keywordSource = 'ai_extraction';
        console.log('[Research-Service] ✅ AI keywords (' + aiDuration + 'ms): ' + keywords.map(k => k.keyword).join(', '));
      }
    } catch (aiErr) {
      keywordError = 'KEYWORD_AI_FAILED: ' + aiErr.message;
      console.warn('[Research-Service] ⚠️ AI keyword extraction failed:', aiErr.message);
    }

    // Rule-based Fallback
    if (keywords.length === 0) {
      console.log('[Research-Service] → KEYWORD_FALLBACK_USED: switching to rule-based extractor');
      keywordFallbackUsed = true;

      const fallbackKws = extractKeywordsRuleBased(newsTitle, newsBody, breakdownData);

      if (fallbackKws.length > 0) {
        keywords = fallbackKws;
        keywordSource = 'rule_based_fallback';
        console.log('[Research-Service] ✅ Fallback keywords (' + keywords.length + '): ' + keywords.map(k => k.keyword + ' [' + k._source + ']').join(', '));
      } else {
        console.warn('[Research-Service] ⚠️ Rule-based also returned 0 — using emergency keyword');
        const kwInput = resolveKeywordInput(newsTitle, newsBody, breakdownData);

        if (!kwInput) {
          console.error('[Research-Service] KEYWORD_FINAL_EMPTY: no input source found');
          throw {
            message: 'KEYWORD_FINAL_EMPTY: ไม่มีข้อมูลต้นทางสำหรับสร้าง keyword (title/body/breakdown ว่างทั้งหมด)',
            errorType: 'KEYWORD_FINAL_EMPTY',
            debug: { keywordError, hadTitle: !!newsTitle, hadBody: !!newsBody, hadBreakdown: !!breakdownData }
          };
        }

        const emergencyKw = kwInput.text.slice(0, 80).replace(/\n/g, ' ').trim();
        keywords = [{
          keyword: emergencyKw,
          type: 'context',
          searchQuery: emergencyKw,
          intent: 'ค้นหาข้อมูลจาก: ' + kwInput.source,
          _source: 'emergency:' + kwInput.source,
        }];
        keywordSource = 'emergency_cascade';
        keywordFallbackUsed = true;
        console.log('[Research-Service] ✅ Emergency keyword: "' + emergencyKw + '" (from ' + kwInput.source + ')');
      }
    }

    rlog.step('keyword-result', keywords.length + ' keywords from [' + keywordSource + ']' + (keywordFallbackUsed ? ' ⚠️ FALLBACK' : ''));
    console.log('[Research-Service] ─── KEYWORD AUDIT ───');
    keywords.forEach((k, i) => console.log('  [' + i + '] ' + k.keyword + ' | query: "' + k.searchQuery + '"'));
    console.log('[Research-Service] ─────────────────────');

    await logPipeline({
      workflowId,
      step: 'research-keywords',
      status: keywordFallbackUsed ? 'fallback' : 'success',
      detail: keywords.map(k => k.keyword).join(', ') + ' [src:' + keywordSource + ']',
    }).catch(() => {});

    // STEP 2: Parallel Serper Search
    rlog.step('serper-search', 'ค้นหา Google Serper ' + keywords.length + ' keywords พร้อมกัน');
    if (!SERPER_API_KEY) {
      console.warn('[Research-Service] ⚠️ SERPER_API_KEY missing — search disabled');
    }

    const searchPromises = keywords.map(async (kw) => {
      try {
        const results = await serperSearch(kw.searchQuery, 3);
        console.log('[Research-Service] 🔍 "' + kw.keyword + '" → ' + results.length + ' results');
        return { keyword: kw, results };
      } catch (err) {
        console.warn('[Research-Service] ⚠️ Search failed for "' + kw.keyword + '": ' + err.message);
        return { keyword: kw, results: [] };
      }
    });

    const searchResults = await Promise.all(searchPromises);
    const successfulSearches = searchResults.filter(s => s.results.length > 0);
    rlog.research('Search done: ' + successfulSearches.length + '/' + keywords.length + ' keywords got results');

    if (successfulSearches.length === 0) {
      console.warn('[Research-Service] ⚠️ No search results at all — returning empty items');
      const duration = Date.now() - startTime;
      await logPipeline({ workflowId, step: 'research-search', status: 'success', duration, detail: '0 results (no SERPER or no match)' }).catch(() => {});
      return {
        items: [],
        notFound: keywords.map(k => k.keyword),
        keywords: keywords.map(k => k.keyword),
        totalKeywords: keywords.length,
        foundCount: 0,
        duration: parseFloat((duration / 1000).toFixed(1)),
        keywordSource,
        fallbackUsed: keywordFallbackUsed,
        warning: 'RESEARCH_SEARCH_FAILED: ไม่พบผลค้นหา (Serper key หรือ network อาจมีปัญหา)',
      };
    }

    // STEP 3: Fact Extraction
    rlog.step('fact-extraction', 'AI สรุปข้อเท็จจริงจากผลค้นหา...');
    const searchCatalog = searchResults.map((sr, i) =>
      '[KEYWORD ' + (i + 1) + '] ' + sr.keyword.keyword + ' (' + sr.keyword.type + ')\n' +
      'Intent: ' + sr.keyword.intent + '\n' +
      (sr.results.length > 0
        ? sr.results.map(r => '  SOURCE: ' + r.source + '\n  URL: ' + r.link + '\n  TITLE: ' + r.title + '\n  TEXT: ' + r.snippet).join('\n---\n')
        : '  ไม่พบผลการค้นหา')
    ).join('\n\n');

    const factPrompt = `คุณคือ AI ผู้เชี่ยวชาญสรุปข้อเท็จจริงจากผลการค้นหาเว็บ

=== ข่าวต้นฉบับ ===
${newsTitle || ''}
=== จบข่าวต้นฉบับ ===

=== ผลการค้นหาจาก Google ===
${searchCatalog}
=== จบผลการค้นหา ===

งาน: สรุปข้อเท็จจริงที่น่าสนใจจากผลค้นหาด้านบน

กฎ:
- ห้ามเพิ่มข้อมูลที่ไม่มีในผลค้นหา
- ถ้า keyword ไหนหาไม่เจอ → ระบุ notFound
- ต้องระบุ sourceUrl จริง
- เลือกเฉพาะข้อมูลที่เกี่ยวข้องกับข่าวต้นฉบับ

ตอบเป็น JSON:
{"items":[{"keyword":"keyword ที่ค้นหา","type":"person|place|event|statistic|context","title":"หัวข้อ ≤60 ตัวอักษร","content":"ข้อเท็จจริง 2-3 ประโยค","sourceUrl":"URL จริง","sourceName":"ชื่อเว็บ","relevance":"เกี่ยวข้องอย่างไร"}],"notFound":["keywords ที่หาไม่เจอ"]}`;

    const factResult = await callAI({
      model: 'gpt-4o',
      prompt: factPrompt,
      temperature: 0.1,
      maxTokens: 4000,
    });

    const finalItems = factResult?.items || [];
    if (!factResult?.items?.length) {
      console.warn('[Research-Service] ⚠️ Fact extraction returned no items — returning empty');
    }

    const duration = Date.now() - startTime;
    console.log('[Research-Service] ✅ Done: ' + finalItems.length + ' items | ' + (duration / 1000).toFixed(1) + 's | src=' + keywordSource);
    await logPipeline({
      workflowId,
      step: 'research-search',
      status: 'success',
      duration,
      detail: keywords.length + ' keywords → ' + finalItems.length + ' items | fallback=' + keywordFallbackUsed,
    }).catch(() => {});

    return {
      items: finalItems,
      notFound: factResult?.notFound || [],
      keywords: keywords.map(k => k.keyword),
      totalKeywords: keywords.length,
      foundCount: finalItems.length,
      duration: parseFloat((duration / 1000).toFixed(1)),
      keywordSource,
      fallbackUsed: keywordFallbackUsed,
      keywordError: keywordError || null,
    };

  } catch (error) {
    const errorType = error.errorType || 'RESEARCH_SEARCH_FAILED';
    console.error('[Research-Service] ' + errorType + ':', error.message);
    await logPipeline({
      workflowId,
      step: 'research-search',
      status: 'failed',
      error: error.message,
    }).catch(() => {});
    throw error;
  }
}
