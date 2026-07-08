'use client';

// ============================================================
// 🗂️ /mega-covers — คลังงานปก MEGA (ปกที่ทำเสร็จเด้งเข้าเอง)
// ดึงจาก /api/mega-covers · แสดง grid + meta + เทียบ ref ได้
// ============================================================

import { useState, useEffect } from 'react';

export default function MegaCoversPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [zoom, setZoom] = useState(null); // coverPath ที่กำลังเทียบ ref

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const r = await fetch('/api/mega-covers', { cache: 'no-store' });
      const j = await r.json();
      if (j.success) setItems(j.items || []);
      else setErr(j.error || 'โหลดคลังไม่สำเร็จ');
    } catch (e) { setErr('เรียก API ล้ม: ' + (e?.message || e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const scoreColor = (s) => s >= 9 ? '#16a34a' : s >= 7 ? '#ca8a04' : '#dc2626';
  const fmt = (iso) => { try { return new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }); } catch { return iso; } };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif', color: '#0f172a' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>🗂️ คลังงานปก MEGA</h1>
        <button onClick={load} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontSize: 13 }}>↻ รีเฟรช</button>
        <span style={{ color: '#64748b', fontSize: 13 }}>{items.length} ใบ</span>
      </div>
      <p style={{ color: '#64748b', fontSize: 13, marginTop: 0 }}>ทุกจุดกดสร้างปก (MEGA s7 · ทางลัดเทส · cover-ref-test) เด้งเข้าคลังนี้อัตโนมัติ — เก็บบนคลาวด์ เห็นเหมือนกันทั้งเครื่องทีมและ Vercel · คลิกปกเพื่อดูใหญ่ · ⬇️ โหลดภาพได้ทุกใบ</p>

      {loading && <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>⏳ กำลังโหลด…</div>}
      {err && <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c', fontSize: 13 }}>{err}</div>}
      {!loading && !err && items.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>ยังไม่มีปกในคลัง — ทำปกที่ <a href="/cover-ref-test" style={{ color: '#2563eb' }}>/cover-ref-test</a> แล้วจะเด้งเข้าที่นี่เอง</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginTop: 12 }}>
        {items.map((it) => (
          <div key={it.id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
            {/* ★ 9 ก.ค.: ภาพผ่าน /api/mega-covers/img (ไฟล์เครื่อง→คลาวด์) — Vercel เห็นคลังเดียวกับเครื่องทีม
                · onError ถอยไป coverPath (record เก่าก่อนคลาวด์) ก่อนโชว์ "ไม่มีภาพ" */}
            <img
              src={`/api/mega-covers/img?id=${encodeURIComponent(it.id)}`}
              alt={it.title}
              onClick={() => setZoom(`/api/mega-covers/img?id=${encodeURIComponent(it.id)}`)}
              onError={(e) => {
                if (it.coverPath && e.currentTarget.dataset.fb !== '1') { e.currentTarget.dataset.fb = '1'; e.currentTarget.src = it.coverPath; }
                else e.currentTarget.style.display = 'none';
              }}
              style={{ width: '100%', display: 'block', cursor: 'zoom-in', aspectRatio: '4/5', objectFit: 'cover', background: '#f1f5f9' }}
            />
            <div style={{ padding: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3, marginBottom: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{it.title || '(ไม่มีหัวข้อ)'}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: '#475569' }}>
                {it.score != null && <span style={{ fontWeight: 800, color: scoreColor(it.score) }}>{typeof it.score === 'number' ? `QC ${it.score}/10` : it.score}</span>}
                <span>{it.template || '-'}</span>
                <span style={{ padding: '0 6px', borderRadius: 4, background: it.source === 'mega' ? '#ecfccb' : '#eff6ff' }}>{it.source}</span>
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                {it.imageCaseId && <span>{it.imageCaseId} · </span>}{fmt(it.at)}
              </div>
              {/* ⬇️ ปุ่มโหลดภาพ (ผู้ใช้สั่ง 9 ก.ค.) — &dl=1 บังคับดาวน์โหลดเป็นไฟล์ */}
              <a
                href={`/api/mega-covers/img?id=${encodeURIComponent(it.id)}&dl=1`}
                style={{ display: 'inline-block', marginTop: 8, padding: '5px 12px', borderRadius: 8, background: '#4f46e5', color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}
              >⬇️ โหลดภาพ</a>
            </div>
          </div>
        ))}
      </div>

      {zoom && (
        <div onClick={() => setZoom(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 20, zIndex: 50, cursor: 'zoom-out' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#fff', fontSize: 13, marginBottom: 6 }}>ปกที่ระบบสร้าง</div>
            <img src={zoom} alt="cover" style={{ maxHeight: '82vh', borderRadius: 10, border: '2px solid #2563eb' }} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#fff', fontSize: 13, marginBottom: 6 }}>reference (เป้า)</div>
            <img src="/_ref/reference_5x4.jpg" alt="ref" style={{ maxHeight: '82vh', borderRadius: 10, border: '2px solid #e2e8f0' }} />
          </div>
        </div>
      )}
    </div>
  );
}
