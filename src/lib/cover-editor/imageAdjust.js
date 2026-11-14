// 🎛️ ปรับแสง / ความคม / โทนภาพ สำหรับหน้า /cover-tester (14 พ.ย. 69)
// ─────────────────────────────────────────────────────────────────────────────
// หลักการ: "คำนวณพิกเซลตรงๆ" เท่านั้น — ไม่มี AI/โมเดลเจนภาพ ไม่มี upscale แบบ GAN ไม่มี face-restore
//   (ตามกฎ AGENTS.md ข้อ 6: ภาพบนปกต้องเป็นต้นฉบับ · บทเรียน 10 ก.ค. 69 Real-ESRGAN ทำหน้าคนเหมือนภาพเจน)
//   ทุกขั้นเป็นสูตรตายตัว (deterministic) ทำงานในเบราว์เซอร์ ไม่ส่งภาพออกนอกเครื่อง ไม่มีค่า API
//
// สิ่งที่กัน "คนเพี้ยน":
//   1) ไม่ย้าย/ไม่วาดพิกเซลใหม่ — รูปทรงหน้า ตา ปาก เหมือนต้นฉบับ 100% เปลี่ยนแค่ค่าสี/ความสว่างของพิกเซลเดิม
//   2) ปรับแสงผ่าน "ความสว่าง (luma)" แล้วคูณ RGB ด้วยอัตราส่วนเดียวกัน → สีผิวไม่เปลี่ยนเฉด (hue คงเดิม)
//   3) เส้นโค้งแสงทุกตัวเป็น monotonic ไม่ตัดขาว/ดำทิ้ง (ไม่มีหน้าขาวโพลน/เงาดำจม)
//   4) ความสด = vibrance: ดันเฉพาะสีที่ยังจืด สีที่สดอยู่แล้ว + โทนผิว (ส้ม-แดง) ถูกดันน้อยกว่า
//   5) ความคม = unsharp mask บน luma อย่างเดียว มี threshold (ไม่ขุดรูขุมขน/นอยส์) + จำกัด overshoot (ไม่มีขอบขาวเรืองแสง)
//   6) โทนอุ่น/เย็น จำกัด ±14% ต่อแชนเนล และรักษาความสว่างรวมเดิม
//
// ไฟล์นี้ไม่พึ่ง DOM ในส่วนคำนวณ (เทสด้วย node:test ได้) — ตัวช่วยที่แตะ canvas อยู่ท้ายไฟล์

export const ADJUST_DEFAULTS = Object.freeze({
  auto: false,     // ออโต้แสง (levels + แก้กลางภาพมืด/สว่างเกิน) คำนวณจากสถิติของภาพนั้นเอง
  brightness: 0,   // -100..100
  contrast: 0,     // -100..100
  shadows: 0,      // -100..100 (+ = เปิดเงา)
  highlights: 0,   // -100..100 (- = กู้ส่วนสว่างจ้า)
  vibrance: 0,     // -100..100 (-100 = ขาวดำ)
  warmth: 0,       // -100..100 (+ = อุ่น/เหลืองส้ม, - = เย็น/ฟ้า)
  sharpen: 0,      // 0..100
});

const NUM_KEYS = ['brightness', 'contrast', 'shadows', 'highlights', 'vibrance', 'warmth', 'sharpen'];

// ป้ายกำกับ + ช่วงของสไลเดอร์ (ใช้สร้าง UI — เรียงตามลำดับที่คนแต่งรูปใช้จริง)
export const ADJUST_SLIDERS = Object.freeze([
  { key: 'brightness', label: 'แสง', icon: '☀️', min: -100, max: 100, lo: 'มืด', hi: 'สว่าง' },
  { key: 'contrast', label: 'คอนทราสต์', icon: '◐', min: -100, max: 100, lo: 'นุ่ม', hi: 'จัด' },
  { key: 'shadows', label: 'เงา', icon: '🌑', min: -100, max: 100, lo: 'เข้ม', hi: 'เปิดเงา' },
  { key: 'highlights', label: 'ไฮไลต์', icon: '💡', min: -100, max: 100, lo: 'กู้แสงจ้า', hi: 'ใส' },
  { key: 'vibrance', label: 'ความสดของสี', icon: '🎨', min: -100, max: 100, lo: 'ซีด', hi: 'สด' },
  { key: 'warmth', label: 'โทนสี', icon: '🌡️', min: -100, max: 100, lo: 'เย็น', hi: 'อุ่น' },
  { key: 'sharpen', label: 'ความคม', icon: '🔎', min: 0, max: 100, lo: 'เดิม', hi: 'คม' },
]);

