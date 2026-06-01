'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const CATEGORIES = ['ทั้งหมด', 'การเมือง', 'สังคม', 'อาชญากรรม', 'อุบัติเหตุ', 'บันเทิง', 'กีฬา', 'เศรษฐกิจ', 'สุขภาพ', 'ต่างประเทศ', 'เทคโนโลยี', 'สิ่งแวดล้อม', 'ทั่วไป'];
const SOURCE_TYPES = ['ทั้งหมด', 'web', 'youtube', 'tiktok', 'manual'];
const SORTS = [
  { value: 'newest', label: 'ใหม่สุด' },
  { value: 'oldest', label: 'เก่าสุด' },
  { value: 'most_used', label: 'ใช้บ่อยสุด' },
  { value: 'viral_score', label: 'Viral Score สูงสุด' },
];

const CATEGORY_COLORS = {
  'การเมือง': { bg: 'rgba(239,68,68,0.15)', color: '#f87171' },
  'สังคม': { bg: 'rgba(16,185,129,0.15)', color: '#34d399' },
  'อาชญากรรม': { bg: 'rgba(245,158,11,0.15)', color: '#fbbf24' },
  'อุบัติเหตุ': { bg: 'rgba(239,68,68,0.12)', color: '#fc8181' },
  'บันเทิง': { bg: 'rgba(168,85,247,0.15)', color: '#c084fc' },
  'กีฬา': { bg: 'rgba(59,130,246,0.15)', color: '#60a5fa' },
  'เศรษฐกิจ': { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b' },
  'สุขภาพ': { bg: 'rgba(16,185,129,0.15)', color: '#10b981' },
  'ต่างประเทศ': { bg: 'rgba(14,165,233,0.15)', color: '#38bdf8' },
  'เทคโนโลยี': { bg: 'rgba(99,102,241,0.15)', color: '#818cf8' },
  'สิ่งแวดล้อม': { bg: 'rgba(5,150,105,0.15)', color: '#059669' },
  'ทั่วไป': { bg: 'rgba(100,116,139,0.15)', color: '#94a3b8' },
};

const SOURCE_ICONS = { web: '🌐', youtube: '▶️', tiktok: '🎵', manual: '✏️' };

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'เมื่อกี้';
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ชั่วโมงที่แล้ว`;
  const day = Math.floor(h / 24);
  if (day < 7) return `${day} วันที่แล้ว`;
  return formatDate(iso);
}

export default function NewsArchivePage() {
  const router = useRouter();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [category, setCategory] = useState('ทั้งหมด');
  const [sourceType, setSourceType] = useState('ทั้งหมด');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [deletingId, setDeletingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [stats, setStats] = useState({ today: 0, week: 0, total: 0 });
  const LIMIT = 18;

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
        sort,
        ...(search && { search }),
        ...(category !== 'ทั้งหมด' && { category }),
        ...(sourceType !== 'ทั้งหมด' && { source_type: sourceType }),
      });
      const res = await fetch(`/api/news-archive?${params}`);
      const data = await res.json();
      if (data.success) {
        setItems(data.data.items || []);
        setTotal(data.data.total || 0);
        setTotalPages(data.data.totalPages || 1);
        // Compute quick stats
        const now = Date.now();
        const today = (data.data.items || []).filter(i => now - new Date(i.archived_at || i.createdAt).getTime() < 86400000).length;
        const week = (data.data.items || []).filter(i => now - new Date(i.archived_at || i.createdAt).getTime() < 7 * 86400000).length;
        setStats({ today, week, total: data.data.total || 0 });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, search, category, sourceType, sort]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  // Search debounce
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const handleUse = async (item) => {
    // บันทึก used_count
    await fetch(`/api/news-archive/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ used_count: (item.used_count || 0) + 1, last_used_at: new Date().toISOString() }),
    }).catch(() => {});
    // Navigate ไปหน้าสร้าง
    router.push(`/content/new?archive_id=${item.id}`);
  };

  const handleDelete = async (id) => {
    if (!confirm('ลบข่าวนี้ออกจากคลังแน่ใจไหม?')) return;
    setDeletingId(id);
    try {
      await fetch(`/api/news-archive/${id}`, { method: 'DELETE' });
      setItems(prev => prev.filter(i => i.id !== id));
      setTotal(prev => prev - 1);
    } catch (e) { alert('ลบไม่สำเร็จ'); }
    setDeletingId(null);
  };

  const catStyle = (cat) => CATEGORY_COLORS[cat] || CATEGORY_COLORS['ทั่วไป'];

  return (
    <div style={{ padding: '24px 24px 60px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 28 }}>📦</span>
            <span style={{ background: 'linear-gradient(135deg, #10b981, #0ea5e9)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              คลังข่าว
            </span>
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            ข่าวที่สกัดแล้วทั้งหมด — หยิบมาใช้สร้างคอนเทนต์ได้ทันที
          </p>
        </div>
        <button onClick={() => router.push('/content/new')}
          style={{ background: 'linear-gradient(135deg, #10b981, #0ea5e9)', border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, padding: '10px 20px', borderRadius: 'var(--radius-md)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          ✨ สร้างข่าวใหม่
        </button>
      </div>

      {/* Stats Bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'ทั้งหมด', value: total, icon: '📦', color: '#0ea5e9' },
          { label: 'วันนี้', value: stats.today, icon: '🕐', color: '#10b981' },
          { label: 'สัปดาห์นี้', value: stats.week, icon: '📅', color: '#a78bfa' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>{s.icon}</span>
            <div>
              <div style={{ fontSize: 20, fontWeight: 900, color: s.color, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 20, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Search */}
        <div style={{ flex: '1 1 220px', position: 'relative' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>🔍</span>
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="ค้นหาหัวข้อ เนื้อหา..."
            style={{ width: '100%', paddingLeft: 32, paddingRight: 12, paddingTop: 9, paddingBottom: 9, background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box' }}
          />
        </div>
        {/* Category */}
        <select value={category} onChange={e => { setCategory(e.target.value); setPage(1); }}
          style={{ padding: '9px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer', flex: '0 0 auto' }}>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {/* Source */}
        <select value={sourceType} onChange={e => { setSourceType(e.target.value); setPage(1); }}
          style={{ padding: '9px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer', flex: '0 0 auto' }}>
          {SOURCE_TYPES.map(s => <option key={s} value={s}>{s === 'ทั้งหมด' ? 'ทุกแหล่ง' : (SOURCE_ICONS[s] + ' ' + s)}</option>)}
        </select>
        {/* Sort */}
        <select value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}
          style={{ padding: '9px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer', flex: '0 0 auto' }}>
          {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {(search || category !== 'ทั้งหมด' || sourceType !== 'ทั้งหมด') && (
          <button onClick={() => { setSearchInput(''); setCategory('ทั้งหมด'); setSourceType('ทั้งหมด'); setPage(1); }}
            style={{ padding: '9px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#f87171', fontSize: 12, cursor: 'pointer' }}>
            ✕ ล้าง
          </button>
        )}
      </div>

      {/* Results count */}
      {!loading && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          {search || category !== 'ทั้งหมด' || sourceType !== 'ทั้งหมด'
            ? `ค้นพบ ${items.length} รายการ`
            : `ทั้งหมด ${total} รายการ`}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {Array(6).fill(0).map((_, i) => (
            <div key={i} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 20, height: 200, animation: 'pulse 1.5s infinite' }} />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && items.length === 0 && (
        <div style={{ textAlign: 'center', padding: '80px 20px' }}>
          <div style={{ fontSize: 60, marginBottom: 16 }}>📭</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
            {search || category !== 'ทั้งหมด' ? 'ไม่พบข่าวที่ตรงกับการค้นหา' : 'ยังไม่มีข่าวในคลัง'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
            {search ? 'ลองเปลี่ยน keyword หรือล้างตัวกรอง' : 'สร้างข่าวใหม่ ระบบจะบันทึกเข้าคลังอัตโนมัติหลัง Breakdown'}
          </div>
          {!search && (
            <button onClick={() => router.push('/content/new')}
              style={{ background: 'linear-gradient(135deg, #10b981, #0ea5e9)', border: 'none', color: '#fff', fontWeight: 700, padding: '12px 28px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 14 }}>
              ✨ สร้างข่าวใหม่
            </button>
          )}
        </div>
      )}

      {/* Grid */}
      {!loading && items.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {items.map(item => {
            const cat = catStyle(item.category);
            const isExpanded = expandedId === item.id;
            return (
              <div key={item.id}
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', transition: 'all 0.2s', display: 'flex', flexDirection: 'column' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#10b981'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                {/* Top bar */}
                <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {/* Category */}
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: cat.bg, color: cat.color }}>
                    {item.category || 'ทั่วไป'}
                  </span>
                  {/* Source */}
                  {item.source_name && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>
                      {SOURCE_ICONS[item.source_type] || '🌐'} {item.source_name}
                    </span>
                  )}
                  {/* Time */}
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    {timeAgo(item.archived_at || item.createdAt)}
                  </span>
                </div>

                {/* Content */}
                <div style={{ padding: '14px', flex: 1 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px', lineHeight: 1.5,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {item.title}
                  </h3>
                  {item.summary && (
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.7,
                      display: '-webkit-box', WebkitLineClamp: isExpanded ? 999 : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {item.summary}
                    </p>
                  )}

                  {/* Key people & places */}
                  {((item.key_people?.length > 0) || (item.key_places?.length > 0)) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                      {item.key_people?.slice(0, 2).map((p, i) => (
                        <span key={i} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 8, background: 'rgba(168,85,247,0.1)', color: '#c084fc' }}>
                          👤 {p}
                        </span>
                      ))}
                      {item.key_places?.slice(0, 2).map((p, i) => (
                        <span key={i} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 8, background: 'rgba(14,165,233,0.1)', color: '#38bdf8' }}>
                          📍 {p}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Tags */}
                  {item.tags?.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                      {item.tags.slice(0, 3).map((t, i) => (
                        <span key={i} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 6, background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Stats row */}
                  <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                    <span>📝 {(item.word_count || 0).toLocaleString()} คำ</span>
                    {item.viral_score && <span>🔥 {item.viral_score}/10</span>}
                    {item.used_count > 0 && <span style={{ color: '#10b981' }}>✅ ใช้แล้ว {item.used_count} ครั้ง</span>}
                    {item.source_url && (
                      <a href={item.source_url} target="_blank" rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{ color: '#38bdf8', textDecoration: 'none' }}>
                        🔗 ต้นฉบับ
                      </a>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                  <button onClick={() => handleUse(item)}
                    style={{ flex: 1, padding: '8px 0', background: 'linear-gradient(135deg, #10b981, #0ea5e9)', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                    🚀 ใช้ข่าวนี้
                  </button>
                  <button onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    style={{ padding: '8px 12px', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>
                    {isExpanded ? '▲' : '▼'}
                  </button>
                  <button onClick={() => handleDelete(item.id)} disabled={deletingId === item.id}
                    style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, color: '#f87171', fontSize: 12, cursor: 'pointer' }}>
                    🗑
                  </button>
                </div>

                {/* Expanded body preview */}
                {isExpanded && (
                  <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.8, maxHeight: 300, overflowY: 'auto',
                      marginTop: 12, padding: '10px', background: 'var(--bg-primary)', borderRadius: 8,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {(item.body || '').slice(0, 1500)}{item.body?.length > 1500 ? '...' : ''}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
                      บันทึกเมื่อ: {formatDate(item.archived_at || item.createdAt)}
                      {item.archived_by && ` • โดย ${item.archived_by}`}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 32 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            style={{ padding: '8px 16px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.5 : 1 }}>
            ← ก่อนหน้า
          </button>
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
            return (
              <button key={p} onClick={() => setPage(p)}
                style={{ padding: '8px 14px', background: p === page ? 'linear-gradient(135deg, #10b981, #0ea5e9)' : 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, color: p === page ? '#fff' : 'var(--text-primary)', cursor: 'pointer', fontWeight: p === page ? 700 : 400 }}>
                {p}
              </button>
            );
          })}
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            style={{ padding: '8px 16px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', cursor: page === totalPages ? 'not-allowed' : 'pointer', opacity: page === totalPages ? 0.5 : 1 }}>
            ถัดไป →
          </button>
        </div>
      )}
    </div>
  );
}
