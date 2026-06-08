'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Constants ───────────────────────────────────────────────────────────────

const LAYOUT_LABELS = {
  'overlay-bottom':  { label: 'Overlay Bottom', color: '#8b5cf6', icon: '⬇️' },
  'thirds':          { label: 'Collage',         color: '#3b82f6', icon: '⊞' },
  'split-vertical':  { label: 'Split',           color: '#f59e0b', icon: '⧵' },
  'overlay-top':     { label: 'Overlay Top',     color: '#10b981', icon: '⬆️' },
  'centered':        { label: 'Centered',        color: '#ec4899', icon: '⊙' },
  'full-bleed':      { label: 'Full Bleed',      color: '#ef4444', icon: '⬛' },
};

const SUBJECT_LABELS = {
  'face-close':       '👤 Face Close-up',
  'upper-body':       '🧍 Upper Body',
  'full-body':        '🚶 Full Body',
  'multiple-people':  '👥 Multiple People',
  'no-person':        '🖼️ No Person',
  'object-only':      '📦 Object Only',
};

const FADE_COLORS = {
  'bottom-fade':       '#6366f1',
  'gradient-overlay':  '#8b5cf6',
  'none':              '#64748b',
  'vignette':          '#ec4899',
  'top-fade':          '#3b82f6',
  'left-fade':         '#f59e0b',
  'right-fade':        '#10b981',
};

const SCORE_COLOR = (s) => s >= 9 ? '#f59e0b' : s >= 8 ? '#ef4444' : s >= 7 ? '#f97316' : '#64748b';
const SCORE_LABEL = (s) => s >= 9 ? '🔥 Viral!' : s >= 8 ? '⚡ High' : s >= 7 ? '👍 Good' : '📊 Avg';

// ─── Components ───────────────────────────────────────────────────────────────

