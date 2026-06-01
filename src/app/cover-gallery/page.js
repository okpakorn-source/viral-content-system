'use client';

import { useState, useEffect } from 'react';

export default function CoverGalleryPage() {
  const [images, setImages] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [filter, setFilter] = useState('all'); // all, hero, support, rejected
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('sessions'); // sessions, images

  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    setLoading(true);
    try {
      const res = await fetch('/api/cover-gallery?view=sessions');
      const data = await res.json();
      if (data.success) {
        setSessions(data.sessions || []);
      }
    } catch (e) {
      console.error('Failed to load sessions:', e);
    }
    setLoading(false);
  }

  async function loadSessionImages(sessionId) {
    setLoading(true);
    setSelectedSession(sessionId);
    setView('images');
    try {
      const res = await fetch(`/api/cover-gallery?session=${sessionId}`);
      const data = await res.json();
      if (data.success) {
        setImages(data.images || []);
      }
    } catch (e) {
      console.error('Failed to load images:', e);
    }
    setLoading(false);
  }

  const filteredImages = images.filter(img => {
    if (filter === 'all') return true;
    if (filter === 'hero') return img.ai_role === 'hero';
    if (filter === 'support') return img.ai_role === 'support';
    if (filter === 'selected') return img.is_selected;
    if (filter === 'rejected') return img.ai_score < 5;
    return true;
  });

  const getRoleBadge = (role, score) => {
    const colors = {
      hero: { bg: '#fbbf24', text: '#000' },
      support: { bg: '#3b82f6', text: '#fff' },
      rejected: { bg: '#ef4444', text: '#fff' },
    };
    const c = colors[role] || colors.support;
    return (
      <span style={{
        background: c.bg, color: c.text,
        padding: '2px 8px', borderRadius: '12px',
        fontSize: '11px', fontWeight: '700',
        textTransform: 'uppercase'
      }}>
        {role} ({score}/10)
      </span>
    );
  };

  const getSourceBadge = (source) => {
    const icons = { google: '🔍', youtube: '📺', tiktok: '🎵', web: '🌐' };
    return (
      <span style={{
        background: 'rgba(255,255,255,0.1)',
        padding: '2px 6px', borderRadius: '8px',
        fontSize: '10px'
      }}>
        {icons[source] || '📷'} {source}
      </span>
    );
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
      color: '#e2e8f0',
      fontFamily: "'Inter', sans-serif"
    }}>
      {/* Header */}
      <div style={{
        background: 'rgba(15, 23, 42, 0.8)',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        padding: '20px 32px',
        backdropFilter: 'blur(10px)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: '800', margin: 0 }}>
              📦 Image Gallery
            </h1>
            <p style={{ fontSize: '13px', color: '#94a3b8', margin: '4px 0 0' }}>
              คลังรูปทั้งหมดที่ Agent ค้นมาได้ • ดู/คัด/วิเคราะห์
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => { setView('sessions'); setSelectedSession(null); loadSessions(); }}
              style={{
                padding: '8px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                background: view === 'sessions' ? '#6366f1' : 'rgba(255,255,255,0.1)',
                color: '#fff', fontSize: '13px', fontWeight: '600'
              }}
            >
              📋 Sessions
            </button>
            <a href="/cover-tester" style={{
              padding: '8px 16px', borderRadius: '8px', textDecoration: 'none',
              background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: '13px', fontWeight: '600'
            }}>
              🧪 Cover Tester
            </a>
          </div>
        </div>
      </div>

      <div style={{ padding: '24px 32px' }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
            Loading...
          </div>
        )}

        {/* Sessions View */}
        {!loading && view === 'sessions' && (
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px' }}>
              รายการ Session ({sessions.length})
            </h2>
            {sessions.length === 0 && (
              <div style={{
                textAlign: 'center', padding: '60px 0', color: '#64748b',
                background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px dashed rgba(255,255,255,0.1)'
              }}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>🖼️</div>
                <p>ยังไม่มีรูปในคลัง</p>
                <p style={{ fontSize: '13px' }}>ไปที่ <a href="/cover-tester" style={{ color: '#6366f1' }}>Cover Tester</a> แล้วสร้างปกข่าวเพื่อเริ่มเก็บรูป</p>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
              {sessions.map(s => (
                <div
                  key={s.sessionId}
                  onClick={() => loadSessionImages(s.sessionId)}
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '12px',
                    padding: '20px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#6366f1'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'}
                >
                  <h3 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '8px', lineHeight: '1.4' }}>
                    {s.newsTitle || 'Untitled'}
                  </h3>
                  <div style={{ display: 'flex', gap: '12px', fontSize: '12px', color: '#94a3b8' }}>
                    <span>📷 {s.totalImages} รูป</span>
                    <span>✅ {s.selectedImages} เลือก</span>
                    <span>⭐ {s.heroCount} Hero</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '8px' }}>
                    {new Date(s.createdAt).toLocaleString('th-TH')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Images View */}
        {!loading && view === 'images' && (
          <div>
            {/* Back button + Filters */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <button
                onClick={() => { setView('sessions'); setSelectedSession(null); }}
                style={{
                  padding: '6px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)',
                  background: 'transparent', color: '#e2e8f0', cursor: 'pointer', fontSize: '13px'
                }}
              >
                ← กลับ
              </button>
              <div style={{ display: 'flex', gap: '6px' }}>
                {['all', 'hero', 'support', 'selected', 'rejected'].map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    style={{
                      padding: '6px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                      background: filter === f ? '#6366f1' : 'rgba(255,255,255,0.08)',
                      color: '#fff', fontSize: '12px', fontWeight: filter === f ? '700' : '400'
                    }}
                  >
                    {f === 'all' ? `ทั้งหมด (${images.length})` :
                     f === 'hero' ? `⭐ Hero` :
                     f === 'support' ? `📷 Support` :
                     f === 'selected' ? `✅ เลือกแล้ว` : `❌ ตกรอบ`}
                  </button>
                ))}
              </div>
            </div>

            {/* Image Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: '12px'
            }}>
              {filteredImages.map(img => (
                <div
                  key={img.id}
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: `2px solid ${img.is_selected ? '#22c55e' : img.ai_role === 'hero' ? '#fbbf24' : 'rgba(255,255,255,0.1)'}`,
                    borderRadius: '12px',
                    overflow: 'hidden',
                    transition: 'all 0.2s',
                  }}
                >
                  {/* Thumbnail */}
                  <div style={{
                    width: '100%', height: '180px',
                    background: img.thumbnail_base64
                      ? `url(${img.thumbnail_base64}) center/cover`
                      : `url(${img.image_url}) center/cover`,
                    position: 'relative'
                  }}>
                    {/* Selected indicator */}
                    {img.is_selected && (
                      <div style={{
                        position: 'absolute', top: '8px', right: '8px',
                        background: '#22c55e', borderRadius: '50%',
                        width: '24px', height: '24px', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', fontSize: '14px'
                      }}>✓</div>
                    )}
                  </div>
                  
                  {/* Info */}
                  <div style={{ padding: '10px' }}>
                    <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', flexWrap: 'wrap' }}>
                      {getRoleBadge(img.ai_role, img.ai_score)}
                      {getSourceBadge(img.source_agent)}
                    </div>
                    {img.ai_reason && (
                      <p style={{ fontSize: '11px', color: '#94a3b8', margin: 0, lineHeight: '1.4' }}>
                        {img.ai_reason}
                      </p>
                    )}
                    {img.width > 0 && (
                      <p style={{ fontSize: '10px', color: '#64748b', margin: '4px 0 0' }}>
                        {img.width}×{img.height}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {filteredImages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                ไม่มีรูปในหมวดนี้
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
