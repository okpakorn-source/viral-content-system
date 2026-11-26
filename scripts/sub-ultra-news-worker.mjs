/**
 * =====================================================
 * Sub-Ultra News Queue Worker — ตัวดึงคิวข่าวจาก Supabase มารันด้วย Sub Ultra 100%
 * =====================================================
 * หน้าที่:
 *   1. เฝ้าคิวกลาง Supabase (`store_items` -> `job_queue`) ทุก 3 วินาที
 *   2. เคลมเฉพาะ "งานข่าว" (`jobType !== 'cover' && jobType !== 'mineclip'`) แบบ atomic ผ่าน Postgres conditional update
 *   3. เดินท่อเขียนข่าว Plan 1 (Dual-Sub Masterpiece: Gemini 4 Neon/Argon Sub Ultra × GPT Sub Critic) ค่า API = 0 บาท
 *   4. บันทึกครบทุกตารางเหมือนระบบเดิม 100%:
 *      - `store_items` (`news-studio-runs`, `nsmeta_recent_teachers`, `news-archive`, `job_queue`)
 *      - `generation_logs` (ออกเลขเคส 5 หลัก เพื่อให้ลิงก์ใน Discord เปิดดูผลเต็มได้ทันที)
 *      - `pipeline_logs` และ `api_usage_logs` (`cost_usd: 0`)
 *   5. เปิดพอร์ตตรวจสุขภาพในเครื่อง `127.0.0.1:3955/health` (ใช้เป็น Single-Instance Lock กันรันซ้อนไปในตัว)
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

import { runNewsStudioPlan1, plan1SubUltraModels } from '../src/lib/services/newsStudio/plan1SubUltraPipeline.js';
import { runDiscordStudioJob } from '../src/lib/services/newsStudio/discordCore.js';
import {
  newRunId,
  startedRun,
  finishedRun,
  failedRun,
  RECENT_ROW_ID,
  mergeRecentTeacherIds,
} from '../src/lib/services/newsStudio/runStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function loadEnvFiles() {
  const candidates = [
    'C:\\news-pipeline-dev\\.env.local',
    path.join(ROOT_DIR, '.env.local'),
    path.join(ROOT_DIR, '.env'),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/);
        if (!m) continue;
        const key = m[1];
        const val = m[2].trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    } catch { /* ข้ามไฟล์ที่อ่านไม่ได้ */ }
  }
}

loadEnvFiles();

