'use client';
/**
 * InsightCard — การ์ดผลถอดคลิป "เนื้อข่าวช่องเดียว" (★ 26 ต.ค. 69 เจ้าของเคาะ: พาดหัว + เนื้อข่าว + จุดที่ควรเช็ค)
 * ใช้ทั้งผลสด (live) และใบในคลังที่กางออก · ใบเก่าแสดงหน้าตาเดียวกันด้วยเนื้อเดิม (ดู cardView ใน statusMeta)
 * เลิกแสดง: ประเด็นย่อย · รายชื่อผู้พูด · กล่องคำพูดแยก · ไทม์ไลน์ · กล่องสมองตรวจ
 *
 * props:
 *   rec        ใบแบบคลัง {id,url,platform,title,insight,clipDurationSec,user,elapsedMs,lowQuality,qualityNote,createdAt,chosen,cached,cachedAt}
 *   live       true = ผลสด
 *   copiedKey  key ของปุ่มที่เพิ่งคัดลอก (โชว์ ✓)
 *   onCopy(key,text) / onDelete(id) / onPin(id,chosen) / onRetry(url)  — ไม่ส่ง = ซ่อนปุ่มนั้น
 */
import { platformIcon, fmtDurSec, fmtMs, fmtClock, cardView, CHECK_KIND_LABEL } from './statusMeta';

const C = { card: '#1f2937', sub: '#111827', line: '#374151', text: '#e5e7eb', muted: '#9ca3af', accent: '#38bdf8' };

const btn = (active, color = C.muted) => ({
  padding: '5px 12px', borderRadius: 8, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  border: `1px solid ${active ? '#22c55e66' : C.line}`, background: 'transparent', color: active ? '#22c55e' : color,
});

