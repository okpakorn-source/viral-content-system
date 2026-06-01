'use client';
import { useState } from 'react';
import Header from '@/components/layout/Header';

// ═══ Styles ═══
const s = {
  card: { background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 14, marginBottom: 16 },
  head: { fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 },
  body: { padding: 18 },
  input: {
    width: '100%', padding: '12px 16px', borderRadius: 10,
    border: '1px solid var(--border)', background: 'var(--bg-primary)',
    color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit',
    boxSizing: 'border-box', outline: 'none',
  },
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 },
};

export default function CoverTesterPage() {
  const [inputMode, setInputMode] = useState('url'); // 'url' or 'manual'
  const [newsUrl, setNewsUrl] = useState('');
  const [newsTitle, setNewsTitle] = useState('');
  const [coreStory, setCoreStory] = useState('');
  const [keyPeople, setKeyPeople] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [resultImage, setResultImage] = useState(null);
  const [resultTitle, setResultTitle] = useState('');
  const [elapsed, setElapsed] = useState(null);
  const [logs, setLogs] = useState([]);
  const [downloaded, setDownloaded] = useState(false);

  const handleGenerate = async (e) => {
    if (e) e.preventDefault();
    
    if (inputMode === 'url' && !newsUrl.trim()) return;
    if (inputMode === 'manual' && !newsTitle.trim()) return;

    setLoading(true);
    setError(null);
    setResultImage(null);
    setResultTitle('');
    setElapsed(null);
    setLogs([]);
    setDownloaded(false);
    const t0 = Date.now();

    try {
      const body = inputMode === 'url'
        ? { url: newsUrl.trim() }
        : {
            newsTitle: newsTitle.trim(),
            breakdownData: {
              core_story: coreStory,
              key_facts: {
                people: keyPeople.split(',').map(p => p.trim()).filter(Boolean)
              }
            }
          };

      const res = await fetch('/api/cover-tester', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      if (data.logs) setLogs(data.logs);
      
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to generate cover');
      }

      setResultImage(data.base64);
      if (data.newsTitle) setResultTitle(data.newsTitle);
      setElapsed(((Date.now() - t0) / 1000).toFixed(1));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const download = (b64) => {
    const a = document.createElement('a');
    a.href = b64;
    a.download = `cover_${Date.now()}.jpg`;
    a.click();
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 2500);
  };

  const canGenerate = inputMode === 'url'
    ? newsUrl.trim().length > 5 && !loading
    : newsTitle.trim().length > 0 && !loading;

  return (
    <>
      <Header title="🎨 Cover Tester" subtitle="ทดสอบระบบสร้างปกข่าว — วาง URL ข่าว หรือใส่หัวข้อด้วยมือ ให้บอทค้นหาภาพอัตโนมัติ" />
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '0 16px 60px' }}>

        {/* Row: Input + Result */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>

          {/* ① Input Form */}
          <div style={s.card}>
            <div style={s.head}>
              ① ใส่ข้อมูลข่าว
              <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                {inputMode === 'url' ? '🔗 URL Mode' : '✏️ Manual Mode'}
              </span>
            </div>
            <div style={s.body}>

              {/* Mode Toggle */}
              <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
                <button
                  onClick={() => setInputMode('url')}
                  style={{
                    flex: 1, padding: '10px', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    fontWeight: 700, fontSize: 12,
                    background: inputMode === 'url' ? 'rgba(163,230,53,0.15)' : 'var(--bg-primary)',
                    color: inputMode === 'url' ? '#a3e635' : 'var(--text-muted)',
                    borderRight: '1px solid var(--border)',
                    transition: 'all .15s',
                  }}
                >
                  🔗 วาง URL ข่าว
                </button>
                <button
                  onClick={() => setInputMode('manual')}
                  style={{
                    flex: 1, padding: '10px', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    fontWeight: 700, fontSize: 12,
                    background: inputMode === 'manual' ? 'rgba(163,230,53,0.15)' : 'var(--bg-primary)',
                    color: inputMode === 'manual' ? '#a3e635' : 'var(--text-muted)',
                    transition: 'all .15s',
                  }}
                >
                  ✏️ พิมพ์หัวข้อเอง
                </button>
              </div>

              <form onSubmit={handleGenerate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                
                {/* URL Mode */}
                {inputMode === 'url' && (
                  <div>
                    <label style={s.label}>🔗 URL ข่าว *</label>
                    <input
                      type="url"
                      required
                      value={newsUrl}
                      onChange={e => setNewsUrl(e.target.value)}
                      placeholder="วาง URL ข่าว เช่น https://www.thairath.co.th/news/..."
                      style={{ ...s.input, borderColor: newsUrl ? 'rgba(163,230,53,0.4)' : undefined }}
                    />
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                      รองรับ: เว็บข่าวทั่วไป, YouTube, TikTok, Facebook
                    </div>
                  </div>
                )}

                {/* Manual Mode */}
                {inputMode === 'manual' && (
                  <>
                    <div>
                      <label style={s.label}>หัวข้อข่าว *</label>
                      <input
                        type="text"
                        required
                        value={newsTitle}
                        onChange={e => setNewsTitle(e.target.value)}
                        placeholder="เช่น แม่ค้าลูกชิ้นทอด ยืนขายกลางสายฝน ลูกเล็กนั่งรอข้างทาง"
                        style={s.input}
                      />
                    </div>

                    <div>
                      <label style={s.label}>แก่นเรื่อง / บริบท (ไม่บังคับ)</label>
                      <textarea
                        value={coreStory}
                        onChange={e => setCoreStory(e.target.value)}
                        placeholder="อธิบายเรื่องราวคร่าวๆ..."
                        style={{ ...s.input, minHeight: 70, resize: 'vertical', lineHeight: 1.6 }}
                      />
                    </div>

                    <div>
                      <label style={s.label}>บุคคลสำคัญ / คำค้นภาพ (ไม่บังคับ, คั่นด้วย comma)</label>
                      <input
                        type="text"
                        value={keyPeople}
                        onChange={e => setKeyPeople(e.target.value)}
                        placeholder="เช่น แม่ค้าลูกชิ้น, ลูกน้อย, ฝนตก"
                        style={s.input}
                      />
                    </div>
                  </>
                )}

                <button
                  type="submit"
                  disabled={!canGenerate}
                  style={{
                    width: '100%', padding: '16px', borderRadius: 12, border: 'none',
                    background: canGenerate ? 'linear-gradient(135deg, #a3e635, #059669)' : 'var(--bg-elevated)',
                    color: canGenerate ? '#000' : 'var(--text-muted)',
                    fontWeight: 900, fontSize: 15, cursor: canGenerate ? 'pointer' : 'not-allowed',
                    fontFamily: 'inherit', transition: 'all .2s',
                    boxShadow: canGenerate ? '0 6px 25px rgba(163,230,53,0.25)' : 'none',
                  }}
                >
                  {loading
                    ? (inputMode === 'url' ? '⏳ กำลังดึงข่าว + ค้นหาภาพ + สร้างปก...' : '⏳ กำลังค้นหาภาพและสร้างปก...')
                    : '🎨 สร้างปกข่าว Editorial'
                  }
                </button>
              </form>

              {/* Steps Explanation */}
              <div style={{ marginTop: 14, padding: '12px 14px', background: 'rgba(163,230,53,0.04)', borderRadius: 10, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.8 }}>
                💡 <strong style={{ color: 'var(--text-secondary)' }}>ขั้นตอน{inputMode === 'url' ? ' (URL Mode)' : ''}:</strong><br />
                {inputMode === 'url' ? (
                  <>
                    1. ดึงเนื้อหาจาก URL → AI สกัดหัวข้อ + วิเคราะห์มุมข่าว<br />
                    2. Bot ค้นหาภาพจริงจาก Google / เว็บข่าว (ไม่ Generate ภาพปลอม)<br />
                    3. Sharp.js ครอป + จัดวาง Layout 2×2 + วงกลมกลาง<br />
                    4. แสดงผลปก 1080×1080 พร้อมดาวน์โหลด
                  </>
                ) : (
                  <>
                    1. AI วิเคราะห์หัวข้อข่าว → หาคำค้นภาพที่เหมาะสม<br />
                    2. Bot ค้นหาภาพจริงจาก Google / เว็บข่าว (ไม่ Generate ภาพปลอม)<br />
                    3. Sharp.js ครอป + จัดวาง Layout 2×2 + วงกลมกลาง<br />
                    4. แสดงผลปก 1080×1080 พร้อมดาวน์โหลด
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ② Result */}
          <div style={s.card}>
            <div style={s.head}>
              ② ผลลัพธ์ (1080×1080)
              {elapsed && (
                <span style={{ fontSize: 10, fontWeight: 400, color: '#a3e635', marginLeft: 'auto' }}>⏱ {elapsed}s</span>
              )}
            </div>
            <div style={{ ...s.body, display: 'flex', flexDirection: 'column', gap: 12 }}>
              
              {/* Extracted Title */}
              {resultTitle && (
                <div style={{ padding: '10px 14px', background: 'rgba(163,230,53,0.06)', borderRadius: 10, fontSize: 12, color: '#a3e635', fontWeight: 700 }}>
                  📰 {resultTitle}
                </div>
              )}

              {/* Error */}
              {error && (
                <div style={{ padding: '14px 18px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 12, fontSize: 13, color: '#fca5a5', lineHeight: 1.6 }}>
                  ❌ {error}
                </div>
              )}

              {/* Preview Area */}
              <div style={{
                minHeight: 380, borderRadius: 12,
                border: resultImage ? '2px solid #a3e635' : '2px dashed rgba(255,255,255,0.08)',
                background: 'var(--bg-primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', position: 'relative',
              }}>
                {loading && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--text-muted)' }}>
                    <div style={{
                      width: 44, height: 44, border: '3px solid var(--border)', borderTopColor: '#a3e635',
                      borderRadius: '50%', animation: 'spin 1s linear infinite',
                    }} />
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {inputMode === 'url' ? 'กำลังดึงข่าว + วิเคราะห์ + สร้างปก...' : 'กำลังค้นหาภาพและสร้างปก...'}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {inputMode === 'url' ? 'อาจใช้เวลา 30-90 วินาที' : 'อาจใช้เวลา 15-45 วินาที'}
                    </div>
                  </div>
                )}

                {!loading && !resultImage && !error && (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: 40, marginBottom: 8, opacity: 0.3 }}>🖼️</div>
                    <div style={{ fontSize: 12 }}>ภาพปกจะแสดงที่นี่</div>
                  </div>
                )}

                {resultImage && !loading && (
                  <img
                    src={resultImage}
                    alt="Generated Editorial Cover"
                    style={{ width: '100%', height: 'auto', display: 'block' }}
                  />
                )}
              </div>

              {/* Action Buttons */}
              {resultImage && !loading && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => download(resultImage)}
                    style={{
                      flex: 1, padding: '12px', borderRadius: 10, border: 'none',
                      background: 'linear-gradient(135deg, #a3e635, #16a34a)',
                      color: '#000', fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {downloaded ? '✅ ดาวน์โหลดแล้ว' : '📥 ดาวน์โหลดภาพ'}
                  </button>
                  <button
                    onClick={handleGenerate}
                    style={{
                      padding: '12px 20px', borderRadius: 10,
                      border: '1px solid rgba(163,230,53,0.3)',
                      background: 'rgba(163,230,53,0.06)', color: '#a3e635',
                      fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    🔄 สร้างใหม่
                  </button>
                </div>
              )}

              {/* Logs */}
              {logs.length > 0 && (
                <div style={{ padding: '12px 14px', background: 'var(--bg-primary)', borderRadius: 10, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>📋 Pipeline Logs</div>
                  {logs.map((log, i) => (
                    <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.8, fontFamily: 'monospace' }}>
                      {log}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>

      </div>

      {/* Spinner animation */}
      <style jsx>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
