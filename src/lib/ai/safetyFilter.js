/**
 * ========================================
 * SAFETY FILTER — Shared Post-Processing
 * ========================================
 * Post-processing safety filter สำหรับทุก AI provider
 * Replace คำเสี่ยง Facebook ใน output ก่อน return
 * ทำงานเป็น last line of defense ไม่ว่า prompt จะสั่งหรือไม่
 * 
 * ใช้ร่วมกันใน: openai.js, claudeClient.js, geminiClient.js
 *
 * ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S1 · เจ้าของอนุมัติ) — MC-01/PL-02:
 *   ตัวกรองเดิมแทนคำแบบไม่ดูขอบคำ (ประเทศพม่า→ประเทร่างผู้เสียชีวิตม่า · ยาฆ่าเชื้อ→ยาทำให้เสียชีวิตเชื้อ) และ
 *   "เพิ่มข้อเท็จจริงการตาย" ที่ต้นฉบับไม่มี (ผูกคอแต่ช่วยทัน→เสียชีวิตอย่างน่าเศร้าแต่ช่วยทัน) กับผลของทุกขั้น
 *   → ค่าเริ่มต้นตอนนี้ = ตัวกรองขอบคำ (Intl.Segmenter 'th' + กติกาคำประสม/ราชาศัพท์/ชื่อในเครื่องหมายคำพูด)
 *     + คำแทนกลางที่ไม่ยืนยันการตาย + ขอบเขต: ผล "ข้อเท็จจริง" (สกัด/แตกประเด็น/blueprint/รีเสิร์ช) ไม่ผ่านตัวกรอง
 *     (caller ส่ง sanitizeOutput(obj, { scope: 'facts' }) — ดู aiRouter.js / summarizeServiceText.js)
 *   สวิตช์ถอย: SANITIZE_LEGACY=1 (รับ 1/true/on/yes/legacy) → ตาราง SAFETY_REPLACEMENTS + sanitizeLegacy เดิมทุกไบต์
 *     กับทุก call site และไม่สน scope (ของเดิมไม่มีขอบเขต)
 *
 * ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S2 · เจ้าของอนุมัติ) — OV-01/PL-15/PL-04: ตารางคำเสี่ยงแหล่งเดียว
 *   ตารางกฎย้ายไป ./riskWords.js (RISK_RULES) ให้ตัวกรองนี้ + ด่าน L2 (outputAuditService) + L3 (safeCorrectionService)
 *   + rollback scrub (correctionPipeline) + พรอมต์ทุกจุด ใช้ชุดเดียวกัน · เครื่องสแกนของ S1 แยกเป็น scanRiskRules(str, rules)
 *   ให้ L2 ใช้ตัวเดียวกัน (findRiskWords) และ L3 แทนคำตรงตำแหน่งที่กฎเดียวกันจับได้ (replaceRiskWordIssue) แทน String.replace ตำแหน่งแรก
 *   สวิตช์ถอย: RISK_WORDS_LEGACY=1 → ตัวกรองใช้ WORD_RULES (S1) ในไฟล์นี้เหมือนเดิมทุกไบต์ · SANITIZE_LEGACY=1 ยังทำงานเหมือน S1
 */

import { isRiskWordsLegacy, riskRulesForStage, getRiskRule } from './riskWords.js';

