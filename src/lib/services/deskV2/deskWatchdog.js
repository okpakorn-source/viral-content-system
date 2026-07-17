/**
 * =====================================================
 * 🩺 Desk Watchdog — "หมอเวร" กู้งานตายกลางทางของโต๊ะข่าวกลาง v2 (17 ก.ค. 69)
 * =====================================================
 * วิ่งพ่วงท้าย cron คนเฝ้าประตู (/api/desk/editor/dispatch ทุก 1 นาที) — ไม่เพิ่ม cron ใหม่
 * จุดตายที่ไฟล์นี้เก็บ (จุดอื่นมีกลไกเดิมคุ้มแล้ว: ใบ 'sending' ค้าง >5 นาที dispatchOne หยิบซ้ำเอง):
 *
 *   A. ใบห้องรอที่รอเครื่องทีมถอดคลิปนานเกิน CLIP_WAIT_MAX_MS (3 ชม. = เท่าหน้าต่าง dedup ของ
 *      /api/clip-transcript/submit) → ปิดเป็น 'error' พร้อมเหตุผลชัด — ไม่ปล่อยค้างเงียบตลอดกาล
 *   B. ใบที่ส่งเข้าคิวเขียนแล้ว ('sent') แต่งานเขียนตายกลางทาง — เช็คด้วย getJobInfo (อ่านอย่างเดียว):
 *      - job 'completed' → ติดป้าย genDone + โน้ต ✅ (หยุดเช็คใบนี้ถาวร — กันเปลืองรอบเช็ค)
 *      - job 'failed' → ส่งใหม่อัตโนมัติ 1 ครั้ง: คืนใบเข้าห้องรอ ('waiting') + รีเซ็ตลีดเป็น 'kept'
 *        ให้คนเฝ้าประตูปล่อยผ่านประตูเดิมอย่างสุภาพ (ไม่มีทางลัดเข้าคิว — มารยาทคิวเดิมคุ้มครอง)
 *        หมายเหตุด่านคิว: งานล้ม /api/queue/add อนุญาตส่งซ้ำเสมอ (ด่าน near-dup ยกเว้นงานล้ม/ยกเลิก)
 *      - job ค้าง pending/processing เกิน GEN_STUCK_MS (45 นาที — ปกติงานเจน ~4-7 นาที) → ถือว่า
 *        ตายกลางทาง ส่งใหม่ 1 ครั้งเช่นกัน (45 นาที = พ้นด่านกันเนื้อคล้าย 45 นาทีของ queue/add พอดี)
 *      - job หายจากคิว (คิวถูกล้าง) → อายุเกิน GEN_STUCK_MS ค่อยส่งใหม่ 1 ครั้ง (กันตัดสินเร็วเกิน)
 *      - เคยส่งใหม่แล้ว (genRetry) ยังตาย/ล้มอีก → 'error' + เหตุผล — ให้มนุษย์ตัดสินต่อ ไม่วนไม่จบ
 *   C. เก็บเกี่ยวอัตโนมัติ: harvestFromLeads (≤HARVEST_MAX ใบ/รอบ) — ผลเจนที่เสร็จไหลเข้า
 *      📚 คลังเนื้อพร้อมใช้เอง ไม่ต้องกดปุ่มดึงเอง
 *
 * 🔴 pure JS + relative import ล้วน (ให้ node เรียกเทสตรงได้ ไม่ง้อ alias @/)
 * 🔴 ห้ามใช้ persistStore.update() — ใช้แพตเทิร์น remove(id) แล้ว add(ฉบับใหม่) เสมอ
 * 🔴 ห้ามแตะ /api/queue/** — เช็คสถานะงานผ่าน getJobInfo (read-only) เท่านั้น ห้ามเขียน/บายพาสคิว
 * 🔴 ทุก write ต้อง await (Vercel แช่แข็ง runtime หลัง route ตอบ — ห้าม fire-and-forget)
 * 🔴 สวิตช์ปิดฉุกเฉิน: env DESK_WATCHDOG=0 (default เปิด) — route เป็นคนเช็ค ไม่เช็คในไฟล์นี้
 */

