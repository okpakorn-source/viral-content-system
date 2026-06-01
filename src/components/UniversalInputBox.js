'use client';
import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * UniversalInputBox — Auto Mode Universal Input Component
 * ─────────────────────────────────────────────────────
 * รองรับ:
 *  - Paste URL (TikTok, YouTube, Facebook, article, multiple)
 *  - Type / paste plain text
 *  - Paste image (Ctrl+V)
 *  - Drag & drop image
 *  - Upload multiple images
 *  - Mixed input (URL + image, text + image)
 *
 * Props:
 *  onDetect(detection, route)   — called when detection updates
 *  onSubmit(input, images)      — called when user submits
 *  loading: bool
 *  disabled: bool
 */

const PLATFORM_COLORS = {
  tiktok:   '#ff2d55',
  youtube:  '#ff0000',
  facebook: '#1877f2',
  twitter:  '#1da1f2',
  instagram:'#e1306c',
  article:  '#6366f1',
  image:    '#10b981',
  text:     '#f59e0b',
  hybrid:   '#8b5cf6',
  multi:    '#06b6d4',
  unknown:  '#6b7280',
};

const PLATFORM_ICONS = {
  tiktok:   '🎵',
  youtube:  '📺',
  facebook: '📘',
  twitter:  '🐦',
  instagram:'📸',
  article:  '🌐',
  image:    '🖼️',
  text:     '📝',
  hybrid:   '🔀',
  multi:    '🔗',
  unknown:  '❓',
};

