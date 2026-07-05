// ============================================================
// [ระบบทำปกออโต้] ตัวจัดการงาน + โพลสถานะ (ฝั่ง client)
// ------------------------------------------------------------
// startJob(label) → สร้าง jobId + เริ่มโพล /api/progress ทุก ~0.9s
// ส่ง jobId ไปกับ body ของ endpoint → เห็นสถานะเรียลไทม์บนป๊อปอัพ
// ============================================================

'use client';

let listeners = new Set();
let state = { active: false, jobId: null, label: '', progress: null };
let pollTimer = null;

function emit() {
  for (const l of listeners) {
    try {
      l(state);
    } catch {
      /* ข้าม */
    }
  }
}

export function subscribeJob(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export function startJob(label) {
  const jobId = 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  state = { active: true, jobId, label, progress: null };
  emit();
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const r = await fetch('/api/progress?jobId=' + jobId);
      const j = await r.json();
      if (j && j.progress) {
        state = { ...state, progress: j.progress };
        emit();
      }
    } catch {
      /* เงียบ */
    }
  }, 900);
  return jobId;
}

export function stopJob() {
  clearInterval(pollTimer);
  pollTimer = null;
  state = { ...state, active: false };
  emit();
}
