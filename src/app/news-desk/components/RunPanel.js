'use client';

// 🧬 DNA Lab — ขั้น 4: หน้าจอ Run (หัวใจ) — progress + ตัวนับ + log + หยุด/ทำต่อ
// ทุกก้อนที่วิจัยเสร็จถูก saveBatch ทันที — ปิดแท็บกลางคันไม่เสียของ

import { UI, Btn, Card, Spinner, fmtNum } from './ui.js';

export default function RunPanel({ progress, counters, log, running, paused, onPause, onResume }) {
  const total = progress.total || 0;
  const done = Math.min(progress.done || 0, total);
  const pct = total ? Math.round((done / total) * 100) : 0;

  const counter = (icon, label, value, color) => (
    <div style={{ background: UI.card2, border: `1px solid ${UI.line}`, borderRadius: 12, padding: 12, textAlign: 'center' }}>
      <div style={{ fontSize: 18 }}>{icon}</div>
      <div style={{ fontSize: 'clamp(18px, 4.6vw, 24px)', fontWeight: 900, color: color || UI.text }}>{fmtNum(value)}</div>
      <div style={{ fontSize: 11.5, color: UI.dim }}>{label}</div>
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: UI.text }}>
            {running && !paused ? <>{<Spinner size={16} color={UI.accent} />} กำลังวิจัย…</> : paused ? '⏸ หยุดชั่วคราว' : '🏁 วิจัยครบแล้ว'}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 700, color: UI.dim }}>
            ก้อน {fmtNum(done)} / {fmtNum(total)} ({pct}%)
          </span>
        </div>

        {/* progress bar */}
        <div style={{ height: 14, borderRadius: 999, background: UI.card2, overflow: 'hidden', border: `1px solid ${UI.line}` }}>
          <div style={{
            width: `${pct}%`, height: '100%', borderRadius: 999,
            background: `linear-gradient(90deg, ${UI.accent}, ${UI.accent2})`,
            transition: 'width 0.4s ease',
          }} />
        </div>

        {/* ตัวนับ */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginTop: 14 }}>
          {counter('🔬', 'วิจัยแล้ว', counters.researched, UI.accent)}
          {counter('💾', 'เก็บเข้าคลัง', counters.saved, UI.green)}
          {counter('♻️', 'ซ้ำ/ข้าม', counters.dup, UI.amber)}
          {counter('⚠️', 'พลาด', counters.failed, UI.red)}
        </div>

        {/* ปุ่มควบคุม */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
          {running && !paused && (
            <Btn variant="subtle" onClick={onPause} style={{ flex: '1 1 160px' }}>⏸ หยุด (จบก้อนนี้ก่อน)</Btn>
          )}
          {running && paused && (
            <Btn variant="green" onClick={onResume} style={{ flex: '1 1 160px' }}>▶ ทำต่อ</Btn>
          )}
        </div>
        {running && paused && (
          <div style={{ fontSize: 12, color: UI.muted, marginTop: 8 }}>
            หยุดแล้ว — ผลที่วิจัยไปถูกเก็บเข้าคลังหมดแล้ว กด &quot;ทำต่อ&quot; เพื่อวิจัยส่วนที่เหลือ
          </div>
        )}
      </Card>

      {/* log ล่าสุด */}
      <Card>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: UI.text, marginBottom: 8 }}>📜 บันทึกล่าสุด</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {(log && log.length ? log : ['— ยังไม่มีบันทึก —']).map((line, i) => (
            <div key={i} style={{
              fontSize: 12.5, color: i === 0 ? UI.text : UI.dim, fontFamily: 'ui-monospace, monospace',
              padding: '6px 10px', background: UI.card2, borderRadius: 8, borderLeft: `3px solid ${i === 0 ? UI.accent : UI.line}`,
              wordBreak: 'break-word',
            }}>
              {line}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
