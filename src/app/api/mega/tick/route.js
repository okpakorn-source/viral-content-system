// ============================================================
// 🏭 MEGA — POST /api/mega/tick : เดินสายพาน 1 จังหวะ (ตัวขับหลัก)
// ------------------------------------------------------------
// - ทำ "ทีละงาน ทีละขั้น" (serial-first ตามแผน v3)
// - idempotent: ขั้นที่เคยสำเร็จด้วย input เดิม = ข้าม ไม่จ่ายซ้ำ
// - circuit breaker: งานล้มติดกัน 3 → พักทั้งสาย (ปลดที่ /mega)
// ผู้เรียก: worker เครื่องทีมตอนว่าง / ปุ่มบนหน้า /mega / cron
// ★ 10 ก.ค. Wave1-D: (ก) lease มีเจ้าของ+read-after-write กัน tick ซ้อน · release เคลียร์เฉพาะของตัวเอง
//   (ข) เขียน job state (updateJob) ก่อน ledger (addRun) — กันสำเร็จปลอมถ้า process ตายคากลาง
//   (ค) skip-path เช็ค "หลักฐาน output ในแฟ้ม" ก่อนข้าม (ไม่มีหลักฐาน = รันซ้ำแทนข้าม)
// ============================================================

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { listJobs, getJob, updateJob, addRun, findDoneRun, listRuns, getFlags, setFlags } from '@/lib/megaJobStore';
import { STAGE_FLOW, unclaimCard } from '@/lib/megaAdapters';
import { acquireTickLease, releaseTickLease } from '@/lib/megaTickLease';

export const runtime = 'nodejs';
export const maxDuration = 600;

const MAX_STAGE_ATTEMPTS = 2;
// ป้ายปลายทางของแต่ละเฟส (ไม่ใช่ stage ที่รันได้ — เป็น status จบ)
// ★ Wave2 A1: needs_gap_search / manual_review = สถานะ terminal ใหม่จากด่าน QC (มาทาง nextAction:'hold'
//   ไม่ใช่ stageDef.next) — งานหยุด ไม่ถูกเลือกซ้ำ (job picker เอาแค่ running/waiting/pending) ไม่วน retry
const TERMINALS = new Set(['content_ready', 'assets_ready', 'cover_ready', 'needs_gap_search', 'manual_review', 'insufficient_assets', 'cancelled']); // ★ W2-B1: insufficient_assets = hero-grade ไม่ถึงเกณฑ์หลัง gap search · ★ R2: cancelled = ผู้ใช้ยกเลิกงานคิว (terminal — picker ไม่หยิบ running/waiting/pending อยู่แล้ว)

// ★ Wave1-D (ค): แผนที่ "หลักฐาน output ในแฟ้ม" ต่อ stage — อิง dossierPatch จริงที่แต่ละ adapter คืน
//   (s3_generate→generate.queueJobId · s5_case→images.caseId · s6_slots→pickImages.slots ·
//    s7_cover→cover.queueJobId · s7_wait→cover.coverPath) — ใช้ != null (แยก "อัปแฟ้มแล้ว" ออกจาก "ยังไม่อัป"
//    ให้ค่าที่ falsy ได้เช่น '' ยังนับเป็นหลักฐาน) · stage ที่ไม่อยู่ในแผนที่ = ข้ามได้ตามพฤติกรรมเดิม
const STAGE_EVIDENCE = {
  s3_generate: (d) => d.generate?.queueJobId != null,
  s5_case: (d) => d.images?.caseId != null,
  s6_slots: (d) => d.pickImages?.slots != null,
  s7_cover: (d) => d.cover?.queueJobId != null,
  s7_wait: (d) => d.cover?.coverPath != null,
};
function hasStageEvidence(stage, dossier) {
  const check = STAGE_EVIDENCE[stage];
  if (!check) return true; // ไม่อยู่ในแผนที่ = ข้ามได้ตามเดิม
  try { return !!check(dossier || {}); } catch { return true; }
}

