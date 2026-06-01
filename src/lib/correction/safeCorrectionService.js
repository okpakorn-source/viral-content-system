/**
 * Layer 3 — Safe Correction Engine
 * 
 * แก้เฉพาะจุดที่ audit พบปัญหา
 * ห้าม rewrite ทั้งบทความ
 * ห้ามเปลี่ยน narrative structure
 * เก็บ rollbackContent ไว้เสมอ
 */

import { callAI } from '@/lib/ai/openai';

/**
 * แก้ content ตาม issues ที่ audit พบ
 * @param {string} content - เนื้อหาต้นฉบับ
 * @param {Array} issues - จาก auditOutput()
 * @returns {{ correctedContent: string, rollbackContent: string, corrections: Array }}
 */
export async function safeCorrect(content, issues) {
  const rollbackContent = content; // เก็บต้นฉบับไว้เสมอ
  let correctedContent = content;
  const corrections = [];

  try {
    if (!issues || issues.length === 0) {
      return { correctedContent, rollbackContent, corrections };
    }

    // === แยก issues ตาม severity ===
    const highMedIssues = issues.filter(i => i.severity === 'high' || i.severity === 'medium');
    const lowIssues = issues.filter(i => i.severity === 'low');

    // === LOW severity — log only ===
    for (const issue of lowIssues) {
      corrections.push({
        type: 'skipped_low',
        original: issue.text,
        fixed: null,
        reason: 'Low severity — skipped (log only)',
      });
    }

    // === HIGH/MEDIUM — แก้เฉพาะจุด ===
    // รวม forbidden_word ที่ต้องใช้ AI rewrite ประโยค (คำที่ replace ตรงๆ แล้วเพี้ยน)
    const needsAIRewrite = ['สะเก็ดระเบิด', 'ระเบิด', 'สนามรบ', 'บาดแผล'];
    const aiRewriteIssues = [];
    const directReplaceIssues = [];

    for (const issue of highMedIssues) {
      if (issue.type === 'forbidden_word' && needsAIRewrite.some(w => issue.text.includes(w))) {
        aiRewriteIssues.push(issue);
      } else {
        directReplaceIssues.push(issue);
      }
    }

    // === Layer 3A: Direct replacement (คำที่ replace ตรงๆ ได้ไม่เพี้ยน) ===
    for (const issue of directReplaceIssues) {
      try {
        if (issue.type === 'forbidden_word' && issue.suggestion) {
          const before = correctedContent;
          correctedContent = correctedContent.replace(issue.text, issue.suggestion);
          if (correctedContent !== before) {
            corrections.push({
              type: 'regex_replace',
              original: issue.text,
              fixed: issue.suggestion,
              reason: `Forbidden word → safe replacement`,
            });
          }
        } else if (issue.type === 'ai_wording') {
          const sentenceWithIssue = extractSentence(correctedContent, issue.text);
          if (sentenceWithIssue) {
            const fixedSentence = await fixSentenceWithAI(sentenceWithIssue, issue);
            if (fixedSentence && fixedSentence !== sentenceWithIssue) {
              correctedContent = correctedContent.replace(sentenceWithIssue, fixedSentence);
              corrections.push({
                type: 'ai_sentence_fix',
                original: sentenceWithIssue.slice(0, 80),
                fixed: fixedSentence.slice(0, 80),
                reason: `AI wording removed: "${issue.text}"`,
              });
            }
          }
        } else if (issue.type === 'engagement_bait') {
          if (issue.text.length < 30) {
            const before = correctedContent;
            correctedContent = correctedContent.replace(issue.text, '');
            if (correctedContent !== before) {
              corrections.push({
                type: 'removed',
                original: issue.text,
                fixed: '(removed)',
                reason: 'Engagement bait removed',
              });
            }
          }
        }
      } catch (fixErr) {
        console.warn(`[SafeCorrection] Fix failed for "${issue.text}":`, fixErr.message);
      }
    }

    // === Layer 3B: AI Context-Aware Rewrite (คำที่ replace ตรงๆ แล้วเนื้อหาจะเพี้ยน) ===
    if (aiRewriteIssues.length > 0) {
      try {
        const riskyWords = aiRewriteIssues.map(i => `"${i.text}" → ควรเปลี่ยนเป็นคำที่ปลอดภัย (suggestion: "${i.suggestion}")`).join('\n');
        
        const result = await callAI({
          model: 'gpt-4o-mini',
          temperature: 0.1,
          maxTokens: 2000,
          prompt: `อ่านเนื้อหาด้านล่างแล้ว rewrite เฉพาะคำเสี่ยงที่ระบุ ให้ปลอดภัยสำหรับ Facebook
ห้ามเปลี่ยนเนื้อหา ห้ามเพิ่มข้อมูล ห้ามลดข้อมูล ห้ามเปลี่ยนโทน ห้ามยาวขึ้น
แค่เปลี่ยนคำเสี่ยงให้ปลอดภัย โดยรักษาความหมายและอ่านลื่นเหมือนเดิม

=== คำเสี่ยงที่ต้องเปลี่ยน ===
${riskyWords}

=== เนื้อหา ===
${correctedContent}
=== จบ ===

ตอบเฉพาะเนื้อหาที่แก้แล้ว ไม่ต้องอธิบาย ไม่ต้องใส่ prefix`,
        });

        if (typeof result === 'string' && result.length > correctedContent.length * 0.7 && result.length < correctedContent.length * 1.3) {
          correctedContent = result.trim();
          corrections.push({
            type: 'ai_context_rewrite',
            original: aiRewriteIssues.map(i => i.text).join(', '),
            fixed: '(AI rewrote risky words in context)',
            reason: `Context-aware replacement for ${aiRewriteIssues.length} risky words`,
          });
          console.log(`[SafeCorrection] L3B AI Rewrite: ${aiRewriteIssues.length} context-sensitive words fixed`);
        } else {
          // AI ตอบผิดรูปแบบ → fallback ใช้ direct replace
          console.warn(`[SafeCorrection] L3B AI Rewrite: response invalid, fallback to direct replace`);
          for (const issue of aiRewriteIssues) {
            if (issue.suggestion) {
              const before = correctedContent;
              correctedContent = correctedContent.replace(issue.text, issue.suggestion);
              if (correctedContent !== before) {
                corrections.push({ type: 'regex_replace', original: issue.text, fixed: issue.suggestion, reason: 'Fallback direct replace' });
              }
            }
          }
        }
      } catch (aiErr) {
        console.warn(`[SafeCorrection] L3B AI Rewrite failed: ${aiErr.message}, using direct replace`);
        for (const issue of aiRewriteIssues) {
          if (issue.suggestion) {
            const before = correctedContent;
            correctedContent = correctedContent.replace(issue.text, issue.suggestion);
            if (correctedContent !== before) {
              corrections.push({ type: 'regex_replace', original: issue.text, fixed: issue.suggestion, reason: 'Fallback direct replace' });
            }
          }
        }
      }
    }

    // Clean up double spaces/newlines จากการลบ
    correctedContent = correctedContent.replace(/  +/g, ' ').replace(/\n{3,}/g, '\n\n');

    console.log(`[SafeCorrection] Applied ${corrections.filter(c => c.type !== 'skipped_low').length} corrections`);

    return { correctedContent, rollbackContent, corrections };

  } catch (err) {
    console.error('[SafeCorrection] Error:', err.message);
    return { correctedContent: rollbackContent, rollbackContent, corrections: [] };
  }
}

