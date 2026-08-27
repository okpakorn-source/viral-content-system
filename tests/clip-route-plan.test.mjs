/**
 * เทสกติกา "2 ปุ่ม · บังคับเครื่องแอดมิน" (เจ้าของสั่ง 27 ส.ค. 69 — ทับกติกา 26 ส.ค.)
 *   "บังคับรันในเครื่องทีมเท่านั้น เหลือ 2 ปุ่มพอ · ถอดผ่านคอมฉันเป็นหลัก
 *    แต่ถ้าคอมฉันดับ ล่ม ให้ถอดปุ่มสำรอง (บน Vercel)"
 *
 * 🔴 บั๊กที่กติกานี้มาแก้ (ของจริง ไม่ใช่สมมติ):
 *   เดิมเมื่อเครื่องแอดมินดับ + ลิงก์ YouTube/TikTok ปุ่มหลัก "เปลี่ยนตัวเองเป็นถอดบนคลาวด์" ให้เลย
 *   พนักงานกดปุ่มเดิม แต่ได้ของที่ Vercel ถอด ซึ่ง **ไม่มีผู้ตรวจและไม่มีตัวซ่อม**
 *   (Vercel รัน CLI ไม่ได้ — พิสูจน์จากใบ 27 ส.ค. 08:31 โควตาสมอง 0 บาท เสร็จ 28 วินาที)
 *   → ของด้อยคุณภาพหลุดไปใช้โดยไม่มีใครรู้ตัว
 *
 * กติกาที่ต้องเป็นจริงตั้งแต่นี้:
 *   1. ปุ่มหลัก = เครื่องแอดมิน **เสมอ** ไม่ว่าเครื่องจะเปิดหรือดับ (ดับ = รอในคิว)
 *   2. ปุ่มสำรอง (Vercel) กดได้เฉพาะตอนเครื่องแอดมินดับจริง + เป็นลิงก์ที่คลาวด์ทำได้
 *   3. ทุกสถานะต้องมีคำอธิบายภาษาคนอ่านออก (พนักงานไม่ต้องเดา)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { planClipRoute, workerChip } = await import(
  new URL('../src/app/clip-transcript/ui/statusMeta.js', import.meta.url).href
);

const YT = 'https://youtu.be/abc123';
const TT = 'https://www.tiktok.com/@x/video/123';
const FB = 'https://www.facebook.com/share/v/1AbCdEf/';
const IG = 'https://www.instagram.com/reel/xyz/';
const NEWS = 'https://www.trueid.net/detail/12345';
const CLIPS = [YT, TT, FB, IG];

// ── กติกาข้อ 1: ปุ่มหลักไปเครื่องแอดมินเสมอ ────────────────────────────────
test('เครื่องแอดมินเปิด: ทุกแพลตฟอร์มไปเครื่องแอดมิน', () => {
  for (const u of CLIPS) {
    assert.equal(planClipRoute(u, true).primary.action, 'queue', `${u} ต้องเข้าคิวเครื่องแอดมิน`);
  }
});

test('🔴 เครื่องแอดมินดับ: ปุ่มหลักต้องยังเป็นคิวเครื่องแอดมิน ห้ามสลับไปคลาวด์เอง', () => {
  for (const u of CLIPS) {
    const r = planClipRoute(u, false);
    assert.equal(r.primary.action, 'queue', `${u} ปุ่มหลักต้องไม่เปลี่ยนปลายทางเอง`);
    assert.notEqual(r.primary.action, 'cloud', `${u} ห้ามปุ่มหลักยิงคลาวด์อัตโนมัติ (บั๊กเดิม)`);
    assert.equal(r.primary.enabled, true, 'เครื่องดับก็ยังต้องกดส่งเข้าคิวได้ งานจะรอ ไม่หาย');
  }
});

test('เครื่องดับ ปุ่มหลักต้องบอกให้รู้ว่ากดแล้วจะรอคิว (ห้ามหลอกว่าถอดทันที)', () => {
  const r = planClipRoute(YT, false);
  assert.match(r.primary.label, /คิว|ปิด|ดับ/, 'ป้ายปุ่มต้องสื่อว่าไม่ได้ถอดทันที');
  assert.match(r.primary.why, /คิว/, 'คำอธิบายต้องบอกว่างานรอในคิว');
});

// ── กติกาข้อ 2: ปุ่มสำรองต้องกดเอง และเปิดให้เฉพาะตอนเครื่องดับ ────────────
test('🔴 เครื่องแอดมินเปิดอยู่: ปุ่มสำรองต้องกดไม่ได้ (กันคนเผลอใช้ของไม่ผ่านตรวจ)', () => {
  for (const u of CLIPS) {
    const r = planClipRoute(u, true);
    assert.equal(r.backup.enabled, false, `${u} ปุ่มสำรองต้องปิดเมื่อเครื่องแอดมินพร้อม`);
    assert.equal(r.backup.action, 'none');
    assert.ok(r.backup.why && r.backup.why.length > 10, 'ต้องบอกเหตุผลที่กดไม่ได้');
  }
});

test('เครื่องแอดมินดับ + YouTube/TikTok: ปุ่มสำรองเปิดให้กดเอง', () => {
  for (const u of [YT, TT]) {
    const r = planClipRoute(u, false);
    assert.equal(r.backup.enabled, true, `${u} ต้องกดสำรองได้ตอนเครื่องดับ`);
    assert.equal(r.backup.action, 'cloud');
  }
});

test('เครื่องแอดมินดับ + Facebook/IG: ปุ่มสำรองต้องปิด (คลาวด์โหลดไฟล์ไม่ได้ ห้ามหลอก)', () => {
  for (const u of [FB, IG]) {
    const r = planClipRoute(u, false);
    assert.equal(r.backup.enabled, false, `${u} คลาวด์ทำไม่ได้ ต้องกดไม่ได้`);
    assert.match(r.backup.why, /Facebook|IG/, 'ต้องบอกว่าเพราะเป็นลิงก์ Facebook/IG');
  }
});

test('ปุ่มสำรองที่กดได้ ต้องเตือนว่าของไม่ผ่านผู้ตรวจ (กันหยิบของกากไปใช้)', () => {
  const r = planClipRoute(YT, false);
  assert.match(r.backup.why, /ตรวจ|ซ่อม/, 'ต้องเตือนว่าไม่ผ่านการตรวจ');
});

// ── ลิงก์ที่ไม่ใช่คลิป ────────────────────────────────────────────────────
test('ลิงก์ข่าวเว็บ: ปุ่มหลักเปลี่ยนเป็นวิจัยข่าว (ไม่ต้องเพิ่มปุ่มที่ 3)', () => {
  const r = planClipRoute(NEWS, true);
  assert.equal(r.primary.action, 'news-hunt');
  assert.equal(r.backup.enabled, false, 'ลิงก์ข่าวไม่มีของให้ถอดสำรอง');
  assert.equal(planClipRoute(NEWS, false).primary.action, 'news-hunt', 'เครื่องดับก็ยังวิจัยข่าวได้');
});

test('ยังไม่วางลิงก์: ปุ่มหลักยังกดได้ (จะขึ้นเตือนให้วางลิงก์) · ปุ่มสำรองปิด', () => {
  for (const v of ['', '   ', null, undefined]) {
    const r = planClipRoute(v, true);
    assert.equal(r.primary.enabled, true);
    assert.equal(r.backup.enabled, false);
  }
});

test('ทุกสถานะที่มีลิงก์ ต้องมีคำอธิบายให้พนักงานอ่านออกทั้งสองปุ่ม', () => {
  for (const u of [...CLIPS, NEWS]) {
    for (const alive of [true, false]) {
      const r = planClipRoute(u, alive);
      assert.ok(r.primary.why.length > 10, `${u}/${alive} ปุ่มหลักต้องมีเหตุผล`);
      assert.ok(r.backup.why.length > 5, `${u}/${alive} ปุ่มสำรองต้องมีเหตุผล`);
      assert.ok(r.primary.label && r.backup.label, 'ต้องมีป้ายปุ่มทั้งคู่');
    }
  }
});

// ── ชิปสถานะเครื่อง ───────────────────────────────────────────────────────
test('ชิปสถานะ: บอกชัดว่าพร้อม/ดับ/ไม่ทราบ และเงียบไปนานเท่าไร', () => {
  assert.match(workerChip({ known: true, alive: true }).text, /พร้อม/);
  const off = workerChip({ known: true, alive: false, secondsAgo: 600 });
  assert.match(off.text, /ดับ/);
  assert.match(off.text, /10 นาที/, 'ต้องบอกระยะเวลาที่เงียบไป');
  assert.match(workerChip({ known: true, alive: false, secondsAgo: 7200 }).text, /2 ชม\./);
  assert.match(workerChip(null).text, /ไม่ทราบ/);
  assert.match(workerChip({ known: false }).text, /ไม่ทราบ/);
});

test('สีชิปต้องสื่อความหมาย (เขียว=พร้อม แดง=ดับ)', () => {
  assert.equal(workerChip({ known: true, alive: true }).dot, '#22c55e');
  assert.equal(workerChip({ known: true, alive: false, secondsAgo: 300 }).dot, '#ef4444');
});

// ── หน้าเว็บต้องมี 2 ปุ่มจริง และต่อสายถูก ────────────────────────────────
const PAGE = readFileSync(new URL('../src/app/clip-transcript/page.js', import.meta.url), 'utf8');
/** ตัดเอาเฉพาะ "โซนงานใหม่" — ปุ่มในคลัง/แบ่งหน้า/แท็บ ไม่นับ */
const ZONE = PAGE.slice(PAGE.indexOf('{/* โซน 1'), PAGE.indexOf('{notice &&'));

