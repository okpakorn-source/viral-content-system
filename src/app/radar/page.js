'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/layout/Header';

// === ค่าคงที่ — สี, ป้าย, ตัวเลือก ===
const HEAT_COLORS = { 3: '#ef4444', 2: '#f59e0b', 1: '#22c55e', 0: '#6b7280' };
const HEAT_LABELS = { 3: '🔥🔥🔥 ร้อนมาก', 2: '🔥🔥 กำลังมา', 1: '🔥 น่าสนใจ', 0: '❄️ เย็น' };
const CAT_COLORS = { drama: '#ef4444', celeb: '#f59e0b', politics: '#3b82f6', crime: '#dc2626', social: '#8b5cf6', tech: '#06b6d4', sport: '#22c55e', economy: '#eab308', health: '#ec4899', other: '#6b7280' };
const CAT_LABELS = { drama: 'ดราม่า', celeb: 'ดารา', politics: 'การเมือง', crime: 'อาชญากรรม', social: 'สังคม', tech: 'เทค', sport: 'กีฬา', economy: 'เศรษฐกิจ', health: 'สุขภาพ', other: 'ทั่วไป' };

// ★ 22 มิ.ย. 69: ปิดหน้า "เรดาร์หากระแส" (เลิกใช้แล้ว ใช้โต๊ะข่าวกลางแทน) — ไม่ยิง API = ไม่กินโทเคน
//   เปิดคืน: เปลี่ยนเป็น false + ตั้ง env RADAR_ENABLED=1 (ฝั่ง API)
const RADAR_DISABLED = true;

const SOURCE_OPTIONS = [
  { id: 'serper', label: 'Google News', icon: '🔍', default: true },
  { id: 'gdelt', label: 'GDELT', icon: '🌍', default: true },
  { id: 'rss', label: 'RSS สำนักข่าว', icon: '📰', default: true },
  { id: 'youtube', label: 'YouTube', icon: '🎥', default: true },
  { id: 'social', label: 'Social (FB/X/TikTok)', icon: '📱', default: true },
];

const TIME_OPTIONS = [
  { id: '24h', label: '24 ชม.' },
  { id: '3d', label: '3 วัน' },
  { id: '7d', label: '7 วัน' },
  { id: '30d', label: '30 วัน' },
];

// === ฟังก์ชันช่วย — คำนวณสีตามคะแนน ===
function heatScoreColor(s) {
  if (s >= 80) return '#ef4444';
  if (s >= 60) return '#f59e0b';
  if (s >= 40) return '#22c55e';
  return '#6b7280';
}

function heatGradient(s) {
  if (s >= 80) return 'linear-gradient(135deg, #ef4444, #dc2626)';
  if (s >= 60) return 'linear-gradient(135deg, #f59e0b, #d97706)';
  if (s >= 40) return 'linear-gradient(135deg, #22c55e, #16a34a)';
  return 'linear-gradient(135deg, #6b7280, #4b5563)';
}

function heatEmoji(s) {
  if (s >= 80) return '🔥🔥🔥';
  if (s >= 60) return '🔥🔥';
  if (s >= 40) return '🔥';
  return '❄️';
}

// === CSS Keyframes (inject ครั้งเดียว) ===
const GLOBAL_KEYFRAMES = `
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
@keyframes slideUp { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: translateY(0); } }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
`;

