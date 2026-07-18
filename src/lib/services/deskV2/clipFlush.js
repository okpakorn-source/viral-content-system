/**
 * =====================================================
 * 🎬 Clip Flush — ตัวปิดวงจรคลิปของ บก. (18 ก.ค. 69 — แก้บัค audit #2 "คลิปถอดเสร็จแล้วไม่ส่งเจนเอง")
 * =====================================================
 * ที่มา: P2 ถอด cron ยาม dispatch แล้ว โหมดส่งตรง (immediate) ให้งบรอถอดคลิปแค่ 20s ต่อใบ
 * → ใบคลิปเกือบทั้งหมดคืน pending (งานถอดวิ่งต่อบนเครื่องทีม) แต่ "ไม่มีใครกลับมารับผล"
 * → ผู้ใช้ต้องกดคัดใหม่เองคลิปถึงถูกส่งเจน ไม่กด = ค้างถาวร
 *
 * ไฟล์นี้เพิ่มแบบ isolated (SYSTEM_SAFETY_RULES ข้อ 6 — ไม่ inject logic เข้า core):
 *   flushReadyClips — กวาดลีด (new/kept) ที่มีเลขงานคลิป (clipJobRef) → เช็ค job-status ราคาถูกก่อน
 *     → เฉพาะงาน done จริงค่อยเรียก extractAndSend (แนบเนื้อ+กลั่น+ส่งเจน — ท่อเดิมทั้งหมด ไม่เขียนใหม่)
 *     → งาน error ถาวร/ถูกล้างจากคิว = ปิดใบให้มองเห็น (sendAttempts เต็มเพดาน + event) ไม่วนเช็คตลอดกาล
 *       และ "ไม่ submit งานถอดใหม่เองเด็ดขาด" (งานที่ผู้ใช้เคลียทิ้งต้องไม่ฟื้นเอง — ส่งใหม่คือกด ⚡ เองเท่านั้น)
 *   getClipWatch — สถานะย่อให้ GET /api/desk/editor (คลิปรอกี่ใบ เก่าสุดกี่นาที เตือนเครื่องทีมออฟไลน์)
 *
 * ผู้เรียก: cron GET /api/desk/editor/flush-clips (ทุก 2 นาที) + ปุ่ม "↻ เช็ค+ส่งตอนนี้" ใน EditorPanel
 * 🔴 kill-switch: DESK_CLIP_FLUSH=0 → ปิดทั้งระบบ (คืน disabled ไม่แตะอะไร)
 * 🔴 pure JS + relative import ล้วน · ห้ามใช้ persistStore.update() — remove(id) แล้ว add(ฉบับใหม่) เท่านั้น
 * 🔴 ไม่แตะ /api/clip-transcript/** และ /api/queue/** — อ่าน job-status อย่างเดียว (read-only ต่อระบบคลิป)
 */

import { createStore } from '../../persistStore.js';
import { listLeads, pushEvent, STORE as LEADS_STORE } from './researchLeads.js';
import { extractAndSend } from './researchExtract.js';
import { MAX_LEAD_SEND_ATTEMPTS } from './editorBrain.js';

const JOB_STATUS_TIMEOUT_MS = 15_000;
// งบเวลาต่อใบ worst-case (insight ≤30s + กลั่น ≤90s + ส่ง ≤30s + overhead) — สอดคล้อง PER_LEAD_SEND_BUDGET_MS ของ editorBrain
const PER_LEAD_SEND_BUDGET_MS = 190_000;
const DEFAULT_TIME_BUDGET_MS = 240_000;  // ใต้ maxDuration 300s ของ route flush-clips (เผื่อ margin ตอบกลับ)
const MAX_HEAVY_PER_RUN = 4;             // เพดานใบที่ "ส่งจริง" ต่อรอบ — ที่เหลือรอ cron รอบถัดไป (2 นาที)
const FLUSH_CLIP_POLL_MS = 30_000;       // ส่งให้ extractClip: งานที่เช็คแล้วว่า done ไม่ต้อง poll — เหลือแค่เพดาน insight เสริม
const OFFLINE_WARN_MIN = 120;            // คลิปเก่าสุดรอนานเกินนี้ (นาที) = เตือนเครื่องทีมอาจออฟไลน์

