// ============================================================
// 🏭 MEGA Composer — โรงประกอบปกของท่อ MEGA (แทน auto-cover-v3 ที่ถูกถอด 8 ก.ค. 2026)
// ------------------------------------------------------------
// หลักการ (ผู้ใช้เคาะ): "AI คุม pipeline (ความหมาย) + renderer จัดตามกฎ (เรขาคณิต)"
//   ทีมกราฟฟิก: 🎨บก.ศิลป์(ใบสั่ง S6a) → 🖼️มือคัดภาพ(S6) → ✂️มือครอป(สูตร) → 🧩มือประกอบ(executeCover) → 👁️ตาเทียบ ref
//   โรงนี้ = ✂️🧩👁️ · deterministic: ตัดสิน "ความหมาย" จบมาแล้วจาก S6 — ที่นี่ทำตามเป๊ะ
//   AI ในไฟล์นี้มีแค่ 2 ตา: ตาหาหน้า (perception ให้สูตรครอป) + ตาเทียบ ref (ตรวจภาพชนภาพ แก้ bounded ≤1 รอบ)
// ชิ้นส่วนพิสูจน์แล้วที่ reuse: dnaToTemplateSpec (ปิดผืน 100%) · refTemplatePicker · batchDetectFaces · executeCover
// ============================================================

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto'; // ★ เฟส 3.2 (10 ก.ค.): md5 คีย์ cache ผล photo-enhance ของ hero
import { isProxy } from 'node:util/types'; // (P0) reject a raw outer args Proxy before ANY trap fires (unhideable invariant)
// ★ Wave2 Batch D2 (10 ก.ค.): เกณฑ์ตัวเลข "กติกาวัดได้" จากคลังเทคนิคปก — single source of truth (sync, ใช้ใน measureTechRules)
import { TECH_RULES } from '@/lib/imageQualityConfig';
import { HERO_STRETCH_MAX } from '@/lib/heroCropGeometry'; // ★ AC-0107: single source of the hard 1.2× hero limit (runtime-bound crop proof, strict V2)
import { computePanelCircleZone } from '@/lib/panelCropGeometry'; // ★ แบตช์ C (C2): โซนวงกลม frac ต่อช่อง (PURE) → executor bias หน้าออกนอกวง
// ★ Checkpoint B (11 ก.ค. — Codex strict consumer): ผู้ตัดสิน "เปิด strict ได้ไหม" คือ validator ของ Checkpoint A
//   เท่านั้น — consumer ใช้เฉพาะ decision.authority ที่ normalize แล้ว ห้ามอ่าน raw selectionSpec เอง
// ★ Wave1A (LANE C — flag-gated, default OFF): V2 consumer ใช้ validateSelectionSpecV2Activation (canonical) เป็นผู้ตัดสินเดียว —
//   ห้าม reimplement schema V2; S7 แค่ "บริโภค" spec ที่ผ่าน validator แล้วเท่านั้น (fail-closed HOLD ถ้าไม่ผ่าน)
import { validateStrictRenderActivationVersioned } from '@/lib/refSlotContract';

// ★ Wave1 Batch E (10 ก.ค. — manifest-lite): เวอร์ชัน composer ปัจจุบัน ประกาศตายตัวตรงนี้
//   อัปเดตมือเมื่อแก้กติกา compose/crop/hero — ใช้ stamp ลง manifest ให้ debug/replay ย้อนดูได้ว่ารอบนี้วิ่งด้วยกติกาไหน
const COMPOSER_VERSION = 'w1e-20260710';

// ---------- โหลดภาพ 1 URL → Buffer (กฎที่พิสูจน์แล้ว CASE-366: 403/HTML-หลอก/ไฟล์ local/thumbnail สำรอง) ----------
async function fetchOne(url, ms = 15000) {
  if (!url) return null;
  const u = String(url);
  if (u.startsWith('data:')) {
    try { return Buffer.from(u.split(',')[1], 'base64'); } catch { return null; }
  }
  if (u.startsWith('/')) {
    try { return await fs.readFile(path.join(process.cwd(), 'public', u.replace(/^\//, ''))); } catch { return null; }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(u, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')) return null; // Instagram ตอบ 200 แต่เป็น HTML (anti-hotlink)
    return Buffer.from(await res.arrayBuffer());
  } catch { clearTimeout(timer); return null; }
}

// ---------- ✂️ สูตรครอป (เรขาคณิตล้วน ไม่มี AI) — จัดตาม ref เคร่งครัด ----------
// facePct = "หน้ากิน %ของช่อง" จาก ref จริง (ref hero.facePct=70 → หน้ากิน 70%) · facePos = center/upper (จาก ref)
//   padding เผื่อขอบจูนจาก bundle 5JUL: ผม 30% / คาง 14% / ข้าง 16% (faceBox ของ AI แคบกว่าหน้าจริง — กันตัดผม/หู/คาง)
function cropFromFace(fb, facePct = 55, facePos = 'center', slotAspect = null, zoom = 1) {
  const fw = fb.x2 - fb.x1, fh = fb.y2 - fb.y1;
  const cx = (fb.x1 + fb.x2) / 2, faceCy = (fb.y1 + fb.y2) / 2;
  const headTop = Math.max(0, fb.y1 - fh * 0.35); // เส้นตายหัวบนสุด (ผม) — ขอบบน crop ห้ามต่ำกว่านี้
  const fill = Math.min(0.85, Math.max(0.4, (facePct / 100) * zoom)); // หน้ากิน fill ของกว้าง crop
  // กรอบต้องกว้างพอให้หน้ากิน fill + กว้างพอครอบขอบเผื่อ (ข้าง 16%)
  let w = Math.max(fw / fill, fw * 1.32);
  // สูงพอครอบ ผม(30%)+คาง(14%) + เผื่อสัดส่วนแนวตั้ง (ช่องปกมักสูงกว่ากว้าง)
  let h = Math.max(fh * 1.44, w * 1.15);
  w = Math.min(1, w); h = Math.min(1, h);
  let x = Math.min(Math.max(cx - w / 2, 0), 1 - w);
  // ★ vertical ตาม ref facePosition: center → หน้ากลางกรอบ · upper → หน้าค่อนบน · อื่นๆ → headroom ผม
  let y;
  if (/upper/.test(facePos)) y = faceCy - h * 0.42;
  else if (/center/.test(facePos)) y = faceCy - h / 2;
  else y = fb.y1 - fh * 0.30; // default: เผื่อผมเหนือหัว 30%
  y = Math.min(Math.max(y, 0), 1 - h);
  // ★ rev.2 (9 ก.ค. "หัวแหว่ง"): fit ให้ตรง aspect ช่อง "ที่นี่" — ตัวการหัวขาดคือ executor หั่นแนวตั้งทีหลังจาก anchor กลาง
  //   กติกา: ขอบบนห้ามต่ำกว่า headTop เสมอ — ขยาย/หดด้านอื่นแทน
  if (slotAspect > 0) {
    // 🔑 rev.4 (9 ก.ค. — "แย่กว่าเดิม" หลัง _final): executor เทียบ aspect หน่วย "พิกเซลจริง" (w·imgW / h·imgH)
    //   แต่สูตรนี้เคย fit ด้วย w/h เฉยๆ (normalized) → ภาพไม่จัตุรัสทำ aspect เพี้ยน → executor หดซ้ำจนหน้าหลุด
    //   แปลงเป้าเป็นหน่วย normalized: w/h ต้อง = slotAspect ÷ (imgW/imgH) → executor เห็นตรงเป๊ะ = no-op
    const imgRatio = fb.imgW > 0 && fb.imgH > 0 ? fb.imgW / fb.imgH : 1;
    const target = slotAspect / imgRatio;
    const cur = w / h;
    if (cur < target) { // crop สูงเกินช่อง → ขยายกว้างก่อน · สุดขอบแล้วค่อยลดสูงด้วยการ "ตัดล่าง" (หัวคงอยู่)
      let nw = h * target;
      if (nw <= 1) { x = Math.min(Math.max(cx - nw / 2, 0), 1 - nw); w = nw; }
      else { w = 1; x = 0; h = 1 / target; if (y > headTop) y = headTop; }
    } else if (cur > target) { // crop กว้างเกิน → เพิ่มสูงลงล่างก่อน (คงขอบบน) · เกินขอบล่างค่อยยกขึ้นแต่ไม่ต่ำกว่า headTop
      let nh = w / target;
      if (y + nh > 1) y = Math.max(Math.min(headTop, y), 1 - nh);
      if (y < 0) { y = 0; nh = Math.min(nh, 1); }
      h = Math.min(nh, 1 - y);
    }
  }
  // 🔙 rev.5 (9 ก.ค. ผู้ใช้สั่ง "แก้กลับไปจุดเดิม"): ถอด _final — ช่องมีหน้าให้ executor คำนวณเอง
  //   ด้วยสูตร v3 ที่พิสูจน์แล้ว (HERO_CROP/MOMENT_CROP + การ์ดกันหัวขาด) ซึ่งทำ hero สวยมาตลอด
  //   บทเรียน rev.3-4: สูตรที่นี่ทับ executor ทุกช่อง → วาง y แบบ 'upper' ไม่เช็คเส้นผม → ผมโดนตัด/hero พัง
  //   crop ที่คืนไป = ค่าอ้างอิง/debug เท่านั้น (executor ไม่ใช้เมื่อไม่มี _final) · ปัญหา "ผมล้นขอบ" แก้ที่
  //   การ์ดผมทรงสูงใน faceRegionForSlot (coverExecutorService) แทน — จุดเดียว ทุกท่อได้ประโยชน์
  return { x: +x.toFixed(3), y: +y.toFixed(3), w: +w.toFixed(3), h: +h.toFixed(3), _fx: +cx.toFixed(3), _fy: +faceCy.toFixed(3) };
}

// ---------- ✂️ ครอบ "ทุกหน้า" ในภาพหลายคน (8 ก.ค. ผู้ใช้: "ห้ามจัดลงแบบคนขาดคนหาย") ----------
// bounding box ของ allFaces + margin ผม 35% บน / 20% ล่าง-ข้าง → ทุกคนอยู่ครบในเฟรม
function cropAllFaces(fb, slotAspect = null) {
  const faces = fb?.allFaces?.length ? fb.allFaces : [fb];
  let x1 = 1, y1 = 1, x2 = 0, y2 = 0;
  for (const f of faces) { x1 = Math.min(x1, f.x1); y1 = Math.min(y1, f.y1); x2 = Math.max(x2, f.x2); y2 = Math.max(y2, f.y2); }
  const gw = x2 - x1, gh = y2 - y1;
  // rev.2 (9 ก.ค. หัวพ่อขาด — detector จับหน้าที่ก้ม/เอียงไม่ได้): เผื่อรอบวงกว้างขึ้น บน 55% ข้าง 30%
  let cx1 = Math.max(0, x1 - gw * 0.3), cy1 = Math.max(0, y1 - gh * 0.55);
  let cx2 = Math.min(1, x2 + gw * 0.3), cy2 = Math.min(1, y2 + gh * 0.7);
  // rev.3 (9 ก.ค. ผู้ใช้: "ภาพคู่ห้ามตัดหัวใครสักคน"): ขยาย crop ให้ตรง aspect ช่องตั้งแต่ที่นี่
  //   → executor ไม่ต้องหั่นเพิ่ม (ตัวการหัวขาด: fitCropToSlotAspect ตัดแนวตั้งจาก anchor กลาง)
  //   กติกา: ขอบบนห้ามต่ำกว่า "หัวบนสุด + เผื่อ" เด็ดขาด — ขยายลงล่าง/ข้างแทน
  if (slotAspect > 0) {
    // 🔑 rev.4: เป้า aspect หน่วย normalized = slotAspect ÷ (imgW/imgH) — ให้ตรงหน่วยพิกเซลของ executor
    const imgRatio = fb?.imgW > 0 && fb?.imgH > 0 ? fb.imgW / fb.imgH : 1;
    const target = slotAspect / imgRatio;
    const headTop = Math.max(0, y1 - gh * 0.55); // เส้นตายหัวบนสุด
    let w = cx2 - cx1, h = cy2 - cy1;
    const cur = w / h;
    if (cur > target) { // กว้างไป → ต้องสูงขึ้น: ขยายลงล่างก่อน (ห้ามยกขอบบนลงต่ำกว่า headTop)
      let nh = w / target;
      let ny1 = Math.min(cy1, headTop);
      let ny2 = ny1 + nh;
      if (ny2 > 1) { ny2 = 1; ny1 = Math.max(0, ny2 - nh); if (ny1 > headTop) { ny1 = headTop; nh = ny2 - ny1; const nw = nh * target; const cxm = (cx1 + cx2) / 2; cx1 = Math.max(0, cxm - nw / 2); cx2 = Math.min(1, cx1 + nw); } }
      cy1 = ny1; cy2 = Math.min(1, ny1 + (cx2 - cx1) / target);
    } else if (cur < target) { // สูงไป → ขยายข้างเท่าที่มี (ไม่พอ = ปล่อย executor หดข้างเอง ไม่กระทบหัว)
      const nw = h * target;
      const cxm = (cx1 + cx2) / 2;
      cx1 = Math.max(0, cxm - nw / 2); cx2 = Math.min(1, cx1 + nw);
    }
  }
  // 🔙 rev.5: ถอด _final — ภาพหลายหน้าให้ executor จัดเอง (groupRegionForSlot/spread-check ที่พิสูจน์แล้ว
  //   CASE-104/246/265: คนชิดเก็บครบทุกคน · คนห่างเน้นหน้าใหญ่สุด) — จุดเดิมที่ผู้ใช้ยืนยันว่าดี
  return { x: +cx1.toFixed(3), y: +cy1.toFixed(3), w: +(cx2 - cx1).toFixed(3), h: +(cy2 - cy1).toFixed(3), _fx: +((x1 + x2) / 2).toFixed(3), _fy: +((y1 + y2) / 2).toFixed(3) };
}

// ---------- ★ เฟส 4.1 (9 ก.ค. — กรอบเขียวเฟรมคลิปหลุดขึ้นปกทุกใบ): ตัดกรอบสีทึบที่ขอบภาพก่อนเข้าท่อ ----------
//   เกณฑ์เข้มกันตัดภาพจริง: แถบขอบต้อง "เรียบสนิท" (std ต่อช่องสี ≤9 ทั้งเส้น) และเป็น สีจัด (chroma>90
//   เช่นเขียวคีย์/แดง UI) หรือดำสนิท/ขาวสนิท (letterbox/การ์ดโพสต์) — สูงสุด 10%/ด้าน · ล้ม = คืนภาพเดิม
async function trimVividBorder(buf) {
  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(buf).metadata();
    const W = meta.width || 0, H = meta.height || 0;
    if (W < 60 || H < 60) return { buf, trimmed: null };
    const S = 100;
    const raw = await sharp(buf).resize(S, S, { fit: 'fill' }).toColourspace('srgb').removeAlpha().raw().toBuffer(); // audit: บังคับ 3 ช่องสี (ภาพขาวดำ 1 ช่องเคยทำ index เพี้ยน trim เงียบ)
    const px = (x, y) => { const o = (y * S + x) * 3; return [raw[o], raw[o + 1], raw[o + 2]]; };
    const isArtifactLine = (getPx) => {
      const sum = [0, 0, 0], sum2 = [0, 0, 0];
      for (let i = 0; i < S; i++) { const c = getPx(i); for (let k = 0; k < 3; k++) { sum[k] += c[k]; sum2[k] += c[k] * c[k]; } }
      const mean = sum.map((v) => v / S);
      const std = sum2.map((v, k) => Math.sqrt(Math.max(0, v / S - mean[k] * mean[k])));
      if (Math.max(...std) > 9) return false; // ไม่เรียบ = ภาพจริง (ฟ้า/ผนังมี noise เกินนี้)
      const chroma = Math.max(...mean) - Math.min(...mean);
      const lum = (mean[0] + mean[1] + mean[2]) / 3;
      return chroma > 90 || lum < 14 || lum > 243;
    };
    const depth = (side) => {
      let d = 0;
      for (let j = 0; j < 10; j++) {
        const ok = side === 't' ? isArtifactLine((i) => px(i, j))
          : side === 'b' ? isArtifactLine((i) => px(i, S - 1 - j))
            : side === 'l' ? isArtifactLine((i) => px(j, i))
              : isArtifactLine((i) => px(S - 1 - j, i));
        if (!ok) break;
        d++;
      }
      return d;
    };
    const t = depth('t'), b = depth('b'), l = depth('l'), r = depth('r');
    if (t + b + l + r === 0) return { buf, trimmed: null };
    const left = Math.round((l / S) * W), top = Math.round((t / S) * H);
    const width = Math.max(8, W - left - Math.round((r / S) * W));
    const height = Math.max(8, H - top - Math.round((b / S) * H));
    const out = await sharp(buf).extract({ left, top, width, height }).jpeg({ quality: 95 }).toBuffer();
    return { buf: out, trimmed: `t${t} b${b} l${l} r${r} (%)` };
  } catch { return { buf, trimmed: null }; }
}

// ---------- แปลงผล detectFaces (พิกเซล) → faceBox normalized แบบที่ executeCover ใช้ ----------
function normalizeFaceBox(fd) {
  if (!fd) return null;
  const W = fd.imageWidth || 1, H = fd.imageHeight || 1;
  // ★ เฟส 1.4 (9 ก.ค. — root cause #3): detector คืน mainSubject/textRegion/watermarkRegion/hasBigText มาอยู่แล้ว
  //   แต่เดิมถูกทิ้งตรงนี้ทั้งหมด → สาขา fb.subject ใน executor เป็น dead code + หลบลายน้ำ/แคปชั่นเป็นอัมพาต
  const subject = (fd.mainSubject && fd.mainSubject.width > 0 && fd.mainSubject.height > 0)
    ? {
        x1: +(fd.mainSubject.x / W).toFixed(3), y1: +(fd.mainSubject.y / H).toFixed(3),
        x2: +((fd.mainSubject.x + fd.mainSubject.width) / W).toFixed(3),
        y2: +((fd.mainSubject.y + fd.mainSubject.height) / H).toFixed(3),
      }
    : null;
  const extras = {
    subject,
    textRegion: fd.textRegion || null,        // normalized x1y1x2y2 อยู่แล้ว
    watermarkRegion: fd.watermarkRegion || null,
    hasText: !!fd.hasBigText,
  };
  if (!fd.hasFaces || !fd.faces?.length) {
    // เดิม return null ทั้งก้อน → ภาพไร้หน้าถูกครอปตาบอด (เดาช่วงบน) — คืนกล่องว่าง+extras ให้ executor ใช้ subject แทน
    return (subject || extras.textRegion || extras.watermarkRegion)
      ? { x1: 0, y1: 0, x2: 0, y2: 0, imgW: W, imgH: H, count: 0, allFaces: [], ...extras }
      : null;
  }
  const largest = fd.faces.reduce((b, f) => (f.width * f.height > b.width * b.height ? f : b), fd.faces[0]);
  const area = largest.width * largest.height;
  const sig = fd.faces.filter((f) => f.width * f.height >= 0.35 * area); // ตัดหน้าจิ๋วฉากหลัง
  return {
    x1: +(largest.x / W).toFixed(3), y1: +(largest.y / H).toFixed(3),
    x2: +((largest.x + largest.width) / W).toFixed(3), y2: +((largest.y + largest.height) / H).toFixed(3),
    imgW: W, imgH: H, // 🔑 rev.4: สัดส่วนภาพจริง — fit aspect ต้องคิด "หน่วยพิกเซล" ให้ตรงกับ executor
    pose: largest.pose || 'frontal', // ★ เฟส 6B.1: ท่าหน้าของหน้าหลัก (ใหญ่สุด) — hero score ใช้ 6B.2 · additive
    count: sig.length,
    allFaces: sig.map((f) => ({
      x1: +(f.x / W).toFixed(3), y1: +(f.y / H).toFixed(3),
      x2: +((f.x + f.width) / W).toFixed(3), y2: +((f.y + f.height) / H).toFixed(3),
    })),
    ...extras,
  };
}

// ---------- ★ Wave1 Batch E (manifest-lite): แปลงกล่องหน้า normalized (0-1) → พิกเซล int ให้ manifest ----------
//   ใช้ค่าที่ normalizeFaceBox คำนวณไว้แล้วเท่านั้น (ห้ามยิงตาหาหน้าเพิ่ม) · จำกัด 5 กล่องแรกต่อภาพกันขนาดบวม
function _manifestFaceBoxes(fb) {
  if (!fb || !fb.imgW || !fb.imgH) return [];
  const list = (fb.allFaces && fb.allFaces.length) ? fb.allFaces : ((fb.x2 > fb.x1) ? [{ x1: fb.x1, y1: fb.y1, x2: fb.x2, y2: fb.y2 }] : []);
  return list.slice(0, 5).map((f) => ({
    x: Math.round(f.x1 * fb.imgW), y: Math.round(f.y1 * fb.imgH),
    w: Math.round((f.x2 - f.x1) * fb.imgW), h: Math.round((f.y2 - f.y1) * fb.imgH),
  }));
}

// ---------- ★ เฟส 3 (10 ก.ค.): ธงคุณภาพจาก cropTrace ของปกใบสุดท้าย ----------
//   blind_crop (ครอปตาบอด ไร้หน้า/subject) + upscaled/upscale_soft (ยืดจริงต่อช่อง จาก region px → slot px ที่ executor วัด)
function traceQcFlags(cropTrace) {
  const out = [];
  for (const tt of cropTrace || []) {
    if (/^noface-(top55|director-asis)$/.test(String(tt.branch || ''))) out.push(`blind_crop:${tt.slot}`);
    const r = Number(tt.upscale);
    if (r > 1.6) out.push(`upscaled:${tt.slot}:${r.toFixed(2)}`);
    else if (r >= 1.2) out.push(`upscale_soft:${tt.slot}:${r.toFixed(2)}`);
    // ★ เฟส 6B.3/6B.4 (10 ก.ค.): ธงครอปแน่นหน้าเด่น/บริบทไม่โล่ง (executor แนบ tt.tighten)
    const tg = tt.tighten;
    if (tg) {
      if (tg.tightened && tg.kind === 'context') out.push(`context_tightened:${tt.slot}`);
      else if (tg.tightened) out.push(`crop_tightened:${tt.slot}`);
      if (tg.small) out.push(`face_small:${tt.slot}:${Number(tg.share).toFixed(2)}`);
    }
  }
  return out;
}

// ============================================================
// ★ Wave2 Batch D2 (10 ก.ค.): เครื่องวัด "กติกาวัดได้" 23 ข้อจากคลังเทคนิคปก → ธง QC
// ------------------------------------------------------------
// pure ล้วน (ไม่มี IO/LLM/side-effect) — เทสได้โดด · วัดจากค่าที่ compose คำนวณไว้แล้วทั้งหมด:
//   assignments (slotId↔imageIndex+crop) · spec.slots (ช่องบน canvas จริง) · faceBoxes (ตาหาหน้า normalized)
//   · cropTrace (region พิกเซลจริงต่อช่องของรอบเรนเดอร์สุดท้าย — lockstep กับ buffer ตาม W2-C)
// การ map พิกัด (ยืนยันกับโค้ดจริง): rect slot fill ช่องแบบสัดส่วนตรง (region aspect = slot aspect)
//   → faceShare ช่อง = สูงหน้า(px ต้นทาง) / region.height × 100 · หน้าบน canvas = slotRect + สัดส่วนตำแหน่งใน region
// 🔴 fail-open: วัดไม่ได้ (ไร้ faceBox/ไร้ trace/ไร้ region) = ข้ามเงียบ ไม่ติดธง (ห้ามเดา)
// ธงทุกตัวอ้าง principle id ของคลัง (P-*) ในคอมเมนต์ — coverQcGate.js เป็นตัวตัดสินโหมด advisory/hard
// ============================================================
// ★ แบตช์ C (C3): band วัด face_share ของ hero override ได้ผ่าน env MEGA_HERO_FACE_BAND="min,max"
//   ไม่ตั้ง/พังรูปแบบ = คืน TECH_RULES.HERO_FACE_SHARE เดิมเป๊ะ (byte-parity)
//   แก้เคสสไตล์เทมเพลตปักหน้าใหญ่ (เช่น 67%) โดนธง face_share_out ทั้งที่ตั้งใจ
function _heroFaceBand() {
  const raw = process.env.MEGA_HERO_FACE_BAND;
  if (!raw) return TECH_RULES.HERO_FACE_SHARE;
  const m = String(raw).split(',').map((x) => Number(x.trim()));
  if (m.length === 2 && Number.isFinite(m[0]) && Number.isFinite(m[1]) && m[0] < m[1]) return [m[0], m[1]];
  return TECH_RULES.HERO_FACE_SHARE;
}

export function measureTechRules({ assignments = [], spec = null, faceBoxes = [], cropTrace = [], heroComposerSlotId = null } = {}) {
  const flags = [];
  const bySlot = {}; // slotId → { role, faceSharePct?, headroomPct?, hasFace }
  const slots = Array.isArray(spec?.slots) ? spec.slots : [];
  const canvasW = Number(spec?.canvasW) || 0;

  // index ช่วยค้น
  const slotById = new Map();
  for (const s of slots) slotById.set(String(s.id), s);
  const traceBySlot = new Map();
  for (const t of cropTrace || []) if (t && t.slot != null) traceBySlot.set(String(t.slot), t);

  // จำแนกบทบาทช่องจาก id — mirror regex เดิมที่ composer/refTemplate ใช้ (main|hero, shape circle,
  //   ช่อง DNA เกิดเป็น `${role}_${i}` เช่น context_2 / evidence_3 / reaction_1 / victim_5)
  const roleOf = (slot) => {
    const id = String(slot?.id || '');
    // ★ (item 10) V2: hero = EXACT canonical heroComposerSlotId (face-share/headroom rules apply to arbitrary
    //   canonical hero ids e.g. `panel_alpha`; a decoy `main` is NOT hero) · V1/legacy (null) = regex เดิม
    if (heroComposerSlotId != null) { if (id === String(heroComposerSlotId)) return 'hero'; }
    else if (/main|hero/i.test(id)) return 'hero';
    if (slot?.shape === 'circle') return 'circle';
    if (/^context/i.test(id)) return 'context';
    if (/^evidence/i.test(id)) return 'evidence';
    if (/^(reaction|action|moment|pair|victim)/i.test(id)) return 'secondary';
    return 'unknown'; // ไม่รู้บทบาท → ไม่วัด faceShare (fail-open)
  };

  // หน้าใหญ่สุด "ในช่อง" + ประมาณหัวจริง (px ต้นทาง) จาก faceBox + region
  //   หลายหน้า → เลือกใบใหญ่สุดที่ศูนย์กลางตกใน region (ไม่มีตกใน = ใช้ใหญ่สุดทั้งภาพ)
  const faceMetrics = (fb, region) => {
    if (!fb || !fb.imgH) return null;
    const cand = (fb.allFaces && fb.allFaces.length)
      ? fb.allFaces
      : (fb.x2 > fb.x1 ? [{ x1: fb.x1, y1: fb.y1, x2: fb.x2, y2: fb.y2 }] : []);
    if (!cand.length) return null;
    const inR = [];
    if (region) {
      for (const f of cand) {
        const cxPx = ((f.x1 + f.x2) / 2) * fb.imgW;
        const cyPx = ((f.y1 + f.y2) / 2) * fb.imgH;
        if (cxPx >= region.left && cxPx <= region.left + region.width
          && cyPx >= region.top && cyPx <= region.top + region.height) inR.push(f);
      }
    }
    const pool = inR.length ? inR : cand;
    let best = pool[0];
    for (const f of pool) if ((f.y2 - f.y1) > (best.y2 - best.y1)) best = f;
    const faceHpx = (best.y2 - best.y1) * fb.imgH;
    const headTopPx = best.y1 * fb.imgH - 0.30 * faceHpx; // ★ ประมาณ: ผมเหนือกล่องหน้า ~30% ของสูงหน้า
    return { faceHpx, headTopPx };
  };

  // ── (A) faceShare + headroom ต่อช่อง (P-CROP-01, panelNorms รายช่อง) ──
  const faceShareList = []; // สำหรับบันได P-ZOOM-01: { slot, pct } เฉพาะช่องที่มีหน้า
  for (const a of assignments || []) {
    const slot = slotById.get(String(a.slotId));
    if (!slot) continue;
    const role = roleOf(slot);
    const region = traceBySlot.get(String(a.slotId))?.region || null;
    const fb = faceBoxes[a.imageIndex] || null;
    const rec = { role, hasFace: false };
    bySlot[String(a.slotId)] = rec;
    if (!region || !region.height) { if (role === 'hero') flags.push('hero_face_unmeasured'); continue; } // ★ F5: hero วัดไม่ได้ = advisory ให้มองเห็น (ช่องอื่น = ข้ามเงียบเหมือนเดิม)
    const fm = faceMetrics(fb, region);
    if (!fm) { if (role === 'hero') flags.push('hero_face_unmeasured'); continue; } // ★ F5: hero faceMetrics null → ธง advisory (ไม่ gating) · ช่องอื่นไม่มีหน้า = ข้ามเงียบ
    const faceSharePct = +((fm.faceHpx / region.height) * 100).toFixed(1);
    const headroomPct = +(((fm.headTopPx - region.top) / region.height) * 100).toFixed(1);
    rec.faceSharePct = faceSharePct;
    rec.headroomPct = headroomPct;
    rec.hasFace = true;
    faceShareList.push({ slot: String(a.slotId), pct: faceSharePct });
    // ★ แบตช์ F (F1): หน้ากินช่อง ≥100% = หน้าโอเวอร์โฟลว์ช่อง (ทุกบทบาทรวม hero) → ธง hard-tier ให้ coverQcGate ตัดสิน
    //   emit เสมอ (ไม่มี kill-switch ฝั่ง emit — ≥100% ผิดแน่ ไม่มี false positive) · โหมด hard/advisory อยู่ที่ gate
    if (faceSharePct >= TECH_RULES.FACE_OVERFLOW_MIN) flags.push(`face_overflow:${a.slotId}:${faceSharePct}`);

    // band faceShare รายบทบาท (คลัง panelNorms) → face_share_out:<slot>:<pct>
    if (role === 'hero') {
      // P-CROP-01: ขอบ "พบจริง 30-58" (ไม่ใช่ norm 44-58 — กัน false positive) · C3: env override ได้
      const [lo, hi] = _heroFaceBand();
      if (faceSharePct < lo || faceSharePct > hi) flags.push(`face_share_out:${a.slotId}:${faceSharePct}`);
      // headroom hero → headroom_out:<slot>:<pct>
      const [hlo, hhi] = TECH_RULES.HERO_HEADROOM;
      if (headroomPct < hlo || headroomPct > hhi) flags.push(`headroom_out:${a.slotId}:${headroomPct}`);
    } else if (role === 'circle') {
      const [lo, hi] = TECH_RULES.CIRCLE_FACE_SHARE; // มีหน้าเท่านั้นถึงวัด (ฉาก/ของ = ข้ามไปแล้ว)
      if (faceSharePct < lo || faceSharePct > hi) flags.push(`face_share_out:${a.slotId}:${faceSharePct}`);
    } else if (role === 'context') {
      const [lo, hi] = TECH_RULES.CONTEXT_FACE_SHARE;
      if (faceSharePct < lo || faceSharePct > hi) flags.push(`face_share_out:${a.slotId}:${faceSharePct}`);
    } else if (role === 'evidence') {
      if (faceSharePct > TECH_RULES.EVIDENCE_FACE_SHARE_MAX) flags.push(`face_share_out:${a.slotId}:${faceSharePct}`); // >33 เท่านั้น
    } else if (role === 'secondary') {
      const [lo, hi] = TECH_RULES.SECONDARY_FACE_SHARE;
      if (faceSharePct < lo || faceSharePct > hi) flags.push(`face_share_out:${a.slotId}:${faceSharePct}`);
    }
    // role unknown → ไม่ flag faceShare
  }

  // ── (B) P-ZOOM-01 บันไดขนาดหน้า (advisory ตลอด — คู่ pair ถูกต้องก็ติด แยกไม่ได้) ──
  if (faceShareList.length >= 2) {
    const sorted = [...faceShareList].sort((a, b) => b.pct - a.pct);
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = +(sorted[i].pct - sorted[i + 1].pct).toFixed(1);
      if (gap < TECH_RULES.LADDER_MIN_GAP) flags.push(`ladder_break:${sorted[i].slot}:${sorted[i + 1].slot}:${gap}`);
    }
  }

  // ── (C) P-CIRCLE-01 วงกลมทับ/ใกล้หน้าในช่องใต้ (zIndex ต่ำกว่า) < 3% ของกว้าง canvas ──
  const circles = slots
    .filter((s) => s.shape === 'circle')
    .map((s) => ({ id: s.id, cx: s.x + s.w / 2, cy: s.y + s.h / 2, r: s.w / 2, zIndex: Number(s.zIndex) || 0 }));
  if (circles.length && canvasW) {
    const gapThresh = canvasW * (TECH_RULES.CIRCLE_FACE_GAP_PCT / 100);
    for (const a of assignments || []) {
      const slot = slotById.get(String(a.slotId));
      if (!slot || slot.shape === 'circle') continue;
      const region = traceBySlot.get(String(a.slotId))?.region || null;
      const fb = faceBoxes[a.imageIndex] || null;
      if (!region || !region.width || !region.height || !fb || !fb.imgW) continue;
      const cand = (fb.allFaces && fb.allFaces.length)
        ? fb.allFaces
        : (fb.x2 > fb.x1 ? [{ x1: fb.x1, y1: fb.y1, x2: fb.x2, y2: fb.y2 }] : []);
      let hit = false;
      for (const f of cand) {
        const fL = f.x1 * fb.imgW, fR = f.x2 * fb.imgW, fT = f.y1 * fb.imgH, fB = f.y2 * fb.imgH;
        const fcx = (fL + fR) / 2, fcy = (fT + fB) / 2;
        // หน้าต้องถูกเรนเดอร์จริง = ศูนย์กลางตกใน region
        if (fcx < region.left || fcx > region.left + region.width || fcy < region.top || fcy > region.top + region.height) continue;
        // map กล่องหน้า (px ต้นทาง) → พิกัด canvas ผ่านช่อง rect
        const toCx = (px) => slot.x + ((px - region.left) / region.width) * slot.w;
        const toCy = (py) => slot.y + ((py - region.top) / region.height) * slot.h;
        const cL = toCx(fL), cR = toCx(fR), cT = toCy(fT), cB = toCy(fB);
        for (const ci of circles) {
          if (ci.zIndex <= (Number(slot.zIndex) || 0)) continue; // วงต้องอยู่เหนือช่องถึงทับได้จริง
          // ระยะจากศูนย์วง → จุดใกล้สุดของกล่องหน้า แล้วลบรัศมี = ช่องว่างขอบวงถึงหน้า
          const nx = Math.max(cL, Math.min(ci.cx, cR));
          const ny = Math.max(cT, Math.min(ci.cy, cB));
          const gap = Math.hypot(ci.cx - nx, ci.cy - ny) - ci.r;
          if (gap < gapThresh) { hit = true; break; }
        }
        if (hit) break;
      }
      if (hit) flags.push(`circle_face_overlap:${a.slotId}`);
    }
  }

  // ── (D) P-LAYOUT-01 จำนวนช่องรวม > 6 ──
  if (slots.length > TECH_RULES.PANEL_MAX) flags.push(`panel_count_out:${slots.length}`);

  // ── (E) P-CIRCLE-01 ขอบขาววง 0/ไม่มี หรือ >16px (norm 4-10 แต่ฐานกว้าง ref ไม่รู้ — ขอบหลวม) ──
  for (const s of slots) {
    if (s.shape !== 'circle') continue;
    const bw = Number(s.borderWidth) || 0;
    if (bw === 0 || bw > TECH_RULES.CIRCLE_BORDER_MAX) flags.push(`circle_border_out:${bw}`);
  }

  return { flags, measured: { bySlot, panelCount: slots.length } };
}

// ---------- แกนประกอบ (ใช้ร่วม compose/verify) ----------
// ---------- 🔐 Checkpoint B (11 ก.ค. — Codex): FLAG-GATED STRICT COMPOSER CONSUMER ----------
// producer จริงต่อแล้ว (megaAdapters S7 แนบ carrier เข้า queue payload) — ภายใต้ MEGA_STRICT_RENDER=1 shared seam
// activate ให้ own carrier รูปแบบเดียวที่รองรับพอดี: V1 selectionSpec+realizedTemplate ครบคู่ หรือ V2 refHeroV2 · กำกวม/ครึ่งๆ = fail-closed · หลักการ: strict = "เส้นแยกทั้งเส้น" —
// legacy ใน composeCore ไม่ถูกแตะแม้บรรทัดเดียว

// deep-freeze ทั้งต้นไม้ — โครง strict ต้องแตะไม่ได้จริงตั้งแต่ก่อน await แรก (P1 รอบ 2)
function _deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) _deepFreeze(o[k]);
  }
  return o;
}

