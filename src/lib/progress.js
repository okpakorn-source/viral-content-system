// ============================================================
// [ระบบทำปกออโต้] คลังสถานะงาน (เรียลไทม์)
// ------------------------------------------------------------
// เก็บสถานะแต่ละงาน (jobId) ในหน่วยความจำ ให้ฝั่ง client โพลมาดู
// ว่าทำถึงขั้นไหน / ติดคิว AI รอบไหน — ป๊อปอัพเรียลไทม์
// ใช้ globalThis กันโดน bundle แยก instance
// ============================================================

const g = globalThis;
if (!g.__acProgress) g.__acProgress = new Map();
const store = g.__acProgress;
const TTL = 15 * 60 * 1000;

export function setProgress(jobId, patch) {
  if (!jobId) return;
  const prev = store.get(jobId) || { status: 'running', pct: 0 };
  store.set(jobId, { ...prev, ...patch, updatedAt: Date.now() });
  if (store.size > 300) {
    const now = Date.now();
    for (const [k, v] of store) if (now - (v.updatedAt || 0) > TTL) store.delete(k);
  }
}

export function getProgress(jobId) {
  return store.get(jobId) || null;
}

export function doneProgress(jobId, patch = {}) {
  setProgress(jobId, { status: 'done', pct: 100, retry: 0, ...patch });
}

export function failProgress(jobId, error) {
  setProgress(jobId, { status: 'error', error });
}

// helper: สร้าง reporter ผูกกับ jobId (P(step, detail, extra))
export function reporter(jobId) {
  const P = (step, detail, extra = {}) => setProgress(jobId, { step, detail, retry: 0, ...extra });
  // onRetry สำหรับ withRetry → แสดง "รอคิว AI ลองใหม่"
  P.onRetry = (attempt, waitMs) =>
    setProgress(jobId, {
      detail: `⏳ AI ไม่ว่าง (503/busy) — รอ ${Math.round(waitMs / 1000)} วิ แล้วลองใหม่ครั้งที่ ${attempt + 1}`,
      retry: attempt,
    });
  return P;
}