// ตารางเดิม — ใช้เฉพาะโหมดถอย SANITIZE_LEGACY=1 (ห้ามแก้ ตารางใหม่อยู่ที่ WORD_RULES ด้านล่าง)
const SAFETY_REPLACEMENTS = [
  // ความรุนแรง
  [/ฆ่า/g, 'ทำให้เสียชีวิต'],
  [/ฆาตกรรม/g, 'เหตุสูญเสีย'],
  [/หมกศพ/g, 'ซ่อนร่างผู้เสียชีวิต'],
  [/ชำแหละ/g, 'เหตุรุนแรงอย่างยิ่ง'],
  [/ศพ/g, 'ร่างผู้เสียชีวิต'],
  [/แทงตาย/g, 'ใช้ของมีคมจนเสียชีวิต'],
  [/ยิงตาย/g, 'ใช้อาวุธปืนจนเสียชีวิต'],
  [/ดับสลด/g, 'เสียชีวิตอย่างสะเทือนใจ'],
  [/ดับคาที่/g, 'เสียชีวิตในที่เกิดเหตุ'],
  [/สยองขวัญ/g, 'สะเทือนขวัญ'],
  [/สยอง/g, 'สะเทือนใจ'],
  [/โหดเหี้ยม/g, 'รุนแรงอย่างยิ่ง'],
  [/โหด/g, 'รุนแรง'],
  [/เลือดสาด/g, 'เหตุรุนแรง'],
  [/เลือดอาบ/g, 'เหตุรุนแรง'],
  [/ทุบตี/g, 'ใช้ความรุนแรง'],
  // Self-harm
  [/ผูกคอตาย/g, 'เสียชีวิตอย่างน่าเศร้า'],
  [/ผูกคอ/g, 'เสียชีวิตอย่างน่าเศร้า'],
  [/กระโดดตึก/g, 'เสียชีวิตจากที่สูง'],
  [/จบชีวิตตัวเอง/g, 'จากไปอย่างกะทันหัน'],
  [/อยากตาย/g, 'ภาวะเครียดสะสม'],
  // Sexual
  [/ข่มขืน/g, 'ล่วงละเมิดทางเพศ'],
  [/อนาจาร/g, 'กระทำไม่เหมาะสม'],
  // Clickbait
  [/คุณจะไม่เชื่อ/g, 'หลายคนพูดถึง'],
  [/แชร์ด่วน/g, 'กลายเป็นประเด็น'],
  [/ดูก่อนโดนลบ/g, 'เป็นที่สนใจ'],
  [/อึ้งทั้งประเทศ/g, 'เป็นที่วิพากษ์วิจารณ์'],
  [/รีบดูด่วน/g, 'น่าติดตาม'],
  // Engagement bait
  [/พิมพ์ 1/g, 'คุณคิดเห็นยังไง'],
  [/เมนต์ 99/g, 'แสดงความเห็น'],
  [/แชร์วนไป/g, 'แบ่งปันให้คนรู้จัก'],
  [/ใครเห็นด้วยกดไลก์/g, 'คุณเห็นด้วยไหม'],
];

/**
 * Recursively sanitize output — replace คำเสี่ยงในทุก string ภายใน object/array
 * @param {any} obj — parsed JSON response จาก AI
 * @returns {any} — sanitized version
 */
// ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S1 · เจ้าของอนุมัติ): ตัวเดิมทุกไบต์ย้ายชื่อเป็น sanitizeLegacy —
//   ทำงานเมื่อ SANITIZE_LEGACY=1 เท่านั้น (sanitizeOutput ตัวใหม่อยู่ท้ายไฟล์ · ของเดิม: export function sanitizeOutput(obj))
function sanitizeLegacy(obj) {
  if (typeof obj === 'string') {
    let result = obj;
    for (const [pattern, replacement] of SAFETY_REPLACEMENTS) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeLegacy(item));
  }
  if (obj && typeof obj === 'object') {
    const sanitized = {};
    for (const [key, val] of Object.entries(obj)) {
      sanitized[key] = sanitizeLegacy(val);
    }
    return sanitized;
  }
  return obj;
}

// ═══════════════════════════════════════════════════════════════════════════
// ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S1 · เจ้าของอนุมัติ) — ตัวกรองขอบคำ (ค่าเริ่มต้น)
// ═══════════════════════════════════════════════════════════════════════════

const SANITIZE_LEGACY_VALUES = new Set(['1', 'true', 'on', 'yes', 'legacy']);

