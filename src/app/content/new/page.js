'use client';

import { useState } from 'react';
import Header from '@/components/layout/Header';

const SOURCE_TYPES = [
  { value: 'url', label: '🔗 URL ข่าว/เว็บไซต์', desc: 'วางลิงก์ข่าว, บทความ, โพสต์' },
  { value: 'raw', label: '📝 ข้อความ', desc: 'วางข้อความหรือพิมพ์เอง' },
  { value: 'facebook', label: '📘 Facebook', desc: 'วาง URL โพสต์ Facebook' },
  { value: 'tiktok', label: '🎵 TikTok', desc: 'วาง URL วิดีโอ TikTok' },
  { value: 'youtube', label: '📺 YouTube', desc: 'ดึง transcript จาก YouTube' },
];

function ScoreBar({ label, value, icon }) {
  const getClass = (v) => v >= 70 ? 'high' : v >= 40 ? 'medium' : 'low';
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{icon} {label}</span>
        <span className={`score-badge ${getClass(value)}`}>{value}</span>
      </div>
      <div className="viral-meter">
        <div className={`viral-meter-fill ${getClass(value)}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export default function NewContentPage() {
  const [sourceType, setSourceType] = useState('url');
  const [url, setUrl] = useState('');
  const [rawText, setRawText] = useState('');
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState('input');
  const [extracted, setExtracted] = useState(null);
  const [copied, setCopied] = useState('');
  const [summary, setSummary] = useState(null);
  const [customPrompt, setCustomPrompt] = useState('');

  // === ดึงเนื้อหา (Preview) ===
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
        // ดึงไม่ได้ → เปิดช่อง paste ให้อัตโนมัติ
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

  // === สรุปเนื้อหาจากต้นทาง ===
  const handleSummarize = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rawText, sourceType }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setSummary(data.data);
      setStep('summarized');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // === วิเคราะห์ไวรัล ===
  const handleAnalyze = async () => {
    setLoading(true);
    setError('');
    try {
      const payload = {
        type: sourceType === 'raw' ? 'raw' : sourceType,
        url: sourceType !== 'raw' ? url : undefined,
        rawContent: rawText,
        autoAnalyze: true,
      };
      const res = await fetch('/api/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setResult(data);
      setStep('analyzed');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // === สร้างคอนเทนต์ (submit form) ===
  const handleSubmit = async (e) => {
    e.preventDefault();
    await handleSummarize();
  };

  // === สร้าง Angles ===
  const handleGenerateAngles = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/angles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentId: result.data.id }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setResult(prev => ({ ...prev, angles: data.data }));
      setStep('angles');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  // === สร้างบทความ ===
  const handleGenerateArticle = async (headlineIdx = 0, hookIdx = 0, tone = 'emotional') => {
    setLoading(true);
    try {
      const res = await fetch('/api/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentId: result.data.id,
          angleId: result.angles?.id,
          headlineIndex: headlineIdx,
          hookIndex: hookIdx,
          tone,
          customPrompt,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setResult(prev => ({ ...prev, article: data.data }));
      setStep('article');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  // === Copy to clipboard ===
  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  // === Reset ===
  const handleReset = () => {
    setStep('input');
    setResult(null);
    setExtracted(null);
    setRawText('');
    setUrl('');
    setError('');
  };

  const viralScores = result?.analysis?.viral_scores || result?.data?.analysis?.viral_scores;
  const emotionalAnalysis = result?.analysis?.emotional_analysis || (result?.data?.analysis?.emotional_analysis);

  const needsUrl = ['url', 'facebook', 'tiktok', 'youtube'].includes(sourceType);
  const placeholders = {
    url: 'https://www.thairath.co.th/news/...',
    facebook: 'https://www.facebook.com/username/posts/...',
    tiktok: 'https://www.tiktok.com/@user/video/...',
    youtube: 'https://www.youtube.com/watch?v=...',
  };

  return (
    <>
      <Header title="✨ สร้างคอนเทนต์ใหม่" subtitle="ป้อนแหล่งข้อมูล → AI วิเคราะห์ → สร้างบทความไวรัล" />
      <div className="page-content">
        {loading && (
          <div className="loading-overlay">
            <div className="spinner" />
            <div className="loading-text">
              {step === 'input' ? '🔍 กำลังดึงเนื้อหาและวิเคราะห์...' :
               step === 'analyzed' ? '🎯 กำลังสร้างมุมมองไวรัล...' :
               '✍️ กำลังเขียนบทความ...'}
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
          {['ป้อนข้อมูล', 'สรุปเนื้อหา', 'วิเคราะห์', 'มุมมองไวรัล', 'บทความ'].map((label, i) => {
            const steps = ['input', 'summarized', 'analyzed', 'angles', 'article'];
            const currentIdx = steps.indexOf(step);
            const status = i < currentIdx ? 'done' : i === currentIdx ? 'active' : '';
            return (
              <span key={i} style={{ display: 'contents' }}>
                <div className={`pipeline-step ${status}`} onClick={() => i <= currentIdx && setStep(steps[i])} style={{ cursor: i <= currentIdx ? 'pointer' : 'default' }}>
                  {i + 1}. {label}
                </div>
                {i < 4 && <span className="pipeline-arrow">→</span>}
              </span>
            );
          })}
          {step !== 'input' && (
            <button onClick={handleReset} className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}>🔄 เริ่มใหม่</button>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: step !== 'input' ? '1fr 380px' : '1fr', gap: 24 }}>
          <div>
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
                        transition: 'all var(--transition)',
                      }}>
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{s.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.desc}</div>
                    </button>
                  ))}
                </div>

                <form onSubmit={handleSubmit}>
                  {/* URL Input */}
                  {needsUrl && (
                    <div className="form-group">
                      <label className="form-label">🔗 {sourceType === 'facebook' ? 'Facebook URL' : sourceType === 'tiktok' ? 'TikTok URL' : sourceType === 'youtube' ? 'YouTube URL' : 'URL'}</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input type="url" className="form-input" placeholder={placeholders[sourceType]}
                          value={url} onChange={(e) => setUrl(e.target.value)} required style={{ flex: 1 }} />
                        <button type="button" onClick={handleExtract} disabled={!url || extracting}
                          className="btn btn-outline" style={{ whiteSpace: 'nowrap' }}>
                          {extracting ? '⏳ กำลังดึง...' : '📥 ดึงเนื้อหา'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Extracted Preview */}
                  {extracted && (
                    <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 16 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)' }}>✅ ดึงเนื้อหาสำเร็จ</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{extracted.type}</span>
                      </div>
                      {extracted.title && <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{extracted.title}</div>}
                      {extracted.author && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>โดย: {extracted.author}</div>}
                      {extracted.note && <div style={{ fontSize: 11, color: 'var(--warning)', marginBottom: 6 }}>ℹ️ {extracted.note}</div>}
                      {extracted.thumbnailUrl && (
                        <img src={extracted.thumbnailUrl} alt="" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 8, marginBottom: 8 }} />
                      )}
                    </div>
                  )}

                  {/* Text area — show for raw, after extraction success/failure, or facebook */}
                  {(sourceType === 'raw' || extracted || sourceType === 'facebook') && (
                    <div className="form-group">
                      <label className="form-label">📝 {
                        extracted?.success ? 'เนื้อหาที่ดึงมา (แก้ไขได้)' :
                        extracted?.suggestion === 'paste' ? '📋 วาง/พิมพ์ข้อความจากเว็บแทน' :
                        sourceType === 'facebook' ? 'วาง/พิมพ์ข้อความจากโพสต์ Facebook' :
                        'เนื้อหา'
                      }</label>
                      <textarea className="form-textarea" value={rawText} onChange={(e) => setRawText(e.target.value)}
                        placeholder="Copy เนื้อหาจากเว็บ/โพสต์/คลิป มาวางที่นี่..."
                        required={sourceType === 'raw' || sourceType === 'facebook' || extracted?.suggestion === 'paste'}
                        style={{ minHeight: 180, borderColor: extracted?.suggestion === 'paste' ? 'var(--warning)' : undefined }} />
                    </div>
                  )}

                  <button type="submit" className="btn btn-viral btn-lg" style={{ width: '100%' }} disabled={loading || (!rawText && !url)}>
                    🚀 เริ่มวิเคราะห์ด้วย AI
                  </button>
                </form>
              </div>
            )}

            {/* ===== STEP 2: สรุปเนื้อหาจากต้นทาง ===== */}
            {step === 'summarized' && summary && (
              <div className="card slide-up">
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>📋 สรุปเนื้อหาจากต้นทาง</h3>

                {/* Title */}
                <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>หัวข้อหลัก</div>
                  <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.5 }}>{summary.title}</div>
                </div>

                {/* Summary */}
                <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>สรุปใจความ</div>
                  <div style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--text-secondary)' }}>{summary.summary}</div>
                </div>

                {/* Key Points */}
                {summary.key_points?.length > 0 && (
                  <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>ประเด็นสำคัญ</div>
                    {summary.key_points.map((point, i) => (
                      <div key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '6px 0', display: 'flex', gap: 8 }}>
                        <span style={{ color: 'var(--accent-light)', fontWeight: 700 }}>•</span> {point}
                      </div>
                    ))}
                  </div>
                )}

                {/* Meta info */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                  {summary.emotion && (
                    <span style={{ fontSize: 11, padding: '4px 10px', background: 'var(--viral-bg)', color: 'var(--viral)', borderRadius: 12 }}>🎭 {summary.emotion}</span>
                  )}
                  {summary.content_type && (
                    <span style={{ fontSize: 11, padding: '4px 10px', background: 'var(--info-bg)', color: 'var(--info)', borderRadius: 12 }}>📂 {summary.content_type}</span>
                  )}
                  {summary.people_involved?.length > 0 && summary.people_involved[0] !== '' && (
                    <span style={{ fontSize: 11, padding: '4px 10px', background: 'var(--success-bg)', color: 'var(--success)', borderRadius: 12 }}>👤 {summary.people_involved.join(', ')}</span>
                  )}
                </div>

                {/* Custom Prompt */}
                <div className="form-group">
                  <label className="form-label">✏️ คำสั่งเพิ่มเติมสำหรับ AI (Custom Prompt — ไม่บังคับ)</label>
                  <textarea className="form-textarea" value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="เช่น: เน้นมุมมองด้านเศรษฐกิจ, ใช้ภาษาที่เด็กอ่านเข้าใจ, เพิ่มข้อมูลสถิติ, เขียนแบบเล่าเรื่อง..."
                    style={{ minHeight: 80 }} />
                </div>

                <button onClick={handleAnalyze} className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading}>
                  🔍 วิเคราะห์ศักยภาพไวรัล
                </button>
              </div>
            )}

            {/* ===== STEP 3: Analyzed ===== */}
            {step === 'analyzed' && viralScores && (
              <div className="card slide-up">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700 }}>✅ วิเคราะห์สำเร็จ</h3>
                  <span className={`score-badge ${viralScores.viral_probability >= 70 ? 'viral' : viralScores.viral_probability >= 40 ? 'medium' : 'low'}`}
                    style={{ fontSize: 16, padding: '6px 16px' }}>🔥 {viralScores.viral_probability}%</span>
                </div>
                {result?.data?.analysis?.summary && (
                  <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 20, fontSize: 14, lineHeight: 1.8 }}>
                    {result.data.analysis.summary}
                  </div>
                )}
                {emotionalAnalysis && (
                  <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 20 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>🎭 การวิเคราะห์อารมณ์</div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 2 }}>
                      <div>อารมณ์หลัก: <strong style={{ color: 'var(--accent-light)' }}>{emotionalAnalysis.primary_emotion}</strong></div>
                      <div>กลุ่มเป้าหมาย: <strong>{result.data?.analysis?.target_audience || '-'}</strong></div>
                      <div>มุมที่แนะนำ: <strong>{result.data?.analysis?.recommended_angle || '-'}</strong></div>
                    </div>
                  </div>
                )}
                <button onClick={handleGenerateAngles} className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading}>
                  🎯 สร้างมุมมองไวรัล (Headlines & Hooks)
                </button>
              </div>
            )}

            {/* ===== STEP 3: Angles ===== */}
            {step === 'angles' && result?.angles && (
              <div className="card slide-up">
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>🎯 มุมมองไวรัล</h3>
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>📰 หัวข้อ (เลือก 1 ข้อ แล้วกดสร้างบทความ)</div>
                  {JSON.parse(result.angles.headlines).map((h, i) => (
                    <button key={i} onClick={() => handleGenerateArticle(i, 0, 'emotional')}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px', marginBottom: 8,
                        background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                        color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, transition: 'all var(--transition)' }}
                      onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                      onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}>
                      <span style={{ color: 'var(--text-muted)', marginRight: 8 }}>#{i + 1}</span>{h}
                    </button>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>💬 ตอนจบกระตุ้นคอมเมนต์</div>
                  {JSON.parse(result.angles.commentBaits).map((cb, i) => (
                    <div key={i} style={{ padding: '8px 12px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', marginBottom: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                      💬 {cb}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ===== STEP 4: Article ===== */}
            {step === 'article' && result?.article && (
              <div className="card slide-up">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700 }}>✍️ บทความที่สร้าง</h3>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => copyToClipboard(`${result.article.headline}\n\n${result.article.body}`, 'article')}>
                      {copied === 'article' ? '✅ คัดลอกแล้ว!' : '📋 คัดลอก'}
                    </button>
                  </div>
                </div>

                <div style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', padding: 28, border: '1px solid var(--border)' }}>
                  <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8, lineHeight: 1.5 }}>{result.article.headline}</h2>
                  {result.article.hook && (
                    <div style={{ fontSize: 14, color: 'var(--accent-light)', fontStyle: 'italic', marginBottom: 20 }}>{result.article.hook}</div>
                  )}
                  <div style={{ fontSize: 15, lineHeight: 2, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{result.article.body}</div>
                  {result.article.closing && (
                    <div style={{ marginTop: 16, fontSize: 14, color: 'var(--warning)', fontWeight: 600 }}>{result.article.closing}</div>
                  )}
                </div>

                {/* Caption & Hashtags */}
                {result.article.caption && (
                  <div style={{ marginTop: 16, background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>📱 แคปชั่น Facebook</span>
                      <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}
                        onClick={() => copyToClipboard(result.article.caption, 'caption')}>
                        {copied === 'caption' ? '✅' : '📋'}
                      </button>
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.8 }}>{result.article.caption}</div>
                    {result.article.hashtags && (
                      <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {result.article.hashtags.map((tag, i) => (
                          <span key={i} style={{ fontSize: 11, padding: '2px 8px', background: 'var(--info-bg)', color: 'var(--info)', borderRadius: 12 }}>#{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
                  <button onClick={() => handleGenerateArticle(0, 0, 'dramatic')} className="btn btn-outline btn-sm">🎭 ดราม่า</button>
                  <button onClick={() => handleGenerateArticle(0, 0, 'concise')} className="btn btn-outline btn-sm">⚡ กระชับ</button>
                  <button onClick={() => handleGenerateArticle(0, 0, 'controversial')} className="btn btn-outline btn-sm">🔥 ถกเถียง</button>
                  <button onClick={() => setStep('angles')} className="btn btn-outline btn-sm">◀ เลือกหัวข้ออื่น</button>
                  <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }}>✅ ส่งไปรีวิว</button>
                </div>
              </div>
            )}
          </div>

          {/* Right Column — Scores */}
          {step !== 'input' && viralScores && (
            <div>
              <div className="card" style={{ position: 'sticky', top: 'calc(var(--header-height) + 28px)' }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>📊 คะแนนไวรัล</h4>
                <ScoreBar label="ดราม่า" value={viralScores.drama} icon="🎭" />
                <ScoreBar label="อารมณ์" value={viralScores.emotional_intensity} icon="💖" />
                <ScoreBar label="สงสาร" value={viralScores.sympathy} icon="😢" />
                <ScoreBar label="โกรธ" value={viralScores.anger} icon="😡" />
                <ScoreBar label="ช็อค" value={viralScores.shock_value} icon="😱" />
                <ScoreBar label="อยากรู้" value={viralScores.curiosity} icon="🤔" />
                <ScoreBar label="ถกเถียง" value={viralScores.debate_potential} icon="⚡" />
                <ScoreBar label="แชร์ได้" value={viralScores.shareability} icon="🔄" />
                <ScoreBar label="คอมเมนต์" value={viralScores.comment_probability} icon="💬" />
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  <ScoreBar label="ไวรัลรวม" value={viralScores.viral_probability} icon="🔥" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
