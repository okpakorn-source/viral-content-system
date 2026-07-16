// ============================================================
// 📏 Ref Template Fidelity — วัด "เทมเพลตตรงกับภาพจริงแค่ไหน" เชิงพิกเซล (deterministic, ไม่มี AI)
// ------------------------------------------------------------
// บริบท: DNA ทุกใบใน ref-cover-library.json ถูก AI กะพิกัดช่องด้วย "ตา" ไม่มี ground truth
//   → เครื่องนี้เอา "ภาพปกจริง" มาตรวจว่า เส้นตะเข็บ/ขอบช่องจริง อยู่ตรงกับที่ template.slots บอกไหม
//
// นิยาม (ทุกอย่าง deterministic — ไม่มี random, ไม่เรียกโมเดลใดๆ, ใช้ sharp อ่านพิกเซลล้วน):
//   1) NORMALIZE: ย่อ/ยืดภาพให้เท่า canvas ของ template (canvasW×canvasH, fit:'fill') ด้วย interpolation ธรรมดา
//      → วัดทุกอย่างใน "canvas pixel space" หน่วยเดียวกับพิกัด slot (offsetPx จึงเทียบกันข้ามใบได้)
//      (รูปคลัง 4:5 อัตราส่วนตรงกับ canvas 1080×1350 อยู่แล้ว → fill = สเกลสม่ำเสมอ ไม่บิด)
//      ⚠️ resize เป็น interpolation ล้วนเพื่อ "อ่าน/วิเคราะห์" เท่านั้น — ไม่ได้เจน/แก้พิกเซลภาพจริง ไม่บันทึกภาพกลับ
//   2) BOUNDARIES: ดึง "เส้นขอบภายใน" จาก slot ทุกช่อง (ขอบที่ไม่ได้ชนขอบผืน)
//      - rect: ขอบซ้าย/ขวา = เส้นแนวตั้ง, ขอบบน/ล่าง = เส้นแนวนอน (ตัดขอบที่ชนขอบผืน 0/canvas ทิ้ง — ไม่มีตะเข็บให้จับ)
//      - เส้นที่ตำแหน่งเดียวกัน (ช่องข้างเคียงแชร์ตะเข็บเดียว) รวมเป็นเส้นเดียว (union ช่วง)
//      - circle: ตรวจขอบวงตาม 8 ทิศ (รัศมี r ที่คาด เทียบ radial edge จริง)
//   3) SEAM SCAN: ต่อ boundary หนึ่ง สแกนหน้าต่าง ±SEARCH_RADIUS px หาตำแหน่ง "ตะเข็บจริง"
//      - โปรไฟล์ boxcar-difference: ต่อตำแหน่งผู้สมัคร c เทียบ "แผ่นสีเฉลี่ยฝั่งหนึ่ง" กับ "อีกฝั่ง" ห่างกัน gap
//        diff(c) = mean_over_span | mean(pixels[c-gap..c-1]) − mean(pixels[c+1..c+gap]) |  (รวมทุกช่องสี, normalize 0..1)
//      - ตะเข็บคม (feather 0): diff พีคแหลมที่ตะเข็บพอดี
//      - ตะเข็บ feather (เบลอ): gap ตั้งให้ ≥ ความกว้าง feather → diff ขึ้นเป็น "ที่ราบสูง" คร่อมจุดกึ่งกลางตะเข็บ
//        → เอา centroid (ถ่วงน้ำหนักด้วย diff) ของช่วงที่ diff ≥ 0.6×พีค = จุดกึ่งกลางตะเข็บจริง (tolerate feather)
//      - offsetPx = |ตำแหน่งที่เจอ − ตำแหน่งที่ template บอก|  (canvas px)
//      - confidence(peak) = ค่าพีค normalize (0..1)
//      - 🔴 GATE 2 ชั้น (แก้บั๊ก false-positive จากพื้นผิว/นอยส์ — ผู้ตรวจ R1):
//        (ก) พีคสัมบูรณ์ ≥ MIN_CONFIDENCE = "มีสัญญาณบ้าง" (กันภาพสีเดียวพีค≈0)
//        (ข) prominence = (peak − baseline)/peak ≥ MIN_PROMINENCE  โดย baseline = median ของโปรไฟล์
//            → นอยส์/พื้นผิวสร้างโปรไฟล์ "แบน" (พีคแทบไม่โผล่เหนือ baseline) prominence ต่ำ = ปฏิเสธ
//            (พีคสัมบูรณ์ของนอยส์ ~0.082–0.089 "ผ่าน" ชั้น (ก) ได้ แต่ตกชั้น (ข) เพราะโปรไฟล์แบน)
//            ตะเข็บจริง (คม/feather-plateau): baseline≈0 (นอกตะเข็บสีเรียบ) prominence≈1 → ผ่าน
//      - 🔴 กัน centroid-centering artifact: ถ้าโปรไฟล์แบน (prominence < MIN_PROMINENCE) ไม่คำนวณ centroid
//        (plateau แบนคร่อม ±SEARCH_RADIUS สมมาตร → centroid ตกกลางหน้าต่าง = expected เสมอ → offset≈0 หลอก)
//        → คืน low-confidence + offset=SEARCH_RADIUS ("หาไม่เจอ") แทน offset≈0 ที่มั่ว
//   4) SCORE: ต่อ boundary ที่มั่นใจ → effOffset = max(0, offsetPx − featherTol) (ยอมคลาดเท่ากว้าง feather ครึ่งหนึ่ง)
//        boundaryScore = 100 × max(0, 1 − effOffset/SEARCH_RADIUS)
//      fidelity.score = ค่าเฉลี่ย boundaryScore ของเส้นที่มั่นใจ (ปัดจำนวนเต็ม); ไม่มีเส้นมั่นใจเลย → score = null (ไม่มั่ว)
//      🔴 rawScore = คะแนนจาก offset ดิบ (ไม่หัก featherTol) แนบคู่ score เสมอ + สงวนเลข 100 ให้ "ตรงเป๊ะพิกเซล" จริง:
//        ถ้า feather ยกให้ score=100 ทั้งที่ offset ดิบ > 0 → cap score=99 (100 ต้อง rawScore=100 ด้วย)
// ============================================================

