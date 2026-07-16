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

// ---------- (6) ★ Wave2 Batch D2 (10 ก.ค.): "กติกาวัดได้" จากคลังเทคนิคปก 23 ข้อ → ด่าน QC ----------
// ที่มา: data/cover-technique-library.json → synthesis.principles (P-*) + synthesis.panelNorms
//   (สังเคราะห์จากปกแสนไลค์ 19 ใบ) แปลงเป็นตัวเลขวัดได้ → measureTechRules() ใน megaComposerService.js
// ทุกเกณฑ์เป็น "band หลวม" ตั้งใจ (กัน false positive) — วัดไม่ได้ = ข้ามเงียบ ห้ามเดา (fail-open)
// ⚠️ band hero ใช้ขอบ "พบจริง 30-58" ไม่ใช่ norm แนะนำ 44-58 — คลังบอกค่ากลาง ~48-52 แต่ของจริง
//    กระจายกว้างถึง 30-58 → ใช้ขอบพบจริงกัน false positive (44-58 จะจับปกที่ยอมรับได้เป็นของเสีย)
export const TECH_RULES = {
  // P-CROP-01 + panelNorms.hero: faceSharePct ของ hero — พบจริง 30-58 (norm แนะนำ 44-58 ตั้งใจไม่ใช้)
  HERO_FACE_SHARE: [30, 58],
  // P-CROP-01 + panelNorms.hero: headroom hero — norm 0-8%, ใช้ขอบหลวม -2..15
  //   (ค่าหัวเป็น "ประมาณ": headTop = y1 - 0.30×faceH — กล่องหน้าไม่รวมผม จึงเผื่อ 30% ของสูงหน้า)
  HERO_HEADROOM: [-2, 15],
  // panelNorms.circle: faceShare หน้าคู่/identity ในวง 24-48 (เฉพาะเมื่อวงมีหน้า; ฉาก/ของ 0-12 = ไม่วัด)
  CIRCLE_FACE_SHARE: [24, 48],
  // P-CONTEXT-01 + panelNorms.context: wide/medium-wide faceShare 5-16
  CONTEXT_FACE_SHARE: [5, 16],
  // panelNorms.evidence: faceShare 0-22 (เพดาน 33 เมื่อเป็นโมเมนต์คน) → flag เฉพาะ >33 เท่านั้น
  EVIDENCE_FACE_SHARE_MAX: 33,
  // panelNorms.secondary: หน้ารอง/reaction/คู่ข่าว faceShare 38-68 ของช่องตัวเอง
  SECONDARY_FACE_SHARE: [38, 68],
  // P-ZOOM-01: บันไดขนาดหน้า — คู่ช่องติดกัน (เรียง faceShare) ต้องห่าง ≥8pt
  //   ⚠️ advisory ตลอด: คู่ข่าว pair (P-ZOOM-02 ถูกต้องเมื่อต่าง ≤10pt) จะติดธงนี้ด้วย — ไม่มี role แยกให้กันได้
  LADDER_MIN_GAP: 8,
  // P-CIRCLE-01: วงห้ามทับ/ใกล้หน้า — ระยะขอบวงถึงกล่องหน้า < 3% ของกว้าง canvas = ทับ
  CIRCLE_FACE_GAP_PCT: 3,
  // P-LAYOUT-01: จำนวนช่องรวมทั้งใบ ≤6 (ผัง default = hero + คอลัมน์ขวา 2-3 + วง)
  PANEL_MAX: 6,
  // P-CIRCLE-01: ขอบขาววง norm 4-10px — ฐานกว้างตอนศึกษา ref ไม่รู้ → ใช้ขอบหลวม จับเฉพาะผิดชัด (0/ไม่มี หรือ >16)
  CIRCLE_BORDER_MAX: 16,
  // ★ แบตช์ F (F1): หน้ากินช่อง ≥100% = หน้าสูงกว่าช่องทั้งช่อง (เป็นไปไม่ได้ที่จะครอปถูก — สาขาครอปไม่เล็งหน้า)
  //   ต่างจาก band face_share_out (แค่ "นอกช่วงพอดี") — 100 คือ "โอเวอร์โฟลว์" ที่ผิดแน่นอน ไม่มี false positive
  FACE_OVERFLOW_MIN: 100,
};
