'use client';
import { useState, useCallback, useMemo } from 'react';

// ── Score color helper ──
function scoreColor(val) {
  if (val >= 75) return '#22c55e';
  if (val >= 50) return '#f59e0b';
  return '#ef4444';
}

function scoreBg(val) {
  if (val >= 75) return 'rgba(34,197,94,0.12)';
  if (val >= 50) return 'rgba(245,158,11,0.12)';
  return 'rgba(239,68,68,0.12)';
}

const STATUS_STYLES = {
  READY:            { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  label: 'พร้อมโพสต์' },
  NEEDS_MINOR_EDIT: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'แก้เล็กน้อย' },
  NEEDS_MAJOR_EDIT: { color: '#f97316', bg: 'rgba(249,115,22,0.12)', label: 'แก้มาก' },
  REJECT:           { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  label: 'ไม่ผ่าน' },
};

const SCORE_LABELS = {
  accuracy: 'Acc',
  completeness: 'Comp',
  readability: 'Read',
  viralPotential: 'Viral',
  originality: 'Orig',
  safety: 'Safe',
  publishReadiness: 'Pub',
};

const SCORE_FULL_LABELS = {
  accuracy: 'ความถูกต้อง',
  completeness: 'ครบถ้วน',
  readability: 'อ่านง่าย',
  viralPotential: 'ไวรัล',
  originality: 'ความต่าง',
  safety: 'ปลอดภัย',
  publishReadiness: 'พร้อมโพสต์',
};

const TABS = [
  { key: 'scores', label: '📊 คะแนน', icon: '📊' },
  { key: 'compare', label: '⚖️ เปรียบเทียบ', icon: '⚖️' },
  { key: 'original', label: '📰 ต้นฉบับ vs เลือก', icon: '📰' },
  { key: 'recommendation', label: '🤖 คำแนะนำ AI', icon: '🤖' },
];

function truncate(str, len = 80) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '…' : str;
}

