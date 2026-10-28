// 📐 ข้อสอบขั้น บก.จัดหน้า (ขั้นสุดท้าย · 28 ต.ค. 69) — จำลองโมเดล ไม่ยิง API จริง
//   A. สวิตช์ปิดค่าเริ่มต้น · ต่อท่อเฉพาะสาย TEXT หลังด่านทุกด่าน ก่อนบันทึกผลสุดท้าย · ส่งตัวตรวจซ้ำ
//   B. แกะคำตอบแท็ก (เนื้อข่าวมีเครื่องหมายคำพูดได้) · จัดรูปบรรทัด/ช่องว่างมาตรฐาน
//   C. ด่านโค้ด: เปลี่ยนแค่ชนิดช่องว่างเดิม = ผ่าน · ตัวอักษรเปลี่ยน/ช่องว่างย้าย-เพิ่ม-ลบ/ตัดบรรทัดหลัง "ว่า"/บรรทัดเกิน = ไม่ผ่าน
//      (ตารางเคสของผู้ตรวจอิสระ 28 ต.ค. รอบ 1–2 ต้องถูกตีตกทั้งหมด)
//   D. ทั้งชุด: ไม่ผ่านด่าน/ตรวจซ้ำแย่ลง = ฉบับเดิมทุกไบต์ · ล้ม = ฉบับเดิม + คำเตือน · ผ่าน = เนื้อใหม่ title/provenance เดิม + เก็บฉบับก่อนจัด
//   E. เวลา: เหลือน้อย = ข้ามไม่เรียกโมเดล · หมดเวลาทั้งขั้น = ฉบับที่เสร็จแล้วยังใช้
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const { createJiti } = require('jiti');
const jiti = createJiti(import.meta.url, { alias: { '@': `${ROOT}src` }, interopDefault: true });
const LE = await jiti.import(`${ROOT}src/lib/services/layoutEditor.js`);
const { createPipelineDeadline, runWithPipelineDeadline } = await jiti.import(`${ROOT}src/lib/utils/pipelineDeadline.js`);

