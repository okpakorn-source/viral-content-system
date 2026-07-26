// ============================================================
// [ระบบทำปกออโต้] ตา (Vision) — โมเดล Gemini เฉพาะสายปก
// ------------------------------------------------------------
// ★ 26 ก.ค. 69 (เจ้าของอนุมัติ mapping): ยกระดับ gemini-2.5-flash → gemini-3.6-flash
//   "เฉพาะท่อปก" เท่านั้น (vetImages/triageLibrary ใน libraryTriage.js, คัดเฟรม YouTube
//   ใน youtubePipeline.js, ตาหาหน้า fallback ใน faceDetector.js)
// ⚠️ ตัวถอดคลิป/imageSearchVision.js/summarizeService(Text).js และสายอื่นๆ ที่ไม่ใช่
//   ท่อปก ยังใช้ค่าเริ่มต้นเดิมของ gemini.js (geminiModel()/DEFAULT_MODEL) ห้ามมาแก้ตรงนี้
// override ได้ด้วย env COVER_GEMINI_MODEL (ปุ่มถอยกลับ) — ไม่กระทบ GEMINI_MODEL กลาง
// ============================================================

export const COVER_GEMINI_MODEL = process.env.COVER_GEMINI_MODEL || 'gemini-3.6-flash';
