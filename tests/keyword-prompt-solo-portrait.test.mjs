// ============================================================
// 🧪 กฎ "ภาพหน้าเดี่ยวตัวเอก" ใน keyword prompt (21 ก.ค. 69)
// ------------------------------------------------------------
// เคสจริง: ปกออกไม่ได้เพราะพูลมีภาพหน้าเดี่ยวของตัวเอกน้อยเกิน (hero_unverified_kept ไม่มีตัวสำรอง)
// ราก: prompt สกัดคีย์เวิร์ดไม่เคยสั่งเจาะ "ภาพหน้าเดี่ยว" → คำค้นเป็นแนวเหตุการณ์/คู่/ครอบครัวล้วน
// เทสนี้กัน "กฎถูกลบ/แก้เงียบ" — ยิงสดพิสูจน์แล้ว (21 ก.ค.): sonnet ผลิตคำค้นหน้าเดี่ยว 5 คำผูกชื่อตัวเอกครบ
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKeywordSystemPrompt, buildKeywordUserPrompt } from '../src/lib/keywordPrompt.js';

test('system prompt มีหมวดกฎ "ภาพหน้าเดี่ยวตัวเอก" ครบ (ข้อ 19-20)', () => {
  const s = buildKeywordSystemPrompt();
  assert.ok(s.includes('ภาพหน้าเดี่ยวตัวเอก'), 'ต้องมีหัวหมวดกฎหน้าเดี่ยว');
  assert.ok(/19\..*must_have.*4-6 คำ/s.test(s), 'ข้อ 19: บังคับ ≥4-6 คำต่อตัวหลัก');
  assert.ok(s.includes('สัมภาษณ์') && s.includes('เปิดใจ') && s.includes('เซลฟี่'), 'มีตัวอย่างรูปแบบคำค้นไทย');
  assert.ok(s.includes('interview') && s.includes('portrait'), 'ข้อ 20: มีตัวอย่างอังกฤษ');
  assert.ok(s.includes('ภาพคู่/หมู่/หันหลังใช้ไม่ได้'), 'อธิบายเหตุผล (hero ต้องหน้าเดี่ยว)');
});

test('user prompt ยังสร้างปกติ (ไม่พังจากการเพิ่มกฎ)', () => {
  const u = buildKeywordUserPrompt({ headline: 'ทดสอบ' }, 'เนื้อข่าวทดสอบ');
  assert.ok(u.includes('ทดสอบ') && u.includes('เนื้อข่าวทดสอบ'));
});