const SUPABASE_URL = String(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
const POLL_INTERVAL_MS = Math.max(1500, parseInt(process.env.SUB_ULTRA_POLL_MS || '3000', 10) || 3000);
const MAX_CONCURRENCY = Math.max(1, Math.min(4, parseInt(process.env.SUB_ULTRA_NEWS_CONCURRENCY || '2', 10) || 2));
const HEALTH_PORT = parseInt(process.env.SUB_ULTRA_HEALTH_PORT || '3955', 10) || 3955;
const RUN_ONCE = process.argv.includes('--once');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[SubUltraWorker] ❌ ไม่พบ SUPABASE_URL หรือ SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const QUEUE_STORE = 'job_queue';
const RUN_STORE = 'news-studio-runs';
const ARCHIVE_STORE = 'news-archive';

let activeJobs = 0;
let processedCount = 0;
let failedCount = 0;
let shuttingDown = false;
const bootTime = Date.now();

function log(msg) {
  console.log(`[${new Date().toISOString()}] [SubUltraWorker] ${msg}`);
}

function isNewsQueueJob(job) {
  if (!job || typeof job !== 'object') return false;
  const jt = job.payload?.jobType;
  if (jt === 'cover' || jt === 'mineclip') return false;
  // ข้ามคลิปวิดีโอ FB/IG ที่เป็นของตัวถอดคลิปเครื่องทีม
  const fbig = /facebook\.com\/(reel|watch|share\/[rv]\/|video)|fb\.watch\/|instagram\.com\/(reel|reels|tv)\//i;
  const u = String(job.payload?.input || job.payload?.url || '');
  if (fbig.test(u)) return false;
  return true;
}

// ─── Supabase Store Helpers ──────────────────────────────────────

async function storeUpsert(storeName, id, dataObj) {
  const now = new Date().toISOString();
  const { error } = await sb.from('store_items').upsert({
    id,
    store_name: storeName,
    data: dataObj,
    updated_at: now,
  }, { onConflict: 'id,store_name' });
  if (error) {
    // บางตารางใช้ PK บน id เดี่ยว
    const retry = await sb.from('store_items').upsert({
      id,
      store_name: storeName,
      data: dataObj,
      updated_at: now,
    });
    if (retry.error) throw new Error(`storeUpsert(${storeName}/${id}): ${retry.error.message}`);
  }
}

async function storeFindById(storeName, id) {
  const { data, error } = await sb
    .from('store_items')
    .select('data')
    .eq('store_name', storeName)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return data.data || null;
}

async function logApiUsageRow({ provider, model, inputTokens = 0, outputTokens = 0, costUsd = 0, feature = 'newsStudio', userId = null }) {
  try {
    await sb.from('api_usage_logs').insert({
      id: crypto.randomUUID(),
      provider: String(provider || 'sub_ultra'),
      model: String(model || 'unknown'),
      input_tokens: Number(inputTokens) || 0,
      output_tokens: Number(outputTokens) || 0,
      cost_usd: Number(costUsd) || 0,
      feature: String(feature || 'newsStudio').slice(0, 180),
      user_id: userId ? String(userId) : null,
      created_at: new Date().toISOString(),
    });
  } catch { /* ไม่ทำให้งานล้ม */ }
}

async function logPipelineRow({ workflowId, step, status, duration = null, error = null, detail = null, metadata = null, userId = null }) {
  try {
    await sb.from('pipeline_logs').insert({
      id: crypto.randomUUID(),
      workflow_id: String(workflowId || ''),
      step: String(step || 'news-studio'),
      status: String(status || 'started'),
      model: 'sub-ultra-plan1',
      duration_ms: Number.isFinite(duration) ? Math.round(duration) : null,
      error_message: error ? String(error).slice(0, 500) : null,
      detail: detail ? String(detail).slice(0, 240) : null,
      metadata: metadata ? JSON.stringify(metadata) : null,
      user_id: userId ? String(userId) : null,
      created_at: new Date().toISOString(),
    });
  } catch { /* ไม่ทำให้งานล้ม */ }
}

async function getNextCaseNumber() {
  const { data, error } = await sb
    .from('generation_logs')
    .select('case_id')
    .order('case_id', { ascending: false })
    .limit(1);
  if (!error && Array.isArray(data) && data.length > 0) {
    const lastNum = parseInt(data[0].case_id, 10);
    if (Number.isFinite(lastNum)) return String(lastNum + 1).padStart(5, '0');
  }
  return '00001';
}

async function saveGenerationLog({ sourceType = 'plain_text', sourceUrl = '', sourceText = '', newsTitle = '', versions = [], pipelineInfo = {}, contentLength = 'short', userId = null }) {
  try {
    let caseId = await getNextCaseNumber();
    const now = new Date().toISOString();
    const compactVersions = (versions || []).map((v, i) => ({
      index: i,
      style: v.style || v._sourceLabel || `V${i + 1}`,
      title: v.title || '',
      content: v.content || '',
      hook: v.hook || '',
      closing: v.closing || '',
      tone: v.tone || '',
      target: v.target || '',
      wordCount: (v.content || '').split(/\s+/).filter(Boolean).length,
      charCount: (v.content || '').length,
      paraCount: (v.content || '').split('\n\n').filter((p) => p.trim().length > 10).length,
    }));

    const deadline = Date.now() + 25000;
    while (true) {
      const { error } = await sb.from('generation_logs').insert({
        case_id: caseId,
        news_title: newsTitle || 'ไม่มีหัวข้อ',
        source_type: sourceType,
        source_url: sourceUrl || '',
        source_text: String(sourceText || '').slice(0, 5000),
        source_text_length: String(sourceText || '').length,
        version_count: compactVersions.length,
        versions: compactVersions,
        breakdown: null,
        pipeline_info: {
          contentLength,
          totalTime: pipelineInfo.totalTime || 0,
          promptName: pipelineInfo.promptName || 'Plan 1 Sub Ultra (Gemini 4 + GPT)',
          promptSource: pipelineInfo.promptSource || 'news-studio-sub-ultra',
          promptScore: pipelineInfo.promptScore || 0,
          promptMatchType: pipelineInfo.promptMatchType || '',
          promptId: pipelineInfo.promptId || '',
          newsType: pipelineInfo.newsType || '',
          stepTimings: pipelineInfo.stepTimings || {},
          desk: pipelineInfo.desk || null,
        },
        user_id: userId || 'anonymous',
        status: 'unreviewed',
        review_note: null,
        reviewed_at: null,
        created_at: now,
      });
      if (!error) {
        log(`📋 บันทึก Generation Log สำเร็จ Case #${caseId}`);
        return { caseId, success: true };
      }
      const isCollision = /23505|duplicate key|unique/i.test(`${error.code || ''} ${error.message || ''}`);
      if (isCollision && Date.now() < deadline) {
        caseId = await getNextCaseNumber();
        continue;
      }
      log(`⚠️ บันทึก Generation Log ไม่สำเร็จ: ${error.message}`);
      return { caseId: null, success: false, error: error.message };
    }
  } catch (err) {
    log(`⚠️ saveGenerationLog error: ${err.message}`);
    return { caseId: null, success: false, error: err.message };
  }
}

async function saveNewsArchive({ newsData, workflowId, archivedBy }) {
  try {
    if (!newsData?.newsTitle && !newsData?.newsBody) return;
    const now = new Date().toISOString();
    const id = `archive_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const item = {
      id,
      title: newsData.newsTitle || String(newsData.newsBody || '').slice(0, 100) || 'ไม่มีหัวข้อ',
      body: newsData.newsBody || '',
      source_url: '',
      source_type: 'plain_text',
      source_name: archivedBy || 'sub-ultra-worker',
      category: newsData.newsCategory || 'ทั่วไป',
      tags: [],
      summary: newsData.newsTitle || '',
      key_people: [],
      key_places: [],
      viral_score: null,
      word_count: String(newsData.newsBody || '').split(/\s+/).filter(Boolean).length,
      used_count: 0,
      last_used_at: null,
      cover_image: null,
      archived_by: archivedBy || 'sub-ultra-worker',
      archived_at: now,
      workflow_id: workflowId || null,
      createdAt: now,
      updatedAt: now,
    };
    await storeUpsert(ARCHIVE_STORE, id, item);
  } catch (err) {
    log(`⚠️ saveNewsArchive (non-critical): ${err.message}`);
  }
}

// ─── Studio Run Runner (บันทึกคลังประวัติ news-studio-runs ครบเหมือน server.js) ───

const publicModels = (models) =>
  Object.fromEntries(Object.entries(models).map(([role, m]) => [role, { model: m.model, effort: m.effort || '', thinking: !!m.thinking }]));

async function executeStudioJobSubUltra({ rawText, useResearch = false, user, budget }) {
  const id = newRunId();
  const userId = user?.username || 'discord-bot';
  let row = startedRun({
    id,
    rawText,
    useResearch,
    user,
    createdAt: new Date().toISOString(),
    source: 'discord',
  });

  await storeUpsert(RUN_STORE, id, row).catch((e) => log(`⚠️ save initial run failed: ${e.message}`));

  const deps = {
    logUsage: (u) => logApiUsageRow({ ...u, userId }),
    getRecentTeacherIds: async () => {
      const rec = await storeFindById(RUN_STORE, RECENT_ROW_ID);
      return Array.isArray(rec?.ids) ? rec.ids : [];
    },
    rememberTeacherIds: async (ids) => {
      const cur = await storeFindById(RUN_STORE, RECENT_ROW_ID);
      const merged = mergeRecentTeacherIds(cur?.ids, ids);
      await storeUpsert(RUN_STORE, RECENT_ROW_ID, {
        id: RECENT_ROW_ID,
        createdAt: cur?.createdAt || new Date().toISOString(),
        ids: merged,
      });
    },
  };

  const hardMs = Number.isFinite(budget?.hardMs) ? budget.hardMs : 420000;
  const retryDeadlineMs = Number.isFinite(budget?.retryDeadlineMs) ? budget.retryDeadlineMs : 240000;

  let hardTimer;
  try {
    const result = await Promise.race([
      runNewsStudioPlan1({
        rawText,
        useResearch,
        deps,
        retryDeadlineMs,
        rootDir: ROOT_DIR,
        onProgress: (e) => log(`  [${id.slice(0, 12)}] ${e.step}/${e.status}: ${e.detail || ''} (${Math.round((e.ms || 0) / 1000)}s)`),
      }),
      new Promise((_, reject) => {
        hardTimer = setTimeout(() => {
          const err = new Error(`งานใช้เวลาเกิน ${Math.round(hardMs / 1000)} วินาที จึงหยุดงานนี้ — กรุณาส่งใหม่อีกครั้ง`);
          err.errorType = 'NEWS_STUDIO_TIMEOUT';
          reject(err);
        }, hardMs);
      }),
    ]).finally(() => clearTimeout(hardTimer));

    row = finishedRun(row, {
      result,
      models: publicModels(plan1SubUltraModels()),
      finishedAt: new Date().toISOString(),
    });
    await storeUpsert(RUN_STORE, id, row).catch(() => {});
    return row;
  } catch (e) {
    row = failedRun(row, {
      error: e?.message || String(e),
      errorType: e?.errorType || 'SUB_ULTRA_FAILED',
      finishedAt: new Date().toISOString(),
    });
    await storeUpsert(RUN_STORE, id, row).catch(() => {});
    return row;
  }
}

async function attachCaseIdToRun(runId, caseId) {
  if (!runId || !caseId) return false;
  try {
    const cur = await storeFindById(RUN_STORE, runId);
    if (!cur) return false;
    await storeUpsert(RUN_STORE, runId, { ...cur, caseId: String(caseId).slice(0, 20) });
    return true;
  } catch {
    return false;
  }
}

// ─── Queue Atomic Claim & Update ──────────────────────────────────

async function recoverOrphanSubUltraJobsOnBoot() {
  try {
    const { data, error } = await sb
      .from('store_items')
      .select('id, data')
      .eq('store_name', QUEUE_STORE);
    if (error || !Array.isArray(data)) return;

    for (const row of data) {
      const j = row.data;
      if (j && j.status === 'processing' && j._workerKind === 'sub-ultra' && isNewsQueueJob(j)) {
        const next = {
          ...j,
          status: 'pending',
          attemptId: null,
          startedAt: null,
          _workerKind: null,
          updatedAt: new Date().toISOString(),
        };
        await sb
          .from('store_items')
          .update({ data: next, updated_at: next.updatedAt })
          .eq('id', row.id)
          .eq('store_name', QUEUE_STORE)
          .filter('data->>status', 'eq', 'processing');
        log(`🔄 กู้งานข่าวค้างตอนบูต ${row.id} กลับเป็น pending`);
      }
    }
  } catch (e) {
    log(`⚠️ recoverOrphanSubUltraJobsOnBoot: ${e.message}`);
  }
}

let lastCleanupAt = 0;
async function cleanupStaleNewsJobsIfNeeded() {
  if (Date.now() - lastCleanupAt < 60000) return;
  lastCleanupAt = Date.now();
  try {
    const { data, error } = await sb
      .from('store_items')
      .select('id, data')
      .eq('store_name', QUEUE_STORE);
    if (error || !Array.isArray(data)) return;
    const cutoff = Date.now() - 12 * 60 * 1000;
    for (const row of data) {
      const j = row.data;
      if (!j || j.status !== 'processing' || !isNewsQueueJob(j)) continue;
      const started = Date.parse(j.startedAt || j.createdAt || '');
      if (!Number.isFinite(started) || started >= cutoff) continue;

      const now = new Date().toISOString();
      if (!j.retriedOnce) {
        const next = { ...j, status: 'pending', attemptId: null, startedAt: null, retriedOnce: true, updatedAt: now };
        await sb.from('store_items').update({ data: next, updated_at: now }).eq('id', row.id).eq('store_name', QUEUE_STORE).filter('data->>status', 'eq', 'processing');
        log(`♻️ งานข่าวค้างเกิน 12 นาที (${row.id.slice(0, 10)}) -> คืนเข้าคิวลองใหม่`);
      } else {
        const next = { ...j, status: 'failed', error: 'งานค้างเกินเวลา 2 รอบ กรุณาส่งใหม่', errorType: 'QUEUE_STALE_TWICE', failedStep: 'sub_ultra_cleanup', completedAt: now, updatedAt: now };
        await sb.from('store_items').update({ data: next, updated_at: now }).eq('id', row.id).eq('store_name', QUEUE_STORE).filter('data->>status', 'eq', 'processing');
        log(`🧹 ตีตายงานค้างซ้ำรอบสอง (${row.id.slice(0, 10)})`);
      }
    }
  } catch { /* ข้ามรอบหน้า */ }
}

async function claimNextPendingNewsJob() {
  const { data, error } = await sb
    .from('store_items')
    .select('id, data')
    .eq('store_name', QUEUE_STORE);
  if (error || !Array.isArray(data)) return null;

  const candidates = data
    .map((r) => r.data)
    .filter((j) => j && j.status === 'pending' && isNewsQueueJob(j))
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

  for (const cand of candidates) {
    const attemptId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const claimedData = {
      ...cand,
      status: 'processing',
      attemptId,
      startedAt,
      updatedAt: startedAt,
      _workerKind: 'sub-ultra',
    };
    const { data: updated, error: claimErr } = await sb
      .from('store_items')
      .update({ data: claimedData, updated_at: startedAt })
      .eq('id', cand.id)
      .eq('store_name', QUEUE_STORE)
      .filter('data->>status', 'eq', 'pending')
      .select('data');
    if (!claimErr && Array.isArray(updated) && updated.length > 0) {
      return updated[0].data;
    }
  }
  return null;
}

async function updateClaimedJob(jobId, expectedAttemptId, status, extraData) {
  const { data: curRow, error: readErr } = await sb
    .from('store_items')
    .select('data')
    .eq('id', jobId)
    .eq('store_name', QUEUE_STORE)
    .single();
  if (readErr || !curRow?.data) throw new Error(`อ่านงาน ${jobId} ไม่สำเร็จ`);
  const cur = curRow.data;
  if (cur.status !== 'processing' || cur.attemptId !== expectedAttemptId) {
    log(`⏭️ ข้ามการอัปเดต ${jobId.slice(0, 10)} (สถานะเปลี่ยนไปแล้วเป็น ${cur.status})`);
    return null;
  }
  const updatedAt = new Date().toISOString();
  const next = { ...cur, status, ...extraData, updatedAt };
  const { error } = await sb
    .from('store_items')
    .update({ data: next, updated_at: updatedAt })
    .eq('id', jobId)
    .eq('store_name', QUEUE_STORE)
    .filter('data->>status', 'eq', 'processing')
    .filter('data->>attemptId', 'eq', expectedAttemptId);
  if (error) throw new Error(`บันทึกสถานะงาน ${jobId} ไม่สำเร็จ: ${error.message}`);
  return next;
}

// ─── Process 1 Claimed News Job ───────────────────────────────────

async function processClaimedNewsJob(job) {
  const startTime = Date.now();
  const payload = job.payload || {};
  const rawInput = String(payload.input || payload.text || '').trim();
  const userId = String(payload.userId || job.userId || 'discord-bot');
  const workflowId = payload.workflowId || `subultra_${Date.now()}`;

  log(`▶️ เริ่มเขียนข่าว job=${job.id} user=${userId} len=${rawInput.length}`);
  await logPipelineRow({ workflowId, step: 'unified-auto', status: 'started', detail: rawInput.slice(0, 80), userId });

  try {
    const studioOut = await runDiscordStudioJob(
      {
        text: rawInput,
        user: { userId, userName: userId },
        workflowId,
        deskMeta: payload.deskMeta || null,
      },
      {
        runStudioJob: executeStudioJobSubUltra,
        logGeneration: saveGenerationLog,
        attachCaseId: attachCaseIdToRun,
        logPipeline: logPipelineRow,
        useResearch: false,
      }
    );

    const legacyData = studioOut.data || {};
    const versions = legacyData.analysisResult?.versions || [];
    const analysisResult = {
      ...(legacyData.analysisResult || {}),
      versions,
      usedPreset: legacyData.usedPromptInfo || { name: 'Plan 1 Sub Ultra' },
      totalVersions: versions.length,
      pipeline: 'article_pipeline_enhanced',
    };

    await saveNewsArchive({
      newsData: legacyData.newsData,
      workflowId,
      archivedBy: userId,
    });

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    const fullResult = {
      success: true,
      archiveSaved: true,
      data: { ...legacyData, versions, analysisResult },
      newsData: legacyData.newsData,
      breakdownData: null,
      analysisResult,
      factPool: null,
      detection: {
        inputType: 'plain_text',
        platform: 'text',
        label: 'ข้อความข่าว',
        confidence: 1,
        pipelineUsed: 'plan1_sub_ultra',
        pipelineLabel: 'Plan 1 Sub Ultra (Gemini 4 + GPT)',
        pipelineIcon: '⚡',
        provider: 'sub-ultra',
        fallbacksUsed: [],
      },
      normalized: {
        title: legacyData.newsData?.newsTitle || '',
        language: 'th',
        category: legacyData.newsData?.newsCategory || 'general',
        keywords: [],
        entities: [],
        imageCount: 0,
        confidence: 1,
      },
      debug: {
        log: legacyData.log || [],
        durationSeconds: parseFloat(elapsedSec),
        fallbacksUsed: [],
        pipelineId: 'plan1_sub_ultra',
      },
    };

    await updateClaimedJob(job.id, job.attemptId, 'completed', {
      result: fullResult,
      completedAt: new Date().toISOString(),
    });
    processedCount++;
    log(`✅ สำเร็จ job=${job.id} (${versions.length} เวอร์ชัน · ${elapsedSec}s · Case #${legacyData.generationLog?.caseId || '-'})`);
  } catch (err) {
    failedCount++;
    const errMsg = String(err?.message || err || 'ประมวลผลข่าวไม่สำเร็จ');
    log(`❌ ล้มเหลว job=${job.id}: ${errMsg}`);
    await updateClaimedJob(job.id, job.attemptId, 'failed', {
      error: errMsg,
      errorType: err?.errorType || 'SUB_ULTRA_WORKER_ERROR',
      failedStep: err?.failedStep || 'sub_ultra_worker',
      completedAt: new Date().toISOString(),
    }).catch((uErr) => log(`⚠️ อัปเดตสถานะ failed ไม่สำเร็จ: ${uErr.message}`));
  }
}

// ─── Main Poll Loop & Single-Instance Health Server ───────────────

async function startHealthServer() {
  if (RUN_ONCE) return null;
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          ok: true,
          service: 'sub-ultra-news-worker',
          pid: process.pid,
          activeJobs,
          maxConcurrency: MAX_CONCURRENCY,
          processedCount,
          failedCount,
          uptimeSec: Math.round((Date.now() - bootTime) / 1000),
        }));
        return;
      }
      res.writeHead(404);
      res.end('Not Found');
    });
    srv.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        log(`🛑 พอร์ต ${HEALTH_PORT} ถูกใช้งานอยู่แล้ว (มี Sub-Ultra Worker รันอยู่แล้ว) — ปิดตัวซ้ำอัตโนมัติ`);
        process.exit(0);
      }
      log(`⚠️ Health server error: ${err.message}`);
      resolve(null);
    });
    srv.listen(HEALTH_PORT, '127.0.0.1', () => {
      log(`🟢 Sub-Ultra News Worker พร้อมทำงาน! (Health: http://127.0.0.1:${HEALTH_PORT}/health | Concurrency=${MAX_CONCURRENCY} | Poll=${POLL_INTERVAL_MS}ms)`);
      resolve(srv);
    });
  });
}

