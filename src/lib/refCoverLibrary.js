// ============================================================
// 🎯 Ref Cover Library — คลังปกตัวอย่าง (reference) + DNA การจัดวาง
// ------------------------------------------------------------
// เก็บ DNA/โครงเทมเพลตที่สกัดด้วย AI (แนว/ตรรกะการจัดวาง) — ไม่เก็บภาพต้นฉบับ
// ★ redesign 18 ก.ค. (คำสั่ง sol): ref = โครงล้วน — เก็บผ่าน persistStore('ref-cover-library')
//   (Supabase primary + local file fallback ในตัว) แทนไฟล์ data/ref-cover-library.json ตรงๆ
// อนาคต (เฟส 2): ระบบ match แนวข่าว → หยิบปก ref ที่ DNA ตรงมาเป็นต้นแบบ
// ============================================================

import { resolveRefSlotView } from './refSlotContract.js';
import { createStore } from './persistStore.js';

// ★ redesign 18 ก.ค. (คำสั่ง sol): ref = โครงล้วน ไม่เก็บภาพตัวอย่าง — เลิกเก็บไฟล์ local (data/ref-cover-library.json)
//   ย้ายเป็น Supabase-backed ผ่าน persistStore (Supabase primary + local file fallback ในตัว createStore)
let _store = null;
function getStore() {
  if (!_store) _store = createStore('ref-cover-library');
  return _store;
}

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

/** รายการปก ref ทั้งหมด (ใหม่สุดก่อน) */
export async function listRefCovers(limit = 500) {
  const all = await getStore().getAll();
  return all
    .slice()
    .sort((a, b) => String(b?.uploadedAt || '').localeCompare(String(a?.uploadedAt || '')))
    .slice(0, limit);
}

/** เพิ่มปก ref 1 ใบ (พร้อม DNA ที่สกัดแล้ว) — structure-only: ห้ามมี imagePath */
export async function addRefCover(rec = {}) {
  const entry = {
    id: rec.id || `REF-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    uploadedAt: new Date().toISOString(),
    styleName: rec.styleName || '',
    dna: rec.dna || null,               // ผลสกัดจาก refCoverBrain
    dnaError: rec.dnaError || null,     // ถ้าสกัด DNA ล้ม
  };
  await getStore().add(entry);
  return entry;
}

/** ลบปก ref ตาม id (คืนจำนวนที่ลบ) */
export async function deleteRefCover(id) {
  const all = await getStore().getAll();
  const exists = all.some((x) => x.id === id);
  if (exists) await getStore().remove(id);
  return exists ? 1 : 0;
}

/** อัปเดตปก ref (เช่น ตั้งชื่อแนว / re-analyze DNA) */
export async function updateRefCover(id, patch = {}) {
  // ★ ใช้ store.update (atomic UPDATE ตรง — merge {...existing,...patch}) แทน remove→add
  //   กันข้อมูลหายถ้า add ล้มหลัง remove สำเร็จ · store.update throw เมื่อไม่พบ id → catch คืน null (คงสัญญาเดิม)
  try {
    return await getStore().update(id, patch);
  } catch {
    return null;
  }
}

/** ล้างคลังปก ref ทั้งหมด (คืนจำนวนที่ลบ) */
export async function clearAllRefCovers() {
  // ★ ใช้ store.removeAll (ลบทีเดียว) แทน loop remove ทีละใบ (กันลบค้างครึ่งทาง) · นับก่อนลบเพื่อคืนจำนวน
  const all = await getStore().getAll();
  const n = all.length;
  await getStore().removeAll();
  return n;
}
