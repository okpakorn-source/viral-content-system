// ============================================================
// 🧪 MEGA Cover Ref Tester — shadow root-cause agent
// ------------------------------------------------------------
// วิเคราะห์อย่างเดียวหลังปกสุดท้ายถูกล็อก: ปกจริง + ref + ภาพต้นฉบับที่ลงแต่ละ slot
// ห้ามแก้ assignment/crop/layout/buffer/QC ของงานหลักเด็ดขาด
// kill switch: MEGA_COVER_TESTER=0
// ============================================================

import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { callAI } from '@/lib/ai/openai';
import { MODEL_FINAL_QA } from '@/lib/ai/modelConfig';
import { createStore } from '@/lib/persistStore';

const TESTER_VERSION = 'cover-ref-tester-v1';
const REPORT_STORE = createStore('mega-cover-test-reports');
const MAX_REPORTS = 500;
const MAX_ISSUES = 8;
const AI_TIMEOUT_MS = 90000;
const STAGES = new Set([
  'candidate_selection',
  'slot_mapping',
  'crop',
  'ref_geometry',
  'render_quality',
  'identity',
  'insufficient_evidence',
]);
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);

const cleanText = (value, max = 240) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const clampScore = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;
};
const clampConfidence = (value, fallback = 0.5) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, Math.round(n * 100) / 100)) : fallback;
};
const sha1 = (buffer) => crypto.createHash('sha1').update(buffer).digest('hex');
const xml = (value) => cleanText(value, 100)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

