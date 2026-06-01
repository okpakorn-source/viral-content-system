'use client';

import { useState, useEffect, useCallback } from 'react';
import Header from '@/components/layout/Header';

const CATEGORY_COLORS = {
  'ข่าวอาลัย': '#8b5cf6',
  'ข่าวสูญเสีย': '#6366f1',
  'ข่าวดราม่า': '#ef4444',
  'ข่าวแฉ': '#f97316',
  'ข่าวแซะ': '#eab308',
  'ข่าวบริจาค': '#22c55e',
  'ข่าวการเมือง': '#3b82f6',
  'ข่าวคนจนสู้ชีวิต': '#14b8a6',
  'ข่าวหักมุม': '#f91880',
  'ข่าวเศรษฐี': '#fbbf24',
  'ข่าวอบอุ่น': '#10b981',
  'ข่าวช็อก': '#dc2626',
  'ข่าวคอมเมนต์เดือด': '#f59e0b',
};

export default function PromptLibraryPage() {
  const [prompts, setPrompts] = useState([]);
  const [stats, setStats] = useState({ total: 0, categories: {} });
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const loadPrompts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedCategory) params.set('category', selectedCategory);
      if (search) params.set('search', search);
      const res = await fetch(`/api/prompt-library?${params}`);
      const data = await res.json();
      if (data.success) {
        setPrompts(data.prompts || []);
        setStats(data.stats || { total: 0, categories: {} });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, search]);

  useEffect(() => { loadPrompts(); }, [loadPrompts]);

  const handleDelete = async (id) => {
    if (!confirm('ลบ Prompt นี้?')) return;
    await fetch(`/api/prompt-library?id=${id}`, { method: 'DELETE' });
    loadPrompts();
  };

  const handleDeleteAll = async () => {
    if (!confirm('⚠️ ยืนยันลบ Prompt ทั้งหมดใช่ไหม? (การกระทำนี้ย้อนกลับไม่ได้)')) return;
    setLoading(true);
    await fetch(`/api/prompt-library?id=all`, { method: 'DELETE' });
    loadPrompts();
  };

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const categoryEntries = Object.entries(stats.categories || {}).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <Header title="🏛️ หอสมุด Prompt" subtitle={`คลัง Prompt อัจฉริยะ ${stats.total || 0} รายการ — สร้างจาก AI วิเคราะห์คอนเทนต์ไวรัลจริง`} />
      <div className="page-content">

        {/* Category Filter */}
        <div style={{
          display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16,
          padding: '12px 14px', background: 'var(--bg-card)',
          borderRadius: 'var(--radius-md)', border: '1px solid var(--border)',
        }}>
          <button onClick={() => setSelectedCategory(null)}
            style={{
              padding: '5px 14px', borderRadius: 20, border: 'none',
              background: !selectedCategory ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
              color: !selectedCategory ? '#fff' : 'var(--text-muted)',
              fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}>ทั้งหมด ({stats.total || 0})</button>
          {categoryEntries.map(([cat, count]) => {
            const color = CATEGORY_COLORS[cat] || '#888';
            return (
              <button key={cat} onClick={() => setSelectedCategory(cat)}
                style={{
                  padding: '5px 14px', borderRadius: 20, border: 'none',
                  background: selectedCategory === cat ? color : 'rgba(255,255,255,0.06)',
                  color: selectedCategory === cat ? '#fff' : color,
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all 0.2s',
                }}>{cat} ({count})</button>
            );
          })}
        </div>

        {/* Search */}
        <div style={{ marginBottom: 16, display: 'flex', gap: 10 }}>
          <input className="form-input" placeholder="🔍 ค้นหา Prompt... (ประเภท, Hook, อารมณ์, คำ)"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, fontSize: 13 }} />
            
          <button onClick={handleDeleteAll} style={{
            padding: '0 20px', borderRadius: 'var(--radius-md)', border: 'none',
            background: 'rgba(239,68,68,0.15)', color: '#ef4444', 
            fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
            whiteSpace: 'nowrap', transition: 'all 0.2s'
          }}
          onMouseOver={e => e.currentTarget.style.background = 'rgba(239,68,68,0.25)'}
          onMouseOut={e => e.currentTarget.style.background = 'rgba(239,68,68,0.15)'}>
            🗑️ ลบ Prompt ทั้งหมด
          </button>
        </div>

        {/* Prompt Grid */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>⏳ กำลังโหลด...</div>
        ) : prompts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🏛️</div>
            <div className="empty-state-title">ยังไม่มี Prompt ในหอสมุด</div>
            <div className="empty-state-text">ไปที่ "หอสมุดไวรัล" เพื่อป้อนเนื้อหาแล้วให้ AI สร้าง Prompt</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {prompts.map(p => {
              const isExpanded = expandedId === p.id;
              const color = CATEGORY_COLORS[p.category] || '#888';

              return (
                <div key={p.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  {/* Header */}
                  <div onClick={() => setExpandedId(isExpanded ? null : p.id)}
                    style={{
                      padding: '14px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                      borderBottom: isExpanded ? '1px solid var(--border)' : 'none',
                    }}>
                    {/* Category Badge */}
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                      color, background: `${color}15`, border: `1px solid ${color}30`,
                      whiteSpace: 'nowrap',
                    }}>🏷️ {p.category}</span>

                    <div style={{ flex: 1, minWidth: 120 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                        {p.promptName || p.prompt_name || p.hookStyle || 'Prompt'}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 3, alignItems: 'center', flexWrap: 'wrap' }}>
                        {p.emotionalType && (
                          <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 10, background: 'rgba(249,24,128,0.1)', color: '#f91880' }}>❤️ {p.emotionalType}</span>
                        )}
                        {p.hookStyle && (
                          <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 10, background: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>🎣 {p.hookStyle}</span>
                        )}
                        {p.tone && (
                          <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 10, background: 'rgba(139,92,246,0.1)', color: '#8b5cf6' }}>🎭 {p.tone}</span>
                        )}
                      </div>
                    </div>

                    {/* Viral Score */}
                    {p.viralScore > 0 && (
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 18, fontWeight: 900, color: p.viralScore >= 80 ? '#22c55e' : p.viralScore >= 60 ? '#fbbf24' : '#ef4444' }}>
                          {p.viralScore}
                        </div>
                        <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>VIRAL SCORE</div>
                      </div>
                    )}

                    {/* Usage Stats */}
                    <div style={{ textAlign: 'right', minWidth: 60 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>ใช้ {p.usageCount || 0} ครั้ง</div>
                      <div style={{ fontSize: 10, color: '#22c55e' }}>สำเร็จ {p.successCount || 0}</div>
                    </div>

                    <span style={{ fontSize: 12, color: 'var(--text-muted)', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : '' }}>▼</span>
                  </div>

                  {/* Expanded */}
                  {isExpanded && (
                    <div style={{ padding: 14 }}>
                      {/* DNA Analysis Result */}
                      <div style={{
                        background: 'rgba(59,130,246,0.06)', padding: 12, borderRadius: 8,
                        border: '1px solid rgba(59,130,246,0.15)', marginBottom: 12,
                      }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: '#3b82f6', marginBottom: 8 }}>🔬 ผลวิเคราะห์ DNA</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
                          <div><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>ประเภท:</span> <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{p.category || (p.targetCategories && p.targetCategories.join(', '))}</span></div>
                          <div><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>อารมณ์:</span> <span style={{ fontSize: 12, fontWeight: 700, color: '#f91880' }}>{(p.dnaTemplate?.emotion_formula) || (p.emotionalTags && p.emotionalTags.join(', '))}</span></div>
                          <div><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Hook:</span> <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{p.hookStyle}</span></div>
                          <div><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>โครงสร้าง:</span> <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{p.structure || p.dnaTemplate?.structure_formula}</span></div>
                        </div>
                        {(p.shareTrigger || p.commentTrigger) && (
                          <div style={{ marginTop: 8, padding: 8, background: 'rgba(249,24,128,0.06)', borderRadius: 6, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                            💡 {p.shareTrigger || p.commentTrigger}
                          </div>
                        )}
                        {p.emotionalTags?.length > 0 && (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
                            {p.emotionalTags.map((e, i) => (
                              <span key={i} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 10, background: 'rgba(249,24,128,0.1)', color: '#f91880' }}>❤️ {e}</span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Writing Style & CTA (ถ้ามี) */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginBottom: 12 }}>
                        {p.ctaStyle && (
                          <div style={{ padding: 8, background: 'rgba(249,24,128,0.06)', borderRadius: 6 }}>
                            <div style={{ fontSize: 9, fontWeight: 700, color: '#f91880', marginBottom: 4 }}>🎯 CTA Style</div>
                            <div style={{ fontSize: 11, color: 'var(--text-primary)' }}>{p.ctaStyle}</div>
                          </div>
                        )}
                        {p.writingStyle && (
                          <div style={{ padding: 8, background: 'rgba(139,92,246,0.06)', borderRadius: 6 }}>
                            <div style={{ fontSize: 9, fontWeight: 700, color: '#8b5cf6', marginBottom: 4 }}>✍️ สไตล์การเขียน</div>
                            <div style={{ fontSize: 11, color: 'var(--text-primary)' }}>{p.writingStyle}</div>
                          </div>
                        )}
                      </div>

                      {/* Prompt Text */}
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>📝 Prompt เต็ม:</div>
                        <div style={{
                          background: 'var(--bg-primary)', padding: 12, borderRadius: 8,
                          border: '1px solid var(--border)', fontSize: 12, lineHeight: 1.7,
                          color: 'var(--text-secondary)', whiteSpace: 'pre-wrap',
                          maxHeight: 300, overflowY: 'auto',
                        }}>
                          {p.promptText || p.prompt_text || p.promptName || 'ไม่มีข้อมูล'}
                        </div>
                      </div>

                      {/* Do Not list */}
                      {(p.doNot || p.do_not)?.length > 0 && (
                        <div style={{ marginBottom: 12, padding: 8, background: 'rgba(239,68,68,0.06)', borderRadius: 6 }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: '#ef4444', marginBottom: 4 }}>🚫 ห้ามทำ</div>
                          {(p.doNot || p.do_not).map((d, i) => (
                            <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>• {d}</div>
                          ))}
                        </div>
                      )}

                      {/* Example Hooks */}
                      {(p.exampleHooks || p.example_hooks)?.length > 0 && (
                        <div style={{ marginBottom: 12, padding: 8, background: 'rgba(34,197,94,0.06)', borderRadius: 6 }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: '#22c55e', marginBottom: 4 }}>🎣 ตัวอย่าง Hook</div>
                          {(p.exampleHooks || p.example_hooks).map((h, i) => (
                            <div key={i} style={{ fontSize: 11, color: 'var(--text-primary)', marginBottom: 2 }}>"{h}"</div>
                          ))}
                        </div>
                      )}

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button onClick={() => handleCopy(p.promptText || p.prompt_text || p.promptName || '', p.id)}
                          style={{
                            padding: '7px 14px', borderRadius: 8, border: 'none',
                            background: copiedId === p.id ? '#22c55e' : 'var(--accent)',
                            color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                          }}>
                          {copiedId === p.id ? '✅ คัดลอกแล้ว!' : '📋 คัดลอก Prompt'}
                        </button>
                        <button onClick={() => handleDelete(p.id)}
                          style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                          🗑️ ลบ
                        </button>

                        {/* Usage Stats Bar */}
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center', fontSize: 10, color: 'var(--text-muted)' }}>
                          {p.totalEngagement > 0 && <span style={{ color: '#22c55e' }}>📊 {p.totalEngagement.toLocaleString()} engagement</span>}
                          {p.lastUsedAt && <span>🕐 ใช้ล่าสุด: {new Date(p.lastUsedAt).toLocaleDateString('th-TH')}</span>}
                          {p.usageCount > 0 && p.successCount > 0 && <span style={{ color: '#fbbf24' }}>⭐ {Math.round((p.successCount/p.usageCount)*100)}% success</span>}
                        </div>
                      </div>
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
