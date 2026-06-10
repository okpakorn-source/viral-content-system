/**
 * Phase 4.1 Fix — Save Gate Verification (Post-Review)
 * ────────────────────────────────────────────────────
 * Tests all 3 fixes:
 *   1. Save paths are gated (NEED_MANUAL_REVIEW → no gallery save)
 *   2. faceData lookup uses candidateId
 *   3. STORY_MATCH_LOW override for soft types
 *
 * Expected:
 *   CASE-010 = NEED_MANUAL_REVIEW + savedToGallery=false + galleryStatus=SKIPPED_MANUAL_REVIEW
 *   CASE-011 = SUCCESS or PARTIAL_PASS + savedToGallery=true + galleryStatus=SAVED
 *   CASE-009 = NEED_MANUAL_REVIEW only if duplicate slot or real composition issue
 */

const API = 'http://localhost:3000/api/auto-cover';
const TIMEOUT = 300_000;

const CASES = [
  {
    id: 'CASE-010',
    title: "ชื่นชม'เจ๊แห้ง'แม่ค้าหัวใจทองคำ น้ำใจงามลุกขึ้นสู้ เพื่อความอยู่รอดของชาวบ้าน",
    expected: 'NEED_MANUAL_REVIEW',
    expectSavedToGallery: false,
    expectGalleryStatus: 'SKIPPED_MANUAL_REVIEW',
    reason: 'Bad cover — save paths must be gated',
  },
  {
    id: 'CASE-011',
    title: "ชมพู่ อารยา พาลูกๆ เรียนรู้ธรรมชาติกับยายหนิง ปลูกผักสวนครัว เลี้ยงไก่ สัมผัสชีวิตชนบท",
    expected: 'SUCCESS_OR_PARTIAL',
    expectSavedToGallery: true,
    expectGalleryStatus: 'SAVED',
    reason: 'Clean family/nature — CIRCLE_NO_FACE + storyMatch inconsistency = WARNING',
  },
  {
    id: 'CASE-009',
    title: '"เบียร์" ยอมรับตรง ๆ ว่า สิ่งที่ทำให้เขารู้สึกดีกับ "โอ๋ ภัคจีรา" คือ....',
    expected: 'DEPENDS',
    expectSavedToGallery: null,
    expectGalleryStatus: null,
    reason: 'NEED_MANUAL_REVIEW only if duplicate slot or real composition issue remains',
  },
];

async function runCase(c) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`▶ Testing: ${c.id}`);
  console.log(`  Title: ${c.title.slice(0, 70)}...`);
  console.log(`  Expected: ${c.expected} — ${c.reason}`);
  console.log(`${'═'.repeat(60)}\n`);

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
    const data = await res.json();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    const result = {
      caseId: c.id,
      httpStatus: res.status,
      success: data.success,
      score: data.score,
      status: data.status,
      storyType: data.identity?.storyType || data.normalizedStoryType || '?',
      saveGateStatus: data.saveGateStatus || '?',
      saveGatePassed: data.saveGatePassed ?? '?',
      saveGateBlockers: data.saveGateBlockers || [],
      saveGateWarnings: data.saveGateWarnings || [],
      savedToGallery: data.savedToGallery,
      galleryStatus: data.galleryStatus,
      manualReviewReason: data.manualReviewReason || null,
      storyMatch: data.storyMatchScore ?? '?',
      coverPraises: data.coverPraises || null,
      elapsed,
      expected: c.expected,
      expectSavedToGallery: c.expectSavedToGallery,
      expectGalleryStatus: c.expectGalleryStatus,
    };

    // Print
    const icon = res.status === 200 ? '✅' : '❌';
    console.log(`  ${icon} HTTP ${res.status} | success=${data.success} | score=${data.score}`);
    console.log(`  📋 storyType: ${result.storyType} | status: ${result.status}`);
    console.log(`  🔍 Save Gate: passed=${result.saveGatePassed} | status=${result.saveGateStatus}`);
    console.log(`  💾 savedToGallery: ${result.savedToGallery} | galleryStatus: ${result.galleryStatus}`);

    if (result.saveGateBlockers.length > 0) {
      console.log(`  ⛔ Blockers (${result.saveGateBlockers.length}):`);
      for (const b of result.saveGateBlockers) {
        console.log(`     - [${b.severity}] ${b.id}: ${b.reason}`);
      }
    } else {
      console.log(`  ✅ No blockers`);
    }

    if (result.saveGateWarnings.length > 0) {
      console.log(`  ⚠️ Warnings (${result.saveGateWarnings.length}):`);
      for (const w of result.saveGateWarnings) {
        console.log(`     - ${w}`);
      }
    }

    if (result.manualReviewReason) {
      console.log(`  📝 manualReviewReason: ${result.manualReviewReason}`);
    }
    console.log(`  ⏱ Elapsed: ${elapsed}s`);

    // Verify save path gating
    if (c.expectSavedToGallery !== null) {
      const galMatch = result.savedToGallery === c.expectSavedToGallery;
      console.log(`  🔒 savedToGallery check: ${galMatch ? '✅ CORRECT' : '❌ WRONG'} (got=${result.savedToGallery}, expected=${c.expectSavedToGallery})`);
    }
    if (c.expectGalleryStatus !== null) {
      const gsMatch = result.galleryStatus === c.expectGalleryStatus;
      console.log(`  🔒 galleryStatus check: ${gsMatch ? '✅ CORRECT' : '❌ WRONG'} (got=${result.galleryStatus}, expected=${c.expectGalleryStatus})`);
    }

    return result;
  } catch (err) {
    clearTimeout(timer);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`  ❌ ERROR: ${err.message} (${elapsed}s)`);
    return { caseId: c.id, error: err.message, elapsed, expected: c.expected };
  }
}