const withEnv = async (vars, fn) => {
  const keep = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

// ข่าวสมมติ (ไม่ใช่ข่าวจริง) รูปแบบสามย่อหน้าแบบที่ท่อเขียนออกมา
const BEFORE = [
  'เกรด 3.95 แต่แทบไม่มีเงินค่ารถไปโรงเรียน วันนี้ "น้องมะลิ ใจดี" ได้เป็นพยาบาลประจำโรงพยาบาลชุมชนบ้านนา',
  'กว่าจะมาถึงวันนี้ พ่อป่วยหนักต้องฟอกไตสัปดาห์ละ 2 ครั้ง แม่รับจ้างทั่วไปได้วันละ 300 บาท โรงเรียนอยู่ไกล 40 กิโลเมตร น้องต้องยืมเงินเพื่อนบ้านเป็นค่ารถเกือบทุกสัปดาห์ จนครูประจำชั้นส่งเรื่องขอทุนให้ และน้องได้ทุนเรียนต่อจนจบ',
  'น้องบอกว่า "หนูอยากกลับมาดูแลคนในหมู่บ้านที่เคยช่วยหนู" วันนี้ความฝันนั้นเป็นจริงแล้ว',
].join('\n\n');
// ถ้อยคำเดิมทุกตัว ช่องว่างตำแหน่งเดิมทุกจุด เปลี่ยนแค่ชนิดช่อง (เว้นวรรค → ขึ้นบรรทัด/ย่อหน้า)
const AFTER = [
  'เกรด 3.95 แต่แทบไม่มีเงินค่ารถไปโรงเรียน\nวันนี้ "น้องมะลิ ใจดี" ได้เป็นพยาบาลประจำโรงพยาบาลชุมชนบ้านนา',
  'กว่าจะมาถึงวันนี้ พ่อป่วยหนักต้องฟอกไตสัปดาห์ละ 2 ครั้ง\nแม่รับจ้างทั่วไปได้วันละ 300 บาท',
  'โรงเรียนอยู่ไกล 40 กิโลเมตร น้องต้องยืมเงินเพื่อนบ้านเป็นค่ารถเกือบทุกสัปดาห์',
  'จนครูประจำชั้นส่งเรื่องขอทุนให้ และน้องได้ทุนเรียนต่อจนจบ',
  'น้องบอกว่า "หนูอยากกลับมาดูแลคนในหมู่บ้านที่เคยช่วยหนู"',
  'วันนี้ความฝันนั้นเป็นจริงแล้ว',
].join('\n\n');
const reply = (post) => `<understanding>น้องมะลิเรียนเก่งแต่ยากจน ได้ทุนจนเป็นพยาบาล</understanding>\n<issues>ย่อหน้ากลางยาวเป็นก้อน</issues>\n<layout>แยกตามจังหวะเรื่อง</layout>\n<post>\n${post}\n</post>`;
const version = (content, extra = {}) => ({ title: 'หัวข่าวเดิม', content, promptId: 'card_1', usedModel: 'claude-opus-4-8', _source: 'classic', _sourceLabel: 'การ์ด', ...extra });

test('A1 สวิตช์ปิดค่าเริ่มต้น · เปิดเฉพาะ LAYOUT_EDIT=1', async () => {
  await withEnv({ LAYOUT_EDIT: undefined }, () => assert.equal(LE.isLayoutEditEnabled(), false));
  await withEnv({ LAYOUT_EDIT: 'true' }, () => assert.equal(LE.isLayoutEditEnabled(), false));
  await withEnv({ LAYOUT_EDIT: '0' }, () => assert.equal(LE.isLayoutEditEnabled(), false));
  await withEnv({ LAYOUT_EDIT: '1' }, () => assert.equal(LE.isLayoutEditEnabled(), true));
  await withEnv({ LAYOUT_EDIT: ' "1" ' }, () => assert.equal(LE.isLayoutEditEnabled(), true, 'ทนช่องว่าง/อัญประกาศแบบสวิตช์อื่นของระบบ'));
});

test('A2 ต่อท่อ: ขั้นสุดท้ายหลังด่านเพศ/ข้อมูลหาย ก่อนบันทึกผล · เฉพาะ text/plain_text · ส่งข่าวดิบ + ตัวตรวจซ้ำ', () => {
  const src = readFileSync(`${ROOT}src/lib/services/autoFlowServiceText.js`, 'utf8');
  const at = src.indexOf('isLayoutEditEnabled() &&');
  assert.ok(at > 0, 'ต้องเรียกหลังเช็คสวิตช์');
  for (const before of ['assessRawTextSafety(finalVersions', 'neutralizeGuessedGender(finalVersions', 'annotateMissingRawFacts(finalVersions', 'isAdminVoiceEditEnabled() &&']) {
    assert.ok(at > src.indexOf(before), `ต้องอยู่หลัง ${before}`);
  }
  assert.ok(at < src.indexOf('buildPublishableAnalysisResult({'), 'ต้องอยู่ก่อนประกอบผลสุดท้าย');
  assert.ok(at < src.indexOf('saveAnalysis(_autoWorkflowId'), 'ต้องอยู่ก่อนบันทึกผล');
  const line = src.slice(at, src.indexOf('\n', at));
  assert.match(line, /detectedType === 'text' \|\| detectedType === 'plain_text'/);
  assert.match(src.slice(at, at + 1600), /runLayoutEdit\(finalVersions, \{ rawText, recheck: _layoutRecheck \}\)/);
});

test('B1 แกะแท็ก: เนื้อมีเครื่องหมายคำพูดได้ · ไม่มีแท็กปิด post ก็แกะได้ · ไม่มีแท็ก = post ว่าง', () => {
  const p = LE.parseLayoutReply(reply(AFTER));
  assert.equal(p.post, AFTER);
  assert.equal(p.issues, 'ย่อหน้ากลางยาวเป็นก้อน');
  assert.equal(LE.parseLayoutReply(`<post>\n${AFTER}`).post, AFTER);
  assert.equal(LE.parseLayoutReply('ตอบเป็นข้อความเฉยๆ').post, '');
});

test('B2 จัดรูปบรรทัด: ตัวขึ้นบรรทัดทุกแบบ → \\n · NBSP/แท็บ → เว้นวรรค · ตัด BOM แต่คง ZWSP/ZWJ · ช่องซ้อน/หัวท้ายบรรทัด', () => {
  assert.equal(LE.tidyLayout('ก  \r\n\r\n\r\nข\t\nค\n\n\n\n'), 'ก\n\nข\nค');
  assert.equal(LE.tidyLayout('ก\u2028ข\u2029\u2029ค\u00A0\u00A0ง  จ\u200Bฉ\uFEFF'), 'ก\nข\n\nค ง จ\u200Bฉ');
  assert.equal(LE.tidyLayout('👨\u200D👩\u200D👧 ครอบครัว'), '👨\u200D👩\u200D👧 ครอบครัว', 'อีโมจิรวมไม่แตก');
});

test('C1 ด่าน: แยกเว้นวรรคเดิมเป็นบรรทัด/ย่อหน้า · บรรทัด↔ย่อหน้า = ผ่าน · ตัวล่องหนไม่นับ', () => {
  assert.deepEqual(LE.checkLayoutEdit(BEFORE, AFTER), { ok: true, reasons: [] });
  assert.deepEqual(LE.checkLayoutEdit(BEFORE, BEFORE.replace(/\n\n/g, '\n')), { ok: true, reasons: [] }, 'ย่อหน้า → ขึ้นบรรทัด (ยังแยกกัน)');
  assert.deepEqual(LE.checkLayoutEdit(BEFORE, AFTER.replace('น้องบอกว่า "หนู', 'น้องบอกว่า\n"หนู')), { ok: true, reasons: [] }, 'ขึ้นบรรทัดหลัง "ว่า" ได้เมื่อบรรทัดถัดไปเปิดด้วยเครื่องหมายคำพูด');
  assert.deepEqual(LE.checkLayoutEdit(BEFORE.replace('ใจดี"', 'ใจ\u200Bดี"'), AFTER, { minWords: 0 }), { ok: true, reasons: [] }, 'ต้นฉบับมี ZWSP แต่ฉบับจัดไม่มี = ตัวอักษรตรง (เพดานคำปิดในข้อนี้ · ข้อ C2 ตรวจเพดานคำ)');
});

// ★ ผู้ตรวจอิสระ 28 ต.ค. รอบ 1–2: ด่านก่อนหน้าปล่อยทุกเคสนี้ผ่าน — ด่านนี้ต้องตีตกทั้งหมด
test('C2 ด่านกัดทุกเคสเปลี่ยนความหมาย: คำ/ตัวเลข/คน/คำพูด/ลำดับ/คำเชื่อม/ช่องว่างย้าย-เพิ่ม-ลบ/ตัดบรรทัดหลัง "ว่า"/บรรทัดเกิน', () => {
  const bad = (before, after, label, re) => {
    const g = LE.checkLayoutEdit(before, after);
    assert.equal(g.ok, false, `ต้องไม่ผ่าน: ${label}`);
    assert.ok(g.reasons.some((r) => re.test(r)), `${label}: เหตุต้องตรง ${re} ได้ ${g.reasons.join(' · ')}`);
  };
  const word = (after, label) => bad(BEFORE, after, label, /ถ้อยคำเปลี่ยน/);
  word(AFTER.replace('แทบไม่มีเงิน', 'แทบมีเงิน'), 'ตัดคำปฏิเสธ (ความหมายกลับขั้ว)');
  word(AFTER.replace('300 บาท', '3,000 บาท'), 'เงินผิด 10 เท่า');
  word(AFTER.replace('300 บาท', 'สามร้อยบาท'), 'ตัวเลขเป็นคำไทย');
  word(AFTER.replace('ไกล 40 กิโลเมตร', 'ไกล 2 กิโลเมตร').replace('ละ 2 ครั้ง', 'ละ 40 ครั้ง'), 'สลับตัวเลขระหว่างสองที่');
  word(AFTER.replace('แม่รับจ้าง', 'พ่อรับจ้าง').replace('พ่อป่วยหนัก', 'แม่ป่วยหนัก'), 'สลับคน');
  word(AFTER.replace('น้องต้องยืมเงิน', 'น้องมะลิต้องยืมเงิน'), 'ใส่ชื่อแทนสรรพนาม');
  word(AFTER.replace('น้องต้องยืมเงิน', 'เธอต้องยืมเงิน'), 'เปลี่ยนเป็น "เธอ"');
  word(AFTER.replace('จนจบ', 'จนจบ ก่อนพ่อจะเสียชีวิต'), 'แต่งเหตุการณ์เพิ่ม');
  word(AFTER.replace('วันนี้ความฝันนั้นเป็นจริงแล้ว', 'วันนี้ความฝันนั้นเป็นจริงแล้ว "ขอบคุณทุกคน"'), 'แต่งคำพูดเพิ่ม');
  word(AFTER.replace('ดูแลคนในหมู่บ้าน', 'ดูแลทุกคนในหมู่บ้าน'), 'แก้คำในเครื่องหมายคำพูด');
  word(AFTER.replace('\n\nวันนี้ความฝันนั้นเป็นจริงแล้ว', ''), 'ตัดประโยคปิด');
  word(AFTER.replace('เกรด 3.95 แต่แทบ', 'เกรด 3.95 ทั้งที่แทบ'), 'แก้ประโยคเปิด');
  word(AFTER.split('\n\n').reverse().join('\n\n'), 'สลับลำดับย่อหน้า');
  word(AFTER.replace('ให้ และน้องได้ทุน', 'ให้\nน้องได้ทุน'), 'ตัดคำเชื่อม "และ"');
  word(AFTER.replace('โรงเรียนอยู่ไกล', 'ส่วนโรงเรียนอยู่ไกล'), 'เติมคำเชื่อม "ส่วน"');
  word(AFTER.replace('วันนี้ความฝันนั้นเป็นจริงแล้ว', 'แอดว่าวันนี้ความฝันนั้นเป็นจริงแล้ว'), 'เติมคำแทนตัวแอด');
  word(AFTER.replace('วันนี้ความฝันนั้นเป็นจริงแล้ว', 'วันนี้ความฝันนั้นเป็นจริงแล้ว 🎉'), 'เติมอีโมจิ');
  word(AFTER.replace('วันนี้ความฝันนั้นเป็นจริงแล้ว', '**วันนี้ความฝันนั้นเป็นจริงแล้ว**'), 'เติม markdown');
  word(AFTER.replace('"น้องมะลิ ใจดี"', 'น้องมะลิ ใจดี'), 'ลบเครื่องหมายคำพูด');
  bad(BEFORE, AFTER.replace('ไปโรงเรียน\nวันนี้', 'ไปโรงเรียนวันนี้'), 'ลบช่องว่างเดิม', /ลบช่องว่างเดิม/);
  bad(BEFORE, AFTER.replace('ได้เป็นพยาบาล', 'ได้เป็น\nพยาบาล'), 'ขึ้นบรรทัดกลางวลี', /กลางวลี/);
  bad(BEFORE, AFTER.replace('ได้เป็นพยาบาล', 'ได้เป็น พยาบาล'), 'เว้นวรรคเพิ่มกลางวลี', /กลางวลี/);
  bad('แม่ไม่ได้ทิ้ง ลูกไปทำงานต่างประเทศเพื่อหาเงิน', 'แม่ไม่ได้ทิ้งลูก\nไปทำงานต่างประเทศเพื่อหาเงิน', 'ย้ายช่องว่างจนคนทำเปลี่ยน', /ลบช่องว่างเดิม|กลางวลี/);
  bad('ตำรวจตรวจแล้วไม่พบ ยาเสพติดอยู่ในรถคันนั้น', 'ตำรวจตรวจแล้วไม่พบยาเสพติด\nอยู่ในรถคันนั้น', 'ย้ายช่องว่างหลังคำปฏิเสธ', /ลบช่องว่างเดิม|กลางวลี/);
  bad('ทนายของฝ่ายหญิงระบุว่า ต้นเป็นคนลงมือทำร้ายก่อน', 'ทนายของฝ่ายหญิงระบุว่า\n\nต้นเป็นคนลงมือทำร้ายก่อน', 'ข้อกล่าวหาแยกเป็นย่อหน้าของเพจ', /ว่า/);
  bad('แพทย์ระบุว่า การกินสมุนไพรนี้อาจช่วยลดอาการได้', 'แพทย์ระบุว่า\nการกินสมุนไพรนี้อาจช่วยลดอาการได้', 'ข้อความสุขภาพหลุดจากผู้พูด', /ว่า/);
  bad('ปุ๊ก บอกว่า ไม่ได้ตั้งใจ', 'ปุ\n๊ก บอกว่า ไม่ได้ตั้งใจ', 'ขึ้นบรรทัดกลางตัวอักษร', /กลางวลี/);
  const twice = `${BEFORE} ${BEFORE}`.replace(/\n+/g, ' ');
  bad(twice, [...twice].map((c) => (c === ' ' ? String.fromCharCode(0x2028) : c)).join(''), 'ขึ้นบรรทัดด้วย U+2028 ทุกช่อง (>24 บรรทัด)', /บรรทัดมากเกิน/);
  bad(BEFORE, '', 'ว่าง', /ว่าง/);
  // ★ รอบ 3
  bad(BEFORE, BEFORE.replace(/\n\n/g, ' '), 'รวมย่อหน้าเป็นเว้นวรรค', /รวมบรรทัด/);
  bad('ปุ๊กบอกว่าเสียใจมากที่เกิดเรื่องนี้\n\nต้นเป็นคนเริ่มก่อนตามที่ทนายระบุ', 'ปุ๊กบอกว่าเสียใจมากที่เกิดเรื่องนี้ ต้นเป็นคนเริ่มก่อนตามที่ทนายระบุ', 'รวมย่อหน้าจนคำกล่าวหาไปเกาะคนอื่น', /รวมบรรทัด/);
  bad('😢 ทนายของฝ่ายหญิงระบุว่า ต้นเป็นคนลงมือทำร้ายก่อน', '😢 ทนายของฝ่ายหญิงระบุว่า\n\nต้นเป็นคนลงมือทำร้ายก่อน', 'อีโมจิอยู่ก่อน "ว่า" (ตำแหน่ง UTF-16 เลื่อน)', /แยกผู้พูด/);
  bad('ตำรวจเผย ผู้ต้องหารับสารภาพแล้วทุกข้อหา', 'ตำรวจเผย\n\nผู้ต้องหารับสารภาพแล้วทุกข้อหา', 'ขึ้นย่อหน้าหลัง "เผย"', /แยกผู้พูด/);
  bad('ทนายฝ่ายหญิงอ้าง ต้นเป็นคนลงมือทำร้ายก่อน', 'ทนายฝ่ายหญิงอ้าง\nต้นเป็นคนลงมือทำร้ายก่อน', 'ขึ้นบรรทัดหลัง "อ้าง"', /แยกผู้พูด/);
  bad('ทนายฝ่ายหญิงระบุ: ต้นเป็นคนลงมือทำร้ายก่อน', 'ทนายฝ่ายหญิงระบุ:\n\nต้นเป็นคนลงมือทำร้ายก่อน', 'ขึ้นย่อหน้าหลัง ":"', /แยกผู้พูด/);
  bad('ต้นเป็นคนเริ่มก่อน ตามที่ทนายของฝ่ายหญิงระบุ', 'ต้นเป็นคนเริ่มก่อน\n\nตามที่ทนายของฝ่ายหญิงระบุ', 'แยกข้อความออกจากที่มาท้ายประโยค', /ที่มา/);
  // ★ รอบ 4: คำรายงานที่ข่าวบันเทิงใช้บ่อย
  bad('บุ๋มซัด ต้นเป็นคนลงมือทำร้ายก่อน', 'บุ๋มซัด\n\nต้นเป็นคนลงมือทำร้ายก่อน', 'ขึ้นย่อหน้าหลัง "ซัด"', /แยกผู้พูด/);
  bad('ทนายให้สัมภาษณ์ ต้นเป็นคนลงมือทำร้ายก่อน', 'ทนายให้สัมภาษณ์\nต้นเป็นคนลงมือทำร้ายก่อน', 'ขึ้นบรรทัดหลัง "ให้สัมภาษณ์" (คำยาว 11 ตัว)', /แยกผู้พูด/);
  bad('ฝ่ายหญิงชี้แจง เงินทั้งหมดโอนคืนแล้ว', 'ฝ่ายหญิงชี้แจง\n\nเงินทั้งหมดโอนคืนแล้ว', 'ขึ้นย่อหน้าหลัง "ชี้แจง"', /แยกผู้พูด/);
  const zw = Array.from({ length: 60 }, () => 'น้ำ\u200Bตา\u200Bไหล').join(' ');
  bad(zw, zw.replace(/\u200B/g, ''), 'ตัวล่องหนหายจนคำต่ำกว่า 146 (ICU นับต่างกัน)', /คำลด/);
});

test('C3 ด่าน: ข้อความยาว ~3,000 ตัวอักษรตรวจเร็ว (ไม่มีตารางเทียบ)', () => {
  const long = Array.from({ length: 200 }, (_, i) => `ประโยคที่ ${i} ยาวพอสมควร`).join(' ');
  const t0 = Date.now();
  assert.deepEqual(LE.checkLayoutEdit(long, long.replace(/ ประโยคที่ 1(\d) /g, '\nประโยคที่ 1$1 ')), { ok: true, reasons: [] });
  assert.equal(LE.checkLayoutEdit(long, `${long} และ`).ok, false);
  assert.ok(Date.now() - t0 < 500);
});

test('C6 ข้อความส่งจริงประกอบจากตัวอักษรฉบับเดิม: คงตัวล่องหนเดิม · ไม่รับตัวล่องหนที่โมเดลแทรก · ใช้ชนิดช่องจากฉบับจัด', () => {
  assert.equal(LE.rebuildLayout(BEFORE, AFTER), AFTER);
  const zwBefore = BEFORE.replace('ใจดี"', 'ใจ\u200Bดี"');
  assert.equal(LE.rebuildLayout(zwBefore, AFTER), AFTER.replace('ใจดี"', 'ใจ\u200Bดี"'), 'ZWSP เดิมยังอยู่ แม้โมเดลตัดทิ้ง');
  const injected = AFTER.replace('พยาบาล', 'พยา\u200Dบาล').replace('300', '3\u206000');
  assert.equal(LE.checkLayoutEdit(BEFORE, injected).ok, true, 'ด่านไม่นับตัวล่องหน');
  assert.equal(LE.rebuildLayout(BEFORE, injected), AFTER, 'ตัวล่องหนที่โมเดลแทรกไม่ไปถึงข้อความส่งจริง');
  assert.equal(LE.rebuildLayout(BEFORE, AFTER.replace('300', '301')), null, 'ตัวอักษรไม่ตรง = ประกอบไม่ได้');
});

test('C7 จัด 1 ฉบับ: ผลส่งจริง = ประกอบจากฉบับเดิม (โมเดลแทรกตัวล่องหน → ไม่ติดไป)', async () => {
  const r = await LE.editOneLayout({ text: BEFORE, callModel: async () => reply(AFTER.replace('พยาบาล', 'พยา\u200Dบาล')) });
  assert.equal(r.ok, true);
  assert.equal(r.text, AFTER);
});

test('C5 จัด 1 ฉบับ: ไม่ผ่านด่าน = คืนเนื้อเดิม · ผ่าน = เนื้อใหม่ที่จัดรูปบรรทัดแล้ว', async () => {
  const bad = await LE.editOneLayout({ text: BEFORE, callModel: async () => reply(AFTER.replace('40 กิโลเมตร', 'สี่สิบกิโลเมตร')) });
  assert.equal(bad.ok, false);
  assert.equal(bad.text, BEFORE);
  const good = await LE.editOneLayout({ text: BEFORE, callModel: async () => reply(`${AFTER.replace(/\n\n/g, '\n\n\n')}   `) });
  assert.equal(good.ok, true);
  assert.equal(good.text, AFTER);
});

test('D1 ทั้งชุด: ผ่าน = เนื้อใหม่ + เก็บฉบับก่อนจัด · ไม่ผ่านด่าน = ฉบับเดิมทุกไบต์ไม่มีคำเตือน · ล้ม = ฉบับเดิม + คำเตือน', async () => {
  const vs = [version(BEFORE), version(BEFORE, { promptId: 'card_2' }), version(`${BEFORE}\ncard_marker_fail`, { promptId: 'card_3' })];
  let calls = 0;
  const callModel = async ({ system, prompt }) => {
    calls++;
    assert.equal(system, LE.SYS_LAYOUT);
    assert.match(prompt, /ข่าวดิบ \(ใช้เพื่อเข้าใจเรื่องเท่านั้น\):\nข่าวดิบทดสอบ/);
    if (prompt.includes('card_marker_fail')) throw new Error('boom');
    return calls === 2 ? reply(AFTER.replace('300 บาท', 'สามร้อยบาท')) : reply(AFTER);
  };
  const r = await LE.runLayoutEdit(vs, { rawText: 'ข่าวดิบทดสอบ', callModel, review: false }); // ข้อนี้นับครั้งเรียกรอบแรก · รอบอ่านทวนอยู่ข้อ R
  assert.equal(calls, 3);
  const [a, b, c] = r.versions;
  const passed = [a, b].find((v) => v._layoutEdit?.applied);
  const rejected = [a, b].find((v) => v._layoutEdit && !v._layoutEdit.applied);
  assert.ok(passed && rejected, 'ต้องมีทั้งฉบับผ่านและไม่ผ่านด่าน');
  assert.equal(passed.content, AFTER);
  assert.equal(passed._preLayoutContent, BEFORE);
  assert.equal(passed.title, 'หัวข่าวเดิม');
  assert.equal(passed.usedModel, 'claude-opus-4-8');
  assert.equal(passed._layoutEdit.issues, 'ย่อหน้ากลางยาวเป็นก้อน');
  assert.equal(rejected.content, BEFORE, 'ไม่ผ่านด่าน = เนื้อเดิมทุกไบต์');
  assert.equal(rejected._preLayoutContent, undefined);
  assert.ok(rejected._layoutEdit.reasons.some((x) => /ถ้อยคำเปลี่ยน/.test(x)));
  assert.equal(c, vs[2], 'ล้ม = ออบเจกต์เดิม');
  assert.equal(r.applied, 1);
  assert.match(r.warning, /บก.จัดหน้าล้มบางฉบับ — ใช้ฉบับเดิม \(V3: boom\)/);
  assert.match(r.summaryLine, /1\/3 ฉบับ.*ไม่ผ่านด่าน 1.*ล้ม 1/);
});

test('D2 ไม่มีฉบับ = คืนตามเดิม ไม่เรียกโมเดล', async () => {
  let n = 0;
  const r = await LE.runLayoutEdit([], { callModel: async () => { n++; return ''; } });
  assert.equal(n, 0);
  assert.deepEqual(r.versions, []);
  assert.equal(r.skipped, true);
});

test('D3 ตัวตรวจซ้ำ: ส่งฉบับเดิม+เนื้อจัดแล้ว · คืนเหตุ = ฉบับเดิม · โยน error = ฉบับเดิม · ไม่ส่งเมื่อด่านในตัวไม่ผ่าน', async () => {
  const seen = [];
  const r = await LE.runLayoutEdit([version(BEFORE), version(BEFORE, { promptId: 'card_2' }), version(BEFORE, { promptId: 'card_3' })], {
    callModel: async ({ prompt }) => (prompt.includes('ข่าวดิบ (ใช้เพื่อเข้าใจเรื่องเท่านั้น):\nX') ? reply(AFTER) : reply(AFTER)),
    recheck: (v, content) => {
      seen.push([v.promptId, content === AFTER]);
      if (v.promptId === 'card_2') return ['grounding พบจุดใหม่'];
      if (v.promptId === 'card_3') throw new Error('พัง');
      return [];
    },
  });
  assert.deepEqual(seen, [['card_1', true], ['card_2', true], ['card_3', true]]);
  assert.deepEqual(r.versions.map((v) => v.content), [AFTER, BEFORE, BEFORE]);
  assert.deepEqual(r.versions[1]._layoutEdit.reasons, ['grounding พบจุดใหม่']);
  assert.match(r.versions[2]._layoutEdit.reasons[0], /ตรวจซ้ำล้ม: พัง/);
  let called = 0;
  await LE.runLayoutEdit([version(BEFORE)], { callModel: async () => reply(AFTER.replace('300', '301')), recheck: () => { called++; return []; } });
  assert.equal(called, 0, 'ด่านในตัวไม่ผ่าน = ไม่ต้องตรวจซ้ำ');
});

test('D4 ท่อนจริงใน autoFlowServiceText: เปิดสวิตช์ = ใช้ฉบับจัดหน้า + log layout-edit · ตรวจซ้ำด้วยด่านโค้ดของท่อ · สาย URL/ปิดสวิตช์ = ไม่เรียก', async () => {
  const src = readFileSync(`${ROOT}src/lib/services/autoFlowServiceText.js`, 'utf8');
  const start = src.indexOf('  // ★ 28 ต.ค. 69 (เจ้าของสั่ง "เปิดใช้จริงในระบบ")');
  const end = src.indexOf('  ({ classic: classicVersionCount', start);
  assert.ok(start > 0 && end > start, 'ต้องหาท่อนขั้น บก.จัดหน้า ในซอร์สจริงได้');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction('ctx', `
    let { finalVersions } = ctx;
    const { detectedType, rawText, groundingSourceText, pipelineQualityWarnings, addLog, _autoWorkflowId, logPipeline, isLayoutEditEnabled, runLayoutEdit,
      assessRawTextSafety, annotateMissingRawFacts, neutralizeGuessedGender } = ctx;
    ${src.slice(start, end)}
    return { finalVersions, pipelineQualityWarnings };
  `);
  // ด่านจำลอง: นับ "\\n" ในเนื้อ = จำนวนปัญหา (ฉบับจัดหน้ามีบรรทัดมากกว่า = แย่ลงเมื่อเปิดโหมดนั้น)
  const go = async ({ on = true, type = 'plain_text', model = async () => reply(AFTER), worse = null } = {}) => {
    const logs = []; const piped = []; const raws = []; const sources = new Set();
    const count = (v) => (v.content.match(/\n/g) || []).length;
    const out = await run({
      finalVersions: [version(BEFORE), version(BEFORE, { promptId: 'card_2' })], detectedType: type, rawText: 'RAW-ข่าวดิบ', groundingSourceText: 'GROUND',
      pipelineQualityWarnings: [], addLog: (s, m) => logs.push(`${s}: ${m}`), _autoWorkflowId: 'wf_le',
      logPipeline: async (x) => { piped.push(x); }, isLayoutEditEnabled: () => on,
      runLayoutEdit: (vs, opts) => { raws.push(opts.rawText); return LE.runLayoutEdit(vs, { ...opts, callModel: model }); },
      assessRawTextSafety: (vs, s) => { sources.add(s); return { issues: worse === 'grounding' ? Array(count(vs[0])).fill('V1: x') : worse === 'grounding-swap' ? [count(vs[0]) > 4 ? 'V1: B' : 'V1: A'] : [] }; },
      annotateMissingRawFacts: (vs, s) => { sources.add(s); return { flagged: worse === 'missing' ? [{ missing: Array(count(vs[0])).fill({ text: 'วันที่' }) }] : worse === 'missing-swap' ? [{ missing: [{ text: count(vs[0]) > 4 ? 'อายุ' : 'วันที่' }] }] : [] }; },
      neutralizeGuessedGender: (vs, s) => { sources.add(s); return { warned: (worse === 'gender' && count(vs[0]) > 4) || (worse === 'gender-less' && count(vs[0]) <= 4) ? [1] : [] }; },
    });
    return { ...out, logs, piped, raws, sources };
  };
  const on = await go();
  assert.deepEqual(on.finalVersions.map((v) => v.content), [AFTER, AFTER]);
  assert.deepEqual(on.raws, ['RAW-ข่าวดิบ']);
  assert.deepEqual([...on.sources], ['GROUND'], 'ตรวจซ้ำกับข้อความดิบที่ด่าน grounding ใช้');
  assert.equal(on.piped.length, 1);
  assert.equal(on.piped[0].step, 'layout-edit');
  assert.equal(on.piped[0].status, 'success');
  assert.ok(on.logs.some((l) => /บก.จัดหน้า: 2\/2/.test(l)));
  for (const worse of ['grounding', 'grounding-swap', 'missing', 'missing-swap', 'gender', 'gender-less']) {
    const w = await go({ worse });
    assert.deepEqual(w.finalVersions.map((v) => v.content), [BEFORE, BEFORE], `ด่าน ${worse} แย่ลง = ฉบับเดิม`);
    assert.equal(w.piped[0].status, 'fallback');
    assert.equal(w.pipelineQualityWarnings.length, 0, 'ไม่ผ่านตรวจซ้ำ = ไม่ใช่ความล้มเหลว ไม่ต้องเตือนพนักงาน');
  }
  const failing = await go({ model: async () => { throw new Error('ล่ม'); } });
  assert.deepEqual(failing.finalVersions.map((v) => v.content), [BEFORE, BEFORE]);
  assert.equal(failing.piped[0].status, 'fallback');
  assert.equal(failing.pipelineQualityWarnings.length, 1);
  for (const opts of [{ on: false }, { type: 'url' }]) {
    const off = await go(opts);
    assert.deepEqual(off.finalVersions.map((v) => v.content), [BEFORE, BEFORE]);
    assert.equal(off.piped.length, 0);
    assert.deepEqual(off.raws, []);
  }
});

test('E1 เวลางานเหลือน้อย (หลังกันเวลาให้บันทึกผล) = ข้ามทั้งขั้น ไม่เรียกโมเดล ฉบับเดิมทุกตัว', async () => {
  let n = 0;
  const v = version(BEFORE);
  const deadline = createPipelineDeadline({ deadlineAt: Date.now() + 50_000 });
  const r = await runWithPipelineDeadline(deadline, () => LE.runLayoutEdit([v], { callModel: async () => { n++; return reply(AFTER); } }));
  assert.equal(n, 0);
  assert.equal(r.skipped, true);
  assert.equal(r.versions[0], v);
  assert.match(r.summaryLine, /ข้าม/);
});

test('E2 หมดเวลาทั้งขั้น: ฉบับที่เสร็จก่อนยังใช้ · ฉบับที่ค้าง = ตัวเดิม + คำเตือน · ไม่โยน error', async () => {
  const vs = [version(BEFORE), version(`${BEFORE}\nช้าๆ`, { promptId: 'slow' })];
  const callModel = ({ prompt, signal }) => new Promise((resolve, reject) => {
    if (!prompt.includes('ช้าๆ')) return resolve(reply(AFTER));
    const t = setTimeout(() => resolve(reply(AFTER)), 5_000);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); });
  });
  const r = await LE.runLayoutEdit(vs, { callModel, timeoutMs: 300 });
  assert.equal(r.versions[0].content, AFTER);
  assert.equal(r.versions[1], vs[1]);
  assert.equal(r.applied, 1);
  assert.match(r.warning, /V2/);
});

