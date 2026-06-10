/**
 * Phase 3 — Quality Gate Live Verification
 * Tests CASE-003, CASE-004, CASE-005 (Chompoo regression)
 */
import fs from 'fs';
import path from 'path';

const API_URL = 'http://localhost:3000/api/auto-cover';
const TIMEOUT = 300_000; // 5 min per case
const REPORT_DIR = path.resolve('ai-review');
const COVER_DIR = path.resolve('C:/Users/User/.gemini/antigravity/brain/443dcfba-2880-4027-bd97-5cef1291ce02');

const CASES = [
  {
    caseId: 'CASE-003',
    newsTitle: '"เบียร์" ยอมรับตรง ๆ ว่า สิ่งที่ทำให้เขารู้สึกดีกับ "โอ๋ ภัคจีรา" มาตลอด คือความเป็นตัวของตัวเองของเธอ',
    content: '"เบียร์" ยอมรับตรง ๆ ว่า สิ่งที่ทำให้เขารู้สึกดีกับ "โอ๋ ภัคจีรา" มาตลอด คือความเป็นตัวของตัวเองของเธอ เพราะโอ๋ไม่เคยพยายามเป็นใคร และไม่เคยต้องเปลี่ยนตัวเองเพื่อให้ถูกใจใคร\nเขาไม่เคยสร้างมาตรฐานว่าผู้หญิงที่อยู่ข้าง ๆ จะต้องเป็นแบบไหน จะต้องเพอร์เฟกต์แค่ไหน หรือจะต้องมีคุณสมบัติตามที่สังคมคาดหวัง เพราะสำหรับเขา ความสุขเกิดจากการได้อยู่กับคนที่เป็นตัวเองอย่างสบายใจ มีความจริงใจ มีความสนุก และมีพลังงานดี ๆ ที่ทำให้ทุกวันมีรอยยิ้ม\nสิ่งที่หลายคนสัมผัสได้จากความสัมพันธ์ของทั้งคู่ จึงไม่ใช่แค่ความหวานหรือความน่ารัก แต่เป็นความรู้สึกของการยอมรับกันในแบบที่เป็น การมองเห็นคุณค่าของกันและกัน เพราะบางครั้งความรักที่ดีที่สุด อาจเป็นการได้เจอคนที่ชอบเราในทุกอย่างที่เราเป็น และทำให้เรากล้าเป็นตัวเองได้อย่างเต็มที่ครับ',
    expect: 'BLOCK_MOST — text overlays + news thumbnails + YT thumbnails blocked/downgraded, qualityGatePassed=false if clean images insufficient',
  },
  {
    caseId: 'CASE-004',
    newsTitle: 'ชื่นชม\'เจ๊แห้ง\'แม่ค้าหัวใจทองคำ น้ำใจงามลุกขึ้นสู้ เพื่อความถูกต้องของลูกค้า',
    content: 'ชื่นชม\'เจ๊แห้ง\'แม่ค้าหัวใจทองคำ\nน้ำใจงามลุกขึ้นสู้ เพื่อความถูกต้องของลูกค้า\nจากกรณี"พี่ขยัน" ลูกค้าผู้ซื่อบริสุทธิ์\nหลังพี่ขยันบอกว่าส่ง(เลข 173770)\nมูลค่า 6 ล้านบาทให้เพื่อนบ้านช่วยดูให้\nแต่กลับโดนอ้างว่าไม่ถูก\nแถมยังขยำทิ้งลงถังขยะไปอย่างเป็นปริศนา\nพอเธอรู้ พาลูกค้าไปลุยรื้อถังขยะเพื่อหาหลักฐานด้วยตัวเอง\nแถมความใส่ใจของเจ๊แห้งที่ถ่ายรูปแผงตัวเลขเก็บไว้ทุกครั้ง\nกลายเป็นหลักฐานชิ้นสำคัญที่พิสูจน์ว่า\nพี่ขยันถูก6ล้านจริงๆ',
    expect: 'BLOCK_SOME — MGR thumbnail + text overlay blocked',
  },
  {
    caseId: 'CASE-005-regression',
    newsTitle: 'ชมพู่ อารยา พาลูกๆ เรียนรู้ธรรมชาติกับยายหนิง ปลูกผักสวนครัว',
    content: 'ชมพู่ อารยา เอ ฮาร์เก็ต พาลูกๆ สายฟ้า-พายุ ไปเยี่ยมคุณยายหนิง ปลูกผักสวนครัว เรียนรู้ธรรมชาติ ทำกิจกรรมในสวน ภาพน่ารักอบอุ่น ครอบครัวสุขสันต์',
    expect: 'PASS — clean images should not be false-blocked',
  },
];

