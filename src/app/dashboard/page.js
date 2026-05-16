'use client';

import { useState, useEffect } from 'react';
import Header from '@/components/layout/Header';
import Link from 'next/link';

const mockStats = {
  totalContent: 156,
  pendingReview: 12,
  publishedToday: 8,
  avgViralScore: 7.4,
};

const mockRecentContent = [
  {
    id: '1',
    title: 'แม่ค้าส้มตำวัย 70 ยืนขายกลางฝน ลูกค้าน้ำตาซึม',
    status: 'review',
    viralScore: 92,
    createdAt: '2 นาทีที่แล้ว',
    tone: 'emotional',
  },
  {
    id: '2',
    title: 'เด็ก ม.3 สอบติดหมอ แต่ไม่มีเงินเรียน พ่อวินมอเตอร์ไซค์ร่ำไห้',
    status: 'generating',
    viralScore: 88,
    createdAt: '15 นาทีที่แล้ว',
    tone: 'dramatic',
  },
  {
    id: '3',
    title: 'ดราม่า! ร้านกาแฟดังไล่ลูกค้าออก เหตุนั่งนานไม่สั่งเพิ่ม',
    status: 'approved',
    viralScore: 85,
    createdAt: '1 ชั่วโมงที่แล้ว',
    tone: 'controversial',
  },
  {
    id: '4',
    title: 'หนุ่มส่งของเจอสุนัขจรจัด ตัดสินใจรับเลี้ยง กลายเป็นเพื่อนซี้',
    status: 'published',
    viralScore: 78,
    createdAt: '3 ชั่วโมงที่แล้ว',
    tone: 'emotional',
  },
  {
    id: '5',
    title: 'คนงานก่อสร้างลงขัน ซื้อลอตเตอรี่ ถูกรางวัลที่ 1 แบ่งกัน 20 คน',
    status: 'published',
    viralScore: 95,
    createdAt: '5 ชั่วโมงที่แล้ว',
    tone: 'emotional',
  },
];

const pipelineSteps = [
  { label: 'ดึงข้อมูล', count: 3, status: 'done' },
  { label: 'วิเคราะห์', count: 2, status: 'active' },
  { label: 'สร้างบทความ', count: 1, status: 'active' },
  { label: 'สร้างปก', count: 1, status: 'pending' },
  { label: 'รอรีวิว', count: 12, status: 'pending' },
  { label: 'เผยแพร่', count: 0, status: 'pending' },
];

function getViralClass(score) {
  if (score >= 80) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

function getToneLabel(tone) {
  const map = {
    emotional: '💖 อารมณ์',
    dramatic: '🎭 ดราม่า',
    controversial: '🔥 ถกเถียง',
    concise: '⚡ กระชับ',
  };
  return map[tone] || tone;
}

export default function DashboardPage() {
  const [animatedStats, setAnimatedStats] = useState({
    totalContent: 0, pendingReview: 0, publishedToday: 0, avgViralScore: 0,
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimatedStats(mockStats);
    }, 200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <Header title="แดชบอร์ด" subtitle="ภาพรวมระบบผลิตคอนเทนต์ AI">
        <Link href="/content/new" className="btn btn-viral btn-sm">
          ✨ สร้างคอนเทนต์ใหม่
        </Link>
      </Header>

      <div className="page-content">
        {/* Stats Cards */}
        <div className="stats-grid fade-in">
          <div className="stat-card accent">
            <div className="stat-card-header">
              <div className="stat-card-icon accent">📰</div>
              <div className="stat-card-change up">↑ 12%</div>
            </div>
            <div className="stat-card-value">{animatedStats.totalContent}</div>
            <div className="stat-card-label">คอนเทนต์ทั้งหมด</div>
          </div>

          <div className="stat-card viral">
            <div className="stat-card-header">
              <div className="stat-card-icon viral">👁️</div>
            </div>
            <div className="stat-card-value">{animatedStats.pendingReview}</div>
            <div className="stat-card-label">รอรีวิว</div>
          </div>

          <div className="stat-card success">
            <div className="stat-card-header">
              <div className="stat-card-icon success">📤</div>
              <div className="stat-card-change up">↑ 25%</div>
            </div>
            <div className="stat-card-value">{animatedStats.publishedToday}</div>
            <div className="stat-card-label">เผยแพร่วันนี้</div>
          </div>

          <div className="stat-card warning">
            <div className="stat-card-header">
              <div className="stat-card-icon warning">🔥</div>
              <div className="stat-card-change up">↑ 0.3</div>
            </div>
            <div className="stat-card-value">{animatedStats.avgViralScore}</div>
            <div className="stat-card-label">คะแนนไวรัลเฉลี่ย</div>
          </div>
        </div>

        {/* Pipeline Overview */}
        <div className="card slide-up" style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            ⚡ Pipeline ปัจจุบัน
          </h3>
          <div className="pipeline">
            {pipelineSteps.map((step, i) => (
              <span key={i} style={{ display: 'contents' }}>
                <div className={`pipeline-step ${step.status}`}>
                  {step.label}
                  {step.count > 0 && (
                    <span style={{
                      background: step.status === 'active' ? 'var(--accent)' : step.status === 'done' ? 'var(--success)' : 'var(--border)',
                      color: 'white',
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 8,
                    }}>
                      {step.count}
                    </span>
                  )}
                </div>
                {i < pipelineSteps.length - 1 && <span className="pipeline-arrow">→</span>}
              </span>
            ))}
          </div>
        </div>

        {/* Recent Content */}
        <div className="card slide-up">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              📰 คอนเทนต์ล่าสุด
            </h3>
            <Link href="/content" className="btn btn-ghost btn-sm">ดูทั้งหมด →</Link>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>หัวข้อ</th>
                <th>โทน</th>
                <th>ไวรัล</th>
                <th>สถานะ</th>
                <th>เวลา</th>
              </tr>
            </thead>
            <tbody>
              {mockRecentContent.map((item) => (
                <tr key={item.id} style={{ cursor: 'pointer' }}>
                  <td style={{ maxWidth: 360 }}>
                    <Link href={`/content/${item.id}`} style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 500 }}>
                      {item.title}
                    </Link>
                  </td>
                  <td>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {getToneLabel(item.tone)}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className={`score-badge ${getViralClass(item.viralScore)}`}>
                        {item.viralScore}%
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={`status-badge ${item.status}`}>
                      {item.status === 'review' ? 'รอรีวิว' :
                       item.status === 'generating' ? 'กำลังสร้าง' :
                       item.status === 'approved' ? 'อนุมัติ' :
                       item.status === 'published' ? 'เผยแพร่แล้ว' :
                       item.status}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {item.createdAt}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
