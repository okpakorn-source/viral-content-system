/**
 * Phase 5: Regression Matrix Test
 * ────────────────────────────────────────────────────
 * Tests 10+ story types through the full Auto Cover pipeline.
 * Captures all save gate metrics + visual failure diagnostics.
 *
 * Visual Failure Tags:
 *   1. REUSED_SAME_IMAGE_SET
 *   2. WRONG_STORY_VISUAL
 *   3. SOCIAL_SCREENSHOT_USED
 *   4. TEXT_OVERLAY_VISIBLE
 *   5. GENERIC_CONTEXT_IMAGE
 *   6. DUPLICATE_OR_NEAR_DUPLICATE_SLOT
 *   7. LOW_VISUAL_COHERENCE
 *   8. CACHE_CONTAMINATION_SUSPECTED
 *   9. SOURCE_POOL_NOT_STORY_SPECIFIC
 *  10. COMPOSITION_POLISH_NEEDED
 */

import fs from 'fs';
import path from 'path';

const API = 'http://localhost:3000/api/auto-cover';
const TIMEOUT = 360_000; // 6 min per case
const OUT_DIR = path.resolve('ai-review');

// ─── Test Cases ───────────────────────────────────────────────────────────────

const CASES = [
  {
    id: 'REG-001',
    expectedType: 'family_nature_learning',
    title: 'ชมพู่ อารยา พาลูกๆ เรียนรู้ธรรมชาติกับยายหนิง ปลูกผักสวนครัว เลี้ยงไก่ สัมผัสชีวิตชนบท',
    keywords: ['ชมพู่', 'อารยา', 'ยายหนิง', 'ธรรมชาติ', 'ปลูกผัก'],
  },
  {
    id: 'REG-002',
    expectedType: 'family_warm',
    title: 'หนุ่มหอบลูกน้อยวัย 2 ขวบ วิ่งฝ่าสายฝนไปหาหมอ ชาวเน็ตสุดซึ้งน้ำตาไหล ความรักของพ่อ',
    keywords: ['พ่อ', 'ลูก', 'ฝนตก', 'หมอ', 'ความรัก'],
  },
  {
    id: 'REG-003',
    expectedType: 'family_care',
    title: 'ลูกสาวกตัญญู ลาออกจากงานดูแลแม่ป่วยอัลไซเมอร์ เผยภาพสุดซึ้ง แม่จำลูกไม่ได้แต่ยังยิ้มให้',
    keywords: ['ลูกสาว', 'แม่', 'อัลไซเมอร์', 'กตัญญู'],
  },
  {
    id: 'REG-004',
    expectedType: 'charity_donation',
    title: 'มูลนิธิปอเต็กตึ๊ง มอบถุงยังชีพ 5,000 ชุด ช่วยผู้ประสบอุทกภัยภาคใต้ ส่งตรงถึงมือชาวบ้าน',
    keywords: ['มูลนิธิ', 'ปอเต็กตึ๊ง', 'ถุงยังชีพ', 'น้ำท่วม'],
  },
  {
    id: 'REG-005',
    expectedType: 'donation',
    title: "ชื่นชม'เจ๊แห้ง'แม่ค้าหัวใจทองคำ น้ำใจงามลุกขึ้นสู้ เพื่อความอยู่รอดของชาวบ้าน",
    keywords: ['เจ๊แห้ง', 'แม่ค้า', 'น้ำใจ', 'ชาวบ้าน'],
  },
  {
    id: 'REG-006',
    expectedType: 'community_help',
    title: 'ชาวบ้านรวมพลัง สร้างสะพานไม้ข้ามลำห้วย หลังรอ อบต. นาน 5 ปี ไม่มีวี่แวว',
    keywords: ['ชาวบ้าน', 'สะพาน', 'รวมพลัง', 'อบต'],
  },
  {
    id: 'REG-007',
    expectedType: 'celebrity_interview',
    title: '"ใหม่ ดาวิกา" เปิดใจครั้งแรก หลังข่าวลือเลิกกับ "ซอนเย" เผยความจริงทั้งหมด',
    keywords: ['ใหม่', 'ดาวิกา', 'ซอนเย', 'เปิดใจ'],
  },
  {
    id: 'REG-008',
    expectedType: 'relationship_drama',
    title: '"เบียร์" ยอมรับตรง ๆ ว่า สิ่งที่ทำให้เขารู้สึกดีกับ "โอ๋ ภัคจีรา" คือ....',
    keywords: ['เบียร์', 'โอ๋', 'ภัคจีรา', 'ความสัมพันธ์'],
  },
  {
    id: 'REG-009',
    expectedType: 'accident_rescue',
    title: 'รถทัวร์พลิกคว่ำ จ.นครราชสีมา ผู้โดยสาร 40 คนติดภายใน กู้ภัยเร่งช่วยเหลือ ยอดเจ็บ 15 ราย',
    keywords: ['รถทัวร์', 'พลิกคว่ำ', 'กู้ภัย', 'โคราช'],
  },
  {
    id: 'REG-010',
    expectedType: 'crime_incident',
    title: 'ตำรวจรวบแก๊งคอลเซ็นเตอร์ หลอกเหยื่อกว่า 200 ราย เสียหายรวมกว่า 50 ล้าน พบเบื้องหลังเป็นเครือข่ายข้ามชาติ',
    keywords: ['คอลเซ็นเตอร์', 'ตำรวจ', 'หลอกลวง', 'แก๊ง'],
  },
  {
    id: 'REG-011',
    expectedType: 'education_support',
    title: 'ครูอาสาเดินเท้า 10 กม.ทุกวัน สอนเด็กบนดอยไม่มีไฟฟ้า ชาวเน็ตประทับใจ รวมเงินบริจาคแล้วกว่าแสน',
    keywords: ['ครูอาสา', 'เด็กบนดอย', 'บริจาค', 'การศึกษา'],
  },
  {
    id: 'REG-012',
    expectedType: 'illness_care',
    title: 'สุดเศร้า หนุ่มวัย 25 ป่วยมะเร็งระยะสุดท้าย แม่เฝ้าไข้ไม่ห่าง ขอให้ลูกสู้ต่อไป',
    keywords: ['มะเร็ง', 'แม่', 'ป่วย', 'เฝ้าไข้'],
  },
];

