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
import { safeCorrect, guardCoreNews } from './safeCorrectionService';
import { checkFactPreservation } from './factPreservationCheck';
import { editorialPolish } from './editorialPolishService';
import { semanticSanityCheck } from './semanticSanityCheck';
import { fabricationGate } from './fabricationGate'; // ★ 4 ส.ค. 69 ด่านจับของเกิน — ผลทดลองศึก 6 นักเขียน (FAB_GATE=0 ปิดได้)
import { bbStep } from '@/lib/trace/blackbox'; // ★ 1 ส.ค. 69 กล่องดำ: เก็บ before/after ทุกด่าน — ชี้ตัวการได้ไม่ต้องเดา
// ★ 1 ก.ย. 69 (แก้บั๊กจากรายงานตรวจสภาพ 41 ข้อ): สวิตช์อ่านทน · แทนคำเคารพ whitelist · L4.5 ห้ามลบเนื้อจริง
import { envOn } from '@/lib/utils/envFlag';
import { guardedReplace, sortLongestFirst } from './guardedReplace';
import { scrubHallucinatedPlaces } from './placeScrub';
import { findMissingFacts } from './missingFactsGate'; // ★ 2 ก.ย. 69 L4.7 ด่านข้อเท็จจริงหาย — เตือนเท่านั้น (MISSING_FACTS_GATE=0 ปิด)
// ★ 12 มิ.ย.: FlagFixer + ViralPolish ถูกปลดออกตามคำสั่งทีม ("AI เพี้ยน — ย้อน workflow กลับแบบ 11 มิ.ย. หัวค่ำ")
//   ไฟล์ flagFixerService.js / viralPolishService.js ยังอยู่ เผื่ออนาคต — ห้ามต่อกลับโดยไม่ผ่านทีม

/**
 * รัน correction pipeline ทั้งหมดกับ versions array
 * @param {Array} versions - output versions จาก Core Compose
 * @param {object} newsData - { newsTitle, newsBody }
 * @param {object} breakdownData - breakdown data (optional)
 * @returns {Array} corrected versions พร้อม _correctionDebug
 */
