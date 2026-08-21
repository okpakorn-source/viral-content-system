/**
 * Workflow Engine — Persistent Context ทุก Step
 * ทุก step จะ save/load context จาก DB
 */
import { prisma } from '@/lib/db';
import { legacyLengthRule } from '../ai/legacyLengthRules.js';

// สร้าง workflow ใหม่
export async function createWorkflow(sourceType = 'url') {
  return prisma.workflowRun.create({
    data: { currentStep: 'input', sourceType },
  });
}

// ล็อกเฉพาะการเริ่ม workflow ID เดียวกันใน process นี้ ส่วนหลาย process ใช้ PK ของ DB
// เป็นผู้ตัดสิน แล้วผู้แพ้ race อ่านแถวที่ผู้ชนะสร้างกลับมาแทนการสร้างซ้ำ
const _workflowInitLocks = new Map();

async function _withWorkflowInitLock(id, task) {
  const previous = _workflowInitLocks.get(id) || Promise.resolve();
  let releaseCurrent;
  const current = new Promise(resolve => { releaseCurrent = resolve; });
  const tail = previous.catch(() => {}).then(() => current);
  _workflowInitLocks.set(id, tail);
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    releaseCurrent();
    if (_workflowInitLocks.get(id) === tail) _workflowInitLocks.delete(id);
  }
}

function _workflowInitError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function _canonicalWorkflowSourceType(value) {
  const sourceType = typeof value === 'string' ? value.trim() : '';
  if (sourceType === 'text' || sourceType === 'plain_text') return 'plain_text';
  return sourceType || 'url';
}

function _assertSameWorkflowContext(existing, expected) {
  const existingType = existing?.sourceType
    ? _canonicalWorkflowSourceType(existing.sourceType)
    : '';
  if (existingType && expected.sourceType && existingType !== expected.sourceType) {
    throw _workflowInitError(
      'WORKFLOW_CONTEXT_CONFLICT',
      `workflow ${expected.id} ถูกใช้กับชนิดข้อมูลอื่นแล้ว`,
    );
  }
  if (typeof existing?.rawInput === 'string' && existing.rawInput.length > 0
      && expected.rawInput !== null && existing.rawInput !== expected.rawInput) {
    throw _workflowInitError(
      'WORKFLOW_CONTEXT_CONFLICT',
      `workflow ${expected.id} ถูกใช้กับเนื้อข่าวอื่นแล้ว`,
    );
  }
}

async function _reuseWorkflowWithoutReset(existing, expected) {
  _assertSameWorkflowContext(existing, expected);
  const missing = {};
  if (!existing.sourceType && expected.sourceType) missing.sourceType = expected.sourceType;
  if ((existing.rawInput === null || existing.rawInput === undefined || existing.rawInput === '')
      && expected.rawInput !== null) {
    missing.rawInput = expected.rawInput;
  }
  if (Object.keys(missing).length === 0) return existing;
  const updated = await prisma.workflowRun.update({ where: { id: expected.id }, data: missing });
  if (!updated) {
    throw _workflowInitError('WORKFLOW_INIT_FAILED', `เติมบริบท workflow ${expected.id} ไม่สำเร็จ`);
  }
  return updated;
}

/**
 * รับประกันว่า workflow ID ที่ route เลือกมีแถวจริงก่อนเรียก AI
 * - ID เดิม + ข่าวเดิม: ใช้ต่อโดยไม่ reset currentStep หรือผลขั้นก่อนหน้า
 * - ID เดิม + คนละข่าว/คนละ source: หยุด เพื่อกันผลของสองงานเขียนทับกัน
 * - create ชนกันหลาย process: อ่านแถวผู้ชนะแล้วตรวจ context ซ้ำ
 */
