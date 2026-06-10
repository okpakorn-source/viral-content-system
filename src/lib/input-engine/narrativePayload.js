/**
 * Narrative Payload Builder
 * ─────────────────────────────────────────────────────
 * แปลง breakdown/research/blueprint → NarrativePayload
 * ⚠️ ห้ามส่ง source article เต็มเข้า final compose
 *
 * Final compose เห็นได้เฉพาะ:
 *  coreFacts, timeline, people, conflicts,
 *  expandedIssues, researchContexts, backgroundKnowledge,
 *  emotionalBlueprint, narrativeAngle, storytellingDirection,
 *  quoteFragments (≤15 words each)
 */

// ─── Fact Extraction Helper ────────────────────────────────────────

export function extractHighDensityFacts(text) {
  if (!text || typeof text !== 'string') {
    return { names: [], dates: [], metrics: [], quotes: [] };
  }

  const names = new Set();
  const dates = new Set();
  const metrics = new Set();
  const quotes = new Set();
  const places = new Set();

  // 1. Thai Name Entities (with prefixes)
  const nameRegex = /(?:นาย|นาง|น\.ส\.|นางสาว|พล\.ต\.อ\.|พล\.ต\.ท\.|พล\.ต\.ต\.|พ\.ต\.อ\.|ดร\.|อาจารย์|ครู|โค้ช)\s*([\u0e01-\u0e3a\u0e40-\u0e4d]{2,}(?:\s+[\u0e01-\u0e3a\u0e40-\u0e4d]{2,})?)/g;
  let match;
  while ((match = nameRegex.exec(text)) !== null) {
    const fullMatch = match[0].trim();
    if (fullMatch.length > 3 && fullMatch.length < 40) {
      names.add(fullMatch);
    }
  }

  // 2. Dates
  const dateRegex = /(\d{1,2})\s*(?:ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s*(?:พ\.ศ\.\s*)?(\d{4})?/g;
  while ((match = dateRegex.exec(text)) !== null) {
    dates.add(match[0].trim());
  }

  // 3. Metrics/Numbers with units
  const metricRegex = /(\d+[\d,]*)\s*(?:บาท|เปอร์เซ็นต์|%|ล้าน|ราย|คน|จุด|ครั้ง|เสียง|มติ|กก\.|กิโลกรัม|เมตร)/g;
  while ((match = metricRegex.exec(text)) !== null) {
    metrics.add(match[0].trim());
  }

  // 4. Quotes (Thai quotes are primarily “...” or "...")
  const quoteRegex = /[“"‘]([^”"’]{4,100})[”"’]/g;
  while ((match = quoteRegex.exec(text)) !== null) {
    const cleanQuote = match[1].trim();
    if (cleanQuote.length >= 4 && !cleanQuote.includes('\n')) {
      quotes.add(cleanQuote);
    }
  }

  // 5. Thai Places
  const placeRegex = /(?:แยก|ถนน|ซอย|จ\.|จังหวัด|อ\.|อำเภอ|เขต|สถานี|โรงพยาบาล|รพ\.|คลอง|วัด)\s*([\u0e01-\u0e3a\u0e40-\u0e4d]{2,20})/g;
  while ((match = placeRegex.exec(text)) !== null) {
    places.add(match[0].trim());
  }

  return {
    names: Array.from(names),
    dates: Array.from(dates),
    metrics: Array.from(metrics),
    quotes: Array.from(quotes),
    places: Array.from(places),
  };
}

// ─── Build Structured Payload ──────────────────────────────────────

export function buildNarrativePayload(newsTitle, breakdownData, researchData, blueprint, rawNewsBody = '') {
  const bd = breakdownData || {};
  const research = researchData?.items || [];
  const bp = blueprint || null;

  // Core Facts
  const coreFacts = (bd.key_points || []).map(kp => ({
    fact: kp.point || (typeof kp === 'string' ? kp : ''),
    detail: kp.detail || '',
    category: kp.category || '',
    emotionalWeight: kp.emotional_value || '',
  }));

  // Timeline
  const timeline = [];
  if (bd.key_facts?.dates?.length > 0) {
    bd.key_facts.dates.forEach(d => timeline.push({ event: d, type: 'date' }));
  }
  if (bd.best_sections?.length > 0) {
    bd.best_sections.forEach(s => timeline.push({ event: s, type: 'key_moment' }));
  }

  // People
  const people = bd.key_facts?.people || [];

  // Conflicts
  const conflicts = [...(bd.conflicts || [])];
  if (bd.conflict_point && !conflicts.includes(bd.conflict_point)) {
    conflicts.unshift(bd.conflict_point);
  }

  // Expanded Issues (from angles)
  const expandedIssues = (bd.possible_angles || []).map(a => ({
    issue: a.angle_name || '',
    perspective: a.description || '',
    targetEmotion: a.target_emotion || '',
    viralScore: a.facebook_viral_score || 0,
  }));

  // Research Contexts
  const researchContexts = research.map(item => ({
    topic: item.title || item.keyword || '',
    content: item.content || '',
    type: item.type || 'context',
    sourceUrl: item.sourceUrl || '',
    sourceName: item.sourceName || '',
    relevance: item.relevance || '',
  }));

  // Background Knowledge
  const backgroundKnowledge = [];
  if (bd.key_facts?.numbers?.length > 0) {
    bd.key_facts.numbers.forEach(n => backgroundKnowledge.push({ type: 'statistic', data: n }));
  }
  if (bd.key_facts?.places?.length > 0) {
    bd.key_facts.places.forEach(p => backgroundKnowledge.push({ type: 'location', data: p }));
  }

  // Emotional Blueprint
  const emotionalBlueprint = bp ? {
    coreEmotion: bp.core_emotion || '',
    emotionReason: bp.emotion_reason || '',
    timeline: bp.emotional_timeline || [],
    branches: bp.emotional_branches || [],
    bridges: bp.bridges || [],
    forbidden: bp.forbidden || [],
  } : null;

  // Narrative Angle
  const narrativeAngle = bd.best_main_angle
    ? `${bd.best_main_angle.angle_name}: ${bd.best_main_angle.why_best}`
    : '';

  // Storytelling Direction
  const storytellingDirection = bd.language_strategy
    ? `เปิด: ${bd.language_strategy.opening_style || '-'}, เล่า: ${bd.language_strategy.storytelling_style || '-'}, ปิด: ${bd.language_strategy.ending_style || '-'}`
    : '';

  // Quote Fragments (≤15 words, no surrounding context)
  const quoteFragments = (bd.quotes || []).map(q => {
    const text = (typeof q === 'string' ? q : q.text || '').trim();
    const words = text.split(/\s+/);
    return words.length <= 15 ? text : words.slice(0, 15).join(' ') + '...';
  }).filter(q => q.length > 0);

  // Emotional hooks + pain points
  const emotionalHooks = bd.emotional_hooks || [];
  const painPoints = bd.pain_points || [];

  // Merge high density facts if rawNewsBody is available
  if (rawNewsBody && rawNewsBody.length > 20) {
    const enriched = extractHighDensityFacts(rawNewsBody);
    
    // Merge people
    enriched.names.forEach(n => {
      const cleanName = n.replace(/^(นาย|นาง|น\.ส\.|นางสาว|พล\.ต\.อ\.|พล\.ต\.ท\.|พล\.ต\.ต\.|พ\.ต\.อ\.|ดร\.|อาจารย์|ครู|โค้ช)\s*/, '');
      const exists = people.some(p => p.includes(cleanName) || cleanName.includes(p));
      if (!exists) {
        people.push(n);
      }
    });

    // Merge timeline dates
    enriched.dates.forEach(d => {
      const exists = timeline.some(t => t.event.includes(d) || d.includes(t.event));
      if (!exists) {
        timeline.push({ event: d, type: 'extracted_date' });
      }
    });

    // Merge metrics to backgroundKnowledge
    enriched.metrics.forEach(m => {
      const exists = backgroundKnowledge.some(b => b.data && (b.data.toString().includes(m) || m.includes(b.data.toString())));
      if (!exists) {
        backgroundKnowledge.push({ type: 'extracted_statistic', data: m });
      }
    });

    // Merge quotes to quoteFragments (keeping short and punchy)
    enriched.quotes.forEach(q => {
      const words = q.split(/\s+/);
      const shortQ = words.length <= 15 ? q : words.slice(0, 15).join(' ') + '...';
      const exists = quoteFragments.some(existQ => existQ.includes(shortQ) || shortQ.includes(existQ));
      if (!exists) {
        quoteFragments.push(shortQ);
      }
    });

    // Merge places
    enriched.places.forEach(p => {
      const exists = backgroundKnowledge.some(b => b.data && (b.data.toString().includes(p) || p.includes(b.data.toString())));
      if (!exists) {
        backgroundKnowledge.push({ type: 'extracted_location', data: p });
      }
    });

    // If coreFacts is thin, enrich it with extracted quote highlights
    if (coreFacts.length < 3 && quoteFragments.length > 0) {
      quoteFragments.slice(0, 3).forEach((q) => {
        const factExists = coreFacts.some(f => f.fact.includes(q) || q.includes(f.fact));
        if (!factExists) {
          coreFacts.push({
            fact: `ประเด็นสำคัญจากการพูดคุย: "${q}"`,
            detail: 'สกัดโดยตรงจากเหตุการณ์จริง',
            category: 'quote_enrichment',
            emotionalWeight: 'high'
          });
        }
      });
    }
  }

  // Grades
  const researchGrade = researchContexts.length >= 3 ? 'strong'
    : researchContexts.length >= 1 ? 'partial' : 'missing';

  const factCount = coreFacts.length + people.length + conflicts.length + timeline.length;
  const factSufficiency = factCount >= 6 ? 'sufficient'
    : factCount >= 3 ? 'minimal' : 'insufficient';

  return {
    headline: newsTitle || '',
    coreStory: bd.core_story || '',
    emotionalCore: bd.main_emotional_core || '',
    viralTrigger: bd.viral_trigger || '',
    coreFacts,
    timeline,
    people,
    conflicts,
    expandedIssues,
    researchContexts,
    backgroundKnowledge,
    emotionalBlueprint,
    narrativeAngle,
    storytellingDirection,
    quoteFragments,
    emotionalHooks,
    painPoints,
    researchGrade,
    factSufficiency,
    sourceRemovedFromCompose: false, // compose แนบ source excerpt 3000ch เพื่ออ้างอิงรายละเอียด (anti-duplicate ยังบังคับ)
  };
}

// ─── Format as Prompt ──────────────────────────────────────────────

export function formatNarrativePayload(payload) {
  let p = '';

  p += '=== NARRATIVE RECONSTRUCTION PAYLOAD ===\n';
  p += '⚠️ payload นี้คือ "โครงหลัก" ของเรื่อง — facts, บุคคล, timeline, quotes ด้านล่างคือกระดูกสันหลังที่ต้องครอบคลุม\n';
  p += '⚠️ ห้ามเรียงตาม structure ของต้นฉบับ ห้าม rewrite ทีละย่อหน้า — ต้อง reconstruct narrative ใหม่\n\n';

  p += `📰 หัวข้อ: ${payload.headline}\n`;
  if (payload.coreStory) p += `🎯 แก่นข่าว: ${payload.coreStory}\n`;
  if (payload.emotionalCore) p += `💔 แก่นอารมณ์: ${payload.emotionalCore}\n`;
  if (payload.viralTrigger) p += `🔥 Viral Trigger: ${payload.viralTrigger}\n`;
  p += '\n';

  // Core Facts
  if (payload.coreFacts.length > 0) {
    p += `=== ข้อเท็จจริงหลัก (${payload.coreFacts.length} ข้อ — ต้องครอบคลุมทุกข้อ) ===\n`;
    payload.coreFacts.forEach((f, i) => {
      p += `${i + 1}. ${f.fact}`;
      if (f.detail) p += ` — ${f.detail}`;
      if (f.category) p += ` [${f.category}]`;
      p += '\n';
    });
    p += '\n';
  }

  // People
  if (payload.people.length > 0) {
    p += `👤 บุคคลสำคัญ: ${payload.people.join(', ')}\n`;
    p += '⚠️ ชื่อต้องสะกดตรง 100% ห้ามเปลี่ยน\n\n';
  }

  // Timeline
  if (payload.timeline.length > 0) {
    p += `📅 เหตุการณ์สำคัญ:\n`;
    payload.timeline.forEach((t, i) => p += `  ${i + 1}. ${t.event}\n`);
    p += '\n';
  }

  // Conflicts
  if (payload.conflicts.length > 0) {
    p += `⚡ จุดขัดแย้ง:\n`;
    payload.conflicts.forEach((c, i) => p += `  ${i + 1}. ${c}\n`);
    p += '\n';
  }

  // Quote Fragments
  if (payload.quoteFragments.length > 0) {
    p += `💬 คำพูดสำคัญ (fragment สั้น ๆ เท่านั้น):\n`;
    payload.quoteFragments.forEach((q, i) => p += `  ${i + 1}. "${q}"\n`);
    p += '⚠️ ห้ามยืดคำพูด ห้ามแต่ง quote ใหม่\n\n';
  }

  // Background + Emotional Hooks
  if (payload.backgroundKnowledge.length > 0) {
    p += `📊 ข้อมูลพื้นฐาน:\n`;
    payload.backgroundKnowledge.forEach((b, i) => p += `  ${i + 1}. [${b.type}] ${b.data}\n`);
    p += '\n';
  }
  if (payload.emotionalHooks.length > 0) {
    p += `❤️ จุดที่คนอิน: ${payload.emotionalHooks.join(' | ')}\n`;
  }
  if (payload.painPoints.length > 0) {
    p += `😢 Pain Points: ${payload.painPoints.join(' | ')}\n`;
  }

  // Research
  if (payload.researchContexts.length > 0) {
    p += `\n=== ข้อมูลจาก Research (${payload.researchContexts.length} แหล่ง) ===\n`;
    payload.researchContexts.forEach((r, i) => {
      p += `${i + 1}. [${r.type}] ${r.topic}\n   ${r.content}\n`;
      if (r.sourceUrl) p += `   แหล่งอ้างอิง: ${r.sourceUrl} (${r.sourceName})\n`;
      if (r.relevance) p += `   → ${r.relevance}\n`;
    });
    // ถอดกฎการแนบลิงก์ในประโยคออก เพื่อไม่ให้รบกวนเนื้อหา (พนักงานจะเช็คจาก UI แทน)
    p += '⚠️ คำแนะนำการใช้ข้อมูล: เลือกหยิบข้อมูล ตัวเลข สถิติ หรือข้อเท็จจริง จากบรรทัดด้านบน มาเขียนอธิบายเสริมในเนื้อหา **เฉพาะส่วนที่เข้ากับบริบทและมุมมองของเวอร์ชันนี้** เพื่อเพิ่มความลึกและน่าเชื่อถือ (ไม่จำเป็นต้องใช้ทั้งหมด และห้ามแทรก URL หรือคำว่าอ้างอิงลงในเนื้อหาโดยเด็ดขาด พนักงานจะเช็คจาก UI เอง)\n';
    p += '⚠️ กฎความยาว: เขียนเนื้อหาให้ยาว ลึกซึ้ง และมีรายละเอียดที่จับใจผู้อ่าน ห้ามเขียนสรุปรวบรัดสั้นๆ\n\n';
  } else {
    p += `\n⚠️ [Research: Missing] ไม่มีข้อมูลเพิ่มเติม — ห้ามอ้างข้อมูลนอกเหนือจาก facts ด้านบน\n\n`;
  }

  // Expanded Issues
  if (payload.expandedIssues.length > 0) {
    p += `=== มุมเล่า (${payload.expandedIssues.length} มุม) ===\n`;
    payload.expandedIssues.forEach((e, i) => {
      p += `${i + 1}. ${e.issue}: ${e.perspective}`;
      if (e.targetEmotion) p += ` [อารมณ์: ${e.targetEmotion}]`;
      p += '\n';
    });
    p += '\n';
  }

  // Narrative Direction
  if (payload.narrativeAngle) p += `🏆 มุมเล่าแนะนำ: ${payload.narrativeAngle}\n`;
  if (payload.storytellingDirection) p += `✍️ ทิศทาง: ${payload.storytellingDirection}\n`;

  // Emotional Blueprint
  if (payload.emotionalBlueprint) {
    const eb = payload.emotionalBlueprint;
    p += `\n=== EMOTIONAL ARCHITECTURE ===\n`;
    p += `แกนอารมณ์: ${eb.coreEmotion}`;
    if (eb.emotionReason) p += ` (${eb.emotionReason})`;
    p += '\n';
    if (eb.timeline.length > 0) {
      p += 'Emotional Timeline:\n';
      eb.timeline.forEach((t, i) => p += `  ${i + 1}. ${t}\n`);
    }
    if (eb.bridges.length > 0) {
      p += 'ประโยคเชื่อม:\n';
      eb.bridges.forEach(b => p += `  • "${b}"\n`);
    }
    if (eb.forbidden.length > 0) p += `ห้าม: ${eb.forbidden.join(' | ')}\n`;
    p += '=== จบ Blueprint ===\n\n';
  }

  // Fact Safety Layer
  p += '=== FACT SAFETY LAYER ===\n';
  p += '❌ ห้ามแต่ง fact ใหม่ที่ไม่มีใน payload\n';
  p += '❌ ห้ามระบุชื่อสถานที่ จังหวัด หรือถนนเด็ดขาด หากไม่มีระบุไว้ในข้อมูล\n';
  p += '❌ ห้ามแต่ง วัน/เดือน/ปี หรือเวลาเด็ดขาด หากไม่ได้ระบุไว้ในข้อมูล\n';
  p += '❌ ห้ามเพิ่มชื่อคน/สถานที่/ตัวเลขที่ไม่ได้ระบุ\n';
  p += '❌ ห้ามสลับบทบาทของบุคคล (เช่น ใครคือผู้เสียชีวิต ใครคือผู้บาดเจ็บ ใครคือครอบครัว) ให้ยึดตาม fact อย่างเคร่งครัด\n';
  p += '❌ ระวังอย่าสลับ "ชื่อ" หรือ "ฉายา" ระหว่างบุคคลที่หนึ่งกับบุคคลที่สองเด็ดขาด\n';
  p += '❌ ห้ามสร้าง quote ปลอม — ใช้ได้เฉพาะ quoteFragments\n';
  p += '✅ ถ้าข้อมูลไม่พอ ให้เขียนกว้าง ๆ แทนการแต่งรายละเอียด\n';
  if (payload.factSufficiency === 'insufficient') {
    p += '⚠️ [FACTS INSUFFICIENT] ข้อเท็จจริงน้อย — เขียนระวังอย่าแต่งเพิ่ม\n';
  }
  p += '=== จบ FACT SAFETY ===\n\n';

  // Reconstruction Mandate
  p += '=== NARRATIVE RECONSTRUCTION MANDATE ===\n';
  p += 'ใช้ facts, quotes และ context จาก payload นี้เป็นแกนของเรื่อง — เนื้อข่าวต้นฉบับ (ถ้าแนบมาด้านล่าง) มีไว้ตรวจความถูกต้องของรายละเอียดเท่านั้น\n';
  p += 'งาน: สร้างเรื่องเล่าใหม่ทั้งหมดจาก facts\n';
  p += 'ห้าม: เรียง facts ตามลำดับที่ให้ (สลับตามความเหมาะสม)\n';
  p += 'ห้าม: สรุปทีละย่อหน้า ห้ามลอกโครงเรื่องหรือสำนวนจากต้นฉบับ\n';
  p += 'ต้อง: เลือก angle → เปิดด้วย moment/conflict → เล่า → ปิดด้วยอารมณ์\n';
  p += '=== จบ MANDATE ===\n\n';

  return p;
}

// ─── Similarity Checker ────────────────────────────────────────────

export function checkNarrativeSimilarity(sourceText, generatedText) {
  if (!sourceText || !generatedText) {
    return { score: 0, details: { nGramOverlap: 0, longMatchCount: 0 }, pass: true, grade: 'no_source' };
  }

  const normalize = (t) => t.replace(/\s+/g, ' ').trim().toLowerCase();
  const src = normalize(sourceText);
  const gen = normalize(generatedText);

  // 5-gram overlap
  function getNGrams(text, n) {
    const words = text.split(' ');
    const grams = new Set();
    for (let i = 0; i <= words.length - n; i++) {
      grams.add(words.slice(i, i + n).join(' '));
    }
    return grams;
  }

  const srcGrams = getNGrams(src, 5);
  const genGrams = getNGrams(gen, 5);
  let matchCount = 0;
  for (const g of genGrams) {
    if (srcGrams.has(g)) matchCount++;
  }
  const nGramOverlap = genGrams.size > 0 ? matchCount / genGrams.size : 0;

  // Long match detection (8+ consecutive words from source)
  const genWords = gen.split(' ');
  let longMatchCount = 0;
  for (let i = 0; i <= genWords.length - 8; i++) {
    const chunk = genWords.slice(i, i + 8).join(' ');
    if (src.includes(chunk)) longMatchCount++;
  }

  const score = Math.min(1, (nGramOverlap * 0.7) + (Math.min(longMatchCount / 10, 0.3)));

  return {
    score: parseFloat(score.toFixed(3)),
    details: { nGramOverlap: parseFloat(nGramOverlap.toFixed(3)), longMatchCount, matchedGrams: matchCount },
    pass: score < 0.4,
    grade: score < 0.15 ? 'excellent' : score < 0.3 ? 'good' : score < 0.4 ? 'acceptable' : 'too_similar',
  };
}
