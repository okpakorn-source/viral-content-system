// ============================================================
// 🧪 keyword-compass-dream.test.mjs — buildKeywordUserPrompt รับ compass ใหม่ (เฟส A ข้อ 2, dormant)
// ------------------------------------------------------------
// บริบท: compass.visualDreamShots (จาก compassBrain) ไม่เคยถูกป้อนเข้าขั้นสกัดคีย์เวิร์ดเลย
// เทสนี้พิสูจน์:
//   (a) dormant: ไม่ส่ง compass (2-arg เดิม) / undefined / {} / {visualDreamShots:[]} → prompt เดิมทุกตัวอักษร
//   (b) เปิดใช้จริง: compass.visualDreamShots มีของ → ต่อท้ายบล็อกช็อตภาพในฝัน + สั่งให้ผลิตคีย์ dream_shot_queries
//   (c) เพดานกันยัดขยะ: ตัด description/slot ยาวเกิน + จำกัดจำนวนช็อต ≤8
//   (d) wiring: /api/keywords/route.js ต้องส่ง body.compass เข้า buildKeywordUserPrompt จริง (grep source ตรงๆ)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildKeywordUserPrompt } from '../src/lib/keywordPrompt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ANALYSIS = { headline: 'ข่าวทดสอบ', angle: 'มุมทดสอบ' };
const NEWS_TEXT = 'เนื้อข่าวทดสอบ';

test('dormant: ไม่ส่ง compass (2-arg เดิม) === ส่ง undefined เป๊ะ', () => {
  const a = buildKeywordUserPrompt(ANALYSIS, NEWS_TEXT);
  const b = buildKeywordUserPrompt(ANALYSIS, NEWS_TEXT, undefined);
  assert.equal(a, b);
  assert.ok(!a.includes('dream_shot_queries'), 'ไม่ส่ง compass ต้องไม่มีคำสั่งคีย์ใหม่เลย');
  assert.ok(!a.includes('ช็อตภาพในฝัน'));
});

test('dormant: compass={} (ไม่มี visualDreamShots) → prompt เดิมทุกตัวอักษร', () => {
  const base = buildKeywordUserPrompt(ANALYSIS, NEWS_TEXT);
  const withEmptyCompass = buildKeywordUserPrompt(ANALYSIS, NEWS_TEXT, {});
  assert.equal(withEmptyCompass, base);
});

test('dormant: compass.visualDreamShots=[] (array ว่าง) → prompt เดิมทุกตัวอักษร', () => {
  const base = buildKeywordUserPrompt(ANALYSIS, NEWS_TEXT);
  const withEmptyShots = buildKeywordUserPrompt(ANALYSIS, NEWS_TEXT, { visualDreamShots: [] });
  assert.equal(withEmptyShots, base);
});

test('dormant: compass.visualDreamShots ไม่ใช่ array (string/object) → ถูกเมิน เหมือน []', () => {
  const base = buildKeywordUserPrompt(ANALYSIS, NEWS_TEXT);
  assert.equal(buildKeywordUserPrompt(ANALYSIS, NEWS_TEXT, { visualDreamShots: 'ไม่ใช่ array' }), base);
  assert.equal(buildKeywordUserPrompt(ANALYSIS, NEWS_TEXT, { visualDreamShots: {} }), base);
});

test('เปิดใช้จริง: มี visualDreamShots → ต่อท้ายบล็อกช็อต + สั่งผลิต dream_shot_queries', () => {
  const compass = {
    visualDreamShots: [
      { slot: 'hero', description: 'ภาพยิ้มขณะเดินเข้าบ้านเก่า' },
      { slot: 'reaction', description: 'ภาพอึ้งตอนเห็นบ้านที่สร้างใหม่' },
    ],
  };
  const p = buildKeywordUserPrompt(ANALYSIS, NEWS_TEXT, compass);
  assert.ok(p.includes('ช็อตภาพในฝันจากเข็มทิศเรื่อง'), 'ต้องมีหัวบล็อก');
  assert.ok(p.includes('[hero] ภาพยิ้มขณะเดินเข้าบ้านเก่า'));
  assert.ok(p.includes('[reaction] ภาพอึ้งตอนเห็นบ้านที่สร้างใหม่'));
  assert.ok(p.includes('dream_shot_queries'), 'ต้องสั่งให้ผลิตคีย์ใหม่นี้');
  // เนื้อเดิมยังอยู่ครบ (additive เท่านั้น ไม่ใช่ replace)
  assert.ok(p.includes(JSON.stringify(ANALYSIS, null, 2)));
  assert.ok(p.includes(NEWS_TEXT));
  assert.ok(p.includes('จงสกัดคำค้นหาภาพให้มากและหลากหลายที่สุดตามกฎเหล็กและสคีมา'));
});

test('เพดานกันยัดขยะ: จำกัด ≤8 ช็อต + slot ≤20 ตัวอักษร + description ≤200 ตัวอักษร', () => {
  const longDesc = 'ก'.repeat(500);
  const longSlot = 'ข'.repeat(50);
  const shots = Array.from({ length: 12 }, (_, i) => ({ slot: longSlot, description: `${longDesc}_${i}` }));
  const p = buildKeywordUserPrompt(ANALYSIS, NEWS_TEXT, { visualDreamShots: shots });
  const lines = p.split('\n').filter((l) => /^\d+\.\s*\[/.test(l));
  assert.equal(lines.length, 8, 'ต้องจำกัดไม่เกิน 8 ช็อตแม้ส่งมาเกิน');
  for (const l of lines) {
    const m = /^\d+\.\s*\[([^\]]*)\]\s*(.*)$/.exec(l);
    assert.ok(m, `บรรทัดต้อง parse ได้: ${l}`);
    assert.ok(m[1].length <= 20, 'slot ต้องถูกตัดไม่เกิน 20 ตัวอักษร');
    assert.ok(m[2].length <= 200, 'description ต้องถูกตัดไม่เกิน 200 ตัวอักษร');
  }
});

test('ช็อตที่ไม่มี slot/description → ไม่ throw (fallback ค่าว่าง)', () => {
  const p = buildKeywordUserPrompt(ANALYSIS, NEWS_TEXT, { visualDreamShots: [{}] });
  assert.ok(p.includes('[-]'), 'slot ว่าง → fallback "-" (ตามแพทเทิร์นอื่นในไฟล์เดียวกัน)');
});

test('wiring: /api/keywords/route.js ต้องส่ง body.compass เข้า buildKeywordUserPrompt จริง', () => {
  const routeSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'app', 'api', 'keywords', 'route.js'),
    'utf8'
  );
  assert.match(
    routeSrc,
    /buildKeywordUserPrompt\(\s*analysis\s*,\s*newsText\s*,\s*body\.compass\s*\)/,
    'route ต้องเรียก buildKeywordUserPrompt(analysis, newsText, body.compass) ตรงๆ'
  );
});
