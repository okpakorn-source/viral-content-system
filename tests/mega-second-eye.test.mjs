// ============================================================
// 👁️‍🗨️ MEGA_SECOND_EYE (เคส AC-0195 27/28 ก.ค. 69 — "ตาโกหก": ตาคัด/ตาหาหน้าให้ faceBox ผิดจนครอปตัดหัว)
// เทส _runSecondEye (megaAdapters.js) โดยตรง — ฉีด _deps.callGeminiVision/_deps.fetchImageB64/_deps.setTriage
// ปลอม (ไม่ยิง network/Gemini/DB จริง) พิสูจน์:
// (1) ตรวจ ≤5 ใบหลัก + ≤3 สำรอง รวม ≤8 ใบ ใน call เดียว
// (2) primary textOverlay=2 (derive จาก textFound) + สำรองสะอาดกว่า → สลับ id/imageUrl/person จริง
// (3) faceBox จากตาสองแนบเป็น override เสมอ · รูปแบบพัง = ไม่เชื่อ
// (4) 👁️ "ตาไม่โกหก" รอบ 2 (28 ก.ค.): textOverlay ต้อง derive จาก textFound (ข้อความที่อ่านออกมาจริง) เท่านั้น
//     ไม่เชื่อ field ตัวเลขที่โมเดลส่งมาตรงๆ แม้พยายามหลอกว่า 0
// (5) จับตาแรกโกหก: triage เดิมอ้างว่า clean (หรือไม่มีข้อมูล = ภาพยุคเก่า) แต่ตาสองอ่านออก textOverlay=2 จริง
//     → เรียก setTriage แก้คลังถาวร (merge-safe, ไม่ทับฟิลด์เดิม) + นับ liesCaught
// (6) MEGA_SECOND_EYE_MODEL env override ได้ · ไม่ตั้ง = COVER_GEMINI_MODEL เดิม
// (7) ล้ม/throw จาก callGeminiVision = ปล่อยออกไปตรงๆ ไม่กลืนเงียบ (ผู้เรียกจริงใน s6_slots ครอบ try/catch
//     อีกชั้น fail-open — ดู log ที่นั่น ไม่ใช่ในฟังก์ชันนี้)
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
const { COVER_GEMINI_MODEL } = await import('../src/lib/coverVisionModel.js');
const { AI_HONESTY_DNA } = await import('../src/lib/aiHonestyDna.js');

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 6).join('\n  ')}`); } };

const mkFetch = (fail = new Set()) => async (url) => (fail.has(url) ? null : { data: 'ZmFrZQ==', mimeType: 'image/jpeg' }); // "fake" base64
const activeSlots = ['hero', 'reaction', 'action', 'context', 'circle'];
const mkById = (records) => new Map(records.map((r) => [String(r.id), r]));
const mkSlots = (picks) => Object.fromEntries(Object.entries(picks).map(([role, p]) => [role, { ...p }]));

const LONG_TEXT = 'BREAKING NEWS HEADLINE BAR TEXT'; // 31 ตัวอักษร > 20 → derive textOverlay=2 (แถบข่าว/พาดหัว)
const SHORT_TEXT = 'LOGO2024'; // 8 ตัวอักษร ≤20 → derive textOverlay=1 (ลายน้ำ/โลโก้เล็ก)

await test('ไม่มีช่องไหนมี .id เลย (slots ว่างเปล่า) → คืน {swapped:0, fixedCoords:0, checked:0, liesCaught:0} ไม่เรียก callGeminiVision เลย', async () => {
  let called = false;
  const r = await _runSecondEye({ slots: {}, activeSlots, byId: mkById([]), _deps: { callGeminiVision: async () => { called = true; return {}; }, fetchImageB64: mkFetch() } });
  assert.deepEqual(r, { swapped: 0, fixedCoords: 0, checked: 0, liesCaught: 0 });
  assert.ok(!called, 'ไม่ควรเรียก Gemini เมื่อไม่มีอะไรให้ตรวจ');
});

await test('5 ช่องหลัก ไม่มีสำรองเลย → ส่งภาพ 5 ใบใน call เดียว, textFound ว่างทุกใบ → ไม่สลับ ไม่มีใครโกหก, แนบ faceBox ถูกต้องครบ', async () => {
  const records = ['h1', 'r1', 'a1', 'c1', 'ci1'].map((id) => ({ id, imageUrl: `https://x/${id}.jpg` }));
  const slots = mkSlots({
    hero: { id: 'h1', backups: [] }, reaction: { id: 'r1', backups: [] }, action: { id: 'a1', backups: [] },
    context: { id: 'c1', backups: [] }, circle: { id: 'ci1', backups: [] },
  });
  let capturedImages = null;
  const r = await _runSecondEye({
    slots, activeSlots, byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => {
        capturedImages = images;
        return { results: images.map((_, i) => ({ index: i, textFound: '', faceBox: { x1: 0.3, y1: 0.2, x2: 0.7, y2: 0.6 }, faceCount: 1 })) };
      },
    },
  });
  assert.equal(capturedImages.length, 5, 'ส่งภาพ 5 ใบ (หลักล้วน ไม่มีสำรอง)');
  assert.equal(r.checked, 5);
  assert.equal(r.swapped, 0, 'textFound ว่างหมด (textOverlay=0) → ไม่สลับ');
  assert.equal(r.liesCaught, 0, 'ไม่มีใครโกหก (textOverlay=0 ทุกใบ)');
  assert.equal(r.fixedCoords, 5, 'ทุกช่องได้ faceBox override (5 ช่อง)');
  for (const role of activeSlots) {
    assert.deepEqual(slots[role]._secondEyeFaceBox, { x1: 0.3, y1: 0.2, x2: 0.7, y2: 0.6 });
    assert.ok(!slots[role]._secondEyeSwapped, `${role} ไม่ควรมี _secondEyeSwapped`);
  }
});

await test('primary textFound ยาว (แถบข่าวทับ, derive textOverlay=2) + สำรอง textFound ว่าง (derive 0) → สลับ .id/.imageUrl/.person จริง + นับ swapped + จับได้ว่าโกหก 1 ใบ', async () => {
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg', triage: { person: 'เอ' } },
    { id: 'hb1', imageUrl: 'https://x/hb1.jpg', triage: { person: 'บี' } },
  ];
  const slots = mkSlots({ hero: { id: 'h1', backups: ['hb1'], person: 'เอ' } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        // ใบแรก (primary h1) = textFound ยาว, ใบสอง (backup hb1) = textFound ว่าง
        results: images.map((_, i) => ({ index: i, textFound: i === 0 ? LONG_TEXT : '', faceBox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5 }, faceCount: 1 })),
      }),
    },
  });
  assert.equal(r.swapped, 1, 'สลับ 1 ช่อง');
  assert.equal(r.liesCaught, 1, 'h1 triage เดิมไม่มี clean:false (ถือว่าอ้าง clean) แต่ตาสองอ่านออกข้อความยาว = จับโกหกได้ 1 ใบ');
  assert.equal(slots.hero.id, 'hb1', '.id ต้องเปลี่ยนเป็นสำรอง');
  assert.equal(slots.hero.imageUrl, 'https://x/hb1.jpg', '.imageUrl ต้องอัปเดตตามภาพใหม่ (ไม่ใช่แค่ .id — บั๊กที่ต้องระวัง)');
  assert.equal(slots.hero.person, 'บี', '.person ต้องอัปเดตตามภาพใหม่ด้วย');
  assert.ok(slots.hero._secondEyeSwapped && slots.hero._secondEyeSwapped.from === 'h1' && slots.hero._secondEyeSwapped.to === 'hb1');
  assert.deepEqual(slots.hero._secondEyeFaceBox, { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5 }, 'faceBox override ต้องเป็นของภาพใหม่ (backup) ไม่ใช่ของเดิม');
});