async function runTest(testCase) {
  const startTime = Date.now();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`▶ Testing: ${testCase.caseId}`);
  console.log(`  Title: ${testCase.newsTitle.substring(0, 60)}...`);
  console.log(`  Expected: ${testCase.expect}`);
  console.log('='.repeat(60));

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newsTitle: testCase.newsTitle,
        content: testCase.content,
        mode: 'auto',
      }),
      signal: AbortSignal.timeout(TIMEOUT),
    });

    const d = await res.json();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Read ai-review JSON for quality gate diagnostics
    let aiReview = null;
    try {
      const reviewPath = path.join(REPORT_DIR, 'auto-cover-latest.json');
      aiReview = JSON.parse(fs.readFileSync(reviewPath, 'utf-8'));
    } catch { /* may not exist */ }

    // Extract quality gate data from ai-review
    const qg = aiReview?.qualityGate || d.qualityGate || null;

    const result = {
      caseId: testCase.caseId,
      timestamp: new Date().toISOString(),
      elapsed: `${elapsed}s`,
      httpStatus: res.status,
      success: d.success || false,
      error: d.error || null,
      errorType: d.errorType || null,

      // Story identity
      storyType: d.identity?.storyType || aiReview?.normalizedStoryType || null,
      rawStoryType: d.identity?.rawStoryType || aiReview?.rawStoryType || null,
      selectedPolicy: qg?.qualityGateSummary?.policyKey || null,
      template: d.template || aiReview?.template || null,

      // Quality gate diagnostics
      qualityGateSummary: qg?.qualityGateSummary || null,
      qualityGatePassed: qg?.qualityGatePassed ?? null,
      sourceImageTypes: qg?.sourceImageTypes || [],
      blockedSourceImages: qg?.blockedSourceImages || [],
      downgradedSourceImages: qg?.downgradedSourceImages || [],
      evidenceCandidates: qg?.evidenceCandidates || [],

      // Composition
      compositionQA: d.compositionQA || null,
      storyMatch: {
        score: d.storyMatchScore ?? null,
        reason: d.storyMatchReason || null,
      },
      score: d.score ?? null,
      
      // Slot info
      slotAssignment: aiReview?.slotAssignment || null,
      slotAuditIssues: aiReview?.slotAuditIssues || null,

      // Status
      status: d.status || (d.success ? 'SUCCESS' : d.errorType || 'FAILED'),
      hasCoverImage: !!(d.coverImage),
      coverImageSize: d.coverImage?.length || 0,

      // Expectations
      expectedBehavior: testCase.expect,
    };

    // Save cover image
    if (d.coverImage) {
      const b64 = d.coverImage.replace(/^data:image\/\w+;base64,/, '');
      const buf = Buffer.from(b64, 'base64');
      const coverPath = path.join(COVER_DIR, `${testCase.caseId}-phase3.jpg`);
      fs.writeFileSync(coverPath, buf);
      result.coverImagePath = coverPath;
      console.log(`  💾 Cover saved: ${coverPath}`);
    }

    // Print summary
    console.log(`\n  ✅ HTTP ${res.status} | success=${d.success} | score=${d.score}`);
    console.log(`  📋 storyType: ${result.storyType} | policy: ${result.selectedPolicy}`);
    console.log(`  🔍 Quality Gate: passed=${result.qualityGatePassed}`);
    if (result.qualityGateSummary) {
      const s = result.qualityGateSummary;
      console.log(`     total=${s.total} | passed=${s.passed} | blocked=${s.blocked} | downgraded=${s.downgraded}`);
      console.log(`     types: ${JSON.stringify(s.types)}`);
    }
    if (result.blockedSourceImages.length > 0) {
      console.log(`  ⛔ Blocked images (${result.blockedSourceImages.length}):`);
      for (const bi of result.blockedSourceImages) {
        console.log(`     - ${bi.sourceType}: ${bi.url} — ${bi.gateReason}`);
      }
    }
    if (result.downgradedSourceImages.length > 0) {
      console.log(`  ⬇️ Downgraded images (${result.downgradedSourceImages.length}):`);
      for (const di of result.downgradedSourceImages) {
        console.log(`     - ${di.sourceType}: ${di.originalRole} → ${di.newRole}`);
      }
    }
    console.log(`  ⏱ Elapsed: ${elapsed}s`);

    return result;

  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`  ❌ FAILED: ${err.message} (${elapsed}s)`);
    return {
      caseId: testCase.caseId,
      timestamp: new Date().toISOString(),
      elapsed: `${elapsed}s`,
      success: false,
      error: err.message,
      errorType: 'TEST_ERROR',
      expectedBehavior: testCase.expect,
    };
  }
}

// ═══ Main ═══
console.log('Phase 3 — Quality Gate Live Verification');
console.log(`API: ${API_URL}`);
console.log(`Cases: ${CASES.length}`);
console.log(`Timeout: ${TIMEOUT / 1000}s per case`);

const results = [];
for (const tc of CASES) {
  const r = await runTest(tc);
  results.push(r);
}

// ═══ Summary ═══
console.log('\n' + '='.repeat(60));
console.log('PHASE 3 VERIFICATION SUMMARY');
console.log('='.repeat(60));

for (const r of results) {
  const gateStr = r.qualityGateSummary
    ? `gate: ${r.qualityGateSummary.passed}/${r.qualityGateSummary.total} passed, ${r.qualityGateSummary.blocked} blocked`
    : 'gate: N/A';
  const status = r.qualityGatePassed === false ? '🚫 GATE_FAIL' : 
                 r.success ? '✅ OK' : 
                 `❌ ${r.errorType || 'FAIL'}`;
  console.log(`  ${r.caseId}: ${status} | score=${r.score} | ${gateStr}`);
}

