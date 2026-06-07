/**
 * ========================================
 * NEWS FILTER SERVICE — กรองข่าวให้เหลือแต่แก่น
 * ========================================
 * 
 * ระบบวิเคราะห์และกรองเนื้อข่าวไทย:
 * - Rule-based: ใช้ pattern matching จำแนกประโยค
 * - AI-powered: ใช้ GPT-4o-mini วิเคราะห์ลึก
 * 
 * ประเภทประโยค:
 *   FACT             → ข้อเท็จจริง ตัวเลข ชื่อ สถานที่
 *   QUOTE            → คำพูดจากแหล่งข่าว
 *   CONTEXT          → บริบทช่วยเข้าใจเรื่อง
 *   FILLER           → คำฟุ่มเฟือย ไม่มีสาระ
 *   EMOTIONAL_WRITING → เขียนเร้าอารมณ์เกินจริง
 *   INTERPRETATION   → ตีความ/สรุปเอง
 *   UNSUPPORTED      → กล่าวอ้างไม่มีหลักฐาน
 * 
 * โหมดกรอง:
 *   soft     → ตัดแค่ filler หนักๆ (fillerScore > 80)
 *   balanced → ตัด filler ปานกลาง + อารมณ์เกิน (fillerScore > 50 OR emotionalScore > 60)
 *   strict   → เก็บเฉพาะข้อเท็จจริง (factualScore > 60)
 */

import { callAI } from '@/lib/ai/openai';
import { MODEL_FAST } from '@/lib/ai/modelConfig';

// =============================================
// PATTERN DEFINITIONS — คำ/วลีสำหรับจำแนกประโยค
// =============================================

/** คำบ่งชี้คำพูด/การอ้างอิง */
const QUOTE_PATTERNS = [
  /\u201C.*?\u201D/,    // "..." (Thai/Unicode quotes)
  /\u201E.*?\u201F/,    // „..."
  /".*?"/,              // "..." (straight quotes)
  /เผยว่า/,
  /กล่าวว่า/,
  /บอกว่า/,
  /ระบุว่า/,
  /ให้สัมภาษณ์ว่า/,
  /ยืนยันว่า/,
  /ชี้แจงว่า/,
  /โพสต์ข้อความว่า/,
  /เขียนว่า/,
  /ตอบว่า/,
  /พูดว่า/,
];

/** คำบ่งชี้ข้อเท็จจริง — ตัวเลข วันที่ ชื่อเฉพาะ สถิติ */
const FACT_PATTERNS = [
  /\d+/,                         // ตัวเลขใดๆ
  /วันที่\s*\d+/,                // วันที่ + ตัวเลข
  /\d+\s*(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)/,
  /\d+\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)/,
  /\d+\s*(บาท|ล้าน|พัน|แสน|หมื่น|คน|ราย|ครั้ง|ชั่วโมง|นาที|กิโลเมตร|เมตร|กก\.|กม\.)/,
  /พ\.ศ\.\s*\d+/,
  /ค\.ศ\.\s*\d+/,
  /เวลา\s*\d+/,
  /อายุ\s*\d+/,
  /จังหวัด/,
  /อำเภอ/,
  /ตำบล/,
  /ถนน/,
  /ซอย/,
  /สถานี/,
  /โรงพยาบาล/,
  /มหาวิทยาลัย/,
  /กระทรวง/,
  /กรม/,
  /สำนักงาน/,
  /พล\.ต\.อ\.|พล\.ต\.ท\.|พล\.อ\.|นาย|นาง|นางสาว|ดร\.|ศ\.|ผศ\./,
];

