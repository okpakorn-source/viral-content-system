// ============================================================
// 🧯 instrumentation.js — ตาข่ายกันเซิร์ฟเวอร์ตายระดับโปรเซส (28 ก.ค. 69 วิกฤต :3900)
// ------------------------------------------------------------
// บริบท: :3900 (งานหนัก/เทส — ดู memory port-3900-for-heavy-work) ตายซ้ำ 2 รอบคืนเดียวกัน ห่างกัน ~40 นาที
//   ล็อกชี้ตรงกัน: opus-4-8 ยิง 2 ครั้งติด (analyze attempt+retry) แล้ว process ดับเงียบไม่มี trace — ต้องสงสัย
//   ว่ามี promise ที่ reject แต่ไม่มี handler เกาะ (unhandledRejection) ทำให้ Node exit ตาม default behavior
// แก้คู่กับ: src/lib/s5PinnedAi.js (เพดาน timeout ยกเป็น env ปรับได้ + orphan-classification gap ใน
//   src/lib/aiClient.js — ดู comment ที่ _readBodyOrAbort) — ไฟล์นี้คือ "ตาข่ายชั้นสุดท้าย" ระดับเซิร์ฟเวอร์:
//   ไม่ว่าจะมี promise หลุดมือจากจุดไหนในระบบ (ที่นี่หรือจุดอื่นที่ยังไม่เจอ) เซิร์ฟเวอร์งานหนักต้อง "รอด" เสมอ
//   — log ดังๆให้เห็นชัด แต่ห้าม exit (ผิดกับ Node default ที่ crash โปรเซสทันทีเมื่อไม่มีใครฟัง event เหล่านี้)
// ⚠️ trade-off ที่ตั้งใจ: มาตรฐานทั่วไปของ Node แนะนำให้ exit หลัง uncaughtException (state อาจเพี้ยน) —
//   ที่นี่เลือกไม่ exit ตามคำสั่งเจ้าของ ("เซิร์ฟเวอร์งานหนักห้ามตายเพราะ promise หลุดตัวเดียว") เพราะงานเดี่ยว
//   ที่พังไม่ควรทำให้งานอื่นที่กำลังรันขนานอยู่ตายไปด้วย — ยอมรับความเสี่ยง state เพี้ยนเพื่อแลกความพร้อมใช้งาน
// ⚠️ โค้ด Node-only จริง (process.on) ย้ายไป instrumentation-node.js แยกไฟล์ (ตามสูตร Next.js docs) — เรียก
//   ผ่าน dynamic import() เฉพาะยืนยันแล้วว่า NEXT_RUNTIME==='nodejs' เท่านั้น กัน Turbopack เตือน "Node.js API
//   ... not supported in the Edge Runtime" (ตัว register() นี้เองถูกโหลดคู่กับทุก route ไม่ว่า route จะรันบน
//   runtime ไหน — static analysis เห็น process.on ตรงๆ ในไฟล์นี้แล้วเตือนทันทีแม้ runtime-guard คุมไว้ที่ runtime)
// ============================================================

export async function register() {
  // instrumentation.js ถูกโหลดทั้งสอง runtime (nodejs/edge) — process.on ไม่มีใน edge runtime เลย ต้องกรองก่อน
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { installCrashGuard } = await import('./instrumentation-node.js');
  installCrashGuard();
}
