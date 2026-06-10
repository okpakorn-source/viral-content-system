/**
 * Post-process: save task results with unique runId
 * Run AFTER the test task completes
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const runId = `fix29-32_${Date.now()}`;
const reviewDir = path.resolve('ai-review');
const latestJson = path.join(reviewDir, 'auto-cover-latest.json');

// Get current commit SHA
let commitSha = 'unknown';
try {
  commitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
} catch {}

console.log(`[PostProcess] runId: ${runId}`);
console.log(`[PostProcess] commitSha: ${commitSha}`);

// Read the latest JSON (written by the API during our task run)
if (!fs.existsSync(latestJson)) {
  console.error('[PostProcess] ERROR: auto-cover-latest.json not found — task may not have completed');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(latestJson, 'utf-8'));

// Check if this is our task result (timestamp should be recent)
const tsDate = new Date(data.timestamp);
const nowDate = new Date();
const ageSec = (nowDate - tsDate) / 1000;
console.log(`[PostProcess] JSON timestamp: ${data.timestamp} (age: ${Math.round(ageSec)}s)`);

if (ageSec > 300) {
  console.warn(`[PostProcess] WARNING: JSON is ${Math.round(ageSec)}s old — may be from a different run`);
}

// Enrich with task metadata
const enriched = {
  testRunId: runId,
  generatedAt: new Date().toISOString(),
  runtimeCommitSha: commitSha,
  source: 'auto-task',
  ...data,
};

// Save with unique runId
const outJson = path.join(reviewDir, `auto-cover-task-${runId}.json`);
fs.writeFileSync(outJson, JSON.stringify(enriched, null, 2), 'utf-8');
console.log(`[PostProcess] Saved: ${outJson}`);

// Generate MD report
const heroTitle = data.slotAssignment?.heroTitle || 'N/A';
const heroRole = data.slotAssignment?.heroRole || 'N/A';
const circleIdx = data.slotAssignment?.circleIndex ?? 'N/A';
const circleImg = data.allCandidates?.[circleIdx] || {};
const photoOrder = data.slotAssignment?.photoOrder || [];
const storyType = data.normalizedStoryType || data.storyType || 'N/A';
const storyAnchors = data.storyAnchorCandidates || [];
const score = data.score ?? 'N/A';
const storyMatch = data.storyMatchScore ?? 'N/A';
const storyMatchReason = data.storyMatchReason || 'N/A';
const needManual = data.needManualReview || false;

// New Fix 29-32 fields
const compositionQA = data.compositionQA || null;
const visualWeight = data.visualWeightReport || null;
const perSlotCrop = data.perSlotCropMode || null;
const cropQual = data.cropQuality || null;
const repairPass = data.repairPassApplied ?? null;
const circleSlotReason = data.circleSlotReason || 'N/A';
const slotSwapReason = data.slotSwapReason || 'N/A';

const md = `# AI Cover Review — Task Run ${runId}

## Metadata
| Field | Value |
|---|---|
| **testRunId** | \`${runId}\` |
| **generatedAt** | ${enriched.generatedAt} |
| **runtimeCommitSha** | \`${commitSha}\` |
| **source** | auto-task |
| **newsTitle** | ${data.newsTitle || 'N/A'} |

## Story Identity
| Field | Value |
|---|---|
| **storyType** | ${storyType} |
| **mainVisualShouldBe** | ${data.mainVisualShouldBe || 'N/A'} |
| **coverageRequired** | ${(data.coverageRequired || []).join(', ')} |
| **coverageOptional** | ${(data.coverageOptional || []).join(', ')} |
| **storyAnchorCandidates** | ${storyAnchors.length} |

## Slot Assignment
| Field | Value |
|---|---|
| **Hero** | #${data.slotAssignment?.heroIndex ?? '?'} — ${heroRole} |
| **Hero Title** | ${heroTitle.slice(0, 80)} |
| **Circle** | #${circleIdx} — ${circleImg.role || '?'} |
| **Circle Title** | ${(circleImg.title || 'N/A').slice(0, 80)} |
| **Circle Slot Reason** | ${circleSlotReason} |
| **Photo Order** | [${photoOrder.join(', ')}] |

## Scores
| Metric | Value |
|---|---|
| **AI Judge** | ${score}/10 |
| **Story Match** | ${storyMatch} |
| **Story Match Reason** | ${storyMatchReason} |
| **Need Manual Review** | ${needManual} |

## Fix 29-32 Diagnostics

### Composition QA (Fix 32)
${compositionQA ? JSON.stringify(compositionQA, null, 2) : '⚠️ Not present in response'}

### Visual Weight Report (Fix 31)
${visualWeight ? JSON.stringify(visualWeight, null, 2) : '⚠️ Not present in response'}

### Per-Slot Crop Mode (Fix 30)
${perSlotCrop ? JSON.stringify(perSlotCrop, null, 2) : '⚠️ Not present in response'}

### Crop Quality (Fix 32)
${cropQual ? JSON.stringify(cropQual, null, 2) : '⚠️ Not present in response'}

### Other
| Field | Value |
|---|---|
| **repairPassApplied** | ${repairPass} |
| **slotSwapReason** | ${slotSwapReason} |
| **circleSlotReason** | ${circleSlotReason} |

## All Candidates
| # | Role | Curator | Score | Title |
|---|---|---|---|---|
${(data.allCandidates || []).map(c => `| ${c.index} | ${c.role} | ${c.curatorScore} | ${c.score} | ${(c.title || '').slice(0, 50)} |`).join('\n')}
`;

const outMd = path.join(reviewDir, `auto-cover-task-${runId}.md`);
fs.writeFileSync(outMd, md, 'utf-8');
console.log(`[PostProcess] Saved: ${outMd}`);
console.log('[PostProcess] Done.');
