/**
 * เทสเครื่องยนต์ถอดตัวใหม่ (clipBrainPipeline) — เจ้าของสั่ง 27 ส.ค. 69
 *   "เสียบโค้ดใหม่ให้รันได้เลย แต่เอาเครื่องยนต์เดิมเป็นตัวสำรอง เวลามีปัญหาให้กลับไปเหมือนเดิมก่อน"
 *
 * 🔴 จุดตายที่ต้องกัน: ถ้าเครื่องยนต์ใหม่ **โยน error ออกมา** แทนที่จะคืน ok:false
 *    ตัวสำรองจะไม่ทำงาน → งานล้มทั้งใบ ทั้งที่ควรถอยไปใช้ของเดิมได้
 *    เทสชุดนี้จึงยิงทุกทางพังที่นึกออก แล้วยืนยันว่า "ไม่โยน" ทุกครั้ง
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// ⚠️ โมดูลในสายนี้ใช้ชื่อย่อ `@/lib/...` ซึ่ง Next แปลให้ แต่ node --test ไม่รู้จัก
//    → ติดตัวแปลเส้นทางเฉพาะไฟล์เทสนี้ (เทคนิคเดียวกับสคริปต์ทดลองที่ใช้มาแล้ว)
const SRC = new URL('../src/', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
const hasExt = (s) => /\\.[a-zA-Z0-9]{1,5}$/.test(s);
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) return next(new URL(spec.slice(2) + (hasExt(spec) ? '' : '.js'), ${JSON.stringify(SRC)}).href, ctx);
  if ((spec.startsWith('./') || spec.startsWith('../')) && !hasExt(spec)) { try { return await next(spec + '.js', ctx); } catch {} }
  return next(spec, ctx);
}
`));

const PIPE_URL = new URL('../src/lib/services/clipBrain/clipBrainPipeline.js', import.meta.url);
const ROUTE_SRC = readFileSync(new URL('../src/app/api/clip-transcript/insight/route.js', import.meta.url), 'utf8');
const { runClipBrainPipeline, PIPELINE_REV } = await import(PIPE_URL.href);

test('ไม่มีทั้งลิงก์และไฟล์ → คืน ok:false ไม่โยน', async () => {
  const r = await runClipBrainPipeline({});
  assert.equal(r.ok, false);
  assert.equal(r.errorType, 'PIPE_NO_SOURCE');
  assert.ok(r.brain, 'ต้องคืนใบเสร็จมาด้วยเสมอ (ผู้เรียกเอาไปบันทึกได้)');
  assert.equal(typeof r.spentTokens, 'number');
});

test('อาร์กิวเมนต์เพี้ยนทุกแบบ ต้องไม่โยนสักครั้ง (ตัวสำรองจะได้ทำงาน)', async () => {
  const พัง = [null, undefined, 0, '', 'ข้อความ', [], { url: 123 }, { url: {}, isYouTube: 'ใช่' },
    { videoBuffer: 'ไม่ใช่บัฟเฟอร์' }, { url: 'x', durationSec: 'ไม่ใช่ตัวเลข' }];
  for (const a of พัง) {
    const r = await runClipBrainPipeline(a);
    assert.equal(typeof r, 'object', `ต้องคืน object เสมอ (${JSON.stringify(a)})`);
    assert.equal(r.ok, false);
    assert.ok(r.errorType, 'ต้องบอกชนิดความผิดพลาด');
  }
});

test('ล้มตั้งแต่ขั้นแรก ต้องบอกว่าใช้โทเคนไปเท่าไร (ผู้เรียกตัดสินใจถอยได้)', async () => {
  const r = await runClipBrainPipeline({ url: 'https://youtu.be/ไม่มีจริง', isYouTube: true });
  assert.equal(r.ok, false);
  assert.equal(typeof r.spentTokens, 'number');
  assert.ok(r.brain.failedAt, 'ต้องบันทึกว่าล้มที่ขั้นไหน');
  assert.ok(Array.isArray(r.brain.steps), 'ต้องมีร่องรอยขั้นตอน');
});

test('ใบเสร็จต้องมีรุ่นกำกับเสมอ (ตามรอยย้อนหลังได้)', async () => {
  const r = await runClipBrainPipeline({});
  assert.equal(r.brain.rev, PIPELINE_REV);
  assert.ok(r.brain.verifyRev, 'ต้องบอกรุ่นตัวตรวจด้วย');
});

// ── การต่อท่อในเส้นจริง ───────────────────────────────────────────────────
test('เส้นจริงต้องเรียกเครื่องยนต์ใหม่ก่อน แล้วถอยไปตัวเดิมเมื่อล้ม', () => {
  assert.match(ROUTE_SRC, /async function buildInsightWithBrain/, 'ต้องมีประตูเดียวที่เลือกเครื่องยนต์');
  assert.match(ROUTE_SRC, /_tryBrainPipeline\(/, 'ต้องลองเครื่องยนต์ใหม่');
  assert.match(ROUTE_SRC, /const legacy = await buildInsight\(/, 'ต้องมีเส้นถอยไปเครื่องยนต์เดิม');
  // คิวต้องเริ่มงานที่ประตูเดียวนี้ครั้งเดียว — ไม่ใช่เรียกทั้งสองเครื่องยนต์ขนานกัน
  const runs = ROUTE_SRC.match(/getClipVideoQueue\(\)\.run\(/g) || [];
  assert.equal(runs.length, 1, 'หนึ่งคำขอต้องเริ่มงานเสียเงินได้ครั้งเดียว');
  assert.match(ROUTE_SRC, /getClipVideoQueue\(\)\.run\(\(\) => buildInsightWithBrain/, 'คิวต้องเรียกประตูเดียวนั้น');
});

test('ตัวลองเครื่องยนต์ใหม่ต้องกลืน error เอง (ห้ามให้หลุดไปล้มทั้งคำขอ)', () => {
  const fn = ROUTE_SRC.slice(ROUTE_SRC.indexOf('async function _tryBrainPipeline'),
    ROUTE_SRC.indexOf('async function _buildInsightTranscriptFallback'));
  assert.match(fn, /catch \(e\)/, 'ต้องมีตัวจับ error');
  assert.match(fn, /return null/, 'ล้มต้องคืน null ให้ผู้เรียกถอยไปของเดิม');
  assert.doesNotMatch(fn, /throw /, 'ห้ามโยนต่อ');
});

test('มีสวิตช์ปิดฉุกเฉิน กลับไปใช้ของเดิม 100% ได้', () => {
  assert.match(ROUTE_SRC, /CLIP_BRAIN_PIPELINE === '0'/, 'ต้องมีสวิตช์ปิด');
  assert.match(ROUTE_SRC, /CLIP_BRAIN_MIN_SEC/, 'ต้องมีเกณฑ์ความยาวคลิปให้เลือกเปิดเฉพาะคลิปยาว');
  assert.match(ROUTE_SRC, /brainFallback = true/, 'ใบที่ถอยไปของเดิมต้องติดธงให้รู้ว่าไม่ได้ตรวจ');
});

test('เฉลยต้องสั่ง JSON ตรงๆ (เดิมสั่งข้อความล้วน แต่ตัวเรียกรับเฉพาะ JSON = พึ่งความบังเอิญ)', async () => {
  const { TRUTH_PROMPT } = await import(new URL('../src/lib/services/clipBrain/clipVerify.js', import.meta.url).href);
  assert.match(TRUTH_PROMPT, /ตอบเป็น JSON/, 'ต้องสั่ง JSON');
  assert.match(TRUTH_PROMPT, /transcription/, 'ต้องระบุรูปผลลัพธ์');
  assert.doesNotMatch(TRUTH_PROMPT, /ห้ามมี JSON/, 'ต้องไม่เหลือคำสั่งเก่าที่ขัดกัน');
});
