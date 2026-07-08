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
        border: s.border ? ((s.borderColor && s.borderColor !== '-') ? s.borderColor : '#FFFFFF') : null,
        borderWidth: s.border ? Math.max(8, Math.round(((Number(s.borderWidthPct) || 1.5) / 100) * W)) : 0,
        // ★ 8 ก.ค. (ผู้ใช้สั่ง "จัดวางรูปต้องตรง ref"): note = ข้อมูลจัดวางของ ref ต่อช่อง — Director เห็นใน prompt (line 64)
        note: `ตามปกเป้า: ${s.role || ''}${s.pos ? ` @${s.pos}` : ''}${s.subject ? ` = ${s.subject}` : ''}${s.shot ? ` (${s.shot}${s.emotion ? '·' + s.emotion : ''})` : ''} — เลือกภาพจากพูลที่ใกล้แบบนี้ที่สุด`,
      };
    });

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

    // ไม่มี hero ระบุ → ช่องสี่เหลี่ยมใหญ่สุด = main (hero-tight/guards ต้องมีเป้า)
    if (!slots.some((s) => s.id === 'main')) {
      const r = slots.filter((s) => s.shape !== 'circle').sort((a, b) => b.w * b.h - a.w * a.h)[0];
      if (!r) return null;
      r.id = 'main';
    }
    // กัน id ซ้ำ (เช่น circle 2 วง)
    const seen = new Set();
    for (const s of slots) { const base = s.id; let n = 1; while (seen.has(s.id)) s.id = `${base}${n++}`; seen.add(s.id); }

    const feather = Number(t.featherPx) || (t.seamStyle === 'feather' ? 26 : 0);
    return { id: 'ref_dna', storyFit: `โครงตามปกเป้า: ${dna.layoutType || ''}`.slice(0, 120), canvasW: W, canvasH: H, feather, slots };
  } catch {
    return null;
  }
}