// Image resize client-side (ป้องกัน payload ใหญ่)
function resizeImage(file, maxPx = 900, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        if (w > maxPx || h > maxPx) {
          if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
          else        { w = Math.round(w * maxPx / h); h = maxPx; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function UniversalInputBox({ onDetect, onSubmit, loading = false, disabled = false }) {
  const [inputText, setInputText]       = useState('');
  const [images, setImages]             = useState([]);        // base64 array
  const [detection, setDetection]       = useState(null);
  const [detecting, setDetecting]       = useState(false);
  const [isDragging, setIsDragging]     = useState(false);
  const [detectError, setDetectError]   = useState('');
  const detectTimer                     = useRef(null);
  const textareaRef                     = useRef(null);
  const fileInputRef                    = useRef(null);
  const onDetectRef                     = useRef(onDetect);
  useEffect(() => { onDetectRef.current = onDetect; }, [onDetect]);

  // ── Auto-detect on input change (debounced 600ms) ───────────────
  useEffect(() => {
    clearTimeout(detectTimer.current);
    setDetectError('');

    const hasContent = inputText.trim().length > 3 || images.length > 0;
    if (!hasContent) {
      setDetection(null);
      onDetectRef.current?.(null, null);
      return;
    }

    detectTimer.current = setTimeout(async () => {
      setDetecting(true);
      try {
        const res = await fetch('/api/auto/detect', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input:      inputText,
            imageCount: images.length, // ✅ FIX Bug#3: send count only — detector uses this to classify image/hybrid
          }),
        });
        const data = await res.json();
        if (data.success) {
          setDetection(data);
          onDetectRef.current?.(data.detection, data.route);
        } else {
          setDetectError(data.error || 'ตรวจไม่ได้');
        }
      } catch (e) {
        setDetectError('ไม่สามารถเชื่อมต่อ detect service');
      } finally {
        setDetecting(false);
      }
    }, 600);

    return () => clearTimeout(detectTimer.current);
  }, [inputText, images.length]);

  // ── Paste handler (Ctrl+V image / text) ─────────────────────────
  const handlePaste = useCallback(async (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter(i => i.type.startsWith('image/'));

    if (imageItems.length > 0) {
      e.preventDefault();
      const newImages = [];
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (file) {
          const b64 = await resizeImage(file);
          newImages.push(b64);
        }
      }
      setImages(prev => [...prev, ...newImages].slice(0, 5));
    }
    // Text paste: let browser handle naturally
  }, []);

  // ── Drag & Drop ──────────────────────────────────────────────────
  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;
    const newImages = await Promise.all(files.slice(0, 5).map(f => resizeImage(f)));
    setImages(prev => [...prev, ...newImages].slice(0, 5));
  }, []);

  // ── File upload ──────────────────────────────────────────────────
  const handleFileSelect = useCallback(async (e) => {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;
    const newImages = await Promise.all(files.slice(0, 5).map(f => resizeImage(f)));
    setImages(prev => [...prev, ...newImages].slice(0, 5));
    e.target.value = '';
  }, []);

  const removeImage = (idx) => setImages(prev => prev.filter((_, i) => i !== idx));

  // ── Submit ───────────────────────────────────────────────────────
  const handleSubmit = () => {
    if (!inputText.trim() && images.length === 0) return;
    if (loading || disabled) return;
    onSubmit?.(inputText, images);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSubmit();
    }
  };

  const clear = () => {
    setInputText('');
    setImages([]);
    setDetection(null);
    setDetectError('');
  };

  // ── Detection badge ──────────────────────────────────────────────
  const platform = detection?.detection?.platform || 'unknown';
  const badgeColor = PLATFORM_COLORS[platform] || '#6b7280';
  const badgeIcon  = PLATFORM_ICONS[platform]  || '❓';
  const hasContent = inputText.trim().length > 0 || images.length > 0;
  const canSubmit  = hasContent && !loading && !disabled;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* ── Main Input Area ─────────────────────────────────── */}
      <div
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        style={{
          border:       `2px solid ${isDragging ? badgeColor : detection ? badgeColor + '55' : 'var(--border)'}`,
          borderRadius: 14,
          background:   isDragging ? `${badgeColor}08` : 'var(--bg-secondary)',
          transition:   'all .2s',
          overflow:     'hidden',
          boxShadow:    detection ? `0 0 0 1px ${badgeColor}22` : 'none',
        }}
      >
        {/* Text Input */}
        <textarea
          ref={textareaRef}
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          disabled={loading || disabled}
          placeholder={isDragging
            ? '📎 วางรูปภาพที่นี่...'
            : '🔗 วาง URL (ข่าว / TikTok / YouTube / Facebook)\n📝 หรือพิมพ์ข้อความ\n📷 หรือลากรูปมาวาง / กด Ctrl+V เพื่อวางรูป\n\nกด Ctrl+Enter เพื่อส่ง'}
          style={{
            width:      '100%',
            minHeight:  130,
            padding:    '14px 16px',
            border:     'none',
            background: 'transparent',
            color:      'var(--text-primary)',
            fontSize:   13,
            fontFamily: 'inherit',
            resize:     'vertical',
            outline:    'none',
            lineHeight: 1.65,
            boxSizing:  'border-box',
          }}
        />

        {/* Image Previews */}
        {images.length > 0 && (
          <div style={{ display: 'flex', gap: 8, padding: '0 14px 12px', flexWrap: 'wrap' }}>
            {images.map((src, i) => (
              <div key={i} style={{ position: 'relative', width: 72, height: 72, borderRadius: 8, overflow: 'hidden', border: '2px solid var(--border)' }}>
                <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <button
                  onClick={() => removeImage(i)}
                  style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,0.75)', border: 'none', color: '#fff', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >✕</button>
              </div>
            ))}
            {images.length < 5 && (
              <label style={{ width: 72, height: 72, borderRadius: 8, border: '1px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, flexShrink: 0 }}>
                +
                <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFileSelect} />
              </label>
            )}
          </div>
        )}

        {/* Bottom toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderTop: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
          {/* Upload button */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            📎 เพิ่มรูป
            <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFileSelect} />
          </label>

          {/* Detection badge */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
            {detecting && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>🔍 กำลังตรวจจับ...</span>
            )}
            {detection && !detecting && (
              <div style={{
                display:      'flex', alignItems: 'center', gap: 5,
                padding:      '3px 10px', borderRadius: 20,
                background:   badgeColor + '18',
                border:       `1px solid ${badgeColor}44`,
                fontSize:     11, fontWeight: 700, color: badgeColor,
                maxWidth:     '100%', overflow: 'hidden',
              }}>
                <span>{badgeIcon}</span>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {detection.detection.label}
                </span>
                <span style={{ fontSize: 9, opacity: 0.7 }}>
                  ({Math.round(detection.detection.confidence * 100)}%)
                </span>
              </div>
            )}
            {detectError && (
              <span style={{ fontSize: 10, color: '#fca5a5' }}>⚠️ {detectError}</span>
            )}
          </div>

          {/* Clear */}
          {hasContent && (
            <button onClick={clear} style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
              ล้าง
            </button>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              padding:    '6px 16px', borderRadius: 8, border: 'none',
              background: canSubmit ? (detection ? badgeColor : 'var(--accent)') : 'var(--bg-elevated)',
              color:      canSubmit ? '#fff' : 'var(--text-muted)',
              fontWeight: 800, fontSize: 12, cursor: canSubmit ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit', transition: 'all .2s', whiteSpace: 'nowrap',
              boxShadow:  canSubmit ? `0 4px 14px ${(detection ? badgeColor : '#6366f1')}44` : 'none',
            }}
          >
            {loading ? '⏳ กำลังประมวล...' : `${detection?.route?.pipelineIcon || '⚡'} วิเคราะห์`}
          </button>
        </div>
      </div>

      {/* ── Route Preview Panel ─────────────────────────────── */}
      {detection && detection.route && (
        <div style={{
          padding:    '10px 14px',
          background: 'var(--bg-secondary)',
          border:     `1px solid ${badgeColor}33`,
          borderRadius: 10,
          display:    'flex', flexDirection: 'column', gap: 6,
        }}>
          {/* Pipeline */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>Pipeline:</span>
            <span style={{ fontSize: 11, fontWeight: 800, color: badgeColor }}>
              {detection.route.pipelineIcon} {detection.route.pipelineLabel}
            </span>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              [{detection.route.pipelineId}]
            </span>
          </div>

          {/* Steps */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            {(detection.route.steps || []).map((step, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: badgeColor + '18', color: badgeColor, fontWeight: 700 }}>
                  {step}
                </span>
                {i < detection.route.steps.length - 1 && <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>→</span>}
              </span>
            ))}
          </div>

          {/* Provider + Cost */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {detection.route.primaryProvider && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                🔌 Provider: <strong style={{ color: 'var(--text-primary)' }}>{detection.route.primaryProvider.label}</strong>
                {detection.route.fallbackCount > 0 && <span> (+{detection.route.fallbackCount} fallback)</span>}
              </span>
            )}
            {detection.route.costEstimate && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                💰 {detection.route.costEstimate.breakdown}
              </span>
            )}
          </div>

          {/* Warnings */}
          {detection.route.warnings?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {detection.route.warnings.map((w, i) => (
                <div key={i} style={{ fontSize: 10, color: '#fde68a', padding: '3px 8px', background: 'rgba(251,191,36,0.07)', borderRadius: 5 }}>
                  {w}
                </div>
              ))}
            </div>
          )}

          {/* URLs detected */}
          {detection.payload?.urls?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {detection.payload.urls.slice(0, 3).map((url, i) => (
                <div key={i} style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  🔗 {url}
                </div>
              ))}
              {detection.payload.urls.length > 3 && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>+{detection.payload.urls.length - 3} URLs อื่น</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
