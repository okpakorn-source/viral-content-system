/**
 * ========================================
 * SAFETY FILTER — Shared Post-Processing
 * ========================================
 * Post-processing safety filter สำหรับทุก AI provider
 * Replace คำเสี่ยง Facebook ใน output ก่อน return
 * ทำงานเป็น last line of defense ไม่ว่า prompt จะสั่งหรือไม่
 * 
 * ใช้ร่วมกันใน: openai.js, claudeClient.js, geminiClient.js
 */

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
export function sanitizeOutput(obj) {
  if (typeof obj === 'string') {
    let result = obj;
    for (const [pattern, replacement] of SAFETY_REPLACEMENTS) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeOutput(item));
  }
  if (obj && typeof obj === 'object') {
    const sanitized = {};
    for (const [key, val] of Object.entries(obj)) {
      sanitized[key] = sanitizeOutput(val);
    }
    return sanitized;
  }
  return obj;
}
