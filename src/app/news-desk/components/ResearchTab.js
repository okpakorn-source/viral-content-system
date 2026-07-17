'use client';

// ============================================================
// 🔎 หาข่าวตามรอย (Research Engine) — โมดูลที่ 2 ของโต๊ะข่าวกลาง v2
// ------------------------------------------------------------
// ส่วน 1 ตั้งค่าการล่า (HuntSetup) → ส่วน 2 ผลการล่ารอบนี้ → ส่วน 3 คลังลีดสะสม
// backend: /api/desk/research/{hunt,judge,leads} + /api/desk/dna/library?view=clusters
// ไม่มี polling — โหลดเมื่อเปิดแท็บ/หลัง action เท่านั้น · ทุก fetch ผ่าน apiFetch เดิม
// ============================================================

import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import { UI, Btn, Card, Chip, Spinner, fmtNum, fmtBaht, fmtDuration } from './ui.js';
import { apiFetch } from './ui.js';
import HuntSetup, { CHANNELS, AUTO_CFG_DEFAULT } from './HuntSetup.js';
import LeadCard from './LeadCard.js';
import EditorPanel from './EditorPanel.js'; // 🆕 E2 (17 ก.ค. 69): แผง "บก. AI" — คู่ขนานกับ backend ของ E1 (contract ล็อกแล้ว)

const LIB = '/api/desk/dna/library';
const LEADS = '/api/desk/research/leads';
const TRACE = '/api/desk/research/trace'; // ★ trace 17 ก.ค. (อ้างแบบ trace-design) — สมุดบันทึกย้อนหลัง
const JUDGE_MAX_PER_CLUSTER = 16; // เพดานใบที่ส่งตัดสินต่อคลัสเตอร์ (คุมต้นทุน AI)
const KEEP_MIN_SCORE = 60;        // เก็บลีดอัตโนมัติเฉพาะ verdict='keep' && matchScore≥60

