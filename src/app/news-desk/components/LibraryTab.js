'use client';

// 🧬 DNA Lab — แท็บคลัง: รายการต้นแบบ + ตัวกรอง + มุมมองคลัสเตอร์ + Export + ประวัติ runs
// ไม่มี auto-refresh — โหลดเมื่อผู้ใช้กระทำเท่านั้น (เปิดแท็บ/กดค้นหา/กดรีเฟรช)

import { useState, useEffect, useRef, useCallback } from 'react';
import { UI, Btn, Card, Chip, Spinner, fmtNum, fmtBaht, tierMeta } from './ui.js';
import { apiFetch } from './ui.js';

const LIB = '/api/desk/dna/library';

export default function LibraryTab({ onToast }) {
  const [view, setView] = useState('list'); // 'list' | 'clusters'
  const [tier, setTier] = useState('');      // '' | 'S' | 'A'
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [exemplars, setExemplars] = useState([]);
  const [clusters, setClusters] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const didInit = useRef(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '200' });
    if (tier) params.set('tier', tier);
    if (category) params.set('category', category);
    if (q.trim()) params.set('q', q.trim());
    const res = await apiFetch(`${LIB}?${params.toString()}`);
    setLoading(false);
    if (res.success) setExemplars(res.exemplars || []);
    else onToast?.(res.error || 'โหลดคลังไม่สำเร็จ', 'err');
  }, [tier, category, q, onToast]);

  const loadClusters = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch(`${LIB}?view=clusters`);
    setLoading(false);
    if (res.success) setClusters(res.clusters || []);
    else onToast?.(res.error || 'โหลดคลัสเตอร์ไม่สำเร็จ', 'err');
  }, [onToast]);

  const loadRuns = useCallback(async () => {
    const res = await apiFetch('/api/desk/dna/runs?limit=20');
    if (res.success) setRuns(res.runs || []);
  }, []);

  // โหลดครั้งแรกเมื่อเปิดแท็บ — เลื่อน setState ออกจาก effect body (กฎ react-hooks/set-state-in-effect)
  useEffect(() => {
    if (didInit.current) return undefined;
    didInit.current = true;
    const id = setTimeout(() => { loadList(); loadRuns(); }, 0);
    return () => clearTimeout(id);
  }, [loadList, loadRuns]);

  useEffect(() => {
    if (view !== 'clusters') return undefined;
    const id = setTimeout(() => loadClusters(), 0);
    return () => clearTimeout(id);
  }, [view, loadClusters]);

  async function exportJson() {
    setExporting(true);
    const res = await apiFetch(`${LIB}?view=export`);
    setExporting(false);
    if (!res.success) { onToast?.(res.error || 'export ไม่สำเร็จ', 'err'); return; }
    try {
      const blob = new Blob([JSON.stringify(res.records || [], null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dna-exemplars-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onToast?.(`ดาวน์โหลด ${fmtNum((res.records || []).length)} record แล้ว`, 'ok');
    } catch (e) {
      onToast?.('สร้างไฟล์ export ไม่สำเร็จ: ' + e.message, 'err');
    }
  }

  // หมวดที่มีในคลัง (สำหรับ dropdown) — derive จาก record ที่โหลดมา
  const catOptions = Array.from(new Set(exemplars.map((r) => r.dna?.category).filter(Boolean))).sort();

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* หัว + สลับมุมมอง + export */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
          {[{ k: 'list', l: '📋 รายการ' }, { k: 'clusters', l: '🗂️ คลัสเตอร์' }].map((v) => (
            <button key={v.k} type="button" onClick={() => setView(v.k)} style={{
              minHeight: 40, padding: '8px 16px', borderRadius: 999, cursor: 'pointer',
              fontSize: 13.5, fontWeight: 800, fontFamily: 'inherit', whiteSpace: 'nowrap',
              background: view === v.k ? `${UI.accent}22` : 'transparent',
              color: view === v.k ? UI.accent : UI.dim,
              border: `1.5px solid ${view === v.k ? UI.accent : UI.line}`,
            }}>{v.l}</button>
          ))}
        </div>
        <Btn variant="subtle" busy={exporting} onClick={exportJson} style={{ marginLeft: 'auto', minHeight: 40 }}>⬇ Export JSON</Btn>
      </div>

      {view === 'list' && (
        <Card>
          {/* ตัวกรอง — ยุบเป็นแถวเลื่อนแนวนอนบนจอเล็ก */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
              {[{ k: '', l: 'ทั้งหมด', c: UI.dim }, { k: 'S', l: '🥇 S', c: UI.gold }, { k: 'A', l: '🥈 A', c: UI.silver }].map((t) => (
                <button key={t.k} type="button" onClick={() => setTier(t.k)} style={{
                  minHeight: 40, padding: '6px 14px', borderRadius: 999, cursor: 'pointer',
                  fontSize: 13, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap',
                  background: tier === t.k ? `${t.c}22` : 'transparent',
                  color: tier === t.k ? t.c : UI.dim,
                  border: `1.5px solid ${tier === t.k ? t.c : UI.line}`,
                }}>{t.l}</button>
              ))}
            </div>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{
              minHeight: 40, padding: '6px 10px', borderRadius: 10, background: UI.card2, color: UI.text,
              border: `1px solid ${UI.line2}`, fontSize: 13, fontFamily: 'inherit',
            }}>
              <option value="">ทุกหมวด</option>
              {catOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 6, flex: '1 1 200px', minWidth: 180 }}>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') loadList(); }}
                placeholder="ค้นหัวข้อ/archetype…"
                style={{ flex: 1, minHeight: 40, padding: '6px 12px', borderRadius: 10, background: UI.card2, color: UI.text, border: `1px solid ${UI.line2}`, fontSize: 13, fontFamily: 'inherit' }}
              />
              <Btn variant="subtle" busy={loading} onClick={loadList} style={{ minHeight: 40 }}>🔎</Btn>
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 30, color: UI.dim }}><Spinner size={18} /> กำลังโหลด…</div>
          ) : exemplars.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 30, color: UI.muted, fontSize: 13 }}>
              ยังไม่มีต้นแบบในคลัง (ตามตัวกรองนี้) — ไปแท็บ &quot;วิจัยใหม่&quot; เพื่อเริ่มเก็บ DNA
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12.5, color: UI.dim, marginBottom: 10 }}>พบ {fmtNum(exemplars.length)} ต้นแบบ</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                {exemplars.map((r) => {
                  const tm = tierMeta(r.tier);
                  return (
                    <div key={r.id || r.postKey} style={{ background: UI.card2, border: `1px solid ${UI.line}`, borderRadius: 12, padding: 12 }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                        <Chip color={tm.color}>{r.tier}</Chip>
                        <Chip color={UI.blue}>{r.dna?.category || 'อื่นๆ'}</Chip>
                        <Chip color={UI.muted}>เข้าถึง {fmtNum(r.reach)}</Chip>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: UI.text, lineHeight: 1.5, marginBottom: 6 }}>
                        {String(r.title || '').slice(0, 100)}{(r.title || '').length > 100 ? '…' : ''}
                      </div>
                      <div style={{ fontSize: 12, color: UI.dim }}>🎭 {r.dna?.archetype || '—'}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>
      )}

      {view === 'clusters' && (
        <Card>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 30, color: UI.dim }}><Spinner size={18} /> กำลังโหลด…</div>
          ) : clusters.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 30, color: UI.muted, fontSize: 13 }}>ยังไม่มีคลัสเตอร์</div>
          ) : (
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560, fontSize: 13 }}>
                <thead>
                  <tr style={{ color: UI.dim, textAlign: 'left' }}>
                    {['Archetype (ตัวแทนกลุ่ม)', 'จำนวน', 'เข้าถึงสูงสุด', 'เข้าถึงเฉลี่ย', 'S / A'].map((h) => (
                      <th key={h} style={{ padding: '8px 10px', borderBottom: `1px solid ${UI.line}`, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {clusters.map((c) => (
                    <tr key={c.clusterId} style={{ color: UI.text }}>
                      <td style={{ padding: '8px 10px', borderBottom: `1px solid ${UI.line}`, minWidth: 220 }}>{c.archetype || '—'}</td>
                      <td style={{ padding: '8px 10px', borderBottom: `1px solid ${UI.line}`, fontWeight: 800 }}>{fmtNum(c.count)}</td>
                      <td style={{ padding: '8px 10px', borderBottom: `1px solid ${UI.line}`, whiteSpace: 'nowrap' }}>{fmtNum(c.maxReach)}</td>
                      <td style={{ padding: '8px 10px', borderBottom: `1px solid ${UI.line}`, whiteSpace: 'nowrap' }}>{fmtNum(c.avgReach)}</td>
                      <td style={{ padding: '8px 10px', borderBottom: `1px solid ${UI.line}`, whiteSpace: 'nowrap' }}>
                        <span style={{ color: UI.gold }}>{c.tierCounts?.S || 0}</span> / <span style={{ color: UI.silver }}>{c.tierCounts?.A || 0}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ประวัติ runs */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 14.5, fontWeight: 800, color: UI.text }}>🗓️ ประวัติการวิจัย</span>
          <Btn variant="subtle" onClick={loadRuns} style={{ minHeight: 36, padding: '6px 12px', fontSize: 12.5 }}>↻ รีเฟรช</Btn>
        </div>
        {runs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20, color: UI.muted, fontSize: 13 }}>ยังไม่มีประวัติ</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {runs.map((run) => {
              const done = run.status === 'done';
              const rc = run.resultCounts || {};
              return (
                <div key={run.id || run.runId} style={{ background: UI.card2, border: `1px solid ${UI.line}`, borderRadius: 10, padding: 10 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Chip color={done ? UI.green : UI.amber}>{done ? '✓ เสร็จ' : '● กำลังทำ'}</Chip>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: UI.text }}>{run.fileName || run.runId}</span>
                    <span style={{ fontSize: 11.5, color: UI.muted }}>{String(run.startedAt || '').slice(0, 16).replace('T', ' ')}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11.5, color: UI.dim }}>
                      {run.model || ''} {run.costActual != null ? '· ' + fmtBaht(run.costActual) : run.costEstimate != null ? '· ~' + fmtBaht(run.costEstimate) : ''}
                    </span>
                  </div>
                  {done && (
                    <div style={{ fontSize: 11.5, color: UI.dim, marginTop: 4 }}>
                      เก็บ {fmtNum(rc.saved || 0)} · ซ้ำ {fmtNum(rc.dup || 0)} · พลาด {fmtNum(rc.failed || 0)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
