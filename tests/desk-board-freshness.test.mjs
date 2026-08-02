// ============================================================
// 🐛 เทสบั๊กกระดานข่าวโต๊ะ v2 (2 ส.ค. 69 — เจ้าของสั่ง "เช็คบั๊ก อัพเดทไหม แก้ให้อัพเดทจริงเสมอ")
// ------------------------------------------------------------
// 3 บั๊กที่เจอจากของจริง (ลีดในคลัง 274 ใบ):
//   ① ข่าวหายเงียบ — UI ขอ limit 200 ตายตัว ทั้งที่ API รับได้ 500 → 74 ใบท้ายแถวมองไม่เห็น
//      และไม่มีอะไรบอกว่าถูกตัด (เรียงตามคะแนน = ใบคะแนนต่ำหายก่อน)
//   ② เปลี่ยนตัวกรองแล้วกระดานไม่ขยับ — ตัวกรองส่งไปกรองฝั่งเซิร์ฟเวอร์ แต่ไม่มีใครสั่งโหลดใหม่
//   ③ ไม่มีรีเฟรชอัตโนมัติเลย — เปิดหน้าค้างไว้ ล่าข่าวจากที่อื่นเสร็จ กระดานยังเป็นของเก่า
// เป็นหมุดอ่านซอร์ส (โค้ด UI เป็น JSX รันใน node ตรงๆ ไม่ได้) — ใครถอดกลไกออกจะแดงทันที
// 🔴 ข้อ ③ ต้องไม่ยิงตอนแท็บซ่อน — บทเรียน: getAll หนัก = egress พุ่ง เคยโดน Supabase ระงับ
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAB = readFileSync(join(ROOT, 'src/app/news-desk/components/ResearchTab.js'), 'utf8');
const LEADS_API = readFileSync(join(ROOT, 'src/lib/services/deskV2/researchLeads.js'), 'utf8');

// ── ① ข่าวหายเงียบ ──
test('① กระดานต้องขอเต็มเพดานที่ API รับได้ — ห้ามฮาร์ดโค้ด 200 ทิ้งของท้ายแถว', () => {
  assert.match(TAB, /const LIB_LIMIT = 500;/, 'ต้องมีค่าคงที่ LIB_LIMIT = 500 (เท่าเพดานจริงของ API)');
  assert.match(TAB, /new URLSearchParams\(\{ limit: String\(LIB_LIMIT\) \}\)/, 'ต้องส่ง LIB_LIMIT ไม่ใช่เลขตายตัว');
  assert.doesNotMatch(TAB, /limit: '200'/, 'ห้ามกลับไปใช้ 200 ตายตัว');
});

test('① เพดานฝั่ง API ยังเป็น 500 จริง (ถ้าฝั่งนั้นเปลี่ยน ต้องกลับมาแก้ LIB_LIMIT ด้วย)', () => {
  assert.match(LEADS_API, /Math\.min\(500,\s*Number\(limit\)/, 'listLeads ต้อง clamp ที่ 500 — ค่านี้คือที่มาของ LIB_LIMIT');
});

test('① ชนเพดานต้องเตือนบนหน้าจอ — ของเกินห้ามหายเงียบ', () => {
  assert.match(TAB, /libLeads\.length >= LIB_LIMIT/, 'ต้องเช็คว่าชนเพดานไหม');
  assert.match(TAB, /ชนเพดาน/, 'ต้องมีข้อความเตือนให้คนเห็น');
});

// ── ② ตัวกรองต้องโหลดใหม่เอง ──
test('② เปลี่ยนตัวกรอง (สถานะ/ช่องทาง/คลัสเตอร์/คะแนน/คำค้น) ต้องสั่งโหลดใหม่เอง', () => {
  const m = TAB.match(/useEffect\(\(\) => \{\s*if \(!didInit\.current\) return;[\s\S]*?\}, \[fStatus, fChannel, fCluster, fMinScore, fQ\]\);/);
  assert.ok(m, 'ต้องมี useEffect ที่ผูกกับตัวกรองครบทั้ง 5 ตัว และข้ามรอบแรก (didInit)');
  assert.match(m[0], /loadLibrary\(\)/, 'ต้องเรียก loadLibrary จริง');
  assert.match(m[0], /LIB_FILTER_DEBOUNCE_MS/, 'ต้องหน่วงกันยิงรัวตอนพิมพ์');
  assert.match(m[0], /clearTimeout/, 'ต้องเคลียร์ timer เดิม ไม่งั้นยิงซ้อน');
});

// ── ③ รีเฟรชอัตโนมัติ + ห้ามยิงตอนแท็บซ่อน ──
test('③ ต้องรีเฟรชเองเป็นรอบ + ตอนกลับมาที่แท็บ', () => {
  assert.match(TAB, /const LIB_REFETCH_MS = 120000;/, 'รอบรีเฟรชอัตโนมัติ 2 นาที');
  assert.match(TAB, /setInterval\(\(\) => fresh\(/, 'ต้องมีตัวจับเวลารีเฟรช');
  assert.match(TAB, /window\.addEventListener\('focus', onFocus\)/, 'กลับมาที่หน้าต่างต้องรีเฟรช');
  assert.match(TAB, /document\.addEventListener\('visibilitychange', onVis\)/, 'สลับกลับมาที่แท็บต้องรีเฟรช');
});

test('③ 🔴 แท็บที่ซ่อนอยู่ห้ามยิง (กัน egress พุ่ง — เคยโดน Supabase ระงับ)', () => {
  assert.match(TAB, /document\.visibilityState === 'hidden'\) return;/, 'ต้องออกทันทีถ้าแท็บซ่อน');
});

test('③ ระหว่างล่าอยู่ห้ามยิงซ้ำ + มีคูลดาวน์กันยิงถี่', () => {
  assert.match(TAB, /if \(huntingRef\.current\) return;/, 'กำลังล่าอยู่ = ข้าม (รอบล่าโหลดให้เองตอนจบ)');
  assert.match(TAB, /Date\.now\(\) - lastLibFetchRef\.current < cooldownMs\) return;/, 'ต้องมีคูลดาวน์');
  assert.match(TAB, /const LIB_FOCUS_COOLDOWN_MS = 15000;/, 'คูลดาวน์ตอนกลับมาที่แท็บ 15 วิ');
});

test('③ ต้องเก็บเวลาโหลดล่าสุด และคืน listener ตอนออกจากหน้า (กัน leak)', () => {
  assert.match(TAB, /lastLibFetchRef\.current = Date\.now\(\);/, 'โหลดสำเร็จต้องจดเวลาไว้');
  assert.match(TAB, /removeEventListener\('focus', onFocus\)/, 'ต้องถอด listener ตอน unmount');
  assert.match(TAB, /removeEventListener\('visibilitychange', onVis\)/, 'ต้องถอด listener ตอน unmount');
  assert.match(TAB, /clearInterval\(timer\)/, 'ต้องเคลียร์ timer ตอน unmount');
});

test('③ ต้องบอกผู้ใช้ว่าข้อมูลสดแค่ไหน', () => {
  assert.match(TAB, /อัพเดท \{agoLabel\(libLoadedAt\)\}/, 'ต้องโชว์ "อัพเดทเมื่อ…"');
  assert.match(TAB, /function agoLabel/, 'ต้องมีตัวแปลงเวลาเป็นข้อความอ่านง่าย');
});
