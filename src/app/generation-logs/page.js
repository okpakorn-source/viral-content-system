'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import EvaluationDashboard from './EvaluationDashboard';

// ── Status config ──
const STATUS_CFG = {
  unreviewed: { icon: '⬜', label: 'ยังไม่ตรวจ', color: '#64748b', bg: 'rgba(100,116,139,0.12)', border: 'rgba(100,116,139,0.25)' },
  good:       { icon: '✅', label: 'ดี',         color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   border: 'rgba(34,197,94,0.3)' },
  bad:        { icon: '❌', label: 'ไม่ดี',      color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.3)' },
};

const SOURCE_CFG = {
  discord: { icon: '👾', label: 'Discord', color: '#7c3aed', bg: 'rgba(124,58,237,0.15)' },
  web:     { icon: '🌐', label: 'Web',     color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
};

const SORT_OPTIONS = [
  { value: 'newest', label: '🕐 ใหม่สุดก่อน' },
  { value: 'caseId', label: '🔢 ตามเลขเคส' },
];

// ── Helpers ──
function fmtDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('th-TH', {
    day: 'numeric', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtTime(seconds) {
  if (!seconds) return '-';
  if (seconds < 1) return (seconds * 1000).toFixed(0) + 'ms';
  if (seconds < 60) return seconds.toFixed(1) + 's';
  return (seconds / 60).toFixed(1) + 'm';
}

function truncate(str, len = 80) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '…' : str;
}

// ══════════════════════════════════════════════════════
//  Generation Log — คลังเคส
// ══════════════════════════════════════════════════════
export default function GenerationLogsPage() {
  // ── State ──
  const [cases, setCases]               = useState([]);
  const [stats, setStats]               = useState({ total: 0, today: 0, unreviewed: 0 });
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [search, setSearch]             = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSource, setFilterSource] = useState('all');
  const [sortBy, setSortBy]             = useState('newest');
  const [expandedCase, setExpandedCase] = useState(null);
  const [caseDetail, setCaseDetail]     = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reviewNote, setReviewNote]     = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  const [toast, setToast]               = useState('');
  const [copied, setCopied]             = useState(null);
  const [autoRefresh, setAutoRefresh]   = useState(true);
  const [lastUpdated, setLastUpdated]   = useState(null);
  const [expandedVersions, setExpandedVersions] = useState({});
  const [evalDashboard, setEvalDashboard] = useState(null); // { caseId, newsTitle, versions, sourceText }

  const fetchRef = useRef(null);
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // ── Fetch cases list ──
  const fetchCases = useCallback(async () => {
    try {
      const res = await fetch('/api/generation-logs');
      const data = await res.json();
      if (data.success) {
        setCases(data.cases || []);
        setStats(data.stats || { total: 0, today: 0, unreviewed: 0 });
        setError(null);
      } else {
        setError(data.error || 'ไม่สามารถโหลดข้อมูลได้');
      }
      setLastUpdated(new Date());
    } catch (e) {
      console.error('Failed to fetch generation logs:', e);
      setError('เชื่อมต่อ API ไม่ได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRef.current = fetchCases; }, [fetchCases]);
  useEffect(() => { const t = setTimeout(() => fetchCases(), 0); return () => clearTimeout(t); }, [fetchCases]);

  // Auto-refresh every 10s
  useEffect(() => {
    if (!autoRefresh) return;
    const iv = setInterval(() => { if (fetchRef.current) fetchRef.current(); }, 10000);
    return () => clearInterval(iv);
  }, [autoRefresh]);

  // ── Fetch single case detail ──
  const fetchCaseDetail = useCallback(async (caseId) => {
    setDetailLoading(true);
    setCaseDetail(null);
    try {
      const res = await fetch(`/api/generation-logs/${caseId}`);
      const data = await res.json();
      if (data.success) {
        setCaseDetail(data.case || data);
        setReviewNote(data.case?.reviewNote || '');
      }
    } catch (e) {
      console.error('Failed to fetch case detail:', e);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // ── Expand/Collapse case ──
  const toggleCase = (caseId) => {
    if (expandedCase === caseId) {
      setExpandedCase(null);
      setCaseDetail(null);
      setExpandedVersions({});
    } else {
      setExpandedCase(caseId);
      setExpandedVersions({});
      fetchCaseDetail(caseId);
    }
  };

  // ── Save review ──
  const saveReview = async (caseId, status) => {
    setReviewSaving(true);
    try {
      const res = await fetch(`/api/generation-logs/${caseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, reviewNote }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✅ บันทึกรีวิวเคส #${caseId} เรียบร้อย`);
        fetchCases();
        fetchCaseDetail(caseId);
      } else {
        showToast('❌ บันทึกไม่สำเร็จ: ' + (data.error || ''));
      }
    } catch (e) {
      showToast('❌ เชื่อมต่อ API ไม่ได้');
    } finally {
      setReviewSaving(false);
    }
  };

  // ── Copy helper ──
  const copyText = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
      showToast('📋 คัดลอกแล้ว');
    });
  };

  // ── Filtering + Sorting (client-side) ──
  const filtered = useMemo(() => {
    let result = [...cases];

    // Search by case number or title
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(c =>
        c.caseId?.toLowerCase().includes(q) ||
        c.newsTitle?.toLowerCase().includes(q) ||
        c.sourceType?.toLowerCase().includes(q)
      );
    }

    // Filter by status
    if (filterStatus !== 'all') {
      result = result.filter(c => c.status === filterStatus);
    }

    // Filter by source type
    if (filterSource !== 'all') {
      result = result.filter(c => c.sourceType === filterSource);
    }

    // Sort
    if (sortBy === 'newest') {
      result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else if (sortBy === 'caseId') {
      result.sort((a, b) => (a.caseId || '').localeCompare(b.caseId || ''));
    }

    return result;
  }, [cases, search, filterStatus, filterSource, sortBy]);

  // ── Toggle version expand ──
  const toggleVersion = (idx) => {
    setExpandedVersions(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  // ══════════════════════════════════════════════════
  //  STYLES
  // ══════════════════════════════════════════════════
  const styles = {
    page: {
      minHeight: '100vh',
      background: '#0a0a14',
      color: '#e2e8f0',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      padding: '0 24px 48px',
      maxWidth: '1440px',
      margin: '0 auto',
    },
    header: {
      padding: '28px 0 20px',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      marginBottom: '24px',
    },
    title: {
      fontSize: '24px',
      fontWeight: 800,
      color: '#f1f5f9',
      margin: 0,
      letterSpacing: '-0.02em',
    },
    subtitle: {
      fontSize: '12px',
      color: '#475569',
      marginTop: '6px',
    },
    statsBar: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: '12px',
      marginBottom: '20px',
    },
    statCard: {
      background: 'rgba(15,23,42,0.6)',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '14px',
      padding: '18px 20px',
      transition: 'all 0.3s ease',
    },
    searchRow: {
      display: 'flex',
      gap: '10px',
      marginBottom: '16px',
      flexWrap: 'wrap',
      alignItems: 'center',
    },
    searchInput: {
      flex: 1,
      minWidth: '220px',
      padding: '10px 16px',
      borderRadius: '10px',
      border: '1px solid rgba(255,255,255,0.08)',
      background: 'rgba(15,23,42,0.5)',
      backdropFilter: 'blur(8px)',
      color: '#f1f5f9',
      fontSize: '13px',
      outline: 'none',
      transition: 'border-color 0.2s',
      fontFamily: 'inherit',
    },
    select: {
      padding: '10px 14px',
      borderRadius: '10px',
      border: '1px solid rgba(255,255,255,0.08)',
      background: 'rgba(15,23,42,0.5)',
      backdropFilter: 'blur(8px)',
      color: '#f1f5f9',
      fontSize: '13px',
      fontFamily: 'inherit',
      cursor: 'pointer',
      outline: 'none',
    },
    caseCard: {
      background: 'rgba(15,23,42,0.4)',
      backdropFilter: 'blur(16px)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '14px',
      overflow: 'hidden',
      transition: 'all 0.3s ease',
      marginBottom: '10px',
    },
    caseHeader: {
      padding: '16px 20px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
      flexWrap: 'wrap',
      transition: 'background 0.2s',
    },
    caseNumber: {
      fontSize: '18px',
      fontWeight: 800,
      color: '#a78bfa',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      minWidth: '80px',
      flexShrink: 0,
    },
    badge: (color, bg) => ({
      fontSize: '10px',
      fontWeight: 700,
      padding: '3px 10px',
      borderRadius: '20px',
      color: color,
      background: bg,
      border: `1px solid ${color}30`,
      whiteSpace: 'nowrap',
      flexShrink: 0,
    }),
    detailPanel: {
      borderTop: '1px solid rgba(255,255,255,0.06)',
      padding: '20px 24px',
      background: 'rgba(8,12,24,0.5)',
    },
    sectionTitle: {
      fontSize: '13px',
      fontWeight: 700,
      color: '#94a3b8',
      marginBottom: '12px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    },
    infoGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: '10px',
      marginBottom: '20px',
    },
    infoBox: {
      background: 'rgba(15,23,42,0.6)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '10px',
      padding: '12px 14px',
    },
    versionCard: {
      background: 'rgba(15,23,42,0.5)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '10px',
      padding: '14px 16px',
      marginBottom: '8px',
      transition: 'all 0.2s',
    },
    btn: (color, bg, border) => ({
      padding: '10px 20px',
      borderRadius: '10px',
      border: `1px solid ${border || color}`,
      background: bg || 'transparent',
      color: color,
      fontSize: '13px',
      fontWeight: 700,
      cursor: 'pointer',
      fontFamily: 'inherit',
      transition: 'all 0.2s',
      whiteSpace: 'nowrap',
    }),
    textarea: {
      width: '100%',
      minHeight: '80px',
      padding: '12px 14px',
      borderRadius: '10px',
      border: '1px solid rgba(255,255,255,0.08)',
      background: 'rgba(15,23,42,0.5)',
      color: '#f1f5f9',
      fontSize: '13px',
      fontFamily: 'inherit',
      outline: 'none',
      resize: 'vertical',
      lineHeight: 1.6,
    },
    toast: {
      position: 'fixed',
      top: '20px',
      right: '20px',
      zIndex: 9999,
      background: 'rgba(15,23,42,0.95)',
      backdropFilter: 'blur(16px)',
      border: '1px solid rgba(255,255,255,0.1)',
      color: '#f1f5f9',
      padding: '12px 20px',
      borderRadius: '12px',
      fontSize: '13px',
      fontWeight: 700,
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
    },
    emptyState: {
      textAlign: 'center',
      padding: '80px 20px',
      background: 'rgba(15,23,42,0.3)',
      borderRadius: '16px',
      border: '1px solid rgba(255,255,255,0.04)',
    },
  };

  // ══════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════
  return (
    <div style={styles.page}>

      {/* ── Toast ── */}
      {toast && <div style={styles.toast}>{toast}</div>}

      {/* ══ HEADER ══ */}
      <div style={styles.header}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={styles.title}>📋 Generation Log — คลังเคส</h1>
            <div style={styles.subtitle}>
              ระบบจัดการและตรวจสอบเนื้อหาที่สร้างโดย AI Pipeline
              {lastUpdated && (
                <span style={{ marginLeft: '10px', opacity: 0.7 }}>
                  • อัปเดตล่าสุด {lastUpdated.toLocaleTimeString('th-TH')}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setAutoRefresh(v => !v)}
              style={styles.btn(
                autoRefresh ? '#22c55e' : '#94a3b8',
                autoRefresh ? 'rgba(34,197,94,0.15)' : 'rgba(100,116,139,0.1)',
                autoRefresh ? 'rgba(34,197,94,0.3)' : 'rgba(100,116,139,0.2)',
              )}
            >
              {autoRefresh ? '🟢 Auto Refresh ON' : '⏸ Auto OFF'}
            </button>
            <button
              onClick={fetchCases}
              style={styles.btn('#3b82f6', 'rgba(59,130,246,0.15)', 'rgba(59,130,246,0.3)')}
            >
              🔄 รีเฟรช
            </button>
          </div>
        </div>
      </div>

      {/* ══ STATS BAR ══ */}
      <div style={styles.statsBar}>
        {[
          { label: '📊 เคสทั้งหมด',     value: stats.total,      color: '#a78bfa', accent: 'rgba(167,139,250,0.15)' },
          { label: '📅 วันนี้',          value: stats.today,      color: '#3b82f6', accent: 'rgba(59,130,246,0.15)' },
          { label: '⬜ ยังไม่ตรวจ',      value: stats.unreviewed, color: '#f59e0b', accent: 'rgba(245,158,11,0.15)' },
          { label: '✅ ตรวจแล้ว',        value: (stats.total || 0) - (stats.unreviewed || 0), color: '#22c55e', accent: 'rgba(34,197,94,0.15)' },
        ].map((s) => (
          <div key={s.label} style={{ ...styles.statCard, borderLeft: `3px solid ${s.color}` }}>
            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px', fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: '32px', fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value ?? '—'}</div>
          </div>
        ))}
      </div>

      {/* ══ SEARCH & FILTERS ══ */}
      <div style={styles.searchRow}>
        <input
          style={styles.searchInput}
          placeholder="🔍 ค้นหาเลขเคส, หัวข้อข่าว, ประเภทแหล่งข้อมูล..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <select style={styles.select} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="all">ทุกสถานะ</option>
          {Object.entries(STATUS_CFG).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>

        <select style={styles.select} value={filterSource} onChange={e => setFilterSource(e.target.value)}>
          <option value="all">ทุกแหล่งข้อมูล</option>
          {Object.entries(SOURCE_CFG).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>

        <select style={styles.select} value={sortBy} onChange={e => setSortBy(e.target.value)}>
          {SORT_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {(filterStatus !== 'all' || filterSource !== 'all' || search) && (
          <button
            onClick={() => { setSearch(''); setFilterStatus('all'); setFilterSource('all'); }}
            style={styles.btn('#94a3b8', 'rgba(100,116,139,0.1)', 'rgba(100,116,139,0.2)')}
          >
            ✕ ล้างทั้งหมด
          </button>
        )}

        <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#475569', flexShrink: 0 }}>
          แสดง {filtered.length} / {cases.length} เคส
        </span>
      </div>

      {/* ══ CASE LIST ══ */}
      {loading ? (
        <div style={styles.emptyState}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
          <div style={{ fontSize: '16px', color: '#64748b', fontWeight: 600 }}>กำลังโหลดข้อมูลเคส...</div>
        </div>
      ) : error ? (
        <div style={styles.emptyState}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <div style={{ fontSize: '16px', color: '#f59e0b', fontWeight: 600, marginBottom: '8px' }}>{error}</div>
          <div style={{ fontSize: '13px', color: '#475569' }}>กดรีเฟรชเพื่อลองใหม่</div>
        </div>
      ) : filtered.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={{ fontSize: '56px', marginBottom: '16px' }}>📭</div>
          <div style={{ fontSize: '18px', color: '#64748b', fontWeight: 700, marginBottom: '8px' }}>ยังไม่มีเคส</div>
          <div style={{ fontSize: '13px', color: '#475569' }}>
            {search || filterStatus !== 'all' || filterSource !== 'all'
              ? 'ไม่พบเคสที่ตรงกับเงื่อนไข — ลองปรับ filter หรือคำค้นหา'
              : 'เมื่อมีการสร้างเนื้อหาผ่าน Pipeline จะแสดงที่นี่'}
          </div>
        </div>
      ) : (
        <div>
          {filtered.map((c) => {
            const isExpanded = expandedCase === c.caseId;
            const st = STATUS_CFG[c.status] || STATUS_CFG.unreviewed;
            const src = SOURCE_CFG[c.sourceType] || { icon: '📄', label: c.sourceType || 'ไม่ระบุ', color: '#64748b', bg: 'rgba(100,116,139,0.12)' };

            return (
              <div key={c.caseId} style={{
                ...styles.caseCard,
                borderLeft: `3px solid ${st.color}`,
                ...(isExpanded ? { border: `1px solid ${st.color}40`, borderLeft: `3px solid ${st.color}` } : {}),
              }}>

                {/* ── Case Header (clickable) ── */}
                <div
                  style={{
                    ...styles.caseHeader,
                    background: isExpanded ? 'rgba(15,23,42,0.6)' : 'transparent',
                  }}
                  onClick={() => toggleCase(c.caseId)}
                >
                  {/* Case Number */}
                  <div style={styles.caseNumber}>#{c.caseId}</div>

                  {/* Title */}
                  <div style={{ flex: 1, minWidth: '160px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#f1f5f9', lineHeight: 1.4, marginBottom: '4px' }}>
                      {truncate(c.newsTitle, 90) || 'ไม่มีหัวข้อ'}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: '#475569' }}>🕐 {fmtDate(c.createdAt)}</span>
                      {c.totalTime > 0 && (
                        <span style={{ fontSize: '11px', color: '#475569' }}>⏱ {fmtTime(c.totalTime)}</span>
                      )}
                    </div>
                  </div>

                  {/* Source Type Badge */}
                  <span style={styles.badge(src.color, src.bg)}>
                    {src.icon} {src.label}
                  </span>

                  {/* Version Count */}
                  <span style={styles.badge('#f59e0b', 'rgba(245,158,11,0.12)')}>
                    📑 {c.versionCount || 0} เวอร์ชัน
                  </span>

                  {/* Status Badge */}
                  <span style={styles.badge(st.color, st.bg)}>
                    {st.icon} {st.label}
                  </span>

                  {/* Expand Indicator */}
                  <span style={{
                    fontSize: '12px',
                    color: '#475569',
                    transition: 'transform 0.3s ease',
                    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    flexShrink: 0,
                  }}>
                    ▼
                  </span>
                </div>

                {/* ── Case Detail Panel ── */}
                {isExpanded && (
                  <div style={styles.detailPanel}>

                    {detailLoading ? (
                      <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                        <div style={{ fontSize: '32px', marginBottom: '10px' }}>⏳</div>
                        กำลังโหลดรายละเอียดเคส #{c.caseId}...
                      </div>
                    ) : (
                      <>
                        {/* ── Quick Actions ── */}
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); copyText(c.caseId, 'id-' + c.caseId); }}
                            style={styles.btn('#94a3b8', 'rgba(100,116,139,0.08)', 'rgba(100,116,139,0.15)')}
                          >
                            {copied === 'id-' + c.caseId ? '✅ คัดลอกแล้ว' : '📋 คัดลอกเลขเคส'}
                          </button>
                          {c.sourceUrl && (
                            <a
                              href={`/content/new?url=${encodeURIComponent(c.sourceUrl)}`}
                              onClick={e => e.stopPropagation()}
                              style={{ ...styles.btn('#a78bfa', 'rgba(167,139,250,0.1)', 'rgba(167,139,250,0.2)'), textDecoration: 'none' }}
                            >
                              🔄 สร้างใหม่จากแหล่งเดิม
                            </a>
                          )}
                          {/* ── Evaluation Button ── */}
                          {caseDetail?.versions?.length > 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEvalDashboard({
                                  caseId: c.caseId,
                                  newsTitle: c.newsTitle || caseDetail?.newsTitle || '',
                                  versions: caseDetail?.versions || [],
                                  sourceText: caseDetail?.sourceText || c.sourceText || '',
                                });
                              }}
                              style={styles.btn('#f59e0b', 'rgba(245,158,11,0.12)', 'rgba(245,158,11,0.3)')}
                            >
                              🧪 ประเมินบทความ
                            </button>
                          )}
                        </div>

                        {/* ═══ ต้นฉบับ Section ═══ */}
                        <div style={styles.sectionTitle}>📰 ต้นฉบับ (Source)</div>
                        <div style={styles.infoGrid}>
                          <div style={styles.infoBox}>
                            <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '4px', fontWeight: 600 }}>🔗 แหล่งที่มา</div>
                            <div style={{ fontSize: '12px', color: '#94a3b8', wordBreak: 'break-all' }}>
                              {c.sourceUrl ? (
                                <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer"
                                  style={{ color: '#60a5fa', textDecoration: 'none' }}
                                  onClick={e => e.stopPropagation()}
                                >
                                  {truncate(c.sourceUrl, 60)}
                                </a>
                              ) : '-'}
                            </div>
                          </div>
                          <div style={styles.infoBox}>
                            <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '4px', fontWeight: 600 }}>📦 ประเภท</div>
                            <div style={{ fontSize: '12px', color: src.color, fontWeight: 700 }}>{src.icon} {src.label}</div>
                          </div>
                          <div style={styles.infoBox}>
                            <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '4px', fontWeight: 600 }}>⏱ เวลาทั้งหมด</div>
                            <div style={{ fontSize: '12px', color: '#94a3b8' }}>{fmtTime(c.totalTime)}</div>
                          </div>
                        </div>

                        {/* Source Text */}
                        {(c.sourceText || caseDetail?.sourceText) && (
                          <div style={{
                            background: 'rgba(15,23,42,0.6)',
                            border: '1px solid rgba(255,255,255,0.06)',
                            borderRadius: '10px',
                            padding: '14px 16px',
                            marginBottom: '24px',
                            maxHeight: '200px',
                            overflowY: 'auto',
                          }}>
                            <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '6px', fontWeight: 700 }}>📄 เนื้อหาที่สกัดแล้ว (AI Extracted)</div>
                            <div style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                              {caseDetail?.sourceText || c.sourceText}
                            </div>
                          </div>
                        )}

                        {/* ═══ ผลลัพธ์ Section ═══ */}
                        <div style={styles.sectionTitle}>
                          ✍️ ผลลัพธ์ที่สร้าง ({caseDetail?.versions?.length || c.versionCount || 0} เวอร์ชัน)
                        </div>

                        {caseDetail?.versions?.length > 0 ? (
                          <div style={{ marginBottom: '24px' }}>
                            {caseDetail.versions.map((ver, idx) => {
                              const isVerExpanded = expandedVersions[idx];
                              return (
                                <div key={idx} style={styles.versionCard}>
                                  <div
                                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}
                                    onClick={(e) => { e.stopPropagation(); toggleVersion(idx); }}
                                  >
                                    <div style={{ flex: 1 }}>
                                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: '12px', fontWeight: 800, color: '#a78bfa' }}>v{idx + 1}</span>
                                        <span style={{ fontSize: '13px', fontWeight: 700, color: '#e2e8f0' }}>
                                          {truncate(ver.title, 70) || 'ไม่มีหัวข้อ'}
                                        </span>
                                      </div>
                                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                        {ver.style && (
                                          <span style={styles.badge('#818cf8', 'rgba(129,140,248,0.1)')}>🎨 {ver.style}</span>
                                        )}
                                        {ver.tone && (
                                          <span style={styles.badge('#f472b6', 'rgba(244,114,182,0.1)')}>🎭 {ver.tone}</span>
                                        )}
                                        <span style={styles.badge('#64748b', 'rgba(100,116,139,0.1)')}>
                                          📏 {ver.wordCount || '?'} คำ
                                        </span>
                                      </div>
                                    </div>
                                    <span style={{
                                      fontSize: '11px',
                                      color: '#475569',
                                      transition: 'transform 0.2s',
                                      transform: isVerExpanded ? 'rotate(180deg)' : '',
                                      flexShrink: 0,
                                      marginTop: '4px',
                                    }}>
                                      ▼
                                    </span>
                                  </div>

                                  {/* Version Content (expandable) */}
                                  {isVerExpanded && (
                                    <div style={{
                                      marginTop: '12px',
                                      paddingTop: '12px',
                                      borderTop: '1px solid rgba(255,255,255,0.05)',
                                    }}>
                                      <div style={{
                                        fontSize: '13px',
                                        color: '#cbd5e1',
                                        lineHeight: 1.8,
                                        whiteSpace: 'pre-wrap',
                                        maxHeight: '300px',
                                        overflowY: 'auto',
                                      }}>
                                        {ver.content || 'ไม่มีเนื้อหา'}
                                      </div>
                                      <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); copyText(ver.content || '', 'ver-' + idx); }}
                                          style={styles.btn('#64748b', 'rgba(100,116,139,0.08)', 'rgba(100,116,139,0.15)')}
                                        >
                                          {copied === 'ver-' + idx ? '✅ คัดลอกแล้ว' : '📋 คัดลอกเนื้อหา'}
                                        </button>
                                      </div>
                                    </div>
                                  )}

                                  {/* Preview when collapsed */}
                                  {!isVerExpanded && ver.content && (
                                    <div style={{ marginTop: '8px', fontSize: '12px', color: '#475569', lineHeight: 1.5 }}>
                                      {truncate(ver.content, 200)}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div style={{ padding: '20px', textAlign: 'center', color: '#475569', fontSize: '13px', marginBottom: '24px' }}>
                            ไม่มีข้อมูลเวอร์ชัน
                          </div>
                        )}

                        {/* ═══ Pipeline Info ═══ */}
                        {caseDetail?.pipelineInfo && (
                          <>
                            <div style={styles.sectionTitle}>⚙️ ข้อมูล Pipeline</div>
                            <div style={styles.infoGrid}>
                              {caseDetail.pipelineInfo.breakdownSummary && (
                                <div style={{ ...styles.infoBox, gridColumn: '1 / -1' }}>
                                  <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '4px', fontWeight: 600 }}>🔍 สรุป Breakdown</div>
                                  <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.6 }}>{caseDetail.pipelineInfo.breakdownSummary}</div>
                                </div>
                              )}
                              {caseDetail.pipelineInfo.promptsUsed?.length > 0 && (
                                <div style={styles.infoBox}>
                                  <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '6px', fontWeight: 600 }}>💡 Prompts ที่ใช้</div>
                                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                    {caseDetail.pipelineInfo.promptsUsed.map((p, i) => (
                                      <span key={i} style={styles.badge('#818cf8', 'rgba(129,140,248,0.1)')}>{p}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {caseDetail.pipelineInfo.timeTaken && (
                                <div style={styles.infoBox}>
                                  <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '4px', fontWeight: 600 }}>⏱ เวลาที่ใช้</div>
                                  <div style={{ fontSize: '16px', fontWeight: 800, color: '#f59e0b' }}>{fmtTime(caseDetail.pipelineInfo.timeTaken)}</div>
                                </div>
                              )}
                            </div>
                          </>
                        )}

                        {/* ═══ Review Section ═══ */}
                        <div style={{
                          background: 'rgba(15,23,42,0.5)',
                          border: '1px solid rgba(255,255,255,0.06)',
                          borderRadius: '12px',
                          padding: '20px',
                        }}>
                          <div style={styles.sectionTitle}>📝 รีวิวเคส</div>

                          {/* Current status display */}
                          <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <span style={{ fontSize: '12px', color: '#64748b' }}>สถานะปัจจุบัน:</span>
                            <span style={{
                              ...styles.badge(st.color, st.bg),
                              fontSize: '12px',
                              padding: '4px 14px',
                            }}>
                              {st.icon} {st.label}
                            </span>
                          </div>

                          {/* Existing review note */}
                          {c.reviewNote && (
                            <div style={{
                              background: 'rgba(245,158,11,0.06)',
                              border: '1px solid rgba(245,158,11,0.15)',
                              borderRadius: '8px',
                              padding: '10px 14px',
                              marginBottom: '14px',
                            }}>
                              <div style={{ fontSize: '10px', fontWeight: 700, color: '#f59e0b', marginBottom: '4px' }}>💬 หมายเหตุก่อนหน้า</div>
                              <div style={{ fontSize: '12px', color: '#94a3b8' }}>{c.reviewNote}</div>
                            </div>
                          )}

                          {/* Review Note Input */}
                          <div style={{ marginBottom: '16px' }}>
                            <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: '6px' }}>
                              📝 หมายเหตุผู้ตรวจ
                            </label>
                            <textarea
                              style={styles.textarea}
                              placeholder="เขียนหมายเหตุ ข้อสังเกต หรือ feedback..."
                              value={reviewNote}
                              onChange={e => setReviewNote(e.target.value)}
                              onClick={e => e.stopPropagation()}
                            />
                          </div>

                          {/* Review Buttons */}
                          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <button
                              onClick={(e) => { e.stopPropagation(); saveReview(c.caseId, 'good'); }}
                              disabled={reviewSaving}
                              style={{
                                ...styles.btn('#22c55e', c.status === 'good' ? '#22c55e' : 'rgba(34,197,94,0.12)', 'rgba(34,197,94,0.3)'),
                                color: c.status === 'good' ? '#fff' : '#22c55e',
                                flex: 1,
                                minWidth: '120px',
                                padding: '12px 20px',
                                fontSize: '14px',
                              }}
                            >
                              {reviewSaving ? '⏳ กำลังบันทึก...' : '👍 ดี'}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); saveReview(c.caseId, 'bad'); }}
                              disabled={reviewSaving}
                              style={{
                                ...styles.btn('#ef4444', c.status === 'bad' ? '#ef4444' : 'rgba(239,68,68,0.12)', 'rgba(239,68,68,0.3)'),
                                color: c.status === 'bad' ? '#fff' : '#ef4444',
                                flex: 1,
                                minWidth: '120px',
                                padding: '12px 20px',
                                fontSize: '14px',
                              }}
                            >
                              {reviewSaving ? '⏳ กำลังบันทึก...' : '👎 ไม่ดี'}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); saveReview(c.caseId, 'unreviewed'); }}
                              disabled={reviewSaving}
                              style={{
                                ...styles.btn('#64748b', 'rgba(100,116,139,0.08)', 'rgba(100,116,139,0.15)'),
                                minWidth: '100px',
                                padding: '12px 16px',
                              }}
                            >
                              ↩️ รีเซ็ต
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Footer info ── */}
      <div style={{ textAlign: 'center', padding: '32px 0 0', fontSize: '11px', color: '#334155' }}>
        Generation Log • Viral Content System • {autoRefresh ? '🟢 รีเฟรชอัตโนมัติทุก 10 วินาที' : '⏸ หยุดรีเฟรชอัตโนมัติ'}
      </div>

      {/* ── Evaluation Dashboard Modal ── */}
      {evalDashboard && (
        <EvaluationDashboard
          caseId={evalDashboard.caseId}
          newsTitle={evalDashboard.newsTitle}
          versions={evalDashboard.versions}
          sourceText={evalDashboard.sourceText}
          onClose={() => setEvalDashboard(null)}
        />
      )}
    </div>
  );
}
