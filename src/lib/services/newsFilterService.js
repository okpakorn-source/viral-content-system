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


/**
 * ★ สกัดข้อเท็จจริงดิบ (13 มิ.ย. 69 คำสั่งทีม) — AI เขียนข่าวใหม่ให้เหลือ "แก่นข้อเท็จจริง" ล้วน
 *   ต่างจาก filterNewsWithAI (ตัดทีละประโยค): อันนี้ "เขียนใหม่" ตัดสำนวน/เกริ่น/อารมณ์/ตีความที่ฝังในประโยค
 *   เป้า: ป้อนเข้าไลน์เจน input สะอาด → ข่าวออกมาดีขึ้น (ไม่ใช่ข่าวกากเพราะต้นฉบับสำนวนเยอะ)
 *   ★ กฎเหล็ก anti-hallucination: ใช้เฉพาะข้อมูลในต้นฉบับ ห้ามเติม/เดา ชื่อ-ตัวเลข-วันที่ ตรงเป๊ะ
 * @returns shape เดียวกับ filterNews (cleanText, stats, sentenceAnalysis, removedPatterns) — UI ไม่ต้องแก้
 */
export async function extractFactCore(text, options = {}) {
  if (!text || typeof text !== 'string' || text.trim().length < 10) {
    return filterNews(text || '', options);
  }
  const { mode = 'balanced', keepQuotes = true } = options;

  const strictness = mode === 'strict'
    ? 'เข้มงวดสุด: เหลือเฉพาะข้อเท็จจริงแกนหลัก (ใคร ทำอะไร ที่ไหน เมื่อไหร่ ทำไม ผลยังไง) ตัดบริบทรองทั้งหมด'
    : mode === 'soft'
      ? 'ผ่อน: เก็บข้อเท็จจริง + บริบทที่จำเป็นต่อความเข้าใจ ตัดเฉพาะสำนวน/อารมณ์/เกริ่นที่ชัดเจน'
      : 'สมดุล: เก็บข้อเท็จจริงครบ + บริบทสำคัญ ตัดสำนวน/เกริ่น/อารมณ์/การตีความออกให้หมด';

  const prompt = `คุณเป็นบรรณาธิการข่าวที่เก่งเรื่อง "สกัดแก่นข้อเท็จจริง" ออกจากข่าวที่เขียนด้วยสำนวนเยอะ

หน้าที่: อ่านข่าวต้นฉบับด้านล่าง แล้ว "เขียนใหม่" ให้เหลือเฉพาะข้อเท็จจริงดิบที่จำเป็น เพื่อส่งต่อให้นักเขียนอีกทอด

ระดับการตัด (${mode}): ${strictness}

สิ่งที่ต้อง "ตัดทิ้ง":
- สำนวนเกริ่นนำ ("ทำเอาชาวเน็ตใจหาย", "กลายเป็นกระแสทันที", "ไม่คิดเลยว่าจะมีวันนี้")
- คำเร้าอารมณ์/ดราม่า ("สุดสะเทือนใจ", "สงสารน้องมาก", "น้ำตาแทบไหล")
- การตีความ/สรุปเอง ("สะท้อนว่า", "น่าจะเป็นเพราะ", "ทุกคนต่างรู้ดีว่า")
- คำฟุ่มเฟือยที่ไม่เพิ่มข้อมูล
- 🚫 การอ้างถึง "แหล่งข่าว/ช่องทางที่ข่าวมา" (meta — คือ "ข่าวมาจากไหน" ไม่ใช่ "เนื้อข่าว"):
  • ชื่อสำนักข่าวที่เป็นผู้รับฟัง/สัมภาษณ์ → "ให้สัมภาษณ์ข่าวสด", "เล่าให้ไทยรัฐฟัง", "ผู้สื่อข่าวรายงาน" → แปลงเป็น "เล่าว่า / บอกว่า / ระบุว่า" (เก็บสิ่งที่พูด ตัดชื่อสื่อ)
  • กรอบ "ผู้ใช้ TikTok/เฟซบุ๊ก @handle โพสต์ว่า..." ที่เป็นแค่ช่องทางมาของข่าว → เล่าเรื่องตรงๆ ใช้ชื่อบุคคลจริง ตัดแพลตฟอร์ม+แฮนเดิล (@xxx)
  • ★ ยกเว้น: ถ้าแพลตฟอร์มเป็น "ส่วนของเรื่องจริง" (เช่น ขายของผ่านเฟซบุ๊กเป็นอาชีพ / คลิปไวรัลคือเหตุการณ์หลักของข่าว) เก็บได้แบบสั้น — แต่ถ้าเป็นแค่ "ที่มาของข่าว/ช่องทางสัมภาษณ์" ให้ตัด
  ตัวอย่าง: "ผู้ใช้ TikTok @fluk596 โพสต์เรื่อง...ให้สัมภาษณ์ข่าวสดว่า พ่อแม่แยกทาง" → "นายสินธุ (ฟลุค) อายุ 17 เล่าว่า พ่อแม่แยกทาง"

สิ่งที่ต้อง "เก็บไว้เป๊ะ":
- ใคร ทำอะไร ที่ไหน เมื่อไหร่ ทำไม ผลเป็นอย่างไร
- ชื่อบุคคล/สถานที่/องค์กร ตัวเลข วันที่ จำนวนเงิน — ตรงกับต้นฉบับ 100%
${keepQuotes ? '- คำพูดตรงของบุคคลที่สำคัญต่อเนื้อข่าว (ใส่ในเครื่องหมายคำพูด)' : '- สรุปใจความคำพูด ไม่ต้องอ้างคำต่อคำ'}

🔒 ห้ามเปลี่ยนบริบท/มุมมองของตัวละครเด็ดขาด (สำคัญสูงสุด):
- ใครเป็นเจ้าของข้อมูล/ใครทำอะไร/ใครมีอะไร ต้องตรงกับต้นฉบับเป๊ะ ห้ามสลับบทบาท
  ตัวอย่างผิด: ต้นฉบับ "ผม(ก้อง)มี 12 บาท แฟนมี 17 บาท" → ห้ามเขียน "เขามี 17 เธอมี 12" (สลับเจ้าของเงิน = เปลี่ยนบริบท ผิดร้ายแรง)
  ที่ถูก: "ก้องมี 12 บาท ส่วนเก๋(แฟน)มี 17 บาท" — เจ้าของเงินตรงกับต้นฉบับ
- ห้ามสลับสรรพนาม เขา/เธอ/ตัวเขา ที่ทำให้ระบุตัวบุคคลผิด — ถ้าไม่ชัดให้ใช้ "ชื่อจริง" แทนสรรพนาม
- คงมุมมองการเล่าตามต้นฉบับ: ถ้าเป็นคำพูดบุคคลที่หนึ่ง ("ผม...") ให้คงว่าเป็นคำพูดของคนนั้น ห้ามบิดเป็นมุมมองอื่นจนเปลี่ยนความหมาย

⛔ ห้ามเด็ดขาด: เติมข้อมูลที่ไม่มีในต้นฉบับ / เดารายละเอียด / เปลี่ยนตัวเลข-ชื่อ-วันที่ / สลับว่าใครมี-ใครทำอะไร / ใส่ความเห็นตัวเอง
หลักการ: เราแค่ "ตัดคำเฟ้อ-สำนวน-อารมณ์" ออก — ไม่ใช่ "เล่าใหม่ในมุมมองของเรา" บริบทต้องเป็นของข่าวต้นทาง 100%
ถ้าต้นฉบับไม่มีข้อมูลบางอย่าง ก็ไม่ต้องมี — เขียนเท่าที่มีจริง

=== ข่าวต้นฉบับ ===
${text.slice(0, 8000)}
=== จบ ===

ตอบ JSON: {"factCore": "ข้อเท็จจริงดิบที่เขียนใหม่แล้ว (เป็นย่อหน้าอ่านลื่น ไม่ใช่ bullet)", "removed": ["สิ่งที่ตัดทิ้ง 3-5 ตัวอย่าง"]}`;

  try {
    const aiResult = await callAI({ prompt, model: MODEL_FAST, temperature: 0.2, maxTokens: 3000 });
    const parsed = typeof aiResult === 'object' ? aiResult : JSON.parse(String(aiResult).match(/\{[\s\S]*\}/)?.[0] || '{}');
    const cleanText = String(parsed.factCore || '').trim();
    if (cleanText.length < 20) {
      console.warn('[NewsFilter] สกัดข้อเท็จจริงได้สั้นผิดปกติ → fallback rule-based');
      return filterNews(text, options);
    }
    const originalWordCount = countThaiWords(text);
    const cleanWordCount = countThaiWords(cleanText);
    const removedPercent = originalWordCount > 0 ? Math.max(0, Math.round(((originalWordCount - cleanWordCount) / originalWordCount) * 100)) : 0;
    const removedPatterns = (parsed.removed || []).slice(0, 8).map(r => ({ text: String(r).slice(0, 80), type: 'สำนวน/อารมณ์/ตีความ', reason: 'ตัดออกตอนสกัดแก่น' }));
    return {
      cleanText,
      stats: { originalWordCount, cleanWordCount, removedPercent, sentenceCount: 0, removedCount: removedPatterns.length, trimmedCount: 0 },
      sentenceAnalysis: [], // โหมดสกัดแก่นไม่วิเคราะห์ทีละประโยค
      removedPatterns,
      engine: 'fact-core',
    };
  } catch (error) {
    console.error('[NewsFilter] extractFactCore failed → fallback rule-based:', error.message);
    return filterNews(text, options);
  }
}


