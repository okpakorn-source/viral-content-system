// ============================================================
// 🎯 Ref Cover Match — เลือกปก reference จากคลังที่ "แนวตรงข่าว" ที่สุด
// ------------------------------------------------------------
// ให้คะแนนแต่ละปกในคลังจาก DNA (matchNewsType + emotion + จำนวนช่อง) เทียบสัญญาณข่าว
// คลังว่าง → null · ไม่มีแนวตรง → คืนปกล่าสุดเป็น generic
// ============================================================

import { listRefCovers } from '@/lib/refCoverLibrary';
import { refPoolGateOpen } from '@/lib/refCoverGrade';

const norm = (s) => String(s || '').toLowerCase().trim();

// ★ 10 ก.ค. Wave1-A: FNV-1a 32-bit hash นิ่ง (string เดิม → เลขเดิมเสมอ) — ใช้แทน Math.random() ตอน tiebreak
//   ให้เคส seedKey เดิม re-run กี่รอบก็ได้ ref ใบเดิม (deterministic) ไม่ใช่สุ่มจริงทุกครั้ง
function _fnv1aHash(str) {
  let h = 0x811c9dc5;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0; // uint32
}

/**
 * @param {object} signals - { emotion, text, charCount }
 *   emotion: อารมณ์หลักข่าว · text: มุมเล่า+อารมณ์รอง+หมวด (ไว้จับคำ) · charCount: จำนวนตัวละครหลัก
 * @param {object} opts - { seedKey } — คีย์นิ่งต่อเคส (เช่น caseId/job.id) ให้ tiebreak ได้ผลเดิมทุกรอบ retry
 *   ไม่ส่ง → fallback signals.newsTitle → JSON.stringify(signals) (ยังนิ่งกว่า Math.random() เดิม)
 * @returns {Promise<{ref, score, reason}|null>}
 */
export async function pickBestRef(signals = {}, opts = {}) {
  const items = await listRefCovers(500);
  // ★ 9 ก.ค. (ผู้ใช้เคาะ "ใช้เฉพาะ ref ที่ทำตามได้จริง 100%"): ตัด ref ที่เครื่องวัดตะเข็บชี้ว่า
  //   ขอบภาพถูกกลืน/ตกแต่งจนวางช่องตามไม่ได้ (_reproducible=false จาก _ref_apply_reproducible.mjs)
  // ★ R3 (16 ก.ค.): ตัวกรองพูลย้ายไป refPoolGateOpen (PURE) — OFF = พฤติกรรมเดิมเป๊ะ
  //   (dna+imagePath+_reproducible!==false) · REF_TEMPLATE_GRADE_GATE='1' = รับเฉพาะเกรด A/B ไม่ซ้ำ
  const pool = items.filter((x) => refPoolGateOpen(x));
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
    // ⑤ 🛠 เฟส 2 (8 ก.ค.): ใบที่ "ตาคนยืนยันเทมเพลตแล้ว" เชื่อถือได้กว่า AI วัด → บวกแต้มให้ชนะ near-tie
    //   (1.5 > MARGIN 1 = ใบยืนยันชนะใบไม่ยืนยันที่คะแนนเนื้อหาเท่ากันเสมอ แต่ไม่ล้ม matchNewsType ที่ต่าง 3)
    if (d._humanVerified) score += 1.5;

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
  // ★ 10 ก.ค. Wave1-A: เดิม Math.random() → เคสเดิม re-run ได้ ref คนละใบ (สุ่มจริงทุกครั้ง)
  //   → เปลี่ยนเป็นเลขนิ่งจาก hash(seedKey) แทน (เคสเดิม→เลขเดิม→ใบเดิมเสมอ) คงเจตนาเดิม (ถ่วงน้ำหนัก กระจายใบ ไม่ใช่ argmax ตัวแรกชนะตลอด)
  //   kill switch: MEGA_REF_SEEDED=0 → ใช้ Math.random() แบบเดิมเป๊ะ
  const useSeeded = process.env.MEGA_REF_SEEDED !== '0';
  let r;
  if (useSeeded) {
    const seedKey = opts.seedKey || signals.newsTitle || JSON.stringify(signals);
    r = (_fnv1aHash(seedKey) / 0xffffffff) * totalW;
  } else {
    r = Math.random() * totalW;
  }
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
