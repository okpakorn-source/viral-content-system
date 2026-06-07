'use client';
import { useState, useEffect, useCallback } from 'react';

// ═══════════════════════════════════════════════════════════
// Cover Archive — คลังปกข่าว (Premium Dark UI)
// ═══════════════════════════════════════════════════════════

const SCORE_FILTERS = [
  { label: 'ทั้งหมด', value: 'all' },
  { label: '🟢 8-10', value: 'high' },
  { label: '🟡 5-7', value: 'mid' },
  { label: '🔴 1-4', value: 'low' },
];

const SORT_OPTIONS = [
  { label: 'ใหม่สุดก่อน', value: 'newest' },
  { label: 'คะแนนสูง→ต่ำ', value: 'score-desc' },
];

function getScoreColor(score) {
  if (score >= 8) return '#22c55e';
  if (score >= 5) return '#eab308';
  return '#ef4444';
}

function getScoreBg(score) {
  if (score >= 8) return 'rgba(34,197,94,0.15)';
  if (score >= 5) return 'rgba(234,179,8,0.15)';
  return 'rgba(239,68,68,0.15)';
}

function getTrendIcon(trend) {
  if (trend === 'improving') return '↑';
  if (trend === 'declining') return '↓';
  return '→';
}

function getTrendColor(trend) {
  if (trend === 'improving') return '#22c55e';
  if (trend === 'declining') return '#ef4444';
  return '#94a3b8';
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('th-TH', {
      day: 'numeric', month: 'short', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return dateStr; }
}

function truncate(str, len = 60) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '…' : str;
}

