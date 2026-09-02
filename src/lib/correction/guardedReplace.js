/**
 * แทนคำต้องห้าม "แบบเคารพกันชน" — ใช้ pattern เดิมที่ด่านตรวจ (L2) ใช้จับ ไม่ใช่ข้อความดิบ
 *
 * ★ 1 ก.ย. 69 — บั๊กที่พิสูจน์แล้ว 2 จุด:
 *   1) safeCorrectionService L3A ใช้ `content.replace(issue.text, ...)` = โดนตำแหน่งแรกในบทความ
 *      ซึ่งอาจเป็นคำใน whitelist ("ยาฆ่าเชื้อ" → "ยาก่อเหตุเชื้อ") ส่วนคำเสี่ยงตัวจริงถัดไปยังอยู่
 *   2) correctionPipeline rollback-scrub ใช้ `split(text).join(...)` = แทนทุกที่รวมศัพท์แพทย์
 *      ("เส้นเลือดในสมองแตก" → "เส้นร่องรอยเหตุการณ์ในสมองแตก") ทั้งที่ L2 มี lookbehind กันไว้แล้ว
 *
 * วิธี: L2 แนบ patternSource/patternFlags มากับ issue → ที่นี่สร้าง regex เดิม (ตัด g เมื่อขอแทนตำแหน่งเดียว)
 *       issue ที่ไม่มี pattern (engagement_bait ฯลฯ) ถอยไปพฤติกรรมเดิมทุกไบต์
 */

/**
 * @param {string} content
 * @param {{ text: string, suggestion: string, patternSource?: string, patternFlags?: string }} issue
 * @param {{ all?: boolean }} [opts] all=true แทนทุกตำแหน่ง · false แทนตำแหน่งแรกที่ "ผ่านกันชน"
 * @returns {string}
 */
export function guardedReplace(content, issue, { all = true } = {}) {
  const text = String(content ?? '');
  if (!issue || typeof issue.text !== 'string' || !issue.text) return text;
  const suggestion = typeof issue.suggestion === 'string' ? issue.suggestion : '';

  if (issue.patternSource) {
    let re;
    try {
      const flags = String(issue.patternFlags || '').replace(/g/g, '') + (all ? 'g' : '');
      re = new RegExp(issue.patternSource, flags);
    } catch {
      re = null;
    }
    if (re) return text.replace(re, suggestion);
  }

  // ไม่มี pattern → พฤติกรรมเดิม
  return all ? text.split(issue.text).join(suggestion) : text.replace(issue.text, suggestion);
}

/** เรียง issue ให้คำยาวถูกแทนก่อน ("ฆ่าตัวตาย" ก่อน "ฆ่า") กันคำสั้นกินคำยาวจนได้ภาษาพัง */
export function sortLongestFirst(issues) {
  return [...(issues || [])].sort((a, b) => String(b?.text || '').length - String(a?.text || '').length);
}
