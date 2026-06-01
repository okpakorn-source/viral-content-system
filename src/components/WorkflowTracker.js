'use client';
import { useState, useEffect, useRef } from 'react';
import { useWorkflow } from './WorkflowContext';

// ─── Step metadata: model, prompt, API จริงๆ ─────────────────────
const STEP_META = {
  // Auto Pipeline (Enhanced)
  auto_detect:    { model: null,          prompt: null,              api: null,               icon: '🔍', color: '#64748b' },
  auto_scrape:    { model: null,          prompt: null,              api: '/api/auto',        icon: '📡', color: '#3b82f6' },
  auto_extract:   { model: 'GPT-4o-mini', prompt: 'EXTRACT prompt', api: '/api/auto (step)', icon: '📰', color: '#8b5cf6' },
  auto_breakdown: { model: 'GPT-4o-mini', prompt: 'BREAKDOWN prompt',api: '/api/auto (step)',icon: '🔍', color: '#f59e0b' },
  auto_blueprint: { model: 'GPT-4o',      prompt: 'BLUEPRINT prompt',api: '/api/auto (step)',icon: '🧬', color: '#ec4899' },
  auto_research:  { model: 'GPT-4o-mini', prompt: 'KEYWORD prompt', api: 'Serper Google API',icon: '🌐', color: '#06b6d4' },
  auto_classic:   { model: 'Claude',      prompt: 'Multi-Angle prompts from Library', api: '/api/summarize ×N', icon: '⚡', color: '#22c55e' },
  auto_enhanced:  { model: 'Claude',      prompt: 'Enhanced + Blueprint inject', api: '/api/summarize ×N', icon: '🚀', color: '#a3e635' },
  // Universal Pipeline (Local — Image/Hybrid)
  u_detect:       { model: null,          prompt: null,              api: '/api/auto/detect',  icon: '🔍', color: '#64748b' },
  u_extract:      { model: 'GPT-4o-mini', prompt: null,              api: '/api/auto/process', icon: '⚙️', color: '#8b5cf6' },
  u_normalize:    { model: null,          prompt: null,              api: null,                icon: '📐', color: '#06b6d4' },
  u_generate:     { model: 'Claude',      prompt: 'Library prompt',  api: '/api/summarize',    icon: '✍️', color: '#22c55e' },
  // Manual steps
  scrape:         { model: null,          prompt: null,              api: '/api/extract',     icon: '📡', color: '#3b82f6' },
  ai_extract:     { model: 'GPT-4o-mini', prompt: 'EXTRACT prompt', api: '/api/summarize',   icon: '📰', color: '#8b5cf6' },
  ai_breakdown:   { model: 'GPT-4o-mini', prompt: 'BREAKDOWN prompt',api: '/api/summarize',  icon: '🔍', color: '#f59e0b' },
  lib_check:      { model: 'GPT-4o-mini', prompt: 'AI Smart Match → Prompt Library', api: '/api/summarize', icon: '🏛️', color: '#a3e635' },
  ai_analyze:     { model: 'Claude',      prompt: 'Library prompt (auto-selected)', api: '/api/summarize', icon: '✍️', color: '#22c55e' },
  ai_mix:         { model: 'Claude',      prompt: 'Library prompt (mix angles)',    api: '/api/summarize', icon: '🎯', color: '#f59e0b' },
};

const STATUS_CONFIG = {
  pending:  { icon: '⏳', color: '#475569', bg: 'rgba(71,85,105,0.06)' },
  running:  { icon: '🔄', color: '#3b82f6', bg: 'rgba(59,130,246,0.10)' },
  done:     { icon: '✅', color: '#22c55e', bg: 'rgba(34,197,94,0.08)' },
  error:    { icon: '❌', color: '#ef4444', bg: 'rgba(239,68,68,0.10)' },
  warning:  { icon: '⚠️', color: '#f59e0b', bg: 'rgba(245,158,11,0.10)' },
};