import sharp from 'sharp';

export const FIDELITY_ENGINE_VERSION = 'rtf-1.0.0';

// ---- ค่าคงที่จูนได้ (deterministic ทั้งหมด) -------------------------------------
const SEARCH_RADIUS = 40; // สแกนหาตะเข็บจริง ±40 px รอบตำแหน่งที่ template บอก (canvas px)
const EDGE_EPS = 3;       // ขอบ slot ห่างขอบผืน ≤3px = ถือว่าชนขอบผืน (ไม่มีตะเข็บภายใน) → ข้าม
const MERGE_TOL = 6;      // เส้นขอบห่างกัน ≤6px + ช่วงทับกัน = ตะเข็บเดียวกัน → รวม
const SPAN_INSET = 0.08;  // ตัดหัว/ท้ายช่วงเส้นข้างละ 8% (เลี่ยงมุม/ตะเข็บตั้งฉากมากวน)
const SAMPLE_STEP = 2;    // สุ่มตามแนวเส้นทุก 2px (คงที่ = deterministic)
const MIN_SAMPLES = 5;    // อย่างน้อย 5 จุดตามแนวเส้น
const PLATEAU_FRAC = 0.6; // centroid เอาเฉพาะช่วงที่ diff ≥ 0.6×พีค
const MIN_CONFIDENCE = 0.06; // ชั้น (ก): พีค normalize < 0.06 (~15/255 ต่อช่อง) = แทบไม่มีสัญญาณ (สีเดียว) → low-confidence
// ชั้น (ข): prominence = (peak − medianBaseline)/peak — วัดว่าพีค "โผล่" เหนือพื้นโปรไฟล์แค่ไหน
//   นอยส์/พื้นผิวสม่ำเสมอ → โปรไฟล์แบน pk≈baseline → prominence→0 (ถึงพีคสัมบูรณ์จะเกิน MIN_CONFIDENCE)
//   ตะเข็บจริง (คม/feather) → นอกตะเข็บ diff≈0 baseline≈0 → prominence→1
//   จูนจากการวัดจริง (calib): นอยส์ล้วน prom≈0.06 (พีคสัมบูรณ์ 0.148 ยัง "ผ่าน" MIN_CONFIDENCE!),
//     gradient ไม่มีตะเข็บ prom≈0.33, ตะเข็บสังเคราะห์คม/feather prom≈0.85–1.0, ตะเข็บคลังจริง prom≥~0.46
//   → เกต 0.45: สูงกว่าพื้น gradient (0.33) มีกันชน + ตรงช่องว่างธรรมชาติของ distribution คลังจริง
const MIN_PROMINENCE = 0.45;
const CIRCLE_DIRS = 8;    // ตรวจขอบวง 8 ทิศ

