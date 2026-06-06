'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ChatLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('กรุณากรอก Username และ Password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/chat/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.error || 'เข้าสู่ระบบไม่สำเร็จ');
        return;
      }

      // Store session
      localStorage.setItem('chat_token', data.token);
      localStorage.setItem('chat_user', JSON.stringify(data.user));

      // Redirect based on role
      if (data.user.role === 'manager' || data.user.role === 'admin') {
        router.push('/chat/admin');
      } else {
        router.push(`/chat/room/${data.user.roomSlug || 'default'}`);
      }
    } catch (err) {
      setError('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chat-login-wrapper">
      <form className="chat-login-card chat-glass" onSubmit={handleLogin}>
        {/* Logo */}
        <div style={{ textAlign: 'center', fontSize: 48, marginBottom: 8 }}>🤖</div>
        <h1>AI Content Review</h1>
        <p className="subtitle">ระบบตรวจงานคอนเทนต์อัจฉริยะ</p>

        {/* Error */}
        {error && <div className="chat-error">❌ {error}</div>}

        {/* Username */}
        <div className="chat-input-group">
          <label htmlFor="chat-username">Username</label>
          <input
            id="chat-username"
            type="text"
            className="chat-input"
            placeholder="กรอก Username ของคุณ"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
          />
        </div>

        {/* Password */}
        <div className="chat-input-group">
          <label htmlFor="chat-password">Password</label>
          <input
            id="chat-password"
            type="password"
            className="chat-input"
            placeholder="กรอก Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          className="chat-btn chat-btn-primary"
          disabled={loading}
          style={{ marginTop: 8 }}
        >
          {loading ? (
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <span className="chat-typing-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'white', animation: 'chat-typing-bounce 1.4s infinite' }} />
              <span className="chat-typing-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'white', animation: 'chat-typing-bounce 1.4s infinite 0.2s' }} />
              <span className="chat-typing-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'white', animation: 'chat-typing-bounce 1.4s infinite 0.4s' }} />
              กำลังเข้าสู่ระบบ...
            </span>
          ) : (
            '🔐 เข้าสู่ระบบ'
          )}
        </button>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 11, color: 'var(--chat-text-dim)' }}>
          Powered by Claude Sonnet 4 + GPT-4o Vision
        </div>
      </form>
    </div>
  );
}
