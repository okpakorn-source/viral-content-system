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
    // Load session
    fetch('/api/auth').then(r => r.json()).then(d => {
      if (d.loggedIn) setUser(d.member);
    }).catch(() => {});

    // Load review count
    fetch('/api/review').then(r => r.json()).then(d => {
      if (d.success) setReviewCount(d.stats?.pending || 0);
    }).catch(() => {});
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
    { label: 'คลังรอตรวจ', icon: '📋', href: '/review', badge: reviewCount },
    { label: 'เผยแพร่', icon: '📤', href: '/publish' },
    { type: 'divider', label: 'ระบบ' },
    { label: 'สถิติ', icon: '📈', href: '/analytics' },
    { label: 'จัดการ AI Prompts', icon: '🤖', href: '/prompts' },
    ...(user?.role === 'admin' ? [{ label: 'จัดการสมาชิก', icon: '👥', href: '/members' }] : []),
    { label: 'ตั้งค่า', icon: '⚙️', href: '/settings' },
  ];

  const sidebarContent = (
    <>
      {/* Logo */}
      <div style={{ padding: '20px 16px', borderBottom: '1px solid var(--border)' }}>
        <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24 }}>⚡</span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, background: 'linear-gradient(135deg, #f91880, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>ViralFlow</div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>AI Content System</div>
          </div>
        </Link>
      </div>

      {/* Nav */}
      <nav style={{ padding: '12px 8px', flex: 1, overflowY: 'auto' }}>
        {navItems.map((item, i) => {
          if (item.type === 'divider') {
            return <div key={i} style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', padding: '16px 12px 6px', textTransform: 'uppercase', letterSpacing: 1 }}>{item.label}</div>;
          }
          const isActive = pathname === item.href;
          return (
            <Link key={i} href={item.href} onClick={() => setMobileOpen(false)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                borderRadius: 8, textDecoration: 'none', marginBottom: 2, fontSize: 13,
                fontWeight: isActive ? 700 : 500, transition: 'all 0.2s',
                background: isActive ? 'var(--accent-glow)' : item.highlight ? 'linear-gradient(135deg, rgba(249,24,128,0.1), rgba(124,58,237,0.1))' : 'transparent',
                color: isActive ? 'var(--accent-light)' : 'var(--text-secondary)',
                border: item.highlight && !isActive ? '1px solid rgba(249,24,128,0.2)' : 'none',
              }}>
              <span style={{ fontSize: 16 }}>{item.icon}</span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.badge > 0 && (
                <span style={{ background: '#f91880', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>{item.badge}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User Info */}
      {user && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{user.avatar}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.displayName}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{user.role === 'admin' ? '👑 Admin' : user.role === 'editor' ? '✏️ Editor' : '👁️ Viewer'}</div>
            </div>
          </div>
          <button onClick={handleLogout} style={{ width: '100%', padding: '6px 0', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-muted)', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
            🚪 ออกจากระบบ
          </button>
        </div>
      )}
    </>
  );

  return (
    <>
      {/* Mobile Toggle */}
      <button onClick={() => setMobileOpen(!mobileOpen)} className="sidebar-toggle"
        style={{ position: 'fixed', top: 12, left: 12, zIndex: 1001, width: 36, height: 36, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 18, cursor: 'pointer', display: 'none' }}>
        {mobileOpen ? '✕' : '☰'}
      </button>

      {/* Overlay */}
      {mobileOpen && <div onClick={() => setMobileOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999 }} />}

      {/* Sidebar */}
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}
        style={{ width: 240, height: '100vh', position: 'fixed', left: 0, top: 0, background: 'var(--bg-elevated)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', zIndex: 1000, transition: 'transform 0.3s' }}>
        {sidebarContent}
      </aside>
    </>
  );
}