const QUOTE = /“[^”\n]+”|"[^"\n]+"/g;
/** คำพูดในเครื่องหมายคำพูดระบายสีอ่อน ให้เห็นว่าตรงไหนยกคำพูดจริงจากคลิป */
function BodyText({ text }) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(QUOTE)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<span key={m.index} style={{ background: 'rgba(56,189,248,.12)', borderRadius: 3, padding: '0 2px' }}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <div style={{ fontSize: 14.5, lineHeight: 1.9, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{parts}</div>;
}

export default function InsightCard({ rec, live = false, copiedKey, onCopy, onDelete, onPin, onRetry }) {
  const r = rec || {};
  const view = cardView(r);
  const id = r.id || 'live';
  const copyKey = `ic-${id}-copy`;
  const copied = copiedKey === copyKey;
  const dur = Number(r.clipDurationSec || r.insight?.clipDurationSec) || 0;
  const lowQuality = r.lowQuality || r.insight?.lowQuality;
  const qualityNote = r.qualityNote || r.insight?.qualityNote;
  const cached = r.cached || r.insight?.cached;
  const cachedAt = r.cachedAt || r.insight?.cachedAt;

  return (
    <div data-testid="insight-card" style={{ background: C.card, border: `1px solid ${live ? C.accent + '66' : C.line}`, borderRadius: 12, padding: 16, color: C.text }}>
      {/* ── พาดหัว + ปุ่ม ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <h3 style={{ flex: '1 1 280px', minWidth: 0, margin: 0, fontSize: 16.5, fontWeight: 800, lineHeight: 1.55, overflowWrap: 'anywhere' }}>
          {platformIcon(r.platform)} {view.headline}
          {r.chosen ? <span style={{ marginLeft: 6 }} title="ปักไว้">📌</span> : null}
        </h3>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={() => onCopy && onCopy(copyKey, view.copyText)} disabled={!view.body} style={{ ...btn(copied, C.accent), borderColor: copied ? '#22c55e66' : C.accent + '66' }}>
            {copied ? '✓ คัดลอกแล้ว' : '📋 คัดลอกพาดหัว+เนื้อข่าว'}
          </button>
          {onRetry && r.url && <button onClick={() => onRetry(r.url)} style={btn(false)} title="ส่งคลิปนี้เข้าคิวถอดใหม่">🔁 ถอดใหม่</button>}
          {onPin && r.id && (
            <button onClick={() => onPin(r.id, !r.chosen)} style={btn(false)} title={r.chosen ? 'ปลดปัก' : 'ปักไว้ = ส่งลิงก์เดิมได้ใบนี้คืน และไม่ถูกลบตอนล้างคลัง'}>
              {r.chosen ? '📌 ปลดปัก' : '📌 ปัก'}
            </button>
          )}
          {onDelete && r.id && (
            <button onClick={() => { if (window.confirm('ลบใบนี้ออกจากคลังถาวร?')) onDelete(r.id); }} style={{ ...btn(false, '#ef4444'), borderColor: '#ef444455' }}>🗑️ ลบ</button>
          )}
        </div>
      </div>

      {/* ── ข้อมูลประกอบ ── */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 6, fontSize: 12, color: C.muted }}>
        {dur > 0 && <span>⏱️ คลิป {fmtDurSec(dur)}</span>}
        {r.user && <span>👤 {r.user}</span>}
        {fmtClock(r.createdAt) && <span>🕒 {fmtClock(r.createdAt)}</span>}
        {fmtMs(r.elapsedMs) && <span>⚡ ถอด {fmtMs(r.elapsedMs)}</span>}
        {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color: C.accent }}>🔗 เปิดคลิป</a>}
        {view.legacy && <span title="ถอดด้วยระบบเดิมก่อน 26 ต.ค. 69 — แสดงเนื้อเดิม ไม่ได้ผ่านตัวตรวจแบบใหม่" style={{ padding: '1px 8px', borderRadius: 999, border: `1px solid ${C.line}` }}>ใบรุ่นเก่า</span>}
      </div>

      {/* ── ป้ายเตือน ── */}
      {lowQuality && (
        <div style={{ marginTop: 12, fontSize: 13, padding: '8px 12px', borderRadius: 9, background: 'rgba(239,68,68,.08)', border: '1px solid #ef444455', color: '#f87171' }}>
          ⚠️ <b>{qualityNote || 'ผลอาจไม่สมบูรณ์ — แนะนำกดถอดใหม่'}</b>
        </div>
      )}
      {cached && (
        <div style={{ marginTop: 12, fontSize: 13, padding: '8px 12px', borderRadius: 9, background: 'rgba(34,197,94,.07)', border: '1px solid #22c55e55', color: '#22c55e' }}>
          ⚡ ใบเดิมจากคลัง {fmtClock(cachedAt) || ''} — ไม่เสียค่าถอดซ้ำ อยากได้รอบใหม่กด 🔁 ถอดใหม่
        </div>
      )}

      {/* ── จุดที่ควรเช็ค (จากตัวตรวจด้วยโค้ด: เทียบชื่อ/ตัวเลข/คำพูดกับบทถอดคำต่อคำ) ── */}
      {view.checks.length > 0 && (
        <div data-testid="card-checks" style={{ marginTop: 12, fontSize: 13, lineHeight: 1.65, padding: '9px 12px', borderRadius: 9, background: 'rgba(251,191,36,.07)', border: '1px solid #fbbf2455', color: '#fde68a' }}>
          <b style={{ color: '#fbbf24' }}>จุดที่ควรเช็ค {view.checks.length} จุด</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {view.checks.map((c, i) => (
              <li key={i}><span style={{ color: '#fbbf24' }}>{CHECK_KIND_LABEL[c.kind] || 'ตรวจ'}:</span> {c.text}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── เนื้อข่าวช่องเดียว ── */}
      <div style={{ marginTop: 12, background: C.sub, borderRadius: 10, padding: '14px 16px' }}>
        {view.body ? <BodyText text={view.body} /> : <div style={{ fontSize: 13.5, color: C.muted }}>ใบนี้ไม่มีเนื้อข่าว — กดถอดใหม่</div>}
      </div>

      {view.extras.length > 0 && (
        <details style={{ marginTop: 8, fontSize: 13 }}>
          <summary style={{ cursor: 'pointer', color: C.muted }}>เนื้อแยกประเด็นของระบบเดิม ({view.extras.length})</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {view.extras.map((x, i) => (
              <div key={i} style={{ background: C.sub, borderRadius: 8, padding: '10px 12px' }}>
                {x.title && <div style={{ fontWeight: 700, marginBottom: 4 }}>{x.title}</div>}
                <div style={{ lineHeight: 1.8, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{x.text}</div>
              </div>
            ))}
          </div>
        </details>
      )}

      {!view.legacy && (
        <div style={{ marginTop: 8, fontSize: 12, color: C.muted }}>
          {view.checks.length === 0 && '✓ ตัวตรวจด้วยโค้ดไม่พบจุดที่ต้องเช็ค (เทียบคำพูด ตัวเลข และชื่อที่คนเขียนระบุ กับบทถอด)'}
          {view.fixed.length > 0 && (
            <details style={{ marginTop: view.checks.length === 0 ? 4 : 0 }}>
              <summary style={{ cursor: 'pointer' }}>โค้ดแก้คำพูดให้ตรงคลิปแล้ว {view.fixed.length} จุด</summary>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{view.fixed.map((c, i) => <li key={i}>{c.text}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
