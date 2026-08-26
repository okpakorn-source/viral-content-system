'use client';
/**
 * JobBoard — บอร์ดงานถอดคลิป (พิมพ์เขียวข้อ 2 โซน 2 + ข้อ 3 คอมโพเนนต์)
 * เจ้าของสั่ง "สถานะชัดทุกงาน" — โชว์ statusNote/lastError ที่หลังบ้านมีอยู่แล้วแต่ของเดิมไม่เคยเรนเดอร์
 *
 * props (page.js ส่งตามนี้เป๊ะ — ดู survey-*.md):
 *   myJob   ใบงานของฉัน {jobId,status,position,platform,result,error,statusNote,attempts,nextRetryAt,startedAt,url,kind} | null
 *   queue   ผล /queue-list = { counts:{pending,active,processing,retry_wait,cancelled?}, active:[...], recent:[...] }
 *           แถว: {id,url,platform,status,attempts,nextRetryAt,statusNote,lastError,user,kind,createdAt,doneAt,cancelledAt,error}
 *   nowMs   เวลาปัจจุบันจากพ่อ — ใช้นับถอยหลังเท่านั้น ห้ามตั้ง timer ในไฟล์นี้
 *   currentUser  ชื่อผู้ใช้ปัจจุบัน — ใช้ติดป้าย "(คุณ)" ให้เห็นว่าแถวไหนเป็นงานตัวเอง
 *   onCancel(jobId) / onRetry(job) / onViewResult(job)
 */
import StatusPill from './StatusPill';
import { getStatusMeta, jobActions, fmtMs, fmtCountdown, fmtClock, platformIcon } from './statusMeta';

const C = { card: '#1f2937', sub: '#111827', line: '#374151', text: '#e5e7eb', muted: '#9ca3af', accent: '#38bdf8' };

function shortUrl(url, n = 40) {
  return String(url || '').replace(/^https?:\/\/(www\.)?/, '').slice(0, n);
}

function btnStyle(color) {
  return {
    padding: '4px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
    border: `1px solid ${color}55`, background: 'transparent', color, fontWeight: 600, whiteSpace: 'nowrap',
  };
}

/** ปุ่มยกเลิก — ยืนยันก่อนเสมอ (พิมพ์เขียวข้อ 2: cancel→onCancel ยืนยันก่อนด้วย confirm()) */
function CancelButton({ id, onCancel }) {
  if (!onCancel) return null;
  return (
    <button onClick={() => { if (window.confirm('ยกเลิกงานนี้? (หยุดถอด/หยุดลองใหม่ทันที)')) onCancel(id); }} style={btnStyle('#ef4444')}>
      🚫 ยกเลิก
    </button>
  );
}

