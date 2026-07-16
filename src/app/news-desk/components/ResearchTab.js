'use client';

// ============================================================
// 🔎 หาข่าวตามรอย (Research Engine) — โมดูลที่ 2 ของโต๊ะข่าวกลาง v2
// ------------------------------------------------------------
// ส่วน 1 ตั้งค่าการล่า (HuntSetup) → ส่วน 2 ผลการล่ารอบนี้ → ส่วน 3 คลังลีดสะสม
// backend: /api/desk/research/{hunt,judge,leads} + /api/desk/dna/library?view=clusters
// ไม่มี polling — โหลดเมื่อเปิดแท็บ/หลัง action เท่านั้น · ทุก fetch ผ่าน apiFetch เดิม
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { UI, Btn, Card, Chip, Spinner, fmtNum, fmtBaht } from './ui.js';
import { apiFetch } from './ui.js';
import HuntSetup, { CHANNELS } from './HuntSetup.js';
import LeadCard from './LeadCard.js';

const LIB = '/api/desk/dna/library';
const LEADS = '/api/desk/research/leads';
const JUDGE_MAX_PER_CLUSTER = 16; // เพดานใบที่ส่งตัดสินต่อคลัสเตอร์ (คุมต้นทุน AI)
const KEEP_MIN_SCORE = 60;        // เก็บลีดอัตโนมัติเฉพาะ verdict='keep' && matchScore≥60

