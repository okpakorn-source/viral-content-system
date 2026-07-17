/**
 * =====================================================
 * 🚪 Editor Outbox (P1) — "ห้องรอ" ของ บก. AI ก่อนเข้าคิวเขียนจริง (โต๊ะข่าวกลาง v2, 17 ก.ค. 69)
 * =====================================================
 * มารยาทคิวของ บก.: บก. คัดข่าว → เข้า "ห้องรอ" (STORE นี้) → คนเฝ้าประตู (dispatchOne, cron ทุก 1 นาที)
 * ปล่อยเข้าคิวเขียนจริงทีละใบ "เฉพาะตอนคิวว่างสนิท" (pending===0 && processing===0) —
 * มีงานพนักงาน (Discord) เข้ามากลางทาง → หยุดปล่อยให้งานพนักงานวิ่งก่อนเสมอ (เช็คคิวจริงทุกครั้งก่อนปล่อย)
 *
 * 🔴 pure JS + relative import ล้วน (ให้ node เรียกเทสตรงได้ ไม่ง้อ alias @/)
 * 🔴 ห้ามแตะระบบคิวเขียนทุกไฟล์ (/api/queue/**, queueService.js, discord-bot) — ไฟล์นี้อ่าน
 *    GET /api/queue/status (read-only) เท่านั้น เพื่อเช็คว่าคิวว่างสนิทหรือไม่ ห้ามเขียน/บายพาสเด็ดขาด
 * 🔴 ห้ามใช้ persistStore.update() — ใช้แพตเทิร์น remove(id) แล้ว add(ฉบับใหม่) แทนเสมอ (ตาม researchLeads.js)
 * 🔴 ห้าม fire-and-forget เด็ดขาด — Vercel แช่แข็ง runtime หลัง route ตอบ ทุก write ต้อง await เสมอ
 * 🔴 ห้ามแก้ researchExtract.js/researchLeads.js — ไฟล์นี้ import/อ่านเท่านั้น
 *
 * record ของ 1 ใบในห้องรอ:
 *   {id:'eo_'+leadId, leadId, title, score, reason, addedAt, status:'waiting'|'sending'|'sent'|'error',
 *    attempts, lastError?, lastNote?, nextEligibleAt?, dispatchLockAt?, sentJobId?, sentAt?}
 */

import { createStore } from '../../persistStore.js';
import { sanitizeText } from './dnaContract.js';
import { sendLeadAsText, extractAndSend } from './researchExtract.js';

export const STORE = 'editor-outbox';

const MAX_ATTEMPTS = 3;                          // ล้มครบ 3 รอบ → ตั้ง 'error' ไม่วนต่อ (กัน retry loop ไม่จบ)
const DISPATCH_LOCK_STALE_MS = 5 * 60 * 1000;    // ใบ 'sending' ที่ lock เก่ากว่านี้ = รอบก่อนตายกลางคัน หยิบซ้ำได้
const QUEUE_STATUS_TIMEOUT_MS = 15_000;
// 🔧 17 ก.ค. 69 (แก้ห้องรอค้าง "กำลังส่ง" + ใบรอคลิปขวางประตู):
const CLIP_DISPATCH_POLL_MS = 15_000;            // งบรอถอดคลิปต่อใบใน 1 รอบ cron — เช็คสถานะพอ ไม่นั่งเฝ้า 6 นาที
//   (เดิม extractClip poll 6 นาที > maxDuration 300s ของ route → Vercel ฆ่ากลางทาง → ใบค้าง 'sending' ถาวร)
const PENDING_BACKOFF_MS = 4 * 60 * 1000;        // ใบที่รอคลิป/ล้มชั่วคราว พัก 4 นาทีค่อยลองใหม่ — เปิดทางใบที่พร้อม
const DISPATCH_TIME_BUDGET_MS = 100_000;         // เพดานเวลาลองหลายใบใน 1 รอบ — 100s เพราะใบเดี่ยวแย่สุด (บทความ:
//   Jina 30s + fallback + กลั่น 90s + ส่ง 30s ≈ ~190s) เริ่มที่วินาที 99 ก็ยังจบก่อน maxDuration 300s ของ route

function clampScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

async function _fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * enqueueOutbox — ใส่ pick (ผลจาก editorPick) เข้าห้องรอ (idempotent ตาม leadId — 1 leadId มีได้แค่ 1 record ถาวร)
 * ใบที่มี record อยู่แล้ว (ไม่ว่าสถานะไหน — waiting/sending/sent/error) → ข้าม นับ skipped (ไม่สร้างซ้ำ/ไม่รีเซ็ตของเดิม)
 * @param {Array<{id?:string, leadId?:string, title?:string, score?:number, opportunityScore?:number, reason?:string}>} picks
 * @returns {Promise<{queued:number, skipped:number}>}
 */
export async function enqueueOutbox(picks) {
  const store = createStore(STORE);
  const existing = await store.getAll();
  const existingIds = new Set(existing.map((r) => r.id));

  const now = new Date().toISOString();
  const toAdd = [];
  let skipped = 0;

  for (const p of Array.isArray(picks) ? picks : []) {
    const leadId = sanitizeText(p?.id || p?.leadId, 40);
    if (!leadId) { skipped++; continue; }
    const id = 'eo_' + leadId;
    if (existingIds.has(id)) { skipped++; continue; }
    existingIds.add(id); // กันซ้ำภายในชุด picks เดียวกันด้วย (เผื่อ id ซ้ำในอาร์เรย์ที่ส่งมา)

    toAdd.push({
      id,
      leadId,
      title: sanitizeText(p?.title, 300),
      score: clampScore(p?.score ?? p?.opportunityScore),
      reason: sanitizeText(p?.reason, 200),
      addedAt: now,
      status: 'waiting',
      attempts: 0,
    });
  }

  if (toAdd.length > 0) {
    await store.addMany(toAdd);
  }

  return { queued: toAdd.length, skipped };
}

/**
 * listOutbox — รายการห้องรอทั้งหมด เรียง: กำลังทำงานก่อน (sending) → waiting (คะแนนมาก→น้อย, เก่าก่อน) → error → sent
 */
export async function listOutbox() {
  const store = createStore(STORE);
  const items = await store.getAll();
  const STATUS_ORDER = { sending: 0, waiting: 1, error: 2, sent: 3 };

  return items.slice().sort((a, b) => {
    const oa = STATUS_ORDER[a.status] ?? 9;
    const ob = STATUS_ORDER[b.status] ?? 9;
    if (oa !== ob) return oa - ob;
    const sa = Number(a.score) || 0;
    const sb = Number(b.score) || 0;
    if (sa !== sb) return sb - sa;
    return new Date(a.addedAt || 0) - new Date(b.addedAt || 0);
  });
}

/**
 * cancelOutbox — ลบรายการออกจากห้องรอ (เฉพาะ status 'waiting' หรือ 'error' — กำลังส่ง/ส่งแล้วยกเลิกไม่ได้)
 */
export async function cancelOutbox(id) {
  const store = createStore(STORE);
  const all = await store.getAll();
  const rec = all.find((r) => r.id === id);
  if (!rec) {
    return { cancelled: false, reason: 'ไม่พบรายการนี้ในห้องรอ' };
  }
  if (rec.status !== 'waiting' && rec.status !== 'error') {
    return { cancelled: false, reason: `ยกเลิกไม่ได้ (สถานะปัจจุบัน: ${rec.status})` };
  }
  await store.remove(id);
  return { cancelled: true };
}

/**
 * outboxStats — นับตามสถานะ สำหรับ UI
 */
