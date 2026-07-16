// ============================================================
// 🩹 refTemplateRehab (R5a) — กู้ "พิกัดเทมเพลตที่ AI กะด้วยตา" ให้ตรงตะเข็บจริงเชิงพิกเซล (PURE, ไม่มี AI/IO/network)
// ------------------------------------------------------------
// บริบท: คลัง ref 21 ใบ = ปกแสนไลค์จริงทั้งหมด แต่เกรดตกเพราะ template.slots คลาดจากตะเข็บจริง
//   R1 (refTemplateFidelity) วัดได้ต่อ boundary แล้วว่า "ตะเข็บจริงอยู่ที่ไหน" (foundCoord/foundR + confidence)
//   → โมดูลนี้เลื่อน "ขอบช่องที่แชร์ boundary นั้น" ไปตำแหน่งที่วัดเจอ (แปลง px→% แม่นๆ) เฉพาะ boundary ที่มั่นใจ
//
// การกู้ = การวัดพิกเซลล้วน (ไม่มีการเจน/แต่งภาพ/เรียกโมเดล): เราขยับ "กรอบวางช่อง" ให้ตรงตะเข็บที่ภาพต้นฉบับมีอยู่แล้ว
//
// นิยาม (deterministic — record เดิม + fidelityDetail เดิม → ผลเดิมเสมอ):
//   1) รับ record (dna.template.slots เป็น %) + fidelityDetail (ผล measureTemplateFidelity — boundary เป็น canvas px)
//   2) recompute spec = dnaToTemplateSpec(dna) เพื่อ map "boundary coord (px) → ขอบช่องไหน → dna slot ไหน (%)"
//      (bridge ผ่าน realizedSlotSourceIndex: spec slot ↔ index ต้นฉบับใน dna.template.slots)
//   3) ต่อ boundary ที่ !lowConfidence:
//      - rect (v/h): delta = foundCoord − coord ; ขอบซ้าย/บน → ขยับ xPct/yPct (+ หด/ขยาย wPct/hPct) ; ขอบขวา/ล่าง → ขยาย wPct/hPct
//      - circle: fit วงใหม่จากจุดขอบ 8 ทิศที่วัดเจอ (foundR ทิศที่มั่นใจ ≥3 จุด) → เลื่อนศูนย์กลาง/รัศมี
//   4) กันความปลอดภัย (fail-closed ทั้งใบถ้าเจอ):
//      - เลื่อนต่อขอบเกิน MAX_MOVE_PX (60px) → ยกเลิกทั้งใบ (เกิน SEARCH_RADIUS ของ R1 = ค่ามั่ว)
//      - ช่องหลังเลื่อนไม่ sane: ล้นเฟรม / จิ๋ว < SANE_MIN_PCT (8%) / rect ทับกัน IoU เกินเดิม +IOU_SLACK (0.25) → ยกเลิกทั้งใบ
//   5) idempotent: dna._rehabbed มีแล้ว → no-op (กู้ซ้ำใบที่กู้แล้ว = ไม่เปลี่ยน) · หรือ delta < MIN_MOVE_PX → ข้าม
//   6) เก็บพิกัดเดิมต่อช่องที่ขยับใน slot._geomBeforeRehab (rollback) + คืน rehabFlag {at, engineVersion, movedBoundaries}
//
// ⚠️ ไม่ mutate record/slots ของเดิม — คืน slots ชุดใหม่ (clone) ให้ผู้เรียก (สคริปต์) เขียนกลับเองหลังตรวจ score
// ============================================================

import { dnaToTemplateSpec, realizedSlotSourceIndex } from './refTemplate.js';

export const REHAB_ENGINE_VERSION = 'ref-rehab-r5a-v1';

