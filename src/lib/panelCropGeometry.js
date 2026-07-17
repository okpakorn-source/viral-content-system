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
 * C1b (17 ก.ค.) — ครอปช่องรอง "คลุมหลายหน้า": ปรับ region ให้คลุม "กล่องรวม (union) ของหน้า valid ทุกใบ"
 *   เต็ม + margin หัว/ขอบ · band วัดจากหน้า dominant (ใหญ่สุด — ตรงสูตร QC measureTechRules)
 *   เลื่อน/ขยายจาก region เดิม "น้อยสุด" · aspect คงเท่าช่อง · ห้ามใช้กับ hero (ผู้เรียกกันไว้)
 *
 * ★ union กว้าง/สูงเกินกว่าที่ band+aspect รับได้ (ต้องดัน dominant ต่ำกว่า bandLo หรือหน้าหลุดกรอบ)
 *   → คืน { ok:false } region เดิม (สัญญาณคงเดิม/ลองภาพสำรอง — ห้ามฝืนครอปตัดคน)
 * ★ 1 หน้า = delegate refineRegionForFace เดิมเป๊ะ (ห้าม regress)
 *
 * @param faces  faceBox[] normalized 0..1 (หน้าที่ตกใน region — ผู้เรียกคัดมาแล้ว)
 * @returns {{ region, changed, ok, covered, faceSharePct, reason }}
 */