async function pollLoop() {
  await startHealthServer();
  await recoverOrphanSubUltraJobsOnBoot();

  while (!shuttingDown) {
    try {
      await cleanupStaleNewsJobsIfNeeded();

      while (activeJobs < MAX_CONCURRENCY && !shuttingDown) {
        const job = await claimNextPendingNewsJob();
        if (!job) break;

        activeJobs++;
        processClaimedNewsJob(job)
          .catch((e) => log(`⚠️ Uncaught job error: ${e.message}`))
          .finally(() => { activeJobs--; });
      }

      if (RUN_ONCE && activeJobs === 0) {
        log('🏁 โหมด --once ทำงานครบแล้ว จบโปรเซส');
        break;
      }
    } catch (loopErr) {
      log(`⚠️ Poll loop error: ${loopErr.message}`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    shuttingDown = true;
    log(`🛑 ได้รับสัญญาณ ${sig} — หยุดรับงานใหม่ รองานที่ค้าง (${activeJobs}) จบ...`);
    const checkExit = setInterval(() => {
      if (activeJobs <= 0) {
        clearInterval(checkExit);
        process.exit(0);
      }
    }, 500);
    setTimeout(() => process.exit(0), 60000).unref();
  });
}

pollLoop().catch((err) => {
  console.error('[SubUltraWorker] Fatal:', err);
  process.exit(1);
});
