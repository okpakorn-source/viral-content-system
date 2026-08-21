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

import { getSupabase, isSupabaseReady } from '../supabase.js';
import { readFile, writeFile, mkdir, rename, unlink, open, stat } from 'fs/promises';
import { join } from 'path';

const LOCAL_DIR = join(process.cwd(), 'data');
const LOCAL_FILE = join(LOCAL_DIR, 'generation-logs.json');
const LOCAL_LOCK_FILE = `${LOCAL_FILE}.lock`;
const TABLE = 'generation_logs';
const LOCAL_LOCK_STALE_MS = 60_000;
let localWriteTail = Promise.resolve();

function withLocalWriteLock(fn) {
  const run = localWriteTail.then(fn, fn);
  localWriteTail = run.catch(() => {});
  return run;
}

function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function reclaimStaleLocalFileLock() {
  try {
    const [raw, before] = await Promise.all([
      readFile(LOCAL_LOCK_FILE, 'utf8'),
      stat(LOCAL_LOCK_FILE),
    ]);
    let owner = null;
    try { owner = JSON.parse(raw); } catch {}
    const createdAt = Date.parse(owner?.createdAt || '');
    const lockTime = Number.isFinite(createdAt) ? createdAt : before.mtimeMs;
    if (!Number.isFinite(lockTime) || Date.now() - lockTime < LOCAL_LOCK_STALE_MS) return false;
    if (isProcessAlive(Number(owner?.pid))) return false;

    // อ่านซ้ำก่อนลบ: ถ้า identity เปลี่ยน แปลว่ามีเจ้าของใหม่แล้ว ห้ามแตะ
    const [confirmedRaw, after] = await Promise.all([
      readFile(LOCAL_LOCK_FILE, 'utf8'),
      stat(LOCAL_LOCK_FILE),
    ]);
    const sameFile = confirmedRaw === raw
      && before.size === after.size
      && before.mtimeMs === after.mtimeMs
      && (!before.ino || !after.ino || before.ino === after.ino);
    if (!sameFile) return false;

    await unlink(LOCAL_LOCK_FILE);
    console.warn(`[GenLogger] เก็บ local lock ค้างของ process ${owner?.pid || '?'} แล้ว`);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    console.warn(`[GenLogger] ตรวจ local lock ค้างไม่สำเร็จ: ${error.message}`);
    return false;
  }
}

async function acquireLocalFileLock(timeoutMs = 15000) {
  await mkdir(LOCAL_DIR, { recursive: true });
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    let handle = null;
    try {
      handle = await open(LOCAL_LOCK_FILE, 'wx');
      await handle.writeFile(JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() }), 'utf8');
      await handle.close();
      return async () => {
        try {
          const owner = JSON.parse(await readFile(LOCAL_LOCK_FILE, 'utf8'));
          if (owner?.token === token) await unlink(LOCAL_LOCK_FILE);
        } catch (error) {
          if (error?.code !== 'ENOENT') {
            console.warn(`[GenLogger] ปลด local lock ไม่สำเร็จ: ${error.message}`);
          }
        }
      };
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => {});
        await unlink(LOCAL_LOCK_FILE).catch(() => {});
      }
      if (error?.code !== 'EEXIST') throw error;
      if (await reclaimStaleLocalFileLock()) continue;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  }
  throw new Error('Generation Log local lock timeout — มีโปรเซสอื่นกำลังเขียนหรือมี lock ค้าง');
}

// ─── Local File Helpers ────────────────────────────────────────

