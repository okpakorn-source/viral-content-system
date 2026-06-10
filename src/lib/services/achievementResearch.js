/**
 * Smart Achievement Research — 6 Agent ค้นหาข้อมูลหลายมุมพร้อมกัน
 * 
 * Flow:
 *   1. Entity Detection → ข่าวนี้พูดถึงใคร/อะไร
 *   2. 6 Parallel Agents → ค้นหาข้อมูลหลายมุม (Serper + Wikipedia)
 *   3. Safety Filter → กรองข้อมูลเสี่ยง 3 ชั้น
 *   4. Return factPool → ส่งให้ AI เขียนเนื้อหา
 * 
 * Graceful Fallback: ถ้าล้มเหลวทุกขั้นตอน → return null → flow เดิมทำงานปกติ
 */

import { callAI } from '@/lib/ai/openai';
import { createLogger } from '@/lib/logger';
import { MODEL_FAST } from '@/lib/ai/modelConfig';
import { tavilySearch, isTavilyAvailable } from '@/lib/services/tavilyService';
import { extractIdentityAnchors } from '@/lib/services/researchVerifier';

const rlog = createLogger('SMART-RESEARCH');
const SERPER_API_KEY = process.env.SERPER_API_KEY;

// ═══════════════════════════════════════════════
// === SAFETY: Keyword Blacklist (ชั้นที่ 1) ===
// ═══════════════════════════════════════════════
const BLACKLIST_PATTERNS = [
  // กฎหมายร้ายแรง
  'คลิปหลุด', 'คลิปหน้าคล้าย', 'ข่มขืน', 'ฆ่า', 'ฆาตกรรม',
  'ยาเสพติด', 'ยาบ้า', 'ยาไอซ์', 'กัญชา',
  // สถาบัน
  'ม.112', 'หมิ่นสถาบัน', 'ลบหลู่', 'หมิ่นพระบรม',
  // ส่วนตัวร้ายแรง
  'ชู้', 'มือที่สาม', 'นอกใจ', 'เปลือย', 'โป๊',
  'ท้องก่อนแต่ง', 'โรคติดต่อ', 'เอดส์', 'HIV',
  // FB Policy
  'ยั่วยุ', 'เหยียดเชื้อชาติ', 'ฆ่าตัวตาย', 'ทำร้ายตัวเอง',
  // อาชญากรรม
  'แก๊งคอลเซ็นเตอร์', 'ฟอกเงิน', 'พนันออนไลน์',
];

function containsBlacklist(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return BLACKLIST_PATTERNS.some(word => lower.includes(word));
}

// ═══════════════════════════════════════════════
// === Serper Search (lightweight) + Tavily Supplement ===
// ═══════════════════════════════════════════════
async function quickSearch(query, num = 3) {
  let results = [];

  // Try Serper first (if API key available)
  if (SERPER_API_KEY) {
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, gl: 'th', hl: 'th', num }),
        signal: AbortSignal.timeout(5000),  // ★ 5s per Serper call — ป้องกัน Serper ช้ากิน SmartResearch budget
      });
      if (res.ok) {
        const data = await res.json();
        results = (data.organic || []).slice(0, num).map(r => ({
          title: r.title || '',
          snippet: r.snippet || '',
          link: r.link || '',
          source: r.displayLink || '',
        }));
      }
    } catch {
      // Serper failed, will try Tavily below
    }
  }

  // Tavily supplement: use as primary if no Serper, or supplement if Serper returned few results
  const shouldUseTavily = isTavilyAvailable() && (!SERPER_API_KEY || results.length < 2);
  if (shouldUseTavily) {
    try {
      const { results: tavilyResults } = await tavilySearch(query, {
        topic: 'news',
        maxResults: num,
        searchDepth: 'basic',
        includeAnswer: false,
      });
      const existingLinks = new Set(results.map(r => r.link));
      const newResults = tavilyResults
        .filter(r => !existingLinks.has(r.url))
        .map(r => ({
          title: r.title || '',
          snippet: r.content || '',
          link: r.url || '',
          source: 'tavily',
        }));
      results = [...results, ...newResults].slice(0, num + 2);
      if (newResults.length > 0) {
        console.log(`[SmartResearch] 🔍 Tavily added ${newResults.length} results for "${query.slice(0, 40)}"`);
      }
    } catch {
      // Tavily failed silently
    }
  }

  return results;
}