// ─── Elapsed timer ───────────────────────────────────────────────
function ElapsedTimer({ started }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!started) return;
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(iv);
  }, [started]);
  return <span style={{ fontSize: 10, color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>{elapsed}s</span>;
}

export default function WorkflowTracker() {
  const { workflow, resetWorkflow } = useWorkflow();
  const [minimized, setMinimized] = useState(false);
  const [visible, setVisible] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState({});
  const stepStartTimes = useRef({});

  // Track step start times for live timer
  useEffect(() => {
    if (!workflow?.steps) return;
    workflow.steps.forEach(s => {
      if (s.status === 'running' && !stepStartTimes.current[s.id]) {
        stepStartTimes.current[s.id] = Date.now();
      }
    });
  }, [workflow?.steps]);

  useEffect(() => {
    if (workflow?.status === 'running') {
      setVisible(true);
      setMinimized(false);
      stepStartTimes.current = {};
    }
    if (workflow?.status === 'done') {
      const t = setTimeout(() => setMinimized(true), 7000);
      return () => clearTimeout(t);
    }
  }, [workflow?.status]);

  if (!workflow || !visible) return null;

  const doneCount = workflow.steps.filter(s => s.status === 'done').length;
  const totalCount = workflow.steps.length;
  const progress = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;
  const currentStep = workflow.steps.find(s => s.status === 'running');
  const errorStep = workflow.steps.find(s => s.status === 'error');

  const handleClose = () => {
    setVisible(false);
    if (workflow.status === 'done' || workflow.status === 'error') resetWorkflow();
  };

  const toggleExpand = (id) => setExpandedSteps(p => ({ ...p, [id]: !p[id] }));

  // ─── Minimized Pill ───────────────────────────────────────────
  if (minimized) {
    return (
      <div onClick={() => setMinimized(false)} style={{
        position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'rgba(15,15,25,0.96)', border: '1px solid rgba(163,230,53,0.25)',
        borderRadius: 24, padding: '8px 16px', cursor: 'pointer', backdropFilter: 'blur(12px)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)', userSelect: 'none',
      }}>
        <span style={{ fontSize: 14 }}>
          {workflow.status === 'done' ? '✅' : workflow.status === 'error' ? '❌' : '⚡'}
        </span>
        <span style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600 }}>
          {workflow.status === 'done'
            ? `${doneCount}/${totalCount} เสร็จ`
            : workflow.status === 'error' ? 'มีข้อผิดพลาด'
            : `${doneCount}/${totalCount} กำลังทำ...`}
        </span>
        {workflow.status === 'running' && (
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6', animation: 'wfPulse 1s infinite' }} />
        )}
      </div>
    );
  }

  // ─── Expanded Panel ───────────────────────────────────────────
  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
      width: 360, maxHeight: '82vh', display: 'flex', flexDirection: 'column',
      background: 'rgba(10,12,20,0.97)', border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 16, backdropFilter: 'blur(20px)',
      boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
      fontFamily: "'Inter','Sarabun',sans-serif",
      overflow: 'hidden',
    }}>

      {/* ── Header ── */}
      <div style={{
        padding: '12px 14px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        background: 'rgba(255,255,255,0.03)',
      }}>
        <span style={{ fontSize: 16 }}>
          {workflow.status === 'done' ? '✅' : workflow.status === 'error' ? '❌' : '⚡'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#f1f5f9', letterSpacing: 0.3 }}>
            {workflow.name || 'Pipeline'}
          </div>
          {workflow.source && (
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              📦 {workflow.source.type}: {workflow.source.label}
            </div>
          )}
        </div>
        <button onClick={() => setMinimized(true)} style={btnStyle}>─</button>
        <button onClick={handleClose} style={{ ...btnStyle, color: '#ef4444' }}>✕</button>
      </div>

      {/* ── Progress Bar ── */}
      <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <div style={{
          height: '100%', width: `${progress}%`,
          background: workflow.status === 'error' ? '#ef4444' : workflow.status === 'done' ? '#22c55e' : '#3b82f6',
          transition: 'width 0.4s ease',
          boxShadow: workflow.status === 'running' ? '0 0 8px #3b82f6' : 'none',
        }} />
      </div>

      {/* ── Steps ── */}
      <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
        {workflow.steps.map((step, i) => {
          const cfg = STATUS_CONFIG[step.status] || STATUS_CONFIG.pending;
          const meta = STEP_META[step.id] || {};
          const isExpanded = expandedSteps[step.id];
          const isRunning = step.status === 'running';
          const isDone = step.status === 'done';
          const isError = step.status === 'error';
          const isPending = step.status === 'pending';
          const showMeta = !isPending; // แสดง meta เมื่อไม่ pending

          return (
            <div key={step.id} style={{
              margin: '0 8px 4px',
              borderRadius: 10,
              border: `1px solid ${isRunning ? cfg.color + '40' : isError ? '#ef444430' : 'transparent'}`,
              background: isRunning ? cfg.bg : isError ? 'rgba(239,68,68,0.06)' : 'transparent',
              transition: 'all 0.2s',
            }}>
              {/* Step Row */}
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                  cursor: (isDone || isError) ? 'pointer' : 'default',
                }}
                onClick={() => (isDone || isError) && toggleExpand(step.id)}
              >
                {/* Status Icon */}
                <span style={{
                  fontSize: 13, flexShrink: 0,
                  animation: isRunning ? 'wfSpin 1.2s linear infinite' : 'none',
                  display: 'inline-block',
                }}>
                  {cfg.icon}
                </span>

                {/* Step Icon (from meta) */}
                {meta.icon && (
                  <span style={{ fontSize: 12, flexShrink: 0 }}>{meta.icon}</span>
                )}

                {/* Label */}
                <span style={{
                  flex: 1, fontSize: 12, fontWeight: isRunning ? 700 : 500,
                  color: isRunning ? '#f1f5f9' : isPending ? '#475569' : '#cbd5e1',
                  lineHeight: 1.3,
                }}>
                  {step.label}
                </span>

                {/* Duration or Timer */}
                <span style={{ fontSize: 10, color: '#64748b', flexShrink: 0 }}>
                  {isDone && step.duration ? `${step.duration}s` : null}
                  {isRunning ? <ElapsedTimer started={stepStartTimes.current[step.id]} /> : null}
                </span>

                {/* Expand toggle */}
                {(isDone || isError) && (
                  <span style={{ fontSize: 9, color: '#475569' }}>{isExpanded ? '▲' : '▼'}</span>
                )}
              </div>

              {/* ── Running: live detail ── */}
              {isRunning && (
                <div style={{ padding: '0 10px 8px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>

                  {/* API being called */}
                  {(step.api || meta.api) && (
                    <div style={metaRowStyle('#60a5fa')}>
                      <span style={{ opacity: 0.6 }}>📡</span>
                      <span style={{ fontFamily: 'monospace', fontSize: 10 }}>
                        {step.api || meta.api}
                      </span>
                    </div>
                  )}

                  {/* Model */}
                  {meta.model && (
                    <div style={metaRowStyle('#c084fc')}>
                      <span style={{ opacity: 0.6 }}>🤖</span>
                      <span>Model: <strong>{meta.model}</strong></span>
                    </div>
                  )}

                  {/* Prompt */}
                  {meta.prompt && (
                    <div style={metaRowStyle('#fbbf24')}>
                      <span style={{ opacity: 0.6 }}>📝</span>
                      <span>Prompt: {meta.prompt}</span>
                    </div>
                  )}

                  {/* Custom detail from wfStart() */}
                  {step.detail && (
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2, paddingLeft: 2, lineHeight: 1.5 }}>
                      {step.detail}
                    </div>
                  )}

                  {/* Pulse dots */}
                  <div style={{ display: 'flex', gap: 3, marginTop: 3 }}>
                    {[0, 1, 2].map(j => (
                      <span key={j} style={{
                        width: 4, height: 4, borderRadius: '50%',
                        background: cfg.color,
                        animation: `wfDot 1.2s ease-in-out ${j * 0.2}s infinite`,
                        display: 'inline-block',
                      }} />
                    ))}
                  </div>
                </div>
              )}

              {/* ── Done/Error: expandable detail ── */}
              {(isDone || isError) && isExpanded && (
                <div style={{ padding: '0 10px 8px 10px', borderTop: '1px solid rgba(255,255,255,0.04)', marginTop: 2 }}>
                  {/* API */}
                  {meta.api && (
                    <div style={metaRowStyle('#60a5fa')}>
                      <span>📡 {meta.api}</span>
                    </div>
                  )}
                  {/* Model */}
                  {meta.model && (
                    <div style={metaRowStyle('#c084fc')}>
                      <span>🤖 {meta.model}</span>
                    </div>
                  )}
                  {/* Prompt */}
                  {meta.prompt && (
                    <div style={metaRowStyle('#fbbf24')}>
                      <span>📝 {meta.prompt}</span>
                    </div>
                  )}
                  {/* Result detail */}
                  {step.detail && (
                    <div style={{ fontSize: 10, color: isDone ? '#86efac' : '#fca5a5', marginTop: 4, lineHeight: 1.5 }}>
                      {isDone ? '✅ ' : '❌ '}{step.detail}
                    </div>
                  )}
                  {step.error && (
                    <div style={{ fontSize: 10, color: '#fca5a5', marginTop: 4, lineHeight: 1.5, wordBreak: 'break-all' }}>
                      ❌ {step.error}
                    </div>
                  )}
                </div>
              )}

              {/* ── Done (collapsed): inline result ── */}
              {isDone && !isExpanded && step.detail && (
                <div style={{ padding: '0 10px 6px 32px', fontSize: 10, color: '#4ade80', lineHeight: 1.4 }}>
                  {step.detail}
                </div>
              )}

              {/* ── Error (collapsed) ── */}
              {isError && !isExpanded && step.error && (
                <div style={{ padding: '0 10px 6px 32px', fontSize: 10, color: '#fca5a5', lineHeight: 1.4 }}>
                  {step.error.slice(0, 80)}{step.error.length > 80 ? '...' : ''}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Footer ── */}
      <div style={{
        padding: '8px 14px', borderTop: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0, background: 'rgba(255,255,255,0.02)',
      }}>
        <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
          {workflow.status === 'done' ? (
            <span style={{ color: '#4ade80' }}>✅ {workflow.summary || 'เสร็จสิ้น'}</span>
          ) : workflow.status === 'error' ? (
            <span style={{ color: '#f87171' }}>❌ หยุดที่: {errorStep?.label || 'ไม่ทราบ'} — {errorStep?.error?.slice(0,60)}</span>
          ) : (
            <span>
              <span style={{ color: '#60a5fa' }}>{doneCount}/{totalCount}</span>
              {' — '}
              <span style={{ color: '#f1f5f9' }}>{currentStep?.label || '...'}</span>
            </span>
          )}
        </div>
        {workflow.totalDuration && workflow.status === 'done' && (
          <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
            ⏱️ รวม {workflow.totalDuration}s
          </div>
        )}
      </div>

      <style>{`
        @keyframes wfSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes wfPulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        @keyframes wfDot {
          0%,80%,100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1.2); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────
const btnStyle = {
  background: 'transparent', border: 'none', color: '#94a3b8',
  cursor: 'pointer', padding: '2px 6px', borderRadius: 4,
  fontSize: 12, lineHeight: 1,
};

function metaRowStyle(color) {
  return {
    display: 'flex', alignItems: 'center', gap: 4,
    fontSize: 10, color, lineHeight: 1.4, flexWrap: 'wrap',
  };
}