// ★ 14 ส.ค. 69 (เจ้าของสั่ง "คืนการพัฒนาเรื่องแบบยุค 2 เดือน"): researchFacts = ข้อเท็จจริงรีเสิร์ชที่ยืนยันแล้ว
//   ส่งให้ด่าน L1.8 ใช้เป็นฐานความจริงเพิ่ม — เดิมด่านเห็นแค่ต้นฉบับ ข้อมูลรีเสิร์ชถูกต้องเลยโดนตัดเป็น "ของเกิน"
export async function runCorrectionPipeline(versions, newsData, breakdownData, researchFacts = null, rawSourceText = null) {
  // === Bypass check ===
  if (envOn('SKIP_CORRECTION')) { // ★ 1 ก.ย. 69: รับ 1/true/on (เดิมต้อง 'true' เป๊ะ ผิดนิดเดียวคือเงียบ)
    console.log('[CorrectionPipeline] ⏭️ SKIPPED (SKIP_CORRECTION=on)');
    return versions.map(v => ({ ...v, _correctionApplied: false, _correctionSkipped: true, _blackbox: [{ layer: 'skip', note: 'SKIP_CORRECTION=true' }] }));
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
  const workVersions = versions; // FlagFixer ปลดออก 12 มิ.ย. (คำสั่งทีม — ย้อนกลับ workflow หัวค่ำ 11 มิ.ย.)

  const correctionTasks = workVersions.map(async (version, i) => {
    const vLabel = version._sourceLabel || version.style || `V${i + 1}`;

    // ★ กล่องดำต่อเวอร์ชัน — ด่านแรก: ร่างดิบตัวเขียน → เนื้อหลังจัดระเบียบ (postProcess)
    const _bb = [];

    try {
      // (Opus P2-F: ทุกการเรียกกล่องดำต้องอยู่ในเกราะ try — กติกา "ห้ามทำงานจริงพัง")
      bbStep(_bb, 'writer→postProcess', version._rawModelDraft ?? version.content, version.content,
        version._rawModelDraft ? {} : { note: 'ไม่มีร่างดิบแนบมา (เส้นทางเก่า)' });
      if (!version.content || version.content.length < 50) {
        console.log(`[Pipeline] ${vLabel}: ⏭️ Skip (content too short)`);
        return { ...version, _correctionApplied: false, _blackbox: _bb };
      }

      console.log(`\n[Pipeline] ${vLabel}: Starting...`);

      // === ★ Layer 1.8: ด่านจับของเกิน (4 ส.ค. 69) ===
      //   ตรวจก่อนทุกด่าน — ด่านถัดไป (L2..L5) จะได้ทำงานบนเนื้อที่ความจริงตรงต้นฉบับแล้ว
      //   ล้ม/ปิดสวิตช์ = ปล่อยเนื้อเดิมผ่าน (fail-open ภายใน fabricationGate เอง)
      let _fabDebug = null;
      try {
        const _gate = await fabricationGate(version.content, rawSourceText || newsData?.newsBody, researchFacts);
        bbStep(_bb, 'L1.8-ด่านของเกิน', version.content, _gate.content,
          { sus: _gate.debug.sus, confirmed: _gate.debug.confirmed, fixed: _gate.debug.fixed, skipped: _gate.debug.skipped });
        if (_gate.debug.fixed) version = { ...version, content: _gate.content };
        _fabDebug = _gate.debug;
      } catch (fabErr) {
        console.warn(`  L1.8 FabGate: SKIPPED (${fabErr.message})`);
        _fabDebug = { error: fabErr.message };
      }

      // === Layer 2: Audit ===
      const audit = await auditOutput(version);
      console.log(`  L2 Audit: score=${audit.auditScore} issues=${audit.issues.length}`);
      if (audit.auditFailed) {
        // ★ 1 ก.ย. 69: ด่านตรวจล้ม = เดินเส้นยาวต่อ (ด่านอื่นยังคุม) แต่ต้องมีร่องรอยในกล่องดำ ไม่ใช่เงียบ
        console.warn(`  ⛔ L2 Audit ล้ม — ไม่ถือว่าสะอาด (${audit.summary})`);
        bbStep(_bb, 'L2-ตรวจคำ(ล้ม)', version.content, version.content, { auditFailed: true, summary: audit.summary });
      }


      // ถ้า clean → ยังต้องผ่าน Semantic Check ก่อน Polish
      if (audit.issues.length === 0) {
        // === Layer 4.6: Semantic Sanity Check (clean path) ===
        let cleanContent = version.content;
        let cleanSemanticDebug = { checked: false };
        try {
          const semResult = await semanticSanityCheck(version.content, { sourceBody: newsData?.newsBody || rawSourceText || null }); // ★ 2 ก.ย. 69 Fact-bearing Guard
          cleanContent = semResult.sanitizedContent;
          cleanSemanticDebug = {
            checked: true,
            issuesFound: semResult.issuesFound?.length || 0,
            fixed: semResult.fixed || false,
            issues: (semResult.issuesFound || []).slice(0, 3),
            guardedFactBearing: semResult.guardedFactBearing || [], // ★ 2 ก.ย. 69
            usedFallback: !!semResult.usedFallback,
            error: semResult.error || null, // ★ 14 ส.ค. 69 (ผู้ตรวจ #3): พาธง Seam Guard (OPENING/UNSAFE_SEAM_GUARD) ถึงกล่องดำ
          };
          console.log(`  L4.6 Semantic (clean): ${cleanSemanticDebug.issuesFound} issues ${cleanSemanticDebug.fixed ? '(fixed)' : '(clean)'}`);
        } catch (semErr) {
          console.warn(`  L4.6 Semantic (clean): SKIPPED (${semErr.message})`);
          cleanSemanticDebug = { checked: false, error: semErr.message };
        }

        bbStep(_bb, 'L4.6-ตัดประโยค(clean)', version.content, cleanContent, { issues: cleanSemanticDebug.issues || [] });
        const { polishedContent, changes } = editorialPolish(cleanContent);
        console.log(`  L5 Polish: ${changes.length} changes (clean path)`);
        bbStep(_bb, 'L5-ขัดเกลา(clean)', cleanContent, polishedContent, { changes: changes.length });
        // ★ 1 ส.ค. 69 (Sol รอบ 2): เส้น clean ก็วิ่งผ่าน L4.6 ที่ "ลบท่อนพังทิ้ง" ได้เหมือนกัน — ต้องผ่านเกราะเดียวกันก่อนคืน
        const _cleanGuard = guardCoreNews(version.content, polishedContent);
        if (!_cleanGuard.ok) console.warn(`  ⛔ เกราะแก่นข่าว (clean path): ${_cleanGuard.reason} — ใช้ต้นฉบับ`);
        bbStep(_bb, 'เกราะแก่นข่าว(clean)', polishedContent, _cleanGuard.ok ? polishedContent : version.content, { verdict: _cleanGuard.ok ? 'ผ่าน' : `ย้อนต้นฉบับ:${_cleanGuard.reason}` });

        // ตรวจฉบับที่จะคืนจริงหลัง L4.6 + L5 + core guard แล้ว (เดิม clean path ไม่เคยตรวจ)
        const _cleanCandidate = _cleanGuard.ok ? polishedContent : version.content;
        const _cleanCandidateFactCheck = checkFactPreservation(version.content, _cleanCandidate, newsData || {});
        const _cleanFactRolledBack = _cleanCandidateFactCheck.action === 'rollback';
        let _cleanFinalContent = _cleanCandidate;
        let _cleanFinalFactCheck = _cleanCandidateFactCheck;
        if (_cleanFactRolledBack) {
          console.warn(`  ⛔ L4 FactCheck (clean final): พบ drift ${_cleanCandidateFactCheck.drifts.length} จุด — ใช้ต้นฉบับ`);
          _cleanFinalContent = version.content;
          // ธง factPreserved ต้องมาจากฉบับที่คืนจริง ไม่ใช่ฉบับที่เพิ่งถูกปฏิเสธ
          _cleanFinalFactCheck = checkFactPreservation(version.content, _cleanFinalContent, newsData || {});
        }
        bbStep(_bb, 'L4-เช็คข้อเท็จจริง(final clean)', _cleanCandidate, _cleanFinalContent,
          { candidateAction: _cleanCandidateFactCheck.action, candidateDrifts: _cleanCandidateFactCheck.drifts.length, outputPreserved: _cleanFinalFactCheck.preserved });
        // ★ 2 ก.ย. 69 L4.7: เทียบต้นฉบับดิบกับฉบับที่จะคืนจริง — เตือนอย่างเดียว (null = สวิตช์ปิด → ไม่แตะผลลัพธ์)
        const _cleanMissing = runMissingFactsGate(_bb, vLabel, rawSourceText || newsData?.newsBody, _cleanFinalContent);
        return {
          ...version,
          content: _cleanFinalContent,
          _blackbox: _bb,
          _correctionApplied: changes.length > 0 || cleanSemanticDebug.fixed,
          ...(_cleanMissing ? { _missingFacts: _cleanMissing } : {}), // ★ 2 ก.ย. 69 L4.7 (สวิตช์ปิด = ไม่มีคีย์นี้)
          _correctionDebug: {
            fabGate: _fabDebug,
            coreGuard: _cleanGuard.ok ? 'passed' : `reverted:${_cleanGuard.reason}`,
            auditScore: audit.auditScore,
            issuesFound: 0,
            correctionsMade: 0,
            factPreserved: _cleanFinalFactCheck.preserved,
            factDrifts: _cleanFinalFactCheck.drifts.length,
            rejectedFactDrifts: _cleanFactRolledBack ? _cleanCandidateFactCheck.drifts.length : 0,
            rolledBack: _cleanFactRolledBack,
            semanticCheck: cleanSemanticDebug,
            polishChanges: changes.length,
            path: _cleanFactRolledBack ? 'rollback' : 'clean',
            ...missingFactsDebug(_cleanMissing), // ★ 2 ก.ย. 69 L4.7 คำเตือนแทน logPipeline (เฉพาะเมื่อมีของหาย)
          },
        };
      }


      // === Layer 3: Safe Correction ===
      const { correctedContent, rollbackContent, corrections } = await safeCorrect(version.content, audit.issues);
      const actualCorrections = corrections.filter(c => c.type !== 'skipped_low');
      console.log(`  L3 Correct: ${actualCorrections.length} applied`);
      bbStep(_bb, 'L3-แก้คำ', version.content, correctedContent, { corrections: actualCorrections.slice(0, 5).map(c => ({ type: c.type, text: String(c.text || '').slice(0, 60) })) });

      // === Layer 4: Fact Preservation ของผลแก้ L3 ===
      // คงลำดับเดิม: เลือก safeContent → scrub rollback → L4.5/L4.6/L5
      // แล้วค่อยตรวจฉบับท้ายอีกครั้งด้านล่าง
      const factCheck = checkFactPreservation(version.content, correctedContent, newsData || {});
      const _initialFactRolledBack = factCheck.action === 'rollback';

      let safeContent = _initialFactRolledBack ? rollbackContent : correctedContent;
      bbStep(_bb, 'L4-เช็คข้อเท็จจริง', correctedContent, safeContent,
        { action: factCheck.action, drifts: factCheck.drifts.length });

      // rollback คืนเนื้อก่อน L3 ซึ่งอาจมีคำต้องห้าม: ล้างแบบแทนตรงก่อนเข้าด่านถัดไป
      let _rollbackScrub = null;
      if (_initialFactRolledBack) {
        try {
          const reAudit = await auditOutput({ ...version, content: safeContent });
          const _forbidden = (reAudit.issues || []).filter(x => x.type === 'forbidden_word' && x.text
            && typeof x.suggestion === 'string'
            && x.suggestion.length <= 25 && !/เช่น|สำนวน|บริบท|\//.test(x.suggestion));
          // ★ 1 ก.ย. 69: เดิม split/join ดิบ → ทำลายศัพท์แพทย์ที่ L2 กันไว้ ("เส้นเลือด" → "เส้นร่องรอยเหตุการณ์")
          for (const iss of sortLongestFirst(_forbidden)) {
            safeContent = guardedReplace(safeContent, iss, { all: true });
          }
          _rollbackScrub = { reAuditIssues: (reAudit.issues || []).length, forbiddenScrubbed: _forbidden.length };
          if (_forbidden.length > 0) {
            console.log(`  L4+ Rollback Scrub: ล้างคำต้องห้าม ${_forbidden.length} จุดจากเนื้อ rollback`);
          }
        } catch (scrubErr) {
          console.warn(`  L4+ Rollback Scrub: SKIPPED (${scrubErr.message})`);
          _rollbackScrub = { error: scrubErr.message };
        }
      }

      // === Layer 4.5: Hallucination Scrubbing ===
      // ★ ปรับ 12 มิ.ย. (ลูปคุณภาพจับได้): เดิมแทนทุกอย่างด้วย "ที่เกิดเหตุ" ทื่อๆ → ได้คำพิกล
      //   ("ผที่เกิดเหตุ", ข่าวโรงพยาบาลกลายเป็น "ที่เกิดเหตุ") — เปลี่ยนเป็นแทนแบบรักษาชนิดสถานที่
      // ★ 1 ก.ย. 69: ย้ายไป placeScrub.js (เทสได้) + แก้บั๊ก regex กินท่อนยาวไม่จำกัดจนลบเนื้อข่าวจริงเป็นท่อน
      let scrubbedContent = safeContent;
      if (newsData && newsData.newsBody) {
        scrubbedContent = scrubHallucinatedPlaces(safeContent, newsData.newsBody, (m) => console.log(m)).content;
      }

      bbStep(_bb, 'L4.5-ล้างสถานที่หลอน', safeContent, scrubbedContent);

      // === Layer 4.6: Semantic Sanity Check (AI) ===
      let semanticContent = scrubbedContent;
      let semanticDebug = { checked: false };
      try {
        const semanticResult = await semanticSanityCheck(scrubbedContent, { sourceBody: newsData?.newsBody || rawSourceText || null }); // ★ 2 ก.ย. 69 Fact-bearing Guard
        semanticContent = semanticResult.sanitizedContent;
        semanticDebug = {
          checked: true,
          issuesFound: semanticResult.issuesFound?.length || 0,
          fixed: semanticResult.fixed || false,
          issues: (semanticResult.issuesFound || []).slice(0, 3),
          guardedFactBearing: semanticResult.guardedFactBearing || [], // ★ 2 ก.ย. 69
          usedFallback: !!semanticResult.usedFallback,
          error: semanticResult.error || null, // ★ 14 ส.ค. 69 (ผู้ตรวจ #3): พาธง Seam Guard ถึงกล่องดำ
        };
        console.log(`  L4.6 Semantic: ${semanticDebug.issuesFound} issues ${semanticDebug.fixed ? '(fixed)' : '(clean)'}`);
      } catch (semErr) {
        console.warn(`  L4.6 Semantic: SKIPPED (${semErr.message})`);
        semanticDebug = { checked: false, error: semErr.message };
      }

      bbStep(_bb, 'L4.6-ตัดประโยค', scrubbedContent, semanticContent, { issues: semanticDebug.issues || [] });

      // === Layer 5: Editorial Polish ===
      const { polishedContent, changes } = editorialPolish(semanticContent);
      console.log(`  L5 Polish: ${changes.length} changes`);
      bbStep(_bb, 'L5-ขัดเกลา', semanticContent, polishedContent, { changes: changes.length });

      // ★ เกราะเร็วชั้นนอก: เลขเด่นครบ + เนื้อไม่หดเกินเพดาน ไม่ผ่านข้อเดียว = ใช้ต้นฉบับทั้งใบ
      //   ด่านข้อเท็จจริงเต็มด้านล่างตรวจฉบับหลัง L4.6/L5 ต่ออีกชั้นก่อนคืนจริง
      const _coreGuard = guardCoreNews(version.content, polishedContent);
      if (!_coreGuard.ok) console.warn(`  ⛔ เกราะแก่นข่าว (ชั้นท่อ): ${_coreGuard.reason} — ใช้ต้นฉบับ`);
      bbStep(_bb, 'เกราะแก่นข่าว', polishedContent, _coreGuard.ok ? polishedContent : version.content, { verdict: _coreGuard.ok ? 'ผ่าน' : `ย้อนต้นฉบับ:${_coreGuard.reason}` });

      // === Final Fact Preservation: ตรวจหลังทุกชั้นที่แก้เนื้อ ===
      const _candidateContent = _coreGuard.ok ? polishedContent : version.content;
      const _candidateFactCheck = checkFactPreservation(version.content, _candidateContent, newsData || {});
      const _lateFactRolledBack = _candidateFactCheck.action === 'rollback';
      let finalContent = _candidateContent;
      let finalFactCheck = _candidateFactCheck;

      if (_lateFactRolledBack) {
        console.warn(`  ⛔ L4 FactCheck (final): พบ drift ${_candidateFactCheck.drifts.length} จุด — ใช้ฉบับปลอดภัยก่อน L4.5/L4.6/L5`);
        // ห้ามย้อนถึง rollbackContent ทันที: จะทำให้การแก้ L3 ที่ผ่านแล้วหายไป
        finalContent = safeContent;
        finalFactCheck = checkFactPreservation(version.content, finalContent, newsData || {});
        if (finalFactCheck.action === 'rollback') {
          console.warn(`  ⛔ L4 FactCheck (safe fallback): ยังพบ drift ${finalFactCheck.drifts.length} จุด — ใช้ต้นฉบับไม่แก้`);
          finalContent = rollbackContent;
          finalFactCheck = checkFactPreservation(version.content, finalContent, newsData || {});
        }
      }

      const _factRolledBack = _initialFactRolledBack || _lateFactRolledBack;
      const _rejectedFactDrifts = (_initialFactRolledBack ? factCheck.drifts.length : 0)
        + (_lateFactRolledBack ? _candidateFactCheck.drifts.length : 0);

      bbStep(_bb, 'L4-เช็คข้อเท็จจริง(final)', _candidateContent, finalContent,
        { initialAction: factCheck.action, candidateAction: _candidateFactCheck.action, candidateDrifts: _candidateFactCheck.drifts.length, outputPreserved: finalFactCheck.preserved });
      // ★ 2 ก.ย. 69 L4.7: เทียบต้นฉบับดิบกับฉบับสุดท้าย — เตือนอย่างเดียว (null = สวิตช์ปิด → ไม่แตะผลลัพธ์)
      const _missingFacts = runMissingFactsGate(_bb, vLabel, rawSourceText || newsData?.newsBody, finalContent);

      return {
        ...version,
        content: finalContent,
        _blackbox: _bb,
        _correctionApplied: true,
        ...(_missingFacts ? { _missingFacts } : {}), // ★ 2 ก.ย. 69 L4.7 (สวิตช์ปิด = ไม่มีคีย์นี้)
        _correctionDebug: {
          fabGate: _fabDebug,
          coreGuard: _coreGuard.ok ? 'passed' : `reverted:${_coreGuard.reason}`,
          auditScore: audit.auditScore,
          issuesFound: audit.issues.length,
          issueTypes: [...new Set(audit.issues.map(i => i.type))],
          correctionsMade: actualCorrections.filter(c => c.type !== 'needs_review').length, // ★ ผู้ตรวจ F#4: ธงรอคนตรวจไม่ใช่การแก้
          corrections: actualCorrections.slice(0, 5),
          factPreserved: finalFactCheck.preserved,
          factDrifts: finalFactCheck.drifts.length,
          rejectedFactDrifts: _rejectedFactDrifts,
          rolledBack: _factRolledBack,
          rollbackScrub: _rollbackScrub,
          semanticCheck: semanticDebug,
          polishChanges: changes.length,
          path: _factRolledBack ? 'rollback' : 'corrected',
          ...missingFactsDebug(_missingFacts), // ★ 2 ก.ย. 69 L4.7 คำเตือนแทน logPipeline (เฉพาะเมื่อมีของหาย)
        },
      };

    } catch (err) {
      // ===  FAIL-SAFE: ถ้า error → ใช้ original ===
      console.error(`[Pipeline] ${vLabel}: ERROR — ${err.message}`);
      _bb.push({ layer: 'ERROR', error: err.message });
      return {
        ...version,
        _correctionApplied: false,
        _correctionError: err.message,
        _blackbox: _bb,
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

  // ViralPolish ปลดออก 12 มิ.ย. (คำสั่งทีม — ย้อนกลับ workflow หัวค่ำ 11 มิ.ย.)
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const appliedCount = corrected.filter(v => v._correctionApplied).length;
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`🔧 CORRECTION COMPLETE — ${appliedCount}/${versions.length} corrected in ${totalTime}s`);
  console.log(`${'═'.repeat(50)}\n`);

  return corrected;
}

// ★ 2 ก.ย. 69 — L4.7 ด่านข้อเท็จจริงหาย (เตือนเท่านั้น ห้ามแก้เนื้อ) · ค่าเริ่มต้นเปิด · MISSING_FACTS_GATE=0 = ไม่ทำอะไร (ผลลัพธ์เหมือนเดิมทุกไบต์)
//   ที่มา: เทสสนามจริงเคสศรราม V2 รอบ 1 — "ห่วงเรื่องการขับรถ" หายจากผล ไม่มีด่านไหนเห็น (L4 เทียบร่างนักเขียนกับผลแก้ ไม่ได้เทียบต้นฉบับ)
//   เรียกหลัง FactCheck สุดท้ายทั้ง clean path และ main path · ล้ม = fail-open (บันทึก error ไว้ใน _missingFacts)
//   ⚠️ diagnostics เท่านั้น (ผู้ตรวจไขว้ 2 ก.ย. 69): ผลอยู่ใน version._missingFacts / _correctionDebug.missingFacts / กล่องดำ / console.warn
//   — ไม่เข้า pipelineQualityWarnings จึง "ยังไม่ถึงพนักงาน" ใน UI · จะให้พนักงานเห็นจริง = งานแยก (เปลี่ยนสิ่งที่ UI แสดง รอเจ้าของเคาะ)
//   (ประกาศไว้ท้ายไฟล์โดยเจตนา — tests/correction-fact-stability โหลดซอร์สตั้งแต่ runCorrectionPipeline ถึงท้ายไฟล์ · ห้าม export)
function runMissingFactsGate(_bb, vLabel, rawSource, finalContent) {
  if (process.env.MISSING_FACTS_GATE === '0') return null;
  try {
    const source = String(rawSource || '');
    if (!source.trim()) return { checked: 0, missing: [], coverage: 1, skipped: 'no_source' };
    const result = findMissingFacts(source, finalContent);
    if (result.missing.length > 0) {
      const preview = result.missing.slice(0, 5).map(m => `${m.type}:${m.text}`).join(' | ');
      console.warn(`  ⚠️ L4.7 MissingFacts ${vLabel}: ข้อเท็จจริงจากต้นฉบับหาย ${result.missing.length}/${result.checked} — ${preview}`);
      bbStep(_bb, 'L4.7-ด่านข้อเท็จจริงหาย', finalContent, finalContent,
        { checked: result.checked, coverage: result.coverage, missing: result.missing.slice(0, 10) });
    }
    return result;
  } catch (err) {
    console.warn(`  L4.7 MissingFacts: SKIPPED (${err.message})`);
    return { checked: 0, missing: [], coverage: 1, error: err.message };
  }
}

/** สรุปสำหรับ _correctionDebug (แทน logPipeline ที่ไฟล์นี้ไม่มี · diagnostics — ไม่ใช่ข้อความที่พนักงานเห็น) — ใส่เฉพาะเมื่อมีของหาย ไม่งั้นไม่เพิ่มคีย์ */
function missingFactsDebug(result) {
  if (!result || !Array.isArray(result.missing) || result.missing.length === 0) return {};
  return {
    missingFacts: {
      warning: `ข้อเท็จจริงจากต้นฉบับหาย ${result.missing.length}/${result.checked} จุด — diagnostics เท่านั้น (ยังไม่แสดงให้พนักงาน · อ่านจาก _missingFacts/กล่องดำ)`,
      missing: result.missing.length,
      checked: result.checked,
      coverage: result.coverage,
      items: result.missing.slice(0, 10),
    },
  };
}
