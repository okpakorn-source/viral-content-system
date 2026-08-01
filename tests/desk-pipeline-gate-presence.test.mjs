// ============================================================
// 🛑 เทสยามเฝ้าประตูโต๊ะข่าว (31 ก.ค. 69) — พิสูจน์ว่าสวิตช์ DESK_PIPELINE ติดอยู่ครบทุกประตูเผาเงิน
// ------------------------------------------------------------
// ผู้ตรวจไขว้ (Sol) จับได้ว่า mutation "ถอด guard ออกจาก route" รอดเทสชุดแรก — ไฟล์นี้คือตาข่าย:
// อ่านซอร์สจริงทุกไฟล์แล้วยืนยันว่า (ก) import สวิตช์ (ข) มีการเรียก deskPipelineOff ในไฟล์
// ใครถอด guard ออกไฟล์ไหน → เทสไฟล์นี้แดงทันที ระบุชื่อไฟล์ชัด
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ประตูเผาเงินทั้งหมดของโต๊ะข่าว (คู่กับคำสั่งเจ้าของ 31 ก.ค. "ปิดชั่วคราว ไม่ให้กิน token")
const GATED = [
  'src/app/api/desk/editor/dispatch/route.js',
  'src/app/api/desk/editor/flush-clips/route.js',
  'src/app/api/desk/dna/analyze/route.js',
  'src/app/api/desk/dna/synthesize/route.js',
  'src/app/api/desk/research/hunt/route.js',
  'src/app/api/desk/research/judge/route.js',
  'src/app/api/desk/research/extract/route.js',
  'src/app/api/news-desk/harvest/route.js',
  'src/app/api/news-desk/chief/route.js',
  'src/app/api/news-desk/command/route.js',
  'src/app/api/news-desk/editor-run/route.js',
  'src/app/api/news-desk/morning-menu/route.js',
  'src/app/api/news-desk/trend-track/route.js',
  'src/app/api/news-desk/extract-dna/route.js',
  'src/app/api/news-desk/image-scout/route.js',
  'src/app/api/news-desk/market-post/route.js',
  'src/app/api/news-desk/reframe-manual/route.js',
  'src/app/api/news-desk/reframe-cases/route.js',
  'src/app/api/news-desk/mine-clip/route.js',
  'src/app/api/company/newsdesk-run/route.js',
  'src/app/api/quick-test/route.js',
  // action-scoped (กันเฉพาะปุ่มเสียเงิน — ปุ่มฟรี/การ์ดผ่านตามเดิม)
  'src/app/api/desk/editor/route.js',
  'src/app/api/news-desk/route.js',
  'src/app/api/news-desk/saga/route.js',
  // รอบ 2 (ผู้ตรวจจับเพิ่ม): จุดเสียเงินแฝง
  'src/app/api/news-desk/feedback/route.js',
  'src/app/api/desk/research/leads/route.js',
];

for (const rel of GATED) {
  test(`ประตู ${rel} ต้องมีสวิตช์ DESK_PIPELINE ครบ (import + เรียกใช้)`, () => {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    assert.match(src, /from '@\/lib\/deskPipelineGate'/, `${rel}: import สวิตช์หาย`);
    assert.match(src, /deskPipelineOff\(\)/, `${rel}: ไม่มีการเรียก deskPipelineOff — ประตูถูกถอด`);
  });
}

// action-scoped: ยืนยันรายชื่อ action เผาเงินอยู่ "ในวงเล็บของ guard จริง" — สกัด allowlist ออกมาตรวจตรงๆ
// (ผู้ตรวจรอบ 2 จับได้ว่า regex เดิมหลวม: ถอด sendWorkflow ออกจาก guard แล้วเทสยังเขียวเพราะไปเจอชื่อใน handler)
test('news-desk main route กันครบ 6 action เผาเงิน (สกัด allowlist ตรงตัว)', () => {
  const src = readFileSync(join(ROOT, 'src/app/api/news-desk/route.js'), 'utf8');
  const m = src.match(/\[([^\]]+)\]\.includes\(action\) && deskPipelineOff\(\)/);
  assert.ok(m, 'ต้องมี guard รูป [รายชื่อ].includes(action) && deskPipelineOff()');
  const listed = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  for (const a of ['consult', 'research', 'reframe', 'reframeAuto', 'autopilot', 'sendWorkflow']) {
    assert.ok(listed.includes(a), `action ${a} หายจาก allowlist ของ guard (มีแค่: ${listed.join(',')})`);
  }
  // ปุ่มไวรัล: ส่วนเสียเงิน (เข้า Watchlist ผ่าน AI) ต้องถูกข้ามตอนปิด — การ์ดยังตีป้ายได้
  assert.match(src, /action === 'viral' && item\.title && !deskPipelineOff\(\)/, 'ส่วนเสียเงินของปุ่มไวรัลต้องมีเงื่อนไขปิด');
});

test('เมนูเช้า: พรีวิวฟรี ?dry=1 ต้องรอดจากประตู (ผู้ตรวจรอบ 3 จับ regression ได้)', () => {
  const mm = readFileSync(join(ROOT, 'src/app/api/news-desk/morning-menu/route.js'), 'utf8');
  assert.match(mm, /if \(!_dry && deskPipelineOff\(\)\)/, 'GET ต้องปล่อย dry=1 ผ่าน (ฟรี: ไม่ harvest ไม่ส่ง Discord)');
});

test('ประตูคู่/จุดเสียเงินแฝง: harvest มี guard ทั้ง POST+GET · feedback ข้าม AI ตอนปิด · sendQueue ถูกกัน', () => {
  const hv = readFileSync(join(ROOT, 'src/app/api/news-desk/harvest/route.js'), 'utf8');
  const hvCount = (hv.match(/deskPipelineOff\(\)/g) || []).length;
  assert.ok(hvCount >= 2, `harvest ต้องมี guard ≥2 จุด (POST+GET) — เจอ ${hvCount}`);
  const fb = readFileSync(join(ROOT, 'src/app/api/news-desk/feedback/route.js'), 'utf8');
  assert.match(fb, /action === 'viral' && item\?\.title && !deskPipelineOff\(\)/, 'feedback ต้องข้ามส่วน AI ตอนปิด');
  const ld = readFileSync(join(ROOT, 'src/app/api/desk/research/leads/route.js'), 'utf8');
  const sqIdx = ld.indexOf("action === 'sendQueue'");
  const guardIdx = ld.indexOf('deskPipelineOff()', sqIdx);
  assert.ok(sqIdx > -1 && guardIdx > sqIdx && guardIdx - sqIdx < 400, 'sendQueue ต้องมี guard ในบล็อกของตัวเอง');
});
test('desk/editor กัน study+pick · saga กัน detect', () => {
  const ed = readFileSync(join(ROOT, 'src/app/api/desk/editor/route.js'), 'utf8');
  assert.match(ed, /\['study', 'pick'\]\.includes\(action\) && deskPipelineOff\(\)/);
  const sg = readFileSync(join(ROOT, 'src/app/api/news-desk/saga/route.js'), 'utf8');
  assert.match(sg, /action === 'detect' && deskPipelineOff\(\)/);
});
