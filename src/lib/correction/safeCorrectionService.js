/**
 * Layer 3 — Safe Correction Engine
 * 
 * แก้เฉพาะจุดที่ audit พบปัญหา
 * ห้าม rewrite ทั้งบทความ
 * ห้ามเปลี่ยน narrative structure
 * เก็บ rollbackContent ไว้เสมอ
 */

import { callAI } from '@/lib/ai/openai';
import { MODEL_FAST } from '@/lib/ai/modelConfig';
// ★ 1 ส.ค. 69 (เกราะแก่นข่าว): ใช้ตัวสกัด "เลขเด่น" ตัวเดียวกับ flagFixer — แหล่งความจริงเดียว ไม่ก๊อปตรรกะซ้ำ
import { keyNumbersOf, hasKeyNumber } from './flagFixerService';
// ★ 1 ก.ย. 69: แทนคำต้องห้ามด้วย pattern เดิมของ L2 (เคารพ whitelist ศัพท์แพทย์) — บั๊ก "ยาฆ่าเชื้อ→ยาก่อเหตุเชื้อ"
import { guardedReplace, sortLongestFirst } from './guardedReplace';

// ═══ ★ 1 ส.ค. 69 (เกราะแก่นข่าว) ═══════════════════════════════════════════
// เหตุ (พิสูจน์แล้ว 1 ส.ค.): เวอร์ชันที่ติดป้าย _correctionApplied=true มีเนื้อพัง —
//   ชั้นแก้คำแทนคำโดนกลางคำ ("ตามลำดับ" → "ตามลำจากไป") แล้วชั้นตรวจถัดไปลบท่อนที่พังทิ้งทั้งท่อน
//   จนประโยคแก่นข่าวหายทั้งใบ (เช่น "หมู่บิ๊กออกจากโรงพยาบาลแล้ว...8 เดือน")
// หลักการของเกราะนี้: การเกลาคำเป็นของแถม แก่นข่าวเป็นของหลัก —
//   ผลแก้ที่ทำ "เลขสำคัญหาย" หรือ "เนื้อหด" ให้ทิ้งทั้งชุดแล้วใช้ต้นฉบับเสมอ
//   อย่างแย่ที่สุดที่ยอมได้ = คำไม่ถูกเกลา (ไม่ใช่แก่นข่าวหาย)
const CORE_GUARD_MIN_KEEP_DEFAULT = 0.75;

function coreGuardMinKeep() {
  const raw = parseFloat(process.env.CORRECTION_MIN_KEEP);
  // นอกช่วง (0,1] = ค่าเพี้ยน → ใช้ค่าปลอดภัยเริ่มต้น (กันตั้งค่าผิดแล้วเกราะบ้าตีกลับทุกใบ)
  if (!Number.isFinite(raw) || raw <= 0 || raw > 1) return CORE_GUARD_MIN_KEEP_DEFAULT;
  return raw;
}

/**
 * ด่านเทียบ ต้นฉบับ vs ผลแก้ — ใช้ก่อนเอาผลแก้ไปแทนต้นฉบับทุกครั้ง
 * export ไว้ให้ชั้นอื่นในท่อ (เช่น correctionPipeline) เรียกใช้เกราะเดียวกันได้ ถ้าทีมสั่งต่อ
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function guardCoreNews(originalContent, candidateContent) {
  const original = String(originalContent || '');
  const candidate = String(candidateContent || '');

  // ไม่ได้แตะเนื้อเลย → ผ่านทันที (กันเตือนหลอกบนเส้นที่ไม่มีอะไรเปลี่ยน)
  if (candidate === original) return { ok: true, reason: null };

  if (!candidate.trim()) return { ok: false, reason: 'ผลแก้ว่างเปล่า' };

  // (ก) เลขเด่นของต้นฉบับต้องอยู่ครบทุกตัว — ★ Sol รอบ 2: เทียบแบบขอบเลข+ผูกหน่วย (กัน "12" แมตช์ใน "312" / "12 คน" แทน "12 เดือน")
  const missing = keyNumbersOf(original).filter(k => !hasKeyNumber(candidate, k));
  if (missing.length > 0) {
    return { ok: false, reason: `เลขสำคัญหาย ${missing.map(k => `${k.num} ${k.unit}`).join(', ')}` };
  }

  // (ข) เนื้อต้องไม่หดเกินเพดาน (ตัวจับ "ท่อนถูกลบทิ้ง")
  const minKeep = coreGuardMinKeep();
  if (original.length > 0 && candidate.length < original.length * minKeep) {
    const shrink = Math.round((1 - candidate.length / original.length) * 100);
    return { ok: false, reason: `เนื้อหด ${shrink}% (เพดาน ${Math.round((1 - minKeep) * 100)}%)` };
  }

  return { ok: true, reason: null };
}

/**
 * ทางออกเดียวของ safeCorrect — ผลแก้ทุกเส้นทางต้องผ่านด่านนี้ก่อนออกจาก service
 * ไม่ผ่าน = คืนต้นฉบับของเวอร์ชันนั้น + log ชัด + ทิ้งรายการแก้ (เพราะไม่มีอันไหนถูกใช้จริง)
 */
