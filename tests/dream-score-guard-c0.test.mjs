// ============================================================
// 🧪 dream-score-guard-c0.test.mjs — เฟส C ข้อ C-0 (29 ก.ค. 69, บทเรียนสด AC-0218/MCV-ms6792hxlwz)
// ------------------------------------------------------------
// บริบท: ปกพิสูจน์รอบ 4 (AC-0218) hero กลายเป็นภาพงานเลี้ยงในบ้านคนเยอะ (face_share_out:main:12.5,
//   headroom_out:main:40.5) — สมมติฐานตั้งต้น: MEGA_DREAM_SCORE +3 text-match คำ "ครอบครัว/ยาย" ไปบูสต์ภาพหมู่
//   ผิดฉากให้ชนะภาพสนามจริง
// ผลตรวจสอบสมมติฐานจริง (ก่อนแก้ — ดู log/dossier ของเคสนี้): "ไม่ยืนยัน" ตรงตัว — hero ถูกกันออกจาก STORY_SLOTS
//   ทั้งชุดอยู่แล้ว (storyFitOf/dreamMatch ไม่แตะ hero เลยตั้งแต่แรก) รากที่แท้จริงของ AC-0218 คือ hero fallback-
//   ตัวสุดท้ายที่ไม่มีตัวเลือกอื่นเหลือ (candidate ตกไปเป็นภาพหมู่ 5 หน้าที่ตาสองตรวจพบทีหลัง → hero_unverified_kept)
//   — คนละกลไกกับ dream-score จึงไม่ใช่การแก้ AC-0218 โดยตรง (root cause นั้นอยู่นอกสโคปที่ขอในแบตช์นี้)
// อย่างไรก็ตาม หลักการที่ขอ (dream boost ต้องผ่านเกณฑ์พื้นฐานของ role ก่อน) ยังมีคุณค่าจริงตรงจุดที่ dreamMatch
//   ทำงานจริง (context/action/circle ผ่าน storyFitOf) — เทสนี้ครอบคลุม:
//   (1) dreamScoreGuardOk (PURE, exported) — unit ตรง
//   (2) source-assertion: boost ถูกครอบด้วยการ์ดจริงในซอร์ส (ดูคู่กับ dream-score-boost-a6.test.mjs)
//   (3) MEGA_DREAM_SCORE_GUARD kill-switch parity
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

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

const { dreamScoreGuardOk } = await import('@/lib/megaAdapters');
const src = readFileSync(new URL('../src/lib/megaAdapters.js', import.meta.url), 'utf8');

// ═══════════════════════════ (1) dreamScoreGuardOk — PURE unit ═══════════════════════════

test('dreamScoreGuardOk: faceCount ไม่เกิน maxFaces (default 4) → ผ่าน', () => {
  assert.equal(dreamScoreGuardOk({ triage: { faceCount: 0 } }), true);
  assert.equal(dreamScoreGuardOk({ triage: { faceCount: 1 } }), true);
  assert.equal(dreamScoreGuardOk({ triage: { faceCount: 4 } }), true, 'เท่ากับเพดานพอดี ต้องผ่าน (ไม่ใช่ >, ไม่ใช่ >=)');
});

test('dreamScoreGuardOk: faceCount เกิน maxFaces (ภาพหมู่ชัดเจน) → ไม่ผ่าน', () => {
  assert.equal(dreamScoreGuardOk({ triage: { faceCount: 5 } }), false);
  assert.equal(dreamScoreGuardOk({ triage: { faceCount: 12 } }), false, 'เคส AC-0218-analog: ภาพงานเลี้ยงคนเยอะ');
});

test('dreamScoreGuardOk: maxFaces กำหนดเองผ่าน options ได้', () => {
  assert.equal(dreamScoreGuardOk({ triage: { faceCount: 3 } }, { maxFaces: 2 }), false);
  assert.equal(dreamScoreGuardOk({ triage: { faceCount: 2 } }, { maxFaces: 2 }), true);
});

test('dreamScoreGuardOk: faceCount วัดไม่ได้ (undefined/null/ไม่ใช่ตัวเลข) → ผ่านเสมอ (permissive-by-default)', () => {
  assert.equal(dreamScoreGuardOk({ triage: {} }), true);
  assert.equal(dreamScoreGuardOk({ triage: { faceCount: null } }), true);
  assert.equal(dreamScoreGuardOk({}), true);
  assert.equal(dreamScoreGuardOk(null), true);
  assert.equal(dreamScoreGuardOk(undefined), true);
  assert.equal(dreamScoreGuardOk({ triage: { faceCount: 'ห้า' } }), true, 'ค่าประหลาด (ไม่ใช่ number) ต้องไม่ทำให้ throw/บล็อก');
  assert.equal(dreamScoreGuardOk({ triage: { faceCount: NaN } }), true);
});

