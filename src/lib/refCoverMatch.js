// ============================================================
// 🎯 Ref Cover Match — เลือกปก reference จากคลังที่ "แนวตรงข่าว" ที่สุด
// ------------------------------------------------------------
// ให้คะแนนแต่ละปกในคลังจาก DNA (matchNewsType + emotion + จำนวนช่อง) เทียบสัญญาณข่าว
// คลังว่าง → null · ไม่มีแนวตรง → คืนปกล่าสุดเป็น generic
// ============================================================

import { listRefCovers } from '@/lib/refCoverLibrary';

const norm = (s) => String(s || '').toLowerCase().trim();

/**
 * @param {object} signals - { emotion, text, charCount }
 *   emotion: อารมณ์หลักข่าว · text: มุมเล่า+อารมณ์รอง+หมวด (ไว้จับคำ) · charCount: จำนวนตัวละครหลัก
 * @returns {Promise<{ref, score, reason}|null>}
 */
export async function pickBestRef(signals = {}) {
  const items = await listRefCovers(500);
  const pool = items.filter((x) => x.dna && x.imagePath);
  if (!pool.length) return null;

  const emo = norm(signals.emotion);
  const hay = norm(`${signals.emotion || ''} ${signals.text || ''}`);
  const cc = Number(signals.charCount) || 0;
  // ★ ช็อตที่ "ข่าวต้องมี" (จากเนื้อเต็ม → compass visualDreamShots) = หัวใจการเลือกแบบ content-driven
  const dreamRoles = (signals.dreamShots || []).map(norm).filter(Boolean);

  let best = null, bestScore = -1, bestReason = '', bestCov = 0;
  for (const it of pool) {
    const d = it.dna || {};
    let score = 0;
    const hits = [];
    // ① แนวข่าวที่ปกนี้เหมาะ (matchNewsType) ตรงข่าว
    for (const t of d.matchNewsType || []) {
      const tn = norm(t);
      if (tn && (hay.includes(tn) || tn.split(/[\s\-/]+/).some((w) => w.length >= 3 && hay.includes(w)))) { score += 3; hits.push(t); }
    }
    // ② อารมณ์ปก/matchEmotion ↔ อารมณ์ข่าว
    const refEmos = [d.emotion, ...(d.matchEmotion || [])].map(norm).filter(Boolean);
    if (emo && refEmos.some((e) => e && (e.includes(emo) || emo.includes(e)))) { score += 2; hits.push('อารมณ์ตรง'); }
    // ③ ★ role coverage — ปก ref มี "ช่องบทบาท" ที่ข่าวต้องการครบแค่ไหน (ปกต้องมีอะไร → หา ref ที่จัดแบบนั้น)
    let covered = 0;
    if (dreamRoles.length) {
      const refRoles = [
        ...(d.template?.slots || []).map((s) => norm(s.role)),
        ...(d.slots || []).map((s) => norm(s.role)),
        ...(d.neededShots || []).map(norm),
      ].filter(Boolean);
      for (const dr of dreamRoles) {
        if (refRoles.some((rr) => rr && (rr.includes(dr) || dr.includes(rr)))) covered++;
      }
      if (covered) { score += covered * 2; hits.push(`ช่องตรงข่าว ${covered}/${dreamRoles.length}`); }
    }
    // ④ จำนวนคน ↔ จำนวนช่อง
    if (cc >= 2 && (Number(d.panelCount) || 0) >= 4) score += 1;

    if (score > bestScore) { bestScore = score; best = it; bestReason = hits.join(' · '); bestCov = covered; }
  }

  const matched = bestScore > 0;
  return {
    ref: matched ? best : pool[0],       // ไม่มีแนวตรง → ปกล่าสุดในคลัง (generic)
    score: Math.max(0, bestScore),
    roleCoverage: bestCov,
    reason: matched ? bestReason : 'ไม่มีแนวตรงในคลัง — ใช้ปกล่าสุดเป็นต้นแบบ',
  };
}
