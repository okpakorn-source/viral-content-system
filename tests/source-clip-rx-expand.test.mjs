// ============================================================
// 🧪 source-clip-rx-expand.test.mjs — SOURCE_CLIP_RX ขยายรูปแบบวิดีโอ (เฟส A ข้อ 3)
// ------------------------------------------------------------
// ทดสอบผ่าน extractSourceClips (exported) แทนการเข้าถึง regex ตรงๆ (SOURCE_CLIP_RX ไม่ export)
// ครอบ 2 กลุ่ม:
//   (ก) ของใหม่จริง: YouTube /live/VIDEOID (ช่องว่างที่เจอจริง — ไม่เคยอยู่ใน alternative เดิมเลย)
//   (ข) รีเกรสชันล็อกของที่ "ผ่านอยู่แล้ว" ก่อนแก้ (m.youtube, si= param, FB /share/v//share/r/,
//       IG /reels/ พหูพจน์, TikTok vt.tiktok) — กันใครมาแก้แล้วถอยพังภายหลัง
//   (ค) ต้องยังปฏิเสธ IG /p/ (โพสต์ภาพ ไม่ใช่วิดีโอ) เหมือนเดิม
// ------------------------------------------------------------
// refTestPipeline.js import `@/lib/megaAdapters` และ `@/lib/services/megaComposerService` (alias '@/') ที่ระดับบนไฟล์
// — plain `node --test` resolve alias นี้เองไม่ได้ ต้องใช้ loader hook แมป '@/' → src/ จริง (แพทเทิร์นเดียวกับ
// tests/reftest-queue.test.mjs ที่ทดสอบไฟล์เดียวกันนี้อยู่แล้ว) + บอมบ์ fetch กันเผลอยิง network จริงตอน import
// ============================================================
import { test, after } from 'node:test';
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

const ORIG_FETCH_DESC = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
globalThis.fetch = () => { throw new Error('NETWORK_BOMB: global.fetch is forbidden in this test'); };
after(() => {
  if (ORIG_FETCH_DESC) Object.defineProperty(globalThis, 'fetch', ORIG_FETCH_DESC);
  else delete globalThis.fetch;
});

const { extractSourceClips } = await import('../src/lib/refTestPipeline.js');

function accepts(url) {
  const clips = extractSourceClips([url], '');
  return clips.includes(url);
}

// ── (ก) ของใหม่: YouTube /live/ ──
test('ใหม่: YouTube live เต็ม (youtube.com/live/ID) → รับ', () => {
  assert.ok(accepts('https://www.youtube.com/live/dQw4w9WgXcQ'));
});
test('ใหม่: YouTube live ผ่าน m.youtube.com → รับ', () => {
  assert.ok(accepts('https://m.youtube.com/live/dQw4w9WgXcQ'));
});
test('ใหม่: YouTube live มี ?si= ต่อท้าย → รับ', () => {
  assert.ok(accepts('https://youtube.com/live/dQw4w9WgXcQ?si=AbCdEfGhIjK'));
});
test('ใหม่: YouTube live ไม่มี video id (จบด้วย /live/ เฉยๆ) → ปฏิเสธ (ต้องมีตัวตามหลังจริง)', () => {
  assert.ok(!accepts('https://www.youtube.com/live'));
});

