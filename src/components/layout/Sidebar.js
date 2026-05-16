'use client';

import { useState } from 'react';
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
      { href: '/review', icon: '👁️', label: 'รอรีวิว', badgeKey: 'review' },
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

  return (
    <aside className="sidebar">
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
              >
                <span className="nav-item-icon">{item.icon}</span>
                <span>{item.label}</span>
                {item.badgeKey && (
                  <span className="nav-item-badge">3</span>
                )}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
