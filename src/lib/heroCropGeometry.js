// ============================================================
// heroCropGeometry.js — PURE, DETERMINISTIC, SHARED hero-crop geometry (no imports, no IO, no env, no Date/random).
// ------------------------------------------------------------
// SINGLE SOURCE OF TRUTH for the hero (single-face) crop CONSTANTS + a REPLICATED region/upscale estimator, so the
// executor (coverExecutorService.js — the renderer) and the PRE-CARRIER selection (megaAdapters.js S6 + the V2
// producer) do not drift. NOTE ON SHARING: only the CONSTANTS are code-shared (the renderer imports HERO_CROP /
// FACE_PROM_CEILING / HERO_PROMINENCE from here). The region math here is a faithful REPLICATION of the renderer's
// primary crop path — the renderer does NOT call this function (its final region needs runtime-only inputs: all
// detected faces, decoded pixels, the COMPOSE_FACE_PROMINENCE env, and the eye-fix Final-Cropper geometry), so exact
// shared execution is impossible. It is a conservative estimator, not renderer-parity.
//
// SOUNDNESS (CONSERVATIVE UPPER BOUND on the renderer's true hero upscale for the PRIMARY faceRegionForSlot path,
// never a false pass): heroCropUpscale() replicates every size-SHRINKING step of the primary path — head-box, base
// sizing, the face-prominence min/max clamps, top-edge zoom-out, off-centre zoom, image clamp, hero
// prominence-tightening toward the 1.6 ceiling — and OMITS only the size-ENLARGING safety re-centre / head-poke fixes
// (which only make the region LARGER ⇒ true upscale LOWER). So for the primary path heroCropUpscale() >= the
// renderer's true upscale ⇒ `<= 1.2` here ⇒ renderer `<= 1.2` (no false-pass). For a centred face it equals it.
//
// TWO renderer transforms are OUTSIDE the primary path and can each SHRINK the final region (RAISE the true upscale),
// and are NOT modeled here — so a caller MUST fail closed for any candidate to which they may apply, or the bound is
// unsound:
//   (1) WATERMARK / TEXT DODGE (coverExecutorService _dodgeBoxPx): when a watermark/caption region overlaps the crop,
//       the renderer SHRINKS the region height to exclude it (it does NOT merely move it) ⇒ higher upscale.
//   (2) FINAL-CROPPER (`crop._final` / fitCropInsideAspect): the post-render eye-fix may supply a SMALLER region than
//       faceRegionForSlot; its geometry does not exist at selection time.
//   Pass `hasShrinkTransformRisk: true` for any candidate where these may apply (e.g. triage.clean!==true /
//   watermark / large text / hasText) ⇒ heroCropUpscale() returns null (cannot bound) ⇒ NOT safe. Callers set it.
//
// REQUIRED INPUTS (any missing/invalid ⇒ null ⇒ caller treats as INSUFFICIENT, never "safe"):
//   faceBox : validated normalized {x1,y1,x2,y2} in [0,1], x2>x1, y2>y1 (the detected hero face, NOT the head box).
//   imgW,imgH : TRUSTED integer source pixel dims (realWidth/realHeight measured from the full image, not a thumb).
//   slotW,slotH : the REALIZED hero slot pixel geometry (integers) from the template.
//   hasShrinkTransformRisk? : true ⇒ a dodge/Final-Cropper SHRINK may apply ⇒ null (fail-closed). Default false.
// This is NOT the renderer (it never decodes pixels, never runs sharp); it estimates placeability from geometry only.
// ============================================================

// Renderer CONSTANTS — coverExecutorService.js imports these from here (one shared source ⇒ the constants stay in
// lockstep). Only the constants are shared; the region math below is a replicated estimator the renderer does NOT call.
export const HERO_CROP = Object.freeze({ faceFrac: 0.88, faceTopAt: 0.40, maxFaceHFrac: 0.74, minFaceHFrac: 0.60 });
export const FACE_PROM_CEILING = 1.6; // renderer's hard stretch ceiling for the prominence-tighten step
export const HERO_PROMINENCE = Object.freeze({ target: 0.42, cap: 0.50, trigMul: 0.6 }); // FACE_PROMINENCE.hero
export const HERO_STRETCH_MAX = 1.2;  // imageQualityConfig HERO_STRETCH_MAX (hero crop > 1.2× fails hard QC)

