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
// ★ Wave2 Batch D2 (10 ก.ค.): เกณฑ์ตัวเลข "กติกาวัดได้" จากคลังเทคนิคปก — single source of truth (sync, ใช้ใน measureTechRules)
import { TECH_RULES } from '@/lib/imageQualityConfig';

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
export function measureTechRules({ assignments = [], spec = null, faceBoxes = [], cropTrace = [] } = {}) {
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
    if (/main|hero/i.test(id)) return 'hero';
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
    if (!region || !region.height) continue; // วัดไม่ได้ = ข้ามเงียบ
    const fm = faceMetrics(fb, region);
    if (!fm) continue; // ไม่มีหน้า = ข้ามเงียบ (context/evidence ไม่มีหน้าก็ไม่วัด band ที่นี่)
    const faceSharePct = +((fm.faceHpx / region.height) * 100).toFixed(1);
    const headroomPct = +(((fm.headTopPx - region.top) / region.height) * 100).toFixed(1);
    rec.faceSharePct = faceSharePct;
    rec.headroomPct = headroomPct;
    rec.hasFace = true;
    faceShareList.push({ slot: String(a.slotId), pct: faceSharePct });

    // band faceShare รายบทบาท (คลัง panelNorms) → face_share_out:<slot>:<pct>
    if (role === 'hero') {
      // P-CROP-01: ขอบ "พบจริง 30-58" (ไม่ใช่ norm 44-58 — กัน false positive)
      const [lo, hi] = TECH_RULES.HERO_FACE_SHARE;
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
async function composeCore({ slotPlan = [], refDNA = null, stableOrder = false }) {
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
    // ★ 8 ก.ค. (ผู้ใช้สั่ง "ฮีโร่หน้าเด่นเต็มเฟรมเสมอ ลดลำตัว/พื้นที่ว่าง"): บังคับหน้าฮีโร่ใหญ่ขั้นต่ำ 78%
    //   (เหนือค่า ref — ref เผื่อลำตัว 60% ทำหน้าเล็ก) · วงกลมขั้นต่ำ 70% (หน้าเต็มวง)
    //   ★ rev.2 (ผู้ใช้: "ช่องรองมุมไกลไป ต้องเน้นหน้ากว่านี้"): ช่องรอง floor 62 (เดิม 52 = เห็นเต็มตัว)
    if (kind === 'hero') pct = Math.max(pct, 78);
    else if (kind === 'circle') pct = Math.max(pct, 72); // rev.2: วงหน้าเต็มวงขึ้น
    else pct = Math.max(pct, 66);                        // rev.2 (ผู้ใช้: "เน้นหน้าเด่นกว่านี้"): ช่องรอง 62→66
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

  // ── ⑤b ✨ photo-enhance 3.2: เฉพาะ hero เมื่อภาพต้นทางเล็ก (จะถูกยืด 1.2-2.5 เท่า) ──
  //   Real-ESRGAN upscale ล้วน (face_enhance=false ตายตัวใน service — 🔴 ห้าม AI แก้หน้า/เจนภาพ)
  //   cache ผลลง data/enhance-cache กันเรียกซ้ำเปลืองเงิน · หมดเวลา 60s/ล้ม = ใช้ buffer เดิม (ห้ามล้มงาน)
  //   kill-switch COMPOSE_ENHANCE_HERO=0 = ปิดสนิท (ไม่ยิง Replicate เลย)
  if (process.env.COMPOSE_ENHANCE_HERO !== '0' && mainSlot && mi >= 0) {
    try {
      const fbH = faceBoxes[mi];
      const [hiw] = _imgWH(loaded[mi], fbH);
      const facePxW = fbH && hiw > 0 && fbH.x2 > fbH.x1 ? (fbH.x2 - fbH.x1) * hiw : 0;
      const heroUp = facePxW > 0 ? (mainSlot.w * 0.88) / facePxW : _slotUpEst(loaded[mi], fbH, mainSlot); // ยืดตามสูตรครอป hero (faceFrac 0.88)
      if (heroUp >= 1.2 && heroUp <= 2.5) {
        const cacheDir = path.join(process.cwd(), 'data', 'enhance-cache');
        const key = crypto.createHash('md5').update(String(loaded[mi].url || '') || loaded[mi].buffer.slice(0, 512)).digest('hex');
        const cachePath = path.join(cacheDir, `${key}.jpg`);
        let enhBuf = null;
        try { enhBuf = await fs.readFile(cachePath); } catch { /* ไม่มี cache */ }
        if (enhBuf) {
          console.log(`[MegaComposer] ✨💾 hero enhance cache hit (${key.slice(0, 8)})`);
        } else {
          const { upscaleImage } = await import('@/lib/services/replicateEnhancer');
          const srcB64 = loaded[mi].buffer.toString('base64');
          const enh = await Promise.race([
            upscaleImage(srcB64, 2), // ×2 (face_enhance=false ในตัว service)
            new Promise((_, rej) => setTimeout(() => rej(new Error('enhance timeout 60s')), 60000)),
          ]);
          if (enh?.base64) {
            enhBuf = Buffer.from(enh.base64, 'base64');
            try { await fs.mkdir(cacheDir, { recursive: true }); await fs.writeFile(cachePath, enhBuf); } catch { /* cache เขียนไม่ได้ = ข้าม */ }
          }
        }
        if (enhBuf && enhBuf.length > 5000) {
          loaded[mi].buffer = enhBuf; // executor อ่านขนาดใหม่จาก meta → faceBox (normalized) ยังตรง region เดิม
          qcFlags.push(`enhanced:hero:${heroUp.toFixed(2)}`);
          console.log(`[MegaComposer] ✨ hero enhance สำเร็จ (ยืด ${heroUp.toFixed(2)}x → คมขึ้น)`);
        } else {
          qcFlags.push('enhance_failed:hero');
        }
      }
    } catch (e) {
      qcFlags.push('enhance_failed:hero');
      console.log('[MegaComposer] ✨❌ hero enhance ล้ม (ใช้ภาพเดิม):', String(e?.message || '').slice(0, 60));
    }
  }

  const { executeCover } = await import('@/lib/services/coverExecutorService');
  const { detectFaces } = await import('@/lib/services/faceDetector');
  const mainSlotSpec = spec.slots.find((s) => /main|hero/i.test(String(s.id))) || null;
  const mainAssign = assignments.find((a) => /main|hero/i.test(String(a.slotId))) || null;
  let buffer;
  const traceSink = []; // audit: trace ต่อรอบเรียก — ไม่ใช้ globalThis (กันปนข้ามงานขนาน)
  const heroBanned = new Set();
  for (let attempt = 0; ; attempt++) {
    buffer = await executeCover({ assignments, imageBuffers: loaded, templateSpec: spec, faceBoxes, traceSink });
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
    } catch { heroOk = true; /* ด่านตรวจล้มเอง = ไม่บล็อกงาน */ }
    if (heroOk) { if (attempt > 0) console.log(`[MegaComposer] 🛡️ hero ผ่านด่านบังคับ (รอบ ${attempt + 1})`); break; }
    heroBanned.add(mainAssign.imageIndex);
    let ni = -1, nBest = 0;
    loaded.forEach((im, i) => {
      if (heroBanned.has(i) || (i !== mainAssign.imageIndex && used.has(i)) || isCollage[i]) return;
      if (!_heroPersonOk(im)) return; // ★ 9 ก.ค. ค่ำ: ตัวสำรอง hero ก็ห้ามผิดคนเช่นกัน
      const sc = heroScore(im, faceBoxes[i]);
      if (sc > nBest) { nBest = sc; ni = i; }
    });
    if (ni < 0) { console.log('[MegaComposer] 🛡️ hero ไม่ผ่านด่านแต่ไม่มีตัวเลือกอื่น — ใช้ที่ดีสุดเท่าที่มี'); break; }
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
function applyEyeFixes({ fixes, assignments, loaded, faceBoxes, used }) {
  let applied = 0;
  for (const f of fixes) {
    const a = assignments.find((x) => x.slotId === f.slot && !/main|hero/i.test(x.slotId));
    if (!a) continue;
    const fb = faceBoxes[a.imageIndex];
    if (f.action === 'zoom_in' && fb) { a.crop = cropFromFace(fb, 74, 'center'); applied++; }        // หน้าใหญ่ขึ้น (กิน 74%)
    else if (f.action === 'zoom_out' && fb) { a.crop = cropFromFace(fb, 46, 'center'); applied++; }   // หน้าเล็กลง (กิน 46%)
    else if (f.action === 'shift_up') { a.crop = { ...a.crop, y: Math.max(0, +(a.crop.y - 0.1).toFixed(3)) }; applied++; }
    else if (f.action === 'shift_down') { a.crop = { ...a.crop, y: Math.min(1 - a.crop.h, +(a.crop.y + 0.1).toFixed(3)) }; applied++; }
    else if (f.action === 'swap') {
      // ★ เฟส 4.2: วงกลมห้ามถูกตาสลับกลับไปเป็น "คนเดียวกับ hero" (ตาเทียบไม่รู้จักคน — เคย undo กติกา 2.3)
      const _mainA2 = assignments.find((x) => /main|hero/i.test(String(x.slotId)));
      const _heroP2 = _mainA2 ? String(loaded[_mainA2.imageIndex]?.person || '') : '';
      const _isCircle = /circle/i.test(String(a.slotId));
      let si = -1;
      for (let i = 0; i < loaded.length; i++) {
        if (used.has(i) || loaded[i].clean === false || !faceBoxes[i]) continue;
        if (_isCircle && _heroP2 && String(loaded[i]?.person || '') === _heroP2) continue;
        si = i; break;
      }
      if (si >= 0) { used.add(si); a.imageIndex = si; a.crop = cropFromFace(faceBoxes[si], 55, 'upper'); applied++; }
    }
  }
  return applied;
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
export async function composeAndVerify({ newsTitle = '', slotPlan = [], refDNA = null, refImagePath = null, stableOrder = false }) {
  try {
    const core = await composeCore({ slotPlan, refDNA, stableOrder });
    if (core.error) return { success: false, error: core.error, errorType: core.errorType };
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
          // สเกลใหม่: ตกข้อใดข้อหนึ่ง (<100) + ตามีคำสั่งแก้ = ลงมือ (เดิม <85 จะข้ามเคสตกข้อเล็ก)
          if (eye.fixes?.length && eye.similarity < 100) {
            fixedCount = applyEyeFixes({ fixes: eye.fixes, assignments: core.assignments, loaded: core.loaded, faceBoxes: core.faceBoxes, used: core.used });
            if (fixedCount) {
              // ★ Wave2 Batch C (10 ก.ค. — AI Eye ต้องเป็น advisory จริง ไม่ใช่รับคำสั่งเงียบๆแล้วเชื่อทันที):
              //   เก็บ "baseline ก่อนแก้" ครบชุด (assignments/used/buffer/trace/flags) ไว้ก่อนเรนเดอร์ทับ
              //   เผื่อ re-QC ด้านล่างพบว่าแย่ลง → revert กลับจุดนี้เป๊ะ (ไม่ใช่แค่ buffer — assignments ต้องตรงด้วย)
              const _preAssignments = core.assignments.map((a) => ({ ...a }));
              const _preAssignSnap = new Map(_preAssignments.map((a) => [a.slotId, { imageIndex: a.imageIndex, crop: JSON.stringify(a.crop) }]));
              const _preUsed = new Set(core.used);
              const _preQcFlags = [...(core.qcFlags || [])];
              const _preCropTrace = [...cropTrace];
              const _preBuffer = buffer;

              const { executeCover } = await import('@/lib/services/coverExecutorService');
              buffer = await executeCover({ assignments: core.assignments, imageBuffers: core.loaded, templateSpec: core.spec, faceBoxes: core.faceBoxes, traceSink: core.traceSink });
              cropTrace = [...(core.traceSink || [])]; // audit: trace ของรอบสุดท้าย จาก sink ของงานนี้เอง
              // audit: ธง blind_crop + upscale ต้องสะท้อนปกใบสุดท้าย (การสลับภาพของตาอาจทำให้เกิด/หาย) — เฟส 3.1
              core.qcFlags = (core.qcFlags || []).filter((f) => !/^(blind_crop|upscaled|upscale_soft):/.test(String(f)));
              core.qcFlags.push(...traceQcFlags(cropTrace));
              console.log(`[MegaComposer] 👁️ แก้ตามตา ${fixedCount} จุด → ประกอบใหม่ (bounded 1 รอบจบ)`);

              // ── 🔬 re-QC กลไกล้วน (ไม่เรียก vision LLM เพิ่ม) — ตาแค่ "เสนอ" เครื่องตัดสินว่าจะรับจริงไหม ──
              //   เทียบเฉพาะช่องที่ตาสั่งแก้ (touched: imageIndex หรือ crop เปลี่ยน) ก่อน-หลัง:
              //   · blind_crop เกิดใหม่ (ไม่มีมาก่อน) = แย่ลงชัดเจน
              //   · upscale มีเลขให้เทียบทั้งคู่ (ทั้งก่อน-หลังเคยติดธง) แล้วแย่ลง >10% = แย่ลงชัดเจน
              //   · ก่อนไม่ติดธง (ยืด <1.2 เดิม) แต่หลังยืดทะลุเพดานจริงของช่องรอง (>1.6) = แย่ลงชัดเจน
              //     (ไม่เดาเปอร์เซ็นต์จาก baseline ที่ไม่รู้ค่าเป๊ะ — ใช้เพดาน QC gate เป็นเส้นตัดสินแทน ซื่อสัตย์กว่า)
              //   ⚠️ ข้อจำกัดที่รู้แล้วยอมรับ: person_cut วัดได้จาก detectFaces บน "ปกที่เรนเดอร์จริง" เท่านั้น
              //     (vision LLM ผ่าน batchDetectFaces) — เรขาคณิตล้วนจาก faceBoxes+crop เดิมวัดแทนไม่ได้แม่น เพราะ
              //     executor ปรับ crop จริงเองอีกชั้น (crop ที่ส่งเข้าไปเป็นแค่ hint ไม่ใช่ค่าจริงที่ render)
              //     → ข้ามตัวนี้ในนี้ + ติดธง person_cut_unverified ให้เห็นข้อจำกัดชัดเจนแทนการเดาว่าผ่าน
              //   kill switch: MEGA_EYE_REQC=0 → ปิดด่านนี้ทั้งหมด (พฤติกรรมเดิมเป๊ะ: แก้แล้วรับผลทันที)
              if (process.env.MEGA_EYE_REQC !== '0') {
                const touchedSlots = core.assignments
                  .filter((a) => {
                    const pre = _preAssignSnap.get(a.slotId);
                    return !pre || pre.imageIndex !== a.imageIndex || pre.crop !== JSON.stringify(a.crop);
                  })
                  .map((a) => a.slotId);
                if (touchedSlots.length) {
                  const upOf = (flags, slot) => {
                    for (const f of flags) {
                      const m = /^(?:upscaled|upscale_soft):([^:]+):([\d.]+)$/.exec(String(f));
                      if (m && m[1] === slot) return Number(m[2]);
                    }
                    return null;
                  };
                  const blindOf = (flags, slot) => flags.includes(`blind_crop:${slot}`);
                  let regression = null;
                  for (const slot of touchedSlots) {
                    if (blindOf(core.qcFlags, slot) && !blindOf(_preQcFlags, slot)) { regression = `blind_crop_new:${slot}`; break; }
                    const beforeUp = upOf(_preQcFlags, slot);
                    const afterUp = upOf(core.qcFlags, slot);
                    if (afterUp != null) {
                      if (beforeUp != null && afterUp > beforeUp * 1.1 + 0.001) { regression = `upscale_worse:${slot}:${beforeUp.toFixed(2)}->${afterUp.toFixed(2)}`; break; }
                      if (beforeUp == null && afterUp > 1.6) { regression = `upscale_new:${slot}:${afterUp.toFixed(2)}`; break; }
                    }
                  }
                  if (regression) {
                    // ↩️ revert ทั้งชุด — กลับไปจุดก่อนตาสั่งแก้เป๊ะ (assignments/used/buffer/trace/flags ตรงกันหมด)
                    core.assignments.length = 0;
                    core.assignments.push(..._preAssignments);
                    core.used = _preUsed;
                    buffer = _preBuffer;
                    cropTrace = _preCropTrace;
                    core.qcFlags = [..._preQcFlags, `eye_fix_reverted:${regression}`];
                    fixedCount = 0; // สะท้อนความจริง: การแก้ของตาไม่ถูกใช้จริงในปกที่คืนออกไป
                    console.log(`[MegaComposer] 👁️↩️ revert eye fix (${regression}) — กลไกวัดว่าแย่ลงกว่า baseline`);
                  } else {
                    core.qcFlags.push('eye_fix_kept', 'person_cut_unverified');
                    console.log('[MegaComposer] 👁️✅ eye fix ผ่านด่านกลไก (blind_crop/upscale ไม่แย่ลง) — รับผล');
                  }
                }
              }
            }
          }
        }
      } catch (e) { console.log('[MegaComposer] ตาเทียบ ref ล้ม (ใช้ปกเดิม):', e.message?.slice(0, 50)); }
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
    } catch (e) { console.log('[MegaComposer] manifest เก็บล้ม (ไม่กระทบผลปก):', e.message?.slice(0, 60)); }
    return {
      success: true,
      base64: `data:image/jpeg;base64,${buffer.toString('base64')}`,
      template: core.spec.id,
      refSimilarity: eye?.similarity ?? null,
      refDiffs: eye?.diffs || [],
      eyeFixed: fixedCount,
      qcFlags: core.qcFlags || [], // เฟส 4.3: ธงคุณภาพ deterministic (แทน ref% ที่เชื่อไม่ได้)
      manifest, // ★ Wave1 Batch E: ความจริงของรอบประกอบ (debug/replay) — additive, null เมื่อเก็บล้ม
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
