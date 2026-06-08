'use client';
import { useState, useEffect, useCallback } from 'react';

const STATUS_COLORS = {
  healthy:  { bg: '#064e3b', border: '#10b981', text: '#34d399', icon: '✅', label: 'ระบบปกติ' },
  degraded: { bg: '#78350f', border: '#f59e0b', text: '#fbbf24', icon: '⚠️', label: 'มีปัญหาบางส่วน' },
  critical: { bg: '#7f1d1d', border: '#ef4444', text: '#fca5a5', icon: '🔴', label: 'ระบบวิกฤต' },
};

function StatusDot({ ok }) {
  return (
    <span style={{
      display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
      background: ok ? '#22c55e' : '#ef4444',
      boxShadow: ok ? '0 0 8px #22c55e66' : '0 0 8px #ef444466',
    }} />
  );
}

function Card({ title, icon, children, accentColor = '#3b82f6' }) {
  return (
    <div style={{
      background: 'rgba(17, 24, 39, 0.8)', backdropFilter: 'blur(12px)',
      borderRadius: 16, padding: 24,
      border: `1px solid ${accentColor}33`,
      boxShadow: `0 4px 24px ${accentColor}11`,
    }}>
      <h3 style={{
        fontSize: 15, fontWeight: 700, marginBottom: 16,
        color: accentColor, display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 20 }}>{icon}</span> {title}
      </h3>
      {children}
    </div>
  );
}

function Row({ label, value, valueColor, sub }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 0', borderBottom: '1px solid #1e293b',
    }}>
      <span style={{ color: '#94a3b8', fontSize: 13 }}>{label}</span>
      <div style={{ textAlign: 'right' }}>
        <span style={{ color: valueColor || '#e2e8f0', fontSize: 14, fontWeight: 600 }}>{value}</span>
        {sub && <div style={{ color: '#64748b', fontSize: 11 }}>{sub}</div>}
      </div>
    </div>
  );
}

function MemoryBar({ label, used, total }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const color = pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#22c55e';
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ color: '#94a3b8', fontSize: 12 }}>{label}</span>
        <span style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600 }}>{used} / {total} MB</span>
      </div>
      <div style={{ background: '#1e293b', borderRadius: 8, height: 8, overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', background: `linear-gradient(90deg, ${color}, ${color}cc)`,
          borderRadius: 8, transition: 'width 0.8s ease',
        }} />
      </div>
    </div>
  );
}