// ★ ผู้ตรวจอิสระรอบ 3: D4 ใช้ด่านจำลอง → ข้อนี้รันท่อนจริงกับด่านโค้ดจริงของท่อ (grounding/ข้อมูลหาย/เดาเพศ)
test('D5 ท่อนจริง + ด่านจริง: แยกบรรทัดจนข้อความสุขภาพหลุดจากที่มา (ด่านในตัวปล่อย) → ตรวจซ้ำตีกลับเป็นฉบับเดิม · แยกบรรทัดปกติ = ใช้ฉบับจัด', async () => {
  const AF = await jiti.import(`${ROOT}src/lib/services/autoFlowServiceText.js`);
  const { annotateMissingRawFacts } = await jiti.import(`${ROOT}src/lib/services/rawFactPresence.js`);
  const { neutralizeGuessedGender } = await jiti.import(`${ROOT}src/lib/services/genderNeutral.js`);
  const src = readFileSync(`${ROOT}src/lib/services/autoFlowServiceText.js`, 'utf8');
  const start = src.indexOf('  // ★ 28 ต.ค. 69 (เจ้าของสั่ง "เปิดใช้จริงในระบบ")');
  const end = src.indexOf('  ({ classic: classicVersionCount', start);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction('ctx', `
    let { finalVersions } = ctx;
    const { detectedType, rawText, groundingSourceText, pipelineQualityWarnings, addLog, _autoWorkflowId, logPipeline, isLayoutEditEnabled, runLayoutEdit,
      assessRawTextSafety, annotateMissingRawFacts, neutralizeGuessedGender } = ctx;
    ${src.slice(start, end)}
    return { finalVersions };
  `);
  const RAW = 'แพทย์แนะนำว่าการกินสมุนไพรนี้ช่วยลดอาการได้ ลุงสมชายอายุ 62 ปี';
  const health = 'ลุงสมชายอายุ 62 ปี การกินสมุนไพรนี้ช่วยลดอาการได้ แพทย์แนะนำไว้แบบนั้น';
  const split = (text) => async ({ prompt }) => reply(prompt.includes(health) ? 'ลุงสมชายอายุ 62 ปี\nการกินสมุนไพรนี้ช่วยลดอาการได้\n\nแพทย์แนะนำไว้แบบนั้น' : text);
  const out = await run({
    finalVersions: [version(health), version(BEFORE, { promptId: 'card_2' })], detectedType: 'text', rawText: RAW, groundingSourceText: RAW,
    pipelineQualityWarnings: [], addLog: () => {}, _autoWorkflowId: 'wf_d5', logPipeline: async () => {}, isLayoutEditEnabled: () => true,
    runLayoutEdit: (vs, opts) => LE.runLayoutEdit(vs, { ...opts, callModel: split(AFTER) }),
    assessRawTextSafety: AF.assessRawTextSafety, annotateMissingRawFacts, neutralizeGuessedGender,
  });
  assert.equal(LE.checkLayoutEdit(health, 'ลุงสมชายอายุ 62 ปี\nการกินสมุนไพรนี้ช่วยลดอาการได้\n\nแพทย์แนะนำไว้แบบนั้น', { minWords: 0 }).ok, true, 'ด่านในตัวปล่อยเคสนี้ (ต้องพึ่งตรวจซ้ำ)');
  assert.equal(out.finalVersions[0].content, health, 'grounding จริงเจอ "ข้อความสุขภาพไม่ระบุที่มา" ใหม่ → ฉบับเดิม');
  assert.ok(out.finalVersions[0]._layoutEdit.reasons.includes('ผล grounding เปลี่ยน'));
  assert.equal(out.finalVersions[1].content, AFTER, 'ข่าวปกติแยกบรรทัด → ใช้ฉบับจัด');
});

