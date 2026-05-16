import Sidebar from '@/components/layout/Sidebar';
export default function L({ children }) {
  return <div className="app-layout"><Sidebar /><main className="main-content">{children}</main></div>;
}
