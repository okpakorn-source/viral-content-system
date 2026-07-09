'use client';

// ============================================================
// 📚 /cover-techniques — คลังเทคนิคปกแสนไลค์ (19 ใบวิเคราะห์ + กติกาสังเคราะห์)
// ------------------------------------------------------------
// อ่าน data/cover-technique-library.json ผ่าน /api/cover-techniques
// สไลด์ดูปกทีละใบ (ปัดซ้าย-ขวาบนมือถือ) + กติกา 23 ข้อ + ห้ามทำ 13 ข้อ + ภาพรวม
// public route (ดู AuthGuard.js + ClientLayout.js) — 10 ก.ค. 2026
// ============================================================

import { useState, useEffect, useRef } from 'react';

const C = {
  bg: '#0f1226', card: '#191d38', card2: '#20244a', line: '#2c3160',
  text: '#eef1ff', dim: '#9aa0c8', accent: '#6d5cf5', accent2: '#f6339a',
  green: '#22c55e', amber: '#f59e0b', red: '#ef4444',
};

const TABS = [
  { key: 'covers', label: '🖼️ ปก 19 ใบ' },
  { key: 'principles', label: '📏 กติกา' },
  { key: 'antiPatterns', label: '🚫 ห้ามทำ' },
  { key: 'overview', label: '🧭 ภาพรวม' },
];

const pillStyle = { fontSize: 12, color: C.dim, textDecoration: 'none', border: `1px solid ${C.line}`, borderRadius: 999, padding: '5px 12px' };

