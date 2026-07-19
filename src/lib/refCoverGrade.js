// ============================================================
// 🏷️ refCoverGrade — เกรดเดียวที่บอกความจริง "หยิบใบนี้ไปใช้แล้วถูกต้องแค่ไหน" (R3)
// ------------------------------------------------------------
// ยืนบนงานสองชั้นที่อยู่ในคลังแล้ว:
//   R1 = dna._fidelity  (วัดเชิงพิกเซลว่า template ตรงกับภาพจริงแค่ไหน — score/confidence/worstOffsetPx)
//   R2 = dna._duplicateOf (ธงใบซ้ำ) + dna._reproducible (เครื่องวัดตะเข็บเก่า)
// เป้า: แทนธงลวง _humanVerified (ตาคนกดยืนยันได้แม้ template เพี้ยน) ด้วยเกรด deterministic
//   ที่คำนวณจากตัววัดจริงล้วน — _humanVerified ไม่มีผลต่อเกรด (เป็นแค่ metadata รีวิว)
// PURE: ไม่มี env / ไม่มี I/O / ไม่มี AI — record เดิม → เกรดเดิมเสมอ (idempotent)
//   ★ ยกเว้น R6 (19 ก.ค.): grade floor สำหรับใบ human-verified อ่าน env ตัวเดียว (REF_HUMAN_VERIFIED_FLOOR)
//     ผ่านพารามิเตอร์ที่ 2 (แพทเทิร์นเดียวกับ refPoolGateOpen ด้านล่าง) — default = process.env, ยังคง idempotent
//     ต่อ (record, env) คู่เดิมเสมอ (ไม่สุ่ม/ไม่มี I/O) — ทดสอบส่ง env สังเคราะห์แทนได้โดยไม่แตะ process.env จริง
// ============================================================

import { dnaToTemplateSpec } from './refTemplate.js';

// เวอร์ชันเครื่องคิดเกรด — ฝังในผลลัพธ์ เพื่อรู้ว่าเกรดในคลังคิดด้วยตรรกะรุ่นไหน (ถ้าปรับเกณฑ์ต้องเด้งเลข)
export const GRADE_ENGINE_VERSION = 'ref-grade-r3-v1';

// อันดับเกรด (มาก=ดี) — ใช้ทำ modifier "ลดหนึ่งขั้น" แบบ deterministic
//   A(3) > B(2) > C(1) > F(0) · ลดขั้นจาก F แล้วยัง F (ไม่ต่ำกว่านั้น)
const RANK_TO_GRADE = ['F', 'C', 'B', 'A'];

/**
 * คำนวณเกรดเทมเพลตของ ref cover 1 ใบ (deterministic ล้วน)
 * @param {object} record - ระเบียนในคลัง { id, imagePath, dna, ... } (dna มี _fidelity/_duplicateOf/_reproducible จาก R1/R2)
 * @param {object} [env=process.env] - แหล่ง env สำหรับ kill-switch R6 (REF_HUMAN_VERIFIED_FLOOR) — ส่ง object สังเคราะห์ตอนเทสได้
 * @returns {{grade:'A'|'B'|'C'|'F', reasons:string[], engineVersion:string}}
 */
