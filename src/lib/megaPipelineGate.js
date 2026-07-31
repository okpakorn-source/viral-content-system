// ============================================================
// 🛑 ประตูปิดท่อ MEGA (ระบบทำปกอัตโนมัติ) — 31 ก.ค. 2026
// ------------------------------------------------------------
// เจ้าของสั่ง 31 ก.ค. 69: "ท่อ mega ระบบทำปกที่พัฒนาให้ปิดการใช้งานไว้ได้เลย เอาออกจาก ui แอพด้วย"
//   (เลิกพัฒนาต่อแล้ว — ไม่ต้องการให้มีอะไรกินค่า API/โทเคนโดยไม่ได้ใช้งาน)
//
// หลักการ:
//   • ปิดเฉพาะ "การสั่งงานใหม่" (POST ที่สร้างงานปก = จุดที่เสียเงินจริง)
//   • ไม่แตะเส้นอ่าน (GET คลังปก/ผลเก่า) — ข้อมูลเดิมยังเปิดดูได้ ไม่มีค่าใช้จ่าย
//   • 🔴 ไม่แตะระบบอื่นเด็ดขาด: ท่อข่าว /api/auto · โต๊ะข่าว desk_* · ถอดคลิป · /image-search
//     (คิว quick-test ใช้ร่วมกับ desk_* — ประตูนี้กรองเฉพาะ kind ของงานปกเท่านั้น)
//
// เปิดกลับมาใช้: ตั้ง env MEGA_PIPELINE=1 (เครื่องทีม .env.local และ/หรือ Vercel)
//   ไม่ตั้ง = ปิด (ค่าเริ่มต้นใหม่ตามคำสั่งเจ้าของ — ปิดโดยไม่ต้องพึ่ง env ที่ไหนเลย)
// ============================================================

/** ท่อปกเปิดอยู่ไหม — ต้องตั้ง MEGA_PIPELINE=1 ชัดเจนเท่านั้นถึงจะเปิด */
export function megaPipelineOn(env = process.env) {
  return String(env?.MEGA_PIPELINE || '') === '1';
}

/** ปิดอยู่ไหม (ตัวช่วยอ่านง่ายฝั่ง route) */
export function megaPipelineOff(env = process.env) {
  return !megaPipelineOn(env);
}

/** kind ของงานในคิว quick-test ที่ถือเป็น "งานปก" — desk_* (โต๊ะข่าว) ไม่อยู่ในนี้ ต้องผ่านได้ปกติ */
export const MEGA_COVER_JOB_KINDS = ['compose', 'ref'];

export function isCoverJobKind(kind) {
  return MEGA_COVER_JOB_KINDS.includes(String(kind || '').trim());
}

/** ข้อความ + payload มาตรฐานเวลาปฏิเสธงานปก (ใช้ทุก route ให้เหมือนกัน) */
export const MEGA_OFF_MESSAGE =
  'ระบบทำปกอัตโนมัติ (MEGA) ปิดใช้งานอยู่ — เปิดคืนได้ด้วย MEGA_PIPELINE=1';

export function megaOffPayload() {
  return {
    success: false,
    error: MEGA_OFF_MESSAGE,
    errorType: 'MEGA_PIPELINE_DISABLED',
    disabledSince: '2026-07-31',
  };
}
