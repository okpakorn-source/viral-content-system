// ============================================================
// 📡 GET /api/research/status — สถานะ worker/ชีพจร/โควตา (Research Agent v2 · เลน B · SPEC-v2 ส่วน 2.4/7/8)
// ------------------------------------------------------------
// ไม่ต้องใช้กุญแจ และไม่มีข้อมูลลับในคำตอบ: ไม่มี secret · ไม่มีเนื้อข่าว · ไม่มี jobId ที่กำลังทำ
// → status: disabled (ปิดสวิตช์) | online (มีชีพจร ≤ 10 นาที) | offline (ท่อไม่รอ · บอทติดป้าย "รีเสิร์ชออฟไลน์")
//   quota = รายงานล่าสุดของ worker {pct, account, at, low (≤ RESEARCH_AGENT_QUOTA_ALERT_PCT = 15), alertPct} — บอทเตือนเจ้าของ
//   queue = จำนวนใบ queued/leased (นับได้สูงสุด 50 ต่อสถานะ) + leased ที่เลย deadline แล้ว (staleLeased)
// ============================================================
import { jsonOk, storageErrorResponse } from '@/lib/research-agent/http';
import { getResearchAgentConfig, RESEARCH_AGENT_OFFLINE_AFTER_MS } from '@/lib/research-agent/modes';
import { loadResearchStorage } from '@/lib/research-agent/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const COUNT_LIMIT = 50;

export async function GET() {
  try {
    const config = getResearchAgentConfig();
    const settings = {
      waitMs: config.waitMs,
      deadlineMin: config.deadlineMin,
      quotaAlertPct: config.quotaAlertPct,
      secretConfigured: config.secretConfigured,
    };
    if (!config.enabled) {
      return jsonOk({
        enabled: false, mode: config.mode, status: 'disabled', offlineAfterMs: RESEARCH_AGENT_OFFLINE_AFTER_MS,
        workers: [], lastSeenAt: null, quota: null, queue: null, settings,
      });
    }
    const storage = await loadResearchStorage();
    const [workers, queued, leased] = await Promise.all([
      storage.listWorkers({ limit: 10 }),
      storage.listRequests({ status: 'queued', limit: COUNT_LIMIT }),
      storage.listRequests({ status: 'leased', limit: COUNT_LIMIT }),
    ]);
    const nowMs = Date.now();
    const publicWorkers = workers.map((worker) => {
      const seenMs = Date.parse(worker?.lastSeenAt || '');
      const known = Number.isFinite(seenMs);
      return {
        workerId: String(worker?.workerId || worker?.id || '').slice(0, 80),
        lastSeenAt: known ? worker.lastSeenAt : null,
        secondsAgo: known ? Math.max(0, Math.round((nowMs - seenMs) / 1000)) : null,
        online: known && nowMs - seenMs <= RESEARCH_AGENT_OFFLINE_AFTER_MS,
        lastEvent: typeof worker?.lastEvent === 'string' ? worker.lastEvent : null,
        quota: worker?.quota && typeof worker.quota.pct === 'number'
          ? { pct: worker.quota.pct, account: worker.quota.account ?? null, at: worker.quota.at ?? null }
          : null,
        version: typeof worker?.version === 'string' ? worker.version : null,
      };
    });
    const latestQuota = publicWorkers
      .map((w) => w.quota)
      .filter(Boolean)
      .sort((a, b) => (Date.parse(b.at || '') || 0) - (Date.parse(a.at || '') || 0))[0] || null;
    const lastSeenAt = publicWorkers.map((w) => w.lastSeenAt).filter(Boolean).sort().pop() || null;
    const staleLeased = leased.filter((r) => Date.parse(r?.deadlineAt || '') <= nowMs).length;
    return jsonOk({
      enabled: true,
      mode: config.mode,
      status: publicWorkers.some((w) => w.online) ? 'online' : 'offline',
      offlineAfterMs: RESEARCH_AGENT_OFFLINE_AFTER_MS,
      lastSeenAt,
      workers: publicWorkers,
      quota: latestQuota
        ? { ...latestQuota, alertPct: config.quotaAlertPct, low: latestQuota.pct <= config.quotaAlertPct }
        : null,
      queue: {
        queued: queued.length,
        leased: leased.length - staleLeased,
        staleLeased,
        capped: queued.length >= COUNT_LIMIT || leased.length >= COUNT_LIMIT,
      },
      settings,
      checkedAt: new Date(nowMs).toISOString(),
    });
  } catch (error) {
    console.warn(`[ResearchStatus] ล้ม: ${error?.errorType || error?.name || 'error'}`);
    return storageErrorResponse(error, 'RESEARCH_STATUS_ERROR', 'อ่านสถานะรีเสิร์ชไม่สำเร็จ');
  }
}
