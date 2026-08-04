// เทสตัวดึงข้อมูลโพสต์ต้นทาง (clipSourceMetaService) — ออฟไลน์ล้วน
//   🔴 สัญญาที่ต้องคุมให้ตาย: ห้าม throw ทุกกรณี · ทางที่ไม่มีข้อมูล = null · แคปชั่นไม่เกิน 800
//   ทุกเทสในไฟล์นี้ปิด yt-dlp (skipYtDlp) และครอบ fetch ด้วยตัวปลอม — ห้ามยิงเน็ต/โปรเซสนอกจริง
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { getClipSourceMeta } from '../src/lib/services/clipSourceMetaService.js';

const originalFetch = globalThis.fetch;
after(() => {
  if (originalFetch) globalThis.fetch = originalFetch;
  else delete globalThis.fetch;
});

/** ครอบ fetch ชั่วคราว + นับจำนวนครั้งที่ถูกเรียก (ห้ามมีทางไหนแอบยิงเน็ต) */
async function withFetch(handler, fn) {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push(String(input));
    return handler(String(input), init);
  };
  try {
    return { result: await fn(), calls };
  } finally {
    if (originalFetch) globalThis.fetch = originalFetch;
    else delete globalThis.fetch;
  }
}

const noNetwork = () => { throw new Error('NETWORK_FORBIDDEN_IN_TEST'); };

// ───────────── TikTok: ใช้ผล tikwm ที่ผู้เรียกมีอยู่แล้ว ─────────────

test('tikwm: ส่งก้อนเต็ม {data:{...}} มา ต้องแปลงเป็น sourceMeta ได้ และไม่ยิงเน็ตเลย', async () => {
  const tikwmInfo = { code: 0, data: { title: 'แม่ค้าคืนเงินให้ลูกค้า #ข่าวดี', author: { nickname: 'เพจข่าวเด่น', unique_id: 'khaoden' } } };
  const { result, calls } = await withFetch(noNetwork, () =>
    getClipSourceMeta('https://www.tiktok.com/@khaoden/video/7000000000000000001', { platform: 'tiktok', tikwmInfo }));

  assert.deepEqual(result, {
    uploader: 'เพจข่าวเด่น',
    title: 'แม่ค้าคืนเงินให้ลูกค้า #ข่าวดี',
    caption: 'แม่ค้าคืนเงินให้ลูกค้า #ข่าวดี',
    source: 'tikwm',
  });
  assert.equal(calls.length, 0, 'สาย tikwm ต้องไม่ยิง fetch ซ้ำ');
});

test('tikwm: ส่งเฉพาะ data มาก็ต้องรับได้ และไม่มี nickname ให้ถอย unique_id', async () => {
  const r = await getClipSourceMeta('https://www.tiktok.com/@a/video/1', {
    platform: 'tiktok',
    tikwmInfo: { title: 'หัวข้อคลิป', author: { unique_id: 'somechannel' } },
  });
  assert.equal(r.uploader, 'somechannel');
  assert.equal(r.title, 'หัวข้อคลิป');
  assert.equal(r.source, 'tikwm');
});

test('tikwm: แคปชั่นยาวต้องถูกตัดที่ 800 และหัวข้อที่ 200', async () => {
  const long = 'ก'.repeat(1200);
  const r = await getClipSourceMeta('https://www.tiktok.com/@a/video/1', {
    platform: 'tiktok',
    tikwmInfo: { data: { title: long, author: { nickname: 'เพจ' } } },
  });
  assert.equal(r.caption.length, 800, 'แคปชั่นต้องไม่เกิน 800 ตัวอักษร');
  assert.equal(r.title.length, 200);
});

test('tikwm: ยุบช่องว่าง/บรรทัดใหม่ให้เป็นบรรทัดเดียว (กันแคปชั่นดันโครงพรอมต์เพี้ยน)', async () => {
  const r = await getClipSourceMeta('https://www.tiktok.com/@a/video/1', {
    platform: 'tiktok',
    tikwmInfo: { data: { title: 'บรรทัดหนึ่ง\n\n   บรรทัดสอง\t\tจบ', author: { nickname: '  เพจ  ' } } },
  });
  assert.equal(r.caption, 'บรรทัดหนึ่ง บรรทัดสอง จบ');
  assert.equal(r.uploader, 'เพจ');
});

