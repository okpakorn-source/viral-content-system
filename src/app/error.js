'use client';
export default function Error({ error, reset }) {
  return (
    <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>
      <h2 style={{ color: '#f87171', marginBottom: 16 }}>⚠️ เกิดข้อผิดพลาด</h2>
      <p style={{ color: '#94a3b8', marginBottom: 24 }}>{error?.message || 'ระบบขัดข้อง กรุณาลองใหม่'}</p>
      <button onClick={() => reset()} style={{ padding: '10px 28px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 16 }}>
        ลองใหม่อีกครั้ง
      </button>
    </div>
  );
}