// (P1-R1 / P0-A / P0-B) PRIVATE, UNFORGEABLE capture — the SOLE observation of the outer carriers. Called ONCE by the
//   exported seam; there is no caller-supplied snapshot path. Read the carrier DESCRIPTORS FIRST (before any
//   getPrototypeOf / [[Get]] / has / ownKeys). Each record distinguishes absent / accessor / data / TRAP_ERROR (a
//   throwing getOwnPropertyDescriptor is NEVER mapped to absence — that would let an unobservable carrier downgrade to
//   legacy or hide V1+V2 ambiguity; it becomes trapError ⇒ typed HOLD). slotPlan is captured here too so the strict
//   path never re-reads it. Records + snapshot are deep-frozen (the caller's objects are never frozen/mutated).
function _captureCarrierSnapshot(args) {
  const isObj = args != null && (typeof args === 'object' || typeof args === 'function');
  const cap = (key) => {
    if (!isObj) return Object.freeze({ present: false, accessor: false, trapError: false, value: undefined });
    let d;
    try { d = Object.getOwnPropertyDescriptor(args, key); }
    catch { return Object.freeze({ present: false, accessor: false, trapError: true, value: undefined }); }
    if (!d) return Object.freeze({ present: false, accessor: false, trapError: false, value: undefined });
    if (!('value' in d)) return Object.freeze({ present: true, accessor: true, trapError: false, value: undefined }); // getter — NOT invoked
    return Object.freeze({ present: true, accessor: false, trapError: false, value: d.value });
  };
  const refHeroV2 = cap('refHeroV2');
  const selectionSpec = cap('selectionSpec');
  const realizedTemplate = cap('realizedTemplate');
  const slotPlan = cap('slotPlan');
  // plain-prototype check ONLY AFTER the carriers are fixed — a getPrototypeOf trap/mutation cannot un-capture them.
  let isPlain = false;
  if (isObj) { try { const p = Object.getPrototypeOf(args); isPlain = (p === Object.prototype || p === null); } catch { isPlain = false; } }
  return Object.freeze({ isObj, isPlain, refHeroV2, selectionSpec, realizedTemplate, slotPlan });
}

