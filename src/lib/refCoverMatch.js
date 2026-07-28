// ============================================================
// 🎯 Ref Cover Match — เลือกปก reference จากคลังที่ "แนวตรงข่าว" ที่สุด
// ------------------------------------------------------------
// ให้คะแนนแต่ละปกในคลังจาก DNA (matchNewsType + emotion + จำนวนช่อง) เทียบสัญญาณข่าว
// คลังว่าง → null · ไม่มีแนวตรง → คืนปกล่าสุดเป็น generic
// ============================================================

import { listRefCovers } from '@/lib/refCoverLibrary';
import { refPoolGateOpen, computeTemplateGrade } from '@/lib/refCoverGrade';

const norm = (s) => String(s || '').toLowerCase().trim();

// ★ 29 ก.ค. 69 (เจ้าของถาม "ทำไม ref template ไม่เคยเปลี่ยน" — สืบพบ 2 ชั้น: (1) ref เพจจริง 20 ใบ ติดป้าย
//   matchNewsType เป็น tag ทั่วไป (human-interest/ครอบครัว-ดราม่า/กตัญญู/สูญเสีย ฯลฯ) ไม่ใช่คำใน "11 หมวด" ของ
//   คัมภีร์ v3 (coverPagePlaybook.js 【ช. สูตรรายหมวด】) เลย → substring match กับ signals.text (angle+
//   secondaryEmotions) แทบไม่ตรงเป๊ะ (2) signals ที่ส่งเข้า pickBestRef ตอน compose (megaAdapters.js) ไม่เคยมี
//   "หมวดเคส" เลยด้วยซ้ำ — มีแต่ compass.angle/secondaryEmotions ซึ่งเป็นประโยคเล่าเรื่อง ไม่ใช่คำหมวดตรงๆ):
//   สะพานคำศัพท์ "หมวดเคสข่าว (DESK_CATEGORIES, deskBrain.js)" → "หมวด ref/คัมภีร์ v3" (สูตรรายหมวด) — สอง
//   vocabulary คนละชุดกันไม่ตรง 1:1 จับคู่ได้เฉพาะที่ความหมายตรงจริง เหลือ→ปล่อยว่าง (signals.text เดิมจาก
//   angle/emotion ยังทำงานคู่ขนานต่อไป ไม่ตัดทางเดิม) · ★ ไม่ import DESK_CATEGORIES ตรงๆ จาก deskBrain.js
//   (กัน circular import ข้ามโดเมน desk↔cover — เกิน scope) คีย์เป็น literal string เดียวกันเป๊ะ พังไม่ crash
//   แค่ mapping จะไม่ตรงถ้าแหล่งเปลี่ยนชื่อหมวด (fail-safe เดียวกับแพทเทิร์นทั่วทั้งไฟล์นี้)
export const DESK_TO_REF_CATEGORY = {
  'น้ำใจ/ช่วยเหลือ': 'น้ำใจคนธรรมดา',
  'กตัญญู/ครอบครัวอบอุ่น': 'กตัญญู',
  'สู้ชีวิต': 'สู้ชีวิต',
  'คนดังทำดี/ติดดิน': 'น้ำใจคนดัง',
  'ความรัก/แต่งงาน': 'ความรักคู่',
  'ดราม่าสังคม': 'ความยุติธรรม',
  'อาชญากรรม/คดีดัง': 'ความยุติธรรม',
};

/** แปล "หมวดเคสข่าว" (เช่น job.dossier.desk.category) → "หมวด ref คัมภีร์ v3" — ไม่ตรง/ไม่มี = '' (ไม่เติม) */
export function refCategoryHint(deskCategory) {
  return DESK_TO_REF_CATEGORY[String(deskCategory || '').trim()] || '';
}

