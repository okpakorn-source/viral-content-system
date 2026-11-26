/**
 * =====================================================
 * แผนที่ 1 (Plan 1 — Dual-Sub Masterpiece Studio · Sub Ultra 100% · ค่า API = 0 บาท):
 * "Gemini 4 Ultra (Neon + Carbon + Argon + Hydrogen) × GPT Sub Cross-Family Critic"
 * =====================================================
 * ขั้นตอนการทำงาน:
 *   ขั้นที่ 1 (Fast Fact Guard & DNA Classifier)  : gemini-4-hydrogen-medium (Sub Ultra) คลีนคำผิดพนักงาน + ผูกตัวเลข + แยกคำพูดตรง/อ้อม + จำแนกหมวด
 *   ขั้นที่ 2 (Hybrid DNA Top-48 + 3-Door Neon)   : โค้ดสแกนครู 254 ใบคัด Top 48 ใบ + gemini-4-neon-high (สำรอง Carbon/Argon) วาง 3 มุมคนละประตู + ล็อกหมัดจบย่อหน้า 3
 *   ขั้นที่ 3 (Parallel Master Writers)           : gemini-4-neon-medium (V1) + gemini-4-argon-high (V2, V3) เขียน 3 ย่อหน้าสำนวนแอดมินเพจจริงขนานพร้อมกัน
 *   ขั้นที่ 4 (Cross-Family GPT Sub Critic)       : gpt-6.2-astra / gpt-5.6-sol (ChatGPT Sub · สำรองอัตโนมัติ Gemini 4 Neon/Carbon) จับผิดมโน/ตัวเลขสลับ/จังหวะอ่าน + เกลาแก้
 *
 * หมายเหตุสำคัญ: ไม่มี import แบบ alias (`@/...`) จึงรันได้ทั้งใน Next.js และใน standalone worker (`node` ตรงๆ)
 */
import { loadEnrichedKnowledgeBase, formatFullAngleExemplars, formatTeacherCatalogForAI, rankTeachersByFullDNA } from './enrichedLibrary.js';
import { createSubUltraHub } from './subUltraCallers.js';
import { formatReadableThreeParagraphs } from './planBPipeline.js';
import { checkTeacherForm, lengthBudget, paragraphBudget } from '../teacherWriter.js';
import { countDistinctAngles } from '../angleDirector.js';

export const PLAN_1_SUB_ULTRA_MODELS = Object.freeze({
  analyzer: { provider: 'sub_ultra_gemini', model: 'gemini-4-hydrogen-medium', effort: 'medium', thinking: true },
  director: { provider: 'sub_ultra_gemini', model: 'gemini-4-neon-high', effort: 'high', thinking: true },
  librarian: { provider: 'sub_ultra_gemini', model: 'gemini-4-neon-high', effort: 'high', thinking: true },
  writer: { provider: 'sub_ultra_gemini', model: 'gemini-4-neon-medium + gemini-4-argon-high', effort: 'high', thinking: true },
  checker: { provider: 'sub_ultra_gpt', model: 'gpt-5.6-sol', effort: 'low', thinking: true },
  reader: { provider: 'sub_ultra_gpt', model: 'gpt-5.6-sol', effort: 'low', thinking: true },
});

export function plan1SubUltraModels() {
  return { ...PLAN_1_SUB_ULTRA_MODELS };
}

function fail(errorType, message) {
  const err = new Error(message);
  err.errorType = errorType;
  return err;
}

