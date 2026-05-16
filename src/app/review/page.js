'use client';

import { useState, useEffect, useCallback } from 'react';
import Header from '@/components/layout/Header';

const STATUS_CONFIG = {
  all: { label: '📋 ทั้งหมด', color: 'var(--text-secondary)' },
  pending: { label: '⏳ รอตรวจ', color: 'var(--warning)' },
  approved: { label: '✅ ผ่าน', color: 'var(--success)' },
  rejected: { label: '❌ ไม่ผ่าน', color: 'var(--danger)' },
  revision: { label: '🔄 รอแก้ไข', color: '#a78bfa' },
};

export default function ReviewPage() {
  const [reviews, setReviews] = useState([]);
  const [stats, setStats] = useState({});
  const [filter, setFilter] = useState('all');
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

  const handleUpdateStatus = async (id, status) => {
    setUpdating(id);
    try {
      const res = await fetch('/api/review', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, note: noteText[id] || '' }),
      });
      const data = await res.json();
      if (data.success) {
        await loadReviews();
      }
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

  const sourceLabels = { url: '🔗 URL', image: '📷 ภาพ', raw: '📝 ข้อความ', tiktok: '🎵 TikTok', youtube: '📺 YouTube', facebook: '📘 FB' };
  const lengthLabels = { short: '📝 สั้น', medium: '📄 กลาง', long: '📰 ยาว' };

  return (
    <>
      <Header title="📋 คลังรอตรวจ" subtitle="ตรวจสอบ อนุมัติ และจัดการเนื้อหาก่อนเผยแพร่" />
      <div className="page-content">
        {/* Stats Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 20 }}>
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

        {/* Review List */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>⏳ กำลังโหลด...</div>
        ) : reviews.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <div className="empty-state-title">ยังไม่มีรายการ{filter !== 'all' ? ` (${STATUS_CONFIG[filter].label})` : ''}</div>
            <div className="empty-state-text">ส่งเนื้อหาจากหน้าสร้างคอนเทนต์มาที่นี่เพื่อตรวจสอบก่อนเผยแพร่</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {reviews.map(item => {
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
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 8px',
                      borderRadius: 20, color: statusCfg.color,
                      background: `${statusCfg.color}15`,
                      border: `1px solid ${statusCfg.color}30`,
                      whiteSpace: 'nowrap', flexShrink: 0,
                    }}>{statusCfg.label}</span>

                    <div style={{ flex: 1, minWidth: 100 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                        {item.title?.slice(0, 80) || 'ไม่มีหัวข้อ'}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 }}>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{sourceLabels[item.sourceType] || item.sourceType}</span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>•</span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{item.wordCount} คำ</span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>•</span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{formatDate(item.createdAt)}</span>
                      </div>
                    </div>

                    {item.presetLabel && (
                      <span style={{ fontSize: 9, padding: '2px 7px', background: 'var(--viral-bg)', color: 'var(--viral)', borderRadius: 10, whiteSpace: 'nowrap' }}>
                        {item.presetLabel}
                      </span>
                    )}

                    <span style={{ fontSize: 12, color: 'var(--text-muted)', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'none', flexShrink: 0 }}>▼</span>
                  </div>

                  {/* Expanded */}
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
                            <span key={i} style={{ fontSize: 9, padding: '2px 6px', background: 'var(--info-bg)', color: 'var(--info)', borderRadius: 10 }}>{a}</span>
                          ))}
                        </div>
                      )}

                      {item.note && (
                        <div style={{ background: 'var(--warning-bg)', padding: 10, borderRadius: 'var(--radius-sm)', marginBottom: 12, border: '1px solid rgba(255,173,31,0.2)' }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--warning)', marginBottom: 3 }}>📝 หมายเหตุ:</div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.note}</div>
                          {item.reviewedAt && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 3 }}>ตรวจเมื่อ: {formatDate(item.reviewedAt)}</div>}
                        </div>
                      )}

                      <div style={{ marginBottom: 12 }}>
                        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>📝 หมายเหตุ:</label>
                        <textarea
                          className="form-textarea"
                          value={noteText[item.id] !== undefined ? noteText[item.id] : (item.note || '')}
                          onChange={(e) => setNoteText(prev => ({ ...prev, [item.id]: e.target.value }))}
                          placeholder="พิมพ์หมายเหตุ..."
                          style={{ minHeight: 50, fontSize: 12 }}
                        />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: 6 }}>
                        <button onClick={() => handleUpdateStatus(item.id, 'approved')} disabled={updating === item.id}
                          style={{ padding: '9px 8px', borderRadius: 'var(--radius-sm)', background: item.status === 'approved' ? 'var(--success)' : 'var(--success-bg)', color: item.status === 'approved' ? '#fff' : 'var(--success)', fontWeight: 700, fontSize: 11, cursor: 'pointer', border: `1px solid ${item.status === 'approved' ? 'var(--success)' : 'rgba(0,186,124,0.3)'}` }}>
                          ✅ ผ่าน
                        </button>
                        <button onClick={() => handleUpdateStatus(item.id, 'revision')} disabled={updating === item.id}
                          style={{ padding: '9px 8px', borderRadius: 'var(--radius-sm)', background: item.status === 'revision' ? '#7c3aed' : 'rgba(124,58,237,0.1)', color: item.status === 'revision' ? '#fff' : '#a78bfa', fontWeight: 700, fontSize: 11, cursor: 'pointer', border: `1px solid ${item.status === 'revision' ? '#7c3aed' : 'rgba(124,58,237,0.3)'}` }}>
                          🔄 รอแก้
                        </button>
                        <button onClick={() => handleUpdateStatus(item.id, 'rejected')} disabled={updating === item.id}
                          style={{ padding: '9px 8px', borderRadius: 'var(--radius-sm)', background: item.status === 'rejected' ? 'var(--danger)' : 'var(--danger-bg)', color: item.status === 'rejected' ? '#fff' : 'var(--danger)', fontWeight: 700, fontSize: 11, cursor: 'pointer', border: `1px solid ${item.status === 'rejected' ? 'var(--danger)' : 'rgba(244,33,46,0.3)'}` }}>
                          ❌ ไม่ผ่าน
                        </button>
                        <button onClick={() => handleDelete(item.id)}
                          style={{ padding: '9px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
                          🗑️ ลบ
                        </button>
                      </div>

                      {updating === item.id && (
                        <div style={{ textAlign: 'center', padding: 6, fontSize: 10, color: 'var(--accent)' }}>⏳ อัปเดต...</div>
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
