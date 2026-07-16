// ============================================================
// 🧬 refTemplateVariants (R5b) — กลั่น "โครงลูก" จากใบแม่ ref ที่พิกัดเชื่อถือได้แล้ว (เกรด A/B)
// ------------------------------------------------------------
// คำสั่งเจ้าของ (R5b): "วิจัยหาโครงสวยๆ และโครงที่ทำให้การจัดรูปลงสวยกว่าเดิม แต่ใช้ ref เดิม
//   เป็นต้นแบบเพราะมันเคยปังมาทั้งนั้น" → เราไม่ประดิษฐ์โครงใหม่จากศูนย์ แต่ derive จากใบปังที่
//   ตะเข็บถูกวัด/กู้จนตรงจริงแล้ว (R5a) ด้วยการแปลงเรขาคณิตล้วน — deterministic 100%
//
// 🔴 PURE + deterministic: ไม่มี AI / network / random / env / IO. ผลลัพธ์ = ฟังก์ชันของ input ล้วน
//    (variant geometry มาจากพิกัดแม่ + สูตรคณิต — ไม่มีการ "วาด/สังเคราะห์" อะไรทั้งสิ้น).
//    imagePath ของ variant ชี้ภาพแม่เป็น "หลักฐานที่มา (provenance)" เท่านั้น — ไม่ใช่หลักฐานว่าวัดกับ
//    ภาพจริงแล้ว → variant จึง "ไม่มี _fidelity" และเกรดถูกเพดานลดหนึ่งขั้น (ดู refCoverGrade เส้น derived).
//
// วิธีกลั่น 3 แบบ (แต่ละแบบอธิบายเหตุผลเชิงการจัดรูป):
//   (ก) mirror-horizontal — สลับซ้าย↔ขวาทั้งโครง. เหตุผลจัดรูป: ปกจริงบางข่าว "ฮีโร่อยู่ขวา" อ่านลื่นกว่า
//        (ตัวเอกฝั่งที่สายตาไทยกวาดไปจบ) โดยองค์ประกอบ/สัดส่วนเดิมที่เคยปังไม่เสีย — เป็นสมมาตรกระจก.
//   (ข) panel-reduce — ใบแม่ช่องเยอะ → ตัดช่อง rect รอง "เล็กสุด" (ห้ามแตะ hero/circle) แล้วให้ช่องข้างเคียง
//        ที่แชร์ตะเข็บยาวสุดขยายเข้าปิดเต็ม. เหตุผลจัดรูป: รูปต่อใบน้อยลง = หาภาพคุณภาพครบง่ายขึ้น + แต่ละช่อง
//        ใหญ่ขึ้น หน้าคนคมขึ้น (คอลลาจแน่นเกินไปมักได้ภาพเล็กจนครอปหน้าไม่พอ).
//   (ค) crop-safe-boost — ขยับตะเข็บเล็กน้อย (≤4% ต่อขอบ) ดันช่องที่ "เกือบหลุดเกณฑ์ครอป" ให้ผ่าน:
//        hero ด้านสั้น ≥700px + ช่องรองด้านสั้น ≥22%. เหตุผลจัดรูป: ช่องที่จิ๋วเกินไปครอปหน้าคนไม่ได้/ต้อง
//        ยืดภาพ → boost ให้พอดีเกณฑ์โดยไม่ทำโครงเสียทรง. ทำเฉพาะเมื่อ "ทุกช่องที่ fail แก้ได้ใน 4%" เท่านั้น
//        (ไม่งั้นข้าม — โครงที่ช่องหลุดไกลไม่ใช่งานของ boost).
//
// ทุก variant ต้องผ่าน: dnaToTemplateSpec (วางช่องได้จริง) + sane (ในเฟรม/ไม่จิ๋ว/IoU ไม่แย่กว่าแม่)
//   + dedupe (ไม่ซ้ำแม่/ไม่ซ้ำ variant อื่น เทียบพิกัดปัด 0.5%) ไม่งั้นทิ้ง variant นั้น.
// ============================================================

