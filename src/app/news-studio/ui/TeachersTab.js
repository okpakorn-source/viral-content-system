'use client';
// แท็บ "คลังครู": โพสต์จริงของเพจ 254 โพสต์ที่นักเขียนใช้เลียนสำนวน (อ่านอย่างเดียว · ค้น/กรองฝั่งเซิร์ฟเวอร์)
import { useEffect, useRef, useState } from 'react';
import { getJson, formatViews, OPENING_LABEL } from './api';

const PAGE = 30;

export default function TeachersTab() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [opening, setOpening] = useState('');
  const [data, setData] = useState(null); // {total, matched, items, categories, openings}
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const ticket = useRef(0);

  const load = async (offset, replace) => {
    const my = ++ticket.current;
    setBusy(true); setErr('');
    const params = new URLSearchParams({ kind: 'teachers', q: q.trim(), category, opening, offset: String(offset), limit: String(PAGE) });
    const d = await getJson(`/api/news-studio/library?${params}`);
    if (my !== ticket.current) return; // มีคำค้นใหม่กว่าแล้ว — ทิ้งผลเก่า
    setBusy(false);
    if (!d.success) { setErr(d.error || 'โหลดคลังครูไม่สำเร็จ'); return; }
    setData((prev) => (replace || !prev ? d : { ...d, items: [...prev.items, ...d.items] }));
  };

  // เปลี่ยนตัวกรอง = โหลดใหม่ (หน่วงตอนพิมพ์คำค้น)
  useEffect(() => {
    const t = setTimeout(() => load(0, true), q ? 350 : 0);
    return () => clearTimeout(t);
  }, [q, category, opening]); // eslint-disable-line react-hooks/exhaustive-deps

  const cats = data ? Object.entries(data.categories).sort((a, b) => b[1] - a[1]) : [];
  const opens = data ? Object.entries(data.openings).sort((a, b) => b[1] - a[1]) : [];

  return (
    <div className="ns-stack">
      <div className="ns-note info">
        โพสต์จริงของเพจที่มีคนอ่านหลายล้านครั้ง นักเขียนเลียนได้เฉพาะวิธีเขียน คือ วิธีเปิด จังหวะ ความยาว และวิธีปิด ห้ามเอาข้อเท็จจริงหรือประโยคของครูมาใช้
      </div>
      <div className="ns-filters">
        <input className="ns-input" type="search" placeholder="ค้นจากชื่อแนวเรื่องหรือเนื้อโพสต์" aria-label="ค้นโพสต์ครู" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="ns-select" aria-label="หมวดข่าว" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">ทุกหมวด</option>
          {cats.map(([k, n]) => <option key={k} value={k}>{k} ({n})</option>)}
        </select>
        <select className="ns-select" aria-label="วิธีเปิดเรื่อง" value={opening} onChange={(e) => setOpening(e.target.value)}>
          <option value="">ทุกวิธีเปิด</option>
          {opens.map(([k, n]) => <option key={k} value={k}>{OPENING_LABEL[k] || k} ({n})</option>)}
        </select>
      </div>
      {err && <div className="ns-note bad" role="alert">{err}</div>}
      {data && <div className="ns-muted ns-num" role="status">พบ {data.matched} จาก {data.total} โพสต์ เรียงจากยอดวิวมากสุด</div>}
      {!data && !err && <div className="ns-empty">กำลังโหลดคลังครู…</div>}
      {data && data.items.length === 0 && !busy && <div className="ns-empty">ไม่พบโพสต์ครูที่ตรงกับตัวกรองนี้</div>}
      <div className="ns-list">
        {(data?.items || []).map((t) => (
          <article key={t.id} className="ns-card">
            <div className="ns-card-pad ns-stack">
              <div className="ns-row-title">{t.name}</div>
              <div className="ns-line">
                <span className="ns-pill plain">{t.category}</span>
                <span className="ns-pill plain">{OPENING_LABEL[t.openingType] || t.openingType}</span>
                {formatViews(t.views) && <span className="ns-pill plain ns-num">{formatViews(t.views)}</span>}
                <span className="ns-muted ns-num">{t.words} คำ</span>
              </div>
            </div>
            <p className="ns-post small">{t.post}</p>
            {(t.whyItWorks || t.url) && (
              <details className="ns-disclose">
                <summary>ทำไมโพสต์นี้ได้ผล</summary>
                <div className="ns-disclose-body">
                  {t.whyItWorks && <div>{t.whyItWorks}</div>}
                  {t.url && <a href={t.url} target="_blank" rel="noreferrer">เปิดโพสต์จริงบน Facebook</a>}
                </div>
              </details>
            )}
          </article>
        ))}
      </div>
      {data && data.items.length < data.matched && (
        <button type="button" className="ns-btn" disabled={busy} onClick={() => load(data.items.length, false)}>
          {busy ? 'กำลังโหลด…' : `โหลดเพิ่ม (เหลืออีก ${data.matched - data.items.length})`}
        </button>
      )}
    </div>
  );
}
