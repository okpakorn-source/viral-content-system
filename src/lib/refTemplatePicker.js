// ============================================================
// 🎯 Ref Template Picker — จำแนก DNA ของปก ref → "template จูนมือ" ของ family นั้น
// ------------------------------------------------------------
// เหตุผล (CASE-356/357): เอา % ที่ AI ประเมินมาเป็นโครงตรงๆ = ไม่แม่น + hero ตัดหน้า
//   → แทนที่ด้วย template ที่จูนมือแล้ว (มี hero-tight/guard/สัดส่วนพิสูจน์แล้ว) ตาม family ของ ref
// ไม่เข้า family ไหน → คืน null (ผู้เรียก fallback dnaToTemplateSpec % ดิบ)
// ============================================================

/**
 * @param {object} dna - DNA ของปก ref (จาก refCoverBrain)
 * @param {object} V3 - V3_TEMPLATES (จาก coverExecutorService)
 * @returns {{key, spec}|null}
 */
export function pickTemplateForDNA(dna, V3) {
  try {
    if (!dna || !V3) return null;
    const fam = String(dna.layoutFamily || '').toLowerCase();
    const heroPos = String(dna.layout?.hero?.position || dna.hero?.position || '').toLowerCase();
    const side = Number(dna.layout?.sidePanels?.count ?? dna.sidePanels?.count ?? 2);
    const pick = (k) => (V3[k] ? { key: k, spec: V3[k] } : null);

    // ① hero ซ้าย + คอลลาจ (แนวหลักของปกไวรัลไทย · 18/21 ในคลัง) → vt_ref_5x4 (จูนมือ: 57% + 40/60 + hero-tight + guard กันตัดหน้า)
    if (fam.includes('hero-left') || fam.includes('collage') || heroPos === 'left') {
      if (side >= 3) return pick('vt_ref_tri') || pick('vt_ref_5x4');
      return pick('vt_ref_5x4') || pick('vt_ref_tri');
    }
    // ② วงกลมกลาง / ให้-รับสองฝ่าย → vt_quad_circle (วงกลมกลางผืน)
    if (fam.includes('circle-center') || fam.includes('dual') || fam.includes('split')) {
      return pick('vt_quad_circle') || pick('vt_ref_5x4');
    }
    // ③ กริดหลายหน้า → vt_faces_circle
    if (fam.includes('grid') || fam.includes('faces')) {
      return pick('vt_faces_circle') || pick('vt_quad_circle');
    }
    // ④ hero บน / family อื่นที่ยังไม่มี template จูนมือตรง → null → ผู้เรียก fallback % ดิบ
    return null;
  } catch {
    return null;
  }
}
