import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai/openai';
import { logPipeline } from '@/lib/pipelineLogger';
import { createLogger } from '@/lib/logger';

const rlog = createLogger('RESEARCH');

/**
 * Research Search Agent
 * 
 * Flow:
 * 1. รับ newsBody + breakdownData
 * 2. Keyword Extraction Agent → สกัด 5-10 keywords พร้อม searchQuery
 * 3. Parallel Serper Search → ค้นหาจริงทุก keyword พร้อมกัน
 * 4. Fact Extraction Agent → สรุปจากผลค้นหาเท่านั้น ห้ามแต่งเพิ่ม
 * 5. Return items พร้อม URL จริง
 */

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_URL = 'https://google.serper.dev/search';

// === Serper Search ทีละ keyword ===
async function serperSearch(query, num = 3) {
  if (!SERPER_API_KEY) throw new Error('SERPER_API_KEY not configured');

  const res = await fetch(SERPER_URL, {
    method: 'POST',
    headers: {
      'X-API-KEY': SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: query,
      gl: 'th',
      hl: 'th',
      num,
    }),
  });

  if (!res.ok) throw new Error(`Serper error: ${res.status}`);
  const data = await res.json();

  // ดึงผลลัพธ์ organic search
  const results = (data.organic || []).slice(0, num).map(r => ({
    title: r.title || '',
    snippet: r.snippet || '',
    link: r.link || '',
    source: r.displayLink || r.link || '',
  }));

  return results;
}