export default function ResearchTab({ onToast }) {
  // ── ส่วน 1: คลัสเตอร์ + ตัวเลือก ──
  const [clusters, setClusters] = useState([]);
  const [clustersLoading, setClustersLoading] = useState(false);
  const [clusterQuery, setClusterQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [channels, setChannels] = useState({ videos: true, facebook: true, tiktok: true, youtube: true, google: true }); // ★ 16 ก.ค.: +google ลิงก์ข่าวสำนัก (ผู้ใช้สั่ง)
  const [queriesPerCluster, setQueriesPerCluster] = useState(3);
  const [model, setModel] = useState('fast');

  // ── ส่วน 2: การล่ารอบนี้ ──
  const [hunting, setHunting] = useState(false);
  const [log, setLog] = useState([]);        // บรรทัดสถานะสด (ล่าสุดอยู่บน)
  const [huntStats, setHuntStats] = useState(null);
  const [roundLeads, setRoundLeads] = useState([]);
  const [ranOnce, setRanOnce] = useState(false);
  const runIdRef = useRef('');

  // ── ส่วน 3: คลังลีดสะสม ──
  const [libLeads, setLibLeads] = useState([]);
  const [libStats, setLibStats] = useState(null);
  const [libLoading, setLibLoading] = useState(false);
  const [fStatus, setFStatus] = useState('');
  const [fChannel, setFChannel] = useState('');
  const [fCluster, setFCluster] = useState('');
  const [fMinScore, setFMinScore] = useState('');
  const [fQ, setFQ] = useState('');

  // ── busy/หมายเหตุ ต่อลีด ──
  const [busyLead, setBusyLead] = useState({ id: '', action: '' });
  const [sendNotes, setSendNotes] = useState({}); // { [id]: {kind,msg} }
  const didInit = useRef(false);

  const selectedSet = new Set(selectedIds);
  const pushStep = useCallback((line) => {
    const stamped = `${new Date().toLocaleTimeString('th-TH')} · ${line}`;
    setLog((l) => [stamped, ...l].slice(0, 10));
  }, []);

  // ============================================================
  //  โหลดคลัสเตอร์ + คลัง (ครั้งแรกเมื่อเปิดแท็บ)
  // ============================================================
  const loadClusters = useCallback(async () => {
    setClustersLoading(true);
    const res = await apiFetch(`${LIB}?view=clusters`);
    setClustersLoading(false);
    if (!res.success) { onToast?.(res.error || 'โหลดคลัสเตอร์ไม่สำเร็จ', 'err'); return; }
    const list = res.clusters || [];
    setClusters(list);
    // default: เลือก top 5 อัตโนมัติ (ถ้ายังไม่เลือกอะไร)
    setSelectedIds((prev) => (prev.length ? prev : list.slice(0, 5).map((c) => c.clusterId).filter(Boolean)));
  }, [onToast]);

  const loadLibStats = useCallback(async () => {
    const res = await apiFetch(`${LEADS}?view=stats`);
    if (res.success) setLibStats(res.stats || null);
  }, []);

  const loadLibrary = useCallback(async () => {
    setLibLoading(true);
    const params = new URLSearchParams({ limit: '200' });
    if (fStatus) params.set('status', fStatus);
    if (fChannel) params.set('channel', fChannel);
    if (fCluster) params.set('clusterId', fCluster);
    if (fMinScore !== '' && !Number.isNaN(Number(fMinScore))) params.set('minScore', String(Number(fMinScore)));
    if (fQ.trim()) params.set('q', fQ.trim());
    const res = await apiFetch(`${LEADS}?${params.toString()}`);
    setLibLoading(false);
    if (res.success) setLibLeads(res.leads || []);
    else onToast?.(res.error || 'โหลดคลังลีดไม่สำเร็จ', 'err');
  }, [fStatus, fChannel, fCluster, fMinScore, fQ, onToast]);

  useEffect(() => {
    if (didInit.current) return undefined;
    didInit.current = true;
    const id = setTimeout(() => { loadClusters(); loadLibrary(); loadLibStats(); }, 0);
    return () => clearTimeout(id);
  }, [loadClusters, loadLibrary, loadLibStats]);

  // ── เลือกคลัสเตอร์ ──
  function toggleCluster(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(0, 30)));
  }
  function pickTop5() {
    setSelectedIds(clusters.slice(0, 5).map((c) => c.clusterId).filter(Boolean));
  }
  function pickRandomOffTrend() {
    const n = clusters.length;
    if (n === 0) return;
    const mid = Math.floor(n / 2);
    const win = clusters.slice(Math.max(0, mid - 20), Math.min(n, mid + 20)).map((c) => c.clusterId).filter(Boolean);
    // สุ่ม 5 จากหน้าต่างกลางตาราง (Fisher–Yates บางส่วน)
    const shuffled = win.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setSelectedIds(shuffled.slice(0, 5));
  }
  function toggleChannel(key) {
    setChannels((c) => ({ ...c, [key]: !c[key] }));
  }

  // ============================================================
  //  ส่วน 2: เริ่มล่า — hunt → judge ทีละคลัสเตอร์ → saveBatch (keep && ≥60)
  // ============================================================
  async function startHunt() {
    const clusterIds = selectedIds.slice(0, 30);
    const chList = CHANNELS.filter((c) => channels[c.key]).map((c) => c.key);
    if (clusterIds.length === 0) { onToast?.('เลือกคลัสเตอร์อย่างน้อย 1 อัน', 'warn'); return; }
    if (chList.length === 0) { onToast?.('เลือกช่องทางอย่างน้อย 1 ช่อง', 'warn'); return; }

    const runId = 'rrun_' + Date.now().toString(36);
    runIdRef.current = runId;
    setHunting(true);
    setRanOnce(true);
    setLog([]);
    setHuntStats(null);
    setRoundLeads([]);
    setSendNotes({});
    pushStep(`เริ่มล่า ${fmtNum(clusterIds.length)} คลัสเตอร์ · ${chList.length} ช่องทาง · ${queriesPerCluster} คีย์/คลัสเตอร์`);

    // ── (1) hunt ──
    const hRes = await apiFetch('/api/desk/research/hunt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clusterIds,
        topClusters: Math.min(30, Math.max(1, clusterIds.length)),
        queriesPerCluster,
        channels: chList,
        perQueryResults: 10,
      }),
    });
    if (!hRes.success) {
      pushStep(`❌ ค้นล้มเหลว: ${hRes.error || 'ไม่ทราบสาเหตุ'}`);
      onToast?.(hRes.error || 'ยิงค้นข่าวล้มเหลว', 'err');
      setHunting(false);
      return;
    }
    const candidates = hRes.candidates || [];
    setHuntStats(hRes.stats || null);
    pushStep(`ค้นเสร็จ — เจอ ${fmtNum(candidates.length)} ใบ (ยิงจริง ${fmtNum(hRes.stats?.serperCalls || 0)} call ≈ ${fmtBaht(hRes.stats?.estCostTHB || 0)})`);

    if (candidates.length === 0) {
      onToast?.('ไม่พบผลค้นเลย — ลองเพิ่มช่องทาง/คีย์ หรือเลือกคลัสเตอร์อื่น', 'warn');
      setHunting(false);
      await Promise.all([loadLibrary(), loadLibStats()]);
      return;
    }

    // ── (2) จัดกลุ่มตามคลัสเตอร์ → judge ทีละคลัสเตอร์ ──
    const byCluster = new Map();
    for (const c of candidates) {
      const k = c.clusterId || '';
      if (!byCluster.has(k)) byCluster.set(k, []);
      byCluster.get(k).push(c);
    }

    let totalSaved = 0;
    let idx = 0;
    const clusterKeys = [...byCluster.keys()];
    for (const clusterId of clusterKeys) {
      idx++;
      if (!clusterId) continue;
      const batch = (byCluster.get(clusterId) || [])
        .slice()
        .sort((a, b) => (Number(a.position) || 99) - (Number(b.position) || 99))
        .slice(0, JUDGE_MAX_PER_CLUSTER);
      if (batch.length === 0) continue;

      const arche = String(batch[0].clusterArchetype || clusterId).slice(0, 40);
      pushStep(`ตัดสินคลัสเตอร์ ${idx}/${clusterKeys.length} (${arche}) — ${fmtNum(batch.length)} ใบ…`);

      // eslint-disable-next-line no-await-in-loop
      const jRes = await apiFetch('/api/desk/research/judge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidates: batch, clusterId, model }),
      });
      if (!jRes.success) {
        pushStep(`⚠️ คลัสเตอร์ ${idx}: ตัดสินล้มเหลว (${jRes.error || 'ไม่ทราบ'}) — ข้าม`);
        continue;
      }
      const judged = jRes.judged || [];
      const keepers = judged.filter((j) => j.verdict === 'keep' && (Number(j.matchScore) || 0) >= KEEP_MIN_SCORE);
      pushStep(`คลัสเตอร์ ${idx}: ผ่าน ${fmtNum(judged.length)} · เข้าเกณฑ์เก็บ ${fmtNum(keepers.length)}`);

      if (keepers.length > 0) {
        // eslint-disable-next-line no-await-in-loop
        const sRes = await apiFetch(LEADS, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'saveBatch', leads: keepers, runId }),
        });
        if (sRes.success) totalSaved += Number(sRes.saved) || 0;
        else pushStep(`⚠️ คลัสเตอร์ ${idx}: เก็บลีดล้มเหลว (${sRes.error || 'ไม่ทราบ'})`);
      }
    }

    pushStep(`✅ เสร็จสิ้น — เก็บลีดใหม่ ${fmtNum(totalSaved)} ใบ`);
    onToast?.(`เก็บลีดใหม่ ${fmtNum(totalSaved)} ใบ`, totalSaved > 0 ? 'ok' : 'warn');

    // ── (3) ดึงลีดของรอบนี้ (filter runId ฝั่ง client) + รีเฟรชคลัง/สถิติ ──
    const rRes = await apiFetch(`${LEADS}?limit=500`);
    if (rRes.success) {
      const mine = (rRes.leads || []).filter((l) => l.runId === runId).sort((a, b) => (Number(b.matchScore) || 0) - (Number(a.matchScore) || 0));
      setRoundLeads(mine);
    }
    await Promise.all([loadLibrary(), loadLibStats()]);
    setHunting(false);
  }

  // ============================================================
  //  จัดการลีด (เก็บ/ทิ้ง/ส่งคิว) — อัปเดต local ทั้ง 2 ลิสต์ + รีเฟรชคลัง/สถิติหลังทุก action
  // ============================================================
  function patchLead(id, patch) {
    const apply = (arr) => arr.map((l) => (l.id === id ? { ...l, ...patch } : l));
    setRoundLeads((a) => apply(a));
    setLibLeads((a) => apply(a));
  }

  async function afterAction() {
    await Promise.all([loadLibrary(), loadLibStats()]);
  }

  async function setStatus(lead, status) {
    if (!lead?.id) return;
    setBusyLead({ id: lead.id, action: status === 'kept' ? 'keep' : 'dismiss' });
    const res = await apiFetch(LEADS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setStatus', id: lead.id, status }),
    });
    setBusyLead({ id: '', action: '' });
    if (res.success) {
      patchLead(lead.id, { status });
      onToast?.(status === 'kept' ? 'เก็บลีดแล้ว' : 'ทิ้งลีดแล้ว', 'ok');
      await afterAction();
    } else {
      onToast?.(res.error || 'เปลี่ยนสถานะไม่สำเร็จ', 'err');
    }
  }

  async function sendLead(lead) {
    if (!lead?.id) return;
    setBusyLead({ id: lead.id, action: 'send' });
    const res = await apiFetch(LEADS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sendQueue', id: lead.id }),
    });
    setBusyLead({ id: '', action: '' });

    if (res.blockedByTextOnly) {
      setSendNotes((m) => ({ ...m, [lead.id]: { kind: 'blocked', msg: 'สายเขียนจาก URL ปิดอยู่ (โหมด TEXT-ONLY) — ลีดถูกเก็บไว้ กดส่งได้เมื่อเปิดสาย URL' } }));
      onToast?.('สาย URL ปิดอยู่ (TEXT-ONLY) — ลีดยังเก็บไว้ ส่งได้เมื่อเปิดสาย', 'warn');
      return;
    }
    if (res.alreadySent) {
      setSendNotes((m) => ({ ...m, [lead.id]: { kind: 'sent', msg: 'ส่งเข้าคิวไปแล้วก่อนหน้านี้' } }));
      patchLead(lead.id, { status: 'sent' });
      await afterAction();
      return;
    }
    if (res.success) {
      setSendNotes((m) => ({ ...m, [lead.id]: { kind: 'sent', msg: `ส่งเข้าคิวเขียนแล้ว${res.jobId ? ` (job ${String(res.jobId).slice(0, 10)})` : ''}` } }));
      patchLead(lead.id, { status: 'sent' });
      onToast?.('ส่งเข้าคิวเขียนแล้ว', 'ok');
      await afterAction();
    } else {
      setSendNotes((m) => ({ ...m, [lead.id]: { kind: 'error', msg: res.error || 'ส่งเข้าคิวไม่สำเร็จ' } }));
      onToast?.(res.error || 'ส่งเข้าคิวไม่สำเร็จ', 'err');
    }
  }

  const busyFor = (id) => (busyLead.id === id ? busyLead.action : null);
  const s = libStats || {};
  const bs = s.byStatus || {};
  const bf = s.byFetchability || {};
  // ตัวเลือกคลัสเตอร์สำหรับตัวกรอง (derive จากลีดที่โหลดมา)
  const clusterFilterOpts = Array.from(new Map(libLeads.filter((l) => l.clusterId).map((l) => [l.clusterId, l.clusterArchetype || l.clusterId])).entries());

  // ตารางการ์ดลีด (ใช้ซ้ำทั้งส่วน 2 และ 3)
  const leadGrid = (list) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
      {list.map((lead) => (
        <LeadCard
          key={lead.id}
          lead={lead}
          busyAction={busyFor(lead.id)}
          sendNote={sendNotes[lead.id]}
          onKeep={(l) => setStatus(l, 'kept')}
          onDismiss={(l) => setStatus(l, 'dismissed')}
          onSend={sendLead}
        />
      ))}
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* ── ส่วน 1 ── */}
      <HuntSetup
        clusters={clusters} clustersLoading={clustersLoading} onReloadClusters={loadClusters}
        clusterQuery={clusterQuery} onClusterQuery={setClusterQuery}
        selectedIds={selectedIds} selectedSet={selectedSet} onToggle={toggleCluster}
        onPickTop5={pickTop5} onPickRandom={pickRandomOffTrend} onClearSelection={() => setSelectedIds([])}
        channels={channels} onToggleChannel={toggleChannel}
        queriesPerCluster={queriesPerCluster} onQueries={setQueriesPerCluster}
        model={model} onModel={setModel}
        onStart={startHunt} hunting={hunting}
      />

      {/* ── ส่วน 2: ผลการล่ารอบนี้ ── */}
      {(hunting || ranOnce) && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: UI.text }}>📥 ผลการล่ารอบนี้</span>
            {hunting && <Chip color={UI.blue}><Spinner size={11} /> กำลังทำงาน…</Chip>}
            {!hunting && roundLeads.length > 0 && <Chip color={UI.green}>ได้ลีด {fmtNum(roundLeads.length)} ใบ</Chip>}
          </div>

          {/* บันทึกสถานะสด */}
          {log.length > 0 && (
            <div style={{ background: UI.card2, border: `1px solid ${UI.line}`, borderRadius: 10, padding: 10, marginBottom: 12, fontSize: 12, color: UI.dim, display: 'grid', gap: 3, maxHeight: 160, overflowY: 'auto' }}>
              {log.map((line, i) => (
                <div key={i} style={{ color: i === 0 ? UI.text : UI.dim, fontWeight: i === 0 ? 700 : 400 }}>{line}</div>
              ))}
            </div>
          )}

          {/* สรุปสถิติการยิงค้น */}
          {huntStats && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              <Chip color={UI.accent}>ยิงค้น {fmtNum(huntStats.serperCalls || 0)} call</Chip>
              <Chip color={UI.green}>≈ {fmtBaht(huntStats.estCostTHB || 0)}</Chip>
              {huntStats.youtubeCalls > 0 && <Chip color={UI.muted}>YouTube {fmtNum(huntStats.youtubeCalls)} (ฟรี)</Chip>}
              <Chip color={UI.muted}>ซ้ำ {fmtNum(huntStats.dupCount || 0)}</Chip>
              {huntStats.selfHits > 0 && <Chip color={UI.muted}>ชนต้นแบบ {fmtNum(huntStats.selfHits)}</Chip>}
            </div>
          )}

          {roundLeads.length === 0 ? (
            !hunting && (
              <div style={{ textAlign: 'center', padding: 18, color: UI.muted, fontSize: 13 }}>
                รอบนี้ยังไม่ได้ลีดใหม่ (โดนกรอง/ซ้ำ/คะแนนไม่ถึง 60) — ดูลีดสะสมทั้งหมดด้านล่าง
              </div>
            )
          ) : (
            leadGrid(roundLeads)
          )}
        </Card>
      )}

      {/* ── ส่วน 3: คลังลีดสะสม ── */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: UI.text }}>🗃️ คลังลีดสะสม</span>
          <Btn variant="subtle" busy={libLoading} onClick={() => { loadLibrary(); loadLibStats(); }} style={{ marginLeft: 'auto', minHeight: 38, padding: '6px 12px', fontSize: 12.5 }}>↻ รีเฟรช</Btn>
        </div>

        {/* แถบสถิติ */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <Chip color={UI.text}>ทั้งหมด {fmtNum(s.total || 0)}</Chip>
          <Chip color={UI.blue}>ใหม่ {fmtNum(bs.new || 0)}</Chip>
          <Chip color={UI.accent}>เก็บ {fmtNum(bs.kept || 0)}</Chip>
          <Chip color={UI.green}>ส่งแล้ว {fmtNum(bs.sent || 0)}</Chip>
          <Chip color={UI.muted}>ทิ้ง {fmtNum(bs.dismissed || 0)}</Chip>
          <Chip color={UI.green}>🟢 พร้อมทำ {fmtNum(bf.full || 0)}</Chip>
          <Chip color={UI.amber}>🟡 ลีด {fmtNum(bf.lead || 0)}</Chip>
        </div>

        {/* ตัวกรอง */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={selStyle}>
            <option value="">ทุกสถานะ</option>
            <option value="new">ใหม่</option>
            <option value="kept">เก็บ</option>
            <option value="sent">ส่งแล้ว</option>
            <option value="dismissed">ทิ้ง</option>
          </select>
          <select value={fChannel} onChange={(e) => setFChannel(e.target.value)} style={selStyle}>
            <option value="">ทุกช่องทาง</option>
            {CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <select value={fCluster} onChange={(e) => setFCluster(e.target.value)} style={selStyle}>
            <option value="">ทุกคลัสเตอร์</option>
            {clusterFilterOpts.map(([id, name]) => <option key={id} value={id}>{String(name).slice(0, 40)}</option>)}
          </select>
          <input
            type="number" min={0} max={100} value={fMinScore}
            onChange={(e) => setFMinScore(e.target.value)}
            placeholder="match ≥"
            style={{ ...selStyle, width: 90 }}
          />
          <div style={{ display: 'flex', gap: 6, flex: '1 1 180px', minWidth: 160 }}>
            <input
              value={fQ}
              onChange={(e) => setFQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') loadLibrary(); }}
              placeholder="ค้นหัวข้อ/เนื้อ…"
              style={{ ...selStyle, flex: 1 }}
            />
            <Btn variant="subtle" busy={libLoading} onClick={loadLibrary} style={{ minHeight: 40 }}>🔎</Btn>
          </div>
        </div>

        {libLoading ? (
          <div style={{ textAlign: 'center', padding: 26, color: UI.dim }}><Spinner size={18} /> กำลังโหลด…</div>
        ) : libLeads.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 26, color: UI.muted, fontSize: 13 }}>
            ยังไม่มีลีดในคลัง (ตามตัวกรองนี้) — กด &quot;เริ่มล่า&quot; ด้านบนเพื่อเก็บลีดใหม่
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: UI.dim, marginBottom: 10 }}>แสดง {fmtNum(libLeads.length)} ลีด</div>
            {leadGrid(libLeads)}
          </>
        )}
      </Card>
    </div>
  );
}

const selStyle = {
  minHeight: 40, padding: '6px 10px', borderRadius: 10,
  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  border: '1px solid var(--border-light)', fontSize: 13, fontFamily: 'inherit',
};
