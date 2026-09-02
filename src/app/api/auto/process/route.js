/**
 * POST /api/auto/process
 * ─────────────────────────────────────────────────────
 * Universal Auto Processor — รัน pipeline จาก detection result
 *
 * Body: {
 *   input: string,         — raw input (URL / text)
 *   images: string[],      — base64 images
 *   detection: object,     — accepted for backward compatibility but recomputed server-side
 *   route: object,         — accepted for backward compatibility but recomputed server-side
 *   contentLength: string, — 'short'|'medium'|'long'
 *   preset: string,        — style preset
 * }
 *
 * Returns: same as /api/auto (backward compatible)
 */
export const maxDuration = 800; // Allow ~13 min for heavy LLM pipeline (pipeline can take 300-480s+)
import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { detectInputType } from '@/lib/input-engine/detector';
import { routePipeline }   from '@/lib/input-engine/router';
import { normalizeToSchema } from '@/lib/input-engine/normalizer';
import { scrapeArticle }   from '@/lib/providers/firecrawlProvider';
import { scrapeTikTok, scrapeFacebook } from '@/lib/providers/apifyProvider';
import { getYouTubeData }  from '@/lib/providers/youtubeProvider';
import { logPipeline }     from '@/lib/pipelineLogger';
import { bbSaveTrace }     from '@/lib/trace/blackbox'; // ★ 1 ส.ค. 69 กล่องดำ workflow — สืบย้อนหลังได้ไม่ต้องเดา
import { logGeneration }   from '@/lib/services/generationLogger';
import { createLogger }    from '@/lib/logger';

// Direct Service Imports
import { processAutoFlow } from '@/lib/services/autoFlowService';
import { processAutoFlowText } from '@/lib/services/autoFlowServiceText';
import { performOcr }      from '@/lib/services/ocrService';
import { performSummarize } from '@/lib/services/summarizeService';
import { withTimeout }     from '@/lib/utils/withTimeout';
import { saveNewsArchive } from '@/lib/services/newsArchiveService';
import { ensureWorkflow } from '@/lib/workflow/workflowEngine';
import { isSupabaseReady } from '@/lib/supabase';
import {
  createPipelineDeadline,
  getActivePipelineDeadline,
  isPipelineDeadlineError,
  resolvePipelineDeadlineAt,
  runWithPipelineDeadline,
} from '@/lib/utils/pipelineDeadline';

const rlog = createLogger('AUTO-PROCESS');
export const runtime = 'nodejs';
const NEWS_ROUTE_BUDGET_MS = 700_000;
const DEADLINE_QUEUE_REPORT_MS = 20_000;

// ผลเขียนแต่ละเวอร์ชันต้องบอกโมเดลจากฝั่งโค้ดของ writer เอง
// ห้ามซ่อมจากค่า aggregate เพราะงานหลายมุมอาจใช้คนละโมเดลและจะตรวจย้อนหลังผิดตัว
export function validateVersionWriterProvenance(versions, analysisResult = {}) {
  if (!Array.isArray(versions) || versions.length === 0) {
    return { ok: false, error: 'ไม่มีเวอร์ชันข่าวให้ตรวจ', models: [] };
  }

  const versionModels = versions.map(version => (
    typeof version?.usedModel === 'string' ? version.usedModel.trim() : ''
  ));
  const missingIndex = versionModels.findIndex(model => !model);
  if (missingIndex >= 0) {
    return { ok: false, error: `version ${missingIndex + 1} ไม่มี usedModel`, models: [] };
  }

  const models = [...new Set(versionModels)];
  const declaredModels = Array.isArray(analysisResult?.usedModels)
    ? [...new Set(analysisResult.usedModels
      .map(model => (typeof model === 'string' ? model.trim() : ''))
      .filter(Boolean))]
    : [];
  if (declaredModels.length !== models.length
      || models.some(model => !declaredModels.includes(model))) {
    return { ok: false, error: 'usedModels ระดับผลรวมไม่ตรงกับรายเวอร์ชัน', models };
  }

  const expectedAggregate = models.length === 1 ? models[0] : 'mixed';
  const aggregate = typeof analysisResult?.usedModel === 'string'
    ? analysisResult.usedModel.trim()
    : '';
  if (aggregate !== expectedAggregate) {
    return { ok: false, error: `usedModel ระดับผลรวมควรเป็น ${expectedAggregate}`, models };
  }

  return { ok: true, error: '', models, aggregateModel: expectedAggregate };
}

export function prepareEnhancedAnalysisResult(legacyData = {}) {
  const versions = legacyData?.analysisResult?.versions;
  if (!Array.isArray(versions) || versions.length === 0) {
    return {
      ok: false,
      error: 'Enhanced pipeline แจ้งว่าสำเร็จแต่ไม่มีเวอร์ชันข่าว',
      errorType: 'ANALYSIS_RESULT_MISSING',
    };
  }

  const provenance = validateVersionWriterProvenance(versions, legacyData.analysisResult);
  if (!provenance.ok) {
    return {
      ok: false,
      error: `ผลเขียนขาดหลักฐานโมเดลรายเวอร์ชัน: ${provenance.error}`,
      errorType: 'VERSION_PROVENANCE_MISSING',
    };
  }

  return {
    ok: true,
    versions,
    analysisResult: {
      ...(legacyData.analysisResult || {}),
      versions,
      usedModel: provenance.aggregateModel,
      usedModels: provenance.models,
      usedPreset: legacyData.usedPromptInfo || { name: 'Enhanced Auto' },
      totalVersions: versions.length,
      pipeline: 'article_pipeline_enhanced',
    },
  };
}

export function compactDelegatedVersions(versions) {
  return versions.map((version) => {
    const writerModel = typeof version?.usedModel === 'string' ? version.usedModel.trim() : '';
    const { _blackbox, _rawModelDraft, ...rest } = version;
    return {
      ...rest,
      // ใส่ซ้ำโดยเจตนา: object-rest จะทำฟิลด์ non-enumerable หายได้
      usedModel: writerModel,
    };
  });
}

