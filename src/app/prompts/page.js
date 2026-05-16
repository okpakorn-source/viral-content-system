'use client';
import Header from '@/components/layout/Header';
import { CONTENT_ANALYSIS_PROMPT, VIRAL_ANGLE_PROMPT, ARTICLE_GENERATION_PROMPT, QUALITY_SCORING_PROMPT } from '@/lib/ai/prompts';
import { useState } from 'react';

const promptList = [
  { key: 'analysis', name: '🔍 วิเคราะห์เนื้อหา', phase: 'Phase 1', prompt: CONTENT_ANALYSIS_PROMPT },
  { key: 'angle', name: '🎯 มุมมองไวรัล', phase: 'Phase 2', prompt: VIRAL_ANGLE_PROMPT },
  { key: 'article', name: '✍️ เขียนบทความ', phase: 'Phase 3', prompt: ARTICLE_GENERATION_PROMPT },
  { key: 'quality', name: '✅ ตรวจคุณภาพ', phase: 'Phase 6', prompt: QUALITY_SCORING_PROMPT },
];

export default function PromptsPage() {
  const [selected, setSelected] = useState('analysis');
  const current = promptList.find(p => p.key === selected);

  return (
    <>
      <Header title="🤖 จัดการ AI Prompts" subtitle="ดูและจัดการ prompt templates สำหรับแต่ละเฟส" />
      <div className="page-content">
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 20 }}>
          <div className="card" style={{ padding: 16 }}>
            {promptList.map((p) => (
              <button
                key={p.key}
                onClick={() => setSelected(p.key)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '10px 14px', marginBottom: 6,
                  background: selected === p.key ? 'var(--accent-glow)' : 'transparent',
                  border: 'none', borderRadius: 'var(--radius-sm)',
                  color: selected === p.key ? 'var(--accent-light)' : 'var(--text-secondary)',
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: selected === p.key ? 600 : 400,
                }}
              >
                {p.name}
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{p.phase}</div>
              </button>
            ))}
          </div>

          {current && (
            <div className="card">
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>{current.name}</h3>
              
              <div className="form-group">
                <label className="form-label">System Prompt</label>
                <textarea className="form-textarea" style={{ minHeight: 200, fontSize: 12, fontFamily: 'monospace' }} defaultValue={current.prompt.system} />
              </div>

              <div className="form-group">
                <label className="form-label">User Prompt Template</label>
                <textarea className="form-textarea" style={{ minHeight: 300, fontSize: 12, fontFamily: 'monospace' }} defaultValue={current.prompt.user} />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-primary">💾 บันทึก</button>
                <button className="btn btn-outline">↩️ รีเซ็ต</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
