'use client';
import React from 'react';

export default function ResultVersions({ states, handlers }) {
  const { analysisResult, composedImages, composingImage, imageLayout, newsData, copied, sentToReview, sendingReview, simulatedComments, loading, researchData, factPoolData } = states;
  const { copyText, handleSendToReview, setCopied, handleAnalyze, handleReset } = handlers;

  // รองรับรูปแบบ payload ที่ต่างกันจากการดึงข้อมูล AutoFlow หรือ Extract ตรงๆ
  const researchItems = researchData?.items || analysisResult?.researchItems || analysisResult?.researchData?.items || newsData?.researchData?.items || [];
  
  const referenceText = researchItems.length > 0 
    ? '\n\n🔗 แหล่งอ้างอิงข้อมูล:\n' + researchItems.map((r, idx) => `${idx + 1}. ${r.sourceUrl || r.sourceName || r.title}`).join('\n')
    : '';

  return (
    <>
      {/* ===== ส่วนหัว: หัวข้อข่าว + Prompt ที่ใช้ กำกับชัดเจน ===== */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>📝 ผลลัพธ์</h3>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{analysisResult.versions?.length || 0} เวอร์ชัน</span>
            </div>

            {/* 🖼️ Image Result in Analyzed Step */}
            {composedImages && !composingImage && (
              <div style={{ marginBottom: 16, padding: 14, background: 'rgba(249,24,128,0.06)', border: '1px solid rgba(249,24,128,0.2)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#f472b6', marginBottom: 10 }}>
                  🖼️ ปกข่าวอัตโนมัติ
                  {imageLayout && <span style={{ fontWeight: 400, fontSize: 10, marginLeft: 8, color: 'var(--text-muted)' }}>Template: {imageLayout.templateName}</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                  {composedImages.layout && (
                    <div style={{ textAlign: 'center' }}>
                      <img src={composedImages.layout.imageBase64} alt="layout" style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)' }} />
                      <a href={composedImages.layout.imageBase64} download="news-cover.jpg"
                        style={{ display: 'block', marginTop: 6, padding: '6px 12px', background: 'linear-gradient(135deg, #f91880, #7c3aed)', border: 'none', borderRadius: 6, fontSize: 11, color: '#fff', textDecoration: 'none', fontWeight: 700, textAlign: 'center' }}>
                        📥 Download ภาพปก
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 📰 หัวข้อข่าว + Prompt ที่ใช้ */}
            <div style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius-md)', marginBottom: 16, border: analysisResult.usedPreset?.source === 'library' ? '2px solid rgba(139,92,246,0.5)' : '1px solid var(--border)', overflow: 'hidden' }}>
              {/* Prompt Badge — ติดด้านบนหัวข้อข่าว */}
              {analysisResult.usedPreset?.source === 'library' ? (
                <div style={{
                  background: analysisResult.usedPreset?.isBorrowed
                    ? 'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(239,68,68,0.1))'
                    : 'linear-gradient(135deg, rgba(139,92,246,0.25), rgba(59,130,246,0.2))',
                  padding: '10px 16px',
                  borderBottom: analysisResult.usedPreset?.isBorrowed
                    ? '1px solid rgba(245,158,11,0.4)'
                    : '1px solid rgba(139,92,246,0.3)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                      background: analysisResult.usedPreset?.isBorrowed
                        ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
                        : 'linear-gradient(135deg, #7c3aed, #3b82f6)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                    }}>
                      {analysisResult.usedPreset?.isBorrowed ? '⚠️' : '🏛️'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1,
                        color: analysisResult.usedPreset?.isBorrowed ? '#fbbf24' : '#a78bfa',
                      }}>
                        {analysisResult.usedPreset?.isBorrowed ? 'ยืม PROMPT ใกล้เคียง (ไม่มีตรงแนว)' : 'PROMPT จากหอสมุดไวรัล'}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 900, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {analysisResult.usedPreset.name?.replace('🏛️ ', '').replace('⚠️ ', '')}
                      </div>
                    </div>
                    {analysisResult.usedPreset.viralScore && (
                      <div style={{
                        background: analysisResult.usedPreset?.isBorrowed
                          ? 'linear-gradient(135deg, #f59e0b, #f97316)'
                          : 'linear-gradient(135deg, #7c3aed, #6366f1)',
                        padding: '4px 10px', borderRadius: 16, color: '#fff', fontWeight: 900, fontSize: 12, textAlign: 'center', lineHeight: 1, flexShrink: 0,
                      }}>
                        <div style={{ fontSize: 7, opacity: 0.7, marginBottom: 1 }}>VIRAL</div>
                        {analysisResult.usedPreset.viralScore}
                      </div>
                    )}
                  </div>
                  {/* เหตุผล AI */}
                  {analysisResult.debug?.promptMatchReason && (
                    <div style={{
                      fontSize: 9, marginTop: 6, padding: '4px 8px', borderRadius: 4,
                      color: analysisResult.usedPreset?.isBorrowed ? 'rgba(251,191,36,0.95)' : 'rgba(167,139,250,0.9)',
                      background: analysisResult.usedPreset?.isBorrowed ? 'rgba(245,158,11,0.1)' : 'rgba(139,92,246,0.1)',
                    }}>
                      {analysisResult.debug.promptMatchReason}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ background: 'rgba(100,116,139,0.1)', padding: '8px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>📦</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>PRESET: </span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>{analysisResult.usedPreset?.name?.replace('📦 ', '') || 'Library'}</span>
                  </div>
                  {analysisResult.debug?.newsTypeDetected && (
                    <span style={{ fontSize: 9, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '2px 8px', borderRadius: 4 }}>
                      ข่าว{analysisResult.debug.newsTypeDetected}
                    </span>
                  )}
                </div>
              )}
              {/* หัวข้อข่าวจริง */}
              <div style={{ padding: '12px 16px' }}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>{newsData?.newsTitle}</div>
                {analysisResult.news_reference && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>📰 {analysisResult.news_reference}</div>}
                
                {/* 🧬 Deep DNA Analysis Display */}
                {analysisResult.smartMatch?.newsAnalysis?.dna_type && analysisResult.usedPreset?.source === 'library' && (
                  <div style={{ marginTop: 12, padding: 12, background: 'rgba(56,189,248,0.05)', borderRadius: 8, border: '1px solid rgba(56,189,248,0.2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ fontSize: 16 }}>🧬</span>
                      <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8' }}>ผลวิเคราะห์ DNA ข่าวต้นฉบับ</span>
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
                      <div style={{ fontSize: 11 }}>
                        <span style={{ color: 'var(--text-muted)' }}>หมวดหมู่: </span>
                        <span style={{ fontWeight: 700, color: '#e2e8f0' }}>{analysisResult.smartMatch.newsAnalysis.dna_type}</span>
                      </div>
                      
                      {analysisResult.smartMatch.newsAnalysis.story_structure?.narrative_archetype && (
                        <div style={{ fontSize: 11 }}>
                          <span style={{ color: 'var(--text-muted)' }}>โครงเรื่อง: </span>
                          <span style={{ fontWeight: 700, color: '#a78bfa' }}>{analysisResult.smartMatch.newsAnalysis.story_structure.narrative_archetype}</span>
                        </div>
                      )}

                      {analysisResult.smartMatch.newsAnalysis.emotional_core?.primary_emotion && (
                        <div style={{ fontSize: 11 }}>
                          <span style={{ color: 'var(--text-muted)' }}>อารมณ์หลัก: </span>
                          <span style={{ fontWeight: 700, color: '#fbbf24' }}>{analysisResult.smartMatch.newsAnalysis.emotional_core.primary_emotion}</span>
                        </div>
                      )}
                      
                      {analysisResult.smartMatch.newsAnalysis.stop_scrolling_hook?.hook_type && (
                        <div style={{ fontSize: 11 }}>
                          <span style={{ color: 'var(--text-muted)' }}>จุดหยุดนิ้ว (Hook): </span>
                          <span style={{ fontWeight: 700, color: '#f87171' }}>{analysisResult.smartMatch.newsAnalysis.stop_scrolling_hook.hook_type}</span>
                        </div>
                      )}
                    </div>

                    {analysisResult.smartMatch.newsAnalysis.visual_imagination && (
                      <div style={{ marginTop: 8, fontSize: 11, padding: '6px 8px', background: 'rgba(255,255,255,0.05)', borderRadius: 6, color: '#cbd5e1' }}>
                        <span style={{ color: '#94a3b8' }}>💭 ภาพจำในหัว: </span>
                        {analysisResult.smartMatch.newsAnalysis.visual_imagination}
                      </div>
                    )}
                  </div>
                )}

                {/* Legacy fallback */}
                {(!analysisResult.smartMatch?.newsAnalysis?.dna_type) && analysisResult.debug?.newsTypeDetected && analysisResult.usedPreset?.source === 'library' && (
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
                    🧠 AI วิเคราะห์: ข่าว{analysisResult.debug.newsTypeDetected}
                  </div>
                )}
              </div>
              {/* ถ้าใช้ Preset → แสดงเหตุผลว่าทำไมไม่ใช้ Library */}
              {analysisResult.usedPreset?.source === 'preset' && analysisResult.debug?.promptMatchReason && (
                <div style={{ padding: '6px 16px 10px', fontSize: 9, color: '#94a3b8', borderTop: '1px solid rgba(100,116,139,0.15)' }}>
                  💡 {analysisResult.debug.promptMatchReason}
                </div>
              )}
            </div>

            {/* === กฎเหล็ก: แจ้งเตือน AI Error/Warning === */}
            {analysisResult.debug?.aiError && (
              <div style={{ background: 'rgba(239,68,68,0.15)', border: '2px solid rgba(239,68,68,0.5)', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 20 }}>🚨</span>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#ef4444' }}>AI แจ้งปัญหา (กฎเหล็ก: ติดขัดต้องแจ้ง)</div>
                    <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 2 }}>{analysisResult.debug.aiError}</div>
                  </div>
                </div>
              </div>
            )}
            {analysisResult.debug?.aiWarning && (
              <div style={{ background: 'rgba(245,158,11,0.12)', border: '2px solid rgba(245,158,11,0.4)', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 20 }}>⚠️</span>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#f59e0b' }}>AI เตือน (กฎเหล็ก: ข้อมูลไม่ชัดเจน)</div>
                    <div style={{ fontSize: 12, color: '#fcd34d', marginTop: 2 }}>{analysisResult.debug.aiWarning}</div>
                  </div>
                </div>
              </div>
            )}

            {/* 🧠 Smart Research Fact Pool (แสดงครั้งเดียวเหนือ versions) */}
            {factPoolData && factPoolData.facts?.length > 0 && (
              <div style={{ marginBottom: 16, padding: 14, background: 'linear-gradient(135deg, rgba(56,189,248,0.08), rgba(168,85,247,0.08))', borderRadius: 10, border: '1px solid rgba(56,189,248,0.25)' }}>
                <div style={{ fontWeight: 700, marginBottom: 8, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <span style={{ fontSize: 16 }}>🧠</span>
                  Smart Research — ข้อเท็จจริงที่ค้นพบเกี่ยวกับ "{factPoolData.entityName || 'บุคคลในข่าว'}"
                </div>
                {factPoolData.entitySummary && (
                  <div style={{ marginBottom: 10, padding: '8px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: 8, color: '#cbd5e1', fontSize: 11, lineHeight: 1.6 }}>
                    {factPoolData.entitySummary}
                  </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  {factPoolData.facts.slice(0, 8).map((fact, fi) => {
                    const catConfig = {
                      achievement: { icon: '🏆', label: 'ผลงาน', color: '#fbbf24' },
                      numbers: { icon: '📊', label: 'ตัวเลข', color: '#34d399' },
                      quote: { icon: '🗣️', label: 'คำพูด', color: '#a78bfa' },
                      history: { icon: '⚡', label: 'ประวัติ', color: '#f97316' },
                      funfact: { icon: '💡', label: 'น่ารู้', color: '#60a5fa' },
                      publicwork: { icon: '🎤', label: 'งาน', color: '#f472b6' },
                    }[fact.category] || { icon: '📌', label: 'ข้อมูล', color: '#94a3b8' };
                    return (
                      <div key={fi} style={{ flex: '1 1 calc(50% - 8px)', minWidth: 200, padding: '8px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: 8, borderLeft: `3px solid ${catConfig.color}` }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: catConfig.color, marginBottom: 3 }}>
                          {catConfig.icon} {catConfig.label}
                        </div>
                        <div style={{ color: '#e2e8f0', lineHeight: 1.5, fontSize: 12 }}>
                          {fact.text.length > 150 ? fact.text.slice(0, 150) + '...' : fact.text}
                        </div>
                        {fact.source && (
                          <div style={{ fontSize: 9, color: '#64748b', marginTop: 3 }}>📎 {fact.source}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic' }}>
                  *AI เลือกหยิบข้อเท็จจริงเหล่านี้มาเสริมเนื้อหาตามมุมมองของแต่ละเวอร์ชัน ({factPoolData.facts.length} ข้อเท็จจริง, ค้นหาใน {factPoolData.duration || '?'}s)
                </div>
              </div>
            )}

            {/* แสดงแต่ละ Version */}
            {analysisResult.versions?.map((v, i) => (
              <div key={i} style={{ background: 'var(--bg-primary)', padding: 20, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--border)', borderLeft: `4px solid hsl(${i * 60}, 70%, 50%)` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 800 }}>#{i+1} {v.style?.replace(/^(classic|enhanced)_/, '')}</span>
                    {v._sourceLabel && (
                      <span style={{
                        fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 10,
                        background: v._source === 'enhanced' ? 'rgba(168,85,247,0.2)' : 'rgba(234,179,8,0.15)',
                        color: v._source === 'enhanced' ? '#c084fc' : '#fbbf24',
                        border: `1px solid ${v._source === 'enhanced' ? 'rgba(168,85,247,0.4)' : 'rgba(234,179,8,0.3)'}`,
                      }}>
                        {v._sourceLabel}
                      </span>
                    )}
                    {v.tone && <span style={{ fontSize: 9, padding: '2px 8px', background: 'var(--info-bg)', color: 'var(--info)', borderRadius: 10 }}>🎭 {v.tone}</span>}
                    {v.target && <span style={{ fontSize: 9, padding: '2px 8px', background: 'var(--success-bg)', color: 'var(--success)', borderRadius: 10 }}>👤 {v.target}</span>}
                  </div>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}
                    onClick={() => copyText((v.title ? v.title + '\n\n' : '') + v.content, `v${i}`)}>
                    {copied === `v${i}` ? '✅ คัดลอกแล้ว' : '📋 คัดลอก'}
                  </button>
                </div>
                {v.title && <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent-light)', marginBottom: 8 }}>{v.title}</div>}
                {v.hook && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--warning)', marginBottom: 8, fontStyle: 'italic' }}>🪝 {v.hook}</div>}
                <div style={{ fontSize: 14, lineHeight: 2, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{v.content}</div>
                {v.closing && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--success)', marginTop: 10, fontStyle: 'italic' }}>💬 {v.closing}</div>}
                
                {/* 🔗 แสดงอ้างอิงตรงนี้เลย เพื่อให้ UI ชัดเจน */}
                {(researchItems.length > 0 || newsData?.sourceUrl) && (
                  <div style={{ marginTop: 12, padding: 12, background: 'rgba(255,255,255,0.05)', borderRadius: 8, fontSize: 11, color: '#94a3b8' }}>
                    <div style={{ fontWeight: 700, marginBottom: 4, color: '#e2e8f0' }}>🔗 แหล่งอ้างอิงข้อมูล</div>
                    {newsData?.sourceUrl && (
                      <div style={{ marginBottom: 4 }}>
                        • <a href={newsData.sourceUrl} target="_blank" rel="noreferrer" style={{ color: '#38bdf8', textDecoration: 'underline' }}>ลิงก์ข่าวต้นฉบับ (Original Source)</a>
                      </div>
                    )}
                    {researchItems.map((r, idx) => {
                      if (newsData?.sourceUrl && r.sourceUrl === newsData.sourceUrl) return null; // กันซ้ำ
                      return (
                        <div key={idx} style={{ marginBottom: 4 }}>
                          • <a href={r.sourceUrl || '#'} target="_blank" rel="noreferrer" style={{ color: '#38bdf8', textDecoration: 'underline' }}>{r.title}</a> 
                          <span style={{ opacity: 0.7 }}> - {r.sourceName || r.sourceUrl}</span>
                        </div>
                      );
                    })}
                    <div style={{ marginTop: 6, fontSize: 10, color: 'var(--success)', fontStyle: 'italic' }}>
                      *ลิงก์เหล่านี้จะไม่ถูกนำไปด้วยเมื่อกดคัดลอก (ไม่ต้องเสียเวลาตามลบ)
                    </div>
                  </div>
                )}

                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>📊 {v.content?.split(/\s+/).length || 0} คำ</div>
                <button
                  onClick={() => handleSendToReview(v, i)}
                  disabled={sentToReview[i] || sendingReview === i}
                  style={{
                    marginTop: 10, width: '100%', padding: '10px 16px',
                    background: sentToReview[i] ? 'var(--success)' : 'linear-gradient(135deg, #0ea5e9, #6366f1)',
                    border: 'none', borderRadius: 'var(--radius-md)',
                    color: '#fff', fontWeight: 700, fontSize: 12,
                    cursor: sentToReview[i] ? 'default' : sendingReview === i ? 'wait' : 'pointer',
                    opacity: sentToReview[i] ? 0.7 : 1,
                    transition: 'all 0.3s',
                  }}>
                  {sentToReview[i] ? '✅ ส่งเข้าคลังแล้ว' : sendingReview === i ? '⏳ กำลังส่ง...' : '📤 ส่งเข้าคลังรอตรวจ'}
                </button>
                {/* 🔥 Self-Optimizing: ปุ่มให้คะแนน Prompt */}
                {v.promptId && (
                  <button
                    onClick={async () => {
                      try {
                        const res = await fetch('/api/prompt-library', {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ id: v.promptId, action: 'feedback', feedback: { likes: 50, shares: 10, comments: 20 } }),
                        });
                        const data = await res.json();
                        if (data.success) {
                          setCopied(`pang_${i}`);
                          setTimeout(() => setCopied(''), 3000);
                        }
                      } catch (e) { console.error('Feedback error:', e); }
                    }}
                    style={{
                      marginTop: 6, width: '100%', padding: '8px 16px',
                      background: copied === `pang_${i}` ? 'var(--success)' : 'linear-gradient(135deg, #f59e0b, #ef4444)',
                      border: 'none', borderRadius: 'var(--radius-md)',
                      color: '#fff', fontWeight: 700, fontSize: 11,
                      cursor: 'pointer', transition: 'all 0.3s',
                    }}>
                    {copied === `pang_${i}` ? '🎉 ขอบคุณ! Prompt นี้จะถูกใช้บ่อยขึ้น!' : '🔥 โพสต์แล้วปัง! (สอน AI ให้เก่งขึ้น)'}
                  </button>
                )}
              </div>
            ))}

            {/* === AI Simulated Comments === */}
            {simulatedComments.length > 0 && (
              <div style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(139,92,246,0.08))', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <span style={{ fontSize: 24 }}>🤖</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#60a5fa' }}>AI จำลองคอมเมนต์ชาวเน็ต</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>ถ้าโพสต์ข่าวนี้ คอมเมนต์จะมาในทิศทางไหนบ้าง?</div>
                  </div>
                </div>
                <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                  {simulatedComments.map((c, ci) => {
                    const emoji = c.type === 'agreement' ? '👍' : c.type === 'drama' ? '🔥' : c.type === 'funny' ? '😂' : '🤔';
                    const colorMap = { agreement: '#10b981', drama: '#ef4444', funny: '#f59e0b', neutral: '#6366f1' };
                    const labelMap = { agreement: 'เห็นด้วย/สนับสนุน', drama: 'ขัดแย้ง/ดราม่า', funny: 'ตลก/แซว', neutral: 'เป็นกลาง/วิเคราะห์' };
                    return (
                      <div key={ci} style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius-md)', padding: 14, border: `1px solid var(--border)`, borderLeft: `3px solid ${colorMap[c.type] || '#6366f1'}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                          <span style={{ fontSize: 18 }}>{emoji}</span>
                          <span style={{ fontSize: 10, fontWeight: 800, color: colorMap[c.type] || '#6366f1', textTransform: 'uppercase', letterSpacing: 0.5 }}>{labelMap[c.type] || c.type}</span>
                        </div>
                        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>{c.text}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ถ้าไม่มี versions แสดง summary แบบเดิม */}
            {(!analysisResult.versions || analysisResult.versions.length === 0) && analysisResult.summary && (
              <div style={{ background: 'var(--bg-primary)', padding: 20, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--warning)', borderLeft: '4px solid var(--warning)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--warning)', marginBottom: 12 }}>🤖 ผลลัพธ์</div>
                <div style={{ fontSize: 15, lineHeight: 2, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{analysisResult.summary}</div>
              </div>
            )}

            {/* Debug Panel */}
            {(analysisResult.debug || analysisResult.smartMatch) && (
              <details style={{ marginBottom: 16 }}>
                <summary style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', cursor: 'pointer', padding: '8px 0' }}>🔍 Debug — ตรวจสอบเบื้องหลังการเลือก Prompt</summary>
                
                {/* 1. NEW SMART MATCH ENGINE DEBUG UI */}
                {analysisResult.smartMatch && (
                  <div style={{ background: '#1e1e1e', color: '#e4e4e7', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 16, fontFamily: 'monospace', fontSize: 11 }}>
                    <h4 style={{ color: '#38bdf8', marginBottom: 8, fontSize: 12 }}>🧬 1. News Analysis Profile (DNA ของข่าว)</h4>
                    <div style={{ background: '#000', padding: 8, borderRadius: 6, marginBottom: 16, maxHeight: 150, overflow: 'auto' }}>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                        {JSON.stringify(analysisResult.smartMatch.newsAnalysis, null, 2)}
                      </pre>
                    </div>

                    <h4 style={{ color: '#a78bfa', marginBottom: 8, fontSize: 12 }}>🏆 2. Top 10 Prompts Scores (การให้คะแนน)</h4>
                    <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
                      {analysisResult.smartMatch.top10PromptScores?.map((p, i) => (
                        <div key={i} style={{ 
                          background: i === 0 ? 'rgba(167, 139, 250, 0.15)' : '#000', 
                          padding: 8, 
                          borderRadius: 6,
                          borderLeft: i === 0 ? '3px solid #a78bfa' : '3px solid #3f3f46',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                        }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: i === 0 ? '#a78bfa' : '#e4e4e7' }}>
                              #{i+1} {p.name}
                            </div>
                            <div style={{ color: '#a1a1aa', marginTop: 2, fontSize: 10 }}>
                              Matched: {p.matchedDimensions?.join(', ') || 'None'}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 14, fontWeight: 800, color: p.score >= 50 ? '#34d399' : '#fbbf24' }}>
                              {p.score.toFixed(1)}
                            </div>
                            <div style={{ fontSize: 9, color: '#71717a' }}>{p.matchType}</div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div style={{ paddingTop: 8, borderTop: '1px solid #3f3f46', color: '#9ca3af', fontSize: 10 }}>
                      <p>Total Prompts Evaluated: {analysisResult.smartMatch.candidatesAfterFilter} / {analysisResult.smartMatch.totalPromptsLoaded}</p>
                      <p>Fallback Status: {analysisResult.smartMatch.whyFallbackUsed || 'None (Native Match)'}</p>
                    </div>
                  </div>
                )}

                {/* 2. LEGACY DEBUG INFO */}
                {analysisResult.debug && (
                  <div style={{ background: 'var(--bg-primary)', padding: 12, borderRadius: 'var(--radius-sm)', marginTop: 4, fontSize: 11, color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                    <div>📏 Prompt ความยาว: {analysisResult.debug.promptLength?.toLocaleString()} ตัวอักษร</div>
                    <div>📰 เนื้อข่าว: {analysisResult.debug.newsBodyLength?.toLocaleString()} ตัวอักษร</div>
                    <div>📌 ประเด็นที่แตก: {analysisResult.debug.breakdownPointsCount} ประเด็น</div>
                    <div>🎯 Preset: {analysisResult.debug.presetUsed}</div>
                    <div style={{ padding: '8px 10px', margin: '6px 0', borderRadius: 6, background: analysisResult.debug.promptSource === 'library' ? 'rgba(139,92,246,0.1)' : 'rgba(100,116,139,0.08)', border: `1px solid ${analysisResult.debug.promptSource === 'library' ? 'rgba(139,92,246,0.3)' : 'rgba(100,116,139,0.2)'}` }}>
                      <div style={{ fontWeight: 700, color: analysisResult.debug.promptSource === 'library' ? '#a78bfa' : '#94a3b8' }}>
                        {analysisResult.debug.promptSource === 'library' ? '🏛️ Prompt Library → ใช้จริง' : '📦 Prompt Library → ไม่ได้ใช้'}
                      </div>
                      {analysisResult.debug.smartPromptName && <div>📛 ชื่อ Prompt: {analysisResult.debug.smartPromptName}</div>}
                      {analysisResult.debug.smartPromptScore && <div>⭐ Viral Score: {analysisResult.debug.smartPromptScore}/100</div>}
                      {analysisResult.debug.promptMatchReason && <div>🔍 เหตุผล: {analysisResult.debug.promptMatchReason}</div>}
                    </div>
                    <div>🔗 มี Breakdown: {analysisResult.debug.hasBreakdown ? '✅ ใช่' : '❌ ไม่'}</div>
                    <div>🆔 Workflow: {analysisResult.debug.workflowId}</div>
                    <div>💾 Context: {analysisResult.debug.contextSource}</div>
                    {analysisResult.validation && (
                      <div style={{ marginTop: 6, color: analysisResult.validation.valid ? 'var(--success)' : 'var(--warning)' }}>
                        ✅ Validation: {analysisResult.validation.valid ? 'PASS' : `⚠️ ${analysisResult.validation.issues.join(', ')}`}
                      </div>
                    )}
                  </div>
                )}
              </details>
            )}

            {/* ปุ่มวิเคราะห์ใหม่ */}
            <div style={{ paddingTop: 16, borderTop: '1px solid var(--border)', marginBottom: 16 }}>
              <button className="btn btn-outline" disabled={loading} onClick={() => handleAnalyze()}
                style={{ fontSize: 12 }}>
                {loading ? '⏳ สร้างใหม่...' : '🔄 สร้างใหม่ (AI เลือก Prompt อัตโนมัติ)'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={handleReset} className="btn btn-primary btn-lg" style={{ flex: 1 }}>
                🔄 สร้างคอนเทนต์ใหม่
              </button>
              {Object.keys(sentToReview).length > 0 && (
                <a href="/review" className="btn btn-lg"
                  style={{ flex: 1, background: 'linear-gradient(135deg, #0ea5e9, #6366f1)', border: 'none', color: '#fff', fontWeight: 700, textDecoration: 'none', textAlign: 'center', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  📋 ไปดูคลังรอตรวจ ({Object.keys(sentToReview).length} รายการ)
                </a>
              )}
            </div>
    </>
  );
}
