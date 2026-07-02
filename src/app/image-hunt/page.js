'use client';
/**
 * 🕵️ Image Hunt — สืบหาภาพจากเนื้อหาข่าว (3 ก.ค. 69)
 * วางเนื้อหา → สืบ (วิเคราะห์ตัวละคร/เหตุการณ์ → ล่าภาพทุกแหล่ง → วิชั่นคัดขยะ) → คลังเคสดูย้อนหลัง
 * 🔴 ระบบเดี่ยว — ไม่เกี่ยวระบบทำข่าวอัตโนมัติ/ท่อปก
 */
import { useState, useEffect, useCallback } from 'react';
import Header from '@/components/layout/Header';

const SRC_BADGE = {
  'google-images': { label: '📷 Google', color: '#3b82f6' },
  youtube: { label: '▶️ YouTube', color: '#dc2626' },
  tiktok: { label: '🎵 TikTok', color: '#0f172a' },
  news: { label: '📰 ข่าว', color: '#64748b' },
};
const ROLE_BADGE = {
  hero: { label: '★ HERO', color: '#f59e0b' }, scene: { label: '🎬 ฉาก', color: '#3b82f6' },
  detail: { label: '🔍 หลักฐาน/ของ', color: '#22c55e' }, reaction: { label: '😮 อารมณ์', color: '#a855f7' },
};