/** สวิตช์ถอย SANITIZE_LEGACY — อ่านตอนเรียกทุกครั้ง (ไม่แคช) · ไม่ตั้ง/0/off = ตัวกรองขอบคำ */
export function isSanitizeLegacy() {
  const raw = process.env.SANITIZE_LEGACY;
  if (raw == null) return false;
  return SANITIZE_LEGACY_VALUES.has(String(raw).trim().replace(/^["']|["']$/g, '').toLowerCase());
}

/**
 * ตารางกฎใหม่ — แทนเฉพาะเมื่อ "ทั้งวลี" อยู่บนขอบคำ (Intl.Segmenter 'th' granularity word)
 *   find        สตริงตรงตัว (ไม่ใช่ regex) · กฎยาวชนะกฎสั้นเสมอ (เรียงตามความยาวตอนโหลด)
 *   to          คำแทนหลัก — ห้ามยืนยันการตายที่ต้นฉบับไม่ได้บอก (ข้อ ค ของแคมเปญ)
 *   prevBlock   ข้อความที่ "ติดหน้า" แล้วห้ามแทน = คำประสม/ราชาศัพท์ (ยาฆ่าเชื้อ · ทรงฆ่า · พระศพ · งานศพ)
 *   nextBlock   ข้อความที่ "ติดหลัง" แล้วห้ามแทน (ฆ่าเวลา · ฆ่าแมลง · โหดสัส)
 *   onNegation  คำแทนเมื่อมีคำปฏิเสธ (ไม่/มิ) ติดหน้าใน 3 คำ · null = คงคำเดิม
 *   onAttempt   คำแทนเมื่อมีคำบ่ง "พยายาม/คิด/ขู่/จะ…" ติดหน้าใน 2 คำ (ยังไม่ตาย → ห้ามเขียนว่าเสียชีวิต)
 *   afterNumberTo  คำแทนเมื่อเป็นลักษณนามหลังตัวเลข ("3 ศพ" → "3 ราย" — เดิมได้ "3 ร่างผู้เสียชีวิต")
 *   needsBoundary  คำสั้นที่เป็นส่วนของคำอื่นได้ (ศพ/ฆ่า/โหด/สยอง) — ถ้าไม่มี Intl.Segmenter ให้ "ไม่แทน" ดีกว่าแทนพลาด
 * เหตุผลคำแทนที่ต่างจากตารางเดิม (บันทึกใน C:\tmp\news-g1-samples\S1.md):
 *   ผูกคอ → ทำร้ายตัวเอง (เดิม เสียชีวิตอย่างน่าเศร้า = เพิ่มการตาย) · กระโดดตึก → ตกจากที่สูง (เดิม เสียชีวิตจากที่สูง)
 *   ฆ่าตัวตาย → จากไปอย่างน่าเศร้า (เดิมได้ "ทำให้เสียชีวิตตัวตาย") · โหดร้าย → รุนแรง (เดิมได้ "รุนแรงร้าย")
 *   พบศพ/ซากศพ แยกกฎเพราะ ICU ตัดเป็นคำเดียว (กฎ "ศพ" จับไม่ถึง)
 * ★ 24 ก.ย. 69 (S2): ตารางนี้ = โหมดถอย RISK_WORDS_LEGACY=1 เท่านั้น (ห้ามแก้) — ค่าเริ่มต้นอ่านชุด 'sanitize' จาก ./riskWords.js
 *   ซึ่งคัดลอกกฎเหล่านี้ไว้ครบทุกข้อในลำดับเดิม (เพิ่มเฉพาะ id/severity/group ให้ L2 ใช้ร่วม) — ต่างจุดเดียว: 'โหด' nextBlock + 'ร้อน'
 *   (lookahead (?!ร้อน) ของ L2 เดิม รวมเข้าตารางกลาง) · ข้อสอบ tests/risk-words-single-source.test.mjs B3 ล็อกความต่างไว้แค่จุดนี้
 */
const WORD_RULES = [
  // ความรุนแรง
  { find: 'ฆ่าตัวตาย', to: 'จากไปอย่างน่าเศร้า', onNegation: 'ทำร้ายตัวเอง', onAttempt: 'ทำร้ายตัวเอง' },
  { find: 'ฆ่า', to: 'ทำให้เสียชีวิต', needsBoundary: true,
    prevBlock: ['ยา', 'น้ำยา', 'สาร', 'นัก', 'ทรง', 'เครื่อง'],
    nextBlock: ['เชื้อ', 'แมลง', 'หญ้า', 'เวลา', 'ปลวก', 'ยุง', 'ไวรัส', 'แบคทีเรีย'] },
  { find: 'ฆาตกรรม', to: 'เหตุสูญเสีย' },
  { find: 'หมกศพ', to: 'ซ่อนร่างผู้เสียชีวิต' },
  { find: 'ชำแหละ', to: 'เหตุรุนแรงอย่างยิ่ง' },
  { find: 'พบศพ', to: 'พบร่างผู้เสียชีวิต' },
  { find: 'ซากศพ', to: 'ร่างผู้เสียชีวิต' },
  { find: 'ศพ', to: 'ร่างผู้เสียชีวิต', needsBoundary: true, afterNumberTo: 'ราย',
    prevBlock: ['พระ', 'พระบรม', 'บรม', 'งาน', 'หลุม', 'โลง', 'สวด'] },
  { find: 'แทงตาย', to: 'ใช้ของมีคมจนเสียชีวิต' },
  { find: 'ยิงตาย', to: 'ใช้อาวุธปืนจนเสียชีวิต' },
  { find: 'ดับสลด', to: 'เสียชีวิตอย่างสะเทือนใจ' },
  { find: 'ดับคาที่', to: 'เสียชีวิตในที่เกิดเหตุ' },
  { find: 'สยองขวัญ', to: 'สะเทือนขวัญ' },
  { find: 'สยอง', to: 'สะเทือนใจ', needsBoundary: true },
  { find: 'โหดเหี้ยม', to: 'รุนแรงอย่างยิ่ง' },
  { find: 'โหดร้าย', to: 'รุนแรง' },
  { find: 'โหด', to: 'รุนแรง', needsBoundary: true, nextBlock: ['สัส'] },
  { find: 'เลือดสาด', to: 'เหตุรุนแรง' },
  { find: 'เลือดอาบ', to: 'เหตุรุนแรง' },
  { find: 'ทุบตี', to: 'ใช้ความรุนแรง' },
  // Self-harm — ห้ามยืนยันการตายที่ต้นฉบับไม่มี
  { find: 'ผูกคอตาย', to: 'เสียชีวิตอย่างน่าเศร้า', onNegation: 'ทำร้ายตัวเอง', onAttempt: 'ทำร้ายตัวเอง' },
  { find: 'ผูกคอ', to: 'ทำร้ายตัวเอง' },
  { find: 'กระโดดตึกตาย', to: 'เสียชีวิตจากที่สูง', onNegation: 'ทำร้ายตัวเอง', onAttempt: 'ทำร้ายตัวเอง' },
  { find: 'กระโดดตึก', to: 'ตกจากที่สูง' },
  { find: 'จบชีวิตตัวเอง', to: 'จากไปอย่างกะทันหัน', onNegation: 'ทำร้ายตัวเอง', onAttempt: 'ทำร้ายตัวเอง' },
  { find: 'อยากตาย', to: 'ภาวะเครียดสะสม', onNegation: null },
  // Sexual
  { find: 'ข่มขืน', to: 'ล่วงละเมิดทางเพศ' },
  { find: 'อนาจาร', to: 'กระทำไม่เหมาะสม' },
  // Clickbait
  { find: 'คุณจะไม่เชื่อ', to: 'หลายคนพูดถึง' },
  { find: 'แชร์ด่วน', to: 'กลายเป็นประเด็น' },
  { find: 'ดูก่อนโดนลบ', to: 'เป็นที่สนใจ' },
  { find: 'อึ้งทั้งประเทศ', to: 'เป็นที่วิพากษ์วิจารณ์' },
  { find: 'รีบดูด่วน', to: 'น่าติดตาม' },
  // Engagement bait — ตัวเลขต้องจบที่ขอบคำ (พิมพ์ 10 / พิมพ์ 1,500 ไม่โดน)
  { find: 'พิมพ์ 1', to: 'คุณคิดเห็นยังไง' },
  { find: 'เมนต์ 99', to: 'แสดงความเห็น' },
  { find: 'แชร์วนไป', to: 'แบ่งปันให้คนรู้จัก' },
  { find: 'ใครเห็นด้วยกดไลก์', to: 'คุณเห็นด้วยไหม' },
];
const WORD_RULES_ORDERED = [...WORD_RULES].sort((a, b) => b.find.length - a.find.length);

// ICU ตัด "ไม่มี/ไม่ได้/ไม่เคย" เป็นคำเดียวได้ → นับคำที่ขึ้นต้นด้วย "ไม่" ทั้งหมด · "มิ" เฉพาะคำเต็ม (มิตร/มิถุนายน ไม่ใช่ปฏิเสธ)
const isNegationWord = (w) => w === 'ไม่' || w.startsWith('ไม่') || w === 'มิ' || w === 'มิได้';
const ATTEMPT_WORDS = new Set(['พยายาม', 'คิด', 'อยาก', 'เกือบ', 'จะ', 'กำลัง', 'ตั้งใจ', 'เตรียม', 'ขู่', 'หวัง', 'ห้าม']);
// ชื่อเฉพาะ/ชื่อรายการในเครื่องหมายคำพูด (สั้น ≤ 40 ตัวอักษร ไม่ข้ามบรรทัด) — คงตามต้นฉบับ
const QUOTE_PAIRS = [['“', '”'], ['"', '"'], ['‘', '’'], ['«', '»'], ['「', '」'], ['『', '』']];
const QUOTED_NAME_MAX = 40;

let _thaiSegmenter; // undefined = ยังไม่ลอง · null = รันไทม์ไม่มี Intl.Segmenter (Node ≥16 / Vercel มีครบ)
function getThaiSegmenter() {
  if (_thaiSegmenter !== undefined) return _thaiSegmenter;
  try {
    _thaiSegmenter = new Intl.Segmenter('th', { granularity: 'word' });
  } catch {
    _thaiSegmenter = null;
  }
  return _thaiSegmenter;
}

function quotedRanges(str) {
  const ranges = [];
  for (const [open, close] of QUOTE_PAIRS) {
    let from = 0;
    for (;;) {
      const i = str.indexOf(open, from);
      if (i === -1) break;
      const j = str.indexOf(close, i + 1);
      if (j === -1) break;
      const inner = str.slice(i + 1, j);
      if (inner.length > 0 && inner.length <= QUOTED_NAME_MAX && !inner.includes('\n')) {
        ranges.push([i + 1, j]);
        from = j + 1;
      } else {
        from = i + 1;
      }
    }
  }
  return ranges;
}

const overlapsAny = (ranges, s, e) => ranges.some(([a, b]) => s < b && a < e);

/** คำ (word-like) ที่ติดกันหน้าตำแหน่ง s ย้อนหลังไม่เกิน n คำ — หยุดที่ช่องว่าง/เครื่องหมาย (คนละวลี) */
function precedingWords(tokens, tokenIdxByStart, s, n) {
  const words = [];
  let idx = tokenIdxByStart.get(s);
  if (idx === undefined) return words;
  for (let k = idx - 1; k >= 0 && words.length < n; k--) {
    if (!tokens[k].word) break;
    words.push(tokens[k].text);
  }
  return words;
}

// โหมดไม่มี Intl.Segmenter: ดูท้ายข้อความก่อนหน้าแทนโทเค็น (หยาบกว่า แต่ไม่พลาดด้านปลอดภัย)
const NEGATION_TAIL_RE = /(?:ไม่|มิ)(?:ได้|เคย|มี|ใคร|ยอม|อยาก|คิด)?$/;
const ATTEMPT_TAIL_RE = new RegExp(`(?:${[...ATTEMPT_WORDS].join('|')})(?:จะ)?$`);

/**
 * ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S2 · เจ้าของอนุมัติ) — เครื่องสแกนกลาง (ตัว S1 แยก rules ออกเป็นพารามิเตอร์)
 *   ใช้ทั้งตัวกรอง (sanitize) และด่าน L2 (audit) — กติกาขอบคำ/คำประสม/ราชาศัพท์/ชื่อในเครื่องหมายคำพูด/ปฏิเสธ/พยายาม ชุดเดียวกัน
 *   กฎ find = ตรรกะ S1 ทุกบรรทัด · กฎ pattern (regex มี g — บริบทซับซ้อนที่ยกมาจาก L2 เดิม) ไม่เช็คขอบคำ/prevBlock เพราะ regex กำหนดบริบทเอง
 *   คืน hit [{ start, end, text, replacement, rule }] เรียงตามตำแหน่ง ไม่ซ้อนกัน (กฎยาวชนะ) · กฎที่ตอบ "คงคำเดิม" (replacement null)
 *   ยังจองช่วงไว้กันกฎสั้นกว่าแทรก (เช่น "ไม่อยากตาย" ต้องไม่ถูกกฎ "ตาย" ของ L2 จับ) แต่ไม่คืนเป็น hit
 *   ของเดิม: ตรรกะนี้อยู่ใน sanitizeThaiText ผูกกับ WORD_RULES_ORDERED และคืนสตริงที่แทนแล้ว
 * @param {string} str
 * @param {Array} rules   กฎที่เรียงแล้ว (riskRulesForStage / WORD_RULES_ORDERED)
 * @param {{ segmenter?: Intl.Segmenter|null }} [opts]  segmenter: null = จำลองรันไทม์ที่ไม่มี Intl.Segmenter (ใช้ในเทส)
 */
export function scanRiskRules(str, rules, opts) {
  if (typeof str !== 'string' || !str) return [];
  if (!rules.some((rule) => (rule.find ? str.includes(rule.find) : rule.test.test(str)))) return []; // ทางด่วน: ไม่มีคำเสี่ยงเลย
  const segmenter = opts && Object.prototype.hasOwnProperty.call(opts, 'segmenter') ? opts.segmenter : getThaiSegmenter();

  let boundaries = null;
  let tokens = null;
  const tokenIdxByStart = new Map();
  if (segmenter) {
    tokens = [];
    for (const seg of segmenter.segment(str)) {
      tokenIdxByStart.set(seg.index, tokens.length);
      tokens.push({ text: seg.segment, start: seg.index, word: !!seg.isWordLike });
    }
    boundaries = new Set(tokens.map((t) => t.start));
    boundaries.add(str.length);
  }
  const protectedRanges = quotedRanges(str);
  const taken = []; // [start, end, replacement|null(คงคำเดิม), rule, text]

  for (const rule of rules) {
    if (rule.pattern) { // ★ S2: กฎ regex ของ L2 เดิม — regex กำหนดบริบทเอง (ไม่เช็คขอบคำ/prevBlock/nextBlock)
      rule.pattern.lastIndex = 0;
      for (const m of str.matchAll(rule.pattern)) {
        const s = m.index;
        const e = s + m[0].length;
        if (e === s || overlapsAny(taken, s, e) || overlapsAny(protectedRanges, s, e)) continue;
        taken.push([s, e, rule.to, rule, m[0]]);
      }
      continue;
    }
    let from = 0;
    for (;;) {
      const s = str.indexOf(rule.find, from);
      if (s === -1) break;
      from = s + 1;
      const e = s + rule.find.length;
      if (overlapsAny(taken, s, e) || overlapsAny(protectedRanges, s, e)) continue;
      if (boundaries) {
        if (!boundaries.has(s) || !boundaries.has(e)) continue; // กลางคำ (ประเทศ|พม่า · ตายตัว · 10 · 1,500)
      } else {
        if (rule.needsBoundary) continue; // ไม่มีตัวตัดคำ → คำสั้นไม่แตะ ดีกว่าแทนกลางคำ
        if (/\d$/.test(rule.find) && /[\d.,]/.test(str.charAt(e))) continue; // พิมพ์ 10 / 1,500
      }
      const before = str.slice(0, s);
      const after = str.slice(e);
      if (rule.prevBlock && rule.prevBlock.some((w) => before.endsWith(w))) continue;
      if (rule.nextBlock && rule.nextBlock.some((w) => after.startsWith(w))) continue;

      let replacement = rule.to;
      if (rule.afterNumberTo !== undefined && /\d ?$/.test(before)) replacement = rule.afterNumberTo;
      if (rule.onNegation !== undefined || rule.onAttempt !== undefined) {
        const prev3 = tokens ? precedingWords(tokens, tokenIdxByStart, s, 3) : null;
        const negated = prev3 ? prev3.some(isNegationWord) : NEGATION_TAIL_RE.test(before);
        const attempted = prev3 ? prev3.slice(0, 2).some((w) => ATTEMPT_WORDS.has(w)) : ATTEMPT_TAIL_RE.test(before);
        if (negated && rule.onNegation !== undefined) replacement = rule.onNegation;
        else if (attempted && rule.onAttempt !== undefined) replacement = rule.onAttempt;
      }
      // คงคำเดิม (เช่น "ไม่อยากตาย") — ★ S2: จองช่วงไว้ด้วย กันกฎสั้นกว่าของ L2 ("ตาย") แทรกเข้ามาจับ (ของเดิม: continue เฉยๆ)
      taken.push([s, e, replacement, rule, rule.find]);
    }
  }
  taken.sort((a, b) => a[0] - b[0]);
  return taken.filter((t) => t[2] !== null).map(([start, end, replacement, rule, text]) => ({ start, end, text, replacement, rule }));
}

/** ประกอบข้อความจาก hit ของ scanRiskRules (ตรรกะประกอบผลของ S1) */
export function applyRiskHits(str, hits) {
  if (!hits || hits.length === 0) return str;
  let out = '';
  let cursor = 0;
  for (const { start, end, replacement } of hits) {
    out += str.slice(cursor, start) + replacement;
    cursor = end;
  }
  return out + str.slice(cursor);
}

/**
 * แทนคำเสี่ยงในข้อความเดียวแบบดูขอบคำ (ค่าเริ่มต้นของ sanitizeOutput)
 *   ค่าเริ่มต้น: กฎชุด 'sanitize' จากตารางกลาง ./riskWords.js · RISK_WORDS_LEGACY=1: WORD_RULES ของ S1 ในไฟล์นี้
 *   (ทั้งสองชุดมีกฎ/ลำดับเท่ากัน — ตารางกลางเป็น "แหล่งเดียว" ที่ L2/L3/พรอมต์ใช้ร่วม)
 * @param {string} str
 * @param {{ segmenter?: Intl.Segmenter|null }} [opts]  segmenter: null = จำลองรันไทม์ที่ไม่มี Intl.Segmenter (ใช้ในเทส)
 */
export function sanitizeThaiText(str, opts) {
  if (typeof str !== 'string' || !str) return str;
  const rules = isRiskWordsLegacy() ? WORD_RULES_ORDERED : riskRulesForStage('sanitize');
  return applyRiskHits(str, scanRiskRules(str, rules, opts));
}

/**
 * ★ 24 ก.ย. 69 (S2) — ด่าน L2 ใช้: หาคำเสี่ยงทุกกฎในตาราง (ชุด 'audit') ด้วยเครื่องสแกนเดียวกับตัวกรอง
 *   → L2 จึงไม่จับกลางคำ (ประเทศพม่า/ทศพล) ไม่จับชื่อเรื่องในเครื่องหมายคำพูด และไม่จับคำแทนที่ตัวกรองสร้างเอง (ตารางปิด)
 * @returns {Array<{ start:number, end:number, text:string, replacement:string, rule:object }>}
 */
export function findRiskWords(str, opts) {
  return scanRiskRules(str, riskRulesForStage('audit'), opts);
}

/**
 * ★ 24 ก.ย. 69 (S2) — PL-04: แทนคำตาม issue ของ L2 "ตรงตำแหน่งที่กฎเดียวกันจับได้" (สแกนใหม่บนข้อความปัจจุบันด้วยกฎทั้งชุด audit
 *   แล้วเลือกเฉพาะ hit ของกฎ issue.ruleId) — ไม่ใช่ String.replace ตำแหน่งแรกที่อาจไปโดนคำที่กฎยกเว้นไว้ (ทำร้ายตัวเอง / ยิงประตู / เส้นเลือด / ระดับ)
 * @param {string} text
 * @param {{ ruleId?: string }} issue   issue จาก auditOutput (ต้องมี ruleId)
 * @param {{ all?: boolean }} [options] all=true แทนทุกตำแหน่งที่กฎจับ (rollback scrub) · ค่าเริ่มต้นแทนตำแหน่งแรกที่กฎจับ
 * @returns {string|null} ข้อความที่แทนแล้ว · null = ไม่มี ruleId/ไม่รู้จักกฎ/กฎไม่จับอะไรในข้อความปัจจุบัน (caller คงข้อความเดิม)
 */
export function replaceRiskWordIssue(text, issue, options) {
  const rule = issue && issue.ruleId ? getRiskRule(issue.ruleId) : null;
  if (!rule || typeof text !== 'string' || !text) return null;
  const hits = findRiskWords(text).filter((hit) => hit.rule === rule);
  if (hits.length === 0) return null;
  return applyRiskHits(text, options && options.all ? hits : hits.slice(0, 1));
}

function sanitizeDeep(obj) {
  if (typeof obj === 'string') return sanitizeThaiText(obj);
  if (Array.isArray(obj)) return obj.map((item) => sanitizeDeep(item));
  if (obj && typeof obj === 'object') {
    const sanitized = {};
    for (const [key, val] of Object.entries(obj)) {
      sanitized[key] = sanitizeDeep(val);
    }
    return sanitized;
  }
  return obj;
}

/**
 * Recursively sanitize output — แทนคำเสี่ยงในทุก string ภายใน object/array
 * @param {any} obj — parsed JSON response จาก AI
 * @param {{ scope?: 'facts'|'post' }} [options]
 *   scope 'facts' = ผลข้อเท็จจริง (สกัด/แตกประเด็น/blueprint/รีเสิร์ช) → คืน obj เดิมไม่แตะ (อ้างอิงเดิม)
 *   scope 'post' / ไม่ส่ง = ข้อความที่จะโพสต์ (นักเขียน/หลัง correction) → ตัวกรองขอบคำ
 *   SANITIZE_LEGACY=1 → sanitizeLegacy เดิมทุกไบต์ ไม่สน scope
 * @returns {any} — sanitized version
 */
export function sanitizeOutput(obj, options) {
  if (isSanitizeLegacy()) return sanitizeLegacy(obj);
  if (options && options.scope === 'facts') return obj;
  return sanitizeDeep(obj);
}