export default function SystemHealthPage() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastChecked, setLastChecked] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(30);

  const fetchHealth = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/health', { cache: 'no-store' });
      const data = await res.json();
      setHealth(data);
      setError('');
      setLastChecked(new Date());
    } catch (e) {
      setError('ไม่สามารถเชื่อมต่อระบบได้: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(fetchHealth, refreshInterval * 1000);
    return () => clearInterval(timer);
  }, [autoRefresh, refreshInterval, fetchHealth]);

  const st = health ? STATUS_COLORS[health.status] || STATUS_COLORS.critical : null;

  return (
    <div style={{ minHeight: '100vh', background: '#0a0f1a', color: '#e2e8f0', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 16px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 32 }}>🏥</span>
              <span style={{ background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                System Health Dashboard
              </span>
            </h1>
            <p style={{ color: '#64748b', fontSize: 14, margin: '8px 0 0' }}>
              เช็คสถานะระบบทั้งหมดแบบ Real-time
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={fetchHealth}
              disabled={loading}
              style={{
                padding: '10px 20px', borderRadius: 10, border: 'none',
                background: loading ? '#374151' : 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                color: '#fff', fontSize: 13, fontWeight: 700, cursor: loading ? 'wait' : 'pointer',
              }}
            >
              {loading ? '⏳ กำลังเช็ค...' : '🔄 รีเฟรช'}
            </button>
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              style={{
                padding: '10px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: autoRefresh ? '2px solid #22c55e' : '2px solid #374151',
                background: autoRefresh ? '#14532d33' : '#1e293b',
                color: autoRefresh ? '#22c55e' : '#94a3b8',
              }}
            >
              {autoRefresh ? `🔁 Auto ${refreshInterval}s` : '⏸️ หยุด'}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{ padding: 16, background: '#7f1d1d', borderRadius: 12, marginBottom: 24, color: '#fca5a5', fontSize: 14 }}>
            ❌ {error}
          </div>
        )}

        {/* Status Banner */}
        {health && st && (
          <div style={{
            background: `linear-gradient(135deg, ${st.bg}, ${st.bg}cc)`,
            border: `2px solid ${st.border}`,
            borderRadius: 16, padding: '24px 32px', marginBottom: 28,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16,
            boxShadow: `0 0 40px ${st.border}22`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontSize: 48 }}>{st.icon}</span>
              <div>
                <div style={{ fontSize: 24, fontWeight: 800, color: st.text }}>{st.label}</div>
                <div style={{ color: '#94a3b8', fontSize: 13 }}>
                  Version {health.version} • ตอบกลับใน {health.response_time_ms}ms
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#94a3b8', fontSize: 11 }}>ตรวจสอบล่าสุด</div>
              <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>
                {lastChecked ? lastChecked.toLocaleTimeString('th-TH') : '-'}
              </div>
              {health.issues?.length > 0 && (
                <div style={{ color: '#fbbf24', fontSize: 12, marginTop: 4 }}>
                  ⚠️ {health.issues.length} ปัญหา
                </div>
              )}
            </div>
          </div>
        )}

        {/* Grid */}
        {health && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>

            {/* Supabase */}
            <Card title="Supabase (Database)" icon="🗄️" accentColor={health.checks?.supabase?.status === 'ok' ? '#22c55e' : '#ef4444'}>
              <Row
                label="สถานะ"
                value={<><StatusDot ok={health.checks.supabase?.status === 'ok'} /> {health.checks.supabase?.status === 'ok' ? ' เชื่อมต่อสำเร็จ' : ' ไม่สามารถเชื่อมต่อได้'}</>}
                valueColor={health.checks.supabase?.status === 'ok' ? '#22c55e' : '#ef4444'}
              />
              <Row label="Latency" value={`${health.checks.supabase?.latency_ms || 0}ms`}
                valueColor={health.checks.supabase?.latency_ms > 1000 ? '#f59e0b' : '#22c55e'} />
              <Row label="Cover Cases" value={health.checks.supabase?.row_count ?? 'N/A'} />
              {health.checks.supabase?.error && (
                <div style={{ marginTop: 8, padding: 8, background: '#7f1d1d33', borderRadius: 8, fontSize: 11, color: '#fca5a5' }}>
                  {health.checks.supabase.error}
                </div>
              )}
            </Card>

            {/* API Keys */}
            <Card title="API Keys" icon="🔑" accentColor="#f59e0b">
              {Object.entries(health.checks?.api_keys || {}).map(([key, ok]) => (
                <Row key={key} label={key.charAt(0).toUpperCase() + key.slice(1)}
                  value={<><StatusDot ok={ok} /> {ok ? ' ตั้งค่าแล้ว' : ' ไม่พบ'}</>}
                  valueColor={ok ? '#22c55e' : '#ef4444'} />
              ))}
            </Card>

            {/* Last Activity */}
            <Card title="กิจกรรมล่าสุด" icon="📊" accentColor="#8b5cf6">
              <Row label="Cover Cases" value={health.checks?.last_activity?.cover_cases || 'ไม่มีข้อมูล'}
                valueColor={health.checks?.last_activity?.cover_cases ? '#e2e8f0' : '#64748b'} />
              <Row label="News Cases" value={health.checks?.last_activity?.news_cases || 'ไม่มีข้อมูล'}
                valueColor={health.checks?.last_activity?.news_cases ? '#e2e8f0' : '#64748b'} />
            </Card>

            {/* Runtime */}
            <Card title="Runtime" icon="⚙️" accentColor="#06b6d4">
              <Row label="Uptime" value={`${health.checks?.runtime?.uptime_hours || 0} ชั่วโมง`} />
              <Row label="Node.js" value={health.checks?.runtime?.node_version || '-'} />
              <div style={{ marginTop: 12 }}>
                <MemoryBar label="Heap Used"
                  used={health.checks?.runtime?.memory_mb?.heapUsed || 0}
                  total={health.checks?.runtime?.memory_mb?.heapTotal || 1} />
                <MemoryBar label="RSS (Total)"
                  used={health.checks?.runtime?.memory_mb?.rss || 0}
                  total={Math.max((health.checks?.runtime?.memory_mb?.rss || 0) * 1.2, 512)} />
              </div>
            </Card>

            {/* Issues */}
            <Card title={`ปัญหาที่พบ (${health.issues?.length || 0})`} icon="⚠️"
              accentColor={health.issues?.length > 0 ? '#ef4444' : '#22c55e'}>
              {!health.issues?.length ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#22c55e', fontSize: 15, fontWeight: 600 }}>
                  ✅ ไม่พบปัญหาใดๆ
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {health.issues.map((issue, i) => (
                    <div key={i} style={{
                      padding: '10px 14px', background: '#7f1d1d22', borderRadius: 8,
                      border: '1px solid #ef444433', fontSize: 12, color: '#fca5a5',
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                    }}>
                      <span style={{ flexShrink: 0 }}>🔴</span>
                      <span>{issue}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Quick Actions */}
            <Card title="เครื่องมือ" icon="🛠️" accentColor="#3b82f6">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <a href="/api/health" target="_blank" rel="noopener"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '12px 16px', background: '#1e293b', borderRadius: 10,
                    color: '#60a5fa', textDecoration: 'none', fontSize: 13, fontWeight: 600,
                    border: '1px solid #1e3a5f', transition: 'background 0.2s',
                  }}>
                  <span>🔗</span> ดู API Response (JSON)
                </a>
                <a href="/settings" style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 16px', background: '#1e293b', borderRadius: 10,
                  color: '#94a3b8', textDecoration: 'none', fontSize: 13, fontWeight: 600,
                  border: '1px solid #374151',
                }}>
                  <span>⚙️</span> ตั้งค่าระบบ
                </a>
                <a href="/pipeline-logs" style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 16px', background: '#1e293b', borderRadius: 10,
                  color: '#94a3b8', textDecoration: 'none', fontSize: 13, fontWeight: 600,
                  border: '1px solid #374151',
                }}>
                  <span>📋</span> Pipeline Logs
                </a>
                <div style={{
                  padding: '12px 16px', background: '#0f172a', borderRadius: 10,
                  border: '1px solid #1e293b', fontSize: 12, color: '#64748b',
                }}>
                  💡 รัน <code style={{ background: '#1e293b', padding: '2px 6px', borderRadius: 4, color: '#fbbf24' }}>npm run watchdog</code> ใน terminal เพื่อตรวจสอบแบบ CLI
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Loading State */}
        {!health && loading && (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: 48, marginBottom: 16, animation: 'pulse 1.5s infinite' }}>🏥</div>
            <p style={{ color: '#94a3b8', fontSize: 16 }}>กำลังตรวจสอบสุขภาพระบบ...</p>
          </div>
        )}

        {/* Footer */}
        <div style={{
          marginTop: 32, padding: '16px 0', borderTop: '1px solid #1e293b',
          textAlign: 'center', color: '#475569', fontSize: 12,
        }}>
          ViralFlow System Health Dashboard • ข้อมูลอัปเดตอัตโนมัติทุก {refreshInterval} วินาที
        </div>
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
}
