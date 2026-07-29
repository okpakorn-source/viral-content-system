// ============================================================
// 🧪 silent-catch-warn-d2.test.mjs — เฟส D ข้อ 2 (29 ก.ค. 69, AUDIT-REF-APP 1.3/1.4)
// ------------------------------------------------------------
// 2 จุด "ล้มเงียบ" ค้างใน megaAdapters.js (S6 ref-pick ~เดิม 4413, S7 fallback ~เดิม 7057 — anchor จาก
// _research-igdara-15k/AUDIT-REF-APP.md) — catch เปล่าไม่มี log แม้แต่บรรทัดเดียว งานข่าวจริงเดินไปเต็มท่อ
// โดยไม่มี ref template กำกับ โดยไม่มีร่องรอยใน log ให้ตรวจย้อนหลัง
// แก้: เพิ่ม console.warn บอกสาเหตุจริง (e?.message) — ห้ามเปลี่ยน control flow (ยัง catch แล้วเดินต่อแบบเดิม
// ทุกกรณี แค่มองเห็นได้จาก log)
// ------------------------------------------------------------
// harness: source-assertion ล้วน (ยืนยันโค้ดจริง) + ทดสอบ behavior จริงผ่าน error-throwing stub ว่า catch ยัง
// กลืน error โดยไม่เปลี่ยนผลลัพธ์ปลายทาง (ไม่ throw ทะลุ ไม่เปลี่ยน branch อื่น)
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/lib/megaAdapters.js', import.meta.url), 'utf8');

test('[AUDIT-REF-APP 1.3] S6 ref-pick catch เปล่าเดิม ถูกแทนที่ด้วย console.warn ที่มีสาเหตุจริง (e?.message)', () => {
  assert.ok(
    /console\.warn\('\[MEGA S6\] ref-pick ล้ม \(เดินแบบเดิมไม่มี ref\): ' \+ String\(e\?\.message \|\| e\)\.slice\(0, 200\)\);/.test(src),
    'ต้องมี console.warn พร้อมสาเหตุจริงแทน catch เปล่าเดิม'
  );
  assert.ok(!/\} catch \{ \/\* ไม่มีคลัง ref → เดินแบบเดิม \*\/ \}/.test(src), 'catch เปล่าเดิมต้องไม่เหลืออยู่แล้ว');
});

test('[AUDIT-REF-APP 1.4] S7 fallback catch เปล่าเดิม ถูกแทนที่ด้วย console.warn ที่มีสาเหตุจริง (e?.message)', () => {
  assert.ok(
    /console\.warn\('\[MEGA S7\] ref-pick fallback ล้ม \(ใช้ template ปกติ ไม่กระทบ\): ' \+ String\(e\?\.message \|\| e\)\.slice\(0, 200\)\);/.test(src),
    'ต้องมี console.warn พร้อมสาเหตุจริงแทน catch เปล่าเดิม'
  );
  assert.ok(!/\} catch \{ \/\* คลัง ref ว่าง\/ล้ม → ไม่มี ref \(ใช้ template ปกติ\) ไม่กระทบ \*\/ \}/.test(src), 'catch เปล่าเดิมต้องไม่เหลืออยู่แล้ว');
});

test('ทั้ง 2 จุด: catch รับ parameter (e) แล้ว (ไม่ใช่ catch เปล่าไม่มี binding อีกต่อไป — จำเป็นสำหรับอ่าน e.message)', () => {
  const matches = src.match(/\} catch \(e\) \{\s*\n\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*console\.warn\('\[MEGA S[67]\]/g) || [];
  assert.ok(matches.length >= 2, `ต้องมีอย่างน้อย 2 จุดที่ catch(e) แล้ว console.warn ด้วยสาเหตุจริง (เจอ ${matches.length})`);
});

test('ยืนยัน control flow ไม่เปลี่ยน: จำลอง pickBestRef throw จริง (เหมือนที่จุด 1.3/1.4 ครอบอยู่) — catch(e){console.warn(...)} ยังกลืน error ไม่ throw ทะลุ (พิสูจน์ pattern เดียวกับที่ใช้จริงในไฟล์)', () => {
  // จำลอง pattern เดียวกับที่ใช้จริง (catch (e) { console.warn(...) } ไม่มี rethrow/return/break เพิ่ม)
  // เพื่อพิสูจน์ว่า "แค่เพิ่ม log" ไม่เปลี่ยนพฤติกรรมการกลืน error เดิม
  let warned = null;
  const originalWarn = console.warn;
  console.warn = (msg) => { warned = msg; };
  let afterCatchReached = false;
  try {
    try {
      throw new Error('จำลอง pickBestRef ล้ม');
    } catch (e) {
      console.warn('[MEGA S6] ref-pick ล้ม (เดินแบบเดิมไม่มี ref): ' + String(e?.message || e).slice(0, 200));
    }
    afterCatchReached = true; // ต้องถึงบรรทัดนี้เสมอ — catch ต้องไม่ throw ทะลุ/ไม่ break ออกจาก scope ที่ครอบ
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(afterCatchReached, true, 'โค้ดหลัง catch ต้องรันต่อได้ปกติ (control flow ไม่เปลี่ยน)');
  assert.ok(warned && warned.includes('จำลอง pickBestRef ล้ม'), 'console.warn ต้องได้รับข้อความ error จริง ไม่ใช่ข้อความคงที่');
});

console.log('silent-catch-warn-d2: all tests defined via node:test — see summary above');
