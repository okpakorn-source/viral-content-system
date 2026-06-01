'use client';

import { useState, useCallback } from 'react';
import AuthGuard from '@/components/AuthGuard';
import ClientLayout from '@/components/ClientLayout';

// ===== Constants =====
const FILTER_MODES = [
  { key: 'soft', label: 'Soft 🟢', color: '#22c55e', desc: 'ตัดเฉพาะคำเฟ้อชัดเจน' },
  { key: 'balanced', label: 'Balanced 🟡', color: '#eab308', desc: 'สมดุลระหว่างเนื้อจริงและอารมณ์' },
  { key: 'strict', label: 'Strict 🔴', color: '#ef4444', desc: 'เหลือเฉพาะข้อเท็จจริงล้วน' },
];

const LABEL_COLORS = {
  FACT: '#22c55e',
  QUOTE: '#3b82f6',
  CONTEXT: '#64748b',
  FILLER: '#eab308',
  INTERPRETATION: '#f97316',
  EMOTIONAL_WRITING: '#ec4899',
  UNSUPPORTED: '#ef4444',
};

const LABEL_NAMES = {
  FACT: 'ข้อเท็จจริง',
  QUOTE: 'คำพูดโดยตรง',
  CONTEXT: 'บริบท',
  FILLER: 'คำเฟ้อ',
  INTERPRETATION: 'ตีความ',
  EMOTIONAL_WRITING: 'แต่งอารมณ์',
  UNSUPPORTED: 'ไม่มีที่มา',
};

const ACTION_CONFIG = {
  KEEP: { icon: '✅', color: '#22c55e', label: 'KEEP' },
  REMOVE: { icon: '❌', color: '#ef4444', label: 'REMOVE' },
  TRIM: { icon: '✂️', color: '#eab308', label: 'TRIM' },
};

const SAMPLE_TEXT = `มีนักแสดงไม่น้อยที่พอผลงานเบาลง ก็เลือกรอ รอโทรศัพท์ รอโอกาส รอให้วงการหันกลับมามอง แต่ แอมป์ พีรวัศ ไม่ได้ทำแบบนั้น

แอมป์ พีรวัศ อดีตพระเอกช่อง 7 เปิดเผยว่า หลังจากงานแสดงเบาลง ตัดสินใจไปขับ Grab เพื่อหารายได้เสริม โดยเริ่มขับตั้งแต่ช่วงโควิด

แอมป์เผยว่า "ผมไม่ได้อายนะครับ ขับ Grab มันก็คืองานสุจริต ได้เงินเลี้ยงครอบครัว"

ในรถคันนั้น เขาไม่ใช่พระเอก เขาแค่เป็นคนธรรมดาที่กำลังใช้ชีวิต

แอมป์เผยว่า หยุดขับ Grab แล้ว แต่ยังมีแอบไปขับอย่างอื่นบ้าง หลังไปส่งลูกที่โรงเรียน

เรื่องนี้สะท้อนให้เห็นว่า ความสำเร็จในวงการบันเทิงไม่ได้การันตีอนาคต

ปัจจุบัน แอมป์ พีรวัศ อายุ 45 ปี มีลูก 2 คน อาศัยอยู่กับครอบครัวที่กรุงเทพฯ

ชีวิตจริงไม่ได้รอใคร และบางทีความกล้าที่จะเริ่มต้นใหม่ก็คือเวอร์ชันที่ดีที่สุดของตัวเอง`;

// ===== Main Page Component =====
export default function NewsFilterPage() {
  return (
    <AuthGuard requireRole={['admin']}>
      <ClientLayout>
        <NewsFilterContent />
      </ClientLayout>
    </AuthGuard>
  );
}

