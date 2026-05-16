'use client';
import Header from '@/components/layout/Header';
export default function ReviewPage() {
  return (
    <>
      <Header title="👁️ คิวรีวิว" subtitle="ตรวจสอบและอนุมัติคอนเทนต์ก่อนเผยแพร่" />
      <div className="page-content">
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">👁️</div>
            <div className="empty-state-title">ไม่มีคอนเทนต์รอรีวิว</div>
            <div className="empty-state-text">เมื่อมีคอนเทนต์ผ่าน AI Quality Check จะแสดงที่นี่เพื่อให้ Editor ตรวจสอบ</div>
          </div>
        </div>
      </div>
    </>
  );
}