import { dnaToTemplateSpec } from './refTemplate.js';
import { posFromGeometry, syncDnaSlotsToTemplate } from './refCoverLibrary.js';
import { computeTemplateGrade } from './refCoverGrade.js';

export const VARIANTS_ENGINE_VERSION = 'ref-variants-r5b-v1';

// ── เกณฑ์ครอป (export ให้เทสอ้างเลขเดียวกัน) ─────────────────────────────────
export const CANVAS_W = 1080;
export const CANVAS_H = 1350;
export const HERO_MIN_SHORT_PX = 700;      // hero ด้านสั้น ≥ 700px จึงครอปหน้าฮีโร่คมพอ
export const SECONDARY_MIN_SHORT_PCT = 22; // ช่องรองด้านสั้น ≥ 22% ของผืน
export const MAX_EDGE_NUDGE_PCT = 4;       // crop-boost ขยับได้ ≤4% ต่อขอบ
const SEAM_TOL_PCT = 1.5;                  // ระยะที่ถือว่า "ตะเข็บเดียวกัน"
const MIN_SLOT_PCT = 8;                    // ช่องต่ำกว่านี้ = จิ๋วเกิน (สอดคล้อง clamp ใน dnaToTemplateSpec)
const DEDUPE_ROUND = 2;                    // ปัดพิกัดเป็นทวีคูณ 0.5% ก่อนเทียบซ้ำ (round(v*2)/2)

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round4 = (v) => Math.round(v * 1e4) / 1e4;
const near = (a, b) => Math.abs(a - b) <= SEAM_TOL_PCT;
const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
const toRect = (s) => {
  const x = num(s.xPct), y = num(s.yPct), w = num(s.wPct), h = num(s.hPct);
  return { x1: x, y1: y, x2: x + w, y2: y + h };
};
const areaOf = (s) => num(s.wPct) * num(s.hPct);
const isCircle = (s) => s?.shape === 'circle';

// ช่อง hero = role /hero/i ตัวแรก ไม่งั้น rect ที่ใหญ่สุด (สอดคล้อง dnaToTemplateSpec ที่เลือก main แบบเดียวกัน)
function pickHeroIndex(slots) {
  const rects = slots.map((s, i) => ({ s, i })).filter((o) => !isCircle(o.s));
  const byRole = rects.find((o) => /hero/i.test(String(o.s.role || '')));
  if (byRole) return byRole.i;
  const largest = rects.slice().sort((a, b) => areaOf(b.s) - areaOf(a.s))[0];
  return largest ? largest.i : -1;
}

// เขียนขอบ (edges %) กลับเป็นช่อง slot ใหม่ (คงทุก field เดิม override เฉพาะ geometry + pos จาก geometry)
function slotFromEdges(orig, e) {
  const g = {
    ...orig,
    xPct: round4(e.x1), yPct: round4(e.y1),
    wPct: round4(e.x2 - e.x1), hPct: round4(e.y2 - e.y1),
  };
  const pos = posFromGeometry(g);
  if (pos) g.pos = pos; else delete g.pos;
  return g;
}

// ── (ก) mirror-horizontal ────────────────────────────────────────────────────
// สมมาตรกระจกแนวตั้ง: x' = 100 − x − w (คงจุดสมมาตรที่กึ่งกลางผืน). y/w/h เดิม. pos คำนวณใหม่จาก geometry
//   → ป้ายไทยสลับข้างเอง (ซ้าย↔ขวา) ตามคำสั่ง R5b. ใช้ posFromGeometry (R2) เป็นผู้ตัดสิน.
// สมบัติ: mirror สองครั้ง = geometry เดิม (สมมาตรแท้ — เทสยืน).
export function mirrorHorizontal(slots) {
  return slots.map((s) => {
    const x = num(s.xPct), w = num(s.wPct);
    return slotFromEdges(s, { x1: 100 - x - w, y1: num(s.yPct), x2: 100 - x, y2: num(s.yPct) + num(s.hPct) });
  });
}