// ══════════════════════════════════════════════════════
//  Evaluation Dashboard — Article Evaluation Modal
// ══════════════════════════════════════════════════════
export default function EvaluationDashboard({ caseId, newsTitle, versions, sourceText, onClose }) {

  // ── State ──
  const [evaluationData, setEvaluationData] = useState(null);
  const [evaluating, setEvaluating] = useState(false);
  const [selectedVersions, setSelectedVersions] = useState([]);
  const [activeTab, setActiveTab] = useState('scores');
  const [detailVersion, setDetailVersion] = useState(null);
  const [editResult, setEditResult] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [selectingFinal, setSelectingFinal] = useState(false);
  const [toast, setToast] = useState('');
  const [copied, setCopied] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // ── Copy helper ──
  const copyText = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
      showToast('📋 คัดลอกแล้ว');
    });
  };

  // ── Evaluate all versions ──
  const runEvaluation = useCallback(async () => {
    setEvaluating(true);
    try {
      const res = await fetch('/api/evaluate-versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId }),
      });
      const data = await res.json();
      if (data.success) {
        setEvaluationData(data);
        showToast('✅ ประเมินเสร็จสิ้น');
      } else {
        showToast('❌ ประเมินไม่สำเร็จ: ' + (data.error || ''));
      }
    } catch (err) {
      showToast('❌ เชื่อมต่อ API ไม่ได้: ' + err.message);
    } finally {
      setEvaluating(false);
    }
  }, [caseId]);

  // ── Select final version ──
  const selectFinal = useCallback(async (versionId) => {
    setSelectingFinal(true);
    try {
      const res = await fetch('/api/evaluate-versions/select-final', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId, versionId, reason: 'Selected from dashboard' }),
      });
      const data = await res.json();
      if (data.success) {
        setEvaluationData(prev => prev ? { ...prev, finalSelection: versionId } : prev);
        showToast(`✅ เลือก v${versionId + 1} เป็น Final แล้ว`);
      } else {
        showToast('❌ เลือกไม่สำเร็จ: ' + (data.error || ''));
      }
    } catch (err) {
      showToast('❌ เชื่อมต่อ API ไม่ได้');
    } finally {
      setSelectingFinal(false);
    }
  }, [caseId]);

  // ── Apply AI edit ──
  const applyEdit = useCallback(async (versionId) => {
    setEditLoading(true);
    setEditResult(null);
    try {
      const res = await fetch('/api/evaluate-versions/apply-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId, versionId }),
      });
      const data = await res.json();
      if (data.success) {
        setEditResult(data);
        showToast('✅ AI แก้ไขเสร็จแล้ว');
      } else {
        showToast('❌ แก้ไขไม่สำเร็จ: ' + (data.error || ''));
      }
    } catch (err) {
      showToast('❌ เชื่อมต่อ API ไม่ได้');
    } finally {
      setEditLoading(false);
    }
  }, [caseId]);

  // ── Toggle version comparison selection (max 3) ──
  const toggleCompareVersion = (idx) => {
    setSelectedVersions(prev => {
      if (prev.includes(idx)) return prev.filter(v => v !== idx);
      if (prev.length >= 3) { showToast('⚠️ เลือกเปรียบเทียบได้สูงสุด 3 เวอร์ชัน'); return prev; }
      return [...prev, idx];
    });
  };

  // ── Derived data ──
  const scores = evaluationData?.scores || [];
  const summary = evaluationData?.summary || {};
  const bestVersions = evaluationData?.bestVersions || {};
  const finalSelection = evaluationData?.finalSelection ?? null;

  // Determine which version to show in "original vs selected"
  const finalOrBestIdx = useMemo(() => {
    if (finalSelection !== null && finalSelection !== undefined) return finalSelection;
    return bestVersions.overall ?? 0;
  }, [finalSelection, bestVersions]);

  // ── Badges for best versions ──
  const badgeMap = useMemo(() => {
    const m = {};
    if (bestVersions.overall !== undefined) { m[bestVersions.overall] = [...(m[bestVersions.overall] || []), '🏆 Overall']; }
    if (bestVersions.viral !== undefined) { m[bestVersions.viral] = [...(m[bestVersions.viral] || []), '🔥 Viral']; }
    if (bestVersions.accuracy !== undefined) { m[bestVersions.accuracy] = [...(m[bestVersions.accuracy] || []), '🎯 Accuracy']; }
    if (bestVersions.safest !== undefined) { m[bestVersions.safest] = [...(m[bestVersions.safest] || []), '🛡️ Safe']; }
    return m;
  }, [bestVersions]);

  // ══════════════════════════════════════════════════
  //  STYLES
  // ══════════════════════════════════════════════════
  const s = {
    overlay: {
      position: 'fixed',
      inset: 0,
      zIndex: 10000,
      background: 'rgba(10,10,20,0.98)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      color: '#e2e8f0',
      overflow: 'hidden',
    },
    header: {
      padding: '20px 28px 16px',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      flexShrink: 0,
      gap: '16px',
      flexWrap: 'wrap',
    },
    title: {
      fontSize: '22px',
      fontWeight: 800,
      color: '#f1f5f9',
      margin: 0,
      letterSpacing: '-0.02em',
    },
    subtitle: {
      fontSize: '12px',
      color: '#475569',
      marginTop: '6px',
      display: 'flex',
      gap: '12px',
      alignItems: 'center',
      flexWrap: 'wrap',
    },
    closeBtn: {
      background: 'rgba(239,68,68,0.1)',
      border: '1px solid rgba(239,68,68,0.25)',
      color: '#ef4444',
      width: '36px',
      height: '36px',
      borderRadius: '10px',
      fontSize: '16px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'all 0.2s ease',
      flexShrink: 0,
      fontFamily: 'inherit',
    },
    actionBar: {
      padding: '12px 28px',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
      display: 'flex',
      gap: '10px',
      alignItems: 'center',
      flexWrap: 'wrap',
      flexShrink: 0,
    },
    btn: (color, bg, border) => ({
      padding: '10px 20px',
      borderRadius: '10px',
      border: `1px solid ${border || color}`,
      background: bg || 'transparent',
      color: color,
      fontSize: '13px',
      fontWeight: 700,
      cursor: 'pointer',
      fontFamily: 'inherit',
      transition: 'all 0.2s ease',
      whiteSpace: 'nowrap',
    }),
    btnSm: (color, bg, border) => ({
      padding: '6px 14px',
      borderRadius: '8px',
      border: `1px solid ${border || color}`,
      background: bg || 'transparent',
      color: color,
      fontSize: '11px',
      fontWeight: 700,
      cursor: 'pointer',
      fontFamily: 'inherit',
      transition: 'all 0.2s ease',
      whiteSpace: 'nowrap',
    }),
    tabBar: {
      padding: '0 28px',
      display: 'flex',
      gap: '2px',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      flexShrink: 0,
    },
    tab: (active) => ({
      padding: '12px 20px',
      fontSize: '13px',
      fontWeight: 700,
      color: active ? '#a78bfa' : '#64748b',
      background: active ? 'rgba(167,139,250,0.08)' : 'transparent',
      border: 'none',
      borderBottom: active ? '2px solid #a78bfa' : '2px solid transparent',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      fontFamily: 'inherit',
    }),
    body: {
      flex: 1,
      overflow: 'auto',
      padding: '20px 28px 40px',
    },
    card: {
      background: 'rgba(15,23,42,0.6)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '14px',
      padding: '20px',
      marginBottom: '16px',
    },
    sectionTitle: {
      fontSize: '13px',
      fontWeight: 700,
      color: '#94a3b8',
      marginBottom: '12px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    },
    badge: (color, bg) => ({
      fontSize: '10px',
      fontWeight: 700,
      padding: '3px 10px',
      borderRadius: '20px',
      color: color,
      background: bg,
      border: `1px solid ${color}30`,
      whiteSpace: 'nowrap',
    }),
    toast: {
      position: 'fixed',
      top: '20px',
      right: '20px',
      zIndex: 99999,
      background: 'rgba(15,23,42,0.95)',
      backdropFilter: 'blur(16px)',
      border: '1px solid rgba(255,255,255,0.1)',
      color: '#f1f5f9',
      padding: '12px 20px',
      borderRadius: '12px',
      fontSize: '13px',
      fontWeight: 700,
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
    },
    scrollPanel: {
      overflowY: 'auto',
      maxHeight: '400px',
      scrollbarWidth: 'thin',
      scrollbarColor: '#334155 transparent',
    },
  };

  // ── Render score cell ──
  const ScoreCell = ({ val }) => (
    <span style={{
      fontSize: '12px',
      fontWeight: 800,
      color: scoreColor(val ?? 0),
      background: scoreBg(val ?? 0),
      padding: '2px 8px',
      borderRadius: '6px',
      display: 'inline-block',
      minWidth: '32px',
      textAlign: 'center',
    }}>
      {val ?? '-'}
    </span>
  );

  // ── Render score bar ──
  const ScoreBar = ({ label, value, fullLabel }) => (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>{fullLabel || label}</span>
        <span style={{ fontSize: '11px', fontWeight: 800, color: scoreColor(value) }}>{value}</span>
      </div>
      <div style={{ height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${Math.min(value, 100)}%`,
          background: scoreColor(value),
          borderRadius: '3px',
          transition: 'width 0.5s ease',
        }} />
      </div>
    </div>
  );

  // ── List renderer ──
  const BulletList = ({ items, color = '#94a3b8', icon = '•' }) => {
    if (!items || items.length === 0) return <span style={{ fontSize: '12px', color: '#475569' }}>ไม่มีข้อมูล</span>;
    return (
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {items.map((item, i) => (
          <li key={i} style={{ fontSize: '12px', color, lineHeight: 1.7, paddingLeft: '12px', position: 'relative' }}>
            <span style={{ position: 'absolute', left: 0 }}>{icon}</span> {item}
          </li>
        ))}
      </ul>
    );
  };

  // ══════════════════════════════════════════════════
  //  TAB: SCORES TABLE
  // ══════════════════════════════════════════════════
  const renderScoresTab = () => {
    if (!evaluationData) {
      return (
        <div style={{ textAlign: 'center', padding: '80px 20px', color: '#475569' }}>
          <div style={{ fontSize: '56px', marginBottom: '16px' }}>🧪</div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#64748b', marginBottom: '8px' }}>ยังไม่ได้ประเมิน</div>
          <div style={{ fontSize: '13px' }}>กดปุ่ม "ประเมินบทความทั้งหมด" เพื่อเริ่มประเมินด้วย AI</div>
        </div>
      );
    }

    return (
      <>
        {/* Final selection indicator */}
        {finalSelection !== null && (
          <div style={{
            background: 'rgba(34,197,94,0.08)',
            border: '1px solid rgba(34,197,94,0.2)',
            borderRadius: '10px',
            padding: '12px 16px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}>
            <span style={{ fontSize: '18px' }}>🏁</span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#22c55e' }}>
              Final: v{(finalSelection) + 1} — {versions[finalSelection]?.title || 'ไม่มีหัวข้อ'}
            </span>
          </div>
        )}

        {/* Score table */}
        <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'separate',
            borderSpacing: '0 2px',
            fontSize: '12px',
          }}>
            <thead>
              <tr>
                {['', '#', 'หัวข้อ', 'Final', 'Acc', 'Comp', 'Read', 'Viral', 'Orig', 'Safe', 'สถานะ', 'Actions'].map((h, i) => (
                  <th key={i} style={{
                    padding: '10px 8px',
                    textAlign: i <= 2 ? 'left' : 'center',
                    color: '#64748b',
                    fontWeight: 700,
                    fontSize: '10px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scores.map((vs, idx) => {
                const sc = vs.scores || {};
                const statusCfg = STATUS_STYLES[vs.status] || STATUS_STYLES.REJECT;
                const isDetail = detailVersion === vs.versionId;
                const isFinal = finalSelection === vs.versionId;
                const badges = badgeMap[vs.versionId] || [];

                return (
                  <tr
                    key={vs.versionId}
                    onClick={() => setDetailVersion(isDetail ? null : vs.versionId)}
                    style={{
                      cursor: 'pointer',
                      background: isDetail ? 'rgba(167,139,250,0.06)' : isFinal ? 'rgba(34,197,94,0.04)' : 'transparent',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {/* Checkbox */}
                    <td style={{ padding: '10px 6px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedVersions.includes(vs.versionId)}
                        onChange={(e) => { e.stopPropagation(); toggleCompareVersion(vs.versionId); }}
                        onClick={(e) => e.stopPropagation()}
                        style={{ cursor: 'pointer', accentColor: '#a78bfa' }}
                      />
                    </td>
                    {/* # */}
                    <td style={{ padding: '10px 8px', fontWeight: 800, color: '#a78bfa', fontSize: '13px' }}>
                      v{vs.versionId + 1}
                      {isFinal && <span style={{ marginLeft: '4px' }}>🏁</span>}
                    </td>
                    {/* Title + badges */}
                    <td style={{ padding: '10px 8px', maxWidth: '220px' }}>
                      <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: badges.length ? '4px' : 0, fontSize: '12px' }}>
                        {truncate(versions[vs.versionId]?.title, 50) || 'ไม่มีหัวข้อ'}
                      </div>
                      {badges.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {badges.map((b, i) => (
                            <span key={i} style={s.badge('#a78bfa', 'rgba(167,139,250,0.1)')}>{b}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    {/* Final Score */}
                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                      <span style={{
                        fontSize: '14px',
                        fontWeight: 800,
                        color: scoreColor(vs.finalScore),
                        background: scoreBg(vs.finalScore),
                        padding: '4px 12px',
                        borderRadius: '8px',
                      }}>{vs.finalScore}</span>
                    </td>
                    {/* Individual scores */}
                    <td style={{ padding: '10px 6px', textAlign: 'center' }}><ScoreCell val={sc.accuracy} /></td>
                    <td style={{ padding: '10px 6px', textAlign: 'center' }}><ScoreCell val={sc.completeness} /></td>
                    <td style={{ padding: '10px 6px', textAlign: 'center' }}><ScoreCell val={sc.readability} /></td>
                    <td style={{ padding: '10px 6px', textAlign: 'center' }}><ScoreCell val={sc.viralPotential} /></td>
                    <td style={{ padding: '10px 6px', textAlign: 'center' }}><ScoreCell val={sc.originality} /></td>
                    <td style={{ padding: '10px 6px', textAlign: 'center' }}><ScoreCell val={sc.safety} /></td>
                    {/* Status */}
                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                      <span style={{
                        ...s.badge(statusCfg.color, statusCfg.bg),
                        fontSize: '10px',
                      }}>{statusCfg.label}</span>
                    </td>
                    {/* Actions */}
                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); selectFinal(vs.versionId); }}
                          disabled={selectingFinal || isFinal}
                          style={{
                            ...s.btnSm(
                              isFinal ? '#475569' : '#22c55e',
                              isFinal ? 'rgba(100,116,139,0.06)' : 'rgba(34,197,94,0.1)',
                              isFinal ? 'rgba(100,116,139,0.1)' : 'rgba(34,197,94,0.2)',
                            ),
                            opacity: isFinal ? 0.5 : 1,
                          }}
                        >
                          {isFinal ? '🏁 Final' : '✅ Final'}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); applyEdit(vs.versionId); }}
                          disabled={editLoading}
                          style={s.btnSm('#f59e0b', 'rgba(245,158,11,0.1)', 'rgba(245,158,11,0.2)')}
                        >
                          ✏️ แก้ไข
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Detail panel */}
        {detailVersion !== null && renderDetailPanel(detailVersion)}
      </>
    );
  };

  // ══════════════════════════════════════════════════
  //  VERSION DETAIL PANEL
  // ══════════════════════════════════════════════════
  const renderDetailPanel = (verId) => {
    const vs = scores.find(v => v.versionId === verId);
    const ver = versions[verId];
    if (!vs || !ver) return null;

    const sc = vs.scores || {};
    const scoreKeys = Object.keys(SCORE_FULL_LABELS);

    return (
      <div style={{
        ...s.card,
        borderLeft: '3px solid #a78bfa',
        animation: 'fadeIn 0.2s ease',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 800, color: '#f1f5f9', marginBottom: '4px' }}>
              v{verId + 1} — {ver.title || 'ไม่มีหัวข้อ'}
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {ver.style && <span style={s.badge('#818cf8', 'rgba(129,140,248,0.1)')}>🎨 {ver.style}</span>}
              {ver.tone && <span style={s.badge('#f472b6', 'rgba(244,114,182,0.1)')}>🎭 {ver.tone}</span>}
              <span style={s.badge('#64748b', 'rgba(100,116,139,0.1)')}>📏 {ver.wordCount || '?'} คำ</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={() => copyText(ver.content || '', 'detail-' + verId)}
              style={s.btnSm('#64748b', 'rgba(100,116,139,0.08)', 'rgba(100,116,139,0.15)')}
            >
              {copied === 'detail-' + verId ? '✅ คัดลอก!' : '📋 คัดลอกเนื้อหา'}
            </button>
            <button
              onClick={() => setDetailVersion(null)}
              style={s.btnSm('#64748b', 'rgba(100,116,139,0.08)', 'rgba(100,116,139,0.15)')}
            >
              ✕ ปิด
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
          {/* Left: Content */}
          <div>
            <div style={s.sectionTitle}>📄 เนื้อหาเต็ม</div>
            <div style={{
              ...s.scrollPanel,
              background: 'rgba(8,12,24,0.5)',
              border: '1px solid rgba(255,255,255,0.04)',
              borderRadius: '10px',
              padding: '14px 16px',
              fontSize: '13px',
              color: '#cbd5e1',
              lineHeight: 1.8,
              whiteSpace: 'pre-wrap',
            }}>
              {ver.content || 'ไม่มีเนื้อหา'}
            </div>
          </div>

          {/* Right: Scores + Analysis */}
          <div>
            {/* Score bars */}
            <div style={s.sectionTitle}>📊 คะแนนรายหัวข้อ</div>
            <div style={{
              background: 'rgba(8,12,24,0.5)',
              border: '1px solid rgba(255,255,255,0.04)',
              borderRadius: '10px',
              padding: '14px 16px',
              marginBottom: '16px',
            }}>
              {scoreKeys.map(k => (
                <ScoreBar key={k} label={SCORE_LABELS[k]} fullLabel={SCORE_FULL_LABELS[k]} value={sc[k] || 0} />
              ))}
            </div>

            {/* Analysis sections */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div style={{ background: 'rgba(34,197,94,0.05)', borderRadius: '10px', padding: '12px', border: '1px solid rgba(34,197,94,0.1)' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#22c55e', marginBottom: '8px' }}>💪 จุดเด่น</div>
                <BulletList items={vs.strengths} color="#94a3b8" icon="✓" />
              </div>
              <div style={{ background: 'rgba(239,68,68,0.05)', borderRadius: '10px', padding: '12px', border: '1px solid rgba(239,68,68,0.1)' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#ef4444', marginBottom: '8px' }}>⚠️ จุดอ่อน</div>
                <BulletList items={vs.weaknesses} color="#94a3b8" icon="✗" />
              </div>
              <div style={{ background: 'rgba(245,158,11,0.05)', borderRadius: '10px', padding: '12px', border: '1px solid rgba(245,158,11,0.1)' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#f59e0b', marginBottom: '8px' }}>📌 ข้อมูลที่ขาด</div>
                <BulletList items={vs.missingPoints} color="#94a3b8" icon="–" />
              </div>
              <div style={{ background: 'rgba(249,115,22,0.05)', borderRadius: '10px', padding: '12px', border: '1px solid rgba(249,115,22,0.1)' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#f97316', marginBottom: '8px' }}>🚨 ความเสี่ยง</div>
                <BulletList items={vs.factualRisks} color="#94a3b8" icon="!" />
              </div>
            </div>

            {/* Suggestions */}
            {(vs.improvementSuggestions?.length > 0 || vs.recommendedEdits?.length > 0) && (
              <div style={{ marginTop: '12px', background: 'rgba(167,139,250,0.05)', borderRadius: '10px', padding: '12px', border: '1px solid rgba(167,139,250,0.1)' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#a78bfa', marginBottom: '8px' }}>💡 คำแนะนำการปรับปรุง</div>
                <BulletList items={[...(vs.improvementSuggestions || []), ...(vs.recommendedEdits || [])]} color="#94a3b8" icon="→" />
              </div>
            )}

            {/* Editor note */}
            {vs.editorNote && (
              <div style={{ marginTop: '12px', background: 'rgba(59,130,246,0.05)', borderRadius: '10px', padding: '12px', border: '1px solid rgba(59,130,246,0.1)' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#3b82f6', marginBottom: '6px' }}>📝 หมายเหตุบรรณาธิการ</div>
                <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.6 }}>{vs.editorNote}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ══════════════════════════════════════════════════
  //  TAB: COMPARE
  // ══════════════════════════════════════════════════
  const renderCompareTab = () => {
    if (selectedVersions.length === 0) {
      return (
        <div style={{ textAlign: 'center', padding: '80px 20px', color: '#475569' }}>
          <div style={{ fontSize: '56px', marginBottom: '16px' }}>⚖️</div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#64748b', marginBottom: '8px' }}>ยังไม่ได้เลือกเวอร์ชัน</div>
          <div style={{ fontSize: '13px' }}>ไปที่แท็บ "คะแนน" แล้วเลือก checkbox เวอร์ชันที่ต้องการเปรียบเทียบ (สูงสุด 3)</div>
        </div>
      );
    }

    const colWidth = `${Math.floor(100 / selectedVersions.length)}%`;

    return (
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        {selectedVersions.map(verId => {
          const vs = scores.find(v => v.versionId === verId);
          const ver = versions[verId];
          if (!vs || !ver) return null;
          const sc = vs.scores || {};
          const statusCfg = STATUS_STYLES[vs.status] || STATUS_STYLES.REJECT;
          const scoreKeys = Object.keys(SCORE_FULL_LABELS);

          return (
            <div key={verId} style={{ flex: `1 1 ${colWidth}`, minWidth: '300px' }}>
              <div style={{ ...s.card, height: '100%' }}>
                {/* Version header */}
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '15px', fontWeight: 800, color: '#a78bfa' }}>v{verId + 1}</span>
                    <span style={s.badge(statusCfg.color, statusCfg.bg)}>{statusCfg.label}</span>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#e2e8f0', marginBottom: '4px' }}>
                    {truncate(ver.title, 60) || 'ไม่มีหัวข้อ'}
                  </div>
                  <div style={{
                    fontSize: '20px', fontWeight: 800, color: scoreColor(vs.finalScore),
                    textAlign: 'center', padding: '8px 0',
                  }}>
                    {vs.finalScore} <span style={{ fontSize: '12px', color: '#64748b' }}>/ 100</span>
                  </div>
                </div>

                {/* Score bars */}
                <div style={{
                  background: 'rgba(8,12,24,0.4)',
                  borderRadius: '10px',
                  padding: '12px',
                  marginBottom: '12px',
                  border: '1px solid rgba(255,255,255,0.04)',
                }}>
                  {scoreKeys.map(k => (
                    <ScoreBar key={k} label={SCORE_LABELS[k]} fullLabel={SCORE_FULL_LABELS[k]} value={sc[k] || 0} />
                  ))}
                </div>

                {/* Content preview */}
                <div style={{
                  ...s.scrollPanel,
                  maxHeight: '200px',
                  background: 'rgba(8,12,24,0.4)',
                  borderRadius: '10px',
                  padding: '12px',
                  fontSize: '12px',
                  color: '#94a3b8',
                  lineHeight: 1.7,
                  whiteSpace: 'pre-wrap',
                  marginBottom: '12px',
                  border: '1px solid rgba(255,255,255,0.04)',
                }}>
                  {truncate(ver.content, 600) || 'ไม่มีเนื้อหา'}
                </div>

                {/* Strengths */}
                <div style={{ marginBottom: '10px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#22c55e', marginBottom: '6px' }}>💪 จุดเด่น</div>
                  <BulletList items={vs.strengths} color="#94a3b8" icon="✓" />
                </div>

                {/* Weaknesses */}
                <div style={{ marginBottom: '10px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#ef4444', marginBottom: '6px' }}>⚠️ จุดอ่อน</div>
                  <BulletList items={vs.weaknesses} color="#94a3b8" icon="✗" />
                </div>

                {/* Missing */}
                <div style={{ marginBottom: '10px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#f59e0b', marginBottom: '6px' }}>📌 ข้อมูลที่ขาด</div>
                  <BulletList items={vs.missingPoints} color="#94a3b8" icon="–" />
                </div>

                {/* Risks */}
                <div style={{ marginBottom: '10px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#f97316', marginBottom: '6px' }}>🚨 ความเสี่ยง</div>
                  <BulletList items={vs.factualRisks} color="#94a3b8" icon="!" />
                </div>

                {/* Suggestions */}
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#a78bfa', marginBottom: '6px' }}>💡 คำแนะนำ</div>
                  <BulletList items={vs.improvementSuggestions} color="#94a3b8" icon="→" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ══════════════════════════════════════════════════
  //  TAB: ORIGINAL VS SELECTED
  // ══════════════════════════════════════════════════
  const renderOriginalTab = () => {
    const selVer = versions[finalOrBestIdx];

    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '16px' }}>
        {/* Left: Original */}
        <div style={s.card}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '14px',
          }}>
            <span style={s.badge('#3b82f6', 'rgba(59,130,246,0.12)')}>📰 ต้นฉบับ</span>
            <span style={{ fontSize: '12px', color: '#64748b' }}>Source Text</span>
          </div>
          <div style={{
            ...s.scrollPanel,
            maxHeight: '600px',
            background: 'rgba(8,12,24,0.5)',
            borderRadius: '10px',
            padding: '16px',
            fontSize: '13px',
            color: '#94a3b8',
            lineHeight: 1.8,
            whiteSpace: 'pre-wrap',
            border: '1px solid rgba(255,255,255,0.04)',
          }}>
            {sourceText || 'ไม่มีต้นฉบับ'}
          </div>
        </div>

        {/* Right: Selected version */}
        <div style={s.card}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '14px',
          }}>
            <span style={s.badge('#22c55e', 'rgba(34,197,94,0.12)')}>
              {finalSelection !== null ? '🏁 Final' : '🏆 Best'}
            </span>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              v{finalOrBestIdx + 1} — {selVer?.style || ''}
            </span>
          </div>
          {selVer ? (
            <>
              <div style={{
                fontSize: '14px',
                fontWeight: 700,
                color: '#f1f5f9',
                marginBottom: '12px',
                padding: '10px 14px',
                background: 'rgba(167,139,250,0.06)',
                borderRadius: '8px',
                border: '1px solid rgba(167,139,250,0.1)',
              }}>
                {selVer.title || 'ไม่มีหัวข้อ'}
              </div>
              <div style={{
                ...s.scrollPanel,
                maxHeight: '550px',
                background: 'rgba(8,12,24,0.5)',
                borderRadius: '10px',
                padding: '16px',
                fontSize: '13px',
                color: '#cbd5e1',
                lineHeight: 1.8,
                whiteSpace: 'pre-wrap',
                border: '1px solid rgba(255,255,255,0.04)',
              }}>
                {selVer.content || 'ไม่มีเนื้อหา'}
              </div>
            </>
          ) : (
            <div style={{ padding: '40px', textAlign: 'center', color: '#475569' }}>ไม่มีเวอร์ชันที่เลือก</div>
          )}
        </div>
      </div>
    );
  };

  // ══════════════════════════════════════════════════
  //  TAB: RECOMMENDATION
  // ══════════════════════════════════════════════════
  const renderRecommendationTab = () => {
    if (!evaluationData) {
      return (
        <div style={{ textAlign: 'center', padding: '80px 20px', color: '#475569' }}>
          <div style={{ fontSize: '56px', marginBottom: '16px' }}>🤖</div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#64748b', marginBottom: '8px' }}>ยังไม่มีคำแนะนำ</div>
          <div style={{ fontSize: '13px' }}>ประเมินบทความก่อนเพื่อดูคำแนะนำจาก AI</div>
        </div>
      );
    }

    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
        {/* AI Recommended Version */}
        <div style={{ ...s.card, borderLeft: '3px solid #a78bfa', gridColumn: '1 / -1' }}>
          <div style={s.sectionTitle}>🏆 เวอร์ชันที่ AI แนะนำ</div>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{
              fontSize: '48px',
              fontWeight: 800,
              color: '#a78bfa',
              lineHeight: 1,
              minWidth: '80px',
              textAlign: 'center',
            }}>
              v{(bestVersions.overall ?? 0) + 1}
            </div>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#f1f5f9', marginBottom: '8px' }}>
                {versions[bestVersions.overall ?? 0]?.title || 'ไม่มีหัวข้อ'}
              </div>
              <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.7 }}>
                {summary.bestVersionReason || 'ไม่มีเหตุผล'}
              </div>
            </div>
          </div>
        </div>

        {/* Main issues */}
        <div style={s.card}>
          <div style={s.sectionTitle}>⚠️ ปัญหาที่พบในหลายเวอร์ชัน</div>
          <BulletList items={summary.mainIssuesAcrossVersions} color="#f59e0b" icon="•" />
        </div>

        {/* Missing across all */}
        <div style={s.card}>
          <div style={s.sectionTitle}>📌 สิ่งที่ทุกเวอร์ชันขาด</div>
          <BulletList items={summary.whatAllVersionsAreMissing} color="#ef4444" icon="–" />
        </div>

        {/* Editor recommendation */}
        <div style={{ ...s.card, gridColumn: '1 / -1' }}>
          <div style={s.sectionTitle}>📝 คำแนะนำจากบรรณาธิการ</div>
          <div style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: 1.8 }}>
            {summary.editorRecommendation || 'ไม่มีคำแนะนำ'}
          </div>
        </div>

        {/* Best in categories */}
        <div style={{ ...s.card, gridColumn: '1 / -1' }}>
          <div style={s.sectionTitle}>🏅 เวอร์ชันที่ดีที่สุดในแต่ละด้าน</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
            {[
              { key: 'overall', icon: '🏆', label: 'Overall', color: '#a78bfa' },
              { key: 'viral', icon: '🔥', label: 'Viral', color: '#f97316' },
              { key: 'accuracy', icon: '🎯', label: 'Accuracy', color: '#3b82f6' },
              { key: 'safest', icon: '🛡️', label: 'Safest', color: '#22c55e' },
            ].map(cat => {
              const vId = bestVersions[cat.key];
              const ver = vId !== undefined ? versions[vId] : null;
              const vs = vId !== undefined ? scores.find(v => v.versionId === vId) : null;
              return (
                <div key={cat.key} style={{
                  background: 'rgba(8,12,24,0.5)',
                  border: `1px solid ${cat.color}20`,
                  borderRadius: '10px',
                  padding: '14px',
                  borderLeft: `3px solid ${cat.color}`,
                }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: cat.color, marginBottom: '6px' }}>
                    {cat.icon} {cat.label}
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: '#f1f5f9', marginBottom: '4px' }}>
                    v{(vId ?? 0) + 1}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>
                    {truncate(ver?.title, 40) || '-'}
                  </div>
                  {vs && (
                    <div style={{ fontSize: '14px', fontWeight: 800, color: scoreColor(vs.finalScore), marginTop: '6px' }}>
                      {vs.finalScore} pts
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // ══════════════════════════════════════════════════
  //  EDIT RESULT VIEW (overlay within modal)
  // ══════════════════════════════════════════════════
  const renderEditResult = () => {
    if (!editResult) return null;

    return (
      <div style={{
        position: 'absolute',
        inset: 0,
        zIndex: 10,
        background: 'rgba(10,10,20,0.96)',
        backdropFilter: 'blur(16px)',
        overflow: 'auto',
        padding: '28px',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>✏️ ผลการแก้ไขโดย AI</h2>
            <div style={{ fontSize: '12px', color: '#475569', marginTop: '4px' }}>เปรียบเทียบก่อน/หลังแก้ไข</div>
          </div>
          <button
            onClick={() => setEditResult(null)}
            style={s.btn('#64748b', 'rgba(100,116,139,0.1)', 'rgba(100,116,139,0.2)')}
          >
            ↩️ ปิด
          </button>
        </div>

        {/* Changes summary */}
        {editResult.changesSummary?.length > 0 && (
          <div style={{ ...s.card, borderLeft: '3px solid #a78bfa', marginBottom: '16px' }}>
            <div style={s.sectionTitle}>📋 สรุปการเปลี่ยนแปลง</div>
            <BulletList items={editResult.changesSummary} color="#cbd5e1" icon="→" />
            {editResult.expectedScoreImprovement && (
              <div style={{ marginTop: '10px', fontSize: '12px', color: '#22c55e', fontWeight: 600 }}>
                📈 คาดว่าคะแนนจะเพิ่ม: {editResult.expectedScoreImprovement}
              </div>
            )}
          </div>
        )}

        {/* Title comparison */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
          <div style={s.card}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#ef4444', marginBottom: '8px', textTransform: 'uppercase' }}>❌ หัวข้อเดิม</div>
            <div style={{ fontSize: '14px', color: '#94a3b8', lineHeight: 1.6 }}>{editResult.originalTitle || '-'}</div>
          </div>
          <div style={s.card}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#22c55e', marginBottom: '8px', textTransform: 'uppercase' }}>✅ หัวข้อที่แก้</div>
            <div style={{ fontSize: '14px', color: '#f1f5f9', lineHeight: 1.6, fontWeight: 600 }}>{editResult.editedTitle || '-'}</div>
          </div>
        </div>

        {/* Content comparison */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', flex: 1 }}>
          <div style={s.card}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#ef4444', marginBottom: '8px', textTransform: 'uppercase' }}>❌ เนื้อหาเดิม</div>
            <div style={{
              ...s.scrollPanel,
              maxHeight: '500px',
              fontSize: '13px',
              color: '#94a3b8',
              lineHeight: 1.8,
              whiteSpace: 'pre-wrap',
            }}>
              {editResult.originalContent || 'ไม่มีเนื้อหา'}
            </div>
          </div>
          <div style={s.card}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#22c55e', marginBottom: '8px', textTransform: 'uppercase' }}>✅ เนื้อหาที่แก้</div>
            <div style={{
              ...s.scrollPanel,
              maxHeight: '500px',
              fontSize: '13px',
              color: '#cbd5e1',
              lineHeight: 1.8,
              whiteSpace: 'pre-wrap',
            }}>
              {editResult.editedContent || 'ไม่มีเนื้อหา'}
            </div>
          </div>
        </div>

        {/* Copy button */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'flex-end' }}>
          <button
            onClick={() => copyText(editResult.editedContent || '', 'edited-content')}
            style={s.btn('#22c55e', 'rgba(34,197,94,0.12)', 'rgba(34,197,94,0.2)')}
          >
            {copied === 'edited-content' ? '✅ คัดลอกแล้ว' : '📋 คัดลอกเนื้อหาที่แก้'}
          </button>
          <button
            onClick={() => setEditResult(null)}
            style={s.btn('#64748b', 'rgba(100,116,139,0.1)', 'rgba(100,116,139,0.2)')}
          >
            ↩️ ปิด
          </button>
        </div>
      </div>
    );
  };

  // ══════════════════════════════════════════════════
  //  MAIN RENDER
  // ══════════════════════════════════════════════════
  return (
    <div style={s.overlay}>

      {/* ── Toast ── */}
      {toast && <div style={s.toast}>{toast}</div>}

      {/* ── Edit Result Overlay ── */}
      {editResult && renderEditResult()}

      {/* ── Edit Loading Overlay ── */}
      {editLoading && (
        <div style={{
          position: 'absolute',
          inset: 0,
          zIndex: 9,
          background: 'rgba(10,10,20,0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: '16px',
        }}>
          <div style={{ fontSize: '48px', animation: 'spin 1.5s linear infinite' }}>✏️</div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#f59e0b' }}>AI กำลังแก้ไขบทความ...</div>
          <div style={{ fontSize: '12px', color: '#475569' }}>อาจใช้เวลา 30-60 วินาที</div>
        </div>
      )}

      {/* ══ HEADER ══ */}
      <div style={s.header}>
        <div>
          <h1 style={s.title}>🧪 Article Evaluation Dashboard</h1>
          <div style={s.subtitle}>
            <span style={{
              fontSize: '13px',
              fontWeight: 800,
              color: '#a78bfa',
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            }}>
              #{caseId}
            </span>
            <span style={{ color: '#334155' }}>|</span>
            <span style={{ color: '#94a3b8', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {newsTitle || 'ไม่มีหัวข้อ'}
            </span>
            <span style={{ color: '#334155' }}>|</span>
            <span style={s.badge('#f59e0b', 'rgba(245,158,11,0.12)')}>
              📑 {versions?.length || 0} เวอร์ชัน
            </span>
            {evaluationData && (
              <span style={s.badge('#22c55e', 'rgba(34,197,94,0.12)')}>
                ✅ ประเมินแล้ว ({evaluationData.modelUsed || 'GPT-4o'})
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          style={s.closeBtn}
          onMouseEnter={(e) => { e.target.style.background = 'rgba(239,68,68,0.25)'; }}
          onMouseLeave={(e) => { e.target.style.background = 'rgba(239,68,68,0.1)'; }}
        >
          ✕
        </button>
      </div>

      {/* ══ ACTION BAR ══ */}
      <div style={s.actionBar}>
        <button
          onClick={runEvaluation}
          disabled={evaluating}
          style={{
            ...s.btn(
              evaluating ? '#64748b' : '#a78bfa',
              evaluating ? 'rgba(100,116,139,0.1)' : 'rgba(167,139,250,0.12)',
              evaluating ? 'rgba(100,116,139,0.2)' : 'rgba(167,139,250,0.25)',
            ),
            padding: '12px 24px',
            fontSize: '14px',
          }}
        >
          {evaluating ? (
            <>⏳ กำลังประเมิน...</>
          ) : evaluationData ? (
            <>🔄 ประเมินใหม่</>
          ) : (
            <>🧪 ประเมินบทความทั้งหมด</>
          )}
        </button>

        {evaluationData && (
          <>
            <span style={{ fontSize: '12px', color: '#475569' }}>
              ⏱ {evaluationData.duration ? evaluationData.duration.toFixed(1) + 's' : '-'}
            </span>
            {selectedVersions.length > 0 && (
              <span style={s.badge('#818cf8', 'rgba(129,140,248,0.1)')}>
                ⚖️ เลือกเปรียบเทียบ {selectedVersions.length}/3
              </span>
            )}
          </>
        )}
      </div>

      {/* ══ TABS ══ */}
      <div style={s.tabBar}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={s.tab(activeTab === t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ══ BODY ══ */}
      <div style={s.body}>
        {activeTab === 'scores' && renderScoresTab()}
        {activeTab === 'compare' && renderCompareTab()}
        {activeTab === 'original' && renderOriginalTab()}
        {activeTab === 'recommendation' && renderRecommendationTab()}
      </div>

      {/* Inline keyframe animation (spin) */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        /* Custom scrollbar for dark theme */
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #475569; }
      `}} />
    </div>
  );
}
