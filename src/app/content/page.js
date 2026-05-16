'use client';

import { useState, useEffect } from 'react';
import Header from '@/components/layout/Header';
import Link from 'next/link';

const statusMap = {
  pending: 'รอดำเนินการ',
  analyzing: 'กำลังวิเคราะห์',
  scored: 'วิเคราะห์แล้ว',
  generating: 'กำลังสร้าง',
  review: 'รอรีวิว',
  approved: 'อนุมัติ',
  published: 'เผยแพร่แล้ว',
  rejected: 'ปฏิเสธ',
};

export default function ContentListPage() {
  const [contents, setContents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    fetchContents();
  }, [filter]);

  const fetchContents = async () => {
    setLoading(true);
    try {
      const url = filter ? `/api/content?status=${filter}` : '/api/content';
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) setContents(data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getViralClass = (score) => {
    if (score >= 70) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
  };

  return (
    <>
      <Header title="📰 คอนเทนต์ทั้งหมด" subtitle={`ทั้งหมด ${contents.length} รายการ`}>
        <Link href="/content/new" className="btn btn-viral btn-sm">✨ สร้างใหม่</Link>
      </Header>

      <div className="page-content">
        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {['', 'pending', 'scored', 'generating', 'review', 'approved', 'published', 'rejected'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-outline'}`}
            >
              {f ? statusMap[f] : 'ทั้งหมด'}
            </button>
          ))}
        </div>

        {/* Content Table */}
        <div className="card">
          {loading ? (
            <div className="empty-state">
              <div className="spinner" />
              <div className="loading-text" style={{ marginTop: 16 }}>กำลังโหลด...</div>
            </div>
          ) : contents.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📭</div>
              <div className="empty-state-title">ยังไม่มีคอนเทนต์</div>
              <div className="empty-state-text">เริ่มสร้างคอนเทนต์ใหม่ด้วย AI เพื่อเริ่มต้นระบบ</div>
              <Link href="/content/new" className="btn btn-viral">✨ สร้างคอนเทนต์ใหม่</Link>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>หัวข้อ</th>
                  <th>แหล่ง</th>
                  <th>ไวรัล</th>
                  <th>สถานะ</th>
                  <th>เวลา</th>
                </tr>
              </thead>
              <tbody>
                {contents.map((item) => (
                  <tr key={item.id}>
                    <td style={{ maxWidth: 400 }}>
                      <Link href={`/content/${item.id}`} style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 500, fontSize: 13 }}>
                        {item.title || item.originalText?.substring(0, 80) + '...'}
                      </Link>
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {item.source?.type === 'url' ? '🔗' : '📝'} {item.source?.type || '-'}
                      </span>
                    </td>
                    <td>
                      {item.viralProbability != null ? (
                        <span className={`score-badge ${getViralClass(item.viralProbability)}`}>
                          {Math.round(item.viralProbability)}%
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <span className={`status-badge ${item.status}`}>
                        {statusMap[item.status] || item.status}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(item.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