// ---- ค่าคงที่ความปลอดภัย (deterministic) -------------------------------------
const MAX_MOVE_PX = 60;    // เลื่อนต่อขอบเกินนี้ = ค่ามั่ว (R1 สแกน ±40 อยู่แล้ว) → fail-closed ทั้งใบ
const MIN_MOVE_PX = 2;     // เลื่อนน้อยกว่านี้ = noise/เป๊ะอยู่แล้ว → ไม่แตะ (กัน churn + ช่วย idempotent)
const MATCH_TOL_PX = 6;    // ขอบ spec ห่าง boundary coord ≤ นี้ = ขอบเดียวกัน (= MERGE_TOL ของ R1)
const SANE_MIN_PCT = 8;    // ช่องหลังเลื่อนต้องกว้าง/สูง ≥ 8% (ไม่จิ๋ว)
const IOU_SLACK = 0.25;    // rect คู่ใด IoU ใหม่ห้ามเกิน IoU เดิม + 0.25 (ไม่ทับกันเพิ่ม)
const FRAME_EPS = 0.05;    // ผ่อนขอบเฟรม 0.05% กัน float ปัดเศษ
const CIRCLE_MIN_PTS = 3;  // fit วงต้องมีจุดขอบมั่นใจ ≥ 3 ทิศ

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// IoU ของ rect สอง (%) — a,b = {xPct,yPct,wPct,hPct}
function iouPct(a, b) {
  const ax2 = a.xPct + a.wPct, ay2 = a.yPct + a.hPct;
  const bx2 = b.xPct + b.wPct, by2 = b.yPct + b.hPct;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.xPct, b.xPct));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.yPct, b.yPct));
  const inter = ix * iy;
  const uni = a.wPct * a.hPct + b.wPct * b.hPct - inter;
  return uni > 0 ? inter / uni : 0;
}

// Kåsa algebraic circle fit จากจุด [[x,y],...] (canvas px) → {cx,cy,r} | null
function fitCircle(pts) {
  const n = pts.length;
  if (n < CIRCLE_MIN_PTS) return null;
  let Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0, Sz = 0;
  for (const [x, y] of pts) {
    const z = x * x + y * y;
    Sx += x; Sy += y; Sxx += x * x; Syy += y * y; Sxy += x * y;
    Sxz += x * z; Syz += y * z; Sz += z;
  }
  // แก้ระบบ [Sxx Sxy Sx; Sxy Syy Sy; Sx Sy n]·[D;E;F] = [-Sxz;-Syz;-Sz]
  const sol = solve3(
    [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]],
    [-Sxz, -Syz, -Sz]
  );
  if (!sol) return null;
  const [D, E, F] = sol;
  const cx = -D / 2, cy = -E / 2;
  const rr = cx * cx + cy * cy - F;
  if (!(rr > 0)) return null;
  return { cx, cy, r: Math.sqrt(rr) };
}

