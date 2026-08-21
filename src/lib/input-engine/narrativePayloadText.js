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
import { isLegacyLengthOn, legacyLengthRule } from '../ai/legacyLengthRules.js';
import { isCardAuthorityR3Enabled } from '../ai/cardAuthority.js';
import { objTextList, objText, isObjFixEnabled, quoteTextFix } from '../utils/objText.js'; // 🔧 19 ส.ค. 69 (HOOKS_OBJ_FIX): ตัวแปลงกลาง object → ข้อความ (กัน "[object Object]" หลุดเข้าตัวเขียน) — ถอย HOOKS_OBJ_FIX=0

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
    // 🔧 19 ส.ค. 69 (HOOKS_OBJ_FIX บั๊ก B): รูปร่างจริง 9 ใน 10 แบบไม่ใช้คีย์ reason
    //   (why_strong / why_it_works / why_best / use_for / best_use / use_case / usable_angle — นับจากไฟล์ผล 23 รอบ)
    //   → บรรทัดเดิมได้แค่หัวข้อท่อน เหตุผลหายเงียบ · objText อ่านคีย์ชุดนี้ครบ (DETAIL_KEYS ใน objText.js)
    //   มีคีย์ reason = เดินนิพจน์เดิมทุกไบต์ · สวิตช์ถอย HOOKS_OBJ_FIX=0 = นิพจน์เดิมทั้งหมด
    // 🔧 20 ส.ค. 69 (โซล-max ตรวจรอบ 2 — ปิดผลข้างเคียง 2 จุด):
    //   S2: เดิมอ่าน s.reason 2 ครั้ง (ของเดิมอ่านครั้งเดียว) → เก็บใส่ตัวแปรอ่านครั้งเดียว
    //   S1: เดิมใช้ !s.reason ซึ่งเป็นจริงกับ 0 และ false ด้วย → หลุดเข้า objText ได้ "S — 0" / "S — false"
    //       แต่ของเดิม filter(Boolean) ทิ้ง 0/false แล้วได้ "S" → เปลี่ยนเงื่อนไขเป็น "ไม่มีคีย์ reason เลย"
    //       ⇒ มีคีย์ reason ในรูปแบบใดก็ตาม (รวม 0/false/'') = เดินนิพจน์เดิมทุกไบต์
    bd.best_sections.forEach(s => {
      const isObj = s !== null && typeof s === 'object';
      const reason = isObj ? s.reason : undefined; // อ่านครั้งเดียว
      const legacyEvent = typeof s === 'string' ? s : [s.section, reason].filter(Boolean).join(' — ');
      const hasReasonKey = isObj && 'reason' in s;
      const event = (isObj && !hasReasonKey && isObjFixEnabled()) ? (objText(s) || legacyEvent) : legacyEvent;
      timeline.push({ event, type: 'key_moment' });
    });
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
    identity: item._identity || 'generic', // 'verified' = ยืนยันแล้วว่าบุคคล/เหตุการณ์เดียวกับข่าว
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

  // ★ 18 ส.ค. 69 (แบบ ก — ANGLE_CLOSING_SPLIT): bp.angle_closing = แผนจบเฉพาะมุมนี้
  //   (autoFlowServiceText แนบมาเฉพาะเมื่อ ANGLE_CLOSING_SPLIT=1 + จับคู่ชื่อมุมสำเร็จ)
  //   🔧 19 ส.ค. 69 แก้ตามผู้ตรวจอิสระ 4 คน (FIXLIST-planK):
  //   ร้ายแรง 4 (fail-closed): เช็ค env ตรงนี้ด้วย — ข้อมูลป้อน bp.angle_closing อย่างเดียวห้ามเปิดฟีเจอร์ได้
  //   ร้ายแรง 2 (ทั้งชุดหรือไม่เลย): hasAngleClosing ตั้ง "หลัง" regex ทุบท้ายติดเท่านั้น —
  //     regex ไม่ติด = ไม่แตะสักชั้น ถอยพฤติกรรมเดิมทั้งใบ (เดิมชั้น 2/3 ยิงแม้ชั้น 1 พลาด = ได้ผลแย่สุดพร้อมกัน)
  //   ร้ายแรง 1 (เลิกกรอง forbidden): ตัวกรอง regex เคยทิ้งกฎกันแต่งข้อเท็จจริง 8/34 ข้อ (เคส RUN6 มัทฉะ) —
  //     ลบทั้งก้อน ใช้บรรทัดลำดับอำนาจในบล็อก 🔚 (ใน formatNarrativePayload) แทน
  //     (ต้นทางกันไว้แล้ว: prompt Blueprint สั่งห้ามใส่เรื่องวิธีจบใน FORBIDDEN — summarizeServiceText ข้อ 7)
  //   🟡 กัน [object Object]: รับเฉพาะ string — AI ตอบ field เป็น object เมื่อไหร่ = ถือว่าไม่มีค่า
  //   ชั้นที่ตัดเมื่อทำงาน: ชั้น 1 แทนข้อสุดท้าย timeline · ชั้น 3 ตัด "ปิด:" (จุดสร้างด้านล่าง)
  let hasAngleClosing = false;
  if (process.env.ANGLE_CLOSING_SPLIT === '1'
      && emotionalBlueprint && bp.angle_closing && typeof bp.angle_closing === 'object' && !Array.isArray(bp.angle_closing)) {
    const _ac = bp.angle_closing;
    const _str = (v) => (typeof v === 'string' ? v.trim() : '');
    const _direction = _str(_ac.closing_direction);
    const _sketch = _str(_ac.closing_sketch);
    const _closingText = [_direction, _sketch].filter(Boolean).join(' — ');
    const _tl = emotionalBlueprint.timeline;
    // 🔧 19 ส.ค. 69 รอบ 3: เงื่อนไข "ทุบท้าย" ใช้ helper เดียวกับฝั่ง autoFlow (closingTailMatches ท้ายไฟล์นี้)
    //   — autoFlow เช็คก่อนแนบแผน+ก่อน log เพื่อให้ log ตรงกับสิ่งที่ฝั่งเขียนใช้จริง (แก้ log โกหก)
    const _tlTailIsClosing = closingTailMatches(_tl);
    if (_closingText && _tlTailIsClosing) {
      hasAngleClosing = true;
      emotionalBlueprint.angleClosing = {
        angleName: _str(_ac.angle_name),
        direction: _direction,
        sketch: _sketch,
        avoidOverlap: _str(_ac.avoid_overlap),
      };
      // ชั้น 1: ข้อสุดท้ายของ timeline คือ "ประโยคทุบท้าย — ..." กลางที่แชร์ทุกมุม → แทนด้วยแผนของมุมนี้
      //   (สร้าง array ใหม่เสมอ ห้ามแก้ array เดิมใน bp — blueprint ก้อนกลางถูกมุมอื่นใช้ต่อ)
      emotionalBlueprint.timeline = [..._tl.slice(0, -1), `ประโยคทุบท้าย (เฉพาะมุมนี้) — ${_closingText}`];
    }
  }

  // ★ 18 ส.ค. 69 (แบบ A — ANGLE_BLUEPRINT_MODE=per_angle): ตราประทับนี้มาจาก key ชื่อมุมที่ autoFlow ผูกไว้
  //   Blueprint ทั้งใบ (รวม timeline/ท่อนจบ) จึงเป็นของมุมนี้อยู่แล้ว และต้องตัด "ปิด:" กลางจาก breakdown
  //   ไม่มีตราประทับหรือ env ไม่ใช่ "per_angle" = ไม่เพิ่ม field และไม่เปลี่ยนใบสั่งเขียนเดิมแม้แต่ตัวอักษรเดียว
  if (process.env.ANGLE_BLUEPRINT_MODE === 'per_angle'
      && emotionalBlueprint && bp.angle_blueprint && typeof bp.angle_blueprint === 'object') {
    const _angleName = String(bp.angle_blueprint.angle_name || '').trim();
    if (_angleName) {
      emotionalBlueprint.angleBlueprint = {
        angleName: _angleName,
        description: String(bp.angle_blueprint.description || '').trim(),
      };
      hasAngleClosing = true;
    }
  }

  // Narrative Angle
  const narrativeAngle = bd.best_main_angle
    ? `${bd.best_main_angle.angle_name}: ${bd.best_main_angle.why_best}`
    : '';

  // Storytelling Direction
  // ★ ANGLE_CLOSING_SPLIT ชั้น 3: มุมที่มีแผนจบเฉพาะตัว ไม่รับ "ปิด: ..." กลางจาก breakdown (แชร์ข้ามมุม) — เปิด/เล่า คงเดิม
  const storytellingDirection = bd.language_strategy
    ? (hasAngleClosing
        ? `เปิด: ${bd.language_strategy.opening_style || '-'}, เล่า: ${bd.language_strategy.storytelling_style || '-'}`
        : `เปิด: ${bd.language_strategy.opening_style || '-'}, เล่า: ${bd.language_strategy.storytelling_style || '-'}, ปิด: ${bd.language_strategy.ending_style || '-'}`)
    : '';

  // Quote Fragments (≤15 words, no surrounding context)
  // 🔧 19 ส.ค. 69 (HOOKS_OBJ_FIX บั๊ก A): รูปร่าง { speaker, quote_type, content, emotional_use } ไม่มีคีย์ quote/text
  //   → ได้ '' แล้วถูก filter ทิ้งทั้งรายการ = คำพูดสำคัญไม่ถึงนักเขียนเลย
  //   quoteTextFix เป็นตัวสำรอง "ท้ายนิพจน์เดิม" เท่านั้น (สวิตช์ปิด/รูปร่างเดิม = ผลเดิมทุกไบต์) · ถอย HOOKS_OBJ_FIX=0
  const quoteFragments = (bd.quotes || []).map(q => {
    const text = (typeof q === 'string' ? q : q.quote || q.text || quoteTextFix(q) || '').trim();
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
    payload.conflicts.forEach((c, i) => p += `  ${i + 1}. ${typeof c === 'string' ? c : [c.conflict, c.detail].filter(Boolean).join(' — ')}\n`);
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
  // 🔧 19 ส.ค. 69 (HOOKS_OBJ_FIX): ขั้นสกัดคืน emotional_hooks เป็น object บ้าง/สตริงบ้าง —
  //   จุดนี้ต่อสตริงตรงๆ เลยได้ "[object Object]" ส่งเข้าตัวเขียนโดยไม่มี error · ถอย: HOOKS_OBJ_FIX=0 (คืนอาเรย์เดิมทั้งดุ้น)
  const objFixHooks = objTextList(payload.emotionalHooks, 'emotional_hooks');
  if (objFixHooks.length > 0) {
    // ★ 19 ส.ค. 69 (HOOKS_AS_OPENERS — สเปคเฟเบิ้ล-สุด): เดิม hook ทั้งพวงถูกอัดบรรทัดเดียว "a | b | c"
    //   นักเขียนมักลอกยกพวงไปเปิดเรื่อง — เปิดสวิตช์แล้วแตกเป็นรายการแยกบรรทัด + กำกับว่าเป็นตัวเลือกวัตถุดิบ
    //   เปิด: HOOKS_AS_OPENERS=1 · ปิด (ค่าเริ่มต้น — ไม่ตั้ง env): บรรทัดเดิมทุกไบต์
    if (process.env.HOOKS_AS_OPENERS === '1') {
      p += `❤️ จุดที่คนอิน (ตัวเลือกวัตถุดิบ — ไม่บังคับ ถ้าขัดกับการ์ดให้ยึดการ์ด):\n`;
      objFixHooks.forEach((h, i) => p += `  ${i + 1}. ${h}\n`);
    } else {
      p += `❤️ จุดที่คนอิน: ${objFixHooks.join(' | ')}\n`;
    }
  }
  const objFixPains = objTextList(payload.painPoints, 'pain_points'); // 🔧 HOOKS_OBJ_FIX (เหตุผลเดียวกับ hooks ด้านบน)
  if (objFixPains.length > 0) {
    p += `😢 Pain Points: ${objFixPains.join(' | ')}\n`;
  }

  // Research
  if (payload.researchContexts.length > 0) {
    p += `\n=== ข้อมูลจาก Research (${payload.researchContexts.length} แหล่ง) ===\n`;
    payload.researchContexts.forEach((r, i) => {
      const idTag = r.identity === 'verified' ? '✅ยืนยันบุคคล/เหตุการณ์เดียวกัน' : '🌐บริบททั่วไป';
      p += `${i + 1}. [${r.type}|${idTag}] ${r.topic}\n   ${r.content}\n`;
      if (r.sourceUrl) p += `   แหล่งอ้างอิง: ${r.sourceUrl} (${r.sourceName})\n`;
      if (r.relevance) p += `   → ${r.relevance}\n`;
    });
    p += '🚨 กฎ IDENTITY (ห้ามฝ่าฝืนเด็ดขาด): รายการ [🌐บริบททั่วไป] ใช้เป็นความรู้ประกอบเท่านั้น — ห้ามเขียนผูกกับตัวบุคคลในข่าว (ห้ามบอกว่าเขาเคยทำ/เคยพูด/มีประวัติตามข้อมูลนั้น) เฉพาะรายการ [✅ยืนยันบุคคล] เท่านั้นที่ผูกกับบุคคลได้\n';
    // ถอดกฎการแนบลิงก์ในประโยคออก เพื่อไม่ให้รบกวนเนื้อหา (พนักงานจะเช็คจาก UI แทน)
    p += '⚠️ คำแนะนำการใช้ข้อมูล: เลือกหยิบข้อมูล ตัวเลข สถิติ หรือข้อเท็จจริง จากบรรทัดด้านบน มาเขียนอธิบายเสริมในเนื้อหา **เฉพาะส่วนที่เข้ากับบริบทและมุมมองของเวอร์ชันนี้** เพื่อเพิ่มความลึกและน่าเชื่อถือ (ไม่จำเป็นต้องใช้ทั้งหมด และห้ามแทรก URL หรือคำว่าอ้างอิงลงในเนื้อหาโดยเด็ดขาด พนักงานจะเช็คจาก UI เอง)\n';
    // 🗑️ 17 ส.ค. 69: ถอด "กฎความยาว: เขียนให้ยาว...ห้ามสรุปรวบรัดสั้นๆ" ออก (เจ้าของสั่ง — กฎยุคแรกที่สั่งยาวไว้ก่อน)
    //    ถอยคืนด้วย LEGACY_LENGTH_RULES=1 · '\n' ที่เหลือคือบรรทัดว่างคั่นหัวข้อ ต้องคงไว้
    p += legacyLengthRule('research') + '\n';
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
    if (eb.angleBlueprint) {
      p += `🎯 Blueprint ใบนี้สร้างเฉพาะมุม: ${eb.angleBlueprint.angleName}\n`;
      if (eb.angleBlueprint.description) p += `  • คำอธิบายมุม: ${eb.angleBlueprint.description}\n`;
      p += `  • ใช้ emotional timeline และท่อนจบจากใบนี้กับมุมนี้เท่านั้น\n`;
    }
    if (eb.timeline.length > 0) {
      p += 'Emotional Timeline:\n';
      eb.timeline.forEach((t, i) => p += `  ${i + 1}. ${t}\n`);
    }
    if (eb.bridges.length > 0) {
      p += 'ประโยคเชื่อม:\n';
      eb.bridges.forEach(b => p += `  • "${b}"\n`);
    }
    if (eb.forbidden.length > 0) p += `ห้าม: ${eb.forbidden.join(' | ')}\n`;
    // ★ 18 ส.ค. 69 (แบบ ก — ANGLE_CLOSING_SPLIT): แผนจบเฉพาะมุมนี้ — มีเฉพาะเมื่อสวิตช์เปิด+จับคู่มุมสำเร็จ
    //   (ไม่มี = บล็อกนี้หายทั้งก้อน → ใบสั่งเขียนเดิมทุกไบต์)
    if (eb.angleClosing) {
      p += `🔚 แผนจบเฉพาะมุมนี้ (ท่อนจบของเวอร์ชันนี้ต้องเดินตามนี้ — ห้ามใช้ภาพจบ/ประโยคจบร่วมกับเวอร์ชันมุมอื่น):\n`;
      if (eb.angleClosing.direction) p += `  • แนวทางปิด: ${eb.angleClosing.direction}\n`;
      if (eb.angleClosing.sketch) p += `  • ร่างประโยคทุบท้าย (แนวทางใจความ — เกลาคำเองได้ แต่ห้ามหลุดใจความ): ${eb.angleClosing.sketch}\n`;
      if (eb.angleClosing.avoidOverlap) p += `  • ห้ามซ้ำกับมุมอื่น: ${eb.angleClosing.avoidOverlap}\n`;
      // ★ 19 ส.ค. 69 (ร้ายแรง 1 — แทนตัวกรอง forbidden ที่ลบทิ้ง): ลำดับอำนาจ ไม่ลบข้อมูล —
      //   ข้อ "ห้าม" ทุกข้อยังอยู่ครบในใบสั่ง (โดยเฉพาะกฎกันแต่งข้อเท็จจริง) แค่เรื่องวิธีจบให้แผนนี้ชนะ
      p += `  ⚠️ แผนจบเฉพาะมุมนี้มีอำนาจเหนือคำสั่ง "ต้องปิดด้วย..." ใดๆ ในข้อ "ห้าม" ด้านบน — ส่วนข้อห้ามที่กันแต่งข้อเท็จจริง ยังบังคับครบทุกข้อ\n`;
    }
    p += '=== จบ Blueprint ===\n\n';
  }

  // Fact Safety Layer (Relaxed for Text Pipeline)
  p += '=== FACT SAFETY LAYER ===\n';
  p += '❌ ห้ามแต่ง วัน/เดือน/ปี หรือเวลาเด็ดขาด หากไม่ได้ระบุไว้ในข้อมูล\n';
  p += '❌ ห้ามสลับบทบาทของบุคคล ให้ยึดตาม fact อย่างเคร่งครัด\n';
  p += '❌ ระวังอย่าสลับ "ชื่อ" หรือ "ฉายา" ระหว่างบุคคลที่หนึ่งกับบุคคลที่สองเด็ดขาด\n';
  p += '❌ ห้ามสร้าง quote ปลอม — ใช้ได้เฉพาะ quoteFragments\n';
  // ★ 16 ส.ค. 69 (เจ้าของสั่งปิด): เดิมบรรทัดนี้อนุญาตให้ "แต่งสถานการณ์จำลอง" เพื่อยืดให้ครบ 250 คำ
  //   ฝัง 1 มิ.ย. 69 เจตนาเดิมคือช่วยข่าวนโยบาย/วิชาการที่ไม่มีคนในเหตุการณ์ — แต่มีปัญหา 3 ข้อ:
  //   (1) วางไว้ใน FACT SAFETY แบบไม่มีเงื่อนไข → ครอบทุกข่าว ไม่ใช่แค่ข่าวนโยบาย
  //       ("โดยเฉพาะ" ในภาษาไทย = "ยิ่งเหมาะถ้า..." ไม่ได้แปลว่า "เฉพาะ")
  //   (2) เลข 250 ตกยุคแล้ว — พื้นความยาวปัจจุบันคือ 165 คำ (WORD_FLEX_V2, eb6ff50)
  //   (3) ทับซ้อนกับหน้าที่ของการ์ด: การ์ดทั้ง 201/201 ใบมี writingStyle + tone + exampleHooks
  //       ที่สั่งเรื่อง "สำนวนให้น่าอ่าน" อยู่แล้ว และ FabGate ก็ระบุเองว่า
  //       "สำนวนแต่ง/ภาพเปรียบ/การเรียบเรียงใหม่จากข้อเท็จจริงเดิม ไม่นับเป็นของเกิน"
  //       → นักเขียนมีเครื่องมือทำให้น่าอ่านครบอยู่แล้วโดยไม่ต้องแต่งเหตุการณ์ขึ้นใหม่
  //       การเปิดช่องให้แต่งเรื่องจึงไปแทนที่งานฝีมือของการ์ด ไม่ใช่เสริม
  //   (4) ขัดกับด่านจับของเกินตรงๆ — พรอมต์สั่งให้เติม แล้วอีกด่านมาตัดทิ้ง
  //   เปิดคำแนะนำเสริม: ALLOW_SIMULATION=1 (รับ 1/true/on ไม่สนตัวพิมพ์เล็กใหญ่/เครื่องหมายคำพูด)
  //   โหมดปกติริบใบอนุญาตแต่งสถานการณ์และไม่ผูกกับจำนวนคำ · LEGACY_LENGTH_RULES=1 คืนข้อความเดิมเป๊ะ
  const _simOn = ['1', 'true', 'on'].includes(
    String(process.env.ALLOW_SIMULATION || '').trim().toLowerCase().replace(/^["']|["']$/g, '')
  );
  if (_simOn) {
    p += isLegacyLengthOn()
      ? '✅ **อนุญาตให้ยกตัวอย่างสถานการณ์จำลอง (Simulation) ที่สอดคล้องกับบริบท เพื่อขยายความให้ครบ 250 คำได้ โดยเฉพาะกรณีที่เป็นนโยบายหรือข้อความเชิงวิชาการ**\n'
      : '✅ **สำหรับข่าวนโยบายหรือข้อความเชิงวิชาการ ให้อธิบายหลักการ ผลกระทบ และความสำคัญจากข้อเท็จจริงหรือบริบทที่ให้มาเพื่อให้เข้าใจง่ายขึ้น แต่ห้ามสร้างสถานการณ์จำลอง บุคคล คำพูด หรือรายละเอียดที่ข่าวไม่ได้ให้มา และพอดีแล้วต้องพอ ห้ามหาคำมาเติม**\n';
  }
  if (payload.factSufficiency === 'insufficient') {
    p += '⚠️ [FACTS INSUFFICIENT] ข้อเท็จจริงน้อย — ให้มุ่งเน้นการขยายความอธิบายถึงผลกระทบ ความสำคัญ หรือยกตัวอย่างให้เห็นภาพชัดเจนขึ้น\n';
  }
  p += '=== จบ FACT SAFETY ===\n\n';

  // Reconstruction Mandate
  p += '=== NARRATIVE RECONSTRUCTION MANDATE ===\n';
  p += 'ใช้ facts, quotes และ context จาก payload นี้เป็นแกนของเรื่อง — เนื้อข่าวต้นฉบับ (ถ้าแนบมาด้านล่าง) มีไว้ตรวจความถูกต้องของรายละเอียดเท่านั้น\n';
  p += 'งาน: สร้างเรื่องเล่าใหม่ทั้งหมดจาก facts\n';
  // ★ 19 ส.ค. 69 (CARD_AUTHORITY R3 — default ปิด): กฎ 2 บรรทัดนี้ทับ hookStyle + structure_formula ของการ์ดตรงๆ
  //   และถูกต่อท้ายการ์ด = ชนะโดยตำแหน่ง — เปิดสวิตช์เพื่อตัดออก · ปิด = ใบสั่งเดิมทุกไบต์
  const _r3On = isCardAuthorityR3Enabled();
  if (!_r3On) p += 'ห้าม: เรียง facts ตามลำดับที่ให้ (สลับตามความเหมาะสม)\n';
  p += 'ห้าม: สรุปทีละย่อหน้า ห้ามลอกโครงเรื่องหรือสำนวนจากต้นฉบับ\n';
  if (!_r3On) p += 'ต้อง: เลือก angle → เปิดด้วย moment/conflict → เล่า → ปิดด้วยอารมณ์\n';
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

// ─── ANGLE_CLOSING_SPLIT helpers — จุดความจริงเดียว (19 ส.ค. 69 รอบ 3 ตามผลตรวจโซล) ───
// วางไว้ไฟล์นี้เพราะเป็นปลายทางของ dependency (ไม่ import ใคร) — autoFlow (แนบแผน+log)
// และ summarize (นับรายงาน) import ไปใช้กติกาเดียวกันเป๊ะ ห้ามก๊อปสูตรไปแก้แยกที่

// เงื่อนไขชั้น 1: ข้อสุดท้ายของ emotional_timeline ต้องเป็น "ประโยคทุบท้าย" (เช็คแค่คำ "ทุบท้าย" — AI อาจตัดคำหน้า)
// autoFlow เช็คตัวนี้ "ก่อนแนบแผน+ก่อน log" → log ตรงกับที่ฝั่งเขียนใช้จริงเสมอ (แก้ log โกหก — โซลชี้)
export function closingTailMatches(timeline) {
  return Array.isArray(timeline) && timeline.length > 0 && /ทุบท้าย/.test(String(timeline[timeline.length - 1]));
}

// 🔧 19 ส.ค. 69 รอบ 3 (โซลรันเจอเคสกลับด้าน): จับคู่แผนจบกับมุมแบบ two-pass
//   รอบ 1: จอง exact ให้ครบทุกมุมก่อน — กันมุมที่มาก่อนแบบ contain แย่งใบที่เป็น exact ของมุมหลัง
//   รอบ 2: จ่าย contain จาก "ใบที่ยังว่าง" เท่านั้น — ใบที่เจอถูกจองแล้วให้ค้นใบว่างใบถัดไปต่อ ไม่ยอมแพ้กลางทาง
//   ใบเดียวจ่ายได้มุมเดียว (กันจบแฝด) · field ต้องเป็น string (กัน [object Object]) ·
//   ใบใช้ได้ = มีชื่อ + (แนวทางปิด หรือ ร่างประโยค) · คืน array ยาวเท่า angleNames — null = มุมนั้นใช้แผนกลาง
export function assignAngleClosings(closings, angleNames) {
  const names = Array.isArray(angleNames) ? angleNames : [];
  const results = names.map(() => null);
  try {
    const _str = (v) => (typeof v === 'string' ? v.trim() : '');
    const _norm = (v) => _str(v).replace(/\s+/g, '');
    const targets = names.map((n) => _norm(n));
    const usable = (Array.isArray(closings) ? closings : []).filter((c) =>
      c && typeof c === 'object' && !Array.isArray(c) && _norm(c.angle_name)
      && (_str(c.closing_direction) || _str(c.closing_sketch)));
    if (usable.length === 0) return results;
    const claimed = new Set();
    const take = (hit, matchType) => ({
      angle_name: _str(hit.angle_name),
      closing_direction: _str(hit.closing_direction),
      closing_sketch: _str(hit.closing_sketch),
      avoid_overlap: _str(hit.avoid_overlap),
      match_type: matchType,
    });
    // รอบ 1 — exact (หลัง normalize ช่องว่าง)
    targets.forEach((t, i) => {
      if (!t) return;
      const hit = usable.find((c) => !claimed.has(c) && _norm(c.angle_name) === t);
      if (hit) { claimed.add(hit); results[i] = take(hit, 'exact'); }
    });
    // รอบ 2 — contain เฉพาะมุมที่ยังไม่ได้แผน จากใบที่ยังว่าง
    targets.forEach((t, i) => {
      if (!t || results[i]) return;
      const hit = usable.find((c) => !claimed.has(c) && (_norm(c.angle_name).includes(t) || t.includes(_norm(c.angle_name))));
      if (hit) { claimed.add(hit); results[i] = take(hit, 'contain'); }
    });
    return results;
  } catch (err) {
    console.warn('[NarrativePayload] assignAngleClosings ล้ม — ทุกมุมถอยแผนกลาง:', err?.message || err);
    return names.map(() => null);
  }
}
