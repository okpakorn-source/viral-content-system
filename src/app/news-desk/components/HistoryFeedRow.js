'use client';

// ============================================================
// 🧾 คลังประวัติรวม — แถวเดียวของฟีดกิจกรรม (H1, 17 ก.ค. 69)
// ------------------------------------------------------------
// presentational ล้วน — รับ event ที่ flatten มาจาก lead.timeline แล้ว {at,type,data,lead}
// นิยาม TYPE_META/renderEventDetail ใหม่ในไฟล์นี้ (คัดแนวคิดจาก LeadTimeline.js แต่ไม่แก้ไฟล์เดิม)
// ============================================================

import { Fragment } from 'react';
import { UI, Chip, fmtNum, fmtBaht, fmtDuration } from './ui.js';

const tdStyle = { padding: '6px 8px', color: 'var(--text-primary)', whiteSpace: 'nowrap' };

// ── ป้ายไอคอน/ชื่อไทยของแต่ละประเภทเหตุการณ์ + กลุ่มตัวกรอง (found/judged/extracted/sent/status) ──
export const TYPE_META = {
  found: { icon: '🔎', label: 'เจอจากค้นหา', group: 'found' },
  refound: { icon: '🔁', label: 'เจอซ้ำอีกรอบ', group: 'found' },
  judged: { icon: '⚖️', label: 'ตัดสินคะแนน', group: 'judged' },
  extracted: { icon: '🧲', label: 'สกัดเนื้อ', group: 'extracted' },
  sent: { icon: '🚀', label: 'ส่งเข้าคิวเขียน', group: 'sent' },
  written: { icon: '✍️', label: 'เขียนเสร็จ', group: 'sent' },
  status: { icon: 'ℹ️', label: 'เปลี่ยนสถานะ', group: 'status' },
};

// ── flatten ทุก event ของทุกลีด → [{at,type,data,lead}] เรียงใหม่→เก่า ──
export function flattenLeadEvents(leads) {
  const out = [];
  const list = Array.isArray(leads) ? leads : [];
  for (const lead of list) {
    const tl = Array.isArray(lead?.timeline) ? lead.timeline : [];
    for (const ev of tl) {
      out.push({ at: ev?.at || null, type: ev?.type || 'unknown', data: ev?.data || {}, lead });
    }
  }
  out.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  return out;
}

