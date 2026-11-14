'use client';
// 🎨 แผงปรับแสง · สี · ความคม ของช่องที่เลือก (หน้า /cover-tester) — 14 พ.ย. 69
//   ตัวแผงเป็น UI ล้วน: รับค่า adj เข้ามา ส่งค่าใหม่ออกทาง onChange · สูตรคำนวณอยู่ที่ src/lib/cover-editor/imageAdjust.js
//   ออกแบบให้พนักงานใช้เร็ว: กดชุดสำเร็จครั้งเดียวจบ → อยากละเอียดค่อยเลื่อนสไลเดอร์ → กดค้างเทียบต้นฉบับได้ตลอด
import { ADJUST_PRESETS, ADJUST_SLIDERS, adjustKey, isNeutralAdjust, normalizeAdjust } from '@/lib/cover-editor/imageAdjust';

const chip = (on, tone = '#60a5fa') => ({
  padding: '9px 12px', borderRadius: 9, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
  whiteSpace: 'nowrap', flexShrink: 0,
  color: on ? tone : 'var(--text-secondary)',
  background: on ? `${tone}22` : 'var(--bg-primary)',
  border: `1px solid ${on ? tone : 'var(--border)'}`,
});

export default function AdjustPanel({ adj, onChange, onApplyAll, canApplyAll, onCompare, comparing, autoAvailable = true }) {
  const a = normalizeAdjust(adj);
  const neutral = isNeutralAdjust(adj);
  const key = adjustKey(adj);
  const set = (patch) => {
    const next = { ...a, ...patch };
    onChange(isNeutralAdjust(next) ? null : next);
  };
  // กดค้าง = ดูต้นฉบับ ปล่อย = กลับมาดูที่ปรับ (รองรับเมาส์ + นิ้ว + คีย์บอร์ด)
  const hold = {
    onPointerDown: (e) => { e.preventDefault(); onCompare(true); },
    onPointerUp: () => onCompare(false),
    onPointerLeave: () => onCompare(false),
    onPointerCancel: () => onCompare(false),
    onKeyDown: (e) => { if (e.key === ' ' || e.key === 'Enter') onCompare(true); },
    onKeyUp: () => onCompare(false),
    onBlur: () => onCompare(false),
    onContextMenu: (e) => e.preventDefault(),
  };

  return (
    <div style={{ marginTop: 10, padding: 11, borderRadius: 11, background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.25)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#22c55e' }}>🎨 ปรับแสง · สี · ความคม</span>
        <span title="ระบบนี้คำนวณค่าสีของพิกเซลเดิมเท่านั้น ไม่มี AI วาด/เจนภาพใหม่ รูปหน้า ตา ปาก เหมือนต้นฉบับ 100%"
          style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, color: '#22c55e', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)' }}>
          🛡️ ไม่ใช้ AI เจนภาพ — หน้าคนเหมือนต้นฉบับ
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {!neutral && (
            <button type="button" {...hold} aria-pressed={!!comparing}
              style={{ ...chip(comparing, '#facc15'), userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none' }}>
              {/* ข้อความคงที่ — ถ้าเปลี่ยนความยาวตอนกด ปุ่มจะขยับหนีนิ้วแล้วหลุดโหมดเทียบเอง */}
              👁 กดค้าง = ดูต้นฉบับ
            </button>
          )}
          {!neutral && (
            <button type="button" onClick={() => onChange(null)} style={chip(false)} title="ล้างการปรับของช่องนี้ กลับเป็นภาพต้นฉบับ">↺ ล้าง</button>
          )}
        </div>
      </div>

      {/* ชุดสำเร็จ — ขึ้นบรรทัดใหม่เอง เห็นครบทุกปุ่มไม่ต้องเลื่อนหา */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '9px 0 4px' }}>
        {ADJUST_PRESETS.map((p) => {
          const on = adjustKey(p.adj) === key;
          return (
            <button type="button" key={p.id} title={p.hint} onClick={() => onChange(on ? null : { ...p.adj })} style={chip(on, '#22c55e')}>
              {p.label}
            </button>
          );
        })}
      </div>
      {(() => {
        const active = ADJUST_PRESETS.find((p) => adjustKey(p.adj) === key);
        return (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', minHeight: 16, marginBottom: 6 }}>
            {active ? `${active.label} — ${active.hint}` : neutral ? 'เริ่มจาก “✨ ออโต้” แล้วค่อยเลื่อนสไลเดอร์ถ้ายังไม่ถูกใจ' : 'ปรับเอง — กดชุดสำเร็จเพื่อเริ่มใหม่ได้'}
          </div>
        );
      })()}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px 16px' }}>
        {ADJUST_SLIDERS.map((sl) => {
          const v = a[sl.key];
          const changed = v !== 0;
          return (
            <label key={sl.key} style={{ display: 'block', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <span style={{ fontWeight: 700, color: changed ? '#22c55e' : 'var(--text-secondary)' }}>{sl.icon} {sl.label}</span>
                <span style={{ marginLeft: 'auto', fontWeight: 800, minWidth: 34, textAlign: 'right', color: changed ? '#22c55e' : 'var(--text-muted)' }}>
                  {v > 0 && sl.min < 0 ? '+' : ''}{v}
                </span>
                <button type="button" onClick={(e) => { e.preventDefault(); set({ [sl.key]: 0 }); }} disabled={!changed} aria-label={`รีเซ็ต${sl.label}`}
                  style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 12, cursor: changed ? 'pointer' : 'default', opacity: changed ? 1 : 0.25, padding: 0, fontFamily: 'inherit' }}>↺</button>
              </div>
              <input type="range" min={sl.min} max={sl.max} step={sl.min < 0 ? 2 : 1} value={v}
                onChange={(e) => set({ [sl.key]: Number(e.target.value) })}
                onDoubleClick={() => set({ [sl.key]: 0 })}
                style={{ width: '100%', height: 28, margin: 0, accentColor: '#22c55e' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: -2 }}>
                <span>{sl.lo}</span><span>{sl.hi}</span>
              </div>
            </label>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
        <button type="button" onClick={() => set({ auto: !a.auto })} disabled={!autoAvailable}
          title={autoAvailable ? 'ให้ระบบวัดแสงของภาพนี้แล้วปรับให้พอดี (มีเพดาน ไม่ดึงแรงจนผิดธรรมชาติ)' : 'ภาพนี้วัดแสงอัตโนมัติไม่ได้ — ใช้สไลเดอร์แทน'}
          style={{ ...chip(a.auto, '#22c55e'), opacity: autoAvailable ? 1 : 0.4, cursor: autoAvailable ? 'pointer' : 'not-allowed' }}>
          ✨ ออโต้แสง: {a.auto ? 'เปิด' : 'ปิด'}
        </button>
        {canApplyAll && !neutral && (
          <button type="button" onClick={onApplyAll} style={chip(false)} title="คัดลอกค่าการปรับของช่องนี้ไปใช้กับทุกช่องที่มีรูป (ออโต้แสงจะวัดแยกรายภาพ)">
            📋 ใช้ค่านี้กับทุกช่อง
          </button>
        )}
      </div>
    </div>
  );
}