/** ── การ์ด "งานของฉัน" เด่นบนสุด ── */
function MyJobCard({ myJob, nowMs, onCancel, onRetry, onViewResult }) {
  if (!myJob) return null;
  const meta = getStatusMeta(myJob.status);
  const actions = jobActions({ status: myJob.status });
  const elapsed = myJob.status === 'processing' && myJob.startedAt
    ? fmtMs((Number(nowMs) || 0) - Date.parse(myJob.startedAt)) : '';
  const countdown = myJob.status === 'retry_wait' ? fmtCountdown(myJob.nextRetryAt, nowMs) : '';
  // ★ myJob ไม่ประกาศ lastError ในสัญญา — เผื่อกรณีพ่อส่งมาด้วยจริงตอน retry_wait ก็จับได้
  const lastErr = myJob.lastError || myJob.error || '';

  return (
    <div style={{ background: C.card, border: `1px solid ${meta.border}`, borderRadius: 14, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.muted }}>งานของฉัน</span>
        <StatusPill status={myJob.status} size={14} />
        {myJob.platform && <span>{platformIcon(myJob.platform)}</span>}
        {myJob.url && (
          <a href={myJob.url} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 12, color: C.accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>
            {shortUrl(myJob.url, 50)}
          </a>
        )}
      </div>

      <div style={{ fontSize: 13, lineHeight: 1.7, color: C.text }}>
        {myJob.status === 'pending' && <div>⏳ ลำดับที่ <b>{myJob.position || '?'}</b> ในคิว</div>}
        {myJob.status === 'processing' && (
          <div>🔧 กำลังถอด — รอบที่ <b>{(myJob.attempts || 0) + 1}</b>{elapsed && <> · ถอดมาแล้ว {elapsed}</>}</div>
        )}
        {myJob.status === 'retry_wait' && (
          <div>
            🟡 งานยังไม่เริ่มประมวลผล — เซิร์ฟเวอร์ยืนยันว่าลองส่งใหม่ได้อย่างปลอดภัย{countdown && <> · อีก <b>{countdown}</b></>}
            <div style={{ color: C.muted, marginTop: 3 }}>ลองไปแล้ว {myJob.attempts || 0}/80 ครั้ง</div>
            {myJob.statusNote && <div style={{ marginTop: 4 }}>{myJob.statusNote}</div>}
            {lastErr && <div style={{ marginTop: 4, fontSize: 12, color: '#f87171' }}>ล่าสุด: {lastErr}</div>}
            <div style={{ marginTop: 4, fontSize: 11.5, color: C.muted }}>สถานะนี้ไม่ใช่การถอดซ้ำ — ระบบเริ่มประมวลผลเมื่อรับงานได้เท่านั้น ไม่วนถอดซ้ำอัตโนมัติ</div>
          </div>
        )}
        {myJob.status === 'done' && <div>✅ ถอดเสร็จแล้ว — ผลอยู่ในคลังแล้ว</div>}
        {myJob.status === 'error' && <div>❌ {myJob.error || 'ถอดไม่สำเร็จ'}</div>}
        {myJob.status === 'cancelled' && <div>🚫 ยกเลิกงานนี้แล้ว</div>}
      </div>

      {actions.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {actions.includes('view') && onViewResult && (
            <button onClick={() => onViewResult(myJob)} style={btnStyle('#38bdf8')}>👁️ ดูผล</button>
          )}
          {actions.includes('retry') && onRetry && (
            <button onClick={() => onRetry(myJob)} style={btnStyle('#22c55e')}>🔁 ทำใหม่</button>
          )}
          {actions.includes('cancel') && <CancelButton id={myJob.jobId} onCancel={onCancel} />}
        </div>
      )}
    </div>
  );
}

