'use client';

import { useState, useEffect } from 'react';
import Header from '@/components/layout/Header';

const SOURCE_TYPES = [
  { value: 'url', label: '🔗 URL ข่าว/เว็บไซต์', desc: 'วางลิงก์ข่าว, บทความ, โพสต์' },
  { value: 'raw', label: '📝 ข้อความ', desc: 'วางข้อความหรือพิมพ์เอง' },
  { value: 'facebook', label: '📘 Facebook', desc: 'วาง URL โพสต์ Facebook' },
  { value: 'tiktok', label: '🎵 TikTok', desc: 'วาง URL วิดีโอ TikTok' },
  { value: 'youtube', label: '📺 YouTube', desc: 'ดึง transcript จาก YouTube' },
];

export default function NewContentPage() {
  const [sourceType, setSourceType] = useState('url');
  const [url, setUrl] = useState('');
  const [rawText, setRawText] = useState('');
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [analysisPresets, setAnalysisPresets] = useState([]);
  const [selectedPreset, setSelectedPreset] = useState('viral_fb');

  // Flow state
  const [step, setStep] = useState('input'); // input → extracted → breakdown → analyzed
  const [extracted, setExtracted] = useState(null);
  const [newsData, setNewsData] = useState(null);
  const [breakdownData, setBreakdownData] = useState(null);
  const [breakdownPromptText, setBreakdownPromptText] = useState('');
  const [analysisResult, setAnalysisResult] = useState(null);

  // Load presets
  useEffect(() => {
    fetch('/api/prompts').then(r => r.json()).then(d => {
      if (d.analysisPresets) {
        setAnalysisPresets(d.analysisPresets);
        if (d.analysisPresets.length > 0) setSelectedPreset(d.analysisPresets[0].id);
      }
    }).catch(() => {});
  }, []);

  // === STEP 1: ดึงเนื้อหาจาก URL ===
  const handleExtract = async () => {
    setExtracting(true);
    setError('');
    setExtracted(null);
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type: sourceType }),
      });
      const data = await res.json();
      const result = data.data || data;

      if (result.success && result.text) {
        setExtracted(result);
        setRawText(result.text);
      } else {
        setExtracted({ success: false, error: result.error || 'ดึงเนื้อหาไม่ได้', suggestion: 'paste' });
        setError((result.error || 'ดึงเนื้อหาไม่ได้') + ' — วาง/พิมพ์ข้อความด้านล่างแทนได้เลย');
      }
    } catch (err) {
      setExtracted({ success: false, error: err.message, suggestion: 'paste' });
      setError(err.message + ' — วาง/พิมพ์ข้อความด้านล่างแทนได้เลย');
    } finally {
      setExtracting(false);
    }
  };

  // === STEP 2: สกัดเนื้อข่าว (AI extraction) ===
  const handleExtractNews = async () => {
    if (!rawText) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rawText, sourceType, customPrompt, mode: 'extract' }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setNewsData(data.data);
      setStep('extracted');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // === STEP 2.5: แตกประเด็น + สรุปใจความ ===
  const handleBreakdown = async () => {
    if (!newsData?.newsBody) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: newsData.newsBody,
          newsTitle: newsData.newsTitle,
          customPrompt: breakdownPromptText,
          mode: 'breakdown',
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setBreakdownData(data.data);
      setStep('breakdown');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // === STEP 4: วิเคราะห์ประเด็นด้วย Preset (ส่ง newsBody + breakdownData) ===
  const handleAnalyze = async (presetId) => {
    const usePreset = presetId || selectedPreset;
    if (!newsData?.newsBody) return;
    setLoading(true);
    setError('');
    setSelectedPreset(usePreset);
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: newsData.newsBody,
          newsTitle: newsData.newsTitle,
          sourceType,
          customPrompt,
          analysisPresetId: usePreset,
          mode: 'analyze',
          breakdownData: breakdownData || null,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setAnalysisResult(data.data);
      setStep('analyzed');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Copy
  const copyText = (text, label) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  // Reset
  const handleReset = () => {
    setStep('input'); setExtracted(null); setRawText(''); setUrl('');
    setError(''); setNewsData(null); setBreakdownData(null); setAnalysisResult(null);
  };

  const needsUrl = ['url', 'facebook', 'tiktok', 'youtube'].includes(sourceType);
  const placeholders = {
    url: 'https://www.thairath.co.th/news/...',
    facebook: 'https://www.facebook.com/username/posts/...',
    tiktok: 'https://www.tiktok.com/@user/video/...',
    youtube: 'https://www.youtube.com/watch?v=...',
  };

  return (
    <>
      <Header title="✨ สร้างคอนเทนต์ใหม่" subtitle="สกัดข่าว → แตกประเด็น → เลือก Prompt → วิเคราะห์" />
      <div className="page-content">
        {loading && (
          <div className="loading-overlay">
            <div className="spinner" />
            <div className="loading-text">
              {step === 'input' ? '📥 กำลังสกัดเนื้อข่าว...' :
               step === 'extracted' ? '🔍 กำลังแตกประเด็น...' :
               step === 'breakdown' ? '🤖 กำลังวิเคราะห์ด้วย AI...' :
               '⏳ กำลังประมวลผล...'}
            </div>
          </div>
        )}

        {error && (
          <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', padding: '14px 20px', marginBottom: 20, color: 'var(--danger)', fontSize: 13 }}>
            ❌ {error}
            <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontWeight: 700 }}>✕</button>
          </div>
        )}

        {/* Pipeline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 24, flexWrap: 'wrap' }}>
          {['ป้อนข้อมูล', 'สกัดข่าว', 'แตกประเด็น', 'วิเคราะห์'].map((label, i) => {
            const steps = ['input', 'extracted', 'breakdown', 'analyzed'];
            const currentIdx = steps.indexOf(step);
            const status = i < currentIdx ? 'done' : i === currentIdx ? 'active' : '';
            return (
              <span key={i} style={{ display: 'contents' }}>
                <div className={`pipeline-step ${status}`} onClick={() => i <= currentIdx && setStep(steps[i])} style={{ cursor: i <= currentIdx ? 'pointer' : 'default' }}>
                  {i + 1}. {label}
                </div>
                {i < 3 && <span className="pipeline-arrow">→</span>}
              </span>
            );
          })}
          {step !== 'input' && (
            <button onClick={handleReset} className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}>🔄 เริ่มใหม่</button>
          )}
        </div>

        {/* ===== STEP 1: Input ===== */}
        {step === 'input' && (
          <div className="card slide-up">
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>📥 เลือกแหล่งข้อมูล</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 24 }}>
              {SOURCE_TYPES.map((s) => (
                <button key={s.value} onClick={() => { setSourceType(s.value); setExtracted(null); setRawText(''); }}
                  style={{
                    padding: '14px 16px', textAlign: 'left', fontFamily: 'inherit',
                    background: sourceType === s.value ? 'var(--accent-glow)' : 'var(--bg-primary)',
                    border: `1px solid ${sourceType === s.value ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', cursor: 'pointer',
                  }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.desc}</div>
                </button>
              ))}
            </div>

            {/* URL Input */}
            {needsUrl && (
              <div className="form-group">
                <label className="form-label">🔗 URL</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="url" className="form-input" placeholder={placeholders[sourceType]}
                    value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1 }} />
                  <button type="button" onClick={handleExtract} disabled={!url || extracting}
                    className="btn btn-outline" style={{ whiteSpace: 'nowrap' }}>
                    {extracting ? '⏳ กำลังดึง...' : '📥 ดึงเนื้อหา'}
                  </button>
                </div>
              </div>
            )}

            {/* Extracted Preview */}
            {extracted?.success && (
              <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--success)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 16 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)' }}>✅ ดึงเนื้อหาสำเร็จ</span>
                {extracted.title && <div style={{ fontSize: 14, fontWeight: 600, marginTop: 6 }}>{extracted.title}</div>}
              </div>
            )}

            {/* Text area */}
            {(sourceType === 'raw' || extracted || sourceType === 'facebook') && (
              <div className="form-group">
                <label className="form-label">📝 {
                  extracted?.success ? 'เนื้อหาที่ดึงมา (แก้ไขได้)' :
                  extracted?.suggestion === 'paste' ? '📋 วาง/พิมพ์ข้อความจากเว็บแทน' :
                  'เนื้อหา'
                }</label>
                <textarea className="form-textarea" value={rawText} onChange={(e) => setRawText(e.target.value)}
                  placeholder="Copy เนื้อหาจากเว็บ/โพสต์/คลิป มาวางที่นี่..."
                  style={{ minHeight: 180 }} />
              </div>
            )}

            {/* Custom extraction prompt */}
            {rawText && (
              <div className="form-group" style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                <label className="form-label">🤖 คำสั่งให้ AI สกัดเนื้อข่าว (ไม่บังคับ)</label>
                <textarea className="form-textarea" value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="สั่ง AI เช่น: แยกเฉพาะเนื้อข่าวจริง ตัดลิงก์โซเชียลมีเดียออก..."
                  style={{ minHeight: 50, fontSize: 13 }} />
              </div>
            )}

            {/* ปุ่มสกัดข่าว */}
            <button type="button" onClick={handleExtractNews} className="btn btn-viral btn-lg"
              style={{ width: '100%', marginTop: 12 }} disabled={loading || !rawText}>
              {loading ? '⏳ กำลังสกัดเนื้อข่าว...' : '📥 สกัดเนื้อข่าว (AI แยกข่าวจริงจากขยะ)'}
            </button>
          </div>
        )}

        {/* ===== STEP 2: Extracted — แสดงเนื้อข่าวสะอาด + เลือก preset วิเคราะห์ ===== */}
        {step === 'extracted' && newsData && (
          <div className="card slide-up">
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>📋 เนื้อข่าวที่ AI สกัดได้</h3>

            {/* หัวข้อ */}
            <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--accent)', borderLeft: '4px solid var(--accent)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-light)', marginBottom: 6 }}>🗞️ หัวข้อข่าว</div>
              <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.5 }}>{newsData.newsTitle}</div>
              {(newsData.newsSource || newsData.newsDate) && (
                <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                  {newsData.newsSource && <span>📰 {newsData.newsSource}</span>}
                  {newsData.newsDate && <span>📅 {newsData.newsDate}</span>}
                  {newsData.newsCategory && <span>📂 {newsData.newsCategory}</span>}
                </div>
              )}
            </div>

            {/* เนื้อข่าวสะอาด */}
            <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 20, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>📝 เนื้อข่าวที่สกัดได้ ({newsData.newsBody?.length || 0} ตัวอักษร)</div>
                <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}
                  onClick={() => copyText(newsData.newsBody, 'news')}>
                  {copied === 'news' ? '✅ คัดลอกแล้ว' : '📋 คัดลอก'}
                </button>
              </div>
              <div style={{ fontSize: 14, lineHeight: 2, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>
                {newsData.newsBody}
              </div>
            </div>

            {/* คำสั่งแตกประเด็น */}
            <div className="form-group" style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
              <label className="form-label">🤖 คำสั่งเพิ่มเติมสำหรับแตกประเด็น (ไม่บังคับ)</label>
              <textarea className="form-textarea" value={breakdownPromptText} onChange={(e) => setBreakdownPromptText(e.target.value)}
                placeholder="เช่น: เน้นประเด็นดราม่า, หาจุดที่คนจะอิน, แยกข้อเท็จจริงกับความเห็น..."
                style={{ minHeight: 50, fontSize: 13 }} />
            </div>

            <button type="button" onClick={handleBreakdown} className="btn btn-viral btn-lg"
              style={{ width: '100%' }} disabled={loading}>
              {loading ? '⏳ กำลังแตกประเด็น...' : '🔍 AI แตกประเด็น + สรุปใจความสำคัญ'}
            </button>
          </div>
        )}
        {/* ===== STEP 3: Breakdown — แตกประเด็น + interactive feedback ===== */}
        {step === 'breakdown' && breakdownData && (
          <div className="card slide-up">
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>🔍 AI แตกประเด็น + สรุปใจความ</h3>

            {/* สรุปรวม */}
            <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--accent)', borderLeft: '4px solid var(--accent)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-light)', marginBottom: 6 }}>📋 สรุปรวมข่าว</div>
              <div style={{ fontSize: 14, lineHeight: 2, color: 'var(--text-secondary)' }}>{breakdownData.news_summary}</div>
            </div>

            {/* Key Points */}
            {breakdownData.key_points?.length > 0 && (
              <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10 }}>📌 ประเด็นสำคัญ ({breakdownData.key_points.length} ประเด็น)</div>
                {breakdownData.key_points.map((kp, i) => (
                  <div key={i} style={{ padding: '10px 12px', marginBottom: 8, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{i+1}. {kp.point}</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 8, background: kp.importance === 'สูง' ? 'var(--danger-bg)' : 'var(--bg-tertiary)', color: kp.importance === 'สูง' ? 'var(--danger)' : 'var(--text-muted)' }}>⚡ {kp.importance}</span>
                        <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 8, background: kp.emotional_value === 'สูง' ? 'var(--warning-bg)' : 'var(--bg-tertiary)', color: kp.emotional_value === 'สูง' ? 'var(--warning)' : 'var(--text-muted)' }}>💖 {kp.emotional_value}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>{kp.detail}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Best Sections + Emotional Hooks */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              {breakdownData.best_sections?.length > 0 && (
                <div style={{ background: 'var(--bg-primary)', padding: 14, borderRadius: 'var(--radius-md)', border: '1px solid var(--success)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', marginBottom: 8 }}>⭐ ท่อนที่ดีที่สุด</div>
                  {breakdownData.best_sections.map((s, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '4px 0', lineHeight: 1.7 }}>• {s}</div>
                  ))}
                </div>
              )}
              {breakdownData.emotional_hooks?.length > 0 && (
                <div style={{ background: 'var(--bg-primary)', padding: 14, borderRadius: 'var(--radius-md)', border: '1px solid var(--warning)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--warning)', marginBottom: 8 }}>🎣 จุดที่คนจะอิน</div>
                  {breakdownData.emotional_hooks.map((h, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '4px 0', lineHeight: 1.7 }}>• {h}</div>
                  ))}
                </div>
              )}
            </div>

            {/* Key Facts */}
            {breakdownData.key_facts && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                {breakdownData.key_facts.people?.map((p, i) => <span key={`p${i}`} style={{ fontSize: 10, padding: '3px 8px', background: 'var(--info-bg)', color: 'var(--info)', borderRadius: 10 }}>👤 {p}</span>)}
                {breakdownData.key_facts.places?.map((p, i) => <span key={`l${i}`} style={{ fontSize: 10, padding: '3px 8px', background: 'var(--success-bg)', color: 'var(--success)', borderRadius: 10 }}>📍 {p}</span>)}
                {breakdownData.key_facts.numbers?.map((n, i) => <span key={`n${i}`} style={{ fontSize: 10, padding: '3px 8px', background: 'var(--warning-bg)', color: 'var(--warning)', borderRadius: 10 }}>🔢 {n}</span>)}
                {breakdownData.key_facts.dates?.map((d, i) => <span key={`d${i}`} style={{ fontSize: 10, padding: '3px 8px', background: 'var(--viral-bg)', color: 'var(--viral)', borderRadius: 10 }}>📅 {d}</span>)}
              </div>
            )}

            {/* Interactive Feedback — สั่ง AI แตกใหม่ */}
            <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', border: '2px solid var(--info)', marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--info)', marginBottom: 8 }}>💬 สั่ง AI ปรับผลลัพธ์ (พิมพ์แล้วกดแตกใหม่)</div>
              <textarea className="form-textarea" value={breakdownPromptText} onChange={(e) => setBreakdownPromptText(e.target.value)}
                placeholder="เช่น: ประเด็นที่ 2 ไม่ดี ตัดออก, เน้นมุมดราม่ามากขึ้น, แตกประเด็นเรื่องตัวเลขให้ละเอียดกว่านี้..."
                style={{ minHeight: 60, fontSize: 13, marginBottom: 8 }} />
              <button onClick={handleBreakdown} className="btn btn-outline" disabled={loading} style={{ width: '100%' }}>
                {loading ? '⏳ กำลังแตกใหม่...' : '🔄 แตกประเด็นใหม่ตามคำสั่ง'}
              </button>
            </div>

            {/* เลือก Preset วิเคราะห์ → ไป Step สุดท้าย */}
            <div style={{ background: 'var(--bg-primary)', padding: 20, borderRadius: 'var(--radius-md)', border: '2px solid var(--accent)' }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--accent-light)', marginBottom: 4 }}>🎯 พอใจแล้ว? เลือก Prompt วิเคราะห์ประเด็นสุดท้าย</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>ระบบจะส่งเนื้อข่าว + ผลแตกประเด็นไปให้ AI วิเคราะห์ตาม Prompt ที่เลือก</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                {analysisPresets.map(p => (
                  <button key={p.id} type="button" disabled={loading} onClick={() => handleAnalyze(p.id)}
                    style={{ padding: '14px 16px', textAlign: 'left', fontFamily: 'inherit', background: selectedPreset === p.id ? 'var(--accent)' : 'var(--bg-secondary)', color: selectedPreset === p.id ? '#fff' : 'var(--text-primary)', border: selectedPreset === p.id ? '2px solid var(--accent-light)' : '1px solid var(--border)', borderRadius: 'var(--radius-md)', cursor: loading ? 'wait' : 'pointer' }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{loading && selectedPreset === p.id ? '⏳...' : `▶ ${p.name}`}</div>
                    <div style={{ fontSize: 10, marginTop: 4, opacity: 0.8 }}>{p.desc}</div>
                  </button>
                ))}
              </div>
              <a href="/prompts?tab=analysis" target="_blank" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 10, display: 'inline-block' }}>⚙️ จัดการ Presets</a>
            </div>
          </div>
        )}

        {/* ===== STEP 4: Analyzed — ผลลัพธ์หลายเวอร์ชัน ===== */}
        {step === 'analyzed' && analysisResult && (
          <div className="card slide-up">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>📝 ผลลัพธ์ — {analysisResult.usedPreset?.name || 'AI'}</h3>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{analysisResult.versions?.length || 0} เวอร์ชัน</span>
            </div>

            {/* หัวข้อข่าว */}
            <div style={{ background: 'var(--bg-primary)', padding: 12, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--accent)', borderLeft: '4px solid var(--accent)' }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{newsData?.newsTitle}</div>
              {analysisResult.news_reference && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>📰 {analysisResult.news_reference}</div>}
            </div>

            {/* แสดงแต่ละ Version */}
            {analysisResult.versions?.map((v, i) => (
              <div key={i} style={{ background: 'var(--bg-primary)', padding: 20, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--border)', borderLeft: `4px solid hsl(${i * 60}, 70%, 50%)` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 800 }}>#{i+1} {v.style}</span>
                    {v.tone && <span style={{ fontSize: 9, padding: '2px 8px', background: 'var(--info-bg)', color: 'var(--info)', borderRadius: 10 }}>🎭 {v.tone}</span>}
                    {v.target && <span style={{ fontSize: 9, padding: '2px 8px', background: 'var(--success-bg)', color: 'var(--success)', borderRadius: 10 }}>👤 {v.target}</span>}
                  </div>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}
                    onClick={() => copyText(v.content, `v${i}`)}>
                    {copied === `v${i}` ? '✅ คัดลอกแล้ว' : '📋 คัดลอก'}
                  </button>
                </div>
                {v.title && <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent-light)', marginBottom: 8 }}>{v.title}</div>}
                {v.hook && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--warning)', marginBottom: 8, fontStyle: 'italic' }}>🪝 {v.hook}</div>}
                <div style={{ fontSize: 14, lineHeight: 2, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{v.content}</div>
                {v.closing && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--success)', marginTop: 10, fontStyle: 'italic' }}>💬 {v.closing}</div>}
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>📊 {v.content?.split(/\s+/).length || 0} คำ</div>
              </div>
            ))}

            {/* ถ้าไม่มี versions แสดง summary แบบเดิม */}
            {(!analysisResult.versions || analysisResult.versions.length === 0) && analysisResult.summary && (
              <div style={{ background: 'var(--bg-primary)', padding: 20, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--warning)', borderLeft: '4px solid var(--warning)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--warning)', marginBottom: 12 }}>🤖 ผลลัพธ์</div>
                <div style={{ fontSize: 15, lineHeight: 2, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{analysisResult.summary}</div>
              </div>
            )}

            {/* Debug Panel */}
            {analysisResult.debug && (
              <details style={{ marginBottom: 16 }}>
                <summary style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', cursor: 'pointer', padding: '8px 0' }}>🔍 Debug — ตรวจสอบข้อมูลที่ส่งให้ AI</summary>
                <div style={{ background: 'var(--bg-primary)', padding: 12, borderRadius: 'var(--radius-sm)', marginTop: 4, fontSize: 11, color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                  <div>📏 Prompt ความยาว: {analysisResult.debug.promptLength?.toLocaleString()} ตัวอักษร</div>
                  <div>📰 เนื้อข่าว: {analysisResult.debug.newsBodyLength?.toLocaleString()} ตัวอักษร</div>
                  <div>📌 ประเด็นที่แตก: {analysisResult.debug.breakdownPointsCount} ประเด็น</div>
                  <div>🎯 Preset: {analysisResult.debug.presetUsed}</div>
                  <div>🔗 มี Breakdown: {analysisResult.debug.hasBreakdown ? '✅ ใช่' : '❌ ไม่'}</div>
                  <div style={{ marginTop: 8, wordBreak: 'break-all', maxHeight: 150, overflow: 'auto', background: 'var(--bg-secondary)', padding: 8, borderRadius: 4 }}>
                    <strong>Prompt Preview:</strong><br/>{analysisResult.debug.promptPreview}
                  </div>
                </div>
              </details>
            )}

            {/* ปุ่มวิเคราะห์ใหม่ */}
            <div style={{ paddingTop: 16, borderTop: '1px solid var(--border)', marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10 }}>🔄 สร้างใหม่ด้วย Prompt อื่น:</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {analysisPresets.map(p => (
                  <button key={p.id} className="btn btn-outline btn-sm" disabled={loading} onClick={() => handleAnalyze(p.id)}
                    style={{ fontSize: 12, background: analysisResult.usedPreset?.id === p.id ? 'var(--accent)' : undefined, color: analysisResult.usedPreset?.id === p.id ? '#fff' : undefined }}>
                    {loading && selectedPreset === p.id ? '⏳...' : p.name}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={handleReset} className="btn btn-primary btn-lg" style={{ width: '100%' }}>
              🔄 สร้างคอนเทนต์ใหม่
            </button>
          </div>
        )}
      </div>
    </>
  );
}
