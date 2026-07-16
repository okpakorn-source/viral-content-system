// ============================================================
// 🎯 Ref Cover Library — คลังปกตัวอย่าง (reference) + DNA การจัดวาง
// ------------------------------------------------------------
// เก็บปก ref ที่ผู้ใช้อัพโหลด + DNA ที่สกัดด้วย AI (แนว/ตรรกะการจัดวาง)
// data/ref-cover-library.json (metadata+DNA) · ไฟล์ภาพจริง public/ref-covers/
// อนาคต (เฟส 2): ระบบ match แนวข่าว → หยิบปก ref ที่ DNA ตรงมาเป็นต้นแบบ
// ============================================================

import { promises as fs } from 'fs';
import path from 'path';
import { resolveRefSlotView } from './refSlotContract.js';

const FILE = path.join(process.cwd(), 'data', 'ref-cover-library.json');
const MAX = 1000;

// ============================================================
// 🔧 R2 sync helper — dna.slots (semantic) ↔ template.slots (geometry)
// ------------------------------------------------------------
// ต้นตอบัค (นิติเวช 16 ก.ค.): PATCH แก้เทมเพลตมือ (route.js) อัป template.slots + panelCount
//   แต่ไม่แตะ dna.slots → semantic ค้างชี้ role เก่า (dangling) / role ใหม่ในเทมเพลตไม่มี semantic (unmatched).
// helper นี้ "จัด dna.slots ให้ตรงกับ template.slots" โดยใช้ resolveRefSlotView (template_v1) เป็นผู้ตัดสิน align:
//   · role เดิมที่ยัง match → คงทั้ง entry (desc/subject/shot/emotion เดิม) ตามลำดับเดิม
//   · dna slot ที่ dangling (ไม่มี template role รองรับ) → ตัดทิ้ง
//   · template role ที่ unmatched (ไม่มี semantic) → เพิ่ม entry ขั้นต่ำ { role, pos(จาก geometry) } เท่านั้น
//     — ห้ามมโน subject/shot/emotion/desc (พวกนี้ต้องดูภาพจริง = งานคน ไม่ใช่งาน sync)
// idempotent: ป้อน dna.slots ที่ตรงอยู่แล้ว → คืน entry ชุดเดิม (ลำดับ+อ้างอิงเดิม) ไม่เปลี่ยนอะไร.
// ============================================================

/**
 * ป้ายตำแหน่งภาษาไทยแบบ deterministic จาก geometry ล้วน (ไม่ใช่การมโนเนื้อหา — เป็นพิกัดตรงๆ).
 * แบ่งเป็น 3 ส่วนแนวนอน (ซ้าย/กลาง/ขวา) × แนวตั้ง (บน/กลาง/ล่าง) จากจุดศูนย์กลางช่อง.
 * @returns {string|null} เช่น 'ล่างขวา' · 'กลาง' · null เมื่อ geometry ไม่ครบ
 */
export function posFromGeometry(slot) {
  const x = Number(slot?.xPct);
  const y = Number(slot?.yPct);
  const w = Number(slot?.wPct);
  const h = Number(slot?.hPct);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const hz = cx < 38 ? 'ซ้าย' : cx > 62 ? 'ขวา' : 'กลาง';
  const vt = cy < 38 ? 'บน' : cy > 62 ? 'ล่าง' : 'กลาง';
  if (hz === 'กลาง' && vt === 'กลาง') return 'กลาง';
  if (vt === 'กลาง') return hz;
  if (hz === 'กลาง') return vt;
  return `${vt}${hz}`; // เช่น บนขวา · ล่างซ้าย
}

/**
 * จัด dna.slots (semantic) ให้ align กับ template.slots (geometry) — คืน array ใหม่ (ไม่ mutate input).
 * ใช้ resolveRefSlotView(template_v1) เป็นผู้ตัดสินว่า dna slot ใด dangling และ template role ใด unmatched.
 * @param {Array} currentDnaSlots dna.slots เดิม
 * @param {Array} newTemplateSlots template.slots ที่กำลังจะเป็น (จาก PATCH หรือคลังปัจจุบัน)
 * @returns {Array} dna.slots ชุดใหม่ (surviving entry เดิม + minimal entry ของ role ใหม่)
 */
export function syncDnaSlotsToTemplate(currentDnaSlots, newTemplateSlots) {
  const dnaSlots = Array.isArray(currentDnaSlots) ? currentDnaSlots : [];
  const tplSlots = Array.isArray(newTemplateSlots) ? newTemplateSlots : [];
  // ไม่มี template axis = ไม่มีอะไรให้ sync (กัน resolver มอง dna ทั้งหมดเป็น dangling แล้วลบเกลี้ยง)
  if (!tplSlots.length) return dnaSlots.slice();

  const view = resolveRefSlotView({ template: { slots: tplSlots }, slots: dnaSlots }, { mode: 'template_v1' });
  const danglingIdx = new Set(view.diagnostics.danglingDnaRoles.map((d) => d.index));

  // 1) คง dna slot ที่ยัง match (ลำดับเดิม + อ้างอิง entry เดิม → เนื้อหาเดิมครบ)
  const kept = dnaSlots.filter((_, i) => !danglingIdx.has(i));

  // 2) เพิ่ม entry ขั้นต่ำสำหรับ template role ที่ยังไม่มี semantic (ลำดับตาม template)
  const additions = view.views
    .filter((v) => !v.semanticMatched)
    .map((v) => {
      const tpl = tplSlots[v.index] || {};
      const role = String(tpl.role || '').trim() || v.role;
      const pos = posFromGeometry(tpl);
      const entry = { role };
      if (pos) entry.pos = pos;
      return entry;
    });

  return [...kept, ...additions];
}

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