/** คำฟุ่มเฟือย — ประโยคไม่มีข้อมูลจริง */
const FILLER_PATTERNS = [
  /^มีไม่น้อย/,
  /^หลายคน/,
  /^ใครจะคิดว่า/,
  /^ทุกคนรู้ว่า/,
  /^กลายเป็น/,
  /^ต้องบอกว่า/,
  /^ไม่น่าเชื่อว่า/,
  /^เรื่องมีอยู่ว่า/,
  /^พูดถึงเรื่องนี้/,
  /^อย่างที่ทราบกัน/,
  /^เรียกได้ว่า/,
  /^ถือเป็น/,
  /^นับว่า/,
  /^ปฏิเสธไม่ได้ว่า/,
  /^แน่นอนว่า/,
  /^เชื่อว่าทุกคน/,
  /สร้างความฮือฮา/,
  /กลายเป็นกระแส/,
  /เป็นอย่างมาก/,
  /สร้างเสียงฮือฮา/,
  /กลายเป็นที่พูดถึง/,
  /ถูกพูดถึงอย่างกว้างขวาง/,
];

/** คำเร้าอารมณ์ — เขียนเวอร์เกินจริง */
const EMOTIONAL_PATTERNS = [
  /ชีวิตจริงไม่ได้รอ/,
  /กลายเป็นภาพจำ/,
  /หัวใจสลาย/,
  /น้ำตาซึม/,
  /สะเทือนใจ/,
  /สุดซึ้ง/,
  /ปาดน้ำตา/,
  /เวอร์ชันที่ดีที่สุด/,
  /ใจสั่น/,
  /ตื้นตัน/,
  /น้ำตาไหล/,
  /ขนลุก/,
  /ใจหาย/,
  /สุดเศร้า/,
  /สุดสะเทือน/,
  /โศกนาฏกรรม/,
  /แตกสลาย/,
  /พังทลาย/,
  /สุดแสนเจ็บปวด/,
  /ช็อกทั้งประเทศ/,
  /สะท้านใจ/,
  /ร้องไห้ไม่หยุด/,
  /ใจจะขาด/,
  /สุดจะทน/,
  /สลดใจ/,
  /เศร้าสุดๆ/,
  /รันทดใจ/,
];

/** คำตีความ/สรุปเอง — ไม่ใช่ข้อเท็จจริง */
const INTERPRETATION_PATTERNS = [
  /อาจ/,
  /น่าจะ/,
  /สะท้อนว่า/,
  /แสดงให้เห็นว่า/,
  /เปรียบเสมือน/,
  /เท่ากับว่า/,
  /พูดง่ายๆ\s*คือ/,
  /หมายความว่า/,
  /คาดว่า/,
  /เชื่อว่า/,
  /ถ้ามองกันจริงๆ/,
  /พูดตรงๆ\s*คือ/,
  /ให้สรุปง่ายๆ/,
  /มองได้ว่า/,
  /ตีความได้ว่า/,
  /เรียกได้ว่า/,
];