/**
 * ดึงประโยคที่มี phrase อยู่
 */
function extractSentence(content, phrase) {
  const idx = content.indexOf(phrase);
  if (idx === -1) return null;

  // หา boundary ของประโยค
  let start = idx;
  while (start > 0 && content[start - 1] !== '\n' && content[start - 1] !== '.' && content[start - 1] !== '。') {
    start--;
  }

  let end = idx + phrase.length;
  while (end < content.length && content[end] !== '\n' && content[end] !== '.' && content[end] !== '。') {
    end++;
  }

  return content.substring(start, end + 1).trim();
}

/**
 * ใช้ AI แก้ 1 ประโยค (micro-correction)
 */
async function fixSentenceWithAI(sentence, issue) {
  try {
    const result = await callAI({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      maxTokens: 200,
      prompt: `แก้ประโยคนี้ให้เป็นภาษาคนพูดจริงบน Facebook โดยรักษาความหมายเดิม
ห้ามเปลี่ยน fact ห้ามเพิ่มอารมณ์ ห้ามเปลี่ยนโทน ห้ามยาวกว่าเดิม

ประโยคเดิม: ${sentence}
ปัญหา: พบคำที่ฟังเหมือน AI "${issue.text}"

ตอบเฉพาะประโยคที่แก้แล้ว ไม่ต้องอธิบาย ไม่ต้องใส่เครื่องหมายคำพูด`,
    });

    if (typeof result === 'string' && result.length > 10 && result.length < sentence.length * 1.5) {
      return result.trim();
    }
    return null;
  } catch {
    return null;
  }
}
