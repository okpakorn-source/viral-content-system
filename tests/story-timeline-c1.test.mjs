// ============================================================
// 🧪 story-timeline-c1.test.mjs — เฟส C ข้อ C-1 (29 ก.ค. 69, "ช่องย่อยเล่าตามลำดับเรื่อง")
// ------------------------------------------------------------
// ★ rework รอบ 1 (Opus scope-fix): เดิมตั้งใจให้ compassBrain (LLM, megaBrains.js) ติดป้าย beat ตรงๆ แต่ผิดกติกา
//   ทีม (ห้ามแก้ megaBrains.js โดยไม่ได้รับอนุมัติเจ้าของตรง) → revert megaBrains.js กลับ HEAD byte-exact แล้ว
//   ย้ายตรรกะทั้งหมดมาเป็นการอนุมานเชิงกลไก (inferBeatFromDreamShot, PURE, ไม่มี LLM เอี่ยว) ใน megaAdapters.js ล้วน
// ★ rework รอบ 2 (Opus ตรวจซ้ำ — พบบั๊กจริงจากโพรบ + จุดอ่อนออกแบบ):
//   1) คำสั้นเดี่ยว ('รอ'/'หลัง'/'จบ') ชนกับคำไทยทั่วไปที่ไม่เกี่ยวกันเป็น substring ('รอ' ใน "ครอบครัว"/"รอยยิ้ม",
//      'หลัง' ใน "เบื้องหลัง") → เปลี่ยนทั้งตารางเป็นวลียาว/เจาะจงล้วน (ไม่มีคำเดี่ยว 1-2 พยางค์อีกต่อไป)
//   2) เคสหลายวลีชนกัน (Opus: "หลังจากรอคอยมานาน ในที่สุดก็ชนะ" เดิมตอบ "ก่อน" ผิด ควรเป็น "จบ") → แก้ด้วย
//      "ตำแหน่งท้ายสุดในประโยคชนะ" (lastIndexOf ทุกวลี เลือกตำแหน่งมากสุด ไม่ใช่ลำดับกลุ่มที่ตรวจก่อน)
//   3) โบนัส tautology (ROLE_EXPECTED_BEAT ใช้ค่าเดียวกับ BEAT_SLOT_DEFAULT → slot ตรง role อยู่แล้ว = "ตรง" เสมอ
//      ไม่มีหลักฐานจริง) → inferBeatFromDreamShot คืน {beat, source:'keyword'|'slot'|null} แยกชัด — โบนัสให้เฉพาะ
//      source==='keyword' (หลักฐานจริงจาก description) เท่านั้น ไม่นับ source==='slot' (แค่ default เดา)
// ------------------------------------------------------------
// harness:
//   (1) inferBeatFromDreamShot: PURE export ตรง — เทสตรง unit เต็มรูปแบบ (ไม่ต้อง mock/stub อะไรเลย)
//   (2) storyFitOf: source-assertion + pure truth-table (แพทเทิร์นเดียวกับ dream-score-boost-a6.test.mjs — closure
//       ส่วนตัวลึกใน s6_slots ทดสอบตรงไม่คุ้มค่า)
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
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

const { inferBeatFromDreamShot } = await import('@/lib/megaAdapters');
const src = readFileSync(new URL('../src/lib/megaAdapters.js', import.meta.url), 'utf8');
const brainsSrc = readFileSync(new URL('../src/lib/megaBrains.js', import.meta.url), 'utf8');

// ═══════════════════════════ (0) megaBrains.js ต้องไม่ถูกแตะ (Opus scope-fix) ═══════════════════════════