const _num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Compute the renderer's hero single-face crop region (width/height in source px) for the given face + slot, applying
// every size-shrinking step and omitting only the size-enlarging safety re-centre (see soundness note above).
// Returns { regionW, regionH } (numbers) or null when required inputs are missing/invalid.
export function heroCropRegion({ faceBox, imgW, imgH, slotW, slotH } = {}) {
  const iw = _num(imgW), ih = _num(imgH), sw = _num(slotW), sh = _num(slotH);
  if (!(iw > 0 && ih > 0 && sw > 0 && sh > 0)) return null;
  const fb = faceBox && typeof faceBox === 'object' ? faceBox : null;
  if (!fb) return null;
  const x1 = _num(fb.x1), y1 = _num(fb.y1), x2 = _num(fb.x2), y2 = _num(fb.y2);
  if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
  if (!(x1 >= 0 && y1 >= 0 && x2 <= 1.0001 && y2 <= 1.0001 && x2 > x1 && y2 > y1)) return null;

  const { faceFrac: F0, maxFaceHFrac: MAXH, minFaceHFrac: MINH } = HERO_CROP;
  const slotAspect = sw / sh;

  // ── head box (renderer faceRegionForSlot: ±0.20*fw ; hero topPad 0.42, bottom 0.32) ──
  const fwN = x2 - x1, fhN = y2 - y1;
  const hx1 = x1 - fwN * 0.20, hx2 = x2 + fwN * 0.20;
  const hy1 = y1 - fhN * 0.42, hy2 = y2 + fhN * 0.32;
  const headWpx = (hx2 - hx1) * iw;
  const headHpx = (hy2 - hy1) * ih;
  if (!(headWpx > 0 && headHpx > 0)) return null;
  const faceCxPx = ((hx1 + hx2) / 2) * iw;

  // top-edge zoom-out (renderer: face touching the very top ⇒ zoom out so the missing crown is proportionally small)
  const faceFrac = y1 < 0.06 ? F0 * 0.85 : F0;

  // ── base sizing + prominence min/max clamps (region keeps slot aspect) ──
  let regW = headWpx / faceFrac;
  let regH = regW / slotAspect;
  const minH = headHpx / MAXH;               // face <= maxFaceHFrac of region height ⇒ region >= minH
  if (regH < minH) { regH = minH; regW = regH * slotAspect; }
  const maxH = headHpx / MINH;               // face >= minFaceHFrac of region height ⇒ region <= maxH (SHRINK)
  if (regH > maxH) { regH = maxH; regW = regH * slotAspect; }
  // image clamp (region cannot exceed the source; this only reduces upscale)
  if (regW > iw) { regW = iw; regH = regW / slotAspect; }
  if (regH > ih) { regH = ih; regW = regH * slotAspect; }

  // ── off-centre zoom (renderer: face near a horizontal edge ⇒ shrink so the head stays fully framed) ──
  const maxHalfW = Math.min(faceCxPx, iw - faceCxPx);
  if (maxHalfW > 0 && regW / 2 > maxHalfW) {
    const zoomW = maxHalfW * 2, zoomH = zoomW / slotAspect;
    if (zoomW >= headWpx && zoomH >= headHpx) {
      regW = zoomW; regH = zoomH;             // centred zoom that still frames the head
    } else {
      const nW = Math.min(iw, Math.max(headWpx * 1.12, regW * 0.62)); // off-centre zoom (SHRINK)
      const nH = nW / slotAspect;
      if (nW < regW && nH >= headHpx * 1.06 && nH <= ih) { regW = nW; regH = nH; }
    }
  }

  // ── hero prominence-tightening (renderer _tightenForProminence, kind='hero', single face) ──
  //   measures the RAW face height share of the region; if the face is loose (< target*trigMul) it zooms IN toward
  //   `target`, but never shorter than max(slotH/1.6, headBox) ⇒ a further SHRINK (bounded by the 1.6 ceiling).
  const measureHpx = fhN * ih;               // raw face height (not head box) — renderer measureHN = fh
  const curShare = measureHpx / Math.max(1, regH);
  const target = HERO_PROMINENCE.target;
  if (curShare < target * HERO_PROMINENCE.trigMul) {
    const ceilingH = sh / FACE_PROM_CEILING;
    // tightening's own head box uses top 0.50 (renderer line ~398), distinct from the base 0.42
    const tTop = Math.max(0, y1 - fhN * 0.50), tBot = Math.min(1, y2 + fhN * 0.32);
    const tL = Math.max(0, x1 - fwN * 0.20), tR = Math.min(1, x2 + fwN * 0.20);
    const contentH = (tBot - tTop) * ih;
    const contentWoverA = ((tR - tL) * iw) / slotAspect;
    const floorH = Math.max(ceilingH, contentH, contentWoverA);
    const desiredH = measureHpx / target;
    const newH = Math.min(regH, Math.max(desiredH, floorH));
    if (newH < regH - 1) { const scale = newH / regH; regW = Math.max(8, regW * scale); regH = Math.max(8, newH); }
  }

  return { regionW: regW, regionH: regH };
}

