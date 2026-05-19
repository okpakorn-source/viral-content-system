'use client';
import { useState, useEffect, useCallback } from 'react';

const PRIORITY_BADGE = {
  face_closeup:   { label: 'หน้าหลัก', color: '#a3e635' },
  context_action: { label: 'เหตุการณ์', color: '#3b82f6' },
  reaction_face:  { label: 'วงกลม', color: '#ec4899' },
  background_blur:{ label: 'พื้นหลัง', color: '#6b7280' },
  supporting:     { label: 'ประกอบ', color: '#f59e0b' },
};

function SlotBadge({ slot }) {
  const badge = PRIORITY_BADGE[slot.priority] || PRIORITY_BADGE.supporting;
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '5px 8px', background: 'var(--bg-primary)', borderRadius: 6, fontSize: 11 }}>
      <span style={{ background: badge.color, color: '#000', borderRadius: 3, padding: '1px 5px', fontWeight: 800, fontSize: 9, minWidth: 20, textAlign: 'center' }}>{slot.id}</span>
      <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{slot.role}</span>
      <span style={{ marginLeft: 'auto', color: badge.color, fontSize: 10, fontFamily: 'monospace' }}>
        {slot.position?.w}×{slot.position?.h}
      </span>
      <span style={{ fontSize: 9, padding: '1px 4px', background: badge.color + '22', color: badge.color, borderRadius: 3 }}>
        {badge.label}
      </span>
    </div>
  );
}