// ─── Visual Failure Detection ─────────────────────────────────────────────────

/** Known Chompoo/YaiNing image URL patterns */
const CHOMPOO_PATTERNS = [
  'chompoo', 'araya', 'ชมพู่', 'อารยา', 'yai-ning', 'ยายหนิง',
  'farm', 'garden', 'planting', 'chicken', 'rural',
];

function detectVisualFailures(caseResult, allResults) {
  const tags = [];
  const d = caseResult._raw;
  if (!d) return tags;

  const gallery = d.gallery || [];
  const allCandidates = d.aiReview?.allCandidates || [];
  const storyType = d.identity?.storyType || d.normalizedStoryType || 'unknown';
  const blockers = d.saveGateBlockers || [];
  const warnings = d.saveGateWarnings || [];

  // 1. REUSED_SAME_IMAGE_SET — compare URLs with other cases
  const myUrls = new Set(gallery.map(g => g.url).filter(Boolean));
  for (const other of allResults) {
    if (other.id === caseResult.id || !other._raw) continue;
    const otherUrls = new Set((other._raw.gallery || []).map(g => g.url).filter(Boolean));
    let overlap = 0;
    for (const url of myUrls) {
      if (otherUrls.has(url)) overlap++;
    }
    if (myUrls.size > 0 && overlap >= 2) {
      tags.push({
        tag: 'REUSED_SAME_IMAGE_SET',
        detail: `${overlap} shared images with ${other.id} (${other.expectedType})`,
        severity: overlap >= 3 ? 'HIGH' : 'MEDIUM',
      });
    }
  }

  // 2. WRONG_STORY_VISUAL — Chompoo/nature images in non-nature cases
  if (!['family_nature_learning', 'family_warm', 'nature_learning'].includes(storyType)) {
    const chompooLeaks = allCandidates.filter(c => {
      const t = (c.title || '').toLowerCase();
      const u = (c.url || '').toLowerCase();
      return CHOMPOO_PATTERNS.some(p => t.includes(p) || u.includes(p));
    });
    if (chompooLeaks.length > 0) {
      tags.push({
        tag: 'WRONG_STORY_VISUAL',
        detail: `${chompooLeaks.length} Chompoo/nature images in "${storyType}" case`,
        severity: 'HIGH',
      });
    }
  }

  // 3. SOCIAL_SCREENSHOT_USED — check _sourceType or role patterns
  const socialCandidates = allCandidates.filter(c =>
    c.techBad === 'SOCIAL_POST' || c.techBad === 'SCREENSHOT' ||
    (c.title || '').match(/screenshot|สกรีนช็อต|capture/i)
  );
  if (socialCandidates.length > 0) {
    tags.push({
      tag: 'SOCIAL_SCREENSHOT_USED',
      detail: `${socialCandidates.length} social/screenshot candidates in pool`,
      severity: socialCandidates.some(c => c.role !== 'REJECT') ? 'HIGH' : 'LOW',
    });
  }

  // 4. TEXT_OVERLAY_VISIBLE — check for text overlay in used images
  const textOverlayCandidates = allCandidates.filter(c =>
    c.techBad === 'TEXT_OVERLAY' || c.techBad === 'NEWS_THUMBNAIL' ||
    c.techBad === 'PREVIOUS_COVER'
  );
  if (textOverlayCandidates.length > 0) {
    const inUse = textOverlayCandidates.filter(c => c.role !== 'REJECT' && c.score >= 4);
    tags.push({
      tag: 'TEXT_OVERLAY_VISIBLE',
      detail: `${textOverlayCandidates.length} text overlay/thumbnail candidates (${inUse.length} in use)`,
      severity: inUse.length > 0 ? 'HIGH' : 'LOW',
    });
  }

  // 5. GENERIC_CONTEXT_IMAGE — many SUPPORT/CONTEXT_SCENE images with low relevance
  const genericImages = allCandidates.filter(c =>
    ['SUPPORT', 'CONTEXT_SCENE'].includes(c.role) && (c.score || 0) <= 5
  );
  if (genericImages.length >= 3) {
    tags.push({
      tag: 'GENERIC_CONTEXT_IMAGE',
      detail: `${genericImages.length} generic/low-score context images in pool`,
      severity: 'MEDIUM',
    });
  }

  // 6. DUPLICATE_OR_NEAR_DUPLICATE_SLOT — from save gate
  if (blockers.some(b => b.id === 'DUPLICATE_SLOT_DETECTED') ||
      d.aiReview?.duplicateSlotDetected) {
    tags.push({
      tag: 'DUPLICATE_OR_NEAR_DUPLICATE_SLOT',
      detail: 'Duplicate image used in multiple composition slots',
      severity: 'HIGH',
    });
  }

  // 7. LOW_VISUAL_COHERENCE — low score + composition issues
  const score = d.score || 0;
  const compositionIssues = d.aiReview?.finalSlotAudit?.issues || [];
  if (score <= 5 || compositionIssues.length >= 2) {
    tags.push({
      tag: 'LOW_VISUAL_COHERENCE',
      detail: `Score ${score}/10, ${compositionIssues.length} slot audit issue(s)`,
      severity: score <= 4 ? 'HIGH' : 'MEDIUM',
    });
  }

  // 8. CACHE_CONTAMINATION_SUSPECTED — images from completely different story context
  // Heuristic: if story-specific keywords don't appear in any candidate title
  const keywords = caseResult.keywords || [];
  if (keywords.length > 0 && allCandidates.length > 0) {
    const titlePool = allCandidates.map(c => (c.title || '').toLowerCase()).join(' ');
    const matchedKw = keywords.filter(kw => titlePool.includes(kw.toLowerCase()));
    if (matchedKw.length === 0) {
      tags.push({
        tag: 'CACHE_CONTAMINATION_SUSPECTED',
        detail: `No story keywords (${keywords.slice(0, 3).join(',')}) found in any candidate title`,
        severity: 'HIGH',
      });
    } else if (matchedKw.length <= 1 && keywords.length >= 3) {
      tags.push({
        tag: 'CACHE_CONTAMINATION_SUSPECTED',
        detail: `Only ${matchedKw.length}/${keywords.length} keywords matched in candidate titles`,
        severity: 'MEDIUM',
      });
    }
  }

  // 9. SOURCE_POOL_NOT_STORY_SPECIFIC — check if story anchor exists
  const storyAnchors = d.aiReview?.storyAnchorCandidates || [];
  const noStoryAnchor = d.noStoryAnchorFallbackReason;
  if (storyAnchors.length === 0 || noStoryAnchor) {
    tags.push({
      tag: 'SOURCE_POOL_NOT_STORY_SPECIFIC',
      detail: noStoryAnchor || 'No story anchor candidates found',
      severity: 'HIGH',
    });
  }

  // 10. COMPOSITION_POLISH_NEEDED — score < 7 or has warnings
  if (score < 7 || warnings.length > 0) {
    tags.push({
      tag: 'COMPOSITION_POLISH_NEEDED',
      detail: `Score ${score}/10, ${warnings.length} warning(s)`,
      severity: score <= 5 ? 'HIGH' : 'MEDIUM',
    });
  }

  return tags;
}

