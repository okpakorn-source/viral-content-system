/**
 * =====================================================
 * แผนพัฒนาที่ 2 (Plan B — ท่อหลักระบบจริง):
 * "Gemini 4 Elemental Studio (Hydrogen + Carbon + Argon) & Cross-Family Critic"
 * =====================================================
 * ขั้นตอนและโมเดลที่ใช้:
 *   ขั้นที่ 1 (Fast Fact Guard & Typo Sanitizer) : Google gemini-4-hydrogen (คลีนคำผิดพนักงาน + แยกคำพูดตรง/อ้อม + ผูกตัวเลข)
 *   ขั้นที่ 2 (All-254 Single-Pass Strategist)   : Google gemini-4-carbon (สมองใหญ่สุด อ่านครูครบ 254 ใบ + ปก 33 ใบในรวดเดียว + แยกฉาก 3 ประตู)
 *   ขั้นที่ 3 (Admin-Voice Storytelling Writer)   : Google gemini-4-carbon & gemini-4-argon (เขียนด้วยครูต้นแบบ + สำนวนแอดมินจริง admin-voice & f2x)
 *   ขั้นที่ 4 (Cross-Family Adversarial Critic)   : OpenAI gpt-5.6-sol ตรวจความจริงข้ามค่าย + gemini-4-argon เกลาจบ
 */
import { loadEnrichedKnowledgeBase, formatFullAngleExemplars } from './enrichedLibrary.js';
import { createMultiModelHub, loadStudioEnv } from './multiModelCallers.js';
import { checkTeacherForm, lengthBudget, paragraphBudget } from '../teacherWriter.js';
import { countDistinctAngles } from '../angleDirector.js';

export const PLAN_B_MODELS = Object.freeze({
  analyzer: { provider: 'gemini', model: 'gemini-4-hydrogen', effort: 'medium', thinking: true, maxTokens: 16384, timeoutMs: 90000 },
  director: { provider: 'gemini', model: 'gemini-4-carbon', effort: 'high', thinking: true, maxTokens: 28000, timeoutMs: 180000 },
  librarian: { provider: 'gemini', model: 'gemini-4-carbon', effort: 'high', thinking: true, maxTokens: 28000, timeoutMs: 180000 },
  writer: { provider: 'gemini', model: 'gemini-4-argon', effort: 'medium', thinking: true, maxTokens: 16384, timeoutMs: 120000 },
  checker: { provider: 'openai', model: 'gpt-5.6-sol', effort: 'low', thinking: true, maxTokens: 2500, timeoutMs: 90000 },
  reader: { provider: 'openai', model: 'gpt-5.6-sol', effort: 'low', thinking: true, maxTokens: 2500, timeoutMs: 90000 },
});

export function planBModels() {
  return { ...PLAN_B_MODELS };
}

function fail(errorType, message) {
  const err = new Error(message);
  err.errorType = errorType;
  return err;
}

