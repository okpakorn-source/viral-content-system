// ============================================================
// 🧪 hero_face_hidden qcFlag wiring (เคสไรเดอร์ 28 ก.ค. 69) — จบสาย: megaAdapters.js (_runSecondEye แนบ
// slots.hero._secondEyeHeroFaceHidden เมื่อนโยบาย hero แข็งข้อ 2 หาแทนที่ไม่เจอ) → s7_cover/compose-test
// (ต่อสายเข้า slotPlan row) → megaComposerService.js composeCore (loaded[i] สืบทอด field ผ่าน {...p,...}
// spread → ยกเป็น qcFlag 'hero_face_hidden' แพทเทิร์นเดียวกับ spec._featherCapped → 'feather_capped')
//
// เทสนี้เรียก composeAndVerify (real, unstubbed) ตรงๆ ด้วย slotPlan ที่พก field นี้บน row ที่ isHero:true —
// พิสูจน์ปลายสายจริงว่า field มาถึง qcFlags จริง ไม่ใช่แค่ field ลอยอยู่บน slots เฉยๆ ไม่มีผลอะไรต่อ
// เทคนิค: เหมือน tests/mega-composer-circle-label.test.mjs เป๊ะ — stub faceDetector ให้ไม่เจอหน้าเลย (Map ว่าง)
// → hero ตัดสินด้วย isHero flag ล้วน (deterministic) · ภาพ noise จริงผ่าน sharp (data: URI ไม่ต้อง mock network)
// ============================================================
import assert from 'node:assert/strict';
import { register } from 'node:module';
import sharp from 'sharp';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);
const FACE_DETECTOR_STUB = _mod('export async function batchDetectFaces(){ return new Map(); }');
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/services/faceDetector') return { url: ${JSON.stringify(FACE_DETECTOR_STUB)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

// เลนอื่นปิดกันปนผล (แพทเทิร์นเดียวกับ mega-composer-circle-label.test.mjs)
delete process.env.MEGA_STRICT_RENDER;
delete process.env.MEGA_COVER_TESTER;
process.env.MEGA_SCENE_DEDUP = '0';

const { composeAndVerify } = await import('../src/lib/services/megaComposerService.js');

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 6).join('\n  ')}`); } };

async function makeDataUri(seed) {
  const buf = await sharp({
    create: { width: 800, height: 1000, channels: 3, noise: { type: 'gaussian', mean: 128 + seed, sigma: 40 } },
  }).jpeg({ quality: 90 }).toBuffer();
  assert.ok(buf.length > 5000, `fixture ต้อง >5000 bytes (ได้ ${buf.length})`);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

// isHero:true ที่ index 0 เสมอ (ไม่มีตาหาหน้า → deterministic ด้วย isHero ล้วน เหมือน mega-composer-circle-label)
async function buildSlotPlan(heroMarker) {
  const urls = await Promise.all([0, 1, 2, 3].map((i) => makeDataUri(i * 10)));
  return urls.map((url, i) => ({
    url, thumbnailUrl: '', isHero: i === 0, person: null,
    clean: true, newsScene: true, faces: 0, slot: null,
    ...(i === 0 && heroMarker ? { _secondEyeHeroFaceHidden: heroMarker } : {}),
  }));
}

await test('เคสไรเดอร์: slotPlan row ของ hero พก _secondEyeHeroFaceHidden → composeAndVerify ยก qcFlag "hero_face_hidden" จริง', async () => {
  const slotPlan = await buildSlotPlan({ faceVisible: 1, textOverlay: 0, reason: 'no_qualifying_replacement_found_in_checked_pool' });
  const out = await composeAndVerify({ newsTitle: 'ข่าวทดสอบไรเดอร์', slotPlan, refDNA: null, refImagePath: null, stableOrder: true });
  assert.ok(out.success, 'compose ต้องสำเร็จ');
  assert.ok(Array.isArray(out.qcFlags) && out.qcFlags.includes('hero_face_hidden'), `qcFlags ต้องมี 'hero_face_hidden' (ได้ ${JSON.stringify(out.qcFlags)})`);
});

await test('control: slotPlan ปกติไม่มี _secondEyeHeroFaceHidden เลย → ไม่มี qcFlag "hero_face_hidden" (ไม่ใช่ default เปิดเอง)', async () => {
  const slotPlan = await buildSlotPlan(null);
  const out = await composeAndVerify({ newsTitle: 'x', slotPlan, refDNA: null, refImagePath: null, stableOrder: true });
  assert.ok(out.success, 'compose ต้องสำเร็จ');
  assert.ok(!out.qcFlags.includes('hero_face_hidden'), `ไม่มี marker แนบมา ต้องไม่มี qcFlag นี้เลย (ได้ ${JSON.stringify(out.qcFlags)})`);
});

console.log(`\n# hero-face-hidden-qcflag: ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
