'use client';

import { useState, useEffect } from 'react';
import Header from '@/components/layout/Header';

export default function SettingsPage() {
  const [keys, setKeys] = useState({ openai: false, firecrawl: false, openaiModel: 'gpt-4o' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(d => {
      if (d.success) setKeys(d.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const apiItems = [
    {
      name: 'OpenAI API Key',
      key: 'OPENAI_API_KEY',
      active: keys.openai,
      desc: 'ใช้สำหรับ AI วิเคราะห์ข่าว, สร้างบทความ, สรุปเนื้อหา',
      link: 'https://platform.openai.com/api-keys',
      required: true,
    },
    {
      name: 'Firecrawl API Key',
      key: 'FIRECRAWL_API_KEY',
      active: keys.firecrawl,
      desc: 'ใช้สำหรับดึงเนื้อข่าวจากเว็บที่มี Cloudflare (ฟรี 500 req/เดือน)',
      link: 'https://firecrawl.dev',
      required: true,
    },
  ];

  return (
    <>
      <Header title="⚙️ ตั้งค่า" subtitle="จัดการ API Keys และการตั้งค่าระบบ" />
      <div className="page-content">

        {/* API Keys Status */}
        <div className="card slide-up">
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>🔑 สถานะ API Keys</h3>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>กำลังโหลด...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {apiItems.map((item) => (
                <div key={item.key} style={{
                  background: 'var(--bg-primary)', borderRadius: 'var(--radius-md)', padding: 20,
                  border: `1px solid ${item.active ? 'var(--success)' : 'var(--danger)'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{item.name}</div>
                    <span style={{
                      fontSize: 11, padding: '3px 10px', borderRadius: 12,
                      background: item.active ? 'var(--success-bg)' : 'var(--danger-bg)',
                      color: item.active ? 'var(--success)' : 'var(--danger)',
                      fontWeight: 600,
                    }}>
                      {item.active ? '✅ เชื่อมต่อแล้ว' : '❌ ยังไม่ได้ตั้งค่า'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{item.desc}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    ENV: <code style={{ color: 'var(--accent-light)', fontSize: 11 }}>{item.key}</code>
                    {item.required && <span style={{ color: 'var(--warning)', marginLeft: 8 }}>จำเป็น</span>}
                  </div>
                  {!item.active && (
                    <a href={item.link} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'inline-block', marginTop: 10, fontSize: 12, color: 'var(--accent-light)', textDecoration: 'underline' }}>
                      → สมัครรับ API Key ฟรี
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* วิธีตั้งค่า */}
        <div className="card slide-up" style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>📋 วิธีเพิ่ม API Key</h3>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 2 }}>
            <div><strong>สำหรับ Vercel (Production):</strong></div>
            <div>1. ไปที่ <a href="https://vercel.com" target="_blank" style={{ color: 'var(--accent-light)' }}>Vercel Dashboard</a> → Project → Settings → Environment Variables</div>
            <div>2. เพิ่ม Key: <code>OPENAI_API_KEY</code> → Value: <code>sk-...</code></div>
            <div>3. เพิ่ม Key: <code>FIRECRAWL_API_KEY</code> → Value: <code>fc-...</code></div>
            <div>4. กด Save → Redeploy</div>
            <div style={{ marginTop: 16 }}><strong>สำหรับ Local Dev:</strong></div>
            <div>เพิ่มใน file <code>.env</code> ในโปรเจค:</div>
            <div style={{ background: 'var(--bg-tertiary)', padding: 12, borderRadius: 8, marginTop: 8, fontFamily: 'monospace', fontSize: 12 }}>
              OPENAI_API_KEY=sk-...<br/>
              FIRECRAWL_API_KEY=fc-...
            </div>
          </div>
        </div>

        {/* Model Settings */}
        <div className="card slide-up" style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>🤖 AI Model</h3>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Model ปัจจุบัน: <strong style={{ color: 'var(--accent-light)' }}>{keys.openaiModel}</strong>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            เปลี่ยน model ได้โดยเพิ่ม env <code>OPENAI_MODEL</code> (เช่น gpt-4o-mini, gpt-4o, gpt-3.5-turbo)
          </div>
        </div>
      </div>
    </>
  );
}