function TemplateCard({ tpl, onClick }) {
  const [imgSrc, setImgSrc] = useState(`/api/cover-templates/image?file=${encodeURIComponent(tpl.sourceFile)}`);
  const [imgError, setImgError] = useState(false);
  const layout = LAYOUT_LABELS[tpl.layoutType] || { label: tpl.layoutType, color: '#64748b', icon: '?' };

  return (
    <div
      onClick={() => onClick(tpl)}
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid rgba(255,255,255,0.08)`,
        borderRadius: '16px',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'all 0.25s cubic-bezier(0.4,0,0.2,1)',
        position: 'relative',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.borderColor = layout.color + '80';
        e.currentTarget.style.boxShadow = `0 12px 40px rgba(0,0,0,0.4), 0 0 0 1px ${layout.color}30`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Image */}
      <div style={{ position: 'relative', aspectRatio: '1/1', background: '#0f172a' }}>
        {!imgError ? (
          <img
            src={imgSrc}
            alt={tpl.sourceFile}
            onError={() => setImgError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: '13px', gap: '8px'
          }}>
            <span style={{ fontSize: '32px' }}>🖼️</span>
            <span>{tpl.sourceFile}</span>
          </div>
        )}

        {/* Viral Score Badge */}
        <div style={{
          position: 'absolute', top: '10px', right: '10px',
          background: SCORE_COLOR(tpl.viralScore),
          color: '#fff', borderRadius: '20px',
          padding: '4px 10px', fontSize: '13px', fontWeight: '800',
          boxShadow: `0 2px 8px ${SCORE_COLOR(tpl.viralScore)}60`,
          letterSpacing: '0.5px',
        }}>
          {tpl.viralScore}/10
        </div>

        {/* Layout Type Badge */}
        <div style={{
          position: 'absolute', top: '10px', left: '10px',
          background: layout.color + 'cc',
          backdropFilter: 'blur(8px)',
          color: '#fff', borderRadius: '8px',
          padding: '3px 8px', fontSize: '11px', fontWeight: '700',
        }}>
          {layout.icon} {layout.label}
        </div>

        {/* Bottom gradient overlay */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: '60px',
          background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)',
          display: 'flex', alignItems: 'flex-end', padding: '8px 10px',
        }}>
          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.7)' }}>
            {tpl.day} • {tpl.id}
          </span>
        </div>
      </div>

      {/* Card Body */}
      <div style={{ padding: '12px 14px' }}>
        {/* Subject + Fade row */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
          <span style={{
            background: 'rgba(255,255,255,0.07)', borderRadius: '6px',
            padding: '2px 7px', fontSize: '10px', color: '#cbd5e1',
          }}>
            {SUBJECT_LABELS[tpl.subjectVisibility] || tpl.subjectVisibility}
          </span>
          {tpl.fadeType !== 'none' && (
            <span style={{
              background: (FADE_COLORS[tpl.fadeType] || '#64748b') + '33',
              borderRadius: '6px', padding: '2px 7px', fontSize: '10px',
              color: FADE_COLORS[tpl.fadeType] || '#94a3b8',
              border: `1px solid ${(FADE_COLORS[tpl.fadeType] || '#64748b')}44`,
            }}>
              ✦ {tpl.fadeType}
            </span>
          )}
        </div>

        {/* Tags */}
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {(tpl.tags || []).slice(0, 4).map(tag => (
            <span key={tag} style={{
              background: 'rgba(99,102,241,0.15)', color: '#a5b4fc',
              borderRadius: '4px', padding: '1px 6px', fontSize: '10px',
            }}>
              #{tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function DetailModal({ tpl, onClose }) {
  if (!tpl) return null;
  const layout = LAYOUT_LABELS[tpl.layoutType] || { label: tpl.layoutType, color: '#64748b', icon: '?' };
  const [imgError, setImgError] = useState(false);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(8px)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#0f172a',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '20px', overflow: 'hidden',
          maxWidth: '900px', width: '100%',
          maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 40px 80px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          {/* Left: Image */}
          <div style={{ position: 'relative', aspectRatio: '1/1', background: '#020617' }}>
            {!imgError ? (
              <img
                src={`/api/cover-templates/image?file=${encodeURIComponent(tpl.sourceFile)}`}
                alt={tpl.sourceFile}
                onError={() => setImgError(true)}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <div style={{
                width:'100%',height:'100%',display:'flex',
                alignItems:'center',justifyContent:'center',color:'#475569'
              }}>
                <span style={{ fontSize: '48px' }}>🖼️</span>
              </div>
            )}
          </div>

          {/* Right: Details */}
          <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>{tpl.id}</div>
                <div style={{ fontSize: '18px', fontWeight: '800', color: '#f1f5f9' }}>{tpl.day}</div>
                <div style={{ fontSize: '13px', color: '#94a3b8' }}>{tpl.sourceFile}</div>
              </div>
              <button
                onClick={onClose}
                style={{
                  background: 'rgba(255,255,255,0.08)', border: 'none', color: '#94a3b8',
                  width: '32px', height: '32px', borderRadius: '8px', cursor: 'pointer', fontSize: '16px',
                }}
              >×</button>
            </div>

            {/* Viral Score */}
            <div style={{
              background: `linear-gradient(135deg, ${SCORE_COLOR(tpl.viralScore)}22, transparent)`,
              border: `1px solid ${SCORE_COLOR(tpl.viralScore)}44`,
              borderRadius: '12px', padding: '14px 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '2px' }}>VIRAL SCORE</div>
                <div style={{ fontSize: '28px', fontWeight: '900', color: SCORE_COLOR(tpl.viralScore) }}>
                  {tpl.viralScore}<span style={{ fontSize: '14px', color: '#64748b' }}>/10</span>
                </div>
              </div>
              <div style={{ fontSize: '24px' }}>{SCORE_LABEL(tpl.viralScore)}</div>
            </div>

            {/* Specs Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {[
                { label: 'Layout', value: `${layout.icon} ${layout.label}`, color: layout.color },
                { label: 'Subject', value: SUBJECT_LABELS[tpl.subjectVisibility] || tpl.subjectVisibility },
                { label: 'Fade Type', value: tpl.fadeType, color: FADE_COLORS[tpl.fadeType] },
                { label: 'Fade Opacity', value: `${Math.round(tpl.fadeOpacity * 100)}%` },
                { label: 'Text Zone', value: `${tpl.textZone?.position} / ${tpl.textZone?.alignment}` },
                { label: 'Text Height', value: `${Math.round((tpl.textZone?.heightRatio || 0) * 100)}%` },
                { label: 'Subject X/Y', value: `${tpl.subjectPosition?.x} / ${tpl.subjectPosition?.y}` },
                { label: 'Subject Size', value: `${Math.round((tpl.subjectPosition?.sizeRatio || 0) * 100)}%` },
              ].map(({ label, value, color }) => (
                <div key={label} style={{
                  background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '10px 12px',
                }}>
                  <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: color || '#e2e8f0' }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Colors */}
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Color Scheme</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {Object.entries(tpl.colorScheme || {}).map(([key, hex]) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{
                      width: '24px', height: '24px', borderRadius: '6px',
                      background: hex, border: '1px solid rgba(255,255,255,0.2)',
                    }} />
                    <div>
                      <div style={{ fontSize: '9px', color: '#64748b', textTransform: 'capitalize' }}>{key}</div>
                      <div style={{ fontSize: '10px', color: '#94a3b8', fontFamily: 'monospace' }}>{hex}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tags */}
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tags</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {(tpl.tags || []).map(tag => (
                  <span key={tag} style={{
                    background: 'rgba(99,102,241,0.2)', color: '#a5b4fc',
                    borderRadius: '6px', padding: '3px 10px', fontSize: '11px',
                    border: '1px solid rgba(99,102,241,0.3)',
                  }}>
                    #{tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Notes */}
            {tpl.notes && (
              <div style={{
                background: 'rgba(255,255,255,0.03)', borderRadius: '10px',
                padding: '12px 14px', borderLeft: '3px solid #6366f1',
              }}>
                <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Analysis Notes</div>
                <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: '1.6' }}>{tpl.notes}</div>
              </div>
            )}

            {/* Copy ID button */}
            <button
              onClick={() => navigator.clipboard.writeText(tpl.id)}
              style={{
                padding: '10px', borderRadius: '10px', border: '1px solid rgba(99,102,241,0.4)',
                background: 'rgba(99,102,241,0.1)', color: '#a5b4fc',
                cursor: 'pointer', fontSize: '12px', fontWeight: '600',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,102,241,0.25)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(99,102,241,0.1)'}
            >
              📋 Copy Template ID: {tpl.id}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CoverTemplatesPage() {
  const [templates, setTemplates]   = useState([]);
  const [stats, setStats]           = useState(null);
  const [allTags, setAllTags]       = useState([]);
  const [allDays, setAllDays]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [selected, setSelected]     = useState(null);
  const [search, setSearch]         = useState('');

  // Filters
  const [filterLayout,  setFilterLayout]  = useState('');
  const [filterScore,   setFilterScore]   = useState(0);
  const [filterSubject, setFilterSubject] = useState('');
  const [filterFade,    setFilterFade]    = useState('');
  const [filterTag,     setFilterTag]     = useState('');
  const [filterDay,     setFilterDay]     = useState('');
  const [sortBy,        setSortBy]        = useState('score'); // score | day | id

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterLayout)  params.set('layoutType', filterLayout);
      if (filterScore)   params.set('minScore', filterScore);
      if (filterSubject) params.set('subjectVisibility', filterSubject);
      if (filterFade)    params.set('fadeType', filterFade);
      if (filterTag)     params.set('tag', filterTag);
      if (filterDay)     params.set('day', filterDay);
      params.set('limit', '200');

      const res  = await fetch(`/api/cover-templates?${params}`);
      const data = await res.json();
      if (data.success) {
        setTemplates(data.templates || []);
        setStats(data.stats || null);
        setAllTags(data.allTags || []);
        setAllDays(data.allDays || []);
      }
    } catch (e) {
      console.error('Failed to load templates:', e);
    }
    setLoading(false);
  }, [filterLayout, filterScore, filterSubject, filterFade, filterTag, filterDay]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  // Client-side search + sort
  const displayed = [...templates]
    .filter(t => !search || t.notes?.toLowerCase().includes(search.toLowerCase()) || t.tags?.some(tag => tag.includes(search.toLowerCase())) || t.sourceFile.includes(search))
    .sort((a, b) => {
      if (sortBy === 'score') return b.viralScore - a.viralScore;
      if (sortBy === 'day')   return a.day.localeCompare(b.day);
      return a.id.localeCompare(b.id);
    });

  const resetFilters = () => {
    setFilterLayout(''); setFilterScore(0); setFilterSubject('');
    setFilterFade(''); setFilterTag(''); setFilterDay(''); setSearch('');
  };

  const activeFilterCount = [filterLayout, filterScore, filterSubject, filterFade, filterTag, filterDay].filter(Boolean).length;

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #020617 0%, #0f172a 50%, #1e1b4b 100%)',
      color: '#e2e8f0',
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        background: 'rgba(2,6,23,0.8)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        padding: '20px 32px',
        backdropFilter: 'blur(20px)',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '1600px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{
              width: '44px', height: '44px', borderRadius: '12px',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '20px', boxShadow: '0 4px 15px rgba(99,102,241,0.4)',
            }}>🎨</div>
            <div>
              <h1 style={{ fontSize: '22px', fontWeight: '800', margin: 0, letterSpacing: '-0.5px' }}>
                Cover Templates
              </h1>
              <p style={{ fontSize: '12px', color: '#64748b', margin: '2px 0 0' }}>
                {stats ? `${stats.total} templates • avg viral score ${stats.avgViralScore}/10` : 'Loading...'}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {/* Sort */}
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              style={{
                padding: '8px 12px', borderRadius: '8px',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#e2e8f0', fontSize: '12px', cursor: 'pointer',
              }}
            >
              <option value="score">Sort: Viral Score ↓</option>
              <option value="day">Sort: By Day</option>
              <option value="id">Sort: Template ID</option>
            </select>
            <a href="/cover-gallery" style={{
              padding: '8px 14px', borderRadius: '8px', textDecoration: 'none',
              background: 'rgba(255,255,255,0.06)', color: '#94a3b8', fontSize: '12px',
            }}>📦 Gallery</a>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: '1600px', margin: '0 auto', padding: '24px 32px', display: 'grid', gridTemplateColumns: '260px 1fr', gap: '24px', alignItems: 'start' }}>

        {/* ── Sidebar Filters ─────────────────────────────────────────────── */}
        <div style={{ position: 'sticky', top: '100px' }}>
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '16px', padding: '20px',
          }}>
            {/* Stats summary */}
            {stats && (
              <div style={{ marginBottom: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {[
                  { label: 'Total', value: stats.total, color: '#6366f1' },
                  { label: 'Showing', value: displayed.length, color: '#10b981' },
                  { label: 'Avg Score', value: stats.avgViralScore, color: '#f59e0b' },
                  { label: 'Score 9+', value: Object.entries(stats.byScore || {}).filter(([s]) => parseInt(s) >= 9).reduce((a, [, v]) => a + v, 0), color: '#ef4444' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{
                    background: 'rgba(255,255,255,0.04)', borderRadius: '10px',
                    padding: '10px 12px', textAlign: 'center',
                  }}>
                    <div style={{ fontSize: '20px', fontWeight: '800', color }}>{value}</div>
                    <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Search */}
            <div style={{ marginBottom: '16px' }}>
              <input
                type="text"
                placeholder="🔍 ค้นหา tag, notes..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  width: '100%', padding: '9px 12px', borderRadius: '9px',
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                  color: '#e2e8f0', fontSize: '12px', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Layout Type */}
              <FilterGroup label="Layout Type" value={filterLayout} onChange={setFilterLayout}
                options={[{ value: '', label: 'ทั้งหมด' },
                  ...Object.entries(LAYOUT_LABELS).map(([v, { label, icon, color }]) => ({
                    value: v, label: `${icon} ${label}`,
                    count: stats?.byLayout?.[v] || 0, color,
                  }))]}
              />

              {/* Min Score */}
              <div>
                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Viral Score ≥ {filterScore || 'ทั้งหมด'}
                </div>
                <input
                  type="range" min="0" max="9" value={filterScore}
                  onChange={e => setFilterScore(parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: '#6366f1' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#475569' }}>
                  <span>Any</span><span>6</span><span>7</span><span>8</span><span>9+</span>
                </div>
              </div>

              {/* Subject */}
              <FilterGroup label="Subject" value={filterSubject} onChange={setFilterSubject}
                options={[{ value: '', label: 'ทั้งหมด' },
                  ...Object.entries(SUBJECT_LABELS).map(([v, label]) => ({
                    value: v, label, count: stats?.bySubject?.[v] || 0,
                  }))]}
              />

              {/* Day */}
              <FilterGroup label="วันที่" value={filterDay} onChange={setFilterDay}
                options={[{ value: '', label: 'ทั้งหมด' },
                  ...allDays.map(d => ({ value: d, label: d, count: stats?.byDay?.[d] || 0 }))]}
              />

              {/* Fade */}
              <FilterGroup label="Fade Effect" value={filterFade} onChange={setFilterFade}
                options={[{ value: '', label: 'ทั้งหมด' },
                  ...Object.keys(FADE_COLORS).map(v => ({ value: v, label: v, color: FADE_COLORS[v] }))]}
              />

              {/* Tags */}
              <div>
                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tags</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', maxHeight: '100px', overflowY: 'auto' }}>
                  <button
                    onClick={() => setFilterTag('')}
                    style={{
                      padding: '3px 8px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontSize: '11px',
                      background: !filterTag ? '#6366f1' : 'rgba(255,255,255,0.07)',
                      color: !filterTag ? '#fff' : '#94a3b8',
                    }}
                  >All</button>
                  {allTags.map(tag => (
                    <button
                      key={tag}
                      onClick={() => setFilterTag(tag === filterTag ? '' : tag)}
                      style={{
                        padding: '3px 8px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontSize: '11px',
                        background: filterTag === tag ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.06)',
                        color: filterTag === tag ? '#c7d2fe' : '#64748b',
                      }}
                    >#{tag}</button>
                  ))}
                </div>
              </div>

              {/* Reset */}
              {activeFilterCount > 0 && (
                <button
                  onClick={resetFilters}
                  style={{
                    padding: '9px', borderRadius: '9px', border: '1px solid rgba(239,68,68,0.4)',
                    background: 'rgba(239,68,68,0.1)', color: '#f87171',
                    cursor: 'pointer', fontSize: '12px', fontWeight: '600',
                  }}
                >
                  ✕ ล้าง Filter ({activeFilterCount})
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Main Grid ───────────────────────────────────────────────────── */}
        <div>
          {/* Score distribution bar */}
          {stats && (
            <div style={{
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: '12px', padding: '14px 18px', marginBottom: '20px',
              display: 'flex', gap: '12px', alignItems: 'center',
            }}>
              <span style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Score dist.</span>
              <div style={{ display: 'flex', gap: '4px', flex: 1, height: '20px', borderRadius: '6px', overflow: 'hidden' }}>
                {[9, 8, 7, 6].map(score => {
                  const count = stats.byScore?.[score] || 0;
                  const pct   = (count / stats.total * 100).toFixed(1);
                  return count > 0 ? (
                    <div key={score} title={`Score ${score}: ${count} templates (${pct}%)`}
                      style={{
                        flex: count, background: SCORE_COLOR(score),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '10px', fontWeight: '700', color: '#fff', minWidth: '24px',
                      }}>
                      {count}
                    </div>
                  ) : null;
                })}
              </div>
              <span style={{ fontSize: '11px', color: '#475569' }}>{displayed.length} / {stats.total} shown</span>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div style={{ textAlign: 'center', padding: '80px 0', color: '#475569' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px', animation: 'spin 1s linear infinite' }}>⟳</div>
              <div style={{ fontSize: '14px' }}>Loading templates...</div>
            </div>
          )}

          {/* Empty state */}
          {!loading && displayed.length === 0 && (
            <div style={{
              textAlign: 'center', padding: '80px 0', color: '#475569',
              background: 'rgba(255,255,255,0.02)', borderRadius: '16px',
              border: '1px dashed rgba(255,255,255,0.08)',
            }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔍</div>
              <div style={{ fontSize: '16px', fontWeight: '600', color: '#64748b' }}>ไม่พบ template ที่ตรงกับ filter</div>
              <button onClick={resetFilters} style={{
                marginTop: '16px', padding: '8px 20px', borderRadius: '8px',
                background: '#6366f1', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '13px',
              }}>ล้าง Filter</button>
            </div>
          )}

          {/* Template Grid */}
          {!loading && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: '16px',
            }}>
              {displayed.map(tpl => (
                <TemplateCard key={tpl.id} tpl={tpl} onClick={setSelected} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {selected && <DetailModal tpl={selected} onClose={() => setSelected(null)} />}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        * { box-sizing: border-box; }
        select option { background: #0f172a; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
      `}</style>
    </div>
  );
}

// ─── Helper: FilterGroup ──────────────────────────────────────────────────────
function FilterGroup({ label, value, onChange, options }) {
  return (
    <div>
      <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '8px 10px', borderRadius: '8px',
          background: 'rgba(255,255,255,0.06)', border: `1px solid ${value ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.1)'}`,
          color: value ? '#a5b4fc' : '#94a3b8', fontSize: '12px', cursor: 'pointer',
        }}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}{opt.count ? ` (${opt.count})` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
