'use client';
import { useState, useEffect } from 'react';

/**
 * ปุ่มสลับโหมดสว่าง/มืด — ค่าถูกจำใน localStorage ('vf_theme')
 * theme ถูกตั้งก่อน paint โดย inline script ใน layout.js (default = สว่าง)
 */
export default function ThemeToggle({ compact = false }) {
  const [theme, setTheme] = useState(null); // null = ยังไม่ hydrate

  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme') || 'light');
  }, []);

  const toggle = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('vf_theme', next); } catch {}
  };

  if (theme === null) return null; // กัน hydration mismatch

  return (
    <button
      onClick={toggle}
      title={theme === 'light' ? 'สลับเป็นโหมดมืด' : 'สลับเป็นโหมดสว่าง'}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: compact ? 'auto' : '100%',
        padding: compact ? '6px 10px' : '8px 12px',
        borderRadius: 10,
        border: '1px solid var(--border)',
        background: 'var(--bg-card)',
        color: 'var(--text-secondary)',
        fontSize: 12, fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'all .2s',
        justifyContent: compact ? 'center' : 'flex-start',
      }}
    >
      <span style={{ fontSize: 14 }}>{theme === 'light' ? '🌙' : '☀️'}</span>
      {!compact && <span>{theme === 'light' ? 'โหมดมืด' : 'โหมดสว่าง'}</span>}
    </button>
  );
}
