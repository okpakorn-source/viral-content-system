'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';

export default function ChatRoomPage() {
  const router = useRouter();
  const params = useParams();
  const slug = params.slug;
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  // Auth state
  const [user, setUser] = useState(null);
  const [token, setToken] = useState('');

  // Chat state
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [messageType, setMessageType] = useState('text');
  const [sending, setSending] = useState(false);
  const [aiThinking, setAiThinking] = useState(false);
  const [roomInfo, setRoomInfo] = useState(null);

  // Auth check on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('chat_token');
    const savedUser = localStorage.getItem('chat_user');
    if (!savedToken || !savedUser) {
      router.push('/chat/login');
      return;
    }
    setToken(savedToken);
    try { setUser(JSON.parse(savedUser)); } catch { router.push('/chat/login'); }
  }, [router]);

  // Fetch headers
  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token]);

  // Load room info
  useEffect(() => {
    if (!token || !slug) return;
    fetch(`/api/chat/rooms?slug=${slug}`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => { if (d.success && d.room) setRoomInfo(d.room); })
      .catch(() => {});
  }, [token, slug, authHeaders]);

  // Poll messages
  useEffect(() => {
    if (!token || !roomInfo?.id) return;
    let active = true;

    const poll = async () => {
      try {
        const res = await fetch(`/api/chat/messages?roomId=${roomInfo.id}&limit=100`, { headers: authHeaders() });
        const data = await res.json();
        if (data.success && data.messages && active) {
          setMessages(data.messages);
        }
      } catch {}
    };

    poll(); // Initial
    const interval = setInterval(poll, 2000);
    return () => { active = false; clearInterval(interval); };
  }, [token, roomInfo?.id, authHeaders]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Send message
  const handleSend = async () => {
    if (!inputText.trim() || sending) return;
    setSending(true);

    try {
      const msgContent = inputText.trim();
      const body = {
        roomId: roomInfo.id,
        content: msgContent,
        messageType,
      };

      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.success) {
        setInputText('');
        const currentType = messageType;
        setMessageType('text');

        // AI ตอบทุกข้อความ
        setAiThinking(true);
        try {
          const reviewType = currentType === 'news_submit' ? 'news'
            : currentType === 'caption_submit' ? 'caption'
            : currentType === 'image_submit' ? 'image'
            : 'chat';

          await fetch('/api/chat/review', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
              roomId: roomInfo.id,
              type: reviewType,
              data: { content: msgContent, messageId: data.messageId },
            }),
          });
        } catch (aiErr) {
          console.error('AI review failed:', aiErr);
        }
        setAiThinking(false);
      }
    } catch (err) {
      console.error('Send failed:', err);
    } finally {
      setSending(false);
    }
  };

  // Handle key press
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Render message
  const renderMessage = (msg) => {
    const isEmployee = msg.sender_type === 'employee';
    const isAI = msg.sender_type === 'ai';
    const isManager = msg.sender_type === 'manager';
    const isSystem = msg.sender_type === 'system' || msg.message_type === 'system';

    const avatar = isAI ? '🤖' : isManager ? '👑' : isEmployee ? (user?.avatarEmoji || '👤') : '💬';
    const avatarClass = isAI ? 'chat-msg-avatar-ai' : isManager ? 'chat-msg-avatar-manager' : 'chat-msg-avatar-employee';
    const msgClass = isSystem ? 'chat-msg-system' : isAI ? 'chat-msg-ai' : isManager ? 'chat-msg-manager' : 'chat-msg-employee';

    const time = new Date(msg.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

    return (
      <div key={msg.id} className={`chat-msg ${msgClass}`}>
        {!isSystem && !isEmployee && (
          <div className={`chat-msg-avatar ${avatarClass}`}>{avatar}</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Sender name for non-employee */}
          {!isSystem && !isEmployee && (
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--chat-text-muted)', marginBottom: 2, marginLeft: 4 }}>
              {isAI ? 'AI Reviewer' : msg.sender_name || 'ผู้จัดการ'}
            </div>
          )}

          {/* Message type badge */}
          {msg.message_type && msg.message_type !== 'text' && msg.message_type !== 'system' && msg.message_type !== 'ai_review' && (
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--chat-accent-light)', marginBottom: 4, marginLeft: 4 }}>
              {msg.message_type === 'news_submit' ? '📰 ส่งข่าวตรวจ' :
               msg.message_type === 'caption_submit' ? '✍️ ส่งแคปชั่นตรวจ' :
               msg.message_type === 'image_submit' ? '🖼️ ส่งภาพปกตรวจ' : ''}
            </div>
          )}

          <div className="chat-msg-bubble">{msg.content}</div>

          {/* AI Review Result */}
          {msg.review_result && renderReviewCard(msg.review_result)}

          <div className="chat-msg-time">{time}</div>
        </div>
        {isEmployee && (
          <div className={`chat-msg-avatar ${avatarClass}`}>{avatar}</div>
        )}
      </div>
    );
  };

  // Render AI review card
  const renderReviewCard = (review) => {
    const verdict = review.verdict || 'needs_edit';
    const score = review.score || review.viralScore || 0;
    const scoreColor = score >= 70 ? '#10b981' : score >= 40 ? '#f59e0b' : '#ef4444';
    const verdictEmoji = verdict === 'pass' || verdict === 'worth_it' ? '✅' : verdict === 'fail' || verdict === 'skip' ? '❌' : '⚠️';
    const verdictText = verdict === 'pass' || verdict === 'worth_it' ? 'ผ่าน' : verdict === 'fail' || verdict === 'skip' ? 'ไม่ผ่าน' : 'ต้องแก้ไข';

    return (
      <div className={`chat-review-card chat-review-${verdict === 'worth_it' ? 'pass' : verdict}`}>
        {/* Header */}
        <div className="chat-review-header">
          <span style={{ fontSize: 20 }}>{verdictEmoji}</span>
          <span>{verdictText}</span>
          <span style={{ marginLeft: 'auto', fontSize: 13, color: scoreColor, fontWeight: 800 }}>{score}/100</span>
        </div>

        {/* Score bar */}
        <div className="chat-review-score">
          <div className="chat-review-score-fill" style={{ width: `${score}%`, background: scoreColor }} />
        </div>

        {/* Reasoning */}
        {review.reasoning && (
          <div style={{ fontSize: 13, marginBottom: 10, lineHeight: 1.6, color: 'var(--chat-text)' }}>
            {review.reasoning}
          </div>
        )}

        {/* Issues */}
        {review.issues && review.issues.length > 0 && (
          <ul className="chat-review-issues">
            {review.issues.map((issue, i) => (
              <li key={i}>
                <span style={{ color: '#f59e0b' }}>⚠️</span>
                <div>
                  <div style={{ fontWeight: 600 }}>{issue.text || issue.detail || issue.type}</div>
                  {issue.fix && <div style={{ color: 'var(--chat-text-muted)', fontSize: 12, marginTop: 2 }}>💡 {issue.fix}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Writing guide from viral examples */}
        {review.writingGuide && (
          <div className="chat-review-improved">
            <div className="chat-review-improved-label">📖 คำแนะนำจากคอนเทนต์ไวรัล</div>
            {review.writingGuide}
          </div>
        )}

        {/* Improved version */}
        {review.improvedVersion && (
          <div className="chat-review-improved" style={{ marginTop: 8 }}>
            <div className="chat-review-improved-label">✍️ แนะนำเขียนแบบนี้</div>
            {review.improvedVersion}
          </div>
        )}

        {/* Viral example reference */}
        {review.viralExampleRef && (
          <div style={{ fontSize: 11, color: 'var(--chat-text-muted)', marginTop: 8, fontStyle: 'italic' }}>
            {review.viralExampleRef}
          </div>
        )}
      </div>
    );
  };

  // Loading state
  if (!user) {
    return (
      <div className="chat-login-wrapper">
        <div style={{ textAlign: 'center', color: 'var(--chat-text-muted)' }}>
          <div className="chat-loading" style={{ fontSize: 32, marginBottom: 12 }}>🤖</div>
          <div>กำลังโหลด...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-room">
      {/* Header */}
      <div className="chat-header">
        <button 
          onClick={() => router.push(user.role === 'manager' || user.role === 'admin' ? '/chat/admin' : '/chat/login')}
          style={{ background: 'none', border: 'none', color: 'var(--chat-text-muted)', fontSize: 18, cursor: 'pointer', padding: 4 }}
        >
          ←
        </button>
        <div>
          <div className="chat-header-title">💬 {roomInfo?.room_name || slug}</div>
          <div style={{ fontSize: 11, color: 'var(--chat-text-muted)' }}>
            {roomInfo?.employee_name || 'กำลังโหลด...'}
          </div>
        </div>
        <div className="chat-header-members">
          <div className="chat-member-badge" style={{ background: 'rgba(16,185,129,0.2)' }} title="AI Reviewer">🤖</div>
          <div className="chat-member-badge" style={{ background: 'rgba(168,85,247,0.2)' }} title="ผู้จัดการ">👑</div>
          <div className="chat-member-badge" style={{ background: 'rgba(59,130,246,0.2)' }} title={user.displayName}>
            {user.avatarEmoji || '👤'}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--chat-text-muted)' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🤖</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>AI Reviewer พร้อมแล้ว!</div>
            <div style={{ fontSize: 12 }}>ส่งข่าว, แคปชั่น หรือภาพปก มาให้ตรวจได้เลย</div>
          </div>
        )}

        {messages.map(renderMessage)}

        {/* AI thinking indicator */}
        {aiThinking && (
          <div className="chat-msg chat-msg-ai">
            <div className="chat-msg-avatar chat-msg-avatar-ai">🤖</div>
            <div className="chat-typing">
              <div className="chat-typing-dot" />
              <div className="chat-typing-dot" />
              <div className="chat-typing-dot" />
              <span style={{ marginLeft: 4 }}>AI กำลังตรวจงาน...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="chat-input-area">
        {/* Action buttons */}
        <div className="chat-action-buttons">
          <button
            className={`chat-action-btn ${messageType === 'text' ? 'active' : ''}`}
            onClick={() => setMessageType('text')}
          >
            💬 แชท
          </button>
          <button
            className={`chat-action-btn ${messageType === 'news_submit' ? 'active' : ''}`}
            onClick={() => setMessageType('news_submit')}
          >
            📰 ส่งข่าวตรวจ
          </button>
          <button
            className={`chat-action-btn ${messageType === 'caption_submit' ? 'active' : ''}`}
            onClick={() => setMessageType('caption_submit')}
          >
            ✍️ ส่งแคปชั่นตรวจ
          </button>
          <button
            className={`chat-action-btn ${messageType === 'image_submit' ? 'active' : ''}`}
            onClick={() => setMessageType('image_submit')}
          >
            🖼️ ส่งภาพปกตรวจ
          </button>
        </div>

        {/* Type hint */}
        {messageType !== 'text' && (
          <div style={{ fontSize: 11, color: 'var(--chat-accent-light)', marginBottom: 6, padding: '0 4px' }}>
            {messageType === 'news_submit' && '📰 วาง URL หรือพิมพ์หัวข้อข่าว — AI จะวิเคราะห์ว่าน่าทำไหม'}
            {messageType === 'caption_submit' && '✍️ พิมพ์แคปชั่นที่เขียน — AI จะตรวจคุณภาพและแนะนำปรับปรุง'}
            {messageType === 'image_submit' && '🖼️ แนบภาพปก — AI จะตรวจว่าเหมาะกับข่าวหรือไม่'}
          </div>
        )}

        {/* Compose */}
        <div className="chat-compose">
          <textarea
            ref={textareaRef}
            placeholder={
              messageType === 'news_submit' ? 'วาง URL ข่าว หรือพิมพ์หัวข้อข่าว...' :
              messageType === 'caption_submit' ? 'พิมพ์แคปชั่นที่เขียนแล้ว...' :
              messageType === 'image_submit' ? 'พิมพ์ URL ภาพ หรืออธิบายภาพ...' :
              'พิมพ์ข้อความ...'
            }
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            style={{ height: Math.min(120, Math.max(42, inputText.split('\n').length * 24)) }}
          />
          <button
            className="chat-send-btn"
            onClick={handleSend}
            disabled={!inputText.trim() || sending}
            title="ส่ง"
          >
            {sending ? '⏳' : '➤'}
          </button>
        </div>
      </div>
    </div>
  );
}