/**
 * Server-side auto-save to news archive.
 * Called after successful processing so Discord/queue content also gets archived.
 * Returns true only when the archive already exists or the write completed.
 */
async function saveToArchiveServerSide({ newsData, breakdownData, sourceType, sourceUrl, workflowId, archivedBy, coverImage, classifyTimeoutMs = 20_000 }) {
  try {
    if (!newsData?.newsTitle && !newsData?.newsBody) {
      console.warn(`[Archive-Server] Save skipped (workflow=${workflowId || 'unknown'}): missing news title/body`);
      return false;
    }

    const result = await saveNewsArchive({
      title: newsData.newsTitle,
      newsBody: newsData.newsBody,
      sourceUrl,
      sourceType: sourceType || 'discord',
      sourceName: archivedBy || 'auto-server',
      breakdownData,
      workflowId,
      archivedBy: archivedBy || 'auto-server',
      coverImage,
      classifyTimeoutMs,
    });
    const action = result.deduped ? '⏭️ Reused' : '✅ Saved';
    console.log(`[Archive-Server] ${action}: "${result.item.title.slice(0, 50)}" [${result.item.category}]`);
    return true;
  } catch (err) {
    console.warn(`[Archive-Server] Save failed (workflow=${workflowId || 'unknown'}, non-critical):`, err.message);
    return false;
  }
}