await test('primary textFound สั้น (ลายน้ำ/โลโก้เล็ก, derive textOverlay=1 ไม่ใช่ 2) + มีสำรอง → ไม่สลับ ไม่นับโกหก (เกณฑ์สลับ/โกหกต้อง =2 เท่านั้น)', async () => {
  const records = [{ id: 'h1', imageUrl: 'https://x/h1.jpg' }, { id: 'hb1', imageUrl: 'https://x/hb1.jpg' }];
  const slots = mkSlots({ hero: { id: 'h1', backups: ['hb1'] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({ results: images.map((_, i) => ({ index: i, textFound: i === 0 ? SHORT_TEXT : '', faceBox: null, faceCount: 0 })) }),
    },
  });
  assert.equal(r.swapped, 0);
  assert.equal(r.liesCaught, 0, 'textOverlay=1 ไม่ถือว่าโกหก (เกณฑ์คือ 2 เท่านั้น)');
  assert.equal(slots.hero.id, 'h1', 'ยังใช้ภาพเดิม');
});

await test('primary textFound ยาว (derive 2) แต่ไม่มีสำรองให้เช็ค (backups ว่าง) → ไม่สลับ (ไม่มีตัวเลือกให้แทน) แต่ยังนับว่าจับโกหกได้', async () => {
  const records = [{ id: 'h1', imageUrl: 'https://x/h1.jpg' }];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: { fetchImageB64: mkFetch(), callGeminiVision: async () => ({ results: [{ index: 0, textFound: LONG_TEXT, faceBox: null, faceCount: 0 }] }) },
  });
  assert.equal(r.swapped, 0);
  assert.equal(r.liesCaught, 1, 'จับโกหกได้แม้ไม่มีสำรองให้สลับ (คนละเรื่องกับการสลับภาพ)');
  assert.equal(slots.hero.id, 'h1');
});

await test('ไม่เชื่อ field ตัวเลขที่โมเดลส่งมาตรงๆ แม้พยายามหลอกว่า textOverlay=0 — ต้อง derive จาก textFound เองเสมอ (transcription proof)', async () => {
  const records = [{ id: 'h1', imageUrl: 'https://x/h1.jpg' }, { id: 'hb1', imageUrl: 'https://x/hb1.jpg' }];
  const slots = mkSlots({ hero: { id: 'h1', backups: ['hb1'] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => ({ index: i, textOverlay: 0 /* หลอกว่า 0 */, textFound: i === 0 ? LONG_TEXT : '', faceBox: null, faceCount: 0 })),
      }),
    },
  });
  assert.equal(r.swapped, 1, 'ต้องยังสลับ — เพราะ derive จาก textFound (ยาว) ไม่ใช่เชื่อ textOverlay:0 ที่ส่งมาหลอก');
});

await test('faceBox รูปแบบพัง (x2<x1 / ค่าไม่ใช่ตัวเลข / เกินขอบ) → ไม่แนบ _secondEyeFaceBox เลย (fail-safe ไม่เชื่อข้อมูลแปลก)', async () => {
  const cases = [
    { x1: 0.5, y1: 0.1, x2: 0.3, y2: 0.5 }, // x2 < x1
    { x1: 'a', y1: 0.1, x2: 0.5, y2: 0.5 }, // ไม่ใช่ตัวเลข
    null,
    undefined,
  ];
  for (const fb of cases) {
    const records = [{ id: 'h1', imageUrl: 'https://x/h1.jpg' }];
    const slots = mkSlots({ hero: { id: 'h1', backups: [] } });
    await _runSecondEye({
      slots, activeSlots: ['hero'], byId: mkById(records),
      _deps: { fetchImageB64: mkFetch(), callGeminiVision: async () => ({ results: [{ index: 0, textFound: '', faceBox: fb, faceCount: 1 }] }) },
    });
    assert.ok(!slots.hero._secondEyeFaceBox, `faceBox พังรูปแบบ (${JSON.stringify(fb)}) ต้องไม่ถูกเชื่อ`);
  }
});

await test('เพดานสำรอง ≤5 ใบ (28 ก.ค. 69 เคส AC-0201 ขยายจากเดิม ≤3): 5 ช่องหลักมีสำรองครบทุกช่องอย่างละ 1 → ส่งภาพรวม 5+5=10 ใบเท่านั้น', async () => {
  const roles = ['hero', 'reaction', 'action', 'context', 'circle'];
  const records = [];
  const picks = {};
  for (const role of roles) {
    records.push({ id: `${role}_p`, imageUrl: `https://x/${role}_p.jpg` });
    records.push({ id: `${role}_b`, imageUrl: `https://x/${role}_b.jpg` });
    picks[role] = { id: `${role}_p`, backups: [`${role}_b`] };
  }
  const slots = mkSlots(picks);
  let capturedCount = 0;
  await _runSecondEye({
    slots, activeSlots: roles, byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => { capturedCount = images.length; return { results: images.map((_, i) => ({ index: i, textFound: '', faceBox: null, faceCount: 0 })) }; },
    },
  });
  assert.equal(capturedCount, 10, `ต้องส่งแค่ 5 หลัก + 5 สำรอง (เพดานงบใหม่) = 10 (ได้ ${capturedCount})`);
});

await test('เพดานภาพรวม 10 ใบไม่ทะลุ (28 ก.ค. 69 เคส AC-0201): พูลสำรองจริงมีมากกว่า 5 ใบ (hero มี 3 + ช่องอื่นละ 1 = 7 ผู้สมัคร) → ตัดเหลือแค่ 5 ตามงบ ไม่ใช่ส่งทั้ง 7', async () => {
  const records = [
    { id: 'h_p', imageUrl: 'https://x/h_p.jpg' },
    { id: 'h_b1', imageUrl: 'https://x/h_b1.jpg' },
    { id: 'h_b2', imageUrl: 'https://x/h_b2.jpg' },
    { id: 'h_b3', imageUrl: 'https://x/h_b3.jpg' },
    { id: 'r_p', imageUrl: 'https://x/r_p.jpg' }, { id: 'r_b', imageUrl: 'https://x/r_b.jpg' },
    { id: 'a_p', imageUrl: 'https://x/a_p.jpg' }, { id: 'a_b', imageUrl: 'https://x/a_b.jpg' },
    { id: 'c_p', imageUrl: 'https://x/c_p.jpg' }, { id: 'c_b', imageUrl: 'https://x/c_b.jpg' },
  ];
  const slots = mkSlots({
    hero: { id: 'h_p', backups: ['h_b1', 'h_b2', 'h_b3'] },
    reaction: { id: 'r_p', backups: ['r_b'] },
    action: { id: 'a_p', backups: ['a_b'] },
    context: { id: 'c_p', backups: ['c_b'] },
  });
  let capturedCount = 0;
  await _runSecondEye({
    slots, activeSlots: ['hero', 'reaction', 'action', 'context'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => { capturedCount = images.length; return { results: images.map((_, i) => ({ index: i, textFound: '', faceBox: null, faceCount: 0 })) }; },
    },
  });
  // 4 primary (hero/reaction/action/context) + สูงสุด 5 สำรอง (จากผู้สมัคร 6: h_b1/h_b2/h_b3/r_b/a_b/c_b) = ≤9 เสมอ
  assert.ok(capturedCount <= 9, `ต้องไม่เกิน 4 หลัก + 5 สำรอง = 9 (ได้ ${capturedCount})`);
  assert.equal(capturedCount, 9, `ผู้สมัครสำรองมี 6 ใบ (เกินงบ 5) → ต้องตัดเหลือ 5 พอดี รวมเป็น 4+5=9 (ได้ ${capturedCount})`);
});

