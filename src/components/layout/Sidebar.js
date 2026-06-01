'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [reviewCount, setReviewCount] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetch('/api/auth').then(r => r.json()).then(d => {
      if (d.loggedIn) setUser(d.member);
    }).catch(() => {});
    fetch('/api/review').then(r => r.json()).then(d => {
      if (d.success) setReviewCount(d.stats?.pending || 0);
    }).catch(() => {});
  }, [pathname]);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    });
    router.push('/login');
  };

  const navItems = [
    { label: 'แดชบอร์ด', icon: '📊', href: '/' },
    { label: 'คอนเทนต์ทั้งหมด', icon: '📰', href: '/content' },
    { label: 'สร้างใหม่', icon: '✨', href: '/content/new', highlight: true },
    { type: 'divider', label: 'เครื่องมือ' },
    { label: 'Viral Radar', icon: '📡', href: '/radar', highlight: true },
    { label: 'คลังข่าว', icon: '📦', href: '/news-archive' },
    { label: 'คลังรอตรวจ', icon: '📋', href: '/review', badge: reviewCount },
    { label: 'เผยแพร่', icon: '📤', href: '/publish' },
    { type: 'divider', label: 'AI Intelligence' },
    { label: 'หอสมุดไวรัล', icon: '📚', href: '/viral-library' },
    { label: 'หอสมุด Prompt', icon: '🏛️', href: '/prompt-library' },
    { label: 'จัดการ AI Prompts', icon: '🤖', href: '/prompts' },
    { label: 'News Core Filter', icon: '🔬', href: '/news-filter', highlight: true },
    { label: 'Cover premium', icon: '✨', href: '/cover-maker', highlight: true },
    { label: 'คลังรูป', icon: '🖼️', href: '/cover-gallery' },

    { type: 'divider', label: 'ระบบ' },
    { label: 'เช็คสุขภาพระบบ', icon: '🔍', href: '/system-health' },
    { label: 'Pipeline Logs', icon: '📋', href: '/pipeline-logs' },
    { label: 'Generation Log', icon: '🧪', href: '/generation-logs' },
    { label: 'สถิติ', icon: '📈', href: '/analytics' },
    { label: 'จัดการสมาชิก', icon: '👥', href: '/members' },
    { label: 'Discord Bot', icon: '👾', href: '/discord-bot', highlight: true },
    { label: 'ตั้งค่า', icon: '⚙️', href: '/settings' },
  ];

  return (
    <>
      {/* Mobile Toggle Button */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="sidebar-toggle"
        aria-label="Toggle menu"
      >
        {mobileOpen ? '✕' : '☰'}
      </button>

      {/* Mobile Overlay */}
      {mobileOpen && (
        <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        {/* Logo */}
        <div className="sidebar-logo">
          <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>⚡</span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, background: 'linear-gradient(135deg, #f91880, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>ViralFlow</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>AI Content System</div>
            </div>
          </Link>
        </div>

        {/* Nav */}
        <nav className="sidebar-nav">
          {navItems.map((item, i) => {
            if (item.type === 'divider') {
              return <div key={i} className="sidebar-divider">{item.label}</div>;
            }
            const isActive = pathname === item.href;
            return (
              <Link key={i} href={item.href}
                className={`sidebar-link ${isActive ? 'active' : ''} ${item.highlight ? 'highlight' : ''}`}>
                <span className="sidebar-icon">{item.icon}</span>
                <span className="sidebar-label">{item.label}</span>
                {item.badge > 0 && (
                  <span className="sidebar-badge">{item.badge}</span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User Info */}
        {!user && (
          <div className="sidebar-footer">
            <Link href="/login" className="sidebar-login-btn">🔐 เข้าสู่ระบบ</Link>
          </div>
        )}
        {user && (
          <div className="sidebar-footer">
            <div className="sidebar-user">
              <div className="sidebar-avatar">{user.avatar}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="sidebar-username">{user.displayName}</div>
                <div className="sidebar-role">
                  {user.role === 'admin' ? '👑 Admin' : user.role === 'editor' ? '✏️ Editor' : '👁️ Viewer'}
                </div>
              </div>
            </div>
            <button onClick={handleLogout} className="sidebar-logout-btn">🚪 ออกจากระบบ</button>
          </div>
        )}
      </aside>
    </>
  );
}
