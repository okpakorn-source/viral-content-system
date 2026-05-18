/**
 * ========================================
 * PIPELINE LOGGER — บันทึกทุกขั้นตอนของระบบ
 * ========================================
 * 
 * เก็บ log ทุก step: extract, breakdown, analyze, research, mix, viral-analyze
 * ดูได้ผ่าน /api/pipeline-logs + หน้า System Health
 * เก็บใน Supabase ถาวร — ไม่หายตอน deploy
 */

import { getSupabase, isSupabaseReady } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';

// In-memory fallback for local dev
const memoryLogs = [];

/**
 * บันทึก log ของ pipeline step
 * @param {object} entry
 * @param {string} entry.workflowId - ID ของ workflow (ถ้ามี)
 * @param {string} entry.step - ชื่อ step: extract, breakdown, analyze, research, mix, viral-analyze, generate-prompt
 * @param {string} entry.status - สถานะ: started, success, failed, warning
 * @param {string} entry.model - AI model ที่ใช้: gpt-4o, claude-sonnet, gemini-flash
 * @param {number} entry.duration - เวลาที่ใช้ (ms)
 * @param {number} entry.promptLength - ความยาว prompt (chars)
 * @param {number} entry.responseLength - ความยาว response (chars)
 * @param {string} entry.error - error message (ถ้า failed)
 * @param {string} entry.detail - รายละเอียดเพิ่มเติม
 * @param {object} entry.metadata - ข้อมูลเพิ่มเติม (JSON)
 */
export async function logPipeline(entry) {
  const logEntry = {
    id: uuidv4(),
    workflow_id: entry.workflowId || null,
    step: entry.step || 'unknown',
    status: entry.status || 'info',
    model: entry.model || null,
    duration_ms: entry.duration || null,
    prompt_length: entry.promptLength || null,
    response_length: entry.responseLength || null,
    error_message: entry.error || null,
    detail: entry.detail || null,
    metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
    created_at: new Date().toISOString(),
  };

  // Console log (always)
  const icon = {
    started: '🔄',
    success: '✅',
    failed: '❌',
    warning: '⚠️',
    info: 'ℹ️',
  }[logEntry.status] || '📋';

  const durationStr = logEntry.duration_ms ? ` (${logEntry.duration_ms}ms)` : '';
  const modelStr = logEntry.model ? ` [${logEntry.model}]` : '';
  console.log(`${icon} [Pipeline:${logEntry.step}] ${logEntry.status}${modelStr}${durationStr} ${logEntry.detail || ''}`);

  if (logEntry.error_message) {
    console.error(`   └─ Error: ${logEntry.error_message}`);
  }

  // Save to Supabase
  if (isSupabaseReady()) {
    try {
      const sb = getSupabase();
      await sb.from('pipeline_logs').insert(logEntry);
    } catch (e) {
      console.warn('[PipelineLog] Supabase save failed:', e.message);
    }
  }

  // Always keep in memory too (last 200)
  memoryLogs.unshift(logEntry);
  if (memoryLogs.length > 200) memoryLogs.length = 200;

  return logEntry;
}

/**
 * ดึง logs — จาก Supabase หรือ memory
 */
export async function getLogs({ limit = 50, step, status, workflowId } = {}) {
  if (isSupabaseReady()) {
    try {
      const sb = getSupabase();
      let query = sb.from('pipeline_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (step) query = query.eq('step', step);
      if (status) query = query.eq('status', status);
      if (workflowId) query = query.eq('workflow_id', workflowId);

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (e) {
      console.warn('[PipelineLog] Supabase read failed, using memory:', e.message);
    }
  }

  // Fallback: memory
  let results = [...memoryLogs];
  if (step) results = results.filter(l => l.step === step);
  if (status) results = results.filter(l => l.status === status);
  if (workflowId) results = results.filter(l => l.workflow_id === workflowId);
  return results.slice(0, limit);
}

/**
 * สรุป stats ของ pipeline
 */
export async function getLogStats() {
  const logs = await getLogs({ limit: 200 });

  const steps = ['extract', 'breakdown', 'analyze', 'research', 'mix', 'viral-analyze', 'generate-prompt'];
  const stats = {};

  for (const step of steps) {
    const stepLogs = logs.filter(l => l.step === step);
    const successLogs = stepLogs.filter(l => l.status === 'success');
    const failedLogs = stepLogs.filter(l => l.status === 'failed');
    const durations = successLogs.map(l => l.duration_ms).filter(Boolean);

    stats[step] = {
      total: stepLogs.length,
      success: successLogs.length,
      failed: failedLogs.length,
      successRate: stepLogs.length > 0 ? Math.round((successLogs.length / stepLogs.length) * 100) : 0,
      avgDuration: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      lastError: failedLogs[0]?.error_message || null,
    };
  }

  return {
    totalLogs: logs.length,
    steps: stats,
    lastActivity: logs[0]?.created_at || null,
  };
}