// (P1) Snapshot the INNER V2 carrier's own-data fields into a NEW FROZEN plain value (the caller's carrier object is
//   never frozen/mutated). Reject any inner accessor OR descriptor-trap error; `ok` must be a literal true data field.
function _captureV2Inner(c) {
  const read = (k) => {
    let d;
    try { d = Object.getOwnPropertyDescriptor(c, k); } catch { return { trap: true }; }
    if (!d) return { value: undefined };
    if (!('value' in d)) return { accessor: true };
    return { value: d.value };
  };
  const okR = read('ok');
  if (okR.trap) return { trapError: true };
  const okField = okR.accessor ? false : (okR.value === true);
  const FIELDS = ['selectionSpec', 'selectionAuthority', 'expectedSelectionAuthorityHash', 'expectedSpecHash', 'expectedReplayHash', 'realizedTemplate'];
  const input = {};
  for (const f of FIELDS) {
    const r = read(f);
    if (r.trap || r.accessor) return { innerReject: true }; // inner accessor/trap ⇒ reject (never a silent undefined)
    input[f] = r.value;
  }
  return { okField, input: Object.freeze(input) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔐 Wave1A (LANE C — P0/P1 CORRECTION): SINGLE STRICT ACTIVATION SEAM
// ─────────────────────────────────────────────────────────────────────────────
// ผู้ตัดสินเวอร์ชันเดียว = validateStrictRenderActivationVersioned (peek selectionSpec.v):
//   v===2 → validateSelectionSpecV2Activation · อื่นๆ → validateStrictRenderActivation (V1)
// การเลือก V1/V2 มาจาก "carrier" ล้วน — ไม่ใช่ env (canonical latch = MEGA_STRICT_RENDER เท่านั้น
//   ตรวจที่ composeAndVerify ก่อนเรียกตัวนี้) · ตัวนี้ pure (ไม่อ่าน env) → เทสได้ตรง
//   carrier V2 = args.refHeroV2 (own-property) → ประกอบ input 6 ช่องจาก own-data descriptor-safe
//   carrier V1 = args เอง (own-property selectionSpec + realizedTemplate ครบคู่) → ส่ง args ตรงเข้า validator (กฎ plain-object เป็นของ validator)
//   V2 + own V1 field ใดก็ตาม = ambiguous · V1 ครึ่งคู่ (มีข้างเดียว) = invalid — HOLD ก่อน latch/IO · HOLD ทุกกรณี partial/invalid ไม่มี downgrade เงียบ
// The shared exported PURE seam. Accepts RAW args ONLY (+ an explicit canonical latch value) — there is NO
//   caller-supplied snapshot path (P1: a fabricated snapshot has no effect and no API surface). This is the SOLE, FIRST
//   observation of args: it privately captures the carriers (descriptors first) + slotPlan, owns the ambiguity + latch +
//   version decisions, and returns { none } | { error,errorType,reasons } | { ctx } — each carrying the captured
//   slotPlan so downstream never re-reads args.slotPlan. Returns for a caller with `latchArmed !== true`: a V2 carrier
//   HOLDs (no downgrade), a V1-only carrier is legacy (none). `latchArmed` is passed by the caller (env stays out of
//   this pure seam). Direct callers that want to exercise carrier validation pass latchArmed: true.
export function _strictActivate({ args, latchArmed = true } = {}) {
  // `latchArmed` defaults to true (i.e. "process this carrier") — the explicit latch value is only NEEDED to express
  //   the OFF case, which composeAndVerify passes as `process.env.MEGA_STRICT_RENDER === '1'`. Direct consumers that
  //   validate a carrier (capture-only always runs armed) may omit it. Any extra caller-supplied field (e.g. a legacy
  //   `slotPlan` or a fabricated `snapshot`) is NOT destructured ⇒ has no effect and no API path.
  // (P0) A raw outer args PROXY is rejected at the VERY START — before ANY trap can fire (getOwnPropertyDescriptor /
  //   getPrototypeOf / get / has / ownKeys). A stateful cross-key trap could otherwise return the real V2 descriptor
  //   while deleting selectionSpec as a side effect (hiding V1+V2 ambiguity), or self-delete / delete the sibling to
  //   force a downgrade. isProxy() consults an internal slot and invokes NO trap. Plain data objects are unaffected.
  //   Typed HOLD, stable reason, regardless of latch, before any observation/IO.
  if (isProxy(args)) {
    return { error: 'strict activation ไม่รองรับ Proxy เป็น args (unhideable-invariant guard)', errorType: 'STRICT_RENDER_CONTRACT_INVALID', reasons: ['input_proxy_unsupported'] };
  }
  const snap = _captureCarrierSnapshot(args); // ONE private capture — descriptors read before any prototype/[[Get]]
  const slotPlan = snap.slotPlan.value;       // captured once — the strict path uses THIS, never re-reads args.slotPlan
  // (P0-B) a carrier descriptor TRAP ⇒ typed HOLD BEFORE any legacy/latch decision (uncertainty is never absence).
  //   realizedTemplate is a V1 carrier-defining field too (a lone one is a malformed half-pair), so ITS descriptor
  //   uncertainty is included here — a trap on ANY of the three carrier slots is fail-closed, never read as absence.
  if (snap.refHeroV2.trapError || snap.selectionSpec.trapError || snap.realizedTemplate.trapError) {
    return { error: 'strict carrier descriptor อ่านไม่ได้ (trap threw)', errorType: 'STRICT_RENDER_CONTRACT_INVALID', reasons: ['carrier_descriptor_trap'], slotPlan };
  }
  const hasV2 = snap.refHeroV2.present;
  // V1 presence mirrors carrier presence exactly as the ingress adapters see it: a V1 carrier is the selectionSpec +
  //   realizedTemplate PAIR, and EITHER own field marks a V1 field present (cover-ref-test rejects V2 + either V1
  //   field; /api/mega/compose forwards each field independently, so a lone realizedTemplate can reach here).
  const hasSpec = snap.selectionSpec.present;
  const hasRealized = snap.realizedTemplate.present;
  const anyV1 = hasSpec || hasRealized;
  // (ambiguity cannot be hidden) V2 + ANY own V1 field (selectionSpec and/or realizedTemplate) ⇒ HOLD regardless of
  //   latch, before any IO — a V2 carrier may never co-exist with a V1 field on one args.
  if (hasV2 && anyV1) {
    return { error: 'strict carrier กำกวม: มีทั้ง refHeroV2 และ V1 field (selectionSpec/realizedTemplate)', errorType: 'STRICT_RENDER_CARRIER_AMBIGUOUS', reasons: ['carrier_ambiguous_v1_and_v2'], slotPlan };
  }
  // V1 half-pair (exactly one of selectionSpec/realizedTemplate, no V2) ⇒ typed HOLD before latch/IO — never a silent
  //   legacy downgrade, never a validator round-trip with an undefined half. Stable fixed reason.
  if (!hasV2 && hasSpec !== hasRealized) {
    return { error: 'strict v1 carrier ครึ่งเดียว: ต้องแนบ selectionSpec + realizedTemplate ครบคู่', errorType: 'STRICT_RENDER_CONTRACT_INVALID', reasons: ['carrier_v1_half_pair'], slotPlan };
  }
  const hasV1 = hasSpec && hasRealized; // a V1 carrier = the COMPLETE pair only
  if (!hasV2 && !hasV1) return { none: true, slotPlan }; // no carrier ⇒ legacy
  const armed = latchArmed === true;
  // (item 7) NO-DOWNGRADE for V2, but PRESERVE complete-V1 latch-OFF legacy parity.
  if (hasV2 && !armed) {
    return { error: 'refHeroV2 carrier แนบมาแต่ MEGA_STRICT_RENDER ไม่ถูก arm (!== "1") — ห้ามถอย legacy/V1 เงียบ', errorType: 'STRICT_RENDER_LATCH_OFF', reasons: ['strict_latch_off_v2_carrier_present'], slotPlan };
  }
  if (hasV1 && !armed) {
    return { none: true, slotPlan }; // complete V1 carrier + latch OFF ⇒ legacy (carrier ignored) — byte parity
  }
  // armed + single carrier ⇒ pure activation.
  let input;
  let carrier = null;
  if (hasV2) {
    // (item 6) the OUTER carrier was descriptor-captured ONCE — an accessor/getter is rejected WITHOUT invocation.
    if (snap.refHeroV2.accessor || snap.refHeroV2.value === undefined) {
      return { error: 'strict v2 carrier อ่านไม่ได้ (accessor หรือ undefined) — descriptor-read เท่านั้น', errorType: 'STRICT_V2_CONTRACT_HOLD', reasons: ['carrier_accessor_or_undefined'], slotPlan };
    }
    const c = snap.refHeroV2.value;
    if (c === null || (typeof c !== 'object' && typeof c !== 'function') || Array.isArray(c)) {
      return { error: 'strict v2 carrier ไม่ใช่ออบเจ็กต์', errorType: 'STRICT_V2_CONTRACT_HOLD', reasons: ['carrier_not_object'], slotPlan };
    }
    // (P1) snapshot the inner 6 own-data fields into a NEW FROZEN plain value; reject inner accessor/trap errors.
    const inner = _captureV2Inner(c);
    if (inner.trapError) {
      return { error: 'strict v2 carrier inner descriptor trap', errorType: 'STRICT_V2_CONTRACT_HOLD', reasons: ['carrier_inner_descriptor_trap'], slotPlan };
    }
    if (inner.innerReject) {
      return { error: 'strict v2 carrier inner field accessor', errorType: 'STRICT_V2_CONTRACT_HOLD', reasons: ['carrier_inner_accessor'], slotPlan };
    }
    if (inner.okField !== true) {
      return { error: 'strict v2 carrier ไม่พร้อม (ok!=true)', errorType: 'STRICT_V2_CONTRACT_HOLD', reasons: ['carrier_not_ok'], slotPlan };
    }
    input = inner.input; // frozen plain value — validator reads exactly these six own-data fields
  } else {
    // V1: reconstruct the validator input from the CAPTURED values (TOCTOU-safe — never re-read args). Preserve the
    //   validator's plain-object shape guard: a non-plain carrier (array/function) ⇒ the same typed HOLD.
    if (!snap.isPlain) {
      return { error: 'strict v1 carrier ไม่ใช่ plain object', errorType: 'STRICT_RENDER_CONTRACT_INVALID', reasons: ['input_not_plain_object'], slotPlan };
    }
    input = { selectionSpec: snap.selectionSpec.value, realizedTemplate: snap.realizedTemplate.value };
    carrier = input;
  }
  const decision = validateStrictRenderActivationVersioned(input);
  // V2 canonical assigned
  if (decision && decision.ok === true && decision.decision === 'assigned' && decision.selectionSpec) {
    const prepared = _strictPrepareV2({ decision, slotPlan });
    return prepared.ctx ? { ctx: prepared.ctx, slotPlan } : { ...prepared, slotPlan };
  }
  // V1 strict_ready
  if (decision && decision.decision === 'strict_ready' && decision.active === true && decision.authority) {
    const prepared = _strictPrepareV1({ decision, carrier, slotPlan });
    return prepared.ctx ? { ctx: prepared.ctx, slotPlan } : { ...prepared, slotPlan };
  }
  // อื่นๆ = typed HOLD (ไม่มี downgrade) — errorType ตามชนิด carrier
  const reasons = (decision && Array.isArray(decision.reasons) && decision.reasons.length)
    ? decision.reasons : [(decision && decision.decision) || 'strict_activation_hold'];
  const errorType = hasV2 ? 'STRICT_V2_CONTRACT_HOLD' : 'STRICT_RENDER_CONTRACT_INVALID';
  return { error: `strict contract ไม่ผ่าน: ${reasons.join(',').slice(0, 180)}`, errorType, reasons, slotPlan };
}

// ① เตรียม strict context V1 — pure 100% ห้ามมี IO: (validator ทำที่ _strictActivate แล้ว) → โครง →
//   ผูก primary → snapshot แช่แข็ง · พังชั้นไหน = fail-closed ด้วย errorType เฉพาะชั้นนั้น "ก่อน" IO เสมอ
//   authority = decision.authority (normalized สำเนาลึกจาก validator — ห้ามแตะ raw spec)
function _strictPrepareV1({ decision, carrier, slotPlan }) {
  const authority = decision.authority; // ใช้เฉพาะสำเนา normalized — ห้ามแตะ raw spec ต่อจากนี้
  const realizedTemplate = carrier.realizedTemplate;
  // ชั้น 2 — โครง: ตรวจจาก "ต้นฉบับ" ก่อน clone (NaN/Infinity ตายกลาง JSON round-trip → ถูกซ่อมเงียบ)
  //   ★ รอบ 2 (P1): ห้าม Number() coerce — ต้องเป็น typeof number แท้ + finite + integer (realized จริง
  //   เป็น pixel int จาก refTemplate เสมอ) · ขอบเขต exact ไม่มี tolerance · ห้าม recompute/family/default
  const tReasons = [];
  let spec = null;
  try { spec = JSON.parse(JSON.stringify(realizedTemplate)); } catch { tReasons.push('template_not_serializable'); }
  const _numOk = (v) => typeof v === 'number' && Number.isFinite(v);
  const _pxOk = (v) => _numOk(v) && Number.isInteger(v);
  const W = realizedTemplate?.canvasW, H = realizedTemplate?.canvasH;
  // ★ รอบ 4 (P1-5): canvas ต้อง exact ตามสัญญา refTemplate (ผู้ใช้กำหนดตายตัว 7 ก.ค.: ปกทุกใบ 1080×1350)
  //   — ไม่ใช่แค่ positive integer: 1×1 / 100000×100000 / string / NaN = STRICT_TEMPLATE_INVALID ก่อน IO
  if (!(W === 1080 && H === 1350)) tReasons.push('canvas_invalid');
  const tSlots = Array.isArray(realizedTemplate?.slots) ? realizedTemplate.slots : [];
  if (!tSlots.length) tReasons.push('slots_empty');
  const _ids = new Set();
  for (let i = 0; i < tSlots.length; i++) {
    const s = tSlots[i] || {};
    const id = String(s.id ?? '');
    if (!id.trim()) tReasons.push(`slot_id_blank:${i}`);
    else if (_ids.has(id)) tReasons.push(`slot_id_duplicate:${id}`);
    _ids.add(id);
    const { x, y, w, h } = s;
    if (![x, y, w, h].every(_numOk)) { tReasons.push(`slot_geometry_not_finite:${id || i}`); continue; }
    if (![x, y, w, h].every(Number.isInteger)) tReasons.push(`slot_geometry_not_integer:${id || i}`);
    if (!(w > 0 && h > 0)) tReasons.push(`slot_size_not_positive:${id || i}`);
    if (x < 0 || y < 0 || (_pxOk(W) && x + w > W) || (_pxOk(H) && y + h > H)) tReasons.push(`slot_out_of_canvas:${id || i}`);
    if (s.shape != null && s.shape !== 'circle' && s.shape !== 'rect') tReasons.push(`slot_shape_unknown:${id || i}`);
  }
  if (tReasons.length) return { error: `strict template พัง: ${tReasons.join(',').slice(0, 180)}`, errorType: 'STRICT_TEMPLATE_INVALID', reasons: tReasons };
  _deepFreeze(spec); // โครงที่ render ใช้จริง — แช่แข็งทั้งต้นไม้ก่อน await แรก (executor mutate = throw)
  // ชั้น 3 — ผูก primary → slotPlan: exact URL หนึ่งรายการเป๊ะ (0=หาย · >1=กำกวม) + ★ รอบ 2 (P0-2):
  //   plan ที่ประกาศ refSlotId ต้องตรง authority ด้วย (identity สองชั้น) — พัง = STRICT_PRIMARY_UNAVAILABLE
  //   บันทึกเป็น "สำเนาแช่แข็ง" ก่อน await ทุกตัว: mutate slotPlan ทีหลัง = ไร้ผล (กัน TOCTOU)
  //   ห้ามเก็บ/spread raw plan object — คัดเฉพาะ metadata ที่จำเป็นแบบ copy ค่า
  const bReasons = [];
  const plan = Array.isArray(slotPlan) ? slotPlan : [];
  const bind = authority.slots.map((s) => {
    const matches = plan.filter((p) => String(p?.url || '') === s.primary.imageUrl);
    if (matches.length === 0) { bReasons.push(`primary_missing:${s.composerSlotId}`); return null; }
    if (matches.length > 1) { bReasons.push(`primary_duplicate_in_plan:${s.composerSlotId}`); return null; }
    const m = matches[0];
    // ★ รอบ 3 (FINAL P0): refSlotId เป็น "ภาคบังคับ" ทุก primary row — สัญญา exact ต้องครบสามชั้น
    //   (composerSlotId จาก authority + refSlotId + primary URL) · หาย/null/ว่าง/ไม่ตรง = reject ก่อน IO
    //   ห้าม optional check และห้ามเติมค่าจาก authority ให้ plan เงียบๆ (producer ต้องประกาศเองเต็มปาก)
    const mRef = m.refSlotId == null ? '' : String(m.refSlotId).trim();
    if (!mRef || mRef !== s.refSlotId) {
      bReasons.push(`primary_ref_mismatch:${s.composerSlotId}`);
      return null;
    }
    return Object.freeze({
      composerSlotId: s.composerSlotId,
      refSlotId: s.refSlotId,
      candidateId: s.primary.candidateId,
      imageUrl: s.primary.imageUrl, // fetch ใช้ค่านี้เท่านั้น
      meta: Object.freeze({
        slot: m.slot != null ? String(m.slot) : null,
        person: m.person != null ? String(m.person) : null,
        isHero: !!m.isHero,
        faces: Number(m.faces) || 0,
        clean: m.clean === false ? false : (m.clean === true ? true : null),
        newsScene: m.newsScene === false ? false : (m.newsScene === true ? true : null),
      }),
    });
  });
  if (bReasons.length) return { error: `strict primary ใช้ไม่ได้: ${bReasons.join(',').slice(0, 180)}`, errorType: 'STRICT_PRIMARY_UNAVAILABLE', reasons: bReasons };
  // ชั้น 4 — immutable snapshot ต่อช่อง (แช่แข็ง) = ความจริงที่ final invariant ใช้จับ drift
  const snapshot = Object.freeze(authority.slots.map((s, i) => Object.freeze({
    composerSlotId: s.composerSlotId,
    refSlotId: s.refSlotId,
    candidateId: s.primary.candidateId,
    imageIndex: i, // ลำดับ authority = ลำดับ loaded เสมอ (deterministic)
    imageUrl: s.primary.imageUrl,
    shape: s.shape === 'circle' ? 'circle' : 'rect',
  })));
  // ★ รอบ 2 (P1): template drift snapshot = canonical deep ของ clone "ทั้งก้อน" (รวม zIndex/border/
  //   borderWidth/feather/_vis ฯลฯ ทุก field ที่มีผล render) — ไม่ใช่แค่ x/y/w/h
  const templateSnap = JSON.stringify(spec);
  return { ctx: { authority, spec, bind: Object.freeze(bind), snapshot, templateSnap } };
}

// ---------- 🔐 Wave1A (LANE C — Codex): FLAG-GATED STRICT V2 CONSUMER (SelectionSpec V2 six-field carrier) ----------
// เตรียม strict context จาก "carrier V2" (producer megaAdapters S7, flag MEGA_REF_HERO_V2 + latch MEGA_STRICT_RENDER, default OFF) โดย:
//   ① ผู้ตัดสินเดียว = validateSelectionSpecV2Activation (canonical) พร้อม pin ครบ 6 ช่อง (expectedSpecHash/
//      expectedReplayHash เป็นพยานภายนอกที่ผูก composerSlotId/refId/URL ที่ SelectionAuthority เดี่ยวๆ ผูกไม่ได้)
//   ② partial/missing/tampered = typed HOLD เสมอ — ห้าม fallback เงียบที่ render ผิด
//   ③ source lock: personId/sourceAssetId/candidateId/refSlotId + URL มาจาก spec canonical เท่านั้น (ไม่มี asset
//      substitution) · slotPlan ใช้ "เสริม metadata ครอป" เท่านั้น — plan row ที่ประกาศ identity ขัด = HOLD
//   ④ border color rule: render.border===true ⇒ '#FFFFFF' · render.border===false ⇒ null
//   ctx ที่คืน = shape เดียวกับ V1 (spec/bind/snapshot/templateSnap + authority) → composeCoreStrict/_strictDriftCheck/
//   manifest เดิมใช้ต่อได้ทั้งเส้น "โดยไม่แตะโค้ด V1" (V1 ยัง byte-identical เมื่อ flag V2 ปิด)
// seam เดียวที่ export: production (composeAndVerify) เรียกตัวนี้จริง harness ก็เรียกตัวนี้จริง (ไม่จำลอง logic ซ้ำ)
function _strictPrepareV2({ decision, slotPlan }) {
  const spec2 = decision.selectionSpec; // canonical validated V2 spec (frozen) = ความจริงเดียว
  // ── (P1) render plan มาจาก canonical bindings ล้วน — ต้องครบ 1:1 ทุกแถว: candidateId/personId/
  //   sourceAssetId/refSlotId/composerSlotId ภาคบังคับ (หาย ⇒ HOLD) · ห้ามซ้ำ id (dup ⇒ HOLD) ──
  //   personId ภาคบังคับ "มีค่า" แต่ "ซ้ำได้" (คนเดียวกันปรากฏหลายช่องเป็นเรื่องปกติ — ไม่ใช่ identity key)
  {
    const cReasons = [];
    const _blank = (v) => typeof v !== 'string' || v.trim().length === 0;
    const seen = { refSlotId: new Set(), composerSlotId: new Set(), candidateId: new Set(), sourceAssetId: new Set() };
    for (const s of spec2.slots) {
      const p = s.primary || {};
      const tag = s.composerSlotId || s.refSlotId || '?';
      const fields = { refSlotId: s.refSlotId, composerSlotId: s.composerSlotId, candidateId: p.candidateId, personId: p.personId, sourceAssetId: p.sourceAssetId };
      for (const k of ['refSlotId', 'composerSlotId', 'candidateId', 'personId', 'sourceAssetId']) {
        if (_blank(fields[k])) cReasons.push(`plan_row_missing_${k}:${tag}`);
      }
      for (const k of ['refSlotId', 'composerSlotId', 'candidateId', 'sourceAssetId']) {
        const v = fields[k];
        if (!_blank(v)) { if (seen[k].has(v)) cReasons.push(`plan_row_dup_${k}:${v}`); else seen[k].add(v); }
      }
    }
    if (cReasons.length) return { error: `strict v2 canonical plan ไม่ครบ 1:1: ${cReasons.join(',').slice(0, 180)}`, errorType: 'STRICT_V2_PLAN_INCOMPLETE', reasons: cReasons };
  }
  // ── (P1) HERO crop authority = แมปผ่าน spec.hero.heroSlotId (refSlotId) → composerSlotId ของแถวนั้น
  //   เท่านั้น — ห้ามใช้ regex /main|hero/ · หาแถวไม่เจอ ⇒ HOLD ──
  const heroSlotId = spec2.hero.heroSlotId;
  const heroRow = spec2.slots.find((s) => s.refSlotId === heroSlotId);
  if (!heroRow) return { error: `strict v2 hero slot ไม่ถูกแมป: ${heroSlotId}`, errorType: 'STRICT_V2_HERO_UNMAPPED', reasons: [`hero_slot_unmapped:${heroSlotId}`] };
  const heroComposerSlotId = heroRow.composerSlotId;
  // ── source lock + metadata bind: URL/identity มาจาก spec canonical · plan ที่ขัด identity = substitution ⇒ HOLD ──
  const plan = Array.isArray(slotPlan) ? slotPlan : [];
  const bReasons = [];
  const bind = spec2.slots.map((s) => {
    const url = s.primary.imageUrl;
    const matches = plan.filter((p) => String(p?.url || '') === url);
    if (matches.length > 1) { bReasons.push(`primary_duplicate_in_plan:${s.composerSlotId}`); return null; }
    const m = matches.length === 1 ? matches[0] : null;
    if (m) {
      // ★ (item 9) plan row ที่ประกาศ identity ขัดกับ canonical = substitution ⇒ HOLD — ตรวจ "ทุก" mandatory
      //   identity field: refSlotId · composerSlotId · candidateId · sourceAssetId · personId (ไม่เว้น personId/composer)
      const mRef = m.refSlotId == null ? null : String(m.refSlotId).trim();
      if (mRef && mRef !== s.refSlotId) { bReasons.push(`primary_ref_mismatch:${s.composerSlotId}`); return null; }
      const mComposer = m.composerSlotId == null ? null : String(m.composerSlotId).trim();
      if (mComposer && mComposer !== s.composerSlotId) { bReasons.push(`primary_composer_mismatch:${s.composerSlotId}`); return null; }
      const mCand = m.candidateId == null ? null : String(m.candidateId).trim();
      if (mCand && mCand !== s.primary.candidateId) { bReasons.push(`primary_candidate_mismatch:${s.composerSlotId}`); return null; }
      const mAssetRaw = m.sourceAssetId != null ? m.sourceAssetId : m.assetId;
      const mAsset = mAssetRaw == null ? null : String(mAssetRaw).trim();
      if (mAsset && mAsset !== s.primary.sourceAssetId) { bReasons.push(`primary_asset_mismatch:${s.composerSlotId}`); return null; }
      const mPerson = m.personId == null ? null : String(m.personId).trim();
      if (mPerson && mPerson !== s.primary.personId) { bReasons.push(`primary_person_mismatch:${s.composerSlotId}`); return null; }
    }
    return Object.freeze({
      composerSlotId: s.composerSlotId,
      refSlotId: s.refSlotId,
      candidateId: s.primary.candidateId,
      sourceAssetId: s.primary.sourceAssetId,
      personId: s.primary.personId,
      imageUrl: url, // fetch ใช้ค่านี้เท่านั้น (จาก authority — ไม่ใช่ plan)
      borderColor: s.render.border === true ? '#FFFFFF' : null,
      meta: Object.freeze({
        slot: m && m.slot != null ? String(m.slot) : null,
        person: s.primary.personId != null ? String(s.primary.personId) : (m && m.person != null ? String(m.person) : null),
        isHero: s.refSlotId === heroSlotId ? true : !!(m && m.isHero),
        faces: m ? (Number(m.faces) || 0) : 0,
        clean: m ? (m.clean === false ? false : (m.clean === true ? true : null)) : null,
        newsScene: m ? (m.newsScene === false ? false : (m.newsScene === true ? true : null)) : null,
      }),
    });
  });
  if (bReasons.length) return { error: `strict v2 primary source lock ขัดแย้ง: ${bReasons.join(',').slice(0, 180)}`, errorType: 'STRICT_V2_PRIMARY_UNAVAILABLE', reasons: bReasons };
  // ── realized executor template จาก canonical canvas + slot render (border color rule ที่จุด render จริง) ──
  const spec = _deepFreeze({
    id: spec2.canvas.templateId,
    canvasW: spec2.canvas.canvasW,
    canvasH: spec2.canvas.canvasH,
    feather: spec2.canvas.feather,
    slots: spec2.slots.map((s) => {
      const slot = {
        id: s.composerSlotId,
        x: s.render.x, y: s.render.y, w: s.render.w, h: s.render.h,
        zIndex: s.render.zIndex,
        border: s.render.border === true ? '#FFFFFF' : null, // ★ border color rule
        borderWidth: s.render.borderWidth,
      };
      if (s.shape === 'circle') slot.shape = 'circle';
      return slot;
    }),
  });
  // ── immutable snapshot ราย slot (imageIndex = ลำดับ authority) — ความจริงที่ final invariant ใช้จับ drift ──
  const snapshot = Object.freeze(spec2.slots.map((s, i) => Object.freeze({
    composerSlotId: s.composerSlotId,
    refSlotId: s.refSlotId,
    candidateId: s.primary.candidateId,
    sourceAssetId: s.primary.sourceAssetId,
    personId: s.primary.personId,
    imageIndex: i,
    imageUrl: s.primary.imageUrl,
    shape: s.shape === 'circle' ? 'circle' : 'rect',
    borderColor: s.render.border === true ? '#FFFFFF' : null,
  })));
  const templateSnap = JSON.stringify(spec);
  const authority = { refId: spec2.refId, specHash: spec2.specHash, replayHash: spec2.replayHash };
  return { ctx: { v2: true, authority, spec, bind: Object.freeze(bind), snapshot, templateSnap, selectionSpecV2: spec2, heroComposerSlotId } };
}

// ② เส้นประกอบ strict — source ล็อกตาม authority 100%: โหลดตรง URL → ตาหาหน้า (เพื่อครอปเท่านั้น) →
//   assignments ตายตัวครั้งเดียว → render ครั้งเดียว · ไม่มีด่านสลับภาพใดๆ (crop/why ปรับได้ · imageIndex ห้าม)
//   หมายเหตุ: pixel-gate hero/person-cut ของ legacy เป็นด่านชนิด "เปลี่ยนรูป" ซึ่งขัดสัญญา strict — เส้นนี้
//   จึงไม่รัน (คุณภาพยังถูกวัดด้วย upscaled_src/traceQcFlags/techRules และ hard QC ปลายทางปฏิเสธได้)
async function composeCoreStrict(strictCtx) {
  const qcFlags = [];
  const spec = strictCtx.spec;
  // ★ (P1) hero crop authority: V2 = แมปตรงด้วย composerSlotId ที่ได้จาก spec.hero.heroSlotId เท่านั้น
  //   (ห้าม regex) · V1/legacy = พฤติกรรมเดิม /main|hero/ (byte-identical)
  const _isHeroSlot = (composerSlotId) => (strictCtx.v2 && strictCtx.heroComposerSlotId != null)
    ? (String(composerSlotId) === strictCtx.heroComposerSlotId)
    : /main|hero/i.test(String(composerSlotId));
  // โหลดจาก binding record แช่แข็งเท่านั้น (★ รอบ 2 P0-2 — ห้ามอ่าน slotPlan อีก กัน TOCTOU)
  //   วางผลด้วย index (ลำดับ authority) = ไม่ขึ้นกับลำดับ fetch เสร็จ · loaded พก identity ครบทุกใบ
  //   ★ รอบ 2 (P1): วัดไฟล์จริงด้วย sharp metadata — อ่านไม่ได้/มิติเพี้ยน = corrupt → fail-closed
  const loaded = new Array(strictCtx.bind.length).fill(null);
  const loadFail = [];
  const trimFlags = new Array(strictCtx.bind.length).fill(null);
  await Promise.all(strictCtx.bind.map(async (b, i) => {
    let buf = await fetchOne(b.imageUrl);
    if (!buf || buf.length <= 5000) { loadFail.push(`primary_unusable:${b.composerSlotId}`); return; }
    // ★ รอบ 4 (P1-1): same-asset preprocessing เหมือน legacy — ตัดกรอบสีทึบ/letterbox "ก่อน"
    //   sharp metadata/aHash/face/render ทุกชั้นเห็นภาพสะอาดตรงกัน · URL/identity/imageIndex ไม่ขยับ
    //   (นี่คือ crop ต้นฉบับเดิม ไม่ใช่ source swap) · trim ล้ม = ใช้ buffer เดิม (fail-open ในตัวฟังก์ชัน)
    try {
      const tr = await trimVividBorder(buf);
      if (tr.trimmed) {
        trimFlags[i] = `border_trimmed:${b.composerSlotId}`;
        console.log(`[MegaComposer] 🔐✂️🟩 ตัดกรอบสีขอบภาพ ${tr.trimmed} — ${b.composerSlotId}`);
        buf = tr.buf;
      }
    } catch { /* trim ล้ม = buffer เดิม */ }
    let mw = 0, mh = 0;
    try {
      const m = await (await import('sharp')).default(buf).metadata();
      mw = m.width || 0; mh = m.height || 0;
    } catch { /* จับรวมด้านล่าง */ }
    if (!(mw > 0 && mh > 0)) { loadFail.push(`primary_unreadable:${b.composerSlotId}`); return; }
    loaded[i] = {
      slot: b.meta.slot, person: b.meta.person, isHero: b.meta.isHero, faces: b.meta.faces,
      clean: b.meta.clean, newsScene: b.meta.newsScene,
      composerSlotId: b.composerSlotId, refSlotId: b.refSlotId, candidateId: b.candidateId,
      // ★ V2: identity เต็ม(sourceAssetId/personId) เข้า loaded เพื่อ drift-check + manifest · V1 ไม่มี = ไม่เพิ่ม key
      ...(b.sourceAssetId !== undefined ? { sourceAssetId: b.sourceAssetId } : {}),
      ...(b.personId !== undefined ? { personId: b.personId } : {}),
      imageUrl: b.imageUrl, url: b.imageUrl, buffer: buf, _w: mw, _h: mh,
    };
  }));
  if (loadFail.length) {
    loadFail.sort(); // deterministic ไม่ขึ้นกับลำดับ fetch ล้ม
    return { error: `strict primary โหลดไม่ได้: ${loadFail.join(',').slice(0, 180)}`, errorType: 'STRICT_PRIMARY_UNAVAILABLE', reasons: loadFail };
  }
  for (const f of trimFlags) if (f) qcFlags.push(f); // ★ ธง trim ตามลำดับ index (deterministic) ไม่ใช่ลำดับ fetch เสร็จ
  // ★ รอบ 2 (P1 คุณภาพ): aHash จริงเหมือน legacy — ด่าน blank_image ปลายทางห้ามถูก bypass
  //   (ธงได้ · เปลี่ยนภาพไม่ได้ — S6 authority คือผู้เลือก)
  const _sharp = (await import('sharp')).default;
  const aHashes = await Promise.all(loaded.map(async (im) => {
    try {
      const raw = await _sharp(im.buffer).greyscale().resize(8, 8, { fit: 'fill' }).raw().toBuffer();
      const mean = raw.reduce((n, v) => n + v, 0) / 64;
      let bits = 0n;
      for (let i = 0; i < 64; i++) if (raw[i] >= mean) bits |= (1n << BigInt(i));
      return bits;
    } catch { return null; }
  }));
  // ตาหาหน้า = perception ให้สูตรครอปเท่านั้น — ห้ามมีผลต่อการเลือกภาพ (เลือกจบแล้วโดย authority)
  //   ★ รอบ 2 (P1): ล้มทั้งชุด → ลองใหม่ 1 รอบเหมือน legacy (คุณภาพครอปต้องไม่แย่กว่า — source ไม่เกี่ยว)
  const { batchDetectFaces } = await import('@/lib/services/faceDetector');
  let fdMap = await batchDetectFaces(loaded.map((im, i) => ({ id: `mc_${i}`, buffer: im.buffer })));
  let faceBoxes = loaded.map((im, i) => normalizeFaceBox(fdMap?.get?.(`mc_${i}`)));
  // ★ รอบ 5 (P1 semantic trap — Codex): normalizeFaceBox คืน object truthy (count=0, กรอบ 0) เมื่อ
  //   ไม่มีหน้าแต่มี mainSubject/textRegion/watermark → filter(Boolean) นับ "ไม่มีหน้า" เป็น "เจอหน้า"
  //   = detector ล่มแต่เกท outage เป็นใบ้ · นับเฉพาะ "หน้าจริง": count>0 + กรอบมีพื้นที่จริง
  //   (กล่อง subject-only ยังส่งต่อให้ crop fallback ใช้ได้ตามเดิม — แค่ห้ามนับเป็นใบหน้า)
  const _realFace = (fb) => !!(fb && (fb.count || 0) > 0 && fb.x2 > fb.x1 && fb.y2 > fb.y1);
  let actualFaceHits = faceBoxes.filter(_realFace).length;
  if (actualFaceHits === 0 && loaded.length) {
    console.log('[MegaComposer] 🔐⚠️ ตาหาหน้า (หน้าจริง) ศูนย์ทั้งชุด → ลองใหม่ 1 รอบ');
    fdMap = await batchDetectFaces(loaded.map((im, i) => ({ id: `mc_${i}`, buffer: im.buffer })));
    faceBoxes = loaded.map((im, i) => normalizeFaceBox(fdMap?.get?.(`mc_${i}`)));
    actualFaceHits = faceBoxes.filter(_realFace).length;
    // ★ รอบ 4 (P1-4): perception-outage gate เหมือน legacy — retry แล้วยังศูนย์ทั้งชุด ทั้งที่ metadata
    //   จาก binding ยืนยันมีหน้า ≥2 ใบ = detector ล่มยาว → คืน error ให้คิววนใหม่ ห้ามปล่อยปกครอปตาบอด
    //   (เกทนี้ตรวจ "ตาล่ม" เท่านั้น — ไม่ใช่ face lock/กติกาคน และไม่แตะ/ไม่สลับ asset ใดๆ)
    const expectFaces = loaded.filter((im) => Number(im.faces) > 0).length;
    if (actualFaceHits === 0 && expectFaces >= 2) {
      return { error: `ตาหาหน้าล่มทั้งชุด (ตาคัดยืนยันว่ามีหน้า ${expectFaces} ใบ) — กันปกครอปตาบอด รอระบบฟื้นแล้วลองใหม่`, errorType: 'FACE_EYE_DOWN' };
    }
  }
  console.log(`[MegaComposer] 🔐 strict: primary ${loaded.length} ใบตรง URL · หน้าจริง ${actualFaceHits}/${loaded.length}`);
  // assignments ตรงจาก authority — สร้างครั้งเดียว · crop ใช้สูตรเดิมของโรง (same-image เท่านั้น)
  const _bigFace = (fb) => fb && fb.x2 > fb.x1 && (fb.y2 - fb.y1) >= 0.16 && fb.y1 >= 0.01 && fb.y2 <= 0.99;
  // ★ รอบ 6 (P1-B): "subject-only" = ไม่มีหน้าจริงแต่ detector เห็นตัวเรื่อง (fb.subject กรอบมีพื้นที่จริง)
  //   → hint ครอบ subject "ไม่ตั้ง _final" — renderRectTile เช็ค crop._final ก่อน branch subject-box
  //   (executor:669 vs 673) เดิม _final generic จึงบังทาง subject สนิท · วงกลม noface-square ก็ใช้ hint นี้
  //   เผื่อเหนือหัว 12% / ใต้ 5% ของสูง subject · clamp 0..1 · deterministic ล้วน · ไม่แตะ source/index
  // ★ รอบ 7 (P1-1): subject ต้อง "ใช้ได้จริง" — finite ครบสี่ค่า · พื้นที่บวก · มีส่วนทับจริงกับผืน [0,1]²
  //   (กล่องหลุดนอกภาพทั้งกล่อง/ค่า NaN-Infinity = ค่าหลอนจาก detector → ถอย generic fallback เดิม)
  const _subjectValid = (fb) => {
    if (!fb || _realFace(fb) || !fb.subject) return false;
    const s = fb.subject;
    if (![s.x1, s.y1, s.x2, s.y2].every(Number.isFinite)) return false;
    if (!(s.x2 > s.x1 && s.y2 > s.y1)) return false;
    if (s.x2 <= 0 || s.x1 >= 1 || s.y2 <= 0 || s.y1 >= 1) return false; // off-canvas ทั้งกล่อง
    return true;
  };
  const _subjectCrop = (fb) => {
    const s = fb.subject;
    // ใช้เฉพาะส่วนของ subject ที่อยู่ในภาพจริง (กล่องเลยขอบบางส่วน = intersect ก่อน)
    const sx1 = Math.max(0, s.x1), sy1 = Math.max(0, s.y1);
    const sx2 = Math.min(1, s.x2), sy2 = Math.min(1, s.y2);
    const sh = sy2 - sy1;
    let x = sx1;
    let y = Math.max(0, sy1 - sh * 0.12); // เผื่อเหนือหัว 12%
    let w = sx2 - x;
    let h = Math.min(1, sy2 + sh * 0.05) - y; // เผื่อใต้ 5%
    // ขั้นต่ำ 0.05: ขยายแล้ว "เลื่อน origin กลับเข้าภาพ" — ห้ามดัน x+w/y+h ทะลุ 1
    if (w < 0.05) { w = 0.05; x = Math.min(x, 1 - w); }
    if (h < 0.05) { h = 0.05; y = Math.min(y, 1 - h); }
    x = Math.max(0, +x.toFixed(3));
    y = Math.max(0, +y.toFixed(3));
    w = +w.toFixed(3);
    h = +h.toFixed(3);
    // การปัด 3 ตำแหน่งห้ามทำเกินขอบ — บีบด้านที่เกินกลับพอดี 1
    if (x + w > 1) w = +(1 - x).toFixed(3);
    if (y + h > 1) h = +(1 - y).toFixed(3);
    return { x, y, w, h };
  };
  const assignments = strictCtx.snapshot.map((snap, i) => {
    const slot = spec.slots.find((x) => String(x.id) === snap.composerSlotId);
    const fb = faceBoxes[i];
    let crop;
    if (_isHeroSlot(snap.composerSlotId)) {
      if (fb && fb.x2 > fb.x1) crop = cropFromFace(fb, 62, 'upper', slot.w / slot.h);
      else if (_subjectValid(fb)) crop = _subjectCrop(fb);
      else crop = { x: 0, y: 0, w: 1, h: 1 };
    } else if (snap.shape === 'circle') {
      if (fb && fb.x2 > fb.x1) crop = cropFromFace(fb, 66, 'center', 1);
      else if (_subjectValid(fb)) crop = _subjectCrop(fb); // hint ครอบ subject — วงถูกย่อจากตำแหน่งจริง ไม่ใช่ generic กลางภาพ
      else crop = { x: 0.2, y: 0.05, w: 0.6, h: 0.6, _final: true };
    } else if (fb && (fb.count || 1) > 1) {
      crop = cropAllFaces(fb, slot.w / slot.h);
    } else if (_bigFace(fb)) {
      crop = cropFromFace(fb, 52, 'upper', slot.w / slot.h);
    } else if (fb && fb.x2 > fb.x1) {
      crop = cropFromFace(fb, 40, 'center', slot.w / slot.h);
    } else if (_subjectValid(fb)) {
      crop = _subjectCrop(fb); // rect: ไม่มี _final = เปิดทาง executor เข้า subject-box
    } else {
      crop = { x: 0.02, y: 0, w: 0.96, h: 0.94, _final: true }; // ไม่มีทั้งหน้าจริงและ subject เท่านั้น
    }
    return { slotId: snap.composerSlotId, imageIndex: i, crop, why: 'strict: ref-slot authority' };
  });
  const used = new Set(assignments.map((a) => a.imageIndex));
  // คุณภาพ (pure): วัดยืดต่อช่องรอง — ติดธงได้ ห้ามเลือกภาพอื่น (สัญญา strict)
  const _wh = (im, fb) => (im && im._w > 0 && im._h > 0) ? [im._w, im._h] : (fb && fb.imgW > 0 && fb.imgH > 0 ? [fb.imgW, fb.imgH] : [0, 0]);
  for (const a of assignments) {
    const sl = spec.slots.find((x) => String(x.id) === a.slotId);
    if (!sl || _isHeroSlot(a.slotId)) continue;
    const [iw, ih] = _wh(loaded[a.imageIndex], faceBoxes[a.imageIndex]);
    if (!(iw > 0 && ih > 0)) continue;
    const up = (iw / ih) >= (sl.w / sl.h) ? sl.h / ih : sl.w / iw;
    if (up > 1.6) qcFlags.push(`upscaled_src:${a.slotId}:${up.toFixed(2)}`);
  }
  assignments.forEach((a) => {
    console.log(`[MegaComposer] 🔐 ${a.slotId} ← #${a.imageIndex} (authority) ${a.crop._final ? 'crop' : 'hint'}(${a.crop.x},${a.crop.y},${a.crop.w},${a.crop.h})`);
  });
  // render ครั้งเดียว — ไม่มี retry-เปลี่ยนรูป
  const { executeCover } = await import('@/lib/services/coverExecutorService');
  const traceSink = [];
  const buffer = await executeCover({ assignments, imageBuffers: loaded, templateSpec: spec, faceBoxes, traceSink });
  console.log(`[MegaComposer] 🔐 strict ประกอบเสร็จ ${Math.round(buffer.length / 1024)}KB (${spec.id || 'realized'})`);
  const cropTrace = [...traceSink];
  qcFlags.push(...traceQcFlags(cropTrace));
  if (qcFlags.length) console.log(`[MegaComposer] 🚩 qcFlags: ${qcFlags.join(' · ')}`);
  // shape ผลลัพธ์ = เดียวกับ legacy core ทุก field + ป้าย _strictSourceLock ให้ชั้น Eye ล็อก source
  // (aHashes = ค่าจริง — ด่าน blank_image ใน composeAndVerify ทำงานเต็ม ★ รอบ 2 P1)
  // ★ (item 8) แนบ canonical heroComposerSlotId (V2 เท่านั้น) ลง core → Eye path/recrop/measurement กันช่อง hero
  //   ตัวจริงด้วย exact id (ไม่พึ่ง regex /main|hero/) · V1/legacy = null ⇒ regex เดิม byte-identical
  return { buffer, spec, assignments, loaded, faceBoxes, used, refSlotMeta: null, cropTrace, qcFlags, traceSink, aHashes, _strictSourceLock: true, heroComposerSlotId: (strictCtx.v2 && strictCtx.heroComposerSlotId != null) ? strictCtx.heroComposerSlotId : null };
}

// ③ final invariant — เรียกหลัง Eye จบ ก่อน techRules/manifest/success: จับ drift ทุกมิติเทียบ snapshot
//   (นับช่อง · เซ็ต composer slot เป๊ะ · ไม่ซ้ำ/หาย/เกิน · URL ของ loaded ตรง primary · index ตรง · โครงไม่ drift)
function _strictDriftCheck(core, strictCtx) {
  const reasons = [];
  const snap = strictCtx.snapshot;
  const asg = Array.isArray(core.assignments) ? core.assignments : [];
  if (asg.length !== snap.length) reasons.push(`assignment_count:${asg.length}!=${snap.length}`);
  const bySlot = new Map();
  for (const a of asg) {
    const id = String(a?.slotId || '');
    if (bySlot.has(id)) reasons.push(`assignment_duplicate:${id}`);
    bySlot.set(id, a);
  }
  for (const s of snap) {
    const a = bySlot.get(s.composerSlotId);
    if (!a) { reasons.push(`assignment_missing:${s.composerSlotId}`); continue; }
    bySlot.delete(s.composerSlotId);
    if (a.imageIndex !== s.imageIndex) reasons.push(`image_index_drift:${s.composerSlotId}:${a.imageIndex}`);
    const url = String(core.loaded?.[a.imageIndex]?.url || '');
    if (url !== s.imageUrl) reasons.push(`image_url_drift:${s.composerSlotId}`);
  }
  for (const id of bySlot.keys()) reasons.push(`assignment_extra:${id}`);
  // ★ รอบ 2 (P1): loaded ต้องครบ identity ทุกใบ — จำนวนเท่า authority · ไม่มี null/เกิน ·
  //   url + composerSlotId + refSlotId + candidateId ตรง snapshot ราย index
  const loaded = Array.isArray(core.loaded) ? core.loaded : [];
  if (loaded.length !== snap.length) reasons.push(`loaded_count:${loaded.length}!=${snap.length}`);
  for (let i = 0; i < snap.length; i++) {
    const l = loaded[i];
    const s = snap[i];
    if (!l || !l.buffer) { reasons.push(`loaded_missing:${s.composerSlotId}`); continue; }
    if (String(l.url || '') !== s.imageUrl) reasons.push(`loaded_url_drift:${s.composerSlotId}`);
    if (String(l.composerSlotId || '') !== s.composerSlotId) reasons.push(`loaded_slot_identity_drift:${s.composerSlotId}`);
    if (String(l.refSlotId || '') !== s.refSlotId) reasons.push(`loaded_ref_identity_drift:${s.composerSlotId}`);
    if (String(l.candidateId || '') !== s.candidateId) reasons.push(`loaded_candidate_drift:${s.composerSlotId}`);
    // ★ V2: sourceAssetId/personId เป็น identity ภาคบังคับใน drift-check เช่นกัน (snapshot มีเฉพาะ V2 → V1 ข้าม)
    if (s.sourceAssetId !== undefined && String(l.sourceAssetId || '') !== s.sourceAssetId) reasons.push(`loaded_asset_drift:${s.composerSlotId}`);
    if (s.personId !== undefined && String(l.personId || '') !== s.personId) reasons.push(`loaded_person_drift:${s.composerSlotId}`);
  }
  for (let i = snap.length; i < loaded.length; i++) reasons.push(`loaded_extra:${i}`);
  // ★ รอบ 2 (P1): used Set ต้องเท่ากับเซ็ต imageIndex ของ assignments สุดท้ายเป๊ะ
  if (!(core.used instanceof Set)) reasons.push('used_not_set');
  else {
    const uSorted = [...core.used].sort((a, b) => a - b).join(',');
    const idxSet = new Set(asg.map((a) => a?.imageIndex));
    const iSorted = [...idxSet].sort((a, b) => a - b).join(',');
    if (uSorted !== iSorted || core.used.size !== idxSet.size) reasons.push(`used_set_mismatch:[${uSorted}]!=[${iSorted}]`);
  }
  // ★ รอบ 2 (P1): โครงเทียบ canonical deep snapshot "ทั้งก้อน" (spec เป็น object แช่แข็งตัวเดิม —
  //   drift check คือกำแพงชั้นสองต่อจาก freeze)
  let nowSnap = null;
  try { nowSnap = JSON.stringify(core.spec); } catch { /* serialize ไม่ได้ = drift แน่นอน */ }
  if (nowSnap !== strictCtx.templateSnap) reasons.push('template_drift');
  return reasons.length ? reasons : null;
}

async function composeCore({ slotPlan = [], refDNA = null, stableOrder = false, strictCtx = null }) {
  // ★ Checkpoint B รอบ 2: strict แยก path ตั้งแต่บรรทัดแรก — ก่อน guard legacy ทุกตัว (แผนหาย
  //   ถูก _strictPrepare จับเป็น STRICT_PRIMARY_UNAVAILABLE ไปแล้ว) · strictCtx=null = legacy เดิมเป๊ะ
  if (strictCtx) return composeCoreStrict(strictCtx);
  if (!Array.isArray(slotPlan) || !slotPlan.length) {
    return { error: 'ไม่มี slotPlan — S6 ต้องเลือกภาพมาก่อน', errorType: 'NO_SLOT_PLAN' };
  }
  // ★ เฟส 4.3: ธงคุณภาพ deterministic ต่อใบ (แนบ response+คลัง) — ใช้แทน ref% ที่พิสูจน์แล้วว่าสวนตาคนจริง
  const qcFlags = [];

  // ── ① โหลดภาพทั้งแผน (หลัก+สำรอง) — ลิงก์ตรงพัง → thumbnail ──
  // ★ เฟส 0.2 (โหมดเทสนิ่ง): stableOrder=true → เก็บผลตาม index ของ slotPlan แทน "ลำดับ fetch เสร็จ"
  //   (race เดิมทำให้ช่องรอง/วงกลมสุ่มผลข้ามรอบ เทียบก่อน-หลังจูนไม่ได้) · default ปิด = production เดิมเป๊ะ
  // ★ เฟส 3.4 (10 ก.ค.): kill-switch COMPOSE_MIN_SRC_GATE — unset/'1' = เปิด hard floor 3.1+3.4, '0' = พฤติกรรมเก่า
  const _minSrcGate = process.env.COMPOSE_MIN_SRC_GATE !== '0';
  // ★ เฟส 6B (9 ก.ค. ดึก): kill-switch COMPOSE_FACE_PROMINENCE — unset/'1' = เปิด 6B.2 (hero โทษมุมข้าง)
  //   + 6B.3/6B.4 (ครอปแน่นหน้าเด่น/บริบทไม่โล่ง ที่ executor) · '0' = พฤติกรรมเดิมเป๊ะ (pose ยังเก็บได้ ไม่ใช้)
  const _faceProm = process.env.COMPOSE_FACE_PROMINENCE !== '0';
  const loaded = [];
  const _byIdx = new Array(slotPlan.length).fill(null);
  await Promise.all(slotPlan.map(async (p, _i) => {
    let buf = await fetchOne(p.url);
    // ★ เฟส 3.4: ช่อง hero (isHero) ห้าม fallback thumbnail (ยืดจนเบลอ) — โหลดตรงไม่ได้ = ปล่อยให้ตรรกะเลือก hero ไปใช้ใบอื่น
    if (!buf && p.thumbnailUrl && p.thumbnailUrl !== p.url && !(_minSrcGate && p.isHero)) buf = await fetchOne(p.thumbnailUrl);
    if (buf && buf.length > 5000) {
      // ★ เฟส 4.1: ตัดกรอบสีทึบ/สีจัดที่ขอบ (กรอบเขียวเฟรมคลิป/letterbox) ก่อน detect/ครอป —
      //   ทำตรงนี้ = ทุกชั้นถัดไป (หน้า/aHash/คอลลาจ/ครอป) เห็นภาพสะอาดตรงกันหมด
      const tr = await trimVividBorder(buf);
      if (tr.trimmed) {
        console.log(`[MegaComposer] ✂️🟩 ตัดกรอบสีขอบภาพ ${tr.trimmed} — ...${String(p.url).slice(-36)}`);
        qcFlags.push(`border_trimmed:${p.slot || 'backup'}`);
        buf = tr.buf;
      }
      // ★ เฟส 3.4: วัดพิกเซลจริงจากไฟล์ที่โหลดได้ (ไม่เชื่อ metadata ที่โกหก) — จิ๋ว shortSide<200 ทิ้ง (ห้ามเข้าพูล)
      //   เก็บ _w/_h ติด object → hard floor 3.1 ใช้คำนวณ upscale ต่อได้เลย ไม่ต้องวัดซ้ำ
      let _mw = 0, _mh = 0;
      try { const _m = await (await import('sharp')).default(buf).metadata(); _mw = _m.width || 0; _mh = _m.height || 0; } catch { /* วัดไม่ได้ = ปล่อยผ่านด้วยเกณฑ์ไบต์เดิม */ }
      if (_minSrcGate && _mw > 0 && _mh > 0 && Math.min(_mw, _mh) < 200) {
        console.log(`[MegaComposer] 🚫 ทิ้งภาพจิ๋ว ${_mw}x${_mh} (<200px) — ...${String(p.url).slice(-36)}`);
        return;
      }
      const _rec = { ...p, buffer: buf, ...(_mw > 0 ? { _w: _mw, _h: _mh } : {}) };
      if (stableOrder) _byIdx[_i] = _rec;
      else loaded.push(_rec);
    }
  }));
  if (stableOrder) {
    for (const it of _byIdx) if (it) loaded.push(it);
    console.log('[MegaComposer] 🔒 stableOrder: เรียงภาพตามลำดับ slotPlan (โหมดเทสนิ่ง)');
  }
  console.log(`[MegaComposer] โหลดภาพ ${loaded.length}/${slotPlan.length}`);
  if (loaded.length < 3) {
    return { error: `ภาพโหลดได้ ${loaded.length} ใบ (ต้อง ≥3) — ลิงก์พัง/ภาพข่าวนี้หายาก`, errorType: 'INSUFFICIENT_IMAGES' };
  }

  // ── ② ตาหาหน้า (perception — อินพุตให้สูตร ไม่ใช่คนตัดสิน) ──
  const { batchDetectFaces } = await import('@/lib/services/faceDetector');
  let fdMap = await batchDetectFaces(loaded.map((im, i) => ({ id: `mc_${i}`, buffer: im.buffer })));
  let faceBoxes = loaded.map((im, i) => normalizeFaceBox(fdMap?.get?.(`mc_${i}`)));
  // ★ 9 ก.ค. (hero ไม่นิ่ง — บางรอบตาหาหน้าล้มทั้งชุดแบบเงียบ → ทุกช่องครอปไร้หน้า): เห็น + ซ่อมตัวเอง
  const faceHits = faceBoxes.filter(Boolean).length;
  console.log(`[MegaComposer] ตาหาหน้า: เจอ ${faceHits}/${loaded.length} ใบ`);
  if (faceHits === 0 && loaded.length) {
    console.log('[MegaComposer] ⚠️ ตาหาหน้าล้มทั้งชุด → ลองใหม่ 1 รอบ');
    fdMap = await batchDetectFaces(loaded.map((im, i) => ({ id: `mc_${i}`, buffer: im.buffer })));
    faceBoxes = loaded.map((im, i) => normalizeFaceBox(fdMap?.get?.(`mc_${i}`)));
    console.log(`[MegaComposer] ตาหาหน้า (รอบ 2): เจอ ${faceBoxes.filter(Boolean).length}/${loaded.length} ใบ`);
    // ★ audit B-R2 (คำถามผู้ใช้ "ล่มต้องรอทำซ้ำ ไม่ทำผลเพี้ยน"): retry แล้วยังศูนย์ทั้งชุด ทั้งที่ตาคัด
    //   ยืนยันว่ามีหน้า (slotPlan.faces>0 หลายใบ) = OpenAI ล่มยาว → คืน error ให้คิว/quick-test วนใหม่
    //   แทนปล่อย "ปกครอปตาบอดทุกช่อง" ออกไปเงียบๆ (เพี้ยนหนักสุดในโรงประกอบ)
    const expectFaces = loaded.filter((im) => Number(im.faces) > 0).length;
    if (faceBoxes.filter(Boolean).length === 0 && expectFaces >= 2) {
      return { error: `ตาหาหน้าล่มทั้งชุด (ตาคัดยืนยันว่ามีหน้า ${expectFaces} ใบ) — กันปกครอปตาบอด รอระบบฟื้นแล้วลองใหม่`, errorType: 'FACE_EYE_DOWN' };
    }
  }

  // ── ②b 🔢 aHash 8x8 ต่อภาพ (คณิตล้วน) — กันภาพซ้ำ/เฟรมติดกันจากคลิปลงหลายช่อง (ลายตา) ──
  const sharp = (await import('sharp')).default;
  const aHashes = await Promise.all(loaded.map(async (im) => {
    try {
      const raw = await sharp(im.buffer).greyscale().resize(8, 8, { fit: 'fill' }).raw().toBuffer();
      const mean = raw.reduce((n, v) => n + v, 0) / 64;
      let bits = 0n;
      for (let i = 0; i < 64; i++) if (raw[i] >= mean) bits |= (1n << BigInt(i));
      return bits;
    } catch { return null; }
  }));
  const hamming = (a, b) => { if (a == null || b == null) return 64; let x = a ^ b, n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };

  // ── ②c 🧩 ตรวจภาพคอลลาจ (คณิตล้วน): เส้นตะเข็บตรงยาว ≥86% ของภาพ = หลายเฟรมต่อกัน (IG carousel/แคปคลิป)
  //   ภาพพวกนี้ลงช่องแล้วดู "แตกเป็นหลายช่องปลอม" ไม่ตรง ref — เลี่ยงทุกช่องเมื่อมีทางเลือก ──
  const isCollage = await Promise.all(loaded.map(async (im) => {
    try {
      const S = 200, COVER = 0.86, STEP = 26;
      const raw = await sharp(im.buffer).greyscale().resize(S, S, { fit: 'fill' }).raw().toBuffer();
      const px = (x, y) => raw[y * S + x];
      for (let x = Math.round(S * 0.15); x <= Math.round(S * 0.85); x++) {
        let hit = 0; for (let y = 0; y < S; y++) if (Math.abs(px(x, y) - px(x - 1, y)) >= STEP) hit++;
        if (hit / S >= COVER) return true;
      }
      for (let y = Math.round(S * 0.15); y <= Math.round(S * 0.85); y++) {
        let hit = 0; for (let x = 0; x < S; x++) if (Math.abs(px(x, y) - px(x, y - 1)) >= STEP) hit++;
        if (hit / S >= COVER) return true;
      }
      return false;
    } catch { return false; }
  }));
  if (isCollage.some(Boolean)) console.log(`[MegaComposer] 🧩 ภาพคอลลาจ: ${isCollage.map((c, i) => (c ? '#' + i : null)).filter(Boolean).join(' ')} — เลี่ยงเมื่อมีทางเลือก`);

  // ── ③ โครง: จริงจาก ref DNA → family จูนมือ → มาตรฐาน ──
  const { V3_TEMPLATES } = await import('@/lib/services/coverExecutorService');
  let spec = null;
  let refSlotMeta = null; // 1:1 กับ spec.slots เมื่อใช้โครงจริง (พก faceSizePct จาก ref)
  if (refDNA) {
    const { dnaToTemplateSpec } = await import('@/lib/refTemplate');
    spec = dnaToTemplateSpec(refDNA);
    if (spec && spec.slots.length > loaded.length) {
      console.log(`[MegaComposer] โครง ref ${spec.slots.length} ช่อง > ภาพ ${loaded.length} → ลด`);
      spec = null;
    }
    // ★ 9 ก.ค. แก้บั๊กเงียบ (AC-0023): DNA slots จริงอยู่ที่ template.slots — เดิมชี้ refDNA.slots (ไม่มีจริง)
    //   → meta ว่างตลอด ข้อมูล subject/faceSizePct ต่อช่องจาก ref ที่ตาคนยืนยันไม่เคยถูกใช้
    // ★ เฟส 1.5 (9 ก.ค. บ่าย — root cause #8): เลิก gate "จำนวนช่องต้องเท่ากันเป๊ะ" (โครงถูกซ่อม/ตัดช่องเมื่อไหร่
    //   meta หายทั้งชุด) — id ของ spec ฝัง index ต้นทางอยู่แล้ว (`role_${i}` จาก refTemplate.js) → map รายช่อง:
    //   main→ช่อง role hero · circle ลูกที่ n→วงกลมลูกที่ n ของ DNA · `xxx_${i}`→template.slots[i]
    if (spec) {
      const tSlots = refDNA.template?.slots || refDNA.slots || [];
      if (tSlots.length) {
        const isCirc = (s) => String(s?.shape || '').toLowerCase() === 'circle' || /circle|วงกลม/i.test(String(s?.role || ''));
        const circIdx = tSlots.map((s, i) => (isCirc(s) ? i : -1)).filter((i) => i >= 0);
        const heroT = tSlots.find((s) => !isCirc(s) && /hero/i.test(String(s?.role || ''))) || null;
        let circleSeen = 0;
        refSlotMeta = spec.slots.map((sl) => {
          if (sl.shape === 'circle') { const ti = circIdx[circleSeen++]; return ti != null && tSlots[ti] ? tSlots[ti] : null; }
          if (sl.id === 'main') return heroT;
          const m = String(sl.id).match(/_(\d+)$/);
          return m && tSlots[Number(m[1])] ? tSlots[Number(m[1])] : null;
        });
        if (refSlotMeta.every((x) => !x)) refSlotMeta = null;
        else console.log(`[MegaComposer] 🎯 ref meta ต่อช่อง: ${refSlotMeta.map((x, i) => `${spec.slots[i].id}=${x ? (x.shot || x.subject || 'มี') : '-'}`).join(' · ')}`);
      }
    }
    if (!spec) {
      const { pickTemplateForDNA } = await import('@/lib/refTemplatePicker');
      const fam = pickTemplateForDNA(refDNA, V3_TEMPLATES);
      if (fam?.spec && fam.spec.slots.length <= loaded.length) spec = fam.spec;
    }
  }
  if (!spec) {
    spec = [V3_TEMPLATES.vt_ref_tri, V3_TEMPLATES.vt_ref_5x4, V3_TEMPLATES.vt_faces_circle]
      .find((t) => t && t.slots.length <= loaded.length) || V3_TEMPLATES.vt_faces_circle;
  }
  console.log(`[MegaComposer] โครง: ${spec.id} (${spec.slots.length} ช่อง) · ${spec.canvasW}x${spec.canvasH}`);
  if (spec?._featherCapped) qcFlags.push('feather_capped'); // ★ เฟส 3.5: DNA รายงาน featherPx เกิน 8 → ถูก cap
  // ★ เฟส 6B.3 (10 ก.ค.): ส่ง "เป้าหน้าเด่น" (faceSizePct จาก ref DNA) ต่อช่องให้ executor —
  //   executor ใช้เป็น "ขั้นต่ำที่ต้องบังคับ" (ไม่ใช่แค่ hint) โดยมี cap ความปลอดภัยของมันเอง กันซูมแน่นเกิน/หัวขาด
  //   refSlotMeta เป็น 1:1 กับ spec.slots เสมอเมื่อไม่ null (map ในบล็อก ref ด้านบน) · _faceProm ปิด = ไม่ส่ง (พฤติกรรมเดิม)
  if (_faceProm && refSlotMeta && refSlotMeta.length === spec.slots.length) {
    spec.slots.forEach((sl, i) => {
      const pct = Number(refSlotMeta[i]?.faceSizePct);
      if (pct >= 15 && pct <= 95) sl._faceTargetShare = +(pct / 100).toFixed(3);
    });
  }

  // ── ③b 👁️‍🗨️ โซนมองเห็นต่อช่อง (9 ก.ค. ผู้ใช้: "โดนทับแล้วหน้าหาย ต้องย่อ/ขยับให้หน้าอยู่โซนที่เห็น") ──
  //   ช่องรองที่มี inset (z≥3)/วงกลมลอยทับ: หาแถบว่างใหญ่สุด (บน/ล่าง/ซ้าย/ขวาของส่วนทับ)
  //   → ติด slot._vis ให้ executor วางหน้า+จำกัดขนาดหน้าในแถบนั้น · hero/วงกลมไม่แตะ (ผู้ใช้ยืนยันดีแล้ว)
  try {
    const overlays = spec.slots.filter((s) => s.shape === 'circle' || (Number(s.zIndex) || 0) >= 3);
    for (const s of spec.slots) {
      if (s.shape === 'circle' || (Number(s.zIndex) || 0) >= 3 || /main|hero/i.test(String(s.id))) continue;
      let vis = { x0: 0, y0: 0, x1: 1, y1: 1 };
      // ★ 10 ก.ค. (ผู้ใช้วงจุด "ภาพซ้อนกันจนคนหัวขาดทั้งแถบ"): เดิมคิดแค่วงกลม/inset ลอย —
      //   พาเนล rect ที่โครง ref ปิดผืนแล้ว "ซ้อนกันเอง" (ยอมรับ overlap เพื่อไม่ให้มีร่อง) ไม่ถูกคิด
      //   → แถบทับตรงตะเข็บกินหัวคนพอดี · เพิ่ม: เพื่อนบ้านที่ render ทับข้างบน (z สูงกว่า / z เท่ากันแต่มาทีหลัง) นับเป็นส่วนบังด้วย
      const _sZ = Number(s.zIndex) || 0;
      const _sIdx = spec.slots.indexOf(s);
      const covers = [...overlays, ...spec.slots.filter((o) => {
        if (o === s || o.shape === 'circle' || (Number(o.zIndex) || 0) >= 3) return false;
        const oZ = Number(o.zIndex) || 0;
        return oZ > _sZ || (oZ === _sZ && spec.slots.indexOf(o) > _sIdx);
      })];
      for (const o of covers) {
        const ix0 = Math.max(0, (o.x - s.x) / s.w), iy0 = Math.max(0, (o.y - s.y) / s.h);
        const ix1 = Math.min(1, (o.x + o.w - s.x) / s.w), iy1 = Math.min(1, (o.y + o.h - s.y) / s.h);
        if (ix1 <= ix0 || iy1 <= iy0) continue;
        if ((ix1 - ix0) * (iy1 - iy0) < 0.08) continue; // ทับนิดเดียว ไม่ต้องหลบ
        const cands = [
          { ...vis, y1: Math.min(vis.y1, iy0) },  // แถบบน
          { ...vis, y0: Math.max(vis.y0, iy1) },  // แถบล่าง
          { ...vis, x1: Math.min(vis.x1, ix0) },  // แถบซ้าย
          { ...vis, x0: Math.max(vis.x0, ix1) },  // แถบขวา
        ].filter((c) => c.x1 - c.x0 > 0.18 && c.y1 - c.y0 > 0.18);
        if (cands.length) vis = cands.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))[0];
      }
      if (vis.x0 > 0.02 || vis.y0 > 0.02 || vis.x1 < 0.98 || vis.y1 < 0.98) {
        s._vis = { x0: +vis.x0.toFixed(2), y0: +vis.y0.toFixed(2), x1: +vis.x1.toFixed(2), y1: +vis.y1.toFixed(2) };
        console.log(`[MegaComposer] 👁️‍🗨️ ${s.id} โดนทับ → โซนหน้า x${s._vis.x0}-${s._vis.x1} y${s._vis.y0}-${s._vis.y1}`);
      }
    }
  } catch { /* คำนวณโซนล้ม → วางแบบเดิม */ }

  // ── ③c ⭕ แบตช์ C (C2): แนบ slot._circleZone (frac ของช่อง) ให้ executor bias หน้าออกนอกวง ──
  //   เฉพาะช่องรอง (ไม่ใช่ hero) ที่วง template ทับ · margin = CIRCLE_FACE_GAP_PCT ของกว้าง canvas (ตรง measureTechRules)
  //   สวิตช์ปิด (MEGA_CIRCLE_AVOID=0) = ไม่แนบ → executor ไม่แตะ region (byte-parity)
  if (process.env.MEGA_CIRCLE_AVOID !== '0') {
    try {
      const _cW = Number(spec?.canvasW) || 0;
      const _circleSlots = spec.slots
        .filter((s) => s.shape === 'circle' && s.w > 0)
        .map((s) => ({ cx: s.x + s.w / 2, cy: s.y + s.h / 2, d: s.w }));
      if (_circleSlots.length && _cW) {
        const _mPx = _cW * (TECH_RULES.CIRCLE_FACE_GAP_PCT / 100);
        for (const s of spec.slots) {
          if (s.shape === 'circle' || /main|hero/i.test(String(s.id))) continue; // ห้ามแตะ hero
          let zone = null;
          for (const c of _circleSlots) {
            const z = computePanelCircleZone({ circle: c, slot: s, marginPx: _mPx });
            if (!z) continue;
            zone = zone ? { x0: Math.min(zone.x0, z.x0), y0: Math.min(zone.y0, z.y0), x1: Math.max(zone.x1, z.x1), y1: Math.max(zone.y1, z.y1) } : z;
          }
          if (zone) {
            s._circleZone = { x0: +zone.x0.toFixed(3), y0: +zone.y0.toFixed(3), x1: +zone.x1.toFixed(3), y1: +zone.y1.toFixed(3) };
            console.log(`[MegaComposer] ⭕ ${s.id} วงทับ → โซนหลบ x${s._circleZone.x0}-${s._circleZone.x1} y${s._circleZone.y0}-${s._circleZone.y1}`);
          }
        }
      }
    } catch { /* คำนวณโซนวงล้ม → executor ครอปแบบเดิม */ }
  }

  // ── ④ จับคู่ภาพ→ช่อง ตายตัว (เคารพ S6) + ✂️ ครอปด้วย faceSizePct ของ ref จริง ──
  const used = new Set();
  const pickIdx = (pred) => {
    for (let i = 0; i < loaded.length; i++) { if (!used.has(i) && pred(loaded[i], faceBoxes[i], i)) return i; }
    return -1;
  };
  // ★ 8 ก.ค. (ผู้ใช้สั่ง "จัดตาม ref เคร่งครัด"): หน้ากิน %ช่อง + ตำแหน่งหน้า จาก ref จริง
  //   ลำดับ: slots[i].faceSizePct → layout.hero.facePct (hero) → default ตามชนิดช่อง
  const refLayout = refDNA?.layout || {};
  const faceSpec = (slotIdx, kind) => {
    const s = refSlotMeta?.[slotIdx] || {};
    let pct = Number(s.faceSizePct);
    if (!(pct >= 15 && pct <= 95)) {
      if (kind === 'hero') pct = Number(refLayout.hero?.facePct) || 62;
      else if (kind === 'circle') pct = 66;
      else pct = 52;
    }
    // ★ 10 ก.ค. (ผู้ใช้ถอนคำสั่ง "หน้าเด่นขั้นต่ำ 78/72/66" เดิมของ 8-9 ก.ค.): ให้ค่า ref เป็นใหญ่
    //   — ไม่มี floor รสนิยมทับ ref อีก ใช้ faceSizePct ของ ref ตรงๆ (ค่าเพี้ยนถูกกรองด้วยช่วง 15-95 ด้านบนแล้ว)
    const pos = kind === 'hero' ? 'upper' : (kind === 'circle' ? 'center' : 'upper'); // ฮีโร่: หน้าค่อนบน (หัว-อก ไม่เอาถึงเอว)
    return { pct, pos };
  };
  const assignments = [];
  const mainSlot = spec.slots.find((s) => /main|hero/i.test(s.id));
  const circleSlots = spec.slots.filter((s) => s.shape === 'circle');
  const otherSlots = spec.slots.filter((s) => s !== mainSlot && s.shape !== 'circle');

  // ★ 8 ก.ค. (ผู้ใช้สั่ง "lock ฮีโร่ หน้าเด่น" — พอร์ตจาก bundle 5JUL):
  //   bigFace = หน้าเด่นจริง: สูง ≥16% ของภาพ + ไม่ติดขอบบน/ล่าง (faceBox แคบ/ติดขอบ = ครอปเสีย/หน้าเล็ก)
  //   goodFace = หน้าเด่น + สะอาด (ไม่ใช่กราฟิก/ลายน้ำ) — ใช้ล็อก hero + วงกลม
  const bigFace = (fb) => fb && fb.x2 > fb.x1 && (fb.y2 - fb.y1) >= 0.16 && fb.y1 >= 0.01 && fb.y2 <= 0.99;

  // main: 🔒 LOCK หน้าเด่น — ★ 9 ก.ค. (ผู้ใช้: "hero ไม่นิ่ง บางปกไม่เด่น ดูไม่รู้ใคร — ตัวอย่างดี 0042/0043"):
  //   เปลี่ยนจาก tier-เจอใบแรก (ลำดับโหลดพาเพี้ยน) → "ให้คะแนนทุกใบแล้วเอาที่ดีสุด" = นิ่ง deterministic
  //   คะแนน: หน้าใหญ่ + เดี่ยว + สะอาด + ภาพข่าวจริง + ไม่ชิดขอบ (ครอปสวยได้) + โบนัสใบที่ S6 เลือก
  // ★ 9 ก.ค. ค่ำ (ผู้ใช้เคาะ "hero ต้องเด่น ภาพไม่พัง" — เคส AC-0045 16:48 คว้าแบนเนอร์ข่าว 1200x628
  //   หน้าเล็กมาซูม w21% = อัพสเกลจนเบลอ): เพิ่ม "เทอมคุณภาพต้นทาง" เป็นตัวหักเท่านั้น —
  //   เทอมหน้าเด่น/หน้าเดี่ยว/สะอาด/ถูกคน + สูตรครอป + ด่านหลังประกอบ เดิม 100%
  const _heroShotRef = String(refSlotMeta?.[mainSlot ? spec.slots.indexOf(mainSlot) : -1]?.shot || '').toLowerCase();
  const heroScore = (im, fb) => {
    if (!fb || !(fb.x2 > fb.x1)) return 0;
    let s = Math.min(fb.y2 - fb.y1, 0.55) * 100;            // หน้าใหญ่ = เด่น (cap 55% กันหน้าล้นเกิน)
    s += (fb.count || 1) === 1 ? 25 : -20;                  // หน้าเดี่ยวก่อนเสมอ (กฎ 8 ก.ค. AC-0027)
    if (im.clean !== false) s += 18;
    if (im.newsScene !== false) s += 6;
    if (fb.y1 < 0.02 || fb.y2 > 0.98) s -= 14;              // หน้าชิดขอบบน/ล่างในต้นฉบับ = ครอปเสี่ยงหัว/คางขาด
    if (fb.x1 < 0.02 || fb.x2 > 0.98) s -= 22;              // ★ 10 ก.ค.2: -8→-22 หน้าชิดขอบข้าง (AC-0057 จอทีวีหน้าติดขอบชนะทั้งที่เรนเดอร์แล้วพังแน่)
    if (im.isHero) s += 10;                                  // เคารพ S6 เมื่อคะแนนสูสี
    // — เทอมคุณภาพต้นทาง (หักอย่างเดียว ไม่เพิ่ม — ภาพดีคะแนนเท่าเดิมเป๊ะ) —
    if (mainSlot && fb.imgW > 0 && fb.imgH > 0) {
      const facePxW = Math.max(1, (fb.x2 - fb.x1) * fb.imgW);
      const upscale = (mainSlot.w * 0.88) / facePxW;         // หน้าจะถูกยืดกี่เท่าเมื่อขึ้นช่อง (0.88 = HERO faceFrac)
      if (upscale > 1.5) s -= Math.min(45, (upscale - 1.5) * 22); // ยืดแรง = เบลอแน่ (เคสแบนเนอร์: ~5 เท่า → -45)
      const ar = fb.imgW / fb.imgH;
      if (ar > 1.7) s -= 20;                                 // ★ 10 ก.ค.: แบนเนอร์กว้างจัด -8→-20 — ตระกูลนี้หลอกตาทั้งคู่ได้ (AC-0045-153) ต้องกดแรงพอให้แพ้ภาพแนวตั้งปกติ
      // ★ 10 ก.ค.2 (AC-0057 hero แม่น้องเมยถูกคนแต่เบลอ — เฟรมคลิปไฟล์เล็ก): พื้นความละเอียดต้นทาง
      const shortSide = Math.min(fb.imgW, fb.imgH);
      if (shortSide < 280) s -= 28; else if (shortSide < 420) s -= 12; // ไฟล์เล็ก = ยืดขึ้นช่อง hero แล้วเบลอแน่
      // พรีเมียม: หน้าใหญ่คมในไฟล์ใหญ่ (โคลสอัพคุณภาพ) — ให้ชนะภาพสะอาดแต่ห่วยได้ แม้ติดลายน้ำมุมเล็กน้อย
      const facePxW2 = (fb.x2 - fb.x1) * fb.imgW;
      if (facePxW2 >= 240 && shortSide >= 500 && !(fb.x1 < 0.02 || fb.x2 > 0.98 || fb.y1 < 0.02)) s += 14;
    }
    // — ★ เฟส 6B.2 (9 ก.ค. ดึก — ปก MCV-mrdloc991wr hero มุมข้าง "ดูไม่รู้ใคร"): โทษ "ท่าหน้า" —
    //   hero ต้อง "หน้าเด่น รู้ทันทีว่าใคร" → มุมข้าง/หันหลังโดนหักหนัก "เมื่อมีหน้าตรง/เฉียงให้เลือก"
    //   (หักเป็นตัวเปรียบเทียบ — ถ้าดีสุดยังเป็น profile จริงๆ ก็ยังคว้าได้ + ติดธง hero_profile_forced ท้ายท่อ)
    if (_faceProm) {
      const pose = String(fb.pose || 'frontal');
      if (pose === 'back') s -= 80;              // หันหลัง = แทบตัดทิ้ง (ไม่รู้เลยว่าใคร)
      else if (pose === 'profile') s -= 45;      // มุมข้าง = หักหนัก (ระดับเดียวกับโทษยืดสูงสุด)
      else if (pose === 'three_quarter') s -= 5; // เฉียง 3/4 = ยังเห็นหน้า หักนิดเดียว
      // frontal = ไม่หัก
    }
    // — ระยะช็อตตาม ref (โบนัสเบา ไม่ใช่ตัวตัดสิน) —
    const fh = fb.y2 - fb.y1;
    if (/close/.test(_heroShotRef) && fh >= 0.26) s += 8;
    else if (/med/.test(_heroShotRef) && fh >= 0.10 && fh < 0.30) s += 6;
    // — ★ สองตาไม่ตรงกัน = เสี่ยงครอปพลาด (เคส AC-0045-153: ตาคัดและตาหาหน้าให้กล่องคนละที่
    //   บนภาพเดียวกัน → hero ออกมาเห็นแต่คอ) — กล่องจากตาคัด (slotPlan v2) เทียบกล่อง detector:
    //   ทั้งคู่มีแต่แทบไม่ทับกัน → อย่างน้อยหนึ่งตาโกหก ห้ามเสี่ยงเป็น hero
    if (im.faceBox && typeof im.faceBox.x === 'number' && typeof im.faceBox.w === 'number') {
      const t = im.faceBox;
      const ix = Math.max(0, Math.min(fb.x2, t.x + t.w) - Math.max(fb.x1, t.x));
      const iy = Math.max(0, Math.min(fb.y2, t.y + t.h) - Math.max(fb.y1, t.y));
      const inter = ix * iy;
      const uni = (fb.x2 - fb.x1) * (fb.y2 - fb.y1) + t.w * t.h - inter;
      if (uni > 0 && inter / uni < 0.15) s -= 35;
    }
    return s;
  };
  // ★ 9 ก.ค. ค่ำ (กันผลข้างเคียงเทอมคุณภาพต้นทาง): heroScore เลือกได้เฉพาะภาพของ "คนที่ S6 วางเป็น hero"
  //   เท่านั้น — เทสจริงเจอภาพสามีคมกว่าแย่งช่อง hero จากนุ่น (ผิดกฎถูกคน 100%) · ไม่มีป้ายคน/ไม่มีตัวเอกที่ใช้ได้ค่อยถอยกว้าง
  const _planHeroP = String(loaded.find((im) => im.isHero)?.person || '');
  const _heroPersonOk = (im) => !_planHeroP || im.isHero || String(im.person || '') === _planHeroP;
  let mi = -1, miBest = 0;
  loaded.forEach((im, i) => { if (!_heroPersonOk(im)) return; const sc = isCollage[i] ? 0 : heroScore(im, faceBoxes[i]); if (sc > miBest) { miBest = sc; mi = i; } }); // 🧩 hero ห้ามคอลลาจ + ห้ามผิดคน
  if (mi < 0) { loaded.forEach((im, i) => { const sc = isCollage[i] ? 0 : heroScore(im, faceBoxes[i]); if (sc > miBest) { miBest = sc; mi = i; } }); } // ตัวเอกไม่มีหน้าใช้ได้เลย → ถอยกว้าง (พฤติกรรมเดิม)
  if (mi < 0) { mi = loaded.findIndex((im) => im.isHero); if (mi < 0) mi = 0; } // ไร้หน้าทั้งชุด → ตามแผน S6/ใบแรก
  if (mainSlot && mi >= 0) {
    used.add(mi);
    const mIdx = spec.slots.indexOf(mainSlot);
    const hs = faceSpec(mIdx, 'hero');
    console.log(`[MegaComposer] 🔒 hero #${mi} — ${bigFace(faceBoxes[mi]) ? 'หน้าเด่น' : '⚠️ พูลไม่มีหน้าเด่น ใช้เท่าที่มี'} · หน้ากิน ${hs.pct}% (${hs.pos})${loaded[mi].clean === false ? ' (ยอมภาพไม่สะอาด)' : ''}`);
    assignments.push({ slotId: mainSlot.id, imageIndex: mi, crop: faceBoxes[mi] ? cropFromFace(faceBoxes[mi], hs.pct, hs.pos, mainSlot.w / mainSlot.h) : { x: 0, y: 0, w: 1, h: 1 }, why: 'hero หน้าเด่น (locked)' });
  }
  // ★ เฟส 2.3 (9 ก.ค. — หลักฐานใบ 14:24 ผู้ใช้ชี้ "วงกลม=ต๊อด คนละคนกับ hero คือใบที่ดี" vs 14:35 วงซ้ำนุ่น=พัง):
  //   วงกลมพยายามเลือก "คนละคนกับ hero" ก่อนเสมอ — ใช้ป้าย person จากตาคัด (เพิ่งต่อท่อถึงที่นี่ในเฟส 1.3)
  //   ป้ายว่าง/พูลไม่มีคนอื่นจริง → ถอยเข้า cascade เดิมทุกชั้น (ไม่บังคับจนวงว่าง)
  const heroPerson = String((mi >= 0 ? loaded[mi]?.person : '') || '');
  const diffPerson = (im) => { const p = String(im.person || ''); return !!(heroPerson && p && p !== heroPerson); };
  for (const cs of circleSlots) {
    // 👁️ goodCircleFace: วงกลมต้องหน้าเดี่ยวเด่นสะอาด (กันกราฟิก/ข่าว-overlay/หน้าจิ๋วลงวง)
    //   ★ 8 ก.ค. (ผู้ใช้: "วงกลมไกลเกิน ดูไม่รู้ใคร"): เพิ่ม tier "มีหน้า (แม้ไม่สะอาด)" ก่อนยอมภาพไร้หน้า
    //   + ภาพไร้หน้าห้าม full-frame → ครอปสี่เหลี่ยมกลาง-บน (ซูมขึ้น อย่างน้อยเห็นตัวเรื่องใกล้ๆ)
    const cNotDup = (i) => !isCollage[i] && ![...used].some((u) => hamming(aHashes[i], aHashes[u]) <= 6); // ★ 9 ก.ค.2-3: วงห้ามซ้ำเฟรมกับ hero + ห้ามคอลลาจ
    let ci = pickIdx((im, fb, i) => diffPerson(im) && bigFace(fb) && fb.count === 1 && cNotDup(i) && im.clean !== false); // เฟส 2.3: คนละคนกับ hero ก่อน
    if (ci < 0) ci = pickIdx((im, fb, i) => diffPerson(im) && fb && fb.x2 > fb.x1 && fb.count === 1 && cNotDup(i) && im.clean !== false);
    // ยอมภาพหลายหน้าที่ "คนหลัก (person=หน้าใหญ่สุด)" เป็นคนละคน — วงกลมครอปหน้าใหญ่สุดอยู่แล้ว = ได้หน้าคนนั้นจริง
    if (ci < 0) ci = pickIdx((im, fb, i) => diffPerson(im) && bigFace(fb) && cNotDup(i) && im.clean !== false);
    if (ci >= 0) console.log(`[MegaComposer] ⭕👥 วงกลมได้คนละคนกับ hero (${loaded[ci]?.person || '?'} ≠ ${heroPerson})`);
    else if (heroPerson) console.log(`[MegaComposer] ⭕⚠️ แผนไม่มีภาพ "คนอื่นที่ไม่ใช่ ${heroPerson}" ให้วงกลมเลย — โจทย์ฝั่ง S6 (เฟส 3 story slate)`);
    if (ci < 0) ci = pickIdx((im, fb, i) => im.slot === 'circle' && bigFace(fb) && fb.count === 1 && cNotDup(i) && im.clean !== false);
    if (ci < 0) ci = pickIdx((im, fb, i) => bigFace(fb) && fb.count === 1 && cNotDup(i) && im.clean !== false);
    if (ci < 0) ci = pickIdx((im, fb) => bigFace(fb) && im.clean !== false);
    if (ci < 0) ci = pickIdx((im, fb) => bigFace(fb));
    if (ci < 0) ci = pickIdx((im, fb) => fb && fb.x2 > fb.x1 && im.clean !== false);
    if (ci < 0) ci = pickIdx((im, fb) => fb && fb.x2 > fb.x1);
    if (ci < 0) ci = pickIdx(() => true);
    if (ci >= 0) {
      used.add(ci);
      const cIdx = spec.slots.indexOf(cs);
      const csp = faceSpec(cIdx, 'circle');
      const fbC = faceBoxes[ci];
      const cropC = fbC && fbC.x2 > fbC.x1
        ? cropFromFace(fbC, csp.pct, csp.pos, 1) // วงกลม = 1:1
        : { x: 0.2, y: 0.05, w: 0.6, h: 0.6, _final: true }; // ไร้หน้า: สี่เหลี่ยมกลาง-บน ซูมเข้า (ห้าม full-frame เต็มตัวไกลๆ)
      assignments.push({ slotId: cs.id, imageIndex: ci, crop: cropC, why: 'วงกลมตาม S6' });
    }
  }
  const ROLE_ORDER = ['reaction', 'action', 'context'];
  // ★ 9 ก.ค. (AC-0023 ช่อง "คนรีแอค" ได้ภาพกริดต้นปาล์ม → ไม่ตรง ref): เคารพ "บทของช่อง" ตาม ref
  //   ช่องคน = id ขึ้นต้น reaction/moment/pair/victim หรือ subject ของ ref ระบุคน → ต้องได้ภาพมีหน้า
  const PEOPLE_WORD = /คน|ชาย|หญิง|พระ|เด็ก|คู่|กลุ่ม|บัณฑิต|พยาบาล|หมอ|ตำรวจ|แม่|พ่อ|ลูก|ยาย|ตา|ป้า|ลุง|ครอบครัว/;
  for (const os of otherSlots) {
    // ช่องรอง: บทตรงช่อง+สะอาด → บทอื่น → หน้าเด่นสะอาด → สะอาด → อะไรก็ได้
    //   หลบ clean=false (ลายน้ำ/text/กราฟิกข่าว) ให้ถึงที่สุด — ยอมเฉพาะไม่มีตัวเลือกจริง
    const oIdx0 = spec.slots.indexOf(os);
    const slotRole = (String(os.id).match(/^(reaction|action|context|evidence|moment|pair|victim)/) || [])[1] || null;
    const refSubject = String(refSlotMeta?.[oIdx0]?.subject || '');
    const needFace = /^(reaction|moment|pair|victim)/.test(String(os.id)) || PEOPLE_WORD.test(refSubject);
    // ลำดับบท: บทของช่องนี้ (ตาม ref) มาก่อน แล้วค่อยบทอื่น — เดิมทุกช่องใช้ลำดับเดียวกัน = ภาพผิดบทลงช่อง
    const order = slotRole && ROLE_ORDER.includes(slotRole) ? [slotRole, ...ROLE_ORDER.filter((r) => r !== slotRole)] : ROLE_ORDER;
    const faceOk = (fb) => !needFace || (fb && fb.x2 > fb.x1);
    // ★ 9 ก.ค.2 (AC-0023 คอลัมน์ขวาซ้ำหน้าเดิม 3 ช่อง): เคารพ "ระยะช็อตตาม ref" + กันภาพซ้ำ
    //   shot ของ ref (ตาคนยืนยัน): closeup=หน้าใหญ่ · medium=เห็นคน+บริบท · wide=ฉากกว้าง — วัดจากสัดส่วนหน้าในภาพ
    const refShot = String(refSlotMeta?.[oIdx0]?.shot || '').toLowerCase();
    const shotOk = (fb) => {
      const fh = fb && fb.x2 > fb.x1 ? fb.y2 - fb.y1 : 0;
      if (/close/.test(refShot)) return fh >= 0.18;
      if (/med/.test(refShot)) return fh >= 0.05 && fh < 0.32;
      if (/wide/.test(refShot)) return fh < 0.14;
      return true;
    };
    //   กันซ้ำ: aHash ใกล้ภาพที่ใช้ไปแล้ว ≤6 บิต = เฟรมเดิม/รูปซ้ำ — ห้ามลงอีกช่อง (ผ่อนเมื่อไม่มีตัวเลือก)
    //   + 🧩 ห้ามคอลลาจในชั้นเข้มงวด (ช่องดูแตกเป็นหลายช่องปลอม ไม่ตรง ref)
    const notDup = (i) => !isCollage[i] && ![...used].some((u) => hamming(aHashes[i], aHashes[u]) <= 6);
    let oi = -1;
    // ★ 10 ก.ค. (ผู้ใช้วงจุด "ช่องคนได้ภาพคู่ ครอปแล้วเศษตัวแฟนค้างขอบ"): ช่องคน (needFace)
    //   ลอง "รูปหน้าเดี่ยว" ก่อนเสมอ — มีจริงค่อยใช้ ไม่มีถอยลง tier เดิมทุกชั้น
    if (needFace) {
      for (const role of order) { oi = pickIdx((im, fb, i) => im.slot === role && fb && fb.x2 > fb.x1 && (fb.count || 1) === 1 && shotOk(fb) && notDup(i) && im.clean !== false && im.newsScene !== false); if (oi >= 0) break; }
    }
    // ★ 9 ก.ค.: ภาพข่าวจริง (newsScene≠false) ก่อนภาพแฟ้มเสมอ — กันชุดกาล่า/พรมแดงหลุดเข้าปกข่าวครอบครัว
    if (oi < 0) for (const role of order) { oi = pickIdx((im, fb, i) => im.slot === role && faceOk(fb) && shotOk(fb) && notDup(i) && im.clean !== false && im.newsScene !== false); if (oi >= 0) break; }
    if (oi < 0) { for (const role of order) { oi = pickIdx((im, fb, i) => im.slot === role && faceOk(fb) && notDup(i) && im.clean !== false && im.newsScene !== false); if (oi >= 0) break; } }
    if (oi < 0) oi = pickIdx((im, fb, i) => faceOk(fb) && shotOk(fb) && notDup(i) && im.clean !== false && im.newsScene !== false); // บทไม่ตรงแต่ช็อต+ไม่ซ้ำ ยังดีกว่าซ้ำหน้าเดิม
    if (oi < 0) { for (const role of order) { oi = pickIdx((im, fb, i) => im.slot === role && faceOk(fb) && notDup(i) && im.clean !== false); if (oi >= 0) break; } }
    if (oi < 0 && needFace) oi = pickIdx((im, fb) => fb && fb.x2 > fb.x1 && im.clean !== false && im.newsScene !== false); // ช่องคน: ภาพมีหน้าใดก็ได้ที่สะอาด
    if (oi < 0 && needFace) oi = pickIdx((im, fb) => fb && fb.x2 > fb.x1 && im.clean !== false);
    if (oi < 0) oi = pickIdx((im, fb) => bigFace(fb) && im.clean !== false && im.newsScene !== false);
    if (oi < 0) oi = pickIdx((im, fb) => bigFace(fb) && im.clean !== false);
    if (oi < 0) oi = pickIdx((im) => im.clean !== false);
    if (oi < 0) oi = pickIdx(() => true);
    if (oi >= 0 && needFace && !(faceBoxes[oi] && faceBoxes[oi].x2 > faceBoxes[oi].x1)) console.log(`[MegaComposer] ⚠️ ${os.id} เป็นช่องคนแต่พูลไม่เหลือภาพมีหน้า — ใช้เท่าที่มี`);
    if (oi >= 0) {
      used.add(oi);
      const oIdx = spec.slots.indexOf(os);
      const osp = faceSpec(oIdx, 'other');
      // ★ 8 ก.ค. (ผู้ใช้: "ทุกเฟรมต้องล็อคตัวละครชัด — บริบทก็ต้องเห็นชัด ไม่ใช่ตัดครึ่ง"):
      //   หน้าเด่น → ซูมหน้า (62%) · หน้าเล็ก (ภาพโมเมนต์/บริบทมีคน) → มุมกว้าง 36% เห็นทั้งคน+บริบท หน้าไม่โดนตัด
      //   ไร้หน้า → ครอปเอนบน (คน/ของสำคัญมักอยู่บน-กลาง ไม่ใช่กลางเป๊ะที่ตัดหัว)
      const fbO = faceBoxes[oi];
      let cropO;
      if (fbO && (fbO.count || 1) > 1) cropO = cropAllFaces(fbO, os.w / os.h);  // หลายคน → ครอบทุกหน้า+ตรง aspect ช่อง (ห้ามตัดหัวใคร)
      else if (fbO && bigFace(fbO)) cropO = cropFromFace(fbO, osp.pct, osp.pos, os.w / os.h);
      else if (fbO && fbO.x2 > fbO.x1) cropO = cropFromFace(fbO, 40, 'center', os.w / os.h); // หน้าเล็กเดี่ยว → มุมกว้างเห็นคน+บริบท
      else cropO = { x: 0.02, y: 0, w: 0.96, h: 0.94, _final: true };                          // ไร้หน้า → เอนบน ไม่ตัดหัว
      assignments.push({ slotId: os.id, imageIndex: oi, crop: cropO, why: 'ช่องรองตาม S6' });
    }
  }
  if (assignments.length < spec.slots.length) {
    return { error: `จับคู่ได้ ${assignments.length}/${spec.slots.length} ช่อง — ภาพไม่พอ`, errorType: 'INSUFFICIENT_IMAGES' };
  }

  // ── ⭕🚫 กฎเหล็ก (8 ก.ค. ผู้ใช้): "ห้ามวงกลม/กรอบทับหน้าคน" — เช็คหน้าทุกช่อง rect บน canvas vs วงกลม
  //   ทับ → เลื่อนครอปช่องนั้น (แกนที่หนีได้สั้นสุด, clamp ในภาพ) ให้หน้าพ้นวง + log · เลื่อนไม่พ้น = ปล่อย (ดีกว่าพังทั้งใบ)
  try {
    const circles = spec.slots.filter((s) => s.shape === 'circle').map((s) => ({
      cx: s.x + s.w / 2, cy: s.y + s.h / 2, r: s.w / 2,
    }));
    if (circles.length) {
      for (const a of assignments) {
        const slot = spec.slots.find((s) => s.id === a.slotId);
        if (!slot || slot.shape === 'circle') continue;
        const fb = faceBoxes[a.imageIndex];
        if (!fb || !(fb.x2 > fb.x1)) continue;
        const c = a.crop;
        const fcx = (fb.x1 + fb.x2) / 2, fcy = (fb.y1 + fb.y2) / 2;
        if (fcx < c.x || fcx > c.x + c.w || fcy < c.y || fcy > c.y + c.h) continue; // หน้าอยู่นอกครอปแล้ว
        // map หน้า → พิกัด canvas (โดยประมาณ — executor fit อีกชั้น คลาดเล็กน้อยรับได้ ใช้ margin เผื่อ)
        const faceCanvasX = slot.x + ((fcx - c.x) / c.w) * slot.w;
        const faceCanvasY = slot.y + ((fcy - c.y) / c.h) * slot.h;
        const faceR = (((fb.x2 - fb.x1) / c.w) * slot.w) / 2;
        for (const ci of circles) {
          const dx = faceCanvasX - ci.cx, dy = faceCanvasY - ci.cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const need = ci.r + faceR * 0.9; // margin
          if (dist >= need) continue;
          // เลื่อนหน้าหนีวงตามแกนที่ต้องเลื่อนน้อยสุด (แปลง delta canvas → delta crop)
          const pushX = (need - Math.abs(dx)) * (dx >= 0 ? 1 : -1);
          const pushY = (need - Math.abs(dy)) * (dy >= 0 ? 1 : -1);
          const tryAxes = Math.abs(pushX) <= Math.abs(pushY) ? ['x', 'y'] : ['y', 'x'];
          let moved = false;
          for (const ax of tryAxes) {
            if (ax === 'x') {
              const dCrop = -(pushX / slot.w) * c.w; // เพิ่ม crop.x → หน้าเลื่อนซ้ายบน canvas
              const nx = Math.min(Math.max(c.x + dCrop, 0), 1 - c.w);
              if (Math.abs(nx - c.x) > 0.005) { a.crop = { ...c, x: +nx.toFixed(3) }; moved = true; break; }
            } else {
              const dCrop = -(pushY / slot.h) * c.h;
              const ny = Math.min(Math.max(c.y + dCrop, 0), 1 - c.h);
              if (Math.abs(ny - c.y) > 0.005) { a.crop = { ...c, y: +ny.toFixed(3) }; moved = true; break; }
            }
          }
          console.log(`[MegaComposer] ⭕🚫 วงทับหน้า ${a.slotId} → ${moved ? 'เลื่อนครอปหนีวงแล้ว' : 'เลื่อนไม่ได้ (ครอปสุดขอบ)'}`);
          break;
        }
      }
    }
  } catch { /* กันวงทับหน้าล้ม → ประกอบตามเดิม */ }
  assignments.forEach((a) => {
    const fb = faceBoxes[a.imageIndex];
    // rev.5: crop มีหน้า = hint (executor คำนวณจริงจากสูตร v3) · _final = บังคับ (เฉพาะภาพไร้หน้า)
    console.log(`[MegaComposer] ${a.slotId} ← #${a.imageIndex} (${loaded[a.imageIndex].slot || 'สำรอง'}) ${a.crop._final ? 'crop' : 'hint'}(${a.crop.x},${a.crop.y},${a.crop.w},${a.crop.h})${fb ? ` face(y1=${fb.y1},y2=${fb.y2},n=${fb.count})` : ' ไร้หน้า'}`);
  });

  // ── ⑤ 🧩 ประกอบพิกเซล + 🛡️ ด่านบังคับ hero (9 ก.ค. ผู้ใช้: "ถ้าภาพไม่ผ่านต้องเปลี่ยนจนผ่าน") ──
  //   ตรวจ "ผลจริงหลังประกอบ": ครอปช่อง main จากปกจริงแล้วส่องหน้า — หน้าต้องเด่น (สูง ≥20% ของช่อง)
  //   ไม่ผ่าน (เช่น ตาหาหน้าเคยตอบพิกัดมั่ว AC-0026 กองกระสอบ) → แบนใบนั้น เลื่อนใบคะแนนถัดไป ประกอบใหม่ ≤2 รอบ
  // ★ เฟส 4.2 (ปิดรูจากเฟส 3 — ภาพคนอื่นเข้าแผนแล้วแต่ตกม้าตายตอนเลือก): ด่านท้ายก่อน render
  //   วงกลมยังเป็นคนเดียวกับ hero ทั้งที่ยังมีภาพ "คนอื่น+มีหน้า" เหลือใน loaded → สลับให้เลย
  try {
    const _mainA = assignments.find((a) => /main|hero/i.test(String(a.slotId)));
    const _heroP = _mainA ? String(loaded[_mainA.imageIndex]?.person || '') : '';
    if (_heroP) {
      for (const a of assignments) {
        const sl = spec.slots.find((s) => s.id === a.slotId);
        if (!sl || sl.shape !== 'circle') continue;
        const curP = String(loaded[a.imageIndex]?.person || '');
        if (curP && curP !== _heroP) continue; // วงกลมเป็นคนอื่นอยู่แล้ว
        let si = -1;
        for (let i = 0; i < loaded.length; i++) {
          if (used.has(i) || isCollage[i]) continue;
          const p = String(loaded[i]?.person || '');
          if (!p || p === _heroP) continue;
          const fb2 = faceBoxes[i];
          if (!fb2 || !(fb2.x2 > fb2.x1)) continue;
          if ([...used].some((u) => hamming(aHashes[i], aHashes[u]) <= 6)) continue;
          if (si < 0) si = i;
          if (loaded[i].clean !== false && (fb2.y2 - fb2.y1) >= 0.16) { si = i; break; } // สะอาด+หน้าใหญ่ = จบ
        }
        if (si >= 0) {
          used.delete(a.imageIndex); used.add(si);
          const csp2 = faceSpec(spec.slots.indexOf(sl), 'circle');
          a.imageIndex = si;
          a.crop = cropFromFace(faceBoxes[si], csp2.pct, csp2.pos, 1);
          a.why = 'วงกลมสลับเป็นคนอื่น (ด่านท้าย 4.2)';
          console.log(`[MegaComposer] ⭕🔁 ด่านท้าย: วงกลมซ้ำคนกับ hero → สลับเป็น #${si} (${loaded[si]?.person})`);
        } else if (curP && curP === _heroP) {
          qcFlags.push('circle_same_person_as_hero'); // ไม่มีตัวเลือกจริง — ติดธงให้เห็น ไม่บังคับ
        }
      }
    }
  } catch { /* ด่านท้ายล้มไม่ให้กระทบการประกอบ */ }

  // ★ แบตช์ F (F2): duplicate_person_panels — คนเดียวกินหลายช่อง (≥3 จาก 5 ช่องที่มีหน้า) ที่กติกา
  //   circle_same_person เดิมจับไม่เจอ (เดิมดูเฉพาะ circle↔hero) · นับ personId ต่อช่องที่ "มีหน้า" เท่านั้น
  //   emit ธงให้ coverQcGate ตัดสิน (ไม่บังคับ/ไม่สลับที่นี่ — end-stage ก่อน render) · fail-open: ล้มไม่กระทบปก
  //   kill-switch MEGA_PERSON_DIVERSITY='0' → ปิด (default ON) · ห้ามแตะกติกา circle_same_person เดิม
  try {
    if (process.env.MEGA_PERSON_DIVERSITY !== '0') {
      const _normP = (p) => String(p || '').trim().replace(/\s+/g, ' ').toLowerCase();
      const _hasFace = (fb) => !!(fb && ((fb.allFaces && fb.allFaces.length) || fb.x2 > fb.x1));
      const _pcount = new Map(); // personId (normalize) → จำนวนช่องที่คนนั้นถือหน้า
      for (const a of assignments) {
        if (!_hasFace(faceBoxes[a.imageIndex])) continue; // นับเฉพาะช่องที่มีหน้า
        const p = _normP(loaded[a.imageIndex]?.person);
        if (!p) continue; // ระบุตัวไม่ได้ = ไม่นับ (ห้ามเดา)
        _pcount.set(p, (_pcount.get(p) || 0) + 1);
      }
      for (const [p, n] of _pcount) {
        if (n >= 3) {
          qcFlags.push(`duplicate_person_panels:${p}:${n}`);
          console.log(`[MegaComposer] 👥🚩 คนเดียวกินหลายช่อง: "${p}" ปรากฏ ${n} ช่อง (≥3) — ติดธง duplicate_person_panels`);
        }
      }
    }
  } catch { /* นับคนซ้ำล้มไม่กระทบการประกอบ */ }

  // ★ เฟส 3 (10 ก.ค. — โรงประกอบไม่ทำลายความคม): พื้นต่ำสุดที่ภาพจะถูกยืดเมื่อขึ้นช่อง
  //   (region ใหญ่สุดในภาพที่ aspect ตรงช่อง → ยืดน้อยสุด) — ใช้ทั้ง hard floor 3.1 และ enhance 3.2
  const _imgWH = (im, fb) => {
    if (im && im._w > 0 && im._h > 0) return [im._w, im._h];      // พิกเซลไฟล์จริง (เฟส 3.4)
    if (fb && fb.imgW > 0 && fb.imgH > 0) return [fb.imgW, fb.imgH]; // สำรอง: ค่าที่ detector เห็น
    return [0, 0];
  };
  const _slotUpEst = (im, fb, sl) => {
    const [iw, ih] = _imgWH(im, fb);
    if (!(iw > 0) || !(ih > 0) || !sl) return 1;
    const sa = sl.w / sl.h, ia = iw / ih;
    return ia >= sa ? sl.h / ih : sl.w / iw;
  };

  // ── ⑤a 🔎 hard floor 3.1: ช่องรอง/วงกลมที่ภาพจะถูกยืด >1.6 เท่า → สลับใบสำรองที่ยืดน้อยกว่า "เมื่อมีทางเลือก" ──
  //   ไม่มีใบยืดน้อยกว่า = คงเดิม + ธง upscaled_src (compose ห้ามล้มเพราะเรื่องนี้) · hero มีด่าน heroScore/quality ของตัวเอง
  //   kill-switch COMPOSE_MIN_SRC_GATE=0 = ปิด (พฤติกรรมเก่า)
  if (_minSrcGate) {
    try {
      const _heroPs = String((mi >= 0 ? loaded[mi]?.person : '') || '');
      for (const a of assignments) {
        const sl = spec.slots.find((s) => s.id === a.slotId);
        if (!sl || /main|hero/i.test(String(a.slotId))) continue;
        const curUp = _slotUpEst(loaded[a.imageIndex], faceBoxes[a.imageIndex], sl);
        if (!(curUp > 1.6)) continue;
        const isCirc = sl.shape === 'circle';
        const curP = String(loaded[a.imageIndex]?.person || '');
        const curDiff = !!(_heroPs && curP && curP !== _heroPs); // "คนละคนกับ hero" — ห้ามสลับจนเสียคุณสมบัตินี้ (กติกา 2.3)
        let bi = -1, bUp = curUp;
        for (let i = 0; i < loaded.length; i++) {
          if (used.has(i) || isCollage[i] || loaded[i].clean === false) continue;
          const fb2 = faceBoxes[i];
          if (isCirc && !(fb2 && fb2.x2 > fb2.x1)) continue; // วงกลมต้องมีหน้า
          if ([...used].some((u) => u !== a.imageIndex && hamming(aHashes[i], aHashes[u]) <= 6)) continue; // ห้ามซ้ำเฟรม
          if (curDiff) { const p2 = String(loaded[i]?.person || ''); if (!(p2 && p2 !== _heroPs)) continue; }
          const up2 = _slotUpEst(loaded[i], fb2, sl);
          if (up2 < bUp - 0.05) { bUp = up2; bi = i; }
        }
        if (bi >= 0 && bUp <= 1.6) {
          used.delete(a.imageIndex); used.add(bi);
          a.imageIndex = bi;
          a.crop = { x: 0, y: 0, w: 1, h: 1 }; // ให้ executor คำนวณครอปใหม่ตามสูตรช่อง
          a.why = 'สลับใบยืดน้อยกว่า (hard floor 3.1)';
          console.log(`[MegaComposer] 🔎🔁 ${a.slotId}: ภาพยืด ${curUp.toFixed(2)}x → สลับ #${bi} (ยืด ${bUp.toFixed(2)}x)`);
        } else {
          console.log(`[MegaComposer] 🔎⚠️ ${a.slotId}: ภาพยืด ${curUp.toFixed(2)}x ไม่มีใบยืดน้อยกว่าให้สลับ — คงเดิม`);
          qcFlags.push(`upscaled_src:${a.slotId}:${curUp.toFixed(2)}`);
        }
      }
    } catch (e) { console.log('[MegaComposer] hard floor 3.1 ล้ม (ใช้แผนเดิม):', String(e?.message || '').slice(0, 50)); }
  }

  // ── ⑤b (ถอดออก 10 ก.ค. — คำสั่งเจ้าของ) ──
  // 🔴 ห้าม AI เจน/วาด/สังเคราะห์พิกเซลภาพในท่อปกอัตโนมัติทุกกรณี — เดิมจุดนี้ส่ง hero เข้า
  //   Real-ESRGAN (Replicate) เมื่อภาพต้นทางเล็ก แม้ face_enhance=false ตัวโมเดลก็เป็น GAN
  //   ที่ "วาดรายละเอียดใหม่" → หน้าออกมาดูเหมือน AI เจน (ผู้ใช้จับได้เคส MCV-mrevr836xbl)
  //   กติกาถาวร: ใช้ภาพต้นฉบับเท่านั้น + จัดการได้เฉพาะ crop/resize แบบ interpolation ธรรมดา (sharp)
  //   เครื่องมือ /photo-enhance แบบผู้ใช้กดเองยังใช้ได้ (คนละเรื่องกับท่ออัตโนมัติ) — ห้ามต่อกลับเข้าท่อนี้

  const { executeCover } = await import('@/lib/services/coverExecutorService');
  const { detectFaces } = await import('@/lib/services/faceDetector');
  const mainSlotSpec = spec.slots.find((s) => /main|hero/i.test(String(s.id))) || null;
  const mainAssign = assignments.find((a) => /main|hero/i.test(String(a.slotId))) || null;
  let buffer;
  const traceSink = []; // audit: trace ต่อรอบเรียก — ไม่ใช้ globalThis (กันปนข้ามงานขนาน)
  const heroBanned = new Set();
  for (let attempt = 0; ; attempt++) {
    buffer = await executeCover({ assignments, imageBuffers: loaded, templateSpec: spec, faceBoxes, traceSink });
    if (mainSlotSpec && mainAssign && attempt >= 2) qcFlags.push('hero_unverified_kept'); // ⑤ retry ครบ 2 รอบ ออกโดยไม่ได้ verify ผลประกอบสุดท้าย
    if (!mainSlotSpec || !mainAssign || attempt >= 2) break;
    let heroOk = true;
    try {
      const ex = {
        left: Math.max(0, mainSlotSpec.x), top: Math.max(0, mainSlotSpec.y),
        width: Math.min(spec.canvasW - Math.max(0, mainSlotSpec.x), mainSlotSpec.w),
        height: Math.min(spec.canvasH - Math.max(0, mainSlotSpec.y), mainSlotSpec.h),
      };
      const tile = await sharp(buffer).extract(ex).jpeg({ quality: 85 }).toBuffer();
      const fd = await detectFaces(tile);
      const th = fd?.imageHeight || 1;
      const tw = fd?.imageWidth || 1;
      const _big = (fd?.faces || []).filter((f) => f.height / th >= 0.20);
      heroOk = _big.length > 0;
      // ★ เฟส 4.5 (เคสผู้ใช้ 15:11 — hero หน้าหลุดขอบซ้าย): หน้าใหญ่สุดต้อง "ครบ ไม่โดนขอบตัด"
      //   เกณฑ์: กล่องหน้าชนขอบ + จุดกลางหน้าเบี้ยวออกจากกลางเฟรมชัด = โดนตัดจริง
      //   (hero ปกติหน้าเต็มเฟรมก็ชนขอบได้ แต่จะชนแบบ "กลางเฟรม" — ไม่เข้าเงื่อนไขนี้) · ไม่แตะสูตร HERO_CROP
      if (heroOk) {
        const f0 = _big.reduce((b, f) => (f.width * f.height > b.width * b.height ? f : b), _big[0]);
        const cxF = (f0.x + f0.width / 2) / tw;
        const cyF = (f0.y + f0.height / 2) / th;
        const cut = (f0.x <= 2 && cxF < 0.30) || (f0.x + f0.width >= tw - 2 && cxF > 0.70) || (f0.y <= 2 && cyF < 0.22);
        if (cut) { heroOk = false; console.log('[MegaComposer] 🛡️ hero หน้าโดนขอบตัด (ครอปเบี้ยวจากกล่องหน้าเพี้ยน) → ไม่ผ่านด่าน'); }
        // ★ 9 ก.ค. ค่ำ (AC-0045-153 detector หลอนตำแหน่งเดิมซ้ำ ด่านเดิมโดนหลอก): สูตรครอปวางหน้าโซนบน
        //   (faceTopAt 0.40 + การ์ดผม/หัว) เสมอ — ถ้าหน้าที่เจอจริงอยู่ล่างเฟรม (center y > 0.68) = ครอปเพี้ยนแน่นอน
        if (heroOk && cyF > 0.68) { heroOk = false; console.log('[MegaComposer] 🛡️ hero หน้าอยู่ล่างเฟรมผิดสูตร (คาดโซนบน) → ไม่ผ่านด่าน'); }
      }
    } catch { heroOk = true; qcFlags.push('hero_gate_error'); /* ด่านตรวจล้มเอง = ไม่บล็อกงาน (fail-open คงเดิม) แต่ติดธงให้ QC เห็น — ห้ามเงียบ */ }
    if (heroOk) { if (attempt > 0) console.log(`[MegaComposer] 🛡️ hero ผ่านด่านบังคับ (รอบ ${attempt + 1})`); break; }
    heroBanned.add(mainAssign.imageIndex);
    let ni = -1, nBest = 0;
    loaded.forEach((im, i) => {
      if (heroBanned.has(i) || (i !== mainAssign.imageIndex && used.has(i)) || isCollage[i]) return;
      if (!_heroPersonOk(im)) return; // ★ 9 ก.ค. ค่ำ: ตัวสำรอง hero ก็ห้ามผิดคนเช่นกัน
      const sc = heroScore(im, faceBoxes[i]);
      if (sc > nBest) { nBest = sc; ni = i; }
    });
    if (ni < 0) { console.log('[MegaComposer] 🛡️ hero ไม่ผ่านด่านแต่ไม่มีตัวเลือกอื่น — ใช้ที่ดีสุดเท่าที่มี'); qcFlags.push('hero_unverified_kept'); break; }
    console.log(`[MegaComposer] 🛡️ hero #${mainAssign.imageIndex} ไม่ผ่าน (หน้าไม่เด่นในผลจริง) → เปลี่ยนเป็น #${ni} ประกอบใหม่`);
    used.delete(mainAssign.imageIndex);
    used.add(ni);
    mainAssign.imageIndex = ni;
    const hsw = faceSpec(spec.slots.indexOf(mainSlotSpec), 'hero');
    mainAssign.crop = faceBoxes[ni] ? cropFromFace(faceBoxes[ni], hsw.pct, hsw.pos, mainSlotSpec.w / mainSlotSpec.h) : { x: 0, y: 0, w: 1, h: 1 };
  }
  // ★ 10 ก.ค. (ผู้ใช้สั่งกติกาเหล็ก "ทุกช่องห้ามมีคนถูกเฟรมตัด — ขาด=ไม่ผ่าน ทำใหม่จนได้"):
  //   ด่านคนครบต่อช่องรอง+วงกลม (main มีด่านของตัวเองแล้ว) — ตรวจผลจริงหลังประกอบ:
  //   ใบหน้าเด่น (≥12% ของช่อง) แตะขอบ+จุดกลางชิดขอบ = คนโดนตัด → ①เปลี่ยนรูป ②ครอปเนียนเหลือคนในเฟรม ③ติดธง
  //   (หน้าจิ๋วฝูงชนตรงขอบ = ธรรมชาติของภาพฉากกว้าง ไม่นับ) · bounded ≤2 รอบ
  try {
    for (let _round = 0; _round < 2; _round++) {
      const targets = assignments
        .map((a) => ({ a, sl: spec.slots.find((s) => s.id === a.slotId) }))
        .filter(({ a, sl }) => sl && !/main|hero/i.test(String(a.slotId)));
      if (!targets.length) break;
      const tiles = await Promise.all(targets.map(({ sl }) => {
        const ex = { left: Math.max(0, sl.x), top: Math.max(0, sl.y), width: Math.min(spec.canvasW - Math.max(0, sl.x), sl.w), height: Math.min(spec.canvasH - Math.max(0, sl.y), sl.h) };
        return sharp(buffer).extract(ex).jpeg({ quality: 80 }).toBuffer();
      }));
      const fdm2 = await batchDetectFaces(tiles.map((b, i) => ({ id: `pv_${i}`, buffer: b })));
      let changed = 0;
      for (let i = 0; i < targets.length; i++) {
        const { a, sl } = targets[i];
        const fd = fdm2?.get?.(`pv_${i}`);
        const tw2 = fd?.imageWidth || sl.w, th2 = fd?.imageHeight || sl.h;
        const cutFace = (fd?.faces || []).find((f) => {
          if (f.height / th2 < 0.12) return false;
          const cx = (f.x + f.width / 2) / tw2;
          const cy = (f.y + f.height / 2) / th2;
          return (f.x <= 2 && cx < 0.10) || (f.x + f.width >= tw2 - 2 && cx > 0.90) || (f.y <= 2 && cy < 0.08);
        });
        if (!cutFace) continue;
        console.log(`[MegaComposer] ✂️🚫 ${a.slotId}: คนโดนเฟรมตัด (รอบ ${_round + 1}) → แก้ตามกติกาคนครบ`);
        // ทาง 1 (ง่ายสุดตามผู้ใช้สั่ง): เปลี่ยนรูป — ใบสำรองที่มีหน้า สะอาด ไม่ซ้ำเฟรม
        let ni2 = -1;
        for (let k = 0; k < loaded.length; k++) {
          if (used.has(k) || isCollage[k] || loaded[k].clean === false) continue;
          const fb2 = faceBoxes[k];
          if (!fb2 || !(fb2.x2 > fb2.x1)) continue;
          if ([...used].some((u) => hamming(aHashes[k], aHashes[u]) <= 6)) continue;
          ni2 = k; break;
        }
        if (ni2 >= 0) {
          used.delete(a.imageIndex); used.add(ni2);
          a.imageIndex = ni2;
          a.crop = { x: 0, y: 0, w: 1, h: 1 }; // ให้ executor คำนวณครอปใหม่ตามสูตรช่อง
          a.why = 'เปลี่ยนรูป — คนโดนเฟรมตัด (กติกาคนครบ)';
          changed++;
          console.log(`[MegaComposer] ✂️🔁 ${a.slotId}: เปลี่ยนรูปเป็น #${ni2}`);
          continue;
        }
        // ทาง 2: รูปสำคัญไม่มีตัวสำรอง → ครอปเนียนเหลือ "คนที่อยู่ด้านในเฟรมจริง" คนเดียว (ห้ามใครโผล่ครึ่งตัว)
        const srcFb = faceBoxes[a.imageIndex];
        const interior = (srcFb?.allFaces || [])
          .filter((f) => f.x1 >= 0.04 && f.x2 <= 0.96)
          .sort((p, q) => ((q.x2 - q.x1) * (q.y2 - q.y1)) - ((p.x2 - p.x1) * (p.y2 - p.y1)))[0];
        if (interior) {
          const one = { ...srcFb, x1: interior.x1, y1: interior.y1, x2: interior.x2, y2: interior.y2, count: 1, allFaces: [interior] };
          a.crop = { ...cropFromFace(one, 62, 'center', sl.w / Math.max(1, sl.h)), _final: true };
          a.why = 'ครอปเนียนคนเดียว — คนอื่นโดนเฟรมตัด (กติกาคนครบ)';
          changed++;
          console.log(`[MegaComposer] ✂️✂️ ${a.slotId}: ครอปใหม่เหลือคนในเฟรม (_final)`);
        } else {
          qcFlags.push(`person_cut:${a.slotId}`); // แก้ไม่ได้จริง — ติดธงให้เห็น (ห้ามเงียบ)
        }
      }
      if (!changed) break;
      buffer = await executeCover({ assignments, imageBuffers: loaded, templateSpec: spec, faceBoxes, traceSink });
    }
  } catch (e) { console.log('[MegaComposer] ด่านคนครบล้ม (ใช้ปกเดิม):', String(e?.message || '').slice(0, 60)); }

  // ★ เฟส 6B.2 (observability): ท่าหน้า hero ตัวสุดท้าย (หลังด่านบังคับ/สลับใบ) — ธงเสมอ + ธง forced เมื่อจำใจใช้มุมข้าง
  if (_faceProm && mainAssign) {
    const _hp = String(faceBoxes[mainAssign.imageIndex]?.pose || 'frontal');
    qcFlags.push(`hero_pose:${_hp}`);
    if (_hp === 'profile' || _hp === 'back') {
      qcFlags.push('hero_profile_forced'); // ไม่มีหน้าตรง/เฉียงให้เลือกจริงๆ → จำใจใช้ (ติดธงให้เห็น ไม่บล็อกงาน)
      console.log(`[MegaComposer] ⚠️ hero เป็นท่า ${_hp} (คลังไม่มีหน้าตรง/เฉียงให้เลือก) → hero_profile_forced`);
    }
  }

  console.log(`[MegaComposer] ✅ ประกอบเสร็จ ${Math.round(buffer.length / 1024)}KB (${spec.id})`);
  // เฟส 0.1: เก็บ trace ครอปของรอบประกอบสุดท้าย (จาก traceSink ของงานนี้เอง) — ให้เครื่องเทส/การ์ด hero อ่านได้
  const cropTrace = [...traceSink];
  // เฟส 4.3 + 3.1: ธงครอปตาบอด (ไร้หน้า+ไร้ subject) + ยืดจริงต่อช่อง (upscaled/upscale_soft) จาก trace ปกใบสุดท้าย
  qcFlags.push(...traceQcFlags(cropTrace));
  if (qcFlags.length) console.log(`[MegaComposer] 🚩 qcFlags: ${qcFlags.join(' · ')}`);
  // ★ Wave1 Batch E: ส่ง aHashes ออกไปด้วย (คำนวณแล้วที่ ②b — เดิมทิ้งหลังใช้กันภาพซ้ำ) ให้ manifest ใช้ต่อได้ ไม่ต้องคำนวณซ้ำ
  return { buffer, spec, assignments, loaded, faceBoxes, used, refSlotMeta, cropTrace, qcFlags, traceSink, aHashes };
}

