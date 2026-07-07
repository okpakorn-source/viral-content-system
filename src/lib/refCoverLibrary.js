// ============================================================
// 🎯 Ref Cover Library — คลังปกตัวอย่าง (reference) + DNA การจัดวาง
// ------------------------------------------------------------
// เก็บปก ref ที่ผู้ใช้อัพโหลด + DNA ที่สกัดด้วย AI (แนว/ตรรกะการจัดวาง)
// data/ref-cover-library.json (metadata+DNA) · ไฟล์ภาพจริง public/ref-covers/
// อนาคต (เฟส 2): ระบบ match แนวข่าว → หยิบปก ref ที่ DNA ตรงมาเป็นต้นแบบ
// ============================================================

import { promises as fs } from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'data', 'ref-cover-library.json');
const MAX = 1000;

async function readAll() {
  try {
    const t = await fs.readFile(FILE, 'utf8');
    const j = JSON.parse(t);
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

async function writeAll(arr) {
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(arr.slice(-MAX), null, 2), 'utf8');
  } catch { /* เขียนไม่ได้ก็ไม่ให้ล้ม */ }
}

/** รายการปก ref ทั้งหมด (ใหม่สุดก่อน) */
export async function listRefCovers(limit = 500) {
  const all = await readAll();
  return all.slice(-limit).reverse();
}

/** เพิ่มปก ref 1 ใบ (พร้อม DNA ที่สกัดแล้ว) */
export async function addRefCover(rec = {}) {
  const all = await readAll();
  const entry = {
    id: rec.id || `REF-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    uploadedAt: new Date().toISOString(),
    styleName: rec.styleName || '',
    imagePath: rec.imagePath || null,   // /ref-covers/xxx.jpg
    dna: rec.dna || null,               // ผลสกัดจาก refCoverBrain
    dnaError: rec.dnaError || null,     // ถ้าสกัด DNA ล้ม (ยังเก็บภาพไว้ re-analyze ได้)
  };
  all.push(entry);
  await writeAll(all);
  return entry;
}

/** ลบปก ref ตาม id (คืนจำนวนที่ลบ) */
export async function deleteRefCover(id) {
  const all = await readAll();
  const next = all.filter((x) => x.id !== id);
  await writeAll(next);
  return all.length - next.length;
}

/** อัปเดตปก ref (เช่น ตั้งชื่อแนว / re-analyze DNA) */
export async function updateRefCover(id, patch = {}) {
  const all = await readAll();
  const i = all.findIndex((x) => x.id === id);
  if (i < 0) return null;
  all[i] = { ...all[i], ...patch };
  await writeAll(all);
  return all[i];
}