export async function outboxStats() {
  const store = createStore(STORE);
  const items = await store.getAll();
  const stats = { total: items.length, waiting: 0, sending: 0, sent: 0, error: 0 };
  for (const r of items) {
    if (Object.prototype.hasOwnProperty.call(stats, r.status)) stats[r.status]++;
  }
  return stats;
}

/**
 * dispatchOne — หัวใจของ "คนเฝ้าประตู": เช็คคิวเขียนข่าวจริงว่างสนิทหรือไม่ → ถ้าว่างสนิท ปล่อย 1 ใบจากห้องรอ
 *   (ก) GET ${origin}/api/queue/status (read-only, timeout 15s) — pending>0 || processing>0 → held:true ไม่ทำอะไร
 *   (ข) เรียง candidate (คะแนนมาก→น้อย, เก่าก่อน) — waiting ที่ถึงคิว (nextEligibleAt ผ่านแล้ว/ไม่มี)
 *       รวมใบ 'sending' ที่ dispatchLockAt เก่ากว่า 5 นาที (รอบก่อนตายกลางคัน หยิบซ้ำได้)
 *   (ค) 🔧 17 ก.ค. 69: ไล่ลองทีละใบจนกว่าจะ "ส่งได้จริง 1 ใบ" (ภายในงบเวลา 150s) —
 *       ใบรอถอดคลิป (pending) → พัก 4 นาที (nextEligibleAt) + จดโน้ต แล้วลองใบถัดไปทันที
 *       ไม่ปล่อยให้ใบคะแนนสูงที่รอเครื่องทีมขวางใบที่เนื้อพร้อมอีกต่อไป (head-of-line blocking)
 *       ก่อน claim ทุกใบอ่าน record สดจาก store ซ้ำ กันชนกับ cron รอบที่วิ่งคาบเกี่ยวกัน
 *   (ง) สำเร็จ → 'sent'+jobId (จบรอบ — สุภาพ: ปล่อยแค่ 1 ใบ/รอบเสมอ)
 *       ล้มจริง → attempts+1 (≥3 → 'error' ถาวร, ไม่งั้น 'waiting'+พัก 4 นาที) แล้วลองใบถัดไป
 * @returns {Promise<
 *   {held:true, queueBusy:{pending:number,processing:number}} |
 *   {empty:true, backedOff?:number, queueBusy?:{pending:number,processing:number}} |
 *   {sent:{leadId:string, jobId:string|null}, deferred?:Array, failed?:Array} |
 *   {released:false, deferred:Array<{leadId,jobRef}>, failed:Array<{leadId,message,attempts,final}>} |
 *   {error:{leadId?:string, message:string, attempts?:number, final?:boolean}}
 * >}
 */