const clampInt = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v) | 0;

// อ่านพิกเซล (x,y) ช่อง c จาก raw buffer แบบ clamp ขอบ (ไม่หลุด array)
function px(buf, W, H, ch, x, y, c) {
  const xi = clampInt(Math.round(x), 0, W - 1);
  const yi = clampInt(Math.round(y), 0, H - 1);
  return buf[(yi * W + xi) * ch + c];
}

// ผลต่างสีเฉลี่ยของ "แผ่นฝั่ง A" vs "แผ่นฝั่ง B" ที่จุด (คืน 0..1)
// dir=0 → แนวตั้ง (แผ่นซ้าย/ขวาของ x=c), dir=1 → แนวนอน (แผ่นบน/ล่างของ y=c)
function boxcarDiffAt(buf, W, H, ch, dir, coord, along, gap) {
  let sum = 0;
  const nc = Math.min(ch, 3);
  for (let c = 0; c < nc; c++) {
    let a = 0, b = 0;
    for (let g = 1; g <= gap; g++) {
      if (dir === 0) { a += px(buf, W, H, ch, coord - g, along, c); b += px(buf, W, H, ch, coord + g, along, c); }
      else { a += px(buf, W, H, ch, along, coord - g, c); b += px(buf, W, H, ch, along, coord + g, c); }
    }
    sum += Math.abs(a - b) / gap;
  }
  return sum / (nc * 255);
}