await test('เรียงลำดับ "ผู้ท้าชิง hero" ก่อนเสมอ (28 ก.ค. 69 เคส AC-0201): สำรองที่มีหน้า (faceCount≥1) + ไม่ text-suspect ต้องถูกส่งตรวจก่อนสำรองที่ไม่มีหน้า/ต้องสงสัยว่ามีตัวหนังสือทับ เมื่องบไม่พอส่งครบทุกใบ', async () => {
  const records = [
    { id: 'h_p', imageUrl: 'https://x/h_p.jpg' },
    // จงใจเรียง candidate ให้ "แย่ก่อนดี" ในลำดับ backups array — พิสูจน์ว่า sort ทำงานจริง ไม่ใช่แค่ตามลำดับเดิม
    { id: 'no_face', imageUrl: 'https://x/no_face.jpg', triage: { faceCount: 0, clean: true } }, // ไม่มีหน้า
    { id: 'dirty_face', imageUrl: 'https://x/dirty_face.jpg', triage: { faceCount: 1, clean: false } }, // มีหน้า แต่ text-suspect
    { id: 'clean_face_1', imageUrl: 'https://x/clean_face_1.jpg', triage: { faceCount: 1, clean: true } }, // ผู้ท้าชิงตัวจริง
    { id: 'clean_face_2', imageUrl: 'https://x/clean_face_2.jpg', triage: { faceCount: 2, clean: true } }, // ผู้ท้าชิงตัวจริง
  ];
  const slots = mkSlots({ hero: { id: 'h_p', backups: ['no_face', 'dirty_face', 'clean_face_1', 'clean_face_2'] } });
  let capturedMapIds = null;
  await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: {
      fetchImageB64: async (url) => ({ data: 'ZmFrZQ==', mimeType: 'image/jpeg', _url: url }),
      callGeminiVision: async ({ images }) => {
        capturedMapIds = images.map((im) => im._url);
        return { results: images.map((_, i) => ({ index: i, textFound: '', faceBox: null, faceCount: 0 })) };
      },
    },
  });
  // งบสำรอง ≤5 พอส่งครบทั้ง 4 ผู้สมัครในเคสนี้ (ไม่ทะลุ) — แต่ "ลำดับ" ที่ส่งเข้า images[] ต้องเรียงผู้ท้าชิงก่อนเสมอ
  const order = capturedMapIds.slice(1).map((u) => String(u).split('/').pop().replace('.jpg', ''));
  const idxCleanFace1 = order.indexOf('clean_face_1');
  const idxCleanFace2 = order.indexOf('clean_face_2');
  const idxNoFace = order.indexOf('no_face');
  const idxDirtyFace = order.indexOf('dirty_face');
  assert.ok(idxCleanFace1 < idxNoFace && idxCleanFace1 < idxDirtyFace, 'ผู้ท้าชิงมีหน้า+สะอาด ต้องมาก่อนใบไม่มีหน้า/สงสัยตัวหนังสือทับเสมอ');
  assert.ok(idxCleanFace2 < idxNoFace && idxCleanFace2 < idxDirtyFace, 'ผู้ท้าชิงมีหน้า+สะอาดอีกใบ ก็ต้องมาก่อนเช่นกัน');
  assert.ok(idxDirtyFace < idxNoFace, 'มีหน้าแต่ text-suspect ยังต้องมาก่อนใบไม่มีหน้าเลย (เกณฑ์ที่ 1 คือมีหน้าก่อน)');
});

await test('fetchImageB64 ล้มบางใบ (URL โหลดไม่ได้) → ข้ามใบนั้นเงียบๆ ยังตรวจใบที่เหลือได้ปกติ', async () => {
  const records = [{ id: 'h1', imageUrl: 'https://x/h1.jpg' }, { id: 'r1', imageUrl: 'https://x/r1.jpg' }];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] }, reaction: { id: 'r1', backups: [] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'reaction'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(new Set(['https://x/h1.jpg'])), // hero โหลดล้ม
      callGeminiVision: async ({ images }) => ({ results: images.map((_, i) => ({ index: i, textFound: '', faceBox: { x1: 0.2, y1: 0.2, x2: 0.4, y2: 0.4 }, faceCount: 1 })) }),
    },
  });
  assert.equal(r.checked, 2, 'checked นับ role ที่มี .id ทั้งคู่ (ไม่ใช่แค่ที่โหลดสำเร็จ)');
  assert.ok(!slots.hero._secondEyeFaceBox, 'hero โหลดล้ม → ไม่มีผลตรวจ ไม่แนบ faceBox');
  assert.deepEqual(slots.reaction._secondEyeFaceBox, { x1: 0.2, y1: 0.2, x2: 0.4, y2: 0.4 }, 'reaction โหลดสำเร็จ → ยังได้ผลปกติ');
});

// ═══════════════════ 28 ก.ค. 69 — เคสไรเดอร์ (ผู้ใช้เทียบ ref จริง): faceVisible + นโยบาย hero แข็ง ═══════════════════
// hero=หมวก+หน้ากาก+text ยักษ์ ทั้งที่ภาพหน้าจริงอยู่ในพูล — ตาสองต้องบังคับสลับหา candidate ที่ faceVisible=2 +
// textOverlay≤1 + เป็นคนเดียวกับ hero เดิม (sameAsHeroPerson) เจอ=สลับทันที · ไม่เจอ=คงเดิม+ติดธง · เดิม(หน้าเต็มอยู่แล้ว)=ไม่ยุ่ง

await test('เคสไรเดอร์ (ก) hero ใส่หมวก/หน้ากาก (faceVisible=1) + มี candidate หน้าเต็มคนเดียวกันในพูล (backup: faceVisible=2, textOverlay≤1, sameAsHeroPerson=true) → สลับจริง', async () => {
  const records = [
    { id: 'h_helmet', imageUrl: 'https://x/h_helmet.jpg', triage: { person: 'ไรเดอร์เอ' } },
    { id: 'h_realface', imageUrl: 'https://x/h_realface.jpg', triage: { person: 'ไรเดอร์เอ' } },
  ];
  const slots = mkSlots({ hero: { id: 'h_helmet', backups: ['h_realface'], person: 'ไรเดอร์เอ' } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        // index 0 = hero (h_helmet): หน้ากากบัง เห็นแค่ตา = faceVisible 1, ไม่มี text
        // index 1 = backup (h_realface): หน้าเต็มชัด คนเดียวกับ hero
        results: images.map((_, i) => (i === 0
          ? { index: 0, textFound: '', faceBox: { x1: 0.3, y1: 0.1, x2: 0.6, y2: 0.4 }, faceCount: 1, faceVisible: 1 }
          : { index: 1, textFound: '', faceBox: { x1: 0.2, y1: 0.1, x2: 0.7, y2: 0.6 }, faceCount: 1, faceVisible: 2, sameAsHeroPerson: true }
        )),
      }),
    },
  });
  assert.equal(slots.hero.id, 'h_realface', 'hero ต้องสลับไปใช้ภาพหน้าเต็มของคนเดียวกัน');
  assert.ok(r.swapped >= 1, 'ต้องนับเป็นการสลับ');
  assert.ok(slots.hero._secondEyeSwapped && slots.hero._secondEyeSwapped.reason.includes('hero_face_hidden_forced_replace'), 'ต้องบันทึกเหตุผลว่าบังคับสลับเพราะ hero หน้าไม่ชัด');
  assert.ok(!slots.hero._secondEyeHeroFaceHidden, 'สลับสำเร็จ = ไม่ติดธงจำใจใช้');
  assert.deepEqual(slots.hero._secondEyeFaceBox, { x1: 0.2, y1: 0.1, x2: 0.7, y2: 0.6 }, 'faceBox override ต้องเป็นของภาพใหม่ (หน้าเต็ม)');
});