// แก้สมการเชิงเส้น 3×3 ด้วยกฎคราเมอร์ (คืน null ถ้า singular)
function solve3(A, b) {
  const det = det3(A);
  if (Math.abs(det) < 1e-9) return null;
  const c0 = det3([[b[0], A[0][1], A[0][2]], [b[1], A[1][1], A[1][2]], [b[2], A[2][1], A[2][2]]]);
  const c1 = det3([[A[0][0], b[0], A[0][2]], [A[1][0], b[1], A[1][2]], [A[2][0], b[2], A[2][2]]]);
  const c2 = det3([[A[0][0], A[0][1], b[0]], [A[1][0], A[1][1], b[1]], [A[2][0], A[2][1], b[2]]]);
  return [c0 / det, c1 / det, c2 / det];
}
function det3(m) {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

function noop(reason, slots0) {
  return {
    ok: true, changed: false, aborted: false, reason,
    slots: Array.isArray(slots0) ? slots0.map((s) => ({ ...s })) : null,
    movedBoundaries: 0, rehabFlag: null,
  };
}
function fail(reason) {
  return { ok: false, changed: false, aborted: true, reason, slots: null, movedBoundaries: 0, rehabFlag: null };
}

/**
 * rehabilitateTemplate — กู้พิกัด template.slots ให้ตรงตะเข็บจริง (PURE, ไม่ mutate input)
 * @param {object} args
 * @param {object} args.record          ระเบียนคลัง { id, imagePath, dna:{ template:{slots:[%]}, ... } }
 * @param {object} args.fidelityDetail  ผล measureTemplateFidelity (ต้องมี .boundaries ที่มี foundCoord/foundR)
 * @param {string} [args.now]           timestamp ISO สำหรับ rehabFlag.at (ผู้เรียกใส่เอง = deterministic; default now)
 * @returns {{ok, changed, aborted, reason, slots:Array|null, movedBoundaries, rehabFlag:{at,engineVersion,movedBoundaries}|null}}
 */
export function rehabilitateTemplate({ record, fidelityDetail, now } = {}) {
  const dna = record?.dna;
  const slots0 = Array.isArray(dna?.template?.slots) ? dna.template.slots : null;
  if (!dna || !slots0 || !fidelityDetail || !Array.isArray(fidelityDetail.boundaries)) {
    return noop('no-input', slots0);
  }
  // idempotent: กู้ไปแล้ว → ไม่แตะ (กู้ซ้ำใบที่กู้แล้ว = ไม่เปลี่ยน)
  if (dna._rehabbed) return noop('already-rehabbed', slots0);

  // bridge: spec slot (px + sourceIndex) — ต้องมาจาก dna เดียวกับที่วัด fidelityDetail
  let spec = null;
  try { spec = dnaToTemplateSpec(dna); } catch { spec = null; }
  if (!spec || !Array.isArray(spec.slots)) return noop('no-spec', slots0);
  const W = Math.round(spec.canvasW || 1080);
  const H = Math.round(spec.canvasH || 1350);

  // clone dna slots (% — work copy) + สแนปช็อตพิกัดเดิมต่อ index (สำหรับ _geomBeforeRehab + IoU เดิม)
  const work = slots0.map((s) => ({ ...s }));
  const origGeom = slots0.map((s) => ({ xPct: num(s.xPct), yPct: num(s.yPct), wPct: num(s.wPct), hPct: num(s.hPct) }));
  const specMap = spec.slots.map((s) => ({ s, si: realizedSlotSourceIndex(s) }));

  const moved = new Set();
  const movedEdges = new Set(); // '<si>:L|R|T|B' — กันขยับขอบเดียวซ้ำจากหลาย boundary
  let movedBoundaries = 0;

  // ── (ก) rect boundaries (v/h) ────────────────────────────────────────────
  for (const b of fidelityDetail.boundaries) {
    if (b.type !== 'v' && b.type !== 'h') continue;
    if (b.lowConfidence) continue;
    if (!Number.isFinite(b.foundCoord) || !Number.isFinite(b.coord)) continue;
    const deltaPx = b.foundCoord - b.coord;
    if (Math.abs(deltaPx) < MIN_MOVE_PX) continue;         // เป๊ะอยู่แล้ว → ข้าม
    if (Math.abs(deltaPx) > MAX_MOVE_PX) return fail(`move ${deltaPx.toFixed(1)}px > ${MAX_MOVE_PX} (boundary)`);
    const deltaPct = (deltaPx / (b.type === 'v' ? W : H)) * 100;

    let touched = false;
    for (const { s, si } of specMap) {
      if (si == null || si < 0 || si >= work.length) continue;
      if (s.shape === 'circle') continue;
      const w = work[si];
      if (!w || w.shape === 'circle') continue;
      if (b.type === 'v') {
        const left = Math.round(s.x), right = Math.round(s.x + s.w);
        if (Math.abs(left - b.coord) <= MATCH_TOL_PX && !movedEdges.has(`${si}:L`)) {
          w.xPct = num(w.xPct) + deltaPct; w.wPct = num(w.wPct) - deltaPct;
          movedEdges.add(`${si}:L`); moved.add(si); touched = true;
        } else if (Math.abs(right - b.coord) <= MATCH_TOL_PX && !movedEdges.has(`${si}:R`)) {
          w.wPct = num(w.wPct) + deltaPct;
          movedEdges.add(`${si}:R`); moved.add(si); touched = true;
        }
      } else {
        const top = Math.round(s.y), bot = Math.round(s.y + s.h);
        if (Math.abs(top - b.coord) <= MATCH_TOL_PX && !movedEdges.has(`${si}:T`)) {
          w.yPct = num(w.yPct) + deltaPct; w.hPct = num(w.hPct) - deltaPct;
          movedEdges.add(`${si}:T`); moved.add(si); touched = true;
        } else if (Math.abs(bot - b.coord) <= MATCH_TOL_PX && !movedEdges.has(`${si}:B`)) {
          w.hPct = num(w.hPct) + deltaPct;
          movedEdges.add(`${si}:B`); moved.add(si); touched = true;
        }
      }
    }
    if (touched) movedBoundaries++;
  }

  // ── (ข) circle boundaries — fit วงใหม่จากขอบ 8 ทิศที่มั่นใจ ────────────────
  for (const b of fidelityDetail.boundaries) {
    if (b.type !== 'circle' || b.lowConfidence) continue;
    if (!Array.isArray(b.directions)) continue;
    const specCircle = specMap.find(({ s }) => s.shape === 'circle' && Array.isArray(b.slotIds) && b.slotIds.includes(s.id));
    if (!specCircle || specCircle.si == null) continue;
    const si = specCircle.si;
    if (si < 0 || si >= work.length) continue;
    const cs = specCircle.s;
    const cx0 = cs.x + cs.w / 2, cy0 = cs.y + cs.h / 2, r0 = (cs.w + cs.h) / 4;

    const pts = [];
    for (const d of b.directions) {
      if (!Number.isFinite(d.foundR)) continue; // null = หาขอบทิศนี้ไม่เจอ → ไม่ปนเข้า fit
      const dx = Number.isFinite(d.dx) ? d.dx : Math.cos((d.angleDeg * Math.PI) / 180);
      const dy = Number.isFinite(d.dy) ? d.dy : Math.sin((d.angleDeg * Math.PI) / 180);
      pts.push([cx0 + d.foundR * dx, cy0 + d.foundR * dy]);
    }
    if (pts.length < CIRCLE_MIN_PTS) continue;
    const fit = fitCircle(pts);
    if (!fit) continue;
    if (Math.abs(fit.cx - cx0) > MAX_MOVE_PX || Math.abs(fit.cy - cy0) > MAX_MOVE_PX || Math.abs(fit.r - r0) > MAX_MOVE_PX) {
      return fail(`circle move > ${MAX_MOVE_PX}px (dc=${Math.round(fit.cx - cx0)},${Math.round(fit.cy - cy0)} dr=${Math.round(fit.r - r0)})`);
    }
    const w = work[si];
    if (!w) continue;
    // แปลงกลับเป็นกล่องล้อมวง (%): วงกว้าง 2r ในแกน px → wPct(%W), hPct(%H)
    w.xPct = ((fit.cx - fit.r) / W) * 100;
    w.yPct = ((fit.cy - fit.r) / H) * 100;
    w.wPct = ((2 * fit.r) / W) * 100;
    w.hPct = ((2 * fit.r) / H) * 100;
    moved.add(si);
    movedBoundaries++;
  }

  if (moved.size === 0) return noop('no-confident-move', slots0);

  // ── (ค) sanity ตรวจ fail-closed ทั้งใบ ────────────────────────────────────
  // แต่ละช่องที่ขยับ: ไม่ล้นเฟรม + ไม่จิ๋ว
  for (const si of moved) {
    const w = work[si];
    const x = num(w.xPct), y = num(w.yPct), ww = num(w.wPct), hh = num(w.hPct);
    if (x < -FRAME_EPS || y < -FRAME_EPS || x + ww > 100 + FRAME_EPS || y + hh > 100 + FRAME_EPS) {
      return fail(`slot#${si} ล้นเฟรม (x=${x.toFixed(1)} y=${y.toFixed(1)} w=${ww.toFixed(1)} h=${hh.toFixed(1)})`);
    }
    if (ww < SANE_MIN_PCT || hh < SANE_MIN_PCT) {
      return fail(`slot#${si} จิ๋ว < ${SANE_MIN_PCT}% (w=${ww.toFixed(1)} h=${hh.toFixed(1)})`);
    }
  }
  // rect คู่ใด IoU ใหม่ห้ามเกิน IoU เดิม + IOU_SLACK
  const rectIdx = [];
  for (let i = 0; i < work.length; i++) if (work[i] && work[i].shape !== 'circle') rectIdx.push(i);
  for (let a = 0; a < rectIdx.length; a++) {
    for (let c = a + 1; c < rectIdx.length; c++) {
      const i = rectIdx[a], j = rectIdx[c];
      const newIoU = iouPct(work[i], work[j]);
      const oldIoU = iouPct(origGeom[i], origGeom[j]);
      if (newIoU > oldIoU + IOU_SLACK) {
        return fail(`rect#${i}×#${j} ทับกันเพิ่ม IoU ${oldIoU.toFixed(2)}→${newIoU.toFixed(2)}`);
      }
    }
  }

  // ── (ง) ผ่านทุกด่าน → แนบ _geomBeforeRehab ต่อช่องที่ขยับ ──────────────────
  for (const si of moved) {
    work[si]._geomBeforeRehab = { ...origGeom[si] };
  }
  const rehabFlag = {
    at: now || new Date().toISOString(),
    engineVersion: REHAB_ENGINE_VERSION,
    movedBoundaries,
  };
  return { ok: true, changed: true, aborted: false, reason: 'rehabbed', slots: work, movedBoundaries, rehabFlag };
}
