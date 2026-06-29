/**
 * News Desk Metrics (เฟส 6 — 29 มิ.ย. ตามแผน GPT ข้อ 16)
 * ─────────────────────────────────────────────────────────────────────────────
 * วัด "ระบบดีขึ้นจริงไหม" จากงานจริง — ไม่ใช่แค่ "หาได้กี่ข่าว"
 *   • จาก N ข่าว → ส่ง workflow กี่ใบ (sentRate)
 *   • ข่าวที่ editorial=ready มีกี่ % (readyRate)
 *   • source/หมวดไหน "ผลิตข่าวที่ส่งทำจริง" ได้มากสุด (bySourceSent/byCategorySent)
 *   • reject/ไม่เอา กี่ใบ + เพราะอะไร (rejectRate/rejectReasons)
 * 🔴 ใช้เฉพาะโต๊ะข่าวกลาง — pure function (เทสง่าย) · ไม่แตะระบบทำข่าว/ถอดประเด็น
 */

/** คำนวณ metrics จาก items (ที่ enrich แล้ว — มี editorial) + feedback (รายการ reject/ไม่เอา) */
export function computeDeskMetrics(items, feedback = []) {
  const arr = Array.isArray(items) ? items : [];
  const fb = Array.isArray(feedback) ? feedback : [];
  const total = arr.length;
  const byStatus = {}, byEditorial = {}, byLibrary = {};
  const bySourceSent = {}, byCategorySent = {};
  let sent = 0, ready = 0, claimed = 0;

  for (const it of arr) {
    const st = it.status || 'stock';
    byStatus[st] = (byStatus[st] || 0) + 1;
    if (st === 'sent') sent++;
    if (st === 'claimed') claimed++;

    const ed = (it.editorial && it.editorial.status) || it.editorialStatus || 'unknown';
    byEditorial[ed] = (byEditorial[ed] || 0) + 1;
    if (ed === 'ready') ready++;

    const lib = it.library || '?';
    byLibrary[lib] = (byLibrary[lib] || 0) + 1;

    // source/หมวดที่ "ส่งทำจริง" = พิสูจน์ว่าแหล่ง/หมวดนั้นให้ข่าวพร้อมใช้
    if (st === 'sent') {
      const src = (it.reliability && it.reliability.tier) || it.sourceType || '?';
      bySourceSent[src] = (bySourceSent[src] || 0) + 1;
      const cat = it.category || '?';
      byCategorySent[cat] = (byCategorySent[cat] || 0) + 1;
    }
  }

  // reject reasons (จาก feedback ที่ทีมกดไม่เอา + junkReason)
  const rejectReasons = {};
  for (const f of fb) {
    const r = f.reason || f.junkReason || f.rejectReason || 'ไม่ระบุ';
    rejectReasons[r] = (rejectReasons[r] || 0) + 1;
  }
  const topSorted = (obj, n = 5) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ key: k, count: v }));

  return {
    total, sent, claimed, ready,
    sentRate: total ? Math.round((sent / total) * 100) : 0,        // ★ ตัวชี้วัดหลัก: ส่ง workflow กี่ %
    readyRate: total ? Math.round((ready / total) * 100) : 0,       // ★ พร้อมเขียนกี่ %
    byStatus, byEditorial, byLibrary,
    bestSources: topSorted(bySourceSent),                           // ★ แหล่งที่ผลิตข่าวส่งทำจริงสุด
    bestCategories: topSorted(byCategorySent),                      // ★ หมวดที่ส่งทำจริงสุด
    topRejectReasons: topSorted(rejectReasons),                     // ★ เหตุผลถูกตัดบ่อยสุด → ปรับ query รอบหน้า
    rejectCount: fb.length,
  };
}
