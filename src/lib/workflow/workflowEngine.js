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

  // ข่าวต้นฉบับ (Step 2)
  if (workflow.newsBody) {
    ctx += `=== เนื้อข่าวต้นฉบับ (จากขั้นตอนที่ 2 — ห้ามแต่งเพิ่ม ใช้ข้อมูลนี้เท่านั้น) ===\n`;
    ctx += `หัวข้อ: ${workflow.newsTitle || ''}\n\n`;
    ctx += `${workflow.newsBody}\n`;
    ctx += `=== จบเนื้อข่าว ===\n\n`;
  }

  // ผลแตกประเด็น (Step 3)
  const bd = workflow.breakdownData;
  if (bd) {
    ctx += `=== ผลแตกประเด็นจาก AI (ขั้นตอนที่ 3 — ต้องใช้ทุกประเด็นในการเขียน) ===\n`;
    if (bd.news_summary) ctx += `สรุปรวม: ${bd.news_summary}\n`;
    if (bd.key_points?.length > 0) {
      ctx += `\nประเด็นสำคัญ (${bd.key_points.length} ข้อ):\n`;
      bd.key_points.forEach((kp, i) => {
        ctx += `${i + 1}. ${kp.point || kp}: ${kp.detail || ''} [${kp.category || ''}, สำคัญ: ${kp.importance || '-'}, อารมณ์: ${kp.emotional_value || '-'}]\n`;
      });
    }
    if (bd.quotes?.length > 0) ctx += `\nคำพูดสำคัญ: ${bd.quotes.join(' | ')}\n`;
    if (bd.conflicts?.length > 0) ctx += `จุดขัดแย้ง: ${bd.conflicts.join(' | ')}\n`;
    if (bd.pain_points?.length > 0) ctx += `Pain Points: ${bd.pain_points.join(' | ')}\n`;
    if (bd.best_sections?.length > 0) ctx += `ท่อนดีที่สุด: ${bd.best_sections.join(' | ')}\n`;
    if (bd.emotional_hooks?.length > 0) ctx += `จุดที่คนอิน: ${bd.emotional_hooks.join(' | ')}\n`;
    if (bd.suggested_angles?.length > 0) {
      ctx += `มุมแนะนำ: ${bd.suggested_angles.map(a => typeof a === 'string' ? a : `${a.angle} (${a.tone})`).join(' | ')}\n`;
    }
    ctx += `=== จบผลแตกประเด็น ===\n\n`;
    ctx += `⚠️ คำสั่งเหล็ก: ต้องครอบคลุมทุกประเด็นด้านบน ห้ามข้าม ห้ามซ้ำ ห้ามแต่งเรื่องใหม่\n`;
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
  if (content.length < 200) issues.push('เนื้อหาสั้นเกินไป');

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