// ---------- 👁️ ตาเทียบ ref: เห็น "ภาพจริง" ทั้งคู่ — ครั้งแรกที่ระบบตรวจด้วยภาพชนภาพ ----------
// ★ 9 ก.ค. (แก้ "เลข 20% หลอก"): เดิมตาให้เลขเดียว 0-100 → gpt-4o แอบเทียบเนื้อหา/คน/สี/พาดหัว
//   (ref มีพาดหัวกราฟิก ปกเรายังไม่ใส่ = โดนหักฟรี) เลขเลยต่ำทั้งที่โครงตรง
//   ใหม่: ตาตอบแค่ ผ่าน/ไม่ผ่าน รายข้อโครง 5 ข้อ — โค้ดรวมคะแนนเองตามน้ำหนักคงที่ (deterministic)
const EYE_RUBRIC = [['grid', 40], ['inserts', 20], ['hero_shot', 15], ['sub_shots', 15], ['crops', 10]];
async function refCompareEye({ coverBuffer, refImagePath, newsTitle }) {
  const refBuf = await fetchOne(refImagePath);
  if (!refBuf) return null;
  const { callAI } = await import('@/lib/ai/openai');
  const res = await callAI({
    systemPrompt: `คุณคือตาตรวจ "โครงปก" ของทีมกราฟฟิก เทียบ "ปกที่ทีมทำ (ภาพที่ 1)" กับ "ปกต้นแบบ (ภาพที่ 2)"
วัดเฉพาะโครงสร้าง — ห้ามสนว่าเป็นใคร/ข่าวอะไร/โทนสีไหน/อารมณ์ใด (คนละข่าวกันเสมอ เนื้อหาต่างกันแน่นอน)
ต้นแบบมีพาดหัว/ตัวหนังสือกราฟิก แต่ปกที่ทีมทำยังไม่ใส่ข้อความ = ปกติ ห้ามใช้หักข้อใดทั้งสิ้น
ตรวจผ่าน/ไม่ผ่านทีละข้อ:
- grid: จำนวนช่องภาพ + ผังช่องใหญ่/เล็ก + ตำแหน่งช่องใหญ่ ตรงต้นแบบ
- inserts: วงกลม/กรอบซ้อน — ต้นแบบมีตรงไหน ปกต้องมีตรงนั้น ตำแหน่ง+ขนาดใกล้เคียง (ต้นแบบไม่มี = ปกไม่มีด้วยจึงผ่าน)
- hero_shot: ช่องใหญ่สุด ระยะช็อตตรงต้นแบบ (โคลสอัพ/ครึ่งตัว/เต็มตัว) และหัวคนไม่โดนเฉือน
- sub_shots: ช่องรองส่วนใหญ่ ระยะช็อตใกล้เคียงช่องตำแหน่งเดียวกันของต้นแบบ
- crops: ทุกช่อง จุดเด่น/หน้าคนอยู่ในกรอบ ไม่โดนขอบเฉือน ไม่โดนชั้นอื่นบัง
สั่งแก้ได้เฉพาะ: ครอปช่องรอง (zoom_in/zoom_out/shift_up/shift_down) หรือ swap ช่องรองเป็นภาพสำรอง — ห้ามแตะช่องใหญ่ซ้าย(hero)/โครง
ตอบ JSON เท่านั้น: {"grid":true|false,"inserts":true|false,"hero_shot":true|false,"sub_shots":true|false,"crops":true|false,"diffs":["จุดต่าง ≤3 ข้อ"],"fixes":[{"slot":"ชื่อช่อง เช่น right_top/context_1/circle","action":"zoom_in|zoom_out|shift_up|shift_down|swap"}]}`,
    userPrompt: `ข่าว: ${String(newsTitle || '').slice(0, 100)} — ตรวจโครงรายข้อ`,
    imageContents: [
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${coverBuffer.toString('base64')}`, detail: 'low' } },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${refBuf.toString('base64')}`, detail: 'low' } },
    ],
    model: 'gpt-4o', temperature: 0.1, maxTokens: 500,
  });
  const parsed = typeof res === 'object' && res !== null && !res.text ? res : JSON.parse(String(res?.text || res).match(/\{[\s\S]*\}/)?.[0] || 'null');
  // ต้องมีคำตอบรายข้ออย่างน้อย 1 ข้อ ไม่งั้นถือว่าตาล้ม (กันตอบฟอร์แมตเก่า/ครึ่งใบแล้วได้ 100 ฟรี)
  if (!parsed || !EYE_RUBRIC.some(([k]) => typeof parsed[k] === 'boolean')) return null;
  let similarity = 0;
  const checks = {};
  for (const [k, w] of EYE_RUBRIC) { checks[k] = parsed[k] !== false; if (parsed[k] !== false) similarity += w; }
  return { similarity, checks, diffs: parsed.diffs || [], fixes: (parsed.fixes || []).slice(0, 3) };
}