// ── (ข) รีเกรสชันล็อกของเดิมที่ผ่านอยู่แล้ว ──
test('รีเกรสชัน: m.youtube.com/watch?v= (โมบายล์) → รับ', () => {
  assert.ok(accepts('https://m.youtube.com/watch?v=dQw4w9WgXcQ'));
});
test('รีเกรสชัน: youtube.com/watch?v=...&si=... (si หลัง v) → รับ', () => {
  assert.ok(accepts('https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=AbCdEfGhIjK'));
});
test('รีเกรสชัน: youtube.com/watch?si=...&v=... (si ก่อน v) → รับ', () => {
  assert.ok(accepts('https://www.youtube.com/watch?si=AbCdEfGhIjK&v=dQw4w9WgXcQ'));
});
test('รีเกรสชัน: youtu.be/ID?si=... (ลิงก์สั้น + si) → รับ', () => {
  assert.ok(accepts('https://youtu.be/dQw4w9WgXcQ?si=AbCdEfGhIjK'));
});
test('รีเกรสชัน: youtube.com/shorts/ID?si=... → รับ', () => {
  assert.ok(accepts('https://www.youtube.com/shorts/dQw4w9WgXcQ?si=AbCdEfGhIjK'));
});
test('รีเกรสชัน: facebook.com/share/v/ID → รับ', () => {
  assert.ok(accepts('https://www.facebook.com/share/v/AbCdEfGhIjK/'));
});
test('รีเกรสชัน: facebook.com/share/r/ID (รีลแชร์) → รับ', () => {
  assert.ok(accepts('https://www.facebook.com/share/r/AbCdEfGhIjK/'));
});
test('รีเกรสชัน: instagram.com/reels/ (พหูพจน์) → รับ', () => {
  assert.ok(accepts('https://www.instagram.com/reels/AbCdEfGhIjK/'));
});
test('รีเกรสชัน: instagram.com/reel/ (เอกพจน์) → รับ (ของเดิม)', () => {
  assert.ok(accepts('https://www.instagram.com/reel/AbCdEfGhIjK/'));
});
test('รีเกรสชัน: vt.tiktok.com (ลิงก์ย่อ) → รับ', () => {
  assert.ok(accepts('https://vt.tiktok.com/ZSAbCdEfG/'));
});
test('รีเกรสชัน: vm.tiktok.com (ลิงก์ย่อแบบเก่า) → รับ', () => {
  assert.ok(accepts('https://vm.tiktok.com/ZSAbCdEfG/'));
});
test('รีเกรสชัน: tiktok.com/@user/video/ID → รับ', () => {
  assert.ok(accepts('https://www.tiktok.com/@somechannel/video/7123456789012345678'));
});
test('รีเกรสชัน: fb.watch/ID → รับ', () => {
  assert.ok(accepts('https://fb.watch/AbCdEfGhIj/'));
});

// ── (ค) ต้องยังปฏิเสธ non-video patterns เหมือนเดิม ──
test('ปฏิเสธ: instagram.com/p/ (โพสต์ภาพ ไม่ใช่วิดีโอ)', () => {
  assert.ok(!accepts('https://www.instagram.com/p/AbCdEfGhIjK/'));
});
test('ปฏิเสธ: facebook.com/username (หน้าโปรไฟล์เปล่า)', () => {
  assert.ok(!accepts('https://www.facebook.com/somepage'));
});
test('ปฏิเสธ: youtube.com/channel/ (หน้าช่อง ไม่ใช่วิดีโอ)', () => {
  assert.ok(!accepts('https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx'));
});
test('ปฏิเสธ: เว็บข่าวทั่วไป', () => {
  assert.ok(!accepts('https://www.somenews.com/article/12345'));
});

// ── ผลข้าง: กรอกมาแต่ไม่ผ่านสักลิงก์ → droppedClipUrls แนบไว้ (behavior เดิม ไม่เปลี่ยน) ──
test('ลิงก์ไม่ผ่าน pattern → droppedClipUrls เก็บไว้ (ไม่ throw, ไม่เชื่อผู้ใช้)', () => {
  const clips = extractSourceClips(['https://www.instagram.com/p/AbCdEfGhIjK/'], '');
  assert.equal(clips.length, 0);
  assert.deepEqual(clips.droppedClipUrls, ['https://www.instagram.com/p/AbCdEfGhIjK/']);
});

// ── ผสมกัน: ลิงก์ /live/ ปนกับลิงก์ที่ไม่ผ่าน ──
test('ผสม: /live/ ผ่าน ปนกับ /p/ ที่ไม่ผ่าน → เก็บเฉพาะที่ผ่าน + ที่เหลือไป dropped', () => {
  const clips = extractSourceClips(
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'https://www.instagram.com/p/AbCdEfGhIjK/'],
    ''
  );
  assert.deepEqual([...clips], ['https://www.youtube.com/live/dQw4w9WgXcQ']);
  assert.deepEqual(clips.droppedClipUrls, ['https://www.instagram.com/p/AbCdEfGhIjK/']);
});

// ── auto-detect จากเนื้อข่าว (ไม่ได้กรอก explicit) ──
test('auto-detect: ไม่กรอก explicit → สแกนเนื้อข่าวเจอลิงก์ /live/', () => {
  const content = 'ดูคลิปสดได้ที่ https://www.youtube.com/live/dQw4w9WgXcQ และแชร์ต่อด้วยนะครับ';
  const clips = extractSourceClips([], content);
  assert.deepEqual([...clips], ['https://www.youtube.com/live/dQw4w9WgXcQ']);
});