// ─── Run Single Case ──────────────────────────────────────────────────────────

async function runCase(c) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`▶ ${c.id} [expected: ${c.expectedType}]`);
  console.log(`  ${c.title.slice(0, 70)}...`);
  console.log(`${'═'.repeat(60)}`);

  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newsTitle: c.title, content: c.title, mode: 'auto' }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const d = await res.json();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    const slotAudit = d.aiReview?.finalSlotAudit || { passed: true, issues: [], fixes: [] };
    const qualityGate = d.aiReview?.qualityGate || d.qualityGate || null;
    const qgPassed = qualityGate?.qualityGatePassed ?? true;
    const qgBlocked = qualityGate?.qualityGateSummary?.blocked || 0;
    const sourceTypes = qualityGate?.qualityGateSummary?.sourceTypeCounts || {};

    // Composition QA: derive from finalSaveGate
    const saveGateResult = d.finalSaveGate || {};
    const compositionBlocker = (d.saveGateBlockers || []).find(b => b.id === 'COMPOSITION_QA_FAILED');

    const result = {
      id: c.id,
      expectedType: c.expectedType,
      keywords: c.keywords,
      title: c.title,
      httpStatus: res.status,
      // Core fields
      storyType: d.identity?.storyType || d.normalizedStoryType || '?',
      selectedPolicy: d.aiReview?.normalizedStoryType || d.normalizedStoryType || '?',
      qualityGatePassed: qgPassed,
      sourceImageTypesSummary: sourceTypes,
      blockedSourceImages: qgBlocked,
      finalSlotAuditPassed: slotAudit.passed,
      finalSlotAuditIssues: slotAudit.issues?.length || 0,
      compositionQAPassed: !compositionBlocker,
      compositionQADetail: compositionBlocker?.reason || null,
      storyMatchScore: d.storyMatchScore ?? null,
      saveGateStatus: d.saveGateStatus || '?',
      saveGatePassed: d.saveGatePassed ?? null,
      saveGateBlockers: d.saveGateBlockers || [],
      saveGateWarnings: d.saveGateWarnings || [],
      savedToGallery: d.savedToGallery,
      galleryStatus: d.galleryStatus,
      score: d.score,
      templateUsed: d.templateUsed,
      caseIdSaved: d.caseId || null,
      savedToCoverExamples: d.savedToGallery === true, // cover_examples only saved when gallery saved
      saveToGalleryRan: d.savedToGallery !== undefined ? (d.galleryStatus === 'SAVED' || d.galleryStatus === 'SAVE_FAILED') : null,
      manualReviewReason: d.manualReviewReason || null,
      verdict: d.status || d.saveGateStatus || '?',
      mainFailureReason: d.manualReviewReason ? d.manualReviewReason.split(' | ')[0] : null,
      elapsed,
      // For visual failure detection
      _raw: d,
      // Visual failures: populated after all cases run
      visualFailures: [],
    };

    // Console log
    const icon = result.verdict === 'SUCCESS' || result.verdict === 'PARTIAL_PASS' ? '✅' : '⛔';
    console.log(`  ${icon} verdict=${result.verdict} | score=${result.score} | storyType=${result.storyType}`);
    console.log(`  💾 savedToGallery=${result.savedToGallery} | galleryStatus=${result.galleryStatus}`);
    if (result.saveGateBlockers.length > 0) {
      console.log(`  ⛔ ${result.saveGateBlockers.length} blocker(s): ${result.saveGateBlockers.map(b => b.id).join(', ')}`);
    }
    if (result.saveGateWarnings.length > 0) {
      console.log(`  ⚠️ ${result.saveGateWarnings.length} warning(s)`);
    }
    console.log(`  ⏱ ${elapsed}s`);

    return result;
  } catch (err) {
    clearTimeout(timer);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`  ❌ ERROR: ${err.message} (${elapsed}s)`);
    return {
      id: c.id, expectedType: c.expectedType, keywords: c.keywords, title: c.title,
      error: err.message, elapsed, verdict: 'ERROR',
      visualFailures: [],
    };
  }
}

