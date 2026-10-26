/**
 * ★ 26 ต.ค. 69 เฟส 4 — ประตูถอดคลิป /api/clip-transcript/insight หลังลบเครื่องยนต์เดิม
 *   (ย้ายมาจาก clip-brain-pipeline.test ซึ่งเทสเครื่องยนต์ v2 ที่ลบไปแล้ว)
 *   หนึ่งคำขอ = เริ่มงานเสียเงินได้ครั้งเดียว · ไม่มีเครื่องยนต์สำรอง · ไม่มีเส้นถอดเสียง
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROUTE_SRC = readFileSync(new URL('../src/app/api/clip-transcript/insight/route.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('เส้นจริงเรียกเครื่องยนต์ช่องเดียวที่ประตูเดียว ครั้งเดียวต่อคำขอ', () => {
  assert.match(ROUTE_SRC, /async function buildInsightSingle/, 'ต้องมีประตูเดียวของเครื่องยนต์ช่องเดียว');
  assert.match(ROUTE_SRC, /import\('@\/lib\/services\/clipSingle\/pipeline'\)/, 'ประตูต้องเรียกท่อช่องเดียว');
  const runs = ROUTE_SRC.match(/getClipVideoQueue\(\)\.run\(/g) || [];
  assert.equal(runs.length, 1, 'หนึ่งคำขอต้องเริ่มงานเสียเงินได้ครั้งเดียว');
  assert.match(ROUTE_SRC, /getClipVideoQueue\(\)\.run\(\(\) => buildInsightSingle/, 'คิวต้องเรียกประตูเดียวนั้น');
  const gate = ROUTE_SRC.slice(ROUTE_SRC.indexOf('async function buildInsightSingle'), ROUTE_SRC.indexOf('// ★ 8 ก.ค.: ด่านตรวจคุณภาพ'));
  assert.ok(gate.length > 100);
  assert.doesNotMatch(gate, /catch\s*\(/, 'ประตูห้ามกลืน error (ล้มแล้วต้องบอกผู้เรียก ไม่ถอยไปทางอื่นเงียบๆ)');
});

test('เครื่องยนต์เดิม/ตัวสำรอง/เส้นถอดเสียงถูกลบหมด (เจ้าของเคาะเลิกใช้ 25 ต.ค. 69)', () => {
  for (const legacy of [/clipInsightService/, /clipBrainPipeline/, /extractClipInsight/, /extractInsightFromVideoBuffer/,
    /_tryBrainPipeline/, /buildInsightWithBrain/, /transcribeFor/, /_buildInsightTranscriptFallback/, /CLIP_BRAIN_PIPELINE/, /_fitForInline/]) {
    assert.doesNotMatch(ROUTE_SRC, legacy, `ยังเหลือ ${legacy}`);
  }
});

test('ตัวโหลดคลิปติดธง retrySafe เฉพาะความพลาดก่อนยิง AI · ใบไม่ครบติดธง lowQuality', () => {
  const loader = ROUTE_SRC.slice(ROUTE_SRC.indexOf('async function _loadClipForSingle'), ROUTE_SRC.indexOf('/** ความยาวคลิป YouTube จากหน้า watch'));
  assert.match(loader, /throw _markRetrySafe\(e\)/);
  assert.match(ROUTE_SRC, /const retrySafe = e\?\.retrySafe === true && acc\.brainSpentTokens === 0;/, 'ใช้ AI ไปแล้วห้ามให้ worker ลองซ้ำอัตโนมัติ');
  assert.match(ROUTE_SRC, /engine === 'clip-single' && missed\) issues\.push/, 'ช่วงที่ดูไม่สำเร็จ = เนื้อไม่ครบ ต้องติดธง');
});