/** คำบ่งชี้ UNSUPPORTED — กล่าวอ้างไม่มีหลักฐาน */
const UNSUPPORTED_PATTERNS = [
  /มีรายงานว่า(?!.*\(แหล่งข่าว)/,
  /แหล่งข่าวเผย(?!.*ชื่อ)/,
  /ว่ากันว่า/,
  /เป็นที่ทราบกันว่า/,
  /ทุกคนรู้ดีว่า/,
  /ไม่มีใครปฏิเสธได้ว่า/,
  /เห็นได้ชัดว่า/,
  /ไม่ต้องสงสัยเลยว่า/,
];

/** คำบ่งชี้บริบท — ข้อมูลพื้นหลัง */
const CONTEXT_PATTERNS = [
  /ก่อนหน้านี้/,
  /ย้อนกลับไป/,
  /สำหรับเรื่องนี้/,
  /ที่ผ่านมา/,
  /ตั้งแต่ปี/,
  /ตั้งแต่เดือน/,
  /มีประวัติ/,
  /เคยเกิดขึ้น/,
  /เป็นที่รู้จักในฐานะ/,
  /พื้นที่ดังกล่าว/,
  /ข้อมูลเพิ่มเติม/,
  /ทั้งนี้/,
  /โดยก่อนหน้านี้/,
];


// =============================================
// SENTENCE SPLITTING — แยกข้อความเป็นประโยค
// =============================================

/**
 * แยกข้อความไทยเป็นประโยค
 * ใช้ newline, จุดตามด้วย space, และ pattern ภาษาไทย
 * @param {string} text - ข้อความต้นฉบับ
 * @returns {string[]} — array ของประโยค (ตัดช่องว่างแล้ว)
 */
function splitSentences(text) {
  if (!text || typeof text !== 'string') return [];

  // ขั้นที่ 1: แยกด้วย newline ก่อน
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);

  const sentences = [];
  for (const line of lines) {
    // ขั้นที่ 2: แยกด้วยจุดตามด้วย space หรือจุดท้ายประโยค
    // รวมถึง pattern "ครับ " / "ค่ะ " ที่บ่งชี้จบประโยค
    const parts = line.split(/(?<=\.)\s+|(?<=ครับ)\s+|(?<=ค่ะ)\s+|(?<=นะครับ)\s+|(?<=นะคะ)\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    sentences.push(...parts);
  }

  return sentences;
}


// =============================================
// CLASSIFICATION — จำแนกประเภทประโยค
// =============================================

/**
 * จำแนกประเภทประโยคด้วย rule-based
 * @param {string} sentence - ประโยคที่จะจำแนก
 * @returns {{ type: string, scores: object, reason: string }}
 */
function classifySentence(sentence) {
  if (!sentence || sentence.trim().length === 0) {
    return {
      type: 'FILLER',
      scores: { factualScore: 0, fillerScore: 100, emotionalScore: 0, unsupportedScore: 0 },
      reason: 'ประโยคว่าง',
    };
  }

  const trimmed = sentence.trim();

  // นับ pattern ที่ match แต่ละประเภท
  const quoteHits = QUOTE_PATTERNS.filter(p => p.test(trimmed)).length;
  const factHits = FACT_PATTERNS.filter(p => p.test(trimmed)).length;
  const fillerHits = FILLER_PATTERNS.filter(p => p.test(trimmed)).length;
  const emotionalHits = EMOTIONAL_PATTERNS.filter(p => p.test(trimmed)).length;
  const interpretationHits = INTERPRETATION_PATTERNS.filter(p => p.test(trimmed)).length;
  const unsupportedHits = UNSUPPORTED_PATTERNS.filter(p => p.test(trimmed)).length;
  const contextHits = CONTEXT_PATTERNS.filter(p => p.test(trimmed)).length;

  // คำนวณ score 0-100 — ยิ่งเจอ pattern เยอะ ยิ่งมั่นใจ
  const factualScore = Math.min(100, factHits * 25 + quoteHits * 20);
  const fillerScore = Math.min(100, fillerHits * 40);
  const emotionalScore = Math.min(100, emotionalHits * 35);
  const unsupportedScore = Math.min(100, unsupportedHits * 50);

  // ตรวจประโยคสั้นเกินไป (< 10 ตัวอักษร) → มักเป็น filler
  const isVeryShort = trimmed.length < 10;
  const adjustedFillerScore = isVeryShort ? Math.max(fillerScore, 70) : fillerScore;

  // จัดลำดับความสำคัญ: QUOTE > FACT > UNSUPPORTED > EMOTIONAL > INTERPRETATION > FILLER > CONTEXT
  let type = 'CONTEXT'; // default
  let reason = 'เป็นข้อมูลบริบทประกอบ';

  if (quoteHits > 0) {
    type = 'QUOTE';
    reason = `มีคำพูดอ้างอิง (${quoteHits} จุด)`;
  } else if (factHits >= 2) {
    type = 'FACT';
    reason = `มีข้อเท็จจริง/ตัวเลข (${factHits} จุด)`;
  } else if (unsupportedHits > 0 && factHits === 0) {
    type = 'UNSUPPORTED';
    reason = `กล่าวอ้างไม่มีหลักฐาน (${unsupportedHits} จุด)`;
  } else if (emotionalHits >= 1) {
    type = 'EMOTIONAL_WRITING';
    reason = `เขียนเร้าอารมณ์ (${emotionalHits} คำ)`;
  } else if (interpretationHits >= 1 && factHits < 2) {
    type = 'INTERPRETATION';
    reason = `ตีความ/สรุปเอง (${interpretationHits} คำ)`;
  } else if (adjustedFillerScore >= 40) {
    type = 'FILLER';
    reason = isVeryShort ? 'ประโยคสั้นเกินไป ไม่มีสาระ' : `คำฟุ่มเฟือย (${fillerHits} คำ)`;
  } else if (contextHits > 0) {
    type = 'CONTEXT';
    reason = `ข้อมูลบริบท/พื้นหลัง (${contextHits} จุด)`;
  } else if (factHits >= 1) {
    // มี fact 1 จุด → ยังถือว่าเป็น FACT ได้
    type = 'FACT';
    reason = `มีข้อเท็จจริง (${factHits} จุด)`;
  }

  return {
    type,
    scores: {
      factualScore,
      fillerScore: adjustedFillerScore,
      emotionalScore,
      unsupportedScore,
    },
    reason,
  };
}


/**
 * กำหนด action สำหรับประโยค ตามโหมดกรอง + options
 * @param {object} classification - ผลจาก classifySentence
 * @param {string} mode - 'soft' | 'balanced' | 'strict'
 * @param {object} options - keepQuotes, keepContext, removeEmotional, removeInterpretation
 * @returns {'KEEP' | 'REMOVE' | 'TRIM'}
 */
function determineAction(classification, mode = 'balanced', options = {}) {
  const { type, scores } = classification;
  const {
    keepQuotes = true,
    keepContext = true,
    removeEmotional = false,
    removeInterpretation = false,
  } = options;

  // ประโยคที่ต้อง KEEP เสมอ (ตาม options)
  if (type === 'QUOTE' && keepQuotes) return 'KEEP';
  if (type === 'FACT') return 'KEEP';

  // ประโยคที่ต้อง REMOVE ตาม options
  if (type === 'EMOTIONAL_WRITING' && removeEmotional) return 'REMOVE';
  if (type === 'INTERPRETATION' && removeInterpretation) return 'REMOVE';

  // ตัดสินตามโหมด
  switch (mode) {
    case 'soft':
      // soft: ตัดแค่ filler หนักๆ
      if (scores.fillerScore > 80) return 'REMOVE';
      if (type === 'FILLER' && scores.fillerScore > 60) return 'TRIM';
      return 'KEEP';

    case 'strict':
      // strict: เก็บข้อเท็จจริง + quote + context ที่จำเป็น
      if (type === 'FACT') return 'KEEP';
      if (type === 'QUOTE' && keepQuotes) return 'KEEP';
      if (type === 'CONTEXT' && keepContext) return 'KEEP';
      if (scores.factualScore > 40) return 'KEEP'; // มีข้อเท็จจริงบ้าง → เก็บ
      if (type === 'FILLER') return 'REMOVE';
      if (type === 'EMOTIONAL_WRITING') return 'REMOVE';
      if (type === 'UNSUPPORTED') return 'REMOVE';
      if (type === 'INTERPRETATION') return 'REMOVE';
      // ประโยคที่ไม่ชัดเจน → TRIM
      return 'TRIM';

    case 'balanced':
    default:
      // balanced: ตัด filler ปานกลาง + อารมณ์เกิน
      if (scores.fillerScore > 50) return 'REMOVE';
      if (scores.emotionalScore > 60) return 'REMOVE';
      if (scores.unsupportedScore > 50) return 'REMOVE';
      if (type === 'CONTEXT' && !keepContext) return 'TRIM';
      if (type === 'FILLER') return 'TRIM';
      return 'KEEP';
  }
}


// =============================================
// MAIN EXPORTS — ฟังก์ชันหลัก
// =============================================

/**
 * วิเคราะห์ทุกประโยคในเนื้อข่าว (rule-based)
 * @param {string} text - เนื้อข่าวต้นฉบับ
 * @param {object} options - { mode, keepQuotes, keepContext, removeEmotional, removeInterpretation }
 * @returns {{ sentences: Array<{ text, type, scores, action, reason }> }}
 */
export function analyzeSentences(text, options = {}) {
  if (!text || typeof text !== 'string') {
    return { sentences: [] };
  }

  const { mode = 'balanced', ...filterOptions } = options;
  const rawSentences = splitSentences(text);

  const sentences = rawSentences.map((sentence) => {
    const classification = classifySentence(sentence);
    const action = determineAction(classification, mode, filterOptions);

    return {
      text: sentence,
      type: classification.type,
      scores: classification.scores,
      action,
      reason: classification.reason,
    };
  });

  return { sentences };
}


/**
 * กรองเนื้อข่าว — Rule-based (เร็ว ไม่ต้องใช้ API)
 * @param {string} text - เนื้อข่าวต้นฉบับ
 * @param {object} options - { mode, keepQuotes, keepContext, removeEmotional, removeInterpretation }
 * @returns {{ cleanText, stats, sentenceAnalysis, removedPatterns }}
 */
export function filterNews(text, options = {}) {
  if (!text || typeof text !== 'string') {
    return {
      cleanText: '',
      stats: { originalWordCount: 0, cleanWordCount: 0, removedPercent: 0, sentenceCount: 0, removedCount: 0, trimmedCount: 0 },
      sentenceAnalysis: [],
      removedPatterns: [],
    };
  }

  const { sentences } = analyzeSentences(text, options);

  // ประกอบข้อความที่กรองแล้ว
  const keptSentences = [];
  const removedPatterns = [];
  let removedCount = 0;
  let trimmedCount = 0;

  for (const s of sentences) {
    if (s.action === 'KEEP') {
      keptSentences.push(s.text);
    } else if (s.action === 'TRIM') {
      // TRIM: เก็บไว้แต่ mark ว่าถูก trim (อนาคตอาจตัดบางส่วน)
      keptSentences.push(s.text);
      trimmedCount++;
    } else {
      // REMOVE
      removedCount++;
      removedPatterns.push({
        text: s.text.slice(0, 80) + (s.text.length > 80 ? '...' : ''),
        type: s.type,
        reason: s.reason,
      });
    }
  }

  const cleanText = keptSentences.join('\n');

  // นับจำนวนคำ (ภาษาไทยนับตาม space + ความยาวตัวอักษร)
  const originalWordCount = countThaiWords(text);
  const cleanWordCount = countThaiWords(cleanText);
  const removedPercent = originalWordCount > 0
    ? Math.round(((originalWordCount - cleanWordCount) / originalWordCount) * 100)
    : 0;

  return {
    cleanText,
    stats: {
      originalWordCount,
      cleanWordCount,
      removedPercent,
      sentenceCount: sentences.length,
      removedCount,
      trimmedCount,
    },
    sentenceAnalysis: sentences,
    removedPatterns,
  };
}


/**
 * กรองเนื้อข่าว — AI-powered (ใช้ GPT-4o-mini วิเคราะห์ลึก)
 * ส่งข้อความให้ AI จำแนกแต่ละประโยค แล้วกรองตาม mode
 * 
 * // TODO: เพิ่ม option เปลี่ยนเป็น Claude สำหรับ AI classification
 * // เมื่อต้องการใช้ Claude ให้ import callClaude จาก '@/lib/ai/claudeClient'
 * // แล้วเปลี่ยน callAI เป็น callClaude ในฟังก์ชันนี้
 * 
 * @param {string} text - เนื้อข่าวต้นฉบับ
 * @param {object} options - { mode, keepQuotes, keepContext, removeEmotional, removeInterpretation }
 * @returns {Promise<{ cleanText, stats, sentenceAnalysis, removedPatterns }>}
 */
export async function filterNewsWithAI(text, options = {}) {
  if (!text || typeof text !== 'string') {
    return filterNews('', options);
  }

  const { mode = 'balanced', ...filterOptions } = options;

  // แยกประโยคก่อนส่งให้ AI
  const rawSentences = splitSentences(text);

  if (rawSentences.length === 0) {
    return filterNews('', options);
  }

  // สร้าง prompt สำหรับ AI classification
  const numberedSentences = rawSentences.map((s, i) => `[${i + 1}] ${s}`).join('\n');

  const aiPrompt = `คุณเป็นผู้เชี่ยวชาญด้านสื่อสารมวลชน ทำหน้าที่วิเคราะห์คุณภาพเนื้อข่าวไทย

จำแนกแต่ละประโยคด้านล่างเป็นประเภทใดประเภทหนึ่ง:
- FACT: ข้อเท็จจริง มีตัวเลข ชื่อคน สถานที่ วันที่ หรือข้อมูลเชิงประจักษ์
- QUOTE: คำพูด/คำให้สัมภาษณ์จากบุคคล มีเครื่องหมายคำพูดหรือคำว่า "กล่าวว่า/เผยว่า/บอกว่า"
- CONTEXT: ข้อมูลพื้นหลัง/บริบทที่ช่วยให้เข้าใจเรื่อง แต่ไม่ใช่เหตุการณ์หลัก
- FILLER: คำฟุ่มเฟือย วลีสำนวน ไม่มีข้อมูลใหม่ เช่น "กลายเป็นกระแส" "สร้างความฮือฮา"
- EMOTIONAL_WRITING: เขียนเร้าอารมณ์เกินจริง ใช้คำรุนแรง/ดราม่า ไม่จำเป็นสำหรับข้อเท็จจริง
- INTERPRETATION: ตีความ/วิเคราะห์/สรุปเอง ใช้คำว่า "อาจ" "น่าจะ" "สะท้อนว่า" "หมายความว่า"
- UNSUPPORTED: กล่าวอ้างโดยไม่มีหลักฐาน/แหล่งอ้างอิง เช่น "ว่ากันว่า" "ทุกคนรู้ดีว่า"

สำหรับแต่ละประโยค ให้:
1. type: ประเภท (FACT/QUOTE/CONTEXT/FILLER/EMOTIONAL_WRITING/INTERPRETATION/UNSUPPORTED)
2. factualScore: 0-100 (ความเป็นข้อเท็จจริง)
3. fillerScore: 0-100 (ความฟุ่มเฟือย)
4. emotionalScore: 0-100 (ความเร้าอารมณ์)
5. unsupportedScore: 0-100 (ความไม่มีหลักฐาน)
6. reason: เหตุผลสั้นๆ ภาษาไทย

=== ประโยคที่ต้องวิเคราะห์ ===
${numberedSentences}
=== จบ ===

ตอบเป็น JSON:
{
  "analysis": [
    {
      "index": 1,
      "type": "FACT",
      "factualScore": 85,
      "fillerScore": 5,
      "emotionalScore": 0,
      "unsupportedScore": 0,
      "reason": "มีตัวเลขและชื่อสถานที่ชัดเจน"
    }
  ]
}`;

  try {
    // เรียก AI classification — ใช้ gpt-4o-mini (เร็ว + ถูก)
    // TODO: เปลี่ยนเป็น callClaude ถ้าต้องการใช้ Claude
    const aiResult = await callAI({
      prompt: aiPrompt,
      model: MODEL_FAST,
      temperature: 0.2,
      maxTokens: 4000,
    });

    // แปลงผลจาก AI กลับมาเป็น format เดียวกับ rule-based
    const aiAnalysis = aiResult?.analysis;

    if (!aiAnalysis || !Array.isArray(aiAnalysis)) {
      // AI ส่งผลไม่ถูก format → fallback เป็น rule-based
      console.warn('[NewsFilter] AI ส่งผลไม่ถูก format → fallback เป็น rule-based');
      return filterNews(text, options);
    }

    // สร้าง sentence analysis จากผล AI
    const sentences = rawSentences.map((sentence, i) => {
      const aiItem = aiAnalysis.find(a => a.index === i + 1) || null;

      if (!aiItem) {
        // AI ไม่ได้วิเคราะห์ประโยคนี้ → ใช้ rule-based fallback
        const fallback = classifySentence(sentence);
        return {
          text: sentence,
          type: fallback.type,
          scores: fallback.scores,
          action: determineAction(fallback, mode, filterOptions),
          reason: fallback.reason + ' (rule-based fallback)',
          source: 'rule-based',
        };
      }

      const classification = {
        type: aiItem.type || 'CONTEXT',
        scores: {
          factualScore: aiItem.factualScore ?? 0,
          fillerScore: aiItem.fillerScore ?? 0,
          emotionalScore: aiItem.emotionalScore ?? 0,
          unsupportedScore: aiItem.unsupportedScore ?? 0,
        },
      };

      const action = determineAction(classification, mode, filterOptions);

      return {
        text: sentence,
        type: classification.type,
        scores: classification.scores,
        action,
        reason: aiItem.reason || 'AI วิเคราะห์',
        source: 'ai',
      };
    });

    // ประกอบข้อความที่กรองแล้ว
    const keptSentences = [];
    const removedPatterns = [];
    let removedCount = 0;
    let trimmedCount = 0;

    for (const s of sentences) {
      if (s.action === 'KEEP') {
        keptSentences.push(s.text);
      } else if (s.action === 'TRIM') {
        keptSentences.push(s.text);
        trimmedCount++;
      } else {
        removedCount++;
        removedPatterns.push({
          text: s.text.slice(0, 80) + (s.text.length > 80 ? '...' : ''),
          type: s.type,
          reason: s.reason,
        });
      }
    }

    const cleanText = keptSentences.join('\n');
    const originalWordCount = countThaiWords(text);
    const cleanWordCount = countThaiWords(cleanText);
    const removedPercent = originalWordCount > 0
      ? Math.round(((originalWordCount - cleanWordCount) / originalWordCount) * 100)
      : 0;

    return {
      cleanText,
      stats: {
        originalWordCount,
        cleanWordCount,
        removedPercent,
        sentenceCount: sentences.length,
        removedCount,
        trimmedCount,
      },
      sentenceAnalysis: sentences,
      removedPatterns,
    };

  } catch (error) {
    // AI ล้มเหลว → fallback เป็น rule-based อัตโนมัติ
    console.error('[NewsFilter] AI classification failed, falling back to rule-based:', error.message);
    return filterNews(text, { mode, ...filterOptions });
  }
}


// =============================================
// UTILITIES — ฟังก์ชันช่วย
// =============================================

/**
 * นับจำนวน "คำ" ในภาษาไทย
 * ภาษาไทยไม่มี space คั่นคำ → ใช้วิธีประมาณจากความยาวตัวอักษร
 * เฉลี่ยคำไทย ≈ 4-5 ตัวอักษร
 * @param {string} text
 * @returns {number}
 */
function countThaiWords(text) {
  if (!text) return 0;
  
  // ลบ whitespace ซ้ำ
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 0;
  
  // นับคำอังกฤษ (แยกด้วย space)
  const englishWords = cleaned.match(/[a-zA-Z]+/g) || [];
  
  // นับตัวอักษรไทย แล้วหารด้วย 4.5 (ค่าเฉลี่ยความยาวคำไทย)
  const thaiChars = cleaned.replace(/[a-zA-Z0-9\s\p{P}]/gu, '').length;
  const estimatedThaiWords = Math.ceil(thaiChars / 4.5);

  // นับตัวเลข (แต่ละกลุ่มตัวเลขนับเป็น 1 คำ)
  const numbers = cleaned.match(/\d+/g) || [];

  return englishWords.length + estimatedThaiWords + numbers.length;
}