// ---------- ปรับตามคำสั่งตา (กฎล้วน — bounded ≤1 รอบ · ห้ามแตะ main) ----------
function applyEyeFixes({ fixes, assignments, loaded, faceBoxes, used, allowSourceSwap = true, strictFaceZoom = false, heroComposerSlotId = null }) {
  let applied = 0;
  // ★ (item 8) HERO authority in the Eye path: V2 = EXACT canonical heroComposerSlotId (a slot named e.g.
  //   `panel_alpha` is the hero; a decoy `main` is NOT) · V1/legacy (heroComposerSlotId == null) = regex เดิม
  const _isHeroSlot = (id) => (heroComposerSlotId != null)
    ? (String(id) === String(heroComposerSlotId))
    : /main|hero/i.test(String(id));
  // ★ รอบ 7 (P1-3): strict เท่านั้น — zoom_in/zoom_out ต้องมี "หน้าจริง" (count>0 + กรอบมีพื้นที่)
  //   subject-only box (count=0, x1=x2=0) truthy หลอก cropFromFace จนวงยุบ 8x8 ได้ โดยเฉพาะ REQC=0
  //   → strict: skip zoom เงียบ (ไม่นับ applied ไม่ render ใหม่) · legacy default = พฤติกรรมเดิม byte-เดิม
  const _zoomFb = (fb) => !!fb && (!strictFaceZoom || ((fb.count || 0) > 0 && fb.x2 > fb.x1 && fb.y2 > fb.y1));
  // ★ HOTFIX รอบ 2 (Codex P0-A): ลำดับ candidate ต้องเท่า legacy เป๊ะ (OFF parity) — scan ใช้ snapshot
  //   ของ used ณ ต้น call + ภาพใหม่ที่ swap จองเพิ่ม: index เก่าที่ถูกปล่อยยัง "reserved" ตลอด call
  //   (กัน swap ถัดไปหยิบภาพเก่าของช่องก่อนหน้า = ผลเลือกเพี้ยนจาก HEAD) · ส่วน used จริง = ownership
  //   สุดท้ายของ assignments: delete(old) + add(new)
  const reservedDuringEye = new Set(used);
  for (const f of fixes) {
    const a = assignments.find((x) => x.slotId === f.slot && !_isHeroSlot(x.slotId));
    if (!a) continue;
    const fb = faceBoxes[a.imageIndex];
    if (f.action === 'zoom_in' && _zoomFb(fb)) { a.crop = cropFromFace(fb, 74, 'center'); applied++; }        // หน้าใหญ่ขึ้น (กิน 74%)
    else if (f.action === 'zoom_out' && _zoomFb(fb)) { a.crop = cropFromFace(fb, 46, 'center'); applied++; }   // หน้าเล็กลง (กิน 46%)
    else if (f.action === 'shift_up') { a.crop = { ...a.crop, y: Math.max(0, +(a.crop.y - 0.1).toFixed(3)) }; applied++; }
    else if (f.action === 'shift_down') { a.crop = { ...a.crop, y: Math.min(1 - a.crop.h, +(a.crop.y + 0.1).toFixed(3)) }; applied++; }
    else if (f.action === 'swap') {
      // ★ Checkpoint B: strict = source ล็อกตาม authority — ปฏิเสธ swap เงียบๆ (crop actions ด้านบนยังทำงาน)
      if (!allowSourceSwap) { console.log(`[MegaComposer] 🔐 strict: ตาขอ swap ${f.slot} → ปฏิเสธ (source ล็อกตาม authority)`); continue; }
      // ★ เฟส 4.2: วงกลมห้ามถูกตาสลับกลับไปเป็น "คนเดียวกับ hero" (ตาเทียบไม่รู้จักคน — เคย undo กติกา 2.3)
      const _mainA2 = assignments.find((x) => _isHeroSlot(x.slotId));
      const _heroP2 = _mainA2 ? String(loaded[_mainA2.imageIndex]?.person || '') : '';
      const _isCircle = /circle/i.test(String(a.slotId));
      let si = -1;
      for (let i = 0; i < loaded.length; i++) {
        if (reservedDuringEye.has(i) || loaded[i].clean === false || !faceBoxes[i]) continue;
        if (_isCircle && _heroP2 && String(loaded[i]?.person || '') === _heroP2) continue;
        si = i; break;
      }
      if (si >= 0) {
        // ★ HOTFIX รอบ 2 (Codex P0-A): คำนวณ crop ทดแทนให้เสร็จ "ก่อน" แตะ state — throw กลางทาง = ไม่มี partial
        const newCrop = cropFromFace(faceBoxes[si], 55, 'upper');
        const oldIndex = a.imageIndex;
        used.delete(oldIndex);      // ownership จริง: ภาพเก่าหลุดจากช่องนี้แล้ว (บั๊กเดิมค้างตลอดงาน)
        used.add(si);
        reservedDuringEye.add(si);  // จองใน call นี้ — old ยังค้างใน reserved ให้ลำดับเลือกตรง HEAD
        a.imageIndex = si;
        a.crop = newCrop;
        applied++;
      }
    }
  }
  return applied;
}

