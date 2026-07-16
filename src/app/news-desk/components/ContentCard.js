'use client';

// ============================================================
// 📚 คลังเนื้อพร้อมใช้ — การ์ดเนื้อ 1 ชิ้น (แท็บสลับเวอร์ชัน + คัดลอกโพสต์ + ลิงก์ต้นฉบับ/อ้างอิง)
// ------------------------------------------------------------
// presentational ล้วน — รับ item จาก /api/desk/content + callback จาก parent (ContentLibraryTab)
// item shape: {id, jobId, leadTitle, sourceUrl, sourceHost, clusterArchetype, matchScore,
//   newsTitle, versions:[{style,title,hook,content,closing,tone,target,autoScore}],
//   researchRefs:[{title,sourceName,sourceUrl}], generatedAt, harvestedAt, status}
// ============================================================

import { useState } from 'react';
import { UI, Btn, Chip } from './ui.js';

// ── ประกอบข้อความโพสต์เต็ม (title+hook+content+closing) สำหรับคัดลอก ──
function buildPostText(v) {
  return [v?.title, v?.hook, v?.content, v?.closing].filter(Boolean).join('\n\n');
}

// ── คัดลอกคลิปบอร์ด: navigator.clipboard ก่อน · fallback window.prompt เฉพาะกรณี clipboard ใช้ไม่ได้ ──
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    throw new Error('no-clipboard-api');
  } catch {
    try {
      window.prompt('คัดลอกข้อความนี้ด้วยมือ (เลือกทั้งหมด → Ctrl+C):', text);
      return true;
    } catch {
      return false;
    }
  }
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return String(iso).slice(0, 10);
  }
}

export default function ContentCard({ item, onSetStatus, onDelete, busyAction, onToast }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [showRefs, setShowRefs] = useState(false);
  if (!item) return null;

  const versions = Array.isArray(item.versions) ? item.versions : [];
  const v = versions[activeIdx] || versions[0] || {};
  const used = item.status === 'used';
  const refs = Array.isArray(item.researchRefs) ? item.researchRefs : [];

  async function handleCopy() {
    const text = buildPostText(v);
    const ok = await copyToClipboard(text);
    onToast?.(ok ? '📋 คัดลอกโพสต์แล้ว' : 'คัดลอกไม่สำเร็จ', ok ? 'ok' : 'err');
  }

  return (
    <div style={{
      background: UI.card2, border: `1px solid ${UI.line}`, borderRadius: 14, padding: 14,
      display: 'flex', flexDirection: 'column', gap: 10, opacity: used ? 0.75 : 1,
    }}>
      {/* หัว — newsTitle เด่น + ชิปแหล่ง/archetype/วันเจน */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 14.5, fontWeight: 800, color: UI.text, lineHeight: 1.5 }}>
          {String(item.newsTitle || item.leadTitle || '(ไม่มีหัวข้อ)')}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {item.sourceHost && <Chip color={UI.blue}>{item.sourceHost}</Chip>}
          {item.clusterArchetype && <Chip color={UI.muted}>{item.clusterArchetype}</Chip>}
          <Chip color={UI.dim}>🗓 {fmtDate(item.generatedAt)}</Chip>
          {used
            ? <Chip color={UI.green}>✅ ใช้แล้ว</Chip>
            : <Chip color={UI.amber}>🟢 พร้อมใช้</Chip>}
        </div>
      </div>

      {/* แท็บสลับเวอร์ชัน */}
      {versions.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {versions.map((ver, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActiveIdx(i)}
              style={{
                minHeight: 34, padding: '4px 12px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12, fontWeight: activeIdx === i ? 800 : 600, whiteSpace: 'nowrap',
                background: activeIdx === i ? `${UI.accent}22` : 'transparent',
                color: activeIdx === i ? UI.accent : UI.dim,
                border: `1.5px solid ${activeIdx === i ? UI.accent : UI.line}`,
              }}
            >
              {ver.style || `เวอร์ชัน ${i + 1}`}{ver.autoScore != null ? ` · ${ver.autoScore}` : ''}
            </button>
          ))}
        </div>
      )}

      {/* เนื้อเวอร์ชันปัจจุบัน */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {v.title && (
          <div style={{ fontSize: 13.5, fontWeight: 700, color: UI.text, lineHeight: 1.6 }}>{v.title}</div>
        )}
        {v.hook && (
          <div style={{ fontSize: 12.5, color: UI.accent2, fontWeight: 600, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {v.hook}
          </div>
        )}
        {v.content && (
          <div style={{
            maxHeight: 380, overflowY: 'auto', background: UI.card, border: `1px solid ${UI.line}`,
            borderRadius: 10, padding: 10, fontSize: 12.5, color: UI.text, lineHeight: 1.7, whiteSpace: 'pre-wrap',
          }}>
            {v.content}
          </div>
        )}
        {v.closing && (
          <div style={{ fontSize: 12.5, color: UI.dim, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{v.closing}</div>
        )}
        <Btn variant="subtle" onClick={handleCopy} style={{ minHeight: 38, padding: '6px 14px', fontSize: 12.5, alignSelf: 'flex-start' }}>
          📋 คัดลอกทั้งโพสต์
        </Btn>
      </div>

      {/* แถวลิงก์ */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {item.sourceUrl && (
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', minHeight: 36, padding: '6px 14px',
              borderRadius: 10, fontSize: 12.5, fontWeight: 800, textDecoration: 'none',
              background: `${UI.accent}22`, color: UI.accent, border: `1.5px solid ${UI.accent}`,
            }}
          >🔗 ดูต้นฉบับ</a>
        )}
        {refs.length > 0 && (
          <Btn variant="ghost" onClick={() => setShowRefs((s) => !s)} style={{ minHeight: 36, padding: '6px 14px', fontSize: 12.5 }}>
            🔍 อ้างอิงรีเสิร์ช ({refs.length}){showRefs ? ' ▲' : ' ▼'}
          </Btn>
        )}
      </div>

      {showRefs && refs.length > 0 && (
        <div style={{ display: 'grid', gap: 6, background: UI.card, border: `1px solid ${UI.line}`, borderRadius: 10, padding: 10 }}>
          {refs.map((r, i) => (
            <div key={i} style={{ fontSize: 12, color: UI.dim, lineHeight: 1.6 }}>
              {r.sourceName ? <b style={{ color: UI.text }}>{r.sourceName}</b> : null}
              {r.sourceName ? ' — ' : ''}
              <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: UI.blue, textDecoration: 'none' }}>
                {r.title || r.sourceUrl}
              </a>
            </div>
          ))}
        </div>
      )}

      {/* ปุ่มจัดการ */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
        <Btn
          variant={used ? 'subtle' : 'green'}
          busy={busyAction === 'status'}
          disabled={!!busyAction}
          onClick={() => onSetStatus?.(item, used ? 'ready' : 'used')}
          style={{ minHeight: 38, padding: '6px 14px', fontSize: 12.5, flex: '1 1 auto' }}
        >{used ? '↩️ คืนเป็นพร้อมใช้' : '✅ ใช้แล้ว'}</Btn>
        <Btn
          variant="danger"
          busy={busyAction === 'delete'}
          disabled={!!busyAction}
          onClick={() => onDelete?.(item)}
          style={{ minHeight: 38, padding: '6px 14px', fontSize: 12.5 }}
        >🗑 ลบ</Btn>
      </div>
    </div>
  );
}
