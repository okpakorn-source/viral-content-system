// ============================================================
// 🧪 P-CIRCLE-01 face-box calibration (18 ก.ค. — เคสจริง AC-0140/AC-0142)
// ------------------------------------------------------------
// ปัญหา: ธง hard circle_face_overlap เป็น false-positive — detector คืน "กล่องหน้า" ที่กินถึง
//   ลำตัว/ชุด (h/w ≫ 1 เช่น 2.22) → วงกลมทับ "ชุด" ถูกนับเป็น "ทับหน้า"
// วิธีแก้ (ใต้ MEGA_CIRCLE_FACE_CALIB default ON): ตอนวัด gap หด "ขอบล่าง" ของกล่องที่สูงเกิน
//   กว้าง×ratio (ratio=MEGA_CIRCLE_FACE_HEAD_RATIO, default 1.4) ให้เหลือเฉพาะช่วงหัว
//   OFF ('0') = byte-parity เดิมทุกอินพุต (กล่องเดิม)
//
// เทส measureTechRules ตรง (pure export) — ไม่มี compose/IO/LLM · map พิกัดยึดสูตรจริงในโค้ด:
//   region=ต้นทาง px (imgW512×imgH1137) → canvas ผ่าน slot rect · gapThresh = canvasW×3% = 32.4
// เรขาคณิตพิสูจน์: กล่อง h/w=2.2 (คลุมลำตัว), วงทับ "ช่วงล่าง"=ลำตัว vs "ช่วงบน"=หัว
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// ── @/ alias resolver (เหมือน tests อื่นในโฟลเดอร์นี้) → src/ ──
const SRC_ROOT = new URL('../src/', import.meta.url).href;
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { measureTechRules } = await import('../src/lib/services/megaComposerService.js');

// ── กล่องหน้า normalized (สัดส่วน 0-1) บนภาพต้นทาง imgW512×imgH1137 ──
const TORSO = { x1: 0, y1: 0, x2: 1, y2: 1 };                 // h/w = 1137/512 = 2.22 (กล่องคลุมหัว→ลำตัว)
const NORMAL = { x1: 0.3, y1: 0.1, x2: 0.7, y2: 0.2801 };     // w=204.8px h=204.7px → h/w≈1.0 (กล่องหน้าปกติ)
const TALL19 = { x1: 0.3, y1: 0.1, x2: 0.7, y2: 0.4422 };     // w=204.8px h=389.1px → h/w≈1.9 (ใช้เทส ratio override)

const CALIB = 'MEGA_CIRCLE_FACE_CALIB';
const RATIO = 'MEGA_CIRCLE_FACE_HEAD_RATIO';
const ENV_KEYS = [CALIB, RATIO];

