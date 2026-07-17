// ============================================================
// 📐 Panel Crop Geometry — เรขาคณิตครอปช่องรอง (PURE, ไม่มี IO/sharp/LLM)
// ------------------------------------------------------------
// แบตช์ C (17 ก.ค.): แยก "คณิตครอป" ออกจาก executor เพื่อเทสได้โดด (ไม่ต้องมีรูปจริง)
//   coverExecutorService.js / megaComposerService.js เรียกฟังก์ชันเหล่านี้ผ่าน kill-switch
//   ทุกฟังก์ชันรับ/คืนค่าเป็นตัวเลขล้วน — เทสด้วย faceBox+slot+circleZone ที่ปั้นมือได้
//
// พิกัดที่ใช้ (ยึดตามโค้ดจริงใน renderRectTile):
//   • region = { left, top, width, height } เป็น "พิกเซลของภาพต้นทาง" (source px)
//   • faceBox = { x1, y1, x2, y2 } normalized 0..1 ของภาพต้นทาง (ตาหาหน้า)
//   • slotAspect = slot.w / slot.h  (region ต้อง aspect เท่าช่องเสมอ — fill ไม่ยืด)
//   • การเรนเดอร์: region → ช่อง แบบ fill สัดส่วนตรง ⇒ จุดที่ frac (fx,fy) ของ region
//     ไปตกที่ frac (fx,fy) ของช่องเป๊ะ (ใช้กับ C2 mapping โซนวง)
//   • faceSharePct = สูงหน้า(raw px) / region.height × 100  (สูตรเดียวกับ measureTechRules)
// ============================================================

const _clamp = (v, lo, hi) => (hi < lo ? lo : Math.min(Math.max(v, lo), hi));

/**
 * ขยายกล่องหน้า (raw) → กล่อง "หัว" รวมผม/หู/คาง เป็นพิกเซลต้นทาง
 * ใช้เฉพาะเช็ก coverage (หัวห้ามตก) — การวัด faceShare ยังใช้ raw face box ตาม measureTechRules
 */
