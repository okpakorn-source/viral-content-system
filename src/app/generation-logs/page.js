'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import EvaluationDashboard from './EvaluationDashboard';

/**
 * Generation Log — คลังผลงานเขียน (redesign 11 มิ.ย. 69)
 * ออกแบบรอบ workflow โต๊ะข่าว: แยก บก.ที่ทำ / แยกแนวข่าว / นับจำนวน / หยิบใช้ไว
 * - การ์ดกดแล้วกางเนื้อทุกเวอร์ชันในที่เดียว + ปุ่มคัดลอกทุกจุด
 * - ปุ่มด่วนบนการ์ด: คัดลอก ว.1 ได้เลยไม่ต้องกาง
 * - สถานะงาน: ยังไม่ตรวจ → ✅ ผ่าน / ❌ ไม่ผ่าน → 📌 ใช้แล้ว (โพสต์จริงแล้ว)
 */

// ── Config ──
const STATUS_CFG = {
  unreviewed: { icon: '⬜', label: 'ยังไม่ตรวจ', color: 'var(--text-muted)' },
  good:       { icon: '✅', label: 'ผ่าน',       color: 'var(--desk-green)' },
  bad:        { icon: '❌', label: 'ไม่ผ่าน',    color: 'var(--desk-red)' },
  used:       { icon: '📌', label: 'ใช้แล้ว',    color: 'var(--desk-purple)' },
};

const LANE_CFG = {
  trend:     { icon: '🔥', label: 'กระแส' },
  good:      { icon: '💚', label: 'น้ำดี' },
  evergreen: { icon: '🌿', label: 'ไร้กาลเวลา' },
  followup:  { icon: '🔁', label: 'ตามต่อ' },
  interview: { icon: '🎙️', label: 'สัมภาษณ์' },
  buzz:      { icon: '📊', label: 'แชร์แรง' },
  other:     { icon: '📰', label: 'ทั่วไป' },
};

// ── Helpers: จัดกลุ่มเคสเข้า บก./แนวข่าว ──
// เคสจากโต๊ะข่าวมีป้าย desk {lane, category, editor, editorIcon} ตรงๆ
// เคสเก่า/เคสจากเว็บ เดาแนวจาก newsType เพื่อให้กรองได้ทั้งคลัง
function editorOf(c) {
  if (c.desk?.editor) return `${c.desk.editorIcon || '🤖'} ${c.desk.editor}`;
  const uid = String(c.userId || '');
  if (uid.startsWith('ai-')) return `🤖 ${uid.slice(3)}`;
  if (uid.startsWith('desk-')) return `👤 ${uid.slice(5)}`;
  if (c.sourceType === 'discord') return '💬 Discord';
  return '🌐 เว็บ/ระบบ';
}

function laneOf(c) {
  if (c.desk?.lane && LANE_CFG[c.desk.lane]) return c.desk.lane;
  const t = `${c.desk?.category || ''} ${c.newsType || ''}`;
  if (/สู้ชีวิต|กุศล|น้ำใจ|ครอบครัว|แรงบันดาลใจ|ความรัก|ศาสนา|ซื่อสัตย์|ช่วยเหลือ|กตัญญู|การศึกษา|สุขภาพ/.test(t)) return 'good';
  if (/อาชญากรรม|ดราม่า|การเมือง|คดี|บันเทิง/.test(t)) return 'trend';
  return 'other';
}

function fmtDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function isToday(iso) {
  if (!iso) return false;
  return new Date(iso).toDateString() === new Date().toDateString();
}