// ===== Page Content =====
function NewsFilterContent() {
  // State
  const [inputText, setInputText] = useState('');
  const [outputData, setOutputData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('balanced');
  const [options, setOptions] = useState({
    keepQuotes: true,
    keepContext: true,
    removeEmotional: true,
    removeUnsupported: true,
    useAI: false,
  });
  const [expandedRows, setExpandedRows] = useState({});
  const [copySuccess, setCopySuccess] = useState(false);
  // URL scraping state
  const [scrapeLoading, setScrapeLoading] = useState(false);
  const [scrapeStep, setScrapeStep] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [autoFilter, setAutoFilter] = useState(true); // auto-filter after scrape

  // Word count helper
  const countWords = useCallback((text) => {
    if (!text || !text.trim()) return 0;
    return text.trim().split(/\s+/).filter(Boolean).length;
  }, []);

  const inputWordCount = countWords(inputText);

  // Toggle option
  const toggleOption = (key) => {
    setOptions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Toggle expanded row
  const toggleRow = (index) => {
    setExpandedRows(prev => ({ ...prev, [index]: !prev[index] }));
  };

  // Load sample text
  const loadSample = () => {
    setInputText(SAMPLE_TEXT);
    setOutputData(null);
    setError(null);
    setSourceUrl('');
  };

  // Clear all
  const handleClear = () => {
    setInputText('');
    setOutputData(null);
    setError(null);
    setExpandedRows({});
    setSourceUrl('');
    setScrapeStep('');
  };

  // URL Detection
  const detectedUrl = inputText.trim().match(/^https?:\/\/\S+$/)?.[0] || '';
  const hasUrlInInput = /https?:\/\/\S+/.test(inputText.trim());
  const isUrlOnly = !!detectedUrl;

  // === URL Scrape Handler ===
  const handleScrapeUrl = async (urlToScrape) => {
    const targetUrl = urlToScrape || detectedUrl;
    if (!targetUrl) return;

    setScrapeLoading(true);
    setScrapeStep('🔍 กำลังเชื่อมต่อ...');
    setError(null);
    setOutputData(null);
    setSourceUrl(targetUrl);

    try {
      // Step 1: Scrape raw content
      setScrapeStep('📡 กำลังดึงเนื้อหาจากเว็บ...');
      const scrapeRes = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });
      const scrapeData = await scrapeRes.json();

      if (!scrapeData.success && !scrapeData.data?.content) {
        throw new Error(scrapeData.error || 'ไม่สามารถดึงเนื้อหาจาก URL ได้');
      }

      // Step 2: Extract clean text from scraped content
      setScrapeStep('⚙️ กำลังแยกเนื้อหาข่าว...');
      const rawContent = scrapeData.data?.content || scrapeData.content || '';
      const rawTitle = scrapeData.data?.title || scrapeData.title || '';

      // Basic cleaning: remove navigation, ads, footer patterns
      let cleanedContent = rawContent
        .replace(/\[.*?\]/g, '') // remove markdown links
        .replace(/https?:\/\/\S+/g, '') // remove URLs
        .replace(/#{1,6}\s*/g, '') // remove markdown headers
        .replace(/\*{1,3}/g, '') // remove markdown bold/italic
        .replace(/\n{3,}/g, '\n\n') // normalize excessive newlines
        .replace(/^\s*[-•]\s*/gm, '') // remove bullet points
        .replace(/^\s*(Share|Tweet|Facebook|Instagram|Line|Copy link|อ่านเพิ่มเติม|ข่าวที่เกี่ยวข้อง|แท็ก|Tags|Related|Advertisement|โฆษณา|Sponsored).*$/gim, '') // remove social/nav
        .replace(/^\s*(Copyright|©|สงวนลิขสิทธิ์|เงื่อนไข|นโยบาย|Privacy|Terms).*$/gim, '') // remove footer
        .trim();

      // Add title at top if available
      const finalText = rawTitle 
        ? `${rawTitle}\n\n${cleanedContent}`
        : cleanedContent;

      if (finalText.length < 30) {
        throw new Error('เนื้อหาที่ดึงได้สั้นเกินไป ลองวาง URL อื่น');
      }

      setScrapeStep('✅ ดึงเนื้อหาสำเร็จ!');
      setInputText(finalText);

      // Step 3: Auto-filter if enabled
      if (autoFilter) {
        setScrapeStep('🔬 กำลังกรองเนื้อหาอัตโนมัติ...');
        // Small delay to show the text first
        await new Promise(r => setTimeout(r, 300));
        setScrapeLoading(false);
        // Trigger analysis
        await handleAnalyzeWithText(finalText);
      } else {
        setScrapeLoading(false);
      }

    } catch (err) {
      setError(`❌ ${err.message}`);
      setScrapeLoading(false);
      setScrapeStep('');
    }
  };

  // Analyze — calls POST /api/news-filter
  const doAnalyze = async (textToAnalyze) => {
    const text = textToAnalyze || inputText;
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setOutputData(null);
    setExpandedRows({});

    try {
      const res = await fetch('/api/news-filter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          mode,
          options: {
            keepQuotes: options.keepQuotes,
            keepContext: options.keepContext,
            removeEmotional: options.removeEmotional,
            removeUnsupported: options.removeUnsupported,
            useAI: options.useAI,
          },
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'เกิดข้อผิดพลาดในการวิเคราะห์');
      }
      setOutputData(data);
    } catch (err) {
      setError(err.message || 'ไม่สามารถเชื่อมต่อ API ได้');
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = () => doAnalyze(inputText);
  const handleAnalyzeWithText = (text) => doAnalyze(text);

  // Copy clean text
  const handleCopy = async () => {
    if (!outputData?.cleanText) return;
    try {
      await navigator.clipboard.writeText(outputData.cleanText);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = outputData.cleanText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  // Export TXT
  const handleExport = () => {
    if (!outputData?.cleanText) return;
    const blob = new Blob([outputData.cleanText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `news-filtered-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Computed stats
  const cleanWordCount = outputData ? countWords(outputData.cleanText) : 0;
  const removedPercent = inputWordCount > 0 && outputData
    ? Math.round(((inputWordCount - cleanWordCount) / inputWordCount) * 100)
    : 0;
  const mostRemovedPattern = outputData?.analysis
    ? (() => {
        const counts = {};
        outputData.analysis.forEach(s => {
          if (s.action === 'REMOVE' || s.action === 'TRIM') {
            counts[s.label] = (counts[s.label] || 0) + 1;
          }
        });
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        return sorted.length > 0 ? LABEL_NAMES[sorted[0][0]] || sorted[0][0] : '-';
      })()
    : '-';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      {/* Keyframes */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes dotBounce {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1); }
        }
      `}</style>

      {/* ===== HEADER ===== */}
      <div style={{
        padding: '28px 32px 20px',
        borderBottom: '1px solid var(--border)',
        background: 'linear-gradient(135deg, rgba(34,197,94,0.04), rgba(59,130,246,0.04))',
      }}>
        <div style={{ maxWidth: 1400, margin: '0 auto' }}>
          <h1 style={{
            margin: 0, fontSize: 26, fontWeight: 900,
            color: 'var(--text-primary)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            🔬 News Core Filter
          </h1>
          <p style={{
            margin: '6px 0 0', fontSize: 13,
            color: 'var(--text-muted)', lineHeight: 1.5,
          }}>
            วาง URL ข่าว หรือ ข้อความต้นฉบับ → ระบบดึงเนื้อ + กรองให้เหลือเฉพาะ &quot;เนื้อจริง&quot; ตัดคำเฟ้อ คำตีความ คำแต่งอารมณ์ออก
          </p>
        </div>
      </div>

      {/* ===== MAIN CONTENT ===== */}
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 32px 60px' }}>

        {/* 2-Column Layout */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 24,
          marginBottom: 24,
        }}>
          {/* ===== LEFT PANEL (Input) ===== */}
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: 16,
            border: '1px solid var(--border)',
            padding: 24,
            display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            {/* Panel Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <h2 style={{
                margin: 0, fontSize: 16, fontWeight: 800,
                color: 'var(--text-primary)',
              }}>
                📝 ข้อความต้นฉบับ / URL
              </h2>
              <button
                onClick={loadSample}
                style={{
                  padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)',
                  background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)',
                  fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                  e.currentTarget.style.color = 'var(--text-primary)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                  e.currentTarget.style.color = 'var(--text-muted)';
                }}
              >
                📰 ตัวอย่าง
              </button>
            </div>

            {/* URL Detection Bar */}
            {(isUrlOnly || scrapeLoading) && (
              <div style={{
                padding: '14px 16px', borderRadius: 12,
                background: scrapeLoading
                  ? 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(139,92,246,0.08))'
                  : 'linear-gradient(135deg, rgba(34,197,94,0.06), rgba(59,130,246,0.06))',
                border: `1px solid ${scrapeLoading ? 'rgba(59,130,246,0.25)' : 'rgba(34,197,94,0.2)'}`,
                transition: 'all 0.3s',
              }}>
                {scrapeLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 20, height: 20, border: '3px solid rgba(59,130,246,0.2)',
                      borderTopColor: '#3b82f6', borderRadius: '50%',
                      animation: 'spin 0.7s linear infinite',
                    }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#3b82f6' }}>
                        {scrapeStep}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                        {sourceUrl.slice(0, 60)}{sourceUrl.length > 60 ? '...' : ''}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 20 }}>🌐</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                          ตรวจพบ URL — พร้อมดึงเนื้อหา
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                          {detectedUrl.slice(0, 60)}{detectedUrl.length > 60 ? '...' : ''}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        fontSize: 10, color: 'var(--text-muted)', cursor: 'pointer',
                      }}>
                        <input
                          type="checkbox"
                          checked={autoFilter}
                          onChange={e => setAutoFilter(e.target.checked)}
                          style={{ accentColor: '#22c55e', width: 14, height: 14 }}
                        />
                        กรองอัตโนมัติ
                      </label>
                      <button
                        onClick={() => handleScrapeUrl()}
                        style={{
                          padding: '8px 18px', borderRadius: 10, border: 'none',
                          background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
                          color: '#fff', fontSize: 12, fontWeight: 700,
                          cursor: 'pointer', fontFamily: 'inherit',
                          boxShadow: '0 3px 10px rgba(59,130,246,0.3)',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                        onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                      >
                        📡 ดึงเนื้อหา
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Source URL indicator (after scrape) */}
            {sourceUrl && !scrapeLoading && !isUrlOnly && (
              <div style={{
                padding: '8px 12px', borderRadius: 8,
                background: 'rgba(34,197,94,0.06)',
                border: '1px solid rgba(34,197,94,0.15)',
                fontSize: 11, color: 'var(--text-muted)',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span>✅</span>
                <span>ดึงจาก: <strong style={{ color: '#22c55e' }}>{sourceUrl.slice(0, 70)}{sourceUrl.length > 70 ? '...' : ''}</strong></span>
              </div>
            )}

            {/* Textarea */}
            <textarea
              value={inputText}
              onChange={e => { setInputText(e.target.value); setSourceUrl(''); }}
              placeholder="วาง URL ข่าว หรือ ข้อความต้นฉบับที่นี่...&#10;&#10;ตัวอย่าง URL:&#10;https://www.thairath.co.th/news/...&#10;https://www.khaosod.co.th/...&#10;&#10;หรือวางข้อความข่าวยาวๆ ได้เลย"
              style={{
                width: '100%', minHeight: isUrlOnly ? 100 : 400, padding: 16,
                borderRadius: 12, border: '1px solid var(--border)',
                background: 'var(--bg-primary)', color: 'var(--text-primary)',
                fontSize: 14, lineHeight: 1.8, fontFamily: 'inherit',
                resize: 'vertical', outline: 'none',
                transition: 'all 0.3s',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />

            {/* Word count */}
            <div style={{
              fontSize: 11, color: 'var(--text-muted)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span>📊 จำนวนคำ: <strong style={{ color: 'var(--text-primary)' }}>{inputWordCount}</strong></span>
              <span>{inputText.length.toLocaleString()} ตัวอักษร</span>
            </div>

            {/* Filter Mode Selector */}
            <div>
              <div style={{
                fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
                marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
              }}>
                โหมดการกรอง
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {FILTER_MODES.map(m => (
                  <button
                    key={m.key}
                    onClick={() => setMode(m.key)}
                    style={{
                      flex: 1, padding: '10px 12px', borderRadius: 10,
                      border: mode === m.key
                        ? `2px solid ${m.color}`
                        : '2px solid transparent',
                      background: mode === m.key
                        ? `${m.color}15`
                        : 'rgba(255,255,255,0.04)',
                      color: mode === m.key ? m.color : 'var(--text-muted)',
                      fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      fontFamily: 'inherit', transition: 'all 0.2s',
                      textAlign: 'center',
                    }}
                  >
                    <div>{m.label}</div>
                    <div style={{ fontSize: 9, fontWeight: 500, marginTop: 2, opacity: 0.8 }}>
                      {m.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Options Checkboxes */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
            }}>
              {[
                { key: 'keepQuotes', label: 'Keep direct quotes', icon: '💬' },
                { key: 'keepContext', label: 'Keep necessary context', icon: '📎' },
                { key: 'removeEmotional', label: 'Remove emotional writing', icon: '🎭' },
                { key: 'removeUnsupported', label: 'Remove unsupported interpretation', icon: '⚠️' },
              ].map(opt => (
                <label
                  key={opt.key}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                    background: options[opt.key] ? 'rgba(34,197,94,0.06)' : 'transparent',
                    border: `1px solid ${options[opt.key] ? 'rgba(34,197,94,0.2)' : 'transparent'}`,
                    transition: 'all 0.2s',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={options[opt.key]}
                    onChange={() => toggleOption(opt.key)}
                    style={{ accentColor: '#22c55e', width: 16, height: 16 }}
                  />
                  <span style={{
                    fontSize: 11, color: options[opt.key] ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontWeight: 600,
                  }}>
                    {opt.icon} {opt.label}
                  </span>
                </label>
              ))}
            </div>

            {/* AI Toggle */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', borderRadius: 10,
              background: options.useAI
                ? 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.08))'
                : 'rgba(255,255,255,0.02)',
              border: `1px solid ${options.useAI ? 'rgba(99,102,241,0.3)' : 'var(--border)'}`,
              transition: 'all 0.3s',
            }}>
              <div>
                <div style={{
                  fontSize: 13, fontWeight: 700,
                  color: options.useAI ? '#818cf8' : 'var(--text-muted)',
                }}>
                  🤖 Use AI Analysis
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  ใช้ AI วิเคราะห์ความถูกต้องของข้อมูลเชิงลึก
                </div>
              </div>
              <button
                onClick={() => toggleOption('useAI')}
                style={{
                  width: 48, height: 26, borderRadius: 13, border: 'none',
                  background: options.useAI
                    ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                    : 'rgba(255,255,255,0.1)',
                  cursor: 'pointer', position: 'relative',
                  transition: 'background 0.3s',
                }}
              >
                <div style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: '#fff', position: 'absolute',
                  top: 3,
                  left: options.useAI ? 25 : 3,
                  transition: 'left 0.3s',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                }} />
              </button>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 10 }}>
              {isUrlOnly ? (
                <button
                  onClick={() => handleScrapeUrl()}
                  disabled={scrapeLoading}
                  style={{
                    flex: 1, padding: '14px 0', borderRadius: 12, border: 'none',
                    background: scrapeLoading
                      ? 'rgba(59,130,246,0.2)'
                      : 'linear-gradient(135deg, #3b82f6, #6366f1)',
                    color: '#fff', fontSize: 15, fontWeight: 800,
                    cursor: scrapeLoading ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', transition: 'all 0.2s',
                    boxShadow: scrapeLoading ? 'none' : '0 4px 15px rgba(59,130,246,0.3)',
                    opacity: scrapeLoading ? 0.6 : 1,
                  }}
                >
                  {scrapeLoading ? '⏳ กำลังดึงเนื้อหา...' : '📡 ดึงเนื้อหา + กรอง'}
                </button>
              ) : (
                <button
                  onClick={handleAnalyze}
                  disabled={loading || !inputText.trim()}
                  style={{
                    flex: 1, padding: '14px 0', borderRadius: 12, border: 'none',
                    background: loading || !inputText.trim()
                      ? 'rgba(34,197,94,0.2)'
                      : 'linear-gradient(135deg, #22c55e, #16a34a)',
                    color: '#fff', fontSize: 15, fontWeight: 800,
                    cursor: loading || !inputText.trim() ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', transition: 'all 0.2s',
                    boxShadow: loading || !inputText.trim()
                      ? 'none'
                      : '0 4px 15px rgba(34,197,94,0.3)',
                    opacity: loading || !inputText.trim() ? 0.6 : 1,
                  }}
                >
                  {loading ? '⏳ กำลังวิเคราะห์...' : '🔬 วิเคราะห์'}
                </button>
              )}
              <button
                onClick={handleClear}
                style={{
                  padding: '14px 24px', borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)',
                  fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  fontFamily: 'inherit', transition: 'all 0.2s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(239,68,68,0.1)';
                  e.currentTarget.style.color = '#ef4444';
                  e.currentTarget.style.borderColor = 'rgba(239,68,68,0.3)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                  e.currentTarget.style.color = 'var(--text-muted)';
                  e.currentTarget.style.borderColor = 'var(--border)';
                }}
              >
                🗑️ ล้าง
              </button>
            </div>
          </div>

          {/* ===== RIGHT PANEL (Output) ===== */}
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: 16,
            border: '1px solid var(--border)',
            padding: 24,
            display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            {/* Panel Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <h2 style={{
                margin: 0, fontSize: 16, fontWeight: 800,
                color: 'var(--text-primary)',
              }}>
                ✨ Clean News Core
              </h2>
              {outputData && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={handleCopy}
                    style={{
                      padding: '5px 12px', borderRadius: 8, border: 'none',
                      background: copySuccess ? 'rgba(34,197,94,0.15)' : 'rgba(59,130,246,0.1)',
                      color: copySuccess ? '#22c55e' : '#3b82f6',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      fontFamily: 'inherit', transition: 'all 0.2s',
                    }}
                  >
                    {copySuccess ? '✅ คัดลอกแล้ว!' : '📋 Copy'}
                  </button>
                  <button
                    onClick={handleExport}
                    style={{
                      padding: '5px 12px', borderRadius: 8, border: 'none',
                      background: 'rgba(139,92,246,0.1)', color: '#8b5cf6',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      fontFamily: 'inherit', transition: 'all 0.2s',
                    }}
                  >
                    📄 Export
                  </button>
                </div>
              )}
            </div>

            {/* Output Display */}
            {loading ? (
              /* Loading State */
              <div style={{
                minHeight: 400, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 16,
              }}>
                <div style={{
                  width: 56, height: 56, border: '4px solid var(--border)',
                  borderTopColor: '#22c55e', borderRadius: '50%',
                  animation: 'spin 0.7s linear infinite',
                }} />
                <div style={{
                  fontSize: 15, fontWeight: 700, color: 'var(--text-primary)',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  🔬 กำลังวิเคราะห์เนื้อหา
                  <span style={{ display: 'inline-flex', gap: 3, marginLeft: 4 }}>
                    {[0, 1, 2].map(i => (
                      <span key={i} style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: '#22c55e', display: 'inline-block',
                        animation: `dotBounce 1.4s ${i * 0.16}s infinite ease-in-out both`,
                      }} />
                    ))}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {options.useAI ? 'AI กำลังวิเคราะห์เชิงลึก...' : 'กำลังประมวลผลข้อความ...'}
                </div>
              </div>
            ) : outputData ? (
              /* Result Display */
              <div style={{
                minHeight: 400, padding: 16, borderRadius: 12,
                background: 'var(--bg-primary)', border: '1px solid var(--border)',
                overflow: 'auto',
              }}>
                <div style={{
                  whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.8,
                  color: 'var(--text-primary)', fontFamily: 'inherit',
                }}>
                  {outputData.cleanText}
                </div>
              </div>
            ) : (
              /* Empty State */
              <div style={{
                minHeight: 400, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 12,
                borderRadius: 12, border: '2px dashed var(--border)',
                background: 'rgba(255,255,255,0.01)',
              }}>
                <div style={{ fontSize: 48, opacity: 0.3 }}>🔬</div>
                <div style={{
                  fontSize: 14, fontWeight: 600, color: 'var(--text-muted)',
                }}>
                  วิเคราะห์ข่าวเพื่อดูผลลัพธ์
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.6 }}>
                  วางข้อความแล้วกด &quot;วิเคราะห์&quot;
                </div>
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div style={{
                padding: '12px 16px', borderRadius: 10,
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.25)',
                color: '#ef4444', fontSize: 13, fontWeight: 600,
              }}>
                ⚠️ {error}
              </div>
            )}

            {/* Bottom Action Buttons */}
            {outputData && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleCopy}
                  style={{
                    flex: 1, padding: '11px 0', borderRadius: 10,
                    border: 'none',
                    background: copySuccess
                      ? 'rgba(34,197,94,0.15)'
                      : 'rgba(59,130,246,0.1)',
                    color: copySuccess ? '#22c55e' : '#3b82f6',
                    fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    fontFamily: 'inherit', transition: 'all 0.2s',
                  }}
                >
                  {copySuccess ? '✅ คัดลอกแล้ว!' : '📋 Copy'}
                </button>
                <button
                  onClick={handleExport}
                  style={{
                    flex: 1, padding: '11px 0', borderRadius: 10,
                    border: 'none', background: 'rgba(139,92,246,0.1)',
                    color: '#8b5cf6', fontSize: 13, fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s',
                  }}
                >
                  📄 Export TXT
                </button>
                <button
                  onClick={() => alert('ฟีเจอร์นี้กำลังพัฒนา')}
                  style={{
                    flex: 1, padding: '11px 0', borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'rgba(255,255,255,0.04)',
                    color: 'var(--text-muted)', fontSize: 13, fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s',
                  }}
                >
                  📤 ส่งเข้า Workflow
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ===== SUMMARY STATS ===== */}
        {outputData && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 16, marginBottom: 24,
            animation: 'fadeUp 0.4s ease-out both',
          }}>
            {/* Original words */}
            <StatCard
              icon="📝"
              label="คำต้นฉบับ"
              value={inputWordCount.toLocaleString()}
              color="#3b82f6"
            />
            {/* Clean words */}
            <StatCard
              icon="✨"
              label="คำหลังกรอง"
              value={cleanWordCount.toLocaleString()}
              color="#22c55e"
            />
            {/* Removed percent */}
            <StatCard
              icon="✂️"
              label="ตัดออก %"
              value={`${removedPercent}%`}
              color={removedPercent > 50 ? '#ef4444' : '#eab308'}
              highlight={removedPercent > 50}
            />
            {/* Most removed pattern */}
            <StatCard
              icon="🏷️"
              label="ประเภทที่ตัดมากสุด"
              value={mostRemovedPattern}
              color="#f97316"
            />
          </div>
        )}

        {/* ===== ANALYSIS PANEL ===== */}
        {outputData?.analysis && outputData.analysis.length > 0 && (
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: 16,
            border: '1px solid var(--border)',
            overflow: 'hidden',
            animation: 'fadeUp 0.5s ease-out both',
          }}>
            {/* Panel Header */}
            <div style={{
              padding: '18px 24px',
              borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <h2 style={{
                margin: 0, fontSize: 16, fontWeight: 800,
                color: 'var(--text-primary)',
              }}>
                📊 การวิเคราะห์รายประโยค
              </h2>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {outputData.analysis.length} ประโยค
              </span>
            </div>

            {/* Sentence Rows */}
            <div>
              {outputData.analysis.map((sentence, idx) => (
                <SentenceRow
                  key={idx}
                  sentence={sentence}
                  index={idx}
                  expanded={!!expandedRows[idx]}
                  onToggle={() => toggleRow(idx)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Stat Card Component =====
function StatCard({ icon, label, value, color, highlight }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      borderRadius: 14,
      border: `1px solid ${highlight ? `${color}40` : 'var(--border)'}`,
      padding: '20px 18px',
      display: 'flex', flexDirection: 'column', gap: 6,
      position: 'relative', overflow: 'hidden',
    }}>
      {highlight && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 3,
          background: color,
        }} />
      )}
      <div style={{
        fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span>{icon}</span>
        {label}
      </div>
      <div style={{
        fontSize: 26, fontWeight: 900, color,
        lineHeight: 1,
      }}>
        {value}
      </div>
    </div>
  );
}

// ===== Sentence Row Component =====
function SentenceRow({ sentence, index, expanded, onToggle }) {
  const labelColor = LABEL_COLORS[sentence.label] || '#64748b';
  const actionCfg = ACTION_CONFIG[sentence.action] || ACTION_CONFIG.KEEP;
  const isRemoved = sentence.action === 'REMOVE';

  return (
    <div style={{
      borderBottom: '1px solid var(--border)',
      transition: 'background 0.2s',
    }}>
      {/* Main Row */}
      <div
        onClick={onToggle}
        style={{
          padding: '14px 24px',
          display: 'flex', alignItems: 'center', gap: 12,
          cursor: 'pointer',
          background: expanded ? 'rgba(255,255,255,0.02)' : 'transparent',
          transition: 'background 0.2s',
        }}
        onMouseEnter={e => {
          if (!expanded) e.currentTarget.style.background = 'rgba(255,255,255,0.015)';
        }}
        onMouseLeave={e => {
          if (!expanded) e.currentTarget.style.background = 'transparent';
        }}
      >
        {/* Index */}
        <span style={{
          fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
          minWidth: 20, textAlign: 'center',
        }}>
          {index + 1}
        </span>

        {/* Label Badge */}
        <span style={{
          fontSize: 9, fontWeight: 800, padding: '3px 10px',
          borderRadius: 20, whiteSpace: 'nowrap',
          color: labelColor,
          background: `${labelColor}15`,
          border: `1px solid ${labelColor}30`,
          letterSpacing: 0.3,
        }}>
          {sentence.label}
        </span>

        {/* Sentence Text */}
        <span style={{
          flex: 1, fontSize: 13, lineHeight: 1.5,
          color: isRemoved ? 'var(--text-muted)' : 'var(--text-primary)',
          textDecoration: isRemoved ? 'line-through' : 'none',
          opacity: isRemoved ? 0.6 : 1,
          overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitLineClamp: expanded ? 'unset' : 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {sentence.text}
        </span>

        {/* Action Badge */}
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '3px 10px',
          borderRadius: 8, whiteSpace: 'nowrap',
          color: actionCfg.color,
          background: `${actionCfg.color}12`,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          {actionCfg.icon} {actionCfg.label}
        </span>

        {/* Reason */}
        {sentence.reason && (
          <span style={{
            fontSize: 10, color: 'var(--text-muted)',
            maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {sentence.reason}
          </span>
        )}

        {/* Expand icon */}
        <span style={{
          fontSize: 10, color: 'var(--text-muted)',
          transition: 'transform 0.2s',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          flexShrink: 0,
        }}>
          ▼
        </span>
      </div>

      {/* Expanded Detail */}
      {expanded && (
        <div style={{
          padding: '0 24px 16px 56px',
          animation: 'fadeUp 0.2s ease-out',
        }}>
          {/* Reason full */}
          {sentence.reason && (
            <div style={{
              fontSize: 12, color: 'var(--text-secondary)',
              marginBottom: 12, lineHeight: 1.5,
              padding: '8px 12px', borderRadius: 8,
              background: 'rgba(255,255,255,0.02)',
              borderLeft: `3px solid ${labelColor}`,
            }}>
              💡 {sentence.reason}
            </div>
          )}

          {/* Score Bars */}
          {sentence.scores && (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '8px 24px',
            }}>
              {[
                { key: 'factual', label: 'ข้อเท็จจริง', color: '#22c55e' },
                { key: 'filler', label: 'คำเฟ้อ', color: '#eab308' },
                { key: 'emotional', label: 'อารมณ์', color: '#ec4899' },
                { key: 'unsupported', label: 'ไม่มีที่มา', color: '#ef4444' },
              ].map(s => {
                const val = sentence.scores[s.key] ?? 0;
                return (
                  <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 10, color: 'var(--text-muted)',
                      minWidth: 70, textAlign: 'right',
                    }}>
                      {s.label}
                    </span>
                    <div style={{
                      flex: 1, height: 6, borderRadius: 3,
                      background: 'rgba(255,255,255,0.06)',
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%', borderRadius: 3,
                        width: `${Math.min(val * 100, 100)}%`,
                        background: s.color,
                        transition: 'width 0.4s ease-out',
                      }} />
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: s.color,
                      minWidth: 30,
                    }}>
                      {Math.round(val * 100)}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