// ---------- 👁️⚛️ Eye advisory atomic transaction (11 ก.ค. — Codex hotfix รอบ 2) ----------
// seam เดียวที่ export: _runEyeFixTransaction — production เรียกตัวนี้จริง harness ก็เรียกตัวนี้จริง
// (ไม่ export helper ย่อย — เทสจะได้ไม่ต้องจำลอง orchestration เอง) · snapshot/restore เป็น private ล้วน

// snapshot ครบชุด "ก่อน" applyEyeFixes — จำทั้ง "ค่า" (deep-clone รวม nested trace) และ "ตัวตน" (references)
// เพื่อ restore แบบ reference-atomic: array/Set/object เดิมทุกตัว แค่เนื้อหากลับ baseline
function _eyeTxSnapshot(core, buffer, cropTrace) {
  return {
    assignArrayRef: core.assignments,
    assignEntries: (core.assignments || []).map((ref) => ({
      ref, // object เดิมใน array — restore เขียนคืน field ลงตัวนี้ ไม่สร้างใหม่
      fields: { ...ref, crop: ref.crop ? JSON.parse(JSON.stringify(ref.crop)) : ref.crop },
    })),
    usedRef: core.used,
    usedItems: [...(core.used || [])],
    qcFlagsRef: Array.isArray(core.qcFlags) ? core.qcFlags : null,
    qcFlagsItems: [...(core.qcFlags || [])],
    traceSinkRef: Array.isArray(core.traceSink) ? core.traceSink : null,
    traceSinkItems: Array.isArray(core.traceSink) ? JSON.parse(JSON.stringify(core.traceSink)) : [],
    cropTraceItems: JSON.parse(JSON.stringify(cropTrace || [])), // deep — กัน region/tighten ใน entry ถูกแชร์
    buffer,
  };
}

