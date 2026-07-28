// ============================================================
// 💧 MEGA_WATERMARK_GUARD — C1 (29 ก.ค. 69, แบตช์ C "ด่านลายน้ำ") — _runSecondEye (megaAdapters.js)
// ------------------------------------------------------------
// C1: ตาสอง (S6) เพิ่ม field `watermark` ต่อภาพ "ใน call เดิม" (ไม่มี call ใหม่ — แพทเทิร์นเดียวกับ faceFront/
//   _frontalOn ที่มีอยู่แล้ว) — {pos, strength} หรือ null:
//   (ก) center+strength2 → เข้าเกณฑ์ forced-replace (ใช้ _swapRoleImageMechanic/_findWatermarkSafeReplacementIndex
//       เดียวกับปาส (ก)/(ข) sub-slot เดิมเป๊ะ — ทุกช่อง รวม hero) ไม่มี backup สะอาด → คงเดิม + slots[role].
//       _secondEyeWatermarkFlag='watermark_kept'
//   (ข) edge-* → แนบ slots[role]._watermarkEdge={side,strengthPct} ให้ C2 (executor) หลบครอปเอง — ไม่บังคับเปลี่ยนภาพ
//   ปิด MEGA_WATERMARK_GUARD=0 → ไม่มี field ใน prompt เลย (byte-parity) + ไม่มีผลอะไรจาก field นี้แม้ผลลัพธ์ปลอม
//   จะพยายามใส่ watermark มาก็ตาม (byIndex ไม่รับ field เข้ามาเลยตอนปิด)
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
const setEnv = (key, v) => { if (v === null) delete process.env[key]; else process.env[key] = v; };

const mkFetch = () => async () => ({ data: 'ZmFrZQ==', mimeType: 'image/jpeg' });
const mkById = (records) => new Map(records.map((r) => [String(r.id), r]));
const mkSlots = (picks) => Object.fromEntries(Object.entries(picks).map(([role, p]) => [role, { ...p }]));
const ROLES5 = ['hero', 'reaction', 'action', 'context', 'circle'];

await test('C1(ก)-1: hero watermark center+strength2 + backup สะอาด (ไม่มีลายน้ำเลย) → forced-replace จริง (field-transfer ครบ + นับ watermarkReplaced)', async () => {
  setEnv('MEGA_WATERMARK_GUARD', null); // default ON
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
        results: images.map((_, i) => ({
          index: i, textFound: '', faceBox: null, faceCount: 0,
          watermark: i === 0 ? { pos: 'center', strength: 2 } : null,
          // ★ แก้ 29 ก.ค. 69 (Opus): hero forced-replace ต้องผ่านเกณฑ์ hero เดิมด้วย (faceVisible=2 + sameAsHeroPerson=true)
          ...(i === 1 ? { faceVisible: 2, sameAsHeroPerson: true } : {}),
        })),
      }),
    },
  });
  assert.equal(slots.hero.id, 'hb1', 'hero ต้องสลับไปใช้ backup สะอาด');
  assert.equal(slots.hero.imageUrl, 'https://x/hb1.jpg');
  assert.equal(slots.hero.person, 'บี');
  assert.ok(slots.hero._secondEyeSwapped?.reason.includes('watermark_center_forced_replace'), 'ต้องบันทึกเหตุผลว่าสลับเพราะลายน้ำกลาง');
  assert.ok(!slots.hero._secondEyeWatermarkFlag, 'สลับสำเร็จ = ไม่ติดธง watermark_kept');
  assert.equal(r.watermarkReplaced, 1, 'ต้องนับว่าแทนเพราะลายน้ำไป 1 ใบ');
});

await test('C1(ก)-2: hero watermark center+strength2 + ไม่มี backup เลย → คงเดิม + ติดธง watermark_kept', async () => {
  setEnv('MEGA_WATERMARK_GUARD', null);
  const records = [{ id: 'h1', imageUrl: 'https://x/h1.jpg' }];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async () => ({ results: [{ index: 0, textFound: '', faceBox: null, faceCount: 0, watermark: { pos: 'center', strength: 2 } }] }),
    },
  });
  assert.equal(slots.hero.id, 'h1', 'ไม่มี backup → ต้องคงภาพเดิม');
  assert.equal(slots.hero._secondEyeWatermarkFlag, 'watermark_kept');
  assert.equal(r.watermarkReplaced, 0);
});