export async function ensureWorkflow(id, { sourceType = 'url', rawInput = null } = {}) {
  if (typeof id !== 'string' || !id || id.trim() !== id) {
    throw _workflowInitError('WORKFLOW_ID_INVALID', 'workflowId ต้องเป็นข้อความที่ไม่ว่างและไม่มีช่องว่างหัวท้าย');
  }
  if (rawInput !== null && typeof rawInput !== 'string') {
    throw _workflowInitError('WORKFLOW_CONTEXT_INVALID', 'rawInput ของ workflow ต้องเป็นข้อความ');
  }
  const expected = {
    id,
    sourceType: _canonicalWorkflowSourceType(sourceType),
    rawInput,
  };

  return _withWorkflowInitLock(id, async () => {
    const existing = await prisma.workflowRun.findUnique({ where: { id } });
    if (existing) return _reuseWorkflowWithoutReset(existing, expected);

    try {
      return await prisma.workflowRun.create({
        data: {
          id,
          currentStep: 'input',
          sourceType: expected.sourceType,
          ...(rawInput !== null ? { rawInput } : {}),
        },
      });
    } catch (createError) {
      // อีก process อาจชนะ insert ด้วย PK เดียวกันระหว่าง find กับ create
      const winner = await prisma.workflowRun.findUnique({ where: { id } });
      if (winner) return _reuseWorkflowWithoutReset(winner, expected);
      throw createError;
    }
  });
}

// โหลด workflow
export async function getWorkflow(id) {
  const wf = await prisma.workflowRun.findUnique({ where: { id } });
  if (!wf) return null;
  return {
    ...wf,
    breakdownData: wf.breakdownData ? JSON.parse(wf.breakdownData) : null,
    analysisResult: wf.analysisResult ? JSON.parse(wf.analysisResult) : null,
    metadata: wf.metadata ? JSON.parse(wf.metadata) : null,
  };
}

// Step 2: บันทึกข่าวที่สกัดได้
export async function saveExtraction(id, { newsTitle, newsBody, newsSource, newsDate, newsCategory, rawInput }) {
  return prisma.workflowRun.update({
    where: { id },
    data: {
      currentStep: 'extracted',
      newsTitle, newsBody, newsSource, newsDate, newsCategory, rawInput,
    },
  });
}

// Step 3: บันทึกผลแตกประเด็น
export async function saveBreakdown(id, breakdownData) {
  return prisma.workflowRun.update({
    where: { id },
    data: {
      currentStep: 'breakdown',
      breakdownData: JSON.stringify(breakdownData),
    },
  });
}

// Step 4: บันทึกผลวิเคราะห์
export async function saveAnalysis(id, analysisResult, presetUsed) {
  return prisma.workflowRun.update({
    where: { id },
    data: {
      currentStep: 'analyzed',
      analysisResult: JSON.stringify(analysisResult),
      presetUsed,
    },
  });
}

// ข่าวที่ไม่มีฉบับผ่านด่าน RAW: เก็บเฉพาะสถานะ/diagnostic ที่ไม่เผยร่างผิด
export async function saveFactualReview(id, diagnostic) {
  return prisma.workflowRun.update({
    where: { id },
    data: {
      currentStep: 'factual_review',
      analysisResult: JSON.stringify({
        publishable: false,
        versions: [],
        factualGate: diagnostic,
      }),
      presetUsed: null,
    },
  });
}

/**
 * สร้าง Full Context สำหรับส่ง AI
 * รวมข้อมูลจาก Step 2 + Step 3 ทั้งหมด
 */
