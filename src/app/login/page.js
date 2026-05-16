'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!username || !password) { setError('กรุณากรอกข้อมูล'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username, password }),
      });
      const data = await res.json();
      if (data.success) {
        router.push('/content/new');
        router.refresh();
      } else {
        setError(data.error || 'เข้าสู่ระบบไม่สำเร็จ');
      }
    } catch { setError('เกิดข้อผิดพลาด'); }
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0d0d2b 100%)',
      padding: 20,
    }}>
      <div style={{
        width: '100%', maxWidth: 400, padding: 40, borderRadius: 20,
        background: 'rgba(26,26,46,0.8)', backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>⚡</div>
          <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0, background: 'linear-gradient(135deg, #f91880, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            ViralFlow
          </h1>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>ระบบผลิตคอนเทนต์ไวรัล AI</div>
        </div>

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#ef4444', textAlign: 'center' }}>
            ❌ {error}
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>ชื่อผู้ใช้</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)}
              placeholder="username" autoFocus
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 10, fontSize: 14,
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)',
                color: '#fff', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
              }} />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>รหัสผ่าน</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 10, fontSize: 14,
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)',
                color: '#fff', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
              }} />
          </div>

          <button type="submit" disabled={loading}
            style={{
              width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
              background: loading ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #f91880, #7c3aed)',
              color: '#fff', fontSize: 15, fontWeight: 800, cursor: loading ? 'wait' : 'pointer',
              fontFamily: 'inherit', boxShadow: '0 8px 25px rgba(249,24,128,0.3)',
              transition: 'all 0.3s',
            }}>
            {loading ? '⏳ กำลังเข้าสู่ระบบ...' : '🔐 เข้าสู่ระบบ'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
          Default: admin / admin123
        </div>
      </div>
    </div>
  );
}