function TemplateCard({ template, onSelect, onDelete, onFavorite, selected }) {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!confirm('ลบ template "' + template.templateName + '" ?')) return;
    setDeleting(true);
    try {
      await fetch('/api/templates/' + template.id, { method: 'DELETE' });
      onDelete(template.id);
    } catch (err) {
      alert('ลบไม่สำเร็จ: ' + err.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleFavorite = async (e) => {
    e.stopPropagation();
    try {
      const res = await fetch('/api/templates/' + template.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'favorite' }),
      });
      const data = await res.json();
      if (data.success) onFavorite(data.template);
    } catch {}
  };

  const slots = template.slots || template.zones || [];
  const isCustom = template.source === 'reverse_engineered';

  return (
    <div
      onClick={() => onSelect(template)}
      style={{
        border: selected ? '2px solid #a3e635' : '1px solid var(--border)',
        borderRadius: 12,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'all .15s',
        background: selected ? 'rgba(163,230,53,0.04)' : 'var(--bg-secondary)',
        boxShadow: selected ? '0 0 0 3px rgba(163,230,53,0.15)' : 'none',
      }}
    >
      {/* Preview image */}
      <div style={{ position: 'relative', aspectRatio: '1/1', background: '#0c0c14', overflow: 'hidden' }}>
        {template.previewImage ? (
          <img src={template.previewImage} alt={template.templateName} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 32, color: 'rgba(163,230,53,0.3)' }}>
            🖼️
          </div>
        )}
        {/* Badges overlay */}
        <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', gap: 4 }}>
          {isCustom && (
            <span style={{ background: '#6366f1', color: '#fff', fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>AI</span>
          )}
          {template.isFavorite && (
            <span style={{ background: '#f59e0b', color: '#000', fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>⭐</span>
          )}
          {selected && (
            <span style={{ background: '#a3e635', color: '#000', fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>✓ เลือกอยู่</span>
          )}
        </div>
        {/* Action buttons */}
        <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
          <button onClick={handleFavorite} title={template.isFavorite ? 'ยกเลิก favorite' : 'Favorite'} style={{
            padding: '4px 7px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13,
            background: template.isFavorite ? '#f59e0b' : 'rgba(0,0,0,0.6)', color: template.isFavorite ? '#000' : '#fff',
          }}>⭐</button>
          <button onClick={handleDelete} disabled={deleting} title="ลบ template" style={{
            padding: '4px 7px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13,
            background: 'rgba(239,68,68,0.7)', color: '#fff',
          }}>{deleting ? '…' : '🗑️'}</button>
        </div>
      </div>

      {/* Info */}
      <div style={{ padding: '10px 12px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {template.templateName}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>
          {slots.length} slots · {template.totalPhotosNeeded || slots.length} รูป
          {template.canvas && ` · ${template.canvas.width}×${template.canvas.height}`}
        </div>

        {/* Expand slots */}
        <button
          onClick={e => { e.stopPropagation(); setExpanded(p => !p); }}
          style={{ width: '100%', padding: '5px', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 10, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', marginBottom: expanded ? 8 : 0 }}
        >
          {expanded ? '▲ ซ่อน slots' : `▼ ดู ${slots.length} slots`}
        </button>

        {expanded && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {slots.map(s => <SlotBadge key={s.id} slot={s} />)}
          </div>
        )}
      </div>

      {/* Select button */}
      <div style={{ padding: '0 12px 12px' }}>
        <button
          onClick={(e) => { e.stopPropagation(); onSelect(template); }}
          style={{
            width: '100%', padding: '8px', borderRadius: 7, border: 'none',
            background: selected ? '#a3e635' : 'rgba(163,230,53,0.12)',
            color: selected ? '#000' : '#a3e635',
            fontWeight: 700, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {selected ? '✓ ใช้งาน template นี้' : '→ ใช้ template นี้'}
        </button>
      </div>
    </div>
  );
}

export default function TemplateLibrary({ selectedId, onSelect }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [filter, setFilter]       = useState('all'); // 'all' | 'favorite' | 'ai'
  const [search, setSearch]       = useState('');

  const loadTemplates = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/templates');
      const data = await res.json();
      if (data.success) {
        // Also merge localStorage templates for backward compatibility
        let localTemplates = [];
        try {
          const lt = JSON.parse(localStorage.getItem('customTemplates') || '[]');
          // Only include ones not already in API
          const apiIds = new Set((data.templates || []).map(t => t.id));
          localTemplates = lt.filter(t => !apiIds.has(t.id)).map(t => ({
            ...t,
            templateName: t.name || t.templateName || 'Custom Template',
            source: t.source || 'localStorage',
          }));
        } catch {}
        setTemplates([...data.templates, ...localTemplates]);
      } else {
        setError(data.error);
      }
    } catch (e) {
      setError('โหลดไม่สำเร็จ: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const handleDelete = (id) => {
    setTemplates(p => p.filter(t => t.id !== id));
    // Also remove from localStorage if exists
    try {
      const lt = JSON.parse(localStorage.getItem('customTemplates') || '[]');
      localStorage.setItem('customTemplates', JSON.stringify(lt.filter(t => t.id !== id)));
    } catch {}
  };

  const handleFavorite = (updated) => {
    setTemplates(p => p.map(t => t.id === updated.id ? { ...t, isFavorite: updated.isFavorite } : t));
  };

  const filtered = templates
    .filter(t => filter === 'all' ? true : filter === 'favorite' ? t.isFavorite : t.source === 'reverse_engineered')
    .filter(t => !search || (t.templateName || t.name || '').toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ padding: 20 }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#a3e635', marginBottom: 4 }}>
          📚 Template Library
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {templates.length} templates ทั้งหมด — คลิกเพื่อเลือกใช้งาน
        </div>
      </div>

      {/* Search + Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="ค้นหา template..."
          style={{
            flex: 1, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'inherit',
          }}
        />
        <button onClick={loadTemplates} title="Refresh" style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}>
          🔄
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {[
          { id: 'all', label: 'ทั้งหมด', count: templates.length },
          { id: 'favorite', label: '⭐ Favorite', count: templates.filter(t => t.isFavorite).length },
          { id: 'ai', label: '🤖 AI วิเคราะห์', count: templates.filter(t => t.source === 'reverse_engineered').length },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
            background: filter === f.id ? '#a3e635' : 'var(--bg-primary)',
            color: filter === f.id ? '#000' : 'var(--text-muted)',
            fontWeight: filter === f.id ? 700 : 400,
          }}>
            {f.label} {f.count > 0 && <span style={{ opacity: 0.7 }}>({f.count})</span>}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
          กำลังโหลด template library...
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, fontSize: 12, color: '#fca5a5', marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📂</div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
            {search ? 'ไม่พบ template ที่ค้นหา' : 'ยังไม่มี template ใน library'}
          </div>
          <div style={{ fontSize: 11 }}>
            ไปที่แท็บ "🔍 วิเคราะห์ Template" เพื่อเพิ่ม template ใหม่
          </div>
        </div>
      )}

      {/* Grid */}
      {!loading && filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          {filtered.map(t => (
            <TemplateCard
              key={t.id}
              template={t}
              selected={selectedId === t.id}
              onSelect={onSelect}
              onDelete={handleDelete}
              onFavorite={handleFavorite}
            />
          ))}
        </div>
      )}
    </div>
  );
}