// ── GET job-status 1 ครั้งพร้อม timeout จริง (อ่านอย่างเดียว — ห้ามแตะระบบคลิป) ──
async function _getJobStatus(origin, jobRef) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JOB_STATUS_TIMEOUT_MS);
  try {
    const res = await fetch(`${origin}/api/clip-transcript/job-status?id=${encodeURIComponent(jobRef)}`, { signal: controller.signal });
    const txt = await res.text().catch(() => '');
    try { return txt ? JSON.parse(txt) : null; } catch { return null; }
  } finally {
    clearTimeout(timer);
  }
}

// ── ปิดใบแบบ "มองเห็น" (audit #4): ตั้ง sendAttempts เต็มเพดาน + เหตุผล + event — remove-แล้ว-add ตามกฎ ──
async function _retireLead(store, id, reason) {
  try {
    const all = await store.getAll();
    const existing = all.find((r) => r.id === id);
    if (!existing) return;
    const merged = pushEvent({
      ...existing,
      sendAttempts: MAX_LEAD_SEND_ATTEMPTS,
      lastSendError: String(reason || '').slice(0, 200),
      lastSendAttemptAt: new Date().toISOString(),
    }, 'status', { status: `ปิดใบอัตโนมัติ: ${String(reason || '').slice(0, 120)}` });
    await store.remove(id);
    await store.add(merged);
  } catch { /* ปิดใบไม่ได้ไม่บล็อกรอบ flush — รอบหน้าเจอซ้ำก็ลองปิดใหม่ */ }
}

// ── นับพลาดส่งจริง (สะท้อน _recordSendFailure ของ editorBrain — ไฟล์นั้นไม่ export จึงมีสำเนาเบาที่นี่) ──
async function _recordFlushFailure(store, id, errMsg) {
  try {
    const all = await store.getAll();
    const existing = all.find((r) => r.id === id);
    if (!existing) return;
    const attempts = (Number(existing.sendAttempts) || 0) + 1;
    const merged = pushEvent(
      { ...existing, sendAttempts: attempts, lastSendError: String(errMsg || '').slice(0, 200), lastSendAttemptAt: new Date().toISOString() },
      'status',
      { status: `ส่งอัตโนมัติ (flush คลิป) พลาดครั้งที่ ${attempts}${attempts >= MAX_LEAD_SEND_ATTEMPTS ? ' (ครบเพดาน — พักจากรอบคัด)' : ''}: ${String(errMsg || '').slice(0, 80)}` },
    );
    await store.remove(id);
    await store.add(merged);
  } catch { /* บันทึกพลาดไม่บล็อกรอบ flush */ }
}

/**
 * flushReadyClips — ไล่เช็คลีดคลิปที่รอถอด แล้ว "ส่งเจนต่อให้จบ" เฉพาะใบที่งานถอด done จริง
 * @param {object} args
 * @param {string} args.origin - origin ของระบบ (ยิง job-status/extractAndSend ผ่าน origin นี้)
 * @param {number} [args.timeBudgetMs] - งบเวลาทั้งรอบ (default 240s — ใต้ maxDuration 300s ของ route)
 * @returns {Promise<{disabled?:true, checked:number, sentCount:number, sent:object[], waiting:number,
 *                    failed:number, failedList:object[], tookMs:number}>}
 */
