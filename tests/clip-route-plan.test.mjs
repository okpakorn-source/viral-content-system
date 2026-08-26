/**
 * เทสตรรกะ "ปุ่มเดียว" ของหน้าถอดคลิป (เจ้าของสั่ง 26 ส.ค. 69)
 *   "ทุกช่องทางถอดเครื่องทีมปุ่มเดียว · นอกจากเครื่องทีมปิด ค่อยถอดปุ่มสำรองบน Vercel เฉพาะอันที่ถอดได้"
 * กติกาที่ต้องเป็นจริง:
 *   1. เครื่องทีมเปิด → ทุกแพลตฟอร์มไปเครื่องทีม (คุณภาพสูงสุด ถอดได้ทุกช่องทาง)
 *   2. เครื่องทีมปิด + YouTube/TikTok → ถอดสำรองบนคลาวด์ได้
 *   3. เครื่องทีมปิด + Facebook/IG → คลาวด์ทำไม่ได้ ต้องรอเครื่องทีม (ห้ามหลอกว่าถอดได้)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { planClipRoute, workerChip } = await import(
  new URL('../src/app/clip-transcript/ui/statusMeta.js', import.meta.url).href
);

const YT = 'https://youtu.be/abc123';
const TT = 'https://www.tiktok.com/@x/video/123';
const FB = 'https://www.facebook.com/share/v/1AbCdEf/';
const IG = 'https://www.instagram.com/reel/xyz/';
const NEWS = 'https://www.trueid.net/detail/12345';

test('เครื่องทีมเปิด: ทุกแพลตฟอร์มต้องไปเครื่องทีม ไม่มีข้อยกเว้น', () => {
  for (const u of [YT, TT, FB, IG]) {
    const r = planClipRoute(u, true);
    assert.equal(r.mode, 'queue', `${u} ต้องเข้าคิวเครื่องทีมเมื่อเครื่องทีมเปิด`);
  }
});

test('เครื่องทีมปิด: YouTube/TikTok ถอดสำรองบนคลาวด์ได้', () => {
  assert.equal(planClipRoute(YT, false).mode, 'direct');
  assert.equal(planClipRoute(TT, false).mode, 'direct');
});

test('เครื่องทีมปิด: Facebook/IG ต้องไม่บอกว่าถอดได้ (คลาวด์โหลดไฟล์ไม่ได้)', () => {
  for (const u of [FB, IG]) {
    const r = planClipRoute(u, false);
    assert.equal(r.mode, 'blocked', `${u} ต้องขึ้นว่ารอเครื่องทีม`);
    assert.match(r.why, /เครื่องทีม/);
    assert.notEqual(r.mode, 'direct', 'ห้ามส่งไปคลาวด์ทั้งที่ทำไม่ได้');
  }
});

test('ลิงก์ข่าวเว็บไม่ใช่คลิป — ไม่เข้าเส้นถอดคลิป', () => {
  assert.equal(planClipRoute(NEWS, true).mode, 'not-clip');
  assert.equal(planClipRoute(NEWS, false).mode, 'not-clip');
  assert.equal(planClipRoute('', true).mode, 'not-clip');
});

test('ทุกทางต้องมีคำอธิบายให้พนักงานอ่านออก (ยกเว้นตอนยังไม่วางลิงก์)', () => {
  for (const [u, alive] of [[YT, true], [YT, false], [FB, true], [FB, false], [TT, false]]) {
    const r = planClipRoute(u, alive);
    assert.ok(r.why && r.why.length > 10, `${u}/${alive} ต้องมีเหตุผลบอกผู้ใช้`);
  }
});

test('ชิปสถานะเครื่องทีม: บอกชัดว่าเปิด/ปิด/ไม่ทราบ และบอกว่าเงียบไปนานเท่าไร', () => {
  assert.match(workerChip({ known: true, alive: true }).text, /พร้อม/);
  const off = workerChip({ known: true, alive: false, secondsAgo: 600 });
  assert.match(off.text, /ปิด/);
  assert.match(off.text, /10 นาที/, 'ต้องบอกระยะเวลาที่เงียบไป');
  assert.match(workerChip({ known: true, alive: false, secondsAgo: 7200 }).text, /2 ชม\./);
  assert.match(workerChip(null).text, /ไม่ทราบ/);
  assert.match(workerChip({ known: false }).text, /ไม่ทราบ/);
});

test('สีชิปต้องสื่อความหมาย (เขียว=พร้อม แดง=ปิด)', () => {
  assert.equal(workerChip({ known: true, alive: true }).dot, '#22c55e');
  assert.equal(workerChip({ known: true, alive: false, secondsAgo: 300 }).dot, '#ef4444');
});