test('🔴 โซนงานใหม่ต้องมีปุ่มสั่งงาน 2 ปุ่มเท่านั้น (เจ้าของสั่ง "ทั้งหน้าเหลือ 2 ปุ่ม")', () => {
  const n = (ZONE.match(/<button/g) || []).length;
  assert.equal(n, 2, `เจอ ${n} ปุ่ม — ต้องมีแค่ ปุ่มหลัก + ปุ่มสำรอง`);
  assert.match(ZONE, /data-testid="btn-primary"/);
  assert.match(ZONE, /data-testid="btn-backup"/);
});

test('🔴 ปุ่มหลักต้องไม่ยิงคลาวด์เอง — runPrimary ห้ามเรียก extractInsight', () => {
  const fn = PAGE.slice(PAGE.indexOf('const runPrimary'), PAGE.indexOf('const runBackup'));
  assert.doesNotMatch(fn, /extractInsight\(/, 'ปุ่มหลักเรียกถอดสดตรง = สลับไปคลาวด์อัตโนมัติ (บั๊กเดิม)');
  assert.match(fn, /submitToQueue\(/, 'ปุ่มหลักต้องส่งเข้าคิวเครื่องแอดมิน');
});

test('ปุ่มสำรองต้องถูกล็อกด้วยผลจาก planClipRoute ไม่ใช่ตัดสินเองในหน้า', () => {
  assert.match(ZONE, /disabled=\{[^}]*!route\.backup\.enabled/, 'ปุ่มสำรองต้องปิดตามแผนที่ตรรกะกลางบอก');
  const fn = PAGE.slice(PAGE.indexOf('const runBackup'), PAGE.indexOf('const primaryLabel'));
  assert.match(fn, /if \(!route\.backup\.enabled\) return/, 'ต้องกันซ้ำในตัวฟังก์ชันด้วย (กันคนปลดปุ่มจาก devtools)');
});

test('🔴 ปุ่ม "ถอดใหม่" ในคลังต้องผ่านเครื่องแอดมินด้วย — ห้ามเป็นช่องลัดไป Vercel', () => {
  // ช่องโหว่ของจริงที่เจอตอนตรวจงานนี้: การ์ดในคลังส่ง onRetry ไปเรียกถอดสดตรง
  // → กด "ถอดใหม่" ทีไร งานวิ่งบนเซิร์ฟเวอร์ที่เสิร์ฟหน้า (production = Vercel) ข้ามเครื่องแอดมินทั้งดุ้น
  const retries = PAGE.match(/onRetry=\{[^}]*\}/g) || [];
  assert.ok(retries.length >= 2, 'ต้องมีปุ่มถอดใหม่อยู่จริง');
  for (const r of retries) {
    assert.doesNotMatch(r, /extractInsight/, `พบช่องลัดไปคลาวด์: ${r}`);
  }
});

test('🔴 ทั้งหน้าต้องมีทางเดียวที่ยิงถอดสด = ปุ่มสำรองเท่านั้น', () => {
  // ตัวประกาศเขียนว่า `const extractInsight = async (` จึงไม่เข้าแพตเทิร์นนี้ — ที่นับได้คือ "จุดเรียกใช้" ล้วน
  const calls = PAGE.match(/extractInsight\(/g) || [];
  assert.equal(calls.length, 1, `มี ${calls.length} จุดที่เรียกถอดสด — ต้องเหลือจุดเดียวคือ runBackup`);
  const fn = PAGE.slice(PAGE.indexOf('const runBackup'), PAGE.indexOf('const primaryLabel'));
  assert.match(fn, /extractInsight\(/, 'จุดเดียวนั้นต้องอยู่ใน runBackup');
});

// ── ด่านฝั่งเซิร์ฟเวอร์: คลาวด์ห้ามถอดคลิปเอง ────────────────────────────
test('🔴 /hunt บนคลาวด์ต้องเข้าคิวเครื่องแอดมินทุกแพลตฟอร์ม (ไม่ใช่แค่ FB/IG)', () => {
  const src = readFileSync(new URL('../src/app/api/clip-transcript/hunt/route.js', import.meta.url), 'utf8');
  const gate = src.slice(src.indexOf("if (process.platform !== 'win32'"), src.indexOf('const jobs = createStore'));
  assert.doesNotMatch(gate, /type === 'meta'/, "ด่านต้องไม่จำกัดแค่ FB/IG — YouTube/TikTok ก็ต้องเข้าคิว");
  assert.match(gate, /!_fromWorker/, 'ต้องคงข้อยกเว้นให้เวิร์กเกอร์ ไม่งั้นคิวซ้อนคิวไม่รู้จบ');
  // ยืนยันว่าเส้นยิงเข้า insight อยู่ "หลัง" ด่าน — ไม่งั้นจ่ายเงินก่อนถึงด่าน
  assert.ok(src.indexOf("if (process.platform !== 'win32'") < src.indexOf('/api/clip-transcript/insight`'),
    'ด่านต้องมาก่อนจุดที่เรียกถอด');
});

test('🔴 ทุกทางที่พาไปถอดคลิปได้ ต้องผ่านคิว ยกเว้นปุ่มสำรองทางเดียว', () => {
  // สรุปแผนที่ผู้เรียกทั้งหน้า — ใครเพิ่มทางลัดใหม่เข้ามา เทสนี้จะแดงทันที
  const direct = [...PAGE.matchAll(/fetch\('\/api\/clip-transcript\/insight'/g)].length;
  assert.equal(direct, 1, `หน้านี้ยิง /insight ตรง ${direct} จุด — ต้องเหลือจุดเดียว (ในตัว extractInsight)`);
  const queued = [...PAGE.matchAll(/submitToQueue\(/g)].length;
  assert.ok(queued >= 4, `ทางที่ผ่านคิวต้องมีอย่างน้อย 4 (ปุ่มหลัก + ถอดใหม่ในคลัง 2 จุด + ทำใหม่ในบอร์ด) เจอ ${queued}`);
});