// ── (ข) panel-reduce ─────────────────────────────────────────────────────────
// ตัดช่อง rect "รอง" ที่พื้นที่เล็กสุด (ยกเว้น hero/circle) → ให้ช่องข้างเคียงที่แชร์ตะเข็บ "ยาวสุด"
//   ขยายเข้าปิดพื้นที่ที่ว่าง. deterministic: เรียงตามความยาวตะเข็บที่แชร์ (ยาวสุดได้พื้นที่) tiebreak index น้อยสุด.
// เงื่อนไขที่ absorb ได้แบบ "ไม่ทับ/ไม่โหว่": เพื่อนบ้าน N ต้องครอบช่วง (span) ของช่องที่ตัดเต็มด้านที่ติดกัน
//   → ขยาย N ทับพื้นที่ช่องที่ตัดพอดี ยังเป็นสี่เหลี่ยม ปิดผืนเท่าเดิม. หา N ไม่ได้ → คืน null (ทิ้ง variant).
export function panelReduce(slots) {
  const rects = slots.map((s, i) => ({ s, i })).filter((o) => !isCircle(o.s));
  if (rects.length < 3) return null; // ตัด 1 แล้วต้องเหลือ rect ≥2 (คอลลาจขั้นต่ำ)
  const heroI = pickHeroIndex(slots);
  const secondaries = rects.filter((o) => o.i !== heroI);
  if (secondaries.length < 2) return null;

  // ช่องรองเล็กสุด (พื้นที่ %) → tiebreak index
  const target = secondaries.slice().sort((a, b) => (areaOf(a.s) - areaOf(b.s)) || (a.i - b.i))[0];
  const R = toRect(target.s);

  // เพื่อนบ้านที่ absorb ได้ (ครอบ span เต็มด้านที่ติดกัน) — เก็บความยาวตะเข็บ + วิธีขยาย
  const cand = [];
  for (const o of rects) {
    if (o.i === target.i) continue;
    const N = toRect(o.s);
    const spansX = N.x1 <= R.x1 + SEAM_TOL_PCT && N.x2 >= R.x2 - SEAM_TOL_PCT; // N ครอบช่วง x ของ R
    const spansY = N.y1 <= R.y1 + SEAM_TOL_PCT && N.y2 >= R.y2 - SEAM_TOL_PCT; // N ครอบช่วง y ของ R
    const sides = [
      { ok: near(N.y2, R.y1) && spansX, len: overlap(N.x1, N.x2, R.x1, R.x2), apply: (e) => { e.y2 = R.y2; } }, // N อยู่บน R → ขยายลง
      { ok: near(N.y1, R.y2) && spansX, len: overlap(N.x1, N.x2, R.x1, R.x2), apply: (e) => { e.y1 = R.y1; } }, // N อยู่ล่าง R → ขยายขึ้น
      { ok: near(N.x2, R.x1) && spansY, len: overlap(N.y1, N.y2, R.y1, R.y2), apply: (e) => { e.x2 = R.x2; } }, // N อยู่ซ้าย R → ขยายขวา
      { ok: near(N.x1, R.x2) && spansY, len: overlap(N.y1, N.y2, R.y1, R.y2), apply: (e) => { e.x1 = R.x1; } }, // N อยู่ขวา R → ขยายซ้าย
    ];
    for (const sd of sides) if (sd.ok && sd.len > 1) cand.push({ i: o.i, len: sd.len, apply: sd.apply });
  }
  if (!cand.length) return null;
  cand.sort((a, b) => (b.len - a.len) || (a.i - b.i));
  const pick = cand[0];

  const out = [];
  for (let i = 0; i < slots.length; i++) {
    if (i === target.i) continue; // ตัดช่องรองเล็กสุด
    if (i === pick.i) {
      const e = toRect(slots[i]);
      pick.apply(e);
      out.push(slotFromEdges(slots[i], e));
    } else {
      out.push({ ...slots[i] });
    }
  }
  return out;
}