await test('เคสไรเดอร์ (ข) hero ใส่หมวก (faceVisible=1) แต่ไม่มี candidate ที่ผ่านเกณฑ์ครบ (คนละคน) → คงภาพเดิม + ติดธง hero_face_hidden พร้อมเหตุผล', async () => {
  const records = [
    { id: 'h_helmet', imageUrl: 'https://x/h_helmet.jpg', triage: { person: 'ไรเดอร์เอ' } },
    { id: 'other_face', imageUrl: 'https://x/other_face.jpg', triage: { person: 'คนอื่น' } },
  ];
  const slots = mkSlots({ hero: { id: 'h_helmet', backups: ['other_face'], person: 'ไรเดอร์เอ' } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => (i === 0
          // faceCount:1 (มีคนอยู่แน่ๆ นับได้ 1 คน) แต่ faceVisible:1 (หมวก/หน้ากากบังจนเห็นแค่บางส่วน) — คนละ
          // เรื่องกับ "ปกไร้คน" (ข้อ 3 ผู้ตรวจ Opus ใหม่) ที่ faceCount ต้องเป็น 0 จริงๆ (ไม่มีคนในเฟรมเลย)
          ? { index: 0, textFound: '', faceBox: null, faceCount: 1, faceVisible: 1 }
          // หน้าเต็มจริง แต่ "คนละคน" กับ hero — ไม่ผ่านเกณฑ์ sameAsHeroPerson
          : { index: 1, textFound: '', faceBox: { x1: 0.2, y1: 0.1, x2: 0.7, y2: 0.6 }, faceCount: 1, faceVisible: 2, sameAsHeroPerson: false }
        )),
      }),
    },
  });
  assert.equal(slots.hero.id, 'h_helmet', 'ไม่มี candidate ที่ผ่านเกณฑ์ครบ (คนละคน) → ต้องคงภาพเดิม');
  assert.equal(r.swapped, 0);
  assert.ok(slots.hero._secondEyeHeroFaceHidden, 'ต้องติดธงจำใจใช้ hero หน้าไม่ชัด');
  assert.equal(slots.hero._secondEyeHeroFaceHidden.faceVisible, 1);
  assert.equal(slots.hero._secondEyeHeroFaceHidden.reason, 'no_qualifying_replacement_found_in_checked_pool');
});

await test('เคสไรเดอร์ (ค) hero หน้าเต็มชัดอยู่แล้ว (faceVisible=2, textOverlay=0) → นโยบายแข็งไม่ทำงานเลย (เทียบเท่า "ปิดสวิตช์" สำหรับ hero ที่ไม่มีปัญหา) — ไม่สลับ ไม่ติดธง', async () => {
  const records = [{ id: 'h_good', imageUrl: 'https://x/h_good.jpg' }, { id: 'h_backup', imageUrl: 'https://x/h_backup.jpg' }];
  const slots = mkSlots({ hero: { id: 'h_good', backups: ['h_backup'] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => (i === 0
          ? { index: 0, textFound: '', faceBox: { x1: 0.2, y1: 0.1, x2: 0.7, y2: 0.6 }, faceCount: 1, faceVisible: 2 }
          : { index: 1, textFound: '', faceBox: { x1: 0.2, y1: 0.1, x2: 0.7, y2: 0.6 }, faceCount: 1, faceVisible: 2, sameAsHeroPerson: true }
        )),
      }),
    },
  });
  assert.equal(slots.hero.id, 'h_good', 'hero หน้าเต็มอยู่แล้ว → ไม่ต้องสลับแม้มี candidate ที่ผ่านเกณฑ์ก็ตาม');
  assert.equal(r.swapped, 0);
  assert.ok(!slots.hero._secondEyeHeroFaceHidden, 'ไม่มีปัญหา → ไม่ติดธง');
  assert.ok(!slots.hero._secondEyeSwapped, 'ไม่มีปัญหา → ไม่มี record การสลับ');
});

await test('เคสไรเดอร์: sameAsHeroPerson/faceVisible รูปแบบพัง (ไม่ใช่ boolean/ไม่ใช่ 0-2) → validate เป็น null ไม่เชื่อ (fail-safe เหมือน faceBox)', async () => {
  const records = [{ id: 'h1', imageUrl: 'https://x/h1.jpg' }, { id: 'h1b', imageUrl: 'https://x/h1b.jpg' }];
  const slots = mkSlots({ hero: { id: 'h1', backups: ['h1b'] } });
  await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => (i === 0
          ? { index: 0, textFound: '', faceBox: null, faceCount: 0, faceVisible: 'ต่ำ' } // ผิดชนิด
          : { index: 1, textFound: '', faceBox: { x1: 0.2, y1: 0.1, x2: 0.7, y2: 0.6 }, faceCount: 1, faceVisible: 2, sameAsHeroPerson: 'ใช่' } // ผิดชนิด (ไม่ใช่ boolean)
        )),
      }),
    },
  });
  // faceVisible พังรูปแบบ → null → badFace ไม่ true (faceVisible !== null && ... เป็น false เพราะเป็น null) → ไม่เข้าเงื่อนไข
  // แต่ sameAsHeroPerson พังรูปแบบของ backup → null ≠ true → ถ้า badFace/badText true อยู่ก็ยังไม่ควรสลับเพราะ candidate ไม่ผ่าน
  assert.equal(slots.hero.id, 'h1', 'ค่าพังรูปแบบต้องไม่ทำให้สลับผิดพลาด');
  assert.ok(!slots.hero._secondEyeSwapped);
});

// ═══════ 28 ก.ค. 69 — ผู้ตรวจ (Opus) FAIL: candidate เป็น primary ของช่องอื่น → ต้อง "สลับสองทาง" ═══════
// บั๊กที่พบจริงจากรัน: บล็อกบังคับสลับ hero เดิมเขียนทับแค่ slots.hero → ถ้า candidate ดันเป็น primary ของช่องอื่น
// (เคสไรเดอร์จริง: ภาพหน้าเต็มเป็น primary ของช่องล่าง ไม่ใช่ backup ของ hero) จะได้ภาพเดียวกันขึ้น 2 ช่อง เพราะ
// บล็อกนี้อยู่ท้าย s6_slots หลังด่านกันซ้ำผ่านหมดแล้ว ไม่มีใครมาจับซ้ำอีกที

