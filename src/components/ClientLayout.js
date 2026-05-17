'use client';
import { usePathname } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Sidebar from '@/components/layout/Sidebar';
import WorkflowProvider from '@/components/WorkflowContext';
import WorkflowTracker from '@/components/WorkflowTracker';

export default function ClientLayout({ children }) {
  const pathname = usePathname();

  // Login page — no sidebar, no auth guard
  if (pathname === '/login') {
    return children;
  }

  // All other pages — auth guard + sidebar + workflow tracker
  return (
    <AuthGuard>
      <WorkflowProvider>
        <div style={{ display: 'flex', minHeight: '100vh' }}>
          <Sidebar />
          <main className="main-content">
            {children}
          </main>
        </div>
        <WorkflowTracker />
      </WorkflowProvider>
    </AuthGuard>
  );
}