// ═══ Save JSON report ═══
const report = {
  reportId: 'phase3-quality-gate-test',
  generatedAt: new Date().toISOString(),
  branch: 'ai/post-selection-quality',
  commitSha: 'phase3-v2',
  source: 'auto-task',
  cases: results,
  summary: {
    totalCases: results.length,
    passed: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    gateBlocked: results.reduce((sum, r) => sum + (r.qualityGateSummary?.blocked || 0), 0),
    gateDowngraded: results.reduce((sum, r) => sum + (r.qualityGateSummary?.downgraded || 0), 0),
  },
};

fs.writeFileSync(
  path.join(REPORT_DIR, 'phase3-quality-gate-test-report.json'),
  JSON.stringify(report, null, 2),
  'utf-8'
);
console.log(`\n📄 JSON report saved: ai-review/phase3-quality-gate-test-report.json`);

// ═══ Save MD report ═══
let md = `# Phase 3 — Quality Gate Live Verification Report\n\n`;
md += `> **Generated**: ${new Date().toISOString()}  \n`;
md += `> **Branch**: ai/post-selection-quality  \n`;
md += `> **Commit**: 0f66375  \n\n`;

md += `## Summary\n\n`;
md += `| Case | Status | Score | Gate Passed | Blocked | Downgraded | Policy |\n`;
md += `|------|--------|-------|-------------|---------|------------|--------|\n`;
for (const r of results) {
  const status = r.qualityGatePassed === false ? '🚫 GATE_FAIL' : r.success ? '✅ OK' : '❌ FAIL';
  md += `| ${r.caseId} | ${status} | ${r.score ?? 'N/A'} | ${r.qualityGatePassed ?? 'N/A'} | ${r.qualityGateSummary?.blocked ?? 0} | ${r.qualityGateSummary?.downgraded ?? 0} | ${r.selectedPolicy || 'N/A'} |\n`;
}
md += `\n---\n\n`;

for (const r of results) {
  md += `## ${r.caseId}\n\n`;
  md += `- **Expected**: ${r.expectedBehavior}\n`;
  md += `- **Status**: ${r.success ? 'SUCCESS' : r.errorType || 'FAILED'}\n`;
  md += `- **Score**: ${r.score}\n`;
  md += `- **Story Type**: ${r.storyType}\n`;
  md += `- **Policy**: ${r.selectedPolicy}\n`;
  md += `- **Template**: ${r.template}\n`;
  md += `- **Elapsed**: ${r.elapsed}\n`;
  md += `- **Cover Image**: ${r.coverImagePath || 'N/A'}\n\n`;

  if (r.qualityGateSummary) {
    const s = r.qualityGateSummary;
    md += `### Quality Gate\n\n`;
    md += `| Metric | Value |\n|--------|-------|\n`;
    md += `| Total images | ${s.total} |\n`;
    md += `| Passed | ${s.passed} |\n`;
    md += `| Blocked | ${s.blocked} |\n`;
    md += `| Downgraded | ${s.downgraded} |\n`;
    md += `| Gate Passed | ${r.qualityGatePassed} |\n`;
    md += `| Types | ${JSON.stringify(s.types)} |\n\n`;
  }

  if (r.blockedSourceImages?.length > 0) {
    md += `### Blocked Images\n\n`;
    md += `| URL | Source Type | Reason |\n|-----|------------|--------|\n`;
    for (const bi of r.blockedSourceImages) {
      md += `| ${bi.url || 'N/A'} | ${bi.sourceType} | ${bi.gateReason || bi.reasons?.[0] || ''} |\n`;
    }
    md += `\n`;
  }

  if (r.downgradedSourceImages?.length > 0) {
    md += `### Downgraded Images\n\n`;
    md += `| URL | Source Type | Original Role | New Role |\n|-----|------------|---------------|----------|\n`;
    for (const di of r.downgradedSourceImages) {
      md += `| ${di.url || 'N/A'} | ${di.sourceType} | ${di.originalRole} | ${di.newRole} |\n`;
    }
    md += `\n`;
  }

  if (r.compositionQA) {
    md += `### Composition QA\n\n`;
    md += `- **Passed**: ${r.compositionQA.passed}\n`;
    md += `- **Issues**: ${JSON.stringify(r.compositionQA.issues || [])}\n\n`;
  }

  if (r.storyMatch?.score != null) {
    md += `### Story Match\n\n`;
    md += `- **Score**: ${r.storyMatch.score}\n`;
    md += `- **Reason**: ${r.storyMatch.reason}\n\n`;
  }

  md += `---\n\n`;
}

fs.writeFileSync(
  path.join(REPORT_DIR, 'phase3-quality-gate-test-report.md'),
  md,
  'utf-8'
);
console.log(`📄 MD report saved: ai-review/phase3-quality-gate-test-report.md`);
console.log('\n✅ Phase 3 verification complete.');