await test('เคสไรเดอร์ (ผู้ตรวจ Opus ก) candidate เป็น primary ของช่องอื่น (ไม่ใช่ backup ของ hero) → สลับสองทาง: hero ได้ภาพใหม่ + ช่องนั้นได้ภาพ hero เดิมกลับไป + id ทั้ง 5 ช่องไม่ซ้ำกันเลย', async () => {
  const records = [
    { id: 'h_helmet', imageUrl: 'https://x/h_helmet.jpg', triage: { person: 'ไรเดอร์เอ' } },
    { id: 'ctx_realface', imageUrl: 'https://x/ctx_realface.jpg', triage: { person: 'ไรเดอร์เอ' } }, // primary ของช่อง context จริงๆ (ไม่ใช่ backup ของ hero)
    { id: 'r1', imageUrl: 'https://x/r1.jpg' },
    { id: 'a1', imageUrl: 'https://x/a1.jpg' },
    { id: 'c1', imageUrl: 'https://x/c1.jpg' },
  ];
  // ★ imageUrl ต้องแนบมาด้วยเสมอ (production จริง s6_slots เซ็ตให้ทุกช่องอยู่แล้ว) — จำเป็นเฉพาะเทสนี้ที่ path
  //   สลับสองทางอ่าน slots.hero.imageUrl ตรงๆ ก่อนเขียนทับ (เทสอื่นก่อนหน้าไม่ต้องมีเพราะ donorRole เป็น null เสมอ)
  const slots = mkSlots({
    hero: { id: 'h_helmet', imageUrl: 'https://x/h_helmet.jpg', backups: [], person: 'ไรเดอร์เอ' },
    reaction: { id: 'r1', imageUrl: 'https://x/r1.jpg', backups: [] },
    action: { id: 'a1', imageUrl: 'https://x/a1.jpg', backups: [] },
    context: { id: 'ctx_realface', imageUrl: 'https://x/ctx_realface.jpg', backups: [], person: 'ไรเดอร์เอ' },
    circle: { id: 'c1', imageUrl: 'https://x/c1.jpg', backups: [] },
  });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'reaction', 'action', 'context', 'circle'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => {
          if (i === 0) return { index: 0, textFound: '', faceBox: { x1: 0.3, y1: 0.1, x2: 0.6, y2: 0.4 }, faceCount: 1, faceVisible: 1 }; // hero: หมวกบัง
          if (i === 3) return { index: 3, textFound: '', faceBox: { x1: 0.2, y1: 0.1, x2: 0.7, y2: 0.6 }, faceCount: 1, faceVisible: 2, sameAsHeroPerson: true }; // context primary: หน้าเต็ม คนเดียวกับ hero
          return { index: i, textFound: '', faceBox: null, faceCount: 0, faceVisible: 0, sameAsHeroPerson: false };
        }),
      }),
    },
  });
  assert.equal(slots.hero.id, 'ctx_realface', 'hero ต้องได้ภาพหน้าเต็มจากช่อง context');
  assert.equal(slots.context.id, 'h_helmet', 'ช่อง context (เจ้าของ candidate เดิม) ต้องได้ภาพ hero เดิม (หมวก) กลับไปแทน — ห้ามว่าง/ห้ามซ้ำ');
  assert.equal(slots.hero.imageUrl, 'https://x/ctx_realface.jpg');
  assert.equal(slots.context.imageUrl, 'https://x/h_helmet.jpg');
  assert.ok(slots.hero._secondEyeSwapped?.reason.includes('two_way_swap_with:context'), 'ต้องบันทึกว่าสลับสองทางกับช่องไหน');
  assert.ok(slots.context._secondEyeSwapped?.reason.includes('two_way_swap_with_hero'), 'ช่อง context ต้องบันทึกว่ารับภาพ hero เดิมมา');
  assert.deepEqual(slots.context._secondEyeFaceBox, { x1: 0.3, y1: 0.1, x2: 0.6, y2: 0.4 }, 'ช่อง context ต้องได้ faceBox ของภาพ hero เดิม (ไม่ใช่ค่าเก่าของตัวเอง)');
  const _allIds = ['hero', 'reaction', 'action', 'context', 'circle'].map((rr) => slots[rr].id);
  assert.equal(new Set(_allIds).size, 5, `id ทั้ง 5 ช่องต้องไม่ซ้ำกันเลย (ได้ ${JSON.stringify(_allIds)})`);
  assert.equal(r.swapped, 1);
});

await test('เคสไรเดอร์ (ผู้ตรวจ Opus ข) ปกไร้คน (hero faceCount=0 + ไม่มีใบไหนในพูล sameAsHeroPerson=true) → ข้ามนโยบายบังคับสลับทั้งก้อน ไม่สลับ ไม่ติดธง hero_face_hidden', async () => {
  const records = [
    { id: 'h_object', imageUrl: 'https://x/h_object.jpg' }, // hero = ภาพวัตถุ/สถานที่ ไม่มีคนเลย
    { id: 'ctx_thing', imageUrl: 'https://x/ctx_thing.jpg' },
  ];
  const slots = mkSlots({ hero: { id: 'h_object', backups: [] }, context: { id: 'ctx_thing', backups: [] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'context'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        // ทั้งคู่ไม่มีหน้าเลย + ไม่มีใบไหนตอบ sameAsHeroPerson=true (ไม่ใช่เรื่องคนตั้งแต่ต้น)
        results: images.map((_, i) => ({ index: i, textFound: '', faceBox: null, faceCount: 0, faceVisible: 0, sameAsHeroPerson: false })),
      }),
    },
  });
  assert.equal(slots.hero.id, 'h_object', 'ปกไร้คน — hero ต้องไม่ถูกสลับแม้ faceVisible=0 (ตรงเงื่อนไข badFace) ก็ตาม');
  assert.equal(r.swapped, 0);
  assert.ok(!slots.hero._secondEyeHeroFaceHidden, 'ปกไร้คน — ต้องไม่ติดธง hero_face_hidden (ไม่ใช่ปัญหาหน้าคนไม่ชัด แต่ไม่มีคนตั้งแต่ต้น)');
  assert.ok(!slots.context._secondEyeSwapped, 'context ต้องไม่ถูกแตะเลย');
});

// ═══════ 28 ก.ค. 69 — เคส AC-0201 รอบ 2 (ผลเทสจริง MCV-ms482jxobj8): hero สำเร็จแล้วแต่ช่องย่อยพัง — เซลฟี่หมวก
// +หน้ากากใบเดิมซ้ำ 2 ช่องล่าง + ล่างซ้ายมี text ฝังใหญ่ (director ฝ่าฝืนกติกา prompt ได้เรื่อยๆ) → บังคับเชิงกลไก
// ผ่าน duplicateOfIndex + นโยบายกันช็อตซ้ำ/text ทับใหญ่ในช่องย่อย (ทำงานหลัง hero policy จบสนิทแล้วเท่านั้น) ═══════

