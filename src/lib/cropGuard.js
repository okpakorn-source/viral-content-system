// ============================================================
// cropGuard.js — PURE, DETERMINISTIC crop pre-filter (P1 ด่านครอป + P3 หักคะแนนหน้าชิดขอบ "ก่อนเลือกรูป")
// ------------------------------------------------------------
// ปัญหาที่แก้ (เคสจริง AC-0130): hero ถูกยืด 1.60× เกินเพดาน 1.2× + หน้าโดนตัดขอบ เพราะไม่มีด่านคุมตอน
//   "เลือกรูป" — QC มาฟ้องหลังประกอบเสร็จ. โมดูลนี้วัด "ความพอดีของการครอป" ต่อรูป×ช่อง ล่วงหน้า ตอน S6
//   ยังเลือกภาพอยู่ เพื่อให้ (1) สมองเห็นป้ายห้ามเป็น hero (2) โค้ดสลับ hero ที่ครอปไม่ปลอดภัยได้ก่อน queue.
//
// PURE 100%: import เฉพาะโมดูล pure อื่น (heroCropGeometry / candidateMetricMeasurements) — ไม่มี env / IO /
//   Date / random / network. เรียกกี่ครั้งด้วย input เดียวกันได้ผลเท่ากันเป๊ะ (deterministic).
//
// 🔴 fail-closed: รูปที่ "วัดขนาดจริงไม่ได้" (ไม่มี realWidth/realHeight ครบ) ⇒ heroEligible=false เสมอ
//   (เดา = อันตราย: ไฟล์จิ๋วที่ตาคัดให้คะแนนหลอกจะยืดแตกตอนประกอบ). ไม่ปั้น eligible ปลอมจากข้อมูลที่ไม่มี.
// ============================================================

import { HERO_STRETCH_MAX } from '@/lib/heroCropGeometry';
import { computeEdgeCut, EDGE_SAFE_MARGIN } from '@/lib/candidateMetricMeasurements';

// ── เพดานการยืด (cover-fit upscale) ──
//   HERO: ช่องตัวเอกครอปแน่น/หน้าใหญ่ → ยืดเกินเพดานนี้ = แตกชัด (single source = heroCropGeometry.HERO_STRETCH_MAX=1.2)
//   SLOT: ช่องรอง (context/action/circle) ครอปหลวมกว่า/ภาพเล็กกว่า → ผ่อนเพดานได้ (คนละบทบาทกับ hero)
export const HERO_UPSCALE_MAX = HERO_STRETCH_MAX; // 1.2 — ผูกกับ renderer (heroCropGeometry) ไม่ให้ค่าหลุดกัน
export const SLOT_UPSCALE_MAX = 1.6;              // ช่องรอง เพดานผ่อนกว่า (ตามสเปกเจ้าของ "≤1.6")

const _num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const _pos = (v) => { const n = _num(v); return n !== null && n > 0 ? n : null; };

// อ่านขนาดจริงของภาพต้นฉบับ (ต้องมี "ทั้งกว้างและสูง" ถึงคำนวณ aspect/cover-fit ได้) — ขาดตัวใดตัวหนึ่ง = null
//   ★ realShortSide อย่างเดียวใช้ไม่ได้ (ไม่รู้ aspect) → ถือว่าวัดไม่ได้ (fail-closed)
function readRealDims(row) {
  if (row === null || typeof row !== 'object') return null;
  const w = _pos(row.realWidth);
  const h = _pos(row.realHeight);
  if (w === null || h === null) return null;
  return { w, h };
}

// ── cover-fit upscale ──
// นิยาม: renderer ครอปแบบ cover (เติมเต็มช่องไม่มีขอบว่าง) ⇒ ต้องสเกลภาพให้ทั้งกว้าง+สูง ≥ ช่อง
//   upscale = max( slotW / imgW , slotH / imgH )
//   • upscale ≤ 1 = ภาพใหญ่กว่าช่อง (ย่อลง ไม่มีแตก)  • > 1 = ต้องยืด (ยิ่งมากยิ่งแตก)
//   เป็น "lower bound" ของการยืดจริง (renderer ครอปหน้าแบบ face-aware อาจยืดมากกว่านี้) — พอสำหรับด่านคัดหยาบ
//   ที่กัน "ยืดเกินเพดานตั้งแต่ cover-fit" (ถ้าแม้แต่ cover-fit ยังเกิน → face-aware ยิ่งเกิน = ตัดทิ้งได้เลย)
function coverFitUpscale(dims, slot) {
  const sw = _pos(slot?.w);
  const sh = _pos(slot?.h);
  if (!dims || sw === null || sh === null) return null;
  return Math.max(sw / dims.w, sh / dims.h);
}

// อ่าน faceBox จาก triage → {x1,y1,x2,y2} normalized [0,1] ที่ valid หรือ null
//   รองรับ 2 รูปแบบ: {x1,y1,x2,y2} (เหมือน candidate_facts_v1) และ {x,y,w,h}
function readFaceBox(row) {
  try {
    const fb = row?.triage?.faceBox;
    if (fb === null || typeof fb !== 'object') return null;
    let x1; let y1; let x2; let y2;
    if ([fb.x1, fb.y1, fb.x2, fb.y2].every((v) => _num(v) !== null)) {
      x1 = fb.x1; y1 = fb.y1; x2 = fb.x2; y2 = fb.y2;
    } else {
      const x = _num(fb.x); const y = _num(fb.y);
      const w = _num(fb.w ?? fb.width); const h = _num(fb.h ?? fb.height);
      if (x === null || y === null || w === null || h === null) return null;
      x1 = x; y1 = y; x2 = x + w; y2 = y + h;
    }
    // ต้องอยู่ในกรอบ [0,1] + มีพื้นที่จริง (ตามกติกา readFaceBox ใน candidateMetricMeasurements)
    if (x1 < 0 || y1 < 0 || x2 > 1.0001 || y2 > 1.0001) return null;
    if (!(x2 > x1) || !(y2 > y1)) return null;
    return { x1, y1, x2: Math.min(1, x2), y2: Math.min(1, y2) };
  } catch {
    return null;
  }
}

