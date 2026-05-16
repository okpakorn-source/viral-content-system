'use client';

import { useState } from 'react';
import Header from '@/components/layout/Header';

const SOURCE_TYPES = [
  { value: 'url', label: '🔗 URL ข่าว/เว็บไซต์', desc: 'วางลิงก์ข่าว, บทความ, โพสต์' },
  { value: 'raw', label: '📝 ข้อความ', desc: 'วางข้อความหรือพิมพ์เอง' },
  { value: 'facebook', label: '📘 Facebook', desc: 'วาง URL โพสต์ Facebook', disabled: true },
  { value: 'tiktok', label: '🎵 TikTok', desc: 'วาง URL วิดีโอ TikTok', disabled: true },
  { value: 'youtube', label: '📺 YouTube', desc: 'ดึง transcript จาก YouTube', disabled: true },
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
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState('input'); // input, analyzed, angles, article

  // === สร้างคอนเทนต์ ===
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const payload = sourceType === 'url'
        ? { type: 'url', url, autoAnalyze: true }
        : { type: 'raw', rawContent: rawText, autoAnalyze: true };

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
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
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
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setResult(prev => ({ ...prev, article: data.data }));
      setStep('article');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Parse scores
  const viralScores = result?.analysis?.viral_scores || (result?.data?.viralScores ? JSON.parse(result.data.viralScores) : null);
  const emotionalAnalysis = result?.analysis?.emotional_analysis || (result?.data?.emotionalAnalysis ? JSON.parse(result.data.emotionalAnalysis) : null);

  return (
    <>
      <Header title="✨ สร้างคอนเทนต์ใหม่" subtitle="ป้อนแหล่งข้อมูล → AI วิเคราะห์ → สร้างบทความไวรัล" />

      <div className="page-content">
        {/* Loading Overlay */}
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

        {/* Error */}
        {error && (
          <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', padding: '14px 20px', marginBottom: 20, color: 'var(--danger)', fontSize: 13 }}>
            ❌ {error}
            <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontWeight: 700 }}>✕</button>
          </div>
        )}

        {/* Pipeline Progress */}
        <div className="pipeline" style={{ marginBottom: 24 }}>
          {['ป้อนข้อมูล', 'วิเคราะห์', 'มุมมองไวรัล', 'บทความ'].map((label, i) => {
            const steps = ['input', 'analyzed', 'angles', 'article'];
            const currentIdx = steps.indexOf(step);
            const status = i < currentIdx ? 'done' : i === currentIdx ? 'active' : '';
            return (
              <span key={i} style={{ display: 'contents' }}>
                <div className={`pipeline-step ${status}`}>{i + 1}. {label}</div>
                {i < 3 && <span className="pipeline-arrow">→</span>}
              </span>
            );
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: step !== 'input' ? '1fr 380px' : '1fr', gap: 24 }}>
          {/* Left Column — Main Content */}
          <div>
            {/* STEP 1: Input */}
            {step === 'input' && (
              <div className="card slide-up">
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>📥 เลือกแหล่งข้อมูล</h3>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 24 }}>
                  {SOURCE_TYPES.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => !s.disabled && setSourceType(s.value)}
                      disabled={s.disabled}
                      style={{
                        padding: '14px 16px',
                        background: sourceType === s.value ? 'var(--accent-glow)' : 'var(--bg-primary)',
                        border: `1px solid ${sourceType === s.value ? 'var(--accent)' : 'var(--border)'}`,
                        borderRadius: 'var(--radius-md)',
                        color: s.disabled ? 'var(--text-muted)' : 'var(--text-primary)',
                        cursor: s.disabled ? 'not-allowed' : 'pointer',
                        textAlign: 'left',
                        fontFamily: 'inherit',
                        opacity: s.disabled ? 0.5 : 1,
                        transition: 'all var(--transition)',
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{s.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.desc}</div>
                      {s.disabled && <div style={{ fontSize: 10, color: 'var(--warning)', marginTop: 4 }}>เร็วๆ นี้</div>}
                    </button>
                  ))}
                </div>

                <form onSubmit={handleSubmit}>
                  {sourceType === 'url' ? (
                    <div className="form-group">
                      <label className="form-label">🔗 URL</label>
                      <input
                        type="url"
                        className="form-input"
                        placeholder="https://www.example.com/news/..."
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        required
                      />
                    </div>
                  ) : (
                    <div className="form-group">
                      <label className="form-label">📝 เนื้อหา</label>
                      <textarea
                        className="form-textarea"
                        placeholder="วางข้อความข่าว, โพสต์, หรือเรื่องราวที่ต้องการสร้างคอนเทนต์..."
                        value={rawText}
                        onChange={(e) => setRawText(e.target.value)}
                        required
                        style={{ minHeight: 200 }}
                      />
                    </div>
                  )}

                  <button type="submit" className="btn btn-viral btn-lg" style={{ width: '100%' }} disabled={loading}>
                    🚀 เริ่มวิเคราะห์ด้วย AI
                  </button>
                </form>
              </div>
            )}

            {/* STEP 2: Analysis Results + Angles */}
            {step === 'analyzed' && viralScores && (
              <div className="card slide-up">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700 }}>✅ วิเคราะห์สำเร็จ</h3>
                  <span className={`score-badge ${viralScores.viral_probability >= 70 ? 'viral' : viralScores.viral_probability >= 40 ? 'medium' : 'low'}`} style={{ fontSize: 16, padding: '6px 16px' }}>
                    🔥 {viralScores.viral_probability}%
                  </span>
                </div>

                {/* Summary */}
                {result.analysis?.summary && (
                  <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 20, fontSize: 14, lineHeight: 1.8 }}>
                    {result.analysis.summary}
                  </div>
                )}

                {/* Emotional Analysis */}
                {emotionalAnalysis && (
                  <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 20 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>🎭 การวิเคราะห์อารมณ์</div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 2 }}>
                      <div>อารมณ์หลัก: <strong style={{ color: 'var(--accent-light)' }}>{emotionalAnalysis.primary_emotion}</strong></div>
                      <div>กลุ่มเป้าหมาย: <strong>{result.analysis?.target_audience || '-'}</strong></div>
                      <div>มุมที่แนะนำ: <strong>{result.analysis?.recommended_angle || '-'}</strong></div>
                    </div>
                  </div>
                )}

                <button onClick={handleGenerateAngles} className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading}>
                  🎯 สร้างมุมมองไวรัล (Headlines & Hooks)
                </button>
              </div>
            )}

            {/* STEP 3: Angles — เลือก Headline/Hook */}
            {step === 'angles' && result?.angles && (
              <div className="card slide-up">
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>🎯 มุมมองไวรัล</h3>

                {/* Headlines */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>📰 หัวข้อ (เลือก 1 ข้อ แล้วกดสร้างบทความ)</div>
                  {JSON.parse(result.angles.headlines).map((h, i) => (
                    <button
                      key={i}
                      onClick={() => handleGenerateArticle(i, 0, 'emotional')}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '12px 16px', marginBottom: 8,
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
                        transition: 'all var(--transition)',
                      }}
                      onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                      onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                    >
                      <span style={{ color: 'var(--text-muted)', marginRight: 8 }}>#{i + 1}</span>
                      {h}
                    </button>
                  ))}
                </div>

                {/* Comment Baits */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>💬 ตอนจบกระตุ้นคอมเมนต์</div>
                  {JSON.parse(result.angles.commentBaits).map((cb, i) => (
                    <div key={i} style={{ padding: '8px 12px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', marginBottom: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                      💬 {cb}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* STEP 4: Article Preview */}
            {step === 'article' && result?.article && (
              <div className="card slide-up">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700 }}>✍️ บทความที่สร้าง</h3>
                  <span className="status-badge approved" style={{ textTransform: 'none' }}>Variant {result.article.variant}</span>
                </div>

                <div style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', padding: 28, border: '1px solid var(--border)' }}>
                  <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8, lineHeight: 1.5 }}>
                    {result.article.headline}
                  </h2>
                  {result.article.hook && (
                    <div style={{ fontSize: 14, color: 'var(--accent-light)', fontStyle: 'italic', marginBottom: 20 }}>
                      {result.article.hook}
                    </div>
                  )}
                  <div style={{ fontSize: 15, lineHeight: 2, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                    {result.article.body}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
                  <button onClick={() => handleGenerateArticle(0, 0, 'dramatic')} className="btn btn-outline btn-sm">🎭 สร้างแบบดราม่า</button>
                  <button onClick={() => handleGenerateArticle(0, 0, 'concise')} className="btn btn-outline btn-sm">⚡ สร้างแบบกระชับ</button>
                  <button onClick={() => handleGenerateArticle(0, 0, 'controversial')} className="btn btn-outline btn-sm">🔥 สร้างแบบถกเถียง</button>
                  <button className="btn btn-primary btn-sm" onClick={() => alert('ส่งไปรีวิว!')}>✅ ส่งไปรีวิว</button>
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