await test('AC-0201 รอบ 2 (ก): ช็อตซ้ำระหว่าง action↔context (duplicateOfIndex เท่ากัน tie-break เก็บใบแรกตามลำดับ canonical) + มี backup ผ่านเกณฑ์ → แทนจริง + id ทั้ง 5 ช่องไม่ซ้ำกันเลย', async () => {
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg' },
    { id: 'r1', imageUrl: 'https://x/r1.jpg' },
    { id: 'a1', imageUrl: 'https://x/a1.jpg' }, // เซลฟี่หมวก+หน้ากาก (ต้นฉบับ)
    { id: 'c1', imageUrl: 'https://x/c1.jpg' }, // เซลฟี่หมวก+หน้ากากใบเดิมซ้ำ (คนละ id แต่ฉาก/ช็อตเดียวกัน)
    { id: 'ci1', imageUrl: 'https://x/ci1.jpg' },
    { id: 'c1_backup', imageUrl: 'https://x/c1_backup.jpg', triage: { person: 'คนละคน' } },
  ];
  const slots = mkSlots({
    hero: { id: 'h1', backups: [] },
    reaction: { id: 'r1', backups: [] },
    action: { id: 'a1', backups: [] },
    context: { id: 'c1', backups: ['c1_backup'] },
    circle: { id: 'ci1', backups: [] },
  });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'reaction', 'action', 'context', 'circle'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => {
          if (i === 3) return { index: 3, textFound: '', faceBox: null, faceCount: 0, faceVisible: 0, duplicateOfIndex: 2 }; // context ซ้ำกับ action (index 2)
          return { index: i, textFound: '', faceBox: null, faceCount: 0, faceVisible: 0, duplicateOfIndex: null };
        }),
      }),
    },
  });
  assert.equal(slots.action.id, 'a1', 'action (มาก่อนตามลำดับ canonical) ต้องยังคงเดิม');
  assert.equal(slots.context.id, 'c1_backup', 'context (ผู้แพ้ tie-break) ต้องถูกแทนด้วย backup ที่ผ่านเกณฑ์');
  assert.equal(r.subSlotReplaced, 1, 'ต้องนับว่าแทนช่องย่อยไป 1 ใบ');
  const _allIds = ['hero', 'reaction', 'action', 'context', 'circle'].map((rr) => slots[rr].id);
  assert.equal(new Set(_allIds).size, 5, `id ทั้ง 5 ช่องต้องไม่ซ้ำกันเลย (ได้ ${JSON.stringify(_allIds)})`);
  assert.ok(!slots.context._secondEyeSubSlotFlag, 'แทนสำเร็จ = ไม่ติดธง');
});

await test('AC-0201 รอบ 2 (ข): ช็อตซ้ำระหว่างช่องย่อย แต่ไม่มี backup ผ่านเกณฑ์เลย → คงภาพเดิม + ติดธง subslot_duplicate_shot', async () => {
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg' },
    { id: 'r1', imageUrl: 'https://x/r1.jpg' },
    { id: 'a1', imageUrl: 'https://x/a1.jpg' },
    { id: 'c1', imageUrl: 'https://x/c1.jpg' }, // ไม่มี backup ให้แทนเลย
    { id: 'ci1', imageUrl: 'https://x/ci1.jpg' },
  ];
  const slots = mkSlots({
    hero: { id: 'h1', backups: [] }, reaction: { id: 'r1', backups: [] },
    action: { id: 'a1', backups: [] }, context: { id: 'c1', backups: [] }, circle: { id: 'ci1', backups: [] },
  });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'reaction', 'action', 'context', 'circle'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => {
          if (i === 3) return { index: 3, textFound: '', faceBox: null, faceCount: 0, faceVisible: 0, duplicateOfIndex: 2 };
          return { index: i, textFound: '', faceBox: null, faceCount: 0, faceVisible: 0, duplicateOfIndex: null };
        }),
      }),
    },
  });
  assert.equal(slots.context.id, 'c1', 'ไม่มี backup ผ่านเกณฑ์ → ต้องคงภาพเดิม');
  assert.equal(r.subSlotReplaced, 0);
  assert.equal(slots.context._secondEyeSubSlotFlag, 'subslot_duplicate_shot', 'ต้องติดธง subslot_duplicate_shot');
});

await test('AC-0201 รอบ 2 (ค1): ช่องย่อย (ไม่ใช่ hero) textOverlay≥2 (text ฝังใหญ่) + ตัวเองไม่มี backup แต่พูลรวมมี backup สะอาดของช่องอื่น → แทนจริงข้ามช่อง (พิสูจน์ pass 2 หาข้ามพูลได้ ต่างจากนโยบายเดิมที่หากันแค่ backup ของตัวเอง)', async () => {
  const LONG_TEXT = 'BREAKING NEWS HEADLINE BAR TEXT'; // >20 ตัวอักษร → derive textOverlay=2
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg' },
    { id: 'r1', imageUrl: 'https://x/r1.jpg' },
    { id: 'a1', imageUrl: 'https://x/a1.jpg' }, // text ฝังใหญ่ — action เองไม่มี backup ให้ตัวเอง
    { id: 'c1', imageUrl: 'https://x/c1.jpg' },
    { id: 'ci1', imageUrl: 'https://x/ci1.jpg' },
    { id: 'spare_backup', imageUrl: 'https://x/spare_backup.jpg' }, // backup ของ circle แต่สะอาด ใช้แทน action ข้ามช่องได้
  ];
  const slots = mkSlots({
    hero: { id: 'h1', backups: [] }, reaction: { id: 'r1', backups: [] },
    action: { id: 'a1', backups: [] }, context: { id: 'c1', backups: [] }, circle: { id: 'ci1', backups: ['spare_backup'] },
  });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'reaction', 'action', 'context', 'circle'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => (i === 2
          ? { index: 2, textFound: LONG_TEXT, faceBox: null, faceCount: 0, faceVisible: 0, duplicateOfIndex: null }
          : { index: i, textFound: '', faceBox: null, faceCount: 0, faceVisible: 0, duplicateOfIndex: null }
        )),
      }),
    },
  });
  assert.equal(slots.action.id, 'spare_backup', 'action ไม่มี backup ของตัวเอง แต่พูลรวมมี backup สะอาดของ circle → ต้องถูกแทนข้ามช่อง');
  assert.equal(slots.circle.id, 'ci1', 'circle (เจ้าของ backup ที่ถูกยืมไปใช้) ต้องยังคงภาพเดิมของตัวเอง — ไม่ใช่สลับสองทาง (candidate เป็น backup ไม่ใช่ primary ของช่องอื่น)');
  assert.equal(r.subSlotReplaced, 1);
  assert.ok(!slots.action._secondEyeSubSlotFlag, 'แทนสำเร็จ = ไม่ติดธง');
  const _allIds = ['hero', 'reaction', 'action', 'context', 'circle'].map((rr) => slots[rr].id);
  assert.equal(new Set(_allIds).size, 5, `id ทั้ง 5 ช่องต้องไม่ซ้ำกันเลย (ได้ ${JSON.stringify(_allIds)})`);
});

await test('AC-0201 รอบ 2 (ค2): ช่องย่อย textOverlay≥2 แต่ไม่มี backup เลย → คงภาพเดิม + ติดธง subslot_text_overlay', async () => {
  const LONG_TEXT = 'BREAKING NEWS HEADLINE BAR TEXT';
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg' }, { id: 'r1', imageUrl: 'https://x/r1.jpg' },
    { id: 'a1', imageUrl: 'https://x/a1.jpg' }, { id: 'c1', imageUrl: 'https://x/c1.jpg' }, { id: 'ci1', imageUrl: 'https://x/ci1.jpg' },
  ];
  const slots = mkSlots({
    hero: { id: 'h1', backups: [] }, reaction: { id: 'r1', backups: [] },
    action: { id: 'a1', backups: [] }, context: { id: 'c1', backups: [] }, circle: { id: 'ci1', backups: [] },
  });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'reaction', 'action', 'context', 'circle'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => (i === 2
          ? { index: 2, textFound: LONG_TEXT, faceBox: null, faceCount: 0, faceVisible: 0, duplicateOfIndex: null }
          : { index: i, textFound: '', faceBox: null, faceCount: 0, faceVisible: 0, duplicateOfIndex: null }
        )),
      }),
    },
  });
  assert.equal(slots.action.id, 'a1');
  assert.equal(r.subSlotReplaced, 0);
  assert.equal(slots.action._secondEyeSubSlotFlag, 'subslot_text_overlay');
});