await test('C1(ก)-3: candidate ที่มีลายน้ำ center+strength2 เหมือนกันต้องถูกข้าม — เลือกใบที่สะอาดกว่าแทน (ไม่ย้ายปัญหา)', async () => {
  setEnv('MEGA_WATERMARK_GUARD', null);
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg' },
    { id: 'hb_bad', imageUrl: 'https://x/hb_bad.jpg' }, // ลายน้ำกลางชัดเจนเหมือนกัน — ต้องข้าม
    { id: 'hb_good', imageUrl: 'https://x/hb_good.jpg' }, // สะอาด
  ];
  const slots = mkSlots({ hero: { id: 'h1', backups: ['hb_bad', 'hb_good'] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => {
          if (i === 0) return { index: 0, textFound: '', faceBox: null, faceCount: 0, watermark: { pos: 'center', strength: 2 } };
          if (i === 1) return { index: 1, textFound: '', faceBox: null, faceCount: 0, watermark: { pos: 'center', strength: 2 } }; // แย่เหมือนกัน
          return { index: 2, textFound: '', faceBox: null, faceCount: 0, watermark: null, faceVisible: 2, sameAsHeroPerson: true }; // สะอาด + ผ่านเกณฑ์ hero
        }),
      }),
    },
  });
  assert.equal(slots.hero.id, 'hb_good', 'ต้องข้าม candidate ที่ลายน้ำแย่พอกัน เลือกใบสะอาดแทน');
  assert.equal(r.watermarkReplaced, 1);
});

// ★★★ แก้ 29 ก.ค. 69 (Opus ตรวจแบตช์ C พบ FAIL 1 จุด): ปาส (ค) ครอบ hero ด้วย แต่ finder เดิมไม่บังคับเกณฑ์ hero
//   (faceVisible/sameAsHeroPerson) เลย — เสี่ยงสลับ hero ไปเป็นภาพหน้าไม่ชัด/คนละคน ล้มนโยบาย hero แข็ง + กฎถูกคน
//   100% ที่ระบบยึดมาตลอด → แก้เป็นบังคับ cand.faceVisible===2 && cand.sameAsHeroPerson===true เฉพาะ role==='hero'
await test('C1(ก)-4 (Opus fix): hero watermark center+strength2 + backup สะอาด (ไม่มีลายน้ำ) แต่ faceVisible=1 (หน้าไม่ชัด) → ห้ามสลับ คงเดิม + ติดธง watermark_kept', async () => {
  setEnv('MEGA_WATERMARK_GUARD', null);
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg' },
    { id: 'hb_blurface', imageUrl: 'https://x/hb_blurface.jpg' }, // สะอาดจากลายน้ำ แต่หน้าไม่ชัด — ห้ามสลับ hero ไปใช้
  ];
  const slots = mkSlots({ hero: { id: 'h1', backups: ['hb_blurface'] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => (i === 0
          ? { index: 0, textFound: '', faceBox: null, faceCount: 0, watermark: { pos: 'center', strength: 2 } }
          : { index: 1, textFound: '', faceBox: null, faceCount: 0, watermark: null, faceVisible: 1, sameAsHeroPerson: true }
        )),
      }),
    },
  });
  assert.equal(slots.hero.id, 'h1', 'faceVisible=1 (ไม่ผ่านเกณฑ์ hero) → ห้ามสลับแม้สะอาดจากลายน้ำก็ตาม');
  assert.equal(slots.hero._secondEyeWatermarkFlag, 'watermark_kept');
  assert.equal(r.watermarkReplaced, 0);
});

