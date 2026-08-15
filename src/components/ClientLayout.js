'use client';
import { usePathname } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Sidebar from '@/components/layout/Sidebar';
import WorkflowProvider from '@/components/WorkflowContext';
import WorkflowTracker from '@/components/WorkflowTracker';

// ★ หน้าสาธารณะ — ไม่ต้องล็อกอิน ไม่มี sidebar (เครื่องมือเดี่ยวให้พนักงานใช้ผ่านลิงก์เดียว)
//   13-15 มิ.ย. 69: /cover-tester = ทำปก, /news-filter = สกัดข่าว, /clip-transcript = ถอดบทสัมภาษณ์ — เปิดสาธารณะไม่ต้องล็อกอิน
//   ★ 15 ส.ค. 69 (เจ้าของสั่ง): /generation-logs = คลังผลงานเขียน เปิดให้พนักงานเข้าได้ไม่ต้องล็อกอิน
//     กั้นด้วยด่านถามชื่อเล่น (NicknameGate) ในตัวหน้าเอง — เป็นแค่ป้ายชื่อ ไม่ใช่ระบบความปลอดภัย
const PUBLIC_ROUTES = ['/login', '/cover-tester', '/image-search', '/news-filter', '/clip-transcript', '/quick-cover', '/cover-techniques', '/cover-ref-test', '/mega-compose-test', '/m', '/generation-logs']; // ★ 26 ก.ค.: /m = แอพมือถือ ViralFlow แยกตัวจากเปลือกเว็บ (ไม่มี sidebar/เมนู) — ด่านล็อกอินอยู่ในตัวแอพเอง (เช็ค session + เด้ง /login?next=/m) // ★ 4 ก.ค.: /image-search คู่กับ /cover-tester · 9 ก.ค.: /quick-cover เทสปกบนมือถือ · 10 ก.ค.: /cover-techniques คลังเทคนิคปกแสนไลค์ · ⛔ 10 ก.ค.: ถอด /photo-enhance /casting (ลบระบบแล้ว) · ⛔ 16 ก.ค.: ถอด /news-desk (ยุบโต๊ะข่าวกลาง) · ★ 17 ก.ค.: /cover-ref-test เปิดสาธารณะใช้คิวบนมือถือ (ท่อหนักกั้นด้วยคีย์ทีมที่ middleware แล้ว)

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