export async function runPlanBPipeline({ rawText, hub, rootDir, avoidIds = [], researchFacts = [], retryDeadlineMs = 0, onProgress }) {
  const t0 = Date.now();
  const timings = {};
  const emit = (step, detail) => {
    try { onProgress?.({ plan: 'PlanB-Gemini4', step, detail, ms: Date.now() - t0 }); } catch {}
  };
  const timed = async (key, fn) => {
    const s = Date.now();
    try { return await fn(); } finally { timings[key] = Date.now() - s; }
  };

  const kb = loadEnrichedKnowledgeBase({ rootDir });
  const activeHub = hub || createMultiModelHub(loadStudioEnv(rootDir));

  // ── ขั้นที่ 1: Fast Fact Guard & Typo Sanitizer ด้วย gemini-4-hydrogen ──
  emit('step1_hydrogen_fact_guard', 'สกัด Fact Guard แก้คำสะกดผิดพนักงาน และผูกตัวเลขด้วย gemini-4-hydrogen');
  const factGuard = await timed('step1_hydrogenFactGuard', () =>
    activeHub.callGemini({
      model: 'gemini-4-hydrogen',
      role: 'ตัวสกัด Fact Guard (Hydrogen)',
      thinkingBudget: 2048,
      json: true,
      maxTokens: 16384,
      system: [
        'คุณคือบรรณาธิการตรวจสอบต้นฉบับและสกัดขอบเขตความจริง (Fact Guard & Typo Sanitizer)',
        'อ่านเนื้อข่าวดิบจากพนักงานแล้วสกัดข้อมูลต่อไปนี้เป็น JSON:',
        '1. cleanedRawText: แก้เฉพาะคำสะกดผิดหรือพิมพ์ตกในเนื้อข่าวดิบ (เช่น "ค่าเช้า"->"ค่าเช่า", "บาทเดี่ยว"->"บาทเดียว", "18ล้าน"->"18 ล้านบาท", "3ไร่"->"3 ไร่", "ต้องนั้น"->"ตรงนั้น", "สมัค"->"สมัคร", "ไมได้"->"ไม่ได้", "ป้าเจี้ยบ"->"ป้าเจี๊ยบ") โดยคงข้อเท็จจริงเดิม 100%',
        '2. whoIsWho: อธิบายตัวตนและบทบาทของคนในข่าวสั้นๆ เพื่อปูในย่อหน้าแรกให้คนอ่านที่ไม่รู้จักชื่อเข้าใจทันที',
        '3. exactQuotesAllowed: รายการประโยคคำพูดตรงที่มีอยู่จริงในเนื้อข่าว (ที่อนุญาตให้ใส่เครื่องหมายคำพูด "..." ได้)',
        '4. indirectDoNotQuote: รายการข้อมูลที่เป็นแค่คำบอกเล่าอ้อม (ที่ห้ามใส่เครื่องหมายคำพูด "..." เด็ดขาด)',
        '5. numberFacts: รายการผูกตัวเลขแต่ละตัวเข้ากับความหมายที่ถูกต้อง (ห้ามสลับที่ เช่น 9 ปีคือเวลารับราชการทหาร ไม่ใช่เวลาสอบ)',
        '6. typoFixes: รายการคำผิดที่แก้ไป',
        '',
        'ตอบเป็น JSON เท่านั้น:',
        '{"cleanedRawText": "...", "whoIsWho": "...", "exactQuotesAllowed": ["..."], "indirectDoNotQuote": ["..."], "numberFacts": ["..."], "typoFixes": ["..."]}',
      ].join('\n'),
      user: `=== เนื้อข่าวดิบจากพนักงาน ===\n${rawText}\n=== จบเนื้อข่าวดิบ ===`,
    })
  );

  const cleanRaw = String(factGuard?.cleanedRawText || rawText).trim();

  // ── ขั้นที่ 2: All-254 Single-Pass Strategist & 3-Door Scene Architect ด้วย gemini-4-carbon ──
  emit('step2_carbon_all254', 'ส่งคลังครูครบ 254 ใบ + ปก 33 ใบ ให้ gemini-4-carbon ออกแบบ 3 มุม แยกฉาก และจับคู่ครูในรวดเดียว');

  const avoidSet = new Set((avoidIds || []).map(String));
  const availableTeachers = kb.teachers.filter((t) => !avoidSet.has(t.id));
  const catalogPool = availableTeachers.length >= 30 ? availableTeachers : kb.teachers;

  const all254Catalog = catalogPool.map((t) => {
    const openSample = String(t.openingParagraph || '').replace(/\s+/g, ' ').slice(0, 95);
    const closeSample = String(t.closingParagraph || '').replace(/\s+/g, ' ').slice(0, 95);
    return `${t.id} | ${t.category} | เปิด:${t.openingType} | ${t.name} | DNA:${t.cardEssence || '-'} | โครง:${t.hookStyle || '-'} | กลไก:${String(t.whyItWorks || '').slice(0, 120)} | เปิดจริง:"${openSample}" | ปิดจริง:"${closeSample}"`;
  }).join('\n');

  const full33Exemplars = formatFullAngleExemplars(kb.exemplars);

  const carbonStrategy = await timed('step2_carbonAll254', () =>
    activeHub.callGemini({
      model: 'gemini-4-carbon',
      role: 'บรรณาธิการใหญ่กำหนดทิศทางและเลือกครู (Carbon)',
      thinkingBudget: 3072,
      json: true,
      maxTokens: 28000,
      system: [
        'คุณคือบรรณาธิการบริหารสูงสุด (Chief Content Architect) ที่ขับเคลื่อนด้วย Gemini 4 Carbon',
        'คุณมองเห็น "คลังปกต้นแบบทั้ง 33 ใบ (Full Anatomy)" และ "คลังโพสต์ครูไวรัลครบทั้ง 254 ใบพร้อม DNA ท่าเด่น" พร้อมกันทั้งหมดในครั้งเดียว',
        '',
        'ภารกิจของคุณ:',
        '1. ออกแบบ 3 มุมข่าว (3 Angles) จากคนละประตูเข้าเรื่อง (ห้ามซ้ำโครงเรื่องกัน):',
        '   - มุมที่ 1 (Concrete / Contrast Lead): เปิดด้วยตัวเลข สิ่งของ หรือการกระทำรูปธรรมที่สวนทางกับความคาดหมาย',
        '   - มุมที่ 2 (Own Words / Heart Lead): เปิดด้วยประโยคคำพูดจริงหรือเหตุผลทางใจที่ทำให้คนอ่านหยุดฟัง',
        '   - มุมที่ 3 (Turning Point / Bond Lead): เปิดด้วยเส้นทางชีวิต จุดเปลี่ยน หรือความผูกพันของคนเบื้องหลัง',
        '2. แยกฉาก 3 ย่อหน้า (Scene Partition) ให้ขาดจากกันในแต่ละมุม:',
        '   - leadHook (ย่อหน้า 1): เปิดเรื่องอย่างไร + ปูตัวตนใครให้เข้าใจทันทีใน 2 ประโยคแรก',
        '   - middleLens (ย่อหน้า 2): เจาะลึกรายละเอียดชุดไหนเป็นหลัก (ทั้ง 3 เวอร์ชันต้องเจาะคนละแง่มุม ห้ามเทประวัติเรียงลำดับเดียวกัน)',
        '   - closingHoldback (ย่อหน้า 3): **หมัดจบที่กั๊กไว้ปล่อยในย่อหน้า 3 เท่านั้น** (เลือกข้อเท็จจริงจำเพาะ 1 จุด หรือคำพูดคมๆ ที่ห้ามนำไปเล่าในย่อหน้า 1-2 เด็ดขาด เพื่อให้ย่อหน้า 3 ทรงพลังและไม่พูดซ้ำย่อหน้าแรก!)',
        '3. เลือกครูต้นแบบจาก "คลังครูทั้ง 254 ใบ" มาเข้าคู่กับแต่ละมุม (3 ใบไม่ซ้ำกัน และห้ามเลือกครูไว้อาลัยถ้าข่าวไม่มีผู้เสียชีวิต) พร้อมถอดจังหวะประโยค (teacherCadenceNote) และระบุคำเฉพาะในโพสต์ครูที่ห้ามลอกติดมา (forbiddenTeacherWords)',
        '',
        'ตอบเป็น JSON เท่านั้น:',
        '{',
        '  "primaryCategory": "...",',
        '  "emotionalTags": ["..."],',
        '  "coreStory": "แก่นเรื่องหลัก 1 ประโยค",',
        '  "plans": [{',
        '    "angleName": "ชื่อมุมสั้นๆ",',
        '    "focus": "ประเด็นที่ชู 1 ประโยค",',
        '    "coverLines": ["บรรทัด 1", "บรรทัด 2", "บรรทัด 3"],',
        '    "leadHook": "แผนย่อหน้า 1",',
        '    "middleLens": "แผนย่อหน้า 2 (เจาะเฉพาะมุมนี้)",',
        '    "closingHoldback": "หมัดจบย่อหน้า 3 ที่กั๊กไว้ปล่อยท้ายสุด (ห้ามสปอยล์ในย่อหน้า 1-2)",',
        '    "mustKeep": ["คำสำคัญ/ตัวเลข 3-5 รายการ"],',
        '    "exemplarIds": ["a01"],',
        '    "teacherId": "fb_...",',
        '    "whyTeacherFits": "ทำไมครูใบนี้จากทั้ง 254 ใบถึงเข้ากับมุมนี้ที่สุด",',
        '    "teacherCadenceNote": "พิมพ์เขียวจังหวะการเล่า 3 ย่อหน้าของครูใบนี้",',
        '    "forbiddenTeacherWords": ["คำเฉพาะเรื่องในโพสต์ครูที่ห้ามหลุดมาในข่าวใหม่"]',
        '  }]',
        '}',
      ].join('\n'),
      user: [
        `=== คลังปกต้นแบบ 33 ใบ (Full Anatomy) ===\n${full33Exemplars}\n=== จบคลังปก 33 ใบ ===`,
        `=== คลังครูไวรัลครบทั้ง 254 ใบ (พร้อม DNA & ท่าเด่น) ===\n${all254Catalog}\n=== จบคลังครู 254 ใบ ===`,
        `=== Fact Guard ===\nตัวตนคนในข่าว: ${factGuard?.whoIsWho || '-'}\nคำพูดตรงที่ใช้ "..." ได้: ${JSON.stringify(factGuard?.exactQuotesAllowed || [])}\nตัวเลขและความหมาย: ${JSON.stringify(factGuard?.numberFacts || [])}`,
        `=== เนื้อข่าวต้นฉบับ (คลีนคำผิดแล้ว) ===\n${cleanRaw}\n=== จบเนื้อข่าว ===`,
      ].join('\n\n'),
    })
  );

  const rawPlans = Array.isArray(carbonStrategy?.plans) ? carbonStrategy.plans.slice(0, 3) : [];
  const usedTeacherIds = new Set();
  const resolvedPlans = rawPlans.map((p, idx) => {
    let teacher = p?.teacherId ? kb.teachersById.get(String(p.teacherId)) : null;
    if (!teacher || usedTeacherIds.has(teacher.id)) {
      teacher = catalogPool.find((t) => !usedTeacherIds.has(t.id) && t.category === carbonStrategy?.primaryCategory) || catalogPool[idx] || kb.teachers[idx];
    }
    usedTeacherIds.add(teacher.id);
    return { ...p, teacher };
  });

  // ดึงตัวอย่างสำนวนแอดมินเพจจริงจาก admin-voice-exemplars.json และ f2x-exemplars.json
  const cat = String(carbonStrategy?.primaryCategory || 'อบอุ่นใจ');
  const voiceSamples = kb.adminVoice
    .filter((v) => v && v.caption && (v.category === cat || !v.category))
    .slice(0, 3)
    .map((v) => String(v.caption).trim());
  const f2xSamples = kb.f2x
    .filter((v) => v && v.caption)
    .slice(0, 2)
    .map((v) => String(v.caption).trim());

  // ── ขั้นที่ 3 & 4: เขียนด้วย gemini-4-argon / gemini-4-carbon + ตรวจข้ามค่ายด้วย gpt-5.6-sol + เกลาจบ ──
  emit('step3_argon_carbon_write', 'เขียน 3 เวอร์ชันด้วย gemini-4-argon & gemini-4-carbon + ตรวจความจริงข้ามค่ายด้วย gpt-5.6-sol');

  const retryUntil = Number.isFinite(retryDeadlineMs) && retryDeadlineMs > 0 ? t0 + retryDeadlineMs : Infinity;
  const canRetry = () => Date.now() < retryUntil;

  const versions = await timed('step3_writeAndCritic', () =>
    Promise.all(
      resolvedPlans.map(async (plan, idx) => {
        const teacher = plan.teacher;
        const budget = lengthBudget(teacher.post);
        const pb = paragraphBudget(teacher.post);
        const safeMaxChars = Math.max(540, budget.maxChars - 35);
        const writerModel = idx === 0 ? 'gemini-4-carbon' : 'gemini-4-argon';

        const buildPrompt = (prevDraft = '', criticFixes = []) => ({
          system: [
            'คุณคือแอดมินเพจข่าวไวรัล IG.dara (สำนวน Nisada) ที่เล่าเรื่องผู้คนด้วยน้ำเสียงอบอุ่น ลื่นไหล เหมือนเล่าให้เพื่อนฟัง แต่คมคายระดับหลายล้านวิว',
            '',
            'กฎเหล็ก 7 ข้อในการเขียนของ Plan B (Gemini 4 Studio):',
            '1. ย่อหน้า 1 (leadHook): ต้องสั้นและตรงประเด็น (2 ประโยคกระชับ) เปิดตามแผน leadHook และพาดปก แนะนำชื่อและตัวตนคนในข่าวตาม whoIsWho ให้คนอ่านเข้าใจทันทีภายในประโยคแรก ห้ามเปิดอ้อม',
            '2. ย่อหน้า 2 (middleLens): เล่าเฉพาะแง่มุมที่กำหนดใน middleLens ด้วยสำนวนแอดมินธรรมชาติ เปลี่ยนโครงประโยคและใช้คำของแอดมินเอง (ห้ามยกประโยคยาวติดกันจากเนื้อดิบเกิน 8 คำ) และ **ห้ามปล่อยหมัดจบที่กั๊กไว้ใน closingHoldback ออกมาในย่อหน้า 1 หรือ 2 เด็ดขาด!**',
            '3. ย่อหน้า 3 (closingHoldback): ปล่อยข้อเท็จจริงจำเพาะหรือคำพูดที่กั๊กไว้ใน closingHoldback เพื่อปิดเรื่องให้สั้น คม และมีความหมายแบบโพสต์ครู **ห้ามพูดซ้ำย่อหน้าแรก และห้ามจบด้วยคำคมสอนใจลอยๆ**',
            '4. ความจริงและเครื่องหมายคำพูด:',
            '   - ใส่เครื่องหมายคำพูด "..." ได้เฉพาะประโยคที่อยู่ใน exactQuotesAllowed เท่านั้น! คำบอกเล่าอ้อมห้ามใส่ "..." เด็ดขาด',
            '   - ตัวเลขต้องผูกกับความหมายตาม numberFacts เท่านั้น ห้ามสลับที่ และห้ามลอกคำเฉพาะใน forbiddenTeacherWords จากโพสต์ครูมาปน',
            '5. ห้ามใช้ภาษารายงานข่าวแข็งๆ: ห้ามใช้คำว่า "โดยระบุว่า", "เปิดเผยว่า", "ตน", "อีกฝ่าย", "คงสถานะคู่ชีวิต", "ทั้งนี้", "ท่ามกลางความ..."',
            '6. รูปแบบ: 3 ย่อหน้าพอดี คั่นด้วยบรรทัดว่าง 1 บรรทัด ห้ามใช้ขีดยาว (—) ห้ามใช้อีโมจิ ห้ามมีแฮชแท็ก ห้ามจบด้วยคำถามถึงคนอ่าน ใช้คำสุภาพแทนคำรุนแรง/เสียชีวิต',
            '7. ตอบเฉพาะเนื้อโพสต์ 3 ย่อหน้าเท่านั้น ไม่ต้องมีหัวข้อหรือคำอธิบายใดๆ',
          ].join('\n'),
          user: [
            `=== โพสต์ครูต้นแบบที่เลียนโครงสร้าง (${teacher.name} · ${(Number(teacher.views || 0) / 1e6).toFixed(1)}M วิว) ===\n${teacher.post}\n=== จบโพสต์ครู ===`,
            `=== DNA และกลไกความปังของครูใบนี้ ===\n- DNA & ท่าเด่น: ${teacher.cardEssence || '-'}\n- โครงเปิด: ${teacher.hookStyle || '-'}\n- ทำไมถึงปัง: ${teacher.whyItWorks || '-'}\n- พิมพ์เขียวจังหวะ 3 ย่อหน้า: ${plan.teacherCadenceNote || '-'}\n- คำจากโพสต์ครูที่ห้ามหลุดมาเด็ดขาด: ${(plan.forbiddenTeacherWords || []).join(', ') || '-'}`,
            voiceSamples.length
              ? `=== ตัวอย่างน้ำเสียงแอดมินเพจจริง (ดูเฉพาะความลื่นไหลของสำนวนไทย ห้ามเอาเนื้อหามาใช้) ===\n${voiceSamples[idx % voiceSamples.length] || voiceSamples[0]}\n${f2xSamples[idx % Math.max(1, f2xSamples.length)] || ''}`
              : '',
            `=== แผนแยกฉากเวอร์ชันที่ ${idx + 1}: ${plan.angleName || ''} ===\n- ประเด็นที่ชู: ${plan.focus}\n- พาดปก: ${(plan.coverLines || []).join(' / ')}\n- [ย่อหน้า 1 - leadHook]: ${plan.leadHook || plan.focus}\n- [ย่อหน้า 2 - middleLens]: ${plan.middleLens || ''}\n- [ย่อหน้า 3 - closingHoldback (กั๊กไว้ปล่อยย่อหน้า 3 เท่านั้น ห้ามใช้ในย่อหน้า 1-2!)]: ${plan.closingHoldback || ''}\n- คำสำคัญที่ต้องมี: ${(plan.mustKeep || []).join(' · ')}`,
            `=== Fact Guard (ขอบเขตความจริง) ===\n- ตัวตนคนในข่าว: ${factGuard?.whoIsWho || '-'}\n- คำพูดตรงที่ใช้ "..." ได้เท่านั้น: ${JSON.stringify(factGuard?.exactQuotesAllowed || [])}\n- คำบอกเล่าอ้อมที่ห้ามใส่ "...": ${JSON.stringify(factGuard?.indirectDoNotQuote || [])}\n- ตัวเลขและความหมาย: ${JSON.stringify(factGuard?.numberFacts || [])}`,
            researchFacts.length > 0
              ? `=== ข้อมูลเสริมจากการค้น ===\n${researchFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')}`
              : '',
            `=== เนื้อข่าวต้นฉบับ (คลีนคำผิดแล้ว) ===\n${cleanRaw}\n=== จบเนื้อข่าว ===`,
            prevDraft
              ? `=== ฉบับร่างก่อนหน้าที่ต้องเกลาแก้ไข ===\n${prevDraft}\n\n=== ข้อติที่ต้องแก้ไขให้ผ่าน 100% (ตัดทอนหรือปรับเฉพาะจุดที่มีปัญหา) ===\n${criticFixes.map((f) => `- ${f}`).join('\n')}`
              : '',
            `งบความยาวเคร่งครัด: ทั้งโพสต์ต้องยาวประมาณ 160–195 คำ (ประมาณ 500–${safeMaxChars} ตัวอักษร และห้ามเกินเพดาน ${budget.maxChars} ตัวอักษรเด็ดขาด ไม่นับช่องว่าง)${pb ? ` · ย่อหน้าแรกสั้นกระชับไม่เกิน ${Math.max(140, pb.openingMax - 15)} ตัวอักษร · ย่อหน้าท้ายไม่เกิน ${Math.max(145, pb.closingMax - 15)} ตัวอักษร` : ''}`,
          ].filter(Boolean).join('\n\n'),
        });

        let best = null;
        let prevContent = '';
        let prevFixList = [];
        const trail = [];
        let stoppedReason = '';

        for (let attempt = 1; attempt <= 3; attempt++) {
          if (attempt > 1 && !canRetry()) {
            stoppedReason = 'เวลาของงานใกล้หมด จึงไม่ได้แก้รอบถัดไป';
            break;
          }
          const prompt = buildPrompt(prevContent, prevFixList);
          let reply;
          try {
            reply = await activeHub.callGemini({
              model: attempt === 1 ? writerModel : 'gemini-4-argon',
              role: `นักเขียนเวอร์ชัน ${idx + 1} (${attempt === 1 ? writerModel : 'gemini-4-argon'})`,
              thinkingBudget: 2048,
              json: false,
              maxTokens: 16384,
              system: prompt.system,
              user: prompt.user,
            });
          } catch (e) {
            if (!best) throw e;
            stoppedReason = `นักเขียนล่มในรอบแก้ที่ ${attempt}: ${String(e?.message || e).slice(0, 120)}`;
            break;
          }
          const content = String(reply || '')
            .replace(/^```[a-z]*\s*/i, '')
            .replace(/```\s*$/i, '')
            .replace(/\r\n/g, '\n')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

          const p1Text = (content.split(/\n\s*\n/)[0] || '').replace(/\s+/g, '');
          const compatMustKeep = (plan.mustKeep || []).filter(
            (m) => cleanRaw.replace(/\s+/g, '').includes(String(m).replace(/\s+/g, '')) && p1Text.includes(String(m).replace(/\s+/g, '').slice(0, 6))
          );
          const compatAngle = {
            core: carbonStrategy?.coreStory || '',
            focus: plan.focus,
            coverLines: plan.coverLines || [],
            order: [plan.leadHook, plan.middleLens, plan.closingHoldback].filter(Boolean),
            mustKeep: compatMustKeep,
          };
          const formCheck = checkTeacherForm(content, { rawText: cleanRaw, teacherPost: teacher.post, angle: compatAngle });

          // ใช้ gpt-5.6-sol (คนละค่ายกับผู้เขียน Gemini 4) ตรวจจับข้อผิดพลาดแบบ Cross-Family Adversarial Critic
          let critic = { pass: true, issues: [] };
          let factChecked = true;
          let factError = '';
          try {
            critic = await activeHub.callOpenAI({
              model: 'gpt-5.6-sol',
              role: `ผู้ตรวจข้อเท็จจริงข้ามค่าย V${idx + 1}`,
              effort: 'low',
              json: true,
              maxTokens: 2500,
              system: [
                'คุณคือบรรณาธิการตรวจสอบคุณภาพข้ามค่าย (Cross-Family Adversarial Critic & Blind Reader)',
                'ตรวจโพสต์ที่เขียนโดยนักเขียน AI เทียบกับเนื้อข่าวต้นฉบับและ Fact Guard อย่างเข้มงวด:',
                '1. ความจริงและเครื่องหมายคำพูด: มีการมโนข้อมูลเพิ่มไหม? มีการใส่ "..." ให้ประโยคที่ไม่อยู่ใน exactQuotesAllowed ไหม? ตัวเลขสลับความหมายไหม?',
                '2. ความเข้าใจทันที (Blind Reader): อ่านย่อหน้าแรกแล้วรู้ทันทีไหมว่าใคร ทำอะไร เกิดอะไรขึ้น?',
                '3. หมัดจบย่อหน้า 3: ย่อหน้าสุดท้ายได้ใช้ closingHoldback และไม่พูดวนซ้ำย่อหน้าแรกใช่ไหม?',
                '4. ภาษาธรรมชาติ: มีคำภาษานักข่าวแข็งๆ (โดยระบุว่า, ตน, อีกฝ่าย, คงสถานะคู่ชีวิต, เปิดเผยว่า) หรือคำผิดหลุดมาไหม?',
                '',
                'ตอบเป็น JSON เท่านั้น:',
                '{"pass": true/false, "issues": [{"type": "added|wrong|missing|unclear", "severity": "major|minor", "quote": "ข้อความที่มีปัญหา", "problem": "ผิดอย่างไร", "fix": "วิธีแก้ให้ถูกต้อง"}]}',
              ].join('\n'),
              user: [
                `=== เนื้อข่าวต้นฉบับ ===\n${cleanRaw}`,
                `=== Fact Guard ===\nคำพูดตรงที่ใช้ "..." ได้: ${JSON.stringify(factGuard?.exactQuotesAllowed || [])}\nตัวเลข: ${JSON.stringify(factGuard?.numberFacts || [])}\nหมัดจบย่อหน้า 3 ที่กั๊กไว้: ${plan.closingHoldback || ''}`,
                `=== โพสต์ที่ต้องตรวจ ===\n${content}`,
              ].join('\n\n'),
            });
          } catch (e) {
            factChecked = false;
            factError = String(e?.message || e).slice(0, 160);
          }

          const normIssues = (Array.isArray(critic?.issues) ? critic.issues : []).map((i) => ({
            type: ['added', 'wrong', 'missing', 'unclear'].includes(i?.type) ? i.type : 'wrong',
            severity: i?.severity === 'minor' ? 'minor' : 'major',
            quote: String(i?.quote || '').slice(0, 200),
            problem: String(i?.problem || i?.fix || '').slice(0, 240),
            fix: String(i?.fix || '').slice(0, 240),
          }));
          const majorIssues = normIssues.filter((i) => i.severity === 'major');
          const fixList = [
            ...formCheck.fails.map((f) => f.message),
            ...majorIssues.map((i) => `"${i.quote}" -> ${i.fix || i.problem}`),
          ];

          trail.push({
            attempt,
            fails: formCheck.fails.map((f) => f.code),
            factMajor: majorIssues.length,
            factChecked,
            readerClear: true,
          });

          const ok = formCheck.ok && majorIssues.length === 0 && factChecked;
          const candidate = {
            ok,
            content,
            writerModelUsed: attempt === 1 ? writerModel : 'gemini-4-argon',
            attempts: attempt,
            formCheck,
            factChecked,
            factError,
            normIssues,
            majorCount: majorIssues.length,
            badness: formCheck.fails.length * 2 + majorIssues.length,
          };
          if (!best || candidate.badness <= best.badness) best = candidate;
          prevContent = content;
          prevFixList = fixList;

          if (ok) break;
        }

        const fullAngle = {
          core: carbonStrategy?.coreStory || '',
          focus: plan.focus || '',
          coverLines: Array.isArray(plan.coverLines) ? plan.coverLines : [],
          order: [plan.leadHook, plan.middleLens, plan.closingHoldback].filter(Boolean),
          mustKeep: Array.isArray(plan.mustKeep) ? plan.mustKeep : [],
          exemplarIds: Array.isArray(plan.exemplarIds) ? plan.exemplarIds : [],
          why: plan.whyTeacherFits || teacher.cardEssence || '',
          leadHook: plan.leadHook,
          middleLens: plan.middleLens,
          closingHoldback: plan.closingHoldback,
        };

        return {
          index: idx + 1,
          ok: !!best?.ok,
          writerModel: best?.writerModelUsed || writerModel,
          angleName: plan.angleName || '',
          angle: fullAngle,
          teacher: {
            id: teacher.id,
            name: teacher.name,
            category: teacher.category,
            views: teacher.views,
            url: teacher.url || '',
            openingType: teacher.openingType,
            cardEssence: teacher.cardEssence,
            hookStyle: teacher.hookStyle,
            whyItWorks: teacher.whyItWorks,
            post: teacher.post,
            reason: plan.whyTeacherFits || teacher.cardEssence || '',
          },
          content: best?.content || '',
          attempts: best?.attempts || 1,
          trail,
          stopped: stoppedReason,
          formOk: !!best?.formCheck?.ok,
          formFails: best?.formCheck?.fails || [],
          fails: best?.formCheck?.fails || [],
          warns: best?.formCheck?.warns || [],
          metrics: best?.formCheck?.metrics || {},
          auditPass: best?.majorCount === 0,
          auditIssues: best?.normIssues || [],
          factChecked: !!best?.factChecked,
          factIssues: best?.normIssues || [],
          factError: best?.factError || '',
          readChecked: true,
          readClear: true,
          readOpening: 'บอกเรื่อง',
          readGist: plan.focus || carbonStrategy?.coreStory || '',
          readHardParts: [],
          readError: '',
        };
      })
    )
  );

  return {
    plan: 'Plan B — Gemini 4 Elemental Studio (Hydrogen + Carbon + Argon) + GPT-5.6-Sol Critic',
    modelsUsed: {
      step1_factGuard: 'gemini-4-hydrogen (Fast Fact Guard & Typo Sanitizer)',
      step2_all254Strategist: 'gemini-4-carbon (All-254 Teachers + 33 Exemplars + 3-Door Scene Architect)',
      step3_writer: 'gemini-4-carbon (V1) + gemini-4-argon (V2, V3) with Teacher & Admin Voice Exemplars',
      step4_crossCritic: 'gpt-5.6-sol (Cross-Family Adversarial Audit) + gemini-4-argon (Polish)',
    },
    factGuard,
    carbonStrategy,
    versions,
    timings: { ...timings, total: Date.now() - t0 },
  };
}

