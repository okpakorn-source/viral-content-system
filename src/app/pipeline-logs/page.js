'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

const STATUS_CONFIG = {
  started: { icon: '🔄', color: '#3b82f6', bg: '#1e3a5f', label: 'กำลังทำงาน' },
  success: { icon: '✅', color: '#22c55e', bg: '#14532d', label: 'สำเร็จ' },
  failed:  { icon: '❌', color: '#ef4444', bg: '#450a0a', label: 'ล้มเหลว' },
  warning: { icon: '⚠️', color: '#f59e0b', bg: '#451a03', label: 'คำเตือน' },
  info:    { icon: 'ℹ️', color: '#6b7280', bg: '#1e293b', label: 'ข้อมูล' },
};

const STEP_LABELS = {
  'auto-pipeline':   { label: 'Auto Pipeline', icon: '🤖', group: 'pipeline' },
  'extract':         { label: 'สกัดข่าว',       icon: '📰', group: 'pipeline' },
  'breakdown':       { label: 'แตกประเด็น',     icon: '🔍', group: 'pipeline' },
  'analyze':         { label: 'วิเคราะห์',       icon: '✍️', group: 'pipeline' },
  'research':        { label: 'วิจัยข้อมูล',     icon: '🔬', group: 'pipeline' },
  'mix':             { label: 'ผสมมุมข่าว',     icon: '🎨', group: 'pipeline' },
  'viral-analyze':   { label: 'วิเคราะห์ DNA',   icon: '🧬', group: 'ai' },
  'generate-prompt': { label: 'สร้าง Prompt',    icon: '💡', group: 'ai' },
  'unknown':         { label: 'อื่นๆ',           icon: '📋', group: 'system' },
};

const ALL_STEPS = Object.keys(STEP_LABELS);