export default function CoverTechniquesPage() {
  const [library, setLibrary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState(0);
  const [idx, setIdx] = useState(0); // สไลด์ปกใบที่เท่าไหร่
  const [openSections, setOpenSections] = useState({ layout: false, panels: false, gaze: false, context: false, techniques: false });

  const touchX = useRef(null);

  function fetchLibraryData() {
    return fetch('/api/cover-techniques').then((r) => r.json());
  }

  // ปุ่ม "ลองใหม่" — เรียกจาก event handler เท่านั้น (ไม่ใช่จาก effect) จึง setState สดได้ตรงๆ
  function loadLibrary() {
    setLoading(true);
    setErr('');
    fetchLibraryData()
      .then((d) => {
        if (d.success) setLibrary(d.library);
        else setErr(d.error || 'โหลดคลังไม่สำเร็จ');
      })
      .catch((e) => setErr('เรียก API ล้ม: ' + e.message))
      .finally(() => setLoading(false));
  }

  // โหลดตอน mount — setState เกิดใน callback ของ promise เท่านั้น (ไม่ sync ใน effect body)
  useEffect(() => {
    let cancelled = false;
    fetchLibraryData()
      .then((d) => {
        if (cancelled) return;
        if (d.success) setLibrary(d.library);
        else setErr(d.error || 'โหลดคลังไม่สำเร็จ');
      })
      .catch((e) => { if (!cancelled) setErr('เรียก API ล้ม: ' + e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const covers = library?.covers || [];
  const synthesis = library?.synthesis || {};
  const cover = covers[idx] || {};

  const toggleSection = (key) => setOpenSections((s) => ({ ...s, [key]: !s[key] }));
  const goCover = (delta) => setIdx((i) => Math.max(0, Math.min(covers.length - 1, i + delta)));

  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 60) goCover(dx < 0 ? 1 : -1);
    touchX.current = null;
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '14px 14px 60px', boxSizing: 'border-box' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 18, fontWeight: 900 }}>📚 คลังเทคนิคปกแสนไลค์</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <a href="/quick-cover" style={pillStyle}>📱 เทสปกเร็ว</a>
            <a href="/mega" style={pillStyle}>🏭 MEGA</a>
          </div>
        </div>

        {/* tab stepper */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {TABS.map((t, i) => (
            <button key={t.key} onClick={() => setTab(i)}
              style={{ flex: 1, padding: '8px 2px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 800,
                background: tab === i ? C.accent : C.card, color: tab === i ? '#fff' : C.dim }}>
              {t.label}
            </button>
          ))}
        </div>

        {loading && (
          <div style={{ padding: 40, textAlign: 'center', color: C.dim, fontSize: 13 }}>⏳ กำลังโหลดคลัง...</div>
        )}

        {!loading && err && (
          <div style={{ padding: 16, background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.4)', borderRadius: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: '#fca5a5', marginBottom: 10 }}>{err}</div>
            <button onClick={loadLibrary} style={{ padding: '8px 18px', borderRadius: 10, border: 'none', background: C.accent, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>↻ ลองใหม่</button>
          </div>
        )}

        {!loading && !err && library && (
          <>
            {tab === 0 && (
              <CoversTab
                covers={covers} idx={idx} cover={cover}
                goCover={goCover} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
                openSections={openSections} toggleSection={toggleSection}
              />
            )}
            {tab === 1 && <PrinciplesTab principles={synthesis.principles} />}
            {tab === 2 && <AntiPatternsTab antiPatterns={synthesis.antiPatterns} />}
            {tab === 3 && <OverviewTab library={library} synthesis={synthesis} />}
          </>
        )}
      </div>

      <style>{`@keyframes qcIn{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}

// ============================================================
// Tab 1: ปกรายใบ (สไลด์)
// ============================================================
function CoversTab({ covers, idx, cover, goCover, onTouchStart, onTouchEnd, openSections, toggleSection }) {
  if (!covers.length) {
    return <div style={{ padding: 24, textAlign: 'center', color: C.dim, fontSize: 13 }}>ยังไม่มีข้อมูลปกในคลัง</div>;
  }
  const panels = Array.isArray(cover.panels) ? cover.panels : [];
  const techniques = Array.isArray(cover.techniques) ? cover.techniques : [];

  return (
    <div>
      {/* nav row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
        <button onClick={() => goCover(-1)} disabled={idx === 0}
          style={{ width: 44, height: 44, borderRadius: 12, border: `1px solid ${C.line}`, background: C.card, color: idx === 0 ? C.dim : C.text, fontSize: 18, cursor: idx === 0 ? 'default' : 'pointer', flexShrink: 0, opacity: idx === 0 ? 0.5 : 1 }}>◀</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13.5, fontWeight: 800 }}>ใบที่ {idx + 1}/{covers.length}</div>
          <div style={{ fontSize: 11, color: C.dim }}>{cover.refId || '—'}</div>
        </div>
        <button onClick={() => goCover(1)} disabled={idx === covers.length - 1}
          style={{ width: 44, height: 44, borderRadius: 12, border: `1px solid ${C.line}`, background: C.card, color: idx === covers.length - 1 ? C.dim : C.text, fontSize: 18, cursor: idx === covers.length - 1 ? 'default' : 'pointer', flexShrink: 0, opacity: idx === covers.length - 1 ? 0.5 : 1 }}>▶</button>
      </div>

      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} key={idx} style={{ animation: 'qcIn .22s ease' }}>
        {cover.imagePath && (
          <a href={cover.imagePath} target="_blank" rel="noopener noreferrer">
            <img src={cover.imagePath} alt={cover.refId || 'ปก'} style={{ width: '100%', display: 'block', borderRadius: 12, border: `1px solid ${C.line}` }} />
          </a>
        )}

        {cover.story && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: C.dim, marginBottom: 4 }}>📖 เรื่องราว</div>
            <p style={{ fontSize: 13.5, lineHeight: 1.8, color: C.text, margin: 0 }}>{cover.story}</p>
          </div>
        )}

        {cover.whyViral && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: 'rgba(34,197,94,.10)', border: '1px solid rgba(34,197,94,.4)' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: C.green, marginBottom: 4 }}>🔥 ทำไมถึงไวรัล</div>
            <p style={{ fontSize: 13, lineHeight: 1.75, color: C.text, margin: 0 }}>{cover.whyViral}</p>
          </div>
        )}

        {cover.layout && (
          <Collapsible title="🧩 โครงจัดวาง" open={openSections.layout} onToggle={() => toggleSection('layout')}>
            <p style={{ fontSize: 12.5, lineHeight: 1.8, color: C.text, margin: 0 }}>{cover.layout}</p>
          </Collapsible>
        )}

        {panels.length > 0 && (
          <Collapsible title={`🔲 ช่องภาพ (${panels.length} ช่อง)`} open={openSections.panels} onToggle={() => toggleSection('panels')}>
            {panels.map((p, i) => <PanelCard key={i} panel={p} index={i} />)}
          </Collapsible>
        )}

        {(cover.hierarchy || cover.gazeFlow) && (
          <Collapsible title="👁️ ลำดับสายตา" open={openSections.gaze} onToggle={() => toggleSection('gaze')}>
            {cover.hierarchy && <ParaBlock label="ลำดับความสำคัญ" text={cover.hierarchy} />}
            {cover.gazeFlow && <ParaBlock label="เส้นทางสายตา" text={cover.gazeFlow} />}
          </Collapsible>
        )}

        {cover.contextHandling && (
          <Collapsible title="📎 การเล่าบริบท/หลักฐาน" open={openSections.context} onToggle={() => toggleSection('context')}>
            <p style={{ fontSize: 12.5, lineHeight: 1.8, color: C.text, margin: 0 }}>{cover.contextHandling}</p>
          </Collapsible>
        )}

        {techniques.length > 0 && (
          <Collapsible title={`🛠️ เทคนิคเด่น (${techniques.length})`} open={openSections.techniques} onToggle={() => toggleSection('techniques')}>
            {techniques.map((t, i) => <TechniqueCard key={i} t={t} last={i === techniques.length - 1} />)}
          </Collapsible>
        )}
      </div>
    </div>
  );
}

function Collapsible({ title, open, onToggle, children }) {
  return (
    <div style={{ marginTop: 10, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden' }}>
      <button onClick={onToggle}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', color: C.text, fontSize: 13.5, fontWeight: 800, textAlign: 'left', fontFamily: 'inherit' }}>
        <span>{title}</span>
        <span style={{ color: C.dim, fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding: '0 14px 14px' }}>{children}</div>}
    </div>
  );
}

function Chip({ text, color, bg }) {
  return <span style={{ fontSize: 10.5, fontWeight: 800, color, background: bg || C.card2, borderRadius: 999, padding: '2px 8px', border: `1px solid ${C.line}` }}>{text}</span>;
}

function PanelCard({ panel, index }) {
  const p = panel || {};
  const facePct = p.faceSharePct;
  const amber = typeof facePct === 'number' && facePct >= 44;
  return (
    <div style={{ marginBottom: 10, padding: 10, background: C.card2, borderRadius: 10, border: `1px solid ${C.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: C.dim }}>ช่อง {index + 1}</span>
        {p.shot && <Chip text={p.shot} color={C.accent} />}
        {facePct != null && <Chip text={`หน้า ${facePct}%`} color={amber ? C.amber : C.dim} bg={amber ? 'rgba(245,158,11,.15)' : C.card} />}
      </div>
      {p.position && <PanelLine label="ตำแหน่ง" value={p.position} />}
      {p.subject && <PanelLine label="ตัวแบบ" value={p.subject} />}
      {p.crop && <PanelLine label="ครอป" value={p.crop} />}
      {p.zoom && <PanelLine label="ซูม" value={p.zoom} />}
      {p.background && <PanelLine label="พื้นหลัง" value={p.background} />}
      {p.function && <div style={{ fontSize: 12.5, color: C.text, fontWeight: 700, marginTop: 6 }}>▶ {p.function}</div>}
    </div>
  );
}
function PanelLine({ label, value }) {
  return <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.65, marginBottom: 2 }}><b style={{ color: C.dim }}>{label}:</b> {value}</div>;
}

function ParaBlock({ label, text }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: C.dim, marginBottom: 3 }}>{label}</div>
      <p style={{ fontSize: 12.5, lineHeight: 1.75, color: C.text, margin: 0 }}>{text}</p>
    </div>
  );
}

function TechniqueCard({ t, last }) {
  const item = t || {};
  return (
    <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: last ? 'none' : `1px solid ${C.line}` }}>
      {item.name && <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 3 }}>{item.name}</div>}
      {item.detail && <p style={{ fontSize: 12.5, color: C.text, lineHeight: 1.7, margin: '0 0 4px' }}>{item.detail}</p>}
      {item.why && <p style={{ fontSize: 12, color: C.dim, fontStyle: 'italic', lineHeight: 1.6, margin: 0 }}>เหตุผล: {item.why}</p>}
    </div>
  );
}

