/**
 * libraryStatus — ตัวกรองสถานะการ์ดสำหรับ "ท่อข่าว" (3 ก.ย. 69 · F7 แบบ FINAL card-library §2)
 * ─────────────────────────────────────────────────────────────
 * หลัง migrate คลังการ์ด v2 การ์ดมี field `status`: 'active' | 'archived' | 'proposed' (ไม่มี field = active)
 * ท่อข่าวต้องหยิบเฉพาะใบ active — กรองที่ "ทางเข้ารายการการ์ดที่ให้ระบบเลือก" เท่านั้น
 * (summarizeServiceText.js + summarizeService.js) ไม่กรองที่ persistStore / GET /api/prompt-library
 * เพราะ UI / สถิติ / track usageCount ต้องเห็นทุกใบ (ใบพักต้องกู้คืนได้ · เคสเก่าอ้าง promptId ได้เสมอ)
 *
 * สวิตช์: CARD_LIBRARY_V2 (ทะเบียน src/lib/config/newsSwitches.js — ใช้ตัวเดิม ไม่เพิ่มสวิตช์ใหม่)
 *   '0'          = ปิด → คืน true ทุกใบ = พฤติกรรมเดิมไบต์ต่อไบต์ (เทส tests/library-status-filter.test.mjs พิสูจน์)
 *   อื่นๆ/ไม่ตั้ง = เปิด → false เฉพาะ status 'archived'/'proposed' · ไม่มี status / active / ค่าที่ไม่รู้จัก = true (ตรงกับ UI statusOf)
 *   อ่าน env สดทุกครั้ง (ไม่ cache) — สลับได้ไม่ต้อง build · เทียบ === '0' แบบเดียวกับ isCardLibV2 ใน route.js
 *
 * ทน card=null/undefined/ไม่ใช่ object → false (ไม่โยน) เฉพาะตอนสวิตช์เปิด · ตอนปิดคืน true เสมอ
 */

/** ค่า status ที่ท่อข่าว "ไม่หยิบ" — ค่าอื่นทุกแบบ (ไม่มี field / null / '' / active / ค่าที่ไม่รู้จัก) = หยิบได้
 *  ตีความทางเดียวกับหน้า UI (page.js statusOf: ไม่ใช่ archived/proposed = ใช้งาน) — ผู้ตรวจไขว้ F7: UI กับท่อข่าวต้องไม่ตีค่าแปลกคนละทาง */
const EXCLUDED_STATUS = new Set(['archived', 'proposed']);

/**
 * การ์ดใบนี้ให้ท่อข่าวเลือกได้ไหม
 * @param {object|null|undefined} card การ์ดจากคลัง (prompt-library)
 * @returns {boolean}
 */
/** จุดอ่านสวิตช์จุดเดียวของไฟล์ — อ่านสดทุกครั้ง (ไม่ cache) · '0' = ปิด */
const libV2Off = () => process.env.CARD_LIBRARY_V2 === '0';

export function isCardSelectable(card) {
  if (libV2Off()) return true; // ปิดสวิตช์ = เห็นทุกใบเหมือนเดิม
  if (!card || typeof card !== 'object') return false;
  return !EXCLUDED_STATUS.has(card.status); // ไม่มี flag / active / ค่าแปลก = หยิบได้ · archived/proposed = ไม่หยิบ
}

/**
 * กรองรายการการ์ดทั้งชุด — ใช้ที่ทางเข้า mix (โค้ดเดิม sort() ทับอาเรย์ที่ getAll คืนตรงๆ)
 * ★ ผู้ตรวจไขว้ (byte-identical): ปิดสวิตช์ต้องคืน "reference เดิม" ไม่ใช่สำเนา —
 *   persistStore.getAll (สาย Supabase) คืนอาเรย์เดียวกับ _memCache แล้ว mix sort() ทับ = ลำดับ viralScore-desc ไหลลง memCache/ไฟล์ที่ sync
 *   ถ้าคืนสำเนาแม้ตอนปิด ลำดับที่ analyze/getTopPrompts/ToneFilter-fallback เห็นตอน Supabase ล่มจะต่างจากเดิม → หยิบคนละใบ
 * @param {Array<object>} list รายการการ์ดจาก store
 * @returns {Array<object>} ปิด = list ตัวเดิม (===) · เปิด = อาเรย์ใหม่เฉพาะใบที่ isCardSelectable · ไม่ใช่อาเรย์ = คืนค่าเดิม
 */
export function selectableCards(list) {
  if (libV2Off()) return list;
  return Array.isArray(list) ? list.filter(isCardSelectable) : list;
}
