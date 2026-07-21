/**
 * ============================================================
 * 🏢🔫 POST /api/company/newsdesk-run — ตัวกลางให้ "แผนกโต๊ะข่าว (Fable & Co.)" สั่งรันรอบหาข่าว "จริง"
 * ============================================================
 * ปัญหาเดิม: หน้าเว็บ /news-desk (ResearchTab) เย็บ 4 ขั้นเองในเบราว์เซอร์
 *   (hunt → judge/saveBatch ต่อคลัสเตอร์ → trace logRun) — ไม่มีตัวกลางฝั่ง server
 *   เวลาเอเจนต์/แชทแผนก "สั่งหาข่าว" เลยไม่มีรอบจริงเกิดในระบบโต๊ะข่าว
 *
 * endpoint นี้ = เล่นซ้ำลำดับเดียวกันฝั่ง server (เรียก endpoint สาธารณะเดิมทั้งหมด
 *   ไม่แตะ/ไม่แก้ไพป์ไลน์ข่าวที่ล็อกไว้เลย — เหมือน "กดปุ่มหาข่าว" แทนคน)
 * → ผลลัพธ์เป็น "รอบล่า" จริงที่โผล่ในหน้า /news-desk (เก็บผ่าน createStore = Supabase)
 *
 * body (ทุกฟิลด์ optional — ดีฟอลต์ตั้งเล็กเพื่อคุมต้นทุน):
 *   { topClusters?=2, queriesPerCluster?=3, channels?=['google','facebook','youtube'], model?='fast' }
 *
 * 🔴 ขอบเขต: รอบนี้ "หา+คัด+เก็บลีด" เท่านั้น — การ "ส่งเข้าคิวเขียน/เผยแพร่" ยังต้องผู้ใช้อนุมัติแยก (ไม่ auto)
 */
import { NextResponse } from 'next/server';
import { writeFeed } from '@/lib/company/companyFeed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const KNOWN_CHANNELS = ['videos', 'facebook', 'tiktok', 'youtube', 'google'];
const JUDGE_MAX_PER_CLUSTER = 16; // ตรงกับ ResearchTab.js (คุมต้นทุน AI)
const KEEP_MIN_SCORE = 60;        // ตรงกับ ResearchTab.js

