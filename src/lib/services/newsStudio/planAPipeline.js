/**
 * =====================================================
 * แผนพัฒนาที่ 1 (Plan A): "Full-254 DNA Architect & Scene-Partitioned Editorial Studio"
 * =====================================================
 * ขั้นตอนและโมเดลที่ใช้:
 *   ขั้นที่ 1 (Fact Ledger & Typo Sanitizer)        : OpenAI gpt-5.6-terra
 *   ขั้นที่ 2 (3-Door Scene-Partitioned Director)   : Anthropic claude-opus-5-5 (เห็นปกต้นแบบ 33 ใบครบทุกฟิลด์)
 *   ขั้นที่ 3 (Full-254 Teacher DNA & Essence Match): โค้ดสแกน 254 ใบ + OpenAI gpt-5.6-sol จับคู่ลึกพร้อม Card Essence
 *   ขั้นที่ 4 (Master Teacher-Rhythm Writer)        : Anthropic claude-opus-5-5 (เขียนตาม Scene Partition + กั๊กหมัดจบย่อหน้า 3)
 *   ขั้นที่ 5 (Fact/Form/Voice Audit & Polish)      : โค้ดตรวจแบบแผน + OpenAI gpt-5.6-sol ตรวจความจริง/สำนวน + claude-opus-5-5 เกลา
 */
import { loadEnrichedKnowledgeBase, formatFullAngleExemplars, formatTeacherCatalogForAI, rankTeachersByFullDNA } from './enrichedLibrary.js';
import { checkTeacherForm, lengthBudget, paragraphBudget } from '../teacherWriter.js';