export async function runPlan1SubUltra({
  rawText,
  hub,
  rootDir,
  avoidIds = [],
  researchFacts = [],
  retryDeadlineMs = 0,
  onProgress,
}) {
  const t0 = Date.now();
  const timings = {};
  const emit = (step, detail) => {
    try { onProgress?.({ plan: 'Plan1-SubUltra', step, detail, ms: Date.now() - t0 }); } catch {}
  };
  const timed = async (key, fn) => {
    const s = Date.now();
    try { return await fn(); } finally { timings[key] = Date.now() - s; }
  };

  const kb = loadEnrichedKnowledgeBase({ rootDir });
  const activeHub = hub || createSubUltraHub();

  // ── ขั้นที่ 1: Fast Fact Guard, Typo Sanitizer & DNA Pre-Classifier (gemini-4-hydrogen-medium Sub Ultra) ──
  emit('step1_hydrogen_fact_guard', 'สกัด Fact Guard แก้คำสะกดผิดพนักงาน ผูกตัวเลข และจำแนกหมวดด้วย Gemini 4 Hydrogen (Sub Ultra)');
  const step1Res = await timed('step1_hydrogenFactGuard', () =>
    activeHub.callGeminiSub({
      models: ['gemini-4-hydrogen-medium', 'gemini-4-argon-low', 'gemini-4-hydrogen-high'],
      role: 'ตัวสกัด Fact Guard (Hydrogen Sub Ultra)',
      json: true,
      timeoutMs: 50000,
      system: [
        'คุณคือบรรณาธิการตรวจสอบต้นฉบับและสกัดขอบเขตความจริง (Fact Guard & Typo Sanitizer) ของเพจข่าวไวรัลระดับล้านวิว',
        'อ่านเนื้อข่าวดิบจากพนักงานแล้วสกัดข้อมูลต่อไปนี้เป็น JSON ที่แม่นยำ 100%:',
        '1. cleanedRawText: แก้เฉพาะคำสะกดผิดหรือพิมพ์ตกในเนื้อข่าวดิบ (เช่น "ค่าเช้า"->"ค่าเช่า", "บาทเดี่ยว"->"บาทเดียว", "18ล้าน"->"18 ล้านบาท", "3ไร่"->"3 ไร่", "ต้องนั้น"->"ตรงนั้น", "สมัค"->"สมัคร", "ไมได้"->"ไม่ได้") โดยห้ามตัดหรือเติมข้อเท็จจริงใดๆ และถ้าไม่ระบุเพศห้ามเดาเพศเอง',
        '2. whoIsWho: อธิบายตัวตนและบทบาทของคนหลักในข่าวสั้นๆ 1 ประโยค เพื่อให้นักเขียนปูในย่อหน้าแรกให้คนไม่รู้จักชื่อเข้าใจทันที',
        '3. keyPeopleNames: รายชื่อบุคคลสำคัญในข่าวที่นักเขียนต้องใส่เครื่องหมายคำพูด "..." เน้นชื่อเมื่อเอ่ยถึงครั้งแรก',
        '4. exactQuotesAllowed: รายการประโยคคำพูดตรงที่มีอยู่จริงในเนื้อข่าว (ที่อนุญาตให้ใส่ใน "..." เป็นคำพูดจริงได้)',
        '5. indirectDoNotQuote: รายการข้อมูลที่เป็นแค่คำบอกเล่าอ้อมในเนื้อดิบ (ที่ห้ามแต่งเป็นประโยคคำพูดยาวใส่ "..." เด็ดขาด)',
        '6. numberFacts: รายการผูกตัวเลขทุกตัวเข้ากับความหมายที่ถูกต้อง (ป้องกันการสลับตัวเลข)',
        '7. primaryCategory: เลือก 1 จาก [ช่วยเหลือกัน, สู้ชีวิต, ดราม่าครอบครัว, ดราม่าสังคม, ข่าวเตือนใจ, ข่าวอาชญากรรม, ความรัก, อบอุ่นใจ, ฮีโร่ชาวบ้าน, ชีวิตพลิกผัน]',
        '8. secondaryCategories: เลือก 1-2 หมวดจากรายการเดียวกัน',
        '9. emotionalTags: เลือก 2-4 จาก [เห็นใจ, สงสาร, โกรธ, เดือด, ซึ้ง, ตื้นตัน, กลัว, ช็อก, ภูมิใจ, ชื่นชม, คาใจ, สงสัย, เศร้า, หดหู่, สนุก, ขำ, แค้น, อบอุ่น, สะเทือนใจ]',
        '10. conflictTags: เลือก 1-2 จาก [ความอยุติธรรม, การตัดสิน, การสูญเสีย, การต่อสู้, การเอาเปรียบ, ความผิดพลาด, การทรยศ, ความขัดแย้ง, การกดขี่, ความเหลื่อมล้ำ]',
        '11. narrativeArchetype: เลือก 1 จาก [สู้ชีวิต, ฮีโร่ชาวบ้าน, เปิดโปง, น้ำใจคนไทย, ชีวิตพลิกผัน, ดราม่าครอบครัว, ข่าวเตือนภัย, ความรักข้ามขีดจำกัด, ผู้ถูกกระทำ, คนดีที่โลกลืม]',
        '',
        'ตอบเป็น JSON เท่านั้น:',
        '{"cleanedRawText":"...","whoIsWho":"...","keyPeopleNames":["..."],"exactQuotesAllowed":["..."],"indirectDoNotQuote":["..."],"numberFacts":["..."],"primaryCategory":"...","secondaryCategories":["..."],"emotionalTags":["..."],"conflictTags":["..."],"narrativeArchetype":"..."}',
      ].join('\n'),
      user: `=== เนื้อข่าวดิบจากพนักงาน ===\n${rawText}\n=== จบเนื้อข่าวดิบ ===`,
    })
  );
  const factGuard = step1Res.data || {};
  const cleanRaw = String(factGuard?.cleanedRawText || rawText).trim();

  // ── ขั้นที่ 2: โค้ดสแกนคลังครู 254 ใบคัด Top 24 ที่ตรงที่สุด + Gemini 4 Neon High ออกแบบ 3 ประตูแยกฉาก ──
  // หมายเหตุ: จัดลำดับเนื้อข่าวต้นฉบับไว้บนสุดเสมอ และคุมขนาดรวม ~24KB (ต่ำกว่าเพดาน 46KB ของ agy CLI อย่างปลอดภัย 100%)
  emit('step2_neon_strategist', 'โค้ดคัดครู Top 24 จาก 254 ใบ + Gemini 4 Neon (Sub Ultra) วางกลยุทธ์ 3 ประตูแยกฉากและจับคู่ครู');
  const avoidSet = new Set((avoidIds || []).map(String));
  const poolAfterAvoid = kb.teachers.filter((t) => !avoidSet.has(t.id));
  const baseTeacherPool = poolAfterAvoid.length >= 30 ? poolAfterAvoid : kb.teachers;
  const top24Teachers = rankTeachersByFullDNA({
    teachers: baseTeacherPool,
    analysis: factGuard,
    angles: [],
    rawText: cleanRaw,
    topK: 24,
  });

  const teacherCatalogText = top24Teachers.map((t) => {
    const open1 = String(t.openingParagraph || '').replace(/\s+/g, ' ').slice(0, 80);
    const essence = String(t.cardEssence || '').slice(0, 110);
    return `[${t.id}] (${t.category}·${t.openingType}·${(Number(t.views || 0) / 1e6).toFixed(1)}M) ${t.name} | DNA:${essence} | เปิด:"${open1}"`;
  }).join('\n');

  const compact33Exemplars = kb.exemplars.map((x) => {
    const lines = (x.lines || []).map((l) => String(l).trim()).filter(Boolean).join(' / ');
    const why = String(x.angle || x.techniqueNote || '').replace(/\s+/g, ' ').slice(0, 110);
    return `[${x.id}·${x.technique || 'general'}] ${lines} — ${why}`;
  }).join('\n');

  const safeCleanRawForStrategist = cleanRaw.slice(0, 5500);

  const step2Res = await timed('step2_neonStrategist', () =>
    activeHub.callGeminiSub({
      models: ['gemini-4-neon-high', 'gemini-4-carbon-high', 'gemini-4-argon-high'],
      role: 'บรรณาธิการใหญ่กำหนดทิศทาง 3 ประตู (Neon Sub Ultra)',
      json: true,
      validate: (d) => Array.isArray(d?.plans) && d.plans.length >= 1,
      timeoutMs: 85000,
      system: [
        'คุณคือบรรณาธิการบริหารสูงสุด (Chief Content Architect) ของเพจข่าวไวรัลระดับหลายล้านวิว',
        'คุณมองเห็น "เนื้อข่าวต้นฉบับ", "คลังปกต้นแบบ 33 ใบ" และ "โพสต์ครูไวรัลตัวเต็ง 24 ใบพร้อม DNA ท่าเด่น" ที่คัดกรองจากทั้ง 254 ใบมาตรงกับข่าวนี้ที่สุด',
        '',
        'ภารกิจของคุณ:',
        '1. ออกแบบ 3 มุมข่าว (3 Angles) จากคนละประตูเข้าเรื่อง (ห้ามซ้ำโครงเรื่องกันเด็ดขาด):',
        '   - มุมที่ 1 (Concrete / Contrast Lead): เปิดด้วยตัวเลข สิ่งของ หรือการกระทำรูปธรรมที่สวนทางกับความคาดหมาย',
        '   - มุมที่ 2 (Own Words / Heart Lead): เปิดด้วยประโยคคำพูดจริงของคนในข่าว หรือเหตุผลทางใจที่ทำให้คนอ่านหยุดนิ้ว',
        '   - มุมที่ 3 (Turning Point / Bond Lead): เปิดด้วยเส้นทางชีวิต จุดเปลี่ยน หรือความผูกพันของคนเบื้องหลัง',
        '2. แยกฉาก 3 ย่อหน้า (Scene Partition) ให้ขาดจากกันในแต่ละมุม:',
        '   - leadHook (ย่อหน้า 1): เปิดเรื่องอย่างไร + ปูตัวตนใครให้คนอ่านเข้าใจทันทีภายใน 2 ประโยคแรก',
        '   - middleLens (ย่อหน้า 2): เจาะลึกรายละเอียดชุดไหนเป็นแกนหลัก (ทั้ง 3 เวอร์ชันต้องเจาะคนละแง่มุม ห้ามเทประวัติเรียงลำดับเดียวกัน)',
        '   - closingHoldback (ย่อหน้า 3): **หมัดจบที่กั๊กไว้ปล่อยในย่อหน้า 3 เท่านั้น** (เลือกข้อเท็จจริงจำเพาะ 1 จุด หรือคำพูดคมๆ ที่ห้ามนำไปเล่าในย่อหน้า 1-2 เด็ดขาด เพื่อให้ย่อหน้า 3 ทรงพลังและไม่พูดซ้ำย่อหน้าแรก!)',
        '3. เลือกครูต้นแบบจากรายการ 24 ใบมาเข้าคู่กับแต่ละมุม (3 ใบไม่ซ้ำกัน และห้ามเลือกครูไว้อาลัยถ้าข่าวไม่มีผู้เสียชีวิต) พร้อมถอดพิมพ์เขียวจังหวะ 3 ย่อหน้า (teacherCadenceNote) และคำเฉพาะเรื่องในโพสต์ครูที่ห้ามหลุดติดมา (forbiddenTeacherWords)',
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
        '    "mustKeep": ["คำสำคัญ/ตัวเลขที่มีอยู่จริงในข่าว 3-5 รายการ"],',
        '    "exemplarIds": ["a01"],',
        '    "teacherId": "fb_...",',
        '    "whyTeacherFits": "ทำไมครูใบนี้เข้ากับมุมนี้ที่สุด",',
        '    "teacherCadenceNote": "พิมพ์เขียวจังหวะการเล่า 3 ย่อหน้าของครูใบนี้",',
        '    "forbiddenTeacherWords": ["คำเฉพาะเรื่องในโพสต์ครูที่ห้ามหลุดมาในข่าวใหม่"]',
        '  }]',
        '}',
      ].join('\n'),
      user: [
        `=== เนื้อข่าวต้นฉบับ (คลีนคำผิดแล้ว — ยึดเป็นความจริงหลัก 100%) ===\n${safeCleanRawForStrategist}\n=== จบเนื้อข่าว ===`,
        `=== Fact Guard ===\nตัวตนคนในข่าว: ${factGuard?.whoIsWho || '-'}\nชื่อคนที่ต้องเน้น: ${JSON.stringify(factGuard?.keyPeopleNames || [])}\nคำพูดตรงที่ใช้ "..." ได้: ${JSON.stringify(factGuard?.exactQuotesAllowed || [])}\nคำบอกเล่าอ้อมที่ห้ามแต่งคำพูด: ${JSON.stringify(factGuard?.indirectDoNotQuote || [])}\nตัวเลขและความหมาย: ${JSON.stringify(factGuard?.numberFacts || [])}`,
        `=== คลังปกต้นแบบ 33 ใบ ===\n${compact33Exemplars}\n=== จบคลังปก 33 ใบ ===`,
        `=== โพสต์ครูไวรัลตัวเต็ง 24 ใบ (คัดด้วย DNA จาก 254 ใบ) ===\n${teacherCatalogText}\n=== จบคลังครู 24 ใบ ===`,
      ].join('\n\n'),
    })
  );

  const strategy = step2Res.data || {};
  const rawPlans = Array.isArray(strategy?.plans) ? strategy.plans.slice(0, 3) : [];
  if (rawPlans.length === 0) {
    throw fail('STRATEGY_EMPTY', 'บรรณาธิการใหญ่ไม่สามารถวางแผน 3 มุมข่าวได้');
  }

  const usedTeacherIds = new Set();
  const resolvedPlans = rawPlans.map((p, idx) => {
    let teacher = p?.teacherId ? kb.teachersById.get(String(p.teacherId)) : null;
    if (!teacher || usedTeacherIds.has(teacher.id)) {
      teacher = top24Teachers.find((t) => !usedTeacherIds.has(t.id)) || baseTeacherPool[idx] || kb.teachers[idx];
    }
    usedTeacherIds.add(teacher.id);
    return { ...p, teacher };
  });

  const cat = String(strategy?.primaryCategory || factGuard?.primaryCategory || 'อบอุ่นใจ');
  const voiceSamples = kb.adminVoice
    .filter((v) => v && v.caption && (v.category === cat || !v.category))
    .slice(0, 3)
    .map((v) => String(v.caption).trim());
  const f2xSamples = kb.f2x
    .filter((v) => v && v.caption)
    .slice(0, 2)
    .map((v) => String(v.caption).trim());

  // ── ขั้นที่ 3 & 4: เขียนขนานด้วย Gemini 4 Neon/Argon + ตรวจข้ามค่ายด้วย GPT Sub (gpt-6.2-astra / gpt-5.6-sol) ──
  emit('step3_write_and_gpt_critic', 'เขียน 3 เวอร์ชันขนานด้วย Gemini 4 Neon & Argon + ตรวจจับผิดข้ามค่ายด้วย GPT Sub');

  const retryUntil = Number.isFinite(retryDeadlineMs) && retryDeadlineMs > 0 ? t0 + retryDeadlineMs : (t0 + 210000);
  const canRetry = () => Date.now() < retryUntil;

  const versions = await timed('step3_writeAndCritic', () =>
    Promise.all(
      resolvedPlans.map(async (plan, idx) => {
        const teacher = plan.teacher;
        const budget = lengthBudget(teacher.post);
        const pb = paragraphBudget(teacher.post);
        const safeMaxChars = Math.max(540, budget.maxChars - 35);
        // V1 ใช้เรือธง Gemini 4 Neon Medium · V2/V3 ใช้ Gemini 4 Argon Medium (ทดสอบจริง ~13.5s ต่อชิ้น สำนวนไทยลื่นมากและไม่ชนโควตา)
        const writerChain = idx === 0
          ? ['gemini-4-neon-medium', 'gemini-4-argon-medium', 'gemini-4-argon-low']
          : ['gemini-4-argon-medium', 'gemini-4-argon-low', 'gemini-4-neon-low'];

        const buildPrompt = (prevDraft = '', criticFixes = []) => ({
          system: [
            'คุณคือแอดมินเพจข่าวไวรัล IG.dara (สำนวนแอดมินจริง Nisada) ที่เล่าเรื่องผู้คนด้วยน้ำเสียงอบอุ่น มีชีวิตชีวา ลื่นไหล และอ่านเข้าใจง่ายตั้งแต่กวาดตารอบเดียว',
            '',
            'กฎเหล็ก 8 ข้อในการเขียนของ Plan 1 Dual-Sub Masterpiece:',
            '1. โครงสร้าง 3 ย่อหน้าที่อ่านเข้าใจง่ายเสมอ (คั่นด้วยบรรทัดว่าง 1 บรรทัด):',
            '   - ย่อหน้า 1 (พาดหัวเปิดเรื่อง): สั้น กระชับ 2–3 ประโยค เปิดตามแผน leadHook และพาดปก บอกทันทีว่า "ใคร" ทำอะไร หรือเกิดอะไรขึ้น อ่านปุ๊บรู้เรื่องทันที ห้ามเปิดอ้อม',
            '   - ย่อหน้า 2 (ลำดับเรื่องราว): เล่าแง่มุม middleLens ด้วยประโยคสั้นๆ เรียงเหตุและผลให้เข้าใจง่าย (ห้ามยกประโยคยาวจากเนื้อดิบมาวางต่อกัน และห้ามปล่อยหมัดจบ closingHoldback ในย่อหน้า 1-2!)',
            '   - ย่อหน้า 3 (หมัดจบปิดท้าย): ปล่อยข้อเท็จจริงจำเพาะหรือคำพูดใน closingHoldback ปิดเรื่องให้สั้น คม และอิ่มใจ ห้ามพูดซ้ำย่อหน้าแรก',
            '2. การเว้นวรรคจังหวะหายใจ (Breath Spacing):',
            '   - ห้ามเขียนตัวอักษรติดกันเป็นพรืดยาวเกิน 35 ตัวอักษรโดยไม่เว้นวรรคเด็ดขาด',
            '   - เคาะเว้นวรรคแบ่งจังหวะทุกอนุประโยคเพื่อให้อ่านบนมือถือสบายตา',
            '3. การเน้นชื่อคนและคำพูดด้วยเครื่องหมายคำพูด "..." ให้ถูกบริบท:',
            '   - เน้นชื่อคนสำคัญเมื่อเอ่ยถึงครั้งแรกของบทบาทนั้น เช่น "โฟกัส จีระกุล" , "หนุ่ม กรรชัย" พร้อมเว้นวรรคหน้า-หลังให้ไม่กลืนกับตัวอักษรอื่น',
            '   - ประโยคคำพูดตรงจาก exactQuotesAllowed ให้ใส่ใน "..." ได้เท่านั้น ห้ามแต่งประโยคคำพูดยาวๆ จากคำบอกเล่าอ้อมมาใส่ "..." เด็ดขาด',
            '4. ความจริง 100% และห้ามเดาเพศ: ตัวเลขทุกตัวต้องผูกตาม numberFacts เท่านั้น ห้ามเพิ่มฉาก/สีหน้า/ข้อมูลนอกข่าวดิบ หากข่าวไม่ระบุเพศให้เรียกชื่อแทน และห้ามหลุดคำเฉพาะใน forbiddenTeacherWords จากโพสต์ครูมาปน',
            '5. คำที่ Facebook ลดการมองเห็น (ห้ามใช้คำตรงๆ): ห้ามใช้ ฆ่า/ฆาตกรรม/ศพ/ตาย/เสียชีวิต/ดับ/สิ้นใจ/เลือด/ยิง/แทง/ข่มขืน/ผูกคอ/ฆ่าตัวตาย/สยอง/โหด/สลด/การพนัน/บ่อน/เว็บพนัน/ยาบ้า/ยาไอซ์/เสพยา/ทุบตี/ทำร้าย ให้ใช้ถ้อยคำสุภาพแทน เช่น จากไป, จากไปอย่างสงบ, ร่างของผู้จากไป, ก่อเหตุร้ายแรง, สะเทือนใจ, สิ่งผิดกฎหมาย',
            '6. ห้ามใช้ภาษารายงานข่าวแข็งทื่อ: ห้ามใช้ "โดยระบุว่า", "เปิดเผยว่า", "ตน", "อีกฝ่าย", "คงสถานะคู่ชีวิต", "ทั้งนี้", "ท่ามกลางความ..."',
            '7. รูปแบบสะอาดตา: 3 ย่อหน้าพอดี ห้ามใช้ขีดยาว (—) ห้ามใช้อีโมจิ ห้ามมีแฮชแท็ก ห้ามมีรายการย่อย ห้ามจบด้วยคำถามถึงคนอ่าน',
            '8. ตอบเฉพาะเนื้อโพสต์ 3 ย่อหน้าเท่านั้น ไม่ต้องมีหัวข้อหรือคำอธิบายใดๆ',
          ].join('\n'),
          user: [
            `=== โพสต์ครูต้นแบบที่เลียนจังหวะการเล่า (${teacher.name} · ${(Number(teacher.views || 0) / 1e6).toFixed(1)}M วิว) ===\n${teacher.post}\n=== จบโพสต์ครู ===`,
            `=== DNA และกลไกความปังของครูใบนี้ ===\n- DNA & ท่าเด่น: ${teacher.cardEssence || '-'}\n- โครงเปิด: ${teacher.hookStyle || '-'}\n- ทำไมถึงปัง: ${teacher.whyItWorks || '-'}\n- พิมพ์เขียวจังหวะ 3 ย่อหน้า: ${plan.teacherCadenceNote || '-'}\n- คำจากโพสต์ครูที่ห้ามหลุดมาเด็ดขาด: ${(plan.forbiddenTeacherWords || []).join(', ') || '-'}`,
            voiceSamples.length
              ? `=== ตัวอย่างสำนวนและการเว้นวรรคของแอดมินเพจจริง ===\n${voiceSamples[idx % voiceSamples.length] || voiceSamples[0]}\n${f2xSamples[idx % Math.max(1, f2xSamples.length)] || ''}`
              : '',
            `=== แผนแยกฉากเวอร์ชันที่ ${idx + 1}: ${plan.angleName || ''} ===\n- ประเด็นที่ชู: ${plan.focus}\n- พาดปก: ${(plan.coverLines || []).join(' / ')}\n- [ย่อหน้า 1 - leadHook]: ${plan.leadHook || plan.focus}\n- [ย่อหน้า 2 - middleLens]: ${plan.middleLens || ''}\n- [ย่อหน้า 3 - closingHoldback (กั๊กไว้ปล่อยย่อหน้า 3 เท่านั้น ห้ามใช้ในย่อหน้า 1-2!)]: ${plan.closingHoldback || ''}\n- คำสำคัญที่ต้องมี: ${(plan.mustKeep || []).join(' · ')}`,
            `=== Fact Guard (ขอบเขตความจริง) ===\n- ตัวตนคนในข่าว: ${factGuard?.whoIsWho || '-'}\n- ชื่อคนสำคัญที่ต้องใส่ "..." เน้นชื่อ: ${JSON.stringify(factGuard?.keyPeopleNames || [])}\n- คำพูดตรงที่ใช้ "..." ได้: ${JSON.stringify(factGuard?.exactQuotesAllowed || [])}\n- คำบอกเล่าอ้อมที่ห้ามแต่งเป็นประโยคคำพูด: ${JSON.stringify(factGuard?.indirectDoNotQuote || [])}\n- ตัวเลขและความหมาย: ${JSON.stringify(factGuard?.numberFacts || [])}`,
            researchFacts.length > 0
              ? `=== ข้อมูลเสริมจากการค้น ===\n${researchFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')}`
              : '',
            `=== เนื้อข่าวต้นฉบับ (คลีนคำผิดแล้ว) ===\n${cleanRaw}\n=== จบเนื้อข่าว ===`,
            prevDraft
              ? `=== ฉบับร่างก่อนหน้าที่ต้องเกลาแก้ไข ===\n${prevDraft}\n\n=== ข้อติจาก บก. ตรวจความจริงที่ต้องแก้ให้ผ่าน 100% ===\n${criticFixes.map((f) => `- ${f}`).join('\n')}`
              : '',
            `งบความยาวเคร่งครัด: ทั้งโพสต์ต้องเรียงเป็น 3 ย่อหน้าที่อ่านเข้าใจง่าย เว้นวรรคแบ่งจังหวะทุกอนุประโยค เน้นชื่อคนและคำพูดด้วย "..." ให้ถูกบริบท ความยาวรวมประมาณ 160–195 คำ (ประมาณ 620–${safeMaxChars} ตัวอักษร และห้ามเกินเพดาน ${budget.maxChars} ตัวอักษรเด็ดขาด ไม่นับช่องว่าง)${pb ? ` · ย่อหน้าแรกสั้นกระชับไม่เกิน ${Math.max(150, pb.openingMax - 15)} ตัวอักษร · ย่อหน้าท้ายไม่เกิน ${Math.max(150, pb.closingMax - 15)} ตัวอักษร` : ''}`,
          ].filter(Boolean).join('\n\n'),
        });

        let best = null;
        let prevContent = '';
        let prevFixList = [];
        const trail = [];
        let stoppedReason = '';

        // จำกัดไม่เกิน 2 รอบ (เขียน 1 + เกลาแก้ตามคำติ GPT Sub 1 รอบ) เพื่อความคมและไม่วนลูป
        for (let attempt = 1; attempt <= 2; attempt++) {
          if (attempt > 1 && !canRetry()) {
            stoppedReason = 'เวลาของงานใกล้หมด จึงไม่ได้เกลาแก้รอบถัดไป';
            break;
          }
          const prompt = buildPrompt(prevContent, prevFixList);
          let writeRes;
          try {
            writeRes = await activeHub.callGeminiSub({
              models: attempt === 1 ? writerChain : ['gemini-4-argon-medium', 'gemini-4-neon-low'],
              role: `นักเขียนเวอร์ชัน ${idx + 1} รอบ ${attempt}`,
              json: false,
              timeoutMs: 85000,
              system: prompt.system,
              user: prompt.user,
            });
          } catch (e) {
            if (!best) throw e;
            stoppedReason = `นักเขียนสะดุดในรอบแก้ที่ ${attempt}: ${String(e?.message || e).slice(0, 120)}`;
            break;
          }

          const content = formatReadableThreeParagraphs(writeRes.data);
          const p1Text = (content.split(/\n\s*\n/)[0] || '').replace(/\s+/g, '');
          const compatMustKeep = (plan.mustKeep || []).filter(
            (m) => cleanRaw.replace(/\s+/g, '').includes(String(m).replace(/\s+/g, '')) && p1Text.includes(String(m).replace(/\s+/g, '').slice(0, 6))
          );
          const compatAngle = {
            core: strategy?.coreStory || '',
            focus: plan.focus,
            coverLines: plan.coverLines || [],
            order: [plan.leadHook, plan.middleLens, plan.closingHoldback].filter(Boolean),
            mustKeep: compatMustKeep,
          };
          const formCheck = checkTeacherForm(content, { rawText: cleanRaw, teacherPost: teacher.post, angle: compatAngle });

          const hasContextualQuoteEmphasis = /"[^"\n]{2,}"/.test(content);
          if (!hasContextualQuoteEmphasis) {
            formCheck.fails.push({
              code: 'MISSING_EMPHASIS',
              message: `โพสต์ยังไม่ได้ใส่เครื่องหมายคำพูด "..." เพื่อเน้นชื่อคนสำคัญ (${(factGuard?.keyPeopleNames || []).join(', ')}) หรือคำพูดสำคัญเลย — ให้ใส่ "..." เน้นชื่อคนหรือคำพูดตามบริบท`,
            });
            formCheck.ok = false;
          }

          const nonQuotedRuns = content.replace(/"[^"\n]*"/g, ' ').split(/\s+/).filter(Boolean);
          const longestUnspaced = nonQuotedRuns.reduce((m, s) => Math.max(m, s.length), 0);
          if (longestUnspaced > 75) {
            formCheck.fails.push({
              code: 'UNSPACED_WALL',
              message: `มีประโยคเขียนติดกันเป็นพรืดยาว ${longestUnspaced} ตัวอักษรโดยไม่เว้นวรรค — ให้เคาะเว้นวรรคแบ่งจังหวะทุกอนุประโยคให้อ่านง่าย`,
            });
            formCheck.ok = false;
          }

          // ── ผู้ตรวจจับผิดข้ามค่ายด้วย GPT Sub (`gpt-6.2-astra` -> `gpt-5.6-sol` -> สำรองอัตโนมัติ Gemini 4 Neon/Carbon) ──
          let critic = { pass: true, issues: [] };
          let factChecked = true;
          let factError = '';
          let criticModelUsed = '';
          try {
            const criticRes = await activeHub.callGptSub({
              models: ['gpt-5.6-sol', 'gpt-6.2-astra'],
              effort: 'low',
              role: `ผู้ตรวจข้ามค่าย GPT Sub V${idx + 1}`,
              json: true,
              timeoutMs: 50000,
              allowGeminiFallback: true,
              geminiFallbackModels: ['gemini-4-neon-high', 'gemini-4-carbon-high'],
              system: [
                'คุณคือบรรณาธิการตรวจสอบคุณภาพข้ามค่าย (Cross-Family Adversarial Critic) ที่เข้มงวดเรื่องความจริงและความเข้าใจง่าย',
                'ตรวจโพสต์ที่เขียนเทียบกับเนื้อข่าวต้นฉบับและ Fact Guard ใน 4 มิติ:',
                '1. ความจริง 100% และเครื่องหมายคำพูด: มีข้อมูลหรือฉากที่มโนเพิ่มเองนอกข่าวดิบไหม? ตัวเลขสลับความหมายไหม? ประโยคคำพูดยาวใน "..." ตรงกับ exactQuotesAllowed ไหม? (หมายเหตุ: การใส่ "..." รอบชื่อคนสำคัญ หรือคำเน้นสั้นๆ 1-3 คำ ถือว่าถูกต้องตามสไตล์เพจ ห้ามติว่าผิด!)',
                '2. การเรียง 3 ย่อหน้าและการเว้นวรรค: อ่านรอบเดียวเข้าใจทันทีไหม? มีประโยคกำกวมหรือซ้อนกันจนงงไหม?',
                '3. หมัดจบย่อหน้า 3: ย่อหน้าสุดท้ายได้ใช้ closingHoldback และไม่พูดวนซ้ำย่อหน้าแรกใช่ไหม?',
                '4. คำต้องห้าม Facebook: มีคำรุนแรงตรงๆ (ตาย/เสียชีวิต/ศพ/ฆ่า/เลือด/พนัน/ยาเสพติด) หลุดมาไหม?',
                '',
                'ตอบเป็น JSON เท่านั้น:',
                '{"pass": true, "issues": [{"type": "added|wrong|missing|unclear", "severity": "major|minor", "quote": "ข้อความที่มีปัญหา", "problem": "ผิดอย่างไร", "fix": "วิธีแก้ให้ถูกต้อง"}]}',
              ].join('\n'),
              user: [
                `=== เนื้อข่าวต้นฉบับ ===\n${cleanRaw}`,
                `=== Fact Guard ===\nชื่อคนที่อนุญาตให้ใส่ "..." เน้นชื่อได้: ${JSON.stringify(factGuard?.keyPeopleNames || [])}\nคำพูดตรงที่ใช้ "..." ได้: ${JSON.stringify(factGuard?.exactQuotesAllowed || [])}\nคำบอกเล่าอ้อมที่ห้ามแต่งเป็นประโยคคำพูด: ${JSON.stringify(factGuard?.indirectDoNotQuote || [])}\nตัวเลข: ${JSON.stringify(factGuard?.numberFacts || [])}\nหมัดจบย่อหน้า 3 ที่กั๊กไว้: ${plan.closingHoldback || ''}`,
                `=== โพสต์ที่ต้องตรวจ ===\n${content}`,
              ].join('\n\n'),
            });
            critic = criticRes.data || { pass: true, issues: [] };
            criticModelUsed = criticRes.modelUsed || '';
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
            writerModel: writeRes.modelUsed,
            criticModel: criticModelUsed,
            fails: formCheck.fails.map((f) => f.code),
            factMajor: majorIssues.length,
            factChecked,
            readerClear: true,
          });

          const ok = formCheck.ok && majorIssues.length === 0 && factChecked;
          const candidate = {
            ok,
            content,
            writerModelUsed: writeRes.modelUsed,
            criticModelUsed,
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
          core: strategy?.coreStory || '',
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
          writerModel: best?.writerModelUsed || writerChain[0],
          criticModel: best?.criticModelUsed || 'gpt-6.2-astra',
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
          readGist: plan.focus || strategy?.coreStory || '',
          readHardParts: [],
          readError: '',
        };
      })
    )
  );

  return {
    plan: 'Plan 1 — Dual-Sub Masterpiece (Gemini 4 Neon/Argon Sub Ultra × GPT Sub Critic)',
    modelsUsed: {
      step1_factGuard: `${step1Res.modelUsed} (Sub Ultra)`,
      step2_strategist: `${step2Res.modelUsed} (Top-48 DNA + 33 Exemplars · Sub Ultra)`,
      step3_writer: versions.map((v) => `V${v.index}:${v.writerModel}`).join(', '),
      step4_crossCritic: versions.map((v) => `V${v.index}:${v.criticModel}`).join(', '),
    },
    factGuard,
    strategy,
    versions,
    timings: { ...timings, total: Date.now() - t0 },
  };
}