import { createStore } from '../../persistStore.js';
import { STORE as OUTBOX_STORE } from './editorOutbox.js';
import { setLeadStatus } from './researchLeads.js';
import { getJobInfo } from './researchTrace.js';
import { harvestFromLeads, STORE as READY_STORE } from './readyContent.js';

const CLIP_WAIT_MAX_MS = 3 * 60 * 60 * 1000; // A: รอเครื่องทีมถอดคลิปนานสุด 3 ชม. (= หน้าต่าง dedup ของ submit)
const GEN_STUCK_MS = 45 * 60 * 1000;         // B: งาน processing ค้างเกิน 45 นาที = ฟังก์ชันตายแน่ (Vercel รันได้สูงสุด ~13 นาที) + พ้นด่าน near-dup
const GEN_MIN_AGE_MS = 5 * 60 * 1000;        // B: ส่งไปไม่ถึง 5 นาทียังไม่เช็ค (งานปกติยังไม่ทันเสร็จ — กันเช็คถี่เปลือง)
const MAX_JOB_CHECKS = 3;                    // B: เช็คงานเขียนไม่เกิน 3 ใบ/รอบ (cron วิ่งทุกนาที — ทยอยได้)
const HARVEST_MAX = 3;                       // C: เก็บเกี่ยวไม่เกิน 3 ใบ/รอบ (คุมเวลา — fetchJobStatus ทีละใบ)

const JOB_MISSING_RE = /ไม่พบ|not.?found|JOB_NOT_FOUND/i; // getJobInfo คืน error ข้อความหลายแบบเมื่องานหายจากคิว
// 🔴 บทเรียนจากผู้ตรวจ (17 ก.ค. 69): "งานหายจากคิว" ≠ ตาย — คิว prune งานที่ "เสร็จแล้ว" ทิ้งเป็นปกติ
//   (job_queue ทั้งคลังเหลือ ~12 งาน) → ห้ามส่งซ้ำเด็ดขาด (จะเจนซ้ำซ้อน) — เช็คคลังเนื้อพร้อมใช้ (rc_<jobId>)
//   ก่อน: มี = เจนเสร็จจริง (genDone) · ไม่มี = ปิดแบบ "ไม่ทราบผล" ให้มนุษย์ดู ไม่เดา

/**
 * sweepDeadWork — กวาดกู้งานตายกลางทาง 1 รอบ (เรียกพ่วงท้าย dispatch cron)
 * @param {{origin:string, budgetMs?:number}} opts — budgetMs: งบเวลารวมของรอบนี้ (default 45s;
 *   route คำนวณจากเวลาที่เหลือก่อน maxDuration แล้วส่งมา — หมดงบ = หยุดกลางคันอย่างปลอดภัย
 *   เพราะทุก write เป็น atomic ต่อใบ รอบหน้ากวาดต่อจากที่ค้างได้เสมอ)
 * @returns {Promise<{disabled?:true, escalatedClip:number, genChecked:number, genDone:number,
 *   genRetried:number, genGaveUp:number, harvest:null|{added:number,waiting:number,failed:number,checked:number},
 *   errors:string[]}>}
 */
