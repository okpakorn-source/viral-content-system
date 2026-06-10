/**
 * Final Save Gate — Phase 4 + 4.1 (Policy-Aware Tuning)
 * ─────────────────────────────────────────────────────────────
 * Evaluates whether a generated cover should be saved as SUCCESS
 * or flagged as NEED_MANUAL_REVIEW before gallery save.
 *
 * This gate runs AFTER:
 *   - Cover is composed (coverBuffer exists)
 *   - AI Judge score assigned
 *   - Story Match validated
 *   - Composition QA checked
 *   - Quality gate applied to source pool
 *
 * Integration point: Called in route.js between Judge/StoryMatch
 * and the gallery save (Step 9/10), just before the response.
 *
 * Principle: Bad covers (broken layout, wrong subject, reused
 * news thumbnails as main image) must NOT be saved as SUCCESS.
 * They can still be returned as preview/debug, but the gallery
 * status must reflect NEED_MANUAL_REVIEW.
 *
 * Phase 4.1: Policy-aware tuning — CIRCLE_NO_FACE is WARNING
 * for family/nature/donation types; COMPOSITION_QA_FAILED only
 * blocks on score<=4 or when combined with other blockers;
 * STORY_MATCH_LOW uses softer thresholds for family/nature.
 */

import { getPolicyForStoryType, getSlotPriority } from './coverStoryPolicyRegistry.js';

// ─── Policy-Aware Constants (Phase 4.1) ────────────────────────────────────────

/** Story types where CIRCLE_NO_FACE alone = WARNING (not blocker).
 *  These stories often feature activities/scenes rather than faces. */
const SOFT_CIRCLE_STORY_TYPES = new Set([
  'family_nature_learning', 'nature_learning',
  'family_warm', 'family_care',
  'donation', 'charity_donation',
  'community_help',
]);

/** Story types where CIRCLE_NO_FACE stays HIGH because the policy
 *  explicitly requires a face/emotion slot in the circle. */
const FACE_REQUIRED_STORY_TYPES = new Set([
  'celebrity_interview', 'relationship_drama',
  'funeral_loss', 'illness_care',
]);

/** Story types eligible for softer storyMatch thresholds. */
const SOFT_STORY_MATCH_TYPES = new Set([
  'family_nature_learning', 'nature_learning',
  'family_warm', 'family_care',
  'donation', 'charity_donation',
  'community_help', 'education_support',
]);

// ─── Blocker IDs (machine-readable) ────────────────────────────────────────────

export const BLOCKER_IDS = {
  SLOT_AUDIT_FAILED:          'SLOT_AUDIT_FAILED',
  COMPOSITION_QA_FAILED:      'COMPOSITION_QA_FAILED',
  QUALITY_GATE_FAILED:        'QUALITY_GATE_FAILED',
  STORY_MATCH_LOW:            'STORY_MATCH_LOW',
  DUPLICATE_SLOT_DETECTED:    'DUPLICATE_SLOT_DETECTED',
  SOURCE_TYPE_VIOLATION:      'SOURCE_TYPE_VIOLATION',
  MAIN_SLOT_POLICY_VIOLATION: 'MAIN_SLOT_POLICY_VIOLATION',
  BAD_IMAGE_DOMINATES:        'BAD_IMAGE_DOMINATES',
  EMBEDDED_HEADLINE_TEXT:     'EMBEDDED_HEADLINE_TEXT',
  REUSED_NEWS_COVER:          'REUSED_NEWS_COVER',
  NO_MAIN_PRIORITY_IMAGE:     'NO_MAIN_PRIORITY_IMAGE',
  VISUAL_WEIGHT_VIOLATION:    'VISUAL_WEIGHT_VIOLATION',
};

// ─── Main gate function ────────────────────────────────────────────────────────

/**
 * Evaluate all blocker conditions and return save gate result.
 *
 * @param {Object} params
 * @param {Object} params.finalSlotAudit         - { passed, issues, fixes }
 * @param {Object} params.compositionQA          - { passed, issues, score }
 * @param {Object} params.qualityGateDiagnostics - From sourceImageQualityGate
 * @param {number|null} params.storyMatchScore   - 0-10 or null
 * @param {boolean} params.duplicateSlotDetected - From slotAuditIssues
 * @param {Array}  params.imageBuffers           - Current image pool
 * @param {Object} params.slotAssignment         - { heroIndex, circleIndex, photoOrder }
 * @param {Object} params.identity               - Story identity
 * @param {string} params.chosenTemplate         - Template ID used
 * @param {number} params.score                  - AI Judge score (0-10)
 * @param {string|null} params.dominantElement   - From story match validator
 * @param {boolean} params.needManualReview      - Pre-existing manual review flag
 * @returns {Object} - { passed, status, blockers, summary }
 */
