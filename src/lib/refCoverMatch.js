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

  const scored = [];
  let bestScore = -1;
  for (const it of pool) {
    const d = it.dna || {};
    let score = 0;
    let typeHit = false;
    const hits = [];
    // ① แนวข่าวที่ปกนี้เหมาะ (matchNewsType) ตรงข่าว
    for (const t of d.matchNewsType || []) {
      const tn = norm(t);
      if (tn && (hay.includes(tn) || tn.split(/[\s\-/]+/).some((w) => w.length >= 3 && hay.includes(w)))) { score += 3; typeHit = true; hits.push(t); }
    }
    // ② อารมณ์ปก/matchEmotion ↔ อารมณ์ข่าว
    const refEmos = [d.emotion, ...(d.matchEmotion || [])].map(norm).filter(Boolean);
    if (emo && refEmos.some((e) => e && (e.includes(emo) || emo.includes(e)))) { score += 2; hits.push('อารมณ์ตรง'); }
    // ③ role coverage — ชื่อ role (hero/reaction/...) generic ทุก ref มีเหมือนกัน → ให้คะแนนเบาลง (แค่ตัวเสริม ไม่ใช่ตัวชี้ขาด)
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
      if (covered) { score += covered * 0.5; hits.push(`ช่องตรงข่าว ${covered}/${dreamRoles.length}`); }
    }
    // ④ จำนวนคน ↔ จำนวนช่อง
    if (cc >= 2 && (Number(d.panelCount) || 0) >= 4) score += 0.5;

    scored.push({ it, score, reason: hits.join(' · '), covered, typeHit });
    if (score > bestScore) bestScore = score;
  }

  const matched = bestScore > 0;
  if (!matched) {
    return { ref: pool[0], score: 0, roleCoverage: 0, typeMatched: false, reason: 'ไม่มีแนวตรงในคลัง — ใช้ปกล่าสุดเป็นต้นแบบ' };
  }

  // ★ 8 ก.ค. (คลัง 18/21 ตระกูลเดียว + role generic ทำคะแนนเสมอกันบ่อย): เดิม argmax ตัวแรกชนะซ้ำทุกครั้ง
  //   → เก็บทุกตัวที่คะแนนอยู่ในช่วงใกล้สุด (margin) แล้วสุ่มถ่วงน้ำหนักตามคะแนน — ตรงเนื้อข่าวจริงชนะขาดเหมือนเดิม (คะแนนไม่เสมอ)
  //   ตรงแบบ generic (เสมอกันบ่อย) → หมุนเวียน ref อื่นในกลุ่มเดียวกันจริง ไม่ใช่ตัวเดิมทุกครั้ง
  const MARGIN = 1; // เผื่อคะแนนห่างไม่เกิน 1 (เช่น matchNewsType hit เดียว = 3 แต้ม ยังชนะขาดเหนือ margin นี้)
  const candidates = scored.filter((s) => s.score >= bestScore - MARGIN && s.score > 0);
  const totalW = candidates.reduce((n, c) => n + c.score, 0);
  let r = Math.random() * totalW;
  let chosen = candidates[candidates.length - 1];
  for (const c of candidates) { r -= c.score; if (r <= 0) { chosen = c; break; } }

  return {
    ref: chosen.it,
    score: bestScore,
    roleCoverage: chosen.covered,
    // ★ 8 ก.ค. (CASE-360): แนวข่าว (matchNewsType) ตรงจริงไหม — typeMatched=false = แมตช์หลวม
    //   → ผู้เรียกควรใช้แค่ "โครง" ห้ามใช้ slot subject นำการเลือกภาพ
    typeMatched: chosen.typeHit,
    reason: chosen.reason + (candidates.length > 1 ? ` (สุ่ม 1/${candidates.length} จากคะแนนใกล้กัน)` : ''),
  };
}
