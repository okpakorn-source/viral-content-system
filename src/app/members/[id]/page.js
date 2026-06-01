'use client';
import Header from '@/components/layout/Header';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

const STATUS_COLORS = {
  pending: { bg: 'rgba(251,191,36,0.15)', color: '#fbbf24', label: 'รอตรวจ' },
  approved: { bg: 'rgba(34,197,94,0.15)', color: '#22c55e', label: 'อนุมัติ' },
  rejected: { bg: 'rgba(239,68,68,0.15)', color: '#ef4444', label: 'ไม่ผ่าน' },
  revision: { bg: 'rgba(59,130,246,0.15)', color: '#3b82f6', label: 'แก้ไข' },
};

export default function MemberProfilePage() {
  const params = useParams();
  const memberId = params.id;
  const [member, setMember] = useState(null);
  const [works, setWorks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/members').then(r => r.json()),
      fetch(`/api/review?member=${memberId}`).then(r => r.json()),
    ]).then(([membersData, reviewData]) => {
      if (membersData.success) {
        const m = membersData.members.find(m => m.id === memberId);
        setMember(m);
      }
      if (reviewData.success) {
        setWorks(reviewData.reviews || []);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [memberId]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>กำลังโหลด...</div>;
  if (!member) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>ไม่พบสมาชิก</div>;

  const stats = member.stats || {};

  return (
    <div>
      <Header title={`${member.avatar} ${member.displayName}`} subtitle={`@${member.username} • ${member.role === 'admin' ? '👑 Admin' : member.role === 'editor' ? '✏️ Editor' : '👁️ Viewer'}`} />
      <div style={{ padding: '0 24px 24px', maxWidth: 1000, margin: '0 auto' }}>

        {/* Stats Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'สร้างทั้งหมด', value: stats.totalCreated || 0, color: '#8b5cf6' },
            { label: 'อนุมัติ', value: stats.totalApproved || 0, color: '#22c55e' },
            { label: 'ไม่ผ่าน', value: stats.totalRejected || 0, color: '#ef4444' },
            { label: 'รอแก้ไข', value: stats.totalRevision || 0, color: '#3b82f6' },
          ].map((s, i) => (
            <div key={i} style={{ background: `${s.color}10`, border: `1px solid ${s.color}30`, borderRadius: 12, padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Info */}
        <div className="card" style={{ marginBottom: 20, padding: 16 }}>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
            <span>📅 เข้าร่วม: {new Date(member.createdAt).toLocaleDateString('th-TH')}</span>
            <span>🕐 เข้าใช้ล่าสุด: {member.lastLogin ? new Date(member.lastLogin).toLocaleString('th-TH') : 'ยังไม่เคย'}</span>
            <span>📊 อัตราผ่าน: {stats.totalCreated > 0 ? Math.round((stats.totalApproved / stats.totalCreated) * 100) : 0}%</span>
          </div>
        </div>

        {/* Work History */}
        <h3 style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>📋 ผลงานทั้งหมด ({works.length})</h3>
        {works.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>ยังไม่มีผลงาน</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {works.map(w => {
              const st = STATUS_COLORS[w.status] || STATUS_COLORS.pending;
              return (
                <div key={w.id} className="card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 150 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                        {w.title || 'ไม่มีหัวข้อ'}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                        {w.presetLabel || w.preset || '-'} • {w.wordCount || 0} คำ • {new Date(w.createdAt).toLocaleString('th-TH')}
                      </div>
                    </div>
                    <span style={{ padding: '3px 10px', borderRadius: 10, fontSize: 10, fontWeight: 700, background: st.bg, color: st.color }}>
                      {st.label}
                    </span>
                  </div>
                  {w.note && (
                    <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.03)', fontSize: 11, color: 'var(--text-muted)', borderLeft: '3px solid var(--border)' }}>
                      💬 {w.note}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