/** ── แถวตาราง "คิวทีมทั้งหมด" (ใบ active: pending/processing/retry_wait) ── */
function QueueRow({ job, currentUser, myJobId, nowMs, onCancel, onRetry, onViewResult }) {
  const actions = jobActions({ status: job.status });
  const countdown = job.status === 'retry_wait' ? fmtCountdown(job.nextRetryAt, nowMs) : '';
  const mine = (myJobId && job.id === myJobId) || (currentUser && job.user && job.user === currentUser);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderTop: `1px solid ${C.line}`, fontSize: 12.5, flexWrap: 'wrap' }}>
      <span>{platformIcon(job.platform)}</span>
      <a href={job.url} target="_blank" rel="noopener noreferrer"
        style={{ color: C.accent, flex: '1 1 160px', minWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {shortUrl(job.url)}
      </a>
      <StatusPill status={job.status} />
      {job.status === 'processing' && <span style={{ color: C.muted, fontSize: 11.5 }}>รอบ {(job.attempts || 0) + 1}</span>}
      {job.status === 'retry_wait' && (
        <span style={{ color: C.muted, fontSize: 11.5 }}>ลอง {job.attempts || 0}/80{countdown ? ` · อีก ${countdown}` : ''}</span>
      )}
      {job.statusNote && <span style={{ fontSize: 11, color: '#fbbf24' }} title={job.statusNote}>{job.statusNote}</span>}
      {job.lastError && (
        <span title={job.lastError} style={{ fontSize: 11, color: '#f87171', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {job.lastError}
        </span>
      )}
      {(job.attempts || 0) >= 3 && <span style={{ fontSize: 10.5, color: '#f87171' }}>⚠️ อาจลิงก์เสีย</span>}
      {job.user && <span style={{ fontSize: 11, color: C.muted }}>👤 {job.user}{mine ? ' (คุณ)' : ''}</span>}
      {job.kind && job.kind !== 'insight' && <span style={{ fontSize: 11, color: C.muted }}>· {job.kind}</span>}
      {actions.length > 0 && (
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {actions.includes('view') && onViewResult && (
            <button onClick={() => onViewResult(job)} title="ดูผล" style={btnStyle('#38bdf8')}>👁️ ดูผล</button>
          )}
          {actions.includes('retry') && onRetry && (
            <button onClick={() => onRetry(job)} title="ทำใหม่" style={btnStyle('#22c55e')}>🔁 ทำใหม่</button>
          )}
          {actions.includes('cancel') && <CancelButton id={job.id} onCancel={onCancel} />}
        </div>
      )}
    </div>
  );
}

/** ── แถว "เพิ่งจบ" (done/error/cancelled) — เล็ก กระชับ ไม่มีปุ่ม ── */
function RecentRow({ job }) {
  const timeStr = fmtClock(job.doneAt || job.cancelledAt || job.createdAt);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', fontSize: 11.5, color: C.muted }}>
      <StatusPill status={job.status} size={11.5} />
      <span style={{ flex: '1 1 140px', minWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {shortUrl(job.url, 36)}
      </span>
      {timeStr && <span style={{ whiteSpace: 'nowrap' }}>{timeStr}</span>}
      {job.status === 'error' && job.error && (
        <span title={job.error} style={{ color: '#f87171', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {job.error}
        </span>
      )}
    </div>
  );
}

export default function JobBoard({ myJob = null, queue = null, nowMs = 0, currentUser = '', onCancel, onRetry, onViewResult }) {
  const counts = queue?.counts || {};
  const active = Array.isArray(queue?.active) ? queue.active : [];
  const recent = Array.isArray(queue?.recent) ? queue.recent : [];
  const isEmpty = active.length === 0 && recent.length === 0;

  const summaryParts = [];
  if (counts.pending) summaryParts.push(`รอคิว ${counts.pending}`);
  if (counts.processing) summaryParts.push(`กำลังถอด ${counts.processing}`);
  if (counts.retry_wait) summaryParts.push(`รอลองใหม่ ${counts.retry_wait}`);
  if (counts.cancelled) summaryParts.push(`ยกเลิก ${counts.cancelled}`);

  return (
    <div>
      <MyJobCard myJob={myJob} nowMs={nowMs} onCancel={onCancel} onRetry={onRetry} onViewResult={onViewResult} />

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: isEmpty ? 0 : 10 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>📋 คิวทีม</span>
          <span style={{ fontSize: 12.5, color: C.muted }}>{summaryParts.length ? summaryParts.join(' · ') : 'ไม่มีงานในคิว'}</span>
        </div>

        {isEmpty ? (
          <div style={{ fontSize: 12.5, color: C.muted, padding: '4px 0' }}>คิวว่าง ✨</div>
        ) : (
          <>
            {active.length > 0 && (
              <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, overflow: 'hidden', marginBottom: recent.length > 0 ? 12 : 0 }}>
                {active.map((j) => (
                  <QueueRow key={j.id} job={j} currentUser={currentUser} myJobId={myJob?.jobId} nowMs={nowMs}
                    onCancel={onCancel} onRetry={onRetry} onViewResult={onViewResult} />
                ))}
              </div>
            )}
            {recent.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 4, paddingLeft: 2 }}>เพิ่งจบ</div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {recent.map((j) => <RecentRow key={j.id} job={j} />)}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
