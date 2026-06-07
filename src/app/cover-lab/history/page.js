'use client';

import { useState, useEffect, useCallback } from 'react';

const PAGE_SIZE = 20;

export default function CoverHistoryPage() {
  const [covers, setCovers] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedCover, setExpandedCover] = useState(null);
  const [expandedImage, setExpandedImage] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // ★ Fetch covers from API
  const fetchCovers = useCallback(async (newOffset = 0, append = false) => {
    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const res = await fetch(`/api/cover-history?limit=${PAGE_SIZE}&offset=${newOffset}`);
      const data = await res.json();
      if (data.success) {
        if (append) {
          setCovers(prev => [...prev, ...data.covers]);
        } else {
          setCovers(data.covers || []);
        }
        setTotal(data.total || 0);
        setOffset(newOffset);
      }
    } catch (e) {
      console.error('Failed to load cover history:', e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => { fetchCovers(0); }, [fetchCovers]);

  // ★ Load full cover detail
  async function handleExpand(cover) {
    setExpandedCover(cover);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/cover-history?id=${cover.id}`);
      const data = await res.json();
      if (data.success && data.cover) {
        setExpandedImage(data.cover.cover_base64);
      }
    } catch {
      setExpandedImage(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  // ★ Delete cover
  async function handleDelete(id) {
    try {
      const res = await fetch('/api/cover-history', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (data.success) {
        setCovers(prev => prev.filter(c => c.id !== id));
        setTotal(prev => prev - 1);
        if (expandedCover?.id === id) {
          setExpandedCover(null);
          setExpandedImage(null);
        }
      }
    } catch (e) {
      console.error('Delete failed:', e);
    }
    setDeleteConfirm(null);
  }

  // ★ Load more
  function handleLoadMore() {
    const newOffset = offset + PAGE_SIZE;
    fetchCovers(newOffset, true);
  }

  const hasMore = covers.length < total;

  // ★ Format date
  function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  // ★ Score badge color
  function getScoreColor(score) {
    if (score >= 8) return { bg: '#14532d', border: '#22c55e', text: '#4ade80' };
    if (score >= 6) return { bg: '#422006', border: '#f59e0b', text: '#fbbf24' };
    return { bg: '#7f1d1d', border: '#ef4444', text: '#fca5a5' };
  }

  // ★ Parse identity
  function parseIdentity(identity) {
    if (!identity) return null;
    if (typeof identity === 'string') {
      try { return JSON.parse(identity); } catch { return null; }
    }
    return identity;
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a12',
      color: '#e2e8f0',
      fontFamily: "'Inter', 'Noto Sans Thai', sans-serif",
    }}>
      {/* ★ Header */}
      <div style={{
        background: 'linear-gradient(180deg, rgba(99,102,241,0.1) 0%, transparent 100%)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '24px 16px',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, color: '#e2e8f0' }}>
              📚 ประวัติปกที่สร้าง
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: 14, color: '#64748b' }}>
              ปกทั้งหมด {total} รายการ
            </p>
          </div>
          <a href="/cover-lab" style={{
            padding: '10px 20px',
            background: 'rgba(99,102,241,0.15)',
            color: '#a5b4fc',
            border: '1px solid rgba(99,102,241,0.3)',
            borderRadius: 10,
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: 600,
            transition: 'all 0.2s',
          }}>
            ← กลับ Cover Lab
          </a>
        </div>
      </div>

      {/* ★ Content */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
        {/* Loading state */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{
              width: 48, height: 48, margin: '0 auto 16px',
              border: '3px solid rgba(99,102,241,0.2)',
              borderTopColor: '#6366f1',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
            <p style={{ color: '#64748b', fontSize: 14 }}>กำลังโหลดประวัติปก...</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Empty state */}
        {!loading && covers.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🖼️</div>
            <h2 style={{ color: '#475569', fontWeight: 600, fontSize: 18, margin: '0 0 8px' }}>
              ยังไม่มีประวัติปก
            </h2>
            <p style={{ color: '#64748b', fontSize: 14 }}>
              ปกที่สร้างจาก Cover Lab จะแสดงที่นี่
            </p>
            <a href="/cover-lab" style={{
              display: 'inline-block', marginTop: 20,
              padding: '12px 24px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: '#fff', borderRadius: 10, textDecoration: 'none', fontWeight: 700, fontSize: 14,
            }}>
              🚀 ไปสร้างปก
            </a>
          </div>
        )}

        {/* ★ Grid */}
        {!loading && covers.length > 0 && (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: 20,
            }}>
              {covers.map(cover => {
                const sc = getScoreColor(cover.ai_score);
                const ident = parseIdentity(cover.identity);
                return (
                  <div key={cover.id} style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    borderRadius: 16,
                    overflow: 'hidden',
                    transition: 'all 0.25s ease',
                    cursor: 'pointer',
                    position: 'relative',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.border = '1px solid rgba(99,102,241,0.4)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 8px 30px rgba(99,102,241,0.1)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.border = '1px solid rgba(255,255,255,0.07)';
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                  onClick={() => handleExpand(cover)}
                  >
                    {/* Thumbnail area */}
                    <div style={{
                      height: 220,
                      background: 'rgba(0,0,0,0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                    }}>
                      {cover.has_full_image ? (
                        <div style={{
                          width: '100%', height: '100%',
                          background: `linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          position: 'relative',
                        }}>
                          <div style={{ fontSize: 48, opacity: 0.4 }}>🖼️</div>
                          <div style={{
                            position: 'absolute', bottom: 8, right: 8,
                            background: 'rgba(99,102,241,0.8)', color: '#fff',
                            padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                          }}>
                            คลิกเพื่อดู
                          </div>
                        </div>
                      ) : (
                        <div style={{
                          width: '100%', height: '100%',
                          background: 'linear-gradient(135deg, #1e1b4b, #0f172a)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <span style={{ fontSize: 36, opacity: 0.3 }}>🖼️</span>
                        </div>
                      )}
                    </div>

                    {/* Card info */}
                    <div style={{ padding: '14px 16px' }}>
                      {/* Title */}
                      <h3 style={{
                        margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#e2e8f0',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {cover.news_title || 'ไม่มีหัวข้อ'}
                      </h3>

                      {/* Meta row */}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                        {/* Score badge */}
                        <span style={{
                          padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                          background: sc.bg, border: `1px solid ${sc.border}`, color: sc.text,
                        }}>
                          ⭐ {cover.ai_score}/10
                        </span>

                        {/* Template badge */}
                        <span style={{
                          padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                          background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)',
                          color: '#60a5fa',
                        }}>
                          📐 {cover.template_id || '-'}
                        </span>

                        {/* Characters */}
                        {ident?.mainCharacter && (
                          <span style={{
                            padding: '2px 8px', borderRadius: 6, fontSize: 11,
                            background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)',
                            color: '#fbbf24',
                          }}>
                            👤 {ident.mainCharacter}
                          </span>
                        )}
                      </div>

                      {/* Date & actions */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, color: '#475569' }}>
                          {formatDate(cover.created_at)}
                        </span>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setDeleteConfirm(cover.id);
                          }}
                          style={{
                            padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)',
                            background: 'rgba(239,68,68,0.1)', color: '#f87171', fontSize: 11,
                            cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s',
                          }}
                          onMouseEnter={e => { e.target.style.background = 'rgba(239,68,68,0.25)'; }}
                          onMouseLeave={e => { e.target.style.background = 'rgba(239,68,68,0.1)'; }}
                        >
                          🗑️ ลบ
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Load more */}
            {hasMore && (
              <div style={{ textAlign: 'center', marginTop: 32 }}>
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  style={{
                    padding: '12px 32px',
                    background: loadingMore ? '#1e293b' : 'rgba(99,102,241,0.15)',
                    color: loadingMore ? '#475569' : '#a5b4fc',
                    border: '1px solid rgba(99,102,241,0.3)',
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: loadingMore ? 'wait' : 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {loadingMore ? '⏳ กำลังโหลด...' : `โหลดเพิ่ม (${covers.length}/${total})`}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ★ Delete Confirmation Modal */}
      {deleteConfirm && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            style={{
              background: '#1e1b4b', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 16, padding: 28, maxWidth: 380, width: '90%',
              textAlign: 'center',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 36, marginBottom: 12 }}>🗑️</div>
            <h3 style={{ margin: '0 0 8px', color: '#e2e8f0', fontSize: 18 }}>ลบปกนี้?</h3>
            <p style={{ color: '#94a3b8', fontSize: 14, margin: '0 0 20px' }}>
              ลบแล้วไม่สามารถกู้คืนได้
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                onClick={() => setDeleteConfirm(null)}
                style={{
                  padding: '10px 24px', borderRadius: 8, border: '1px solid #475569',
                  background: '#1e293b', color: '#94a3b8', fontSize: 14,
                  cursor: 'pointer', fontWeight: 600,
                }}
              >
                ยกเลิก
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                style={{
                  padding: '10px 24px', borderRadius: 8, border: 'none',
                  background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
                  color: '#fff', fontSize: 14, cursor: 'pointer', fontWeight: 700,
                }}
              >
                ลบเลย
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ★ Expanded Cover Modal */}
      {expandedCover && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 999, padding: 16,
          }}
          onClick={() => { setExpandedCover(null); setExpandedImage(null); }}
        >
          <div
            style={{
              background: 'rgba(15,15,30,0.95)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 20, maxWidth: 700, width: '100%', maxHeight: '90vh',
              overflow: 'auto', position: 'relative',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => { setExpandedCover(null); setExpandedImage(null); }}
              style={{
                position: 'absolute', top: 12, right: 12, zIndex: 10,
                width: 36, height: 36, borderRadius: '50%',
                background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#94a3b8', fontSize: 16, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              ✕
            </button>

            {/* Cover image */}
            <div style={{ padding: 16 }}>
              {loadingDetail ? (
                <div style={{ textAlign: 'center', padding: '60px 0' }}>
                  <div style={{
                    width: 40, height: 40, margin: '0 auto 12px',
                    border: '3px solid rgba(99,102,241,0.2)',
                    borderTopColor: '#6366f1', borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  <p style={{ color: '#64748b', fontSize: 13 }}>กำลังโหลดปก...</p>
                </div>
              ) : expandedImage ? (
                <img
                  src={expandedImage}
                  alt={expandedCover.news_title || 'Cover'}
                  style={{
                    width: '100%', borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                />
              ) : (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#475569' }}>
                  ⚠️ ไม่สามารถโหลดภาพได้
                </div>
              )}
            </div>

            {/* Cover details */}
            <div style={{ padding: '0 20px 20px' }}>
              <h2 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>
                {expandedCover.news_title || 'ไม่มีหัวข้อ'}
              </h2>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {(() => {
                  const sc = getScoreColor(expandedCover.ai_score);
                  return (
                    <span style={{
                      padding: '4px 12px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                      background: sc.bg, border: `1px solid ${sc.border}`, color: sc.text,
                    }}>
                      ⭐ {expandedCover.ai_score}/10
                    </span>
                  );
                })()}
                <span style={{
                  padding: '4px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)',
                  color: '#60a5fa',
                }}>
                  📐 {expandedCover.template_id}
                </span>
                <span style={{
                  padding: '4px 12px', borderRadius: 8, fontSize: 13,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  color: '#94a3b8',
                }}>
                  📅 {formatDate(expandedCover.created_at)}
                </span>
              </div>

              {/* Source URL */}
              {expandedCover.source_url && (
                <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px', wordBreak: 'break-all' }}>
                  🔗 {expandedCover.source_url}
                </p>
              )}

              {/* Identity info */}
              {(() => {
                const ident = parseIdentity(expandedCover.identity);
                if (!ident) return null;
                return (
                  <div style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 10, padding: 12, marginBottom: 12,
                  }}>
                    <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 6px' }}>🔍 Identity</p>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {ident.characters?.map((c, i) => (
                        <span key={i} style={{
                          padding: '2px 8px', borderRadius: 6, fontSize: 11,
                          background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)',
                          color: '#fbbf24',
                        }}>
                          👤 {c}
                        </span>
                      ))}
                      {ident.emotion && (
                        <span style={{
                          padding: '2px 8px', borderRadius: 6, fontSize: 11,
                          background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.25)',
                          color: '#c084fc',
                        }}>
                          💗 {ident.emotion}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                {expandedImage && (
                  <a
                    href={expandedImage}
                    download={`cover-${expandedCover.id?.substring(0, 8)}-${Date.now()}.jpg`}
                    style={{
                      padding: '10px 20px', borderRadius: 8,
                      background: 'linear-gradient(135deg, #059669, #047857)',
                      color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 700,
                    }}
                  >
                    💾 ดาวน์โหลด
                  </a>
                )}
                <button
                  onClick={() => {
                    setExpandedCover(null);
                    setExpandedImage(null);
                    setDeleteConfirm(expandedCover.id);
                  }}
                  style={{
                    padding: '10px 20px', borderRadius: 8,
                    background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
                    color: '#f87171', fontSize: 13, cursor: 'pointer', fontWeight: 700,
                  }}
                >
                  🗑️ ลบ
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
