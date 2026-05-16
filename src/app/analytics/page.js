'use client';
import Header from '@/components/layout/Header';
export default function AnalyticsPage() {
  return (
    <>
      <Header title="📈 สถิติ" subtitle="วิเคราะห์ผลลัพธ์คอนเทนต์ที่เผยแพร่แล้ว" />
      <div className="page-content">
        <div className="stats-grid">
          <div className="stat-card success">
            <div className="stat-card-header"><div className="stat-card-icon success">👁️</div></div>
            <div className="stat-card-value">0</div>
            <div className="stat-card-label">Reach รวม</div>
          </div>
          <div className="stat-card viral">
            <div className="stat-card-header"><div className="stat-card-icon viral">🔥</div></div>
            <div className="stat-card-value">0</div>
            <div className="stat-card-label">Engagement รวม</div>
          </div>
          <div className="stat-card accent">
            <div className="stat-card-header"><div className="stat-card-icon accent">🔄</div></div>
            <div className="stat-card-value">0</div>
            <div className="stat-card-label">Shares รวม</div>
          </div>
          <div className="stat-card warning">
            <div className="stat-card-header"><div className="stat-card-icon warning">💬</div></div>
            <div className="stat-card-value">0</div>
            <div className="stat-card-label">Comments รวม</div>
          </div>
        </div>
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📊</div>
            <div className="empty-state-title">ยังไม่มีข้อมูลสถิติ</div>
            <div className="empty-state-text">เมื่อเผยแพร่คอนเทนต์แล้ว ระบบจะดึงข้อมูลสถิติจาก Facebook มาแสดงที่นี่</div>
          </div>
        </div>
      </div>
    </>
  );
}