// ── หา "ช่อง hero" จาก templateSpec ──
//   id='main' (rect) = hero ตามกติกา dnaToTemplateSpec · ไม่มี main → rect ที่พื้นที่ใหญ่สุด (ไม่ใช่วงกลม)
//   (สอดคล้อง _rrHeroGeo ใน megaAdapters LANE-C) · หา rect ไม่ได้เลย = null (ไม่มีด่าน hero)
function pickHeroSlot(slots) {
  const rects = slots.filter((s) => s && s.shape !== 'circle' && _pos(s.w) && _pos(s.h));
  if (!rects.length) return null;
  return rects.find((s) => s.id === 'main')
    || rects.slice().sort((a, b) => (b.w * b.h) - (a.w * a.h))[0]
    || null;
}

// ============================================================
// computeCropGuard({ pool, templateSpec }) → guard ต่อรูป×ช่อง
//   pool        = แถวพูลรูป (แต่ละแถวมี id + realWidth/realHeight + triage.faceBox — บางแถวไม่มี = fail-closed)
//   templateSpec= ผลจาก dnaToTemplateSpec (canvas 1080×1350 + slots[px]) — ไม่มี hero rect = ไม่มีด่าน hero
//
// คืน: {
//   heroSlot,                 // ช่อง hero ที่ resolve ได้ (หรือ null)
//   secondarySlots,           // ช่องรองทั้งหมด (rect/circle ที่ไม่ใช่ hero)
//   byId: Map<idStr, guard>,  // guard ต่อรูป (key = String(id))
//   guards: [guard...],       // เรียงตามลำดับ pool
// }
// guard ต่อรูป = {
//   id, hasRealDims, realWidth, realHeight,
//   heroUpscale,   // cover-fit upscale เทียบช่อง hero (null = วัดไม่ได้/ไม่มี hero slot)
//   heroEligible,  // true เฉพาะ hasRealDims && heroUpscale ≤ 1.2 (fail-closed: วัดไม่ได้ = false)
//   slotEligible,  // hasRealDims && มีช่องรองอย่างน้อย 1 ช่องที่ upscale ≤ 1.6
//   bestSlotUpscale, perSlot: { [slotId]: upscale },
//   edgeCut,       // 0..1 (สูตรเดียวกับ candidateMetricMeasurements — หน้าชิดขอบ→1) · null = ไม่มี faceBox
//   edgePenalty,   // = edgeCut ถ้ามี faceBox · 0 ถ้าไม่มี (neutral สำหรับจัดอันดับ ไม่ลงโทษภาพที่วัดไม่ได้)
// }
// ★ ไม่ throw กับ input ใด ๆ (top-level backstop) — พังตรงไหนคืนโครงว่างที่ปลอดภัย
// ============================================================
export function computeCropGuard(input) {
  const empty = { heroSlot: null, secondarySlots: [], byId: new Map(), guards: [] };
  try {
    const src = (input === null || typeof input !== 'object') ? {} : input;
    const pool = Array.isArray(src.pool) ? src.pool : [];
    const specSlots = Array.isArray(src.templateSpec?.slots) ? src.templateSpec.slots : [];
    const heroSlot = pickHeroSlot(specSlots);
    const secondarySlots = specSlots.filter((s) => s && s !== heroSlot && _pos(s.w) && _pos(s.h));

    const byId = new Map();
    const guards = [];
    for (const row of pool) {
      const id = row?.id;
      const idStr = id != null ? String(id) : null;
      const dims = readRealDims(row);
      const hasRealDims = dims !== null;

      const heroUpscale = heroSlot ? coverFitUpscale(dims, heroSlot) : null;
      const heroEligible = hasRealDims && heroUpscale !== null && heroUpscale <= HERO_UPSCALE_MAX + 1e-9;

      const perSlot = {};
      let bestSlotUpscale = null;
      for (const s of secondarySlots) {
        const up = coverFitUpscale(dims, s);
        if (up === null) continue;
        perSlot[s.id] = up;
        if (bestSlotUpscale === null || up < bestSlotUpscale) bestSlotUpscale = up;
      }
      const slotEligible = hasRealDims && bestSlotUpscale !== null && bestSlotUpscale <= SLOT_UPSCALE_MAX + 1e-9;

      const box = readFaceBox(row);
      const edgeCut = box ? computeEdgeCut(box) : null;
      const edgePenalty = edgeCut === null ? 0 : edgeCut;

      const guard = {
        id: idStr,
        hasRealDims,
        realWidth: dims ? dims.w : null,
        realHeight: dims ? dims.h : null,
        heroUpscale,
        heroEligible,
        slotEligible,
        bestSlotUpscale,
        perSlot,
        edgeCut,
        edgePenalty,
      };
      guards.push(guard);
      if (idStr !== null && !byId.has(idStr)) byId.set(idStr, guard);
    }
    return { heroSlot, secondarySlots, byId, guards };
  } catch {
    return empty;
  }
}

export default Object.freeze({ computeCropGuard, HERO_UPSCALE_MAX, SLOT_UPSCALE_MAX, EDGE_SAFE_MARGIN });