// ============================================================
// หน้าหลัก — Viral Radar 2.0
// ============================================================
export default function RadarPage() {
  const router = useRouter();

  // --- สถานะหลัก ---
  const [searchQuery, setSearchQuery] = useState('');
  const [step, setStep] = useState('dashboard'); // 'dashboard' | 'expanding' | 'results'
  const [clusters, setClusters] = useState([]);
  const [expandedQueries, setExpandedQueries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState({});

  // --- ตัวกรอง ---
  const [selectedSources, setSelectedSources] = useState(SOURCE_OPTIONS.filter(s => s.default).map(s => s.id));
  const [timeRange, setTimeRange] = useState('7d');

  // --- Dashboard ---
  const [hotKeywords, setHotKeywords] = useState([]);
  const [loadingKeywords, setLoadingKeywords] = useState(true);
  const [trending, setTrending] = useState(null);

  // --- Modal รายละเอียด Cluster ---
  const [selectedCluster, setSelectedCluster] = useState(null);
  const [showClusterModal, setShowClusterModal] = useState(false);

  // === โหลด Dashboard ตอน mount ===
  useEffect(() => {
    if (RADAR_DISABLED) return; // ★ ปิดเรดาร์ — ไม่ยิง API ใดๆ
    // โหลด hot keywords
    fetch('/api/radar?mode=keywords')
      .then(r => r.json())
      .then(d => { if (d.success) setHotKeywords(d.keywords || []); })
      .catch(() => {})
      .finally(() => setLoadingKeywords(false));

    // โหลด trending (ถ้า API พร้อม)
    fetch('/api/radar/trending')
      .then(r => r.json())
      .then(d => { if (d.success) setTrending(d); })
      .catch(() => {});
  }, []);

  // === ค้นหาคีย์เวิร์ด ===
  const handleSearch = useCallback(async (keyword) => {
    const q = keyword || searchQuery;
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    setStep('expanding');
    setSearchQuery(q);

    try {
      // ขั้นที่ 1: ขยายคีย์เวิร์ด (ถ้า API expand พร้อม)
      try {
        const expandRes = await fetch('/api/radar/expand', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword: q }),
        });
        const expandData = await expandRes.json();
        if (expandData.success) setExpandedQueries(expandData.queries || []);
      } catch {
        // fallback: ไม่มี expand API → ข้ามไป
        setExpandedQueries([]);
      }

      // ขั้นที่ 2: ค้นหาจริง
      setStep('results');
      const searchRes = await fetch(
        `/api/radar?mode=search&q=${encodeURIComponent(q)}&sources=${selectedSources.join(',')}&time=${timeRange}`
      );
      const searchData = await searchRes.json();

      if (searchData.success) {
        // รองรับทั้ง clusters (ใหม่) และ articles (เดิม)
        const items = searchData.clusters || searchData.articles || searchData.top5 || [];
        setClusters(items);
        setMeta({
          totalRaw: searchData.meta?.total || searchData.totalRaw || items.length,
          duplicatesRemoved: searchData.meta?.duplicatesFound || searchData.duplicatesRemoved || 0,
          clustersFormed: searchData.meta?.clustersTotal || searchData.totalClusters || items.length,
          aiSummary: searchData.aiSummary || null,
          query: q,
          scannedAt: new Date().toISOString(),
        });
      } else {
        setError(searchData.error || 'ค้นหาไม่สำเร็จ');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedSources, timeRange]);

  // === กลับหน้า Dashboard ===
  const goBack = useCallback(() => {
    setStep('dashboard');
    setClusters([]);
    setExpandedQueries([]);
    setError(null);
    setMeta({});
    setSearchQuery('');
  }, []);

  // === Toggle แหล่งข่าว ===
  const toggleSource = useCallback((sourceId) => {
    setSelectedSources(prev =>
      prev.includes(sourceId)
        ? prev.filter(s => s !== sourceId)
        : [...prev, sourceId]
    );
  }, []);

  // === เปิด/ปิด Modal ===
  const openClusterModal = useCallback((cluster) => {
    setSelectedCluster(cluster);
    setShowClusterModal(true);
  }, []);

  const closeClusterModal = useCallback(() => {
    setShowClusterModal(false);
    setTimeout(() => setSelectedCluster(null), 200);
  }, []);

  // ============================================================
  // RENDER
  // ============================================================
  // ★ 22 มิ.ย.: ปิดใช้งานเรดาร์ — แสดงหน้าแจ้งแทน (ไม่โหลด/ไม่ยิง API)
  if (RADAR_DISABLED) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#e8e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 460, textAlign: 'center', background: '#15151f', border: '1px solid #2a2a3e', borderRadius: 16, padding: '36px 28px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📡</div>
          <div style={{ fontSize: 19, fontWeight: 900, marginBottom: 10 }}>เรดาร์หากระแส — ปิดใช้งานแล้ว</div>
          <div style={{ fontSize: 14, lineHeight: 1.7, color: '#9aa', marginBottom: 22 }}>
            ระบบนี้เลิกใช้แล้ว ใช้ <b style={{ color: '#818cf8' }}>โต๊ะข่าวกลาง</b> หากระแส/ข่าวแทน — ปิดเพื่อไม่ให้เปิดทิ้งไว้แล้วกินโทเคนฟรีๆ
          </div>
          <a href="/news-desk" style={{ display: 'inline-block', padding: '11px 22px', borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', fontWeight: 800, fontSize: 14, textDecoration: 'none' }}>ไปโต๊ะข่าวกลาง →</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a' }}>
      <style>{GLOBAL_KEYFRAMES}</style>

      <Header
        title="📡 Viral Radar 2.0"
        subtitle={
          step === 'dashboard' ? 'ค้นข่าวไวรัล วิเคราะห์เทรนด์ เลือกมุมข่าว' :
          step === 'expanding' ? '🧠 AI กำลังขยายคีย์เวิร์ด...' :
          `ผลลัพธ์: "${meta.query || searchQuery}"`
        }
      />

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 20px 80px' }}>

        {/* ==================== SEARCH BAR ==================== */}
        <SearchBar
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onSearch={handleSearch}
          selectedSources={selectedSources}
          toggleSource={toggleSource}
          timeRange={timeRange}
          setTimeRange={setTimeRange}
          loading={loading}
        />

        {/* ==================== ERROR ==================== */}
        {error && (
          <div id="radar-error" style={{
            padding: '16px 20px', borderRadius: 12, marginBottom: 20,
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 20 }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#ef4444', fontWeight: 700, fontSize: 14 }}>{error}</div>
            </div>
            <button id="radar-error-dismiss" onClick={() => setError(null)} style={{
              background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 18,
            }}>✕</button>
          </div>
        )}

        {/* ==================== KEYWORD EXPANSION PANEL ==================== */}
        {expandedQueries.length > 0 && (step === 'expanding' || step === 'results') && (
          <KeywordExpansionPanel queries={expandedQueries} />
        )}

        {/* ==================== META BAR (เหนือผลลัพธ์) ==================== */}
        {step === 'results' && !loading && clusters.length > 0 && (
          <MetaBar meta={meta} expandedCount={expandedQueries.length} />
        )}

        {/* ==================== AI SUMMARY ==================== */}
        {step === 'results' && meta.aiSummary && (
          <div id="radar-ai-summary" style={{
            background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.08))',
            border: '1px solid rgba(99,102,241,0.25)', borderRadius: 14,
            padding: '16px 20px', marginBottom: 20,
            display: 'flex', alignItems: 'flex-start', gap: 12,
          }}>
            <span style={{ fontSize: 22, flexShrink: 0 }}>🧠</span>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#818cf8', marginBottom: 4, letterSpacing: 0.5 }}>
                AI สรุปสถานการณ์
              </div>
              <div style={{ fontSize: 14, color: '#e5e5e5', lineHeight: 1.7 }}>{meta.aiSummary}</div>
            </div>
          </div>
        )}

        {/* ==================== LOADING STATE ==================== */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '80px 20px' }}>
            <div style={{
              width: 52, height: 52, border: '4px solid rgba(255,255,255,0.06)',
              borderTopColor: '#a3e635', borderRadius: '50%',
              animation: 'spin 0.7s linear infinite', margin: '0 auto 20px',
            }} />
            <p style={{ color: '#a3a3a3', fontSize: 15, fontWeight: 500 }}>
              {step === 'expanding' ? '🧠 AI กำลังขยายคีย์เวิร์ดและค้นหา...' : '🔍 กำลังค้นข่าวจากหลายแหล่ง + AI วิเคราะห์...'}
            </p>
            <p style={{ color: '#525252', fontSize: 12, marginTop: 8 }}>อาจใช้เวลา 5-15 วินาที</p>
          </div>
        )}

        {/* ==================== DASHBOARD ==================== */}
        {step === 'dashboard' && !loading && (
          <DashboardSection
            hotKeywords={hotKeywords}
            loadingKeywords={loadingKeywords}
            trending={trending}
            onSearch={handleSearch}
            onRefresh={() => {
              setLoadingKeywords(true);
              fetch('/api/radar?mode=keywords')
                .then(r => r.json())
                .then(d => { if (d.success) setHotKeywords(d.keywords || []); })
                .catch(() => {})
                .finally(() => setLoadingKeywords(false));
            }}
          />
        )}

        {/* ==================== RESULTS — CLUSTER CARDS ==================== */}
        {step === 'results' && !loading && !error && clusters.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {clusters.map((cluster, i) => (
              <ClusterCard
                key={i}
                cluster={cluster}
                index={i}
                onViewDetail={() => openClusterModal(cluster)}
                onCreateContent={() => {
                  const bestUrl = cluster.link || cluster.sources?.[0]?.link || '';
                  router.push(`/content/new?url=${encodeURIComponent(bestUrl)}`);
                }}
                onSearchMore={() => handleSearch(cluster.title || cluster.keyword)}
                onFindImage={() => {
                  router.push(`/cover-maker?topic=${encodeURIComponent(cluster.title || '')}`);
                }}
              />
            ))}
          </div>
        )}

        {/* ไม่พบผลลัพธ์ */}
        {step === 'results' && !loading && !error && clusters.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
            <p style={{ color: '#a3a3a3', fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
              ไม่พบข่าวสำหรับคีย์เวิร์ดนี้
            </p>
            <button id="radar-go-back" onClick={goBack} style={{
              padding: '10px 24px', borderRadius: 10, border: 'none',
              background: 'rgba(255,255,255,0.06)', color: '#e5e5e5',
              cursor: 'pointer', fontWeight: 600, fontSize: 14,
            }}>← กลับหน้าหลัก</button>
          </div>
        )}

        {/* ปุ่มกลับ (step=results) */}
        {step === 'results' && !loading && (
          <div style={{ textAlign: 'center', marginTop: 32 }}>
            <button id="radar-back-to-dashboard" onClick={goBack} style={{
              padding: '12px 28px', borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.04)', color: '#a3a3a3',
              cursor: 'pointer', fontWeight: 600, fontSize: 14,
              transition: 'all 0.15s ease',
            }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#e5e5e5'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#a3a3a3'; }}
            >← กลับหน้า Radar</button>
          </div>
        )}
      </div>

      {/* ==================== CLUSTER DETAIL MODAL ==================== */}
      {showClusterModal && selectedCluster && (
        <ClusterDetailModal cluster={selectedCluster} onClose={closeClusterModal} />
      )}
    </div>
  );
}