async function readRefBuffer(refImagePath) {
  const ref = String(refImagePath || '').trim();
  if (!ref) return null;
  if (/^https?:\/\//i.test(ref)) {
    const response = await fetch(ref, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`REF_HTTP_${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  if (/^data:image\/\w+;base64,/i.test(ref)) {
    return Buffer.from(ref.replace(/^data:image\/\w+;base64,/i, ''), 'base64');
  }
  const publicRoot = path.resolve(process.cwd(), 'public');
  const filePath = path.resolve(publicRoot, ref.replace(/^[/\\]+/, ''));
  if (!filePath.startsWith(publicRoot + path.sep)) throw new Error('REF_PATH_OUTSIDE_PUBLIC');
  return fs.readFile(filePath);
}

function sourceMeta(assignments = [], loaded = []) {
  return assignments.slice(0, 8).map((assignment) => {
    const image = loaded[assignment.imageIndex] || {};
    return {
      slot: cleanText(assignment.slotId, 40),
      candidateId: cleanText(image.candidateId || image.id || '', 60) || null,
      plannedRole: cleanText(image.slot || '', 30) || null,
      person: cleanText(image.person || '', 80) || null,
      category: cleanText(image.category || '', 40) || null,
      note: cleanText(image.note || '', 120) || null,
      inputFaceH: Number.isFinite(Number(image.faceBox?.h))
        ? Math.round(Number(image.faceBox.h) * 1000) / 1000
        : null,
      clean: image.clean !== false,
      newsScene: image.newsScene !== false,
    };
  });
}

async function buildSourceSheet(assignments = [], loaded = []) {
  const chosen = assignments.slice(0, 6)
    .map((assignment) => ({ assignment, image: loaded[assignment.imageIndex] }))
    .filter((item) => item.image?.buffer);
  if (!chosen.length) return null;

  const tileW = 420;
  const photoH = 260;
  const labelH = 70;
  const tileH = photoH + labelH;
  const tiles = await Promise.all(chosen.map(async ({ assignment, image }) => {
    const photo = await sharp(image.buffer)
      .resize(tileW, photoH, { fit: 'contain', background: { r: 20, g: 24, b: 33 } })
      .png()
      .toBuffer();
    const candidate = image.candidateId || image.id || String(image.url || '').split('/').pop()?.slice(0, 28) || '-';
    const line1 = `${assignment.slotId} | ${candidate}`;
    const line2 = `${image.category || '-'} | ${image.person || '-'} | ${cleanText(image.note, 38) || '-'}`;
    const label = Buffer.from(
      `<svg width="${tileW}" height="${labelH}">
        <rect width="100%" height="100%" fill="#111827"/>
        <text x="12" y="27" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#F9FAFB">${xml(line1)}</text>
        <text x="12" y="53" font-family="Arial, sans-serif" font-size="15" fill="#CBD5E1">${xml(line2)}</text>
      </svg>`
    );
    return sharp({
      create: { width: tileW, height: tileH, channels: 3, background: '#111827' },
    }).composite([{ input: photo, top: 0, left: 0 }, { input: label, top: photoH, left: 0 }]).jpeg({ quality: 86 }).toBuffer();
  }));

  const cols = Math.min(2, tiles.length);
  const rows = Math.ceil(tiles.length / cols);
  return sharp({
    create: { width: cols * tileW, height: rows * tileH, channels: 3, background: '#0B1220' },
  }).composite(tiles.map((input, index) => ({
    input,
    left: (index % cols) * tileW,
    top: Math.floor(index / cols) * tileH,
  }))).jpeg({ quality: 86 }).toBuffer();
}

function refHeroShot(refDNA) {
  const slots = refDNA?.template?.slots || refDNA?.slots || [];
  const hero = slots.find((slot) => /hero|main/i.test(String(slot?.role || slot?.id || '')));
  return cleanText(hero?.shot || refDNA?.layout?.hero?.shot || '', 30).toLowerCase() || null;
}

function issue({ slot = null, stage, code, severity = 'medium', confidence = 0.6, summary, evidence = [], recommendedAction = '' }) {
  return {
    slot: slot ? cleanText(slot, 40) : null,
    stage: STAGES.has(stage) ? stage : 'insufficient_evidence',
    code: cleanText(code || 'UNKNOWN', 60).toUpperCase().replace(/[^A-Z0-9_:-]/g, '_'),
    severity: SEVERITIES.has(severity) ? severity : 'medium',
    confidence: clampConfidence(confidence),
    summary: cleanText(summary, 220),
    evidence: (Array.isArray(evidence) ? evidence : [evidence]).map((x) => cleanText(x, 220)).filter(Boolean).slice(0, 5),
    recommendedAction: cleanText(recommendedAction, 220),
  };
}

function deterministicEvidence({ refDNA, manifest, qcFlags = [], eye, assignments = [], loaded = [], cropTrace = [] }) {
  const issues = [];
  const sources = sourceMeta(assignments, loaded);
  const heroSource = sources.find((item) => /main|hero/i.test(String(item.slot))) || sources.find((item) => item.plannedRole === 'hero') || null;
  const expectedHeroShot = refHeroShot(refDNA);
  const eyeChecks = eye?.checks && typeof eye.checks === 'object' ? { ...eye.checks } : null;
  const flags = (Array.isArray(qcFlags) ? qcFlags : []).map(String);
  const heroTrace = cropTrace.find((trace) => /main|hero/i.test(String(trace?.slot))) || null;

  if (eyeChecks?.grid === false || eyeChecks?.inserts === false) {
    issues.push(issue({
      stage: 'ref_geometry',
      code: 'REF_GEOMETRY_MISMATCH',
      severity: 'high',
      confidence: 0.82,
      summary: 'ผังช่องหรือ inset ของผลลัพธ์ไม่ตรงกับ ref',
      evidence: [
        eyeChecks.grid === false ? 'Eye: grid=false' : '',
        eyeChecks.inserts === false ? 'Eye: inserts=false' : '',
      ],
      recommendedAction: 'ตรวจ ref template geometry และ z-index ก่อนเปลี่ยนภาพหรือ crop',
    }));
  }

  if (eyeChecks?.hero_shot === false) {
    const sourceLooksWide = heroSource && (
      heroSource.category === 'context'
      || (heroSource.inputFaceH != null && heroSource.inputFaceH < 0.18)
    );
    issues.push(issue({
      slot: heroSource?.slot || 'main',
      stage: sourceLooksWide ? 'candidate_selection' : 'crop',
      code: sourceLooksWide ? 'HERO_SOURCE_NOT_CLOSEUP' : 'HERO_CROP_NOT_CLOSEUP',
      severity: 'high',
      confidence: sourceLooksWide ? 0.86 : 0.75,
      summary: sourceLooksWide
        ? 'ภาพต้นฉบับ Hero เป็นภาพบริบท/หน้าเล็ก จึงทำ close-up ตาม ref ได้ยาก'
        : 'ภาพ Hero อาจใช้ได้ แต่ผลครอปยังไม่ถึงระยะ close-up ของ ref',
      evidence: [
        'Eye: hero_shot=false',
        expectedHeroShot ? `ref hero shot=${expectedHeroShot}` : '',
        heroSource?.category ? `source category=${heroSource.category}` : '',
        heroSource?.inputFaceH != null ? `input face height=${heroSource.inputFaceH}` : '',
        heroTrace?.branch ? `crop branch=${heroTrace.branch}` : '',
      ],
      recommendedAction: sourceLooksWide
        ? 'เลือกภาพต้นฉบับหน้าเดี่ยวชัด/ไม่ถูกบัง แล้วค่อยครอป'
        : 'ใช้ visual face anchor ครอปใหม่และตรวจผลจริงเทียบ ref',
    }));
  }

  for (const flag of flags) {
    let match = /^(?:upscaled|upscale_soft|upscaled_src):([^:]+):([\d.]+)/.exec(flag);
    if (match) {
      issues.push(issue({
        slot: match[1],
        stage: 'render_quality',
        code: 'SOURCE_UPSCALED',
        severity: /main|hero/i.test(match[1]) ? 'high' : 'medium',
        confidence: 0.98,
        summary: `ภาพถูกยืด ${match[2]}x ทำให้ความคมลดลง`,
        evidence: [flag],
        recommendedAction: 'ใช้ภาพต้นฉบับความละเอียดสูงขึ้นหรือเลือก candidate ที่ต้องยืดน้อยกว่า',
      }));
      continue;
    }
    match = /^(?:blind_crop|blank_image|person_cut):?([^:]*)/.exec(flag);
    if (match) {
      const code = flag.startsWith('blind') ? 'BLIND_CROP' : flag.startsWith('blank') ? 'BLANK_IMAGE' : 'PERSON_CUT';
      issues.push(issue({
        slot: match[1] || null,
        stage: flag.startsWith('blank') ? 'render_quality' : 'crop',
        code,
        severity: 'high',
        confidence: 0.98,
        summary: flag.startsWith('blank') ? 'ช่องมีภาพเปล่าหรือเกือบสีเดียว' : flag.startsWith('blind') ? 'ระบบครอปโดยไม่มี face/subject anchor' : 'คนถูกขอบเฟรมตัด',
        evidence: [flag],
        recommendedAction: flag.startsWith('blank') ? 'เปลี่ยน candidate ของช่องนี้' : 'ตรวจ source anchor และครอปผลจริงใหม่',
      }));
    } else if (flag === 'hero_profile_forced') {
      issues.push(issue({
        slot: 'main',
        stage: 'candidate_selection',
        code: 'HERO_PROFILE_FORCED',
        severity: 'high',
        confidence: 0.99,
        summary: 'Hero ถูกบังคับใช้ภาพมุมข้าง/หลังเพราะไม่มีตัวเลือกที่เหมาะกว่า',
        evidence: [flag],
        recommendedAction: 'ค้นหรือเลือกภาพหน้าตรง/สามส่วนสี่ของตัวเอก',
      }));
    }
  }

  const unique = [];
  const seen = new Set();
  for (const item of issues) {
    const key = `${item.stage}|${item.code}|${item.slot || ''}`;
    if (!seen.has(key)) { seen.add(key); unique.push(item); }
  }
  return {
    expectedHeroShot,
    eyeChecks,
    eyeDiffs: (eye?.diffs || []).map((x) => cleanText(x, 180)).slice(0, 5),
    qcFlags: flags.slice(0, 30),
    template: cleanText(manifest?.composerVersion || '', 60) || null,
    sources,
    cropBranches: cropTrace.slice(0, 8).map((trace) => ({
      slot: cleanText(trace?.slot, 40),
      branch: cleanText(trace?.branch, 50),
      upscale: Number.isFinite(Number(trace?.upscale)) ? Number(trace.upscale) : null,
      region: trace?.region || null,
    })),
    issues: unique.slice(0, MAX_ISSUES),
  };
}

function normalizeAiIssue(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return issue({
    slot: raw.slot,
    stage: raw.stage,
    code: raw.code,
    severity: raw.severity,
    confidence: raw.confidence,
    summary: raw.summary,
    evidence: raw.evidence,
    recommendedAction: raw.recommendedAction,
  });
}

function normalizeAiReport(raw, deterministic) {
  const aiIssues = (Array.isArray(raw?.issues) ? raw.issues : []).map(normalizeAiIssue).filter(Boolean).slice(0, MAX_ISSUES);
  const combined = [...aiIssues];
  const seen = new Set(combined.map((item) => `${item.stage}|${item.code}|${item.slot || ''}`));
  for (const item of deterministic.issues) {
    const key = `${item.stage}|${item.code}|${item.slot || ''}`;
    if (!seen.has(key) && combined.length < MAX_ISSUES) { seen.add(key); combined.push(item); }
  }
  const rawPrimary = raw?.primaryCause && typeof raw.primaryCause === 'object' ? raw.primaryCause : combined[0] || null;
  const primary = rawPrimary ? issue({
    slot: rawPrimary.slot,
    stage: rawPrimary.stage,
    code: rawPrimary.code,
    severity: rawPrimary.severity || combined[0]?.severity,
    confidence: rawPrimary.confidence,
    summary: rawPrimary.summary,
    evidence: rawPrimary.evidence,
    recommendedAction: rawPrimary.recommendedAction,
  }) : issue({
    stage: 'insufficient_evidence',
    code: 'NO_CONFIRMED_MISMATCH',
    severity: 'low',
    confidence: 0.45,
    summary: 'ยังไม่มีหลักฐานพอระบุสาเหตุที่ไม่ตรง ref',
    evidence: [],
    recommendedAction: 'ตรวจภาพจริงและ metadata เพิ่ม',
  });
  const rawStatus = String(raw?.status || '').toLowerCase();
  const status = ['pass', 'mismatch', 'inconclusive'].includes(rawStatus)
    ? rawStatus
    : (combined.length ? 'mismatch' : 'inconclusive');
  return {
    status,
    score: clampScore(raw?.score, status === 'pass' ? 100 : 0),
    primaryCause: primary,
    issues: combined,
    comparisons: {
      grid: cleanText(raw?.comparisons?.grid, 120) || null,
      inserts: cleanText(raw?.comparisons?.inserts, 120) || null,
      heroShot: cleanText(raw?.comparisons?.heroShot, 120) || null,
      subShots: cleanText(raw?.comparisons?.subShots, 120) || null,
      crops: cleanText(raw?.comparisons?.crops, 120) || null,
    },
  };
}

async function analyzeWithVision({ coverBuffer, refBuffer, sourceSheet, deterministic, newsTitle }) {
  const cover = await sharp(coverBuffer).resize(900, 1125, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer();
  const ref = await sharp(refBuffer).resize(900, 1125, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer();
  const prompt = `คุณคือ Cover Ref Tester อิสระ ตรวจหาสาเหตุรากของปกที่ยังไม่ตรง ref
ภาพที่ 1 = ปกผลลัพธ์สุดท้าย
ภาพที่ 2 = ref เป้าหมาย (คนละข่าวกัน จึงห้ามหักเพราะเป็นคน/สี/ข้อความคนละชุด)
ภาพที่ 3 (ถ้ามี) = contact sheet ของภาพต้นฉบับที่ถูกใช้จริง แต่ละช่องมี label slot/candidate/category/person
ข่าว: ${cleanText(newsTitle, 120) || '-'}

หลักฐานจากระบบ:
${JSON.stringify(deterministic)}

หน้าที่:
1) เทียบเฉพาะโครง, inset, ระยะช็อต, ความเด่นของหน้า, crop, identity/role และคุณภาพ render
2) แยก root cause ให้ถูกชั้น:
- candidate_selection = ภาพต้นฉบับไม่เหมาะตั้งแต่แรก เช่น full-body, หน้าถูกบัง, profile, ภาพบริบท
- slot_mapping = ภาพเหมาะแต่ถูกใส่ผิดบท/ผิดช่อง
- crop = ต้นฉบับใช้ได้แต่กรอบครอป/face anchor ผิด
- ref_geometry = จำนวน/ตำแหน่ง/ขนาดช่องหรือวงกลมไม่ตรง
- render_quality = เบลอ ยืด ภาพว่าง คนขาด
- identity = ผิดตัวละคร
- insufficient_evidence = หลักฐานไม่พอจริงๆ เท่านั้น
3) ถ้า Hero ต้นฉบับเป็น full-body/context และหน้าถูกบัง แม้ซูมได้ ให้ candidate_selection เป็นสาเหตุหลัก; crop เป็นผลตามมา
4) ห้ามเสนอให้ AI สร้างภาพใหม่ ให้เสนอค้น/เลือก/แมป/ครอป/แก้ geometry แบบ deterministic เท่านั้น

