'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export default function ChatAdminPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState('');
  const [rooms, setRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [activeTab, setActiveTab] = useState('rooms'); // rooms, rules, library, users
  const [stats, setStats] = useState({ total: 0, passed: 0, failed: 0, pending: 0 });

  // Auth
  useEffect(() => {
    const savedToken = localStorage.getItem('chat_token');
    const savedUser = localStorage.getItem('chat_user');
    if (!savedToken || !savedUser) { router.push('/chat/login'); return; }
    try {
      const u = JSON.parse(savedUser);
      if (u.role !== 'manager' && u.role !== 'admin') { router.push('/chat/login'); return; }
      setUser(u);
      setToken(savedToken);
    } catch { router.push('/chat/login'); }
  }, [router]);

  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token]);

  // Load rooms
  useEffect(() => {
    if (!token) return;
    const loadRooms = async () => {
      try {
        const res = await fetch('/api/chat/rooms', { headers: authHeaders() });
        const data = await res.json();
        if (data.success) setRooms(data.rooms || []);
      } catch {}
    };
    loadRooms();
    const interval = setInterval(loadRooms, 10000);
    return () => clearInterval(interval);
  }, [token, authHeaders]);

  // Load messages for selected room
  useEffect(() => {
    if (!token || !selectedRoom) return;
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/chat/messages?roomId=${selectedRoom.id}&limit=100`, { headers: authHeaders() });
        const data = await res.json();
        if (data.success && active) setMessages(data.messages || []);
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => { active = false; clearInterval(interval); };
  }, [token, selectedRoom, authHeaders]);

  // Send reply as manager
  const handleReply = async () => {
    if (!replyText.trim() || !selectedRoom || sending) return;
    setSending(true);
    try {
      await fetch('/api/chat/messages', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          roomId: selectedRoom.id,
          content: replyText.trim(),
          messageType: 'text',
        }),
      });
      setReplyText('');
    } catch {}
    setSending(false);
  };

  // Logout
  const handleLogout = () => {
    localStorage.removeItem('chat_token');
    localStorage.removeItem('chat_user');
    router.push('/chat/login');
  };

  // Room status indicator
  const getRoomStatus = (room) => {
    // Check latest message for review status
    return 'green'; // TODO: calculate from messages
  };

  if (!user) return null;

  return (
    <div className="chat-admin">
      {/* Sidebar */}
      <div className="chat-sidebar">
        <div className="chat-sidebar-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14 }}>📊 Admin Dashboard</div>
            <div style={{ fontSize: 11, color: 'var(--chat-text-muted)', fontWeight: 400, marginTop: 2 }}>
              👑 {user.displayName}
            </div>
          </div>
          <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: 'var(--chat-text-muted)', cursor: 'pointer', fontSize: 12 }}>
            ออก
          </button>
        </div>

        {/* Nav tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--chat-glass-border)' }}>
          {[
            { id: 'rooms', icon: '💬', label: 'ห้อง' },
            { id: 'rules', icon: '🔒', label: 'กฎ' },
            { id: 'library', icon: '📚', label: 'Library' },
            { id: 'users', icon: '👥', label: 'สมาชิก' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1, padding: '10px 4px', border: 'none', cursor: 'pointer',
                background: activeTab === tab.id ? 'rgba(99,102,241,0.1)' : 'transparent',
                color: activeTab === tab.id ? 'var(--chat-accent-light)' : 'var(--chat-text-muted)',
                fontSize: 11, fontWeight: 600, borderBottom: activeTab === tab.id ? '2px solid var(--chat-accent)' : '2px solid transparent',
                transition: 'var(--chat-transition)',
              }}
            >
              <div style={{ fontSize: 16 }}>{tab.icon}</div>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Room list */}
        {activeTab === 'rooms' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {rooms.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--chat-text-muted)', fontSize: 12 }}>
                ยังไม่มีห้องแชท
              </div>
            ) : rooms.map(room => (
              <div
                key={room.id}
                className={`chat-room-item ${selectedRoom?.id === room.id ? 'active' : ''}`}
                onClick={() => setSelectedRoom(room)}
              >
                <div className={`chat-room-status ${getRoomStatus(room)}`} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {room.room_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--chat-text-muted)' }}>
                    {room.employee_name || room.room_slug}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Rules tab */}
        {activeTab === 'rules' && (
          <div style={{ flex: 1, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>🔒 กฎเหล็ก</div>
            <div style={{ fontSize: 12, color: 'var(--chat-text-muted)', lineHeight: 1.8 }}>
              <div>🔴 คำต้องห้าม (ตาย, ฆ่า, ข่มขืน...)</div>
              <div>🟡 คำระวัง (แอลกอฮอล์, ยาเสพติด...)</div>
              <div>🟢 คำเปลือง (ทั้งนี้, อย่างไรก็ตาม...)</div>
              <div style={{ marginTop: 12, fontSize: 11, color: 'var(--chat-text-dim)' }}>
                จัดการกฎเพิ่มเติมที่หน้า Rules Management
              </div>
            </div>
          </div>
        )}

        {/* Library tab */}
        {activeTab === 'library' && (
          <div style={{ flex: 1, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>📚 Viral Library</div>
            <div style={{ fontSize: 12, color: 'var(--chat-text-muted)' }}>
              อัปโหลดตัวอย่างคอนเทนต์ไวรัลเพื่อสอน AI
            </div>
          </div>
        )}

        {/* Users tab */}
        {activeTab === 'users' && (
          <div style={{ flex: 1, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>👥 สมาชิก</div>
            <div style={{ fontSize: 12, color: 'var(--chat-text-muted)' }}>
              จัดการพนักงานและสิทธิ์การเข้าถึง
            </div>
          </div>
        )}
      </div>

      {/* Main content area */}
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        {selectedRoom ? (
          <>
            {/* Room header */}
            <div className="chat-header">
              <div style={{ fontSize: 14, fontWeight: 700 }}>💬 {selectedRoom.room_name}</div>
              <div style={{ fontSize: 11, color: 'var(--chat-text-muted)' }}>
                {selectedRoom.employee_name || selectedRoom.room_slug}
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--chat-text-muted)' }}>
                  {messages.length} ข้อความ
                </span>
              </div>
            </div>

            {/* Messages */}
            <div className="chat-messages" style={{ flex: 1 }}>
              {messages.map(msg => {
                const isAI = msg.sender_type === 'ai';
                const isManager = msg.sender_type === 'manager';
                const isEmployee = msg.sender_type === 'employee';
                const avatar = isAI ? '🤖' : isManager ? '👑' : '👤';
                const bgClass = isAI ? 'chat-msg-ai' : isManager ? 'chat-msg-manager' : 'chat-msg-employee';
                const time = new Date(msg.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

                return (
                  <div key={msg.id} className={`chat-msg ${bgClass}`}>
                    <div className={`chat-msg-avatar chat-msg-avatar-${isAI ? 'ai' : isManager ? 'manager' : 'employee'}`}>
                      {avatar}
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--chat-text-muted)', marginBottom: 2 }}>
                        {isAI ? 'AI Reviewer' : isManager ? (msg.sender_name || 'ผู้จัดการ') : (msg.sender_name || 'พนักงาน')}
                        <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 6, color: 'var(--chat-text-dim)' }}>{time}</span>
                      </div>
                      {msg.message_type !== 'text' && msg.message_type !== 'ai_review' && (
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--chat-accent-light)', marginBottom: 3 }}>
                          {msg.message_type === 'news_submit' ? '📰 ส่งข่าวตรวจ' :
                           msg.message_type === 'caption_submit' ? '✍️ ส่งแคปชั่นตรวจ' :
                           msg.message_type === 'image_submit' ? '🖼️ ส่งภาพปกตรวจ' : ''}
                        </div>
                      )}
                      <div className="chat-msg-bubble">{msg.content}</div>
                      {msg.review_result && (
                        <div style={{
                          marginTop: 6, padding: '8px 10px', borderRadius: 8, fontSize: 12,
                          background: msg.review_result.verdict === 'pass' ? 'rgba(16,185,129,0.1)' : 
                                     msg.review_result.verdict === 'fail' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                          border: `1px solid ${msg.review_result.verdict === 'pass' ? 'rgba(16,185,129,0.2)' : 
                                   msg.review_result.verdict === 'fail' ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)'}`,
                        }}>
                          {msg.review_result.verdict === 'pass' ? '✅' : msg.review_result.verdict === 'fail' ? '❌' : '⚠️'} 
                          {' '}Score: {msg.review_result.score || msg.review_result.viralScore || '-'}/100
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Manager reply */}
            <div className="chat-input-area">
              <div className="chat-compose">
                <textarea
                  placeholder="ตอบในฐานะผู้จัดการ..."
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
                  rows={1}
                />
                <button className="chat-send-btn" onClick={handleReply} disabled={!replyText.trim() || sending}>
                  {sending ? '⏳' : '➤'}
                </button>
              </div>
            </div>
          </>
        ) : (
          /* No room selected */
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', color: 'var(--chat-text-muted)' }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>📊</div>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Admin Dashboard</div>
              <div style={{ fontSize: 13 }}>เลือกห้องแชทจากด้านซ้ายเพื่อดูการสนทนา</div>
              <div style={{ marginTop: 24, display: 'flex', gap: 16, justifyContent: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--chat-accent-light)' }}>{rooms.length}</div>
                  <div style={{ fontSize: 11 }}>ห้องทั้งหมด</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