async function handlePost(request, startTime, deadlineState = {}) {
  const log       = [];
  deadlineState.log = log;
  let activeQueueJobId = null;
  let markQueueJob = async () => {};

  const addLog = (step, msg) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const entry   = `[${elapsed}s] ${step}: ${msg}`;
    log.push(entry);
    rlog.step(step, msg);
  };

  try {
    // ─── API Key Verification (For Discord Bot & External Apps) ───
    const apiKey = request.headers.get('x-api-key');
    if (apiKey) {
      if (!process.env.DISCORD_API_SECRET || apiKey !== process.env.DISCORD_API_SECRET) {
        return NextResponse.json({ success: false, error: 'Unauthorized: Invalid API Key' }, { status: 401 });
      }
    }

    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({
        success: false,
        error: 'รูปแบบ request ไม่ถูกต้อง',
        errorType: 'INVALID_REQUEST_BODY',
        failedStep: 'request_validation',
      }, { status: 400 });
    }
    const {
      input          = '',
      images         = [],
      contentLength  = 'medium',
      preset         = '',
      workflowId,
      _queueJobId    = null,
      _queueAttemptId = null,
    } = body;
    if (typeof input !== 'string'
        || !Array.isArray(images) || images.some(image => typeof image !== 'string')
        || !['short', 'medium', 'long'].includes(contentLength)
         || typeof preset !== 'string'
         || (workflowId !== undefined && workflowId !== null
           && (typeof workflowId !== 'string' || !workflowId || workflowId.trim() !== workflowId))
         || (_queueJobId !== null && (typeof _queueJobId !== 'string' || !_queueJobId.trim()))
         || (_queueAttemptId !== null && (typeof _queueAttemptId !== 'string' || !_queueAttemptId.trim()))
         || (!!_queueJobId !== !!_queueAttemptId)) {
      return NextResponse.json({
        success: false,
        error: 'ชนิดข้อมูล input/images/contentLength/preset/workflowId/_queueJobId/_queueAttemptId ไม่ถูกต้อง',
        errorType: 'INVALID_REQUEST_FIELDS',
        failedStep: 'request_validation',
      }, { status: 400 });
    }

    const isFromQueue = !!_queueJobId; // true = Discord/queue, false = web UI

    if (isFromQueue) {
      const queueService = await import('@/lib/services/queueService');
      const queueJob = await queueService.getJobStatus(_queueJobId);
      const queuedInput = queueJob?.payload?.input ?? queueJob?.payload?.url ?? queueJob?.payload?.text ?? '';
      const queuedImages = Array.isArray(queueJob?.payload?.images) ? queueJob.payload.images : [];
      const queuedContentLength = queueJob?.payload?.contentLength ?? 'medium';
      const queuedPreset = queueJob?.payload?.preset ?? '';
      const queuedUserId = queueJob?.payload?.userId ?? null;
      const queuedDeskMeta = queueJob?.payload?.deskMeta ?? null;
      const queuedWorkflowId = queueJob?.payload?.workflowId ?? null;
      if (!queueJob || queueJob.id !== _queueJobId || queueJob.status !== 'processing'
          || queueJob.attemptId !== _queueAttemptId
          || String(queuedInput) !== input
          || JSON.stringify(queuedImages) !== JSON.stringify(images)
          || queuedContentLength !== contentLength
          || queuedPreset !== preset
          || queuedUserId !== (body.userId ?? null)
          || JSON.stringify(queuedDeskMeta) !== JSON.stringify(body.deskMeta ?? null)
          || queuedWorkflowId !== (workflowId ?? null)) {
        const contextError = new Error('บริบทงานคิวไม่ตรงกับ request ที่กำลังประมวลผล');
        contextError.errorType = 'QUEUE_CONTEXT_INVALID';
        contextError.failedStep = 'queue_context';
        throw contextError;
      }
      markQueueJob = async (status, extra = {}, updateOptions = {}) => {
        const updated = await queueService.updateJobStatus(
          _queueJobId,
          status,
          extra,
          { expectedAttemptId: _queueAttemptId, ...updateOptions },
        );
        if (!updated) {
          const persistError = new Error('บันทึกสถานะงานกลับคิวไม่สำเร็จ');
          persistError.errorType = 'QUEUE_STATUS_PERSIST_FAILED';
          persistError.failedStep = 'queue_status';
          throw persistError;
        }
      };
      activeQueueJobId = _queueJobId;
      deadlineState.queueJobId = _queueJobId;
      deadlineState.queueAttemptId = _queueAttemptId;
      deadlineState.markQueueJob = markQueueJob;
    }

    const respond = async (payload, status = 200) => {
      const response = NextResponse.json(payload, { status });
      if (isFromQueue) {
        const completedAt = new Date().toISOString();
        if (payload.success) {
          try {
            await markQueueJob('completed', { result: payload, completedAt });
          } catch (queuePersistError) {
            // ข่าวสร้างเสร็จแล้ว: ห้ามแปลงผลสำเร็จเป็น 500 เพียงเพราะ self-report กลับคิวพลาด
            // worker ที่เป็นเจ้าของ request ยังรับ payload 200 ก้อนเดิมและพยายาม commit ด้วย attempt fence ต่อได้
            rlog.error('Queue success self-report failed: ' + queuePersistError.message);
            return NextResponse.json({ ...payload, queueStatusPersisted: false }, { status });
          }
        } else {
          await markQueueJob('failed', {
            error: payload.error || 'Pipeline failed',
            errorType: payload.errorType || 'PIPELINE_FAILED',
            failedStep: payload.failedStep || 'unknown_step',
            completedAt,
          });
        }
      }
      return response;
    };

    // งานคิวเดิมต้องใช้ workflow เดิมทุก attempt; direct request ใช้ UUID กันชนใน millisecond เดียวกัน
    const _wfId = workflowId
      || (isFromQueue ? `unify_${_queueJobId}` : `unify_${randomUUID()}`);
    const origin  = new URL(request.url).origin;

    await logPipeline({ workflowId: _wfId, step: 'unified-auto', status: 'started', detail: input?.slice(0, 80) }).catch(() => {});

    // ─── STEP 0: Detect ───────────────────────────────────────
    const detection = detectInputType(input, images);
    const route     = routePipeline(detection);

    addLog('Detect', `${detection.label} → ${route.pipelineId} (${(detection.confidence * 100).toFixed(0)}% confident)`);

    if (detection.inputType === 'empty') {
      return respond({
        success: false,
        error: detection.error || 'ไม่มี input',
        errorType: 'EMPTY_INPUT',
        failedStep: 'detect',
      }, 400);
    }

    // ★ 16 ก.ค. 69: TEXT-ONLY MODE — รับเฉพาะข้อความล้วน ปิดสาย URL/คลิป/รูปทั้งหมด
    //   (ด่านหลักอยู่ /api/queue/add แล้ว — ด่านนี้กันการเรียกตรงข้ามคิว · เปิดคืน: TEXT_ONLY_MODE=0)
    if (process.env.TEXT_ONLY_MODE !== '0' && (detection.hasUrls || detection.hasImage)) {
      addLog('Route', `⛔ TEXT_ONLY_MODE: ปฏิเสธ input ประเภท ${detection.inputType}`);
      return respond({
        success: false,
        error: 'โหมดข้อความเท่านั้น: ระบบปิดรับการเจนข่าวจากลิงก์/รูปชั่วคราว — กรุณาสรุปเนื้อข่าวเป็นข้อความล้วน (ไม่มีลิงก์) แล้วส่งใหม่',
        errorType: 'TEXT_ONLY_MODE',
        failedStep: 'text_only_gate',
      }, 400);
    }

    // ─── PHASE 3: Delegate single URL to enhanced /api/auto ───────
    if (route.useEnhancedPipeline && (detection.primaryUrl || detection.hasText)) {
      let delegateRes;
      const isTextDelegate = detection.inputType === 'plain_text'
        || (!detection.primaryUrl && detection.hasText);
      // ★ ส่งตัวตนคนสั่ง (ai-บก.X / desk-ทีม) + ป้ายโต๊ะข่าวเข้า pipeline — Generation Log ถึงรู้ว่าใครทำ
      //   (เดิมไม่ส่ง → ทุกเคสจากคิวเป็น anonymous หมด)
      const _delegateUser = body.userId ? { userId: body.userId, userName: body.userId } : undefined;
      if (isTextDelegate) {
        const textDelegateInput = detection.textContent || input;
        if (!isSupabaseReady()) {
          return respond({
            success: false,
            error: 'ระบบบันทึกสถานะงานข่าวเชื่อมต่อฐานข้อมูลไม่ได้ชั่วคราว — ยังไม่เริ่มเรียก AI กรุณาลองใหม่',
            errorType: 'WORKFLOW_PERSISTENCE_UNAVAILABLE',
            failedStep: 'workflow_init',
          }, 503);
        }
        try {
          await ensureWorkflow(_wfId, {
            sourceType: 'plain_text',
            rawInput: textDelegateInput,
          });
          getActivePipelineDeadline()?.throwIfExpired('workflow_init');
          addLog('Workflow', `💾 พร้อมบันทึก workflow ${_wfId}`);
        } catch (workflowError) {
          const contextConflict = workflowError?.code === 'WORKFLOW_CONTEXT_CONFLICT';
          rlog.error(`Workflow init failed (${_wfId}): ${workflowError?.message || workflowError}`);
          return respond({
            success: false,
            error: contextConflict
              ? 'รหัสงานนี้ถูกใช้กับเนื้อข่าวอื่นแล้ว — หยุดเพื่อไม่ให้ผลสองข่าวเขียนทับกัน'
              : 'เริ่มบันทึกสถานะงานข่าวไม่สำเร็จ — ยังไม่ได้เรียก AI กรุณาลองใหม่',
            errorType: contextConflict ? 'WORKFLOW_CONTEXT_CONFLICT' : 'WORKFLOW_INIT_FAILED',
            failedStep: 'workflow_init',
          }, contextConflict ? 409 : 503);
        }
        addLog('Route', `⚡ Delegating to /api/auto (TEXT pipeline)`);
        delegateRes = await processAutoFlowText({
          url:           null,
          text:          textDelegateInput,
          sourceType:    'plain_text',
          contentLength,
          preset,
          workflowId:    _wfId,
          user:          _delegateUser,
          deskMeta:      body.deskMeta || null,
        });
      } else {
        addLog('Route', `⚡ Delegating to /api/auto (URL pipeline) → ${detection.primaryUrl ? detection.primaryUrl.slice(0, 60) : 'Plain Text'}`);
        delegateRes = await processAutoFlow({
          url:           detection.primaryUrl || null,
          text:          detection.textContent || input,
          contentLength,
          preset,
          workflowId:    _wfId,
          user:          _delegateUser,
          deskMeta:      body.deskMeta || null,
        });
      }
      getActivePipelineDeadline()?.throwIfExpired('delegate_complete');

      if (delegateRes.success) {
        // Map /api/auto response to /api/auto/process shape
        const legacyData    = delegateRes.data || {};
        let versions;
        let analysisResult;
        if (isTextDelegate) {
          const prepared = prepareEnhancedAnalysisResult(legacyData);
          if (!prepared.ok) {
            return respond({
              success: false,
              error: prepared.error,
              errorType: prepared.errorType,
              failedStep: 'u_generate',
            }, 422);
          }
          versions = prepared.versions;
          analysisResult = prepared.analysisResult;
        } else {
          versions = legacyData.analysisResult?.versions || [];
          if (!Array.isArray(versions) || versions.length === 0) {
            return respond({
              success: false,
              error: 'Enhanced pipeline แจ้งว่าสำเร็จแต่ไม่มีเวอร์ชันข่าว',
              errorType: 'ANALYSIS_RESULT_MISSING',
              failedStep: 'u_generate',
            }, 422);
          }
          analysisResult = {
            ...(legacyData.analysisResult || {}),
            versions,
            usedPreset: legacyData.usedPromptInfo || { name: 'Enhanced Auto' },
            totalVersions: versions.length,
            pipeline: 'article_pipeline_enhanced',
          };
        }
        addLog('Route', `✅ Enhanced pipeline: ${versions.length} versions in ${legacyData.totalTimeSeconds}s`);

        // 🛡️ กล่องดำ: เซฟหลักฐานทุกด่านของงานนี้ลงไฟล์ (อ่านย้อนหลังผ่าน GET /api/trace) — ห้ามทำงานจริงพัง
        try {
          bbSaveTrace({
            traceId: _wfId,
            at: new Date().toISOString(),
            title: String(legacyData.newsData?.newsTitle || '').slice(0, 120),
            card: {
              id: analysisResult?.usedPreset?.promptId || null,
              name: analysisResult?.usedPreset?.promptName || analysisResult?.usedPreset?.name || null,
              matchType: analysisResult?.usedPreset?.matchType || null,
              aiPickReason: analysisResult?.usedPreset?.aiPickReason || null,
            },
            versions: versions.map(v => ({
              promptId: v.promptId || null,
              rawDraft: String(v._rawModelDraft || '').slice(0, 2000),
              blackbox: v._blackbox || [],
              corr: v._correctionDebug || null,
            })),
          });
        } catch { /* กล่องดำห้ามทำงานจริงพัง */ }

        // ★ Opus P2-D: ถอดของหนักออกจาก response/คิวหลังเซฟไฟล์แล้ว (~60-90KB/งาน) — หลักฐานเต็มอยู่ในไฟล์กล่องดำ
        try {
          const _lite = isTextDelegate
            ? compactDelegatedVersions(versions)
            : versions.map(({ _blackbox, _rawModelDraft, ...rest }) => rest);
          versions.length = 0;
          versions.push(..._lite);
          if (analysisResult && Array.isArray(analysisResult.versions)) analysisResult.versions = versions;
        } catch { /* ถอดไม่ได้ก็ส่งของเต็ม ไม่พัง */ }

        if (isTextDelegate) {
          const compactProvenance = validateVersionWriterProvenance(versions, analysisResult);
          if (!compactProvenance.ok) {
            return respond({
              success: false,
              error: `ผลเขียนเสียหลักฐานระหว่างเตรียมส่งเข้าคิว: ${compactProvenance.error}`,
              errorType: 'VERSION_PROVENANCE_MISSING',
              failedStep: 'u_generate',
            }, 422);
          }
        }

        // 🗄️ Auto-save to news archive — server-side ที่เดียว (web/Discord ผ่าน queue ทั้งคู่)
        let archiveSaved = false;
        if (isFromQueue) {
          archiveSaved = await saveToArchiveServerSide({
            newsData: legacyData.newsData,
            breakdownData: legacyData.breakdownData,
            sourceType: detection.inputType,
            sourceUrl: detection.primaryUrl || '',
            workflowId: _wfId,
            archivedBy: body.userId || 'auto-server',
            coverImage: delegateRes.autoCoverResult?.success ? delegateRes.autoCoverResult.base64 : null,
          });
          getActivePipelineDeadline()?.throwIfExpired('enhanced_archive');
          if (!archiveSaved) addLog('Archive', '⚠️ Server-side save failed — archiveSaved=false (client fallback remains available)');
        }

        const responsePayload = {
          success:       true,
          archiveSaved, // true เฉพาะเมื่อคลังมีข่าวนี้แล้วหรือบันทึกสำเร็จจริง
          workflowId:    _wfId,
          data:          { ...legacyData, versions, analysisResult, workflowId: _wfId },
          newsData:      legacyData.newsData,
          breakdownData: legacyData.breakdownData,
          analysisResult,
          factPool:      legacyData.factPool || null,
          detection: {
            inputType:    detection.inputType,
            platform:     detection.platform,
            label:        detection.label,
            confidence:   detection.confidence,
            pipelineUsed: 'article_pipeline_enhanced',
            pipelineLabel:'เว็บข่าว / บทความ (Enhanced)',
            pipelineIcon: '⚡',
            provider:     legacyData.providerUsed || 'firecrawl',
            fallbacksUsed:[],
          },
          normalized: {
            title:    legacyData.newsData?.newsTitle || '',
            language: 'th',
            category: legacyData.breakdownData?.primaryCategory || legacyData.breakdownData?.category || 'general',
            keywords: [],
            entities: [],
            imageCount: 0,
            confidence: detection.confidence,
          },
          debug: {
            log: [...log, ...(legacyData.log || [])],
            durationSeconds: legacyData.totalTimeSeconds || 0,
            fallbacksUsed:   [],
            pipelineId:      'article_pipeline_enhanced',
            delegatedTo:     '/api/auto',
          },
        };
        getActivePipelineDeadline()?.throwIfExpired('route_success_response');
        return respond(responsePayload);
      }
      addLog('Route', `⚠️ Enhanced pipeline delegation failed — using local pipeline`);
    }

    const fallbacksUsed = [];
    let   normalizedData = null;

    // ─── STEP 1: Extract by pipeline type ─────────────────────
    addLog('Route', `🔀 Pipeline: ${route.pipeline.icon} ${route.pipeline.label}`);

    switch (route.pipelineId) {

      // ── Article / Website ───────────────────────────────────
      case 'article_pipeline':
      case 'social_pipeline': {
        const url = detection.primaryUrl || input;
        addLog('Scrape', `🌐 Scraping: ${url.slice(0, 60)}`);
        const raw = await withTimeout(scrapeArticle(url, { baseUrl: origin }), 30000, 'scrape');
        if (raw.fallbackUsed) fallbacksUsed.push(raw.fallbackProvider || 'jina');
        normalizedData = normalizeToSchema(raw, 'article', { originalUrl: url, inputImages: images });
        // ★ ผนวกข้อความที่ผู้ใช้พิมพ์มากับ URL (url_with_context) — เดิมถูกทิ้งไม่ได้ใช้
        if (detection.textContent && detection.textContent.length > 20) {
          normalizedData.rawText += `\n\n[ข้อมูลเพิ่มเติมจากผู้ใช้]\n${detection.textContent}`;
          addLog('Scrape', `➕ ผนวกข้อความจากผู้ใช้ ${detection.textContent.length}ch`);
        }
        addLog('Scrape', `${raw.success ? '✅' : '⚠️'} ${raw.provider}: ${normalizedData.rawText.length}ch`);
        break;
      }

      // ── TikTok ──────────────────────────────────────────────
      case 'tiktok_pipeline': {
        const url = detection.primaryUrl || input;
        addLog('TikTok', `🎵 Extracting TikTok: ${url.slice(0, 60)}`);
        const raw = await withTimeout(scrapeTikTok(url, { baseUrl: origin }), 30000, 'tiktok_scrape');
        if (raw.fallbackUsed) fallbacksUsed.push(raw.fallbackProvider || 'builtin_tiktok');
        normalizedData = normalizeToSchema(raw, 'tiktok', { originalUrl: url, inputImages: images });
        addLog('TikTok', `${raw.success ? '✅' : '⚠️'} ${raw.provider}: ${normalizedData.rawText.length}ch`);
        break;
      }

      // ── YouTube ─────────────────────────────────────────────
      case 'youtube_pipeline': {
        const url = detection.primaryUrl || input;
        addLog('YouTube', `📺 Extracting YouTube: ${url.slice(0, 60)}`);
        const raw = await withTimeout(getYouTubeData(url, { baseUrl: origin }), 30000, 'youtube_scrape');
        if (raw.fallbackUsed) fallbacksUsed.push(raw.fallbackProvider || 'builtin_youtube');
        normalizedData = normalizeToSchema(raw, 'youtube', { originalUrl: url, inputImages: images });
        addLog('YouTube', `${raw.success ? '✅' : '⚠️'} ${raw.provider}: ${normalizedData.rawText.length}ch`);
        break;
      }

      // ── Facebook ────────────────────────────────────────────
      case 'facebook_pipeline': {
        const url = detection.primaryUrl || input;
        addLog('Facebook', `📘 Extracting Facebook: ${url.slice(0, 60)}`);
        const raw = await withTimeout(scrapeFacebook(url, { baseUrl: origin }), 30000, 'facebook_scrape');
        if (raw.fallbackUsed) fallbacksUsed.push(raw.fallbackProvider || 'jina');
        normalizedData = normalizeToSchema(raw, 'facebook', { originalUrl: url, inputImages: images });
        addLog('Facebook', `${raw.success ? '✅' : '⚠️'} ${raw.provider}: ${normalizedData.rawText.length}ch`);
        break;
      }

      // ── Image Only ──────────────────────────────────────────
      case 'vision_pipeline': {
        addLog('Vision', `🔍 Analyzing ${images.length} image(s) with GPT-4o Vision`);
        const ocrRes = await performOcr({
          images,
          mode: 'full',
        });
        const ocrText = ocrRes.text || ocrRes.result || ocrRes.content || '';
        normalizedData = normalizeToSchema({
          provider:   'gpt4o_vision',
          platform:   'image',
          success:    ocrRes.success !== false,
          title:      ocrRes.title || 'ภาพที่วิเคราะห์',
          text:       ocrText,
          images:     images.slice(0, 3),
        }, 'image', { inputImages: images });
        addLog('Vision', `✅ OCR: ${ocrText.length}ch`);
        break;
      }

      // ── Plain Text ──────────────────────────────────────────
      case 'text_pipeline': {
        const text = detection.textContent || input;
        addLog('Text', `📝 Processing plain text: ${text.length}ch`);
        normalizedData = normalizeToSchema({
          provider: 'direct_text',
          platform: 'text',
          success:  true,
          title:    text.slice(0, 80),
          text,
        }, 'text', { inputImages: images });
        break;
      }

      // ── Hybrid ──────────────────────────────────────────────
      case 'hybrid_pipeline':
      case 'hybrid_text_image':
      case 'url_with_context': {
        addLog('Hybrid', `🔀 Hybrid pipeline: URL + ${images.length} image(s) + text`);

        const tasks = [];
        const primaryUrl = detection.primaryUrl;

        if (primaryUrl) {
          tasks.push(scrapeArticle(primaryUrl, { baseUrl: origin }).catch(e => ({ success: false, error: e.message, text: '', title: '' })));
        } else {
          tasks.push(Promise.resolve({ success: true, provider: 'none', text: detection.textContent || '', title: '' }));
        }

        if (images.length > 0) {
          tasks.push(performOcr({ images, mode: 'full' }).catch(e => ({ success: false, text: '' })));
        } else {
          tasks.push(Promise.resolve({ text: '' }));
        }

        const [articleRaw, ocrRes] = await Promise.all(tasks);
        if (articleRaw.fallbackUsed) fallbacksUsed.push(articleRaw.fallbackProvider || 'fallback');

        const mergedText = [
          articleRaw.text || '',
          ocrRes.text  || ocrRes.result || '',
          detection.textContent || '',
        ].filter(t => t.length > 0).join('\n\n---\n\n');

        normalizedData = normalizeToSchema({
          provider:   'hybrid',
          platform:   'hybrid',
          success:    true,
          title:      articleRaw.title || detection.label,
          text:       mergedText,
          images:     [...(articleRaw.images || []), ...images.slice(0, 2)],
          description:articleRaw.description || '',
        }, 'hybrid', { originalUrl: primaryUrl, inputImages: images });
        addLog('Hybrid', `✅ Merged: ${mergedText.length}ch (url:${articleRaw.text?.length || 0} + ocr:${ocrRes.text?.length || 0})`);
        break;
      }

      // ── Multi URL ────────────────────────────────────────────
      case 'multi_url_pipeline': {
        addLog('MultiURL', `🔗 Processing ${detection.urls.length} URLs`);
        const urlTasks = detection.urls.slice(0, 3).map(url =>
          scrapeArticle(url, { baseUrl: origin }).catch(e => ({ success: false, text: '', title: '', url, error: e.message }))
        );
        const results = await Promise.all(urlTasks);
        const mergedText = results.map((r, i) =>
          `[ข้อมูลจาก URL ${i + 1}: ${detection.urls[i]?.slice(0, 50)}]\n${r.text || ''}`
        ).join('\n\n---\n\n');

        normalizedData = normalizeToSchema({
          provider: 'multi_url',
          platform: 'multi',
          success:  true,
          title:    results.find(r => r.title)?.title || 'หลาย URL',
          text:     mergedText,
          images:   results.flatMap(r => r.images || []).slice(0, 3),
        }, 'article', { inputImages: images });
        addLog('MultiURL', `✅ Merged ${results.length} URLs: ${mergedText.length}ch`);
        break;
      }

      default:
        addLog('Route', `⚠️ Unknown pipeline: ${route.pipelineId} — falling back to article`);
        const url = detection.primaryUrl || input;
        const raw = await scrapeArticle(url, { baseUrl: origin });
        normalizedData = normalizeToSchema(raw, 'article', { originalUrl: url });
    }

    // ─── Check viability ──────────────────────────────────────
    if (!normalizedData?.summary?.isViable) {
      return respond({
        success:   false,
        error:     'ไม่สามารถดึงเนื้อหาได้เพียงพอ — ลองวางข้อความเพิ่มเติม',
        errorType: 'CONTENT_NOT_VIABLE',
        failedStep: 'extract_source',
        detection: { label: detection.label, pipelineId: route.pipelineId },
        normalized: normalizedData,
        log,
      }, 422);
    }

    // ─── STEP 2: Extract (via performSummarize) ─────────────────
    addLog('Extract', `📰 AI extracting news from ${normalizedData.rawText.length}ch`);
    const extractRes = await withTimeout(performSummarize({
      text:       normalizedData.rawText,
      sourceType: normalizedData.sourceType,
      mode:       'extract',
      workflowId: _wfId,
      user:       body.user || null,
    }), 45000, 'extract');
    if (!extractRes.success || !extractRes.data?.newsBody) {
      return respond({
        success:    false,
        error:      `Extract failed: ${extractRes.error || 'no content'}`,
        errorType:  'EXTRACT_FAILED',
        failedStep: 'u_extract',
        normalized: normalizedData,
        log,
      }, 422);
    }
    const newsData = extractRes.data;
    addLog('Extract', `✅ "${newsData.newsTitle?.slice(0, 40)}" (${newsData.newsBody?.length}ch)`);

    // ─── STEP 3: Breakdown (optional — ไม่ block ถ้าล้มเหลว) ──
    addLog('Breakdown', '🔍 AI analyzing angles...');
    let breakdownData = null;
    try {
      const breakRes = await withTimeout(performSummarize({
        text:       newsData.newsBody,
        sourceType: normalizedData.sourceType,
        mode:       'breakdown',
        newsTitle:  newsData.newsTitle,
        workflowId: _wfId,
        user:       body.user || null,
      }), 45000, 'breakdown');
      breakdownData = breakRes.success ? breakRes.data : null;
      if (breakdownData) addLog('Breakdown', `✅ ${breakdownData.possible_angles?.length || 0} angles`);
    } catch (bdErr) {
      addLog('Breakdown', 'skipped: ' + bdErr.message);
    }

    // === Blueprint (optional — ไม่ block ถ้าล้มเหลว) ===
    let blueprintData = null;
    try {
      const bpRes = await withTimeout(performSummarize({
        text: newsData.newsBody || normalizedData.rawText,
        newsTitle: newsData.newsTitle || normalizedData.title,
        mode: 'blueprint',
        breakdownData: breakdownData,
        workflowId: _wfId,
        user: body.user || null,
      }), 45000, 'blueprint');
      if (bpRes?.success) blueprintData = bpRes.data?.blueprint || null;
      addLog('Blueprint', blueprintData ? blueprintData.core_emotion : 'skipped');
    } catch (bpErr) {
      addLog('Blueprint', 'skipped: ' + bpErr.message);
    }

    // ─── STEP 4: Generate ─────────────────────────────────────
    addLog('Generate', '✍️ Generating viral content...');
    const genRes = await withTimeout(performSummarize({
      text:       newsData.newsBody,
      sourceType: normalizedData.sourceType,
      mode:       'analyze',
      newsTitle:  newsData.newsTitle,
      breakdownData: breakdownData,
      emotionalBlueprint: blueprintData,
      contentLength,
      analysisPresetId: preset,
      targetCount: 4, // ★ เดิมไม่ส่ง → prompt ขอ "อย่างน้อย 5" ใน 90s = เสี่ยง timeout สูง
      workflowId: _wfId,
      user:       body.user || null,
    }), 240000, 'generate'); // ★ 240s ให้เท่ากับ enhanced path (เดิม 90s ไม่พอจริง)

    const genData        = genRes.data || genRes;
    const writerModel = typeof genData.usedModel === 'string' ? genData.usedModel.trim() : '';
    const promptId = genData.usedPreset?.promptId === null || genData.usedPreset?.promptId === undefined
      ? ''
      : String(genData.usedPreset.promptId);
    const sourceLabel = breakdownData?.possible_angles?.[0]?.angle_name || 'local_pipeline';
    const versions = Array.isArray(genData.versions)
      ? genData.versions.map(version => ({
          ...version,
          usedModel: writerModel,
          _source: 'classic',
          _sourceLabel: sourceLabel,
          promptId,
        }))
      : [];

    // Guard: generate ล้มเหลวหรือได้ 0 เวอร์ชัน → ต้องไม่ตอบ success
    const invalidVersion = versions.findIndex(version => !version || typeof version !== 'object'
      || typeof version.title !== 'string' || !version.title.trim()
      || typeof version.content !== 'string' || !version.content.trim());
    if (!genRes.success || versions.length === 0 || !writerModel || invalidVersion >= 0) {
      addLog('Generate', `❌ Generate failed: ${genRes.error || 'no versions produced'}`);
      return respond({
        success:   false,
        error:     `สร้างเนื้อหาไม่สำเร็จ: ${genRes.error || (!writerModel ? 'ไม่มีชื่อโมเดลผู้เขียนจริง' : (invalidVersion >= 0 ? `version ${invalidVersion + 1} ไม่ครบ` : 'AI ไม่ได้สร้างเวอร์ชันใดเลย'))}`,
        errorType: 'GENERATE_FAILED',
        failedStep: 'u_generate',
        newsData,
        breakdownData,
        log,
      }, 422);
    }

    const analysisResult = {
      ...(genData || {}),
      versions,
      usedModel: writerModel,
      usedModels: [writerModel],
      usedPreset:   genData.usedPreset || { name: route.pipeline.label },
      totalVersions:versions.length,
      pipeline:     route.pipelineId,
    };

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    addLog('Done', `✅ Total: ${totalTime}s | ${versions.length} versions | pipeline: ${route.pipelineId} | fallbacks: ${fallbacksUsed.join(',') || 'none'}`);

    await logPipeline({ workflowId: _wfId, step: 'unified-auto', status: 'success', duration: Date.now() - startTime, detail: newsData.newsTitle?.slice(0, 60) }).catch(() => {});

    // 🗄️ Auto-save to news archive — server-side ที่เดียว (เดิม pipeline ท้องถิ่นไม่ archive เลย → ข่าวจาก Discord รูป/text หายจากคลัง)
    let archiveSaved = false;
    if (isFromQueue) {
      archiveSaved = await saveToArchiveServerSide({
        newsData,
        breakdownData,
        sourceType: detection.inputType,
        sourceUrl: detection.primaryUrl || '',
        workflowId: _wfId,
        archivedBy: body.userId || 'auto-server',
        coverImage: null,
      });
      getActivePipelineDeadline()?.throwIfExpired('local_archive');
      if (!archiveSaved) addLog('Archive', '⚠️ Server-side save failed — archiveSaved=false (client fallback remains available)');
    }

    // === GENERATION LOG: บันทึกเคสเข้าระบบ ===
    const generationLogResult = await logGeneration({
        newsTitle: newsData.newsTitle,
        sourceType: detection.inputType || normalizedData.sourceType || 'web',
        sourceUrl: detection.primaryUrl || '',
        sourceText: normalizedData.rawText || '',
        versions,
        breakdownData,
        // ★ ใครส่งงาน (ai-บก.X / desk-ทีม) + ป้ายโต๊ะข่าว (เลน/หมวด) — Generation Log แยก บก./แนวข่าวได้
        userId: body.userId || 'anonymous',
        pipelineInfo: {
          totalTime: parseFloat(totalTime),
          contentLength,
          pipelineId: route.pipelineId,
          // ★ 30 มิ.ย.: บันทึก "พร้อมท์ที่ใช้จริง" — ปิดจุดบอด 90% ที่ promptName ว่าง (ตรวจย้อนหลังได้ว่าใช้/ใกล้พร้อมท์ไหน)
          promptName: analysisResult.usedPreset?.promptName || analysisResult.usedPreset?.name || '',
          promptSource: analysisResult.usedPreset?.promptSource || analysisResult.usedPreset?.source || '',
          promptScore: analysisResult.usedPreset?.matchScore ?? analysisResult.usedPreset?.viralScore ?? 0,
          promptMatchType: analysisResult.usedPreset?.matchType || (analysisResult.usedPreset?.isBorrowed ? 'BORROWED' : 'MATCHED'),
          promptId: analysisResult.usedPreset?.promptId || '',
          newsType: breakdownData?.primaryCategory || genData.debug?.newsTypeDetected || '',
          writerModels: [writerModel],
          desk: body.deskMeta || null,
        },
      });
    getActivePipelineDeadline()?.throwIfExpired('route_generation_log');
    if (!generationLogResult?.success) {
      return respond({
        success: false,
        error: `บันทึก Generation Log ไม่สำเร็จ: ${generationLogResult?.error || 'unknown error'}`,
        errorType: 'GENERATION_LOG_FAILED',
        failedStep: 'u_persist',
        newsData,
        breakdownData,
        analysisResult,
        log,
      }, 500);
    }
    addLog('GenLog', `📋 Generation Log saved (${generationLogResult.caseId})`);

    const responsePayload = {
      success:        true,
      archiveSaved, // true เฉพาะเมื่อคลังมีข่าวนี้แล้วหรือบันทึกสำเร็จจริง
      workflowId:     _wfId,
      data:           { ...genData, versions, analysisResult, workflowId: _wfId, generationLog: { caseId: generationLogResult.caseId, success: true } },
      newsData,
      breakdownData,
      analysisResult,
      detection: {
        inputType:    detection.inputType,
        platform:     detection.platform,
        label:        detection.label,
        confidence:   detection.confidence,
        pipelineUsed: route.pipelineId,
        pipelineLabel:route.pipeline.label,
        pipelineIcon: route.pipeline.icon,
        provider:     normalizedData.metadata?.provider,
        fallbacksUsed,
      },
      normalized: {
        title:       normalizedData.title,
        language:    normalizedData.language,
        category:    normalizedData.contentCategory,
        keywords:    normalizedData.keywords,
        entities:    normalizedData.extractedEntities,
        imageCount:  normalizedData.images.length,
        confidence:  normalizedData.confidence,
      },
      debug: {
        log,
        durationSeconds: parseFloat(totalTime),
        fallbacksUsed,
        pipelineId:  route.pipelineId,
        provider:    normalizedData.metadata?.provider,
        textLength:  normalizedData.rawText.length,
      },
    };
    getActivePipelineDeadline()?.throwIfExpired('route_success_response');
    return respond(responsePayload);

  } catch (err) {
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    rlog.error('Universal process error: ' + err.message);
    let queueStatusError = null;
    if (activeQueueJobId) {
      try {
        await markQueueJob('failed', {
          error: err.message,
          errorType: err.errorType || 'UNIVERSAL_PROCESS_ERROR',
          failedStep: err.failedStep || 'unknown_step',
          completedAt: new Date().toISOString(),
          // ★ 1 ก.ย. 69: ด่านความยาวกักทั้งก้อน → เก็บจำนวนคำ+เนื้อที่ถูกกักไว้กับงาน ไม่ให้หายเงียบ
          ...(err.lengthGate ? { lengthGate: err.lengthGate } : {}),
        });
      } catch (markErr) {
        queueStatusError = markErr;
        rlog.error('Queue self-report failed: ' + markErr.message);
      }
    }
    const deadlineFailure = isPipelineDeadlineError(err);
    return NextResponse.json({
      success: false,
      error:   queueStatusError
        ? `${err.message} (และบันทึกสถานะกลับคิวไม่สำเร็จ: ${queueStatusError.message})`
        : err.message,
      errorType: queueStatusError
        ? 'QUEUE_STATUS_PERSIST_FAILED'
        : (err.errorType || 'UNIVERSAL_PROCESS_ERROR'),
      failedStep: err.failedStep || 'unknown_step',
      ...(err.deadlineStep ? { deadlineStep: err.deadlineStep } : {}),
      ...(err.lengthGate ? { lengthGate: err.lengthGate } : {}), // ★ 1 ก.ย. 69: หลักฐานด่านความยาว
      queueStatusPersisted: activeQueueJobId ? !queueStatusError : null,
      log,
      debug: { durationSeconds: parseFloat(totalTime) },
    }, { status: deadlineFailure ? 504 : 500 });
  }
}

