'use client';
/**
 * InsightCard — ตัวเรนเดอร์ผลถอดประเด็น "หนึ่งเดียว"
 * ใช้ได้ทั้งผลสด (live) และเคสในคลังที่กางออก — แทนโค้ดซ้ำ 2 ชุดเดิมใน page.js
 * (เดิม 533-669 กับ 724-796 เพี้ยนกัน: คลังตก quotes รายประเด็น / สาขา multiTopic ตก speakers+usageNote+timeline+rawData)
 *
 * props:
 *   rec        ใบจากคลัง {id,url,platform,title,insight,category,clipDurationSec,user,elapsedMs,modelUsed,lowQuality,qualityNote,createdAt,chosen,cached,cachedAt}
 *   live       true = ผลสด (กาง rawData ให้เลย)
 *   copiedKey  key ของปุ่มที่เพิ่งคัดลอก (โชว์ ✓)
 *   onCopy(key,text) / onDelete(id) / onPin(id,chosen) / onRetry(url)  — ไม่ส่ง = ซ่อนปุ่มนั้น
 */
import { useState } from 'react';
import { platformIcon, fmtDurSec, fmtMs, fmtClock } from './statusMeta';
import { buildClipNewsReadyText, buildClipSubStoryText } from '@/lib/services/clipNewsReadyText';
import BrainBox from './BrainBox';

const C = { card: '#1f2937', sub: '#111827', line: '#374151', text: '#e5e7eb', muted: '#9ca3af', accent: '#38bdf8' };

const chip = (color, bg) => ({
  fontSize: 12, padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap',
  color, background: bg, border: `1px solid ${color}44`, fontWeight: 600,
});
const btn = (active) => ({
  padding: '4px 11px', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
  border: `1px solid ${active ? '#22c55e66' : C.line}`, background: 'transparent',
  color: active ? '#22c55e' : C.muted,
});
const headSt = { fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 5 };
const quoteSt = { fontSize: 12.5, lineHeight: 1.6, padding: '6px 10px', borderRadius: 8, background: 'rgba(34,197,94,0.06)', borderLeft: '2px solid #22c55e' };

/** ข้อความคัดลอกของ 1 ประเด็น (คลิปยาว) — ยกมาจาก page.js:244-250 */
function topicText(t) {
  const lines = [`【${t?.no ?? ''}】 ${t?.title || ''}${(t?.timeStart || t?.timeEnd) ? `  (${t.timeStart || '?'}–${t.timeEnd || '?'})` : ''}`];
  if (t?.summary) lines.push(t.summary);
  if (t?.keyPoints?.length) lines.push(t.keyPoints.map((k) => `• ${k}`).join('\n'));
  if (t?.quotes?.length) lines.push(t.quotes.map((q) => `“${q}”`).join('\n'));
  return lines.join('\n');
}

function safeReadyText(ins) {
  try { return buildClipNewsReadyText(ins) || ''; } catch { return ins?.rawData || ''; }
}
function safeSubText(s, i) {
  try { return buildClipSubStoryText(s, i) || ''; } catch { return s?.rawData || ''; }
}