// รัน measureTechRules ด้วย main(rect) + วง(circle) 1 ใบ แล้วคืนเฉพาะธง circle_face_* (คุม env, คืนค่าเดิมเสมอ)
function circleFlags(box, circle, env = {}) {
  const saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } // baseline = default (CALIB ON, ratio 1.4)
  for (const [k, v] of Object.entries(env)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
  try {
    const spec = {
      canvasW: 1080,
      slots: [
        { id: 'main', shape: 'rect', x: 0, y: 0, w: 540, h: 1350, zIndex: 1 },
        // วงกลม: r=circle.r, ศูนย์กลาง (circle.cx, circle.cy) บน canvas — zIndex สูงกว่า main (ทับได้จริง)
        { id: 'circle', shape: 'circle', x: circle.cx - circle.r, y: circle.cy - circle.r, w: circle.r * 2, h: circle.r * 2, zIndex: 2, borderWidth: 8 },
      ],
    };
    const faceBoxes = [{ x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2, imgW: 512, imgH: 1137 }];
    const cropTrace = [{ slot: 'main', region: { left: 0, top: 0, width: 512, height: 1137 } }];
    const assignments = [{ slotId: 'main', imageIndex: 0 }];
    const { flags } = measureTechRules({ assignments, spec, faceBoxes, cropTrace });
    return flags.filter((f) => f.startsWith('circle_face_'));
  } finally {
    for (const k of ENV_KEYS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
const hasOverlap = (fl) => fl.includes('circle_face_overlap:main');
const hasNear = (fl) => fl.includes('circle_face_near:main');

// ============================================================ (ก) กล่องกินลำตัว + วงทับ "ช่วงล่าง" (ลำตัว)
test('(ก) กล่อง h/w=2.2 วงทับลำตัว: ON ไม่ติด overlap (calibrate ตัดลำตัว) / OFF ติด overlap (false-positive เดิม)', () => {
  const torsoCircle = { cx: 270, cy: 1100, r: 100 }; // วงอยู่ล่างสุด = ตำแหน่งลำตัว ไม่ใช่หัว
  const on = circleFlags(TORSO, torsoCircle, {});
  const off = circleFlags(TORSO, torsoCircle, { [CALIB]: '0' });
  assert.ok(!hasOverlap(on), `ON: calibrate หดกล่องเหลือหัว → วงไม่ทับหน้าจริง (got ${JSON.stringify(on)})`);
  assert.ok(hasOverlap(off), `OFF: byte-parity เดิม → ยังติด false-positive (got ${JSON.stringify(off)})`);
});

// ============================================================ (ข) กล่องกินลำตัว + วงทับ "ช่วงบน" (หัว) — การ์ดของจริงต้องคงอยู่
test('(ข) กล่อง h/w=2.2 วงทับช่วงหัว (บนสุดของกล่อง): ติด overlap ทั้ง ON และ OFF (การ์ดวงทับหน้าจริงยังทำงาน)', () => {
  const headCircle = { cx: 270, cy: 100, r: 100 }; // วงบนสุด = ทับช่วงหัวที่ calibrate เก็บไว้
  const on = circleFlags(TORSO, headCircle, {});
  const off = circleFlags(TORSO, headCircle, { [CALIB]: '0' });
  assert.ok(hasOverlap(on), `ON: หัวยังอยู่ในกล่อง calibrated → ทับจริงต้องติด (got ${JSON.stringify(on)})`);
  assert.ok(hasOverlap(off), `OFF: ทับจริงต้องติด (got ${JSON.stringify(off)})`);
});

// ============================================================ (ค) กล่องหน้าปกติ h/w=1.0 → identity: ON/OFF เหมือนกันทุกกรณี
test('(ค) กล่อง h/w=1.0 (ปกติ): ON กับ OFF ให้ผลเหมือนกันเป๊ะ (helper คืนกล่องเดิม identity) — ทับ/ไกล', () => {
  const overlapC = { cx: 270, cy: 257, r: 100 }; // วงกลางกล่อง = ทับ
  const farC = { cx: 270, cy: 1200, r: 80 };      // วงไกลใต้กล่อง = ไม่ทับ
  assert.deepStrictEqual(circleFlags(NORMAL, overlapC, {}), circleFlags(NORMAL, overlapC, { [CALIB]: '0' }), 'ทับ: ON==OFF');
  assert.deepStrictEqual(circleFlags(NORMAL, farC, {}), circleFlags(NORMAL, farC, { [CALIB]: '0' }), 'ไกล: ON==OFF');
  // และต้องเป็นผลที่ถูกต้อง (ทับ→overlap, ไกล→ว่าง) ไม่ใช่บังเอิญเท่ากันเพราะ error
  assert.ok(hasOverlap(circleFlags(NORMAL, overlapC, {})), 'ทับกล่องหน้าปกติ = overlap');
  assert.deepStrictEqual(circleFlags(NORMAL, farC, {}), [], 'วงไกล = ไม่มีธง');
});

// ============================================================ (ง) near (0≤gap<thresh) ยังทำงานกับกล่อง calibrated
test('(ง) วงอยู่ใต้กล่อง calibrated เล็กน้อย (0≤gap<32.4): ON=circle_face_near (ไม่ overlap) / OFF=overlap (ยังทับลำตัวเดิม)', () => {
  const nearCircle = { cx: 270, cy: 961, r: 100 }; // ห่างขอบล่าง calibrated ~9.9px < thresh 32.4
  const on = circleFlags(TORSO, nearCircle, {});
  const off = circleFlags(TORSO, nearCircle, { [CALIB]: '0' });
  assert.ok(hasNear(on) && !hasOverlap(on), `ON: แค่ใกล้กล่อง calibrated → near เท่านั้น (got ${JSON.stringify(on)})`);
  assert.ok(hasOverlap(off), `OFF: กล่องเต็มลำตัว → ยัง overlap (got ${JSON.stringify(off)})`);
});

// ============================================================ (จ) ratio env override มีผล
test('(จ) MEGA_CIRCLE_FACE_HEAD_RATIO override: default 1.4 หด(ไม่ทับ) แต่ ratio=2.0 ไม่หด(ทับ)', () => {
  const jCircle = { cx: 270, cy: 560, r: 30 }; // อยู่ในช่องว่างระหว่างขอบล่าง ratio1.4 (~475) กับ ratio2.0 (~597)
  const def = circleFlags(TALL19, jCircle, {});                       // ratio 1.4 → หดกล่อง → วงพ้นหน้า
  const wide = circleFlags(TALL19, jCircle, { [RATIO]: '2.0' });      // ratio 2.0 → ไม่หด (h/w1.9<2.0) → วงทับกล่องเดิม
  assert.ok(!hasOverlap(def), `ratio 1.4 (default): calibrate หด → ไม่ overlap (got ${JSON.stringify(def)})`);
  assert.ok(hasOverlap(wide), `ratio 2.0: ไม่ calibrate → overlap (got ${JSON.stringify(wide)})`);
});

test('(จ2) ratio parse ผิด/≤0 → fallback 1.4 (ผลเท่า default)', () => {
  const jCircle = { cx: 270, cy: 560, r: 30 };
  const base = circleFlags(TALL19, jCircle, {});
  assert.deepStrictEqual(circleFlags(TALL19, jCircle, { [RATIO]: '0' }), base, 'ratio=0 → 1.4');
  assert.deepStrictEqual(circleFlags(TALL19, jCircle, { [RATIO]: 'abc' }), base, 'ratio=abc → 1.4');
  assert.deepStrictEqual(circleFlags(TALL19, jCircle, { [RATIO]: '-5' }), base, 'ratio<0 → 1.4');
});

// ============================================================ byte-parity รวม: OFF = พฤติกรรมเดิมทุกเคส
test('byte-parity: MEGA_CIRCLE_FACE_CALIB=0 ให้ผลเดียวกับ "ไม่มี calib" (กล่องเดิม) ทุกเคสข้างบน', () => {
  // OFF ต้องเท่ากับพฤติกรรมก่อนมี helper: กล่อง TORSO เต็ม → วงล่าง/บน/ใกล้ = overlap หมด, ปกติ = ตามจริง
  assert.ok(hasOverlap(circleFlags(TORSO, { cx: 270, cy: 1100, r: 100 }, { [CALIB]: '0' })));
  assert.ok(hasOverlap(circleFlags(TORSO, { cx: 270, cy: 100, r: 100 }, { [CALIB]: '0' })));
  assert.ok(hasOverlap(circleFlags(TORSO, { cx: 270, cy: 961, r: 100 }, { [CALIB]: '0' })));
});
