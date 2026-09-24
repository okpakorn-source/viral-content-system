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
// ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S2 · เจ้าของอนุมัติ) — PL-04/OV-01: แทนคำ "ตรงตำแหน่งที่กฎของ L2 จับได้" (สแกนใหม่ด้วยกฎเดียวกัน)
//   แทน String.replace ตำแหน่งแรกที่เคยไปโดนคำที่ L2 ยกเว้นไว้ (ทำร้ายตัวเอง/ยิงประตู/เส้นเลือด/ระดับ) · เส้นทาง AI/แทนตรง อ่านจาก issue.aiRewrite (ตารางกลาง)
//   RISK_WORDS_LEGACY=1 → รายการ needsAIRewrite + String.replace เดิมทุกไบต์
// ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S5 · เจ้าของอนุมัติ) — MC-07/PL-12: findRiskWords = ด่านตรวจผล AI ของ L3A (ผลแก้ห้ามเพิ่มคำเสี่ยง) ดู validateL3aFix ท้ายไฟล์
import { replaceRiskWordIssue, findRiskWords } from '../ai/safetyFilter.js';
import { isRiskWordsLegacy } from '../ai/riskWords.js';

/**
 * ★ 24 ก.ย. 69 (S2): แทนคำเสี่ยง 1 issue — ค่าเริ่มต้น: ถ้า issue มี ruleId (มาจาก L2 ตารางกลาง) แทนตรงตำแหน่งที่กฎนั้นจับในข้อความปัจจุบัน
 *   (กฎไม่จับอะไรแล้ว = คงข้อความเดิม ไม่ถอยไป replace ตำแหน่งแรก — นั่นคือบั๊ก PL-04) · issue ไม่มี ruleId หรือโหมดถอย = String.replace เดิม
 */
