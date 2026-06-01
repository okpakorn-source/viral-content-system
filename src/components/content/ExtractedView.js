'use client';
import React from 'react';

export default function ExtractedView({ states, setters, handlers, utils }) {
  const { newsData, copied, breakdownPromptText, loading, blueprinting, blueprintData, editedBlueprint, researchData, researching, selectedResearch, addedResearchItems, breakdownData, customPrompt, sourceType, contentLength, workflowId } = states;
  const { copyText, setBreakdownPromptText, handleBreakdown, handleBlueprint, setEditedBlueprint, handleResearch, toggleResearchItem, setSelectedResearch, handleAddResearch, handleMixAngles, handleAnalyze, setContentLength } = handlers;

  return (
    <>
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
                  <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 20, border: newsData.newsBody?.includes('=== ข้อมูลเพิ่มเติมจาก AI Research ===') ? '2px solid #0ea5e9' : '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>📝 เนื้อข่าวที่สกัดได้ ({newsData.newsBody?.length || 0} ตัวอักษร)</span>
                        {newsData.newsBody?.includes('=== ข้อมูลเพิ่มเติมจาก AI Research ===') && (
                          <span style={{ fontSize: 9, padding: '2px 8px', background: 'rgba(14,165,233,0.2)', color: '#38bdf8', borderRadius: 10, fontWeight: 700 }}>🔎 มีข้อมูลเสริม</span>
                        )}
                        {copied === 'research_added' && (
                          <span style={{ fontSize: 10, padding: '3px 10px', background: 'var(--success-bg)', color: 'var(--success)', borderRadius: 10, fontWeight: 700, animation: 'fadeIn 0.3s' }}>✅ เพิ่มข้อมูลเข้าเนื้อข่าวแล้ว!</span>
                        )}
                      </div>
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
                    <label className="form-label">✏️ คำสั่งเพิ่มเติม (ไม่บังคับ — Prompt หลักถูกตั้งค่าในระบบแล้ว)</label>
                    <textarea className="form-textarea" value={breakdownPromptText} onChange={(e) => setBreakdownPromptText(e.target.value)}
                      placeholder="เช่น: เน้นมุมดราม่ามากขึ้น, แตกประเด็นเรื่องตัวเลขให้ละเอียด, หาจุดที่คนจะอิน..."
                      style={{ minHeight: 50, fontSize: 13 }} />
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ fontSize: 10, color: 'var(--text-muted)', cursor: 'pointer' }}>🔍 ดู Prompt หลักที่ระบบใช้จริง (Viral News Angle Strategist 7-Step)</summary>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: 10, borderRadius: 6, marginTop: 4, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                        {`คุณคือ AI Viral News Angle Strategist + Emotional Storytelling Director\n\nSTEP 1: วิเคราะห์แก่นข่าว (core story, emotional core, conflict, characters)\nSTEP 2: แตกประเด็น 12 หมวด (ดราม่า, ความรัก, ครอบครัว, social pressure, แรงบันดาลใจ, ถกเถียง, ฟิน, ชื่นชม, เซอร์ไพรส์...)\nSTEP 3: วิเคราะห์พลัง viral ของแต่ละมุม (อิน/คอมเมนต์/แชร์/trigger)\nSTEP 4: เลือกมุมที่ดีที่สุด (emotional impact / share / FB friendly)\nSTEP 5: วิเคราะห์ลูกเล่นภาษา (opening/storytelling/pacing/ending)\nSTEP 6: Safety rules (ห้ามบิดข่าว ห้ามแต่งเรื่อง)\nSTEP 7: Output JSON (core_story, possible_angles, best_angle, language_strategy)\n\n⚠️ Prompt นี้ถูกใช้จริง 100% ทุกครั้งที่กดแตกประเด็น`}
                      </div>
                    </details>
                  </div>
      
                  <button type="button" onClick={handleBreakdown} className="btn btn-viral btn-lg"
                    style={{ width: '100%' }} disabled={loading}>
                    {loading ? '⏳ กำลังแตกประเด็น...' : '🔍 AI แตกประเด็น + สรุปใจความสำคัญ'}
                  </button>
      
                  {/* ===== Breakdown results แสดงต่อเลย (หน้าเดียวกัน) ===== */}
                  {breakdownData && (
                    <div style={{ marginTop: 20 }}>
                      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>🔍 AI แตกประเด็น + สรุปใจความ</h3>
      
      
                  {/* สรุปรวม */}
                  <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--accent)', borderLeft: '4px solid var(--accent)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-light)', marginBottom: 6 }}>📋 สรุปรวมข่าว</div>
                    <div style={{ fontSize: 14, lineHeight: 2, color: 'var(--text-secondary)' }}>{breakdownData.news_summary}</div>
                  </div>
      
                  {/* Core Analysis Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                    {breakdownData.core_story && (
                      <div style={{ background: 'var(--bg-primary)', padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--info)' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--info)', marginBottom: 4 }}>🎯 แก่นข่าว</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{breakdownData.core_story}</div>
                      </div>
                    )}
                    {breakdownData.main_emotional_core && (
                      <div style={{ background: 'var(--bg-primary)', padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--warning)' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--warning)', marginBottom: 4 }}>💖 แก่น Emotional</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{breakdownData.main_emotional_core}</div>
                      </div>
                    )}
                    {breakdownData.conflict_point && (
                      <div style={{ background: 'var(--bg-primary)', padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--danger)' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--danger)', marginBottom: 4 }}>⚔️ จุด Conflict</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{breakdownData.conflict_point}</div>
                      </div>
                    )}
                    {breakdownData.viral_trigger && (
                      <div style={{ background: 'var(--bg-primary)', padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--viral)' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--viral)', marginBottom: 4 }}>🔥 Viral Trigger</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{breakdownData.viral_trigger}</div>
                      </div>
                    )}
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
                              {kp.category && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 8, background: 'var(--info-bg)', color: 'var(--info)' }}>🏷️ {kp.category}</span>}
                              <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 8, background: kp.importance === 'สูง' ? 'var(--danger-bg)' : 'var(--bg-tertiary)', color: kp.importance === 'สูง' ? 'var(--danger)' : 'var(--text-muted)' }}>⚡ {kp.importance}</span>
                              <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 8, background: kp.emotional_value === 'สูง' ? 'var(--warning-bg)' : 'var(--bg-tertiary)', color: kp.emotional_value === 'สูง' ? 'var(--warning)' : 'var(--text-muted)' }}>💖 {kp.emotional_value}</span>
                              {kp.viral_potential && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 8, background: kp.viral_potential === 'สูง' ? 'var(--viral-bg)' : 'var(--bg-tertiary)', color: kp.viral_potential === 'สูง' ? 'var(--viral)' : 'var(--text-muted)' }}>🔥 {kp.viral_potential}</span>}
                            </div>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>{kp.detail}</div>
                        </div>
                      ))}
                    </div>
                  )}
      
                  {/* Possible Angles with Viral Scores */}
                  {breakdownData.possible_angles?.length > 0 && (
                    <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--viral)' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--viral)', marginBottom: 10 }}>🎯 มุมเล่าทั้งหมด ({breakdownData.possible_angles.length} มุม)</div>
                      {breakdownData.possible_angles.map((a, i) => (
                        <div key={i} style={{ padding: '12px', marginBottom: 8, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', borderLeft: `4px solid hsl(${(a.facebook_viral_score || 5) * 12}, 70%, 50%)` }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 800 }}>{a.angle_name}</span>
                            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: (a.facebook_viral_score || 0) >= 7 ? 'var(--success-bg)' : 'var(--bg-tertiary)', color: (a.facebook_viral_score || 0) >= 7 ? 'var(--success)' : 'var(--text-muted)' }}>🔥 {a.facebook_viral_score}/10</span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{a.description}</div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                            {a.target_emotion && <span style={{ fontSize: 9, padding: '2px 6px', background: 'var(--warning-bg)', color: 'var(--warning)', borderRadius: 8 }}>🎭 {a.target_emotion}</span>}
                            {a.share_trigger && <span style={{ fontSize: 9, padding: '2px 6px', background: 'var(--info-bg)', color: 'var(--info)', borderRadius: 8 }}>📤 {a.share_trigger}</span>}
                            {a.comment_trigger && <span style={{ fontSize: 9, padding: '2px 6px', background: 'var(--success-bg)', color: 'var(--success)', borderRadius: 8 }}>💬 {a.comment_trigger}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
      
                  {/* Best Main Angle */}
                  {breakdownData.best_main_angle && (
                    <div style={{ background: 'linear-gradient(135deg, var(--bg-primary), var(--accent-bg))', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '2px solid var(--accent)' }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--accent-light)', marginBottom: 8 }}>🏆 มุมที่ดีที่สุด: {breakdownData.best_main_angle.angle_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: 8 }}>{breakdownData.best_main_angle.why_best}</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {breakdownData.best_main_angle.emotional_strength && <span style={{ fontSize: 9, padding: '3px 8px', background: 'var(--warning-bg)', color: 'var(--warning)', borderRadius: 10 }}>💪 {breakdownData.best_main_angle.emotional_strength}</span>}
                        {breakdownData.best_main_angle.facebook_safety && <span style={{ fontSize: 9, padding: '3px 8px', background: 'var(--success-bg)', color: 'var(--success)', borderRadius: 10 }}>🛡️ {breakdownData.best_main_angle.facebook_safety}</span>}
                        {breakdownData.best_main_angle.share_potential && <span style={{ fontSize: 9, padding: '3px 8px', background: 'var(--info-bg)', color: 'var(--info)', borderRadius: 10 }}>📤 {breakdownData.best_main_angle.share_potential}</span>}
                      </div>
                    </div>
                  )}
      
                  {/* Language Strategy */}
                  {breakdownData.language_strategy && (
                    <div style={{ background: 'var(--bg-primary)', padding: 14, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--info)' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--info)', marginBottom: 8 }}>✍️ กลยุทธ์ภาษา</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        {breakdownData.language_strategy.opening_style && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}><strong>เปิด:</strong> {breakdownData.language_strategy.opening_style}</div>}
                        {breakdownData.language_strategy.storytelling_style && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}><strong>เล่า:</strong> {breakdownData.language_strategy.storytelling_style}</div>}
                        {breakdownData.language_strategy.emotional_pacing && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}><strong>จังหวะ:</strong> {breakdownData.language_strategy.emotional_pacing}</div>}
                        {breakdownData.language_strategy.ending_style && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}><strong>ปิด:</strong> {breakdownData.language_strategy.ending_style}</div>}
                      </div>
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
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 8 }}>💡 Prompt หลัก (7-Step Viral Angle Strategist) ถูกใช้จริงทุกครั้ง — ช่องนี้เป็น &quot;คำสั่งเพิ่มเติม&quot; เท่านั้น</div>
                    <button onClick={handleBreakdown} className="btn btn-outline" disabled={loading} style={{ width: '100%' }}>
                      {loading ? '⏳ กำลังแตกใหม่...' : '🔄 แตกประเด็นใหม่ตามคำสั่ง'}
                    </button>
                  </div>
      
                  {/* 🧬 Emotional Architecture Blueprint */}
                  <div style={{ background: 'linear-gradient(135deg, rgba(168,85,247,0.12), rgba(236,72,153,0.10))', padding: 20, borderRadius: 'var(--radius-md)', border: '2px solid rgba(168,85,247,0.4)', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 22 }}>🧬</span>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 800, color: '#c084fc' }}>Emotional Architecture Blueprint</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>AI วางแผนโครงสร้างอารมณ์ก่อนเขียน — ทำให้เนื้อหาอ่านลื่นและอินเหมือนมนุษย์เขียนจริง</div>
                        </div>
                      </div>
                      <button onClick={handleBlueprint} disabled={blueprinting || loading}
                        style={{ background: 'linear-gradient(135deg, #a855f7, #ec4899)', border: 'none', color: '#fff', fontWeight: 700, fontSize: 12, padding: '10px 18px', borderRadius: 'var(--radius-md)', cursor: (blueprinting || loading) ? 'wait' : 'pointer', whiteSpace: 'nowrap', boxShadow: '0 2px 10px rgba(168,85,247,0.3)' }}>
                        {blueprinting ? '⏳ วางแผน...' : (blueprintData ? '🔄 วางใหม่' : '🧬 วางแผนโครงสร้าง')}
                      </button>
                    </div>
      
                    {/* Blueprint Result */}
                    {editedBlueprint && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      
                        {/* Core Emotion */}
                        <div style={{ background: 'var(--bg-primary)', borderRadius: 10, padding: '12px 14px', border: '1px solid rgba(168,85,247,0.2)' }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#c084fc', marginBottom: 6 }}>🎯 CORE EMOTION — แกนอารมณ์หลัก</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 18, fontWeight: 900, color: '#f0abfc' }}>{editedBlueprint.core_emotion}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-secondary)', flex: 1 }}>{editedBlueprint.emotion_reason}</span>
                          </div>
                        </div>
      
                        {/* Emotional Timeline */}
                        <div style={{ background: 'var(--bg-primary)', borderRadius: 10, padding: '12px 14px', border: '1px solid rgba(168,85,247,0.2)' }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#c084fc', marginBottom: 8 }}>📅 EMOTIONAL TIMELINE — ลำดับปล่อยข้อมูล</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {(editedBlueprint.emotional_timeline || []).map((step, i) => (
                              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                <span style={{ fontSize: 10, background: 'rgba(168,85,247,0.2)', color: '#c084fc', borderRadius: 4, padding: '2px 6px', flexShrink: 0, fontWeight: 700, minWidth: 20, textAlign: 'center' }}>{i + 1}</span>
                                <input
                                  value={step}
                                  onChange={e => {
                                    const arr = [...(editedBlueprint.emotional_timeline || [])]; arr[i] = e.target.value;
                                    setEditedBlueprint(prev => ({ ...prev, emotional_timeline: arr }));
                                  }}
                                  style={{ flex: 1, fontSize: 12, background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--text-primary)', padding: '2px 0', outline: 'none' }}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
      
                        {/* Emotional Branches */}
                        <div style={{ background: 'var(--bg-primary)', borderRadius: 10, padding: '12px 14px', border: '1px solid rgba(168,85,247,0.2)' }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#c084fc', marginBottom: 8 }}>⚡ EMOTIONAL BRANCHES — จุดดันอารมณ์</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {(editedBlueprint.emotional_branches || []).map((b, i) => (
                              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 6, background: 'rgba(236,72,153,0.15)', color: '#f9a8d4', flexShrink: 0, whiteSpace: 'nowrap' }}>{b.branch_type}</span>
                                <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{b.content}</span>
                              </div>
                            ))}
                          </div>
                        </div>
      
                        {/* Bridges */}
                        <div style={{ background: 'var(--bg-primary)', borderRadius: 10, padding: '12px 14px', border: '1px solid rgba(168,85,247,0.2)' }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#c084fc', marginBottom: 8 }}>🌉 BRIDGES — ประโยคเชื่อม</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {(editedBlueprint.bridges || []).map((b, i) => (
                              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <span style={{ fontSize: 14, color: '#c084fc', flexShrink: 0 }}>•</span>
                                <input
                                  value={b}
                                  onChange={e => {
                                    const arr = [...(editedBlueprint.bridges || [])]; arr[i] = e.target.value;
                                    setEditedBlueprint(prev => ({ ...prev, bridges: arr }));
                                  }}
                                  style={{ flex: 1, fontSize: 12, background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--text-primary)', padding: '3px 0', outline: 'none' }}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
      
                        {/* Forbidden */}
                        {editedBlueprint.forbidden?.length > 0 && (
                          <div style={{ background: 'rgba(239,68,68,0.08)', borderRadius: 10, padding: '10px 14px', border: '1px solid rgba(239,68,68,0.2)' }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: '#f87171', marginBottom: 6 }}>❌ ห้ามเฉพาะข่าวนี้</div>
                            {editedBlueprint.forbidden.map((f, i) => (
                              <div key={i} style={{ fontSize: 11, color: '#fca5a5', marginBottom: 2 }}>• {f}</div>
                            ))}
                          </div>
                        )}
      
                        {/* Apply Blueprint badge */}
                        <div style={{ fontSize: 10, color: '#c084fc', textAlign: 'center', padding: '6px', background: 'rgba(168,85,247,0.08)', borderRadius: 8 }}>
                          ✅ Blueprint นี้จะถูกส่งไปพร้อมกับการสร้างเนื้อหาอัตโนมัติ — แก้ไขได้โดยตรงโดยตรงก่อนกด &quot;สร้างเนื้อหา&quot;
                        </div>
                      </div>
                    )}
                  </div>
      
                  {/* 🔎 AI หาข้อมูลเพิ่มเติม — Research Agent (Serper Real Search) */}
                  <div style={{ background: 'linear-gradient(135deg, rgba(14,165,233,0.12), rgba(6,182,212,0.12))', padding: 20, borderRadius: 'var(--radius-md)', border: '2px solid rgba(14,165,233,0.4)', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 22 }}>🔎</span>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 800, color: '#38bdf8' }}>AI หาข้อมูลเพิ่มเติม</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>ค้นหาจริงผ่าน Google — สกัด keyword จากเนื้อข่าว → ค้นพร้อมกัน 5-10 คำ → ข้อมูลจริงพร้อม URL แหล่งอ้างอิง</div>
                        </div>
                      </div>
                      <button onClick={handleResearch} className="btn" disabled={researching || loading}
                        style={{ background: 'linear-gradient(135deg, #0ea5e9, #06b6d4)', border: 'none', color: '#fff', fontWeight: 700, fontSize: 12, padding: '10px 20px', borderRadius: 'var(--radius-md)', cursor: (researching || loading) ? 'wait' : 'pointer', whiteSpace: 'nowrap', boxShadow: '0 2px 10px rgba(14,165,233,0.3)' }}>
                        {researching ? '🔎 กำลังค้นหา...' : '+ หาข้อมูลเพิ่ม'}
                      </button>
                    </div>
      
                    {/* แสดง keywords ที่ค้นหา */}
                    {researchData?.keywords?.length > 0 && (
                      <div style={{ marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', alignSelf: 'center' }}>🔑 ค้นหา:</span>
                        {researchData.keywords.map((kw, i) => (
                          <span key={i} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(14,165,233,0.15)', color: '#38bdf8', border: '1px solid rgba(14,165,233,0.3)' }}>{kw}</span>
                        ))}
                        {researchData.duration && <span style={{ fontSize: 10, color: 'var(--text-muted)', alignSelf: 'center', marginLeft: 4 }}>({researchData.duration}s)</span>}
                      </div>
                    )}
      
                    {/* แสดงผลข้อมูลที่หาได้ */}
                    {researchData?.items?.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#38bdf8' }}>
                            📚 พบ {researchData.items.length} รายการจากการค้นหาจริง
                          </div>
                          <button onClick={() => setSelectedResearch(researchData.items.map((_, i) => i))}
                            style={{ fontSize: 10, padding: '3px 10px', borderRadius: 8, background: 'rgba(14,165,233,0.2)', border: '1px solid #38bdf8', color: '#38bdf8', cursor: 'pointer' }}>
                            เลือกทั้งหมด
                          </button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {researchData.items.map((item, idx) => (
                            <div key={idx} onClick={() => toggleResearchItem(idx)}
                              style={{
                                padding: '12px 14px', borderRadius: 'var(--radius-sm)',
                                background: selectedResearch.includes(idx) ? 'rgba(14,165,233,0.12)' : 'var(--bg-secondary)',
                                border: selectedResearch.includes(idx) ? '2px solid #38bdf8' : '1px solid var(--border)',
                                cursor: 'pointer', transition: 'all 0.2s',
                              }}>
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                                {/* Checkbox */}
                                <div style={{
                                  width: 20, height: 20, borderRadius: 4, border: '2px solid',
                                  borderColor: selectedResearch.includes(idx) ? '#38bdf8' : 'var(--border)',
                                  background: selectedResearch.includes(idx) ? '#38bdf8' : 'transparent',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  flexShrink: 0, marginTop: 2, fontSize: 12, color: '#fff',
                                }}>
                                  {selectedResearch.includes(idx) && '✓'}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  {/* Type badge + keyword + title */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                                    <span style={{
                                      fontSize: 9, padding: '2px 6px', borderRadius: 8, flexShrink: 0,
                                      background: item.type === 'person' ? 'rgba(139,92,246,0.2)' :
                                        item.type === 'statistic' ? 'rgba(245,158,11,0.2)' :
                                        item.type === 'law' ? 'rgba(59,130,246,0.2)' :
                                        item.type === 'event' ? 'rgba(239,68,68,0.2)' :
                                        item.type === 'medical' ? 'rgba(16,185,129,0.2)' : 'rgba(100,116,139,0.2)',
                                      color: item.type === 'person' ? '#a78bfa' :
                                        item.type === 'statistic' ? '#fbbf24' :
                                        item.type === 'law' ? '#60a5fa' :
                                        item.type === 'event' ? '#f87171' :
                                        item.type === 'medical' ? '#34d399' : '#94a3b8',
                                    }}>
                                      {item.type === 'person' ? '👤' : item.type === 'statistic' ? '📊' :
                                       item.type === 'law' ? '⚖️' : item.type === 'event' ? '📰' :
                                       item.type === 'medical' ? '🏥' : '📋'} {item.keyword || item.type}
                                    </span>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{item.title}</span>
                                  </div>
                                  {/* Content */}
                                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 6 }}>{item.content}</div>
                                  {/* Source URL */}
                                  {item.sourceUrl && (
                                    <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer"
                                      onClick={e => e.stopPropagation()}
                                      style={{ fontSize: 10, color: '#38bdf8', display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none', background: 'rgba(14,165,233,0.1)', padding: '2px 8px', borderRadius: 6, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      🌐 {item.sourceName || item.sourceUrl}
                                    </a>
                                  )}
                                  {item.relevance && (
                                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>💡 {item.relevance}</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
      
                        {/* ไม่พบ */}
                        {researchData?.notFound?.length > 0 && (
                          <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(100,116,139,0.1)', borderRadius: 8, fontSize: 10, color: 'var(--text-muted)' }}>
                            🔍 ไม่พบข้อมูล: {researchData.notFound.join(', ')}
                          </div>
                        )}
      
                        {/* ปุ่มเพิ่มข้อมูล */}
                        {selectedResearch.length > 0 && (
                          <button onClick={handleAddResearch} className="btn btn-lg"
                            style={{ width: '100%', marginTop: 12, background: 'linear-gradient(135deg, #0ea5e9, #06b6d4)', border: 'none', color: '#fff', fontWeight: 800, fontSize: 13, padding: '12px 0', borderRadius: 'var(--radius-md)', cursor: 'pointer', boxShadow: '0 3px 12px rgba(14,165,233,0.3)' }}>
                            {`📥 เพิ่ม ${selectedResearch.length} ข้อมูล (พร้อม URL) เข้าเนื้อข่าว`}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
      
                  {/* 🧬 AI ผสมมุมข่าว — เลือกหัวข้อดีมาผสมเป็นเนื้อหาใหม่ */}
                  <div style={{ background: 'linear-gradient(135deg, rgba(168,85,247,0.15), rgba(236,72,153,0.15))', padding: 20, borderRadius: 'var(--radius-md)', border: '2px solid rgba(168,85,247,0.5)', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 22 }}>🧬</span>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: '#c084fc' }}>AI ผสมมุมข่าว — สร้างเนื้อหาไวรัลใหม่</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>AI จะเลือกมุมที่ดีที่สุดจากผลวิเคราะห์ด้านบน ผสมเข้าด้วยกัน สร้างเนื้อหาใหม่ที่น่าอ่านและไวรัลได้</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                      {breakdownData.possible_angles?.slice(0, 5).map((a, i) => (
                        <span key={i} style={{ fontSize: 9, padding: '3px 8px', background: 'rgba(168,85,247,0.2)', color: '#c084fc', borderRadius: 10, border: '1px solid rgba(168,85,247,0.3)' }}>
                          {a.angle_name} {a.facebook_viral_score >= 7 ? '🔥' : ''}
                        </span>
                      ))}
                      <span style={{ fontSize: 9, padding: '3px 8px', color: 'var(--text-muted)' }}>→ AI เลือก + ผสม</span>
                    </div>
                    <button onClick={handleMixAngles} className="btn btn-lg" disabled={loading}
                      style={{ width: '100%', background: 'linear-gradient(135deg, #7c3aed, #db2777)', border: 'none', color: '#fff', fontWeight: 800, fontSize: 14, padding: '14px 0', borderRadius: 'var(--radius-md)', cursor: loading ? 'wait' : 'pointer', transition: 'all 0.3s', boxShadow: '0 4px 15px rgba(124,58,237,0.3)' }}>
                      {loading ? '🧬 AI กำลังผสมมุมข่าว...' : '🧬 AI เลือก + ผสมมุมข่าว สร้างเนื้อหาไวรัลใหม่'}
                    </button>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center' }}>ยึด Prompt + Safety Rules ครบทุกข้อ • ใช้ข้อมูลจากข่าวจริงเท่านั้น</div>
                  </div>
      
                  {/* 📏 เลือกความยาวเนื้อหา */}
                  <div style={{ background: 'var(--bg-primary)', padding: 20, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>📏 เลือกความยาวเนื้อหา</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>ข่าวที่มีข้อมูลเสริมเยอะ ใช้ความยาวมากจะได้เนื้อหาครบถ้วนกว่า</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                      {[
                        { id: 'short', label: '📝 สั้นกระชับ', range: '250-300 คำ', desc: 'โพสต์ไวรัลมาตรฐาน', para: '3 ย่อหน้า', color: '#22c55e' },
                        { id: 'medium', label: '📄 ปานกลาง', range: '400-500 คำ', desc: 'มีข้อมูลเสริมเพิ่ม', para: '4-5 ย่อหน้า', color: '#f59e0b' },
                        { id: 'long', label: '📰 ยาวครบถ้วน', range: '500-1000 คำ', desc: 'ข่าวเจาะลึก เต็มรายละเอียด', para: '6-8 ย่อหน้า', color: '#ef4444' },
                      ].map(opt => (
                        <div key={opt.id} onClick={() => setContentLength(opt.id)}
                          style={{
                            padding: '14px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                            background: contentLength === opt.id ? `${opt.color}15` : 'var(--bg-secondary)',
                            border: contentLength === opt.id ? `2px solid ${opt.color}` : '1px solid var(--border)',
                            transition: 'all 0.2s',
                          }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: contentLength === opt.id ? opt.color : 'var(--text-primary)', marginBottom: 2 }}>{opt.label}</div>
                          <div style={{ fontSize: 15, fontWeight: 900, color: opt.color, marginBottom: 4 }}>{opt.range}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{opt.para} • {opt.desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>
      
                  {/* สร้างเนื้อหา — AI เลือก Prompt จากหอสมุดอัตโนมัติ */}
                  <div style={{ background: 'var(--bg-primary)', padding: 20, borderRadius: 'var(--radius-md)', border: '2px solid var(--accent)' }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--accent-light)', marginBottom: 4 }}>🧠 AI เลือก Prompt จากหอสมุดอัตโนมัติ</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>AI จะวิเคราะห์แนวข่าว → เทียบกับ Prompt ในหอสมุด → เลือกที่ตรงที่สุดมาใช้</div>
                    <button type="button" disabled={loading} onClick={() => handleAnalyze()}
                      style={{ width: '100%', padding: '14px 20px', border: 'none', borderRadius: 'var(--radius-md)', background: 'linear-gradient(135deg, #7c3aed, #3b82f6)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: loading ? 'wait' : 'pointer', boxShadow: '0 4px 15px rgba(124,58,237,0.3)' }}>
                      {loading ? '⏳ AI กำลังวิเคราะห์และเลือก Prompt...' : '⚡ สร้างเนื้อหา (AI เลือก Prompt จากหอสมุดให้)'}
                    </button>
                  </div>
                </div>
              )}
            </div>
    </>
  );
}