// ============================================================
// 🎯 Ref Template — แปลง DNA ของปก reference → template spec ที่ executor ใช้ประกอบจริง
// ------------------------------------------------------------
// DNA.template.slots (พิกัด % จากการถอดแบบปกด้วยตา AI) → {canvasW,canvasH,feather,slots[px]}
// - snap ขอบเข้า anchor (0/100/ขอบช่องอื่น, tolerance 3%) กันช่องว่างขาวจากค่าประเมินคลาด
// - hero → id 'main', วงกลม → id 'circle' (ให้ guard เดิมทั้งหมดทำงาน: hero-tight/S3d/S3e/FaceLock)
// - โครงเพี้ยน/ช่องไม่พอ → คืน null (ผู้เรียก fallback โครงปกติ)
// ============================================================

// ★ A2 (8 ก.ค. ผู้ใช้สั่ง "เทมเพลตต้อง copy ref 100% ไม่มีภาพแหว่ง"): ปิดผืนเต็ม
// ① คลัสเตอร์เส้นขอบทุกช่องเข้า "เส้นกริดร่วม" (tolerance 6%) — ช่องข้างเคียงแชร์เส้นเดียวกันเสมอ ไม่มีร่อง
// ② เส้นใกล้ขอบผืน (≤6%) บังคับชนขอบ 0/100
// ③ เซลล์กริดที่ไม่มีช่องไหนครอบ → ขยายช่องข้างเคียง (เพิ่มพื้นที่น้อยสุด) เข้าปิด — การันตีคลุมทั้งผืน
function clusterLines(vals, tol = 6) {
  const sorted = [...new Set(vals)].sort((a, b) => a - b);
  const groups = [];
  for (const v of sorted) {
    const g = groups[groups.length - 1];
    if (g && v - g[g.length - 1] <= tol) g.push(v);
    else groups.push([v]);
  }
  return groups.map((g) => {
    const mean = g.reduce((n, v) => n + v, 0) / g.length;
    if (g.some((v) => v <= tol)) return 0;        // ใกล้ขอบซ้าย/บน → ชนขอบ
    if (g.some((v) => v >= 100 - tol)) return 100; // ใกล้ขอบขวา/ล่าง → ชนขอบ
    return Math.round(mean);
  }).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
}
const nearest = (v, lines) => lines.reduce((b, l) => (Math.abs(l - v) < Math.abs(b - v) ? l : b), lines[0]);

// ★ เฟส 4.1b (9 ก.ค. — ไขปริศนา "กรอบเขียวทุกใบ"): DNA บางใบวัดสีกรอบเพี้ยนเป็นนีออนจอ
//   (REF-mrbq90fp ช่อง evidence = #00FF00 ทั้งที่ปกจริงกรอบขาว) → บังคับขาว + log
// ★ 10 ก.ค. (ผู้ใช้สั่ง "ทำตาม ref"): เกณฑ์เดิมกว้างไป กิน ref จริงที่ใช้กรอบนีออนด้วย
//   (REF-mrbq8odo evidence = #BFFF00 เขียวมะนาวของจริง) → แคบลงเหลือเฉพาะ "สีปฐมภูมิล้วน"
//   (2 ช่องสี ≈0 + 1 ช่องชนเพดาน เช่น #00FF00/#FF0000) = ลายเซ็นการวัดพลาดจากจอ ไม่มีดีไซน์จริงใช้
function _safeBorderColor(c) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(c || '').trim());
  if (!m) return '#FFFFFF';
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  const lows = [r, g, b].filter((x) => x <= 10).length;
  const highs = [r, g, b].filter((x) => x >= 245).length;
  if (lows >= 2 && highs >= 1) {
    console.log(`[refTemplate] 🎨 สีกรอบจาก DNA นีออนปฐมภูมิล้วน (#${m[1]}) → บังคับขาว (วัดพลาด)`);
    return '#FFFFFF';
  }
  return `#${m[1]}`;
}