// ═══════════════════════════ (2) source-assertion: การ์ดครอบ boost จริงในซอร์ส ═══════════════════════════

test('source: _dreamScoreGuardOn นิยามเป็น MEGA_DREAM_SCORE_GUARD !== \'0\' (default ON)', () => {
  assert.ok(/function _dreamScoreGuardOn\(\) \{ return process\.env\.MEGA_DREAM_SCORE_GUARD !== '0'; \}/.test(src));
});

test('source: dreamScoreGuardOk เป็น PURE export (ไม่มี process.env ในตัวฟังก์ชันเอง — env check อยู่ที่ caller เท่านั้น)', () => {
  const m = src.match(/export function dreamScoreGuardOk\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, 'ต้องหาฟังก์ชันเจอ');
  assert.ok(!/process\.env/.test(m[1]), 'ตัวฟังก์ชันเองต้องไม่อ่าน process.env (pure — เหมือน sanitizeFrameBrief)');
});

test('source: dreamMatch boost (context/action/circle ผ่าน storyFitOf) ต้องผ่านการ์ดก่อนเสมอ', () => {
  assert.ok(
    /if \(dreamMatch && \(!_dreamScoreGuardOn\(\) \|\| dreamScoreGuardOk\(x\)\)\) \{/.test(src),
    'boost ต้องมีเงื่อนไขการ์ดครอบอยู่ (ปิดสวิตช์การ์ด = ข้ามการ์ด, เปิด = ต้องผ่าน dreamScoreGuardOk ก่อน)'
  );
});

// ═══════════════════════════ (3) parity truth table (จำลอง pure — แยกจาก storyFitOf ปิดลึกใน s6_slots) ═══════════════════════════

// จำลอง "จะได้ boost ไหม" ตามเงื่อนไขจริงในซอร์ส (คัดลอกตรงจาก 2 บรรทัดด้านบน)
function willBoost({ dreamMatch, faceCount, guardEnv = undefined, maxFaces = 4 }) {
  const guardOn = guardEnv !== '0';
  const guardOk = (typeof faceCount === 'number' && Number.isFinite(faceCount) && faceCount > maxFaces) ? false : true;
  return !!dreamMatch && (!guardOn || guardOk);
}

test('parity: ไม่มี dreamMatch เลย → ไม่มีวันได้ boost ไม่ว่าการ์ด/faceCount จะเป็นอะไร', () => {
  assert.equal(willBoost({ dreamMatch: false, faceCount: 1 }), false);
  assert.equal(willBoost({ dreamMatch: false, faceCount: 99, guardEnv: '0' }), false);
});

test('parity: dreamMatch=true + faceCount ปกติ (≤4) + การ์ดเปิด (default) → ได้ boost', () => {
  assert.equal(willBoost({ dreamMatch: true, faceCount: 1 }), true);
  assert.equal(willBoost({ dreamMatch: true, faceCount: 4 }), true);
});

test('parity: dreamMatch=true + faceCount เกิน 4 (ภาพหมู่) + การ์ดเปิด (default) → ไม่ได้ boost (การ์ดทำงาน)', () => {
  assert.equal(willBoost({ dreamMatch: true, faceCount: 5 }), false);
  assert.equal(willBoost({ dreamMatch: true, faceCount: 12 }), false);
});

test('parity: MEGA_DREAM_SCORE_GUARD=0 → ได้ boost แม้ faceCount เกิน 4 (byte-parity กับก่อนมีการ์ด C-0)', () => {
  assert.equal(willBoost({ dreamMatch: true, faceCount: 12, guardEnv: '0' }), true);
});

test('parity: faceCount วัดไม่ได้ (undefined) + dreamMatch=true → ได้ boost เสมอไม่ว่าการ์ดจะเปิดหรือปิด', () => {
  assert.equal(willBoost({ dreamMatch: true, faceCount: undefined }), true);
  assert.equal(willBoost({ dreamMatch: true, faceCount: undefined, guardEnv: '0' }), true);
});

console.log('dream-score-guard-c0: all tests defined via node:test — see summary above');