// =============================================
// 🧩 splitTopics — แยกประเด็นย่อย (16 มิ.ย. 69)
// ปัญหา: บทสัมภาษณ์/ข่าวยาวมักยัดหลายเรื่อง (รัก+เงิน+ครอบครัว+อาชีพ) ในชิ้นเดียว
//        พนักงานมือใหม่แยกไม่ออกว่าหยิบท่อนไหนทำโพสต์เรื่องไหน
// แก้: อ่าน "เนื้อแก่น" ที่สกัดแล้ว → แยกเป็นประเด็น (แต่ละอัน = ทำโพสต์จบในตัว 1 ชิ้น)
//      content ของแต่ละประเด็น = ท่อนเนื้อดิบจริง (ห้ามแต่งเติม) พร้อมส่งเจนทีละเรื่อง
// =============================================
export async function splitTopics(text, options = {}) {
  if (!text || typeof text !== 'string' || text.trim().length < 40) {
    return { isSingleTopic: true, overview: 'เนื้อหาสั้น — เป็นประเด็นเดียว', topics: [], engine: 'too-short' };
  }

  const prompt = `คุณเป็นบรรณาธิการข่าวที่เก่งเรื่อง "หามุมขาย" จากข่าว/บทสัมภาษณ์ที่มีหลายแง่มุม

⚠️ เข้าใจให้ถูก — นี่ไม่ใช่ "หั่นทุกเรื่องที่พูดถึงออกเป็นชิ้นๆ":
- ❌ ผิด: ข่าวมี 6 เรื่อง → หั่นเป็น 6 ชิ้นห้วนๆ แต่ละชิ้นบอกแค่ "ตรงนี้พูดถึง X" ไม่มีที่มาที่ไป → เอาไปเจนแล้วข่าวขาดหัวขาดหาง คนอ่านไม่เข้าใจ
- ❌ ผิด: ตัดทิ้ง 5 เหลือ 1 เพื่อเน้นมุมเดียว จนบริบทสำคัญหาย
- ✅ ถูก: ดูว่า "ประเด็นไหนเข้ากันแล้วขายเป็นเรื่องเดียวที่สมูทได้" → จับมารวมเป็น 1 มุม
  ตัวอย่าง: (เหตุการณ์ที่เกิดขึ้น) + (มีคนยื่นมือช่วยเหลือ) + (ชีวิตหลังได้รับความช่วยเหลือ) = 1 มุมเล่าลื่นจบในตัว (จับ 3 ใน 6 ประเด็นมาร้อยกัน)

หน้าที่: อ่าน "เนื้อแก่นข่าว" ด้านล่าง แล้วจัดเป็น "มุมขาย" 1-3 มุม (ปกติไม่เกิน 3) — แต่ละมุมเอาไปทำโพสต์เดี่ยวที่สมบูรณ์ได้ พร้อมก๊อปส่งเข้าระบบเจนทันที

กฎการเล่าแต่ละมุม (สำคัญสุด):
- ★ ทุกมุม "ต้องมีที่มาที่ไป" — เปิดด้วยบริบท/ภูมิหลังให้คนอ่านเข้าใจก่อน แล้วค่อยพุ่งไปที่จุดขายของมุมนั้น (ข่าวต้องมีที่มาที่ไปเป็นตัวชี้นำให้คนเข้าใจ)
- ★ "content" = เรียบเรียงเป็น "เรื่องเล่าลื่นไหลจบในตัว" (ที่มา → เหตุการณ์ → จุดขาย/บทสรุป) — ★ ส่วนนี้สำคัญสุด ระบบเจนจะเอา content นี้ไปเกลาสำนวนต่อ จึงต้องครบ-ลื่น-ไม่ขาดบริบท
- ★ ห้ามตัดบริบทสำคัญทิ้งเพื่อเน้นมุมเดียวจนข่าวขาดความเข้าใจ — บริบทที่จำเป็นต้องติดไปกับมุมนั้นเสมอ
- ⛔ anti-hallucination: เรียบเรียง/ร้อยเรียงคำให้ลื่นได้ แต่ "ข้อเท็จจริง (ชื่อ ตัวเลข วันที่ ใครทำอะไร) ต้องตรงเนื้อแก่น 100%" ห้ามเติม/เดา/สลับบทบาท/เปลี่ยนตัวเลข
- ถ้าข่าวเป็นเรื่องเดียวที่สมูทอยู่แล้ว (เล่าจบในตัว ไม่ได้มีหลายมุมให้แยกขาย) → isSingleTopic=true และมี 1 มุม = เล่าทั้งเรื่องแบบมีที่มาที่ไป (ห้ามฝืนหั่น)

=== เนื้อแก่นข่าว ===
${text.slice(0, 8000)}
=== จบ ===

ตอบ JSON เท่านั้น:
{
  "isSingleTopic": true/false,
  "overview": "ภาพรวมสั้นๆ: ข่าวนี้ขายได้กี่มุม มุมอะไรบ้าง (1-2 บรรทัด)",
  "topics": [
    {
      "emoji": "อีโมจิสื่อมุมนี้ เช่น 💔 💰 👨‍👩‍👧 💼 🏠 ❤️‍🩹 🙏",
      "category": "หมวดสั้นๆ ของมุมนี้ เช่น เรื่องราวหลัก / มุมน้ำใจ / มุมสู้ชีวิต / มุมดราม่า / มุมข้อคิด / มุมครอบครัว",
      "title": "พาดหัวมุมนี้ให้ดึงดูด (เช่น จากวันที่สิ้นหวัง สู่วันที่มีคนยื่นมือช่วย)",
      "summary": "มุมนี้ขายอะไร 1-2 บรรทัด",
      "content": "★ เรื่องเล่าลื่นไหลจบในตัว — มีที่มาที่ไป (เปิดด้วยบริบท) → เหตุการณ์ → จุดขาย/บทสรุป ครบพร้อมส่งเจน (ใช้ข้อเท็จจริงจากเนื้อแก่นเท่านั้น ห้ามเติม/เปลี่ยน) ★ ส่วนนี้สำคัญสุด",
      "viralAngle": "จุดขาย — ทำไมมุมนี้คนต้องอ่าน/แชร์ (สั้นๆ 1 บรรทัด)"
    }
  ]
}`;

  try {
    const aiResult = await callAI({ prompt, model: MODEL_FAST, temperature: 0.2, maxTokens: 4000 });
    const parsed = typeof aiResult === 'object' ? aiResult : JSON.parse(String(aiResult).match(/\{[\s\S]*\}/)?.[0] || '{}');
    let topics = Array.isArray(parsed.topics) ? parsed.topics : [];
    topics = topics
      .filter(t => t && (t.content || t.summary))
      .slice(0, 4)
      .map((t, i) => ({
        id: i + 1,
        emoji: String(t.emoji || '📌').slice(0, 4),
        category: String(t.category || 'ประเด็น').slice(0, 30),
        title: String(t.title || `ประเด็นที่ ${i + 1}`).slice(0, 120),
        summary: String(t.summary || '').slice(0, 300),
        content: String(t.content || '').trim().slice(0, 4000),
        viralAngle: String(t.viralAngle || '').slice(0, 200),
        wordCount: countThaiWords(String(t.content || '')),
      }))
      .filter(t => t.content.length >= 15);
    return {
      isSingleTopic: parsed.isSingleTopic === true || topics.length <= 1,
      overview: String(parsed.overview || '').slice(0, 500),
      topics,
      engine: 'topic-split',
    };
  } catch (error) {
    console.error('[NewsFilter] splitTopics failed:', error.message);
    return { isSingleTopic: true, overview: '', topics: [], engine: 'failed', error: error.message };
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