ตอบ JSON เท่านั้น:
{"status":"pass|mismatch|inconclusive","score":0-100,"primaryCause":{"slot":"main|null","stage":"candidate_selection|slot_mapping|crop|ref_geometry|render_quality|identity|insufficient_evidence","code":"UPPER_SNAKE_CASE","severity":"critical|high|medium|low","confidence":0-1,"summary":"สรุปตรงๆ","evidence":["หลักฐาน"],"recommendedAction":"วิธีแก้ตรงชั้น"},"issues":[{"slot":"ชื่อช่อง|null","stage":"...","code":"...","severity":"...","confidence":0-1,"summary":"...","evidence":["..."],"recommendedAction":"..."}],"comparisons":{"grid":"...","inserts":"...","heroShot":"...","subShots":"...","crops":"..."}}`;
  const imageContents = [
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${cover.toString('base64')}`, detail: 'high' } },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${ref.toString('base64')}`, detail: 'high' } },
  ];
  if (sourceSheet) {
    imageContents.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${sourceSheet.toString('base64')}`, detail: 'high' } });
  }
  const aiCall = callAI({
    systemPrompt: 'คุณเป็นระบบ QA ปกข่าวแบบเข้มงวด วิเคราะห์จากภาพและหลักฐานที่ให้เท่านั้น ตอบ JSON ตาม schema เท่านั้น ห้ามแต่งข้อมูล',
    prompt,
    imageContents,
    model: MODEL_FINAL_QA,
    temperature: 0,
    maxTokens: 6000,
  });
  return Promise.race([
    aiCall,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`TESTER_TIMEOUT_${AI_TIMEOUT_MS}`)), AI_TIMEOUT_MS)),
  ]);
}

