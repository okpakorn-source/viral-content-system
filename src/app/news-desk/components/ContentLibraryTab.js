'use client';

// ============================================================
// 📚 คลังเนื้อพร้อมใช้ — โมดูลที่ 3 ของโต๊ะข่าวกลาง v2 (C1, 17 ก.ค. 69)
// ------------------------------------------------------------
// ดึงผลลัพธ์ที่ระบบเจนเสร็จแล้ว (จากลีดที่ status='sent') มาเก็บเป็นคลัง — คัดลอกโพสต์ได้ทันที
// backend: /api/desk/content — ไม่มี polling, โหลดเมื่อเปิดแท็บ/หลัง action เท่านั้น
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { UI, Btn, Card, Spinner, apiFetch, fmtNum } from './ui.js';
import ContentCard from './ContentCard.js';

const API = '/api/desk/content';

const FILTERS = [
  { k: '', l: 'ทั้งหมด' },
  { k: 'ready', l: '🟢 พร้อมใช้' },
  { k: 'used', l: '✅ ใช้แล้ว' },
];

export default function ContentLibraryTab({ onToast }) {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [harvesting, setHarvesting] = useState(false);
  const [status, setStatusFilter] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState({ id: '', action: '' }); // busy ต่อการ์ด (setStatus/delete)
  const didInit = useRef(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '100' });
    if (status) params.set('status', status);
    if (q.trim()) params.set('q', q.trim());
    const res = await apiFetch(`${API}?${params.toString()}`);
    setLoading(false);
    if (res.success) setItems(res.items || []);
    else onToast?.(res.error || 'โหลดคลังเนื้อไม่สำเร็จ', 'err');
  }, [status, q, onToast]);

  const loadStats = useCallback(async () => {
    const res = await apiFetch(`${API}?view=stats`);
    if (res.success) setStats(res.stats || null);
  }, []);

  // โหลดครั้งแรกเมื่อเปิดแท็บ — เลื่อน setState ออกจาก effect body (กฎ react-hooks/set-state-in-effect)
  useEffect(() => {
    if (didInit.current) return undefined;
    didInit.current = true;
    const id = setTimeout(() => { loadList(); loadStats(); }, 0);
    return () => clearTimeout(id);
  }, [loadList, loadStats]);

  // ตัวกรองสถานะ: เปลี่ยนแล้วโหลดใหม่ทันที (ยกเว้นรอบแรกที่ effect ด้านบนจัดการแล้ว)
  useEffect(() => {
    if (!didInit.current) return undefined;
    const id = setTimeout(() => loadList(), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ตั้งใจไม่ผูก q (ค้นด้วย Enter/ปุ่มเท่านั้น กันยิงถี่ระหว่างพิมพ์)
  }, [status]);

  async function harvest() {
    setHarvesting(true);
    const res = await apiFetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'harvest' }),
    });
    setHarvesting(false);
    if (!res.success) { onToast?.(res.error || 'ดึงผลเจนไม่สำเร็จ', 'err'); return; }
    onToast?.(`เพิ่ม ${fmtNum(res.added || 0)} ใหม่ · รอเจนอีก ${fmtNum(res.waiting || 0)}`, 'ok');
    await Promise.all([loadList(), loadStats()]);
  }

  async function handleSetStatus(item, next) {
    setBusy({ id: item.id, action: 'status' });
    const res = await apiFetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setStatus', id: item.id, status: next }),
    });
    setBusy({ id: '', action: '' });
    if (!res.success) { onToast?.(res.error || 'เปลี่ยนสถานะไม่สำเร็จ', 'err'); return; }
    // ถ้ากรองด้วยสถานะอยู่ และรายการนี้ไม่ตรงตัวกรองใหม่แล้ว → เอาออกจากลิสต์ ไม่งั้นแก้ในที่
    if (status && status !== next) {
      setItems((prev) => prev.filter((r) => r.id !== item.id));
    } else {
      setItems((prev) => prev.map((r) => (r.id === item.id ? { ...r, status: next } : r)));
    }
    loadStats();
    onToast?.(next === 'used' ? '✅ ทำเครื่องหมายใช้แล้ว' : '↩️ คืนเป็นพร้อมใช้แล้ว', 'ok');
  }

  async function handleDelete(item) {
    setBusy({ id: item.id, action: 'delete' });
    const res = await apiFetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id: item.id }),
    });
    setBusy({ id: '', action: '' });
    if (!res.success) { onToast?.(res.error || 'ลบไม่สำเร็จ', 'err'); return; }
    setItems((prev) => prev.filter((r) => r.id !== item.id));
    loadStats();
    onToast?.('🗑 ลบออกจากคลังแล้ว', 'ok');
  }

  const total = stats?.total || 0;
  const readyCount = stats?.byStatus?.ready || 0;
  const usedCount = stats?.byStatus?.used || 0;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* หัว — สถิติ + ปุ่มดึงผลเจน */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 900, color: UI.text }}>{fmtNum(total)}</div>
              <div style={{ fontSize: 11.5, color: UI.muted }}>ทั้งหมด</div>
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 900, color: UI.green }}>{fmtNum(readyCount)}</div>
              <div style={{ fontSize: 11.5, color: UI.muted }}>พร้อมใช้</div>
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 900, color: UI.dim }}>{fmtNum(usedCount)}</div>
              <div style={{ fontSize: 11.5, color: UI.muted }}>ใช้แล้ว</div>
            </div>
          </div>
          <Btn variant="primary" busy={harvesting} disabled={harvesting} onClick={harvest} style={{ marginLeft: 'auto', minHeight: 44 }}>
            🔄 ดึงผลเจนที่เสร็จแล้ว
          </Btn>
        </div>
      </Card>

      {/* ตัวกรอง */}
      <Card>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
            {FILTERS.map((f) => (
              <button key={f.k} type="button" onClick={() => setStatusFilter(f.k)} style={{
                minHeight: 40, padding: '6px 14px', borderRadius: 999, cursor: 'pointer',
                fontSize: 13, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap',
                background: status === f.k ? `${UI.accent}22` : 'transparent',
                color: status === f.k ? UI.accent : UI.dim,
                border: `1.5px solid ${status === f.k ? UI.accent : UI.line}`,
              }}>{f.l}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, flex: '1 1 200px', minWidth: 180 }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') loadList(); }}
              placeholder="ค้นหัวข้อข่าว/เวอร์ชัน…"
              style={{ flex: 1, minHeight: 40, padding: '6px 12px', borderRadius: 10, background: UI.card2, color: UI.text, border: `1px solid ${UI.line2}`, fontSize: 13, fontFamily: 'inherit' }}
            />
            <Btn variant="subtle" busy={loading} onClick={loadList} style={{ minHeight: 40 }}>🔎</Btn>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 30, color: UI.dim }}><Spinner size={18} /> กำลังโหลด…</div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 30, color: UI.muted, fontSize: 13 }}>
            ยังไม่มีเนื้อในคลัง (ตามตัวกรองนี้) — กด &quot;🔄 ดึงผลเจนที่เสร็จแล้ว&quot; เพื่อเริ่มเก็บ
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: UI.dim, marginBottom: 10 }}>พบ {fmtNum(items.length)} ชิ้น</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
              {items.map((item) => (
                <ContentCard
                  key={item.id}
                  item={item}
                  onSetStatus={handleSetStatus}
                  onDelete={handleDelete}
                  busyAction={busy.id === item.id ? busy.action : ''}
                  onToast={onToast}
                />
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