// Conservative-upper-bound hero crop upscale. Returns a positive number, or null when inputs are insufficient OR a
// shrink transform (watermark dodge / Final-Cropper) may apply (caller MUST treat null as NOT-safe — never as safe).
export function heroCropUpscale(input) {
  if (input && input.hasShrinkTransformRisk === true) return null; // dodge/Final-Cropper SHRINK may apply ⇒ cannot bound
  const r = heroCropRegion(input);
  if (!r) return null;
  const sw = input.slotW, sh = input.slotH;
  return Math.max(sw / Math.max(1e-6, r.regionW), sh / Math.max(1e-6, r.regionH));
}

// Convenience predicate: is this hero candidate crop-safe for the slot at the hard 1.2× limit? Unknown ⇒ false.
export function isHeroCropSafe(input, limit = HERO_STRETCH_MAX) {
  const up = heroCropUpscale(input);
  return up !== null && up <= limit + 1e-9;
}

// ============================================================
// HZ (17 ก.ค.) — ★ฟังก์ชันนี้ RENDERER เรียกจริง★ (ต่างจาก heroCropRegion ข้างบนที่เป็น estimator ผู้เรนไม่เรียก)
// ------------------------------------------------------------
// "แรงดันฝั่งตรงข้าม" ของ floor guard เดิม: floor guard กันหน้า "ใหญ่เกินช่อง" แต่ไม่มีอะไรดัน "หน้าเล็กเกิน→ซูมเข้า"
//   (หลักฐานปกเก้า-วี: hero คนอยู่มุมล่าง หน้าเล็กไม่เด่น) — HZ อุดช่องนี้
// ใช้ในสาขา hero ของ coverExecutorService ใต้สวิตช์ MEGA_HERO_ZOOM (default ON · '0'=ข้าม=byte-parity เดิมทุก byte)
//   หลัง region หลักของ hero คำนวณเสร็จ (faceRegionForSlot + prominence-tighten):
//     วัด rawFaceShare = สูงหน้า(ดิบ)/สูง region — ถ้า < bandMinFrac → หด region (คง aspect, face-anchored)
//     จน faceShare = band-min หรือชน "เพดานซูม (floorH)" อันใดถึงก่อน
//
// เพดานซูม (floorH — region เตี้ยกว่านี้ไม่ได้) = MAX ของ:
//   • headHpx / maxFaceHFrac  → floor guard เดิมของ hero (หน้าไม่ใหญ่เกิน maxFaceHFrac ของกล่องหัว = คงกติกาเดิม)
//   • slotH / HERO_STRETCH_MAX → กันซูมจนยืดเกิน 1.2× (hero hard QC)
// ผลลัพธ์สำคัญ (พิสูจน์ byte-parity ฝั่งเสี่ยง): ถ้า region เดิม "ยืด ≥1.2× อยู่แล้ว" (regionH ≤ slotH/1.2) ⇒ floorH ≥ regionH
//   ⇒ newH = regionH ⇒ ไม่แตะเลย (HZ ไม่มีทางทำ upscale แย่ลง / ไม่แตะเคสที่เกิน 1.2 อยู่แล้ว)
// ไม่ตัดหน้า/หัว: region ใหม่ต้องคลุมกล่องหัว (topPad/bottom/หู เดิม) ครบ — คลุมไม่ครบ = ไม่ซูม (คืน region เดิม)
// ซูมเข้าเท่านั้น (newH ≤ region.height) — face-anchored กลางกล่องหัว + เผื่อ headroom เหนือหัวเล็กน้อย
//
// REQUIRED INPUTS (ขาด/ผิด = คืน region เดิม changed:false — ไม่ throw · ห้ามทำให้เรนเดอร์ล้ม):
//   region {left,top,width,height} px · faceBox raw {x1,y1,x2,y2} 0..1 (หน้าที่ region ยึด) · imgW,imgH px
//   slotAspect · slotH px · bandMinFrac (0..1 เช่น 0.30 = ขอบล่างของ TECH_RULES.HERO_FACE_SHARE) · maxFaceHFrac (เช่น 0.74)
// @returns {{ region, changed, faceSharePct, reason }}
export function zoomHeroRegionForFaceShare({
  region, faceBox, imgW, imgH, slotAspect, slotH, bandMinFrac, maxFaceHFrac,
  headPad = { top: 0.42, bottom: 0.32, x: 0.20 },
} = {}) {
  const iw = _num(imgW), ih = _num(imgH), sa = _num(slotAspect), sh = _num(slotH);
  const bmf = _num(bandMinFrac), mfh = _num(maxFaceHFrac);
  const R = region && typeof region === 'object' ? region : null;
  const fb = faceBox && typeof faceBox === 'object' ? faceBox : null;
  const _keep = (reason, share = null) => ({ region, changed: false, faceSharePct: share, reason });
  if (!R || !fb) return _keep('bad-input');
  const rL = _num(R.left), rT = _num(R.top), rW = _num(R.width), rH = _num(R.height);
  if (rL === null || rT === null || !(rW > 0) || !(rH > 0)) return _keep('bad-region');
  if (!(iw > 0 && ih > 0 && sa > 0 && sh > 0)) return _keep('bad-dims');
  if (!(bmf > 0 && bmf < 1)) return _keep('bad-band');
  if (!(mfh > 0 && mfh <= 1)) return _keep('bad-maxface');
  const x1 = _num(fb.x1), y1 = _num(fb.y1), x2 = _num(fb.x2), y2 = _num(fb.y2);
  if (x1 === null || y1 === null || x2 === null || y2 === null || !(x2 > x1 && y2 > y1)) return _keep('bad-face');

  const rawFaceHpx = (y2 - y1) * ih;
  if (!(rawFaceHpx > 0)) return _keep('no-face');
  const curShare = rawFaceHpx / rH;
  // เด่นพอแล้ว (≥ band-min) → ไม่แตะ (byte-parity)
  if (curShare >= bmf - 1e-9) return _keep('already-prominent', +(curShare * 100).toFixed(1));

  // กล่องหัว (รวมผม/คาง/หู) — ห้ามตัด (แพดเดียวกับ faceRegionForSlot สาขา hero)
  const fwN = x2 - x1, fhN = y2 - y1;
  const hMinX = (x1 - fwN * headPad.x) * iw, hMaxX = (x2 + fwN * headPad.x) * iw;
  const hMinY = (y1 - fhN * headPad.top) * ih, hMaxY = (y2 + fhN * headPad.bottom) * ih;
  const headWpx = hMaxX - hMinX, headHpx = hMaxY - hMinY;
  if (!(headWpx > 0 && headHpx > 0)) return _keep('bad-head', +(curShare * 100).toFixed(1));

  // เพดานซูม: floor guard เดิม ∪ เพดานยืด 1.2× (region เตี้ยกว่านี้ไม่ได้)
  const floorH = Math.max(headHpx / mfh, sh / HERO_STRETCH_MAX);
  const desiredH = rawFaceHpx / bmf;                 // region ที่ทำให้ faceShare = band-min พอดี
  const newH = Math.min(rH, Math.max(desiredH, floorH)); // ซูมเข้าเท่านั้น + ไม่ต่ำกว่า floor
  if (!(newH < rH - 0.5)) return _keep('at-floor', +(curShare * 100).toFixed(1)); // ชนเพดาน/ยืดเกินอยู่แล้ว = คงเดิม
  const newW = newH * sa;
  // region ต้องคลุมกล่องหัวครบทั้งกว้าง/สูง — เล็กกว่าหัว = ตัดหัว → ไม่ซูม (คืนเดิม)
  if (newW < headWpx - 0.5 || newH < headHpx - 0.5) return _keep('head-would-cut', +(curShare * 100).toFixed(1));

  // ตำแหน่ง: face-anchored กลางกล่องหัวแนวนอน + เผื่อ headroom เหนือหัว ~8%
  const hcx = (hMinX + hMaxX) / 2;
  let nl = hcx - newW / 2;
  let nt = hMinY - newH * 0.08;
  // คลุมกล่องหัวครบ (สำคัญกว่าจัดกึ่งกลาง — เลื่อนให้หัวอยู่ในกรอบ)
  if (nl > hMinX) nl = hMinX;
  if (nl + newW < hMaxX) nl = hMaxX - newW;
  if (nt > hMinY) nt = hMinY;
  if (nt + newH < hMaxY) nt = hMaxY - newH;
  // ไม่หลุดขอบภาพ
  nl = Math.min(Math.max(nl, 0), Math.max(0, iw - newW));
  nt = Math.min(Math.max(nt, 0), Math.max(0, ih - newH));

  // ปัดเศษเป็นพิกเซล + "พื้นชั้น (floor) บนค่าที่ปัดแล้ว" กันบั๊กปัดเศษดัน upscale เกิน 1.2:
  //   floorH เดิมค้ำ newH ≥ slotH/1.2 (ทศนิยม) แต่ Math.round อาจปัด "ลง" ต่ำกว่าเพดาน
  //   (เช่น 618.33→618 ⇒ 742/618 = 1.2007 · หรือแกนกว้าง 513.33→513 ⇒ 616/513 = 1.2008) → strict-V2 hero gate ตีตก
  //   ⇒ บังคับ "ค่าที่ปัดแล้ว" ให้ ≥ ceil(slot/1.2) ทั้งสองแกน: ceil(sa*sh/1.2)=ceil(slotW/1.2) · ceil(sh/1.2)=ceil(slotH/1.2)
  //   ⇒ slotW/out.width ≤ 1.2 และ slotH/out.height ≤ 1.2 เสมอ (ปัด "ขึ้น" = region ใหญ่ขึ้น → คลุมหัวปลอดภัยขึ้น + คง aspect ~เดิม)
  const wFloorInt = Math.ceil((sa * sh) / HERO_STRETCH_MAX); // = ceil(slotW / 1.2)
  const hFloorInt = Math.ceil(sh / HERO_STRETCH_MAX);        // = ceil(slotH / 1.2)
  const outW = Math.max(8, Math.round(newW), wFloorInt);
  const outH = Math.max(8, Math.round(newH), hFloorInt);
  let outL = Math.round(nl), outT = Math.round(nt);
  // ขยายเป็นจำนวนเต็มแล้วอาจล้นขอบภาพขวา/ล่าง → เลื่อนซ้าย/บนกลับเข้าใน (กรอบใหญ่ขึ้น = ยังคลุมหัวครบ)
  if (outL + outW > iw) outL = Math.max(0, iw - outW);
  if (outT + outH > ih) outT = Math.max(0, ih - outH);
  const out = { left: outL, top: outT, width: outW, height: outH };
  // re-verify หลังปัดเศษ (= ค่าที่เรนเดอร์จริง): กล่องหัวยังอยู่ในกรอบครบ ไม่ตัด — ไม่ครบ = ยกเลิก (คืนเดิม)
  const headIn = hMinX >= out.left - 1 && hMaxX <= out.left + out.width + 1
    && hMinY >= out.top - 1 && hMaxY <= out.top + out.height + 1;
  if (!headIn) return _keep('head-out-after-round', +(curShare * 100).toFixed(1));
  const changed = out.left !== R.left || out.top !== R.top || out.width !== R.width || out.height !== R.height;
  const newShare = rawFaceHpx / out.height;
  return { region: changed ? out : region, changed, faceSharePct: +(newShare * 100).toFixed(1), reason: changed ? 'zoomed' : 'unchanged' };
}

export default Object.freeze({ HERO_CROP, FACE_PROM_CEILING, HERO_PROMINENCE, HERO_STRETCH_MAX, heroCropRegion, heroCropUpscale, isHeroCropSafe, zoomHeroRegionForFaceShare });