// ชุดสำเร็จ กดครั้งเดียวจบ — ค่าอยู่ในช่วงปลอดภัยกับสีผิวทั้งหมด
export const ADJUST_PRESETS = Object.freeze([
  { id: 'auto', label: '✨ ออโต้', hint: 'ปรับแสงให้พอดีอัตโนมัติ + คมขึ้นเล็กน้อย (เริ่มจากปุ่มนี้)', adj: { auto: true, vibrance: 8, sharpen: 30 } },
  { id: 'clear', label: '🔎 คมชัด', hint: 'ภาพแคปจากคลิป/ภาพมัว — เพิ่มความคมและคอนทราสต์', adj: { auto: true, contrast: 12, sharpen: 60 } },
  { id: 'bright', label: '☀️ สว่างสดใส', hint: 'ภาพมืด/อึมครึม — เปิดเงา สีสดขึ้น', adj: { auto: true, brightness: 16, shadows: 28, vibrance: 16, sharpen: 25 } },
  { id: 'backlight', label: '🌤️ แก้ย้อนแสง', hint: 'หน้ามืดเพราะหลังสว่าง — เปิดเงา กู้แสงจ้า', adj: { auto: true, shadows: 60, highlights: -40, sharpen: 20 } },
  { id: 'warm', label: '🌅 อบอุ่น', hint: 'โทนอุ่น ซึ้ง/ครอบครัว/บุญ', adj: { auto: true, warmth: 32, vibrance: 10, sharpen: 25 } },
  { id: 'cool', label: '❄️ เย็นขรึม', hint: 'โทนเย็น จริงจัง/สืบสวน', adj: { auto: true, warmth: -30, contrast: 10, sharpen: 25 } },
  { id: 'drama', label: '🎭 ดราม่าเข้ม', hint: 'คอนทราสต์จัด เงาลึก สีหม่นลง', adj: { auto: true, contrast: 30, shadows: -22, highlights: -15, vibrance: -12, sharpen: 45 } },
]);

const clampNum = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** คืน object ครบทุกคีย์ ค่าอยู่ในช่วง (รับ null/undefined/ค่าขยะได้) */
export function normalizeAdjust(adj) {
  const out = { ...ADJUST_DEFAULTS };
  if (!adj || typeof adj !== 'object') return out;
  out.auto = !!adj.auto;
  for (const k of NUM_KEYS) {
    const n = Number(adj[k]);
    if (!Number.isFinite(n)) continue;
    out[k] = Math.round(clampNum(n, k === 'sharpen' ? 0 : -100, 100));
  }
  return out;
}

/** ไม่มีการปรับใดๆ = ข้ามท่อพิกเซลทั้งก้อน (ภาพออกเหมือนเดิมทุกไบต์) */
export function isNeutralAdjust(adj) {
  if (!adj) return true;
  if (adj.auto) return false;
  for (const k of NUM_KEYS) if (Number(adj[k]) || 0) return false;
  return true;
}

