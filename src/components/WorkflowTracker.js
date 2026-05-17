'use client';
import { useState, useEffect } from 'react';
import { useWorkflow } from './WorkflowContext';

const STATUS_CONFIG = {
  pending:  { icon: '⏳', color: '#64748b', label: 'รอ' },
  running:  { icon: '🔄', color: '#3b82f6', label: 'กำลังทำ' },
  done:     { icon: '✅', color: '#22c55e', label: 'สำเร็จ' },
  error:    { icon: '❌', color: '#ef4444', label: 'ล้มเหลว' },
  warning:  { icon: '⚠️', color: '#f59e0b', label: 'ตรวจสอบ' },
};

export default function WorkflowTracker() {
  const { workflow, resetWorkflow, isActive } = useWorkflow();
  const [minimized, setMinimized] = useState(false);
  const [visible, setVisible] = useState(false);
  const [autoHideTimer, setAutoHideTimer] = useState(null);

  // Show when workflow starts, auto-hide 8s after completion
  useEffect(() => {
    if (workflow && workflow.status === 'running') {
      setVisible(true);
      setMinimized(false);
      if (autoHideTimer) clearTimeout(autoHideTimer);
    }
    if (workflow && workflow.status === 'done') {
      const timer = setTimeout(() => {
        setMinimized(true);
      }, 5000);
      setAutoHideTimer(timer);
      return () => clearTimeout(timer);
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
    if (workflow.status === 'done' || workflow.status === 'error') {
      resetWorkflow();
    }
  };

  // === Minimized Pill ===
  if (minimized) {
    return (
      <div className="wf-tracker-pill" onClick={() => setMinimized(false)}>
        <span className="wf-pill-icon">
          {workflow.status === 'done' ? '✅' : workflow.status === 'error' ? '❌' : '⚡'}
        </span>
        <span className="wf-pill-text">
          {workflow.status === 'done'
            ? `เสร็จ ${doneCount}/${totalCount}`
            : workflow.status === 'error'
            ? 'มีข้อผิดพลาด'
            : `${doneCount}/${totalCount} steps`
          }
        </span>
        {workflow.status === 'running' && <span className="wf-pill-pulse" />}
      </div>
    );
  }

  // === Expanded Tracker ===
  return (
    <div className={`wf-tracker ${workflow.status === 'error' ? 'wf-tracker-error' : workflow.status === 'done' ? 'wf-tracker-done' : ''}`}>
      {/* Header */}
      <div className="wf-tracker-header">
        <div className="wf-tracker-title">
          <span className="wf-tracker-title-icon">
            {workflow.status === 'done' ? '✅' : workflow.status === 'error' ? '❌' : '⚡'}
          </span>
          <span>{workflow.name || 'Workflow'}</span>
        </div>
        <div className="wf-tracker-actions">
          <button className="wf-btn-min" onClick={() => setMinimized(true)} title="ย่อ">─</button>
          <button className="wf-btn-close" onClick={handleClose} title="ปิด">✕</button>
        </div>
      </div>

      {/* Steps */}
      <div className="wf-tracker-steps">
        {workflow.steps.map((step, i) => {
          const cfg = STATUS_CONFIG[step.status] || STATUS_CONFIG.pending;
          return (
            <div key={step.id} className={`wf-step wf-step-${step.status}`}>
              <div className="wf-step-row">
                <span className={`wf-step-icon ${step.status === 'running' ? 'wf-spin' : ''}`}>
                  {cfg.icon}
                </span>
                <span className="wf-step-label">{step.label}</span>
                {step.duration && (
                  <span className="wf-step-time">{step.duration}s</span>
                )}
              </div>
              {step.api && step.status === 'running' && (
                <div className="wf-step-meta">📡 {step.api}</div>
              )}
              {step.detail && step.status !== 'pending' && (
                <div className="wf-step-detail">{step.detail}</div>
              )}
              {step.error && (
                <div className="wf-step-error">⚠️ {step.error}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Source Info */}
      {workflow.source && (
        <div className="wf-tracker-source">
          📦 {workflow.source.type}: {workflow.source.label}
        </div>
      )}

      {/* Progress Bar */}
      <div className="wf-tracker-progress-wrap">
        <div className="wf-tracker-progress" style={{ width: `${progress}%` }} />
      </div>
      <div className="wf-tracker-progress-text">
        {workflow.status === 'done'
          ? `✅ ${workflow.summary || 'เสร็จสิ้น'}`
          : workflow.status === 'error'
          ? `❌ หยุดที่: ${errorStep?.label || 'ไม่ทราบ'}`
          : `${doneCount}/${totalCount} — ${currentStep?.label || '...'}`
        }
      </div>
    </div>
  );
}
