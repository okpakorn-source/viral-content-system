'use client';

// ============================================================
// 🧾 คลังประวัติรวม — โมดูลที่ 4 ของโต๊ะข่าวกลาง v2 (H1, 17 ก.ค. 69)
// ------------------------------------------------------------
// รวมประวัติของข่าว "ทุกใบ" ไว้ที่เดียว — ไม่ต้องไล่เปิดการ์ดทีละใบ
//   ⏱️ กิจกรรมล่าสุด — flatten ทุก event ของทุกลีดเป็นฟีดเดียว (เรียงใหม่→เก่า)
//   📰 รายข่าว       — ลีดทั้งหมด (รวม dismissed) กางประวัติเต็มด้วย LeadTimeline เดิม
//   📓 รอบล่า         — สมุดบันทึกการล่า (queriesUsed/judgeLog) + ลิงก์กลับไปลีดที่เก็บ
// โหลดครั้งเดียวตอนเปิดแท็บ (ไม่ polling) — ประกอบข้อมูลทั้งหมดฝั่ง client จาก 3 API ที่มีอยู่แล้ว (อ่านอย่างเดียว)
// backend: GET /api/desk/research/leads · GET /api/desk/research/trace · GET /api/desk/content
// ============================================================

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { UI, Btn, Card, Chip, Spinner, apiFetch, fmtNum } from './ui.js';
import LeadTimeline from './LeadTimeline.js';
import HistoryFeedRow, { flattenLeadEvents, HistoryRunRow, PipelineDots, PIPELINE_STAGES, leadStageInfo, fmtRelative } from './HistoryFeedRow.js';

const LEADS_API = '/api/desk/research/leads';
const TRACE_API = '/api/desk/research/trace';
const CONTENT_API = '/api/desk/content';
const PAGE_SIZE = 50;

// ── กลุ่มตัวกรองประเภทเหตุการณ์ (multi-select) — refound พ่วงกับ found, written พ่วงกับ sent ──
const EVENT_FILTERS = [
  { k: 'found', l: '🔎 เจอ', types: ['found', 'refound'] },
  { k: 'judged', l: '⚖️ ตัดสิน', types: ['judged'] },
  { k: 'extracted', l: '🧲 สกัด', types: ['extracted'] },
  { k: 'sent', l: '🚀 ส่ง', types: ['sent', 'written'] },
  { k: 'status', l: 'ℹ️ สถานะ', types: ['status'] },
];
const DATE_RANGES = [
  { k: 'today', l: 'วันนี้' },
  { k: '7d', l: '7 วัน' },
  { k: 'all', l: 'ทั้งหมด' },
];
// ── ป้ายสถานะลีด (ย่อจาก LeadCard.js — ใช้เฉพาะที่นี่ ไม่แก้ไฟล์เดิม) ──
const STATUS_META = {
  new: { label: 'ใหม่', color: UI.blue },
  kept: { label: '⭐ เก็บแล้ว', color: UI.accent },
  sent: { label: '🚀 ส่งคิวแล้ว', color: UI.green },
  dismissed: { label: '🗑 ทิ้งแล้ว', color: UI.muted },
};

const selStyle = {
  minHeight: 40, padding: '6px 10px', borderRadius: 10,
  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  border: '1px solid var(--border-light)', fontSize: 13, fontFamily: 'inherit',
};
const thStyle = { padding: '6px 8px', fontWeight: 700, whiteSpace: 'nowrap' };

function chipBtnStyle(active) {
  return {
    minHeight: 40, padding: '6px 14px', borderRadius: 999, cursor: 'pointer',
    fontSize: 13, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap',
    background: active ? `${UI.accent}22` : 'transparent',
    color: active ? UI.accent : UI.dim,
    border: `1.5px solid ${active ? UI.accent : UI.line}`,
  };
}