// touched = เทียบ "object ตัวเดิม" กับ field ที่จำไว้ตรงๆ (ไม่พึ่ง slotId map — กันชนกรณี id ซ้ำ)
function _eyeTxTouched(snap) {
  const out = [];
  for (const { ref, fields } of snap.assignEntries) {
    if (ref.imageIndex !== fields.imageIndex || JSON.stringify(ref.crop) !== JSON.stringify(fields.crop)) out.push(ref.slotId);
  }
  return out;
}

// ด่านกลไก re-QC (ตรรกะเดิมของ Wave2 Batch C ทุกบรรทัด): เทียบธงก่อน-หลังเฉพาะช่องที่ตาแตะ
function _eyeRegressionOf({ touchedSlots, preQcFlags, postQcFlags }) {
  const upOf = (flags, slot) => {
    for (const f of flags) {
      const m = /^(?:upscaled|upscale_soft):([^:]+):([\d.]+)$/.exec(String(f));
      if (m && m[1] === slot) return Number(m[2]);
    }
    return null;
  };
  const blindOf = (flags, slot) => flags.includes(`blind_crop:${slot}`);
  for (const slot of touchedSlots) {
    if (blindOf(postQcFlags, slot) && !blindOf(preQcFlags, slot)) return `blind_crop_new:${slot}`;
    const beforeUp = upOf(preQcFlags, slot);
    const afterUp = upOf(postQcFlags, slot);
    if (afterUp != null) {
      if (beforeUp != null && afterUp > beforeUp * 1.1 + 0.001) return `upscale_worse:${slot}:${beforeUp.toFixed(2)}->${afterUp.toFixed(2)}`;
      if (beforeUp == null && afterUp > 1.6) return `upscale_new:${slot}:${afterUp.toFixed(2)}`;
    }
  }
  return null;
}

// restore reference-atomic — ห้ามสลับตัวตนใดๆ:
//   · assignment object แต่ละตัว: ลบ key แปลกปลอมแล้วเขียน field เดิมคืน in-place (crop = clone ใหม่กัน baseline เน่า)
//   · assignments array เดิม / used Set เดิม (clear+add) / traceSink array เดิม / qcFlags array เดิม — เนื้อหากลับ baseline
//   · qcFlags หลัง revert = baseline + ป้าย eye_fix_reverted:<reason> หนึ่งใบเป๊ะ
//   คืน { buffer: Buffer ใบ baseline ตัวเดิม, cropTrace: สำเนา deep ของ baseline, fixedCount: 0 }
function _eyeTxRestore(snap, core, reason) {
  for (const { ref, fields } of snap.assignEntries) {
    for (const k of Object.keys(ref)) { if (!(k in fields)) delete ref[k]; }
    Object.assign(ref, fields, { crop: fields.crop ? JSON.parse(JSON.stringify(fields.crop)) : fields.crop });
  }
  snap.assignArrayRef.length = 0;
  snap.assignArrayRef.push(...snap.assignEntries.map((e) => e.ref));
  core.assignments = snap.assignArrayRef;
  if (snap.usedRef instanceof Set) {
    snap.usedRef.clear();
    for (const i of snap.usedItems) snap.usedRef.add(i);
    core.used = snap.usedRef;
  } else {
    core.used = new Set(snap.usedItems);
  }
  if (snap.traceSinkRef) {
    snap.traceSinkRef.length = 0; // render อาจ clear/เขียนครึ่งทางก่อน throw — คืนเนื้อหาเสมอ
    snap.traceSinkRef.push(...JSON.parse(JSON.stringify(snap.traceSinkItems)));
    core.traceSink = snap.traceSinkRef;
  }
  const flagsRef = snap.qcFlagsRef || [];
  flagsRef.length = 0;
  flagsRef.push(...snap.qcFlagsItems, `eye_fix_reverted:${reason}`);
  core.qcFlags = flagsRef;
  return { buffer: snap.buffer, cropTrace: JSON.parse(JSON.stringify(snap.cropTraceItems)), fixedCount: 0 };
}

// kill switch ด่านกลไก: MEGA_EYE_REQC=0 = ข้าม re-QC รับผลตาทันที (พฤติกรรมเดิมเป๊ะ) — private
function _eyeReqcEnabled(env = process.env) {
  return env.MEGA_EYE_REQC !== '0';
}

// ธุรกรรมเดียวครอบทั้งเส้น: snapshot → apply → render → re-QC → keep/revert/exception
// · buffer/cropTrace = ค่า local ของ composeAndVerify "หลัง FinalCrop" (ไม่ใช่ core.buffer/core.cropTrace)
// · renderCover: จุดฉีดของ harness เท่านั้น — production ห้ามส่ง (default = executeCover จริง)
// · fixedCount=0 → ไม่ render (พฤติกรรมเดิม) · exception ที่จุดใดก็ตาม → restore atomic + reason 'exception'
export async function _runEyeFixTransaction({ core, fixes, buffer, cropTrace, renderCover = null }) {
  const snap = _eyeTxSnapshot(core, buffer, cropTrace);
  try {
    // ★ Checkpoint B: strict context = source ล็อกตาม authority — ตาสั่ง swap ได้แค่ถูกปฏิเสธ (crop ยังได้)
    //   ★ รอบ 7 (P1-3): strict ยังบังคับ zoom ต้องมีหน้าจริง (subject-only ห้ามเข้า cropFromFace)
    const allowSourceSwap = core._strictSourceLock !== true;
    const fixedCount = applyEyeFixes({ fixes, assignments: core.assignments, loaded: core.loaded, faceBoxes: core.faceBoxes, used: core.used, allowSourceSwap, strictFaceZoom: core._strictSourceLock === true, heroComposerSlotId: core.heroComposerSlotId != null ? core.heroComposerSlotId : null });
    if (!fixedCount) return { buffer, cropTrace, fixedCount: 0 };
    const render = renderCover || (async () => {
      const { executeCover } = await import('@/lib/services/coverExecutorService');
      return executeCover({ assignments: core.assignments, imageBuffers: core.loaded, templateSpec: core.spec, faceBoxes: core.faceBoxes, traceSink: core.traceSink });
    });
    buffer = await render();
    cropTrace = [...(core.traceSink || [])]; // audit: trace ของรอบสุดท้าย จาก sink ของงานนี้เอง
    // audit: ธง blind_crop + upscale ต้องสะท้อนปกใบสุดท้าย (การสลับภาพของตาอาจทำให้เกิด/หาย) — เฟส 3.1
    core.qcFlags = (core.qcFlags || []).filter((f) => !/^(blind_crop|upscaled|upscale_soft):/.test(String(f)));
    core.qcFlags.push(...traceQcFlags(cropTrace));
    console.log(`[MegaComposer] 👁️ แก้ตามตา ${fixedCount} จุด → ประกอบใหม่ (bounded 1 รอบจบ)`);
    // ── 🔬 re-QC กลไกล้วน (ไม่เรียก vision LLM เพิ่ม) — ตาแค่ "เสนอ" เครื่องตัดสินว่าจะรับจริงไหม ──
    //   MEGA_EYE_REQC=0: ข้าม gate ทั้งก้อน = apply+render แล้วรับเลย ไม่มี marker kept/unverified/revert
    if (_eyeReqcEnabled()) {
      const touchedSlots = _eyeTxTouched(snap);
      if (touchedSlots.length) {
        const regression = _eyeRegressionOf({ touchedSlots, preQcFlags: snap.qcFlagsItems, postQcFlags: core.qcFlags });
        if (regression) {
          const r = _eyeTxRestore(snap, core, regression);
          console.log(`[MegaComposer] 👁️↩️ revert eye fix (${regression}) — กลไกวัดว่าแย่ลงกว่า baseline`);
          return r;
        }
        core.qcFlags.push('eye_fix_kept', 'person_cut_unverified');
        console.log('[MegaComposer] 👁️✅ eye fix ผ่านด่านกลไก (blind_crop/upscale ไม่แย่ลง) — รับผล');
      }
    }
    return { buffer, cropTrace, fixedCount };
  } catch (e) {
    // exception กลาง apply/render/re-QC — restore atomic เสมอ (รวมใต้ REQC=0: safety ที่ตั้งใจ)
    const r = _eyeTxRestore(snap, core, 'exception');
    console.log('[MegaComposer] 👁️↩️ eye fix ล้มกลางทาง — atomic revert กลับ baseline:', e.message?.slice(0, 60));
    return r;
  }
}

/**
 * ประกอบอย่างเดียว (ไม่มีตาเทียบ) — deterministic 100%
 */
export async function composeMegaCover({ newsTitle = '', slotPlan = [], refDNA = null }) {
  try {
    const core = await composeCore({ slotPlan, refDNA });
    if (core.error) return { success: false, error: core.error, errorType: core.errorType };
    return {
      success: true,
      base64: `data:image/jpeg;base64,${core.buffer.toString('base64')}`,
      template: core.spec.id,
      placed: core.assignments.map((a) => ({ slot: a.slotId, role: core.loaded[a.imageIndex].slot })),
    };
  } catch (err) {
    console.log('[MegaComposer] ❌', err.message?.slice(0, 100));
    return { success: false, error: err.message || 'ประกอบปกล้มเหลว', errorType: 'COMPOSE_FAILED' };
  }
}

/**
 * ประกอบ + 👁️ ตาเทียบ ref จริง (ภาพชนภาพ) + แก้ bounded ≤1 รอบ — ท่อ MEGA ใช้ตัวนี้
 * @param {string} p.refImagePath - พาธภาพปกต้นแบบจากคลัง (เช่น /ref-covers/xxx.jpg) — ไม่มี = ประกอบเฉยๆ
 */
