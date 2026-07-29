// ============================================================
// 🧪 hero-fallback-minface-d3.test.mjs — เฟส D ข้อ 3 (29 ก.ค. 69, บทเรียน AC-0218)
// ------------------------------------------------------------
// เมื่อ hero verification fail (pixel-verify หลังประกอบจริง — ดู composeCore ใน megaComposerService.js) แล้วต้อง
// เลือก fallback จากผู้สมัครที่เหลือ: เดิม heroScore ผสม "หน้าเดี่ยว+25/อื่น-20" เป็นคะแนนเดียวรวมกับเทอมอื่น
// (ใหญ่/สะอาด/ไม่ชิดขอบ) — ภาพหมู่ 2 หน้ากับภาพหมู่ 12 หน้าโดนหักเท่ากันเป๊ะ (-20) ถ้าภาพหมู่หน้าใหญ่/สะอาดกว่า
// อาจชนะภาพ 2 หน้าที่ด้อยกว่านิดหน่อยได้ — บทเรียน AC-0218 (hero ตกไปเป็นภาพงานเลี้ยง 5 หน้า)
// แก้: เรียง candidate ด้วย faceCount น้อยก่อนเสมอ (1 หน้า > 2 หน้า > หมู่) เป็นชั้นหลัก แล้วค่อยใช้ heroScore
// ตัดสินภายในชั้นเดียวกัน (ไม่ใช่ผสมเป็นคะแนนเดียว) — เกณฑ์ขั้นต่ำเดิม (sc>0) ยังคงอยู่
// kill-switch: MEGA_HERO_FALLBACK_MINFACE (default ON, '0' = ลำดับเดิมเป๊ะ ใช้ heroScore ล้วน)
// ------------------------------------------------------------
// harness: source-assertion + pure truth-table จำลองตรรกะ sort (แพทเทิร์นเดียวกับ dream-score-boost-a6.test.mjs
// — heroScore/heroBanned เป็น closure ส่วนตัวลึกใน composeCore ทดสอบตรงไม่คุ้มค่า/เสี่ยงเทสเปราะ)
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/lib/services/megaComposerService.js', import.meta.url), 'utf8');

// ═══════════════════════════ (1) source-assertion ═══════════════════════════

test('source: kill-switch MEGA_HERO_FALLBACK_MINFACE คุมการเรียงลำดับใหม่ (default ON, \'0\'=ลำดับเดิม)', () => {
  assert.ok(/if \(process\.env\.MEGA_HERO_FALLBACK_MINFACE !== '0'\) \{/.test(src));
});

test('source: เกณฑ์ขั้นต่ำเดิม (sc<=0 return) ยังอยู่ในกิ่งเรียงใหม่ — ไม่ลดความเข้มของด่านเดิม', () => {
  assert.ok(/if \(sc <= 0\) return; \/\/ เกณฑ์ขั้นต่ำเดิม/.test(src));
});

test('source: comparator เรียง faces ascending ก่อน (a.faces - b.faces) แล้วค่อย heroScore descending (b.sc - a.sc) เป็นตัวตัดสินรอง', () => {
  assert.ok(/cands\.sort\(\(a, b\) => a\.faces - b\.faces \|\| b\.sc - a\.sc\);/.test(src));
});

test('source: กิ่งปิดสวิตช์ (else) ใช้ heroScore ล้วนแบบเดิม (if (sc > nBest)) — byte-parity จริงเมื่อปิด', () => {
  const elseBranch = src.match(/\} else \{\s*\n\s*loaded\.forEach\(\(im, i\) => \{[\s\S]*?\n\s*\}\);\s*\n\s*\}/);
  assert.ok(elseBranch, 'ต้องหากิ่ง else เจอ');
  assert.ok(/if \(sc > nBest\) \{ nBest = sc; ni = i; \}/.test(elseBranch[0]), 'กิ่งปิดสวิตช์ต้องใช้ตรรกะเดิมเป๊ะ');
});

test('source: faceCount อ่านจาก faceBoxes[i]?.count เดียวกับที่ heroScore ใช้ (fb.count) — ไม่ใช่แหล่งข้อมูลคนละที่', () => {
  assert.ok(/const faces = Math\.max\(1, Number\(faceBoxes\[i\]\?\.count\) \|\| 1\);/.test(src));
  assert.ok(/s \+= \(fb\.count \|\| 1\) === 1 \? 25 : -20;/.test(src), 'heroScore เดิมต้องยังใช้ fb.count เดียวกัน (ไม่ได้แก้)');
});

// ═══════════════════════════ (2) pure truth-table — จำลองเคส AC-0218 ═══════════════════════════

