'use client';
import { useState, useEffect } from 'react';

export default function ClipTranscriptPage() {
  const [url, setUrl] = useState('');
  const [tidy, setTidy] = useState(true);
  const [loading, setLoading] = useState(false);
  const [out, setOut] = useState(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState('tidy'); // tidy | raw
  const [cases, setCases] = useState([]);
  const [casesOpen, setCasesOpen] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [copied, setCopied] = useState('');

  const loadCases = async () => {
    try { const r = await fetch('/api/clip-transcript/cases?limit=40', { cache: 'no-store' }); const d = await r.json(); if (d.success) setCases(d.cases || []); } catch {}
  };
  useEffect(() => { loadCases(); }, []);

  const platformIcon = (p) => p === 'youtube' ? '📺' : p === 'tiktok' ? '🎵' : p === 'meta' ? '📘' : '🎬';

  const extract = async () => {
    if (!url.trim()) { setErr('วางลิงก์คลิปก่อน'); return; }
    setLoading(true); setErr(''); setOut(null);
    try {
      const r = await fetch('/api/clip-transcript', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim(), tidy }) });
      const d = await r.json();
      if (!d.success) { setErr(d.error || 'ถอดไม่สำเร็จ'); }
      else { setOut(d.data); setView(d.data.tidyText ? 'tidy' : 'raw'); loadCases(); }
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };

  const copy = (text, key) => { navigator.clipboard?.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 2000); };
  const deleteCase = async (id) => { await fetch('/api/clip-transcript/cases?id=' + id, { method: 'DELETE' }); loadCases(); };

  const shown = out ? (view === 'tidy' && out.tidyText ? out.tidyText : out.rawText) : '';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary, #0d0d1a)', color: 'var(--text-primary, #e8e8f0)', fontFamily: 'inherit' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 20px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>🎙️ ถอดบทสัมภาษณ์จากคลิป</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted, #888)', margin: '6px 0 22px' }}>
          วางลิงก์ TikTok / YouTube / Facebook → ถอดบทพูด-บทสัมภาษณ์เป็นข้อความ → เก็บเข้าคลัง หยิบไปเรียบเรียงเป็นข่าวเอง (แยกจากระบบทำข่าว)
        </p>

        {/* Input */}
        <div className="card" style={{ background: 'var(--bg-card, #1a1a2e)', border: '1px solid var(--border, #2a2a3e)', borderRadius: 14, padding: 18, marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && !loading && extract()}
              placeholder="วางลิงก์คลิป เช่น https://www.tiktok.com/... หรือ https://youtu.be/..."
              style={{ flex: 1, minWidth: 280, padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border, #2a2a3e)', background: 'rgba(0,0,0,0.2)', color: 'inherit', fontSize: 14, fontFamily: 'inherit' }} />
            <button onClick={extract} disabled={loading}
              style={{ padding: '12px 24px', borderRadius: 10, border: 'none', background: loading ? '#4b5563' : 'linear-gradient(135deg,#f91880,#7c3aed)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: loading ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
              {loading ? '⏳ กำลังถอด... (อาจ 1-3 นาที)' : '🎙️ ถอดบทสัมภาษณ์'}
            </button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, color: 'var(--text-muted, #888)', cursor: 'pointer' }}>
            <input type="checkbox" checked={tidy} onChange={e => setTidy(e.target.checked)} />
            ✨ เรียบเรียงให้อ่านลื่น (จัดลำดับ ตัดคำซ้ำ/เสียงเอ้อ — ไม่สรุป ไม่ตัดเนื้อหา) — ปิดถ้าอยากได้บทดิบเป๊ะ
          </label>
          {err && <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontSize: 13 }}>❌ {err}</div>}
        </div>

        {/* Output */}
        {out && (
          <div className="card" style={{ background: 'var(--bg-card, #1a1a2e)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 14, padding: 18, marginBottom: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>{platformIcon(out.platform)} บทถอด {out.caption ? `— ${out.caption.slice(0, 60)}` : ''}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {out.tidyText && <>
                  <button onClick={() => setView('tidy')} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: view === 'tidy' ? 'rgba(124,58,237,0.25)' : 'rgba(255,255,255,0.06)', color: view === 'tidy' ? '#a78bfa' : 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✨ เรียบเรียงแล้ว</button>
                  <button onClick={() => setView('raw')} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: view === 'raw' ? 'rgba(124,58,237,0.25)' : 'rgba(255,255,255,0.06)', color: view === 'raw' ? '#a78bfa' : 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>📄 บทดิบ</button>
                </>}
                <button onClick={() => copy(shown, 'out')} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: copied === 'out' ? 'rgba(34,197,94,0.2)' : 'rgba(59,130,246,0.15)', color: copied === 'out' ? '#22c55e' : '#3b82f6', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>{copied === 'out' ? '✅ คัดลอกแล้ว' : '📋 Copy'}</button>
              </div>
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap', maxHeight: 420, overflowY: 'auto', background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: 14 }}>{shown}</div>
          </div>
        )}

        {/* คลัง */}
        <button onClick={() => setCasesOpen(!casesOpen)} style={{ padding: '10px 18px', borderRadius: 10, border: '1px solid var(--border, #2a2a3e)', background: casesOpen ? 'rgba(99,102,241,0.12)' : 'var(--bg-card, #1a1a2e)', color: casesOpen ? '#818cf8' : 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          📦 คลังบทถอด ({cases.length}) {casesOpen ? '▲' : '▼'}
        </button>
        {casesOpen && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {cases.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted, #888)', fontSize: 13 }}>ยังไม่มีบทถอด — ถอดคลิปสักครั้งแล้วจะเก็บที่นี่อัตโนมัติ</div>}
            {cases.map((c) => (
              <div key={c.id} style={{ border: '1px solid var(--border, #2a2a3e)', borderRadius: 10, overflow: 'hidden' }}>
                <div onClick={() => setExpanded(expanded === c.id ? null : c.id)} style={{ padding: '11px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', background: 'var(--bg-card, #1a1a2e)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{platformIcon(c.platform)} {c.title || c.url}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted, #888)', marginTop: 3 }}>{c.platform} · {c.wordCount} ตัวอักษร · {new Date(c.createdAt).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); deleteCase(c.id); }} style={{ marginLeft: 10, padding: '4px 10px', borderRadius: 6, border: 'none', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>ลบ</button>
                </div>
                {expanded === c.id && (
                  <div style={{ padding: 14, borderTop: '1px solid var(--border, #2a2a3e)' }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#3b82f6' }}>🔗 เปิดคลิป</a>
                      {c.tidyText && <button onClick={() => copy(c.tidyText, 'c-tidy-' + c.id)} style={{ padding: '3px 10px', borderRadius: 6, border: 'none', background: 'rgba(124,58,237,0.15)', color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>{copied === 'c-tidy-' + c.id ? '✅' : '📋 คัดลอกที่เรียบเรียง'}</button>}
                      <button onClick={() => copy(c.rawText, 'c-raw-' + c.id)} style={{ padding: '3px 10px', borderRadius: 6, border: 'none', background: 'rgba(59,130,246,0.15)', color: '#3b82f6', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>{copied === 'c-raw-' + c.id ? '✅' : '📋 คัดลอกบทดิบ'}</button>
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto', background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: 12 }}>{c.tidyText || c.rawText}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
