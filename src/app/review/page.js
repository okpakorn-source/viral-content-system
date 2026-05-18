'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import Header from '@/components/layout/Header';
import Link from 'next/link';

const STATUS = {
  all:      { label: 'ทั้งหมด',  icon: '📋', color: '#94a3b8' },
  pending:  { label: 'รอตรวจ',   icon: '⏳', color: '#fbbf24' },
  approved: { label: 'อนุมัติ',  icon: '✅', color: '#22c55e' },
  rejected: { label: 'ไม่ผ่าน', icon: '❌', color: '#ef4444' },
  revision: { label: 'แก้ไข',   icon: '🔄', color: '#a78bfa' },
};

const SRC = { url: '🔗', image: '🖼️', raw: '📝', tiktok: '🎵', youtube: '📺', facebook: '📘' };

function fmt(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function ReviewPage() {
  const [reviews, setReviews]         = useState([]);
  const [stats, setStats]             = useState({});
  const [filter, setFilter]           = useState('all');
  const [search, setSearch]           = useState('');
  const [loading, setLoading]         = useState(true);
  const [expandedId, setExpandedId]   = useState(null);
  const [noteText, setNoteText]       = useState({});
  const [updating, setUpdating]       = useState(null);
  const [copied, setCopied]           = useState(null);
  const [engInput, setEngInput]       = useState({});
  const [engSaved, setEngSaved]       = useState({});
  const [toast, setToast]             = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/review?status=${filter}&search=${encodeURIComponent(search)}&limit=100`);
      const data = await res.json();
      if (data.success) { setReviews(data.reviews || []); setStats(data.stats || {}); }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [filter, search]);

  useEffect(() => { load(); }, [load]);

  const members = useMemo(() => {
    const m = new Map();
    reviews.forEach(r => {
      if (r.submittedBy?.id) {
        const prev = m.get(r.submittedBy.id) || { ...r.submittedBy, count: 0 };
        m.set(r.submittedBy.id, { ...prev, count: prev.count + 1 });
      }
    });
    return [...m.values()];
  }, [reviews]);

  const [memberFilter, setMemberFilter] = useState('all');
  const filtered = useMemo(() => {
    if (memberFilter === 'all') return reviews;
    return reviews.filter(r => r.submittedBy?.id === memberFilter);
  }, [reviews, memberFilter]);

  const updateStatus = async (id, status) => {
    setUpdating(id);
    try {
      const res = await fetch('/api/review', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, note: noteText[id] || '' }),
      });
      const d = await res.json();
      if (d.success) { showToast(`✅ อัปเดตเป็น "${STATUS[status]?.label}" แล้ว`); await load(); }
    } catch (e) { console.error(e); }
    setUpdating(null);
  };

  const del = async (id) => {
    if (!confirm('ลบรายการนี้?')) return;
    await fetch(`/api/review?id=${id}`, { method: 'DELETE' });
    showToast('🗑️ ลบแล้ว'); load();
  };

  const copy = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id); setTimeout(() => setCopied(null), 2000);
      showToast('📋 คัดลอกแล้ว');
    });
  };

  const saveEng = async (id) => {
    const inp = engInput[id]; if (!inp) return;
    await fetch('/api/review', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, engagement: { likes: +inp.likes || 0, shares: +inp.shares || 0, comments: +inp.comments || 0 } }),
    });
    setEngSaved(p => ({ ...p, [id]: true }));
    setTimeout(() => setEngSaved(p => ({ ...p, [id]: false })), 2500);
    showToast('📊 บันทึก Engagement แล้ว');
  };

  const statBg   = (k) => filter === k ? `${STATUS[k].color}22` : 'var(--bg-card)';
  const statBord = (k) => filter === k ? `${STATUS[k].color}66` : 'var(--border)';

  return (
    <>
      <Header title="📦 คลังรอตรวจ" subtitle="ตรวจสอบ อนุมัติ และจัดการเนื้อหาก่อนเผยแพร่" />
      <div className="page-content">

        {/* Toast */}
        {toast && (
          <div style={{ position:'fixed', top:70, right:16, zIndex:9999, background:'#1e293b', border:'1px solid #334155', color:'#f1f5f9', padding:'10px 16px', borderRadius:10, fontSize:13, fontWeight:700, boxShadow:'0 8px 24px rgba(0,0,0,0.4)', animation:'fadeIn .2s' }}>
            {toast}
          </div>
        )}

        {/* Stat Cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:8, marginBottom:16 }}>
          {Object.entries(STATUS).map(([k, s]) => (
            <button key={k} onClick={() => setFilter(k)}
              style={{ padding:'14px 8px', textAlign:'center', background: statBg(k), border:`1px solid ${statBord(k)}`, borderRadius:12, cursor:'pointer', fontFamily:'inherit', transition:'all .2s' }}>
              <div style={{ fontSize:24, fontWeight:800, color: s.color }}>{k === 'all' ? (stats.total || 0) : (stats[k] || 0)}</div>
              <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>{s.icon} {s.label}</div>
            </button>
          ))}
        </div>

        {/* Search + Member Filter */}
        <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
          <input
            className="form-input" placeholder="🔍 ค้นหาหัวข้อ..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex:1, minWidth:180, fontSize:13 }}
          />
          {members.length > 0 && (
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
              <span style={{ fontSize:11, color:'var(--text-muted)' }}>👥</span>
              <button onClick={() => setMemberFilter('all')}
                style={{ padding:'5px 12px', borderRadius:20, border:'none', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'inherit', background: memberFilter === 'all' ? 'var(--accent)' : 'rgba(255,255,255,0.06)', color: memberFilter === 'all' ? '#fff' : 'var(--text-muted)' }}>
                ทุกคน ({reviews.length})
              </button>
              {members.map(m => (
                <button key={m.id} onClick={() => setMemberFilter(m.id)}
                  style={{ padding:'5px 12px', borderRadius:20, border:'none', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'inherit', transition:'all .2s', background: memberFilter === m.id ? 'linear-gradient(135deg,#f91880,#7c3aed)' : 'rgba(255,255,255,0.06)', color: memberFilter === m.id ? '#fff' : 'var(--text-muted)' }}>
                  {m.avatar} {m.name} ({m.count})
                </button>
              ))}
            </div>
          )}
          <button onClick={load} style={{ padding:'8px 14px', borderRadius:8, border:'1px solid var(--border)', background:'transparent', color:'var(--text-muted)', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>↺ รีเฟรช</button>
        </div>

        {/* List */}
        {loading ? (
          <div style={{ textAlign:'center', padding:60, color:'var(--text-muted)' }}>⏳ กำลังโหลด...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📭</div>
            <div className="empty-state-title">ไม่มีรายการ</div>
            <div className="empty-state-text">รายการจะแสดงเมื่อมีเนื้อหาถูกส่งเข้ามา</div>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {filtered.map(item => {
              const isExp = expandedId === item.id;
              const sc    = STATUS[item.status] || STATUS.pending;
              const isEnhanced = item.sourceVersion === 'enhanced';

              return (
                <div key={item.id} className="card" style={{ padding:0, overflow:'hidden', borderLeft:`3px solid ${sc.color}` }}>

                  {/* ── Header Row ── */}
                  <div onClick={() => setExpandedId(isExp ? null : item.id)}
                    style={{ padding:'12px 16px', cursor:'pointer', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', borderBottom: isExp ? '1px solid var(--border)' : 'none' }}>

                    {/* Status */}
                    <span style={{ fontSize:10, fontWeight:700, padding:'3px 9px', borderRadius:20, color: sc.color, background:`${sc.color}18`, border:`1px solid ${sc.color}30`, whiteSpace:'nowrap', flexShrink:0 }}>
                      {sc.icon} {sc.label}
                    </span>

                    {/* Source Version */}
                    <span style={{ fontSize:9, fontWeight:800, padding:'2px 8px', borderRadius:10, whiteSpace:'nowrap', flexShrink:0,
                      background: isEnhanced ? 'rgba(168,85,247,0.18)' : 'rgba(234,179,8,0.13)',
                      color: isEnhanced ? '#c084fc' : '#fbbf24',
                      border:`1px solid ${isEnhanced ? 'rgba(168,85,247,0.35)' : 'rgba(234,179,8,0.25)'}`,
                    }}>
                      {isEnhanced ? '🧬 Enhanced' : '⚡ Classic'}
                    </span>

                    {/* Title */}
                    <div style={{ flex:1, minWidth:140 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)', lineHeight:1.4 }}>
                        {item.title?.slice(0, 90) || 'ไม่มีหัวข้อ'}
                      </div>
                      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:4, alignItems:'center' }}>
                        {item.submittedBy ? (
                          <span style={{ fontSize:10, padding:'2px 7px', borderRadius:12, background:'rgba(249,24,128,0.12)', border:'1px solid rgba(249,24,128,0.2)', color:'#e879a8', fontWeight:700 }}>
                            {item.submittedBy.avatar} {item.submittedBy.name}
                          </span>
                        ) : (
                          <span style={{ fontSize:10, color:'var(--text-muted)' }}>👤 ไม่ระบุ</span>
                        )}
                        <span style={{ fontSize:9, color:'var(--text-muted)' }}>{SRC[item.sourceType] || '📄'} {item.sourceType}</span>
                        <span style={{ fontSize:9, color:'var(--text-muted)' }}>•</span>
                        <span style={{ fontSize:9, color:'var(--text-muted)' }}>{item.wordCount || 0} คำ</span>
                        {item.style && <><span style={{ fontSize:9, color:'var(--text-muted)' }}>•</span><span style={{ fontSize:9, color:'var(--text-muted)' }}>🎨 {item.style}</span></>}
                        {item.tone  && <><span style={{ fontSize:9, color:'var(--text-muted)' }}>•</span><span style={{ fontSize:9, color:'var(--text-muted)' }}>🎭 {item.tone}</span></>}
                        <span style={{ fontSize:9, color:'var(--text-muted)' }}>•</span>
                        <span style={{ fontSize:9, color:'var(--text-muted)' }}>🕐 {fmt(item.createdAt)}</span>
                      </div>
                    </div>

                    {item.presetLabel && (
                      <span style={{ fontSize:9, padding:'3px 8px', background:'rgba(99,102,241,0.15)', color:'#818cf8', border:'1px solid rgba(99,102,241,0.25)', borderRadius:20, fontWeight:700, whiteSpace:'nowrap', flexShrink:0 }}>
                        {item.presetLabel}
                      </span>
                    )}

                    {/* Engagement summary if any */}
                    {item.engagement && (
                      <span style={{ fontSize:9, color:'var(--text-muted)', whiteSpace:'nowrap', flexShrink:0 }}>
                        ❤️{item.engagement.likes || 0} 🔄{item.engagement.shares || 0} 💬{item.engagement.comments || 0}
                      </span>
                    )}

                    <span style={{ fontSize:11, color:'var(--text-muted)', transition:'transform .2s', transform: isExp ? 'rotate(180deg)' : '', flexShrink:0 }}>▼</span>
                  </div>

                  {/* ── Expanded ── */}
                  {isExp && (
                    <div style={{ padding:16 }}>

                      {/* Metadata row */}
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:8, marginBottom:14 }}>
                        {[
                          { label:'📰 ข่าวต้นฉบับ', val: item.newsTitle || '-' },
                          { label:'🔗 แหล่งที่มา',   val: item.newsSource ? item.newsSource.slice(0,50) : '-' },
                          { label:'📏 ความยาว',      val: item.contentLength || '-' },
                          { label:'👤 กลุ่มเป้าหมาย',val: item.target || '-' },
                        ].map(m => (
                          <div key={m.label} style={{ background:'var(--bg-primary)', borderRadius:8, padding:'8px 10px', border:'1px solid var(--border)' }}>
                            <div style={{ fontSize:9, color:'var(--text-muted)', marginBottom:2 }}>{m.label}</div>
                            <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)' }}>{m.val}</div>
                          </div>
                        ))}
                      </div>

                      {/* Hook */}
                      {item.hook && (
                        <div style={{ background:'rgba(251,191,36,0.07)', border:'1px solid rgba(251,191,36,0.2)', borderRadius:8, padding:'8px 12px', marginBottom:10 }}>
                          <span style={{ fontSize:9, fontWeight:800, color:'#fbbf24' }}>🪝 Hook: </span>
                          <span style={{ fontSize:12, color:'var(--text-secondary)' }}>{item.hook}</span>
                        </div>
                      )}

                      {/* Content */}
                      <div style={{ background:'var(--bg-primary)', padding:14, borderRadius:'var(--radius-md)', marginBottom:12, border:'1px solid var(--border)', fontSize:13, lineHeight:1.9, color:'var(--text-secondary)', whiteSpace:'pre-wrap', maxHeight:380, overflowY:'auto' }}>
                        {item.content}
                      </div>

                      {/* Closing */}
                      {item.closing && (
                        <div style={{ background:'rgba(34,197,94,0.07)', border:'1px solid rgba(34,197,94,0.2)', borderRadius:8, padding:'8px 12px', marginBottom:10 }}>
                          <span style={{ fontSize:9, fontWeight:800, color:'#22c55e' }}>💬 Closing: </span>
                          <span style={{ fontSize:12, color:'var(--text-secondary)' }}>{item.closing}</span>
                        </div>
                      )}

                      {/* Copy button */}
                      <button onClick={() => copy([item.hook, item.content, item.closing].filter(Boolean).join('\n\n'), item.id)}
                        style={{ marginBottom:12, padding:'7px 14px', borderRadius:8, border:'1px solid var(--border)', background:'transparent', color:'var(--text-muted)', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>
                        {copied === item.id ? '✅ คัดลอกแล้ว' : '📋 คัดลอกเนื้อหา'}
                      </button>

                      {/* Angles */}
                      {item.angles?.length > 0 && (
                        <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:12 }}>
                          {item.angles.map((a, i) => (
                            <span key={i} style={{ fontSize:9, padding:'2px 7px', background:'var(--bg-secondary)', borderRadius:10, color:'var(--text-muted)', border:'1px solid var(--border)' }}>📐 {a}</span>
                          ))}
                        </div>
                      )}

                      {/* Reviewer note display */}
                      {item.note && (
                        <div style={{ background:'rgba(251,191,36,0.07)', padding:10, borderRadius:8, marginBottom:12, border:'1px solid rgba(251,191,36,0.2)' }}>
                          <div style={{ fontSize:10, fontWeight:700, color:'#fbbf24', marginBottom:4 }}>💬 หมายเหตุผู้ตรวจ: {item.reviewedBy?.name && <span style={{ fontWeight:400 }}>({item.reviewedBy.name})</span>}</div>
                          <div style={{ fontSize:12, color:'var(--text-secondary)' }}>{item.note}</div>
                          {item.reviewedAt && <div style={{ fontSize:9, color:'var(--text-muted)', marginTop:4 }}>ตรวจเมื่อ {fmt(item.reviewedAt)}</div>}
                        </div>
                      )}

                      {/* Note input */}
                      <div style={{ marginBottom:12 }}>
                        <label style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', display:'block', marginBottom:4 }}>✏️ เพิ่ม/แก้ไขหมายเหตุ</label>
                        <textarea className="form-textarea"
                          value={noteText[item.id] !== undefined ? noteText[item.id] : (item.note || '')}
                          onChange={e => setNoteText(p => ({ ...p, [item.id]: e.target.value }))}
                          placeholder="เขียนหมายเหตุ..." style={{ minHeight:48, fontSize:12 }} />
                      </div>

                      {/* Engagement (approved only) */}
                      {item.status === 'approved' && (
                        <div style={{ marginBottom:14, padding:12, background:'rgba(34,197,94,0.05)', borderRadius:8, border:'1px solid rgba(34,197,94,0.15)' }}>
                          <div style={{ fontSize:10, fontWeight:800, color:'#22c55e', marginBottom:8 }}>
                            📊 บันทึก Engagement จริง (หลังโพสต์)
                            {engSaved[item.id] && <span style={{ marginLeft:8, fontWeight:400 }}>✅ บันทึกแล้ว</span>}
                          </div>
                          {item.engagement && (
                            <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:8 }}>
                              ล่าสุด: ❤️ {item.engagement.likes || 0} &nbsp; 🔄 {item.engagement.shares || 0} &nbsp; 💬 {item.engagement.comments || 0}
                              {item.engagement.recordedAt && <span> ({new Date(item.engagement.recordedAt).toLocaleDateString('th-TH')})</span>}
                            </div>
                          )}
                          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:6, alignItems:'end' }}>
                            {['likes','shares','comments'].map((k, i) => (
                              <div key={k}>
                                <label style={{ fontSize:9, color:'var(--text-muted)', display:'block', marginBottom:2 }}>{['❤️ ไลค์','🔄 แชร์','💬 คอมเมนต์'][i]}</label>
                                <input type="number" className="form-input" placeholder="0" min="0"
                                  value={engInput[item.id]?.[k] || ''}
                                  onChange={e => setEngInput(p => ({ ...p, [item.id]: { ...p[item.id], [k]: e.target.value } }))}
                                  style={{ fontSize:12, padding:'6px 8px', textAlign:'center' }} />
                              </div>
                            ))}
                            <button onClick={() => saveEng(item.id)}
                              style={{ padding:'6px 10px', borderRadius:6, border:'none', background:'#22c55e', color:'#fff', fontSize:10, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                              💾 บันทึก
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Action buttons */}
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(80px,1fr))', gap:6 }}>
                        {[
                          { s:'approved', label:'✅ อนุมัติ',  c:'#22c55e', bg:'rgba(34,197,94,0.12)',   bc:'rgba(34,197,94,0.3)' },
                          { s:'revision', label:'🔄 แก้ไข',  c:'#a78bfa', bg:'rgba(167,139,250,0.12)', bc:'rgba(167,139,250,0.3)' },
                          { s:'rejected', label:'❌ ไม่ผ่าน', c:'#ef4444', bg:'rgba(239,68,68,0.12)',   bc:'rgba(239,68,68,0.3)' },
                        ].map(({ s, label, c, bg, bc }) => (
                          <button key={s} onClick={() => updateStatus(item.id, s)} disabled={updating === item.id}
                            style={{ padding:'9px 8px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'inherit', transition:'all .2s', border:`1px solid ${item.status === s ? c : bc}`, background: item.status === s ? c : bg, color: item.status === s ? '#fff' : c }}>
                            {updating === item.id ? '⏳' : label}
                          </button>
                        ))}
                        <button onClick={() => del(item.id)}
                          style={{ padding:'9px 8px', border:'1px solid var(--border)', borderRadius:8, background:'transparent', color:'var(--text-muted)', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                          🗑️ ลบ
                        </button>
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
