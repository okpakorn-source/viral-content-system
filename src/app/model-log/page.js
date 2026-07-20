'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

/**
 * 🎛️ Model Call Log — โมเดลไหนถูกเรียกทำอะไรบ้าง
 * 🔴 อ่านอย่างเดียวจาก /api/model-log (ไฟล์ JSONL นอกระบบ) — ไม่แตะระบบทำข่าว/ปก/คลิป
 */

const ARMS = [
  { key: 'all', label: 'ทั้งหมด', icon: '🗂️' },
  { key: 'claude', label: 'claude', icon: '🟣' },
  { key: 'codex', label: 'codex', icon: '🟢' },
  { key: 'agy', label: 'agy', icon: '🔷' },
  { key: 'kimi', label: 'kimi', icon: '🌙' },
];

const ARM_ICON = { claude: '🟣', codex: '🟢', agy: '🔷', kimi: '🌙' };

function statusColor(status) {
  const s = String(status || '');
  if (s === 'OK') return 'var(--desk-green, #34d399)';
  if (s === 'AUTH') return 'var(--desk-yellow, #fbbf24)';
  if (s === 'LIMIT' || s.startsWith('FAIL')) return 'var(--desk-red, #ef4444)';
  return 'var(--text-muted, #8a8f9c)';
}