export function refineRegionForFaces({
  region, faces, imgW, imgH, slotAspect,
  band = [18, 60], edgeMarginPct = 0.06, headPad = { x: 0.20, top: 0.42, bottom: 0.32 },
}) {
  const valid = Array.isArray(faces)
    ? faces.filter((f) => f && f.x2 > f.x1 && f.y2 > f.y1)
    : [];
  if (!region || !region.height || valid.length === 0 || !(imgW > 0) || !(imgH > 0) || !(slotAspect > 0)) {
    return { region, changed: false, ok: false, covered: null, faceSharePct: null, reason: 'no-face-or-bad-input' };
  }
  // ── 1 หน้า = เส้น refineRegionForFace เดิมเป๊ะ (delegate — ห้าม regress) ──
  if (valid.length === 1) {
    const r = refineRegionForFace({ region, faceBox: valid[0], imgW, imgH, slotAspect, band, edgeMarginPct, headPad });
    return { ...r, ok: r.reason !== 'no-face-or-bad-input' && r.reason !== 'no-face' };
  }
  const [bandLo, bandHi] = band[0] <= band[1] ? band : [band[1], band[0]];
  // หน้า dominant = พื้นที่มากสุด (band วัดจากใบนี้ — ตรงสูตร QC: สูงหน้า dominant / สูง region)
  let dom = valid[0];
  for (const f of valid) {
    if ((f.x2 - f.x1) * (f.y2 - f.y1) > (dom.x2 - dom.x1) * (dom.y2 - dom.y1)) dom = f;
  }
  const rawDomHpx = (dom.y2 - dom.y1) * imgH;
  if (!(rawDomHpx > 0)) return { region, changed: false, ok: false, covered: null, faceSharePct: null, reason: 'no-face' };

  // ── union กล่อง "หัว" (รวมผม/หู/คาง) ของทุกหน้า valid — region ต้องคลุมเต็ม ──
  let uMinX = Infinity, uMaxX = -Infinity, uMinY = Infinity, uMaxY = -Infinity;
  for (const f of valid) {
    const h = headBoxPx(f, imgW, imgH, headPad);
    if (h.minX < uMinX) uMinX = h.minX;
    if (h.maxX > uMaxX) uMaxX = h.maxX;
    if (h.minY < uMinY) uMinY = h.minY;
    if (h.maxY > uMaxY) uMaxY = h.maxY;
  }
  const unionW = uMaxX - uMinX, unionH = uMaxY - uMinY;

  // ── (0) byte-parity: region เดิม dominant band ครบ + คลุม union ครบ → ไม่แตะ ──
  const curShare = (rawDomHpx / region.height) * 100;
  const curCoverX = _boxInside1D(uMinX, uMaxX, region.left, region.width, edgeMarginPct * region.width);
  const curCoverY = _boxInside1D(uMinY, uMaxY, region.top, region.height, edgeMarginPct * region.height);
  if (curShare >= bandLo && curShare <= bandHi && curCoverX && curCoverY) {
    return { region, changed: false, ok: true, covered: true, faceSharePct: +curShare.toFixed(1), reason: 'ok' };
  }

  // ── (1) เลือกความสูง region: dominant เข้า band + คลุม union ทั้งสูง/กว้าง ──
  const hForBandHi = (rawDomHpx * 100) / bandHi;   // เล็กสุด (dominant faceShare = bandHi)
  const hForBandLo = (rawDomHpx * 100) / bandLo;   // ใหญ่สุด (dominant faceShare = bandLo)
  const denom = Math.max(0.1, 1 - 2 * edgeMarginPct);
  const minCoverH = Math.max(unionH / denom, unionW / (slotAspect * denom)); // คลุม union+margin ทั้งสองแกน
  // union กว้าง/สูงเกินกว่า band รับได้ (ต้องดัน dominant ต่ำกว่า bandLo) → ทำไม่ได้ ห้ามฝืนตัดคน
  if (minCoverH > hForBandLo + 1e-6) {
    return { region, changed: false, ok: false, covered: false, faceSharePct: null, reason: 'union-exceeds-band' };
  }
  let loH = Math.max(hForBandHi, minCoverH);
  const hiH = hForBandLo;
  if (loH > hiH) loH = hiH;                          // กันปัดเศษล้ำ
  let H = _clamp(region.height, loH, hiH);
  H = Math.min(H, imgH);
  let W = H * slotAspect;
  if (W > imgW) { W = imgW; H = W / slotAspect; }
  if (H > imgH) { H = imgH; W = H * slotAspect; }

  // ── (2) วางตำแหน่ง: คลุม union + margin + ไม่หลุดภาพ (เลื่อนน้อยสุดจาก region เดิม) ──
  const posX = _place1D(uMinX, uMaxX, W, edgeMarginPct * W, imgW, region.left);
  const posY = _place1D(uMinY, uMaxY, H, edgeMarginPct * H, imgH, region.top);

  const out = {
    left: Math.round(posX.start),
    top: Math.round(posY.start),
    width: Math.max(8, Math.round(W)),
    height: Math.max(8, Math.round(H)),
  };
  // ── การ์ดสุดท้าย: ทุกหน้า raw ต้องอยู่ในกรอบครบ (ไม่ตัดคน) + dominant faceShare ยังใน band ──
  //   (ภาพเล็ก/aspect บีบจนคลุมไม่ครบ → ok:false ให้ผู้เรียกคงเดิม/ลองสำรอง)
  const allFacesIn = valid.every((f) => (
    f.x1 * imgW >= out.left - 1 && f.x2 * imgW <= out.left + out.width + 1
    && f.y1 * imgH >= out.top - 1 && f.y2 * imgH <= out.top + out.height + 1
  ));
  const dShare = (rawDomHpx / out.height) * 100;
  const bandOk = dShare >= bandLo - 0.6 && dShare <= bandHi + 0.6;
  if (!allFacesIn || !bandOk) {
    return { region, changed: false, ok: false, covered: false, faceSharePct: +dShare.toFixed(1), reason: 'cannot-fit' };
  }
  const changed = out.left !== region.left || out.top !== region.top
    || out.width !== region.width || out.height !== region.height;
  return {
    region: out, changed, ok: true, covered: posX.covered && posY.covered,
    faceSharePct: +dShare.toFixed(1), reason: changed ? 'refined' : 'unchanged',
  };
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
 *
 * ★ C1b (17 ก.ค.): รับได้ทั้ง faceBox (ใบเดียว) หรือ faces[] (หลายใบ) — ต้องให้ "ทุกหน้า" พ้นโซน
 *   + ทุกหน้าอยู่ในกรอบครบ (reuse faceInside เต็มใบต่อหน้า) · candidate ดันจากขอบ union ของหน้า
 *   (byte-parity: 1 หน้า/faceBox เดิม = พฤติกรรมเดิมเป๊ะ — สูตร candidate/เช็กเหมือนเดิมทุกจุด)
 * @returns {{ region, moved, avoided }}
 */
export function biasRegionFromCircleZone({ region, faceBox, faces, zone, imgW, imgH }) {
  const list = (Array.isArray(faces) && faces.length ? faces : (faceBox ? [faceBox] : []))
    .filter((f) => f && f.x2 > f.x1 && f.y2 > f.y1);
  if (!zone || !region || !region.width || !region.height || list.length === 0) {
    return { region, moved: false, avoided: true };
  }
  const W = region.width, H = region.height;
  // ขอบพิกเซลต้นทางต่อหน้า
  const px = list.map((f) => ({ L: f.x1 * imgW, R: f.x2 * imgW, T: f.y1 * imgH, B: f.y2 * imgH }));

  // "หน้าใบใดใบหนึ่ง" ทับโซน = ยังไม่พ้น
  const overlapsAny = (left, top) => px.some((p) => {
    const fx0 = (p.L - left) / W, fx1 = (p.R - left) / W, fy0 = (p.T - top) / H, fy1 = (p.B - top) / H;
    return !(fx1 <= zone.x0 || fx0 >= zone.x1 || fy1 <= zone.y0 || fy0 >= zone.y1);
  });
  // ★ FIX#1: เช็ก "กล่องหน้าทั้งใบ" ของทุกหน้าอยู่ในกรอบครบ (ไม่ใช่แค่ center) — กัน candidate ที่ดันหน้าหลุดขอบ
  //   เผื่อ ±1e-6 กัน FP ล้วน (ยังไม่ปัดเศษ)
  const allInside = (left, top) => px.every((p) => (
    p.L >= left - 1e-6 && p.R <= left + W + 1e-6 && p.T >= top - 1e-6 && p.B <= top + H + 1e-6
  ));

  if (!overlapsAny(region.left, region.top)) return { region, moved: false, avoided: true };

  // ★ FIX#2: ดัน candidate "เลยขอบโซน" ทีละ EPS พิกเซล ให้การหลบ FP-robust — ใช้ขอบ union ของทุกหน้า
  //   (ดันทั้งกลุ่มพ้นทิศเดียวกัน) ทิศ + หลบซ้าย/บน (เพิ่ม left/top), ทิศ − หลบขวา/ล่าง (ลด left/top)
  const EPS = 1e-3;
  const maxR = Math.max(...px.map((p) => p.R)), minL = Math.min(...px.map((p) => p.L));
  const maxB = Math.max(...px.map((p) => p.B)), minT = Math.min(...px.map((p) => p.T));
  const candidates = [
    { left: maxR - zone.x0 * W + EPS, top: region.top }, // กลุ่มหน้าอยู่ซ้ายโซน (ดันเลยขอบซ้ายของโซน)
    { left: minL - zone.x1 * W - EPS, top: region.top }, // กลุ่มหน้าอยู่ขวาโซน (ดันเลยขอบขวาของโซน)
    { left: region.left, top: maxB - zone.y0 * H + EPS }, // กลุ่มหน้าอยู่เหนือโซน (ดันเลยขอบบนของโซน)
    { left: region.left, top: minT - zone.y1 * H - EPS }, // กลุ่มหน้าอยู่ใต้โซน (ดันเลยขอบล่างของโซน)
  ];
  let best = null, bestCost = Infinity;
  for (const c of candidates) {
    const left = _clamp(c.left, 0, Math.max(0, imgW - W));
    const top = _clamp(c.top, 0, Math.max(0, imgH - H));
    if (overlapsAny(left, top) || !allInside(left, top)) continue;
    const cost = Math.hypot(left - region.left, top - region.top);
    if (cost < bestCost) { bestCost = cost; best = { left, top }; }
  }
  if (!best) return { region, moved: false, avoided: false }; // เลื่อนไม่พ้น (หรือเลี่ยงแล้วหน้าตัด) → ลองสำรอง
  // ★ FIX#2/#3: re-verify ค่าที่ "ปัดเศษแล้ว" (= ค่าที่เรนเดอร์จริง) ยังหลบวงครบ + ทุกหน้าอยู่ในกรอบครบ
  const rLeft = Math.round(best.left), rTop = Math.round(best.top);
  if (overlapsAny(rLeft, rTop) || !allInside(rLeft, rTop)) return { region, moved: false, avoided: false };
  const moved = rLeft !== region.left || rTop !== region.top;
  return { region: { ...region, left: rLeft, top: rTop }, moved, avoided: true };
}
