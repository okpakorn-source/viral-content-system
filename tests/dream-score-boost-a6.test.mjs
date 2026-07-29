// ============================================================
// 🧪 dream-score-boost-a6.test.mjs — เฟส A batch ข้อ 6 (29 ก.ค. 69, ปิดเงื่อนไข Opus)
// ------------------------------------------------------------
// dreamMatch boost ใน storyFitOf() (S6, megaAdapters.js) เดิม +1 (เท่าน้ำหนักอารมณ์) → ยก +3 ใต้ env ใหม่
// MEGA_DREAM_SCORE ('0'=+1 เดิม) + เคารพสวิตช์แม่ MEGA_DREAM_WIRING ด้วย
// ------------------------------------------------------------
// harness: storyFitOf เป็น closure ส่วนตัวลึกใน s6_slots (ฟังก์ชันมหึมา หลายพันบรรทัด ต้องพึ่ง byId/vision/ฯลฯ
// เต็มรูปแบบ) — ทดสอบตรงไม่คุ้มค่า/เสี่ยงเทสเปราะ ใช้ source-assertion (regex เช็คโค้ดจริง) แทน ตามแพทเทิร์นเดียวกับ
// tests/gemini-frame-brief.test.mjs (ส่วน "wiring assertion") ที่ established ไว้แล้วในคลังนี้ + พิสูจน์ตรรกะ
// เงื่อนไข boost แยกเป็นฟังก์ชันบริสุทธิ์จำลอง (นิยามซ้ำจากซอร์สตรงๆ) ให้เห็นค่าจริงตามชุด env ต่างๆ
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/lib/megaAdapters.js', import.meta.url), 'utf8');

test('source: dreamMatch boost คำนวณจากทั้ง MEGA_DREAM_WIRING และ MEGA_DREAM_SCORE (ไม่ใช่ +1 คงที่แบบเดิม)', () => {
  assert.ok(
    /s \+= \(_dreamWiringOn\(\) && process\.env\.MEGA_DREAM_SCORE !== '0'\) \? 3 : 1;/.test(src),
    'ต้องมีเงื่อนไข boost ตรงตามที่ออกแบบ (เห็นทั้งสองสวิตช์ในเงื่อนไขเดียว)'
  );
});

// ★ C-0 (แบตช์เฟส C, 29 ก.ค. 69 — การ์ดกัน dream บูสต์ผิดฉาก): บรรทัดเดิม "if (dreamMatch) s += ..." เดี่ยวๆ
//   ถูกห่อด้วยเงื่อนไขการ์ดเพิ่ม (dreamScoreGuardOk) — เทสนี้ยืนยันว่า "ห่อ" จริง (ไม่ใช่ลบเงื่อนไขเดิมทิ้ง) แยกจาก
//   เทสเฉพาะของการ์ดเอง (ดู tests/dream-score-guard-c0.test.mjs)
test('source (C-0): boost ทั้งก้อนถูกครอบด้วยการ์ด dreamScoreGuardOk (ผ่านการ์ดก่อนถึงจะได้ค่า boost เดิม)', () => {
  assert.ok(
    /if \(dreamMatch && \(!_dreamScoreGuardOn\(\) \|\| dreamScoreGuardOk\(x\)\)\) \{\s*\n\s*s \+= \(_dreamWiringOn\(\) && process\.env\.MEGA_DREAM_SCORE !== '0'\) \? 3 : 1;\s*\n\s*\}/.test(src),
    'เงื่อนไขการ์ด C-0 ต้องครอบเงื่อนไข boost เดิมไว้ทั้งก้อน'
  );
});

test('source: _dreamWiringOn ถูกนิยามเป็น process.env.MEGA_DREAM_WIRING !== \'0\' (default ON)', () => {
  assert.ok(/function _dreamWiringOn\(\) \{ return process\.env\.MEGA_DREAM_WIRING !== '0'; \}/.test(src));
});

// จำลองสูตร boost แบบ pure (คัดลอกตรงจากซอร์ส) — ยืนยันค่าจริงตามชุด env ทั้ง 4 ชุด (ครบ truth table 2 สวิตช์)
function dreamBoost(env) {
  const dreamWiringOn = env.MEGA_DREAM_WIRING !== '0';
  return (dreamWiringOn && env.MEGA_DREAM_SCORE !== '0') ? 3 : 1;
}

test('boost=3: ทั้งสองสวิตช์เปิด (default, ไม่ตั้งอะไรเลย)', () => {
  assert.equal(dreamBoost({}), 3);
});

test('boost=1: MEGA_DREAM_SCORE=0 (ปิดเฉพาะค่าคะแนน แต่ยังส่ง compass/dreamQueries ปกติผ่าน MEGA_DREAM_WIRING)', () => {
  assert.equal(dreamBoost({ MEGA_DREAM_SCORE: '0' }), 1);
});

test('boost=1: MEGA_DREAM_WIRING=0 (ปิดสวิตช์แม่ — ทุกอย่างเกี่ยวกับ dream กลับพฤติกรรมเดิม รวม boost นี้)', () => {
  assert.equal(dreamBoost({ MEGA_DREAM_WIRING: '0' }), 1);
});

test('boost=1: ปิดทั้งสองสวิตช์พร้อมกัน', () => {
  assert.equal(dreamBoost({ MEGA_DREAM_WIRING: '0', MEGA_DREAM_SCORE: '0' }), 1);
});

test('source: dreamMatch computation เอง (query word-overlap กับ _dreamText) ไม่ถูกแตะ — เปลี่ยนแค่ค่า boost ไม่เปลี่ยนเงื่อนไขว่า "ตรงช็อตในฝันไหม"', () => {
  assert.ok(
    /const dreamMatch = !!note && !!_dreamText && note\.split\(\/\\s\+\/\)\.some\(\(w\) => w\.length >= 3 && _dreamText\.includes\(w\)\);/.test(src),
    'เงื่อนไข dreamMatch เดิมต้องอยู่ครบไม่มีการแก้ไข'
  );
});

test('source: s (คะแนนรวม) ยังถูก clamp 0-10 เหมือนเดิมหลัง boost ใหม่ — boost=3 ไม่ทำให้คะแนนทะลุเพดานที่ผู้เรียกอื่นคาดหวัง', () => {
  assert.ok(/s = Math\.max\(0, Math\.min\(10, s\)\);/.test(src), 'clamp เดิมต้องยังอยู่หลัง dreamMatch boost');
});

console.log('dream-score-boost-a6: all tests defined via node:test — see summary above');