export async function POST(request) {
  const startTime = Date.now();
  let workflowId = null;

  try {
    const body = await request.json();
    const { newsBody, newsTitle, breakdownData, workflowId: wfId } = body;
    workflowId = wfId || ('research_' + Date.now());
    rlog.start(`newsTitle: "${(newsTitle||'').slice(0,50)}" | body: ${newsBody?.length||0}ch`);

    if (!newsBody || newsBody.length < 20) {
      return NextResponse.json({ success: false, error: 'ไม่มีเนื้อข่าว' }, { status: 400 });
    }

    // === STEP 1: Keyword Extraction ===
    rlog.step('keyword-extraction', 'AI สกัด keywords สำหรับค้นหา...');
    rlog.model('gpt-4o-mini', 'สกัด 5-10 keywords + searchQuery แต่ละตัว');
    console.log('[Research] === STEP 1: Keyword Extraction ===');
    const keyPointsSummary = breakdownData?.key_points?.map(kp => kp.point || kp).join(', ') || '';
    const coreStory = breakdownData?.core_story || '';
    const keyPeople = breakdownData?.key_facts?.people?.join(', ') || '';
    const keyPlaces = breakdownData?.key_facts?.places?.join(', ') || '';
    const quotes = breakdownData?.quotes?.join(' | ') || '';

    const keywordPrompt = `คุณคือ AI ผู้เชี่ยวชาญวิเคราะห์ข่าวและสกัด keyword เพื่อค้นหาข้อมูลเพิ่มเติม

=== ข่าวที่ต้องวิเคราะห์ ===
หัวข้อ: ${newsTitle || ''}
เนื้อหา: ${newsBody.slice(0, 2000)}
${coreStory ? `แก่นข่าว: ${coreStory}` : ''}
${keyPointsSummary ? `ประเด็นสำคัญ: ${keyPointsSummary}` : ''}
${keyPeople ? `บุคคล: ${keyPeople}` : ''}
${keyPlaces ? `สถานที่: ${keyPlaces}` : ''}
${quotes ? `คำพูดสำคัญ: ${quotes}` : ''}
=== จบข่าว ===

งาน: สกัด 5-10 keywords ที่สำคัญที่สุดในข่าวนี้ เพื่อนำไปค้นหาข้อมูลเพิ่มเติม

กฎ:
- เลือก keyword ที่ถ้าหาข้อมูลเพิ่มจะทำให้เนื้อหาข่าวน่าสนใจขึ้น
- ครอบคลุมทุกมิติ: คนสำคัญ, สถานที่, เหตุการณ์, ตัวเลข/สถิติ, กฎหมาย/นโยบาย, บริบท
- แต่ละ keyword ต้องมี searchQuery ภาษาไทย ที่ค้นหาแล้วจะได้ข้อมูลที่เป็นประโยชน์
- searchQuery ต้องเฉพาะเจาะจง ไม่ใช่แค่ copy keyword

ตอบเป็น JSON:
{
  "keywords": [
    {
      "keyword": "คำสำคัญ",
      "type": "person|place|event|statistic|law|context",
      "searchQuery": "ประโยคค้นหาภาษาไทยที่เฉพาะเจาะจง",
      "intent": "ต้องการข้อมูลอะไรจากการค้นหานี้"
    }
  ]
}`;

    const keywordResult = await callAI({
      model: 'gpt-4o-mini',
      prompt: keywordPrompt,
      temperature: 0.2,
      maxTokens: 1500,
    });

    const keywords = keywordResult?.keywords || [];
    if (!keywords.length) {
      throw new Error('ไม่สามารถสกัด keyword ได้');
    }
    rlog.step('keyword-result', `${keywords.length} keywords: ${keywords.map(k=>k.keyword).join(', ')}`);
    console.log(`[Research] ✅ Keywords extracted: ${keywords.length} → ${keywords.map(k => k.keyword).join(', ')}`);
    await logPipeline({ workflowId, step: 'research-keywords', status: 'success', detail: keywords.map(k => k.keyword).join(', ') }).catch(() => {});

    // === STEP 2: Parallel Search ทุก keyword พร้อมกัน ===
    rlog.step('serper-search', `ค้นหา Google (Serper API) ทั้ง ${keywords.length} keywords พร้อมกัน`);
    if (!SERPER_API_KEY) rlog.warn('SERPER_API_KEY not set! การค้นหาจะล้มเหลว');
    console.log('[Research] === STEP 2: Parallel Serper Search ===');
    const searchPromises = keywords.map(async (kw) => {
      try {
        const results = await serperSearch(kw.searchQuery, 3);
        console.log(`[Research] 🔍 "${kw.keyword}" → ${results.length} results`);
        return { keyword: kw, results };
      } catch (err) {
        console.warn(`[Research] ⚠️ Search failed for "${kw.keyword}": ${err.message}`);
        return { keyword: kw, results: [] };
      }
    });

    const searchResults = await Promise.all(searchPromises);
    const successfulSearches = searchResults.filter(s => s.results.length > 0);
    rlog.research(`Search done: ${successfulSearches.length}/${keywords.length} keywords got results`);
    console.log(`[Research] ✅ Search done: ${successfulSearches.length}/${keywords.length} keywords found results`);

    // === STEP 3: Fact Extraction ===
    rlog.step('fact-extraction', 'AI สรุปข้อเท็จจริงจากผลค้นหา...');
    rlog.model('gpt-4o-mini', 'สรุป fact จาก search results — ห้ามแต่งเพิ่ม');
    console.log('[Research] === STEP 3: Fact Extraction ===');

    // สร้าง catalog ของผลค้นหาทั้งหมด
    const searchCatalog = searchResults.map((sr, i) =>
      `[KEYWORD ${i + 1}] ${sr.keyword.keyword} (${sr.keyword.type})\n` +
      `Intent: ${sr.keyword.intent}\n` +
      (sr.results.length > 0
        ? sr.results.map(r => `  SOURCE: ${r.source}\n  URL: ${r.link}\n  TITLE: ${r.title}\n  TEXT: ${r.snippet}`).join('\n---\n')
        : '  ไม่พบผลการค้นหา')
    ).join('\n\n');

    const factPrompt = `คุณคือ AI ผู้เชี่ยวชาญสรุปข้อเท็จจริงจากผลการค้นหาเว็บ

=== ข่าวต้นฉบับ ===
${newsTitle || ''}
=== จบข่าวต้นฉบับ ===

=== ผลการค้นหาจาก Google (ข้อมูลจริง) ===
${searchCatalog}
=== จบผลการค้นหา ===

งาน: สรุปข้อเท็จจริงที่น่าสนใจจากผลค้นหาด้านบน

กฎเข้มงวด:
- ห้ามเพิ่มข้อมูลที่ไม่มีในผลค้นหา
- ถ้า keyword ไหนหาไม่เจอ → ระบุ notFound
- ต้องระบุ sourceUrl ของทุก item
- content ต้องมาจากผลค้นหาเท่านั้น ห้ามแต่งเพิ่ม
- เลือกเฉพาะข้อมูลที่เกี่ยวข้องกับข่าวต้นฉบับจริงๆ

ตอบเป็น JSON:
{
  "items": [
    {
      "keyword": "keyword ที่ค้นหา",
      "type": "person|place|event|statistic|law|context",
      "title": "หัวข้อสั้นๆ ไม่เกิน 60 ตัวอักษร",
      "content": "ข้อเท็จจริงที่พบ 2-3 ประโยค (มาจากผลค้นหาเท่านั้น)",
      "sourceUrl": "URL จริงจากผลค้นหา",
      "sourceName": "ชื่อเว็บไซต์",
      "relevance": "เกี่ยวข้องกับข่าวอย่างไร"
    }
  ],
  "notFound": ["keyword ที่ค้นไม่เจอหรือไม่มีข้อมูลเกี่ยวข้อง"]
}`;

    const factResult = await callAI({
      model: 'gpt-4o',
      prompt: factPrompt,
      temperature: 0.1,
      maxTokens: 4000,
    });

    if (!factResult?.items?.length) {
      throw new Error('ไม่พบข้อมูลที่เกี่ยวข้อง');
    }

    const duration = Date.now() - startTime;
    console.log(`[Research] ✅ Done: ${factResult.items.length} items found in ${(duration/1000).toFixed(1)}s`);
    await logPipeline({
      workflowId,
      step: 'research-search',
      status: 'success',
      duration,
      detail: `${keywords.length} keywords → ${factResult.items.length} items`,
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      data: {
        items: factResult.items,
        notFound: factResult.notFound || [],
        keywords: keywords.map(k => k.keyword),
        totalKeywords: keywords.length,
        foundCount: factResult.items.length,
        duration: parseFloat((duration / 1000).toFixed(1)),
      },
    });

  } catch (error) {
    console.error('[Research] ERROR:', error.message);
    await logPipeline({ workflowId, step: 'research-search', status: 'failed', error: error.message }).catch(() => {});
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
