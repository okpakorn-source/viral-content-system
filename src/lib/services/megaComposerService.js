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

// ---------- ✂️ สูตรครอป (เรขาคณิตล้วน ไม่มี AI) ----------
// mult = กรอบกว้างกี่เท่าของหน้า — มาจาก faceSizePct ของ "ref จริง" (ref บอกหน้ากิน 60% → mult=100/60=1.67)
function cropFromFace(fb, mult = 2.2, zoom = 1) {
  const fw = fb.x2 - fb.x1, fh = fb.y2 - fb.y1;
  const cx = (fb.x1 + fb.x2) / 2;
  const m = Math.min(3.2, Math.max(1.4, mult)) * zoom;
  let w = Math.min(1, Math.max(0.24, fw * m));
  let h = Math.min(1, Math.max(0.24, fh * m * 1.25)); // สูงกว่ากว้างเล็กน้อย (หัว-ไหล่)
  let x = Math.min(Math.max(cx - w / 2, 0), 1 - w);
  let y = Math.min(Math.max(fb.y1 - fh * 0.45, 0), 1 - h); // headroom เหนือหัว ~45% ของหน้า
  return { x: +x.toFixed(3), y: +y.toFixed(3), w: +w.toFixed(3), h: +h.toFixed(3) };
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
    if (spec) refSlotMeta = (refDNA.slots || []); // rev.2 การันตีลำดับ 1:1 กับ template.slots
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
  const refMult = (slotIdx, fallback) => {
    const p = Number(refSlotMeta?.[slotIdx]?.faceSizePct);
    return p >= 15 && p <= 95 ? 100 / p : fallback; // ref บอกหน้ากิน P% ของช่อง → กรอบ = 100/P เท่าของหน้า
  };
  const assignments = [];
  const mainSlot = spec.slots.find((s) => /main|hero/i.test(s.id));
  const circleSlots = spec.slots.filter((s) => s.shape === 'circle');
  const otherSlots = spec.slots.filter((s) => s !== mainSlot && s.shape !== 'circle');

  // main: hero แผน → หน้าเดี่ยวสะอาด → หน้าใดๆ → ใบแรก
  let mi = pickIdx((im, fb) => im.isHero && fb);
  if (mi < 0) mi = pickIdx((im, fb) => fb && fb.count === 1 && im.clean !== false);
  if (mi < 0) mi = pickIdx((im, fb) => !!fb);
  if (mi < 0) mi = pickIdx(() => true);
  if (mainSlot && mi >= 0) {
    used.add(mi);
    const mIdx = spec.slots.indexOf(mainSlot);
    assignments.push({ slotId: mainSlot.id, imageIndex: mi, crop: faceBoxes[mi] ? cropFromFace(faceBoxes[mi], refMult(mIdx, 2.0)) : { x: 0, y: 0, w: 1, h: 1 }, why: 'hero ตาม S6' });
  }
  for (const cs of circleSlots) {
    let ci = pickIdx((im) => im.slot === 'circle');
    if (ci < 0) ci = pickIdx((im, fb) => fb && fb.count === 1 && im.clean !== false);
    if (ci < 0) ci = pickIdx(() => true);
    if (ci >= 0) {
      used.add(ci);
      const cIdx = spec.slots.indexOf(cs);
      assignments.push({ slotId: cs.id, imageIndex: ci, crop: faceBoxes[ci] ? cropFromFace(faceBoxes[ci], refMult(cIdx, 1.5)) : { x: 0, y: 0, w: 1, h: 1 }, why: 'วงกลมตาม S6' });
    }
  }
  const ROLE_ORDER = ['reaction', 'action', 'context'];
  for (const os of otherSlots) {
    let oi = -1;
    for (const role of ROLE_ORDER) { oi = pickIdx((im) => im.slot === role); if (oi >= 0) break; }
    if (oi < 0) oi = pickIdx((im) => im.clean !== false);
    if (oi < 0) oi = pickIdx(() => true);
    if (oi >= 0) {
      used.add(oi);
      const oIdx = spec.slots.indexOf(os);
      assignments.push({ slotId: os.id, imageIndex: oi, crop: faceBoxes[oi] ? cropFromFace(faceBoxes[oi], refMult(oIdx, 2.4)) : { x: 0, y: 0, w: 1, h: 1 }, why: 'ช่องรองตาม S6' });
    }
  }
  if (assignments.length < spec.slots.length) {
    return { error: `จับคู่ได้ ${assignments.length}/${spec.slots.length} ช่อง — ภาพไม่พอ`, errorType: 'INSUFFICIENT_IMAGES' };
  }
  assignments.forEach((a) => console.log(`[MegaComposer] ${a.slotId} ← #${a.imageIndex} (${loaded[a.imageIndex].slot || 'สำรอง'})`));

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
    if (f.action === 'zoom_in' && fb) { a.crop = cropFromFace(fb, 2.2, 0.75); applied++; }
    else if (f.action === 'zoom_out' && fb) { a.crop = cropFromFace(fb, 2.2, 1.3); applied++; }
    else if (f.action === 'shift_up') { a.crop = { ...a.crop, y: Math.max(0, +(a.crop.y - 0.1).toFixed(3)) }; applied++; }
    else if (f.action === 'shift_down') { a.crop = { ...a.crop, y: Math.min(1 - a.crop.h, +(a.crop.y + 0.1).toFixed(3)) }; applied++; }
    else if (f.action === 'swap') {
      let si = -1;
      for (let i = 0; i < loaded.length; i++) { if (!used.has(i) && loaded[i].clean !== false && faceBoxes[i]) { si = i; break; } }
      if (si >= 0) { used.add(si); a.imageIndex = si; a.crop = cropFromFace(faceBoxes[si], 2.2); applied++; }
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
