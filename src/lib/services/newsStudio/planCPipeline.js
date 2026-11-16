/**
 * =====================================================
 * แผนพัฒนาที่ 3 (Plan C — ลูกผสม Best-of-Breed):
 * "Ultimate Hybrid Studio: Gemini 4 (Hydrogen + Carbon + Argon) × Claude Opus 5.5 × GPT-5.6-Sol"
 * =====================================================
 * รวมจุดแข็งที่สุดของทั้งสองแผนเข้าด้วยกัน:
 *   ขั้นที่ 1 (Ultra-Fast Fact Ledger & Typo Sanitizer) : gemini-4-hydrogen (คลีนคำผิด + ผูกตัวเลข + แยกคำพูดตรง/อ้อม ใน ~5 วินาที)
 *   ขั้นที่ 2 (All-254 Teacher Scout + 3-Door Architect): gemini-4-carbon (อ่านคลังครูครบ 254 ใบรวดเดียว) + claude-opus-5-5 (แยกฉาก 3 ประตู & กั๊กหมัดจบย่อหน้า 3)
 *   ขั้นที่ 3 (Dual-Master Writer & Editor Fusion)      : gemini-4-argon ร่างสำนวนไทยพริ้วไหว + claude-opus-5-5 เกลาโครงสร้างให้คมกริบตามจังหวะครูและงบตัวอักษรเป๊ะ
 *   ขั้นที่ 4 (Strict Fact/Form/Payoff Auditor)         : โค้ดตรวจแบบแผน + gpt-5.6-sol ตรวจความจริง/หมัดจบ
 */
import { loadEnrichedKnowledgeBase, formatFullAngleExemplars } from './enrichedLibrary.js';
import { checkTeacherForm, lengthBudget, paragraphBudget } from '../teacherWriter.js';

