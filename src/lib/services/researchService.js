import { callAI } from '@/lib/ai/openai';
import { logPipeline } from '@/lib/pipelineLogger';
import { createLogger } from '@/lib/logger';
import { MODEL_PRIMARY, MODEL_FAST } from '@/lib/ai/modelConfig';
import { tavilySearch, isTavilyAvailable } from '@/lib/services/tavilyService';
import { verifyResearchItems } from '@/lib/services/researchVerifier';

const rlog = createLogger('RESEARCH-SERVICE');

const SERPER_API_KEY = process.env.SERPER_API_KEY;

// Simple Serper rate limiter — max 10 concurrent, 100ms delay between calls
let _serperQueue = Promise.resolve();
const _serperDelay = () => new Promise(r => setTimeout(r, 100));
function throttledSerperSearch(query, num, type) {
  _serperQueue = _serperQueue.then(() => _serperDelay()).catch(() => {});
  return _serperQueue.then(() => _rawSerperSearch(query, num, type));
}

// Research cache — 10 min TTL, max 50 entries
const _researchCache = new Map();
const CACHE_TTL = 10 * 60 * 1000;
function getCachedResult(key) {
  const entry = _researchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { _researchCache.delete(key); return null; }
  return entry.data;
}
function setCachedResult(key, data) {
  if (_researchCache.size > 50) {
    const oldest = _researchCache.keys().next().value;
    _researchCache.delete(oldest);
  }
  _researchCache.set(key, { data, ts: Date.now() });
}

// ── Serper Search (cached + throttled) ─────────────────────────
async function serperSearch(query, num = 5) {
  const cacheKey = `serper:${query}:${num}`;
  const cached = getCachedResult(cacheKey);
  if (cached) {
    rlog.step('serper-cache-hit', `Cache hit for "${query}"`);
    return cached;
  }
  const results = await throttledSerperSearch(query, num);
  setCachedResult(cacheKey, results);
  return results;
}