// ── (ค) crop-safe-boost ──────────────────────────────────────────────────────
// ดันช่อง rect ที่ "เกือบหลุดเกณฑ์ครอป" ให้ผ่าน โดยเลื่อน "ตะเข็บที่แชร์" ≤4% (ช่องเพื่อนบ้านหดตาม =
//   ปิดผืนเท่าเดิม ไม่มีร่อง). ทำได้เฉพาะเมื่อ "ทุกช่องที่ fail แก้ได้ภายใน 4% ต่อขอบ และเพื่อนบ้านที่หด
//   ยังผ่านเกณฑ์" — ไม่งั้นคืน null (ข้าม). ถ้าไม่มีช่อง fail เลย → null (ไม่มีอะไรให้ boost).
// ⚠️ หมายเหตุตรงไปตรงมา: dnaToTemplateSpec คลัสเตอร์เส้น 6% ตอน render จริง อาจกลืน nudge <6% ไปบางส่วน —
//   แต่ค่าที่บันทึกใน template.slots (raw) จะ "พอดีเกณฑ์" ไว้ (ได้ประโยชน์เต็มเมื่อ pipeline ผ่อน clustering).
function cropPass(e, isHero) {
  const w = e.x2 - e.x1, h = e.y2 - e.y1;
  if (isHero) return Math.min((w / 100) * CANVAS_W, (h / 100) * CANVAS_H) >= HERO_MIN_SHORT_PX - 1e-6;
  return Math.min(w, h) >= SECONDARY_MIN_SHORT_PCT - 1e-6;
}
function onSeam(e, axis, dir, seam) {
  if (axis === 'x') return near(dir === 'far' ? e.x1 : e.x2, seam); // เพื่อนบ้านฝั่งตรงข้ามตะเข็บ
  return near(dir === 'far' ? e.y1 : e.y2, seam);
}
function perpOverlap(a, b, axis) {
  return axis === 'x' ? overlap(a.y1, a.y2, b.y1, b.y2) > 1 : overlap(a.x1, a.x2, b.x1, b.x2) > 1;
}
// ขยายช่อง r ตามแกน axis โดย delta (%) — ลองเลื่อนตะเข็บฝั่ง 'far' ก่อน แล้ว 'near'; ทุกเพื่อนบ้านบนตะเข็บ
//   ที่ perp-overlap กับ r ต้องหดได้โดยยังไม่จิ๋ว + ยังผ่านเกณฑ์ครอปของมันเอง มิฉะนั้น fail (คืน false).
function growAxis(r, all, axis, delta, heroI) {
  const tryDir = (dir) => {
    const seam = axis === 'x' ? (dir === 'far' ? r.e.x2 : r.e.x1) : (dir === 'far' ? r.e.y2 : r.e.y1);
    const nbrs = all.filter((o) => o && o.i !== r.i && onSeam(o.e, axis, dir, seam) && perpOverlap(o.e, r.e, axis));
    if (!nbrs.length) return false;
    for (const n of nbrs) {
      const nw = axis === 'x' ? n.e.x2 - n.e.x1 : n.e.y2 - n.e.y1;
      if (nw - delta < MIN_SLOT_PCT) return false; // เพื่อนบ้านจะจิ๋วเกิน
      const t = { ...n.e };
      if (axis === 'x') { if (dir === 'far') t.x1 += delta; else t.x2 -= delta; }
      else { if (dir === 'far') t.y1 += delta; else t.y2 -= delta; }
      if (!cropPass(t, n.i === heroI)) return false; // เพื่อนบ้านหลุดเกณฑ์เอง → ไม่เอา
    }
    // ผ่านทุกเพื่อนบ้าน → ขยาย r + หดเพื่อนบ้าน (ตะเข็บเลื่อนพร้อมกัน = ปิดผืน)
    if (axis === 'x') { if (dir === 'far') r.e.x2 += delta; else r.e.x1 -= delta; }
    else { if (dir === 'far') r.e.y2 += delta; else r.e.y1 -= delta; }
    for (const n of nbrs) {
      if (axis === 'x') { if (dir === 'far') n.e.x1 += delta; else n.e.x2 -= delta; }
      else { if (dir === 'far') n.e.y1 += delta; else n.e.y2 -= delta; }
    }
    return true;
  };
  return tryDir('far') || tryDir('near');
}
export function cropSafeBoost(slots) {
  const heroI = pickHeroIndex(slots);
  const rects = slots.map((s, i) => (isCircle(s) ? null : { i, e: toRect(s) }));
  const live = rects.filter(Boolean);
  const isHero = (r) => r.i === heroI;
  if (!live.some((r) => !cropPass(r.e, isHero(r)))) return null; // ไม่มีช่อง fail → ไม่ต้อง boost

  for (const r of live) {
    if (cropPass(r.e, isHero(r))) continue;
    const w = r.e.x2 - r.e.x1, h = r.e.y2 - r.e.y1;
    let needW = 0, needH = 0;
    if (isHero(r)) {
      const wpx = (w / 100) * CANVAS_W, hpx = (h / 100) * CANVAS_H;
      if (wpx <= hpx) needW = (HERO_MIN_SHORT_PX / CANVAS_W) * 100 - w;
      else needH = (HERO_MIN_SHORT_PX / CANVAS_H) * 100 - h;
    } else if (w <= h) needW = SECONDARY_MIN_SHORT_PCT - w;
    else needH = SECONDARY_MIN_SHORT_PCT - h;
    if (needW > MAX_EDGE_NUDGE_PCT + 1e-6 || needH > MAX_EDGE_NUDGE_PCT + 1e-6) return null; // เกินเอื้อม ≤4%/ขอบ
    if (needW > 0 && !growAxis(r, live, 'x', round4(needW), heroI)) return null;
    if (needH > 0 && !growAxis(r, live, 'y', round4(needH), heroI)) return null;
  }
  // ยืนยันทุกช่องผ่าน + ในเฟรม
  for (const r of live) {
    if (!cropPass(r.e, isHero(r))) return null;
    if (r.e.x1 < -0.01 || r.e.y1 < -0.01 || r.e.x2 > 100.01 || r.e.y2 > 100.01) return null;
  }
  return slots.map((s, i) => {
    const r = live.find((x) => x.i === i);
    return r ? slotFromEdges(s, r.e) : { ...s };
  });
}