export async function flushReadyClips({ origin, timeBudgetMs = DEFAULT_TIME_BUDGET_MS } = {}) {
  const t0 = Date.now();
  if (process.env.DESK_CLIP_FLUSH === '0') {
    return { disabled: true, checked: 0, sentCount: 0, sent: [], waiting: 0, failed: 0, failedList: [], tookMs: 0 };
  }
  if (!origin) {
    return { checked: 0, sentCount: 0, sent: [], waiting: 0, failed: 0, failedList: [], error: 'ขาด origin', tookMs: 0 };
  }

  const [newLeads, keptLeads] = await Promise.all([
    listLeads({ status: 'new', limit: 500 }),
    listLeads({ status: 'kept', limit: 500 }),
  ]);
  // เป้าหมาย: ใบที่เคยถูกส่งเข้าคิวถอดแล้ว (มี clipJobRef = ผ่านการคัด/กดส่งมาแล้ว — flush ไม่ตัดสินใจแทน บก.)
  // เรียงเก่าก่อน (FIFO) กันใบแรกๆ อดตลอดเมื่อของใหม่ไหลเข้า
  const targets = [...newLeads, ...keptLeads]
    .filter((l) => l.clipJobRef && (Number(l.sendAttempts) || 0) < MAX_LEAD_SEND_ATTEMPTS)
    .sort((a, b) => new Date(a.clipJobRefAt || 0) - new Date(b.clipJobRefAt || 0));

  const store = createStore(LEADS_STORE);
  const sent = [];
  const failedList = [];
  let waiting = 0;
  let heavy = 0;
  let checked = 0;

  for (const lead of targets) {
    checked++;

    // (1) เช็คสถานะงานถอดแบบถูก (GET เดียว) ก่อน — งานหนัก (แนบ+กลั่น+ส่ง) จ่ายเฉพาะใบที่ done จริง
    let st = null;
    try {
      // eslint-disable-next-line no-await-in-loop -- เช็ค/ส่งทีละใบตามลำดับ กันชนไฟล์ลีดเดียวกัน (แพตเทิร์น editorBrain)
      st = await _getJobStatus(origin, lead.clipJobRef);
    } catch { /* เน็ตสะดุดชั่วคราว — นับเป็นรอ รอบหน้าเช็คใหม่ */ }
    if (!st) { waiting++; continue; }

    if (st.success === false) {
      if (st.errorType === 'JOB_NOT_FOUND') {
        // งานถูกล้างจากคิว (เช่น ผู้ใช้กดเคลียงานตาย) — ห้าม submit ใหม่เอง: ปิดใบให้เห็น แล้วให้คนตัดสินใจ
        // eslint-disable-next-line no-await-in-loop
        await _retireLead(store, lead.id, 'งานถอดถูกล้างออกจากคิวคลิป — ถ้ายังต้องการ กด ⚡ ส่งเองเพื่อเริ่มถอดใหม่');
        failedList.push({ id: lead.id, title: lead.title, error: 'งานถอดถูกล้างออกจากคิว' });
      } else {
        waiting++; // อ่านสถานะไม่ได้ชั่วคราว — รอบหน้าเช็คใหม่
      }
      continue;
    }

    if (st.status === 'error') {
      // เครื่องทีมลองครบแล้วและยอมแพ้ถาวร — ปิดใบพร้อมสาเหตุจริง (ไม่วนเช็คฟรีตลอดกาล)
      // eslint-disable-next-line no-await-in-loop
      await _retireLead(store, lead.id, `ถอดคลิปล้มเหลวถาวร: ${String(st.error || 'เครื่องทีมลองครบแล้ว').slice(0, 140)}`);
      failedList.push({ id: lead.id, title: lead.title, error: st.error || 'ถอดคลิปล้มเหลวถาวร' });
      continue;
    }

    if (st.status !== 'done') { waiting++; continue; } // pending/processing/retry_wait — รอต่อ (ไม่นับ clipPendingRounds: นั่นคือโควตาที่นั่งรอบคัด ไม่ใช่รอบ flush)

    // (2) done จริง → งานหนัก — คุมทั้งจำนวนและเวลาต่อรอบ กัน route ชนเพดาน (บทเรียน Batch A)
    if (heavy >= MAX_HEAVY_PER_RUN) { waiting++; continue; }
    if ((Date.now() - t0) + PER_LEAD_SEND_BUDGET_MS > timeBudgetMs) { waiting++; continue; }
    heavy++;
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await extractAndSend(lead.id, { origin, auto: true, clipPollBudgetMs: FLUSH_CLIP_POLL_MS });
      if (r?.success && r?.sent) {
        sent.push({ id: lead.id, title: lead.title, jobId: r.jobId || null });
      } else if (r?.pending) {
        waiting++; // ไม่ควรเกิด (เพิ่งเห็น done) — เผื่อ race งานใหม่ถูก submit แทน
      } else {
        const msg = r?.error || 'ส่งไม่สำเร็จ';
        if (r?.errorType === 'NEAR_DUPLICATE') {
          waiting++; // ชนด่านกันซ้ำ 45 นาทีของคิวเขียน — เรื่องชั่วคราว ไม่นับพลาด (audit #6) พ้นกรอบแล้วผ่านเอง
        } else {
          // eslint-disable-next-line no-await-in-loop
          await _recordFlushFailure(store, lead.id, msg);
          failedList.push({ id: lead.id, title: lead.title, error: msg });
        }
      }
    } catch (e) {
      const msg = e?.message || String(e);
      // eslint-disable-next-line no-await-in-loop
      await _recordFlushFailure(store, lead.id, msg);
      failedList.push({ id: lead.id, title: lead.title, error: msg });
    }
  }

  return {
    checked,
    sentCount: sent.length,
    sent,
    waiting,
    failed: failedList.length,
    failedList: failedList.slice(0, 10),
    tookMs: Date.now() - t0,
  };
}

