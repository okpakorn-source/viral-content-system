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

// ---------- แปลงผล detectFaces (พิกเซล) → faceBox normalized แบบที่ executeCover ใช้ ----------
function normalizeFaceBox(fd) {
  if (!fd?.hasFaces || !fd.faces?.length) return null;
  const W = fd.imageWidth || 1, H = fd.imageHeight || 1;
  const largest = fd.faces.reduce((b, f) => (f.width * f.height > b.width * b.height ? f : b), fd.faces[0]);
  const area = largest.width * largest.height;
  const sig = fd.faces.filter((f) => f.width * f.height >= 0.35 * area); // ตัดหน้าจิ๋วฉากหลัง
  return {
    x1: +(largest.x / W).toFixed(3), y1: +(largest.y / H).toFixed(3),
    x2: +((largest.x + largest.width) / W).toFixed(3), y2: +((largest.y + largest.height) / H).toFixed(3),
    imgW: W, imgH: H, // 🔑 rev.4: สัดส่วนภาพจริง — fit aspect ต้องคิด "หน่วยพิกเซล" ให้ตรงกับ executor
    count: sig.length,
    allFaces: sig.map((f) => ({
      x1: +(f.x / W).toFixed(3), y1: +(f.y / H).toFixed(3),
      x2: +((f.x + f.width) / W).toFixed(3), y2: +((f.y + f.height) / H).toFixed(3),
    })),
  };
}

