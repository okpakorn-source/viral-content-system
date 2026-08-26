'use client';
/** ป้ายสถานะกลม — ใช้ซ้ำทุกที่ (บอร์ดงาน/คลัง/ผลสด) */
import { getStatusMeta } from './statusMeta';

export default function StatusPill({ status, text, title, size = 13 }) {
  const m = getStatusMeta(status);
  return (
    <span
      title={title || ''}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 10px', borderRadius: 999, whiteSpace: 'nowrap',
        fontSize: size, fontWeight: 600, color: m.color,
        background: m.bg, border: `1px solid ${m.border}`,
      }}
    >
      {m.emoji} {text || m.label}
    </span>
  );
}
