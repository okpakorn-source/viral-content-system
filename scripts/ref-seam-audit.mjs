// ============================================================
// 📏 Ref Seam Audit — วัด "ตะเข็บจริง" บนภาพ ref ตามแนวเส้นเทมเพลตที่ตาคนยืนยัน (คณิตล้วน)
// ต่อเส้นแบ่งช่อง: สุ่มจุดตามแนวเส้น → โปรไฟล์ gradient ตั้งฉาก ±14px →
//   คม (peak แคบ ≤3px) = ทำตามได้ · เบลอ (spread 4-16px สม่ำเสมอ) = ใส่ feather ตามได้ ·
//   หาเส้นไม่เจอ (ไม่มี peak ชัด) = ตกแต่ง/เบลอหนัก ทำตามยาก
// ============================================================
import sharp from 'sharp';
import { readFileSync } from 'fs';
import path from 'path';

const W = 540, H = 675; // ครึ่งสเกลของ 1080x1350
const arr = JSON.parse(readFileSync('data/ref-cover-library.json', 'utf8'));
const refs = arr.filter((x) => x.dna?.template?.slots && x.imagePath);

function gridLines(slots) {
  // เส้นภายในจาก rect ฐาน (ข้าม circle + inset z≥3 — พวกนี้ลอยทับ ไม่ใช่ตะเข็บกริด)
  const rects = slots.filter((s) => s.shape !== 'circle' && (Number(s.zIndex) || 0) < 3);
  const xs = new Set(), ys = new Set();
  for (const s of rects) {
    for (const v of [s.xPct, s.xPct + s.wPct]) if (v > 5 && v < 95) xs.add(Math.round(v));
    for (const v of [s.yPct, s.yPct + s.hPct]) if (v > 5 && v < 95) ys.add(Math.round(v));
  }
  // จุดสุ่มบนเส้น: เฉพาะช่วงที่เส้นเป็นรอยต่อของ 2 ช่องจริง และไม่โดน circle/inset ทับ
  const overlays = slots.filter((s) => s.shape === 'circle' || (Number(s.zIndex) || 0) >= 3);
  const covered = (px, py) => overlays.some((o) => px >= o.xPct - 2 && px <= o.xPct + o.wPct + 2 && py >= o.yPct - 2 && py <= o.yPct + o.hPct + 2);
  const inRect = (px, py) => rects.some((s) => px > s.xPct + 1 && px < s.xPct + s.wPct - 1 && py > s.yPct + 1 && py < s.yPct + s.hPct - 1);
  const lines = [];
  for (const x of xs) {
    const pts = [];
    for (let y = 4; y <= 96; y += 3) if (!covered(x, y) && inRect(x - 2, y) && inRect(x + 2, y)) pts.push([x, y]);
    if (pts.length >= 5) lines.push({ axis: 'v', pos: x, pts });
  }
  for (const y of ys) {
    const pts = [];
    for (let x = 4; x <= 96; x += 3) if (!covered(x, y) && inRect(x, y - 2) && inRect(x, y + 2)) pts.push([x, y]);
    if (pts.length >= 5) lines.push({ axis: 'h', pos: y, pts });
  }
  return lines;
}

async function auditRef(r) {
  const p = path.join(process.cwd(), 'public', r.imagePath.replace(/^\//, ''));
  let raw;
  try { raw = await sharp(p).greyscale().resize(W, H, { fit: 'fill' }).raw().toBuffer(); } catch { return { err: 'โหลดภาพไม่ได้' }; }
  const px = (x, y) => raw[Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))];
  const lines = gridLines(r.dna.template.slots);
  if (!lines.length) return { verdict: 'NO_LINES', lines: [] };
  const out = [];
  for (const ln of lines) {
    const spreads = [];
    let found = 0;
    for (const [gx, gy] of ln.pts) {
      const cx = Math.round((gx / 100) * W), cy = Math.round((gy / 100) * H);
      const R = 14;
      const prof = [];
      for (let o = -R; o <= R; o++) {
        const a = ln.axis === 'v' ? px(cx + o, cy) : px(cx, cy + o);
        const b = ln.axis === 'v' ? px(cx + o + 1, cy) : px(cx, cy + o + 1);
        prof.push(Math.abs(b - a));
      }
      const peak = Math.max(...prof);
      if (peak < 14) continue; // ไม่มีขอบตรงนี้ (เบลอจนเรียบ/ตกแต่งกลืน)
      found++;
      const half = peak / 2;
      let lo = prof.findIndex((v) => v >= half);
      let hi = prof.length - 1 - [...prof].reverse().findIndex((v) => v >= half);
      spreads.push(Math.max(1, hi - lo + 1) * 2); // ×2 กลับสเกลเต็ม (วัดที่ครึ่งสเกล)
    }
    const coverage = found / ln.pts.length;
    const medSpread = spreads.sort((a, b) => a - b)[Math.floor(spreads.length / 2)] || 0;
    let cls;
    if (coverage < 0.45) cls = 'messy';           // เกินครึ่งหาขอบไม่เจอ = ตะเข็บถูกกลืน/ตกแต่ง
    else if (medSpread <= 5) cls = 'hard';        // ขอบคม
    else if (medSpread <= 18) cls = 'feather';    // เบลอสม่ำเสมอ — เรนเดอร์ feather ตามได้
    else cls = 'messy';
    out.push({ axis: ln.axis, pos: ln.pos, coverage: +coverage.toFixed(2), spread: medSpread, cls });
  }
  const messy = out.filter((l) => l.cls === 'messy').length;
  const feather = out.filter((l) => l.cls === 'feather');
  const verdict = messy === 0 ? (feather.length ? 'FEATHER' : 'HARD') : (messy <= out.length / 3 ? 'PARTIAL' : 'MESSY');
  const featherPx = feather.length ? Math.round(feather.reduce((n, l) => n + l.spread, 0) / feather.length) : 0;
  return { verdict, featherPx, lines: out };
}

for (const r of refs) {
  const a = await auditRef(r);
  if (a.err) { console.log(`❓ ${r.id} — ${a.err}`); continue; }
  const det = (a.lines || []).map((l) => `${l.axis}${l.pos}:${l.cls}(cov${l.coverage},sp${l.spread})`).join(' ');
  const icon = { HARD: '🟢', FEATHER: '🔵', PARTIAL: '🟡', MESSY: '🔴', NO_LINES: '❓' }[a.verdict];
  console.log(`${icon} ${a.verdict}${a.featherPx ? ` f=${a.featherPx}px` : ''} ${r.id} · ${String(r.styleName).slice(0, 24)}\n   ${det}`);
}