export default function ImageHuntPage() {
  const [content, setContent] = useState('');
  const [caseName, setCaseName] = useState('');
  const [hunting, setHunting] = useState(false);
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState(null);     // เคสที่เพิ่งสืบ / เคสที่เปิดดู
  const [cases, setCases] = useState([]);
  const [tab, setTab] = useState('hunt');          // hunt | library
  const [roleFilter, setRoleFilter] = useState('all');

  const loadCases = useCallback(async () => {
    try {
      const d = await (await fetch('/api/image-hunt', { cache: 'no-store' })).json();
      if (d.success) setCases(d.cases || []);
    } catch {}
  }, []);
  useEffect(() => { loadCases(); }, [loadCases]);

  const hunt = async () => {
    if (content.trim().length < 60) { setMsg('❌ วางเนื้อหาข่าวอย่างน้อย 60 ตัวอักษร'); return; }
    setHunting(true); setResult(null);
    setMsg('🕵️ กำลังสืบ... (วิเคราะห์ตัวละคร → ล่าภาพ Google/YouTube/TikTok/ข่าว → วิชั่นคัดขยะ ~1-3 นาที)');
    try {
      const res = await fetch('/api/image-hunt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, caseName }),
      });
      const txt = await res.text();
      let d; try { d = JSON.parse(txt); } catch { d = { success: false, error: 'เซิร์ฟเวอร์ใช้เวลานาน — เคสอาจเสร็จอยู่เบื้องหลัง ลองดูแท็บคลังเคส' }; }
      if (d.success) {
        setResult(d.case); setMsg(`✅ เคส ${d.case.id}: เจอดิบ ${d.case.stats.raw} → ผ่านคัด ${d.case.stats.kept} ภาพ (${d.case.stats.tookSec} วิ)`);
        loadCases();
      } else setMsg('❌ ' + d.error);
    } catch (e) { setMsg('❌ ' + e.message); }
    setHunting(false);
  };

  const openCase = async (id) => {
    setMsg('⏳ เปิดเคส ' + id + '...');
    try {
      const d = await (await fetch(`/api/image-hunt?id=${id}`, { cache: 'no-store' })).json();
      if (d.success) { setResult(d.case); setTab('hunt'); setMsg(''); }
      else setMsg('❌ ' + d.error);
    } catch (e) { setMsg('❌ ' + e.message); }
  };

  const removeCase = async (id) => {
    if (!confirm(`ลบเคส ${id}?`)) return;
    await fetch('/api/image-hunt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) });
    if (result?.id === id) setResult(null);
    loadCases();
  };

  const shownImages = result ? (result.images || []).filter(im => roleFilter === 'all' || im.role === roleFilter) : [];

  const card = { background: 'var(--bg-card, #16161f)', border: '1px solid var(--border, #2a2a35)', borderRadius: 14, padding: 16 };
  const btn = (bg) => ({ padding: '10px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', background: bg, color: '#fff', fontWeight: 700, fontSize: 14 });

  return (
    <>
      <Header title="🕵️ สืบหาภาพข่าว" subtitle="วางเนื้อหาข่าว → AI วิเคราะห์ตัวละคร/เหตุการณ์ → ล่าภาพทุกแหล่ง (เน้นแคปเฟรม) → คัดขยะออก → เก็บคลังเคส" />
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '12px 16px 60px' }}>

        {/* แท็บ */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {[['hunt', '🕵️ สืบหาภาพ'], ['library', `🗄️ คลังเคส (${cases.length})`]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ ...btn(tab === k ? 'linear-gradient(135deg,#8b5cf6,#6d28d9)' : 'var(--bg-card, #16161f)'), color: tab === k ? '#fff' : 'var(--text-secondary, #999)', border: '1px solid var(--border, #2a2a35)' }}>
              {l}</button>
          ))}
        </div>

        {tab === 'hunt' && (
          <>
            <div style={{ ...card, marginBottom: 14 }}>
              <textarea value={content} onChange={e => setContent(e.target.value)} rows={7}
                placeholder={'วางเนื้อหาข่าวเต็มที่นี่ (ยิ่งเต็มยิ่งสืบแม่น — ระบบจะแกะชื่อคน ชื่อเล่น เหตุการณ์ แบรนด์ แล้วไปล่าภาพ)'}
                style={{ width: '100%', background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border, #2a2a35)', borderRadius: 10, color: 'var(--text-primary, #eee)', padding: 12, fontSize: 14, lineHeight: 1.6, resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <input value={caseName} onChange={e => setCaseName(e.target.value)} placeholder="ชื่อเคส (เว้นได้ — AI ตั้งให้)"
                  style={{ flex: 1, minWidth: 220, background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border, #2a2a35)', borderRadius: 10, color: 'var(--text-primary, #eee)', padding: '10px 12px', fontSize: 13 }} />
                <button onClick={hunt} disabled={hunting} style={{ ...btn(hunting ? '#4b5563' : 'linear-gradient(135deg,#8b5cf6,#6d28d9)'), cursor: hunting ? 'wait' : 'pointer' }}>
                  {hunting ? '⏳ กำลังสืบ...' : '🕵️ สืบหาภาพ'}</button>
              </div>
            </div>
            {msg && <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)', color: 'var(--text-secondary, #bbb)', fontSize: 13, marginBottom: 14 }}>{msg}</div>}

            {result && (
              <>
                {/* สรุปการวิเคราะห์ */}
                <div style={{ ...card, marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary, #eee)' }}>📋 {result.id} — {result.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted, #777)' }}>ดิบ {result.stats?.raw} → QC {result.stats?.qced} → เก็บ {result.stats?.kept} · {result.stats?.tookSec} วิ</div>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary, #bbb)', lineHeight: 1.8 }}>
                    <div>👤 <b>ตัวละคร:</b> {(result.analysis?.people || []).map(p => `${p.name}${p.nick ? ` "${p.nick}"` : ''} (${p.who})`).join(' · ') || '-'}</div>
                    <div>🧩 <b>เหตุการณ์/สิ่งเกี่ยวข้อง:</b> {[...(result.analysis?.events || []), ...(result.analysis?.entities || [])].join(' · ') || '-'}</div>
                  </div>
                </div>

                {/* ตัวกรองบทบาท */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                  {[['all', `ทั้งหมด (${result.images?.length || 0})`], ...Object.entries(ROLE_BADGE).map(([k, v]) => [k, `${v.label} (${(result.images || []).filter(i => i.role === k).length})`])].map(([k, l]) => (
                    <button key={k} onClick={() => setRoleFilter(k)}
                      style={{ padding: '5px 12px', borderRadius: 999, border: '1px solid var(--border, #2a2a35)', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: roleFilter === k ? 'rgba(139,92,246,0.25)' : 'transparent', color: roleFilter === k ? '#a78bfa' : 'var(--text-muted, #888)' }}>{l}</button>
                  ))}
                </div>

                {/* กริดภาพ */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                  {shownImages.map(im => (
                    <div key={im.id} style={{ ...card, padding: 0, overflow: 'hidden' }}>
                      <a href={im.url} target="_blank" rel="noreferrer" title="เปิดภาพเต็ม">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={im.url} alt="" loading="lazy"
                          style={{ width: '100%', height: 170, objectFit: 'cover', display: 'block', background: '#0a0a12' }}
                          onError={e => { e.currentTarget.style.opacity = 0.15; e.currentTarget.style.height = '60px'; }} />
                      </a>
                      <div style={{ padding: '8px 10px' }}>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', fontSize: 10.5, fontWeight: 800 }}>
                          <span style={{ color: (ROLE_BADGE[im.role] || {}).color || '#888' }}>{(ROLE_BADGE[im.role] || { label: im.role }).label}</span>
                          <span style={{ color: (SRC_BADGE[im.source] || {}).color || '#888' }}>{(SRC_BADGE[im.source] || { label: im.source }).label}{im.kind === 'frame' ? ' · แคป' : ''}</span>
                          <span style={{ color: im.score >= 7 ? '#22c55e' : '#f59e0b' }}>คะแนน {im.score}</span>
                          {im.person === 'match' && <span style={{ color: '#22c55e' }}>✓ คนตรง</span>}
                          {im.person === 'maybe' && <span style={{ color: '#f59e0b' }}>? ไม่ชัวร์</span>}
                          {im.borderline && <span style={{ color: '#f97316' }}>⚠ เกณฑ์ผ่อน</span>}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted, #777)', marginTop: 4, lineHeight: 1.5, minHeight: 30 }}>{im.why}{im.dirt ? ` · ${im.dirt}` : ''}</div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                          {im.origin && <a href={im.origin} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#60a5fa', textDecoration: 'none' }}>🔗 ต้นทาง</a>}
                          <button onClick={() => navigator.clipboard?.writeText(im.url)} style={{ fontSize: 11, color: '#a78bfa', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>📋 คัดลอก URL</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {shownImages.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-muted, #777)', padding: 30 }}>ไม่มีภาพในหมวดนี้</div>}
              </>
            )}
          </>
        )}

        {tab === 'library' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {cases.length === 0 && <div style={{ ...card, textAlign: 'center', color: 'var(--text-muted, #777)' }}>ยังไม่มีเคส — สืบเคสแรกที่แท็บ 🕵️</div>}
            {cases.map(c => (
              <div key={c.id} style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, color: 'var(--text-primary, #eee)' }}>📋 {c.id} — {c.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginTop: 3 }}>
                    👤 {(c.people || []).join(', ') || '-'} · 🖼 {c.kept} ภาพ · {c.createdAt ? new Date(c.createdAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => openCase(c.id)} style={{ ...btn('rgba(139,92,246,0.2)'), color: '#a78bfa', border: '1px solid rgba(139,92,246,0.4)', padding: '7px 14px', fontSize: 13 }}>เปิดดู</button>
                  <button onClick={() => removeCase(c.id)} style={{ ...btn('rgba(239,68,68,0.12)'), color: '#f87171', border: '1px solid rgba(239,68,68,0.35)', padding: '7px 14px', fontSize: 13 }}>ลบ</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