test('megaBrains.js: compassBrain ต้องไม่มีพารามิเตอร์/ฟิลด์ beat ใดๆ เลย (revert byte-exact แล้ว — ห้ามแก้ไฟล์นี้โดยไม่ได้รับอนุมัติเจ้าของตรง)', () => {
  assert.ok(/export async function compassBrain\(\{ card, extractText \}\) \{/.test(brainsSrc), 'signature ต้องเหมือนเดิมทุก byte (ไม่มี storyTimelineOn)');
  assert.ok(!/beat/i.test(brainsSrc), 'ต้องไม่มีคำว่า beat หลงเหลืออยู่ในไฟล์นี้เลย');
  assert.ok(
    /"visualDreamShots":\[\{"slot":"hero\|reaction\|action\|context\|evidence","description":"ช็อตที่อยากได้"\}\]/.test(brainsSrc),
    'schema ของ visualDreamShots ต้องเหมือนก่อน C-1 ทุก byte'
  );
});

// ═══════════════════════════ (1) inferBeatFromDreamShot — PURE unit ═══════════════════════════
// คืนค่าเป็น {beat, source} — source:'keyword' (มีหลักฐานจริงจาก description) | 'slot' (แค่ default เดา) | null

test('inferBeatFromDreamShot: ไม่มีคำบอกเวลาในคำอธิบาย → ใช้ default ตาม slot, source="slot" (reaction→ก่อน)', () => {
  assert.deepEqual(inferBeatFromDreamShot({ slot: 'reaction', description: 'ยิ้มให้กล้อง' }), { beat: 'ก่อน', source: 'slot' });
});

test('inferBeatFromDreamShot: ไม่มีคำบอกเวลา → default ตาม slot, source="slot" (action→ระหว่าง)', () => {
  assert.deepEqual(inferBeatFromDreamShot({ slot: 'action', description: 'วิ่งเข้าเส้นชัย' }), { beat: 'ระหว่าง', source: 'slot' });
});

test('inferBeatFromDreamShot: ไม่มีคำบอกเวลา → default ตาม slot, source="slot" (context→จบ)', () => {
  assert.deepEqual(inferBeatFromDreamShot({ slot: 'context', description: 'บรรยากาศงาน' }), { beat: 'จบ', source: 'slot' });
});

test('inferBeatFromDreamShot: ไม่มีคำบอกเวลา → default ตาม slot, source="slot" (evidence→จบ)', () => {
  assert.deepEqual(inferBeatFromDreamShot({ slot: 'evidence', description: 'จดหมายลาตาย' }), { beat: 'จบ', source: 'slot' });
});

test('inferBeatFromDreamShot: slot="hero" ไม่อยู่ในผัง default + ไม่มีคำบอกเวลา → {beat:null, source:null}', () => {
  assert.deepEqual(inferBeatFromDreamShot({ slot: 'hero', description: 'ยืนยิ้ม' }), { beat: null, source: null });
});

test('inferBeatFromDreamShot: slot ไม่รู้จัก/ว่าง/undefined + ไม่มีคำบอกเวลา → {beat:null, source:null}', () => {
  assert.deepEqual(inferBeatFromDreamShot({ slot: '', description: 'อะไรสักอย่าง' }), { beat: null, source: null });
  assert.deepEqual(inferBeatFromDreamShot({ description: 'อะไรสักอย่าง' }), { beat: null, source: null });
  assert.deepEqual(inferBeatFromDreamShot({}), { beat: null, source: null });
  assert.deepEqual(inferBeatFromDreamShot(null), { beat: null, source: null });
  assert.deepEqual(inferBeatFromDreamShot(undefined), { beat: null, source: null });
});

// ── [ผู้ตรวจ รอบ 2] คำสั้นเดี่ยวเดิมชนกับคำไทยทั่วไปที่ไม่เกี่ยวกัน — ต้องไม่ตกหลุมอีก (ต้องได้ source="slot" ไม่ใช่ "keyword") ──

test('[ผู้ตรวจ] "ครอบครัว" ต้องไม่ถูกจับเป็นคำว่า "รอ" (false-positive เดิม) — ได้ source="slot" ล้วน', () => {
  const r = inferBeatFromDreamShot({ slot: 'context', description: 'ภาพครอบครัวถ่ายรูปร่วมกัน' });
  assert.equal(r.source, 'slot', 'ต้องไม่มีวลีไหนแมตช์เลย — ตกไปที่ default ของ slot');
  assert.equal(r.beat, 'จบ'); // default ของ context
});

test('[ผู้ตรวจ] "รอยยิ้ม" ต้องไม่ถูกจับเป็นคำว่า "รอ" (false-positive เดิม) — ได้ source="slot" ล้วน', () => {
  const r = inferBeatFromDreamShot({ slot: 'reaction', description: 'รอยยิ้มของเธอในวันนั้น' });
  assert.equal(r.source, 'slot');
  assert.equal(r.beat, 'ก่อน'); // default ของ reaction
});

test('[ผู้ตรวจ] "เบื้องหลัง" ต้องไม่ถูกจับเป็นคำว่า "หลัง" (false-positive เดิม) — ได้ source="slot" ล้วน', () => {
  const r = inferBeatFromDreamShot({ slot: 'context', description: 'ภาพเบื้องหลังการถ่ายทำ' });
  assert.equal(r.source, 'slot');
  assert.equal(r.beat, 'จบ');
});

// ── [ผู้ตรวจ รอบ 3] 'กำลัง'/'ในสนาม' เดี่ยวเดิมชนคำถี่ในโดเมนข่าวซึ้ง/ชาวบ้าน — ต้องไม่ตกหลุมอีก ──

test('[ผู้ตรวจ] "กำลังใจจากแม่ทำให้ลูกสู้ต่อ" ต้องไม่ถูกจับเป็นคำว่า "กำลัง" (false-positive เดิม) — ได้ source="slot" ไม่ใช่ "keyword"', () => {
  const r = inferBeatFromDreamShot({ slot: 'context', description: 'กำลังใจจากแม่ทำให้ลูกสู้ต่อ' });
  assert.equal(r.source, 'slot', 'ต้องไม่มีวลีระหว่างวลีไหนแมตช์เลย ("กำลังใจ" ไม่ใช่ "กำลังจะ/กำลังแข่ง/ขณะกำลัง")');
  assert.equal(r.beat, 'จบ'); // default ของ context
});

test('[ผู้ตรวจ] "ภาพในสนามหญ้าหน้าบ้าน" ต้องไม่ถูกจับเป็นคำว่า "ในสนาม" (false-positive เดิม) — ได้ source="slot" ไม่ใช่ "keyword"', () => {
  const r = inferBeatFromDreamShot({ slot: 'context', description: 'ภาพในสนามหญ้าหน้าบ้าน' });
  assert.equal(r.source, 'slot', 'ต้องไม่มีวลีระหว่างวลีไหนแมตช์เลย ("ในสนามหญ้า" ไม่ใช่ "ในสนามแข่ง/กลางสนาม")');
  assert.equal(r.beat, 'จบ'); // default ของ context
});

test('[ผู้ตรวจ] "จบการศึกษา" เป็นวลีจริงในตาราง ต้องแมตช์เป็น source="keyword" ไม่ใช่บังเอิญจาก slot-default', () => {
  const r = inferBeatFromDreamShot({ slot: 'reaction', description: 'ภาพวันจบการศึกษา' });
  assert.deepEqual(r, { beat: 'จบ', source: 'keyword' });
});

// ── คำ/วลีบอกเวลาใน description ต้องชนะ default ของ slot เสมอ (เมื่อแมตช์จริง) ──

test('inferBeatFromDreamShot: description มีวลี "เตรียมตัว" (กลุ่มก่อน) แม้ slot=context (default จบ) → ชนะเป็น "ก่อน" source="keyword"', () => {
  assert.deepEqual(inferBeatFromDreamShot({ slot: 'context', description: 'กำลังเตรียมตัวก่อนขึ้นเวที' }), { beat: 'ก่อน', source: 'keyword' });
});

test('inferBeatFromDreamShot: description มีวลี "รอคอย" (กลุ่มก่อน) → "ก่อน" source="keyword"', () => {
  assert.deepEqual(inferBeatFromDreamShot({ slot: 'context', description: 'รอคอยอยู่หลังเวทีมานาน' }), { beat: 'ก่อน', source: 'keyword' });
});

test('inferBeatFromDreamShot: description มีวลี "ก่อนแข่ง" → "ก่อน" source="keyword"', () => {
  assert.deepEqual(inferBeatFromDreamShot({ slot: 'action', description: 'ยืดกล้ามเนื้อก่อนแข่งขัน' }), { beat: 'ก่อน', source: 'keyword' });
});

test('inferBeatFromDreamShot: description มีคำว่า "กำลัง" (กลุ่มระหว่าง) แม้ slot=reaction (default ก่อน) → ชนะเป็น "ระหว่าง" source="keyword"', () => {
  assert.deepEqual(inferBeatFromDreamShot({ slot: 'reaction', description: 'กำลังวิ่งอยู่กลางสนาม' }), { beat: 'ระหว่าง', source: 'keyword' });
});

test('inferBeatFromDreamShot: description มีวลี "ในสนาม" → "ระหว่าง" source="keyword"', () => {
  assert.deepEqual(inferBeatFromDreamShot({ slot: 'context', description: 'นักกีฬายืนอยู่ในสนามแข่งขัน' }), { beat: 'ระหว่าง', source: 'keyword' });
});

test('inferBeatFromDreamShot: description มีวลี "หลังจาก"/"หลังแข่ง" (กลุ่มจบ) แม้ slot=reaction (default ก่อน) → ชนะเป็น "จบ" source="keyword"', () => {
  assert.deepEqual(inferBeatFromDreamShot({ slot: 'reaction', description: 'ยิ้มดีใจหลังจากทราบผล' }), { beat: 'จบ', source: 'keyword' });
  assert.deepEqual(inferBeatFromDreamShot({ slot: 'reaction', description: 'ยิ้มดีใจหลังแข่งจบ' }), { beat: 'จบ', source: 'keyword' });
});

test('inferBeatFromDreamShot: description มีคำว่า "ชนะ"/"รับถ้วย" → "จบ" source="keyword"', () => {
  assert.deepEqual(inferBeatFromDreamShot({ slot: 'action', description: 'ชูมือฉลองหลังจากชนะ' }).beat, 'จบ');
  assert.deepEqual(inferBeatFromDreamShot({ slot: 'action', description: 'ยืนรับถ้วยรางวัลบนโพเดียม' }), { beat: 'จบ', source: 'keyword' });
});

test('inferBeatFromDreamShot: วลีโดเมนข่าวชาวบ้าน/ซึ้ง (ไม่ใช่แค่กีฬา) — "สมัยก่อน"/"ตอนเด็ก" → ก่อน · "ขณะที่"/"ในพิธี" → ระหว่าง · "ในที่สุด"/"ปัจจุบัน" → จบ', () => {
  assert.equal(inferBeatFromDreamShot({ slot: 'context', description: 'สมัยก่อนบ้านหลังนี้เคยรุ่งเรือง' }).beat, 'ก่อน');
  assert.equal(inferBeatFromDreamShot({ slot: 'context', description: 'ตอนเด็กเคยวิ่งเล่นแถวนี้' }).beat, 'ก่อน');
  assert.equal(inferBeatFromDreamShot({ slot: 'context', description: 'ขณะที่พิธีกำลังดำเนินอยู่' }).beat, 'ระหว่าง');
  assert.equal(inferBeatFromDreamShot({ slot: 'context', description: 'ยืนสงบนิ่งในพิธีศพ' }).beat, 'ระหว่าง');
  assert.equal(inferBeatFromDreamShot({ slot: 'context', description: 'ในที่สุดครอบครัวก็ได้กลับมาเจอกัน' }).beat, 'จบ');
  assert.equal(inferBeatFromDreamShot({ slot: 'context', description: 'ปัจจุบันใช้ชีวิตอย่างมีความสุข' }).beat, 'จบ');
});

test('inferBeatFromDreamShot: ตัวพิมพ์ใหญ่-เล็ก/ช่องว่างหัวท้ายของ slot ไม่กระทบผล (normalize ก่อนเทียบ)', () => {
  assert.deepEqual(inferBeatFromDreamShot({ slot: '  Action  ', description: 'ไม่มีวลีบอกเวลา' }), { beat: 'ระหว่าง', source: 'slot' });
});

// ── [ผู้ตรวจ รอบ 2] เคสหลายวลีชนกัน — ตำแหน่งท้ายสุดในประโยคต้องชนะ ไม่ใช่ลำดับกลุ่มที่ตรวจก่อน ──

test('[ผู้ตรวจ] เคสผสมของ Opus เป๊ะ: "หลังจากรอคอยมานาน ในที่สุดก็ชนะ" → ต้องได้ "จบ" (ไม่ใช่ "ก่อน" ที่เคยผิด)', () => {
  const r = inferBeatFromDreamShot({ slot: 'action', description: 'หลังจากรอคอยมานาน ในที่สุดก็ชนะ' });
  assert.equal(r.beat, 'จบ', 'วลีท้ายสุดในประโยค ("ชนะ") ต้องชนะ ไม่ใช่วลีแรก ("หลังจาก"/"รอคอย")');
  assert.equal(r.source, 'keyword');
});

test('มีหลายวลีบอกเวลาปนกัน (ทั่วไป) → เลือกวลีที่ตำแหน่งท้ายสุดในประโยคเสมอ ไม่ใช่ลำดับกลุ่ม ก่อน→ระหว่าง→จบ', () => {
  // "เตรียมตัว" (ก่อน) อยู่ต้นประโยค, "ในที่สุด" (จบ) อยู่ท้ายประโยค — ท้ายสุดต้องชนะ
  const r = inferBeatFromDreamShot({ slot: 'context', description: 'เตรียมตัวมาอย่างดีตั้งแต่ต้น ในที่สุดก็ทำสำเร็จ' });
  assert.equal(r.beat, 'จบ');
});

test('เท่ากันเป๊ะ (ตำแหน่งเดียวกัน — เคสหายากมาก): กลุ่มที่ตรวจก่อน (ก่อน) ชนะเป็น tie-break ที่นิ่ง', () => {
  // ออกแบบให้วลีทับตำแหน่งเดียวกันไม่ได้ในทางปฏิบัติ (วลีต่างกันคนละตัวอักษร) — เทสนี้ยืนยันแค่ว่าฟังก์ชันไม่ throw
  // และให้ผลลัพธ์ deterministic ซ้ำๆ กันทุกครั้งกับ input เดิม (ไม่ใช่สุ่ม)
  const shot = { slot: 'context', description: 'กำลังยืนรอคอยอยู่' }; // มีทั้ง "กำลัง"(ระหว่าง) และ "รอคอย"(ก่อน)
  const r1 = inferBeatFromDreamShot(shot);
  const r2 = inferBeatFromDreamShot(shot);
  assert.deepEqual(r1, r2, 'ผลลัพธ์ต้อง deterministic เรียกซ้ำได้ค่าเดิม');
});

// ═══════════════════════════ (2) storyFitOf timeline-beat bonus — source + parity ═══════════════════════════

test('source: STORY_TIMELINE_ON นิยามเป็น MEGA_STORY_TIMELINE !== \'0\' (default ON)', () => {
  assert.ok(/const STORY_TIMELINE_ON = process\.env\.MEGA_STORY_TIMELINE !== '0';/.test(src));
});

test('source: ROLE_EXPECTED_BEAT ดึงมาจาก BEAT_SLOT_DEFAULT เดียวกับ inferBeatFromDreamShot (กันสองชุดตัวเลขหลุดไม่ตรงกัน)', () => {
  assert.ok(
    /const ROLE_EXPECTED_BEAT = \{ reaction: BEAT_SLOT_DEFAULT\.reaction, action: BEAT_SLOT_DEFAULT\.action, context: BEAT_SLOT_DEFAULT\.context \};/.test(src)
  );
});

test('source: BEAT_SLOT_DEFAULT/BEAT_KEYWORDS โปร่งใส ตรวจสอบได้ตรงในซอร์ส — ไม่มีคำเดี่ยวสั้นๆ (รอ/หลัง/จบ) เหลืออยู่เลย', () => {
  assert.ok(/const BEAT_SLOT_DEFAULT = \{ reaction: 'ก่อน', action: 'ระหว่าง', context: 'จบ', evidence: 'จบ' \};/.test(src));
  // ตารางต้องมีวลีที่ระบุไว้ (ยาว/เจาะจง)
  assert.ok(/ก่อน: \['รอคอย', 'ระหว่างรอ', 'ก่อนแข่ง', 'เตรียมตัว', 'ก่อนหน้านี้', 'สมัยก่อน', 'ตอนเด็ก'\],/.test(src));
  assert.ok(/จบ: \['หลังจาก', 'หลังจบ', 'หลังแข่ง', 'ชนะ', 'รับถ้วย', 'สิ้นสุด', 'จบการแข่ง', 'จบการศึกษา', 'ในที่สุด', 'สุดท้าย', 'ปัจจุบัน', 'ทุกวันนี้'\],/.test(src));
  // ★ ผู้ตรวจ: ห้ามมีคำเดี่ยวสั้นๆ ที่เคยเป็นบั๊กเหลืออยู่ในตารางเป็น "รายการเดี่ยว" (ตรวจแบบคำอยู่ในเครื่องหมายคำพูดเดี่ยวๆ ล้อมด้วย , หรือ ] ตรงๆ)
  const kwBlock = src.match(/const BEAT_KEYWORDS = \{[\s\S]*?\n\};/)[0];
  assert.ok(!/'รอ',/.test(kwBlock), 'ห้ามมีคำเดี่ยว "รอ" เป็นรายการในตาราง (บั๊กเดิม)');
  assert.ok(!/'หลัง',/.test(kwBlock), 'ห้ามมีคำเดี่ยว "หลัง" เป็นรายการในตาราง (บั๊กเดิม)');
  assert.ok(!/'จบ',/.test(kwBlock), 'ห้ามมีคำเดี่ยว "จบ" เป็นรายการในตาราง (บั๊กเดิม)');
  assert.ok(!/'เตรียม',/.test(kwBlock), 'ห้ามมีคำเดี่ยว "เตรียม" เป็นรายการในตาราง');
});

test('source: _matchLatestBeatKeyword ใช้ lastIndexOf (ตำแหน่งท้ายสุดชนะ) ไม่ใช่ indexOf/includes ตัวแรกที่เจอ', () => {
  assert.ok(/function _matchLatestBeatKeyword\(desc\)/.test(src));
  assert.ok(/const pos = desc\.lastIndexOf\(kw\);/.test(src), 'ต้องใช้ lastIndexOf ไม่ใช่ indexOf/includes');
  assert.ok(/if \(!best \|\| pos > best\.pos\) best = \{ beat, pos \};/.test(src), 'ต้องเลือกตำแหน่งมากสุด (ท้ายสุด) เป็นผู้ชนะ');
});

test('source: inferBeatFromDreamShot คืน {beat, source} เสมอ (ไม่ใช่ string เดี่ยวแบบเดิม)', () => {
  assert.ok(/return \{ beat: kwBeat, source: 'keyword' \};/.test(src));
  assert.ok(/return slotBeat \? \{ beat: slotBeat, source: 'slot' \} : \{ beat: null, source: null \};/.test(src));
});

test('source: storyFitOf รับ roleKey เป็นพารามิเตอร์ที่ 2 (optional)', () => {
  assert.ok(/const storyFitOf = \(x, roleKey\) => \{/.test(src));
});

test('source: cache key แยกตาม roleKey เฉพาะเมื่อ STORY_TIMELINE_ON+มี roleKey (ไม่งั้น cache key เดิม = id ล้วน)', () => {
  assert.ok(/const cacheKey = \(STORY_TIMELINE_ON && roleKey\) \? `\$\{id\}::\$\{roleKey\}` : id;/.test(src));
});

test('source: storyRank เป็น curried (roleKey) => comparator — thread roleKey เข้า _combinedStory', () => {
  assert.ok(/const storyRank = \(roleKey\) => \(a, b\) => \{/.test(src));
  assert.ok(/\.sort\(storyRank\(_legacyKeyOf\(slot\)\)\)/.test(src), 'จุดเรียก storyRank ต้อง curry ด้วย roleKey จริง');
});

test('[ผู้ตรวจ] source: beat-match bonus ต้องเช็ค inferred.source === \'keyword\' ก่อนเสมอ (ฆ่า tautology — ไม่นับ source==="slot")', () => {
  assert.ok(
    /const inferred = inferBeatFromDreamShot\(v\);\s*\n\s*if \(inferred\.source !== 'keyword' \|\| inferred\.beat !== expectedBeat\) return false;/.test(src),
    'ต้องปฏิเสธทันทีถ้า source ไม่ใช่ keyword (แม้ beat จะดันตรงกันพอดีจาก slot-default ก็ตาม)'
  );
});

// จำลอง beat-match logic แบบ pure (คัดลอกตรงจากซอร์ส, ใช้ inferBeatFromDreamShot จริงที่ import มา) — ยืนยันค่าจริง
// ตาม role/shot/switch ต่างๆ
function beatMatchBonus({ roleKey, dreamShots, note, timelineOn = true }) {
  const ROLE_EXPECTED_BEAT = { reaction: 'ก่อน', action: 'ระหว่าง', context: 'จบ' };
  if (!timelineOn || !roleKey || !ROLE_EXPECTED_BEAT[roleKey] || !note || !dreamShots.length) return 0;
  const expectedBeat = ROLE_EXPECTED_BEAT[roleKey];
  const _lc = (s) => String(s || '').trim().toLowerCase();
  const match = dreamShots.some((v) => {
    if (!v || _lc(v.slot) !== roleKey) return false;
    const inferred = inferBeatFromDreamShot(v);
    if (inferred.source !== 'keyword' || inferred.beat !== expectedBeat) return false;
    const desc = _lc(v.description);
    return !!desc && note.split(/\s+/).some((w) => w.length >= 3 && desc.includes(w));
  });
  return match ? 1 : 0;
}

test('[ผู้ตรวจ] tautology ตายแล้ว: role=context + shot slot=context ไม่มีวลีบอกเวลาเลย (จะได้ beat=จบ จาก slot-default พอดี) → bonus ต้องเป็น 0 (ไม่ใช่ 1 เหมือนบั๊กเดิม)', () => {
  const bonus = beatMatchBonus({
    roleKey: 'context',
    dreamShots: [{ slot: 'context', description: 'บรรยากาศงานทั่วไป ไม่มีคำบอกเวลาอะไรเลย' }],
    note: 'ภาพบรรยากาศงานทั่วไป',
  });
  assert.equal(bonus, 0, 'slot ตรง role อยู่แล้ว (context) + default beat ก็ตรงพอดี (จบ) แต่ไม่มีหลักฐาน keyword จริง — ต้องไม่ได้ bonus');
});

test('parity: role=context + shot มีวลี "ในที่สุด" จริง (source=keyword ตรง จบ) + note ตรงคำอธิบาย → bonus +1', () => {
  const bonus = beatMatchBonus({
    roleKey: 'context',
    dreamShots: [{ slot: 'context', description: 'สมชาย ยืนหน้าบ้านเก่า ในที่สุดก็ได้กลับมา' }],
    note: 'ภาพ สมชาย ยืนหน้าบ้านเก่า',
  });
  assert.equal(bonus, 1, 'มีวลี "ในที่สุด" จริงในคำอธิบาย = หลักฐาน keyword ตรงกับ expected ของ context (จบ)');
});

test('parity: role=reaction + shot description มีคำ "กำลัง" (อนุมานเป็นระหว่าง จาก keyword) แทนที่จะเป็นก่อน (default reaction) → bonus 0', () => {
  const bonus = beatMatchBonus({
    roleKey: 'reaction',
    dreamShots: [{ slot: 'reaction', description: 'กำลังร้องไห้ตื้นตัน' }],
    note: 'ภาพกำลังร้องไห้ตื้นตัน',
  });
  assert.equal(bonus, 0, 'คำ "กำลัง" อนุมานเป็นระหว่าง (keyword) ขัดกับ expected ก่อนของ reaction — ไม่ตรง = ไม่ได้ bonus');
});

test('parity: role=circle (ไม่อยู่ใน ROLE_EXPECTED_BEAT) → bonus 0 เสมอไม่ว่า shot จะอนุมานเป็นอะไร', () => {
  const bonus = beatMatchBonus({
    roleKey: 'circle',
    dreamShots: [{ slot: 'circle', description: 'ในที่สุดก็เจอกันอีกครั้ง' }],
    note: 'ในที่สุดก็เจอกันอีกครั้ง',
  });
  assert.equal(bonus, 0);
});

test('parity: MEGA_STORY_TIMELINE=0 (timelineOn=false) → bonus 0 เสมอแม้ทุกอย่างตรงเป๊ะ (byte-parity)', () => {
  const bonus = beatMatchBonus({
    roleKey: 'context',
    dreamShots: [{ slot: 'context', description: 'ในที่สุดก็ยืนหน้าบ้านเก่า' }],
    note: 'ในที่สุดก็ยืนหน้าบ้านเก่า',
    timelineOn: false,
  });
  assert.equal(bonus, 0);
});

test('parity: ไม่มี roleKey เลย (เรียกแบบเดิม storyFitOf(x) เดี่ยวๆ เช่น diagnostic log) → bonus 0 เสมอ', () => {
  const bonus = beatMatchBonus({
    roleKey: undefined,
    dreamShots: [{ slot: 'context', description: 'ในที่สุดก็ยืนหน้าบ้านเก่า' }],
    note: 'ในที่สุดก็ยืนหน้าบ้านเก่า',
  });
  assert.equal(bonus, 0);
});

test('parity: dream shot slot ไม่ตรง role ที่กำลังให้คะแนน (shot เป็น context แต่กำลังให้คะแนน action) → bonus 0', () => {
  const bonus = beatMatchBonus({
    roleKey: 'action',
    dreamShots: [{ slot: 'context', description: 'กำลังทำอะไรสักอย่าง' }],
    note: 'ภาพกำลังทำอะไรสักอย่าง',
  });
  assert.equal(bonus, 0, 'shot ประกาศไว้สำหรับ context ไม่ใช่ action — ไม่ควรให้ bonus ข้าม role');
});

test('parity: shot ไม่มี description เลย (slot=action, default ระหว่าง) + note ไม่ว่าง → bonus 0 (source=slot ไม่ใช่ keyword)', () => {
  const bonus = beatMatchBonus({
    roleKey: 'action',
    dreamShots: [{ slot: 'action' }],
    note: 'ภาพกำลังทำอะไรสักอย่าง',
  });
  assert.equal(bonus, 0, 'description ว่าง → ไม่มีทางได้ source=keyword เลย');
});

test('source: slotDirectorBrain มี prose ลำดับไทม์ไลน์เดิมอยู่แล้ว (rule 15) — ยืนยันว่า ROLE_EXPECTED_BEAT สอดคล้องกับสิ่งที่สอน LLM ไว้จริง ไม่ใช่เดาขึ้นมาใหม่', () => {
  assert.ok(
    /ช่องย่อย reaction\/action\/context เรียงไทม์ไลน์เล่าเรื่อง: บริบท\/ที่มา → โมเมนต์หัวใจ → ผลลัพธ์\/จุดพลิก/.test(brainsSrc),
    'ต้องมี prose นี้อยู่จริงใน slotDirectorBrain (rule 15) — ยืนยันว่า reaction→action→context คือลำดับก่อน→ระหว่าง→จบ ที่มีอยู่แล้ว'
  );
});

console.log('story-timeline-c1: all tests defined via node:test — see summary above');
