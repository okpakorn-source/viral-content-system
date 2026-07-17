'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import ThemeToggle from '@/components/ThemeToggle';

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

  // ★ 17 มิ.ย. (ผู้จัดการรื้อชื่อ/ลำดับเมนูให้เรียกง่าย จำง่าย): ชื่อไทยชัด + เรียงใช้บ่อยขึ้นบน +
  //   จัดกลุ่มหัวข้อ + ไฮไลต์เฉพาะเมนูสำคัญให้เด่น · เปลี่ยนแค่ชื่อแสดงผล/ลำดับ/สี ไม่แตะ route/เวิร์กโฟลว์
  const navItems = [
    // ── ⭐ ใช้งานหลัก (ใช้บ่อยสุด — มาร์คสีเด่น) ──
    { type: 'divider', label: '⭐ ใช้งานหลัก' },
    // ⛔ 16 ก.ค. 69: ถอดเมนูโต๊ะข่าวกลาง + คลังส่งเช้า (ยุบระบบโต๊ะข่าว — จะสร้างใหม่; กู้คืน: _removed-systems-backup-20260716)
    { label: 'โต๊ะข่าว v2 — DNA Lab', icon: '🧬', href: '/news-desk', highlight: true },
    { label: 'สร้างคอนเทนต์ใหม่', icon: '✨', href: '/content/new', highlight: true },
    { label: 'ผลงานที่เขียนแล้ว', icon: '🧪', href: '/generation-logs' },
    { label: 'คอนเทนต์ทั้งหมด', icon: '📰', href: '/content' },
    { label: 'หน้าแรก (แดชบอร์ด)', icon: '📊', href: '/' },

    // ── 🏭 MEGA สายพานครบวงจร (7 ก.ค.) ──
    { type: 'divider', label: '🏭 MEGA สายพาน' },
    { label: 'MEGA คุมสายพาน', icon: '🏭', href: '/mega', highlight: true },
    { label: 'เทสปกเทียบ ref', icon: '🎯', href: '/cover-ref-test' },
    { label: 'ทางลัดประกอบจากเคสเดิม', icon: '⚡', href: '/mega-compose-test' }, // ★ 17 ก.ค.: ทางเข้า UI (จูนครอป/โครงเร็ว ~20 วิ ไม่ค้นภาพใหม่)
    { label: 'คลังปก reference + DNA', icon: '🧬', href: '/ref-covers' },
    { label: 'คลังงานปก MEGA', icon: '🗂️', href: '/mega-covers' },
    { label: 'คลังเทคนิคปกแสนไลค์', icon: '📚', href: '/cover-techniques' },

    // ── 🛠️ เครื่องมือข่าว ──
    { type: 'divider', label: '🛠️ เครื่องมือข่าว' },
    { label: 'กรองแก่นข่าว (สกัดเนื้อ)', icon: '🔬', href: '/news-filter' },
    { label: 'ถอดคลิปเป็นข้อความ', icon: '🎙️', href: '/clip-transcript' },
    // ⛔ 10 ก.ค. 2026: ลบระบบ photo-enhance / image-hunt / casting ทั้งระบบตามคำสั่งผู้ใช้ (ไม่มีระบบอื่นพึ่งพา — เช็คแล้ว)
    //   กู้คืน: git log หา commit "remove unused tool systems" แล้ว revert (โค้ดทั้งหมดอยู่ใน git history)
    // ★ 22 มิ.ย.: ปิดเมนู "เรดาร์หากระแส" (เลิกใช้ ใช้โต๊ะข่าวกลางแทน — กันเปิดแล้วกินโทเคน) · เปิดคืน: ปลดคอมเมนต์ + ตั้ง env RADAR_ENABLED=1
    // { label: 'เรดาร์หากระแส', icon: '📡', href: '/radar' },
    { label: 'คลังข่าวเก่า', icon: '📦', href: '/news-archive' },
    { label: 'คลังรอตรวจ', icon: '📋', href: '/review', badge: reviewCount },

    // ── 🖼️ ภาพปก & สื่อ ──
    { type: 'divider', label: '🖼️ ภาพปก & สื่อ' },
    // ⛔ 2 ก.ค. 2026: ปิดชั่วคราวตามคำสั่งผู้ใช้ (รอรื้อสร้างใหม่) · เปิดคืน: ปลดคอมเมนต์ + คืน export default ใน page.js
    // { label: 'สร้างปกอัตโนมัติ', icon: '🔥', href: '/cover-lab', highlight: true },
    { label: 'แม่แบบปก (14 แบบ)', icon: '🎨', href: '/cover-tester' },
    { label: 'ค้นภาพหลายแหล่ง (เลือกลงปก)', icon: '🔎', href: '/image-search' }, // ★ 4 ก.ค.: พอร์ตรีเสิร์ชภาพจากระบบทำปกออโต้
    // ⛔ 14 ก.ค. 2026: ลบระบบ cover-maker / image-maker / cover-gallery ทั้งระบบตามคำสั่งผู้ใช้ (เช็คแล้วไม่มีท่ออัตโนมัติพึ่งพา)
    //   กู้คืน: git history หรือโฟลเดอร์ _removed-systems-backup-20260714 · lib imageGallery ยังอยู่ (auto-cover ใช้เขียนคลัง)
    // ⛔ 2 ก.ค. 2026: ปิดชั่วคราวตามคำสั่งผู้ใช้ (รอรื้อสร้างใหม่)
    // { label: 'คลังปกที่ทำแล้ว', icon: '📁', href: '/cover-archive' },

    // ── 📚 คลังความรู้ AI ──
    { type: 'divider', label: '📚 คลังความรู้ AI' },
    { label: 'คลังตัวอย่างไวรัล', icon: '📚', href: '/viral-library' },
    // ⛔ 2 ก.ค. 2026: ปิดชั่วคราวตามคำสั่งผู้ใช้ (รอรื้อสร้างใหม่)
    // { label: 'คลังแตกประเด็นข่าว (เนื้อหาดิบ)', icon: '♻️', href: '/reframe-cases' },
    { label: 'คลังพรอมต์', icon: '🏛️', href: '/prompt-library' },
    { label: 'ตั้งค่าพรอมต์ AI', icon: '🤖', href: '/prompts' },

    // ⛔ 10 ก.ค. 2026: ลบระบบห้องแชททีม (/chat) ทั้งระบบตามคำสั่งผู้ใช้ — กู้คืนจาก git history
    // ── ⚙️ ระบบ & จัดการ ──
    { type: 'divider', label: '⚙️ ระบบ & จัดการ' },
    { label: 'เช็คสุขภาพระบบ', icon: '🩺', href: '/system-health' },
    { label: 'บันทึกการทำงาน (Pipeline)', icon: '🧾', href: '/pipeline-logs' },
    { label: 'สถิติการใช้งาน', icon: '📈', href: '/analytics' },
    { label: 'จัดการสมาชิก', icon: '👥', href: '/members' },
    { label: 'บอท Discord', icon: '👾', href: '/discord-bot' },
    { label: 'ตั้งค่าระบบ', icon: '⚙️', href: '/settings' },
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

        {/* Theme Toggle */}
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
          <ThemeToggle />
        </div>

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