export async function dispatchOne({ origin } = {}) {
  if (!origin) {
    return { error: { message: 'ขาด origin สำหรับเช็คคิว' } };
  }

  // (ก) เช็คคิวเขียนข่าวจริง — read-only เท่านั้น ห้ามแตะ/แก้ระบบคิว
  let queueBusy;
  try {
    const res = await _fetchWithTimeout(`${origin}/api/queue/status`, {}, QUEUE_STATUS_TIMEOUT_MS);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.success !== true) {
      return { error: { message: `เช็คสถานะคิวไม่สำเร็จ (status ${res.status})` } };
    }
    const pending = Number(body.pending) || 0;
    const processing = Number(body.processing) || 0;
    if (pending > 0 || processing > 0) {
      return { held: true, queueBusy: { pending, processing } };
    }
    queueBusy = { pending, processing };
  } catch (e) {
    return { error: { message: `เช็คสถานะคิวไม่สำเร็จ: ${e?.message || String(e)}` } };
  }

  // (ข) รวบรวม candidate ตามลำดับ (ใบที่พักรอคลิปอยู่ — nextEligibleAt ยังไม่ถึง — ข้ามรอบนี้)
  const store = createStore(STORE);
  const _eligible = (r, nowMs) => {
    if (r.status === 'waiting') {
      const eligAt = r.nextEligibleAt ? new Date(r.nextEligibleAt).getTime() : 0;
      return nowMs >= eligAt;
    }
    if (r.status === 'sending') {
      const lockAt = r.dispatchLockAt ? new Date(r.dispatchLockAt).getTime() : 0;
      return nowMs - lockAt > DISPATCH_LOCK_STALE_MS;
    }
    return false;
  };

  const all = await store.getAll();
  const now = Date.now();
  const candidates = all
    .filter((r) => _eligible(r, now))
    .sort((a, b) => {
      const sa = Number(a.score) || 0;
      const sb = Number(b.score) || 0;
      if (sa !== sb) return sb - sa;
      return new Date(a.addedAt || 0) - new Date(b.addedAt || 0);
    });

  if (!candidates.length) {
    const backedOff = all.filter((r) => r.status === 'waiting' && !_eligible(r, now)).length;
    return { empty: true, ...(backedOff ? { backedOff } : {}), queueBusy };
  }

  // (ค)+(ง) ไล่ลองทีละใบจนส่งได้ 1 ใบ — pending/ล้ม ไม่ขวางใบถัดไป
  const t0 = Date.now();
  const deferred = [];
  const failed = [];

  let sentAnything = false;
  for (const cand of candidates) {
    if (Date.now() - t0 > DISPATCH_TIME_BUDGET_MS) break; // งบเวลารอบนี้หมด — ที่เหลือรอ cron รอบหน้า

    // 🔧 มารยาทคิวแบบสด (ผู้ตรวจจับ): เช็คคิวว่างซ้ำก่อน "ทุกใบ" ไม่ใช่แค่ต้นรอบ — งานพนักงาน
    //   อาจเข้ามาระหว่างที่เราไล่ใบก่อนหน้า (รอบหนึ่งกินได้เป็นนาที) → เจอคิวไม่ว่าง = หยุดทันที
    if (sentAnything) break; // สุภาพ: ปล่อยได้แค่ 1 ใบ/รอบเสมอ (กันหลุดเชิงตรรกะในอนาคต)
    try {
      // eslint-disable-next-line no-await-in-loop
      const qres = await _fetchWithTimeout(`${origin}/api/queue/status`, {}, QUEUE_STATUS_TIMEOUT_MS);
      // eslint-disable-next-line no-await-in-loop
      const qbody = await qres.json().catch(() => null);
      if (!qres.ok || !qbody || qbody.success !== true) break; // เช็คคิวไม่ได้ = ไม่เสี่ยงปล่อย — รอบหน้าค่อยว่ากัน
      if ((Number(qbody.pending) || 0) > 0 || (Number(qbody.processing) || 0) > 0) {
        return { held: true, queueBusy: { pending: Number(qbody.pending) || 0, processing: Number(qbody.processing) || 0 }, deferred, failed };
      }
    } catch {
      break; // เน็ตสะดุด = ไม่เสี่ยงปล่อย
    }

    // อ่าน record สดก่อน claim — กัน cron รอบคาบเกี่ยวหยิบใบเดียวกันซ้ำ (snapshot ต้นรอบอาจตกรุ่นแล้ว)
    // eslint-disable-next-line no-await-in-loop
    const fresh = (await store.getAll()).find((r) => r.id === cand.id);
    if (!fresh || !_eligible(fresh, Date.now())) continue;

    const claimed = { ...fresh, status: 'sending', dispatchLockAt: new Date().toISOString() };
    // eslint-disable-next-line no-await-in-loop
    await store.remove(fresh.id);
    // eslint-disable-next-line no-await-in-loop
    await store.add(claimed);

    // ส่งจริง — เนื้อพร้อมแล้ว → ส่งเลย · ยังไม่พร้อม → extractAndSend งบคลิปสั้น (เช็คสถานะ ไม่นั่งเฝ้า)
    let sendResult;
    try {
      // eslint-disable-next-line no-await-in-loop
      const r1 = await sendLeadAsText(fresh.leadId, { origin });
      sendResult = r1?.needExtract
        // eslint-disable-next-line no-await-in-loop
        ? await extractAndSend(fresh.leadId, { origin, auto: true, clipPollBudgetMs: CLIP_DISPATCH_POLL_MS })
        : r1;
    } catch (e) {
      sendResult = { success: false, error: e?.message || String(e) };
    }

    // คลิปยังถอดไม่เสร็จ — ไม่ใช่ความล้มเหลว: พัก 4 นาที + จดโน้ตให้ UI แล้วลองใบถัดไปทันที
    if (sendResult?.success && sendResult?.sent === false && sendResult?.pending) {
      const jobRef = sendResult.jobRef || null;
      const note = `⏳ รอเครื่องทีมถอดคลิป${jobRef ? ` (งาน ${String(jobRef).slice(0, 8)})` : ''} — พักไว้ก่อน ให้ใบที่พร้อมออกก่อน`;
      // eslint-disable-next-line no-await-in-loop
      await store.remove(fresh.id);
      // eslint-disable-next-line no-await-in-loop
      await store.add({
        ...claimed,
        status: 'waiting',
        nextEligibleAt: new Date(Date.now() + PENDING_BACKOFF_MS).toISOString(),
        lastNote: note,
        // 🩺 หมอเวร (deskWatchdog): ประทับเวลาพักรอคลิป "ครั้งแรก" — ใช้ตัดสินใบที่รอนานเกิน 3 ชม.
        firstDeferredAt: claimed.firstDeferredAt || new Date().toISOString(),
      });
      deferred.push({ leadId: fresh.leadId, jobRef });
      continue;
    }

    if (sendResult?.success || sendResult?.alreadySent) {
      const jobId = sendResult.jobId || null;
      sentAnything = true;
      // eslint-disable-next-line no-await-in-loop
      await store.remove(fresh.id);
      // ล้างร่องรอยเฟสรอ (firstDeferredAt/nextEligibleAt) — กันหมอเวรรูล 3 ชม. อ่านค่าเก่าแล้วตัดสินผิดใบ
      // eslint-disable-next-line no-await-in-loop
      await store.add({ ...claimed, status: 'sent', sentJobId: jobId, sentAt: new Date().toISOString(), lastNote: '', firstDeferredAt: null, nextEligibleAt: null });
      return { sent: { leadId: fresh.leadId, jobId }, deferred, failed };
    }

    // ล้มจริง: attempts+1, ≥3 → 'error' ถาวร, ไม่งั้นกลับ 'waiting'+พัก แล้วลองใบถัดไป
    const attempts = (Number(fresh.attempts) || 0) + 1;
    const errMsg = sendResult?.error || 'ส่งเข้าคิวไม่สำเร็จ (ไม่ทราบสาเหตุ)';
    const isFinal = attempts >= MAX_ATTEMPTS;
    // eslint-disable-next-line no-await-in-loop
    await store.remove(fresh.id);
    // eslint-disable-next-line no-await-in-loop
    await store.add({
      ...claimed,
      status: isFinal ? 'error' : 'waiting',
      attempts,
      lastError: errMsg,
      ...(isFinal ? {} : { nextEligibleAt: new Date(Date.now() + PENDING_BACKOFF_MS).toISOString() }),
    });
    failed.push({ leadId: fresh.leadId, message: errMsg, attempts, final: isFinal });
  }

  // ไม่มีใบไหนส่งได้ในรอบนี้ (ทุกใบรอคลิป/ล้ม) — บอกสรุปให้ UI/cron รู้ว่าเกิดอะไร
  if (deferred.length || failed.length) {
    return { released: false, deferred, failed, queueBusy };
  }
  return { empty: true, queueBusy };
}