/**
 * getClipWatch — สถานะย่อของคลิปที่รอถอด สำหรับ GET /api/desk/editor (อ่านอย่างเดียว ไม่เขียนอะไร)
 * @returns {Promise<{waiting:number, oldestMin:number, warnOffline:boolean, retired:number}>}
 */
export async function getClipWatch() {
  try {
    const [newLeads, keptLeads] = await Promise.all([
      listLeads({ status: 'new', limit: 500 }),
      listLeads({ status: 'kept', limit: 500 }),
    ]);
    const all = [...newLeads, ...keptLeads];
    const waitingLeads = all.filter((l) =>
      l.clipJobRef && !l.contentReady && (Number(l.sendAttempts) || 0) < MAX_LEAD_SEND_ATTEMPTS);
    // 🔧 รีเช็ค 18 ก.ค. 69: นับเฉพาะใบคลิป (มี clipJobRef) — แผงนี้เป็นเรื่องคลิป ใบบทความที่พักจากรอบคัด
    //   มีป้าย ⛔ ของตัวเองใน LeadCard อยู่แล้ว ไม่ต้องมาโผล่รวมในแผงคลิป (กันเลขเกิน + แผงเด้งทั้งที่ไม่มีคลิป)
    const retired = all.filter((l) => l.clipJobRef && (Number(l.sendAttempts) || 0) >= MAX_LEAD_SEND_ATTEMPTS).length;
    let oldestMin = 0;
    for (const l of waitingLeads) {
      const t = new Date(l.clipJobRefAt || l.lastClipPendingAt || 0).getTime();
      if (t) oldestMin = Math.max(oldestMin, Math.round((Date.now() - t) / 60_000));
    }
    return {
      waiting: waitingLeads.length,
      oldestMin,
      warnOffline: waitingLeads.length > 0 && oldestMin >= OFFLINE_WARN_MIN,
      retired,
    };
  } catch {
    return { waiting: 0, oldestMin: 0, warnOffline: false, retired: 0 }; // อ่านไม่ได้ไม่ล้ม GET หลัก
  }
}