await test('AC-0201 รอบ 2 (ง): hero ใช้ backup ไปแล้วในนโยบาย hero แข็ง (pass 1) → นโยบายช่องย่อย (pass 2) ต้องไม่หยิบภาพเดียวกันซ้ำ แม้จะเป็น backup ตัวเดียวที่มีในพูล', async () => {
  const LONG_TEXT = 'BREAKING NEWS HEADLINE BAR TEXT';
  const records = [
    { id: 'h_masked', imageUrl: 'https://x/h_masked.jpg' },
    { id: 'r1', imageUrl: 'https://x/r1.jpg' },
    { id: 'a_bad', imageUrl: 'https://x/a_bad.jpg' }, // text ฝังใหญ่ ไม่มี backup ของตัวเอง
    { id: 'c1', imageUrl: 'https://x/c1.jpg' },
    { id: 'ci1', imageUrl: 'https://x/ci1.jpg' },
    { id: 'hero_backup', imageUrl: 'https://x/hero_backup.jpg' }, // backup ตัวเดียวในพูลทั้งหมด — hero ใช้ไปก่อน
  ];
  const slots = mkSlots({
    hero: { id: 'h_masked', backups: ['hero_backup'] },
    reaction: { id: 'r1', backups: [] },
    action: { id: 'a_bad', backups: [] },
    context: { id: 'c1', backups: [] },
    circle: { id: 'ci1', backups: [] },
  });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'reaction', 'action', 'context', 'circle'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => {
          if (i === 0) return { index: 0, textFound: '', faceBox: null, faceCount: 1, faceVisible: 1, duplicateOfIndex: null }; // hero: หน้าถูกบัง
          if (i === 2) return { index: 2, textFound: LONG_TEXT, faceBox: null, faceCount: 0, faceVisible: 0, duplicateOfIndex: null }; // action: text ฝังใหญ่
          if (i === 5) return { index: 5, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2, sameAsHeroPerson: true, duplicateOfIndex: null }; // hero_backup: หน้าเต็ม คนเดียวกับ hero
          return { index: i, textFound: '', faceBox: null, faceCount: 0, faceVisible: 0, duplicateOfIndex: null };
        }),
      }),
    },
  });
  // hero ต้องสลับไปใช้ hero_backup สำเร็จก่อน (pass 1)
  assert.equal(slots.hero.id, 'hero_backup', 'hero ต้องใช้ backup ตัวเดียวในพูลไปแล้ว');
  // action ยังคง text ฝังใหญ่ — พูลไม่มี backup อื่นเหลือให้แทนเลย (ตัวเดียวถูก hero ใช้ไปแล้ว) → ต้องคงเดิม+ติดธง ไม่ใช่หยิบ hero_backup ซ้ำ
  assert.equal(slots.action.id, 'a_bad', 'action ต้องไม่หยิบ hero_backup ซ้ำ (hero ใช้ไปแล้ว) — ต้องคงภาพเดิม');
  assert.equal(slots.action._secondEyeSubSlotFlag, 'subslot_text_overlay', 'ไม่มี backup เหลือให้แทน (ตัวเดียวถูก hero ใช้ไปแล้ว) → ติดธง');
  const _allIds = ['hero', 'reaction', 'action', 'context', 'circle'].map((rr) => slots[rr].id);
  assert.equal(new Set(_allIds).size, 5, `id ทั้ง 5 ช่องต้องไม่ซ้ำกันเลย (ได้ ${JSON.stringify(_allIds)})`);
});

await test('AC-0201 รอบ 2 (จ): ทุกช่องดีอยู่แล้ว (ไม่มีช็อตซ้ำ ไม่มี text ทับใหญ่) → นโยบายช่องย่อย pass 2 ไม่ทำอะไรเลย (byte-parity — เทียบเท่า "ปิดสวิตช์" เมื่อไม่มีอะไรต้องแก้)', async () => {
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg' }, { id: 'r1', imageUrl: 'https://x/r1.jpg' },
    { id: 'a1', imageUrl: 'https://x/a1.jpg' }, { id: 'c1', imageUrl: 'https://x/c1.jpg' }, { id: 'ci1', imageUrl: 'https://x/ci1.jpg' },
  ];
  const slots = mkSlots({
    hero: { id: 'h1', backups: [] }, reaction: { id: 'r1', backups: [] },
    action: { id: 'a1', backups: [] }, context: { id: 'c1', backups: [] }, circle: { id: 'ci1', backups: [] },
  });
  const before = JSON.parse(JSON.stringify(slots));
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'reaction', 'action', 'context', 'circle'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => ({ index: i, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2, sameAsHeroPerson: i === 0 ? undefined : false, duplicateOfIndex: null })),
      }),
    },
  });
  assert.equal(r.subSlotReplaced, 0, 'ไม่มีอะไรต้องแก้ → subSlotReplaced ต้องเป็น 0');
  for (const role of ['hero', 'reaction', 'action', 'context', 'circle']) {
    assert.equal(slots[role].id, before[role].id, `${role}.id ต้องไม่เปลี่ยนเลย`);
    assert.ok(!slots[role]._secondEyeSubSlotFlag, `${role} ต้องไม่ติดธง sub-slot ใดๆ`);
    assert.ok(!slots[role]._secondEyeSwapped, `${role} ต้องไม่มี record การสลับ`);
  }
});

// ═══════════════════ 28 ก.ค. 69 — "หาวิธีให้ตาไม่โกหก" 5 กลไก: เทสเพิ่ม (ก)(ค) ═══════════════════

await test('(ก) จับตาแรกโกหก → เรียก setTriage แก้คลังถาวรจริง (merge-safe: คงฟิลด์เดิม + clean:false + note มี textFound) พร้อม caseId', async () => {
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg', triage: { person: 'เอ', category: 'ข่าวทั่วไป' } },
    { id: 'hb1', imageUrl: 'https://x/hb1.jpg', triage: { person: 'บี' } },
  ];
  const slots = mkSlots({ hero: { id: 'h1', backups: ['hb1'], person: 'เอ' } });
  let setTriageCalls = [];
  const r = await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records), caseId: 'AC-0195',
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => ({ index: i, textFound: i === 0 ? LONG_TEXT : '', faceBox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5 }, faceCount: 1 })),
      }),
      setTriage: async (caseId, patch) => { setTriageCalls.push({ caseId, patch }); },
    },
  });
  assert.equal(r.liesCaught, 1);
  assert.equal(setTriageCalls.length, 1, 'ต้องเรียก setTriage 1 ครั้ง');
  assert.equal(setTriageCalls[0].caseId, 'AC-0195');
  const patch = setTriageCalls[0].patch.h1;
  assert.ok(patch, 'patch ต้องมีของ h1');
  assert.equal(patch.person, 'เอ', 'ฟิลด์เดิม (person) ต้องยังอยู่ — merge-safe ไม่ทับทั้งก้อน');
  assert.equal(patch.category, 'ข่าวทั่วไป', 'ฟิลด์เดิม (category) ต้องยังอยู่');
  assert.equal(patch.clean, false, 'ต้องแก้เป็น clean:false');
  assert.ok(patch.note && patch.note.includes(LONG_TEXT.slice(0, 20)), 'note ต้องมีข้อความ textFound ที่อ่านได้จริงแนบมาด้วย');
});

