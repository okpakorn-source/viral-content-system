'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/layout/Header';

const HEAT_COLORS = { 3: '#ef4444', 2: '#f59e0b', 1: '#22c55e' };
const HEAT_LABELS = { 3: '🔥🔥🔥 ร้อนมาก', 2: '🔥🔥 กำลังมา', 1: '🔥 น่าสนใจ' };
const CAT_COLORS = {
  drama: '#f59e0b', celeb: '#a855f7', politics: '#3b82f6', crime: '#dc2626',
  social: '#10b981', tech: '#06b6d4', sport: '#84cc16', economy: '#f97316',
  health: '#ec4899', other: '#64748b',
};
const CAT_LABELS = {
  drama: 'ดราม่า', celeb: 'บันเทิง', politics: 'การเมือง', crime: 'อาชญากรรม',
  social: 'สังคม', tech: 'เทค/AI', sport: 'กีฬา', economy: 'เศรษฐกิจ',
  health: 'สุขภาพ', other: 'อื่นๆ',
};

function heatScoreColor(s) {
  if (s >= 80) return '#ef4444';
  if (s >= 60) return '#f59e0b';
  if (s >= 40) return '#22c55e';
  return '#64748b';
}

export default function RadarPage() {
  const router = useRouter();

  // State
  const [step, setStep] = useState('keywords'); // 'keywords' | 'results'
  const [keywords, setKeywords] = useState([]);
  const [loadingKeywords, setLoadingKeywords] = useState(true);
  const [selectedKeyword, setSelectedKeyword] = useState(null);
  const [results, setResults] = useState([]);
  const [aiSummary, setAiSummary] = useState('');
  const [resultMeta, setResultMeta] = useState({});
  const [loadingResults, setLoadingResults] = useState(false);
  const [error, setError] = useState(null);
  const [customSearch, setCustomSearch] = useState('');

  // Step 1: Load hot keywords on mount
  useEffect(() => {
    loadKeywords();
  }, []);

  const loadKeywords = async () => {
    setLoadingKeywords(true);
    setError(null);
    try {
      const res = await fetch('/api/radar?mode=keywords');
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setKeywords(data.keywords || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingKeywords(false);
    }
  };

  // Step 2: Search specific keyword
  const searchKeyword = async (keyword, query) => {
    setStep('results');
    setSelectedKeyword(keyword);
    setLoadingResults(true);
    setError(null);
    setResults([]);
    setAiSummary('');
    try {
      const searchQ = query || keyword.searchQuery || keyword.keyword;
      const res = await fetch(`/api/radar?mode=search&q=${encodeURIComponent(searchQ)}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setResults(data.articles || []);
      setAiSummary(data.aiSummary || '');
      setResultMeta({
        totalRaw: data.totalRaw,
        duplicatesRemoved: data.duplicatesRemoved,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingResults(false);
    }
  };

  const handleCustomSearch = (e) => {
    e.preventDefault();
    if (!customSearch.trim()) return;
    searchKeyword(
      { keyword: customSearch.trim(), category: 'other', heatLevel: 2 },
      customSearch.trim()
    );
  };

  const goBack = () => {
    setStep('keywords');
    setSelectedKeyword(null);
    setResults([]);
    setAiSummary('');
    setError(null);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <Header
        title="📡 Viral Radar"
        subtitle={step === 'keywords' ? 'เลือกประเด็นที่สนใจ แล้วกดเพื่อหาข่าว' : `ผลลัพธ์: ${selectedKeyword?.keyword || ''}`}
      />

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '20px 20px 60px' }}>

        {/* ================= STEP 1: KEYWORD SELECTION ================= */}
        {step === 'keywords' && (
          <>
            {/* Custom search */}
            <form onSubmit={handleCustomSearch} style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
              <input
                type="text" value={customSearch} onChange={e => setCustomSearch(e.target.value)}
                placeholder="🔍 หรือพิมพ์คีย์เวิร์ดเอง เช่น คริปโต, น้ำท่วม, BTS..."
                style={{
                  flex: 1, padding: '12px 16px', borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)', background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)', fontSize: 14, outline: 'none',
                }}
              />
              <button type="submit" style={{
                padding: '12px 20px', borderRadius: 'var(--radius-md)', border: 'none',
                background: 'var(--accent)', color: '#fff', fontWeight: 700, cursor: 'pointer',
              }}>ค้นหา</button>
              <button type="button" onClick={loadKeywords} disabled={loadingKeywords}
                style={{
                  padding: '12px 14px', borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)', background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)', cursor: loadingKeywords ? 'not-allowed' : 'pointer',
                  opacity: loadingKeywords ? 0.5 : 1,
                }}>🔄</button>
            </form>

            {/* Loading keywords */}
            {loadingKeywords && (
              <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{
                  width: 48, height: 48, border: '4px solid var(--border)',
                  borderTopColor: 'var(--accent)', borderRadius: '50%',
                  animation: 'spin .7s linear infinite', margin: '0 auto 16px',
                }} />
                <p style={{ color: 'var(--text-muted)' }}>🧠 AI กำลังสแกนเทรนด์ร้อน...</p>
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              </div>
            )}

            {/* Error */}
            {error && !loadingKeywords && (
              <div style={{
                textAlign: 'center', padding: '40px 20px', background: 'var(--bg-secondary)',
                borderRadius: 'var(--radius-lg)', border: '1px solid var(--danger)',
              }}>
                <p style={{ color: 'var(--danger)', fontWeight: 600 }}>⚠️ {error}</p>
                <button onClick={loadKeywords} style={{
                  marginTop: 12, padding: '8px 20px', borderRadius: 'var(--radius-md)',
                  border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer',
                }}>ลองอีกครั้ง</button>
              </div>
            )}

            {/* Keyword cards */}
            {!loadingKeywords && !error && keywords.length > 0 && (
              <>
                <div style={{
                  fontSize: 12, color: 'var(--text-muted)', marginBottom: 16,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%', background: 'var(--success)',
                    display: 'inline-block',
                  }} />
                  พบ {keywords.length} คีย์เวิร์ดร้อน — กดเลือกเพื่อหาข่าว
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 12,
                }}>
                  {keywords.map((kw, i) => (
                    <KeywordCard
                      key={i} keyword={kw} index={i}
                      onClick={() => searchKeyword(kw)}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ================= STEP 2: SEARCH RESULTS ================= */}
        {step === 'results' && (
          <>
            {/* Back button + keyword badge */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20,
              flexWrap: 'wrap',
            }}>
              <button onClick={goBack} style={{
                padding: '8px 16px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)', background: 'var(--bg-secondary)',
                color: 'var(--text-primary)', fontWeight: 600, cursor: 'pointer',
                fontSize: 13, display: 'flex', alignItems: 'center', gap: 6,
              }}>
                ← กลับเลือกคีย์
              </button>

              {selectedKeyword && (
                <div style={{
                  padding: '8px 16px', borderRadius: 20,
                  background: (CAT_COLORS[selectedKeyword.category] || '#64748b') + '18',
                  border: `1px solid ${CAT_COLORS[selectedKeyword.category] || '#64748b'}44`,
                  color: CAT_COLORS[selectedKeyword.category] || '#64748b',
                  fontWeight: 800, fontSize: 14,
                }}>
                  {selectedKeyword.keyword}
                </div>
              )}

              {!loadingResults && resultMeta.totalRaw > 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  ข่าวดิบ {resultMeta.totalRaw} เรื่อง
                  {resultMeta.duplicatesRemoved > 0 && ` → กำจัดซ้ำ ${resultMeta.duplicatesRemoved}`}
                </span>
              )}
            </div>

            {/* AI Summary */}
            {aiSummary && (
              <div style={{
                background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.08))',
                border: '1px solid rgba(99,102,241,0.25)', borderRadius: 'var(--radius-lg)',
                padding: '14px 20px', marginBottom: 20,
                display: 'flex', alignItems: 'flex-start', gap: 10,
              }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>🧠</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#818cf8', marginBottom: 4 }}>AI สรุปสถานการณ์</div>
                  <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{aiSummary}</div>
                </div>
              </div>
            )}

            {/* Loading results */}
            {loadingResults && (
              <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{
                  width: 48, height: 48, border: '4px solid var(--border)',
                  borderTopColor: '#f59e0b', borderRadius: '50%',
                  animation: 'spin .7s linear infinite', margin: '0 auto 16px',
                }} />
                <p style={{ color: 'var(--text-muted)' }}>
                  🔍 กำลังหาข่าว "{selectedKeyword?.keyword}" + AI วิเคราะห์...
                </p>
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              </div>
            )}

            {/* Error */}
            {error && !loadingResults && (
              <div style={{
                textAlign: 'center', padding: '40px', background: 'var(--bg-secondary)',
                borderRadius: 'var(--radius-lg)', border: '1px solid var(--danger)',
              }}>
                <p style={{ color: 'var(--danger)', fontWeight: 600 }}>⚠️ {error}</p>
                <button onClick={goBack} style={{
                  marginTop: 12, padding: '8px 20px', borderRadius: 'var(--radius-md)',
                  border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer',
                }}>กลับเลือกคีย์อื่น</button>
              </div>
            )}

            {/* Result cards */}
            {!loadingResults && !error && results.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {results.map((article, i) => (
                  <ResultCard
                    key={i} article={article} index={i}
                    onCreateContent={() => {
                      router.push(`/content/new?url=${encodeURIComponent(article.link || '')}`);
                    }}
                  />
                ))}
              </div>
            )}

            {!loadingResults && !error && results.length === 0 && (
              <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
                ไม่พบข่าวสำหรับคีย์เวิร์ดนี้ — ลองเลือกคีย์อื่น
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// === Keyword Card ===
function KeywordCard({ keyword, index, onClick }) {
  const [hovered, setHovered] = useState(false);
  const heat = keyword.heatLevel || 1;
  const color = HEAT_COLORS[heat] || '#64748b';
  const catColor = CAT_COLORS[keyword.category] || '#64748b';

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? `${color}12` : 'var(--bg-secondary)',
        border: `1px solid ${hovered ? color + '55' : 'var(--border)'}`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 'var(--radius-lg)',
        padding: '16px 20px',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.2s',
        transform: hovered ? 'translateY(-2px)' : 'none',
        boxShadow: hovered ? `0 6px 20px ${color}15` : 'none',
        animation: `fadeUp ${0.2 + index * 0.04}s ease-out both`,
      }}
    >
      <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {/* Top: Heat + Category */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 800, color, letterSpacing: 0.5,
        }}>
          {HEAT_LABELS[heat] || '🔥'}
        </span>
        <span style={{
          fontSize: 9, fontWeight: 700, color: catColor,
          background: catColor + '15', padding: '2px 8px', borderRadius: 8,
        }}>
          {CAT_LABELS[keyword.category] || keyword.category}
        </span>
      </div>

      {/* Keyword text */}
      <div style={{
        fontSize: 15, fontWeight: 700, color: 'var(--text-primary)',
        lineHeight: 1.4,
      }}>
        {keyword.keyword}
      </div>

      {/* CTA hint */}
      <div style={{
        fontSize: 10, color: hovered ? color : 'var(--text-muted)',
        marginTop: 8, fontWeight: 600, transition: 'color 0.2s',
      }}>
        {hovered ? '⚡ กดเพื่อหาข่าว →' : 'กดเพื่อค้นหาข่าว'}
      </div>
    </button>
  );
}

// === Result Card ===
function ResultCard({ article, index, onCreateContent }) {
  const [hovered, setHovered] = useState(false);
  const score = article.heatScore || 0;
  const scoreColor = heatScoreColor(score);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--bg-secondary)',
        border: `1px solid ${hovered ? scoreColor + '55' : 'var(--border)'}`,
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        transition: 'all 0.2s',
        animation: `fadeUp ${0.2 + index * 0.06}s ease-out both`,
      }}
    >
      <div style={{ display: 'flex' }}>
        {/* Heat column */}
        <div style={{
          width: 70, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 2,
          background: `${scoreColor}08`, borderRight: `3px solid ${scoreColor}`,
          flexShrink: 0, padding: '16px 0',
        }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: scoreColor }}>
            {article.heatLevel || '🔥'}
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: scoreColor, lineHeight: 1 }}>
            {score}
          </div>
          <div style={{ fontSize: 7, fontWeight: 700, color: scoreColor, opacity: 0.7 }}>HEAT</div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* Sources */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 11, fontWeight: 900, color: '#fff',
              background: scoreColor, padding: '2px 8px', borderRadius: 6,
            }}>#{article.rank || index + 1}</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              📰 {article.sourceCount || 1} สำนัก ({(article.sources || []).join(', ') || '-'})
            </span>
          </div>

          {/* Title */}
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.5 }}>
            {article.title}
          </h3>

          {/* Snippet */}
          {article.snippet && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {article.snippet}
            </p>
          )}

          {/* Why hot */}
          {article.whyHot && (
            <div style={{
              fontSize: 11, color: scoreColor, fontWeight: 600,
              background: `${scoreColor}0a`, padding: '6px 12px', borderRadius: 8,
              borderLeft: `3px solid ${scoreColor}`,
            }}>
              🎯 {article.whyHot}
            </div>
          )}

          {/* Angles */}
          {article.suggestedAngles?.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>💡 มุมข่าว:</span>
              {article.suggestedAngles.map((a, i) => (
                <span key={i} style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 8,
                  background: 'rgba(99,102,241,0.1)', color: '#818cf8', fontWeight: 600,
                }}>{a}</span>
              ))}
            </div>
          )}

          {/* CTA */}
          <button onClick={onCreateContent} style={{
            marginTop: 4, padding: '10px 0', borderRadius: 'var(--radius-md)',
            border: 'none', width: '100%',
            background: `linear-gradient(135deg, ${scoreColor}, ${scoreColor}aa)`,
            color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer',
            transition: 'opacity 0.2s',
          }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            ⚡ สร้างข่าวจากเรื่องนี้
          </button>
        </div>
      </div>
    </div>
  );
}
