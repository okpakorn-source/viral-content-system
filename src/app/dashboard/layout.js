import Sidebar from '@/components/layout/Sidebar';

export const metadata = {
  title: 'แดชบอร์ด — ViralFlow',
};

export default function DashboardLayout({ children }) {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