// ══════════════════════════════════════════════════════
export default function GenerationLogsPage() {
  const [cases, setCases]             = useState([]);
  const [stats, setStats]             = useState({ total: 0, today: 0, unreviewed: 0, used: 0 });
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [search, setSearch]           = useState('');
  const [filterEditor, setFilterEditor] = useState('all');
  const [filterLane, setFilterLane]   = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [todayOnly, setTodayOnly]     = useState(false);
  const [expanded, setExpanded]       = useState(null);   // caseId ที่กางอยู่
  const [detail, setDetail]           = useState(null);   // เนื้อเต็มของเคสที่กาง
  const [detailLoading, setDetailLoading] = useState(false);
  const [reviewNote, setReviewNote]   = useState('');
  const [toast, setToast]             = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [renderCap, setRenderCap]     = useState(60);
  const [evalDashboard, setEvalDashboard] = useState(null);
  const [imgScout, setImgScout]       = useState({});   // caseId → ผลแหล่งภาพ
  const [imgScouting, setImgScouting] = useState({});   // caseId → กำลังหา

  const fetchRef = useRef(null);
  const detailCache = useRef({}); // caseId → เนื้อเต็ม (กันโหลดซ้ำตอนกดคัดลอกด่วน)
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  // ── โหลดรายการ (300 เคสล่าสุด — กรอง/นับฝั่งหน้าเว็บทั้งหมด ลื่นกว่ายิง API ทุกคลิก) ──
  const fetchCases = useCallback(async () => {
    try {
      const res = await fetch('/api/generation-logs?limit=300');
      const data = await res.json();
      if (data.success) {
        setCases(data.cases || []);
        setStats(data.stats || { total: 0, today: 0, unreviewed: 0, used: 0 });
        setError(null);
      } else {
        setError(data.error || 'ไม่สามารถโหลดข้อมูลได้');
      }
      setLastUpdated(new Date());
    } catch (e) {
      console.error('Failed to fetch generation logs:', e);
      setError('เชื่อมต่อ API ไม่ได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRef.current = fetchCases; }, [fetchCases]);
  useEffect(() => { const t = setTimeout(() => fetchCases(), 0); return () => clearTimeout(t); }, [fetchCases]);
  useEffect(() => {
    if (!autoRefresh) return;
    const iv = setInterval(() => { if (fetchRef.current) fetchRef.current(); }, 10000);
    return () => clearInterval(iv);
  }, [autoRefresh]);

  // ── เนื้อเต็มของเคส (cache ไว้ — กดคัดลอกด่วนซ้ำไม่ยิง API ใหม่) ──
  const getDetail = useCallback(async (caseId) => {
    if (detailCache.current[caseId]) return detailCache.current[caseId];
    const res = await fetch(`/api/generation-logs/${caseId}`);
    const data = await res.json();
    if (data.success && data.case) {
      detailCache.current[caseId] = data.case;
      return data.case;
    }
    throw new Error(data.error || 'โหลดเคสไม่สำเร็จ');
  }, []);

  const toggleExpand = useCallback(async (caseId) => {
    if (expanded === caseId) { setExpanded(null); setDetail(null); return; }
    setExpanded(caseId);
    setDetail(null);
    setDetailLoading(true);
    try {
      const d = await getDetail(caseId);
      setDetail(d);
      setReviewNote(d.reviewNote || '');
    } catch (e) {
      showToast(`⚠️ ${e.message}`);
      setExpanded(null);
    } finally {
      setDetailLoading(false);
    }
  }, [expanded, getDetail]);

  // ── คัดลอก ──
  const copyText = useCallback((text, label = 'คัดลอกแล้ว') => {
    navigator.clipboard.writeText(text).then(
      () => showToast(`📋 ${label}`),
      () => showToast('⚠️ คัดลอกไม่สำเร็จ')
    );
  }, []);

  const quickCopy = useCallback(async (caseId) => {
    try {
      const d = await getDetail(caseId);
      const v = d.versions?.[0];
      if (!v) { showToast('⚠️ เคสนี้ไม่มีเวอร์ชัน'); return; }
      copyText(`${v.title ? v.title + '\n\n' : ''}${v.content || ''}`, `คัดลอก #${caseId} ว.1 แล้ว`);
    } catch (e) {
      showToast(`⚠️ ${e.message}`);
    }
  }, [getDetail, copyText]);

  // ── หาแหล่งภาพประกอบ — AI วิเคราะห์บริบทข่าว ค้นลิงก์ทุกช่องทาง ──
  const scoutImg = useCallback(async (caseId) => {
    setImgScouting(prev => ({ ...prev, [caseId]: true }));
    showToast('📸 กำลังหาแหล่งภาพ (~1 นาที)...');
    try {
      const res = await fetch('/api/news-desk/image-scout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setImgScout(prev => ({ ...prev, [caseId]: data.imageSources }));
      showToast(`📸 เจอแหล่งภาพ ${data.imageSources.totalLinks} ลิงก์`);
    } catch (e) {
      showToast(`⚠️ ${e.message}`);
    }
    setImgScouting(prev => ({ ...prev, [caseId]: false }));
  }, []);

  // ── อัปเดตสถานะ (✅ ผ่าน / ❌ ไม่ผ่าน / 📌 ใช้แล้ว) ──
  const setStatus = useCallback(async (caseId, status, note) => {
    try {
      const res = await fetch(`/api/generation-logs/${caseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, reviewNote: note ?? undefined }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setCases(prev => prev.map(c => c.caseId === caseId ? { ...c, status, reviewNote: note ?? c.reviewNote } : c));
      if (detailCache.current[caseId]) detailCache.current[caseId] = { ...detailCache.current[caseId], status };
      if (detail?.caseId === caseId) setDetail(prev => ({ ...prev, status }));
      showToast(`${STATUS_CFG[status]?.icon || ''} #${caseId} → ${STATUS_CFG[status]?.label || status}`);
    } catch (e) {
      showToast(`⚠️ ${e.message}`);
    }
  }, [detail]);

  // ── กรอง + นับ ──
  const enriched = useMemo(() => cases.map(c => ({ ...c, _editor: editorOf(c), _lane: laneOf(c) })), [cases]);

  const editorCounts = useMemo(() => {
    const m = {};
    for (const c of enriched) m[c._editor] = (m[c._editor] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [enriched]);

  const laneCounts = useMemo(() => {
    const m = {};
    for (const c of enriched) m[c._lane] = (m[c._lane] || 0) + 1;
    return Object.keys(LANE_CFG).filter(k => m[k]).map(k => [k, m[k]]);
  }, [enriched]);

  const filtered = useMemo(() => {
    let list = enriched;
    if (filterEditor !== 'all') list = list.filter(c => c._editor === filterEditor);
    if (filterLane !== 'all') list = list.filter(c => c._lane === filterLane);
    if (filterStatus !== 'all') list = list.filter(c => c.status === filterStatus);
    if (todayOnly) list = list.filter(c => isToday(c.createdAt));
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      list = list.filter(c =>
        c.caseId?.includes(s) ||
        c.newsTitle?.toLowerCase().includes(s) ||
        (c.desk?.category || c.newsType || '').toLowerCase().includes(s) ||
        c._editor.toLowerCase().includes(s)
      );
    }
    return list;
  }, [enriched, filterEditor, filterLane, filterStatus, todayOnly, search]);

  const chipStyle = (active) => ({
    padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--desk-purple)' : 'var(--border)'}`,
    background: active ? 'rgba(139,92,246,0.15)' : 'transparent',
    color: active ? 'var(--desk-purple)' : 'var(--text-secondary)',
    whiteSpace: 'nowrap',
  });

  const btnStyle = {
    padding: '5px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)',
  };

  // ══════════════════ Render ══════════════════
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px 60px', color: 'var(--text-primary)' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>📋 คลังผลงานเขียน</h1>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Generation Log</span>
        <div style={{ flex: 1 }} />
        <a href="/news-desk" style={{ ...btnStyle, textDecoration: 'none' }}>🗞️ ไปโต๊ะข่าว</a>
        <button onClick={() => setAutoRefresh(v => !v)} style={{ ...btnStyle, color: autoRefresh ? 'var(--desk-green)' : 'var(--text-muted)' }}>
          {autoRefresh ? '🟢 Auto Refresh' : '⏸ หยุดรีเฟรช'}
        </button>
        <button onClick={() => { setLoading(true); fetchCases(); }} style={btnStyle}>🔄 รีเฟรช</button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        งานเขียนทุกชิ้นจากทุกช่องทาง — กดการ์ดเพื่ออ่าน/คัดลอกทุกเวอร์ชันในที่เดียว
        {lastUpdated ? ` • อัปเดต ${lastUpdated.toLocaleTimeString('th-TH')}` : ''}
      </div>

      {/* ── Stats ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          ['📊 ทั้งหมด', stats.total, 'var(--desk-purple)'],
          ['📅 วันนี้', stats.today, 'var(--desk-blue)'],
          ['⬜ ยังไม่ตรวจ', stats.unreviewed, 'var(--desk-amber)'],
          ['📌 หยิบใช้แล้ว', stats.used || 0, 'var(--desk-green)'],
        ].map(([label, val, color]) => (
          <div key={label} style={{ background: 'var(--bg-card)', borderRadius: 12, padding: '12px 16px', borderLeft: `3px solid ${color}` }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* ── แถวกรอง: บก.ที่ทำ ── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, minWidth: 52 }}>คนทำ:</span>
        <button onClick={() => setFilterEditor('all')} style={chipStyle(filterEditor === 'all')}>ทั้งหมด ({enriched.length})</button>
        {editorCounts.map(([ed, n]) => (
          <button key={ed} onClick={() => setFilterEditor(filterEditor === ed ? 'all' : ed)} style={chipStyle(filterEditor === ed)}>
            {ed} ({n})
          </button>
        ))}
      </div>

      {/* ── แถวกรอง: แนวข่าว ── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, minWidth: 52 }}>แนวข่าว:</span>
        <button onClick={() => setFilterLane('all')} style={chipStyle(filterLane === 'all')}>ทั้งหมด</button>
        {laneCounts.map(([lane, n]) => (
          <button key={lane} onClick={() => setFilterLane(filterLane === lane ? 'all' : lane)} style={chipStyle(filterLane === lane)}>
            {LANE_CFG[lane].icon} {LANE_CFG[lane].label} ({n})
          </button>
        ))}
      </div>

      {/* ── ค้นหา + สถานะ + วันนี้ ── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 ค้นหาเลขเคส หัวข้อ หมวด หรือชื่อ บก. ..."
          style={{ flex: '1 1 260px', padding: '9px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
        />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13 }}>
          <option value="all">ทุกสถานะ</option>
          {Object.entries(STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
        <button onClick={() => setTodayOnly(v => !v)} style={chipStyle(todayOnly)}>📅 เฉพาะวันนี้</button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>แสดง {Math.min(filtered.length, renderCap)} / {filtered.length} เคส</span>
      </div>

      {/* ── Error / Loading ── */}
      {error && (
        <div style={{ padding: 14, borderRadius: 10, background: 'rgba(239,68,68,0.1)', color: 'var(--desk-red)', marginBottom: 12, fontSize: 14 }}>
          ⚠️ {error}
        </div>
      )}
      {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>⏳ กำลังโหลด...</div>}

      {/* ── รายการเคส ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.slice(0, renderCap).map(c => {
          const st = STATUS_CFG[c.status] || STATUS_CFG.unreviewed;
          const lane = LANE_CFG[c._lane] || LANE_CFG.other;
          const isOpen = expanded === c.caseId;
          const category = c.desk?.category || c.newsType || '';
          return (
            <div key={c.caseId} style={{ background: 'var(--bg-card)', borderRadius: 12, border: `1px solid ${isOpen ? 'var(--desk-purple)' : 'var(--border)'}`, overflow: 'hidden' }}>

              {/* การ์ดหลัก — กดที่ไหนก็กาง */}
              <div onClick={() => toggleExpand(c.caseId)} style={{ padding: '12px 16px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 800, color: 'var(--desk-purple)', fontSize: 14 }}>#{c.caseId}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, flex: '1 1 300px', lineHeight: 1.45 }}>{c.newsTitle}</span>
                  <span style={{ fontSize: 12, color: st.color, fontWeight: 700, whiteSpace: 'nowrap' }}>{st.icon} {st.label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                  <span style={{ padding: '2px 9px', borderRadius: 999, background: 'rgba(139,92,246,0.1)', fontWeight: 600 }}>{c._editor}</span>
                  <span style={{ padding: '2px 9px', borderRadius: 999, background: 'rgba(59,130,246,0.1)', fontWeight: 600 }}>{lane.icon} {lane.label}</span>
                  {category && <span style={{ color: 'var(--text-muted)' }}>{category}</span>}
                  <span>📝 {c.versionCount} เวอร์ชัน</span>
                  <span>🕐 {fmtDate(c.createdAt)}</span>
                  {c.reviewNote && <span style={{ color: 'var(--desk-amber)' }}>💬 {c.reviewNote.slice(0, 40)}</span>}
                  <div style={{ flex: 1 }} />
                  {/* ปุ่มด่วน — กดได้โดยไม่กางการ์ด */}
                  <button onClick={(e) => { e.stopPropagation(); quickCopy(c.caseId); }} style={btnStyle} title="คัดลอกเวอร์ชันแรกทันที">📋 คัดลอก ว.1</button>
                  {c.status !== 'used' && (
                    <button onClick={(e) => { e.stopPropagation(); setStatus(c.caseId, 'used'); }} style={{ ...btnStyle, color: 'var(--desk-purple)' }} title="หยิบไปโพสต์แล้ว">📌 ใช้แล้ว</button>
                  )}
                  <span style={{ color: 'var(--text-muted)' }}>{isOpen ? '▲' : '▼'}</span>
                </div>
              </div>

              {/* ── กางเนื้อเต็ม ── */}
              {isOpen && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {detailLoading && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>⏳ กำลังโหลดเนื้อเต็ม...</div>}

                  {detail && detail.caseId === c.caseId && (
                    <>
                      {/* แถบเครื่องมือของเคส */}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        {detail.sourceUrl && (
                          <a href={detail.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ ...btnStyle, textDecoration: 'none' }}>🔗 ข่าวต้นทาง</a>
                        )}
                        <button onClick={() => copyText((detail.versions || []).map((v, i) => `── เวอร์ชัน ${i + 1}: ${v.style || ''} ──\n${v.title ? v.title + '\n\n' : ''}${v.content || ''}`).join('\n\n\n'), 'คัดลอกทุกเวอร์ชันแล้ว')} style={btnStyle}>
                          📋 คัดลอกทุกเวอร์ชัน
                        </button>
                        <button onClick={() => setEvalDashboard({ caseId: detail.caseId, newsTitle: detail.newsTitle, versions: detail.versions, sourceText: detail.sourceText })} style={btnStyle}>
                          🧪 ประเมินคุณภาพ
                        </button>
                        <button onClick={() => scoutImg(c.caseId)} disabled={!!imgScouting[c.caseId]} style={{ ...btnStyle, color: 'var(--desk-amber)' }}>
                          {imgScouting[c.caseId] ? '⏳ กำลังหาภาพ...' : '📸 หาแหล่งภาพ'}
                        </button>
                        <a href="/cover-lab" target="_blank" rel="noopener noreferrer" style={{ ...btnStyle, textDecoration: 'none' }} title="เปิด Cover Lab ทำภาพปก">🎨 ไปทำปก</a>
                      </div>

                      {/* แหล่งภาพของข่าวนี้ — ลิงก์จัดกลุ่มตามช่องทาง */}
                      {(imgScout[c.caseId]?.totalLinks > 0 || imgScout[c.caseId]?.photoBoard?.images?.length > 0) && (
                        <div style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.05)' }}>
                          <div style={{ fontSize: 13, color: 'var(--desk-amber)', fontWeight: 700, marginBottom: 4 }}>
                            📸 แหล่งภาพของข่าวนี้ — {imgScout[c.caseId].totalLinks} ลิงก์
                            {imgScout[c.caseId].photoBoard?.images?.length > 0 && <span> · 🖼️ รูปพร้อมใช้ {imgScout[c.caseId].photoBoard.images.length}</span>}
                            <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · {String(imgScout[c.caseId].event || '').slice(0, 70)}</span>
                          </div>
                          {(imgScout[c.caseId].photoBoard?.originPosts || []).map((op, oi) => (
                            <div key={oi} style={{ marginTop: 4, fontSize: 12.5 }}>
                              <a href={op.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--desk-green)', fontWeight: 700, textDecoration: 'none' }}>
                                🏠 ต้นโพสต์: {op.name} — {op.title || op.url}
                              </a>
                            </div>
                          ))}
                          {imgScout[c.caseId].photoBoard?.images?.length > 0 && (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, marginBottom: 4 }}>
                              {imgScout[c.caseId].photoBoard.images.map((p, pi) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <a key={pi} href={p.img} target="_blank" rel="noopener noreferrer" title={p.clean ? 'คนชัด ไม่มีตัวหนังสือ — ใช้ได้เลย' : p.face ? 'มีคน แต่มีตัวหนังสือ (ครอปหลบได้)' : 'ภาพฉาก/ของ'}
                                  style={{ position: 'relative', width: 106, height: 80, borderRadius: 8, overflow: 'hidden', border: p.clean ? '2px solid var(--desk-green)' : '1px solid var(--border)', flexShrink: 0 }}>
                                  <img src={p.img} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                  {p.clean && <span style={{ position: 'absolute', top: 2, right: 3, fontSize: 11 }}>✅</span>}
                                </a>
                              ))}
                            </div>
                          )}
                          {Object.entries({ facebook: '📘 Facebook', images: '🖼️ ภาพจาก Google', news: '📰 เว็บข่าว', youtube: '▶️ YouTube', tiktok: '🎵 TikTok', instagram: '📷 Instagram' })
                            .filter(([k]) => imgScout[c.caseId].channels?.[k]?.length > 0)
                            .map(([k, label]) => (
                              <div key={k} style={{ marginTop: 5 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>{label} ({imgScout[c.caseId].channels[k].length})</div>
                                {imgScout[c.caseId].channels[k].slice(0, 6).map((l, li) => (
                                  <div key={li} style={{ fontSize: 12, marginTop: 2, display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0 }}>
                                    {l.score != null && <span style={{ color: l.score >= 8 ? 'var(--desk-green)' : 'var(--desk-amber)', fontWeight: 700, flexShrink: 0 }}>[{l.score}]</span>}
                                    <a href={l.url} target="_blank" rel="noopener noreferrer"
                                      style={{ color: 'var(--desk-blue)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {l.title || l.url}
                                    </a>
                                  </div>
                                ))}
                              </div>
                            ))}
                        </div>
                      )}

                      {/* เนื้อแต่ละเวอร์ชัน — โชว์เต็ม ไม่ต้องกดต่อ */}
                      {(detail.versions || []).map((v, i) => (
                        <div key={i} style={{ borderRadius: 10, border: '1px solid var(--border)', padding: '12px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                            <span style={{ fontWeight: 800, fontSize: 13, color: 'var(--desk-blue)' }}>เวอร์ชัน {i + 1}{v.style ? ` — ${v.style}` : ''}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{(v.content || '').length.toLocaleString()} ตัวอักษร</span>
                            <div style={{ flex: 1 }} />
                            <button onClick={() => copyText(`${v.title ? v.title + '\n\n' : ''}${v.content || ''}`, `คัดลอก ว.${i + 1} แล้ว`)} style={btnStyle}>📋 คัดลอก</button>
                          </div>
                          {v.title && <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{v.title}</div>}
                          <div style={{ fontSize: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>{v.content}</div>
                        </div>
                      ))}

                      {/* ต้นฉบับ (ย่อ) */}
                      {detail.sourceText && (
                        <details>
                          <summary style={{ fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600 }}>
                            📄 เนื้อข่าวต้นฉบับ ({(detail.sourceTextLength || detail.sourceText.length).toLocaleString()} ตัวอักษร)
                          </summary>
                          <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--text-secondary)', marginTop: 8, padding: '10px 12px', borderRadius: 8, border: '1px dashed var(--border)' }}>
                            {detail.sourceText}
                          </div>
                        </details>
                      )}

                      {/* ตรวจงาน */}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', paddingTop: 4, borderTop: '1px dashed var(--border)' }}>
                        <input
                          value={reviewNote}
                          onChange={e => setReviewNote(e.target.value)}
                          placeholder="โน้ตตรวจงาน (ถ้ามี)..."
                          style={{ flex: '1 1 220px', padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: 13 }}
                        />
                        <button onClick={() => setStatus(c.caseId, 'good', reviewNote)} style={{ ...btnStyle, color: 'var(--desk-green)' }}>✅ ผ่าน</button>
                        <button onClick={() => setStatus(c.caseId, 'bad', reviewNote)} style={{ ...btnStyle, color: 'var(--desk-red)' }}>❌ ไม่ผ่าน</button>
                        <button onClick={() => setStatus(c.caseId, 'used', reviewNote)} style={{ ...btnStyle, color: 'var(--desk-purple)' }}>📌 ใช้แล้ว</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* แสดงเพิ่ม */}
      {filtered.length > renderCap && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button onClick={() => setRenderCap(v => v + 60)} style={{ ...btnStyle, padding: '10px 24px', fontSize: 14 }}>
            แสดงอีก ({filtered.length - renderCap} เคสที่เหลือ)
          </button>
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>ไม่พบเคสตามเงื่อนไขที่กรอง</div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', padding: '10px 22px', borderRadius: 999, background: 'var(--bg-card)', border: '1px solid var(--desk-purple)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, zIndex: 100, boxShadow: '0 4px 24px rgba(0,0,0,0.3)' }}>
          {toast}
        </div>
      )}

      {/* Footer */}
      <div style={{ textAlign: 'center', padding: '32px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
        Generation Log • Viral Content System • {autoRefresh ? '🟢 รีเฟรชอัตโนมัติทุก 10 วินาที' : '⏸ หยุดรีเฟรชอัตโนมัติ'}
      </div>

      {/* Evaluation Dashboard Modal */}
      {evalDashboard && (
        <EvaluationDashboard
          caseId={evalDashboard.caseId}
          newsTitle={evalDashboard.newsTitle}
          versions={evalDashboard.versions}
          sourceText={evalDashboard.sourceText}
          onClose={() => setEvalDashboard(null)}
        />
      )}
    </div>
  );
}
