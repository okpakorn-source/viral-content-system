/**
 * Generation Logger Service
 * ─────────────────────────────────────────
 * บันทึกทุกการ generate ไม่ว่าจาก Discord / Web / API
 * ทุก case มี case number (00001, 00002, ...)
 * เก็บ: ต้นฉบับ, ผลลัพธ์ทุกเวอร์ชัน, pipeline info
 *
 * Storage: Supabase table `generation_logs`
 * Fallback: data/generation-logs.json
 */

import { getSupabase, isSupabaseReady } from '@/lib/supabase';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

const LOCAL_DIR = join(process.cwd(), 'data');
const LOCAL_FILE = join(LOCAL_DIR, 'generation-logs.json');
const TABLE = 'generation_logs';

// ─── Local File Helpers ────────────────────────────────────────

async function readLocalLogs() {
  try {
    let raw = await readFile(LOCAL_FILE, 'utf-8');
    // Strip BOM if present (common on Windows)
    if (raw.charCodeAt(0) === 0xFEFF) {
      raw = raw.slice(1);
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[GenLogger] readLocalLogs failed:', err.message);
    return [];
  }
}

async function writeLocalLogs(logs) {
  try {
    await mkdir(LOCAL_DIR, { recursive: true });
    await writeFile(LOCAL_FILE, JSON.stringify(logs, null, 2), 'utf-8');
  } catch (err) {
    console.error('[GenLogger] Failed to write local file:', err.message);
  }
}

// ─── Case Number Generator ────────────────────────────────────

async function getNextCaseNumber() {
  if (isSupabaseReady()) {
    const sb = getSupabase();
    const { data, error } = await sb
      .from(TABLE)
      .select('case_id')
      .order('case_id', { ascending: false })
      .limit(1);
    if (!error && data?.length > 0) {
      const lastNum = parseInt(data[0].case_id, 10);
      return String(lastNum + 1).padStart(5, '0');
    }
    return '00001';
  }
  // Local fallback
  const logs = await readLocalLogs();
  if (logs.length === 0) return '00001';
  const lastNum = parseInt(logs[logs.length - 1].caseId, 10);
  return String(lastNum + 1).padStart(5, '0');
}

// ─── Main Log Function ────────────────────────────────────────

/**
 * logGeneration - บันทึก case ใหม่
 * @param {Object} params
 * @param {string} params.sourceType - 'web' | 'discord' | 'api'
 * @param {string} params.sourceUrl - URL ต้นฉบับ (ถ้ามี)
 * @param {string} params.sourceText - เนื้อหาต้นฉบับ
 * @param {string} params.newsTitle - หัวข้อข่าวที่สกัดได้
 * @param {Object} params.breakdownData - ข้อมูล breakdown
 * @param {Array} params.versions - เวอร์ชันที่ generate ได้
 * @param {Object} params.pipelineInfo - ข้อมูล pipeline (timing, prompts, etc.)
 * @param {string} params.contentLength - 'short'|'medium'|'long'
 * @param {string} params.userId - user ที่ใช้งาน (ถ้ามี)
 * @returns {Object} { caseId, success }
 */
export async function logGeneration({
  sourceType = 'web',
  sourceUrl = '',
  sourceText = '',
  newsTitle = '',
  breakdownData = null,
  versions = [],
  pipelineInfo = {},
  contentLength = 'medium',
  userId = null,
}) {
  try {
    const caseId = await getNextCaseNumber();
    const now = new Date().toISOString();

    // Compact versions for storage (keep essential data)
    const compactVersions = versions.map((v, i) => ({
      index: i,
      style: v.style || v._sourceLabel || `V${i + 1}`,
      title: v.title || '',
      content: v.content || '',
      hook: v.hook || '',
      closing: v.closing || '',
      tone: v.tone || '',
      target: v.target || '',
      wordCount: (v.content || '').split(/\s+/).filter(w => w).length,
      charCount: (v.content || '').length,
      paraCount: (v.content || '').split('\n\n').filter(p => p.trim().length > 10).length,
    }));

    const logEntry = {
      caseId,
      newsTitle: newsTitle || 'ไม่มีหัวข้อ',
      sourceType,
      sourceUrl: sourceUrl || '',
      sourceText: sourceText ? sourceText.slice(0, 5000) : '', // Cap at 5k chars
      sourceTextLength: sourceText?.length || 0,
      versionCount: compactVersions.length,
      versions: compactVersions,
      breakdown: breakdownData ? {
        coreStory: breakdownData.core_story || '',
        mainEmotionalCore: breakdownData.main_emotional_core || '',
        viralTrigger: breakdownData.viral_trigger || '',
        keyPointsCount: (breakdownData.key_points || []).length,
        quotesCount: (breakdownData.quotes || []).length,
      } : null,
      pipelineInfo: {
        contentLength,
        totalTime: pipelineInfo.totalTime || 0,
        promptName: pipelineInfo.promptName || '',
        promptSource: pipelineInfo.promptSource || '',
        promptScore: pipelineInfo.promptScore || 0,
        promptMatchType: pipelineInfo.promptMatchType || '', // ★ 30 มิ.ย.: MATCHED/BORROWED/EXACT/CLOSE — ตรงหรือยืมพร้อมท์ใกล้สุด
        promptId: pipelineInfo.promptId || '',               // ★ 30 มิ.ย.: id พร้อมท์จริง ไว้ตรวจย้อนหลัง
        newsType: pipelineInfo.newsType || '',
        stepTimings: pipelineInfo.stepTimings || {},
        desk: pipelineInfo.desk || null, // ★ ป้ายโต๊ะข่าว {newsId, lane, category, editor, editorIcon}
      },
      userId: userId || 'anonymous',
      status: 'unreviewed', // unreviewed | good | bad
      reviewNote: null,
      reviewedAt: null,
      createdAt: now,
    };

    // Save to Supabase
    if (isSupabaseReady()) {
      const sb = getSupabase();
      const { error } = await sb.from(TABLE).insert({
        case_id: caseId,
        news_title: logEntry.newsTitle,
        source_type: sourceType,
        source_url: sourceUrl,
        source_text: logEntry.sourceText,
        source_text_length: logEntry.sourceTextLength,
        version_count: logEntry.versionCount,
        versions: logEntry.versions,
        breakdown: logEntry.breakdown,
        pipeline_info: logEntry.pipelineInfo,
        user_id: logEntry.userId,
        status: 'unreviewed',
        review_note: null,
        reviewed_at: null,
        created_at: now,
      });
      if (error) {
        console.warn(`[GenLogger] Supabase insert failed, using local: ${error.message}`);
        await saveToLocal(logEntry);
      } else {
        console.log(`[GenLogger] ✅ Case #${caseId} saved to Supabase`);
      }
    } else {
      await saveToLocal(logEntry);
    }

    return { caseId, success: true };
  } catch (err) {
    console.error('[GenLogger] Failed to log generation:', err.message);
    return { caseId: null, success: false, error: err.message };
  }
}

async function saveToLocal(logEntry) {
  const logs = await readLocalLogs();
  logs.push(logEntry);
  // Keep last 500 entries
  if (logs.length > 500) logs.splice(0, logs.length - 500);
  await writeLocalLogs(logs);
  console.log(`[GenLogger] ✅ Case #${logEntry.caseId} saved to local file`);
}

// ─── Query Functions ──────────────────────────────────────────

/**
 * getCases - ดึงรายการเคส
 */
export async function getCases({ limit = 50, offset = 0, status = null, sourceType = null, search = '' } = {}) {
  if (isSupabaseReady()) {
    const sb = getSupabase();
    let q = sb.from(TABLE)
      .select('case_id, news_title, source_type, source_url, version_count, status, review_note, created_at, pipeline_info, user_id', { count: 'exact' })
      .order('case_id', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) q = q.eq('status', status);
    if (sourceType) q = q.eq('source_type', sourceType);
    if (search) q = q.or(`news_title.ilike.%${search}%,case_id.ilike.%${search}%`);

    const { data, error, count } = await q;
    if (error) {
      console.warn('[GenLogger] Supabase query failed, using local:', error.message);
      return getCasesLocal({ limit, offset, status, sourceType, search });
    }

    return {
      cases: (data || []).map(mapSupabaseCase),
      total: count || 0,
    };
  }
  return getCasesLocal({ limit, offset, status, sourceType, search });
}

function mapSupabaseCase(row) {
  return {
    caseId: row.case_id,
    newsTitle: row.news_title,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    versionCount: row.version_count,
    status: row.status,
    reviewNote: row.review_note,
    createdAt: row.created_at,
    totalTime: row.pipeline_info?.totalTime || 0,
    promptName: row.pipeline_info?.promptName || '',
    promptSource: row.pipeline_info?.promptSource || '',
    promptScore: row.pipeline_info?.promptScore || 0,
    promptMatchType: row.pipeline_info?.promptMatchType || '',
    promptId: row.pipeline_info?.promptId || '',
    newsType: row.pipeline_info?.newsType || '',
    userId: row.user_id || 'anonymous',
    desk: row.pipeline_info?.desk || null,
  };
}

async function getCasesLocal({ limit, offset, status, sourceType, search }) {
  let logs = await readLocalLogs();
  logs.reverse(); // newest first

  if (status) logs = logs.filter(l => l.status === status);
  if (sourceType) logs = logs.filter(l => l.sourceType === sourceType);
  if (search) {
    const s = search.toLowerCase();
    logs = logs.filter(l =>
      l.caseId?.includes(s) || l.newsTitle?.toLowerCase().includes(s)
    );
  }

  const total = logs.length;
  const sliced = logs.slice(offset, offset + limit);

  return {
    cases: sliced.map(l => ({
      caseId: l.caseId,
      newsTitle: l.newsTitle,
      sourceType: l.sourceType,
      sourceUrl: l.sourceUrl,
      versionCount: l.versionCount,
      status: l.status,
      reviewNote: l.reviewNote,
      createdAt: l.createdAt,
      totalTime: l.pipelineInfo?.totalTime || 0,
      promptName: l.pipelineInfo?.promptName || '',
      promptSource: l.pipelineInfo?.promptSource || '',
      promptScore: l.pipelineInfo?.promptScore || 0,
      promptMatchType: l.pipelineInfo?.promptMatchType || '',
      promptId: l.pipelineInfo?.promptId || '',
      newsType: l.pipelineInfo?.newsType || '',
      userId: l.userId || 'anonymous',
      desk: l.pipelineInfo?.desk || null,
    })),
    total,
  };
}

/**
 * getCaseDetail - ดึงเคสเดียวแบบเต็ม
 */
export async function getCaseDetail(caseId) {
  if (isSupabaseReady()) {
    const sb = getSupabase();
    const { data, error } = await sb.from(TABLE)
      .select('*')
      .eq('case_id', caseId)
      .single();

    if (!error && data) {
      return {
        caseId: data.case_id,
        newsTitle: data.news_title,
        sourceType: data.source_type,
        sourceUrl: data.source_url,
        sourceText: data.source_text,
        sourceTextLength: data.source_text_length,
        versionCount: data.version_count,
        versions: data.versions || [],
        breakdown: data.breakdown,
        pipelineInfo: data.pipeline_info,
        userId: data.user_id,
        status: data.status,
        reviewNote: data.review_note,
        reviewedAt: data.reviewed_at,
        createdAt: data.created_at,
      };
    }
    if (error) console.warn('[GenLogger] Supabase single query failed:', error.message);
  }

  // Local fallback
  const logs = await readLocalLogs();
  return logs.find(l => l.caseId === caseId) || null;
}

/**
 * updateCaseReview - อัปเดตรีวิว
 */
export async function updateCaseReview(caseId, { status, reviewNote }) {
  const now = new Date().toISOString();

  if (isSupabaseReady()) {
    const sb = getSupabase();
    const { error } = await sb.from(TABLE)
      .update({
        status,
        review_note: reviewNote || null,
        reviewed_at: now,
      })
      .eq('case_id', caseId);

    if (!error) {
      console.log(`[GenLogger] ✅ Case #${caseId} reviewed: ${status}`);
      return { success: true };
    }
    console.warn('[GenLogger] Supabase update failed:', error.message);
  }

  // Local fallback
  const logs = await readLocalLogs();
  const idx = logs.findIndex(l => l.caseId === caseId);
  if (idx === -1) return { success: false, error: 'Case not found' };

  logs[idx].status = status;
  logs[idx].reviewNote = reviewNote || null;
  logs[idx].reviewedAt = now;
  await writeLocalLogs(logs);
  console.log(`[GenLogger] ✅ Case #${caseId} reviewed locally: ${status}`);
  return { success: true };
}

/**
 * getStats - สถิติรวม
 */
export async function getStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  if (isSupabaseReady()) {
    try {
      const sb = getSupabase();
      const [totalRes, todayRes, unreviewedRes, usedRes] = await Promise.all([
        sb.from(TABLE).select('*', { count: 'exact', head: true }),
        sb.from(TABLE).select('*', { count: 'exact', head: true }).gte('created_at', todayISO),
        sb.from(TABLE).select('*', { count: 'exact', head: true }).eq('status', 'unreviewed'),
        sb.from(TABLE).select('*', { count: 'exact', head: true }).eq('status', 'used'),
      ]);
      // ถ้ามี error ใน query ใดก็ตาม → fallback local
      if (totalRes.error || todayRes.error || unreviewedRes.error) {
        console.warn('[GenLogger] getStats Supabase error, falling back to local');
      } else {
        return {
          total: totalRes.count || 0,
          today: todayRes.count || 0,
          unreviewed: unreviewedRes.count || 0,
          used: usedRes.error ? 0 : (usedRes.count || 0),
        };
      }
    } catch (err) {
      console.warn('[GenLogger] getStats failed, using local:', err.message);
    }
  }

  const logs = await readLocalLogs();
  return {
    total: logs.length,
    today: logs.filter(l => l.createdAt >= todayISO).length,
    unreviewed: logs.filter(l => l.status === 'unreviewed').length,
    used: logs.filter(l => l.status === 'used').length,
  };
}
