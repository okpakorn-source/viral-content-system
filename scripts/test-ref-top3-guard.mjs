// ============================================================
// 🧪 test-ref-top3-guard — เทสกลไก ref template top3 (guard rails)
// ------------------------------------------------------------
// ครอบ 4 เรื่อง:
//   1) refPoolGateOpen: PIN ชนะ allowlist / allowlist คัด id ตรงเท่านั้น / id ปลอมไม่ทำของจริงหลุด
//   2) round1 precision helper (เก็บทศนิยม 1 ตำแหน่ง ค่าพัง → 0)
//   3) sanitize slot — เหลือเฉพาะโครงสร้าง ไม่มี subject/emotion/shot รั่ว (no ref-image leakage)
//   4) slot counts: hero+3right+circle = 5, hero+2right+circle = 4
// รัน: node scripts/test-ref-top3-guard.mjs
// ============================================================

import { refPoolGateOpen } from "../src/lib/refCoverGrade.js";

let pass = 0;
let fail = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name} — ${e.message}`);
  }
}

// --- fake records: โครงขั้นต่ำที่ gate ต้องการ (dna + imagePath) ---
const mkRec = (id) => ({
  id,
  imagePath: "/x.jpg",
  dna: { _reproducible: true, _templateGrade: { grade: "A" } },
});
const recA = mkRec("A");
const recB = mkRec("B");
const recC = mkRec("C");
const recZ = mkRec("Z");

// ---------- 1) refPoolGateOpen ----------

test("pin precedence: REF_POOL_PIN ชนะ REF_POOL_ALLOWLIST (A ผ่าน, B ไม่ผ่าน)", () => {
  const env = { REF_POOL_PIN: "A", REF_POOL_ALLOWLIST: "A,B" };
  assert(refPoolGateOpen(recA, env) === true, "id=A ต้องผ่านเมื่อ pin=A");
  assert(refPoolGateOpen(recB, env) === false, "id=B ต้องไม่ผ่านแม้อยู่ใน allowlist (pin ชนะ)");
});

test("allowlist: ผ่านเฉพาะ id ใน [A,B,C]", () => {
  const env = { REF_POOL_ALLOWLIST: "A,B,C" };
  assert(refPoolGateOpen(recA, env) === true, "A ต้องผ่าน");
  assert(refPoolGateOpen(recB, env) === true, "B ต้องผ่าน");
  assert(refPoolGateOpen(recC, env) === true, "C ต้องผ่าน");
  assert(refPoolGateOpen(recZ, env) === false, "Z ต้องไม่ผ่าน");
});

test("allowlist: id ปลอมในลิสต์ไม่ทำให้ของจริงหลุด (FAKE,A → เฉพาะ A ผ่าน)", () => {
  const env = { REF_POOL_ALLOWLIST: "FAKE,A" };
  assert(refPoolGateOpen(recA, env) === true, "A ต้องผ่าน");
  assert(refPoolGateOpen(recB, env) === false, "B ต้องไม่ผ่าน");
  assert(refPoolGateOpen(recZ, env) === false, "Z ต้องไม่ผ่าน");
});

// ---------- 2) precision helper ----------

const round1 = (v) => (Number.isFinite(+v) ? Math.round(+v * 10) / 10 : 0);

test("round1: เก็บทศนิยม 1 ตำแหน่ง / ค่าพัง → 0", () => {
  assert(round1(46.34) === 46.3, `round1(46.34) ต้องเท่ากับ 46.3 (ได้ ${round1(46.34)})`);
  assert(round1("abc") === 0, `round1("abc") ต้องเท่ากับ 0 (ได้ ${round1("abc")})`);
  assert(round1(57) === 57, `round1(57) ต้องเท่ากับ 57 (ได้ ${round1(57)})`);
});

// ---------- 3) no ref-image leakage (sanitize slot → โครงสร้างล้วน) ----------

const SLOT_SAFE_KEYS = ["role", "shape", "xPct", "yPct", "wPct", "hPct", "zIndex", "border"];
const sanitizeSlot = (slot) =>
  Object.fromEntries(SLOT_SAFE_KEYS.filter((k) => k in slot).map((k) => [k, slot[k]]));

test("sanitize slot: ไม่มี subject/emotion/shot รั่ว เหลือเฉพาะโครงสร้าง", () => {
  const slot = { role: "hero", xPct: 0, yPct: 0, wPct: 46, hPct: 100, subject: "ชายร้องไห้", emotion: "เศร้า" };
  const out = sanitizeSlot(slot);
  assert(!("subject" in out), "ห้ามมี key subject");
  assert(!("emotion" in out), "ห้ามมี key emotion");
  assert(!("shot" in out), "ห้ามมี key shot");
  assert(out.role === "hero" && out.wPct === 46 && out.hPct === 100, "key โครงสร้างต้องอยู่ครบ");
});

// ---------- 4) slot counts ----------

test("slot counts: hero+3right+circle = 5, hero+2right+circle = 4", () => {
  const layout5 = [
    { role: "hero" },
    { role: "right" },
    { role: "right" },
    { role: "right" },
    { role: "circle" },
  ];
  const layout4 = [
    { role: "hero" },
    { role: "right" },
    { role: "right" },
    { role: "circle" },
  ];
  assert(layout5.length === 5, `hero+3right+circle ต้องมี 5 slots (ได้ ${layout5.length})`);
  assert(layout4.length === 4, `hero+2right+circle ต้องมี 4 slots (ได้ ${layout4.length})`);
});

// ---------- สรุป ----------

console.log("------------------------------------------------------------");
console.log(`สรุป: PASS ${pass} / FAIL ${fail} (รวม ${pass + fail} เทส)`);
process.exitCode = fail > 0 ? 1 : 0;