async function main() {
  console.log('Phase 4.1 Fix — Save Gate Verification (Post-Review)');
  console.log(`API: ${API}`);
  console.log(`Cases: ${CASES.length}\n`);

  const results = [];
  for (const c of CASES) {
    const r = await runCase(c);
    results.push(r);
  }

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log('PHASE 4.1 FIX VERIFICATION SUMMARY');
  console.log(`${'═'.repeat(60)}`);

  let allPass = true;

  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.caseId}: ❌ ERROR — ${r.error}`);
      allPass = false;
      continue;
    }

    let match = '?';
    if (r.expected === 'NEED_MANUAL_REVIEW') {
      const statusOk = r.status === 'NEED_MANUAL_REVIEW';
      const galOk = r.savedToGallery === false;
      const gsOk = r.galleryStatus === 'SKIPPED_MANUAL_REVIEW';
      match = (statusOk && galOk && gsOk) ? '✅ PASS' : '❌ FAIL';
      if (!statusOk || !galOk || !gsOk) allPass = false;
    } else if (r.expected === 'SUCCESS_OR_PARTIAL') {
      const statusOk = r.status === 'SUCCESS' || r.saveGateStatus === 'SUCCESS' || r.saveGateStatus === 'PARTIAL_PASS';
      const galOk = r.savedToGallery === true;
      match = (statusOk && galOk) ? '✅ FIXED' : '⚠️ still blocked';
      if (!statusOk) allPass = false;
    } else {
      match = '📋 INFO';
    }

    console.log(`  ${r.caseId}: ${match} | status=${r.status} | saveGate=${r.saveGateStatus} | savedToGallery=${r.savedToGallery} | galleryStatus=${r.galleryStatus} | score=${r.score} | blockers=${r.saveGateBlockers?.length || 0} | warnings=${r.saveGateWarnings?.length || 0}`);
    if (r.saveGateBlockers?.length > 0) {
      console.log(`    blockers: [${r.saveGateBlockers.map(b => b.id).join(', ')}]`);
    }
    if (r.saveGateWarnings?.length > 0) {
      console.log(`    warnings: [${r.saveGateWarnings.map(w => w.slice(0, 80)).join(', ')}]`);
    }
  }

  console.log(`\n${allPass ? '✅ ALL CRITICAL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}`);

  // Critical regression check
  const case010 = results.find(r => r.caseId === 'CASE-010');
  if (case010 && (case010.status !== 'NEED_MANUAL_REVIEW' || case010.savedToGallery !== false)) {
    console.error('\n🚨 REGRESSION: CASE-010 must be NEED_MANUAL_REVIEW + savedToGallery=false!');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test runner failed:', err.message);
  process.exit(1);
});