export function buildFullContext(workflow) {
  let ctx = '';

  // === NARRATIVE RECONSTRUCTION: ส่ง headline + fact summary เท่านั้น ===
  // ⚠️ ห้ามส่ง newsBody เต็มเข้า final compose — ใช้ NarrativePayload แทน
  if (workflow.newsTitle) {
    ctx += `=== ข่าวต้นฉบับ (headline only — source removed for narrative reconstruction) ===\n`;
    ctx += `หัวข้อ: ${workflow.newsTitle}\n`;
    ctx += `⚠️ ข่าวต้นฉบับถูกแปลงเป็น structured facts แล้ว — ห้ามขอ source เดิม\n`;
    ctx += `=== จบ headline ===\n\n`;
  }

  // ผลแตกประเด็นทั้งหมด (Step 3)
  const bd = workflow.breakdownData;
  if (bd) {
    ctx += `=== ผลแตกประเด็นจาก AI (ขั้นตอนที่ 3 — ต้องใช้ทุกประเด็นในการเขียน) ===\n`;
    if (bd.core_story) ctx += `แก่นข่าว: ${bd.core_story}\n`;
    if (bd.main_emotional_core) ctx += `แก่น Emotional: ${bd.main_emotional_core}\n`;
    if (bd.conflict_point) ctx += `จุด Conflict: ${bd.conflict_point}\n`;
    if (bd.viral_trigger) ctx += `Viral Trigger: ${bd.viral_trigger}\n`;
    if (bd.news_summary) ctx += `สรุปรวม: ${bd.news_summary}\n`;

    if (bd.key_points?.length > 0) {
      ctx += `\nประเด็นสำคัญ (${bd.key_points.length} ข้อ):\n`;
      bd.key_points.forEach((kp, i) => {
        ctx += `${i + 1}. ${kp.point || kp}: ${kp.detail || ''} [${kp.category || ''}, สำคัญ: ${kp.importance || '-'}, อารมณ์: ${kp.emotional_value || '-'}, ไวรัล: ${kp.viral_potential || '-'}]\n`;
      });
    }
    if (bd.quotes?.length > 0) ctx += `\nคำพูดสำคัญ: ${bd.quotes.join(' | ')}\n`;
    if (bd.conflicts?.length > 0) ctx += `จุดขัดแย้ง: ${bd.conflicts.join(' | ')}\n`;
    if (bd.pain_points?.length > 0) ctx += `Pain Points: ${bd.pain_points.join(' | ')}\n`;
    if (bd.best_sections?.length > 0) ctx += `ท่อนดีที่สุด: ${bd.best_sections.join(' | ')}\n`;
    if (bd.emotional_hooks?.length > 0) ctx += `จุดที่คนอิน: ${bd.emotional_hooks.join(' | ')}\n`;

    // Possible Angles — ส่งทุกมุมพร้อม viral score
    if (bd.possible_angles?.length > 0) {
      ctx += `\nมุมเล่าทั้งหมด (${bd.possible_angles.length} มุม):\n`;
      bd.possible_angles.forEach((a, i) => {
        ctx += `${i + 1}. ${a.angle_name}: ${a.description} [อารมณ์: ${a.target_emotion || '-'}, viral: ${a.facebook_viral_score || '-'}/10]\n`;
      });
    }
    if (bd.suggested_angles?.length > 0) {
      ctx += `มุมแนะนำ: ${bd.suggested_angles.map(a => typeof a === 'string' ? a : `${a.angle} (${a.tone})`).join(' | ')}\n`;
    }

    // Best Angle + Language Strategy
    if (bd.best_main_angle) {
      ctx += `\n🏆 มุมที่ดีที่สุด: ${bd.best_main_angle.angle_name} — ${bd.best_main_angle.why_best}\n`;
    }
    if (bd.language_strategy) {
      ctx += `✍️ กลยุทธ์ภาษา: เปิด=${bd.language_strategy.opening_style || '-'}, เล่า=${bd.language_strategy.storytelling_style || '-'}, จังหวะ=${bd.language_strategy.emotional_pacing || '-'}, ปิด=${bd.language_strategy.ending_style || '-'}\n`;
    }

    ctx += `=== จบผลแตกประเด็น ===\n\n`;
    // 🗑️ 17 ส.ค. 69: ตัดเฉพาะวรรคความยาวออก — ส่วนครอบคลุมทุกประเด็น/ห้ามข้าม/ห้ามซ้ำ/ห้ามแต่งเรื่องใหม่ยังอยู่
    //    เส้นนี้เป็นเส้นสำรอง (ใช้เมื่อ MasterAgent โหลดไม่ได้ — summarizeServiceText.js:1966)
    ctx += `⚠️ คำสั่งเหล็ก: ต้องครอบคลุมทุกประเด็นด้านบน ห้ามข้าม ห้ามซ้ำ ห้ามแต่งเรื่องใหม่${legacyLengthRule('workflowIron')}\n`;
  }

  return ctx;
}

/**
 * Validate ว่า AI output อ้างอิงข่าวจริง
 */
export function validateOutput(output, workflow) {
  const issues = [];
  const content = typeof output === 'string' ? output : JSON.stringify(output);

  // เช็คความยาว
  if (content.length < 500) issues.push('เนื้อหาสั้นเกินไป (ต้องยาวกว่า 500 ตัวอักษร / ~250 คำ)');

  // เช็คว่ามีชื่อ/คำจากข่าวจริง
  if (workflow.newsTitle) {
    const titleWords = workflow.newsTitle.split(/\s+/).filter(w => w.length > 3);
    const matchCount = titleWords.filter(w => content.includes(w)).length;
    if (matchCount < Math.min(2, titleWords.length)) {
      issues.push('ไม่พบคำจากหัวข้อข่าวในผลลัพธ์ — อาจไม่ได้อ้างอิงข่าวจริง');
    }
  }

  return { valid: issues.length === 0, issues };
}