// ★ 19 ก.ค. (เคสเป็กกี้ REF-mrraukej-6ky5 grade C ถูกเลือก → ปกวงกลมล้น/hero ยืด — pickBestRef เดิม
//   ไม่ถ่วงน้ำหนัก fidelity/geometry เลย): โบนัสคะแนนตาม "grade" ปัจจุบันของ ref (recompute ผ่าน
//   computeTemplateGrade รวม R6 human-verified floor เสมอ — ไม่ใช้เกรดค้างที่ persist ไว้)
//   A→+2 · B→+1 · C→+0 · F→-3 (กันเลือกใบพัง) · ไม่มี grade (คำนวณไม่ได้) → fallback _fidelity.score/100*2
//   ตั้งใจให้ "น้อยกว่า" matchNewsType (+3 เสมอ) — แนวข่าวตรงยังชนะก่อนเสมอ ใบ fidelity สูงชนะแค่ใน
//   กลุ่มคะแนนใกล้กัน (MARGIN) เท่านั้น. PURE ยกเว้นอ่าน env ตัวเดียวเพื่อ kill-switch (แพทเทิร์นเดียวกับ
//   refPoolGateOpen/computeTemplateGrade — รับ env พารามิเตอร์ที่ 2 ให้เทสส่ง env สังเคราะห์แทนได้)
//   kill-switch: MEGA_REF_FIDELITY_PREF==='0' → คืน 0 เสมอ (ปิดเทอมนี้ทั้งหมด = byte-parity เดิม)
export function refFidelityBonus(record, env = process.env) {
  if (env?.MEGA_REF_FIDELITY_PREF === '0') return 0;
  let grade = null;
  try {
    grade = computeTemplateGrade(record, env)?.grade || null;
  } catch {
    grade = null;
  }
  if (grade === 'A') return 2;
  if (grade === 'B') return 1;
  if (grade === 'C') return 0;
  if (grade === 'F') return -3;
  const fs = Number(record?.dna?._fidelity?.score);
  if (Number.isFinite(fs)) return (fs / 100) * 2;
  return 0;
}

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
  // ★ 29 ก.ค. 69 (Opus ตรวจแบตช์ ref-category-rotation รอบ 2 — FAIL): matchNewsType เดิมให้ +3 เท่ากันหมดไม่ว่า
  //   ตรงทั้งป้ายหรือแค่บางส่วน (substring/fragment) — ป้ายรวม/กว้าง (เช่น "น้ำใจ") ยุบรวมแมตช์กับเคสที่ควรตรง
  //   ป้ายเจาะจงกว่า (เช่น "น้ำใจคนดัง") เพราะเป็น substring ของกันและกัน · เช่นเดียวกัน "ความรักคู่" กับ
  //   "ความรักครอบครัว" ชนกันได้ผ่าน tag ทั่วไปอื่น (เช่น "ความรัก") ที่ ref บางใบพกมาด้วย — แก้: แยก 2 ระดับ
  //   "เป๊ะ" (ป้ายทั้งก้อน = "คำ/วลี" ที่แยกด้วยช่องว่างได้ใน hay พอดี — เคสของจริงคือ category hint จาก
  //   refCategoryHint() ที่ต่อเข้า signals.text เป็นชิ้นแยกด้วยช่องว่างเสมอ) = +3 ต่างจาก "แค่ substring ฝังอยู่ใน
  //   ประโยคยาว" (สัญญาณอ่อนกว่า ไม่น่าเชื่อเท่า) = +1 · ใต้ env ใหม่ MEGA_REF_TAG_EXACT default ON —
  //   ==='0' → พฤติกรรมเดิมทุก byte (+3 เท่ากันทั้งสองกรณี ไม่แยกระดับ)
  const _tagExactOn = process.env.MEGA_REF_TAG_EXACT !== '0';
  const hayTokens = hay.split(/\s+/).filter(Boolean);
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
    // ① แนวข่าวที่ปกนี้เหมาะ (matchNewsType) ตรงข่าว — MEGA_REF_TAG_EXACT: เป๊ะ(+3) แยกจาก substring(+1) (ดูคอมเมนต์ hayTokens ด้านบน)
    for (const t of d.matchNewsType || []) {
      const tn = norm(t);
      if (!tn) continue;
      const isSubstringHit = hay.includes(tn) || tn.split(/[\s\-/]+/).some((w) => w.length >= 3 && hay.includes(w));
      if (!isSubstringHit) continue;
      if (_tagExactOn) {
        const isExact = hayTokens.includes(tn);
        if (isExact) { score += 3; typeHit = true; hits.push(t); }
        else { score += 1; typeHit = true; hits.push(`${t}(บางส่วน)`); }
      } else {
        score += 3; typeHit = true; hits.push(t); // ปิดสวิตช์ = พฤติกรรมเดิมทุก byte (+3 ทั้งสองกรณี ไม่แยกระดับ)
      }
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
    // ⑥ ★ 19 ก.ค.: fidelity/grade — ใบ geometry แม่นกว่าชนะใบคะแนนใกล้กัน (ดู refFidelityBonus ด้านบน)
    const fidBonus = refFidelityBonus(it);
    if (fidBonus) { score += fidBonus; hits.push(`fidelity ${fidBonus > 0 ? '+' : ''}${fidBonus}`); }

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
  // ★ 29 ก.ค. 69 (งานหมุนเวียน ref — เจ้าของถาม "ทำไม ref template ไม่เคยเปลี่ยน"): หลังติดป้ายหมวดจริงให้
  //   ref 20 ใบแล้ว หลายใบจะอยู่หมวดเดียวกัน (เช่น "อาลัย" มี 5 ใบ) — MARGIN เดิม (1) อาจแคบไปสำหรับสภาพนี้
  //   (คะแนน matchNewsType เท่ากันหมดในกลุ่มเดียวกัน แต่ fidelity/humanVerified อาจถ่างเกิน margin เดิมจนใบ
  //   เดียวชนะซ้ำในกลุ่ม) → เปิดให้ปรับได้ผ่าน MEGA_REF_VARIETY_MARGIN (float, parse ไม่ได้/ติดลบ = fallback 1
  //   ค่าเดิมเป๊ะ) ไม่ตั้ง env = พฤติกรรมเดิมทุก byte (MARGIN=1 เหมือนเดิม)
  const _marginRaw = parseFloat(process.env.MEGA_REF_VARIETY_MARGIN);
  const MARGIN = Number.isFinite(_marginRaw) && _marginRaw >= 0 ? _marginRaw : 1; // เผื่อคะแนนห่างไม่เกิน MARGIN (เช่น matchNewsType hit เดียว = 3 แต้ม ยังชนะขาดเหนือ margin default นี้)
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