// ============================================================
// SearchBar — ช่องค้นหา + ตัวเลือกแหล่งข่าว/เวลา
// ============================================================
function SearchBar({ searchQuery, setSearchQuery, onSearch, selectedSources, toggleSource, timeRange, setTimeRange, loading }) {
  const [focused, setFocused] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  return (
    <div id="radar-searchbar" style={{
      marginBottom: 24, borderRadius: 16, overflow: 'hidden',
      background: 'rgba(255,255,255,0.04)',
      border: `1px solid ${focused ? 'rgba(163,230,53,0.35)' : 'rgba(255,255,255,0.06)'}`,
      transition: 'border-color 0.2s ease',
    }}>
      {/* ช่องค้นหาหลัก */}
      <form
        onSubmit={e => { e.preventDefault(); onSearch(); }}
        style={{ display: 'flex', alignItems: 'center', padding: '4px 4px 4px 16px', gap: 8 }}
      >
        <span style={{ fontSize: 20, flexShrink: 0, opacity: 0.6 }}>🔍</span>
        <input
          id="radar-search-input"
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="ค้นข่าวไวรัล... เช่น เอวา, หม่ำ จ๊กมก, เบลล่า"
          style={{
            flex: 1, padding: '14px 8px', border: 'none', outline: 'none',
            background: 'transparent', color: '#e5e5e5', fontSize: 15, fontWeight: 500,
          }}
        />
        <button
          id="radar-filter-toggle"
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          style={{
            padding: '10px 14px', borderRadius: 10, border: 'none',
            background: showFilters ? 'rgba(163,230,53,0.12)' : 'rgba(255,255,255,0.06)',
            color: showFilters ? '#a3e635' : '#a3a3a3',
            cursor: 'pointer', fontSize: 14, fontWeight: 600, transition: 'all 0.15s',
          }}
        >⚙️ ตัวกรอง</button>
        <button
          id="radar-search-btn"
          type="submit"
          disabled={loading || !searchQuery.trim()}
          style={{
            padding: '12px 24px', borderRadius: 12, border: 'none',
            background: loading ? '#374151' : 'linear-gradient(135deg, #a3e635, #65a30d)',
            color: loading ? '#6b7280' : '#0a0a0a', fontWeight: 800, fontSize: 15,
            cursor: loading ? 'not-allowed' : 'pointer', transition: 'all 0.15s',
          }}
        >{loading ? '...' : 'ค้นหา'}</button>
      </form>

      {/* ตัวกรอง (แหล่งข่าว + ช่วงเวลา) */}
      {showFilters && (
        <div style={{
          padding: '14px 16px', borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12,
        }}>
          {/* แหล่งข่าว */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, marginRight: 4 }}>แหล่ง:</span>
            {SOURCE_OPTIONS.map(src => (
              <button
                key={src.id}
                id={`radar-src-${src.id}`}
                onClick={() => toggleSource(src.id)}
                style={{
                  padding: '5px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  border: `1px solid ${selectedSources.includes(src.id) ? 'rgba(163,230,53,0.3)' : 'rgba(255,255,255,0.08)'}`,
                  background: selectedSources.includes(src.id) ? 'rgba(163,230,53,0.1)' : 'transparent',
                  color: selectedSources.includes(src.id) ? '#a3e635' : '#737373',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >{src.icon} {src.label}</button>
            ))}
          </div>

          {/* ช่วงเวลา */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
            <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, marginRight: 4 }}>ช่วงเวลา:</span>
            {TIME_OPTIONS.map(t => (
              <button
                key={t.id}
                id={`radar-time-${t.id}`}
                onClick={() => setTimeRange(t.id)}
                style={{
                  padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  border: 'none',
                  background: timeRange === t.id ? 'rgba(163,230,53,0.15)' : 'transparent',
                  color: timeRange === t.id ? '#a3e635' : '#737373',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >{t.label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ============================================================
// KeywordExpansionPanel — แสดง queries ที่ AI ขยายออก
// ============================================================
function KeywordExpansionPanel({ queries }) {
  const [collapsed, setCollapsed] = useState(false);

  if (!queries || queries.length === 0) return null;

  return (
    <div id="radar-expansion-panel" style={{
      marginBottom: 20, borderRadius: 14, overflow: 'hidden',
      background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.15)',
    }}>
      <button
        id="radar-expansion-toggle"
        onClick={() => setCollapsed(!collapsed)}
        style={{
          width: '100%', padding: '12px 16px', border: 'none', cursor: 'pointer',
          background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          color: '#818cf8', fontSize: 13, fontWeight: 700,
        }}
      >
        <span>🧠 AI ขยายคีย์เวิร์ด ({queries.length} queries)</span>
        <span style={{ fontSize: 11, opacity: 0.7 }}>{collapsed ? '▼ ดู' : '▲ ซ่อน'}</span>
      </button>

      {!collapsed && (
        <div style={{
          padding: '0 16px 14px', display: 'flex', flexWrap: 'wrap', gap: 8,
        }}>
          {queries.map((q, i) => (
            <span key={i} style={{
              padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: 'rgba(99,102,241,0.1)', color: '#a5b4fc',
              border: '1px solid rgba(99,102,241,0.2)',
            }}>
              {q.type && <span style={{ opacity: 0.6, marginRight: 4, fontSize: 10 }}>[{q.type}]</span>}
              {q.query || q}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}


// ============================================================
// MetaBar — แถบข้อมูลสรุปเหนือผลลัพธ์
// ============================================================
function MetaBar({ meta, expandedCount }) {
  return (
    <div id="radar-meta-bar" style={{
      display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      padding: '12px 16px', marginBottom: 16, borderRadius: 12,
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
      fontSize: 12, color: '#737373',
    }}>
      {meta.totalRaw > 0 && (
        <span id="radar-meta-total">📰 ข่าวดิบ <b style={{ color: '#e5e5e5' }}>{meta.totalRaw}</b> เรื่อง</span>
      )}
      {meta.duplicatesRemoved > 0 && (
        <span id="radar-meta-dedup">🔄 กำจัดซ้ำ <b style={{ color: '#f59e0b' }}>{meta.duplicatesRemoved}</b></span>
      )}
      {meta.clustersFormed > 0 && (
        <span id="radar-meta-clusters">📦 จัดกลุ่มได้ <b style={{ color: '#a3e635' }}>{meta.clustersFormed}</b> คลัสเตอร์</span>
      )}
      {expandedCount > 0 && (
        <span id="radar-meta-expanded">🧠 ขยาย <b style={{ color: '#818cf8' }}>{expandedCount}</b> queries</span>
      )}
      {meta.scannedAt && (
        <span style={{ marginLeft: 'auto', fontSize: 11 }}>
          🕐 {new Date(meta.scannedAt).toLocaleTimeString('th-TH')}
        </span>
      )}
    </div>
  );
}


// ============================================================
// DashboardSection — แดชบอร์ดหน้าหลัก (keywords + trending)
// ============================================================
function DashboardSection({ hotKeywords, loadingKeywords, trending, onSearch, onRefresh }) {
  return (
    <div id="radar-dashboard">
      {/* Loading skeleton */}
      {loadingKeywords && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{
            width: 48, height: 48, border: '4px solid rgba(255,255,255,0.06)',
            borderTopColor: '#a3e635', borderRadius: '50%',
            animation: 'spin 0.7s linear infinite', margin: '0 auto 16px',
          }} />
          <p style={{ color: '#a3a3a3', fontSize: 14 }}>🧠 AI กำลังสแกนเทรนด์ร้อน...</p>
        </div>
      )}

      {/* คีย์เวิร์ดร้อน */}
      {!loadingKeywords && hotKeywords.length > 0 && (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', background: '#22c55e',
                display: 'inline-block', animation: 'pulse 2s infinite',
              }} />
              <span style={{ fontSize: 13, color: '#a3a3a3', fontWeight: 600 }}>
                พบ {hotKeywords.length} คีย์เวิร์ดร้อน — กดเลือกเพื่อหาข่าว
              </span>
            </div>
            <button id="radar-refresh-keywords" onClick={onRefresh} style={{
              padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)',
              background: 'transparent', color: '#a3a3a3', fontSize: 13, cursor: 'pointer',
              transition: 'all 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#e5e5e5'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#a3a3a3'; }}
            >🔄 สแกนใหม่</button>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
            gap: 12, marginBottom: 32,
          }}>
            {hotKeywords.map((kw, i) => (
              <HotKeywordCard key={i} keyword={kw} index={i} onClick={() => onSearch(kw.searchQuery || kw.keyword)} />
            ))}
          </div>
        </>
      )}

      {/* ไม่พบคีย์เวิร์ด */}
      {!loadingKeywords && hotKeywords.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📡</div>
          <p style={{ color: '#a3a3a3', fontSize: 15 }}>ยังไม่มีเทรนด์ — ลองพิมพ์ค้นหาด้านบน</p>
          <button id="radar-retry-keywords" onClick={onRefresh} style={{
            marginTop: 12, padding: '10px 24px', borderRadius: 10, border: 'none',
            background: 'rgba(163,230,53,0.15)', color: '#a3e635', fontWeight: 700,
            cursor: 'pointer', fontSize: 14,
          }}>🔄 ลองสแกนอีกครั้ง</button>
        </div>
      )}

      {/* Trending Categories (ถ้ามีข้อมูล) */}
      {trending && trending.categories && trending.categories.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 13, color: '#a3a3a3', fontWeight: 700, marginBottom: 14, letterSpacing: 0.5 }}>
            📊 หมวดหมู่เทรนด์
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12,
          }}>
            {trending.categories.map((cat, i) => (
              <div key={i} id={`radar-trend-cat-${i}`} style={{
                padding: '16px', borderRadius: 14,
                background: `linear-gradient(135deg, ${(CAT_COLORS[cat.id] || '#6b7280') + '12'}, transparent)`,
                border: `1px solid ${(CAT_COLORS[cat.id] || '#6b7280') + '22'}`,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
                onClick={() => onSearch(cat.topKeyword || cat.name)}
                onMouseEnter={e => { e.currentTarget.style.borderColor = (CAT_COLORS[cat.id] || '#6b7280') + '55'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = (CAT_COLORS[cat.id] || '#6b7280') + '22'; e.currentTarget.style.transform = 'none'; }}
              >
                <div style={{ fontSize: 13, fontWeight: 800, color: CAT_COLORS[cat.id] || '#6b7280', marginBottom: 10 }}>
                  {CAT_LABELS[cat.id] || cat.name}
                </div>
                {(cat.articles || []).slice(0, 3).map((a, j) => (
                  <div key={j} style={{ fontSize: 12, color: '#a3a3a3', lineHeight: 1.6, marginBottom: 2 }}>
                    • {a.title?.slice(0, 50) || a}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ============================================================
// HotKeywordCard — การ์ดคีย์เวิร์ดร้อน
// ============================================================
function HotKeywordCard({ keyword, index, onClick }) {
  const [hovered, setHovered] = useState(false);
  const heat = keyword.heatLevel || 1;
  const color = HEAT_COLORS[heat] || '#6b7280';
  const catColor = CAT_COLORS[keyword.category] || '#6b7280';

  return (
    <button
      id={`radar-kw-${index}`}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? `${color}12` : 'rgba(255,255,255,0.04)',
        border: `1px solid ${hovered ? color + '55' : 'rgba(255,255,255,0.06)'}`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 14,
        padding: '16px 20px',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.2s ease',
        transform: hovered ? 'translateY(-2px)' : 'none',
        boxShadow: hovered ? `0 8px 24px ${color}15` : 'none',
        animation: `fadeUp ${0.15 + index * 0.04}s ease-out both`,
      }}
    >
      {/* ด้านบน: Heat + Category */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color, letterSpacing: 0.5 }}>
          {HEAT_LABELS[heat] || '🔥'}
        </span>
        <span style={{
          fontSize: 9, fontWeight: 700, color: catColor,
          background: catColor + '15', padding: '3px 10px', borderRadius: 8,
        }}>
          {CAT_LABELS[keyword.category] || keyword.category}
        </span>
      </div>

      {/* ข้อความคีย์เวิร์ด */}
      <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff', lineHeight: 1.5 }}>
        {keyword.keyword}
      </div>

      {/* Hint กด */}
      <div style={{
        fontSize: 11, color: hovered ? color : '#525252',
        marginTop: 10, fontWeight: 600, transition: 'color 0.2s',
      }}>
        {hovered ? '⚡ กดเพื่อหาข่าว →' : 'กดเพื่อค้นหาข่าว'}
      </div>
    </button>
  );
}


// ============================================================
// ClusterCard — การ์ดผลลัพธ์ (Cluster / Article)
// ============================================================
function ClusterCard({ cluster, index, onViewDetail, onCreateContent, onSearchMore, onFindImage }) {
  const [hovered, setHovered] = useState(false);
  const score = cluster.heatScore || 50;
  const scoreColor = heatScoreColor(score);
  const credibility = cluster.credibilityScore || cluster.credibility || 0;
  const rewriteScore = cluster.rewriteScore || cluster.writability || 0;

  // รวมแหล่งข่าว
  const sourceNames = cluster.sources
    ? (Array.isArray(cluster.sources)
      ? cluster.sources.map(s => typeof s === 'string' ? s : s.name || s.source || '')
      : [])
    : [];
  const sourceCount = cluster.sourceCount || sourceNames.length || 1;

  return (
    <div
      id={`radar-cluster-${index}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${hovered ? scoreColor + '44' : 'rgba(255,255,255,0.06)'}`,
        borderRadius: 16, overflow: 'hidden',
        transition: 'all 0.2s ease',
        animation: `fadeUp ${0.15 + index * 0.06}s ease-out both`,
      }}
    >
      <div style={{ display: 'flex' }}>

        {/* คอลัมน์ Heat Score */}
        <div style={{
          width: 80, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 4,
          background: `${scoreColor}08`, borderRight: `3px solid ${scoreColor}`,
          flexShrink: 0, padding: '20px 0',
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: '50%',
            background: heatGradient(score),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, fontWeight: 900, color: '#fff',
            boxShadow: `0 4px 16px ${scoreColor}40`,
          }}>
            {score}
          </div>
          <div style={{ fontSize: 8, fontWeight: 800, color: scoreColor, letterSpacing: 1 }}>
            {heatEmoji(score)}
          </div>
          <div style={{ fontSize: 10, fontWeight: 900, color: scoreColor, opacity: 0.7 }}>HEAT</div>
        </div>

        {/* เนื้อหา */}
        <div style={{ flex: 1, padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* แถวบน: อันดับ + แหล่ง */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 11, fontWeight: 900, color: '#fff',
              background: scoreColor, padding: '3px 10px', borderRadius: 6,
            }}>#{cluster.rank || index + 1}</span>
            <span style={{ fontSize: 11, color: '#737373' }}>
              📰 {sourceCount} แหล่ง
            </span>
            {credibility > 0 && (
              <span style={{ fontSize: 11, color: '#a3a3a3' }}>
                ⭐ น่าเชื่อถือ {credibility}
              </span>
            )}
            {rewriteScore > 0 && (
              <span style={{ fontSize: 11, color: '#a3a3a3' }}>
                ✍️ เขียนได้ {rewriteScore}
              </span>
            )}
          </div>

          {/* หัวข้อข่าว */}
          <h3 style={{
            margin: 0, fontSize: 17, fontWeight: 800, color: '#ffffff',
            lineHeight: 1.55, letterSpacing: -0.2,
          }}>
            {cluster.title}
          </h3>

          {/* สรุปข่าว */}
          {cluster.snippet && (
            <p style={{ margin: 0, fontSize: 13, color: '#a3a3a3', lineHeight: 1.6 }}>
              {cluster.snippet?.slice(0, 180)}{cluster.snippet?.length > 180 ? '...' : ''}
            </p>
          )}

          {/* Angle + Hook + Risk */}
          {(cluster.suggestedAngles?.length > 0 || cluster.whyHot || cluster.hook || cluster.riskLevel) && (
            <div style={{
              padding: '10px 14px', borderRadius: 10,
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.04)',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              {/* มุมข่าวแนะนำ */}
              {cluster.suggestedAngles?.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: '#818cf8', fontWeight: 700 }}>💡 Angle:</span>
                  {cluster.suggestedAngles.map((a, j) => (
                    <span key={j} style={{
                      fontSize: 11, padding: '2px 10px', borderRadius: 8,
                      background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', fontWeight: 600,
                    }}>{a}</span>
                  ))}
                </div>
              )}

              {/* Hook */}
              {cluster.hook && (
                <div style={{ fontSize: 12, color: '#f59e0b' }}>
                  ⚡ Hook: <span style={{ color: '#e5e5e5', fontStyle: 'italic' }}>"{cluster.hook}"</span>
                </div>
              )}

              {/* Why hot */}
              {cluster.whyHot && (
                <div style={{ fontSize: 12, color: scoreColor, fontWeight: 600 }}>
                  🎯 {cluster.whyHot}
                </div>
              )}

              {/* Risk */}
              {cluster.riskLevel && (
                <div style={{ fontSize: 11, color: '#ef4444' }}>
                  ⚠️ {cluster.riskLevel}
                </div>
              )}
            </div>
          )}

          {/* แหล่งข่าว pills */}
          {sourceNames.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, color: '#525252', fontWeight: 600 }}>Sources:</span>
              {sourceNames.slice(0, 6).map((name, j) => (
                <span key={j} style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 6,
                  background: 'rgba(255,255,255,0.06)', color: '#a3a3a3', fontWeight: 500,
                }}>{name}</span>
              ))}
              {sourceNames.length > 6 && (
                <span style={{ fontSize: 10, color: '#525252' }}>+{sourceNames.length - 6}</span>
              )}
            </div>
          )}

          {/* ปุ่มการทำงาน */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            <button
              id={`radar-cluster-${index}-detail`}
              onClick={onViewDetail}
              style={{
                padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
                color: '#e5e5e5', cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
            >🔍 ดูทุกแหล่ง</button>

            <button
              id={`radar-cluster-${index}-create`}
              onClick={onCreateContent}
              style={{
                padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                border: 'none',
                background: `linear-gradient(135deg, ${scoreColor}, ${scoreColor}bb)`,
                color: '#fff', cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
            >⚡ สร้างข่าว</button>

            <button
              id={`radar-cluster-${index}-more`}
              onClick={onSearchMore}
              style={{
                padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                border: '1px solid rgba(255,255,255,0.08)', background: 'transparent',
                color: '#a3a3a3', cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#e5e5e5'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#a3a3a3'; }}
            >🔎 หาเพิ่ม</button>

            <button
              id={`radar-cluster-${index}-image`}
              onClick={onFindImage}
              style={{
                padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                border: '1px solid rgba(255,255,255,0.08)', background: 'transparent',
                color: '#a3a3a3', cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#e5e5e5'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#a3a3a3'; }}
            >🖼️ หาภาพ</button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ============================================================
// ClusterDetailModal — ป๊อปอัพรายละเอียดข่าว
// ============================================================
function ClusterDetailModal({ cluster, onClose }) {
  const sources = cluster.sources || [];
  const angles = cluster.suggestedAngles || [];

  // กำหนด tier ให้แหล่งข่าว (ถ้ามี)
  const getTierBadge = (source) => {
    const name = (typeof source === 'string' ? source : source.name || source.source || '').toLowerCase();
    if (['ไทยรัฐ', 'เดลินิวส์', 'มติชน', 'ข่าวสด', 'bbc', 'reuters', 'bangkokpost'].some(t => name.includes(t)))
      return { tier: 'A', color: '#22c55e' };
    if (['sanook', 'kapook', 'pptvhd', 'workpoint', 'thairath'].some(t => name.includes(t)))
      return { tier: 'B', color: '#f59e0b' };
    return { tier: 'C', color: '#6b7280' };
  };

  return (
    <div
      id="radar-cluster-modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        animation: 'fadeUp 0.2s ease-out',
      }}
    >
      <div
        id="radar-cluster-modal-content"
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 700, maxHeight: '85vh',
          overflowY: 'auto',
          background: 'rgba(18,18,18,0.98)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '20px 20px 0 0',
          padding: '24px 28px 40px',
          animation: 'slideUp 0.3s ease-out',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 12px', borderRadius: 8, marginBottom: 10,
              background: heatGradient(cluster.heatScore || 50),
              fontSize: 12, fontWeight: 900, color: '#fff',
            }}>
              {heatEmoji(cluster.heatScore || 50)} HEAT {cluster.heatScore || 50}
            </div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#ffffff', lineHeight: 1.5 }}>
              {cluster.title}
            </h2>
          </div>
          <button
            id="radar-modal-close"
            onClick={onClose}
            style={{
              width: 36, height: 36, borderRadius: 10, border: 'none',
              background: 'rgba(255,255,255,0.08)', color: '#a3a3a3',
              fontSize: 18, cursor: 'pointer', flexShrink: 0, marginLeft: 12,
            }}
          >✕</button>
        </div>

        {/* สรุป */}
        {cluster.snippet && (
          <p style={{ fontSize: 14, color: '#a3a3a3', lineHeight: 1.7, marginBottom: 20 }}>
            {cluster.snippet}
          </p>
        )}

        {/* แหล่งข่าวทั้งหมด (Timeline) */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#e5e5e5', marginBottom: 12 }}>
            📰 แหล่งข่าวทั้งหมด ({sources.length || 'ไม่ทราบจำนวน'})
          </div>

          {sources.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sources.map((src, i) => {
                const name = typeof src === 'string' ? src : src.name || src.source || `แหล่ง ${i + 1}`;
                const link = typeof src === 'object' ? src.link || src.url || '' : '';
                const date = typeof src === 'object' ? src.date || '' : '';
                const { tier, color } = getTierBadge(src);
                const isBest = i === 0;

                return (
                  <div key={i} style={{
                    padding: '12px 16px', borderRadius: 10,
                    background: isBest ? 'rgba(163,230,53,0.06)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${isBest ? 'rgba(163,230,53,0.2)' : 'rgba(255,255,255,0.05)'}`,
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    {/* Tier badge */}
                    <span style={{
                      width: 28, height: 28, borderRadius: 8, display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      background: `${color}20`, color, fontSize: 12, fontWeight: 900,
                    }}>{tier}</span>

                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#e5e5e5' }}>
                        {isBest && <span style={{ color: '#a3e635', marginRight: 6 }}>⭐ แหล่งหลัก</span>}
                        {name}
                      </div>
                      {date && <div style={{ fontSize: 11, color: '#525252', marginTop: 2 }}>{date}</div>}
                    </div>

                    {link && (
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: 11, color: '#3b82f6', textDecoration: 'none', fontWeight: 600,
                        }}
                      >เปิดลิงก์ →</a>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#525252', padding: '12px 0' }}>
              ไม่มีรายละเอียดแหล่งข่าวเพิ่มเติม
            </div>
          )}
        </div>

        {/* มุมข่าวแนะนำ */}
        {angles.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#e5e5e5', marginBottom: 12 }}>
              💡 มุมข่าวแนะนำ
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {angles.map((angle, i) => (
                <div key={i} style={{
                  padding: '10px 14px', borderRadius: 10,
                  background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)',
                  fontSize: 13, color: '#a5b4fc', fontWeight: 600,
                }}>
                  {i + 1}. {angle}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Hook แนะนำ */}
        {cluster.hook && (
          <div style={{
            padding: '14px 18px', borderRadius: 12, marginBottom: 24,
            background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#f59e0b', marginBottom: 6 }}>⚡ Hook แนะนำ</div>
            <div style={{ fontSize: 14, color: '#e5e5e5', fontStyle: 'italic', lineHeight: 1.6 }}>
              "{cluster.hook}"
            </div>
          </div>
        )}

        {/* Why hot */}
        {cluster.whyHot && (
          <div style={{
            padding: '14px 18px', borderRadius: 12, marginBottom: 24,
            background: `${heatScoreColor(cluster.heatScore || 50)}08`,
            border: `1px solid ${heatScoreColor(cluster.heatScore || 50)}22`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: heatScoreColor(cluster.heatScore || 50), marginBottom: 6 }}>
              🎯 ทำไมข่าวนี้น่าสนใจ
            </div>
            <div style={{ fontSize: 14, color: '#e5e5e5', lineHeight: 1.6 }}>
              {cluster.whyHot}
            </div>
          </div>
        )}

        {/* Risk */}
        {cluster.riskLevel && (
          <div style={{
            padding: '12px 16px', borderRadius: 10,
            background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)',
            fontSize: 13, color: '#fca5a5', fontWeight: 600, marginBottom: 24,
          }}>
            ⚠️ ข้อควรระวัง: {cluster.riskLevel}
          </div>
        )}
      </div>
    </div>
  );
}
