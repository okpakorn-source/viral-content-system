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

await test('เพดานสำรอง ≤3 ใบ: 5 ช่องหลักมีสำรองครบทุกช่อง → ส่งภาพรวม 5+3=8 ใบเท่านั้น (ไม่ใช่ 10)', async () => {
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
  assert.equal(capturedCount, 8, `ต้องส่งแค่ 5 หลัก + 3 สำรอง (เพดานงบ) = 8 (ได้ ${capturedCount})`);
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
