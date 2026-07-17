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
 *    attempts, lastError?, dispatchLockAt?, sentJobId?, sentAt?}
 */

import { createStore } from '../../persistStore.js';
import { sanitizeText } from './dnaContract.js';
import { sendLeadAsText, extractAndSend } from './researchExtract.js';

export const STORE = 'editor-outbox';

const MAX_ATTEMPTS = 3;                          // ล้มครบ 3 รอบ → ตั้ง 'error' ไม่วนต่อ (กัน retry loop ไม่จบ)
const DISPATCH_LOCK_STALE_MS = 5 * 60 * 1000;    // ใบ 'sending' ที่ lock เก่ากว่านี้ = รอบก่อนตายกลางคัน หยิบซ้ำได้
const QUEUE_STATUS_TIMEOUT_MS = 15_000;

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
 *   (ข) หยิบ waiting ใบแรก (คะแนนมาก→น้อย, เก่าก่อน) — รวมใบ 'sending' ที่ dispatchLockAt เก่ากว่า 5 นาที
 *       (ถือว่ารอบก่อนตายกลางคัน หยิบซ้ำได้) — claim ด้วยแพตเทิร์น remove-แล้ว-add เป็น 'sending'+dispatchLockAt
 *   (ค) ส่งจริง: sendLeadAsText ก่อน (เนื้อควรพร้อมจากตอนคัดแล้ว) — ถ้า needExtract:true (ยังไม่พร้อม)
 *       ค่อยเรียก extractAndSend เต็มแทน (fallback ปลอดภัย ไม่ปล่อยใบที่เนื้อไม่พร้อมให้ตกหล่น)
 *   (ง) สำเร็จ → 'sent'+jobId · คลิปยังไม่เสร็จ (pending) → คืน 'waiting' ลองรอบหน้า (ไม่นับ attempts เพราะไม่ใช่ความล้มเหลว)
 *       ล้มจริง → attempts+1, ≥3 → 'error' ไม่วนต่อ, ไม่งั้นกลับ 'waiting'
 * @returns {Promise<
 *   {held:true, queueBusy:{pending:number,processing:number}} |
 *   {empty:true, queueBusy?:{pending:number,processing:number}} |
 *   {sent:{leadId:string, jobId:string|null}} |
 *   {pending:{leadId:string, jobRef:string|null}} |
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

  // (ข) หยิบ waiting ใบแรก (รวม 'sending' ที่ lock ค้างเกิน 5 นาที = รอบก่อนตายกลางคัน)
  const store = createStore(STORE);
  const all = await store.getAll();
  const now = Date.now();
  const candidates = all
    .filter((r) => {
      if (r.status === 'waiting') return true;
      if (r.status === 'sending') {
        const lockAt = r.dispatchLockAt ? new Date(r.dispatchLockAt).getTime() : 0;
        return now - lockAt > DISPATCH_LOCK_STALE_MS;
      }
      return false;
    })
    .sort((a, b) => {
      const sa = Number(a.score) || 0;
      const sb = Number(b.score) || 0;
      if (sa !== sb) return sb - sa;
      return new Date(a.addedAt || 0) - new Date(b.addedAt || 0);
    });

  if (!candidates.length) {
    return { empty: true, queueBusy };
  }

  const chosen = candidates[0];
  const claimed = { ...chosen, status: 'sending', dispatchLockAt: new Date().toISOString() };
  await store.remove(chosen.id);
  await store.add(claimed);

  // (ค) ส่งจริง — เนื้อควรเตรียมไว้แล้วตอนคัด (โหมด polite) · needExtract:true = ยังไม่พร้อม → fallback เต็ม
  let sendResult;
  try {
    const r1 = await sendLeadAsText(chosen.leadId, { origin });
    sendResult = r1?.needExtract
      ? await extractAndSend(chosen.leadId, { origin, auto: true })
      : r1;
  } catch (e) {
    sendResult = { success: false, error: e?.message || String(e) };
  }

  // คลิปยังถอดไม่เสร็จ (extractAndSend คืน pending) — ไม่ใช่ความล้มเหลว ปล่อยกลับ 'waiting' ลองรอบหน้า ไม่นับ attempts
  if (sendResult?.success && sendResult?.sent === false && sendResult?.pending) {
    await store.remove(chosen.id);
    await store.add({ ...claimed, status: 'waiting' });
    return { pending: { leadId: chosen.leadId, jobRef: sendResult.jobRef || null } };
  }

  if (sendResult?.success || sendResult?.alreadySent) {
    const jobId = sendResult.jobId || null;
    await store.remove(chosen.id);
    await store.add({ ...claimed, status: 'sent', sentJobId: jobId, sentAt: new Date().toISOString() });
    return { sent: { leadId: chosen.leadId, jobId } };
  }

  // ล้มจริง: attempts+1, ≥3 → 'error' ไม่วนต่อ, ไม่งั้นกลับ 'waiting'
  const attempts = (Number(chosen.attempts) || 0) + 1;
  const errMsg = sendResult?.error || 'ส่งเข้าคิวไม่สำเร็จ (ไม่ทราบสาเหตุ)';
  const isFinal = attempts >= MAX_ATTEMPTS;
  await store.remove(chosen.id);
  await store.add({ ...claimed, status: isFinal ? 'error' : 'waiting', attempts, lastError: errMsg });
  return { error: { leadId: chosen.leadId, message: errMsg, attempts, final: isFinal } };
}
