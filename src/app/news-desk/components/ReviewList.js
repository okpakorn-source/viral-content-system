'use client';

// 🧬 DNA Lab — ขั้น 5: รีวิวผลวิจัย (การ์ด 2 แท็บ S/A)
// ใบ confidence<0.6 ติดธง "⚑ ตรวจมือ" ดันขึ้นบนสุด + ปุ่ม 🗑 ลบออกจากคลัง
// ที่เหลือถือว่าเก็บแล้ว (bulk-approve default) — ปุ่มลบเท่านั้นที่ยิง server

import { useState } from 'react';
import { UI, Btn, Card, Chip, fmtNum, tierMeta } from './ui.js';

const LOW_CONF = 0.6;

function DnaCard({ rec, onDelete, deleting }) {
  const d = rec.dna || {};
  const low = (Number(d.confidence) || 0) < LOW_CONF;
  const tm = tierMeta(rec.tier);
  const queries = [...(d.newsQueries || []), ...(d.clipQueries || [])];

  return (
    <div style={{
      background: UI.card, borderRadius: 14, padding: 14,
      border: `1px solid ${low ? UI.amber : UI.line}`,
      boxShadow: low ? `0 0 0 1px ${UI.amber}44` : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        {low && <Chip color={UI.amber}>⚑ ตรวจมือ</Chip>}
        <Chip color={tm.color}>{tm.label}</Chip>
        <Chip color={UI.blue}>{d.category || 'อื่นๆ'}</Chip>
        <Chip color={UI.muted}>เข้าถึง {fmtNum(rec.reach)}</Chip>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: low ? UI.amber : UI.green }}>
          มั่นใจ {Math.round((Number(d.confidence) || 0) * 100)}%
        </span>
      </div>

      <div style={{ fontSize: 13.5, fontWeight: 700, color: UI.text, lineHeight: 1.5, marginBottom: 8 }}>
        {String(rec.title || '').slice(0, 140)}{(rec.title || '').length > 140 ? '…' : ''}
      </div>

      <div style={{ display: 'grid', gap: 6, fontSize: 12.5, color: UI.dim, marginBottom: 8 }}>
        <div><b style={{ color: UI.text }}>🎭 Archetype:</b> {d.archetype || '—'}</div>
        {d.twist && <div><b style={{ color: UI.text }}>🔄 จุดหักมุม:</b> {d.twist}</div>}
        {!!(d.emotionalTriggers || []).length && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <b style={{ color: UI.text }}>💥 ทริกเกอร์:</b>
            {d.emotionalTriggers.map((t, i) => <Chip key={i} color={UI.accent2}>{t}</Chip>)}
          </div>
        )}
      </div>

      {!!queries.length && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {queries.slice(0, 8).map((q, i) => (
            <span key={i} style={{ fontSize: 11.5, padding: '3px 8px', borderRadius: 8, background: UI.card2, color: UI.dim, border: `1px solid ${UI.line}` }}>
              🔎 {q}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Btn variant="danger" busy={deleting} onClick={() => onDelete(rec.postKey || rec.id)} style={{ minHeight: 38, padding: '6px 14px', fontSize: 12.5 }}>
          🗑 ลบออกจากคลัง
        </Btn>
      </div>
    </div>
  );
}

export default function ReviewList({ records, onDelete, deletingKey }) {
  const [tab, setTab] = useState('S');
  const list = (records || []).filter((r) => r.tier === tab);
  // ธง ตรวจมือ ขึ้นบนสุด แล้วเรียง reach มาก→น้อย
  const sorted = list.slice().sort((a, b) => {
    const la = (Number(a.dna?.confidence) || 0) < LOW_CONF ? 0 : 1;
    const lb = (Number(b.dna?.confidence) || 0) < LOW_CONF ? 0 : 1;
    if (la !== lb) return la - lb;
    return (Number(b.reach) || 0) - (Number(a.reach) || 0);
  });
  const countS = (records || []).filter((r) => r.tier === 'S').length;
  const countA = (records || []).filter((r) => r.tier === 'A').length;
  const flagged = (records || []).filter((r) => (Number(r.dna?.confidence) || 0) < LOW_CONF).length;

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: UI.text }}>✅ ผลวิจัยรอบนี้</span>
        <span style={{ fontSize: 12.5, color: UI.dim }}>เก็บเข้าคลังแล้วทั้งหมด (bulk-approve) — ตรวจแล้วลบเฉพาะที่ไม่ต้องการ</span>
        {flagged > 0 && <Chip color={UI.amber} style={{ marginLeft: 'auto' }}>⚑ ต้องตรวจมือ {flagged} ใบ</Chip>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, overflowX: 'auto' }}>
        {[
          { key: 'S', label: `🥇 S (${countS})`, color: UI.gold },
          { key: 'A', label: `🥈 A (${countA})`, color: UI.silver },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              minHeight: 44, padding: '8px 18px', borderRadius: 999, cursor: 'pointer',
              fontSize: 14, fontWeight: 800, fontFamily: 'inherit', whiteSpace: 'nowrap',
              background: tab === t.key ? `${t.color}22` : 'transparent',
              color: tab === t.key ? t.color : UI.dim,
              border: `1.5px solid ${tab === t.key ? t.color : UI.line}`,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 30, color: UI.muted, fontSize: 13 }}>
          ไม่มีผลวิจัยในกลุ่มนี้ (รอบนี้)
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {sorted.map((r) => (
            <DnaCard key={r.postKey || r.id} rec={r} onDelete={onDelete} deleting={deletingKey === (r.postKey || r.id)} />
          ))}
        </div>
      )}
    </Card>
  );
}
