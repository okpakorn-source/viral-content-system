'use client';
import { useState, useEffect, useCallback } from 'react';

// ============================================================
// 👤 NicknameGate — ด่านถามชื่อเล่นก่อนเข้าใช้หน้าสาธารณะ (15 ส.ค. 69 เจ้าของสั่ง)
// ------------------------------------------------------------
// โจทย์: "ให้ทุกคนเข้าถึงได้ แต่ต้องใส่ชื่อเล่นก่อนเข้าใช้ — ไม่ต้อง login พนักงานจะได้ใช้งานได้"
//
// ⚠️ นี่ไม่ใช่ระบบความปลอดภัย — เป็นแค่ป้ายชื่อ (เก็บใน localStorage ของเครื่องคนใช้เอง)
//    ใครก็เปิดหน้านี้ได้ถ้ามีลิงก์ · ด่านจริงของระบบยังเป็น AuthGuard/login เหมือนเดิมกับหน้าอื่น
//    → อย่าเอาไปครอบหน้าที่มีข้อมูลลับ ใช้กับหน้าที่ตั้งใจเปิดให้ทีมใช้ร่วมกันเท่านั้น
//
// วิธีใช้:
//   <NicknameGate title="📋 คลังผลงานเขียน">{children}</NicknameGate>
//   + ต้องเพิ่ม path ลง PUBLIC_ROUTES ใน ClientLayout.js ด้วย ไม่งั้นยังโดน AuthGuard เด้งไป /login
// ============================================================

const LS_KEY = 'vf_nickname';
const MIN_LEN = 2;
const MAX_LEN = 20;

/** อ่านชื่อเล่นจากเครื่อง — ให้ส่วนอื่นเรียกใช้ได้ (เช่น แนบชื่อคนกดไปกับ log) */
export function getNickname() {
  try {
    const v = (localStorage.getItem(LS_KEY) || '').trim();
    return v.length >= MIN_LEN ? v : '';
  } catch {
    return '';
  }
}

export default function NicknameGate({ children, title = '' }) {
  // mounted = กัน hydration mismatch (server ไม่รู้จัก localStorage — ต้องรอ client อ่านก่อน)
  const [mounted, setMounted] = useState(false);
  const [nickname, setNickname] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setNickname(getNickname());
    setMounted(true);
  }, []);

  const submit = useCallback((e) => {
    e.preventDefault();
    const v = draft.trim().replace(/\s+/g, ' ');
    if (v.length < MIN_LEN) { setError(`ชื่อเล่นสั้นไป (อย่างน้อย ${MIN_LEN} ตัวอักษร)`); return; }
    if (v.length > MAX_LEN) { setError(`ชื่อเล่นยาวไป (ไม่เกิน ${MAX_LEN} ตัวอักษร)`); return; }
    try { localStorage.setItem(LS_KEY, v); } catch { /* โหมดส่วนตัว/เขียนไม่ได้ = ใช้ได้แค่รอบนี้ */ }
    setNickname(v);
    setError('');
  }, [draft]);

  const changeName = useCallback(() => {
    setDraft(nickname);
    setNickname('');
  }, [nickname]);

  // ยังอ่าน localStorage ไม่เสร็จ — ปล่อยจอว่างไว้ชั่วครู่ (กันหน้ากะพริบเป็นฟอร์มแล้วหายไป)
  if (!mounted) return null;

  // ── ยังไม่มีชื่อเล่น → ด่านถามชื่อ ──
  if (!nickname) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, background: 'var(--bg-primary, #f6f7fb)', color: 'var(--text-primary, #111)',
      }}>
        <form onSubmit={submit} style={{
          width: '100%', maxWidth: 380, padding: 32, borderRadius: 18,
          background: 'var(--bg-card, #fff)', border: '1px solid var(--border-color, rgba(0,0,0,0.08))',
          boxShadow: '0 18px 50px rgba(0,0,0,0.12)',
        }}>
          <div style={{ textAlign: 'center', marginBottom: 22 }}>
            <div style={{ fontSize: 40, marginBottom: 6 }}>👋</div>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{title || 'ยินดีต้อนรับ'}</h1>
            <div style={{ fontSize: 13, color: 'var(--text-muted, #888)', marginTop: 6 }}>
              ใส่ชื่อเล่นก่อนเข้าใช้งาน (ไม่ต้องล็อกอิน)
            </div>
          </div>

          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 10, padding: '9px 12px', marginBottom: 14, fontSize: 12,
              color: '#ef4444', textAlign: 'center',
            }}>
              ❌ {error}
            </div>
          )}

          <input
            type="text"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); if (error) setError(''); }}
            placeholder="เช่น ฟ้า, ต้น, พี่หนึ่ง"
            autoFocus
            maxLength={MAX_LEN}
            style={{
              width: '100%', padding: '13px 15px', borderRadius: 11, fontSize: 15,
              background: 'var(--bg-input, rgba(0,0,0,0.03))',
              border: '1px solid var(--border-color, rgba(0,0,0,0.12))',
              color: 'inherit', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
              marginBottom: 16,
            }}
          />

          <button type="submit" style={{
            width: '100%', padding: '13px 0', borderRadius: 12, border: 'none',
            background: 'linear-gradient(135deg, #f91880, #7c3aed)', color: '#fff',
            fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: '0 8px 22px rgba(249,24,128,0.28)',
          }}>
            เข้าใช้งาน →
          </button>

          <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: 'var(--text-muted, #999)' }}>
            ชื่อเล่นเก็บไว้ในเครื่องนี้เท่านั้น — ครั้งหน้าไม่ต้องกรอกใหม่
          </div>
        </form>
      </div>
    );
  }

  // ── มีชื่อแล้ว → แถบชื่อบาง ๆ + เนื้อหน้าจริง ──
  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '8px 16px', fontSize: 12,
        background: 'var(--bg-card, #fff)',
        borderBottom: '1px solid var(--border-color, rgba(0,0,0,0.08))',
        color: 'var(--text-secondary, #555)',
      }}>
        <span>👤 <b style={{ color: 'var(--text-primary, #111)' }}>{nickname}</b></span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={changeName}
          style={{
            background: 'transparent', border: '1px solid var(--border-color, rgba(0,0,0,0.15))',
            borderRadius: 8, padding: '4px 10px', fontSize: 11, cursor: 'pointer',
            color: 'inherit', fontFamily: 'inherit',
          }}
        >
          เปลี่ยนชื่อ
        </button>
      </div>
      {children}
    </>
  );
}
