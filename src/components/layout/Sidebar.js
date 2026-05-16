'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navSections = [
  {
    title: 'หลัก',
    items: [
      { href: '/dashboard', icon: '📊', label: 'แดชบอร์ด' },
      { href: '/content', icon: '📰', label: 'คอนเทนต์ทั้งหมด' },
      { href: '/content/new', icon: '✨', label: 'สร้างใหม่', badge: null },
    ]
  },
  {
    title: 'ผลิตคอนเทนต์',
    items: [
      { href: '/review', icon: '📋', label: 'คลังรอตรวจ', badgeKey: 'review' },
      { href: '/publish', icon: '📤', label: 'เผยแพร่' },
    ]
  },
  {
    title: 'วิเคราะห์',
    items: [
      { href: '/analytics', icon: '📈', label: 'สถิติ' },
      { href: '/prompts', icon: '🤖', label: 'จัดการ AI Prompts' },
    ]
  },
  {
    title: 'ระบบ',
    items: [
      { href: '/settings', icon: '⚙️', label: 'ตั้งค่า' },
    ]
  }
];

export default function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Load pending review count
  useEffect(() => {
    const loadCount = () => {
      fetch('/api/review?status=pending')
        .then(r => r.json())
        .then(d => { if (d.stats) setPendingCount(d.stats.pending || 0); })
        .catch(() => {});
    };
    loadCount();
    const interval = setInterval(loadCount, 30000);
    return () => clearInterval(interval);
  }, []);

  // Close on resize to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 1024) setIsOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <>
      {/* Hamburger button — mobile only */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label="เมนู"
        style={{
          position: 'fixed',
          top: 10,
          left: 10,
          zIndex: 200,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          padding: '8px 10px',
          fontSize: 20,
          cursor: 'pointer',
          display: 'none',
          color: 'var(--text-primary)',
          boxShadow: 'var(--shadow-md)',
        }}
        className="mobile-menu-btn"
      >
        {isOpen ? '✕' : '☰'}
      </button>

      {/* Overlay — mobile */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 99,
          }}
        />
      )}

      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">🔥</div>
          <div>
            <h1>ViralFlow<span>AI Content System</span></h1>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navSections.map((section, idx) => (
            <div key={idx} className="nav-section">
              <div className="nav-section-title">{section.title}</div>
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-item ${pathname === item.href || (item.href !== '/dashboard' && pathname?.startsWith(item.href)) ? 'active' : ''}`}
                  onClick={() => setIsOpen(false)}
                >
                  <span className="nav-item-icon">{item.icon}</span>
                  <span>{item.label}</span>
                  {item.badgeKey === 'review' && pendingCount > 0 && (
                    <span className="nav-item-badge">{pendingCount}</span>
                  )}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