// ★ 15 ก.ค. (แบตช์ 2 — N1-zombie bounded hold): PURE decision ให้ทดสอบแยกได้
//   s6_slots ใต้ MEGA_REF_HERO_V2=1 คืน { status:'waiting', nextAction:'wait',
//   dossierPatch:{ pickImages:{ refHeroV2:{ ok:false, hold:'REF_HERO_V2_...' } } } } ได้ตลอดกาล —
//   ตัวนับ attempt ของ tick นับเฉพาะ status='failed' → งานคิว V2 ค้างเป็น zombie ไม่มีวันตาย
//   นับใน job.refHeroV2HoldCount (top-level field, updateJob shallow-merge ให้อยู่รอดข้าม tick)
//   ครบ 3 รอบ "ติดกันจริง" = ปิดงานกัน zombie — ผลอื่นคั่น (continue/goto/retry/wait ไร้ marker)
//   จะรีเซ็ตผ่าน _holdReset (audit sol: S6 fetch สะดุด→retry คั่นได้ ห้ามนับข้ามช่วง)
//   marker ต้องเป็นสตริง 'REF_HERO_V2*' เท่านั้น (audit: กัน truthy แปลกปลอม) · ไม่มี marker = ไม่แตะ (isV2Hold:false)
export function _v2HoldDecision(job, result, env) {
  const raw = result?.dossierPatch?.pickImages?.refHeroV2?.hold;
  let holdCode = (typeof raw === 'string' && raw.startsWith('REF_HERO_V2')) ? raw : null;
  // ★ sol R2 (High): carrier V2 ค้างในแฟ้มจากรอบก่อน + render latch ปิด (rollback env / worker คนละ config)
  //   → S7 คืน wait "ไร้ marker" ตลอดกาล = starvation (waiting ชนะ pending ใน job picker) และ pre-flight env
  //   จับไม่ได้เพราะ flag V2 ปิดไปแล้ว — นับเป็น hold สังเคราะห์เข้า bounded เดียวกัน (ฟื้นได้ถ้าเปิด latch
  //   ทันภายใน 2 tick) · งานไม่มี carrier ในแฟ้ม = ไม่แตะเด็ดขาด
  //   (sol R3: เช็คแบบ own-property ให้ตรง semantics ของ S7 เป๊ะ — carrier ค้างเป็น null/falsy ก็ยังนับ)
  const _pick = job?.dossier?.pickImages;
  const _hasCarrier = !!_pick && typeof _pick === 'object' && Object.prototype.hasOwnProperty.call(_pick, 'refHeroV2');
  if (!holdCode && result?.nextAction === 'wait' && _hasCarrier && env?.MEGA_STRICT_RENDER !== '1') {
    holdCode = 'REF_HERO_V2_CARRIER_WITHOUT_RENDER_LATCH';
  }
  if (!holdCode) return { isV2Hold: false, holdCount: 0, shouldFail: false, holdCode: null };
  const holdCount = (job?.refHeroV2HoldCount || 0) + 1;
  return { isV2Hold: true, holdCount, shouldFail: holdCount >= 3, holdCode };
}

// ★ ตัวนับ hold ต้อง "ติดกัน" จริง — patch รีเซ็ตแบบมีเงื่อนไข: งานที่ไม่เคยมี field ได้ patch ว่าง
//   = ก้อน updateJob เดิมทุก byte (เส้นงานปกติ/flag OFF ไม่ขยับแม้แต่ key เดียว)
export const _holdReset = (job) => (job?.refHeroV2HoldCount ? { refHeroV2HoldCount: 0 } : {});

// ★ V2 producer เปิดแต่ render latch ปิด = misconfig ระดับระบบ: ทุกงานจะแนบ carrier แล้วไปตายตัน S7
//   (consumer ตั้งใจ HOLD ห้าม downgrade → waiting "ไร้ marker" ที่ bounded-hold มองไม่เห็น → starve คิว)
//   PURE ให้เทสได้ — ใช้พักสายพานที่ t=0 แบบไม่แตะงานใด (audit code-auditor ประเด็นสำคัญสุด)
export const _v2ConfigMismatch = (env) => env?.MEGA_REF_HERO_V2 === '1' && env?.MEGA_STRICT_RENDER !== '1';