function finalizeWithGuard(rollbackContent, correctedContent, corrections) {
  const guard = guardCoreNews(rollbackContent, correctedContent);
  if (guard.ok) {
    return { correctedContent, rollbackContent, corrections, _coreGuard: 'passed' };
  }

  const dropped = [...new Set(corrections.filter(c => c.type !== 'skipped_low').map(c => c.type))];
  console.warn(`[Correction] ⛔ เกราะแก่นข่าว: ${guard.reason} — ใช้ต้นฉบับ (ทิ้งการแก้ ${dropped.length ? dropped.join(', ') : 'ไม่มี'})`);
  return {
    correctedContent: rollbackContent,
    rollbackContent,
    // รายงานตามจริง: ไม่มีการแก้ไหนถูกใช้กับเนื้อที่คืนออกไป
    corrections: [{
      type: 'core_guard_revert',
      original: `(ทิ้งผลแก้: ${dropped.length ? dropped.join(', ') : 'ไม่มี'})`,
      fixed: '(ใช้ต้นฉบับ)',
      reason: `เกราะแก่นข่าว: ${guard.reason}`,
    }],
    _coreGuard: `reverted:${guard.reason}`,
  };
}
// ═══ จบเกราะแก่นข่าว ═══════════════════════════════════════════════════════

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
      // ★ 1 ส.ค. 69 (เกราะแก่นข่าว): เส้นนี้ยังไม่แตะเนื้อ (ผลแก้ = ต้นฉบับ) — ด่านจะปล่อยผ่านทันที
      //   แต่ยังต้องเรียก เผื่ออนาคตมีใครแทรกการแก้ไว้ก่อนจุดนี้ จะได้ไม่มีทางออกไหนหลุดเกราะ
      return finalizeWithGuard(rollbackContent, correctedContent, corrections);
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
    // ★ 12 มิ.ย. 69: กลุ่มการเสียชีวิต + พนัน/ยา/เหล้า ต้องเกลาตามบริบท — แทนคำตรงๆ จะได้สำนวนซ้ำจำเจ/ความหมายเพี้ยน
    // ★ 16 ก.ค. 69 (B2): เพิ่ม 'เลือด'/'เลือดสาด' — เดิมตกไป direct-replace ได้ "พบร่องรอยเหตุการณ์ไหลออกมา"
    //   ประโยคเพี้ยนแบบเดียวกับเคส "เส้นร่องรอยเหตุการณ์ในสมองแตก" (10 ก.ค.) ต้องให้ AI เกลาตามบริบท
    const L3B_DIRECT_REPLACE_MAX = 12; // ★ ผู้ตรวจ F#3: คำใหม่ในลิสต์ห้ามยาวเกินนี้ (มีข้อสอบคุม)
    const needsAIRewrite = [
      'สะเก็ดระเบิด', 'ระเบิด', 'สนามรบ', 'บาดแผล',
      'เสียชีวิต', 'ตาย', 'ดับ', 'สิ้นใจ', 'ผูกคอ', 'จบชีวิต',
      'เลือดสาด', 'เลือด',
      'พนัน', 'แทงบอล', 'แทงม้า', 'บาคาร่า', 'ยาบ้า', 'ยาไอซ์', 'ยาเสพติด', 'เสพยา', 'ค้ายา',
      'เมาแล้วขับ', 'วงเหล้า', 'ดื่มสุรา',
    ];
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
    // ★ 1 ก.ย. 69: คำยาวก่อนคำสั้น ("ฆ่าตัวตาย" ก่อน "ฆ่า") + แทน "ตำแหน่งแรกที่ผ่านกันชน" ไม่ใช่ตำแหน่งแรกในบทความ
    for (const issue of sortLongestFirst(directReplaceIssues)) {
      try {
        if (issue.type === 'forbidden_word' && issue.suggestion) {
          const before = correctedContent;
          correctedContent = guardedReplace(correctedContent, issue, { all: false });
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
          model: MODEL_FAST,
          temperature: 0.1,
          maxTokens: 8000, // ★ ผู้ตรวจ F#1: L3B คืนทั้งบทความใน JSON — 2000 ตันกับข่าวจริง
          prompt: `อ่านเนื้อหาด้านล่างแล้ว rewrite เฉพาะคำเสี่ยงที่ระบุ ให้ปลอดภัยสำหรับ Facebook
ห้ามเปลี่ยนเนื้อหา ห้ามเพิ่มข้อมูล ห้ามลดข้อมูล ห้ามเปลี่ยนโทน ห้ามยาวขึ้น
แค่เปลี่ยนคำเสี่ยงให้ปลอดภัย โดยรักษาความหมายและอ่านลื่นเหมือนเดิม

กฎพิเศษกลุ่มการเสียชีวิต (ตาย/เสียชีวิต/ดับ/สิ้นใจ): ใช้สำนวนเลี่ยงที่สุภาพ สวย และเข้ากับบริบทของเรื่อง
เช่น "จากไปอย่างสงบ" "ไม่อยู่แล้ว" "ลาลับ" "สิ้นลมอย่างสงบ" "ปิดตำนาน" — เลือกให้เหมาะกับโทนข่าว
ห้ามใช้สำนวนเดียวกันซ้ำหลายจุดในเนื้อเดียวกัน และต้องอ่านแล้วรู้ว่าหมายถึงการเสียชีวิต ไม่กำกวม
กลุ่มพนัน/ยาเสพติด/เหล้า: เกลาให้นุ่มที่สุดโดยไม่ทำให้ข้อเท็จจริงของข่าวหาย (สลาก/ลอตเตอรี่รัฐบาลไม่ใช่คำเสี่ยง)

=== คำเสี่ยงที่ต้องเปลี่ยน ===
${riskyWords}

=== เนื้อหา ===
${correctedContent}
=== จบ ===

ตอบเป็น JSON เท่านั้น: {"content": "เนื้อหาที่แก้แล้วทั้งหมด"} ห้ามอธิบาย ห้ามใส่ข้อความอื่นนอก JSON`,
        });

        // ★ 14 ส.ค. 69 (Sol backlog ข้อ 3 ขั้น 2 — แก้สัญญา L3B): callAI คืน JSON object เสมอ
        //   เดิมเช็ค typeof string = ไม่มีวันผ่าน → ตกไป direct replace ทุกครั้ง (ต้นตอ "Fallback direct replace" เคสจริง)
        const _rewritten = typeof result === 'string' ? result : (result?.content ?? null);
        if (typeof _rewritten === 'string' && _rewritten.length > correctedContent.length * 0.7 && _rewritten.length < correctedContent.length * 1.3) {
          correctedContent = _rewritten.trim();
          corrections.push({
            type: 'ai_context_rewrite',
            original: aiRewriteIssues.map(i => i.text).join(', '),
            fixed: '(AI rewrote risky words in context)',
            reason: `Context-aware replacement for ${aiRewriteIssues.length} risky words`,
          });
          console.log(`[SafeCorrection] L3B AI Rewrite: ${aiRewriteIssues.length} context-sensitive words fixed`);
        } else {
          // ★ 14 ส.ค. 69 (Sol: AI ล้มต้อง fail-closed กับท่อนยาว): direct replace ได้เฉพาะคำสั้น ≤12 ตัว —
          //   ท่อนยาวแทนดิบๆ = ประโยคพัง (เคส "หลอดร่องรอยเหตุการณ์") ให้คงเนื้อเดิม + จดธงไว้ให้คนตรวจ
          console.warn(`[SafeCorrection] L3B AI Rewrite: response invalid, short-word replace + flag long spans`);
          for (const issue of aiRewriteIssues) {
            if (issue.suggestion && issue.text.length <= L3B_DIRECT_REPLACE_MAX) {
              const before = correctedContent;
              correctedContent = correctedContent.replace(issue.text, issue.suggestion);
              if (correctedContent !== before) {
                corrections.push({ type: 'regex_replace', original: issue.text, fixed: issue.suggestion, reason: 'Fallback direct replace' });
              }
            } else {
              corrections.push({ type: 'needs_review', original: issue.text.slice(0, 80), fixed: null, reason: 'AI เกลาล้ม + ท่อนยาวเกินจะแทนดิบ — คงเนื้อเดิมไว้ให้คนตรวจ' });
            }
          }
        }
      } catch (aiErr) {
        console.warn(`[SafeCorrection] L3B AI Rewrite failed: ${aiErr.message} — short-word replace + flag long spans`);
        for (const issue of aiRewriteIssues) {
          if (issue.suggestion && issue.text.length <= L3B_DIRECT_REPLACE_MAX) {
            const before = correctedContent;
            correctedContent = correctedContent.replace(issue.text, issue.suggestion);
            if (correctedContent !== before) {
              corrections.push({ type: 'regex_replace', original: issue.text, fixed: issue.suggestion, reason: 'Fallback direct replace' });
            }
          } else {
            corrections.push({ type: 'needs_review', original: issue.text.slice(0, 80), fixed: null, reason: 'AI เกลาล้ม + ท่อนยาวเกินจะแทนดิบ — คงเนื้อเดิมไว้ให้คนตรวจ' });
          }
        }
      }
    }

    // Clean up double spaces/newlines จากการลบ
    correctedContent = correctedContent.replace(/  +/g, ' ').replace(/\n{3,}/g, '\n\n');

    console.log(`[SafeCorrection] Applied ${corrections.filter(c => c.type !== 'skipped_low').length} corrections`);

    // ★ 1 ส.ค. 69 (เกราะแก่นข่าว): ทางออกหลัก — ผลแก้ทั้งชุด (direct replace + AI rewrite + ลบ bait)
    //   ต้องผ่านด่านเทียบกับต้นฉบับก่อนเสมอ ไม่ผ่าน = ใช้ต้นฉบับ
    return finalizeWithGuard(rollbackContent, correctedContent, corrections);

  } catch (err) {
    // เส้น error: คืนต้นฉบับอยู่แล้ว = ปลอดภัยโดยโครงสร้าง ไม่ต้องผ่านด่าน (ผลแก้ไม่ได้ออกไปเลย)
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
      model: MODEL_FAST,
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
