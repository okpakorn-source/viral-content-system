'use client';
import Header from '@/components/layout/Header';
export default function PublishPage() {
  return (
    <>
      <Header title="📤 เผยแพร่" subtitle="จัดการตารางเผยแพร่คอนเทนต์" />
      <div className="page-content">
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📤</div>
            <div className="empty-state-title">ยังไม่มีคอนเทนต์ที่พร้อมเผยแพร่</div>
            <div className="empty-state-text">คอนเทนต์ที่ผ่านการอนุมัติจะแสดงที่นี่เพื่อกำหนดตารางเผยแพร่</div>
          </div>
        </div>
      </div>
    </>
  );
}