// ── sane: ผ่าน dnaToTemplateSpec + ในเฟรม + ไม่จิ๋ว + IoU ไม่แย่กว่าแม่ ─────────────
function maxPairIoU(spec) {
  const rects = (spec?.slots || []).filter((s) => s.shape !== 'circle');
  let mx = 0;
  for (let a = 0; a < rects.length; a++) {
    for (let b = a + 1; b < rects.length; b++) {
      const A = rects[a], B = rects[b];
      const ix = Math.max(0, Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x));
      const iy = Math.max(0, Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y));
      const inter = ix * iy;
      const uni = A.w * A.h + B.w * B.h - inter;
      if (uni > 0) mx = Math.max(mx, inter / uni);
    }
  }
  return mx;
}
export function isVariantSane(variantDna, motherSpec) {
  let spec = null;
  try { spec = dnaToTemplateSpec(variantDna); } catch { spec = null; }
  if (!spec) return { ok: false, reason: 'dnaToTemplateSpec ไม่ผ่าน' };
  for (const s of spec.slots) {
    if (Math.min(s.w, s.h) < 80) return { ok: false, reason: 'ช่องจิ๋ว (<80px)' };
    if (s.x < -1 || s.y < -1 || s.x + s.w > CANVAS_W + 1 || s.y + s.h > CANVAS_H + 1) {
      return { ok: false, reason: 'ช่องหลุดเฟรม' };
    }
  }
  const vIoU = maxPairIoU(spec), mIoU = maxPairIoU(motherSpec);
  if (vIoU > mIoU + 0.05) return { ok: false, reason: `IoU แย่กว่าแม่ (${vIoU.toFixed(2)} > ${mIoU.toFixed(2)})` };
  return { ok: true, spec };
}