// ── เวลาแบบย่อ: เมื่อสักครู่/นาทีที่แล้ว/ชม.ที่แล้ว/วันที่แล้ว → เกิน 7 วันโชว์เต็ม toLocaleString('th-TH') ──
export function fmtRelative(iso) {
  if (!iso) return '-';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return String(iso).slice(0, 16);
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return 'เมื่อสักครู่';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} นาทีที่แล้ว`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} ชม.ที่แล้ว`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)} วันที่แล้ว`;
  try {
    return new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(iso).slice(0, 16);
  }
}

// ── สรุป data ของแต่ละ event ให้อ่านง่าย 1 บรรทัด (ตาม type ที่รู้จัก — เทียบเคียง LeadTimeline.js) ──
export function renderEventDetail(type, data) {
  const d = data || {};
  switch (type) {
    case 'found':
      return `คีย์ "${d.query || '-'}" · ช่อง ${d.channel || '-'}`;
    case 'judged':
      return `คะแนน ${d.score ?? '-'}%${d.reason ? ` · ${d.reason}` : ''}${d.model ? ` (${d.model})` : ''}`;
    case 'extracted':
      return `${d.route === 'clip' ? 'คลิป' : 'บทความ'} · ${d.textLength ?? 0} ตัวอักษร${d.source ? ` · ${d.source}` : ''}`;
    case 'sent':
      return `job ${String(d.jobId || '-').slice(0, 12)} · เนื้อ ${d.payloadLength ?? 0} ตัวอักษร${d.auto ? ' · ⚡ออโต้' : ''}`;
    case 'written':
      return d.summary || d.title || '-';
    case 'status':
      return d.status || '-';
    case 'refound':
      return `รอบล่า ${d.runId || '-'}`;
    default:
      return '';
  }
}

export default function HistoryFeedRow({ event, onOpenLead }) {
  const meta = TYPE_META[event?.type] || { icon: '•', label: event?.type || '-' };
  const lead = event?.lead || {};
  const title = String(lead.title || '(ไม่มีหัวข้อ)');

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenLead?.(lead)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpenLead?.(lead); }}
      style={{
        display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px',
        background: UI.card2, border: `1px solid ${UI.line}`, borderRadius: 10, cursor: 'pointer',
      }}
      title="คลิกเพื่อดูประวัติเต็มของลีดนี้"
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
        <span>{meta.icon}</span>
        <span style={{ fontWeight: 700, color: UI.text }}>{meta.label}</span>
        <span style={{ color: UI.muted }}>· {fmtRelative(event.at)}</span>
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: UI.text, lineHeight: 1.5, wordBreak: 'break-word' }}>
        {title.slice(0, 120)}{title.length > 120 ? '…' : ''}
      </div>
      <div style={{ fontSize: 12.5, color: UI.dim, lineHeight: 1.5 }}>{renderEventDetail(event.type, event.data)}</div>
      {(lead.channel || lead.clusterArchetype) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {lead.channel && <Chip color={UI.blue}>{lead.channel}</Chip>}
          {lead.clusterArchetype && <Chip color={UI.muted}>{String(lead.clusterArchetype).slice(0, 30)}</Chip>}
        </div>
      )}
    </div>
  );
}

// ── แถวตาราง "รอบล่า" 1 รอบ (ใช้ในมุมมองที่ 3 ของ HistoryTab.js — เทียบเคียงส่วน trace ของ ResearchTab.js)
//   + กางลิงก์ลีดที่เก็บจากรอบนี้ (savedTitles) กดแล้วสลับไปมุมมองรายข่าวใบนั้นผ่าน onOpenLead ──
export function HistoryRunRow({ run, found, cut, isOpen, savedTitles, onToggle, onOpenLead }) {
  return (
    <Fragment>
      <tr onClick={onToggle} style={{ cursor: 'pointer', borderTop: `1px solid ${UI.line}`, background: isOpen ? UI.card2 : 'transparent' }}>
        <td style={tdStyle}>{run.at ? new Date(run.at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '-'}</td>
        <td style={tdStyle}>{fmtNum(run.params?.clusterIds?.length || 0)}</td>
        <td style={tdStyle}>{fmtNum((run.queriesUsed || []).length)}</td>
        <td style={tdStyle}>{fmtNum(found)}</td>
        <td style={tdStyle}>{fmtNum(run.judgeSummary?.kept ?? (run.savedLeadIds || []).length)}</td>
        <td style={tdStyle}>{fmtNum(cut)}</td>
        <td style={tdStyle}>{fmtBaht(run.costTHB || 0)}</td>
        <td style={tdStyle}>{fmtDuration(run.tookMs || 0)}</td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={8} style={{ padding: 0, border: 'none' }}>
            <div style={{ background: UI.card2, border: `1px solid ${UI.line}`, borderRadius: 10, padding: 12, margin: '4px 0 10px', display: 'grid', gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: UI.text, marginBottom: 6 }}>🔑 คีย์ที่ยิง — เจอกี่ใบ</div>
                {(run.queriesUsed || []).length === 0 ? (
                  <div style={{ fontSize: 12, color: UI.muted }}>ไม่มีข้อมูล (รอบเก่าอาจไม่ครบ)</div>
                ) : (
                  <div style={{ display: 'grid', gap: 4 }}>
                    {run.queriesUsed.map((q, i) => (
                      <div key={i} style={{ fontSize: 12, color: UI.dim }}>
                        &ldquo;{q.query}&rdquo; · {q.channel}{q.archetype ? ` · (${q.archetype})` : ''} — เจอ {fmtNum(q.found)} ใบ
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: UI.text, marginBottom: 6 }}>🗑 ที่ตัดทิ้ง ({fmtNum(cut)})</div>
                {(run.judgeLog || []).length === 0 ? (
                  <div style={{ fontSize: 12, color: UI.muted }}>ไม่มีรายการที่ตัดทิ้ง (รอบเก่าอาจไม่ครบ)</div>
                ) : (
                  <div style={{ display: 'grid', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                    {run.judgeLog.map((j, i) => (
                      <div key={i} style={{ fontSize: 12, color: UI.dim, lineHeight: 1.5 }}>
                        <span style={{ color: UI.muted }}>[{j.stage}{j.score != null ? ` ${j.score}%` : ''}]</span> {String(j.title || '(ไม่มีหัวข้อ)').slice(0, 80)} — {j.reason}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {savedTitles.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: UI.text, marginBottom: 6 }}>🔗 ลีดที่เก็บจากรอบนี้ ({fmtNum(savedTitles.length)}) — กดดูประวัติเต็ม</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {savedTitles.slice(0, 20).map((lead) => (
                      <button
                        key={lead.id}
                        type="button"
                        onClick={() => onOpenLead?.(lead)}
                        style={{
                          fontSize: 12, minHeight: 32, padding: '4px 10px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
                          background: 'transparent', color: UI.accent, border: `1px solid ${UI.accent}55`,
                        }}
                      >{String(lead.title || lead.id).slice(0, 30)}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
