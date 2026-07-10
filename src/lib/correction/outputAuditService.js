/**
 * Layer 2 — Output Audit Engine
 * 
 * AI ตรวจ output หลัง generate หา:
 * - คำเสี่ยง Facebook
 * - ประโยค AI
 * - คำแปลกๆ
 * - อารมณ์เกินจริง
 * - engagement bait
 * 
 * ห้ามแก้ output ใน layer นี้ — แค่ตรวจแล้ว report
 */

import { callAI } from '@/lib/ai/openai';

// === คำเสี่ยง Facebook (regex-based fast check) ===
const FORBIDDEN_WORDS = [
  // === ความรุนแรง / ชีวิต (HIGH) ===
  { pattern: /ฆ่า(?!เชื้อ|แมลง)/g, type: 'forbidden_word', severity: 'high', suggestion: 'ก่อเหตุ' },
  { pattern: /ฆาตกรรม/g, type: 'forbidden_word', severity: 'high', suggestion: 'คดีร้ายแรง' },
  { pattern: /ฆ่าตัวตาย/g, type: 'forbidden_word', severity: 'high', suggestion: 'จากไปอย่างเงียบๆ' },
  { pattern: /ศพ/g, type: 'forbidden_word', severity: 'high', suggestion: 'ร่างผู้เสียหาย' },
  { pattern: /(?<!เสีย)ตาย(?!ตัว|ด้าน|แล้ว)/g, type: 'forbidden_word', severity: 'high', suggestion: 'จากไป' },
  { pattern: /ชำแหละ/g, type: 'forbidden_word', severity: 'high', suggestion: 'เหตุรุนแรงอย่างยิ่ง' },
  { pattern: /หมกศพ/g, type: 'forbidden_word', severity: 'high', suggestion: 'ซุกซ่อนร่าง' },
  { pattern: /ข่มขืน/g, type: 'forbidden_word', severity: 'high', suggestion: 'ล่วงละเมิดทางเพศ' },
  { pattern: /ผูกคอ/g, type: 'forbidden_word', severity: 'high', suggestion: 'จากไปอย่างน่าเศร้า' },
  { pattern: /จบชีวิต/g, type: 'forbidden_word', severity: 'high', suggestion: 'จากไปอย่างน่าเศร้า' },
  { pattern: /แทง(?!บอล|ม้า|หวย|รถ)/g, type: 'forbidden_word', severity: 'high', suggestion: 'ใช้ของมีคม' },
  { pattern: /ยิง(?!ประตู|จรวด|ดาว)/g, type: 'forbidden_word', severity: 'high', suggestion: 'ใช้อาวุธปืน' },

  // === คำเสี่ยงที่ขาดไป (เพิ่มใหม่) ===
  // ★ เสียชีวิต/ตาย: ห้ามแทนคำตรงๆ (จะได้ "จากไป" ซ้ำจำเจทุกข่าว) — เข้าโหมด AI เกลาตามบริบทใน safeCorrect
  { pattern: /เสียชีวิต/g, type: 'forbidden_word', severity: 'high', suggestion: 'สำนวนเลี่ยงตามบริบท เช่น จากไปอย่างสงบ/ไม่อยู่แล้ว/ลาลับ/ปิดตำนาน' },
  { pattern: /บาดเจ็บสาหัส/g, type: 'forbidden_word', severity: 'high', suggestion: 'ได้รับบาดเจ็บหนัก' },
  { pattern: /สะเก็ดระเบิด/g, type: 'forbidden_word', severity: 'high', suggestion: 'เหตุการณ์ไม่คาดฝัน' },
  { pattern: /ระเบิด(?!ความ|พลัง|แรง)/g, type: 'forbidden_word', severity: 'high', suggestion: 'เหตุการณ์รุนแรง' },
  { pattern: /สนามรบ/g, type: 'forbidden_word', severity: 'medium', suggestion: 'พื้นที่ปฏิบัติหน้าที่' },
  { pattern: /สงคราม(?!ราคา|ธุรกิจ)/g, type: 'forbidden_word', severity: 'medium', suggestion: 'สถานการณ์ความขัดแย้ง' },
  { pattern: /คลิปหลุด/g, type: 'forbidden_word', severity: 'high', suggestion: 'คลิปที่แพร่ออกมา' },
  { pattern: /หลุดเต็ม/g, type: 'forbidden_word', severity: 'high', suggestion: 'เผยแพร่ออกมา' },
  { pattern: /อาวุธ/g, type: 'forbidden_word', severity: 'medium', suggestion: 'สิ่งของอันตราย' },
  { pattern: /กระสุน/g, type: 'forbidden_word', severity: 'medium', suggestion: 'วัตถุอันตราย' },

  // === ความรุนแรง (MEDIUM) ===
  { pattern: /ดับ(?!เพลิง|ไฟ|กลิ่น|แสง)/g, type: 'forbidden_word', severity: 'medium', suggestion: 'จากไป' },
  { pattern: /สิ้นใจ/g, type: 'forbidden_word', severity: 'medium', suggestion: 'จากไป' },
  { pattern: /สยอง/g, type: 'forbidden_word', severity: 'medium', suggestion: 'น่าตกใจ' },
  { pattern: /โหด(?!ร้อน)/g, type: 'forbidden_word', severity: 'medium', suggestion: 'รุนแรง' },
  // ★ 10 ก.ค. 69: เพิ่ม lookbehind (?<!เส้น) — "เส้นเลือด/เส้นเลือดในสมอง" คือศัพท์การแพทย์ ห้ามจับ (เคยถูกแทนเป็น "เส้นร่องรอยเหตุการณ์ในสมองแตก")
  { pattern: /(?<!เส้น)เลือด(?!ดี|ข้น|ฝาด|จาง|ผสม|กำเดา)/g, type: 'forbidden_word', severity: 'medium', suggestion: 'ร่องรอยเหตุการณ์' },
  { pattern: /ทุบตี/g, type: 'forbidden_word', severity: 'medium', suggestion: 'ใช้ความรุนแรง' },
  { pattern: /ทำร้าย(?!ตัวเอง)/g, type: 'forbidden_word', severity: 'medium', suggestion: 'ใช้ความรุนแรง' },
  { pattern: /เลือดสาด/g, type: 'forbidden_word', severity: 'high', suggestion: 'เหตุรุนแรง' },
  { pattern: /บาดแผล(?!ทางใจ)/g, type: 'forbidden_word', severity: 'medium', suggestion: 'อาการบาดเจ็บ' },

  // === ★ การพนัน / ยาเสพติด / แอลกอฮอล์ (Meta restricted — เพิ่ม 12 มิ.ย. 69) ===
  //     หมายเหตุ: สลาก/ลอตเตอรี่ (หวยรัฐถูกกฎหมาย) จงใจไม่ใส่ — บางข่าวเป็นแก่นเรื่อง เล่าไม่ได้ถ้าตัด
  { pattern: /การพนัน|เล่นพนัน|บ่อนพนัน|บ่อนการพนัน/g, type: 'forbidden_word', severity: 'high', suggestion: 'เกมเสี่ยงโชคผิดกฎหมาย' },
  { pattern: /เว็บพนัน|พนันออนไลน์|บาคาร่า|สล็อตออนไลน์/g, type: 'forbidden_word', severity: 'high', suggestion: 'เว็บผิดกฎหมาย' },
  { pattern: /แทงบอล|แทงม้า/g, type: 'forbidden_word', severity: 'high', suggestion: 'เกมเสี่ยงโชคผิดกฎหมาย' },
  { pattern: /ยาบ้า|ยาไอซ์|เฮโรอีน|โคเคน/g, type: 'forbidden_word', severity: 'high', suggestion: 'สิ่งผิดกฎหมาย' },
  { pattern: /ยาเสพติด|เสพยา|ค้ายา|พ่อค้ายา/g, type: 'forbidden_word', severity: 'high', suggestion: 'สิ่งผิดกฎหมาย' },
  { pattern: /เมาแล้วขับ/g, type: 'forbidden_word', severity: 'medium', suggestion: 'ขับขี่ในสภาพไม่พร้อม' },
  { pattern: /ตั้งวงเหล้า|วงเหล้า|ดื่มสุรา/g, type: 'forbidden_word', severity: 'medium', suggestion: 'วงสังสรรค์' },

  // === Engagement bait / clickbait (HIGH) ===
  { pattern: /ด่วน(?!จัด)/g, type: 'forbidden_word', severity: 'medium', suggestion: '' },
  { pattern: /ดูก่อนโดนลบ/g, type: 'forbidden_word', severity: 'high', suggestion: '' },
  { pattern: /แชร์ด่วน/g, type: 'forbidden_word', severity: 'high', suggestion: '' },
  { pattern: /xxx|XXX/g, type: 'forbidden_word', severity: 'high', suggestion: '' },
  { pattern: /AV(?!\s*[ก-๙a-z])/g, type: 'forbidden_word', severity: 'high', suggestion: '' },
];

