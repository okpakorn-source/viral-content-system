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

// ★ 3 ก.ย. 69 (F14 แบบ FINAL card-library): สถานะการ์ด — ใบที่ไม่มี field status = ใช้งาน (ทั้งคลังเดิม)
//   สวิตช์ฝั่ง client: NEXT_PUBLIC_CARD_LIBRARY_V2 default เปิด ('0' = หน้าเดิมทุกจุด — ปุ่มลบเดิม ไม่มีป้าย/ตัวกรอง)
const CARD_LIB_V2_UI = process.env.NEXT_PUBLIC_CARD_LIBRARY_V2 !== '0';
const STATUS_META = {
  active: { label: 'ใช้งาน', icon: '✅', color: '#22c55e' },
  archived: { label: 'พัก', icon: '⏸️', color: '#f59e0b' },
  proposed: { label: 'เสนอ', icon: '🧪', color: '#06b6d4' },
};
const statusOf = (p) => (p?.status === 'archived' || p?.status === 'proposed') ? p.status : 'active';

export default function PromptLibraryPage() {
  const [prompts, setPrompts] = useState([]);
  const [stats, setStats] = useState({ total: 0, categories: {} });
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all'); // ★ 3 ก.ย. 69 (F14): ทั้งหมด/ใช้งาน/พัก/เสนอ

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

  // เส้นทางเดิม — ใช้เฉพาะตอนปิดสวิตช์ NEXT_PUBLIC_CARD_LIBRARY_V2 ('0') เท่านั้น
  const handleDelete = async (id) => {
    if (!confirm('ลบ Prompt นี้?')) return;
    await fetch(`/api/prompt-library?id=${id}`, { method: 'DELETE' });
    loadPrompts();
  };

  // ★ 3 ก.ย. 69 (F14): พัก/กู้คืนรายใบ — ไม่ลบออกจากคลัง เคสเก่ายังอ้าง promptId ได้เสมอ
  const handleStatusAction = async (id, action) => {
    try {
      const res = await fetch('/api/prompt-library', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) alert(data.error || (action === 'archive' ? 'พักการ์ดไม่สำเร็จ' : 'กู้คืนไม่สำเร็จ'));
    } catch (err) {
      alert(err.message || 'ทำรายการไม่สำเร็จ');
    }
    loadPrompts();
  };

  // ★ 3 ก.ย. 69 (F14): ลบถาวรต้องยืนยัน 2 ชั้น (กดยืนยัน + พิมพ์ id) — API กันซ้ำอีกชั้น (confirm + ห้ามลบใบที่เคยใช้)
  const handleHardDelete = async (p) => {
    if (!confirm(`⚠️ ลบถาวร "${p.promptName || p.id}"?\n\nการ์ดจะหายจากคลังจริง ย้อนกลับไม่ได้ — ถ้าแค่เลิกใช้ ให้กด "พัก" แทน`)) return;
    const typed = window.prompt(`ชั้นยืนยันสุดท้าย: พิมพ์ id ให้ตรงเป๊ะเพื่อลบถาวร\n\n${p.id}`);
    if (typed === null) return;
    if (typed.trim() !== p.id) { alert('id ไม่ตรง — ยกเลิกการลบ'); return; }
    try {
      const res = await fetch(`/api/prompt-library?id=${encodeURIComponent(p.id)}&confirm=${encodeURIComponent(p.id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!data.success) alert(data.error || 'ลบไม่สำเร็จ');
    } catch (err) {
      alert(err.message || 'ลบไม่สำเร็จ');
    }
    loadPrompts();
  };

  const handleDeleteAll = async () => {
    if (!confirm('⚠️ ยืนยันลบ Prompt ทั้งหมดใช่ไหม? (การกระทำนี้ย้อนกลับไม่ได้)')) return;
    // ★ 1 ส.ค. 69 (ออดิต): ล้างคลังทั้งหมดต้องมีรหัสยืนยัน (ADMIN_API_KEY) — ยกเลิก/ว่าง = ไม่ยิง API
    const adminKey = window.prompt('ใส่รหัสยืนยัน (ADMIN_API_KEY) เพื่อล้างคลังทั้งหมด');
    if (!adminKey) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/prompt-library?id=all`, {
        method: 'DELETE',
        headers: { 'x-admin-key': adminKey },
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) alert(data.error || 'ล้างคลังไม่สำเร็จ');
    } catch (err) {
      alert(err.message || 'ล้างคลังไม่สำเร็จ');
    }
    loadPrompts();
  };

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const categoryEntries = Object.entries(stats.categories || {}).sort((a, b) => b[1] - a[1]);

  // ★ 3 ก.ย. 69 (F14): นับ+กรองสถานะฝั่ง client (GET ไม่กรอง — เห็นใบพักได้เสมอ) · สวิตช์ปิด = ใช้ลิสต์เดิมตรงๆ
  const statusCounts = { active: 0, archived: 0, proposed: 0 };
  if (CARD_LIB_V2_UI) prompts.forEach(p => { statusCounts[statusOf(p)] += 1; });
  const visiblePrompts = (CARD_LIB_V2_UI && statusFilter !== 'all')
    ? prompts.filter(p => statusOf(p) === statusFilter)
    : prompts;

  return (
    <>
      <Header title="🏛️ หอสมุด Prompt" subtitle={`DNA v3 — ${stats.total || 0} รายการ ทุกตัวผ่านด่านคัด 6 เกณฑ์ก่อนเข้าคลัง`} />
      <div className="page-content">

        {/* DNA v3 Upgrade Banner (12 มิ.ย. 69) */}
        <div className="card" style={{ marginBottom: 16, border: '1px solid rgba(34,197,94,0.3)', background: 'linear-gradient(135deg, rgba(34,197,94,0.06), rgba(6,182,212,0.06))' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#22c55e', marginBottom: 8 }}>
            🧬 อัพเกรด DNA v3 — มาตรฐานพร้อมท์ใหม่ (12 มิ.ย.)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
            <div>📐 <b style={{ color: 'var(--text-primary)' }}>โครงตายตัว</b> — แอดมินเพจเล่าให้แฟนเพจฟัง / 3 ย่อหน้า / เข้าเรื่องตั้งแต่ประโยคแรก / จบที่ใจความไม่อวยยืด</div>
            <div>🚫 <b style={{ color: 'var(--text-primary)' }}>ข้อห้ามบังคับทุกตัว</b> — ห้ามชี้นำคนอ่าน ห้ามเหน็บสถานะ ห้ามกระชากอารมณ์ ห้ามเกริ่นยาว ห้ามบังคับเศร้า/ลุ้นเกิน</div>
            <div>🛡️ <b style={{ color: 'var(--text-primary)' }}>คัดอัตโนมัติก่อนบันทึก</b> — พร้อมท์ที่ AI สร้างต้องผ่านเกณฑ์ 6 ข้อเดียวกับหอสมุดไวรัล ของเก่ายุคปั่นเอนเกจถูกล้างหมดแล้ว</div>
          </div>
        </div>

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

          {/* ★ 3 ก.ย. 69 (F14): แถวตัวกรองสถานะ — ทั้งหมด/ใช้งาน/พัก/เสนอ */}
          {CARD_LIB_V2_UI && (
            <div style={{
              width: '100%', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
              marginTop: 6, paddingTop: 10, borderTop: '1px dashed var(--border)',
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', marginRight: 2 }}>สถานะ:</span>
              <button onClick={() => setStatusFilter('all')}
                style={{
                  padding: '4px 12px', borderRadius: 20, border: 'none',
                  background: statusFilter === 'all' ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                  color: statusFilter === 'all' ? '#fff' : 'var(--text-muted)',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s',
                }}>ทั้งหมด ({prompts.length})</button>
              {['active', 'archived', 'proposed'].map(st => (
                <button key={st} onClick={() => setStatusFilter(st)}
                  style={{
                    padding: '4px 12px', borderRadius: 20, border: 'none',
                    background: statusFilter === st ? STATUS_META[st].color : 'rgba(255,255,255,0.06)',
                    color: statusFilter === st ? '#fff' : STATUS_META[st].color,
                    fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s',
                  }}>{STATUS_META[st].icon} {STATUS_META[st].label} ({statusCounts[st]})</button>
              ))}
            </div>
          )}
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
        ) : visiblePrompts.length === 0 ? (
          // ★ 3 ก.ย. 69 (F14): กรองสถานะแล้วว่าง (ถึงจุดนี้ได้เฉพาะตอนสวิตช์เปิด — prompts มีของแต่สถานะนี้ไม่มี)
          <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 12 }}>
            ไม่มีการ์ดสถานะ “{statusFilter === 'all' ? 'ทั้งหมด' : STATUS_META[statusFilter]?.label}” — เปลี่ยนตัวกรองด้านบน
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {visiblePrompts.map(p => {
              const isExpanded = expandedId === p.id;
              const color = CATEGORY_COLORS[p.category] || '#888';
              const st = CARD_LIB_V2_UI ? statusOf(p) : 'active'; // ★ F14: สวิตช์ปิด = ทุกใบถือเป็นใช้งาน (หน้าเดิม)

              return (
                <div key={p.id} className="card" style={{ padding: 0, overflow: 'hidden', ...(st === 'archived' ? { opacity: 0.62 } : {}) }}>
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

                    {/* ★ 3 ก.ย. 69 (F14): ป้ายสถานะ — โชว์เฉพาะใบที่ไม่ใช่ "ใช้งาน" ให้คลังหลักสะอาดเหมือนเดิม */}
                    {st !== 'active' && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                        color: STATUS_META[st].color, background: `${STATUS_META[st].color}15`,
                        border: `1px solid ${STATUS_META[st].color}30`, whiteSpace: 'nowrap',
                      }}>{STATUS_META[st].icon} {STATUS_META[st].label}</span>
                    )}

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
                        {CARD_LIB_V2_UI ? (
                          // ★ 3 ก.ย. 69 (F14): ปุ่มลบตรง (ไม่มีด่าน) → พัก/กู้คืน · ลบถาวรเหลือเฉพาะใบที่พัก/เสนอ + ยืนยัน 2 ชั้น
                          <>
                            {st === 'archived' ? (
                              <button onClick={() => handleStatusAction(p.id, 'restore')}
                                style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.08)', color: '#22c55e', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                                ♻️ กู้คืน
                              </button>
                            ) : (
                              <button onClick={() => handleStatusAction(p.id, 'archive')}
                                title="เอาออกจากการหมุนเวียน — ข้อมูลยังอยู่ กู้คืนได้ทุกเมื่อ"
                                style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                                ⏸️ พัก
                              </button>
                            )}
                            {st !== 'active' && (
                              (p.usageCount || 0) > 0 ? (
                                <button disabled title={`เคยถูกใช้ ${p.usageCount} ครั้ง — ลบถาวรไม่ได้ (เคสเก่าอ้างถึง promptId)`}
                                  style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, fontFamily: 'inherit', opacity: 0.5, cursor: 'not-allowed' }}>
                                  🗑️ ลบถาวร
                                </button>
                              ) : (
                                <button onClick={() => handleHardDelete(p)}
                                  title="ลบออกจากคลังจริง — ต้องพิมพ์ id ยืนยัน"
                                  style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.35)', background: 'transparent', color: '#ef4444', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                                  🗑️ ลบถาวร
                                </button>
                              )
                            )}
                          </>
                        ) : (
                          <button onClick={() => handleDelete(p.id)}
                            style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                            🗑️ ลบ
                          </button>
                        )}

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
