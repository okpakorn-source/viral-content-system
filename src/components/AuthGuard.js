'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthGuard({ children }) {
  const [user, setUser] = useState(null);
  const [checked, setChecked] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    // Check auth on every route change to detect stale sessions
    let cancelled = false;
    fetch('/api/auth')
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (d.loggedIn && d.member) {
          setUser(d.member);
        } else {
          setUser(null);
        }
        setChecked(true);
      })
      .catch(() => {
        if (!cancelled) setChecked(true);
      });
    return () => { cancelled = true; };
  }, [pathname]);

  // Login page is always accessible
  if (pathname === '/login') return children;

  // Still checking - show loading
  if (!checked) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary, #0d0d1a)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚡</div>
          <div style={{ color: '#888', fontSize: 13 }}>กำลังตรวจสอบ...</div>
        </div>
      </div>
    );
  }

  // Not logged in - show lock screen
  if (!user) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0d0d2b 100%)',
        padding: 20,
      }}>
        <div style={{
          width: '100%', maxWidth: 420, padding: 40, borderRadius: 20,
          background: 'rgba(26,26,46,0.8)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center',
          boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
        }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🔒</div>
          <h2 style={{ fontSize: 20, fontWeight: 900, margin: '0 0 8px', color: '#fff' }}>กรุณาเข้าสู่ระบบ</h2>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: '0 0 24px' }}>
            คุณต้องเข้าสู่ระบบก่อนจึงจะใช้งานได้
          </p>
          <button onClick={() => router.push('/login')}
            style={{
              width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
              background: 'linear-gradient(135deg, #f91880, #7c3aed)',
              color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer',
              fontFamily: 'inherit', boxShadow: '0 8px 25px rgba(249,24,128,0.3)',
            }}>
            🔐 ไปหน้าเข้าสู่ระบบ
          </button>
        </div>
      </div>
    );
  }

  // Logged in
  return (
    <AuthContext.Provider value={user}>
      {children}
    </AuthContext.Provider>
  );
}