// baseline = median ของค่าโปรไฟล์ (robust ต่อพีค/plateau เฉพาะจุด) → prominence = (peak−baseline)/peak
// นอยส์/พื้นผิวแบน: baseline≈peak → prominence≈0 · ตะเข็บจริง: baseline≈0 → prominence≈1
function profileProminence(values, peak) {
  if (peak <= 0 || values.length === 0) return { baseline: 0, prominence: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const baseline = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { baseline, prominence: (peak - baseline) / peak };
}

// สแกนหาตะเข็บตามแนว dir รอบ expected coord ในช่วง along∈[a0,a1]
// คืน { offsetPx, confidence, prominence, foundCoord }
function scanBoundary(buf, W, H, ch, dir, expected, a0, a1, gap) {
  const dimAlong = dir === 0 ? H : W;
  const lo = clampInt(a0 + (a1 - a0) * SPAN_INSET, 0, dimAlong - 1);
  const hi = clampInt(a1 - (a1 - a0) * SPAN_INSET, 0, dimAlong - 1);
  const alongs = [];
  for (let a = lo; a <= hi; a += SAMPLE_STEP) alongs.push(a);
  while (alongs.length < MIN_SAMPLES && hi > lo) { alongs.push(clampInt(lo + (hi - lo) * (alongs.length / MIN_SAMPLES), 0, dimAlong - 1)); }
  if (alongs.length === 0) return { offsetPx: SEARCH_RADIUS, confidence: 0, prominence: 0, foundCoord: expected };

  const dimPerp = dir === 0 ? W : H;
  const cLo = clampInt(expected - SEARCH_RADIUS, gap, dimPerp - 1 - gap);
  const cHi = clampInt(expected + SEARCH_RADIUS, gap, dimPerp - 1 - gap);
  if (cHi <= cLo) return { offsetPx: SEARCH_RADIUS, confidence: 0, prominence: 0, foundCoord: expected };

  const profile = [];
  let peak = 0;
  for (let c = cLo; c <= cHi; c++) {
    let acc = 0;
    for (const a of alongs) acc += boxcarDiffAt(buf, W, H, ch, dir, c, a, gap);
    const v = acc / alongs.length;
    profile.push({ c, v });
    if (v > peak) peak = v;
  }
  if (peak <= 0) return { offsetPx: SEARCH_RADIUS, confidence: 0, prominence: 0, foundCoord: expected };

  // GATE ชั้น (ข): prominence — พีคต้อง "โผล่" เหนือ baseline (median) พอ ไม่งั้นคือโปรไฟล์แบน (นอยส์/พื้นผิว)
  const { prominence } = profileProminence(profile.map((p) => p.v), peak);
  // 🔴 กัน centroid-centering artifact: โปรไฟล์แบน → centroid ตกกลางหน้าต่าง = expected เสมอ (offset≈0 หลอก)
  //    → ไม่คำนวณ centroid, คืน "หาไม่เจอ" (offset=SEARCH_RADIUS) + prominence ต่ำ (ผู้เรียก mark low-confidence)
  if (prominence < MIN_PROMINENCE) {
    return { offsetPx: SEARCH_RADIUS, confidence: peak, prominence, foundCoord: expected };
  }

  // centroid ของช่วงที่ diff ≥ 0.6×พีค (จุดกึ่งกลางตะเข็บจริง — tolerate feather/ที่ราบสูง)
  const thr = PLATEAU_FRAC * peak;
  let wsum = 0, num = 0;
  for (const p of profile) { if (p.v >= thr) { wsum += p.v; num += p.v * p.c; } }
  const foundCoord = wsum > 0 ? num / wsum : expected;
  return { offsetPx: Math.abs(foundCoord - expected), confidence: peak, prominence, foundCoord };
}

// สแกนขอบวงกลมตามทิศ (unit dx,dy) รอบรัศมี r → { offsetPx, confidence, prominence }
function scanCircleRay(buf, W, H, ch, cx, cy, r, dx, dy, gap) {
  const rLo = Math.max(gap + 1, r - SEARCH_RADIUS);
  const rHi = r + SEARCH_RADIUS;
  const nc = Math.min(ch, 3);
  let peak = 0;
  const profile = [];
  for (let rr = rLo; rr <= rHi; rr++) {
    let sum = 0;
    for (let c = 0; c < nc; c++) {
      const inner = px(buf, W, H, ch, cx + (rr - gap) * dx, cy + (rr - gap) * dy, c);
      const outer = px(buf, W, H, ch, cx + (rr + gap) * dx, cy + (rr + gap) * dy, c);
      sum += Math.abs(inner - outer);
    }
    const v = sum / (nc * 255);
    profile.push({ c: rr, v });
    if (v > peak) peak = v;
  }
  if (peak <= 0) return { offsetPx: SEARCH_RADIUS, confidence: 0, prominence: 0, foundR: null };
  // GATE ชั้น (ข) + กัน centroid-centering: โปรไฟล์รัศมีแบน (พื้นผิว) → ไม่เชื่อ centroid
  const { prominence } = profileProminence(profile.map((p) => p.v), peak);
  if (prominence < MIN_PROMINENCE) {
    // foundR=null = "ไม่เจอขอบวงทิศนี้" → ผู้กู้ข้ามทิศนี้ (ไม่ปนจุดมั่วเข้า fit)
    return { offsetPx: SEARCH_RADIUS, confidence: peak, prominence, foundR: null };
  }
  const thr = PLATEAU_FRAC * peak;
  let wsum = 0, num = 0;
  for (const p of profile) { if (p.v >= thr) { wsum += p.v; num += p.v * p.c; } }
  const foundR = wsum > 0 ? num / wsum : r;
  // 🔴 R5a additive: foundR = "รัศมีจริงที่วัดเจอ" (canvas px) — ผู้กู้ (refTemplateRehab) ใช้ fit วงใหม่
  return { offsetPx: Math.abs(foundR - r), confidence: peak, prominence, foundR };
}

// ดึงเส้นขอบภายในจาก slots (dedupe เส้นตำแหน่งเดียวกัน) + วงกลม
function collectBoundaries(slots, W, H) {
  const verts = []; // {coord, a0, a1, slotId}
  const horis = [];
  const circles = [];
  for (const s of slots) {
    if (!s) continue;
    if (s.shape === 'circle') {
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2, r = (s.w + s.h) / 4;
      circles.push({ slotId: s.id, cx, cy, r });
      continue;
    }
    const x1 = s.x, x2 = s.x + s.w, y1 = s.y, y2 = s.y + s.h;
    if (x1 > EDGE_EPS && x1 < W - EDGE_EPS) verts.push({ coord: x1, a0: y1, a1: y2, slotId: s.id });
    if (x2 > EDGE_EPS && x2 < W - EDGE_EPS) verts.push({ coord: x2, a0: y1, a1: y2, slotId: s.id });
    if (y1 > EDGE_EPS && y1 < H - EDGE_EPS) horis.push({ coord: y1, a0: x1, a1: x2, slotId: s.id });
    if (y2 > EDGE_EPS && y2 < H - EDGE_EPS) horis.push({ coord: y2, a0: x1, a1: x2, slotId: s.id });
  }
  return { verts: mergeLines(verts), horis: mergeLines(horis), circles };
}

// รวมเส้นที่ coord ใกล้กัน (≤MERGE_TOL) และช่วง [a0,a1] ทับกัน = ตะเข็บเดียว → union ช่วง
function mergeLines(lines) {
  const sorted = [...lines].sort((p, q) => p.coord - q.coord || p.a0 - q.a0);
  const out = [];
  for (const ln of sorted) {
    const m = out.find((o) => Math.abs(o.coord - ln.coord) <= MERGE_TOL && ln.a0 <= o.a1 && ln.a1 >= o.a0);
    if (m) {
      // ถ่วง coord ตามจำนวนที่รวม, ขยายช่วงเป็น union
      m.coord = (m.coord * m.n + ln.coord) / (m.n + 1);
      m.n += 1;
      m.a0 = Math.min(m.a0, ln.a0);
      m.a1 = Math.max(m.a1, ln.a1);
      m.slotIds.push(ln.slotId);
    } else {
      out.push({ coord: ln.coord, a0: ln.a0, a1: ln.a1, n: 1, slotIds: [ln.slotId] });
    }
  }
  return out;
}

/**
 * measureTemplateFidelity — วัดว่า template ตรงกับภาพจริงเชิงพิกเซลแค่ไหน (PURE, ไม่มี AI)
 * @param {Object} args
 * @param {Buffer} args.imageBuffer  ภาพปกจริง (jpg/png buffer)
 * @param {Object} args.templateSpec ผลจาก dnaToTemplateSpec: { canvasW, canvasH, feather, slots:[{id,x,y,w,h,shape?}] } (พิกัด px)
 * @returns {Promise<Object>} { engineVersion, canvasW, canvasH, score|null, worstOffsetPx|null, meanOffsetPx|null,
 *                              confidence:'ok'|'low', confidentBoundaries, lowConfidenceBoundaries, boundaries:[...] }
 */
export async function measureTemplateFidelity({ imageBuffer, templateSpec }) {
  if (!imageBuffer || !templateSpec || !Array.isArray(templateSpec.slots)) {
    throw new Error('measureTemplateFidelity: ต้องมี imageBuffer และ templateSpec.slots');
  }
  const W = Math.round(templateSpec.canvasW || 1080);
  const H = Math.round(templateSpec.canvasH || 1350);
  const feather = Math.max(0, Number(templateSpec.feather) || 0);
  // gap ของ boxcar = ให้ ≥ ความกว้าง feather (ตะเข็บ feather กว้าง ~2×featherPx) → พีคเป็นที่ราบสูงคร่อมกึ่งกลาง
  const gap = clampInt(Math.round(feather) + 3, 3, 30);
  const featherTol = feather * 0.5; // ยอมคลาดในเนื้อ feather (canvas px)

  // NORMALIZE ภาพ → canvas space (interpolation ล้วน เพื่ออ่านพิกเซล ไม่ใช่เจนภาพ)
  const { data, info } = await sharp(imageBuffer)
    .resize(W, H, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;

  const { verts, horis, circles } = collectBoundaries(templateSpec.slots, W, H);
  const boundaries = [];

  for (const v of verts) {
    const r = scanBoundary(data, W, H, ch, 0, Math.round(v.coord), v.a0, v.a1, gap);
    // 🔴 R5a additive: foundCoord = ตำแหน่งตะเข็บจริง (canvas px) — ผู้กู้เลื่อนขอบช่องไปหาค่านี้
    boundaries.push({ slotIds: v.slotIds, type: 'v', coord: Math.round(v.coord), foundCoord: round1(r.foundCoord), offsetPx: round1(r.offsetPx), confidence: round3(r.confidence), prominence: round3(r.prominence), lowConfidence: r.confidence < MIN_CONFIDENCE || r.prominence < MIN_PROMINENCE });
  }
  for (const h of horis) {
    const r = scanBoundary(data, W, H, ch, 1, Math.round(h.coord), h.a0, h.a1, gap);
    boundaries.push({ slotIds: h.slotIds, type: 'h', coord: Math.round(h.coord), foundCoord: round1(r.foundCoord), offsetPx: round1(r.offsetPx), confidence: round3(r.confidence), prominence: round3(r.prominence), lowConfidence: r.confidence < MIN_CONFIDENCE || r.prominence < MIN_PROMINENCE });
  }
  for (const cir of circles) {
    const dirs = [];
    let pkSum = 0, promSum = 0, offMax = 0, offSum = 0;
    for (let k = 0; k < CIRCLE_DIRS; k++) {
      const ang = (2 * Math.PI * k) / CIRCLE_DIRS;
      const rr = scanCircleRay(data, W, H, ch, cir.cx, cir.cy, cir.r, Math.cos(ang), Math.sin(ang), gap);
      // 🔴 R5a additive: foundR = รัศมีจริงทิศนี้ (null = หาขอบไม่เจอ) + unit dx/dy สำหรับ fit วงใหม่
      dirs.push({ angleDeg: Math.round((ang * 180) / Math.PI), dx: round3(Math.cos(ang)), dy: round3(Math.sin(ang)), offsetPx: round1(rr.offsetPx), foundR: rr.foundR == null ? null : round1(rr.foundR), confidence: round3(rr.confidence), prominence: round3(rr.prominence) });
      pkSum += rr.confidence; promSum += rr.prominence; offSum += rr.offsetPx; if (rr.offsetPx > offMax) offMax = rr.offsetPx;
    }
    const meanPk = pkSum / CIRCLE_DIRS;
    const meanProm = promSum / CIRCLE_DIRS;
    boundaries.push({ slotIds: [cir.slotId], type: 'circle', coord: null, offsetPx: round1(offSum / CIRCLE_DIRS), worstDirOffsetPx: round1(offMax), confidence: round3(meanPk), prominence: round3(meanProm), lowConfidence: meanPk < MIN_CONFIDENCE || meanProm < MIN_PROMINENCE, directions: dirs });
  }

  // สรุปคะแนน — ใช้เฉพาะเส้นที่มั่นใจ
  const conf = boundaries.filter((b) => !b.lowConfidence);
  const low = boundaries.length - conf.length;
  if (conf.length === 0) {
    return {
      engineVersion: FIDELITY_ENGINE_VERSION, canvasW: W, canvasH: H,
      score: null, rawScore: null, featherPx: round1(feather), worstOffsetPx: null, meanOffsetPx: null,
      confidence: 'low', confidentBoundaries: 0, lowConfidenceBoundaries: low, boundaries,
    };
  }
  let scoreSum = 0, rawScoreSum = 0, worst = 0, offSum = 0;
  for (const b of conf) {
    const eff = Math.max(0, b.offsetPx - featherTol);
    scoreSum += 100 * Math.max(0, 1 - eff / SEARCH_RADIUS);
    rawScoreSum += 100 * Math.max(0, 1 - b.offsetPx / SEARCH_RADIUS); // ดิบ: ไม่หัก featherTol
    offSum += b.offsetPx;
    if (b.offsetPx > worst) worst = b.offsetPx;
  }
  let score = Math.round(scoreSum / conf.length);
  const rawScore = Math.round(rawScoreSum / conf.length);
  // 🔴 สงวนเลข 100 ให้ "ตรงเป๊ะพิกเซล" จริง: feather tolerance อาจยก score→100 ทั้งที่ offset ดิบยังมี
  //    → cap 99 เพื่อไม่ให้อ่านเลขเต็มว่าเป๊ะพิกเซล (offset ดิบจริงดูได้ที่ worstOffsetPx/meanOffsetPx/rawScore)
  if (score === 100 && rawScore < 100) score = 99;
  return {
    engineVersion: FIDELITY_ENGINE_VERSION, canvasW: W, canvasH: H,
    score,
    rawScore,
    featherPx: round1(feather),
    worstOffsetPx: round1(worst),
    meanOffsetPx: round1(offSum / conf.length),
    confidence: 'ok',
    confidentBoundaries: conf.length,
    lowConfidenceBoundaries: low,
    boundaries,
  };
}

const round1 = (v) => Math.round(v * 10) / 10;
const round3 = (v) => Math.round(v * 1000) / 1000;
