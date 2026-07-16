'use client';

// ============================================================
// 🧬 DNA Lab — ตัวช่วย UI ที่ใช้ร่วมกันทุกคอมโพเนนต์ (โต๊ะข่าวกลาง v2)
// palette อิง CSS variables (theme-aware light/dark) + สีเน้นคงที่ · apiFetch กัน response ไม่ใช่ JSON
// ============================================================

// ── palette: ฐานอิง var(--...) (สลับตามธีม) + สีเน้นคงที่ ──
export const UI = {
  bg: 'var(--bg-primary)',
  card: 'var(--bg-card)',
  card2: 'var(--bg-elevated)',
  line: 'var(--border)',
  line2: 'var(--border-light)',
  text: 'var(--text-primary)',
  dim: 'var(--text-secondary)',
  muted: 'var(--text-muted)',
  accent: '#7c3aed',
  accent2: '#f91880',
  gold: '#f59e0b',    // 🥇 กลุ่ม S
  silver: '#94a3b8',  // 🥈 กลุ่ม A
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
  blue: '#3b82f6',
};

// ── fetch helper เดียวของทั้งหน้า — กัน backend ตอบ HTML/timeout ทำหน้า crash ──
export async function apiFetch(url, opts) {
  try {
    const res = await fetch(url, opts);
    const status = res.status;
    let txt = '';
    try { txt = await res.text(); } catch { txt = ''; }
    let data;
    try {
      data = txt ? JSON.parse(txt) : {};
    } catch {
      return {
        success: false,
        error: `เซิร์ฟเวอร์ตอบไม่ใช่ JSON (สถานะ ${status} — อาจ timeout/ล่ม)`,
        errorType: 'BAD_RESPONSE',
        _status: status,
        _raw: String(txt).slice(0, 200),
      };
    }
    if (data && typeof data === 'object') data._status = status;
    return data;
  } catch (e) {
    return {
      success: false,
      error: 'เชื่อมต่อ API ไม่สำเร็จ: ' + (e?.message || String(e)),
      errorType: 'NETWORK',
      _status: 0,
    };
  }
}

// ── ฟอร์แมตตัวเลข/เงิน/เวลา ──
export const fmtNum = (n) => (Number(n) || 0).toLocaleString('th-TH');
export const fmtBaht = (n) => '฿' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('th-TH');
export function fmtDuration(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (s < 60) return `${s} วินาที`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} นาที ${s % 60} วิ`;
  return `${Math.floor(m / 60)} ชม. ${m % 60} นาที`;
}

// ── สปินเนอร์เล็ก (ใช้ keyframe 'nd-spin' ที่ประกาศไว้ใน page.js) ──
export function Spinner({ size = 14, color }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        border: `2px solid ${color || 'currentColor'}`,
        borderTopColor: 'transparent',
        borderRadius: '50%',
        animation: 'nd-spin 0.7s linear infinite',
        verticalAlign: 'middle',
      }}
    />
  );
}

// ── ปุ่มมาตรฐาน: สูง ≥44px (แตะง่ายบนมือถือ) + สถานะ busy (spinner + disabled) ──
export function Btn({ children, onClick, busy, disabled, variant = 'primary', style, type = 'button', title }) {
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    padding: '10px 18px',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 700,
    fontFamily: 'inherit',
    cursor: disabled || busy ? 'not-allowed' : 'pointer',
    opacity: disabled || busy ? 0.55 : 1,
    border: '1px solid transparent',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  };
  const variants = {
    primary: { background: `linear-gradient(135deg, ${UI.accent}, ${UI.accent2})`, color: '#fff' },
    solid: { background: UI.accent, color: '#fff' },
    green: { background: UI.green, color: '#04220f' },
    ghost: { background: 'transparent', color: UI.text, border: `1px solid ${UI.line2}` },
    danger: { background: 'transparent', color: UI.red, border: `1px solid ${UI.red}` },
    subtle: { background: UI.card2, color: UI.text, border: `1px solid ${UI.line}` },
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled || busy}
      style={{ ...base, ...(variants[variant] || variants.primary), ...style }}
    >
      {busy && <Spinner size={14} color="#fff" />}
      {children}
    </button>
  );
}

// ── การ์ด/กล่องพื้นฐาน ──
export function Card({ children, style }) {
  return (
    <div style={{ background: UI.card, border: `1px solid ${UI.line}`, borderRadius: 16, padding: 18, ...style }}>
      {children}
    </div>
  );
}

// ── ป้ายชิปเล็ก ──
export function Chip({ children, color, style }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: color ? `${color}22` : UI.card2,
        color: color || UI.dim,
        border: `1px solid ${color ? color + '55' : UI.line}`,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// ── ป้ายกลุ่ม (S = ทอง, A = เงิน) ──
export function tierMeta(tier) {
  if (tier === 'S') return { label: '🥇 S ต้นแบบทอง', color: UI.gold };
  if (tier === 'A') return { label: '🥈 A ต้นแบบเงิน', color: UI.silver };
  return { label: 'กลุ่มควบคุม', color: UI.muted };
}