// ── Raw Serper Search ──────────────────────────────────────────
async function _rawSerperSearch(query, num = 5) {
  if (!SERPER_API_KEY) throw new Error('SERPER_API_KEY not configured');
  
  const headers = { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' };
  const body = JSON.stringify({ q: query, gl: 'th', hl: 'th', num });

  const serperSignal = AbortSignal.timeout(8000); // ★ 8s guard — ป้องกัน Serper ค้างใน generate-per-angle step
  const [resOrg, resNews] = await Promise.all([
    fetch('https://google.serper.dev/search', { method: 'POST', headers, body, signal: serperSignal }),
    fetch('https://google.serper.dev/news', { method: 'POST', headers, body, signal: serperSignal })
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

// ═══════════════════════════════════════════════════════════
// ★ Context-Resolve (11 มิ.ย.): ค้นรอบ "ระบุตัวตน" ก่อนค้นจริง
// ═══════════════════════════════════════════════════════════
// ปัญหา: ข่าวชื่อเล่นล้วน (เช่น 'กาฟิว' ไร้นามสกุล) → คำค้นกว้าง + ตัวกรองกันผิดคน
// fail-closed ทิ้งผลทั้งหมด → Research Grade: Missing
// แก้แบบคนจริง: google ชื่อเล่น+บริบทเหตุการณ์ก่อน 1 รอบ → AI อ่านผลสรุปว่า "คือใคร"
// แล้วใช้ชื่อจริงสร้างคำค้น + เป็นจุดยึดให้ตัวกรอง — ถ้าไม่มั่นใจ = คืน null (ไม่เดามั่ว)
async function resolveIdentityFromContext({ newsTitle, newsBody, breakdownData }) {
  const people = breakdownData?.key_facts?.people || [];
  const mainPerson = String(people[0] || '').replace(/\(.*?\)/g, '').trim()
    || (newsTitle?.match(/['"‘“]([^'"’”]{2,20})['"’”]/)?.[1] || '');
  if (!mainPerson) return null;

  // เงื่อนไขกระตุ้น: ชื่อดูเป็น "ชื่อเล่นล้วน" (คำเดียว ไม่มีนามสกุล) เท่านั้น — ชื่อเต็มอยู่แล้วไม่ต้องเสียเวลา
  const tokenCount = mainPerson.split(/\s+/).filter(Boolean).length;
  if (tokenCount >= 2) return null;

  try {
    const contextHint = [
      breakdownData?.core_story || '',
      (breakdownData?.key_points || []).map(kp => kp.point || kp).join(' '),
    ].join(' ').replace(new RegExp(mainPerson, 'g'), '').slice(0, 120).trim();

    const probeQuery = `${mainPerson} ${contextHint.split(/\s+/).slice(0, 8).join(' ')}`.trim();
    console.log(`[Research-Resolve] 🔎 nickname-only "${mainPerson}" → probe: "${probeQuery.slice(0, 80)}"`);

    const results = await serperSearch(probeQuery, 8);
    if (!results || results.length === 0) {
      console.log('[Research-Resolve] ⚠️ probe got 0 results — keep original behavior');
      return null;
    }

    const snippetBlock = results.slice(0, 8)
      .map((r, i) => `${i + 1}. ${r.title || ''} — ${r.snippet || ''}`)
      .join('\n');

    const prompt = `คุณคือผู้ตรวจสอบตัวตนบุคคลในข่าว (เข้มงวดสูงสุด ห้ามเดา)

=== เรื่องที่กำลังทำข่าว ===
หัวข้อ: ${newsTitle || '-'}
แก่นเรื่อง: ${(breakdownData?.core_story || newsBody || '').slice(0, 400)}
บุคคลที่รู้จักแค่ชื่อเล่น: "${mainPerson}"

=== ผลค้นหา Google ===
${snippetBlock}

งาน: ระบุว่า "${mainPerson}" ในเรื่องนี้คือใคร (ชื่อจริง-นามสกุล/ฉายาเต็ม)
กติกาเหล็ก:
- resolved=true ได้เฉพาะเมื่อ (1) มีผลค้นหา ≥2 ชิ้นชี้ไปที่คนเดียวกัน และ (2) เนื้อหาผลค้นหาสอดคล้องเหตุการณ์ในเรื่อง (เหตุการณ์/ความสัมพันธ์/อาชีพ/สถานที่ตรงกันอย่างน้อย 1 อย่าง)
- ถ้าผลค้นหาชี้คนละคน/คลุมเครือ/เป็นคนละเหตุการณ์ → resolved=false
- extraAnchors = คำยึดที่ยืนยันได้จากผลค้นหา (อาชีพ จังหวัด รายการ/วงการ โรค ฯลฯ) 2-5 คำ

ตอบ JSON เท่านั้น:
{"resolved": true/false, "fullName": "ชื่อเต็มที่ยืนยันได้", "aliases": ["ชื่อเล่น","ฉายาอื่น"], "extraAnchors": ["..."], "evidence": "สรุปหลักฐานสั้นๆ"}`;

    const res = await callAI({ prompt, model: MODEL_FAST, temperature: 0, maxTokens: 500 });
    const parsed = typeof res === 'object' ? res : JSON.parse(String(res?.content || res || '{}').match(/\{[\s\S]*\}/)?.[0] || '{}');

    if (parsed?.resolved && parsed?.fullName && String(parsed.fullName).trim().length >= 4) {
      const identity = {
        fullName: String(parsed.fullName).trim(),
        aliases: [mainPerson, ...(parsed.aliases || [])].filter(Boolean),
        extraAnchors: parsed.extraAnchors || [],
      };
      console.log(`[Research-Resolve] 🎯 "${mainPerson}" → "${identity.fullName}" | anchors: [${identity.extraAnchors.slice(0, 4).join(', ')}] | ${String(parsed.evidence || '').slice(0, 80)}`);
      return identity;
    }
    console.log(`[Research-Resolve] 🛡️ ยืนยันไม่ได้ (${String(parsed?.evidence || 'no evidence').slice(0, 60)}) — keep fail-closed behavior`);
    return null;
  } catch (e) {
    console.log('[Research-Resolve] ⚠️ error (non-fatal):', e.message?.slice(0, 60));
    return null;
  }
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
      const err = new Error('KEYWORD_INPUT_EMPTY: ไม่มีเนื้อข่าวสำหรับสร้าง keyword');
      err.errorType = 'KEYWORD_INPUT_EMPTY';
      throw err;
    }

    // STEP 1: Keyword Extraction
    rlog.step('keyword-extraction', 'สกัด keywords...');
    const keyPointsSummary = breakdownData?.key_points?.map(kp => kp.point || kp).join(', ') || '';
    const coreStory = breakdownData?.core_story || '';
    const keyPeople = breakdownData?.key_facts?.people?.join(', ') || '';
    const keyPlaces = breakdownData?.key_facts?.places?.join(', ') || '';
    const quotes = breakdownData?.quotes?.join(' | ') || '';

    // ★ STEP 0.5: Context-Resolve — ข่าวชื่อเล่นล้วนให้ค้นระบุตัวตนก่อน (เพิ่มความแม่นยำตัวละคร)
    const resolvedIdentity = await resolveIdentityFromContext({ newsTitle, newsBody, breakdownData });

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
${resolvedIdentity ? '★ ตัวตนยืนยันแล้วจากการค้นหา: "' + resolvedIdentity.fullName + '" (ชื่อเล่น: ' + resolvedIdentity.aliases.join('/') + ') — ใช้ชื่อเต็มนี้ใน searchQuery ทุกอันที่เกี่ยวกับบุคคล!' : ''}
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

      console.log(`[Research-Service] → Calling AI keyword extractor (${MODEL_FAST})...`);
      const aiStart = Date.now();
      const keywordResult = await callAI({
        model: MODEL_FAST,
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
          const err = new Error('KEYWORD_FINAL_EMPTY: ไม่มีข้อมูลต้นทางสำหรับสร้าง keyword (title/body/breakdown ว่างทั้งหมด)');
          err.errorType = 'KEYWORD_FINAL_EMPTY';
          err.debug = { keywordError, hadTitle: !!newsTitle, hadBody: !!newsBody, hadBreakdown: !!breakdownData };
          throw err;
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

    // ★ Context-Resolve: การันตีคำค้นชื่อเต็มอย่างน้อย 1 อัน (กัน AI เมินคำแนะนำ)
    if (resolvedIdentity?.fullName && !keywords.some(k => ((k.searchQuery || '') + (k.keyword || '')).includes(resolvedIdentity.fullName))) {
      keywords.unshift({
        keyword: resolvedIdentity.fullName,
        type: 'person',
        searchQuery: `${resolvedIdentity.fullName} ${(coreStory || newsTitle || '').replace(resolvedIdentity.fullName, '').slice(0, 50)}`.trim(),
        intent: 'ยืนยันตัวตนและความคืบหน้าของบุคคลหลัก (จาก Context-Resolve)',
      });
      console.log(`[Research-Resolve] ➕ injected full-name query: "${keywords[0].searchQuery.slice(0, 70)}"`);
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

    // STEP 2: Parallel Serper Search + Tavily Supplement
    rlog.step('serper-search', 'ค้นหา Google Serper ' + keywords.length + ' keywords พร้อมกัน');
    const useSerper = !!SERPER_API_KEY;
    if (!useSerper) {
      console.warn('[Research-Service] ⚠️ SERPER_API_KEY missing — will try Tavily as primary');
    }

    const searchPromises = keywords.map(async (kw) => {
      try {
        if (!useSerper) return { keyword: kw, results: [] };
        const results = await serperSearch(kw.searchQuery, 3);
        console.log('[Research-Service] 🔍 "' + kw.keyword + '" → ' + results.length + ' results');
        return { keyword: kw, results };
      } catch (err) {
        console.warn('[Research-Service] ⚠️ Search failed for "' + kw.keyword + '": ' + err.message);
        return { keyword: kw, results: [] };
      }
    });

    let searchResults = await Promise.all(searchPromises);
    let successfulSearches = searchResults.filter(s => s.results.length > 0);
    rlog.research('Serper done: ' + successfulSearches.length + '/' + keywords.length + ' keywords got results');

    // === Tavily Supplement ===
    // Use Tavily as primary if no Serper, or supplement if Serper returned < 3 results
    const shouldUseTavily = isTavilyAvailable() && (!useSerper || successfulSearches.length < 3);
    if (shouldUseTavily) {
      const tavilyLabel = !useSerper ? 'primary (no Serper)' : 'supplement (Serper < 3)';
      console.log('[Research-Service] 🔍 Tavily ' + tavilyLabel + ' — searching ' + keywords.length + ' keywords');

      const tavilyPromises = keywords.map(async (kw) => {
        try {
          const { results } = await tavilySearch(kw.searchQuery, {
            topic: 'news',
            maxResults: 3,
            searchDepth: 'basic',
            includeAnswer: false,
          });
          const mapped = results.map(r => ({
            title: r.title || '',
            snippet: r.content || '',
            link: r.url || '',
            source: 'tavily',
          }));
          return { keyword: kw, results: mapped };
        } catch (err) {
          console.warn('[Research-Service] ⚠️ Tavily failed for "' + kw.keyword + '": ' + err.message);
          return { keyword: kw, results: [] };
        }
      });

      const tavilyResults = await Promise.all(tavilyPromises);

      // Merge Tavily results into searchResults (deduplicate by link)
      for (const tr of tavilyResults) {
        const existing = searchResults.find(s => s.keyword.keyword === tr.keyword.keyword);
        if (existing) {
          const existingLinks = new Set(existing.results.map(r => r.link));
          const newResults = tr.results.filter(r => !existingLinks.has(r.link));
          existing.results = [...existing.results, ...newResults];
        } else {
          searchResults.push(tr);
        }
      }

      successfulSearches = searchResults.filter(s => s.results.length > 0);
      const tavilyCount = tavilyResults.reduce((sum, t) => sum + t.results.length, 0);
      console.log('[Research-Service] ✅ Tavily added ' + tavilyCount + ' results → total successful: ' + successfulSearches.length);
    }

    if (successfulSearches.length === 0) {
      console.warn('[Research-Service] ⚠️ No search results at all — returning empty items');
      const duration = Date.now() - startTime;
      await logPipeline({ workflowId, step: 'research-search', status: 'success', duration, detail: '0 results (no SERPER/Tavily or no match)' }).catch(() => {});
      return {
        items: [],
        notFound: keywords.map(k => k.keyword),
        keywords: keywords.map(k => k.keyword),
        totalKeywords: keywords.length,
        foundCount: 0,
        duration: parseFloat((duration / 1000).toFixed(1)),
        keywordSource,
        fallbackUsed: keywordFallbackUsed,
        warning: 'RESEARCH_SEARCH_FAILED: ไม่พบผลค้นหา (Serper/Tavily key หรือ network อาจมีปัญหา)',
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
      model: MODEL_FAST, // ★ MODEL_FAST (was MODEL_PRIMARY) — perf: fact JSON extraction doesn't need primary model
      prompt: factPrompt,
      temperature: 0.1,
      maxTokens: 4000,
    });

    let finalItems = factResult?.items || [];
    if (!factResult?.items?.length) {
      console.warn('[Research-Service] ⚠️ Fact extraction returned no items — returning empty');
    }

    // ★ STEP 3.5: Identity Verification — กันข้อมูล "คนชื่อเดียวกันแต่คนละคน" (fail-closed)
    let identityDropped = 0;
    if (finalItems.length > 0) {
      try {
        const verified = await verifyResearchItems({
          newsTitle,
          newsBody,
          breakdownData,
          items: finalItems,
          resolvedIdentity, // ★ Context-Resolve: ชื่อจริง+จุดยึดจากการค้นระบุตัวตน
        });
        identityDropped = verified.droppedCount;
        finalItems = verified.items;
        verified.report.forEach(line => console.log('[Research-Verify] ' + line));
      } catch (vErr) {
        // fail-closed: verifier พังทั้งตัว → ไม่ปล่อย research เข้าเนื้อหาเลย
        console.warn('[Research-Service] 🔴 Identity verifier crashed — dropping ALL research items (fail-closed):', vErr.message);
        identityDropped = finalItems.length;
        finalItems = [];
      }
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
      identityDropped, // จำนวน item ที่ถูกตัดเพราะยืนยันตัวบุคคลไม่ได้
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