// ★ 28 ต.ค. 69 ค่ำ รอบอ่านทวน (วิธี 3 ที่เจ้าของเคาะ) — ผลรอบแรกผ่านด่าน → บก.ตรวจทานแก้จุดค่อม/สะดุด → ผ่านด่านเดิม = ใช้ · ไม่ผ่าน/ล้ม/หมดเวลา = รอบแรก
const AFTER2 = AFTER.replace('300 บาท\n\nโรงเรียนอยู่ไกล', '300 บาท\nโรงเรียนอยู่ไกล'); // ถ้อยคำเดิม ย้ายย่อหน้าเป็นบรรทัด
const reviewReply = (post, issues = 'ย้ายย่อหน้าที่ตัดเศษสั้น') => `<issues>${issues}</issues>\n<post>\n${post}\n</post>`;
const twoPass = (reviewFn) => {
  const calls = [];
  const callModel = async (args) => {
    calls.push(args);
    if (args.system === LE.SYS_LAYOUT) return reply(AFTER);
    assert.equal(args.system, LE.SYS_LAYOUT_REVIEW);
    return reviewFn(args);
  };
  return { calls, callModel };
};

test('R1 สวิตช์อ่านทวน: เปิดเป็นค่าเริ่มต้น · ปิดด้วย LAYOUT_REVIEW=0/off/false/no', async () => {
  await withEnv({ LAYOUT_REVIEW: undefined }, () => assert.equal(LE.isLayoutReviewEnabled(), true));
  for (const v of ['0', 'off', 'FALSE', ' "no" ']) await withEnv({ LAYOUT_REVIEW: v }, () => assert.equal(LE.isLayoutReviewEnabled(), false, v));
  await withEnv({ LAYOUT_REVIEW: '1' }, () => assert.equal(LE.isLayoutReviewEnabled(), true));
});

