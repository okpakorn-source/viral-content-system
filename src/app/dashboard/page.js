'use client';

import { useState, useEffect } from 'react';
import Header from '@/components/layout/Header';
import Link from 'next/link';

/**
 * แดชบอร์ด — ข้อมูลจริงทั้งหมด
 * ★ Rewrite 10 มิ.ย. 2026: เดิมหน้านี้เป็น mock hardcode 100% (ตัวเลขปลอม + ข่าวปลอม 5 รายการ)
 * ตอนนี้ดึงจริงจาก: news-archive (คลังข่าว), review (รอตรวจ), queue (งานที่กำลังวิ่ง), analytics (ค่าใช้จ่าย)
 */

function timeAgo(iso) {
  if (!iso) return '-';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'เมื่อสักครู่';
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ชั่วโมงที่แล้ว`;
  return `${Math.floor(h / 24)} วันที่แล้ว`;
}

function getViralClass(score) {
  if (score >= 8) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
}

export default function DashboardPage() {
  const [stats, setStats] = useState({ totalArchive: null, pendingReview: null, archivedToday: null, costToday: null });
  const [queueInfo, setQueueInfo] = useState(null); // { pending, processing, busy }
  const [recentNews, setRecentNews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // ดึงพร้อมกันทุกแหล่ง — แหล่งไหนพังไม่ดึงทั้งหน้าล่ม
      const [archiveRes, reviewRes, queueRes, costRes] = await Promise.allSettled([
        fetch('/api/news-archive?limit=8').then(r => r.json()),
        fetch('/api/review').then(r => r.json()),
        fetch('/api/queue/status', { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/analytics/cost').then(r => r.json()),
      ]);
      if (cancelled) return;

      const archive = archiveRes.status === 'fulfilled' && archiveRes.value?.success ? archiveRes.value.data : null;
      const review = reviewRes.status === 'fulfilled' && reviewRes.value?.success ? reviewRes.value : null;
      const queue = queueRes.status === 'fulfilled' && queueRes.value?.success ? queueRes.value : null;
      const cost = costRes.status === 'fulfilled' && costRes.value?.success ? costRes.value : null;

      const items = archive?.items || [];
      const today = new Date().toISOString().slice(0, 10);
      const archivedToday = items.filter(it => (it.archived_at || it.createdAt || '').startsWith(today)).length;

      // cost API: { data: { dailyStats: [{date, totalCost}] } } — admin เท่านั้น (403 = แสดง —)
      const costToday = cost?.data?.dailyStats?.find(d => d.date === today)?.totalCost ?? null;

      setStats({
        totalArchive: archive?.total ?? null,
        pendingReview: review?.stats?.pending ?? null,
        archivedToday,
        costToday,
      });
      setQueueInfo(queue);
      setRecentNews(items.slice(0, 6));
      setLoading(false);
    }

    load();
    // refresh คิวทุก 15 วินาที (เฉพาะส่วนที่เปลี่ยนเร็ว)
    const t = setInterval(() => {
      fetch('/api/queue/status', { cache: 'no-store' })
        .then(r => r.json())
        .then(q => { if (!cancelled && q?.success !== false) setQueueInfo(q); })
        .catch(() => {});
    }, 15000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const statVal = (v, suffix = '') => v === null || v === undefined ? '—' : `${v}${suffix}`;

  return (
    <>
      <Header title="แดชบอร์ด" subtitle="ภาพรวมระบบผลิตคอนเทนต์ AI (ข้อมูลจริง)">
        <a href="/company/" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>
          🏢 บริษัท AI
        </a>
        <Link href="/content/new" className="btn btn-viral btn-sm">
          ✨ สร้างคอนเทนต์ใหม่
        </Link>
      </Header>

      <div className="page-content">
        {/* Stats Cards — ข้อมูลจริง */}
        <div className="stats-grid fade-in">
          <Link href="/news-archive" style={{ textDecoration: 'none' }}>
            <div className="stat-card accent" style={{ cursor: 'pointer' }}>
              <div className="stat-card-header">
                <div className="stat-card-icon accent">📦</div>
              </div>
              <div className="stat-card-value">{statVal(stats.totalArchive)}</div>
              <div className="stat-card-label">ข่าวในคลังทั้งหมด</div>
            </div>
          </Link>

          <Link href="/review" style={{ textDecoration: 'none' }}>
            <div className="stat-card viral" style={{ cursor: 'pointer' }}>
              <div className="stat-card-header">
                <div className="stat-card-icon viral">📋</div>
              </div>
              <div className="stat-card-value">{statVal(stats.pendingReview)}</div>
              <div className="stat-card-label">รอตรวจ</div>
            </div>
          </Link>

          <div className="stat-card success">
            <div className="stat-card-header">
              <div className="stat-card-icon success">🆕</div>
            </div>
            <div className="stat-card-value">{statVal(stats.archivedToday)}</div>
            <div className="stat-card-label">เข้าคลังวันนี้</div>
          </div>

          <Link href="/analytics" style={{ textDecoration: 'none' }}>
            <div className="stat-card warning" style={{ cursor: 'pointer' }}>
              <div className="stat-card-header">
                <div className="stat-card-icon warning">💰</div>
              </div>
              <div className="stat-card-value">{stats.costToday === null ? '—' : `$${Number(stats.costToday).toFixed(2)}`}</div>
              <div className="stat-card-label">ค่า AI วันนี้</div>
            </div>
          </Link>
        </div>

        {/* Queue สถานะจริง */}
        <div className="card slide-up" style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            ⚡ คิวประมวลผลตอนนี้
            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>(อัปเดตทุก 15 วิ)</span>
          </h3>
          {!queueInfo ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>กำลังโหลด...</div>
          ) : (
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: queueInfo.busy ? '#f59e0b' : '#10b981', display: 'inline-block' }} />
                <span style={{ fontWeight: 700, fontSize: 14 }}>
                  {queueInfo.busy ? 'กำลังประมวลผล' : 'ระบบว่าง พร้อมรับงาน'}
                </span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                กำลังทำ: <strong>{queueInfo.processing ?? 0}</strong>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                รอคิว: <strong>{queueInfo.pending ?? 0}</strong>
              </div>
              {(queueInfo.total ?? 0) > 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  ⏱️ ประมาณ {queueInfo.estimatedWaitMinutes ?? '?'} นาที
                </div>
              )}
            </div>
          )}
        </div>

        {/* ข่าวล่าสุดจากคลังจริง */}
        <div className="card slide-up">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              📰 ข่าวล่าสุดในคลัง
            </h3>
            <Link href="/news-archive" className="btn btn-ghost btn-sm">ดูทั้งหมด →</Link>
          </div>

          {loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 20, textAlign: 'center' }}>กำลังโหลด...</div>
          ) : recentNews.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📭</div>
              <div className="empty-state-title">ยังไม่มีข่าวในคลัง</div>
              <div className="empty-state-text">สร้างข่าวแรกได้ที่ "สร้างคอนเทนต์ใหม่"</div>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>หัวข้อ</th>
                  <th>หมวด</th>
                  <th>ไวรัล</th>
                  <th>โดย</th>
                  <th>เวลา</th>
                </tr>
              </thead>
              <tbody>
                {recentNews.map((item) => (
                  <tr key={item.id || item._id}>
                    <td style={{ maxWidth: 360 }}>
                      <Link href={`/news-archive?search=${encodeURIComponent((item.title || '').slice(0, 30))}`} style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 500 }}>
                        {(item.title || 'ไม่มีหัวข้อ').slice(0, 70)}
                      </Link>
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.category || '-'}</span>
                    </td>
                    <td>
                      {item.viral_score ? (
                        <span className={`score-badge ${getViralClass(item.viral_score)}`}>{item.viral_score}</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>-</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {item.archived_by || '-'}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {timeAgo(item.archived_at || item.createdAt)}
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