// ---------- แกนประกอบ (ใช้ร่วม compose/verify) ----------
async function composeCore({ slotPlan = [], refDNA = null }) {
  if (!Array.isArray(slotPlan) || !slotPlan.length) {
    return { error: 'ไม่มี slotPlan — S6 ต้องเลือกภาพมาก่อน', errorType: 'NO_SLOT_PLAN' };
  }

  // ── ① โหลดภาพทั้งแผน (หลัก+สำรอง) — ลิงก์ตรงพัง → thumbnail ──
  const loaded = [];
  await Promise.all(slotPlan.map(async (p) => {
    let buf = await fetchOne(p.url);
    if (!buf && p.thumbnailUrl && p.thumbnailUrl !== p.url) buf = await fetchOne(p.thumbnailUrl);
    if (buf && buf.length > 5000) loaded.push({ ...p, buffer: buf });
  }));
  console.log(`[MegaComposer] โหลดภาพ ${loaded.length}/${slotPlan.length}`);
  if (loaded.length < 3) {
    return { error: `ภาพโหลดได้ ${loaded.length} ใบ (ต้อง ≥3) — ลิงก์พัง/ภาพข่าวนี้หายาก`, errorType: 'INSUFFICIENT_IMAGES' };
  }

  // ── ② ตาหาหน้า (perception — อินพุตให้สูตร ไม่ใช่คนตัดสิน) ──
  const { batchDetectFaces } = await import('@/lib/services/faceDetector');
  const fdMap = await batchDetectFaces(loaded.map((im, i) => ({ id: `mc_${i}`, buffer: im.buffer })));
  const faceBoxes = loaded.map((im, i) => normalizeFaceBox(fdMap?.get?.(`mc_${i}`)));

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
    //   ใช้ได้เฉพาะเมื่อจำนวนช่องตรงกับ spec (ด่านกันชนอาจตัดช่อง → ลำดับเพี้ยน = ไม่ใช้ ปลอดภัยกว่า)
    if (spec) {
      const tSlots = refDNA.template?.slots || refDNA.slots || [];
      refSlotMeta = tSlots.length === spec.slots.length ? tSlots : null;
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

  // main: 🔒 LOCK หน้าเด่น "เดี่ยว" — (8 ก.ค. AC-0027: hero ภาพกอด 2 หน้าหลุดมาได้) ทุก tier บังคับ count===1 ก่อน
  //   หน้าเดี่ยวหมดจริงๆ ค่อยยอมหลายหน้า (ดีกว่าไร้หน้า) → ไร้หน้า → ใบแรก
  let mi = pickIdx((im, fb) => im.isHero && bigFace(fb) && fb.count === 1 && im.clean !== false);
  if (mi < 0) mi = pickIdx((im, fb) => im.isHero && bigFace(fb) && fb.count === 1);
  if (mi < 0) mi = pickIdx((im, fb) => bigFace(fb) && fb.count === 1 && im.clean !== false);
  if (mi < 0) mi = pickIdx((im, fb) => bigFace(fb) && fb.count === 1);
  if (mi < 0) mi = pickIdx((im, fb) => fb && fb.count === 1 && im.clean !== false);
  if (mi < 0) mi = pickIdx((im, fb) => im.isHero && bigFace(fb));   // หน้าเดี่ยวไม่มีเลย → hero แผนแม้หลายหน้า
  if (mi < 0) mi = pickIdx((im, fb) => bigFace(fb));
  if (mi < 0) mi = pickIdx((im, fb) => !!fb);
  if (mi < 0) mi = pickIdx(() => true);
  if (mainSlot && mi >= 0) {
    used.add(mi);
    const mIdx = spec.slots.indexOf(mainSlot);
    const hs = faceSpec(mIdx, 'hero');
    console.log(`[MegaComposer] 🔒 hero #${mi} — ${bigFace(faceBoxes[mi]) ? 'หน้าเด่น' : '⚠️ พูลไม่มีหน้าเด่น ใช้เท่าที่มี'} · หน้ากิน ${hs.pct}% (${hs.pos})${loaded[mi].clean === false ? ' (ยอมภาพไม่สะอาด)' : ''}`);
    assignments.push({ slotId: mainSlot.id, imageIndex: mi, crop: faceBoxes[mi] ? cropFromFace(faceBoxes[mi], hs.pct, hs.pos, mainSlot.w / mainSlot.h) : { x: 0, y: 0, w: 1, h: 1 }, why: 'hero หน้าเด่น (locked)' });
  }
  for (const cs of circleSlots) {
    // 👁️ goodCircleFace: วงกลมต้องหน้าเดี่ยวเด่นสะอาด (กันกราฟิก/ข่าว-overlay/หน้าจิ๋วลงวง)
    //   ★ 8 ก.ค. (ผู้ใช้: "วงกลมไกลเกิน ดูไม่รู้ใคร"): เพิ่ม tier "มีหน้า (แม้ไม่สะอาด)" ก่อนยอมภาพไร้หน้า
    //   + ภาพไร้หน้าห้าม full-frame → ครอปสี่เหลี่ยมกลาง-บน (ซูมขึ้น อย่างน้อยเห็นตัวเรื่องใกล้ๆ)
    let ci = pickIdx((im, fb) => im.slot === 'circle' && bigFace(fb) && fb.count === 1 && im.clean !== false);
    if (ci < 0) ci = pickIdx((im, fb) => bigFace(fb) && fb.count === 1 && im.clean !== false);
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
    let oi = -1;
    // ★ 9 ก.ค.: ภาพข่าวจริง (newsScene≠false) ก่อนภาพแฟ้มเสมอ — กันชุดกาล่า/พรมแดงหลุดเข้าปกข่าวครอบครัว
    for (const role of order) { oi = pickIdx((im, fb) => im.slot === role && faceOk(fb) && im.clean !== false && im.newsScene !== false); if (oi >= 0) break; }
    if (oi < 0) { for (const role of order) { oi = pickIdx((im, fb) => im.slot === role && faceOk(fb) && im.clean !== false); if (oi >= 0) break; } }
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

  // ── ⑤ 🧩 ประกอบพิกเซล ──
  const { executeCover } = await import('@/lib/services/coverExecutorService');
  const buffer = await executeCover({ assignments, imageBuffers: loaded, templateSpec: spec, faceBoxes });
  console.log(`[MegaComposer] ✅ ประกอบเสร็จ ${Math.round(buffer.length / 1024)}KB (${spec.id})`);
  return { buffer, spec, assignments, loaded, faceBoxes, used, refSlotMeta };
}

// ---------- 👁️ ตาเทียบ ref: เห็น "ภาพจริง" ทั้งคู่ — ครั้งแรกที่ระบบตรวจด้วยภาพชนภาพ ----------
async function refCompareEye({ coverBuffer, refImagePath, newsTitle }) {
  const refBuf = await fetchOne(refImagePath);
  if (!refBuf) return null;
  const { callAI } = await import('@/lib/ai/openai');
  const res = await callAI({
    systemPrompt: `คุณคือตาตรวจปกของทีมกราฟฟิก เทียบ "ปกที่ทีมทำ (ภาพที่ 1)" กับ "ปกต้นแบบ (ภาพที่ 2)"
ให้ประเมินเชิงโครง/การจัดวาง/ระยะช็อต/อารมณ์ (ไม่ใช่ว่าเป็นคนเดียวกันไหม — คนละข่าวกัน)
สั่งแก้ได้เฉพาะ: ครอปช่องรอง (zoom_in/zoom_out/shift_up/shift_down) หรือ swap ช่องรองเป็นภาพสำรอง — ห้ามแตะช่องใหญ่ซ้าย(hero)/โครง
ตอบ JSON เท่านั้น: {"similarity":0-100,"diffs":["จุดต่าง ≤3 ข้อ"],"fixes":[{"slot":"ชื่อช่อง เช่น right_top/context_1/circle","action":"zoom_in|zoom_out|shift_up|shift_down|swap"}]}`,
    userPrompt: `ข่าว: ${String(newsTitle || '').slice(0, 100)} — เทียบและให้คะแนน`,
    imageContents: [
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${coverBuffer.toString('base64')}`, detail: 'low' } },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${refBuf.toString('base64')}`, detail: 'low' } },
    ],
    model: 'gpt-4o', temperature: 0.1, maxTokens: 500,
  });
  const parsed = typeof res === 'object' && res !== null && !res.text ? res : JSON.parse(String(res?.text || res).match(/\{[\s\S]*\}/)?.[0] || 'null');
  if (!parsed || !Number.isFinite(Number(parsed.similarity))) return null;
  return { similarity: Number(parsed.similarity), diffs: parsed.diffs || [], fixes: (parsed.fixes || []).slice(0, 3) };
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
      let si = -1;
      for (let i = 0; i < loaded.length; i++) { if (!used.has(i) && loaded[i].clean !== false && faceBoxes[i]) { si = i; break; } }
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
export async function composeAndVerify({ newsTitle = '', slotPlan = [], refDNA = null, refImagePath = null }) {
  try {
    const core = await composeCore({ slotPlan, refDNA });
    if (core.error) return { success: false, error: core.error, errorType: core.errorType };
    let buffer = core.buffer;
    let eye = null;
    let fixedCount = 0;
    if (refImagePath) {
      try {
        eye = await refCompareEye({ coverBuffer: buffer, refImagePath, newsTitle });
        if (eye) {
          console.log(`[MegaComposer] 👁️ เหมือน ref ${eye.similarity}% — ${eye.diffs.join(' · ').slice(0, 120)}`);
          if (eye.fixes?.length && eye.similarity < 85) {
            fixedCount = applyEyeFixes({ fixes: eye.fixes, assignments: core.assignments, loaded: core.loaded, faceBoxes: core.faceBoxes, used: core.used });
            if (fixedCount) {
              const { executeCover } = await import('@/lib/services/coverExecutorService');
              buffer = await executeCover({ assignments: core.assignments, imageBuffers: core.loaded, templateSpec: core.spec, faceBoxes: core.faceBoxes });
              console.log(`[MegaComposer] 👁️ แก้ตามตา ${fixedCount} จุด → ประกอบใหม่ (bounded 1 รอบจบ)`);
            }
          }
        }
      } catch (e) { console.log('[MegaComposer] ตาเทียบ ref ล้ม (ใช้ปกเดิม):', e.message?.slice(0, 50)); }
    }
    return {
      success: true,
      base64: `data:image/jpeg;base64,${buffer.toString('base64')}`,
      template: core.spec.id,
      refSimilarity: eye?.similarity ?? null,
      refDiffs: eye?.diffs || [],
      eyeFixed: fixedCount,
      placed: core.assignments.map((a) => ({ slot: a.slotId, role: core.loaded[a.imageIndex].slot })),
    };
  } catch (err) {
    console.log('[MegaComposer] ❌', err.message?.slice(0, 100));
    return { success: false, error: err.message || 'ประกอบปกล้มเหลว', errorType: 'COMPOSE_FAILED' };
  }
}