// ═══════════════════════════════════════════════
// === Wikipedia Search (free, no key) ===
// ═══════════════════════════════════════════════
async function wikiSearch(name, entity = null) {
  try {
    const encoded = encodeURIComponent(name);
    const res = await fetch(`https://th.wikipedia.org/api/rest_v1/page/summary/${encoded}`, {
      headers: { 'Accept': 'application/json' },
    });
    let wikiText = '';
    if (res.ok) {
      const data = await res.json();
      if (data.type === 'standard' && data.extract) {
        return {
          title: data.title || name,
          snippet: data.extract.slice(0, 500),
          link: data.content_urls?.desktop?.page || '',
          source: 'Wikipedia',
        };
      }
    }

    // Fallback: English Wikipedia for international figures
    if (!wikiText && entity && entity.type !== 'นักการเมือง') {
      try {
        const enUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(entity.realName || entity.name)}`;
        const enRes = await fetch(enUrl, { signal: AbortSignal.timeout(5000) });
        if (enRes.ok) {
          const enData = await enRes.json();
          if (enData.type === 'standard' && enData.extract) {
            return {
              title: enData.title || name,
              snippet: enData.extract.slice(0, 500),
              link: enData.content_urls?.desktop?.page || '',
              source: 'Wikipedia (EN)',
            };
          }
        }
      } catch {}
    }

    return null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════
// === STEP 1: Entity Detection ===
// ═══════════════════════════════════════════════
async function detectEntity(newsTitle, newsBody) {
  const prompt = `วิเคราะห์ข่าวนี้แล้วระบุบุคคล/องค์กรหลักที่ถูกกล่าวถึง

=== ข่าว ===
หัวข้อ: ${newsTitle || ''}
เนื้อหา: ${(newsBody || '').slice(0, 1500)}
=== จบข่าว ===

กฎ:
- ระบุชื่อจริง + ชื่อที่รู้จัก + อาชีพ/บทบาท
- ระบุ narrativePattern: underdog_success | fallen_hero | hidden_hero | comeback_story | controversy | achievement | political | general
- ถ้าข่าวไม่มีบุคคลเด่นชัด → ตอบ {"entity": null}

ตอบ JSON เท่านั้น:
{"entity": {"name": "ชื่อหลัก", "realName": "ชื่อจริง", "aliases": ["ชื่ออื่น"], "type": "ศิลปิน|นักการเมือง|นักธุรกิจ|บุคคลทั่วไป|องค์กร", "context": "บริบทสั้นๆ"}, "narrativePattern": "pattern_name"}`;

  try {
    const result = await callAI({
      model: MODEL_FAST,
      prompt,
      temperature: 0.1,
      maxTokens: 500,
    });
    if (!result?.entity?.name) return null;
    return result;
  } catch (err) {
    rlog.step('entity-detect', `⚠️ Failed: ${err.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════
// === STEP 2: 6 Parallel Research Agents ===
// ═══════════════════════════════════════════════
function buildSearchQueries(entity, anchorStr = '') {
  const name = entity.name;
  const realName = entity.realName || '';
  const type = entity.type || '';
  const aliases = entity.aliases || [];
  const searchName = realName || name;
  const altName = aliases[0] || name;
  // ★ แนบ anchor (จังหวัด/องค์กร) เข้าทุก query — กันเจอคนชื่อซ้ำตั้งแต่ตอนค้น
  const a = anchorStr ? ` ${anchorStr}` : '';

  return {
    achievements: `"${searchName}"${a} ${type === 'นักการเมือง' ? 'ตำแหน่ง ผลงานเด่น นโยบาย' : type === 'ศิลปิน' ? 'เพลงฮิต ชื่อเพลง อัลบั้ม รางวัล' : 'ผลงานเด่น ความสำเร็จ'}`,
    numbers: `"${altName}"${a} ${type === 'ศิลปิน' ? 'ล้านวิว ยอดวิว ยอดสตรีม รายได้ ผู้ติดตาม' : type === 'นักการเมือง' ? 'คะแนนเสียง ผลสำรวจ ผลโพล เปอร์เซ็นต์' : 'ตัวเลข สถิติ จำนวน ล้านบาท'}`,
    quotes: `"${searchName}"${a} สัมภาษณ์ เคยพูด คำคม ให้สัมภาษณ์`,
    history: `"${searchName}"${a} ${type === 'นักการเมือง' ? 'ประวัติการศึกษา ตำแหน่งที่ผ่านมา' : 'จุดเริ่มต้น ก่อนมีชื่อเสียง เบื้องหลัง'}`,
    funFacts: `"${searchName}"${a} ประวัติ เรื่องน่ารู้ ก่อนดัง ชีวิตวัยเด็ก`,
    publicWork: `"${searchName}"${a} ${type === 'นักการเมือง' ? 'ผลงาน สภา กฎหมาย' : type === 'ศิลปิน' ? 'คอนเสิร์ต ทัวร์ โชว์ กิจกรรม' : 'โครงการ งานสำคัญ'}`,
  };
}

async function runAgents(entity, anchorStr = '') {
  const queries = buildSearchQueries(entity, anchorStr);
  rlog.step('agents', `🔎 6 Agents searching for "${entity.name}"${anchorStr ? ` + anchor "${anchorStr}"` : ''}...`);

  // Run all 6 agents + Wikipedia in parallel
  const [achievements, numbers, quotes, history, funFacts, publicWork, wiki] = await Promise.all([
    quickSearch(queries.achievements, 3).catch(() => []),
    quickSearch(queries.numbers, 3).catch(() => []),
    quickSearch(queries.quotes, 2).catch(() => []),
    quickSearch(queries.history, 2).catch(() => []),
    quickSearch(queries.funFacts, 3).catch(() => []),
    quickSearch(queries.publicWork, 2).catch(() => []),
    wikiSearch(entity.realName || entity.name, entity).catch(() => null),
  ]);

  const agentResults = {
    achievements: { label: '🏆 ผลงาน', results: achievements },
    numbers: { label: '📊 ตัวเลข', results: numbers },
    quotes: { label: '🗣️ คำพูด', results: quotes },
    history: { label: '⚡ ประวัติ', results: history },
    funFacts: { label: '💡 เบื้องหลัง', results: funFacts },
    publicWork: { label: '🎤 งานสาธารณะ', results: publicWork },
  };

  // Count total results
  let totalResults = Object.values(agentResults).reduce((sum, a) => sum + a.results.length, 0);
  if (wiki) totalResults += 1;
  rlog.step('agents', `✅ Total: ${totalResults} results + ${wiki ? 'Wikipedia' : 'no Wiki'}`);

  return { agentResults, wiki };
}

// ═══════════════════════════════════════════════
// === STEP 3: AI Fact Extraction + Safety ===
// ═══════════════════════════════════════════════
async function extractAndFilterFacts(entity, agentResults, wiki, newsTitle, newsBody = '') {
  // Build search catalog for AI
  let catalog = '';
  for (const [key, agent] of Object.entries(agentResults)) {
    if (agent.results.length === 0) continue;
    catalog += `\n[${agent.label}]\n`;
    agent.results.forEach(r => {
      catalog += `  TITLE: ${r.title}\n  TEXT: ${r.snippet}\n  SOURCE: ${r.source}\n  URL: ${r.link}\n---\n`;
    });
  }
  if (wiki) {
    catalog += `\n[📖 Wikipedia]\n  ${wiki.snippet}\n  URL: ${wiki.link}\n---\n`;
  }

  if (!catalog.trim()) return null;

  const prompt = `คุณคือ AI สกัดข้อเท็จจริง "เฉพาะเจาะจง" จากผลค้นหา

=== บุคคล ===
ชื่อ: ${entity.name} (${entity.realName || ''})
อาชีพ: ${entity.type || '-'}
บริบทข่าว: ${newsTitle || '-'}
เนื้อข่าวต้นฉบับ (ใช้เทียบยืนยันตัวบุคคล): ${(newsBody || '').slice(0, 600)}

=== ผลค้นหาจาก 6 Agents ===
${catalog}
=== จบผลค้นหา ===

## งาน: สกัดข้อเท็จจริงที่ "เฉพาะเจาะจง" และ "พิสูจน์ได้"

## กฎเหล็กเรื่องคุณภาพ (สำคัญที่สุด):
✅ ต้องเป็นข้อมูลเฉพาะเจาะจง: ชื่อเพลง, ตัวเลขยอดวิว, จำนวนรางวัล, วันที่, สถานที่, ชื่อโครงการ
✅ ตัวอย่างดี: "เพลง กอดจูบลูบคลำ มียอดวิว 430 ล้านวิว บน YouTube"
✅ ตัวอย่างดี: "เคยใช้ตะเกียงน้ำมันอ่านหนังสือ ก่อนมาเป็นศิลปิน"
✅ ตัวอย่างดี: "รายได้จากช่อง YouTube ประมาณ 4 ล้านบาท/เดือน"
❌ ตัวอย่างแย่: "เป็นศิลปินที่มีผลงานเพลงที่ได้รับความนิยมอย่างมาก" → กว้างเกินไป ไม่มีข้อมูลเฉพาะ
❌ ตัวอย่างแย่: "มีผลงานเพลงที่โดดเด่นในวงการเพลงไทย" → วลีทั่วไป ไม่มีประโยชน์
❌ ตัวอย่างแย่: "ได้รับการยอมรับจากแฟนเพลงอย่างกว้างขวาง" → ไม่มีข้อมูลเจาะจง

## กฎความปลอดภัย:
❌ ห้ามใช้ข้อมูลความสัมพันธ์ส่วนตัว (แฟน, เลิกรา, คบหา, ชู้, มือที่สาม)
❌ ห้ามใช้ข้อมูลคดีความ/ข้อกล่าวหาที่ยังไม่พิสูจน์
❌ ห้ามใช้ข้อมูลที่อาจทำให้บุคคลเสียหาย
❌ ห้ามใช้ข้อมูลเกี่ยวกับสถาบัน หรือเนื้อหาที่อาจผิดกฎหมาย
❌ ห้ามแต่งข้อมูลขึ้นเอง ถ้าผลค้นหาไม่มีข้อมูลเฉพาะเจาะจง ให้ตอบ facts = []
✅ ใช้ได้: ผลงานเฉพาะ, ตัวเลข/สถิติ, ประวัติการทำงาน, คำพูดจากสัมภาษณ์, เกร็ดน่ารู้

## 🚨 กฎยืนยันตัวบุคคล (IDENTITY — สำคัญที่สุด ห้ามพลาดเด็ดขาด):
ผลค้นหาอาจมี "คนชื่อเดียวกันแต่คนละคน" — ก่อนใช้ทุก fact ต้องเทียบกับบริบทข่าว
(จังหวัด/อาชีพ/อายุ/องค์กร/เหตุการณ์) ว่าเป็นคนเดียวกันจริง
- บริบทตรงชัดเจน → identityConfidence 8-10
- ชื่อตรงแต่บริบทไม่มีอะไรยืนยัน → identityConfidence ≤ 5 (จะถูกตัดทิ้ง)
- บริบทขัดแย้ง (คนละจังหวัด/อาชีพ/วงการ) → ห้ามใส่ใน facts เลย

ตอบ JSON:
{"facts": [{"category": "achievement|numbers|quote|history|funfact|publicwork", "text": "ข้อเท็จจริงเฉพาะเจาะจง ต้องมีชื่อ/ตัวเลข/วันที่", "source": "ชื่อเว็บที่พบ", "safetyScore": 1-10, "identityConfidence": 1-10}], "entitySummary": "สรุปสั้นๆ ว่าบุคคลนี้คือใคร 1 ประโยค"}`;

  try {
    const result = await callAI({
      model: MODEL_FAST,
      prompt,
      temperature: 0.1,
      maxTokens: 2000,
    });

    if (!result?.facts?.length) return null;

    // Safety Layer 1: Blacklist filter
    const safeFacts = result.facts.filter(fact => {
      if (containsBlacklist(fact.text)) {
        rlog.step('safety', `🔴 Blacklist blocked: "${fact.text.slice(0, 40)}..."`);
        return false;
      }
      // Safety Layer 2: AI safety score (keep ≥ 5)
      if (fact.safetyScore && fact.safetyScore < 5) {
        rlog.step('safety', `🟡 Low safety score (${fact.safetyScore}): "${fact.text.slice(0, 40)}..."`);
        return false;
      }
      // ★ Safety Layer 3: Identity confidence — ยืนยันไม่ได้ว่าคนเดียวกับข่าว = ทิ้ง (fail-closed)
      const idConf = Number(fact.identityConfidence);
      if (isNaN(idConf) || idConf < 8) {
        rlog.step('identity', `🔴 Identity unverified (conf=${fact.identityConfidence ?? 'n/a'}): "${fact.text.slice(0, 40)}..."`);
        return false;
      }
      return true;
    });

    if (safeFacts.length === 0) return null;

    rlog.step('facts', `✅ ${safeFacts.length} safe facts extracted (from ${result.facts.length} total)`);
    return {
      facts: safeFacts,
      entitySummary: result.entitySummary || '',
      entityName: entity.name,
      entityType: entity.type || '',
    };
  } catch (err) {
    rlog.step('facts', `⚠️ Fact extraction failed: ${err.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════
// === MAIN: Smart Research Pipeline ===
// ═══════════════════════════════════════════════
export async function smartResearch(newsData, breakdownData) {
  const startTime = Date.now();
  const newsTitle = newsData?.newsTitle || '';
  const newsBody = newsData?.newsBody || '';

  try {
    rlog.start(`Smart Research for: "${newsTitle.slice(0, 50)}"`);

    // Step 1: Entity Detection
    rlog.step('entity', '🧠 Detecting entity...');
    const detection = await detectEntity(newsTitle, newsBody);
    
    if (!detection?.entity) {
      rlog.step('entity', '⚠️ No entity found — skipping smart research');
      return null;
    }

    const entity = detection.entity;
    const pattern = detection.narrativePattern || 'general';
    rlog.step('entity', `✅ Found: "${entity.name}" (${entity.type}) | Pattern: ${pattern}`);

    // ★ Step 1.5: สกัด identity anchors จากข่าว (จังหวัด/องค์กร/อายุ) — ใช้กันคนชื่อซ้ำ
    const { anchors } = extractIdentityAnchors({ newsTitle, newsBody });
    const anchorStr = anchors.find(a => !/^อายุ/.test(a)) || ''; // ตัวแรกที่ไม่ใช่อายุ ใช้แนบ query
    if (anchors.length > 0) {
      rlog.step('identity', `🔒 Anchors: [${anchors.slice(0, 4).join(', ')}] | query anchor: "${anchorStr || '-'}"`);
    } else {
      rlog.step('identity', `⚠️ No identity anchors in news — relying on AI identityConfidence only`);
    }

    // Step 2: 6 Parallel Agents (+ anchor ใน query)
    const { agentResults, wiki } = await runAgents(entity, anchorStr);

    // ★ Step 2.5: Anchor pre-filter — ผลค้นหาที่เอ่ยชื่อ entity แต่ไม่มี anchor ของข่าวเลย = เสี่ยงคนละคน → ตัดทิ้ง
    if (anchors.length > 0) {
      const entityNames = [entity.name, entity.realName, ...(entity.aliases || [])].filter(Boolean);
      const normalize = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
      let preDropped = 0;
      for (const agent of Object.values(agentResults)) {
        agent.results = agent.results.filter(r => {
          const t = normalize(`${r.title} ${r.snippet}`);
          const nameHit = entityNames.some(n => n && n.length >= 3 && t.includes(normalize(n)));
          if (!nameHit) return true; // ไม่เอ่ยชื่อ = บริบททั่วไป ให้ AI ชั้นถัดไปตัดสิน
          const anchorHit = anchors.some(a => t.includes(normalize(a.replace(/อายุ(\d+)ปี/, '$1'))));
          if (!anchorHit) { preDropped++; return false; } // ชื่อตรงแต่ไร้หลักฐาน → ทิ้ง
          return true;
        });
      }
      if (preDropped > 0) rlog.step('identity', `🔴 Pre-filter dropped ${preDropped} results (ชื่อตรงแต่ anchor ไม่ตรง)`);
    }

    // Check if we got enough data
    const totalResults = Object.values(agentResults).reduce((sum, a) => sum + a.results.length, 0) + (wiki ? 1 : 0);
    if (totalResults < 2) {
      rlog.step('agents', `⚠️ Only ${totalResults} results after identity filter — not enough, skipping (fail-closed)`);
      return null;
    }

    // Step 3: AI Fact Extraction + Safety Filter (+ identityConfidence ≥ 8)
    const factPool = await extractAndFilterFacts(entity, agentResults, wiki, newsTitle, newsBody);
    
    if (!factPool || factPool.facts.length === 0) {
      rlog.step('result', '⚠️ No safe facts — using original flow');
      return null;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    rlog.step('result', `✅ Smart Research done: ${factPool.facts.length} facts in ${duration}s`);

    return {
      ...factPool,
      narrativePattern: pattern,
      duration: parseFloat(duration),
      totalSearchResults: totalResults,
    };

  } catch (err) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    rlog.step('error', `❌ Smart Research failed (${duration}s): ${err.message}`);
    // Graceful fallback — return null, flow เดิมทำงานปกติ
    return null;
  }
}
