// ============================================================
// 📏→✅ ปรับคลัง ref ตามผลวัดตะเข็บ (ผู้ใช้เคาะ 9 ก.ค.: "เก็บเฉพาะ ref ที่ทำตามได้จริง ลบที่ตามยากทิ้ง")
// เกณฑ์ต่อเส้น (ผ่อนจาก audit แรก): coverage ≥0.5 + spread ≤26 = feather ตามได้ · spread ≤5 = คม
//   เส้นไหน coverage <0.5 = ขอบถูกกลืน/ตกแต่งจนหาไม่เจอ → ทำตามไม่ได้จริง
// ref ผ่านทุกเส้น → เก็บ + ติด featherPx (ค่าเฉลี่ยเส้น feather, clamp 8-26) + _reproducible=true
// ref มีเส้นตามไม่ได้ → _reproducible=false (ตัดจากการ match — ยังอยู่ในคลังให้ผู้ใช้เคาะลบถาวร)
// ============================================================
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

const FILE = 'data/ref-cover-library.json';
const W = 540, H = 675;
const arr = JSON.parse(readFileSync(FILE, 'utf8'));

function gridLines(slots) {
  const rects = slots.filter((s) => s.shape !== 'circle' && (Number(s.zIndex) || 0) < 3);
  const xs = new Set(), ys = new Set();
  for (const s of rects) {
    for (const v of [s.xPct, s.xPct + s.wPct]) if (v > 5 && v < 95) xs.add(Math.round(v));
    for (const v of [s.yPct, s.yPct + s.hPct]) if (v > 5 && v < 95) ys.add(Math.round(v));
  }
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

async function audit(r) {
  const p = path.join(process.cwd(), 'public', r.imagePath.replace(/^\//, ''));
  let raw;
  try { raw = await sharp(p).greyscale().resize(W, H, { fit: 'fill' }).raw().toBuffer(); } catch { return null; }
  const px = (x, y) => raw[Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))];
  const out = [];
  for (const ln of gridLines(r.dna.template.slots)) {
    const spreads = [];
    let found = 0;
    for (const [gx, gy] of ln.pts) {
      const cx = Math.round((gx / 100) * W), cy = Math.round((gy / 100) * H);
      const prof = [];
      for (let o = -14; o <= 14; o++) {
        const a = ln.axis === 'v' ? px(cx + o, cy) : px(cx, cy + o);
        const b = ln.axis === 'v' ? px(cx + o + 1, cy) : px(cx, cy + o + 1);
        prof.push(Math.abs(b - a));
      }
      const peak = Math.max(...prof);
      if (peak < 14) continue;
      found++;
      const half = peak / 2;
      const lo = prof.findIndex((v) => v >= half);
      const hi = prof.length - 1 - [...prof].reverse().findIndex((v) => v >= half);
      spreads.push(Math.max(1, hi - lo + 1) * 2);
    }
    const coverage = found / ln.pts.length;
    const sp = spreads.sort((a, b) => a - b)[Math.floor(spreads.length / 2)] || 0;
    out.push({ tag: `${ln.axis}${ln.pos}`, ok: coverage >= 0.5 && sp <= 26, hard: sp <= 5, spread: sp, coverage: +coverage.toFixed(2) });
  }
  return out;
}

let keep = 0, drop = 0;
for (const r of arr) {
  if (!r.dna?.template?.slots || !r.imagePath) continue;
  const lines = await audit(r);
  if (!lines) { console.log('❓ โหลดภาพไม่ได้', r.id); continue; }
  const bad = lines.filter((l) => !l.ok);
  if (!lines.length || bad.length === 0) {
    const fl = lines.filter((l) => l.ok && !l.hard);
    const f = fl.length ? Math.max(8, Math.min(26, Math.round(fl.reduce((n, l) => n + l.spread, 0) / fl.length))) : 0;
    r.dna._reproducible = true;
    r.dna.template.featherPx = f;
    if (f) r.dna.template.seamStyle = 'feather';
    keep++;
    console.log(`✅ เก็บ ${r.id} feather=${f}px · ${lines.map((l) => `${l.tag}:${l.spread}px@${l.coverage}`).join(' ')}`);
  } else {
    r.dna._reproducible = false;
    drop++;
    console.log(`🚫 ปิดใช้ ${r.id} — ตะเข็บตามไม่ได้: ${bad.map((l) => `${l.tag}(cov${l.coverage},sp${l.spread})`).join(' ')}`);
  }
}
writeFileSync(FILE, JSON.stringify(arr, null, 2), 'utf8');
console.log(`\nสรุป: เก็บ ${keep} · ปิดใช้ ${drop} (บันทึกลง ${FILE} แล้ว)`);
