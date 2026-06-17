'use client';
import { useState, useEffect } from 'react';

export default function CastingPage() {
  const [stage, setStage] = useState('name'); // name | quiz | result
  const [name, setName] = useState('');
  const [questions, setQuestions] = useState([]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState({}); // questionId -> choiceId
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  // โหลดชุดข้อสอบตั้งแต่เปิดหน้า — จะได้รู้จำนวนข้อจริงมาโชว์ในคำอธิบาย
  useEffect(() => {
    fetch('/api/casting/quiz', { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (d.success) setQuestions(d.questions || []); }).catch(() => {});
  }, []);

  const start = async () => {
    if (!name.trim()) { setErr('กรอกชื่อก่อนเริ่ม'); return; }
    setErr('');
    if (questions.length) { setIdx(0); setAnswers({}); setStage('quiz'); return; }
    setLoading(true);
    try {
      const r = await fetch('/api/casting/quiz', { cache: 'no-store' });
      const d = await r.json();
      if (!d.success || !d.questions?.length) { setErr('ยังไม่มีชุดข้อสอบ — แจ้งแอดมินให้สร้างคลังคำถามก่อน'); setLoading(false); return; }
      setQuestions(d.questions); setIdx(0); setAnswers({}); setStage('quiz');
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };

  const pick = (qid, cid) => setAnswers(p => ({ ...p, [qid]: cid }));

  const submit = async () => {
    setLoading(true); setErr('');
    try {
      const payload = { name: name.trim(), answers: Object.entries(answers).map(([questionId, choiceId]) => ({ questionId, choiceId })) };
      const r = await fetch('/api/casting/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!d.success) { setErr(d.error || 'ส่งไม่สำเร็จ'); setLoading(false); return; }
      setResult(d.result); setStage('result');
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };

  const q = questions[idx];
  const answeredCount = Object.keys(answers).length;
  const allAnswered = questions.length > 0 && answeredCount === questions.length;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary,#0d0d1a)', color: 'var(--text-primary,#e8e8f0)', fontFamily: 'inherit' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 18px 60px' }}>
        <h1 style={{ fontSize: 23, fontWeight: 900, margin: 0, display: 'flex', alignItems: 'center', gap: 9 }}>🎯 แบบทดสอบเซนส์ข่าว</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted,#888)', margin: '6px 0 20px' }}>
          เลือกแคปชั่นที่คุณคิดว่า "ปังที่สุด" สำหรับแต่ละข่าว — วัดเซนส์การมองข่าวขาด ก่อนเริ่มงานจริง
        </p>

        {err && <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 9, background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontSize: 13 }}>❌ {err}</div>}

        {/* ── กรอกชื่อ + คำอธิบาย ── */}
        {stage === 'name' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* แผงคำอธิบาย */}
            <div style={{ background: 'linear-gradient(135deg, rgba(249,24,128,0.07), rgba(124,58,237,0.07))', border: '1px solid rgba(124,58,237,0.25)', borderRadius: 14, padding: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>📋 รายละเอียดแบบฝึกหัด</div>

              <div style={{ fontSize: 13.5, lineHeight: 1.85, color: 'var(--text-secondary,#cbd)' }}>
                <p style={{ margin: '0 0 12px' }}>
                  แบบฝึกหัดนี้มีทั้งหมด <b style={{ color: '#f91880' }}>{questions.length || 30} ข้อ</b> — แต่ละข้อจะมี <b>หัวข้อข่าว 1 หัวข้อ</b> และ <b>แคปชั่นให้เลือก 3 แบบ</b>
                </p>

                <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 6px' }}>🎯 วิธีทำ</div>
                <p style={{ margin: '0 0 12px' }}>
                  ให้คุณ <b>อ่านหัวข้อข่าว</b> แล้ว <b>ทำความเข้าใจ</b> ว่าข่าวนี้เกี่ยวกับอะไร จากนั้น <b>เลือกช้อยส์ในมุมมองของคุณ</b> ว่า <u>เนื้อหา/แคปชั่นแบบไหนที่ควรนำเสนอกับหัวข้อข่าวนี้</u> ให้น่าสนใจและปังที่สุด — เลือกข้อเดียวที่คุณคิดว่าดีที่สุด แล้วกดถัดไป
                </p>

                <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 6px' }}>🏆 เกณฑ์คะแนน (แต่ละข้อ)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 4 }}>
                  <div style={{ padding: '7px 12px', borderRadius: 8, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)' }}>✅ เลือกแคปชั่น <b>ดีที่สุด</b> = <b style={{ color: '#22c55e' }}>+1 คะแนน</b></div>
                  <div style={{ padding: '7px 12px', borderRadius: 8, background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.25)' }}>🟡 เลือกแคปชั่น <b>ปานกลาง</b> = <b style={{ color: '#eab308' }}>+0.5 คะแนน</b></div>
                  <div style={{ padding: '7px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>❌ เลือกแคปชั่น <b>ไม่ดี</b> = <b style={{ color: '#ef4444' }}>0 คะแนน</b></div>
                </div>
                <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--text-muted,#888)' }}>
                  💡 แบบฝึกหัดนี้วัด "เซนส์การมองข่าว" — ทำตามความรู้สึกของคุณได้เลย ไม่มีถูกผิดตายตัว แต่จะสะท้อนว่าคุณมองออกไหมว่าแบบไหนจะปัง · เมื่อทำครบทุกข้อจะเห็นคะแนนรวมและสรุปรายข้อ
                </p>
              </div>
            </div>

            {/* กรอกชื่อ */}
            <div style={{ background: 'var(--bg-card,#1a1a2e)', border: '1px solid var(--border,#2a2a3e)', borderRadius: 14, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>กรอกชื่อก่อนเริ่ม (เพื่อบันทึกผล)</div>
              <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && start()}
                placeholder="ชื่อ-นามสกุล / ชื่อเล่น"
                style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border,#2a2a3e)', background: 'rgba(0,0,0,0.2)', color: 'inherit', fontSize: 15, fontFamily: 'inherit', boxSizing: 'border-box' }} />
              <button onClick={start} disabled={loading}
                style={{ marginTop: 14, width: '100%', padding: '13px 0', borderRadius: 11, border: 'none', background: loading ? '#4b5563' : 'linear-gradient(135deg,#f91880,#7c3aed)', color: '#fff', fontWeight: 800, fontSize: 15, cursor: loading ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                {loading ? '⏳ กำลังโหลด...' : `🚀 เริ่มทำแบบฝึกหัด (${questions.length || 30} ข้อ)`}
              </button>
            </div>
          </div>
        )}

        {/* ── ทำข้อสอบ ── */}
        {stage === 'quiz' && q && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, fontSize: 12.5, color: 'var(--text-muted,#888)' }}>
              <span>ข้อ {idx + 1} / {questions.length}</span>
              <span>ตอบแล้ว {answeredCount}/{questions.length}</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', marginBottom: 16, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${((idx + 1) / questions.length) * 100}%`, background: 'linear-gradient(90deg,#f91880,#7c3aed)', transition: 'width .3s' }} />
            </div>

            <div style={{ background: 'var(--bg-card,#1a1a2e)', border: '1px solid var(--border,#2a2a3e)', borderRadius: 14, padding: 18, marginBottom: 14 }}>
              <div style={{ fontSize: 11.5, color: '#a78bfa', fontWeight: 700, marginBottom: 6 }}>📰 หัวข้อข่าว</div>
              <div style={{ fontSize: 15.5, fontWeight: 700, lineHeight: 1.5 }}>{q.newsTitle}</div>
            </div>

            <div style={{ fontSize: 12.5, color: 'var(--text-muted,#888)', marginBottom: 8 }}>เลือกแคปชั่นที่ "ปังที่สุด" สำหรับข่าวนี้:</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {q.choices.map((c, i) => {
                const sel = answers[q.id] === c.id;
                return (
                  <button key={c.id} onClick={() => pick(q.id, c.id)}
                    style={{ textAlign: 'left', padding: '13px 15px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
                      border: sel ? '2px solid #f91880' : '2px solid var(--border,#2a2a3e)',
                      background: sel ? 'rgba(249,24,128,0.1)' : 'var(--bg-card,#1a1a2e)', color: 'inherit',
                      fontSize: 14, lineHeight: 1.6, transition: 'all .15s' }}>
                    <span style={{ fontWeight: 800, color: sel ? '#f91880' : 'var(--text-muted,#888)', marginRight: 8 }}>{String.fromCharCode(65 + i)}.</span>
                    {c.text}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
                style={{ padding: '11px 20px', borderRadius: 10, border: '1px solid var(--border,#2a2a3e)', background: 'var(--bg-card,#1a1a2e)', color: idx === 0 ? '#555' : 'inherit', fontSize: 14, cursor: idx === 0 ? 'default' : 'pointer', fontFamily: 'inherit' }}>← ก่อนหน้า</button>
              {idx < questions.length - 1 ? (
                <button onClick={() => setIdx(i => i + 1)}
                  style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: 'none', background: 'rgba(124,58,237,0.25)', color: '#a78bfa', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>ถัดไป →</button>
              ) : (
                <button onClick={submit} disabled={loading || !allAnswered}
                  style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: 'none', background: allAnswered && !loading ? 'linear-gradient(135deg,#22c55e,#16a34a)' : '#4b5563', color: '#fff', fontWeight: 800, fontSize: 14, cursor: allAnswered && !loading ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                  {loading ? '⏳ กำลังส่ง...' : allAnswered ? '✅ ส่งคำตอบ' : `ตอบให้ครบก่อน (เหลือ ${questions.length - answeredCount})`}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── ผลคะแนน ── */}
        {stage === 'result' && result && (
          <div>
            <div style={{ background: 'linear-gradient(135deg, rgba(249,24,128,0.12), rgba(124,58,237,0.12))', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 16, padding: 26, textAlign: 'center', marginBottom: 18 }}>
              <div style={{ fontSize: 14, color: 'var(--text-muted,#aaa)' }}>คะแนนของ <b style={{ color: 'var(--text-primary)' }}>{result.name}</b></div>
              <div style={{ fontSize: 46, fontWeight: 900, margin: '6px 0', background: 'linear-gradient(135deg,#f91880,#7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{result.total} / {result.maxScore}</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: result.percent >= 70 ? '#22c55e' : result.percent >= 45 ? '#eab308' : '#ef4444' }}>{result.percent}% — {result.percent >= 70 ? 'เซนส์ดีมาก 🔥' : result.percent >= 45 ? 'พอใช้ ฝึกได้ 💪' : 'ยังต้องฝึกอีก 📚'}</div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>สรุปรายข้อ</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {result.detail.map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 9, background: 'var(--bg-card,#1a1a2e)', border: '1px solid var(--border,#2a2a3e)' }}>
                  <span style={{ fontSize: 12, fontWeight: 800, minWidth: 28, color: d.score === 1 ? '#22c55e' : d.score === 0.5 ? '#eab308' : '#ef4444' }}>+{d.score}</span>
                  <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-secondary,#bbb)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.newsTitle}</span>
                  <span style={{ fontSize: 11, color: d.chosenQuality === 'best' ? '#22c55e' : d.chosenQuality === 'medium' ? '#eab308' : '#ef4444', fontWeight: 700 }}>{d.chosenQuality === 'best' ? 'ดีสุด' : d.chosenQuality === 'medium' ? 'ปานกลาง' : 'ไม่ดี'}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted,#888)', textAlign: 'center' }}>✅ ส่งผลให้แอดมินแล้ว ขอบคุณที่ทำแบบทดสอบ</div>
          </div>
        )}
      </div>
    </div>
  );
}