function stageInputHash(job) {
  // input ประจำขั้น — เปลี่ยนเมื่อของที่ขั้นนี้ใช้เปลี่ยน (กันเอาผลเก่าปน input ใหม่)
  const d = job.dossier || {};
  const basis = {
    stage: job.stage,
    card: d.desk?.cardId || null,
    extractChars: d.extract?.chars || 0,
    queueJobId: d.generate?.queueJobId || null,
    versions: (d.generate?.versions || []).length,
    // รอบแก้ตัว S3 ต้องได้ key ใหม่ (บั๊กเทสทองคำ: basis ซ้ำรอบแรก → โดน idempotent ข้ามการส่งใหม่)
    retriedWithText: !!d.generate?.retriedWithText,
    // rewind ด้วยมือ = เจตนารันใหม่ → เลขรอบต้องพา key หนีผลเก่าทุกขั้น
    rewind: d.rewind || 0,
    // เฟส 2: caseId เป็น input ของทุกขั้น S5/S6 หลังเปิดเคส (ห้ามใส่ค่าที่ "ขั้นตัวเองเขียน" — กติกาเดียวกับ queueJobId)
    imagesCase: d.images?.caseId || null,
    // เฟส 3: เลขงานปก + รอบแก้ตัวปก (กติกาเดียวกับ S3)
    coverJobId: d.cover?.queueJobId || null,
    coverRetried: !!d.cover?.retriedCover,
  };
  return crypto.createHash('sha256').update(JSON.stringify(basis)).digest('hex').slice(0, 16);
}