export function headBoxPx(faceBox, imgW, imgH, pad = { x: 0.20, top: 0.42, bottom: 0.32 }) {
  const fwN = faceBox.x2 - faceBox.x1, fhN = faceBox.y2 - faceBox.y1;
  const minX = (faceBox.x1 - fwN * pad.x) * imgW;
  const maxX = (faceBox.x2 + fwN * pad.x) * imgW;
  const minY = (faceBox.y1 - fhN * pad.top) * imgH;
  const maxY = (faceBox.y2 + fhN * pad.bottom) * imgH;
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

/** faceShare (%) ของหน้า raw ในกรอบสูง regionHeight (สูตร measureTechRules) */
export function faceSharePctOf(faceBox, imgH, regionHeight) {
  if (!(regionHeight > 0)) return null;
  const faceHpx = (faceBox.y2 - faceBox.y1) * imgH;
  return +((faceHpx / regionHeight) * 100).toFixed(1);
}

/** กล่อง (min,max) หนึ่งมิติ อยู่ในกรอบ [start, start+size] โดยเว้นขอบ margin ครบไหม */
function _boxInside1D(boxMin, boxMax, start, size, margin) {
  return boxMin >= start + margin - 1e-6 && boxMax <= start + size - margin + 1e-6;
}

/**
 * หา start (left/top) ที่ "เลื่อนน้อยสุดจาก pref" โดยให้กล่อง [boxMin,boxMax] อยู่ในกรอบขนาด size
 * เว้นขอบ margin + ไม่หลุดภาพ [0, imgSize]
 * คืน { start, covered } — covered=false เมื่อภาพเล็ก/หน้าชิดขอบจนคลุม+margin ไม่ได้
 */
function _place1D(boxMin, boxMax, size, margin, imgSize, pref) {
  // เงื่อนไข: start ≤ boxMin - margin  และ  start ≥ boxMax + margin - size
  let lo = boxMax + margin - size;
  let hi = boxMin - margin;
  if (lo > hi) { lo = boxMax - size; hi = boxMin; }        // margin ไม่พอ → อย่างน้อยคลุมกล่อง
  if (lo > hi) { const c = (boxMin + boxMax) / 2 - size / 2; lo = c; hi = c; } // กล่องใหญ่กว่ากรอบ → จัดกึ่งกลาง
  let start = _clamp(pref, lo, hi);
  start = _clamp(start, 0, Math.max(0, imgSize - size));
  const covered = _boxInside1D(boxMin, boxMax, start, size, margin);
  return { start, covered };
}

/**
 * C1 — ครอปช่องรอง "เล็งหน้า": ปรับ region ให้ faceShare เข้า band + คลุมหัวเต็ม + ไม่ตัดขอบ
 *   เลื่อน/ขยายจาก region เดิม "น้อยสุด" · aspect ต้องคงเท่าช่อง · ห้ามใช้กับ hero (ผู้เรียกกันไว้)
 *
 * ★ byte-parity: ถ้า region เดิม faceShare อยู่ใน band อยู่แล้ว + คลุมหัวครบ → คืน region เดิม (changed=false)
 *
 * @returns {{ region, changed, covered, faceSharePct, reason }}
 */
export function refineRegionForFace({
  region, faceBox, imgW, imgH, slotAspect,
  band = [18, 60], edgeMarginPct = 0.06, headPad = { x: 0.20, top: 0.42, bottom: 0.32 },
}) {
  if (!region || !region.height || !faceBox || !(faceBox.x2 > faceBox.x1) || !(faceBox.y2 > faceBox.y1)
    || !(imgW > 0) || !(imgH > 0) || !(slotAspect > 0)) {
    return { region, changed: false, covered: null, faceSharePct: null, reason: 'no-face-or-bad-input' };
  }
  const rawFaceHpx = (faceBox.y2 - faceBox.y1) * imgH;
  if (!(rawFaceHpx > 0)) return { region, changed: false, covered: null, faceSharePct: null, reason: 'no-face' };
  const [bandLo, bandHi] = band[0] <= band[1] ? band : [band[1], band[0]];
  const head = headBoxPx(faceBox, imgW, imgH, headPad);

  // ── (0) region เดิมผ่านเกณฑ์อยู่แล้วไหม → byte-parity ──
  const curShare = (rawFaceHpx / region.height) * 100;
  const curCoverX = _boxInside1D(head.minX, head.maxX, region.left, region.width, edgeMarginPct * region.width);
  const curCoverY = _boxInside1D(head.minY, head.maxY, region.top, region.height, edgeMarginPct * region.height);
  if (curShare >= bandLo && curShare <= bandHi && curCoverX && curCoverY) {
    return { region, changed: false, covered: true, faceSharePct: +curShare.toFixed(1), reason: 'ok' };
  }

  // ── (1) เลือกความสูง region ให้ faceShare เข้า band (เลื่อนน้อยสุดจากสูงเดิม) + คลุมหัว ──
  const hForBandHi = (rawFaceHpx * 100) / bandHi;                 // เล็กสุด (faceShare = bandHi)
  const hForBandLo = (rawFaceHpx * 100) / bandLo;                 // ใหญ่สุด (faceShare = bandLo)
  const minCoverH = head.height / Math.max(0.1, 1 - 2 * edgeMarginPct); // ต้องคลุมหัว+margin แนวตั้ง
  let loH = Math.max(hForBandHi, minCoverH);
  let hiH = Math.max(hForBandLo, minCoverH);
  let H = _clamp(region.height, loH, hiH);
  H = Math.min(H, imgH);
  let W = H * slotAspect;
  if (W > imgW) { W = imgW; H = W / slotAspect; }
  if (H > imgH) { H = imgH; W = H * slotAspect; }

  // ── (2) วางตำแหน่งเลื่อนน้อยสุด ให้หัวอยู่ในกรอบ + margin + ไม่หลุดภาพ ──
  const posX = _place1D(head.minX, head.maxX, W, edgeMarginPct * W, imgW, region.left);
  const posY = _place1D(head.minY, head.maxY, H, edgeMarginPct * H, imgH, region.top);

  const out = {
    left: Math.round(posX.start),
    top: Math.round(posY.start),
    width: Math.max(8, Math.round(W)),
    height: Math.max(8, Math.round(H)),
  };
  const faceSharePct = faceSharePctOf(faceBox, imgH, out.height);
  const changed = out.left !== region.left || out.top !== region.top
    || out.width !== region.width || out.height !== region.height;
  return { region: out, changed, covered: posX.covered && posY.covered, faceSharePct, reason: changed ? 'refined' : 'unchanged' };
}

/**
 * C2a — คำนวณ "โซนวงกลม" ที่ template ปักไว้ ตกลงบนช่องไหน เป็น frac ของช่อง (= frac ของ region)
 * @param circle { cx, cy, d } ศูนย์กลาง+เส้นผ่านศูนย์กลาง (พิกเซล canvas)
 * @param slot   { x, y, w, h } กรอบช่อง (พิกเซล canvas)
 * @param marginPx เผื่อขอบวง (พิกเซล canvas)
 * @returns {null | { x0, y0, x1, y1 }} frac 0..1 ของช่อง — null = วงไม่ทับช่อง
 */
export function computePanelCircleZone({ circle, slot, marginPx = 0 }) {
  if (!circle || !slot || !(slot.w > 0) || !(slot.h > 0) || !(circle.d > 0)) return null;
  const r = circle.d / 2 + Math.max(0, marginPx);
  const cx0 = circle.cx - r, cy0 = circle.cy - r, cx1 = circle.cx + r, cy1 = circle.cy + r;
  const ix0 = Math.max(cx0, slot.x), iy0 = Math.max(cy0, slot.y);
  const ix1 = Math.min(cx1, slot.x + slot.w), iy1 = Math.min(cy1, slot.y + slot.h);
  if (ix1 <= ix0 || iy1 <= iy0) return null; // ไม่ทับ
  return {
    x0: _clamp((ix0 - slot.x) / slot.w, 0, 1),
    y0: _clamp((iy0 - slot.y) / slot.h, 0, 1),
    x1: _clamp((ix1 - slot.x) / slot.w, 0, 1),
    y1: _clamp((iy1 - slot.y) / slot.h, 0, 1),
  };
}

/**
 * C2b — bias region ให้หน้าคน "ออกนอกโซนวง" โดยเลื่อน region (ขนาดคงเดิม) น้อยสุด
 *   หน้าต้องยังอยู่ในกรอบ + ไม่หลุดภาพ · เลื่อนยังไงก็ไม่พ้น → avoided=false (สัญญาณให้ลองภาพสำรอง)
 * @returns {{ region, moved, avoided }}
 */
export function biasRegionFromCircleZone({ region, faceBox, zone, imgW, imgH }) {
  if (!zone || !region || !region.width || !region.height
    || !faceBox || !(faceBox.x2 > faceBox.x1) || !(faceBox.y2 > faceBox.y1)) {
    return { region, moved: false, avoided: true };
  }
  const W = region.width, H = region.height;
  const fL = faceBox.x1 * imgW, fR = faceBox.x2 * imgW, fT = faceBox.y1 * imgH, fB = faceBox.y2 * imgH;

  const overlaps = (left, top) => {
    const fx0 = (fL - left) / W, fx1 = (fR - left) / W, fy0 = (fT - top) / H, fy1 = (fB - top) / H;
    return !(fx1 <= zone.x0 || fx0 >= zone.x1 || fy1 <= zone.y0 || fy0 >= zone.y1);
  };
  // ★ FIX#1: เช็ก "กล่องหน้าทั้งใบ" อยู่ในกรอบครบ (ไม่ใช่แค่จุดกึ่งกลาง) — เดิมเช็กเฉพาะ center
  //   ทำให้ candidate ที่ดันหน้าหลุดขอบ region บางส่วน (ตัดหน้าได้ถึง ~45%) ถูกยอมรับผิด
  //   เผื่อ ±1e-6 กัน FP ล้วน (ยังไม่ปัดเศษ)
  const faceInside = (left, top) => (
    fL >= left - 1e-6 && fR <= left + W + 1e-6 && fT >= top - 1e-6 && fB <= top + H + 1e-6
  );

  if (!overlaps(region.left, region.top)) return { region, moved: false, avoided: true };

  // ★ FIX#2: ดัน candidate "เลยขอบโซน" ทีละ EPS พิกเซล ให้การหลบ FP-robust จริง — เดิมวางแบบสัมผัสขอบพอดี
  //   ทำให้เงื่อนไขหลบ (บรรทัด overlaps) ประเมินคาบเส้น → ไม่เสถียร/ไม่สมมาตร (ขวา/ล่าง self-reject)
  //   ทิศ + สำหรับหลบซ้าย/บน (ต้องเพิ่ม left/top), ทิศ − สำหรับหลบขวา/ล่าง (ต้องลด left/top)
  const EPS = 1e-3;
  // 4 ทิศ: ดันหน้าไปซ้าย/ขวา/บน/ล่างของโซน — เลือกอันที่เลื่อนน้อยสุดและยังใช้ได้จริง
  const candidates = [
    { left: fR - zone.x0 * W + EPS, top: region.top }, // หน้าอยู่ซ้ายโซน (ดันเลยขอบซ้ายของโซน)
    { left: fL - zone.x1 * W - EPS, top: region.top }, // หน้าอยู่ขวาโซน (ดันเลยขอบขวาของโซน)
    { left: region.left, top: fB - zone.y0 * H + EPS }, // หน้าอยู่เหนือโซน (ดันเลยขอบบนของโซน)
    { left: region.left, top: fT - zone.y1 * H - EPS }, // หน้าอยู่ใต้โซน (ดันเลยขอบล่างของโซน)
  ];
  let best = null, bestCost = Infinity;
  for (const c of candidates) {
    const left = _clamp(c.left, 0, Math.max(0, imgW - W));
    const top = _clamp(c.top, 0, Math.max(0, imgH - H));
    if (overlaps(left, top) || !faceInside(left, top)) continue;
    const cost = Math.hypot(left - region.left, top - region.top);
    if (cost < bestCost) { bestCost = cost; best = { left, top }; }
  }
  if (!best) return { region, moved: false, avoided: false }; // เลื่อนไม่พ้น (หรือเลี่ยงแล้วหน้าตัด) → ลองสำรอง
  // ★ FIX#2/#3: re-verify ค่าที่ "ปัดเศษแล้ว" (= ค่าที่เรนเดอร์จริง) ยังหลบวงครบ + หน้าอยู่ในกรอบครบ
  //   กันปัดเศษดันกลับเข้าโซน/ตัดหน้า → ถ้าพลาดคืน avoided:false ให้ไปเส้นภาพสำรองแทนส่งหน้าตัด
  const rLeft = Math.round(best.left), rTop = Math.round(best.top);
  if (overlaps(rLeft, rTop) || !faceInside(rLeft, rTop)) return { region, moved: false, avoided: false };
  const moved = rLeft !== region.left || rTop !== region.top;
  return { region: { ...region, left: rLeft, top: rTop }, moved, avoided: true };
}
