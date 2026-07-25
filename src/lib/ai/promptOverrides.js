/**
 * ========================================
 * PROMPT OVERRIDES — เก็บ "พร้อมท์ขั้นตอนงาน" ที่ผู้ใช้แก้เองให้อยู่ถาวร
 * ========================================
 * ★ 25 ก.ค. 69 — แก้บั๊กที่ตรวจเจอ:
 *   เดิม savePrompt() เก็บไว้ในหน่วยความจำของโปรเซสเท่านั้น → รีสตาร์ทเซิร์ฟเวอร์ทีเดียวหายหมด
 *   และเครื่องหลายตัว/หลายอินสแตนซ์ก็เห็นไม่ตรงกัน
 *
 *   ตอนนี้เขียนลงไฟล์ data/<ชื่อไฟล์>.json ด้วย (อ่านกลับตอนบูตอัตโนมัติ)
 *   ถ้าระบบไฟล์เขียนไม่ได้ (เช่นบน Vercel) จะเตือนใน log แล้วทำงานแบบเดิม (ไม่พัง)
 */
import fs from 'fs';
import path from 'path';

function filePath(name) {
  return path.join(process.cwd(), 'data', name);
}

/** อ่านค่าที่ผู้ใช้เคยแก้ไว้ — ไม่มีไฟล์/ไฟล์เสีย = null (ใช้ค่าตั้งต้น) */
export function loadPromptOverrides(name) {
  try {
    const raw = fs.readFileSync(filePath(name), 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

/** เขียนค่าที่ผู้ใช้แก้ลงไฟล์ — คืน true ถ้าเขียนสำเร็จ (ถาวรจริง) */
export function savePromptOverrides(name, obj) {
  try {
    const p = filePath(name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.warn(`[promptOverrides] ⚠️ บันทึกพร้อมท์ลงไฟล์ไม่สำเร็จ (${name}): ${e.message} — ค่าจะอยู่แค่ในหน่วยความจำ`);
    return false;
  }
}