// ── Mini Score Chart (CSS bars) ──
function MiniScoreChart({ scores }) {
  if (!scores || scores.length === 0) return null;
  const last20 = scores.slice(-20);
  const maxScore = 10;

  return (
    <div style={styles.chartContainer}>
      <p style={styles.chartTitle}>📊 คะแนน 20 ปกล่าสุด</p>
      <div style={styles.chartBars}>
        {last20.map((item, i) => {
          const score = item.score || 0;
          const height = Math.max(4, (score / maxScore) * 80);
          return (
            <div key={i} style={styles.barWrapper} title={`${item.caseNumber ? 'CASE-' + String(item.caseNumber).padStart(3, '0') : ''}: ${score}/10`}>
              <div style={{
                ...styles.bar,
                height,
                background: `linear-gradient(180deg, ${getScoreColor(score)}, ${getScoreColor(score)}88)`,
              }} />
              <span style={styles.barLabel}>{score}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Case Detail Modal ──
function CaseModal({ caseData, onClose }) {
  if (!caseData) return null;

  const imgSrc = caseData.coverImageUrl || caseData.supabaseImageUrl || caseData.coverImagePath || '';

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.modalHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              ...styles.caseBadge,
              background: getScoreBg(caseData.score),
              color: getScoreColor(caseData.score),
              fontSize: 16,
              padding: '6px 14px',
            }}>
              {caseData.caseId}
            </span>
            <span style={{
              fontSize: 24, fontWeight: 700,
              color: getScoreColor(caseData.score),
            }}>
              ⭐ {caseData.score}/10
            </span>
          </div>
          <button onClick={onClose} style={styles.modalClose}>✕</button>
        </div>

        {/* Image */}
        {imgSrc && (
          <div style={styles.modalImageWrap}>
            <img src={imgSrc} alt={caseData.newsTitle} style={styles.modalImage} />
          </div>
        )}

        {/* Details */}
        <div style={styles.modalDetails}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>
            {caseData.newsTitle || 'ไม่มีหัวข้อ'}
          </h3>

          {caseData.content && (
            <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
              {caseData.content}
            </p>
          )}

          <div style={styles.modalMeta}>
            <MetaItem icon="🎨" label="Template" value={caseData.templateUsed || '-'} />
            <MetaItem icon="⏱️" label="เวลา" value={caseData.elapsed || '-'} />
            <MetaItem icon="🖼️" label="จำนวนภาพ" value={caseData.imageCount || 0} />
            <MetaItem icon="📅" label="วันที่" value={formatDate(caseData.createdAt)} />
            {caseData.batchId && (
              <MetaItem icon="📦" label="Batch" value={caseData.batchId} />
            )}
          </div>

          {caseData.identity && Object.keys(caseData.identity).length > 0 && (
            <div style={{ marginTop: 16, padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>👤 Identity</p>
              {Object.entries(caseData.identity).map(([k, v]) => (
                <span key={k} style={{
                  display: 'inline-block', marginRight: 8, marginBottom: 4,
                  padding: '3px 8px', background: 'rgba(99,102,241,0.15)', borderRadius: 4,
                  fontSize: 12, color: '#a78bfa',
                }}>
                  {k}: {typeof v === 'string' ? v : JSON.stringify(v)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaItem({ icon, label, value }) {
  return (
    <div style={styles.metaItem}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <div>
        <span style={{ fontSize: 11, color: '#64748b', display: 'block' }}>{label}</span>
        <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>{value}</span>
      </div>
    </div>
  );
}

// ── Case Card ──
function CaseCard({ caseData, onClick, index }) {
  const imgSrc = caseData.coverImageUrl || caseData.supabaseImageUrl || caseData.coverImagePath || '';
  const score = caseData.score || 0;

  return (
    <div
      onClick={onClick}
      style={{
        ...styles.card,
        animationDelay: `${index * 0.05}s`,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.borderColor = getScoreColor(score) + '66';
        e.currentTarget.style.boxShadow = `0 8px 32px ${getScoreColor(score)}22`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
        e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.3)';
      }}
    >
      {/* Case Badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{
          ...styles.caseBadge,
          background: getScoreBg(score),
          color: getScoreColor(score),
        }}>
          {caseData.caseId}
        </span>
        {caseData.batchId && (
          <span style={styles.batchBadge}>📦 Batch</span>
        )}
      </div>

      {/* Thumbnail */}
      <div style={styles.thumbWrap}>
        {imgSrc ? (
          <img src={imgSrc} alt={caseData.newsTitle} style={styles.thumbImg} loading="lazy" />
        ) : (
          <div style={styles.noImage}>📷 ไม่มีภาพ</div>
        )}
      </div>

      {/* Title */}
      <p style={styles.cardTitle}>
        {truncate(caseData.newsTitle, 55) || 'ไม่มีหัวข้อ'}
      </p>

      {/* Meta row */}
      <div style={styles.cardMeta}>
        <span style={{
          ...styles.scorePill,
          background: getScoreBg(score),
          color: getScoreColor(score),
          borderColor: getScoreColor(score) + '44',
        }}>
          ⭐ {score}
        </span>
        <span style={styles.metaText}>🎨 {truncate(caseData.templateUsed, 16) || '-'}</span>
        {caseData.elapsed && (
          <span style={styles.metaText}>⏱️ {caseData.elapsed}</span>
        )}
      </div>

      {/* Date */}
      <p style={styles.cardDate}>{formatDate(caseData.createdAt)}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Main Page Component
// ═══════════════════════════════════════════════════════════
export default function CoverArchivePage() {
  const [cases, setCases] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scoreFilter, setScoreFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [selectedCase, setSelectedCase] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);

  // ── Fetch data on mount ──
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError('');
      try {
        const [casesRes, statsRes] = await Promise.all([
          fetch('/api/cover-cases?limit=100'),
          fetch('/api/cover-cases?stats=true'),
        ]);
        const casesData = await casesRes.json();
        const statsData = await statsRes.json();

        if (casesData.success) setCases(casesData.cases || []);
        else setError(casesData.error || 'โหลดข้อมูลไม่สำเร็จ');

        if (statsData.success) setStats(statsData);
      } catch (e) {
        setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์: ' + e.message);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // ── Open case modal with full details ──
  const openCaseModal = useCallback(async (caseItem) => {
    setModalLoading(true);
    try {
      const res = await fetch(`/api/cover-cases?id=${caseItem.caseId}`);
      const data = await res.json();
      if (data.success && data.case) {
        setSelectedCase(data.case);
      } else {
        // Fallback to list data
        setSelectedCase(caseItem);
      }
    } catch {
      setSelectedCase(caseItem);
    } finally {
      setModalLoading(false);
    }
  }, []);

  // ── Filter & Sort ──
  const filteredCases = cases
    .filter(c => {
      if (scoreFilter === 'all') return true;
      const s = c.score || 0;
      if (scoreFilter === 'high') return s >= 8;
      if (scoreFilter === 'mid') return s >= 5 && s < 8;
      if (scoreFilter === 'low') return s < 5;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'score-desc') return (b.score || 0) - (a.score || 0);
      // newest first (default)
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {/* ── Header Section ── */}
        <div style={styles.header}>
          <div style={styles.headerTop}>
            <div>
              <h1 style={styles.title}>📁 คลังปกข่าว</h1>
              <p style={styles.subtitle}>Cover Case Archive — บันทึกและวิเคราะห์ปกทุกชิ้นที่สร้าง</p>
            </div>
            <a href="/cover-lab" style={styles.backLink}>
              ← กลับ Cover Lab
            </a>
          </div>

          {/* Stats Bar */}
          {stats && (
            <div style={styles.statsBar}>
              <div style={styles.statItem}>
                <span style={styles.statValue}>{stats.totalCases}</span>
                <span style={styles.statLabel}>ปกทั้งหมด</span>
              </div>
              <div style={styles.statDivider} />
              <div style={styles.statItem}>
                <span style={{
                  ...styles.statValue,
                  color: getScoreColor(stats.avgScore),
                }}>
                  {stats.avgScore}
                </span>
                <span style={styles.statLabel}>คะแนนเฉลี่ย</span>
              </div>
              <div style={styles.statDivider} />
              <div style={styles.statItem}>
                <span style={{
                  ...styles.statValue,
                  color: getTrendColor(stats.trend),
                }}>
                  {getTrendIcon(stats.trend)} {stats.trend === 'improving' ? 'ขาขึ้น' : stats.trend === 'declining' ? 'ขาลง' : 'คงที่'}
                </span>
                <span style={styles.statLabel}>แนวโน้ม</span>
              </div>
              <div style={styles.statDivider} />

              {/* Score Distribution */}
              {stats.scoreDistribution && (
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={{ ...styles.distPill, color: '#22c55e', background: 'rgba(34,197,94,0.12)' }}>
                    🟢 {stats.scoreDistribution.high || 0}
                  </span>
                  <span style={{ ...styles.distPill, color: '#eab308', background: 'rgba(234,179,8,0.12)' }}>
                    🟡 {stats.scoreDistribution.mid || 0}
                  </span>
                  <span style={{ ...styles.distPill, color: '#ef4444', background: 'rgba(239,68,68,0.12)' }}>
                    🔴 {stats.scoreDistribution.low || 0}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Mini Score Chart ── */}
        {stats?.scores && <MiniScoreChart scores={stats.scores} />}

        {/* ── Filter Bar ── */}
        <div style={styles.filterBar}>
          <div style={styles.filterGroup}>
            <span style={styles.filterLabel}>กรองคะแนน:</span>
            {SCORE_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setScoreFilter(f.value)}
                style={{
                  ...styles.filterBtn,
                  ...(scoreFilter === f.value ? styles.filterBtnActive : {}),
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div style={styles.filterGroup}>
            <span style={styles.filterLabel}>เรียง:</span>
            {SORT_OPTIONS.map(s => (
              <button
                key={s.value}
                onClick={() => setSortBy(s.value)}
                style={{
                  ...styles.filterBtn,
                  ...(sortBy === s.value ? styles.filterBtnActive : {}),
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Loading / Error ── */}
        {loading && (
          <div style={styles.loadingWrap}>
            <div style={styles.spinner} />
            <p style={{ color: '#94a3b8', marginTop: 16 }}>กำลังโหลดข้อมูล...</p>
          </div>
        )}

        {error && (
          <div style={styles.errorBox}>
            ❌ {error}
          </div>
        )}

        {/* ── Cases Grid ── */}
        {!loading && !error && (
          <>
            <p style={styles.resultCount}>
              แสดง {filteredCases.length} จาก {cases.length} ปก
            </p>
            {filteredCases.length === 0 ? (
              <div style={styles.emptyState}>
                <span style={{ fontSize: 48 }}>📭</span>
                <p style={{ color: '#64748b', marginTop: 12 }}>
                  {cases.length === 0
                    ? 'ยังไม่มีปกในคลัง — ไปสร้างปกที่ Cover Lab'
                    : 'ไม่พบปกที่ตรงกับเงื่อนไข'
                  }
                </p>
              </div>
            ) : (
              <div style={styles.grid}>
                {filteredCases.map((c, i) => (
                  <CaseCard
                    key={c.caseId || i}
                    caseData={c}
                    index={i}
                    onClick={() => openCaseModal(c)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Modal ── */}
        {selectedCase && (
          <CaseModal
            caseData={selectedCase}
            onClose={() => setSelectedCase(null)}
          />
        )}

        {/* ── Modal loading overlay ── */}
        {modalLoading && (
          <div style={styles.modalOverlay}>
            <div style={styles.spinner} />
          </div>
        )}
      </div>

      {/* ── Keyframe animation injection ── */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes slideIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Styles (inline — no Tailwind)
// ═══════════════════════════════════════════════════════════
const styles = {
  page: {
    minHeight: '100vh',
    background: '#0a0a14',
    color: '#e2e8f0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  container: {
    maxWidth: 1200,
    margin: '0 auto',
    padding: '24px 16px 64px',
  },

  // ── Header ──
  header: {
    marginBottom: 24,
  },
  headerTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
    flexWrap: 'wrap',
    gap: 12,
  },
  title: {
    fontSize: 30,
    fontWeight: 800,
    margin: 0,
    background: 'linear-gradient(135deg, #fbbf24, #f59e0b, #ef4444)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  subtitle: {
    color: '#64748b',
    fontSize: 14,
    marginTop: 4,
  },
  backLink: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '8px 18px',
    background: 'rgba(255,255,255,0.05)',
    color: '#94a3b8',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    textDecoration: 'none',
    transition: 'all 0.2s',
  },

  // ── Stats Bar ──
  statsBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
    padding: '16px 24px',
    background: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.06)',
    backdropFilter: 'blur(12px)',
    flexWrap: 'wrap',
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontSize: 22,
    fontWeight: 800,
    color: '#e2e8f0',
  },
  statLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: 500,
  },
  statDivider: {
    width: 1,
    height: 36,
    background: 'rgba(255,255,255,0.08)',
  },
  distPill: {
    padding: '4px 10px',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 700,
  },

  // ── Chart ──
  chartContainer: {
    padding: '16px 20px',
    background: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.06)',
    marginBottom: 20,
  },
  chartTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#94a3b8',
    marginBottom: 12,
  },
  chartBars: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 4,
    height: 100,
    padding: '0 4px',
  },
  barWrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  bar: {
    width: '100%',
    minWidth: 8,
    maxWidth: 36,
    borderRadius: '4px 4px 0 0',
    transition: 'height 0.4s ease',
  },
  barLabel: {
    fontSize: 9,
    color: '#64748b',
    marginTop: 4,
  },

  // ── Filter ──
  filterBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  filterGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  filterLabel: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: 600,
    marginRight: 4,
  },
  filterBtn: {
    padding: '6px 14px',
    background: 'rgba(255,255,255,0.04)',
    color: '#94a3b8',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  filterBtnActive: {
    background: 'rgba(251,191,36,0.15)',
    color: '#fbbf24',
    borderColor: 'rgba(251,191,36,0.3)',
  },

  // ── Grid ──
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: 16,
  },
  resultCount: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 12,
  },

  // ── Card ──
  card: {
    background: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 14,
    border: '1px solid rgba(255,255,255,0.08)',
    cursor: 'pointer',
    transition: 'all 0.25s ease',
    animation: 'fadeInUp 0.4s ease both',
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
  },
  caseBadge: {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 800,
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  batchBadge: {
    display: 'inline-block',
    padding: '3px 8px',
    background: 'rgba(139,92,246,0.15)',
    color: '#a78bfa',
    borderRadius: 6,
    fontSize: 10,
    fontWeight: 700,
  },
  thumbWrap: {
    width: '100%',
    aspectRatio: '1200/1350',
    borderRadius: 8,
    overflow: 'hidden',
    background: '#111',
    marginBottom: 10,
  },
  thumbImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  noImage: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#374151',
    fontSize: 14,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#e2e8f0',
    margin: '0 0 8px',
    lineHeight: 1.4,
  },
  cardMeta: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  scorePill: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 800,
    border: '1px solid',
  },
  metaText: {
    fontSize: 11,
    color: '#64748b',
  },
  cardDate: {
    fontSize: 11,
    color: '#475569',
    margin: 0,
  },

  // ── Modal ──
  modalOverlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.8)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 16,
  },
  modalContent: {
    background: '#12121e',
    borderRadius: 16,
    border: '1px solid rgba(255,255,255,0.1)',
    maxWidth: 700,
    width: '100%',
    maxHeight: '90vh',
    overflowY: 'auto',
    animation: 'slideIn 0.25s ease',
    boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  modalClose: {
    width: 36, height: 36,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(255,255,255,0.05)',
    color: '#94a3b8',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    fontSize: 16,
    cursor: 'pointer',
  },
  modalImageWrap: {
    padding: '0 20px',
    marginTop: 16,
  },
  modalImage: {
    width: '100%',
    borderRadius: 10,
    display: 'block',
  },
  modalDetails: {
    padding: '16px 20px 24px',
  },
  modalMeta: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: 12,
  },
  metaItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    background: 'rgba(255,255,255,0.03)',
    borderRadius: 8,
  },

  // ── States ──
  loadingWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '64px 0',
  },
  spinner: {
    width: 40, height: 40,
    border: '3px solid rgba(255,255,255,0.1)',
    borderTopColor: '#fbbf24',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  errorBox: {
    padding: '16px 20px',
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.2)',
    borderRadius: 10,
    color: '#fca5a5',
    fontSize: 14,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '64px 0',
  },
};