function fmtTimeThai(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString('th-TH', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function isToday(ts) {
  if (!ts) return false;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export default function ModelLogPage() {
  const [calls, setCalls] = useState([]);
  const [note, setNote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [auto, setAuto] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [armFilter, setArmFilter] = useState('all');
  const [search, setSearch] = useState('');
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const r = await fetch('/api/model-log?limit=500', { cache: 'no-store' });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'โหลดไม่สำเร็จ');
      setCalls(Array.isArray(j.calls) ? j.calls : []);
      setNote(j.note || null);
      setUpdatedAt(new Date());
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { setLoading(true); load(); }, [load]);

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (auto) timer.current = setInterval(load, 30000);
    return () => timer.current && clearInterval(timer.current);
  }, [auto, load]);

  // ใหม่สุดก่อน
  const sorted = useMemo(() => {
    return [...calls].sort((a, b) => new Date(b.ts || 0).getTime() - new Date(a.ts || 0).getTime());
  }, [calls]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sorted.filter((c) => {
      if (armFilter !== 'all' && c.arm !== armFilter) return false;
      if (!q) return true;
      const hay = `${c.model || ''} ${c.purpose || ''} ${c.promptHead || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [sorted, armFilter, search]);

  // สรุปวันนี้
  const summary = useMemo(() => {
    const todayCalls = sorted.filter((c) => isToday(c.ts));
    const byArm = {};
    const byModel = {};
    for (const c of todayCalls) {
      const arm = c.arm || 'ไม่ทราบ';
      byArm[arm] = (byArm[arm] || 0) + 1;
      const model = c.model || 'ไม่ทราบ';
      byModel[model] = (byModel[model] || 0) + 1;
    }
    const modelList = Object.entries(byModel).sort((a, b) => b[1] - a[1]);
    return { total: todayCalls.length, byArm, modelList };
  }, [sorted]);

  const card = { background: 'var(--surface, #1b1d24)', border: '1px solid var(--border, #2c2f3a)', borderRadius: 14, padding: '16px 18px' };
  const muted = { color: 'var(--text-muted, #8a8f9c)' };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 18px 60px', color: 'var(--text, #e8eaf0)', fontFamily: 'inherit' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>🎛️ Model Call Log</h1>
          <div style={{ ...muted, fontSize: 13, marginTop: 4 }}>
            โมเดลไหนถูกเรียกทำอะไรบ้าง · อัปเดต {updatedAt ? updatedAt.toLocaleTimeString('th-TH') : '—'}
            {auto && <span style={{ color: 'var(--desk-green, #34d399)' }}> · 🟢 อัตโนมัติ (ทุก 30 วิ)</span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setAuto((a) => !a)}
            style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border,#2c2f3a)', background: auto ? 'var(--desk-green,#34d399)' : 'transparent', color: auto ? '#062018' : 'inherit', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
          >
            {auto ? '🟢 อัตโนมัติ' : '⏸️ หยุด'}
          </button>
          <button
            onClick={() => { setLoading(true); load(); }}
            style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border,#2c2f3a)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 }}
          >
            🔄 รีเฟรช
          </button>
        </div>
      </div>

      {note && (
        <div style={{ ...card, marginBottom: 16, borderColor: 'var(--desk-yellow, #fbbf24)', color: 'var(--desk-yellow, #fbbf24)', fontSize: 13 }}>
          ⚠️ {note === 'log file not found (team machine only)'
            ? 'ยังไม่พบไฟล์ log — ฟีเจอร์นี้ใช้ได้เฉพาะเครื่องทีมที่รันสคริปต์เรียกโมเดล (run-task.ps1 / arm-run.ps1)'
            : note}
        </div>
      )}

      {err && (
        <div style={{ ...card, marginBottom: 16, borderColor: 'var(--desk-red,#ef4444)', color: 'var(--desk-red,#ef4444)' }}>
          ⚠️ โหลดไม่สำเร็จ: {err}
        </div>
      )}

      {loading && !calls.length && !err && (
        <div style={{ ...card, textAlign: 'center', ...muted }}>กำลังโหลด…</div>
      )}

      {/* สรุปวันนี้ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 20 }}>
        <div style={{ ...card, background: 'linear-gradient(135deg, var(--accent,#6366f1)22, transparent)' }}>
          <div style={{ ...muted, fontSize: 12 }}>เรียกวันนี้</div>
          <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.15, marginTop: 4 }}>{summary.total.toLocaleString('en-US')}</div>
          <div style={{ ...muted, fontSize: 12 }}>ครั้ง</div>
        </div>
        <div style={card}>
          <div style={{ ...muted, fontSize: 12, marginBottom: 6 }}>แยกตามแขน (วันนี้)</div>
          {['claude', 'codex', 'agy', 'kimi'].map((a) => (
            <div key={a} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
              <span>{ARM_ICON[a]} {a}</span>
              <span style={{ fontWeight: 700 }}>{summary.byArm[a] || 0}</span>
            </div>
          ))}
        </div>
        <div style={{ ...card, gridColumn: 'span 1' }}>
          <div style={{ ...muted, fontSize: 12, marginBottom: 6 }}>แยกตามโมเดล (วันนี้)</div>
          {summary.modelList.length === 0 && <div style={{ ...muted, fontSize: 13 }}>ยังไม่มีข้อมูลวันนี้</div>}
          {summary.modelList.slice(0, 6).map(([m, n]) => (
            <div key={m} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }} title={m}>{m}</span>
              <span style={{ fontWeight: 700 }}>{n}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {ARMS.map((a) => (
          <button
            key={a.key}
            onClick={() => setArmFilter(a.key)}
            style={{
              padding: '8px 16px', borderRadius: 9, border: '1px solid var(--border,#2c2f3a)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: armFilter === a.key ? 'var(--accent,#6366f1)' : 'transparent', color: armFilter === a.key ? '#fff' : 'inherit',
            }}
          >
            {a.icon} {a.label}
          </button>
        ))}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหา: ชื่อโมเดล / งาน / ข้อความ..."
          style={{ flex: '1 1 220px', minWidth: 180, padding: '8px 12px', borderRadius: 9, border: '1px solid var(--border,#2c2f3a)', background: 'var(--surface-2,#14161c)', color: 'inherit', fontSize: 13 }}
        />
      </div>

      {/* Table */}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
            <thead>
              <tr style={{ textAlign: 'left', ...muted, fontSize: 12, borderBottom: '1px solid var(--border,#2c2f3a)' }}>
                <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>เวลา</th>
                <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>แขน</th>
                <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>โมเดล</th>
                <th style={{ padding: '10px 12px' }}>งาน</th>
                <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>สถานะ</th>
                <th style={{ padding: '10px 12px', whiteSpace: 'nowrap', textAlign: 'right' }}>วินาที</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} style={{ padding: '24px 12px', textAlign: 'center', ...muted }}>
                    ไม่มีข้อมูลตรงกับตัวกรอง
                  </td>
                </tr>
              )}
              {filtered.map((c, i) => (
                <tr key={`${c.ts || ''}-${i}`} style={{ borderBottom: '1px solid var(--border,#2c2f3a)' }}>
                  <td style={{ padding: '9px 12px', whiteSpace: 'nowrap', ...muted, fontSize: 12 }}>{fmtTimeThai(c.ts)}</td>
                  <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>{ARM_ICON[c.arm] || '•'} {c.arm || '—'}</td>
                  <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                    <b>{c.model || '—'}</b>
                    {c.effort && <span style={{ ...muted, fontSize: 11 }}> · {c.effort}</span>}
                  </td>
                  <td style={{ padding: '9px 12px', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.purpose || c.promptHead || ''}>
                    {c.purpose
                      ? c.purpose
                      : <span style={muted}>{c.promptHead || '—'}</span>}
                  </td>
                  <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                    <span style={{ color: statusColor(c.status), fontWeight: 700 }}>{c.status || '—'}</span>
                  </td>
                  <td style={{ padding: '9px 12px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {typeof c.durationSec === 'number' ? c.durationSec.toFixed(1) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ ...card, ...muted, fontSize: 12, lineHeight: 1.6, marginTop: 16 }}>
        📄 อ่านจากไฟล์ <code>model-call-log.jsonl</code> บนเครื่องทีม (ตั้งเส้นทางเองได้ผ่าน env <code>MODEL_CALL_LOG_PATH</code>) — แสดงบรรทัดล่าสุดสูงสุด 500 รายการ
      </div>
    </div>
  );
}