// === ประโยค AI (string match) ===
const AI_WORDING_PATTERNS = [
  'สะท้อนให้เห็นถึง', 'สะท้อนให้เห็นว่า', 'ทำให้เราเห็นว่า',
  'ความรักอันยิ่งใหญ่', 'ความรักที่แท้จริง', 'เป็นบทเรียนชีวิต',
  'เรียกได้ว่า', 'ถือเป็น', 'นับว่า', 'ได้มีการ',
  'สร้างความฮือฮา', 'กลายเป็นกระแส', 'สร้างความตื่นตะลึง',
  'ทำให้คนดูน้ำตาไหล', 'สะเทือนใจชาวเน็ต', 'สะเทือนใจผู้คน',
  'วินาทีที่เปลี่ยนทุกอย่าง', 'จุดเปลี่ยนสำคัญ',
  'ความงดงามของจิตใจ', 'แสงสว่างปลายอุโมงค์', 'แสงนำทาง',
  'ความแข็งแกร่งของจิตใจ', 'พลังของความรัก',
  'ดังกล่าว', 'ทั้งนี้', 'อย่างไรก็ตาม', 'ภายหลังจาก',
  'สืบเนื่อง', 'ในส่วนของ', 'จากกรณีดังกล่าว',
  'ซึ่งถือเป็น', 'ซึ่งนับว่า',
];

