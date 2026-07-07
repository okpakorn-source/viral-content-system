// ============================================================
// 🎯 Ref Template — แปลง DNA ของปก reference → template spec ที่ executor ใช้ประกอบจริง
// ------------------------------------------------------------
// DNA.template.slots (พิกัด % จากการถอดแบบปกด้วยตา AI) → {canvasW,canvasH,feather,slots[px]}
// - snap ขอบเข้า anchor (0/100/ขอบช่องอื่น, tolerance 3%) กันช่องว่างขาวจากค่าประเมินคลาด
// - hero → id 'main', วงกลม → id 'circle' (ให้ guard เดิมทั้งหมดทำงาน: hero-tight/S3d/S3e/FaceLock)
// - โครงเพี้ยน/ช่องไม่พอ → คืน null (ผู้เรียก fallback โครงปกติ)
// ============================================================

export function dnaToTemplateSpec(dna) {
  try {
    const t = dna?.template;
    const slots0 = Array.isArray(t?.slots) ? t.slots : [];
    const rects = slots0.filter((s) => s.shape !== 'circle');
    if (rects.length < 2 || slots0.length < 3) return null; // คอลลาจต้อง ≥3 ช่อง (สี่เหลี่ยม ≥2)
    // ★ 7 ก.ค. (ผู้ใช้กำหนดสเปกตายตัว): ปกทุกใบ = 1080×1350 (4:5) เสมอ — ไม่เชื่อค่าที่ AI ประเมินจากภาพ
    //   (slots เป็น % อยู่แล้ว สเกลลง canvas มาตรฐานพอดี · กัน DNA คลาดเช่น 960×720 ทำปกผิดขนาด)
    const W = 1080;
    const H = 1350;

    // anchor แกน x/y จากขอบทุกช่อง + ขอบผืน — ปัดค่าที่คลาด ≤3% เข้าหากัน
    const xs = [0, 100], ys = [0, 100];
    for (const s of rects) {
      xs.push(Number(s.xPct) || 0, (Number(s.xPct) || 0) + (Number(s.wPct) || 0));
      ys.push(Number(s.yPct) || 0, (Number(s.yPct) || 0) + (Number(s.hPct) || 0));
    }
    const snap = (v, arr) => { for (const a of arr) { if (a !== v && Math.abs(v - a) <= 3) return a; } return v; };

    let heroDone = false;
    const slots = slots0.map((s, i) => {
      const isC = s.shape === 'circle';
      let x = Number(s.xPct) || 0, y = Number(s.yPct) || 0, w = Number(s.wPct) || 0, h = Number(s.hPct) || 0;
      if (!isC) {
        const x2 = snap(x + w, xs), y2 = snap(y + h, ys);
        x = snap(x, xs); y = snap(y, ys); w = x2 - x; h = y2 - y;
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
        note: `ตามปกเป้า: ${s.role || ''}`,
      };
    });

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
