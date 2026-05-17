'use client';
import Header from '@/components/layout/Header';
import Link from 'next/link';
import { useState, useEffect } from 'react';

const AVATARS = ['👑', '👤', '🧑‍💻', '👩‍💼', '🧑‍🎨', '🦊', '🐯', '🐻', '🦁', '🐸', '🎯', '⚡'];
const ROLES = [
  { id: 'admin', label: '👑 Admin', desc: 'จัดการทุกอย่าง', color: '#f91880' },
  { id: 'editor', label: '✏️ Editor', desc: 'สร้าง + ส่งคอนเทนต์', color: '#22c55e' },
  { id: 'viewer', label: '👁️ Viewer', desc: 'ดูอย่างเดียว', color: '#3b82f6' },
];

export default function MembersPage() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', displayName: '', role: 'editor', avatar: '👤' });
  const [msg, setMsg] = useState('');

  const load = () => {
    fetch('/api/members').then(r => r.json()).then(d => {
      if (d.success) setMembers(d.members);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(load, []);

  const handleCreate = async () => {
    if (!form.username || !form.password) { setMsg('❌ กรอกข้อมูลให้ครบ'); return; }
    const res = await fetch('/api/members', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', ...form }),
    });
    const d = await res.json();
    if (d.success) { load(); setShowAdd(false); setForm({ username: '', password: '', displayName: '', role: 'editor', avatar: '👤' }); setMsg('✅ เพิ่มสมาชิกแล้ว'); }
    else setMsg('❌ ' + d.error);
    setTimeout(() => setMsg(''), 3000);
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`ลบสมาชิก "${name}"?`)) return;
    const res = await fetch('/api/members', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    });
    const d = await res.json();
    if (d.success) { load(); setMsg('✅ ลบแล้ว'); } else setMsg('❌ ' + d.error);
    setTimeout(() => setMsg(''), 3000);
  };

  const handleRoleChange = async (id, role) => {
    await fetch('/api/members', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', id, role }),
    });
    load();
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>กำลังโหลด...</div>;

  return (
    <div>
      <Header title="จัดการสมาชิก" subtitle={`ทั้งหมด ${members.length} คน`} />
      <div style={{ padding: '0 24px 24px', maxWidth: 1000, margin: '0 auto' }}>
        {msg && <div style={{ background: msg.includes('✅') ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13, color: msg.includes('✅') ? '#22c55e' : '#ef4444' }}>{msg}</div>}

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
          {ROLES.map(r => {
            const count = members.filter(m => m.role === r.id).length;
            return (
              <div key={r.id} style={{ background: `${r.color}10`, border: `1px solid ${r.color}30`, borderRadius: 12, padding: 16, textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 900, color: r.color }}>{count}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.label}</div>
              </div>
            );
          })}
        </div>

        {/* Add Button */}
        <button onClick={() => setShowAdd(!showAdd)} style={{
          padding: '10px 20px', borderRadius: 10, border: 'none', marginBottom: 20,
          background: 'linear-gradient(135deg, #f91880, #7c3aed)', color: '#fff',
          fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          ➕ เพิ่มสมาชิกใหม่
        </button>

        {/* Add Form */}
        {showAdd && (
          <div className="card" style={{ marginBottom: 20 }}>
            <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, marginTop: 0 }}>➕ เพิ่มสมาชิก</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
              <input className="form-input" placeholder="ชื่อผู้ใช้ (login)" value={form.username} onChange={e => setForm({...form, username: e.target.value})} />
              <input className="form-input" type="password" placeholder="รหัสผ่าน" value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
              <input className="form-input" placeholder="ชื่อแสดง" value={form.displayName} onChange={e => setForm({...form, displayName: e.target.value})} />
              <select className="form-input" value={form.role} onChange={e => setForm({...form, role: e.target.value})}>
                {ROLES.map(r => <option key={r.id} value={r.id}>{r.label} — {r.desc}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {AVATARS.map(a => (
                <button key={a} onClick={() => setForm({...form, avatar: a})}
                  style={{ width: 36, height: 36, borderRadius: 8, border: form.avatar === a ? '2px solid var(--accent)' : '1px solid var(--border)', background: form.avatar === a ? 'var(--accent-glow)' : 'var(--bg-secondary)', fontSize: 18, cursor: 'pointer' }}>
                  {a}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleCreate} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✅ สร้าง</button>
              <button onClick={() => setShowAdd(false)} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>ยกเลิก</button>
            </div>
          </div>
        )}

        {/* Members List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {members.map(m => {
            const roleObj = ROLES.find(r => r.id === m.role) || ROLES[1];
            return (
              <div key={m.id} className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: `${roleObj.color}15`, border: `1px solid ${roleObj.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
                    {m.avatar}
                  </div>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}><Link href={`/members/${m.id}`} style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>{m.displayName}</Link></div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>@{m.username}</div>
                  </div>
                  <select value={m.role} onChange={e => handleRoleChange(m.id, e.target.value)}
                    style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${roleObj.color}40`, background: `${roleObj.color}10`, color: roleObj.color, fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>
                    {ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                  <div style={{ textAlign: 'right', minWidth: 80 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>สร้าง {m.stats?.totalCreated || 0} | ผ่าน {m.stats?.totalApproved || 0}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                      {m.lastLogin ? `ล่าสุด ${new Date(m.lastLogin).toLocaleDateString('th-TH')}` : 'ยังไม่เคยเข้า'}
                    </div>
                  </div>
                  {m.role !== 'admin' && (
                    <button onClick={() => handleDelete(m.id, m.displayName)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>🗑️</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Permissions Table */}
        <div className="card" style={{ marginTop: 24 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, marginTop: 0, marginBottom: 12 }}>🔐 ตารางสิทธิ์</h4>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: 8, textAlign: 'left', color: 'var(--text-muted)' }}>สิทธิ์</th>
                  {ROLES.map(r => <th key={r.id} style={{ padding: 8, textAlign: 'center', color: r.color }}>{r.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {['สร้างคอนเทนต์', 'ส่งเข้าคลัง', 'ตรวจ/อนุมัติ', 'จัดการสมาชิก', 'จัดการ Prompts', 'ตั้งค่าระบบ'].map((perm, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: 8, color: 'var(--text-primary)' }}>{perm}</td>
                    <td style={{ padding: 8, textAlign: 'center' }}>✅</td>
                    <td style={{ padding: 8, textAlign: 'center' }}>{i < 2 ? '✅' : '❌'}</td>
                    <td style={{ padding: 8, textAlign: 'center' }}>❌</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