// ============================================================
// Tab 2: กติกา (23 principles, จัดกลุ่มตาม category)
// ============================================================
const CATEGORY_LABELS = {
  crop: 'ครอป (Crop)', zoom: 'ซูม/ขนาดหน้า (Zoom)', layout: 'ผังจัดวาง (Layout)',
  hierarchy: 'ลำดับความสำคัญ (Hierarchy)', circle: 'วงกลม (Circle)', evidence: 'หลักฐาน (Evidence)',
  context: 'บริบท (Context)', gaze: 'สายตา (Gaze)', color: 'สี (Color)', other: 'อื่นๆ',
};
function categoryLabel(cat) { return CATEGORY_LABELS[cat] || cat; }

function groupByCategory(principles) {
  const order = [];
  const map = {};
  (principles || []).forEach((p) => {
    const cat = p?.category || 'other';
    if (!map[cat]) { map[cat] = []; order.push(cat); }
    map[cat].push(p);
  });
  return order.map((cat) => ({ category: cat, items: map[cat] }));
}

function PrinciplesTab({ principles }) {
  const groups = groupByCategory(principles);
  if (!groups.length) return <div style={{ padding: 24, textAlign: 'center', color: C.dim, fontSize: 13 }}>ยังไม่มีกติกาในคลัง</div>;
  return (
    <div>
      {groups.map((g) => (
        <div key={g.category} style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 900, color: C.dim, textTransform: 'uppercase', letterSpacing: 0.5 }}>{categoryLabel(g.category)}</span>
            <span style={{ fontSize: 10.5, color: C.dim, background: C.card2, borderRadius: 999, padding: '1px 8px' }}>{g.items.length}</span>
          </div>
          {g.items.map((p, i) => <PrincipleCard key={p?.id || i} principle={p} />)}
        </div>
      ))}
    </div>
  );
}