async function readLocalLogs() {
  try {
    let raw = await readFile(LOCAL_FILE, 'utf-8');
    // Strip BOM if present (common on Windows)
    if (raw.charCodeAt(0) === 0xFEFF) {
      raw = raw.slice(1);
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('รูปแบบไฟล์ต้องเป็น array');
    return parsed;
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw new Error(`อ่าน Generation Log ในเครื่องไม่สำเร็จ: ${err.message}`);
  }
}

async function writeLocalLogs(logs) {
  await mkdir(LOCAL_DIR, { recursive: true });
  const tempFile = `${LOCAL_FILE}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await writeFile(tempFile, JSON.stringify(logs, null, 2), 'utf-8');
    await rename(tempFile, LOCAL_FILE);
  } catch (error) {
    await unlink(tempFile).catch(() => {});
    throw error;
  }
}

function nextLocalCaseNumber(logs) {
  const numbers = logs.map((item) => {
    const raw = String(item?.caseId ?? '');
    if (!/^\d+$/.test(raw)) return NaN;
    const number = Number(raw);
    return Number.isSafeInteger(number) && number > 0 ? number : NaN;
  });
  if (numbers.some(number => !Number.isFinite(number))) {
    throw new Error('เลข caseId ใน Generation Log ไม่ถูกต้อง');
  }
  const next = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
  return String(next).padStart(5, '0');
}

// ─── Case Number Generator ────────────────────────────────────

async function getNextCaseNumber() {
  if (isSupabaseReady()) {
    const sb = getSupabase();
    // case_id เป็น text: sort ตามตัวอักษรจะพังที่ 99999 → 100000
    // ลำดับสร้างล่าสุดมีเลขสูงสุดตาม allocator นี้ จึงอ่านหน้าล่าสุดแล้วหา max แบบตัวเลข
    const { data, error } = await sb
      .from(TABLE)
      .select('case_id')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (!error) {
      if (data?.length > 0) {
        const numbers = data.map((row) => {
          const rawCaseId = String(row?.case_id ?? '');
          if (!/^\d+$/.test(rawCaseId)) return NaN;
          const parsed = Number(rawCaseId);
          return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : NaN;
        });
        if (numbers.some(number => !Number.isFinite(number))) {
          throw new Error('เลข case_id ใน Supabase ไม่ถูกต้อง');
        }
        const lastNum = Math.max(...numbers);
        return String(lastNum + 1).padStart(5, '0');
      }
      return '00001';
    }
    console.warn(`[GenLogger] หาเลขเคสจาก Supabase ไม่สำเร็จ ใช้เลขจาก local: ${error.message}`);
  }
  // Local fallback
  const logs = await readLocalLogs();
  return nextLocalCaseNumber(logs);
}

export function validateGenerationWriterProvenance({ sourceType, versions, pipelineInfo }) {
  const info = pipelineInfo && typeof pipelineInfo === 'object' ? pipelineInfo : {};
  const requiresWriterProvenance = sourceType === 'plain_text'
    || sourceType === 'text';
  if (!requiresWriterProvenance) return { ok: true, error: '' };

  if (!Array.isArray(versions) || versions.length === 0) {
    return { ok: false, error: 'งานข่าวข้อความไม่มีเวอร์ชันให้บันทึก' };
  }

  const versionModels = versions.map(version => (
    typeof version?.usedModel === 'string' ? version.usedModel.trim() : ''
  ));
  const missingIndex = versionModels.findIndex(model => !model);
  if (missingIndex >= 0) {
    return { ok: false, error: `version ${missingIndex + 1} ไม่มี usedModel` };
  }

  const models = [...new Set(versionModels)];
  const declaredModels = Array.isArray(info.writerModels)
    ? [...new Set(info.writerModels
      .map(model => (typeof model === 'string' ? model.trim() : ''))
      .filter(Boolean))]
    : [];
  if (declaredModels.length !== models.length
      || models.some(model => !declaredModels.includes(model))) {
    return { ok: false, error: 'pipelineInfo.writerModels ไม่ตรงกับโมเดลรายเวอร์ชัน' };
  }

  return { ok: true, error: '', models };
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
    const provenance = validateGenerationWriterProvenance({ sourceType, versions, pipelineInfo });
    if (!provenance.ok) {
      throw new Error(`Generation Log provenance ไม่ครบ: ${provenance.error}`);
    }

    let caseId = await getNextCaseNumber();
    const now = new Date().toISOString();

    // ★ 14 ส.ค. 69 (เจ้าของอนุมัติ · สเปก Sol 8.8/10 — sol-backlog4-verdict ข้อ 2): ตัดสตริงด้วยเพดานไบต์ UTF-8 จริง
    //   บทเรียนเคส #03997: log ไม่เก็บกล่องดำ → เคสจากดิสคอร์ดย้อนหาต้นเหตุไม่ได้ ต้องเจนซ้ำเอง
    const _byteCap = (s, maxBytes) => {
      let out = String(s ?? '');
      if (Buffer.byteLength(out, 'utf8') <= maxBytes) return out;
      out = out.slice(0, maxBytes); // ตัดหยาบก่อน (ไทย ~3 ไบต์/ตัว) แล้วค่อยลดจนพอดี
      while (out.length > 0 && Buffer.byteLength(out, 'utf8') > maxBytes) out = out.slice(0, -8);
      // ★ ผู้ตรวจ #1 (พิสูจน์รันจริง): ตัดกลางคู่ surrogate (อีโมจิ) → JSON เสีย → Postgres ปฏิเสธ → log ทั้งเคสหาย
      if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
      return out;
    };
    const _compactCorrection = (v) => {
      try {
        const dbg = v._correctionDebug || null;
        if (!dbg && v._correctionApplied === undefined) return { status: 'unavailable' };
        // ★ ผู้ตรวจ #2: ด่านพัง (_correctionError) หรือถูกปิด (_correctionSkipped) ห้ามรายงานเป็น 'clean'
        const status = v._correctionError ? 'error'
          : v._correctionSkipped ? 'skipped'
          : dbg?.rolledBack ? 'rolled_back'
          : (v._correctionApplied ? 'corrected' : 'clean');
        return {
          status,
          issueTypes: Array.isArray(dbg?.issueTypes) ? dbg.issueTypes.slice(0, 6) : [],
          corrections: (dbg?.corrections || []).slice(0, 5).map((c) => ({
            type: _byteCap(c?.type, 48), original: _byteCap(c?.original, 180), fixed: _byteCap(c?.fixed, 180),
          })),
          semanticRemoved: (dbg?.semanticCheck?.issues || []).slice(0, 5).map((it) => ({
            removed: _byteCap(it?.removed, 240), reason: _byteCap(it?.reason, 180),
          })),
          seamGuard: dbg?.semanticCheck?.error || null,
          rawDraftHead: _byteCap(typeof v._rawModelDraft === 'string' ? v._rawModelDraft : '', 2400), // ~800 ตัวอักษรไทย
        };
      } catch { return { status: 'error' }; }
    };

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
      usedModel: typeof v.usedModel === 'string' ? v.usedModel.trim() : '',
      _source: v._source || '',
      _sourceLabel: v._sourceLabel || '',
      promptId: v.promptId || '',
      wordCount: (v.content || '').split(/\s+/).filter(w => w).length,
      charCount: (v.content || '').length,
      paraCount: (v.content || '').split('\n\n').filter(p => p.trim().length > 10).length,
      correction: _compactCorrection(v), // ★ additive — ผู้อ่านเดิมไม่กระทบ (ไม่แตะ 11 ฟิลด์เดิม)
    }));

    const logEntry = {
      caseId,
      newsTitle: newsTitle || 'ไม่มีหัวข้อ',
      sourceType,
      sourceUrl: sourceUrl || '',
      sourceText: sourceText ? String(sourceText) : '', // เก็บต้นฉบับเต็มเพื่อ audit การส่งค่าข้ามทุกขั้น
      sourceTextLength: sourceText ? String(sourceText).length : 0,
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
        contentLength: pipelineInfo.contentLength || contentLength,
        totalTime: pipelineInfo.totalTime || 0,
        promptName: pipelineInfo.promptName || '',
        promptSource: pipelineInfo.promptSource || '',
        promptScore: pipelineInfo.promptScore || 0,
        promptMatchType: pipelineInfo.promptMatchType || '', // ★ 30 มิ.ย.: MATCHED/BORROWED/EXACT/CLOSE — ตรงหรือยืมพร้อมท์ใกล้สุด
        promptId: pipelineInfo.promptId || '',               // ★ 30 มิ.ย.: id พร้อมท์จริง ไว้ตรวจย้อนหลัง
        newsType: pipelineInfo.newsType || '',
        writerModels: Array.isArray(pipelineInfo.writerModels) ? pipelineInfo.writerModels : [],
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
      const collisionDeadline = Date.now() + 30000;
      let collisionCount = 0;
      while (true) {
        logEntry.caseId = caseId;
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
        if (!error) break;
        const isCaseCollision = /23505|duplicate key|unique/i.test(`${error.code || ''} ${error.message || ''}`);
        if (!isCaseCollision) {
          throw new Error(`บันทึก Generation Log ลง Supabase ไม่สำเร็จ: ${error.message}`);
        }
        collisionCount++;
        if (Date.now() >= collisionDeadline) {
          throw new Error(`จองเลข Generation Log ไม่สำเร็จภายใน 30 วินาที (ชน ${collisionCount} ครั้ง)`);
        }
        caseId = await getNextCaseNumber();
      }
      console.log(`[GenLogger] ✅ Case #${caseId} saved to Supabase${collisionCount ? ` หลัง retry ${collisionCount} ครั้ง` : ''}`);
    } else {
      caseId = await saveToLocal(logEntry);
    }

    return { caseId, success: true };
  } catch (err) {
    console.error('[GenLogger] Failed to log generation:', err.message);
    return { caseId: null, success: false, error: err.message };
  }
}

async function saveToLocal(logEntry) {
  return withLocalWriteLock(async () => {
    const release = await acquireLocalFileLock();
    try {
      const logs = await readLocalLogs();
      const maxExisting = Number(nextLocalCaseNumber(logs)) - 1;
      const requestedRaw = String(logEntry.caseId ?? '');
      const requested = /^\d+$/.test(requestedRaw) ? Number(requestedRaw) : NaN;
      if (!Number.isSafeInteger(requested) || requested < 1) {
        throw new Error('เลข caseId ใหม่ไม่ถูกต้อง');
      }
      const caseId = requested > maxExisting
        ? String(requested).padStart(5, '0')
        : String(maxExisting + 1).padStart(5, '0');
      logs.push({ ...logEntry, caseId });
      // Keep last 500 entries
      if (logs.length > 500) logs.splice(0, logs.length - 500);
      await writeLocalLogs(logs);
      console.log(`[GenLogger] ✅ Case #${caseId} saved to local file`);
      return caseId;
    } finally {
      await release();
    }
  });
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
