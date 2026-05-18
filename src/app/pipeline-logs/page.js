'use client';
import { useState, useEffect, useCallback } from 'react';

const STATUS_ICONS = {
  started: '🔄',
  success: '✅',
  failed: '❌',
  warning: '⚠️',
  info: 'ℹ️',
};

const STATUS_COLORS = {
  started: '#3b82f6',
  success: '#22c55e',
  failed: '#ef4444',
  warning: '#f59e0b',
  info: '#6b7280',
};

export default function PipelineLogsPage() {
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ step: '', status: '' });
  const [autoRefresh, setAutoRefresh] = useState(false);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set('limit', '100');
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
    } catch (e) {
      console.error('Failed to fetch logs:', e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  const formatTime = (iso) => {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: 'short' });
  };

  const steps = ['extract', 'breakdown', 'analyze', 'research', 'mix', 'viral-analyze', 'generate-prompt'];

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 'bold' }}>📋 Pipeline Logs</h1>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            style={{
              padding: '8px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer',
              background: autoRefresh ? '#22c55e' : '#374151', color: 'white', fontSize: '14px',
            }}
          >
            {autoRefresh ? '🟢 Auto-Refresh ON' : '⏸️ Auto-Refresh OFF'}
          </button>
          <button
            onClick={fetchLogs}
            style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: '#3b82f6', color: 'white', fontSize: '14px' }}
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '24px' }}>
          {steps.map(step => {
            const s = stats.steps?.[step];
            if (!s || s.total === 0) return null;
            return (
              <div key={step} style={{
                background: '#1e293b', borderRadius: '12px', padding: '16px',
                border: '1px solid #334155',
              }}>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase' }}>{step}</div>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#f1f5f9' }}>{s.total}</div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px', fontSize: '12px' }}>
                  <span style={{ color: '#22c55e' }}>✅ {s.success}</span>
                  {s.failed > 0 && <span style={{ color: '#ef4444' }}>❌ {s.failed}</span>}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  {s.successRate}% success {s.avgDuration > 0 && `• ~${(s.avgDuration / 1000).toFixed(1)}s`}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <select
          value={filter.step}
          onChange={e => setFilter(f => ({ ...f, step: e.target.value }))}
          style={{ padding: '8px 12px', borderRadius: '8px', background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155', fontSize: '14px' }}
        >
          <option value="">ทุก Step</option>
          {steps.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={filter.status}
          onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}
          style={{ padding: '8px 12px', borderRadius: '8px', background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155', fontSize: '14px' }}
        >
          <option value="">ทุกสถานะ</option>
          <option value="started">🔄 Started</option>
          <option value="success">✅ Success</option>
          <option value="failed">❌ Failed</option>
          <option value="warning">⚠️ Warning</option>
        </select>
        <span style={{ color: '#64748b', fontSize: '14px', alignSelf: 'center' }}>
          {logs.length} logs {stats?.lastActivity && `• Last: ${formatTime(stats.lastActivity)}`}
        </span>
      </div>

      {/* Logs Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>⏳ กำลังโหลด...</div>
      ) : logs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#64748b', background: '#1e293b', borderRadius: '12px' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>📭</div>
          <div>ยังไม่มี log — ลองใช้งานระบบก่อนแล้วกลับมาดู</div>
        </div>
      ) : (
        <div style={{ background: '#0f172a', borderRadius: '12px', border: '1px solid #1e293b', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#1e293b' }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: '#94a3b8', fontWeight: 600 }}>เวลา</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: '#94a3b8', fontWeight: 600 }}>Step</th>
                <th style={{ padding: '10px 12px', textAlign: 'center', color: '#94a3b8', fontWeight: 600 }}>สถานะ</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: '#94a3b8', fontWeight: 600 }}>Model</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', color: '#94a3b8', fontWeight: 600 }}>เวลา (ms)</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: '#94a3b8', fontWeight: 600 }}>รายละเอียด</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => (
                <tr key={log.id || i} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '8px 12px', color: '#64748b', whiteSpace: 'nowrap' }}>{formatTime(log.created_at)}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ background: '#334155', padding: '2px 8px', borderRadius: '4px', color: '#e2e8f0', fontSize: '12px' }}>
                      {log.step}
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                    <span style={{ color: STATUS_COLORS[log.status] || '#6b7280' }}>
                      {STATUS_ICONS[log.status] || '📋'} {log.status}
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px', color: '#94a3b8', fontSize: '12px' }}>{log.model || '-'}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: '#94a3b8' }}>
                    {log.duration_ms ? `${log.duration_ms.toLocaleString()}ms` : '-'}
                  </td>
                  <td style={{ padding: '8px 12px', color: log.status === 'failed' ? '#ef4444' : '#94a3b8', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.error_message || log.detail || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
