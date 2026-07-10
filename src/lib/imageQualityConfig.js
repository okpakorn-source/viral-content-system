// ============================================================
// 📏 Image Quality Config — single source of truth
// ------------------------------------------------------------
// Wave 2 Batch B1 (_PLAN_MEGA_V2.md ข้อ 62.3): เกณฑ์ตัวเลขเรื่องคุณภาพภาพ/hero
// วันนี้กระจายอยู่คนละไฟล์ (libraryTriage.js / megaAdapters.js / coverQcGate.js)
// รวมมาไว้ที่เดียวกัน "ตัวเลขห้ามเปลี่ยนจากของเดิมแม้แต่ตัวเดียว" — แต่ละค่าผูกกับ
// regression case จริงที่เคยพังมาก่อน แก้เลขที่นี่ = กระทบทุกจุดที่ import พร้อมกัน
// ไฟล์นี้ export ค่าอย่างเดียว ไม่มี logic — ห้ามใส่ side-effect
// ============================================================

// ---------- (1) Quality-cap: ภาพย่อ/เล็กจริง กันคะแนนหลอก ----------
// ที่มา: src/lib/libraryTriage.js buildTriage() (เดิมฮาร์ดโค้ด ~บรรทัด 151-155)
// เคสจริง AC-0058: ตาให้ quality 9 บนไฟล์ 298×372 (วัดจากรูปย่อ) — ถ้าปล่อยผ่านจะดัน
// s6 เลือกไฟล์จิ๋วเป็น hero แล้วยืดแตกตอนประกอบปก
// short side ต่ำกว่านี้ (หรือวัดจากไฟล์ย่อ) → เพดาน quality ที่ QUALITY_CAP_VALUE
export const QUALITY_CAP_SHORT_SIDE = 500;
export const QUALITY_CAP_VALUE = 6;

// ---------- (2) Hero candidate: ขนาดไฟล์จริงต้องพอ (ไม่ใช่ thumbnail หลอกตา) ----------
// ที่มา: src/lib/megaAdapters.js heroGradeOf() (s5_gapsearch ~บรรทัด 837-843) +
//        heroSizeOk()/realShortSideOf() (s6_slots ~บรรทัด 1040-1052) — เดิมฮาร์ดโค้ด 700 สองจุด
// ผูกกับแผนคุณภาพคลังรูป เฟส 2.2 (9 ก.ค.): กันไฟล์จิ๋วที่ตาคัดให้คะแนนสูงหลอก (จากรูปย่อ)
// หลุดขึ้น hero แล้วยืดแตกตอนประกอบ — floor ปัจจุบัน 700px (short side)
export const HERO_MIN_SHORT_SIDE = 700;

// เป้าพึงประสงค์ระยะยาว (_PLAN_MEGA_V2.md บรรทัด 39: "hero short side ≥900px … เริ่มที่ floor 700
// (มีแล้ว) → 900 เป็นเป้า") — ★ยังไม่บังคับ ณ Batch B1 นี้ ใส่ไว้เป็นมาตรฐานให้ Wave ถัดไปอ้างอิง
// ห้ามเอาไปแทนที่ HERO_MIN_SHORT_SIDE ตรงๆ (จะทำให้งานจบ insufficient_assets ถี่ขึ้นทันทีตามที่แผนเตือนไว้)
export const HERO_SHORT_SIDE_TARGET = 900;

// ---------- (3) Hero-grade ต่อคนหลัก: จำนวนภาพขั้นต่ำที่ "ใช้ขึ้นปกได้จริง" ----------
// ที่มา: src/lib/megaAdapters.js s5_gapsearch() (เดิม GAP_SEARCH_MIN_HERO_PER_PERSON ~บรรทัด 352)
// ผูกกับสเปก Codex V2 ตรงเป๊ะ (ดู _PLAN_MEGA_V2.md บรรทัด 31: "เลขตรงสเปก V2 แต่เป็น soft")
// Batch B1 ยกเป็น hard gate — เลขคงเดิม แค่เปลี่ยนพฤติกรรมตอนไม่ผ่าน (ดู megaAdapters.js MEGA_HERO_GRADE_HARD)
export const GAP_SEARCH_MIN_HERO_PER_PERSON = 2;

// ---------- (4) ความคมชัดจริง (Laplacian variance) ----------
// ที่มา: src/lib/libraryTriage.js computeSharpness() — วัดเก็บ triage.sharpness ทุกใบมาตั้งแต่
// เฟส 2.1 (9 ก.ค.) แต่ไม่เคยมีใครอ่านค่า จนกระทั่ง Batch B1 นี้ต่อสายเข้า heroGradeOf()
// ★ calibrate จากข้อมูลจริง 10 ก.ค. (สคริปต์อ่านอย่างเดียว scratchpad calib_sharpness.mjs) —
//   ประชากรอ้างอิง: ภาพในคลัง acs-images ที่ clean+relevant+faceCount==1 (ตรงเงื่อนไข heroGradeOf
//   ทุกข้อยกเว้นความคม) → n=138 ตัวอย่าง, p10=25.378 → ปัดลงอนุรักษ์นิยม = 25
//   (ดูรายงานเต็ม/distribution ในข้อความส่งงาน — ไม่ผูกเป็นคอมเมนต์ยาวในไฟล์โค้ด)
// ภาพที่ไม่มีค่า sharpness (วัดไม่ได้ตอน triage) = ไม่ตัด ให้ผ่านเกณฑ์นี้เสมอ (ดู heroGradeOf)
export const SHARPNESS_MIN_HERO = 25;

// ---------- (5) เพดานยืดตอนประกอบปก (คัดลอกมาจาก coverQcGate.js — ยังไม่แก้ไฟล์นั้นในชุดนี้) ----------
// ที่มา: src/lib/coverQcGate.js DEFAULT_THRESHOLDS (บรรทัด ~28) — Wave 2 ข้อ 1 (Hard QC gate)
// "hero/main เกิน 1.2x = ไม่ผ่าน · ช่องอื่นเกิน 1.6x = ไม่ผ่าน"
// เก็บไว้ที่นี่เผื่อ Batch B2 (ต่อ coverQcGate.js เข้า config เดียวกัน) — ค่าต้องตรงกับ
// coverQcGate.js เป๊ะเสมอ ถ้าจะแก้ต้องแก้พร้อมกันสองที่จนกว่า B2 จะรวมจริง
export const HERO_STRETCH_MAX = 1.2;
export const OTHER_STRETCH_MAX = 1.6;
