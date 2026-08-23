/**
 * Workflow Engine — Persistent Context ทุก Step
 * ทุก step จะ save/load context จาก DB
 */
import { prisma } from '@/lib/db';

// สร้าง workflow ใหม่
export async function createWorkflow(sourceType = 'url') {
  return prisma.workflowRun.create({
    data: { currentStep: 'input', sourceType },
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
    ctx += `⚠️ คำสั่งเหล็ก: ต้องครอบคลุมทุกประเด็นด้านบน ห้ามข้าม ห้ามซ้ำ ห้ามแต่งเรื่องใหม่ ต้องเขียนยาวอย่างน้อย 250 คำ หรือ 3 ย่อหน้าเต็มสำหรับ Facebook (แต่ละย่อหน้า 3-5 ประโยค คั่นด้วย \n\n)\n`;
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