export function computeTemplateGrade(record, env = process.env) {
  const dna = record?.dna;
  // imagePath อยู่ระดับบนของ record (คลังจริง) — เผื่อบางระเบียนเก็บใน dna ด้วย ก็รับทั้งสองที่
  const imagePath = record?.imagePath || dna?.imagePath;

  // ── R5b: เส้น derived — variant ที่ "กลั่น" จากใบแม่ (refTemplateVariants) ────────────────────
  //   variant ไม่เคยถูกวัด _fidelity กับภาพจริง (imagePath ชี้ภาพแม่เป็น provenance ล้วน) → ห้ามให้เกรด
  //   เท่าใบที่วัดจริง. เกรด "จากแม่" (motherGrade ที่ฝังไว้ตอนกลั่น) โดยลดหนึ่งขั้นเสมอ:
  //     แม่ A → variant B · แม่ B → variant C (ห้ามเกิน B — โครงลูกยังไม่พิสูจน์กับภาพจริง)
  //   + geometry sane เป็นเงื่อนไข "บังคับ": dnaToTemplateSpec ต้องไม่ null (วางช่องตามโครง variant ได้จริง)
  //     ไม่ sane = F ทันที (ไม่ว่า motherGrade จะดีแค่ไหน). PURE: ไม่ lookup คลัง — อ่าน motherGrade ที่ฝังมา.
  //   ★ ใบปกติ (ไม่มี _derived) ไม่แตะเส้นนี้เลย → พฤติกรรมเดิม byte-unchanged (เทสเดิมผ่านครบ).
  const derived = dna?._derived;
  if (derived && typeof derived === 'object') {
    let dspec = null;
    try { dspec = dnaToTemplateSpec(dna); } catch { dspec = null; }
    if (!dspec) {
      return _result('F', [`variant กลั่นจาก ${derived.fromRefId || '?'} แต่ geometry ไม่ sane (dnaToTemplateSpec ไม่ผ่าน) → F`]);
    }
    const mg = String(derived.motherGrade || '');
    const capped = mg === 'A' ? 'B' : mg === 'B' ? 'C' : 'F'; // ลดหนึ่งขั้น (แม่ต้อง A/B; อื่น = F เชิงป้องกัน)
    return _result(capped, [
      `variant (${derived.method || '?'}) กลั่นจาก ${derived.fromRefId || '?'} เกรดแม่ ${mg || '?'} → ลดหนึ่งขั้นเป็น ${capped}`,
      'geometry sane (dnaToTemplateSpec ผ่าน) · ไม่ได้วัด _fidelity กับภาพจริง',
    ]);
  }
  // _duplicateOf: scripts/repair-ref-library.mjs เขียนที่ระดับบนของ record (rec._duplicateOf)
  //   ไม่ใช่ใน dna — อ่าน record ก่อน แล้ว fallback dna เผื่อระเบียนเก่าเก็บใน dna (กันพลาดทั้งสองทาง)
  const dupOf = record?._duplicateOf ?? dna?._duplicateOf;

  // ── ประตู F ทันที (hard fail — ไม่ต้องดู _fidelity เลย) ────────────────────
  // 1) ใบซ้ำ (_duplicateOf จาก R2 มีค่า) → ห้ามถูกหยิบเด็ดขาด ตัดตั้งแต่ต้น
  if (dupOf) {
    return _result('F', [`ใบซ้ำของ ${dupOf} (_duplicateOf)`]);
  }
  // 2) ★ redesign 18 ก.ค. (คำสั่ง sol): ref = โครงล้วน ไม่เก็บภาพ → เกรดมาจาก DNA + geometry + _fidelity เท่านั้น
  //    เลิก require imagePath (เดิม 'ไม่มี dna หรือ imagePath' → F) · geometry sane เช็คด้วย dnaToTemplateSpec ด้านล่างแล้ว
  if (!dna) {
    return _result('F', ['ไม่มี dna']);
  }
  // 3) โครงแปลงเป็น templateSpec ไม่ผ่าน (dnaToTemplateSpec คืน null) → วางช่องตาม ref ไม่ได้จริง
  //    (dnaToTemplateSpec เป็น PURE + มี try/catch ในตัว คืน null เมื่อโครงใช้ไม่ได้ — ห่อ try อีกชั้นกันเหนียว)
  let spec = null;
  try { spec = dnaToTemplateSpec(dna); } catch { spec = null; }
  if (!spec) {
    return _result('F', ['dnaToTemplateSpec ไม่ผ่าน (โครงคอลลาจใช้ไม่ได้)']);
  }
  // 4) ไม่มี _fidelity (R1 ยังไม่วัดความเที่ยง) → ไม่รู้ว่าทำตามได้จริงแค่ไหน = ไม่ผ่าน
  const fid = dna._fidelity;
  if (!fid || typeof fid !== 'object') {
    return _result('F', ['ไม่มี _fidelity (R1 ยังไม่วัดความเที่ยงเชิงพิกเซล)']);
  }

  // ── โซนพื้นฐานจาก _fidelity (score/confidence) ────────────────────────────
  const reasons = [];
  const score = Number(fid.score);
  const conf = String(fid.confidence || '');
  let rank; // 3=A 2=B 1=C 0=F
  if (conf === 'low' || !Number.isFinite(score) || score < 50) {
    // confidence=low = วัดตะเข็บไม่ชัด (score มัก null) · หรือ score<50 = ทำตาม ref ได้ต่ำ → F
    rank = 0;
    reasons.push(
      conf === 'low'
        ? '_fidelity confidence=low (วัดตะเข็บไม่ชัด) → F'
        : `_fidelity score ${Number.isFinite(score) ? score : 'null'} < 50 → F`
    );
  } else if (score >= 85) {
    rank = 3; reasons.push(`_fidelity score ${score} ≥85 → โซน A`);
  } else if (score >= 70) {
    rank = 2; reasons.push(`_fidelity score ${score} (70-84) → โซน B`);
  } else {
    rank = 1; reasons.push(`_fidelity score ${score} (50-69) → โซน C`);
  }

  // ── modifier: ลดหนึ่งขั้น (สัญญาณเสริม ไม่ใช่ประตูเดี่ยวอีกต่อไป) ───────────
  //   ทำงานเฉพาะเมื่อยังมีขั้นให้ลด (rank>0) — ถ้า F อยู่แล้ว ลดไม่ได้ ไม่บันทึกเหตุผลลวง
  // (a) _reproducible===false → เครื่องวัดตะเข็บเก่า (_ref_apply_reproducible) ไม่ผ่าน → ลดหนึ่งขั้น
  if (dna._reproducible === false && rank > 0) {
    rank -= 1;
    reasons.push('_reproducible=false → ลดหนึ่งขั้น (เครื่องวัดตะเข็บเก่าไม่ผ่าน)');
  }
  // (b) worstOffsetPx>30 → ตะเข็บที่แย่สุดคลาดเกิน 30px = วางช่องเพี้ยนชัด → ลดหนึ่งขั้น
  const worst = Number(fid.worstOffsetPx);
  if (Number.isFinite(worst) && worst > 30 && rank > 0) {
    rank -= 1;
    reasons.push(`worstOffsetPx ${worst} > 30 → ลดหนึ่งขั้น`);
  }

  // ── R6 (19 ก.ค.): grade floor สำหรับใบ human-verified — ตาคนยืนยัน geometry ของ template แล้ว
  //   แต่ auto-fidelity score ยังต่ำ (วัดตะเข็บกับภาพตอนอัพเท่านั้น ไม่ได้บอกว่าโครงผิด) → ไม่ควรถูกกักที่ C/F
  //   ทำงานเฉพาะจุดนี้ — "หลัง" ผ่านทุกประตู hard-fail ด้านบนมาแล้ว (ไม่ใช่ _duplicateOf/ไม่มี dna/
  //   dnaToTemplateSpec พัง/ไม่มี _fidelity — พวกนั้น return ไปตั้งแต่ต้นฟังก์ชัน ไม่มีทางมาถึงบรรทัดนี้)
  //   → floor เฉพาะ F/C ที่มาจาก "fidelity score ต่ำ" เท่านั้น · ไม่ลดขั้นใบที่ได้ A/B อยู่แล้ว (rank<2 เท่านั้น)
  //   kill-switch: REF_HUMAN_VERIFIED_FLOOR==='0' → ปิด floor นี้ กลับเป็นพฤติกรรมเดิมทั้งหมด (default เปิด)
  if (env?.REF_HUMAN_VERIFIED_FLOOR !== '0' && dna._humanVerified === true && rank < 2) {
    rank = 2;
    reasons.push('human-verified → floor เป็น B (ตาคนยืนยัน geometry แล้ว)');
  }

  return _result(RANK_TO_GRADE[rank], reasons);
}

