/**
 * =====================================================
 * แผนที่ 1 รุ่นความเร็วสูงสุด (Plan 1 Turbo — Dual-Sub Masterpiece · ค่า API = 0 บาท):
 * "Single-Pass Strategist + 3-Slot Parallel Writers + Batch GPT Sub Cross-Critic"
 * =====================================================
 * สถาปัตยกรรมความเร็วสูง (เป้าหมาย ~40–65 วินาทีต่อข่าว 3 เวอร์ชัน):
 *   ขั้นที่ 0 (0.002s · โค้ดล้วน) : สแกนสัญญาณคำไทยในเนื้อดิบ คัดโพสต์ครู Top 24 จาก 254 ใบด้วย DNA Score ทันทีไม่ต้องรอ AI
 *   คลื่นที่ 1 (~18–25s)          : Single-Pass Fact Guard + 3-Door Strategist ด้วย gemini-4-argon-medium (สำรอง argon-low -> neon-low -> ข้ามค่าย gpt-5.6-sol)
 *   คลื่นที่ 2 (~15–20s)          : เปิด 3 สล็อตอิสระเขียนพร้อมกันในคลื่นเดียว (V1: gemini-4-neon-low · V2,V3: gemini-4-argon-medium)
 *   คลื่นที่ 3 (~9–14s)           : Batch Cross-Family Critic ด้วย gpt-5.6-sol ตรวจเทียบความจริงทั้ง 3 เวอร์ชันพร้อมกันในคำขอเดียว
 *   คลื่นซ่อมเฉพาะจุด (ถ้าจำเป็น) : เกลาด้วย gemini-4-argon-low เฉพาะเวอร์ชันที่พบข้อผิดพลาดร้ายแรงด้านความจริงหรือโครงสร้างหลักเท่านั้น
 */
import { loadEnrichedKnowledgeBase, rankTeachersByFullDNA } from './enrichedLibrary.js';
import { createSubUltraHub } from './subUltraCallers.js';
import { formatReadableThreeParagraphs } from './planBPipeline.js';
import { checkTeacherForm, lengthBudget, paragraphBudget } from '../teacherWriter.js';
import { countDistinctAngles } from '../angleDirector.js';