function PrincipleCard({ principle }) {
  const [showEx, setShowEx] = useState(false);
  const p = principle || {};
  const examples = Array.isArray(p.examples) ? p.examples : [];
  return (
    <div style={{ marginBottom: 10, padding: 12, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        {p.id && <span style={{ fontSize: 10, fontFamily: 'monospace', color: C.dim, background: C.card2, borderRadius: 6, padding: '2px 6px' }}>{p.id}</span>}
        <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>{p.name}</span>
      </div>
      {p.rule && <p style={{ fontSize: 12.5, lineHeight: 1.75, color: C.text, margin: '0 0 8px' }}>{p.rule}</p>}
      {examples.length > 0 && (
        <div>
          <button onClick={() => setShowEx((s) => !s)}
            style={{ fontSize: 11.5, color: C.accent, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700, fontFamily: 'inherit' }}>
            {showEx ? '▲' : '▼'} ดูตัวอย่าง ({examples.length})
          </button>
          {showEx && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {examples.map((ex, i) => <li key={i} style={{ fontSize: 12, color: C.dim, lineHeight: 1.7, marginBottom: 2 }}>{ex}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Tab 3: ห้ามทำ (anti-patterns)
// ============================================================
function AntiPatternsTab({ antiPatterns }) {
  const items = Array.isArray(antiPatterns) ? antiPatterns : [];
  if (!items.length) return <div style={{ padding: 24, textAlign: 'center', color: C.dim, fontSize: 13 }}>ยังไม่มีข้อมูล</div>;
  return (
    <div>
      <p style={{ fontSize: 12.5, color: C.dim, marginBottom: 12, lineHeight: 1.7 }}>รูปแบบที่ไม่พบเลยใน 19 ใบ — สิ่งที่ระบบต้องหลีกเลี่ยง</p>
      {items.map((text, i) => (
        <div key={i} style={{ marginBottom: 10, padding: 12, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.35)', borderRadius: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#f87171' }}>⛔ {i + 1}.</span>{' '}
          <span style={{ fontSize: 12.5, color: C.text, lineHeight: 1.7 }}>{text}</span>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Tab 4: ภาพรวม (summary + panelNorms + meta)
// ============================================================
const PANEL_NORM_LABELS = {
  hero: '🦸 Hero', secondary: '🙋 Secondary', circle: '⭕ Circle', evidence: '🔍 Evidence', context: '🌍 Context',
};
function panelNormLabel(key) { return PANEL_NORM_LABELS[key] || key; }

function formatThaiDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return iso;
  }
}

function OverviewTab({ library, synthesis }) {
  const lib = library || {};
  const panelNorms = synthesis?.panelNorms || {};
  return (
    <div>
      {synthesis?.summary && (
        <div style={{ padding: 14, background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.accent, marginBottom: 6 }}>🧭 สรุปภาพรวม</div>
          <p style={{ fontSize: 13, lineHeight: 1.85, color: C.text, margin: 0 }}>{synthesis.summary}</p>
        </div>
      )}

      {Object.entries(panelNorms).map(([key, text]) => (
        <div key={key} style={{ marginBottom: 10, padding: 12, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 900, color: key === 'hero' ? C.amber : C.accent, marginBottom: 4 }}>{panelNormLabel(key)}</div>
          <p style={{ fontSize: 12, lineHeight: 1.75, color: C.dim, margin: 0 }}>{text}</p>
        </div>
      ))}

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}`, fontSize: 11.5, color: C.dim, lineHeight: 2 }}>
        {lib.studiedAt && <div>ศึกษาเมื่อ: {formatThaiDate(lib.studiedAt)}</div>}
        {lib.sourceFolder && <div>โฟลเดอร์ต้นทาง: {lib.sourceFolder}</div>}
        {lib.note && <div>หมายเหตุ: {lib.note}</div>}
        {lib.version != null && <div>เวอร์ชัน: {lib.version}</div>}
      </div>
    </div>
  );
}