async function reportHardDeadlineFailure(error, deadlineState) {
  let queueStatusPersisted = null;
  let queueStatusError = null;
  if (typeof deadlineState?.markQueueJob === 'function') {
    let timeoutId;
    try {
      await Promise.race([
        deadlineState.markQueueJob('failed', {
          error: error.message,
          errorType: 'PIPELINE_DEADLINE_EXCEEDED',
          failedStep: 'pipeline_deadline',
          completedAt: new Date().toISOString(),
        }, {
          // ถ้า completion เริ่มก่อน deadline แล้วชนะ CAS ไปเสี้ยววินาที
          // deadline ต้องยังแก้ terminal state ของ attempt เดิมเป็น failed ได้
          expectedStatuses: ['processing', 'completed'],
        }),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('queue deadline self-report timeout')), DEADLINE_QUEUE_REPORT_MS);
          timeoutId?.unref?.();
        }),
      ]);
      queueStatusPersisted = true;
    } catch (markError) {
      queueStatusPersisted = false;
      queueStatusError = markError?.message || String(markError);
      rlog.error('Hard deadline queue self-report failed: ' + queueStatusError);
    } finally {
      clearTimeout(timeoutId);
    }
  }
  return NextResponse.json({
    success: false,
    error: error.message || 'เวลารวมของระบบข่าวครบกำหนด',
    errorType: 'PIPELINE_DEADLINE_EXCEEDED',
    failedStep: 'pipeline_deadline',
    deadlineStep: error.deadlineStep || 'pipeline',
    queueStatusPersisted,
    ...(queueStatusError ? { queueStatusError } : {}),
    log: Array.isArray(deadlineState?.log) ? deadlineState.log : [],
  }, { status: 504 });
}

export async function runProcessWithDeadline(request, routeStartedAt, deadline, deadlineState = {}) {
  try {
    return await runWithPipelineDeadline(
      deadline,
      () => handlePost(request, routeStartedAt, deadlineState),
    );
  } catch (error) {
    if (!isPipelineDeadlineError(error)) throw error;
    return reportHardDeadlineFailure(error, deadlineState);
  }
}

export async function POST(request) {
  const routeStartedAt = Date.now();
  const deadlineAt = resolvePipelineDeadlineAt(
    request.headers.get('x-news-pipeline-deadline-at'),
    routeStartedAt,
    NEWS_ROUTE_BUDGET_MS,
  );
  const deadline = createPipelineDeadline({ deadlineAt });
  return runProcessWithDeadline(request, routeStartedAt, deadline, {});
}
