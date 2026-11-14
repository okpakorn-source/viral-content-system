// Focused tests — src/lib/cover-editor/imageAdjust.js (ท่อปรับแสง/ความคม/โทนภาพของ /cover-tester)
//   เป้า: พิสูจน์ว่า "คนไม่เพี้ยน" เป็นคุณสมบัติของสูตร ไม่ใช่ความรู้สึก
//   - ไม่ปรับ = ไบต์เท่าเดิม · เส้นโค้งแสง monotonic ทุกค่าสุดขอบ · เฉดสีผิวไม่เปลี่ยนเมื่อปรับแสง
//   - สีเทากลางไม่ติดสี · ความคมไม่แตะผิวเรียบ + overshoot มีเพดาน · ออโต้มีเพดาน · alpha/ขนาดไม่ถูกแตะ
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  ADJUST_DEFAULTS, ADJUST_PRESETS, ADJUST_SLIDERS,
  normalizeAdjust, isNeutralAdjust, adjustKey,
  computeLumaStats, autoLevelsFromStats, buildToneLut, applyAdjustments,
} = await import('../src/lib/cover-editor/imageAdjust.js');

function makeImage(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, a = 255] = fn(x, y);
    const p = (y * w + x) * 4;
    data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = a;
  }
  return { data, width: w, height: h };
}
const px = (img, x, y) => { const p = (y * img.width + x) * 4; return [img.data[p], img.data[p + 1], img.data[p + 2], img.data[p + 3]]; };
function hueDeg([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return 0;
  let hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hh *= 60; return hh < 0 ? hh + 360 : hh;
}
const hueDiff = (a, b) => { const d = Math.abs(hueDeg(a) - hueDeg(b)); return Math.min(d, 360 - d); };

// โทนผิวตัวแทน (อ่อน → เข้ม)
const SKIN = [[236, 200, 178], [224, 172, 140], [198, 134, 98], [141, 85, 54], [92, 58, 40]];

test('normalizeAdjust: ค่าขยะ/เกินช่วง ถูกบีบเข้าช่วง และครบทุกคีย์', () => {
  const a = normalizeAdjust({ brightness: 999, contrast: -999, sharpen: -50, vibrance: 'abc', warmth: 12.6, auto: 1 });
  assert.deepEqual(a, { auto: true, brightness: 100, contrast: -100, shadows: 0, highlights: 0, vibrance: 0, warmth: 13, sharpen: 0 });
  assert.deepEqual(normalizeAdjust(null), { ...ADJUST_DEFAULTS });
});

test('isNeutralAdjust / adjustKey: ไม่ปรับ = neutral และคีย์คงที่', () => {
  assert.equal(isNeutralAdjust(null), true);
  assert.equal(isNeutralAdjust({ ...ADJUST_DEFAULTS }), true);
  assert.equal(isNeutralAdjust({ sharpen: 1 }), false);
  assert.equal(isNeutralAdjust({ auto: true }), false);
  assert.equal(adjustKey(undefined), '0');
  assert.equal(adjustKey({ brightness: 10 }), adjustKey({ brightness: 10, contrast: 0 }));
  assert.notEqual(adjustKey({ brightness: 10 }), adjustKey({ brightness: 11 }));
});

test('ไม่ปรับอะไร = ไบต์เท่าเดิมทุกพิกเซล', () => {
  const img = makeImage(16, 16, (x, y) => [x * 16, y * 16, (x * y) % 256, 255]);
  const before = Uint8ClampedArray.from(img.data);
  applyAdjustments(img, { ...ADJUST_DEFAULTS });
  assert.deepEqual(img.data, before);
  applyAdjustments(img, { auto: true }, { autoLevels: null }); // ออโต้ไม่มีสถิติ = ไม่ทำอะไร
  assert.deepEqual(img.data, before);
});

test('เส้นโค้งแสง monotonic + อยู่ในช่วง 0..255 ทุกค่าสุดขอบ (ไม่มีโทนกลับหัว/ไม่ตัดทิ้ง)', () => {
  const ext = [-100, 0, 100];
  const auto = { black: 44, white: 208, gamma: 0.775 };
  for (const brightness of ext) for (const contrast of ext) for (const shadows of ext) for (const highlights of ext) for (const useAuto of [false, true]) {
    const lut = buildToneLut({ auto: useAuto, brightness, contrast, shadows, highlights }, auto);
    for (let i = 0; i < 256; i++) {
      assert.ok(lut[i] >= 0 && lut[i] <= 255, `range b${brightness} c${contrast} s${shadows} h${highlights} @${i}`);
      if (i > 0) assert.ok(lut[i] >= lut[i - 1] - 1e-3, `monotonic b${brightness} c${contrast} s${shadows} h${highlights} @${i}`);
    }
    if (!useAuto) { assert.ok(lut[0] < 1e-6, 'ดำสนิทยังดำ'); assert.ok(Math.abs(lut[255] - 255) < 1e-3, 'ขาวสุดยังขาว'); }
  }
});

test('ปรับแสง/คอนทราสต์/เงา/ไฮไลต์: เฉดสีผิวไม่เปลี่ยน (hue ต่าง < 3°)', () => {
  const cases = [
    { brightness: 40 }, { brightness: -40 }, { contrast: 45 }, { contrast: -45 },
    { shadows: 70 }, { shadows: -60 }, { highlights: -70 }, { highlights: 60 },
    { brightness: 25, contrast: 20, shadows: 40, highlights: -30 },
  ];
  for (const adj of cases) for (const skin of SKIN) {
    const img = makeImage(4, 4, () => skin);
    applyAdjustments(img, adj);
    const out = px(img, 1, 1).slice(0, 3);
    assert.ok(hueDiff(skin, out) < 3, `hue shift ${JSON.stringify(adj)} ${skin} → ${out}`);
    assert.ok(out[0] >= out[1] && out[1] >= out[2], `ลำดับ R≥G≥B ของสีผิวต้องคงเดิม ${JSON.stringify(adj)} ${skin} → ${out}`);
  }
});

test('ทุก preset: สีผิวยังเป็นสีผิว (hue ต่าง < 8°, ไม่ขาวโพลน/ไม่ดำจม)', () => {
  const autoLevels = { black: 12, white: 236, gamma: 0.93 };
  for (const pre of ADJUST_PRESETS) for (const skin of SKIN) {
    const img = makeImage(12, 12, () => skin);
    applyAdjustments(img, pre.adj, { autoLevels });
    const out = px(img, 6, 6).slice(0, 3);
    assert.ok(hueDiff(skin, out) < 8, `${pre.id}: hue ${skin} → ${out}`);
    // ไม่ไหม้ขาว = ยังเหลือเนื้อสี (แชนเนลต่ำสุดไม่พุ่งไปชนขาว และความต่างสียังอยู่เกินครึ่งของเดิม)
    const chroma = (c) => Math.max(...c) - Math.min(...c);
    assert.ok(Math.min(...out) < 236 && chroma(out) >= chroma(skin) * 0.5, `${pre.id}: ผิว ${skin} ไม่ควรไหม้ขาว → ${out}`);
    assert.ok(Math.max(...out) > 30, `${pre.id}: ผิว ${skin} ไม่ควรดำจม → ${out}`);
  }
});

test('สีเทากลางไม่ติดสีจากการปรับแสง/ความสด (ติดได้เฉพาะตอนสั่งโทนอุ่น/เย็น)', () => {
  const img = makeImage(8, 8, (x) => { const v = 20 + x * 30; return [v, v, v]; });
  applyAdjustments(img, { brightness: 30, contrast: 25, shadows: 40, highlights: -30, vibrance: 80 });
  for (let x = 0; x < 8; x++) { const [r, g, b] = px(img, x, 3); assert.ok(Math.abs(r - g) <= 1 && Math.abs(g - b) <= 1, `gray cast @${x}: ${r},${g},${b}`); }
  const warm = makeImage(4, 4, () => [128, 128, 128]);
  applyAdjustments(warm, { warmth: 100 });
  const [r, g, b] = px(warm, 1, 1);
  assert.ok(r > g && g > b, 'อุ่น = แดงนำ น้ำเงินตาม');
  assert.ok(r / 128 <= 1.15 && b / 128 >= 0.82, `โทนอุ่นสุดขอบยังจำกัด ~±14% หลังปรับความสว่างคืน (${r},${g},${b})`);
  const y0 = 128, y1 = r * 0.299 + g * 0.587 + b * 0.114;
  assert.ok(Math.abs(y1 - y0) < 2, 'โทนสีไม่เปลี่ยนความสว่างรวม');
});

test('ความสด: -100 = ขาวดำ · +100 ดันสีจืดมากกว่าสีที่สดอยู่แล้ว และดันโทนผิวน้อยกว่าสีอื่น', () => {
  const g0 = makeImage(4, 4, () => [200, 120, 60]);
  applyAdjustments(g0, { vibrance: -100 });
  const [r, g, b] = px(g0, 0, 0);
  assert.ok(Math.abs(r - g) <= 1 && Math.abs(g - b) <= 1);

  const chroma = (c) => Math.max(...c) - Math.min(...c);
  const boost = (c) => { const im = makeImage(4, 4, () => c); applyAdjustments(im, { vibrance: 100 }); return chroma(px(im, 0, 0).slice(0, 3)) / chroma(c); };
  assert.ok(boost([140, 130, 120]) > boost([230, 60, 30]), 'สีจืดถูกดันมากกว่าสีสด');
  // เทียบเฉดผิว (R>G>B) กับเฉดเขียว (G>R>B) ที่ความสดเท่ากัน
  assert.ok(boost([180, 150, 120]) < boost([150, 180, 120]), 'โทนผิวถูกดันน้อยกว่า');
});

test('ขาวดำ (gray): 1 = R=G=B ตามสูตร CSS grayscale · 0.5 = ครึ่งทาง', () => {
  const img = makeImage(2, 2, () => [200, 100, 50]);
  applyAdjustments(img, null, { gray: 1 });
  const yg = Math.round(200 * 0.2126 + 100 * 0.7152 + 50 * 0.0722);
  assert.deepEqual(px(img, 0, 0), [yg, yg, yg, 255]);
  const half = makeImage(2, 2, () => [200, 100, 50]);
  applyAdjustments(half, null, { gray: 0.5 });
  const [r, g, b] = px(half, 0, 0);
  assert.ok(Math.abs(r - (200 + yg) / 2) <= 1 && Math.abs(g - (100 + yg) / 2) <= 1 && Math.abs(b - (50 + yg) / 2) <= 1);
});

test('ความคม: ผิวเรียบไม่ถูกแตะ · ขอบชัดขึ้น · overshoot มีเพดาน · skipSharpen ข้ามได้', () => {
  // ผิวเรียบ + นอยส์จิ๋ว (±1) → ต้องไม่ถูกขยาย
  const flat = makeImage(32, 32, (x, y) => { const v = 150 + ((x + y) % 2); return [v + 40, v, v - 30]; });
  const flatBefore = Uint8ClampedArray.from(flat.data);
  applyAdjustments(flat, { sharpen: 100 });
  let maxDelta = 0;
  for (let i = 0; i < flat.data.length; i++) maxDelta = Math.max(maxDelta, Math.abs(flat.data[i] - flatBefore[i]));
  assert.ok(maxDelta <= 1, `ผิวเรียบถูกแตะ ${maxDelta}`);

  // ขอบแข็ง 90 | 170
  const edge = makeImage(32, 16, (x) => (x < 16 ? [90, 90, 90] : [170, 170, 170]));
  applyAdjustments(edge, { sharpen: 100 });
  const dark = px(edge, 15, 8)[0], bright = px(edge, 16, 8)[0];
  assert.ok(bright - dark > 80, 'คอนทราสต์ที่ขอบเพิ่ม');
  assert.ok(dark >= 90 - 48 && bright <= 170 + 48, `overshoot เกินเพดาน (${dark}, ${bright})`);
  assert.deepEqual(px(edge, 2, 8).slice(0, 3), [90, 90, 90], 'ไกลขอบไม่เปลี่ยน');

  const skip = makeImage(32, 16, (x) => (x < 16 ? [90, 90, 90] : [170, 170, 170]));
  const skipBefore = Uint8ClampedArray.from(skip.data);
  applyAdjustments(skip, { sharpen: 100 }, { skipSharpen: true });
  assert.deepEqual(skip.data, skipBefore);
});

test('ออโต้แสง: ภาพมัวถูกยืดช่วง แต่มีเพดาน · ภาพปกติแทบไม่ถูกแตะ · ข้อมูลน้อย = null', () => {
  // ภาพมัว: luma 90..160
  const hazy = makeImage(64, 64, (x) => { const v = 90 + Math.round((x / 63) * 70); return [v, v, v]; });
  const lv = autoLevelsFromStats(computeLumaStats(hazy.data, 64, 64));
  assert.equal(lv.black, 44); assert.equal(lv.white, 208); // ชนเพดาน ไม่ยืดสุดช่วง
  assert.ok(lv.gamma >= 0.775 && lv.gamma <= 1.165);
  applyAdjustments(hazy, { auto: true }, { autoLevels: lv });
  assert.ok(px(hazy, 63, 0)[0] - px(hazy, 0, 0)[0] > 70 * 1.3, 'คอนทราสต์เพิ่มจริง');

  // ภาพมัว "มีสี": ยืดช่วงแล้วสีต้องกลับมาสดขึ้น (ไม่ใช่คมขึ้นแต่จืดเท่าเดิม) และเฉดสีผิวไม่เปลี่ยน
  const lv2 = { black: 40, white: 210, gamma: 1 };
  for (const skin of SKIN) {
    const hz = skin.map((c) => Math.round(c * 0.5 + 75)); // ผสมเทา 50% = จำลองภาพมัว
    const im = makeImage(4, 4, () => hz);
    applyAdjustments(im, { auto: true }, { autoLevels: lv2 });
    const o = px(im, 1, 1).slice(0, 3);
    const chroma = (c) => Math.max(...c) - Math.min(...c);
    assert.ok(chroma(o) > chroma(hz) * 1.3, `สีควรกลับมา ${hz} → ${o}`);
    assert.ok(hueDiff(hz, o) < 3, `hue ${hz} → ${o}`);
  }

  // ภาพเต็มช่วงอยู่แล้ว กลางภาพพอดี → black≈0 white≈255 gamma=1
  const full = makeImage(64, 64, (x) => { const v = Math.round(Math.pow(x / 63, 1.15) * 255); return [v, v, v]; });
  const lf = autoLevelsFromStats(computeLumaStats(full.data, 64, 64));
  assert.ok(lf.black <= 2 && lf.white >= 253);
  assert.equal(lf.gamma, 1);

  assert.equal(autoLevelsFromStats({ hist: new Uint32Array(256), total: 3 }), null);
  assert.equal(autoLevelsFromStats(null), null);
});

test('alpha และขนาดไม่ถูกแตะ · พิกเซลโปร่งใสถูกข้าม · ไม่มี NaN', () => {
  const img = makeImage(12, 12, (x, y) => [x * 20, y * 20, 128, (x + y) % 3 === 0 ? 0 : 200]);
  const before = Uint8ClampedArray.from(img.data);
  applyAdjustments(img, { auto: true, brightness: 50, contrast: 50, shadows: 50, highlights: -50, vibrance: 50, warmth: 50, sharpen: 100 }, { autoLevels: { black: 10, white: 240, gamma: 0.9 }, gray: 0.3 });
  assert.equal(img.data.length, before.length);
  for (let p = 0; p < img.data.length; p += 4) {
    assert.equal(img.data[p + 3], before[p + 3], 'alpha');
    if (before[p + 3] === 0) assert.deepEqual([img.data[p], img.data[p + 1], img.data[p + 2]], [before[p], before[p + 1], before[p + 2]]);
  }
});

test('ตาราง UI: สไลเดอร์/พรีเซ็ตใช้คีย์ที่มีจริง และค่าอยู่ในช่วง', () => {
  const keys = new Set(Object.keys(ADJUST_DEFAULTS));
  for (const sl of ADJUST_SLIDERS) { assert.ok(keys.has(sl.key)); assert.ok(sl.min < sl.max); }
  for (const pre of ADJUST_PRESETS) {
    for (const k of Object.keys(pre.adj)) assert.ok(keys.has(k), `${pre.id}.${k}`);
    assert.deepEqual(normalizeAdjust(pre.adj), { ...ADJUST_DEFAULTS, ...pre.adj });
    assert.equal(isNeutralAdjust(pre.adj), false);
  }
});
