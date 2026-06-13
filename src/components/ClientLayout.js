'use client';
import { usePathname } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Sidebar from '@/components/layout/Sidebar';
import WorkflowProvider from '@/components/WorkflowContext';
import WorkflowTracker from '@/components/WorkflowTracker';

// ★ หน้าสาธารณะ — ไม่ต้องล็อกอิน ไม่มี sidebar (เครื่องมือเดี่ยวให้พนักงานใช้ผ่านลิงก์เดียว)
//   13 มิ.ย. 69: /cover-tester = หน้าทำปกแมนนวล เปิดให้พนักงานเข้าใช้ได้เลยไม่ต้องเข้าระบบ
const PUBLIC_ROUTES = ['/login', '/cover-tester'];

export default function ClientLayout({ children }) {
  const pathname = usePathname();

  // หน้าสาธารณะ — ปล่อยผ่าน ไม่มี sidebar ไม่มี auth guard
  if (PUBLIC_ROUTES.includes(pathname)) {
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