// === Engagement Bait ===
const ENGAGEMENT_BAIT = [
  'คุณจะไม่เชื่อ', 'แชร์ด่วน', 'ดูก่อนโดนลบ', 'ห้ามพลาด',
  'พิมพ์ 1', 'เมนต์ 99', 'ใครเห็นด้วยกดไลก์', 'กดแชร์ด่วน',
  'คุณคิดยังไง?', 'เห็นด้วยไหม?', 'คิดยังไงกันบ้าง?',
];

/**
 * ตรวจ output 1 version
 * @param {object} version - { style, title, content, hook, closing }
 * @returns {{ issues: Array, auditScore: number, summary: string }}
 */
export async function auditOutput(version) {
  const issues = [];
  const content = version.content || '';

  try {
    // === FAST CHECKS (regex/string — ไม่เรียก AI) ===

    // 1. Forbidden words
    for (const rule of FORBIDDEN_WORDS) {
      const matches = content.match(rule.pattern);
      if (matches) {
        matches.forEach(m => {
          const idx = content.indexOf(m);
          const paraIndex = content.substring(0, idx).split('\n\n').length - 1;
          issues.push({
            type: rule.type,
            text: m,
            location: paraIndex,
            severity: rule.severity,
            suggestion: rule.suggestion,
          });
        });
      }
    }

    // 2. AI wording
    for (const phrase of AI_WORDING_PATTERNS) {
      if (content.includes(phrase)) {
        const idx = content.indexOf(phrase);
        const paraIndex = content.substring(0, idx).split('\n\n').length - 1;
        issues.push({
          type: 'ai_wording',
          text: phrase,
          location: paraIndex,
          severity: 'medium',
          suggestion: `ลบหรือเปลี่ยนเป็นภาษาคนพูดจริง`,
        });
      }
    }

    // 3. Engagement bait
    for (const bait of ENGAGEMENT_BAIT) {
      if (content.includes(bait)) {
        issues.push({
          type: 'engagement_bait',
          text: bait,
          location: -1,
          severity: 'high',
          suggestion: 'ลบออก — Facebook ลด reach',
        });
      }
    }

    // 4. Ending with question
    const paragraphs = content.split('\n\n').filter(p => p.trim());
    const lastPara = paragraphs[paragraphs.length - 1] || '';
    if (/[?？][\s]*$/.test(lastPara) || /คิดยังไง|เห็นด้วยไหม|คิดเห็นอย่างไร/.test(lastPara)) {
      issues.push({
        type: 'engagement_bait',
        text: lastPara.slice(-60),
        location: paragraphs.length - 1,
        severity: 'medium',
        suggestion: 'ปิดด้วยประโยคบรรยายทิ้งอารมณ์ ไม่ใช่คำถาม',
      });
    }

    // 5. Very long sentences (>80 words)
    const sentences = content.split(/[.。!！\n]+/).filter(s => s.trim().length > 10);
    sentences.forEach((s, i) => {
      const wordCount = s.trim().split(/\s+/).length;
      if (wordCount > 80) {
        issues.push({
          type: 'awkward',
          text: s.trim().slice(0, 60) + '...',
          location: i,
          severity: 'low',
          suggestion: 'ตัดประโยคให้สั้นลง',
        });
      }
    });

    // 6. Repeated words in same paragraph
    paragraphs.forEach((para, pIdx) => {
      const words = para.split(/\s+/).filter(w => w.length > 3);
      const freq = {};
      words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
      Object.entries(freq).forEach(([word, count]) => {
        if (count >= 4) {
          issues.push({
            type: 'awkward',
            text: `"${word}" ซ้ำ ${count} ครั้งในย่อหน้า ${pIdx + 1}`,
            location: pIdx,
            severity: 'low',
            suggestion: 'ใช้คำอื่นแทน หรือตัดออก',
          });
        }
      });
    });

    // === Calculate audit score ===
    const highCount = issues.filter(i => i.severity === 'high').length;
    const medCount = issues.filter(i => i.severity === 'medium').length;
    const lowCount = issues.filter(i => i.severity === 'low').length;
    const auditScore = Math.max(0, 100 - (highCount * 15) - (medCount * 8) - (lowCount * 3));

    console.log(`[OutputAudit] Score: ${auditScore}/100 | Issues: ${issues.length} (H:${highCount} M:${medCount} L:${lowCount})`);

    return {
      issues,
      auditScore,
      summary: issues.length === 0
        ? '✅ Clean — ไม่พบปัญหา'
        : `⚠️ พบ ${issues.length} จุดที่ต้องแก้ (H:${highCount} M:${medCount} L:${lowCount})`,
    };

  } catch (err) {
    console.error('[OutputAudit] Error:', err.message);
    return { issues: [], auditScore: 100, summary: '✅ Audit skipped (error)' };
  }
}