export default function InsightCard({ rec, live = false, copiedKey, onCopy, onDelete, onPin, onRetry }) {
  const [rawOpen, setRawOpen] = useState(!!live);
  const r = rec || {};
  const ins = r.insight || {};
  const id = r.id || 'live';
  const k = (suffix) => `ic-${id}-${suffix}`;
  const copy = (key, text) => { if (onCopy) onCopy(key, text); };
  const isCopied = (key) => copiedKey === key;

  const category = r.category || ins.category;
  const dur = Number(r.clipDurationSec || ins.clipDurationSec) || 0;
  const warnings = Array.isArray(ins.editorialWarnings) ? ins.editorialWarnings : [];
  const lowQuality = r.lowQuality || ins.lowQuality;
  const qualityNote = r.qualityNote || ins.qualityNote;
  const cached = r.cached || ins.cached;
  const cachedAt = r.cachedAt || ins.cachedAt;

  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, color: C.text }}>
      {/* ── หัวการ์ด ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.5 }}>
            {platformIcon(r.platform)} {ins.headline || r.title || r.url || '(ไม่มีหัวเรื่อง)'}
            {r.chosen ? <span style={{ marginLeft: 6 }} title="ปักไว้">📌</span> : null}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6, fontSize: 12, color: C.muted }}>
            {category && <span style={chip('#f59e0b', 'rgba(245,158,11,.12)')}>📂 {category}</span>}
            {ins.multiTopic && <span style={chip('#fbbf24', 'rgba(251,191,36,.12)')}>📚 คลิปยาว · {ins.totalTopics || ins.topics?.length || 0} ประเด็น</span>}
            {dur > 0 && <span>⏱️ {fmtDurSec(dur)}</span>}
            {r.modelUsed && <span>🤖 {r.modelUsed}</span>}
            {r.user && <span>👤 {r.user}</span>}
            {fmtClock(r.createdAt) && <span>🕒 {fmtClock(r.createdAt)}</span>}
            {fmtMs(r.elapsedMs) && <span>⚡ {fmtMs(r.elapsedMs)}</span>}
            {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color: C.accent }}>🔗 เปิดคลิป</a>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <button onClick={() => copy(k('ready'), safeReadyText(ins))} style={btn(isCopied(k('ready')))}>
            {isCopied(k('ready')) ? '✓ คัดลอกแล้ว' : '📋 คัดลอกเนื้อพร้อมใช้'}
          </button>
          {onPin && r.id && (
            <button onClick={() => onPin(r.id, !r.chosen)} style={btn(false)} title={r.chosen ? 'ปลดปัก' : 'ปักไว้'}>
              {r.chosen ? '📌 ปลดปัก' : '📌 ปัก'}
            </button>
          )}
          {onDelete && r.id && (
            <button
              onClick={() => { if (window.confirm('ลบใบนี้ออกจากคลังถาวร?')) onDelete(r.id); }}
              style={{ ...btn(false), color: '#ef4444', borderColor: '#ef444455' }}
            >🗑️ ลบ</button>
          )}
        </div>
      </div>

      {/* ── แถวป้ายเตือน ── */}
      {lowQuality && (
        <div style={{ fontSize: 12.5, padding: '8px 11px', borderRadius: 9, background: 'rgba(239,68,68,.08)', border: '1px solid #ef444455', color: '#f87171', marginBottom: 10 }}>
          ⚠️ <b>{qualityNote || 'ผลอาจไม่สมบูรณ์ — แนะนำกดถอดใหม่'}</b>
        </div>
      )}
      {warnings.length > 0 && (
        <div style={{ fontSize: 12.5, lineHeight: 1.65, padding: '8px 11px', borderRadius: 9, background: 'rgba(251,191,36,.08)', border: '1px solid #fbbf2455', color: '#fbbf24', marginBottom: 10 }}>
          <b>✍️ จุดให้พนักงานตรวจประโยคเปิด</b>
          {warnings.map((w, i) => <div key={i}>• {w}</div>)}
        </div>
      )}
      {cached && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5, padding: '8px 11px', borderRadius: 9, background: 'rgba(34,197,94,.07)', border: '1px solid #22c55e55', color: '#22c55e', marginBottom: 10 }}>
          <span>⚡ ใบเดิมจากคลัง {fmtClock(cachedAt) || ''}</span>
          {onRetry && r.url && <button onClick={() => onRetry(r.url)} style={{ ...btn(false), color: '#22c55e', borderColor: '#22c55e66' }}>🔁 ถอดใหม่</button>}
        </div>
      )}

      {/* ── ผลตรวจสอบหลังถอด ── */}
      <BrainBox brain={ins.brain} />

      {/* ── ป้ายชนิดคลิป + ผู้พูด + วิธีใช้ (โชว์ทั้ง 2 สาขา — เดิมสาขาคลิปยาวตกหล่น) ── */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        {ins.clipTypeLabel && <span style={chip('#a78bfa', 'rgba(167,139,250,.12)')}>{ins.emoji || '🎬'} {ins.clipTypeLabel}</span>}
        {ins.engine && <span style={{ fontSize: 12, color: C.muted }}>{String(ins.engine).includes('gemini-video') ? '👁️ ดูคลิป' : '📝 บทถอด'}</span>}
      </div>
      {ins.speakers?.length > 0 && (
        <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 8 }}>🗣️ ผู้พูด: {ins.speakers.join(', ')}</div>
      )}
      {ins.usageNote && (
        <div style={{ fontSize: 12.5, color: '#a78bfa', marginBottom: 10, padding: '7px 11px', borderRadius: 8, background: 'rgba(167,139,250,.07)' }}>💡 {ins.usageNote}</div>
      )}

      {/* ── ภาพรวม + ประโยคเปิด (ใช้ทั้ง 2 สาขา) ── */}
      {ins.overview && (
        <div style={{ marginBottom: 12 }}>
          <div style={headSt}>ภาพรวม</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{ins.overview}</div>
        </div>
      )}
      {ins.directLead && (
        <div style={{ marginBottom: 12 }}>
          <div style={headSt}>✍️ ประโยคเปิด</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{ins.directLead}</div>
        </div>
      )}

      {/* ── สาขา ก) คลิปยาวหลายประเด็น ── */}
      {ins.multiTopic ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...headSt, color: '#fbbf24' }}>📚 แยกได้ {ins.totalTopics || ins.topics?.length || 0} ประเด็น (เรียงตามเวลาในคลิป)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(ins.topics || []).map((t, i) => (
              <div key={i} style={{ borderRadius: 10, background: C.sub, border: '1px solid #fbbf2433', padding: '11px 13px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, flex: 1, minWidth: 150 }}>
                    <span style={{ color: '#fbbf24' }}>【{t?.no ?? i + 1}】</span> {t?.title}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {(t?.timeStart || t?.timeEnd) && <span style={{ fontSize: 12, color: C.accent, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>⏱️ {t.timeStart || '?'}–{t.timeEnd || '?'}</span>}
                    <button onClick={() => copy(k('tp-' + i), topicText(t))} style={btn(isCopied(k('tp-' + i)))}>{isCopied(k('tp-' + i)) ? '✓' : '📋'}</button>
                  </div>
                </div>
                {t?.summary && <div style={{ fontSize: 13, lineHeight: 1.75, whiteSpace: 'pre-wrap', marginBottom: 6 }}>{t.summary}</div>}
                {t?.keyPoints?.length > 0 && <ul style={{ margin: '0 0 6px', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7, color: C.muted }}>{t.keyPoints.map((p, j) => <li key={j}>{p}</li>)}</ul>}
                {t?.quotes?.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{t.quotes.map((q, j) => <div key={j} style={quoteSt}>&ldquo;{q}&rdquo;</div>)}</div>}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── สาขา ข) ช่องมาตรฐาน — โชว์ทุกครั้งที่มีข้อมูล (คลิปยาวก็โชว์ ถ้าหลังบ้านส่งมา) ── */}
      {ins.keyPoints?.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={headSt}>🎯 ประเด็นสำคัญ ({ins.keyPoints.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {ins.keyPoints.map((p, i) => (
              <div key={i} style={{ padding: '9px 12px', borderRadius: 9, background: C.sub, borderLeft: `3px solid ${C.accent}` }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{i + 1}. {typeof p === 'string' ? p : p?.point}</div>
                {p?.detail && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4, lineHeight: 1.6 }}>{p.detail}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {ins.quotes?.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={headSt}>💬 คำพูดสำคัญ ({ins.quotes.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {ins.quotes.map((q, i) => <div key={i} style={quoteSt}>&ldquo;{q}&rdquo;</div>)}
          </div>
        </div>
      )}

      {ins.timeline?.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={headSt}>⏱️ ช่วงจังหวะในคลิป</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {ins.timeline.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12.5 }}>
                <span style={{ color: C.accent, fontWeight: 700, minWidth: 84, flexShrink: 0 }}>{t?.time || '—'}</span>
                <span style={{ color: C.muted }}>{t?.topic}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {ins.rawData && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 5 }}>
            <button onClick={() => setRawOpen(!rawOpen)} style={{ ...btn(false), color: C.text }}>
              📄 ข้อมูลดิบรวม {rawOpen ? '▲' : '▼'}
            </button>
            <button onClick={() => copy(k('raw'), ins.rawData)} style={btn(isCopied(k('raw')))}>
              {isCopied(k('raw')) ? '✓' : '📋 คัดลอกก้อนรวม'}
            </button>
          </div>
          {rawOpen && (
            <div style={{ fontSize: 13.5, lineHeight: 1.8, whiteSpace: 'pre-wrap', background: C.sub, borderRadius: 10, padding: 13, maxHeight: 360, overflowY: 'auto' }}>{ins.rawData}</div>
          )}
        </div>
      )}

      {ins.subStories?.length > 0 && (
        <div>
          <div style={{ ...headSt, color: '#fbbf24' }}>🧩 เนื้อดิบแยกประเด็น ({ins.subStories.length}) — แต่ละอันพร้อมเขียนเป็นข่าวเดี่ยว</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ins.subStories.map((s, i) => (
              <div key={i} style={{ border: '1px solid #fbbf2444', borderRadius: 10, padding: 11, background: 'rgba(251,191,36,.04)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                    <span style={{ color: '#fbbf24' }}>ประเด็น {s?.no || i + 1}:</span> {s?.topic}
                    {s?.timeRange && <span style={{ fontSize: 12, color: C.accent, fontFamily: 'monospace', marginLeft: 6 }}>⏱️ {s.timeRange}</span>}
                  </div>
                  <button onClick={() => copy(k('sub-' + i), safeSubText(s, i))} style={btn(isCopied(k('sub-' + i)))}>{isCopied(k('sub-' + i)) ? '✓' : '📋'}</button>
                </div>
                {s?.directLead && <div style={{ fontSize: 12.5, lineHeight: 1.7, color: C.muted, marginBottom: 6 }}>✍️ {s.directLead}</div>}
                {s?.rawData && <div style={{ fontSize: 13, lineHeight: 1.75, whiteSpace: 'pre-wrap', background: C.sub, borderRadius: 8, padding: 11 }}>{s.rawData}</div>}
                {s?.keyPoints?.length > 0 && <ul style={{ margin: '7px 0 0', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7, color: C.muted }}>{s.keyPoints.map((p, j) => <li key={j}>{typeof p === 'string' ? p : p?.point}</li>)}</ul>}
                {s?.quotes?.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>{s.quotes.map((q, j) => <div key={j} style={quoteSt}>&ldquo;{q}&rdquo;</div>)}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