function _result(grade, reasons) {
  return { grade, reasons, engineVersion: GRADE_ENGINE_VERSION };
}

// ============================================================
// 🚪 ประตูพูล ref (ใช้ร่วมกัน refCoverMatch + compose-test list) — ใต้สวิตช์ REF_TEMPLATE_GRADE_GATE
// ------------------------------------------------------------
// อยู่ในไฟล์นี้ (ไม่ใช่ refCoverMatch) เพราะ refCoverMatch import ผ่าน alias '@/…' — node --test เรียกไม่ได้
//   ตัวกรองที่ตัดสินพูลจริงจึงต้องอยู่ในโมดูล PURE ที่เทสตรงได้ (เทียบ OFF byte-identical + ON กรองถูก)
// สวิตช์ default OFF (เหตุผล: pool ตอนนี้แคบ รอ R5a กู้ใบก่อนค่อยเปิด) — ต้องเป็น '1' เป๊ะเท่านั้นจึงเปิด
export function refPoolGateOpen(record, env = process.env) {
  const dna = record?.dna;
  // ★ redesign 18 ก.ค. (คำสั่ง sol — ref = โครงล้วน ไม่เก็บภาพตัวอย่าง): เลิก require imagePath
  //   เปลี่ยนเป็น require "DNA ที่มีโครงจริง" (template.slots หรือ dna.slots ≥3 ช่อง) — ใช้ประกอบปกได้จากโครง ไม่ต้องมีภาพ
  //   backward-compat: 33 ใบเดิมมี slots ครบอยู่แล้ว → พฤติกรรมไม่เปลี่ยน · imagePath จะไม่ถูก persist อีกต่อไป
  if (!dna) return false;
  const _slots = (dna.template && Array.isArray(dna.template.slots)) ? dna.template.slots : (Array.isArray(dna.slots) ? dna.slots : null);
  if (!_slots || _slots.length < 3) return false;
  // ★ 17 ก.ค. (เจ้าของสั่ง "เอาเทมเพลตเพี้ยนออก เหลือใบเดียวที่มั่นใจ 100% เทสทีละเทมเพลต"):
  //   REF_POOL_PIN=<record.id> → พูลเหลือเฉพาะใบนั้นทุกทางเข้า (dropdown/auto-match/variant-lock)
  //   เหตุ: บางเทมเพลตมีเฟด/ช่องซ้อนทำระบบอ่านช่องผิดจนภาพเพี้ยน (เช่น 732269634 ที่ repro=false)
  //   ไม่ตั้ง env = พฤติกรรมเดิมเป๊ะทุก byte · pin ชี้ id ไม่มีจริง = พูลว่าง → เดินเส้น "คลังว่าง" เดิม (ปลอดภัย)
  const pin = String(env?.REF_POOL_PIN || '').trim();
  if (pin) return String(record?.id || '') === pin;
  // ★ 18 ก.ค. (ผู้ใช้สั่ง — audit เกรด): REF_POOL_ALLOWLIST = ชุด id "เทมเพลตที่แม่นจริง" (คั่นด้วย ,) — ขยายจาก
  //   single-pin มาเป็น "หลายใบที่เชื่อได้" โดยไม่ต้องเปิดทั้งพูล (ยังคัด C/F ที่ DNA อ่านเพี้ยนออก)
  //   ไม่ตั้ง = พฤติกรรมเดิมเป๊ะ (ไปเช็ค grade gate ด้านล่าง) · ชี้ id ไม่มีจริง = ใบนั้นไม่เข้า (พูลเหลือเฉพาะที่ตรง)
  const allow = String(env?.REF_POOL_ALLOWLIST || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allow.length) return allow.includes(String(record?.id || ''));
  const gateOn = env?.REF_TEMPLATE_GRADE_GATE === '1';
  if (!gateOn) {
    // OFF → พฤติกรรมเดิม "ก่อน R5b" เป๊ะ: pool ต้อง byte-identical กับคลัง 21 ใบก่อนกลั่นโครงลูก
    //   ★ R5b fix: variant กลั่น (_derived) ไม่มี _reproducible → `_reproducible!==false` เป็น true = หลุดเข้าพูล OFF
    //     ทั้งที่ตอน OFF ต้องไม่เห็น variant เลย (variant เกิดใหม่ใน R5b — pool เดิมไม่มี). กันด้วย !_derived:
    //     variant มองเห็นได้ "เฉพาะเมื่อ gate ON" เท่านั้น → OFF pool กลับเป็น 7 (== backup) ทุก seed/signal.
    //   รวมกับ core ด้านบน = `dna && imagePath && !_derived && _reproducible!==false`
    return !dna._derived && dna._reproducible !== false;
  }
  // ON → คงเช็ค dna+imagePath (ด้านบน) · ไม่มี _duplicateOf · เกรด A/B เท่านั้น
  //   (_reproducible ไม่เช็คแยกอีกต่อไป — ถูกยุบเป็น modifier ในเกรดแล้ว จึงยอมใบ B ที่ repro=false ผ่านได้)
  //   _duplicateOf อ่านที่ระดับ record (ตำแหน่งจริงที่ repair script เขียน) fallback dna กันเหนียว
  if ((record?._duplicateOf ?? dna._duplicateOf)) return false;
  const g = computeTemplateGrade(record).grade;
  return g === 'A' || g === 'B';
}
