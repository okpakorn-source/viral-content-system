// ============================================================
// 🩹 B1 fix (29 ก.ค. 69, เฟส B-1 — AUDIT-SELECTION-COMPOSE.md): สลับภาพชั้นตาสองแล้ว metadata ค้าง
// ------------------------------------------------------------
// บั๊ก: _runSecondEye (megaAdapters.js) ทุกจุดสลับภาพ (pass1 textOverlay / นโยบาย hero แข็ง 2 ทาง / PASS2
//   _swapRoleImageMechanic) เดิมเขียนกลับแค่ id/imageUrl/person/category/emotion — ทิ้ง _heroFaceCrop/clean/
//   newsScene/faces/dirtyFallback/storyFit ของภาพเดิมค้างไว้ทาบภาพใหม่ ร้ายแรงสุดคือ _heroFaceCrop ที่
//   coverExecutorService.js เชื่อ 100% ไม่ตรวจซ้ำ → ครอปหน้าของภาพเก่าไปทาบภาพใหม่ (หน้าแหว่ง)
// แก้: _syncSlotMetaAfterSwap(slots, role, rec, ctx) เรียกเพิ่มหลังทุกจุดสลับ/revert (ไม่แตะโค้ดเดิม แค่เพิ่ม
//   1 บรรทัดต่อจุด) — kill-switch MEGA_CROP_CHAIN_FIX==='0' → no-op สนิท (พฤติกรรมเดิมทุก byte)
// พิสูจน์: (ก) สลับแล้วกล่อง/meta ต้องย้ายตามภาพใหม่ (ไม่มี = ลบทิ้ง) (ข) kill-switch=0 → stale ค้างเหมือนเดิม
// ============================================================
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { _runSecondEye } = await import('../src/lib/megaAdapters.js');

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 8).join('\n  ')}`); } };

const mkFetch = () => async () => ({ data: 'ZmFrZQ==', mimeType: 'image/jpeg' });
const mkById = (records) => new Map(records.map((r) => [String(r.id), r]));
const mkSlots = (picks) => Object.fromEntries(Object.entries(picks).map(([role, p]) => [role, { ...p }]));
const setEnv = (k, v) => { if (v === null || v === undefined) delete process.env[k]; else process.env[k] = v; };

const LONG_TEXT = 'BREAKING NEWS HEADLINE BAR TEXT'; // > 20 ตัว → derive textOverlay=2

// ============================================================
// (ก) pass1 textOverlay swap: หลัก(มี _heroFaceCrop+clean เก่า) → สำรอง(ไม่มี _heroFaceCrop, clean/faces ต่างกัน)
// ============================================================
await test('B1(ก) pass1 swap (flag ON default): _heroFaceCrop ของภาพเดิมต้องถูกลบทิ้ง (สำรองไม่มี _heroFaceCrop) + clean/faces/newsScene/dirtyFallback อัปเดตตามภาพใหม่จริง', async () => {
  setEnv('MEGA_CROP_CHAIN_FIX', null);
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg', triage: { person: 'เอ', clean: true, newsScene: true, faceCount: 1 } },
    { id: 'hb1', imageUrl: 'https://x/hb1.jpg', triage: { person: 'บี', clean: false, newsScene: false, faceCount: 3 } }, // สำรอง: clean:false, faces=3, ไม่มี _heroFaceCrop
  ];
  const slots = mkSlots({
    hero: {
      id: 'h1', backups: ['hb1'], person: 'เอ', clean: true, newsScene: true, faces: 1, dirtyFallback: false,
      _heroFaceCrop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, // ★ ค่าเดิมของ h1 — ต้องถูกลบทิ้งหลังสลับไป hb1
    },
  });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => ({ index: i, textFound: i === 0 ? LONG_TEXT : '', faceBox: null, faceCount: 1 })),
      }),
    },
  });
  assert.equal(r.swapped, 1);
  assert.equal(slots.hero.id, 'hb1');
  assert.ok(!('_heroFaceCrop' in slots.hero), '🔴 หัวใจ B1: _heroFaceCrop ของ h1 ต้องถูกลบทิ้ง ห้ามค้างทาบ hb1 (hb1 ไม่มี _heroFaceCrop เป็นของตัวเอง)');
  assert.equal(slots.hero.clean, false, 'clean ต้องอัปเดตตาม hb1 (triage.clean=false)');
  assert.equal(slots.hero.newsScene, false, 'newsScene ต้องอัปเดตตาม hb1');
  assert.equal(slots.hero.faces, 3, 'faces ต้องอัปเดตตาม hb1 (faceCount=3 ไม่ใช่ 1 ของ h1 เดิม)');
});

await test('B1(ก) pass1 swap: สำรองมี _heroFaceCrop ของตัวเอง → ต้องใช้ของสำรอง ไม่ใช่ของเดิม', async () => {
  setEnv('MEGA_CROP_CHAIN_FIX', null);
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg', triage: { clean: true, faceCount: 1 }, _heroFaceCrop: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 } },
    { id: 'hb1', imageUrl: 'https://x/hb1.jpg', triage: { clean: true, faceCount: 1 }, _heroFaceCrop: { x: 0.4, y: 0.4, w: 0.4, h: 0.4 } },
  ];
  const slots = mkSlots({ hero: { id: 'h1', backups: ['hb1'], clean: true, faces: 1, _heroFaceCrop: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 } } });
  await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({ results: images.map((_, i) => ({ index: i, textFound: i === 0 ? LONG_TEXT : '', faceBox: null, faceCount: 1 })) }),
    },
  });
  assert.deepEqual(slots.hero._heroFaceCrop, { x: 0.4, y: 0.4, w: 0.4, h: 0.4 }, '_heroFaceCrop ต้องเป็นของ hb1 (ภาพใหม่) ไม่ใช่ของ h1 (ภาพเดิม)');
});

// ============================================================
// (ก) นโยบาย hero แข็ง (ไม่มี donor — candidate เป็น backup ล้วน)
// ============================================================
await test('B1(ก) นโยบาย hero แข็ง (ไม่มี donor): candidate ไม่มี _heroFaceCrop → ของเดิมถูกลบทิ้ง + faces/clean ตรงกับ candidate', async () => {
  setEnv('MEGA_CROP_CHAIN_FIX', null);
  const records = [
    { id: 'h_helmet', imageUrl: 'https://x/h_helmet.jpg', triage: { person: 'เอ', clean: true, faceCount: 1 }, _heroFaceCrop: { x: 0, y: 0, w: 1, h: 1 } },
    { id: 'hb_clear', imageUrl: 'https://x/hb_clear.jpg', triage: { person: 'เอ', clean: false, faceCount: 2 } }, // ไม่มี _heroFaceCrop เป็นของตัวเอง
  ];
  const slots = mkSlots({ hero: { id: 'h_helmet', backups: ['hb_clear'], person: 'เอ', clean: true, faces: 1, _heroFaceCrop: { x: 0, y: 0, w: 1, h: 1 } } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => (i === 0
          ? { index: 0, textFound: '', faceBox: null, faceCount: 1, faceVisible: 1 }
          : { index: 1, textFound: '', faceBox: null, faceCount: 2, faceVisible: 2, sameAsHeroPerson: true })),
      }),
    },
  });
  assert.equal(r.swapped, 1);
  assert.equal(slots.hero.id, 'hb_clear');
  assert.ok(!('_heroFaceCrop' in slots.hero), '🔴 candidate ไม่มี _heroFaceCrop → ต้องลบของเดิมทิ้ง');
  assert.equal(slots.hero.clean, false, 'clean ต้องตรงกับ candidate (triage.clean=false)');
  assert.equal(slots.hero.faces, 2, 'faces ต้องตรงกับ candidate (faceCount=2)');
});

// ============================================================
// (ก) สลับสองทาง (donor ได้ภาพ hero เดิมกลับไป) — donor ต้องได้ meta ของภาพ hero เดิมจริง ไม่ใช่ meta ของ candidate
// ============================================================
await test('B1(ก) สลับสองทาง: ช่อง donor ที่รับภาพ hero เดิมกลับไป ต้องได้ _heroFaceCrop/clean/faces ของภาพ hero เดิม (ไม่ใช่ค่าที่ค้างจาก candidate เดิมของช่องนั้น)', async () => {
  setEnv('MEGA_CROP_CHAIN_FIX', null);
  const records = [
    { id: 'h_helmet', imageUrl: 'https://x/h_helmet.jpg', triage: { person: 'ไรเดอร์เอ', clean: true, faceCount: 1 }, _heroFaceCrop: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    { id: 'ctx_realface', imageUrl: 'https://x/ctx_realface.jpg', triage: { person: 'ไรเดอร์เอ', clean: false, faceCount: 1 } }, // ไม่มี _heroFaceCrop
    { id: 'r1', imageUrl: 'https://x/r1.jpg', triage: { clean: true } },
    { id: 'a1', imageUrl: 'https://x/a1.jpg', triage: { clean: true } },
    { id: 'c1', imageUrl: 'https://x/c1.jpg', triage: { clean: true } },
  ];
  const slots = mkSlots({
    hero: { id: 'h_helmet', imageUrl: 'https://x/h_helmet.jpg', backups: [], person: 'ไรเดอร์เอ', clean: true, faces: 1, _heroFaceCrop: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    reaction: { id: 'r1', imageUrl: 'https://x/r1.jpg', backups: [] },
    action: { id: 'a1', imageUrl: 'https://x/a1.jpg', backups: [] },
    // ★ context เดิมค้าง _heroFaceCrop ผี (บั๊กเก่าจากรอบก่อนๆ) — เพื่อพิสูจน์ว่าหลังสลับสองทาง ต้องถูกล้าง/แทนที่ถูกต้อง
    context: { id: 'ctx_realface', imageUrl: 'https://x/ctx_realface.jpg', backups: [], person: 'ไรเดอร์เอ', clean: false, faces: 1, _heroFaceCrop: { x: 0.9, y: 0.9, w: 0.05, h: 0.05 } },
    circle: { id: 'c1', imageUrl: 'https://x/c1.jpg', backups: [] },
  });
  await _runSecondEye({
    slots, activeSlots: ['hero', 'reaction', 'action', 'context', 'circle'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => {
          if (i === 0) return { index: 0, textFound: '', faceBox: null, faceCount: 1, faceVisible: 1 }; // hero: หมวกบัง
          if (i === 3) return { index: 3, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2, sameAsHeroPerson: true }; // context primary (activeSlots order: hero,reaction,action,context,circle → index 3): หน้าเต็ม
          return { index: i, textFound: '', faceBox: null, faceCount: 0, faceVisible: 0, sameAsHeroPerson: false };
        }),
      }),
    },
  });
  assert.equal(slots.hero.id, 'ctx_realface');
  assert.equal(slots.context.id, 'h_helmet');
  assert.ok(!('_heroFaceCrop' in slots.hero), 'hero ได้ ctx_realface (ไม่มี _heroFaceCrop) → ต้องไม่มี _heroFaceCrop เลย');
  assert.deepEqual(slots.context._heroFaceCrop, { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, 'ช่อง context ต้องได้ _heroFaceCrop ของ h_helmet (ภาพที่เพิ่งย้ายมา) ไม่ใช่ค่าผีเดิมของตัวเอง');
  assert.equal(slots.context.clean, true, 'clean ของ context ต้องตรงกับ h_helmet (true) ไม่ใช่ค่าเดิมของ ctx_realface (false)');
  assert.equal(slots.hero.clean, false, 'clean ของ hero ต้องตรงกับ ctx_realface (false)');
});

// ============================================================
// (ก) PASS2 _swapRoleImageMechanic (ช่องย่อย ช็อตซ้ำ/text ทับ)
// ============================================================
await test('B1(ก) PASS2 สลับช่องย่อย: candidate (backup) มี clean/faces ต่างจากเดิม → slots ต้องอัปเดตตาม candidate จริง', async () => {
  setEnv('MEGA_CROP_CHAIN_FIX', null);
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg', triage: { clean: true, faceCount: 1 } },
    { id: 'act1', imageUrl: 'https://x/act1.jpg', triage: { clean: true, faceCount: 1 } },
    { id: 'ctx1', imageUrl: 'https://x/ctx1.jpg', triage: { clean: true, faceCount: 1 } },
    { id: 'ctxb1', imageUrl: 'https://x/ctxb1.jpg', triage: { clean: false, faceCount: 4 } }, // backup ของ context — clean/faces ต่างชัดเจน
  ];
  const slots = mkSlots({
    hero: { id: 'h1', backups: [], clean: true, faces: 1 },
    action: { id: 'act1', backups: [], clean: true, faces: 1 },
    context: { id: 'ctx1', backups: ['ctxb1'], clean: true, faces: 1 },
  });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'action', 'context'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => {
          // act1(index1) กับ ctx1(index2) ช็อตซ้ำกัน (duplicateOfIndex ชี้กัน) — ctxb1(index3, backup) ไม่ซ้ำใคร
          if (i === 1) return { index: 1, textFound: '', faceBox: null, faceCount: 1, duplicateOfIndex: 2 };
          if (i === 2) return { index: 2, textFound: '', faceBox: null, faceCount: 1, duplicateOfIndex: 1 };
          if (i === 3) return { index: 3, textFound: '', faceBox: null, faceCount: 4, duplicateOfIndex: null };
          return { index: i, textFound: '', faceBox: null, faceCount: 1, duplicateOfIndex: null };
        }),
      }),
    },
  });
  assert.equal(slots.context.id, 'ctxb1', 'context ต้องถูกแทนด้วย backup (ctxb1) เพราะช็อตซ้ำกับ action');
  assert.equal(slots.context.clean, false, 'clean ต้องตรงกับ ctxb1 (false) ไม่ใช่ค่าเดิม ctx1 (true)');
  assert.equal(slots.context.faces, 4, 'faces ต้องตรงกับ ctxb1 (faceCount=4)');
});

// ============================================================
// (ข) kill-switch MEGA_CROP_CHAIN_FIX=0 → พฤติกรรมเดิมทุก byte (stale field ค้างเหมือนบั๊กเดิม)
// ============================================================
await test('B1(ข) kill-switch=0: _heroFaceCrop ของภาพเดิมยังค้างทาบภาพใหม่ (พฤติกรรมเดิมก่อนแก้ — byte-parity)', async () => {
  setEnv('MEGA_CROP_CHAIN_FIX', '0');
  try {
    const records = [
      { id: 'h1', imageUrl: 'https://x/h1.jpg', triage: { clean: true, faceCount: 1 } },
      { id: 'hb1', imageUrl: 'https://x/hb1.jpg', triage: { clean: false, faceCount: 3 } },
    ];
    const slots = mkSlots({ hero: { id: 'h1', backups: ['hb1'], clean: true, faces: 1, _heroFaceCrop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } } });
    const r = await _runSecondEye({
      slots, activeSlots: ['hero'], byId: mkById(records),
      _deps: {
        fetchImageB64: mkFetch(),
        callGeminiVision: async ({ images }) => ({ results: images.map((_, i) => ({ index: i, textFound: i === 0 ? LONG_TEXT : '', faceBox: null, faceCount: 1 })) }),
      },
    });
    assert.equal(r.swapped, 1, 'ยังสลับปกติ (id/imageUrl/person เปลี่ยนตามเดิม — B1 ไม่แตะจุดนี้)');
    assert.equal(slots.hero.id, 'hb1');
    assert.deepEqual(slots.hero._heroFaceCrop, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, '🔴 flag OFF: _heroFaceCrop ของ h1 (เดิม) ต้องยังค้างอยู่ — นี่คือพฤติกรรมบั๊กเดิมก่อนแก้ (byte-parity)');
    assert.equal(slots.hero.clean, true, 'flag OFF: clean ต้องยังเป็นค่าเดิม (h1: true) ไม่อัปเดตตาม hb1 (false)');
    assert.equal(slots.hero.faces, 1, 'flag OFF: faces ต้องยังเป็นค่าเดิม (h1: 1) ไม่อัปเดตตาม hb1 (3)');
  } finally {
    setEnv('MEGA_CROP_CHAIN_FIX', null);
  }
});

await test('B1(ข) kill-switch ไม่ตั้ง/ค่าอื่น (เช่น "1") → เปิดใช้งานเหมือน default', async () => {
  for (const v of [null, '1', 'true', 'on']) {
    setEnv('MEGA_CROP_CHAIN_FIX', v);
    const records = [
      { id: 'h1', imageUrl: 'https://x/h1.jpg', triage: { clean: true, faceCount: 1 } },
      { id: 'hb1', imageUrl: 'https://x/hb1.jpg', triage: { clean: false, faceCount: 3 } },
    ];
    const slots = mkSlots({ hero: { id: 'h1', backups: ['hb1'], clean: true, faces: 1, _heroFaceCrop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } } });
    await _runSecondEye({
      slots, activeSlots: ['hero'], byId: mkById(records),
      _deps: {
        fetchImageB64: mkFetch(),
        callGeminiVision: async ({ images }) => ({ results: images.map((_, i) => ({ index: i, textFound: i === 0 ? LONG_TEXT : '', faceBox: null, faceCount: 1 })) }),
      },
    });
    assert.ok(!('_heroFaceCrop' in slots.hero), `env=${JSON.stringify(v)}: ต้องเปิดใช้งาน (ลบ _heroFaceCrop ค้าง)`);
  }
  setEnv('MEGA_CROP_CHAIN_FIX', null);
});

// ============================================================
// context threading: dirtyFallbackIds / storyFitOf / STORY_SEL_ON ส่งผ่าน _runSecondEye ได้จริง
// ============================================================
await test('context threading: dirtyFallbackIds ส่งมาจาก s6_slots จริง → dirtyFallback ของภาพใหม่คำนวณถูกต้อง', async () => {
  setEnv('MEGA_CROP_CHAIN_FIX', null);
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg', triage: { clean: true, faceCount: 1 } },
    { id: 'hb1', imageUrl: 'https://x/hb1.jpg', triage: { clean: true, faceCount: 1 } },
  ];
  const slots = mkSlots({ hero: { id: 'h1', backups: ['hb1'], clean: true, faces: 1, dirtyFallback: false } });
  await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    dirtyFallbackIds: new Set(['hb1']), // ★ hb1 คือของเติมพูลบาง (dirtyFallback จริง)
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({ results: images.map((_, i) => ({ index: i, textFound: i === 0 ? LONG_TEXT : '', faceBox: null, faceCount: 1 })) }),
    },
  });
  assert.equal(slots.hero.dirtyFallback, true, 'hb1 อยู่ใน dirtyFallbackIds ที่ส่งมา → dirtyFallback ต้องเป็น true');
});

await test('context threading: ไม่ส่ง dirtyFallbackIds/isClean มาเลย (ผู้เรียกเก่า/เทสเก่า) → ใช้ default ปลอดภัย ไม่ throw', async () => {
  setEnv('MEGA_CROP_CHAIN_FIX', null);
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg', triage: { clean: true, faceCount: 1 } },
    { id: 'hb1', imageUrl: 'https://x/hb1.jpg' }, // ไม่มี triage เลย
  ];
  const slots = mkSlots({ hero: { id: 'h1', backups: ['hb1'], clean: true, faces: 1 } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({ results: images.map((_, i) => ({ index: i, textFound: i === 0 ? LONG_TEXT : '', faceBox: null, faceCount: 1 })) }),
    },
  });
  assert.equal(r.swapped, 1);
  assert.equal(slots.hero.dirtyFallback, false, 'default dirtyFallbackIds ว่างเปล่า → false เสมอ ไม่ throw');
  assert.equal(slots.hero.clean, true, 'default isClean: triage undefined → clean !== false → true (fail-open)');
});

console.log(`\n# mega-crop-chain-fix-b1: ${passed}/${passed + failed} passed`);
console.log('1..' + (passed + failed));
if (failed) process.exit(1);