// ★ Q3-1: แยกแกนเดินสายพานออกจาก handler — GET (Vercel cron) กับ POST (worker/UI) เรียกตัวเดียวกัน
//   ไม่พึ่ง req.json() (POST เดิมก็ไม่เคยอ่าน body — ใช้แค่ req.nextUrl.origin) → พฤติกรรม POST byte-identical
async function _runTick(req) {
  let locked = false;
  let leaseToken = null;
  try {
    const flags = await getFlags();
    if (flags.paused) {
      return NextResponse.json({ success: true, idle: true, paused: true, message: `⛔ สายพานถูกพัก (ล้มติดกัน ${flags.consecutiveFails}) — ปลดที่หน้า /mega` });
    }
    // ★ 15 ก.ค. (แบตช์ 2 — audit): env V2 ไม่ครบคู่ = พักสายพานที่ t=0 โดยไม่แตะ/ไม่ฆ่างานใด
    //   (แก้ env ให้ครบแล้วงานเดินต่อได้เอง) — กัน zombie ฝั่ง S7 carrier-without-latch + กันเผา s1-s6 ฟรีทุกงาน
    //   sol R2: ตอบ 503 typed error ตาม convention (ไม่ใช่ 200+idle ที่ UI ตีความเป็น "ไม่มีงาน" ซ่อน misconfig)
    if (_v2ConfigMismatch(process.env)) {
      return NextResponse.json({ success: false, configMismatch: true, errorType: 'STRICT_CONFIG_MISMATCH', error: 'MEGA_REF_HERO_V2=1 ต้องเปิด MEGA_STRICT_RENDER=1 คู่กัน — สายพานพักจนกว่า env ครบ (ไม่มีงานถูกแตะ)' }, { status: 503 });
    }
    // 🔒 ล็อกกัน tick ซ้อน (worker+UI พร้อมกัน = รันขั้นซ้ำจ่ายซ้ำ) — ★ Wave1-D (ก): lease มีเจ้าของ + read-after-write
    //   เดิม อ่าน→เช็ค→เขียน คนละ round-trip = 2 tick อ่านพร้อมกันก่อนใครเขียน = ผ่านทั้งคู่ · ล็อกเก่าเกิน 10 นาที = ถือว่าตาย
    const lease = await acquireTickLease({ getFlags, setFlags });
    if (!lease.ok) {
      return NextResponse.json({ success: true, idle: true, busy: true, message: 'มี tick อื่นกำลังเดินอยู่' });
    }
    locked = true;
    leaseToken = lease.token;

    // เลือกงาน: running > waiting > pending (ทีละงาน)
    const jobs = await listJobs(50);
    const job =
      jobs.find((j) => j.status === 'running') ||
      jobs.find((j) => j.status === 'waiting') ||
      jobs.slice().reverse().find((j) => j.status === 'pending') ||
      null;
    if (!job) return NextResponse.json({ success: true, idle: true, message: 'ไม่มีงานให้เดิน' });

    const stageDef = STAGE_FLOW[job.stage];
    if (!stageDef) {
      await updateJob(job.id, { status: 'failed' });
      return NextResponse.json({ success: false, error: `ไม่รู้จักขั้น ${job.stage}` });
    }

    // ★ Q3 hotfix (17 ก.ค. — เทสจริง MG-0008): Vercel cron ยิงเข้า deployment URL ที่ติด SSO protection
    //   → req.nextUrl.origin กลายเป็น origin ที่ fetch ภายใน (s5_case→/api/analyze ฯลฯ) โดน 401 HTML ตายทุกขั้น
    //   override ด้วย env MEGA_TICK_ORIGIN (Vercel ตั้ง = public alias) · ไม่ตั้ง = พฤติกรรมเดิมเป๊ะ (เครื่องทีม/local)
    const origin = (process.env.MEGA_TICK_ORIGIN || '').trim() || req.nextUrl.origin;
    const idemKey = `${job.id}:${job.stage}:${stageInputHash(job)}`;

    // idempotency: ขั้นนี้+input นี้เคยสำเร็จแล้ว → เลื่อนต่อเลย ไม่รันซ้ำ
    //   ★ Wave1-D (ค): แต่ต้องมี "หลักฐาน output ในแฟ้ม" ของ stage นั้นจริง — กัน done-run ที่ dossierPatch หาย
    //   (เช่น process ตายคากลางก่อนอัปแฟ้มในโค้ดรุ่นเก่า) หลุดข้าม stage ด้วย patch ที่ไม่มี dossier
    const prior = await findDoneRun(job.id, job.stage, idemKey);
    if (prior && hasStageEvidence(job.stage, job.dossier)) {
      // ★ R2 (Q1 — พี่น้องของการ์ด F1 ด้านล่าง): re-check cancelled ก่อนเขียน advance — snapshot ตอนเลือกงาน
      //   อาจเก่ากว่าปุ่มยกเลิกที่เพิ่งกด ถ้าเขียนตรงๆ จะชุบ cancelled กลับเป็น running/next
      const freshSkip = await getJob(job.id);
      if (freshSkip && freshSkip.status === 'cancelled') {
        return NextResponse.json({ success: true, jobId: job.id, stage: job.stage, cancelled: true, skipped: 'งานถูกยกเลิกแล้ว — ไม่เลื่อนขั้น' });
      }
      const next = stageDef.next;
      const patch = TERMINALS.has(next) ? { status: next, stage: next } : { stage: next, status: 'running' };
      await updateJob(job.id, patch);
      return NextResponse.json({ success: true, jobId: job.id, stage: job.stage, skipped: 'เคยสำเร็จแล้ว (idempotent) → เลื่อนขั้นถัดไป' });
    }
    if (prior) {
      console.warn(`[MEGA tick] ⚠️ skip-guard: ${job.id} ${job.stage} มี done-run แต่แฟ้มไม่มี output ของขั้นนี้ — รันซ้ำแทนการข้าม`);
    }

    if (job.status === 'pending') await updateJob(job.id, { status: 'running' });

    // นับ attempt ของขั้นนี้ — ★ audit B-R1 (9 ก.ค.): นับเฉพาะรอบที่ "พังจริง" (status='failed')
    //   เดิมนับรวมรอบ waiting (s5_triage/s7_wait สะสมหลายรอบเป็นปกติ) → network blip เดียว (:3000 restart ~5s)
    //   ทำ attempt เกินเพดานทันที job ตายทั้งงาน — ขัดดีไซน์ "รอทำซ้ำจนสำเร็จ"
    const runs = await listRuns(job.id);
    const attempt = runs.filter((r) => r.stage === job.stage && r.idempotencyKey === idemKey && r.status === 'failed').length + 1;

    let result;
    try {
      result = await stageDef.run(job, { origin });
    } catch (err) {
      result = { status: 'failed', nextAction: attempt >= MAX_STAGE_ATTEMPTS ? 'fail' : 'retry', summary: 'ขั้นพัง: ' + err.message };
    }

    // บันทึกผลลงแฟ้ม + ไทม์ไลน์
    const stagesDone = [...(job.stagesDone || [])];
    if (result.status === 'done') stagesDone.push({ stage: job.stage, label: stageDef.label, at: new Date().toISOString(), summary: result.summary });
    const worstQuality = result.quality === 'red' ? 'red' : result.quality === 'yellow' && job.quality !== 'red' ? 'yellow' : job.quality;
    const basePatch = { dossier: result.dossierPatch || {}, stagesDone, quality: worstQuality };

    // ★ R2 (Q1 — F1 cancel-during-running): stageDef.run ใช้เวลานาน (หา/ประกอบภาพ) — ผู้ใช้อาจกด
    //   ยกเลิกงานคิวระหว่างนั้น (action:'cancel' → status:'cancelled' ในคลัง) แต่ tick ถือ snapshot 'running'
    //   จากตอนเลือกงาน ถ้าเขียน advance ตรงๆ (updateJob({status:'running'/next}) จะ "ทับ" cancelled กลับ
    //   → งานเดินต่อจนจบ+archive = ปุ่มยกเลิกล้มแบบสุ่ม (fail 'tick ไม่หยิบต่อ')
    //   แก้: อ่านสถานะล่าสุดจากคลัง "ก่อน" เขียน advance — ถ้าเป็น 'cancelled' (terminal) ห้าม advance/overwrite
    //   คงสถานะ cancelled ไว้ + ยังบันทึก ledger run (ประวัติว่า stage นี้ทำงานไปแล้ว) แล้วจบ tick
    const fresh = await getJob(job.id);
    if (fresh && fresh.status === 'cancelled') {
      await addRun(job.id, job.stage, {
        status: result.status,
        attempt,
        idempotencyKey: idemKey,
        summary: result.summary || '',
        error: result.status === 'failed' ? result.summary : undefined,
      });
      return NextResponse.json({
        success: true,
        jobId: job.id,
        stage: job.stage,
        stageLabel: stageDef.label,
        cancelled: true,
        result: { status: result.status, nextAction: result.nextAction || 'continue', summary: result.summary },
      });
    }

    // เดินหน้า/หยุด ตาม nextAction
    const act = result.nextAction || 'continue';
    if (act === 'continue') {
      const next = stageDef.next;
      if (TERMINALS.has(next)) {
        await updateJob(job.id, { ...basePatch, stage: next, status: next, ..._holdReset(job) });
        await setFlags({ consecutiveFails: 0 });
      } else {
        await updateJob(job.id, { ...basePatch, stage: next, status: 'running', ..._holdReset(job) });
      }
    } else if (act === 'wait') {
      // ★ 15 ก.ค. (แบตช์ 2 — N1-zombie bounded hold): เฉพาะ marker refHeroV2.hold เท่านั้นที่นับสะสม+ปิดงาน
      //   waiting อื่น (s5_triage/s5_search/s7 strict_render_not_armed dormancy) = เส้นทางเดิม byte-identical
      const v2 = _v2HoldDecision(job, result, process.env);
      if (v2.isV2Hold) {
        if (v2.shouldFail) {
          await updateJob(job.id, { ...basePatch, status: 'failed', quality: 'red', refHeroV2HoldCount: v2.holdCount, summary: `V2 hold ซ้ำ ${v2.holdCount} รอบ: ${v2.holdCode} — ปิดงานกัน zombie` });
          // คืนการ์ดเหมือนทุกเส้น failed (audit: การ์ด claim ไม่มี TTL และ cleanup ไม่เก็บ — ไม่คืน = หัวข่าวล็อกถาวร)
          await unclaimCard(job, { origin }).catch(() => {});
          // นโยบาย breaker: ไม่ bump consecutiveFails (แนวเดียวกับ act==='hold' — fail-closed โดยดีไซน์ ไม่ใช่ระบบพัง
          //   ห้ามพาทั้งสายพาน pause เพราะ config/ข้อมูลงานเดียว) และไม่ reset=0 (ไม่ได้พิสูจน์ว่าท่อทั้งเส้นทำงานครบ)
        } else {
          await updateJob(job.id, { ...basePatch, status: 'waiting', refHeroV2HoldCount: v2.holdCount });
        }
      } else {
        await updateJob(job.id, { ...basePatch, status: 'waiting', ..._holdReset(job) });
      }
    } else if (act === 'hold') {
      // ★ Wave2 A1: ด่าน QC ตีกลับ — จบงานด้วยสถานะ terminal ที่บอกความจริง (needs_gap_search/manual_review)
      //   คงขั้นเดิม (s7_wait) ไว้ให้เห็นว่าหยุดตรงไหน · ไม่นับเป็น consecutiveFails (นี่คือการตัดสินใจถูก ไม่ใช่ระบบพัง)
      //   รีเซ็ต consecutiveFails=0 เหมือนงานถึงปลายเฟส: ท่อทั้งสายทำงานครบ (extract→gen→หาภาพ→ประกอบ→เรนเดอร์)
      //   = พิสูจน์ระบบไม่พัง จึงไม่ควรค้าง streak ล้มเดิมไว้ทริกเกอร์ circuit breaker
      const holdStatus = ['needs_gap_search', 'manual_review', 'insufficient_assets'].includes(result.holdStatus) ? result.holdStatus : 'manual_review'; // กันค่าเพี้ยน → ให้คนดู · ★ W2-B1 เพิ่ม insufficient_assets
      await updateJob(job.id, { ...basePatch, status: holdStatus });
      await setFlags({ consecutiveFails: 0 });
    } else if (act.startsWith('goto:')) {
      await updateJob(job.id, { ...basePatch, stage: act.slice(5), status: 'running', ..._holdReset(job) });
    } else if (act === 'retry') {
      if (attempt >= MAX_STAGE_ATTEMPTS) {
        // ★ Q3 hotfix: เก็บสาเหตุล้มลง job.summary (แพทเทิร์นเดียวกับ V2 hold ด้านบน) — เดิมสาเหตุอยู่แค่ใน
        //   ledger ซึ่งเขียนหลังสุด/อาจหาย → UI เห็นแต่ "ล้มเหลว" เปล่าๆ ขัดเป้าหมาย "งานตายต้องเห็นสาเหตุ"
        await updateJob(job.id, { ...basePatch, status: 'failed', quality: 'red', summary: (result.summary || '').slice(0, 300) });
        await unclaimCard(job, { origin }).catch(() => {});
        const f = await getFlags();
        await setFlags({ consecutiveFails: (f.consecutiveFails || 0) + 1, paused: (f.consecutiveFails || 0) + 1 >= 3 });
      } else {
        await updateJob(job.id, { ...basePatch, ..._holdReset(job) }); // คงขั้นเดิม รอ tick หน้า retry (+รีเซ็ตตัวนับ hold — retry คั่น = ไม่ "ติดกัน" แล้ว)
      }
    } else {
      // fail — ★ Q3 hotfix: เก็บสาเหตุลง job.summary เช่นเดียวกับ retry-exhausted (ดูเหตุผลด้านบน)
      await updateJob(job.id, { ...basePatch, status: 'failed', summary: (result.summary || '').slice(0, 300) });
      await unclaimCard(job, { origin }).catch(() => {});
      const f = await getFlags();
      await setFlags({ consecutiveFails: (f.consecutiveFails || 0) + 1, paused: (f.consecutiveFails || 0) + 1 >= 3 });
    }

    // ★ Wave1-D (ข): เขียน ledger "หลัง" job state เสร็จ — ให้ ledger เป็นบันทึกประวัติ ไม่ใช่ตัวตัดสิน
    //   เดิม addRun ก่อน updateJob: process ตายคากลาง → รอบหน้า idempotency เห็น done แล้วข้าม stage
    //   ด้วย patch ที่ไม่มี dossier (เคสร้ายสุด s7_wait→cover_ready = สำเร็จปลอมไม่มีปก)
    //   ผลถ้า addRun ล้มหลัง updateJob สำเร็จ: stage เดินไปแล้ว re-run ขั้นเดิมไม่เกิด — แค่ประวัติหาย 1 แถว (ยอมรับได้)
    await addRun(job.id, job.stage, {
      status: result.status,
      attempt,
      idempotencyKey: idemKey,
      summary: result.summary || '',
      error: result.status === 'failed' ? result.summary : undefined,
    });

    return NextResponse.json({
      success: true,
      jobId: job.id,
      stage: job.stage,
      stageLabel: stageDef.label,
      result: { status: result.status, nextAction: act, summary: result.summary },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message, errorType: 'UNEXPECTED' }, { status: 500 });
  } finally {
    // ปลดล็อกทุกทางออก (รวม idle/idempotent-return) — ★ Wave1-D (ก): เคลียร์เฉพาะ lease ที่เราถือ (owner token ตรง)
    //   เดิม setFlags(tickLockAt:null) ล้วน = tick เก่าค้าง >10 นาที กลับมาล้าง lease ของ tick ใหม่ได้
    if (locked) await releaseTickLease({ getFlags, setFlags }, leaseToken).catch(() => {});
  }
}

// worker เครื่องทีม / ปุ่มบนหน้า /mega+/cover-ref-test → เดิน 1 จังหวะ (พฤติกรรมเดิมทุก byte)
export async function POST(req) {
  return _runTick(req);
}

// ★ Q3-1: Vercel cron ยิง GET เสมอ — ปิดไว้เป็น default (สวิตช์ตามวินัยโปรเจกต์)
//   เปิดด้วย MEGA_CRON_TICK=1 (exact) เท่านั้น จึงเดินแกนเดียวกับ POST · ปิดอยู่ = 200 ไม่แตะงานใด
export async function GET(req) {
  if (process.env.MEGA_CRON_TICK !== '1') {
    return NextResponse.json({ success: true, skipped: 'MEGA_CRON_TICK ปิดอยู่' });
  }
  return _runTick(req);
}