// ─── Generate Markdown Report ─────────────────────────────────────────────────

function generateMarkdownReport(results, failureSummary) {
  const lines = [];
  lines.push('# Phase 5: Regression Matrix Report');
  lines.push('');
  lines.push(`**Generated**: ${new Date().toISOString()}`);
  lines.push(`**Cases**: ${results.length}`);
  lines.push(`**Branch**: ai/post-selection-quality`);
  lines.push('');

  // Summary table
  const passed = results.filter(r => r.verdict === 'SUCCESS' || r.verdict === 'PARTIAL_PASS');
  const blocked = results.filter(r => r.verdict === 'NEED_MANUAL_REVIEW');
  const errored = results.filter(r => r.verdict === 'ERROR');

  lines.push('## Summary');
  lines.push('');
  lines.push(`| Status | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| ✅ SUCCESS / PARTIAL_PASS | ${passed.length} |`);
  lines.push(`| ⛔ NEED_MANUAL_REVIEW | ${blocked.length} |`);
  lines.push(`| ❌ ERROR | ${errored.length} |`);
  lines.push(`| **Total** | **${results.length}** |`);
  lines.push('');

  // Main matrix table
  lines.push('## Regression Matrix');
  lines.push('');
  lines.push('| Case | Story Type | Score | Verdict | SaveGate | Gallery | Blockers | Warnings | StoryMatch | Template |');
  lines.push('|------|-----------|-------|---------|----------|---------|----------|----------|------------|----------|');
  for (const r of results) {
    if (r.error) {
      lines.push(`| ${r.id} | ${r.expectedType} | — | ❌ ERROR | — | — | — | — | — | — |`);
      continue;
    }
    const icon = (r.verdict === 'SUCCESS' || r.verdict === 'PARTIAL_PASS') ? '✅' : '⛔';
    lines.push(`| ${r.id} | ${r.storyType} | ${r.score}/10 | ${icon} ${r.verdict} | ${r.saveGateStatus} | ${r.galleryStatus} | ${r.saveGateBlockers.length} | ${r.saveGateWarnings.length} | ${r.storyMatchScore ?? '—'} | ${r.templateUsed || '—'} |`);
  }
  lines.push('');

  // Detailed per-case
  lines.push('## Detailed Results');
  lines.push('');
  for (const r of results) {
    lines.push(`### ${r.id}: ${r.expectedType}`);
    lines.push('');
    lines.push(`**Title**: ${r.title}`);
    lines.push('');
    if (r.error) {
      lines.push(`> [!CAUTION]`);
      lines.push(`> ERROR: ${r.error}`);
      lines.push('');
      continue;
    }
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| storyType | ${r.storyType} |`);
    lines.push(`| selectedPolicy | ${r.selectedPolicy} |`);
    lines.push(`| score | ${r.score}/10 |`);
    lines.push(`| verdict | ${r.verdict} |`);
    lines.push(`| saveGateStatus | ${r.saveGateStatus} |`);
    lines.push(`| saveGatePassed | ${r.saveGatePassed} |`);
    lines.push(`| savedToGallery | ${r.savedToGallery} |`);
    lines.push(`| galleryStatus | ${r.galleryStatus} |`);
    lines.push(`| savedToCoverExamples | ${r.savedToCoverExamples} |`);
    lines.push(`| saveToGalleryRan | ${r.saveToGalleryRan} |`);
    lines.push(`| caseId | ${r.caseIdSaved || 'null'} |`);
    lines.push(`| qualityGatePassed | ${r.qualityGatePassed} |`);
    lines.push(`| blockedSourceImages | ${r.blockedSourceImages} |`);
    lines.push(`| finalSlotAuditPassed | ${r.finalSlotAuditPassed} |`);
    lines.push(`| compositionQAPassed | ${r.compositionQAPassed} |`);
    lines.push(`| storyMatchScore | ${r.storyMatchScore ?? '—'} |`);
    lines.push(`| templateUsed | ${r.templateUsed || '—'} |`);
    lines.push(`| elapsed | ${r.elapsed}s |`);
    lines.push('');

    if (r.saveGateBlockers.length > 0) {
      lines.push('**Blockers:**');
      for (const b of r.saveGateBlockers) {
        lines.push(`- \`[${b.severity}]\` **${b.id}**: ${b.reason}`);
      }
      lines.push('');
    }
    if (r.saveGateWarnings.length > 0) {
      lines.push('**Warnings:**');
      for (const w of r.saveGateWarnings) {
        lines.push(`- ${w}`);
      }
      lines.push('');
    }
    if (r.manualReviewReason) {
      lines.push(`**Manual Review Reason**: ${r.manualReviewReason}`);
      lines.push('');
    }

    // Visual failures
    if (r.visualFailures.length > 0) {
      lines.push('**Visual Failure Tags:**');
      for (const vf of r.visualFailures) {
        const sev = vf.severity === 'HIGH' ? '🔴' : vf.severity === 'MEDIUM' ? '🟡' : '🟢';
        lines.push(`- ${sev} **${vf.tag}**: ${vf.detail}`);
      }
      lines.push('');
    } else {
      lines.push('**Visual Failure Tags:** None detected');
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  // Visual failure summary
  lines.push('## Visual Failure Summary');
  lines.push('');
  lines.push('| Tag | Count | HIGH | MEDIUM | LOW |');
  lines.push('|-----|-------|------|--------|-----|');
  for (const [tag, counts] of Object.entries(failureSummary.tagCounts).sort((a, b) => b[1].total - a[1].total)) {
    lines.push(`| ${tag} | ${counts.total} | ${counts.HIGH || 0} | ${counts.MEDIUM || 0} | ${counts.LOW || 0} |`);
  }
  lines.push('');

  // Top failure causes
  lines.push('## Top Recurring Failure Causes (Ranked)');
  lines.push('');
  for (let i = 0; i < failureSummary.rankedCauses.length; i++) {
    const cause = failureSummary.rankedCauses[i];
    lines.push(`${i + 1}. **${cause.tag}** — ${cause.count} case(s) — ${cause.description}`);
  }
  lines.push('');

  // Blocker summary
  lines.push('## Save Gate Blocker Frequency');
  lines.push('');
  const blockerFreq = {};
  for (const r of results) {
    for (const b of (r.saveGateBlockers || [])) {
      blockerFreq[b.id] = (blockerFreq[b.id] || 0) + 1;
    }
  }
  lines.push('| Blocker ID | Frequency |');
  lines.push('|-----------|-----------|');
  for (const [id, count] of Object.entries(blockerFreq).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${id} | ${count} |`);
  }
  lines.push('');

  // Cases needing composition polish
  lines.push('## Cases Needing Composition Polish');
  lines.push('');
  const polishNeeded = results.filter(r =>
    r.visualFailures?.some(vf => vf.tag === 'COMPOSITION_POLISH_NEEDED' || vf.tag === 'LOW_VISUAL_COHERENCE')
  );
  if (polishNeeded.length > 0) {
    for (const r of polishNeeded) {
      const tags = r.visualFailures.filter(vf =>
        vf.tag === 'COMPOSITION_POLISH_NEEDED' || vf.tag === 'LOW_VISUAL_COHERENCE'
      );
      lines.push(`- **${r.id}** (${r.storyType}, score ${r.score}/10): ${tags.map(t => t.detail).join('; ')}`);
    }
  } else {
    lines.push('None detected.');
  }
  lines.push('');

  // Recommended next phase
  lines.push('## Recommended Next Implementation Phase');
  lines.push('');
  if (failureSummary.rankedCauses.length > 0) {
    const top = failureSummary.rankedCauses[0];
    lines.push(`> [!IMPORTANT]`);
    lines.push(`> Top issue: **${top.tag}** (${top.count} cases). ${top.recommendation}`);
  }
  lines.push('');

  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Phase 5: Regression Matrix Test');
  console.log(`API: ${API}`);
  console.log(`Cases: ${CASES.length}`);
  console.log(`Output: ${OUT_DIR}\n`);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const results = [];
  for (const c of CASES) {
    const r = await runCase(c);
    results.push(r);
  }

  // ─── Cross-case visual failure detection ──────────────────────────────
  console.log('\n\n══════════════════════════════════════════════════════');
  console.log('Phase 5: Cross-Case Visual Failure Analysis');
  console.log('══════════════════════════════════════════════════════\n');

  for (const r of results) {
    if (r.error) continue;
    r.visualFailures = detectVisualFailures(r, results);
    if (r.visualFailures.length > 0) {
      console.log(`  ${r.id}: ${r.visualFailures.length} visual failure tag(s)`);
      for (const vf of r.visualFailures) {
        console.log(`    [${vf.severity}] ${vf.tag}: ${vf.detail}`);
      }
    } else {
      console.log(`  ${r.id}: ✅ No visual failures detected`);
    }
  }

  // ─── Failure summary ─────────────────────────────────────────────────
  const tagCounts = {};
  for (const r of results) {
    for (const vf of r.visualFailures) {
      if (!tagCounts[vf.tag]) tagCounts[vf.tag] = { total: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
      tagCounts[vf.tag].total++;
      tagCounts[vf.tag][vf.severity]++;
    }
  }

  const tagDescriptions = {
    REUSED_SAME_IMAGE_SET: { desc: 'Same images shared across multiple unrelated cases', rec: 'Fix image cache isolation — each case should fetch fresh images or use story-specific cache keys.' },
    WRONG_STORY_VISUAL: { desc: 'Images from a different story leak into unrelated cases', rec: 'Fix image search query specificity and cache contamination.' },
    SOCIAL_SCREENSHOT_USED: { desc: 'Social media screenshots/posts in candidate pool', rec: 'Strengthen sourceImageQualityGate to reject screenshots earlier.' },
    TEXT_OVERLAY_VISIBLE: { desc: 'Text overlay/news thumbnail in candidate pool', rec: 'Strengthen sourceImageQualityGate TEXT_OVERLAY detection.' },
    GENERIC_CONTEXT_IMAGE: { desc: 'Generic low-relevance context images in pool', rec: 'Improve AI Curator specificity for story-relevant images.' },
    DUPLICATE_OR_NEAR_DUPLICATE_SLOT: { desc: 'Same image reused in multiple composition slots', rec: 'Fix slot assignment de-duplication logic.' },
    LOW_VISUAL_COHERENCE: { desc: 'Low judge score or many composition issues', rec: 'Composition polish phase — improve template rendering.' },
    CACHE_CONTAMINATION_SUSPECTED: { desc: 'Image pool doesn\'t match story keywords', rec: 'Fix image cache key generation and story-specific search.' },
    SOURCE_POOL_NOT_STORY_SPECIFIC: { desc: 'No story anchor images found in pool', rec: 'Improve search query generation and story anchor detection.' },
    COMPOSITION_POLISH_NEEDED: { desc: 'Cover needs visual quality improvement', rec: 'Start composition polish phase after regression is stable.' },
  };

  const rankedCauses = Object.entries(tagCounts)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([tag, counts]) => ({
      tag,
      count: counts.total,
      highCount: counts.HIGH,
      description: tagDescriptions[tag]?.desc || tag,
      recommendation: tagDescriptions[tag]?.rec || 'Investigate further.',
    }));

  const failureSummary = { tagCounts, rankedCauses };

  // ─── Save JSON ────────────────────────────────────────────────────────
  const jsonResults = results.map(r => {
    const { _raw, ...rest } = r;
    return rest;
  });

  const jsonReport = {
    generated: new Date().toISOString(),
    branch: 'ai/post-selection-quality',
    totalCases: results.length,
    passed: results.filter(r => r.verdict === 'SUCCESS' || r.verdict === 'PARTIAL_PASS').length,
    blocked: results.filter(r => r.verdict === 'NEED_MANUAL_REVIEW').length,
    errored: results.filter(r => r.verdict === 'ERROR').length,
    failureSummary,
    results: jsonResults,
  };

  fs.writeFileSync(
    path.join(OUT_DIR, 'phase5-regression-matrix.json'),
    JSON.stringify(jsonReport, null, 2),
    'utf-8'
  );

  // ─── Save Markdown ────────────────────────────────────────────────────
  const md = generateMarkdownReport(results, failureSummary);
  fs.writeFileSync(
    path.join(OUT_DIR, 'phase5-regression-matrix.md'),
    md,
    'utf-8'
  );

  // ─── Console summary ─────────────────────────────────────────────────
  console.log('\n\n══════════════════════════════════════════════════════');
  console.log('PHASE 5 REGRESSION MATRIX — FINAL SUMMARY');
  console.log('══════════════════════════════════════════════════════');

  const p = results.filter(r => r.verdict === 'SUCCESS' || r.verdict === 'PARTIAL_PASS');
  const b = results.filter(r => r.verdict === 'NEED_MANUAL_REVIEW');
  const e = results.filter(r => r.verdict === 'ERROR');

  console.log(`\n  ✅ Passed: ${p.length}  ⛔ Blocked: ${b.length}  ❌ Error: ${e.length}  📊 Total: ${results.length}`);
  console.log(`  Pass rate: ${((p.length / results.length) * 100).toFixed(0)}%\n`);

  for (const r of results) {
    const icon = r.verdict === 'SUCCESS' ? '✅' : r.verdict === 'PARTIAL_PASS' ? '⚠️' : r.verdict === 'NEED_MANUAL_REVIEW' ? '⛔' : '❌';
    const vfCount = r.visualFailures.length;
    console.log(`  ${icon} ${r.id} [${r.expectedType}] → ${r.verdict} | score=${r.score || '?'} | gallery=${r.galleryStatus || '?'} | vf=${vfCount}`);
  }

  console.log('\n  TOP VISUAL FAILURE CAUSES:');
  for (let i = 0; i < Math.min(rankedCauses.length, 5); i++) {
    const c = rankedCauses[i];
    console.log(`    ${i + 1}. ${c.tag} (${c.count} cases, ${c.highCount} HIGH)`);
  }

  console.log(`\n  📄 JSON: ${path.join(OUT_DIR, 'phase5-regression-matrix.json')}`);
  console.log(`  📄 MD:   ${path.join(OUT_DIR, 'phase5-regression-matrix.md')}`);
  console.log('\n  Phase 5 complete. Do not merge. Do not start composition polish.');
}

main().catch(err => {
  console.error('Phase 5 test runner failed:', err.message);
  process.exit(1);
});