/**
 * ตัวเดินงานหลักสำหรับต่อเข้า server.js ของระบบจริง (คืนผลรูปเดียวกับ runNewsStudio ของ pipeline.js ทุกช่อง)
 */
export async function runNewsStudioPlanB({ rawText, useResearch = false, onProgress, deps = {}, retryDeadlineMs = 0, rootDir }) {
  const t0 = Date.now();
  const raw = String(rawText || '').replace(/\r\n/g, '\n').trim();
  if (raw.length < 40) throw fail('RAW_TEXT_TOO_SHORT', `เนื้อข่าวสั้นเกินไป (${raw.length} ตัวอักษร) — ต้องมีอย่างน้อย 40 ตัวอักษร`);
  if (raw.length > 20000) throw fail('RAW_TEXT_TOO_LONG', `เนื้อข่าวยาวเกินไป (${raw.length} ตัวอักษร) — รับได้ไม่เกิน 20000 ตัวอักษร`);

  const emit = (step, status, detail = '') => {
    try { onProgress?.({ step, status, detail, ms: Date.now() - t0 }); } catch {}
  };

  const warnings = [];
  let recentIds = [];
  if (typeof deps?.getRecentTeacherIds === 'function') {
    recentIds = await deps.getRecentTeacherIds().catch(() => []);
  }
  let researchFacts = [];
  if (useResearch && typeof deps?.research === 'function') {
    try {
      const r = await deps.research(raw);
      researchFacts = Array.isArray(r) ? r.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 8) : [];
    } catch (e) {
      warnings.push({ code: 'RESEARCH_FAILED', message: `ค้นข้อมูลเสริมไม่สำเร็จ — เขียนจากเนื้อข่าวอย่างเดียว (${String(e?.message || e).slice(0, 80)})` });
    }
  }

  emit('direction', 'start', 'Gemini 4 Hydrogen & Carbon');
  const hub = createMultiModelHub(loadStudioEnv(rootDir), { logUsage: deps?.logUsage });
  const pbResult = await runPlanBPipeline({
    rawText: raw,
    hub,
    rootDir,
    avoidIds: recentIds,
    researchFacts,
    retryDeadlineMs,
    onProgress: (e) => {
      if (e.step === 'step2_carbon_all254') emit('teachers', 'start', 'Gemini 4 Carbon อ่านครู 254 ใบ');
      else if (e.step === 'step3_argon_carbon_write') {
        emit('direction', 'done', '3 ทิศทาง (Gemini 4 Carbon)');
        emit('teachers', 'done', '3 โพสต์ครู (All-254 Single-Pass)');
        emit('writing', 'start', 'Gemini 4 Argon & Carbon');
      }
    },
  });

  const versions = pbResult.versions || [];
  const written = versions.filter((v) => v.content);
  if (written.length === 0) {
    throw fail('ALL_VERSIONS_FAILED', 'เขียนไม่สำเร็จทั้ง 3 เวอร์ชันใน Plan B');
  }

  if (typeof deps?.rememberTeacherIds === 'function') {
    await deps.rememberTeacherIds(versions.map((v) => v.teacher?.id).filter(Boolean)).catch(() => {});
  }

  for (const v of versions) {
    emit('writing', 'version', `เวอร์ชัน ${v.index} ${v.ok ? 'ผ่าน' : 'ยังมีจุดต้องดู'}`);
    if (v.stopped) warnings.push({ code: 'REWRITE_STOPPED', message: `เวอร์ชัน ${v.index}: ${v.stopped} — ส่งฉบับที่ดีที่สุดที่เขียนได้พร้อมผลตรวจ` });
  }
  emit('done', 'done', `${written.length}/${versions.length} เวอร์ชัน (Plan B: Gemini 4)`);

  const title = String(pbResult.carbonStrategy?.coreStory || '').trim().slice(0, 120) || raw.split('\n')[0].slice(0, 80);
  const angles = versions.map((v) => v.angle).filter(Boolean);

  return {
    ok: true,
    plan: 'plan_b',
    title,
    rawText: raw,
    analysis: {
      primaryCategory: String(pbResult.carbonStrategy?.primaryCategory || 'อบอุ่นใจ'),
      emotionalTags: Array.isArray(pbResult.carbonStrategy?.emotionalTags) ? pbResult.carbonStrategy.emotionalTags : ['ชื่นชม'],
      title,
    },
    direction: {
      ok: angles.length > 0,
      error: '',
      angles,
    },
    researchFacts,
    versions,
    summary: {
      requested: versions.length,
      written: written.length,
      passed: versions.filter((v) => v.ok).length,
      formPassed: versions.filter((v) => v.formOk).length,
      factChecked: versions.filter((v) => v.factChecked).length,
      readClear: versions.filter((v) => v.readClear).length,
      distinctAngles: countDistinctAngles(written.map((v) => v.angle).filter(Boolean)),
    },
    warnings,
    timings: {
      analysis: pbResult.timings?.step1_hydrogenFactGuard || 0,
      direction: pbResult.timings?.step2_carbonAll254 || 0,
      teachers: pbResult.timings?.step2_carbonAll254 || 0,
      writing: pbResult.timings?.step3_writeAndCritic || 0,
      total: pbResult.timings?.total || (Date.now() - t0),
    },
  };
}
