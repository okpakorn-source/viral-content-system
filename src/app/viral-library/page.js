'use client';

import { useState, useEffect, useCallback } from 'react';
import Header from '@/components/layout/Header';

const CATEGORIES = [
  'ข่าวอาลัย', 'ข่าวสูญเสีย', 'ข่าวดราม่า', 'ข่าวแฉ', 'ข่าวแซะ',
  'ข่าวบริจาค', 'ข่าวการเมือง', 'ข่าวคนจนสู้ชีวิต', 'ข่าวหักมุม',
  'ข่าวเศรษฐี', 'ข่าวอบอุ่น', 'ข่าวช็อก', 'ข่าวคอมเมนต์เดือด',
];

const STATUS_LABELS = {
  raw: { label: '📥 รอวิเคราะห์', color: '#fbbf24' },
  analyzed: { label: '🔬 วิเคราะห์แล้ว', color: '#3b82f6' },
  prompted: { label: '⚡ สร้าง Prompt แล้ว', color: '#22c55e' },
};

export default function ViralLibraryPage() {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [showInput, setShowInput] = useState(false);
  const [inputText, setInputText] = useState('');
  const [inputTitle, setInputTitle] = useState('');
  const [inputPlatform, setInputPlatform] = useState('facebook');
  const [filter, setFilter] = useState('all');
  const [processing, setProcessing] = useState(null); // id ที่กำลัง process
  const [expandedId, setExpandedId] = useState(null);
  const [msg, setMsg] = useState('');

  const loadItems = useCallback(async () => {
    try {
      const params = filter !== 'all' ? `?status=${filter}` : '';
      const res = await fetch(`/api/viral-library${params}`);
      const data = await res.json();
      if (data.success) {
        setItems(data.items || []);
        setStats(data.stats || {});
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { loadItems(); }, [loadItems]);

  // === ป้อนเนื้อหาไวรัล ===
  const handleAdd = async () => {
    if (!inputText || inputText.length < 20) {
      setMsg('❌ เนื้อหาสั้นเกินไป (ขั้นต่ำ 20 ตัวอักษร)');
      setTimeout(() => setMsg(''), 3000);
      return;
    }

    try {
      const res = await fetch('/api/viral-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: inputTitle || inputText.slice(0, 50),
          content: inputText,
          platform: inputPlatform,
          source: 'manual',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg(`✅ เพิ่มเนื้อหาแล้ว`);
        setInputText('');
        setInputTitle('');
        setShowInput(false);
        loadItems();
      }
    } catch (err) {
      setMsg('❌ ' + err.message);
    }
    setTimeout(() => setMsg(''), 3000);
  };

  // === AI วิเคราะห์ DNA ===
  const handleAnalyze = async (item) => {
    setProcessing(item.id);
    setMsg('🔬 AI กำลังวิเคราะห์ DNA ของคอนเทนต์...');
    try {
      const res = await fetch('/api/viral-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: item.content, mode: 'viral-analyze' }),
      });
      const data = await res.json();
      if (data.success && data.analysis) {
        // บันทึกผลวิเคราะห์เข้า library
        await fetch('/api/viral-library', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id, analysis: data.analysis }),
        });
        setMsg(`✅ วิเคราะห์เสร็จ: ${data.analysis.category || 'สำเร็จ'}`);
        loadItems();
      } else {
        setMsg('❌ วิเคราะห์ไม่สำเร็จ');
      }
    } catch (err) {
      setMsg('❌ ' + err.message);
    }
    setProcessing(null);
    setTimeout(() => setMsg(''), 5000);
  };

  // === AI สร้าง Prompt ===
  const handleGeneratePrompt = async (item) => {
    if (!item.analysis) {
      setMsg('❌ ต้องวิเคราะห์ DNA ก่อน');
      setTimeout(() => setMsg(''), 3000);
      return;
    }
    setProcessing(item.id);
    setMsg('⚡ AI กำลังสร้าง Prompt เฉพาะทาง...');
    try {
      const res = await fetch('/api/viral-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: item.content,
          mode: 'generate-prompt',
          analysis_input: item.analysis,
        }),
      });
      const data = await res.json();
      if (data.success && data.promptData) {
        // บันทึก prompt เข้า viral library item
        await fetch('/api/viral-library', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id, generatedPrompt: data.promptData }),
        });
        // บันทึก prompt เข้า Prompt Library ด้วย
        await fetch('/api/prompt-library', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...data.promptData,
            sourceContentId: item.id,
            exampleContent: item.content.slice(0, 500),
          }),
        });
        setMsg(`✅ สร้าง Prompt สำเร็จ: ${data.promptData.prompt_name || 'สำเร็จ'}`);
        loadItems();
      } else {
        setMsg('❌ สร้าง Prompt ไม่สำเร็จ');
      }
    } catch (err) {
      setMsg('❌ ' + err.message);
    }
    setProcessing(null);
    setTimeout(() => setMsg(''), 5000);
  };

  // === Auto Process: วิเคราะห์ + สร้าง Prompt ทีเดียว ===
  const handleAutoProcess = async (item) => {
    setProcessing(item.id);
    // Step 1: Analyze
    setMsg('🔬 Step 1/2: AI กำลังวิเคราะห์ DNA...');
    try {
      const res1 = await fetch('/api/viral-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: item.content, mode: 'viral-analyze' }),
      });
      const data1 = await res1.json();
      if (!data1.success) { setMsg('❌ วิเคราะห์ล้มเหลว'); setProcessing(null); return; }

      // Save analysis
      await fetch('/api/viral-library', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, analysis: data1.analysis }),
      });

      // Step 2: Generate prompt
      setMsg(`🔬 Step 2/2: สร้าง Prompt จาก "${data1.analysis.category}"...`);
      const res2 = await fetch('/api/viral-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: item.content,
          mode: 'generate-prompt',
          analysis_input: data1.analysis,
        }),
      });
      const data2 = await res2.json();
      if (!data2.success) { setMsg('❌ สร้าง Prompt ล้มเหลว'); setProcessing(null); return; }

      // Save prompt to library item
      await fetch('/api/viral-library', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, generatedPrompt: data2.promptData }),
      });
      // Save to Prompt Library
      await fetch('/api/prompt-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data2.promptData,
          sourceContentId: item.id,
          exampleContent: item.content.slice(0, 500),
        }),
      });

      setMsg(`✅ เสร็จ! "${data2.promptData.prompt_name}" → เก็บเข้าหอสมุด Prompt แล้ว`);
      loadItems();
    } catch (err) {
      setMsg('❌ ' + err.message);
    }
    setProcessing(null);
    setTimeout(() => setMsg(''), 6000);
  };

  const handleDelete = async (id) => {
    if (!confirm('ลบเนื้อหานี้?')) return;
    await fetch(`/api/viral-library?id=${id}`, { method: 'DELETE' });
    loadItems();
  };

  return (
    <>
      <Header title="📚 หอสมุดไวรัล" subtitle="ป้อนเนื้อหาไวรัล → AI วิเคราะห์ DNA → สร้าง Prompt อัตโนมัติ" />
      <div className="page-content">

        {/* Toast */}
        {msg && (
          <div style={{
            position: 'fixed', top: 20, right: 20, zIndex: 9999,
            padding: '12px 20px', borderRadius: 12, fontSize: 13, fontWeight: 700,
            background: msg.includes('✅') ? 'rgba(34,197,94,0.95)' : msg.includes('🔬') || msg.includes('⚡') ? 'rgba(59,130,246,0.95)' : 'rgba(239,68,68,0.95)',
            color: '#fff', boxShadow: '0 8px 25px rgba(0,0,0,0.3)',
            animation: 'fadeIn 0.3s ease',
          }}>{msg}</div>
        )}

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 16 }}>
          {[
            { key: 'all', label: '📋 ทั้งหมด', count: stats.total || 0, color: 'var(--text-secondary)' },
            { key: 'raw', label: '📥 รอวิเคราะห์', count: stats.raw || 0, color: '#fbbf24' },
            { key: 'analyzed', label: '🔬 วิเคราะห์แล้ว', count: stats.analyzed || 0, color: '#3b82f6' },
            { key: 'prompted', label: '⚡ มี Prompt แล้ว', count: stats.prompted || 0, color: '#22c55e' },
          ].map(s => (
            <button key={s.key} onClick={() => setFilter(s.key)}
              style={{
                padding: '12px 8px', textAlign: 'center', fontFamily: 'inherit',
                background: filter === s.key ? `${s.color}18` : 'var(--bg-card)',
                border: `1px solid ${filter === s.key ? s.color : 'var(--border)'}`,
                borderRadius: 'var(--radius-md)', cursor: 'pointer', color: 'inherit',
              }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.count}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{s.label}</div>
            </button>
          ))}
        </div>

        {/* Action Bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <button onClick={() => setShowInput(!showInput)} style={{
            padding: '10px 20px', borderRadius: 10, border: 'none',
            background: 'linear-gradient(135deg, #f91880, #7c3aed)', color: '#fff',
            fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            ➕ ป้อนเนื้อหาไวรัล
          </button>
        </div>

        {/* Input Form */}
        {showInput && (
          <div className="card" style={{ marginBottom: 16 }}>
            <h4 style={{ fontSize: 14, fontWeight: 800, margin: '0 0 12px', color: 'var(--text-primary)' }}>
              📥 ป้อนเนื้อหาไวรัลเข้าหอสมุด
            </h4>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 12px' }}>
              วางเนื้อหาที่ได้แสนไลค์ AI จะวิเคราะห์ว่าทำไมมันไวรัล แล้วสร้าง Prompt เฉพาะทางให้
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 10 }}>
              <input className="form-input" placeholder="หัวข้อ / ชื่อโพสต์ (ไม่จำเป็น)" value={inputTitle}
                onChange={e => setInputTitle(e.target.value)} />
              <select className="form-input" value={inputPlatform} onChange={e => setInputPlatform(e.target.value)}>
                <option value="facebook">📘 Facebook</option>
                <option value="tiktok">🎵 TikTok</option>
                <option value="youtube">📺 YouTube</option>
                <option value="x">𝕏 X/Twitter</option>
                <option value="other">📄 อื่นๆ</option>
              </select>
            </div>

            <textarea className="form-textarea" value={inputText} onChange={e => setInputText(e.target.value)}
              placeholder="วางเนื้อหาไวรัลที่นี่... (แคปชั่น, สคริปต์, เนื้อหาข่าว, คอมเมนต์)"
              style={{ minHeight: 150, fontSize: 13, lineHeight: 1.7 }} />

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={handleAdd} style={{
                padding: '8px 20px', borderRadius: 8, border: 'none',
                background: 'var(--accent)', color: '#fff', fontWeight: 700,
                fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
              }}>📥 บันทึกเข้าคลัง</button>
              <button onClick={() => setShowInput(false)} style={{
                padding: '8px 20px', borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--bg-secondary)', color: 'var(--text-muted)',
                fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
              }}>ยกเลิก</button>
            </div>
          </div>
        )}

        {/* Items List */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>⏳ กำลังโหลด...</div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📚</div>
            <div className="empty-state-title">ยังไม่มีเนื้อหาในหอสมุด</div>
            <div className="empty-state-text">เริ่มป้อนเนื้อหาไวรัลเพื่อให้ AI เรียนรู้และสร้าง Prompt</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map(item => {
              const isExpanded = expandedId === item.id;
              const statusCfg = STATUS_LABELS[item.status] || STATUS_LABELS.raw;
              const isProcessing = processing === item.id;

              return (
                <div key={item.id} className="card" style={{ padding: 0, overflow: 'hidden', opacity: isProcessing ? 0.7 : 1, transition: 'opacity 0.3s' }}>
                  {/* Header */}
                  <div onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    style={{
                      padding: '12px 14px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                      borderBottom: isExpanded ? '1px solid var(--border)' : 'none',
                    }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                      color: statusCfg.color, background: `${statusCfg.color}15`,
                      border: `1px solid ${statusCfg.color}30`, whiteSpace: 'nowrap',
                    }}>{statusCfg.label}</span>

                    <div style={{ flex: 1, minWidth: 120 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                        {item.title || item.content?.slice(0, 60) || 'ไม่มีหัวข้อ'}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 3, alignItems: 'center', flexWrap: 'wrap' }}>
                        {item.analysis?.category && (
                          <span style={{
                            fontSize: 9, padding: '2px 8px', borderRadius: 10,
                            background: 'linear-gradient(135deg, rgba(249,24,128,0.15), rgba(124,58,237,0.15))',
                            color: '#e879a8', fontWeight: 700,
                          }}>🏷️ {item.analysis.category}</span>
                        )}
                        {item.analysis?.viral_score && (
                          <span style={{
                            fontSize: 9, padding: '2px 8px', borderRadius: 10,
                            background: 'rgba(34,197,94,0.12)', color: '#22c55e', fontWeight: 700,
                          }}>🔥 Viral {item.analysis.viral_score}/100</span>
                        )}
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{item.content?.length || 0} ตัวอักษร</span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>•</span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{new Date(item.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</span>
                      </div>
                    </div>

                    {/* Action Buttons (compact) */}
                    <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                      {item.status === 'raw' && (
                        <button onClick={() => handleAutoProcess(item)} disabled={isProcessing}
                          style={{
                            padding: '5px 10px', borderRadius: 8, border: 'none', fontSize: 10, fontWeight: 700,
                            background: 'linear-gradient(135deg, #f91880, #7c3aed)', color: '#fff',
                            cursor: isProcessing ? 'wait' : 'pointer', fontFamily: 'inherit',
                          }}>
                          {isProcessing ? '⏳ กำลังประมวลผล...' : '🚀 Auto Process'}
                        </button>
                      )}
                      {item.status === 'analyzed' && !item.generatedPrompt && (
                        <button onClick={() => handleGeneratePrompt(item)} disabled={isProcessing}
                          style={{
                            padding: '5px 10px', borderRadius: 8, border: 'none', fontSize: 10, fontWeight: 700,
                            background: 'rgba(34,197,94,0.15)', color: '#22c55e',
                            cursor: isProcessing ? 'wait' : 'pointer', fontFamily: 'inherit',
                          }}>
                          ⚡ สร้าง Prompt
                        </button>
                      )}
                      {item.status === 'prompted' && (
                        <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 700 }}>✅ เสร็จสมบูรณ์</span>
                      )}
                    </div>

                    <span style={{ fontSize: 12, color: 'var(--text-muted)', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : '' }}>▼</span>
                  </div>

                  {/* Expanded Detail */}
                  {isExpanded && (
                    <div style={{ padding: 14 }}>
                      {/* Content Preview */}
                      <div style={{
                        background: 'var(--bg-primary)', padding: 12, borderRadius: 8,
                        border: '1px solid var(--border)', marginBottom: 12,
                        fontSize: 12, lineHeight: 1.8, color: 'var(--text-secondary)',
                        whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto',
                      }}>
                        {item.content}
                      </div>

                      {/* Analysis Result */}
                      {item.analysis && (
                        <div style={{
                          background: 'rgba(59,130,246,0.06)', padding: 12, borderRadius: 8,
                          border: '1px solid rgba(59,130,246,0.15)', marginBottom: 12,
                        }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: '#3b82f6', marginBottom: 8 }}>🔬 ผลวิเคราะห์ DNA</div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
                            <div><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>ประเภท:</span> <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{item.analysis.category}</span></div>
                            <div><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>อารมณ์:</span> <span style={{ fontSize: 12, fontWeight: 700, color: '#f91880' }}>{item.analysis.primary_emotion}</span></div>
                            <div><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Hook:</span> <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{item.analysis.hook_analysis?.hook_technique}</span></div>
                            <div><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>โครงสร้าง:</span> <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{item.analysis.structure?.flow}</span></div>
                          </div>
                          {item.analysis.why_viral && (
                            <div style={{ marginTop: 8, padding: 8, background: 'rgba(249,24,128,0.06)', borderRadius: 6, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                              💡 {item.analysis.why_viral}
                            </div>
                          )}
                          {item.analysis.emotional_patterns?.length > 0 && (
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
                              {item.analysis.emotional_patterns.map((e, i) => (
                                <span key={i} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 10, background: 'rgba(249,24,128,0.1)', color: '#f91880' }}>❤️ {e}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Generated Prompt */}
                      {item.generatedPrompt && (
                        <div style={{
                          background: 'rgba(34,197,94,0.06)', padding: 12, borderRadius: 8,
                          border: '1px solid rgba(34,197,94,0.15)', marginBottom: 12,
                        }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: '#22c55e', marginBottom: 8 }}>⚡ Prompt ที่สร้างจาก DNA</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                            {item.generatedPrompt.prompt_name}
                          </div>
                          <div style={{
                            background: 'var(--bg-primary)', padding: 10, borderRadius: 6,
                            border: '1px solid var(--border)', fontSize: 11, lineHeight: 1.7,
                            color: 'var(--text-secondary)', whiteSpace: 'pre-wrap',
                            maxHeight: 200, overflowY: 'auto',
                          }}>
                            {item.generatedPrompt.prompt_text}
                          </div>
                        </div>
                      )}

                      {/* Manual actions */}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {item.status === 'raw' && (
                          <button onClick={() => handleAnalyze(item)} disabled={isProcessing}
                            style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'rgba(59,130,246,0.15)', color: '#3b82f6', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                            🔬 วิเคราะห์ DNA เท่านั้น
                          </button>
                        )}
                        {item.analysis && !item.generatedPrompt && (
                          <button onClick={() => handleGeneratePrompt(item)} disabled={isProcessing}
                            style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                            ⚡ สร้าง Prompt
                          </button>
                        )}
                        <button onClick={() => handleDelete(item.id)}
                          style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
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