// ★ WAVE1A provenance authenticity — module-private WeakMap binding each realized-slot OBJECT IDENTITY to a
//   FROZEN authentic CONTENT snapshot { sourceIndex, id, x, y, w, h, zIndex, border, borderWidth, shape }, captured
//   AFTER all internal geometry/id mutations. A restamp/swap/strip produces a DIFFERENT object absent from this map
//   ⇒ realizedSlotProvenance() returns null ⇒ the producer HOLDs. Because the snapshot is frozen and stored by
//   identity, the authentic id/geometry cannot be tampered post-return: a caller may mutate the live slot object,
//   but the producer reads ONLY this immutable snapshot. The non-enumerable _sourceIndex descriptor is defense-in-depth.
const _SLOT_PROVENANCE = new WeakMap();

// Authentic provenance accessor: the FROZEN content snapshot bound to THIS exact realized-slot object, or null if
// `slot` was not produced by this module (restamped/swapped/foreign). Pure, no side effects, no getter invocation.
export function realizedSlotProvenance(slot) {
  if (slot === null || typeof slot !== 'object') return null;
  return _SLOT_PROVENANCE.has(slot) ? _SLOT_PROVENANCE.get(slot) : null;
}
// Back-compat: the authentic dna.template.slots index (from the frozen snapshot), or null.
export function realizedSlotSourceIndex(slot) {
  const p = realizedSlotProvenance(slot);
  return p ? p.sourceIndex : null;
}

// ★ B0 (16 ก.ค. — เจ้าของเคาะ) weak-match content sanitizer ─────────────────
//   เมื่อข่าว "ไม่ตรงแนว ref" (typeMatched=false) เรายืม ref มาเป็น "โครง/รูปทรง" เท่านั้น —
//   ห้ามให้ subject/shot/emotion ของปกเป้าบังคับการเลือกภาพ/พรอมป์ Director
//   helper นี้คืน DNA ก้อน "ใหม่" ที่ template.slots เหลือเฉพาะ geometry (ไม่ mutate ของเดิมในคลัง)
//   + ธง _contentSanitized (enumerable — อยู่รอด JSON round-trip เข้า composer/queue) เพื่อให้
//   dnaToTemplateSpec งดสร้าง note · ทุก consumer (composer refSlotMeta / buildRefSlotContract /
//   realizedTemplate) จึงได้ template.slots ไร้เนื้อหาโดยอัตโนมัติ
//   ★ ห้ามเรียกกับ strong match (typeMatched=true) → พฤติกรรมเดิมทุก byte
//   ★ B0 fix (16 ก.ค. — ผู้ตรวจเคาะ): 'role' + 'faceSizePct' = layout-structural (ไม่ใช่การรั่ว subject/คน) →
//     คงไว้ใน geometry:
//       • role  — dnaToTemplateSpec ใช้ระบุช่อง hero ('main') · composer refSlotMeta map heroT ตาม role ·
//                 ถ้า strip ทิ้ง → hero-not-largest ref (เช่น REF-mrbq6y74-on6u) จะเลือก main ผิดช่อง (ช่องใหญ่สุดแทน)
//                 การรั่วเนื้อหาของ role อยู่ที่ note เท่านั้น ซึ่งถูกปิดด้วยธง _contentSanitized อยู่แล้ว
//       • faceSizePct — เป็น "เป้าครอปหน้า" (crop geometry) ล้วน · composer อ่านเป็น _faceTargetShare (ขั้นต่ำครอป) ·
//                 ไม่เข้าพรอมป์ Director/การเลือกภาพ · ถ้า strip ทิ้ง = weak match เสีย face-targeting เงียบๆ
const _GEOMETRY_SLOT_KEYS = ['xPct', 'yPct', 'wPct', 'hPct', 'shape', 'zIndex', 'border', 'borderColor', 'borderWidthPct', 'pos', 'role', 'faceSizePct'];
export function sanitizeRefDnaForWeakMatch(dna) {
  if (!dna || typeof dna !== 'object') return dna;
  const t = dna.template;
  let template = t;
  if (t && typeof t === 'object' && Array.isArray(t.slots)) {
    const slots = t.slots.map((s) => {
      const g = {};
      if (s && typeof s === 'object') {
        for (const k of _GEOMETRY_SLOT_KEYS) if (s[k] !== undefined) g[k] = s[k];
      }
      return g;
    });
    template = { ...t, slots };
  }
  return { ...dna, template, _contentSanitized: true };
}

