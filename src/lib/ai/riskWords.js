/**
 * ========================================
 * RISK WORDS — ตารางคำเสี่ยง Facebook "แหล่งเดียว" ของระบบข่าว
 * ========================================
 * ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S2 · เจ้าของอนุมัติ) — OV-01 / PL-15 / PL-04
 *
 * ปัญหาเดิม: ตารางคำเสี่ยงมี 4–5 ชุดขัดกันเองในท่อเดียว
 *   (1) safetyFilter.js WORD_RULES (ตัวกรองที่ client · S1)          — ศพ → ร่างผู้เสียชีวิต · ยิงตาย → ใช้อาวุธปืนจนเสียชีวิต
 *   (2) outputAuditService.js FORBIDDEN_WORDS (ด่าน L2)                — ศพ → ร่างผู้เสียหาย · ยิง → ใช้อาวุธปืน · แต่แบน "อาวุธ" → สิ่งของอันตราย
 *   (3) safeCorrectionService.js needsAIRewrite (เส้นทาง L3A/L3B)     — รายการคำแยกอีกชุด
 *   (4) system prompt ของ client 3 ตัว (claudeClient/geminiClient/openai) — รายการห้าม+คำแทนคนละชุด (claude ห้าม "อาวุธ")
 *   (5) พรอมต์นักเขียน summarizeService(Text).js + promptStore(Text).js  — "ยิง" → "ใช้อาวุธปืน" · ศพ → ร่างของผู้จากไป
 *   ผลจริง (พิสูจน์แล้ว): 'ถูกยิงตาย' → ตัวกรอง → 'ถูกใช้อาวุธปืนจนเสียชีวิต' → L2 จับ "อาวุธ" → L3A แทน → 'ถูกใช้สิ่งของอันตรายปืนจนเสียชีวิต'
 *
 * หลักการของไฟล์นี้:
 *   - ทุกด่าน (ตัวกรอง sanitize · L2 audit · L3 แก้คำ · rollback scrub · พรอมต์) อ่านกฎจาก RISK_RULES ที่นี่ที่เดียว
 *   - คำแทน (to) ของทุกกฎต้อง "ปิด" (closed): เอาคำแทนไปสแกนด้วยกฎทั้งตารางแล้วต้องไม่โดนจับซ้ำ — มีข้อสอบคุม
 *     (เหตุ OV-01 ปิดตรงนี้: กฎ "อาวุธ" ยกเว้นคำว่า "อาวุธปืน" ซึ่งเป็นคำแทนมาตรฐานของ "ยิง"/"ยิงตาย")
 *   - เครื่องสแกน (scanRiskRules) อยู่ที่ safetyFilter.js ตัวเดียว: ตัวกรองและ L2 ใช้กติกาขอบคำ/คำประสม/ราชาศัพท์/ชื่อในเครื่องหมายคำพูดชุดเดียวกัน
 *     L3 แทนคำ "ตรงตำแหน่งที่กฎเดียวกันจับได้" ไม่ใช่ String.replace ตำแหน่งแรก (PL-04)
 *   - สวิตช์ถอย: RISK_WORDS_LEGACY=1 (รับ 1/true/on/yes/legacy) → ทุกด่านกลับไปใช้ตารางเดิมของตัวเอง + String.replace เดิม + พรอมต์เดิมทุกไบต์
 *     (ตัวกรองกลับไปใช้ WORD_RULES ของ S1 ใน safetyFilter.js · SANITIZE_LEGACY=1 ของ S1 ยังทำงานเหมือนเดิม)
 *
 * รูปแบบกฎ (RISK_RULES):
 *   id            รหัสกฎ (ไม่ซ้ำ) — L2 แนบไปกับ issue (issue.ruleId) ให้ L3/scrub ค้นตำแหน่งด้วยกฎเดียวกัน
 *   find          สตริงตรงตัว (กฎส่วนใหญ่) · pattern = RegExp (มี g) สำหรับกฎบริบทซับซ้อนที่ยกมาจาก L2 เดิม (regex ไม่เช็คขอบคำ/prevBlock)
 *   to            คำแทนมาตรฐาน — ใช้ทั้งตัวกรอง/L2 suggestion/พรอมต์ · '' = ลบทิ้ง (bait)
 *   severity      high|medium (คะแนน L2 · L3 แก้เฉพาะ high/medium เหมือนเดิม)
 *   group         violence|selfharm|sexual|weapon|gambling|drugs|alcohol|clickbait|bait|explicit (ใช้จัดหมวดในพรอมต์)
 *   sanitize      false = ตัวกรองที่ client ไม่แตะ (คำเดี่ยวที่ต้องดูบริบท → ปล่อยให้ L2/L3B) · ค่าเริ่มต้น true
 *   audit         false = L2 ไม่รายงานเป็น forbidden_word (คำ bait ที่ L2 มีรายการ ENGAGEMENT_BAIT ลบเองอยู่แล้ว กันนับซ้ำ) · ค่าเริ่มต้น true
 *   aiRewrite     true = L3 ส่งให้ AI เกลาตามบริบท (L3B) · false = แทนตรง (L3A) — เดิมตัดสินจากรายการ needsAIRewrite
 *   needsBoundary/prevBlock/nextBlock/onNegation/onAttempt/afterNumberTo — กติกาบริบทของเครื่องสแกน (ความหมายเดิมของ S1 · ดู safetyFilter.js)
 *   core          อยู่ในรายการสั้นของ system prompt (claude/gemini) — ชุดเดียวกับรายการเดิม 17 คำ
 *   promptNote    หมายเหตุสั้นให้ AI (ข้อยกเว้นที่เคยขัดกันระหว่างพรอมต์)
 *
 * ที่มาของคำแทนเมื่อ 2 ตารางเดิมไม่ตรงกัน: ยึดตาราง S1 (ตัวกรองที่เจ้าของอนุมัติ 24 ก.ย.) เป็นหลัก เพราะตัวกรองทำงานก่อน L2 เสมอ
 *   ศพ → ร่างผู้เสียชีวิต (L2 เดิม ร่างผู้เสียหาย · พรอมต์ ร่างของผู้จากไป) · ฆ่า → ทำให้เสียชีวิต (L2/พรอมต์เดิม ก่อเหตุ) ·
 *   ฆาตกรรม → เหตุสูญเสีย (L2 เดิม คดีร้ายแรง) · ฆ่าตัวตาย → จากไปอย่างน่าเศร้า (L2 เดิม จากไปอย่างเงียบๆ) ·
 *   หมกศพ → ซ่อนร่างผู้เสียชีวิต (L2 เดิม ซุกซ่อนร่าง) · สยอง → สะเทือนใจ (L2 เดิม น่าตกใจ) · ผูกคอ → ทำร้ายตัวเอง (L2 เดิม จากไปอย่างน่าเศร้า = เพิ่มการตาย)
 */