export async function composeAndVerify(args = {}) {
  try {
    // ★ Wave1A (LANE C — P0-A/P0-B/P1-R1): the FIRST observation of args is the shared pure seam — NO destructure /
    //   [[Get]] / getPrototypeOf / has / ownKeys before it. The seam privately captures the carriers (descriptors
    //   FIRST) + slotPlan, owns the ambiguity + latch + version decision, and returns { none } | { error } | { ctx }
    //   (each carrying the captured slotPlan). Canonical latch = MEGA_STRICT_RENDER === '1' (no _V2 alias) — passed in
    //   so the seam stays env-free/pure. NO-DOWNGRADE for V2, V1-only latch-OFF legacy parity, ambiguity/trap ⇒ HOLD.
    const _act = _strictActivate({ args, latchArmed: process.env.MEGA_STRICT_RENDER === '1' });
    if (_act.error) {
      console.log(`[MegaComposer] 🔐🚫 strict fail-closed: ${_act.errorType} — ${(_act.reasons || []).join(' · ').slice(0, 160)}`);
      return { success: false, error: _act.error, errorType: _act.errorType, reasons: _act.reasons };
    }
    const strictCtx = _act.ctx || null;
    const slotPlan = _act.slotPlan; // captured by the seam — the strict path uses THIS, never re-reads args.slotPlan
    if (strictCtx) console.log(`[MegaComposer] 🔐 strict render ACTIVE (${strictCtx.v2 ? 'V2' : 'V1'}): ref=${strictCtx.authority.refId} · ${strictCtx.snapshot.length} ช่อง · specHash=${strictCtx.authority.specHash}`);
    // ordinary business fields — read ONLY AFTER activation has returned (requirement 5); slotPlan already captured.
    const { newsTitle = '', refDNA = null, refImagePath = null, stableOrder = false } = args || {};
    const core = await composeCore({ slotPlan, refDNA, stableOrder, strictCtx });
    // ★ Checkpoint B: strict core แนบ reasons ราย slot มาด้วย — ส่งต่อเมื่อมีเท่านั้น (legacy ไม่มี = shape เดิมเป๊ะ)
    if (core.error) return { success: false, error: core.error, errorType: core.errorType, ...(core.reasons ? { reasons: core.reasons } : {}) };
    let buffer = core.buffer;
    let cropTrace = core.cropTrace || [];
    let eye = null;
    let fixedCount = 0;
    if (refImagePath) {
      try {
        eye = await refCompareEye({ coverBuffer: buffer, refImagePath, newsTitle });
        // ★ 9 ก.ค. (AC-0026 "เหมือน ref -%"): ตาเทียบล้มชั่วคราว (AI/parse) → ลองอีก 1 ครั้งก่อนยอมแพ้
        if (!eye) eye = await refCompareEye({ coverBuffer: buffer, refImagePath, newsTitle }).catch(() => null);
        if (eye) {
          const failed = Object.entries(eye.checks || {}).filter(([, v]) => !v).map(([k]) => k);
          console.log(`[MegaComposer] 👁️ โครงตรง ref ${eye.similarity}%${failed.length ? ` (ตก: ${failed.join(',')})` : ''} — ${eye.diffs.join(' · ').slice(0, 120)}`);
          // ★ 10 ก.ค. (AC-0066 ผู้ใช้ชี้ Hero ไม่เด่นตาม ref): detector ต้นฉบับอาจระบุกล่องหน้า
          //   ผิด แล้วด่านหลัง render ใช้ detector ตระกูลเดิมจึงถูกหลอกซ้ำ แม้ตาเทียบ ref เห็นว่า
          //   hero_shot ไม่ผ่าน — เดิม applyEyeFixes ห้ามแตะ main โดยตั้งใจ จึงไม่มีทางแก้ครอป Hero
          //   ทางแก้ bounded/fail-safe: เฉพาะ ref ที่สั่ง close-up + ตาเห็น hero_shot=false ให้ Final Cropper
          //   ที่เห็นภาพจริงครอป main ช่องเดียว → render+เทียบ ref ซ้ำอย่างละ 1 รอบ; รับเฉพาะเมื่อ hero_shot ผ่าน
          //   ไม่ผ่าน/AI ล้ม = คืน crop เดิมทันที (ไม่แตะ selection/layout/ช่องรอง)
          // ★ (P1) V2: hero ระบุด้วย composerSlotId จาก spec.hero.heroSlotId เท่านั้น (ไม่ใช่ regex) · V1/legacy = เดิม
          const mainA = core.assignments.find((a) => (strictCtx && strictCtx.v2 && strictCtx.heroComposerSlotId != null)
            ? (String(a.slotId) === strictCtx.heroComposerSlotId)
            : /main|hero/i.test(String(a.slotId))) || null;
          const mainSlotIdx = mainA ? core.spec.slots.findIndex((s) => s.id === mainA.slotId) : -1;
          const refHeroShot = String(mainSlotIdx >= 0 ? (core.refSlotMeta?.[mainSlotIdx]?.shot || '') : '').toLowerCase();
          if (mainA && /close/.test(refHeroShot) && eye.checks?.hero_shot === false) {
            const preCrop = mainA.crop ? { ...mainA.crop } : mainA.crop;
            const preWhy = mainA.why;
            try {
              const { finalCrop } = await import('@/lib/services/coverDirectorService');
              const recrop = await finalCrop({
                assignments: core.assignments,
                imageBuffers: core.loaded,
                templateSpec: core.spec,
                identity: { mainCharacter: core.loaded[mainA.imageIndex]?.person || '' },
                newsTitle,
                faceBoxes: core.faceBoxes,
                slotIds: [mainA.slotId],
              });
              if (recrop?.applied > 0) {
                const { executeCover } = await import('@/lib/services/coverExecutorService');
                const candidateTrace = [];
                const candidateBuffer = await executeCover({
                  assignments: core.assignments,
                  imageBuffers: core.loaded,
                  templateSpec: core.spec,
                  faceBoxes: core.faceBoxes,
                  traceSink: candidateTrace,
                });
                const candidateEye = await refCompareEye({ coverBuffer: candidateBuffer, refImagePath, newsTitle }).catch(() => null);
                if (candidateEye?.checks?.hero_shot === true) {
                  buffer = candidateBuffer;
                  cropTrace = [...candidateTrace];
                  if (Array.isArray(core.traceSink)) {
                    core.traceSink.length = 0;
                    core.traceSink.push(...candidateTrace);
                  }
                  core.qcFlags = (core.qcFlags || []).filter((f) => !/^(blind_crop|upscaled|upscale_soft):/.test(String(f)));
                  core.qcFlags.push(...traceQcFlags(cropTrace), 'hero_ref_recrop_kept');
                  eye = candidateEye;
                  console.log('[MegaComposer] 🦸✂️ Hero close-up ผ่าน ref หลัง Final Cropper — รับครอปใหม่');
                } else {
                  mainA.crop = preCrop;
                  mainA.why = preWhy;
                  core.qcFlags.push('hero_ref_recrop_reverted');
                  console.log('[MegaComposer] 🦸↩️ Hero Final Cropper ยังไม่ผ่าน ref — คืนครอปเดิม');
                }
              }
            } catch (e) {
              mainA.crop = preCrop;
              mainA.why = preWhy;
              console.log('[MegaComposer] Hero Final Cropper ล้ม (คืนครอปเดิม):', e.message?.slice(0, 60));
            }
          }
          // สเกลใหม่: ตกข้อใดข้อหนึ่ง (<100) + ตามีคำสั่งแก้ = ลงมือ (เดิม <85 จะข้ามเคสตกข้อเล็ก)
          if (eye.fixes?.length && eye.similarity < 100) {
            // ★ HOTFIX 11 ก.ค. รอบ 2 (Codex eye-advisory-atomic): ธุรกรรมเดียวครอบ snapshot→apply→render→
            //   re-QC→keep/revert/exception — ตรรกะทั้งหมดอยู่ใน _runEyeFixTransaction (seam เดียวที่ harness
            //   เรียกตัวเดียวกันเป๊ะ) · ส่ง buffer/cropTrace "local หลัง FinalCrop" เป็น baseline · ห้ามส่ง renderCover
            const _tx = await _runEyeFixTransaction({ core, fixes: eye.fixes, buffer, cropTrace });
            buffer = _tx.buffer;
            cropTrace = _tx.cropTrace;
            fixedCount = _tx.fixedCount;
          }
        }
      } catch (e) { console.log('[MegaComposer] ตาเทียบ ref ล้ม (ใช้ปกเดิม):', e.message?.slice(0, 50)); }
    }
    // ★ Checkpoint B: FINAL INVARIANT — หลัง Eye จบ · ก่อน techRules/manifest/success ทุกชนิด
    //   drift แม้จุดเดียว (นับช่อง/เซ็ต slot/URL/index/โครง) = ปิดงานทันที ห้ามปล่อย manifest success
    if (strictCtx) {
      const drift = _strictDriftCheck(core, strictCtx);
      if (drift) {
        console.log(`[MegaComposer] 🔐🚨 STRICT_ASSIGNMENT_DRIFT: ${drift.join(' · ').slice(0, 200)}`);
        return { success: false, error: `strict drift: ${drift.join(',').slice(0, 180)}`, errorType: 'STRICT_ASSIGNMENT_DRIFT', reasons: drift };
      }
    }
    // ★ AC-0107 (RUNTIME-BOUND HERO CROP PROOF — strict V2 only, AFTER Eye/FinalCrop, BEFORE manifest/persist/archive):
    //   the pre-carrier eligibility gate (megaAdapters _runRefHeroV2) filters candidates from STORED evidence and is
    //   only NECESSARY, never sufficient — it cannot see the Final-Cropper / watermark-dodge / fresh-detector geometry
    //   of the ACTUAL render (which can each SHRINK the hero region and push upscale past 1.2). The AUTHORITATIVE ≤1.2×
    //   proof is HERE, bound to the exact rendered inputs: the executor's EXACT raw upscale (upscaleRaw — NOT the rounded
    //   display `upscale`, which would let 1.201–1.204 pass) for the CANONICAL hero slot (heroComposerSlotId — NOT a regex
    //   /main/), read from the FINAL cropTrace (post Eye recrop/transaction). If the hero crop exceeds the hard 1.2× limit
    //   (exact, no epsilon) — or the trace is missing/duplicated/non-primitive/non-finite — fail TYPED and never emit
    //   success (⇒ no manifest/persist/archive). Hard QC downstream stays as defense-in-depth; this makes the strict V2
    //   path self-proving rather than QC-dependent. V1/legacy (v2!=true) unchanged — gate is skipped entirely.
    if (strictCtx && strictCtx.v2 && strictCtx.heroComposerSlotId != null) {
      const _hid = String(strictCtx.heroComposerSlotId);
      const _fail = (reason, msg) => {
        console.log(`[MegaComposer] 🔐🚨 STRICT_V2_HERO_CROP_UNSAFE — ${msg}`);
        return { success: false, error: `strict v2 hero crop: ${msg}`, errorType: 'STRICT_V2_HERO_CROP_UNSAFE', reasons: [reason] };
      };
      // (P1-2) collect EXACTLY the canonical hero trace(s) WITHOUT invoking any getter/coercion: own-descriptor `slot`
      //   read whose value must be a primitive string/number equal to the hero composerSlotId. A trace whose `slot` is
      //   an accessor is never read as the hero (hostile getter not invoked) — if the genuine hero trace is thereby
      //   absent, the count is 0 ⇒ fail-closed. Require EXACTLY ONE (zero = missing, >1 = ambiguous ⇒ reject).
      const _heroTraces = [];
      for (const t of (Array.isArray(cropTrace) ? cropTrace : [])) {
        if (!t || typeof t !== 'object') continue;
        const _sd = Object.getOwnPropertyDescriptor(t, 'slot');
        if (!_sd || 'get' in _sd || 'set' in _sd) continue;
        const _sv = _sd.value;
        if ((typeof _sv === 'string' || typeof _sv === 'number') && String(_sv) === _hid) _heroTraces.push(t);
      }
      if (_heroTraces.length === 0) return _fail(`hero_crop_trace_missing:${_hid}`, `ไม่มี trace ครอป hero ${_hid} — พิสูจน์ ≤${HERO_STRETCH_MAX}× ไม่ได้`);
      if (_heroTraces.length > 1) return _fail(`hero_crop_trace_duplicate:${_hid}:${_heroTraces.length}`, `พบ trace ครอป hero ${_hid} ${_heroTraces.length} รายการ (กำกวม — ปฏิเสธ)`);
      // (P1-1/P1-2) the HARD decision reads the EXACT raw upscale only: own primitive (no getter/coercion), finite,
      //   strictly positive. Never the rounded display `upscale` (1.201–1.204 rounds to 1.20 and would wrongly pass).
      const _ud = Object.getOwnPropertyDescriptor(_heroTraces[0], 'upscaleRaw');
      if (!_ud || 'get' in _ud || 'set' in _ud) return _fail(`hero_crop_raw_invalid:${_hid}`, `hero ${_hid} raw upscale หาย/เป็น accessor — พิสูจน์ ≤${HERO_STRETCH_MAX}× ไม่ได้`);
      const _raw = _ud.value;
      if (typeof _raw !== 'number' || !Number.isFinite(_raw) || _raw <= 0) return _fail(`hero_crop_raw_invalid:${_hid}`, `hero ${_hid} raw upscale ไม่ใช่จำนวนบวกจำกัด (${typeof _raw === 'number' ? String(_raw) : typeof _raw}) — fail-closed`);
      // EXACT threshold: 1.2 passes; ANY value above 1.2 fails — NO epsilon tolerance (a hard contract must not be weakened).
      if (_raw > HERO_STRETCH_MAX) return _fail(`hero_crop_upscaled:${_hid}:${_raw}`, `hero ${_hid} เรนเดอร์จริง ${_raw}× > ${HERO_STRETCH_MAX}× (Final-Cropper/dodge/detector หด region)`);
    }
    // ★ W2 (จากคลังจริง 10 ก.ค. — เจอ "วงกลมว่าง" 2 ใบ): จับภาพเปล่า/เกือบสีเดียวล้วนที่หลุดลงช่อง
    //   aHash 64 บิตของภาพแบนๆ จะมีบิตเกือบเท่ากันหมด (popcount ≤6 หรือ ≥58) → ติดธงให้ด่าน QC ตัดสิน
    //   ใช้ค่า aHash ที่คำนวณแล้ว ไม่มี IO เพิ่ม · ตรวจไม่ได้ = ไม่ติดธง (ห้ามเดา)
    try {
      const _pop = (h) => { let n = 0n, x = BigInt(h); while (x > 0n) { n += x & 1n; x >>= 1n; } return Number(n); };
      for (const a of core.assignments) {
        const ah = core.aHashes ? core.aHashes[a.imageIndex] : null;
        if (ah == null) continue;
        const bits = _pop(ah);
        if (bits <= 6 || bits >= 58) {
          core.qcFlags.push(`blank_image:${a.slotId}`);
          console.log(`[MegaComposer] 🕳️ ภาพเกือบเปล่าลงช่อง ${a.slotId} (aHash popcount=${bits}) — ติดธง blank_image`);
        }
      }
    } catch { /* ตรวจไม่ได้ = ไม่ติดธง */ }
    // ★ แบตช์ F (F3): duplicate_scene — ฉากซ้ำระหว่างช่องที่ sceneKeyOf (prefix note) จับไม่เจอ (คนละคำบรรยาย)
    //   เทียบ aHash/dHash hamming ≤10 · จำกัดเฉพาะคู่ที่ "ฝั่งใดฝั่งหนึ่งไร้หน้า" เพื่อกัน false positive
    //   (สองช่องที่มีหน้าคนคนละคนอาจ aHash ใกล้กันได้จากองค์ประกอบภาพ — ไม่นับ) · ใช้ aHash ที่คำนวณแล้ว ไม่มี IO เพิ่ม
    //   emit ธงให้ coverQcGate ตัดสิน · kill-switch MEGA_SCENE_DEDUP='0' → ปิด (default ON) · fail-open: ล้มไม่กระทบปก
    try {
      if (process.env.MEGA_SCENE_DEDUP !== '0' && core.aHashes) {
        const _ham = (a, b) => { if (a == null || b == null) return 64; let x = BigInt(a) ^ BigInt(b), n = 0; while (x > 0n) { n += Number(x & 1n); x >>= 1n; } return n; };
        const _faceOf = (fb) => !!(fb && ((fb.allFaces && fb.allFaces.length) || fb.x2 > fb.x1));
        const asg = core.assignments;
        for (let i = 0; i < asg.length; i++) {
          for (let jj = i + 1; jj < asg.length; jj++) {
            const ai = asg[i], aj = asg[jj];
            const hi = core.aHashes[ai.imageIndex], hj = core.aHashes[aj.imageIndex];
            if (hi == null || hj == null) continue;
            const faceI = _faceOf(core.faceBoxes[ai.imageIndex]);
            const faceJ = _faceOf(core.faceBoxes[aj.imageIndex]);
            if (faceI && faceJ) continue; // ทั้งคู่มีหน้า = ไม่นับ (กัน false positive)
            if (_ham(hi, hj) <= 10) {
              core.qcFlags.push(`duplicate_scene:${ai.slotId}:${aj.slotId}`);
              console.log(`[MegaComposer] 🗺️🚩 ฉากซ้ำระหว่างช่อง ${ai.slotId}↔${aj.slotId} (aHash hamming≤10, ฝั่งไร้หน้า) — ติดธง duplicate_scene`);
            }
          }
        }
      }
    } catch { /* ตรวจฉากซ้ำไม่ได้ = ไม่ติดธง */ }
    // ★ Wave2 Batch D2 (10 ก.ค.): วัด "กติกาวัดได้" 23 ข้อจากคลังเทคนิคปก — ที่เดียว/หลัง Eye advisory จบ
    //   (รวมกรณี revert แล้ว) = lockstep กับ buffer/cropTrace/assignments สุดท้ายเป๊ะ เหมือน manifest (W2-C การันตี)
    //   pure ล้วน (ไม่มี LLM/IO เพิ่ม) · ธงเข้า core.qcFlags → coverQcGate.js ตัดสินโหมด advisory(default)/hard
    //   ล้มเองได้ = ไม่กระทบผลปก (fail-open)
    let techMeasured = null;
    const techMode = process.env.MEGA_TECH_RULES_MODE === 'hard' ? 'hard' : 'advisory';
    try {
      const tr = measureTechRules({
        assignments: core.assignments,
        spec: core.spec,
        faceBoxes: core.faceBoxes,
        cropTrace,
        // ★ (item 10) V2: ส่ง canonical hero slot ให้ face-share/headroom วัดกับช่อง hero จริง (ไม่พึ่ง regex) ·
        //   V1/legacy = null ⇒ regex เดิม byte-identical
        heroComposerSlotId: (strictCtx && strictCtx.v2 && strictCtx.heroComposerSlotId != null) ? strictCtx.heroComposerSlotId : null,
      });
      techMeasured = tr.measured;
      if (tr.flags.length) {
        core.qcFlags.push(...tr.flags);
        console.log(`[MegaComposer] 📐 techRules(${techMode}): ${tr.flags.join(' · ')}`);
      }
    } catch (e) { console.log('[MegaComposer] techRules วัดล้ม (ไม่กระทบผลปก):', e.message?.slice(0, 60)); }
    // ★ Wave1 Batch E (manifest-lite): "ความจริงของรอบประกอบ" — เก็บจากค่าที่คำนวณอยู่แล้วล้วน (ห้าม LLM/IO เพิ่ม
    //   ยกเว้น sha1 ของ buffer สุดท้าย) ให้ debug/replay ย้อนดูได้ทีหลังว่ารอบนี้ใช้ภาพ/หน้า/โมเดลอะไร
    //   ล้มเองได้ = ไม่กระทบผลปก (additive ล้วน — ไม่มี = ผู้เรียกเดิมไม่พัง)
    let manifest = null;
    try {
      manifest = {
        composerVersion: COMPOSER_VERSION,
        stableOrder: !!stableOrder,
        models: { faceDetector: 'gpt-4o-mini (fallback: gemini-2.5-flash)', eye: 'gpt-4o' },
        slots: core.assignments.map((a) => {
          const im = core.loaded[a.imageIndex] || {};
          const fb = core.faceBoxes[a.imageIndex] || null;
          const ah = core.aHashes ? core.aHashes[a.imageIndex] : null;
          // ★ Wave2 Batch D2: ค่าที่วัดได้ต่อช่อง (faceSharePct/headroomPct) — additive, ไม่มี = null (fail-open)
          const mm = techMeasured?.bySlot?.[a.slotId] || null;
          return {
            slot: a.slotId,
            imageUrl: im.url || im.thumbnailUrl || '',
            aHash: (ah != null) ? ah.toString(16) : null, // BigInt → hex string (JSON เก็บ BigInt ตรงๆ ไม่ได้)
            faceCount: fb?.count ?? 0,
            faceBoxes: _manifestFaceBoxes(fb),
            measured: (mm && mm.hasFace) ? { faceSharePct: mm.faceSharePct, headroomPct: mm.headroomPct } : null,
          };
        }),
        // ★ Wave2 Batch D2: โหมด + ธงกติกาวัดได้ของรอบนี้ (debug/replay) — additive
        techRules: { mode: techMode, flags: (core.qcFlags || []).filter((f) => /^(face_share_out|headroom_out|circle_face_overlap|ladder_break|panel_count_out|circle_border_out):/.test(String(f))) },
        refImagePath: refImagePath || null,
        outputHash: crypto.createHash('sha1').update(buffer).digest('hex'),
      };
      // ★ Checkpoint B: audit เฉพาะโหมด strict (ผ่าน invariant แล้วเท่านั้นถึงมาถึงตรงนี้) —
      //   legacy manifest ไม่มี field นี้เป๊ะ (strictCtx=null = ไม่แตะ)
      //   ★ รอบ 2 (P1): slots derive จาก verified snapshot + "loaded จริง" หลัง invariant
      //   (invariant การันตีแล้วว่าตรงกัน — url อ่านจาก loaded เพื่อผูก audit กับของจริงที่ขึ้นปก)
      if (strictCtx) {
        manifest.strictRender = {
          verified: true,
          refId: strictCtx.authority.refId,
          specHash: strictCtx.authority.specHash,
          replayHash: strictCtx.authority.replayHash,
          slots: strictCtx.snapshot.map((s) => ({
            composerSlotId: s.composerSlotId,
            refSlotId: s.refSlotId,
            candidateId: s.candidateId,
            // ★ V2: personId/sourceAssetId เข้า audit ด้วย (additive — V1 snapshot ไม่มี ⇒ ไม่เพิ่ม key)
            ...(s.personId != null ? { personId: s.personId } : {}),
            ...(s.sourceAssetId != null ? { sourceAssetId: s.sourceAssetId } : {}),
            imageUrl: String(core.loaded?.[s.imageIndex]?.url || ''),
          })),
        };
      }
    } catch (e) { console.log('[MegaComposer] manifest เก็บล้ม (ไม่กระทบผลปก):', e.message?.slice(0, 60)); }
    // ★ Cover Ref Tester (shadow-only): หลัง buffer/assignment/crop/manifest สุดท้ายถูกล็อกแล้วเท่านั้น
    //   เห็นปกจริง + ref + source ที่ใช้จริง เพื่อแยก selection/mapping/crop/geometry/render
    //   ห้ามแก้ภาพ/QC งานหลัก · AI/IO/persist ล้ม = คืนปกเดิม 100%
    //   ★ 10 ก.ค. ดึก (Codex สืบ :3900 ดับเงียบ — จุดกระตุ้น=เส้นนี้ยิง gpt-5.5): default ปิด — เปิดเอง MEGA_COVER_TESTER=1
    let testerReport = null;
    if (refImagePath && process.env.MEGA_COVER_TESTER === '1') {
      try {
        const { runCoverRefTester } = await import('@/lib/services/coverRefTesterService');
        testerReport = await runCoverRefTester({
          coverBuffer: buffer,
          refImagePath,
          refDNA,
          manifest,
          qcFlags: core.qcFlags || [],
          eye,
          assignments: core.assignments,
          loaded: core.loaded,
          cropTrace,
          newsTitle,
        });
        if (manifest && testerReport) manifest.tester = testerReport;
        const cause = testerReport?.primaryCause;
        console.log(`[MegaTester] ${testerReport?.status || 'inconclusive'} · ${cause?.stage || '-'}:${cause?.code || '-'} · conf=${cause?.confidence ?? '-'}`);
      } catch (e) {
        console.log('[MegaTester] ล้ม (shadow-only ไม่กระทบปก):', e.message?.slice(0, 80));
      }
    }
    // ★ Checkpoint B รอบ 2 (P0-3): strict manifest ห้าม fail-open — legacy catch-and-continue คงเดิม
    //   เฉพาะ legacy · strict: manifest หาย/สร้างล้ม/ไม่ verified = ห้าม success เด็ดขาด
    //   (postcondition บังคับ ตรวจ "ทันทีก่อน success return" เสมอ)
    if (strictCtx && manifest?.strictRender?.verified !== true) {
      console.log('[MegaComposer] 🔐🚨 STRICT_MANIFEST_FAILED — manifest หาย/ไม่ verified ห้ามปล่อย success');
      return { success: false, error: 'strict manifest ไม่ผ่าน postcondition (สร้างล้ม/ไม่ verified)', errorType: 'STRICT_MANIFEST_FAILED', reasons: ['manifest_unverified'] };
    }
    return {
      success: true,
      base64: `data:image/jpeg;base64,${buffer.toString('base64')}`,
      template: core.spec.id,
      refSimilarity: eye?.similarity ?? null,
      refDiffs: eye?.diffs || [],
      eyeFixed: fixedCount,
      qcFlags: core.qcFlags || [], // เฟส 4.3: ธงคุณภาพ deterministic (แทน ref% ที่เชื่อไม่ได้)
      manifest, // ★ Wave1 Batch E: ความจริงของรอบประกอบ (debug/replay) — additive, null เมื่อเก็บล้ม
      testerReport, // ★ Shadow QA: root cause เทียบ ref (ไม่เปลี่ยนภาพ/QC; null เมื่อไม่มี ref/ปิด/ล้ม)
      placed: core.assignments.map((a) => ({ slot: a.slotId, role: core.loaded[a.imageIndex].slot })),
      // เฟส 0.1+0.3: ครอปจริงต่อช่อง (สาขา+กรอบ) + url ภาพ — เครื่องเทสใช้ทำ baseline การ์ด hero
      crops: core.assignments.map((a) => ({
        slot: a.slotId,
        url: core.loaded[a.imageIndex]?.url || '',
        trace: cropTrace.find((t) => t.slot === a.slotId) || null,
      })),
    };
  } catch (err) {
    console.log('[MegaComposer] ❌', err.message?.slice(0, 100));
    return { success: false, error: err.message || 'ประกอบปกล้มเหลว', errorType: 'COMPOSE_FAILED' };
  }
}
