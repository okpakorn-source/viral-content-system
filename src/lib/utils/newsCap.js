/**
 * 📖 สมุดเพดานเนื้อข่าวกลาง — ที่เดียวของทั้งท่อ (สาย TEXT)
 * ────────────────────────────────────────────────────────────
 * ★ 16 ส.ค. 69 (เจ้าของสั่ง "ปลดล็อกเพดานอักษรให้แน่ใจว่าเนื้อเต็มจะเห็นเต็มทุกขั้นตอน")
 *
 * ปัญหาเดิม: เพดานตัดเนื้อข่าวกระจายอยู่ 6+ จุดใน 2 ไฟล์ ตัวเลขคนละค่า
 *   ไม่มีสวิตช์ ไม่มีคำเตือน ตัดเงียบสนิท — ใครมาใหม่ก็ฝังเลขใหม่ได้อีกไม่รู้จบ
 *
 * หลักฐานที่ทำให้ปลด (วัดจากคลังจริง 3,994 ข่าว พ.ค.–ส.ค. 69):
 *   ข่าวตัวกลาง 760 ตัวอักษร · p90 = 1,423 · p99 = 3,633 · ยาวสุด 7,963
 *   เพดานเดิมตัดข่าวทิ้ง:  400 → 91.5% · 900 → 35.5% · 1,500 → 8.9% · 2,000 → 4.0% · 3,000 → 1.6%
 *
 * กฎของไฟล์นี้:
 *   1. ทุกจุดที่ย่อ/ตัด "เนื้อข่าว" ต้องเรียกผ่าน newsForStage() เท่านั้น ห้าม .slice() เอง
 *   2. ค่าเริ่มต้นทุกด่าน = 0 (ไม่จำกัด) — ข่าวเต็มไปถึงทุกขั้น
 *   3. ตัดเมื่อไหร่ต้องขึ้นล็อกเสมอ ห้ามตัดเงียบ
 *   4. ตัวอ่าน env ตัวเดียวทั้งระบบ (บทเรียน 16 ส.ค.: HOOK_STYLE_MODE ถูกเช็ค 3 แบบ
 *      จนพิมพ์ตัวใหญ่แล้วปิดได้แค่ 1 ใน 3 ไฟล์) — ทน "2000" / 2000 / เว้นวรรค / ตัวพิมพ์ใหญ่
 *
 * ⚠️ สายแฝด URL (summarizeService.js) ยังไม่ได้เข้าสมุดนี้ — ปิดอยู่ด้วย TEXT_ONLY_MODE
 *    ถ้าวันหลังเปิดสาย URL คืน ต้องพามาเข้าสมุดนี้ก่อน
 */

/** ตารางเพดาน: ชื่อด่าน → { env, เดิม, ทำอะไร } · ค่าเริ่มต้นทั้งหมด = ไม่จำกัด */
export const NEWS_CAPS = {
  DNA:       { env: 'NEWS_CAP_DNA',       was: 1500, desc: 'ตั้งป้ายหมวด/อารมณ์ — ป้ายนี้ถูกใช้ต่อทั้งการให้คะแนนการ์ดและการเลือกครูไวรัล' },
  CATALOG:   { env: 'NEWS_CAP_CATALOG',   was: 2000, desc: 'คัดสารบัญการ์ด 201 ใบ เหลือ 14 ใบเข้ารอบ' },
  CARD_PICK: { env: 'CARD_PICK_NEWS_CHARS', was: 400,  desc: 'สมองเลือกการ์ดใบสุดท้าย' },
  BLUEPRINT: { env: 'NEWS_CAP_BLUEPRINT', was: 2500, desc: 'วางโครงอารมณ์' },
  RESEARCH:  { env: 'NEWS_CAP_RESEARCH',  was: 2000, desc: 'สกัดคีย์เวิร์ดไปค้นข้อมูลเสริม' },
  FORMAL:    { env: 'NEWS_CAP_FORMAL',    was: 1500, desc: 'ตรวจว่าเป็นข่าวราชพิธี/ทางการหรือไม่' },
  VIRAL_MATCH:{ env: 'NEWS_CAP_VIRAL_MATCH', was: 900,  desc: 'ตัวจับคู่ครูไวรัล (ทำงานเมื่อ VIRAL_MATCH_MODE=ai)' },
  WRITER:    { env: 'WRITER_SOURCE_CHARS', was: 3000, desc: 'เนื้อต้นฉบับที่นักเขียนได้อ่าน', fallback: 0 },
};

/**
 * คืนเนื้อข่าวสำหรับด่านที่ระบุ — ค่าเริ่มต้นไม่จำกัด
 * @param {keyof NEWS_CAPS} stage ชื่อด่าน
 * @param {string} body เนื้อข่าว
 * @param {{squash?: boolean}} [opts] squash=true → ยุบช่องว่างซ้ำให้เหลือช่องเดียว
 */
export function newsForStage(stage, body, opts = {}) {
  const cfg = NEWS_CAPS[stage];
  let clean = String(body || '');
  if (opts.squash) clean = clean.replace(/\s+/g, ' ');
  if (!cfg) return clean;

  const raw = String(process.env[cfg.env] ?? '').trim().replace(/^["']|["']$/g, '');
  const n = Number(raw);
  // ตั้งค่าไว้ = ใช้ค่านั้น · ไม่ตั้ง = 0 (ไม่จำกัด) ทุกด่าน รวมถึง WRITER
  const cap = (raw !== '' && Number.isFinite(n)) ? n : (cfg.fallback || 0);

  if (cap > 0 && clean.length > cap) {
    console.log(`[เพดานข่าว] ✂️ ${stage}: ${clean.length} → ${cap} ตัวอักษร (${cfg.env}) — ${cfg.desc}`);
    return clean.slice(0, cap);
  }
  return clean;
}
