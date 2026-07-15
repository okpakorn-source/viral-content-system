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

export default Object.freeze({ HERO_CROP, FACE_PROM_CEILING, HERO_PROMINENCE, HERO_STRETCH_MAX, heroCropRegion, heroCropUpscale, isHeroCropSafe });
