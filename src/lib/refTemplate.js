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
//   (REF-mrbq90fp ช่อง evidence = #00FF00 ทั้งที่ปกจริงกรอบขาว) → ปกทุกใบที่ใช้ ref นั้นโดนวาดกรอบเขียวสด
//   สีนีออนสุดขั้ว (ช่องสีชนเพดาน+ช่องอื่นเกือบศูนย์) ไม่มีปกจริงใช้ = วัดพลาดแน่นอน → บังคับขาว + log
function _safeBorderColor(c) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(c || '').trim());
  if (!m) return '#FFFFFF';
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  if (Math.max(r, g, b) - Math.min(r, g, b) >= 200 && Math.min(r, g, b) <= 40) {
    console.log(`[refTemplate] 🎨 สีกรอบจาก DNA นีออนผิดปกติ (#${m[1]}) → บังคับขาว (วัดพลาด)`);
    return '#FFFFFF';
  }
  return `#${m[1]}`;
}

export function dnaToTemplateSpec(dna) {
  try {
    const t = dna?.template;
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
      // ⭕ 9 ก.ค. (ผู้ใช้: "วงต้องใหญ่เท่ากับ ref ห้ามใหญ่กว่า"): ใช้ขนาดจริงจาก DNA (=ref) clamp [24,36]
      //   (เดิม cap 32 ทำวงเล็กกว่า ref · DNA วัดเกิน 36 = ผิดปกติค่อยหด — คงจุดศูนย์กลางเดิมเสมอ)
      if (isC && (w > 36 || w < 30)) { // rev.2 (9 ก.ค. "วงยังเล็กไป"): floor 24→30 (วงปกไวรัลจริง 30-36)
        const cx0 = x + w / 2, cy0 = y + h / 2;
        const d = Math.max(30, Math.min(36, w));
        w = d; h = d;
        x = Math.max(0, Math.min(cx0 - d / 2, 100 - d));
        y = Math.max(0, Math.min(cy0 - d / 2, 100 - d));
      }
      let id;
      if (isC) id = 'circle';
      else if (!heroDone && /hero/i.test(String(s.role || ''))) { id = 'main'; heroDone = true; }
      else id = `${(String(s.role || 'p').toLowerCase().replace(/[^a-z]/g, '') || 'p')}_${i}`;
      return {
        id,
        ...(isC ? { shape: 'circle' } : {}),
        x: Math.round((x / 100) * W), y: Math.round((y / 100) * H),
        w: Math.round((w / 100) * W), h: Math.round((h / 100) * H),
        zIndex: Number(s.zIndex) || (isC ? 4 : 0),
        border: s.border ? _safeBorderColor((s.borderColor && s.borderColor !== '-') ? s.borderColor : '') : null, // เฟส 4.1b: กันสีนีออนวัดพลาด
        borderWidth: s.border ? Math.max(8, Math.round(((Number(s.borderWidthPct) || 1.5) / 100) * W)) : 0,
        // ★ 8 ก.ค. (ผู้ใช้สั่ง "จัดวางรูปต้องตรง ref"): note = ข้อมูลจัดวางของ ref ต่อช่อง — Director เห็นใน prompt (line 64)
        note: `ตามปกเป้า: ${s.role || ''}${s.pos ? ` @${s.pos}` : ''}${s.subject ? ` = ${s.subject}` : ''}${s.shot ? ` (${s.shot}${s.emotion ? '·' + s.emotion : ''})` : ''} — เลือกภาพจากพูลที่ใกล้แบบนี้ที่สุด`,
      };
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

    // ★ เฟส 3.5 (10 ก.ค.): feather เดิม fallback 26 = แถบเบลอ 52px คร่อมตะเข็บทุกช่อง (เบลอหน้า/ทำภาพนุ่มเกิน)
    //   cap ที่ 8 (ยัง collage แต่ตะเข็บคมขึ้นชัด) · เกิน = ติดธง _featherCapped ให้ composer ส่ง qcFlags feather_capped
    const FEATHER_CAP = 8;
    const featherRaw = Number(t.featherPx) || (t.seamStyle === 'feather' ? 26 : 0);
    const feather = Math.min(featherRaw, FEATHER_CAP);
    const _featherCapped = featherRaw > FEATHER_CAP;
    if (_featherCapped) console.log(`[refTemplate] 🩹 feather ${featherRaw}→${feather} (cap ${FEATHER_CAP}) — ตะเข็บคมขึ้น`);
    return { id: 'ref_dna', storyFit: `โครงตามปกเป้า: ${dna.layoutType || ''}`.slice(0, 120), canvasW: W, canvasH: H, feather, ...(_featherCapped ? { _featherCapped: true } : {}), slots: live };
  } catch {
    return null;
  }
}