export async function POST(request) {
  const t0 = Date.now();
  try {
    const body = await request.json().catch(() => ({}));

    // ── คุมต้นทุน: ตั้งเพดานเล็ก (แผนกสั่งบ่อยได้ ไม่เผาเงิน) ──
    const topClusters = Math.min(5, Math.max(1, Number(body?.topClusters) || 2));
    const queriesPerCluster = Math.min(4, Math.max(1, Number(body?.queriesPerCluster) || 3));
    const model = typeof body?.model === 'string' && body.model ? body.model : 'fast';
    let channels = Array.isArray(body?.channels) ? body.channels.filter((c) => KNOWN_CHANNELS.includes(c)) : [];
    if (channels.length === 0) channels = ['google', 'facebook', 'youtube'];

    const base = new URL(request.url).origin;
    const runId = 'rrun_' + Date.now().toString(36);
    const steps = [];
    const jFetch = async (path, init) => {
      const res = await fetch(base + path, init);
      const json = await res.json().catch(() => ({ success: false, error: 'ตอบไม่ใช่ JSON (' + res.status + ')' }));
      return json;
    };

    // ── (0) เลือกคลัสเตอร์เด่นจากคลัง DNA ──
    const libRes = await jFetch('/api/desk/dna/library?view=clusters', { method: 'GET' });
    const clusters = (libRes && libRes.clusters) || [];
    const clusterIds = clusters
      .map((c) => c && c.clusterId)
      .filter((x) => typeof x === 'string' && x && x !== 'ไม่มีคลัสเตอร์')
      .slice(0, topClusters);
    if (clusterIds.length === 0) {
      try { await writeFeed({ scope: 'newsdesk', kind: 'result', agent: 'mod', text: '⚠️ รอบหาข่าวติดปัญหา: คลังคลัสเตอร์ว่าง (ยังไม่มี DNA ให้ตามรอย)' }); } catch (_e) {}
      return NextResponse.json({
        success: false,
        error: 'คลังคลัสเตอร์ว่าง — ยังไม่มี DNA ให้ตามรอย (ไปเติมที่ DNA Lab ก่อน)',
        errorType: 'NO_CLUSTERS',
      }, { status: 409 });
    }
    steps.push('เลือก ' + clusterIds.length + ' คลัสเตอร์');
    // 📡 แจ้ง "เริ่มงาน" ลงคลังสด → จอทุกเครื่องเห็นว่ากำลังหาข่าว
    try { await writeFeed({ scope: 'newsdesk', kind: 'status', agent: 'mod', text: '🔄 เริ่มรอบหาข่าวจริง ' + clusterIds.length + ' คลัสเตอร์ · กำลังค้น…' }); } catch (_e) {}

    // ── (1) hunt ──
    const hRes = await jFetch('/api/desk/research/hunt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clusterIds, topClusters: clusterIds.length, queriesPerCluster, channels, perQueryResults: 10 }),
    });
    if (!hRes.success) {
      try { await writeFeed({ scope: 'newsdesk', kind: 'result', agent: 'mod', text: '⚠️ รอบหาข่าวติดปัญหา (ค้นล้มเหลว): ' + (hRes.error || 'ไม่ทราบสาเหตุ') }); } catch (_e) {}
      return NextResponse.json({ success: false, error: hRes.error || 'ยิงค้นข่าวล้มเหลว', errorType: 'HUNT_FAILED', runId }, { status: 502 });
    }
    const candidates = hRes.candidates || [];
    const huntStats = hRes.stats || {};
    steps.push('ค้นเจอ ' + candidates.length + ' ใบ (฿' + (Number(huntStats.estCostTHB) || 0).toFixed(2) + ')');

    // ── trace: นับ found ต่อ {คลัสเตอร์,คีย์,ช่อง} (เหมือน ResearchTab) ──
    const queriesUsedMap = new Map();
    for (const c of candidates) {
      const key = (c.clusterId || '') + '|' + (c.query || '') + '|' + (c.channel || '');
      if (!queriesUsedMap.has(key)) {
        queriesUsedMap.set(key, { clusterId: c.clusterId || '', archetype: c.clusterArchetype || '', query: c.query || '', channel: c.channel || '', found: 0 });
      }
      queriesUsedMap.get(key).found += 1;
    }

    // ── (2) จัดกลุ่มตามคลัสเตอร์ → judge ทีละคลัสเตอร์ → saveBatch ──
    const byCluster = new Map();
    for (const c of candidates) {
      const k = c.clusterId || '';
      if (!k) continue;
      if (!byCluster.has(k)) byCluster.set(k, []);
      byCluster.get(k).push(c);
    }
    let totalSaved = 0;
    const runJudgeLogAgg = [];
    const judgeSummaryAgg = { judged: 0, kept: 0, dropGate: 0, dropDedup: 0, dropSame: 0, lowScore: 0 };

    for (const clusterId of byCluster.keys()) {
      const batch = (byCluster.get(clusterId) || [])
        .slice()
        .sort((a, b) => (Number(a.position) || 99) - (Number(b.position) || 99))
        .slice(0, JUDGE_MAX_PER_CLUSTER);
      if (batch.length === 0) continue;

      const jRes = await jFetch('/api/desk/research/judge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidates: batch, clusterId, model }),
      });
      if (!jRes.success) { steps.push('คลัสเตอร์ ' + clusterId + ': ตัดสินล้มเหลว — ข้าม'); continue; }

      const judged = jRes.judged || [];
      const dropped = jRes.dropped || [];
      const keepers = judged.filter((j) => j.verdict === 'keep' && (Number(j.matchScore) || 0) >= KEEP_MIN_SCORE);

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
        const sRes = await jFetch('/api/desk/research/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'saveBatch', leads: keepers, runId }),
        });
        if (sRes.success) totalSaved += Number(sRes.saved) || 0;
      }
    }
    steps.push('เก็บลีดใหม่ ' + totalSaved + ' ใบ');

    // ── (3) ดึงลีดของรอบนี้ + บันทึกสมุด (logRun) ให้โผล่ใน "รอบล่า" ──
    let mine = [];
    const rRes = await jFetch('/api/desk/research/leads?limit=500', { method: 'GET' });
    if (rRes.success) {
      mine = (rRes.leads || [])
        .filter((l) => l.runId === runId)
        .sort((a, b) => (Number(b.matchScore) || 0) - (Number(a.matchScore) || 0));
    }
    const tookMs = Date.now() - t0;

    // fire logRun (ถ้าพังไม่ทำ flow หลักล้ม)
    try {
      await jFetch('/api/desk/research/trace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'logRun',
          run: {
            runId,
            trigger: 'company', // ★ มาจากบริษัท (แยกจาก 'manual' ของหน้าเว็บ)
            params: { clusterIds, channels, queriesPerCluster, model },
            queriesUsed: Array.from(queriesUsedMap.values()),
            huntStats,
            judgeSummary: judgeSummaryAgg,
            judgeLog: runJudgeLogAgg,
            savedLeadIds: mine.map((l) => l.id),
            costTHB: Number(huntStats.estCostTHB) || 0,
            tookMs,
          },
        }),
      });
    } catch (_e) { /* fire-and-forget */ }

    // 📡 บันทึกผลรอบลงคลังกิจกรรมสด → จอโต๊ะข่าวเห็นผลเรียลไทม์
    try {
      const doneMsg = totalSaved > 0
        ? ('✅ จบรอบหาข่าว: เจอ ' + candidates.length + ' · เก็บ ' + totalSaved + ' ลีด · ฿' + (Number(huntStats.estCostTHB) || 0).toFixed(2) + ' · ' + Math.round(tookMs / 1000) + ' วิ')
        : ('☑️ จบรอบหาข่าว: เจอ ' + candidates.length + ' แต่ไม่มีลีดเข้าเกณฑ์รอบนี้ · ฿' + (Number(huntStats.estCostTHB) || 0).toFixed(2));
      await writeFeed({ scope: 'newsdesk', kind: 'result', agent: 'mod', text: doneMsg,
        meta: { runId, found: candidates.length, kept: totalSaved, costTHB: Number(huntStats.estCostTHB) || 0 } });
    } catch (_e) { /* fire-and-forget */ }

    return NextResponse.json({
      success: true,
      runId,
      found: candidates.length,
      judged: judgeSummaryAgg.judged,
      kept: judgeSummaryAgg.kept,
      saved: totalSaved,
      costTHB: Number(huntStats.estCostTHB) || 0,
      tookMs,
      steps,
      leads: mine.slice(0, 12).map((l) => ({ id: l.id, title: l.title || '', matchScore: Number(l.matchScore) || 0, status: l.status || '' })),
      newsDeskUrl: base + '/news-desk',
      note: 'ลีด verdict=keep เก็บเข้าคลังแล้ว — การส่งเข้าคิวเขียน/เผยแพร่ยังต้องผู้ใช้อนุมัติแยก (ไม่ auto)',
    });
  } catch (error) {
    console.error('[company/newsdesk-run POST]', error?.message);
    try { await writeFeed({ scope: 'newsdesk', kind: 'result', agent: 'mod', text: '⚠️ รอบหาข่าวติดปัญหา: ' + (error?.message || 'ระบบขัดข้อง') }); } catch (_e) {}
    return NextResponse.json({
      success: false,
      error: error?.message || 'รันรอบหาข่าวล้มเหลว',
      errorType: 'NEWSDESK_RUN_ERROR',
      tookMs: Date.now() - t0,
    }, { status: 500 });
  }
}