await test('(ก) ไม่มี caseId → ไม่เรียก setTriage เลย (กันพังกรณีไม่รู้จะแก้คลังไหน) แต่ liesCaught ยังนับถูกต้อง', async () => {
  const records = [{ id: 'h1', imageUrl: 'https://x/h1.jpg', triage: { person: 'เอ' } }];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] } });
  let setTriageCalled = false;
  const r = await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records), // ไม่ส่ง caseId
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async () => ({ results: [{ index: 0, textFound: LONG_TEXT, faceBox: null, faceCount: 0 }] }),
      setTriage: async () => { setTriageCalled = true; },
    },
  });
  assert.equal(r.liesCaught, 1);
  assert.ok(!setTriageCalled, 'ไม่มี caseId → ห้ามเรียก setTriage');
});

await test('(ก) triage เดิมบอก clean:false อยู่แล้ว (ไม่ได้อ้างว่า clean) → ไม่นับว่าจับโกหก แม้ textFound ยาว (ตาแรกไม่ได้โกหก เพราะบอกไว้แล้วว่าไม่คลีน)', async () => {
  const records = [{ id: 'h1', imageUrl: 'https://x/h1.jpg', triage: { person: 'เอ', clean: false } }];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records), caseId: 'AC-0195',
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async () => ({ results: [{ index: 0, textFound: LONG_TEXT, faceBox: null, faceCount: 0 }] }),
      setTriage: async () => { throw new Error('ไม่ควรถูกเรียก'); },
    },
  });
  assert.equal(r.liesCaught, 0, 'triage เดิมบอกไม่ clean อยู่แล้ว = ไม่ใช่การโกหกใหม่');
});

await test('(ก)+(ข้อ5 อายุความ) ภาพยุคเก่าไม่มีฟิลด์รุ่นใหม่เลย (ไม่มี busy/clean/note ใดๆ) → ยังถูกตรวจปกติ ไม่ถูกข้าม และยังจับโกหกได้ตามปกติ', async () => {
  const records = [{ id: 'h1', imageUrl: 'https://x/h1.jpg', triage: { person: 'เก่ามาก' } }]; // ไม่มี busy/clean เลย
  const slots = mkSlots({ hero: { id: 'h1', backups: [] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records), caseId: 'AC-OLD',
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async () => ({ results: [{ index: 0, textFound: LONG_TEXT, faceBox: null, faceCount: 0 }] }),
      setTriage: async () => {},
    },
  });
  assert.equal(r.checked, 1, 'ภาพยุคเก่าต้องถูกตรวจ ไม่ถูก gate ออกไปเฉยๆ');
  assert.equal(r.liesCaught, 1, 'ไม่มี clean:false ชัดเจน = ถือว่าอ้าง clean โดย default → ยังจับโกหกได้เหมือนภาพยุคใหม่');
});

await test('(ค) MEGA_SECOND_EYE_MODEL ไม่ตั้ง → ใช้ COVER_GEMINI_MODEL เดิม (โมเดลเดียวกับตาคัด/ตาหาหน้าทั้งสาย)', async () => {
  const records = [{ id: 'h1', imageUrl: 'https://x/h1.jpg' }];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] } });
  let capturedModel = null;
  await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ model }) => { capturedModel = model; return { results: [{ index: 0, textFound: '', faceBox: null, faceCount: 0 }] }; },
    },
  });
  assert.equal(capturedModel, COVER_GEMINI_MODEL, 'ไม่ตั้ง env override ต้องได้ COVER_GEMINI_MODEL เดิม');
});

await test('(ค) MEGA_SECOND_EYE_MODEL ตั้งไว้ → override เป็นโมเดลที่สั่ง (แรงกว่าได้ ต้นทุนจิ๊บแค่ 5-8 ภาพ/ปก)', async () => {
  process.env.MEGA_SECOND_EYE_MODEL = 'gemini-9-ultra-test';
  const records = [{ id: 'h1', imageUrl: 'https://x/h1.jpg' }];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] } });
  let capturedModel = null;
  await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ model }) => { capturedModel = model; return { results: [{ index: 0, textFound: '', faceBox: null, faceCount: 0 }] }; },
    },
  });
  delete process.env.MEGA_SECOND_EYE_MODEL;
  assert.equal(capturedModel, 'gemini-9-ultra-test', 'ต้องใช้โมเดลจาก env override');
});

await test('(การ์ดที่ 5, 28 ก.ค. 69) prompt ตาสองที่ส่งจริงขึ้นต้นด้วย AI_HONESTY_DNA เมื่อ AI_HONESTY_DNA เปิด (default)', async () => {
  const records = [{ id: 'h1', imageUrl: 'https://x/h1.jpg' }];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] } });
  let capturedPrompt = null;
  await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ prompt }) => { capturedPrompt = prompt; return { results: [{ index: 0, textFound: '', faceBox: null, faceCount: 0 }] }; },
    },
  });
  assert.equal(capturedPrompt.indexOf(AI_HONESTY_DNA), 0, 'prompt ตาสองต้องขึ้นต้นด้วย DNA เมื่อเปิด');
});

await test('(การ์ดที่ 5) AI_HONESTY_DNA=0 → prompt ตาสองไม่มี DNA เลย (byte-parity)', async () => {
  process.env.AI_HONESTY_DNA = '0';
  const records = [{ id: 'h1', imageUrl: 'https://x/h1.jpg' }];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] } });
  let capturedPrompt = null;
  await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ prompt }) => { capturedPrompt = prompt; return { results: [{ index: 0, textFound: '', faceBox: null, faceCount: 0 }] }; },
    },
  });
  delete process.env.AI_HONESTY_DNA;
  assert.ok(!capturedPrompt.includes(AI_HONESTY_DNA), 'ปิดสวิตช์ต้องไม่มี DNA เลย');
  assert.ok(capturedPrompt.startsWith('คุณเป็นตาตรวจสอบภาพปกข่าวรอบสอง'), 'ปิดสวิตช์ต้องขึ้นต้นด้วย prompt เดิมเป๊ะ');
});

await test('(ค) callGeminiVision throw → _runSecondEye ปล่อย error ออกไปตรงๆ ไม่กลืนเงียบ (ผู้เรียกจริง s6_slots ครอบ try/catch fail-open เอง)', async () => {
  const records = [{ id: 'h1', imageUrl: 'https://x/h1.jpg' }];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] } });
  await assert.rejects(
    () => _runSecondEye({
      slots, activeSlots: ['hero'], byId: mkById(records),
      _deps: { fetchImageB64: mkFetch(), callGeminiVision: async () => { throw new Error('Gemini timeout จำลอง'); } },
    }),
    /Gemini timeout จำลอง/,
    'error ต้อง propagate ออกมา ไม่ถูกกลืนเงียบในฟังก์ชันนี้',
  );
  assert.ok(!slots.hero._secondEyeFaceBox, 'ไม่มีผลตรวจ (ล้มก่อนถึง) → ไม่แนบอะไรเลย');
});

console.log(`\n# mega-second-eye: ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