// ── เวลาของเหตุการณ์ล่าสุดของลีด (event ท้ายสุดใน timeline) — ใช้เรียงลิสต์ "รายข่าว" ──
function lastEventAt(lead) {
  const tl = Array.isArray(lead?.timeline) ? lead.timeline : [];
  return tl.length ? tl[tl.length - 1]?.at : null;
}

export default function HistoryTab({ onToast }) {
  const [view, setView] = useState('feed'); // 'feed' | 'leads' | 'runs'
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [leads, setLeads] = useState([]);
  const [runs, setRuns] = useState([]);
  const [content, setContent] = useState([]);
  const didInit = useRef(false);

  // ── มุมมองที่ 1: ⏱️ กิจกรรมล่าสุด ──
  const [typeFilter, setTypeFilter] = useState(new Set()); // ว่าง = ทั้งหมด
  const [dateRange, setDateRange] = useState('all');
  const [feedQuery, setFeedQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // ── มุมมองที่ 2: 📰 รายข่าว ──
  const [leadStatusFilter, setLeadStatusFilter] = useState('');
  const [leadClusterFilter, setLeadClusterFilter] = useState('');
  const [leadQuery, setLeadQuery] = useState('');
  const [leadSort, setLeadSort] = useState('recent'); // 'recent' | 'score' | 'stage'
  const [expandedLeadIds, setExpandedLeadIds] = useState(new Set());
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const leadRefs = useRef({});

  // ── มุมมองที่ 3: 📓 รอบล่า ──
  const [expandedRunId, setExpandedRunId] = useState('');

  // ── นาฬิกาอ้างอิงสำหรับกรองช่วงเวลา — ตั้งค่าใน effect เท่านั้น (ห้ามเรียก Date.now() ระหว่าง render
  //   ผิดกฎ react-hooks/purity) รีเฟรชทุกครั้งที่โหลด leads ใหม่ ความคลาดเคลื่อนไม่กี่วินาทีไม่กระทบตัวกรองวัน/7วัน ──
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    // เลื่อน setState ออกจาก effect body ตรงๆ (กฎ react-hooks/set-state-in-effect เดียวกับแท็บอื่นในไฟล์นี้)
    const id = setTimeout(() => setNowTick(Date.now()), 0);
    return () => clearTimeout(id);
  }, [leads]);

  // ============================================================
  //  โหลดครั้งเดียวตอนเปิดแท็บ — 3 API ขนานกัน (อ่านอย่างเดียว ไม่มี polling)
  // ============================================================
  const loadAll = useCallback(async () => {
    setLoading(true);
    const [leadsRes, runsRes, contentRes] = await Promise.all([
      apiFetch(`${LEADS_API}?limit=200`),
      apiFetch(`${TRACE_API}?limit=100`),
      apiFetch(`${CONTENT_API}?limit=200`),
    ]);
    setLoading(false);
    setLoaded(true);
    if (leadsRes.success) setLeads(leadsRes.leads || []);
    else onToast?.(leadsRes.error || 'โหลดคลังลีดไม่สำเร็จ', 'err');
    if (runsRes.success) setRuns(runsRes.runs || []);
    else onToast?.(runsRes.error || 'โหลดประวัติรอบล่าไม่สำเร็จ', 'err');
    if (contentRes.success) setContent(contentRes.items || []);
    else onToast?.(contentRes.error || 'โหลดคลังเนื้อไม่สำเร็จ', 'err');
  }, [onToast]);

  useEffect(() => {
    if (didInit.current) return undefined;
    didInit.current = true;
    const id = setTimeout(() => loadAll(), 0);
    return () => clearTimeout(id);
  }, [loadAll]);

  // ── สลับมา "รายข่าว" จากฟีด/รอบล่า → เลื่อนไปหาการ์ดที่เลือกอัตโนมัติ ──
  useEffect(() => {
    if (view !== 'leads' || !selectedLeadId) return undefined;
    const id = setTimeout(() => {
      const node = leadRefs.current[selectedLeadId];
      if (node && node.scrollIntoView) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
    return () => clearTimeout(id);
  }, [view, selectedLeadId]);

  // ============================================================
  //  ประกอบข้อมูลฝั่ง client — derive ทั้งหมดจาก leads/runs/content ที่โหลดมา
  // ============================================================
  const allEvents = useMemo(() => flattenLeadEvents(leads), [leads]);

  const typeCounts = useMemo(() => {
    const c = { found: 0, judged: 0, extracted: 0, sent: 0, status: 0 };
    for (const ev of allEvents) {
      const grp = EVENT_FILTERS.find((f) => f.types.includes(ev.type));
      if (grp) c[grp.k] += 1;
    }
    return c;
  }, [allEvents]);

  // ลีด id → เนื้อที่ harvest แล้ว (ผูกด้วย field leadId ที่ readyContent.js ติดมาให้)
  const contentByLeadId = useMemo(() => {
    const m = new Map();
    for (const item of content) {
      if (!item?.leadId) continue;
      if (!m.has(item.leadId)) m.set(item.leadId, []);
      m.get(item.leadId).push(item);
    }
    return m;
  }, [content]);

  const leadsById = useMemo(() => {
    const m = new Map();
    for (const l of leads) if (l?.id) m.set(l.id, l);
    return m;
  }, [leads]);

  const clusterOpts = useMemo(() => Array.from(
    new Map(leads.filter((l) => l.clusterId).map((l) => [l.clusterId, l.clusterArchetype || l.clusterId])).entries()
  ), [leads]);

  // ── สรุปจำนวนลีดตามสถานะ (โชว์หัวมุมมองรายข่าว — เห็นภาพรวมทันที) ──
  const statusCounts = useMemo(() => {
    const c = { new: 0, kept: 0, sent: 0, dismissed: 0 };
    for (const l of leads) { const s = l.status || 'new'; c[s] = (c[s] || 0) + 1; }
    return c;
  }, [leads]);

  // ── กรองฟีด: ประเภท + ช่วงเวลา + ค้นคำ (หัวข้อลีด) ──
  const filteredEvents = useMemo(() => {
    const rangeMs = dateRange === 'today' ? 86400_000 : dateRange === '7d' ? 86400_000 * 7 : Infinity;
    const q = feedQuery.trim().toLowerCase();
    const activeTypes = typeFilter.size === 0
      ? null
      : new Set(EVENT_FILTERS.filter((f) => typeFilter.has(f.k)).flatMap((f) => f.types));
    return allEvents.filter((ev) => {
      if (activeTypes && !activeTypes.has(ev.type)) return false;
      if (rangeMs !== Infinity) {
        const t = ev.at ? new Date(ev.at).getTime() : 0;
        if (!nowTick || Number.isNaN(t) || nowTick - t > rangeMs) return false;
      }
      if (q && !String(ev.lead?.title || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allEvents, typeFilter, dateRange, feedQuery, nowTick]);

  const visibleEvents = filteredEvents.slice(0, visibleCount);

  // ── กรอง "รายข่าว": สถานะ + คลัสเตอร์ + ค้นคำ → เรียงเหตุการณ์ล่าสุดก่อน ──
  const filteredLeads = useMemo(() => {
    const q = leadQuery.trim().toLowerCase();
    const byRecent = (a, b) => new Date(lastEventAt(b) || b.savedAt || 0) - new Date(lastEventAt(a) || a.savedAt || 0);
    const list = leads
      .filter((l) => (leadStatusFilter ? (l.status || 'new') === leadStatusFilter : true))
      .filter((l) => (leadClusterFilter ? l.clusterId === leadClusterFilter : true))
      .filter((l) => (q ? String(l.title || '').toLowerCase().includes(q) : true))
      .slice();
    if (leadSort === 'score') {
      list.sort((a, b) => (Number(b.matchScore) || 0) - (Number(a.matchScore) || 0) || byRecent(a, b));
    } else if (leadSort === 'stage') {
      list.sort((a, b) => leadStageInfo(b).reachedCount - leadStageInfo(a).reachedCount || byRecent(a, b));
    } else {
      list.sort(byRecent); // 'recent' (default) — เหตุการณ์ล่าสุดก่อน
    }
    return list;
  }, [leads, leadStatusFilter, leadClusterFilter, leadQuery, leadSort]);

  function toggleTypeFilter(k) {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  // ── คลิกหัวข้อลีดจากฟีด/รอบล่า → สลับไปมุมมองรายข่าว + กางประวัติใบนั้นให้เลย ──
  function openLeadInLeadsView(lead) {
    if (!lead?.id) return;
    setLeadStatusFilter('');
    setLeadClusterFilter('');
    setLeadQuery('');
    setExpandedLeadIds((prev) => new Set(prev).add(lead.id));
    setSelectedLeadId(lead.id);
    setView('leads');
  }

  function toggleLeadExpand(id) {
    setExpandedLeadIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (loading && !loaded) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: 40, color: UI.dim }}><Spinner size={20} /> กำลังโหลดคลังประวัติ…</div>
      </Card>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* แท็บมุมมองย่อย 3 มุม + ปุ่มรีเฟรช */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { k: 'feed', l: '⏱️ กิจกรรมล่าสุด' },
          { k: 'leads', l: '📰 รายข่าว' },
          { k: 'runs', l: '📓 รอบล่า' },
        ].map((t) => (
          <button key={t.k} type="button" onClick={() => setView(t.k)} style={{
            minHeight: 44, padding: '8px 18px', borderRadius: 12, cursor: 'pointer',
            fontSize: 14, fontWeight: 800, fontFamily: 'inherit', whiteSpace: 'nowrap',
            background: view === t.k ? UI.card : 'transparent',
            color: view === t.k ? UI.text : UI.dim,
            border: `1.5px solid ${view === t.k ? UI.line2 : 'transparent'}`,
          }}>{t.l}</button>
        ))}
        <Btn variant="subtle" busy={loading} disabled={loading} onClick={loadAll} style={{ marginLeft: 'auto', minHeight: 40, padding: '6px 14px', fontSize: 12.5 }}>↻ รีเฟรช</Btn>
      </div>

      {/* แถบสรุปกิจกรรมทั้งระบบ (คงที่ทุกมุมมอง) */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Chip color={UI.text}>ลีดทั้งหมด {fmtNum(leads.length)}</Chip>
        <Chip color={UI.blue}>🔎 เจอ {fmtNum(typeCounts.found)}</Chip>
        <Chip color={UI.amber}>⚖️ ตัดสิน {fmtNum(typeCounts.judged)}</Chip>
        <Chip color={UI.accent}>🧲 สกัด {fmtNum(typeCounts.extracted)}</Chip>
        <Chip color={UI.green}>🚀 ส่ง {fmtNum(typeCounts.sent)}</Chip>
      </div>

      {/* ── มุมมองที่ 1: ⏱️ กิจกรรมล่าสุด ── */}
      {view === 'feed' && (
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setTypeFilter(new Set())} style={chipBtnStyle(typeFilter.size === 0)}>ทั้งหมด</button>
              {EVENT_FILTERS.map((f) => (
                <button key={f.k} type="button" onClick={() => toggleTypeFilter(f.k)} style={chipBtnStyle(typeFilter.has(f.k))}>{f.l}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {DATE_RANGES.map((r) => (
                  <button key={r.k} type="button" onClick={() => setDateRange(r.k)} style={chipBtnStyle(dateRange === r.k)}>{r.l}</button>
                ))}
              </div>
              <input
                value={feedQuery}
                onChange={(e) => { setFeedQuery(e.target.value); setVisibleCount(PAGE_SIZE); }}
                placeholder="ค้นหัวข้อลีด…"
                style={{ ...selStyle, flex: '1 1 200px', minWidth: 160 }}
              />
            </div>
          </div>

          {filteredEvents.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 30, color: UI.muted, fontSize: 13 }}>ไม่มีเหตุการณ์ตามตัวกรองนี้</div>
          ) : (
            <>
              <div style={{ fontSize: 12.5, color: UI.dim, marginBottom: 10 }}>
                พบ {fmtNum(filteredEvents.length)} เหตุการณ์ — แสดง {fmtNum(visibleEvents.length)} รายการ
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {visibleEvents.map((ev, i) => (
                  <HistoryFeedRow key={`${ev.lead?.id || 'x'}-${i}-${ev.at || ''}`} event={ev} onOpenLead={openLeadInLeadsView} />
                ))}
              </div>
              {visibleCount < filteredEvents.length && (
                <div style={{ textAlign: 'center', marginTop: 12 }}>
                  <Btn variant="subtle" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)} style={{ minHeight: 44, padding: '10px 24px' }}>
                    โหลดเพิ่ม ({fmtNum(filteredEvents.length - visibleCount)} เหลือ)
                  </Btn>
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {/* ── มุมมองที่ 2: 📰 รายข่าว ── */}
      {view === 'leads' && (
        <Card>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <select value={leadStatusFilter} onChange={(e) => setLeadStatusFilter(e.target.value)} style={selStyle}>
              <option value="">ทุกสถานะ</option>
              <option value="new">ใหม่</option>
              <option value="kept">เก็บ</option>
              <option value="sent">ส่งแล้ว</option>
              <option value="dismissed">ทิ้ง</option>
            </select>
            <select value={leadClusterFilter} onChange={(e) => setLeadClusterFilter(e.target.value)} style={selStyle}>
              <option value="">ทุกคลัสเตอร์</option>
              {clusterOpts.map(([id, name]) => <option key={id} value={id}>{String(name).slice(0, 40)}</option>)}
            </select>
            <input
              value={leadQuery}
              onChange={(e) => setLeadQuery(e.target.value)}
              placeholder="ค้นหัวข้อข่าว…"
              style={{ ...selStyle, flex: '1 1 200px', minWidth: 160 }}
            />
            <select value={leadSort} onChange={(e) => setLeadSort(e.target.value)} style={selStyle} title="เรียงลำดับ">
              <option value="recent">↕ ล่าสุด</option>
              <option value="score">↕ คะแนนสูง</option>
              <option value="stage">↕ คืบหน้ามาก</option>
            </select>
          </div>

          {/* สรุปจำนวนลีดตามสถานะ — เห็นภาพรวมทันทีก่อนไล่ลิสต์ */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <Chip color={UI.blue}>ใหม่ {fmtNum(statusCounts.new)}</Chip>
            <Chip color={UI.accent}>⭐ เก็บ {fmtNum(statusCounts.kept)}</Chip>
            <Chip color={UI.green}>🚀 ส่งแล้ว {fmtNum(statusCounts.sent)}</Chip>
            <Chip color={UI.muted}>🗑 ทิ้ง {fmtNum(statusCounts.dismissed)}</Chip>
          </div>

          {filteredLeads.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 30, color: UI.muted, fontSize: 13 }}>ไม่มีลีดตามตัวกรองนี้</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, fontSize: 12, color: UI.dim }}>
                <span style={{ fontWeight: 700 }}>พบ {fmtNum(filteredLeads.length)} ลีด</span>
                <span style={{ color: UI.muted }}>· แถบสายงาน:</span>
                {PIPELINE_STAGES.map((s) => <span key={s.k} style={{ color: UI.muted }}>{s.icon}{s.label}</span>)}
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {filteredLeads.map((lead) => {
                  const sm = STATUS_META[lead.status || 'new'];
                  const isOpen = expandedLeadIds.has(lead.id);
                  const contentN = (contentByLeadId.get(lead.id) || []).length;
                  const stage = leadStageInfo(lead, contentN);
                  const isSelected = selectedLeadId === lead.id;
                  const retired = (Number(lead.sendAttempts) || 0) >= 3;
                  const score = Math.round(Number(lead.matchScore) || 0);
                  return (
                    <div
                      key={lead.id}
                      ref={(node) => { leadRefs.current[lead.id] = node; }}
                      style={{
                        background: isSelected ? `${UI.accent}11` : UI.card2,
                        border: `1px solid ${isSelected ? UI.accent : UI.line}`,
                        borderRadius: 10, padding: '9px 11px', display: 'grid', gap: 6,
                      }}
                    >
                      {/* บรรทัด 1 — กดทั้งแถวเพื่อกาง/ย่อ: คะแนน + แถบสายงาน + หัวข้อ (ตัดบรรทัดเดียว) + ลูกศร */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleLeadExpand(lead.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleLeadExpand(lead.id); } }}
                        style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}
                        title="กดเพื่อกาง/ย่อประวัติเต็ม"
                      >
                        <span style={{
                          flex: 'none', minWidth: 42, padding: '2px 7px', borderRadius: 999,
                          fontSize: 12, fontWeight: 900, textAlign: 'center',
                          background: `${UI.blue}22`, color: UI.blue, border: `1px solid ${UI.blue}`,
                        }}>{score}%</span>
                        <PipelineDots reached={stage.reached} />
                        <span style={{
                          flex: '1 1 auto', minWidth: 0, fontSize: 13, fontWeight: 700, color: UI.text,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }} title={lead.title || ''}>{String(lead.title || '(ไม่มีหัวข้อ)')}</span>
                        <span style={{ flex: 'none', color: UI.muted, fontSize: 12 }}>{isOpen ? '▲' : '▼'}</span>
                      </div>
                      {/* บรรทัด 2 — meta: สถานะ · ป้ายปัญหา · แหล่ง · คลัสเตอร์ · เวลาล่าสุด · เวอร์ชัน */}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, color: UI.muted }}>
                        {sm && <Chip color={sm.color}>{sm.label}</Chip>}
                        {retired && <Chip color={UI.red}>⛔ พักอัตโนมัติ</Chip>}
                        {lead.sourceHost && <span>{String(lead.sourceHost).slice(0, 30)}</span>}
                        {lead.clusterArchetype && <span>· {String(lead.clusterArchetype).slice(0, 26)}</span>}
                        <span>· ⏱ {fmtRelative(stage.lastAt)}</span>
                        {contentN > 0 && <Chip color={UI.green}>📚 {fmtNum(contentN)} เวอร์ชัน</Chip>}
                      </div>
                      {isOpen && <LeadTimeline lead={lead} />}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>
      )}

      {/* ── มุมมองที่ 3: 📓 รอบล่า ── */}
      {view === 'runs' && (
        <Card>
          {runs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 30, color: UI.muted, fontSize: 13 }}>ยังไม่มีประวัติรอบล่า</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 640 }}>
                <thead>
                  <tr style={{ color: UI.muted, textAlign: 'left' }}>
                    <th style={thStyle}>เวลา</th>
                    <th style={thStyle}>คลัสเตอร์</th>
                    <th style={thStyle}>คีย์</th>
                    <th style={thStyle}>เจอ</th>
                    <th style={thStyle}>เก็บ</th>
                    <th style={thStyle}>ตัดทิ้ง</th>
                    <th style={thStyle}>฿</th>
                    <th style={thStyle}>วินาที</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const found = (run.queriesUsed || []).reduce((sum, q) => sum + (Number(q.found) || 0), 0);
                    const cut = (run.judgeLog || []).length;
                    const isOpen = expandedRunId === run.runId;
                    const savedTitles = (run.savedLeadIds || []).map((id) => leadsById.get(id)).filter(Boolean);
                    return (
                      <HistoryRunRow
                        key={run.runId}
                        run={run} found={found} cut={cut} isOpen={isOpen}
                        savedTitles={savedTitles}
                        onToggle={() => setExpandedRunId(isOpen ? '' : run.runId)}
                        onOpenLead={openLeadInLeadsView}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