// ลายเซ็นเรขาคณิต (ปัด 0.5%) สำหรับ dedupe — ไม่สนลำดับช่อง (sort ก่อน)
function geoSig(slots) {
  const q = (v) => Math.round(num(v) * DEDUPE_ROUND) / DEDUPE_ROUND;
  return (slots || [])
    .map((s) => `${isCircle(s) ? 'c' : 'r'}:${q(s.xPct)},${q(s.yPct)},${q(s.wPct)},${q(s.hPct)}`)
    .sort()
    .join('|');
}

const METHODS = [
  { code: 'mirror', fn: mirrorHorizontal },
  { code: 'panelreduce', fn: panelReduce },
  { code: 'cropboost', fn: cropSafeBoost },
];

/**
 * กลั่น variant records จากใบแม่ 1 ใบ (เฉพาะเกรด A/B) — PURE, ไม่ mutate record.
 * @param {object} record ระเบียนแม่ในคลัง { id, imagePath, styleName, dna, ... }
 * @param {object} [opts]
 * @param {string} [opts.now] ISO timestamp ฝังใน _derived.at (ฉีดได้เพื่อ deterministic ในเทส)
 * @returns {Array<object>} variant records (อาจว่างถ้าแม่ไม่ใช่ A/B หรือทุกวิธีถูกทิ้ง)
 */
export function deriveTemplateVariants(record, opts = {}) {
  const now = opts.now || new Date().toISOString();
  const dna = record?.dna;
  const motherSlots = dna?.template?.slots;
  if (!dna || !Array.isArray(motherSlots) || motherSlots.length < 3) return [];

  const motherGrade = computeTemplateGrade(record).grade;
  if (motherGrade !== 'A' && motherGrade !== 'B') return []; // กลั่นจากใบปังที่พิกัดเชื่อถือได้เท่านั้น

  let motherSpec = null;
  try { motherSpec = dnaToTemplateSpec(dna); } catch { motherSpec = null; }
  if (!motherSpec) return [];

  const motherSig = geoSig(motherSlots);
  const seen = new Set([motherSig]);
  const variants = [];

  for (const { code, fn } of METHODS) {
    let newSlots = null;
    try { newSlots = fn(motherSlots); } catch { newSlots = null; }
    if (!newSlots || newSlots.length < 3) continue;

    const sig = geoSig(newSlots);
    if (seen.has(sig)) continue; // ซ้ำแม่ หรือ ซ้ำ variant อื่น → ทิ้ง

    // สร้าง dna ก้อนใหม่ (ไม่ mutate แม่) — geometry ใหม่ + dna.slots sync + ตัด metric flags ของแม่
    const syncedDnaSlots = syncDnaSlotsToTemplate(dna.slots, newSlots);
    const {
      _fidelity, _templateGrade, _rehabbed, _geometryRefined, _humanVerified,
      _reproducible, _duplicateOf, _contentSanitized, ...restDna
    } = dna;
    const variantDna = {
      ...restDna,
      template: { ...dna.template, slots: newSlots },
      slots: syncedDnaSlots,
      panelCount: newSlots.length,
      // _derived: หลักฐานที่มา + motherGrade (จำเป็นต่อเส้น derived ใน refCoverGrade — PURE ไม่ lookup คลัง)
      _derived: { fromRefId: record.id, motherGrade, method: code, at: now, engineVersion: VARIANTS_ENGINE_VERSION },
    };

    const sane = isVariantSane(variantDna, motherSpec);
    if (!sane.ok) continue;

    seen.add(sig);
    variants.push({
      id: `${record.id}-v${code}`,
      uploadedAt: now,
      styleName: record.styleName || '',
      imagePath: record.imagePath || null, // provenance: ภาพแม่ (ไม่ใช่หลักฐานวัด)
      dna: variantDna,
      dnaError: null,
    });
  }

  return variants;
}