export async function runPlanCPipeline({ rawText, hub, rootDir = 'C:/news-studio-dev', onProgress }) {
  const t0 = Date.now();
  const timings = {};
  const emit = (step, detail) => {
    try { onProgress?.({ plan: 'PlanC-Hybrid', step, detail, ms: Date.now() - t0 }); } catch {}
  };
  const timed = async (key, fn) => {
    const s = Date.now();
    try { return await fn(); } finally { timings[key] = Date.now() - s; }
  };

  const kb = loadEnrichedKnowledgeBase({ rootDir });

  // ── ขั้นที่ 1: Ultra-Fast Fact Ledger & Typo Sanitizer ด้วย gemini-4-hydrogen ──
  emit('step1_hydrogen_fact_ledger', 'สกัด Fact Ledger แก้คำผิดพนักงาน และผูกตัวเลขด้วย gemini-4-hydrogen');
  const factLedger = await timed('step1_hydrogenFactLedger', () =>
    hub.callGemini({
      model: 'gemini-4-hydrogen',
      thinkingBudget: 2048,
      json: true,
      maxTokens: 16384,
      system: [
        'คุณคือบรรณาธิการตรวจสอบต้นฉบับและสกัดบัญชีข้อเท็จจริง (Fact Ledger & Typo Sanitizer)',
        'อ่านเนื้อข่าวดิบจากพนักงานแล้วสกัดข้อมูลต่อไปนี้เป็น JSON:',
        '1. cleanedRawText: แก้เฉพาะคำสะกดผิดหรือพิมพ์ตกในเนื้อข่าวดิบ (เช่น "ค่าเช้า"->"ค่าเช่า", "บาทเดี่ยว"->"บาทเดียว", "18ล้าน"->"18 ล้านบาท", "3ไร่"->"3 ไร่", "ต้องนั้น"->"ตรงนั้น", "ไมได้"->"ไม่ได้") โดยคงข้อเท็จจริงเดิม 100%',
        '2. identityAnchor: อธิบายตัวตนและบทบาทของคนในข่าวสั้นๆ เพื่อปูในย่อหน้าแรกให้คนอ่านเข้าใจทันที',
        '3. directQuotes: รายการประโยคคำพูดตรงที่มีอยู่จริงในเนื้อข่าว (ที่อนุญาตให้ใส่เครื่องหมายคำพูด "..." ได้)',
        '4. indirectStatements: รายการข้อมูลที่เป็นแค่คำบอกเล่าอ้อม (ที่ห้ามใส่เครื่องหมายคำพูด "..." เด็ดขาด)',
        '5. numberBindings: รายการผูกตัวเลขแต่ละตัวเข้ากับความหมายที่ถูกต้อง (ห้ามสลับที่ เช่น 9 ปีคือเวลารับราชการทหาร ไม่ใช่เวลาสอบ)',
        '6. typoFixes: รายการคำผิดที่แก้ไป',
        '',
        'ตอบเป็น JSON เท่านั้น:',
        '{"cleanedRawText": "...", "identityAnchor": "...", "directQuotes": ["..."], "indirectStatements": ["..."], "numberBindings": ["..."], "typoFixes": ["..."]}',
      ].join('\n'),
      user: `=== เนื้อข่าวดิบจากพนักงาน ===\n${rawText}\n=== จบเนื้อข่าวดิบ ===`,
    })
  );

  const cleanRaw = String(factLedger?.cleanedRawText || rawText).trim();

  // ── ขั้นที่ 2: All-254 Single-Pass Scout (gemini-4-carbon) + 3-Door Scene Architect (claude-opus-5-5) ──
  emit('step2_carbon_and_opus_architect', 'gemini-4-carbon อ่านครูครบ 254 ใบรวดเดียว + claude-opus-5-5 แยกฉาก 3 ประตูและล็อกหมัดจบย่อหน้า 3');

  const all254Catalog = kb.teachers.map((t) => {
    const openSample = String(t.openingParagraph || '').replace(/\s+/g, ' ').slice(0, 90);
    return `${t.id} | ${t.category} | เปิด:${t.openingType} | ${t.name} | DNA:${t.cardEssence || '-'} | โครง:${t.hookStyle || '-'} | เปิดจริง:"${openSample}"`;
  }).join('\n');

  const full33Exemplars = formatFullAngleExemplars(kb.exemplars);

  // ให้ gemini-4-carbon อ่านคลังครูครบ 254 ใบในครั้งเดียวเพื่อคัด Top 9 ครูที่ตรงกับข่าวนี้ที่สุดจากทั้ง 254 ใบ
  // ขนานไปกับ claude-opus-5-5 ที่ออกแบบ 3 ประตูแยกฉาก (3-Door Scene Partition + Payoff Holdback)!
  const [carbonScout, opusDirection] = await timed('step2_carbonScoutAndOpusArchitect', () =>
    Promise.all([
      hub.callGemini({
        model: 'gemini-4-carbon',
        thinkingBudget: 2560,
        json: true,
        maxTokens: 16384,
        system: [
          'คุณคือบรรณารักษ์ใหญ่ที่มองเห็นคลังโพสต์ครูไวรัลครบทั้ง 254 ใบพร้อมกันในครั้งเดียว',
          'อ่านเนื้อข่าวนี้ แล้วเลือกโพสต์ครูต้นแบบ 9 ใบจากทั้ง 254 ใบที่ "โครงเรื่อง น้ำหนักอารมณ์ และท่าเด่น (DNA)" เข้ากับข่าวนี้ที่สุด:',
          '- แบ่งเป็นครูที่เหมาะกับมุมตัวเลข/ความต่างรูปธรรม 3 ใบ, มุมคำพูดจริง/ความในใจ 3 ใบ, และมุมจุดเปลี่ยนชีวิต/คนเบื้องหลัง 3 ใบ',
          '- ห้ามเลือกครูไว้อาลัยให้ข่าวที่ไม่มีผู้เสียชีวิตเด็ดขาด',
          'ตอบเป็น JSON เท่านั้น: {"primaryCategory": "...", "topTeachers": [{"id": "fb_...", "forDoor": "concrete_contrast|own_words_heart|turning_point_bond", "why": "เหตุผลสั้นๆ"}]}',
        ].join('\n'),
        user: `=== คลังครูครบทั้ง 254 ใบ ===\n${all254Catalog}\n=== จบคลังครู 254 ใบ ===\n\n=== เนื้อข่าว ===\n${cleanRaw}`,
      }),
      hub.callClaude({
        model: 'claude-opus-5-5',
        effort: 'high',
        thinking: true,
        json: true,
        maxTokens: 12000,
        system: [
          'คุณคือบรรณาธิการใหญ่ (Chief 3-Door Scene Architect) ของเพจข่าวไวรัล',
          'ใช้คลังปกต้นแบบ 33 ใบ ออกแบบ "3 ทิศทางข่าวคนละประตู" ที่ไม่ซ้ำโครงเรื่องกัน และแบ่งฉากรายย่อหน้าอย่างเด็ดขาด:',
          '1. มุมที่ 1 (doorType: "concrete_contrast"): เข้าจากสิ่งของ ตัวเลข หรือการกระทำรูปธรรมที่สวนทางกับสถานะ',
          '2. มุมที่ 2 (doorType: "own_words_heart"): เข้าจากคำพูดจริงของเจ้าตัว หรือเหตุผลทางใจที่ทำให้คนอ่านอึ้ง/ตื้นตัน',
          '3. มุมที่ 3 (doorType: "turning_point_bond"): เข้าจากเส้นทางชีวิต จุดเปลี่ยน หรือความผูกพันของคนรอบข้างที่ประคองกันมา',
          '',
          'ในแต่ละมุม ต้องกำหนด Scene Partition ให้ขาดจากกัน:',
          '- p1Hook: ย่อหน้า 1 เปิดเรื่องอย่างไร + แนะนำตัวตนใครให้เข้าใจทันทีใน 2 ประโยคแรก',
          '- p2SceneFocus: ย่อหน้า 2 ขยายฉาก/รายละเอียดชุดไหนเป็นหลัก (ห้ามทั้ง 3 มุมเทข้อเท็จจริงเรียงลำดับเดียวกัน)',
          '- p3ReservedPayoff: **หมัดจบย่อหน้า 3 (Payoff Holdback)** — เลือกข้อเท็จจริงจำเพาะ 1 จุด หรือคำพูดสั้นๆ กั๊กไว้ปล่อยในย่อหน้า 3 เท่านั้น (ห้ามนำไปเล่าในย่อหน้า 1-2 เด็ดขาด!)',
          '',
          'ตอบเป็น JSON เท่านั้น:',
          '{"coreEvent": "...", "angles": [{"doorType": "concrete_contrast|own_words_heart|turning_point_bond", "focus": "...", "coverLines": ["...", "...", "..."], "p1Hook": "...", "p2SceneFocus": "...", "p3ReservedPayoff": "...", "mustKeep": ["..."], "exemplarIds": ["a01"]}]}',
        ].join('\n'),
        user: [
          `=== คลังปกต้นแบบ 33 ใบ (Full Anatomy) ===\n${full33Exemplars}\n=== จบคลังปก 33 ใบ ===`,
          `=== Fact Ledger ===\nตัวตนคนในข่าว: ${factLedger?.identityAnchor || '-'}\nคำพูดตรงที่ใช้ "..." ได้: ${JSON.stringify(factLedger?.directQuotes || [])}\nตัวเลขและความหมาย: ${JSON.stringify(factLedger?.numberBindings || [])}`,
          `=== เนื้อข่าว (คลีนคำผิดแล้ว) ===\n${cleanRaw}`,
        ].join('\n\n'),
      }),
    ])
  );

  const angles = Array.isArray(opusDirection?.angles) ? opusDirection.angles.slice(0, 3) : [];
  const scoutList = Array.isArray(carbonScout?.topTeachers) ? carbonScout.topTeachers : [];

  // จับคู่ครูที่ gemini-4-carbon คัดมาจากทั้ง 254 ใบ เข้ากับ 3 ประตูของ claude-opus-5-5
  const usedIds = new Set();
  const paired = angles.map((angle, idx) => {
    const matchFromDoor = scoutList.find((s) => s.forDoor === angle.doorType && kb.teachersById.has(s.id) && !usedIds.has(s.id));
    const matchAny = scoutList.find((s) => kb.teachersById.has(s.id) && !usedIds.has(s.id));
    const chosenId = matchFromDoor?.id || matchAny?.id;
    const teacher = (chosenId && kb.teachersById.get(chosenId)) || kb.teachers[idx];
    usedIds.add(teacher.id);
    return {
      angle,
      teacher,
      whyTeacher: matchFromDoor?.why || matchAny?.why || teacher.cardEssence,
    };
  });

  // ดึงตัวอย่างสำนวนแอดมินเพจจริง
  const cat = String(carbonScout?.primaryCategory || 'อบอุ่นใจ');
  const voiceSamples = kb.adminVoice
    .filter((v) => v && v.caption && (v.category === cat || !v.category))
    .slice(0, 3)
    .map((v) => String(v.caption).trim());

  // ── ขั้นที่ 3 & 4: Dual-Master Synthesis (gemini-4-argon ร่างสำนวนพริ้ว + claude-opus-5-5 เกลาความคมและคุมโครงสร้าง + gpt-5.6-sol ตรวจความจริง) ──
  emit('step3_dual_master_write', 'gemini-4-argon ร่างสำนวนพริ้วไหว + claude-opus-5-5 เกลาความคมและคุมงบตัวอักษร + gpt-5.6-sol ตรวจความจริง');

  const versions = await timed('step3_dualMasterWriteAndAudit', () =>
    Promise.all(
      paired.map(async (item, idx) => {
        const { angle, teacher, whyTeacher } = item;
        const budget = lengthBudget(teacher.post);
        const pb = paragraphBudget(teacher.post);

        // 3A: ให้ gemini-4-argon ร่างฉบับสำนวนไทยสละสลวยและกินใจตามแผนแยกฉาก 3 ประตู
        const argonDraft = await hub.callGemini({
          model: 'gemini-4-argon',
          thinkingBudget: 2048,
          json: false,
          maxTokens: 16384,
          system: [
            'คุณคือนักเล่าเรื่องมือเอกของเพจ IG.dara ขับเคลื่อนด้วย Gemini 4 Argon',
            'ร่างโพสต์ 3 ย่อหน้าที่มีสำนวนไทยสละสลวย ลื่นไหล อบอุ่นกินใจ โดยยึดแผนแยกฉาก (p1Hook -> p2SceneFocus -> p3ReservedPayoff) และเลียนจังหวะโพสต์ครูต้นแบบอย่างเคร่งครัด:',
            '- ย่อหน้า 1 เปิดให้ตรงตาม p1Hook และปูตัวตนคนในข่าวให้เข้าใจทันทีในประโยคแรก',
            '- ย่อหน้า 2 ขยายเฉพาะ p2SceneFocus ด้วยภาษาแอดมินเล่าเรื่องใหม่ (ห้ามปล่อยหมัดจบ p3ReservedPayoff ในย่อหน้า 1-2 เด็ดขาด!)',
            '- ย่อหน้า 3 ปล่อยหมัดจบ p3ReservedPayoff เพื่อขมวดจบให้ทรงพลังแบบครู โดยไม่พูดซ้ำย่อหน้าแรก',
            '- ใส่ "..." ได้เฉพาะคำพูดใน directQuotes เท่านั้น ห้ามสลับตัวเลข และห้ามใช้ภาษานักข่าวแข็งๆ',
            'ตอบเฉพาะเนื้อโพสต์ 3 ย่อหน้าเท่านั้น',
          ].join('\n'),
          user: [
            `=== โพสต์ครูต้นแบบ (${teacher.name}) ===\n${teacher.post}\nDNA & ท่าเด่น: ${teacher.cardEssence}\nทำไมถึงปัง: ${teacher.whyItWorks}`,
            voiceSamples[idx % Math.max(1, voiceSamples.length)]
              ? `=== ตัวอย่างความลื่นไหลของสำนวนแอดมิน ===\n${voiceSamples[idx % voiceSamples.length]}`
              : '',
            `=== แผนแยกฉากเวอร์ชันที่ ${idx + 1} (${angle.doorType}) ===\n- ประเด็นที่ชู: ${angle.focus}\n- พาดปก: ${(angle.coverLines || []).join(' / ')}\n- [ย่อหน้า 1]: ${angle.p1Hook}\n- [ย่อหน้า 2]: ${angle.p2SceneFocus}\n- [ย่อหน้า 3 (กั๊กไว้ปล่อยท้ายสุดเท่านั้น)]: ${angle.p3ReservedPayoff}`,
            `=== Fact Ledger ===\n- ตัวตนคนในข่าว: ${factLedger?.identityAnchor || '-'}\n- คำพูดตรงที่ใช้ "..." ได้: ${JSON.stringify(factLedger?.directQuotes || [])}\n- ตัวเลขและความหมาย: ${JSON.stringify(factLedger?.numberBindings || [])}`,
            `=== เนื้อข่าวต้นฉบับ (คลีนคำผิดแล้ว) ===\n${cleanRaw}`,
          ].filter(Boolean).join('\n\n'),
        });

        // 3B: ส่งร่างของ gemini-4-argon ให้ claude-opus-5-5 เกลาความคมกริบ ตัดคำฟุ่มเฟือย คุมงบความยาวรายย่อหน้าเป๊ะ และตรวจคู่กับ gpt-5.6-sol
        let best = null;
        let currentDraft = String(argonDraft || '').replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '').trim();
        let fixInstructions = [];

        for (let attempt = 1; attempt <= 2; attempt++) {
          const opusPolished = await hub.callClaude({
            model: 'claude-opus-5-5',
            effort: 'medium',
            thinking: false,
            maxTokens: 8000,
            system: [
              'คุณคือบรรณาธิการเกลาสำนวนขั้นสูงสุด (Master Editor — Claude Opus 5.5)',
              'คุณได้รับ "ฉบับร่างสำนวนพริ้วไหวจาก Gemini 4 Argon" หน้าที่ของคุณคือเกลาให้เป็นโพสต์ไวรัลที่สมบูรณ์แบบที่สุดตามกฎเหล็ก:',
              '1. รักษาความสละสลวยและอารมณ์ที่กินใจของฉบับร่างไว้ แต่ตัดคำฟุ่มเฟือยหรือคำเชื่อมเยิ่นเย้อออกให้ประโยคคมกริบ อ่านรอบเดียวเข้าใจทันที',
              '2. ตรวจให้มั่นใจว่าย่อหน้า 1 บอกชื่อ+ตัวตน+เหตุการณ์หลักชัดเจน, ย่อหน้า 2 เล่าเฉพาะฉาก p2SceneFocus (โดยไม่ก๊อปประโยคยาวติดกันจากเนื้อดิบเกิน 8 คำ), และย่อหน้า 3 ทิ้งหมัดจบด้วย p3ReservedPayoff โดยไม่พูดซ้ำย่อหน้า 1',
              '3. ความแม่นยำ 100%: ใช้ "..." ได้เฉพาะคำพูดตรงใน directQuotes เท่านั้น ห้ามใส่ "..." ให้คำบอกเล่าอ้อม ห้ามสลับความหมายตัวเลข ห้ามใช้คำว่า "โดยระบุว่า", "ตน", "อีกฝ่าย", "เปิดเผยว่า", "ทั้งนี้" และห้ามใช้ขีดยาว (—)',
              `4. คุมงบความยาวเคร่งครัด: ทั้งโพสต์ต้องมี 3 ย่อหน้าพอดี ความยาวรวมประมาณ 165–210 คำ และห้ามเกิน ${budget.maxChars} ตัวอักษรเด็ดขาด (ไม่นับช่องว่าง)${pb ? ` · ย่อหน้าแรกห้ามเกิน ${pb.openingMax} ตัวอักษร · ย่อหน้าท้ายห้ามเกิน ${pb.closingMax} ตัวอักษร` : ''}`,
              'ตอบเฉพาะเนื้อโพสต์ 3 ย่อหน้าที่เกลาเสร็จแล้วเท่านั้น',
            ].join('\n'),
            user: [
              `=== โพสต์ครูต้นแบบ (${teacher.name}) ===\n${teacher.post}\nDNA & ท่าเด่น: ${teacher.cardEssence}\nทำไมถึงปัง: ${teacher.whyItWorks}`,
              `=== แผนแยกฉากเวอร์ชันที่ ${idx + 1} (${angle.doorType}) ===\n- ประเด็นที่ชู: ${angle.focus}\n- พาดปก: ${(angle.coverLines || []).join(' / ')}\n- [ย่อหน้า 1]: ${angle.p1Hook}\n- [ย่อหน้า 2]: ${angle.p2SceneFocus}\n- [ย่อหน้า 3 (หมัดจบ)]: ${angle.p3ReservedPayoff}`,
              `=== Fact Ledger ===\n- ตัวตน: ${factLedger?.identityAnchor || '-'}\n- คำพูดตรงที่ใช้ "..." ได้เท่านั้น: ${JSON.stringify(factLedger?.directQuotes || [])}\n- ตัวเลขและความหมาย: ${JSON.stringify(factLedger?.numberBindings || [])}`,
              `=== เนื้อข่าวต้นฉบับ ===\n${cleanRaw}`,
              `=== ฉบับร่างที่ต้องเกลา ===\n${currentDraft}`,
              fixInstructions.length > 0
                ? `=== จุดที่ต้องแก้ไขเพิ่มเติมให้ผ่าน 100% ===\n${fixInstructions.map((f) => `- ${f}`).join('\n')}`
                : '',
            ].filter(Boolean).join('\n\n'),
          });

          const content = String(opusPolished || '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

          const p1Text = (content.split(/\n\s*\n/)[0] || '').replace(/\s+/g, '');
          const compatMustKeep = (angle.mustKeep || []).filter(
            (m) => cleanRaw.replace(/\s+/g, '').includes(String(m).replace(/\s+/g, '')) && p1Text.includes(String(m).replace(/\s+/g, '').slice(0, 6))
          );
          const compatAngle = {
            core: opusDirection?.coreEvent || '',
            focus: angle.focus,
            coverLines: angle.coverLines || [],
            order: [angle.p1Hook, angle.p2SceneFocus, angle.p3ReservedPayoff].filter(Boolean),
            mustKeep: compatMustKeep,
          };
          const formCheck = checkTeacherForm(content, { rawText: cleanRaw, teacherPost: teacher.post, angle: compatAngle });

          const audit = await hub.callOpenAI({
            model: 'gpt-5.6-sol',
            effort: 'low',
            json: true,
            maxTokens: 2500,
            system: [
              'คุณคือกรรมการตรวจสอบความจริงและคุณภาพขั้นสุดท้าย (gpt-5.6-sol Final Auditor)',
              'ตรวจโพสต์เทียบกับเนื้อข่าวต้นฉบับและ Fact Ledger:',
              '1. มีข้อมูลมโนเพิ่ม หรือใส่ "..." ให้คำพูดอ้อม หรือสลับความหมายตัวเลขไหม?',
              '2. ย่อหน้า 1 เข้าใจทันทีไหม และย่อหน้า 3 ปิดด้วยหมัดจบที่กั๊กไว้โดยไม่พูดซ้ำย่อหน้า 1 ใช่ไหม?',
              'ตอบเป็น JSON เท่านั้น: {"pass": true/false, "issues": [{"severity": "major|minor", "quote": "...", "fix": "..."}]}',
            ].join('\n'),
            user: `=== เนื้อข่าวต้นฉบับ ===\n${cleanRaw}\n\n=== Fact Ledger ===\nคำพูดตรง: ${JSON.stringify(factLedger?.directQuotes || [])}\nตัวเลข: ${JSON.stringify(factLedger?.numberBindings || [])}\n\n=== โพสต์ที่ตรวจ ===\n${content}`,
          });

          const majorIssues = (audit?.issues || []).filter((i) => i.severity === 'major');
          const nextFixes = [
            ...formCheck.fails.map((f) => f.message),
            ...majorIssues.map((i) => `"${i.quote}" -> ${i.fix}`),
          ];

          const candidate = {
            content,
            attempts: attempt,
            formCheck,
            audit: { ...audit, majorCount: majorIssues.length },
            badness: formCheck.fails.length * 2 + majorIssues.length,
          };
          if (!best || candidate.badness <= best.badness) best = candidate;
          currentDraft = content;
          fixInstructions = nextFixes;

          if (formCheck.ok && majorIssues.length === 0) break;
        }

        return {
          index: idx + 1,
          doorType: angle.doorType,
          angle,
          teacher: {
            id: teacher.id,
            name: teacher.name,
            category: teacher.category,
            views: teacher.views,
            openingType: teacher.openingType,
            cardEssence: teacher.cardEssence,
            hookStyle: teacher.hookStyle,
            whyItWorks: teacher.whyItWorks,
            reason: whyTeacher,
          },
          content: best.content,
          attempts: best.attempts,
          formOk: best.formCheck?.ok || false,
          formFails: best.formCheck?.fails || [],
          metrics: best.formCheck?.metrics || {},
          auditPass: best.audit?.pass && best.audit?.majorCount === 0,
          auditIssues: best.audit?.issues || [],
        };
      })
    )
  );

  return {
    plan: 'Plan C — Ultimate Best-of-Breed Hybrid (Gemini 4 Hydrogen/Carbon/Argon × Claude Opus 5.5 × GPT-5.6-Sol)',
    modelsUsed: {
      step1_factLedger: 'gemini-4-hydrogen (5s Fast Fact Ledger & Typo Sanitizer)',
      step2_scoutAndArchitect: 'gemini-4-carbon (All-254 Teacher Scout) × claude-opus-5-5 (3-Door Scene Architect)',
      step3_dualMasterWriter: 'gemini-4-argon (Emotional Storytelling Draft) → claude-opus-5-5 (Precision Structural Polish)',
      step4_finalAuditor: 'gpt-5.6-sol (Cross-Model Fact & Payoff Judge)',
    },
    factLedger,
    carbonScout,
    opusDirection,
    versions,
    timings: { ...timings, total: Date.now() - t0 },
  };
}