test('R2 อ่านทวนผ่านด่าน = ใช้ฉบับอ่านทวน · ส่งผลรอบแรก+ข่าวดิบให้ผู้ตรวจทาน · บันทึกค่าใช้จ่ายแยก layoutReview', async () => {
  const { calls, callModel } = twoPass(async () => reviewReply(AFTER2));
  const r = await LE.runLayoutEdit([version(BEFORE)], { rawText: 'ดิบ', callModel, review: true });
  assert.equal(calls.length, 2);
  assert.ok(calls[1].prompt.includes(`ข่าวดิบ (ใช้เพื่อเข้าใจเรื่องเท่านั้น):\nดิบ`));
  assert.ok(calls[1].prompt.endsWith(`โพสต์ที่จัดบรรทัดแล้ว:\n${AFTER}`), 'ผู้ตรวจทานได้ผลรอบแรก');
  assert.equal(calls[1].feature, 'layoutReview');
  assert.equal(calls[0].feature, undefined, 'รอบแรกใช้ค่าเริ่มต้น layoutEdit');
  assert.equal(r.versions[0].content, AFTER2);
  assert.equal(r.versions[0]._preLayoutContent, BEFORE);
  assert.deepEqual(r.versions[0]._layoutEdit.review, { applied: true, reasons: [], issues: 'ย้ายย่อหน้าที่ตัดเศษสั้น' });
  assert.match(r.summaryLine, /1\/1 ฉบับ · อ่านทวนแก้ 1/);
});

