/**
 * =====================================================
 * ศูนย์กลางโมเดลโต๊ะข่าว (v1 newsDesk/ + v2 deskV2/) — 27 ก.ค. 69
 * =====================================================
 * เจ้าของสั่งยกเครื่อง: เดิมกระจายชื่อโมเดลเป็น hardcode string ('gpt-5.5','gpt-4o','gpt-4o-mini','gpt-5.4-mini')
 * และ import MODEL_PRIMARY/MODEL_FAST จาก '@/lib/ai/modelConfig' (ของระบบทำข่าวหลัก — ห้ามแตะไฟล์นั้น)
 * กระจัดกระจายหลายสิบจุด → รวมเป็น 2 ค่าเดียวที่นี่ สลับได้ด้วย env ไม่ต้องแก้โค้ด
 *
 * 🔴 ไฟล์นี้ใช้เฉพาะ "โต๊ะข่าว" (src/lib/services/newsDesk/**, src/lib/services/deskV2/**, src/app/api/news-desk/**)
 *    ไม่เกี่ยวกับ/ไม่แทนที่ modelConfig.js ของระบบทำข่าวหลัก (autoFlowService/summarizeService ฯลฯ) — ห้ามนำไปใช้ที่นั่น
 */
export const DESK_MODEL_BRAIN = process.env.DESK_MODEL_BRAIN || 'gpt-5.6-terra'; // งานคิดหนัก: บก./ตัดสิน/วิจัย DNA
export const DESK_MODEL_FAST = process.env.DESK_MODEL_FAST || 'gpt-5.6-luna';   // งานเร็ว: จัดหมวด/คำค้น/กลั่น