// จำลอง comparator จริง (คัดลอกตรงจากซอร์ส) — รับ candidates ดิบ [{i, sc, faces}] คืนตัวชนะ
function pickFallback(rawCands, minFaceOn = true) {
  const cands = rawCands.filter((c) => c.sc > 0);
  if (!cands.length) return null;
  if (minFaceOn) {
    cands.sort((a, b) => a.faces - b.faces || b.sc - a.sc);
    return cands[0];
  }
  // กิ่งปิดสวิตช์: heroScore ล้วน (if (sc > nBest))
  let best = null;
  for (const c of cands) { if (!best || c.sc > best.sc) best = c; }
  return best;
}

test('[บทเรียน AC-0218] ภาพหมู่ 12 หน้า heroScore สูงกว่า (สะอาด/ใหญ่/ไม่ชิดขอบ) แต่ยังต้องแพ้ภาพ 1 หน้า heroScore ต่ำกว่า เมื่อเปิดสวิตช์', () => {
  const cands = [
    { i: 0, faces: 12, sc: 60 }, // ภาพงานเลี้ยง 12 หน้า — สะอาด/ใหญ่/heroScore สูงกว่าเพราะเทอมอื่นดี
    { i: 1, faces: 1, sc: 30 },  // หน้าเดี่ยว heroScore ต่ำกว่า (เล็กกว่า/ชิดขอบนิดหน่อย) แต่หน้าเดี่ยว
  ];
  const winner = pickFallback(cands, true);
  assert.equal(winner.i, 1, 'หน้าเดี่ยวต้องชนะภาพหมู่เสมอเมื่อเปิดสวิตช์ ไม่ว่า heroScore ภาพหมู่จะสูงกว่าแค่ไหน');
});

test('[บทเรียน AC-0218] ปิดสวิตช์ (MEGA_HERO_FALLBACK_MINFACE=0) → กลับไปใช้ heroScore ล้วน (ภาพหมู่คะแนนสูงกว่าชนะ — พฤติกรรมเดิมก่อนแก้)', () => {
  const cands = [
    { i: 0, faces: 12, sc: 60 },
    { i: 1, faces: 1, sc: 30 },
  ];
  const winner = pickFallback(cands, false);
  assert.equal(winner.i, 0, 'ปิดสวิตช์ = พฤติกรรมเดิม heroScore สูงสุดชนะไม่ว่า faceCount เท่าไหร่ (นี่คือบั๊กที่ AC-0218 ต้องการแก้ — พิสูจน์ parity เดิม)');
});

test('เท่ากันในชั้น faceCount เดียวกัน (ทั้งคู่ 2 หน้า) → heroScore สูงกว่าชนะ (ตัดสินรองทำงานถูก)', () => {
  const cands = [
    { i: 0, faces: 2, sc: 40 },
    { i: 1, faces: 2, sc: 55 },
  ];
  const winner = pickFallback(cands, true);
  assert.equal(winner.i, 1, 'faceCount เท่ากัน (2=2) → heroScore สูงกว่า (55>40) ต้องชนะ');
});

test('1 หน้า ชนะ 2 หน้า ชนะ หมู่ (ลำดับชั้นครบ 3 ระดับ) แม้ heroScore ของแต่ละชั้นจะสลับกัน', () => {
  const cands = [
    { i: 0, faces: 8, sc: 90 },  // หมู่ heroScore สูงสุด
    { i: 1, faces: 2, sc: 50 },  // 2 หน้า heroScore กลาง
    { i: 2, faces: 1, sc: 10 },  // หน้าเดี่ยว heroScore ต่ำสุด (แต่ยัง >0)
  ];
  const winner = pickFallback(cands, true);
  assert.equal(winner.i, 2, 'หน้าเดี่ยวต้องชนะเสมอแม้ heroScore ต่ำสุดในกลุ่ม (ตราบใดที่ >0)');
});

test('ไม่มี candidate ไหนผ่านเกณฑ์ขั้นต่ำ (sc<=0 ทุกใบ) → คืน null เหมือนเดิม (ตกไป "ไม่มีตัวเลือกอื่น — ใช้ที่ดีสุดเท่าที่มี")', () => {
  const cands = [
    { i: 0, faces: 1, sc: 0 },
    { i: 1, faces: 3, sc: -10 },
  ];
  assert.equal(pickFallback(cands, true), null);
  assert.equal(pickFallback(cands, false), null, 'พฤติกรรมนี้ต้องเหมือนกันทั้ง 2 โหมด (ไม่ใช่จุดที่ตั้งใจแก้)');
});

test('candidate เดียว (หมู่ล้วน ไม่มีทางเลือกอื่น) → ยังถูกเลือก (ไม่ปฏิเสธ — ดีกว่าไม่มี hero เลย)', () => {
  const cands = [{ i: 0, faces: 6, sc: 25 }];
  const winner = pickFallback(cands, true);
  assert.equal(winner.i, 0, 'ไม่มีตัวเลือกอื่นเลย ต้องยอมใช้ภาพหมู่ที่มี (ตรงตามคอมเมนต์ "ใช้ที่ดีสุดเท่าที่มี")');
});

console.log('hero-fallback-minface-d3: all tests defined via node:test — see summary above');
