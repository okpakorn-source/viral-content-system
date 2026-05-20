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

// ─── Build Structured Payload ──────────────────────────────────────

export function buildNarrativePayload(newsTitle, breakdownData, researchData, blueprint) {
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
    source: item.sourceName || item.sourceUrl || '',
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

  // Grades
  const researchGrade = researchContexts.length >= 3 ? 'strong'
    : researchContexts.length >= 1 ? 'partial' : 'missing';

  const factCount = coreFacts.length + people.length + conflicts.length + timeline.length;
  const factSufficiency = factCount >= 5 ? 'sufficient'
    : factCount >= 2 ? 'minimal' : 'insufficient';

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
    sourceRemovedFromCompose: true,
  };
}

// ─── Format as Prompt ──────────────────────────────────────────────

export function formatNarrativePayload(payload) {
  let p = '';

  p += '=== NARRATIVE RECONSTRUCTION PAYLOAD ===\n';
  p += '⚠️ คุณจะไม่เห็นบทความต้นฉบับ — ต้องสร้างเรื่องใหม่จาก facts ด้านล่างเท่านั้น\n';
  p += '⚠️ ห้ามเรียงตาม structure เดิม ห้าม rewrite — ต้อง reconstruct narrative ใหม่\n\n';

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
    p += `\n=== ข้อมูลจาก Research (${payload.researchContexts.length} แหล่ง — ต้องใช้ทุกข้อ) ===\n`;
    payload.researchContexts.forEach((r, i) => {
      p += `${i + 1}. [${r.type}] ${r.topic}\n   ${r.content}\n`;
      if (r.relevance) p += `   → ${r.relevance}\n`;
    });
    p += '⚠️ ต้องสอดแทรกข้อมูล research ทุกข้อในเนื้อหา\n\n';
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
  p += '❌ ห้ามเพิ่มชื่อคน/สถานที่/ตัวเลขที่ไม่ได้ระบุ\n';
  p += '❌ ห้ามสร้าง quote ปลอม — ใช้ได้เฉพาะ quoteFragments\n';
  p += '✅ ถ้าข้อมูลไม่พอ ให้เขียนกว้าง ๆ แทนการแต่งรายละเอียด\n';
  if (payload.factSufficiency === 'insufficient') {
    p += '⚠️ [FACTS INSUFFICIENT] ข้อเท็จจริงน้อย — เขียนระวังอย่าแต่งเพิ่ม\n';
  }
  p += '=== จบ FACT SAFETY ===\n\n';

  // Reconstruction Mandate
  p += '=== NARRATIVE RECONSTRUCTION MANDATE ===\n';
  p += 'คุณไม่มีบทความต้นฉบับ — คุณมีแค่ facts, quotes, และ context\n';
  p += 'งาน: สร้างเรื่องเล่าใหม่ทั้งหมดจาก facts\n';
  p += 'ห้าม: เรียง facts ตามลำดับที่ให้ (สลับตามความเหมาะสม)\n';
  p += 'ห้าม: สรุปทีละย่อหน้า\n';
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