// ★ ผู้ตรวจอิสระรอบ 5 ข้อ 1: หน้าที่หลักของรอบอ่านทวน = รวมจุดที่รอบแรกแยกค่อมกลับเป็นเว้นวรรค (เทียบฉบับก่อนจัด ไม่ใช่ผลรอบแรก)
test('R2b อ่านทวนรวมจุดที่รอบแรกแยกกลับเป็นเว้นวรรค = ใช้ได้ · ผลเหมือนรอบแรก = review.applied false + ตัวนับ 0', async () => {
  const merged = AFTER.replace('ไปโรงเรียน\nวันนี้', 'ไปโรงเรียน วันนี้');
  assert.notEqual(merged, AFTER);
  const { callModel } = twoPass(async () => reviewReply(merged, 'รวมบรรทัดค่อม'));
  const r = await LE.runLayoutEdit([version(BEFORE)], { callModel, review: true });
  assert.equal(r.versions[0].content, merged, 'จุดนั้นฉบับก่อนจัดเป็นเว้นวรรค → รวมกลับได้');
  assert.equal(r.versions[0]._layoutEdit.review.applied, true);
  const same = twoPass(async () => reviewReply(AFTER, 'ไม่มี'));
  const r2 = await LE.runLayoutEdit([version(BEFORE)], { callModel: same.callModel, review: true });
  assert.equal(r2.versions[0].content, AFTER);
  assert.equal(r2.versions[0]._layoutEdit.applied, true);
  assert.deepEqual(r2.versions[0]._layoutEdit.review, { applied: false, reasons: [], issues: 'ไม่มี' });
  assert.match(r2.summaryLine, /อ่านทวนแก้ 0/);
});

