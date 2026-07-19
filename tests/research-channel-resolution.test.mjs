// ============================================================
// 🧪 Research Channel Resolution (เฟส 1) — offline unit test (pure)
// ------------------------------------------------------------
// Target: src/lib/services/deskV2/researchChannelMap.js
//   • resolveCandidateChannel(url, discoveredVia) — ระบุแพลตฟอร์มจริงจาก URL
//   • platformGroupOf(channel)                    — จัดกลุ่มแพลตฟอร์ม (meta/tiktok/youtube/web/other)
// pure ล้วน ไม่มี persistStore → import ตรงได้ ไม่ต้อง stub
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCandidateChannel, platformGroupOf, SEARCH_CHANNELS } from '../src/lib/services/deskV2/researchChannelMap.js';

// ── URL matrix: host จริง → แพลตฟอร์มจริง (ไม่ขึ้นกับช่องที่ยิงค้น) ──
test('youtube: youtube.com / youtu.be → youtube', () => {
  assert.equal(resolveCandidateChannel('https://www.youtube.com/watch?v=abc123', 'videos'), 'youtube');
  assert.equal(resolveCandidateChannel('https://youtu.be/abc123', 'google'), 'youtube');
  assert.equal(resolveCandidateChannel('https://m.youtube.com/watch?v=x', 'google'), 'youtube');
});

test('tiktok: tiktok.com (รวม vm.) → tiktok', () => {
  assert.equal(resolveCandidateChannel('https://www.tiktok.com/@user/video/123', 'google'), 'tiktok');
  assert.equal(resolveCandidateChannel('https://vm.tiktok.com/ZXYW/', 'videos'), 'tiktok');
});

test('instagram: instagram.com / instagr.am → instagram', () => {
  assert.equal(resolveCandidateChannel('https://www.instagram.com/p/Cabc/', 'google'), 'instagram');
  assert.equal(resolveCandidateChannel('https://instagr.am/p/Cabc/', 'google'), 'instagram');
});

test('reels: facebook.com/reel* และ fb.watch → reels', () => {
  assert.equal(resolveCandidateChannel('https://www.facebook.com/reel/123456', 'facebook'), 'reels');
  assert.equal(resolveCandidateChannel('https://web.facebook.com/username/videos/reel/9', 'google'), 'reels');
  assert.equal(resolveCandidateChannel('https://fb.watch/abcDEF/', 'videos'), 'reels');
});

test('facebook: path อื่นของ facebook → facebook', () => {
  assert.equal(resolveCandidateChannel('https://www.facebook.com/thepage/posts/123', 'facebook'), 'facebook');
  assert.equal(resolveCandidateChannel('https://m.facebook.com/story.php?story_fbid=1&id=2', 'google'), 'facebook');
});

test('เว็บทั่วไปจาก google → google', () => {
  assert.equal(resolveCandidateChannel('https://www.thairath.co.th/news/local/123', 'google'), 'google');
  assert.equal(resolveCandidateChannel('https://today.line.me/th/v2/article/abc', 'google'), 'google');
});

test('ผลวิดีโอที่ไม่ใช่ social (ยิงผ่าน videos) → videos', () => {
  assert.equal(resolveCandidateChannel('https://www.dailymotion.com/video/x9', 'videos'), 'videos');
  assert.equal(resolveCandidateChannel('https://news.ch7.com/detail/999', 'videos'), 'videos');
});

test('reclassify: ค้นผ่าน google แต่ลิงก์เป็น social → channel เป็นแพลตฟอร์มจริง (≠ ช่องยิงค้น)', () => {
  // จุดขายของเฟส 1: discoveredVia='google' แต่ channel จริงต้องเป็น tiktok/instagram/reels
  assert.equal(resolveCandidateChannel('https://www.tiktok.com/@a/video/1', 'google'), 'tiktok');
  assert.equal(resolveCandidateChannel('https://www.instagram.com/reel/xyz/', 'google'), 'instagram');
  assert.equal(resolveCandidateChannel('https://www.facebook.com/reel/77', 'google'), 'reels');
});

test('URL เสีย/ว่าง/ไม่รู้จัก → ไม่เดา คืนช่องที่ยิงค้น (discoveredVia)', () => {
  assert.equal(resolveCandidateChannel('', 'facebook'), 'facebook');
  assert.equal(resolveCandidateChannel('ไม่ใช่ url', 'tiktok'), 'tiktok');
  assert.equal(resolveCandidateChannel(null, 'youtube'), 'youtube');
  // discoveredVia แปลก (ไม่อยู่ใน SEARCH_CHANNELS) + URL เสีย → fallback 'google'
  assert.equal(resolveCandidateChannel('', 'weird'), 'google');
});

// ── platformGroupOf ──
test('platformGroupOf: meta = facebook+reels+instagram', () => {
  assert.equal(platformGroupOf('facebook'), 'meta');
  assert.equal(platformGroupOf('reels'), 'meta');
  assert.equal(platformGroupOf('instagram'), 'meta');
});

test('platformGroupOf: tiktok / youtube แยกกลุ่มตรงตัว', () => {
  assert.equal(platformGroupOf('tiktok'), 'tiktok');
  assert.equal(platformGroupOf('youtube'), 'youtube');
});

test('platformGroupOf: google/videos → web · อื่นๆ → other', () => {
  assert.equal(platformGroupOf('google'), 'web');
  assert.equal(platformGroupOf('videos'), 'web');
  assert.equal(platformGroupOf('อะไรก็ไม่รู้'), 'other');
  assert.equal(platformGroupOf(''), 'other');
});

test('กลุ่มแพลตฟอร์มตรงกับ targets.platformPct ({meta,tiktok,youtube})', () => {
  // ยืนยันว่า 3 ช่องหลักแมปเข้ากลุ่มที่ metrics.targetDelta ใช้เทียบเป้าได้
  const groups = new Set(['videos', 'facebook', 'reels', 'tiktok', 'youtube', 'instagram', 'google'].map(platformGroupOf));
  assert.ok(groups.has('meta') && groups.has('tiktok') && groups.has('youtube'));
});

test('SEARCH_CHANNELS = 6 ช่องยิงค้น (instagram ไม่อยู่ในชุดยิงค้น)', () => {
  assert.deepEqual(SEARCH_CHANNELS, ['videos', 'facebook', 'reels', 'tiktok', 'youtube', 'google']);
  assert.ok(!SEARCH_CHANNELS.includes('instagram'));
});
