'use client';

// ============================================================
// 🧾 ประวัติย้อนหลังของลีด 1 ใบ (trace, 17 ก.ค. 69 — อ้างแบบ trace-design)
// ------------------------------------------------------------
// แผงกางในการ์ด (LeadCard) — โชว์ lead.timeline ที่มากับ record อยู่แล้ว (ไม่ต้องยิง API)
// ส่วนปุ่ม "ดูผลเจน" ยิง GET /api/desk/research/trace?jobId= เอง (เฉพาะจุดเดียวที่คอมโพเนนต์นี้เรียก API)
// ============================================================

import { useState } from 'react';
import { UI, Btn, Chip, apiFetch } from './ui.js';

const TYPE_META = {
  found: { icon: '🔎', label: 'เจอจากค้นหา' },
  judged: { icon: '⚖️', label: 'ตัดสินคะแนน' },
  extracted: { icon: '🧲', label: 'สกัดเนื้อ' },
  sent: { icon: '🚀', label: 'ส่งเข้าคิวเขียน' },
  written: { icon: '✍️', label: 'เขียนเสร็จ' },
  status: { icon: 'ℹ️', label: 'เปลี่ยนสถานะ' },
};

function fmtTime(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(iso).slice(0, 16);
  }
}

// สรุป data ของแต่ละ event ให้อ่านง่าย 1 บรรทัด (ตาม type ที่รู้จัก)
function renderEventDetail(type, data) {
  const d = data || {};
  switch (type) {
    case 'found':
      return `คีย์ "${d.query || '-'}" · ช่อง ${d.channel || '-'}`;
    case 'judged':
      return `คะแนน ${d.score ?? '-'}%${d.reason ? ` · ${d.reason}` : ''}${d.model ? ` (${d.model})` : ''}`;
    case 'extracted':
      return `${d.route === 'clip' ? 'คลิป' : 'บทความ'} · ${d.textLength ?? 0} ตัวอักษร${d.source ? ` · ${d.source}` : ''}`;
    case 'sent':
      return `job ${String(d.jobId || '-').slice(0, 12)} · เนื้อ ${d.payloadLength ?? 0} ตัวอักษร`;
    case 'written':
      return d.summary || d.title || '-';
    case 'status':
      return d.status || '-';
    default:
      return '';
  }
}

export default function LeadTimeline({ lead }) {
  const [jobInfo, setJobInfo] = useState(null);
  const [jobLoading, setJobLoading] = useState(false);
  const [jobErr, setJobErr] = useState('');

  const timeline = Array.isArray(lead?.timeline) ? lead.timeline : [];
  const canCheckJob = lead?.status === 'sent' && !!lead?.jobId;

  async function checkJob() {
    setJobLoading(true);
    setJobErr('');
    const res = await apiFetch(`/api/desk/research/trace?jobId=${encodeURIComponent(lead.jobId)}`);
    setJobLoading(false);
    if (res.success) setJobInfo(res);
    else setJobErr(res.error || 'เช็คผลเจนไม่สำเร็จ');
  }

  return (
    <div style={{ background: UI.card2, border: `1px solid ${UI.line}`, borderRadius: 10, padding: 10, display: 'grid', gap: 8 }}>
      {timeline.length === 0 ? (
        <div style={{ fontSize: 12, color: UI.muted, textAlign: 'center', padding: 6 }}>ยังไม่มีประวัติของลีดนี้</div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {timeline.map((ev, i) => {
            const meta = TYPE_META[ev?.type] || { icon: '•', label: ev?.type || '-' };
            return (
              <div key={i} style={{ fontSize: 12, color: UI.dim, lineHeight: 1.5, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span>{meta.icon}</span>
                <span style={{ color: UI.muted, whiteSpace: 'nowrap' }}>{fmtTime(ev?.at)}</span>
                <span>{meta.label}: {renderEventDetail(ev?.type, ev?.data)}</span>
              </div>
            );
          })}
        </div>
      )}

      {canCheckJob && (
        <div style={{ borderTop: `1px solid ${UI.line}`, paddingTop: 8 }}>
          <Btn variant="subtle" busy={jobLoading} disabled={jobLoading} onClick={checkJob} style={{ minHeight: 36, padding: '6px 12px', fontSize: 12.5 }}>
            🔍 ดูผลเจน
          </Btn>
          {jobErr && <div style={{ fontSize: 12, color: UI.red, marginTop: 6 }}>⚠️ {jobErr}</div>}
          {jobInfo && (
            <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Chip color={UI.blue}>สถานะ: {jobInfo.status || '-'}</Chip>
                <Chip color={UI.green}>ได้ {jobInfo.versionsCount ?? 0} เวอร์ชัน</Chip>
              </div>
              {Array.isArray(jobInfo.versions) && jobInfo.versions.length > 0 && (
                <div style={{ fontSize: 12, color: UI.dim, display: 'grid', gap: 2 }}>
                  {jobInfo.versions.map((t, i) => <div key={i}>• {t}</div>)}
                </div>
              )}
              {jobInfo.caseId && (
                <a
                  href="/generation-logs" // route รายตัวไม่มีจริง (T1 พิสูจน์) — เปิดหน้ารวมให้ค้น caseId ต่อ
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 12, color: UI.accent, fontWeight: 700, textDecoration: 'none' }}
                >
                  ดู case #{jobInfo.caseId} ↗
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
