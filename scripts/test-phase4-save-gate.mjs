/**
 * Phase 4 — Final Save Gate Verification Test
 * Tests 3 cases to verify the save gate properly flags bad covers
 * while allowing good covers through.
 */

const TEST_CASES = [
  {
    id: 'CASE-010',
    // เจ๊แห้ง style case — uses dominant news thumbnail/text overlay
    title: 'ชื่นชม\'เจ๊แห้ง\'แม่ค้าหัวใจทองคำ น้ำใจงามลุกขึ้นสู้ เพื่อความอยู่รอดของทุกชีวิต',
    content: 'ชื่นชม เจ๊แห้ง แม่ค้าผัดไทยหัวใจทองคำ ผู้หญิงตัวเล็กๆ ที่ลุกขึ้นสู้เพื่อความอยู่รอดของทุกชีวิต น้ำใจงามของแม่ค้าริมทาง ที่ช่วยเหลือคนยากลำบากโดยไม่หวังผลตอบแทน',
    sourceUrl: 'https://mgronline.com/entertainment/detail/9670000000001',
    expected: 'NEED_MANUAL_REVIEW because it uses dominant news thumbnail/text overlay',
    expectedStatus: 'NEED_MANUAL_REVIEW',
  },
  {
    id: 'CASE-011',
    // Chompoo+Yai Ning — clean family/nature photos
    title: 'ชมพู่ อารยา พาลูกๆ เรียนรู้ธรรมชาติกับยายหนิง ปลูกผักสวนครัว เลี้ยงไก่ ทำนา สุดอบอุ่น',
    content: 'ชมพู่ อารยา เอ ฮาร์เก็ต พาลูกแฝด สายฟ้า-พายุ ไปเยี่ยมคุณยายที่ต่างจังหวัด เรียนรู้ธรรมชาติ ปลูกผัก เลี้ยงไก่ ทำนา บรรยากาศอบอุ่นมาก',
    sourceUrl: 'https://www.sanook.com/news/9000001/',
    expected: 'SUCCESS or PARTIAL_PASS — clean photos should not be blocked',
    expectedStatus: 'SUCCESS',
  },
  {
    id: 'CASE-009',
    // Celebrity interview — Beer+O Pakjeera
    title: '"เบียร์" ยอมรับตรง ๆ ว่า สิ่งที่ทำให้เขารู้สึกดีกับ "โอ๋ ภัคจีรา" คือ... ทุกอย่างเลย',
    content: 'เบียร์ ภัสรนันท์ เปิดใจเรื่องความสัมพันธ์กับ โอ๋ ภัคจีรา ยอมรับว่าชอบทุกอย่างในตัวเธอ ทั้งนิสัยดี ดูแลครอบครัว และความสวย',
    sourceUrl: 'https://www.thairath.co.th/entertainment/2000001',
    expected: 'SUCCESS if clean photos dominate, NEED_MANUAL_REVIEW if thumbnails/text overlays dominate',
    expectedStatus: 'DEPENDS',
  },
];

