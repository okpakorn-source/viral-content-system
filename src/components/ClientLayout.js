'use client';
import { usePathname } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Sidebar from '@/components/layout/Sidebar';

export default function ClientLayout({ children }) {
  const pathname = usePathname();

  // Login page — no sidebar, no auth guard
  if (pathname === '/login') {
    return children;
  }

  // All other pages — auth guard + sidebar
  return (
    <AuthGuard>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <Sidebar />
        <main style={{ flex: 1, marginLeft: 240, minHeight: '100vh', overflowY: 'auto' }}>
          {children}
        </main>
      </div>
    </AuthGuard>
  );
}
