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
/**
 * 🔴 16 ส.ค. 69 — ตัวคลี่รายการของ breakdown ให้เป็นข้อความอ่านออก (ผู้ตรวจอิสระจับได้ · ผมยืนยันจากผลรันจริง)
 *
 * บั๊กที่แก้: `bd.conflicts.join(' | ')` — แต่ AI คืน conflicts เป็น **อาเรย์ของอ็อบเจกต์**
 *   ⇒ `.join()` ได้ `"[object Object] | [object Object] | [object Object]"` ยัดเข้าพรอมต์
 *   ⇒ AI ปลายทางบ่นเองใน log: "เนื้อข่าวระบุจุดขัดแย้งเป็น [object Object] จึงวางแผนจาก...เท่านั้น"
 *   ⇒ **แก่นดราม่าที่คมที่สุดของข่าวถูกทิ้งทุกใบ** เช่น "รักในวันแต่งงาน vs รักในวันพักฟื้น"
 *      และ "รักมากพออยู่ต่อ vs เจ็บมากพอควรถอย"
 * ช่องที่พังจริง (วัดจากผลเจนจริง 16 ส.ค.): `conflicts` (conflict/detail/...) · `best_sections` (section/why_strong)
 *   🔴 17 ส.ค. แก้ความจริงที่ผมเคยจดผิดตรงนี้ (ผู้ตรวจอิสระจับได้จากข้อมูลของผมเอง):
 *   `quotes` **ก็เป็นกล่องได้** — เจอจริง 1 ใน 4 ใบ รูป {quote, speaker, context, emotional_impact}
 *   (out-live-tak-nuay.json) ⇒ ต่อสายเข้าตัวคลี่แล้วเหมือนกัน และเติม 'quote' เข้า _LIST_KEYS
 *   ส่วน pain_points / emotional_hooks เป็นสตริงจริงทั้ง 4/4 ใบ — ตัวนี้ปล่อยผ่านไม่แตะ
 * 🔴 ทำไมไม่แก้เป็น `.map(x => x.conflict)` ตรงๆ: ชื่อฟิลด์ต่างกันแต่ละช่อง (conflict / section / point)
 *   และ AI อาจเปลี่ยนรูปได้อีก → ตัวนี้เดาชื่อฟิลด์ให้เอง และถ้าไม่รู้จักก็คลี่ค่าทั้งอ็อบเจกต์แทนที่จะทิ้ง
 * ถอยกลับพฤติกรรมเดิม (ได้ [object Object] เหมือนเดิม): BREAKDOWN_LIST_FIX=0
 */
// ลำดับคีย์ = ลำดับความน่าจะเป็น "หัวข้อของรายการ"
//   detail มาก่อน name/title/value เพราะผู้ตรวจชี้ว่า {name:'อ้น', detail:'แก่นเรื่อง'} ควรได้แก่น ไม่ใช่ชื่อ
// 🔴 17 ส.ค. 69 รอบสาม — เติมชื่อฟิลด์จากตัวอย่างจริง 26 ชุด (คิวงานจริง 22 + ผลรัน 4)
//   'content' = quotes บางใบใช้ {type, content, speaker} · 'pain_point'/'pain' = pain_points สองรูป
//   ถ้าไม่มีชื่อพวกนี้ ตัวคลี่จะตกไปเส้น fallback แล้วหอบคำวิจารณ์ของ AI (why_it_hits) เข้าพรอมต์ด้วย
const _LIST_KEYS = ['conflict', 'section', 'quote', 'content', 'pain_point', 'pain', 'point', 'text', 'detail', 'name', 'title', 'value'];
const _ITEM_MAX = 500;  // เพดานต่อใบ — กันพรอมต์บวมถ้าโมเดลคืนก้อนยาวผิดปกติ (ของจริงยาวสุด 53 ตัว)
const _LIST_MAX = 20;   // เพดานจำนวนใบ — ของจริง 2-5 ใบ

function _fixOn() {
  return String(process.env.BREAKDOWN_LIST_FIX ?? '').trim().replace(/^["']|["']$/g, '').trim() !== '0';
}

/** คลี่ "หนึ่งใบ" ให้เป็นข้อความ — ใช้เวลาที่ปลายทางต้องการอาเรย์ของสตริง ไม่ใช่สตริงเดียว */
export function flattenItem(x) {
  if (!_fixOn()) return String(x); // ถอยของเดิมเป๊ะ (ได้ [object Object])
  if (x === null || x === undefined) return '';
  if (typeof x !== 'object') return String(x).slice(0, _ITEM_MAX);
  // 🔴 ต้องเช็ค typeof !== 'object' ด้วย — ไม่งั้น {conflict:{left,right}} จะได้ [object Object] ซ้อนชั้น (ผู้ตรวจจับได้)
  for (const k of _LIST_KEYS) {
    const v = x[k];
    if (v !== null && v !== undefined && typeof v !== 'object' && String(v).trim()) return String(v).slice(0, _ITEM_MAX);
  }
  // ไม่รู้จักชื่อฟิลด์ → คลี่ค่าที่เป็นข้อความทั้งหมดออกมา ดีกว่าทิ้งเป็น [object Object]
  const vals = Object.values(x).filter((v) => typeof v === 'string' && v.trim());
  return vals.length ? vals.join(' — ').slice(0, _ITEM_MAX) : '';
}

export function flattenList(arr, sep = ' | ') {
  if (!Array.isArray(arr)) return '';
  if (!_fixOn()) return arr.join(sep); // ถอยของเดิมเป๊ะ (รวมอาการ [object Object])
  // 🔴 ตัดแล้วต้องส่งเสียง — บทเรียนเพดานตัวอย่างครู 700 ที่ตัดเงียบๆ อยู่เป็นเดือนโดยไม่มีใครรู้
  if (arr.length > _LIST_MAX) console.log(`[flattenList] ✂️ รายการ ${arr.length} ใบ เกินเพดาน ${_LIST_MAX} — ตัดทิ้ง ${arr.length - _LIST_MAX} ใบ`);
  return arr.slice(0, _LIST_MAX).map(flattenItem).filter(Boolean).join(sep);
}

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
    if (bd.quotes?.length > 0) ctx += `\nคำพูดสำคัญ: ${flattenList(bd.quotes, ' | ')}\n`;
    if (bd.conflicts?.length > 0) ctx += `จุดขัดแย้ง: ${flattenList(bd.conflicts, ' | ')}\n`;
    if (bd.pain_points?.length > 0) ctx += `Pain Points: ${flattenList(bd.pain_points, ' | ')}\n`;
    if (bd.best_sections?.length > 0) ctx += `ท่อนดีที่สุด: ${flattenList(bd.best_sections, ' | ')}\n`;
    if (bd.emotional_hooks?.length > 0) ctx += `จุดที่คนอิน: ${flattenList(bd.emotional_hooks, ' | ')}\n`;

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