await test('C1(ก)-5 (Opus fix): hero watermark center+strength2 + backup สะอาด+faceVisible=2 แต่ sameAsHeroPerson=false (คนละคน) → ห้ามสลับ คงเดิม + ติดธง watermark_kept', async () => {
  setEnv('MEGA_WATERMARK_GUARD', null);
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg' },
    { id: 'hb_otherperson', imageUrl: 'https://x/hb_otherperson.jpg' }, // สะอาด+หน้าชัด แต่คนละคนกับ hero — ห้ามสลับ (กฎถูกคน 100%)
  ];
  const slots = mkSlots({ hero: { id: 'h1', backups: ['hb_otherperson'] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => (i === 0
          ? { index: 0, textFound: '', faceBox: null, faceCount: 0, watermark: { pos: 'center', strength: 2 } }
          : { index: 1, textFound: '', faceBox: null, faceCount: 0, watermark: null, faceVisible: 2, sameAsHeroPerson: false }
        )),
      }),
    },
  });
  assert.equal(slots.hero.id, 'h1', 'sameAsHeroPerson=false (คนละคน) → ห้ามสลับแม้หน้าชัด+สะอาดจากลายน้ำก็ตาม');
  assert.equal(slots.hero._secondEyeWatermarkFlag, 'watermark_kept');
  assert.equal(r.watermarkReplaced, 0);
});

await test('C1(ก)-6 (Opus fix, ตรวจซ้ำ): ช่องย่อย (ไม่ใช่ hero) ไม่ต้องผ่านเกณฑ์ faceVisible/sameAsHeroPerson (เกณฑ์นั้นเฉพาะ hero เท่านั้น) — reaction สลับได้ปกติแม้ backup ไม่มี faceVisible/sameAsHeroPerson เลย', async () => {
  setEnv('MEGA_WATERMARK_GUARD', null);
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg' },
    { id: 'r1', imageUrl: 'https://x/r1.jpg' },
    { id: 'a1', imageUrl: 'https://x/a1.jpg' },
    { id: 'c1', imageUrl: 'https://x/c1.jpg' },
    { id: 'ci1', imageUrl: 'https://x/ci1.jpg' },
    { id: 'r_backup', imageUrl: 'https://x/r_backup.jpg' },
  ];
  const slots = mkSlots({
    hero: { id: 'h1', backups: [] }, reaction: { id: 'r1', backups: ['r_backup'] },
    action: { id: 'a1', backups: [] }, context: { id: 'c1', backups: [] }, circle: { id: 'ci1', backups: [] },
  });
  const r = await _runSecondEye({
    slots, activeSlots: ROLES5, byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => (i === 1
          ? { index: 1, textFound: '', faceBox: null, faceCount: 0, watermark: { pos: 'center', strength: 2 } }
          : { index: i, textFound: '', faceBox: null, faceCount: 0, watermark: null } // ไม่มี faceVisible/sameAsHeroPerson เลย
        )),
      }),
    },
  });
  assert.equal(slots.reaction.id, 'r_backup', 'ช่องย่อยไม่ต้องผ่านเกณฑ์ hero — สลับได้ปกติ');
  assert.equal(r.watermarkReplaced, 1);
});

await test('C1(ข)-1: watermark edge-top strength2 → แนบ _watermarkEdge={side:"top",strengthPct:12} ไม่บังคับเปลี่ยนภาพ', async () => {
  setEnv('MEGA_WATERMARK_GUARD', null);
  const records = [{ id: 'h1', imageUrl: 'https://x/h1.jpg' }, { id: 'hb1', imageUrl: 'https://x/hb1.jpg' }];
  const slots = mkSlots({ hero: { id: 'h1', backups: ['hb1'] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async () => ({ results: [{ index: 0, textFound: '', faceBox: null, faceCount: 0, watermark: { pos: 'edge-top', strength: 2 } }] }),
    },
  });
  assert.equal(slots.hero.id, 'h1', 'watermark ที่ขอบ ไม่บังคับเปลี่ยนภาพ');
  assert.deepEqual(slots.hero._watermarkEdge, { side: 'top', strengthPct: 12 }, 'ต้องแนบ marker side=top (ตัด prefix edge-) strengthPct=12 (strength2)');
  assert.ok(!slots.hero._secondEyeWatermarkFlag, 'ไม่ใช่ forced-replace เคส → ไม่ติดธง watermark_kept');
  assert.equal(r.watermarkReplaced, 0);
});