function replaceIssueText(content, issue) {
  if (!isRiskWordsLegacy() && issue.ruleId) {
    const replaced = replaceRiskWordIssue(content, issue);
    return replaced === null ? content : replaced;
  }
  return content.replace(issue.text, issue.suggestion);
}

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

    // ★ 24 ก.ย. 69 (S2): issue จาก L2 ตารางกลางมี aiRewrite (boolean) → ใช้ค่านั้น · issue ที่ไม่มี (ทำมือ/โหมดถอย) → รายการ needsAIRewrite เดิม
    const useLegacyRouting = isRiskWordsLegacy();
    for (const issue of highMedIssues) {
      const wantsAI = issue.type === 'forbidden_word' && (
        (!useLegacyRouting && typeof issue.aiRewrite === 'boolean')
          ? issue.aiRewrite
          : needsAIRewrite.some(w => issue.text.includes(w))
      );
      if (wantsAI) {
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
          correctedContent = replaceIssueText(correctedContent, issue); // ★ S2 (ของเดิม: correctedContent.replace(issue.text, issue.suggestion))
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
            // ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S5 · เจ้าของอนุมัติ) — MC-07/PL-12: ส่งวลี AI ทุกตัวที่อยู่ในประโยคเดียวกันไปพร้อมกัน
            //   (จ่าย 1 ครั้ง/ประโยค ไม่ใช่ 1 ครั้ง/วลี — วลีที่ AI ถอดไปแล้ว รอบถัดไป extractSentence หาไม่เจอ = ไม่เรียกซ้ำ) · โหมด legacy ไม่ใช้รายการนี้ (พรอมต์เดิมวลีเดียว)
            const phrasesInSentence = directReplaceIssues
              .filter((i) => i.type === 'ai_wording' && typeof i.text === 'string' && sentenceWithIssue.includes(i.text))
              .map((i) => i.text);
            const fixedSentence = await fixSentenceWithAI(sentenceWithIssue, issue, phrasesInSentence); // ★ S5 (ของเดิม: fixSentenceWithAI(sentenceWithIssue, issue))
            if (fixedSentence && fixedSentence !== sentenceWithIssue) {
              // ★ S5: replacer function — กัน $& / $' / $` ในผล AI ถูก String.replace ขยาย · โหมด legacy คงบรรทัดเดิมทุกไบต์
              correctedContent = l3aAiFixMode() === 'legacy'
                ? correctedContent.replace(sentenceWithIssue, fixedSentence)
                : correctedContent.replace(sentenceWithIssue, () => fixedSentence);
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
              correctedContent = replaceIssueText(correctedContent, issue); // ★ S2 (ของเดิม: correctedContent.replace(issue.text, issue.suggestion))
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
            correctedContent = replaceIssueText(correctedContent, issue); // ★ S2 (ของเดิม: correctedContent.replace(issue.text, issue.suggestion))
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
 * ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S5 · เจ้าของอนุมัติ) — MC-07 (ผู้ตรวจ: "ทบทวนวิธีตัดขอบประโยค"): ของเดิมนับ '.' ทุกตัวเป็นจุดจบประโยค
 *   ทั้งที่ภาษาไทยไม่ใช้จุดจบประโยค แต่ใช้จุดในตัวย่อ/เวลา/ทศนิยม (สน.บางนา · จ.ขอนแก่น · 02.30 น. · 1.5 ล้าน) → "ประโยค" ที่ส่งให้ AI
 *   เริ่มกลางคำ ("บางนา จับกุม…" / "ขอนแก่น ซึ่งถือเป็น…") เสี่ยง AI เก็บกวาดท่อนหัวที่ห้อยอยู่ · ค่าเริ่มต้นใช้ isL3aSentenceBoundary
 *   (\n / 。 เสมอ · '.' เฉพาะที่ตามด้วยช่องว่าง/จบข้อความ และไม่ใช่ตัวย่อไทย 1–3 ตัวอักษร/ตัวเลขนำหน้า) · L3A_AI_FIX=legacy = extractSentenceLegacy (ของเดิมทุกไบต์)
 * export ไว้ให้ข้อสอบยิงตรง
 */
export function extractSentence(content, phrase) {
  if (l3aAiFixMode() === 'legacy') return extractSentenceLegacy(content, phrase);
  const idx = content.indexOf(phrase);
  if (idx === -1) return null;

  let start = idx;
  while (start > 0 && !isL3aSentenceBoundary(content, start - 1)) {
    start--;
  }

  let end = idx + phrase.length;
  while (end < content.length && !isL3aSentenceBoundary(content, end)) {
    end++;
  }

  return content.substring(start, end + 1).trim();
}

const L3A_THAI_LETTER_RE = /[ก-๎]/; // อักษร/สระ/วรรณยุกต์ไทย (ไม่รวมเลขไทย ๐-๙)
const L3A_DIGIT_RE = /[0-9๐-๙]/;

/** จุดจบประโยคสำหรับ L3A: \n และ 。 เสมอ · '.' ต่อเมื่อตามด้วยช่องว่าง/จบข้อความ และข้างหน้าไม่ใช่ตัวย่อไทย (อักษรไทย 1–3 ตัวติดจุด) หรือตัวเลข (ข้อ 1. / 02.30 น.) */
function isL3aSentenceBoundary(content, i) {
  const ch = content[i];
  if (ch === '\n' || ch === '。') return true;
  if (ch !== '.') return false;
  const next = content[i + 1];
  if (next !== undefined && !/\s/.test(next)) return false; // จ.ขอนแก่น · สน.บางนา · 10.30 · v2.0 → จุดกลางคำ
  let j = i - 1;
  let run = 0;
  while (j >= 0 && L3A_THAI_LETTER_RE.test(content[j])) { run++; j--; }
  if (run >= 1 && run <= 3) return false;                      // น. · จ. · สน. · กทม. · พ.ต.อ.
  if (run === 0 && j >= 0 && L3A_DIGIT_RE.test(content[j])) return false; // "ข้อ 1. …" / "เวลา 10. …"
  return true;
}

/** ★ S5 โหมดถอย L3A_AI_FIX=legacy — extractSentence เดิมทุกไบต์ (ห้ามแก้ · ของจริงอยู่ที่ extractSentence ด้านบน) */
function extractSentenceLegacy(content, phrase) {
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

// ═══ ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S5 · เจ้าของอนุมัติ) — MC-07 / PL-12: L3A fixSentenceWithAI ═══════════════════════
// บั๊ก (ผู้ตรวจ 2 คนยืนยัน · ทำซ้ำได้ด้วย callAI จริง+SDK ปลอม): ของเดิมเช็ค `typeof result === 'string'` แต่ callAI (src/lib/ai/openai.js)
//   บังคับ response_format json_object แล้ว JSON.parse → คืน object เสมอ = ทิ้งผลทุกครั้งตั้งแต่ 1 มิ.ย. 69 (จ่าย luna 1 ครั้ง/วลี · ล้มถอย terra อีก 1
//   · ไม่มีชั้นอื่นแก้วลี AI แทน) · maxTokens 200 กับโมเดล reasoning เสี่ยงตอบว่าง/JSON ขาดกลาง · L3B ซ่อมสัญญาเดียวกันไปแล้ว 14 ส.ค. แต่ L3A ตกหล่น
// วิธีแก้ (ค่าเริ่มต้น L3A_AI_FIX ไม่ตั้ง/1/on/true/yes): พรอมต์สั่งตอบ {"sentence": …} · อ่าน result.sentence (รับสตริงตรงตามสัญญาเดิม / object ที่มี
//   ค่าเป็นสตริงตัวเดียวไม่กำกวม) · maxTokens 2000 · ผ่านด่าน validateL3aFix ก่อนใช้ (ไม่เพิ่มข้อเท็จจริง) · ไม่ผ่าน = คืน null = คงประโยคเดิม (fallback เดิม)
//   L3A_AI_FIX=0/off/false/no → ไม่เรียก AI เลย (ไม่จ่ายเงิน) ผลลัพธ์เท่าของเดิมทุกไบต์ (ของเดิมไม่เคยใช้ผลได้) · L3A_AI_FIX=legacy → โค้ดเดิมทุกไบต์
//   (fixSentenceWithAILegacy: พรอมต์เดิม maxTokens 200 เช็ค typeof string) ไว้ทำซ้ำบั๊ก/เทียบ
// ★ L3A ไม่เคยได้ผลมาก่อน → การเปิดใช้ผลจริง = "พฤติกรรมใหม่" ของข่าวที่ออก (ตัวอย่างก่อน/หลัง: C:\tmp\news-g1-samples\S5.md) — ถอยได้ทันทีด้วย L3A_AI_FIX=0
// ข้อสอบ: tests/l3a-ai-fix-mc07.test.mjs (mock callAI ครอบ object/สตริง/ว่าง/โยน · 3 โหมดสวิตช์ · mutation 5 แบบ)
const L3A_OFF_VALUES = new Set(['0', 'off', 'false', 'no']);
const L3A_MAX_TOKENS = 2000;   // ของเดิม 200 — "ประโยค" ไทยจาก extractSentence คือทั้งย่อหน้า (ตัดที่ \n . 。) + luna เป็นโมเดล reasoning "เพดานต่ำ=ตอบว่าง"
const L3A_MAX_GROW = 1.2;      // ผลยาวได้ไม่เกิน 120% ของเดิม (พรอมต์สั่ง "ห้ามยาวกว่าเดิม" — เผื่อเกลาคำเล็กน้อย)
const L3A_MIN_KEEP = 0.6;      // ผลหดได้ไม่ต่ำกว่า 60% (ถอดวลี AI ≠ ตัดครึ่งประโยค)
const L3A_NEW_WORDS_MIN = 4;   // เพดานคำใหม่ (Intl.Segmenter 'th'): มากสุดของ {4 · 2 คำ/วลีที่สั่งแก้ + 2 · 10% ของจำนวนคำเดิม}
const L3A_NEW_WORDS_RATIO = 0.1;
const L3A_NUMBER_RE = /[0-9๐-๙]+(?:[.,:][0-9๐-๙]+)*/g;

/** สวิตช์ L3A_AI_FIX — อ่านตอนเรียกทุกครั้ง (ไม่แคช) · 'on' = ใช้ผล AI จริง (ค่าเริ่มต้น · ค่าอื่นที่ไม่รู้จักก็ 'on') · 'off' = ไม่เรียก AI · 'legacy' = โค้ดเดิมทุกไบต์ */
export function l3aAiFixMode() {
  const raw = process.env.L3A_AI_FIX;
  if (raw == null) return 'on';
  const v = String(raw).trim().replace(/^["']|["']$/g, '').toLowerCase();
  if (L3A_OFF_VALUES.has(v)) return 'off';
  if (v === 'legacy') return 'legacy';
  return 'on';
}

/** ดึงประโยคจากผล callAI: สตริง (สัญญาเดิม) · object.sentence · object ที่มีค่าเป็นสตริงเพียงตัวเดียว (โมเดลตั้งชื่อ key เอง — ผู้ตรวจ PL-12 เตือน · ข้าม key ขึ้นต้น _ เช่น _error) · อื่น = null */
function pickL3aSentence(result) {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  if (typeof result.sentence === 'string') return result.sentence;
  const strings = Object.entries(result).filter(([k, v]) => !k.startsWith('_') && typeof v === 'string').map(([, v]) => v);
  return strings.length === 1 ? strings[0] : null;
}

const l3aNumbers = (text) => (String(text).match(L3A_NUMBER_RE) || []).sort().join(' ');

let _l3aSegmenter; // undefined = ยังไม่ลอง · null = รันไทม์ไม่มี Intl.Segmenter (Node ≥16 / Vercel มีครบ) → ข้ามข้อคำใหม่
function l3aWords(text) {
  if (_l3aSegmenter === undefined) {
    try { _l3aSegmenter = new Intl.Segmenter('th', { granularity: 'word' }); } catch { _l3aSegmenter = null; }
  }
  if (!_l3aSegmenter) return null;
  const words = [];
  for (const seg of _l3aSegmenter.segment(text)) if (seg.isWordLike) words.push(seg.segment);
  return words;
}

/**
 * ด่านตรวจผล AI ของ L3A ก่อนใช้ — หลัก "ไม่เพิ่มข้อเท็จจริง": ผลแก้ต้องเป็นประโยคเดิมที่ถอดวลี AI ออก ไม่ใช่ประโยคใหม่
 *   ไม่ว่าง · ไม่ใช่ประโยคเดิม · วลีหลักที่สั่งแก้ต้องหาย · ไม่ขึ้นบรรทัดใหม่ · ยาว ≤120% / ≥60% ของเดิม · ชุดตัวเลขเท่าเดิมเป๊ะ (ไม่หาย/ไม่เพิ่ม/ไม่เปลี่ยน)
 *   · ไม่เพิ่มคำเสี่ยง (findRiskWords ตารางกลาง นับต่อกฎ) · คำใหม่ไม่เกินเพดาน (Intl.Segmenter — ประโยค/ข้อเท็จจริงใหม่ต้องใช้คำใหม่)
 * export ไว้ให้ข้อสอบยิงตรง · ทิศทางเมื่อไม่ผ่าน: ทิ้งผล คงประโยคเดิม (อย่างแย่ที่สุดที่ยอมได้ = วลี AI ยังอยู่ ไม่ใช่ข้อเท็จจริงเพี้ยน)
 * @param {string} sentence   ประโยคเดิม
 * @param {string|null} candidate  ผลจาก pickL3aSentence
 * @param {string[]|string} phrases  วลีที่สั่งแก้ (ตัวแรก = วลีหลักของ issue)
 * @returns {{ ok: boolean, fixed: string|null, reason: string|null }}
 */
export function validateL3aFix(sentence, candidate, phrases) {
  const original = String(sentence || '');
  const list = (Array.isArray(phrases) ? phrases : [phrases]).filter((p) => typeof p === 'string' && p);
  const reject = (reason) => ({ ok: false, fixed: null, reason });
  if (typeof candidate !== 'string') return reject('ผลไม่ใช่สตริง');
  const fixed = candidate.trim();
  if (!fixed) return reject('ผลว่างเปล่า');
  if (fixed === original.trim()) return reject('AI คืนประโยคเดิม');
  if (list.length && fixed.includes(list[0])) return reject(`วลี "${list[0]}" ยังอยู่`);
  if (/\n/.test(fixed) && !/\n/.test(original)) return reject('มีขึ้นบรรทัดใหม่');
  if (fixed.length > original.length * L3A_MAX_GROW) return reject(`ยาวขึ้น ${fixed.length}/${original.length} ตัวอักษร (เพดาน ${Math.round(L3A_MAX_GROW * 100)}%)`);
  if (fixed.length < original.length * L3A_MIN_KEEP) return reject(`หดเหลือ ${fixed.length}/${original.length} ตัวอักษร (พื้น ${Math.round(L3A_MIN_KEEP * 100)}%)`);
  if (l3aNumbers(fixed) !== l3aNumbers(original)) return reject('ตัวเลขไม่ตรงต้นฉบับ (หาย/เพิ่ม/เปลี่ยน)');
  const riskBefore = new Map();
  for (const hit of findRiskWords(original)) riskBefore.set(hit.rule.id, (riskBefore.get(hit.rule.id) || 0) + 1);
  for (const hit of findRiskWords(fixed)) {
    const left = riskBefore.get(hit.rule.id) || 0;
    if (left <= 0) return reject(`เพิ่มคำเสี่ยง "${hit.text}"`);
    riskBefore.set(hit.rule.id, left - 1);
  }
  const origWords = l3aWords(original);
  const fixedWords = origWords ? l3aWords(fixed) : null;
  if (origWords && fixedWords) {
    const known = new Set(origWords);
    const fresh = [...new Set(fixedWords.filter((w) => !known.has(w)))];
    const cap = Math.max(L3A_NEW_WORDS_MIN, list.length * 2 + 2, Math.ceil(origWords.length * L3A_NEW_WORDS_RATIO));
    if (fresh.length > cap) return reject(`คำใหม่ ${fresh.length} คำ เกินเพดาน ${cap} (${fresh.slice(0, 5).join(' ')})`);
  }
  return { ok: true, fixed, reason: null };
}

/**
 * ใช้ AI แก้ 1 ประโยค (micro-correction)
 * ★ S5: ค่าเริ่มต้น = สัญญาใหม่ (อ่าน object + ด่านตรวจ) · L3A_AI_FIX=0 = ไม่เรียก AI · L3A_AI_FIX=legacy = fixSentenceWithAILegacy (ของเดิมทุกไบต์)
 * @param {string} sentence
 * @param {{ text: string }} issue   issue ai_wording ของ L2 (วลีหลัก)
 * @param {string[]} [phrases]       วลี AI ทุกตัวในประโยคเดียวกัน (safeCorrect รวมมาให้ — จ่าย 1 ครั้ง/ประโยค)
 * @returns {Promise<string|null>}   ประโยคที่แก้แล้ว · null = คงประโยคเดิม
 */
async function fixSentenceWithAI(sentence, issue, phrases) {
  const mode = l3aAiFixMode();
  if (mode === 'off') {
    console.log(`[SafeCorrection] L3A: L3A_AI_FIX=0 — ไม่เรียก AI เกลาวลี "${issue.text}" (คงประโยคเดิม)`);
    return null;
  }
  if (mode === 'legacy') return fixSentenceWithAILegacy(sentence, issue);

  const list = [...new Set([issue.text, ...(Array.isArray(phrases) ? phrases : [])].filter((p) => typeof p === 'string' && p))];
  try {
    const result = await callAI({
      model: MODEL_FAST,
      temperature: 0.1,
      maxTokens: L3A_MAX_TOKENS,
      prompt: `แก้ประโยคนี้ให้เป็นภาษาคนพูดจริงบน Facebook โดยรักษาความหมายเดิม
ห้ามเปลี่ยน fact ห้ามเพิ่มข้อมูล ห้ามตัดข้อมูล ห้ามเพิ่มอารมณ์ ห้ามเปลี่ยนโทน ห้ามยาวกว่าเดิม
ตัวเลข ชื่อคน ชื่อสถานที่ คำราชาศัพท์ ต้องคงเดิมทุกตัว — แก้เฉพาะคำ/วลีที่ระบุ (ตัดทิ้งหรือเปลี่ยนเป็นคำพูดธรรมดา) ส่วนอื่นคงไว้ให้มากที่สุด

ประโยคเดิม: ${sentence}
คำที่ฟังเหมือน AI ที่ต้องแก้: ${list.map((p) => `"${p}"`).join(', ')}

ตอบเป็น JSON เท่านั้น: {"sentence": "ประโยคที่แก้แล้ว"} ห้ามอธิบาย ห้ามใส่ข้อความอื่นนอก JSON`,
    });

    const verdict = validateL3aFix(sentence, pickL3aSentence(result), list);
    if (!verdict.ok) {
      console.warn(`[SafeCorrection] L3A: ทิ้งผล AI (${verdict.reason}) — คงประโยคเดิม`);
      return null;
    }
    console.log(`[SafeCorrection] L3A: เกลาวลี ${list.map((p) => `"${p}"`).join(', ')} สำเร็จ (${sentence.length}→${verdict.fixed.length} ตัวอักษร)`);
    return verdict.fixed;
  } catch (err) {
    console.warn(`[SafeCorrection] L3A: AI ล้ม (${err?.message || err}) — คงประโยคเดิม`);
    return null;
  }
}

/**
 * ★ S5 โหมดถอย L3A_AI_FIX=legacy — โค้ดเดิมทุกไบต์ (ห้ามแก้ · ของจริงอยู่ที่ fixSentenceWithAI ด้านบน)
 *   ทำซ้ำบั๊ก MC-07/PL-12 ได้: callAI คืน object → typeof string เท็จ → null เสมอ
 */
async function fixSentenceWithAILegacy(sentence, issue) {
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