// ★ trace: บันทึกสมุด/timeline แบบ fire-and-forget — apiFetch ไม่ throw เอง (ครอบ try เผื่อผิดคาด) ห้ามบล็อก/พัง UI หลัก
function fireTrace(body) {
  try {
    apiFetch(TRACE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // เงียบ — trace ต้องไม่ทำให้โฟลว์หาข่าวหลักพัง
  }
}

export default function ResearchTab({ onToast }) {
  // ── ส่วน 1: คลัสเตอร์ + ตัวเลือก ──
  const [clusters, setClusters] = useState([]);
  const [clustersLoading, setClustersLoading] = useState(false);
  const [clusterQuery, setClusterQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [channels, setChannels] = useState({ videos: true, facebook: true, reels: true, tiktok: true, youtube: true, google: true }); // ★ 16 ก.ค.: +google ลิงก์ข่าวสำนัก · 17 ก.ค.: +reels คลิปสั้น FB (ผู้ใช้สั่ง)
  const [queriesPerCluster, setQueriesPerCluster] = useState(3);
  const [model, setModel] = useState('fast');
  const [autoCfg, setAutoCfg] = useState(AUTO_CFG_DEFAULT); // 🆕 A1 (17 ก.ค. 69): {enabled,minScore,maxPerRound} — default ปิด

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

  // ── ส่วน 4: 📓 ประวัติรอบล่า (trace) ──
  const [traceOpen, setTraceOpen] = useState(false);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceRuns, setTraceRuns] = useState([]);
  const [traceLoaded, setTraceLoaded] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState('');

  // ── busy/หมายเหตุ ต่อลีด ──
  const [busyLead, setBusyLead] = useState({ id: '', action: '' });
  const [sendNotes, setSendNotes] = useState({}); // { [id]: {kind,msg} }
  const [extractNotes, setExtractNotes] = useState({}); // R6: { [id]: {kind:'pending'|'error',msg} }
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

  // ── ส่วน 4: 📓 ประวัติรอบล่า — โหลดครั้งแรกตอนกดเปิดเท่านั้น (ไม่มี polling) ──
  const loadTraceRuns = useCallback(async () => {
    setTraceLoading(true);
    const res = await apiFetch(`${TRACE}?limit=30`);
    setTraceLoading(false);
    setTraceLoaded(true);
    if (res.success) setTraceRuns(res.runs || []);
    else onToast?.(res.error || 'โหลดประวัติรอบล่าไม่สำเร็จ', 'err');
  }, [onToast]);

  function toggleTraceOpen() {
    setTraceOpen((open) => {
      const next = !open;
      if (next && !traceLoaded) loadTraceRuns();
      return next;
    });
  }

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
  // 🆕 A1 (17 ก.ค. 69): แก้ทีละ field ของ autoCfg (patch merge) — HuntSetup ส่ง {enabled}/{minScore}/{maxPerRound} มาทีละอย่าง
  function updateAutoCfg(patch) {
    setAutoCfg((c) => ({ ...c, ...patch }));
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
    const t0Run = Date.now(); // ★ trace: tookMs ของทั้งรอบล่า (hunt+judge+save)
    runIdRef.current = runId;
    setHunting(true);
    setRanOnce(true);
    setLog([]);
    setHuntStats(null);
    setRoundLeads([]);
    setSendNotes({});
    setExtractNotes({});
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

    // ★ trace: นับ found ต่อ {คลัสเตอร์,คีย์,ช่อง} จากผลค้นดิบทั้งหมด (ไม่ใช่แค่ที่รอด judge) — ไว้โชว์ "คีย์ไหนเจอกี่ใบ"
    const queriesUsedMap = new Map();
    for (const c of candidates) {
      const key = `${c.clusterId || ''}|${c.query || ''}|${c.channel || ''}`;
      if (!queriesUsedMap.has(key)) {
        queriesUsedMap.set(key, { clusterId: c.clusterId || '', archetype: c.clusterArchetype || '', query: c.query || '', channel: c.channel || '', found: 0 });
      }
      queriesUsedMap.get(key).found += 1;
    }

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
    // ★ trace: สะสมข้ามคลัสเตอร์ไว้ประกอบสมุดบันทึกรอบล่า 1 ก้อนตอนจบ (ดูจุดต่อจากลูปนี้)
    const runJudgeLogAgg = [];
    const judgeSummaryAgg = { judged: 0, kept: 0, dropGate: 0, dropDedup: 0, dropSame: 0, lowScore: 0 };

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
      const dropped = jRes.dropped || [];
      const keepers = judged.filter((j) => j.verdict === 'keep' && (Number(j.matchScore) || 0) >= KEEP_MIN_SCORE);
      pushStep(`คลัสเตอร์ ${idx}: ผ่าน ${fmtNum(judged.length)} · เข้าเกณฑ์เก็บ ${fmtNum(keepers.length)}`);

      // ★ trace: สรุป + รายการที่ถูกตัด (gate/dedup/isSameStory มาจาก dropped · verdict='drop' หรือคะแนนต่ำมาจาก judged ที่ไม่ผ่าน)
      judgeSummaryAgg.judged += judged.length;
      judgeSummaryAgg.kept += keepers.length;
      for (const d of dropped) {
        const isSame = d.stage === 'judge' && /เหตุการณ์เดียวกับต้นแบบ/.test(d.reason || '');
        if (d.stage === 'gate') judgeSummaryAgg.dropGate++;
        else if (d.stage === 'dedup') judgeSummaryAgg.dropDedup++;
        else if (isSame) judgeSummaryAgg.dropSame++;
        else judgeSummaryAgg.lowScore++;
        runJudgeLogAgg.push({ title: d.title || '', url: d.url || '', stage: d.stage || '', reason: d.reason || '' });
      }
      for (const j of judged) {
        const isKeeper = j.verdict === 'keep' && (Number(j.matchScore) || 0) >= KEEP_MIN_SCORE;
        if (!isKeeper) {
          judgeSummaryAgg.lowScore++;
          runJudgeLogAgg.push({ title: j.title || '', url: j.url || '', stage: 'lowScore', reason: j.reason || '', score: j.matchScore });
        }
      }

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

      // ★ trace: สมุดบันทึกรอบล่า (จบทุกคลัสเตอร์แล้ว) — fire-and-forget ไม่ block UI
      fireTrace({
        action: 'logRun',
        run: {
          runId,
          trigger: 'manual',
          params: { clusterIds, channels: chList, queriesPerCluster, model },
          queriesUsed: Array.from(queriesUsedMap.values()),
          huntStats: hRes.stats || {},
          judgeSummary: judgeSummaryAgg,
          judgeLog: runJudgeLogAgg,
          savedLeadIds: mine.map((l) => l.id),
          costTHB: hRes.stats?.estCostTHB || 0,
          tookMs: Date.now() - t0Run,
        },
      });

      // 🔧 17 ก.ค. 69 (แก้บัค timeline ว่าง): เลิกยิง {action:'leadEvents'} ต่อใบทิ้งแล้ว — found+judged ถูก
      //   seed เข้า record ตั้งแต่ saveBatch (researchLeads.js: saveLeads → pushEvent) เขียนจังหวะเดียวกับการสร้างลีด
      //   ไม่ต้องยิง fire-and-forget แยกอีกชั้น (เดิมพังบน serverless เพราะ route ตอบเสร็จ runtime ถูกแช่แข็งก่อนเขียนจริง)

      // ── 🆕 A1 (17 ก.ค. 69): ออโต้หลังล่า (default ปิด) — จบ saveBatch+logRun ครบทุกคลัสเตอร์แล้ว ──
      //   คัดเฉพาะ fetchability='full' && matchScore≥minScore เรียงคะแนนมาก→น้อย ตัดที่ maxPerRound ใบ
      //   ยิง extractAndSend ทีละใบ (sequential ตั้งใจ — คุมต้นทุน/โหลด AI ไม่ยิงขนาน) ระหว่างนี้ hunting ยังเป็น true
      //   (ปุ่ม "เริ่มล่า" ยัง disabled ต่อ) จน setHunting(false) ท้ายฟังก์ชัน
      if (autoCfg.enabled) {
        const keeperPool = mine
          .filter((l) => l.fetchability === 'full' && (Number(l.matchScore) || 0) >= autoCfg.minScore)
          .sort((a, b) => (Number(b.matchScore) || 0) - (Number(a.matchScore) || 0))
          .slice(0, autoCfg.maxPerRound);

        if (keeperPool.length === 0) {
          pushStep(`🤖 ออโต้หลังล่า: ไม่มีลีดเข้าเกณฑ์ (match ≥ ${autoCfg.minScore}% + พร้อมทำ 🟢) รอบนี้`);
        } else {
          pushStep(`🤖 ออโต้หลังล่า: เข้าเกณฑ์ ${fmtNum(keeperPool.length)} ใบ — กำลังสกัด+ส่งทีละใบ…`);
          let autoSent = 0;
          for (const lead of keeperPool) {
            // eslint-disable-next-line no-await-in-loop -- ตั้งใจส่งทีละใบเรียงคิว (sequential ตามที่เจ้าของสั่ง) คุมต้นทุน/โหลด AI ไม่ยิงขนาน
            const r = await extractAndSendLead(lead, { auto: true });
            const shortTitle = String(lead.title || lead.id).slice(0, 40);
            if (r?.success && r?.sent) {
              autoSent++;
              pushStep(`🤖 ✅ ${shortTitle} — ส่งแล้ว (${r.cleanLength || 0} ตัวอักษร)`);
            } else if (r?.pending) {
              pushStep(`🤖 ⏳ ${shortTitle} — คลิปกำลังถอด (เครื่องทีม) ยังไม่ส่งเอง`);
            } else {
              pushStep(`🤖 ⚠️ ${shortTitle} — ล้มเหลว (${r?.step || '?'}: ${r?.error || 'ไม่ทราบสาเหตุ'})`);
            }
          }
          onToast?.(`ออโต้ส่ง ${autoSent}/${keeperPool.length} ใบ`, autoSent > 0 ? 'ok' : 'warn');
        }
      }
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

  // 🆕 A1 (17 ก.ค. 69): เดิมมีปุ่มส่งคิวสาย URL (sendLead/action:'sendQueue') ตรงนี้ — ถอดออกพร้อมปุ่ม
  //   "🚀 ส่งเข้าคิวเขียน" ใน LeadCard.js แล้ว (เส้นทางเดียวที่เหลือ = แบบข้อความผ่าน extract/sendText/extractAndSend)
  //   action:'sendQueue' ฝั่ง /api/desk/research/leads ยังอยู่ (ไม่แตะ backend) แค่ไม่มี UI เรียกจากหน้านี้แล้ว

  // ============================================================
  //  R6: สกัดเนื้อ (🧲) + ส่งเขียนแบบข้อความ (🚀) — /api/desk/research/extract
  // ============================================================
  async function extractLead(lead) {
    if (!lead?.id) return;
    setBusyLead({ id: lead.id, action: 'extract' });
    const res = await apiFetch('/api/desk/research/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'extract', leadId: lead.id }),
    });
    setBusyLead({ id: '', action: '' });

    if (res.pending) {
      setExtractNotes((m) => ({ ...m, [lead.id]: { kind: 'pending', msg: 'กำลังถอดคลิปอยู่ (เครื่องทีม) — กลับมากดสกัดเนื้อใหม่ภายหลัง' } }));
      onToast?.('คลิปนี้ใช้เวลาถอดนาน — ระบบส่งเข้าคิวถอดแล้ว กลับมากดสกัดเนื้อใหม่ภายหลัง', 'warn');
      return;
    }
    if (res.success) {
      setExtractNotes((m) => { const n = { ...m }; delete n[lead.id]; return n; });
      patchLead(lead.id, { contentReady: true, extractTextLength: res.textLength || 0, insightTopics: res.insightTopics || [] });
      onToast?.(`สกัดเนื้อสำเร็จ (${res.textLength || 0} ตัวอักษร)`, 'ok');
      await afterAction();
    } else {
      setExtractNotes((m) => ({ ...m, [lead.id]: { kind: 'error', msg: res.error || 'สกัดเนื้อไม่สำเร็จ' } }));
      onToast?.(res.error || 'สกัดเนื้อไม่สำเร็จ', 'err');
    }
  }

  async function sendLeadText(lead) {
    if (!lead?.id) return;
    setBusyLead({ id: lead.id, action: 'sendText' });
    const res = await apiFetch('/api/desk/research/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sendText', leadId: lead.id }),
    });
    setBusyLead({ id: '', action: '' });

    if (res.needExtract) {
      onToast?.('ยังไม่มีเนื้อที่สกัด (หรือสั้นเกินไป) — กด "สกัดเนื้อ" ก่อน', 'warn');
      return;
    }
    if (res.alreadySent) {
      setSendNotes((m) => ({ ...m, [lead.id]: { kind: 'sent', msg: 'ส่งเข้าคิวไปแล้วก่อนหน้านี้' } }));
      patchLead(lead.id, { status: 'sent' });
      await afterAction();
      return;
    }
    if (res.success) {
      setSendNotes((m) => ({ ...m, [lead.id]: { kind: 'sent', msg: `ส่งเข้าคิวเขียน (แบบข้อความ) แล้ว${res.jobId ? ` (job ${String(res.jobId).slice(0, 10)})` : ''}` } }));
      patchLead(lead.id, { status: 'sent' });
      onToast?.('ส่งเข้าคิวเขียน (แบบข้อความ) แล้ว', 'ok');
      await afterAction();
    } else {
      setSendNotes((m) => ({ ...m, [lead.id]: { kind: 'error', msg: res.error || 'ส่งเข้าคิวไม่สำเร็จ' } }));
      onToast?.(res.error || 'ส่งเข้าคิวไม่สำเร็จ', 'err');
    }
  }

  // ============================================================
  //  🆕 A1 (17 ก.ค. 69): ปุ่มเดียวจบ (⚡) — extractAndSend รวด extract→distill→ส่ง
  //   ใช้ร่วมกัน 2 ทาง: (ก) กดเองต่อใบจาก LeadCard (auto=false มี busy/toast ต่อใบ)
  //                     (ข) ออโต้หลังล่า วนเรียกทีละใบใน startHunt (auto=true เงียบ busy/toast รายใบ — สรุปรวมทีเดียว)
  // ============================================================
  async function extractAndSendLead(lead, { auto = false } = {}) {
    if (!lead?.id) return null;
    if (!auto) setBusyLead({ id: lead.id, action: 'extractAndSend' });
    const res = await apiFetch('/api/desk/research/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'extractAndSend', leadId: lead.id, auto }),
    });
    if (!auto) setBusyLead({ id: '', action: '' });

    if (res.pending) {
      setExtractNotes((m) => ({ ...m, [lead.id]: { kind: 'pending', msg: 'กำลังถอดคลิปอยู่ (เครื่องทีม) — กลับมากดใหม่ภายหลัง' } }));
      if (!auto) onToast?.('คลิปนี้ใช้เวลาถอดนาน — ระบบส่งเข้าคิวถอดแล้ว กลับมากดใหม่ภายหลัง', 'warn');
      return res;
    }
    if (res.success && res.sent) {
      setExtractNotes((m) => { const n = { ...m }; delete n[lead.id]; return n; });
      setSendNotes((m) => ({ ...m, [lead.id]: { kind: 'sent', msg: `สกัด+ส่งเข้าคิวเขียนแล้ว (${res.cleanLength || 0} ตัวอักษร)${res.jobId ? ` (job ${String(res.jobId).slice(0, 10)})` : ''}` } }));
      patchLead(lead.id, { status: 'sent', contentReady: true });
      if (!auto) onToast?.('สกัด+ส่งเข้าคิวเขียนแล้ว', 'ok');
      await afterAction();
      return res;
    }

    // ล้มเหลว — ระบุ step ที่พัง (extract/distill/send) ให้ผู้ใช้เห็นชัด
    const stepLabel = { extract: 'สกัดเนื้อ', distill: 'กลั่นเนื้อ/บันทึก', send: 'ส่งเข้าคิว' }[res.step] || 'ไม่ทราบขั้น';
    const msg = `${stepLabel}ล้มเหลว: ${res.error || 'ไม่ทราบสาเหตุ'}`;
    if (res.step === 'send') {
      setSendNotes((m) => ({ ...m, [lead.id]: { kind: 'error', msg: res.error || 'ส่งเข้าคิวไม่สำเร็จ' } }));
    } else {
      setExtractNotes((m) => ({ ...m, [lead.id]: { kind: 'error', msg } }));
    }
    if (!auto) onToast?.(msg, 'err');
    return res;
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
          extractNote={extractNotes[lead.id]}
          onKeep={(l) => setStatus(l, 'kept')}
          onDismiss={(l) => setStatus(l, 'dismissed')}
          onExtract={extractLead}
          onExtractAndSend={(l) => extractAndSendLead(l, { auto: false })}
          onSendText={sendLeadText}
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
        autoCfg={autoCfg} onAutoCfgChange={updateAutoCfg}
        onStart={startHunt} hunting={hunting}
      />

      {/* ── E2 (17 ก.ค. 69): แผง บก. AI — คัดลีดจากคลังสะสมให้อัตโนมัติ (หลัง HuntSetup ก่อนผลการล่า) ── */}
      <EditorPanel onToast={onToast} onAfterAction={afterAction} />

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

      {/* ── ส่วน 4: 📓 ประวัติรอบล่า (trace) — โหลดเมื่อกดเปิดเท่านั้น ไม่มี polling ── */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: UI.text }}>📓 ประวัติรอบล่า</span>
          <Btn variant="subtle" onClick={toggleTraceOpen} style={{ marginLeft: 'auto', minHeight: 38, padding: '6px 12px', fontSize: 12.5 }}>
            {traceOpen ? '▲ ซ่อน' : '▼ เปิดดู'}
          </Btn>
          {traceOpen && (
            <Btn variant="subtle" busy={traceLoading} onClick={loadTraceRuns} style={{ minHeight: 38, padding: '6px 12px', fontSize: 12.5 }}>↻ รีเฟรช</Btn>
          )}
        </div>

        {traceOpen && (
          traceLoading ? (
            <div style={{ textAlign: 'center', padding: 26, color: UI.dim }}><Spinner size={18} /> กำลังโหลด…</div>
          ) : traceRuns.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 26, color: UI.muted, fontSize: 13 }}>ยังไม่มีประวัติรอบล่า</div>
          ) : (
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
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
                  {traceRuns.map((run) => {
                    const found = (run.queriesUsed || []).reduce((sum, q) => sum + (Number(q.found) || 0), 0);
                    const cut = (run.judgeLog || []).length;
                    const isOpen = expandedRunId === run.runId;
                    return (
                      <Fragment key={run.runId}>
                        <tr
                          onClick={() => setExpandedRunId(isOpen ? '' : run.runId)}
                          style={{ cursor: 'pointer', borderTop: `1px solid ${UI.line}`, background: isOpen ? UI.card2 : 'transparent' }}
                        >
                          <td style={tdStyle}>{run.at ? new Date(run.at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '-'}</td>
                          <td style={tdStyle}>{fmtNum(run.params?.clusterIds?.length || 0)}</td>
                          <td style={tdStyle}>{fmtNum((run.queriesUsed || []).length)}</td>
                          <td style={tdStyle}>{fmtNum(found)}</td>
                          <td style={tdStyle}>{fmtNum(run.judgeSummary?.kept || 0)}</td>
                          <td style={tdStyle}>{fmtNum(cut)}</td>
                          <td style={tdStyle}>{fmtBaht(run.costTHB || 0)}</td>
                          <td style={tdStyle}>{fmtDuration(run.tookMs || 0)}</td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={8} style={{ padding: 0, border: 'none' }}>
                              <div style={{ background: UI.card2, border: `1px solid ${UI.line}`, borderRadius: 10, padding: 12, margin: '4px 0 10px', display: 'grid', gap: 10 }}>
                                <div>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: UI.text, marginBottom: 6 }}>🔑 คีย์ที่ยิง — เจอกี่ใบ</div>
                                  {(run.queriesUsed || []).length === 0 ? (
                                    <div style={{ fontSize: 12, color: UI.muted }}>ไม่มีข้อมูล</div>
                                  ) : (
                                    <div style={{ display: 'grid', gap: 4 }}>
                                      {run.queriesUsed.map((q, i) => (
                                        <div key={i} style={{ fontSize: 12, color: UI.dim }}>
                                          &ldquo;{q.query}&rdquo; · {q.channel}{q.archetype ? ` · (${q.archetype})` : ''} — เจอ {fmtNum(q.found)} ใบ
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <div>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: UI.text, marginBottom: 6 }}>🗑 ที่ตัดทิ้ง ({fmtNum(cut)})</div>
                                  {(run.judgeLog || []).length === 0 ? (
                                    <div style={{ fontSize: 12, color: UI.muted }}>ไม่มีรายการที่ตัดทิ้ง</div>
                                  ) : (
                                    <div style={{ display: 'grid', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
                                      {run.judgeLog.map((j, i) => (
                                        <div key={i} style={{ fontSize: 12, color: UI.dim, lineHeight: 1.5 }}>
                                          <span style={{ color: UI.muted }}>[{j.stage}{j.score != null ? ` ${j.score}%` : ''}]</span> {String(j.title || '(ไม่มีหัวข้อ)').slice(0, 80)} — {j.reason}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
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

const thStyle = { padding: '6px 8px', fontWeight: 700, whiteSpace: 'nowrap' };
const tdStyle = { padding: '6px 8px', color: 'var(--text-primary)', whiteSpace: 'nowrap' };