await test('C1(ข)-2: watermark edge-left strength1 (จาง) → strengthPct=6 (เบากว่า strength2)', async () => {
  setEnv('MEGA_WATERMARK_GUARD', null);
  const records = [{ id: 'h1', imageUrl: 'https://x/h1.jpg' }];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] } });
  await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: { fetchImageB64: mkFetch(), callGeminiVision: async () => ({ results: [{ index: 0, textFound: '', faceBox: null, faceCount: 0, watermark: { pos: 'edge-left', strength: 1 } }] }) },
  });
  assert.deepEqual(slots.hero._watermarkEdge, { side: 'left', strengthPct: 6 });
});

await test('C1: watermark center+strength1 (จาง กลางภาพ) → ไม่เข้าเกณฑ์ forced-replace (ต้อง strength2 เท่านั้น) และไม่ใช่ edge (pos!=edge-*) → ไม่มี _watermarkEdge ด้วย', async () => {
  setEnv('MEGA_WATERMARK_GUARD', null);
  const records = [{ id: 'h1', imageUrl: 'https://x/h1.jpg' }, { id: 'hb1', imageUrl: 'https://x/hb1.jpg' }];
  const slots = mkSlots({ hero: { id: 'h1', backups: ['hb1'] } });
  await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: { fetchImageB64: mkFetch(), callGeminiVision: async () => ({ results: [{ index: 0, textFound: '', faceBox: null, faceCount: 0, watermark: { pos: 'center', strength: 1 } }] }) },
  });
  assert.equal(slots.hero.id, 'h1', 'center+strength1 ไม่ต้องบังคับสลับ');
  assert.ok(!slots.hero._secondEyeWatermarkFlag);
  assert.ok(!slots.hero._watermarkEdge, 'pos=center ไม่ใช่ edge-* → ไม่มี marker ครอป');
});

await test('C1: watermark=null (ไม่มีลายน้ำเลย) → ไม่มีธง ไม่มี marker ใดๆ', async () => {
  setEnv('MEGA_WATERMARK_GUARD', null);
  const records = [{ id: 'h1', imageUrl: 'https://x/h1.jpg' }];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] } });
  await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: { fetchImageB64: mkFetch(), callGeminiVision: async () => ({ results: [{ index: 0, textFound: '', faceBox: null, faceCount: 0, watermark: null }] }) },
  });
  assert.ok(!slots.hero._secondEyeWatermarkFlag);
  assert.ok(!slots.hero._watermarkEdge);
});

await test('C1: รูปแบบ watermark พัง (pos ไม่อยู่ใน enum / strength=3 / ชนิดผิด) → validate เป็น null ไม่เชื่อ (fail-safe เหมือน faceBox)', async () => {
  setEnv('MEGA_WATERMARK_GUARD', null);
  const badCases = [{ pos: 'somewhere', strength: 2 }, { pos: 'center', strength: 3 }, { pos: 'center', strength: '2' }, 'center', 123];
  for (const wm of badCases) {
    const records = [{ id: 'h1', imageUrl: 'https://x/h1.jpg' }];
    const slots = mkSlots({ hero: { id: 'h1', backups: [] } });
    await _runSecondEye({
      slots, activeSlots: ['hero'], byId: mkById(records),
      _deps: { fetchImageB64: mkFetch(), callGeminiVision: async () => ({ results: [{ index: 0, textFound: '', faceBox: null, faceCount: 0, watermark: wm }] }) },
    });
    assert.ok(!slots.hero._secondEyeWatermarkFlag, `รูปแบบพัง (${JSON.stringify(wm)}) ต้องไม่ทริกเกอร์ forced-replace`);
    assert.ok(!slots.hero._watermarkEdge, `รูปแบบพัง (${JSON.stringify(wm)}) ต้องไม่แนบ marker`);
  }
});

