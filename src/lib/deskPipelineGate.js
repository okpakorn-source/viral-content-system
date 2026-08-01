// ============================================================
// 🛑 สวิตช์ปิดชั่วคราว "โต๊ะข่าวกลาง" (news desk) — 31 ก.ค. 2026
// ------------------------------------------------------------
// เจ้าของสั่ง 31 ก.ค. 69: "ปิดสวิตช์ระบบโต๊ะข่าวกลางให้ชั่วคราว ไม่ให้กิน token"
//
// หลักการ (แพทเทิร์นเดียวกับ megaPipelineGate.js):
//   • ปิดเฉพาะจุดที่ "เผาโทเคน/เงินจริง" ของโต๊ะข่าว:
//       ① cron คนเฝ้าประตูห้องรอ บก. (/api/desk/editor/dispatch — ปล่อยใบเข้าคิวเขียน + กู้งานตาย = LLM)
//       ② งานคิวโต๊ะข่าว desk_harvest / desk_search / desk_chief (ล่าข่าว/ค้นเอง/บก.ใหญ่ = Serper+LLM)
//       ③ ขุดนาทีทองจากคลิป (/api/news-desk/mine-clip = LLM)
//   • ของที่ "ไม่เผาเงิน" เปิดตามเดิม: เปิดดูฟีด/การ์ด · ย้ายสถานะการ์ด · เติมรูป og:image
//   • 🔴 ไม่แตะ: ท่อข่าวส่งเอง (/api/auto*) · คิวกลาง (/api/queue/**) · ถอดคลิป · ระบบอื่นทุกระบบ
//
// เปิดกลับมาใช้: ตั้ง env DESK_PIPELINE=1 (Vercel และ/หรือเครื่องทีม)
//   ไม่ตั้ง = ปิด (ค่าเริ่มต้นใหม่ตามคำสั่งเจ้าของ — ปิดได้ทันทีไม่ต้องตั้ง env ที่ไหน)
// ============================================================

/** โต๊ะข่าวกลางเปิดอยู่ไหม — ต้องตั้ง DESK_PIPELINE=1 ชัดเจนเท่านั้นถึงจะเปิด */
export function deskPipelineOn(env = process.env) {
  return String(env?.DESK_PIPELINE || '') === '1';
}

export function deskPipelineOff(env = process.env) {
  return !deskPipelineOn(env);
}

/** kind งานคิวของโต๊ะข่าว (คู่กับ DESK_KINDS ใน quick-test route) */
export const DESK_JOB_KINDS = ['desk_harvest', 'desk_search', 'desk_chief'];

export function isDeskJobKind(kind) {
  return DESK_JOB_KINDS.includes(String(kind || '').trim());
}

export const DESK_OFF_MESSAGE =
  'โต๊ะข่าวกลางปิดชั่วคราว (เจ้าของสั่งพักไม่ให้กินโทเคน) — เปิดคืนได้ด้วย DESK_PIPELINE=1';

export function deskOffPayload() {
  return {
    success: false,
    error: DESK_OFF_MESSAGE,
    errorType: 'DESK_PIPELINE_DISABLED',
    disabledSince: '2026-07-31',
  };
}