const LEGACY_VALUES = new Set(['1', 'true', 'on', 'yes', 'legacy']);

/** สวิตช์ถอย RISK_WORDS_LEGACY — อ่านตอนเรียกทุกครั้ง (ไม่แคช) · ไม่ตั้ง/0/off = ตารางกลาง */
export function isRiskWordsLegacy() {
  const raw = process.env.RISK_WORDS_LEGACY;
  if (raw == null) return false;
  return LEGACY_VALUES.has(String(raw).trim().replace(/^["']|["']$/g, '').toLowerCase());
}

// กฎ regex (บริบทซับซ้อน ยกมาจาก L2 เดิมทุกตัวอักษร) — เครื่องสแกนใช้ pattern (g) จับ และ test (ไม่มี g) เป็นทางด่วน
const rx = (pattern) => ({ pattern, test: new RegExp(pattern.source, pattern.flags.replace('g', '')) });

export const RISK_RULES = Object.freeze([
  // ═══ ความรุนแรง — ชุดตัวกรอง S1 (sanitize + audit) ═══
  { id: 'ฆ่าตัวตาย', find: 'ฆ่าตัวตาย', to: 'จากไปอย่างน่าเศร้า', onNegation: 'ทำร้ายตัวเอง', onAttempt: 'ทำร้ายตัวเอง', severity: 'high', group: 'selfharm', core: true },
  { id: 'ฆ่า', find: 'ฆ่า', to: 'ทำให้เสียชีวิต', needsBoundary: true,
    prevBlock: ['ยา', 'น้ำยา', 'สาร', 'นัก', 'ทรง', 'เครื่อง'],
    nextBlock: ['เชื้อ', 'แมลง', 'หญ้า', 'เวลา', 'ปลวก', 'ยุง', 'ไวรัส', 'แบคทีเรีย'],
    severity: 'high', group: 'violence', core: true },
  { id: 'ฆาตกรรม', find: 'ฆาตกรรม', to: 'เหตุสูญเสีย', severity: 'high', group: 'violence' },
  { id: 'หมกศพ', find: 'หมกศพ', to: 'ซ่อนร่างผู้เสียชีวิต', severity: 'high', group: 'violence' },
  { id: 'ชำแหละ', find: 'ชำแหละ', to: 'เหตุรุนแรงอย่างยิ่ง', severity: 'high', group: 'violence' },
  { id: 'พบศพ', find: 'พบศพ', to: 'พบร่างผู้เสียชีวิต', severity: 'high', group: 'violence' },
  { id: 'ซากศพ', find: 'ซากศพ', to: 'ร่างผู้เสียชีวิต', severity: 'high', group: 'violence' },
  { id: 'ศพ', find: 'ศพ', to: 'ร่างผู้เสียชีวิต', needsBoundary: true, afterNumberTo: 'ราย',
    prevBlock: ['พระ', 'พระบรม', 'บรม', 'งาน', 'หลุม', 'โลง', 'สวด'],
    severity: 'high', group: 'violence', core: true },
  { id: 'แทงตาย', find: 'แทงตาย', to: 'ใช้ของมีคมจนเสียชีวิต', severity: 'high', group: 'violence' },
  { id: 'ยิงตาย', find: 'ยิงตาย', to: 'ใช้อาวุธปืนจนเสียชีวิต', severity: 'high', group: 'violence' },
  { id: 'ดับสลด', find: 'ดับสลด', to: 'เสียชีวิตอย่างสะเทือนใจ', severity: 'high', group: 'violence', core: true },
  { id: 'ดับคาที่', find: 'ดับคาที่', to: 'เสียชีวิตในที่เกิดเหตุ', severity: 'high', group: 'violence' },
  { id: 'สยองขวัญ', find: 'สยองขวัญ', to: 'สะเทือนขวัญ', severity: 'medium', group: 'violence' },
  { id: 'สยอง', find: 'สยอง', to: 'สะเทือนใจ', needsBoundary: true, severity: 'medium', group: 'violence', core: true },
  { id: 'โหดเหี้ยม', find: 'โหดเหี้ยม', to: 'รุนแรงอย่างยิ่ง', severity: 'medium', group: 'violence' },
  { id: 'โหดร้าย', find: 'โหดร้าย', to: 'รุนแรง', severity: 'medium', group: 'violence' },
  // nextBlock 'ร้อน' = lookahead (?!ร้อน) ของ L2 เดิม (โหดร้อน ไม่ใช่คำรุนแรง) — จุดเดียวที่ชุด sanitize ต่างจาก WORD_RULES ของ S1 (S1 มีแค่ 'สัส')
  { id: 'โหด', find: 'โหด', to: 'รุนแรง', needsBoundary: true, nextBlock: ['สัส', 'ร้อน'], severity: 'medium', group: 'violence', core: true },
  { id: 'เลือดสาด', find: 'เลือดสาด', to: 'เหตุรุนแรง', severity: 'high', group: 'violence', aiRewrite: true, core: true },
  { id: 'เลือดอาบ', find: 'เลือดอาบ', to: 'เหตุรุนแรง', severity: 'high', group: 'violence', aiRewrite: true },
  { id: 'ทุบตี', find: 'ทุบตี', to: 'ใช้ความรุนแรง', severity: 'medium', group: 'violence' },
  // ═══ Self-harm — ห้ามยืนยันการตายที่ต้นฉบับไม่มี (S1) ═══
  { id: 'ผูกคอตาย', find: 'ผูกคอตาย', to: 'เสียชีวิตอย่างน่าเศร้า', onNegation: 'ทำร้ายตัวเอง', onAttempt: 'ทำร้ายตัวเอง', severity: 'high', group: 'selfharm' },
  { id: 'ผูกคอ', find: 'ผูกคอ', to: 'ทำร้ายตัวเอง', severity: 'high', group: 'selfharm', core: true,
    promptNote: 'ผูกคอ/กระโดดตึกที่ยังไม่เสียชีวิต (ช่วยทัน/รอด) ห้ามเขียนว่าเสียชีวิต — ถ้าเสียชีวิตจริงต้องบอกการจากไปให้ชัด' },
  { id: 'กระโดดตึกตาย', find: 'กระโดดตึกตาย', to: 'เสียชีวิตจากที่สูง', onNegation: 'ทำร้ายตัวเอง', onAttempt: 'ทำร้ายตัวเอง', severity: 'high', group: 'selfharm' },
  { id: 'กระโดดตึก', find: 'กระโดดตึก', to: 'ตกจากที่สูง', severity: 'high', group: 'selfharm' },
  { id: 'จบชีวิตตัวเอง', find: 'จบชีวิตตัวเอง', to: 'จากไปอย่างกะทันหัน', onNegation: 'ทำร้ายตัวเอง', onAttempt: 'ทำร้ายตัวเอง', severity: 'high', group: 'selfharm' },
  { id: 'อยากตาย', find: 'อยากตาย', to: 'ภาวะเครียดสะสม', onNegation: null, severity: 'high', group: 'selfharm' },
  // ═══ Sexual ═══
  { id: 'ข่มขืน', find: 'ข่มขืน', to: 'ล่วงละเมิดทางเพศ', severity: 'high', group: 'sexual', core: true },
  { id: 'อนาจาร', find: 'อนาจาร', to: 'กระทำไม่เหมาะสม', severity: 'high', group: 'sexual' },
  // ═══ Clickbait (ตัวกรอง S1) — audit:false = L2 มีรายการ ENGAGEMENT_BAIT ของตัวเองลบคำเหล่านี้อยู่แล้ว (กันรายงานซ้ำ) ═══
  { id: 'คุณจะไม่เชื่อ', find: 'คุณจะไม่เชื่อ', to: 'หลายคนพูดถึง', severity: 'high', group: 'clickbait', audit: false },
  { id: 'แชร์ด่วน', find: 'แชร์ด่วน', to: 'กลายเป็นประเด็น', severity: 'high', group: 'clickbait', audit: false },
  { id: 'ดูก่อนโดนลบ', find: 'ดูก่อนโดนลบ', to: 'เป็นที่สนใจ', severity: 'high', group: 'clickbait', audit: false },
  { id: 'อึ้งทั้งประเทศ', find: 'อึ้งทั้งประเทศ', to: 'เป็นที่วิพากษ์วิจารณ์', severity: 'high', group: 'clickbait' },
  { id: 'รีบดูด่วน', find: 'รีบดูด่วน', to: 'น่าติดตาม', severity: 'high', group: 'clickbait' },
  // ═══ Engagement bait (ตัวกรอง S1) — ตัวเลขต้องจบที่ขอบคำ (พิมพ์ 10 / พิมพ์ 1,500 ไม่โดน) ═══
  { id: 'พิมพ์ 1', find: 'พิมพ์ 1', to: 'คุณคิดเห็นยังไง', severity: 'high', group: 'bait', audit: false },
  { id: 'เมนต์ 99', find: 'เมนต์ 99', to: 'แสดงความเห็น', severity: 'high', group: 'bait', audit: false },
  { id: 'แชร์วนไป', find: 'แชร์วนไป', to: 'แบ่งปันให้คนรู้จัก', severity: 'high', group: 'bait' },
  { id: 'ใครเห็นด้วยกดไลก์', find: 'ใครเห็นด้วยกดไลก์', to: 'คุณเห็นด้วยไหม', severity: 'high', group: 'bait', audit: false },

  // ═══ กฎเฉพาะ L2 เดิม (sanitize:false — คำเดี่ยวที่ต้องดูบริบท ตัวกรองที่ client ไม่แตะ) ═══
  // บริบทแพทย์ + ภาคต่อรุนแรง (★ 14 ส.ค. 69 Sol backlog ข้อ 3 ขั้น 3) — regex เดิมทุกตัวอักษร
  { id: 'เลือด-แพทย์-รุนแรง', ...rx(/(?:เส้น|หลอด|สาย|เกล็ด|กระแส|ถ่าย|ปั๊ม|เติม|ห้าม|บริจาค)เลือด(?:ที่)?(?:ออกมา)?(?:ไหลนอง|ทะลัก|สาด|พุ่งออก|เป็นกอง)/gu),
    to: 'เหตุการณ์รุนแรง', severity: 'high', group: 'violence', sanitize: false, aiRewrite: true },
  { id: 'AV', ...rx(/AV(?!\s*[ก-๙a-z])/g), to: '', severity: 'high', group: 'explicit', sanitize: false },
  // ตาย/ดับ/สิ้นใจ/เลือด — prevBlock/nextBlock = lookbehind/lookahead ของ L2 เดิมทุกคำ
  { id: 'ตาย', find: 'ตาย', to: 'จากไป', prevBlock: ['เสีย', 'ปิด'], nextBlock: ['ตัว', 'ด้าน', 'แล้ว'], severity: 'high', group: 'violence', sanitize: false, aiRewrite: true },
  // ★ 1 ส.ค. 69 (เคสจริง "ตามลำดับ"→"ตามลำจากไป"): กัน ลำดับ/อันดับ/ระดับ + ดับเบิล/ดับบลิว
  { id: 'ดับ', find: 'ดับ', to: 'จากไป', prevBlock: ['ลำ', 'อัน', 'ระ', 'ไฟ', 'เครื่อง'], nextBlock: ['เพลิง', 'ไฟ', 'กลิ่น', 'แสง', 'เบิล', 'บลิว'], severity: 'medium', group: 'violence', sanitize: false, aiRewrite: true },
  { id: 'สิ้นใจ', find: 'สิ้นใจ', to: 'จากไป', severity: 'medium', group: 'violence', sanitize: false, aiRewrite: true },
  // ★ 10 ก.ค./14 ส.ค. 69: ศัพท์แพทย์ 14 คำ (เส้นเลือด/หลอดเลือด/…/ห้ามเลือด) + lookahead เดิม
  { id: 'เลือด', find: 'เลือด', to: 'ร่องรอยเหตุการณ์',
    prevBlock: ['เส้น', 'หลอด', 'ลิ่ม', 'เม็ด', 'ฟอก', 'ดัน', 'บริจาค', 'สาย', 'เกล็ด', 'กระแส', 'ถ่าย', 'ปั๊ม', 'เติม', 'ห้าม'],
    nextBlock: ['ดี', 'ข้น', 'ฝาด', 'จาง', 'ผสม', 'กำเดา'],
    severity: 'medium', group: 'violence', sanitize: false, aiRewrite: true, core: true,
    promptNote: 'ศัพท์การแพทย์/อวัยวะ เช่น "เส้นเลือด" "หลอดเลือด" "บริจาคเลือด" ให้คงคำเดิม' },
  { id: 'จบชีวิต', find: 'จบชีวิต', to: 'จากไปอย่างน่าเศร้า', severity: 'high', group: 'selfharm', sanitize: false, aiRewrite: true },
  { id: 'แทง', find: 'แทง', to: 'ใช้ของมีคม', nextBlock: ['บอล', 'ม้า', 'หวย', 'รถ'], severity: 'high', group: 'violence', sanitize: false },
  // nextBlock เดิม ประตู/จรวด/ดาว + ยาว (S1 ระบุ "ยิงยาว" ไม่ใช่ความรุนแรง) + คำถาม/มุก (ยิงคำถาม/ยิงมุก — แทนตรงแล้วพัง "ใช้อาวุธปืนคำถาม")
  { id: 'ยิง', find: 'ยิง', to: 'ใช้อาวุธปืน', nextBlock: ['ประตู', 'จรวด', 'ดาว', 'ยาว', 'คำถาม', 'มุก'], severity: 'high', group: 'violence', sanitize: false },
  // ★ OV-01: "อาวุธปืน" = คำแทนมาตรฐานของ ยิง/ยิงตาย ทั้งระบบ → กฎนี้ต้องยกเว้น (เดิม /อาวุธ/g จับคำแทนที่ระบบสร้างเองแล้วแทนซ้ำเป็น "สิ่งของอันตรายปืน")
  { id: 'อาวุธ', find: 'อาวุธ', to: 'สิ่งของอันตราย', nextBlock: ['ปืน'], severity: 'medium', group: 'weapon', sanitize: false, core: true,
    promptNote: '"อาวุธปืน" (คำแทนมาตรฐานของ "ยิง") ใช้ได้ — เลี่ยงเฉพาะ "อาวุธ" เดี่ยวๆ/อาวุธชนิดอื่น' },
  { id: 'กระสุน', find: 'กระสุน', to: 'วัตถุอันตราย', severity: 'medium', group: 'weapon', sanitize: false, core: true },
  { id: 'บาดเจ็บสาหัส', find: 'บาดเจ็บสาหัส', to: 'ได้รับบาดเจ็บหนัก', severity: 'high', group: 'violence', sanitize: false, core: true },
  { id: 'สะเก็ดระเบิด', find: 'สะเก็ดระเบิด', to: 'เหตุการณ์ไม่คาดฝัน', severity: 'high', group: 'violence', sanitize: false, aiRewrite: true, core: true },
  { id: 'ระเบิด', find: 'ระเบิด', to: 'เหตุการณ์รุนแรง', nextBlock: ['ความ', 'พลัง', 'แรง'], severity: 'high', group: 'violence', sanitize: false, aiRewrite: true, core: true },
  { id: 'สนามรบ', find: 'สนามรบ', to: 'พื้นที่ปฏิบัติหน้าที่', severity: 'medium', group: 'violence', sanitize: false, aiRewrite: true, core: true },
  { id: 'สงคราม', find: 'สงคราม', to: 'สถานการณ์ความขัดแย้ง', nextBlock: ['ราคา', 'ธุรกิจ'], severity: 'medium', group: 'violence', sanitize: false },
  { id: 'คลิปหลุด', find: 'คลิปหลุด', to: 'คลิปที่แพร่ออกมา', severity: 'high', group: 'sexual', sanitize: false, core: true },
  { id: 'หลุดเต็ม', find: 'หลุดเต็ม', to: 'เผยแพร่ออกมา', severity: 'high', group: 'sexual', sanitize: false },
  { id: 'ทำร้าย', find: 'ทำร้าย', to: 'ใช้ความรุนแรง', nextBlock: ['ตัวเอง'], severity: 'medium', group: 'violence', sanitize: false },
  { id: 'บาดแผล', find: 'บาดแผล', to: 'อาการบาดเจ็บ', nextBlock: ['ทางใจ'], severity: 'medium', group: 'violence', sanitize: false, aiRewrite: true },
  // ★ การพนัน / ยาเสพติด / แอลกอฮอล์ (Meta restricted — 12 มิ.ย. 69) · สลาก/ลอตเตอรี่ จงใจไม่ใส่ (บางข่าวเป็นแก่นเรื่อง)
  //   ทั้งกลุ่มให้ AI เกลาตามบริบท (พรอมต์ L3B: "เกลาให้นุ่มโดยไม่ทำให้ข้อเท็จจริงหาย")
  { id: 'บ่อนการพนัน', find: 'บ่อนการพนัน', to: 'เกมเสี่ยงโชคผิดกฎหมาย', severity: 'high', group: 'gambling', sanitize: false, aiRewrite: true },
  { id: 'การพนัน', find: 'การพนัน', to: 'เกมเสี่ยงโชคผิดกฎหมาย', severity: 'high', group: 'gambling', sanitize: false, aiRewrite: true },
  { id: 'เล่นพนัน', find: 'เล่นพนัน', to: 'เกมเสี่ยงโชคผิดกฎหมาย', severity: 'high', group: 'gambling', sanitize: false, aiRewrite: true },
  { id: 'บ่อนพนัน', find: 'บ่อนพนัน', to: 'เกมเสี่ยงโชคผิดกฎหมาย', severity: 'high', group: 'gambling', sanitize: false, aiRewrite: true },
  { id: 'เว็บพนัน', find: 'เว็บพนัน', to: 'เว็บผิดกฎหมาย', severity: 'high', group: 'gambling', sanitize: false, aiRewrite: true },
  { id: 'พนันออนไลน์', find: 'พนันออนไลน์', to: 'เว็บผิดกฎหมาย', severity: 'high', group: 'gambling', sanitize: false, aiRewrite: true },
  { id: 'บาคาร่า', find: 'บาคาร่า', to: 'เว็บผิดกฎหมาย', severity: 'high', group: 'gambling', sanitize: false, aiRewrite: true },
  { id: 'สล็อตออนไลน์', find: 'สล็อตออนไลน์', to: 'เว็บผิดกฎหมาย', severity: 'high', group: 'gambling', sanitize: false, aiRewrite: true },
  { id: 'แทงบอล', find: 'แทงบอล', to: 'เกมเสี่ยงโชคผิดกฎหมาย', severity: 'high', group: 'gambling', sanitize: false, aiRewrite: true },
  { id: 'แทงม้า', find: 'แทงม้า', to: 'เกมเสี่ยงโชคผิดกฎหมาย', severity: 'high', group: 'gambling', sanitize: false, aiRewrite: true },
  { id: 'ยาบ้า', find: 'ยาบ้า', to: 'สิ่งผิดกฎหมาย', severity: 'high', group: 'drugs', sanitize: false, aiRewrite: true },
  { id: 'ยาไอซ์', find: 'ยาไอซ์', to: 'สิ่งผิดกฎหมาย', severity: 'high', group: 'drugs', sanitize: false, aiRewrite: true },
  { id: 'เฮโรอีน', find: 'เฮโรอีน', to: 'สิ่งผิดกฎหมาย', severity: 'high', group: 'drugs', sanitize: false, aiRewrite: true },
  { id: 'โคเคน', find: 'โคเคน', to: 'สิ่งผิดกฎหมาย', severity: 'high', group: 'drugs', sanitize: false, aiRewrite: true },
  { id: 'ยาเสพติด', find: 'ยาเสพติด', to: 'สิ่งผิดกฎหมาย', severity: 'high', group: 'drugs', sanitize: false, aiRewrite: true },
  { id: 'เสพยา', find: 'เสพยา', to: 'สิ่งผิดกฎหมาย', severity: 'high', group: 'drugs', sanitize: false, aiRewrite: true },
  { id: 'พ่อค้ายา', find: 'พ่อค้ายา', to: 'สิ่งผิดกฎหมาย', severity: 'high', group: 'drugs', sanitize: false, aiRewrite: true },
  { id: 'ค้ายา', find: 'ค้ายา', to: 'สิ่งผิดกฎหมาย', severity: 'high', group: 'drugs', sanitize: false, aiRewrite: true },
  { id: 'เมาแล้วขับ', find: 'เมาแล้วขับ', to: 'ขับขี่ในสภาพไม่พร้อม', severity: 'medium', group: 'alcohol', sanitize: false, aiRewrite: true },
  { id: 'ตั้งวงเหล้า', find: 'ตั้งวงเหล้า', to: 'วงสังสรรค์', severity: 'medium', group: 'alcohol', sanitize: false, aiRewrite: true },
  { id: 'วงเหล้า', find: 'วงเหล้า', to: 'วงสังสรรค์', severity: 'medium', group: 'alcohol', sanitize: false, aiRewrite: true },
  { id: 'ดื่มสุรา', find: 'ดื่มสุรา', to: 'วงสังสรรค์', severity: 'medium', group: 'alcohol', sanitize: false, aiRewrite: true },
  // ═══ Clickbait / explicit เฉพาะ L2 (คำแทน '' = ลบ — L3A ข้ามเมื่อ suggestion ว่าง เหมือนเดิม) ═══
  { id: 'ด่วน', find: 'ด่วน', to: '', nextBlock: ['จัด'], severity: 'medium', group: 'clickbait', sanitize: false },
  { id: 'xxx', find: 'xxx', to: '', severity: 'high', group: 'explicit', sanitize: false },
  { id: 'XXX', find: 'XXX', to: '', severity: 'high', group: 'explicit', sanitize: false },
].map((rule) => Object.freeze(rule)));

const RULE_BY_ID = new Map(RISK_RULES.map((rule) => [rule.id, rule]));

/** กฎตาม id (L2 แนบ issue.ruleId → L3/scrub ค้นตำแหน่งด้วยกฎเดียวกัน) */
export function getRiskRule(id) {
  return RULE_BY_ID.get(id) || null;
}

const STAGE_CACHE = new Map();

/**
 * กฎที่ใช้ในแต่ละด่าน เรียงแบบ S1: กฎยาวชนะกฎสั้น (เรียงตามความยาว find · เสถียร = ลำดับในตารางเมื่อยาวเท่ากัน)
 *   'sanitize' = ตัวกรองที่ client (เฉพาะ find · ไม่รวม sanitize:false) — ชุดและลำดับเท่ากับ WORD_RULES ของ S1 ทุกข้อ
 *   'audit'    = ด่าน L2 (ไม่รวม audit:false) — กฎ regex มาก่อน (บริบทเจาะจงกว่า) แล้วค่อยกฎ find ยาว→สั้น
 */
export function riskRulesForStage(stage) {
  if (STAGE_CACHE.has(stage)) return STAGE_CACHE.get(stage);
  let rules;
  if (stage === 'sanitize') {
    rules = RISK_RULES.filter((rule) => rule.find && rule.sanitize !== false);
  } else if (stage === 'audit') {
    rules = RISK_RULES.filter((rule) => rule.audit !== false);
  } else {
    throw new Error(`riskRulesForStage: ไม่รู้จัก stage "${stage}"`);
  }
  const ordered = [
    ...rules.filter((rule) => rule.pattern),
    ...rules.filter((rule) => rule.find).sort((a, b) => b.find.length - a.find.length),
  ];
  STAGE_CACHE.set(stage, Object.freeze(ordered));
  return ordered;
}

// ═══════════════════════════════════════════════════════════════════════════
// พรอมต์ — รายการคำเสี่ยง/คำแทนในพรอมต์ทุกจุดสร้างจากตารางเดียวกัน (โหมดถอย = ข้อความเดิมของแต่ละไฟล์ทุกไบต์)
// ═══════════════════════════════════════════════════════════════════════════

const q = (s) => `"${s}"`;
const uniq = (arr) => [...new Set(arr)];
const ruleOf = (id) => {
  const rule = RULE_BY_ID.get(id);
  if (!rule) throw new Error(`riskWords prompt: ไม่มีกฎ id "${id}"`);
  return rule;
};
const coreRules = () => RISK_RULES.filter((rule) => rule.core);

/**
 * system prompt (claudeClient/geminiClient) — 2 บรรทัดเหมือนเดิม แต่จับคู่ คำ→คำแทน จากตารางกลาง + ข้อยกเว้นที่เคยขัดกัน
 * (เดิม: รายการห้าม 17 คำ กับรายการคำแทน 10 คำ ไม่จับคู่กัน · ห้าม "อาวุธ" แต่พรอมต์นักเขียนสั่ง "ยิง" → "ใช้อาวุธปืน")
 */
export function renderSystemSafetyLines() {
  const pairs = coreRules().map((rule) => `${rule.find}→${rule.to}`).join(', ');
  const notes = uniq(coreRules().filter((rule) => rule.promptNote).map((rule) => rule.promptNote)).join(' · ');
  return `ห้ามใช้คำเสี่ยง (ใช้คำแทนตามคู่นี้): ${pairs}\nข้อยกเว้น: ${notes}`;
}

/** system prompt ของ client — สวิตช์ถอยคืนข้อความเดิมของไฟล์นั้น */
export function riskPromptSystemLines(legacyText) {
  return isRiskWordsLegacy() ? legacyText : renderSystemSafetyLines();
}

// คำห้ามเฉพาะพรอมต์ (ไม่มีกฎแทนในโค้ด — คำกว้าง/สแลงที่แทนด้วยเครื่องไม่ได้) — ยกจาก openai.js เดิมทุกคำ
const PROMPT_ONLY = Object.freeze([
  // alts เดิมของ openai.js มี "ทำร้ายจนเสียชีวิต" ซึ่ง L2 จับคำว่า "ทำร้าย" (พรอมต์แนะนำคำที่ด่านแบน) → ใช้คำแทนมาตรฐานของ ฆ่า แทน (ข้อสอบตาราง "ปิด" คุม)
  { label: 'ความรุนแรง', group: 'violence', words: ['ยิงหัว', 'ปาดคอ', 'หั่นศพ', 'คว้านท้อง', 'ไลฟ์ตาย'], alts: ['ทำให้เสียชีวิต', 'เหตุรุนแรง', 'เหตุสะเทือนใจ', 'เหตุไม่คาดคิด'] },
  { label: 'Self-harm', group: 'selfharm', words: ['ยิงตัวตาย', 'ลาก่อนโลกนี้'], alts: ['เสียชีวิต', 'จากไป', 'เหตุเศร้า'] },
  { label: 'Sexual/18+', group: 'sexual', words: ['หลุด', 'AV', 'xxx', 'เย็ด', 'เสียว', 'คอลเสียว', 'เด็กเอ็น', 'OnlyFans'], alts: ['คลิปปริศนา', 'คอนเทนต์ส่วนตัว', 'ภาพไม่เหมาะสม', 'ประเด็นบนโซเชียล'] },
  { label: 'การพนัน', group: 'gambling', words: ['สล็อต', 'ฝากถอน', 'เว็บตรง', 'แตกหนัก', 'ยิงปลา'], alts: ['เว็บไซต์ผิดกฎหมาย', 'สูญเงินจำนวนมาก'] },
  { label: 'ยาเสพติด', group: 'drugs', words: ['ดูด', 'พอต', 'vape', 'THC', 'สายเขียว'], alts: ['อุปกรณ์สูบ', 'สารเสพติด', 'อุปกรณ์ดังกล่าว'] },
  { label: 'Hate Speech', group: 'hate', words: ['ไอ้ดำ', 'ไอ้ลาว', 'อีกะเทย', 'พวกเกย์มัน...', 'พวกมุสลิม'], alts: ['บุคคลดังกล่าว', 'กลุ่มคนบางส่วน', 'เกิดประเด็นถกเถียง'] },
  { label: 'Fake News', group: 'fake', words: ['รักษาหาย 100%', 'หมอไม่อยากให้รู้', 'กินแล้วหาย', 'รัฐบาลแจกจริง', 'ด่วนที่สุด'], alts: ['มีการแชร์ข้อมูลว่า...', 'ผู้ใช้บางรายอ้างว่า...', 'ควรตรวจสอบเพิ่มเติม'] },
  { label: 'Clickbait', group: 'clickbait', words: [], alts: ['คนบนโซเชียลวิจารณ์'] },
  { label: 'Engagement Bait', group: 'bait', words: [], alts: ['ถ้าเป็นคุณจะ...', 'มองเรื่องนี้ยังไง'] },
]);

/**
 * system prompt openai.js — บล็อกแบ่งหมวดเหมือนเดิม แต่คำในโค้ด (core ของแต่ละหมวด) จับคู่คำแทนจากตารางกลาง
 * และคำเฉพาะพรอมต์ (สแลง/คำกว้าง) ยังอยู่ครบทุกหมวด
 */
export function renderOpenAISafetyBlock() {
  const lines = [];
  for (const cat of PROMPT_ONLY) {
    const codeRules = RISK_RULES.filter((rule) => rule.group === cat.group && rule.find && (rule.core || ['clickbait', 'bait', 'gambling', 'drugs', 'alcohol'].includes(cat.group)));
    const pairs = codeRules.map((rule) => (rule.to ? `${rule.find}→${rule.to}` : rule.find));
    const banned = [...pairs, ...cat.words];
    if (banned.length === 0) continue;
    lines.push(`[${cat.label}] ห้ามใช้: ${banned.join(', ')}`);
    const alts = uniq([...cat.alts]);
    if (alts.length) lines.push(`→ ใช้แทนเพิ่มเติม: ${alts.join(', ')}`);
    lines.push('');
  }
  const notes = uniq(RISK_RULES.filter((rule) => rule.promptNote).map((rule) => rule.promptNote));
  lines.push(`ข้อยกเว้น: ${notes.join(' · ')}`);
  return lines.join('\n');
}

export function riskPromptOpenAIBlock(legacyText) {
  return isRiskWordsLegacy() ? legacyText : renderOpenAISafetyBlock();
}

// บรรทัด "ตาย/ดับ/สิ้นใจ" ของพรอมต์นักเขียน — นโยบายต่างกันสองสาย (คงข้อความเดิมของแต่ละไฟล์ทุกตัวอักษร)
const WRITER_DEATH_LINE = Object.freeze({
  text: '"ตาย/ดับ/สิ้นใจ" → เลี่ยงคำห้วนเหล่านี้ แต่ ⚠️"เสียชีวิต" และ "จากไป" คือคำมาตรฐานที่ปลอดภัย ใช้ตรงๆ ได้เสมอ (16 ก.ค. 69: เลิกแบน "เสียชีวิต" — บทเรียนเคส #01641 การบังคับเลี่ยงทุกคำทำตัวเขียนละข้อเท็จจริงการตายทั้งเรื่อง) สำนวนสุภาพอื่นใช้สลับได้ เช่น "จากไปอย่างสงบ" "ลาลับ" — ห้ามใช้สำนวนเดียวซ้ำทุกจุด/ทุกเวอร์ชัน ⚠️ต้องบอกการจากไปให้ชัดอย่างน้อย 1 ครั้งเสมอ ห้ามเลี่ยงจนคนอ่านไม่รู้ว่าเสียชีวิตแล้ว (ห้ามเล่าฉากก่อนเสียชีวิตค้างไว้โดยไม่เฉลย)',
  url: '"ตาย/ดับ/สิ้นใจ/เสียชีวิต" → ห้ามใช้ตรงๆ ทุกคำ ให้ใช้สำนวนเลี่ยงที่สุภาพ สวย และเข้ากับบริบทของเรื่อง เช่น "จากไปอย่างสงบ" "ไม่อยู่แล้ว" "ลาลับ" "สิ้นลมอย่างสงบ" "ปิดตำนาน" "หลับไม่ตื่นอีกเลย" — เลือกให้เหมาะกับโทนข่าวนั้นๆ ห้ามใช้สำนวนเดียวซ้ำทุกจุด/ทุกเวอร์ชัน ⚠️แต่ต้องบอกการจากไปให้ชัดอย่างน้อย 1 ครั้งเสมอ ห้ามเลี่ยงจนคนอ่านไม่รู้ว่าเสียชีวิตแล้ว (ห้ามเล่าฉากก่อนเสียชีวิตค้างไว้โดยไม่เฉลย)',
});

// โครงบรรทัดพรอมต์นักเขียน (ลำดับ/หมายเหตุเดิม) — ids ชี้กฎในตาราง · alt = สำนวนทางเลือกที่พรอมต์เดิมให้ไว้ (ต้องปิดภายใต้ตารางเหมือน to)
const WRITER_SPEC = Object.freeze([
  { ids: ['ฆ่า'], alt: ['ก่อเหตุ', 'ก่อเหตุร้ายแรง'] },
  { ids: ['ฆาตกรรม'], alt: ['คดีร้ายแรง'] },
  { ids: ['ศพ'] },
  { death: true },
  { ids: ['สยอง', 'โหด'], extraWords: ['สลด'], alt: ['น่าตกใจ'] },
  { ids: ['เลือด'], note: '(⚠️ยกเว้นศัพท์การแพทย์/อวัยวะ เช่น "เส้นเลือด" "เส้นเลือดในสมอง" — ห้ามแทนที่ ให้คงคำเดิม)' },
  { ids: ['แทง'] },
  { ids: ['ยิง'], note: '(คำว่า "อาวุธปืน" ในคำแทนนี้ใช้ได้ — ส่วน "อาวุธ" เดี่ยวๆ/อาวุธชนิดอื่น ให้เลี่ยง)' },
  { ids: ['ข่มขืน'] },
  { ids: ['ผูกคอ'], note: '(ยังไม่เสียชีวิต/ช่วยทัน ห้ามเขียนว่าเสียชีวิต — ถ้าเสียชีวิตจริงต้องบอกการจากไปให้ชัด)' },
  { ids: ['จบชีวิต'] },
  { ids: ['การพนัน', 'บ่อนพนัน', 'แทงบอล', 'เว็บพนัน'], note: '(เลี่ยงให้มากที่สุด)' },
  { ids: ['ยาบ้า', 'ยาไอซ์', 'เสพยา'], alt: ['ของมึนเมาผิดกฎหมาย'] },
  { text: '"เมาแล้วขับ/ตั้งวงเหล้า" → เกลาคำให้นุ่มลง เช่น "ขับขี่ในสภาพไม่พร้อม" "ร่วมวงสังสรรค์" (สลาก/ลอตเตอรี่รัฐบาลใช้ได้ปกติ)' },
  { ids: ['ชำแหละ', 'หมกศพ'] },
  { ids: ['ทุบตี', 'ทำร้าย'] },
  { text: '"จัดฉาก" → "สร้างสถานการณ์"' },
]);

/** สำนวนทางเลือกทั้งหมดในพรอมต์ — ข้อสอบเอาไปพิสูจน์ว่าปิดภายใต้ตาราง (ไม่ถูกจับซ้ำ) เหมือน to */
export function promptAlternatives() {
  return uniq([
    ...WRITER_SPEC.flatMap((item) => item.alt || []),
    ...PROMPT_ONLY.flatMap((cat) => cat.alts),
  ]);
}

/**
 * บล็อกคำแทนของพรอมต์นักเขียน (summarizeServiceText / summarizeService) — variant 'text' | 'url' (บรรทัด ตาย/ดับ ต่างนโยบาย)
 * คืนสตริงหลายบรรทัด ลงท้าย "\n\n" เหมือนบล็อกเดิม (ต่อด้วยบรรทัด "หลักการ:" ในไฟล์)
 */
export function renderWriterSafetyLines(variant = 'text') {
  const lines = [];
  for (const item of WRITER_SPEC) {
    if (item.death) { lines.push(WRITER_DEATH_LINE[variant] || WRITER_DEATH_LINE.text); continue; }
    if (item.text) { lines.push(item.text); continue; }
    const rules = item.ids.map(ruleOf);
    const words = [...rules.map((rule) => rule.find), ...(item.extraWords || [])].join('/');
    const tos = uniq(rules.map((rule) => rule.to)).map(q).join(' / ');
    let line = `${q(words)} → ${tos}`;
    if (item.alt && item.alt.length) line += ` หรือ ${item.alt.map(q).join('/')}`;
    if (item.note) line += ` ${item.note}`;
    lines.push(line);
  }
  return lines.join('\n') + '\n\n';
}

export function riskPromptWriterLines(variant, legacyText) {
  return isRiskWordsLegacy() ? legacyText : renderWriterSafetyLines(variant);
}

/** บรรทัดสั้นในพรอมต์โหมดผสม (mix) — variant 'text' | 'url' */
export function renderWriterSafetyShortLine(variant = 'text') {
  const pair = (id) => `${ruleOf(id).find}→${ruleOf(id).to}`;
  const death = variant === 'url'
    ? 'ตาย/เสียชีวิต→สำนวนเลี่ยงสวยๆ ตามบริบท (จากไปอย่างสงบ/ลาลับ/ปิดตำนาน — ห้ามซ้ำจำเจ)'
    : 'ตาย/ดับ→เลี่ยงคำห้วน (⚠️"เสียชีวิต"/"จากไป" เป็นคำมาตรฐานปลอดภัย ใช้ตรงๆ ได้ — ต้องบอกการจากไปชัด ≥1 ครั้ง ห้ามเลี่ยงจนคนอ่านไม่รู้ว่าเสียชีวิตแล้ว)';
  return `ห้ามใช้คำเสี่ยง: ${pair('ฆ่า')}, ${pair('ศพ')}, ${death}, ${pair('สยอง')}, ${pair('เลือด')} (ยกเว้นศัพท์แพทย์ เส้นเลือด/หลอดเลือด), ${pair('ยิง')} (คำว่า "อาวุธปืน" ใช้ได้), พนัน/ยาเสพติด/วงเหล้า→เลี่ยงหรือเกลาให้นุ่ม\n`;
}

export function riskPromptWriterShortLine(variant, legacyText) {
  return isRiskWordsLegacy() ? legacyText : renderWriterSafetyShortLine(variant);
}

// พรอมต์ preset viral_fb (promptStore/promptStoreText) — บรรทัด "ถ้ามี ให้ rewrite ด้วยภาษานุ่มลง:" + บรรทัด "ห้ามใช้คำเสี่ยง:"
const PRESET_REWRITE_IDS = ['ฆ่าตัวตาย', 'เลือดสาด', 'แทง', 'คลิปหลุด'];
const PRESET_DEATH_NOTE = '- ⚠️ "เสียชีวิต" และ "จากไป" คือคำมาตรฐานที่ปลอดภัยอยู่แล้ว — ใช้บอกการตายได้ตรงๆ ห้ามเลี่ยงคำจนข้อเท็จจริงการตายหายไปจากเรื่อง (10 ก.ค. 69: เดิมแบนคำนี้ ทำให้เขียนข้ามการตายจนคนอ่านเข้าใจว่ายังมีชีวิต)';
const PRESET_BAN_IDS = ['ด่วน', 'ดูก่อนโดนลบ', 'หลุดเต็ม', 'ศพ', 'สยอง', 'โหด', 'xxx', 'AV', 'แชร์ด่วน', 'พิมพ์ 1', 'เมนต์ 99', 'บาดเจ็บสาหัส', 'สะเก็ดระเบิด', 'ระเบิด', 'สนามรบ', 'คลิปหลุด', 'อาวุธ', 'กระสุน', 'เลือดสาด', 'ฆ่าตัวตาย'];

/** บรรทัด "- คำ → คำแทน" ของ preset (คืน array ของบรรทัด) */
export function renderPresetRewriteLines() {
  return [
    ...PRESET_REWRITE_IDS.map((id) => `- ${ruleOf(id).find} → ${ruleOf(id).to}`),
    PRESET_DEATH_NOTE,
    `- ${ruleOf('บาดเจ็บสาหัส').find} → ${ruleOf('บาดเจ็บสาหัส').to}`,
  ];
}

export function riskPromptPresetRewriteLines(legacyLines) {
  return isRiskWordsLegacy() ? legacyLines : renderPresetRewriteLines();
}

/** บรรทัด "ห้ามใช้คำเสี่ยง: ..." ของ preset — รายการเดิม 20 คำ แต่ผูกกับตารางกลาง + ข้อยกเว้น อาวุธปืน/ศัพท์แพทย์ */
export function renderPresetBanLine() {
  const words = PRESET_BAN_IDS.map((id) => (ruleOf(id).find || id));
  const notes = uniq(RISK_RULES.filter((rule) => rule.promptNote && PRESET_BAN_IDS.includes(rule.id)).map((rule) => rule.promptNote));
  return `ห้ามใช้คำเสี่ยง: ${words.join(', ')} (ข้อยกเว้น: ${notes.join(' · ')})`;
}

export function riskPromptPresetBanLine(legacyText) {
  return isRiskWordsLegacy() ? legacyText : renderPresetBanLine();
}