export function dnaToTemplateSpec(dna) {
  try {
    const t = dna?.template;
    // ★ B0: weak match ถูก sanitize มาแล้ว (template.slots geometry ล้วน + ธงนี้) → งดใส่ note บังคับเนื้อหา
    const _contentSanitized = dna?._contentSanitized === true;
    const slots0 = Array.isArray(t?.slots) ? t.slots : [];
    const rects0 = slots0.filter((s) => s.shape !== 'circle');
    if (rects0.length < 2 || slots0.length < 3) return null; // คอลลาจต้อง ≥3 ช่อง (สี่เหลี่ยม ≥2)
    // ★ 7 ก.ค. (ผู้ใช้กำหนดสเปกตายตัว): ปกทุกใบ = 1080×1350 (4:5) เสมอ — ไม่เชื่อค่าที่ AI ประเมินจากภาพ
    //   (slots เป็น % อยู่แล้ว สเกลลง canvas มาตรฐานพอดี · กัน DNA คลาดเช่น 960×720 ทำปกผิดขนาด)
    const W = 1080;
    const H = 1350;

    // ① เส้นกริดร่วมจากขอบทุกช่อง + ขอบผืน (คลัสเตอร์ 6% — DNA ที่ AI วัดคลาดถูกดูดเข้าเส้นเดียวกัน)
    const xsRaw = [0, 100], ysRaw = [0, 100];
    for (const s of rects0) {
      xsRaw.push(Number(s.xPct) || 0, (Number(s.xPct) || 0) + (Number(s.wPct) || 0));
      ysRaw.push(Number(s.yPct) || 0, (Number(s.yPct) || 0) + (Number(s.hPct) || 0));
    }
    const xLines = clusterLines(xsRaw);
    const yLines = clusterLines(ysRaw);

    // ② ทุกขอบช่อง → เส้นกริดที่ใกล้สุด (ช่องข้างเคียงจึงแชร์เส้นเดียวกันเสมอ)
    const rectBounds = []; // เก็บขอบหลัง snap (หน่วย %) สำหรับด่านปิดผืน ③
    let heroDone = false;
    const slots = slots0.map((s, i) => {
      const isC = s.shape === 'circle';
      let x = Number(s.xPct) || 0, y = Number(s.yPct) || 0, w = Number(s.wPct) || 0, h = Number(s.hPct) || 0;
      if (!isC) {
        let x1 = nearest(x, xLines), x2 = nearest(x + w, xLines);
        let y1 = nearest(y, yLines), y2 = nearest(y + h, yLines);
        if (x2 - x1 < 8) x2 = xLines.find((l) => l > x1 + 7) ?? Math.min(100, x1 + 8); // ช่องยุบหลัง snap → ขยายไปเส้นถัดไป
        if (y2 - y1 < 8) y2 = yLines.find((l) => l > y1 + 7) ?? Math.min(100, y1 + 8);
        x = x1; y = y1; w = x2 - x1; h = y2 - y1;
        rectBounds.push({ i, x1, y1, x2, y2 });
      }
      x = Math.max(0, Math.min(x, 95)); y = Math.max(0, Math.min(y, 95));
      w = Math.max(8, Math.min(w, 100 - x)); h = Math.max(8, Math.min(h, 100 - y));
      // ⭕ 10 ก.ค. (ผู้ใช้ถอนคำสั่ง "วงใหญ่ 30-36" — ให้ตามขนาด ref จริง): clamp เหลือเฉพาะ
      //   ค่าเพี้ยนสุดขั้ว [15,50] (DNA วัดพลาดชัดๆ) — ในช่วงนี้ใช้ค่า ref ตรงๆ คงจุดศูนย์กลางเดิม
      if (isC && (w > 50 || w < 15)) {
        const cx0 = x + w / 2, cy0 = y + h / 2;
        const d = Math.max(15, Math.min(50, w));
        w = d; h = d;
        x = Math.max(0, Math.min(cx0 - d / 2, 100 - d));
        y = Math.max(0, Math.min(cy0 - d / 2, 100 - d));
      }
      let id;
      if (isC) id = 'circle';
      else if (!heroDone && /hero/i.test(String(s.role || ''))) { id = 'main'; heroDone = true; }
      else id = `${(String(s.role || 'p').toLowerCase().replace(/[^a-z]/g, '') || 'p')}_${i}`;
      const _slot = {
        id,
        ...(isC ? { shape: 'circle' } : {}),
        x: Math.round((x / 100) * W), y: Math.round((y / 100) * H),
        w: Math.round((w / 100) * W), h: Math.round((h / 100) * H),
        zIndex: Number(s.zIndex) || (isC ? 4 : 0),
        border: s.border ? _safeBorderColor((s.borderColor && s.borderColor !== '-') ? s.borderColor : '') : null, // เฟส 4.1b: กันสีนีออนวัดพลาด
        borderWidth: s.border ? Math.max(8, Math.round(((Number(s.borderWidthPct) || 1.5) / 100) * W)) : 0,
        // ★ 8 ก.ค. (ผู้ใช้สั่ง "จัดวางรูปต้องตรง ref"): note = ข้อมูลจัดวางของ ref ต่อช่อง — Director เห็นใน prompt (line 64)
        // ★ B0 (16 ก.ค.): weak match (_contentSanitized) → ไม่มี note เลย (note คือช่องรั่วสุดท้ายของ subject/shot/คน เข้าพรอมป์ Director)
        ...(_contentSanitized ? {} : { note: `ตามปกเป้า: ${s.role || ''}${s.pos ? ` @${s.pos}` : ''}${s.subject ? ` = ${s.subject}` : ''}${s.shot ? ` (${s.shot}${s.emotion ? '·' + s.emotion : ''})` : ''} — เลือกภาพจากพูลที่ใกล้แบบนี้ที่สุด` }),
      };
      // ★ WAVE1A immutable provenance: the ORIGINAL dna.template.slots index (i) this realized slot derives from —
      //   the join key to the structural contract's sourceIndex (buildRefSlotContract indexes the SAME dna.template.slots).
      //   (1) AUTHORITY = WeakMap keyed by object identity (unforgeable — a restamp is a new object, absent from it).
      //   (2) DEFENSE-IN-DEPTH = non-enumerable + non-writable + non-configurable descriptor: invisible to
      //       JSON.stringify / Object.keys / spread ⇒ ZERO byte change to every existing consumer; the producer also
      //       verifies these exact descriptor attributes. Both survive the id-relabel/geometry-repair mutations below.
      Object.defineProperty(_slot, '_sourceIndex', { value: i, enumerable: false, writable: false, configurable: false });
      return _slot; // WeakMap content snapshot is bound at the END, after geometry/id mutations settle (see below).
    });

    // ②b ★ 9 ก.ค. (REF-mrbq6y74: DNA วัด 2 ช่องพิกัดทับกันเป๊ะ → ภาพโดนบังมิด "ไม่ทำตาม ref"):
    //   ด่านกันช่องชนกัน — rect คู่ไหนซ้อนทับ (IoU) > 0.6 = DNA วัดพลาดแน่นอน (ปกจริงไม่มีช่องทับกันขนาดนี้)
    //   → ช่องที่มี "กรอบสี" = ภาพแปะกรอบของปกไวรัล → หดเป็น inset 62% ลอยทับ (zIndex สูง) ตามธรรมชาติปกจริง
    //   → ไม่มีกรอบแยกไม่ออก → ตัดช่องหลังทิ้ง (ยังไงก็ถูกบังมิด เสียภาพเปล่า)
    for (let a = 0; a < rectBounds.length; a++) {
      for (let b = a + 1; b < rectBounds.length; b++) {
        const A = rectBounds[a], B = rectBounds[b];
        if (!A || !B) continue;
        const ix = Math.max(0, Math.min(A.x2, B.x2) - Math.max(A.x1, B.x1));
        const iy = Math.max(0, Math.min(A.y2, B.y2) - Math.max(A.y1, B.y1));
        const inter = ix * iy;
        const areaA = (A.x2 - A.x1) * (A.y2 - A.y1), areaB = (B.x2 - B.x1) * (B.y2 - B.y1);
        const iou = inter / Math.max(1, areaA + areaB - inter);
        if (iou <= 0.6) continue;
        const sA = slots[A.i], sB = slots[B.i];
        if (!sA || !sB) continue;
        const pick = (sA.border && !sB.border) ? { s: sA, r: a } : (sB.border && !sA.border) ? { s: sB, r: b } : null;
        if (pick) {
          const nw = Math.round(pick.s.w * 0.62), nh = Math.round(pick.s.h * 0.62);
          pick.s.x = Math.round(pick.s.x + (pick.s.w - nw) / 2);
          pick.s.y = Math.round(pick.s.y + (pick.s.h - nh) / 2);
          pick.s.w = nw; pick.s.h = nh;
          pick.s.zIndex = Math.max(3, (Number(pick.s.zIndex) || 0) + 3);
          rectBounds[pick.r] = null; // inset ไม่ร่วมปิดผืน — โซนนั้นช่องอีกใบคลุมเต็มอยู่แล้ว
        } else {
          slots[B.i] = null;   // ตัดช่องหลัง (ถูกบังมิด)
          rectBounds[b] = null;
        }
      }
    }
    for (let k = rectBounds.length - 1; k >= 0; k--) { if (!rectBounds[k]) rectBounds.splice(k, 1); }

    // ③ ด่านปิดผืน: เซลล์กริดไหนไม่มีช่องครอบ → ขยายช่องที่เพิ่มพื้นที่น้อยสุดเข้าปิด (การันตีเต็ม 100% ไม่มีร่อง "ภาพแหว่ง")
    //   ขยายแล้วอาจซ้อนช่องข้างเล็กน้อย = ยอมรับ (zIndex+feather กลบรอยต่อ) ดีกว่าเหลือร่องขาว
    try {
      for (let pass = 0; pass < 3; pass++) {
        let holes = 0;
        for (let xi = 0; xi < xLines.length - 1; xi++) {
          for (let yi = 0; yi < yLines.length - 1; yi++) {
            const cx1 = xLines[xi], cx2 = xLines[xi + 1], cy1 = yLines[yi], cy2 = yLines[yi + 1];
            if (rectBounds.some((r) => r.x1 <= cx1 && r.x2 >= cx2 && r.y1 <= cy1 && r.y2 >= cy2)) continue;
            holes++;
            let best = null, bestAdd = Infinity;
            for (const r of rectBounds) {
              const nx1 = Math.min(r.x1, cx1), nx2 = Math.max(r.x2, cx2);
              const ny1 = Math.min(r.y1, cy1), ny2 = Math.max(r.y2, cy2);
              const add = (nx2 - nx1) * (ny2 - ny1) - (r.x2 - r.x1) * (r.y2 - r.y1);
              if (add < bestAdd) { bestAdd = add; best = { r, nx1, nx2, ny1, ny2 }; }
            }
            if (best) { best.r.x1 = best.nx1; best.r.x2 = best.nx2; best.r.y1 = best.ny1; best.r.y2 = best.ny2; }
          }
        }
        if (!holes) break;
      }
      // เขียนขอบที่ปิดผืนแล้วกลับลง slots (px)
      for (const r of rectBounds) {
        const s = slots[r.i];
        if (!s || s.shape === 'circle') continue;
        s.x = Math.round((r.x1 / 100) * W); s.y = Math.round((r.y1 / 100) * H);
        s.w = Math.round(((r.x2 - r.x1) / 100) * W); s.h = Math.round(((r.y2 - r.y1) / 100) * H);
      }
    } catch { /* ปิดผืนล้ม → ใช้ช่องหลัง snap ตามเดิม (แค่เสี่ยงร่องเท่าเดิม ไม่พังปก) */ }

    // ★ 9 ก.ค.: กรองช่องที่ถูกด่านกันชนตัดทิ้ง (null) ออกก่อนใช้ต่อ
    const live = slots.filter(Boolean);
    if (live.filter((s) => s.shape !== 'circle').length < 2 || live.length < 3) return null; // ตัดแล้วเหลือไม่พอ = โครงใช้ไม่ได้

    // ไม่มี hero ระบุ → ช่องสี่เหลี่ยมใหญ่สุด = main (hero-tight/guards ต้องมีเป้า)
    if (!live.some((s) => s.id === 'main')) {
      const r = live.filter((s) => s.shape !== 'circle').sort((a, b) => b.w * b.h - a.w * a.h)[0];
      if (!r) return null;
      r.id = 'main';
    }
    // กัน id ซ้ำ (เช่น circle 2 วง)
    const seen = new Set();
    for (const s of live) { const base = s.id; let n = 1; while (seen.has(s.id)) s.id = `${base}${n++}`; seen.add(s.id); }

    // ★ WAVE1A: bind the FROZEN authentic content snapshot NOW — all id/geometry mutations have settled. Keyed by
    //   object identity; the producer reads render authority (composerSlotId=id, shape) + geometry ONLY from this
    //   immutable snapshot, so a caller mutating the live slot afterwards cannot forge id/geometry (content-tamper proof).
    for (const s of live) {
      const _si = Object.getOwnPropertyDescriptor(s, '_sourceIndex');
      _SLOT_PROVENANCE.set(s, Object.freeze({
        sourceIndex: _si ? _si.value : null,
        id: s.id, x: s.x, y: s.y, w: s.w, h: s.h,
        zIndex: s.zIndex, border: s.border, borderWidth: s.borderWidth,
        shape: s.shape === 'circle' ? 'circle' : 'rect',
      }));
    }

    // ★ 10 ก.ค. (ผู้ใช้ถอนคำสั่ง "ตะเข็บคม cap 8" — ให้ตาม feather ของ ref จริง เช่น 13/22):
    //   เหลือ cap กันค่าเพี้ยนสุดขั้วที่ 40 (feather 40 = แถบ 80px ไม่มีปกจริงใช้) · เกิน = ธง feather_capped เหมือนเดิม
    const FEATHER_CAP = 40;
    const featherRaw = Number(t.featherPx) || (t.seamStyle === 'feather' ? 26 : 0);
    const feather = Math.min(featherRaw, FEATHER_CAP);
    const _featherCapped = featherRaw > FEATHER_CAP;
    if (_featherCapped) console.log(`[refTemplate] 🩹 feather ${featherRaw}→${feather} (cap ${FEATHER_CAP}) — ตะเข็บคมขึ้น`);
    return { id: 'ref_dna', storyFit: `โครงตามปกเป้า: ${dna.layoutType || ''}`.slice(0, 120), canvasW: W, canvasH: H, feather, ...(_featherCapped ? { _featherCapped: true } : {}), slots: live };
  } catch {
    return null;
  }
}