test('R8 เวลาของขั้นเหลือไม่พอหลังรอบแรก = ไม่เริ่มอ่านทวน (ไม่เสียค่าโมเดลฟรี) · ใช้รอบแรก', async () => {
  const { calls, callModel } = twoPass(async () => reviewReply(AFTER2));
  const r = await LE.runLayoutEdit([version(BEFORE)], { callModel, review: true, timeoutMs: 1_000, reviewMinMs: 5_000 });
  assert.equal(calls.length, 1);
  assert.equal(r.versions[0].content, AFTER);
  assert.deepEqual(r.versions[0]._layoutEdit.review.reasons, ['เวลาไม่พอ']);
});

test('R3 อ่านทวนไม่ผ่านด่าน (แก้คำ/รวมย่อหน้าเดิม) = คงผลรอบแรก ไม่เตือนพนักงาน', async () => {
  for (const bad of [AFTER.replace('300', '301'), BEFORE.replace(/\n\n/g, ' ')]) {
    const { callModel } = twoPass(async () => reviewReply(bad));
    const r = await LE.runLayoutEdit([version(BEFORE)], { callModel, review: true });
    assert.equal(r.versions[0].content, AFTER);
    assert.equal(r.versions[0]._layoutEdit.applied, true);
    assert.equal(r.versions[0]._layoutEdit.review.applied, false);
    assert.ok(r.versions[0]._layoutEdit.review.reasons.length > 0);
    assert.equal(r.warning, null);
  }
});