/** คีย์สั้นๆ ไว้ทำแคช */
export function adjustKey(adj) {
  if (isNeutralAdjust(adj)) return '0';
  const a = normalizeAdjust(adj);
  return `${a.auto ? 1 : 0},${a.brightness},${a.contrast},${a.shadows},${a.highlights},${a.vibrance},${a.warmth},${a.sharpen}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// สถิติภาพ → ออโต้แสง
// ─────────────────────────────────────────────────────────────────────────────

/** ฮิสโตแกรมความสว่าง (ข้ามพิกเซลโปร่งใส) */
export function computeLumaStats(data, width, height) {
  const hist = new Uint32Array(256);
  const n = Math.min(data.length >> 2, (width | 0) * (height | 0) || (data.length >> 2));
  let total = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (data[p + 3] < 8) continue;
    const y = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
    hist[y]++; total++;
  }
  return { hist, total };
}

function percentile(hist, total, frac) {
  const target = total * frac;
  let acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= target) return i; }
  return 255;
}

// เพดานออโต้ — กันดึงแรงเกินจนภาพผิดธรรมชาติ (ภาพกลางคืนต้องยังดูเป็นกลางคืน)
const AUTO_MAX_BLACK = 44;   // จุดดำถูกยกได้ไม่เกินนี้
const AUTO_MIN_WHITE = 208;  // จุดขาวถูกดึงลงได้ไม่ต่ำกว่านี้
const AUTO_TARGET_MID = 0.45;

/** สถิติ → ค่า levels ของออโต้ ({black, white, gamma}) · ข้อมูลไม่พอ = null (ออโต้ไม่ทำอะไร) */
export function autoLevelsFromStats(stats) {
  if (!stats || !stats.hist || stats.total < 16) return null;
  const { hist, total } = stats;
  const black = Math.min(percentile(hist, total, 0.005), AUTO_MAX_BLACK);
  const white = Math.max(percentile(hist, total, 0.995), AUTO_MIN_WHITE);
  const span = white - black;
  const med = percentile(hist, total, 0.5);
  const m = clampNum((med - black) / span, 0.02, 0.98);
  let gamma = 1;
  if (Math.abs(m - AUTO_TARGET_MID) > 0.06) {
    gamma = clampNum(Math.log(AUTO_TARGET_MID) / Math.log(m), 0.7, 1.22);
    gamma = 1 + (gamma - 1) * 0.75; // แก้แค่ 75% — เหลือบรรยากาศเดิมของภาพไว้
  }
  return { black, white, gamma: +gamma.toFixed(3) };
}

// ─────────────────────────────────────────────────────────────────────────────
// เส้นโค้งแสง (LUT ของ luma 0..255 → 0..255)
// ─────────────────────────────────────────────────────────────────────────────
const PEAK_NORM = 256 / 27; // ทำให้ x(1-x)^3 มียอด = 1 (ยอดอยู่ที่ x = 0.25)

// skipLevels=true: ไม่รวมขั้นยืดช่วงดำ-ขาวของออโต้ (ท่อหลักทำขั้นนั้นแยกแบบ affine ต่อแชนเนล — ดู applyAdjustments)
export function buildToneLut(adj, autoLevels, skipLevels = false) {
  const a = normalizeAdjust(adj);
  const lut = new Float32Array(256);
  const useAuto = a.auto && autoLevels && autoLevels.white > autoLevels.black;
  const bExp = a.brightness ? Math.pow(2, (-a.brightness / 100) * 0.85) : 1;
  const cPow = a.contrast > 0 ? 1 + (a.contrast / 100) * 0.9 : a.contrast < 0 ? 1 / (1 + (-a.contrast / 100) * 0.9) : 1;
  const sAmt = (a.shadows / 100) * (a.shadows > 0 ? 0.30 : 0.09) * PEAK_NORM;
  const hAmt = (a.highlights / 100) * (a.highlights < 0 ? 0.30 : 0.09) * PEAK_NORM;
  for (let i = 0; i < 256; i++) {
    let x = i / 255;
    if (useAuto) {
      if (!skipLevels) x = clampNum((i - autoLevels.black) / (autoLevels.white - autoLevels.black), 0, 1);
      if (autoLevels.gamma && autoLevels.gamma !== 1) x = Math.pow(x, autoLevels.gamma);
    }
    if (bExp !== 1) x = Math.pow(x, bExp);
    if (cPow !== 1) x = x < 0.5 ? 0.5 * Math.pow(2 * x, cPow) : 1 - 0.5 * Math.pow(2 * (1 - x), cPow);
    if (sAmt) { const k = 1 - x; x += sAmt * x * k * k * k; }
    if (hAmt) { x += hAmt * (1 - x) * x * x * x; }
    lut[i] = clampNum(x, 0, 1) * 255;
  }
  return lut;
}

// ─────────────────────────────────────────────────────────────────────────────
// ความคม: unsharp mask บน luma (box blur 2 รอบ ≈ gaussian)
// ─────────────────────────────────────────────────────────────────────────────
function boxH(src, dst, w, h, r) {
  const div = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = src[row] * (r + 1);
    for (let i = 1; i <= r; i++) acc += src[row + (i < w ? i : w - 1)];
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc * div;
      const add = x + r + 1; const sub = x - r;
      acc += src[row + (add < w ? add : w - 1)] - src[row + (sub > 0 ? sub : 0)];
    }
  }
}
// แนวตั้ง: เดินทีละแถว (สะสมผลรวมต่อคอลัมน์ใน acc) — เร็วกว่าเดินทีละคอลัมน์หลายเท่าเพราะอ่านหน่วยความจำเรียงกัน
function boxV(src, dst, w, h, r, acc) {
  const div = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) acc[x] = src[x] * (r + 1);
  for (let i = 1; i <= r; i++) {
    const row = (i < h ? i : h - 1) * w;
    for (let x = 0; x < w; x++) acc[x] += src[row + x];
  }
  for (let y = 0; y < h; y++) {
    const out = y * w;
    for (let x = 0; x < w; x++) dst[out + x] = acc[x] * div;
    const add = y + r + 1, sub = y - r;
    const addRow = (add < h ? add : h - 1) * w, subRow = (sub > 0 ? sub : 0) * w;
    for (let x = 0; x < w; x++) acc[x] += src[addRow + x] - src[subRow + x];
  }
}

// บัฟเฟอร์ใช้ซ้ำ (กัน GC กระตุกตอนเลื่อนสไลเดอร์ — แต่ละรอบต้องใช้ 4 แผ่นขนาดเท่าภาพ)
let _buf = null;
function scratch(n, w) {
  if (!_buf || _buf.n < n || _buf.w < w) {
    _buf = { n, w, L: new Float32Array(n), tmp: new Float32Array(n), fine: new Float32Array(n), mid: new Float32Array(n), acc: new Float32Array(w) };
  }
  return _buf;
}

function sharpenLuma(data, w, h, amount) {
  if (w < 8 || h < 8 || amount <= 0) return;
  const n = w * h;
  const { L, tmp, fine, mid, acc } = scratch(n, w);
  for (let i = 0, p = 0; i < n; i++, p += 4) L[i] = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
  // fine = เบลอรัศมีเล็ก 2 รอบ (≈ gaussian σ≈1.2) → รายละเอียดเล็ก (ขนตา เส้นผม ตัวหนังสือ)
  boxH(L, tmp, w, h, 1); boxV(tmp, fine, w, h, 1, acc);
  boxH(fine, tmp, w, h, 1); boxV(tmp, fine, w, h, 1, acc);
  // mid = เบลอต่อจาก fine อีกชั้น (σ รวม ≈ 2.3) → ความชัดรวม (local contrast อ่อนๆ)
  boxH(fine, tmp, w, h, 3); boxV(tmp, mid, w, h, 3, acc);
  const s = amount / 100;
  const amtFine = 1.5 * s, amtMid = 0.45 * s;
  const THR = 2;                 // ต่างกันน้อยกว่านี้ = ผิวเรียบ/นอยส์ → ไม่แตะ
  const lim = 14 + 34 * s;       // เพดาน overshoot ต่อพิกเซล (กันขอบขาว/ดำเรืองแสง)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (data[p + 3] === 0) continue;
    const l = L[i];
    let d1 = l - fine[i];
    const ad = d1 < 0 ? -d1 : d1;
    d1 = ad <= THR ? 0 : (d1 > 0 ? ad - THR : THR - ad);
    let d = amtFine * d1 + amtMid * (l - mid[i]);
    if (l < 32) d *= l / 32;     // เงามืดจัด = นอยส์เยอะ → ลดแรง
    if (d > lim) d = lim; else if (d < -lim) d = -lim;
    if (d === 0) continue;
    data[p] += d; data[p + 1] += d; data[p + 2] += d; // Uint8ClampedArray ปัด+clamp ให้เอง
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ท่อหลัก — แก้ image.data ในที่เดิม
//   image: { data: Uint8ClampedArray(RGBA), width, height }
//   opts:  { autoLevels?: {black,white,gamma}|null, gray?: 0..1, skipSharpen?: boolean }
// ─────────────────────────────────────────────────────────────────────────────
const MAX_RATIO = 2;       // เพดานตัวคูณสี (กันขยายนอยส์สีในเงามืด) ส่วนเกินใช้บวกความสว่างแทน
const WARM_GAIN = 0.14;
const VIB_GAIN = 0.7;

export function applyAdjustments(image, adj, opts = {}) {
  if (!image || !image.data) return image;
  const a = normalizeAdjust(adj);
  const gray = clampNum(Number(opts.gray) || 0, 0, 1);
  const data = image.data;
  const w = image.width | 0, h = image.height | 0;
  const n = Math.min(data.length >> 2, w * h);

  const al = a.auto ? (opts.autoLevels || null) : null;
  const autoLevels = al && al.white > al.black ? al : null;
  // ออโต้ขั้นยืดช่วง: (c - black) * scale ด้วยค่าเดียวกันทั้ง R,G,B → เฉดสี (hue) คงเดิมเป๊ะ และสีที่ซีดเพราะภาพมัว
  //   ถูกคืนมาพร้อมคอนทราสต์ (ถ้ายืดเฉพาะ luma ภาพจะคมขึ้นแต่สีจืดเหมือนเดิม — เจอตอนเทสกับภาพมัว)
  const hasLevels = !!autoLevels && (autoLevels.black > 0 || autoLevels.white < 255);
  const lvB = hasLevels ? autoLevels.black : 0;
  const lvS = hasLevels ? 255 / (autoLevels.white - autoLevels.black) : 1;
  const hasTone = !!((autoLevels && autoLevels.gamma && autoLevels.gamma !== 1) || a.brightness || a.contrast || a.shadows || a.highlights);
  const hasWarm = a.warmth !== 0;
  const hasVib = a.vibrance !== 0;
  const hasColor = hasLevels || hasTone || hasWarm || hasVib || gray > 0;

  if (hasColor) {
    // โทนแสง: r' = r*k + add (k = อัตราส่วน luma ใหม่/เดิม จำกัดเพดาน, add = ส่วนที่เหลือ)
    let mulK = null, addK = null;
    if (hasTone) {
      const lut = buildToneLut(a, autoLevels, true);
      mulK = new Float32Array(256); addK = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const k = i > 0 ? Math.min(lut[i] / i, MAX_RATIO) : 1;
        mulK[i] = k; addK[i] = lut[i] - i * k;
      }
    }
    // โทนอุ่น/เย็น: ดัน R สวน B แล้วปรับให้ความสว่างรวมเท่าเดิม
    let gR = 1, gG = 1, gB = 1;
    if (hasWarm) {
      const t = a.warmth / 100;
      const wr = 1 + WARM_GAIN * t, wb = 1 - WARM_GAIN * t;
      const norm = 1 / (0.299 * wr + 0.587 + 0.114 * wb);
      gR = wr * norm; gG = norm; gB = wb * norm;
    }
    const vib = a.vibrance / 100;
    const keep = 1 - gray;

    for (let i = 0, p = 0; i < n; i++, p += 4) {
      if (data[p + 3] === 0) continue;
      let r = data[p], g = data[p + 1], b = data[p + 2];
      if (hasLevels) { r = (r - lvB) * lvS; g = (g - lvB) * lvS; b = (b - lvB) * lvS; }
      if (hasWarm) { r *= gR; g *= gG; b *= gB; }
      let y = r * 0.299 + g * 0.587 + b * 0.114;
      if (y > 255) y = 255; else if (y < 0) y = 0;
      if (hasTone) {
        const yi = y < 0 ? 0 : y > 255 ? 255 : (y + 0.5) | 0;
        const k = mulK[yi], ad = addK[yi];
        r = r * k + ad; g = g * k + ad; b = b * k + ad;
        y = y * k + ad;
        if (y > 255) y = 255; else if (y < 0) y = 0;
      }
      if (hasVib) {
        const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
        const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
        let f;
        if (vib > 0) {
          const sat = mx > 0 ? (mx - mn) / mx : 0;
          f = vib * VIB_GAIN * (1 - (sat > 1 ? 1 : sat));
          if (r > g && g > b) f *= 0.65; // เฉดส้ม-แดง (โทนผิว) ดันน้อยลง
          f += 1;
        } else {
          f = 1 + vib; // -100 = ขาวดำ
        }
        r = y + (r - y) * f; g = y + (g - y) * f; b = y + (b - y) * f;
      }
      // บีบเข้าช่วงสีโดยลดความสดเข้าหา luma (ไม่ตัดแชนเนลเดี่ยว = เฉดสีไม่เพี้ยนตอนสว่างจัด)
      if (hasLevels || hasTone || hasWarm || hasVib) {
        const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
        const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
        let t = 1;
        if (mx > 255 && mx > y) t = (255 - y) / (mx - y);
        if (mn < 0 && mn < y) { const t2 = y / (y - mn); if (t2 < t) t = t2; }
        if (t < 1) { r = y + (r - y) * t; g = y + (g - y) * t; b = y + (b - y) * t; }
      }
      if (gray > 0) {
        // สูตรเดียวกับ CSS filter grayscale() — หน้าตาเท่ากันทุกเบราว์เซอร์ (รวม Safari ที่ไม่มี ctx.filter)
        const yg = r * 0.2126 + g * 0.7152 + b * 0.0722;
        r = yg + (r - yg) * keep; g = yg + (g - yg) * keep; b = yg + (b - yg) * keep;
      }
      data[p] = r; data[p + 1] = g; data[p + 2] = b;
    }
  }

  if (a.sharpen > 0 && !opts.skipSharpen) sharpenLuma(data, w, h, a.sharpen);
  return image;
}

// ─────────────────────────────────────────────────────────────────────────────
// ตัวช่วยฝั่งเบราว์เซอร์ (แตะ canvas) — ล้มเหลว = คืน null/false ให้ผู้เรียกวาดภาพเดิมต่อ (ไม่ crash)
// ─────────────────────────────────────────────────────────────────────────────
const _autoCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

/** ค่าออโต้ของภาพ (คิดจากทั้งภาพย่อ ~160px ครั้งเดียวต่อภาพ — เลื่อน/ซูมในช่องแล้วแสงไม่กระพริบ) */
export function getAutoLevelsForImage(img) {
  if (!img || typeof document === 'undefined') return null;
  if (_autoCache && _autoCache.has(img)) return _autoCache.get(img);
  let levels = null;
  try {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (iw > 0 && ih > 0) {
      const k = Math.min(1, 160 / Math.max(iw, ih));
      const cw = Math.max(1, Math.round(iw * k)), ch = Math.max(1, Math.round(ih * k));
      const c = document.createElement('canvas'); c.width = cw; c.height = ch;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0, cw, ch);
      const id = cx.getImageData(0, 0, cw, ch);
      levels = autoLevelsFromStats(computeLumaStats(id.data, cw, ch));
    }
  } catch { levels = null; } // canvas taint ฯลฯ → ออโต้ไม่ทำงาน สไลเดอร์อื่นยังใช้ได้
  if (_autoCache) _autoCache.set(img, levels);
  return levels;
}

/** ปรับทั้ง canvas ในที่เดิม · คืน true = สำเร็จ */
export function adjustCanvas(canvas, adj, opts) {
  try {
    const cx = canvas.getContext('2d', { willReadFrequently: true });
    const id = cx.getImageData(0, 0, canvas.width, canvas.height);
    applyAdjustments(id, adj, opts);
    cx.putImageData(id, 0, 0);
    return true;
  } catch { return false; }
}
