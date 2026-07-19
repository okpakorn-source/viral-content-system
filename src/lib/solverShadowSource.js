// ============================================================
// 🔬 Solver Shadow Source — ตัวอ่านจริง: ดึง solverShadow/solverShadowV2 จากที่เก็บถาวรจริง
// ------------------------------------------------------------
// Read-only 100% — ไม่เขียน/ไม่แก้ store ใดๆ ไม่แตะพฤติกรรมท่อ MEGA ไม่เปิดสวิตช์ solver ใดๆ
//
// แหล่งข้อมูลจริง (ยืนยันจากโค้ด 19 ก.ค. 69):
//   ① megaJobStore.js ('mega-jobs' store) — ที่เดียวที่ยืนยันแล้วว่ามี solverShadow จริง:
//      job.dossier.pickImages.solverShadow / solverShadowV2 ถูก merge เข้าทุกรอบ tick ผ่าน
//      dossierPatch (ดู src/app/api/mega/tick/route.js: basePatch.dossier = result.dossierPatch,
//      แล้ว megaJobStore.updateJob merge ชั้นเดียวเข้า job.dossier) — คำนวณจริงใน
//      src/lib/megaAdapters.js บรรทัด ~4457-4674 (v1) และ ~4526-4664 (v2 diagnostics)
//   ② megaCoverArchive.js ('mega-cover-runs' store) — เช็คไว้แบบ defensive เผื่ออนาคต แต่ ณ ปัจจุบัน
//      addMegaCover() entry (megaCoverArchive.js:76-93) "ไม่ persist" solverShadow เลย — ทุก caller
//      (megaAdapters.js:5854, refTestPipeline.js:878,1335, compose-test/route.js) ไม่ส่ง dossier/
//      solverShadow เข้า addMegaCover() → แหล่งนี้จะคืน record แทบไม่ได้เลยในระบบปัจจุบัน (ปกติ)
//
// ทั้งสองแหล่งอ่านผ่าน persistStore (Supabase หลัก + ไฟล์ data/*.json fallback) อยู่แล้ว — ไม่มี query ใหม่
// ============================================================

import { listJobs } from './megaJobStore.js';
import { listMegaCovers } from './megaCoverArchive.js';

function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }

/**
 * ดึง solverShadow records จาก mega-jobs (แหล่งหลัก/ยืนยันแล้ว)
 * @param {number} limit จำนวนงานสูงสุดที่จะอ่าน (default สูงเพื่อเก็บสถิติย้อนหลังให้ครบ)
 */
export async function collectFromMegaJobs(limit = 5000) {
  const out = [];
  let jobs = [];
  try {
    jobs = await listJobs(limit);
  } catch (e) {
    console.warn('[solverShadowSource] อ่าน mega-jobs ล้ม (ข้าม แหล่งนี้ถือว่าไม่มีข้อมูล):', e?.message || e);
    return out;
  }
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!isObj(job)) continue;
    const pick = isObj(job.dossier) ? job.dossier.pickImages : null;
    const v1 = isObj(pick) ? pick.solverShadow : null;
    const v2 = isObj(pick) ? pick.solverShadowV2 : null;
    if (!isObj(v1) && !isObj(v2)) continue; // งานที่ยังไม่ถึง S6 หรือ shadow ปิด/ล้ม — ข้ามเงียบ
    out.push({
      jobId: job.id != null ? String(job.id) : null,
      source: 'mega-jobs',
      status: job.status || null,
      at: job.updatedAt || job.createdAt || null,
      solverShadow: isObj(v1) ? v1 : null,
      solverShadowV2: isObj(v2) ? v2 : null,
    });
  }
  return out;
}

/**
 * ดึง solverShadow records จาก mega-cover-runs (defensive — ปัจจุบันคาดว่าจะว่างเปล่าเสมอ ดูหมายเหตุด้านบน)
 * @param {number} limit จำนวน record สูงสุดที่จะอ่าน
 */
export async function collectFromMegaCoverArchive(limit = 500) {
  const out = [];
  let recs = [];
  try {
    recs = await listMegaCovers(limit);
  } catch (e) {
    console.warn('[solverShadowSource] อ่าน mega-cover-runs ล้ม (ข้าม แหล่งนี้ถือว่าไม่มีข้อมูล):', e?.message || e);
    return out;
  }
  for (const rec of Array.isArray(recs) ? recs : []) {
    if (!isObj(rec)) continue;
    const pick = isObj(rec.dossier) ? rec.dossier.pickImages : null;
    const v1 = (isObj(pick) ? pick.solverShadow : null) || (isObj(rec.solverShadow) ? rec.solverShadow : null);
    const v2 = (isObj(pick) ? pick.solverShadowV2 : null) || (isObj(rec.solverShadowV2) ? rec.solverShadowV2 : null);
    if (!isObj(v1) && !isObj(v2)) continue;
    out.push({
      jobId: rec.jobId != null ? String(rec.jobId) : (rec.id != null ? String(rec.id) : null),
      source: 'mega-cover-runs',
      status: null,
      at: rec.at || null,
      solverShadow: isObj(v1) ? v1 : null,
      solverShadowV2: isObj(v2) ? v2 : null,
    });
  }
  return out;
}

/**
 * รวมทั้งสองแหล่งเป็น record list เดียว พร้อมป้อนเข้า aggregateSolverShadow() ต่อได้ทันที
 * ล้มแหล่งใดแหล่งหนึ่ง = แหล่งนั้นว่างเปล่า (ไม่ throw ทั้งฟังก์ชัน)
 */
export async function collectSolverShadowRecords({ jobLimit = 5000, coverLimit = 500 } = {}) {
  const [fromJobs, fromArchive] = await Promise.all([
    collectFromMegaJobs(jobLimit).catch(() => []),
    collectFromMegaCoverArchive(coverLimit).catch(() => []),
  ]);
  return [...fromJobs, ...fromArchive];
}