test('R4 อ่านทวนล้ม = คงผลรอบแรก + บันทึกเหตุ · ไม่เตือนพนักงาน', async () => {
  const { callModel } = twoPass(async () => { throw new Error('overloaded'); });
  const r = await LE.runLayoutEdit([version(BEFORE)], { callModel, review: true });
  assert.equal(r.versions[0].content, AFTER);
  assert.match(r.versions[0]._layoutEdit.review.reasons[0], /อ่านทวนล้ม: overloaded/);
  assert.equal(r.warning, null);
});

test('R5 หมดเวลาระหว่างอ่านทวน = ใช้ผลรอบแรก (ไม่ทิ้งกลับเป็นฉบับเดิม)', async () => {
  const { callModel } = twoPass(({ signal }) => new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(reviewReply(AFTER2)), 5_000);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); });
  }));
  const r = await LE.runLayoutEdit([version(BEFORE)], { callModel, review: true, timeoutMs: 300, reviewMinMs: 0 });
  assert.equal(r.versions[0].content, AFTER);
  assert.deepEqual(r.versions[0]._layoutEdit.review.reasons, ['หมดเวลา']);
  assert.equal(r.applied, 1);
  assert.equal(r.warning, null);
});

test('R6 ปิดอ่านทวน / รอบแรกไม่ผ่านด่าน = ไม่เรียกผู้ตรวจทาน', async () => {
  const off = twoPass(async () => reviewReply(AFTER2));
  await withEnv({ LAYOUT_REVIEW: '0' }, async () => {
    const r = await LE.runLayoutEdit([version(BEFORE)], { callModel: off.callModel });
    assert.equal(r.versions[0].content, AFTER);
    assert.equal(r.versions[0]._layoutEdit.review, null);
  });
  assert.equal(off.calls.length, 1, 'สวิตช์ env ปิด = ครั้งเดียว');
  const calls = [];
  const r2 = await LE.runLayoutEdit([version(BEFORE)], { review: true, callModel: async (a) => { calls.push(a); return reply(AFTER.replace('300', '301')); } });
  assert.equal(calls.length, 1, 'รอบแรกไม่ผ่าน = ไม่อ่านทวน');
  assert.equal(r2.versions[0].content, BEFORE);
});

test('R7 ตรวจซ้ำของท่อตีตกฉบับอ่านทวน แต่รอบแรกผ่าน = ใช้รอบแรก · ตีตกทั้งคู่ = ฉบับเดิม', async () => {
  const { callModel } = twoPass(async () => reviewReply(AFTER2));
  const r = await LE.runLayoutEdit([version(BEFORE)], { callModel, review: true, recheck: (v, content) => (content === AFTER2 ? ['ผล grounding เปลี่ยน'] : []) });
  assert.equal(r.versions[0].content, AFTER);
  assert.equal(r.versions[0]._layoutEdit.applied, true);
  assert.equal(r.versions[0]._layoutEdit.review.applied, false);
  assert.deepEqual(r.versions[0]._layoutEdit.review.reasons, ['ผล grounding เปลี่ยน']);
  const both = twoPass(async () => reviewReply(AFTER2));
  const r2 = await LE.runLayoutEdit([version(BEFORE)], { callModel: both.callModel, review: true, recheck: () => ['ผลข้อมูลต้นฉบับหายเปลี่ยน'] });
  assert.equal(r2.versions[0].content, BEFORE);
  assert.equal(r2.versions[0]._layoutEdit.applied, false);
});