test('tikwm: ไม่มีข้อมูล/ข้อมูลพัง = null (ไม่ใช่กล่องเปล่า) และห้าม throw', async () => {
  const bads = [undefined, null, 0, '', 'สตริงลอย', {}, { data: {} }, { data: { author: {} } }, []];
  for (const tikwmInfo of bads) {
    const r = await getClipSourceMeta('https://www.tiktok.com/@a/video/1', { platform: 'tiktok', tikwmInfo });
    assert.equal(r, null, `tikwmInfo=${JSON.stringify(tikwmInfo)} ต้องได้ null`);
  }
});

// ───────────── YouTube: oEmbed (ทำงานได้ทั้งคลาวด์และเครื่องทีม) ─────────────

test('youtube: oEmbed สำเร็จ → ได้ผู้โพสต์+หัวข้อ source=oembed (ปิด yt-dlp ในเทส)', async () => {
  const { result, calls } = await withFetch(
    (url) => {
      assert.ok(url.startsWith('https://www.youtube.com/oembed?'), `ต้องยิง oEmbed เท่านั้น: ${url}`);
      return { ok: true, json: async () => ({ author_name: 'ช่องข่าวทดสอบ', title: 'คลิปทดสอบระบบ' }) };
    },
    () => getClipSourceMeta('https://www.youtube.com/watch?v=abcdefghijk', { platform: 'youtube', skipYtDlp: true }),
  );

  assert.deepEqual(result, { uploader: 'ช่องข่าวทดสอบ', title: 'คลิปทดสอบระบบ', caption: '', source: 'oembed' });
  assert.equal(calls.length, 1);
});

test('youtube: oEmbed ล้ม/ตอบไม่ใช่ JSON/สถานะไม่ ok → null ไม่ throw', async () => {
  for (const handler of [
    () => { throw new Error('fetch failed'); },
    () => ({ ok: true, json: async () => { throw new Error('bad json'); } }),
    () => ({ ok: false, status: 404, json: async () => ({}) }),
    () => ({ ok: true, json: async () => ({}) }),
  ]) {
    const { result } = await withFetch(handler, () =>
      getClipSourceMeta('https://youtu.be/abcdefghijk', { platform: 'youtube', skipYtDlp: true }));
    assert.equal(result, null);
  }
});

test('youtube: เดาแพลตฟอร์มเองได้เมื่อไม่ส่ง platform มา', async () => {
  const { result } = await withFetch(
    () => ({ ok: true, json: async () => ({ author_name: 'ช่อง ก', title: 'หัวข้อ ก' }) }),
    () => getClipSourceMeta('https://youtu.be/abcdefghijk', { skipYtDlp: true }),
  );
  assert.equal(result.uploader, 'ช่อง ก');
});

// ───────────── Meta + อินพุตแปลก ─────────────

test('meta: ไม่มี yt-dlp ให้ใช้ = null และไม่ยิงเน็ต', async () => {
  const { result, calls } = await withFetch(noNetwork, () =>
    getClipSourceMeta('https://www.facebook.com/page/videos/123', { platform: 'meta', skipYtDlp: true }));
  assert.equal(result, null);
  assert.equal(calls.length, 0);
});

test('url แปลกๆ / ว่าง / ไม่ใช่สตริง → null ทุกกรณี ห้าม throw และห้ามแตะเน็ต', async () => {
  const weird = ['', '   ', 'ไม่ใช่ลิงก์', 'ftp://example.com/a.mp4', 'https://example.com/clip', 'javascript:alert(1)',
    'https://yout-ube.example/watch?v=1', null, undefined, 42, {}, [], true];
  const { result, calls } = await withFetch(noNetwork, async () => {
    for (const url of weird) {
      assert.equal(await getClipSourceMeta(url), null, `url=${JSON.stringify(url)} ต้องได้ null`);
      assert.equal(await getClipSourceMeta(url, { skipYtDlp: true }), null);
    }
    return true;
  });
  assert.equal(result, true);
  assert.equal(calls.length, 0, 'ลิงก์ที่ไม่รู้จักต้องไม่ยิงเน็ตเลย');
});

test('opts พังทั้งก้อน (null/สตริง/ตัวเลข) ต้องไม่ throw', async () => {
  for (const opts of [null, undefined, 'x', 5]) {
    assert.equal(await getClipSourceMeta('https://example.com/x', opts), null);
  }
});
