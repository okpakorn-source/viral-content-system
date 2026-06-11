/**
 * Correction Pipeline Orchestrator
 * 
 * เชื่อม Layer 2-5 เข้าด้วยกัน:
 * Generate → Audit → Correct → Fact Check → Polish → Final Output
 * 
 * Safety rules:
 * - SKIP_CORRECTION env → bypass ทั้ง pipeline
 * - ถ้า layer ใด error → ข้ามไป ใช้ output จาก layer ก่อนหน้า
 * - ทุก version เก็บ _correctionDebug
 */

import { auditOutput } from './outputAuditService';
import { safeCorrect } from './safeCorrectionService';
import { checkFactPreservation } from './factPreservationCheck';
import { editorialPolish } from './editorialPolishService';
import { semanticSanityCheck } from './semanticSanityCheck';
import { fixFlaggedVersions } from './flagFixerService';

/**
 * รัน correction pipeline ทั้งหมดกับ versions array
 * @param {Array} versions - output versions จาก Core Compose
 * @param {object} newsData - { newsTitle, newsBody }
 * @param {object} breakdownData - breakdown data (optional)
 * @returns {Array} corrected versions พร้อม _correctionDebug
 */
export async function runCorrectionPipeline(versions, newsData, breakdownData) {
  // === Bypass check ===
  if (process.env.SKIP_CORRECTION === 'true') {
    console.log('[CorrectionPipeline] ⏭️ SKIPPED (SKIP_CORRECTION=true)');
    return versions.map(v => ({ ...v, _correctionApplied: false, _correctionSkipped: true }));
  }

  if (!versions || versions.length === 0) {
    return versions;
  }

  const startTime = Date.now();
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`🔧 CORRECTION PIPELINE — Processing ${versions.length} versions`);
  console.log(`${'═'.repeat(50)}`);

  // === ★ Layer 1.5: Flag Fixer (12 มิ.ย. 69) — จุดเดียวที่เห็นทุกเวอร์ชันพร้อมกัน ===
  //     จบซ้ำข้ามมุม / เลขหัวใจข่าวหายหมด / เปิดเรื่องต้องห้าม → AI แก้เฉพาะจุด (เคยตรวจเจอแต่ไม่มีใครแก้)
  let workVersions = versions;
  try {
    const flagResult = await fixFlaggedVersions(versions, newsData);
    workVersions = flagResult.versions;
    if (flagResult.fixed > 0) console.log(`[Pipeline] L1.5 FlagFixer: แก้ ${flagResult.fixed} เวอร์ชัน`);
  } catch (ffErr) {
    console.warn(`[Pipeline] L1.5 FlagFixer skipped: ${ffErr.message}`);
  }

  const correctionTasks = workVersions.map(async (version, i) => {
    const vLabel = version._sourceLabel || version.style || `V${i + 1}`;

    try {
      if (!version.content || version.content.length < 50) {
        console.log(`[Pipeline] ${vLabel}: ⏭️ Skip (content too short)`);
        return { ...version, _correctionApplied: false };
      }

      console.log(`\n[Pipeline] ${vLabel}: Starting...`);

      // === Layer 2: Audit ===
      const audit = await auditOutput(version);
      console.log(`  L2 Audit: score=${audit.auditScore} issues=${audit.issues.length}`);


      // ถ้า clean → ยังต้องผ่าน Semantic Check ก่อน Polish
      if (audit.issues.length === 0) {
        // === Layer 4.6: Semantic Sanity Check (clean path) ===
        let cleanContent = version.content;
        let cleanSemanticDebug = { checked: false };
        try {
          const semResult = await semanticSanityCheck(version.content);
          cleanContent = semResult.sanitizedContent;
          cleanSemanticDebug = {
            checked: true,
            issuesFound: semResult.issuesFound?.length || 0,
            fixed: semResult.fixed || false,
            issues: (semResult.issuesFound || []).slice(0, 3),
          };
          console.log(`  L4.6 Semantic (clean): ${cleanSemanticDebug.issuesFound} issues ${cleanSemanticDebug.fixed ? '(fixed)' : '(clean)'}`);
        } catch (semErr) {
          console.warn(`  L4.6 Semantic (clean): SKIPPED (${semErr.message})`);
          cleanSemanticDebug = { checked: false, error: semErr.message };
        }

        const { polishedContent, changes } = editorialPolish(cleanContent);
        console.log(`  L5 Polish: ${changes.length} changes (clean path)`);
        return {
          ...version,
          content: polishedContent,
          _correctionApplied: changes.length > 0 || cleanSemanticDebug.fixed,
          _correctionDebug: {
            auditScore: audit.auditScore,
            issuesFound: 0,
            correctionsMade: 0,
            factPreserved: true,
            rolledBack: false,
            semanticCheck: cleanSemanticDebug,
            polishChanges: changes.length,
            path: 'clean',
          },
        };
      }


      // === Layer 3: Safe Correction ===
      const { correctedContent, rollbackContent, corrections } = await safeCorrect(version.content, audit.issues);
      const actualCorrections = corrections.filter(c => c.type !== 'skipped_low');
      console.log(`  L3 Correct: ${actualCorrections.length} applied`);

      // === Layer 4: Fact Preservation ===
      const factCheck = checkFactPreservation(version.content, correctedContent, newsData || {});
      console.log(`  L4 FactCheck: preserved=${factCheck.preserved} drifts=${factCheck.drifts.length} action=${factCheck.action}`);

      // เลือก content ตาม fact check
      const safeContent = factCheck.action === 'rollback' ? rollbackContent : correctedContent;

      // === Layer 4.5: Hallucination Scrubbing ===
      // ★ ปรับ 12 มิ.ย. (ลูปคุณภาพจับได้): เดิมแทนทุกอย่างด้วย "ที่เกิดเหตุ" ทื่อๆ → ได้คำพิกล
      //   ("ผที่เกิดเหตุ", ข่าวโรงพยาบาลกลายเป็น "ที่เกิดเหตุ") — เปลี่ยนเป็นแทนแบบรักษาชนิดสถานที่
      let scrubbedContent = safeContent;
      if (newsData && newsData.newsBody) {
        const placeRegex = /(จ\.|อ\.|ต\.|ซ\.|ถ\.|จังหวัด|อำเภอ|ตำบล|ซอย|ถนน|โรงพยาบาล|สถานี|วัด|โรงเรียน|มหาวิทยาลัย|สนามบิน)\s*([ก-๙a-zA-Z]+)/g;
        const TYPE_REPLACEMENT = {
          'จ.': 'ในพื้นที่', 'จังหวัด': 'ในพื้นที่', 'อ.': 'ในพื้นที่', 'อำเภอ': 'ในพื้นที่',
          'ต.': 'ในพื้นที่', 'ตำบล': 'ในพื้นที่', 'ซ.': 'ในซอย', 'ซอย': 'ในซอย', 'ถ.': 'บนถนน', 'ถนน': 'บนถนน',
          'โรงพยาบาล': 'โรงพยาบาล', 'สถานี': 'สถานี', 'วัด': 'วัด', 'โรงเรียน': 'โรงเรียน',
          'มหาวิทยาลัย': 'มหาวิทยาลัย', 'สนามบิน': 'สนามบิน',
        };
        const places = new Map(); // full match → { prefix }
        let match;
        while ((match = placeRegex.exec(scrubbedContent)) !== null) {
          places.set(match[0].trim(), { prefix: match[1] });
        }
        const sourceBody = newsData.newsBody.replace(/\s+/g, '');
        for (const [place, info] of places) {
          const cleanPlace = place.replace(placeRegex, '$2');
          // ชื่อ ≥4 ตัวอักษรเท่านั้น (สั้นกว่านี้เสี่ยงจับคำทั่วไป) + ไม่อยู่ในต้นฉบับจริง
          if (cleanPlace.length >= 4 && !sourceBody.includes(cleanPlace)) {
            const replacement = TYPE_REPLACEMENT[info.prefix] || 'ในพื้นที่';
            console.log(`  L4.5 Hallucination Scrub: "${place}" -> "${replacement}" (รักษาชนิดสถานที่)`);
            scrubbedContent = scrubbedContent.split(place).join(replacement);
          }
        }
      }

      // === Layer 4.6: Semantic Sanity Check (AI) ===
      let semanticContent = scrubbedContent;
      let semanticDebug = { checked: false };
      try {
        const semanticResult = await semanticSanityCheck(scrubbedContent);
        semanticContent = semanticResult.sanitizedContent;
        semanticDebug = {
          checked: true,
          issuesFound: semanticResult.issuesFound?.length || 0,
          fixed: semanticResult.fixed || false,
          issues: (semanticResult.issuesFound || []).slice(0, 3),
        };
        console.log(`  L4.6 Semantic: ${semanticDebug.issuesFound} issues ${semanticDebug.fixed ? '(fixed)' : '(clean)'}`);
      } catch (semErr) {
        console.warn(`  L4.6 Semantic: SKIPPED (${semErr.message})`);
        semanticDebug = { checked: false, error: semErr.message };
      }

      // === Layer 5: Editorial Polish ===
      const { polishedContent, changes } = editorialPolish(semanticContent);
      console.log(`  L5 Polish: ${changes.length} changes`);

      return {
        ...version,
        content: polishedContent,
        _correctionApplied: true,
        _correctionDebug: {
          auditScore: audit.auditScore,
          issuesFound: audit.issues.length,
          issueTypes: [...new Set(audit.issues.map(i => i.type))],
          correctionsMade: actualCorrections.length,
          corrections: actualCorrections.slice(0, 5),
          factPreserved: factCheck.preserved,
          factDrifts: factCheck.drifts.length,
          rolledBack: factCheck.action === 'rollback',
          semanticCheck: semanticDebug,
          polishChanges: changes.length,
          path: factCheck.action === 'rollback' ? 'rollback' : 'corrected',
        },
      };

    } catch (err) {
      // ===  FAIL-SAFE: ถ้า error → ใช้ original ===
      console.error(`[Pipeline] ${vLabel}: ERROR — ${err.message}`);
      return {
        ...version,
        _correctionApplied: false,
        _correctionError: err.message,
      };
    }
  });

  // ★ PARALLEL: ทำทุก version พร้อมกัน แทนที่จะทีละตัว
  const results = await Promise.allSettled(correctionTasks);
  const corrected = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    // Fallback: ถ้า Promise rejected → ใช้ original (ฉบับผ่าน FlagFixer แล้ว)
    return { ...workVersions[i], _correctionApplied: false, _correctionError: r.reason?.message || 'Unknown' };
  });

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const appliedCount = corrected.filter(v => v._correctionApplied).length;
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`🔧 CORRECTION COMPLETE — ${appliedCount}/${versions.length} corrected in ${totalTime}s`);
  console.log(`${'═'.repeat(50)}\n`);

  return corrected;
}
