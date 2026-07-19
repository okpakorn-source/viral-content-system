// ============================================================
// 🧪 MEGA_CLUTTER_GUARD — มือ C: megaBrains.js slotDirectorBrain prompt
// ------------------------------------------------------------
// เลียนแบบ _hasFaceH เป๊ะ: local var _hasBusy = imagesMeta บางใบมี field `busy` (number) จริง
// ไม่มีสวิตช์ env — ไฟล์นี้ไม่อ่าน process.env ที่ไหนเลย ตรวจจาก "ข้อมูลจริงที่ส่งมา" เท่านั้น
//
// พิสูจน์:
//   (1) imagesMeta ไม่มีใบไหนมี field busy เลย → prompt ไม่มีคำว่า busy / กฎ (13) เลย (byte-parity)
//   (2) imagesMeta มีใบที่มี field busy → prompt เติมกฎ (13) เข้าไป (ช่องย่อยเลี่ยง busy=2, circle=busy 0-1,
//       เมื่อ story ใกล้กันเลือก busy ต่ำก่อน)
//   (3) โครงสร้าง byte-identical: system(มี busy) ต้องเท่ากับ system(ไม่มี busy) + บล็อกกฎ (13) เป๊ะ
//       (พิสูจน์ว่ากฎเดิม (1)-(12) ไม่ถูกแตะแม้ตัวอักษรเดียว)
//   (4) ไม่ regress กฎ faceH (ข้อ 12): มี faceH อย่างเดียว (ไม่มี busy) → ยังมี (12) แต่ไม่มี (13)
//   (5) มีทั้ง faceH และ busy → มีทั้ง (12) และ (13)
// ============================================================
import { test } from 'node:test';
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

const { slotDirectorBrain } = await import('@/lib/megaBrains');

// จับ "system" ที่ถูกส่งเข้า callBrain จริง (ผ่าน _deps.callBrain — จุดฉีดสำหรับเทสเท่านั้น ตามคอมเมนต์ SEM-1 ในไฟล์)
async function captureSystem(imagesMeta) {
  let captured = null;
  const stubCallBrain = async ({ system }) => {
    captured = system;
    return { text: JSON.stringify({ slots: { hero: { id: null }, reaction: { id: null }, action: { id: null }, context: { id: null }, circle: { id: null } }, note: 'stub' }) };
  };
  await slotDirectorBrain({
    imagesMeta,
    compass: { angle: 'ทดสอบ', primaryEmotion: 'neutral', secondaryEmotions: [], mainCharacters: [], visualDreamShots: [], doNotUse: [] },
    deskTitle: 'ข่าวทดสอบ clutter guard',
    _deps: { callBrain: stubCallBrain },
  });
  assert.ok(typeof captured === 'string' && captured.length > 0, 'ต้องจับ system prompt ได้จริง');
  return captured;
}

const noBusyMeta = [{ id: 'IMG1', quality: 8, clean: true }];
const withBusyMeta = [{ id: 'IMG1', quality: 8, clean: true, busy: 2 }];
const faceHOnlyMeta = [{ id: 'IMG1', quality: 8, faceH: 0.4 }];
const bothMeta = [{ id: 'IMG1', quality: 8, faceH: 0.4, busy: 1 }];

test('ไม่มีใบไหนมี field busy → prompt ไม่มีคำว่า busy เลย (byte-parity)', async () => {
  const system = await captureSystem(noBusyMeta);
  assert.ok(!/busy/i.test(system), 'prompt ต้องไม่มีคำว่า busy เมื่อ imagesMeta ไม่มี field นี้');
  assert.ok(!system.includes('(13)'), 'prompt ต้องไม่มีกฎข้อ (13) เมื่อไม่มี busy');
});

test('มีใบที่มี field busy → prompt เติมกฎ (13) ช่องย่อยเลี่ยง busy=2 / circle=busy 0-1 / เลือก busy ต่ำก่อน', async () => {
  const system = await captureSystem(withBusyMeta);
  assert.ok(system.includes('(13)'), 'prompt ต้องมีกฎข้อ (13) เมื่อมี busy');
  assert.match(system, /busy=2/, 'ต้องพูดถึงการเลี่ยง busy=2 สำหรับช่องย่อย');
  assert.match(system, /reaction\/action\/context\/circle/, 'ต้องระบุช่องย่อย reaction/action/context/circle');
  assert.match(system, /circle ต้องเป็นคนเดี่ยวโฟกัสชัด \(busy 0-1\)/, 'circle ต้องบังคับ busy 0-1 (คนเดี่ยวโฟกัสชัด)');
  assert.match(system, /เลือกใบ busy ต่ำกว่าก่อนเสมอ/, 'เมื่อ story ใกล้กันต้องเลือก busy ต่ำก่อน');
});

test('โครงสร้าง byte-identical: system(มี busy) = system(ไม่มี busy) + บล็อกกฎ (13) เป๊ะ', async () => {
  const systemNoBusy = await captureSystem(noBusyMeta);
  const systemWithBusy = await captureSystem(withBusyMeta);
  const MARK = '\nตอบ JSON เท่านั้น:';
  assert.ok(systemNoBusy.includes(MARK), 'baseline ต้องมี marker ท้าย prompt');
  const idx = systemNoBusy.indexOf(MARK);
  const headBefore = systemNoBusy.slice(0, idx);
  const tailAfter = systemNoBusy.slice(idx);
  const reconstructed = systemWithBusy.slice(0, headBefore.length) === headBefore
    ? systemWithBusy
    : null;
  // การพิสูจน์ตรงไปตรงมา: ตัดบล็อก (13) ออกจาก systemWithBusy ต้องได้ systemNoBusy เป๊ะ (ตัวอักษรต่อตัวอักษร)
  const busyBlockMatch = systemWithBusy.match(/\n\(13\)[^\n]*/);
  assert.ok(busyBlockMatch, 'ต้องเจอบล็อกกฎ (13) ใน system(มี busy)');
  const withoutBusyBlock = systemWithBusy.replace(busyBlockMatch[0], '');
  assert.equal(withoutBusyBlock, systemNoBusy, 'ตัดบล็อก (13) ออกแล้วต้องเหลือ byte-identical กับ prompt ไม่มี busy — พิสูจน์ว่ากฎ (1)-(12) เดิมไม่ถูกแตะแม้ตัวอักษรเดียว');
  assert.ok(headBefore.length > 0 && tailAfter.length > 0); // ใช้ตัวแปรกันเทสเตือน unused (เอกสารการพิสูจน์)
  void reconstructed;
});

test('ไม่ regress กฎ faceH ข้อ (12): มี faceH อย่างเดียว (ไม่มี busy) → ยังมี (12) แต่ไม่มี (13)', async () => {
  const system = await captureSystem(faceHOnlyMeta);
  assert.ok(system.includes('(12)'), 'กฎ faceH (12) ต้องยังทำงานเหมือนเดิม');
  assert.match(system, /faceH สูงก่อนเสมอ/, 'ข้อความกฎ faceH เดิมต้องอยู่ครบ');
  assert.ok(!system.includes('(13)'), 'ไม่มี busy → ต้องไม่มีกฎ (13)');
  assert.ok(!/busy/i.test(system), 'ไม่มี busy → ห้ามมีคำว่า busy โผล่มาเลย');
});

test('มีทั้ง faceH และ busy → prompt มีทั้งกฎ (12) และ (13)', async () => {
  const system = await captureSystem(bothMeta);
  assert.ok(system.includes('(12)'), 'ต้องมีกฎ faceH (12)');
  assert.ok(system.includes('(13)'), 'ต้องมีกฎ busy (13)');
});
