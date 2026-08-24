/**
 * promptModes — จุดอ่านสวิตช์ "โหมดถ้อยคำในใบสั่งเขียนข่าว" เพียงจุดเดียวของระบบ (20 ส.ค. 69 · งาน R3)
 * ─────────────────────────────────────────────────────────────
 * เกิดจากคำตัดสินของเจ้าของ 3 ข้อ (แก้กฎที่ขัดกันเอง):
 *
 *   1) STYLE_PACK_V2   — วลีลายเซ็นใน VIRAL STYLE PACK ข้อ 3
 *      ค่าตั้งต้น = เปิด (เจ้าของสั่งถอด "ขอนับถือใจ..." / "ดีใจแทน..." และเลิกบังคับให้มีทุกโพสต์)
 *      หลักฐาน: "ขอนับถือใจ" = 0/31 โพสต์แสนไลก์ · 0/221 โพสต์ไวรัล · แต่ระบบเจนใช้ 45%
 *      ถอย: STYLE_PACK_V2=0 → บรรทัดข้อ 3 กลับเป็นไบต์เดิม
 *
 *   2) ENDING_MODE     — ท่อนจบข่าว (สลับได้ 2 ทางตามที่เจ้าของสั่ง "ขอสำรองไว้สลับได้")
 *      'truth' (ค่าตั้งต้น) = จบด้วยประโยคสัจธรรม → ถอดวรรค "ห้ามข้อคิด/จบเรียบๆ" 4 จุดออก
 *      'plain'             = จบบรรยายเรียบๆ ไม่ตีความ → คืน 4 วรรคนั้นกลับมาทุกไบต์ + ปิดข้อ 5 ของ Style Pack
 *      ค่าอื่น/ค่าขยะ/ไม่ตั้ง = 'truth' (ค่าที่เจ้าของเลือก)
 *
 *   3) WITNESS_FACTLOCK — บทบาท "ผู้เห็นเหตุการณ์ (The Witness)" + PROSE CRAFT ข้อ "ภาพ"
 *      ค่าตั้งต้น = เปิด → เติมหางกำกับว่าใช้ได้เฉพาะรายละเอียดที่ต้นฉบับบรรยายไว้จริง และ FACT-LOCK ใหญ่กว่าเสมอ
 *      เหตุผลของเจ้าของ: "เพจจริงเขียนจากคลิปที่ดูเอง แต่ระบบเราได้แค่ข้อความ ไม่มีสิทธิ์เห็นฉาก"
 *      ถอย: WITNESS_FACTLOCK=0 → ข้อความกลับเป็นไบต์เดิม
 *
 * ⚠️ ห้ามอ่าน process.env ชุด ENDING_MODE / STYLE_PACK_V2 / WITNESS_FACTLOCK จากไฟล์อื่น
 *    ให้ import ฟังก์ชันจากไฟล์นี้เท่านั้น — กันซ้ำรอย HOOK_STYLE_MODE ที่เคยถูกอ่าน 3 แบบใน 3 ไฟล์
 *    แล้วส่งกฎขัดกันเองเข้าพรอมต์เดียวกัน (บทเรียนจดไว้ที่ viralFewshot.js:16-22)
 *
 * รับค่าแบบทน: ถอดอัญประกาศ + trim + ตัวพิมพ์เล็ก (แบบเดียวกับ src/lib/utils/objText.js)
 */

/** ล้างรูปแบบค่า env ให้เทียบง่าย: ถอดอัญประกาศหน้า/หลัง + trim + ตัวพิมพ์เล็ก */
function readToken(envName) {
  return String(process.env[envName] ?? '').trim().replace(/^["']+|["']+$/g, '').trim().toLowerCase();
}

/** สวิตช์แบบ "ค่าตั้งต้นเปิด" — ปิดได้ด้วย 0 / off / false / no เท่านั้น (ค่าอื่นถือว่าเปิด) */
function isDefaultOnSwitch(envName) {
  const raw = readToken(envName);
  if (raw === '') return true; // ไม่ตั้ง env = เปิด
  return !(raw === '0' || raw === 'off' || raw === 'false' || raw === 'no');
}

/** ข้อ 1 — วลีลายเซ็นชุดใหม่ใน VIRAL STYLE PACK ข้อ 3 (ค่าตั้งต้น = เปิด) */
export function isStylePackV2Enabled() {
  return isDefaultOnSwitch('STYLE_PACK_V2');
}

/**
 * ข้อ 2 — โหมดท่อนจบ
 * @returns {'truth'|'plain'} 'plain' เมื่อ ENDING_MODE=plain เท่านั้น · ค่าอื่นทั้งหมด (รวมค่าขยะ) = 'truth'
 */
export function getEndingMode() {
  return readToken('ENDING_MODE') === 'plain' ? 'plain' : 'truth';
}

/** ข้อ 2 — true เมื่ออยู่โหมด "จบบรรยายเรียบๆ ไม่ตีความ" (= สภาพก่อนแก้ทุกไบต์) */
export function isEndingPlain() {
  return getEndingMode() === 'plain';
}

/** ข้อ 3 — หางกำกับ "ใช้ได้เฉพาะรายละเอียดที่ต้นฉบับมีจริง" (ค่าตั้งต้น = เปิด) */
export function isWitnessFactLockEnabled() {
  return isDefaultOnSwitch('WITNESS_FACTLOCK');
}

/** สรุปสถานะสำหรับ log */
export function getPromptModesStatus() {
  return {
    stylePackV2: isStylePackV2Enabled(),
    endingMode: getEndingMode(),
    witnessFactLock: isWitnessFactLockEnabled(),
  };
}
