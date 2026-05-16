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
  const [step, setStep] = useState('input'); // input → extracted → analyzed
  const [extracted, setExtracted] = useState(null); // raw extraction result from /api/extract
  const [newsData, setNewsData] = useState(null); // AI-extracted clean news { newsTitle, newsBody, ... }
  const [analysisResult, setAnalysisResult] = useState(null); // Analysis result from preset

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

  // === STEP 3: วิเคราะห์ประเด็นด้วย Preset ===
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
          text: newsData.newsBody, // ส่งเนื้อข่าวสะอาดเท่านั้น!
          newsTitle: newsData.newsTitle,
          sourceType,
          customPrompt,
          analysisPresetId: usePreset,
          mode: 'analyze',
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
    setError(''); setNewsData(null); setAnalysisResult(null);
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
      <Header title="✨ สร้างคอนเทนต์ใหม่" subtitle="ป้อนแหล่งข้อมูล → AI สกัดข่าว → เลือก Prompt → วิเคราะห์ประเด็น" />
      <div className="page-content">
        {loading && (
          <div className="loading-overlay">
            <div className="spinner" />
            <div className="loading-text">
              {step === 'input' ? '📥 กำลังสกัดเนื้อข่าว...' :
               step === 'extracted' ? '🤖 กำลังวิเคราะห์ประเด็นด้วย AI...' :
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
          {['ป้อนข้อมูล', 'สกัดเนื้อข่าว', 'วิเคราะห์ประเด็น'].map((label, i) => {
            const steps = ['input', 'extracted', 'analyzed'];
            const currentIdx = steps.indexOf(step);
            const status = i < currentIdx ? 'done' : i === currentIdx ? 'active' : '';
            return (
              <span key={i} style={{ display: 'contents' }}>
                <div className={`pipeline-step ${status}`} onClick={() => i <= currentIdx && setStep(steps[i])} style={{ cursor: i <= currentIdx ? 'pointer' : 'default' }}>
                  {i + 1}. {label}
                </div>
                {i < 2 && <span className="pipeline-arrow">→</span>}
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

            {/* ===== เลือก Preset + ปุ่มวิเคราะห์ ===== */}
            <div style={{ background: 'var(--bg-primary)', padding: 20, borderRadius: 'var(--radius-md)', border: '2px solid var(--accent)', marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--accent-light)', marginBottom: 4 }}>
                🎯 เลือก Prompt วิเคราะห์ประเด็น แล้วกดปุ่ม
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>
                ระบบจะส่งเนื้อข่าวด้านบนไปให้ AI วิเคราะห์ตาม Prompt ที่คุณเลือก
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                {analysisPresets.map(p => (
                  <button key={p.id} type="button"
                    disabled={loading}
                    onClick={() => handleAnalyze(p.id)}
                    style={{
                      padding: '14px 16px', textAlign: 'left', fontFamily: 'inherit',
                      background: selectedPreset === p.id ? 'var(--accent)' : 'var(--bg-secondary)',
                      color: selectedPreset === p.id ? '#fff' : 'var(--text-primary)',
                      border: selectedPreset === p.id ? '2px solid var(--accent-light)' : '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)', cursor: loading ? 'wait' : 'pointer',
                      transition: 'all 0.2s',
                    }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>
                      {loading && selectedPreset === p.id ? '⏳ กำลังวิเคราะห์...' : `▶ ${p.name}`}
                    </div>
                    <div style={{ fontSize: 10, marginTop: 4, opacity: 0.8 }}>{p.desc}</div>
                  </button>
                ))}
              </div>
              <a href="/prompts?tab=analysis" target="_blank" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 10, display: 'inline-block' }}>
                ⚙️ จัดการ Presets ในหน้า Prompts
              </a>
            </div>

            {/* คำสั่งเพิ่มเติม */}
            <div className="form-group" style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
              <label className="form-label">✏️ คำสั่งเพิ่มเติม (ไม่บังคับ)</label>
              <textarea className="form-textarea" value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="เช่น: เน้นมุมดราม่า, เขียนแบบเล่าเรื่อง..."
                style={{ minHeight: 50, fontSize: 13 }} />
            </div>
          </div>
        )}

        {/* ===== STEP 3: Analyzed — ผลลัพธ์วิเคราะห์ ===== */}
        {step === 'analyzed' && analysisResult && (
          <div className="card slide-up">
            {/* หัวข้อข่าว */}
            <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--accent)', borderLeft: '4px solid var(--accent)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-light)', marginBottom: 6 }}>🗞️ หัวข้อข่าว</div>
              <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.5 }}>{newsData?.newsTitle}</div>
            </div>

            {/* ผลวิเคราะห์ */}
            <div style={{ background: 'var(--bg-primary)', padding: 20, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--warning)', borderLeft: '4px solid var(--warning)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--warning)' }}>
                  🤖 AI วิเคราะห์ประเด็น — {analysisResult.usedPreset?.name || 'Default'}
                </div>
                <button className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}
                  onClick={() => copyText(analysisResult.summary, 'summary')}>
                  {copied === 'summary' ? '✅ คัดลอกแล้ว' : '📋 คัดลอก'}
                </button>
              </div>
              <div style={{ fontSize: 15, lineHeight: 2, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                {analysisResult.summary}
              </div>
            </div>

            {/* Engagement Ending */}
            {analysisResult.engagement_ending && (
              <div style={{ background: 'var(--bg-primary)', padding: 14, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--success)', borderLeft: '4px solid var(--success)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', marginBottom: 6 }}>💬 ประโยคปิดกระตุ้นคอมเมนต์</div>
                <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{analysisResult.engagement_ending}</div>
              </div>
            )}

            {/* Key Points / Viral Headlines */}
            {analysisResult.key_points?.length > 0 && (
              <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>📌 ประเด็นสำคัญ / Viral Headlines</div>
                {analysisResult.key_points.map((point, i) => (
                  <div key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '6px 0', display: 'flex', gap: 8 }}>
                    <span style={{ color: 'var(--accent-light)', fontWeight: 700 }}>•</span> {point}
                  </div>
                ))}
              </div>
            )}

            {/* Meta Tags */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
              {analysisResult.selected_main_angle && <span style={{ fontSize: 11, padding: '4px 10px', background: 'var(--viral-bg)', color: 'var(--viral)', borderRadius: 12 }}>🎯 {analysisResult.selected_main_angle}</span>}
              {analysisResult.emotion && <span style={{ fontSize: 11, padding: '4px 10px', background: 'var(--info-bg)', color: 'var(--info)', borderRadius: 12 }}>🎭 {analysisResult.emotion}</span>}
              {analysisResult.viral_potential && <span style={{ fontSize: 11, padding: '4px 10px', background: 'var(--warning-bg)', color: 'var(--warning)', borderRadius: 12 }}>🔥 FB Safety: {analysisResult.viral_potential}</span>}
              {analysisResult.target_audience && <span style={{ fontSize: 11, padding: '4px 10px', background: 'var(--success-bg)', color: 'var(--success)', borderRadius: 12 }}>👤 {analysisResult.target_audience}</span>}
            </div>

            {/* FB Safety Check */}
            {analysisResult.facebook_safe_check?.replaced_words?.length > 0 && (
              <div style={{ background: 'var(--bg-primary)', padding: 14, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--info)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--info)', marginBottom: 6 }}>🛡️ Facebook Safety — คำที่เปลี่ยนแล้ว</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {analysisResult.facebook_safe_check.replaced_words.join(', ')}
                </div>
              </div>
            )}

            {/* ปุ่มวิเคราะห์ใหม่ด้วย Preset อื่น */}
            <div style={{ paddingTop: 16, borderTop: '1px solid var(--border)', marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10 }}>🔄 วิเคราะห์ใหม่ด้วย Prompt อื่น:</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {analysisPresets.map(p => (
                  <button key={p.id} className="btn btn-outline btn-sm"
                    disabled={loading}
                    onClick={() => handleAnalyze(p.id)}
                    style={{
                      fontSize: 12,
                      background: analysisResult.usedPreset?.id === p.id ? 'var(--accent)' : undefined,
                      color: analysisResult.usedPreset?.id === p.id ? '#fff' : undefined,
                      border: analysisResult.usedPreset?.id === p.id ? '1px solid var(--accent)' : undefined,
                    }}>
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