export async function runPlanAPipeline({ rawText, hub, rootDir = 'C:/news-studio-dev', onProgress }) {
  const t0 = Date.now();
  const timings = {};
  const emit = (step, detail) => {
    try { onProgress?.({ plan: 'PlanA', step, detail, ms: Date.now() - t0 }); } catch {}
  };
  const timed = async (key, fn) => {
    const s = Date.now();
    try { return await fn(); } finally { timings[key] = Date.now() - s; }
  };

  const kb = loadEnrichedKnowledgeBase({ rootDir });

  // ── ขั้นที่ 1: Fact Ledger, Typo Sanitizer & Identity Anchor (gpt-5.6-terra) ──
  emit('step1_fact_ledger', 'สกัดบัญชีข้อเท็จจริง แก้คำสะกดผิด และแยกคำพูดตรง/คำบอกเล่าด้วย gpt-5.6-terra');
  const factLedger = await timed('step1_factLedger', () =>
    hub.callOpenAI({
      model: 'gpt-5.6-terra',
      effort: 'low',
      json: true,
      maxTokens: 3500,
      system: [
        'คุณคือบรรณาธิการตรวจสอบข้อเท็จจริงและคลีนต้นฉบับข่าวของเพจไวรัล',
        'หน้าที่ของคุณคืออ่านเนื้อข่าวดิบที่พนักงานส่งมา แล้วสกัด "บัญชีข้อเท็จจริง (Fact Ledger)" ที่แม่นยำ 100%:',
        '1. cleanedRawText: แก้เฉพาะคำสะกดผิดหรือพิมพ์ตกในเนื้อข่าวดิบ (เช่น "ค่าเช้า"->"ค่าเช่า", "บาทเดี่ยว"->"บาทเดียว", "สมัค"->"สมัคร", "ไมได้"->"ไม่ได้", "ป้าเจี้ยบ"->"ป้าเจี๊ยบ", "18ล้าน"->"18 ล้านบาท") โดยห้ามตัดหรือเพิ่มข้อเท็จจริงใดๆ',
        '2. identityAnchor: อธิบายตัวตนของคนหลักในข่าวสั้นๆ (เช่น เป็นใคร มีสถานะ/อาชีพอะไร หรือเกี่ยวข้องกับใคร) เพื่อให้นักเขียนปูในประโยคแรก คนอ่านที่ไม่รู้จักชื่อจะได้ไม่งง',
        '3. directQuotes: รายการคำพูดตรงของคนในข่าวที่มีอยู่จริงในเนื้อดิบ (ที่อนุญาตให้ใส่เครื่องหมายคำพูด "..." ได้)',
        '4. indirectStatements: รายการข้อมูลที่เป็นแค่คำบอกเล่าอ้อมในเนื้อดิบ (ที่ห้ามนักเขียนใส่เครื่องหมายคำพูด "..." เด็ดขาด เพราะไม่ใช่คำพูดตรง)',
        '5. numberBindings: ผูกตัวเลขทุกตัวในข่าวเข้ากับความหมายที่ถูกต้อง (เช่น {"number": "9 ปี", "meaning": "ระยะเวลารับราชการทหาร ไม่ใช่ระยะเวลาอ่านหนังสือสอบ"}) เพื่อกันนักเขียนสลับตัวเลข',
        '6. typoCorrections: รายการคำผิดที่แก้ไป เช่น ["ค่าเช้า -> ค่าเช่า"]',
        '7. primaryCategory: เลือก 1 จาก [ช่วยเหลือกัน, สู้ชีวิต, ดราม่าครอบครัว, ดราม่าสังคม, ข่าวเตือนใจ, ข่าวอาชญากรรม, ความรัก, อบอุ่นใจ, ฮีโร่ชาวบ้าน, ชีวิตพลิกผัน]',
        '8. secondaryCategories: เลือก 1-2 หมวดจากรายการเดียวกัน',
        '9. emotionalTags: เลือก 2-4 จาก [เห็นใจ, สงสาร, โกรธ, เดือด, ซึ้ง, ตื้นตัน, กลัว, ช็อก, ภูมิใจ, ชื่นชม, คาใจ, สงสัย, เศร้า, หดหู่, สนุก, ขำ, แค้น, อบอุ่น, สะเทือนใจ]',
        '10. conflictTags: เลือก 1-2 จาก [ความอยุติธรรม, การตัดสิน, การสูญเสีย, การต่อสู้, การเอาเปรียบ, ความผิดพลาด, การทรยศ, ความขัดแย้ง, การกดขี่, ความเหลื่อมล้ำ]',
        '11. narrativeArchetype: เลือก 1 จาก [สู้ชีวิต, ฮีโร่ชาวบ้าน, เปิดโปง, น้ำใจคนไทย, ชีวิตพลิกผัน, ดราม่าครอบครัว, ข่าวเตือนภัย, ความรักข้ามขีดจำกัด, ผู้ถูกกระทำ, คนดีที่โลกลืม]',
        '12. title: สรุปหัวข่าว 1 บรรทัด',
      ].join('\n'),
      user: `=== เนื้อข่าวดิบจากพนักงาน ===\n${rawText}\n=== จบเนื้อข่าวดิบ ===\n\nตอบเป็น JSON ตามโครงสร้างที่กำหนดเท่านั้น`,
    })
  );

  const cleanRaw = String(factLedger?.cleanedRawText || rawText).trim();

  // ── ขั้นที่ 2: 3-Door Scene-Partitioned Angle Director (claude-opus-5-5 + 33 Exemplars Full Anatomy) ──
  emit('step2_angle_director', 'ออกแบบ 3 มุมข่าวคนละประตู + แบ่งฉากย่อหน้า 1/2/3 + กั๊กหมัดจบย่อหน้า 3 ด้วย claude-opus-5-5');
  const exemplarCatalog = formatFullAngleExemplars(kb.exemplars);
  const direction = await timed('step2_angleDirector', () =>
    hub.callClaude({
      model: 'claude-opus-5-5',
      effort: 'high',
      thinking: true,
      json: true,
      maxTokens: 12000,
      system: [
        'คุณคือบรรณาธิการใหญ่ (Chief Angle Architect) ของเพจข่าวไวรัลระดับหลายล้านวิว',
        'คุณมี "คลังปกต้นแบบ 33 ใบ" พร้อมคำวิเคราะห์เชิงลึกว่าแต่ละปกเลือกหยิบจุดเล็กๆ จุดไหนมาหยุดสายตาคนอ่าน และแต่ละบรรทัดทำหน้าที่อะไร',
        '',
        'ภารกิจของคุณคือออกแบบ "3 ทิศทางข่าว (3 Angles)" ที่เมื่อเขียนออกมาแล้วต้องเป็นโพสต์คนละมุมอย่างแท้จริง (แก้ปัญหาเดิมที่ 3 เวอร์ชันเปลี่ยนแค่ประโยคเปิด แต่ย่อหน้า 2 เล่าเหมือนกันเป๊ะ และย่อหน้า 3 พูดซ้ำย่อหน้าแรก):',
        '',
        'กฎเหล็กในการออกแบบ 3 ทิศทาง:',
        '1. บังคับเข้าเรื่องจาก "3 ประตูที่ต่างกัน (3 Distinct Entry Doors)":',
        '   - มุมที่ 1 (doorType: "concrete_contrast"): เข้าจากสิ่งของ ตัวเลข หรือการกระทำรูปธรรมที่สวนทางกับภาพจำ/สถานะ (แนว a01, a03, a14, a26)',
        '   - มุมที่ 2 (doorType: "own_words_heart"): เข้าจากคำพูดจริงของเจ้าตัว หรือเหตุผลทางใจที่ทำให้คนอ่านอึ้ง/ตื้นตัน (แนว a02, a09, a20)',
        '   - มุมที่ 3 (doorType: "turning_point_bond"): เข้าจากจุดเปลี่ยนชีวิต เส้นทางความอดทน หรือความผูกพันของคนรอบข้างที่ประคองกันมา (แนว a07, a18, a25)',
        '2. แยกฉากรายย่อหน้า (Scene Partition) ไม่ให้ 3 เวอร์ชันเทข้อเท็จจริงก้อนเดียวกันซ้ำ:',
        '   - p1Hook: ย่อหน้าแรก (2-3 ประโยค) เปิดด้วยประเด็นไหน + ปูตัวตนคนในข่าวอย่างไรให้คนไม่รู้จักชื่อเข้าใจทันที',
        '   - p2SceneFocus: ย่อหน้ากลาง ขยายฉากหรือรายละเอียดชุดไหนเป็นแกนหลัก (แต่ละมุมต้องเลือกโฟกัสรายละเอียดคนละแง่มุม)',
        '   - p3ReservedPayoff: **หมัดจบย่อหน้าสุดท้าย (Payoff Holdback)** — เลือกข้อเท็จจริงจำเพาะ 1 จุด หรือคำพูดสั้นๆ ที่คมที่สุดในข่าว "กั๊กไว้ปล่อยในย่อหน้า 3 เท่านั้น" (ห้ามนำไปเล่าในย่อหน้า 1 หรือ 2 เด็ดขาด เพื่อไม่ให้ย่อหน้า 3 ต้องพูดซ้ำย่อหน้าแรก!)',
        '3. ห้ามแต่งคำพูดหรือข้อเท็จจริงที่ไม่มีในเนื้อข่าว คำใน mustKeep ต้องใช้คำที่สะกดถูกต้องตามเนื้อข่าวที่คลีนแล้ว',
        '',
        'ตอบเป็น JSON เท่านั้น:',
        '{"coreEvent": "เหตุการณ์หลักของข่าว 1 ประโยค", "angles": [{',
        '  "doorType": "concrete_contrast | own_words_heart | turning_point_bond",',
        '  "focus": "ประเด็นหลักที่ชูในมุมนี้ 1 ประโยค",',
        '  "coverLines": ["บรรทัดปก 1", "บรรทัดปก 2", "บรรทัดปก 3"],',
        '  "p1Hook": "แผนย่อหน้า 1: เปิดด้วยอะไร + แนะนำตัวตนใคร",',
        '  "p2SceneFocus": "แผนย่อหน้า 2: ขยายฉาก/รายละเอียดชุดไหนเป็นพิเศษ (ไม่เหวี่ยงแหเล่าทุกอย่างเหมือนมุมอื่น)",',
        '  "p3ReservedPayoff": "หมัดจบย่อหน้า 3 ที่กั๊กไว้ปล่อยท้ายสุด (ห้ามสปอยล์ในย่อหน้า 1-2)",',
        '  "mustKeep": ["คำสำคัญ/ตัวเลข/คำพูดที่ต้องมีในโพสต์ 3-5 รายการ"],',
        '  "exemplarIds": ["รหัสปกต้นแบบที่ใช้เป็นแนว 1-2 รหัส"],',
        '  "why": "ทำไมมุมนี้ถึงหยุดคนอ่านได้ตามหลักปกต้นแบบ"',
        '}]}',
      ].join('\n'),
      user: [
        `=== คลังปกต้นแบบ 33 ใบ (Full Anatomy) ===\n${exemplarCatalog}\n=== จบคลังปกต้นแบบ ===`,
        `=== บัญชีข้อเท็จจริงที่คลีนคำผิดแล้ว ===\nตัวตนคนในข่าว: ${factLedger.identityAnchor || '-'}\nคำพูดตรงที่ใช้ "..." ได้: ${JSON.stringify(factLedger.directQuotes || [])}\nตัวเลขและความหมายที่ถูกต้อง: ${JSON.stringify(factLedger.numberBindings || [])}`,
        `=== เนื้อข่าว (คลีนคำสะกดผิดแล้ว) ===\n${cleanRaw}\n=== จบเนื้อข่าว ===`,
      ].join('\n\n'),
    })
  );

  const angles = Array.isArray(direction?.angles) ? direction.angles.slice(0, 3) : [];

  // ── ขั้นที่ 3: Full-254 Teacher DNA & Card-Essence Matcher (gpt-5.6-sol) ──
  emit('step3_teacher_matcher', 'สแกนคลังครูครบ 254 ใบพร้อม Card Essence + จับคู่ลึกด้วย gpt-5.6-sol');
  const topCandidates = rankTeachersByFullDNA({
    teachers: kb.teachers,
    analysis: factLedger,
    angles,
    rawText: cleanRaw,
    topK: 48,
  });

  const teacherCatalogText = formatTeacherCatalogForAI(topCandidates, { includeOpenClose: true });
  const matchResult = await timed('step3_teacherMatcher', () =>
    hub.callOpenAI({
      model: 'gpt-5.6-sol',
      effort: 'medium',
      json: true,
      maxTokens: 5000,
      system: [
        'คุณคือหัวหน้าบรรณารักษ์และผู้เชี่ยวชาญโครงสร้างโพสต์ไวรัลของเพจ IG.dara',
        'คุณเห็นรายชื่อโพสต์ครูต้นแบบที่คัดกรองจากคลังครูทั้ง 254 ใบ พร้อมข้อมูลครบทุกมิติ:',
        '- DNA (จาก card-essences): บอกชัดว่าครูใบนี้เหมาะกับข่าวแบบไหน และมี "ท่าเด่น" อะไร',
        '- โครงเปิด (hookStyle) และ กลไกที่ทำให้ปัง (whyItWorks)',
        '- ประโยคเปิดจริง และ ประโยคปิดจริงของครู',
        '',
        'หน้าที่ของคุณ: จับคู่ "ครูต้นแบบ 1 ใบ ต่อ 1 ทิศทางข่าว" (รวม 3 ใบ ห้ามซ้ำกันเด็ดขาด และควรมีวิธีเปิดต่างกัน) โดยต้อง:',
        '1. เลือกครูที่ "โครงสร้างอารมณ์และท่าเด่น (DNA)" ส่งพลังให้ทิศทางนั้นมากที่สุด (ห้ามเลือกครูไว้อาลัยให้ข่าวที่ไม่มีผู้เสียชีวิตเด็ดขาด)',
        '2. สกัด rhythmBlueprint: อธิบายจังหวะการวางประโยคของครูใบนี้ (ย่อหน้า 1 เปิดอย่างไร, ย่อหน้า 2 เชื่อมอย่างไร, ย่อหน้า 3 ทิ้งท้ายอย่างไร) เพื่อให้นักเขียนเลียน "โครงสร้างและจังหวะ" โดยไม่ลอกคำคลิเช่',
        '3. ระบุ forbiddenTeacherWords: คำนาม/วลีเฉพาะเรื่องในโพสต์ครูที่ไม่มีในข่าวใหม่ (เช่น ชื่อคน ตัวเลข อาชีพ หรือคำเฉพาะของครู) ที่ห้ามนักเขียนเผลอลอกติดมาเด็ดขาด',
        '',
        'ตอบเป็น JSON เท่านั้น:',
        '{"matches": [{',
        '  "angleIndex": 0,',
        '  "teacherId": "รหัสครู เช่น fb_...",',
        '  "reason": "ทำไมท่าเด่นและกลไกของครูใบนี้ถึงเข้ากับมุมนี้ที่สุด",',
        '  "rhythmBlueprint": "พิมพ์เขียวจังหวะการเขียน 3 ย่อหน้าที่ถอดจากครูใบนี้",',
        '  "forbiddenTeacherWords": ["คำเฉพาะในโพสต์ครูที่ห้ามหลุดมาในข่าวใหม่"]',
        '}]}',
      ].join('\n'),
      user: [
        `=== เนื้อข่าว ===\n${cleanRaw}`,
        `=== 3 ทิศทางข่าวที่ต้องหาครูเข้าคู่ ===\n${angles.map((a, i) => `มุมที่ ${i + 1} (${a.doorType}): ${a.focus}\n  พาดปก: ${(a.coverLines || []).join(' / ')}\n  ย่อหน้า 1: ${a.p1Hook}\n  ย่อหน้า 2: ${a.p2SceneFocus}\n  หมัดจบย่อหน้า 3: ${a.p3ReservedPayoff}`).join('\n\n')}`,
        `=== คลังครูต้นแบบพร้อม DNA & ท่าเด่น (${topCandidates.length} ใบสูงสุดจาก 254 ใบ) ===\n${teacherCatalogText}`,
      ].join('\n\n'),
    })
  );

  // ผูกครูเข้ากับแต่ละมุม (มี fallback หาก AI ตอบ id ไม่ครบ)
  const usedIds = new Set();
  const paired = angles.map((angle, idx) => {
    const m = (matchResult?.matches || []).find((x) => Number(x.angleIndex) === idx) || (matchResult?.matches || [])[idx];
    let teacher = m?.teacherId ? kb.teachersById.get(String(m.teacherId)) : null;
    if (!teacher || usedIds.has(teacher.id)) {
      teacher = topCandidates.find((t) => !usedIds.has(t.id)) || kb.teachers[idx];
    }
    usedIds.add(teacher.id);
    return {
      angle,
      teacher,
      reason: m?.reason || teacher.cardEssence || '',
      rhythmBlueprint: m?.rhythmBlueprint || teacher.whyItWorks || '',
      forbiddenTeacherWords: Array.isArray(m?.forbiddenTeacherWords) ? m.forbiddenTeacherWords : [],
    };
  });

  // ── ขั้นที่ 4 & 5: เขียนด้วย claude-opus-5-5 + ตรวจด้วย gpt-5.6-sol & โค้ด + เกลาเฉพาะจุด ──
  emit('step4_writing', 'เขียน 3 เวอร์ชันพร้อมกันด้วย claude-opus-5-5 + ตรวจ Fact Ledger ด้วย gpt-5.6-sol');

  const versions = await timed('step4_writeAndAudit', () =>
    Promise.all(
      paired.map(async (item, idx) => {
        const { angle, teacher, reason, rhythmBlueprint, forbiddenTeacherWords } = item;
        const budget = lengthBudget(teacher.post);
        const pb = paragraphBudget(teacher.post);

        const buildWriterPrompt = (draftToFix = '', fixInstructions = []) => ({
          system: [
            'คุณคือหัวหน้านักเขียนของเพจข่าวไวรัล IG.dara (สไตล์แอดมิน Nisada) ที่เขียนโพสต์ยอดวิวหลักล้าน',
            'งานของคุณคือเขียนโพสต์ 3 ย่อหน้าจาก "เนื้อข่าวที่คลีนแล้ว" โดยยึด "แผนแยกฉาก 3 ย่อหน้า (Scene Partition)" เป็นแกนเรื่อง และใช้ "จังหวะการเล่าของโพสต์ครูต้นแบบ" เป็นโครงสร้างประโยค',
            '',
            'กฎเหล็ก 7 ข้อของ Plan A (ต้องทำตาม 100%):',
            '1. ย่อหน้า 1 (พาดหัวเปิดเรื่อง): ต้องสั้น กระชับ (2-3 ประโยค) เปิดตามแผน p1Hook และข้อความพาดปก ต้องระบุชื่อและปูตัวตนของคนในข่าวตาม identityAnchor ให้คนอ่านที่ไม่รู้จักชื่อเข้าใจทันทีภายในประโยคแรก ห้ามเกริ่นอ้อมๆ',
            '2. ย่อหน้า 2 (ขยายฉากเฉพาะมุมนี้): เล่าเฉพาะแง่มุมที่กำหนดใน p2SceneFocus ด้วยภาษาพูดธรรมชาติของแอดมินที่เล่าใหม่เอง (ห้ามยกประโยคยาวจากเนื้อดิบมาวางต่อกัน) และ **ห้ามนำหมัดจบที่กั๊กไว้ใน p3ReservedPayoff มาเล่าในย่อหน้า 1 หรือ 2 เด็ดขาด!**',
            '3. ย่อหน้า 3 (หมัดจบ Payoff Holdback): ปล่อยข้อเท็จจริงหรือคำพูดที่กั๊กไว้ใน p3ReservedPayoff เพื่อปิดเรื่องให้คมและมีความหมายแบบโพสต์ครู **ห้ามพูดวนซ้ำย่อหน้าแรก และห้ามจบด้วยคำคมสอนใจลอยๆ แบบ AI**',
            '4. ความแม่นยำของข้อเท็จจริงและเครื่องหมายคำพูด:',
            '   - ใส่เครื่องหมายคำพูด "..." ได้เฉพาะประโยคที่อยู่ใน directQuotes เท่านั้น! ข้อมูลที่เป็นคำบอกเล่าอ้อม (indirectStatements) ห้ามใส่เครื่องหมายคำพูดเด็ดขาด',
            '   - ตัวเลขทุกตัวต้องผูกกับเจ้าของ/ความหมายตาม numberBindings เท่านั้น ห้ามสลับที่ และห้ามตัดคำบอกขนาด เช่น "กว่า 130 ไร่"',
            '   - ห้ามเดาเพศถ้าข่าวไม่ระบุ และห้ามเติมฉาก สีหน้า หรือความรู้สึกที่ข่าวไม่ได้บอก',
            '5. ห้ามลอกคำเฉพาะจากโพสต์ครู: เลียนเฉพาะจังหวะและท่าเด่น (signatureMove) เท่านั้น ห้ามนำคำใน forbiddenTeacherWords หรือวลีคลิเช่ของครูมาใส่ในโพสต์ใหม่',
            '6. ห้ามใช้ภาษารายงานข่าวแข็งๆ: ห้ามใช้คำว่า "โดยระบุว่า", "เปิดเผยว่า", "ตน", "อีกฝ่าย", "คงสถานะคู่ชีวิต", "ทั้งนี้", "ท่ามกลางความ..." ให้ใช้ภาษาเล่าเรื่องของแอดมินที่เรียบง่ายและให้เกียรติคนในข่าว',
            '7. รูปแบบ: 3 ย่อหน้าพอดี คั่นด้วยบรรทัดว่าง 1 บรรทัด ห้ามใช้ขีดยาว (—) ห้ามใช้อีโมจิ ห้ามมีแฮชแท็ก ห้ามจบด้วยคำถามถึงคนอ่าน ใช้คำสุภาพแทนคำรุนแรง/เสียชีวิต (เช่น "จากไป")',
            '',
            'ตอบเฉพาะเนื้อโพสต์ 3 ย่อหน้าเท่านั้น ไม่ต้องมีหัวข้อหรือคำอธิบายใดๆ',
          ].join('\n'),
          user: [
            `=== โพสต์ครูต้นแบบที่เลียนจังหวะ (${teacher.name} · ${(Number(teacher.views || 0) / 1e6).toFixed(1)} ล้านวิว) ===\n${teacher.post}\n=== จบโพสต์ครู ===`,
            `=== พิมพ์เขียว DNA และท่าเด่นของครูใบนี้ (เลียนโครงสร้าง ห้ามลอกเนื้อหา) ===\n- DNA & ท่าเด่น: ${teacher.cardEssence || '-'}\n- โครงเปิด (hookStyle): ${teacher.hookStyle || '-'}\n- ทำไมโพสต์ครูถึงปัง: ${teacher.whyItWorks || '-'}\n- พิมพ์เขียวจังหวะ 3 ย่อหน้า: ${rhythmBlueprint}\n- คำจากโพสต์ครูที่ห้ามหลุดมาเด็ดขาด: ${forbiddenTeacherWords.join(', ') || '-'}`,
            `=== แผนแยกฉากของเวอร์ชันที่ ${idx + 1} (${angle.doorType}) ===\n- เหตุการณ์หลัก: ${direction.coreEvent || ''}\n- ประเด็นที่ชู: ${angle.focus}\n- พาดปก: ${(angle.coverLines || []).join(' / ')}\n- [ย่อหน้า 1 - p1Hook]: ${angle.p1Hook}\n- [ย่อหน้า 2 - p2SceneFocus]: ${angle.p2SceneFocus}\n- [ย่อหน้า 3 - p3ReservedPayoff (กั๊กไว้ปล่อยย่อหน้าสุดท้ายเท่านั้น ห้ามเล่าในย่อหน้า 1-2!)]: ${angle.p3ReservedPayoff}\n- คำ/ตัวเลขที่ต้องมี: ${(angle.mustKeep || []).join(' · ')}`,
            `=== บัญชีข้อเท็จจริง (Fact Ledger) ===\n- ตัวตนที่ต้องปูให้คนอ่านเข้าใจ: ${factLedger.identityAnchor || '-'}\n- คำพูดตรงที่ใช้ "..." ได้เท่านั้น: ${JSON.stringify(factLedger.directQuotes || [])}\n- ข้อมูลบอกเล่าอ้อม (ห้ามใส่ "..." เด็ดขาด): ${JSON.stringify(factLedger.indirectStatements || [])}\n- ตัวเลขและความหมายที่ห้ามสลับ: ${JSON.stringify(factLedger.numberBindings || [])}`,
            `=== เนื้อข่าวต้นฉบับ (คลีนคำผิดแล้ว) ===\n${cleanRaw}\n=== จบเนื้อข่าว ===`,
            draftToFix
              ? `=== ฉบับร่างก่อนหน้าที่ต้องเกลา ===\n${draftToFix}\n\n=== จุดที่ต้องแก้ไขให้ครบทุกข้อ ===\n${fixInstructions.map((f) => `- ${f}`).join('\n')}`
              : '',
            `งบความยาว: ทั้งโพสต์ต้องยาวประมาณ 165–220 คำ และไม่เกิน ${budget.maxChars} ตัวอักษร (ไม่นับช่องว่าง)${pb ? ` · ย่อหน้าแรกไม่เกิน ${pb.openingMax} ตัวอักษร · ย่อหน้าท้ายไม่เกิน ${pb.closingMax} ตัวอักษร` : ''}`,
          ].filter(Boolean).join('\n\n'),
        });

        let best = null;
        let prevContent = '';
        let prevFixNotes = [];

        for (let attempt = 1; attempt <= 2; attempt++) {
          const prompt = buildWriterPrompt(prevContent, prevFixNotes);
          const rawReply = await hub.callClaude({
            model: 'claude-opus-5-5',
            effort: 'medium',
            thinking: false,
            maxTokens: 8000,
            system: prompt.system,
            user: prompt.user,
          });
          const content = String(rawReply || '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

          // ตรวจด้วยโค้ด (ไม่บังคับ mustKeep ของย่อหน้า 3 ในย่อหน้า 1 เพื่อรักษา Payoff Holdback)
          const p1Text = (content.split(/\n\s*\n/)[0] || '').replace(/\s+/g, '');
          const compatMustKeep = (angle.mustKeep || []).filter(
            (m) => cleanRaw.replace(/\s+/g, '').includes(String(m).replace(/\s+/g, '')) && p1Text.includes(String(m).replace(/\s+/g, '').slice(0, 6))
          );
          const compatAngle = {
            core: direction.coreEvent || '',
            focus: angle.focus,
            coverLines: angle.coverLines || [],
            order: [angle.p1Hook, angle.p2SceneFocus, angle.p3ReservedPayoff].filter(Boolean),
            mustKeep: compatMustKeep,
          };
          const formCheck = checkTeacherForm(content, { rawText: cleanRaw, teacherPost: teacher.post, angle: compatAngle });

          // ตรวจความจริง + หมัดจบย่อหน้า 3 + เสียงแอดมิน ด้วย gpt-5.6-sol
          const audit = await hub.callOpenAI({
            model: 'gpt-5.6-sol',
            effort: 'low',
            json: true,
            maxTokens: 2500,
            system: [
              'คุณคือผู้ตรวจข้อเท็จจริงและคุณภาพการเขียนของเพจข่าวไวรัล (Fact, Voice & Payoff Auditor)',
              'ตรวจโพสต์เทียบกับ "เนื้อข่าวต้นฉบับ" และ "บัญชีข้อเท็จจริง (Fact Ledger)" ใน 4 มิติ:',
              '1. ข้อเท็จจริง (Fact Accuracy): มีข้อมูลมโนเพิ่มไหม? มีการเอาคำบอกเล่าอ้อมไปใส่เครื่องหมายคำพูด "..." ไหม? ตัวเลขสลับเจ้าของหรือความหมายเพี้ยนไหม? มีคำจากโพสต์ครูหลุดมาไหม?',
              '2. ความเข้าใจในรอบเดียว (Clarity): ย่อหน้าแรกบอกชัดไหมว่าใคร ทำอะไร เกิดอะไรขึ้น โดยคนไม่รู้จักชื่อมาก่อนก็เข้าใจทันที?',
              '3. หมัดจบย่อหน้า 3 (Payoff Holdback): ย่อหน้า 3 ใช้หมัดจบที่กั๊กไว้โดยไม่พูดซ้ำย่อหน้า 1 ใช่ไหม?',
              '4. น้ำเสียงแอดมิน (Admin Voice): มีคำภาษานักข่าวแข็งๆ (เช่น โดยระบุว่า, ตน, อีกฝ่าย, คงสถานะคู่ชีวิต) หรือคำผิดจากต้นฉบับหลุดมาไหม?',
              '',
              'ตอบเป็น JSON เท่านั้น:',
              '{"pass": true/false, "issues": [{"severity": "major|minor", "type": "fact|quote|closing|voice|clarity", "quote": "คำที่มีปัญหา", "fix": "วิธีแก้ให้ถูกต้อง"}]}',
            ].join('\n'),
            user: [
              `=== เนื้อข่าวต้นฉบับ ===\n${cleanRaw}`,
              `=== Fact Ledger ===\nคำพูดตรงที่ใช้ "..." ได้: ${JSON.stringify(factLedger.directQuotes || [])}\nตัวเลข: ${JSON.stringify(factLedger.numberBindings || [])}\nหมัดจบย่อหน้า 3 ที่กั๊กไว้: ${angle.p3ReservedPayoff}`,
              `=== โพสต์ที่ต้องตรวจ ===\n${content}`,
            ].join('\n\n'),
          });

          const majorIssues = (audit?.issues || []).filter((i) => i.severity === 'major');
          const fixNotes = [
            ...formCheck.fails.map((f) => f.message),
            ...majorIssues.map((i) => `[${i.type}] "${i.quote}" -> ${i.fix}`),
          ];
          const candidate = {
            content,
            attempts: attempt,
            formCheck,
            audit: { ...audit, majorCount: majorIssues.length, fixNotes },
            badness: formCheck.fails.length * 2 + majorIssues.length,
          };
          if (!best || candidate.badness <= best.badness) best = candidate;
          prevContent = content;
          prevFixNotes = fixNotes;

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
            reason,
            rhythmBlueprint,
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
    plan: 'Plan A — Full-254 DNA Architect & Scene-Partitioned Studio',
    modelsUsed: {
      step1_factLedger: 'gpt-5.6-terra',
      step2_angleDirector: 'claude-opus-5-5',
      step3_teacherMatcher: 'gpt-5.6-sol (Full 254 Card-Essence DNA)',
      step4_writer: 'claude-opus-5-5',
      step5_auditor: 'gpt-5.6-sol',
    },
    factLedger,
    direction,
    versions,
    timings: { ...timings, total: Date.now() - t0 },
  };
}