export function evaluateFinalSaveGate({
  finalSlotAudit = { passed: true, issues: [], fixes: [] },
  compositionQA = { passed: true, issues: [], score: 10 },
  qualityGateDiagnostics = null,
  storyMatchScore = null,
  duplicateSlotDetected = false,
  imageBuffers = [],
  slotAssignment = {},
  identity = {},
  chosenTemplate = '',
  score = 7,
  dominantElement = null,
  needManualReview = false,
}) {
  const blockers = [];
  const warnings = [];
  const storyType = identity?.storyType || 'default';
  const policy = getPolicyForStoryType(storyType);

  console.log(`[FinalSaveGate] ★ Evaluating save gate: storyType="${storyType}", template="${chosenTemplate}", score=${score}`);

  // ═══════════════════════════════════════════════
  // Blocker 1: finalSlotAudit.passed = false
  // ═══════════════════════════════════════════════
  if (!finalSlotAudit.passed) {
    const unfixedIssues = (finalSlotAudit.issues || []).length - (finalSlotAudit.fixes || []).length;
    if (unfixedIssues > 0) {
      blockers.push({
        id: BLOCKER_IDS.SLOT_AUDIT_FAILED,
        reason: `Slot audit has ${unfixedIssues} unfixed issues: ${(finalSlotAudit.issues || []).map(i => i.type).join(', ')}`,
        severity: 'HIGH',
      });
    }
  }

  // ═══════════════════════════════════════════════
  // Blocker 2: compositionQA.passed = false (Phase 4.1 — policy-aware)
  //
  // Blocking rules:
  //   a) score <= 4 → always block
  //   b) CIRCLE_NO_FACE only → WARNING for soft-circle types if score >= 7
  //   c) CIRCLE_NO_FACE only → HIGH for face-required types
  //   d) Other critical issues (SUPPORT_OVERPOWERS_MAIN, FACE_IN_FADE_REGION) → HIGH
  //   e) CIRCLE_NO_FACE combined with other blockers → re-evaluated in final verdict
  // ═══════════════════════════════════════════════
  if (!compositionQA.passed) {
    const qaScore = compositionQA.score ?? 10;
    const qaIssueTypes = (compositionQA.issues || []).map(i => i.type);
    const hasCircleNoFace = qaIssueTypes.includes('CIRCLE_NO_FACE');
    const hasOtherCritical = qaIssueTypes.some(t =>
      ['SUPPORT_OVERPOWERS_MAIN', 'FACE_IN_FADE_REGION'].includes(t)
    );
    const onlyCircleNoFace = hasCircleNoFace && !hasOtherCritical &&
      qaIssueTypes.filter(t => t !== 'CIRCLE_NO_FACE').length === 0;
    const isSoftCircleType = SOFT_CIRCLE_STORY_TYPES.has(storyType) ||
      SOFT_CIRCLE_STORY_TYPES.has(policy._policyKey);
    const isFaceRequired = FACE_REQUIRED_STORY_TYPES.has(storyType) ||
      FACE_REQUIRED_STORY_TYPES.has(policy._policyKey);

    if (qaScore <= 4) {
      // (a) Score critically low — always block
      blockers.push({
        id: BLOCKER_IDS.COMPOSITION_QA_FAILED,
        reason: `Composition QA score critically low: ${qaScore}/10`,
        severity: 'HIGH',
      });
    } else if (onlyCircleNoFace && isSoftCircleType && qaScore >= 7) {
      // (b) CIRCLE_NO_FACE alone on family/nature/donation with good score → WARNING only
      warnings.push(`CIRCLE_NO_FACE on ${storyType} (soft-circle type, score ${qaScore}/10) — downgraded to WARNING`);
      console.log(`[FinalSaveGate] ↓ CIRCLE_NO_FACE downgraded to WARNING for soft-circle type "${storyType}" (score ${qaScore}/10)`);
    } else if (onlyCircleNoFace && isFaceRequired) {
      // (c) CIRCLE_NO_FACE on celebrity/drama/funeral → keep HIGH
      blockers.push({
        id: BLOCKER_IDS.COMPOSITION_QA_FAILED,
        reason: `Composition QA: CIRCLE_NO_FACE on face-required type "${storyType}" (score ${qaScore}/10)`,
        severity: 'HIGH',
      });
    } else if (hasOtherCritical) {
      // (d) Non-circle critical issues → always block
      blockers.push({
        id: BLOCKER_IDS.COMPOSITION_QA_FAILED,
        reason: `Composition QA failed (score ${qaScore}/10): ${qaIssueTypes.join(', ')}`,
        severity: 'HIGH',
      });
    } else if (onlyCircleNoFace) {
      // (e) CIRCLE_NO_FACE on other types with score >= 5 → MEDIUM warning, not hard block
      warnings.push(`CIRCLE_NO_FACE on "${storyType}" (score ${qaScore}/10) — treated as WARNING`);
      console.log(`[FinalSaveGate] ↓ CIRCLE_NO_FACE treated as WARNING for "${storyType}" (score ${qaScore}/10)`);
    } else {
      // Fallback: unknown QA issues with moderate score → WARNING
      warnings.push(`Composition QA issues (score ${qaScore}/10): ${qaIssueTypes.join(', ')}`);
    }
  }

  // ═══════════════════════════════════════════════
  // Blocker 3: qualityGatePassed = false
  // ═══════════════════════════════════════════════
  const qualityGatePassed = qualityGateDiagnostics?.qualityGatePassed ?? true;
  if (!qualityGatePassed) {
    const failReasons = qualityGateDiagnostics?.qualityGateSummary?.qualityGateFailReasons || [];
    blockers.push({
      id: BLOCKER_IDS.QUALITY_GATE_FAILED,
      reason: `Source quality gate failed: ${failReasons.join(', ') || 'insufficient clean images'}`,
      severity: 'HIGH',
    });
  }

  // ═══════════════════════════════════════════════
  // Blocker 4: storyMatch low (Phase 4.1 — policy-aware thresholds)
  //
  // Rules:
  //   - storyMatch < 5 → always block (CRITICAL if < 3, HIGH otherwise)
  //   - storyMatch 5-6 + main slot NOT in mainSlotPriority → block
  //   - storyMatch 5-6 + other serious blockers exist → block
  //   - storyMatch 5-6 on soft types + qualityGatePassed + has context images → WARNING
  //   - storyMatch >= 7 → never block
  // ═══════════════════════════════════════════════
  if (storyMatchScore !== null && storyMatchScore < 7) {
    const isSoftMatchType = SOFT_STORY_MATCH_TYPES.has(storyType) ||
      SOFT_STORY_MATCH_TYPES.has(policy._policyKey);

    // Check if main slot matches policy priority
    const heroIdx = slotAssignment.heroIndex ?? slotAssignment.photoOrder?.[0];
    const heroImg = heroIdx != null ? imageBuffers[heroIdx] : null;
    const heroRole = heroImg?.role || '';
    const mainPriority = policy.mainSlotPriority || [];
    const mainMatchesPriority = mainPriority.includes(heroRole);

    if (storyMatchScore < 5) {
      // Always block if very low
      if (isSoftMatchType && qualityGatePassed && storyMatchScore >= 3) {
        // Soft types with okay quality: still block but mark as potentially inconsistent
        blockers.push({
          id: BLOCKER_IDS.STORY_MATCH_LOW,
          reason: `Story match score low: ${storyMatchScore}/10 (may be inconsistent for ${storyType})`,
          severity: 'HIGH',
          _possiblyInconsistent: isSoftMatchType,
        });
      } else {
        blockers.push({
          id: BLOCKER_IDS.STORY_MATCH_LOW,
          reason: `Story match score too low: ${storyMatchScore}/10 (threshold: 5)`,
          severity: storyMatchScore < 3 ? 'CRITICAL' : 'HIGH',
        });
      }
    } else {
      // storyMatch 5-6: conditional blocking
      const hasOtherSeriousBlockers = blockers.some(b =>
        b.severity === 'CRITICAL' || b.severity === 'HIGH'
      );

      if (!mainMatchesPriority) {
        // Main slot doesn't match policy priority → block
        blockers.push({
          id: BLOCKER_IDS.STORY_MATCH_LOW,
          reason: `Story match ${storyMatchScore}/10 + main slot role "${heroRole}" not in policy priority`,
          severity: 'HIGH',
        });
      } else if (hasOtherSeriousBlockers) {
        // Combined with other serious blockers → block
        blockers.push({
          id: BLOCKER_IDS.STORY_MATCH_LOW,
          reason: `Story match ${storyMatchScore}/10 combined with other blockers`,
          severity: 'MEDIUM',
        });
      } else if (isSoftMatchType && qualityGatePassed) {
        // Soft type, quality passed, no other serious issues → WARNING only
        warnings.push(`Story match ${storyMatchScore}/10 on ${storyType} (soft type, qualityGate passed) — WARNING only`);
        console.log(`[FinalSaveGate] ↓ STORY_MATCH_LOW downgraded to WARNING for soft type "${storyType}" (score ${storyMatchScore}/10, qualityGate passed)`);
      } else {
        // Default: block
        blockers.push({
          id: BLOCKER_IDS.STORY_MATCH_LOW,
          reason: `Story match score low: ${storyMatchScore}/10 (threshold: 7)`,
          severity: 'HIGH',
        });
      }
    }
  }

  // ═══════════════════════════════════════════════
  // Blocker 5: duplicateSlotDetected = true
  // ═══════════════════════════════════════════════
  if (duplicateSlotDetected) {
    blockers.push({
      id: BLOCKER_IDS.DUPLICATE_SLOT_DETECTED,
      reason: 'Duplicate image used in multiple slots',
      severity: 'MEDIUM',
    });
  }

  // ═══════════════════════════════════════════════
  // Blocker 6: Source image type violation in final used images
  // ═══════════════════════════════════════════════
  {
    const usedIndices = [
      ...(slotAssignment.photoOrder || []),
      slotAssignment.circleIndex,
    ].filter(i => i != null && i >= 0);

    const forbiddenSourceTypes = policy.forbiddenSourceTypes || [];
    const violations = [];

    for (const idx of usedIndices) {
      const img = imageBuffers[idx];
      if (!img) continue;
      const srcType = img._sourceType || 'CLEAN_PHOTO';
      if (srcType !== 'CLEAN_PHOTO' && forbiddenSourceTypes.includes(srcType)) {
        violations.push({ index: idx, sourceType: srcType, role: img.role });
      }
    }

    if (violations.length > 0) {
      blockers.push({
        id: BLOCKER_IDS.SOURCE_TYPE_VIOLATION,
        reason: `${violations.length} final image(s) use forbidden source types: ${violations.map(v => `#${v.index} ${v.sourceType}`).join(', ')}`,
        severity: 'HIGH',
        details: violations,
      });
    }
  }

  // ═══════════════════════════════════════════════
  // Blocker 7: Main slot violates selected policy
  // ═══════════════════════════════════════════════
  {
    const heroIdx = slotAssignment.heroIndex ?? slotAssignment.photoOrder?.[0];
    const heroImg = heroIdx != null ? imageBuffers[heroIdx] : null;

    if (heroImg) {
      const heroSourceType = heroImg._sourceType || 'CLEAN_PHOTO';
      const forbiddenForMain = policy.forbiddenSlotTypes?.main || [
        'NEWS_THUMBNAIL', 'YOUTUBE_THUMBNAIL', 'TEXT_OVERLAY', 'SOCIAL_POST',
        'SCREENSHOT', 'COLLAGE', 'SPLIT_SCREEN', 'PREVIOUS_COVER', 'INTERVIEW_FRAME',
      ];

      if (forbiddenForMain.includes(heroSourceType)) {
        blockers.push({
          id: BLOCKER_IDS.MAIN_SLOT_POLICY_VIOLATION,
          reason: `Main slot uses ${heroSourceType} image (forbidden for main by ${policy._policyKey || storyType} policy)`,
          severity: 'CRITICAL',
          details: { heroIndex: heroIdx, sourceType: heroSourceType, url: (heroImg.url || '').substring(0, 80) },
        });
      }
    }
  }

  // ═══════════════════════════════════════════════
  // Blocker 8: Text overlay / news thumbnail / previous cover dominates final visual
  // ═══════════════════════════════════════════════
  {
    const usedIndices = [
      ...(slotAssignment.photoOrder || []),
      slotAssignment.circleIndex,
    ].filter(i => i != null && i >= 0);

    const badTypes = ['TEXT_OVERLAY', 'NEWS_THUMBNAIL', 'PREVIOUS_COVER', 'YOUTUBE_THUMBNAIL'];
    let badCount = 0;
    let totalUsed = 0;

    for (const idx of usedIndices) {
      const img = imageBuffers[idx];
      if (!img) continue;
      totalUsed++;
      if (badTypes.includes(img._sourceType)) {
        badCount++;
      }
    }

    // If > 50% of final images are bad types → visual is dominated by bad sources
    if (totalUsed > 0 && (badCount / totalUsed) > 0.5) {
      blockers.push({
        id: BLOCKER_IDS.BAD_IMAGE_DOMINATES,
        reason: `Bad source images dominate final cover: ${badCount}/${totalUsed} slots use text overlay/news thumbnail/previous cover`,
        severity: 'HIGH',
        details: { badCount, totalUsed },
      });
    }
  }

  // ═══════════════════════════════════════════════
  // Blocker 9: Source image contains large embedded Thai headline text
  // (detected via _sourceType = TEXT_OVERLAY in hero/main slot)
  // ═══════════════════════════════════════════════
  {
    const heroIdx = slotAssignment.heroIndex ?? slotAssignment.photoOrder?.[0];
    const heroImg = heroIdx != null ? imageBuffers[heroIdx] : null;

    if (heroImg && heroImg._sourceType === 'TEXT_OVERLAY') {
      blockers.push({
        id: BLOCKER_IDS.EMBEDDED_HEADLINE_TEXT,
        reason: `Main image contains embedded Thai headline text (source type: TEXT_OVERLAY)`,
        severity: 'HIGH',
        details: { heroIndex: heroIdx, url: (heroImg.url || '').substring(0, 80) },
      });
    }
  }

  // ═══════════════════════════════════════════════
  // Blocker 10: Final cover uses another page's finished news thumbnail/cover as dominant image
  // ═══════════════════════════════════════════════
  {
    const heroIdx = slotAssignment.heroIndex ?? slotAssignment.photoOrder?.[0];
    const heroImg = heroIdx != null ? imageBuffers[heroIdx] : null;

    if (heroImg && (heroImg._sourceType === 'NEWS_THUMBNAIL' || heroImg._sourceType === 'PREVIOUS_COVER')) {
      blockers.push({
        id: BLOCKER_IDS.REUSED_NEWS_COVER,
        reason: `Main slot uses ${heroImg._sourceType} from another page as dominant image`,
        severity: 'CRITICAL',
        details: { heroIndex: heroIdx, sourceType: heroImg._sourceType, url: (heroImg.url || '').substring(0, 80) },
      });
    }
  }

  // ═══════════════════════════════════════════════
  // Blocker 11: No required mainSlotPriority image survived
  // ═══════════════════════════════════════════════
  {
    const mainSlotPriority = policy.mainSlotPriority || ['HERO_FACE', 'CONTEXT_SCENE', 'KEY_ACTIVITY', 'STORY_ANCHOR'];
    const heroIdx = slotAssignment.heroIndex ?? slotAssignment.photoOrder?.[0];
    const heroImg = heroIdx != null ? imageBuffers[heroIdx] : null;

    if (heroImg) {
      const heroRole = heroImg.role || '';
      const isPriorityRole = mainSlotPriority.includes(heroRole);
      const isClean = heroImg._sourceType === 'CLEAN_PHOTO' || !heroImg._sourceType;

      if (!isPriorityRole && !isClean) {
        // Main slot has neither a priority role nor a clean photo
        blockers.push({
          id: BLOCKER_IDS.NO_MAIN_PRIORITY_IMAGE,
          reason: `Main slot image (role: ${heroRole}) is not in mainSlotPriority (${mainSlotPriority.join(', ')}) and is not a clean photo`,
          severity: 'MEDIUM',
          details: { heroIndex: heroIdx, role: heroRole, sourceType: heroImg._sourceType },
        });
      }
    }
  }

  // ═══════════════════════════════════════════════
  // Blocker 12: visualWeight violates policy
  // Check if the main slot image is visually weak (low score + non-priority role)
  // ═══════════════════════════════════════════════
  {
    const heroIdx = slotAssignment.heroIndex ?? slotAssignment.photoOrder?.[0];
    const heroImg = heroIdx != null ? imageBuffers[heroIdx] : null;

    if (heroImg) {
      const heroScore = heroImg.curatorScore || heroImg.score || 0;
      const heroRole = heroImg.role || 'SUPPORT';
      const mainPriority = policy.mainSlotPriority || [];

      // Visual weight too low: score < 5 AND not a priority role
      if (heroScore < 5 && !mainPriority.includes(heroRole)) {
        blockers.push({
          id: BLOCKER_IDS.VISUAL_WEIGHT_VIOLATION,
          reason: `Main slot image has low visual weight: score=${heroScore}/10, role=${heroRole} (not in priority list)`,
          severity: 'MEDIUM',
          details: { heroIndex: heroIdx, score: heroScore, role: heroRole },
        });
      }
    }
  }

  // ═══════════════════════════════════════════════
  // Inherit pre-existing manual review flag
  // ═══════════════════════════════════════════════
  if (needManualReview && blockers.length === 0) {
    // There was a pre-existing reason (e.g., no story anchor)
    warnings.push('Pre-existing needManualReview flag was set (story anchor or other pipeline check)');
  }

  // ═══════════════════════════════════════════════
  // Final verdict (Phase 4.1 — 3-tier: SUCCESS / PARTIAL_PASS / NEED_MANUAL_REVIEW)
  //
  // PARTIAL_PASS: warnings exist but no hard blockers → save to gallery
  //   with a warning flag. Still considered "passed" for gallery save.
  // ═══════════════════════════════════════════════
  const hasBlockers = blockers.length > 0;
  const hasWarnings = warnings.length > 0;
  const passed = !hasBlockers && !needManualReview;
  const partialPass = !hasBlockers && hasWarnings && !needManualReview;

  let status;
  if (passed && !hasWarnings) {
    status = 'SUCCESS';
  } else if (passed && hasWarnings) {
    status = 'PARTIAL_PASS';  // warnings only, no blockers → still save
  } else {
    status = 'NEED_MANUAL_REVIEW';
  }

  // Build human-readable reasons
  const manualReviewReasons = blockers.map(b => `[${b.severity}] ${b.reason}`);
  if (needManualReview && blockers.length === 0) {
    manualReviewReasons.push('[INHERITED] Pre-existing manual review flag from pipeline');
  }
  // Append warnings to reason string for visibility
  const warningReasons = warnings.map(w => `[WARNING] ${w}`);

  const result = {
    saveGatePassed: passed || partialPass,  // PARTIAL_PASS still saves to gallery
    saveGateStatus: status,
    saveGateBlockers: blockers,
    saveGateWarnings: warnings,
    manualReviewReason: [...manualReviewReasons, ...warningReasons].join(' | ') || null,
    summary: {
      totalBlockers: blockers.length,
      totalWarnings: warnings.length,
      criticalBlockers: blockers.filter(b => b.severity === 'CRITICAL').length,
      highBlockers: blockers.filter(b => b.severity === 'HIGH').length,
      mediumBlockers: blockers.filter(b => b.severity === 'MEDIUM').length,
      inheritedReview: needManualReview && blockers.length === 0,
      partialPass,
    },
  };

  // Log results
  if (status === 'SUCCESS') {
    console.log(`[FinalSaveGate] ✅ PASSED — cover will be saved as SUCCESS`);
  } else if (status === 'PARTIAL_PASS') {
    console.log(`[FinalSaveGate] ⚠️ PARTIAL_PASS — ${warnings.length} warning(s), no blockers → saving to gallery`);
    for (const w of warnings) {
      console.log(`[FinalSaveGate]   [WARNING] ${w}`);
    }
  } else {
    console.log(`[FinalSaveGate] ⛔ NEED_MANUAL_REVIEW — ${blockers.length} blocker(s):`);
    for (const b of blockers) {
      console.log(`[FinalSaveGate]   [${b.severity}] ${b.id}: ${b.reason}`);
    }
    if (warnings.length > 0) {
      console.log(`[FinalSaveGate]   + ${warnings.length} warning(s)`);
    }
    if (needManualReview && blockers.length === 0) {
      console.log(`[FinalSaveGate]   [INHERITED] Pre-existing manual review flag`);
    }
  }

  return result;
}