export default function PipelineLogsPage() {
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ step: '', status: '' });
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [expandedLog, setExpandedLog] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchLogsRef = useRef(null);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set('limit', '200');
      if (filter.step) params.set('step', filter.step);
      if (filter.status) params.set('status', filter.status);

      const [logsRes, statsRes] = await Promise.all([
        fetch('/api/pipeline-logs?' + params.toString()),
        fetch('/api/pipeline-logs?stats=true'),
      ]);
      const logsData = await logsRes.json();
      const statsData = await statsRes.json();
      if (logsData.success) setLogs(logsData.logs || []);
      if (statsData.success) setStats(statsData.stats || null);
      setLastUpdated(new Date());
    } catch (e) {
      console.error('Failed to fetch logs:', e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // Keep ref always pointing to latest fetchLogs
  useEffect(() => { fetchLogsRef.current = fetchLogs; }, [fetchLogs]);

  // Initial fetch
  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // Auto-refresh: depends only on autoRefresh flag, calls via ref to avoid stale closure
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      if (fetchLogsRef.current) fetchLogsRef.current();
    }, 4000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const fmt = (iso) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('th-TH', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      day: '2-digit', month: 'short',
    });
  };

  const fmtDuration = (ms) => {
    if (!ms) return '-';
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  };

  // Group logs by workflowId for run view
  const groupedByRun = logs.reduce((acc, log) => {
    const key = log.workflow_id || 'no-workflow';
    if (!acc[key]) acc[key] = [];
    acc[key].push(log);
    return acc;
  }, {});

  const totalSuccess = logs.filter(l => l.status === 'success').length;
  const totalFailed = logs.filter(l => l.status === 'failed').length;
  const totalRunning = logs.filter(l => l.status === 'started').length;

  const s = { padding: '0 24px 24px', maxWidth: '1400px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' };

  return (
    <div style={s}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 0 20px', borderBottom: '1px solid #1e293b', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 'bold', color: '#f1f5f9', margin: 0 }}>📋 Pipeline Logs</h1>
          <div style={{ fontSize: '12px', color: '#475569', marginTop: '4px' }}>
            ติดตามทุกการทำงานของระบบ AI แบบ Real-time
            {lastUpdated && <span style={{ marginLeft: '8px' }}>• อัปเดตล่าสุด {lastUpdated.toLocaleTimeString('th-TH')}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setAutoRefresh(v => !v)}
            style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: autoRefresh ? '#16a34a' : '#374151', color: 'white', fontSize: '13px', fontWeight: 600 }}
          >
            {autoRefresh ? '🟢 Auto ON' : '⏸ Auto OFF'}
          </button>
          <button
            onClick={fetchLogs}
            style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: '#2563eb', color: 'white', fontSize: '13px', fontWeight: 600 }}
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Log ทั้งหมด', value: logs.length, color: '#94a3b8', icon: '📊' },
          { label: 'สำเร็จ', value: totalSuccess, color: '#22c55e', icon: '✅' },
          { label: 'ล้มเหลว', value: totalFailed, color: '#ef4444', icon: '❌' },
          { label: 'กำลังทำงาน', value: totalRunning, color: '#3b82f6', icon: '🔄' },
        ].map(card => (
          <div key={card.label} style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '10px', padding: '14px 16px' }}>
            <div style={{ fontSize: '12px', color: '#475569', marginBottom: '6px' }}>{card.icon} {card.label}</div>
            <div style={{ fontSize: '28px', fontWeight: 'bold', color: card.color }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Step Stats Grid */}
      {stats && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '13px', color: '#475569', marginBottom: '10px', fontWeight: 600 }}>📌 สถิติแต่ละ Step</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '8px' }}>
            {ALL_STEPS.map(step => {
              const st = stats.steps?.[step];
              const cfg = STEP_LABELS[step] || { label: step, icon: '📋' };
              const hasData = st && st.total > 0;
              return (
                <div key={step} style={{
                  background: hasData ? '#0f172a' : '#080f1a',
                  border: `1px solid ${hasData ? '#1e293b' : '#0f172a'}`,
                  borderRadius: '8px', padding: '12px',
                  opacity: hasData ? 1 : 0.4,
                }}>
                  <div style={{ fontSize: '11px', color: '#475569', marginBottom: '4px' }}>{cfg.icon} {cfg.label}</div>
                  <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#f1f5f9' }}>{st?.total || 0}</div>
                  <div style={{ display: 'flex', gap: '6px', fontSize: '11px', marginTop: '6px' }}>
                    <span style={{ color: '#22c55e' }}>✅{st?.success || 0}</span>
                    <span style={{ color: '#ef4444' }}>❌{st?.failed || 0}</span>
                    {st?.avgDuration > 0 && <span style={{ color: '#64748b' }}>⏱{fmtDuration(st.avgDuration)}</span>}
                  </div>
                  {st?.successRate >= 0 && hasData && (
                    <div style={{ marginTop: '6px', height: '3px', background: '#1e293b', borderRadius: '2px' }}>
                      <div style={{ height: '100%', width: st.successRate + '%', background: st.successRate >= 80 ? '#22c55e' : st.successRate >= 50 ? '#f59e0b' : '#ef4444', borderRadius: '2px' }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={filter.step} onChange={e => setFilter(f => ({ ...f, step: e.target.value }))}
          style={{ padding: '7px 12px', borderRadius: '7px', background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155', fontSize: '13px' }}>
          <option value="">ทุก Step</option>
          {ALL_STEPS.map(s => <option key={s} value={s}>{STEP_LABELS[s]?.icon} {STEP_LABELS[s]?.label || s}</option>)}
        </select>
        <select value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}
          style={{ padding: '7px 12px', borderRadius: '7px', background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155', fontSize: '13px' }}>
          <option value="">ทุกสถานะ</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
        {(filter.step || filter.status) && (
          <button onClick={() => setFilter({ step: '', status: '' })}
            style={{ padding: '7px 12px', borderRadius: '7px', background: '#374151', color: '#94a3b8', border: 'none', cursor: 'pointer', fontSize: '13px' }}>
            ✕ ล้าง filter
          </button>
        )}
        <span style={{ color: '#475569', fontSize: '13px', marginLeft: 'auto' }}>
          แสดง {logs.length} รายการ
          {stats?.lastActivity && ` • ล่าสุด ${fmt(stats.lastActivity)}`}
        </span>
      </div>

      {/* Logs Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#475569' }}>⏳ กำลังโหลด...</div>
      ) : logs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#475569', background: '#0f172a', borderRadius: '12px', border: '1px solid #1e293b' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>📭</div>
          <div style={{ fontSize: '16px', marginBottom: '8px', color: '#64748b' }}>ยังไม่มี log จากการทำงานจริง</div>
          <div style={{ fontSize: '13px', color: '#374151' }}>ลองกดประมวลผลข่าวหรือวิเคราะห์ DNA แล้วกลับมาดูที่นี่</div>
        </div>
      ) : (
        <div style={{ background: '#0a0f1a', borderRadius: '12px', border: '1px solid #1e293b', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#111827' }}>
                <th style={th}>เวลา</th>
                <th style={th}>Step</th>
                <th style={th}>สถานะ</th>
                <th style={th}>Model</th>
                <th style={{ ...th, textAlign: 'right' }}>ใช้เวลา</th>
                <th style={th}>Workflow ID</th>
                <th style={th}>รายละเอียด</th>
                <th style={{ ...th, textAlign: 'center' }}>error</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => {
                const sc = STATUS_CONFIG[log.status] || STATUS_CONFIG.info;
                const stepCfg = STEP_LABELS[log.step] || { label: log.step, icon: '📋' };
                const isExpanded = expandedLog === log.id;
                const hasError = !!log.error_message;
                return [
                  <tr key={log.id || i}
                    onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                    style={{
                      borderBottom: '1px solid #0f172a',
                      cursor: hasError ? 'pointer' : 'default',
                      background: isExpanded ? '#111827' : (hasError ? '#1a0a0a' : 'transparent'),
                      transition: 'background 0.15s',
                    }}>
                    <td style={td}><span style={{ color: '#475569', fontSize: '12px' }}>{fmt(log.created_at)}</span></td>
                    <td style={td}>
                      <span style={{ background: '#1e293b', padding: '3px 8px', borderRadius: '4px', color: '#e2e8f0', fontSize: '12px', whiteSpace: 'nowrap' }}>
                        {stepCfg.icon} {stepCfg.label}
                      </span>
                    </td>
                    <td style={td}>
                      <span style={{ background: sc.bg, color: sc.color, padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                        {sc.icon} {sc.label}
                      </span>
                    </td>
                    <td style={td}><span style={{ color: '#64748b', fontSize: '12px' }}>{log.model || '-'}</span></td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <span style={{ color: log.duration_ms > 10000 ? '#f59e0b' : '#64748b', fontSize: '12px' }}>
                        {fmtDuration(log.duration_ms)}
                      </span>
                    </td>
                    <td style={td}>
                      <span style={{ color: '#334155', fontSize: '11px', fontFamily: 'monospace' }}>
                        {log.workflow_id ? log.workflow_id.slice(0, 16) + '...' : '-'}
                      </span>
                    </td>
                    <td style={{ ...td, maxWidth: '280px' }}>
                      <span style={{ color: '#94a3b8', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                        {log.detail || '-'}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {hasError && <span style={{ fontSize: '14px' }} title={log.error_message}>⚠️</span>}
                    </td>
                  </tr>,
                  isExpanded && hasError && (
                    <tr key={log.id + '-expand'} style={{ background: '#1a0000' }}>
                      <td colSpan={8} style={{ padding: '10px 16px', borderBottom: '1px solid #0f172a' }}>
                        <div style={{ fontSize: '12px', color: '#fca5a5', fontFamily: 'monospace' }}>
                          ❌ Error: {log.error_message}
                        </div>
                        {log.metadata && (
                          <div style={{ fontSize: '11px', color: '#475569', marginTop: '4px' }}>
                            metadata: {log.metadata}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th = {
  padding: '10px 12px', textAlign: 'left', color: '#475569',
  fontWeight: 600, fontSize: '12px', whiteSpace: 'nowrap',
  borderBottom: '1px solid #1e293b',
};
const td = { padding: '9px 12px', verticalAlign: 'middle' };