async function pruneReports() {
  if (await REPORT_STORE.count() <= MAX_REPORTS) return;
  const all = (await REPORT_STORE.getAll()).slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  for (const old of all.slice(MAX_REPORTS, MAX_REPORTS + 20)) {
    try { await REPORT_STORE.remove(old.id); } catch { /* prune ไม่กระทบ Tester */ }
  }
}

async function persistReport(report) {
  const record = {
    ...report,
    execution: { ...report.execution, persisted: true },
    persistedAt: new Date().toISOString(),
  };
  try {
    const existing = await REPORT_STORE.findById(record.id);
    if (existing) await REPORT_STORE.update(record.id, record);
    else await REPORT_STORE.add(record);
    pruneReports().catch(() => {});
    return record;
  } catch (firstError) {
    try {
      await REPORT_STORE.update(record.id, record);
      return record;
    } catch {
      return {
        ...report,
        execution: {
          ...report.execution,
          persisted: false,
          persistError: cleanText(firstError?.message, 120),
        },
      };
    }
  }
}

export async function runCoverRefTester({
  coverBuffer,
  refImagePath,
  refDNA = null,
  manifest = null,
  qcFlags = [],
  eye = null,
  assignments = [],
  loaded = [],
  cropTrace = [],
  newsTitle = '',
} = {}) {
  const started = Date.now();
  if (process.env.MEGA_COVER_TESTER === '0') {
    return {
      v: 1,
      testerVersion: TESTER_VERSION,
      status: 'disabled',
      score: null,
      primaryCause: null,
      issues: [],
      execution: { mode: 'disabled', model: null, durationMs: 0, persisted: false },
    };
  }
  if (!Buffer.isBuffer(coverBuffer) || !coverBuffer.length || !refImagePath) {
    return {
      v: 1,
      testerVersion: TESTER_VERSION,
      status: 'inconclusive',
      score: 0,
      primaryCause: issue({
        stage: 'insufficient_evidence',
        code: 'MISSING_COVER_OR_REF',
        severity: 'low',
        confidence: 1,
        summary: 'ไม่มีปกผลลัพธ์หรือ ref สำหรับทดสอบ',
        recommendedAction: 'ส่ง coverBuffer และ refImagePath ให้ครบ',
      }),
      issues: [],
      execution: { mode: 'deterministic_fallback', model: null, durationMs: Date.now() - started, persisted: false },
    };
  }

  const outputHash = manifest?.outputHash || sha1(coverBuffer);
  const deterministic = deterministicEvidence({ refDNA, manifest, qcFlags, eye, assignments, loaded, cropTrace });
  let refBuffer = null;
  let sourceSheet = null;
  let normalized = null;
  let mode = 'vision';
  let model = null;
  let visionError = null;

  try {
    [refBuffer, sourceSheet] = await Promise.all([
      readRefBuffer(refImagePath),
      buildSourceSheet(assignments, loaded).catch(() => null),
    ]);
    const raw = await analyzeWithVision({ coverBuffer, refBuffer, sourceSheet, deterministic, newsTitle });
    model = raw?._modelUsed || MODEL_FINAL_QA;
    normalized = normalizeAiReport(raw, deterministic);
  } catch (error) {
    mode = 'deterministic_fallback';
    visionError = cleanText(error?.message, 160);
    normalized = normalizeAiReport({
      status: deterministic.issues.length ? 'mismatch' : 'inconclusive',
      score: 0,
      primaryCause: deterministic.issues[0] || null,
      issues: deterministic.issues,
    }, deterministic);
  }

  const report = {
    id: `MCTR-${outputHash}`,
    v: 1,
    testerVersion: TESTER_VERSION,
    createdAt: new Date().toISOString(),
    outputHash,
    refHash: refBuffer ? sha1(refBuffer) : null,
    refImagePath: cleanText(refImagePath, 240),
    status: normalized.status,
    score: normalized.score,
    primaryCause: normalized.primaryCause,
    issues: normalized.issues,
    comparisons: normalized.comparisons,
    evidence: {
      expectedHeroShot: deterministic.expectedHeroShot,
      eyeChecks: deterministic.eyeChecks,
      eyeDiffs: deterministic.eyeDiffs,
      qcFlags: deterministic.qcFlags,
      sources: deterministic.sources,
      cropBranches: deterministic.cropBranches,
    },
    execution: {
      mode,
      model,
      timeoutMs: AI_TIMEOUT_MS,
      durationMs: Date.now() - started,
      persisted: false,
      ...(visionError ? { visionError } : {}),
    },
  };
  return persistReport(report);
}

export default runCoverRefTester;