export async function sweepDeadWork({ origin, budgetMs = 45_000 } = {}) {
  const t0 = Date.now();
  const outOfTime = () => Date.now() - t0 > budgetMs;
  const summary = { escalatedClip: 0, genChecked: 0, genDone: 0, genRetried: 0, genGaveUp: 0, harvest: null, errors: [] };
  if (!origin) {
    summary.errors.push('ขาด origin');
    return summary;
  }

  const store = createStore(OUTBOX_STORE);
  let all;
  try {
    all = await store.getAll();
  } catch (e) {
    summary.errors.push(`อ่านห้องรอไม่ได้: ${e?.message || String(e)}`);
    return summary;
  }
  const now = Date.now();

  // ── A) ใบรอถอดคลิปนานเกิน 3 ชม. → ปิดเป็น 'error' พร้อมเหตุผล ──────────────
  //   จับจาก firstDeferredAt (dispatchOne ประทับครั้งแรกที่ใบถูกพักเพราะรอคลิป) + โน้ตต้องบอกว่ารอคลิปจริง
  //   (กันฆ่าผิดตัว: ใบ gen-retry ที่เคยรอคลิปมาก่อน — โน้ตจะเป็น 🔁 ไม่ใช่ ⏳รอเครื่องทีมถอดคลิป)
  for (const r of all) {
    if (outOfTime()) break;
    if (r.status !== 'waiting' || !r.firstDeferredAt) continue;
    if (!/ถอดคลิป/.test(String(r.lastNote || ''))) continue;
    const waited = now - new Date(r.firstDeferredAt).getTime();
    if (!(waited > CLIP_WAIT_MAX_MS)) continue;
    try {
      // อ่านสดก่อนเขียน — กันชนกับ tick อื่นที่อาจเพิ่งเปลี่ยนใบนี้ไปแล้ว (remove+add ไม่ atomic)
      // eslint-disable-next-line no-await-in-loop
      const fresh = (await store.getAll()).find((x) => x.id === r.id);
      if (!fresh || fresh.status !== 'waiting' || fresh.firstDeferredAt !== r.firstDeferredAt) continue;
      // eslint-disable-next-line no-await-in-loop
      await store.remove(fresh.id);
      // eslint-disable-next-line no-await-in-loop
      await store.add({
        ...fresh,
        status: 'error',
        lastError: `รอเครื่องทีมถอดคลิปเกิน ${Math.round(CLIP_WAIT_MAX_MS / 3600000)} ชม. — คลิปนี้น่าจะถอดไม่สำเร็จ (ลองเปิดลิงก์เช็คเอง หรือยกเลิกใบนี้)`,
      });
      summary.escalatedClip++;
    } catch (e) {
      summary.errors.push(`ปิดใบรอคลิป ${r.id} ไม่สำเร็จ: ${e?.message || String(e)}`);
    }
  }

  // ── B) ใบ 'sent' — เช็คสุขภาพงานเขียนจริง (เก่าสุดก่อน, ≤3 ใบ/รอบ) ──────────
  const sentToCheck = all
    .filter((r) => r.status === 'sent' && r.sentJobId && !r.genDone && !r.genGaveUp)
    .filter((r) => now - new Date(r.sentAt || r.addedAt || 0).getTime() > GEN_MIN_AGE_MS)
    .sort((a, b) => new Date(a.sentAt || 0) - new Date(b.sentAt || 0))
    .slice(0, MAX_JOB_CHECKS);

  // helper: อ่านสด+ยืนยันใบยังเป็น 'sent' งานเดิม ก่อนเขียนทับ (กันชน tick คาบเกี่ยว — remove+add ไม่ atomic)
  async function _writeSentItem(item, patch) {
    const fresh = (await store.getAll()).find((x) => x.id === item.id);
    if (!fresh || fresh.status !== 'sent' || fresh.sentJobId !== item.sentJobId) return false;
    await store.remove(fresh.id);
    await store.add({ ...fresh, ...patch });
    return true;
  }

  for (const r of sentToCheck) {
    if (outOfTime()) break;
    let info;
    try {
      // eslint-disable-next-line no-await-in-loop
      info = await getJobInfo(r.sentJobId, origin);
    } catch (e) {
      summary.errors.push(`เช็คงาน ${r.sentJobId} ไม่ได้: ${e?.message || String(e)}`);
      continue;
    }
    summary.genChecked++;

    const ageMs = now - new Date(r.sentAt || r.addedAt || 0).getTime();
    const jobStatus = info?.success ? String(info.status || '') : null;
    const jobMissing = !info?.success && JOB_MISSING_RE.test(String(info?.error || ''));

    // เสร็จแล้ว → ติดป้ายหยุดเช็ค (ผลจริงให้ขั้น C เก็บเกี่ยวเข้าคลัง)
    if (jobStatus === 'completed') {
      try {
        // eslint-disable-next-line no-await-in-loop
        const ok = await _writeSentItem(r, { genDone: true, genDoneAt: new Date().toISOString(), lastNote: `✅ เจนเสร็จ (${info.versionsCount ?? 0} เวอร์ชัน)` });
        if (ok) summary.genDone++;
      } catch (e) {
        summary.errors.push(`ติดป้าย genDone ${r.id} ไม่สำเร็จ: ${e?.message || String(e)}`);
      }
      continue;
    }

    // งานหายจากคิว — ห้ามเดาว่าตาย (คิว prune งานเสร็จเป็นปกติ): เช็คคลังเนื้อพร้อมใช้ก่อน
    if (jobMissing && ageMs > GEN_STUCK_MS) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const readyAll = await createStore(READY_STORE).getAll();
        const harvested = readyAll.some((x) => x && x.id === 'rc_' + r.sentJobId);
        // eslint-disable-next-line no-await-in-loop
        const ok = await _writeSentItem(r, harvested
          ? { genDone: true, genDoneAt: new Date().toISOString(), lastNote: '✅ เจนเสร็จ (อยู่ในคลังเนื้อพร้อมใช้แล้ว — งานถูกล้างจากคิวตามรอบปกติ)' }
          : { genDone: true, genUnknown: true, lastNote: '❓ งานหายจากคิวและไม่พบในคลังเนื้อ — ไม่ทราบผล (ห้ามส่งซ้ำอัตโนมัติกันเจนซ้ำ) เช็คหน้า "ผลงานที่เขียนแล้ว" เอง' });
        if (ok) summary.genDone++;
      } catch (e) {
        summary.errors.push(`ปิดใบงานหาย ${r.id} ไม่สำเร็จ: ${e?.message || String(e)}`);
      }
      continue;
    }

    // 🔴 retry อัตโนมัติเฉพาะ 'failed' ชัดๆ เท่านั้น (บทเรียนผู้ตรวจ + อ่าน queueService จริง):
    //   คิวมีระบบ 2 สไตรค์ของตัวเอง — cleanupStaleJobs (ทุก ~60s) คืนงาน processing ค้าง >15 นาที
    //   เป็น pending ให้ลองใหม่ 1 ครั้ง (งาน "ฟื้นแล้วเสร็จทีหลัง" ได้จริง!) ค้างซ้ำค่อยตีตาย 'failed' ถาวร
    //   → 'failed' = จุดจบจริง retry ปลอดภัย 100% · ส่วน pending/processing ค้างเกิน 45 นาที =
    //   ระบบคิวผิดปกติทั้งระบบ (กลไกฟื้นตัวเองไม่ทำงาน) — ส่งซ้ำเสี่ยงเจนซ้ำซ้อน → ปิดแบบแจ้งเหตุให้คนดู
    const isQueueStalled = (jobStatus === 'pending' || jobStatus === 'processing') && ageMs > GEN_STUCK_MS;

    if (isQueueStalled) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const ok = await _writeSentItem(r, { status: 'error', genGaveUp: true, lastError: `งานค้าง ${jobStatus} เกิน ${Math.round(GEN_STUCK_MS / 60000)} นาที — กลไกฟื้นตัวเองของคิวไม่ทำงาน (เช็คคิว/worker แล้วค่อยส่งใหม่เอง — ไม่ส่งซ้ำอัตโนมัติกันเจนซ้ำ)` });
        if (ok) summary.genGaveUp++;
      } catch (e) {
        summary.errors.push(`ปิดใบคิวค้าง ${r.id} ไม่สำเร็จ: ${e?.message || String(e)}`);
      }
      continue;
    }

    if (jobStatus !== 'failed') continue; // ยังวิ่งอยู่ตามปกติ / ยังเร็วไปที่จะสรุป / เช็คไม่ได้ชั่วคราว → รอบหน้าเช็คใหม่

    const deadWhy = 'งานเขียนล้ม (failed — คิวลองซ้ำเองแล้ว 2 รอบ)';

    if (!r.genRetry) {
      // ส่งใหม่อัตโนมัติ 1 ครั้ง — ผ่านห้องรอ/คนเฝ้าประตูเดิมเท่านั้น (ไม่มีทางลัดเข้าคิว)
      try {
        // ปลดล็อกลีดก่อน (sendLeadAsText กันส่งซ้ำเมื่อ status==='sent') — เขียน event 'status' ลง timeline ให้เอง
        // eslint-disable-next-line no-await-in-loop
        await setLeadStatus(r.leadId, 'kept');
      } catch (e) {
        // ลีดหาย/รีเซ็ตไม่ได้ — ปล่อยใบกลับห้องรอไปตามแผน เดี๋ยวรอบส่งจริงจะรายงาน error ชัดเอง (attempts เดิมคุม)
        summary.errors.push(`รีเซ็ตลีด ${r.leadId} ไม่สำเร็จ: ${e?.message || String(e)}`);
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const ok = await _writeSentItem(r, {
          status: 'waiting',
          attempts: 0,               // เริ่มนับใหม่สำหรับรอบส่งใหม่ (ของเดิมเป็นคนละเหตุ)
          genRetry: 1,
          genPrevJobId: r.sentJobId, // เก็บร่องรอยงานเก่าไว้ตรวจย้อน
          sentJobId: null,
          sentAt: null,
          // 🔴 ล้างร่องรอยเฟสรอคลิปเดิมให้หมด — กันรูล A (3 ชม.) ฆ่าใบ retry ผิดตัว + ให้ถึงคิวได้ทันที
          firstDeferredAt: null,
          nextEligibleAt: null,
          lastError: null,
          lastNote: `🔁 ${deadWhy} — ส่งใหม่อัตโนมัติ (ครั้งเดียว)`,
        });
        if (ok) summary.genRetried++;
      } catch (e) {
        summary.errors.push(`คืนใบ ${r.id} เข้าห้องรอไม่สำเร็จ: ${e?.message || String(e)}`);
      }
    } else {
      // เคยส่งใหม่แล้วยังตายอีก → ยอมแพ้อย่างมีหลักฐาน — ให้มนุษย์ตัดสิน
      try {
        // eslint-disable-next-line no-await-in-loop
        const ok = await _writeSentItem(r, {
          status: 'error',
          genGaveUp: true,
          lastError: `${deadWhy} ซ้ำหลังส่งใหม่แล้ว 1 ครั้ง (งานเก่า ${String(r.genPrevJobId || '-').slice(0, 8)} · งานใหม่ ${String(r.sentJobId || '-').slice(0, 8)})`,
        });
        if (ok) summary.genGaveUp++;
      } catch (e) {
        summary.errors.push(`ปิดใบ ${r.id} เป็น error ไม่สำเร็จ: ${e?.message || String(e)}`);
      }
    }
  }

  // ── C) เก็บเกี่ยวอัตโนมัติ — ผลเจนที่เสร็จไหลเข้า 📚 คลังเนื้อพร้อมใช้เอง ──────
  if (!outOfTime()) {
    try {
      summary.harvest = await harvestFromLeads({ origin, maxJobs: HARVEST_MAX });
    } catch (e) {
      summary.errors.push(`เก็บเกี่ยวอัตโนมัติล้ม: ${e?.message || String(e)}`);
    }
  }

  return summary;
}
