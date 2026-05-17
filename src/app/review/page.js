'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Header from '@/components/layout/Header';
import Link from 'next/link';

const STATUS_CONFIG = {
  all: { label: '📋 ทั้งหมด', color: 'var(--text-secondary)' },
  pending: { label: '⏳ รอตรวจ', color: '#fbbf24' },
  approved: { label: '✅ อนุมัติ', color: '#22c55e' },
  rejected: { label: '❌ ไม่ผ่าน', color: '#ef4444' },
  revision: { label: '🔄 แก้ไข', color: '#a78bfa' },
};

export default function ReviewPage() {
  const [reviews, setReviews] = useState([]);
  const [stats, setStats] = useState({});
  const [filter, setFilter] = useState('all');
  const [memberFilter, setMemberFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [noteText, setNoteText] = useState({});
  const [updating, setUpdating] = useState(null);

  const loadReviews = useCallback(async () => {
    try {
      const res = await fetch(`/api/review?status=${filter}`);
      const data = await res.json();
      if (data.success) {
        setReviews(data.reviews || []);
        setStats(data.stats || {});
      }
    } catch (err) {
      console.error('Load error:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { loadReviews(); }, [loadReviews]);

  // Extract unique members from reviews
  const members = useMemo(() => {
    const map = new Map();
    reviews.forEach(r => {
      if (r.submittedBy?.id) {
        map.set(r.submittedBy.id, {
          id: r.submittedBy.id,
          name: r.submittedBy.name || r.submittedBy.id,
          avatar: r.submittedBy.avatar || '👤',
          count: (map.get(r.submittedBy.id)?.count || 0) + 1,
        });
      }
    });
    return Array.from(map.values());
  }, [reviews]);

  // Filter reviews by member
  const filteredReviews = useMemo(() => {
    if (memberFilter === 'all') return reviews;
    return reviews.filter(r => r.submittedBy?.id === memberFilter);
  }, [reviews, memberFilter]);

  const handleUpdateStatus = async (id, status) => {
    setUpdating(id);
    try {
      const res = await fetch('/api/review', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, note: noteText[id] || '' }),
      });
      const data = await res.json();
      if (data.success) await loadReviews();
    } catch (err) {
      console.error('Update error:', err);
    } finally {
      setUpdating(null);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('ลบรายการนี้?')) return;
    try {
      await fetch(`/api/review?id=${id}`, { method: 'DELETE' });
      await loadReviews();
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const formatDate = (iso) => {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const sourceLabels = { url: '🔗 URL', image: '🖼️ ภาพ', raw: '📝 ข้อความ', tiktok: '🎵 TikTok', youtube: '📺 YouTube', facebook: '📘 Facebook' };

  return (
    <>
      <Header title="📦 คลังรอตรวจ" subtitle="ตรวจสอบ อนุมัติ และจัดการเนื้อหาก่อนเผยแพร่" />
      <div className="page-content">

        {/* Status Filter Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
            <button key={key} onClick={() => setFilter(key)}
              style={{
                padding: '12px 8px', textAlign: 'center', fontFamily: 'inherit',
                background: filter === key ? 'rgba(29,155,240,0.15)' : 'var(--bg-card)',
                border: `1px solid ${filter === key ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-md)', cursor: 'pointer',
                transition: 'all 0.2s', color: 'inherit',
              }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: cfg.color }}>
                {key === 'all' ? stats.total || 0 : stats[key] || 0}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{cfg.label}</div>
            </button>
          ))}
        </div>

        {/* Member Filter Bar */}
        {members.length > 0 && (
          <div style={{
            display: 'flex', gap: 8, marginBottom: 16, padding: '10px 14px',
            background: 'var(--bg-card)', borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)', alignItems: 'center', flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>👥 กรองตามสมาชิก:</span>
            <button onClick={() => setMemberFilter('all')}
              style={{
                padding: '4px 12px', borderRadius: 20, border: 'none',
                background: memberFilter === 'all' ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                color: memberFilter === 'all' ? '#fff' : 'var(--text-muted)',
                fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}>ทุกคน ({reviews.length})</button>
            {members.map(m => (
              <button key={m.id} onClick={() => setMemberFilter(m.id)}
                style={{
                  padding: '4px 12px', borderRadius: 20, border: 'none',
                  background: memberFilter === m.id ? 'linear-gradient(135deg, #f91880, #7c3aed)' : 'rgba(255,255,255,0.06)',
                  color: memberFilter === m.id ? '#fff' : 'var(--text-muted)',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all 0.2s',
                }}>
                {m.avatar} {m.name} ({m.count})
              </button>
            ))}
          </div>
        )}

        {/* Review List */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>⏳ กำลังโหลด...</div>
        ) : filteredReviews.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📭</div>
            <div className="empty-state-title">ไม่มีรายการ{filter !== 'all' ? ` (${STATUS_CONFIG[filter]?.label})` : ''}{memberFilter !== 'all' ? ` ของ ${members.find(m => m.id === memberFilter)?.name || ''}` : ''}</div>
            <div className="empty-state-text">รายการจะแสดงเมื่อมีเนื้อหาถูกส่งเข้ามาตรวจสอบ</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredReviews.map(item => {
              const isExpanded = expandedId === item.id;
              const statusCfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;

              return (
                <div key={item.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  {/* Header Row */}
                  <div
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    style={{
                      padding: '12px 14px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 10,
                      borderBottom: isExpanded ? '1px solid var(--border)' : 'none',
                      flexWrap: 'wrap',
                    }}>
                    {/* Status Badge */}
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 8px',
                      borderRadius: 20, color: statusCfg.color,
                      background: `${statusCfg.color}15`,
                      border: `1px solid ${statusCfg.color}30`,
                      whiteSpace: 'nowrap', flexShrink: 0,
                    }}>{statusCfg.label}</span>

                    {/* Title + Info */}
                    <div style={{ flex: 1, minWidth: 100 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                        {item.title?.slice(0, 80) || 'ไม่มีหัวข้อ'}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4, alignItems: 'center' }}>
                        {/* Member Badge */}
                        {item.submittedBy && (
                          <Link href={`/members/${item.submittedBy.id}`} style={{ textDecoration: 'none' }}
                            onClick={(e) => e.stopPropagation()}>
                            <span style={{
                              fontSize: 10, padding: '2px 8px', borderRadius: 12,
                              background: 'linear-gradient(135deg, rgba(249,24,128,0.15), rgba(124,58,237,0.15))',
                              border: '1px solid rgba(249,24,128,0.25)',
                              color: '#e879a8', fontWeight: 700, whiteSpace: 'nowrap',
                              display: 'inline-flex', alignItems: 'center', gap: 3,
                            }}>
                              {item.submittedBy.avatar} {item.submittedBy.name}
                            </span>
                          </Link>
                        )}
                        {!item.submittedBy && (
                          <span style={{
                            fontSize: 10, padding: '2px 8px', borderRadius: 12,
                            background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)',
                          }}>👤 ไม่ระบุ</span>
                        )}
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{sourceLabels[item.sourceType] || '📄'}</span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>•</span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{item.wordCount || 0} คำ</span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>•</span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{formatDate(item.createdAt)}</span>
                      </div>
                    </div>

                    {/* Preset Badge */}
                    {item.presetLabel && (
                      <span style={{ fontSize: 9, padding: '3px 8px', background: 'var(--viral-bg)', color: 'var(--viral-color)', borderRadius: 20, fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {item.presetLabel}
                      </span>
                    )}

                    <span style={{ fontSize: 12, color: 'var(--text-muted)', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : '' }}>▼</span>
                  </div>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div style={{ padding: '14px' }}>
                      <div style={{
                        background: 'var(--bg-primary)', padding: 14,
                        borderRadius: 'var(--radius-md)', marginBottom: 12,
                        border: '1px solid var(--border)',
                        fontSize: 13, lineHeight: 1.8, color: 'var(--text-secondary)',
                        whiteSpace: 'pre-wrap', maxHeight: 350, overflowY: 'auto',
                      }}>
                        {item.content}
                      </div>

                      {item.angles?.length > 0 && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
                          {item.angles.map((a, i) => (
                            <span key={i} style={{ fontSize: 9, padding: '2px 6px', background: 'var(--bg-secondary)', borderRadius: 10, color: 'var(--text-muted)', border: '1px solid var(--border)' }}>📐 {a}</span>
                          ))}
                        </div>
                      )}

                      {item.note && (
                        <div style={{ background: 'rgba(251,191,36,0.08)', padding: 10, borderRadius: 'var(--radius-sm)', marginBottom: 12, border: '1px solid rgba(251,191,36,0.2)' }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#fbbf24', marginBottom: 4 }}>💬 หมายเหตุจากผู้ตรวจ:</div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.note}</div>
                          {item.reviewedAt && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>ตรวจเมื่อ {formatDate(item.reviewedAt)}</div>}
                        </div>
                      )}

                      <div style={{ marginBottom: 12 }}>
                        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>✏️ เพิ่มหมายเหตุ</label>
                        <textarea
                          className="form-textarea"
                          value={noteText[item.id] !== undefined ? noteText[item.id] : (item.note || '')}
                          onChange={(e) => setNoteText(prev => ({ ...prev, [item.id]: e.target.value }))}
                          placeholder="เขียนหมายเหตุ..."
                          style={{ minHeight: 50, fontSize: 12 }}
                        />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: 6 }}>
                        <button onClick={() => handleUpdateStatus(item.id, 'approved')} disabled={updating === item.id}
                          style={{ padding: '9px 8px', borderRadius: 'var(--radius-sm)', background: item.status === 'approved' ? '#22c55e' : 'rgba(34,197,94,0.12)', border: `1px solid ${item.status === 'approved' ? '#22c55e' : 'rgba(34,197,94,0.3)'}`, color: item.status === 'approved' ? '#fff' : '#22c55e', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                          ✅ อนุมัติ
                        </button>
                        <button onClick={() => handleUpdateStatus(item.id, 'revision')} disabled={updating === item.id}
                          style={{ padding: '9px 8px', borderRadius: 'var(--radius-sm)', background: item.status === 'revision' ? '#a78bfa' : 'rgba(167,139,250,0.12)', border: `1px solid ${item.status === 'revision' ? '#a78bfa' : 'rgba(167,139,250,0.3)'}`, color: item.status === 'revision' ? '#fff' : '#a78bfa', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                          🔄 แก้ไข
                        </button>
                        <button onClick={() => handleUpdateStatus(item.id, 'rejected')} disabled={updating === item.id}
                          style={{ padding: '9px 8px', borderRadius: 'var(--radius-sm)', background: item.status === 'rejected' ? '#ef4444' : 'rgba(239,68,68,0.12)', border: `1px solid ${item.status === 'rejected' ? '#ef4444' : 'rgba(239,68,68,0.3)'}`, color: item.status === 'rejected' ? '#fff' : '#ef4444', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                          ❌ ไม่ผ่าน
                        </button>
                        <button onClick={() => handleDelete(item.id)}
                          style={{ padding: '9px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                          🗑️ ลบ
                        </button>
                      </div>

                      {updating === item.id && (
                        <div style={{ textAlign: 'center', padding: 6, fontSize: 10, color: 'var(--accent)' }}>กำลังอัปเดต...</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
