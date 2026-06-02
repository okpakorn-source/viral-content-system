'use client';
import React from 'react';
import UniversalInputBox from '@/components/UniversalInputBox';

export default function InputSection({ states, setters, handlers, utils }) {
  const { autoMode, liveDetection, contentLength, newsImagePreviews, autoProgress, composingImage, universalDetection, autoLog, composedImages, imageLayout, sourceType, url, tiktokNeedUpload, youtubeNeedUpload, videoFile, imagePreview, imageFile, extracting, extracted, rawText, customPrompt, loading, queuePolling, queuePosition, queueStatus } = states;
  const { setLiveDetection, setContentLength, setNewsImages, setNewsImagePreviews, setSourceType, setExtracted, setRawText, setError, setImageFile, setImagePreview, setTiktokNeedUpload, setVideoFile, setYoutubeNeedUpload, setUrl, setCustomPrompt } = setters;
  const { handleUniversalSubmit, handleTikTokTranscribe, handleAutoMode, handleYouTubeTranscribe, handleExtract, handleImagePaste, handleImageDrop, handleImageOCR, handleExtractNews, processImageFile } = handlers;
  const { resizeImage, SOURCE_TYPES, placeholders } = utils;

  const needsUrl = ['url', 'facebook', 'tiktok', 'youtube'].includes(sourceType);

  return (
    <>
                <div className="card slide-up">
                  {/* ⚡ AUTO MODE */}
                  <div style={{
                    background: 'linear-gradient(135deg, rgba(249,24,128,0.1), rgba(124,58,237,0.1))',
                    border: '2px solid rgba(249,24,128,0.4)',
                    borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 24,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 28 }}>⚡</span>
                      <div style={{ flex: 1, minWidth: 150 }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: '#f472b6' }}>⚡ Auto Mode — Universal Input</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          วาง URL / พิมพ์ข้อความ / วางรูป / Drag &amp; Drop — AI ตรวจจับ → เลือก Pipeline → สร้างอัตโนมัติ
                          <span style={{ display: 'inline-flex', gap: 4, marginLeft: 6, opacity: 0.7 }}>
                            🌐 📘 🎵 📺 📝 🖼️ 🔀
                          </span>
                        </div>
                      </div>
                    </div>
      
                    {/* Universal Input Box — replaces URL-only input */}
                    <UniversalInputBox
                      onSubmit={handleUniversalSubmit}
                      onDetect={(det, route) => setLiveDetection(det ? { ...det, route } : null)}
                      loading={autoMode}
                      disabled={autoMode}
                    />
      
                    {/* ✅ Phase 6: Live Detection Preview */}
                    {liveDetection && !autoMode && (
                      <div style={{
                        marginTop: 8, padding: '8px 12px',
                        background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)',
                        borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                      }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#818cf8' }}>🔍 ตรวจจับ:</span>
                        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-primary)' }}>
                          {liveDetection.platform} — {liveDetection.label}
                        </span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                          ({Math.round((liveDetection.confidence || 0) * 100)}%)
                        </span>
                      </div>
                    )}
      
                    {/* Preset + Length selectors */}
                                  {/* ความยาวเนื้อหา */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      {[
                        { id: 'short', label: '📝 สั้น' },
                        { id: 'medium', label: '📄 กลาง' },
                        { id: 'long', label: '📰 ยาว' },
                      ].map(l => (
                        <button key={l.id} onClick={() => setContentLength(l.id)} disabled={autoMode}
                          style={{
                            padding: '4px 10px', fontSize: 10, fontWeight: 600,
                            background: contentLength === l.id ? 'var(--success)' : 'var(--bg-primary)',
                            color: contentLength === l.id ? '#fff' : 'var(--text-muted)',
                            border: `1px solid ${contentLength === l.id ? 'var(--success)' : 'var(--border)'}`,
                            borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit',
                          }}>
                          {l.label}
                        </button>
                      ))}
                    </div>
      
                    {/* 📸 Image Upload Zone */}
                    <div style={{ marginTop: 12, padding: 12, background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 'var(--radius-md)' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>
                        📸 อัปโหลดรูปประกอบข่าว <span style={{ fontWeight: 400 }}>(ไม่บังคับ — ถ้ามีรูป AI จะสร้างปกข่าวให้อัตโนมัติ)</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        {newsImagePreviews.map((src, i) => (
                          <div key={i} style={{ position: 'relative', width: 68, height: 68, borderRadius: 8, overflow: 'hidden', border: '2px solid rgba(249,24,128,0.4)' }}>
                            <img src={src} alt={`img${i}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            <button onClick={() => {
                              setNewsImages(p => p.filter((_,j) => j !== i));
                              setNewsImagePreviews(p => p.filter((_,j) => j !== i));
                            }} style={{ position:'absolute', top:2, right:2, width:18, height:18, borderRadius:'50%', background:'rgba(0,0,0,0.75)', border:'none', color:'#fff', fontSize:10, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1 }}>✕</button>
                          </div>
                        ))}
                        {newsImagePreviews.length < 5 && (
                          <label style={{ width:68, height:68, borderRadius:8, border:'1px dashed rgba(255,255,255,0.2)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'var(--text-muted)', fontSize:10, gap:4 }}>
                            <span style={{ fontSize:22 }}>+</span>
                            <span>เพิ่มรูป</span>
                            <input type="file" accept="image/*" multiple style={{ display:'none' }} disabled={autoMode}
                              onChange={async e => {
                                const files = Array.from(e.target.files || []).slice(0, 5 - newsImagePreviews.length);
                                for (const file of files) {
                                  try {
                                    const b64 = await resizeImage(file, 800, 0.72);
                                    setNewsImages(p => [...p, file]);
                                    setNewsImagePreviews(p => [...p, b64]);
                                  } catch(err) { console.warn('resize err:', err); }
                                }
                                e.target.value = '';
                              }}
                            />
                          </label>
                        )}
                        {newsImagePreviews.length > 0 && (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>
                            {newsImagePreviews.length}/5 รูป<br/>AI จะจัดวาง<br/>ให้อัตโนมัติ
                          </div>
                        )}
                      </div>
                    </div>
      
                    {/* 📋 Queue Status Bar */}
                    {queuePolling && queuePosition > 0 && (
                      <div style={{
                        padding: '12px 16px',
                        borderRadius: 12,
                        background: 'linear-gradient(135deg, rgba(59,130,246,0.12), rgba(168,85,247,0.08))',
                        border: '1px solid rgba(59,130,246,0.2)',
                        marginTop: 10,
                        marginBottom: 4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                      }}>
                        <div style={{ fontSize: 24 }}>📋</div>
                        <div>
                          <div style={{ fontWeight: 700, color: '#60a5fa', fontSize: 13 }}>
                            คิวลำดับที่ {queuePosition}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                            ระบบกำลังประมวลผลงานอื่นอยู่ รอสักครู่...
                            {queueStatus === 'processing' ? ' ⚡ กำลังประมวลผลของคุณแล้ว!' : ` ประมาณ ${Math.max((queuePosition - 1) * 3, 1)} นาที`}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Auto Progress */}
                    {(autoMode || composingImage) && (
                      <div style={{
                        background: 'var(--bg-primary)', padding: 14, borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border)', marginTop: 10,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                          <div style={{ width: 20, height: 20, border: '3px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-light)' }}>{autoProgress || (composingImage ? '🖼️ กำลังสร้างปกข่าว...' : '')}</span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                          🧬 Classic + Enhanced | ⚡ Blueprint | 🔍 Research | 🖼️ Image Composer | รองรับ URL / TikTok / YouTube (~25-50 วินาที)
                        </div>
                      </div>
                    )}
      
                    {/* ✅ Phase 6: Detection Result Panel */}
                    {universalDetection && !autoMode && (
                      <div className="detection-panel detection-glow" style={{
                        marginTop: 10, padding: 14,
                        background: 'linear-gradient(135deg, rgba(99,102,241,0.06), rgba(139,92,246,0.06))',
                        border: '1px solid rgba(99,102,241,0.25)',
                        borderRadius: 'var(--radius-md)',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 18 }}>{universalDetection.pipelineIcon || '⚡'}</span>
                          <div style={{ flex: 1, minWidth: 120 }}>
                            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>
                              {universalDetection.pipelineLabel || universalDetection.label}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                              {universalDetection.inputType} → {universalDetection.pipelineUsed}
                              {universalDetection.provider && <span> | provider: <strong>{universalDetection.provider}</strong></span>}
                            </div>
                          </div>
                          <div style={{
                            padding: '3px 10px', borderRadius: 20,
                            background: (universalDetection.confidence || 0) > 0.7 ? 'rgba(34,197,94,0.15)' : 'rgba(251,191,36,0.15)',
                            border: `1px solid ${(universalDetection.confidence || 0) > 0.7 ? 'rgba(34,197,94,0.4)' : 'rgba(251,191,36,0.4)'}`,
                            fontSize: 10, fontWeight: 700,
                            color: (universalDetection.confidence || 0) > 0.7 ? '#22c55e' : '#fbbf24',
                          }}>
                            {Math.round((universalDetection.confidence || 0) * 100)}% confident
                          </div>
                        </div>
                        {/* Fallbacks */}
                        {universalDetection.fallbacksUsed?.length > 0 && (
                          <div style={{ fontSize: 10, color: '#fde68a', padding: '4px 8px', background: 'rgba(251,191,36,0.07)', borderRadius: 6, marginBottom: 6 }}>
                            🔄 Fallback ใช้: {universalDetection.fallbacksUsed.join(' → ')}
                          </div>
                        )}
                        {/* Debug log */}
                        {autoLog.length > 0 && (
                          <details style={{ marginTop: 4 }}>
                            <summary style={{ fontSize: 10, color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 600 }}>
                              📊 Pipeline Log ({autoLog.length} steps)
                            </summary>
                            <div style={{ background: 'var(--bg-primary)', padding: 8, borderRadius: 'var(--radius-sm)', marginTop: 4, fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', maxHeight: 180, overflowY: 'auto', lineHeight: 1.7 }}>
                              {autoLog.map((l, i) => <div key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', padding: '2px 0' }}>{l}</div>)}
                            </div>
                          </details>
                        )}
                      </div>
                    )}
      
                    {/* Auto Log fallback (when no universalDetection but has log) */}
                    {!universalDetection && autoLog.length > 0 && !autoMode && (
                      <details style={{ marginTop: 8 }}>
                        <summary style={{ fontSize: 10, color: 'var(--text-muted)', cursor: 'pointer' }}>📊 Log ({autoLog.length} steps)</summary>
                        <div style={{ background: 'var(--bg-primary)', padding: 8, borderRadius: 'var(--radius-sm)', marginTop: 4, fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', maxHeight: 150, overflowY: 'auto' }}>
                          {autoLog.map((l, i) => <div key={i}>{l}</div>)}
                        </div>
                      </details>
                    )}
      
                    {/* 🖼️ Image Result */}
                    {composedImages && !composingImage && (
                      <div style={{ marginTop: 14, padding: 14, background: 'rgba(249,24,128,0.06)', border: '1px solid rgba(249,24,128,0.2)', borderRadius: 'var(--radius-md)' }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: '#f472b6', marginBottom: 10 }}>
                          🖼️ ปกข่าวที่สร้างได้
                          {imageLayout && <span style={{ fontWeight: 400, fontSize: 10, marginLeft: 8, color: 'var(--text-muted)' }}>Template: {imageLayout.templateName} ({imageLayout.confidence}% confident)</span>}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                          {composedImages.layout && (
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 700 }}>🖼️ Layout (ไม่มีข้อความ)</div>
                              <img src={composedImages.layout.imageBase64} alt="layout" style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)' }} />
                              <a href={composedImages.layout.imageBase64} download="news-layout.jpg"
                                style={{ display: 'block', marginTop: 6, padding: '6px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, color: 'var(--text-secondary)', textDecoration: 'none', fontWeight: 700, textAlign: 'center' }}>
                                📥 Download
                              </a>
                            </div>
                          )}
                          {composedImages.text && (
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 700 }}>✏️ พร้อมข้อความ (Ideogram)</div>
                              <img src={composedImages.text.imageBase64} alt="with-text" style={{ width: '100%', borderRadius: 8, border: '1px solid rgba(249,24,128,0.3)' }} />
                              <a href={composedImages.text.imageBase64} download="news-with-text.jpg"
                                style={{ display: 'block', marginTop: 6, padding: '6px 12px', background: 'linear-gradient(135deg, #f91880, #7c3aed)', border: 'none', borderRadius: 6, fontSize: 11, color: '#fff', textDecoration: 'none', fontWeight: 700, textAlign: 'center' }}>
                                📥 Download
                              </a>
                            </div>
                          )}
                        </div>
                        {imageLayout?.reasoning && (
                          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            🤖 AI: {imageLayout.reasoning}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
      
      
                  {/* Divider */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>หรือใช้แบบ Manual</span>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  </div>
      
                  <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>📥 เลือกแหล่งข้อมูล</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 24 }}>
                    {SOURCE_TYPES.map((s) => (
                      <button key={s.value} onClick={() => { setSourceType(s.value); setExtracted(null); setRawText(''); setError(''); setImageFile(null); setImagePreview(null); setTiktokNeedUpload(false); setVideoFile(null); setYoutubeNeedUpload(false); }}
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
                      <label className="form-label">🔗 {sourceType === 'tiktok' ? 'URL คลิป TikTok' : sourceType === 'youtube' ? 'URL คลิป YouTube' : 'URL'}</label>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <input type="url" className="form-input" placeholder={placeholders[sourceType]}
                          value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: '1 1 200px', minWidth: 0 }} />
                        {sourceType === 'tiktok' ? (
                          <>
                            <button type="button" onClick={() => handleTikTokTranscribe('url')} disabled={!url || extracting}
                              className="btn btn-outline" style={{ whiteSpace: 'nowrap' }}>
                              {extracting ? '⏳ กำลังถอดเสียง...' : '🎤 ถอดเสียง (Manual)'}
                            </button>
                            <button type="button" onClick={() => handleAutoMode({ url, type: 'tiktok' })} disabled={!url || autoMode}
                              style={{ padding: '9px 16px', border: 'none', borderRadius: 'var(--radius-md)', background: 'linear-gradient(135deg, #f91880, #7c3aed)', color: '#fff', fontWeight: 800, fontSize: 12, cursor: autoMode ? 'wait' : 'pointer', whiteSpace: 'nowrap', boxShadow: '0 4px 12px rgba(249,24,128,0.3)', fontFamily: 'inherit' }}>
                              {autoMode ? '⏳ กำลัง...' : '⚡ Auto สร้างเลย'}
                            </button>
                          </>
                        ) : sourceType === 'youtube' ? (
                          <>
                            <button type="button" onClick={() => handleYouTubeTranscribe('url')} disabled={!url || extracting}
                              className="btn btn-outline" style={{ whiteSpace: 'nowrap' }}>
                              {extracting ? '⏳ กำลังดึง...' : '📺 ดึง Transcript (Manual)'}
                            </button>
                            <button type="button" onClick={() => handleAutoMode({ url, type: 'youtube' })} disabled={!url || autoMode}
                              style={{ padding: '9px 16px', border: 'none', borderRadius: 'var(--radius-md)', background: 'linear-gradient(135deg, #f91880, #7c3aed)', color: '#fff', fontWeight: 800, fontSize: 12, cursor: autoMode ? 'wait' : 'pointer', whiteSpace: 'nowrap', boxShadow: '0 4px 12px rgba(249,24,128,0.3)', fontFamily: 'inherit' }}>
                              {autoMode ? '⏳ กำลัง...' : '⚡ Auto สร้างเลย'}
                            </button>
                          </>
                        ) : (
                          <button type="button" onClick={handleExtract} disabled={!url || extracting}
                            className="btn btn-outline" style={{ whiteSpace: 'nowrap' }}>
                            {extracting ? '⏳ กำลังดึง...' : '📥 ดึงเนื้อหา'}
                          </button>
                        )}
                      </div>
                      {sourceType === 'tiktok' && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                          AI จะดาวน์โหลดคลิปอัตโนมัติ → ถอดเสียงด้วย Whisper → ได้ข้อความ
                        </div>
                      )}
                      {sourceType === 'youtube' && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                          ดึง subtitle อัตโนมัติ (ฟรี) — ถ้าไม่มี subtitle จะให้อัปโหลดไฟล์ถอดเสียงแทน
                        </div>
                      )}
                    </div>
                  )}
      
                  {/* 🎵 TikTok Fallback: Upload Video */}
                  {sourceType === 'tiktok' && (tiktokNeedUpload || !url) && (
                    <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>📤 หรืออัปโหลดไฟล์วิดีโอโดยตรง</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                        {tiktokNeedUpload ? '⚠️ ดาวน์โหลดอัตโนมัติไม่สำเร็จ — ' : ''}ดาวน์โหลดคลิปจาก TikTok แล้วอัปโหลดที่นี่
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input type="file" accept="video/*"
                          onChange={(e) => setVideoFile(e.target.files?.[0])}
                          style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)' }} />
                        {videoFile && (
                          <button type="button" onClick={() => handleTikTokTranscribe('upload')} disabled={extracting}
                            className="btn btn-viral" style={{ whiteSpace: 'nowrap' }}>
                            {extracting ? '⏳ กำลังถอดเสียง...' : '🎤 ถอดเสียง'}
                          </button>
                        )}
                      </div>
                      {videoFile && (
                        <div style={{ fontSize: 11, color: 'var(--accent-light)', marginTop: 6 }}>
                          📁 {videoFile.name} ({(videoFile.size / 1024 / 1024).toFixed(1)} MB)
                        </div>
                      )}
                    </div>
                  )}
      
                  {/* 📺 YouTube Fallback: Upload Video */}
                  {sourceType === 'youtube' && youtubeNeedUpload && (
                    <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--warning)', marginBottom: 6 }}>⚠️ คลิปนี้ไม่มี subtitle — อัปโหลดไฟล์วิดีโอเพื่อถอดเสียงด้วย AI</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                        ดาวน์โหลดคลิปจาก YouTube แล้วอัปโหลดที่นี่ (Whisper จะถอดเสียงภาษาไทย)
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input type="file" accept="video/*,audio/*"
                          onChange={(e) => setVideoFile(e.target.files?.[0])}
                          style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)' }} />
                        {videoFile && (
                          <button type="button" onClick={() => handleYouTubeTranscribe('upload')} disabled={extracting}
                            className="btn btn-viral" style={{ whiteSpace: 'nowrap' }}>
                            {extracting ? '⏳ กำลังถอดเสียง...' : '🎤 ถอดเสียง'}
                          </button>
                        )}
                      </div>
                      {videoFile && (
                        <div style={{ fontSize: 11, color: 'var(--accent-light)', marginTop: 6 }}>
                          📁 {videoFile.name} ({(videoFile.size / 1024 / 1024).toFixed(1)} MB)
                        </div>
                      )}
                    </div>
                  )}
      
                  {/* 📷 Image Upload Zone */}
                  {sourceType === 'image' && (
                    <div className="form-group">
                      <label className="form-label">📷 วางภาพแคปหน้าจอ หรือลากไฟล์มาวาง</label>
                      <div
                        onPaste={handleImagePaste}
                        onDrop={handleImageDrop}
                        onDragOver={(e) => e.preventDefault()}
                        onClick={() => document.getElementById('imageUpload')?.click()}
                        tabIndex={0}
                        style={{
                          border: `2px dashed ${imagePreview ? 'var(--success)' : 'var(--border-light)'}`,
                          borderRadius: 'var(--radius-md)',
                          padding: imagePreview ? 12 : 40,
                          textAlign: 'center',
                          cursor: 'pointer',
                          background: imagePreview ? 'var(--bg-primary)' : 'var(--bg-secondary)',
                          transition: 'all 0.2s',
                          outline: 'none',
                        }}
                      >
                        {imagePreview ? (
                          <div>
                            <img src={imagePreview} alt="Preview" style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 8, marginBottom: 10 }} />
                            <div style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>✅ ได้รับภาพแล้ว — กดปุ่มด้านล่างเพื่ออ่านข้อความ</div>
                            <button type="button" onClick={(e) => { e.stopPropagation(); setImageFile(null); setImagePreview(null); }}
                              style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                              🗑️ ลบภาพ วางใหม่
                            </button>
                          </div>
                        ) : (
                          <div>
                            <div style={{ fontSize: 40, marginBottom: 8 }}>📋</div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Ctrl+V วางภาพที่แคปมา</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>หรือลากไฟล์ภาพมาวาง • หรือคลิกเลือกไฟล์</div>
                            <div style={{ fontSize: 11, color: 'var(--accent-light)', marginTop: 10, padding: '6px 12px', background: 'var(--accent-glow)', borderRadius: 20, display: 'inline-block' }}>
                              รองรับ: FB, Twitter, Line, TikTok, ข่าว ฯลฯ
                            </div>
                          </div>
                        )}
                        <input id="imageUpload" type="file" accept="image/*" hidden
                          onChange={(e) => processImageFile(e.target.files?.[0])} />
                      </div>
      
                      {/* ปุ่ม OCR */}
                      {imageFile && (
                        <button type="button" onClick={handleImageOCR} disabled={extracting}
                          className="btn btn-viral btn-lg" style={{ width: '100%', marginTop: 12 }}>
                          {extracting ? '⏳ AI กำลังอ่านข้อความจากภาพ...' : '🔍 อ่านข้อความจากภาพ (AI Vision)'}
                        </button>
                      )}
                    </div>
                  )}
      
                  {/* Extracted Preview */}
                  {extracted?.success && (
                    <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--success)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 16 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)' }}>✅ {sourceType === 'image' ? 'อ่านข้อความจากภาพสำเร็จ' : 'ดึงเนื้อหาสำเร็จ'}</span>
                      {extracted.title && <div style={{ fontSize: 14, fontWeight: 600, marginTop: 6 }}>{extracted.title}</div>}
                    </div>
                  )}
      
                  {/* Text area — แสดงกับทุก source ที่มีข้อความ */}
                  {(sourceType === 'raw' || extracted || sourceType === 'facebook' || (sourceType === 'image' && rawText)) && (
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
      
                  {/* ปุ่มสกัดข่าว — ทุก source เข้าที่เดียวกัน */}
                  <button type="button" onClick={handleExtractNews} className="btn btn-viral btn-lg"
                    style={{ width: '100%', marginTop: 12 }} disabled={loading || !rawText}>
                    {loading ? '⏳ กำลังสกัดเนื้อข่าว...' : '📥 สกัดเนื้อข่าว (AI แยกข่าวจริงจากขยะ)'}
                  </button>
                </div>
    </>
  );
}