async function runTests() {
  const API_URL = 'http://localhost:3000/api/auto-cover';
  const results = [];

  console.log('Phase 4 — Final Save Gate Verification');
  console.log(`API: ${API_URL}`);
  console.log(`Cases: ${TEST_CASES.length}`);
  console.log(`Timeout: 300s per case`);
  console.log('');

  for (const tc of TEST_CASES) {
    console.log('============================================================');
    console.log(`▶ Testing: ${tc.id}`);
    console.log(`  Title: ${tc.title.substring(0, 70)}...`);
    console.log(`  Expected: ${tc.expected}`);
    console.log('============================================================');
    console.log('');

    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 300000);

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newsTitle: tc.title,
          content: tc.content,
          sourceUrl: tc.sourceUrl,
          batchId: `phase4-test-${tc.id}`,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const data = await res.json();
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      const saveGate = data.finalSaveGate || {};
      const blockers = data.saveGateBlockers || [];

      console.log(`  ${res.status === 200 ? '✅' : '❌'} HTTP ${res.status} | success=${data.success} | score=${data.score}`);
      console.log(`  📋 storyType: ${data.identity?.storyType || data.normalizedStoryType || '?'} | status: ${data.status}`);
      console.log(`  🔍 Save Gate: passed=${data.saveGatePassed} | status=${data.saveGateStatus}`);
      console.log(`     savedToGallery: ${data.savedToGallery} | galleryStatus: ${data.galleryStatus}`);
      
      if (blockers.length > 0) {
        console.log(`  ⛔ Blockers (${blockers.length}):`);
        for (const b of blockers) {
          console.log(`     - [${b.severity}] ${b.id}: ${b.reason}`);
        }
      } else {
        console.log(`  ✅ No blockers`);
      }

      if (data.storyMatchScore !== null && data.storyMatchScore !== undefined) {
        console.log(`  📊 storyMatch: ${data.storyMatchScore}/10 | coverPraises: ${data.coverPraises || 'N/A'}`);
      }

      if (data.manualReviewReason) {
        console.log(`  📝 manualReviewReason: ${data.manualReviewReason}`);
      }

      console.log(`  ⏱ Elapsed: ${elapsed}s`);

      results.push({
        caseId: tc.id,
        httpStatus: res.status,
        success: data.success,
        score: data.score,
        status: data.status,
        saveGatePassed: data.saveGatePassed,
        saveGateStatus: data.saveGateStatus,
        savedToGallery: data.savedToGallery,
        galleryStatus: data.galleryStatus,
        blockerCount: blockers.length,
        blockerIds: blockers.map(b => b.id),
        storyMatchScore: data.storyMatchScore,
        manualReviewReason: data.manualReviewReason,
        elapsed,
        expectedStatus: tc.expectedStatus,
        meetsExpectation: tc.expectedStatus === 'DEPENDS' 
          ? true  // CASE-009 depends on images found
          : data.saveGateStatus === tc.expectedStatus,
      });

    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  ❌ ERROR: ${err.message}`);
      console.log(`  ⏱ Elapsed: ${elapsed}s`);

      results.push({
        caseId: tc.id,
        error: err.message,
        elapsed,
        meetsExpectation: false,
      });
    }

    console.log('');
  }

  // Summary
  console.log('============================================================');
  console.log('PHASE 4 VERIFICATION SUMMARY');
  console.log('============================================================');
  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.caseId}: ❌ ERROR | ${r.error}`);
    } else {
      const match = r.meetsExpectation ? '✅' : '⚠️';
      console.log(`  ${r.caseId}: ${match} ${r.saveGateStatus} | score=${r.score} | blockers=${r.blockerCount} | storyMatch=${r.storyMatchScore ?? 'N/A'} | expected=${r.expectedStatus}`);
      if (r.blockerIds.length > 0) {
        console.log(`    blockers: [${r.blockerIds.join(', ')}]`);
      }
    }
  }

  // Save reports
  const fs = require('fs');
  const path = require('path');
  const reviewDir = path.join(process.cwd(), 'ai-review');
  fs.mkdirSync(reviewDir, { recursive: true });

  fs.writeFileSync(
    path.join(reviewDir, 'phase4-save-gate-test-report.json'),
    JSON.stringify(results, null, 2),
    'utf-8'
  );

  const mdLines = [
    '# Phase 4 — Final Save Gate Test Report',
    '',
    `**Date**: ${new Date().toISOString()}`,
    `**Cases**: ${results.length}`,
    '',
    '| Case | Status | Score | Gate | Blockers | StoryMatch | Expected | Match |',
    '|------|--------|-------|------|----------|------------|----------|-------|',
  ];

  for (const r of results) {
    if (r.error) {
      mdLines.push(`| ${r.caseId} | ERROR | - | - | - | - | ${r.expectedStatus} | ❌ |`);
    } else {
      mdLines.push(`| ${r.caseId} | ${r.saveGateStatus} | ${r.score}/10 | ${r.saveGatePassed ? 'PASS' : 'FAIL'} | ${r.blockerCount} | ${r.storyMatchScore ?? 'N/A'} | ${r.expectedStatus} | ${r.meetsExpectation ? '✅' : '⚠️'} |`);
    }
  }

  if (results.some(r => r.blockerIds?.length > 0)) {
    mdLines.push('', '## Blockers Detail', '');
    for (const r of results) {
      if (r.blockerIds?.length > 0) {
        mdLines.push(`### ${r.caseId}`, '');
        mdLines.push(`- **manualReviewReason**: ${r.manualReviewReason || 'N/A'}`);
        for (const bid of r.blockerIds) {
          mdLines.push(`- ${bid}`);
        }
        mdLines.push('');
      }
    }
  }

  fs.writeFileSync(
    path.join(reviewDir, 'phase4-save-gate-test-report.md'),
    mdLines.join('\n'),
    'utf-8'
  );

  console.log('');
  console.log(`📄 JSON report saved: ai-review/phase4-save-gate-test-report.json`);
  console.log(`📄 MD report saved: ai-review/phase4-save-gate-test-report.md`);
  console.log('');
  console.log('✅ Phase 4 verification complete.');
}

runTests().catch(err => {
  console.error('Test runner failed:', err.message);
  process.exit(1);
});