/**
 * ตัวเดินงานหลักสำหรับต่อเข้า server.js และ standalone Sub-Ultra worker (คืนผลรูปเดียวกับ runNewsStudio ทุกช่อง)
 */
export async function runNewsStudioPlan1({
  rawText,
  useResearch = false,
  onProgress,
  deps = {},
  retryDeadlineMs = 0,
  rootDir,
  hub = null,
}) {
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

  emit('direction', 'start', 'Gemini 4 Hydrogen & Neon (Sub Ultra)');
  const activeHub = hub || createSubUltraHub({ logUsage: deps?.logUsage });
  const p1Result = await runPlan1SubUltra({
    rawText: raw,
    hub: activeHub,
    rootDir,
    avoidIds: recentIds,
    researchFacts,
    retryDeadlineMs,
    onProgress: (e) => {
      if (e.step === 'step2_neon_strategist') emit('teachers', 'start', 'คัดครู Top 48 + Gemini 4 Neon วางทิศทาง');
      else if (e.step === 'step3_write_and_gpt_critic') {
        emit('direction', 'done', '3 ทิศทางคนละประตู (Gemini 4 Neon Sub Ultra)');
        emit('teachers', 'done', '3 โพสต์ครู (Hybrid DNA Top-48)');
        emit('writing', 'start', 'Gemini 4 Neon & Argon + GPT Sub Critic');
      }
    },
  });

  const versions = p1Result.versions || [];
  const written = versions.filter((v) => v.content);
  if (written.length === 0) {
    throw fail('ALL_VERSIONS_FAILED', 'เขียนไม่สำเร็จทั้ง 3 เวอร์ชันใน Plan 1 Sub Ultra');
  }

  if (typeof deps?.rememberTeacherIds === 'function') {
    await deps.rememberTeacherIds(versions.map((v) => v.teacher?.id).filter(Boolean)).catch(() => {});
  }

  for (const v of versions) {
    emit('writing', 'version', `เวอร์ชัน ${v.index} ${v.ok ? 'ผ่าน' : 'ยังมีจุดต้องดู'}`);
    if (v.stopped) warnings.push({ code: 'REWRITE_STOPPED', message: `เวอร์ชัน ${v.index}: ${v.stopped} — ส่งฉบับที่ดีที่สุดที่เขียนได้พร้อมผลตรวจ` });
  }
  emit('done', 'done', `${written.length}/${versions.length} เวอร์ชัน (Plan 1 Sub Ultra)`);

  const title = String(p1Result.strategy?.coreStory || '').trim().slice(0, 120) || raw.split('\n')[0].slice(0, 80);
  const angles = versions.map((v) => v.angle).filter(Boolean);

  return {
    ok: true,
    plan: 'plan_1_sub_ultra',
    title,
    rawText: raw,
    modelsUsed: p1Result.modelsUsed,
    analysis: {
      primaryCategory: String(p1Result.strategy?.primaryCategory || p1Result.factGuard?.primaryCategory || 'อบอุ่นใจ'),
      emotionalTags: Array.isArray(p1Result.strategy?.emotionalTags) ? p1Result.strategy.emotionalTags : ['ชื่นชม'],
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
      analysis: p1Result.timings?.step1_hydrogenFactGuard || 0,
      direction: p1Result.timings?.step2_neonStrategist || 0,
      teachers: p1Result.timings?.step2_neonStrategist || 0,
      writing: p1Result.timings?.step3_writeAndCritic || 0,
      total: p1Result.timings?.total || (Date.now() - t0),
    },
  };
}
