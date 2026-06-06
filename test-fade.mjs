import sharp from 'sharp';
import fs from 'fs';

const w = 400, h = 300, fadeRight = 100;

// สร้างภาพสีแดง
const testImg = await sharp({
  create: { width: w, height: h, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 255 } }
}).png().toBuffer();

// สร้าง raw RGBA data จากภาพ
const { data: rgbaData, info } = await sharp(testImg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
console.log(`Image: ${info.width}x${info.height}, channels=${info.channels}`);

// Apply fade โดยตรงบน RGBA buffer — ไม่ต้องสร้าง mask แยก!
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const idx = (y * w + x) * 4;
    let alphaMultiplier = 1.0;

    if (fadeRight > 0 && x > w - fadeRight) {
      const t = (x - (w - fadeRight)) / fadeRight;
      alphaMultiplier = Math.min(alphaMultiplier, 1 - t);
    }

    rgbaData[idx + 3] = Math.round(rgbaData[idx + 3] * alphaMultiplier);
  }
}

// สร้างภาพใหม่
const faded = await sharp(Buffer.from(rgbaData), { raw: { width: w, height: h, channels: 4 } })
  .png()
  .toBuffer();

// ตรวจสอบ
const { data: check } = await sharp(faded).raw().toBuffer({ resolveWithObject: true });
const midIdx = (150 * w + 200) * 4;
const edgeIdx = (150 * w + 395) * 4;

console.log(`Center: R=${check[midIdx]} G=${check[midIdx+1]} B=${check[midIdx+2]} A=${check[midIdx+3]}`);
console.log(`Edge:   R=${check[edgeIdx]} G=${check[edgeIdx+1]} B=${check[edgeIdx+2]} A=${check[edgeIdx+3]}`);
console.log(`Fade ${check[edgeIdx+3] < check[midIdx+3] ? '✅ WORKING' : '❌ NOT WORKING'}!`);

fs.writeFileSync('test-fade-result.png', faded);
console.log('Saved test-fade-result.png');
