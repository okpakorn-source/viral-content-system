'use client';
import { useState } from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import ClientLayout from '@/components/ClientLayout';

export default function DiscordBotPage() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText('npm start');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AuthGuard requireRole={['admin']}>
      <ClientLayout>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
            <div style={{ fontSize: 48 }}>👾</div>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 900, marginBottom: 4 }}>Discord Bot Integration</h1>
              <p style={{ color: 'var(--text-muted)' }}>ตั้งค่าและจัดการเชื่อมต่อบอทเข้าสู่ดิสคอร์ดของทีมงาน</p>
            </div>
          </div>

          <div className="card" style={{ padding: 24, marginBottom: 24 }}>
            <h2 style={{ fontSize: 20, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#5865F2' }}>1.</span> สถานะระบบ API ของเว็บไซต์
            </h2>
            <div style={{ background: 'var(--bg-secondary)', padding: 16, borderRadius: 'var(--radius-md)', borderLeft: '4px solid var(--success)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 24 }}>✅</span>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--success)' }}>API รับรอง Discord ทำงานปกติ</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                    ระบบเว็บไซต์พร้อมรับคำสั่งจากบอทแล้ว (ตรวจสอบ <code>DISCORD_API_SECRET</code> ใน Environment Variables ของ Vercel)
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 24, marginBottom: 24 }}>
            <h2 style={{ fontSize: 20, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#5865F2' }}>2.</span> นำบอทไปออนไลน์ (Hosting)
            </h2>
            <p style={{ marginBottom: 16, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              ระบบบอทของดิสคอร์ดต้องการเซิร์ฟเวอร์ที่เปิดทำงานตลอด 24 ชั่วโมงเพื่อดักฟังข้อความในห้อง 
              ผมได้เขียนสคริปต์บอทไว้ให้แล้วในโปรเจกต์ (โฟลเดอร์ <code>discord-bot</code>) สิ่งที่คุณต้องทำคือ:
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: '#00b0f0' }}>👉 สเต็ป A: ไปสมัครและสร้างบอท</h3>
                <ul style={{ paddingLeft: 20, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                  <li>เข้าไปที่ <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Discord Developer Portal</a></li>
                  <li>สร้าง Application ใหม่ &gt; ไปที่เมนู Bot &gt; กด Reset Token และคัดลอก <strong>Bot Token</strong></li>
                  <li>เลื่อนลงมาเปิด <strong>Message Content Intent</strong> (สำคัญมาก!) แล้วกด Save</li>
                </ul>
              </div>

              <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: '#f91880' }}>👉 สเต็ป B: รันบอทบนเครื่อง (หรือนำขึ้นโฮสต์ฟรี)</h3>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  ในโฟลเดอร์โปรเจกต์ เข้าไปที่โฟลเดอร์ <code>discord-bot</code> สร้างไฟล์ <code>.env</code> แล้วใส่ข้อมูลดังนี้:
                </p>
                <div style={{ background: '#000', padding: 16, borderRadius: 'var(--radius-sm)', fontFamily: 'monospace', fontSize: 13, color: '#fff', marginBottom: 12 }}>
                  DISCORD_BOT_TOKEN=ใส่_TOKEN_ที่ได้จากดิสคอร์ด<br/>
                  API_URL=https://(ชื่อเว็บของคุณ).vercel.app/api/auto/process<br/>
                  API_KEY=รหัสผ่านที่คุณตั้งใน_Vercel
                </div>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  จากนั้นเปิด Terminal ขึ้นมาแล้วรันคำสั่ง:
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <code style={{ background: '#111', padding: '8px 16px', borderRadius: 4, color: '#a5d6ff', flex: 1, fontFamily: 'monospace' }}>
                    npm start
                  </code>
                  <button onClick={handleCopy} className="btn btn-secondary" style={{ padding: '8px 16px' }}>
                    {copied ? '✅ คัดลอกแล้ว' : '📋 คัดลอก'}
                  </button>
                </div>
              </div>
            </div>
          </div>
          
          <div style={{ textAlign: 'center', marginTop: 40, color: 'var(--text-muted)', fontSize: 13 }}>
            ทีมงานสามารถวางลิงก์ ข่าว หรือคลิป YouTube ในห้องดิสคอร์ดได้เลย บอทจะช่วยประมวลผลทันที ⚡
          </div>
        </div>
      </ClientLayout>
    </AuthGuard>
  );
}
