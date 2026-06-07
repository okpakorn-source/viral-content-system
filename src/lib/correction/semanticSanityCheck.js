/**
 * Layer 4.6 — Semantic Sanity Check
 * 
 * ตรวจจับ "ประโยคไร้ความหมาย" ที่เกิดจาก LLM Token Prediction Error
 * เช่น: "อบอุ่นขึ้นไปอีกระเสียชีวิต" (ไม่มีความหมาย)
 * 
 * ใช้ GPT-4o-mini ตรวจ (~0.5s/version, ~0.007 บาท/version)
 * 
 * Safety rules:
 * - ถ้า AI call fail → ข้าม (return original content)
 * - ถ้าพบปัญหา → ลบประโยคนั้นออก (safe removal)
 * - ไม่แก้ fact, ชื่อ, ตัวเลข — แค่ลบส่วนที่ไร้ความหมาย
 */

import { callAI } from '@/lib/ai/openai';
import { MODEL_FAST } from '@/lib/ai/modelConfig';

const SANITY_CHECK_PROMPT = `คุณเป็นบรรณาธิการภาษาไทยระดับสูง ตรวจสอบเนื้อหาด้านล่างว่ามี "ประโยคที่ไร้ความหมาย" หรือ "คำผิดร้ายแรง" หรือไม่

ตัวอย่างปัญหาที่ต้องจับ:
- คำที่ติดกันแล้วอ่านไม่รู้เรื่อง เช่น "อบอุ่นขึ้นไปอีกระเสียชีวิต" (ไม่มีความหมาย)
- คำที่ขัดแย้งกันในประโยคเดียว เช่น "ยิ้มอย่างมีความสุขกับความตาย"
- ประโยคที่ grammar เพี้ยนจนอ่านไม่เข้าใจ
- คำที่ถูกตัดครึ่งหรือเชื่อมกับคำอื่นจนไร้ความหมาย

สิ่งที่ไม่ถือว่าผิด (ห้ามแจ้ง):
- สำนวนไทย เช่น "ใจหาย" "ใจสลาย" "น้ำตาไหล"
- ภาษาพูดทั่วไป เช่น "โคตรเศร้า" "แรงมาก"
- อารมณ์ dramatic แต่ยังอ่านรู้เรื่อง

=== เนื้อหาที่ต้องตรวจ ===
{CONTENT}
=== จบเนื้อหา ===

ตอบเป็น JSON:
{
  "hasIssues": true/false,
  "issues": [
    {
      "brokenText": "ข้อความที่มีปัญหา (copy ตรงจากเนื้อหา)",
      "reason": "เหตุผลสั้นๆ ว่าทำไมมันผิด",
      "severity": "high/medium"
    }
  ]
}

ถ้าไม่พบปัญหา: { "hasIssues": false, "issues": [] }`;

/**
 * ตรวจเนื้อหา 1 version ด้วย AI
 * @param {string} content - เนื้อหาที่จะตรวจ
 * @returns {{ sanitizedContent: string, issuesFound: Array, fixed: boolean }}
 */
export async function semanticSanityCheck(content) {
  if (!content || content.length < 50) {
    return { sanitizedContent: content, issuesFound: [], fixed: false };
  }

  try {
    const prompt = SANITY_CHECK_PROMPT.replace('{CONTENT}', content);

    const result = await callAI({
      model: MODEL_FAST,
      temperature: 0.1,
      maxTokens: 500,
      prompt,
    });

    if (!result || !result.hasIssues || !Array.isArray(result.issues) || result.issues.length === 0) {
      return { sanitizedContent: content, issuesFound: [], fixed: false };
    }

    // Apply fixes: ลบประโยคที่มีปัญหาออก
    let fixedContent = content;
    const appliedFixes = [];

    for (const issue of result.issues) {
      if (!issue.brokenText || issue.brokenText.length < 5) continue;

      // ตรวจสอบว่า brokenText มีอยู่ในเนื้อหาจริง
      if (!fixedContent.includes(issue.brokenText)) continue;

      // ลบข้อความที่มีปัญหาออก (trim whitespace ที่เหลือ)
      fixedContent = fixedContent.replace(issue.brokenText, '');
      
      appliedFixes.push({
        removed: issue.brokenText,
        reason: issue.reason || 'ประโยคไร้ความหมาย',
        severity: issue.severity || 'medium',
      });

      console.log(`  L4.6 Semantic Fix: "${issue.brokenText.slice(0, 50)}..." → removed (${issue.reason})`);
    }

    // Clean up: ลบช่องว่างซ้ำ, บรรทัดว่างซ้ำ
    fixedContent = fixedContent
      .replace(/\s{3,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return {
      sanitizedContent: fixedContent,
      issuesFound: appliedFixes,
      fixed: appliedFixes.length > 0,
    };

  } catch (err) {
    // FAIL-SAFE: ถ้า AI call fail → ข้าม ใช้ content เดิม
    console.warn(`  L4.6 Semantic Check: SKIPPED (${err.message})`);
    return { sanitizedContent: content, issuesFound: [], fixed: false, error: err.message };
  }
}