await test('C1: forced-replace ครอบคลุมช่องย่อยด้วย (ไม่ใช่แค่ hero) — reaction watermark center+strength2 + backup สะอาด → แทนจริง', async () => {
  setEnv('MEGA_WATERMARK_GUARD', null);
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg' },
    { id: 'r1', imageUrl: 'https://x/r1.jpg' },
    { id: 'a1', imageUrl: 'https://x/a1.jpg' },
    { id: 'c1', imageUrl: 'https://x/c1.jpg' },
    { id: 'ci1', imageUrl: 'https://x/ci1.jpg' },
    { id: 'r_backup', imageUrl: 'https://x/r_backup.jpg' },
  ];
  const slots = mkSlots({
    hero: { id: 'h1', backups: [] }, reaction: { id: 'r1', backups: ['r_backup'] },
    action: { id: 'a1', backups: [] }, context: { id: 'c1', backups: [] }, circle: { id: 'ci1', backups: [] },
  });
  const r = await _runSecondEye({
    slots, activeSlots: ROLES5, byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => (i === 1
          ? { index: 1, textFound: '', faceBox: null, faceCount: 0, watermark: { pos: 'center', strength: 2 } }
          : { index: i, textFound: '', faceBox: null, faceCount: 0, watermark: null }
        )),
      }),
    },
  });
  assert.equal(slots.reaction.id, 'r_backup', 'ช่องย่อย (ไม่ใช่ hero) ก็ต้องเข้าเกณฑ์ forced-replace ได้เหมือนกัน');
  assert.equal(r.watermarkReplaced, 1);
  const _allIds = ROLES5.map((rr) => slots[rr].id);
  assert.equal(new Set(_allIds).size, 5, 'id ทั้ง 5 ช่องต้องไม่ซ้ำกันเลย');
});

await test('C1: MEGA_WATERMARK_GUARD=0 → prompt ไม่มีคำว่า "watermark" เลย (byte-parity โครงสร้าง prompt) + ไม่มีผลจาก field แม้ผลลัพธ์ปลอมพยายามใส่มา', async () => {
  setEnv('MEGA_WATERMARK_GUARD', '0');
  const records = [{ id: 'h1', imageUrl: 'https://x/h1.jpg' }, { id: 'hb1', imageUrl: 'https://x/hb1.jpg' }];
  const slots = mkSlots({ hero: { id: 'h1', backups: ['hb1'] } });
  let capturedPrompt = null;
  const r = await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ prompt, images }) => {
        capturedPrompt = prompt;
        return { results: images.map((_, i) => ({ index: i, textFound: '', faceBox: null, faceCount: 0, watermark: { pos: 'center', strength: 2 } })) };
      },
    },
  });
  assert.ok(!capturedPrompt.includes('watermark'), 'ปิด flag ต้องไม่มีคำว่า watermark ใน prompt เลย');
  assert.equal(slots.hero.id, 'h1', 'ปิด flag แม้ผลลัพธ์ปลอมยัดฟิลด์ watermark มา ก็ต้องไม่มีผลอะไร (byIndex ไม่รับ field)');
  assert.ok(!slots.hero._secondEyeWatermarkFlag);
  assert.ok(!slots.hero._watermarkEdge);
  assert.equal(r.watermarkReplaced, 0);
  setEnv('MEGA_WATERMARK_GUARD', null);
});

await test('C1: default (ไม่ตั้ง env) → prompt "มี" คำว่า watermark (ตรงข้ามกับกรณีปิด — ยืนยันว่า default คือ ON)', async () => {
  setEnv('MEGA_WATERMARK_GUARD', null);
  const records = [{ id: 'h1', imageUrl: 'https://x/h1.jpg' }];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] } });
  let capturedPrompt = null;
  await _runSecondEye({
    slots, activeSlots: ['hero'], byId: mkById(records),
    _deps: { fetchImageB64: mkFetch(), callGeminiVision: async ({ prompt }) => { capturedPrompt = prompt; return { results: [{ index: 0, textFound: '', faceBox: null, faceCount: 0 }] }; } },
  });
  assert.ok(capturedPrompt.includes('watermark'), 'default ต้องมี field watermark ใน prompt (ON by default)');
});

console.log(`\n# mega-watermark-guard-c1: ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