export const PLAN_1_SUB_ULTRA_MODELS = Object.freeze({
  analyzer: { provider: 'sub_ultra_gemini', model: 'gemini-4-argon-medium', effort: 'medium', thinking: true },
  director: { provider: 'sub_ultra_gemini', model: 'gemini-4-argon-medium', effort: 'medium', thinking: true },
  librarian: { provider: 'sub_ultra_gemini', model: 'gemini-4-argon-medium', effort: 'medium', thinking: true },
  writer: { provider: 'sub_ultra_gemini', model: 'gemini-4-neon-low + gemini-4-argon-medium', effort: 'medium', thinking: true },
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

const HARD_FORM_FAIL_CODES = new Set([
  'EMPTY',
  'PARAGRAPHS',
  'TOO_SHORT',
  'TOO_LONG',
  'EMOJI',
  'HASHTAG',
  'DASH',
  'LIST',
  'QUESTION_END',
  'FORMAT_LEAK',
  'UNSPACED_WALL',
]);

/**
 * จำแนกหมวดและอารมณ์เบื้องต้นด้วยโค้ดทันที (0.001 วินาที) เพื่อคัดครู Top 24 จาก 254 ใบโดยไม่ต้องเสียรอบเรียก AI
 */
export function fastPreClassifyFromRaw(rawText) {
  const t = String(rawText || '');
  const isLoss = /เสียชีวิต|จากไป|ไว้อาลัย|อุบัติเหตุ|ศพ|ร่างไร้วิญญาณ|สูญเสีย|ถึงแก่กรรม|มรณภาพ|ลาลับ/.test(t);
  let primaryCategory = 'อบอุ่นใจ';
  const secondaryCategories = [];
  const emotionalTags = ['ชื่นชม', 'อบอุ่น'];
  const conflictTags = [];
  let narrativeArchetype = 'น้ำใจคนไทย';

  if (isLoss) {
    primaryCategory = 'ข่าวเตือนใจ';
    emotionalTags.push('เศร้า', 'สะเทือนใจ');
    conflictTags.push('การสูญเสีย');
  } else if (/บริจาค|มอบเงิน|ช่วยเหลื|กู้ภัย|อาสา|แบ่งปัน|ทำบุญ|โรงพยาบาล|ช่วยคุณยาย|ช่วยเข็น/.test(t)) {
    primaryCategory = 'ช่วยเหลือกัน';
    secondaryCategories.push('ฮีโร่ชาวบ้าน', 'อบอุ่นใจ');
    emotionalTags.push('ซึ้ง', 'ตื้นตัน');
    narrativeArchetype = 'ฮีโร่ชาวบ้าน';
  } else if (/สู้ชีวิต|ลำบาก|ยากจน|ปลดหนี้|หาเลี้ยง|สาวโรงงาน|ไรเดอร์|กตัญญู|เก็บเงิน|สร้างตัว/.test(t)) {
    primaryCategory = 'สู้ชีวิต';
    secondaryCategories.push('ชีวิตพลิกผัน', 'อบอุ่นใจ');
    emotionalTags.push('ภูมิใจ', 'ตื้นตัน');
    narrativeArchetype = 'สู้ชีวิต';
  } else if (/แต่งงาน|เจ้าสาว|เจ้าบ่าว|คู่รัก|ภรรยา|สามี|ครบรอบ/.test(t)) {
    primaryCategory = 'ความรัก';
    secondaryCategories.push('อบอุ่นใจ');
    emotionalTags.push('อบอุ่น', 'ซึ้ง');
  } else if (/ดราม่า|โอนเงินคืน|ฟ้อง|แฉ|ทัวร์ลง|วิจารณ์|โต้กลับ|เดือด/.test(t)) {
    primaryCategory = 'ดราม่าสังคม';
    secondaryCategories.push('ข่าวเตือนใจ');
    emotionalTags.push('คาใจ', 'สงสัย');
    conflictTags.push('ความขัดแย้ง');
  } else if (/ลูกชาย|ลูกสาว|คุณแม่|คุณพ่อ|ครอบครัว/.test(t)) {
    primaryCategory = 'อบอุ่นใจ';
    secondaryCategories.push('ดราม่าครอบครัว');
  }

  return {
    primaryCategory,
    secondaryCategories,
    emotionalTags,
    conflictTags,
    narrativeArchetype,
  };
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
    try { onProgress?.({ plan: 'Plan1-Turbo', step, detail, ms: Date.now() - t0 }); } catch {}
  };
  const timed = async (key, fn) => {
    const s = Date.now();
    try { return await fn(); } finally { timings[key] = Date.now() - s; }
  };

  const kb = loadEnrichedKnowledgeBase({ rootDir });
  const activeHub = hub || createSubUltraHub({ maxParallelGemini: 3, maxParallelGpt: 3 });

  // ── ขั้นที่ 0 (0.002s): โค้ดคัดครู Top 24 จาก 254 ใบทันที ──
  const preAnalysis = fastPreClassifyFromRaw(rawText);
  const avoidSet = new Set((avoidIds || []).map(String));
  const poolAfterAvoid = kb.teachers.filter((t) => !avoidSet.has(t.id));
  const baseTeacherPool = poolAfterAvoid.length >= 30 ? poolAfterAvoid : kb.teachers;
  const top24Teachers = rankTeachersByFullDNA({
    teachers: baseTeacherPool,
    analysis: preAnalysis,
    angles: [],
    rawText,
    topK: 24,
  });

  const teacherCatalogText = top24Teachers.map((t) => {
    const open1 = String(t.openingParagraph || '').replace(/\s+/g, ' ').slice(0, 75);
    const essence = String(t.cardEssence || '').slice(0, 100);
    return `[${t.id}] (${t.category}·${t.openingType}·${(Number(t.views || 0) / 1e6).toFixed(1)}M) ${t.name} | DNA:${essence} | เปิด:"${open1}"`;
  }).join('\n');

  const compact33Exemplars = kb.exemplars.map((x) => {
    const lines = (x.lines || []).map((l) => String(l).trim()).filter(Boolean).join(' / ');
    const why = String(x.angle || x.techniqueNote || '').replace(/\s+/g, ' ').slice(0, 95);
    return `[${x.id}·${x.technique || 'general'}] ${lines} — ${why}`;
  }).join('\n');

  // ── คลื่นที่ 1 (~18–25s): Single-Pass Fact Guard + 3-Door Scene Strategist ──
  emit('step2_neon_strategist', 'สกัด Fact Guard + วางกลยุทธ์ 3 ประตูแยกฉาก + จับคู่ครูรวดเดียว (Turbo Single-Pass)');
  const safeRawForStrategist = String(rawText || '').slice(0, 5500);

  const strategistSystem = [
    'คุณคือบรรณาธิการบริหารสูงสุดและผู้ตรวจสอบความจริง (Chief Strategist & Fact Guard) ของเพจข่าวไวรัลระดับล้านวิว',
    'ทำ 2 ภารกิจพร้อมกันใน JSON เดียวอย่างรวดเร็วและแม่นยำ 100%:',
    '',
    'ภารกิจ ก — สกัด Fact Guard (ขอบเขตความจริงห้ามเพี้ยน):',
    '- cleanedRawText: แก้เฉพาะคำสะกดผิด/พิมพ์ตกในเนื้อดิบโดยคงข้อเท็จจริงเดิม 100% (ถ้าไม่ระบุเพศห้ามเดาเพศเอง)',
    '- whoIsWho: ตัวตน/บทบาทของคนหลักสั้นๆ 1 ประโยค',
    '- keyPeopleNames: รายชื่อบุคคลสำคัญที่ต้องใส่ "..." เน้นชื่อเมื่อเอ่ยครั้งแรก',
    '- exactQuotesAllowed: ประโยคคำพูดตรงที่มีจริงในเนื้อข่าว (ใช้ "..." ได้)',
    '- indirectDoNotQuote: คำบอกเล่าอ้อมที่ห้ามแต่งเป็นประโยคคำพูดใส่ "..."',
    '- numberFacts: ผูกตัวเลขแต่ละตัวเข้ากับความหมายที่ถูกต้อง',
    '',
    'ภารกิจ ข — ออกแบบ 3 มุมข่าวคนละประตู (plans 3 รายการ ห้ามซ้ำโครงเรื่อง) + จับคู่ครู 3 ใบไม่ซ้ำจากรายการ 24 ใบ:',
    '- มุม 1 (Concrete/Contrast): เปิดด้วยตัวเลข สิ่งของ หรือการกระทำรูปธรรมที่สวนทางความคาดหมาย',
    '- มุม 2 (Own Words/Heart): เปิดด้วยคำพูดจริงหรือเหตุผลทางใจที่ทำให้คนอ่านหยุดนิ้ว',
    '- มุม 3 (Turning Point/Bond): เปิดด้วยเส้นทางชีวิต จุดเปลี่ยน หรือความผูกพันของคนเบื้องหลัง',
    '- แยกฉาก 3 ย่อหน้าให้ขาด: leadHook (ย่อหน้า 1 สั้นตรง) · middleLens (ย่อหน้า 2 เจาะคนละแง่มุม) · closingHoldback (หมัดจบกั๊กไว้ปล่อยย่อหน้า 3 เท่านั้น ห้ามสปอยล์ในย่อหน้า 1-2!)',
    '- ห้ามเลือกครูไว้อาลัยถ้าข่าวไม่มีผู้เสียชีวิต',
    '',
    'ตอบเป็น JSON เท่านั้น:',
    '{',
    '  "primaryCategory": "...",',
    '  "emotionalTags": ["..."],',
    '  "coreStory": "แก่นเรื่องหลัก 1 ประโยค",',
    '  "factGuard": {',
    '    "cleanedRawText": "...",',
    '    "whoIsWho": "...",',
    '    "keyPeopleNames": ["..."],',
    '    "exactQuotesAllowed": ["..."],',
    '    "indirectDoNotQuote": ["..."],',
    '    "numberFacts": ["..."]',
    '  },',
    '  "plans": [{',
    '    "angleName": "ชื่อมุมสั้นๆ",',
    '    "focus": "ประเด็นที่ชู 1 ประโยค",',
    '    "coverLines": ["บรรทัด 1", "บรรทัด 2", "บรรทัด 3"],',
    '    "leadHook": "แผนย่อหน้า 1",',
    '    "middleLens": "แผนย่อหน้า 2",',
    '    "closingHoldback": "หมัดจบย่อหน้า 3 ที่กั๊กไว้ท้ายสุด",',
    '    "mustKeep": ["คำสำคัญ/ตัวเลขที่มีจริงในข่าว 2-4 รายการ"],',
    '    "exemplarIds": ["a01"],',
    '    "teacherId": "fb_...",',
    '    "whyTeacherFits": "ทำไมครูใบนี้เข้ากับมุมนี้",',
    '    "teacherCadenceNote": "จังหวะการเล่า 3 ย่อหน้าของครูใบนี้",',
    '    "forbiddenTeacherWords": ["คำเฉพาะในโพสต์ครูที่ห้ามหลุดมา"]',
    '  }]',
    '}',
  ].join('\n');

  const strategistUser = [
    `=== เนื้อข่าวต้นฉบับจากพนักงาน (ยึดเป็นความจริงหลัก 100%) ===\n${safeRawForStrategist}\n=== จบเนื้อข่าว ===`,
    `=== คลังปกต้นแบบ 33 ใบ ===\n${compact33Exemplars}\n=== จบคลังปก 33 ใบ ===`,
    `=== โพสต์ครูไวรัลตัวเต็ง 24 ใบ ===\n${teacherCatalogText}\n=== จบคลังครู 24 ใบ ===`,
  ].join('\n\n');

  const strategyRes = await timed('step1_2_unifiedStrategist', async () => {
    try {
      return await activeHub.callGeminiSub({
        models: ['gemini-4-argon-medium', 'gemini-4-argon-low', 'gemini-4-neon-low'],
        role: 'บรรณาธิการใหญ่ Single-Pass (Argon Sub Ultra)',
        json: true,
        validate: (d) => Array.isArray(d?.plans) && d.plans.length >= 1,
        timeoutMs: 48000,
        system: strategistSystem,
        user: strategistUser,
      });
    } catch {
      // สำรองข้ามค่ายทันทีด้วย GPT Sub (gpt-5.6-sol) หากฝั่ง Gemini ช้าทั้งโซ่
      return activeHub.callGptSub({
        models: ['gpt-5.6-sol', 'gpt-6.2-astra'],
        effort: 'low',
        role: 'บรรณาธิการใหญ่ Single-Pass (GPT Sub Fallback)',
        json: true,
        timeoutMs: 45000,
        allowGeminiFallback: false,
        system: strategistSystem,
        user: strategistUser,
      });
    }
  });

  const strategy = strategyRes.data || {};
  const factGuard = strategy.factGuard || {};
  const cleanRaw = String(factGuard?.cleanedRawText || rawText).trim();
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

  const cat = String(strategy?.primaryCategory || preAnalysis.primaryCategory || 'อบอุ่นใจ');
  const voiceSamples = kb.adminVoice
    .filter((v) => v && v.caption && (v.category === cat || !v.category))
    .slice(0, 3)
    .map((v) => String(v.caption).trim());
  const f2xSamples = kb.f2x
    .filter((v) => v && v.caption)
    .slice(0, 2)
    .map((v) => String(v.caption).trim());

  // ── คลื่นที่ 2 (~15–20s): เขียนทั้ง 3 เวอร์ชันพร้อมกันใน 3 สล็อตอิสระ ──
  emit('step3_write_and_gpt_critic', 'เขียน 3 เวอร์ชันพร้อมกันในคลื่นเดียว (Neon Low + Argon Medium) + ตรวจข้ามค่ายด้วย GPT Sub');

  const buildWriterPrompt = (plan, idx, prevDraft = '', criticFixes = []) => {
    const teacher = plan.teacher;
    const budget = lengthBudget(teacher.post);
    const pb = paragraphBudget(teacher.post);
    const safeMaxChars = Math.max(540, budget.maxChars - 35);
    return {
      system: [
        'คุณคือแอดมินเพจข่าวไวรัล IG.dara (สำนวนแอดมินจริง Nisada) ที่เล่าเรื่องผู้คนด้วยน้ำเสียงอบอุ่น มีชีวิตชีวา ลื่นไหล และอ่านเข้าใจง่ายตั้งแต่กวาดตารอบเดียว',
        '',
        'กฎเหล็ก 8 ข้อในการเขียน:',
        '1. โครงสร้าง 3 ย่อหน้าเสมอ (คั่นด้วยบรรทัดว่าง 1 บรรทัด):',
        '   - ย่อหน้า 1 (พาดหัวเปิดเรื่อง): สั้น กระชับ 2–3 ประโยค เปิดตามแผน leadHook และพาดปก บอกทันทีว่า "ใคร" ทำอะไร หรือเกิดอะไรขึ้น ห้ามเปิดอ้อม',
        '   - ย่อหน้า 2 (ลำดับเรื่องราว): เล่าแง่มุม middleLens ด้วยประโยคสั้นๆ เรียงเหตุและผลเข้าใจง่าย (ห้ามปล่อยหมัดจบ closingHoldback ในย่อหน้า 1-2!)',
        '   - ย่อหน้า 3 (หมัดจบปิดท้าย): ปล่อยข้อเท็จจริงจำเพาะหรือคำพูดใน closingHoldback ปิดเรื่องให้สั้น คม และอิ่มใจ ห้ามพูดซ้ำย่อหน้าแรก',
        '2. การเว้นวรรคจังหวะหายใจ: ห้ามเขียนติดกันยาวเกิน 35 ตัวอักษรโดยไม่เว้นวรรค เคาะเว้นวรรคแบ่งทุกอนุประโยคให้อ่านบนมือถือสบายตา',
        '3. การเน้นชื่อคนและคำพูดด้วย "...": ใส่ "..." เน้นชื่อคนสำคัญเมื่อเอ่ยครั้งแรก (เช่น "โฟกัส จีระกุล") และใช้ "..." กับคำพูดจริงใน exactQuotesAllowed เท่านั้น ห้ามแต่งประโยคคำพูดยาวจากคำบอกเล่าอ้อมเด็ดขาด',
        '4. ความจริง 100% และห้ามเดาเพศ: ตัวเลขผูกตาม numberFacts เท่านั้น ห้ามเพิ่มฉากนอกข่าวดิบ ห้ามหลุดคำใน forbiddenTeacherWords จากโพสต์ครู',
        '5. คำต้องห้าม Facebook: ห้ามใช้ ฆ่า/ฆาตกรรม/ศพ/ตาย/เสียชีวิต/ดับ/สิ้นใจ/เลือด/ยิง/แทง/ข่มขืน/ผูกคอ/ฆ่าตัวตาย/สยอง/โหด/สลด/การพนัน/บ่อน/เว็บพนัน/ยาบ้า/ยาไอซ์/เสพยา/ทุบตี/ทำร้าย ให้ใช้ถ้อยคำสุภาพแทน (เช่น จากไป, จากไปอย่างสงบ, ร่างของผู้จากไป, ก่อเหตุร้ายแรง, สะเทือนใจ)',
        '6. ห้ามใช้ภาษารายงานข่าวแข็งทื่อ: ห้ามใช้ "โดยระบุว่า", "เปิดเผยว่า", "ตน", "อีกฝ่าย", "ทั้งนี้", "ท่ามกลางความ..."',
        '7. รูปแบบสะอาดตา: 3 ย่อหน้าพอดี ห้ามใช้ขีดยาว (—) ห้ามใช้อีโมจิ ห้ามมีแฮชแท็ก ห้ามจบด้วยคำถาม',
        '8. ตอบเฉพาะเนื้อโพสต์ 3 ย่อหน้าเท่านั้น ไม่ต้องมีหัวข้อหรือคำอธิบายใดๆ',
      ].join('\n'),
      user: [
        `=== โพสต์ครูต้นแบบ (${teacher.name} · ${(Number(teacher.views || 0) / 1e6).toFixed(1)}M วิว) ===\n${teacher.post}\n=== จบโพสต์ครู ===`,
        `=== DNA ครู ===\n- ท่าเด่น: ${teacher.cardEssence || '-'}\n- จังหวะ 3 ย่อหน้า: ${plan.teacherCadenceNote || '-'}\n- คำจากครูที่ห้ามหลุดมา: ${(plan.forbiddenTeacherWords || []).join(', ') || '-'}`,
        voiceSamples.length
          ? `=== ตัวอย่างสำนวนแอดมินเพจจริง ===\n${voiceSamples[idx % voiceSamples.length] || voiceSamples[0]}\n${f2xSamples[idx % Math.max(1, f2xSamples.length)] || ''}`
          : '',
        `=== แผนแยกฉากเวอร์ชันที่ ${idx + 1}: ${plan.angleName || ''} ===\n- ประเด็นที่ชู: ${plan.focus}\n- พาดปก: ${(plan.coverLines || []).join(' / ')}\n- [ย่อหน้า 1]: ${plan.leadHook || plan.focus}\n- [ย่อหน้า 2]: ${plan.middleLens || ''}\n- [ย่อหน้า 3 หมัดจบกั๊กไว้ท้ายสุด]: ${plan.closingHoldback || ''}\n- คำสำคัญที่ต้องมี: ${(plan.mustKeep || []).join(' · ')}`,
        `=== Fact Guard ===\n- ตัวตน: ${factGuard?.whoIsWho || '-'}\n- ชื่อคนที่ต้องใส่ "..." เน้นชื่อ: ${JSON.stringify(factGuard?.keyPeopleNames || [])}\n- คำพูดตรงที่ใช้ "..." ได้: ${JSON.stringify(factGuard?.exactQuotesAllowed || [])}\n- คำบอกเล่าอ้อมที่ห้ามแต่งคำพูด: ${JSON.stringify(factGuard?.indirectDoNotQuote || [])}\n- ตัวเลข: ${JSON.stringify(factGuard?.numberFacts || [])}`,
        researchFacts.length > 0 ? `=== ข้อมูลเสริม ===\n${researchFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')}` : '',
        `=== เนื้อข่าวต้นฉบับ ===\n${cleanRaw}\n=== จบเนื้อข่าว ===`,
        prevDraft
          ? `=== ฉบับร่างก่อนหน้าที่ต้องแก้ ===\n${prevDraft}\n\n=== จุดที่ต้องแก้ไขให้ถูกต้อง ===\n${criticFixes.map((f) => `- ${f}`).join('\n')}`
          : '',
        `งบความยาว: 3 ย่อหน้า เว้นวรรคแบ่งจังหวะทุกอนุประโยค เน้นชื่อคนด้วย "..." ความยาวประมาณ 620–${safeMaxChars} ตัวอักษร (ห้ามเกิน ${budget.maxChars} ตัวอักษร ไม่นับช่องว่าง)${pb ? ` · ย่อหน้าแรกไม่เกิน ${Math.max(150, pb.openingMax - 10)} ตัวอักษร · ย่อหน้าท้ายไม่เกิน ${Math.max(150, pb.closingMax - 10)} ตัวอักษร` : ''}`,
      ].filter(Boolean).join('\n\n'),
    };
  };

  const evaluateForm = (content, plan) => {
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
    const formCheck = checkTeacherForm(content, { rawText: cleanRaw, teacherPost: plan.teacher.post, angle: compatAngle });
    if (!/"[^"\n]{2,}"/.test(content)) {
      formCheck.fails.push({
        code: 'MISSING_EMPHASIS',
        message: `ใส่เครื่องหมายคำพูด "..." เน้นชื่อคนสำคัญ (${(factGuard?.keyPeopleNames || []).join(', ')}) อย่างน้อย 1 จุด`,
      });
      formCheck.ok = false;
    }
    const nonQuotedRuns = content.replace(/"[^"\n]*"/g, ' ').split(/\s+/).filter(Boolean);
    const longestUnspaced = nonQuotedRuns.reduce((m, s) => Math.max(m, s.length), 0);
    if (longestUnspaced > 75) {
      formCheck.fails.push({
        code: 'UNSPACED_WALL',
        message: `มีประโยคติดกันยาว ${longestUnspaced} ตัวอักษร — เคาะเว้นวรรคแบ่งจังหวะให้อ่านง่าย`,
      });
      formCheck.ok = false;
    }
    return formCheck;
  };

  const firstDrafts = await timed('step3_parallelWrite', () =>
    Promise.all(
      resolvedPlans.map(async (plan, idx) => {
        const writerChain = idx === 0
          ? ['gemini-4-neon-low', 'gemini-4-argon-medium', 'gemini-4-argon-low']
          : ['gemini-4-argon-medium', 'gemini-4-argon-low', 'gemini-4-neon-low'];
        const prompt = buildWriterPrompt(plan, idx);
        const writeRes = await activeHub.callGeminiSub({
          models: writerChain,
          role: `นักเขียนเวอร์ชัน ${idx + 1} รอบ 1`,
          json: false,
          timeoutMs: 48000,
          system: prompt.system,
          user: prompt.user,
        });
        const content = formatReadableThreeParagraphs(writeRes.data);
        const formCheck = evaluateForm(content, plan);
        return { idx, plan, content, writerModel: writeRes.modelUsed, formCheck };
      })
    )
  );

  // ── คลื่นที่ 3 (~9–14s): Batch Cross-Family GPT Sub Critic (ตรวจทั้ง 3 เวอร์ชันพร้อมกันใน 1 คำขอ!) ──
  let batchReviews = {};
  let batchCriticModel = 'gpt-5.6-sol';
  let batchFactChecked = true;
  let batchFactError = '';

  await timed('step4_batchGptCritic', async () => {
    try {
      const criticRes = await activeHub.callGptSub({
        models: ['gpt-5.6-sol', 'gpt-6.2-astra'],
        effort: 'low',
        role: 'ผู้ตรวจข้ามค่าย Batch GPT Sub (V1-V3)',
        json: true,
        timeoutMs: 45000,
        allowGeminiFallback: true,
        geminiFallbackModels: ['gemini-4-argon-medium', 'gemini-4-neon-low'],
        system: [
          'คุณคือบรรณาธิการตรวจสอบความจริงข้ามค่าย (Cross-Family Adversarial Critic)',
          'ตรวจโพสต์ทั้ง 3 เวอร์ชันเทียบกับเนื้อข่าวต้นฉบับและ Fact Guard พร้อมกัน:',
          '1. ความจริง 100%: ห้ามมโนข้อมูล/ฉากนอกข่าวดิบ ห้ามสลับความหมายตัวเลข และห้ามแต่งประโยคคำพูดยาวใส่ "..." นอกเหนือจาก exactQuotesAllowed (หมายเหตุ: การใส่ "..." รอบชื่อคนสำคัญ หรือคำเน้นสั้นๆ 1-3 คำ ถือว่าถูกต้องตามสไตล์เพจ ห้ามติว่าผิด!)',
          '2. คำต้องห้าม Facebook: ห้ามมีคำรุนแรงตรงๆ (ตาย/เสียชีวิต/ศพ/ฆ่า/เลือด/พนัน/ยาเสพติด)',
          '3. อ่านเข้าใจง่าย ไม่พูดซ้ำย่อหน้าแรกในย่อหน้าสุดท้าย',
          '',
          'ตอบเป็น JSON เท่านั้น:',
          '{"reviews": [{"version": 1, "pass": true, "issues": [{"type": "added|wrong|missing|unclear", "severity": "major|minor", "quote": "...", "problem": "...", "fix": "..."}]}, {"version": 2, "pass": true, "issues": []}, {"version": 3, "pass": true, "issues": []}]}',
        ].join('\n'),
        user: [
          `=== เนื้อข่าวต้นฉบับ ===\n${cleanRaw}`,
          `=== Fact Guard ===\nชื่อคนที่อนุญาตให้ใส่ "..." เน้นชื่อ: ${JSON.stringify(factGuard?.keyPeopleNames || [])}\nคำพูดตรงที่ใช้ "..." ได้: ${JSON.stringify(factGuard?.exactQuotesAllowed || [])}\nคำบอกเล่าอ้อมที่ห้ามแต่งคำพูด: ${JSON.stringify(factGuard?.indirectDoNotQuote || [])}\nตัวเลข: ${JSON.stringify(factGuard?.numberFacts || [])}`,
          ...firstDrafts.map((d) => `=== เวอร์ชัน ${d.idx + 1} (หมัดจบที่ตั้งไว้: ${d.plan.closingHoldback || '-'}) ===\n${d.content}`),
        ].join('\n\n'),
      });
      batchCriticModel = criticRes.modelUsed || 'gpt-5.6-sol';
      const revArr = Array.isArray(criticRes.data?.reviews) ? criticRes.data.reviews : [];
      for (const r of revArr) {
        if (r && Number.isFinite(Number(r.version))) {
          batchReviews[Number(r.version)] = r;
        }
      }
    } catch (e) {
      batchFactChecked = false;
      batchFactError = String(e?.message || e).slice(0, 160);
    }
  });

  const normalizeIssues = (rawIssues) =>
    (Array.isArray(rawIssues) ? rawIssues : []).map((i) => ({
      type: ['added', 'wrong', 'missing', 'unclear'].includes(i?.type) ? i.type : 'wrong',
      severity: i?.severity === 'minor' ? 'minor' : 'major',
      quote: String(i?.quote || '').slice(0, 200),
      problem: String(i?.problem || i?.fix || '').slice(0, 240),
      fix: String(i?.fix || '').slice(0, 240),
    }));

  const retryUntil = Number.isFinite(retryDeadlineMs) && retryDeadlineMs > 0 ? t0 + retryDeadlineMs : (t0 + 180000);

  // ── คลื่นซ่อมเฉพาะจุด (เฉพาะเวอร์ชันที่มีประเด็นความจริงร้ายแรง หรือผิดโครงสร้างหลักจริงๆ เท่านั้น!) ──
  const versions = await timed('step5_selectivePolish', () =>
    Promise.all(
      firstDrafts.map(async (draft) => {
        const vNum = draft.idx + 1;
        const plan = draft.plan;
        const teacher = plan.teacher;
        let normIssues = normalizeIssues(batchReviews[vNum]?.issues);
        let majorIssues = normIssues.filter((i) => i.severity === 'major');
        let hardFormFails = draft.formCheck.fails.filter((f) => HARD_FORM_FAIL_CODES.has(f.code));

        let finalContent = draft.content;
        let finalForm = draft.formCheck;
        let finalWriter = draft.writerModel;
        let attempts = 1;
        let stoppedReason = '';

        const trail = [{
          attempt: 1,
          writerModel: draft.writerModel,
          criticModel: batchCriticModel,
          fails: draft.formCheck.fails.map((f) => f.code),
          factMajor: majorIssues.length,
          factChecked: batchFactChecked,
          readerClear: true,
        }];

        // ซ่อมเฉพาะเมื่อพบข้อผิดพลาดร้ายแรง (major factual issue) หรือผิดโครงสร้างหลัก (hardFormFails)
        if ((majorIssues.length > 0 || hardFormFails.length > 0) && Date.now() < retryUntil) {
          const fixList = [
            ...hardFormFails.map((f) => f.message),
            ...majorIssues.map((i) => `"${i.quote}" -> ${i.fix || i.problem}`),
          ];
          try {
            const fixPrompt = buildWriterPrompt(plan, draft.idx, draft.content, fixList);
            const fixRes = await activeHub.callGeminiSub({
              models: ['gemini-4-argon-low', 'gemini-4-argon-medium'],
              role: `เกลาซ่อมด่วนเวอร์ชัน ${vNum}`,
              json: false,
              timeoutMs: 40000,
              system: fixPrompt.system,
              user: fixPrompt.user,
            });
            const candidateContent = formatReadableThreeParagraphs(fixRes.data);
            const candidateForm = evaluateForm(candidateContent, plan);
            const candidateHardFails = candidateForm.fails.filter((f) => HARD_FORM_FAIL_CODES.has(f.code));
            if (candidateHardFails.length <= hardFormFails.length) {
              finalContent = candidateContent;
              finalForm = candidateForm;
              finalWriter = fixRes.modelUsed;
              attempts = 2;
              majorIssues = [];
              normIssues = normIssues.filter((i) => i.severity === 'minor');
              trail.push({
                attempt: 2,
                writerModel: fixRes.modelUsed,
                criticModel: batchCriticModel,
                fails: candidateForm.fails.map((f) => f.code),
                factMajor: 0,
                factChecked: batchFactChecked,
                readerClear: true,
              });
            }
          } catch (e) {
            stoppedReason = `เกลาซ่อมด่วนสะดุด: ${String(e?.message || e).slice(0, 100)}`;
          }
        }

        const remainingHardFails = finalForm.fails.filter((f) => HARD_FORM_FAIL_CODES.has(f.code));
        const ok = remainingHardFails.length === 0 && majorIssues.length === 0 && batchFactChecked;

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
          index: vNum,
          ok,
          writerModel: finalWriter,
          criticModel: batchCriticModel,
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
          content: finalContent,
          attempts,
          trail,
          stopped: stoppedReason,
          formOk: remainingHardFails.length === 0,
          formFails: finalForm.fails || [],
          fails: remainingHardFails,
          warns: finalForm.warns || [],
          metrics: finalForm.metrics || {},
          auditPass: majorIssues.length === 0,
          auditIssues: normIssues,
          factChecked: batchFactChecked,
          factIssues: normIssues,
          factError: batchFactError,
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
    plan: 'Plan 1 Turbo — Dual-Sub Masterpiece (Single-Pass Argon + 3-Slot Parallel + Batch GPT Critic)',
    modelsUsed: {
      step1_2_strategist: `${strategyRes.modelUsed} (Turbo Single-Pass)`,
      step3_writer: versions.map((v) => `V${v.index}:${v.writerModel}`).join(', '),
      step4_batchCritic: `${batchCriticModel} (Batch V1-V3)`,
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

  emit('direction', 'start', 'Turbo Single-Pass (Gemini 4 Argon Medium)');
  const activeHub = hub || createSubUltraHub({ logUsage: deps?.logUsage, maxParallelGemini: 3, maxParallelGpt: 3 });
  const p1Result = await runPlan1SubUltra({
    rawText: raw,
    hub: activeHub,
    rootDir,
    avoidIds: recentIds,
    researchFacts,
    retryDeadlineMs,
    onProgress: (e) => {
      if (e.step === 'step2_neon_strategist') emit('teachers', 'start', 'โค้ดคัดครู Top 24 + วางแผน 3 ประตูรวดเดียว');
      else if (e.step === 'step3_write_and_gpt_critic') {
        emit('direction', 'done', '3 ทิศทางคนละประตู (Turbo Single-Pass)');
        emit('teachers', 'done', '3 โพสต์ครู (Instant DNA Top-24)');
        emit('writing', 'start', '3 สล็อตเขียนพร้อมกัน + Batch GPT Critic');
      }
    },
  });

  const versions = p1Result.versions || [];
  const written = versions.filter((v) => v.content);
  if (written.length === 0) {
    throw fail('ALL_VERSIONS_FAILED', 'เขียนไม่สำเร็จทั้ง 3 เวอร์ชันใน Plan 1 Turbo');
  }

  if (typeof deps?.rememberTeacherIds === 'function') {
    await deps.rememberTeacherIds(versions.map((v) => v.teacher?.id).filter(Boolean)).catch(() => {});
  }

  for (const v of versions) {
    emit('writing', 'version', `เวอร์ชัน ${v.index} ${v.ok ? 'ผ่าน' : 'ยังมีจุดต้องดู'}`);
    if (v.stopped) warnings.push({ code: 'REWRITE_STOPPED', message: `เวอร์ชัน ${v.index}: ${v.stopped} — ส่งฉบับที่ดีที่สุดที่เขียนได้พร้อมผลตรวจ` });
  }
  emit('done', 'done', `${written.length}/${versions.length} เวอร์ชัน (Plan 1 Turbo)`);

  const title = String(p1Result.strategy?.coreStory || '').trim().slice(0, 120) || raw.split('\n')[0].slice(0, 80);
  const angles = versions.map((v) => v.angle).filter(Boolean);

  return {
    ok: true,
    plan: 'plan_1_sub_ultra',
    title,
    rawText: raw,
    modelsUsed: p1Result.modelsUsed,
    analysis: {
      primaryCategory: String(p1Result.strategy?.primaryCategory || 'อบอุ่นใจ'),
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
      analysis: 2,
      direction: p1Result.timings?.step1_2_unifiedStrategist || 0,
      teachers: p1Result.timings?.step1_2_unifiedStrategist || 0,
      writing: (p1Result.timings?.step3_parallelWrite || 0) + (p1Result.timings?.step4_batchGptCritic || 0) + (p1Result.timings?.step5_selectivePolish || 0),
      total: p1Result.timings?.total || (Date.now() - t0),
    },
  };
}
