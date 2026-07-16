// ============================================================
// 🏷️ refCoverGrade — เกรดเดียวที่บอกความจริง "หยิบใบนี้ไปใช้แล้วถูกต้องแค่ไหน" (R3)
// ------------------------------------------------------------
// ยืนบนงานสองชั้นที่อยู่ในคลังแล้ว:
//   R1 = dna._fidelity  (วัดเชิงพิกเซลว่า template ตรงกับภาพจริงแค่ไหน — score/confidence/worstOffsetPx)
//   R2 = dna._duplicateOf (ธงใบซ้ำ) + dna._reproducible (เครื่องวัดตะเข็บเก่า)
// เป้า: แทนธงลวง _humanVerified (ตาคนกดยืนยันได้แม้ template เพี้ยน) ด้วยเกรด deterministic
//   ที่คำนวณจากตัววัดจริงล้วน — _humanVerified ไม่มีผลต่อเกรด (เป็นแค่ metadata รีวิว)
// PURE: ไม่มี env / ไม่มี I/O / ไม่มี AI — record เดิม → เกรดเดิมเสมอ (idempotent)
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
 * @returns {{grade:'A'|'B'|'C'|'F', reasons:string[], engineVersion:string}}
 */
export function computeTemplateGrade(record) {
  const dna = record?.dna;
  // imagePath อยู่ระดับบนของ record (คลังจริง) — เผื่อบางระเบียนเก็บใน dna ด้วย ก็รับทั้งสองที่
  const imagePath = record?.imagePath || dna?.imagePath;
  // _duplicateOf: scripts/repair-ref-library.mjs เขียนที่ระดับบนของ record (rec._duplicateOf)
  //   ไม่ใช่ใน dna — อ่าน record ก่อน แล้ว fallback dna เผื่อระเบียนเก่าเก็บใน dna (กันพลาดทั้งสองทาง)
  const dupOf = record?._duplicateOf ?? dna?._duplicateOf;

  // ── ประตู F ทันที (hard fail — ไม่ต้องดู _fidelity เลย) ────────────────────
  // 1) ใบซ้ำ (_duplicateOf จาก R2 มีค่า) → ห้ามถูกหยิบเด็ดขาด ตัดตั้งแต่ต้น
  if (dupOf) {
    return _result('F', [`ใบซ้ำของ ${dupOf} (_duplicateOf)`]);
  }
  // 2) ไม่มี dna หรือ imagePath → ประกอบปกจากใบนี้ไม่ได้
  if (!dna || !imagePath) {
    return _result('F', ['ไม่มี dna หรือ imagePath']);
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
  // core เดิมที่ต้องมีทุกโหมด: dna + imagePath (ประกอบปกจากใบนี้ได้)
  if (!dna || !record?.imagePath) return false;
  const gateOn = env?.REF_TEMPLATE_GRADE_GATE === '1';
  if (!gateOn) {
    // OFF → พฤติกรรมเดิมเป๊ะ: + เครื่องวัดตะเข็บเก่า (_reproducible!==false)
    //   รวมกับ core ด้านบน = `dna && imagePath && _reproducible!==false` (byte-identical กับตัวกรองเดิม)
    return dna._reproducible !== false;
  }
  // ON → คงเช็ค dna+imagePath (ด้านบน) · ไม่มี _duplicateOf · เกรด A/B เท่านั้น
  //   (_reproducible ไม่เช็คแยกอีกต่อไป — ถูกยุบเป็น modifier ในเกรดแล้ว จึงยอมใบ B ที่ repro=false ผ่านได้)
  //   _duplicateOf อ่านที่ระดับ record (ตำแหน่งจริงที่ repair script เขียน) fallback dna กันเหนียว
  if ((record?._duplicateOf ?? dna._duplicateOf)) return false;
  const g = computeTemplateGrade(record).grade;
  return g === 'A' || g === 'B';
}
