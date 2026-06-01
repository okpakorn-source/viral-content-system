'use client';
import { createContext, useContext, useState, useCallback, useRef } from 'react';

const WorkflowContext = createContext(null);

export function useWorkflow() {
  const ctx = useContext(WorkflowContext);
  if (!ctx) {
    // Return no-op functions if used outside provider
    return {
      workflow: null,
      startWorkflow: () => {},
      startStep: () => {},
      completeStep: () => {},
      failStep: () => {},
      warnStep: () => {},
      finishWorkflow: () => {},
      resetWorkflow: () => {},
      isActive: false,
    };
  }
  return ctx;
}

export default function WorkflowProvider({ children }) {
  const [workflow, setWorkflow] = useState(null);
  const startTimeRef = useRef(null);
  const stepTimesRef = useRef({});

  // Start a new workflow with defined steps
  const startWorkflow = useCallback((name, steps, source) => {
    startTimeRef.current = Date.now();
    stepTimesRef.current = {};
    setWorkflow({
      id: `wf_${Date.now()}`,
      name,
      status: 'running',
      startedAt: new Date().toISOString(),
      source: source || null,
      steps: steps.map((s, i) => ({
        id: s.id,
        label: s.label,
        status: i === 0 ? 'running' : 'pending',
        api: null,
        detail: null,
        error: null,
        duration: null,
      })),
      currentStepIndex: 0,
      summary: null,
    });
  }, []);

  // Start a specific step
  const startStep = useCallback((stepId, opts = {}) => {
    stepTimesRef.current[stepId] = Date.now();
    setWorkflow(prev => {
      if (!prev) return prev;
      const steps = prev.steps.map(s =>
        s.id === stepId
          ? { ...s, status: 'running', api: opts.api || null, detail: opts.detail || null }
          : s
      );
      const idx = steps.findIndex(s => s.id === stepId);
      return { ...prev, steps, currentStepIndex: idx >= 0 ? idx : prev.currentStepIndex };
    });
  }, []);

  // Complete a step
  const completeStep = useCallback((stepId, detail) => {
    const duration = stepTimesRef.current[stepId]
      ? ((Date.now() - stepTimesRef.current[stepId]) / 1000).toFixed(1)
      : null;
    setWorkflow(prev => {
      if (!prev) return prev;
      const steps = prev.steps.map(s =>
        s.id === stepId
          ? { ...s, status: 'done', detail: detail || s.detail, duration: parseFloat(duration) || null }
          : s
      );
      // Auto-start next pending step
      const currentIdx = steps.findIndex(s => s.id === stepId);
      const nextIdx = steps.findIndex((s, i) => i > currentIdx && s.status === 'pending');
      return { ...prev, steps, currentStepIndex: nextIdx >= 0 ? nextIdx : prev.currentStepIndex };
    });
  }, []);

  // Fail a step
  const failStep = useCallback((stepId, error) => {
    const duration = stepTimesRef.current[stepId]
      ? ((Date.now() - stepTimesRef.current[stepId]) / 1000).toFixed(1)
      : null;
    setWorkflow(prev => {
      if (!prev) return prev;
      const steps = prev.steps.map(s =>
        s.id === stepId
          ? { ...s, status: 'error', error, duration: parseFloat(duration) || null }
          : s
      );
      return { ...prev, steps, status: 'error' };
    });
  }, []);

  // Warn a step
  const warnStep = useCallback((stepId, msg) => {
    setWorkflow(prev => {
      if (!prev) return prev;
      const steps = prev.steps.map(s =>
        s.id === stepId ? { ...s, status: 'warning', detail: msg } : s
      );
      return { ...prev, steps };
    });
  }, []);

  // Finish workflow
  const finishWorkflow = useCallback((summary) => {
    const totalDuration = startTimeRef.current
      ? ((Date.now() - startTimeRef.current) / 1000).toFixed(1)
      : null;
    setWorkflow(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        status: 'done',
        summary: summary || `เสร็จสิ้น (${totalDuration}s)`,
        totalDuration: parseFloat(totalDuration),
      };
    });
  }, []);

  // Reset
  const resetWorkflow = useCallback(() => {
    setWorkflow(null);
    startTimeRef.current = null;
    stepTimesRef.current = {};
  }, []);

  const isActive = workflow && (workflow.status === 'running' || workflow.status === 'error');

  const value = {
    workflow,
    startWorkflow,
    startStep,
    completeStep,
    failStep,
    warnStep,
    finishWorkflow,
    resetWorkflow,
    isActive,
  };

  return (
    <WorkflowContext.Provider value={value}>
      {children}
    </WorkflowContext.Provider>
  );
}
