'use client';
import Header from '@/components/layout/Header';
export default function SettingsPage() {
  return (
    <>
      <Header title="⚙️ ตั้งค่าระบบ" subtitle="จัดการการตั้งค่า API Keys และระบบ" />
      <div className="page-content">
        <div className="card" style={{ maxWidth: 640 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 24 }}>🔑 API Keys</h3>
          <div className="form-group">
            <label className="form-label">OpenAI API Key</label>
            <input type="password" className="form-input" placeholder="sk-..." defaultValue="" />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>ใช้สำหรับ GPT-4o ในการวิเคราะห์และสร้างคอนเทนต์</div>
          </div>
          <div className="form-group">
            <label className="form-label">Facebook Page Access Token</label>
            <input type="password" className="form-input" placeholder="EAA..." defaultValue="" />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>ใช้สำหรับเผยแพร่คอนเทนต์อัตโนมัติไปยัง Facebook Page</div>
          </div>
          <div className="form-group">
            <label className="form-label">Facebook Page ID</label>
            <input type="text" className="form-input" placeholder="1234567890" defaultValue="" />
          </div>
          <button className="btn btn-primary">💾 บันทึก</button>
        </div>

        <div className="card" style={{ maxWidth: 640, marginTop: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 24 }}>🤖 AI Settings</h3>
          <div className="form-group">
            <label className="form-label">AI Model</label>
            <select className="form-select" defaultValue="gpt-4o">
              <option value="gpt-4o">GPT-4o (แนะนำ)</option>
              <option value="gpt-4o-mini">GPT-4o Mini (ประหยัด)</option>
              <option value="gpt-4-turbo">GPT-4 Turbo</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">คะแนนคุณภาพขั้นต่ำ (Quality Gate)</label>
            <input type="number" className="form-input" defaultValue="70" min="0" max="100" />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>บทความที่ได้คะแนนต่ำกว่านี้จะถูก regenerate อัตโนมัติ</div>
          </div>
          <button className="btn btn-primary">💾 บันทึก</button>
        </div>
      </div>
    </>
  );
}
